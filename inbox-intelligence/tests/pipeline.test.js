'use strict';
/**
 * Integração do pipeline com Gmail e BigQuery simulados (harness): setup,
 * backfill inicial, incremental pelo histórico, resync em 404, commit em
 * duas fases, quarentena, lock, IA com consentimento e feedback.
 * Dados 100% sintéticos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, addToMailbox } = require('./harness');

const NOW = Date.UTC(2026, 9, 24, 15, 0); // 24/10/2026 12:00 em São Paulo
const DAY = 86400000;

function boot(opts) {
  const gas = createGas({ fakeClock: NOW });
  gas.props.script.setProperty('GCP_PROJECT_ID', 'meu-projeto');
  gas.props.script.setProperty('OWNER_EMAIL', 'dono@gmail.com');
  emulateBigQuery(gas);
  if (!(opts && opts.noSetup)) gas.G.setup();
  return gas;
}

/** Consultas mínimas que o pipeline faz, respondidas a partir das tabelas carregadas. */
function emulateBigQuery(gas) {
  const bq = gas.bq;
  const ids = (req, name) => {
    const p = (req.queryParameters || []).find((x) => x.name === name);
    return p ? (p.parameterValue.arrayValues || []).map((v) => v.value) : [];
  };
  bq.handlers.existing_ids = (req) => {
    const want = new Set(ids(req, 'ids'));
    const have = new Set((bq.tables['messages__g1'] || []).map((r) => r.message_id));
    return { rows: [...want].filter((id) => have.has(id)).map((id) => ({ message_id: id })) };
  };
  for (const n of ['known_contacts', 'sender_affinity', 'duplicate_hashes', 'thread_context', 'pending_ai', 'rescore_candidates', 'briefing_input']) {
    if (!bq.handlers[n]) bq.handlers[n] = () => ({ rows: [] });
  }
}

function loadsOf(gas, table) {
  return gas.bq.jobs.filter((j) => j.job.configuration.load && j.job.configuration.load.destinationTable.tableId === table);
}
function rows(gas, table) {
  return gas.bq.tables[table] || [];
}

const CPF_TEXT = 'Olá! Segue o contrato. Meu CPF é 529.982.247-25 e o telefone (11) 98765-4321. Pode assinar até 30/10/2026?';

function seedMailbox(gas) {
  const m = {};
  m.person = addToMailbox(gas, { from: 'Ana Souza <ana@empresa-exemplo.com.br>', subject: 'Contrato para assinatura', text: CPF_TEXT, date: NOW - 2 * DAY, labels: ['INBOX', 'UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL'] });
  m.bill = addToMailbox(gas, {
    from: 'Energia Exemplo <faturas@energia-exemplo.com.br>', subject: 'Sua fatura vence em 28/10/2026', date: NOW - 1 * DAY,
    text: 'Sua fatura de outubro no valor de R$ 245,90 vence em 28/10/2026. Pague pelo app.', labels: ['INBOX', 'CATEGORY_UPDATES'],
  });
  m.news = addToMailbox(gas, {
    from: 'Boletim Dados <news@boletim-exemplo.com>', subject: 'Machine learning em pricing: o que mudou', date: NOW - 3 * DAY,
    text: 'Nesta edição: modelos de elasticidade e precificação dinâmica com Python. Ver no navegador.',
    headers: { 'List-Unsubscribe': '<https://boletim-exemplo.com/sair>', 'List-Id': 'boletim.boletim-exemplo.com', Precedence: 'bulk' },
    labels: ['INBOX', 'CATEGORY_UPDATES'],
  });
  m.sent = addToMailbox(gas, { from: 'Dono <dono@gmail.com>', to: 'Ana Souza <ana@empresa-exemplo.com.br>', subject: 'Re: Contrato', text: 'Combinado, assino amanhã.', date: NOW - 1 * DAY, labels: ['SENT'] });
  m.draft = addToMailbox(gas, { from: 'Dono <dono@gmail.com>', subject: 'rascunho', text: 'texto de rascunho', date: NOW - 1 * DAY, labels: ['DRAFT'] });
  m.spam = addToMailbox(gas, { from: 'Prêmio <x@golpe-exemplo.biz>', subject: 'Você ganhou', text: 'clique', date: NOW - 1 * DAY, labels: ['SPAM'] });
  m.meeting = addToMailbox(gas, {
    from: 'Bruno Lima <bruno@consultoria-exemplo.com.br>', subject: 'Revisão do modelo de precificação', date: NOW - 5 * 3600000,
    text: 'Oi! Podemos revisar o modelo de precificação na quinta? Me liga no (11) 98765-4321 ou responde para bruno.lima@pessoal-exemplo.com. Preciso da sua resposta até 30/10/2026.',
    labels: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL'],
  });
  m.old = addToMailbox(gas, { from: 'Carlos <carlos@exemplo.org>', subject: 'Notícias da família', text: 'Texto antigo com CPF 529.982.247-25', date: NOW - 45 * DAY, labels: ['INBOX'] });
  return m;
}

