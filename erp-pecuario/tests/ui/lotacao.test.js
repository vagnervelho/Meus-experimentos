'use strict';
/**
 * Inventário histórico e lotação na interface (nível 3, Playwright; E2.8): a "Visão geral" com o período (padrão dos
 * últimos 12 meses), o movimento do período (nascimentos, compras, vendas, mortes e a receita de vendas) e as séries
 * mensais; o painel do pasto numa data passada (quem estava e desde quando) e os dias de permanência num período. A
 * 1280 e a 360 px: sem rolagem horizontal, alvos de toque de 48 px a 360 px e nenhum erro no console.
 * Roda por `npm run ui:check`.
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
/** 4 no marco zero (3 no Pasto A); em 01/03 dois vão para o B; compra de 2 em 10/04; venda de 1 em 20/05; uma morte em 05/06. */
function semearMovimento(s) {
  const sem = A.semear(s);
  const id = (b) => sem.animais.filter((x) => x.brinco === b)[0].animal_id;
  const forn = s.api({ rota: 'parceiro.salvar', idempotencyKey: 'ui-forn', dados: { campos: { nome: 'Fornecedor', tipos: 'FORNECEDOR' } } }).data.partner_id;
  const comp = s.api({ rota: 'parceiro.salvar', idempotencyKey: 'ui-comp', dados: { campos: { nome: 'Comprador', tipos: 'COMPRADOR' } } }).data.partner_id;
  s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: id('0457') }, { animal_id: id('12') }] }, 'ui-t');
  const c = s.registrar({ tipo: 'COMPRA', campos: { event_date: '2026-04-10', partner_id: forn, pasto_destino_id: S.PASTOS.A, modalidade: 'CABECA', preco_unitario: 250000, valor_animais: 500000 },
    animais: [{ brinco: 'C1', sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14, peso: 280 }, { brinco: 'C2', sexo: 'F', idade_meses: 14, peso: 260 }], parcelas: [{ data_vencimento: '2026-05-10' }] }, 'ui-c');
  s.registrar({ tipo: 'VENDA', campos: { event_date: '2026-05-20', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 400000, valor_bruto: 400000 }, animais: [{ animal_id: id('12') }], parcelas: [{ data_vencimento: '2026-06-20' }] }, 'ui-v');
  s.registrar({ tipo: 'MORTE', campos: { event_date: '2026-06-05', causa: 'DOENCA' }, animais: [{ animal_id: c.animais.filter((x) => x.brinco === 'C1')[0].animal_id }] }, 'ui-m');
  return { id };
}

for (const largura of [1280, 360]) {
  test('visão geral: período, movimento do período com a receita e as séries mensais (' + largura + ' px)', async () => {
    const s = A.sistema();
    semearMovimento(s);
    const a = await A.abrir(s, { largura, hash: 'inicio' });
    const { page } = a;
    await A.esperarTela(page, 'Início');
    await page.waitForSelector('[data-secao="movimento"]');
    assert.equal(await page.inputValue('#ini-de'), '2025-12-01', 'período padrão: os últimos 12 meses');
    assert.match(await textoTela(page, '[data-indicador="compras"]'), /Compras\s*2 · R\$ 5\.000,00/);
    assert.match(await textoTela(page, '[data-indicador="vendas"]'), /Vendas\s*1 · R\$ 4\.000,00/);
    assert.match(await textoTela(page, '[data-indicador="mortes"]'), /Mortes\s*1/);
    assert.match(await textoTela(page, '[data-indicador="receita-vendas"]'), /Receita de vendas\s*R\$ 4\.000,00/);
    assert.match(await textoTela(page, '[data-secao="movimento"]'), /O período começa antes do marco zero \(01\/01\/2026\)/);
    assert.match(await textoTela(page, '[data-indicador="cabecas"]'), /Cabeças\s*4/);
    assert.ok(await page.locator('figure[data-grafico="linha"]').count() >= 1, 'evolução do rebanho em linha');
    await semProblemasDeLeiaute(page, largura, 'início com movimento');
    // Só maio: a venda; a posição é a do fim do período (31/05).
    await page.fill('#ini-de', '2026-05-01');
    await page.fill('#ini-ate', '2026-05-31');
    await page.click('[data-periodo] button:has-text("Ver")');
    await page.waitForFunction(() => /em 31\/05/.test((document.querySelector('[data-indicador="cabecas"]') || {}).textContent || ''));
    assert.match(await textoTela(page, '[data-indicador="compras"]'), /Compras\s*0 · R\$ 0,00/, 'no fluxo, zero é informação');
    assert.match(await textoTela(page, '[data-indicador="vendas"]'), /Vendas\s*1/);
    assert.match(await textoTela(page, '[data-indicador="cabecas"]'), /Cabeças\s*5/);
    const pedido = a.pedidos('dashboard.obter').pop();
    assert.deepEqual(pedido.dados, { data_inicio: '2026-05-01', data_fim: '2026-05-31' });
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });

  test('painel do pasto em data passada: quem estava e desde quando; dias de permanência no período (' + largura + ' px)', async () => {
    const s = A.sistema();
    semearMovimento(s);
    const a = await A.abrir(s, { largura, hash: 'pasto/' + S.PASTOS.B });
    const { page } = a;
    await A.esperarTela(page, 'Pasto B');
    await page.waitForSelector('[data-secao="composicao"]');
    await page.fill('#pst-data', '2026-03-15');
    await page.click('button:has-text("Ver")');
    await page.waitForFunction(() => /Composição em 15\/03\/2026/.test((document.querySelector('[data-secao="composicao"]') || {}).textContent || ''));
    assert.match(await textoTela(page, '[data-secao="composicao"]'), /Cabeças\s*3/, '0391 desde o marco zero e os dois transferidos em 01/03');
    const animais = await textoTela(page, '[data-secao="animais"]');
    assert.match(animais, /No pasto desde/);
    assert.match(animais, /01\/03\/2026/);
    assert.match(animais, /01\/01\/2026/);
    await page.fill('#pst-perm-de', '2026-03-01');
    await page.fill('#pst-perm-ate', '2026-03-31');
    await page.click('[data-secao="permanencia"] button:has-text("Contar")');
    await page.waitForSelector('[data-permanencia] table, [data-permanencia] .lista-cartoes, [data-permanencia] .tabela');
    const perm = await textoTela(page, '[data-secao="permanencia"]');
    assert.match(perm, /Total de animal-dias\s*93/, '3 animais × 31 dias de março');
    await semProblemasDeLeiaute(page, largura, 'painel do pasto com permanência');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}
