'use strict';
/**
 * Importação de eventos históricos na tela (E2.10, nível 3, Playwright), a 1280 e a 360 px: escolher o tipo
 * (transferências), mandar o arquivo, ver as colunas do modelo do tipo já mapeadas (sem a seção de confiança, que o tipo
 * não tem), validar (uma linha com brinco sem animal), aprovar a importação parcial e ver no relatório final os
 * lançamentos que entraram e a reconciliação com o marco zero (pasto diferente do histórico; brinco sem animal). Sem
 * rolagem horizontal, alvos de toque ≥ 48 px a 360 px e nenhum erro no console. Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

async function textoTela(page, sel) { return (await page.textContent(sel)).replace(/\s+/g, ' ').trim(); }
async function semProblemasDeLeiaute(page, largura, onde) {
  const r = await A.semRolagemHorizontal(page);
  assert.ok(r.sw <= r.cw, onde + ': sem rolagem horizontal a ' + largura + ' px (' + r.sw + ' > ' + r.cw + ')');
  if (largura < 900) assert.deepEqual(await A.alvosDeToque(page, '#conteudo'), [], onde + ': alvos de toque');
}
const CSV = ['Data;Pasto de origem;Pasto de destino;Brinco', '10/06/2025;Pasto A;Pasto B;0457', '05/02/2026;Pasto B;Pasto A;0391', '06/02/2026;Pasto A;Pasto B;9999'].join('\r\n');

for (const largura of [1280, 360]) {
  test('importar transferências: modelo do tipo, validação, parcial aprovado e reconciliação no relatório final (' + largura + ' px)', async () => {
    const s = A.sistema();
    A.semear(s);
    const a = await A.abrir(s, { largura, hash: 'importar' });
    const { page } = a;
    await A.esperarTela(page, 'Importação');
    await page.click('a:has-text("Nova importação")');
    await A.esperarTela(page, 'Importar animais');
    await page.selectOption('select[id^="imp-tipo-"]', 'TRANSFERENCIAS');
    await page.waitForFunction(() => /Pasto de origem/.test(document.querySelector('#conteudo details.detalhe').textContent), null, { timeout: 10000 });
    await page.setInputFiles('#imp-arquivo', { name: 'transferencias.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') });
    await page.click('button:has-text("Ler o arquivo")');
    await page.waitForSelector('[data-mapeamento]');
    assert.match(await textoTela(page, '#conteudo h1'), /Importar transferências entre pastos/);
    assert.equal(await page.inputValue('[data-coluna="Pasto de origem"]'), 'pasto_origem', 'o modelo do tipo já vem mapeado');
    assert.equal(await page.inputValue('[data-coluna="Brinco"]'), 'brinco');
    assert.equal(await page.$('[data-secao="confiancas"]'), null, 'transferência não tem confiança a escolher');
    assert.match(await textoTela(page, '[data-secao="colunas"]'), /Datas antes do marco zero entram como histórico/);
    await semProblemasDeLeiaute(page, largura, 'importação de eventos, colunas');
    await page.click('button:has-text("Validar o arquivo")');
    await page.waitForSelector('[data-secao="resultado"]');
    assert.match(await textoTela(page, '[data-secao="resultado"]'), /Linhas no arquivo\s*3\s*Válidas\s*2\s*Com erro\s*1/);
    assert.match(await textoTela(page, '[data-secao="linhas"]'), /brinco 9999 não está no rebanho nem no histórico/);
    await page.click('a:has-text("Continuar para a confirmação")');
    await page.waitForSelector('[data-secao="confirmacao"]');
    const importarB = page.locator('button:has-text("Importar 2 linhas")');
    assert.equal(await importarB.isDisabled(), true);
    await page.click('label[for="imp-parcial"]');
    await importarB.click();
    await page.waitForSelector('[data-relatorio="IMPORTADO"]', { timeout: 20000 });
    assert.match(await textoTela(page, '[data-relatorio]'), /2 lançamentos entraram/);
    const rec = await textoTela(page, '[data-secao="reconciliacao"]');
    assert.match(rec, /Pasto diferente: O animal de brinco 0457: o último pasto do histórico é Pasto B \(10\/06\/2025\)/);
    assert.match(rec, /transferencias\.csv, linha 4: .*9999/);
    await semProblemasDeLeiaute(page, largura, 'importação de eventos, relatório');
    const ativos = s.read({ rota: 't', reads: ['ANIMAIS'], tratador: (tx) => tx.repo.vigentes('ANIMAIS').filter((x) => x.brinco === '0391').map((x) => x.pasto_atual_id) });
    assert.deepEqual(ativos, [S.PASTOS.A], 'a transferência de 05/02 vale');
    assert.deepEqual(a.estado.erros, [], 'nenhum erro no console');
    await a.fechar();
  });
}
