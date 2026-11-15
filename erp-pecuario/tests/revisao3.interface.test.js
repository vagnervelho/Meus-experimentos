'use strict';
/**
 * Revisão independente da Fase 2, rodada 3, lente INTERFACE E REGRAS (a parte que roda no Node, com os scripts do
 * cliente da página montada pelo doGet real e o servidor real do harness): a correção pela tela com item de lista e
 * parceiro desativados depois de usados (o formulário aceita o valor do original e o mostra pelo nome; quem decide é o
 * servidor) e o texto da confirmação do desfazer da importação, por tipo. Os fluxos em navegador estão em
 * tests/ui/revisao3.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');
const { api, cliente, storeDe } = require('./apoio-telas');

const { js } = S;
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------- achado 13 (MÉDIA, correção incompleta) ----
test('R3 achado 13: na correção pela tela, o item de lista e o parceiro desativados depois de usados são aceitos e aparecem pelo nome, com a marca de desativado', () => {
  const s = S.sistema();
  const sem = api(s, { rota: 'evento.registrar', idempotencyKey: 'sem', dados: S.entradaInicial([S.bicho({ brinco: '0201', sexo: 'M', castrado: true, reprodutor: false, data_nascimento: '2023-05-01', data_nascimento_confianca: 'ESTIMADA' })]) });
  const boi = sem.data.animais[0].animal_id;
  const comp = api(s, { rota: 'parceiro.salvar', idempotencyKey: 'pc', dados: { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } } }).data.partner_id;
  const venda = api(s, { rota: 'evento.registrar', idempotencyKey: 'venda', dados: { tipo: 'VENDA', campos: { event_date: '2026-08-10', partner_id: comp, finalidade: 'ABATE', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 },
    animais: [{ animal_id: boi }], parcelas: [{ data_vencimento: '2026-09-10', forma_pagamento: 'BOLETO' }], deducoes: [{ tipo: 'SENAR', valor: 600 }] } });
  assert.equal(venda.ok, true, JSON.stringify(venda.error));
  const item = (lista, codigo) => s.tabela('LISTAS').find((l) => l.lista === lista && l.codigo === codigo);
  ['TIPO_DEDUCAO_VENDA:SENAR', 'FORMA_PAGAMENTO:BOLETO'].forEach((k, i) => {
    const [lista, codigo] = k.split(':');
    const r = api(s, { rota: 'lista.salvar', idempotencyKey: 'lst-' + i, dados: { lista_id: item(lista, codigo).lista_id, ativo: false } });
    assert.equal(r.ok, true, JSON.stringify(r.error));
  });
  const p = api(s, { rota: 'parceiro.salvar', idempotencyKey: 'pc-off', dados: { partner_id: comp, campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'], ativo: false } } });
  assert.equal(p.ok, true, JSON.stringify(p.error));
  const c = cliente(s);
  const st = storeDe(s);
  c.Store = st;
  const previa = js(c.TelaEventos.previaCorrecao(api(s, { rota: 'evento.obter', dados: { event_id: venda.data.event_id } }).data));
  const t = st.tipoEvento('VENDA');
  const defDed = t.grupos_repetiveis.deducoes.find((d) => d.id === 'tipo');
  const defForma = t.grupos_repetiveis.parcelas.find((d) => d.id === 'forma_pagamento');
  // A opção do valor do original vem com o rótulo de verdade e a marca; a conversão aceita (o servidor decide).
  assert.ok(js(c.Campos.opcoesDe(defDed, 'SENAR')).some((o) => o.valor === 'SENAR' && /— desativado$/.test(o.rotulo) && !/^SENAR/.test(o.rotulo)), JSON.stringify(js(c.Campos.opcoesDe(defDed, 'SENAR'))));
  assert.equal(js(c.Campos.opcoesDe(defDed)).some((o) => o.valor === 'SENAR'), false, 'sem o valor atual, o desativado não é oferecido');
  assert.deepEqual(js(c.Campos.converter(defDed, 'SENAR')), { valor: 'SENAR' });
  assert.deepEqual(js(c.Campos.converter(defForma, 'BOLETO')), { valor: 'BOLETO' });
  const grupos = {};
  Object.keys(previa.grupos).forEach((g) => { grupos[g] = previa.grupos[g].map((x, i) => ({ uid: g + i, valores: clone(x.valores) })); });
  const sess = { tipo: 'VENDA', def: t, subtipo: null, campos: clone(previa.campos), grupos, justificativaAviso: '', corrige: clone(previa.corrige), justificativaCorrecao: 'Preço',
    linhas: previa.linhas.map((l, i) => ({ uid: 'l' + i, animal_id: l.animal_id, valores: clone(l.valores), erros: [] })) };
  sess.campos.preco_unitario = '3100,00';
  sess.campos.valor_bruto = '3100,00';
  const m = js(c.Registro.montarDados(sess));
  assert.deepEqual(m.erros, [], 'o formulário não recusa o que o servidor aceita');
  const r = api(s, { rota: 'evento.corrigir', idempotencyKey: 'corr', dados: m.dados });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  s.conferirProjecoes('correção');
  assert.deepEqual(js(c.Registro.diferencas(sess)).length, 2);
});

// ---------------------------------------------------------------- achado 16 (MÉDIA) ----
test('R3 achado 16: a confirmação do desfazer diz o que acontece pelo tipo da importação (lançamentos × animais; em curso, nada valeu)', () => {
  const s = S.sistema();
  const c = cliente(s);
  const T = c.TelaImportacao;
  assert.match(T.consequenciaDesfazer({ tipo: 'ANIMAIS', status: 'IMPORTADO' }), /^Os animais desta importação deixam de valer/);
  const tr = T.consequenciaDesfazer({ tipo: 'TRANSFERENCIAS', status: 'IMPORTADO', eventos: 1, animais: 0 });
  assert.match(tr, /^O lançamento desta importação deixa de valer \(nada é apagado; fica registrado\)\. Os animais que eles só movimentaram voltam/);
  assert.doesNotMatch(tr, /animais desta importação deixam de valer/);
  assert.match(T.consequenciaDesfazer({ tipo: 'COMPRAS', status: 'IMPORTADO', eventos: 3, animais: 12 }), /^Os 3 lançamentos desta importação deixam de valer; os 12 animais que ela cadastrou são anulados/);
  assert.match(T.consequenciaDesfazer({ tipo: 'VENDAS', status: 'IMPORTANDO' }), /^Nada desta importação chegou a valer/);
});
