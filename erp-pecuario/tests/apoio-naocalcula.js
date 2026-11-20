'use strict';
/**
 * Leitor do código do cliente para a regra "o cliente não calcula" (`tests/cliente.naocalcula.test.js`; CONTRATOS, seção 51):
 * os `<script>` de cada `src/*.html` viram tokens (textos, modelos, expressões regulares e comentários reconhecidos), cada token
 * sabe em que função nomeada está (a cadeia de nomes, da mais externa à mais interna), e duas regras acusam o que parece conta de
 * domínio feita no aparelho:
 *  - DATA: aritmética de data — `Date.parse`, `Date.UTC`, `new Date(...)`, `getTime`, `setDate`/`getDate` e afins, o dia em
 *    milissegundos (86400000, 864e5), e as funções de dias (`diasEntre`, `somarDias`, `addDays`);
 *  - NUMERO: a operação aritmética binária (`+ - * / %` e as compostas `+= -= *= /= %=`) em que um dos lados é um número de
 *    domínio pelo nome (GMD, ganho, carência, UA, idade, dias, centavos, valor, total, peso, dose, custo, preço, quantidade,
 *    saldo, estoque, intervalo, prazo, lotação, área, taxa, média, cabeças, parcela, vencimento). A soma com um texto (a
 *    concatenação do rótulo) não conta.
 * Não é arquivo de teste.
 */
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const PALAVRAS = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'else', 'do', 'instanceof', 'yield', 'await']);
const OPS = ['>>>=', '===', '!==', '**=', '<<=', '>>=', '>>>', '...', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];

/** Os scripts de um .html, com a linha em que cada um começa. */
function scripts(html) {
  const out = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const ini = m.index + m[0].indexOf('>') + 1;
    out.push({ codigo: m[1], linha: html.slice(0, ini).split('\n').length });
  }
  return out;
}

function fimDeOperando(t) {
  if (!t) return false;
  if (t.tipo === 'ident') return !PALAVRAS.has(t.v);
  return t.tipo === 'num' || t.tipo === 'texto' || t.tipo === 'modelo' || t.tipo === 'regex' || t.v === ')' || t.v === ']';
}

/** Tokens de um trecho de JavaScript: {tipo: ident|num|texto|modelo|regex|op, v, linha}. Comentários e espaços saem. */
function tokens(codigo, linha0) {
  const out = [];
  let i = 0;
  let linha = linha0 || 1;
  const n = codigo.length;
  const ult = () => out[out.length - 1];
  while (i < n) {
    const c = codigo[i];
    const d = codigo[i + 1];
    if (c === '\n') { linha++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && d === '/') { while (i < n && codigo[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const f = codigo.indexOf('*/', i + 2); const fim = f < 0 ? n : f + 2; linha += (codigo.slice(i, fim).match(/\n/g) || []).length; i = fim; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && codigo[j] !== c) { if (codigo[j] === '\\') j++; j++; }
      out.push({ tipo: 'texto', v: codigo.slice(i + 1, j), linha });
      i = j + 1;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let prof = 0;
      while (j < n && (codigo[j] !== '`' || prof > 0)) {
        if (codigo[j] === '\\') { j += 2; continue; }
        if (codigo[j] === '$' && codigo[j + 1] === '{') { prof++; j += 2; continue; }
        if (codigo[j] === '}' && prof > 0) { prof--; j++; continue; }
        if (codigo[j] === '\n') linha++;
        j++;
      }
      out.push({ tipo: 'modelo', v: codigo.slice(i + 1, j), linha });
      i = j + 1;
      continue;
    }
    if (c === '/' && !fimDeOperando(ult())) {
      let j = i + 1;
      let classe = false;
      while (j < n && (codigo[j] !== '/' || classe) && codigo[j] !== '\n') {
        if (codigo[j] === '\\') { j += 2; continue; }
        if (codigo[j] === '[') classe = true; else if (codigo[j] === ']') classe = false;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(codigo[j])) j++;
      out.push({ tipo: 'regex', v: codigo.slice(i, j), linha });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(d))) {
      const m = /^(0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(codigo.slice(i));
      out.push({ tipo: 'num', v: m[0], linha });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$À-ɏ]/.test(c)) {
      const m = /^[A-Za-z0-9_$À-ɏ]+/.exec(codigo.slice(i));
      out.push({ tipo: 'ident', v: m[0], linha });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => codigo.startsWith(o, i));
    out.push({ tipo: 'op', v: op || c, linha });
    i += op ? op.length : 1;
  }
  return out;
}

