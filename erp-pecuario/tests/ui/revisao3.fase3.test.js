'use strict';
/**
 * Revisão da Fase 3, rodada 3 (conserto), lentes INTERFACE E REGRAS, ZOOTECNIA E CUSTO e CORREÇÕES ANTERIORES (nível 3,
 * Playwright, backend real do harness): o curral e o tronco não mudam a sessão depois que um bloco saiu, o bloco sai sempre com
 * o cabeçalho de quando foi criado e a recusa do servidor não vira "sem sinal" nem trava a fila; com data passada e sem a
 * posição do servidor, o brinco não é resolvido pela posição de hoje (fica pendente até a posição chegar, com "Tentar de
 * novo"); o botão "Prenhe" grava prenhe; o código interno acha só o animal sem brinco; a conferência descreve o animal no dia;
 * a linha gravada mostra o GMD com o intervalo dele e o porquê do GMD vazio; a lista de indicadores diz "(parcial)" com o
 * motivo do servidor; pastos com o mesmo nome não se fundem no gráfico; a curva acha a vaca pelo brinco inteiro; a fêmea apta
 * sem histórico não aparece como "Não apta"; a revisão da correção diz o que o servidor grava (estoque e custo).
 * Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const RELOGIO = Date.parse('2026-11-13T14:00:00Z');
const dialogo = '[role=dialog]';
const txt = async (page, sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
const linhas = (page) => page.$$eval('.curral-lista [data-linha]', (ls) => ls.map((l) => [l.dataset.estado, l.textContent.replace(/\s+/g, ' ').trim()]));
const doServidor = (s, aba) => s.read({ rota: 't', reads: [aba, 'EVENTOS', 'OPERACOES'], tratador: (tx) => tx.repo.vigentes(aba) });
const registros = (page) => page.evaluate(() => window.__gas.pedidos.filter((p) => p.rota === 'evento.registrar').map((p) => ({ chave: p.idempotencyKey, campos: p.dados.campos, n: p.dados.animais.length })));
function ok(s, rota, dados, chave) {
  const r = s.api({ rota, idempotencyKey: chave || 'k-' + Math.random(), dados });
  if (!r.ok) throw new Error(rota + ': ' + JSON.stringify(r.error));
  return r.data;
}
async function pesar(page, brinco, peso) {
  await page.fill('#cur-brinco', brinco);
  await A.enter(page, '#cur-brinco');
  await page.fill('#cur-peso', peso);
  await A.enter(page, '#cur-peso');
}
/** A próxima chamada da rota responde com a recusa dada (o servidor não é chamado): o teste da recusa inesperada. */
function recusarProxima(s, rota, code, message) {
  const orig = s.G.api;
  s.G.api = (pedido) => {
    if (pedido.rota !== rota) return orig(pedido);
    s.G.api = orig;
    return { ok: false, error: { code, message, details: [] }, meta: {} };
  };
}
/** Rebanho de exemplo com o 0457 da vaca A trocado em 11/11 (1457) e o 0457 reaproveitado na vaca B (0391) em 12/11. */
function brincosTrocados() {
  const s = A.sistema({ config: { brinco_permite_reuso: 'S' } });
  const sem = A.semear(s);
  const vacaA = sem.animais.find((x) => x.brinco === '0457').animal_id;
  const vacaB = sem.animais.find((x) => x.brinco === '0391').animal_id;
  s.registrar({ tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-11-11', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: vacaA, codigo: '1457', motivo: 'PERDA' }] }, 'troca-a');
  s.registrar({ tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-11-12', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: vacaB, codigo: '0457', motivo: 'RENUMERACAO' }] }, 'troca-b');
  return { s, sem, vacaA, vacaB };
}

test('achado 2 (curral): com um bloco sem confirmação, "Mudar data, método ou pasto" some; o reenvio leva o mesmo cabeçalho e a fila segue; a recusa inesperada do servidor (bloco já gravado com outro conteúdo) aparece como recusa, com a mensagem, e não trava a fila', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  assert.ok(await page.isVisible('[data-curral-mudar] button:has-text("Mudar data, método ou pasto")'), 'antes de enviar, a sessão muda');
  await pesar(page, '0457', '412,5');
  await pesar(page, '12', '298,0');
  // A resposta se perde depois de gravar, e a conferência (operacao.status) também cai: bloco sem confirmação.
  await page.evaluate(() => { window.__gas.perder = 1; });
  await page.click('[data-enviar]');
  await page.waitForFunction(() => window.__gas.pedidos.filter((p) => p.rota === 'evento.registrar').length === 1);
  await A.esperarServidor(page);
  await page.evaluate(() => { window.__gas.falharTransporte = 6; });
  await page.clock.fastForward(46000);
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="SEM_SINAL"]').length === 2, null, { timeout: 15000 });
  assert.equal(await page.locator('button:has-text("Mudar data, método ou pasto")').count(), 0, 'com bloco sem confirmação, a sessão não muda');
  await page.evaluate(() => { window.__gas.falharTransporte = 0; });
  await pesar(page, '0391', '455');
  await page.waitForSelector('[data-enviar]:not([disabled])', { timeout: 15000 });
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 3, null, { timeout: 15000 });
  await A.esperarServidor(page);
  const envios = await registros(page);
  assert.equal(envios[0].chave, envios[1].chave, 'o mesmo bloco, com a mesma chave');
  assert.deepEqual(envios[1].campos, envios[0].campos, 'e o mesmo cabeçalho');
  assert.deepEqual(doServidor(s, 'PESAGENS').map((p) => [p.metodo, p.peso_kg]).sort(), [['BALANCA', 298], ['BALANCA', 412.5], ['BALANCA', 455]]);
  assert.equal(await page.locator('button:has-text("Mudar data, método ou pasto")').count(), 0, 'com bloco gravado, a sessão não muda');
  // A recusa que não é falta de sinal: as linhas viram pendência com o motivo, a mensagem do servidor fica na área de status,
  // nada diz "sem sinal", e depois de tirar a linha recusada o resto sai.
  await pesar(page, '000004', '180');
  recusarProxima(s, 'evento.registrar', 'IDEMPOTENCY_MISMATCH', 'Este formulário já foi gravado com outro conteúdo. Atualize a tela e comece um lançamento novo.');
  await page.waitForSelector('[data-enviar]:not([disabled])', { timeout: 15000 });
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="ERRO"]', { timeout: 15000 });
  assert.match(await txt(page, '[data-erro-geral]'), /já foi gravado com outro conteúdo/);
  assert.doesNotMatch(await txt(page, '[data-curral-status]'), /Sem sinal/);
  // A chave já está gravada (com outro conteúdo): a linha nunca sai de novo com outra chave — só "Tirar", sem "Corrigir o peso"
  // (teste aleatório do curral, etapa 3: corrigida, ela gravaria duas vezes).
  assert.match((await linhas(page)).find((l) => l[0] === 'ERRO')[1], /já foi gravado com outro conteúdo: confira em Eventos e tire a linha daqui/);
  assert.equal(await page.locator('.curral-lista [data-estado="ERRO"] button:has-text("Corrigir o peso")').count(), 0);
  await page.click('.curral-lista [data-estado="ERRO"] button:has-text("Tirar")');
  await pesar(page, '000004', '181');
  await page.waitForSelector('[data-enviar]:not([disabled])', { timeout: 15000 });
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 4, null, { timeout: 15000 });
  await A.esperarServidor(page);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 2 (tronco): depois de um bloco gravado, "Mudar data, método ou estação" some; a falha interna do servidor aparece com a mensagem dele, não como "sem sinal", e o bloco sai de novo com a mesma chave (etapa 3: ela não prova que nada foi gravado)', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 360, hash: 'reproducao/tronco', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Diagnóstico no tronco');
  await page.click('button:has-text("Começar")');
  await page.waitForSelector('#tr-brinco');
  assert.ok(await page.isVisible('[data-tronco-mudar] button'));
  await page.fill('#tr-brinco', '0457'); await A.enter(page, '#tr-brinco');
  await page.fill('#tr-resultado', 'p'); await A.enter(page, '#tr-resultado');
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
  assert.equal(await page.locator('button:has-text("Mudar data, método ou estação")').count(), 0);
  await page.fill('#tr-brinco', '0391'); await A.enter(page, '#tr-brinco');
  await page.fill('#tr-resultado', 'v'); await A.enter(page, '#tr-resultado');
  recusarProxima(s, 'evento.registrar', 'INTERNAL', 'Falha interna do servidor.');
  await page.click('[data-enviar]');
  await page.waitForSelector('[data-recusa-incerta]', { timeout: 15000 });
  assert.match(await txt(page, '[data-recusa-incerta]'), /O servidor recusou o envio de 1 diagnóstico: Falha interna do servidor\. Eles continuam guardados com a mesma chave/);
  assert.doesNotMatch(await txt(page, '[data-tronco-status]'), /Sem sinal/);
  // Sem "Tirar" nem "Corrigir": a linha pode estar gravada; o "Enviar" a manda de novo com a mesma chave.
  assert.equal(await page.locator('.curral-lista [data-estado="ERRO"]').count(), 0);
  assert.equal(await page.locator('.curral-lista [data-estado="SEM_SINAL"] button').count(), 0);
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 2, null, { timeout: 15000 });
  const envios = await registros(page);
  assert.equal(envios[envios.length - 1].chave, envios[envios.length - 2].chave, 'o reenvio usa a mesma chave');
  assert.equal(doServidor(s, 'REPRODUCAO').filter((r) => r.tipo_evento === 'DIAGNOSTICO_GESTACAO').length, 2, 'cada diagnóstico gravado uma vez');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 3 (curral): com data passada e sem a posição do servidor, o brinco não vai para a dona de hoje — a linha fica pendente; "Tentar de novo" traz a posição e a pesagem vai para quem tinha o número no dia', async () => {
  const { s, vacaA } = brincosTrocados();
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.fill('#cur-data', '2026-11-10');
  // Sem sinal: falham a posição da data e a conferência do brinco no servidor (o resolvedor único; CONTRATOS, seção 47).
  await page.evaluate(() => { window.__gas.falharTransporte = 2; });
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  await page.waitForSelector('[data-posicao-erro]', { timeout: 15000 });
  assert.doesNotMatch(await txt(page, '[data-curral-posicao]'), /servidor confere na gravação|posição de hoje;/);
  await page.fill('#cur-brinco', '0457');
  await A.enter(page, '#cur-brinco');
  assert.equal(await page.getAttribute('#cur-conferencia [data-conferencia]', 'data-conferencia'), 'SEM_POSICAO');
  assert.doesNotMatch(await txt(page, '#cur-conferencia'), /A-000002|Pasto B/, 'nada da dona de hoje');
  await page.fill('#cur-peso', '410');
  await A.enter(page, '#cur-peso');
  assert.deepEqual((await linhas(page)).map((l) => l[0]), ['NAO_ENCONTRADO']);
  assert.ok(await page.isDisabled('[data-enviar]'), 'pendente: não sai');
  await page.click('[data-posicao-tentar]');
  await page.waitForFunction(() => /posição em 10\/11\/2026/.test((document.querySelector('[data-curral-posicao]') || {}).textContent || ''), null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="FILA"]').length === 1);
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
  await A.esperarServidor(page);
  assert.deepEqual(doServidor(s, 'PESAGENS').map((p) => [p.animal_id, p.data_pesagem, p.peso_kg]), [[vacaA, '2026-11-10', 410]], 'na vaca que tinha o 0457 em 10/11');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 3 (tronco): com data passada e sem a posição, o diagnóstico fica pendente (sem a situação de hoje); com a posição, vai para a fêmea que tinha o número no dia', async () => {
  const { s, vacaA } = brincosTrocados();
  const a = await A.abrir(s, { largura: 360, hash: 'reproducao/tronco', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Diagnóstico no tronco');
  await page.fill('#tr-data', '2026-11-10');
  // Sem sinal: falham a conferência da data e a do brinco no servidor (o resolvedor único; CONTRATOS, seção 47).
  await page.evaluate(() => { window.__gas.falharTransporte = 2; });
  await page.click('button:has-text("Começar")');
  await page.waitForSelector('#tr-brinco');
  await page.waitForSelector('[data-posicao-erro]', { timeout: 15000 });
  await page.fill('#tr-brinco', '0457');
  await A.enter(page, '#tr-brinco');
  assert.equal(await page.getAttribute('#tr-conferencia [data-conferencia]', 'data-conferencia'), 'SEM_POSICAO');
  assert.doesNotMatch(await txt(page, '#tr-conferencia'), /sem informação|A-000002/i);
  await page.fill('#tr-resultado', 'p');
  await A.enter(page, '#tr-resultado');
  assert.deepEqual((await linhas(page)).map((l) => l[0]), ['NAO_ENCONTRADO']);
  await page.click('[data-posicao-tentar]');
  await page.waitForSelector('[data-tronco-posicao]', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="FILA"]').length === 1);
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
  await A.esperarServidor(page);
  assert.deepEqual(doServidor(s, 'REPRODUCAO').filter((r) => r.tipo_evento === 'DIAGNOSTICO_GESTACAO').map((r) => [r.animal_id, r.data, r.resultado]), [[vacaA, '2026-11-10', 'POSITIVO']]);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 4: no tronco, o botão "Prenhe" grava prenhe mesmo com "v" ou "d" no campo; do campo, só a idade da gestação (p90) vai junto', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 360, hash: 'reproducao/tronco', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Diagnóstico no tronco');
  await page.click('button:has-text("Começar")');
  await page.waitForSelector('#tr-brinco');
  await page.fill('#tr-brinco', '0457'); await A.enter(page, '#tr-brinco');
  await page.fill('#tr-resultado', 'v');
  await page.click('[data-resultado-rapido="p"]');
  await page.fill('#tr-brinco', '0391'); await A.enter(page, '#tr-brinco');
  await page.fill('#tr-resultado', 'p 90');
  await page.click('[data-resultado-rapido="p"]');
  const ls = await linhas(page);
  assert.match(ls[1][1], /0457 · prenhe · /);
  assert.match(ls[0][1], /0391 · prenhe \(90 dias\)/);
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 2, null, { timeout: 15000 });
  await A.esperarServidor(page);
  assert.deepEqual(doServidor(s, 'REPRODUCAO').map((r) => [r.resultado, r.idade_gestacional_dias || null]).sort(), [['POSITIVO', null], ['POSITIVO', 90]]);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 5: o brinco inexistente com cara de código ("A3", "000003") fica não encontrado, nunca no animal de código A-000003 que tem outro brinco; o código inteiro dele diz qual é o brinco; no tronco, o mesmo', async () => {
  const s = A.sistema();
  const r = s.registrar({ tipo: 'ENTRADA_INICIAL', campos: {}, animais: ['A2', 'A1', 'A9'].map((b) => S.bicho({ brinco: b, data_nascimento: '2022-05-01', data_nascimento_confianca: 'CONFIRMADA' })) }, 'reb');
  assert.deepEqual(r.animais.map((x) => [x.brinco, x.codigo_interno]), [['A2', 'A-000001'], ['A1', 'A-000002'], ['A9', 'A-000003']]);
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  for (const t of ['A3', '000003']) {
    await page.fill('#cur-brinco', t);
    await A.enter(page, '#cur-brinco');
    assert.equal(await page.getAttribute('#cur-conferencia [data-conferencia]', 'data-conferencia'), 'NAO_ENCONTRADO', t);
  }
  assert.match(await txt(page, '#cur-conferencia'), /000003 é o código interno de um animal com brinco \(A9\): digite o brinco dele/);
  await page.fill('#cur-peso', '400');
  await A.enter(page, '#cur-peso');
  assert.deepEqual((await linhas(page)).map((l) => l[0]), ['NAO_ENCONTRADO']);
  assert.deepEqual(doServidor(s, 'PESAGENS'), []);
  await a.fechar();
  const b = await A.abrir(s, { largura: 360, hash: 'reproducao/tronco', relogio: RELOGIO });
  await A.esperarTela(b.page, 'Diagnóstico no tronco');
  await b.page.click('button:has-text("Começar")');
  await b.page.waitForSelector('#tr-brinco');
  await b.page.fill('#tr-brinco', 'A3');
  await A.enter(b.page, '#tr-brinco');
  assert.equal(await b.page.getAttribute('#tr-conferencia [data-conferencia]', 'data-conferencia'), 'NAO_ENCONTRADO');
  assert.deepEqual(a.estado.erros.concat(b.estado.erros), []);
  await b.fechar();
});

