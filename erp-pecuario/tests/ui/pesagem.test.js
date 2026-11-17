'use strict';
/**
 * Pesagem (Fase 3, E3.1), nível 3 (Playwright): o modo curral a 360 px (08, seção 5; PR-06, celular e sinal fraco) —
 * brinco pelo teclado numérico, Enter, peso, Enter, contador do pasto e os que faltam, desfazer o último, brinco não
 * encontrado (pendência que impede o envio), repetido (substituir), a fila guardada no aparelho que sobrevive a recarregar
 * a página, o envio em blocos com a rede cortada (o transporte falha e o bloco fica sem confirmação), a resposta perdida
 * depois de o servidor gravar (45 s → operacao.status → reenvio com a mesma chave → nada duplicado), o aviso de peso fora
 * do esperado vindo do servidor (aceito na linha) e a página fechada no meio do envio; a ficha com a curva em SVG próprio
 * (pontos medidos, projeção tracejada "Estimativa", tabela equivalente) e a tela de desempenho, a 360 e a 1280 px. Em
 * todas: sem rolagem horizontal, alvos de toque ≥ 48 px a 360 px e nenhum erro no console. Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const RELOGIO = Date.parse('2026-11-13T14:00:00Z');
async function textoTela(page, sel) { return (await page.textContent(sel)).replace(/\s+/g, ' ').trim(); }
async function semProblemasDeLeiaute(page, largura, onde) {
  const r = await A.semRolagemHorizontal(page);
  assert.ok(r.sw <= r.cw, onde + ': sem rolagem horizontal a ' + largura + ' px (' + r.sw + ' > ' + r.cw + ')');
  if (largura < 900) assert.deepEqual(await A.alvosDeToque(page, '#conteudo'), [], onde + ': alvos de toque');
}
const vigentesDe = (s, aba) => s.read({ rota: 't', reads: [aba, 'EVENTOS', 'OPERACOES'], tratador: (tx) => tx.repo.vigentes(aba) });
const porBrinco = (sem, b) => sem.animais.find((x) => x.brinco === b).animal_id;
/** Brinco, Enter, peso, Enter (o operador no tronco, sem tocar em botão). */
async function pesar(page, brinco, peso) {
  await page.fill('#cur-brinco', brinco);
  await A.enter(page, '#cur-brinco');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'cur-peso', 'o Enter do brinco leva ao peso');
  await page.fill('#cur-peso', peso);
  await A.enter(page, '#cur-peso');
}
async function abrirCurral(s, o) {
  const a = await A.abrir(s, Object.assign({ largura: 360, hash: 'pesagens/curral', relogio: RELOGIO }, o || {}));
  await A.esperarTela(a.page, 'Pesagem no curral');
  return a;
}
const linhas = (page) => page.$$eval('.curral-lista [data-linha]', (ls) => ls.map((l) => [l.dataset.estado, l.textContent.replace(/\s+/g, ' ').trim()]));

