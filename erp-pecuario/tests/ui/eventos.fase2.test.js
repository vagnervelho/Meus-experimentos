'use strict';
/**
 * Interface dos eventos da Fase 2 (E2.1 a E2.7 na tela; nível 3, Playwright, com o backend real do harness), a 1280 e
 * a 360 px: CT-03 inteiro pela tela (20 garrotes pela grade em série, frete, parcelas que não somam recusadas pelo
 * servidor e "Dividir em parcelas", revisão com os valores calculados pelo servidor, inclusive o de cada animal, e o
 * detalhe com os títulos e as alocações); CT-04 inteiro (5 animais escolhidos pelo "Vender daqui" do painel do pasto ou
 * pelos filtros do seletor, kg vivo, comissão, a receita de cada animal na revisão, o histórico do vendido); colar
 * animais de uma planilha (a 360 px); estorno bloqueado por evento posterior (o conflito com o link para o lançamento que
 * impede), estorno na ordem certa e a trilha de auditoria; identificação, marcação para descarte (campo de cabeçalho do
 * subtipo), baixa por divergência (crítica) e a correção de cada uma pelo detalhe, pelos atalhos "Mais registros" da
 * ficha. Depois de cada comando, projeção = reconstrução. Parto gemelar e transferência com erro em um animal, a 1280 e a
 * 360 px, estão em movimentos.test.js. Roda por `npm run ui:check`.
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
/** Sem rolagem horizontal e alvos de toque ≥ 48 px a 360 px; numa folha, o corpo (que rola) e as ações à parte. */
async function semProblemasDeLeiaute(page, largura, onde, folha) {
  const r = await A.semRolagemHorizontal(page);
  assert.ok(r.sw <= r.cw, onde + ': sem rolagem horizontal a ' + largura + ' px (' + r.sw + ' > ' + r.cw + ')');
  if (folha) {
    const corpo = await page.$eval(dialogo + ' .folha-corpo', (e) => [e.scrollWidth, e.clientWidth]);
    assert.ok(corpo[0] <= corpo[1], onde + ': a folha não rola de lado');
  }
  if (largura >= 900) return;
  for (const escopo of folha ? [dialogo + ' .folha-corpo', dialogo + ' .folha-acoes'] : ['#conteudo']) assert.deepEqual(await A.alvosDeToque(page, escopo), [], onde + ': alvos de toque');
}
const vigentesDe = (s, aba) => s.read({ rota: 't', reads: [aba], tratador: (tx) => tx.repo.vigentes(aba) });
async function textoTela(page, sel) { return (await page.textContent(sel)).replace(/\s+/g, ' ').trim(); }
function parceiro(s, nome, tipos) {
  const r = s.api({ rota: 'parceiro.salvar', idempotencyKey: 'p-' + nome, dados: { campos: { nome, tipos } } });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data.partner_id;
}
async function opcao(escopo, campo, texto) { await escopo.locator('[data-campo="' + campo + '"] label.opcao', { hasText: texto }).first().click(); }
/** Correção de um animal só (nem coletiva nem crítica): aviso de sucesso e volta ao lançamento, sem tela de resultado. */
async function correcaoGravada(page) {
  await page.waitForFunction(() => /Correção gravada/.test(document.getElementById('avisos').textContent) && /^evento\//.test(window.Roteador.atual()));
}
const brincosNaTela = (page) => page.$$eval('[data-linha] [data-campo="brinco"] input', (els) => els.map((e) => e.value));

for (const largura of [1280, 360]) {
  test('CT-03 pela tela: 20 garrotes em série, frete, parcelas que não somam (servidor recusa), "Dividir em 2 parcelas" e o valor de cada animal na revisão (' + largura + ' px)', async () => {
    const s = A.sistema();
    const f1 = parceiro(s, 'Fornecedor F1', ['FORNECEDOR']);
    const t1 = parceiro(s, 'Transportadora T1', ['TRANSPORTADOR']);
    const a = await A.abrir(s, { largura, hash: 'evento/novo/COMPRA' });
    const { page } = a;
    await A.esperarTela(page, 'Comprar animais');
    await page.fill('[data-campo="event_date"] input', '2026-02-05');
    await page.locator('[data-campo="partner_id"] select').selectOption(f1);
    await page.locator('[data-campo="modalidade"] select').selectOption('CABECA');
    await page.fill('[data-campo="preco_unitario"] input', '2.500,00');
    await page.fill('[data-campo="valor_animais"] input', '50.000,00');
    await page.locator('[data-campo="pasto_destino_id"] select[id^="ev-"]').selectOption({ label: 'Pasto B' });
    // Grade em série: 20 garrotes, brincos 0301 a 0320, 240,0 kg cada.
    await page.click('[data-grade="serie"]');
    const folha = page.locator(dialogo + ' [data-folha-serie]');
    await folha.locator('[data-campo="quantidade"] input').fill('20');
    await folha.locator('[data-campo="brinco_inicial"] input').fill('0301');
    await opcao(folha, 'sexo', 'Macho');
    await opcao(folha, 'castrado', 'Não');
    await opcao(folha, 'reprodutor', 'Não');
    await folha.locator('[data-campo="idade_meses"] input').fill('14');
    await folha.locator('[data-campo="peso"] input').fill('240,0');
    await semProblemasDeLeiaute(page, largura, 'folha de preencher em série', true);
    await principal(page);
    await page.waitForSelector(dialogo, { state: 'detached' });
    const brincos = await brincosNaTela(page);
    assert.deepEqual(brincos, Array.from({ length: 20 }, (_, i) => '03' + String(i + 1).padStart(2, '0')), 'o cartão em branco foi substituído pelos 20 em sequência');
    assert.equal(await page.locator('[data-linha]').nth(19).locator('[data-campo="peso"] input').inputValue(), '240,0');
    // Passo 1 do CT-03: parcelas de 25.000,00 e 24.000,00 → o servidor recusa (não somam o valor dos animais).
    const parcelas = page.locator('[data-grupo="parcelas"] [data-linha-grupo]');
    await parcelas.nth(0).locator('[data-campo="data_vencimento"] input').fill('2026-03-05');
    await parcelas.nth(0).locator('[data-campo="valor"] input').fill('25.000,00');
    await page.click('[data-grupo="parcelas"] button:has-text("Outra parcela")');
    await parcelas.nth(1).locator('[data-campo="data_vencimento"] input').fill('2026-04-05');
    await parcelas.nth(1).locator('[data-campo="valor"] input').fill('24.000,00');
    await page.click('[data-grupo="custos"] button:has-text("Frete ou outro custo")');
    const frete = page.locator('[data-grupo="custos"] [data-linha-grupo]').nth(0);
    await frete.locator('[data-campo="valor"] input').fill('1.200,00');
    await frete.locator('[data-campo="partner_id"] select').selectOption(t1);
    await semProblemasDeLeiaute(page, largura, 'formulário da compra com 20 animais');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector('[data-problemas] [role=alert]');
    assert.match(await textoTela(page, '[data-problemas]'), /As parcelas somam R\$ 49\.000,00 e a compra vale R\$ 50\.000,00/);
    assert.equal(vigentesDe(s, 'EVENTOS').length, 0, 'nada gravado');
    // "Dividir em parcelas": 2, todo mês a partir de 05/03; os valores ficam para o servidor.
    await page.click('[data-dividir="parcelas"]');
    const fp = page.locator(dialogo + ' [data-folha-parcelas]');
    await fp.locator('[data-campo="quantas"] input').fill('2');
    await fp.locator('[data-campo="primeiro"] input').fill('2026-03-05');
    await principal(page);
    await page.waitForSelector(dialogo, { state: 'detached' });
    assert.equal(await parcelas.count(), 2);
    assert.deepEqual(await page.$$eval('[data-grupo="parcelas"] [data-campo="data_vencimento"] input', (els) => els.map((e) => e.value)), ['2026-03-05', '2026-04-05']);
    assert.deepEqual(await page.$$eval('[data-grupo="parcelas"] [data-campo="valor"] input', (els) => els.map((e) => e.value)), ['', ''], 'o cliente não calcula o valor da parcela');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
    const rev = await textoTela(page, dialogo);
    assert.match(rev, /Valor dos animais\s*R\$ 50\.000,00/);
    assert.match(rev, /Frete\s*R\$ 1\.200,00/);
    assert.match(rev, /Custo total da compra\s*R\$ 51\.200,00/);
    assert.match(rev, /2 parcelas: R\$ 25\.000,00 em 05\/03\/2026; R\$ 25\.000,00 em 05\/04\/2026/, 'a divisão é do servidor');
    assert.match(rev, /Valor por animal\s*R\$ 2\.560,00/);
    assert.match(rev, /A pagar\s*R\$ 51\.200,00/);
    await page.click(dialogo + ' summary:has-text("Ver os animais")');
    assert.deepEqual(await page.$$eval(dialogo + ' [data-valor-animal]', (els) => els.map((e) => e.getAttribute('data-valor-animal'))), Array(20).fill('256000'), 'o valor de cada animal vem da simulação');
    await semProblemasDeLeiaute(page, largura, 'revisão da compra', true);
    await principal(page);
    await page.waitForSelector('[data-resultado="COMPRA"]');
    assert.match(await textoTela(page, '[data-resultado]'), /Compra gravada: 20 animais entraram no rebanho, custo total de R\$ 51\.200,00\./);
    // Verificações do CT-03.
    const novos = vigentesDe(s, 'ANIMAIS').filter((x) => x.origem === 'COMPRADO');
    assert.equal(novos.length, 20);
    assert.ok(novos.every((x) => x.situacao_cadastral === 'ATIVO' && x.pasto_atual_id === S.PASTOS.B && x.custo_aquisicao === 256000 && x.peso_atual === 240));
    assert.equal(vigentesDe(s, 'IDENTIFICACOES').filter((x) => x.tipo === 'BRINCO').length, 20);
    assert.equal(vigentesDe(s, 'PESAGENS').filter((x) => x.tipo === 'COMPRA' && x.peso_kg === 240).length, 20);
    const cp = vigentesDe(s, 'COMPRAS');
    assert.deepEqual(cp.map((x) => [x.qtd_animais, x.valor_total, x.criterio_rateio]), [[20, 5120000, 'CABECAS']]);
    const fin = vigentesDe(s, 'FINANCEIRO');
    assert.deepEqual(fin.map((x) => [x.natureza, x.valor, x.partner_id]), [['AQUISICAO_ANIMAIS', 5000000, f1], ['AQUISICAO_ANIMAIS', 120000, t1]]);
    assert.deepEqual(vigentesDe(s, 'PARCELAS').map((x) => [x.valor, x.data_vencimento, x.status]), [[2500000, '2026-03-05', 'ABERTA'], [2500000, '2026-04-05', 'ABERTA'], [120000, '2026-02-05', 'ABERTA']]);
    const aloc = vigentesDe(s, 'ALOCACOES_FINANCEIRAS');
    assert.equal(aloc.length, 40);
    assert.deepEqual([...new Set(aloc.map((x) => x.valor_alocado))].sort((x, y) => x - y), [6000, 250000], 'R$ 2.500,00 e R$ 60,00 por animal');
    s.conferirProjecoes('compra do CT-03 pela tela');
    // Detalhe do evento: lançamentos, títulos e o que coube a cada animal (alocações).
    await page.click('[data-resultado] button:has-text("Ver evento")');
    await A.esperarTela(page, 'Comprar animais');
    await page.waitForSelector('[data-secao="financeiro"] [data-alocacoes="20"]');
    const det = await textoTela(page, '[data-secao="financeiro"]');
    assert.match(det, /Compra de 20 animais: R\$ 50\.000,00/);
    assert.match(det, /Títulos: R\$ 25\.000,00 vence 05\/03\/2026 \(em aberto\); R\$ 25\.000,00 vence 05\/04\/2026 \(em aberto\)/);
    assert.match(det, /Transportadora T1/);
    assert.equal(await page.locator('[data-secao="financeiro"] [data-alocacoes="20"]').count(), 2, 'os dois lançamentos rateados entre os 20');
    await page.locator('[data-secao="financeiro"] [data-alocacoes] summary').nth(0).click();
    const porAnimal = await page.$$eval('[data-secao="financeiro"] [data-alocacoes]', (ds) => ds.map((d) => [...new Set([...d.querySelectorAll('[data-alocacao]')].map((e) => e.getAttribute('data-alocacao')))]));
    assert.deepEqual(porAnimal, [['250000'], ['6000']], 'R$ 2.500,00 da compra e R$ 60,00 do frete para cada um');
    await semProblemasDeLeiaute(page, largura, 'detalhe da compra');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });

  test('CT-04 pela tela: 5 animais por kg vivo com comissão, a receita de cada um na revisão; histórico preservado (' + largura + ' px)', async () => {
    const s = A.sistema();
    const sem = s.registrar({ tipo: 'ENTRADA_INICIAL', campos: {}, animais: ['0401', '0402', '0403', '0404', '0405'].map((b) => S.bicho({ brinco: b, sexo: 'M', castrado: true, data_nascimento: '2023-05-01', data_nascimento_confianca: 'ESTIMADA' })).concat([S.bicho({ brinco: '0999', pasto_destino_id: S.PASTOS.B })]) }, 'massa-ct04');
    const ids = sem.animais.filter((x) => x.brinco !== '0999').map((x) => x.animal_id);
    const c1 = parceiro(s, 'Comprador C1', ['COMPRADOR']);
    const a = await A.abrir(s, { largura, hash: largura < 900 ? 'evento/novo/VENDA' : 'pasto/' + S.PASTOS.A });
    const { page } = a;
    if (largura < 900) {
      // Seleção pelos filtros do seletor (pasto e categoria), com "Incluir os N filtrados".
      await A.esperarTela(page, 'Vender animais');
      await page.click('.seletor-modos button:has-text("Filtros")');
      await page.locator('.seletor-painel select').nth(0).selectOption(S.PASTOS.A);
      await page.locator('.seletor-painel select').nth(1).selectOption('M');
      await page.waitForSelector('.seletor-painel button:has-text("Incluir os 5 filtrados")');
      await page.click('.seletor-painel button:has-text("Incluir os 5 filtrados")');
      await page.locator('[data-campo="pasto_origem_id"] select').selectOption(S.PASTOS.A);
    } else {
      // Atalho do painel do pasto: origem e "todos do pasto" já marcados.
      await A.esperarTela(page, 'Pasto A');
      await page.click('[data-atalho-pasto="VENDA"]');
      await A.esperarTela(page, 'Vender animais');
      assert.equal(await page.locator('[data-campo="pasto_origem_id"] select').inputValue(), S.PASTOS.A);
    }
    assert.equal(await page.locator('[data-linha]').count(), 5, 'os 5 do Pasto A');
    await page.fill('[data-campo="event_date"] input', '2026-08-20');
    await page.locator('[data-campo="partner_id"] select').selectOption(c1);
    await page.locator('[data-campo="finalidade"] select').selectOption({ label: 'Recria e engorda' });
    await page.locator('[data-campo="modalidade"] select').selectOption('KG_VIVO');
    await page.fill('[data-campo="preco_unitario"] input', '10,00');
    await page.fill('[data-campo="valor_bruto"] input', '22.760,00');
    const pesos = { '0401': '450', '0402': '462', '0403': '438', '0404': '471', '0405': '455' };
    const cartoes = page.locator('[data-linha]');
    for (let i = 0; i < 5; i++) {
      const titulo = await cartoes.nth(i).locator('.cartao-animal-titulo').textContent();
      await cartoes.nth(i).locator('[data-campo="peso"] input').fill(pesos[titulo.trim().slice(0, 4)]);
    }
    await page.locator('[data-grupo="parcelas"] [data-linha-grupo]').nth(0).locator('[data-campo="data_vencimento"] input').fill('2026-09-19');
    await page.click('[data-grupo="deducoes"] button:has-text("Frete, comissão ou imposto")');
    const ded = page.locator('[data-grupo="deducoes"] [data-linha-grupo]').nth(0);
    await ded.locator('[data-campo="tipo"] select').selectOption({ label: 'Comissão' });
    await ded.locator('[data-campo="valor"] input').fill('455,20');
    await semProblemasDeLeiaute(page, largura, 'formulário da venda de 5');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
    const rev = await textoTela(page, dialogo);
    assert.match(rev, /Receita da venda\s*R\$ 22\.760,00/);
    assert.match(rev, /Comissão\s*− R\$ 455,20/);
    assert.match(rev, /Resultado da negociação\s*R\$ 22\.304,80/);
    assert.match(rev, /Peso vivo do lote\s*2\.276,0 kg/);
    assert.match(rev, /Divisão entre os animais\s*Pelo peso vivo/);
    assert.match(rev, /Consequência\s*5 animais saem do rebanho como vendidos; o histórico fica/);
    const porAnimal = await page.$$eval(dialogo + ' [data-valor-animal]', (els) => els.map((e) => [e.querySelector('.dado').textContent, e.getAttribute('data-valor-animal')]));
    assert.deepEqual(porAnimal.map((x) => [x[0].slice(0, 4), x[1]]).sort(), [['0401', '450000'], ['0402', '462000'], ['0403', '438000'], ['0404', '471000'], ['0405', '455000']], 'a receita de cada animal, calculada pelo servidor');
    await semProblemasDeLeiaute(page, largura, 'revisão da venda', true);
    assert.match(await textoTela(page, dialogo + ' [data-acao-principal]'), /Gravar a venda de 5 animais/);
    await principal(page);
    await page.waitForSelector('[data-resultado="VENDA"]');
    assert.match(await textoTela(page, '[data-resultado]'), /Venda gravada: 5 animais saíram do rebanho, valor bruto de R\$ 22\.760,00\./);
    // Verificações do CT-04.
    const animais = vigentesDe(s, 'ANIMAIS').filter((x) => ids.includes(x.animal_id));
    assert.ok(animais.every((x) => x.situacao_cadastral === 'VENDIDO' && x.data_saida === '2026-08-20' && !x.pasto_atual_id));
    assert.equal(vigentesDe(s, 'VENDAS').length, 1);
    assert.equal(vigentesDe(s, 'EVENTO_ANIMAIS').filter((l) => Number(l.efeito_inventario) === -1).length, 5);
    assert.equal(vigentesDe(s, 'PESAGENS').filter((p) => p.tipo === 'VENDA').length, 5);
    const fin = vigentesDe(s, 'FINANCEIRO');
    assert.deepEqual(fin.map((x) => [x.natureza, x.valor, x.partner_id]), [['RECEITA_VENDA_ANIMAIS', 2276000, c1], ['DESPESA_VENDA', 45520, null]], 'comissão sem corretor informado');
    assert.deepEqual(vigentesDe(s, 'PARCELAS').filter((p) => p.financial_id === fin[0].financial_id).map((p) => [p.valor, p.data_vencimento]), [[2276000, '2026-09-19']]);
    const aloc = vigentesDe(s, 'ALOCACOES_FINANCEIRAS');
    assert.deepEqual(aloc.filter((x) => x.financial_id === fin[0].financial_id).map((x) => x.valor_alocado).sort((x, y) => x - y), [438000, 450000, 455000, 462000, 471000]);
    const com = aloc.filter((x) => x.financial_id === fin[1].financial_id).map((x) => x.valor_alocado);
    assert.equal(com.reduce((t, v) => t + v, 0), 45520);
    assert.deepEqual([Math.min(...com), Math.max(...com)], [8760, 9420]);
    s.conferirProjecoes('venda do CT-04 pela tela');
    // Histórico: a ficha do vendido mantém a entrada e a venda.
    await A.ir(page, 'animal/' + ids[0] + '/eventos', '0401');
    await page.waitForSelector('[data-secao="linha-tempo"]');
    const linha = await textoTela(page, '[data-secao="linha-tempo"]');
    assert.match(linha, /Rebanho inicial/);
    assert.match(linha, /Vender animais/);
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}

test('colar da planilha na compra: cabeçalho pulado, linha com problema impede incluir, corrigida vira cartão; valor de cada animal (360 px)', async () => {
  const s = A.sistema();
  const f1 = parceiro(s, 'Fornecedor F2', ['FORNECEDOR']);
  const a = await A.abrir(s, { largura: 360, hash: 'evento/novo/COMPRA' });
  const { page } = a;
  await A.esperarTela(page, 'Comprar animais');
  await page.fill('[data-campo="event_date"] input', '2026-03-10');
  await page.locator('[data-campo="partner_id"] select').selectOption(f1);
  await page.locator('[data-campo="modalidade"] select').selectOption('CABECA');
  await page.fill('[data-campo="valor_animais"] input', '7.500,00');
  await page.locator('[data-campo="pasto_destino_id"] select[id^="ev-"]').selectOption({ label: 'Pasto A' });
  await page.click('[data-grade="colar"]');
  const ta = page.locator(dialogo + ' textarea');
  await ta.fill('Brinco\tSexo\tIdade\tPeso\tValor\n0501\tM\t14\t250,5\t2.600,00\n0502\tfêmea\t10/03/2025\t230\t2.400,00\n0503\tX\t12\t\t\n');
  await page.click(dialogo + ' button:has-text("Conferir as linhas")');
  await page.waitForSelector(dialogo + ' [data-problemas-colagem="1"]');
  assert.match(await textoTela(page, dialogo + ' .conferencia'), /2 linhas lidas · 1 com problema · cabeçalho ignorado/);
  assert.match(await textoTela(page, dialogo + ' [data-problemas-colagem]'), /Linha 4: sexo "X" não reconhecido \(use M ou F\)/);
  assert.equal(await page.locator(dialogo + ' [data-acao-principal]').isDisabled(), true, 'com problema não inclui nada');
  await ta.fill('Brinco\tSexo\tIdade\tPeso\tValor\n0501\tM\t14\t250,5\t2.600,00\n0502\tfêmea\t10/03/2025\t230\t2.400,00\n0503;F;12;240;2.500,00\n');
  await opcao(page.locator(dialogo), 'castrado', 'Não');
  await opcao(page.locator(dialogo), 'reprodutor', 'Não');
  await opcao(page.locator(dialogo), 'data_nascimento_confianca', 'Confirmada');
  await page.click(dialogo + ' button:has-text("Conferir as linhas")');
  await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
  await semProblemasDeLeiaute(page, 360, 'folha de colar da planilha', true);
  await principal(page);
  await page.waitForSelector(dialogo, { state: 'detached' });
  assert.deepEqual(await brincosNaTela(page), ['0501', '0502', '0503']);
  const c2 = page.locator('[data-linha]').nth(1);
  assert.equal(await c2.locator('[data-campo="data_nascimento"] input').inputValue(), '2025-03-10', 'nascimento dd/mm/aaaa lido');
  assert.equal(await c2.locator('[data-campo="valor_individual"] input').inputValue(), '2.400,00');
  assert.equal(await c2.locator('[data-campo="data_nascimento_confianca"] input:checked').getAttribute('value'), 'CONFIRMADA');
  await page.locator('[data-grupo="parcelas"] [data-linha-grupo]').nth(0).locator('[data-campo="data_vencimento"] input').fill('2026-04-10');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
  assert.match(await textoTela(page, dialogo), /Divisão entre os animais\s*Pelo valor de cada animal/);
  await principal(page);
  await page.waitForSelector('[data-resultado="COMPRA"]');
  const novos = vigentesDe(s, 'ANIMAIS').filter((x) => x.origem === 'COMPRADO').map((x) => [x.brinco, x.sexo, x.custo_aquisicao, x.peso_atual]).sort();
  assert.deepEqual(novos, [['0501', 'M', 260000, 250.5], ['0502', 'F', 240000, 230], ['0503', 'F', 250000, 240]]);
  s.conferirProjecoes('compra colada');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

for (const largura of [1280, 360]) {
  test('estorno com evento posterior: o servidor recusa e a tela mostra o lançamento que impede, com link; estornar na ordem certa; trilha de auditoria (' + largura + ' px)', async () => {
    const s = A.sistema();
    const sem = A.semear(s);
    const b0457 = sem.animais.find((x) => x.brinco === '0457').animal_id;
    const t1 = s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: b0457 }] }, 'tr-1');
    const t2 = s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-04-01', pasto_origem_id: S.PASTOS.B, pasto_destino_id: S.PASTOS.A }, animais: [{ animal_id: b0457 }] }, 'tr-2');
    const a = await A.abrir(s, { largura, hash: 'evento/' + t1.event_id });
    const { page } = a;
    await A.esperarTela(page, 'Transferir de pasto');
    await page.click('[data-acoes-evento] button:has-text("Estornar")');
    await A.esperarTela(page, 'Estornar evento');
    await page.fill('[data-campo="justificativa"] textarea', 'Lançado no dia errado');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector('[data-problemas] [data-conflito]');
    const prob = await textoTela(page, '[data-problemas]');
    assert.match(prob, /0457/);
    assert.match(prob, /Abrir a transferência de 01\/04\/2026/);
    assert.equal(await page.getAttribute('[data-problemas] [data-conflito]', 'data-conflito'), t2.event_id, 'o link leva ao lançamento que impede');
    assert.equal(vigentesDe(s, 'EVENTOS').filter((e) => e.event_type === 'ESTORNO').length, 0, 'nada gravado');
    await semProblemasDeLeiaute(page, largura, 'estorno recusado');
    await page.click('[data-problemas] [data-conflito]');
    await A.esperarTela(page, 'Transferir de pasto');
    await page.click('[data-acoes-evento] button:has-text("Estornar")');
    // Há o rascunho do estorno recusado: começar outro pede confirmação.
    await page.click(dialogo + ' button:has-text("Apagar o rascunho e começar")');
    await A.esperarTela(page, 'Estornar evento');
    await page.fill('[data-campo="justificativa"] textarea', 'A volta não aconteceu');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
    assert.match(await textoTela(page, dialogo), /Será desfeito\s*A transferência de 01\/04\/2026/);
    assert.match(await textoTela(page, dialogo + ' [data-acao-principal]'), /Estornar a transferência de 1 animal/);
    await principal(page);
    await page.waitForSelector('[data-resultado="ESTORNO"]');
    s.conferirProjecoes('estorno da segunda transferência');
    await A.ir(page, 'evento/' + t1.event_id, 'Transferir de pasto');
    await page.click('[data-acoes-evento] button:has-text("Estornar")');
    await A.esperarTela(page, 'Estornar evento');
    await page.fill('[data-campo="justificativa"] textarea', 'Lançado no dia errado');
    await page.click('.form-evento button[type=submit]');
    await principal(page);
    await page.waitForSelector('[data-resultado="ESTORNO"]');
    s.conferirProjecoes('estorno da primeira');
    assert.equal(vigentesDe(s, 'ANIMAIS').find((x) => x.animal_id === b0457).pasto_atual_id, S.PASTOS.A);
    // Detalhe do anulado: mostra quem o anulou e não oferece Estornar nem Corrigir.
    await A.ir(page, 'evento/' + t1.event_id, 'Transferir de pasto');
    await page.waitForSelector('[data-secao="cabecalho"]');
    assert.match(await textoTela(page, '[data-secao="cabecalho"]'), /Não vale \(estornado ou corrigido\)/);
    assert.equal(await page.locator('[data-acoes-evento] button').count(), 0);
    // Trilha de auditoria: os estornos com quem, quando e o motivo, cada um com o link do lançamento.
    await A.ir(page, 'config/auditoria', 'Configurações');
    await page.locator('#aud-acao').selectOption('ESTORNAR');
    await page.click('form.filtros button[type=submit]');
    await page.waitForFunction(() => /2 registros de alteração/.test(document.getElementById('conteudo').textContent));
    const trilha = await textoTela(page, '#conteudo');
    assert.match(trilha, /Lançamento estornado/);
    assert.match(trilha, /Estorno de: Transferir de pasto de 01\/04\/2026/);
    assert.match(trilha, /A volta não aconteceu/);
    assert.match(trilha, /Lançado no dia errado/);
    assert.match(trilha, /dono@gmail\.com/);
    await semProblemasDeLeiaute(page, largura, 'auditoria');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}

for (const largura of [1280, 360]) {
  test('manejo pela ficha: pôr brinco, marcar para descarte (motivo no cabeçalho do subtipo), baixa por divergência (crítica) e a correção de cada um pelo detalhe (' + largura + ' px)', async () => {
    const s = A.sistema();
    const sem = A.semear(s);
    const semBrinco = sem.animais.find((x) => !x.brinco).animal_id;
    const b0457 = sem.animais.find((x) => x.brinco === '0457').animal_id;
    const b12 = sem.animais.find((x) => x.brinco === '12').animal_id;
    const a = await A.abrir(s, { largura, hash: 'animal/' + semBrinco + '/resumo' });
    const { page } = a;
    await A.esperarTela(page);
    // 1. Pôr brinco (IDENTIFICACAO / PRIMEIRA_IDENTIFICACAO).
    await page.click('[data-atalho-ficha="MAIS"]');
    await semProblemasDeLeiaute(page, largura, 'folha de mais registros', true);
    await page.click(dialogo + ' [data-atalho-ficha="IDENTIFICACAO.PRIMEIRA_IDENTIFICACAO"]');
    await A.esperarTela(page, 'Identificação (brinco)');
    assert.match(await textoTela(page, '[data-campo="__subtipo"]'), /O que fazer/);
    assert.equal(await page.locator('[data-campo="__subtipo"] input:checked').getAttribute('value'), 'PRIMEIRA_IDENTIFICACAO');
    assert.equal(await page.locator('[data-campo="tipo_identificacao"] option[value="BRINCO_ORIGEM"]').count(), 0, 'o brinco do vendedor só se retira');
    await page.fill('[data-campo="event_date"] input', '2026-10-01');
    await page.locator('[data-linha] [data-campo="codigo"] input').fill('0500');
    await semProblemasDeLeiaute(page, largura, 'formulário de identificação');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
    assert.match(await textoTela(page, dialogo), /Número: 0500/);
    assert.equal(a.pedidos('evento.simular').length, 0, 'revisão LOCAL');
    await principal(page);
    await page.waitForFunction(() => /animal\//.test(window.Roteador.atual()));
    assert.equal(vigentesDe(s, 'ANIMAIS').find((x) => x.animal_id === semBrinco).brinco, '0500');
    s.conferirProjecoes('primeira identificação');
    const ident = vigentesDe(s, 'EVENTOS').find((e) => e.event_type === 'IDENTIFICACAO');
    await A.ir(page, 'evento/' + ident.event_id, 'Identificação');
    await page.waitForSelector('[data-secao="identificacoes"]');
    await page.click('[data-acoes-evento] button:has-text("Corrigir")');
    await A.esperarTela(page, 'Corrigir: Identificação');
    assert.equal(await page.locator('[data-linha] [data-campo="codigo"] input').inputValue(), '0500');
    await page.locator('[data-linha] [data-campo="codigo"] input').fill('0501');
    await page.fill('[data-campo="justificativa_correcao"] textarea', 'Número trocado');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-diferencas="1"]');
    assert.match(await textoTela(page, dialogo + ' [data-diferencas]'), /número de 0500 para 0501/);
    await principal(page);
    await correcaoGravada(page);
    assert.equal(vigentesDe(s, 'ANIMAIS').find((x) => x.animal_id === semBrinco).brinco, '0501');
    s.conferirProjecoes('correção da identificação');
    // 2. Marcar para descarte: o motivo é campo de cabeçalho do subtipo.
    await A.ir(page, 'animal/' + b0457 + '/resumo', '0457');
    await page.click('[data-atalho-ficha="MAIS"]');
    await page.click(dialogo + ' [data-atalho-ficha="MARCACAO.DESCARTE"]');
    await A.esperarTela(page, 'Marcar para descarte');
    assert.match(await textoTela(page, '[data-campo="__subtipo"]'), /Marcar como/);
    await page.fill('[data-campo="event_date"] input', '2026-10-02');
    await page.locator('[data-campo="motivo_descarte"] select').selectOption({ label: 'Idade avançada' });
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
    const revM = await textoTela(page, dialogo);
    assert.match(revM, /Motivo do descarte\s*Idade avançada/);
    assert.match(revM, /Consequência\s*1 animal fica marcado; o inventário não muda/);
    await principal(page);
    await page.waitForFunction(() => /animal\//.test(window.Roteador.atual()));
    assert.equal(vigentesDe(s, 'ANIMAIS').find((x) => x.animal_id === b0457).marcado_descarte, true);
    const marca = vigentesDe(s, 'EVENTOS').find((e) => e.event_type === 'MARCACAO');
    assert.deepEqual(marca.payload_json, { acao: 'MARCAR', motivo_descarte: 'IDADE' });
    s.conferirProjecoes('marcação');
    await A.ir(page, 'evento/' + marca.event_id, 'Marcar para descarte');
    await page.waitForSelector('[data-secao="marcacao"]');
    assert.match(await textoTela(page, '[data-secao="marcacao"]'), /Marcar: para descarte\s*Motivo do descarte\s*Idade avançada/);
    await page.click('[data-acoes-evento] button:has-text("Corrigir")');
    await A.esperarTela(page, 'Corrigir: Marcar para descarte');
    assert.equal(await page.locator('[data-campo="motivo_descarte"] select').inputValue(), 'IDADE');
    await page.locator('[data-campo="motivo_descarte"] select').selectOption({ label: 'Baixo desempenho' });
    await page.fill('[data-campo="justificativa_correcao"] textarea', 'Era desempenho');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-diferencas="1"]');
    assert.match(await textoTela(page, dialogo + ' [data-diferencas]'), /Motivo do descarte: de Idade avançada para Baixo desempenho/);
    await principal(page);
    await correcaoGravada(page);
    assert.equal(vigentesDe(s, 'EVENTOS').find((e) => e.event_type === 'MARCACAO').payload_json.motivo_descarte, 'BAIXO_DESEMPENHO');
    s.conferirProjecoes('correção da marcação');
    // 3. Baixa por divergência de contagem: operação crítica (botão de perigo e tela de resultado).
    await A.ir(page, 'animal/' + b12 + '/resumo', '12');
    await page.click('[data-atalho-ficha="MAIS"]');
    await page.click(dialogo + ' [data-atalho-ficha="AJUSTE_INVENTARIO.DIVERGENCIA_CONTAGEM"]');
    await A.esperarTela(page, 'Corrigir dados do animal');
    await page.fill('[data-campo="event_date"] input', '2026-10-03');
    await page.fill('[data-campo="justificativa"] textarea', 'Contagem de outubro');
    await page.locator('[data-linha] [data-campo="observacoes"] input, [data-linha] [data-campo="observacoes"] textarea').first().fill('faltou no curral');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
    assert.match(await textoTela(page, dialogo), /Consequência\s*1 animal sai do rebanho como não encontrado na contagem; se aparecer, estorne esta baixa/);
    assert.match(await textoTela(page, dialogo + ' [data-acao-principal]'), /Dar baixa de 1 animal/);
    assert.match(await page.getAttribute(dialogo + ' [data-acao-principal]', 'class'), /botao-perigo/);
    await principal(page);
    await page.waitForSelector('[data-resultado="AJUSTE_INVENTARIO"]');
    assert.match(await textoTela(page, '[data-resultado]'), /Baixa gravada: 1 animal saiu do rebanho como não encontrado na contagem\./);
    const baixa = vigentesDe(s, 'EVENTOS').find((e) => e.event_subtype === 'DIVERGENCIA_CONTAGEM');
    assert.equal(baixa.payload_json.motivo_ajuste, 'Contagem de outubro', 'o porquê fica no evento');
    assert.equal(vigentesDe(s, 'ANIMAIS').find((x) => x.animal_id === b12).situacao_cadastral, 'BAIXADO_AJUSTE');
    s.conferirProjecoes('baixa por divergência');
    await page.click('[data-resultado] button:has-text("Ver evento")');
    await A.esperarTela(page, 'Corrigir dados do animal');
    await page.waitForSelector('[data-secao="baixas"]');
    assert.match(await textoTela(page, '[data-secao="baixas"]'), /não encontrado na contagem/);
    assert.match(await textoTela(page, '[data-secao="motivo-ajuste"]'), /Contagem de outubro/);
    await page.click('[data-acoes-evento] button:has-text("Corrigir")');
    await A.esperarTela(page, 'Corrigir: Corrigir dados do animal');
    assert.equal(await page.locator('[data-campo="justificativa"] textarea').inputValue(), 'Contagem de outubro', 'o motivo do original vem preenchido');
    await page.locator('[data-linha] [data-campo="observacoes"] input, [data-linha] [data-campo="observacoes"] textarea').first().fill('faltou na contagem do Pasto A');
    await page.fill('[data-campo="justificativa_correcao"] textarea', 'Detalhe da contagem');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-diferencas="1"]');
    await principal(page);
    await page.waitForSelector('[data-resultado]');
    assert.equal(vigentesDe(s, 'BAIXAS').find((x) => x.animal_id === b12).observacoes, 'faltou na contagem do Pasto A');
    s.conferirProjecoes('correção da baixa');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}
