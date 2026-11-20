'use strict';
/**
 * Fase 4, E4.5 (CONTRATOS, seção 58): o resultado gerencial por competência (`financeiro.resultado`) — receitas e despesas por
 * natureza e por conta, mês a mês, o custo de aquisição de quem saiu, o custeio por grupo e conta, os juros e descontos das baixas,
 * com o caixa líquido ao lado, os estoques no custo (rebanho e insumos), o custeio não alocado e a ponte de cada mês (a conciliação
 * linha a linha, 07, seção 2.1) — e o CT-19 inteiro pela api(): o caso do 07, seção 2.2, montado comando a comando, nas três datas
 * da conciliação e depois de estornar a venda; a regra de tempo (o fato depois de D, o retroativo, o cadastro mudado); cada
 * caminho que grava lançamento (registro, retroativo, mesmo dia, correção, correção do substituto, estorno, estorno da correção,
 * estorno com dependente, importação e desfazer); as recusas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');
const A = require('./apoio-ct19');

const valores = (r) => Object.fromEntries(r.colunas.map((c, k) => [c.chave, r.resultado.valores[k]]));
const secao = (r, chave) => r.secoes.find((x) => x.chave === chave);
const codigos = (e) => (e.details || []).map((d) => d.codigo);

test('CT-19 (09; 07, 2.2) pela api: resultado de março 0,00 (compra não é custeio), junho −3.733,33, novembro +5.495,73; por animal 2.675,54, 2.352,65 e −3.074,79; a identidade nas três datas e a ponte de cada mês; tudo de novo depois de estornar a venda', () => {
  const c = A.caso22();
  const s = c.s;
  A.hoje(s, '2028-01-10');
  const r = s.consulta('financeiro.resultado', { ano: '2027' });
  assert.equal(r.fecha, true, r.problemas.join('\n'));
  assert.deepEqual(valores(r), { '2027-01': 0, '2027-02': 0, '2027-03': 0, '2027-04': -900, '2027-05': -4500, '2027-06': -373333, '2027-07': 0, '2027-08': 0, '2027-09': 0, '2027-10': 0, '2027-11': 549573, '2027-12': 0 });
  assert.equal(r.resultado.total, 170840, 'resultado acumulado de 1.708,40');
  assert.deepEqual(r.caixa.colunas.map((x) => x.liquido), [0, 0, -10000, -453000, -454500, -80000, 0, 0, 0, 0, 0, 1166240], 'o caixa ao lado: −100,00, −4.530,00, −4.545,00, −800,00 e +11.662,40');
  // As linhas por natureza e por conta (o nome da conta é o do cadastro).
  assert.deepEqual(secao(r, 'RV').contas.map((x) => [x.codigo, x.nome, x.total]), [['VENDA_ANIMAIS', 'Venda de animais', 1184000]]);
  assert.deepEqual(secao(r, 'DV').contas.map((x) => [x.codigo, x.total]), [['TAXAS_RETENCOES_VENDA', 17760]]);
  assert.deepEqual(secao(r, 'CA').linhas.map((x) => x.total), [616667, 293333, 0], 'o custo de aquisição de A1 e A2 na venda; o de A3 na morte');
  assert.deepEqual(secao(r, 'CT').grupos.map((g) => [g.grupo, g.contas.map((x) => [x.codigo, x.total])]),
    [['CUSTO_DIRETO', [['VACINAS', 900]]], ['CUSTO_OPERACIONAL', [['ARRENDAMENTO_PASTO', 60000]]], ['DESPESA_ADMINISTRATIVA', [['CONTABILIDADE', 20000]]]]);
  assert.deepEqual([secao(r, 'J').total, secao(r, 'J').valores[4]], [4500, 4500], 'os juros da 2ª parcela, no mês do pagamento');
  assert.deepEqual(r.fora_do_resultado.map((x) => [x.chave, x.total]), [['AQUISICAO', 910000], ['INSUMOS', 3000], ['NAO_OPERACIONAL', 0]]);
  assert.deepEqual([r.custeio_nao_alocado.total, r.custeio_nao_alocado.valores[5]], [20000, 20000], 'custeio não alocado do período: a contabilidade');
  assert.deepEqual(r.estoques.periodo.insumos, { inicio: 0, entradas: 3000, saidas: 900, fim: 2100 }, 'os R$ 21,00 das 7 doses ainda em estoque');
  assert.ok(r.ponte.colunas.every((p, k) => p.fecha && p.resultado === r.resultado.valores[k]));
  assert.deepEqual([r.ponte.colunas[10].a_receber, r.ponte.colunas[10].a_pagar, r.ponte.colunas[10].custo_rebanho_ativo], [1184000, 17760, -616667]);
  // A identidade nas três datas (pela conciliação e pelo próprio resultado).
  const em = (d) => s.consulta('financeiro.resultado', { de: '2027-01-01', ate: d }).identidade;
  assert.deepEqual(['2027-06-30', '2027-11-30', '2027-12-31'].map((d) => [em(d).resultado_acumulado, em(d).fecha]), [[-378733, true], [170840, true], [170840, true]]);
  assert.deepEqual([em('2027-06-30').caixa_acumulado, em('2027-06-30').custo_rebanho_ativo, em('2027-06-30').insumos_estoque], [-997500, 616667, 2100]);
  // Por animal (visão 3): a mesma conta da ficha.
  const ca = s.consulta('financeiro.custosAnimal', { data: '2027-12-31' });
  assert.deepEqual(ca.itens.map((x) => [x.brinco, x.resultado.valor]), [['A1', 267554], ['A2', 235265], ['A3', -307479]]);
  assert.equal(ca.totais.resultado, 195340, 'Σ por animal = 1.953,40; a ponte para a visão 3: 1.953,40 − 200,00 (custeio não alocado) − 45,00 (juros) = 1.708,40');
  assert.equal(ca.totais.resultado - ca.custeio_nao_alocado.valor - secao(r, 'J').total, r.resultado.total);
  // Estornada a venda (antes, desfeita a baixa do recebimento): o resultado de novembro some, a identidade continua fechando.
  s.ok('parcela.desfazerBaixa', { parcela_id: s.parcelasDe(c.fin.F7)[0].parcela_id, justificativa: 'Venda desfeita' });
  s.ok('evento.estornar', { event_id: c.ev.venda, justificativa: 'Venda desfeita' });
  const r2 = s.consulta('financeiro.resultado', { ano: '2027' });
  assert.equal(r2.fecha, true, r2.problemas.join('\n'));
  assert.deepEqual([valores(r2)['2027-11'], valores(r2)['2027-06'], r2.resultado.total], [0, -373333, -378733]);
  assert.deepEqual(['2027-06-30', '2027-11-30', '2027-12-31'].map((d) => [em(d).resultado_acumulado, em(d).fecha]), [[-378733, true], [-378733, true], [-378733, true]]);
  const conc = s.consulta('financeiro.conciliacao', { ate: '2027-12-31' });
  assert.equal(conc.fecha, true, conc.problemas.join('\n'));
  assert.deepEqual(s.consulta('financeiro.custosAnimal', { data: '2027-12-31' }).itens.map((x) => [x.brinco, x.situacao, x.resultado.valor]), [['A1', 'NO_REBANHO', null], ['A2', 'NO_REBANHO', null], ['A3', 'MORTO', -307479]]);
});

test('regra de tempo: o resultado de um período pedido numa data não muda com fato posterior nem com o nome da conta (cadastro de hoje, só o rótulo); o lançamento retroativo muda só o mês que alcança; o mês e o ano em curso vão até hoje', () => {
  const c = A.caso22('2027-07-01');
  const s = c.s;
  const r1 = s.consulta('financeiro.resultado', { de: '2027-01-01', ate: '2027-06-30' });
  // Fatos depois de 30/06 (a venda, a baixa) não mudam o primeiro semestre.
  A.hoje(s, '2027-11-20');
  s.ok('evento.registrar', { tipo: 'VENDA', campos: { event_date: '2027-11-20', partner_id: c.parceiros.frig, finalidade: 'ABATE', modalidade: 'CABECA', valor_bruto: 1200000 }, animais: [{ animal_id: c.id.A1, valor_individual: 600000 }, { animal_id: c.id.A2, valor_individual: 600000 }], parcelas: [{ data_vencimento: '2027-12-20' }] });
  assert.deepEqual(s.consulta('financeiro.resultado', { de: '2027-01-01', ate: '2027-06-30' }), r1, 'a venda de novembro não muda o semestre');
  // O nome da conta é o do cadastro (rótulo); os números não mudam.
  s.ok('conta.salvar', { conta_id: s.conta('CONTABILIDADE'), campos: { nome: 'Escritório contábil' } });
  const r2 = s.consulta('financeiro.resultado', { de: '2027-01-01', ate: '2027-06-30' });
  assert.deepEqual(r2.resultado, r1.resultado);
  assert.equal(secao(r2, 'CT').grupos.find((g) => g.grupo === 'DESPESA_ADMINISTRATIVA').contas[0].nome, 'Escritório contábil');
  // Retroativo: um gasto de março lançado em novembro muda março (e a ponte de março continua fechando); abril em diante, não.
  s.ok('evento.registrar', { tipo: 'LANCAMENTO_FINANCEIRO', campos: { event_date: '2027-03-15', conta_id: s.conta('MAO_DE_OBRA'), valor: 12345, descricao: 'Diária de março' }, parcelas: [{ data_vencimento: '2027-03-31' }] });
  const r3 = s.consulta('financeiro.resultado', { de: '2027-01-01', ate: '2027-06-30' });
  assert.equal(r3.fecha, true, r3.problemas.join('\n'));
  assert.deepEqual(r3.resultado.valores, r1.resultado.valores.map((v, k) => (k === 2 ? v - 12345 : v)));
  assert.deepEqual([r3.ponte.colunas[2].a_pagar - r1.ponte.colunas[2].a_pagar, r3.ponte.colunas[3].a_pagar - r1.ponte.colunas[3].a_pagar], [12345, 0], 'o retroativo entra no a pagar de março (a ponte do mês) e continua em aberto em abril');
  // O ano em curso vai até hoje; o pedido do ano inteiro é o mesmo que de 1º de janeiro até hoje.
  assert.deepEqual(s.consulta('financeiro.resultado', { ano: '2027' }), s.consulta('financeiro.resultado', { de: '2027-01-01', ate: '2027-11-20' }));
  const m = s.consulta('financeiro.resultado', { mes: '2027-11' });
  assert.deepEqual([m.de, m.ate, m.colunas.length], ['2027-11-01', '2027-11-20', 1]);
  // Sem a data: o ano de hoje até hoje.
  const padrao = s.consulta('financeiro.resultado', {});
  assert.deepEqual([padrao.de, padrao.ate], ['2027-01-01', '2027-11-20']);
});

test('cada caminho que grava lançamento entra no resultado: registro, mesmo dia, correção, correção do substituto, estorno da correção, estorno com dependente (recusado) e sem — a ponte fecha depois de cada um (a importação e o desfazer: tests/financeiro.custos.test.js)', () => {
  const s = A.montar('2026-08-31');
  const fecha = (onde) => { const r = s.consulta('financeiro.resultado', { ano: '2026' }); assert.equal(r.fecha, true, onde + ': ' + r.problemas.join(' | ')); return r; };
  const jun = (r) => valores(r)['2026-06'];
  const gasto = (valor, data) => ({ tipo: 'LANCAMENTO_FINANCEIRO', campos: { event_date: data || '2026-06-10', conta_id: s.conta('DESPESAS_GERAIS'), valor, descricao: 'Gasto ' + valor }, parcelas: [{ data_vencimento: '2026-07-10' }] });
  const base = jun(fecha('vazio'));
  const g1 = s.ok('evento.registrar', gasto(10000));
  s.ok('evento.registrar', gasto(2000));
  assert.equal(jun(fecha('registro e mesmo dia')), base - 12000);
  const k1 = s.ok('evento.corrigir', Object.assign(gasto(15000), { event_id: g1.event_id, justificativa: 'Valor da nota' }));
  assert.equal(jun(fecha('correção')), base - 17000);
  const k2 = s.ok('evento.corrigir', Object.assign(gasto(16000), { event_id: k1.event_id, justificativa: 'Valor certo' }));
  assert.equal(jun(fecha('correção do substituto')), base - 18000);
  s.ok('evento.estornar', { event_id: k2.event_id, justificativa: 'Não era da fazenda' });
  assert.equal(jun(fecha('estorno da correção')), base - 2000);
  // O arrendamento rateado: o estorno com o rateio que vale é recusado (RATEIO_DEPENDENTE); o rateio não muda o resultado, só o
  // custeio não alocado; estornado o rateio, o arrendamento pode ser estornado.
  const ent = s.ok('evento.registrar', S.entradaInicial([S.bicho({ brinco: '901', sexo: 'M', data_nascimento: '2024-06-01', data_nascimento_confianca: 'CONFIRMADA' })], { event_date: S.D0 }));
  const arr = s.ok('evento.registrar', { tipo: 'LANCAMENTO_FINANCEIRO', campos: { event_date: '2026-06-01', conta_id: s.conta('ARRENDAMENTO_PASTO'), valor: 30000, pasture_id: S.PASTOS.A, competencia_inicio: '2026-06-01', competencia_fim: '2026-06-30' }, parcelas: [{ data_vencimento: '2026-06-05' }] });
  const antes = fecha('arrendamento');
  assert.equal(antes.custeio_nao_alocado.valores[5], 32000);
  const rat = s.ok('evento.registrar', { tipo: 'RATEIO', campos: { event_date: '2026-07-01', financial_id: s.finDo(arr.event_id)[0].financial_id } });
  const depois = fecha('rateio');
  assert.deepEqual([depois.resultado.valores, depois.custeio_nao_alocado.valores[5]], [antes.resultado.valores, 2000], 'o rateio leva o custo aos animais: o resultado não muda, o não alocado cai');
  assert.deepEqual(codigos(s.falha('evento.estornar', { event_id: arr.event_id, justificativa: 'Erro' })), ['RATEIO_DEPENDENTE']);
  s.ok('evento.estornar', { event_id: rat.event_id, justificativa: 'Rateio errado' });
  s.ok('evento.estornar', { event_id: arr.event_id, justificativa: 'Lançado em dobro' });
  assert.equal(jun(fecha('estorno sem dependente')), base - 2000);
  assert.ok(ent.event_id);
});

test('as recusas e os limites: data inválida, futura, período invertido, mês e ano mal escritos, período longo demais; antes do marco zero, o motivo (P9); começo antes dele, a etiqueta', () => {
  const s = A.montar('2026-08-31');
  const recusa = (dados) => { const e = s.falha('financeiro.resultado', dados); return [e.code, codigos(e)[0], (e.details[0] || {}).campo]; };
  assert.deepEqual(recusa({ ate: '2026-09-01' }), ['VALIDATION', 'DATA_FUTURA', 'ate']);
  assert.deepEqual(recusa({ de: '31/01/2026' }), ['VALIDATION', 'FORMATO_INVALIDO', 'de']);
  assert.deepEqual(recusa({ de: '2026-05-01', ate: '2026-04-01' }), ['VALIDATION', 'PERIODO_INVERTIDO', 'de']);
  assert.deepEqual(recusa({ mes: '2026-13' }), ['VALIDATION', 'FORMATO_INVALIDO', 'mes']);
  assert.deepEqual(recusa({ ano: '26' }), ['VALIDATION', 'FORMATO_INVALIDO', 'ano']);
  assert.deepEqual(recusa({ ano: '2027' }), ['VALIDATION', 'DATA_FUTURA', 'ano']);
  assert.deepEqual(recusa({ de: '2010-01-01', ate: '2026-08-31' }), ['VALIDATION', 'VALOR_FORA_DA_FAIXA', 'de']);
  const antes = s.consulta('financeiro.resultado', { ano: '2025' });
  assert.deepEqual([antes.motivo, antes.colunas.length, antes.resultado], ['ANTERIOR_AO_MARCO_ZERO', 0, null]);
  const cruza = s.consulta('financeiro.resultado', { de: '2025-11-01', ate: '2026-02-28' });
  assert.deepEqual([cruza.motivo, cruza.antes_do_marco_zero, cruza.colunas.length, cruza.fecha], [null, true, 4, true]);
});
