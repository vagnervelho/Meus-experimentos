'use strict';
/**
 * O contrato da correção (CONTRATOS, seção 50) nos casos que o oráculo do teste aleatório não sorteia: a correção que muda a
 * entrada de que um valor congelado depende (b2). Com outra data, o derivado do estado do dia é refeito na posição nova; com
 * outro produto, as cópias são as do cadastro de hoje do produto novo (a exceção documentada), e os campos que a tela preenche
 * pelo produto ficam como foram informados. Tudo pela correção só com a mudança (`dados.mudanca`, Correcao.montar).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js } = S;
const TODOS = ['PESO_IMPLAUSIVEL', 'POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'ESTOQUE_INSUFICIENTE', 'PRODUTO_VENCIDO', 'CARENCIA_ATIVA', 'IDADE_REPRODUTIVA', 'CATEGORIAS_SEM_COBERTURA', 'RATEIO_SEM_PESO', 'VALOR_DIVERGENTE', 'INTERVALO_PARTO_CURTO', 'BRINCO_PARECIDO'];

function api(s, rota, dados) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: 'k-' + Math.random(), avisosAceitos: TODOS })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + String(JSON.stringify(r.error)).slice(0, 1500));
  return r.data;
}
const hoje = (s, iso) => { s.gas.clock.now = Date.parse(iso + 'T15:00:00.000Z'); };
const tab = (s, aba, filtro) => s.tabela(aba).filter((r) => Object.keys(filtro || {}).every((k) => r[k] === filtro[k]));
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}
function rebanho(s, bichos) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(bichos)), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}

test('com outra data, o valor de antes da reclassificação é o da posição nova (a correção da data refaz o derivado do estado do dia; sem mudar a data, ele fica o do original)', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const ids = rebanho(s, [S.bicho({ brinco: '100', sexo: 'M', castrado: true, data_nascimento: '2023-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-06-01');
  const cats = tab(s, 'CATEGORIAS').filter((c) => c.ativo !== false && (c.sexo_aplicavel === 'M' || c.sexo_aplicavel === 'AMBOS'));
  assert.ok(cats.length >= 2, 'duas categorias de macho');
  const recl = (data, cat) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'RECLASSIFICACAO', campos: { event_date: data, justificativa: 'Escolha do dono' }, animais: [{ animal_id: ids['100'], categoria_manual_id: cat }] });
  ok(api(s, 'evento.registrar', recl('2026-03-01', cats[0].category_id)), 'primeira reclassificação');
  const r2 = ok(api(s, 'evento.registrar', recl('2026-05-01', cats[1].category_id)), 'segunda reclassificação');
  const ajuste = (eid) => tab(s, 'AJUSTES', { event_id: eid }).map((a) => [a.valor_anterior, a.valor_novo]);
  assert.deepEqual(ajuste(r2.event_id), [[cats[0].category_id, cats[1].category_id]]);
  const nota = ok(api(s, 'evento.corrigir', { event_id: r2.event_id, justificativa: 'Anotação', mudanca: { campos: { notes: 'Conferido' } } }), 'só a anotação');
  assert.deepEqual(ajuste(nota.event_id), [[cats[0].category_id, cats[1].category_id]], 'a anotação não muda o valor de antes');
  const antes = ok(api(s, 'evento.corrigir', { event_id: nota.event_id, justificativa: 'Data certa', mudanca: { campos: { event_date: '2026-02-01' } } }), 'para antes da primeira');
  assert.deepEqual(ajuste(antes.event_id), [[null, cats[1].category_id]], 'antes da primeira reclassificação, a categoria era a automática');
  semErro(s, 'reclassificação');
});

test('com outro produto, a aplicação copia o cadastro de hoje do produto novo (nome, fabricante, custo, conta e nome da categoria no consumo); a carência informada fica a que estava', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const ids = rebanho(s, [S.bicho({ brinco: '100', sexo: 'M', castrado: true, data_nascimento: '2023-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-06-01');
  const p1 = ok(api(s, 'produto.salvar', { campos: { nome: 'Vacina A', categoria: 'VACINA', unidade: 'dose', custo_unitario: 2.5, fabricante: 'Lab A', carencia_padrao_dias: 21 } }), 'produto 1');
  const p2 = ok(api(s, 'produto.salvar', { campos: { nome: 'Vermífugo B', categoria: 'VERMIFUGO', unidade: 'ml', custo_unitario: 4, fabricante: 'Lab B', carencia_padrao_dias: 35 } }), 'produto 2');
  const v = ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-03-01', produto_id: p1.product_id, modo_dose: 'POR_CABECA', dose_referencia: 2, periodo_carencia_dias: 21 }, animais: [{ animal_id: ids['100'] }] }), 'aplicação');
  // O cadastro do produto 1 muda depois: a correção que troca de produto não o usa; a que não troca usa o do original.
  ok(api(s, 'produto.salvar', { product_id: p1.product_id, campos: { nome: 'Vacina A (revista)', custo_unitario: 9 }, justificativa: 'Cadastro revisto' }), 'produto 1 revisto');
  const fatos = (eid) => ({
    san: tab(s, 'SANIDADE', { event_id: eid }).map((x) => [x.produto_id, x.nome_produto, x.fabricante, x.periodo_carencia_dias, x.dose]),
    mov: tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: eid }).map((x) => [x.product_id, x.quantidade, x.custo_unitario]),
    fin: tab(s, 'FINANCEIRO', { event_id: eid }).map((x) => [x.product_id, x.descricao, x.valor]),
  });
  const nota = ok(api(s, 'evento.corrigir', { event_id: v.event_id, justificativa: 'Anotação', mudanca: { campos: { notes: 'Conferido' } } }), 'só a anotação');
  assert.deepEqual(fatos(nota.event_id), fatos(v.event_id), 'sem trocar o produto, as cópias são as do original');
  const troca = ok(api(s, 'evento.corrigir', { event_id: nota.event_id, justificativa: 'Era o vermífugo', mudanca: { campos: { produto_id: p2.product_id } } }), 'outro produto');
  const f = fatos(troca.event_id);
  assert.deepEqual(f.san, [[p2.product_id, 'Vermífugo B', 'Lab B', 21, 2]], 'o nome e o fabricante do produto novo; a carência informada fica');
  assert.deepEqual(f.mov, [[p2.product_id, 2, 4]], 'o custo do produto novo');
  assert.equal(f.fin.length, 1);
  assert.equal(f.fin[0][0], p2.product_id);
  assert.match(f.fin[0][1], /^Consumo de vermífugo: /);
  assert.equal(f.fin[0][2], 800);
  semErro(s, 'outro produto');
});
