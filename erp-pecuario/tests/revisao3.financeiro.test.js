'use strict';
/**
 * Revisão independente da Fase 2, rodada 3, lentes FINANCEIRO e INTERFACE E REGRAS (a parte que roda no Node): a
 * prévia da correção pela tela, montada como o formulário monta (Registro.montarDados), é aceita pelo servidor,
 * reproduz o original sem mudança e, com a mudança pedida, deixa os padrões do servidor (descrição proposta, vencimento
 * "à vista", parcela única, parceiro e vencimento da dedução retida) acompanharem o que mudou; e a verificação de
 * integridade com a base do rateio recalculada em todo critério de escopo EVENTO. Projeção = reconstrução depois de cada
 * comando.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');
const { api, cliente, storeDe } = require('./apoio-telas');

const { js, PASTOS } = S;
const clone = (v) => JSON.parse(JSON.stringify(v));

function montar() {
  const s = S.sistema();
  const sem = api(s, { rota: 'evento.registrar', idempotencyKey: 'sem', dados: S.entradaInicial([
    S.bicho({ brinco: '0201', sexo: 'M', castrado: true, reprodutor: false, data_nascimento: '2023-05-01', data_nascimento_confianca: 'ESTIMADA' }),
    S.bicho({ brinco: '0202', sexo: 'M', castrado: true, reprodutor: false, data_nascimento: '2023-05-01', data_nascimento_confianca: 'ESTIMADA' }),
    S.bicho({ brinco: '0203', data_nascimento: '2020-05-01', data_nascimento_confianca: 'ESTIMADA' }),
  ]) });
  assert.equal(sem.ok, true, JSON.stringify(sem.error));
  const id = (b) => sem.data.animais.find((x) => x.brinco === b).animal_id;
  const parceiro = (nome, tipos) => api(s, { rota: 'parceiro.salvar', idempotencyKey: 'p-' + nome, dados: { campos: { nome, tipos } } }).data.partner_id;
  return { s, id, parceiro };
}
function registrar(s, dados, chave) {
  const r = api(s, { rota: 'evento.registrar', idempotencyKey: chave, dados });
  assert.equal(r.ok, true, chave + ': ' + JSON.stringify(r.error));
  s.conferirProjecoes(chave);
  return r.data;
}
/** A sessão do formulário (como Registro.abrir monta) a partir da prévia da correção, com os grupos. */
function sessaoDaPrevia(c, s, eventId) {
  const st = storeDe(s);
  c.Store = st;
  const previa = js(c.TelaEventos.previaCorrecao(api(s, { rota: 'evento.obter', dados: { event_id: eventId } }).data));
  const tipo = s.tabela('EVENTOS').find((e) => e.event_id === eventId).event_type;
  const grupos = {};
  Object.keys(previa.grupos || {}).forEach((g) => { grupos[g] = previa.grupos[g].map((x, i) => ({ uid: g + i, valores: clone(x.valores) })); });
  return {
    previa,
    sess: {
      tipo, def: st.tipoEvento(tipo), subtipo: previa.subtipo || null, campos: clone(previa.campos || {}), grupos, justificativaAviso: '',
      linhas: (previa.linhas || []).map((l, i) => ({ uid: 'l' + i, animal_id: l.animal_id || null, criado: !!l.criado, valores: clone(l.valores || {}), erros: [] })),
      corrige: clone(previa.corrige), justificativaCorrecao: 'Conferência',
    },
  };
}
/** Monta como o formulário, confere sem erro de formulário, simula e grava a correção; devolve o substituto. */
function corrigirPelaTela(c, s, sess, chave) {
  const m = js(c.Registro.montarDados(sess));
  assert.deepEqual(m.erros, [], chave + ': ' + JSON.stringify(m.erros));
  const sim = api(s, { rota: 'evento.simular', dados: { acao: 'corrigir', dados: m.dados } });
  assert.equal(sim.ok, true, chave + ': ' + JSON.stringify(sim.error));
  const r = api(s, { rota: 'evento.corrigir', idempotencyKey: chave, dados: m.dados });
  assert.equal(r.ok, true, chave + ': ' + JSON.stringify(r.error));
  s.conferirProjecoes(chave);
  return r.data;
}
const lancamentos = (s, evId) => s.tabela('FINANCEIRO').filter((f) => f.event_id === evId);
const titulos = (s, fin) => s.tabela('PARCELAS').filter((p) => p.financial_id === fin.financial_id).sort((a, b) => a.parcela_num - b.parcela_num);
const erros = (s) => (s.integridade().achados || []).filter((x) => x.severidade === 'ERRO').map((x) => [x.checagem, x.mensagem]);