test('modo curral a 360 px: brinco e peso com Enter, contador do pasto e os que faltam, não encontrado como pendência, repetido, desfazer o último; a fila sobrevive a recarregar a página', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const a = await abrirCurral(s);
  const { page } = a;
  assert.equal(a.pedidos('sistema.tela').map((p) => p.dados.nome).join(), 'Weights', 'a tela vem sob demanda');
  // Começo: data (hoje), método, momento e o pasto do lote.
  assert.equal(await page.inputValue('#cur-data'), '2026-11-13');
  await page.selectOption('#cur-pasto', S.PASTOS.A);
  await semProblemasDeLeiaute(page, 360, 'início do curral');
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  assert.equal(await page.getAttribute('#cur-brinco', 'inputmode'), 'numeric', 'teclado numérico para o brinco');
  assert.equal(await page.getAttribute('#cur-peso', 'inputmode'), 'decimal');
  assert.match(await textoTela(page, '.curral-contador'), /0 de 3 · faltam 3/, 'Pasto A: 0457, 12 e a bezerra sem brinco');
  await pesar(page, '0457', '412,5');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'cur-brinco', 'o Enter do peso volta ao brinco');
  assert.match(await textoTela(page, '.curral-contador'), /1 de 3 · faltam 2/);
  // Do outro pasto: entra, contado à parte.
  await page.fill('#cur-brinco', '391');
  await A.enter(page, '#cur-brinco');
  assert.match(await textoTela(page, '#cur-conferencia'), /0391.*Está em outro pasto \(Pasto B\): conta à parte/, 'sem zeros à esquerda acha 0391');
  await page.fill('#cur-peso', '455');
  await A.enter(page, '#cur-peso');
  assert.match(await textoTela(page, '.curral-contador'), /1 de 3 · faltam 2 · \+1 de outros pastos/);
  // Não encontrado: a linha entra como pendência e trava o envio.
  await pesar(page, '9999', '300');
  assert.deepEqual((await linhas(page))[0][0], 'NAO_ENCONTRADO');
  assert.equal(await page.isDisabled('[data-enviar]'), true, 'a pendência impede o envio');
  assert.match(await textoTela(page, '[data-curral-status]'), /1 pendência impede o envio/);
  // Desfazer o último tira a linha pendente.
  await page.click('[data-desfazer]');
  assert.equal((await linhas(page)).length, 2);
  // Repetido: o 0457 de novo, ainda na fila → substituir o peso.
  await pesar(page, '0457', '415,0');
  await page.waitForSelector('[data-decisao-repetido]');
  await page.click('button:has-text("Substituir o peso")');
  const ls = await linhas(page);
  assert.equal(ls.length, 2, 'o repetido substitui, não duplica');
  assert.match(ls[0][1], /0457 · 415,0 kg · na fila/);
  // Formato: vírgula, 1 casa, maior que zero (só formato: a regra é do servidor).
  await page.fill('#cur-brinco', '12');
  await A.enter(page, '#cur-brinco');
  await page.fill('#cur-peso', '300,25');
  await A.enter(page, '#cur-peso');
  assert.match(await textoTela(page, '#cur-conferencia'), /no máximo 1 casa decimal/);
  // Os que faltam do pasto: 12 e a bezerra sem brinco.
  await page.click('[data-ver-faltam]');
  assert.equal(await page.getAttribute('[data-faltam]', 'data-faltam'), '2');
  await semProblemasDeLeiaute(page, 360, 'curral com fila');
  // Recarregar a página (bateria, aba descartada): a fila volta do rascunho do aparelho.
  await page.reload();
  await A.esperarTela(page, 'Pesagem no curral');
  await page.waitForSelector('.curral-lista [data-linha]');
  assert.deepEqual((await linhas(page)).map((l) => l[0]), ['FILA', 'FILA']);
  assert.equal(vigentesDe(s, 'PESAGENS').length, 0, 'nada foi ao servidor ainda');
  assert.equal(porBrinco(sem, '0457').length > 0, true);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('modo curral com a rede cortada: o bloco fica guardado sem confirmação; a resposta perdida depois de gravar é conferida (operacao.status) e o reenvio com a mesma chave não duplica; terminar mostra o que foi gravado', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const a = await abrirCurral(s);
  const { page } = a;
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  await pesar(page, '0457', '412,5');
  await pesar(page, '12', '298,0');
  // Sem sinal: o transporte falha, nada chega ao servidor; as linhas ficam no aparelho, com a chave do bloco.
  await page.evaluate(() => { window.__gas.falharTransporte = 1; });
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="SEM_SINAL"]').length === 2);
  assert.match(await textoTela(page, '[data-curral-status]'), /Sem sinal ou sem resposta: o que foi digitado está guardado neste aparelho/);
  assert.equal(vigentesDe(s, 'PESAGENS').length, 0);
  // O sinal volta, mas a resposta se perde depois de o servidor gravar: 45 s → operacao.status → reenvio, mesma chave.
  await page.evaluate(() => { window.__gas.perder = 1; });
  await page.click('[data-enviar]');
  await page.waitForFunction(() => window.__gas.pedidos.filter((p) => p.rota === 'evento.registrar').length === 2);
  await A.esperarServidor(page);
  assert.equal(vigentesDe(s, 'PESAGENS').length, 2, 'o servidor gravou');
  await page.clock.fastForward(46000);
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 2, null, { timeout: 15000 });
  const regs = (await page.evaluate(() => window.__gas.pedidos)).filter((p) => p.rota === 'evento.registrar');
  assert.equal(new Set(regs.map((r) => r.idempotencyKey)).size, 1, 'todas as tentativas com a mesma chave');
  assert.ok(a.pedidos('operacao.status').length >= 1, 'conferiu se gravou');
  const pes = vigentesDe(s, 'PESAGENS');
  assert.deepEqual(pes.map((p) => p.peso_kg).sort(), [298, 412.5], 'nada duplicado');
  assert.equal(new Set(pes.map((p) => p.event_id)).size, 1, 'um lançamento');
  // A linha gravada mostra a conta do servidor (primeira pesagem: sem anterior).
  assert.match((await linhas(page)).map((l) => l[1]).join(' | '), /0457 · 412,5 kg · gravada · primeira pesagem/);
  // A página fechada no meio do envio: na volta, o bloco é conferido e não grava duas vezes.
  await pesar(page, '0391', '455,0');
  const antes = regs.length;
  await page.evaluate(() => { window.__gas.perder = 1; });
  await page.click('[data-enviar]');
  await page.waitForFunction((n) => window.__gas.pedidos.filter((p) => p.rota === 'evento.registrar').length === n + 1, antes);
  await A.esperarServidor(page);
  await page.reload();
  await A.esperarTela(page, 'Pesagem no curral');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 3, null, { timeout: 15000 });
  assert.equal(vigentesDe(s, 'PESAGENS').length, 3, 'a terceira gravada uma vez');
  // Terminar: o resultado com os lançamentos gravados; o rascunho sai do aparelho.
  await page.click('button:has-text("Terminar a pesagem")');
  await page.waitForSelector('[data-resultado-curral="3"]');
  assert.match(await textoTela(page, '[data-resultado-curral]'), /3 pesagens gravadas em 13\/11\/2026, em 2 lançamentos/);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => /curral-pesagem/.test(k)).length), 0, 'o rascunho saiu do aparelho');
  assert.ok(porBrinco(sem, '0391'));
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('modo curral: o peso fora do esperado vem do servidor (PESO_IMPLAUSIVEL) na linha; "Está certo" reenvia com o aceite e grava', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-09-03', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: porBrinco(sem, '0457'), peso: 441 }] }, 'base-0457');
  const a = await abrirCurral(s);
  const { page } = a;
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  await page.fill('#cur-brinco', '0457');
  await A.enter(page, '#cur-brinco');
  assert.match(await textoTela(page, '#cur-conferencia'), /441,0 kg em 03\/09/, 'o último peso, da lista do aparelho');
  await page.fill('#cur-peso', '45,0');
  await A.enter(page, '#cur-peso');
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="AVISO"]');
  assert.match(await textoTela(page, '.curral-lista [data-estado="AVISO"]'), /45,0 kg em 13\/11\/2026 contra 441,0 kg em 03\/09\/2026 \(71 dias\) dá -5,58 kg por dia/);
  assert.equal(vigentesDe(s, 'PESAGENS').length, 1, 'nada gravado sem o aceite');
  await semProblemasDeLeiaute(page, 360, 'curral com aviso');
  await page.click('.curral-lista button:has-text("Está certo")');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]');
  const ev = s.tabela('EVENTOS').filter((e) => e.event_type === 'PESAGEM').pop();
  assert.deepEqual(ev.payload_json.avisos_aceitos, [{ codigo: 'PESO_IMPLAUSIVEL', n: 1 }]);
  assert.match(await textoTela(page, '.curral-lista [data-estado="GRAVADA"]'), /-396,0 kg em 71 dias/);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

