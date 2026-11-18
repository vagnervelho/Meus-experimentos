'use strict';
/**
 * Fase 4, E4.3 (CONTRATOS, seção 57), nível 3 (Playwright): ratear um lançamento entre os animais pela tela.
 *  - Do detalhe do lançamento, "Ratear entre os animais" abre o formulário do catálogo (o evento RATEIO) com o lançamento
 *    escolhido e as opções que o servidor deu; os campos que não se aplicam somem (o pasto, a categoria, o período, a lista);
 *    a revisão é a simulação do servidor, com o valor de cada animal; gravado, o detalhe mostra a divisão.
 *  - "Ratear de novo" pelo valor digitado de cada animal escolhido (a lista aparece, a justificativa é pedida pelo
 *    servidor): a revisão diz o rateio que ele substitui; o histórico dos rateios do lançamento.
 *  - O arrendamento: só o pasto e os dias de permanência; depois de uma transferência retroativa para o pasto, o detalhe
 *    avisa que o rateio está desatualizado; o detalhe do evento mostra o rateio, e "Corrigir" abre o mesmo formulário.
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
/** Volta ao detalhe do lançamento lendo de novo (depois de gravar, o formulário já volta a ele: a rota é a mesma). */
async function detalhe(page, fid, titulo) {
  await page.evaluate((r) => window.Roteador.ir(r, { forcar: true }), 'financeiro/lancamento/' + fid);
  await A.esperarTela(page, titulo);
}
const conta = (s, cod) => s.tabela('PLANO_CONTAS').find((c) => c.codigo === cod).conta_id;
const visivel = (page, campo) => page.evaluate((c) => { const el = document.querySelector('[data-campo="' + c + '"]'); return !!el && !el.hidden && el.offsetParent !== null; }, campo);
const grupoVisivel = (page, g) => page.evaluate((x) => { const el = document.querySelector('[data-grupo="' + x + '"]'); return !!el && !el.hidden; }, g);
const rateiosDe = (s, fid) => s.tabela('RATEIOS').filter((r) => r.financial_id === fid);
const alocacoes = (s, ratId) => s.tabela('ALOCACOES_FINANCEIRAS').filter((a) => a.rateio_id === ratId).map((a) => a.valor_alocado).sort((x, y) => x - y);

/** O rebanho da semente (4 animais: 3 no Pasto A, 0391 no Pasto B) e um avulso de R$ 900,00 de outubro. */
function base(s) {
  const ent = A.semear(s);
  const ev = s.registrar({ tipo: 'LANCAMENTO_FINANCEIRO', campos: { event_date: '2026-10-01', conta_id: conta(s, 'OUTROS_GASTOS'), valor: 90000, descricao: 'Sal mineral de outubro' }, parcelas: [{ data_vencimento: '2026-10-20' }] }, 'sal-1');
  const fid = s.tabela('FINANCEIRO').find((f) => f.event_id === ev.event_id).financial_id;
  return { ent, fid };
}

