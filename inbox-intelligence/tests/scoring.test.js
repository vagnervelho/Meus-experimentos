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

test('remetente não autenticado: nunca passa de Média (nível e score) e não é elegível a crítica', () => {
  const { G } = gas();
  const th = G.Config.DEFAULTS.scoring.thresholds;
  const f = base({ importance: 0.95, deadline: { date: TODAY, certainty: 'EXPLICIT' }, action: 1, sender: 1, isPrioritySender: true, senderKind: 'priority', untrusted: true });
  const r = G.Scoring.compute(f, null, TODAY);
  assert.equal(r.level, 'MEDIUM');
  assert.equal(r.gate.critical, false);
  // O score também fica abaixo do limiar de Alta: não ordena acima de Altas legítimas.
  assert.ok(r.score <= th.high - 0.001 + 1e-9, 'score ' + r.score);
  const cap = r.components.find((c) => c.key === 'untrusted');
  assert.ok(cap && cap.contribution < 0, 'teto explicado com o corte aplicado');
});

test('feedback "irrelevante" e correção de categoria prevalecem', () => {
  const { G } = gas();
  const cfg = G.Config.get();
  const parsed = { from_email: 'x@y.com', is_automated: false, user_in_to: true };
  const merged = { method: 'RULES', primary_category: 'carreira', action_required: true, actions: [], confidence: 0.8, interest_score: 0.5 };
  const f1 = G.Scoring.features(parsed, merged, { profile: cfg.profile, knownContacts: {}, senderAffinity: {}, override: { irrelevant: true } });
  assert.equal(G.Scoring.compute(f1, null, TODAY).level, 'LOW');
  // "Irrelevante" limita também o score (abaixo de Média), inclusive no reescore por applyOverride.
  const th = cfg.scoring.thresholds;
  const strong = base({ importance: 1, deadline: { date: TODAY, certainty: 'EXPLICIT' }, action: 1, sender: 1, senderKind: 'priority', isPrioritySender: true });
  const r1 = G.Scoring.compute(G.Scoring.applyOverride(strong, { irrelevant: true }), null, TODAY);
  assert.equal(r1.level, 'LOW');
  assert.equal(r1.gate.critical, false);
  assert.ok(r1.score <= th.medium - 0.001 + 1e-9, 'score ' + r1.score);
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

// ------------------------------------------------------------------------------------------
// Contrato novo: untrusted / injection / severity, pisos (pedido direto, gravidade) e tetos.
// ------------------------------------------------------------------------------------------
function ctxOf(G, over) {
  return Object.assign({ profile: G.Config.get().profile, knownContacts: {}, senderAffinity: {} }, over);
}
const PERSON = { from_email: 'ana@exemplo.com.br', from_domain: 'exemplo.com.br', user_in_to: true, is_bulk: false, is_automated: false, auth_pass: true, gmail_category: 'PERSONAL', label_ids: ['INBOX'] };
const ROBOT = { from_email: 'naoresponda@orgao.exemplo.br', from_domain: 'orgao.exemplo.br', user_in_to: true, is_bulk: false, is_automated: true, auth_pass: true, gmail_category: 'UPDATES', label_ids: ['INBOX'] };
function request(over) {
  return Object.assign({ method: 'RULES', primary_category: 'outros', secondary_categories: [], action_required: true,
    actions: [{ description: 'Você consegue me mandar o arquivo?', owner: 'me' }], deadline: { date: '2026-10-22', certainty: 'EXPLICIT', time: '' },
    confidence: 0.7, interest_score: 0 }, over);
}

test('pesos somam 1 e TRANSACTIONAL do ranking é a mesma lista do classificador', () => {
  const { G } = createGas({ files: ['Util.js', 'Config.js', 'Extractors.js', 'RulesClassifier.js', 'Scoring.js'] });
  const w = G.Config.DEFAULTS.scoring.weights;
  assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(JSON.stringify(G.Scoring.TRANSACTIONAL.slice().sort()), JSON.stringify(G.RulesClassifier.TRANSACTIONAL.slice().sort()));
});

test('untrusted do classificador (imitação, Reply-To) e injection limitam nível e score a Média', () => {
  const { G } = gas();
  const th = G.Config.DEFAULTS.scoring.thresholds;
  const ctx = ctxOf(G, { profile: Object.assign({}, G.Config.get().profile, { prioritySenders: [PERSON.from_email] }) });
  const legit = G.Scoring.compute(G.Scoring.features(PERSON, request({ primary_category: 'trabalho', deadline: { date: TODAY, certainty: 'EXPLICIT' } }), ctx), null, TODAY);
  assert.equal(legit.level, 'CRITICAL');
  // Autenticação passa, mas o classificador viu imitação de nome de exibição.
  const spoofF = G.Scoring.features(PERSON, request({ primary_category: 'trabalho', untrusted: true, spoof_signals: ['DISPLAY_NAME_IMPERSONATION'], deadline: { date: TODAY, certainty: 'EXPLICIT' } }), ctx);
  assert.equal(spoofF.untrusted, true);
  assert.ok(spoofF.reliability <= 0.4, 'imitação equivale a autenticação falha');
  const spoof = G.Scoring.compute(spoofF, null, TODAY);
  assert.equal(spoof.level, 'MEDIUM');
  assert.equal(spoof.gate.critical, false);
  assert.ok(spoof.score < th.high && spoof.score < legit.score);
  assert.match(spoof.components.find((c) => c.key === 'untrusted').why, /imitação/);
  // Suspeita de injection (inclusive em texto oculto) tem o mesmo teto, com justificativa própria.
  const injF = G.Scoring.features(PERSON, request({ primary_category: 'trabalho', injection: { suspected: true, signals: ['HIDDEN_INSTRUCTION'] }, deadline: { date: TODAY, certainty: 'EXPLICIT' } }), ctx);
  assert.equal(injF.untrusted, true);
  assert.equal(injF.injection, true);
  const inj = G.Scoring.compute(injF, null, TODAY);
  assert.equal(inj.level, 'MEDIUM');
  assert.ok(inj.score <= th.high - 0.001 + 1e-9);
  assert.match(inj.components.find((c) => c.key === 'untrusted').why, /injection/);
});

test('mínimo de newsletter (ruído e confiança de urgência) não se aplica a categoria transacional', () => {
  const { G } = gas();
  const parsed = { from_email: 'cobranca@servico.exemplo.com', is_bulk: true, is_automated: true, has_list_unsubscribe: true, list_id: 'avisos', auth_pass: true };
  const bill = G.Scoring.features(parsed, { method: 'RULES', primary_category: 'contas', is_newsletter: true, confidence: 0.8 }, ctxOf(G));
  assert.equal(bill.noise, 1);
  assert.equal(bill.urgencyTrust, 1);
  assert.equal(bill.isNewsletter, false);
  const news = G.Scoring.features(parsed, { method: 'RULES', primary_category: 'tecnologia', is_newsletter: true, confidence: 0.8 }, ctxOf(G));
  assert.equal(news.noise, G.Config.category('newsletters').noise);
  assert.equal(news.urgencyTrust, G.Config.category('newsletters').urgencyTrust);
  assert.equal(news.isNewsletter, true);
});

test('pedido direto de pessoa com prazo até amanhã: no mínimo Alta; de contato conhecido, Crítica', () => {
  const { G } = gas();
  const th = G.Config.DEFAULTS.scoring.thresholds;
  // Desconhecido, categoria de prior baixo: a soma ponderada fica em Média, o piso leva a Alta.
  const fU = G.Scoring.features(PERSON, request(), ctxOf(G));
  assert.equal(fU.directRequest, true);
  const u = G.Scoring.compute(fU, null, TODAY);
  assert.equal(u.level, 'HIGH');
  assert.ok(Math.abs(u.score - th.high) < 1e-9, 'score sobe só até o limiar: ' + u.score);
  assert.match(u.components.find((c) => c.key === 'floor').why, /no mínimo Alta/);
  assert.equal(u.gate.critical, false);
  // Contato conhecido pedindo algo social ("confirma se você vem?"): piso Alta, sem atalho para Crítica.
  const social = G.Scoring.compute(G.Scoring.features(PERSON, request(), ctxOf(G, { knownContacts: { [PERSON.from_email]: true } })), null, TODAY);
  assert.equal(social.level, 'HIGH');
  // Mesmo pedido de contato conhecido sobre uma obrigação (trabalho): Crítica (score no limiar de Crítica).
  const k = G.Scoring.compute(G.Scoring.features(PERSON, request({ primary_category: 'trabalho' }), ctxOf(G, { knownContacts: { [PERSON.from_email]: true } })), null, TODAY);
  assert.equal(k.level, 'CRITICAL');
  assert.ok(k.score >= th.critical);
  assert.ok(k.gate.reasons.some((x) => /contato conhecido com prazo até amanhã/.test(x)));
  // Confiança baixa mantém a regra de Crítica: fica em Alta.
  const low = G.Scoring.compute(G.Scoring.features(PERSON, request({ confidence: 0.4, primary_category: 'trabalho' }), ctxOf(G, { knownContacts: { [PERSON.from_email]: true } })), null, TODAY);
  assert.equal(low.level, 'HIGH');
  // Consequência séria (gravidade ≥ 0,5) também abre a Crítica para pessoa desconhecida.
  const sev = G.Scoring.compute(G.Scoring.features(PERSON, request({ severity: 0.5 }), ctxOf(G)), null, TODAY);
  assert.equal(sev.level, 'CRITICAL');
  // "Hoje até 15h": data relativa com horário é prazo concreto; "hoje" sem horário (inferido) não basta.
  const timed = G.Scoring.compute(G.Scoring.features(PERSON, request({ deadline: { date: TODAY, certainty: 'INFERRED', time: '15:00' } }), ctxOf(G)), null, TODAY);
  assert.equal(timed.level, 'HIGH');
  const vague = G.Scoring.compute(G.Scoring.features(PERSON, request({ deadline: { date: TODAY, certainty: 'INFERRED', time: '' } }), ctxOf(G)), null, TODAY);
  assert.equal(vague.components.some((c) => c.key === 'floor'), false);
});

test('piso do pedido direto não vale para automático, cópia, prazo distante, marketing ou newsletter', () => {
  const { G } = gas();
  const known = ctxOf(G, { knownContacts: { [PERSON.from_email]: true, [ROBOT.from_email]: true } });
  const noFloor = (parsed, merged) => {
    const r = G.Scoring.compute(G.Scoring.features(parsed, merged, known), null, TODAY);
    assert.equal(r.components.some((c) => c.key === 'floor'), false, JSON.stringify(r.gate));
    assert.notEqual(r.level, 'CRITICAL');
    return r;
  };
  noFloor(ROBOT, request());
  noFloor(Object.assign({}, PERSON, { user_in_to: false }), request());
  noFloor(PERSON, request({ deadline: { date: '2026-10-24', certainty: 'EXPLICIT' } }));
  assert.equal(noFloor(PERSON, request({ is_marketing: true })).level, 'LOW');
  noFloor(PERSON, request({ primary_category: 'tecnologia', is_newsletter: true }));
  noFloor(Object.assign({}, PERSON, { auth_fail: true, auth_pass: false }), request());
});

test('notificação automática séria: Média pela gravidade; Alta só se grave e com ação não condicional', () => {
  const { G } = gas();
  const th = G.Config.DEFAULTS.scoring.thresholds;
  const sc = G.Config.DEFAULTS.scoring;
  const notice = (over) => G.Scoring.compute(G.Scoring.features(ROBOT, Object.assign({ method: 'RULES', primary_category: 'seguranca_conta', confidence: 0.9, interest_score: 0 }, over), ctxOf(G)), null, TODAY);
  // Novo login (gravidade 0,7) sem ação: Média.
  const login = notice({ severity: 0.7 });
  assert.equal(login.level, 'MEDIUM');
  assert.match(login.components.find((c) => c.key === 'floor').why, /Notificação séria/);
  // "Se não foi você, …" é condicional: continua Média.
  const cond = notice({ severity: 0.7, action_required: true, actions: [{ description: 'Se não foi você, altere sua senha imediatamente.', owner: 'me' }] });
  assert.equal(cond.level, 'MEDIUM');
  const condEn = notice({ severity: 0.7, action_required: true, actions: [{ description: "If this wasn't you, reset your password.", owner: 'me' }] });
  assert.equal(condEn.level, 'MEDIUM');
  // Em segurança da conta toda ação é condicional por construção do classificador (frase extraída à parte).
  const secAct = notice({ severity: 0.7, action_required: true, actions: [{ description: 'Revise os dispositivos conectados.', owner: 'me' }] });
  assert.equal(secAct.level, 'MEDIUM');
  // Obrigação grave (governo/jurídico) com ação incondicional: Alta, no limiar.
  const gov = notice({ primary_category: 'governo_juridico', severity: 0.7, action_required: true, actions: [{ description: 'Consulte as pendências da declaração e envie a retificadora.', owner: 'me' }] });
  assert.equal(gov.level, 'HIGH');
  assert.ok(gov.score >= th.high && gov.score < th.critical);
  assert.equal(gov.gate.critical, false, 'automático sem gatilho nunca é Crítica');
  // Gravidade abaixo da classe "séria" (viagem iminente 0,4, código 0,2): sem piso.
  assert.equal(notice({ severity: 0.4 }).components.some((c) => c.key === 'floor'), false);
  // Bônus de importância = severityBonus × gravidade (no modo IA, metade, como os demais bônus positivos).
  const imp = (sev, method) => G.Scoring.features(ROBOT, { method: method || 'RULES', importance: 3, primary_category: 'saude', severity: sev, confidence: 0.9 }, ctxOf(G)).importance;
  assert.ok(Math.abs(imp(0.6) - imp(0) - sc.severityBonus * 0.6) < 1e-9);
  assert.ok(Math.abs(imp(0.6, 'AI') - imp(0, 'AI') - 0.5 * sc.severityBonus * 0.6) < 1e-9);
  // Mensagem não confiável não tem gravidade nem piso.
  const fake = G.Scoring.features(Object.assign({}, ROBOT, { auth_fail: true, auth_pass: false }), { method: 'RULES', primary_category: 'governo_juridico', severity: 0.7, confidence: 0.9 }, ctxOf(G));
  assert.equal(fake.severity, 0);
  assert.equal(G.Scoring.compute(fake, null, TODAY).components.some((c) => c.key === 'floor'), false);
});

test('consequência séria + ação + prazo explícito é gatilho de Crítica, mas ainda exige score alto', () => {
  const { G } = gas();
  const f = base({ category: 'carreira', importance: 0.95, deadline: { date: '2026-10-24', certainty: 'EXPLICIT' }, action: 1, opportunity: 0.95, interest: 0.5 });
  assert.equal(G.Scoring.compute(f, null, TODAY).level, 'HIGH', 'sem gravidade: prazo em 3 dias não abre gatilho');
  const r = G.Scoring.compute(Object.assign({}, f, { severity: 0.5 }), null, TODAY);
  assert.equal(r.level, 'CRITICAL');
  assert.ok(r.gate.reasons.indexOf('Consequência séria com ação e prazo explícito') >= 0);
  // Mesmo gatilho com score baixo (notificação automática) não vira Crítica.
  const weak = G.Scoring.compute(base({ importance: 0.6, severity: 0.5, deadline: { date: '2026-10-24', certainty: 'EXPLICIT' }, action: 1, sender: 0.15, senderKind: 'automated' }), null, TODAY);
  assert.notEqual(weak.level, 'CRITICAL');
});

test('features antigas (sem campos novos) reescoram sem pisos nem tetos novos', () => {
  const { G } = gas();
  const r = G.Scoring.compute(base({ importance: 0.6, action: 1, deadline: { date: '2026-10-22', certainty: 'EXPLICIT' } }), null, TODAY);
  assert.equal(r.components.some((c) => c.key === 'floor' || c.key === 'untrusted'), false);
});

test('triagem: estimativa em faixa, com fórmula declarada', () => {
  const { G } = gas();
  const t = G.Scoring.triageEstimate(120);
  assert.deepEqual([t.minMinutes, t.maxMinutes], [10, 30]);
  assert.match(t.formula, /triagem/);
});
