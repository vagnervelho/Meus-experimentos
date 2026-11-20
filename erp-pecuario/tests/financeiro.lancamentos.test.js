'use strict';
/**
 * Fase 4, etapa BASE (CONTRATOS, seção 55): as rotas `financeiro.lancamentos` (a lista da tela Financeiro, com os filtros),
 * `financeiro.lancamento` (o detalhe) e `financeiro.conciliacao` (a identidade das três visões, 07, seção 2.1), pela api(),
 * sobre os lançamentos que já existem desde a Fase 2, por todos os caminhos que os gravam: o rebanho inicial com o saldo de
 * abertura, a compra importada (com a histórica, anterior ao marco zero, sem caixa), a venda com a dedução retida, a morte
 * com custo e o estorno dela, a correção da venda, a entrada de estoque e a aplicação com consumo, o desfazer da importação.
 * Depois de cada comando o apoio confere a projeção e a identidade em todo fim de mês (tests/apoio-sistema.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js, PASTOS } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
const chamar = (s, pedido) => js(s.gas.exec(() => s.G.api(pedido)));
const ok = (r, msg) => { assert.equal(r.ok, true, (msg || '') + ' ' + JSON.stringify(r.error)); return r.data; };
const lista = (s, dados) => ok(chamar(s, { rota: 'financeiro.lancamentos', dados: dados || {} }), 'lista');
const detalhe = (s, id) => ok(chamar(s, { rota: 'financeiro.lancamento', dados: { financial_id: id } }), 'detalhe');
const conciliacao = (s, dados) => ok(chamar(s, { rota: 'financeiro.conciliacao', dados: dados || {} }), 'conciliação');

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
  'C0;15/03/2025;Fazenda Vizinha;cabeça;2.000,00;2.000,00;;;;100;;;;;Pasto A;',
].join('\n');

/** O rebanho do marco zero (um animal com valor de abertura) e os parceiros. */
function preparar() {
  const s = S.sistema({ config: { importacao_lote_linhas: '2' } });
  const parceiro = (nome, tipos, chave) => s.exec((ctx) => s.G.Config.salvarParceiro(ctx, { idempotencyKey: chave, dados: { campos: { nome, tipos } } })).dados.partner_id;
  s.fornecedor = parceiro('Fazenda Vizinha', ['FORNECEDOR'], 'p-forn');
  s.comprador = parceiro('Frigorífico Boi Bom', ['COMPRADOR'], 'p-comp');
  s.vet = parceiro('Dra. Ana Veterinária', ['VETERINARIO'], 'p-vet');
  s.evento('registrar', S.entradaInicial([
    S.bicho({ brinco: '100', sexo: 'M', castrado: true, data_nascimento: '2024-03-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '101', sexo: 'M', castrado: true, data_nascimento: '2024-04-01', data_nascimento_confianca: 'CONFIRMADA', valor_abertura: 380000 }),
    S.bicho({ brinco: '300', sexo: 'F', data_nascimento: '2020-01-10', data_nascimento_confianca: 'CONFIRMADA' }),
  ]), 'ev-base');
  s.conferirProjecoes('rebanho inicial');
  s.contas = Object.fromEntries(s.tabela('PLANO_CONTAS').map((x) => [x.codigo, x.conta_id]));
  s.animal = (brinco) => s.tabela('ANIMAIS').find((a) => a.brinco === brinco);
  return s;
}
/** A importação das compras (a de 2026, com 2 parcelas e frete; a histórica de 2025, sem caixa), validada, importada e concluída. */
function importarCompras(s) {
  const c = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'criar-compras', dados: { tipo: 'COMPRAS', arquivo_nome: 'compras.csv', conteudo_base64: b64(COMPRAS), formato: FORMATO } })).dados;
  for (let b = 1; b < 20; b++) {
    const v = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + b, dados: { import_id: c.import_id, bloco: b, mapeamento: MAPA } })).dados;
    if (v.importacao.status === 'VALIDADO') break;
  }
  let r = s.exec((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: c.import_id, bloco: 1, modo: 'TOTAL' } }));
  s.conferirProjecoes('bloco 1');
  for (let b = 2; r.dados.blocos.proximo !== null; b++) { r = s.exec((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: c.import_id, bloco: b } })); s.conferirProjecoes('bloco ' + b); }
  s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } }));
  s.conferirProjecoes('concluir');
  return c.import_id;
}
/** A venda de 100 e 101 (por cabeça, valor de cada animal) com a dedução retida pelo comprador. */
function vender(s) {
  const r = s.evento('registrar', {
    tipo: 'VENDA', campos: { event_date: '2026-05-20', partner_id: s.comprador, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', valor_bruto: 1000000 },
    animais: [{ animal_id: s.animal('100').animal_id, valor_individual: 480000 }, { animal_id: s.animal('101').animal_id, valor_individual: 520000 }],
    parcelas: [{ data_vencimento: '2026-06-20' }], deducoes: [{ tipo: 'FUNRURAL', valor: 15000, retida_pelo_comprador: true }],
  }, 'ev-venda');
  s.conferirProjecoes('venda');
  return r.dados.event_id;
}
const morte = (s, campos) => ({ tipo: 'MORTE', campos: Object.assign({ event_date: '2026-04-02', causa: 'DOENCA', custo_valor: 30001, custo_conta_id: s.contas.SERVICOS_VETERINARIOS, custo_partner_id: s.vet, custo_vencimento: '2026-04-30' }, campos || {}), animais: [{ animal_id: s.animal('202').animal_id }] });

test('financeiro.lancamentos: os lançamentos de todo caminho (abertura, compra importada e histórica, venda com retenção, morte com custo), os filtros, a ordem, os totais e as páginas do servidor', () => {
  const s = preparar();
  importarCompras(s);
  vender(s);
  s.evento('registrar', morte(s), 'ev-morte');
  s.conferirProjecoes('morte');
  const r = lista(s);
  // Os que valem, mais recentes primeiro (competência; no mesmo evento, o maior valor antes): a venda, a morte, a compra de
  // 2026, a abertura e a compra histórica.
  assert.deepEqual(r.itens.map((x) => [x.data_competencia, x.conta_codigo, x.valor, x.situacao]), [
    ['2026-05-20', 'VENDA_ANIMAIS', 1000000, 'ATIVO'], ['2026-05-20', 'TAXAS_RETENCOES_VENDA', 15000, 'ATIVO'],
    ['2026-04-02', 'SERVICOS_VETERINARIOS', 30001, 'ATIVO'],
    ['2026-02-10', 'COMPRA_ANIMAIS', 600000, 'ATIVO'], ['2026-02-10', 'FRETE_DESPESAS_COMPRA', 30000, 'ATIVO'],
    ['2026-01-01', 'SALDO_ABERTURA_REBANHO', 380000, 'ATIVO'], ['2025-03-15', 'COMPRA_ANIMAIS', 200000, 'ATIVO'],
  ]);
  assert.deepEqual([r.total, r.pagina, r.paginas, r.totais], [7, 1, 1, { receitas: 1000000, despesas: 15000 + 30001 + 600000 + 30000 + 380000 + 200000 }], 'os totais do filtro vêm do servidor');
  const compra = r.itens.find((x) => x.conta_codigo === 'COMPRA_ANIMAIS' && !x.pre_marco_zero);
  assert.deepEqual([compra.rotulo_evento, compra.event_type, compra.parceiro, compra.status_pagamento, compra.parcelas, compra.em_aberto, compra.criterio, compra.alocado, compra.nao_alocado, compra.animais],
    ['Comprar animais', 'COMPRA', 'Fazenda Vizinha', 'ABERTO', 2, 600000, 'CABECAS', 600000, 0, 3]);
  assert.ok(compra.vencido > 0, 'as parcelas de março e abril de 2026 já venceram hoje');
  const hist = r.itens.find((x) => x.pre_marco_zero);
  assert.deepEqual([hist.status_pagamento, hist.parcelas, hist.em_aberto], ['SEM_CAIXA', 0, 0], 'a compra anterior ao marco zero não tem caixa');
  const ab = r.itens.find((x) => x.conta_codigo === 'SALDO_ABERTURA_REBANHO');
  assert.deepEqual([ab.status_pagamento, ab.criterio, ab.nao_alocado, ab.rotulo_evento], ['SEM_CAIXA', 'DIRETO', 0, 'Rebanho inicial (marco zero)']);
  const ret = r.itens.find((x) => x.conta_codigo === 'TAXAS_RETENCOES_VENDA');
  assert.deepEqual([ret.retida_pelo_comprador, ret.tipo, ret.natureza], [true, 'DESPESA', 'DESPESA_VENDA']);
  // Filtros (cada um sozinho e combinados).
  const ids = (d) => lista(s, d).itens.map((x) => x.conta_codigo);
  assert.deepEqual(ids({ tipo: 'RECEITA' }), ['VENDA_ANIMAIS']);
  assert.deepEqual(ids({ natureza: 'AQUISICAO_ANIMAIS' }), ['COMPRA_ANIMAIS', 'FRETE_DESPESAS_COMPRA', 'SALDO_ABERTURA_REBANHO', 'COMPRA_ANIMAIS']);
  assert.deepEqual(ids({ de: '2026-01-01', ate: '2026-03-31' }), ['COMPRA_ANIMAIS', 'FRETE_DESPESAS_COMPRA', 'SALDO_ABERTURA_REBANHO']);
  assert.deepEqual(ids({ conta_id: s.contas.SERVICOS_VETERINARIOS }), ['SERVICOS_VETERINARIOS']);
  assert.deepEqual(ids({ partner_id: s.comprador }), ['VENDA_ANIMAIS', 'TAXAS_RETENCOES_VENDA'], 'a dedução retida sem parceiro informado é do comprador');
  assert.deepEqual(ids({ event_type: 'MORTE' }), ['SERVICOS_VETERINARIOS']);
  assert.deepEqual(ids({ status_pagamento: 'SEM_CAIXA' }), ['SALDO_ABERTURA_REBANHO', 'COMPRA_ANIMAIS']);
  assert.deepEqual(ids({ busca: 'MORTE' }), ['SERVICOS_VETERINARIOS'], 'a busca na descrição, sem caixa nem acento');
  assert.deepEqual(ids({ pasture_id: PASTOS.A }), [], 'nenhum lançamento destas fases é de um pasto');
  const p = lista(s, { por_pagina: 3, pagina: 3 });
  assert.deepEqual([p.total, p.paginas, p.pagina, p.itens.length, p.totais.receitas], [7, 3, 3, 1, 1000000], 'a página e o número de páginas vêm do servidor; os totais são do filtro inteiro');
  // Filtros inválidos: VALIDATION com o campo.
  for (const [dados, campo] of [[{ de: '31/12/2026' }, 'de'], [{ ate: '2026-02-30' }, 'ate'], [{ natureza: 'XPTO' }, 'natureza'], [{ tipo: 'AMBOS' }, 'tipo'], [{ situacao: 'VALE' }, 'situacao'], [{ status_pagamento: 'PAGO' }, 'status_pagamento'], [{ de: '2026-05-01', ate: '2026-04-01' }, 'de']]) {
    const e = chamar(s, { rota: 'financeiro.lancamentos', dados });
    assert.deepEqual([e.ok, e.error.code, e.error.details[0].campo], [false, 'VALIDATION', campo], JSON.stringify(dados));
  }
});

test('financeiro.lancamento: o detalhe (parcelas com a situação de hoje e os dias de atraso, rateio e alocações por animal, evento de origem); estorno → cancelado, parcelas sem efeito, rateio sem efeito; desconhecido → NOT_FOUND', () => {
  const s = preparar();
  importarCompras(s);
  const m = s.evento('registrar', morte(s), 'ev-morte');
  const fin = lista(s, { event_type: 'MORTE' }).itens[0];
  const d = detalhe(s, fin.financial_id);
  assert.deepEqual([d.lancamento.valor, d.lancamento.conta_nome, d.lancamento.situacao, d.evento.event_type, d.evento.vigente, d.anulado_por], [30001, 'Serviços veterinários', 'ATIVO', 'MORTE', true, null]);
  assert.deepEqual(d.parcelas.map((x) => [x.parcela_num, x.data_vencimento, x.valor, x.situacao, x.dias_atraso]), [[1, '2026-04-30', 30001, 'VENCIDA', 197]], 'vencida em 30/04, hoje 13/11/2026: 197 dias, contados no servidor');
  assert.deepEqual([d.rateio.criterio, d.rateio.vigente, d.rateio.total_alocado], ['DIRETO', true, 30001]);
  assert.deepEqual(d.alocacoes.map((x) => [x.brinco, x.valor_alocado]), [['202', 30001]]);
  // O estorno: o lançamento deixa a lista dos que valem e aparece entre os cancelados, com quem o anulou.
  s.evento('estornar', { event_id: m.dados.event_id, justificativa: 'Lançado por engano' }, 'est-morte');
  s.conferirProjecoes('estorno da morte');
  assert.equal(lista(s, { event_type: 'MORTE' }).total, 0);
  const canc = lista(s, { event_type: 'MORTE', situacao: 'CANCELADO' }).itens;
  assert.deepEqual(canc.map((x) => [x.situacao, x.status_pagamento, x.em_aberto, x.vencido]), [['CANCELADO', 'CANCELADO', 0, 0]]);
  const dc = detalhe(s, fin.financial_id);
  assert.deepEqual([dc.lancamento.situacao, dc.evento.vigente, dc.anulado_por.event_type, dc.parcelas.map((x) => x.situacao), dc.rateio.vigente], ['CANCELADO', false, 'ESTORNO', ['SEM_EFEITO'], false]);
  assert.equal(lista(s, { situacao: 'TODOS' }).total, lista(s).total + 1);
  // A compra: duas parcelas e o frete; a histórica sem parcela.
  const compra = lista(s, { natureza: 'AQUISICAO_ANIMAIS', de: '2026-02-01' }).itens.find((x) => x.conta_codigo === 'COMPRA_ANIMAIS');
  const dcompra = detalhe(s, compra.financial_id);
  assert.deepEqual(dcompra.parcelas.map((x) => [x.data_vencimento, x.valor, x.situacao]), [['2026-03-10', 300000, 'VENCIDA'], ['2026-04-10', 300000, 'VENCIDA']]);
  assert.deepEqual(dcompra.alocacoes.map((x) => [x.brinco, x.valor_alocado]).sort(), [['200', 200000], ['201', 200000], ['202', 200000]]);
  for (const idErrado of ['nao-existe', '', null]) {
    const e = chamar(s, { rota: 'financeiro.lancamento', dados: { financial_id: idErrado } });
    assert.deepEqual([e.ok, e.error.code], [false, 'NOT_FOUND'], String(idErrado));
    assert.match(e.error.message, /Lançamento financeiro não encontrado/);
  }
});

test('financeiro.conciliacao: fecha ao centavo em todo fim de mês com abertura, compra, morte, venda com retenção, estoque e consumo; os termos são os da conta à mão; ate futuro ou inválido → VALIDATION; o desfazer da importação e a correção sem mudança', () => {
  const s = preparar();
  const imp = importarCompras(s);
  vender(s);
  s.evento('registrar', morte(s), 'ev-morte');
  s.conferirProjecoes('morte');
  // Insumo: a vacina com custo por dose; a entrada (compra, a pagar) e a aplicação em 300 (consumo, sem caixa).
  const prod = s.exec((ctx) => s.G.HealthService.salvarProduto(ctx, { idempotencyKey: 'prod', dados: { campos: { nome: 'Vacina X', categoria: 'VACINA', unidade: 'dose', fator_conversao: 10, custo_unitario: 3, controla_estoque: true } } })).dados.product_id;
  s.evento('registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-06-01', product_id: prod, qtd_apresentacao: 1, valor: 3000, partner_id: s.fornecedor, vencimento: '2026-06-15' } }, 'ev-estoque');
  s.conferirProjecoes('estoque');
  s.evento('registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-06-05', produto_id: prod, modo_dose: 'POR_CABECA', dose_referencia: 1 }, animais: [{ animal_id: s.animal('300').animal_id }] }, 'ev-vacina');
  s.conferirProjecoes('vacinação');
  const c = conciliacao(s);
  assert.equal(c.ate, '2026-11-13', 'padrão: hoje no fuso da fazenda');
  assert.deepEqual([c.fecha, c.problemas], [true, []]);
  assert.equal(c.inicio, '2026-01-01', 'a compra histórica (2025) fica fora: o primeiro fato é a abertura do marco zero');
  assert.deepEqual(c.meses.map((m) => m.mes), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  const t = c.periodo.termos;
  // À mão: a pagar = compra 6.000 + frete 300 + morte 300,01 + retenção 150 + vacina 30; a receber = venda 10.000; ativo = 300 (abertura de 101 saiu
  // com a venda; 200 e 201 continuam: 2.000 + 100 cada); insumos = 30 − 3 (uma dose).
  assert.deepEqual([t.a_pagar, t.a_receber, t.caixa_acumulado, t.custo_rebanho_ativo, t.insumos_estoque, t.saldo_abertura, t.nao_operacional, t.despesa_antecipada],
    [600000 + 30000 + 30001 + 15000 + 3000, 1000000, 0, 420000, 2700, 380000, 0, 0]);
  const r = c.periodo.resultado;
  // Resultado: venda 10.000 − retenção 150 − custo de 101 (abertura 3.800) − custo de 202 (2.100, morte) − morte 300,01 − dose 3,00.
  assert.deepEqual([r.receita_venda, r.despesas_venda, r.custo_aquisicao.vendidos_descartados, r.custo_aquisicao.mortes, r.custeio, r.total],
    [1000000, 15000, 380000, 210000, 30301, 1000000 - 15000 - 380000 - 210000 - 30301]);
  assert.equal(t.resultado_acumulado, r.total);
  assert.deepEqual(c.meses.find((m) => m.mes === '2026-04').resultado.custo_aquisicao.mortes, 210000, 'a morte leva o custo de 202 para abril');
  // Datas: no passado, a mesma conta só com os fatos até lá; no futuro e inválida, recusa.
  const marco = conciliacao(s, { ate: '2026-03-31' });
  assert.deepEqual([marco.fecha, marco.periodo.termos.a_receber, marco.periodo.termos.custo_rebanho_ativo, marco.periodo.resultado.total], [true, 0, 380000 + 630000, 0]);
  for (const [ate, codigo] of [['2026-11-14', 'DATA_FUTURA'], ['13/11/2026', 'FORMATO_INVALIDO']]) {
    const e = chamar(s, { rota: 'financeiro.conciliacao', dados: { ate } });
    assert.deepEqual([e.ok, e.error.code, e.error.details[0].codigo, e.error.details[0].campo], [false, 'VALIDATION', codigo, 'ate'], ate);
  }
  // A correção sem mudança da venda (o substituto no lugar do original): a conciliação de antes e a de depois são iguais.
  const venda = s.tabela('EVENTOS').find((e) => e.event_type === 'VENDA');
  const obtido = ok(chamar(s, { rota: 'evento.obter', dados: { event_id: venda.event_id } }));
  const entrada = Object.assign({}, obtido.correcao);
  delete entrada.criados;
  s.evento('corrigir', Object.assign(entrada, { event_id: venda.event_id, justificativa: 'Conferido' }), 'corr-venda');
  s.conferirProjecoes('correção da venda');
  assert.deepEqual(conciliacao(s), c, 'a correção sem mudança não muda nenhum número das três visões');
  assert.equal(lista(s, { situacao: 'CANCELADO', event_type: 'VENDA' }).total, 2, 'os lançamentos da venda original ficam entre os cancelados');
  // O desfazer da importação (com a venda de 100 e 101, que não dependem dela, e sem a morte de 202, estornada antes).
  const morteEv = s.tabela('EVENTOS').find((e) => e.event_type === 'MORTE');
  s.evento('estornar', { event_id: morteEv.event_id, justificativa: 'Lançado por engano' }, 'est-morte');
  const des = s.tentar((ctx) => s.G.ImportService.desfazer(ctx, { avisosAceitos: [], dados: { import_id: imp, justificativa: 'arquivo errado' } }));
  assert.equal(des.ok, true, JSON.stringify(des.erro));
  s.conferirProjecoes('desfazer');
  const d2 = conciliacao(s);
  assert.equal(d2.fecha, true, d2.problemas.join(' | '));
  assert.deepEqual([d2.periodo.termos.a_pagar, d2.periodo.termos.custo_rebanho_ativo], [15000 + 3000, 0], 'sem a compra: a pagar só a retenção e a vacina; nenhum custo no rebanho');
  assert.equal(lista(s, { natureza: 'AQUISICAO_ANIMAIS' }).itens.map((x) => x.conta_codigo).join(), 'SALDO_ABERTURA_REBANHO', 'as compras importadas saem da lista dos que valem');
});

