'use strict';
/**
 * Serviços de leitura da interface: busca, validação de filtros, formatos de
 * saída (contratos v2) e briefing determinístico. BigQuery simulado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');

const NOW = Date.UTC(2026, 9, 24, 15, 0);
const J = (x) => JSON.parse(JSON.stringify(x));

function boot() {
  const gas = createGas({ fakeClock: NOW });
  gas.props.script.setProperty('GCP_PROJECT_ID', 'meu-projeto');
  gas.props.script.setProperty('OWNER_EMAIL', 'dono@gmail.com');
  gas.props.script.setProperty('SETUP_VERSION', '1');
  return gas;
}
function param(req, name) {
  const p = (req.queryParameters || []).find((x) => x.name === name);
  if (!p) return undefined;
  if (p.parameterType.type === 'ARRAY') return J((p.parameterValue.arrayValues || []).map((v) => v.value));
  return p.parameterValue.value;
}

test('busca: operadores de:, categoria: e "frase"; stopwords e limite de termos', () => {
  const { G } = boot();
  const q = G.SearchService.parseQuery('de:Ana.Souza@Exemplo.com categoria:carreira "Cientista de Dados" vaga de pricing remoto a o');
  assert.equal(q.sender, 'ana.souza@exemplo.com');
  assert.deepEqual(J(q.categories), ['carreira']);
  assert.deepEqual(J(q.terms), ['cientista de dados', 'vaga', 'pricing', 'remoto']);
  const many = G.SearchService.parseQuery('a1 b2 c3 d4 e5 f6 g7 h8 i9 j10');
  assert.equal(many.terms.length, 8);
  assert.deepEqual(J(G.SearchService.parseQuery("'; DROP TABLE x; --").terms), ['drop', 'table']);
});

test('busca vai como parâmetros @terms (nunca concatenada no SQL)', () => {
  const gas = boot();
  let seen = null;
  gas.bq.handlers.inbox_list = (req) => {
    seen = req;
    return { rows: [] };
  };
  const r = gas.G.apiSearch({ q: "contrato' OR 1=1 --" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!seen.query.includes('contrato'));
  assert.deepEqual(param(seen, 'terms'), ['contrato', '11'], 'stopword removida e pontuação descartada');
  assert.equal(param(seen, 'sort'), 'match');
});

test('lista: filtros fora da lista branca são descartados; paginação com hasMore', () => {
  const gas = boot();
  let seen = null;
  const rows = Array.from({ length: 31 }, (_, i) => ({ message_id: 'a' + String(i).padStart(5, '0'), subject: 'Assunto ' + i, display_level: 'HIGH', score: '0.6', received_date: '2026-10-20' }));
  gas.bq.handlers.inbox_list = (req) => {
    seen = req;
    return { rows };
  };
  const r = gas.G.apiListMessages({ filters: { categories: ['carreira', 'xss<script>'], levels: ['HIGH', 'ULTRA'], action: 'maybe', period: '90d', sender: 'ANA' }, sort: 'drop table', page: 1, pageSize: 30 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(param(seen, 'categories'), ['carreira']);
  assert.deepEqual(param(seen, 'levels'), ['HIGH']);
  assert.equal(param(seen, 'action'), '');
  assert.equal(param(seen, 'sort'), 'priority');
  assert.equal(param(seen, 'sender'), 'ana');
  assert.equal(param(seen, 'limit'), '31');
  assert.equal(r.data.items.length, 30);
  assert.equal(r.data.hasMore, true);
  const it = r.data.items[0];
  assert.equal(it.gmailUrl, 'https://mail.google.com/mail/u/0/#all/a00000');
  assert.equal(it.priority.level, 'HIGH');
});

test('detalhe: id inválido é recusado; links só http(s); trecho oculto quando a retenção expirou', () => {
  const gas = boot();
  assert.equal(gas.G.apiGetMessage({ id: '../../etc' }).error.code, 'VALIDATION');
  gas.bq.handlers.message_detail = () => ({
    rows: [{
      message_id: 'abc123', subject: 'Teste', retention_expired: 'false', body_excerpt: 'Olá', display_level: 'MEDIUM', score: '0.4',
      links_json: JSON.stringify([{ url: 'javascript:alert(1)', text: 'x' }, { url: 'https://ok.exemplo.com/a', text: 'ok' }]),
      actions_json: JSON.stringify([{ id: 'act1', description: 'Responder', owner: 'me', due_date: '2026-10-30', due_certainty: 'EXPLICIT' }]),
      components_json: JSON.stringify([{ key: 'urgency', label: 'Urgência', value: 0.5, weight: 0.18, contribution: 0.09, why: 'Prazo explícito em 6 dias' }]),
      unsubscribe_url: 'mailto:sair@exemplo.com', history: [],
    }],
    fields: [{ name: 'message_id', type: 'STRING' }, { name: 'subject', type: 'STRING' }, { name: 'retention_expired', type: 'BOOL' }, { name: 'body_excerpt', type: 'STRING' },
      { name: 'display_level', type: 'STRING' }, { name: 'score', type: 'FLOAT64' }, { name: 'links_json', type: 'STRING' }, { name: 'actions_json', type: 'STRING' },
      { name: 'components_json', type: 'STRING' }, { name: 'unsubscribe_url', type: 'STRING' }, { name: 'history', type: 'STRING', mode: 'REPEATED' }],
  });
  gas.bq.handlers.actions_for_message = () => ({ rows: [{ action_id: 'act1', status: 'AUTO_REPLIED' }] });
  const r = gas.G.apiGetMessage({ id: 'abc123' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(J(r.data.links.map((l) => l.url)), ['https://ok.exemplo.com/a']);
  assert.equal(r.data.unsubscribeUrl, '');
  assert.equal(r.data.excerpt, 'Olá');
  assert.equal(r.data.actions[0].status, 'AUTO_REPLIED');
  assert.match(r.data.actions[0].statusLabel, /respondeu/);
  assert.equal(r.data.priority.top[0].why, 'Prazo explícito em 6 dias');
});

test('radar: KPIs com período anterior, briefing por regras quando não há IA, nada de Date no retorno', () => {
  const gas = boot();
  gas.bq.handlers.radar = (req) => {
    assert.equal(param(req, 'start'), '2026-10-18');
    assert.equal(param(req, 'prev_start'), '2026-10-11');
    return {
      rows: [{
        kpis: { received: 20, attention: 3, actions: 4, opportunities: 1, newsletters: 6, noise: 5, triaged_unread: 8, rules_only: 20 },
        kpis_prev: { received: 16, attention: 2, actions: 3 },
        attention: [{ message_id: 'aa11', subject: 'Contrato para assinar', display_level: 'CRITICAL', score: 0.8, primary_category: 'tarefas',
          components_json: JSON.stringify([{ label: 'Ação', why: 'Pede uma ação sua diretamente', contribution: 0.18 }]) }],
        news: [], topics: [{ topic: 'pricing', n: 3 }], by_category: [{ category: 'contas', n: 4 }], by_category_prev: [{ category: 'contas', n: 2 }],
        tasks: [{ action_id: 't1', message_id: 'aa11', description: 'Assinar contrato', due_date: '2026-10-25', status: 'OPEN', priority_level: 'CRITICAL' }],
        opportunities: [], since_last_visit: 2, briefing: null,
      }],
      fields: [{ name: 'kpis', type: 'RECORD', fields: ['received', 'attention', 'actions', 'opportunities', 'newsletters', 'noise', 'triaged_unread', 'rules_only'].map((n) => ({ name: n, type: 'INT64' })) },
        { name: 'kpis_prev', type: 'RECORD', fields: ['received', 'attention', 'actions'].map((n) => ({ name: n, type: 'INT64' })) },
        { name: 'attention', type: 'RECORD', mode: 'REPEATED', fields: [{ name: 'message_id', type: 'STRING' }, { name: 'subject', type: 'STRING' }, { name: 'display_level', type: 'STRING' }, { name: 'score', type: 'FLOAT64' }, { name: 'primary_category', type: 'STRING' }, { name: 'components_json', type: 'STRING' }] },
        { name: 'news', type: 'RECORD', mode: 'REPEATED', fields: [{ name: 'message_id', type: 'STRING' }] },
        { name: 'topics', type: 'RECORD', mode: 'REPEATED', fields: [{ name: 'topic', type: 'STRING' }, { name: 'n', type: 'INT64' }] },
        { name: 'by_category', type: 'RECORD', mode: 'REPEATED', fields: [{ name: 'category', type: 'STRING' }, { name: 'n', type: 'INT64' }] },
        { name: 'by_category_prev', type: 'RECORD', mode: 'REPEATED', fields: [{ name: 'category', type: 'STRING' }, { name: 'n', type: 'INT64' }] },
        { name: 'tasks', type: 'RECORD', mode: 'REPEATED', fields: [{ name: 'action_id', type: 'STRING' }, { name: 'message_id', type: 'STRING' }, { name: 'description', type: 'STRING' }, { name: 'due_date', type: 'DATE' }, { name: 'status', type: 'STRING' }, { name: 'priority_level', type: 'STRING' }] },
        { name: 'opportunities', type: 'RECORD', mode: 'REPEATED', fields: [{ name: 'opp_key', type: 'STRING' }] },
        { name: 'since_last_visit', type: 'INT64' },
        { name: 'briefing', type: 'RECORD', fields: [{ name: 'content_json', type: 'STRING' }] }],
    };
  };
  const r = gas.G.apiGetRadar({ period: '7d' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const d = r.data;
  assert.equal(d.kpis.received, 20);
  assert.equal(d.kpis.receivedPrev, 16);
  assert.equal(d.kpis.noisePct, 25);
  assert.equal(d.kpis.triage.count, 8);
  assert.equal(d.briefing.method, 'RULES');
  assert.match(d.briefing.headline, /20 mensagens/);
  assert.ok(d.briefing.bullets.some((b) => b.refs.includes('aa11')));
  assert.equal(d.attention[0].priority.level, 'CRITICAL');
  assert.deepEqual(J(d.categories[0]), { id: 'contas', label: 'Contas, cobranças e documentos', count: 4, countPrev: 2 });
  assert.ok(!JSON.stringify(d).includes('"_cached"'));
  // Segunda chamada no mesmo intervalo vem do cache versionado.
  const r2 = gas.G.apiGetRadar({ period: '7d' });
  assert.equal(r2.meta.cached, true);
  gas.G.Repository.bumpDataVersion();
  assert.equal(gas.G.apiGetRadar({ period: '7d' }).meta.cached, false);
});

test('configurações: só campos editáveis; retenção alterada marca views para recriação', () => {
  const gas = boot();
  const bad = gas.G.apiSaveSettings({ patch: { pipeline: { maxRuntimeMs: 1 } } });
  assert.equal(bad.ok, true);
  assert.equal(bad.data.saved, false);
  const out = gas.G.apiSaveSettings({ patch: { storage: { excerptRetentionDays: 15 }, profile: { interests: ['pricing', ' pricing ', 'python'] } } });
  assert.equal(out.data.saved, true, JSON.stringify(out));
  assert.equal(gas.G.Config.get().storage.excerptRetentionDays, 15);
  assert.deepEqual(J(gas.G.Config.get().profile.interests), ['pricing', 'python']);
  assert.equal(gas.props.script.getProperty('VIEWS_DIRTY'), '1');
  const s = gas.G.apiGetSettings();
  assert.equal(s.ok, true);
  assert.equal(s.data.secrets.projectId, true);
  assert.equal(s.data.secrets.anthropicKey, false);
  assert.ok(!JSON.stringify(s.data).includes('meu-projeto'), 'valores de segredos não saem');
});

test('consentimento de IA: registra, limita ao provedor e revoga', () => {
  const gas = boot();
  assert.equal(gas.G.apiSetAiConsent({ policy: 'REDACTED', accept: true }).ok, false, 'sem chave não há provedor');
  gas.props.script.setProperty('GEMINI_API_KEY', 'chave-falsa');
  const full = gas.G.apiSetAiConsent({ policy: 'FULL', accept: true });
  assert.equal(full.ok, false, 'Gemini gratuito só permite BROADCAST');
  const ok = gas.G.apiSetAiConsent({ policy: 'BROADCAST', accept: true });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.data.policy, 'BROADCAST');
  const off = gas.G.apiSetAiConsent({ accept: false });
  assert.equal(off.data.policy, 'OFF');
});