// ---------------------------------------------------------------- achado 9 (MÉDIA) ----
test('R3 achado 9: correção pela tela de compra e venda de um animal só (critério gravado DIRETO) é aceita e reproduz o original', () => {
  const { s, id, parceiro } = montar();
  const c = cliente(s);
  const forn = parceiro('Leilão', ['FORNECEDOR']);
  const comp = parceiro('Frigorífico', ['COMPRADOR']);
  // (a) compra por cabeça de 1 touro com o valor na grade, sem preço por cabeça.
  const compra = registrar(s, { tipo: 'COMPRA', campos: { event_date: '2026-03-10', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', valor_animais: 1250000 },
    animais: [{ brinco: '0900', sexo: 'M', castrado: false, reprodutor: true, idade_meses: 30, valor_individual: 1250000 }], parcelas: [{ data_vencimento: '2026-04-10' }] }, 'compra');
  assert.equal(s.tabela('COMPRAS')[0].criterio_rateio, 'DIRETO');
  let x = sessaoDaPrevia(c, s, compra.event_id);
  assert.equal(x.previa.linhas[0].valores.valor_individual, '12500,00', 'o valor do animal vem da linha');
  assert.deepEqual(js(c.Registro.diferencas(x.sess)), []);
  const k1 = corrigirPelaTela(c, s, x.sess, 'corr-compra');
  assert.deepEqual(lancamentos(s, k1.event_id).map((f) => f.valor), [1250000]);
  // (b) venda por cabeça de 1 animal com o valor dele.
  const venda = registrar(s, { tipo: 'VENDA', campos: { event_date: '2026-06-10', partner_id: comp, finalidade: 'ABATE', modalidade: 'CABECA', valor_bruto: 450000 },
    animais: [{ animal_id: id('0201'), valor_individual: 450000 }], parcelas: [{ data_vencimento: '2026-07-10' }] }, 'venda');
  x = sessaoDaPrevia(c, s, venda.event_id);
  assert.equal(x.previa.linhas[0].valores.valor_individual, '4500,00');
  const k2 = corrigirPelaTela(c, s, x.sess, 'corr-venda');
  assert.deepEqual(lancamentos(s, k2.event_id).map((f) => f.valor), [450000]);
  // (c) venda em lote de 1 animal com o critério "cabeças": a prévia propõe um critério da lista.
  const lote = registrar(s, { tipo: 'VENDA', campos: { event_date: '2026-06-12', partner_id: comp, finalidade: 'ABATE', modalidade: 'LOTE', criterio_rateio: 'CABECAS', valor_bruto: 380000 },
    animais: [{ animal_id: id('0202') }], parcelas: [{ data_vencimento: '2026-07-12' }] }, 'lote');
  assert.equal(s.tabela('VENDAS').find((v) => v.event_id === lote.event_id).criterio_rateio, 'DIRETO');
  x = sessaoDaPrevia(c, s, lote.event_id);
  assert.equal(x.previa.campos.criterio_rateio, 'CABECAS');
  const k3 = corrigirPelaTela(c, s, x.sess, 'corr-lote');
  assert.equal(s.tabela('VENDAS').find((v) => v.event_id === k3.event_id).criterio_rateio, 'DIRETO');
  assert.deepEqual(erros(s), []);
});

// ---------------------------------------------------------------- achados 10, 14 e 21 (MÉDIA, MÉDIA, BAIXA) ----
test('R3 achados 10, 14 e 21: na correção da compra pela tela, a descrição proposta e o vencimento à vista acompanham a data e o tipo; a parcela única acompanha o valor', () => {
  const { s, parceiro } = montar();
  const c = cliente(s);
  const forn = parceiro('Leilão', ['FORNECEDOR']);
  const compra = registrar(s, { tipo: 'COMPRA', campos: { event_date: '2026-03-10', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 600000 },
    animais: ['0301', '0302'].map((b) => ({ brinco: b, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 })), parcelas: [{ data_vencimento: '2026-04-10' }],
    custos: [{ tipo: 'FRETE', valor: 20000 }, { tipo: 'OUTRO', valor: 5000 }] }, 'compra');
  const x = sessaoDaPrevia(c, s, compra.event_id);
  assert.deepEqual(x.previa.grupos.custos.map((g) => [g.valores.tipo, g.valores.descricao, g.valores.data_vencimento]), [['FRETE', undefined, undefined], ['OUTRO', undefined, undefined]]);
  assert.equal(x.previa.grupos.parcelas[0].valores.valor, undefined, 'parcela única sem valor');
  x.sess.campos.event_date = '2026-03-12';
  x.sess.grupos.custos[0].valores.tipo = 'OUTRO';
  x.sess.campos.preco_unitario = '3100,00';
  x.sess.campos.valor_animais = '6200,00';
  assert.equal(js(c.Registro.diferencas(x.sess)).length, 4, JSON.stringify(js(c.Registro.diferencas(x.sess))));
  const k = corrigirPelaTela(c, s, x.sess, 'corr-compra');
  const fs = lancamentos(s, k.event_id);
  assert.deepEqual(fs.map((f) => [f.valor, f.descricao, titulos(s, f)[0].data_vencimento]), [
    [620000, fs[0].descricao, '2026-04-10'],
    [20000, 'Outros custos da compra de 12/03/2026', '2026-03-12'],
    [5000, 'Outros custos da compra de 12/03/2026', '2026-03-12'],
  ]);
  assert.deepEqual(titulos(s, fs[0]).map((p) => p.valor), [620000], 'a parcela única acompanhou o novo valor');
  assert.deepEqual(erros(s), []);
});

test('R3 achados 10 e 14: na correção da morte e do descarte pela tela, a descrição proposta e o vencimento à vista acompanham a data', () => {
  const { s, id } = montar();
  const c = cliente(s);
  const contas = storeDe(s).b.contas || [];
  const custeio = (contas.find((x) => x.natureza === 'CUSTEIO' && x.ativo !== false) || {}).conta_id;
  assert.ok(custeio, 'conta de custeio');
  const morte = registrar(s, { tipo: 'MORTE', campos: { event_date: '2026-05-10', causa: 'DOENCA', custo_valor: 30000, custo_conta_id: custeio }, animais: [{ animal_id: id('0201') }] }, 'morte');
  let x = sessaoDaPrevia(c, s, morte.event_id);
  assert.deepEqual([x.sess.campos.custo_descricao, x.sess.campos.custo_vencimento], [undefined, undefined]);
  x.sess.campos.event_date = '2026-05-08';
  const km = corrigirPelaTela(c, s, x.sess, 'corr-morte');
  let f = lancamentos(s, km.event_id)[0];
  assert.deepEqual([f.descricao, titulos(s, f)[0].data_vencimento], ['Custos da morte de 08/05/2026', '2026-05-08']);
  const desc = registrar(s, { tipo: 'DESCARTE', campos: { event_date: '2026-06-01', destino: 'DOACAO', motivo: 'IDADE', receita_valor: 50000 }, animais: [{ animal_id: id('0203') }] }, 'descarte');
  x = sessaoDaPrevia(c, s, desc.event_id);
  x.sess.campos.event_date = '2026-06-03';
  const kd = corrigirPelaTela(c, s, x.sess, 'corr-descarte');
  f = lancamentos(s, kd.event_id)[0];
  assert.deepEqual([f.descricao, titulos(s, f)[0].data_vencimento], ['Receita do descarte de 03/06/2026', '2026-06-03']);
  assert.deepEqual(erros(s), []);
});

// ---------------------------------------------------------------- achado 6 (ALTA) ----
test('R3 achado 6: corrigir pela tela só o comprador leva a dedução descontada pelo comprador junto; corrigir só o vencimento do recebimento é aceito', () => {
  const { s, id, parceiro } = montar();
  const c = cliente(s);
  const A = parceiro('Frigorífico A', ['COMPRADOR']);
  const B = parceiro('Frigorífico B', ['COMPRADOR']);
  const venda = registrar(s, { tipo: 'VENDA', campos: { event_date: '2026-08-10', partner_id: A, finalidade: 'ABATE', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 },
    animais: [{ animal_id: id('0201') }], parcelas: [{ data_vencimento: '2026-09-10' }],
    deducoes: [{ tipo: 'FUNRURAL', valor: 4500, retida_pelo_comprador: true }, { tipo: 'FRETE', valor: 10000 }] }, 'venda');
  let x = sessaoDaPrevia(c, s, venda.event_id);
  assert.deepEqual(x.previa.grupos.deducoes.map((g) => [g.valores.partner_id, g.valores.data_vencimento]), [[undefined, undefined], [undefined, undefined]], 'os padrões do servidor não viram valor digitado');
  x.sess.campos.partner_id = B;
  assert.equal(js(c.Registro.diferencas(x.sess)).length, 1);
  const k1 = corrigirPelaTela(c, s, x.sess, 'corr-comprador');
  const fs1 = lancamentos(s, k1.event_id);
  assert.deepEqual(fs1.map((f) => [f.tipo, f.retida_pelo_comprador, f.partner_id]), [['RECEITA', false, B], ['DESPESA', true, B], ['DESPESA', false, null]]);
  // Só o vencimento do recebimento: a retida vai junto para o novo vencimento.
  x = sessaoDaPrevia(c, s, k1.event_id);
  x.sess.grupos.parcelas[0].valores.data_vencimento = '2026-09-20';
  const k2 = corrigirPelaTela(c, s, x.sess, 'corr-vencimento');
  const fs2 = lancamentos(s, k2.event_id);
  assert.deepEqual(fs2.map((f) => titulos(s, f)[0].data_vencimento), ['2026-09-20', '2026-09-20', '2026-08-10']);
  assert.deepEqual(erros(s), []);
});

// ---------------------------------------------------------------- achado 22 (BAIXA) ----
test('R3 achado 22: a base do rateio por peso vivo, por carcaça e por cabeças é recalculada pela linha do evento (alerta quando não bate)', () => {
  const { s, parceiro } = montar();
  const forn = parceiro('Forn', ['FORNECEDOR']);
  const g = (b, x) => Object.assign({ brinco: b, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 }, x || {});
  const c1 = registrar(s, { tipo: 'COMPRA', campos: { event_date: '2026-02-01', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'KG_VIVO', preco_unitario: 1500, valor_animais: 945000 },
    animais: [g('301', { peso: 210 }), g('302', { peso: 199.5 }), g('303', { peso: 220.5 })], parcelas: [{ data_vencimento: '2026-03-01' }] }, 'c1');
  const c2 = registrar(s, { tipo: 'COMPRA', campos: { event_date: '2026-02-02', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'LOTE', criterio_rateio: 'CABECAS', valor_animais: 600000 },
    animais: [g('401'), g('402')], parcelas: [{ data_vencimento: '2026-03-02' }] }, 'c2');
  const base = (r) => r.checagens.find((x) => x.codigo === 'BASE_RATEIO');
  assert.equal(base(s.integridade()).situacao, 'OK');
  const ea1 = s.tabela('EVENTO_ANIMAIS').filter((l) => l.event_id === c1.event_id);
  const pes = s.tabela('PESAGENS').filter((l) => l.event_id === c1.event_id && l.animal_id === ea1[0].animal_id);
  s.editar('EVENTO_ANIMAIS', ea1[0].event_animal_id, 'peso', 410);
  s.editar('PESAGENS', pes[0].weight_id, 'peso_kg', 410);
  let r = s.integridade();
  assert.equal(base(r).situacao, 'ALERTA');
  assert.ok(r.achados.some((a) => a.checagem === 'BASE_RATEIO' && /\(210\) difere da recalculada hoje pela linha do evento \(410, critério PESO_VIVO\)/.test(a.mensagem)), JSON.stringify(r.achados.filter((a) => a.checagem === 'BASE_RATEIO')));
  // Por cabeças: a base de cada animal é 1.
  const al = s.tabela('ALOCACOES_FINANCEIRAS').find((a) => s.tabela('RATEIOS').some((x) => x.rateio_id === a.rateio_id && x.event_id === c2.event_id));
  s.editar('ALOCACOES_FINANCEIRAS', al.alloc_id, 'base_valor', 2);
  r = s.integridade();
  assert.ok(r.achados.some((a) => a.checagem === 'BASE_RATEIO' && /critério CABECAS/.test(a.mensagem)));
});

test('R3 achado 6 (integridade): a dedução descontada pelo comprador com vencimento fora dos recebimentos da venda é acusada', () => {
  const { s, id, parceiro } = montar();
  const A = parceiro('Frigorífico A', ['COMPRADOR']);
  const venda = registrar(s, { tipo: 'VENDA', campos: { event_date: '2026-08-10', partner_id: A, finalidade: 'ABATE', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 },
    animais: [{ animal_id: id('0201') }], parcelas: [{ data_vencimento: '2026-09-10' }], deducoes: [{ tipo: 'FUNRURAL', valor: 4500, retida_pelo_comprador: true }] }, 'venda');
  assert.deepEqual(erros(s), []);
  const ded = lancamentos(s, venda.event_id).find((f) => f.retida_pelo_comprador === true);
  s.editar('PARCELAS', titulos(s, ded)[0].parcela_id, 'data_vencimento', '2026-09-20');
  assert.ok(erros(s).some((e) => e[0] === 'FINANCEIRO' && /descontada pelo comprador, vence em 20\/09\/2026, fora dos recebimentos da venda \(10\/09\/2026\)/.test(e[1])), JSON.stringify(erros(s)));
});
