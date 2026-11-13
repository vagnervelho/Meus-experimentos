#!/usr/bin/env node
'use strict';
/**
 * Verificação da interface (npm run ui:check).
 *
 * Monta uma página estática a partir de src/index.html (resolvendo <?!= include('x'); ?>),
 * injeta tests/ui/fixtures.js + tests/ui/mock-gas.js antes do cliente e abre no Chromium (Playwright).
 * Percorre todas as telas em 390×844 e 1366×900, nos esquemas claro e escuro, e verifica:
 *  - sem erros de console/pageerror e sem diálogos (alert/confirm);
 *  - sem rolagem horizontal;
 *  - axe-core sem violações serious/critical;
 *  - nenhum <img>/<script>/<iframe>… criado a partir das fixtures maliciosas;
 *  - fluxos: feedback (payloads), consentimento de IA, teclado, busca, configurações, variantes.
 * Screenshots em artifacts/ui/. Sai com código ≠ 0 se algo falhar.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { checkFiles, selfTest } = require('../tests/ui/static-rules');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'artifacts', 'ui');
const AXE = require.resolve('axe-core');
const SCREENS = ['radar', 'caixa', 'tarefas', 'carreira', 'noticias', 'remetentes', 'busca', 'sistema', 'config'];
const VIEWPORTS = [{ name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true }, { name: 'desktop', width: 1366, height: 900 }];
const SCHEMES = ['light', 'dark'];
const ONLY = process.env.UI_ONLY || '';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  if (!ok) console.log('  ✗ ' + name + (detail ? ' — ' + String(detail).slice(0, 600) : ''));
  return !!ok;
}
function deepEqual(a, b) { return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b)); }
function sortKeys(v) { if (Array.isArray(v)) return v.map(sortKeys); if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = sortKeys(v[k]); }); return o; } return v; }

// ------------------------------------------------------------- página ----
function buildPage() {
  let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const fixtures = fs.readFileSync(path.join(ROOT, 'tests', 'ui', 'fixtures.js'), 'utf8');
  const mock = fs.readFileSync(path.join(ROOT, 'tests', 'ui', 'mock-gas.js'), 'utf8');
  const injected = '<script>\n' + fixtures + '\n</script>\n<script>\n' + mock + '\n</script>\n';
  let includes = 0;
  html = html.replace(/<\?!=\s*include\('([a-z0-9_-]+)'\);\s*\?>/g, (m, name) => {
    includes++;
    const file = path.join(SRC, name + '.html');
    if (!fs.existsSync(file)) throw new Error('include inexistente: ' + name);
    return (name === 'client' ? injected : '') + fs.readFileSync(file, 'utf8');
  });
  if (/<\?/.test(html)) throw new Error('scriptlet não resolvido na página montada');
  // O servidor adiciona a meta viewport via HtmlOutput.addMetaTag; aqui emulamos.
  html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">');
  fs.mkdirSync(path.join(OUT, 'build'), { recursive: true });
  const file = path.join(OUT, 'build', 'index.html');
  fs.writeFileSync(file, html);
  check('página montada resolve os includes de src/index.html', includes === 2, includes + ' includes');
  return 'file://' + file;
}

// Executa antes de qualquer script da página: vigia elementos perigosos criados em tempo de execução.
function initScript() {
  window.__bad = [];
  window.__dialogs = 0;
  let parsed = false;
  document.addEventListener('DOMContentLoaded', () => { parsed = true; });
  const DANGER = /^(IMG|IFRAME|OBJECT|EMBED|FRAME|BASE|LINK|AUDIO|VIDEO|SOURCE|PICTURE|IMAGE)$/;
  function inspect(el) {
    if (!el || el.nodeType !== 1) return;
    const tag = el.tagName.toUpperCase();
    if (DANGER.test(tag) || (tag === 'SCRIPT' && parsed && !window.__allowScript) || (tag === 'STYLE' && parsed)) window.__bad.push(tag + ' criado');
    for (const n of el.getAttributeNames()) {
      if (/^on/i.test(n)) window.__bad.push('atributo ' + n + ' em ' + tag);
      if (/^(src|srcdoc|formaction|action|xlink:href)$/i.test(n)) window.__bad.push('atributo ' + n + ' em ' + tag);
      if (n === 'href' && /^\s*(javascript|data|vbscript):/i.test(el.getAttribute(n))) window.__bad.push('href perigoso em ' + tag);
    }
    if (el.querySelectorAll) el.querySelectorAll('*').forEach(inspect);
  }
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'attributes') inspect(m.target);
      else m.addedNodes.forEach(inspect);
    }
  }).observe(document, { childList: true, subtree: true, attributes: true });
}

async function newPage(browser, vp, scheme) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, colorScheme: scheme, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.__errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => page.__errors.push('pageerror: ' + (e && e.message)));
  page.on('dialog', async (d) => { page.__errors.push('dialog ' + d.type() + ': ' + d.message()); await d.dismiss().catch(() => {}); });
  return { ctx, page };
}

async function waitView(page, route, timeout) {
  await page.waitForFunction((r) => {
    const v = document.getElementById('view');
    if (!v || v.getAttribute('data-route') !== r) return false;
    if (!v.querySelector('[data-state]') && v.getAttribute('data-state') === null) return false;
    return !v.querySelector('[data-state="loading"]');
  }, route, { timeout: timeout || 8000 });
  await page.waitForTimeout(60);
}
async function waitDialog(page) {
  await page.waitForFunction(() => { const d = document.querySelector('.dlg.drawer .dlg-b'); return d && d.getAttribute('data-state') && d.getAttribute('data-state') !== 'loading'; }, null, { timeout: 8000 });
  await page.waitForTimeout(60);
}
async function go(page, hash) { await page.evaluate((h) => { location.hash = h; }, hash); }
async function calls(page, name) { return page.evaluate((n) => window.__calls.filter((c) => !n || c.name === n), name); }
async function lastCall(page, name) { const c = await calls(page, name); return c[c.length - 1]; }
async function waitCall(page, name, count) {
  await page.waitForFunction(([n, k]) => window.__calls.filter((c) => c.name === n).length >= k, [name, count], { timeout: 5000 }).catch(() => {});
}

async function axe(page, label) {
  if (!(await page.evaluate(() => !!window.axe))) {
    await page.evaluate(() => { window.__allowScript = true; });
    await page.addScriptTag({ path: AXE });
    await page.waitForTimeout(20);
    await page.evaluate(() => { window.__allowScript = false; });
  }
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes.slice(0, 3).map((x) => x.target.join(' ') + (x.failureSummary ? ' :: ' + x.failureSummary.replace(/\s+/g, ' ').slice(0, 160) : '')) }));
  });
  check('axe sem serious/critical: ' + label, res.length === 0, JSON.stringify(res));
}
async function overflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
  check('sem rolagem horizontal: ' + label, o.sw <= o.cw && o.bw <= o.cw, JSON.stringify(o));
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
}
// Para revisão visual: expande o painel (que rola por dentro) para caber no screenshot de página inteira.
async function shotDrawer(page, name) {
  await page.evaluate(() => { const d = document.querySelector('.dlg.drawer'); Object.assign(d.style, { position: 'absolute', bottom: 'auto', minHeight: '100vh', maxHeight: 'none' }); d.querySelector('.dlg-b').style.overflow = 'visible'; });
  await shot(page, name);
  await page.evaluate(() => { const d = document.querySelector('.dlg.drawer'); d.removeAttribute('style'); d.querySelector('.dlg-b').removeAttribute('style'); });
}
async function pageClean(page, label) {
  const st = await page.evaluate(() => ({ bad: window.__bad.slice(0, 10), xss: window.__xss, scripts: document.scripts.length, imgs: document.images.length, viol: window.__violations }));
  check('nenhum elemento perigoso criado: ' + label, st.bad.length === 0 && st.xss === undefined && st.imgs === 0 && st.scripts <= 4, JSON.stringify(st));
  check('google.script.run recebeu só valores simples: ' + label, !st.viol.length, JSON.stringify(st.viol));
  check('sem erros de console/diálogos: ' + label, page.__errors.length === 0, page.__errors.slice(0, 5).join(' | '));
  page.__errors.length = 0;
}

// ------------------------------------------------------ varredura de telas ----
async function sweep(browser, url, vp, scheme) {
  const tag = scheme + '-' + vp.name;
  const { ctx, page } = await newPage(browser, vp, scheme);
  await page.goto(url + '#/radar');
  await waitView(page, 'radar');
  for (const s of SCREENS) {
    await go(page, '#/' + s);
    await waitView(page, s);
    const label = tag + ' ' + s;
    await overflow(page, label);
    await axe(page, label);
    await shot(page, tag + '-' + s);
  }
  for (const id of ['m01', 'm06']) {
    await go(page, '#/caixa?m=' + id);
    await waitDialog(page);
    const label = tag + ' detalhe ' + id;
    await overflow(page, label);
    await axe(page, label);
    await shotDrawer(page, tag + '-detalhe-' + id);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.dlg'), null, { timeout: 3000 }).catch(() => {});
    check('Esc fecha o detalhe: ' + label, await page.evaluate(() => !document.querySelector('.dlg')));
  }
  if (vp.isMobile) {
    await page.click('#tabbar button.tab');
    await page.waitForSelector('.dlg.sheet');
    await axe(page, tag + ' menu Mais');
    await shot(page, tag + '-menu-mais');
    await page.click('.dlg.sheet a[data-nav="sistema"]');
    await waitView(page, 'sistema');
    check('menu Mais navega e fecha: ' + tag, await page.evaluate(() => !document.querySelector('.dlg.sheet') && location.hash === '#/sistema'));
  }
  await pageClean(page, tag);
  await ctx.close();
}

// -------------------------------------------------------------- fluxos ----
async function flows(browser, url) {
  const vp = VIEWPORTS[1];
  const { ctx, page } = await newPage(browser, vp, 'light');
  await page.goto(url + '#/caixa');
  await waitView(page, 'caixa');
  const fx = await page.evaluate(() => ({ tasks: window.__FIXTURES.TASKS, opps: window.__FIXTURES.OPPS }));

  // conteúdo malicioso vira texto
  const txt = await page.evaluate(() => document.getElementById('view').innerText);
  check('assunto com <img onerror> aparece como texto literal', txt.includes('<img src=x onerror="window.__xss=1;alert(1)">Fatura de outubro'));
  check('item com injection ganha aviso', txt.includes('Conteúdo com instruções suspeitas — tratado como texto'));
  check('bootstrap seguido de apiMarkVisit', (await calls(page, 'apiMarkVisit')).length === 1 && (await calls(page))[0].name === 'apiBootstrap');
  const lm = await lastCall(page, 'apiListMessages');
  check('apiListMessages recebe filtros/sort/página do contrato', lm && deepEqual(Object.keys(lm.req).sort(), ['filters', 'page', 'pageSize', 'sort']) && deepEqual(Object.keys(lm.req.filters).sort(), ['action', 'categories', 'deadline', 'levels', 'period', 'sender', 'status', 'unread']) && lm.req.page === 1 && lm.req.pageSize === 10, JSON.stringify(lm && lm.req));

  // feedback: Irrelevante no primeiro item
  const first = await page.getAttribute('#view article.item >> nth=0', 'data-item-id');
  await page.click('#view article.item >> nth=0 >> [data-fb="IRRELEVANT"]');
  await waitCall(page, 'apiSubmitFeedback', 1);
  let fb = await lastCall(page, 'apiSubmitFeedback');
  check('feedback Irrelevante envia o payload do contrato', fb && deepEqual(fb.req, { targetType: 'MESSAGE', targetId: first, type: 'IRRELEVANT', payload: {} }), JSON.stringify(fb && fb.req));
  await page.waitForSelector('.toast');
  check('toast avisa "aplicado na próxima sincronização"', (await page.textContent('#toasts')).includes('Aplicado na próxima sincronização'));
  check('atualização otimista marca o botão', (await page.getAttribute('#view article.item >> nth=0 >> [data-fb="IRRELEVANT"]', 'aria-pressed')) === 'true');
  check('foco volta ao botão após re-render', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-fb') === 'IRRELEVANT'));

  // categoria errada → seletor
  const second = await page.getAttribute('#view article.item >> nth=1', 'data-item-id');
  await page.click('#view article.item >> nth=1 >> [data-fb="MISCLASSIFIED"]');
  check('Categoria errada abre seletor com aria-expanded', (await page.getAttribute('#view article.item >> nth=1 >> [data-fb="MISCLASSIFIED"]', 'aria-expanded')) === 'true');
  await page.selectOption('#view article.item >> nth=1 >> select', 'financas');
  await page.click('#view article.item >> nth=1 >> [data-fb="MISCLASSIFIED-OK"]');
  await waitCall(page, 'apiSubmitFeedback', 2);
  fb = await lastCall(page, 'apiSubmitFeedback');
  check('Categoria errada envia correctCategory', fb && deepEqual(fb.req, { targetType: 'MESSAGE', targetId: second, type: 'MISCLASSIFIED', payload: { correctCategory: 'financas' } }), JSON.stringify(fb && fb.req));
  check('categoria corrigida aparece no item', (await page.textContent('#view article.item >> nth=1')).includes('Finanças e investimentos'));
  await page.waitForFunction(() => document.getElementById('toasts').textContent.includes('Categoria corrigida'), null, { timeout: 3000 }).catch(() => {});

  // falha no envio → reverte e oferece "Tentar de novo"
  await page.evaluate(() => { window.__mockFailNext = 'apiSubmitFeedback'; document.getElementById('toasts').textContent = ''; });
  const third = await page.getAttribute('#view article.item >> nth=2', 'data-item-id');
  await page.click('#view article.item >> nth=2 >> [data-fb="SAVED"]');
  await page.waitForSelector('.toast.t-err', { timeout: 4000 }).catch(() => {});
  check('falha no feedback mostra erro com "Tentar de novo"', (await page.textContent('#toasts')).includes('Tentar de novo'));
  check('falha no feedback reverte o estado otimista', (await page.getAttribute(`#view article.item[data-item-id="${third}"] [data-fb="SAVED"]`, 'aria-pressed')) === 'false');
  await page.click('.toast.t-err button:has-text("Tentar de novo")');
  await waitCall(page, 'apiSubmitFeedback', 4);
  fb = await lastCall(page, 'apiSubmitFeedback');
  check('"Tentar de novo" reenvia o feedback', fb && fb.req.type === 'SAVED' && fb.req.targetId === third, JSON.stringify(fb && fb.req));
  await page.waitForTimeout(150);
  check('reenvio bem-sucedido marca o botão', (await page.getAttribute(`#view article.item[data-item-id="${third}"] [data-fb="SAVED"]`, 'aria-pressed')) === 'true');

  // filtros e paginação
  await page.click('#view .lv-toggles button:has-text("Alta")');
  await page.waitForTimeout(150);
  let lmc = await lastCall(page, 'apiListMessages');
  check('filtro de nível envia levels=[HIGH] e volta à página 1', lmc && deepEqual(lmc.req.filters.levels, ['HIGH']) && lmc.req.page === 1, JSON.stringify(lmc && lmc.req));
  await page.click('#view .lv-toggles button:has-text("Alta")');
  await waitView(page, 'caixa');
  await page.click('#view .pager button:has-text("Próxima")');
  await page.waitForTimeout(150);
  lmc = await lastCall(page, 'apiListMessages');
  check('paginação pede a página 2', lmc && lmc.req.page === 2, JSON.stringify(lmc && lmc.req));
  await waitView(page, 'caixa');

  // detalhe: feedback dentro do painel e links seguros
  await go(page, '#/caixa?m=m06');
  await waitDialog(page);
  const links = await page.evaluate(() => Array.from(document.querySelectorAll('.dlg a[href]')).map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel })));
  check('links do detalhe: só http(s) com target=_blank e rel=noopener noreferrer', links.length > 0 && links.every((l) => /^https?:\/\//.test(l.href) && l.target === '_blank' && l.rel === 'noopener noreferrer'), JSON.stringify(links));
  check('gmailUrl javascript: é descartado e "Buscar no Gmail" fica', !links.some((l) => /javascript/i.test(l.href)) && links.some((l) => l.href.startsWith('https://mail.google.com/')), JSON.stringify(links));
  const dtext = await page.textContent('.dlg');
  check('detalhe sinaliza link não seguro omitido e domínio divergente', dtext.includes('Link omitido') && dtext.includes('mas o link leva a loja.example'));
  check('credenciais embutidas em URL são recusadas', !links.some((l) => l.href.includes('@')));
  await page.keyboard.press('Escape');
  await go(page, '#/caixa?m=m07');
  await waitDialog(page);
  check('assunto com <script> aparece como texto literal', (await page.textContent('.dlg .dlg-t')).includes('<script>window.__xss=2;alert(2)</script>Ofertas'));
  check('gmailUrl de domínio parecido é recusado', await page.evaluate(() => !document.querySelector('.dlg a[href*="evil"]') && document.querySelector('.dlg').textContent.includes('Link do Gmail indisponível')));
  await page.keyboard.press('Escape');
  await go(page, '#/caixa?m=m02');
  await waitDialog(page);
  check('excerpt null mostra "trecho expirado pela política de retenção"', (await page.textContent('.dlg')).includes('Trecho expirado pela política de retenção'));
  await page.keyboard.press('Escape');
  await go(page, '#/caixa?m=m05');
  await waitDialog(page);
  const t5 = await page.textContent('.dlg');
  check('authFail: aviso e links desativados', t5.includes('Falha de autenticação do remetente') && t5.includes('link desativado') && !(await page.evaluate(() => !!document.querySelector('.dlg .links a'))));
  await page.keyboard.press('Escape');
  await go(page, '#/caixa?m=m01');
  await waitDialog(page);
  const t1 = await page.textContent('.dlg');
  check('detalhe mostra componentes, fidelidade, método e prazo explícito', t1.includes('Por que essa prioridade?') && t1.includes('Evidências verificadas') && t1.includes('4 de 4') && t1.includes('claude-opus-5-5') && t1.includes('Explícito') && t1.includes('pts'));
  const before = (await calls(page, 'apiSubmitFeedback')).length;
  await page.click('.dlg [data-fb-for] [data-fb="RESOLVED"]');
  await waitCall(page, 'apiSubmitFeedback', before + 1);
  fb = await lastCall(page, 'apiSubmitFeedback');
  check('feedback no detalhe (Resolvida) envia o payload certo', fb && deepEqual(fb.req, { targetType: 'MESSAGE', targetId: 'm01', type: 'RESOLVED', payload: {} }), JSON.stringify(fb && fb.req));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  // tarefas
  await go(page, '#/tarefas');
  await waitView(page, 'tarefas');
  const tid = await page.getAttribute('#view li[data-task-id] >> nth=0', 'data-task-id');
  const task = fx.tasks.find((t) => t.id === tid);
  await page.click('#view li[data-task-id] >> nth=0 >> [data-task="RESOLVED"]');
  await waitCall(page, 'apiSubmitFeedback', before + 2);
  fb = await lastCall(page, 'apiSubmitFeedback');
  check('Resolver tarefa envia ACTION com targetId e messageId', task && fb && deepEqual(fb.req, { targetType: 'ACTION', targetId: tid, messageId: task.messageId, type: 'RESOLVED', payload: {} }), JSON.stringify(fb && fb.req));
  check('tarefa resolvida mostra "Reabrir"', (await page.textContent(`#view li[data-task-id="${tid}"]`)).includes('Reabrir'));
  await page.click('#view .seg button:has-text("Concluídas")');
  await waitView(page, 'tarefas');
  check('aba Concluídas pede status DONE e explica status automáticos (statusLabel)', (await lastCall(page, 'apiListTasks')).req.status === 'DONE' && (await page.textContent('#view')).includes('Concluída: você respondeu na conversa. Você pode reabrir.'));

  // carreira
  await go(page, '#/carreira');
  await waitView(page, 'carreira');
  await page.click('#view [data-opp] >> nth=0 >> [data-opp-act="SAVED"]');
  await waitCall(page, 'apiSubmitFeedback', before + 3);
  fb = await lastCall(page, 'apiSubmitFeedback');
  check('Salvar oportunidade envia OPPORTUNITY com a chave', fb && deepEqual(fb.req, { targetType: 'OPPORTUNITY', targetId: fx.opps[0].key, type: 'SAVED', payload: {} }), JSON.stringify(fb && fb.req));
  check('remuneração aparece literal', (await page.textContent('#view')).includes('“R$ 18.000 a R$ 22.000 (CLT)”'));

  // radar: período e refs do briefing
  await go(page, '#/radar');
  await waitView(page, 'radar');
  await page.click('#view .seg button:has-text("30 dias")');
  await waitView(page, 'radar');
  check('seletor de período chama apiGetRadar com 30d', (await lastCall(page, 'apiGetRadar')).req.period === '30d');
  const rtext = await page.textContent('#view');
  check('triagem estimada mostra faixa e fórmula', rtext.includes('10–30') && rtext.includes('Fórmula:') && rtext.includes('não uma medição'));
  check('briefing indica método', rtext.includes('Gerado por IA'));
  await page.click('#view .brief a.ref >> nth=0');
  await waitDialog(page);
  check('ref do briefing abre o detalhe', (await page.textContent('.dlg .dlg-t')).includes('Proposta: Cientista de Dados'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('fechar detalhe volta ao Radar com o período', await page.evaluate(() => location.hash === '#/radar?p=30d' && !document.querySelector('.dlg')), await page.evaluate(() => location.hash));

  // sincronizar agora
  await page.click('#sync-box button');
  await waitCall(page, 'apiRunSyncNow', 1);
  check('Sincronizar agora chama apiRunSyncNow', (await calls(page, 'apiRunSyncNow')).length === 1);

  // busca
  await go(page, '#/busca');
  await waitView(page, 'busca');
  await page.fill('#q', 'pricing');
  await page.press('#q', 'Enter');
  await waitView(page, 'busca');
  const sc = await lastCall(page, 'apiSearch');
  check('busca envia {q, page}', sc && deepEqual(sc.req, { q: 'pricing', page: 1 }), JSON.stringify(sc && sc.req));
  check('busca destaca termos com <mark>', (await page.locator('#view mark').count()) > 0);
  await page.click('#view .chips button:has-text("categoria:carreira")');
  check('dica de operador insere no campo', (await page.inputValue('#q')).includes('categoria:'));

  // sistema + avaliação cega
  await go(page, '#/sistema');
  await waitView(page, 'sistema');
  const stext = await page.textContent('#view');
  check('Sistema destaca tabela que expira em menos de 10 dias', stext.includes('7 dias') && (await page.locator('#view tr.hl').count()) >= 1);
  check('Sistema agrega erros por código', stext.includes('UPSTREAM ×2'));
  check('Sistema traduz status/contagens de execução do servidor', stext.includes('sob demanda') && stext.includes('4 com IA') && stext.includes('Custo por mil e-mails'));
  await page.click('#view button:has-text("Carregar amostra")');
  await page.waitForSelector('#view [data-fb="Q-SHOULD_BE_HIGHER"]');
  check('amostra cega não mostra o nível', (await page.locator('#view [data-fb="Q-OK"] >> xpath=ancestor::article//*[contains(@class,"lv-")]').count()) === 0);
  const qid = await page.getAttribute('#view article.item:has([data-fb="Q-OK"]) >> nth=0', 'data-item-id');
  const nfb = (await calls(page, 'apiSubmitFeedback')).length;
  await page.click('#view article.item:has([data-fb="Q-OK"]) >> nth=0 >> [data-fb="Q-SHOULD_BE_HIGHER"]');
  await waitCall(page, 'apiSubmitFeedback', nfb + 1);
  fb = await lastCall(page, 'apiSubmitFeedback');
  check('avaliação cega envia SHOULD_BE_HIGHER', fb && deepEqual(fb.req, { targetType: 'MESSAGE', targetId: qid, type: 'SHOULD_BE_HIGHER', payload: {} }), JSON.stringify(fb && fb.req));

  // configurações: validação, patch mínimo e consentimento
  await go(page, '#/config');
  await waitView(page, 'config');
  const ta = page.locator('#view textarea').first();
  await page.fill('#view textarea >> nth=3', 'rafael.lima@prisma.example\nemail-invalido');
  await page.click('#view button:has-text("Salvar configurações")');
  check('e-mail inválido bloqueia o envio e mostra erro', (await calls(page, 'apiSaveSettings')).length === 0 && (await page.textContent('#view .errlist')).includes('email-invalido'));
  await page.fill('#view textarea >> nth=3', 'rafael.lima@prisma.example');
  await ta.fill('inteligencia artificial\nmachine learning\npricing\nmercado financeiro\neconomia comportamental');
  await page.click('#view button:has-text("Salvar configurações")');
  await waitCall(page, 'apiSaveSettings', 1);
  const ss = await lastCall(page, 'apiSaveSettings');
  check('apiSaveSettings recebe só o que mudou', ss && deepEqual(ss.req, { patch: { profile: { interests: ['inteligencia artificial', 'machine learning', 'pricing', 'mercado financeiro', 'economia comportamental'] } } }), JSON.stringify(ss && ss.req));
  await page.waitForTimeout(100);
  check('confirmação de configurações salvas', (await page.textContent('#toasts')).includes('Configurações salvas'));
  check('segredos aparecem só como configurado/não configurado', await page.evaluate(() => { const t = document.getElementById('view').textContent; return t.includes('GCP_PROJECT_ID') && t.includes('Não configurada') && !document.querySelector('#view input[type="password"]'); }));
  // consentimento: revogar (1 clique) → escolher FULL → prévia → checkbox → habilitar
  await page.click('#sec-ia button:has-text("Revogar consentimento")');
  await waitCall(page, 'apiSetAiConsent', 1);
  let cs = await lastCall(page, 'apiSetAiConsent');
  check('revogação em um clique envia accept:false', cs && deepEqual(cs.req, { policy: 'OFF', accept: false }), JSON.stringify(cs && cs.req));
  await page.waitForSelector('#sec-ia input[value="FULL"]');
  await page.check('#sec-ia input[value="FULL"]');
  await page.click('#sec-ia [data-act="dry-run"]');
  await waitCall(page, 'apiAiDryRun', 1);
  await page.waitForSelector('#sec-ia [data-act="consent"]');
  const dr = await lastCall(page, 'apiAiDryRun');
  check('prévia chama apiAiDryRun com a política escolhida', dr && deepEqual(dr.req, { policy: 'FULL' }), JSON.stringify(dr && dr.req));
  const ptxt = await page.textContent('#sec-ia');
  check('prévia mostra contagem, bloqueios e amostra redigida como texto', ptxt.includes('104 de 120') && ptxt.includes('mensagem enviada') && ptxt.includes('[CPF]') && ptxt.includes('<script>alert(8)</script>'));
  check('botão de habilitar começa desabilitado', await page.isDisabled('#sec-ia [data-act="consent"]'));
  await page.check('#sec-ia input[type="checkbox"]');
  check('"Entendi o que será enviado" habilita o botão', !(await page.isDisabled('#sec-ia [data-act="consent"]')));
  await page.click('#sec-ia [data-act="consent"]');
  await waitCall(page, 'apiSetAiConsent', 2);
  cs = await lastCall(page, 'apiSetAiConsent');
  check('consentimento envia {policy, accept:true}', cs && deepEqual(cs.req, { policy: 'FULL', accept: true }), JSON.stringify(cs && cs.req));
  await page.waitForTimeout(80);
  check('após consentir, a tela mostra a revogação', (await page.textContent('#sec-ia')).includes('Revogar consentimento'));
  await page.click('#view button:has-text("Adicionar") >> nth=0');
  check('sugestão de prioritário é adicionada ao campo', (await page.inputValue('#view textarea >> nth=3')).includes('paula@rocha-consultoria.example'));

  await pageClean(page, 'fluxos');
  await ctx.close();
}

async function keyboard(browser, url) {
  for (const vp of VIEWPORTS) {
    const { ctx, page } = await newPage(browser, vp, 'light');
    await page.goto(url + '#/caixa');
    await waitView(page, 'caixa');
    let reached = null;
    for (let i = 0; i < 160 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => (document.activeElement && document.activeElement.classList.contains('item-open') ? document.activeElement.getAttribute('data-open-id') : null));
    }
    check('Tab chega aos itens da Caixa: ' + vp.name, !!reached);
    if (!reached) { await ctx.close(); continue; }
    const visible = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); const cs = getComputedStyle(document.activeElement); return r.width > 0 && cs.outlineStyle !== 'none'; });
    check('foco visível no item: ' + vp.name, visible);
    await page.keyboard.press('Enter');
    await waitDialog(page);
    check('Enter abre o detalhe com foco dentro do diálogo: ' + vp.name, await page.evaluate(() => { const d = document.querySelector('.dlg[role="dialog"][aria-modal="true"]'); return !!d && d.contains(document.activeElement); }));
    let escaped = false;
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press(i % 9 === 8 ? 'Shift+Tab' : 'Tab');
      if (!(await page.evaluate(() => { const d = document.querySelector('.dlg'); return d && d.contains(document.activeElement); }))) { escaped = true; break; }
    }
    check('foco preso no diálogo (Tab/Shift+Tab): ' + vp.name, !escaped);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    check('Esc fecha e devolve o foco ao item: ' + vp.name, await page.evaluate((id) => !document.querySelector('.dlg') && document.activeElement && document.activeElement.getAttribute('data-open-id') === id, reached));
    if (!vp.isMobile) {
      await page.keyboard.press('j');
      check('atalho j move para o próximo item', await page.evaluate((id) => document.activeElement.classList.contains('item-open') && document.activeElement.getAttribute('data-open-id') !== id, reached));
      await page.keyboard.press('/');
      await waitView(page, 'busca');
      check('atalho / abre a busca com foco no campo', await page.evaluate(() => document.activeElement && document.activeElement.id === 'q'));
    }
    await pageClean(page, 'teclado ' + vp.name);
    await ctx.close();
  }
}

// ------------------------------------------------------------ variantes ----
const EMPTY_TEXT = {
  radar: 'Nenhuma mensagem ainda', caixa: 'Nenhuma mensagem', tarefas: 'Nenhuma tarefa aberta', carreira: 'Nenhuma oportunidade em aberto', noticias: 'Sem notícias no período',
  remetentes: 'Nenhum remetente no período', busca: 'Busque por pessoas', sistema: 'Nenhuma execução registrada', config: 'Perfil'
};
const ERROR_ENDPOINT = { radar: 'apiGetRadar', caixa: 'apiListMessages', tarefas: 'apiListTasks', carreira: 'apiListOpportunities', noticias: 'apiGetNews', remetentes: 'apiGetSenders', sistema: 'apiGetSystemStatus', config: 'apiGetSettings' };

async function variants(browser, url) {
  for (const [vp, scheme] of [[VIEWPORTS[1], 'light'], [VIEWPORTS[0], 'dark']]) {
    const tag = scheme + '-' + vp.name;
    // vazio
    let { ctx, page } = await newPage(browser, vp, scheme);
    await page.goto(url + '?variant=empty#/radar');
    await waitView(page, 'radar');
    for (const s of SCREENS) {
      await go(page, '#/' + s);
      await waitView(page, s);
      const t = await page.textContent('#view');
      const st = await page.evaluate(() => Array.from(document.querySelectorAll('#view [data-state]')).map((e) => e.getAttribute('data-state')));
      check(`vazio ${tag} ${s}: estado vazio útil`, t.includes(EMPTY_TEXT[s]) && (s === 'config' || s === 'sistema' || st.includes('empty') || st.includes('idle')), st.join(','));
      if (s === 'sistema') check('vazio: Sistema mostra avisos do servidor (errors)', t.includes('Setup ainda não executado.'));
      if (s === 'radar') check('vazio: Radar oferece "Sincronizar agora" e explica a primeira sincronização', t.includes('primeira sincronização roda em até 1 h') && (await page.locator('#view .state-empty button:has-text("Sincronizar agora")').count()) === 1);
      await overflow(page, 'vazio ' + tag + ' ' + s);
      if (['radar', 'caixa', 'sistema'].includes(s)) { await axe(page, 'vazio ' + tag + ' ' + s); await shot(page, 'variant-empty-' + tag + '-' + s); }
    }
    await pageClean(page, 'vazio ' + tag);
    await ctx.close();

    // erro (ok:false)
    ({ ctx, page } = await newPage(browser, vp, scheme));
    await page.goto(url + '?variant=error#/radar');
    await waitView(page, 'radar');
    for (const s of Object.keys(ERROR_ENDPOINT)) {
      await go(page, '#/' + s);
      await waitView(page, s);
      const n0 = (await calls(page, ERROR_ENDPOINT[s])).length;
      const ok = await page.locator('#view .state-error button:has-text("Tentar de novo")').count();
      check(`erro ${tag} ${s}: estado de erro com "Tentar de novo"`, ok >= 1);
      if (ok) {
        await page.click('#view .state-error button:has-text("Tentar de novo") >> nth=0');
        await waitView(page, s);
        check(`erro ${tag} ${s}: "Tentar de novo" chama ${ERROR_ENDPOINT[s]} de novo`, (await calls(page, ERROR_ENDPOINT[s])).length === n0 + 1);
      }
      if (s === 'radar') { await axe(page, 'erro ' + tag + ' radar'); await shot(page, 'variant-error-' + tag + '-radar'); }
    }
    const et = await page.textContent('#view');
    check('erro: mensagem do servidor com HTML aparece como texto', et.includes('<img src=x onerror='));
    await go(page, '#/busca');
    await waitView(page, 'busca');
    await page.fill('#q', 'x');
    await page.press('#q', 'Enter');
    await waitView(page, 'busca');
    check('erro: busca mostra estado de erro', (await page.locator('#view .state-error').count()) === 1);
    await go(page, '#/radar?m=m01');
    await waitDialog(page);
    check('erro: detalhe mostra erro amigável (NOT_FOUND)', (await page.textContent('.dlg')).includes('Item não encontrado'));
    await page.keyboard.press('Escape');
    await pageClean(page, 'erro ' + tag);
    await ctx.close();
  }

  // transporte (withFailureHandler)
  let { ctx, page } = await newPage(browser, VIEWPORTS[1], 'light');
  await page.goto(url + '?variant=transport#/radar');
  await waitView(page, 'radar');
  check('falha de transporte vira erro amigável', (await page.textContent('#view')).includes('Sem resposta do servidor do Apps Script'));
  await pageClean(page, 'transporte');
  await ctx.close();

  // configuração incompleta
  for (const [vp, scheme] of [[VIEWPORTS[1], 'light'], [VIEWPORTS[0], 'dark']]) {
    ({ ctx, page } = await newPage(browser, vp, scheme));
    await page.goto(url + '?variant=nosetup');
    await waitView(page, 'setup');
    const t = await page.textContent('#view');
    check('nosetup: lista os itens faltantes com instruções ' + vp.name, (await page.locator('#view .missing li').count()) === 4 && t.includes('GCP_PROJECT_ID') && t.includes('setupTriggers()') && t.includes('voce@exemplo.com.br') && t.includes('1.0.0'));
    check('nosetup: navegação oculta ' + vp.name, await page.evaluate(() => document.getElementById('side').hidden && document.getElementById('tabbar').hidden));
    check('nosetup: não chama outros endpoints ' + vp.name, (await calls(page)).every((c) => c.name === 'apiBootstrap'));
    await overflow(page, 'nosetup ' + vp.name);
    await axe(page, 'nosetup ' + scheme + '-' + vp.name);
    await shot(page, 'variant-nosetup-' + scheme + '-' + vp.name);
    await pageClean(page, 'nosetup ' + vp.name);
    await ctx.close();
  }

  // bootstrap falhou
  ({ ctx, page } = await newPage(browser, VIEWPORTS[1], 'light'));
  await page.goto(url + '?variant=bootfail');
  await waitView(page, 'fatal');
  check('bootstrap com erro mostra tela de falha com "Tentar de novo"', (await page.textContent('#view')).includes('Não foi possível iniciar') && (await page.locator('#view button:has-text("Tentar de novo")').count()) === 1);
  await axe(page, 'bootfail');
  await pageClean(page, 'bootfail');
  await ctx.close();

  // IA desativada
  ({ ctx, page } = await newPage(browser, VIEWPORTS[1], 'light'));
  await page.goto(url + '?variant=noai#/radar');
  await waitView(page, 'radar');
  check('noai: briefing por regras', (await page.textContent('#view')).includes('Gerado por regras (sem IA)'));
  await go(page, '#/config');
  await waitView(page, 'config');
  const ct = await page.textContent('#sec-ia');
  check('noai: IA e privacidade explica como configurar e não oferece consentimento', ct.includes('Nenhuma chave de IA configurada') && ct.includes('Propriedades do script') && (await page.locator('#sec-ia input[type="radio"]').count()) === 0);
  await shot(page, 'variant-noai-light-desktop-config');
  await go(page, '#/caixa?m=m01');
  await waitDialog(page);
  check('noai: detalhe indica método Regras', (await page.textContent('.dlg')).includes('Regras (sem IA)'));
  await pageClean(page, 'noai');
  await ctx.close();
}

// ---------------------------------------------------------------- main ----
(async function main() {
  const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  console.log('Análise estática…');
  const st = checkFiles();
  check('análise estática sem violações', st.violations.length === 0, st.violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.snippet || v.why}`).join('; '));
  check('autoteste das regras estáticas', selfTest().length === 0, selfTest().join('; '));
  console.log('  tamanho: ' + JSON.stringify(st.sizes) + ' total ' + st.total + ' bytes');
  const url = buildPage();
  const browser = await chromium.launch();
  try {
    if (!ONLY || ONLY.includes('sweep')) {
      for (const scheme of SCHEMES) for (const vp of VIEWPORTS) { console.log(`Varredura ${scheme} ${vp.name} (${vp.width}×${vp.height})…`); await sweep(browser, url, vp, scheme); }
    }
    if (!ONLY || ONLY.includes('flows')) { console.log('Fluxos…'); await flows(browser, url); }
    if (!ONLY || ONLY.includes('keyboard')) { console.log('Teclado…'); await keyboard(browser, url); }
    if (!ONLY || ONLY.includes('variants')) { console.log('Variantes…'); await variants(browser, url); }
  } catch (e) {
    check('execução do ui-check sem exceções', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await browser.close();
  }
  const fail = results.filter((r) => !r.ok);
  const shots = fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length;
  console.log('\n=== Resumo ui:check ===');
  console.log(`verificações: ${results.length} · ok: ${results.length - fail.length} · falhas: ${fail.length}`);
  console.log(`telas: ${SCREENS.length} × ${VIEWPORTS.length} viewports × ${SCHEMES.length} esquemas + detalhe + variantes · screenshots: ${shots} em artifacts/ui/`);
  console.log(`tempo: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (fail.length) { console.log('FALHAS:'); fail.forEach((f) => console.log(' - ' + f.name + (f.detail ? ' — ' + f.detail.slice(0, 300) : ''))); }
  else console.log('RESULTADO: OK');
  process.exit(fail.length ? 1 : 0);
})();