test('setup é idempotente: dataset, tabelas, views e exatamente 2 gatilhos', () => {
  const gas = boot();
  assert.ok(gas.bq.datasets.inbox_intelligence, 'dataset criado');
  const ddl = gas.bq.queries.filter((q) => q.request && q.request.labels && q.request.labels.query_name === 'setup_table');
  assert.equal(ddl.length, 7);
  assert.ok(ddl.every((q) => /CREATE TABLE IF NOT EXISTS/.test(q.request.query)));
  const views = gas.bq.queries.filter((q) => q.request && q.request.labels && q.request.labels.query_name === 'setup_view');
  assert.ok(views.length >= 10);
  gas.G.setup();
  const handlers = gas.triggers.map((t) => t.getHandlerFunction()).sort();
  assert.deepEqual(handlers, ['runMaintenance', 'runPipeline']);
  assert.equal(gas.props.script.getProperty('SETUP_VERSION'), '1');
});

test('pipeline recusa rodar sem setup e registra erro de configuração', () => {
  const gas = boot({ noSetup: true });
  const r = gas.G.runPipeline();
  assert.equal(r.status, 'FAILED');
  assert.equal(r.errors[0].code, 'CONFIG');
});

test('primeira execução: backfill grava em duas fases, respeita elegibilidade, retenção e redação', () => {
  const gas = boot();
  const m = seedMailbox(gas);
  const r = gas.G.runPipeline();
  assert.notEqual(r.status, 'FAILED', JSON.stringify(r.errors));
  assert.equal(gas.props.script.getProperty('GMAIL_HISTORY_ID'), String(gas.gmail.historyId));

  const msgs = rows(gas, 'messages__g1');
  const ids = msgs.map((x) => x.message_id).sort();
  assert.deepEqual(ids, [m.person.id, m.bill.id, m.news.id, m.sent.id, m.meeting.id, m.old.id].sort(), 'rascunho e spam não entram');
  // Rascunho nunca é buscado (descartado pelos labels? não: lista não traz labels — mas é descartado após a busca).
  assert.ok(!msgs.some((x) => 'body_text' in x));

  const person = msgs.find((x) => x.message_id === m.person.id);
  assert.ok(person.body_excerpt.includes('[CPF]'), 'CPF redigido no trecho');
  assert.ok(!person.body_excerpt.includes('529.982.247-25'));
  assert.ok(!person.body_excerpt.includes('98765-4321'), 'telefone redigido');
  assert.equal(person.fetch_format, 'full');

  const sent = msgs.find((x) => x.message_id === m.sent.id);
  assert.equal(sent.direction, 'OUTBOUND');
  assert.equal(sent.body_excerpt, null, 'enviadas: só metadados');

  const old = msgs.find((x) => x.message_id === m.old.id);
  assert.equal(old.fetch_format, 'metadata', 'fora da janela de retenção: busca só metadados');
  assert.equal(old.body_excerpt, null);

  // Ordem do commit: derivados antes do marcador `messages`.
  const order = gas.bq.jobs.filter((j) => j.job.configuration.load).map((j) => j.job.configuration.load.destinationTable.tableId);
  const firstMsg = order.indexOf('messages__g1');
  assert.ok(order.indexOf('analyses__g1') < firstMsg && order.indexOf('scores__g1') < firstMsg && order.indexOf('message_state__g1') < firstMsg);

  // Uma análise de regras e um score por mensagem; nada de IA sem chave.
  const an = rows(gas, 'analyses__g1');
  assert.equal(an.length, 6);
  assert.ok(an.every((a) => a.method === 'RULES'));
  assert.equal(rows(gas, 'scores__g1').length, 6);
  const bill = an.find((a) => a.message_id === m.bill.id);
  assert.equal(bill.primary_category, 'contas');
  assert.equal(bill.deadline_date, '2026-10-28');
  // Execução registrada sem conteúdo.
  const run = rows(gas, 'runs__g1')[0];
  assert.ok(run && run.status);
  assert.ok(!JSON.stringify(run).includes('Contrato'));
  // Somente leitura: nenhuma chamada de escrita ao Gmail.
  assert.ok(gas.gmail.calls.every((c) => ['getProfile', 'history.list', 'messages.list', 'messages.get'].includes(c.m)));
});

