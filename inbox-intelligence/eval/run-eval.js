#!/usr/bin/env node
'use strict';
/**
 * Avaliação OFFLINE do classificador por regras + ranking (sem IA).
 *
 * Pipeline avaliado (o mesmo de Pipeline.js quando a IA não responde):
 *   parsed = MessageParser.parse(apiMessage, {ownerEmail, excerptChars: 4000, maxDecodedBodyChars: 200000})
 *   rules  = RulesClassifier.classify(parsed, {refYmd: parsed.received_date, profile, knownContacts})
 *   merged = AiSchema.merge(rules, null, profile)
 *   f      = Scoring.features(parsed, merged, {profile, knownContacts, senderAffinity: {}, cfg})
 *   res    = Scoring.compute(f, cfg, refToday)
 *
 * Uso:
 *   node eval/run-eval.js                    → gera eval/report.md e eval/last-run.json
 *   node eval/run-eval.js --write-baseline   → idem + grava eval/baseline.json
 *   node eval/run-eval.js --quiet            → sem tabela no terminal
 *
 * Também é um módulo (usado por tests/eval.test.js): runEval(), checkInvariants(),
 * compareToBaseline(), MAIN_METRICS.
 *
 * Os rótulos esperados (eval/dataset/*.json) refletem o julgamento de uma pessoa
 * razoável — o dono da caixa — e NÃO o comportamento atual do código.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createGas, makeGmailMessage } = require('../tests/harness');

const EVAL_DIR = __dirname;
const DATASET_DIR = path.join(EVAL_DIR, 'dataset');
const OWNER_EMAIL = 'rafael.moura.dados@gmail.com';
const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const LEVEL_PT = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', CRITICAL: 'Crítica' };
const SRC_FILES = ['Util.js', 'Config.js', 'Extractors.js', 'MessageParser.js', 'RulesClassifier.js', 'AiSchema.js', 'Scoring.js'];
const DEFAULT_TOLERANCE = 0.03;

/**
 * Métricas principais protegidas pelo baseline (todas "quanto maior, melhor").
 * Métricas de n pequeno toleram a troca de UM caso (tolerância = max(3 p.p., 1/n)).
 */
const MAIN_METRICS = [
  'category_top1', 'category_acceptable', 'macro_f1_strict', 'macro_f1_lenient',
  'level_in_range', 'high_plus_precision', 'high_plus_recall', 'critical_precision', 'critical_recall',
  'action_precision', 'action_recall', 'deadline_accuracy', 'injection_precision', 'injection_recall',
  'opportunity_precision', 'opportunity_recall',
];

