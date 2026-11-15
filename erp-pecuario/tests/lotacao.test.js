'use strict';
/**
 * Inventário histórico e lotação (E2.8; 10-plano-de-implementacao.md, seção 4): situação, sexo e categoria de cada
 * animal e do rebanho numa data passada (04, seção 5; CT-08 pela rota), composição do pasto em data histórica (quem
 * estava, desde quando, categorias; CT-02, inventário anterior), UA, UA/ha e ocupação com o peso vigente na data (07,
 * seção 8.2, com o exemplo do documento), dias de permanência por animal e por pasto num período (05, seção 4.6 e 07,
 * seção 3.3, com os exemplos dos documentos: a base do rateio DIAS_PERMANENCIA), o aviso LOTACAO_ACIMA_DA_CAPACIDADE
 * também em UA/ha (RN-027) e a movimentação do período na "Visão geral" (07, seção 9, itens 4 a 10 e 12, G1, G6 e G7).
 * Depois de CADA comando o apoio confere projeção gravada = reconstrução (Timeline.conferir vazio).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');
const C = require('./apoio-cadastros');
const S = require('./apoio-sistema');

const { js, D0, PASTOS, bicho, entradaInicial, outraEntrada, codigos } = C;

// ------------------------------------------------------------------ linhas puras ----
let SEQ = 0;
/** Linha da linha do tempo (a forma de Timeline.linha), para os testes das funções puras. */
function L(animal, tipo, data, efeito, origem, destino, extra) {
  SEQ++;
  return Object.assign({
    event_id: 'ev-' + SEQ, animal_id: animal, papel: 'SUJEITO', efeito, pasto_origem_id: origem || null, pasto_destino_id: destino || null,
    event_type: tipo, event_subtype: null, event_date: data, event_seq: SEQ, ordem_seq: SEQ, pre_marco_zero: false,
  }, extra || {});
}
const entra = (a, data, pasto) => L(a, 'COMPRA', data, 1, null, pasto);
const move = (a, data, de, para) => L(a, 'TRANSFERENCIA', data, 0, de, para);
const sai = (a, data, pasto, tipo) => L(a, tipo || 'VENDA', data, -1, pasto, null);
function puro() {
  return createGas({ order: 'alpha' }).G;
}
function erroDe(fn) {
  try { fn(); } catch (e) { return { code: e.code, message: e.message, details: js(e.details || []) }; }
  assert.fail('deveria ter lançado');
}

test('05, seção 4.6: arrendamento de R$ 900,00 no Retiro em março/2027 — 31, 16 e 10 dias, base 57; o rateio pelo maior resto dá 489,47, 252,63 e 157,90', () => {
  const G = puro();
  const linhas = [
    entra('A', '2027-01-10', 'RETIRO'),
    entra('B', '2027-01-10', 'SEDE'), move('B', '2027-03-16', 'SEDE', 'RETIRO'),
    entra('C', '2027-02-01', 'RETIRO'), move('C', '2027-03-11', 'RETIRO', 'SEDE'),
    entra('D', '2027-02-01', 'SEDE'),
  ];
  const r = js(G.Timeline.diasPermanencia(linhas, { inicio: '2027-03-01', fim: '2027-03-31' }, { tipo: 'PASTO', ref: 'RETIRO' }, { marcoZero: '2027-01-01' }));
  assert.deepEqual(r.itens.map((x) => [x.animal_id, x.dias]), [['A', 31], ['B', 16], ['C', 10]], 'D nunca esteve no Retiro: fora da base');
  assert.deepEqual([r.base_total, r.n, r.motivo, r.parcial, r.escopo], [57, 3, null, false, { tipo: 'PASTO', ref: 'RETIRO' }]);
  assert.deepEqual(r.itens.find((x) => x.animal_id === 'B').intervalos, [{ inicio: '2027-03-16', fim: '2027-03-31', dias: 16, pasture_id: 'RETIRO' }], 'o dia da entrada conta');
  assert.deepEqual(r.itens.find((x) => x.animal_id === 'C').intervalos, [{ inicio: '2027-03-01', fim: '2027-03-10', dias: 10, pasture_id: 'RETIRO' }], 'o dia da saída não conta');
  const rat = js(G.Utils.ratear(90000, r.itens.map((x) => ({ chave: x.animal_id, base: x.dias }))));
  assert.deepEqual(rat.itens.map((x) => x.valor), [48947, 25263, 15790]);
  assert.equal(rat.totalAlocado, 90000);
});

test('07, seção 3.3: arrendamento de R$ 600,00 do Pasto 2 em junho/2027 — 30, 20 e 15 dias (a morte fecha), base 65; R$ 276,92, 184,62 e 138,46; R$ 9,23 por animal-dia', () => {
  const G = puro();
  const linhas = [
    entra('A1', '2027-05-01', 'P2'),
    entra('A2', '2027-05-01', 'P1'), move('A2', '2027-06-11', 'P1', 'P2'),
    entra('A3', '2027-05-20', 'P2'), sai('A3', '2027-06-16', 'P2', 'MORTE'),
  ];
  const r = js(G.Timeline.diasPermanencia(linhas, { inicio: '2027-06-01', fim: '2027-06-30' }, { tipo: 'PASTO', ref: 'P2' }, { marcoZero: '2027-01-01' }));
  assert.deepEqual(r.itens.map((x) => [x.animal_id, x.dias]), [['A1', 30], ['A2', 20], ['A3', 15]], 'animal já baixado recebe os dias em que esteve presente');
  assert.equal(r.base_total, 65);
  const rat = js(G.Utils.ratear(60000, r.itens.map((x) => ({ chave: x.animal_id, base: x.dias }))));
  assert.deepEqual(rat.itens.map((x) => x.valor), [27692, 18462, 13846], 'o centavo que sobra vai para A2, o maior resto (35/65)');
  assert.equal(Math.round(60000 / r.base_total), 923);
});

