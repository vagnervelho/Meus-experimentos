'use strict';
/**
 * Fase 4, E4.3 (CONTRATOS, seção 57): o evento RATEIO — o custo compartilhado distribuído entre os animais por cabeça, peso
 * vivo (o peso vigente na data-base), dias de permanência (07, seção 3.3) ou valor digitado; a data-base, a base zero (aviso),
 * o re-rateio (substitui o rateio que valia; as linhas antigas não mudam), o alerta de rateio desatualizado (BASE_RATEIO) e o
 * arrendamento de pasto rateado pelos dias no pasto arrendado — por todo caminho (registro, retroativo, mesmo dia, simulação,
 * correção, correção do substituto, estorno com e sem dependente, estorno da correção), pela api(), com a integridade, a
 * projeção e a identidade das três visões conferidas depois de cada comando; o CT-13 inteiro (a a f).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const TODOS = ['POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'VALOR_DIVERGENTE', 'RATEIO_SEM_PESO', 'CARENCIA_ATIVA', 'RATEIO_BASE_ZERO'];

function montar(dia) {
  const s = S.sistema();
  hoje(s, dia || '2026-07-10');
  s.api = (rota, dados, av, extra) => S.js(s.gas.exec(() => s.G.api(Object.assign({ rota, dados: dados || {}, idempotencyKey: 'k-' + Math.random(), avisosAceitos: av || TODOS }, extra || {}))));
  s.ok = (rota, dados, av, extra) => { const r = s.api(rota, dados, av, extra); assert.equal(r.ok, true, rota + ': ' + String(JSON.stringify(r.error)).slice(0, 1500)); semErro(s, rota); return r.data; };
  s.falha = (rota, dados, av) => { const v = s.versao(); const r = s.api(rota, dados, av); assert.equal(r.ok, false, rota + ' deveria ser recusado'); assert.equal(s.versao(), v, 'a recusa não grava nada'); return r.error; };
  s.versao = () => Number(s.props()['DATA_VERSION:' + s.banco()] || 0);
  s.conta = (cod) => s.tabela('PLANO_CONTAS').find((x) => x.codigo === cod).conta_id;
  s.finDo = (eid) => s.tabela('FINANCEIRO').filter((f) => f.event_id === eid);
  s.rateioDo = (eid) => s.tabela('RATEIOS').filter((r) => r.event_id === eid);
  s.alocs = (ratId) => s.tabela('ALOCACOES_FINANCEIRAS').filter((a) => a.rateio_id === ratId);
  s.animal = (cod) => s.tabela('ANIMAIS').find((a) => a.codigo_interno === cod);
  s.porCodigo = (ratId) => {
    const out = {};
    s.alocs(ratId).forEach((a) => { out[s.tabela('ANIMAIS').find((x) => x.animal_id === a.animal_id).codigo_interno] = [a.base_valor, a.valor_alocado]; });
    return out;
  };
  return s;
}
function hoje(s, d) { s.gas.clock.now = Date.parse(d + 'T15:00:00.000Z'); }
function semErro(s, onde) {
  const rel = s.integridade();
  assert.deepEqual(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3), [], 'integridade sem erro: ' + onde);
  s.conferirProjecoes(onde);
}
const codigos = (e) => (e.details || []).map((d) => d.codigo);

/** Três animais no Pasto A desde o marco zero (A-000001 a A-000003). */
function rebanho(s, n, extra) {
  const animais = [];
  for (let i = 0; i < (n || 3); i++) animais.push(S.bicho(Object.assign({ brinco: String(101 + i), sexo: 'M', data_nascimento: '2024-06-01', data_nascimento_confianca: 'CONFIRMADA' }, extra ? extra(i) : {})));
  const r = s.ok('evento.registrar', S.entradaInicial(animais, { event_date: S.D0 }));
  return s.tabela('ANIMAIS').filter((a) => a.evento_origem_id === r.event_id).sort((a, b) => (a.codigo_interno < b.codigo_interno ? -1 : 1)).map((a) => a.animal_id);
}
function transferir(s, ids, data, de, para) {
  return s.ok('evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: data, pasto_origem_id: de, pasto_destino_id: para }, animais: ids.map((animal_id) => ({ animal_id })) });
}
function avulso(s, campos, parcelas) {
  return { tipo: 'LANCAMENTO_FINANCEIRO', campos: Object.assign({ event_date: '2026-06-01', conta_id: s.conta('OUTROS_GASTOS'), valor: 10000 }, campos || {}), parcelas: parcelas || [{ data_vencimento: '2026-06-05' }] };
}
function rateio(financialId, campos, animais) {
  const d = { tipo: 'RATEIO', campos: Object.assign({ event_date: '2026-07-01', financial_id: financialId }, campos || {}) };
  if (animais) d.animais_rateio = animais;
  return d;
}
/** O caso do arrendamento (07, seção 3.3): A1 e A3 no Pasto B em 01/06, A2 em 11/06, A3 morre em 16/06; R$ 600,00 de junho. */
function arrendamento(s) {
  const ids = rebanho(s, 3);
  transferir(s, [ids[0], ids[2]], '2026-06-01', S.PASTOS.A, S.PASTOS.B);
  transferir(s, [ids[1]], '2026-06-11', S.PASTOS.A, S.PASTOS.B);
  s.ok('evento.registrar', { tipo: 'MORTE', campos: { event_date: '2026-06-16', causa: 'OUTRA' }, animais: [{ animal_id: ids[2] }] });
  const lanc = s.ok('evento.registrar', avulso(s, { conta_id: s.conta('ARRENDAMENTO_PASTO'), valor: 60000, pasture_id: S.PASTOS.B, competencia_inicio: '2026-06-01', competencia_fim: '2026-06-30', descricao: 'Arrendamento do Pasto B' }));
  return { ids, fin: s.finDo(lanc.event_id)[0] };
}

test('arrendamento de pasto: rateado pelos dias de permanência no pasto arrendado (07, seção 3.3); o padrão do servidor e o custo do animal', () => {
  const s = montar();
  const { ids, fin } = arrendamento(s);
  // Sem critério nem escopo: o servidor propõe os dias no pasto arrendado, no período do lançamento.
  const sim = s.ok('evento.simular', { acao: 'registrar', dados: rateio(fin.financial_id) });
  const imp = sim.impactos.rateio;
  assert.deepEqual([imp.criterio, imp.escopo_tipo, imp.escopo_ref, imp.periodo_inicio, imp.periodo_fim, imp.base_total, imp.total_alocado], ['DIAS_PERMANENCIA', 'PASTO', S.PASTOS.B, '2026-06-01', '2026-06-30', 65, 60000]);
  const r = s.ok('evento.registrar', rateio(fin.financial_id));
  const rat = s.rateioDo(r.event_id)[0];
  assert.deepEqual([rat.criterio, rat.escopo_tipo, rat.escopo_ref, rat.periodo_inicio, rat.periodo_fim, rat.data_base, rat.base_total, rat.total_alocado], ['DIAS_PERMANENCIA', 'PASTO', S.PASTOS.B, '2026-06-01', '2026-06-30', null, 65, 60000]);
  // 30, 20 e 15 dias: quotas 27.692,31, 18.461,54 e 13.846,15 centavos; o centavo que sobra vai para A2 (o maior resto, 35/65).
  assert.deepEqual(s.porCodigo(rat.rateio_id), { 'A-000001': [30, 27692], 'A-000002': [20, 18462], 'A-000003': [15, 13846] });
  const ev = s.tabela('EVENTOS').find((e) => e.event_id === r.event_id);
  assert.equal(ev.total_value, 60000);
  assert.match(ev.description, /Arrendamento do Pasto B.*dias de permanência no pasto Pasto B, de 01\/06\/2026 a 30\/06\/2026/);
  // O custo do animal só lê as alocações (07, seção 6): a ficha mostra o arrendamento no custeio de cada um.
  const ficha = s.ok('animal.ficha', { animal_id: ids[0] });
  const doArrend = ficha.financeiro.lancamentos.filter((l) => l.financial_id === fin.financial_id);
  assert.deepEqual(doArrend.map((l) => [l.valor_alocado, l.criterio, l.base_valor, l.base_total]), [[27692, 'DIAS_PERMANENCIA', 30, 65]]);
  assert.equal(ficha.financeiro.custeio, 27692);
  // O lançamento mostra o rateio que vale.
  const det = s.ok('financeiro.lancamento', { financial_id: fin.financial_id });
  assert.equal(det.rateio.event_id, r.event_id);
  assert.equal(det.lancamento.nao_alocado, 0);
});

// ------------------------------------------------------------------ CT-13 (09, seção 3) ----
test('CT-13 (a, b, f): 100,00 por cabeça entre 3 (o centavo para o menor código); 1.500,00 pelo peso vivo vigente na data-base (200, 250 e 310 kg); o re-rateio de (a) é um evento novo e as linhas antigas ficam intactas', () => {
  const s = montar();
  const ids = rebanho(s, 3);
  const l = s.ok('evento.registrar', avulso(s, { event_date: '2026-06-01', valor: 10000, descricao: 'Sal' }));
  const fin = s.finDo(l.event_id)[0];
  // (a) por cabeça, os animais escolhidos; a ordem da lista não muda a saída.
  const ra = s.ok('evento.registrar', rateio(fin.financial_id, { criterio: 'CABECAS', escopo_tipo: 'LISTA', data_base: '2026-06-01' }, [{ animal_id: ids[2] }, { animal_id: ids[0] }, { animal_id: ids[1] }]));
  const rat = s.rateioDo(ra.event_id)[0];
  assert.deepEqual([rat.criterio, rat.base_total, rat.total_alocado, rat.data_base, rat.escopo_tipo, rat.escopo_ref], ['CABECAS', 3, 10000, '2026-06-01', 'LISTA', null]);
  assert.deepEqual(s.porCodigo(rat.rateio_id), { 'A-000001': [1, 3334], 'A-000002': [1, 3333], 'A-000003': [1, 3333] });
  // (f) o re-rateio pede a justificativa e grava outro evento; as linhas do primeiro não mudam e deixam de valer.
  const antes = JSON.stringify([s.rateioDo(ra.event_id), s.alocs(rat.rateio_id)]);
  assert.deepEqual(codigos(s.falha('evento.registrar', rateio(fin.financial_id, { criterio: 'CABECAS', escopo_tipo: 'REBANHO', data_base: '2026-06-01' }))), ['CAMPO_OBRIGATORIO']);
  const rf = s.ok('evento.registrar', rateio(fin.financial_id, { criterio: 'CABECAS', escopo_tipo: 'REBANHO', data_base: '2026-06-01', justificativa_rateio: 'O sal foi para o rebanho todo' }));
  assert.notEqual(rf.event_id, ra.event_id);
  assert.equal(JSON.stringify([s.rateioDo(ra.event_id), s.alocs(rat.rateio_id)]), antes, 'as linhas do rateio antigo ficam como estavam');
  const det = s.ok('financeiro.lancamento', { financial_id: fin.financial_id });
  assert.equal(det.rateio.event_id, rf.event_id, 'vale o rateio do último evento');
  assert.deepEqual(det.rateios.map((x) => [x.event_id, x.vigente]), [[ra.event_id, false], [rf.event_id, true]]);
  // (b) pelo peso vivo vigente na data-base: a última pesagem até ela.
  s.ok('evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-05-20', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids[0], peso: 200 }, { animal_id: ids[1], peso: 250 }, { animal_id: ids[2], peso: 310 }] });
  const l2 = s.ok('evento.registrar', avulso(s, { event_date: '2026-06-01', valor: 150000, descricao: 'Frete do sal' }));
  const fin2 = s.finDo(l2.event_id)[0];
  const rb = s.ok('evento.registrar', rateio(fin2.financial_id, { criterio: 'PESO_VIVO', escopo_tipo: 'PASTO', pasture_id: S.PASTOS.A }));
  const rat2 = s.rateioDo(rb.event_id)[0];
  assert.deepEqual([rat2.base_total, rat2.total_alocado, rat2.data_base], [760, 150000, '2026-06-01']);
  assert.deepEqual(s.porCodigo(rat2.rateio_id), { 'A-000001': [200, 39474], 'A-000002': [250, 49342], 'A-000003': [310, 61184] });
});