for (const largura of [1280, 360]) {
  test('ratear pela tela (' + largura + ' px): do detalhe do lançamento ao formulário do rateio; os campos que não se aplicam somem; a revisão do servidor com o valor de cada animal; ratear de novo pelo valor digitado, com o histórico', async () => {
    const s = A.sistema();
    const { ent, fid } = base(s);
    const a = await A.abrir(s, { largura, hash: 'financeiro/lancamento/' + fid });
    const { page } = a;
    await A.esperarTela(page, 'Sal mineral de outubro');
    await page.waitForSelector('[data-ratear="' + fid + '"]');
    assert.match(await textoTela(page, '[data-secao="rateio"]'), /Ratear entre os animais/);
    await page.click('[data-ratear="' + fid + '"]');
    await A.esperarTela(page, 'Ratear custo entre animais');
    // O lançamento vem escolhido (não se troca aqui) e o formulário pede como e entre quem dividir.
    assert.match(await textoTela(page, '[data-campo="financial_id"]'), /Sal mineral de outubro · R\$ 900,00/);
    assert.deepEqual(await page.locator('[data-campo="escopo_tipo"] select option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean)), ['REBANHO', 'PASTO', 'CATEGORIA', 'LISTA'], 'só os escopos que o servidor deu (o avulso não tem animais do registro)');
    await page.locator('[data-campo="escopo_tipo"] select').selectOption('REBANHO');
    await page.locator('[data-campo="criterio"] select').selectOption('CABECAS');
    assert.deepEqual([await visivel(page, 'pasture_id'), await visivel(page, 'category_id'), await visivel(page, 'periodo_inicio'), await visivel(page, 'data_base'), await grupoVisivel(page, 'animais_rateio')], [false, false, false, true, false]);
    await page.fill('[data-campo="data_base"] input', '2026-10-01');
    await semProblemasDeLeiaute(page, largura, 'formulário do rateio');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
    assert.equal(a.pedidos('evento.simular').length, 1, 'a revisão é a simulação do servidor');
    await page.waitForSelector(dialogo + ' [data-rateio-animais="4"]');
    const valores = await page.locator(dialogo + ' [data-rateio-animais] [data-valor-animal]').evaluateAll((l) => l.map((x) => Number(x.getAttribute('data-valor-animal'))));
    assert.deepEqual(valores, [22500, 22500, 22500, 22500], 'R$ 900,00 por 4 cabeças, do servidor');
    assert.match(await textoTela(page, dialogo), /Vai aos animais\s*R\$ 900,00 em 4 animais/);
    await semProblemasDeLeiaute(page, largura, 'revisão do rateio');
    await principal(page);
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    assert.deepEqual(rateiosDe(s, fid).map((r) => [r.criterio, r.escopo_tipo, r.data_base, r.total_alocado]), [['CABECAS', 'REBANHO', '2026-10-01', 90000]]);

    // Ratear de novo: pelo valor digitado de dois animais escolhidos (a lista aparece; o valor de cada um também).
    await detalhe(page, fid, 'Sal mineral de outubro');
    await page.waitForSelector('[data-ratear="' + fid + '"]');
    assert.match(await textoTela(page, '[data-secao="rateio"]'), /Distribuído\s*R\$ 900,00.*Ratear de novo/);
    await page.click('[data-ratear="' + fid + '"]');
    await A.esperarTela(page, 'Ratear custo entre animais');
    await page.locator('[data-campo="escopo_tipo"] select').selectOption('LISTA');
    await page.locator('[data-campo="criterio"] select').selectOption('MANUAL');
    assert.equal(await grupoVisivel(page, 'animais_rateio'), true, 'a lista aparece com os animais escolhidos');
    for (const [k, brinco, valor] of [[0, '0457', '600,00'], [1, '0391', '300,00']]) {
      await page.click('[data-grupo="animais_rateio"] button:has-text("Outro animal")');
      const linha = page.locator('[data-grupo="animais_rateio"] [data-linha-grupo]').nth(k);
      await linha.locator('[data-campo="animal_id"] input').fill(brinco);
      await linha.locator('[data-campo="animal_id"] input').press('Enter');
      await linha.locator('[data-campo="animal_id"] .escolhido').waitFor();
      await linha.locator('[data-campo="valor"] input').fill(valor);
    }
    // Sem a justificativa, o servidor diz o que falta (o lançamento já estava rateado e o rateio é manual).
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector('[data-campo="justificativa_rateio"] .campo-erro:not([hidden])');
    assert.match(await textoTela(page, '[data-campo="justificativa_rateio"] .campo-erro'), /valor digitado/);
    await page.fill('[data-campo="justificativa_rateio"] input', 'O 0457 comeu o dobro');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-rateio-animais="2"]');
    assert.match(await textoTela(page, dialogo), /Substitui\s*o rateio de \d\d\/\d\d\/\d{4} \(igual por cabeça, R\$ 900,00\)/);
    await principal(page);
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    const rats = rateiosDe(s, fid);
    assert.equal(rats.length, 2);
    assert.deepEqual(alocacoes(s, rats.find((r) => r.criterio === 'MANUAL').rateio_id), [30000, 60000]);
    await detalhe(page, fid, 'Sal mineral de outubro');
    await page.waitForSelector('[data-rateios="2"]');
    assert.equal(await page.locator('[data-rateio-vigente="1"]').count(), 1);
    assert.match(await textoTela(page, '[data-secao="rateio"]'), /Pelo valor digitado de cada animal/);
    assert.equal(ent.animais.length, 4);
    await semProblemasDeLeiaute(page, largura, 'detalhe com o histórico dos rateios');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}

test('arrendamento pela tela: só o pasto arrendado e os dias de permanência; a transferência retroativa para o pasto deixa o rateio desatualizado; o detalhe do evento mostra o rateio e "Corrigir" abre o mesmo formulário', async () => {
  const s = A.sistema();
  const { ent } = base(s);
  const ev = s.registrar({ tipo: 'LANCAMENTO_FINANCEIRO', campos: { event_date: '2026-10-01', conta_id: conta(s, 'ARRENDAMENTO_PASTO'), valor: 31000, pasture_id: S.PASTOS.B, competencia_inicio: '2026-10-01', competencia_fim: '2026-10-31', descricao: 'Arrendamento do Pasto B' }, parcelas: [{ data_vencimento: '2026-10-31' }] }, 'arr-1');
  const fid = s.tabela('FINANCEIRO').find((f) => f.event_id === ev.event_id).financial_id;
  // O 0391 está no Pasto B desde o marco zero; o 12 entrou nele em 11/10.
  const id = (b) => ent.animais.find((x) => x.brinco === b).animal_id;
  s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-10-11', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: id('12') }] }, 'tr-0', { avisosAceitos: ['LOTACAO_ACIMA_DA_CAPACIDADE'] });
  const a = await A.abrir(s, { largura: 1280, hash: 'financeiro/lancamento/' + fid });
  const { page } = a;
  await A.esperarTela(page, 'Arrendamento do Pasto B');
  await page.click('[data-ratear="' + fid + '"]');
  await A.esperarTela(page, 'Ratear custo entre animais');
  // Uma opção só (o servidor deu o pasto arrendado e os dias de permanência), já marcada.
  const radios = (c) => page.locator('[data-campo="' + c + '"] input[type=radio]').evaluateAll((l) => l.map((x) => [x.value, x.checked]));
  assert.deepEqual([await radios('escopo_tipo'), await radios('criterio')], [[['PASTO', true]], [['DIAS_PERMANENCIA', true]]]);
  assert.deepEqual([await visivel(page, 'pasture_id'), await visivel(page, 'periodo_inicio'), await visivel(page, 'data_base')], [true, true, false]);
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-rateio-animais="2"]');
  assert.match(await textoTela(page, dialogo), /pelos dias de permanência no pasto Pasto B, de 01\/10\/2026 a 31\/10\/2026/);
  assert.match(await textoTela(page, dialogo), /0391 · R\$ 184,81 \(31 dias\)\s*12 · R\$ 125,19 \(21 dias\)/);
  await principal(page);
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
  const rat = rateiosDe(s, fid)[0];
  assert.deepEqual([rat.criterio, rat.escopo_ref, rat.periodo_inicio, rat.periodo_fim, rat.base_total, rat.total_alocado, alocacoes(s, rat.rateio_id)], ['DIAS_PERMANENCIA', S.PASTOS.B, '2026-10-01', '2026-10-31', 52, 31000, [12519, 18481]]);
  // O 0457 foi para o Pasto B em 21/10 (lançado depois): a base refeita hoje muda, e o detalhe avisa.
  s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-10-21', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: id('0457') }] }, 'tr-1', { avisosAceitos: ['LOTACAO_ACIMA_DA_CAPACIDADE'] });
  await detalhe(page, fid, 'Arrendamento do Pasto B');
  await page.waitForSelector('[data-rateio-desatualizado="1"]');
  assert.match(await textoTela(page, '[data-rateio-desatualizado]'), /Rateio desatualizado: refeita hoje, a base muda: 0457 entra/);
  // O detalhe do evento RATEIO: o lançamento, o critério e o valor de cada animal; "Corrigir" abre o formulário do rateio.
  await A.ir(page, 'evento/' + rat.event_id, 'Ratear custo entre animais');
  await page.waitForSelector('[data-secao="rateio"] [data-alocacoes="2"]');
  assert.match(await textoTela(page, '[data-secao="rateio"]'), /Pelos dias de permanência.*Os animais de um pasto.*R\$ 310,00/);
  await page.click('button:has-text("Corrigir")');
  await A.esperarTela(page, 'Ratear custo entre animais');
  assert.match(await textoTela(page, '[data-campo="financial_id"]'), /Rateio de "Arrendamento do Pasto B"/);
  // A correção sem mudança fica com a base gravada (o fato congelado: as entradas do rateio não mudaram).
  await page.fill('[data-campo="justificativa_correcao"] :is(input, textarea)', 'Conferido com o arrendador');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-rateio-animais="2"]');
  assert.match(await textoTela(page, dialogo), /a gravada no rateio original/);
  await principal(page);
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
  // Ratear de novo, por decisão do dono: a base de hoje (os dias do 0457 desde 21/10), com o porquê.
  await detalhe(page, fid, 'Arrendamento do Pasto B');
  await page.waitForSelector('[data-rateio-desatualizado="1"]');
  await page.click('[data-ratear="' + fid + '"]');
  await A.esperarTela(page, 'Ratear custo entre animais');
  await page.fill('[data-campo="justificativa_rateio"] input', 'O 0457 entrou no Pasto B em 21/10');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-rateio-animais="3"]');
  await principal(page);
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
  const vale = s.read({ rota: 't', reads: ['RATEIOS', 'ALOCACOES_FINANCEIRAS', 'FINANCEIRO', 'EVENTOS', 'OPERACOES'], tratador: (tx) => tx.repo.rateioEm(fid) });
  assert.deepEqual([vale.base_total, alocacoes(s, vale.rateio_id)], [63, [5413, 10333, 15254]], '31 dias do 0391, 21 do 12 e 11 do 0457 (21 a 31/10), pelo maior resto');
  await detalhe(page, fid, 'Arrendamento do Pasto B');
  await page.waitForSelector('[data-rateios="2"]');
  assert.equal(await page.locator('[data-rateio-desatualizado]').count(), 0, 'o rateio que vale está em dia');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
