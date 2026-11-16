'use strict';
/**
 * Reprodução na tela (Fase 3, E3.4 e E3.5), nível 3 (Playwright): a tela vem sob demanda (Reproduction); o diagnóstico
 * no tronco a 360 px (brinco e resultado com Enter, "p90" com a idade da gestação, o brinco que não é de fêmea do
 * rebanho como pendência, envio em bloco, a rede cortada guardando o bloco sem confirmação e o reenvio com a mesma
 * chave, o resultado do servidor na linha e o terminar); as fêmeas com a situação e os botões de registro para as
 * escolhidas; os indicadores da estação ("dados insuficientes" com n abaixo do mínimo); o cadastro da estação pela folha;
 * a ficha da matriz (bloco G) e a do touro. Em todas: sem rolagem horizontal, alvos de toque ≥ 48 px a 360 px e nenhum
 * erro no console. Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const RELOGIO = Date.parse('2026-11-13T14:00:00Z');
const dialogo = '[role=dialog]';
async function textoTela(page, sel) { return (await page.textContent(sel)).replace(/\s+/g, ' ').trim(); }
async function semProblemasDeLeiaute(page, largura, onde) {
  const r = await A.semRolagemHorizontal(page);
  assert.ok(r.sw <= r.cw, onde + ': sem rolagem horizontal a ' + largura + ' px (' + r.sw + ' > ' + r.cw + ')');
  if (largura < 900) assert.deepEqual(await A.alvosDeToque(page, '#conteudo'), [], onde + ': alvos de toque');
}
const vigentesDe = (s, aba) => s.read({ rota: 't', reads: [aba, 'EVENTOS', 'OPERACOES'], tratador: (tx) => tx.repo.vigentes(aba) });
const porBrinco = (sem, b) => sem.animais.find((x) => x.brinco === b).animal_id;
function ok(s, rota, dados, chave) {
  const r = s.api({ rota, idempotencyKey: chave, dados });
  if (!r.ok) throw new Error(rota + ': ' + JSON.stringify(r.error));
  return r.data;
}
/** Brinco, Enter, resultado, Enter (o veterinário no tronco, sem tocar em botão). */
async function diagnosticar(page, brinco, resultado) {
  await page.fill('#tr-brinco', brinco);
  await page.press('#tr-brinco', 'Enter');
  await page.fill('#tr-resultado', resultado);
  await page.press('#tr-resultado', 'Enter');
}
const linhas = (page) => page.$$eval('.curral-lista [data-linha]', (ls) => ls.map((l) => [l.dataset.estado, l.textContent.replace(/\s+/g, ' ').trim()]));

