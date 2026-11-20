'use strict';
/**
 * Venda na tela (nível 3, Playwright): vender pelo atalho da ficha (comprador, finalidade, negociação por kg vivo, peso
 * do animal, parcela do recebimento e comissão como dedução), com a revisão calculada pelo servidor (receita, deduções,
 * resultado da negociação, depósito esperado, preço médio e o equivalente em arrobas rotulado) e a ficha com a
 * receita e o animal vendido; corrigir a venda pelo detalhe do evento (preço e frete retido, a diferença e o depósito
 * esperado na revisão). Em todas: sem rolagem horizontal, alvos de toque ≥ 48 px a 360 px e nenhum erro no console.
 * Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const dialogo = '[role=dialog]';
async function principal(page) {
  await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
  await page.click(dialogo + ' [data-acao-principal]');
}
async function semProblemasDeLeiaute(page, largura, onde) {
  const r = await A.semRolagemHorizontal(page);
  assert.ok(r.sw <= r.cw, onde + ': sem rolagem horizontal a ' + largura + ' px (' + r.sw + ' > ' + r.cw + ')');
  if (largura < 900) assert.deepEqual(await A.alvosDeToque(page, '#conteudo'), [], onde + ': alvos de toque');
}
const vigentesDe = (s, aba) => s.read({ rota: 't', reads: [aba], tratador: (tx) => tx.repo.vigentes(aba) });
async function textoTela(page, sel) { return (await page.textContent(sel)).replace(/\s+/g, ' ').trim(); }
function parceiro(s, nome, tipos) {
  const r = s.api({ rota: 'parceiro.salvar', idempotencyKey: 'p-' + nome, dados: { campos: { nome, tipos } } });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data.partner_id;
}

for (const largura of [1280, 360]) {
  test('venda pela ficha: kg vivo, peso do animal, parcela e comissão; revisão do servidor com receita, deduções e depósito; ficha com a receita (' + largura + ' px)', async () => {
    const s = A.sistema();
    const sem = A.semear(s);
    const comp = parceiro(s, 'Recriador Vizinho', ['COMPRADOR']);
    const id = sem.animais.find((x) => x.brinco === '12').animal_id;
    const a = await A.abrir(s, { largura, hash: 'animal/' + id + '/resumo' });
    const { page } = a;
    await A.esperarTela(page, '12');
    await page.click('[data-atalho-ficha="VENDA"]');
    await A.esperarTela(page, 'Vender animais');
    await page.fill('[data-campo="event_date"] input', '2026-08-20');
    await page.locator('[data-campo="partner_id"] select').selectOption(comp);
    await page.locator('[data-campo="finalidade"] select').selectOption({ label: 'Recria e engorda' });
    await page.locator('[data-campo="modalidade"] select').selectOption('KG_VIVO');
    assert.equal(await page.locator('[data-campo="base_peso"]').isVisible(), false, 'base de peso só na arroba');
    await page.fill('[data-campo="preco_unitario"] input', '10,00');
    await page.fill('[data-campo="valor_bruto"] input', '4.500,00');
    await page.locator('[data-linha]').nth(0).locator('[data-campo="peso"] input').fill('450');
    const parcelas = page.locator('[data-grupo="parcelas"] [data-linha-grupo]');
    assert.equal(await parcelas.count(), 1, 'a venda começa com uma parcela do recebimento');
    assert.match(await textoTela(page, '[data-grupo="parcelas"] h2'), /Parcelas do recebimento/);
    await parcelas.nth(0).locator('[data-campo="data_vencimento"] input').fill('2026-09-19');
    await page.click('[data-grupo="deducoes"] button:has-text("Frete, comissão ou imposto")');
    const ded = page.locator('[data-grupo="deducoes"] [data-linha-grupo]').nth(0);
    await ded.locator('[data-campo="tipo"] select').selectOption({ label: 'Comissão' });
    await ded.locator('[data-campo="valor"] input').fill('90,00');
    await semProblemasDeLeiaute(page, largura, 'formulário da venda');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
    assert.equal(a.pedidos('evento.simular').length, 1, 'revisão pelo servidor (venda)');
    const rev = await textoTela(page, dialogo);
    assert.match(rev, /Comprador\s*Recriador Vizinho/);
    assert.match(rev, /Receita da venda\s*R\$ 4\.500,00/);
    assert.match(rev, /Comissão\s*− R\$ 90,00/);
    assert.match(rev, /Resultado da negociação\s*R\$ 4\.410,00/);
    assert.match(rev, /Depósito esperado do comprador\s*R\$ 4\.500,00/);
    assert.match(rev, /Preço médio por kg vivo\s*R\$ 10,00/);
    assert.match(rev, /Equivalente em arrobas\s*15,00 @ estimadas a 50,0%, a R\$ 300,00 \(só referência\)/, 'arroba só como equivalente, com a base');
    assert.match(rev, /A receber\s*R\$ 4\.500,00/);
    assert.match(rev, /A pagar\s*R\$ 90,00/);
    assert.match(rev, /Consequência\s*1 animal sai do rebanho como vendido; o histórico fica/);
    await semProblemasDeLeiaute(page, largura, 'revisão da venda');
    await principal(page);
    await page.waitForSelector('[data-resultado="VENDA"]');
    assert.match(await textoTela(page, '[data-resultado]'), /Venda gravada: 1 animal saiu do rebanho, valor bruto de R\$ 4\.500,00\./);
    const vd = vigentesDe(s, 'VENDAS');
    assert.deepEqual(vd.map((x) => [x.modalidade, x.valor_bruto, x.comissao, x.peso_vivo_total_kg, x.criterio_rateio]), [['KG_VIVO', 450000, 9000, 450, 'DIRETO']]);
    await A.ir(page, 'animal/' + id + '/financeiro', '12');
    await page.waitForSelector('[data-secao="financeiro"] [data-bloco-financeiro]');
    const h = await textoTela(page, '[data-secao="financeiro"]');
    assert.match(h, /Receitas\s*R\$ 4\.500,00/);
    assert.match(h, /Despesas de venda\s*R\$ 90,00/);
    assert.match(h, /Venda de 1 animal/);
    await semProblemasDeLeiaute(page, largura, 'bloco financeiro do animal vendido');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}

test('corrigir a venda pelo detalhe do evento: preço de 10,00 para 10,50 por kg e frete retido pelo comprador; diferença e depósito na revisão (1280 px)', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const comp = parceiro(s, 'Frigorífico Rondônia', ['COMPRADOR']);
  const ids = sem.animais.filter((x) => x.brinco === '0457' || x.brinco === '12').map((x) => x.animal_id);
  const v = s.registrar({
    tipo: 'VENDA', campos: { event_date: '2026-08-20', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'KG_VIVO', preco_unitario: 1000, valor_bruto: 900000 },
    animais: [{ animal_id: ids[0], peso: 400 }, { animal_id: ids[1], peso: 500 }], parcelas: [{ data_vencimento: '2026-09-19' }], deducoes: [{ tipo: 'COMISSAO', valor: 18000 }],
  }, 'venda-corr');
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/' + v.event_id });
  const { page } = a;
  await A.esperarTela(page, 'Vender animais');
  await page.waitForSelector('[data-secao="venda"]');
  const det = await textoTela(page, '[data-secao="venda"]');
  assert.match(det, /Receita da venda\s*R\$ 9\.000,00/);
  assert.match(det, /Resultado da negociação\s*R\$ 8\.820,00/);
  assert.match(await textoTela(page, '[data-secao="financeiro"]'), /\(comissão\)/);
  await page.click('[data-acoes-evento] button:has-text("Corrigir")');
  await A.esperarTela(page, 'Corrigir: Vender animais');
  assert.equal(await page.locator('[data-linha]').count(), 2, 'os mesmos 2 animais');
  assert.equal(await page.locator('[data-campo="preco_unitario"] input').inputValue(), '10,00');
  await page.fill('[data-campo="preco_unitario"] input', '10,50');
  await page.fill('[data-campo="valor_bruto"] input', '9.450,00');
  const ded = page.locator('[data-grupo="deducoes"] [data-linha-grupo]').nth(0);
  await ded.locator('[data-campo="tipo"] select').selectOption({ label: 'Frete' });
  await ded.locator('[data-campo="retida_pelo_comprador"] label.opcao', { hasText: 'Sim' }).click();
  // A comissão vencia à vista (na data da venda, o padrão do servidor): a prévia já deixa o vencimento vazio (revisão 3);
  // descontada pelo comprador, ela sai no recebimento sem o usuário apagar nada.
  assert.equal(await ded.locator('[data-campo="data_vencimento"] input').inputValue(), '');
  assert.equal(await page.locator('.marca-inelegivel').count(), 0, 'os animais da venda corrigida não aparecem como inelegíveis');
  await page.fill('[data-campo="justificativa_correcao"] textarea', 'Preço do romaneio e frete descontado');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-diferencas="4"]');
  const dif = await textoTela(page, dialogo + ' [data-diferencas]');
  assert.match(dif, /Preço: de R\$ 10,00 para R\$ 10,50/);
  assert.match(dif, /Valor bruto da venda \(nota ou romaneio\): de R\$ 9\.000,00 para R\$ 9\.450,00/);
  assert.match(dif, /Dedução 1: dedução de Comissão para Frete/);
  assert.match(dif, /Dedução 1: descontada pelo comprador no pagamento de não para sim/);
  assert.doesNotMatch(dif, /Rendimento/, 'o rendimento padrão de um campo oculto não é alteração');
  assert.match(await textoTela(page, dialogo), /Frete da venda de 20\/08\/2026\s*R\$ 180,00 · Frigorífico Rondônia · vence 19\/09\/2026/);
  const rev = await textoTela(page, dialogo);
  assert.match(rev, /Depósito esperado do comprador\s*R\$ 9\.270,00 \(já sem R\$ 180,00 descontados por ele\)/);
  await principal(page);
  await page.waitForSelector('[data-resultado]');
  assert.match(await textoTela(page, '[data-resultado]'), /Correção gravada/);
  const fin = vigentesDe(s, 'FINANCEIRO');
  assert.deepEqual(fin.map((f) => [f.natureza, f.valor, f.retida_pelo_comprador]), [['RECEITA_VENDA_ANIMAIS', 945000, false], ['DESPESA_VENDA', 18000, true]]);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
