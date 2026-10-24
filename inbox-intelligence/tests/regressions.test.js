'use strict';
/**
 * Regressões dos achados da revisão adversarial do servidor (cada teste
 * reproduz o cenário que perdia dados, vazava conteúdo ou mostrava errado).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, addToMailbox } = require('./harness');

const NOW = Date.UTC(2026, 9, 24, 15, 0);
const DAY = 86400000;

function boot() {
  const gas = createGas({ fakeClock: NOW });
  gas.props.script.setProperty('GCP_PROJECT_ID', 'meu-projeto');
  gas.props.script.setProperty('OWNER_EMAIL', 'dono@gmail.com');
  const bq = gas.bq;
  bq.handlers.existing_ids = (req) => {
    const p = (req.queryParameters || []).find((x) => x.name === 'ids');
    const want = p ? p.parameterValue.arrayValues.map((v) => v.value) : [];
    const have = new Set((bq.tables['messages__g1'] || []).map((r) => r.message_id));
    return { rows: want.filter((id) => have.has(id)).map((id) => ({ message_id: id })) };
  };
  for (const n of ['known_contacts', 'sender_affinity', 'duplicate_hashes', 'thread_context', 'pending_ai', 'rescore_candidates', 'briefing_input', 'ids_in_window']) {
    bq.handlers[n] = () => ({ rows: [] });
  }
  gas.G.setup();
  return gas;
}
const rows = (gas, t) => gas.bq.tables[t] || [];
const prop = (gas, k) => gas.props.script.getProperty(k);

test('erro no parser não perde a mensagem: tenta de novo, quarentena e, por fim, linha mínima', () => {
  const gas = boot();
  gas.G.runPipeline(); // inicializa
  const bad = addToMailbox(gas, { from: 'Ana <ana@exemplo.com.br>', subject: 'Mensagem patológica', text: 'x', date: NOW - 3600000 });
  const ok = addToMailbox(gas, { from: 'Bia <bia@exemplo.com.br>', subject: 'Mensagem normal', text: 'Olá', date: NOW - 3600000 });
  const orig = gas.G.MessageParser.parse;
  gas.G.MessageParser.parse = (m, c) => {
    if (m.id === bad.id) throw new Error('boom');
    return orig(m, c);
  };
  const before = prop(gas, 'GMAIL_HISTORY_ID');
  const r1 = gas.G.runPipeline();
  assert.equal(r1.status, 'PARTIAL');
  assert.equal(prop(gas, 'GMAIL_HISTORY_ID'), before, 'histórico não avança com mensagem pendente');
  assert.ok(rows(gas, 'messages__g1').some((x) => x.message_id === ok.id), 'as demais seguem');
  gas.G.runPipeline(); // falha de novo, agora em quarentena → quarentena profunda
  const r3 = gas.G.runPipeline();
  const row = rows(gas, 'messages__g1').find((x) => x.message_id === bad.id);
  assert.ok(row, 'gravada com metadados mínimos');
  assert.equal(row.parse_status, 'QUARANTINED');
  assert.equal(row.parser_version, 'minimal');
  assert.equal(row.body_excerpt, null);
  assert.equal(r3.counts.minimal_rows, 1);
  assert.equal(prop(gas, 'GMAIL_HISTORY_ID'), String(gas.gmail.historyId));
});

test('erro transitório no messages.get segura a página do backfill até a mensagem entrar', () => {
  const gas = boot();
  const m = addToMailbox(gas, { from: 'Ana <ana@exemplo.com.br>', subject: 'Antiga', text: 'Olá', date: NOW - 3 * DAY });
  const get = gas.G.Gmail.Users.Messages.get;
  let failures = 3; // as 3 tentativas internas de uma chamada
  gas.G.Gmail.Users.Messages.get = (u, id, o) => {
    if (id === m.id && failures > 0) {
      failures--;
      const e = new Error('Backend Error');
      e.details = { code: 503 };
      throw e;
    }
    return get(u, id, o);
  };
  const r1 = gas.G.runPipeline();
  assert.equal(r1.status, 'PARTIAL');
  assert.ok(!rows(gas, 'messages__g1').some((x) => x.message_id === m.id));
  const bf = JSON.parse(prop(gas, 'BACKFILL_STATE'));
  assert.equal(bf.cursor, '2026-10-25', 'cursor do backfill não avançou');
  gas.G.runPipeline();
  assert.ok(rows(gas, 'messages__g1').some((x) => x.message_id === m.id));
});

test('mensagem que chegou no Spam e foi resgatada entra na próxima sincronização', () => {
  const gas = boot();
  gas.G.runPipeline();
  const m = addToMailbox(gas, { from: 'Carla <carla@exemplo.com.br>', subject: 'Proposta', text: 'Segue a proposta.', date: NOW - 3600000, labels: ['SPAM'] });
  gas.G.runPipeline();
  assert.ok(!rows(gas, 'messages__g1').some((x) => x.message_id === m.id), 'no Spam não entra');
  gas.gmail.messages.get(m.id).labelIds = ['INBOX', 'UNREAD'];
  gas.gmail.historyId += 1;
  gas.gmail.history.push({ id: String(gas.gmail.historyId), labelsRemoved: [{ message: { id: m.id, threadId: m.threadId, labelIds: ['INBOX', 'UNREAD'] }, labelIds: ['SPAM'] }] });
  const r = gas.G.runPipeline();
  assert.equal(r.counts.rescued_candidates, 1);
  assert.ok(rows(gas, 'messages__g1').some((x) => x.message_id === m.id), 'resgatada entra');
});

test('resync reconcilia o estado do que já estava gravado (excluídas viram DELETED)', () => {
  const gas = boot();
  const keep = addToMailbox(gas, { from: 'A <a@exemplo.com.br>', subject: 'Fica', text: 'x', date: NOW - DAY });
  const gone = addToMailbox(gas, { from: 'B <b@exemplo.com.br>', subject: 'Some', text: 'y', date: NOW - DAY });
  gas.G.runPipeline();
  gas.gmail.messages.delete(gone.id);
  gas.gmail.messages.get(keep.id).labelIds = ['INBOX']; // lida
  gas.bq.handlers.ids_in_window = () => ({ rows: [{ message_id: keep.id }, { message_id: gone.id }] });
  gas.gmail.failHistory = 404;
  gas.G.runPipeline();
  gas.gmail.failHistory = null;
  const states = rows(gas, 'message_state__g1').filter((s) => s.source === 'RESYNC');
  assert.equal(states.find((s) => s.message_id === gone.id).gmail_state, 'DELETED');
  assert.equal(states.find((s) => s.message_id === keep.id).is_unread, false);
  assert.equal(JSON.parse(prop(gas, 'GMAIL_WINDOWS')).length, 0);
});

test('IA: erro de infraestrutura (5xx/429) não consome tentativa', () => {
  const gas = boot();
  gas.props.script.setProperty('ANTHROPIC_API_KEY', 'sk-test-falsa');
  gas.http.handler = () => ({ code: 529, body: { error: { type: 'overloaded_error', message: 'overloaded' } } });
  gas.G.AiClient.recordConsent('REDACTED');
  addToMailbox(gas, { from: 'Bruno <bruno@consultoria-exemplo.com.br>', subject: 'Revisão do modelo', text: 'Podemos revisar o modelo na quinta? Preciso da resposta até 30/10/2026.', date: NOW - 3600000 });
  gas.G.runPipeline();
  const a = rows(gas, 'analyses__g1')[0];
  assert.equal(a.ai_status, 'PENDING');
  assert.equal(a.ai_attempts, 0);
});

test('feedback de oportunidade com chave "empresa|cargo" (com espaços) é aceito', () => {
  const gas = boot();
  const r = gas.G.apiSubmitFeedback({ targetType: 'OPPORTUNITY', targetId: 'banco inter|engenheira dados senior', type: 'SAVED' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const bad = gas.G.apiSubmitFeedback({ targetType: 'OPPORTUNITY', targetId: "x'; DROP", type: 'SAVED' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'VALIDATION');
});

test('"desde a última visita" compara com a sessão anterior, não com a atual', () => {
  const gas = boot();
  gas.G.apiMarkVisit();
  gas.clock.now += 2 * 3600000;
  const v = gas.G.apiMarkVisit();
  assert.equal(v.data.previousVisitAt, new Date(NOW).toISOString());
  gas.clock.now += 5 * 60000; // recarga na mesma sessão
  assert.equal(gas.G.apiMarkVisit().data.previousVisitAt, new Date(NOW).toISOString());
});

test('link de descadastro só de remetente autenticado com List-Unsubscribe', () => {
  const gas = boot();
  const base = { message_id: 'abc123', subject: 'x', display_level: 'LOW', score: '0.1', unsubscribe_url: 'https://golpe.exemplo.ru/unsubscribe', history: [] };
  const fields = Object.keys(base).map((n) => ({ name: n, type: 'STRING', mode: n === 'history' ? 'REPEATED' : undefined }))
    .concat(['has_list_unsubscribe', 'auth_pass', 'auth_fail', 'is_probable_spam', 'retention_expired'].map((n) => ({ name: n, type: 'BOOL' })));
  gas.bq.handlers.actions_for_message = () => ({ rows: [] });
  gas.bq.handlers.message_detail = () => ({ rows: [Object.assign({}, base, { has_list_unsubscribe: false, auth_pass: false, auth_fail: true, is_probable_spam: false, retention_expired: false })], fields });
  assert.equal(gas.G.apiGetMessage({ id: 'abc123' }).data.unsubscribeUrl, '');
  gas.bq.handlers.message_detail = () => ({ rows: [Object.assign({}, base, { has_list_unsubscribe: true, auth_pass: true, auth_fail: false, is_probable_spam: false, retention_expired: false })], fields });
  assert.equal(gas.G.apiGetMessage({ id: 'abc123' }).data.unsubscribeUrl, 'https://golpe.exemplo.ru/unsubscribe');
});

test('funções de editor chamadas por outra pessoa via google.script.run são recusadas', () => {
  const gas = boot();
  gas.session.activeEmail = 'intruso@gmail.com';
  assert.throws(() => gas.G.uninstallTriggers(), /Acesso negado/);
  assert.throws(() => gas.G.runBackfillNow(), /Acesso negado/);
  assert.throws(() => gas.G.runPipeline(), /Acesso negado/);
  assert.equal(gas.triggers.length, 2, 'gatilhos intactos');
});

test('PII some do resumo extrativo, das ações e das evidências gravadas', () => {
  const gas = boot();
  addToMailbox(gas, { from: 'Ana Souza <ana@empresa-exemplo.com.br>', subject: 'Cadastro', date: NOW - 3600000,
    text: 'Confirmei seu CPF 529.982.247-25 no cadastro. Por favor envie até 30/10/2026 a foto do RG 12.345.678-9 e confirme o telefone (11) 98765-4321.' });
  gas.G.runPipeline();
  const a = rows(gas, 'analyses__g1')[0];
  const blob = JSON.stringify(a);
  assert.ok(!/529\.982\.247-25|12\.345\.678-9|98765-4321/.test(blob), blob.slice(0, 400));
});

test('diagnose(): checagens reais somente leitura, sem segredos nem conteúdo', () => {
  const gas = boot();
  gas.props.script.setProperty('ANTHROPIC_API_KEY', 'sk-ant-segredo-que-nao-pode-vazar-123456');
  gas.bq.defaultHandler = (req) => (/SELECT 1 AS ok/.test(req.query) ? { rows: [{ ok: 1 }] } : /COUNT\(\*\)/.test(req.query) ? { rows: [{ n: 3 }] } : { rows: [] });
  for (const t of gas.G.Schema.names()) gas.bq.tableMeta[t + '__g1'] = { creationTime: String(NOW), expirationTime: String(NOW + 50 * DAY), numRows: '1', numBytes: '1' };
  for (const v of gas.G.Schema.VIEW_ORDER) gas.bq.tableMeta['v_' + v] = { creationTime: String(NOW), expirationTime: String(NOW + 50 * DAY), type: 'VIEW' };
  const r = gas.G.diagnose();
  const byName = Object.fromEntries(r.live.checks.map((c) => [c.name, c]));
  assert.equal(r.live.ok, true, JSON.stringify(r.live.checks));
  assert.match(byName.ia.detail, /aguardando consentimento/);
  assert.ok(!JSON.stringify(r).includes('sk-ant-segredo'));
  assert.ok(gas.gmail.calls.every((c) => ['getProfile', 'messages.list'].includes(c.m)));
});