// ============================================================ utilidades ====
function levelIdx(l) {
  return LEVELS.indexOf(l);
}
function ymdToDays(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : NaN;
}
function daysBetween(a, b) {
  return ymdToDays(b) - ymdToDays(a);
}
/** Intervalo de Wilson 95% para k sucessos em n. */
function wilson(k, n, z) {
  const zz = z || 1.96;
  if (!n) return { low: null, high: null };
  const p = k / n;
  const d = 1 + (zz * zz) / n;
  const c = (p + (zz * zz) / (2 * n)) / d;
  const h = (zz * Math.sqrt((p * (1 - p)) / n + (zz * zz) / (4 * n * n))) / d;
  return { low: Math.max(0, c - h), high: Math.min(1, c + h) };
}
function prop(k, n, label, extra) {
  const ci = wilson(k, n);
  return Object.assign({ label, k, n, value: n ? k / n : null, ci_low: ci.low, ci_high: ci.high, kind: 'proportion' }, extra || {});
}
function plain(x) {
  return x === undefined ? undefined : JSON.parse(JSON.stringify(x));
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pct(v, d) {
  return v === null || v === undefined || isNaN(v) ? '—' : (100 * v).toFixed(d === undefined ? 1 : d) + '%';
}
function mdEscape(s) {
  return String(s === undefined || s === null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

// ============================================================== dataset ====
function loadDataset(dir) {
  const d = dir || DATASET_DIR;
  const files = fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort();
  const cases = [];
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.cases;
    if (!Array.isArray(list)) throw new Error('Arquivo de dataset sem lista de casos: ' + f);
    for (const c of list) cases.push(Object.assign({ _file: f }, c));
  }
  const canonical = JSON.stringify(cases.map((c) => { const x = Object.assign({}, c); delete x._file; return x; }));
  const hash = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  return { cases, files, hash };
}

/** Validação estrita do formato: erro de rótulo é bug do dataset, não do classificador. */
function validateCases(cases, categoryIds) {
  const errors = [];
  const seen = {};
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  for (const c of cases) {
    const where = (c.id || '(sem id)') + ' [' + c._file + ']';
    if (!c.id || typeof c.id !== 'string') errors.push(where + ': id ausente');
    if (seen[c.id]) errors.push(where + ': id duplicado');
    seen[c.id] = true;
    if (!dateRe.test(c.refToday || '')) errors.push(where + ': refToday inválido');
    const m = c.message || {};
    if (!m.from || !m.subject || !m.date) errors.push(where + ': message precisa de from, subject e date');
    if (m.text == null && m.html == null) errors.push(where + ': message precisa de text ou html');
    if (isNaN(Date.parse(m.date))) errors.push(where + ': message.date inválida');
    const e = c.expected || {};
    if (!Array.isArray(e.categories) || !e.categories.length) errors.push(where + ': expected.categories vazio');
    (e.categories || []).forEach((id) => { if (categoryIds.indexOf(id) < 0) errors.push(where + ': categoria desconhecida ' + id); });
    if (levelIdx(e.levelMin) < 0 || levelIdx(e.levelMax) < 0) errors.push(where + ': levelMin/levelMax inválidos');
    else if (levelIdx(e.levelMin) > levelIdx(e.levelMax)) errors.push(where + ': levelMin > levelMax');
    if (!(e.action === true || e.action === false || e.action === null)) errors.push(where + ': expected.action deve ser true|false|null');
    if (!(e.deadline === null || e.deadline === 'any' || dateRe.test(e.deadline || ''))) errors.push(where + ': expected.deadline inválido');
    if (typeof e.opportunity !== 'boolean') errors.push(where + ': expected.opportunity deve ser booleano');
    if (!(e.injection === true || e.injection === false || e.injection === null)) errors.push(where + ': expected.injection deve ser true|false|null');
    if (c.tags && !Array.isArray(c.tags)) errors.push(where + ': tags deve ser lista');
  }
  if (errors.length) throw new Error('Dataset inválido:\n  - ' + errors.join('\n  - '));
}

function toApiMessage(c) {
  const m = c.message;
  return makeGmailMessage({
    id: 'eval-' + c.id,
    threadId: m.threadId || 'thr-' + c.id,
    from: m.from,
    to: m.to || 'Rafael Moura <' + OWNER_EMAIL + '>',
    cc: m.cc,
    subject: m.subject,
    date: Date.parse(m.date),
    labels: m.labelIds || ['INBOX', 'UNREAD'],
    headers: m.headers || {},
    text: m.text,
    html: m.html,
    attachments: m.attachments || [],
    messageIdHeader: '<' + c.id + '@eval.local>',
  });
}

// ============================================================= execução ====
function runCase(G, c) {
  const cfg = G.Config.get();
  const profile = cfg.profile;
  const knownContacts = {};
  ((c.context && c.context.knownContacts) || []).forEach((e) => { knownContacts[String(e).toLowerCase()] = true; });
  const parsed = G.MessageParser.parse(toApiMessage(c), { ownerEmail: OWNER_EMAIL, excerptChars: 4000, maxDecodedBodyChars: 200000 });
  const rules = G.RulesClassifier.classify(parsed, { refYmd: parsed.received_date, profile, knownContacts });
  const merged = G.AiSchema.merge(rules, null, profile);
  const f = G.Scoring.features(parsed, merged, { profile, knownContacts, senderAffinity: {}, cfg });
  const res = G.Scoring.compute(f, cfg, c.refToday);
  const top = res.components.filter((x) => x.contribution > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 4);
  return {
    id: c.id,
    file: c._file,
    description: c.description,
    refToday: c.refToday,
    tags: c.tags || [],
    expected: c.expected,
    got: {
      category: rules.primary_category,
      secondary: plain(rules.secondary_categories),
      confidence: rules.confidence,
      level: res.level,
      score: res.score,
      urgency: res.urgency,
      action: !!merged.action_required,
      action_score: rules.action_score,
      deadline: merged.deadline && merged.deadline.date ? merged.deadline.date : null,
      deadline_certainty: merged.deadline ? merged.deadline.certainty : null,
      deadline_kind: merged.deadline ? merged.deadline.kind : null,
      opportunity: !!(merged.opportunity && merged.opportunity.type),
      opportunity_type: merged.opportunity ? merged.opportunity.type : null,
      opportunity_fit: merged.opportunity ? merged.opportunity.fit : null,
      opportunity_mass: merged.opportunity ? !!merged.opportunity.is_mass : null,
      injection: !!(merged.injection && merged.injection.suspected),
      injection_signals: plain((merged.injection && merged.injection.signals) || []),
      is_newsletter: !!merged.is_newsletter,
      is_marketing: !!merged.is_marketing,
      is_spam: !!merged.is_probable_spam,
      reason: rules.reason,
      signals: plain(rules.signals),
      gate: plain(res.gate.reasons),
      top_components: top.map((x) => x.label + ' ' + x.value + ' (' + x.why + ')'),
      top_scores: Object.entries(rules.category_scores).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + ':' + v),
    },
    parsed: {
      is_bulk: !!parsed.is_bulk,
      is_automated: !!parsed.is_automated,
      auth_fail: parsed.auth_fail === true,
      auth_pass: parsed.auth_pass === true,
      user_in_to: !!parsed.user_in_to,
      is_forwarded: !!parsed.is_forwarded,
      is_reply: !!parsed.is_reply,
      gmail_category: parsed.gmail_category,
      received_date: parsed.received_date,
      body_chars: parsed.body_chars,
    },
  };
}

// ============================================================= métricas ====
function f1Table(pairs, labels) {
  const rows = {};
  labels.forEach((l) => { rows[l] = { tp: 0, fp: 0, fn: 0, support: 0, predicted: 0 }; });
  pairs.forEach(([t, p]) => {
    rows[t].support++;
    rows[p].predicted++;
    if (t === p) rows[t].tp++;
    else { rows[p].fp++; rows[t].fn++; }
  });
  const per = {};
  labels.forEach((l) => {
    const r = rows[l];
    const P = r.tp + r.fp ? r.tp / (r.tp + r.fp) : 0;
    const R = r.tp + r.fn ? r.tp / (r.tp + r.fn) : 0;
    per[l] = Object.assign({}, r, { precision: P, recall: R, f1: P + R ? (2 * P * R) / (P + R) : 0 });
  });
  // Macro sobre as categorias que aparecem como verdade OU como predição (categoria predita sem suporte conta F1 0).
  const active = labels.filter((l) => rows[l].support > 0 || rows[l].predicted > 0);
  const macro = active.length ? active.reduce((s, l) => s + per[l].f1, 0) / active.length : 0;
  return { per, macro, active };
}

function bootstrapMacro(pairs, labels, iters, seed) {
  const rnd = mulberry32(seed || 12345);
  const vals = [];
  for (let i = 0; i < iters; i++) {
    const sample = [];
    for (let j = 0; j < pairs.length; j++) sample.push(pairs[Math.floor(rnd() * pairs.length)]);
    vals.push(f1Table(sample, labels).macro);
  }
  vals.sort((a, b) => a - b);
  return { low: vals[Math.floor(0.025 * iters)], high: vals[Math.min(iters - 1, Math.floor(0.975 * iters))] };
}

function computeMetrics(results, categoryIds) {
  const M = {};
  const n = results.length;
  // ---- categoria
  const top1 = results.filter((r) => r.got.category === r.expected.categories[0]).length;
  const acc = results.filter((r) => r.expected.categories.indexOf(r.got.category) >= 0).length;
  M.category_top1 = prop(top1, n, 'Categoria: top-1 = ideal');
  M.category_acceptable = prop(acc, n, 'Categoria: top-1 ∈ aceitáveis');
  const strictPairs = results.map((r) => [r.expected.categories[0], r.got.category]);
  // "Leniente": se a predição é aceitável, ela é a verdade daquele caso.
  const lenientPairs = results.map((r) => [r.expected.categories.indexOf(r.got.category) >= 0 ? r.got.category : r.expected.categories[0], r.got.category]);
  const strict = f1Table(strictPairs, categoryIds);
  const lenient = f1Table(lenientPairs, categoryIds);
  const bsS = bootstrapMacro(strictPairs, categoryIds, 1000, 7);
  const bsL = bootstrapMacro(lenientPairs, categoryIds, 1000, 11);
  M.macro_f1_strict = { label: 'Macro-F1 (verdade = ideal)', value: strict.macro, n, k: null, ci_low: bsS.low, ci_high: bsS.high, kind: 'bootstrap', classes: strict.active.length };
  M.macro_f1_lenient = { label: 'Macro-F1 (aceitável conta como acerto)', value: lenient.macro, n, k: null, ci_low: bsL.low, ci_high: bsL.high, kind: 'bootstrap', classes: lenient.active.length };

  // ---- nível
  const point = results.filter((r) => r.expected.levelMin === r.expected.levelMax);
  M.level_exact = prop(point.filter((r) => r.got.level === r.expected.levelMin).length, point.length, 'Nível exato (casos com nível único esperado)');
  const inRange = (r) => levelIdx(r.got.level) >= levelIdx(r.expected.levelMin) && levelIdx(r.got.level) <= levelIdx(r.expected.levelMax);
  M.level_in_range = prop(results.filter(inRange).length, n, 'Nível dentro de [levelMin, levelMax]');
  M.level_over = prop(results.filter((r) => levelIdx(r.got.level) > levelIdx(r.expected.levelMax)).length, n, 'Nível ACIMA do intervalo (superpriorização)', { lowerIsBetter: true });
  M.level_under = prop(results.filter((r) => levelIdx(r.got.level) < levelIdx(r.expected.levelMin)).length, n, 'Nível ABAIXO do intervalo (subpriorização)', { lowerIsBetter: true });
  // P/R com intervalo: predição correta se o nível está no intervalo aceitável;
  // recall exige o nível quando ele é o mínimo esperado.
  const predCrit = results.filter((r) => r.got.level === 'CRITICAL');
  const needCrit = results.filter((r) => r.expected.levelMin === 'CRITICAL');
  M.critical_precision = prop(predCrit.filter((r) => r.expected.levelMax === 'CRITICAL').length, predCrit.length, 'Crítica: precisão (predita e aceitável)');
  M.critical_recall = prop(needCrit.filter((r) => r.got.level === 'CRITICAL').length, needCrit.length, 'Crítica: recall (levelMin = Crítica)');
  const hp = (l) => levelIdx(l) >= 2;
  const predHP = results.filter((r) => hp(r.got.level));
  const needHP = results.filter((r) => hp(r.expected.levelMin));
  M.high_plus_precision = prop(predHP.filter((r) => hp(r.expected.levelMax)).length, predHP.length, 'Alta ou crítica: precisão');
  M.high_plus_recall = prop(needHP.filter((r) => hp(r.got.level)).length, needHP.length, 'Alta ou crítica: recall (levelMin ≥ Alta)');

  // ---- ação
  const actCases = results.filter((r) => r.expected.action !== null);
  const predAct = actCases.filter((r) => r.got.action);
  const needAct = actCases.filter((r) => r.expected.action === true);
  M.action_precision = prop(predAct.filter((r) => r.expected.action === true).length, predAct.length, 'Ação: precisão');
  M.action_recall = prop(needAct.filter((r) => r.got.action).length, needAct.length, 'Ação: recall');
  M.action_accuracy = prop(actCases.filter((r) => r.got.action === r.expected.action).length, actCases.length, 'Ação: acurácia (casos com rótulo)');

  // ---- prazo
  const dlCases = results.filter((r) => r.expected.deadline !== 'any');
  M.deadline_accuracy = prop(dlCases.filter((r) => r.got.deadline === r.expected.deadline).length, dlCases.length, 'Prazo: acurácia (data exata ou ausência correta)');
  const dlDated = dlCases.filter((r) => r.expected.deadline !== null);
  M.deadline_date_recall = prop(dlDated.filter((r) => r.got.deadline === r.expected.deadline).length, dlDated.length, 'Prazo: data certa quando há prazo');
  const dlNone = dlCases.filter((r) => r.expected.deadline === null);
  M.deadline_spurious = prop(dlNone.filter((r) => r.got.deadline !== null).length, dlNone.length, 'Prazo espúrio (esperado nenhum, veio data)', { lowerIsBetter: true });

  // ---- injection
  const injCases = results.filter((r) => r.expected.injection !== null);
  const predInj = injCases.filter((r) => r.got.injection);
  const needInj = injCases.filter((r) => r.expected.injection === true);
  M.injection_precision = prop(predInj.filter((r) => r.expected.injection === true).length, predInj.length, 'Injection: precisão');
  M.injection_recall = prop(needInj.filter((r) => r.got.injection).length, needInj.length, 'Injection: recall');

  // ---- oportunidade
  const predOpp = results.filter((r) => r.got.opportunity);
  const needOpp = results.filter((r) => r.expected.opportunity === true);
  M.opportunity_rate = prop(predOpp.length, n, 'Taxa de oportunidades detectadas (todas as mensagens)', { informative: true, expectedRate: needOpp.length / n });
  M.opportunity_precision = prop(predOpp.filter((r) => r.expected.opportunity === true).length, predOpp.length, 'Oportunidade: precisão');
  M.opportunity_recall = prop(needOpp.filter((r) => r.got.opportunity).length, needOpp.length, 'Oportunidade: recall');

  return { metrics: M, perCategory: strict.per, perCategoryLenient: lenient.per };
}

// ========================================================== invariantes ====
/**
 * Invariantes duros que devem valer SEMPRE (independentes do baseline).
 * Cada um devolve a lista de casos cobertos e as violações.
 */
function checkInvariants(results) {
  const out = [];
  const isMkt = (r) => r.expected.categories[0] === 'marketing' || r.tags.indexOf('promo') >= 0 || r.got.is_marketing;
  const isNews = (r) => r.expected.categories[0] === 'newsletters' || r.tags.indexOf('newsletter') >= 0 || r.got.is_newsletter;
  const isPhish = (r) => r.tags.indexOf('phishing') >= 0 || r.parsed.auth_fail;
  const isDirectShort = (r) => {
    if (r.tags.indexOf('pedido_direto_prazo') < 0) return false;
    const d = r.expected.deadline;
    if (!d || d === 'any') return false;
    const days = daysBetween(r.refToday, d);
    return days >= 0 && days <= 2;
  };
  function inv(key, label, applies, ok) {
    const covered = results.filter(applies);
    out.push({ key, label, covered: covered.map((r) => r.id), violations: covered.filter((r) => !ok(r)).map((r) => ({ id: r.id, level: r.got.level, score: r.got.score, category: r.got.category })) });
  }
  inv('phishing_max_medium', 'Phishing ou auth_fail nunca acima de Média', isPhish, (r) => levelIdx(r.got.level) <= 1);
  inv('marketing_not_critical', 'Marketing/promoção nunca Crítica', isMkt, (r) => r.got.level !== 'CRITICAL');
  inv('newsletter_not_critical', 'Newsletter nunca Crítica', isNews, (r) => r.got.level !== 'CRITICAL');
  inv('direct_request_short_deadline_high', 'Pedido direto de pessoa com prazo explícito ≤ 2 dias é pelo menos Alta', isDirectShort, (r) => levelIdx(r.got.level) >= 2);
  return out;
}

// ============================================================= baseline ====
function toleranceFor(m, tol) {
  const t = tol === undefined ? DEFAULT_TOLERANCE : tol;
  return m && m.kind === 'proportion' && m.n ? Math.max(t, 1 / m.n + 1e-9) : t;
}
function compareToBaseline(metrics, baseline, tol) {
  const regressions = [];
  const checked = [];
  MAIN_METRICS.forEach((key) => {
    const b = baseline.metrics[key];
    const cur = metrics[key];
    if (!b || b.value === null || b.value === undefined) return;
    if (!cur || cur.value === null || cur.value === undefined) {
      regressions.push({ key, baseline: b.value, current: null, tolerance: null, why: 'métrica sem casos na execução atual' });
      return;
    }
    const t = toleranceFor(cur, tol);
    const drop = b.value - cur.value;
    checked.push({ key, baseline: b.value, current: cur.value, tolerance: t });
    if (drop > t + 1e-12) regressions.push({ key, baseline: b.value, current: cur.value, tolerance: t, why: 'queda de ' + (100 * drop).toFixed(1) + ' p.p.' });
  });
  return { regressions, checked };
}

// =============================================================== runEval ====
function runEval(opts) {
  const o = opts || {};
  const gas = createGas({ files: SRC_FILES, email: OWNER_EMAIL });
  const G = gas.G;
  const categoryIds = G.Config.taxonomy().map((c) => c.id);
  const ds = loadDataset(o.datasetDir);
  validateCases(ds.cases, categoryIds);
  const results = ds.cases.map((c) => runCase(G, c));
  const { metrics, perCategory, perCategoryLenient } = computeMetrics(results, categoryIds);
  const invariants = checkInvariants(results);
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      datasetHash: ds.hash,
      datasetFiles: ds.files,
      n: results.length,
      classifierVersion: G.Config.CLASSIFIER_VERSION,
      parserVersion: G.Config.PARSER_VERSION,
      configVersion: G.Config.configVersion(),
      ownerEmail: OWNER_EMAIL,
    },
    categoryIds,
    results,
    metrics,
    perCategory,
    perCategoryLenient,
    invariants,
  };
}