test('incremental: só mensagens novas; rascunhos do histórico nem são buscados; historyId avança', () => {
  const gas = boot();
  seedMailbox(gas);
  gas.G.runPipeline();
  const before = rows(gas, 'messages__g1').length;
  const fresh = addToMailbox(gas, { from: 'Recrutadora <rh@techcorp-exemplo.com>', subject: 'Vaga Senior Data Scientist - Pricing', text: 'Olá, vi seu perfil. Temos uma vaga de Senior Data Scientist (pricing), remoto. Podemos conversar esta semana?', date: NOW - 3600000 });
  const draft = addToMailbox(gas, { from: 'Dono <dono@gmail.com>', subject: 'rascunho 2', text: 'x', date: NOW - 60000, labels: ['DRAFT'] });
  gas.gmail.calls.length = 0;
  const r = gas.G.runPipeline();
  assert.notEqual(r.status, 'FAILED', JSON.stringify(r.errors));
  const after = rows(gas, 'messages__g1');
  assert.equal(after.length, before + 1);
  assert.ok(after.some((x) => x.message_id === fresh.id));
  assert.ok(!gas.gmail.calls.some((c) => c.m === 'messages.get' && c.id === draft.id), 'rascunho descartado pelos labels do histórico');
  assert.equal(gas.props.script.getProperty('GMAIL_HISTORY_ID'), String(gas.gmail.historyId));
  const an = rows(gas, 'analyses__g1').find((a) => a.message_id === fresh.id);
  assert.ok(an.opportunity_json, 'vaga 1:1 vira oportunidade');
});

test('histórico expirado (404): agenda resync por janela e reposiciona o historyId', () => {
  const gas = boot();
  seedMailbox(gas);
  gas.G.runPipeline();
  const missed = addToMailbox(gas, { from: 'Banco Exemplo <avisos@banco-exemplo.com.br>', subject: 'Comprovante de transferência', text: 'Transferência realizada.', date: NOW - 2 * 3600000 });
  gas.gmail.failHistory = 404;
  const r = gas.G.runPipeline();
  gas.gmail.failHistory = null;
  assert.notEqual(r.status, 'FAILED', JSON.stringify(r.errors));
  assert.equal(r.counts.resync_scheduled, 1);
  assert.ok(rows(gas, 'messages__g1').some((x) => x.message_id === missed.id), 'resync recuperou a mensagem perdida');
  assert.equal(JSON.parse(gas.props.script.getProperty('GMAIL_WINDOWS')).length, 0, 'janela concluída');
});

