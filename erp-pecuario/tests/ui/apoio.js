'use strict';
/**
 * Apoio aos testes de interface (nível 3, Playwright). A página é a do doGet REAL (template Index com os includes,
 * avaliado pelo HtmlService do harness), com a meta viewport que o addMetaTag declarou e o mock de google.script.run
 * (mock-gas.js) no topo do <head>. O mock chama a função pública api() do Code.js numa execução do harness, sobre um
 * banco criado pelo próprio setup (tests/apoio-sistema.js). Servida numa origem própria (rota do Playwright), para
 * localStorage e recarga se comportarem como num site. Não é arquivo de teste.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const S = require('../apoio-sistema');

const ORIGEM = 'https://erp-pecuario.teste';
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-gas.js'), 'utf8');

function js(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

/** Sistema configurado (setup + propriedade, pastos A e B e marco zero) com `api(pedido)` = envelope em JSON simples. */
function sistema(opcoes) {
  const s = S.sistema(opcoes);
  s.api = (pedido) => js(s.gas.exec(() => s.G.api(pedido)));
  s.registrar = (dados, chave, extra) => {
    const r = s.api(Object.assign({ rota: 'evento.registrar', idempotencyKey: chave, dados }, extra || {}));
    if (!r.ok) throw new Error('semente recusada: ' + JSON.stringify(r.error));
    return r.data;
  };
  return s;
}
/** Rebanho inicial de exemplo: 0457 (fêmea, Pasto A), 0391 (fêmea, Pasto B), 12 (macho, Pasto A), um sem brinco. */
function semear(s) {
  return s.registrar({
    tipo: 'ENTRADA_INICIAL', campos: {}, animais: [
      S.bicho({ brinco: '0457', data_nascimento: '2023-02-02', data_nascimento_confianca: 'CONFIRMADA' }),
      S.bicho({ brinco: '0391', pasto_destino_id: S.PASTOS.B, data_nascimento: '2022-05-10', data_nascimento_confianca: 'ESTIMADA' }),
      S.bicho({ brinco: '12', sexo: 'M', data_nascimento: '2025-03-01', data_nascimento_confianca: 'CONFIRMADA' }),
      S.bicho({ data_nascimento: '2025-09-12', data_nascimento_confianca: 'CONFIRMADA' }),
    ],
  }, 'semente-rebanho');
}

/** HTML que o doGet devolve, com a meta viewport do addMetaTag e o mock no topo. o.params: parâmetros do doGet. */
function pagina(s, o) {
  const out = s.gas.exec(() => s.G.doGet({ parameter: (o && o.params) || {} }));
  let html = out.getContent();
  const metas = out._meta.map(([n, c]) => '<meta name="' + n + '" content="' + c + '">').join('');
  if (o && o.trocarVersao) html = html.replace(/data-app-version="[^"]*"/, 'data-app-version="' + o.trocarVersao + '"');
  return html.replace('<head>', '<head>\n' + metas + '\n<script>\n' + MOCK + '\n</script>');
}

let navegador = null;
async function browser() {
  if (!navegador) navegador = await chromium.launch();
  return navegador;
}
async function fecharBrowser() { if (navegador) { await navegador.close(); navegador = null; } }

/**
 * Abre o app. o: {largura (1280), altura, historico (true: emula google.script.history/url), semLocalStorage,
 * params (doGet), trocarVersao, fuso (do aparelho), telasDeTeste: [{padrao, modulo, titulo}], relogio (ms: instala o
 * relógio do Playwright), hash}. Devolve {ctx, page, estado: {chamadas, erros}, pedidos(rota), fechar()}.
 */
async function abrir(s, o) {
  o = o || {};
  const b = await browser();
  const largura = o.largura || 1280;
  const ctx = await b.newContext({
    viewport: { width: largura, height: o.altura || (largura < 900 ? 780 : 900) }, deviceScaleFactor: 1, locale: 'pt-BR',
    timezoneId: o.fuso || 'America/Sao_Paulo', isMobile: largura < 900, hasTouch: largura < 900,
  });
  const estado = { chamadas: [], erros: [], html: pagina(s, o) };
  await ctx.exposeFunction('__erpServidor', (json) => {
    const pedido = JSON.parse(json);
    estado.chamadas.push(pedido);
    return JSON.stringify(s.gas.exec(() => s.G.api(pedido)));
  });
  await ctx.addInitScript((cfg) => {
    window.__ERP_TESTE = { historico: cfg.historico };
    if (cfg.semLocalStorage) {
      Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { throw new DOMException('O armazenamento está bloqueado neste quadro.', 'SecurityError'); } });
    }
    if (cfg.telas && cfg.telas.length) {
      document.addEventListener('DOMContentLoaded', function () {
        cfg.telas.forEach(function (t) {
          window.Telas.registrar(t.padrao, { titulo: t.titulo, modulo: t.modulo, montar: function (el) { var h1 = document.createElement('h1'); h1.textContent = t.titulo; el.appendChild(h1); } });
        });
      });
    }
  }, { historico: o.historico !== false, semLocalStorage: !!o.semLocalStorage, telas: o.telasDeTeste || [] });
  await ctx.route(ORIGEM + '/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: estado.html }));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') estado.erros.push('console: ' + m.text()); });
  page.on('pageerror', (e) => estado.erros.push('pageerror: ' + (e && e.message)));
  page.on('dialog', async (d) => { estado.erros.push('diálogo do navegador: ' + d.message()); await d.dismiss().catch(() => {}); });
  if (o.relogio) await page.clock.install({ time: o.relogio });
  await page.goto(ORIGEM + '/app' + (o.hash ? '#/' + o.hash : ''));
  await esperarTela(page);
  return {
    ctx, page, estado,
    pedidos: (rota) => estado.chamadas.filter((p) => !rota || p.rota === rota),
    fechar: () => ctx.close(),
  };
}
/** Espera a tela montar: um h1 em #conteudo e nenhum esqueleto de carregamento. */
async function esperarTela(page, texto) {
  await page.waitForFunction((t) => {
    const c = document.getElementById('conteudo');
    const h1 = c && c.querySelector('h1');
    if (!h1 || c.querySelector('.esqueleto')) return false;
    return !t || h1.textContent.indexOf(t) >= 0;
  }, texto || null, { timeout: 10000 });
}
/**
 * Espera o servidor responder tudo o que a página pediu (mock: `__gas.emCurso` = 0): o estado, nunca um tempo fixo. Quem
 * dispara consultas assíncronas (a mudança de data, o "Incluir todos") espera isto antes de conferir a tela.
 */
