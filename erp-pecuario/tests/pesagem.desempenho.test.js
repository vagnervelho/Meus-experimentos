'use strict';
/**
 * Desempenho (07, seção 8.1; RN-052, RN-053; CT-05), com número exato: GMD entre pesagens e do período, a regra do
 * intervalo mínimo, uma pesagem só, pesagem no mesmo dia, retroativa, animal que saiu e voltou, métodos fora do GMD
 * individual (fita, estimativa), peso ao nascer (medido e o de referência, fora das contas), projeção rotulada (base,
 * GMD de referência na janela, horizonte), GMD de lote, por pasto (dias de permanência) e por categoria, os filtros e as
 * curvas da rota `peso.desempenho`. Tudo calculado no servidor; nada vira pesagem.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js, PASTOS } = S;

function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave, avisosAceitos: avisos || [] })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + JSON.stringify(r.error));
  return r.data;
}
let n = 0;
function pesar(s, data, itens, campos, avisos) {
  return ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: Object.assign({ event_date: data, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, campos || {}), animais: itens }, 'pes-' + (++n), avisos), 'pesagem de ' + data);
}
function rebanho(s, brincos, extra) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(brincos.map((b) => S.bicho(Object.assign({ brinco: b, sexo: 'M', castrado: true, data_nascimento: '2024-05-01', data_nascimento_confianca: 'CONFIRMADA' }, extra || {})))), 'reb-' + (++n)), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}
const ficha = (s, id) => ok(api(s, 'animal.ficha', { animal_id: id })).peso;
const ints = (b) => b.intervalos.map((v) => [v.de, v.ate, v.ganho_kg, v.dias, v.gmd_kg_dia, v.variacao_pct, v.motivo]);

test('CT-05 na ficha (bloco E): 91 dias, ganho 72,8 kg, GMD 0,800, variação 24,27%; o intervalo de 10 dias sem GMD (DADOS_INSUFICIENTES, nunca zero); período 80,0 kg em 101 dias = 0,792; projeção rotulada a partir de 380,0 kg', () => {
  const s = S.sistema();
  const id = rebanho(s, ['0501'])['0501'];
  pesar(s, '2026-03-10', [{ animal_id: id, peso: 300.0 }]);
  pesar(s, '2026-06-09', [{ animal_id: id, peso: 372.8 }]);
  pesar(s, '2026-06-19', [{ animal_id: id, peso: 380.0 }]);
  const b = ficha(s, id);
  assert.equal(b.entregue, true);
  assert.deepEqual(b.serie.map((x) => [x.data, x.peso_kg, x.metodo, x.individual, x.estimado]), [['2026-03-10', 300, 'BALANCA', true, false], ['2026-06-09', 372.8, 'BALANCA', true, false], ['2026-06-19', 380, 'BALANCA', true, false]]);
  assert.deepEqual(ints(b), [['2026-03-10', '2026-06-09', 72.8, 91, 0.8, 24.27, null], ['2026-06-09', '2026-06-19', 7.2, 10, null, 1.93, 'DADOS_INSUFICIENTES']]);
  assert.match(b.intervalos[1].explicacao, /10 dias, menor que os 28 dias mínimos/);
  assert.deepEqual([b.ganho_acumulado.valor, b.ganho_acumulado.dias, b.gmd_periodo.valor], [80, 101, 0.792]);
  assert.deepEqual([b.peso_atual.valor, b.peso_atual.data], [380, '2026-06-19']);
  // Projeção: base 380,0 em 19/06; referência da primeira à última pesagem individual dos 120 dias antes dela (10/03,
  // 101 dias: 0,792 kg/dia); até 17/09 (90 dias): 380,0 + 0,792 × 90 = 451,3. Hoje (13/11) passa do horizonte.
  const p = b.projecao;
  assert.deepEqual([p.rotulo, p.base, p.referencia_de, p.gmd_referencia_kg_dia, p.ate, p.pontos[1], p.hoje], ['Estimativa', { data: '2026-06-19', peso_kg: 380 }, '2026-03-10', 0.792, '2026-09-17', { data: '2026-09-17', peso_kg: 451.3 }, null]);
  assert.match(p.explicacao_hoje, /passa do horizonte de 90 dias/);
  assert.equal(s.tabela('PESAGENS').length, 3, 'a projeção não vira pesagem (RN-053)');
});

test('uma pesagem só: sem intervalo, ganho e GMD vazios (DADOS_INSUFICIENTES), sem projeção; o peso atual é a pesagem', () => {
  const s = S.sistema();
  const id = rebanho(s, ['0601'])['0601'];
  pesar(s, '2026-10-01', [{ animal_id: id, peso: 280.4 }]);
  const b = ficha(s, id);
  assert.deepEqual([b.intervalos.length, b.ganho_acumulado.valor, b.ganho_acumulado.motivo, b.gmd_periodo.valor, b.gmd_periodo.motivo], [0, null, 'DADOS_INSUFICIENTES', null, 'DADOS_INSUFICIENTES']);
  assert.deepEqual([b.projecao.valor, b.projecao.motivo, b.projecao.rotulo], [null, 'DADOS_INSUFICIENTES', 'Estimativa']);
  assert.deepEqual([b.peso_atual.valor, b.peso_atual.data], [280.4, '2026-10-01']);
  const sem = ficha(s, rebanho(s, ['0602'])['0602']);
  assert.deepEqual([sem.serie.length, sem.peso_atual.valor, sem.peso_atual.motivo], [0, null, 'DADOS_INSUFICIENTES']);
});

test('mesmo dia vale a de depois; retroativa entra no lugar pela data e refaz os intervalos (o período continua a última menos a primeira)', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['0701', '0702']);
  pesar(s, '2026-03-01', [{ animal_id: ids['0701'], peso: 300 }]);
  pesar(s, '2026-03-01', [{ animal_id: ids['0701'], peso: 302 }], null, ['POSSIVEL_DUPLICIDADE']);
  pesar(s, '2026-04-30', [{ animal_id: ids['0701'], peso: 345 }]);
  assert.deepEqual(ints(ficha(s, ids['0701'])), [['2026-03-01', '2026-04-30', 43, 60, 0.717, 14.24, null]], 'a de 302 (depois no dia) é a base');
  pesar(s, '2026-03-01', [{ animal_id: ids['0702'], peso: 300 }]);
  pesar(s, '2026-04-30', [{ animal_id: ids['0702'], peso: 345 }]);
  pesar(s, '2026-03-31', [{ animal_id: ids['0702'], peso: 330 }]);
  const b = ficha(s, ids['0702']);
  assert.deepEqual(ints(b), [['2026-03-01', '2026-03-31', 30, 30, 1, 10, null], ['2026-03-31', '2026-04-30', 15, 30, 0.5, 4.55, null]]);
  assert.deepEqual([b.ganho_acumulado.valor, b.gmd_periodo.valor, b.peso_atual.valor], [45, 0.75, 345]);
});

test('animal que saiu e voltou: o intervalo que atravessa a ausência não tem GMD nem entra no período; o peso da recompra vale', () => {
  const s = S.sistema();
  const id = rebanho(s, ['0801'])['0801'];
  const comp = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Comprador', tipos: ['COMPRADOR', 'FORNECEDOR'] } }, 'parc')).partner_id;
  pesar(s, '2026-02-01', [{ animal_id: id, peso: 300 }]);
  ok(api(s, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-03-01', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: id }], parcelas: [{ data_vencimento: '2026-03-01' }] }, 'venda'));
  ok(api(s, 'evento.registrar', { tipo: 'COMPRA', campos: { event_date: '2026-04-01', partner_id: comp, pasto_destino_id: PASTOS.B, modalidade: 'CABECA', preco_unitario: 320000, valor_animais: 320000 }, animais: [{ animal_id: id, peso: 320 }], parcelas: [{ data_vencimento: '2026-04-01' }] }, 'volta'));
  pesar(s, '2026-06-01', [{ animal_id: id, peso: 380 }]);
  const b = ficha(s, id);
  assert.deepEqual(b.serie.map((x) => [x.data, x.peso_kg, x.tipo]), [['2026-02-01', 300, 'ROTINA'], ['2026-04-01', 320, 'COMPRA'], ['2026-06-01', 380, 'ROTINA']]);
  assert.deepEqual(b.intervalos.map((v) => [v.de, v.ate, v.gmd_kg_dia, v.conta, v.motivo]), [['2026-02-01', '2026-04-01', null, false, 'DADOS_INSUFICIENTES'], ['2026-04-01', '2026-06-01', 0.984, true, null]]);
  assert.match(b.intervalos[0].explicacao, /fora do rebanho entre as duas pesagens/);
  assert.deepEqual([b.ganho_acumulado.valor, b.ganho_acumulado.dias, b.gmd_periodo.valor], [60, 61, 0.984]);
});

test('métodos: fita só entra no GMD com gmd_aceita_fita; estimativa visual e média do lote nunca entram no GMD individual, mas aparecem na série marcadas como estimadas e contam para o peso atual', () => {
  const s = S.sistema();
  const id = rebanho(s, ['0901'])['0901'];
  pesar(s, '2026-03-01', [{ animal_id: id, peso: 300 }]);
  pesar(s, '2026-04-01', [{ animal_id: id, peso: 320 }], { metodo_pesagem: 'FITA' });
  pesar(s, '2026-05-01', [{ animal_id: id, peso: 340 }], { metodo_pesagem: 'ESTIMATIVA_VISUAL' });
  let b = ficha(s, id);
  assert.deepEqual(b.serie.map((x) => [x.metodo, x.individual, x.estimado]), [['BALANCA', true, false], ['FITA', false, false], ['ESTIMATIVA_VISUAL', false, true]]);
  assert.deepEqual([b.intervalos.length, b.peso_atual.valor, b.peso_atual.estimado], [0, 340, true]);
  ok(api(s, 'config.salvar', { valores: { gmd_aceita_fita: 'S' } }, 'fita'));
  b = ficha(s, id);
  assert.deepEqual(ints(b), [['2026-03-01', '2026-04-01', 20, 31, 0.645, 6.67, null]], 'com a fita aceita, 300 → 320 em 31 dias');
});

test('peso ao nascer: o do parto (PESAGENS NASCIMENTO) é o indicador; sem ele, o de referência do parâmetro é só um ponto estimado da curva, fora das pesagens e das contas (P10)', () => {
  const s = S.sistema({ config: { peso_nascer_padrao_kg_femea: '30' } });
  const ids = rebanho(s, ['1001'], { sexo: 'F', castrado: undefined, data_nascimento: '2022-01-01' });
  const parto = (data, crias) => ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: data }, animais: [{ animal_id: ids['1001'] }], crias }, 'parto-' + data));
  const c1 = parto('2026-02-01', [{ situacao_nascimento: 'VIVO', sexo: 'M', peso: 34.5, metodo_pesagem: 'BALANCA' }]).animais.find((a) => a.animal_id !== ids['1001']).animal_id;
  const b1 = ficha(s, c1);
  assert.deepEqual([b1.peso_ao_nascer.valor, b1.peso_ao_nascer.data, b1.ponto_nascer_estimado], [34.5, '2026-02-01', null]);
  // Outra cria (fêmea), sem peso: o ponto de referência (30 kg) na data do nascimento, rotulado; o indicador fica vazio.
  ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-11-01' }, animais: [{ animal_id: ids['1001'] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] }, 'parto-2', ['INTERVALO_PARTO_CURTO']));
  const c2 = s.tabela('ANIMAIS').find((a) => a.mae_id === ids['1001'] && a.data_nascimento === '2026-11-01').animal_id;
  const b2 = ficha(s, c2);
  assert.deepEqual([b2.peso_ao_nascer.valor, b2.peso_ao_nascer.motivo, b2.ponto_nascer_estimado.peso_kg, b2.ponto_nascer_estimado.data], [null, 'DADOS_INSUFICIENTES', 30, '2026-11-01']);
  assert.match(b2.ponto_nascer_estimado.rotulo, /estimado, fora das contas/);
  assert.equal(s.tabela('PESAGENS').filter((p) => p.animal_id === c2).length, 0, 'o peso de referência não vira pesagem');
});

test('projeção dentro do horizonte: a janela de referência ignora a pesagem antiga; o peso de hoje sai estimado (0,750 kg/dia × 30 dias)', () => {
  const s = S.sistema();
  const id = rebanho(s, ['1101'])['1101'];
  pesar(s, '2026-04-01', [{ animal_id: id, peso: 250 }]);
  pesar(s, '2026-08-15', [{ animal_id: id, peso: 300 }]);
  pesar(s, '2026-10-14', [{ animal_id: id, peso: 345 }]);
  const p = ficha(s, id).projecao;
  assert.deepEqual([p.referencia_de, p.gmd_referencia_kg_dia, p.ate, p.pontos, p.hoje], ['2026-08-15', 0.75, '2027-01-12', [{ data: '2026-10-14', peso_kg: 345 }, { data: '2027-01-12', peso_kg: 412.5 }], { data: '2026-11-13', peso_kg: 367.5 }]);
  ok(api(s, 'config.salvar', { valores: { gmd_referencia_janela_dias: '30' } }, 'janela'));
  const sem = ficha(s, id).projecao;
  assert.deepEqual([sem.valor, sem.motivo], [null, 'DADOS_INSUFICIENTES'], 'com a janela de 30 dias não há duas pesagens: sem GMD de referência');
});

test('GMD de lote (07, seção 8.1): 20 cabeças com 6.840 kg em 03/05 e 7.600 kg em 02/07 → (380,0 − 342,0) ÷ 60 = 0,633; com menos de 5 em comum, sem valor', () => {
  const s = S.sistema();
  const brincos = Array.from({ length: 20 }, (_, i) => String(2000 + i));
  const ids = rebanho(s, brincos);
  const lista = brincos.map((b) => ({ animal_id: ids[b] }));
  const a = pesar(s, '2026-05-03', lista, { peso_total_lote_kg: 6840, qtd_cabecas_lote: 20 });
  const b = pesar(s, '2026-07-02', lista, { peso_total_lote_kg: 7600, qtd_cabecas_lote: 20 });
  const d = ok(api(s, 'peso.desempenho', {}));
  assert.deepEqual(d.pesagens.map((x) => x.event_id), [b.event_id, a.event_id], 'do mais recente ao mais antigo');
  const g = d.pesagens[0].gmd_lote;
  assert.deepEqual([g.valor, g.n, g.dias, g.media_de_kg, g.media_ate_kg, g.comparada_com.event_id], [0.633, 20, 60, 342, 380, a.event_id]);
  assert.deepEqual([d.pesagens[0].lote, d.pesagens[0].media_kg, d.pesagens[0].n], [{ total_kg: 7600, cabecas: 20 }, 380, 20]);
  assert.deepEqual([d.pesagens[1].gmd_lote.valor, d.pesagens[1].gmd_lote.motivo], [null, 'DADOS_INSUFICIENTES']);
  // O GMD individual não usa a média do lote: nenhum intervalo na ficha.
  assert.equal(ficha(s, ids['2000']).intervalos.length, 0);
  const s2 = S.sistema();
  const ids2 = rebanho(s2, ['1', '2', '3', '4']);
  const l2 = ['1', '2', '3', '4'].map((x) => ({ animal_id: ids2[x], peso: 300 }));
  n = 1000;
  pesar(s2, '2026-05-03', l2);
  pesar(s2, '2026-07-02', l2.map((x) => ({ animal_id: x.animal_id, peso: 340 })));
  const g2 = ok(api(s2, 'peso.desempenho', {})).pesagens[0].gmd_lote;
  assert.deepEqual([g2.valor, g2.motivo], [null, 'DADOS_INSUFICIENTES']);
});

test('GMD por pasto (ganho dividido pelos dias em cada pasto), por categoria (a do início do intervalo) e do rebanho; filtros de pasto, categoria, sexo e período; n abaixo de 5 sem valor', () => {
  const s = S.sistema();
  const brincos = ['3001', '3002', '3003', '3004', '3005'];
  // Nascidos em 15/04/2024: garrotes até 14/04/2026, novilhos (24 meses) a partir de 15/04/2026.
  const ids = rebanho(s, brincos, { data_nascimento: '2024-04-15' });
  const lista = (peso) => brincos.map((b) => ({ animal_id: ids[b], peso }));
  pesar(s, '2026-03-01', lista(300));
  pesar(s, '2026-04-30', lista(330));
  ok(api(s, 'evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-05-30', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: brincos.map((b) => ({ animal_id: ids[b] })) }, 'transf'));
  pesar(s, '2026-06-29', lista(390));
  const d = ok(api(s, 'peso.desempenho', {}));
  const porPasto = Object.fromEntries(d.por_pasto.map((x) => [x.pasture_id, [x.gmd.valor, x.gmd.n, x.gmd.dias]]));
  // Pasto A: 30 kg em 60 dias + 30 kg nos 30 dias até a transferência = 60 ÷ 90 = 0,667 (5 animais: 300 ÷ 450);
  // Pasto B: os outros 30 dias do segundo intervalo, 30 kg = 1,000.
  assert.deepEqual(porPasto[PASTOS.A], [0.667, 5, 450]);
  assert.deepEqual(porPasto[PASTOS.B], [1, 5, 150]);
  assert.deepEqual([d.geral.gmd.valor, d.geral.gmd.n, d.geral.gmd.ganho_kg, d.geral.gmd.dias], [0.75, 5, 450, 600]);
  const cat = (codigo) => s.tabela('CATEGORIAS').find((c) => c.codigo === codigo).category_id;
  const porCat = Object.fromEntries(d.por_categoria.map((x) => [x.category_id, x.gmd.valor]));
  assert.deepEqual([porCat[cat('GARROTE')], porCat[cat('NOVILHO')]], [0.5, 1], 'o primeiro intervalo começou garrote; o segundo, novilho');
  // Filtros: pasto B → só o ganho atribuído a ele; categoria novilho → só o segundo intervalo; período desde 30/04.
  assert.equal(ok(api(s, 'peso.desempenho', { pasture_id: PASTOS.B })).geral.gmd.valor, 1);
  assert.equal(ok(api(s, 'peso.desempenho', { category_id: cat('NOVILHO') })).geral.gmd.valor, 1);
  assert.equal(ok(api(s, 'peso.desempenho', { de: '2026-04-30' })).geral.gmd.valor, 1);
  const f = ok(api(s, 'peso.desempenho', { sexo: 'F' }));
  assert.deepEqual([f.geral.gmd.valor, f.geral.gmd.n, f.geral.cabecas], [null, 0, 0]);
  // Peso médio no fim do período e a lista por animal.
  assert.deepEqual([d.geral.cabecas, d.geral.peso_medio.valor], [5, 390]);
  assert.deepEqual(d.animais.map((x) => [x.brinco, x.ultima.peso_kg, x.gmd.valor]), brincos.map((b) => [b, 390, 0.75]));
  // Com 4 animais (um estornado da última pesagem não muda: tiramos um do rebanho por uma venda antes de tudo) → sem valor.
  const s2 = S.sistema();
  const ids2 = rebanho(s2, ['1', '2', '3', '4']);
  n = 2000;
  pesar(s2, '2026-03-01', ['1', '2', '3', '4'].map((x) => ({ animal_id: ids2[x], peso: 300 })));
  pesar(s2, '2026-05-01', ['1', '2', '3', '4'].map((x) => ({ animal_id: ids2[x], peso: 330 })));
  const g = ok(api(s2, 'peso.desempenho', {})).geral.gmd;
  assert.deepEqual([g.valor, g.motivo, g.n], [null, 'DADOS_INSUFICIENTES', 4]);
  assert.match(g.explicacao, /Só 4 animais com ganho medido no período \(mínimo 5\)/);
});

test('peso.desempenho: curvas de até 5 animais (série, intervalos e projeção); filtros inválidos são VALIDATION e pasto, categoria ou animal inexistentes, NOT_FOUND; nada é gravado', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['4001', '4002']);
  pesar(s, '2026-08-15', [{ animal_id: ids['4001'], peso: 300 }, { animal_id: ids['4002'], peso: 310 }]);
  pesar(s, '2026-10-14', [{ animal_id: ids['4001'], peso: 345 }, { animal_id: ids['4002'], peso: 340 }]);
  const v0 = s.props()['DATA_VERSION:' + s.banco()];
  const d = ok(api(s, 'peso.desempenho', { animais: [ids['4001'], ids['4002']] }));
  assert.deepEqual(d.curvas.map((c) => [c.brinco, c.serie.length, c.intervalos[0].gmd_kg_dia, c.projecao.rotulo]), [['4001', 2, 0.75, 'Estimativa'], ['4002', 2, 0.5, 'Estimativa']]);
  assert.deepEqual(d.parametros, { intervalo_min_dias: 28, aceita_fita: false, n_minimo: 5, janela_referencia_dias: 120, horizonte_projecao_dias: 90, plausivel_min_kg_dia: -1, plausivel_max_kg_dia: 2, validade_peso_dias: 180 });
  const erro = (dados) => { const r = api(s, 'peso.desempenho', dados); assert.equal(r.ok, false, JSON.stringify(dados)); return [r.error.code, (r.error.details[0] || {}).codigo || null]; };
  assert.deepEqual(erro({ de: '2026-05-01', ate: '2026-04-01' }), ['VALIDATION', 'FAIXA_INVALIDA']);
  assert.deepEqual(erro({ ate: '2026-12-01' }), ['VALIDATION', 'DATA_FUTURA']);
  assert.deepEqual(erro({ de: '31/02/2026' }), ['VALIDATION', 'FORMATO_INVALIDO']);
  assert.deepEqual(erro({ sexo: 'X' }), ['VALIDATION', 'VALOR_FORA_DA_LISTA']);
  assert.deepEqual(erro({ animais: ['a', 'b', 'c', 'd', 'e', 'f'] }), ['VALIDATION', 'VALOR_FORA_DA_FAIXA']);
  assert.deepEqual(erro({ pasture_id: S.id(0xdead) }), ['NOT_FOUND', null]);
  assert.deepEqual(erro({ category_id: S.id(0xbeef) }), ['NOT_FOUND', null]);
  assert.deepEqual(erro({ animais: [S.id(0xcafe)] }), ['NOT_FOUND', null]);
  assert.equal(s.props()['DATA_VERSION:' + s.banco()], v0, 'consulta não grava');
});