test('CT-13 (c, d, e): 900,00 por dias de permanência (31, 16 e 10 dias; 05, seção 4.6); base zero só com o aceite e o motivo gravado; o valor digitado que soma 99,99 de 100,00 é recusado', () => {
  const s = montar('2026-04-10');
  const ids = rebanho(s, 3);
  // A no Pasto B o mês inteiro; B entra em 16/03; C sai em 11/03 (o dia da entrada conta, o da saída não).
  transferir(s, [ids[0], ids[2]], '2026-02-20', S.PASTOS.A, S.PASTOS.B);
  transferir(s, [ids[1]], '2026-03-16', S.PASTOS.A, S.PASTOS.B);
  transferir(s, [ids[2]], '2026-03-11', S.PASTOS.B, S.PASTOS.A);
  const l = s.ok('evento.registrar', avulso(s, { event_date: '2026-03-01', valor: 90000, conta_id: s.conta('ARRENDAMENTO_PASTO'), pasture_id: S.PASTOS.B, competencia_inicio: '2026-03-01', competencia_fim: '2026-03-31', descricao: 'Retiro março' }, [{ data_vencimento: '2026-03-05' }]));
  const fin = s.finDo(l.event_id)[0];
  const rc = s.ok('evento.registrar', rateio(fin.financial_id, { event_date: '2026-04-01' }));
  const rat = s.rateioDo(rc.event_id)[0];
  assert.deepEqual([rat.base_total, rat.total_alocado], [57, 90000]);
  assert.deepEqual(s.porCodigo(rat.rateio_id), { 'A-000001': [31, 48947], 'A-000002': [16, 25263], 'A-000003': [10, 15790] });
  // (d) base zero: ninguém no Pasto B em janeiro; o aviso pede o aceite, e o rateio é gravado com nada alocado e o motivo.
  const l0 = s.ok('evento.registrar', avulso(s, { event_date: '2026-01-05', valor: 5000, descricao: 'Cerca' }, [{ data_vencimento: '2026-01-10' }]));
  const f0 = s.finDo(l0.event_id)[0];
  const pedido = rateio(f0.financial_id, { event_date: '2026-02-01', criterio: 'DIAS_PERMANENCIA', escopo_tipo: 'PASTO', pasture_id: S.PASTOS.B, periodo_inicio: '2026-01-01', periodo_fim: '2026-01-31' });
  const semAceite = s.api('evento.registrar', pedido, TODOS.filter((c) => c !== 'RATEIO_BASE_ZERO'));
  assert.equal(semAceite.ok, false);
  assert.equal(semAceite.error.code, 'NEEDS_CONFIRMATION');
  assert.deepEqual(codigos(semAceite.error), ['RATEIO_BASE_ZERO']);
  const rz = s.ok('evento.registrar', pedido);
  const z = s.rateioDo(rz.event_id)[0];
  assert.deepEqual([z.total_alocado, z.base_total, s.alocs(z.rateio_id).length], [0, 0, 0]);
  assert.match(z.justificativa, /^Base zero: nenhum animal no pasto Pasto B de 01\/01\/2026 a 31\/01\/2026\./);
  assert.equal(s.ok('financeiro.lancamento', { financial_id: f0.financial_id }).lancamento.nao_alocado, 5000);
  // (e) o valor digitado tem de fechar com o valor a ratear (RN-071).
  const l3 = s.ok('evento.registrar', avulso(s, { event_date: '2026-04-01', valor: 10000, descricao: 'Remédio' }, [{ data_vencimento: '2026-04-05' }]));
  const f3 = s.finDo(l3.event_id)[0];
  const manual = (v) => rateio(f3.financial_id, { event_date: '2026-04-01', criterio: 'MANUAL', escopo_tipo: 'LISTA', justificativa_rateio: 'Tratamento de dois', data_base: '2026-04-01' }, [{ animal_id: ids[0], valor: v[0] }, { animal_id: ids[1], valor: v[1] }]);
  const e = s.falha('evento.registrar', manual([5000, 4999]));
  assert.equal(e.code, 'VALIDATION');
  assert.deepEqual(codigos(e), ['RATEIO_NAO_FECHA']);
  const rm = s.ok('evento.registrar', manual([6000, 4000]));
  assert.deepEqual(s.porCodigo(s.rateioDo(rm.event_id)[0].rateio_id), { 'A-000001': [60, 6000], 'A-000002': [40, 4000] });
});