/**
 * A cadeia de funções nomeadas de cada token: `function nome(`, `nome: function`, `nome = function`, `var nome = (function`
 * (o módulo) e o método `nome(...) {` de objeto. A função anônima herda o nome de fora.
 */
function cadeias(ts) {
  const pilha = [];
  let pendente = null;
  const out = new Array(ts.length);
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.tipo === 'ident' && t.v === 'function') {
      let nome = null;
      if (ts[i + 1] && ts[i + 1].tipo === 'ident') nome = ts[i + 1].v;
      else {
        let k = i - 1;
        while (k >= 0 && ts[k].v === '(') k--;
        if (k >= 1 && (ts[k].v === '=' || ts[k].v === ':') && ts[k - 1].tipo === 'ident') nome = ts[k - 1].v;
      }
      pendente = { nome, prof: null };
    }
    if (t.tipo === 'op' && t.v === '=>') {
      let k = i - 1;
      if (ts[k] && ts[k].v === ')') { let p = 0; for (; k >= 0; k--) { if (ts[k].v === ')') p++; else if (ts[k].v === '(') { p--; if (!p) break; } } k--; }
      else k--;
      if (k >= 1 && (ts[k].v === '=' || ts[k].v === ':') && ts[k - 1].tipo === 'ident') pendente = { nome: ts[k - 1].v };
      else if (ts[i + 1] && ts[i + 1].v === '{') pendente = { nome: null };
    }
    if (t.v === '{') pilha.push(pendente ? pendente.nome : undefined), pendente = null;
    else if (t.v === '}') pilha.pop();
    out[i] = pilha.filter((x) => x).slice();
  }
  return out;
}

const DOMINIO = /^(gmd(_.*)?|.*ganho.*|carencia.*|.*_carencia|ua|ua_.*|.*_ua|idade.*|.*_idade|dias|dias_.*|.*_dias|.*centavos.*|valor|valor_.*|.*_valor|total.*|.*_total|peso|peso_.*|.*_peso|.*_kg|kg|dose.*|custo.*|.*_custo|preco.*|quantidade.*|saldo.*|estoque.*|intervalo.*|prazo.*|lotacao.*|area.*|.*_ha|taxa.*|media.*|.*_media|cabecas|parcela.*|vencimento.*|arroba.*)$/i;
const DATA_IDENT = new Set(['getTime', 'setDate', 'setUTCDate', 'getDate', 'getUTCDate', 'setMonth', 'setUTCMonth', 'getMonth', 'getUTCMonth', 'setFullYear', 'setUTCFullYear', 'getFullYear', 'getUTCFullYear', 'diasEntre', 'somarDias', 'addDays', 'diffDays']);

/** Os nomes que formam o operando junto do operador (o lado esquerdo vai de trás para a frente). */
function operando(ts, i, dir) {
  const nomes = [];
  let k = i;
  if (dir < 0) {
    for (;;) {
      const t = ts[k];
      if (!t) break;
      if (t.v === ')' || t.v === ']') {
        let p = 0;
        for (; k >= 0; k--) { if (ts[k].v === ')' || ts[k].v === ']') p++; else if (ts[k].v === '(' || ts[k].v === '[') { p--; if (!p) break; } else if (ts[k].tipo === 'ident') nomes.push(ts[k].v); else if (ts[k].tipo === 'texto' || ts[k].tipo === 'modelo') nomes.push('#texto'); }
        k--;
        if (ts[k] && ts[k].tipo === 'ident' && !PALAVRAS.has(ts[k].v)) { nomes.push(ts[k].v); k--; }
      } else if (t.tipo === 'ident' || t.tipo === 'num' || t.tipo === 'texto' || t.tipo === 'modelo') { nomes.push(t.tipo === 'ident' ? t.v : '#' + t.tipo); k--; }
      else break;
      if (ts[k] && (ts[k].v === '.' || ts[k].v === '?.')) { k--; continue; }
      break;
    }
  } else {
    while (ts[k] && ['+', '-', '!', '~', 'typeof'].indexOf(ts[k].v) >= 0) k++;
    for (;;) {
      const t = ts[k];
      if (!t) break;
      if (t.v === '(' || t.v === '[') {
        let p = 0;
        for (; k < ts.length; k++) { if (ts[k].v === '(' || ts[k].v === '[') p++; else if (ts[k].v === ')' || ts[k].v === ']') { p--; if (!p) break; } else if (ts[k].tipo === 'ident') nomes.push(ts[k].v); else if (ts[k].tipo === 'texto' || ts[k].tipo === 'modelo') nomes.push('#texto'); }
        k++;
      } else if (t.tipo === 'ident' || t.tipo === 'num' || t.tipo === 'texto' || t.tipo === 'modelo') { nomes.push(t.tipo === 'ident' ? t.v : '#' + t.tipo); k++; }
      else break;
      if (ts[k] && (ts[k].v === '.' || ts[k].v === '?.' || ts[k].v === '(' || ts[k].v === '[')) { if (ts[k].v === '.' || ts[k].v === '?.') k++; continue; }
      break;
    }
  }
  return nomes;
}

