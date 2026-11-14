#!/usr/bin/env node
'use strict';
/**
 * Verificação da interface (npm run ui:check), em duas partes:
 *  1. Estática, sem navegador: src/*.html contra as regras do desenho — nenhum recurso externo (<script src>,
 *     <link href>, <img src>, <iframe src>, @import/url() para http(s): a decisão SP-08 trocou a biblioteca de
 *     gráficos por SVG próprio, então nada vem de CDN) e página dentro do orçamento de 450 KB (01-arquitetura.md,
 *     seção 6.2), conferida também na página MONTADA pelo doGet real (template Index com os includes).
 *  2. Nível 3, Playwright: `node --test tests/ui/*.test.js` (a SPA do doGet real conversando com o backend real do
 *     harness por um mock de google.script.run). `--so-estatica` pula esta parte.
 * Sai com código 1 se algo falhar.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SRC = path.join(__dirname, '..', 'src');
const ORCAMENTO_BYTES = 450 * 1024;
const EXTERNOS = [
  { re: /<script\b[^>]*\bsrc\s*=/i, o_que: '<script src> (todo script é embutido)' },
  { re: /<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i, o_que: '<link> para recurso externo' },
  { re: /<(?:img|iframe|video|audio|source|embed|object)\b[^>]*\b(?:src|data)\s*=\s*["']?\s*(?:https?:)?\/\//i, o_que: 'mídia ou quadro de origem externa' },
  { re: /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i, o_que: '@import de folha externa' },
  { re: /url\(\s*["']?\s*(?:https?:)?\/\//i, o_que: 'url() externa no CSS' },
];

/** Confere um conjunto {nomeDoArquivo: conteúdo}. Devolve a lista de problemas (vazia = certo). */
function conferirPaginas(arquivos) {
  const problemas = [];
  let total = 0;
  Object.keys(arquivos).sort().forEach((nome) => {
    const html = arquivos[nome];
    total += Buffer.byteLength(html, 'utf8');
    EXTERNOS.forEach((regra) => { if (regra.re.test(html)) problemas.push(nome + ': ' + regra.o_que); });
  });
  if (total > ORCAMENTO_BYTES) problemas.push('a página soma ' + Math.round(total / 1024) + ' KB; o orçamento é de ' + ORCAMENTO_BYTES / 1024 + ' KB');
  return problemas;
}

function lerPaginas(dir) {
  const out = {};
  fs.readdirSync(dir).filter((f) => f.endsWith('.html')).forEach((f) => { out[f] = fs.readFileSync(path.join(dir, f), 'utf8'); });
  return out;
}

/** A página que o doGet devolve (template Index avaliado, com os includes), pelo harness. */
function paginaMontada() {
  const S = require('../tests/apoio-sistema');
  const s = S.sistema({ semCadastro: true });
  return s.gas.exec(() => s.G.doGet({ parameter: {} })).getContent();
}

function main() {
  const paginas = lerPaginas(SRC);
  const nomes = Object.keys(paginas);
  if (!nomes.length) {
    console.log('ui:check — ainda não há páginas em src/ (nenhum .html): nada a conferir.');
    return;
  }
  const problemas = conferirPaginas(paginas);
  if (paginas['Index.html']) {
    const montada = paginaMontada();
    if (/<\?/.test(montada)) problemas.push('a página montada pelo doGet ainda tem scriptlet (<? ... ?>) sem avaliar');
    conferirPaginas({ 'página montada': montada }).forEach((p) => problemas.push(p));
  }
  if (problemas.length) {
    console.error('ui:check — ' + problemas.length + ' problema(s):\n  - ' + problemas.join('\n  - '));
    process.exit(1);
  }
  console.log('ui:check — ' + nomes.length + ' arquivo(s) .html conferidos (e a página montada pelo doGet), sem recurso externo e dentro do orçamento.');
  if (process.argv.indexOf('--so-estatica') >= 0) return;
  const dir = path.join(__dirname, '..', 'tests', 'ui');
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(dir, f));
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1'].concat(arquivos), { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

if (require.main === module) main();

module.exports = { conferirPaginas, lerPaginas, ORCAMENTO_BYTES };
