#!/usr/bin/env node
'use strict';
/**
 * Verificação estática da interface (npm run ui:check): confere src/*.html contra as regras do desenho que não
 * dependem de navegador:
 *  - nenhum recurso externo: sem <script src>, <link href>, <img src>, <iframe src> nem @import/url() apontando
 *    para http(s) — a decisão SP-08 trocou a biblioteca de gráficos por SVG próprio, então nada vem de CDN;
 *  - página inteira (soma dos .html) dentro do orçamento de 450 KB (01-arquitetura.md, seção 6.2).
 * Sai com código 1 se algo falhar. A verificação em navegador (Playwright, nível 3) é acrescentada pela etapa
 * que entrega as telas; ela reutiliza `conferirPaginas`.
 */
const fs = require('node:fs');
const path = require('node:path');

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

function main() {
  const paginas = lerPaginas(SRC);
  const nomes = Object.keys(paginas);
  if (!nomes.length) {
    console.log('ui:check — ainda não há páginas em src/ (nenhum .html): nada a conferir.');
    return;
  }
  const problemas = conferirPaginas(paginas);
  if (problemas.length) {
    console.error('ui:check — ' + problemas.length + ' problema(s):\n  - ' + problemas.join('\n  - '));
    process.exit(1);
  }
  console.log('ui:check — ' + nomes.length + ' arquivo(s) .html conferidos, sem recurso externo e dentro do orçamento.');
}

if (require.main === module) main();

module.exports = { conferirPaginas, lerPaginas, ORCAMENTO_BYTES };