test('dias de permanência: nenhum dia em dois pastos (Σ dias nos pastos = dias no rebanho), reentrada, mesmo dia, lista, categoria e marco zero', () => {
  const G = puro();
  const linhas = [
    entra('X', '2027-01-05', 'P1'), move('X', '2027-01-10', 'P1', 'P2'), sai('X', '2027-01-20', 'P2'), entra('X', '2027-01-25', 'P1'),
    entra('Y', '2027-01-15', 'P1'), move('Y', '2027-01-15', 'P1', 'P2'), move('Y', '2027-01-15', 'P2', 'P1'),
    entra('Z', '2027-01-01', 'P2'), L('Z', 'PESAGEM', '2027-01-12', 0, null, null),
    L('W', 'COMPRA', '2026-10-01', 0, null, 'P1', { pre_marco_zero: true }),
  ];
  const per = { inicio: '2027-01-01', fim: '2027-01-31' };
  const reb = js(G.Timeline.diasPermanencia(linhas, per, { tipo: 'REBANHO' }, { marcoZero: '2027-01-01' }));
  assert.deepEqual(reb.itens.map((x) => [x.animal_id, x.dias]), [['X', 22], ['Y', 17], ['Z', 31]], 'X: 5 a 19 e 25 a 31; o histórico de W não conta');
  assert.deepEqual(reb.itens[0].intervalos.map((i) => [i.inicio, i.fim, i.pasture_id]), [['2027-01-05', '2027-01-09', 'P1'], ['2027-01-10', '2027-01-19', 'P2'], ['2027-01-25', '2027-01-31', 'P1']]);
  assert.deepEqual(reb.itens[1].por_pasto, { P1: 17 }, 'ida e volta no mesmo dia não conta dia no P2');
  const p1 = js(G.Timeline.diasPermanencia(linhas, per, { tipo: 'PASTO', ref: 'P1' }, { marcoZero: '2027-01-01' }));
  const p2 = js(G.Timeline.diasPermanencia(linhas, per, { tipo: 'PASTO', ref: 'P2' }, { marcoZero: '2027-01-01' }));
  assert.equal(p1.base_total + p2.base_total, reb.base_total, 'Σ dias nos pastos = dias no rebanho');
  assert.deepEqual(reb.por_pasto, [{ pasture_id: 'P1', dias: 29, animais: 2 }, { pasture_id: 'P2', dias: 41, animais: 2 }]);
  const lista = js(G.Timeline.diasPermanencia(linhas, per, { tipo: 'LISTA', ref: ['Y', 'Z'] }, { marcoZero: '2027-01-01' }));
  assert.deepEqual([lista.base_total, lista.itens.map((x) => x.animal_id)], [48, ['Y', 'Z']]);
  // Categoria: Z vira "adulto" em 16/01 (a categoria muda com a idade); só os dias em que era da categoria contam.
  const cat = (id, dia) => (id === 'Z' && dia >= '2027-01-16' ? 'ADULTO' : 'JOVEM');
  const ad = js(G.Timeline.diasPermanencia(linhas, per, { tipo: 'CATEGORIA', ref: 'ADULTO' }, { marcoZero: '2027-01-01', categoriaEm: cat }));
  assert.deepEqual(ad.itens.map((x) => [x.animal_id, x.dias, x.intervalos.map((i) => [i.inicio, i.fim])]), [['Z', 16, [['2027-01-16', '2027-01-31']]]]);
  const jov = js(G.Timeline.diasPermanencia(linhas, per, { tipo: 'CATEGORIA', ref: 'JOVEM' }, { marcoZero: '2027-01-01', categoriaEm: cat }));
  assert.equal(ad.base_total + jov.base_total, reb.base_total, 'cada dia cai numa categoria só');
  // Marco zero: período antes dele não tem linha do tempo; período que começa antes conta dele em diante.
  const antes = js(G.Timeline.diasPermanencia(linhas, { inicio: '2026-12-01', fim: '2026-12-31' }, { tipo: 'REBANHO' }, { marcoZero: '2027-01-01' }));
  assert.deepEqual([antes.motivo, antes.base_total, antes.itens], ['ANTERIOR_AO_MARCO_ZERO', null, null]);
  const meio = js(G.Timeline.diasPermanencia(linhas, { inicio: '2026-12-01', fim: '2027-01-31' }, { tipo: 'REBANHO' }, { marcoZero: '2027-01-01' }));
  assert.deepEqual([meio.parcial, meio.inicio_efetivo, meio.base_total], [true, '2027-01-01', reb.base_total]);
  const sem = js(G.Timeline.diasPermanencia(linhas, per, { tipo: 'REBANHO' }, {}));
  assert.deepEqual([sem.motivo, sem.n], ['DADOS_INSUFICIENTES', null]);
  const vazio = js(G.Timeline.diasPermanencia(linhas, per, { tipo: 'PASTO', ref: 'NENHUM' }, { marcoZero: '2027-01-01' }));
  assert.deepEqual([vazio.base_total, vazio.n, vazio.itens], [0, 0, []], 'base zero é zero de verdade: ninguém esteve lá');
});