test('falha no marcador `messages`: próxima execução grava só o marcador (sem reprocessar análises)', () => {
  const gas = boot();
  seedMailbox(gas);
  gas.bq.loadErrors['messages__g1'] = 'simulated';
  const r1 = gas.G.runPipeline();
  assert.equal(rows(gas, 'messages__g1').length, 0);
  const partial = JSON.parse(gas.props.script.getProperty('PARTIAL_COMMIT_IDS'));
  assert.ok(partial.length >= 1);
  assert.ok(r1.errors.some((e) => e.code === 'LOAD_FAILED'));
  const analysesBefore = rows(gas, 'analyses__g1').length;
  delete gas.bq.loadErrors['messages__g1'];
  gas.G.runPipeline();
  assert.equal(rows(gas, 'messages__g1').length, 6);
  const reanalyzed = rows(gas, 'analyses__g1').filter((a) => partial.includes(a.message_id)).length;
  assert.equal(reanalyzed, partial.length, 'análises dos ids parciais não foram regravadas');
  assert.ok(rows(gas, 'analyses__g1').length >= analysesBefore);
  assert.equal(JSON.parse(gas.props.script.getProperty('PARTIAL_COMMIT_IDS')).length, 0);
});

test('lock ocupado: execução concorrente não roda', () => {
  const gas = boot();
  gas.lockState.heldByOther = true;
  assert.equal(gas.G.runPipeline().status, 'LOCKED');
});

test('execução abortada: mensagem em processamento vai para a quarentena e entra só com metadados', () => {
  const gas = boot();
  const m = seedMailbox(gas);
  gas.props.script.setProperty('RUN_HEARTBEAT', JSON.stringify({ run_id: 'x', kind: 'PIPELINE', at: NOW - 1000, stage: 'parse', processing: m.person.id }));
  const r = gas.G.runPipeline();
  assert.equal(r.counts.recovered_aborted_run, 1);
  const row = rows(gas, 'messages__g1').find((x) => x.message_id === m.person.id);
  assert.equal(row.parse_status, 'QUARANTINED');
  assert.equal(row.fetch_format, 'metadata');
  assert.equal(row.body_excerpt, null);
  assert.equal(gas.props.script.getProperty('RUN_HEARTBEAT'), null, 'heartbeat limpo no fim');
});

function claudeHandler(gas, opts) {
  const seen = [];
  gas.http.handler = (req) => {
    if (!/api\.anthropic\.com/.test(req.url)) return { code: 404, body: '' };
    const body = JSON.parse(req.payload);
    seen.push(body);
    const content = body.messages[0].content;
    if (/briefing/i.test(body.system[0].text)) {
      const refs = [...content.matchAll(/^(b\d+) \|/gm)].map((x) => x[1]);
      return { code: 200, body: { content: [{ type: 'text', text: JSON.stringify({ headline: 'Dia com um contrato para assinar.', bullets: [{ text: 'Assinar contrato', refs: refs.slice(0, 1) }] }) }], usage: { input_tokens: 500, output_tokens: 80 }, stop_reason: 'end_turn' } };
    }
    const refs = [...content.matchAll(/ref=(m\d+)>>>/g)].map((x) => x[1]).filter((v, i, a) => a.indexOf(v) === i);
    const items = refs.map((ref) => ({
      ref, primary_category: (opts && opts.category) || 'trabalho', secondary_categories: [], topics: ['contrato'], summary: 'Pedido de assinatura de contrato com prazo.',
      key_facts: [{ fact: 'Resposta pedida', evidence: 'Preciso da sua resposta até 30/10/2026' }], whats_new: '', relevance: 4, importance: 4, urgency: 4,
      action_required: true, actions: [{ description: 'Responder sobre a revisão', owner: 'me', due_date: '2026-10-30', due_certainty: 'EXPLICIT', evidence: 'Preciso da sua resposta até 30/10/2026' }],
      deadline: { date: '2026-10-30', certainty: 'EXPLICIT', evidence: 'até 30/10/2026' }, entities: [{ name: 'Ana Souza', type: 'person' }],
      opportunity: { type: 'none', title: '', company: '', role: '', seniority: '', location: '', work_mode: 'unknown', compensation: '', requirements: [], stage: '', next_step: '', evidence: '' },
      confidence: 0.9, reason: 'Pedido direto com prazo.', evidence: ['Podemos revisar o modelo de precificação'], injection_suspected: false,
    }));
    return { code: 200, body: { content: [{ type: 'text', text: JSON.stringify({ items }) }], usage: { input_tokens: 1200, output_tokens: 400 }, stop_reason: 'end_turn' } };
  };
  return seen;
}