/**
 * O operando é texto (a soma é concatenação): tem um texto ou modelo, ou é o resultado de uma formatação (`Fmt.*`, `String`,
 * `join`, um rótulo `ROTULO_*`).
 */
const TEXTO = (nomes) => nomes.some((x) => x === '#texto' || x === '#modelo' || x === 'Fmt' || x === 'String' || x === 'join' || x === 'toFixed' || /^ROTULO_/.test(x));

/** Os achados de um arquivo: [{regra, arquivo, linha, funcoes, trecho}]. */
function achados(nome, html) {
  const out = [];
  scripts(html).forEach((sc) => {
    const ts = tokens(sc.codigo, sc.linha);
    const cad = cadeias(ts);
    const trecho = (i) => ts.slice(Math.max(0, i - 6), i + 7).map((t) => (t.tipo === 'texto' ? "'" + t.v.slice(0, 12) + "'" : t.tipo === 'modelo' ? '`…`' : t.v)).join(' ');
    const add = (regra, i, extra) => out.push({ regra, arquivo: nome, linha: ts[i].linha, funcoes: cad[i], trecho: trecho(i), extra: extra || null });
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      // DATA
      if (t.tipo === 'ident' && t.v === 'Date' && ts[i + 1] && ts[i + 1].v === '.' && ts[i + 2] && ['parse', 'UTC'].indexOf(ts[i + 2].v) >= 0) add('DATA', i, 'Date.' + ts[i + 2].v);
      else if (t.tipo === 'ident' && t.v === 'new' && ts[i + 1] && ts[i + 1].v === 'Date') add('DATA', i, 'new Date');
      else if (t.tipo === 'ident' && DATA_IDENT.has(t.v) && !(ts[i + 1] && ts[i + 1].v === ':')) add('DATA', i, t.v);
      else if (t.tipo === 'num' && (Number(t.v) === 86400000 || Number(t.v) === 3600000)) add('DATA', i, t.v);
      else if (t.tipo === 'ident' && (t.v === 'Number' || t.v === 'parseInt') && ts[i + 1] && ts[i + 1].v === '(') {
        // O ano, o mês ou o dia tirados do texto da data para fazer conta com eles.
        let p = 0;
        let k = i + 1;
        let corta = false;
        for (; k < ts.length; k++) { if (ts[k].v === '(') p++; else if (ts[k].v === ')') { p--; if (!p) break; } else if (['slice', 'substr', 'substring'].indexOf(ts[k].v) >= 0) corta = true; }
        if (corta) add('DATA', i, t.v + '(….slice)');
      }
      // NUMERO
      if (t.tipo === 'op' && ['+', '-', '*', '/', '%', '+=', '-=', '*=', '/=', '%='].indexOf(t.v) >= 0 && fimDeOperando(ts[i - 1])) {
        const esq = operando(ts, i - 1, -1);
        const dir = operando(ts, i + 1, 1);
        if (t.v === '+' || t.v === '+=') { if (TEXTO(esq) || TEXTO(dir)) continue; }
        // A paginação (o total de linhas da lista ÷ linhas por página) conta linhas, não um número do rebanho.
        if (esq.concat(dir).indexOf('por_pagina') >= 0) continue;
        const dom = esq.concat(dir).filter((x) => DOMINIO.test(x));
        if (dom.length) add('NUMERO', i, t.v + ' ' + dom.join(','));
      }
    }
  });
  return out;
}

function todosOsAchados(dir) {
  const d = dir || SRC;
  return fs.readdirSync(d).filter((f) => f.endsWith('.html')).sort().reduce((acc, f) => acc.concat(achados(f, fs.readFileSync(path.join(d, f), 'utf8'))), []);
}

module.exports = { scripts, tokens, cadeias, achados, todosOsAchados, DOMINIO };

if (require.main === module) {
  const lista = todosOsAchados();
  lista.forEach((a) => console.log(a.regra + ' ' + a.arquivo + ':' + a.linha + ' [' + a.funcoes.join('>') + '] ' + a.extra + ' :: ' + a.trecho));
  console.log(lista.length + ' achados');
}
