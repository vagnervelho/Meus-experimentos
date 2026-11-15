'use strict';
/**
 * Compra e financeiro do evento na tela (nível 3, Playwright): registrar uma compra pela grade de animais novos, com a
 * negociação no cabeçalho, as parcelas e o frete como grupos, a revisão calculada pelo servidor (evento.simular) e o
 * custo por animal na ficha (bloco H); corrigir a compra pelo detalhe do evento (frete de R$ 30,00 para R$ 300,00,
 * a diferença na revisão, os mesmos animais); morte com custos associados na conta escolhida (revisão pelo servidor).
 * Em todas: sem rolagem horizontal, alvos de toque ≥ 48 px a 360 px e nenhum erro no console. Roda por
 * `npm run ui:check`.
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
  test('compra pela tela: negociação, grade de animais, parcela e frete; revisão do servidor; custo por animal na ficha (' + largura + ' px)', async () => {
    const s = A.sistema();
    A.semear(s);
    const forn = parceiro(s, 'Fazenda Vizinha', ['FORNECEDOR']);
    const a = await A.abrir(s, { largura, hash: 'evento/novo/COMPRA' });
    const { page } = a;
    await A.esperarTela(page, 'Comprar animais');
    await page.fill('[data-campo="event_date"] input', '2026-03-10');
    await page.locator('[data-campo="partner_id"] select').selectOption(forn);
    await page.locator('[data-campo="modalidade"] select').selectOption('CABECA');
    await page.fill('[data-campo="preco_unitario"] input', '1.500,00');
    await page.fill('[data-campo="valor_animais"] input', '3.000,00');
    await page.locator('[data-campo="pasto_destino_id"] select[id^="ev-"]').selectOption({ label: 'Pasto B' });
    assert.equal(await page.locator('[data-campo="base_peso"]').isVisible(), false, 'base de peso só na arroba');
    const cartoes = page.locator('[data-linha]');
    const preencher = async (i, brinco) => {
      const c = cartoes.nth(i);
      await c.locator('[data-campo="brinco"] input').fill(brinco);
      await c.locator('[data-campo="sexo"] label.opcao', { hasText: 'Macho' }).click();
      await c.locator('[data-campo="castrado"] label.opcao', { hasText: 'Não' }).click();
      await c.locator('[data-campo="reprodutor"] label.opcao', { hasText: 'Não' }).click();
      await c.locator('[data-campo="idade_meses"] input').fill('14');
    };
    await preencher(0, '801');
    await page.click('button:has-text("+ Outro animal")');
    await preencher(1, '802');
    const parcelas = page.locator('[data-grupo="parcelas"] [data-linha-grupo]');
    assert.equal(await parcelas.count(), 1, 'a compra começa com uma parcela');
    await parcelas.nth(0).locator('[data-campo="data_vencimento"] input').fill('2026-04-10');
    await page.click('[data-grupo="custos"] button:has-text("Frete ou outro custo")');
    await page.locator('[data-grupo="custos"] [data-linha-grupo]').nth(0).locator('[data-campo="valor"] input').fill('60,00');
    await semProblemasDeLeiaute(page, largura, 'formulário da compra');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
    assert.equal(a.pedidos('evento.simular').length, 1, 'revisão pelo servidor (compra)');
    const rev = await textoTela(page, dialogo);
    assert.match(rev, /Fornecedor \(quem vendeu\)\s*Fazenda Vizinha/);
    assert.match(rev, /Valor dos animais\s*R\$ 3\.000,00/);
    assert.match(rev, /Frete\s*R\$ 60,00/);
    assert.match(rev, /Custo total da compra\s*R\$ 3\.060,00/);
    assert.match(rev, /Conta pelo preço \(conferência\)\s*R\$ 3\.000,00 · confere/);
    assert.match(rev, /Divisão entre os animais\s*Igual por cabeça/);
    assert.match(rev, /Valor por animal\s*R\$ 1\.530,00/);
    assert.match(rev, /A pagar\s*R\$ 3\.060,00/);
    await principal(page);
    await page.waitForSelector('[data-resultado="COMPRA"]');
    assert.match(await textoTela(page, '[data-resultado]'), /Compra gravada: 2 animais entraram no rebanho, custo total de R\$ 3\.060,00/);
    const novos = vigentesDe(s, 'ANIMAIS').filter((x) => x.origem === 'COMPRADO');
    assert.deepEqual(novos.map((x) => [x.brinco, x.custo_aquisicao, x.pasto_atual_id]).sort(), [['801', 153000, S.PASTOS.B], ['802', 153000, S.PASTOS.B]]);
    assert.equal(vigentesDe(s, 'PARCELAS').length, 2);
    await A.ir(page, 'animal/' + novos[0].animal_id + '/financeiro', novos[0].brinco);
    await page.waitForSelector('[data-secao="financeiro"] [data-bloco-financeiro]');
    const h = await textoTela(page, '[data-secao="financeiro"]');
    assert.match(h, /Custo de aquisição\s*R\$ 1\.530,00 · preço da compra/);
    assert.match(h, /Compra de 2 animais/);
    assert.match(h, /Frete da compra de 10\/03\/2026/);
    assert.match(h, /Fase|Financeiro/, 'diz o que ainda chega');
    await semProblemasDeLeiaute(page, largura, 'bloco financeiro da ficha');
    await A.ir(page, 'inicio', 'Início');
    await page.waitForSelector('[data-secao="titulos"]');
    assert.match(await textoTela(page, '[data-secao="titulos"]'), /A pagar\s*R\$ 3\.060,00/);
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}

test('corrigir a compra pelo detalhe do evento: frete de 30,00 para 300,00, mesmos animais, diferença na revisão (1280 px)', async () => {
  const s = A.sistema();
  const forn = parceiro(s, 'Leilão Rondônia', ['FORNECEDOR']);
  const c = s.registrar({
    tipo: 'COMPRA', campos: { event_date: '2026-02-05', partner_id: forn, pasto_destino_id: S.PASTOS.A, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 900000 },
    animais: ['0801', '0802', '0803'].map((b) => ({ brinco: b, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 })),
    parcelas: [{ data_vencimento: '2026-03-05', valor: 450000 }, { data_vencimento: '2026-04-05', valor: 450000 }], custos: [{ tipo: 'FRETE', valor: 3000 }],
  }, 'compra-ct15');
  const ids = c.animais.map((x) => x.animal_id);
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/' + c.event_id });
  const { page } = a;
  await A.esperarTela(page, 'Comprar animais');
  await page.waitForSelector('[data-secao="compra"]');
  assert.match(await textoTela(page, '[data-secao="compra"]'), /Custo total\s*R\$ 9\.030,00/);
  assert.match(await textoTela(page, '[data-secao="financeiro"]'), /Compra de 3 animais: R\$ 9\.000,00/);
  await page.click('[data-acoes-evento] button:has-text("Corrigir")');
  await A.esperarTela(page, 'Corrigir: Comprar animais');
  assert.equal(await page.locator('[data-linha]').count(), 3, 'os mesmos 3 animais');
  assert.equal(await page.locator('[data-grupo="parcelas"] [data-linha-grupo]').count(), 2);
  const frete = page.locator('[data-grupo="custos"] [data-linha-grupo]').nth(0).locator('[data-campo="valor"] input');
  assert.equal(await frete.inputValue(), '30,00');
  await frete.fill('300,00');
  await page.fill('[data-campo="justificativa_correcao"] textarea', 'Frete lançado errado');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-diferencas="1"]');
  assert.match(await textoTela(page, dialogo + ' [data-diferencas]'), /Custo 1: valor de R\$ 30,00 para R\$ 300,00/);
  assert.match(await textoTela(page, dialogo), /Custo total da compra\s*R\$ 9\.300,00/);
  await principal(page);
  await page.waitForSelector('[data-resultado]');
  assert.match(await textoTela(page, '[data-resultado]'), /Correção gravada/);
  const animais = vigentesDe(s, 'ANIMAIS').filter((x) => ids.includes(x.animal_id));
  assert.deepEqual(animais.map((x) => x.custo_aquisicao), [310000, 310000, 310000], 'mesmos animais, custo de R$ 3.010,00 para R$ 3.100,00');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('morte com custos associados: conta de custeio escolhida, revisão pelo servidor, lançamento rateado (360 px)', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = sem.animais.find((x) => x.brinco === '12').animal_id;
  const a = await A.abrir(s, { largura: 360, hash: 'animal/' + id + '/resumo' });
  const { page } = a;
  await A.esperarTela(page, '12');
  await page.click('[data-atalho-ficha="MORTE"]');
  await A.esperarTela(page, 'Morte');
  await page.fill('[data-campo="event_date"] input', '2026-05-01');
  await page.locator('[data-campo="causa"] select').selectOption({ label: 'Doença' });
  await page.fill('[data-campo="custo_valor"] input', '120,00');
  await page.locator('[data-campo="custo_conta_id"] select').selectOption({ label: 'Serviços veterinários' });
  await semProblemasDeLeiaute(page, 360, 'formulário da morte com custo');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
  assert.equal(a.pedidos('evento.simular').length, 1, 'com custo, a revisão vai ao servidor');
  assert.match(await textoTela(page, dialogo), /Custos da morte de 01\/05\/2026\s*R\$ 120,00 · vence 01\/05\/2026/);
  await principal(page);
  await page.waitForSelector('[data-resultado="MORTE"]');
  const fin = vigentesDe(s, 'FINANCEIRO');
  assert.deepEqual(fin.map((f) => [f.natureza, f.valor, f.animal_id]), [['CUSTEIO', 12000, id]]);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