async function esperarServidor(page) {
  await page.waitForFunction(() => window.__gas && window.__gas.emCurso === 0, null, { timeout: 10000 });
}
async function ir(page, rota, texto) {
  await page.evaluate((r) => window.Roteador.ir(r), rota);
  await esperarTela(page, texto);
}

/** Rolagem horizontal da página (a 360 px, nunca; a prévia de relatório é a exceção do desenho). */
async function semRolagemHorizontal(page) {
  return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
}
/**
 * Alvos de toque visíveis menores que 48 × 48 px, e pares a menos de 8 px um do outro (sem um conter o outro).
 * Caixa e rádio contam pelo rótulo que os envolve. Devolve a lista de problemas (vazia = certo).
 */
async function alvosDeToque(page, escopo) {
  return page.evaluate((sel) => {
    const raiz = sel ? document.querySelector(sel) : document;
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('[hidden], [inert]') && !el.closest('details:not([open]) > :not(summary)'); };
    const alvos = [];
    raiz.querySelectorAll('button, a[href], input, select, textarea, summary').forEach((el) => {
      let alvo = el;
      if (el.matches('input[type=checkbox], input[type=radio]')) alvo = el.closest('label');
      if (!alvo || !vis(alvo) || alvos.indexOf(alvo) >= 0) return;
      if (alvo.classList.contains('pular') && document.activeElement !== alvo) return;
      alvos.push(alvo);
    });
    const preso = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed' || p === 'sticky') return e; } return null; };
    const desc = (el) => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' "' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30) + '"');
    const problemas = [];
    const rects = alvos.map((el) => el.getBoundingClientRect());
    alvos.forEach((el, i) => { const r = rects[i]; if (r.width < 47.5 || r.height < 47.5) problemas.push('pequeno ' + Math.round(r.width) + '×' + Math.round(r.height) + ': ' + desc(el)); });
    for (let i = 0; i < alvos.length; i++) {
      for (let j = i + 1; j < alvos.length; j++) {
        if (alvos[i].contains(alvos[j]) || alvos[j].contains(alvos[i])) continue;
        // Barra fixa (topo, barra inferior) sobre conteúdo que rola por baixo não é colisão de alvos.
        if (preso(alvos[i]) !== preso(alvos[j])) continue;
        const a = rects[i], b = rects[j];
        const sobV = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        const sobH = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        if (sobV > 0 && sobH > 0) { problemas.push('sobrepostos: ' + desc(alvos[i]) + ' × ' + desc(alvos[j])); continue; }
        const gapH = Math.max(a.left, b.left) - Math.min(a.right, b.right);
        const gapV = Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom);
        if (sobV > 0 && gapH < 7.5) problemas.push('sem respiro (' + Math.round(gapH) + ' px): ' + desc(alvos[i]) + ' × ' + desc(alvos[j]));
        else if (sobH > 0 && gapV < 7.5) problemas.push('sem respiro (' + Math.round(gapV) + ' px): ' + desc(alvos[i]) + ' × ' + desc(alvos[j]));
      }
    }
    return problemas;
  }, escopo || null);
}
/** Estilo de foco do elemento focado (ou do rótulo de rádio/caixa). */
async function focoVisivel(page) {
  return page.evaluate(() => {
    let el = document.activeElement;
    if (!el || el === document.body) return { ok: false, motivo: 'nada focado' };
    if (el.matches('input[type=radio], input[type=checkbox]') && el.closest('label.opcao, label.marca')) el = el.closest('label');
    const cs = getComputedStyle(el);
    const largura = parseFloat(cs.outlineWidth) || 0;
    return { ok: cs.outlineStyle !== 'none' && largura >= 2, outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, alvo: el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '') };
  });
}

module.exports = { ORIGEM, S, js, sistema, semear, pagina, browser, fecharBrowser, abrir, esperarTela, esperarServidor, ir, semRolagemHorizontal, alvosDeToque, focoVisivel };
