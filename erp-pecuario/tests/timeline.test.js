'use strict';
/**
 * Timeline: ordem canônica, validador da linha do tempo (04, seção 5), marco zero (04, seção 6), projetor e
 * inventário em data. Parte pura (linhas sintéticas, inclusive de tipos das fases seguintes, para os exemplos de
 * 04, seção 5.2) e parte integrada (comandos reais, com a projeção conferida depois de cada comando).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');
const E = require('./apoio-eventos');

const { js, PASTOS, bicho, entradaInicial, outraEntrada, ajuste } = E;
const G = createGas({ order: 'reverse' }).G;
/** Timeline com os resultados convertidos para objetos deste contexto (comparáveis com deepEqual). */
const T = Object.fromEntries(Object.entries(G.Timeline).map(([k, v]) => [k, typeof v === 'function' ? (...a) => js(v(...a)) : v]));

let seq = 0;
/** Linha sintética da linha do tempo. */
function L(tipo, data, efeito, extra) {
  seq += 1;
  return Object.assign({
    event_id: 'e' + seq, event_type: tipo, event_subtype: null, event_date: data, event_seq: seq, ordem_seq: seq,
    efeito, pasto_origem_id: null, pasto_destino_id: null, pre_marco_zero: false, animal_id: 'x', papel: 'SUJEITO', atributos: null,
  }, extra || {});
}
const codigos = (r) => r.problemas.map((p) => p.codigo + '@' + p.event_id);

// ------------------------------------------------------------------ ordem canônica ----
test('ordem canônica: data, depois entrada → demais → saída, depois a posição; o substituto fica na posição do original', () => {
  const saida = L('VENDA', '2026-06-20', -1, { pasto_origem_id: 'A', event_seq: 1, ordem_seq: 1 });
  const mov = L('TRANSFERENCIA', '2026-06-20', 0, { pasto_origem_id: 'A', pasto_destino_id: 'B', event_seq: 2, ordem_seq: 2 });
  const ent = L('OUTRA_ENTRADA', '2026-06-20', 1, { pasto_destino_id: 'A', event_seq: 3, ordem_seq: 3 });
  const antes = L('PESAGEM', '2026-06-19', 0, { event_seq: 9, ordem_seq: 9 });
  assert.deepEqual(T.ordenar([saida, mov, ent, antes]).map((l) => l.event_id), [antes.event_id, ent.event_id, mov.event_id, saida.event_id]);
  // Dois movimentos no mesmo dia: o substituto (seq 30) do primeiro (seq 10) continua antes do segundo (seq 20).
  const m1 = L('TRANSFERENCIA', '2026-07-01', 0, { event_seq: 30, ordem_seq: 10 });
  const m2 = L('TRANSFERENCIA', '2026-07-01', 0, { event_seq: 20, ordem_seq: 20 });
  assert.deepEqual(T.ordenar([m2, m1]).map((l) => l.event_seq), [30, 20]);
  assert.deepEqual([T.classe(ent), T.classe(mov), T.classe(saida)], [0, 1, 2]);
  assert.deepEqual([T.papelNaLinha(mov), T.papelNaLinha(antes), T.papelNaLinha(L('AJUSTE_INVENTARIO', '2026-01-01', 0, { event_subtype: 'CORRECAO_CADASTRO' }))], ['MOVIMENTO', 'FATO', 'NEUTRO']);
});

// ------------------------------------------------------------------ validador: exemplos de 04, seção 5.2 ----
test('(i) movimento com data passada que quebra a cadeia: só o posterior incompatível é apontado, com o pasto esperado', () => {
  const ent = L('ENTRADA_INICIAL', '2026-01-01', 1, { pasto_destino_id: 'A' });
  const ac = L('TRANSFERENCIA', '2026-03-10', 0, { pasto_origem_id: 'A', pasto_destino_id: 'C' });
  const ab = L('TRANSFERENCIA', '2026-03-01', 0, { pasto_origem_id: 'A', pasto_destino_id: 'B' });
  const antes = T.validar([ent, ac]);
  assert.deepEqual(antes.problemas, []);
  const depois = T.validar([ent, ac, ab]);
  const novos = T.problemasNovos(antes.problemas, depois.problemas);
  assert.deepEqual(novos.map((p) => [p.codigo, p.event_id, p.pasto_esperado, p.pasto_informado]), [['ORIGEM_DIVERGENTE', ac.event_id, 'B', 'A']]);
  assert.equal(depois.pasto, 'C', 'a passada continua do destino do movimento inválido (lista só o que quebrou)');
  assert.match(T.descrever(novos[0], (x) => 'Pasto ' + x), /transferência de 10\/03\/2026 parte do pasto Pasto A, mas nessa data o animal estaria no pasto Pasto B/);
});

