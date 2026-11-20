'use strict';
/** Utils: datas, dinheiro, rateio pelo maior resto, brinco, JSON canônico, payloadHash e coleções. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createGas } = require('./harness');

const gas = createGas();
const U = gas.G.Utils;
const plano = (v) => JSON.parse(JSON.stringify(v));
const codigo = (code) => (e) => e.name === 'AppError' && e.code === code;

// ------------------------------------------------------------------ datas ----
test('datas: validação de yyyy-MM-dd por calendário', () => {
  for (const ok of ['2026-11-13', '2024-02-29', '2000-02-29', '1999-12-31', '2026-01-01']) assert.equal(U.dataValida(ok), true, ok);
  for (const ruim of ['2026-02-30', '2025-02-29', '1900-02-29', '2026-13-01', '2026-00-10', '2026-11-00', '2026-11-31', '2026-1-5', '13/11/2026', '2026-11-13T00:00:00.000Z', ' 2026-11-13', '', null, undefined, 20261113, new Date(0)]) {
    assert.equal(U.dataValida(ruim), false, String(ruim));
  }
});

test('datas: diferença, soma e comparação', () => {
  assert.equal(U.diffDias('2026-11-13', '2026-11-13'), 0);
  assert.equal(U.diffDias('2026-11-01', '2026-11-30'), 29);
  assert.equal(U.diffDias('2026-11-30', '2026-11-01'), -29);
  assert.equal(U.diffDias('2024-02-28', '2024-03-01'), 2, 'ano bissexto');
  assert.equal(U.diffDias('2025-02-28', '2025-03-01'), 1);
  assert.equal(U.diffDias('2026-01-01', '2027-01-01'), 365);
  assert.equal(U.somaDias('2026-12-01', 290), '2027-09-17', 'exemplo do dicionário: inseminação em 01/12/2026 + 290 dias');
  assert.equal(U.somaDias('2027-09-17', -20), '2027-08-28');
  assert.equal(U.somaDias('2027-09-17', 20), '2027-10-07');
  assert.equal(U.somaDias('2024-02-28', 1), '2024-02-29');
  assert.equal(U.somaDias('2026-12-31', 1), '2027-01-01');
  assert.equal(U.somaDias('2026-03-01', -1), '2026-02-28');
  assert.equal(U.somaDias('2026-11-13', 0), '2026-11-13');
  assert.equal(U.compararDatas('2026-11-13', '2026-11-14'), -1);
  assert.equal(U.compararDatas('2026-11-14', '2026-11-13'), 1);
  assert.equal(U.compararDatas('2026-11-13', '2026-11-13'), 0);
  assert.throws(() => U.diffDias('2026-02-30', '2026-03-01'), codigo('INTERNAL'));
  assert.throws(() => U.somaDias('13/11/2026', 1), codigo('INTERNAL'));
  assert.throws(() => U.somaDias('2026-11-13', 1.5), codigo('INTERNAL'));
  assert.throws(() => U.compararDatas('2026-11-13', null), codigo('INTERNAL'));
});

test('datas: idade em meses completos (exemplos do dicionário, seção 4.5)', () => {
  assert.equal(U.idadeMeses('2025-03-20', '2026-11-13'), 19, 'macho nascido em 20/03/2025 → garrote');
  assert.equal(U.idadeMeses('2024-05-10', '2026-11-13'), 30, 'fêmea nascida em 10/05/2024');
  assert.equal(U.idadeMeses('2026-11-13', '2026-11-13'), 0);
  assert.equal(U.idadeMeses('2025-11-13', '2026-11-13'), 12, 'no dia do aniversário o mês já está completo');
  assert.equal(U.idadeMeses('2025-11-14', '2026-11-13'), 11, 'um dia antes ainda não');
  assert.equal(U.idadeMeses('2024-01-31', '2024-02-29'), 0);
  assert.equal(U.idadeMeses('2024-01-31', '2024-03-31'), 2);
  assert.equal(U.idadeMeses('2026-12-01', '2026-11-13'), -1, 'data anterior ao nascimento dá negativo: quem chama decide');
});

test('datas: hoje no fuso informado (21:30 de 13/11 em Porto Velho já é dia 14 em UTC)', () => {
  assert.equal(U.hoje('2026-11-14T01:30:00.000Z', 'America/Porto_Velho'), '2026-11-13');
  assert.equal(U.hoje('2026-11-14T01:30:00.000Z', 'UTC'), '2026-11-14');
  assert.equal(U.hoje('2026-11-14T03:59:59.999Z', 'America/Porto_Velho'), '2026-11-13');
  assert.equal(U.hoje('2026-11-14T04:00:00.000Z', 'America/Porto_Velho'), '2026-11-14');
  assert.equal(U.hoje(Date.UTC(2026, 0, 1, 2, 0, 0), 'America/Sao_Paulo'), '2025-12-31');
  assert.equal(U.hoje(gas.clock.now, 'America/Porto_Velho'), '2026-11-13', 'relógio padrão do harness');
  assert.throws(() => U.hoje('2026-11-14T01:30:00.000Z', 'Marte/Olimpo'), codigo('CONFIG'));
  assert.throws(() => U.hoje('2026-11-14T01:30:00.000Z', ''), codigo('CONFIG'));
  assert.throws(() => U.hoje('2026-11-14 01:30', 'UTC'), codigo('INTERNAL'));
  assert.equal(U.instanteIso(Date.UTC(2026, 10, 14, 1, 30)), '2026-11-14T01:30:00.000Z');
  assert.equal(U.instanteValido('2026-11-14T01:30:00.000Z'), true);
  for (const ruim of ['2026-11-14T01:30:00Z', '2026-11-14T01:30:00.000-04:00', '2026-11-14', '2026-02-30T00:00:00.000Z', '2026-11-14T25:00:00.000Z', null, 123]) {
    assert.equal(U.instanteValido(ruim), false, String(ruim));
  }
});

test('datas: intervalos fechados, com limites inclusivos e pontas abertas', () => {
  assert.deepEqual(plano(U.intersecaoIntervalos('2026-11-01', '2026-11-30', '2026-11-16', '2026-12-15')), { inicio: '2026-11-16', fim: '2026-11-30', dias: 15 });
  assert.deepEqual(plano(U.intersecaoIntervalos('2026-11-01', '2026-11-15', '2026-11-15', '2026-11-30')), { inicio: '2026-11-15', fim: '2026-11-15', dias: 1 }, 'tocam-se num dia só');
  assert.equal(U.intersecaoIntervalos('2026-11-01', '2026-11-14', '2026-11-15', '2026-11-30'), null);
  assert.deepEqual(plano(U.intersecaoIntervalos('2026-10-20', null, '2026-11-01', '2026-11-30')), { inicio: '2026-11-01', fim: '2026-11-30', dias: 30 }, 'animal ainda no pasto');
  assert.deepEqual(plano(U.intersecaoIntervalos('2026-11-10', '', '2026-11-01', null)), { inicio: '2026-11-10', fim: null, dias: null });
  assert.deepEqual(plano(U.intersecaoIntervalos(null, '2026-11-05', '2026-11-01', '2026-11-30')), { inicio: '2026-11-01', fim: '2026-11-05', dias: 5 });
  assert.equal(U.intersecaoIntervalos('2026-12-01', null, '2026-11-01', '2026-11-30'), null);
  assert.throws(() => U.intersecaoIntervalos('2026-11-30', '2026-11-01', '2026-11-01', '2026-11-30'), codigo('INTERNAL'));
  assert.throws(() => U.intersecaoIntervalos('2026-11-31', null, null, null), codigo('INTERNAL'));
  assert.equal(U.dentroDoIntervalo('2026-11-13', '2026-11-13', '2026-11-13'), true);
  assert.equal(U.dentroDoIntervalo('2026-11-13', '2026-11-01', null), true);
  assert.equal(U.dentroDoIntervalo('2026-11-13', '2026-11-14', null), false);
  assert.equal(U.dentroDoIntervalo('2026-11-13', null, '2026-11-12'), false);
  assert.equal(U.diasNoIntervalo('2026-11-01', '2026-11-30'), 30);
  assert.equal(U.diasNoIntervalo('2026-11-13', '2026-11-13'), 1);
  assert.throws(() => U.diasNoIntervalo('2026-11-14', '2026-11-13'), codigo('INTERNAL'));
});

// ------------------------------------------------------------------ dinheiro ----
test('dinheiro: reais ↔ centavos sem erro de ponto flutuante', () => {
  assert.equal(U.reaisParaCentavos(1234.56), 123456);
  assert.equal(U.reaisParaCentavos(0.1 + 0.2), 30);
  assert.equal(U.reaisParaCentavos(0.1) + U.reaisParaCentavos(0.2), 30);
  assert.equal(U.reaisParaCentavos(19.99), 1999);
  assert.equal(U.reaisParaCentavos(1.005), 101, 'meio centavo arredonda para cima');
  assert.equal(U.reaisParaCentavos(0.035), 4);
  assert.equal(U.reaisParaCentavos(0), 0);
  assert.equal(U.reaisParaCentavos(-12.34), -1234);
  assert.equal(U.reaisParaCentavos(null), null);
  assert.equal(U.reaisParaCentavos(''), null);
  assert.equal(U.centavosParaReais(123456), 1234.56);
  assert.equal(U.centavosParaReais(0), 0);
  assert.equal(U.centavosParaReais(null), null);
  for (let c = 0; c < 20000; c += 7) assert.equal(U.reaisParaCentavos(U.centavosParaReais(c)), c);
  assert.throws(() => U.reaisParaCentavos('12,34'), codigo('INTERNAL'));
  assert.throws(() => U.reaisParaCentavos(NaN), codigo('INTERNAL'));
  assert.throws(() => U.centavosParaReais(12.5), codigo('INTERNAL'));
  assert.equal(U.formatarReais(123456), 'R$ 1.234,56');
  assert.equal(U.formatarReais(5), 'R$ 0,05');
  assert.equal(U.formatarReais(100000000), 'R$ 1.000.000,00');
  assert.equal(U.formatarReais(-1250), '-R$ 12,50');
});

test('números nas mensagens: formato brasileiro (milhar com ponto, decimal com vírgula), casas pedidas ou as que o número usa', () => {
  assert.equal(U.formatarNumero(0.0001), '0,0001');
  assert.equal(U.formatarNumero(2000), '2.000');
  assert.equal(U.formatarNumero(1575.5), '1.575,5');
  assert.equal(U.formatarNumero(0.1 + 0.2), '0,3', 'ruído binário não vira casa');
  assert.equal(U.formatarNumero(99.955, 2), '99,96', 'meio para cima');
  assert.equal(U.formatarNumero(0.025, 2), '0,03');
  assert.equal(U.formatarNumero(52.06, 1), '52,1');
  assert.equal(U.formatarNumero(-1234567.891, 2), '-1.234.567,89');
  assert.equal(U.formatarNumero(-0.001, 1), '0,0', 'zero arredondado não leva sinal');
  assert.equal(U.formatarNumero(5, 2), '5,00');
  assert.throws(() => U.formatarNumero(NaN), codigo('INTERNAL'));
  assert.throws(() => U.formatarNumero('1,5'), codigo('INTERNAL'));
});

test('números: arredondamento meio para cima e casas decimais', () => {
  assert.equal(U.arredondar(387.46, 1), 387.5);
  assert.equal(U.arredondar(387.44, 1), 387.4);
  assert.equal(U.arredondar(387.45, 1), 387.5, 'o decimal informado, não o binário');
  assert.equal(U.arredondar(-387.45, 1), -387.5);
  assert.equal(U.arredondar(2.5, 0), 3);
  assert.equal(U.arredondar(0.00004, 4), 0);
  assert.equal(Object.is(U.arredondar(-0.0001, 2), 0), true, 'sem zero negativo');
  assert.equal(U.casasDecimais(387.5), 1);
  assert.equal(U.casasDecimais(0.02), 2);
  assert.equal(U.casasDecimais(37.45), 2);
  assert.equal(U.casasDecimais(450), 0);
  assert.equal(U.casasDecimais(0.1 + 0.2), 1, 'ruído binário não conta');
  assert.equal(U.casasDecimais(0.12345), 5);
});

// ------------------------------------------------------------------ rateio ----
const valores = (r) => plano(r.itens).map((i) => i.valor);
function referencia(total, itens) {
  // Maior resto com inteiros exatos (BigInt), como em 03b seção 13.3.
  const b = itens.map((i) => BigInt(Math.round(i.base * 10000)));
  const B = b.reduce((s, x) => s + x, 0n);
  const T = BigInt(total);
  const q = b.map((x) => (T * x) / B);
  const r = b.map((x) => (T * x) % B);
  let sobra = Number(T - q.reduce((s, x) => s + x, 0n));
  const ordem = itens.map((_, i) => i).sort((x, y) => (r[x] !== r[y] ? (r[y] > r[x] ? 1 : -1) : b[x] !== b[y] ? (b[y] > b[x] ? 1 : -1) : itens[x].chave < itens[y].chave ? -1 : 1));
  const out = q.map(Number);
  for (const i of ordem) { if (sobra <= 0) break; out[i] += 1; sobra -= 1; }
  return out;
}

test('rateio CT-13a: R$ 100,00 por 3 = 33,34 + 33,33 + 33,33, com o centavo para a menor chave', () => {
  const r = U.ratear(10000, [{ chave: 'A-000003', base: 1 }, { chave: 'A-000001', base: 1 }, { chave: 'A-000002', base: 1 }]);
  assert.deepEqual(plano(r.itens), [{ chave: 'A-000003', base: 1, valor: 3333 }, { chave: 'A-000001', base: 1, valor: 3334 }, { chave: 'A-000002', base: 1, valor: 3333 }]);
  assert.equal(r.baseTotal, 3);
  assert.equal(r.totalAlocado, 10000);
  assert.deepEqual(valores(U.ratear(10000, [{ chave: 'A-000001', base: 1 }, { chave: 'A-000002', base: 1 }, { chave: 'A-000003', base: 1 }])), [3334, 3333, 3333]);
});

test('rateio CT-13b e c: peso vivo e dias de permanência fecham ao centavo', () => {
  const b = U.ratear(150000, [{ chave: 'a', base: 200.0 }, { chave: 'b', base: 250.0 }, { chave: 'c', base: 310.0 }]);
  assert.deepEqual(valores(b), [39474, 49342, 61184]);
  assert.equal(b.baseTotal, 760);
  const c = U.ratear(90000, [{ chave: 'a', base: 31 }, { chave: 'b', base: 16 }, { chave: 'c', base: 10 }]);
  assert.deepEqual(valores(c), [48947, 25263, 15790]);
  assert.equal(c.baseTotal, 57);
  assert.equal(valores(c).reduce((s, v) => s + v, 0), 90000);
});

test('rateio: desempate determinístico — maior resto, depois maior base, depois chave', () => {
  // Restos diferentes: 1 centavo por 3 com bases 5, 3, 2 → restos 5, 3, 2 (de 10): vai para o maior resto.
  assert.deepEqual(valores(U.ratear(1, [{ chave: 'x', base: 2 }, { chave: 'y', base: 5 }, { chave: 'z', base: 3 }])), [0, 1, 0]);
  // Restos iguais e bases diferentes: 3 centavos, bases 1 e 3 → cotas 0,75 e 2,25?? não: restos 3 e 1. Caso de empate real:
  // T = 2, bases 1 e 3 (B = 4): restos 2 e 2, quocientes 0 e 1 → sobra 1 vai para a MAIOR base.
  assert.deepEqual(valores(U.ratear(2, [{ chave: 'a', base: 1 }, { chave: 'b', base: 3 }])), [0, 2]);
  assert.deepEqual(valores(U.ratear(2, [{ chave: 'b', base: 3 }, { chave: 'a', base: 1 }])), [2, 0]);
  // Restos e bases iguais: decide a chave, em ordem de texto, qualquer que seja a ordem de entrada.
  const itens = ['A-000010', 'A-000002', 'A-000007', 'A-000001'].map((chave) => ({ chave, base: 1 }));
  const r = U.ratear(10, itens); // 2 cada, sobra 2 → as duas menores chaves
  assert.deepEqual(Object.fromEntries(plano(r.itens).map((i) => [i.chave, i.valor])), { 'A-000010': 2, 'A-000002': 3, 'A-000007': 2, 'A-000001': 3 });
});

test('rateio: entrada embaralhada dá a mesma saída e 1.000 sorteios mantêm a soma exata', () => {
  let semente = 20261113;
  const rnd = () => { semente = (semente * 1664525 + 1013904223) % 4294967296; return semente / 4294967296; };
  for (let caso = 0; caso < 1000; caso++) {
    const n = 1 + Math.floor(rnd() * 40);
    const total = Math.floor(rnd() * 5000000);
    const casas = [0, 1, 2, 4][caso % 4];
    const itens = [];
    for (let i = 0; i < n; i++) itens.push({ chave: 'A-' + String(i + 1).padStart(6, '0'), base: Number((rnd() * (caso % 7 === 0 ? 3 : 900)).toFixed(casas)) });
    if (caso % 5 === 0) itens.forEach((it) => { it.base = itens[0].base || 1; }); // empates de propósito
    if (itens.every((it) => it.base === 0)) itens[0].base = 1;
    const r = U.ratear(total, itens);
    const v = valores(r);
    assert.equal(v.reduce((s, x) => s + x, 0), total, 'caso ' + caso + ': soma');
    assert.deepEqual(v, referencia(total, itens), 'caso ' + caso + ': confere com a conta em inteiros exatos');
    const embaralhado = itens.slice().sort(() => rnd() - 0.5);
    const porChave = Object.fromEntries(plano(U.ratear(total, embaralhado).itens).map((i) => [i.chave, i.valor]));
    itens.forEach((it, i) => assert.equal(porChave[it.chave], v[i], 'caso ' + caso + ': independe da ordem'));
  }
});

test('rateio: valores grandes continuam exatos (sem estourar 2^53)', () => {
  const itens = [{ chave: 'a', base: 90071992.5471 }, { chave: 'b', base: 123456789.1234 }, { chave: 'c', base: 0.0001 }, { chave: 'd', base: 77777777.7777 }];
  for (const total of [100000000, 999999999999, 12345678901234]) {
    const r = U.ratear(total, itens);
    assert.deepEqual(valores(r), referencia(total, itens));
    assert.equal(valores(r).reduce((s, x) => s + x, 0), total);
  }
});

test('rateio: base zero não distribui; entradas inválidas são recusadas', () => {
  const zero = U.ratear(10000, [{ chave: 'a', base: 0 }, { chave: 'b', base: 0 }]);
  assert.deepEqual(plano(zero), { itens: [{ chave: 'a', base: 0, valor: 0 }, { chave: 'b', base: 0, valor: 0 }], baseTotal: 0, totalAlocado: 0 });
  assert.deepEqual(plano(U.ratear(10000, [])), { itens: [], baseTotal: 0, totalAlocado: 0 });
  assert.deepEqual(valores(U.ratear(0, [{ chave: 'a', base: 1 }, { chave: 'b', base: 2 }])), [0, 0]);
  assert.deepEqual(valores(U.ratear(999, [{ chave: 'a', base: 0 }, { chave: 'b', base: 2.5 }])), [0, 999], 'quem tem base zero não recebe');
  assert.throws(() => U.ratear(100, [{ chave: 'a', base: 1 }, { chave: 'a', base: 2 }]), codigo('VALIDATION'));
  assert.throws(() => U.ratear(100, [{ chave: 'a', base: -1 }]), codigo('VALIDATION'));
  assert.throws(() => U.ratear(100, [{ chave: 'a', base: 1.23456 }]), codigo('VALIDATION'));
  assert.throws(() => U.ratear(100, [{ chave: 'a', base: NaN }]), codigo('VALIDATION'));
  assert.throws(() => U.ratear(100.5, [{ chave: 'a', base: 1 }]), codigo('VALIDATION'));
  assert.throws(() => U.ratear(-1, [{ chave: 'a', base: 1 }]), codigo('VALIDATION'));
  assert.throws(() => U.ratear(100, [{ base: 1 }]), codigo('INTERNAL'));
  assert.throws(() => U.ratear(100, [{ chave: 'a', base: 4e11 }, { chave: 'b', base: 1e11 }]), codigo('VALIDATION'), 'acima do teto do cálculo exato: recusa, nunca arredonda');
});

// ------------------------------------------------------------------ texto ----
test('brinco: forma canônica — "0012" e "12" são o mesmo código (tabela de 03a, DL-04)', () => {
  assert.equal(U.normalizarBrinco('0012'), '12');
  assert.equal(U.normalizarBrinco('12'), '12');
  assert.equal(U.normalizarBrinco(' 0012 '), '12');
  assert.equal(U.normalizarBrinco('br 07'), 'BR07');
  assert.equal(U.normalizarBrinco('A-0012'), 'A-0012');
  assert.equal(U.normalizarBrinco('1E5'), '1E5');
  assert.equal(U.normalizarBrinco('000'), '0');
  assert.equal(U.normalizarBrinco('0'), '0');
  assert.equal(U.normalizarBrinco('\t12 34\n'), '1234', 'todo tipo de espaço');
  assert.equal(U.normalizarBrinco('ç-01'), 'Ç-01');
  assert.equal(U.normalizarBrinco(''), '');
  assert.equal(U.normalizarBrinco(null), '');
  assert.equal(U.normalizarBrinco(12), '12', 'número vindo de célula coercida');
  // Passo 3 (sem tirar zeros): usado quando brinco_ignora_zeros_esquerda = N.
  assert.equal(U.normalizarBrinco(' 0012 ', true), '0012');
  assert.notEqual(U.normalizarBrinco('0012', true), U.normalizarBrinco('12', true));
  assert.equal(U.aparar('  0012  '), '0012');
  assert.equal(U.aparar(null), '');
  assert.equal(U.normalizarTexto('  Fazenda   São  João '), 'fazenda sao joao');
  assert.equal(U.normalizarTexto('MATERNIDADE'), U.normalizarTexto('maternidade'));
  assert.equal(U.vazio(''), true);
  assert.equal(U.vazio(null), true);
  assert.equal(U.vazio(undefined), true);
  assert.equal(U.vazio(0), false);
  assert.equal(U.vazio(false), false);
});

// ------------------------------------------------------------------ JSON canônico e hash ----
test('JSON canônico: chaves ordenadas em todos os níveis, sem espaços, vazios omitidos, listas na ordem', () => {
  assert.equal(U.jsonCanonico({ b: 1, a: 'x' }), '{"a":"x","b":1}');
  assert.equal(U.jsonCanonico({ z: { d: 1, c: [3, 1, 2] }, a: null, m: '', k: undefined, f: false, n: 0 }), '{"f":false,"n":0,"z":{"c":[3,1,2],"d":1}}');
  assert.equal(U.jsonCanonico({ lista: [{ b: 2, a: 1, vazio: '' }, { a: null }] }), '{"lista":[{"a":1,"b":2},{}]}');
  assert.equal(U.jsonCanonico({ t: 'ação "x"\n', n: 1.5, e: 1e21 }), '{"e":1e+21,"n":1.5,"t":"ação \\"x\\"\\n"}');
  assert.equal(U.jsonCanonico([1, '', null, 'a']), '[1,null,null,"a"]', 'posição de lista é preservada');
  assert.equal(U.jsonCanonico({}), '{}');
  assert.equal(U.jsonCanonico(null), 'null');
  assert.equal(U.jsonCanonico({ brinco: '0012' }), '{"brinco":"0012"}', 'texto continua texto');
  assert.throws(() => U.jsonCanonico({ d: gas.run('new Date(0)') }), codigo('VALIDATION'));
  assert.throws(() => U.jsonCanonico({ n: NaN }), codigo('VALIDATION'));
  assert.throws(() => U.jsonCanonico({ f: () => 1 }), codigo('VALIDATION'));
});

test('payloadHash: SHA-256 do JSON canônico de {rota, dados}; reenvio do mesmo formulário dá o mesmo hash', () => {
  const hash = gas.portas().hash;
  const dados = { event_date: '2026-11-13', animais: [{ animal_id: 'a1', peso: 387.5 }], notes: '' };
  const h = U.payloadHash('evento.registrar', dados, hash);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, crypto.createHash('sha256').update('{"dados":{"animais":[{"animal_id":"a1","peso":387.5}],"event_date":"2026-11-13"},"rota":"evento.registrar"}', 'utf8').digest('hex'));
  // Chaves em outra ordem e um campo vazio a mais: mesma operação.
  assert.equal(U.payloadHash('evento.registrar', { notes: null, animais: [{ peso: 387.5, animal_id: 'a1', observacoes: '' }], event_date: '2026-11-13', responsible: undefined }, hash), h);
  // Conteúdo, rota ou ordem da lista diferentes: outra operação.
  assert.notEqual(U.payloadHash('evento.registrar', Object.assign({}, dados, { event_date: '2026-11-12' }), hash), h);
  assert.notEqual(U.payloadHash('evento.simular', dados, hash), h);
  assert.notEqual(U.payloadHash('evento.registrar', { a: [1, 2] }, hash), U.payloadHash('evento.registrar', { a: [2, 1] }, hash));
  assert.notEqual(U.payloadHash('evento.registrar', { brinco: '0012' }, hash), U.payloadHash('evento.registrar', { brinco: '12' }, hash));
  assert.throws(() => U.payloadHash('', dados, hash), codigo('INTERNAL'));
  assert.throws(() => U.payloadHash('evento.registrar', dados, null), codigo('INTERNAL'));
  assert.throws(() => U.payloadHash('evento.registrar', dados, { sha256Hex: () => 'ABC' }), codigo('INTERNAL'));
  // A porta real será Utilities.computeDigest (bytes com sinal): bytesParaHex dá o mesmo hexadecimal.
  const viaUtilities = { sha256Hex: (t) => U.bytesParaHex(gas.G.Utilities.computeDigest(gas.G.Utilities.DigestAlgorithm.SHA_256, t, gas.G.Utilities.Charset.UTF_8)) };
  assert.equal(U.payloadHash('evento.registrar', dados, viaUtilities), h);
  assert.equal(U.bytesParaHex([0, 15, -1, -128, 127]), '000fff807f');
});

// ------------------------------------------------------------------ coleções ----
test('coleções: indexar, agrupar, somar, máximo, ordenar, únicos, blocos e clone', () => {
  const lista = [{ id: 'a', pasto: 'p1', valor: 100, seq: 3 }, { id: 'b', pasto: 'p2', valor: 250, seq: 1 }, { id: 'c', pasto: 'p1', valor: null, seq: 2 }, { id: 'a', pasto: 'p9', valor: 1, seq: 9 }];
  assert.equal(U.indexarPor(lista, 'id').a.pasto, 'p1', 'chave repetida fica com o primeiro');
  assert.deepEqual(Object.keys(U.indexarPor(lista, 'id')), ['a', 'b', 'c']);
  assert.deepEqual(Object.keys(U.indexarPor([{ k: '' }, { k: null }, { k: 'x' }], 'k')), ['x']);
  assert.equal(U.indexarPor([{ k: 'toString' }], 'k').toString.k, 'toString', 'chave com nome de método de Object');
  assert.deepEqual(plano(U.agruparPor(lista, 'pasto')).p1.map((x) => x.id), ['a', 'c']);
  assert.deepEqual(Object.keys(U.agruparPor(lista, (x) => x.pasto.toUpperCase())), ['P1', 'P2', 'P9']);
  assert.equal(U.somar(lista, 'valor'), 351);
  assert.equal(U.somar([], 'valor'), 0);
  assert.throws(() => U.somar([{ valor: '10' }], 'valor'), codigo('INTERNAL'));
  assert.equal(U.maximo(lista, 'seq'), 9);
  assert.equal(U.maximo([], 'seq'), null);
  assert.equal(U.maximo([{ seq: '' }, { seq: null }], 'seq'), null);
  assert.deepEqual(plano(U.ordenarPor(lista, ['pasto', { campo: 'seq', desc: true }])).map((x) => x.id + x.seq), ['a3', 'c2', 'b1', 'a9']);
  assert.deepEqual(plano(U.ordenarPor(lista, 'valor')).map((x) => x.valor), [1, 100, 250, null], 'vazio vai para o fim');
  assert.deepEqual(plano(U.ordenarPor([{ d: '2026-11-13', s: 2 }, { d: '2026-11-13', s: 1 }, { d: '2026-01-01', s: 9 }], ['d'])).map((x) => x.s), [9, 2, 1], 'estável');
  assert.equal(lista[0].id, 'a', 'ordenarPor não altera a entrada');
  assert.deepEqual(plano(U.unicos(['a', 'b', 'a', 1, '1', 1])), ['a', 'b', 1, '1']);
  assert.deepEqual(plano(U.emBlocos([1, 2, 3, 4, 5], 2)), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(plano(U.emBlocos([], 200)), []);
  assert.throws(() => U.emBlocos([1], 0), codigo('INTERNAL'));
  const original = { a: [{ b: 1 }] };
  const copia = U.clonar(original);
  copia.a[0].b = 2;
  assert.equal(original.a[0].b, 1);
});