test('CT-13: 1.000 sorteios com semente fixa — a soma fecha ao centavo, a ordem de entrada não muda a saída e o desempate é maior resto, maior base, menor código', () => {
  const G = S.sistema({ semCadastro: true }).G;
  let x = 20261118;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  for (let k = 0; k < 1000; k++) {
    const n = 1 + Math.floor(rnd() * 9);
    const valor = 1 + Math.floor(rnd() * 5000000);
    const itens = [];
    for (let i = 0; i < n; i++) itens.push({ animal_id: 'a' + i, chave: 'A-' + String(100 + i), base: Math.round(rnd() * 3) === 0 ? 1 : Math.round(rnd() * 5000) / 10 + 0.1 });
    const r = G.FinancialService.ratear(valor, 'PESO_VIVO', itens);
    assert.equal(r.itens.reduce((t, y) => t + y.valor, 0), valor, 'soma exata no sorteio ' + k);
    const emb = itens.slice().reverse();
    const r2 = G.FinancialService.ratear(valor, 'PESO_VIVO', emb);
    const porId = (rr) => Object.fromEntries(rr.itens.map((y) => [y.animal_id, y.valor]));
    assert.deepEqual(porId(r2), porId(r), 'a entrada embaralhada dá a mesma saída');
  }
});

