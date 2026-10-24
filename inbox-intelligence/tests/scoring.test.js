'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');

const TODAY = '2026-10-21';

function gas() {
  return createGas({ files: ['Util.js', 'Config.js', 'Scoring.js'] });
}

function base(over) {
  return Object.assign({
    category: 'outros', isNoise: false, confidence: 0.8, importance: 0.3, deadline: null, urgencyNoDeadline: 0,
    urgencyTrust: 1, action: 0, opportunity: 0, sender: 0.4, senderKind: 'human', isPrioritySender: false,
    novelty: 1, interest: 0, reliability: 1, noise: 1,
  }, over);
}

test('casos do plano (seção 9): scores e níveis batem com a conta manual', () => {
  const { G } = gas();
  const promo = G.Scoring.compute(base({ category: 'marketing', isNoise: true, importance: 0.21, deadline: { date: '2026-10-22', certainty: 'INFERRED' }, urgencyTrust: 0.1, sender: 0.15, senderKind: 'automated', noise: 0.4 }), null, TODAY);
  const recruiter = G.Scoring.compute(base({ category: 'carreira', importance: 0.74, urgencyNoDeadline: 0.3, action: 1, opportunity: 0.8, sender: 0.4, interest: 0.5 }), null, TODAY);
  const bill = G.Scoring.compute(base({ category: 'contas', importance: 0.71, deadline: { date: TODAY, certainty: 'EXPLICIT' }, action: 1, sender: 0.15, senderKind: 'automated' }), null, TODAY);
  const boss = G.Scoring.compute(base({ category: 'trabalho', importance: 0.91, deadline: { date: TODAY, certainty: 'EXPLICIT' }, action: 1, sender: 1, senderKind: 'priority', isPrioritySender: true }), null, TODAY);

  // Promo: (0,28·0,21 + 0,18·(0,72·0,6·0,1) + 0,10·0,15 + 0,04) × 0,4 ≈ 0,05
  assert.ok(Math.abs(promo.score - 0.0505) < 0.003, 'promo ' + promo.score);
  assert.equal(promo.level, 'LOW');
  assert.ok(Math.abs(recruiter.score - 0.6672) < 0.002, 'recrutador ' + recruiter.score);
  assert.equal(recruiter.level, 'HIGH');
  assert.ok(Math.abs(bill.score - 0.6138) < 0.002, 'boleto ' + bill.score);
  assert.equal(bill.level, 'HIGH');
  assert.ok(Math.abs(boss.score - 0.7548) < 0.002, 'prioritário ' + boss.score);
  assert.equal(boss.level, 'CRITICAL');
});

test('urgência ≠ importância: promoção com prazo amanhã nunca supera oportunidade relevante', () => {
  const { G } = gas();
  const promo = G.Scoring.compute(base({ category: 'marketing', isNoise: true, importance: 0.1, deadline: { date: '2026-10-22', certainty: 'EXPLICIT' }, urgencyTrust: 0.1, sender: 0.15, noise: 0.4 }), null, TODAY);
  const job = G.Scoring.compute(base({ category: 'carreira', importance: 0.7, opportunity: 0.7, sender: 0.4, interest: 0.5 }), null, TODAY);
  assert.ok(job.score > promo.score * 3, `job ${job.score} vs promo ${promo.score}`);
});

test('crítica exige gatilho: score alto sem ação nem prazo não vira crítica', () => {
  const { G } = gas();
  const r = G.Scoring.compute(base({ importance: 1, opportunity: 0.7, sender: 1, senderKind: 'knownContact', interest: 1 }), null, TODAY);
  assert.notEqual(r.level, 'CRITICAL');
  assert.equal(r.gate.critical, false);
});

test('crítica bloqueada por baixa confiança e por categoria de ruído', () => {
  const { G } = gas();
  const f = base({ importance: 0.95, deadline: { date: TODAY, certainty: 'EXPLICIT' }, action: 1, sender: 1, isPrioritySender: true, senderKind: 'priority' });
  assert.equal(G.Scoring.compute(f, null, TODAY).level, 'CRITICAL');
  assert.notEqual(G.Scoring.compute(Object.assign({}, f, { confidence: 0.4 }), null, TODAY).level, 'CRITICAL');
  assert.notEqual(G.Scoring.compute(Object.assign({}, f, { isNoise: true }), null, TODAY).level, 'CRITICAL');
});

test('fator de prazo: hoje=1, decai, vencido recente 0,7, vencido antigo 0,1', () => {
  const { G } = gas();
  const sc = G.Config.DEFAULTS.scoring;
  assert.equal(G.Scoring.deadlineFactor(0, sc), 1);
  assert.ok(Math.abs(G.Scoring.deadlineFactor(1, sc) - Math.exp(-1 / 3)) < 1e-9);
  assert.ok(G.Scoring.deadlineFactor(7, sc) < 0.11);
  assert.equal(G.Scoring.deadlineFactor(-2, sc), 0.7);
  assert.equal(G.Scoring.deadlineFactor(-10, sc), 0.1);
});

