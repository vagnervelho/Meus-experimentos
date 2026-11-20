'use strict';
/**
 * Fase 4, E4.4 e E4.5 (CONTRATOS, seção 58), nível 3 (Playwright): as telas do resultado e dos custos.
 *  - Resultado: o ano (os indicadores, o demonstrativo por mês com as contas, o caixa ao lado, os estoques no custo e a
 *    conciliação linha a linha, que fecha) e um mês, com os lançamentos e os animais que o compõem.
 *  - Custos por animal: as colunas do servidor, o filtro de quem saiu, o link para a ficha (bloco H com as classes do custo).
 *  - Custos por pasto: o pasto arrendado com o custo, o alocado e o R$ por animal-dia; os lançamentos dos pastos.
 * A 1280 e a 360 px, sem rolagem horizontal e com os alvos de toque; nenhum número feito no aparelho.
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
const conta = (s, cod) => s.tabela('PLANO_CONTAS').find((c) => c.codigo === cod).conta_id;

/**
 * O rebanho de exemplo, o Pasto B arrendado com o aluguel de setembro rateado pelos dias, a contabilidade sem rateio e a venda do
 * macho 12 em outubro (recebida), com o valor de abertura dele.
 */
function base(s) {
  const ent = A.semear(s);
  const viz = s.api({ rota: 'parceiro.salvar', idempotencyKey: 'p-viz', dados: { campos: { nome: 'Vizinho', tipos: ['ARRENDADOR'] } } }).data.partner_id;
  s.api({ rota: 'pasto.salvar', idempotencyKey: 'p-b', dados: { pasture_id: S.PASTOS.B, campos: { posse: 'ARRENDADO', arrendador_id: viz, area_hectares: 25 }, justificativa: 'Arrendado' } });
  const frig = s.api({ rota: 'parceiro.salvar', idempotencyKey: 'p-frig', dados: { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } } }).data.partner_id;
  const macho = ent.animais.find((a) => a.brinco === '12').animal_id;
  s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-09-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: macho }] }, 'tr-1');
  const arr = s.registrar({ tipo: 'LANCAMENTO_FINANCEIRO', campos: { event_date: '2026-09-01', conta_id: conta(s, 'ARRENDAMENTO_PASTO'), valor: 90000, pasture_id: S.PASTOS.B, partner_id: viz, competencia_inicio: '2026-09-01', competencia_fim: '2026-09-30', descricao: 'Arrendamento de setembro' }, parcelas: [{ data_vencimento: '2026-09-05', pago_em: '2026-09-05' }] }, 'arr-1');
  const fin = s.tabela('FINANCEIRO').find((f) => f.event_id === arr.event_id).financial_id;
  s.registrar({ tipo: 'RATEIO', campos: { event_date: '2026-10-01', financial_id: fin } }, 'rat-1');
  s.registrar({ tipo: 'LANCAMENTO_FINANCEIRO', campos: { event_date: '2026-09-30', conta_id: conta(s, 'CONTABILIDADE'), valor: 25000, descricao: 'Contabilidade de setembro' }, parcelas: [{ data_vencimento: '2026-09-30', pago_em: '2026-09-30' }] }, 'cont-1');
  const v = s.registrar({ tipo: 'VENDA', campos: { event_date: '2026-10-10', partner_id: frig, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: macho }], parcelas: [{ data_vencimento: '2026-10-10' }] }, 'venda-1');
  const fv = s.tabela('FINANCEIRO').find((f) => f.event_id === v.event_id).financial_id;
  const pv = s.tabela('PARCELAS').find((p) => p.financial_id === fv).parcela_id;
  const b = s.api({ rota: 'parcela.baixar', idempotencyKey: 'bx-venda', dados: { parcela_id: pv, data_pagamento: '2026-10-10' } });
  if (!b.ok) throw new Error('baixa recusada: ' + JSON.stringify(b.error));
  return { macho };
}