test('dias de permanência: entradas inválidas → VALIDATION com o campo; categoria sem a função → INTERNAL', () => {
  const G = puro();
  const per = { inicio: '2027-01-01', fim: '2027-01-31' };
  const o = { marcoZero: '2027-01-01' };
  const e1 = erroDe(() => G.Timeline.diasPermanencia([], { inicio: '01/01/2027', fim: '2027-01-31' }, { tipo: 'REBANHO' }, o));
  assert.deepEqual([e1.code, codigos(e1), e1.details[0].campo], ['VALIDATION', ['FORMATO_INVALIDO'], 'periodo_inicio']);
  const e2 = erroDe(() => G.Timeline.diasPermanencia([], { inicio: '2027-02-01', fim: '2027-01-31' }, { tipo: 'REBANHO' }, o));
  assert.deepEqual([e2.code, codigos(e2)], ['VALIDATION', ['FAIXA_INVALIDA']]);
  assert.match(e2.message, /O fim do período \(31\/01\/2027\) é anterior ao início \(01\/02\/2027\)/);
  assert.deepEqual(codigos(erroDe(() => G.Timeline.diasPermanencia([], per, { tipo: 'EVENTO' }, o))), ['VALOR_FORA_DA_LISTA']);
  assert.deepEqual(codigos(erroDe(() => G.Timeline.diasPermanencia([], per, { tipo: 'PASTO' }, o))), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(codigos(erroDe(() => G.Timeline.diasPermanencia([], per, { tipo: 'LISTA', ref: 'A' }, o))), ['CAMPO_OBRIGATORIO']);
  assert.equal(erroDe(() => G.Timeline.diasPermanencia([], per, { tipo: 'CATEGORIA', ref: 'X' }, o)).code, 'INTERNAL');
});

test('situação na data (puro): ativo no pasto desde quando, vendido, morto, ainda não entrou; inventário por situação; antes do marco zero null', () => {
  const G = puro();
  const linhas = [
    entra('A', '2027-01-01', 'P1'), move('A', '2027-03-01', 'P1', 'P2'), sai('A', '2027-06-01', 'P2'),
    entra('B', '2027-01-01', 'P1'), sai('B', '2027-02-10', 'P1', 'MORTE'),
    entra('C', '2027-04-01', 'P2'),
    L('D', 'OUTRA_ENTRADA', '2027-01-01', 1, null, null), L('D', 'AJUSTE_INVENTARIO', '2027-05-01', -1, null, null, { event_subtype: 'DIVERGENCIA_CONTAGEM' }),
  ];
  const deA = linhas.filter((l) => l.animal_id === 'A');
  const s = (lin, d) => js(G.Timeline.situacaoEm(lin, d, '2027-01-01'));
  const fev = s(deA, '2027-02-28');
  assert.deepEqual([fev.presente, fev.situacao, fev.pasture_id, fev.no_rebanho_desde, fev.no_pasto_desde, fev.saida], [true, 'ATIVO', 'P1', '2027-01-01', '2027-01-01', null]);
  const mar = s(deA, '2027-03-15');
  assert.deepEqual([mar.pasture_id, mar.no_rebanho_desde, mar.no_pasto_desde, mar.entrada.event_type], ['P2', '2027-01-01', '2027-03-01', 'COMPRA']);
  const jun = s(deA, '2027-06-01');
  assert.deepEqual([jun.presente, jun.situacao, jun.pasture_id, jun.no_pasto_desde, jun.saida.event_type, jun.saida.event_date], [false, 'VENDIDO', null, null, 'VENDA', '2027-06-01'], 'ao fim do dia da venda já saiu');
  assert.equal(s(linhas.filter((l) => l.animal_id === 'C'), '2027-03-31').situacao, 'AINDA_NAO_ENTROU');
  assert.deepEqual([s(deA, '2026-12-31').motivo, s(deA, '2026-12-31').situacao], ['ANTERIOR_AO_MARCO_ZERO', null]);
  assert.equal(js(G.Timeline.situacaoEm(deA, '2027-02-01', null)).motivo, 'DADOS_INSUFICIENTES');
  const inv = js(G.Timeline.inventario(linhas, '2027-05-15', '2027-01-01'));
  assert.deepEqual([inv.total, inv.porPasto, inv.semPasto, inv.porSituacao], [2, { P2: 2 }, 0, { ATIVO: 2, VENDIDO: 0, MORTO: 1, DESCARTADO: 0, BAIXADO_AJUSTE: 1 }]);
  assert.equal(inv.porSituacao.ATIVO, inv.total, 'ATIVO na data = Σ efeito_inventario');
  const jul = js(G.Timeline.inventario(linhas, '2027-07-01', '2027-01-01'));
  assert.deepEqual(jul.porSituacao, { ATIVO: 1, VENDIDO: 1, MORTO: 1, DESCARTADO: 0, BAIXADO_AJUSTE: 1 });
  assert.deepEqual(js(G.Timeline.inventario(linhas, '2026-12-31', '2027-01-01')).porSituacao, null);
  const pres = js(G.Timeline.presentesEm(linhas, '2027-04-01', '2027-01-01'));
  assert.deepEqual(pres.itens.map((x) => [x.animal_id, x.pasture_id, x.no_pasto_desde]), [['A', 'P2', '2027-03-01'], ['C', 'P2', '2027-04-01'], ['D', null, '2027-01-01']]);
});

// ------------------------------------------------------------------ CT-08 pela rota ----
function chamar(s, pedido) {
  return js(s.gas.exec(() => s.G.api(pedido)));
}
function ok(env) {
  assert.equal(env.ok, true, JSON.stringify(env.error));
  return env.data;
}

test('CT-08 pela api(): inventário por pasto, sexo, categoria e situação em 31/12, 31/01, 15/02 e 31/03; o animal vendido na data; estornada a venda, o passado muda', () => {
  const s = S.sistema();
  const animais = [];
  for (let i = 1; i <= 100; i++) animais.push(S.bicho({ brinco: String(800 + i), sexo: i % 2 ? 'F' : 'M', pasto_destino_id: i <= 60 ? S.PASTOS.A : S.PASTOS.B, data_nascimento: '2022-01-01', data_nascimento_confianca: 'ESTIMADA' }));
  const ent = ok(chamar(s, { rota: 'evento.registrar', idempotencyKey: 'ct08-d0', dados: S.entradaInicial(animais) })).animais;
  const noA = ent.slice(0, 60).map((a) => a.animal_id);
  const noB = ent.slice(60).map((a) => a.animal_id);
  const femeasA = ent.slice(0, 60).filter((a) => a.sexo === 'F').map((a) => a.animal_id);
  ok(chamar(s, { rota: 'evento.registrar', idempotencyKey: 'ct08-n1', dados: { tipo: 'NASCIMENTO', campos: { event_date: '2026-01-15' }, animais: [{ animal_id: femeasA[0] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] } }));
  ok(chamar(s, { rota: 'evento.registrar', idempotencyKey: 'ct08-n2', dados: { tipo: 'NASCIMENTO', campos: { event_date: '2026-01-15' }, animais: [{ animal_id: femeasA[1] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M' }] } }));
  ok(chamar(s, { rota: 'evento.registrar', idempotencyKey: 'ct08-t', dados: { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-02-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: noA.slice(10, 20).map((animal_id) => ({ animal_id })) } }));
  const comp = ok(chamar(s, { rota: 'parceiro.salvar', idempotencyKey: 'ct08-p', dados: { campos: { nome: 'Comprador', tipos: 'COMPRADOR' } } })).partner_id;
  const vendidos = noB.slice(0, 5);
  const v = ok(chamar(s, { rota: 'evento.registrar', idempotencyKey: 'ct08-v', dados: { tipo: 'VENDA', campos: { event_date: '2026-02-20', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 400000, valor_bruto: 2000000 }, animais: vendidos.map((animal_id) => ({ animal_id })), parcelas: [{ data_vencimento: '2026-02-20' }] } })).event_id;
  ok(chamar(s, { rota: 'evento.registrar', idempotencyKey: 'ct08-m', dados: { tipo: 'MORTE', campos: { event_date: '2026-03-10', causa: 'DOENCA' }, animais: [{ animal_id: noA[30] }] } }));
  s.conferirProjecoes('CT-08');
  const pos = (dados) => ok(chamar(s, { rota: 'inventario.posicao', dados }));
  const resumo = (data) => {
    const p = pos({ data });
    const por = Object.fromEntries((p.por_pasto || []).map((x) => [x.pasture_id, x.cabecas]));
    return [p.cabecas, por[S.PASTOS.A] || 0, por[S.PASTOS.B] || 0, p.motivo];
  };
  const antes = pos({ data: '2025-12-31' });
  assert.deepEqual([antes.cabecas, antes.motivo, antes.por_situacao, antes.por_sexo, antes.por_categoria], [null, 'ANTERIOR_AO_MARCO_ZERO', null, null, null]);
  assert.deepEqual(resumo('2026-01-31'), [102, 62, 40, null]);
  assert.deepEqual(resumo('2026-02-15'), [102, 52, 50, null]);
  assert.deepEqual(resumo('2026-03-31'), [96, 51, 45, null]);
  const mar = pos({ data: '2026-03-31' });
  assert.deepEqual(mar.por_situacao, { ATIVO: 96, VENDIDO: 5, MORTO: 1, DESCARTADO: 0, BAIXADO_AJUSTE: 0 }, 'situação na data: 100 + 2 = 96 ativos + 5 vendidos + 1 morto');
  const sexoVendidos = vendidos.map((id) => ent.find((a) => a.animal_id === id).sexo);
  const fVend = sexoVendidos.filter((x) => x === 'F').length;
  const fMorta = ent.find((a) => a.animal_id === noA[30]).sexo === 'F' ? 1 : 0;
  assert.deepEqual(mar.por_sexo, { M: 50 + 1 - (5 - fVend) - (1 - fMorta), F: 50 + 1 - fVend - fMorta });
  assert.deepEqual(mar.por_categoria.map((x) => [x.codigo, x.cabecas]), [['VACA', 2], ['BEZERRO', 1], ['BEZERRA', 1], ['NOVILHA_24_MAIS', mar.por_sexo.F - 3], ['BOI', mar.por_sexo.M - 1]],
    'em março as duas que pariram em janeiro são vacas e as crias, bezerros; os nascidos em 2022 são adultos');
  const jan = pos({ data: '2026-01-14' });
  assert.deepEqual(jan.por_categoria.map((x) => x.codigo), ['NOVILHA_24_MAIS', 'BOI'], 'na véspera do parto ainda eram novilhas (categoria na data)');
  // Filtros da posição: pasto, sexo e categoria; por sexo ignora o filtro de sexo e diz isso.
  const soA = pos({ data: '2026-03-31', pasture_id: S.PASTOS.A });
  assert.deepEqual([soA.cabecas, soA.por_pasto.length, soA.etiquetas.por_pasto, soA.filtros], [51, 2, 'todos os pastos', { pasture_id: S.PASTOS.A }]);
  const femeas = pos({ data: '2026-03-31', sexo: 'F' });
  assert.deepEqual([femeas.cabecas, femeas.por_sexo, femeas.etiquetas.por_sexo], [mar.por_sexo.F, mar.por_sexo, 'todos os sexos']);
  const bezerra = ok(chamar(s, { rota: 'sistema.bootstrap', dados: {} })).categorias.find((c) => c.codigo === 'BEZERRA');
  assert.equal(pos({ data: '2026-03-31', category_id: bezerra.category_id }).cabecas, 1);
  // O animal vendido: no Pasto B em 15/02; vendido em 31/03 (saída de 20/02); categoria e peso só enquanto está no rebanho.
  const vend = vendidos[0];
  const em15 = pos({ data: '2026-02-15', animal_id: vend });
  assert.deepEqual([em15.presente, em15.situacao, em15.pasture_id, em15.no_rebanho_desde, em15.no_pasto_desde, em15.categoria.codigo, em15.idade_meses], [true, 'ATIVO', S.PASTOS.B, D0, D0, sexoVendidos[0] === 'F' ? 'NOVILHA_24_MAIS' : 'BOI', 49]);
  assert.deepEqual([em15.peso.situacao, em15.peso.kg], ['SEM_PESO', null], 'sem peso: null, nunca zero');
  const em31 = pos({ data: '2026-03-31', animal_id: vend });
  assert.deepEqual([em31.presente, em31.situacao, em31.pasture_id, em31.saida.event_type, em31.saida.event_date, em31.categoria, em31.peso], [false, 'VENDIDO', null, 'VENDA', '2026-02-20', null, null]);
  // Estornada a venda (em abril, hoje): o inventário de 31/03 passa a 101, e o vendido volta a estar no Pasto B.
  ok(chamar(s, { rota: 'evento.estornar', idempotencyKey: 'ct08-est', dados: { event_id: v, justificativa: 'Venda desfeita' } }));
  s.conferirProjecoes('CT-08 depois do estorno');
  assert.deepEqual(resumo('2026-03-31'), [101, 51, 50, null]);
  assert.deepEqual(pos({ data: '2026-03-31' }).por_situacao, { ATIVO: 101, VENDIDO: 0, MORTO: 1, DESCARTADO: 0, BAIXADO_AJUSTE: 0 });
  assert.deepEqual([pos({ data: '2026-03-31', animal_id: vend }).situacao, pos({ data: '2026-03-31', animal_id: vend }).pasture_id], ['ATIVO', S.PASTOS.B]);
  // Falhas pela rota: data futura, sexo inválido, pasto inexistente, animal inexistente.
  const e = (dados) => chamar(s, { rota: 'inventario.posicao', dados }).error;
  assert.deepEqual([e({ data: '2026-12-01' }).code, e({ data: '2026-12-01' }).details[0].codigo], ['VALIDATION', 'DATA_FUTURA']);
  assert.deepEqual([e({ sexo: 'X' }).code, e({ sexo: 'X' }).details[0].codigo], ['VALIDATION', 'VALOR_FORA_DA_LISTA']);
  assert.equal(e({ pasture_id: S.id(0x404) }).code, 'NOT_FOUND');
  assert.equal(e({ category_id: S.id(0x405) }).code, 'NOT_FOUND');
  assert.equal(e({ property_id: S.id(0x406) }).code, 'NOT_FOUND');
  assert.equal(e({ animal_id: S.id(0x407) }).code, 'NOT_FOUND');
});

// ------------------------------------------------------------------ CT-02: composição do pasto em data ----
function rebanhoCt02() {
  const c = C.ambienteCadastros();
  const m = c.m;
  const animais = [];
  for (let i = 1; i <= 10; i++) animais.push(bicho({ brinco: '02' + String(i).padStart(2, '0'), sexo: i % 2 ? 'F' : 'M', data_nascimento: '2023-01-01', data_nascimento_confianca: 'ESTIMADA' }));
  animais.push(bicho({ brinco: '0211', pasto_destino_id: PASTOS.B }));
  const r = m.run('registrar', entradaInicial(animais));
  const ids = {};
  r.dados.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  const lote = Object.keys(ids).filter((b) => b !== '0211').map((b) => ids[b]);
  m.run('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: lote.map((animal_id) => ({ animal_id })) });
  return { c, m, ids, lote };
}
const painel = (c, dados) => c.ler(c.G.PastureService.consultaPainel(dados));

test('CT-02, inventário anterior: em 28/02 o Pasto 1 tinha os 10 e o Pasto 2 só 0211; em 01/03 o Pasto 2 tem 11, cada um com o "desde quando"; 59 dias no Pasto 1', () => {
  const { c, ids, lote } = rebanhoCt02();
  const fev = painel(c, { pasture_id: PASTOS.A, data: '2026-02-28' });
  assert.deepEqual([fev.data, fev.cabecas, fev.machos, fev.femeas], ['2026-02-28', 10, 5, 5]);
  assert.ok(fev.animais.every((a) => a.no_pasto_desde === D0 && a.no_rebanho_desde === D0), 'no Pasto 1 desde o marco zero');
  assert.deepEqual(fev.por_categoria.map((x) => [x.codigo, x.cabecas]), [['NOVILHA_24_MAIS', 5], ['BOI', 5]], 'nascidos em 01/01/2023: 37 meses em fevereiro de 2026');
  const dez = painel(c, { pasture_id: PASTOS.A, data: '2026-01-01' });
  assert.deepEqual(dez.por_categoria.map((x) => [x.codigo, x.cabecas]), [['NOVILHA_24_MAIS', 5], ['BOI', 5]]);
  assert.deepEqual(painel(c, { pasture_id: PASTOS.A, data: D0 }).por_categoria.map((x) => x.codigo), ['NOVILHA_24_MAIS', 'BOI']);
  assert.equal(painel(c, { pasture_id: PASTOS.B, data: '2026-02-28' }).cabecas, 1);
  const mar = painel(c, { pasture_id: PASTOS.B, data: '2026-03-01' });
  assert.equal(mar.cabecas, 11);
  assert.deepEqual(mar.animais.map((a) => [a.brinco, a.no_pasto_desde]).sort(), Object.keys(ids).map((b) => [b, b === '0211' ? D0 : '2026-03-01']).sort());
  assert.equal(painel(c, { pasture_id: PASTOS.A, data: '2026-03-01' }).cabecas, 0, 'vazio é zero de verdade');
  // Dias de permanência no Pasto 1 de 01/01 a 01/03: o dia da saída não conta (59 dias cada, base 590).
  const perm = painel(c, { pasture_id: PASTOS.A, periodo_inicio: D0, periodo_fim: '2026-03-01' }).permanencia;
  assert.deepEqual([perm.base_total, perm.n, perm.motivo, perm.parcial], [590, 10, null, false]);
  assert.ok(perm.itens.every((x) => x.dias === 59 && x.intervalos.length === 1 && x.intervalos[0].fim === '2026-02-28'));
  assert.deepEqual(perm.itens.map((x) => x.animal_id).sort(), lote.slice().sort());
  const ficha = c.ler(c.G.AnimalService.consultaFicha({ animal_id: ids['0201'] }));
  assert.equal(ficha.pastos.periodos[0].dias, perm.itens[0].dias, 'o bloco D da ficha conta igual (mesma regra das estadas)');
  // O mesmo pela posição do rebanho (inventario.posicao) em 28/02: 10 e 1.
  const p = c.ler(c.G.InventoryService.consultaPosicao({ data: '2026-02-28' }));
  assert.deepEqual(p.por_pasto.map((x) => [x.nome, x.cabecas]), [['Pasto A', 10], ['Pasto B', 1]]);
  // Falhas do painel: período incompleto, invertido, futuro; data futura.
  const t = (d) => c.gas.tentar(() => c.G.UnitOfWork.read(c.amb.ctx(), c.G.PastureService.consultaPainel(d))).erro;
  assert.deepEqual([t({ pasture_id: PASTOS.A, periodo_inicio: D0 }).code, t({ pasture_id: PASTOS.A, periodo_inicio: D0 }).details[0].campo], ['VALIDATION', 'periodo_fim']);
  assert.equal(t({ pasture_id: PASTOS.A, periodo_inicio: '2026-03-02', periodo_fim: '2026-03-01' }).details[0].codigo, 'FAIXA_INVALIDA');
  assert.equal(t({ pasture_id: PASTOS.A, periodo_inicio: D0, periodo_fim: '2026-12-01' }).details[0].codigo, 'DATA_FUTURA');
  const antes = painel(c, { pasture_id: PASTOS.A, periodo_inicio: '2025-12-01', periodo_fim: '2025-12-31' }).permanencia;
  assert.deepEqual([antes.motivo, antes.base_total, antes.itens], ['ANTERIOR_AO_MARCO_ZERO', null, null]);
});

test('composição em data histórica com correção e estorno retroativos: o passado é recalculado com os eventos vigentes hoje', () => {
  const { c, m, lote } = rebanhoCt02();
  const transf = m.tabela('EVENTOS').find((e) => e.event_type === 'TRANSFERENCIA').event_id;
  // Correção: a transferência foi em 15/02, não em 01/03 (mesmos animais): em 20/02 o Pasto 2 já tinha os 11.
  const corr = m.run('corrigir', { event_id: transf, justificativa: 'A data certa é 15/02', campos: { event_date: '2026-02-15', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: lote.map((animal_id) => ({ animal_id })) });
  const em20 = painel(c, { pasture_id: PASTOS.B, data: '2026-02-20' });
  assert.deepEqual([em20.cabecas, em20.animais.filter((a) => a.no_pasto_desde === '2026-02-15').length], [11, 10]);
  assert.equal(painel(c, { pasture_id: PASTOS.A, periodo_inicio: D0, periodo_fim: '2026-03-31' }).permanencia.base_total, 450, '45 dias de cada um (01/01 a 14/02)');
  // Estorno da transferência corrigida: os 10 nunca saíram do Pasto 1.
  m.run('estornar', { event_id: corr.dados.event_id, justificativa: 'Não houve transferência' });
  assert.deepEqual([painel(c, { pasture_id: PASTOS.B, data: '2026-02-20' }).cabecas, painel(c, { pasture_id: PASTOS.A }).cabecas], [1, 10]);
  assert.equal(painel(c, { pasture_id: PASTOS.A, periodo_inicio: D0, periodo_fim: '2026-03-31' }).permanencia.base_total, 900);
});

// ------------------------------------------------------------------ UA, UA/ha e ocupação ----
/** Pasto A com 40 ha e 1,2 UA/ha; 50 cabeças com 19.800 kg na entrada do marco zero (396 kg cada). */
function cinquenta() {
  const c = C.ambienteCadastros();
  c.run('PastureService.comandoSalvarPasto', { pasture_id: PASTOS.A, campos: { area_hectares: 40, capacidade_estimada_ua_ha: 1.2 } });
  const animais = [];
  for (let i = 1; i <= 50; i++) animais.push(bicho({ brinco: 'U' + i, sexo: i % 2 ? 'F' : 'M', data_nascimento: '2022-06-01', data_nascimento_confianca: 'ESTIMADA', peso: 396, metodo_pesagem: 'BALANCA' }));
  c.m.run('registrar', entradaInicial(animais));
  return c;
}

test('07, seção 8.2: 50 cabeças e 19.800 kg dão 44,0 UA; em 40 ha, 1,10 UA/ha; com capacidade de 1,2 UA/ha, ocupação de 91,7%', () => {
  const c = cinquenta();
  const p = painel(c, { pasture_id: PASTOS.A, data: '2026-03-01' });
  assert.deepEqual([p.cabecas, p.peso_vivo_total.valor, p.ua.valor, p.ua.estimado, p.ua_ha.valor, p.ocupacao_pct.valor, p.ocupacao_pct.base], [50, 19800, 44, false, 1.1, 91.7, 'UA_HA']);
  assert.deepEqual(p.acima_da_capacidade, { ua_ha: false, cabecas: null });
  assert.deepEqual([p.peso_medio.valor, p.peso_medio.n, p.peso_medio.pct_estimado], [396, 50, 0]);
  assert.ok(p.animais.every((a) => a.peso.situacao === 'PESADO' && a.peso.kg === 396 && a.peso.data_pesagem === D0), 'peso vigente: o da entrada');
  // Passada a validade (180 dias), o peso da entrada vence: sem peso de referência na categoria, fica o último peso, estimado.
  const ago = painel(c, { pasture_id: PASTOS.A, data: '2026-08-01' });
  assert.deepEqual([ago.ua.valor, ago.ua.estimado, ago.ua.partes.pesagem_vencida.cabecas, ago.ocupacao_pct.estimado], [44, true, 50, true]);
  // A mesma conta na posição do rebanho e na visão geral.
  const pos = c.ler(c.G.InventoryService.consultaPosicao({ data: '2026-03-01' }));
  assert.deepEqual([pos.ua.valor, pos.peso_vivo_total.valor, pos.peso_medio.valor], [44, 19800, 396]);
});

test('peso vigente na data: o da compra e o do nascimento entram na UA daquele dia; sem peso nenhum a UA é null com o motivo, nunca zero', () => {
  const c = C.ambienteCadastros();
  c.run('PastureService.comandoSalvarPasto', { pasture_id: PASTOS.C, campos: { area_hectares: 10, capacidade_estimada_ua_ha: 2 } });
  const vaca = c.m.run('registrar', entradaInicial([bicho({ brinco: 'V1', data_nascimento: '2020-01-01', data_nascimento_confianca: 'ESTIMADA', partos_previos: 1, pasto_destino_id: PASTOS.C })])).dados.animais[0].animal_id;
  const semPeso = painel(c, { pasture_id: PASTOS.C, data: '2026-01-10' });
  assert.deepEqual([semPeso.cabecas, semPeso.ua.valor, semPeso.ua.motivo, semPeso.ua_ha.valor, semPeso.ua_ha.motivo, semPeso.peso_medio.valor, semPeso.ua.sem_peso], [1, null, 'DADOS_INSUFICIENTES', null, 'DADOS_INSUFICIENTES', null, 1]);
  const f = c.run('Config.comandoSalvarParceiro', { campos: { nome: 'Fornecedor', tipos: 'FORNECEDOR' } }).dados.partner_id;
  c.m.run('registrar', { tipo: 'COMPRA', campos: { event_date: '2026-02-01', partner_id: f, pasto_destino_id: PASTOS.C, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 600000 },
    animais: [{ brinco: 'G1', sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14, peso: 300 }, { brinco: 'G2', sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14, peso: 330 }], parcelas: [{ data_vencimento: '2026-03-01' }] });
  c.m.run('registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-02-10' }, animais: [{ animal_id: vaca }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', peso: 32, metodo_pesagem: 'BALANCA' }] });
  const fev = painel(c, { pasture_id: PASTOS.C, data: '2026-02-10' });
  assert.deepEqual([fev.cabecas, fev.peso_vivo_total.valor, fev.ua.valor, fev.ua.sem_peso, fev.ua_ha.valor], [4, 662, 1.47, 1, 0.15], '300 + 330 + 32 kg; a vaca sem peso fica fora da UA e é contada');
  assert.deepEqual(fev.animais.map((a) => [a.brinco || a.codigo_interno, a.peso.kg]).sort(), [['G1', 300], ['G2', 330], ['V1', null], [fev.animais.find((a) => !a.brinco).codigo_interno, 32]].sort());
  const antesDaCompra = painel(c, { pasture_id: PASTOS.C, data: '2026-01-31' });
  assert.deepEqual([antesDaCompra.cabecas, antesDaCompra.ua.valor], [1, null], 'em 31/01 só a vaca, sem peso');
});

test('aviso LOTACAO_ACIMA_DA_CAPACIDADE em UA/ha (RN-027): compra retroativa com o próprio peso, transferência, correção, simulação, as duas capacidades, sem área e política', () => {
  const c = cinquenta();
  const m = c.m;
  const f = c.run('Config.comandoSalvarParceiro', { campos: { nome: 'Fornecedor', tipos: 'FORNECEDOR' } }).dados.partner_id;
  const u = m.tabela('ANIMAIS').filter((a) => /^U[1-5]$/.test(a.brinco)).map((a) => a.animal_id);
  const transf = (data, de, para, ids) => ({ tipo: 'TRANSFERENCIA', campos: { event_date: data, pasto_origem_id: de, pasto_destino_id: para }, animais: ids.map((animal_id) => ({ animal_id })) });
  const compra = (data, animais) => ({ tipo: 'COMPRA', campos: { event_date: data, partner_id: f, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 300000 * animais.length }, animais, parcelas: [{ data_vencimento: '2026-07-01' }] });
  // Um evento posterior já gravado: 5 do Pasto A para o B em 01/05.
  m.run('registrar', transf('2026-05-01', PASTOS.A, PASTOS.B, u));
  // Compra retroativa em 01/03 de 5 vacas de 450 kg (o peso do próprio lançamento): (19.800 + 2.250) ÷ 450 ÷ 40 = 1,225 UA/ha > 1,2.
  const vacas = [];
  for (let i = 1; i <= 5; i++) vacas.push({ brinco: 'N' + i, sexo: 'F', idade_meses: 60, peso: 450 });
  const dados = compra('2026-03-01', vacas);
  const sim = m.simular('registrar', dados);
  assert.deepEqual([sim.ok, sim.valor.dados.avisos.map((a) => a.codigo)], [true, ['LOTACAO_ACIMA_DA_CAPACIDADE']], 'a simulação mostra o mesmo aviso (um caminho só)');
  const e = m.tentar('registrar', dados);
  assert.deepEqual([e.erro.code, codigos(e.erro)], ['NEEDS_CONFIRMATION', ['LOTACAO_ACIMA_DA_CAPACIDADE']]);
  assert.equal(e.erro.details[0].mensagem, 'O pasto Pasto A fica com 1,23 UA/ha em 01/03/2026 (55 cabeças, 49,00 UA em 40 ha), acima da capacidade informada (1,2 UA/ha).');
  const ent = m.run('registrar', dados, { avisos: ['LOTACAO_ACIMA_DA_CAPACIDADE'] });
  assert.deepEqual(js(m.evento(ent.dados.event_id).payload_json).avisos_aceitos, [{ codigo: 'LOTACAO_ACIMA_DA_CAPACIDADE', n: 1 }]);
  const p = painel(c, { pasture_id: PASTOS.A, data: '2026-03-01' });
  assert.deepEqual([p.cabecas, p.ua.valor, p.ua_ha.valor, p.ocupacao_pct.valor, p.acima_da_capacidade.ua_ha], [55, 49, 1.23, 102.1, true]);
  assert.deepEqual([painel(c, { pasture_id: PASTOS.A, data: '2026-02-28' }).cabecas, painel(c, { pasture_id: PASTOS.A, data: '2026-05-01' }).cabecas], [50, 50], 'antes da compra, 50; depois da transferência de 01/05, 50 de novo');
  // Transferência de volta de 1 em 01/06: 51 cabeças, 1,14 UA/ha, sem aviso. Corrigida para os 5: 55 cabeças, aviso na correção.
  const volta = m.run('registrar', transf('2026-06-01', PASTOS.B, PASTOS.A, u.slice(0, 1)));
  const corr = transf('2026-06-01', PASTOS.B, PASTOS.A, u);
  corr.event_id = volta.dados.event_id;
  corr.justificativa = 'Voltaram os cinco';
  const ec = m.tentar('corrigir', corr);
  assert.deepEqual([ec.erro.code, ec.erro.details[0].mensagem], ['NEEDS_CONFIRMATION', 'O pasto Pasto A fica com 1,23 UA/ha em 01/06/2026 (55 cabeças, 49,00 UA em 40 ha), acima da capacidade informada (1,2 UA/ha).']);
  m.run('corrigir', corr, { avisos: ['LOTACAO_ACIMA_DA_CAPACIDADE'] });
  assert.equal(painel(c, { pasture_id: PASTOS.A, data: '2026-06-01' }).cabecas, 55);
  // Compra de 2 bois de 600 kg em 15/06: 57 cabeças, 23.250 kg, 51,67 UA, 1,29 UA/ha.
  const bois = compra('2026-06-15', [{ brinco: 'K1', sexo: 'M', castrado: true, reprodutor: false, idade_meses: 30, peso: 600 }, { brinco: 'K2', sexo: 'M', castrado: true, reprodutor: false, idade_meses: 30, peso: 600 }]);
  assert.equal(m.tentar('registrar', bois).erro.details[0].mensagem, 'O pasto Pasto A fica com 1,29 UA/ha em 15/06/2026 (57 cabeças, 51,67 UA em 40 ha), acima da capacidade informada (1,2 UA/ha).');
  // As duas capacidades estouradas: um aviso só, com as duas contas.
  c.run('PastureService.comandoSalvarPasto', { pasture_id: PASTOS.A, campos: { capacidade_estimada_cabecas: 56 } });
  const duas = m.tentar('registrar', bois);
  assert.deepEqual([codigos(duas.erro), duas.erro.details[0].mensagem], [['LOTACAO_ACIMA_DA_CAPACIDADE'], 'O pasto Pasto A fica com 57 cabeças e 1,29 UA/ha em 15/06/2026, acima da capacidade informada (56 cabeças; 1,2 UA/ha).']);
  // Sem área não há UA/ha: a capacidade em UA/ha não tem com que comparar (e a de cabeças foi tirada).
  c.run('PastureService.comandoSalvarPasto', { pasture_id: PASTOS.A, campos: { area_hectares: null, capacidade_estimada_cabecas: null } });
  const semArea = m.simular('registrar', bois);
  assert.deepEqual([semArea.ok, semArea.valor.dados.avisos], [true, []]);
  c.run('PastureService.comandoSalvarPasto', { pasture_id: PASTOS.A, campos: { area_hectares: 40 } });
  // Política por código: BLOQUEIA vira erro; IGNORA some com o aviso.
  c.run('Config.comandoSalvar', { valores: { avisos_politica: { LOTACAO_ACIMA_DA_CAPACIDADE: 'BLOQUEIA' } } });
  const bl = m.tentar('registrar', bois);
  assert.deepEqual([bl.erro.code, codigos(bl.erro)], ['VALIDATION', ['LOTACAO_ACIMA_DA_CAPACIDADE']]);
  c.run('Config.comandoSalvar', { valores: { avisos_politica: { LOTACAO_ACIMA_DA_CAPACIDADE: 'IGNORA' } } });
  assert.equal(m.tentar('registrar', bois).ok, true);
  assert.equal(painel(c, { pasture_id: PASTOS.A }).cabecas, 57);
});

// ------------------------------------------------------------------ visão geral: movimentação do período ----
/** Rebanho com movimento: 4 no marco zero, 2 compras, 1 parto, 1 venda de 2, 1 morte, 1 descarte e 1 baixa na contagem. */
function movimentado() {
  const s = S.sistema();
  const r = (chave, dados, avisos) => ok(chamar(s, { rota: 'evento.registrar', idempotencyKey: chave, dados, avisosAceitos: avisos || [] }));
  const ent = r('d0', S.entradaInicial([
    S.bicho({ brinco: 'V1', data_nascimento: '2020-01-01', data_nascimento_confianca: 'ESTIMADA', partos_previos: 1 }),
    S.bicho({ brinco: 'V2', data_nascimento: '2020-01-01', data_nascimento_confianca: 'ESTIMADA', partos_previos: 1, pasto_destino_id: S.PASTOS.B }),
    S.bicho({ brinco: 'B1', sexo: 'M', data_nascimento: '2023-01-01', data_nascimento_confianca: 'ESTIMADA', castrado: true }),
    S.bicho({ brinco: 'B2', sexo: 'M', data_nascimento: '2023-01-01', data_nascimento_confianca: 'ESTIMADA', castrado: true, pasto_destino_id: S.PASTOS.B }),
  ])).animais;
  const id = (b) => ent.find((a) => a.brinco === b).animal_id;
  const forn = ok(chamar(s, { rota: 'parceiro.salvar', idempotencyKey: 'pf', dados: { campos: { nome: 'Fornecedor', tipos: 'FORNECEDOR' } } })).partner_id;
  const compr = ok(chamar(s, { rota: 'parceiro.salvar', idempotencyKey: 'pc', dados: { campos: { nome: 'Comprador', tipos: 'COMPRADOR' } } })).partner_id;
  const garrote = (b, sexo) => ({ brinco: b, sexo, castrado: sexo === 'M' ? false : undefined, reprodutor: sexo === 'M' ? false : undefined, idade_meses: 14 });
  const c1 = r('c1', { tipo: 'COMPRA', campos: { event_date: '2026-02-01', partner_id: forn, pasto_destino_id: S.PASTOS.A, modalidade: 'CABECA', preco_unitario: 250000, valor_animais: 500000 }, animais: [garrote('C1', 'M'), garrote('C2', 'F')], parcelas: [{ data_vencimento: '2026-03-01' }] });
  r('c2', { tipo: 'COMPRA', campos: { event_date: '2026-04-15', partner_id: forn, pasto_destino_id: S.PASTOS.B, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 300000 }, animais: [garrote('C3', 'M')], parcelas: [{ data_vencimento: '2026-05-15' }] });
  r('n1', { tipo: 'NASCIMENTO', campos: { event_date: '2026-03-10' }, animais: [{ animal_id: id('V1') }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] });
  const venda = r('v1', { tipo: 'VENDA', campos: { event_date: '2026-05-20', partner_id: compr, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 400000, valor_bruto: 800000 }, animais: [{ animal_id: id('B1') }, { animal_id: id('B2') }], parcelas: [{ data_vencimento: '2026-06-20' }] });
  r('m1', { tipo: 'MORTE', campos: { event_date: '2026-06-05', causa: 'DOENCA' }, animais: [{ animal_id: c1.animais.find((a) => a.brinco === 'C1').animal_id }] });
  r('d1', { tipo: 'DESCARTE', campos: { event_date: '2026-07-01', destino: 'CONSUMO_PROPRIO', motivo: 'IDADE' }, animais: [{ animal_id: id('V2') }] });
  r('a1', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'DIVERGENCIA_CONTAGEM', campos: { event_date: '2026-08-01', justificativa: 'Contagem do curral' }, animais: [{ animal_id: c1.animais.find((a) => a.brinco === 'C2').animal_id }] });
  s.conferirProjecoes('rebanho movimentado');
  return { s, id, venda: venda.event_id };
}
const visao = (s, dados) => chamar(s, { rota: 'dashboard.obter', dados: dados || {} });

test('visão geral (dashboard.obter): movimento do período, receita de vendas, séries mensais e posição em Df; período padrão dos últimos 12 meses', () => {
  const { s, venda } = movimentado();
  const v = ok(visao(s));
  assert.deepEqual(v.periodo, { inicio: '2025-12-01', fim: '2026-11-13', inicio_efetivo: D0, parcial: true, motivo: null }, 'últimos 12 meses; antes do marco zero não há fluxo');
  assert.deepEqual(v.movimento, {
    nascimentos: { cabecas: 1, eventos: 1, motivo: null }, compras: { cabecas: 3, eventos: 2, valor: 800000, motivo: null },
    vendas: { cabecas: 2, eventos: 1, valor: 800000, motivo: null }, mortes: { cabecas: 1, eventos: 1, motivo: null },
    descartes: { cabecas: 1, eventos: 1, motivo: null }, baixas_contagem: { cabecas: 1, eventos: 1, motivo: null },
  });
  assert.deepEqual(v.receita_vendas, { valor: 800000, motivo: null, n: 1, nao_atribuida: 0, base: 'LANCAMENTOS' });
  assert.equal(v.cabecas, 4 + 3 + 1 - 2 - 1 - 1 - 1, 'posição em Df fecha com o movimento');
  assert.deepEqual(v.por_situacao, { ATIVO: 3, VENDIDO: 2, MORTO: 1, DESCARTADO: 1, BAIXADO_AJUSTE: 1 });
  assert.deepEqual(v.series.rebanho.map((x) => [x.mes, x.cabecas, x.motivo]), [
    ['2025-12', null, 'ANTERIOR_AO_MARCO_ZERO'], ['2026-01', 4, null], ['2026-02', 6, null], ['2026-03', 7, null], ['2026-04', 8, null], ['2026-05', 6, null],
    ['2026-06', 5, null], ['2026-07', 4, null], ['2026-08', 3, null], ['2026-09', 3, null], ['2026-10', 3, null], ['2026-11', 3, null],
  ]);
  assert.deepEqual(v.series.nascimentos_mortes.filter((x) => x.nascimentos || x.mortes).map((x) => [x.mes, x.nascimentos, x.mortes]), [['2026-03', 1, 0], ['2026-06', 0, 1]]);
  assert.deepEqual(v.series.compras_vendas.filter((x) => x.compras || x.vendas).map((x) => [x.mes, x.compras, x.valor_compras, x.vendas, x.valor_vendas]), [['2026-02', 2, 500000, 0, 0], ['2026-04', 1, 300000, 0, 0], ['2026-05', 0, 0, 2, 800000]]);
  assert.deepEqual([v.series.compras_vendas[0].motivo, v.series.compras_vendas[0].compras, v.series.nascimentos_mortes[11].fim], ['ANTERIOR_AO_MARCO_ZERO', null, '2026-11-13']);
  // A posição de cada fim de mês é a mesma de inventario.posicao naquela data (um caminho só).
  assert.equal(ok(chamar(s, { rota: 'inventario.posicao', dados: { data: '2026-04-30' } })).cabecas, 8);
  assert.equal(v.titulos.a_receber, 800000, 'os títulos continuam: a parcela da venda');
  // Período curto: só o que caiu nele; zero é informação.
  const mai = ok(visao(s, { data_inicio: '2026-05-01', data_fim: '2026-05-31' }));
  assert.deepEqual([mai.movimento.vendas.cabecas, mai.movimento.compras.cabecas, mai.movimento.nascimentos.cabecas, mai.receita_vendas.valor, mai.cabecas, mai.data], [2, 0, 0, 800000, 6, '2026-05-31']);
  assert.equal(mai.etiquetas.titulos, 'em aberto hoje, sem os filtros');
  // Estornada a venda: o movimento, a receita e a série do rebanho mudam no passado.
  ok(chamar(s, { rota: 'evento.estornar', idempotencyKey: 'est-v', dados: { event_id: venda, justificativa: 'Venda desfeita' } }));
  s.conferirProjecoes('depois do estorno da venda');
  const depois = ok(visao(s));
  assert.deepEqual([depois.movimento.vendas.cabecas, depois.receita_vendas.valor, depois.series.rebanho[5].cabecas, depois.cabecas], [0, 0, 8, 5]);
});

test('visão geral com filtros (07, seção 9): sexo, pasto e categoria nos fluxos pelo atributo do dia; receita pelas alocações; etiquetas do tratamento E', () => {
  const { s } = movimentado();
  const machos = ok(visao(s, { sexo: 'M' }));
  assert.deepEqual([machos.movimento.compras.cabecas, machos.movimento.compras.valor, machos.movimento.vendas.cabecas, machos.movimento.mortes.cabecas, machos.movimento.nascimentos.cabecas], [2, 550000, 2, 1, 0]);
  assert.deepEqual([machos.cabecas, machos.etiquetas.por_sexo, machos.por_sexo], [1, 'todos os sexos', { M: 1, F: 2 }], 'machos e fêmeas ignoram o filtro de sexo');
  assert.deepEqual([machos.receita_vendas.valor, machos.receita_vendas.base, machos.receita_vendas.nao_atribuida], [800000, 'ALOCACOES', 0]);
  const femeas = ok(visao(s, { sexo: 'F' }));
  assert.deepEqual([femeas.receita_vendas.valor, femeas.movimento.nascimentos.cabecas, femeas.movimento.descartes.cabecas, femeas.movimento.baixas_contagem.cabecas], [0, 1, 1, 1]);
  // Pasto: destino na entrada, origem na saída (B2 saiu do B; B1 do A).
  const b = ok(visao(s, { pasture_id: S.PASTOS.B }));
  assert.deepEqual([b.movimento.compras.cabecas, b.movimento.vendas.cabecas, b.receita_vendas.valor, b.movimento.descartes.cabecas, b.etiquetas.por_pasto], [1, 1, 400000, 1, 'todos os pastos']);
  const a = ok(visao(s, { pasture_id: S.PASTOS.A }));
  assert.equal(a.receita_vendas.valor + b.receita_vendas.valor, 800000, 'a receita filtrada por pasto soma a receita toda');
  // Categoria do dia do evento: a cria nasceu bezerra.
  const bezerra = ok(chamar(s, { rota: 'sistema.bootstrap', dados: {} })).categorias.find((x) => x.codigo === 'BEZERRA');
  const bz = ok(visao(s, { category_id: bezerra.category_id }));
  assert.deepEqual([bz.movimento.nascimentos.cabecas, bz.movimento.compras.cabecas, bz.etiquetas.por_categoria], [1, 0, 'todas as categorias']);
  // Propriedade: a do pasto.
  assert.equal(ok(visao(s, { property_id: S.PROP })).movimento.compras.cabecas, 3);
});

test('visão geral: Df antes do marco zero → null em tudo com o motivo; entradas inválidas → VALIDATION ou NOT_FOUND; sem marco zero → DADOS_INSUFICIENTES', () => {
  const { s } = movimentado();
  const pre = ok(visao(s, { data_inicio: '2025-01-01', data_fim: '2025-12-31' }));
  assert.deepEqual([pre.motivo, pre.cabecas, pre.periodo.motivo, pre.movimento.compras.cabecas, pre.movimento.compras.motivo, pre.receita_vendas.valor, pre.receita_vendas.motivo],
    ['ANTERIOR_AO_MARCO_ZERO', null, 'ANTERIOR_AO_MARCO_ZERO', null, 'ANTERIOR_AO_MARCO_ZERO', null, 'ANTERIOR_AO_MARCO_ZERO']);
  assert.ok(pre.series.rebanho.every((x) => x.cabecas === null && x.motivo === 'ANTERIOR_AO_MARCO_ZERO'));
  const e = (dados) => visao(s, dados).error;
  assert.deepEqual([e({ data_fim: '2026-12-01' }).code, e({ data_fim: '2026-12-01' }).details[0].campo], ['VALIDATION', 'data_fim']);
  assert.deepEqual([e({ data_inicio: '2026-06-01', data_fim: '2026-05-01' }).details[0].codigo], ['FAIXA_INVALIDA']);
  assert.equal(e({ data_inicio: '31/05/2026' }).details[0].campo, 'data_inicio');
  assert.equal(e({ sexo: 'Macho' }).code, 'VALIDATION');
  assert.equal(e({ pasture_id: S.id(0x404) }).code, 'NOT_FOUND');
  const vazio = S.sistema({ config: { data_marco_zero: '' } });
  const v = ok(visao(vazio));
  assert.deepEqual([v.motivo, v.periodo.motivo, v.movimento.nascimentos.cabecas, v.series.rebanho], ['DADOS_INSUFICIENTES', 'DADOS_INSUFICIENTES', null, []]);
});