// ------------------------------------------------------------------ os caminhos ----
test('caminhos: correção sem mudança (a base gravada fica, mesmo com a transferência retroativa que a mudaria), correção do período, correção do substituto, estorno que devolve o rateio anterior e estorno da correção', () => {
  const s = montar();
  const { ids, fin } = arrendamento(s);
  const r1 = s.ok('evento.registrar', rateio(fin.financial_id));
  // Uma transferência retroativa muda os dias no Pasto B: o rateio fica desatualizado (alerta), nunca recalculado em silêncio.
  transferir(s, [ids[1]], '2026-06-21', S.PASTOS.B, S.PASTOS.A);
  const rel = s.integridade();
  const alerta = rel.achados.filter((a) => a.checagem === 'BASE_RATEIO');
  assert.equal(alerta.length, 1);
  assert.match(alerta[0].mensagem, /desatualizado/);
  const det = s.ok('financeiro.lancamento', { financial_id: fin.financial_id });
  assert.deepEqual(det.rateio.desatualizado.diferencas.map((x) => [x.codigo_interno, x.gravada, x.hoje]), [['A-000002', 20, 10]]);
  // Correção sem mudança (a entrada do servidor): grava a mesma base e os mesmos valores (a base é a observação do rateio).
  const ent = s.ok('evento.obter', { event_id: r1.event_id }).correcao;
  assert.deepEqual([ent.campos.financial_id, ent.campos.criterio, ent.campos.escopo_tipo, ent.campos.pasture_id, ent.campos.periodo_inicio], [fin.financial_id, 'DIAS_PERMANENCIA', 'PASTO', S.PASTOS.B, undefined]);
  const c1 = s.ok('evento.corrigir', Object.assign({}, ent, { event_id: r1.event_id, justificativa: 'Conferido' }));
  assert.deepEqual(s.porCodigo(s.rateioDo(c1.event_id)[0].rateio_id), { 'A-000001': [30, 27692], 'A-000002': [20, 18462], 'A-000003': [15, 13846] });
  // Correção do período (uma entrada da base): a base é refeita pela conta de hoje.
  const c2 = s.ok('evento.corrigir', { event_id: c1.event_id, justificativa: 'Só a primeira quinzena', mudanca: { campos: { periodo_inicio: '2026-06-01', periodo_fim: '2026-06-15' } } });
  const r2 = s.rateioDo(c2.event_id)[0];
  assert.deepEqual([r2.periodo_inicio, r2.periodo_fim, r2.base_total], ['2026-06-01', '2026-06-15', 35]);
  // 600,00 × 15/35, 5/35 e 15/35: restos de 10, 15 e 10 (em 35); o centavo que sobra vai para A2.
  assert.deepEqual(s.porCodigo(r2.rateio_id), { 'A-000001': [15, 25714], 'A-000002': [5, 8572], 'A-000003': [15, 25714] });
  // A correção pela mudança (só o período) e a correção do substituto: a do substituto volta ao período do lançamento.
  const c3 = s.ok('evento.corrigir', { event_id: c2.event_id, justificativa: 'O mês inteiro', mudanca: { campos: { periodo_inicio: null, periodo_fim: null } } });
  // Base de 55 dias (A2 saiu em 21/06): restos 15, 5 e 35 (em 55); o centavo vai para A3.
  assert.deepEqual(s.porCodigo(s.rateioDo(c3.event_id)[0].rateio_id), { 'A-000001': [30, 32727], 'A-000002': [10, 10909], 'A-000003': [15, 16364] });
  assert.equal(s.integridade().achados.filter((a) => a.checagem === 'BASE_RATEIO').length, 0, 'refeito, não está mais desatualizado');
  // Re-rateio manual; o estorno dele devolve o rateio anterior (o da correção), e o estorno da correção deixa o lançamento sem rateio.
  const re = s.ok('evento.registrar', rateio(fin.financial_id, { event_date: '2026-07-05', criterio: 'DIAS_PERMANENCIA', escopo_tipo: 'PASTO', pasture_id: S.PASTOS.B, periodo_inicio: '2026-06-01', periodo_fim: '2026-06-10', justificativa_rateio: 'Só os dez primeiros dias' }));
  assert.equal(s.ok('financeiro.lancamento', { financial_id: fin.financial_id }).rateio.event_id, re.event_id);
  const simEst = s.ok('evento.simular', { acao: 'estornar', dados: { event_id: re.event_id, justificativa: 'Errado' } });
  assert.equal(simEst.impactos.rateio.volta.event_id, c3.event_id);
  s.ok('evento.estornar', { event_id: re.event_id, justificativa: 'Errado' });
  assert.equal(s.ok('financeiro.lancamento', { financial_id: fin.financial_id }).rateio.event_id, c3.event_id);
  s.ok('evento.estornar', { event_id: c3.event_id, justificativa: 'Sem rateio' });
  const sem = s.ok('financeiro.lancamento', { financial_id: fin.financial_id });
  assert.equal(sem.rateio, null);
  assert.equal(sem.lancamento.nao_alocado, 60000);
  assert.equal(s.ok('animal.ficha', { animal_id: ids[0] }).financeiro.custeio, 0, 'o custo do animal só lê as alocações que valem');
});

test('a correção da posição: o substituto de um rateio antigo fica no lugar dele, e o re-rateio registrado depois continua valendo; no mesmo dia vale o registrado por último', () => {
  const s = montar();
  const ids = rebanho(s, 3);
  const l = s.ok('evento.registrar', avulso(s, { valor: 9000, descricao: 'Mão de obra' }));
  const fin = s.finDo(l.event_id)[0];
  const r1 = s.ok('evento.registrar', rateio(fin.financial_id, { criterio: 'CABECAS', escopo_tipo: 'REBANHO', data_base: '2026-06-01' }));
  const r2 = s.ok('evento.registrar', rateio(fin.financial_id, { criterio: 'CABECAS', escopo_tipo: 'LISTA', data_base: '2026-06-01', justificativa_rateio: 'Só dois' }, [{ animal_id: ids[0] }, { animal_id: ids[1] }]));
  s.ok('evento.corrigir', { event_id: r1.event_id, justificativa: 'Observação', mudanca: { campos: { notes: 'Conferido no caderno' } } });
  assert.equal(s.ok('financeiro.lancamento', { financial_id: fin.financial_id }).rateio.event_id, r2.event_id, 'a correção do primeiro não passa na frente do re-rateio');
  // Retroativo: um rateio datado antes do que vale, registrado depois, passa a valer dali em diante (o último registrado).
  const r3 = s.ok('evento.registrar', rateio(fin.financial_id, { event_date: '2026-06-02', criterio: 'CABECAS', escopo_tipo: 'LISTA', data_base: '2026-06-01', justificativa_rateio: 'Só um' }, [{ animal_id: ids[2] }]));
  const rat3 = s.rateioDo(r3.event_id)[0];
  assert.deepEqual([rat3.criterio, rat3.base_total, s.porCodigo(rat3.rateio_id)], ['DIRETO', 90, { 'A-000003': [90, 9000] }]);
  assert.equal(s.tabela('EVENTOS').find((e) => e.event_id === r3.event_id).payload_json.criterio_pedido, 'CABECAS', 'o critério pedido fica no evento (o rateio de um animal é DIRETO)');
  assert.equal(s.tabela('FINANCEIRO').find((f) => f.financial_id === fin.financial_id).animal_id, ids[2], 'a alocação direta projeta o animal do lançamento');
  const ent = s.ok('evento.obter', { event_id: r3.event_id }).correcao;
  assert.deepEqual([ent.campos.criterio, ent.animais_rateio], ['CABECAS', [{ animal_id: ids[2] }]]);
  s.ok('evento.corrigir', Object.assign({}, ent, { event_id: r3.event_id, justificativa: 'Conferido' }));
});