// ================================================================ report ====
function caseErrors(r) {
  const e = r.expected;
  const g = r.got;
  const errs = [];
  if (g.category !== e.categories[0]) {
    errs.push({ field: 'categoria', exp: e.categories.join(' / ') + (e.categories.length > 1 ? ' (ideal: ' + e.categories[0] + ')' : ''), got: g.category + (g.secondary.length ? ' [+' + g.secondary.join(', ') + ']' : ''), severity: e.categories.indexOf(g.category) >= 0 ? 'aceitável' : 'erro' });
  }
  if (levelIdx(g.level) < levelIdx(e.levelMin) || levelIdx(g.level) > levelIdx(e.levelMax)) {
    errs.push({ field: 'nível', exp: e.levelMin === e.levelMax ? e.levelMin : e.levelMin + '–' + e.levelMax, got: g.level + ' (score ' + g.score + ')', severity: levelIdx(g.level) > levelIdx(e.levelMax) ? 'acima' : 'abaixo' });
  }
  if (e.action !== null && g.action !== e.action) errs.push({ field: 'ação', exp: String(e.action), got: String(g.action) + ' (action_score ' + g.action_score + ')', severity: 'erro' });
  if (e.deadline !== 'any' && g.deadline !== e.deadline) errs.push({ field: 'prazo', exp: String(e.deadline), got: String(g.deadline) + (g.deadline ? ' (' + g.deadline_kind + ', ' + g.deadline_certainty + ')' : ''), severity: 'erro' });
  if (e.injection !== null && g.injection !== e.injection) errs.push({ field: 'injection', exp: String(e.injection), got: String(g.injection) + (g.injection_signals.length ? ' [' + g.injection_signals.join(', ') + ']' : ''), severity: 'erro' });
  if (g.opportunity !== e.opportunity) errs.push({ field: 'oportunidade', exp: String(e.opportunity), got: String(g.opportunity) + (g.opportunity ? ' (' + g.opportunity_type + ', fit ' + g.opportunity_fit + (g.opportunity_mass ? ', massa' : '') + ')' : ''), severity: 'erro' });
  return errs;
}

