'use strict';
/**
 * Importadores de eventos históricos (E2.10; §14; 04, seções 6 e 8; 05, RN-088 a RN-095; 09, CT-12): COMPRAS, VENDAS,
 * TRANSFERENCIAS, NASCIMENTOS e MORTES. Cada evento passa pelo mesmo planejamento do formulário; linhas com a mesma chave
 * formam um evento; ordem cronológica; lotes de eventos inteiros com chave determinística; anterior ao marco zero vira
 * registro histórico (efeito 0, sem caixa); desfazer; reconciliação da fotografia do marco zero com o histórico.
 * Depois de cada comando, projeção = reconstrução (Timeline.conferir vazio).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js, D0, PASTOS } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

function preparar(config) {
  const s = S.sistema({ config: Object.assign({ importacao_lote_linhas: '2' }, config || {}) });
  const parceiro = (nome, tipos, chave) => s.exec((ctx) => s.G.Config.salvarParceiro(ctx, { idempotencyKey: chave, dados: { campos: { nome, tipos } } })).dados.partner_id;
  s.fornecedor = parceiro('Fazenda Vizinha', ['FORNECEDOR'], 'p-forn');
  s.comprador = parceiro('Frigorífico Boi Bom', ['COMPRADOR'], 'p-comp');
  const bichos = [
    S.bicho({ brinco: '100', sexo: 'M', castrado: true, data_nascimento: '2024-03-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '101', sexo: 'M', castrado: true, data_nascimento: '2024-04-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '102', sexo: 'M', castrado: true, data_nascimento: '2024-05-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '300', sexo: 'F', data_nascimento: '2020-01-10', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '301', sexo: 'F', data_nascimento: '2019-06-10', data_nascimento_confianca: 'CONFIRMADA', pasto_destino_id: PASTOS.B }),
  ];
  s.evento('registrar', S.entradaInicial(bichos), 'ev-base');
  s.conferirProjecoes('rebanho inicial');
  return s;
}
function criar(s, tipo, csv, chave) {
  return s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: chave || 'criar-' + tipo, dados: { tipo, arquivo_nome: tipo.toLowerCase() + '.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
}
function validarTudo(s, id, mapa) {
  let estado;
  for (let b = 1; b < 100; b++) {
    estado = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + id + '-' + b + '-' + JSON.stringify(mapa).length, dados: { import_id: id, bloco: b, mapeamento: mapa } })).dados;
    s.conferirProjecoes('validação ' + b);
    if (estado.importacao.status === 'VALIDADO') return estado;
  }
  throw new Error('validação não terminou');
}
function linhas(s, id, status) {
  return s.read(s.G.ImportService.consultaLinhas({ import_id: id, status, por_pagina: 500 })).itens;
}
function importar(s, id, bloco, extra, avisos) {
  return s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: avisos || [], dados: Object.assign({ import_id: id, bloco }, extra || {}) }));
}
/** Importa todos os blocos (bloco 1 com o modo) e conclui; projeção = reconstrução depois de cada comando. */
function importarTudo(s, id, extra, avisos) {
  let r = importar(s, id, 1, extra || { modo: 'TOTAL' }, avisos);
  assert.ok(r.ok, JSON.stringify(r.erro));
  s.conferirProjecoes('bloco 1');
  for (let b = 2; r.valor.dados.blocos.proximo !== null; b++) {
    r = importar(s, id, b, {}, avisos);
    assert.ok(r.ok, 'bloco ' + b + ': ' + JSON.stringify(r.erro));
    s.conferirProjecoes('bloco ' + b);
  }
  const fim = s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: id } })).dados;
  s.conferirProjecoes('concluir');
  return fim;
}
function animal(s, brinco) {
  return s.tabela('ANIMAIS').find((a) => a.brinco === brinco);
}
/** Integridade completa limpa (as checagens da Fase 2 aceitam o histórico importado). */
function integra(s, msg) {
  const r = s.integridade();
  assert.deepEqual(S.situacoes(r), {}, (msg || '') + ' ' + JSON.stringify(r.checagens.filter((x) => x.situacao !== 'OK' && x.situacao !== 'NAO_EXECUTADA')));
}
function eventosDe(s, id) {
  return s.tabela('EVENTOS').filter((e) => e.import_id === id);
}
const codigosLinha = (l) => l.erros.map((e) => e.codigo);