test('dependente: o lançamento rateado depois não se estorna nem se corrige sem estornar o rateio antes (RATEIO_DEPENDENTE, com o link); depois do estorno do rateio, sim', () => {
  const s = montar();
  const { fin } = arrendamento(s);
  const r = s.ok('evento.registrar', rateio(fin.financial_id));
  const e1 = s.falha('evento.estornar', { event_id: fin.event_id, justificativa: 'Errado' });
  assert.equal(e1.code, 'CONFLICT');
  assert.deepEqual(codigos(e1), ['RATEIO_DEPENDENTE']);
  assert.equal(e1.details[0].conflito.event_id, r.event_id);
  const e2 = s.falha('evento.corrigir', { event_id: fin.event_id, justificativa: 'Valor', mudanca: { campos: { valor: 61000 } } });
  assert.deepEqual(codigos(e2), ['RATEIO_DEPENDENTE']);
  s.ok('evento.estornar', { event_id: r.event_id, justificativa: 'Vou corrigir o lançamento' });
  const c = s.ok('evento.corrigir', { event_id: fin.event_id, justificativa: 'Valor', mudanca: { campos: { valor: 61000 } } });
  const novo = s.finDo(c.event_id)[0];
  const r2 = s.ok('evento.registrar', rateio(novo.financial_id));
  assert.equal(s.rateioDo(r2.event_id)[0].total_alocado, 61000);
  // Rateio de lançamento que não vale mais: recusado.
  assert.deepEqual(codigos(s.falha('evento.registrar', rateio(fin.financial_id))), ['JA_ANULADO']);
});

test('compra: o frete re-rateado por cabeça entre os animais da compra muda o custo de aquisição; fora da compra ou em parte é recusado; a conta numa data antes do re-rateio não muda (regra de tempo)', () => {
  const s = montar('2026-05-10');
  const f = s.ok('parceiro.salvar', { campos: { nome: 'Fornecedor', tipos: ['FORNECEDOR'] } }).partner_id;
  const tr = s.ok('parceiro.salvar', { campos: { nome: 'Frete', tipos: ['TRANSPORTADOR'] } }).partner_id;
  const g = (b, peso) => ({ brinco: b, sexo: 'M', data_nascimento: '2024-06-01', data_nascimento_confianca: 'ESTIMADA', castrado: true, reprodutor: false, peso });
  const c = s.ok('evento.registrar', {
    tipo: 'COMPRA', campos: { event_date: '2026-02-05', partner_id: f, pasto_destino_id: S.PASTOS.A, modalidade: 'KG_VIVO', preco_unitario: 1000, valor_animais: 760000 },
    animais: [g('201', 200), g('202', 250), g('203', 310)], parcelas: [{ data_vencimento: '2026-03-05' }], custos: [{ tipo: 'FRETE', valor: 150000, partner_id: tr }],
  });
  const ids = c.animais.map((a) => a.animal_id);
  const frete = s.finDo(c.event_id).find((x) => x.valor === 150000);
  const custo = () => ids.map((id) => s.tabela('ANIMAIS').find((a) => a.animal_id === id).custo_aquisicao);
  assert.deepEqual(custo(), [200000 + 39474, 250000 + 49342, 310000 + 61184], 'o frete pelo peso da compra');
  // Um dos animais é vendido em março: o custo dele sai no resultado de março.
  s.ok('evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-03-20', partner_id: f, finalidade: 'ABATE', modalidade: 'CABECA', preco_unitario: 400000, valor_bruto: 400000 }, animais: [{ animal_id: ids[0] }], parcelas: [{ data_vencimento: '2026-04-20' }] });
  const antes = s.ok('financeiro.conciliacao', { ate: '2026-03-31' });
  assert.equal(s.falha('evento.registrar', rateio(frete.financial_id, { event_date: '2026-04-10', criterio: 'CABECAS', escopo_tipo: 'REBANHO', data_base: '2026-04-10', justificativa_rateio: 'x' })).details[0].codigo, 'ESCOPO_DO_REGISTRO');
  assert.equal(s.falha('evento.registrar', rateio(frete.financial_id, { event_date: '2026-04-10', criterio: 'CABECAS', escopo_tipo: 'EVENTO', valor: 100000, justificativa_rateio: 'x' })).details[0].codigo, 'RATEIO_INCOMPLETO');
  const rr = s.ok('evento.registrar', rateio(frete.financial_id, { event_date: '2026-04-10', criterio: 'CABECAS', justificativa_rateio: 'O frete é por cabeça' }));
  assert.deepEqual(s.rateioDo(rr.event_id).map((x) => [x.criterio, x.escopo_tipo, x.escopo_ref, x.data_base]), [['CABECAS', 'EVENTO', c.event_id, '2026-02-05']]);
  assert.deepEqual(custo(), [200000 + 50000, 250000 + 50000, 310000 + 50000], 'o custo de aquisição só lê as alocações que valem');
  // A conciliação até 31/03 (antes do re-rateio) não muda; pedida hoje, março leva o custo novo do vendido.
  assert.deepEqual(s.ok('financeiro.conciliacao', { ate: '2026-03-31' }), antes);
  const hojeC = s.ok('financeiro.conciliacao', { ate: '2026-05-10' });
  assert.equal(hojeC.fecha, true);
  assert.equal(hojeC.meses.find((m) => m.mes === '2026-03').resultado.custo_aquisicao.vendidos_descartados, 239474, 'pedido no fim de março, o rateio de março');
  assert.equal(hojeC.periodo.termos.custo_rebanho_ativo, 300000 + 360000);
});