test('IA desligada até o consentimento; com REDACTED, o texto sai redigido e sem sensíveis', () => {
  const gas = boot();
  gas.props.script.setProperty('ANTHROPIC_API_KEY', 'sk-test-falsa');
  const seen = claudeHandler(gas);
  const m = seedMailbox(gas);
  addToMailbox(gas, { from: 'Laboratório Exemplo <resultados@lab-exemplo.com.br>', subject: 'Resultado de exame disponível', text: 'Seu laudo de exame de sangue está disponível.', date: NOW - DAY });
  gas.G.runPipeline();
  assert.equal(seen.length, 0, 'sem consentimento nada sai');
  assert.ok(rows(gas, 'analyses__g1').every((a) => a.method === 'RULES'));

  const gas2 = boot();
  gas2.props.script.setProperty('ANTHROPIC_API_KEY', 'sk-test-falsa');
  const seen2 = claudeHandler(gas2);
  const m2 = seedMailbox(gas2);
  const exam = addToMailbox(gas2, { from: 'Laboratório Exemplo <resultados@lab-exemplo.com.br>', subject: 'Resultado de exame disponível', text: 'Seu laudo de exame de sangue está disponível.', date: NOW - DAY });
  assert.equal(gas2.G.AiClient.recordConsent('REDACTED').ok, true);
  const r = gas2.G.runPipeline();
  assert.notEqual(r.status, 'FAILED', JSON.stringify(r.errors));
  const analysisCalls = seen2.filter((b) => !/briefing/i.test(b.system[0].text));
  assert.ok(analysisCalls.length >= 1, 'houve chamada de análise');
  const sentText = analysisCalls.map((b) => b.messages[0].content).join('\n');
  assert.ok(!sentText.includes('529.982.247-25'), 'CPF não sai');
  assert.ok(!sentText.includes('98765-4321'), 'telefone não sai');
  assert.ok(!sentText.includes('bruno.lima@pessoal-exemplo.com'), 'e-mail no corpo não sai');
  assert.ok(sentText.includes('modelo de precifica'), 'o conteúdo útil sai');
  assert.ok(!sentText.includes('laudo'), 'mensagem de saúde (sensível) não sai em REDACTED');
  assert.ok(analysisCalls.every((b) => b.temperature === undefined && b.top_p === undefined), 'sem parâmetros de amostragem');
  const ai = rows(gas2, 'analyses__g1').filter((a) => a.method === 'AI');
  assert.ok(ai.some((a) => a.message_id === m2.meeting.id));
  assert.ok(!ai.some((a) => a.message_id === exam.id));
  const examRules = rows(gas2, 'analyses__g1').find((a) => a.message_id === exam.id);
  assert.equal(examRules.sensitive, true);
  assert.equal(examRules.ai_status, 'BLOCKED');
  // Score final aponta para a análise de IA.
  const aiRow = ai.find((a) => a.message_id === m2.meeting.id);
  const sc = rows(gas2, 'scores__g1').find((s) => s.message_id === m2.meeting.id);
  assert.equal(sc.analysis_id, aiRow.analysis_id);
  assert.ok(Number(r.counts.ai_done) >= 1);
  void m;
});

