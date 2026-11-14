'use strict';
/**
 * Interface (E1.9, parte 1) no Node, sem navegador: a página montada pelo doGet real (template Index com os includes
 * da lista branca, versão, ambiente e endereço do app), sintaxe dos scripts do cliente, critérios verificáveis de 08
 * (seção 14) sobre o CSS — contraste das variáveis de tema, base de 16 px, campos ≥ 16 px, alvos ≥ 48 px, foco
 * visível —, regras estáticas do cliente (só o Cliente fala com google.script.run; localStorage só no armazém;
 * nada de innerHTML/eval) e os contratos entre o catálogo/servidor e o renderizador. Os fluxos em navegador ficam em
 * tests/ui/ (npm run ui:check).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('./apoio-sistema');
const { createGas } = require('./harness');

const SRC = path.join(__dirname, '..', 'src');
const ler = (n) => fs.readFileSync(path.join(SRC, n), 'utf8');
const HTMLS = fs.readdirSync(SRC).filter((f) => f.endsWith('.html'));
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

function doGet(s, parametros) { return s.gas.exec(() => s.G.doGet({ parameter: parametros || {} })); }

test('página: o doGet monta o Index com os includes, a versão, o ambiente e o endereço do app; ambiente desconhecido → aviso', () => {
  const s = S.sistema({ semCadastro: true });
  const p = doGet(s);
  const html = p.getContent();
  assert.equal(p.getTitle(), 'ERP Pecuário');
  assert.deepEqual(p._meta, [['viewport', 'width=device-width, initial-scale=1']]);
  assert.doesNotMatch(html, /<\?/, 'nenhum scriptlet sobra');
  assert.match(html, /<html lang="pt-BR">/);
  assert.match(html, new RegExp('data-app-version="' + PKG.version.replace(/\./g, '\\.') + '"'));
  assert.match(html, /data-ambiente="PRODUCAO"/);
  assert.match(html, /data-url-app="https:\/\/script\.google\.com\/macros\/s\/TEST\/exec"/);
  for (const marca of ['--fundo:', 'var Cliente =', 'var Registro =', 'var TelaInicio =', 'App.iniciar()']) assert.ok(html.includes(marca), marca);
  const demo = doGet(s, { ambiente: 'demo' }).getContent();
  assert.match(demo, /data-ambiente="DEMO"/);
  assert.match(demo, /data-url-app="https:\/\/script\.google\.com\/macros\/s\/TEST\/exec\?ambiente=DEMO"/);
  const ruim = doGet(s, { ambiente: 'XPTO' });
  assert.match(ruim.getContent(), /Endereço do app inválido/);
  assert.doesNotMatch(ruim.getContent(), /var Cliente/);
  // Sem implantação publicada: o endereço fica vazio (a página recarrega o próprio quadro) e a causa vai ao log.
  s.G.ScriptApp.getService = () => { throw new Error('Script has no deployments'); };
  assert.match(doGet(s).getContent(), /data-url-app=""/);
  assert.ok(s.gas.logs.some((l) => l[0] === 'error' && /endereço do app indisponível/.test(String(l[1][0]))));
});

test('scripts do cliente: sintaxe válida em cada <script> da página montada; todo .html de src/ é incluído pelo Index', () => {
  const s = S.sistema({ semCadastro: true });
  const html = doGet(s).getContent();
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocos.length >= 4);
  blocos.forEach((b, i) => assert.doesNotThrow(() => new vm.Script(b, { filename: 'script' + i }), 'script ' + i));
  const index = ler('Index.html');
  HTMLS.filter((f) => f !== 'Index.html').forEach((f) => assert.match(index, new RegExp("include_\\('" + f.replace('.html', '') + "'\\)"), f + ' incluído'));
});

/** Variáveis de :root em {nome: #hex}. */
function tema() {
  const css = ler('Styles.html');
  const root = /:root\s*\{([\s\S]*?)\}/.exec(css)[1];
  const v = {};
  for (const m of root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) v[m[1]] = m[2];
  return v;
}
function luminancia(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

test('tema: contraste das variáveis — dados ≥ 7:1, texto e estados ≥ 4,5:1, bordas e foco ≥ 3:1 (08, seção 14)', () => {
  const v = tema();
  const pares = [
    ['texto-dado', 'superficie', 7], ['texto-dado', 'fundo', 7], ['texto-dado', 'superficie-2', 7], ['texto', 'superficie', 7], ['texto', 'fundo', 7],
    ['texto-suave', 'superficie', 4.5], ['texto-suave', 'fundo', 4.5], ['texto-suave', 'superficie-2', 4.5],
    ['acao-texto', 'acao', 4.5], ['acao-texto', 'acao-escura', 4.5], ['acao', 'superficie', 4.5], ['acao', 'acao-fundo', 4.5], ['acao', 'fundo', 4.5],
    ['ok', 'ok-fundo', 4.5], ['aviso', 'aviso-fundo', 4.5], ['erro', 'erro-fundo', 4.5], ['info', 'info-fundo', 4.5], ['teste-texto', 'teste', 4.5],
    ['superficie', 'erro', 4.5], ['superficie', 'texto', 4.5],
    ['borda', 'superficie', 3], ['borda', 'fundo', 3], ['foco', 'superficie', 3], ['foco', 'fundo', 3], ['erro', 'superficie', 3],
  ];
  for (const [fg, bg, min] of pares) {
    assert.ok(v[fg] && v[bg], 'variáveis ' + fg + '/' + bg);
    const c = contraste(v[fg], v[bg]);
    assert.ok(c >= min, fg + ' sobre ' + bg + ': ' + c.toFixed(2) + ':1 (mínimo ' + min + ':1)');
  }
  // Autoteste da conta: preto × branco = 21:1.
  assert.equal(Math.round(contraste('#000000', '#ffffff')), 21);
});

/** Declarações de uma regra cujo seletor é exatamente `sel` (primeira ocorrência). */
function regra(css, sel) {
  const re = new RegExp('(^|\\n|\\})\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = re.exec(css);
  return m ? m[2] : null;
}
test('tipografia, alvos e foco no CSS: base 16 px; campos ≥ 16 px; controles com 48 px; foco com contorno de 3 px', () => {
  const css = ler('Styles.html');
  assert.match(regra(css, 'body'), /font-size:\s*16px/);
  assert.match(regra(css, 'html'), /font-size:\s*100%/);
  assert.match(regra(css, 'input, select, textarea'), /font-size:\s*16px/, 'campos ≥ 16 px (sem zoom no iOS)');
  assert.match(regra(css, ':root'), /--alvo:\s*48px/);
  assert.match(regra(css, ':root'), /--respiro:\s*8px/);
  for (const sel of ['.botao', '.opcao', '.marca', '.menu-item', '.barra-item', '.ordenar']) {
    const r = regra(css, sel);
    assert.ok(r, sel);
    assert.match(r, /min-height:\s*var\(--alvo\)/, sel + ' com altura mínima de 48 px');
  }
  assert.match(regra(css, 'input, select, textarea'), /min-height:\s*var\(--alvo\)/);
  assert.match(regra(css, ':focus-visible'), /outline:\s*3px solid var\(--foco\)/);
  assert.match(css, /\.opcao:has\(input:focus-visible\)/, 'rádio escondido mostra o foco no rótulo');
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /@media \(min-width: 900px\)/, 'corte de leiaute em 900 px');
  assert.match(css, /prefers-reduced-motion/);
});

test('cliente: só o Cliente usa google.script.run; localStorage só no armazém do Util; sem innerHTML, eval, document.write nem TODO', () => {
  const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const fontes = Object.fromEntries(HTMLS.map((f) => [f, semComentarios(ler(f))]));
  for (const [f, t] of Object.entries(fontes)) {
    assert.doesNotMatch(t, /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, f + ': montagem só por nós (texto vira texto)');
    assert.doesNotMatch(t, /\b(TODO|FIXME|XXX)\b/, f);
  }
  const js = fontes['JavaScript.html'];
  const cliente = js.slice(js.indexOf('var Cliente ='), js.indexOf('var Store ='));
  assert.match(cliente, /g\.script\.run/);
  for (const [f, t] of Object.entries(fontes)) {
    const fora = f === 'JavaScript.html' ? t.replace(cliente, '') : t;
    assert.doesNotMatch(fora, /script\.run/, f + ': nenhuma tela chama google.script.run (01, seção 7)');
  }
  const util = js.slice(js.indexOf('var armazem ='), js.indexOf('var SVG ='));
  assert.match(util, /window\.localStorage/);
  for (const [f, t] of Object.entries(fontes)) {
    const fora = f === 'JavaScript.html' ? t.replace(util, '') : t;
    assert.doesNotMatch(fora, /localStorage\./, f + ': localStorage só pelo Util.armazem (com tratamento de falha)');
  }
  // Os parâmetros que o cliente manda ao servidor nascem de JSON simples: nenhum Date.
  assert.doesNotMatch(cliente, /new Date\(/);
});

test('catálogo × renderizador: tipos de campo, padrões e condicionais do catálogo são os que o cliente sabe tratar', () => {
  const gas = createGas();
  const C = gas.G.EventCatalog;
  const comp = ler('Components.html');
  for (const t of C.TIPOS_CAMPO) assert.ok(comp.includes("'" + t + "'"), 'Campos trata o tipo ' + t);
  assert.match(comp, /\^ref:\(\\w\+\)\$/, 'Campos trata ref:TABELA');
  const campos = [];
  C.nomes().forEach((n) => {
    const t = C.tipo(n);
    campos.push(...(t.campos || []), ...(t.campos_animal || []));
    Object.values(t.subtipos || {}).forEach((st) => campos.push(...(st.campos || []), ...(st.campos_animal || [])));
    Object.values(t.grupos_repetiveis || {}).forEach((g) => campos.push(...g));
  });
  assert.ok(campos.length > 20);
  for (const f of campos) {
    assert.ok(C.TIPOS_CAMPO.indexOf(f.tipo) >= 0 || /^ref:[A-Z_]+$/.test(f.tipo), f.id + ': tipo ' + f.tipo);
    if (f.default !== undefined) {
      const d = f.default;
      assert.ok(d === 'HOJE' || typeof d !== 'object' || /^CONFIGURACOES\.\w+$/.test(d.de), f.id + ': padrão ' + JSON.stringify(d));
    }
    for (const k of ['visivel_se', 'obrigatorio_se']) {
      if (!f[k]) continue;
      assert.equal(typeof f[k].campo, 'string', f.id + '.' + k);
      assert.ok(Array.isArray(f[k].valores) || f[k].preenchido === true, f.id + '.' + k + ': ' + JSON.stringify(f[k]));
    }
  }
});

test('contrato do erro por animal: animal novo sem brinco vem como "Animal N da lista" (o cliente liga o erro à linha por ele)', () => {
  const s = S.sistema();
  const env = JSON.parse(JSON.stringify(s.gas.exec(() => s.G.api({
    rota: 'evento.registrar', idempotencyKey: 'k-mapa',
    dados: { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-11-10', description: 'Doação' }, animais: [S.bicho({ brinco: '31' }), S.bicho({ data_nascimento: '2026-11-12', data_nascimento_confianca: 'CONFIRMADA' }), S.bicho({ brinco: '33', data_nascimento: '2026-11-12', data_nascimento_confianca: 'CONFIRMADA' })] },
  }))));
  assert.equal(env.error.code, 'VALIDATION');
  const semBrinco = env.error.details.filter((d) => d.brinco === null);
  assert.equal(semBrinco.length, 1);
  assert.match(semBrinco[0].mensagem, /^Animal 2 da lista\b/);
  assert.equal(semBrinco[0].animal_id, null);
  const comBrinco = env.error.details.filter((d) => d.brinco === '33');
  assert.equal(comBrinco.length, 1, 'com brinco, o detalhe traz o brinco digitado');
  // Os campos do animal que volta ao rebanho, fixos no cliente, são os do servidor.
  assert.match(ler('Components.html'), /var CAMPOS_VOLTA = \['brinco', 'pasto_destino_id', 'observacoes'\];/);
  assert.match(ler('EventService.js'), /var CAMPOS_REENTRADA = \['animal_id', 'brinco', 'pasto_destino_id', 'observacoes'\];/);
});