test('o animal vendido no meio do período recebe os dias em que esteve; a venda, a pesagem e a transferência lançadas depois deixam o rateio desatualizado (BASE_RATEIO), nunca refeito em silêncio', () => {
  const s = montar();
  const ids = rebanho(s, 3);
  const comprador = s.ok('parceiro.salvar', { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } }).partner_id;
  s.ok('evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-06-11', partner_id: comprador, finalidade: 'ABATE', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: ids[2] }], parcelas: [{ data_vencimento: '2026-07-11' }] });
  const l = s.ok('evento.registrar', avulso(s, { valor: 25000, descricao: 'Sal de junho', competencia_inicio: '2026-06-01', competencia_fim: '2026-06-30' }));
  const fin = s.finDo(l.event_id)[0];
  const r = s.ok('evento.registrar', rateio(fin.financial_id, { criterio: 'DIAS_PERMANENCIA', escopo_tipo: 'REBANHO' }));
  // A3 saiu em 11/06 (o dia da saída não conta): 10 dias; A1 e A2, 30. Restos 20, 20 e 30 (em 70): o centavo vai para A3.
  assert.deepEqual(s.porCodigo(s.rateioDo(r.event_id)[0].rateio_id), { 'A-000001': [30, 10714], 'A-000002': [30, 10714], 'A-000003': [10, 3572] });
  assert.equal(s.integridade().achados.filter((a) => a.checagem === 'BASE_RATEIO').length, 0);
  // A venda de A2 em 21/06, lançada depois: A2 passa a ter 20 dias.
  s.ok('evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-06-21', partner_id: comprador, finalidade: 'ABATE', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: ids[1] }], parcelas: [{ data_vencimento: '2026-07-21' }] });
  const alerta = s.integridade().achados.filter((a) => a.checagem === 'BASE_RATEIO');
  assert.equal(alerta.length, 1);
  assert.equal(alerta[0].severidade, 'ALERTA');
  assert.match(alerta[0].mensagem, /A-000002 \(brinco 102\) \(30 → 20\)/);
  assert.deepEqual(s.porCodigo(s.rateioDo(r.event_id)[0].rateio_id), { 'A-000001': [30, 10714], 'A-000002': [30, 10714], 'A-000003': [10, 3572] }, 'nada muda sozinho');
  // Pelo peso vivo: a pesagem retroativa antes da data-base muda o peso vigente.
  s.ok('evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-05-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids[0], peso: 300 }] });
  const l2 = s.ok('evento.registrar', avulso(s, { event_date: '2026-06-01', valor: 1000, descricao: 'Ração' }));
  const f2 = s.finDo(l2.event_id)[0];
  const r2 = s.ok('evento.registrar', rateio(f2.financial_id, { criterio: 'PESO_VIVO', escopo_tipo: 'LISTA', data_base: '2026-06-01' }, [{ animal_id: ids[0] }]));
  assert.deepEqual(s.rateioDo(r2.event_id).map((x) => [x.criterio, x.data_base]), [['DIRETO', '2026-06-01']]);
  s.ok('evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-05-20', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids[0], peso: 320 }] });
  assert.equal(s.integridade().achados.filter((a) => a.checagem === 'BASE_RATEIO').length, 1, 'o rateio direto pelo peso continua o mesmo: um animal só');
});

test('recusas com o caminho: natureza que não se rateia, lançamento anterior ao marco zero, rateio antes do lançamento, critério fora do escopo, campo que não se aplica, animal fora da lista, peso estimado só com o aviso RATEIO_SEM_PESO, sem peso nenhum', () => {
  const s = montar();
  const ids = rebanho(s, 3);
  const naoOp = s.finDo(s.ok('evento.registrar', avulso(s, { conta_id: s.conta('APORTES'), valor: 100000 })).event_id)[0];
  assert.deepEqual(codigos(s.falha('evento.registrar', rateio(naoOp.financial_id, { criterio: 'CABECAS', escopo_tipo: 'REBANHO' }))), ['NATUREZA_SEM_RATEIO']);
  const fin = s.finDo(s.ok('evento.registrar', avulso(s, { event_date: '2026-06-10', valor: 3000 })).event_id)[0];
  assert.deepEqual(codigos(s.falha('evento.registrar', rateio(fin.financial_id, { event_date: '2026-06-09', criterio: 'CABECAS', escopo_tipo: 'REBANHO' }))), ['RATEIO_ANTES_DO_LANCAMENTO']);
  assert.deepEqual(codigos(s.falha('evento.registrar', rateio(fin.financial_id, { criterio: 'DIAS_PERMANENCIA', escopo_tipo: 'EVENTO' }))), ['CRITERIO_DO_ESCOPO']);
  assert.deepEqual(codigos(s.falha('evento.registrar', rateio(fin.financial_id, { criterio: 'CABECAS', escopo_tipo: 'REBANHO', periodo_inicio: '2026-06-01', periodo_fim: '2026-06-30' }))).sort(), ['CAMPO_NAO_SE_APLICA', 'CAMPO_NAO_SE_APLICA']);
  assert.deepEqual(codigos(s.falha('evento.registrar', rateio(fin.financial_id, { criterio: 'DIAS_PERMANENCIA', escopo_tipo: 'REBANHO' }))), ['CAMPO_OBRIGATORIO', 'CAMPO_OBRIGATORIO']);
  assert.deepEqual(codigos(s.falha('evento.registrar', rateio(fin.financial_id, { criterio: 'CABECAS', escopo_tipo: 'EVENTO' }))), ['ESCOPO_SEM_ANIMAIS']);
  assert.deepEqual(codigos(s.falha('evento.registrar', rateio(fin.financial_id, { criterio: 'CABECAS', escopo_tipo: 'LISTA', data_base: '2025-12-01' }, [{ animal_id: ids[0] }]))), ['ANTES_DO_MARCO_ZERO']);
  assert.deepEqual(codigos(s.falha('evento.registrar', rateio(fin.financial_id, { criterio: 'CABECAS', escopo_tipo: 'LISTA' }, [{ animal_id: ids[0] }, { animal_id: ids[0] }]))), ['ANIMAL_REPETIDO']);
  assert.deepEqual(codigos(s.falha('evento.registrar', rateio(fin.financial_id, { criterio: 'CABECAS', escopo_tipo: 'REBANHO', valor: 3001 }))), ['VALOR_FORA_DA_FAIXA']);
  // Um animal que só entra depois da data-base não estava no rebanho nela.
  const outra = s.ok('evento.registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-06-20', description: 'Doação' }, animais: [S.bicho({ brinco: '900', sexo: 'F', pasto_destino_id: S.PASTOS.A })] });
  const e = s.falha('evento.registrar', rateio(fin.financial_id, { criterio: 'CABECAS', escopo_tipo: 'LISTA', data_base: '2026-06-10' }, [{ animal_id: outra.animais[0].animal_id }]));
  assert.deepEqual([e.details[0].codigo, e.details[0].campo, e.details[0].animal_id], ['FORA_DO_ESCOPO', 'animais_rateio', outra.animais[0].animal_id]);
  // Sem pesagem: o peso de referência da categoria entra estimado, só com o aceite (RN-073); sem referência nenhuma, recusa.
  const sem = s.api('evento.registrar', rateio(fin.financial_id, { criterio: 'PESO_VIVO', escopo_tipo: 'REBANHO', data_base: '2026-06-10' }), TODOS.filter((c) => c !== 'RATEIO_SEM_PESO'));
  const cats = s.tabela('CATEGORIAS').filter((c) => typeof c.peso_referencia_kg === 'number').length;
  if (cats) {
    assert.equal(sem.error.code, 'NEEDS_CONFIRMATION');
    assert.deepEqual(codigos(sem.error), ['RATEIO_SEM_PESO']);
    const rp = s.ok('evento.registrar', rateio(fin.financial_id, { criterio: 'PESO_VIVO', escopo_tipo: 'REBANHO', data_base: '2026-06-10' }));
    assert.deepEqual(s.tabela('EVENTOS').find((x) => x.event_id === rp.event_id).payload_json.avisos_aceitos.map((a) => a.codigo), ['RATEIO_SEM_PESO']);
  } else assert.deepEqual(codigos(sem.error), ['SEM_PESO', 'SEM_PESO', 'SEM_PESO']);
});