test('(ii) manejo no dia da saída: fato independente aceito (limite inclusivo); movimento no mesmo dia entra antes da saída e quebra a origem dela', () => {
  const ent = L('ENTRADA_INICIAL', '2026-01-01', 1, { pasto_destino_id: 'A' });
  const venda = L('VENDA', '2026-06-20', -1, { pasto_origem_id: 'A' });
  const pesagem = L('PESAGEM', '2026-06-20', 0);
  assert.deepEqual(T.validar([ent, venda, pesagem]).problemas, []);
  const tarde = L('PESAGEM', '2026-06-21', 0);
  assert.deepEqual(codigos(T.validar([ent, venda, tarde])), ['FORA_DA_PERMANENCIA@' + tarde.event_id]);
  const transf = L('TRANSFERENCIA', '2026-06-20', 0, { pasto_origem_id: 'A', pasto_destino_id: 'B' });
  const r = T.validar([ent, venda, transf]);
  assert.deepEqual(r.problemas.map((p) => [p.codigo, p.event_id]), [['ORIGEM_DIVERGENTE', venda.event_id]], 'a venda, gravada antes, fica com a origem errada');
});

test('(iii) estorno da entrada com dependentes: sem a entrada, os fatos e movimentos posteriores ficam fora do rebanho', () => {
  const ent = L('COMPRA', '2026-02-05', 1, { pasto_destino_id: 'A' });
  const pes = L('PESAGEM', '2026-02-12', 0);
  const tr = L('TRANSFERENCIA', '2026-03-01', 0, { pasto_origem_id: 'A', pasto_destino_id: 'B' });
  const antes = T.validar([ent, pes, tr]).problemas;
  const depois = T.validar([pes, tr]).problemas;
  assert.deepEqual(T.problemasNovos(antes, depois).map((p) => p.codigo + '@' + p.event_id).sort(), ['FORA_DA_PERMANENCIA@' + pes.event_id, 'FORA_DO_REBANHO@' + tr.event_id].sort());
});

test('máquina de estados: entrada em quem já está dentro, saída de quem está fora, morte terminal e reentrada depois da venda', () => {
  const e1 = L('ENTRADA_INICIAL', '2026-01-01', 1, { pasto_destino_id: 'A' });
  const e2 = L('OUTRA_ENTRADA', '2026-02-01', 1, { pasto_destino_id: 'B' });
  assert.deepEqual(codigos(T.validar([e1, e2])), ['ENTRADA_JA_DENTRO@' + e2.event_id]);
  const venda = L('VENDA', '2026-03-01', -1, { pasto_origem_id: 'A' });
  const volta = L('OUTRA_ENTRADA', '2026-04-01', 1, { pasto_destino_id: 'C' });
  const r = T.validar([e1, venda, volta]);
  assert.deepEqual([r.problemas, r.dentro, r.pasto, r.periodos], [[], true, 'C', [{ inicio: '2026-01-01', fim: '2026-03-01' }, { inicio: '2026-04-01', fim: null }]]);
  const venda2 = L('VENDA', '2026-03-05', -1, { pasto_origem_id: 'A' });
  assert.deepEqual(codigos(T.validar([e1, venda, venda2])), ['FORA_DO_REBANHO@' + venda2.event_id], 'vender duas vezes');
  const morte = L('MORTE', '2026-05-01', -1, { pasto_origem_id: 'A' });
  const reentra = L('OUTRA_ENTRADA', '2026-06-01', 1, { pasto_destino_id: 'A' });
  const pesagemDepois = L('PESAGEM', '2026-05-02', 0);
  const pesagemNoDia = L('PESAGEM', '2026-05-01', 0);
  assert.deepEqual(codigos(T.validar([e1, morte, reentra, pesagemDepois, pesagemNoDia])).sort(), ['APOS_MORTE@' + reentra.event_id, 'APOS_MORTE@' + pesagemDepois.event_id].sort());
});

test('datas: nada antes do nascimento; correção de cadastro não exige presença no rebanho', () => {
  const ent = L('ENTRADA_INICIAL', '2026-01-01', 1, { pasto_destino_id: 'A' });
  assert.deepEqual(codigos(T.validar([ent], { nascimento: '2026-02-01' })), ['ANTES_DO_NASCIMENTO@' + ent.event_id]);
  const venda = L('VENDA', '2026-03-01', -1, { pasto_origem_id: 'A' });
  const corr = L('AJUSTE_INVENTARIO', '2026-09-01', 0, { event_subtype: 'CORRECAO_CADASTRO' });
  assert.deepEqual(T.validar([ent, venda, corr]).problemas, [], 'corrigir o sexo de um animal já vendido é permitido');
});