test('prazo inferido pesa menos que explícito', () => {
  const { G } = gas();
  const e = G.Scoring.compute(base({ deadline: { date: '2026-10-22', certainty: 'EXPLICIT' } }), null, TODAY);
  const i = G.Scoring.compute(base({ deadline: { date: '2026-10-22', certainty: 'INFERRED' } }), null, TODAY);
  assert.ok(e.urgency > i.urgency);
  assert.match(e.components.find((c) => c.key === 'urgency').why, /explícito amanhã/);
});

test('componentes explicados: soma das contribuições × multiplicadores = score', () => {
  const { G } = gas();
  const f = base({ importance: 0.6, action: 0.6, interest: 0.5, reliability: 0.4, noise: 0.85 });
  const r = G.Scoring.compute(f, null, TODAY);
  const raw = r.components.filter((c) => c.weight > 0).reduce((s, c) => s + c.contribution, 0);
  assert.ok(Math.abs(raw * (0.6 + 0.4 * 0.4) * 0.85 - r.score) < 0.001);
  assert.ok(r.components.some((c) => c.key === 'reliability'));
  assert.ok(r.components.some((c) => c.key === 'noise'));
  assert.equal(G.Scoring.topReasons(r).length, 3);
});

test('features: prioridade de remetente, contato conhecido, afinidade e duplicidade', () => {
  const { G } = gas();
  const parsed = { from_email: 'chefe@empresa.com.br', from_domain: 'empresa.com.br', user_in_to: true, is_bulk: false, is_automated: false, auth_pass: true, content_hash: 'h1', subject: 'Preciso disso urgente' };
  const merged = { method: 'RULES', primary_category: 'trabalho', secondary_categories: [], action_required: true, actions: [], confidence: 0.7, interest_score: 0 };
  const cfg = G.Config.get();
  let f = G.Scoring.features(parsed, merged, { profile: Object.assign({}, cfg.profile, { prioritySenderDomains: ['empresa.com.br'] }), knownContacts: {}, senderAffinity: {} });
  assert.equal(f.senderKind, 'priority');
  assert.equal(f.isPrioritySender, true);
  assert.equal(f.action, 1);
  assert.ok(f.urgencyNoDeadline > 0, 'palavra "urgente" gera urgência sem prazo');
  f = G.Scoring.features(parsed, merged, { profile: cfg.profile, knownContacts: { 'chefe@empresa.com.br': true }, senderAffinity: { 'chefe@empresa.com.br': -1 }, duplicateHashes: { h1: true } });
  assert.equal(f.senderKind, 'knownContact');
  assert.ok(Math.abs(f.sender - 0.6) < 1e-9);
  assert.equal(f.novelty, 0.3);
});

test('features: IA ancorada no prior da categoria', () => {
  const { G } = gas();
  const f = G.Scoring.features({ from_email: 'x@y.com' }, { method: 'AI', primary_category: 'marketing', importance: 5, urgency: 5, confidence: 0.9 }, { profile: G.Config.get().profile, knownContacts: {}, senderAffinity: {} });
  // 0,7·1 + 0,3·0,1 = 0,73 — mesmo com importância 5 a IA não leva marketing a 1
  assert.ok(Math.abs(f.importance - 0.73) < 1e-9);
  assert.equal(f.isNoise, true);
});

test('modo só-regras: boleto vencendo hoje (banco, automático) é Alta', () => {
  const { G } = gas();
  const cfg = G.Config.get();
  const parsed = { from_email: 'faturas@banco-exemplo.com.br', from_domain: 'banco-exemplo.com.br', user_in_to: true, is_bulk: false, is_automated: true, auth_pass: true, gmail_category: 'UPDATES', label_ids: ['INBOX', 'UNREAD', 'CATEGORY_UPDATES'] };
  const merged = { method: 'RULES', primary_category: 'contas', secondary_categories: [], action_required: true, actions: [{ owner: 'me' }], deadline: { date: TODAY, certainty: 'EXPLICIT' }, confidence: 0.8, interest_score: 0 };
  const f = G.Scoring.features(parsed, merged, { profile: cfg.profile, knownContacts: {}, senderAffinity: {} });
  const r = G.Scoring.compute(f, null, TODAY);
  assert.equal(r.level, 'HIGH', 'score ' + r.score);
  assert.ok(r.axes.urgency >= 0.99 && r.axes.action >= 0.99);
});

test('modo só-regras: pedido de remetente prioritário para hoje é elegível a crítica', () => {
  const { G } = gas();
  const cfg = G.Config.get();
  const parsed = { from_email: 'diretora@empresa.com.br', from_domain: 'empresa.com.br', user_in_to: true, is_bulk: false, is_automated: false, auth_pass: true, gmail_category: 'PERSONAL', label_ids: ['INBOX', 'IMPORTANT'] };
  const merged = { method: 'RULES', primary_category: 'tarefas', secondary_categories: ['trabalho'], action_required: true, actions: [{ owner: 'me' }], deadline: { date: TODAY, certainty: 'EXPLICIT' }, confidence: 0.75, interest_score: 0 };
  const f = G.Scoring.features(parsed, merged, { profile: Object.assign({}, cfg.profile, { prioritySenders: ['diretora@empresa.com.br'] }), knownContacts: { 'diretora@empresa.com.br': true }, senderAffinity: {} });
  const r = G.Scoring.compute(f, null, TODAY);
  assert.equal(r.level, 'CRITICAL', 'score ' + r.score);
  assert.ok(r.gate.reasons.length >= 1);
});