for (const largura of [1280, 360]) {
  test('resultado (' + largura + ' px): o ano com o demonstrativo por mês e por conta, o caixa ao lado, os estoques e a conciliação linha a linha (fecha); um mês com o que o compõe', async () => {
    const s = A.sistema();
    base(s);
    const a = await A.abrir(s, { largura, hash: 'financeiro/resultado' });
    const { page } = a;
    await A.esperarTela(page, 'Financeiro');
    await page.waitForSelector('[data-resumo-resultado] [data-indicador="resultado"]');
    assert.match(await textoTela(page, '[data-indicador="caixa"]'), /R\$ 1\.850,00/, 'caixa: −900,00 − 250,00 + 3.000,00');
    assert.match(await textoTela(page, '[data-indicador="conciliacao"]'), /Fecha ao centavo/);
    assert.match(await textoTela(page, '[data-indicador="nao-alocado"]'), /R\$ 250,00/, 'a contabilidade, sem rateio');
    const dre = await textoTela(page, '[data-secao="dre"]');
    assert.match(dre, /Arrendamento de pasto/);
    assert.match(dre, /\(−\) Custeio/);
    assert.match(dre, /\(=\) Resultado/);
    assert.match(await textoTela(page, '[data-secao="conciliacao"]'), /Sim, ao centavo/);
    assert.match(await textoTela(page, '[data-secao="ao-lado"]'), /Caixa líquido/);
    await semProblemasDeLeiaute(page, largura, 'resultado do ano');
    // Um mês: setembro, com os lançamentos (o pedido leva o mês e o detalhe; o servidor faz as contas).
    await page.fill('#res-mes', '2026-09');
    await page.click('form[aria-label="Resultado"] button[type=submit]');
    await page.waitForSelector('[data-secao="detalhe"]');
    const pedidos = a.pedidos('financeiro.resultado');
    assert.deepEqual(pedidos[pedidos.length - 1].dados, { mes: '2026-09', detalhe: true });
    const det = await textoTela(page, '[data-secao="detalhe"]');
    assert.match(det, /Arrendamento de setembro/);
    assert.match(det, /Contabilidade de setembro/);
    assert.match(await textoTela(page, '[data-indicador="resultado"]'), /−?R\$\s?-?1\.150,00|-R\$ 1\.150,00|R\$ -1\.150,00/);
    await semProblemasDeLeiaute(page, largura, 'resultado do mês');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });

  test('custos (' + largura + ' px): por animal com as colunas do servidor e o filtro de quem saiu, o link para a ficha (bloco H com as classes); por pasto com o arrendado, o alocado e o R$ por animal-dia', async () => {
    const s = A.sistema();
    const { macho } = base(s);
    const a = await A.abrir(s, { largura, hash: 'financeiro/custos' });
    const { page } = a;
    await A.esperarTela(page, 'Financeiro');
    await page.waitForSelector('[data-resumo-custos] [data-indicador="animais"]');
    assert.equal(await textoTela(page, '[data-indicador="animais"] .indicador-valor'), '4');
    assert.match(await textoTela(page, '[data-indicador="animais"]'), /3 no rebanho · 1 saiu no período/);
    const linha = await textoTela(page, '[data-chave^="' + macho + '|"]');
    assert.match(linha, /Vendido em 10\/10\/2026/);
    assert.match(linha, /R\$ 450,00/, 'metade do arrendamento: o macho e a 0391, 30 dias cada no Pasto B');
    await semProblemasDeLeiaute(page, largura, 'custo por animal');
    // Só os que saíram: o pedido leva o filtro; a lista vem do servidor.
    await page.locator('#cus-situacao').selectOption('SAIRAM');
    await page.click('form[aria-label="Custo por animal"] button[type=submit]');
    await page.waitForFunction(() => ((document.querySelector('[data-indicador="animais"] .indicador-valor') || {}).textContent || '') === '1');
    const ped = a.pedidos('financeiro.custosAnimal');
    assert.equal(ped[ped.length - 1].dados.situacao, 'SAIRAM');
    // A ficha do animal: o bloco H com as classes do custo e o custo por dia.
    await page.click('[data-chave^="' + macho + '|"] a[data-rota^="animal/"]');
    await page.waitForSelector('[data-bloco-financeiro]');
    const h = await textoTela(page, '[data-bloco-financeiro]');
    assert.match(h, /alimentação R\$ 450,00/);
    assert.match(h, /Dias no rebanho/);
    // Por pasto.
    await A.ir(page, 'financeiro/custos/pastos', 'Financeiro');
    await page.waitForSelector('[data-resumo-pastos] [data-indicador="posse-ARRENDADO"]');
    assert.match(await textoTela(page, '[data-indicador="posse-ARRENDADO"]'), /R\$ 900,00/);
    const pb = await textoTela(page, '[data-chave="' + S.PASTOS.B + '"]');
    assert.match(pb, /Arrendado/);
    assert.match(pb, /R\$ 900,00/);
    assert.match(pb, /R\$ 36,00/, 'por hectare: 900,00 ÷ 25 ha');
    assert.match(await textoTela(page, '[data-secao="lancamentos-pastos"]'), /Arrendamento de setembro/);
    await semProblemasDeLeiaute(page, largura, 'custo por pasto');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}