const MAPA_COMPRAS = {
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

test('COMPRAS: linhas agrupadas numa compra (financeiro com parcelas e frete), compra histórica de animal do marco zero (sem caixa, custo), lotes de eventos inteiros, concluir', () => {
  const s = preparar();
  const { G } = s;
  const c = criar(s, 'COMPRAS', COMPRAS);
  assert.deepEqual(c.sugestao, MAPA_COMPRAS.colunas, 'o modelo do tipo vem mapeado pelos rótulos');
  const v = validarTudo(s, c.import_id, MAPA_COMPRAS);
  assert.deepEqual([v.contadores.validas, v.contadores.erro, v.contadores.duplicadas], [4, 0, 0], JSON.stringify(linhas(s, c.import_id)));
  const fim = importarTudo(s, c.import_id);
  assert.equal(fim.importacao.status, 'IMPORTADO');
  assert.deepEqual([fim.criados.animais, fim.criados.eventos], [3, 2]);
  // Blocos de eventos inteiros, em ordem cronológica: a compra histórica (1 linha) e a compra de 3 animais (sozinha).
  assert.deepEqual(fim.importacao.relatorio.tamanhos_blocos, [1, 3]);
  const evs = eventosDe(s, c.import_id);
  assert.deepEqual(evs.map((e) => [e.event_type, e.event_date, e.pre_marco_zero, e.status, e.source]).sort(), [
    ['COMPRA', '2025-03-15', true, 'CONFIRMADO', 'IMPORTACAO'], ['COMPRA', '2026-02-10', false, 'CONFIRMADO', 'IMPORTACAO'],
  ]);
  const c1 = evs.find((e) => !e.pre_marco_zero);
  const c0 = evs.find((e) => e.pre_marco_zero);
  assert.deepEqual([c1.partner_id, c1.total_value], [s.fornecedor, 630000]);
  // Animais novos no rebanho, cada um no seu pasto; a compra histórica não mexe no inventário.
  assert.deepEqual(['200', '201', '202'].map((b) => [animal(s, b).situacao_cadastral, animal(s, b).pasto_atual_id, animal(s, b).origem]), [['ATIVO', PASTOS.A, 'COMPRADO'], ['ATIVO', PASTOS.A, 'COMPRADO'], ['ATIVO', PASTOS.B, 'COMPRADO']]);
  assert.equal(animal(s, '100').situacao_cadastral, 'ATIVO');
  assert.deepEqual(s.tabela('EVENTO_ANIMAIS').filter((l) => l.event_id === c0.event_id).map((l) => [l.efeito_inventario, l.animal_id]), [[0, animal(s, '100').animal_id]]);
  // Financeiro do próprio evento (P11): principal com 2 parcelas mensais + frete; a histórica sem caixa.
  const fin = s.tabela('FINANCEIRO');
  const parc = s.tabela('PARCELAS');
  const principal = fin.find((f) => f.event_id === c1.event_id && f.valor === 600000);
  assert.deepEqual(parc.filter((p) => p.financial_id === principal.financial_id).map((p) => [p.data_vencimento, p.valor]).sort(), [['2026-03-10', 300000], ['2026-04-10', 300000]]);
  assert.ok(fin.some((f) => f.event_id === c1.event_id && f.valor === 30000), 'frete em lançamento próprio');
  const hist = fin.filter((f) => f.event_id === c0.event_id);
  assert.deepEqual(hist.map((f) => [f.valor, f.status_pagamento, f.data_competencia]), [[200000, 'SEM_CAIXA', '2025-03-15']]);
  assert.equal(parc.filter((p) => p.financial_id === hist[0].financial_id).length, 0, 'compra antes do marco zero não tem parcela');
  // A compra histórica fica no histórico do animal (alocação de 2.000,00), fora do custo da permanência atual, que começa
  // no marco zero (a checagem de integridade CUSTO_AQUISICAO usa a mesma regra).
  assert.deepEqual(s.tabela('ALOCACOES_FINANCEIRAS').filter((a) => a.financial_id === hist[0].financial_id).map((a) => [a.animal_id, a.valor_alocado]), [[animal(s, '100').animal_id, 200000]]);
  assert.deepEqual([animal(s, '100').custo_aquisicao, animal(s, '100').custo_aquisicao_origem], [null, 'DESCONHECIDO']);
  assert.equal(animal(s, '200').custo_aquisicao, 210000, 'valor por cabeça + frete rateado');
  // Linhas: IMPORTADA com o animal e o evento.
  const ls = linhas(s, c.import_id);
  assert.deepEqual(ls.map((l) => [l.linha_num, l.status, l.entity_id_gerado === (animal(s, ['200', '201', '202', '100'][l.linha_num - 2]) || {}).animal_id]), [[2, 'IMPORTADA', true], [3, 'IMPORTADA', true], [4, 'IMPORTADA', true], [5, 'IMPORTADA', true]]);
  const integ = s.integridade();
  assert.deepEqual(S.situacoes(integ), {}, JSON.stringify(integ.checagens.filter((x) => x.situacao !== "OK" && x.situacao !== "NAO_EXECUTADA")));
  // Correção da compra histórica (substituto também histórico, sem caixa) e estorno da compra importada (anula os animais).
  s.evento('corrigir', {
    event_id: c0.event_id, justificativa: 'valor da nota', campos: { event_date: '2025-03-15', partner_id: s.fornecedor, modalidade: 'CABECA', preco_unitario: 210000, valor_animais: 210000, pasto_destino_id: PASTOS.A },
    animais: [{ animal_id: animal(s, '100').animal_id, brinco: '100' }],
  }, 'corr-c0');
  s.conferirProjecoes('correção da compra histórica');
  const sub = s.tabela('EVENTOS').find((e) => e.reversal_of_event_id === c0.event_id);
  assert.deepEqual([sub.pre_marco_zero, sub.total_value, s.tabela('FINANCEIRO').filter((f) => f.event_id === sub.event_id).map((f) => f.status_pagamento)], [true, 210000, ['SEM_CAIXA']]);
  const comParcela = s.tentar((ctx) => G.EventService.corrigir(ctx, { idempotencyKey: 'corr-c0-2', dados: { event_id: sub.event_id, justificativa: 'x', campos: { event_date: '2025-03-15', partner_id: s.fornecedor, modalidade: 'CABECA', preco_unitario: 210000, valor_animais: 210000, pasto_destino_id: PASTOS.A }, animais: [{ animal_id: animal(s, '100').animal_id, brinco: '100' }], parcelas: [{ data_vencimento: '2025-04-15' }] } }));
  assert.deepEqual(S.codigos(comParcela.erro), ['PARCELA_ANTES_DO_MARCO_ZERO']);
  s.evento('estornar', { event_id: c1.event_id, justificativa: 'compra lançada em dobro' }, 'est-c1');
  s.conferirProjecoes('estorno da compra importada');
  const anulados = s.tabela('ANIMAIS').filter((a) => ls.slice(0, 3).some((l) => l.entity_id_gerado === a.animal_id));
  assert.deepEqual(anulados.map((a) => a.situacao_cadastral), ['ANULADO', 'ANULADO', 'ANULADO'], 'os animais criados pela compra estornada ficam ANULADO');
});

const MAPA_TRANSF = { colunas: { Data: 'data', 'Pasto de origem': 'pasto_origem', 'Pasto de destino': 'pasto_destino', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
const TRANSF = [
  'Data;Pasto de origem;Pasto de destino;Brinco',
  '20/03/2026;Pasto B;Pasto A;100',
  '05/02/2026;Pasto A;Pasto B;100',
  '05/02/2026;Pasto A;Pasto B;101',
  '10/06/2025;Pasto A;Pasto B;101',
].join('\n');

test('TRANSFERENCIAS: ordem cronológica no ensaio (a segunda depende da primeira, em outro lote), histórico sem efeito, reconciliação do pasto, estorno e correção com dependente e lançamento retroativo', () => {
  const s = preparar();
  const { G } = s;
  const c = criar(s, 'TRANSFERENCIAS', TRANSF);
  const v = validarTudo(s, c.import_id, MAPA_TRANSF);
  assert.deepEqual([v.contadores.validas, v.contadores.erro], [4, 0], JSON.stringify(linhas(s, c.import_id).map((l) => [l.linha_num, l.erros])));
  // Antes de concluir nada vale: a primeira volta não mexe no rebanho.
  let r = importar(s, c.import_id, 1, { modo: 'TOTAL' });
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.deepEqual(r.valor.dados.blocos, { tamanho: 2, total: 3, importados: 1, proximo: 2 }, 'eventos inteiros: [histórica], [05/02 com 2 animais], [20/03]');
  assert.equal(animal(s, '100').pasto_atual_id, PASTOS.A, 'nada vale antes de concluir');
  // Outro lançamento é recusado enquanto a importação está em andamento.
  const bloqueado = s.tentar((ctx) => G.EventService.registrar(ctx, { idempotencyKey: 'outro', dados: { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-04-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: animal(s, '102').animal_id }] } }));
  assert.equal(bloqueado.erro.code, 'CONFLICT');
  const fim = importarTudo(s, c.import_id);
  assert.equal(fim.importacao.status, 'IMPORTADO');
  integra(s, 'transferências');
  assert.deepEqual([animal(s, '100').pasto_atual_id, animal(s, '101').pasto_atual_id], [PASTOS.A, PASTOS.B]);
  const evs = eventosDe(s, c.import_id);
  assert.deepEqual(evs.map((e) => [e.event_date, e.pre_marco_zero]).sort(), [['2025-06-10', true], ['2026-02-05', false], ['2026-03-20', false]]);
  // Reconciliação: o histórico põe o 101 no Pasto B no marco zero; a fotografia, no Pasto A (sem bloquear).
  const rec = fim.reconciliacao;
  assert.deepEqual(rec.animais.map((d) => [d.brinco, d.codigo, d.declarado.pasto, d.recalculado.pasto]), [['101', 'PASTO_DIVERGENTE', 'Pasto A', 'Pasto B']]);
  assert.match(rec.animais[0].explicacao, /último pasto do histórico é Pasto B \(10\/06\/2025\)/);
  assert.match(rec.animais[0].acao, /Corrigir localização/);
  assert.deepEqual(rec.pastos.map((p) => [p.pasto, p.declarado, p.recalculado, p.diferenca]), [['Pasto A', 4, 3, -1], ['Pasto B', 1, 2, 1]]);
  assert.equal(rec.resumo.bloqueia, false);
  // Estorno da primeira transferência do 100: a de 20/03 (importada) depende dela → CONFLICT com o detalhe dela.
  const t0502 = evs.find((e) => e.event_date === '2026-02-05');
  const t2003 = evs.find((e) => e.event_date === '2026-03-20');
  const est = s.tentar((ctx) => G.EventService.estornar(ctx, { idempotencyKey: 'est-1', dados: { event_id: t0502.event_id, justificativa: 'teste' } }));
  assert.equal(est.erro.code, 'CONFLICT');
  assert.ok(est.erro.details.some((d) => d.conflito && d.conflito.event_id === t2003.event_id), JSON.stringify(est.erro.details));
  // Lançamento retroativo pelo formulário que quebra a cadeia importada → CONFLICT com o evento importado.
  const retro = s.tentar((ctx) => G.EventService.registrar(ctx, { idempotencyKey: 'retro', dados: { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.B, pasto_destino_id: PASTOS.A }, animais: [{ animal_id: animal(s, '100').animal_id }] } }));
  assert.equal(retro.erro.code, 'CONFLICT');
  assert.ok(retro.erro.details.some((d) => d.conflito && d.conflito.event_id === t2003.event_id));
  // Correção do evento importado (substituto) e estorno do histórico funcionam.
  s.evento('corrigir', { event_id: t2003.event_id, justificativa: 'a data era outra', campos: { event_date: '2026-03-25', pasto_origem_id: PASTOS.B, pasto_destino_id: PASTOS.A }, animais: [{ animal_id: animal(s, '100').animal_id }] }, 'corr-1');
  s.conferirProjecoes('correção do importado');
  assert.equal(animal(s, '100').data_ultimo_movimento, '2026-03-25');
  const hist = evs.find((e) => e.pre_marco_zero);
  s.evento('estornar', { event_id: hist.event_id, justificativa: 'não aconteceu' }, 'est-hist');
  s.conferirProjecoes('estorno do histórico');
  const rec2 = s.read(G.ImportService.consultaReconciliacao());
  assert.deepEqual(rec2.animais, [], 'sem o histórico, nada a reconciliar');
  // Corrigir um registro histórico pelo formulário continua histórico (a data antiga é aceita na correção).
  const c2 = criar(s, 'TRANSFERENCIAS', 'Data;Pasto de origem;Pasto de destino;Brinco\n01/07/2025;Pasto B;Pasto A;102', 'criar-2');
  validarTudo(s, c2.import_id, MAPA_TRANSF);
  importarTudo(s, c2.import_id);
  const h2 = eventosDe(s, c2.import_id)[0];
  s.evento('corrigir', { event_id: h2.event_id, justificativa: 'origem errada', campos: { event_date: '2025-07-02', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: animal(s, '102').animal_id }] }, 'corr-hist');
  s.conferirProjecoes('correção do histórico');
  const sub = s.tabela('EVENTOS').find((e) => e.reversal_of_event_id === h2.event_id);
  assert.deepEqual([sub.event_date, sub.pre_marco_zero, sub.status], ['2025-07-02', true, 'CONFIRMADO']);
  assert.equal(animal(s, '102').pasto_atual_id, PASTOS.A, 'o histórico não mexe na posição de hoje');
});

