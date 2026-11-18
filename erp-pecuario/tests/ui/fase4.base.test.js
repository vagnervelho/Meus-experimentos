'use strict';
/**
 * Fase 4, etapa BASE (CONTRATOS, seção 55), nível 3 (Playwright): a folga na página inicial e a tela Financeiro.
 *  - Eventos e Configurações saíram da página inicial e vêm sob demanda: abrir pelo menu pede a tela uma vez (com o esqueleto
 *    enquanto vem), ir e voltar não pede de novo, o detalhe e a correção a partir dele funcionam, o registro de evento (o botão
 *    global) continua sem pedir tela nenhuma; sem rede, "Tentar de novo" e a volta à tela anterior.
 *  - Financeiro (sob demanda): a lista dos lançamentos que já existem (a compra com o frete e a abertura do rebanho), os totais
 *    e os filtros pelo servidor, o detalhe com as parcelas, o rateio entre os animais e o evento de origem; sem rede, "Tentar de
 *    novo"; a 360 px sem rolagem horizontal e com os alvos de toque.
 * Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const telas = (a) => a.pedidos('sistema.tela').map((p) => p.dados.nome);
/** Os pedidos de tela sem os do curral e do tronco, que a Início traz em segundo plano (revisão da Fase 3, rodada 2, achado 18). */
const pedidas = (a) => telas(a).filter((n) => n !== 'Weights' && n !== 'Reproduction');
const enviados = (page, nome) => page.evaluate((n) => window.__gas.pedidos.filter((p) => p.rota === 'sistema.tela' && p.dados && p.dados.nome === n).length, nome);
async function textoTela(page, sel) { return (await page.textContent(sel)).replace(/\s+/g, ' ').trim(); }
async function semProblemasDeLeiaute(page, largura, onde) {
  const r = await A.semRolagemHorizontal(page);
  assert.ok(r.sw <= r.cw, onde + ': sem rolagem horizontal a ' + largura + ' px (' + r.sw + ' > ' + r.cw + ')');
  if (largura < 900) assert.deepEqual(await A.alvosDeToque(page, '#conteudo'), [], onde + ': alvos de toque');
}
/** O rebanho de exemplo, um fornecedor e uma compra de 2 garrotes com 2 parcelas e frete (R$ 2.000,00 + R$ 60,00). */
function comCompra(s) {
  A.semear(s);
  const forn = s.api({ rota: 'parceiro.salvar', idempotencyKey: 'p-forn', dados: { campos: { nome: 'Fazenda Vizinha', tipos: ['FORNECEDOR'] } } }).data.partner_id;
  const garrote = (brinco) => ({ brinco, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14, peso: 240 });
  const c = s.registrar({
    tipo: 'COMPRA', campos: { event_date: '2026-03-10', partner_id: forn, pasto_destino_id: S.PASTOS.A, modalidade: 'CABECA', preco_unitario: 100000, valor_animais: 200000 },
    animais: [garrote('801'), garrote('802')],
    parcelas: [{ data_vencimento: '2026-04-10', valor: 100000 }, { data_vencimento: '2099-05-10', valor: 100000 }],
    custos: [{ tipo: 'FRETE', valor: 6000, partner_id: forn }],
  }, 'compra-1');
  return { forn, compra: c.event_id };
}

test('Eventos sob demanda: fora da página inicial; o menu pede a tela uma vez; detalhe, volta e correção; o registro (botão global) não pede tela (1280 px)', async () => {
  const s = A.sistema();
  const { compra } = comCompra(s);
  const a = await A.abrir(s, { largura: 1280, hash: 'inicio' });
  const { page } = a;
  await A.esperarTela(page, 'Início');
  assert.equal(await page.evaluate(() => typeof window.TelaEventos), 'undefined', 'a página inicial não traz os eventos');
  assert.equal(await page.evaluate(() => typeof window.TelaConfig), 'undefined', 'nem as configurações');
  // O registro de evento continua na página inicial: abrir o seletor não pede tela.
  await page.click('.topo-acoes a:has-text("REGISTRAR EVENTO")');
  await A.esperarTela(page, 'Registrar evento');
  assert.equal(telas(a).filter((n) => n === 'Events').length, 0, 'o seletor de tipo é da página inicial');
  // Mais lento que o normal: o esqueleto aparece enquanto a tela vem.
  await page.evaluate(() => { window.__gas.atrasoMs = 400; });
  await page.click('#menu .menu-item:has-text("Eventos")');
  await page.waitForSelector('#conteudo [data-tela-sob-demanda="Events"] .esqueleto');
  await page.evaluate(() => { window.__gas.atrasoMs = 20; });
  await A.esperarTela(page, 'Eventos');
  await page.waitForSelector('[data-chave="' + compra + '"]');
  assert.equal(telas(a).filter((n) => n === 'Events').length, 1);
  assert.equal(await page.locator('script[data-modulo="Events"]').count(), 1, 'injetada uma vez');
  // O detalhe da compra (mesma tela, sem novo pedido) e a volta.
  await page.click('[data-chave="' + compra + '"] a[data-rota="evento/' + compra + '"]');
  await A.esperarTela(page, 'Comprar animais');
  await page.waitForSelector('[data-secao="financeiro"]');
  await page.goBack();
  await A.esperarTela(page, 'Eventos');
  await A.ir(page, 'inicio', 'Início');
  await A.ir(page, 'evento/' + compra, 'Comprar animais');
  assert.equal(telas(a).filter((n) => n === 'Events').length, 1, 'ir e voltar não pede a tela de novo');
  // A correção a partir do detalhe abre o formulário do registro com a compra.
  await page.click('[data-acoes-evento] button:has-text("Corrigir")');
  await page.waitForSelector('.form-evento');
  assert.match(await textoTela(page, '#conteudo'), /Corrigir|correção/i);
  assert.deepEqual(a.estado.erros, [], 'nenhum erro no console');
  await a.fechar();
});

