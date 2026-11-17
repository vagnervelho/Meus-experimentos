'use strict';
/**
 * INSUMOS (Fase 3, E3.2; 03a, seções 4.6, 4.7 e 6.4; 07, seção 5; desenho-base 16.9; PR-10 e PR-11): o cadastro de
 * produtos (`produto.salvar`) com o estoque opcional por produto (desligado por padrão) e o evento ESTOQUE — entrada
 * (compra do insumo do cadastro: sempre ESTOQUE_INSUMOS, com parcelas; o movimento de entrada só com o estoque
 * controlado), acerto pela contagem, perda e vencimento —, por caminho: registro, retroativo, correção (também do
 * produto), correção do substituto, estorno com e sem saída posterior (o saldo negativo pede confirmação), estorno da
 * correção; o saldo como projeção dos movimentos (ligar e desligar o controle) e a verificação de integridade. O exemplo
 * de 03a, seção 4.7, e os casos 1 a 3 de 07, seção 5, centavo a centavo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js } = S;

function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave, avisosAceitos: avisos || [] })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + JSON.stringify(r.error));
  return r.data;
}
function recusa(r, code, onde) {
  assert.equal(r.ok, false, (onde || '') + ': esperava ' + code);
  assert.equal(r.error.code, code, (onde || '') + ': ' + JSON.stringify(r.error).slice(0, 600));
  return r.error;
}
const det = (e) => e.details.map((d) => [d.codigo, d.campo || null]);
const cods = (e) => e.details.map((d) => d.codigo);
function estoque(subtipo, data, campos) {
  return { tipo: 'ESTOQUE', subtipo, campos: Object.assign({ event_date: data }, campos || {}) };
}
function produto(s, campos, chave) {
  return ok(api(s, 'produto.salvar', { campos: Object.assign({ nome: 'Vacina X', categoria: 'VACINA', unidade: 'dose' }, campos || {}) }, chave || 'p-' + Math.random()), 'produto');
}
const tab = (s, aba, filtro) => s.tabela(aba).filter((r) => Object.keys(filtro || {}).every((k) => r[k] === filtro[k]));
const prod = (s, id) => s.tabela('PRODUTOS').find((p) => p.product_id === id);
const conta = (s, codigo) => s.tabela('PLANO_CONTAS').find((c) => c.codigo === codigo);
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}

test('produto.salvar (03a, seção 4.6): nome, categoria e unidade obrigatórios; nome único entre os ativos; estoque desligado por padrão (PR-10); a unidade não muda depois do uso; saldo é projeção (não se edita); ligar o controle mostra o saldo dos movimentos, desligar apaga', () => {
  const s = S.sistema();
  assert.deepEqual(det(recusa(api(s, 'produto.salvar', { campos: {} }, 'p0'), 'VALIDATION')).sort(), [['CAMPO_OBRIGATORIO', 'categoria'], ['CAMPO_OBRIGATORIO', 'nome'], ['CAMPO_OBRIGATORIO', 'unidade']]);
  const p = produto(s, { nome: 'Vacina X', fabricante: 'Lab', apresentacao: 'frasco de 50 doses', fator_conversao: 50, custo_unitario: 1.8, carencia_padrao_dias: 21, estoque_minimo: 20 }, 'p1');
  assert.deepEqual([p.controla_estoque, p.ativo, p.estoque_atual, p.abaixo_do_minimo], [false, true, null, false], 'padrão: sem controle de estoque (PR-10), ativo');
  assert.deepEqual(det(recusa(api(s, 'produto.salvar', { campos: { nome: ' vacina x ', categoria: 'VACINA', unidade: 'dose' } }, 'p2'), 'VALIDATION')), [['NOME_REPETIDO', 'nome']]);
  assert.deepEqual(det(recusa(api(s, 'produto.salvar', { product_id: p.product_id, campos: { estoque_atual: 10 } }, 'p3'), 'VALIDATION')), [['CAMPO_NAO_EDITAVEL', 'estoque_atual']]);
  assert.deepEqual(det(recusa(api(s, 'produto.salvar', { product_id: p.product_id, campos: { categoria: 'XPTO', custo_unitario: -1 } }, 'p4'), 'VALIDATION')).map((x) => x[1]).sort(), ['categoria', 'custo_unitario']);
  recusa(api(s, 'produto.salvar', { product_id: S.id(0xdead), campos: { nome: 'x' } }, 'p5'), 'NOT_FOUND');
  // Sem controle: a compra não gera movimento; aplicação gera a saída (gravada nos dois casos).
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { product_id: p.product_id, qtd_apresentacao: 2, valor: 18000 }), 'e1'));
  assert.equal(tab(s, 'MOVIMENTOS_ESTOQUE').length, 0, 'o movimento de entrada só existe com controle (desenho-base 16.9)');
  const ids = ok(api(s, 'evento.registrar', S.entradaInicial([S.bicho({ brinco: '901' })]), 'reb')).animais.map((a) => a.animal_id);
  ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-03-10', produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1, quantidade_consumida_total: 30 }, animais: [{ animal_id: ids[0] }] }, 'v1'));
  assert.deepEqual(tab(s, 'MOVIMENTOS_ESTOQUE').map((m) => [m.tipo, m.quantidade]), [['SAIDA', 30]]);
  assert.equal(prod(s, p.product_id).estoque_atual, null);
  // A unidade é a da dose, do estoque e do custo: depois do uso, não muda.
  assert.deepEqual(det(recusa(api(s, 'produto.salvar', { product_id: p.product_id, campos: { unidade: 'mL' } }, 'p6'), 'VALIDATION')), [['PRODUTO_EM_USO', 'unidade']]);
  // Ligar o controle: o saldo é Σ dos movimentos vigentes (−30: só a saída); como começaria negativo, pede confirmação e
  // manda acertar pela contagem (revisão da Fase 3, achado 16); com a contagem, o acerto põe o saldo certo.
  const aviso = recusa(api(s, 'produto.salvar', { product_id: p.product_id, campos: { controla_estoque: true } }, 'p7'), 'NEEDS_CONFIRMATION');
  assert.deepEqual(aviso.details.map((d) => d.codigo), ['ESTOQUE_INSUFICIENTE']);
  const lig = ok(api(s, 'produto.salvar', { product_id: p.product_id, campos: { controla_estoque: true } }, 'p7', ['ESTOQUE_INSUFICIENTE']));
  assert.deepEqual([lig.estoque_atual, lig.abaixo_do_minimo], [-30, true]);
  ok(api(s, 'evento.registrar', estoque('AJUSTE', '2026-03-15', { product_id: p.product_id, motivo_ajuste: 'CONTAGEM', saldo_contado: 70 }), 'cont'));
  assert.deepEqual([prod(s, p.product_id).estoque_atual, tab(s, 'MOVIMENTOS_ESTOQUE', { tipo: 'AJUSTE' })[0].quantidade], [70, 100]);
  ok(api(s, 'produto.salvar', { product_id: p.product_id, campos: { controla_estoque: false } }, 'p8'));
  assert.equal(prod(s, p.product_id).estoque_atual, null, 'sem controle, sem saldo');
  semErro(s, 'produto');
  // Auditoria de cada mudança de cadastro.
  assert.ok(s.tabela('AUDITORIA').some((a) => a.entidade === 'PRODUTOS' && a.campo === 'controla_estoque' && a.valor_novo === 'N'));
});

test('03a, seção 4.7: entrada de 2 frascos de 50 doses (100, R$ 1,80), saída de 30 numa vacinação, acerto de −5 por frasco quebrado → saldo 65; consumo do período 30 doses = R$ 54,00, o CUSTEIO sem parcela da vacinação', () => {
  const s = S.sistema();
  const p = produto(s, { fator_conversao: 50, custo_unitario: 1.8, controla_estoque: true }, 'p');
  const e = ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { product_id: p.product_id, qtd_apresentacao: 2, valor: 18000, documento: 'NF 123', vencimento: '2026-03-31' }), 'ent'));
  const ev = s.tabela('EVENTOS').find((x) => x.event_id === e.event_id);
  assert.deepEqual([ev.event_subtype, ev.total_value, ev.payload_json], ['ENTRADA', 18000, { qtd_apresentacao: 2, fator_conversao: 50 }]);
  assert.deepEqual(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: e.event_id }).map((m) => [m.tipo, m.quantidade, m.custo_unitario]), [['ENTRADA', 100, 1.8]]);
  const fin = tab(s, 'FINANCEIRO', { event_id: e.event_id })[0];
  assert.deepEqual([fin.conta_id, fin.natureza, fin.valor, fin.quantidade, fin.product_id, fin.descricao, fin.documento, fin.status_pagamento], [conta(s, 'COMPRA_INSUMOS').conta_id, 'ESTOQUE_INSUMOS', 18000, 100, p.product_id, 'Compra de Vacina X: 100 doses', 'NF 123', 'ABERTO']);
  assert.deepEqual(tab(s, 'PARCELAS', { financial_id: fin.financial_id }).map((x) => [x.data_vencimento, x.valor]), [['2026-03-31', 18000]], 'caixa no pagamento');
  assert.equal(tab(s, 'RATEIOS', { financial_id: fin.financial_id }).length, 0, 'compra de insumo nunca é rateada aos animais (invariante 14)');
  const ids = ok(api(s, 'evento.registrar', S.entradaInicial(Array.from({ length: 30 }, (_, i) => S.bicho({ brinco: String(1000 + i) }))), 'reb')).animais.map((a) => a.animal_id);
  const v = ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-03-10', produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 }, animais: ids.map((animal_id) => ({ animal_id })) }, 'vac'));
  const perda = ok(api(s, 'evento.registrar', estoque('AJUSTE', '2026-03-20', { product_id: p.product_id, motivo_ajuste: 'PERDA', quantidade: 5, notes: 'Frasco quebrado' }), 'perda'));
  assert.deepEqual(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: perda.event_id }).map((m) => [m.tipo, m.quantidade, m.observacoes]), [['AJUSTE', -5, 'Frasco quebrado']]);
  assert.deepEqual([s.tabela('EVENTOS').find((x) => x.event_id === perda.event_id).total_value || null, tab(s, 'FINANCEIRO', { event_id: perda.event_id }).length], [null, 0], 'o acerto não é lançamento');
  assert.equal(prod(s, p.product_id).estoque_atual, 65, '100 − 30 − 5');
  const consumo = tab(s, 'FINANCEIRO', { event_id: v.event_id });
  assert.deepEqual(consumo.map((f) => [f.natureza, f.valor, f.quantidade, f.status_pagamento]), [['CUSTEIO', 5400, 30, 'SEM_CAIXA']], '30 × R$ 1,80 = R$ 54,00, sem parcela');
  // 07, seção 5, casos 1 e 2: caixa −90,00 (a entrada é de 100 doses aqui: −180,00), resultado −54,00, 65 doses em estoque, R$ 1,80 por animal.
  const al = tab(s, 'ALOCACOES_FINANCEIRAS', { financial_id: consumo[0].financial_id });
  assert.deepEqual([al.length, al.every((a) => a.valor_alocado === 180)], [30, true]);
  semErro(s, '4.7');
});

test('07, seção 5, caso 3: o frasco lançado direto na vacinação (sem estoque: produto sem custo no cadastro), pago no ato — caixa e resultado −90,00; R$ 3,00 por animal', () => {
  const s = S.sistema();
  const p = produto(s, { nome: 'Vacina Y' }, 'p');
  const ids = ok(api(s, 'evento.registrar', S.entradaInicial(Array.from({ length: 30 }, (_, i) => S.bicho({ brinco: String(2000 + i) }))), 'reb')).animais.map((a) => a.animal_id);
  const v = ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-03-10', produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1, quantidade_consumida_total: 50, custo_valor: 9000, custo_conta_id: conta(s, 'VACINAS').conta_id }, animais: ids.map((animal_id) => ({ animal_id })) }, 'vac'));
  const fins = tab(s, 'FINANCEIRO', { event_id: v.event_id });
  assert.deepEqual(fins.map((f) => [f.natureza, f.valor, f.product_id || null, f.status_pagamento]), [['CUSTEIO', 9000, null, 'ABERTO']], 'sem custo no cadastro o consumo não gera lançamento; o pago no ato tem parcela');
  assert.deepEqual(tab(s, 'PARCELAS', { financial_id: fins[0].financial_id }).map((x) => [x.data_vencimento, x.valor]), [['2026-03-10', 9000]], 'vencimento vazio = à vista');
  assert.ok(tab(s, 'SANIDADE', { event_id: v.event_id }).every((x) => x.custo === 300));
  assert.deepEqual(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: v.event_id }).map((m) => [m.tipo, m.quantidade, m.custo_unitario]), [['SAIDA', 50, null]]);
  semErro(s, 'caso 3');
});

test('regras da entrada e do acerto: embalagens sem quantidade por embalagem; embalagens × fator ≠ quantidade; quantidade ou valor faltando; acerto sem controle; contagem igual ao saldo; perda maior que o saldo (aviso); produto inexistente ou desativado; estoque não leva animais', () => {
  const s = S.sistema();
  const sem = produto(s, { nome: 'Sem fator', controla_estoque: true }, 'p1');
  const com = produto(s, { nome: 'Com fator', fator_conversao: 50, controla_estoque: true }, 'p2');
  const livre = produto(s, { nome: 'Sem controle' }, 'p3');
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { product_id: sem.product_id, qtd_apresentacao: 2, valor: 100 }), 'r1'), 'VALIDATION')), [['SEM_FATOR', 'qtd_apresentacao']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { product_id: com.product_id, qtd_apresentacao: 2, quantidade: 90, valor: 100 }), 'r2'), 'VALIDATION')), [['CONFLITO_DE_CAMPOS', 'quantidade']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { product_id: com.product_id, valor: 100 }), 'r3'), 'VALIDATION')), [['CAMPO_OBRIGATORIO', 'quantidade']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { product_id: com.product_id, quantidade: 10 }), 'r4'), 'VALIDATION')), [['CAMPO_OBRIGATORIO', 'valor']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { quantidade: 10, valor: 100 }), 'r5'), 'VALIDATION')), [['CAMPO_OBRIGATORIO', 'product_id']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { product_id: S.id(0xabc), quantidade: 10, valor: 100 }), 'r6'), 'VALIDATION')), [['NAO_ENCONTRADO', 'product_id']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', Object.assign(estoque('ENTRADA', '2026-03-01', { product_id: com.product_id, quantidade: 10, valor: 100 }), { animais: [{ animal_id: S.id(1) }] }), 'r7'), 'VALIDATION')), [['CAMPO_NAO_SE_APLICA', 'animais']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', estoque('AJUSTE', '2026-03-01', { product_id: livre.product_id, motivo_ajuste: 'PERDA', quantidade: 1 }), 'r8'), 'VALIDATION')), [['PRODUTO_SEM_ESTOQUE', 'product_id']]);
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { product_id: com.product_id, quantidade: 10, valor: 100, partner_id: null }), 'e1'));
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', estoque('AJUSTE', '2026-03-05', { product_id: com.product_id, motivo_ajuste: 'CONTAGEM', saldo_contado: 10 }), 'r9'), 'VALIDATION')), [['VALOR_IGUAL', 'saldo_contado']]);
  // Contagem retroativa: a diferença é contra o saldo NAQUELA data (antes da entrada de 01/03, zero).
  const cont = ok(api(s, 'evento.registrar', estoque('AJUSTE', '2026-02-20', { product_id: com.product_id, motivo_ajuste: 'CONTAGEM', saldo_contado: 3 }), 'cont-retro'));
  assert.deepEqual(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: cont.event_id }).map((m) => m.quantidade), [3]);
  assert.equal(prod(s, com.product_id).estoque_atual, 13);
  const av = recusa(api(s, 'evento.registrar', estoque('AJUSTE', '2026-03-05', { product_id: com.product_id, motivo_ajuste: 'VENCIMENTO', quantidade: 20 }), 'venc'), 'NEEDS_CONFIRMATION');
  assert.deepEqual(cods(av), ['ESTOQUE_INSUFICIENTE']);
  assert.match(av.details[0].mensagem, /^Com fator: o estoque ficaria em -7 doses em 05\/03\/2026/);
  ok(api(s, 'evento.registrar', estoque('AJUSTE', '2026-03-05', { product_id: com.product_id, motivo_ajuste: 'VENCIMENTO', quantidade: 20 }), 'venc', ['ESTOQUE_INSUFICIENTE']));
  ok(api(s, 'produto.salvar', { product_id: com.product_id, campos: { ativo: false } }, 'des'));
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-06', { product_id: com.product_id, quantidade: 10, valor: 100 }), 'r10'), 'VALIDATION')), [['PRODUTO_INATIVO', 'product_id']]);
  semErro(s, 'regras');
});

test('caminhos do estoque: correção da quantidade, do valor e do produto (o saldo dos dois), correção do substituto, estorno da correção; estorno da entrada com saída posterior pede confirmação (saldo negativo) e, aceito, o saldo fica negativo; a política BLOQUEIA recusa', () => {
  const s = S.sistema();
  const a = produto(s, { nome: 'A', custo_unitario: 1, controla_estoque: true }, 'pa');
  const b = produto(s, { nome: 'B', custo_unitario: 1, controla_estoque: true }, 'pb');
  const e = ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { product_id: a.product_id, quantidade: 10, valor: 1000 }), 'e'));
  const c1 = ok(api(s, 'evento.corrigir', Object.assign(estoque('ENTRADA', '2026-03-01', { product_id: b.product_id, quantidade: 12, valor: 1200, vencimento: '2026-04-01' }), { event_id: e.event_id, justificativa: 'Era o produto B' }), 'c1'));
  assert.deepEqual([prod(s, a.product_id).estoque_atual, prod(s, b.product_id).estoque_atual], [0, 12]);
  assert.deepEqual(c1.produtos.map((p) => [p.nome, p.estoque_atual]).sort(), [['A', 0], ['B', 12]]);
  const c2 = ok(api(s, 'evento.corrigir', Object.assign(estoque('ENTRADA', '2026-03-01', { product_id: b.product_id, quantidade: 15, valor: 1500 }), { event_id: c1.event_id, justificativa: 'Eram 15' }), 'c2'));
  assert.equal(prod(s, b.product_id).estoque_atual, 15);
  assert.deepEqual(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: c2.event_id }).map((m) => [m.quantidade, m.custo_unitario]), [[15, 1]]);
  // Uma saída posterior: estornar a entrada deixaria o saldo negativo → confirmação (o aviso não é dependente).
  const ids = ok(api(s, 'evento.registrar', S.entradaInicial([S.bicho({ brinco: '930' })]), 'reb')).animais.map((x) => x.animal_id);
  ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-03-10', produto_id: b.product_id, modo_dose: 'POR_CABECA', dose_referencia: 4 }, animais: [{ animal_id: ids[0] }] }, 'vac'));
  assert.equal(prod(s, b.product_id).estoque_atual, 11);
  const sim = ok(api(s, 'evento.simular', { acao: 'estornar', dados: { event_id: c2.event_id, justificativa: 'Não chegou' } }));
  assert.deepEqual([sim.avisos.map((x) => x.codigo), sim.impactos.corrige.event_id], [['ESTOQUE_INSUFICIENTE'], c1.event_id]);
  ok(api(s, 'config.salvar', { valores: { avisos_politica: { ESTOQUE_INSUFICIENTE: 'BLOQUEIA' } } }, 'pol'));
  assert.deepEqual(cods(recusa(api(s, 'evento.estornar', { event_id: c2.event_id, justificativa: 'Não chegou' }, 'est-bl'), 'VALIDATION')), ['ESTOQUE_INSUFICIENTE']);
  ok(api(s, 'config.salvar', { valores: { avisos_politica: {} } }, 'pol2'));
  ok(api(s, 'evento.estornar', { event_id: c2.event_id, justificativa: 'Não chegou' }, 'est', ['ESTOQUE_INSUFICIENTE']));
  assert.deepEqual([prod(s, a.product_id).estoque_atual, prod(s, b.product_id).estoque_atual], [0, -4], 'o estorno da correção some com a entrada (o original não volta)');
  assert.ok(tab(s, 'FINANCEIRO', { event_id: c2.event_id }).every((f) => f.status === 'CANCELADO' && f.status_pagamento === 'CANCELADO'));
  semErro(s, 'caminhos');
});

test('integridade do estoque (COPIAS, PROJECAO): entrada sem o lançamento de compra, movimento com custo ou quantidade fora da compra, acerto de perda que aumenta o saldo, movimento num lançamento de outro tipo; o saldo projetado = Σ dos movimentos', () => {
  const s = S.sistema();
  const p = produto(s, { nome: 'P', controla_estoque: true }, 'p');
  const e = ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { product_id: p.product_id, quantidade: 10, valor: 1000 }), 'e'));
  const aj = ok(api(s, 'evento.registrar', estoque('AJUSTE', '2026-03-02', { product_id: p.product_id, motivo_ajuste: 'PERDA', quantidade: 2 }), 'aj'));
  semErro(s, 'antes');
  const mov = tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: e.event_id })[0];
  const mAj = tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: aj.event_id })[0];
  const fin = tab(s, 'FINANCEIRO', { event_id: e.event_id })[0];
  const casos = [
    ['MOVIMENTOS_ESTOQUE', mov.mov_id, 'custo_unitario', 2, /o movimento de entrada não confere com a compra/],
    ['MOVIMENTOS_ESTOQUE', mov.mov_id, 'quantidade', 11, /o movimento de entrada não confere com a compra/],
    ['MOVIMENTOS_ESTOQUE', mAj.mov_id, 'quantidade', 2, /a perda ou o vencimento aumenta o estoque/],
    ['MOVIMENTOS_ESTOQUE', mov.mov_id, 'tipo', 'SAIDA', /MOVIMENTOS_ESTOQUE: o tipo SAIDA não corresponde/],
    ['FINANCEIRO', fin.financial_id, 'product_id', '', /a entrada de insumo precisa de um lançamento de compra de insumos com o produto e a quantidade/],
    ['MOVIMENTOS_ESTOQUE', mov.mov_id, 'data', '2026-03-05', /MOVIMENTOS_ESTOQUE: a data 05\/03\/2026 difere da data do evento/],
  ];
  for (const [aba, idReg, col, valor, msg] of casos) {
    const bruto = s.tabela(aba).find((x) => x[s.G.Schema.pk(aba)] === idReg)[col];
    s.editar(aba, idReg, col, valor);
    const rel = s.integridade();
    assert.ok(rel.achados.some((x) => x.checagem === 'COPIAS' && msg.test(x.mensagem)), aba + '.' + col + ': ' + JSON.stringify(rel.achados.slice(0, 4)));
    s.editar(aba, idReg, col, bruto === null ? '' : bruto);
  }
  semErro(s, 'desfeito');
  // A quantidade do movimento mexida também muda o saldo calculado (PROJECAO acusa o gravado).
  s.editar('MOVIMENTOS_ESTOQUE', mAj.mov_id, 'quantidade', -3);
  const rel = s.integridade();
  assert.ok(rel.achados.some((x) => x.checagem === 'PROJECAO' && x.tabela === 'PRODUTOS' && /estoque_atual gravado 8, calculado 7/.test(x.mensagem)), JSON.stringify(rel.achados.slice(0, 5)));
});