test('TRANSFERENCIAS: origem que não confere com a cadeia vira erro da linha; lote que ficou sem a anterior não importa; deixar de fora um lançamento de que outro depende é recusado', () => {
  const s = preparar();
  const csv = ['Data;Pasto de origem;Pasto de destino;Brinco', '05/02/2026;Pasto A;Pasto B;100', '20/03/2026;Pasto A;Pasto B;100', '01/04/2026;Pasto A;Pasto B;102', '10/04/2026;Pasto B;Pasto A;102', '11/04/2026;Pasto A;Pasto B;999'].join('\n');
  const c = criar(s, 'TRANSFERENCIAS', csv);
  validarTudo(s, c.import_id, MAPA_TRANSF);
  const ls = linhas(s, c.import_id);
  assert.deepEqual(ls.map((l) => [l.linha_num, l.status]), [[2, 'VALIDA'], [3, 'ERRO'], [4, 'VALIDA'], [5, 'VALIDA'], [6, 'ERRO']]);
  assert.deepEqual(codigosLinha(ls[1]), ['ORIGEM_DIVERGENTE']);
  assert.match(ls[1].erros[0].mensagem, /parte do pasto Pasto A, mas nessa data o animal estaria no pasto Pasto B/);
  assert.deepEqual(codigosLinha(ls[4]), ['ANIMAL_NAO_ENCONTRADO']);
  // A volta do 102 (10/04) depende da ida (01/04): deixar a ida de fora é recusado.
  const dep = importar(s, c.import_id, 1, { modo: 'PARCIAL_APROVADO', aprovacao: { importar: 2, ignorar: 3 }, ignorar_linhas: [4] });
  assert.equal(dep.erro.code, 'VALIDATION');
  assert.deepEqual(S.codigos(dep.erro), ['DEPENDE_DE_LINHA_IGNORADA']);
  assert.equal(importar(s, c.import_id, 1, { modo: 'TOTAL' }).erro.code, 'VALIDATION', 'TOTAL com linha reprovada');
  const fim = importarTudo(s, c.import_id, { modo: 'PARCIAL_APROVADO', aprovacao: { importar: 3, ignorar: 2 } });
  assert.deepEqual([fim.contadores.importadas, fim.criados.eventos], [3, 3]);
  assert.deepEqual([animal(s, '100').pasto_atual_id, animal(s, '102').pasto_atual_id], [PASTOS.B, PASTOS.A]);
  assert.deepEqual(fim.reconciliacao.sem_animal.map((x) => [x.linha_num, x.tipo]), [[6, 'TRANSFERENCIAS']], 'brinco citado em evento sem animal');
});