test('falha de rede ao abrir os Eventos e as Configurações: mensagem clara e "Tentar de novo"; a volta funciona; depois abrem (360 px)', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 360, hash: 'rebanho' });
  const { page } = a;
  await A.esperarTela(page, 'Rebanho');
  for (const [rota, tela, titulo, nomeModulo] of [['eventos', 'Events', 'Eventos', 'Eventos'], ['config/parametros', 'Settings', 'Configurações', 'Configurações']]) {
    await page.evaluate(() => { window.__gas.falharTransporte = 1; });
    await A.ir(page, rota, 'Não foi possível abrir ' + nomeModulo);
    assert.equal(await page.getAttribute('#conteudo [data-erro]', 'data-erro'), 'TRANSPORTE', tela);
    assert.match(await textoTela(page, '#conteudo [data-erro]'), /Sem conexão com o servidor\. Confira o sinal e tente de novo\./);
    assert.deepEqual(await A.alvosDeToque(page, '#conteudo'), [], 'alvos de toque na tela de erro (' + tela + ')');
    await page.goBack();
    await A.esperarTela(page, 'Rebanho');
    await page.evaluate(() => { window.__gas.falharTransporte = 1; });
    await A.ir(page, rota, 'Não foi possível abrir ' + nomeModulo);
    await page.click('#conteudo button:has-text("Tentar de novo")');
    await A.esperarTela(page, titulo);
    assert.equal(await enviados(page, tela), 3, tela + ': duas tentativas sem rede e a que abriu');
    assert.deepEqual(telas(a).filter((n) => n === tela), [tela], tela + ': só uma chegou ao servidor');
    await semProblemasDeLeiaute(page, 360, titulo);
    await A.ir(page, 'rebanho', 'Rebanho');
  }
  assert.deepEqual(a.estado.erros, [], 'nenhum erro no console');
  await a.fechar();
});

