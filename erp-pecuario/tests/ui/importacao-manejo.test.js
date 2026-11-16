'use strict';
/**
 * Importação de manejo na tela (Fase 3, E3.6, nível 3, Playwright), a 1280 e a 360 px: escolher "Pesagens", baixar o
 * modelo do tipo, mandar o arquivo, ver as colunas já mapeadas e escolher o momento e o método para todas as linhas (as
 * opções em palavras, nunca o código), validar (a linha repetida fica duplicada, com o motivo; o que o sistema entendeu
 * aparece em palavras), aprovar a importação parcial e ver no relatório final os lançamentos que entraram, sem as linhas
 * de animais criados (o manejo não cria animal) e com o atalho para as pesagens. Depois, a sanidade: o produto do cadastro
 * achado pelo nome aparece pelo nome na pré-visualização. Sem rolagem horizontal, alvos de toque ≥ 48 px a 360 px e
 * nenhum erro no console. Roda por `npm run ui:check`.
 */
const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

test.after(() => A.fecharBrowser());

async function textoTela(page, sel) { return (await page.textContent(sel)).replace(/\s+/g, ' ').trim(); }
async function semProblemasDeLeiaute(page, largura, onde) {
  const r = await A.semRolagemHorizontal(page);
  assert.ok(r.sw <= r.cw, onde + ': sem rolagem horizontal a ' + largura + ' px (' + r.sw + ' > ' + r.cw + ')');
  if (largura < 900) assert.deepEqual(await A.alvosDeToque(page, '#conteudo'), [], onde + ': alvos de toque');
}
const vigentesDe = (s, aba) => s.read({ rota: 't', reads: [aba], tratador: (tx) => tx.repo.vigentes(aba) });
const PESAGENS = ['Data da pesagem;Brinco;Peso (kg)', '10/03/2026;0457;410,5', '10/03/2026;0391;380', '10/03/2026;12;250', '15/09/2025;0457;390', '10/03/2026;0457;410,5'].join('\r\n');

