#!/usr/bin/env node
'use strict';
/**
 * Verificação da interface (npm run ui:check), em duas partes:
 *  1. Estática, sem navegador: src/*.html contra as regras do desenho — nenhum recurso externo (<script src>,
 *     <link href>, <img src>, <iframe src>, @import/url() para http(s): a decisão SP-08 trocou a biblioteca de
 *     gráficos por SVG próprio, então nada vem de CDN), conferido no fonte inteiro (comentários incluídos) e no que vai
 *     ao aparelho; a página INICIAL dentro do orçamento de 450 KB (01-arquitetura.md, seção 6.2), medida na página
 *     MONTADA pelo doGet real (template Index com os includes compactados), sem nenhuma tela sob demanda dentro; e cada
 *     tela sob demanda (as das Fases 3 a 5 e a importação; risco R-31) dentro do orçamento de 150 KB por módulo, medida
 *     como a rota sistema.tela a entrega (Api.compactar).
 *  2. Nível 3, Playwright: `node --test tests/ui/*.test.js` (a SPA do doGet real conversando com o backend real do
 *     harness por um mock de google.script.run). `--so-estatica` pula esta parte.
 * Sai com código 1 se algo falhar.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SRC = path.join(__dirname, '..', 'src');
const ORCAMENTO_BYTES = 450 * 1024;
/** Orçamento de cada tela carregada sob demanda (rota sistema.tela): um módulo das Fases 3 a 5 ou a importação. */
const ORCAMENTO_MODULO_BYTES = 150 * 1024;
const EXTERNOS = [
  { re: /<script\b[^>]*\bsrc\s*=/i, o_que: '<script src> (todo script é embutido)' },
  { re: /<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i, o_que: '<link> para recurso externo' },
  { re: /<(?:img|iframe|video|audio|source|embed|object)\b[^>]*\b(?:src|data)\s*=\s*["']?\s*(?:https?:)?\/\//i, o_que: 'mídia ou quadro de origem externa' },
  { re: /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i, o_que: '@import de folha externa' },
  { re: /url\(\s*["']?\s*(?:https?:)?\/\//i, o_que: 'url() externa no CSS' },
];

/**
 * Confere um conjunto {nomeDoArquivo: conteúdo}: recurso externo em `arquivos` e o orçamento sobre `medidos` (o que vai
 * ao aparelho; padrão: os próprios arquivos). Devolve a lista de problemas (vazia = certo).
 */
function conferirPaginas(arquivos, medidos) {
  const problemas = [];
  let total = 0;
  Object.keys(arquivos).sort().forEach((nome) => {
    const html = arquivos[nome];
    EXTERNOS.forEach((regra) => { if (regra.re.test(html)) problemas.push(nome + ': ' + regra.o_que); });
  });
  const m = medidos || arquivos;
  Object.keys(m).forEach((nome) => { total += Buffer.byteLength(m[nome], 'utf8'); });
  if (total > ORCAMENTO_BYTES) problemas.push('a página soma ' + Math.round(total / 1024) + ' KB; o orçamento é de ' + ORCAMENTO_BYTES / 1024 + ' KB');
  return problemas;
}

function lerPaginas(dir) {
  const out = {};
  fs.readdirSync(dir).filter((f) => f.endsWith('.html')).forEach((f) => { out[f] = fs.readFileSync(path.join(dir, f), 'utf8'); });
  return out;
}

/** Cada arquivo como vai ao aparelho: o template Index como está; os includes compactados pelo Api.compactar do doGet. */
function servidas(paginas) {
  const { createGas } = require('../tests/harness');
  const G = createGas({ order: 'alpha' }).G;
  const out = {};
  Object.keys(paginas).forEach((n) => { out[n] = n === 'Index.html' ? paginas[n] : G.Api.compactar(paginas[n]); });
  return out;
}
/** Sistema do harness (setup feito) para o doGet e a rota sistema.tela reais. */
let sis = null;
function sistema() {
  if (!sis) sis = require('../tests/apoio-sistema').sistema({ semCadastro: true });
  return sis;
}
/** A página que o doGet devolve (template Index avaliado, com os includes), pelo harness. */
function paginaMontada() {
  const s = sistema();
  return s.gas.exec(() => s.G.doGet({ parameter: {} })).getContent();
}
/**
 * As telas sob demanda (Api.TELAS_SOB_DEMANDA) que existem em src/: o tamanho como vão ao aparelho e os problemas — fora do
 * orçamento por módulo, incluída na página inicial (`montada`), recurso externo, ou módulo entregue que a rota sistema.tela
 * não serve igual ao arquivo compactado. Devolve {modulos: [{nome, bytes, entregue}], problemas}.
 */
function conferirModulos(paginas, montada) {
  const s = sistema();
  const problemas = [];
  const modulos = [];
  const index = paginas['Index.html'] || '';
  Object.keys(s.G.Api.TELAS_SOB_DEMANDA).forEach((nome) => {
    const arquivo = nome + '.html';
    if (new RegExp("include_\\('" + nome + "'\\)").test(index)) problemas.push(arquivo + ': é tela sob demanda e não pode entrar na página inicial (Index)');
    if (!paginas[arquivo]) return;
    const servida = s.G.Api.compactar(paginas[arquivo]);
    if (montada && montada.indexOf(servida) >= 0) problemas.push(arquivo + ': a página inicial traz a tela sob demanda');
    const r = JSON.parse(JSON.stringify(s.gas.exec(() => s.G.api({ rota: 'sistema.tela', dados: { nome } }))));
    const entregue = r.ok;
    if (entregue && r.data.conteudo !== servida) problemas.push(arquivo + ': a rota sistema.tela não entrega o arquivo compactado');
    const bytes = Buffer.byteLength(servida, 'utf8');
    if (bytes > ORCAMENTO_MODULO_BYTES) problemas.push(arquivo + ': a tela sob demanda soma ' + Math.round(bytes / 1024) + ' KB; o orçamento por módulo é de ' + ORCAMENTO_MODULO_BYTES / 1024 + ' KB');
    conferirPaginas({ [arquivo + ' (servida)']: servida }, {}).forEach((p) => problemas.push(p));
    modulos.push({ nome, bytes, entregue });
  });
  return { modulos, problemas };
}

function main() {
  const paginas = lerPaginas(SRC);
  const nomes = Object.keys(paginas);
  if (!nomes.length) {
    console.log('ui:check — ainda não há páginas em src/ (nenhum .html): nada a conferir.');
    return;
  }
  // Recurso externo no fonte e no que vai ao aparelho; o orçamento é o da página inicial e o de cada módulo, abaixo.
  const problemas = conferirPaginas(paginas, {}).concat(conferirPaginas(servidas(paginas), {}));
  let tamanho = '';
  if (paginas['Index.html']) {
    const montada = paginaMontada();
    tamanho = ' (página inicial montada: ' + Math.round(Buffer.byteLength(montada, 'utf8') / 1024) + ' KB de ' + ORCAMENTO_BYTES / 1024 + ' KB';
    if (/<\?/.test(montada)) problemas.push('a página montada pelo doGet ainda tem scriptlet (<? ... ?>) sem avaliar');
    conferirPaginas({ 'página montada': montada }).forEach((p) => problemas.push(p));
    const mods = conferirModulos(paginas, montada);
    mods.problemas.forEach((p) => problemas.push(p));
    tamanho += mods.modulos.length ? '; sob demanda: ' + mods.modulos.map((m) => m.nome + ' ' + Math.round(m.bytes / 1024) + ' KB' + (m.entregue ? '' : ' (módulo ainda não entregue)')).join(', ') + ', de ' + ORCAMENTO_MODULO_BYTES / 1024 + ' KB cada)' : ')';
  }
  if (problemas.length) {
    console.error('ui:check — ' + problemas.length + ' problema(s):\n  - ' + problemas.join('\n  - '));
    process.exit(1);
  }
  console.log('ui:check — ' + nomes.length + ' arquivo(s) .html conferidos (a página inicial montada pelo doGet e as telas sob demanda), sem recurso externo e dentro do orçamento' + tamanho + '.');
  if (process.argv.indexOf('--so-estatica') >= 0) return;
  const dir = path.join(__dirname, '..', 'tests', 'ui');
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(dir, f));
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1'].concat(arquivos), { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

if (require.main === module) main();

module.exports = { conferirPaginas, conferirModulos, lerPaginas, servidas, paginaMontada, ORCAMENTO_BYTES, ORCAMENTO_MODULO_BYTES };