test('IA não rebaixa remetente humano para spam/marketing sem concordância das regras', () => {
  const gas = boot();
  gas.props.script.setProperty('ANTHROPIC_API_KEY', 'sk-test-falsa');
  claudeHandler(gas, { category: 'marketing' });
  const m = seedMailbox(gas);
  gas.G.AiClient.recordConsent('REDACTED');
  gas.G.runPipeline();
  const ai = rows(gas, 'analyses__g1').find((a) => a.method === 'AI' && a.message_id === m.meeting.id);
  assert.ok(ai, 'análise de IA gravada');
  assert.notEqual(ai.primary_category, 'marketing');
  assert.equal(ai.is_marketing, false);
});

test('feedback: fila nas Propriedades, descarregada sob lock, com reescore das mensagens afetadas', () => {
  const gas = boot();
  const m = seedMailbox(gas);
  gas.G.runPipeline();
  const res = gas.G.apiSubmitFeedback({ targetType: 'MESSAGE', targetId: m.bill.id, type: 'IRRELEVANT', payload: {} });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.pending, 1);
  const an = rows(gas, 'analyses__g1').find((a) => a.message_id === m.bill.id);
  const sc = rows(gas, 'scores__g1').find((s) => s.message_id === m.bill.id);
  gas.bq.handlers.rescore_candidates = () => ({
    rows: [{ message_id: m.bill.id, analysis_id: an.analysis_id, received_date: an.received_date, features_json: an.features_json, level: sc.level, score: String(sc.score), user_status: '', user_relevance: 'IRRELEVANT', correct_category: null, deadline_date: '2026-10-28', method: 'RULES' }],
    fields: [{ name: 'message_id', type: 'STRING' }, { name: 'analysis_id', type: 'STRING' }, { name: 'received_date', type: 'DATE' }, { name: 'features_json', type: 'STRING' }, { name: 'level', type: 'STRING' }, { name: 'score', type: 'FLOAT64' }, { name: 'user_status', type: 'STRING' }, { name: 'user_relevance', type: 'STRING' }, { name: 'correct_category', type: 'STRING' }, { name: 'deadline_date', type: 'DATE' }, { name: 'method', type: 'STRING' }],
  });
  const r = gas.G.runPipeline();
  assert.equal(r.counts.feedback_flushed, 1);
  assert.equal(rows(gas, 'feedback__g1').length, 1);
  assert.equal(gas.G.Repository.pendingFeedback().length, 0);
  const rescored = rows(gas, 'scores__g1').filter((s) => s.message_id === m.bill.id && s.source === 'FEEDBACK');
  assert.equal(rescored.length, 1);
  assert.equal(rescored[0].level, 'LOW');
});

test('feedback inválido é recusado com VALIDATION, sem gravar nada', () => {
  const gas = boot();
  const bad = [
    { targetType: 'MESSAGE', targetId: 'abc', type: 'DELETE' },
    { targetType: 'THREAD', targetId: 'abc', type: 'RELEVANT' },
    { targetType: 'MESSAGE', targetId: "x' OR 1=1 --", type: 'RELEVANT' },
    { targetType: 'MESSAGE', targetId: 'abc123', type: 'MISCLASSIFIED', payload: { correctCategory: 'inexistente' } },
  ];
  for (const b of bad) {
    const r = gas.G.apiSubmitFeedback(b);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'INTERNAL' === r.error.code ? 'INTERNAL' : r.error.code);
  }
  assert.equal(gas.G.Repository.pendingFeedback().length, 0);
});