test('diagnóstico no tronco a 360 px: p90, v e o brinco que não é de fêmea; a rede cortada guarda o bloco sem confirmação; o reenvio com a mesma chave grava uma vez; a previsão do servidor na linha; terminar', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const est = ok(s, 'estacao.salvar', { campos: { nome: 'Estação 26', data_inicio: '2026-06-01', data_fim: '2026-08-31', tipo: 'MONTA_NATURAL' } }, 'est');
  const a = await A.abrir(s, { largura: 360, hash: 'reproducao/tronco', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Diagnóstico no tronco');
  assert.equal(a.pedidos('sistema.tela').map((p) => p.dados.nome).join(), 'Reproduction', 'a tela vem sob demanda');
  assert.equal(await page.inputValue('#tr-data'), '2026-11-13');
  await page.selectOption('#tr-metodo', 'ULTRASSOM');
  await page.selectOption('#tr-estacao', est.estacao_id);
  await semProblemasDeLeiaute(page, 360, 'início do tronco');
  await page.click('button:has-text("Começar")');
  await page.waitForSelector('#tr-brinco');
  assert.equal(await page.getAttribute('#tr-brinco', 'inputmode'), 'numeric', 'teclado numérico para o brinco');
  await diagnosticar(page, '0457', 'p90');
  await diagnosticar(page, '0391', 'v');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'tr-brinco', 'o Enter do resultado volta ao brinco');
  // O macho 12 não é fêmea do rebanho: a linha fica pendente e impede o envio até sair.
  await diagnosticar(page, '12', 'p');
  assert.match(await textoTela(page, '[data-tronco-status]'), /1 pendência impede o envio/);
  assert.equal(await page.isDisabled('[data-enviar]'), true);
  await page.click('.curral-lista [data-estado="NAO_ENCONTRADO"] button:has-text("Tirar")');
  assert.match(await textoTela(page, '.curral-contador'), /2 diagnosticadas · 1 prenhes · 1 vazias · 0 duvidosas/);
  await semProblemasDeLeiaute(page, 360, 'tronco com a fila');
  // Sem sinal: o transporte falha; o bloco fica guardado, com a chave.
  await page.evaluate(() => { window.__gas.falharTransporte = 1; });
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="SEM_SINAL"]').length === 2);
  assert.match(await textoTela(page, '[data-tronco-status]'), /Sem sinal ou sem resposta: o que foi digitado está guardado neste aparelho/);
  assert.equal(vigentesDe(s, 'REPRODUCAO').length, 0);
  // O sinal volta: o mesmo bloco, a mesma chave; gravado uma vez, com a previsão do servidor na linha.
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 2, null, { timeout: 15000 });
  const regs = (await page.evaluate(() => window.__gas.pedidos)).filter((p) => p.rota === 'evento.registrar');
  assert.equal(new Set(regs.map((r) => r.idempotencyKey)).size, 1, 'todas as tentativas com a mesma chave');
  const dg = vigentesDe(s, 'REPRODUCAO');
  assert.deepEqual(dg.map((r) => [r.animal_id, r.resultado, r.idade_gestacional_dias || null, r.metodo, r.estacao_id]).sort(), [
    [porBrinco(sem, '0457'), 'POSITIVO', 90, 'ULTRASSOM', est.estacao_id], [porBrinco(sem, '0391'), 'NEGATIVO', null, 'ULTRASSOM', est.estacao_id]].sort());
  assert.equal(new Set(dg.map((r) => r.event_id)).size, 1, 'um lançamento');
  const ls = (await linhas(page)).map((l) => l[1]).join(' | ');
  assert.match(ls, /0457 · prenhe \(90 dias\) · gravado · Estimativa: 01\/06\/2027 \(de 12\/05\/2027 a 21\/06\/2027\)/, '13/11/2026 + (290 − 90), ± 20 dias');
  assert.match(ls, /0391 · vazia · gravado/);
  // Terminar: o resultado com o lançamento gravado; o rascunho sai do aparelho.
  await page.click('button:has-text("Terminar")');
  await page.waitForSelector('[data-resultado-tronco="2"]');
  assert.match(await textoTela(page, '[data-resultado-tronco]'), /2 diagnósticos gravados: 1 prenhes, 1 vazias, 0 duvidosas/);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => /tronco-diagnostico/.test(k)).length), 0, 'o rascunho saiu do aparelho');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('fêmeas, indicadores e estações (1280 e 360 px): a situação de cada fêmea, o registro para as escolhidas, os indicadores com "dados insuficientes", a estação nova pela folha; a ficha da matriz (bloco G) e a do touro', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const v1 = porBrinco(sem, '0457');
  const v2 = porBrinco(sem, '0391');
  const touro = porBrinco(sem, '12');
  const est = ok(s, 'estacao.salvar', { campos: { nome: 'Estação 26', data_inicio: '2026-06-01', data_fim: '2026-08-31', tipo: 'MONTA_NATURAL' } }, 'est');
  s.registrar({ tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-06-01', estacao_id: est.estacao_id }, animais: [{ animal_id: v1 }, { animal_id: v2 }, { animal_id: touro }] }, 'exp');
  s.registrar({ tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-10-01', estacao_id: est.estacao_id, metodo: 'PALPACAO' }, animais: [{ animal_id: v1, resultado: 'POSITIVO', idade_gestacional_dias: 100 }] }, 'dg');
  for (const largura of [1280, 360]) {
    const a = await A.abrir(s, { largura, hash: 'reproducao/matrizes', relogio: RELOGIO });
    const { page } = a;
    await A.esperarTela(page, 'Reprodução');
    await page.waitForSelector('[data-resumo-matrizes] ~ * .tabela-componente, .tabela-componente');
    const lista = await textoTela(page, '.tabela-componente');
    assert.match(lista, /0457(Situação: )?Prenha/, largura + ': a prenhe (tabela ou cartão)');
    assert.match(lista, /0391(Situação: )?Exposta \(com touro\)/, largura + ': a exposta');
    assert.doesNotMatch(lista, /\b12\b.*Exposta/, 'o touro não é fêmea');
    await semProblemasDeLeiaute(page, largura, 'fêmeas');
    if (largura === 1280) {
      // As escolhidas: o diagnóstico abre o lançamento com as duas.
      assert.equal(await page.isDisabled('[data-registrar="DIAGNOSTICO_GESTACAO"]'), true, 'sem fêmea escolhida, o botão espera');
      await page.click('button:has-text("Selecionar os 2 filtrados")');
      await page.click('[data-registrar="DIAGNOSTICO_GESTACAO"]');
      await page.waitForSelector('.form-evento');
      assert.equal(await page.locator('input[value="DIAGNOSTICO_GESTACAO"]').isChecked(), true, 'o diagnóstico escolhido');
      assert.equal(await page.locator('.cartao-animal').count(), 2, 'as duas fêmeas escolhidas no lançamento');
      assert.equal(await page.locator('[data-campo="estacao_id"] select').inputValue(), est.estacao_id, 'a estação em curso (o diagnóstico vale depois do início)');
      // Indicadores da estação: 2 expostas, abaixo do mínimo (5): sem taxa, com o motivo.
      await A.ir(page, 'reproducao/indicadores', 'Reprodução');
      await page.waitForSelector('[data-dado="estacao-geral"], [data-secao="estacao-geral"], .secao');
      const ind = await textoTela(page, '#conteudo');
      assert.match(ind, /Estação 26/);
      assert.match(ind, /dados insuficientes/i);
      // Estação nova pela folha.
      await A.ir(page, 'reproducao/estacoes', 'Reprodução');
      await page.click('button:has-text("Nova estação")');
      await page.waitForSelector(dialogo + ' [data-cadastro="estacao.salvar"]');
      await page.fill(dialogo + ' [data-campo="nome"] input', 'Estação 27');
      await page.fill(dialogo + ' [data-campo="data_inicio"] input', '2027-06-01');
      await page.fill(dialogo + ' [data-campo="data_fim"] input', '2027-08-31');
      await page.click(dialogo + ' [data-campo="tipo"] label:has-text("Inseminação artificial")');
      await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
      await page.click(dialogo + ' [data-acao-principal]');
      await page.waitForFunction(() => /Estação 27/.test(document.querySelector('#conteudo').textContent));
      assert.deepEqual(vigentesDe(s, 'ESTACOES_MONTA').map((e) => [e.nome, e.tipo]).sort(), [['Estação 26', 'MONTA_NATURAL'], ['Estação 27', 'IA']]);
      // A ficha da matriz (bloco G inteiro) e a do touro (como touro).
      await A.ir(page, 'animal/' + v1 + '/reproducao', '0457');
      await page.waitForSelector('[data-ficha-reprodutiva]');
      const g = await textoTela(page, '[data-ficha-reprodutiva]');
      assert.match(g, /Situação reprodutiva\s*Prenha/);
      assert.match(g, /Previsão de parto.*09\/04\/2027/, '01/10/2026 + (290 − 100)');
      assert.match(g, /1 exposições · 0 coberturas · 0 inseminações · 1 diagnósticos/);
      await A.ir(page, 'animal/' + touro + '/reproducao', '12');
      await page.waitForSelector('[data-ficha-reprodutiva]');
      assert.match(await textoTela(page, '[data-ficha-reprodutiva]'), /Como touro.*01\/06\/2026 · Exposição ao touro · 2 fêmeas/);
    }
    assert.deepEqual(a.estado.erros, [], largura + ': sem erro no console');
    await a.fechar();
  }
});
