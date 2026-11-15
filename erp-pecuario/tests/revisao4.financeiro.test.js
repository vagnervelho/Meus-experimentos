'use strict';
/**
 * Revisão independente da Fase 2, rodada 4, lente FINANCEIRO (a parte que roda no Node): a prévia da correção pela
 * tela, montada como o formulário monta (Registro.montarDados), é aceita pelo servidor também no lote de um animal
 * dividido por carcaça e no registro histórico; o custo de aquisição do animal que só existe no histórico; o tipo de cada
 * custo da compra pelo registro do evento (não pela ordem das linhas); e a base estimada da venda recalculada pela
 * integridade. Projeção = reconstrução depois de cada comando.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');
const { api, cliente, storeDe } = require('./apoio-telas');

const { js, PASTOS } = S;
const clone = (v) => JSON.parse(JSON.stringify(v));
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

function montar(opcoes) {
  const s = S.sistema(opcoes || {});
  const sem = api(s, { rota: 'evento.registrar', idempotencyKey: 'sem', dados: S.entradaInicial([
    S.bicho({ brinco: '0201', sexo: 'M', castrado: true, reprodutor: false, data_nascimento: '2023-05-01', data_nascimento_confianca: 'ESTIMADA' }),
    S.bicho({ brinco: '0202', sexo: 'M', castrado: true, reprodutor: false, data_nascimento: '2023-05-01', data_nascimento_confianca: 'ESTIMADA' }),
  ]) });
  assert.equal(sem.ok, true, JSON.stringify(sem.error));
  const id = (b) => sem.data.animais.find((x) => x.brinco === b).animal_id;
  const parceiro = (nome, tipos) => api(s, { rota: 'parceiro.salvar', idempotencyKey: 'p-' + nome, dados: { campos: { nome, tipos } } }).data.partner_id;
  return { s, id, parceiro };
}
function registrar(s, dados, chave, avisos) {
  const r = api(s, { rota: 'evento.registrar', idempotencyKey: chave, avisosAceitos: avisos || [], dados });
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
const erros = (s) => (s.integridade().achados || []).filter((x) => x.severidade === 'ERRO').map((x) => [x.checagem, x.mensagem]);

// ---------------------------------------------------------------- importação histórica (apoio) ----
function importar(s, tipo, csv, mapa, chave) {
  const imp = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: chave, dados: { tipo, arquivo_nome: chave + '.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
  for (let b = 1; b < 100; b++) {
    const e = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + chave + '-' + b, dados: { import_id: imp.import_id, bloco: b, mapeamento: mapa } })).dados;
    if (e.importacao.status === 'VALIDADO') break;
  }
  const r = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: imp.import_id, bloco: 1, modo: 'TOTAL' } }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  const c = s.tentar((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: imp.import_id } }));
  assert.ok(c.ok, JSON.stringify(c.erro));
  s.conferirProjecoes('importação ' + chave);
}
function historico() {
  const r = montar({ config: { importacao_lote_linhas: '50' } });
  r.parceiro('Fazenda Vizinha', ['FORNECEDOR']);
  r.parceiro('Frigorífico Boi Bom', ['COMPRADOR']);
  const MAPA_C = { colunas: { 'Nº da compra': 'grupo', 'Data da compra': 'data', Fornecedor: 'fornecedor', 'Como foi o preço': 'modalidade', 'Valor dos animais (R$)': 'valor_animais', 'Preço (R$)': 'preco', 'Frete (R$)': 'frete',
    Brinco: 'brinco', Sexo: 'sexo', Nascimento: 'data_nascimento', Castrado: 'castrado', Reprodutor: 'reprodutor', Pasto: 'pasto' }, confiancas: { data_nascimento: 'ESTIMADA' }, padroes: {} };
  importar(r.s, 'COMPRAS', ['Nº da compra;Data da compra;Fornecedor;Como foi o preço;Valor dos animais (R$);Preço (R$);Frete (R$);Brinco;Sexo;Nascimento;Castrado;Reprodutor;Pasto',
    'H1;10/02/2025;Fazenda Vizinha;cabeça;2.000,00;2.000,00;50,00;900;M;01/01/2024;S;N;Pasto A'].join('\n'), MAPA_C, 'compras');
  const MAPA_V = { colunas: { 'Nº da venda': 'grupo', 'Data da venda': 'data', Comprador: 'comprador', 'Para que foram vendidos': 'finalidade', 'Como foi o preço': 'modalidade', 'Preço (R$)': 'preco', 'Valor bruto (R$)': 'valor_bruto', 'Comissão (R$)': 'comissao', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
  importar(r.s, 'VENDAS', ['Nº da venda;Data da venda;Comprador;Para que foram vendidos;Como foi o preço;Preço (R$);Valor bruto (R$);Comissão (R$);Brinco',
    'V0;20/10/2025;Frigorífico Boi Bom;abate;cabeça;3.000,00;3.000,00;60,00;900'].join('\n'), MAPA_V, 'vendas');
  return r;
}

// ---------------------------------------------------------------- achado 7 (MÉDIA) ----
test('R4 achado 7: venda e compra em lote fechado de um animal dividido por carcaça (gravado DIRETO) se corrigem pela tela, sem mudar nada e mudando o vencimento', () => {
  const { s, id, parceiro } = montar();
  const c = cliente(s);
  const comp = parceiro('Frigorífico', ['COMPRADOR']);
  const forn = parceiro('Leilão', ['FORNECEDOR']);
  const v = registrar(s, { tipo: 'VENDA', campos: { event_date: '2026-06-10', partner_id: comp, finalidade: 'ABATE', modalidade: 'LOTE', criterio_rateio: 'PESO_CARCACA', valor_bruto: 450000 },
    animais: [{ animal_id: id('0201'), peso: 520, peso_carcaca_kg: 270 }], parcelas: [{ data_vencimento: '2026-07-10' }] }, 'venda');
  assert.equal(s.tabela('VENDAS').find((x) => x.event_id === v.event_id).criterio_rateio, 'DIRETO');
  let x = sessaoDaPrevia(c, s, v.event_id);
  assert.equal(x.previa.campos.criterio_rateio, 'PESO_CARCACA', 'a carcaça na linha só cabe no rateio por carcaça');
  assert.deepEqual(js(c.Registro.diferencas(x.sess)), []);
  const k1 = corrigirPelaTela(c, s, x.sess, 'corr-venda');
  assert.deepEqual(lancamentos(s, k1.event_id).map((f) => f.valor), [450000]);
  x = sessaoDaPrevia(c, s, k1.event_id);
  x.sess.grupos.parcelas[0].valores.data_vencimento = '2026-07-20';
  const k2 = corrigirPelaTela(c, s, x.sess, 'corr-venda-venc');
  assert.equal(s.tabela('PARCELAS').find((p) => p.financial_id === lancamentos(s, k2.event_id)[0].financial_id).data_vencimento, '2026-07-20');
  const cp = registrar(s, { tipo: 'COMPRA', campos: { event_date: '2026-06-12', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'LOTE', criterio_rateio: 'PESO_CARCACA', valor_animais: 300000 },
    animais: [{ brinco: '0900', sexo: 'M', castrado: false, reprodutor: false, idade_meses: 20, peso: 400, peso_carcaca_kg: 200 }], parcelas: [{ data_vencimento: '2026-07-12' }] }, 'compra');
  x = sessaoDaPrevia(c, s, cp.event_id);
  assert.equal(x.previa.campos.criterio_rateio, 'PESO_CARCACA');
  const k3 = corrigirPelaTela(c, s, x.sess, 'corr-compra');
  assert.equal(s.tabela('COMPRAS').find((y) => y.event_id === k3.event_id).criterio_rateio, 'DIRETO');
  assert.deepEqual(erros(s), []);
});

// ---------------------------------------------------------------- achado 8 (MÉDIA) ----
test('R4 achado 8: a compra e a venda históricas (importadas antes do marco zero) se corrigem pela tela: a prévia traz os animais e não exige parcela', () => {
  const { s } = historico();
  const c = cliente(s);
  const evs = s.tabela('EVENTOS').filter((e) => e.pre_marco_zero === true);
  assert.deepEqual(evs.map((e) => e.event_type).sort(), ['COMPRA', 'VENDA']);
  const compra = evs.find((e) => e.event_type === 'COMPRA');
  let x = sessaoDaPrevia(c, s, compra.event_id);
  assert.equal(x.previa.linhas.length, 1, 'o animal da compra histórica vem na prévia');
  assert.equal(x.previa.linhas[0].valores.brinco, '900');
  assert.equal(x.previa.campos.pasto_destino_id, PASTOS.A);
  assert.deepEqual(x.previa.grupos.parcelas, [], 'o histórico não tem título');
  // Corrigir o preço da compra importada errada (R$ 2.000,00 → R$ 2.100,00).
  x.sess.campos.preco_unitario = '2100,00';
  x.sess.campos.valor_animais = '2100,00';
  const k = corrigirPelaTela(c, s, x.sess, 'corr-compra-hist');
  const principal = lancamentos(s, k.event_id).find((f) => f.valor === 210000);
  assert.ok(principal, JSON.stringify(lancamentos(s, k.event_id)));
  assert.equal(principal.status_pagamento, 'SEM_CAIXA');
  const venda = s.tabela('EVENTOS').find((e) => e.pre_marco_zero === true && e.event_type === 'VENDA' && e.status === 'CONFIRMADO');
  x = sessaoDaPrevia(c, s, venda.event_id);
  assert.equal(x.previa.linhas.length, 1);
  corrigirPelaTela(c, s, x.sess, 'corr-venda-hist');
  assert.deepEqual(erros(s), []);
});

// ---------------------------------------------------------------- achado 9 (MÉDIA) ----
test('R4 achado 9: o animal que só existe no histórico (comprado e vendido antes do marco zero) tem o custo da compra histórica e o resultado na ficha', () => {
  const { s } = historico();
  const a = s.tabela('ANIMAIS').find((x) => x.brinco === '900');
  assert.deepEqual([a.situacao_cadastral, a.custo_aquisicao, a.custo_aquisicao_origem], ['VENDIDO', 205000, 'NEGOCIADO']);
  const h = s.read(s.G.AnimalService.consultaFicha({ animal_id: a.animal_id })).financeiro;
  assert.equal(h.custo_aquisicao, 205000);
  assert.deepEqual(h.resultado, { valor: 89000, motivo: null }, 'R$ 3.000,00 − R$ 60,00 − R$ 2.050,00');
  // O animal do marco zero não leva uma compra histórica de antes da entrada dele (04, seção 6): continua vazio.
  const m0 = s.tabela('ANIMAIS').find((x) => x.brinco === '0201');
  assert.equal(m0.custo_aquisicao, null);
  // A integridade confere o mesmo critério: custo mexido à mão no animal histórico é acusado.
  assert.deepEqual(erros(s), []);
  s.editar('ANIMAIS', a.animal_id, 'custo_aquisicao', 1);
  assert.ok(erros(s).some((e) => e[0] === 'CUSTO_AQUISICAO' && /900/.test(e[1])), JSON.stringify(erros(s)));
});

// ---------------------------------------------------------------- achado 10 (MÉDIA) ----
test('R4 achado 10: o tipo de cada custo da compra vem do registro do evento; classificar a aba FINANCEIRO não gera erro nem troca frete por outro custo na correção', () => {
  const { s, parceiro } = montar();
  const forn = parceiro('Leilão', ['FORNECEDOR']);
  const transp = parceiro('Transportes Rio', ['TRANSPORTADOR']);
  const corretor = parceiro('Corretor Zé', ['OUTRO']);
  const g = (b) => ({ brinco: b, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 });
  const ev = registrar(s, { tipo: 'COMPRA', campos: { event_date: '2026-03-10', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 600000 },
    animais: [g('301'), g('302')], parcelas: [{ data_vencimento: '2026-04-10' }], custos: [{ tipo: 'FRETE', valor: 80000, partner_id: transp }, { tipo: 'OUTRO', valor: 15000, partner_id: corretor }] }, 'c1').event_id;
  const papel = () => { const o = api(s, { rota: 'evento.obter', dados: { event_id: ev } }).data; return Object.fromEntries(o.detalhes.FINANCEIRO.map((f) => [f.valor, o.papeis[f.financial_id]])); };
  assert.deepEqual(papel(), { 600000: 'ANIMAIS', 80000: 'FRETE', 15000: 'OUTRO' });
  // O dono classifica a aba por valor, em ordem crescente: só a ordem das linhas muda.
  const banco = s.banco();
  const mat = s.gas.planilhas.matriz(banco, 'FINANCEIRO');
  const iv = mat[0].indexOf('valor');
  s.gas.planilhas.gravar(banco, 'FINANCEIRO', 2, 1, mat.slice(1).filter((l) => l.some((x) => x !== '')).sort((a, b) => a[iv] - b[iv]));
  assert.deepEqual(papel(), { 600000: 'ANIMAIS', 80000: 'FRETE', 15000: 'OUTRO' });
  assert.deepEqual(erros(s), []);
  const c = cliente(s);
  const x = sessaoDaPrevia(c, s, ev);
  assert.deepEqual(x.previa.grupos.custos.map((y) => [y.valores.tipo, y.valores.valor]).sort(), [['FRETE', '800,00'], ['OUTRO', '150,00']]);
  const k = corrigirPelaTela(c, s, x.sess, 'corr');
  const cp = s.tabela('COMPRAS').find((y) => y.event_id === k.event_id);
  assert.deepEqual([cp.frete, cp.outros_custos], [80000, 15000]);
  const doCorretor = lancamentos(s, k.event_id).find((f) => f.partner_id === corretor);
  assert.match(doCorretor.descricao, /^Outros custos da compra/);
  assert.deepEqual(erros(s), []);
  // O registro do tipo mexido à mão é acusado (o frete e os outros custos não conferem).
  const e = s.tabela('EVENTOS').find((y) => y.event_id === k.event_id);
  const pj = clone(e.payload_json);
  pj.custos.forEach((y) => { y.tipo = 'FRETE'; });
  s.editar('EVENTOS', e.event_id, 'payload_json', JSON.stringify(pj));
  assert.ok(erros(s).some((y) => y[0] === 'FINANCEIRO' && /O frete \(R\$ 800,00\) e os outros custos \(R\$ 150,00\)/.test(y[1])), JSON.stringify(erros(s)));
});

// ---------------------------------------------------------------- achado 21 (BAIXA) ----
test('R4 achado 21: a base estimada da venda só com o peso do lote é recalculada pela integridade; corrigir a pesagem que a originou dá alerta de rateio desatualizado', () => {
  const { s, parceiro } = montar();
  const forn = parceiro('Leilão', ['FORNECEDOR']);
  const comp = parceiro('Frigorífico', ['COMPRADOR']);
  const g = (b, p) => ({ brinco: b, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14, peso: p });
  const compra = { tipo: 'COMPRA', campos: { event_date: '2026-02-01', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'KG_VIVO', preco_unitario: 1500, valor_animais: 600000 },
    animais: [g('301', 200), g('302', 200)], parcelas: [{ data_vencimento: '2026-03-01' }] };
  const c = registrar(s, compra, 'c');
  const ids = c.animais.map((a) => a.animal_id);
  const v = registrar(s, { tipo: 'VENDA', campos: { event_date: '2026-08-01', partner_id: comp, finalidade: 'ABATE', modalidade: 'KG_VIVO', preco_unitario: 1000, peso_vivo_total_kg: 800, valor_bruto: 800000 },
    animais: ids.map((animal_id) => ({ animal_id })), parcelas: [{ data_vencimento: '2026-09-01' }] }, 'v', ['RATEIO_SEM_PESO']);
  const base = (r) => r.checagens.find((x) => x.codigo === 'BASE_RATEIO');
  assert.equal(base(s.integridade()).situacao, 'OK');
  const corr = clone(compra);
  corr.event_id = c.event_id; corr.justificativa = 'Peso digitado errado';
  corr.animais = [Object.assign(g('301', 300), { animal_id: ids[0] }), Object.assign(g('302', 200), { animal_id: ids[1] })];
  const k = api(s, { rota: 'evento.corrigir', idempotencyKey: 'k', avisosAceitos: ['VALOR_DIVERGENTE'], dados: corr });
  assert.equal(k.ok, true, JSON.stringify(k.error));
  s.conferirProjecoes('correção da compra');
  const r = s.integridade();
  assert.equal(base(r).situacao, 'ALERTA');
  const ach = r.achados.filter((a) => a.checagem === 'BASE_RATEIO');
  assert.equal(ach.length, 2, JSON.stringify(ach));
  assert.ok(ach.some((a) => /\(400\) difere da recalculada hoje pela última pesagem até 01\/08\/2026, ajustada ao peso do lote \(480\)/.test(a.mensagem)), JSON.stringify(ach));
  assert.ok(ach.some((a) => /\(400\) difere .*\(320\)/.test(a.mensagem)));
  assert.equal(v.event_type, 'VENDA');
  assert.deepEqual(erros(s), [], 'é alerta, não erro: o re-rateio é decisão do dono');
});