function metricRow(key, m) {
  const ci = m.ci_low === null || m.ci_low === undefined ? '—' : pct(m.ci_low) + ' – ' + pct(m.ci_high);
  const kn = m.kind === 'proportion' ? m.k + '/' + m.n : 'n=' + m.n + (m.classes ? ', ' + m.classes + ' classes' : '');
  return '| ' + m.label + (m.lowerIsBetter ? ' ↓' : '') + ' | `' + key + '` | ' + pct(m.value) + ' | ' + ci + ' | ' + kn + ' |';
}

function buildReport(run, baselineCmp) {
  const L = [];
  const M = run.metrics;
  const R = run.results;
  L.push('# Avaliação offline — classificador por regras + ranking');
  L.push('');
  L.push('Gerado por `node eval/run-eval.js` em ' + run.meta.generatedAt + '. Sem IA (`AiSchema.merge(rules, null)`).');
  L.push('');
  L.push('- Casos: **' + run.meta.n + '** (sintéticos; arquivos: ' + run.meta.datasetFiles.map((f) => '`' + f + '`').join(', ') + ')');
  L.push('- Hash do dataset: `' + run.meta.datasetHash + '` · classificador `' + run.meta.classifierVersion + '` · parser `' + run.meta.parserVersion + '` · configVersion `' + run.meta.configVersion + '`');
  L.push('- Rótulos = julgamento do dono da caixa (profissional de dados/pricing/finanças em busca de oportunidades sênior), **não** o comportamento do código.');
  L.push('- IC 95%: Wilson para proporções; bootstrap (1000 reamostragens, semente fixa) para macro-F1. Amostra pequena: leia os intervalos, não só o ponto.');
  L.push('');
  L.push('## Métricas principais');
  L.push('');
  L.push('| Métrica | Chave | Valor | IC 95% | k/n |');
  L.push('|---|---|---:|---:|---:|');
  const order = ['category_top1', 'category_acceptable', 'macro_f1_strict', 'macro_f1_lenient', 'level_exact', 'level_in_range', 'level_over', 'level_under',
    'critical_precision', 'critical_recall', 'high_plus_precision', 'high_plus_recall', 'action_precision', 'action_recall', 'action_accuracy',
    'deadline_accuracy', 'deadline_date_recall', 'deadline_spurious', 'injection_precision', 'injection_recall', 'opportunity_rate', 'opportunity_precision', 'opportunity_recall'];
  order.forEach((k) => { if (M[k]) L.push(metricRow(k, M[k])); });
  L.push('');
  L.push('Taxa de oportunidades esperada pelos rótulos: ' + pct(M.opportunity_rate.expectedRate) + '. ↓ = quanto menor, melhor.');
  L.push('');
  L.push('Definições: *precisão de Crítica* = das preditas Críticas, quantas tinham `levelMax = CRITICAL`; *recall de Crítica* = dos casos com `levelMin = CRITICAL`, quantos saíram Críticos (idem para "Alta ou crítica"). Ação, injection e prazo só contam casos com rótulo (`null`/`any` = não avaliado).');
  L.push('');
  if (baselineCmp) {
    L.push('## Comparação com o baseline');
    L.push('');
    if (!baselineCmp.available) L.push('Sem `eval/baseline.json` (rode com `--write-baseline`).');
    else if (baselineCmp.datasetChanged) L.push('⚠️ O dataset mudou desde o baseline (hash ' + baselineCmp.baselineHash + ' → ' + run.meta.datasetHash + '): regenere com `--write-baseline`.');
    else {
      L.push('| Métrica | Baseline | Atual | Δ (p.p.) | Tolerância |');
      L.push('|---|---:|---:|---:|---:|');
      baselineCmp.cmp.checked.forEach((c) => L.push('| `' + c.key + '` | ' + pct(c.baseline) + ' | ' + pct(c.current) + ' | ' + (100 * (c.current - c.baseline)).toFixed(1) + ' | ' + (100 * c.tolerance).toFixed(1) + ' |'));
      L.push('');
      L.push(baselineCmp.cmp.regressions.length ? '**Regressões:** ' + baselineCmp.cmp.regressions.map((x) => '`' + x.key + '` (' + x.why + ')').join(', ') : 'Nenhuma regressão acima da tolerância.');
    }
    L.push('');
  }
  // ---- casos por categoria
  L.push('## Casos por categoria ideal');
  L.push('');
  const byCat = {};
  R.forEach((r) => { byCat[r.expected.categories[0]] = (byCat[r.expected.categories[0]] || 0) + 1; });
  L.push('| Categoria | Casos | Acerto top-1 | Aceitável |');
  L.push('|---|---:|---:|---:|');
  Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a] || a.localeCompare(b)).forEach((cat) => {
    const rs = R.filter((r) => r.expected.categories[0] === cat);
    const t = rs.filter((r) => r.got.category === cat).length;
    const a = rs.filter((r) => r.expected.categories.indexOf(r.got.category) >= 0).length;
    L.push('| ' + cat + ' | ' + rs.length + ' | ' + t + ' | ' + a + ' |');
  });
  L.push('');
  // ---- F1 por categoria
  L.push('## F1 por categoria (verdade = ideal)');
  L.push('');
  L.push('| Categoria | Suporte | Preditos | Precisão | Recall | F1 | F1 leniente |');
  L.push('|---|---:|---:|---:|---:|---:|---:|');
  run.categoryIds.forEach((id) => {
    const p = run.perCategory[id];
    const pl = run.perCategoryLenient[id];
    if (!p.support && !p.predicted) return;
    L.push('| ' + id + ' | ' + p.support + ' | ' + p.predicted + ' | ' + pct(p.precision, 0) + ' | ' + pct(p.recall, 0) + ' | ' + p.f1.toFixed(2) + ' | ' + pl.f1.toFixed(2) + ' |');
  });
  L.push('');
  // ---- confusão
  L.push('## Confusões de categoria mais frequentes (ideal → predita)');
  L.push('');
  const pairs = {};
  R.forEach((r) => {
    if (r.got.category === r.expected.categories[0]) return;
    const k = r.expected.categories[0] + ' → ' + r.got.category;
    (pairs[k] = pairs[k] || []).push(r.id + (r.expected.categories.indexOf(r.got.category) >= 0 ? '*' : ''));
  });
  L.push('| Par | n | Casos (* = predita era aceitável) |');
  L.push('|---|---:|---|');
  Object.keys(pairs).sort((a, b) => pairs[b].length - pairs[a].length || a.localeCompare(b)).forEach((k) => L.push('| ' + k + ' | ' + pairs[k].length + ' | ' + pairs[k].join(', ') + ' |'));
  L.push('');
  // ---- matriz de nível
  L.push('## Nível: intervalo esperado × nível obtido');
  L.push('');
  L.push('| Esperado | LOW | MEDIUM | HIGH | CRITICAL |');
  L.push('|---|---:|---:|---:|---:|');
  const ranges = {};
  R.forEach((r) => {
    const k = r.expected.levelMin === r.expected.levelMax ? r.expected.levelMin : r.expected.levelMin + '–' + r.expected.levelMax;
    ranges[k] = ranges[k] || { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0, _o: levelIdx(r.expected.levelMin) * 10 + levelIdx(r.expected.levelMax) };
    ranges[k][r.got.level]++;
  });
  Object.keys(ranges).sort((a, b) => ranges[a]._o - ranges[b]._o).forEach((k) => {
    const x = ranges[k];
    L.push('| ' + k + ' | ' + LEVELS.map((l) => x[l]).join(' | ') + ' |');
  });
  L.push('');
  // ---- invariantes
  L.push('## Invariantes duros');
  L.push('');
  run.invariants.forEach((inv) => {
    L.push('- **' + inv.label + '** (`' + inv.key + '`): ' + inv.covered.length + ' casos cobertos, ' +
      (inv.violations.length ? '**' + inv.violations.length + ' violação(ões)**: ' + inv.violations.map((v) => '`' + v.id + '` (' + v.level + ', ' + v.category + ', score ' + v.score + ')').join(', ') : 'nenhuma violação.'));
  });
  L.push('');
  // ---- erros
  const withErr = R.map((r) => ({ r, errs: caseErrors(r) })).filter((x) => x.errs.length);
  L.push('## Todos os erros (' + withErr.length + ' casos com pelo menos uma divergência)');
  L.push('');
  L.push('Formato: campo — esperado × obtido. "aceitável" = a categoria obtida está na lista aceita, mas não é a ideal.');
  L.push('');
  withErr.forEach(({ r, errs }) => {
    L.push('### `' + r.id + '` — ' + mdEscape(r.description));
    L.push('');
    errs.forEach((e) => L.push('- **' + e.field + '** (' + e.severity + '): esperado `' + mdEscape(e.exp) + '` × obtido `' + mdEscape(e.got) + '`'));
    L.push('- motivo do classificador: ' + mdEscape(r.got.reason) + (r.got.signals.length ? ' · sinais: ' + r.got.signals.join(', ') : ''));
    L.push('- scores: ' + r.got.top_scores.join(', ') + ' · componentes: ' + mdEscape(r.got.top_components.join('; ')) + (r.got.gate.length ? ' · gatilho crítico: ' + r.got.gate.join(', ') : ''));
    L.push('- parser: bulk=' + r.parsed.is_bulk + ', automático=' + r.parsed.is_automated + ', auth_fail=' + r.parsed.auth_fail + ', user_in_to=' + r.parsed.user_in_to + ', encaminhado=' + r.parsed.is_forwarded + ', resposta=' + r.parsed.is_reply);
    if (r.expected.notes) L.push('- nota do rótulo: ' + mdEscape(r.expected.notes));
    L.push('');
  });
  return L.join('\n') + '\n';
}