for (const largura of [1280, 360]) {
  test('Financeiro: a lista dos lançamentos com os totais e os filtros do servidor, o detalhe com as parcelas, o rateio e o evento de origem; a volta (' + largura + ' px)', async () => {
    const s = A.sistema();
    const { compra } = comCompra(s);
    const a = await A.abrir(s, { largura, hash: 'inicio' });
    const { page } = a;
    await A.esperarTela(page, 'Início');
    assert.equal(await page.evaluate(() => typeof window.TelaFinanceiro), 'undefined', 'a página inicial não traz o financeiro');
    if (largura < 900) {
      await page.click('#barra [data-mais]');
      await page.click('[role=dialog] .menu-item:has-text("Financeiro")');
    } else await page.click('#menu .menu-item:has-text("Financeiro")');
    await A.esperarTela(page, 'Financeiro');
    await page.waitForSelector('[data-resumo-financeiro]:not(:empty)');
    assert.equal(await textoTela(page, '[data-resumo-financeiro]'), '2 lançamentos · receitas R$ 0,00 · despesas R$ 2.060,00', 'os totais vêm do servidor');
    assert.deepEqual(pedidas(a), ['Financial']);
    const textoLista = await textoTela(page, '#conteudo');
    assert.match(textoLista, /Compra de 2 animais/);
    assert.match(textoLista, /Frete da compra de 10\/03\/2026/);
    await semProblemasDeLeiaute(page, largura, 'lista do financeiro');
    // O filtro vai ao servidor: só as receitas (nenhuma).
    await page.selectOption('#fin-tipo', 'RECEITA');
    await page.click('form.filtros button[type=submit]');
    await A.esperarServidor(page);
    await page.waitForSelector('[data-resumo-financeiro]:not(:empty)');
    assert.match(await textoTela(page, '[data-resumo-financeiro]'), /^0 lançamentos/);
    assert.match(await textoTela(page, '#conteudo'), /Nenhum lançamento com esses filtros/);
    const pedidos = a.pedidos('financeiro.lancamentos');
    assert.deepEqual(pedidos[pedidos.length - 1].dados, { pagina: 1, situacao: 'ATIVO', tipo: 'RECEITA' });
    await page.selectOption('#fin-tipo', '');
    await page.click('form.filtros button[type=submit]');
    await A.esperarServidor(page);
    await page.waitForSelector('a[data-rota^="financeiro/lancamento/"]');
    // O detalhe da compra: parcelas (a de abril vencida, contada no servidor), o rateio entre os 2 garrotes e o evento.
    await page.click('a[data-rota^="financeiro/lancamento/"]:has-text("Compra de 2 animais")');
    await A.esperarTela(page, 'Compra de 2 animais');
    await page.waitForSelector('[data-secao="parcelas"]');
    const parcelas = await textoTela(page, '[data-secao="parcelas"]');
    assert.match(parcelas, /Vencida há \d+ dias/, 'a parcela de abril venceu: os dias de atraso vêm do servidor');
    assert.match(parcelas, /A pagar/);
    const rateio = await textoTela(page, '[data-secao="rateio"]');
    assert.match(rateio, /Igual por cabeça/);
    assert.match(rateio, /801/);
    assert.match(rateio, /R\$ 1\.000,00/);
    assert.match(await textoTela(page, '[data-secao="lancamento"]'), /Comprar animais de 10\/03\/2026/);
    await semProblemasDeLeiaute(page, largura, 'detalhe do lançamento');
    // O evento de origem (a tela dos eventos vem sob demanda) e a volta ao detalhe e à lista.
    await page.click('[data-secao="lancamento"] a[data-rota="evento/' + compra + '"]');
    await A.esperarTela(page, 'Comprar animais');
    assert.deepEqual(pedidas(a), ['Financial', 'Events']);
    await page.goBack();
    await A.esperarTela(page, 'Compra de 2 animais');
    await page.goBack();
    await A.esperarTela(page, 'Financeiro');
    assert.deepEqual(pedidas(a), ['Financial', 'Events'], 'ir e voltar não pede as telas de novo');
    assert.deepEqual(await page.evaluate(() => window.__gas.violacoes), []);
    assert.deepEqual(a.estado.erros, [], 'nenhum erro no console');
    await a.fechar();
  });
}

test('falha de rede ao abrir o Financeiro e ao buscar o detalhe: "Tentar de novo" e "Ver todos os lançamentos"; a volta funciona (360 px)', async () => {
  const s = A.sistema();
  comCompra(s);
  const a = await A.abrir(s, { largura: 360, hash: 'rebanho' });
  const { page } = a;
  await A.esperarTela(page, 'Rebanho');
  await page.evaluate(() => { window.__gas.falharTransporte = 1; });
  await A.ir(page, 'financeiro/lancamentos', 'Não foi possível abrir Financeiro');
  assert.equal(await page.evaluate(() => typeof window.TelaFinanceiro), 'undefined');
  await page.goBack();
  await A.esperarTela(page, 'Rebanho');
  await A.ir(page, 'financeiro/lancamentos', 'Financeiro');
  await page.waitForSelector('a[data-rota^="financeiro/lancamento/"]');
  // A lista que falha ao buscar: o erro com "Tentar de novo" na própria tela.
  await page.evaluate(() => { window.__gas.falharTransporte = 1; });
  await page.click('form.filtros button[type=submit]');
  await page.waitForSelector('#conteudo [data-erro="TRANSPORTE"]');
  await page.click('#conteudo button:has-text("Tentar de novo")');
  await page.waitForSelector('a[data-rota^="financeiro/lancamento/"]');
  // O detalhe de um lançamento que não existe: a mensagem do servidor e o caminho de volta.
  await A.ir(page, 'financeiro/lancamento/nao-existe');
  await page.waitForSelector('#conteudo [data-erro]');
  assert.match(await textoTela(page, '#conteudo [data-erro]'), /Lançamento financeiro não encontrado/);
  await page.click('#conteudo button:has-text("Ver todos os lançamentos")');
  await A.esperarTela(page, 'Financeiro');
  await semProblemasDeLeiaute(page, 360, 'financeiro depois da falha');
  assert.deepEqual(a.estado.erros, [], 'nenhum erro no console');
  await a.fechar();
});