const MAPA_VENDAS = {
  colunas: {
    'Nº da venda': 'grupo', 'Data da venda': 'data', Comprador: 'comprador', 'Para que foram vendidos': 'finalidade', 'Como foi o preço': 'modalidade', 'Preço (R$)': 'preco',
    'Valor bruto (R$)': 'valor_bruto', 'Comissão (R$)': 'comissao', 'Primeiro vencimento': 'vencimento', Brinco: 'brinco', 'Peso na venda (kg)': 'peso',
  },
  confiancas: {}, padroes: {},
};
const VENDAS = [
  'Nº da venda;Data da venda;Comprador;Para que foram vendidos;Como foi o preço;Preço (R$);Valor bruto (R$);Comissão (R$);Primeiro vencimento;Brinco;Peso na venda (kg)',
  'V1;10/08/2026;Frigorífico Boi Bom;abate;kg vivo;10,00;9.100,00;182,00;10/09/2026;100;450',
  'V1;;;;;;;;;101;460',
  'V0;01/05/2025;Frigorífico Boi Bom;recria e engorda;cabeça;2.500,00;2.500,00;;;102;',
].join('\n');
const MAPA_MORTES = { colunas: { 'Data da morte': 'data', 'Causa da morte': 'causa', Brinco: 'brinco' }, confiancas: {}, padroes: {} };

