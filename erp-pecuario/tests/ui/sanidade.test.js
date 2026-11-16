'use strict';
/**
 * Sanidade e insumos na tela (Fase 3, E3.2 e E3.3), nível 3 (Playwright): a tela vem sob demanda (Health); o cadastro do
 * produto (controle de estoque, custo por unidade, carência e dose padrão) e do protocolo pela folha; a entrada de estoque
 * pelo botão do produto (revisão do servidor com a quantidade, o custo por unidade e o saldo); a agenda com as doses
 * atrasadas e o "Aplicar" que abre o lançamento com o protocolo, o produto, a dose e a carência sugeridos e os animais
 * pendentes; a revisão do servidor com a dose, o que sai do frasco, o estoque, o custo pelo consumo, a carência e a próxima
 * aplicação; a agenda depois (nada atrasado, animais em carência), o bloco sanitário da ficha (bloco F) e o selo de
 * carência no cartão da venda. Em todas: sem rolagem horizontal, alvos de toque ≥ 48 px a 360 px e nenhum erro no console.
 * Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

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
const vigentesDe = (s, aba) => s.read({ rota: 't', reads: [aba, 'EVENTOS', 'OPERACOES'], tratador: (tx) => tx.repo.vigentes(aba) });
function ok(s, rota, dados, chave) {
  const r = s.api({ rota, idempotencyKey: chave, dados });
  if (!r.ok) throw new Error(rota + ': ' + JSON.stringify(r.error));
  return r.data;
}

test('produtos e estoque a 360 px: cadastro do produto e do protocolo pela folha; entrada de estoque pelo botão do produto, com a revisão do servidor; o saldo na lista', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 360, hash: 'sanidade/produtos' });
  const { page } = a;
  await A.esperarTela(page, 'Sanidade');
  assert.equal(a.pedidos('sistema.tela').map((p) => p.dados.nome).join(), 'Health', 'a tela vem sob demanda');
  assert.match(await textoTela(page, '[data-produtos]'), /Nenhum produto cadastrado/);
  await semProblemasDeLeiaute(page, 360, 'produtos vazios');
  // Produto novo: vacina com estoque controlado, custo por dose, carência e dose padrão.
  await page.click('button:has-text("Novo produto")');
  await page.waitForSelector(dialogo + ' [data-cadastro="produto.salvar"]');
  await page.fill(dialogo + ' [data-campo="nome"] input', 'Vacina Aftosa');
  await page.locator(dialogo + ' [data-campo="categoria"] select').selectOption('VACINA');
  await page.fill(dialogo + ' [data-campo="unidade"] input', 'dose');
  await page.fill(dialogo + ' [data-campo="fator_conversao"] input', '50');
  await page.fill(dialogo + ' [data-campo="custo_unitario"] input', '1,85');
  await page.fill(dialogo + ' [data-campo="dose_padrao_por_cabeca"] input', '2');
  await page.fill(dialogo + ' [data-campo="carencia_padrao_dias"] input', '30');
  await page.click(dialogo + ' [data-campo="controla_estoque"] label:has-text("Sim")');
  assert.equal(await page.locator(dialogo + ' [data-campo="estoque_minimo"]').isVisible(), true, 'o mínimo aparece com o controle de estoque');
  await page.fill(dialogo + ' [data-campo="estoque_minimo"] input', '20');
  await principal(page);
  await page.waitForSelector('#produtos, [data-produtos] .tabela-componente');
  const prod = vigentesDe(s, 'PRODUTOS');
  assert.deepEqual(prod.map((p) => [p.nome, p.categoria, p.unidade, p.fator_conversao, p.custo_unitario, p.dose_padrao_por_cabeca, p.carencia_padrao_dias, p.controla_estoque, p.estoque_minimo, p.estoque_atual]),
    [['Vacina Aftosa', 'VACINA', 'dose', 50, 1.85, 2, 30, true, 20, 0]]);
  let lista = await textoTela(page, '[data-produtos]');
  assert.match(lista, /Vacina Aftosa/);
  assert.match(lista, /0 dose \(abaixo do mínimo\)/, 'o saldo é projeção: zero com o controle ligado, abaixo do mínimo');
  assert.match(lista, /R\$ 1,8500 \/ dose/);
  await semProblemasDeLeiaute(page, 360, 'lista de produtos');
  // Protocolo pela folha: a cada 180 dias, com o produto.
  await A.ir(page, 'sanidade/protocolos', 'Sanidade');
  await page.click('button:has-text("Novo protocolo")');
  await page.waitForSelector(dialogo + ' [data-cadastro="protocolo.salvar"]');
  await page.fill(dialogo + ' [data-campo="nome"] input', 'Aftosa semestral');
  await page.locator(dialogo + ' [data-campo="tipo_procedimento"] select').selectOption('VACINA');
  await page.locator(dialogo + ' [data-campo="product_id"] select').selectOption(prod[0].product_id);
  await page.click(dialogo + ' [data-campo="recorrencia_tipo"] label:has-text("A cada N dias")');
  assert.equal(await page.locator(dialogo + ' [data-campo="meses_campanha"]').isVisible(), false, 'os meses só na campanha');
  await page.fill(dialogo + ' [data-campo="intervalo_dias"] input', '180');
  await principal(page);
  await page.waitForSelector('[data-protocolos] .tabela-componente');
  assert.match(await textoTela(page, '[data-protocolos]'), /Aftosa semestral.*Vacinação.*Machos e fêmeas.*a cada 180 dias/);
  assert.deepEqual(vigentesDe(s, 'PROTOCOLOS_SANITARIOS').map((p) => [p.nome, p.recorrencia_tipo, p.intervalo_dias, p.product_id, p.ativo]), [['Aftosa semestral', 'INTERVALO_DIAS', 180, prod[0].product_id, true]]);
  await semProblemasDeLeiaute(page, 360, 'lista de protocolos');
  // Entrada de estoque pelo botão do produto: 2 frascos de 50 doses por R$ 185,00, à vista.
  await A.ir(page, 'sanidade/produtos', 'Sanidade');
  await page.click('button[aria-label="Entrada de Vacina Aftosa no estoque"]');
  await A.esperarTela(page, 'Estoque de insumos');
  assert.equal(await page.locator('[data-campo="product_id"] select').inputValue(), prod[0].product_id, 'o produto vem escolhido');
  assert.equal(await page.locator('#sub-0').isChecked(), true, 'entrada');
  await page.fill('[data-campo="qtd_apresentacao"] input', '2');
  await page.fill('[data-campo="valor"] input', '185,00');
  await semProblemasDeLeiaute(page, 360, 'formulário da entrada de estoque');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
  assert.equal(a.pedidos('evento.simular').length, 1, 'revisão pelo servidor (estoque)');
  const rev = await textoTela(page, dialogo);
  assert.match(rev, /Entra no estoque\s*100 dose \(2 × 50 dose\)/);
  assert.match(rev, /Custo por unidade\s*R\$ 1,8500 por dose/);
  assert.match(rev, /Saldo de Vacina Aftosa\s*0 dose → 100 dose/);
  assert.match(rev, /Compra de Vacina Aftosa: 100 doses\s*R\$ 185,00/);
  await semProblemasDeLeiaute(page, 360, 'revisão da entrada de estoque');
  await principal(page);
  // Gravado, o lançamento volta à tela de onde veio (a lista de produtos), já com o saldo novo (a carga é refeita).
  await page.waitForFunction(() => /Estoque\D*100 dose/.test((document.querySelector('[data-produtos]') || {}).textContent || ''));
  assert.deepEqual(vigentesDe(s, 'MOVIMENTOS_ESTOQUE').map((m) => [m.tipo, m.quantidade, m.custo_unitario]), [['ENTRADA', 100, 1.85]]);
  lista = await textoTela(page, '[data-produtos]');
  assert.match(lista, /100 dose/);
  assert.doesNotMatch(lista, /abaixo do mínimo/);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

for (const largura of [1280, 360]) {
  test('agenda e aplicação (' + largura + ' px): doses atrasadas pelo protocolo; "Aplicar" abre o lançamento com protocolo, produto, dose, carência e os animais; revisão do servidor; agenda, ficha (bloco F) e venda com a carência', async () => {
    const s = A.sistema();
    const sem = A.semear(s);
    const vac = ok(s, 'produto.salvar', { campos: { nome: 'Vacina Aftosa', categoria: 'VACINA', unidade: 'dose', custo_unitario: 1.85, dose_padrao_por_cabeca: 2, carencia_padrao_dias: 30, controla_estoque: true } }, 'p1').product_id;
    const prot = ok(s, 'protocolo.salvar', { campos: { nome: 'Aftosa semestral', tipo_procedimento: 'VACINA', product_id: vac, sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180 } }, 'q1').protocol_id;
    s.registrar({ tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-11-01', product_id: vac, quantidade: 50, valor: 9250 }, animais: [] }, 'e1');
    const a = await A.abrir(s, { largura, hash: 'sanidade/agenda' });
    const { page } = a;
    await A.esperarTela(page, 'Sanidade');
    await page.waitForSelector('[data-resumo-agenda]');
    assert.match(await textoTela(page, '[data-indicador="vencidas"]'), /Doses atrasadas\s*4/, 'os 4 animais nunca vacinados: atrasados desde que ficaram elegíveis');
    assert.match(await textoTela(page, '[data-indicador="em-carencia"]'), /Em carência\s*0/);
    assert.match(await textoTela(page, '[data-secao="protocolos"]'), /Aftosa semestral\D*4\D*0\D*0,0%/);
    await semProblemasDeLeiaute(page, largura, 'agenda com atrasadas');
    await page.click('[data-grupo-agenda] button:has-text("Aplicar em 4 animais")');
    await A.esperarTela(page, 'Sanidade (vacina, vermífugo, tratamento)');
    assert.equal(await page.locator('input[value="VACINACAO"]').isChecked(), true, 'vacinação, pelo procedimento do protocolo');
    assert.equal(await page.locator('[data-campo="protocol_id"] select').inputValue(), prot);
    assert.equal(await page.locator('[data-campo="produto_id"] select').inputValue(), vac);
    assert.equal(await page.locator('[data-campo="dose_referencia"] input').inputValue(), '2', 'a dose padrão do produto');
    assert.equal(await page.locator('[data-campo="periodo_carencia_dias"] input').inputValue(), '30', 'a carência padrão do produto');
    assert.equal(await page.locator('.cartao-animal').count(), 4, 'os 4 animais pendentes no lançamento');
    await semProblemasDeLeiaute(page, largura, 'formulário da aplicação');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
    const rev = await textoTela(page, dialogo);
    assert.match(rev, /Dose por animal\s*2 dose/);
    assert.match(rev, /Sai do frasco\s*8 dose \(a soma das doses\)/);
    assert.match(rev, /Estoque do produto\s*50 dose → 42 dose/);
    assert.match(rev, /Custo pelo consumo\s*R\$ 14,80 \(8 dose × R\$ 1,8500\), dividido entre os animais/);
    assert.match(rev, /Carência\s*30 dias: não abater até 13\/12\/2026/);
    assert.match(rev, /Próxima aplicação\s*12\/05\/2027/, 'pelo intervalo do protocolo');
    await semProblemasDeLeiaute(page, largura, 'revisão da aplicação');
    await principal(page);
    await page.waitForSelector('[data-resultado="SANIDADE"]');
    const regs = vigentesDe(s, 'SANIDADE');
    assert.deepEqual(regs.map((r) => [r.dose, r.custo, r.data_fim_carencia, r.data_proxima_aplicacao, r.protocol_id]).sort(), Array(4).fill([2, 370, '2026-12-13', '2027-05-12', prot]));
    // A agenda depois: nada atrasado, os 4 em carência.
    await A.ir(page, 'sanidade/agenda', 'Sanidade');
    await page.waitForSelector('[data-resumo-agenda]');
    assert.match(await textoTela(page, '[data-indicador="vencidas"]'), /Doses atrasadas\s*0/);
    assert.match(await textoTela(page, '[data-indicador="em-carencia"]'), /Em carência\s*4/);
    assert.match(await textoTela(page, '[data-secao="carencia"]'), /0457.*13\/12\/2026.*Vacina Aftosa.*13\/11\/2026/);
    assert.match(await textoTela(page, '[data-secao="custos"]'), /Custo sanitário\s*R\$ 14,80\s*Atribuído aos animais\s*R\$ 14,80/);
    await semProblemasDeLeiaute(page, largura, 'agenda depois da aplicação');
    // Ficha, bloco F: o registro com o custo deste animal, a carência e a próxima dose.
    const id = sem.animais.find((x) => x.brinco === '0457').animal_id;
    await A.ir(page, 'animal/' + id + '/sanidade', '0457');
    await page.waitForSelector('[data-bloco-sanitario]');
    const f = await textoTela(page, '[data-secao="sanidade"]');
    assert.match(f, /Em carência até 13\/12\/2026 \(Vacina Aftosa, aplicado em 13\/11\/2026\)/);
    assert.match(f, /Aftosa semestral · Em dia: prevista para 12\/05\/2027/);
    assert.match(f, /13\/11\/2026.*Vacinação · Aftosa semestral.*Vacina Aftosa.*2 dose.*13\/12\/2026.*12\/05\/2027.*R\$ 3,70/);
    assert.match(f, /Custo sanitário do animal\s*R\$ 3,70/);
    await semProblemasDeLeiaute(page, largura, 'bloco sanitário da ficha');
    // Venda: o cartão do animal mostra a carência.
    await A.ir(page, 'animal/' + id + '/resumo', '0457');
    await page.click('[data-atalho-ficha="VENDA"]');
    await A.esperarTela(page, 'Vender animais');
    assert.match(await textoTela(page, '.cartao-animal [data-carencia]'), /Em carência até 13\/12\/2026: não pode ir para abate antes disso\./);
    await semProblemasDeLeiaute(page, largura, 'venda com animal em carência');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}