test('regra de tempo pela rota: a conciliação e a lista numa data passada não mudam com fato posterior nem com cadastro mudado; o fato retroativo muda só o que alcança', () => {
  const s = preparar();
  importarCompras(s);
  const D = '2026-03-31';
  const antes = conciliacao(s, { ate: D });
  const listaAntes = lista(s, { ate: D, situacao: 'TODOS' });
  // Fato depois de D: a venda de maio e a morte de abril (com custo).
  vender(s);
  s.evento('registrar', morte(s), 'ev-morte');
  s.conferirProjecoes('fatos depois de D');
  assert.deepEqual(conciliacao(s, { ate: D }), antes, 'a conciliação de 31/03 não muda com a venda e a morte depois dela');
  assert.deepEqual(lista(s, { ate: D, situacao: 'TODOS' }), listaAntes, 'nem a lista dos lançamentos até 31/03');
  // Cadastro mudado: o nome do parceiro (a conciliação não lê cadastro; a lista mostra o nome de hoje, por desenho).
  s.exec((ctx) => s.G.Config.salvarParceiro(ctx, { idempotencyKey: 'p-forn-2', dados: { partner_id: s.fornecedor, campos: { nome: 'Fazenda Vizinha Ltda' } } }));
  assert.deepEqual(conciliacao(s, { ate: D }), antes, 'o nome do parceiro não entra na conciliação');
  const renomeada = lista(s, { ate: D, situacao: 'TODOS' });
  const nomes = renomeada.itens.map((x) => x.parceiro).filter(Boolean);
  assert.ok(nomes.length >= 2 && nomes.every((n) => n === 'Fazenda Vizinha Ltda'), 'a lista mostra o nome de hoje: ' + JSON.stringify(nomes));
  assert.deepEqual(renomeada.itens.map((x) => [x.financial_id, x.valor, x.data_competencia]), listaAntes.itens.map((x) => [x.financial_id, x.valor, x.data_competencia]));
  // Fato retroativo antes de D: a morte de 202 em 15/03 (com custo) muda a conciliação de 31/03 só no que ela alcança.
  const est = s.tabela('EVENTOS').find((e) => e.event_type === 'MORTE');
  s.evento('estornar', { event_id: est.event_id, justificativa: 'data errada' }, 'est-morte-abril');
  s.evento('registrar', morte(s, { event_date: '2026-03-15', custo_vencimento: '2026-03-30' }), 'ev-morte-marco');
  s.conferirProjecoes('morte retroativa');
  const depois = conciliacao(s, { ate: D });
  assert.equal(depois.fecha, true, depois.problemas.join(' | '));
  const t0 = antes.periodo.termos;
  const t1 = depois.periodo.termos;
  assert.deepEqual([t1.custo_rebanho_ativo, t1.a_pagar, t1.resultado_acumulado], [t0.custo_rebanho_ativo - 210000, t0.a_pagar + 30001, t0.resultado_acumulado - 210000 - 30001],
    'o custo de 202 sai do rebanho ativo e entra no resultado (mortes), e o custo da morte fica a pagar');
  assert.deepEqual(depois.meses.slice(0, 2), antes.meses.slice(0, 2), 'janeiro e fevereiro não mudam');
});
