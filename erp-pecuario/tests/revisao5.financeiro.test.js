'use strict';
/**
 * Revisão final da Fase 2 (rodada 5), lente FINANCEIRO: cada achado confirmado vira um teste que falhava antes do
 * conserto. A importação de COMPRAS não toma animais iguais sem identificação por repetição; os títulos apagados ou
 * cancelados à mão são acusados como fonte quebrada, sem o reparo que os apagaria; a importação de VENDAS fala da coluna
 * da planilha. Depois de cada comando, a projeção gravada é a reconstrução.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');
const { api } = require('./apoio-telas');

const { PASTOS, situacoes } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

function base(opcoes) {
  const s = S.sistema(opcoes || {});
  s.parceiro = (nome, tipos) => s.exec((ctx) => s.G.UnitOfWork.run(ctx, s.G.Config.comandoSalvarParceiro({ idempotencyKey: 'p-' + nome, dados: { campos: { nome, tipos } } }))).dados.partner_id;
  s.erros = () => (s.integridade().achados || []).filter((x) => x.severidade === 'ERRO').map((x) => [x.checagem, x.mensagem]);
  return s;
}
function criarImportacao(s, tipo, csv, chave) {
  return s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: chave, avisosAceitos: ['POSSIVEL_DUPLICIDADE'], dados: { tipo, arquivo_nome: chave + '.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
}
function validarTudo(s, id, mapa) {
  for (let b = 1; b < 100; b++) {
    const e = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + id + '-' + b, dados: { import_id: id, bloco: b, mapeamento: mapa } })).dados;
    if (e.importacao.status === 'VALIDADO') return e;
  }
  throw new Error('validação não terminou');
}
const linhasImp = (s, id) => s.read(s.G.ImportService.consultaLinhas({ import_id: id, por_pagina: 500 })).itens;
const importarBloco = (s, id, b, extra) => s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: Object.assign({ import_id: id, bloco: b }, extra || {}) }));
const concluir = (s, id) => s.tentar((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: id } }));
const titulos = (s) => s.read({ rota: 't', reads: ['FINANCEIRO', 'PARCELAS'], tratador: (tx) => s.G.FinancialService.titulos(tx.repo, '2026-11-13') });
const reparar = (s) => s.tentar((ctx) => s.G.AuditService.repararIntegridade(ctx, 'teste'));

// ---------------------------------------------------------------- achado 1 (ALTA) ----
test('R5 achado 1: na importação de COMPRAS, 4 linhas iguais de garrotes ainda sem brinco são 4 animais (R$ 2.500,00 cada), não repetição', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  s.parceiro('Fazenda Vizinha', ['FORNECEDOR']);
  const linha = 'C1;10/02/2026;Fazenda Vizinha;lote;cabeças;10.000,00;10/03/2026;M;12;N;N;Pasto A';
  const csv = ['Nº da compra;Data da compra;Fornecedor;Como foi o preço;Como dividir o valor;Valor dos animais (R$);Primeiro vencimento;Sexo;Idade (meses);Castrado;Reprodutor;Pasto', linha, linha, linha, linha].join('\n');
  const MAPA = {
    colunas: { 'Nº da compra': 'grupo', 'Data da compra': 'data', Fornecedor: 'fornecedor', 'Como foi o preço': 'modalidade', 'Como dividir o valor': 'criterio_rateio', 'Valor dos animais (R$)': 'valor_animais',
      'Primeiro vencimento': 'vencimento', Sexo: 'sexo', 'Idade (meses)': 'idade_meses', Castrado: 'castrado', Reprodutor: 'reprodutor', Pasto: 'pasto' },
    confiancas: {}, padroes: {},
  };
  const imp = criarImportacao(s, 'COMPRAS', csv, 'garrotes');
  validarTudo(s, imp.import_id, MAPA);
  assert.deepEqual(linhasImp(s, imp.import_id).map((l) => [l.linha_num, l.status]), [[2, 'VALIDA'], [3, 'VALIDA'], [4, 'VALIDA'], [5, 'VALIDA']]);
  const r = importarBloco(s, imp.import_id, 1, { modo: 'TOTAL' });
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.ok(concluir(s, imp.import_id).ok);
  s.conferirProjecoes('fim');
  const cp = s.tabela('COMPRAS');
  assert.deepEqual(cp.map((c) => [c.qtd_animais, c.valor_animais, c.criterio_rateio]), [[4, 1000000, 'CABECAS']]);
  assert.deepEqual(s.tabela('ANIMAIS').filter((a) => a.origem === 'COMPRADO').map((a) => a.custo_aquisicao), [250000, 250000, 250000, 250000]);
  assert.deepEqual(s.erros(), []);
  // Com identificação, a linha igual continua sendo repetição (a mesma compra do mesmo animal duas vezes).
  const s2 = base({ config: { importacao_lote_linhas: '50' } });
  s2.parceiro('Fazenda Vizinha', ['FORNECEDOR']);
  const comBrinco = 'C1;10/02/2026;Fazenda Vizinha;lote;cabeças;10.000,00;10/03/2026;M;12;N;N;Pasto A;700';
  const csv2 = ['Nº da compra;Data da compra;Fornecedor;Como foi o preço;Como dividir o valor;Valor dos animais (R$);Primeiro vencimento;Sexo;Idade (meses);Castrado;Reprodutor;Pasto;Brinco', comBrinco, comBrinco].join('\n');
  const imp2 = criarImportacao(s2, 'COMPRAS', csv2, 'com-brinco');
  validarTudo(s2, imp2.import_id, { colunas: Object.assign({}, MAPA.colunas, { Brinco: 'brinco' }), confiancas: {}, padroes: {} });
  assert.deepEqual(linhasImp(s2, imp2.import_id).map((l) => [l.linha_num, l.status, l.erros.map((e) => e.codigo)]), [[2, 'VALIDA', []], [3, 'DUPLICADA', ['LINHA_REPETIDA_NO_ARQUIVO']]]);
});

// ---------------------------------------------------------------- achado 2 (ALTA) ----
function compraEVenda() {
  const s = base();
  const forn = s.parceiro('Fornecedor', ['FORNECEDOR']);
  const comp = s.parceiro('Frigorífico', ['COMPRADOR']);
  const compra = s.evento('registrar', { tipo: 'COMPRA', campos: { event_date: '2026-02-05', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 600000 },
    animais: [{ brinco: '200', sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 }, { brinco: '201', sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 }],
    parcelas: [{ data_vencimento: '2026-03-05' }, { data_vencimento: '2026-04-05' }], custos: [{ tipo: 'FRETE', valor: 8000 }] }, 'c1').dados;
  const venda = s.evento('registrar', { tipo: 'VENDA', campos: { event_date: '2026-06-05', partner_id: comp, finalidade: 'ABATE', modalidade: 'CABECA', preco_unitario: 450000, valor_bruto: 450000 },
    animais: [{ animal_id: compra.animais[0].animal_id }], parcelas: [{ data_vencimento: '2026-07-05' }], deducoes: [{ tipo: 'FUNRURAL', valor: 6750, retida_pelo_comprador: true }] }, 'v1').dados;
  s.conferirProjecoes('compra e venda');
  assert.deepEqual(s.erros(), []);
  return { s, compra, venda };
}
test('R5 achado 2: as parcelas de compra e de venda apagadas à mão são ERRO da fonte, sem reparo; o reparo é recusado e a dívida e o recebível continuam', () => {
  const { s, compra, venda } = compraEVenda();
  assert.deepEqual([titulos(s).a_pagar, titulos(s).a_receber], [614750, 450000]);
  const finCompra = s.tabela('FINANCEIRO').find((f) => f.event_id === compra.event_id && f.valor === 600000);
  const finVenda = s.tabela('FINANCEIRO').find((f) => f.event_id === venda.event_id && f.valor === 450000);
  [finCompra, finVenda].forEach((f) => s.tabela('PARCELAS').filter((p) => p.financial_id === f.financial_id).forEach((p) => s.apagarLinha('PARCELAS', p.parcela_id)));
  const antes = titulos(s);
  const r = s.integridade();
  assert.equal(r.ok, false);
  assert.equal(r.reparavel, false, 'o reparo refaria o "sem caixa" e apagaria os títulos');
  assert.match(r.reparo_impedido, /linhas apagadas ou mexidas à mão.*Restaure o backup/);
  const fin = r.achados.filter((a) => a.checagem === 'FINANCEIRO').map((a) => a.mensagem);
  assert.ok(fin.some((m) => /"Compra de 2 animais", de 05\/02\/2026, está sem parcela: .*Restaure o backup/.test(m)), JSON.stringify(fin));
  assert.ok(fin.some((m) => /"Venda de 1 animal", de 05\/06\/2026, está sem parcela/.test(m)), JSON.stringify(fin));
  assert.ok(fin.some((m) => /descontada pelo comprador, não tem recebimento da venda onde ser descontada/.test(m)), JSON.stringify(fin));
  assert.ok(!fin.some((m) => /precisa ficar "sem caixa"/.test(m)), 'a frase errada de antes não aparece');
  const manutencoes = s.tabela('AUDITORIA').filter((a) => a.acao === 'MANUTENCAO').length;
  const rep = reparar(s);
  assert.deepEqual([rep.ok, rep.erro && rep.erro.code], [false, 'CONFLICT']);
  assert.deepEqual(s.tabela('FINANCEIRO').filter((f) => f === finCompra || f.financial_id === finCompra.financial_id || f.financial_id === finVenda.financial_id).map((f) => f.status_pagamento), ['ABERTO', 'ABERTO'], 'nada foi refeito');
  assert.equal(s.tabela('AUDITORIA').filter((a) => a.acao === 'MANUTENCAO').length, manutencoes, 'o reparo recusado não grava nada');
  assert.deepEqual(titulos(s), antes, 'o reparo recusado não mexe em nada');
  assert.ok(s.integridade().achados.some((a) => /"Compra de 2 animais", de 05\/02\/2026, está sem parcela/.test(a.mensagem)), 'a falta continua acusada');
});

test('R5 achado 2: a única parcela de um frete marcada CANCELADA à mão, sem desdobramento, é ERRO da fonte e impede o reparo', () => {
  const { s, compra } = compraEVenda();
  const frete = s.tabela('FINANCEIRO').find((f) => f.event_id === compra.event_id && f.valor === 8000);
  const pf = s.tabela('PARCELAS').find((p) => p.financial_id === frete.financial_id);
  s.editar('PARCELAS', pf.parcela_id, 'status', 'CANCELADA');
  const r = s.integridade();
  assert.deepEqual([r.ok, r.reparavel], [false, false]);
  const msgs = r.achados.map((a) => [a.checagem, a.mensagem]);
  assert.ok(msgs.some(([c, m]) => c === 'PARCELAS' && /A parcela 1 de "Frete .*" está cancelada sem as parcelas do desdobramento/.test(m)), JSON.stringify(msgs));
  assert.ok(msgs.some(([c, m]) => c === 'FINANCEIRO' && /"Frete .*", de 05\/02\/2026, está sem parcela/.test(m)), JSON.stringify(msgs));
  assert.equal(reparar(s).erro.code, 'CONFLICT');
  assert.equal(s.tabela('FINANCEIRO').find((f) => f.financial_id === frete.financial_id).status_pagamento, 'ABERTO');
});

test('R5 achado 2: sem falso positivo — saldo de abertura e compra e venda históricas, sem parcela, não acusam; o reparo de projeção continua quando a fonte está certa', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  s.parceiro('Fazenda Vizinha', ['FORNECEDOR']);
  const v = s.evento('registrar', S.entradaInicial([S.bicho({ brinco: '100', valor_abertura: 300000 })]), 'abertura').dados;
  const MAPA_C = { colunas: { 'Nº da compra': 'grupo', 'Data da compra': 'data', Fornecedor: 'fornecedor', 'Como foi o preço': 'modalidade', 'Valor dos animais (R$)': 'valor_animais', 'Preço (R$)': 'preco',
    Brinco: 'brinco', Sexo: 'sexo', Nascimento: 'data_nascimento', Castrado: 'castrado', Reprodutor: 'reprodutor', Pasto: 'pasto' }, confiancas: { data_nascimento: 'ESTIMADA' }, padroes: {} };
  const imp = criarImportacao(s, 'COMPRAS', ['Nº da compra;Data da compra;Fornecedor;Como foi o preço;Valor dos animais (R$);Preço (R$);Brinco;Sexo;Nascimento;Castrado;Reprodutor;Pasto',
    'H1;10/02/2025;Fazenda Vizinha;cabeça;2.000,00;2.000,00;900;M;01/01/2024;S;N;Pasto A'].join('\n'), 'historico');
  validarTudo(s, imp.import_id, MAPA_C);
  assert.ok(importarBloco(s, imp.import_id, 1, { modo: 'TOTAL' }).ok);
  assert.ok(concluir(s, imp.import_id).ok);
  assert.equal(s.tabela('PARCELAS').length, 0, 'nem a abertura nem a compra histórica têm parcela');
  assert.deepEqual(s.erros(), []);
  // A projeção mexida à mão, com a fonte certa, continua reparável.
  s.editar('ANIMAIS', v.animais[0].animal_id, 'pasto_atual_id', PASTOS.B);
  const r = s.integridade();
  assert.deepEqual([situacoes(r).PROJECAO, r.reparavel, r.reparo_impedido], ['ERRO', true, null]);
  const rep = reparar(s);
  assert.ok(rep.ok && rep.valor.integridade.ok, JSON.stringify(rep.erro));
});

// ---------------------------------------------------------------- achado 12 (MÉDIA) ----
function compraComDoisFretes() {
  const s = base();
  const forn = s.parceiro('Forn', ['FORNECEDOR']);
  const TA = s.parceiro('Transp A', ['TRANSPORTADOR']);
  const TB = s.parceiro('Transp B', ['TRANSPORTADOR']);
  const fA = { tipo: 'FRETE', valor: 10000, partner_id: TA, data_vencimento: '2026-02-10' };
  const fB = { tipo: 'FRETE', valor: 20000, partner_id: TB, data_vencimento: '2026-02-10' };
  const dados = { tipo: 'COMPRA', campos: { event_date: '2026-02-10', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 200000, valor_animais: 200000 },
    animais: [{ brinco: '300', sexo: 'F', idade_meses: 20 }], parcelas: [{ data_vencimento: '2026-02-10' }], custos: [fA, fB] };
  const c = s.evento('registrar', dados, 'c').dados;
  const doEv = (id) => s.tabela('FINANCEIRO').filter((f) => f.event_id === id);
  const pdf = (t) => Buffer.from('%PDF-1.4\n' + t + '\n%%EOF').toString('base64');
  let n = 0;
  const anexar = (fid, nome) => s.exec((ctx) => s.G.FileService.adicionarAnexo(ctx, { idempotencyKey: 'anx' + (++n), dados: { entidade: 'FINANCEIRO', entity_id: fid, tipo: 'NOTA_FISCAL', nome_arquivo: nome, mime_type: 'application/pdf', conteudo_base64: pdf(nome) } }));
  anexar(doEv(c.event_id).find((f) => f.valor === 10000).financial_id, 'conhecimento-A.pdf');
  anexar(doEv(c.event_id).find((f) => f.valor === 20000).financial_id, 'conhecimento-B.pdf');
  const ondeFicou = (evId) => Object.fromEntries(s.tabela('ANEXOS').filter((a) => a.event_id === evId && a.status === 'ATIVO').map((a) => {
    const f = s.tabela('FINANCEIRO').find((x) => x.financial_id === a.entity_id);
    return [a.nome_arquivo, a.entidade === 'FINANCEIRO' ? (f.partner_id === TA ? 'A' : f.partner_id === TB ? 'B' : '?') + ':' + f.valor : 'evento'];
  }));
  return { s, c, dados, fA, fB, ondeFicou };
}
test('R5 achado 12: na correção, o documento de cada frete vai para o mesmo frete no substituto (parceiro e valor), não pela posição', () => {
  // (1) A correção tira só o frete da Transp A: o documento dele fica no evento, o da Transp B segue com o frete dela.
  const x = compraComDoisFretes();
  const sim = api(x.s, { rota: 'evento.simular', dados: { acao: 'corrigir', dados: Object.assign({}, x.dados, { custos: [x.fB], event_id: x.c.event_id, justificativa: 'o frete da Transp A não era desta compra' }) } });
  assert.ok(sim.ok, JSON.stringify(sim.error));
  assert.deepEqual(sim.data.impactos.anexos_soltos, ['conhecimento-A.pdf'], 'a revisão diz qual documento fica sem lançamento');
  const cor = x.s.evento('corrigir', Object.assign({}, x.dados, { custos: [x.fB], event_id: x.c.event_id, justificativa: 'o frete da Transp A não era desta compra' }), 'cor').dados;
  x.s.conferirProjecoes('correção');
  assert.deepEqual(x.ondeFicou(cor.event_id), { 'conhecimento-A.pdf': 'evento', 'conhecimento-B.pdf': 'B:20000' });
  assert.deepEqual(x.s.erros(), []);
  // (2) A aba FINANCEIRO classificada pelo valor (ordem física trocada) e a correção sem mudar nada: cada um no seu.
  const y = compraComDoisFretes();
  const mtz = y.s.gas.planilhas.matriz(y.s.banco(), 'FINANCEIRO');
  const corpo = mtz.slice(1).filter((l) => l.some((v) => v !== '' && v !== null));
  const iv = mtz[0].indexOf('valor');
  corpo.sort((a, b) => Number(b[iv]) - Number(a[iv]));
  y.s.gas.planilhas.gravar(y.s.banco(), 'FINANCEIRO', 2, 1, corpo);
  assert.deepEqual(y.s.erros(), [], 'classificar a aba não muda nenhum dado');
  const cor2 = y.s.evento('corrigir', Object.assign({}, y.dados, { event_id: y.c.event_id, justificativa: 'conferência' }), 'cor2').dados;
  assert.deepEqual(y.ondeFicou(cor2.event_id), { 'conhecimento-A.pdf': 'A:10000', 'conhecimento-B.pdf': 'B:20000' });
  assert.deepEqual(y.s.erros(), []);
});

// ---------------------------------------------------------------- achado 14 (BAIXA) ----
test('R5 achado 14: com o Funrural desativado na lista, a importação de VENDAS fala da coluna "Funrural (R$)", não de "Dedução 1"', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  s.parceiro('Frigorífico Boi Bom', ['COMPRADOR']);
  s.evento('registrar', S.entradaInicial([S.bicho({ brinco: '100', sexo: 'M', castrado: true, data_nascimento: '2024-03-01', data_nascimento_confianca: 'CONFIRMADA' })]), 'ev-base');
  const item = s.tabela('LISTAS').find((l) => l.lista === 'TIPO_DEDUCAO_VENDA' && l.codigo === 'FUNRURAL');
  assert.ok(s.tentar((ctx) => s.G.Config.salvarLista(ctx, { idempotencyKey: 'desativa', dados: { lista_id: item.lista_id, ativo: false } })).ok);
  const MAPA = { colunas: { 'Nº da venda': 'grupo', 'Data da venda': 'data', Comprador: 'comprador', 'Para que foram vendidos': 'finalidade', 'Como foi o preço': 'modalidade', 'Preço (R$)': 'preco', 'Valor bruto (R$)': 'valor_bruto',
    'Funrural (R$)': 'funrural', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
  const imp = criarImportacao(s, 'VENDAS', ['Nº da venda;Data da venda;Comprador;Para que foram vendidos;Como foi o preço;Preço (R$);Valor bruto (R$);Funrural (R$);Brinco',
    'V1;20/06/2026;Frigorífico Boi Bom;abate;cabeça;3.000,00;3.000,00;90,00;100'].join('\n'), 'vendas');
  validarTudo(s, imp.import_id, MAPA);
  const l = linhasImp(s, imp.import_id)[0];
  assert.deepEqual([l.status, l.erros.map((e) => e.codigo)], ['ERRO', ['VALOR_FORA_DA_LISTA']]);
  assert.equal(l.erros[0].mensagem, 'coluna "Funrural (R$)": "Contribuição previdenciária rural retida" foi desativado nas listas: reative-o em Configurações › Listas para importar esta coluna.');
  assert.doesNotMatch(l.erros[0].mensagem, /Dedução \d|em "Dedução"/);
});