function compactRun(run) {
  return {
    meta: run.meta,
    metrics: run.metrics,
    invariants: run.invariants,
    results: run.results.map((r) => ({ id: r.id, expected: r.expected, got: r.got, parsed: r.parsed, errors: caseErrors(r) })),
  };
}

function baselineOf(run) {
  const metrics = {};
  Object.keys(run.metrics).forEach((k) => {
    const m = run.metrics[k];
    metrics[k] = { value: m.value, k: m.k, n: m.n, ci_low: m.ci_low, ci_high: m.ci_high };
  });
  return { generatedAt: run.meta.generatedAt, datasetHash: run.meta.datasetHash, n: run.meta.n, classifierVersion: run.meta.classifierVersion, configVersion: run.meta.configVersion, tolerance: DEFAULT_TOLERANCE, mainMetrics: MAIN_METRICS, metrics };
}

function readBaseline(file) {
  const f = file || path.join(EVAL_DIR, 'baseline.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

// ================================================================== CLI ====
function main(argv) {
  const args = argv || process.argv.slice(2);
  const write = args.indexOf('--write-baseline') >= 0;
  const quiet = args.indexOf('--quiet') >= 0;
  const run = runEval();
  const baseline = readBaseline();
  let cmp = { available: !!baseline };
  if (baseline) {
    cmp.baselineHash = baseline.datasetHash;
    cmp.datasetChanged = baseline.datasetHash !== run.meta.datasetHash;
    cmp.cmp = compareToBaseline(run.metrics, baseline);
  }
  if (write) cmp = null; // o relatório do próprio baseline não se compara consigo mesmo
  fs.writeFileSync(path.join(EVAL_DIR, 'report.md'), buildReport(run, cmp));
  fs.writeFileSync(path.join(EVAL_DIR, 'last-run.json'), JSON.stringify(compactRun(run), null, 2) + '\n');
  if (write) fs.writeFileSync(path.join(EVAL_DIR, 'baseline.json'), JSON.stringify(baselineOf(run), null, 2) + '\n');
  if (!quiet) {
    const rows = ['category_top1', 'category_acceptable', 'macro_f1_lenient', 'level_in_range', 'critical_precision', 'critical_recall', 'high_plus_precision', 'high_plus_recall', 'action_precision', 'action_recall', 'deadline_accuracy', 'injection_recall', 'opportunity_precision', 'opportunity_recall'];
    console.log('Casos: ' + run.meta.n + ' · dataset ' + run.meta.datasetHash);
    rows.forEach((k) => {
      const m = run.metrics[k];
      console.log('  ' + k.padEnd(22) + ' ' + pct(m.value).padStart(6) + '  [' + pct(m.ci_low) + ' – ' + pct(m.ci_high) + ']  ' + (m.kind === 'proportion' ? m.k + '/' + m.n : 'n=' + m.n));
    });
    const v = run.invariants.reduce((s, i) => s + i.violations.length, 0);
    console.log('Invariantes: ' + (v ? v + ' violação(ões) — ver eval/report.md' : 'ok'));
    if (cmp && cmp.available && !cmp.datasetChanged && cmp.cmp.regressions.length) console.log('Regressões vs baseline: ' + cmp.cmp.regressions.map((x) => x.key).join(', '));
    console.log('Relatório: eval/report.md' + (write ? ' · baseline gravado em eval/baseline.json' : ''));
  }
  return run;
}

if (require.main === module) main();

module.exports = { runEval, checkInvariants, compareToBaseline, readBaseline, buildReport, caseErrors, wilson, loadDataset, MAIN_METRICS, DEFAULT_TOLERANCE, toleranceFor, OWNER_EMAIL, daysBetween };
