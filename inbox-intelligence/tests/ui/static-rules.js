'use strict';
/**
 * Análise estática da interface (src/index.html, src/styles.html, src/client.html).
 * Usada por tests/ui-static.test.js e por scripts/ui-check.js.
 * As regras são propositalmente simples (regex) e vêm com autoteste de detecção.
 */
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');
const FILES = ['index.html', 'styles.html', 'client.html'];
const MAX_TOTAL_BYTES = 180 * 1024;

const RULES = [
  { id: 'innerHTML-com-valor', why: 'innerHTML só pode ser usado para limpar (= \'\')', re: /\.innerHTML\s*(?:\+=|=(?!=)(?!\s*(['"])\1\s*[;,)\n]))/ },
  { id: 'outerHTML', why: 'outerHTML proibido', re: /\bouterHTML\b/ },
  { id: 'insertAdjacentHTML', why: 'insertAdjacentHTML proibido', re: /\binsertAdjacentHTML\b/ },
  { id: 'document.write', why: 'document.write proibido', re: /\bdocument\s*\.\s*write(?:ln)?\s*\(/ },
  { id: 'eval', why: 'eval proibido', re: /(?:^|[^.\w$])eval\s*\(/ },
  { id: 'new-Function', why: 'new Function proibido', re: /\bnew\s+Function\s*\(/ },
  { id: 'timer-com-string', why: 'setTimeout/setInterval com string', re: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/ },
  { id: 'handler-inline', why: 'atributo on*= em HTML', re: /\son[a-z]+\s*=\s*["']/i },
  { id: 'src-externo', why: 'recurso externo via src', re: /\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i },
  { id: 'href-externo', why: 'recurso externo via href', re: /\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i },
  { id: 'stylesheet-externo', why: '<link rel=stylesheet>', re: /<link\b[^>]*\brel\s*=\s*["']?stylesheet/i },
  { id: 'script-src', why: '<script src>', re: /<script\b[^>]*\bsrc\s*=/i },
  { id: 'css-externo', why: '@import ou url() externo no CSS', re: /@import\b|url\(\s*["']?\s*(?:https?:)?\/\//i },
  { id: 'javascript-url', why: 'URL javascript:', re: /javascript\s*:/i },
  { id: 'srcdoc', why: 'atributo srcdoc', re: /\bsrcdoc\s*=/i }
];
const CLIENT_RULES = [
  { id: 'es2020-sintaxe', why: 'optional chaining/nullish (ES2020) fora do alvo ES2019', re: /\?\.(?=[A-Za-z_$[(])|\?\?/ },
  { id: 'scriptlet-em-incluido', why: '<? em arquivo incluído', re: /<\?/ },
  { id: 'fecha-script-em-string', why: '"</script" dentro do JS quebra o HTML', re: /<\/script/i }
];

function read(name) { return fs.readFileSync(path.join(SRC, name), 'utf8'); }

/** Remove a moldura <script>/<style> de um arquivo incluído para inspecionar só o miolo. */
function inner(text, tag) {
  const open = new RegExp('^\\s*<' + tag + '>');
  const close = new RegExp('</' + tag + '>\\s*$');
  return text.replace(open, '').replace(close, '');
}

function lineOf(text, index) { return text.slice(0, index).split('\n').length; }

function scan(name, text, rules) {
  const out = [];
  for (const r of rules) {
    const re = new RegExp(r.re.source, r.re.flags.includes('g') ? r.re.flags : r.re.flags + 'g');
    let m;
    while ((m = re.exec(text))) {
      out.push({ file: name, rule: r.id, why: r.why, line: lineOf(text, m.index), snippet: text.slice(m.index, m.index + 60).replace(/\s+/g, ' ') });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return out;
}

/** Verifica os três arquivos. Devolve {violations: [...], sizes: {...}, total}. */
function checkFiles(srcOverride) {
  const get = srcOverride || read;
  const violations = [];
  const sizes = {};
  let total = 0;
  for (const f of FILES) {
    const text = get(f);
    sizes[f] = Buffer.byteLength(text, 'utf8');
    total += sizes[f];
    violations.push(...scan(f, text, RULES));
  }
  const client = get('client.html');
  const styles = get('styles.html');
  const index = get('index.html');
  if (!/^\s*<script>/.test(client) || !/<\/script>\s*$/.test(client)) violations.push({ file: 'client.html', rule: 'moldura', why: 'client.html deve ser um único <script>…</script>', line: 1 });
  if (!/^\s*<style>/.test(styles) || !/<\/style>\s*$/.test(styles)) violations.push({ file: 'styles.html', rule: 'moldura', why: 'styles.html deve ser um único <style>…</style>', line: 1 });
  violations.push(...scan('client.html', inner(client, 'script'), CLIENT_RULES));
  violations.push(...scan('styles.html', styles, [CLIENT_RULES[1]]));
  // index.html: scriptlets só no formato <?!= include('nome'); ?>
  const scriptlets = index.match(/<\?[\s\S]*?\?>/g) || [];
  for (const s of scriptlets) {
    if (!/^<\?!=\s*include\('[a-z][a-z0-9_-]*'\);\s*\?>$/.test(s)) violations.push({ file: 'index.html', rule: 'scriptlet', why: 'scriptlet fora do formato include()', line: lineOf(index, index.indexOf(s)), snippet: s });
  }
  if ((index.match(/<\?/g) || []).length !== scriptlets.length) violations.push({ file: 'index.html', rule: 'scriptlet', why: '<? sem fechamento', line: 1 });
  if (!/<meta charset="utf-8">/i.test(index)) violations.push({ file: 'index.html', rule: 'charset', why: 'falta <meta charset="utf-8">', line: 1 });
  // links externos: um único ponto que define target/rel, sempre juntos
  const targets = (client.match(/\.target\s*=\s*'_blank'/g) || []).length;
  const rels = (client.match(/\.rel\s*=\s*'noopener noreferrer'/g) || []).length;
  const hrefs = (client.match(/\.href\s*=(?!=)/g) || []).length;
  if (targets !== rels || hrefs !== targets) violations.push({ file: 'client.html', rule: 'links-externos', why: 'href/target/rel devem ser definidos juntos (só em extLink)', line: 1, snippet: 'href=' + hrefs + ' target=' + targets + ' rel=' + rels });
  if (total > MAX_TOTAL_BYTES) violations.push({ file: '*', rule: 'tamanho', why: 'os três arquivos somam ' + total + ' bytes (> ' + MAX_TOTAL_BYTES + ')', line: 0 });
  return { violations, sizes, total };
}

/** Autoteste: cada regra precisa detectar um exemplo ruim e aceitar um exemplo bom. */
const SELF_TEST = {
  bad: {
    'innerHTML-com-valor': ['el.innerHTML = x;', 'el.innerHTML += "<b>";', "el.innerHTML = '<b>' + x;"],
    outerHTML: ['el.outerHTML = x'], insertAdjacentHTML: ['el.insertAdjacentHTML("beforeend", x)'], 'document.write': ['document.write(x)'],
    eval: ['eval(x)', 'window.x = eval (y)'], 'new-Function': ['new Function("a", "b")'], 'timer-com-string': ['setTimeout("go()", 10)', 'setInterval(`x`, 5)'],
    'handler-inline': ['<button onclick="x()">'], 'src-externo': ['<img src="https://x.y/a.png">', '<script src="//cdn.x/y.js">'],
    'href-externo': ['<a href="http://x.y">'], 'stylesheet-externo': ['<link rel="stylesheet" href="a.css">'], 'script-src': ['<script src="a.js">'],
    'css-externo': ['@import url(a.css);', 'background:url(https://x.y/i.png)'], 'javascript-url': ['href="javascript:void(0)"'], srcdoc: ['<iframe srcdoc="x">']
  },
  good: ["el.innerHTML = '';", 'el.textContent = x;', 'setTimeout(function () {}, 10)', "a.href = x.href;", "evaluate(x)", "var retrieval = 1;"]
};
function selfTest() {
  const problems = [];
  for (const r of RULES) {
    for (const ex of SELF_TEST.bad[r.id] || []) if (!scan('t', ex, [r]).length) problems.push(r.id + ' não detectou: ' + ex);
    if (!(SELF_TEST.bad[r.id] || []).length) problems.push(r.id + ' sem exemplo ruim no autoteste');
  }
  for (const ex of SELF_TEST.good) { const hits = scan('t', ex, RULES); if (hits.length) problems.push(hits[0].rule + ' acusou falso positivo: ' + ex); }
  return problems;
}

module.exports = { checkFiles, selfTest, RULES, CLIENT_RULES, FILES, MAX_TOTAL_BYTES };