test('achados 8, 22 e 25: a linha gravada do curral mostra o GMD com o intervalo dele (desde quando) quando ele não começa na pesagem anterior; e o porquê do GMD vazio no intervalo curto', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = sem.animais.find((x) => x.brinco === '0457').animal_id;
  const id12 = sem.animais.find((x) => x.brinco === '12').animal_id;
  s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-09-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id, peso: 300 }] }, 'p1', { avisosAceitos: ['PESO_IMPLAUSIVEL'] });
  s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-10-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'ESTIMATIVA_VISUAL' }, animais: [{ animal_id: id, peso: 400 }] }, 'p2', { avisosAceitos: ['PESO_IMPLAUSIVEL'] });
  s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-11-03', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id12, peso: 400 }] }, 'p3', { avisosAceitos: ['PESO_IMPLAUSIVEL'] });
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  await pesar(page, '0457', '360');
  await pesar(page, '12', '405');
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 2, null, { timeout: 15000 });
  const ls = await linhas(page);
  const l457 = ls.find((l) => /0457/.test(l[1]))[1];
  assert.match(l457, /-40,0 kg em 43 dias contra peso estimado · ganho médio diário de 0,822 kg\/dia desde 01\/09\/2026 \(\+60,0 kg em 73 dias\)/);
  assert.doesNotMatch(l457, /43 dias contra peso estimado \(0,8/);
  const l12 = await page.$eval('.curral-lista [data-linha]:first-child', (l) => l.textContent.replace(/\s+/g, ' '));
  assert.match(l12, /\+5,0 kg em 10 dias/);
  assert.match(l12, /Intervalo de 10 dias/, 'o porquê do GMD vazio com a anterior medida');
  assert.equal(await page.locator('[data-gmd-explicacao]').count(), 1);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 9: no curral com data passada, a conferência descreve o animal NAQUELE dia (pasto e último peso até a data), não o de hoje', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = sem.animais.find((x) => x.brinco === '0457').animal_id;
  s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-10-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id, peso: 380 }] }, 'p1', { avisosAceitos: ['PESO_IMPLAUSIVEL'] });
  s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-11-08', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: id }] }, 't1');
  s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-11-12', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id, peso: 455 }] }, 'p2', { avisosAceitos: ['PESO_IMPLAUSIVEL'] });
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.fill('#cur-data', '2026-11-05');
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  await page.waitForFunction(() => /posição em 05\/11\/2026/.test((document.querySelector('[data-curral-posicao]') || {}).textContent || ''));
  await page.fill('#cur-brinco', '0457');
  await A.enter(page, '#cur-brinco');
  const c = await txt(page, '#cur-conferencia');
  assert.match(c, /Pasto A · 380,0 kg em 01\/10/);
  assert.doesNotMatch(c, /455|Pasto B/);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 13: a lista dos indicadores da estação diz "(parcial)" na natalidade e na desmama com o motivo do servidor (prenhe ainda sem parto), igual ao gráfico', async () => {
  const s = A.sistema();
  const bichos = [];
  for (let i = 0; i < 6; i++) bichos.push(S.bicho({ brinco: 'V' + i, data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }));
  bichos.push(S.bicho({ brinco: 'T1', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA' }));
  const ent = s.registrar(S.entradaInicial(bichos), 'rebanho');
  const id = Object.fromEntries(ent.animais.map((x) => [x.brinco, x.animal_id]));
  const est = ok(s, 'estacao.salvar', { campos: { nome: 'E26', data_inicio: '2026-01-10', data_fim: '2026-03-31', tipo: 'MONTA_NATURAL' } });
  s.registrar({ tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-01-10', estacao_id: est.estacao_id }, animais: ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'T1'].map((b) => ({ animal_id: id[b] })) }, 'exp');
  s.registrar({ tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-10-01', estacao_id: est.estacao_id }, animais: ['V0', 'V1', 'V2', 'V3', 'V4', 'V5'].map((b, i) => (i < 4 ? { animal_id: id[b], resultado: 'POSITIVO', idade_gestacional_dias: 200 } : { animal_id: id[b], resultado: 'NEGATIVO' })) }, 'dg');
  const a = await A.abrir(s, { largura: 360, hash: 'reproducao/indicadores', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Reprodução');
  await page.waitForSelector('[data-grafico-id="taxas-estacao"] svg', { timeout: 15000 });
  const pares = await page.$$eval('dl dt', (ds) => ds.map((d) => d.textContent + ': ' + d.nextElementSibling.textContent.replace(/\s+/g, ' ')));
  assert.match(pares.find((x) => /^Natalidade/.test(x)), /0 nascidos vivos de 6 expostas \(parcial: há prenhe ainda sem parto\)/);
  const desm = pares.find((x) => /^Taxa de desmama/.test(x));
  assert.match(desm, /\(parcial: há prenhe ainda sem parto\)/);
  assert.doesNotMatch(desm, /0 ainda ao pé/);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 14: no desempenho, dois pastos "Pasto A" (propriedades diferentes) são dois itens do gráfico e da tabela, cada um com o seu total', async () => {
  const s = A.sistema();
  const prop2 = ok(s, 'propriedade.salvar', { campos: { nome: 'Retiro São José' } }).property_id;
  const pid2 = ok(s, 'pasto.salvar', { campos: { property_id: prop2, nome: 'Pasto A' } }).pasture_id;
  const bichos = [];
  for (let i = 0; i < 3; i++) bichos.push(S.bicho({ brinco: 'A' + i, sexo: 'M', castrado: true, data_nascimento: '2025-01-01', data_nascimento_confianca: 'CONFIRMADA' }));
  for (let i = 0; i < 2; i++) bichos.push(S.bicho({ brinco: 'B' + i, sexo: 'M', castrado: true, pasto_destino_id: pid2, data_nascimento: '2025-01-01', data_nascimento_confianca: 'CONFIRMADA' }));
  s.registrar(S.entradaInicial(bichos), 'rebanho');
  const a = await A.abrir(s, { largura: 1280, hash: 'pesagens', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagens');
  await page.waitForSelector('[data-grafico-id="rebanho-categorias"]', { timeout: 15000 });
  const tab = await page.$$eval('[data-grafico-id="rebanho-categorias"] details table tbody tr', (trs) => trs.map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()));
  assert.equal(tab.length, 2, JSON.stringify(tab));
  assert.ok(tab.some((l) => /Pasto A \(Fazenda Boa Vista\).*3$/.test(l)), JSON.stringify(tab));
  assert.ok(tab.some((l) => /Pasto A \(Retiro São José\).*2$/.test(l)), JSON.stringify(tab));
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 15: "Comparar a curva" com o brinco inteiro de uma vaca com bezerro sem brinco põe a curva da vaca', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const mae = sem.animais.find((x) => x.brinco === '0457').animal_id;
  s.registrar({ tipo: 'NASCIMENTO', campos: { event_date: '2026-08-01' }, animais: [{ animal_id: mae }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] }, 'parto-1');
  s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-09-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: mae, peso: 400 }] }, 'p1');
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagens');
  await page.waitForSelector('#curva-brinco', { timeout: 15000 });
  await page.fill('#curva-brinco', '0457');
  await page.click('[data-curvas] button:has-text("Mostrar")');
  await page.waitForFunction(() => window.__gas.pedidos.some((p) => p.rota === 'peso.desempenho' && (p.dados.animais || []).length));
  await A.esperarServidor(page);
  const pedidos = (await page.evaluate(() => window.__gas.pedidos)).filter((p) => p.rota === 'peso.desempenho' && (p.dados.animais || []).length);
  assert.deepEqual(pedidos.pop().dados.animais, [mae]);
  assert.doesNotMatch(await txt(page, '#avisos'), /Mais de um animal/);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 20: na lista de Fêmeas, a novilha apta sem nenhum registro reprodutivo aparece como "Sem histórico reprodutivo", nunca "Não apta"; o filtro "Não apta" não a traz', async () => {
  const s = A.sistema({ config: { idade_min_reprodutiva_meses: '6' } });
  const sem = A.semear(s);
  const mae = sem.animais.find((x) => x.brinco === '0457').animal_id;
  s.registrar({ tipo: 'NASCIMENTO', campos: { event_date: '2026-02-01' }, animais: [{ animal_id: mae }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '777' }] }, 'parto-1');
  const it = ok(s, 'reproducao.matrizes', {}).itens.find((x) => x.brinco === '777');
  assert.deepEqual([it.apta, it.situacao_reprodutiva, it.sem_historico], [true, 'NAO_APTA', true]);
  assert.equal(ok(s, 'reproducao.matrizes', { situacao: 'NAO_APTA' }).itens.filter((x) => x.brinco === '777').length, 0);
  assert.equal(ok(s, 'reproducao.matrizes', { situacao: 'SEM_INFORMACAO' }).itens.filter((x) => x.brinco === '777').length, 1);
  const a = await A.abrir(s, { largura: 1280, hash: 'reproducao/matrizes', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Reprodução');
  await page.waitForSelector('.tabela-componente', { timeout: 15000 });
  const linha = await page.$$eval('.tabela-componente tbody tr', (trs) => trs.map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /777/.test(t))[0]);
  assert.match(linha, /Sem histórico reprodutivo/);
  assert.doesNotMatch(linha, /Não apta/);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achados 17 e 19: a revisão da correção diz o que o servidor grava — a entrada sem movimento continua fora do saldo; a aplicação gravada sem custo mantém o custo daquele dia', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const pid = ok(s, 'produto.salvar', { campos: { nome: 'Vacina Q', categoria: 'VACINA', unidade: 'dose', controla_estoque: false } }).product_id;
  const ent = s.registrar({ tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-11-01', product_id: pid, quantidade: 100, valor: 10000 }, animais: [] }, 'e1');
  const ids = sem.animais.filter((x) => x.brinco === '0457' || x.brinco === '12').map((x) => x.animal_id);
  const vac = s.registrar({ tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-11-05', produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 1 }, animais: ids.map((animal_id) => ({ animal_id })) }, 'v1');
  const liga = s.api({ rota: 'produto.salvar', idempotencyKey: 'liga', avisosAceitos: ['ESTOQUE_INSUFICIENTE'], dados: { product_id: pid, campos: { controla_estoque: true, custo_unitario: 3 }, justificativa: 'controle e custo' } });
  assert.ok(liga.ok, JSON.stringify(liga.error));
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/' + ent.event_id, relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page);
  await page.click('[data-acoes-evento] button:has-text("Corrigir")');
  await A.esperarTela(page, 'Corrigir:');
  await page.fill('[data-campo="justificativa_correcao"] textarea', 'Número da nota');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])', { timeout: 15000 });
  const rev = await txt(page, dialogo);
  assert.match(rev, /Entra no estoque\s*nada: a compra foi lançada quando Vacina Q não controlava estoque, e a correção a mantém fora do saldo/);
  assert.doesNotMatch(rev, /Entra no estoque\s*100/);
  await a.fechar();
  const b = await A.abrir(s, { largura: 1280, hash: 'evento/' + vac.event_id, relogio: RELOGIO });
  await A.esperarTela(b.page);
  await b.page.click('[data-acoes-evento] button:has-text("Corrigir")');
  await A.esperarTela(b.page, 'Corrigir:');
  await b.page.fill('[data-campo="justificativa_correcao"] textarea', 'O veterinário');
  await b.page.click('.form-evento button[type=submit]');
  await b.page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])', { timeout: 15000 });
  const rev2 = await txt(b.page, dialogo);
  assert.match(rev2, /Custo pelo consumo\s*sem custo: a aplicação original foi gravada sem custo .*a correção mantém o custo daquele dia/);
  assert.doesNotMatch(rev2, /Preencha o custo por unidade no cadastro/);
  assert.deepEqual(a.estado.erros.concat(b.estado.erros), []);
  await b.fechar();
});