test('modo só-regras: promoção com prazo e newsletter de IA ficam baixas na fila de atenção', () => {
  const { G } = gas();
  const cfg = G.Config.get();
  const ctx = { profile: cfg.profile, knownContacts: {}, senderAffinity: {} };
  const promo = G.Scoring.compute(G.Scoring.features(
    { from_email: 'ofertas@loja.com.br', is_bulk: true, is_automated: true, has_list_unsubscribe: true, list_id: 'ofertas', gmail_category: 'PROMOTIONS', auth_pass: true },
    { method: 'RULES', primary_category: 'marketing', is_marketing: true, deadline: { date: '2026-10-22', certainty: 'INFERRED' }, confidence: 0.9, interest_score: 0 }, ctx), null, TODAY);
  const news = G.Scoring.compute(G.Scoring.features(
    { from_email: 'news@newsletter-ia.com', is_bulk: true, is_automated: true, has_list_unsubscribe: true, list_id: 'ia', gmail_category: 'UPDATES', auth_pass: true },
    { method: 'RULES', primary_category: 'tecnologia', secondary_categories: ['newsletters'], is_newsletter: true, confidence: 0.8, interest_score: 1 }, ctx), null, TODAY);
  assert.equal(promo.level, 'LOW');
  assert.ok(['LOW', 'MEDIUM'].includes(news.level));
  assert.ok(news.info_score > promo.info_score, 'a newsletter relevante sobe em "Novidades"');
  // newsletter de IA herda o ruído do formato (0,85), não o do tema (1,0)
  assert.ok(news.components.some((c) => c.key === 'noise'));
});

test('remetente não autenticado: nunca passa de Média e não é elegível a crítica', () => {
  const { G } = gas();
  const f = base({ importance: 0.95, deadline: { date: TODAY, certainty: 'EXPLICIT' }, action: 1, sender: 1, isPrioritySender: true, senderKind: 'priority', untrusted: true });
  const r = G.Scoring.compute(f, null, TODAY);
  assert.equal(r.level, 'MEDIUM');
  assert.equal(r.gate.critical, false);
});

test('feedback "irrelevante" e correção de categoria prevalecem', () => {
  const { G } = gas();
  const cfg = G.Config.get();
  const parsed = { from_email: 'x@y.com', is_automated: false, user_in_to: true };
  const merged = { method: 'RULES', primary_category: 'carreira', action_required: true, actions: [], confidence: 0.8, interest_score: 0.5 };
  const f1 = G.Scoring.features(parsed, merged, { profile: cfg.profile, knownContacts: {}, senderAffinity: {}, override: { irrelevant: true } });
  assert.equal(G.Scoring.compute(f1, null, TODAY).level, 'LOW');
  const f2 = G.Scoring.features(parsed, merged, { profile: cfg.profile, knownContacts: {}, senderAffinity: {}, override: { category: 'marketing' } });
  assert.equal(f2.category, 'marketing');
  assert.equal(f2.isNoise, true);
});

test('eixos: urgente sem importância e importante sem urgência ficam separados', () => {
  const { G } = gas();
  const urgent = G.Scoring.compute(base({ importance: 0.15, deadline: { date: TODAY, certainty: 'EXPLICIT' } }), null, TODAY);
  const important = G.Scoring.compute(base({ importance: 0.9, interest: 1 }), null, TODAY);
  assert.equal(G.Scoring.axisLabel(urgent.axes.urgency), 'ALTA');
  assert.equal(G.Scoring.axisLabel(important.axes.urgency), 'BAIXA');
  assert.equal(G.Scoring.axisLabel(important.axes.relevance), 'ALTA');
  assert.notEqual(G.Scoring.axisLabel(urgent.axes.relevance), 'ALTA');
});

test('urgência sem prazo tem teto (0,5) mesmo com urgência máxima da IA', () => {
  const { G } = gas();
  const f = G.Scoring.features({ from_email: 'a@b.com' }, { method: 'AI', primary_category: 'trabalho', importance: 3, urgency: 5, confidence: 0.8 }, { profile: G.Config.get().profile, knownContacts: {}, senderAffinity: {} });
  assert.ok(f.urgencyNoDeadline <= 0.5);
});

test('triagem: estimativa em faixa, com fórmula declarada', () => {
  const { G } = gas();
  const t = G.Scoring.triageEstimate(120);
  assert.deepEqual([t.minMinutes, t.maxMinutes], [10, 30]);
  assert.match(t.formula, /triagem/);
});