test('VENDAS e MORTES: venda com receita, dedução e parcela; venda histórica sem caixa; morte; reconciliação (saída histórica na fotografia, brinco sem animal); desfazer bloqueado por compra posterior', () => {
  const s = preparar();
  const { G } = s;
  const c = criar(s, 'VENDAS', VENDAS);
  const v = validarTudo(s, c.import_id, MAPA_VENDAS);
  assert.equal(v.contadores.validas, 3, JSON.stringify(linhas(s, c.import_id).map((l) => [l.linha_num, l.erros])));
  const fim = importarTudo(s, c.import_id);
  integra(s, 'vendas');
  assert.deepEqual(['100', '101', '102'].map((b) => [animal(s, b).situacao_cadastral, animal(s, b).data_saida]), [['VENDIDO', '2026-08-10'], ['VENDIDO', '2026-08-10'], ['ATIVO', null]]);
  const evs = eventosDe(s, c.import_id);
  const v1 = evs.find((e) => !e.pre_marco_zero);
  const v0 = evs.find((e) => e.pre_marco_zero);
  const fin = s.tabela('FINANCEIRO');
  const receita = fin.find((f) => f.event_id === v1.event_id && f.natureza === 'RECEITA_VENDA_ANIMAIS');
  assert.deepEqual([receita.valor, receita.partner_id], [910000, s.comprador]);
  assert.deepEqual(s.tabela('PARCELAS').filter((p) => p.financial_id === receita.financial_id).map((p) => [p.data_vencimento, p.valor]), [['2026-09-10', 910000]]);
  assert.deepEqual(fin.filter((f) => f.event_id === v1.event_id && f.natureza === 'DESPESA_VENDA').map((f) => f.valor), [18200]);
  assert.deepEqual(s.tabela('PESAGENS').filter((p) => p.event_id === v1.event_id).map((p) => [p.tipo, p.peso_kg]).sort(), [['VENDA', 450], ['VENDA', 460]]);
  assert.deepEqual(fin.filter((f) => f.event_id === v0.event_id).map((f) => [f.valor, f.status_pagamento]), [[250000, 'SEM_CAIXA']]);
  assert.deepEqual(s.tabela('EVENTO_ANIMAIS').filter((l) => l.event_id === v0.event_id).map((l) => l.efeito_inventario), [0], 'venda histórica não tira do rebanho');
  // Reconciliação: o 102 tem venda antiga e está na fotografia.
  assert.deepEqual(fim.reconciliacao.animais.map((d) => [d.brinco, d.codigo, d.evento.event_id]), [['102', 'SAIDA_HISTORICA_NA_FOTOGRAFIA', v0.event_id]]);
  assert.match(fim.reconciliacao.animais[0].explicacao, /foi vendido em 01\/05\/2025 pelo histórico, mas está na fotografia do marco zero \(01\/01\/2026\)/);
  // Mortes: uma do rebanho e uma de brinco desconhecido (vai para a reconciliação, sem bloquear a outra).
  const m = criar(s, 'MORTES', 'Data da morte;Causa da morte;Brinco\n01/09/2026;raio;102\n02/09/2025;doença;999', 'criar-mortes');
  validarTudo(s, m.import_id, MAPA_MORTES);
  assert.deepEqual(linhas(s, m.import_id).map((l) => [l.linha_num, l.status, codigosLinha(l)]), [[2, 'VALIDA', []], [3, 'ERRO', ['ANIMAL_NAO_ENCONTRADO']]]);
  const fimM = importarTudo(s, m.import_id, { modo: 'PARCIAL_APROVADO', aprovacao: { importar: 1, ignorar: 1 } });
  assert.deepEqual([animal(s, '102').situacao_cadastral, animal(s, '102').data_saida], ['MORTO', '2026-09-01']);
  assert.deepEqual(s.tabela('BAIXAS').filter((b) => b.animal_id === animal(s, '102').animal_id).map((b) => [b.tipo, b.causa]), [['MORTE', 'RAIO']]);
  assert.deepEqual(fimM.reconciliacao.sem_animal.map((x) => [x.tipo, x.linha_num]), [['MORTES', 3]]);
  integra(s, 'mortes');
  assert.match(fimM.reconciliacao.sem_animal[0].mensagem, /brinco 999 não está no rebanho nem no histórico/);
  // Compra posterior do 100 (volta ao rebanho): desfazer as vendas tiraria a saída de que ela depende → CONFLICT.
  const compra = s.evento('registrar', {
    tipo: 'COMPRA', campos: { event_date: '2026-10-01', partner_id: s.fornecedor, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 300000, pasto_destino_id: PASTOS.A },
    animais: [{ animal_id: animal(s, '100').animal_id, brinco: '100' }], parcelas: [{ data_vencimento: '2026-10-01' }],
  }, 'volta-100').dados;
  s.conferirProjecoes('volta do 100');
  const des = s.tentar((ctx) => G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id, justificativa: 'arquivo errado' } }));
  assert.equal(des.erro.code, 'CONFLICT');
  assert.deepEqual(des.erro.details.map((d) => [d.codigo, d.conflito && d.conflito.event_id]), [['DEPENDENTE', compra.event_id]]);
  s.evento('estornar', { event_id: compra.event_id, justificativa: 'para desfazer a importação' }, 'est-volta');
  const ok = s.exec((ctx) => G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id, justificativa: 'arquivo errado' } })).dados;
  s.conferirProjecoes('desfeita');
  assert.equal(ok.importacao.status, 'CANCELADO');
  assert.deepEqual(['100', '101'].map((b) => animal(s, b).situacao_cadastral), ['ATIVO', 'ATIVO']);
  assert.ok(s.tabela('EVENTOS').filter((e) => e.import_id === c.import_id).every((e) => e.status === 'CANCELADO'), 'nada se apaga: os eventos ficam CANCELADO');
  assert.equal(s.read(G.ImportService.consultaReconciliacao()).animais.length, 0, 'sem a venda antiga, a fotografia confere');
  integra(s, 'desfeita');
});