// ------------------------------------------------------------------ marco zero ----
test('marco zero: registros anteriores ficam fora do replay e do inventário; valem só contra nascimento e chegada declarada', () => {
  const pesagemAntiga = L('PESAGEM', '2025-06-01', 0, { pre_marco_zero: true });
  const vendaAntiga = L('VENDA', '2025-08-01', 0, { pre_marco_zero: true });
  const ent = L('ENTRADA_INICIAL', '2026-01-01', 1, { pasto_destino_id: 'A' });
  assert.deepEqual(T.validar([pesagemAntiga, vendaAntiga, ent], { nascimento: '2024-01-01' }).problemas, []);
  assert.deepEqual(codigos(T.validar([pesagemAntiga, ent], { nascimento: '2025-07-01' })), ['ANTES_DO_NASCIMENTO@' + pesagemAntiga.event_id]);
  assert.deepEqual(codigos(T.validar([pesagemAntiga, ent], { dataEntrada: '2025-09-01' })), ['ANTES_DA_ENTRADA@' + pesagemAntiga.event_id]);
  const inv = T.inventario([pesagemAntiga, vendaAntiga, ent], '2026-01-31', '2026-01-01');
  assert.deepEqual(js(inv), { data: '2026-01-31', total: 1, porPasto: { A: 1 }, semPasto: 0, porSituacao: { ATIVO: 1, VENDIDO: 0, MORTO: 0, DESCARTADO: 0, BAIXADO_AJUSTE: 0 }, motivo: null }, 'a venda histórica não conta na situação da data');
  assert.deepEqual(js(T.inventario([ent], '2025-12-31', '2026-01-01')), { data: '2025-12-31', total: null, porPasto: null, semPasto: null, porSituacao: null, motivo: 'ANTERIOR_AO_MARCO_ZERO' });
  assert.deepEqual(js(T.pastoEm([ent], '2025-12-31', '2026-01-01')), { presente: null, pasture_id: null, motivo: 'ANTERIOR_AO_MARCO_ZERO' });
  assert.equal(T.inventario([ent], '2026-02-01', null).motivo, 'DADOS_INSUFICIENTES');
});

function fonteFalsa(linhas, cruas) {
  const params = T.parametros(null);
  return {
    parametros: params, excluidos: {},
    animal: () => ({ animal_id: 'x', codigo_interno: 'A-000001' }),
    linhas: () => linhas,
    linhasCru: () => cruas || linhas.map((l) => ({ event_id: l.event_id, animal_id: 'x', atributos_iniciais_json: l.atributos })),
    statusEvento: () => 'CONFIRMADO',
    evento: (idEv) => { const l = linhas.find((x) => x.event_id === idEv); return l ? { event_id: l.event_id, event_type: l.event_type, event_seq: l.event_seq, event_date: l.event_date } : null; },
    ajustes: () => [], identificacoes: () => [], pesagens: () => [], reproducao: () => [], aquisicoes: () => [], pasto: () => null,
  };
}

test('projetor e marco zero: só registros anteriores → HISTORICO, ou VENDIDO/MORTO com saída histórica conhecida; sem linha alguma → EXTERNO', () => {
  const at = { sexo: 'F', origem: 'COMPRADO' };
  const so = [L('COMPRA', '2025-03-01', 0, { pre_marco_zero: true, atributos: at }), L('PESAGEM', '2025-04-01', 0, { pre_marco_zero: true })];
  const p1 = T.projetarAnimal(fonteFalsa(so), 'x').campos;
  assert.deepEqual([p1.situacao_cadastral, p1.sexo, p1.pasto_atual_id, p1.data_saida], ['HISTORICO', 'F', null, null]);
  const vendida = so.concat([L('VENDA', '2025-09-01', 0, { pre_marco_zero: true })]);
  const p2 = T.projetarAnimal(fonteFalsa(vendida), 'x').campos;
  assert.deepEqual([p2.situacao_cadastral, p2.data_saida], ['VENDIDO', '2025-09-01']);
  assert.equal(T.projetarAnimal(fonteFalsa([], []), 'x').campos.situacao_cadastral, 'EXTERNO');
  const viva = [L('ENTRADA_INICIAL', '2026-01-01', 1, { pasto_destino_id: 'A', atributos: { sexo: 'M', origem: 'NASCIDO', castrado: 'S', reprodutor: 'S' } }), L('MORTE', '2026-04-01', -1, { pasto_origem_id: 'A' })];
  const p3 = T.projetarAnimal(fonteFalsa(viva), 'x').campos;
  assert.deepEqual([p3.situacao_cadastral, p3.data_saida, p3.castrado, p3.reprodutor, p3.pasto_atual_id, p3.data_ultimo_movimento], ['MORTO', '2026-04-01', true, false, null, '2026-04-01'], 'castrado nunca é reprodutor');
});