test('o lançamento do próprio registro: o custo da morte e a aplicação re-rateados só entre os animais dele e por inteiro; a cópia do custo na aplicação é do rateio que o próprio evento gravou (02, seção 6.3)', () => {
  const s = montar();
  const ids = rebanho(s, 3);
  s.ok('evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-05-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids[0], peso: 300 }, { animal_id: ids[1], peso: 100 }] });
  const vac = s.ok('evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-05-10', nome_produto: 'Vacina comprada na hora', modo_dose: 'POR_CABECA', dose_referencia: 2, unidade_dose: 'mL', custo_valor: 10000, custo_conta_id: s.conta('VACINAS'), custo_vencimento: '2026-06-10' }, animais: [{ animal_id: ids[0] }, { animal_id: ids[1] }] });
  const fv = s.finDo(vac.event_id)[0];
  const copias = () => s.tabela('SANIDADE').filter((x) => x.event_id === vac.event_id).map((x) => x.custo).sort();
  assert.deepEqual(copias(), [5000, 5000]);
  assert.deepEqual(codigos(s.falha('evento.registrar', rateio(fv.financial_id, { criterio: 'CABECAS', escopo_tipo: 'REBANHO', justificativa_rateio: 'x' }))), ['ESCOPO_DO_REGISTRO']);
  const r = s.ok('evento.registrar', rateio(fv.financial_id, { criterio: 'MANUAL', justificativa_rateio: 'A primeira levou a dose dupla' }, [{ animal_id: ids[0], valor: 7000 }, { animal_id: ids[1], valor: 3000 }]));
  assert.deepEqual(s.rateioDo(r.event_id).map((x) => [x.criterio, x.escopo_tipo, x.escopo_ref, x.data_base, x.total_alocado]), [['MANUAL', 'EVENTO', vac.event_id, '2026-05-10', 10000]]);
  assert.deepEqual(copias(), [5000, 5000], 'a cópia na aplicação é a do rateio dela, e o re-rateio não a muda');
  const ficha = s.ok('animal.ficha', { animal_id: ids[0] });
  assert.equal(ficha.financeiro.custeio, 7000, 'o custo do animal lê o rateio que vale');
});

test('período fechado: o rateio datado até o fechamento (e o estorno dele) pede PERIODO_BLOQUEADO com justificativa; o datado depois, não (não muda nada pedido até o fechamento)', () => {
  const s = montar();
  rebanho(s, 3);
  const fin = s.finDo(s.ok('evento.registrar', avulso(s, { event_date: '2026-06-01', valor: 3000 })).event_id)[0];
  s.ok('config.salvar', { valores: { fin_bloqueio_ate: '2026-06-30' } });
  const p = rateio(fin.financial_id, { event_date: '2026-06-15', criterio: 'CABECAS', escopo_tipo: 'REBANHO' });
  const r1 = s.api('evento.registrar', p);
  assert.equal(r1.error.code, 'NEEDS_CONFIRMATION');
  assert.deepEqual(codigos(r1.error), ['PERIODO_BLOQUEADO']);
  assert.deepEqual(codigos(s.falha('evento.registrar', p, TODOS.concat(['PERIODO_BLOQUEADO']))), ['CAMPO_OBRIGATORIO']);
  const ok = s.ok('evento.registrar', Object.assign({}, p, { justificativa_aviso: 'Ajuste do fechamento' }), TODOS.concat(['PERIODO_BLOQUEADO']));
  // O aviso da trava fica na operação (CONTRATOS, seção 10.5, item 6).
  const op = s.tabela('OPERACOES').find((x) => x.resumo_json && x.resumo_json.event_id === ok.event_id);
  assert.deepEqual(op.resumo_json.avisos_aceitos, [{ codigo: 'PERIODO_BLOQUEADO', justificativa: 'Ajuste do fechamento' }]);
  // Datado depois do fechamento: não pede.
  s.ok('evento.registrar', rateio(fin.financial_id, { event_date: '2026-07-01', criterio: 'CABECAS', escopo_tipo: 'REBANHO', justificativa_rateio: 'De novo' }));
  // O estorno do rateio de 15/06 muda o rateio que valia no fechamento: pede.
  const e = s.api('evento.estornar', { event_id: ok.event_id, justificativa: 'Errado' });
  assert.deepEqual(codigos(e.error), ['PERIODO_BLOQUEADO']);
});