for (const largura of [360, 1280]) {
  test('ficha do animal, aba Peso: curva em SVG próprio com os 3 pesos, projeção tracejada "Estimativa", tabela equivalente e a de ganho, dias, GMD e variação (' + largura + ' px)', async () => {
    const s = A.sistema();
    const sem = A.semear(s);
    const id = porBrinco(sem, '12');
    [['2026-03-10', 300.0], ['2026-06-09', 372.8], ['2026-06-19', 380.0]].forEach(([d, p], i) => s.registrar({ tipo: 'PESAGEM', campos: { event_date: d, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id, peso: p }] }, 'p' + i));
    const a = await A.abrir(s, { largura, hash: 'animal/' + id + '/peso', relogio: RELOGIO });
    const { page } = a;
    await page.waitForSelector('[data-bloco-peso] svg');
    assert.equal(await page.locator('[data-bloco-peso] svg [data-marcador="medido"]').count(), 3, 'três marcadores');
    assert.equal(await page.locator('[data-bloco-peso] svg [data-marcador="projecao"]').count(), 1, 'a projeção tracejada');
    assert.match(await textoTela(page, '[data-bloco-peso] svg'), /Estimativa/);
    const bloco = await textoTela(page, '[data-bloco-peso]');
    assert.match(bloco, /Peso atual\s*380,0 kg em 19\/06\/2026/);
    assert.match(bloco, /Ganho no período\s*80,0 kg em 101 dias/);
    assert.match(bloco, /0,800 kg\/dia/, 'o GMD do servidor, na tabela');
    assert.match(bloco, /24,27%/);
    assert.match(bloco, /De 09\/06\/2026 a 19\/06\/2026: sem ganho médio diário\. Intervalo de 10 dias, menor que os 28 dias mínimos/);
    await page.click('[data-bloco-peso] .grafico-tabela summary');
    const tabela = await textoTela(page, '[data-bloco-peso] .grafico-tabela table');
    assert.match(tabela, /10\/03\/2026\s*300,0 kg\s*Pesagem/);
    assert.match(tabela, /Projeção \(estimativa\)/, 'a projeção também na tabela, rotulada');
    await semProblemasDeLeiaute(page, largura, 'aba Peso');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });

  test('tela de desempenho (Pesagens, sob demanda): peso médio e GMD por pasto e por categoria, as pesagens com o GMD de lote e a curva de um animal (' + largura + ' px)', async () => {
    const s = A.sistema();
    const sem = A.semear(s);
    const ids = ['0457', '12'].map((b) => porBrinco(sem, b));
    s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-08-15', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids[0], peso: 300 }, { animal_id: ids[1], peso: 250 }] }, 'p1');
    s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-10-14', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids[0], peso: 345 }, { animal_id: ids[1], peso: 280 }] }, 'p2');
    const a = await A.abrir(s, { largura, hash: 'pesagens', relogio: RELOGIO });
    const { page } = a;
    await A.esperarTela(page, 'Pesagens');
    await page.waitForSelector('[data-desempenho] [data-indicadores-peso]');
    assert.match(await textoTela(page, '[data-secao="por-pasto"]'), /Pasto A/);
    assert.match(await textoTela(page, '[data-secao="pesagens"]'), /14\/10\/2026/);
    assert.match(await textoTela(page, '[data-secao="pesagens"]'), /— \(Sem pesagem anterior com ao menos 5 destes animais e 28 dias de intervalo\.\)/, 'o GMD de lote sem valor, com o motivo do servidor');
    await page.fill('#curva-brinco', '0457');
    await page.click('[data-curvas] button:has-text("Mostrar")');
    await page.waitForSelector('[data-curvas] svg [data-marcador="medido"]');
    assert.equal(await page.locator('[data-curvas] svg [data-marcador="medido"]').count(), 2);
    assert.ok(a.pedidos('peso.desempenho').some((p) => (p.dados.animais || []).length === 1), 'a curva pedida ao servidor');
    await semProblemasDeLeiaute(page, largura, 'desempenho');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}

test('corrigir uma pesagem pelo detalhe do evento a 360 px: o formulário vem com momento, método e o peso gravados; a revisão mostra a diferença; o substituto grava o peso novo', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = porBrinco(sem, '0457');
  const r = s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-10-14', tipo_pesagem: 'DESMAMA', metodo_pesagem: 'FITA', jejum: true }, animais: [{ animal_id: id, peso: 300 }] }, 'pes-c');
  const a = await A.abrir(s, { largura: 360, hash: 'evento/' + r.event_id, relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem');
  await page.waitForSelector('[data-secao="pesagens"]');
  assert.match(await textoTela(page, '[data-secao="pesagens"]'), /300,0 kg/);
  await page.click('[data-acoes-evento] button:has-text("Corrigir")');
  await A.esperarTela(page, 'Corrigir: Pesagem');
  assert.equal(await page.inputValue('[data-campo="tipo_pesagem"] select'), 'DESMAMA', 'o momento gravado');
  assert.equal(await page.$eval('[data-campo="metodo_pesagem"] input:checked', (r) => r.value), 'FITA', 'o método gravado');
  assert.equal(await page.$eval('[data-campo="jejum"] input:checked', (r) => r.value), 'true', 'o jejum gravado');
  const peso = page.locator('[data-linha] [data-campo="peso"] input');
  assert.equal(await peso.inputValue(), '300,0', 'o peso como foi digitado');
  await peso.fill('305,0');
  await page.fill('[data-campo="justificativa_correcao"] textarea', 'Leitura errada da fita');
  await semProblemasDeLeiaute(page, 360, 'correção da pesagem');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector('[role=dialog] [data-diferencas="1"]');
  assert.match(await textoTela(page, '[role=dialog] [data-diferencas]'), /300,0.*305,0/);
  await page.waitForSelector('[role=dialog] [data-acao-principal]:not([disabled])');
  await page.click('[role=dialog] [data-acao-principal]');
  // Revisão local (pesagem é frequente): o aviso no rodapé e a volta ao detalhe de onde a correção saiu.
  await page.waitForFunction(() => /Correção gravada/.test(document.getElementById('avisos').textContent) && /^evento\//.test(window.Roteador.atual()));
  const vig = vigentesDe(s, 'PESAGENS').filter((p) => p.animal_id === id);
  assert.deepEqual(vig.map((p) => [p.data_pesagem, p.peso_kg, p.tipo, p.metodo]), [['2026-10-14', 305, 'DESMAMA', 'FITA']], 'uma pesagem vigente, a do substituto');
  const sub = s.tabela('EVENTOS').filter((e) => e.event_type === 'PESAGEM' && e.event_id !== r.event_id).pop();
  assert.equal(sub.payload_json.jejum, true, 'o jejum passa ao substituto');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
