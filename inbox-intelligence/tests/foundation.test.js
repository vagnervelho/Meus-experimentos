'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');

test('módulos carregam em qualquer ordem (sem dependência em tempo de carga)', () => {
  const a = createGas({ order: 'alpha' });
  const b = createGas({ order: 'reverse' });
  assert.equal(typeof a.G.Util.now, 'function');
  assert.equal(typeof b.G.Config.get, 'function');
});

test('Util: datas civis no fuso de São Paulo', () => {
  const { G } = createGas();
  // 2026-10-25 02:30 UTC = 2026-10-24 23:30 em São Paulo (UTC−3)
  assert.equal(G.Util.ymd(Date.UTC(2026, 9, 25, 2, 30)), '2026-10-24');
  assert.equal(G.Util.daysBetween('2026-10-24', '2026-11-02'), 9);
  assert.equal(G.Util.addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(G.Util.isoWeekday('2026-10-24'), 6); // sábado
  assert.equal(G.Util.isValidYmd('2026-02-29'), false);
  assert.equal(G.Util.isValidYmd('2028-02-29'), true);
});

test('fuso vem do manifesto: Porto Velho (UTC−4) muda datas, SQL, views, prompt e bootstrap', () => {
  const gas = createGas();
  gas.session.timeZone = 'America/Porto_Velho';
  gas.props.script.setProperty('GCP_PROJECT_ID', 'meu-projeto');
  const { G } = gas;
  G.Util.resetMemo();
  assert.equal(G.Util.tz(), 'America/Porto_Velho');
  // 2026-10-25 03:30 UTC = 24/10 23:30 em Porto Velho, mas já 25/10 00:30 em São Paulo.
  assert.equal(G.Util.ymd(Date.UTC(2026, 9, 25, 3, 30)), '2026-10-24');
  assert.equal(G.Util.ymdStartEpochSec('2026-10-25'), Date.UTC(2026, 9, 25, 4) / 1000);
  const sql = G.Repository.render(G.Repository.QUERIES.system_status);
  assert.ok(sql.includes("CURRENT_DATE('America/Porto_Velho')") && !sql.includes('Sao_Paulo') && !sql.includes('{{tz}}'));
  const views = G.Schema.allViewStatements(1, G.Schema.viewOptions()).map((v) => v.sql).join('\n');
  assert.ok(views.includes("COALESCE(DATE(internal_ts, 'America/Porto_Velho'), received_date) AS received_date"));
  assert.ok(!views.includes('Sao_Paulo'));
  assert.equal(G.DashboardService.bootstrap().app.timeZone, 'America/Porto_Velho');
  // Fuso inválido no manifesto não vira SQL: cai no padrão.
  gas.session.timeZone = "x'); DROP TABLE t; --";
  G.Util.resetMemo();
  assert.equal(G.Util.tz(), 'America/Sao_Paulo');
});

test('Util: normalização e sanitização', () => {
  const { G } = createGas();
  assert.equal(G.Util.normalizeText('  Inteligência   ARTIFICIAL  '), 'inteligencia artificial');
  const s = G.Util.sanitizeError(new Error('Falha para joao@exemplo.com em https://x.y/z?key=abc token=SECRETO123'));
  assert.ok(!s.includes('joao@exemplo.com'));
  assert.ok(!s.includes('https://'));
  assert.ok(!s.includes('SECRETO123'));
  assert.equal(G.Util.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('Util.retry: repete erros transitórios e desiste de erros permanentes', () => {
  const { G, clock } = createGas();
  let n = 0;
  const v = G.Util.retry(() => { n++; if (n < 3) { const e = new Error('Backend Error'); e.details = { code: 503 }; throw e; } return 'ok'; }, { baseMs: 10 });
  assert.equal(v, 'ok');
  assert.equal(n, 3);
  assert.equal(clock.sleeps.length, 2);
  let m = 0;
  assert.throws(() => G.Util.retry(() => { m++; const e = new Error('Invalid'); e.details = { code: 400 }; throw e; }));
  assert.equal(m, 1);
});

test('Config: overrides fatiados e validação de patch', () => {
  const { G, props } = createGas();
  const big = { profile: { interests: Array.from({ length: 150 }, (_, i) => 'tema de interesse numero ' + i) } };
  const r = G.Config.savePatch(big);
  assert.equal(r.ok, true, r.errors.join(';'));
  assert.ok(Number(props.script.getProperty('CFG_OVR_N')) >= 1);
  G.Config.reset();
  assert.equal(G.Config.get().profile.interests.length, 150);
  assert.equal(G.Config.savePatch({ hacker: { x: 1 } }).ok, false);
  assert.equal(G.Config.savePatch({ scoring: { weights: { importance: 0.9 } } }).ok, false);
  assert.equal(G.Config.savePatch({ scoring: { thresholds: { high: 0.9 } } }).ok, false);
  assert.equal(G.Config.savePatch({ ai: { provider: 'gemini' } }).ok, true);
});

test('Config: pesos padrão somam 1 e taxonomia tem ids únicos', () => {
  const { G } = createGas();
  const w = G.Config.DEFAULTS.scoring.weights;
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  const ids = G.Config.categoryIds();
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('outros'));
});
