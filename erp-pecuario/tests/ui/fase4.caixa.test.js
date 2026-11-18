'use strict';
/**
 * Fase 4, E4.1 e E4.2 (CONTRATOS, seção 56), nível 3 (Playwright): as telas do Financeiro desta etapa.
 *  - O lançamento avulso pelo formulário do catálogo ("Novo lançamento"), com a revisão do servidor e as parcelas.
 *  - A pagar e a receber: os totais do servidor, receber e pagar uma parcela (com a conferência do valor pago pelo servidor),
 *    marcar várias e dar baixa de uma vez, desfazer a baixa, dividir a parcela; o depósito esperado da venda com retenção.
 *  - O fluxo de caixa: a tabela por período, o gráfico SVG do líquido e o do saldo (com o saldo inicial), em outra data.
 *  - O plano de contas nas Configurações: criar e editar uma conta.
 * A 1280 e a 360 px, sem rolagem horizontal e com os alvos de toque; nenhum número feito no aparelho.
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
async function textoTela(page, sel) { return (await page.textContent(sel)).replace(/\s+/g, ' ').trim(); }
async function semProblemasDeLeiaute(page, largura, onde) {
  const r = await A.semRolagemHorizontal(page);
  assert.ok(r.sw <= r.cw, onde + ': sem rolagem horizontal a ' + largura + ' px (' + r.sw + ' > ' + r.cw + ')');
  if (largura < 900) assert.deepEqual(await A.alvosDeToque(page, '#conteudo'), [], onde + ': alvos de toque');
}
const conta = (s, cod) => s.tabela('PLANO_CONTAS').find((c) => c.codigo === cod).conta_id;
const parcelas = (s) => s.read({ rota: 't', reads: ['PARCELAS', 'FINANCEIRO', 'EVENTOS', 'OPERACOES'], tratador: (tx) => tx.repo.vigentes('PARCELAS') });

/** Dois avulsos (a despesa em 2 parcelas e a receita em 1) e uma venda com dedução retida pelo comprador. */
function base(s) {
  const ent = A.semear(s);
  s.registrar({ tipo: 'LANCAMENTO_FINANCEIRO', campos: { event_date: '2026-10-01', conta_id: conta(s, 'COMBUSTIVEL'), valor: 60000, descricao: 'Diesel do trator' }, parcelas: [{ data_vencimento: '2026-10-20' }, { data_vencimento: '2026-12-20' }] }, 'av-1');
  s.registrar({ tipo: 'LANCAMENTO_FINANCEIRO', campos: { event_date: '2026-10-05', conta_id: conta(s, 'RECEITAS_EXTRAORDINARIAS'), valor: 150000, descricao: 'Venda da carroça' }, parcelas: [{ data_vencimento: '2026-11-30' }] }, 'av-2');
  const frig = s.api({ rota: 'parceiro.salvar', idempotencyKey: 'p-frig', dados: { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } } }).data.partner_id;
  const macho = ent.animais.find((a) => a.brinco === '12').animal_id;
  s.registrar({ tipo: 'VENDA', campos: { event_date: '2026-11-01', partner_id: frig, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: macho }], parcelas: [{ data_vencimento: '2026-11-25' }], deducoes: [{ tipo: 'FUNRURAL', valor: 4500, retida_pelo_comprador: true }] }, 'venda-1');
}