test('(v) inventário em três datas, exemplo literal de 04 (com venda e morte sintéticas), e o passado recalculado sem a venda estornada', () => {
  const linhas = [];
  for (let i = 0; i < 100; i++) linhas.push(L('ENTRADA_INICIAL', '2026-01-01', 1, { animal_id: 'a' + i, pasto_destino_id: i < 60 ? 'A' : 'B' }));
  for (let i = 0; i < 2; i++) linhas.push(L('NASCIMENTO', '2026-01-15', 1, { animal_id: 'n' + i, pasto_destino_id: 'A', papel: 'CRIA' }));
  const tr = L('TRANSFERENCIA', '2026-02-01', 0);
  for (let i = 0; i < 10; i++) linhas.push(Object.assign({}, tr, { animal_id: 'a' + i, pasto_origem_id: 'A', pasto_destino_id: 'B' }));
  const venda = L('VENDA', '2026-02-20', -1);
  const vendidos = [];
  for (let i = 60; i < 65; i++) vendidos.push(Object.assign({}, venda, { animal_id: 'a' + i, pasto_origem_id: 'B' }));
  const morte = L('MORTE', '2026-03-10', -1, { animal_id: 'a20', pasto_origem_id: 'A' });
  const todas = linhas.concat(vendidos, [morte]);
  const ver = (ls, d) => { const r = T.inventario(ls, d, '2026-01-01'); return [r.total, r.porPasto.A, r.porPasto.B]; };
  assert.deepEqual(ver(todas, '2026-01-31'), [102, 62, 40]);
  assert.deepEqual(ver(todas, '2026-02-15'), [102, 52, 50]);
  assert.deepEqual(ver(todas, '2026-03-31'), [96, 51, 45]);
  assert.deepEqual(ver(linhas.concat([morte]), '2026-03-31'), [101, 51, 50], 'venda estornada em abril: 31/03 passa a 101');
  assert.deepEqual(js(T.pastoEm(todas.filter((l) => l.animal_id === 'a3'), '2026-01-31', '2026-01-01')), { presente: true, pasture_id: 'A', motivo: null });
  assert.deepEqual(js(T.pastoEm(todas.filter((l) => l.animal_id === 'a3'), '2026-02-01', '2026-01-01')), { presente: true, pasture_id: 'B', motivo: null });
  assert.deepEqual(js(T.pastoEm(vendidos.filter((l) => l.animal_id === 'a61').concat(linhas.filter((l) => l.animal_id === 'a61')), '2026-02-20', '2026-01-01')), { presente: false, pasture_id: null, motivo: null });
});

// ------------------------------------------------------------------ parâmetros ----
test('parâmetros: tipados a partir de CONFIGURACOES, semente quando a chave falta, valor inválido → CONFIG', () => {
  const p = T.parametros(null);
  assert.deepEqual([p.ua_peso_kg, p.brinco_ignora_zeros_esquerda, js(p.faixas_etarias_meses), p.data_marco_zero, p.gmd_plausivel_min_kg_dia], [450, true, [12, 24, 36], null, -1]);
  const repo = (valores) => ({ carregada: () => true, porId: (_, chave) => (chave in valores ? { chave, valor: valores[chave] } : null) });
  assert.equal(T.parametros(repo({ data_marco_zero: '2026-01-01' })).data_marco_zero, '2026-01-01');
  assert.throws(() => T.parametros(repo({ ua_peso_kg: 'muito' })), (e) => e.code === 'CONFIG' && /ua_peso_kg/.test(e.message));
  assert.throws(() => T.parametros(repo({ data_marco_zero: '01/01/2026' })), (e) => e.code === 'CONFIG');
  assert.throws(() => T.parametros(repo({ avisos_politica: '{x' })), (e) => e.code === 'CONFIG');
});

