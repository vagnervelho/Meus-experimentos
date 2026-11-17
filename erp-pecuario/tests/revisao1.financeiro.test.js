'use strict';
/**
 * Revisão independente da Fase 2, rodada 1, lente FINANCEIRO: cada achado confirmado vira um teste que falhava antes
 * do conserto. Os comandos passam pelo motor com o projetor real; depois de cada um, a projeção gravada é a
 * reconstrução e as invariantes de 03b, seção 14, fecham (apoio-eventos).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./apoio-cadastros');
const S = require('./apoio-sistema');

const { PASTOS, bicho, entradaInicial, codigos } = C;

function ambiente(opcoes) {
  const c = C.ambienteCadastros(opcoes);
  const parceiro = (nome, tipos) => c.run('Config.comandoSalvarParceiro', { campos: { nome, tipos } }).dados.partner_id;
  return { c, m: c.m, G: c.G, parceiro };
}
const compra = (data, forn, pasto, animais, campos, extra) => Object.assign({ tipo: 'COMPRA', campos: Object.assign({ event_date: data, partner_id: forn, pasto_destino_id: pasto }, campos || {}), animais }, extra || {});
const venda = (data, comp, animais, campos, extra) => Object.assign({ tipo: 'VENDA', campos: Object.assign({ event_date: data, partner_id: comp, finalidade: 'RECRIA_ENGORDA' }, campos || {}), animais }, extra || {});
const parcelasDe = (m, eventId) => {
  const fins = m.tabela('FINANCEIRO').filter((f) => f.event_id === eventId);
  return fins.map((f) => [f.descricao, m.tabela('PARCELAS').filter((p) => p.financial_id === f.financial_id).sort((a, b) => a.parcela_num - b.parcela_num).map((p) => [p.data_vencimento, p.valor])]);
};

// ---------------------------------------------------------------- achado 3 ----
test('achado 3: em reentrada, o bloco H da ficha soma receitas, despesas, custeio e aquisição numa base só (a passagem atual)', () => {
  const { c, m, G, parceiro } = ambiente();
  const f = parceiro('Vizinho', ['FORNECEDOR', 'COMPRADOR']);
  const g = { brinco: 'R1', sexo: 'M', castrado: true, reprodutor: false, idade_meses: 20 };
  const parc = (d) => ({ parcelas: [{ data_vencimento: d }] });
  const id = m.run('registrar', compra('2026-02-01', f, PASTOS.A, [g], { modalidade: 'CABECA', preco_unitario: 100000, valor_animais: 100000 }, parc('2026-03-01'))).dados.animais[0].animal_id;
  m.run('registrar', venda('2026-04-01', f, [{ animal_id: id }], { modalidade: 'CABECA', preco_unitario: 150000, valor_bruto: 150000 }, parc('2026-05-01')));
  const ficha = () => c.ler(G.AnimalService.consultaFicha({ animal_id: id })).financeiro;
  let h = ficha();
  assert.deepEqual([h.custo_aquisicao, h.receitas, h.resultado.valor, h.desde, h.lancamentos_anteriores], [100000, 150000, 50000, '2026-02-01', 0]);
  m.run('registrar', compra('2026-06-01', f, PASTOS.A, [{ animal_id: id }], { modalidade: 'CABECA', preco_unitario: 120000, valor_animais: 120000 }, parc('2026-07-01')));
  m.run('registrar', venda('2026-08-01', f, [{ animal_id: id }], { modalidade: 'CABECA', preco_unitario: 130000, valor_bruto: 130000 }, parc('2026-09-01')));
  h = ficha();
  // Antes: receitas 2.800,00 (duas vendas) − aquisição 1.200,00 (só a última) = 1.600,00, um lucro inflado.
  assert.deepEqual([h.custo_aquisicao, h.por_natureza.AQUISICAO_ANIMAIS, h.receitas, h.custo_acumulado, h.resultado.valor], [120000, 120000, 130000, 120000, 10000]);
  assert.deepEqual([h.desde, h.lancamentos_anteriores, h.lancamentos.length], ['2026-06-01', 2, 4]);
  assert.deepEqual(h.lancamentos.map((x) => [x.event_type, x.passagem_atual]).sort(), [['COMPRA', false], ['COMPRA', true], ['VENDA', false], ['VENDA', true]]);
  assert.deepEqual(m.invariantes(), []);
});

// ---------------------------------------------------------------- achado 15 ----
test('achado 15: EVENTOS.total_value de rebanho inicial, morte e descarte é conferido contra os lançamentos (edição à mão acusada)', () => {
  const s = S.sistema();
  const ini = s.evento('registrar', S.entradaInicial([S.bicho({ brinco: '103', sexo: 'M', data_nascimento: '2024-06-01', data_nascimento_confianca: 'ESTIMADA', valor_abertura: 200000 }), S.bicho({ brinco: '104', data_nascimento: '2016-01-01', data_nascimento_confianca: 'ESTIMADA' }), S.bicho({ brinco: '105', data_nascimento: '2016-01-01', data_nascimento_confianca: 'ESTIMADA' })]), 'k-ini').dados;
  const ids = Object.fromEntries(ini.animais.map((a) => [a.brinco, a.animal_id]));
  const custeio = s.tabela('PLANO_CONTAS').find((c) => c.natureza === 'CUSTEIO' && c.ativo !== false).conta_id;
  const mo = s.evento('registrar', { tipo: 'MORTE', campos: { event_date: '2026-07-01', causa: 'DOENCA', custo_valor: 15000, custo_conta_id: custeio }, animais: [{ animal_id: ids['103'] }] }, 'k-m').dados;
  const de = s.evento('registrar', { tipo: 'DESCARTE', campos: { event_date: '2026-07-02', destino: 'CONSUMO_PROPRIO', motivo: 'IDADE', receita_valor: 50000 }, animais: [{ animal_id: ids['104'] }] }, 'k-d').dados;
  const semLanc = s.evento('registrar', { tipo: 'DESCARTE', campos: { event_date: '2026-07-03', destino: 'CONSUMO_PROPRIO', motivo: 'IDADE' }, animais: [{ animal_id: ids['105'] }] }, 'k-d2').dados;
  assert.equal(s.integridade().ok, true);
  const financeiros = (r) => r.achados.filter((a) => a.checagem === 'FINANCEIRO').map((a) => a.mensagem);
  for (const ev of [mo.event_id, de.event_id, ini.event_id]) {
    const antes = s.tabela('EVENTOS').find((e) => e.event_id === ev).total_value;
    s.editar('EVENTOS', ev, 'total_value', 9999.99);
    const r = s.integridade();
    assert.equal(r.ok, false, 'adulteração de ' + ev);
    assert.ok(financeiros(r).some((t) => /O valor gravado no evento .*\(R\$ 9\.999,99\) difere do que os lançamentos dele somam/.test(t)), JSON.stringify(financeiros(r)));
    s.editar('EVENTOS', ev, 'total_value', antes / 100);
  }
  assert.equal(s.integridade().ok, true);
  // Evento sem lançamento: total_value preenchido à mão também é acusado.
  s.editar('EVENTOS', semLanc.event_id, 'total_value', 10);
  assert.ok(financeiros(s.integridade()).some((t) => /nenhum lançamento/.test(t)));
});

// ---------------------------------------------------------------- achado 16 ----
test('achado 16: estorno bloqueado por um custo alocado aponta o evento dono do rateio, com tipo e data dele, uma vez só', () => {
  const { m } = ambiente();
  const ini = m.run('registrar', entradaInicial([bicho({ brinco: 'X1', sexo: 'F', data_nascimento: '2023-01-01', data_nascimento_confianca: 'ESTIMADA' })]));
  const id = ini.dados.animais[0].animal_id;
  const custeio = m.tabela('PLANO_CONTAS').find((c) => c.natureza === 'CUSTEIO' && c.ativo !== false).conta_id;
  const mo = m.run('registrar', { tipo: 'MORTE', campos: { event_date: '2026-07-01', causa: 'DOENCA', custo_valor: 15000, custo_conta_id: custeio }, animais: [{ animal_id: id }] });
  const e = m.tentar('estornar', { event_id: ini.dados.event_id, justificativa: 'x' });
  assert.equal(e.erro.code, 'CONFLICT');
  assert.deepEqual(e.erro.details.map((d) => [d.codigo, d.conflito.event_id, d.conflito.tipo, d.conflito.data]), [['EVENTO_DEPENDENTE', mo.dados.event_id, 'MORTE', '2026-07-01']]);
  assert.equal(e.erro.message, 'Não dá para estornar: X1: tem a morte de 01/07/2026, que depende desta entrada.');
  assert.ok(!/rateio/.test(JSON.stringify(e.erro)), 'não manda refazer um rateio que não existe');
});

// ---------------------------------------------------------------- achado 17 ----
test('achado 17: frete da compra, custo da morte e receita do descarte aceitam mais de uma parcela (mensais), e a correção as preserva', () => {
  const { m, G, parceiro } = ambiente();
  const forn = parceiro('Fornecedor', ['FORNECEDOR']);
  const g = (b) => ({ brinco: b, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 });
  const dados = compra('2026-02-05', forn, PASTOS.A, [g('1'), g('2')], { modalidade: 'CABECA', preco_unitario: 100000, valor_animais: 200000 },
    { parcelas: [{ data_vencimento: '2026-03-05' }], custos: [{ tipo: 'FRETE', valor: 60001, data_vencimento: '2026-01-31', parcelas_qtd: 3 }] });
  const sim = m.simular('registrar', dados);
  assert.ok(sim.ok, JSON.stringify(sim.erro));
  const c1 = m.run('registrar', dados);
  assert.deepEqual(parcelasDe(m, c1.dados.event_id).find((x) => /Frete/.test(x[0]))[1], [['2026-01-31', 20001], ['2026-02-28', 20000], ['2026-03-31', 20000]]);
  // Correção só da observação: as três parcelas do frete continuam.
  const c2 = m.run('corrigir', Object.assign({}, dados, { event_id: c1.dados.event_id, justificativa: 'nota', campos: Object.assign({}, dados.campos, { condicoes: 'frete em 3x' }) }));
  assert.equal(parcelasDe(m, c2.dados.event_id).find((x) => /Frete/.test(x[0]))[1].length, 3);
  // Morte com custo em 2 vezes; descarte com receita em 2 vezes.
  const ini = m.run('registrar', entradaInicial([bicho({ brinco: 'M1', data_nascimento: '2020-01-01', data_nascimento_confianca: 'ESTIMADA' }), bicho({ brinco: 'D1', data_nascimento: '2020-01-01', data_nascimento_confianca: 'ESTIMADA' })]));
  const custeio = m.tabela('PLANO_CONTAS').find((x) => x.natureza === 'CUSTEIO' && x.ativo !== false).conta_id;
  const mo = m.run('registrar', { tipo: 'MORTE', campos: { event_date: '2026-07-01', causa: 'DOENCA', custo_valor: 15000, custo_conta_id: custeio, custo_parcelas_qtd: 2 }, animais: [{ animal_id: ini.dados.animais[0].animal_id }] });
  assert.deepEqual(parcelasDe(m, mo.dados.event_id)[0][1], [['2026-07-01', 7500], ['2026-08-01', 7500]]);
  const de = m.run('registrar', { tipo: 'DESCARTE', campos: { event_date: '2026-07-02', destino: 'CONSUMO_PROPRIO', motivo: 'IDADE', receita_valor: 50001, receita_vencimento: '2026-08-10', receita_parcelas_qtd: 2 }, animais: [{ animal_id: ini.dados.animais[1].animal_id }] });
  assert.deepEqual(parcelasDe(m, de.dados.event_id)[0][1], [['2026-08-10', 25001], ['2026-09-10', 25000]]);
  // Faixa: 0 vezes é recusado pelo catálogo.
  const zero = m.tentar('registrar', Object.assign({}, dados, { custos: [{ tipo: 'FRETE', valor: 600, parcelas_qtd: 0 }] }));
  assert.deepEqual([zero.ok, codigos(zero.erro).includes('VALOR_FORA_DA_FAIXA')], [false, true]);
  // Unidade: vencimentos mensais no último dia quando o mês é mais curto.
  assert.deepEqual([G.Utils.somaMeses('2028-01-31', 1), G.Utils.somaMeses('2026-12-15', 2), G.Utils.somaMeses('2026-05-31', 0)], ['2028-02-29', '2027-02-15', '2026-05-31']);
  assert.throws(() => G.Utils.somaMeses('2026-01-01', -1), (e) => e.code === 'INTERNAL');
  assert.deepEqual(C.js(G.FinancialService.parcelasMensais(1000, '2026-01-10', null, {})).map((p) => [p.data_vencimento, p.valor]), [['2026-01-10', 1000]]);
  assert.deepEqual(m.invariantes(), []);
});

// ---------------------------------------------------------------- achado 18 ----
test('achado 18: a visão geral lê o valor de compras e vendas pelas alocações do lançamento principal, não por valor_individual', () => {
  const s = S.sistema();
  const G = s.G;
  const forn = s.exec((ctx) => G.UnitOfWork.run(ctx, G.Config.comandoSalvarParceiro({ idempotencyKey: 'p', dados: { campos: { nome: 'F', tipos: ['FORNECEDOR'] } } }))).dados.partner_id;
  const g = (b, pasto) => ({ brinco: b, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 12, pasto_destino_id: pasto });
  const cp = s.evento('registrar', { tipo: 'COMPRA', campos: { event_date: '2026-02-05', partner_id: forn, pasto_destino_id: S.PASTOS.A, modalidade: 'CABECA', preco_unitario: 100000, valor_animais: 200000 },
    animais: [g('901', S.PASTOS.A), g('902', S.PASTOS.B)], parcelas: [{ data_vencimento: '2026-03-05' }] }, 'k-c').dados;
  const visao = (fl) => s.read(G.InventoryService.consultaVisaoGeral(Object.assign({ data_inicio: '2026-01-01', data_fim: '2026-11-13' }, fl))).movimento.compras.valor;
  assert.deepEqual([visao({}), visao({ pasture_id: S.PASTOS.A }), visao({ pasture_id: S.PASTOS.B })], [200000, 100000, 100000]);
  // Um re-rateio (Fase 4) muda as alocações sem estornar o evento: simulado aqui na planilha, mantendo a soma.
  const fin = s.tabela('FINANCEIRO').find((f) => f.event_id === cp.event_id && f.natureza === 'AQUISICAO_ANIMAIS');
  const allocs = s.tabela('ALOCACOES_FINANCEIRAS').filter((a) => a.financial_id === fin.financial_id);
  const idA = cp.animais.find((a) => a.brinco === '901').animal_id;
  allocs.forEach((a) => s.editar('ALOCACOES_FINANCEIRAS', a.alloc_id, 'valor_alocado', a.animal_id === idA ? 1300 : 700));
  assert.deepEqual([visao({}), visao({ pasture_id: S.PASTOS.A }), visao({ pasture_id: S.PASTOS.B })], [200000, 130000, 70000]);
});

// ---------------------------------------------------------------- achado 24 ----
test('achado 24: evento.obter devolve os totais da venda (FinancialService.totaisVenda) e o papel de cada lançamento; a tela só exibe', () => {
  const { m, G, parceiro } = ambiente();
  const comp = parceiro('Frigorífico', ['COMPRADOR']);
  const forn = parceiro('Fornecedor', ['FORNECEDOR']);
  const ids = m.run('registrar', compra('2026-02-01', forn, PASTOS.A, [{ brinco: 'V1', sexo: 'M', castrado: true, reprodutor: false, idade_meses: 20 }, { brinco: 'V2', sexo: 'M', castrado: true, reprodutor: false, idade_meses: 20 }],
    { modalidade: 'CABECA', preco_unitario: 100000, valor_animais: 200000 }, { parcelas: [{ data_vencimento: '2026-03-01' }], custos: [{ tipo: 'FRETE', valor: 5000 }, { tipo: 'OUTRO', valor: 3000 }] }));
  const compraId = ids.dados.event_id;
  const v = m.run('registrar', venda('2026-06-01', comp, ids.dados.animais.map((a) => ({ animal_id: a.animal_id })), { modalidade: 'CABECA', preco_unitario: 150000, valor_bruto: 300000, desconto_comercial: 10000 },
    { parcelas: [{ data_vencimento: '2026-07-01' }], deducoes: [{ tipo: 'COMISSAO', valor: 6000 }, { tipo: 'FUNRURAL', valor: 4000, retida_pelo_comprador: true }, { tipo: 'FRETE', valor: 2000 }] }));
  const o = m.obter(v.dados.event_id);
  assert.deepEqual(C.js(o.totais_venda), C.js(G.FinancialService.totaisVenda({ valor_bruto: 300000, desconto_comercial: 10000, deducoes: [{ tipo: 'COMISSAO', valor: 6000 }, { tipo: 'FUNRURAL', valor: 4000, retida: true }, { tipo: 'FRETE', valor: 2000 }] })));
  assert.deepEqual([o.totais_venda.receita, o.totais_venda.resultado_negociacao, o.totais_venda.deposito_esperado, o.totais_venda.frete, o.totais_venda.comissao, o.totais_venda.outras_deducoes], [290000, 278000, 286000, 2000, 6000, 4000]);
  const papeis = Object.values(o.papeis).sort();
  assert.deepEqual(papeis, ['DEDUCAO:COMISSAO', 'DEDUCAO:FRETE', 'DEDUCAO:FUNRURAL', 'RECEITA']);
  const oc = m.obter(compraId);
  assert.deepEqual(Object.values(oc.papeis).sort(), ['ANIMAIS', 'FRETE', 'OUTRO']);
  assert.equal(oc.totais_venda, null);
  // O detalhe da venda não refaz a conta no aparelho (§20, regra 8): lê os totais do servidor. A prévia da correção lê a entrada
  // que o servidor montou (evento.obter: `correcao`, com o tipo de cada dedução; CONTRATOS, seção 50), em vez de remontá-la pelos
  // papéis dos lançamentos.
  const telas = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'Events.html'), 'utf8');
  assert.ok(!/valor_bruto\s*-\s*\(vd\.desconto_comercial/.test(telas) && /o\.totais_venda/.test(telas) && /o\.correcao\b/.test(telas));
  assert.deepEqual(C.js(o.correcao.deducoes).map((x) => x.tipo).sort(), ['COMISSAO', 'FRETE', 'FUNRURAL'], 'o tipo de cada dedução vem do servidor');
});