const MAPA_NASC = {
  colunas: { 'Data do parto': 'data', 'Brinco da mãe': 'mae', Nasceu: 'situacao', 'Sexo da cria': 'sexo', 'Brinco da cria': 'brinco', 'Peso ao nascer (kg)': 'peso', 'Como foi pesado': 'metodo_pesagem' },
  confiancas: {}, padroes: {},
};
const NASC = [
  'Data do parto;Brinco da mãe;Nasceu;Sexo da cria;Brinco da cria;Peso ao nascer (kg);Como foi pesado',
  '12/09/2026;300;vivo;M;400;32,5;balança',
  '12/09/2026;300;vivo;F;401;30;balança',
  '05/10/2025;301;vivo;F;402;;',
  '20/10/2026;301;natimorto;;;;',
].join('\n');

test('NASCIMENTOS: gêmeos num parto (linhas da mesma mãe e data), parto histórico (cria fora do inventário), natimorto; reconciliação da cria do histórico; estorno do parto com cria que tem lançamento posterior', () => {
  const s = preparar();
  const { G } = s;
  const c = criar(s, 'NASCIMENTOS', NASC);
  assert.equal(validarTudo(s, c.import_id, MAPA_NASC).contadores.validas, 4, JSON.stringify(linhas(s, c.import_id).map((l) => [l.linha_num, l.erros])));
  const fim = importarTudo(s, c.import_id);
  integra(s, 'nascimentos');
  assert.deepEqual([fim.criados.animais, fim.criados.eventos], [3, 3]);
  const mae = animal(s, '300');
  assert.deepEqual(['400', '401'].map((b) => [animal(s, b).situacao_cadastral, animal(s, b).mae_id, animal(s, b).pasto_atual_id, animal(s, b).data_nascimento, animal(s, b).origem]),
    [['ATIVO', mae.animal_id, PASTOS.A, '2026-09-12', 'NASCIDO'], ['ATIVO', mae.animal_id, PASTOS.A, '2026-09-12', 'NASCIDO']]);
  assert.deepEqual([animal(s, '402').situacao_cadastral, animal(s, '402').mae_id], ['HISTORICO', animal(s, '301').animal_id]);
  const partos = s.tabela('REPRODUCAO').filter((r) => r.tipo_evento === 'PARTO').map((r) => [r.data, r.qtd_nascidos_vivos, r.qtd_natimortos]).sort();
  assert.deepEqual(partos, [['2025-10-05', 1, 0], ['2026-09-12', 2, 0], ['2026-10-20', 0, 1]]);
  assert.deepEqual(s.tabela('PESAGENS').filter((p) => p.tipo === 'NASCIMENTO').map((p) => p.peso_kg).sort(), [30, 32.5]);
  const ls = linhas(s, c.import_id);
  assert.deepEqual(ls.map((l) => l.entity_id_gerado), [animal(s, '400').animal_id, animal(s, '401').animal_id, animal(s, '402').animal_id, null]);
  assert.deepEqual(fim.reconciliacao.animais.map((d) => [d.brinco, d.codigo]), [['402', 'FORA_DA_FOTOGRAFIA']]);
  // Estorno do parto de 12/09 com uma cria já transferida (lançamento posterior) → CONFLICT; sem ele, anula as duas crias.
  const parto = s.tabela('EVENTOS').find((e) => e.import_id === c.import_id && e.event_date === '2026-09-12');
  const t = s.evento('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-10-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: animal(s, '400').animal_id }] }, 't-400').dados;
  const est = s.tentar((ctx) => G.EventService.estornar(ctx, { idempotencyKey: 'est-parto', dados: { event_id: parto.event_id, justificativa: 'errado' } }));
  assert.equal(est.erro.code, 'CONFLICT');
  assert.ok(est.erro.details.some((d) => d.conflito && d.conflito.event_id === t.event_id));
  s.evento('estornar', { event_id: t.event_id, justificativa: 'para estornar o parto' }, 'est-t');
  s.evento('estornar', { event_id: parto.event_id, justificativa: 'errado' }, 'est-parto-2');
  s.conferirProjecoes('parto estornado');
  assert.deepEqual(['400', '401'].map((b) => (s.tabela('ANIMAIS').find((a) => a.codigo_interno === ls[b === '400' ? 0 : 1].entity_id_gerado || a.animal_id === ls[b === '400' ? 0 : 1].entity_id_gerado) || {}).situacao_cadastral), ['ANULADO', 'ANULADO']);
});

test('COMPRAS, recusas por linha: dados do lançamento que não batem entre as linhas, parceiro desconhecido, animal que já está no rebanho, linha repetida; o lançamento só entra inteiro; o mesmo arquivo de novo fica DUPLICADA', () => {
  const s = preparar();
  const { G } = s;
  const mapa = { colunas: { 'Nº da compra': 'grupo', 'Data da compra': 'data', Fornecedor: 'fornecedor', 'Como foi o preço': 'modalidade', 'Valor dos animais (R$)': 'valor_animais', 'Preço (R$)': 'preco', Brinco: 'brinco', Sexo: 'sexo', Pasto: 'pasto' }, confiancas: {}, padroes: { castrado: false, reprodutor: false } };
  const csv = [
    'Nº da compra;Data da compra;Fornecedor;Como foi o preço;Valor dos animais (R$);Preço (R$);Brinco;Sexo;Pasto',
    'C1;10/02/2026;Fazenda Vizinha;cabeça;4.000,00;2.000,00;500;M;Pasto A',
    'C1;11/02/2026;;;;;501;M;Pasto A',
    'C2;10/02/2026;Fornecedor Fantasma;cabeça;1.000,00;1.000,00;502;F;Pasto A',
    'C3;12/02/2026;Fazenda Vizinha;cabeça;1.000,00;1.000,00;101;M;Pasto A',
    'C4;13/02/2026;Fazenda Vizinha;cabeça;1.000,00;1.000,00;600;M;Pasto A',
    'C4;13/02/2026;Fazenda Vizinha;cabeça;1.000,00;1.000,00;600;M;Pasto A',
    'C5;14/02/2026;Fazenda Vizinha;por kg;1.000,00;;601;M;Pasto A',
  ].join('\n');
  // Mapeamento: o que o modelo exige.
  const c = criar(s, 'COMPRAS', csv);
  const semFornecedor = s.tentar((ctx) => G.ImportService.validarBloco(ctx, { idempotencyKey: 'v-x', dados: { import_id: c.import_id, bloco: 1, mapeamento: { colunas: { Brinco: 'brinco', Sexo: 'sexo' }, confiancas: {}, padroes: {} } } }));
  assert.equal(semFornecedor.erro.code, 'VALIDATION');
  assert.ok(semFornecedor.erro.details.some((d) => /Fornecedor/.test(d.mensagem)), JSON.stringify(semFornecedor.erro.details));
  validarTudo(s, c.import_id, mapa);
  const ls = linhas(s, c.import_id);
  assert.deepEqual(ls.map((l) => [l.linha_num, l.status, codigosLinha(l)]), [
    [2, 'ERRO', ['LANCAMENTO_COM_ERRO']],
    [3, 'ERRO', ['CONFLITO_NO_GRUPO']],
    [4, 'ERRO', ['PARCEIRO_NAO_ENCONTRADO']],
    [5, 'ERRO', ['JA_NO_REBANHO']],
    [6, 'VALIDA', []],
    [7, 'DUPLICADA', ['LINHA_REPETIDA_NO_ARQUIVO']],
    [8, 'ERRO', ['CAMPO_OBRIGATORIO', 'PESO_OBRIGATORIO']],
  ]);
  assert.match(ls[0].erros[0].mensagem, /compra C1\) tem problema na linha 3: ele só entra inteiro/);
  assert.match(ls[3].erros[0].mensagem, /já está no rebanho/);
  assert.match(ls[6].erros[0].mensagem, /preço/i, 'o preço por kg é exigido pelo formulário');
  const fim = importarTudo(s, c.import_id, { modo: 'PARCIAL_APROVADO', aprovacao: { importar: 1, ignorar: 6 } });
  assert.deepEqual([fim.contadores.importadas, fim.criados.animais, animal(s, '600').situacao_cadastral], [1, 1, 'ATIVO']);
  assert.equal(fim.reprovadas.length, 6);
  // O mesmo arquivo de novo: a compra do 600 já está registrada (aviso de arquivo repetido aceito no envio).
  const de2 = s.exec((ctx) => G.ImportService.criar(ctx, { idempotencyKey: 'criar-de-novo', avisosAceitos: ['POSSIVEL_DUPLICIDADE'], dados: { tipo: 'COMPRAS', arquivo_nome: 'compras.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
  validarTudo(s, de2.import_id, mapa);
  const l2 = linhas(s, de2.import_id);
  assert.deepEqual([l2[4].status, codigosLinha(l2[4])], ['DUPLICADA', ['EVENTO_JA_REGISTRADO']]);
  assert.match(l2[4].erros[0].mensagem, /já existe compra de 13\/02\/2026 com este animal/);
});

test('rotas pela api(): importacao.modelo por tipo (agrupamento e obrigatórios), importação de vendas pelos comandos da api, importacao.reconciliacao; tipo da Fase 3 recusado', () => {
  const s = preparar();
  const api = (p) => JSON.parse(JSON.stringify(s.gas.exec(() => s.G.api(p))));
  const m = api({ rota: 'importacao.modelo', dados: { tipo: 'VENDAS' } });
  assert.equal(m.ok, true, JSON.stringify(m.error));
  assert.deepEqual([m.data.tipo, m.data.evento, m.data.agrupamento.campo, m.data.agrupamento.obrigatorio], ['VENDAS', 'VENDA', 'grupo', true]);
  assert.deepEqual(m.data.obrigatorios, [['grupo'], ['data'], ['comprador'], ['valor_bruto'], ['finalidade'], ['modalidade'], ['brinco', 'codigo']]);
  assert.equal(Object.keys(s.G.ImportService.sugerirMapeamento(m.data.cabecalho_modelo, 'VENDAS')).length, m.data.campos.length, 'o modelo para baixar vem mapeado inteiro');
  assert.equal(api({ rota: 'importacao.modelo', dados: { tipo: 'PESAGENS' } }).error.code, 'VALIDATION');
  const t = api({ rota: 'importacao.modelo', dados: { tipo: 'TRANSFERENCIAS' } }).data;
  assert.deepEqual(t.agrupamento.natural, ['data', 'pasto_origem', 'pasto_destino']);
  const c = api({ rota: 'importacao.criar', idempotencyKey: 'api-criar', dados: { tipo: 'VENDAS', arquivo_nome: 'vendas.csv', conteudo_base64: b64(VENDAS), formato: FORMATO } });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const id = c.data.import_id;
  for (let b = 1; ; b++) {
    const v = api({ rota: 'importacao.validarBloco', idempotencyKey: 'api-val-' + b, dados: { import_id: id, bloco: b, mapeamento: MAPA_VENDAS } });
    assert.equal(v.ok, true, JSON.stringify(v.error));
    if (v.data.importacao.status === 'VALIDADO') break;
  }
  let r = api({ rota: 'importacao.importarBloco', dados: { import_id: id, bloco: 1, modo: 'TOTAL' } });
  for (let b = 2; r.ok && r.data.blocos.proximo !== null; b++) r = api({ rota: 'importacao.importarBloco', dados: { import_id: id, bloco: b } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const fim = api({ rota: 'importacao.concluir', dados: { import_id: id } });
  assert.equal(fim.ok, true, JSON.stringify(fim.error));
  const rec = api({ rota: 'importacao.reconciliacao', dados: {} });
  assert.equal(rec.ok, true);
  assert.deepEqual([rec.data.marco_zero, rec.data.resumo.divergencias, rec.data.resumo.por_codigo], [D0, 1, { SAIDA_HISTORICA_NA_FOTOGRAFIA: 1 }]);
  assert.deepEqual(api({ rota: 'importacao.relatorio', dados: { import_id: id } }).data.reconciliacao, rec.data, 'o relatório final traz a mesma reconciliação');
  s.conferirProjecoes('api');
});