// ------------------------------------------------------------------ importação e integridade ----
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
const MAPA = {
  colunas: {
    'Nº da compra': 'grupo', 'Data da compra': 'data', Fornecedor: 'fornecedor', 'Como foi o preço': 'modalidade', 'Valor dos animais (R$)': 'valor_animais', 'Preço (R$)': 'preco',
    'Frete (R$)': 'frete', 'Primeiro vencimento': 'vencimento', 'Número de parcelas': 'parcelas', Brinco: 'brinco', Sexo: 'sexo', Nascimento: 'data_nascimento',
    Castrado: 'castrado', Reprodutor: 'reprodutor', Pasto: 'pasto', 'Peso na chegada (kg)': 'peso',
  },
  confiancas: { data_nascimento: 'ESTIMADA' }, padroes: {},
};
const COMPRAS = [
  'Nº da compra;Data da compra;Fornecedor;Como foi o preço;Valor dos animais (R$);Preço (R$);Frete (R$);Primeiro vencimento;Número de parcelas;Brinco;Sexo;Nascimento;Castrado;Reprodutor;Pasto;Peso na chegada (kg)',
  'C1;10/02/2026;Fazenda Vizinha;cabeça;6.000,00;2.000,00;300,00;10/03/2026;2;200;M;01/01/2025;N;N;Pasto A;250,5',
  'C1;;;;;;;;;201;M;01/02/2025;N;N;Pasto A;240',
  'C1;;;;;;;;;202;F;01/03/2025;;;P-B;230',
].join('\n');

test('importação: o frete de uma compra importada re-rateado por cabeça; o desfazer da importação com o rateio valendo é recusado pela trava (invariante 25), e depois do estorno do rateio vale', () => {
  const s = montar('2026-04-10');
  s.exec((ctx) => s.G.Config.salvarParceiro(ctx, { idempotencyKey: 'p-forn', dados: { campos: { nome: 'Fazenda Vizinha', tipos: ['FORNECEDOR'] } } }));
  s.evento('registrar', S.entradaInicial([S.bicho({ brinco: '100', sexo: 'M', castrado: true, data_nascimento: '2024-03-01', data_nascimento_confianca: 'CONFIRMADA' })]), 'ev-base');
  const c = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'criar-compras', dados: { tipo: 'COMPRAS', arquivo_nome: 'compras.csv', conteudo_base64: b64(COMPRAS), formato: FORMATO } })).dados;
  for (let b = 1; b < 20; b++) {
    const v = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + b, dados: { import_id: c.import_id, bloco: b, mapeamento: MAPA } })).dados;
    if (v.importacao.status === 'VALIDADO') break;
  }
  let r = s.exec((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: c.import_id, bloco: 1, modo: 'TOTAL' } }));
  for (let b = 2; r.dados.blocos.proximo !== null; b++) r = s.exec((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: c.import_id, bloco: b } }));
  s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } }));
  const frete = s.tabela('FINANCEIRO').find((f) => f.valor === 30000 && f.natureza === 'AQUISICAO_ANIMAIS');
  const rr = s.ok('evento.registrar', rateio(frete.financial_id, { event_date: '2026-03-01', criterio: 'CABECAS', justificativa_rateio: 'Frete por cabeça' }));
  assert.deepEqual(s.alocs(s.rateioDo(rr.event_id)[0].rateio_id).map((a) => a.valor_alocado).sort(), [10000, 10000, 10000]);
  const des = s.tentar((ctx) => s.G.ImportService.desfazer(ctx, { avisosAceitos: [], dados: { import_id: c.import_id, justificativa: 'arquivo errado' } }));
  assert.equal(des.ok, false);
  assert.equal(des.erro.code, 'CONFLICT');
  // A conferência própria do desfazer (os animais da importação receberam valor de um rateio fora dela), com o link do rateio; a
  // trava (invariante 25: o rateio de lançamento cancelado) é a rede de baixo do mesmo caminho.
  assert.ok(des.erro.details.every((d) => d.codigo === 'DEPENDENTE' && d.conflito && d.conflito.event_id === rr.event_id), JSON.stringify(des.erro.details).slice(0, 800));
  assert.match(des.erro.details[0].mensagem, /recebeu valor do rateio de custo de 01\/03\/2026, lançado fora da importação\. Estorne esse rateio antes\./);
  s.ok('evento.estornar', { event_id: rr.event_id, justificativa: 'Vou desfazer a importação' });
  const des2 = s.tentar((ctx) => s.G.ImportService.desfazer(ctx, { avisosAceitos: [], dados: { import_id: c.import_id, justificativa: 'arquivo errado' } }));
  assert.equal(des2.ok, true, JSON.stringify(des2.erro));
  semErro(s, 'desfazer');
});

test('integridade: o rateio mexido à mão é acusado (invariante 25: o valor do evento, o critério × escopo, o arrendamento fora do pasto) e o comando que o piora é recusado pela trava', () => {
  const s = montar();
  const { fin } = arrendamento(s);
  const r = s.ok('evento.registrar', rateio(fin.financial_id));
  s.editar('EVENTOS', r.event_id, 'total_value', 590);
  const rel = s.integridade();
  const achs = rel.achados.filter((a) => a.checagem === 'FINANCEIRO');
  assert.ok(achs.some((a) => /O valor gravado no rateio de 01\/07\/2026/.test(a.mensagem)), JSON.stringify(achs).slice(0, 500));
  s.editar('EVENTOS', r.event_id, 'total_value', 600);
  const rat = s.rateioDo(r.event_id)[0];
  s.editar('RATEIOS', rat.rateio_id, 'escopo_ref', S.PASTOS.A);
  const rel2 = s.integridade();
  assert.ok(rel2.achados.some((a) => a.checagem === 'FINANCEIRO' && /arrendamento .* se rateia pelos dias de permanência no pasto arrendado/.test(a.mensagem)));
  // A correção do rateio quebrado à mão: a trava vê o achado no escopo (não piora: continua) — a correção sem mudança o conserta.
  const ent = s.api('evento.obter', { event_id: r.event_id }).data.correcao;
  ent.campos.pasture_id = S.PASTOS.B;
  const c = s.api('evento.corrigir', Object.assign({}, ent, { event_id: r.event_id, justificativa: 'Conserto' }), TODOS);
  assert.equal(c.ok, true, JSON.stringify(c.error));
  assert.equal(s.integridade().achados.filter((a) => a.severidade === 'ERRO').length, 0);
});