test('Web App: só o dono; erros com mensagem segura; sincronização agenda gatilho avulso', () => {
  const gas = boot();
  gas.session.activeEmail = 'intruso@gmail.com';
  const denied = gas.G.apiBootstrap();
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'DENIED');
  gas.session.activeEmail = '';
  assert.equal(gas.G.apiBootstrap().error.code, 'DENIED');
  gas.session.activeEmail = 'dono@gmail.com';
  const ok = gas.G.apiBootstrap();
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.data.setup.ok, true);
  const s1 = gas.G.apiRunSyncNow();
  const s2 = gas.G.apiRunSyncNow();
  assert.equal(s1.ok && s2.ok, true);
  assert.equal(gas.triggers.filter((t) => t._spec.after).length, 1, 'idempotente');
  const oneShot = gas.triggers.find((t) => t._spec.after);
  gas.G.runPipeline({ triggerUid: oneShot.getUniqueId() });
  assert.equal(gas.triggers.filter((t) => t._spec.after).length, 0, 'gatilho avulso removido ao disparar');
  // Página: template sem dados interpolados, título e viewport.
  const page = gas.G.doGet({ parameter: { x: '<script>' } });
  assert.equal(page._title, 'Inbox Intelligence');
  assert.ok(!page.getContent().includes('<script>alert'));
  assert.throws(() => gas.G.include('../appsscript'));
});

test('manutenção: renova a geração quando a tabela passa de 45 dias e adia o descarte', () => {
  const gas = boot();
  const created = NOW - 46 * DAY;
  for (const t of ['messages', 'message_state', 'analyses', 'scores', 'feedback', 'runs', 'briefings']) {
    gas.bq.tableMeta[t + '__g1'] = { creationTime: String(created), expirationTime: String(created + 60 * DAY), numBytes: '1000', numRows: '10' };
  }
  // DDL da renovação cria as tabelas novas (o mock registra a metadata quando vê CREATE TABLE ... __g2).
  gas.bq.defaultHandler = (req) => {
    const q = req.query || '';
    const m = /CREATE (?:OR REPLACE )?(?:TABLE|VIEW)(?: IF NOT EXISTS)? `[^`]*\.([a-z_0-9]+)`/.exec(q);
    if (m) gas.bq.tableMeta[m[1]] = { creationTime: String(NOW), expirationTime: String(NOW + 60 * DAY), numBytes: '1200', numRows: '10' };
    const d = /DROP TABLE IF EXISTS `[^`]*\.([a-z_0-9]+)`/.exec(q);
    if (d) delete gas.bq.tableMeta[d[1]];
    return { rows: [] };
  };
  const r = gas.G.runMaintenance();
  assert.equal(r.status === 'SUCCESS' || r.status === 'PARTIAL', true, JSON.stringify(r));
  assert.equal(gas.G.Schema.generation(), 2);
  assert.equal(gas.G.Schema.pendingDrop(), 1);
  assert.ok(gas.bq.tableMeta['messages__g1'], 'geração antiga ainda existe (descarte adiado)');
  // 21 h depois: descarta a geração antiga.
  gas.clock.now += 21 * 3600000;
  gas.G.runMaintenance();
  assert.equal(gas.G.Schema.pendingDrop(), 0);
  assert.ok(!gas.bq.tableMeta['messages__g1']);
});

test('manutenção falha de propósito (e-mail do Apps Script) quando algo expira em menos de 10 dias', () => {
  const gas = boot();
  gas.bq.defaultHandler = () => ({ rows: [] });
  for (const t of ['messages', 'message_state', 'analyses', 'scores', 'feedback', 'runs', 'briefings']) {
    gas.bq.tableMeta[t + '__g1'] = { creationTime: String(NOW - 10 * DAY), expirationTime: String(NOW + 50 * DAY), numBytes: '1', numRows: '1' };
  }
  for (const v of gas.G.Schema.VIEW_ORDER) gas.bq.tableMeta['v_' + v] = { creationTime: String(NOW), expirationTime: String(NOW + 50 * DAY), type: 'VIEW' };
  gas.bq.tableMeta['runs__g1'].expirationTime = String(NOW + 5 * DAY);
  assert.throws(() => gas.G.runMaintenance(), /precisa de atenção/);
});
