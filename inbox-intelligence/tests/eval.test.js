'use strict';
/**
 * Guarda de qualidade do classificador por regras + ranking (sem IA), sobre o
 * conjunto de avaliação offline em eval/dataset/*.json.
 *
 * 1. Métricas principais não podem cair mais que a tolerância (3 p.p.; em
 *    métricas de n pequeno, a troca de um único caso) abaixo de eval/baseline.json.
 *    Melhorou? Rode `node eval/run-eval.js --write-baseline` e versione o baseline.
 * 2. Invariantes duros valem SEMPRE. Violações já conhecidas no código atual estão
 *    listadas explicitamente em KNOWN_EXCEPTIONS (não mascaradas): uma violação nova
 *    reprova; uma exceção que voltou a passar é apontada em diagnóstico para ser
 *    removida da lista.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { runEval, readBaseline, compareToBaseline, wilson, MAIN_METRICS, DEFAULT_TOLERANCE, toleranceFor } = require('../eval/run-eval');

/**
 * Violações conhecidas dos invariantes com o código atual (ver eval/report.md).
 * Cada id aqui é um defeito real do classificador/ranking a corrigir — não um
 * rótulo discutível.
 */
const KNOWN_EXCEPTIONS = {
  // Fraude do "CEO": Gmail novo com o nome da gestora (contato conhecido em outro
  // endereço) e Reply-To divergente; autenticação passa, então nada rebaixa o nível.
  phishing_max_medium: ['phish-fraude-ceo-pix-gmail'],
  marketing_not_critical: [],
  newsletter_not_critical: [],
  // Pedidos com prazo "hoje"/"amanhã" sem palavra de prazo explícita ou com
  // imperativo informal ("me manda", "send me ... by tomorrow EOD") ficam em Média.
  direct_request_short_deadline_high: ['pessoal-irmao-rg-cartorio-hoje', 'en-cliente-deck-amanha-eod', 'trabalho-reply-chefe-resumo-amanha-cedo'],
};

// Cobertura mínima de cada invariante: evita que um invariante "passe" por não cobrir nada.
const MIN_COVERAGE = { phishing_max_medium: 8, marketing_not_critical: 10, newsletter_not_critical: 10, direct_request_short_deadline_high: 6 };

const run = runEval();
const pct = (v) => (v === null || v === undefined ? '—' : (100 * v).toFixed(1) + '%');

test('dataset de avaliação: válido, ≥ 90 casos e todas as métricas principais com casos', () => {
  assert.ok(run.meta.n >= 90, 'casos: ' + run.meta.n);
  MAIN_METRICS.forEach((k) => {
    assert.ok(run.metrics[k], 'métrica ausente: ' + k);
    assert.ok(run.metrics[k].n > 0, 'métrica sem casos: ' + k);
  });
  const ideals = new Set(run.results.map((r) => r.expected.categories[0]));
  assert.ok(ideals.size >= 15, 'categorias ideais distintas: ' + ideals.size);
});

test('Wilson 95%: valores de referência', () => {
  const a = wilson(0, 10);
  assert.ok(a.low === 0 && Math.abs(a.high - 0.2775) < 0.001, JSON.stringify(a));
  const b = wilson(8, 10);
  assert.ok(Math.abs(b.low - 0.4902) < 0.001 && Math.abs(b.high - 0.9433) < 0.001, JSON.stringify(b));
  assert.deepEqual(wilson(0, 0), { low: null, high: null });
});

test('guarda de baseline: queda acima da tolerância reprova; dentro dela, não', () => {
  const fake = { metrics: {} };
  MAIN_METRICS.forEach((k) => { fake.metrics[k] = { value: run.metrics[k].value }; });
  assert.equal(compareToBaseline(run.metrics, fake).regressions.length, 0);
  const big = run.metrics.category_top1; // n grande: tolerância de 3 p.p.
  fake.metrics.category_top1 = { value: big.value + 0.031 };
  assert.deepEqual(compareToBaseline(run.metrics, fake).regressions.map((r) => r.key), ['category_top1']);
  fake.metrics.category_top1 = { value: big.value + 0.029 };
  assert.equal(compareToBaseline(run.metrics, fake).regressions.length, 0);
  const small = run.metrics.critical_recall; // n pequeno: tolera a troca de um caso, não de dois
  fake.metrics.critical_recall = { value: small.value + 1 / small.n };
  assert.equal(compareToBaseline(run.metrics, fake).regressions.length, 0);
  fake.metrics.critical_recall = { value: small.value + 2 / small.n };
  assert.deepEqual(compareToBaseline(run.metrics, fake).regressions.map((r) => r.key), ['critical_recall']);
});

test('métricas principais não regridem além da tolerância em relação ao baseline', () => {
  const baseline = readBaseline();
  assert.ok(baseline, 'eval/baseline.json ausente: rode `node eval/run-eval.js --write-baseline`');
  assert.equal(run.meta.datasetHash, baseline.datasetHash,
    'o dataset mudou desde o baseline (' + baseline.datasetHash + ' → ' + run.meta.datasetHash + '): revise e rode `node eval/run-eval.js --write-baseline`');
  const cmp = compareToBaseline(run.metrics, baseline, DEFAULT_TOLERANCE);
  const lines = cmp.regressions.map((r) => r.key + ': ' + pct(r.baseline) + ' → ' + pct(r.current) + ' (' + r.why + '; tolerância ' + (r.tolerance === null ? '—' : (100 * r.tolerance).toFixed(1) + ' p.p.') + ')');
  assert.equal(cmp.regressions.length, 0, 'Regressões vs eval/baseline.json:\n  ' + lines.join('\n  ') + '\nDetalhes por caso: node eval/run-eval.js && abra eval/report.md');
  // A tolerância é a anunciada: 3 p.p., ou um caso quando n é pequeno.
  cmp.checked.forEach((c) => assert.ok(c.tolerance >= DEFAULT_TOLERANCE && c.tolerance === toleranceFor(run.metrics[c.key], DEFAULT_TOLERANCE)));
});

for (const inv of run.invariants) {
  test('invariante: ' + inv.label, (t) => {
    const known = KNOWN_EXCEPTIONS[inv.key] || [];
    assert.ok(inv.covered.length >= (MIN_COVERAGE[inv.key] || 1), 'invariante cobre poucos casos (' + inv.covered.length + ')');
    const fresh = inv.violations.filter((v) => known.indexOf(v.id) < 0);
    const stale = known.filter((id) => !inv.violations.some((v) => v.id === id));
    if (stale.length) t.diagnostic('exceções conhecidas que agora passam (remova de KNOWN_EXCEPTIONS.' + inv.key + '): ' + stale.join(', '));
    known.forEach((id) => assert.ok(run.results.some((r) => r.id === id), 'exceção conhecida inexistente no dataset: ' + id));
    if (inv.violations.length) t.diagnostic('violações conhecidas: ' + inv.violations.filter((v) => known.indexOf(v.id) >= 0).map((v) => v.id + ' (' + v.level + ')').join(', '));
    assert.equal(fresh.length, 0, 'novas violações de "' + inv.label + '": ' + fresh.map((v) => v.id + ' → ' + v.level + ' (' + v.category + ', score ' + v.score + ')').join('; '));
  });
}
