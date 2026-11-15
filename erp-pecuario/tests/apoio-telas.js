'use strict';
/**
 * Apoio aos testes de tela no Node (sem navegador): os scripts do cliente da página montada pelo doGet real num contexto
 * vm e um Store mínimo do cliente sobre a carga inicial real (sistema.bootstrap). Não é arquivo de teste.
 */
const vm = require('node:vm');
const S = require('./apoio-sistema');

const { js } = S;
function api(s, pedido) { return js(s.gas.exec(() => s.G.api(pedido))); }
/** Os scripts do cliente da página do doGet num contexto vm (sem o boot, que precisa do DOM). */
function cliente(s) {
  const html = s.gas.exec(() => s.G.doGet({ parameter: {} })).getContent();
  const ctx = vm.createContext({ console });
  ctx.window = ctx;
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((b) => b.indexOf('DOMContentLoaded') < 0).forEach((b, i) => vm.runInContext(b, ctx, { filename: 'cliente' + i }));
  return ctx;
}
function materializar(col) {
  const out = [];
  for (let i = 0; i < col.n; i++) { const o = {}; col.colunas.forEach((c) => { o[c] = col.valores[c][i]; }); out.push(o); }
  return out;
}
/** Store mínimo do cliente sobre a carga inicial real (sistema.bootstrap). */
function storeDe(s) {
  const b = api(s, { rota: 'sistema.bootstrap', dados: {} }).data;
  const animais = materializar(b.animais);
  const params = Object.fromEntries(b.configuracoes.itens.map((i) => [i.chave, i.valor]));
  return {
    b, animais,
    tipoEvento: (t) => b.catalogo.tipos.filter((x) => x.tipo === t)[0] || null,
    animal: (id) => animais.filter((a) => a.animal_id === id)[0] || null,
    lista: (n) => b.listas.filter((l) => l.lista === n && l.ativo !== false),
    itemLista: (n, c) => b.listas.filter((l) => l.lista === n && l.codigo === c)[0] || null,
    param: (k) => (params[k] === undefined ? null : params[k]),
    pasto: (id) => b.pastos.filter((p) => p.pasture_id === id)[0] || null,
    categoria: (id) => b.categorias.filter((c) => c.category_id === id)[0] || null,
    rotuloLista: (n, c) => (b.listas.filter((l) => l.lista === n && l.codigo === c)[0] || { rotulo: c }).rotulo,
    conta: (id) => b.contas.filter((x) => x.conta_id === id)[0] || null,
    parceiro: (id) => b.parceiros.filter((x) => x.partner_id === id)[0] || null,
    rotuloAnimal: (a) => a.brinco || a.codigo_interno,
    normalizarBrinco: (t, z) => { let v = String(t == null ? '' : t).trim().toUpperCase().replace(/\s+/g, ''); if (!z && /^\d+$/.test(v)) v = v.replace(/^0+(?=\d)/, ''); return v; },
  };
}

module.exports = { api, cliente, materializar, storeDe };
