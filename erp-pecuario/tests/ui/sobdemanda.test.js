'use strict';
/**
 * Telas carregadas sob demanda (Fase 3, etapa BASE; 01-arquitetura.md, seção 6.2; risco R-31), nível 3 (Playwright): a
 * página inicial chega sem a importação; abrir a importação pelo menu de Configurações pede a tela ao servidor uma vez
 * (`sistema.tela`), mostra o esqueleto enquanto ela vem, injeta e abre; ir e voltar não pede de novo; a falha de rede
 * mostra a mensagem e "Tentar de novo", e a volta para a tela anterior funciona; o endereço direto da importação abre na
 * primeira carga; outra versão do app no servidor pede para recarregar; os módulos da Fase 3 ainda sem tela não aparecem
 * no menu. Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

test.after(() => A.fecharBrowser());

const telas = (a) => a.pedidos('sistema.tela');
/** Os pedidos de tela que a página enviou (os que falharam no transporte não chegam ao servidor). */
const enviados = (page) => page.evaluate(() => window.__gas.pedidos.filter((p) => p.rota === 'sistema.tela').length);
async function textoTela(page, sel) { return (await page.textContent(sel)).replace(/\s+/g, ' ').trim(); }

test('importação sob demanda: fora da página inicial, pedida uma vez pelo menu, guardada na memória; ir e voltar não pede de novo (1280 px)', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 1280, hash: 'config/parametros' });
  const { page } = a;
  await A.esperarTela(page, 'Configurações');
  assert.equal(await page.evaluate(() => typeof window.TelaImportacao), 'undefined', 'a página inicial não traz a importação');
  assert.equal(telas(a).length, 0, 'nada é pedido antes de abrir o módulo');
  // A aba "Importação" aparece antes de a tela vir (o módulo é entregue e sob demanda).
  const aba = page.locator('#conteudo a[data-rota="importar"]');
  assert.equal(await aba.count(), 1);
  // Mais lento que o normal: o esqueleto aparece enquanto a tela vem.
  await page.evaluate(() => { window.__gas.atrasoMs = 400; });
  await aba.click();
  await page.waitForSelector('#conteudo [data-tela-sob-demanda="Import"] .esqueleto');
  await page.evaluate(() => { window.__gas.atrasoMs = 20; });
  await A.esperarTela(page, 'Importação');
  assert.equal(await page.evaluate(() => typeof window.TelaImportacao.planoConfirmacao), 'function');
  assert.deepEqual(telas(a).map((p) => p.dados), [{ nome: 'Import' }], 'um pedido só, da importação');
  assert.equal(await page.locator('script[data-modulo="Import"]').count(), 1, 'injetada uma vez');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.tagName), 'H1', 'o foco vai para o título da tela que chegou');
  // Ir para outra tela e voltar (pelo histórico e pelo link): a tela já está na memória.
  await A.ir(page, 'rebanho', 'Rebanho');
  await page.goBack();
  await A.esperarTela(page, 'Importação');
  await A.ir(page, 'inicio');
  await A.ir(page, 'importar/novo', 'Importar animais');
  assert.equal(telas(a).length, 1, 'ir e voltar não pede a tela de novo');
  assert.equal(await page.locator('script[data-modulo="Import"]').count(), 1);
  assert.deepEqual(a.estado.erros, [], 'nenhum erro no console');
  await a.fechar();
});

test('falha de rede ao abrir a importação: mensagem clara e "Tentar de novo"; a volta à tela anterior funciona; depois abre (360 px)', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 360, hash: 'rebanho' });
  const { page } = a;
  await A.esperarTela(page, 'Rebanho');
  await page.evaluate(() => { window.__gas.falharTransporte = 1; });
  await A.ir(page, 'importar');
  await A.esperarTela(page, 'Não foi possível abrir Importação');
  const erro = await textoTela(page, '#conteudo [data-erro]');
  assert.match(erro, /Sem conexão/);
  assert.match(erro, /Sem conexão com o servidor\. Confira o sinal e tente de novo\./);
  assert.equal(await page.getAttribute('#conteudo [data-erro]', 'data-erro'), 'TRANSPORTE');
  assert.equal(await page.evaluate(() => typeof window.TelaImportacao), 'undefined');
  assert.deepEqual(await A.alvosDeToque(page, '#conteudo'), [], 'alvos de toque na tela de erro');
  // A volta: o rebanho abre normalmente (nada ficou preso no erro).
  await page.goBack();
  await A.esperarTela(page, 'Rebanho');
  // De novo na importação, ainda sem rede: o mesmo erro; com rede, "Tentar de novo" abre a tela.
  await page.evaluate(() => { window.__gas.falharTransporte = 1; });
  await A.ir(page, 'importar', 'Não foi possível abrir Importação');
  assert.equal(await enviados(page), 2, 'cada tentativa sem rede pediu a tela');
  assert.equal(telas(a).length, 0, 'nenhuma chegou ao servidor');
  await page.click('#conteudo button:has-text("Tentar de novo")');
  await A.esperarTela(page, 'Importação');
  assert.deepEqual([await enviados(page), telas(a).length], [3, 1]);
  assert.equal(await page.evaluate(() => typeof window.TelaImportacao.planoConfirmacao), 'function');
  const r = await A.semRolagemHorizontal(page);
  assert.ok(r.sw <= r.cw, 'sem rolagem horizontal a 360 px');
  assert.deepEqual(a.estado.erros, [], 'nenhum erro no console');
  await a.fechar();
});

test('endereço direto da importação: a tela vem na primeira carga; os módulos de fase futura não aparecem no menu, as pesagens, a sanidade e a reprodução sim (1280 px)', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 1280, hash: 'importar' });
  const { page } = a;
  await A.esperarTela(page, 'Importação');
  assert.deepEqual(telas(a).map((p) => p.dados.nome), ['Import']);
  const menu = await textoTela(page, '#menu');
  for (const m of ['Visão geral', 'Rebanho', 'Pastos', 'Eventos', 'Pesagens', 'Sanidade', 'Reprodução', 'Configurações']) assert.ok(menu.includes(m), m + ' no menu');
  for (const m of ['Financeiro', 'Relatórios']) assert.ok(!menu.includes(m), m + ' ainda não está pronto: fora do menu');
  // Rota de um módulo que ainda não foi entregue: a tela diz que não está disponível, sem pedir nada ao servidor.
  await A.ir(page, 'financeiro/lancamentos', 'Tela não encontrada');
  assert.equal(telas(a).length, 1);
  assert.deepEqual(a.estado.erros, [], 'nenhum erro no console');
  await a.fechar();
});

test('outra versão do app no servidor: a tela sob demanda não é injetada na página antiga, que pede para recarregar (1280 px)', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 1280, hash: 'inicio', trocarVersao: '0.0.1' });
  const { page } = a;
  await A.ir(page, 'importar', 'Não foi possível abrir Importação');
  assert.match(await textoTela(page, '#conteudo [data-erro]'), /Nova versão do app.*Recarregue a página para abrir esta tela/);
  assert.equal(await page.locator('#conteudo a:has-text("Recarregar a página"), #conteudo button:has-text("Recarregar a página")').count(), 1);
  assert.equal(await page.evaluate(() => typeof window.TelaImportacao), 'undefined', 'a tela da versão nova não entra na página antiga');
  assert.equal(await page.locator('[data-faixa="nova-versao"]').count(), 1, 'a faixa de versão nova também aparece');
  assert.deepEqual(a.estado.erros, [], 'nenhum erro no console');
  await a.fechar();
});