for (const largura of [1280, 360]) {
  test('importar pesagens: modelo do tipo, momento e método para todas as linhas em palavras, linha repetida duplicada, parcial aprovado, relatório sem animais criados e o atalho para as pesagens (' + largura + ' px)', async () => {
    const s = A.sistema();
    A.semear(s);
    const a = await A.abrir(s, { largura, hash: 'importar/novo' });
    const { page } = a;
    await A.esperarTela(page, 'Importar animais');
    await page.selectOption('select[id^="imp-tipo-"]', 'PESAGENS');
    await page.waitForFunction(() => /Importar pesagens/.test(document.querySelector('#conteudo h1').textContent));
    assert.match(await page.textContent('select[id^="imp-tipo-"] option[value="SANIDADE"]'), /Sanidade \(vacinas, vermífugos/, 'o tipo em palavras');
    await page.waitForFunction(() => /Nº da pesagem/.test(document.querySelector('#conteudo details.detalhe').textContent), null, { timeout: 10000 });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Baixar o modelo da planilha")')]);
    assert.equal(dl.suggestedFilename(), 'modelo-importacao-pesagens.csv');
    assert.match(fs.readFileSync(await dl.path(), 'utf8'), /^﻿Nº da pesagem;Data da pesagem;Momento da pesagem;Como foi pesado;/);
    await page.setInputFiles('#imp-arquivo', { name: 'pesagens.csv', mimeType: 'text/csv', buffer: Buffer.from(PESAGENS, 'utf8') });
    await page.click('button:has-text("Ler o arquivo")');
    await page.waitForSelector('[data-mapeamento]');
    assert.equal(await page.inputValue('[data-coluna="Peso (kg)"]'), 'peso');
    assert.match(await textoTela(page, '[data-secao="colunas"]'), /achado pelo brinco que ele usava na data de cada linha/);
    // Os valores para todas as linhas, com as opções em palavras.
    assert.deepEqual(await page.$$eval('#pad-momento option', (os) => os.map((o) => o.textContent)), ['—', 'Rotina', 'Chegada à fazenda', 'Desmama', 'Saída (venda ou embarque)']);
    await page.selectOption('#pad-momento', 'ROTINA');
    await page.selectOption('#pad-metodo', 'BALANCA');
    await page.click('button:has-text("Validar o arquivo")');
    await page.waitForSelector('[data-secao="resultado"]');
    assert.match(await textoTela(page, '[data-secao="resultado"]'), /Linhas no arquivo\s*5\s*Válidas\s*4\s*Com erro\s*0\s*Duplicadas\s*1/);
    const linhas = await textoTela(page, '[data-secao="linhas"]');
    assert.match(linhas, /Momento da pesagem: Rotina/, 'o que o sistema entendeu, em palavras');
    assert.match(linhas, /Como foi pesado: Balança/);
    assert.match(linhas, /a linha repete a linha 2 do arquivo/);
    assert.ok(!/ROTINA|BALANCA/.test(linhas), 'nada de código cru na tela');
    await semProblemasDeLeiaute(page, largura, 'validação');
    await page.click('a:has-text("Continuar para a confirmação")');
    await page.waitForSelector('[data-secao="confirmacao"]');
    assert.match(await textoTela(page, '[data-secao="totais"]'), /Linhas que vão entrar\s*4\s*Linhas que ficam de fora\s*1/);
    await page.click('label[for="imp-parcial"]');
    await page.click('button:has-text("Importar 4 linhas")');
    await page.waitForSelector('[data-relatorio="IMPORTADO"]', { timeout: 20000 });
    assert.match(await textoTela(page, '[data-relatorio]'), /2 lançamentos entraram\./);
    const rel = await textoTela(page, '[data-secao="relatorio"]');
    assert.match(rel, /Importadas\s*4/);
    assert.ok(!/Animais ativos hoje|Sem nascimento/.test(rel), 'o manejo não cria animal: sem as pendências dos criados');
    assert.ok(await page.$('a[data-rota="pesagens"]:has-text("Ver as pesagens")'), 'o atalho para as pesagens');
    await semProblemasDeLeiaute(page, largura, 'relatório final');
    const pes = vigentesDe(s, 'PESAGENS').map((p) => [p.data_pesagem, p.peso_kg]).sort();
    assert.deepEqual(pes, [['2025-09-15', 390], ['2026-03-10', 250], ['2026-03-10', 380], ['2026-03-10', 410.5]]);
    assert.deepEqual(a.estado.erros, [], 'nenhum erro no console');
    await a.fechar();
  });
}

test('importar sanidade: o produto do cadastro, achado pelo nome da planilha, aparece pelo nome e o procedimento em palavras na pré-visualização (1280 px)', async () => {
  const s = A.sistema();
  A.semear(s);
  const r = s.api({ rota: 'produto.salvar', idempotencyKey: 'ui-prod', dados: { campos: { nome: 'Vacina Aftosa', categoria: 'VACINA', unidade: 'dose', controla_estoque: false, custo_unitario: 1.5 } } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const a = await A.abrir(s, { largura: 1280, hash: 'importar/novo' });
  const { page } = a;
  await A.esperarTela(page, 'Importar animais');
  await page.selectOption('select[id^="imp-tipo-"]', 'SANIDADE');
  await page.waitForFunction(() => /Importar sanidade/.test(document.querySelector('#conteudo h1').textContent));
  await page.waitForFunction(() => /Produto do cadastro/.test(document.querySelector('#conteudo details.detalhe').textContent), null, { timeout: 10000 });
  const csv = ['Data;Procedimento;Produto do cadastro;Como foi a dose;Dose do lançamento (por cabeça ou por kg);Brinco', '05/05/2026;vacinação;Vacina Aftosa;por cabeça;1;0457', '05/05/2026;vacinação;Vacina Aftosa;por cabeça;1;0391'].join('\r\n');
  await page.setInputFiles('#imp-arquivo', { name: 'vacinas.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.click('button:has-text("Ler o arquivo")');
  await page.waitForSelector('[data-mapeamento]');
  assert.match(await textoTela(page, '[data-secao="colunas"]'), /sem mexer no rebanho nem no estoque de insumos/);
  await page.click('button:has-text("Validar o arquivo")');
  await page.waitForSelector('[data-secao="resultado"]');
  assert.match(await textoTela(page, '[data-secao="resultado"]'), /Válidas\s*2/);
  const linhas = await textoTela(page, '[data-secao="linhas"]');
  assert.match(linhas, /Procedimento: Vacinação/);
  assert.match(linhas, /Produto do cadastro: Vacina Aftosa/);
  assert.match(linhas, /Como foi a dose: Por cabeça \(a mesma dose\)/);
  assert.match(linhas, /lançamento das linhas 2, 3/);
  assert.ok(!/VACINACAO|POR_CABECA|[0-9a-f]{8}-[0-9a-f]{4}-/.test(linhas), 'nada de código cru nem identificador na tela');
  assert.deepEqual(a.estado.erros, [], 'nenhum erro no console');
  await a.fechar();
});
