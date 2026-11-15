'use strict';
/**
 * Revisão independente da Fase 2, rodada 2, lente FINANCEIRO: cada achado confirmado vira um teste que falhava antes do
 * conserto. Depois de cada comando a projeção gravada é a reconstrução (Timeline.conferir) e a integridade fica sem erro.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { PASTOS } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

function base(opcoes) {
  const s = S.sistema(Object.assign({ config: { importacao_lote_linhas: '50' } }, opcoes || {}));
  let n = 0;
  s.tent = (acao, dados, avisos) => {
    const r = s.tentar((ctx) => s.G.EventService[acao](ctx, { idempotencyKey: 'f2-' + (++n), dados, avisosAceitos: avisos || [] }));
    s.conferirProjecoes(acao + ' ' + (dados.tipo || ''));
    return r;
  };
  s.reg = (acao, dados, avisos) => {
    const r = s.tent(acao, dados, avisos);
    if (!r.ok) throw new Error(acao + ': ' + JSON.stringify(r.erro));
    return r.valor.dados;
  };
  s.erros = () => (s.integridade().achados || []).filter((x) => x.severidade === 'ERRO').map((x) => [x.checagem, x.mensagem]);
  s.parceiro = (nome, tipos) => s.exec((ctx) => s.G.UnitOfWork.run(ctx, s.G.Config.comandoSalvarParceiro({ idempotencyKey: 'p-' + nome, dados: { campos: { nome, tipos } } }))).dados.partner_id;
  s.bois = s.reg('registrar', S.entradaInicial(['100', '101', '102'].map((brinco, i) => S.bicho({ brinco, sexo: 'M', castrado: true, data_nascimento: '2024-0' + (i + 3) + '-01', data_nascimento_confianca: 'CONFIRMADA' })))).animais.map((a) => a.animal_id);
  return s;
}
function importar(s, tipo, csv, mapa, chave, avisos) {
  const c = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: chave, avisosAceitos: ['POSSIVEL_DUPLICIDADE'], dados: { tipo, arquivo_nome: chave + '.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
  let e;
  for (let b = 1; b < 50; b++) {
    e = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'v-' + chave + '-' + b, dados: { import_id: c.import_id, bloco: b, mapeamento: mapa } })).dados;
    if (e.importacao.status === 'VALIDADO') break;
  }
  const linhas = s.read(s.G.ImportService.consultaLinhas({ import_id: c.import_id, por_pagina: 50 })).itens;
  return { id: c.import_id, linhas };
}
function concluir(s, id, avisos) {
  const r = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: avisos || [], dados: { import_id: id, bloco: 1, modo: 'TOTAL' } }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  const c = s.tentar((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: id } }));
  assert.ok(c.ok, JSON.stringify(c.erro));
  s.conferirProjecoes('concluir');
}
const eventoDa = (s, id) => s.tabela('EVENTOS').find((e) => e.import_id === id);

// ---------------------------------------------------------------- achado 4 ----
test('achado 4: COMPRAS com frete e outros custos 0,00 e VENDAS com desconto, frete e comissão 0,00 entram: zero é "não houve" (sem lançamento)', () => {
  const s = base();
  s.parceiro('Vizinho', ['FORNECEDOR', 'COMPRADOR']);
  const MAPA_C = { colunas: { 'Nº da compra': 'grupo', 'Data da compra': 'data', Fornecedor: 'fornecedor', 'Como foi o preço': 'modalidade', 'Valor dos animais (R$)': 'valor_animais', 'Preço (R$)': 'preco', 'Frete (R$)': 'frete', 'Outros custos (R$)': 'outros_custos', 'Primeiro vencimento': 'vencimento', Brinco: 'brinco', Sexo: 'sexo', Nascimento: 'data_nascimento', Pasto: 'pasto' }, confiancas: { data_nascimento: 'ESTIMADA' }, padroes: { castrado: false, reprodutor: false } };
  const c = importar(s, 'COMPRAS', 'Nº da compra;Data da compra;Fornecedor;Como foi o preço;Valor dos animais (R$);Preço (R$);Frete (R$);Outros custos (R$);Primeiro vencimento;Brinco;Sexo;Nascimento;Pasto\nC1;10/05/2026;Vizinho;cabeça;2.000,00;2.000,00;0,00;0,00;10/06/2026;500;M;01/01/2025;Pasto A', MAPA_C, 'compras-zero');
  assert.deepEqual(c.linhas.map((l) => [l.status, l.erros.map((e) => e.codigo)]), [['VALIDA', []]]);
  concluir(s, c.id);
  assert.deepEqual(s.tabela('FINANCEIRO').filter((f) => f.event_id === eventoDa(s, c.id).event_id).map((f) => [f.natureza, f.valor]), [['AQUISICAO_ANIMAIS', 200000]]);
  const MAPA_V = { colunas: { 'Nº da venda': 'grupo', 'Data da venda': 'data', Comprador: 'comprador', 'Para que foram vendidos': 'finalidade', 'Como foi o preço': 'modalidade', 'Preço (R$)': 'preco', 'Valor bruto (R$)': 'valor_bruto', 'Desconto no preço (R$)': 'desconto', 'Frete (R$)': 'frete', 'Comissão (R$)': 'comissao', 'Primeiro vencimento': 'vencimento', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
  const v = importar(s, 'VENDAS', 'Nº da venda;Data da venda;Comprador;Para que foram vendidos;Como foi o preço;Preço (R$);Valor bruto (R$);Desconto no preço (R$);Frete (R$);Comissão (R$);Primeiro vencimento;Brinco\nV1;10/08/2026;Vizinho;recria e engorda;cabeça;3.000,00;3.000,00;0,00;0,00;0,00;10/09/2026;100', MAPA_V, 'vendas-zero');
  assert.deepEqual(v.linhas.map((l) => [l.status, l.erros.map((e) => e.codigo)]), [['VALIDA', []]]);
  concluir(s, v.id);
  const ev = eventoDa(s, v.id);
  assert.deepEqual(s.tabela('FINANCEIRO').filter((f) => f.event_id === ev.event_id).map((f) => [f.natureza, f.valor]), [['RECEITA_VENDA_ANIMAIS', 300000]]);
  assert.equal(s.tabela('VENDAS').find((x) => x.event_id === ev.event_id).desconto_comercial, 0);
  // No formulário, desconto 0,00 também é aceito (03b, 4.2: ≥ 0, "0,00 se não houver").
  const comp = s.tabela('PARCEIROS').find((p) => p.nome === 'Vizinho').partner_id;
  const r = s.tent('registrar', { tipo: 'VENDA', campos: { event_date: '2026-08-20', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000, desconto_comercial: 0 }, animais: [{ animal_id: s.bois[1] }], parcelas: [{ data_vencimento: '2026-09-20' }] });
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 5 ----
test('achado 5: VENDAS com "Funrural descontado pelo comprador" = sim grava a dedução retida, com o comprador como parceiro, o título no recebimento e o depósito esperado líquido', () => {
  const s = base();
  const comprador = s.parceiro('Frigorífico', ['COMPRADOR']);
  const MAPA = { colunas: { 'Nº da venda': 'grupo', 'Data da venda': 'data', Comprador: 'comprador', 'Para que foram vendidos': 'finalidade', 'Como foi o preço': 'modalidade', 'Preço (R$)': 'preco', 'Valor bruto (R$)': 'valor_bruto', 'Funrural (R$)': 'funrural', 'Funrural descontado pelo comprador': 'funrural_retido', 'Comissão (R$)': 'comissao', 'Primeiro vencimento': 'vencimento', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
  const csv = 'Nº da venda;Data da venda;Comprador;Para que foram vendidos;Como foi o preço;Preço (R$);Valor bruto (R$);Funrural (R$);Funrural descontado pelo comprador;Comissão (R$);Primeiro vencimento;Brinco\n'
    + 'V1;10/09/2026;Frigorífico;abate;cabeça;4.500,00;4.500,00;67,50;sim;50,00;10/10/2026;100';
  // O modelo oferece a coluna e reconhece o rótulo inteiro.
  const modelo = s.G.ImportService.modelo('VENDAS');
  assert.ok(modelo.campos.some((c) => c.campo === 'funrural_retido' && c.tipo === 'bool' && c.escopo === 'EVENTO'));
  assert.equal(s.G.ImportService.sugerirMapeamento(csv.split('\n')[0].split(';'), 'VENDAS')['Funrural descontado pelo comprador'], 'funrural_retido');
  const v = importar(s, 'VENDAS', csv, MAPA, 'vendas-funrural');
  assert.deepEqual(v.linhas.map((l) => [l.status, l.erros.map((e) => e.codigo)]), [['VALIDA', []]]);
  concluir(s, v.id);
  const ev = eventoDa(s, v.id);
  const fins = s.tabela('FINANCEIRO').filter((f) => f.event_id === ev.event_id);
  const fun = fins.find((f) => f.valor === 6750);
  const com = fins.find((f) => f.valor === 5000);
  assert.deepEqual([fun.retida_pelo_comprador, fun.partner_id], [true, comprador]);
  assert.deepEqual(s.tabela('PARCELAS').filter((p) => p.financial_id === fun.financial_id).map((p) => p.data_vencimento), ['2026-10-10'], 'retida: o título é o do recebimento');
  assert.deepEqual([com.retida_pelo_comprador, com.partner_id], [false, null], 'sem a marca, a dedução não é descontada (como no formulário)');
  const totais = s.read(s.G.EventService.consultaObter({ event_id: ev.event_id })).totais_venda;
  assert.equal(totais.deposito_esperado, 450000 - 6750);
  // Valor para todas as linhas (escolha explícita do dono no mapeamento).
  const MAPA2 = { colunas: { 'Nº da venda': 'grupo', 'Data da venda': 'data', Comprador: 'comprador', 'Para que foram vendidos': 'finalidade', 'Como foi o preço': 'modalidade', 'Preço (R$)': 'preco', 'Valor bruto (R$)': 'valor_bruto', 'Funrural (R$)': 'funrural', 'Primeiro vencimento': 'vencimento', Brinco: 'brinco' }, confiancas: {}, padroes: { funrural_retido: true } };
  const v2 = importar(s, 'VENDAS', 'Nº da venda;Data da venda;Comprador;Para que foram vendidos;Como foi o preço;Preço (R$);Valor bruto (R$);Funrural (R$);Primeiro vencimento;Brinco\nV2;11/09/2026;Frigorífico;abate;cabeça;4.000,00;4.000,00;60,00;11/10/2026;101', MAPA2, 'vendas-padrao');
  assert.deepEqual(v2.linhas.map((l) => l.status), ['VALIDA']);
  concluir(s, v2.id);
  const fun2 = s.tabela('FINANCEIRO').find((f) => f.event_id === eventoDa(s, v2.id).event_id && f.valor === 6000);
  assert.deepEqual([fun2.retida_pelo_comprador, fun2.partner_id], [true, comprador]);
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 15 ----
test('achado 15: item de lista desativado depois de usado não impede corrigir o evento; um desativado novo continua recusado, com o nome do item', () => {
  const s = base();
  const comp = s.parceiro('Frigorífico', ['COMPRADOR']);
  const venda = (preco, deducao, forma) => ({ tipo: 'VENDA', campos: { event_date: '2026-08-10', partner_id: comp, finalidade: 'ABATE', modalidade: 'CABECA', preco_unitario: preco, valor_bruto: preco }, animais: [{ animal_id: s.bois[0] }], parcelas: [{ data_vencimento: '2026-09-10', forma_pagamento: forma || 'BOLETO' }], deducoes: [{ tipo: deducao || 'SENAR', valor: 600 }] });
  const v = s.reg('registrar', venda(300000));
  const item = (lista, codigo) => s.tabela('LISTAS').find((l) => l.lista === lista && l.codigo === codigo);
  const desativar = (l, k) => s.exec((ctx) => s.G.Config.salvarLista(ctx, { idempotencyKey: 'lst-' + k, dados: { lista_id: l.lista_id, ativo: false } }));
  desativar(item('TIPO_DEDUCAO_VENDA', 'SENAR'), 1);
  desativar(item('FORMA_PAGAMENTO', 'BOLETO'), 2);
  // Lançamento novo com o item desativado: recusado, com o nome (não o código).
  const novo = s.tent('registrar', Object.assign(venda(310000), { animais: [{ animal_id: s.bois[1] }] }));
  assert.equal(novo.erro.code, 'VALIDATION');
  assert.ok(novo.erro.details.some((d) => d.codigo === 'VALOR_FORA_DA_LISTA' && /"Contribuição ao Senar" foi desativado nas listas/.test(d.mensagem)), JSON.stringify(novo.erro.details));
  // Correção só do preço, com as mesmas deduções e forma de pagamento: aceita.
  const r = s.tent('corrigir', Object.assign(venda(310000), { event_id: v.event_id, justificativa: 'preço errado' }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.equal(s.tabela('VENDAS').find((x) => x.event_id === r.valor.dados.event_id).valor_bruto, 310000);
  // Trocar para outro item desativado na correção continua recusado.
  desativar(item('TIPO_DEDUCAO_VENDA', 'FUNRURAL'), 3);
  const r2 = s.tent('corrigir', Object.assign(venda(310000, 'FUNRURAL'), { event_id: r.valor.dados.event_id, justificativa: 'tipo' }));
  assert.equal(r2.erro.code, 'VALIDATION');
  assert.ok(r2.erro.details.some((d) => d.codigo === 'VALOR_FORA_DA_LISTA'));
  assert.deepEqual(s.erros(), []);
});