for (const largura of [1280, 360]) {
  test('lançamento avulso pela tela (' + largura + ' px): "Novo lançamento" abre o formulário do catálogo; a revisão é do servidor; gravado, a lista do Financeiro o mostra', async () => {
    const s = A.sistema();
    A.semear(s);
    const a = await A.abrir(s, { largura, hash: 'financeiro' });
    const { page } = a;
    await A.esperarTela(page, 'Financeiro');
    await page.click('[data-novo-lancamento]');
    await A.esperarTela(page, 'Lançamento financeiro');
    await page.locator('[data-campo="conta_id"] select').selectOption(conta(s, 'ENERGIA'));
    await page.fill('[data-campo="valor"] input', '480,00');
    await page.fill('[data-campo="descricao"] input', 'Conta de luz de outubro');
    const linhas = page.locator('[data-grupo="parcelas"] [data-linha-grupo]');
    await linhas.nth(0).locator('[data-campo="data_vencimento"] input').fill('2026-11-20');
    await semProblemasDeLeiaute(page, largura, 'formulário do avulso');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
    assert.equal(a.pedidos('evento.simular').length, 1, 'revisão pelo servidor');
    assert.match(await textoTela(page, dialogo), /R\$ 480,00/);
    await principal(page);
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    await A.ir(page, 'financeiro/lancamentos', 'Financeiro');
    await page.waitForSelector('[data-resumo-financeiro]:not(:empty)');
    assert.match(await textoTela(page, '#conteudo'), /Conta de luz de outubro/);
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });

  test('a pagar e a receber (' + largura + ' px): os totais do servidor; pagar uma parcela com juros (conferida pelo servidor), dividir outra, desfazer a baixa; o depósito esperado da venda com retenção; marcar e dar baixa de uma vez', async () => {
    const s = A.sistema();
    base(s);
    const a = await A.abrir(s, { largura, hash: 'financeiro/titulos' });
    const { page } = a;
    await A.esperarTela(page, 'Financeiro');
    await page.waitForSelector('[data-totais-titulos] [data-indicador="a_pagar"]');
    assert.match(await textoTela(page, '[data-indicador="a_pagar"]'), /R\$ 645,00/, '600,00 do diesel e 45,00 da retenção');
    assert.match(await textoTela(page, '#conteudo'), /depósito esperado R\$ 2\.955,00/);
    // Pagar a 1ª parcela do diesel, vencida, com juros: o valor pago vem do servidor.
    const diesel = parcelas(s).filter((p) => p.valor === 30000).sort((x, y) => (x.data_vencimento < y.data_vencimento ? -1 : 1));
    await page.click('[data-baixar="' + diesel[0].parcela_id + '"]');
    await page.waitForSelector(dialogo + ' [data-campo="data_pagamento"]');
    await page.fill(dialogo + ' [data-campo="data_pagamento"] input', '2026-11-10');
    await page.fill(dialogo + ' [data-campo="juros_multa"] input', '12,50');
    await page.click(dialogo + ' [data-conferir-baixa]');
    await page.waitForFunction(() => /R\$\s312,50/.test((document.querySelector('[data-previa-baixa]') || {}).textContent || ''));
    assert.equal(a.pedidos('parcela.simular').length, 1);
    await semProblemasDeLeiaute(page, largura, 'folha da baixa');
    await principal(page);
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    await page.waitForFunction((id) => !document.querySelector('[data-baixar="' + id + '"]'), diesel[0].parcela_id);
    assert.deepEqual(parcelas(s).filter((p) => p.parcela_id === diesel[0].parcela_id).map((p) => [p.status, p.data_pagamento, p.valor_pago, p.juros_multa]), [['LIQUIDADA', '2026-11-10', 31250, 1250]]);
    // Dividir a 2ª em duas (os vencimentos e os valores vêm do servidor).
    await page.click('[data-dividir="' + diesel[1].parcela_id + '"]');
    await page.waitForSelector(dialogo + ' [data-campo="primeiro"]');
    await page.fill(dialogo + ' [data-campo="primeiro"] input', '2026-12-20');
    await page.fill(dialogo + ' [data-campo="justificativa"] :is(input, textarea)', 'Combinado com o posto');
    await page.click(dialogo + ' [data-conferir-divisao]');
    await page.waitForFunction(() => /20\/01\/2027/.test((document.querySelector('[data-previa-divisao]') || {}).textContent || ''));
    await principal(page);
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    await page.waitForFunction(() => document.querySelectorAll('[data-baixar]').length === 4);
    // Marcar todas e dar baixa de uma vez: a receita, as duas do diesel e o recebimento da venda (que leva a retenção junto).
    await page.click('button:has-text("Selecionar os")');
    await page.waitForSelector('[data-baixa-lote="4"]');
    await page.click('[data-baixa-lote="4"]');
    await page.waitForSelector(dialogo + ' [data-campo="data_pagamento"]');
    await page.fill(dialogo + ' [data-campo="data_pagamento"] input', '2026-11-12');
    await principal(page);
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    await page.waitForFunction(() => /Nada a pagar nem a receber/.test(document.querySelector('#conteudo').textContent));
    assert.ok(parcelas(s).every((p) => p.status === 'LIQUIDADA'), 'tudo pago, a retenção junto com o recebimento');
    // Pagos e recebidos: desfazer a baixa da receita da carroça.
    await page.locator('#tit-situacao').selectOption('PAGOS');
    await page.click('form[aria-label="Filtrar títulos"] button[type=submit]');
    const carroca = parcelas(s).find((p) => p.valor === 150000);
    await page.waitForSelector('[data-desfazer="' + carroca.parcela_id + '"]');
    await page.click('[data-desfazer="' + carroca.parcela_id + '"]');
    await page.fill(dialogo + ' [data-campo="justificativa"] :is(input, textarea)', 'Cheque devolvido');
    await principal(page);
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    assert.equal(parcelas(s).find((p) => p.parcela_id === carroca.parcela_id).status, 'ABERTA');
    await semProblemasDeLeiaute(page, largura, 'a pagar e a receber');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });

  test('fluxo de caixa (' + largura + ' px): a tabela por período e o gráfico SVG do líquido; com o saldo inicial, o saldo de cada período e o gráfico dele; noutra data', async () => {
    const s = A.sistema();
    base(s);
    s.api({ rota: 'config.salvar', idempotencyKey: 'cfg-saldo', dados: { valores: { caixa_saldo_inicial: '5000', caixa_saldo_inicial_data: '2026-10-01' } } });
    const a = await A.abrir(s, { largura, hash: 'financeiro/fluxo' });
    const { page } = a;
    await A.esperarTela(page, 'Financeiro');
    await page.waitForSelector('[data-grafico-id="fluxo-liquido"] svg');
    await page.waitForSelector('[data-grafico-id="fluxo-saldo"] svg');
    assert.match(await textoTela(page, '[data-indicador="saldo"]'), /R\$ 5\.000,00/);
    const tabela = await textoTela(page, '[data-chave="2026-12-01"]');
    assert.match(tabela, /dez\/2026/);
    assert.match(tabela, /R\$ 300,00/, 'a 2ª parcela do diesel, prevista em dezembro');
    // Noutra data: em 15/10, nada realizado, o saldo é o inicial.
    await page.fill('#flx-data', '2026-10-15');
    await page.locator('#flx-agrupar').selectOption('SEMANA');
    await page.click('form[aria-label="Fluxo de caixa"] button[type=submit]');
    await page.waitForFunction(() => /15\/10\/2026/.test((document.querySelector('[data-indicador="saldo"]') || {}).textContent || ''));
    const pedidos = a.pedidos('financeiro.fluxoCaixa');
    assert.deepEqual(pedidos[pedidos.length - 1].dados, { agrupar: 'SEMANA', data: '2026-10-15' });
    await semProblemasDeLeiaute(page, largura, 'fluxo de caixa');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}

test('plano de contas nas Configurações (360 px): criar uma conta pela natureza e renomeá-la', async () => {
  const s = A.sistema();
  const a = await A.abrir(s, { largura: 360, hash: 'config/contas' });
  const { page } = a;
  await A.esperarTela(page, 'Configurações');
  await page.click('button:has-text("Nova conta")');
  await page.waitForSelector(dialogo + ' [data-campo="natureza"]');
  await page.fill(dialogo + ' [data-campo="nome"] input', 'Aluguel de máquinas');
  await page.locator(dialogo + ' [data-campo="natureza"] select').selectOption('CUSTEIO');
  await page.locator(dialogo + ' [data-campo="grupo"] select').selectOption('CUSTO_OPERACIONAL');
  await page.locator(dialogo + ' [data-campo="classe_custo_animal"] select').selectOption('OUTROS');
  await semProblemasDeLeiaute(page, 360, 'folha da conta');
  await principal(page);
  await page.waitForFunction(() => /Aluguel de máquinas/.test(document.querySelector('#conteudo').textContent));
  const c = s.tabela('PLANO_CONTAS').find((x) => x.nome === 'Aluguel de máquinas');
  assert.deepEqual([c.codigo, c.natureza, c.tipo, c.sistema], ['ALUGUEL_DE_MAQUINAS', 'CUSTEIO', 'DESPESA', false]);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