// ------------------------------------------------------------------ integrado ----
test('(v) adaptado aos tipos da Fase 1: inventário e pasto em datas diferentes, recalculados depois de um estorno', () => {
  const m = E.ambienteEventos();
  const animais = [];
  for (let i = 0; i < 100; i++) animais.push(bicho({ brinco: String(1000 + i), pasto_destino_id: i < 60 ? PASTOS.A : PASTOS.B }));
  const inicial = m.run('registrar', entradaInicial(animais));
  const ids = inicial.dados.animais.map((a) => a.animal_id);
  const doacao = m.run('registrar', outraEntrada('2026-01-15', [bicho({ brinco: '2001' }), bicho({ brinco: '2002' })]));
  m.run('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-02-01', ids.slice(0, 10).map((x) => ({ animal_id: x, pasto_destino_id: PASTOS.B }))));
  m.run('registrar', outraEntrada('2026-03-10', [bicho({ brinco: '3001', pasto_destino_id: PASTOS.B })]));
  const ver = (d) => { const r = m.inventario(d); const p = r.porPasto || {}; return [r.total, p[PASTOS.A] || 0, p[PASTOS.B] || 0, r.motivo]; };
  assert.deepEqual(ver('2026-01-31'), [102, 62, 40, null]);
  assert.deepEqual(ver('2026-02-15'), [102, 52, 50, null]);
  assert.deepEqual(ver('2026-03-31'), [103, 52, 51, null]);
  assert.deepEqual(ver('2025-12-31').slice(0, 3), [null, 0, 0]);
  assert.equal(m.inventario('2025-12-31').motivo, 'ANTERIOR_AO_MARCO_ZERO');
  assert.deepEqual(m.pastoEm(ids[0], '2026-01-31'), { presente: true, pasture_id: PASTOS.A, motivo: null });
  assert.deepEqual(m.pastoEm(ids[0], '2026-02-01'), { presente: true, pasture_id: PASTOS.B, motivo: null });
  // Estorno da doação de 15/01 (em novembro): o inventário passado é recalculado com os eventos vigentes hoje.
  m.run('estornar', { event_id: doacao.dados.event_id, justificativa: 'Doação lançada em duplicidade' });
  assert.deepEqual(ver('2026-01-31'), [100, 60, 40, null]);
  assert.deepEqual(ver('2026-03-31'), [101, 50, 51, null]);
  assert.equal(m.tabela('ANIMAIS').filter((a) => a.situacao_cadastral === 'ATIVO').length, 101, 'Σ efeito = ativos');
});

test('projetor real: estorno de correção devolve o valor de criação sem "restaurar" nada; IDENTIFICACOES.data_fim fecha o brinco errado', () => {
  const m = E.ambienteEventos();
  const r = m.run('registrar', entradaInicial([bicho({ brinco: '0412', sexo: 'F', data_nascimento: '2022-03-01', data_nascimento_confianca: 'ESTIMADA' })]));
  const id = r.dados.animais[0].animal_id;
  const c1 = m.run('registrar', ajuste('CORRECAO_CADASTRO', '2026-05-01', [{ animal_id: id, campo: 'data_nascimento', valor_novo: '2021-03-01' }, { animal_id: id, campo: 'data_nascimento_confianca', valor_novo: 'CONFIRMADA' }]));
  const c2 = m.run('registrar', ajuste('CORRECAO_CADASTRO', '2026-06-01', [{ animal_id: id, campo: 'data_nascimento', valor_novo: '2020-03-01' }]));
  assert.deepEqual([m.animal(id).data_nascimento, m.animal(id).data_nascimento_confianca], ['2020-03-01', 'CONFIRMADA']);
  m.run('estornar', { event_id: c2.dados.event_id, justificativa: 'Data errada' });
  assert.equal(m.animal(id).data_nascimento, '2021-03-01', 'vale a correção vigente de maior event_seq');
  m.run('estornar', { event_id: c1.dados.event_id, justificativa: 'Data errada' });
  assert.deepEqual([m.animal(id).data_nascimento, m.animal(id).data_nascimento_confianca], ['2022-03-01', 'ESTIMADA'], 'volta ao atributo de criação');
  m.run('registrar', ajuste('IDENTIFICACAO_INCORRETA', '2026-07-01', [{ animal_id: id, brinco: '0421' }]));
  const ids = m.tabela('IDENTIFICACOES').filter((x) => x.animal_id === id).map((x) => [x.codigo, x.data_inicio, x.data_fim]);
  assert.deepEqual(ids, [['0412', '2026-01-01', '2026-07-01'], ['0421', '2026-07-01', null]]);
  assert.deepEqual([m.animal(id).brinco, m.animal(id).brinco_norm], ['0421', '421']);
});
