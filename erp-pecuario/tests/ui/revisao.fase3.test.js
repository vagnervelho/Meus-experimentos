'use strict';
/**
 * Revisão da Fase 3 (conserto), lente INTERFACE E REGRAS (nível 3, Playwright, backend real do harness): a recusa do
 * servidor no curral e no tronco fica na linha (ERRO, com o motivo e "Tirar") ou na área de status, nunca some calada;
 * nenhuma linha fica presa num bloco que não saiu depois de uma resposta perdida; o curral com data passada confere pela
 * posição do servidor naquela data; o rascunho do tronco aparece no Início; os gráficos de lote e de categoria têm um item
 * por lançamento e por categoria; a lista de aplicações mostra o produto; a ficha com versão nova oferece "Recarregar a
 * página"; o modo curral mostra o GMD do servidor (vazio no intervalo curto). Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const RELOGIO = Date.parse('2026-11-13T14:00:00Z');
const txt = async (page, sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
const ok = (r) => { if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data; };
const linhas = (page) => page.$$eval('.curral-lista [data-linha]', (ls) => ls.map((l) => [l.dataset.estado, l.textContent.replace(/\s+/g, ' ').trim()]));
async function pesar(page, brinco, peso) {
  await page.fill('#cur-brinco', brinco);
  await page.press('#cur-brinco', 'Enter');
  await page.fill('#cur-peso', peso);
  await page.press('#cur-peso', 'Enter');
}
async function diagnosticar(page, brinco, resultado) {
  await page.fill('#tr-brinco', brinco);
  await page.press('#tr-brinco', 'Enter');
  await page.fill('#tr-resultado', resultado);
  await page.press('#tr-resultado', 'Enter');
}
const pesagensNoServidor = (s) => s.read({ rota: 't', reads: ['PESAGENS', 'EVENTOS', 'OPERACOES'], tratador: (tx) => tx.repo.vigentes('PESAGENS') }).length;

test('achado 11 (curral): a recusa de um animal fica na linha dele (ERRO, motivo, pendência); a outra volta à fila; tirada a recusada, o envio grava a outra; a recusa geral aparece na área de status', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id0457 = sem.animais.find((x) => x.brinco === '0457').animal_id;
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  await pesar(page, '0457', '412,5');
  await pesar(page, '12', '300');
  // A morte do 0457 entra por outro caminho antes do envio.
  s.registrar({ tipo: 'MORTE', campos: { event_date: '2026-11-10', causa: 'DOENCA' }, animais: [{ animal_id: id0457 }] }, 'morte-0457');
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="ERRO"]');
  await A.esperarServidor(page);
  const ls = await linhas(page);
  const erro = ls.find((l) => l[0] === 'ERRO');
  assert.match(erro[1], /0457/);
  assert.match(await txt(page, '.curral-lista [data-estado="ERRO"]'), /morreu em 10\/11\/2026/);
  assert.equal(ls.filter((l) => l[0] === 'FILA').length, 1, 'o 12 volta à fila');
  assert.match(await txt(page, '[data-curral-status]'), /1 pendência impede o envio/);
  assert.equal(await page.isDisabled('[data-enviar]'), true, 'a pendência trava o envio');
  // Tirar a linha recusada: a outra sai e grava.
  await page.click('.curral-lista [data-estado="ERRO"] button:has-text("Tirar")');
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]');
  await A.esperarServidor(page);
  assert.equal(pesagensNoServidor(s), 1);
  await a.fechar();
});

test('achado 11 (curral, recusa geral): a recusa sem animal (data antes do marco zero) aparece na área de status e as linhas continuam no aparelho', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.fill('#cur-data', '2025-12-01');
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  await A.esperarServidor(page);
  await pesar(page, '12', '300');
  await page.click('[data-enviar]');
  await page.waitForSelector('[data-erro-geral]');
  assert.match(await txt(page, '[data-erro-geral]'), /O servidor recusou o envio: .*Nada foi gravado/);
  assert.deepEqual((await linhas(page)).map((l) => l[0]), ['FILA']);
  await a.fechar();
});

test('achado 12 (curral): dois blocos, a resposta do primeiro se perde e a página é recarregada — nenhuma linha fica presa: o envio seguinte grava as 5 que faltam', async () => {
  const s = A.sistema();
  const bichos = [];
  for (let i = 101; i <= 125; i++) bichos.push(S.bicho({ brinco: String(i), data_nascimento: '2024-01-01', data_nascimento_confianca: 'CONFIRMADA' }));
  s.registrar({ tipo: 'ENTRADA_INICIAL', campos: {}, animais: bichos }, 'semente-25');
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  for (let i = 101; i <= 119; i++) await pesar(page, String(i), '300');
  await page.evaluate(() => { window.__gas.falharTransporte = 1; });
  await pesar(page, '120', '300');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="SEM_SINAL"]').length === 20);
  for (let i = 121; i <= 125; i++) await pesar(page, String(i), '300');
  await page.evaluate(() => { window.__gas.perder = 1; });
  await page.click('[data-enviar]');
  await page.waitForFunction(() => window.__gas.pedidos.filter((p) => p.rota === 'evento.registrar').length === 2);
  await page.evaluate(() => { window.__gas.falharTransporte = 50; });
  await page.clock.fastForward(46000);
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="SEM_SINAL"]').length === 20, null, { timeout: 15000 });
  // As 5 do fim nunca entram num bloco que não saiu: continuam na fila e contam no botão.
  assert.equal((await linhas(page)).filter((l) => l[0] === 'FILA').length, 5);
  assert.match(await txt(page, '[data-enviar]'), /Enviar 25 pesagens/);
  await page.evaluate(() => { window.__gas.falharTransporte = 0; });
  await page.reload();
  await A.esperarTela(page, 'Pesagem no curral');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 20, null, { timeout: 15000 });
  await A.esperarServidor(page);
  assert.match(await txt(page, '[data-enviar]'), /Enviar 5 pesagens/);
  assert.equal(await page.isDisabled('[data-enviar]'), false);
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 25, null, { timeout: 15000 });
  await A.esperarServidor(page);
  assert.equal(pesagensNoServidor(s), 25, 'nada duplicado, nada perdido');
  await a.fechar();
});

test('achado 12 (tronco): dois blocos, a resposta do primeiro se perde e a página é recarregada — as 5 do fim continuam enviáveis e gravam', async () => {
  const s = A.sistema();
  const bichos = [];
  for (let i = 101; i <= 125; i++) bichos.push(S.bicho({ brinco: String(i), data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }));
  s.registrar({ tipo: 'ENTRADA_INICIAL', campos: {}, animais: bichos }, 'semente-25');
  const a = await A.abrir(s, { largura: 360, hash: 'reproducao/tronco', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Diagnóstico no tronco');
  await page.click('button:has-text("Começar")');
  await page.waitForSelector('#tr-brinco');
  for (let i = 101; i <= 119; i++) await diagnosticar(page, String(i), 'v');
  await page.evaluate(() => { window.__gas.falharTransporte = 1; });
  await diagnosticar(page, '120', 'v');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="SEM_SINAL"]').length === 20);
  for (let i = 121; i <= 125; i++) await diagnosticar(page, String(i), 'v');
  await page.evaluate(() => { window.__gas.perder = 1; });
  await page.click('[data-enviar]');
  await page.waitForFunction(() => window.__gas.pedidos.filter((p) => p.rota === 'evento.registrar').length === 2);
  await page.evaluate(() => { window.__gas.falharTransporte = 50; });
  await page.clock.fastForward(46000);
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="SEM_SINAL"]').length === 20, null, { timeout: 15000 });
  assert.equal((await linhas(page)).filter((l) => l[0] === 'FILA').length, 5);
  await page.evaluate(() => { window.__gas.falharTransporte = 0; });
  await page.reload();
  await A.esperarTela(page, 'Diagnóstico no tronco');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 20, null, { timeout: 15000 });
  await A.esperarServidor(page);
  assert.match(await txt(page, '[data-enviar]'), /Enviar 5 diagnósticos/);
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 25, null, { timeout: 15000 });
  await A.esperarServidor(page);
  const regs = s.read({ rota: 't', reads: ['REPRODUCAO', 'EVENTOS', 'OPERACOES'], tratador: (tx) => tx.repo.vigentes('REPRODUCAO') }).length;
  assert.equal(regs, 25, 'nada duplicado, nada perdido');
  await a.fechar();
});

test('achados 11, 12 e 17 (tronco): a recusa de uma fêmea fica na linha dela; corrigida digitando de novo, sai; a linha já gravada não é "substituída"', async () => {
  const s = A.sistema();
  A.semear(s);
  const est = ok(s.api({ rota: 'estacao.salvar', idempotencyKey: 'est', dados: { campos: { nome: 'Estação 26', data_inicio: '2026-06-01', data_fim: '2026-08-31', tipo: 'MONTA_NATURAL' } } }));
  const a = await A.abrir(s, { largura: 360, hash: 'reproducao/tronco', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Diagnóstico no tronco');
  await page.selectOption('#tr-estacao', est.estacao_id);
  await page.click('button:has-text("Começar")');
  await page.waitForSelector('#tr-brinco');
  await diagnosticar(page, '0457', 'p350');
  await diagnosticar(page, '0391', 'v');
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="ERRO"]');
  await A.esperarServidor(page);
  assert.match(await txt(page, '.curral-lista [data-estado="ERRO"]'), /0457.*precisa estar entre 1 e 330/);
  assert.equal((await linhas(page)).filter((l) => l[0] === 'FILA').length, 1);
  assert.equal(await page.isDisabled('[data-enviar]'), true);
  // Corrigir: digitar de novo a mesma fêmea substitui a linha recusada.
  await diagnosticar(page, '0457', 'p35');
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 2, null, { timeout: 15000 });
  await A.esperarServidor(page);
  // A fêmea já gravada: a conferência diz que diagnosticar de novo grava outro diagnóstico.
  await page.fill('#tr-brinco', '0391');
  await page.press('#tr-brinco', 'Enter');
  assert.match(await txt(page, '[data-conferencia-repetido="outro"]'), /grava outro diagnóstico do mesmo dia/);
  await a.fechar();
});

test('achado 11 (tronco, recusa geral): a recusa sem fêmea (data antes do marco zero) aparece na área de status e os diagnósticos continuam no aparelho', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 360, hash: 'reproducao/tronco', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Diagnóstico no tronco');
  await page.fill('#tr-data', '2025-12-01');
  await page.click('button:has-text("Começar")');
  await page.waitForSelector('#tr-brinco');
  await A.esperarServidor(page);
  await diagnosticar(page, '0457', 'v');
  await page.click('[data-enviar]');
  await page.waitForSelector('[data-erro-geral]');
  await A.esperarServidor(page);
  assert.match(await txt(page, '[data-erro-geral]'), /O servidor recusou o envio: .*Nada foi gravado/);
  assert.deepEqual((await linhas(page)).map((l) => l[0]), ['FILA'], 'a linha não some nem fica presa');
  const regs = s.read({ rota: 't', reads: ['REPRODUCAO', 'EVENTOS', 'OPERACOES'], tratador: (tx) => tx.repo.vigentes('REPRODUCAO') }).length;
  assert.equal(regs, 0);
  await a.fechar();
});

test('achado 21: o rascunho do tronco (com diagnóstico sem confirmação) aparece no Início ao lado do curral, com "Continuar"', async () => {
  const s = A.sistema();
  A.semear(s);
  const est = ok(s.api({ rota: 'estacao.salvar', idempotencyKey: 'est', dados: { campos: { nome: 'Estação 26', data_inicio: '2026-06-01', data_fim: '2026-08-31', tipo: 'MONTA_NATURAL' } } }));
  const a = await A.abrir(s, { largura: 360, hash: 'reproducao/tronco', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Diagnóstico no tronco');
  await page.selectOption('#tr-estacao', est.estacao_id);
  await page.click('button:has-text("Começar")');
  await page.waitForSelector('#tr-brinco');
  await diagnosticar(page, '0457', 'p90');
  await page.evaluate(() => { window.__gas.falharTransporte = 1; });
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="SEM_SINAL"]').length === 1);
  await page.evaluate(() => window.Roteador.ir('inicio'));
  await page.waitForSelector('[data-rascunho="TRONCO_DIAGNOSTICO"]', { timeout: 30000 });
  const t = await txt(page, '[data-rascunho="TRONCO_DIAGNOSTICO"]');
  assert.match(t, /Diagnóstico no tronco de 13\/11\/2026 não concluído \(1 fêmea\) · há diagnósticos sem confirmação/);
  assert.equal(await page.getAttribute('[data-rascunho="TRONCO_DIAGNOSTICO"] a', 'data-rota'), 'reproducao/tronco');
  await a.fechar();
});

test('achado 22: o curral com data passada confere brinco, pasto e contador pela posição do servidor naquela data (o morto depois e o transferido depois)', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id0457 = sem.animais.find((x) => x.brinco === '0457').animal_id;
  const id12 = sem.animais.find((x) => x.brinco === '12').animal_id;
  s.registrar({ tipo: 'MORTE', campos: { event_date: '2026-11-12', causa: 'DOENCA' }, animais: [{ animal_id: id0457 }] }, 'morte');
  s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-11-11', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: id12 }] }, 'transf');
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.fill('#cur-data', '2026-11-10');
  await page.selectOption('#cur-pasto', S.PASTOS.A);
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  await page.waitForFunction(() => /posição em 10\/11\/2026/.test((document.querySelector('[data-curral-posicao]') || {}).textContent || ''));
  assert.match(await txt(page, '.curral-contador'), /0 de 3 · faltam 3/);
  await page.fill('#cur-brinco', '0457');
  await page.press('#cur-brinco', 'Enter');
  assert.equal(await page.getAttribute('#cur-conferencia [data-conferencia]', 'data-conferencia'), 'OK');
  assert.doesNotMatch(await txt(page, '#cur-conferencia'), /não encontrado|Não estava no rebanho/);
  await page.fill('#cur-peso', '410');
  await page.press('#cur-peso', 'Enter');
  await page.fill('#cur-brinco', '12');
  await page.press('#cur-brinco', 'Enter');
  assert.doesNotMatch(await txt(page, '#cur-conferencia'), /outro pasto/, 'em 10/11 o 12 estava no Pasto A');
  await page.fill('#cur-peso', '300');
  await page.press('#cur-peso', 'Enter');
  assert.match(await txt(page, '.curral-contador'), /2 de 3 · faltam 1/);
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 2, null, { timeout: 15000 });
  await A.esperarServidor(page);
  await a.fechar();
});

test('achado 5 (tela): a linha gravada do curral mostra o ganho e os dias e não mostra o GMD de um intervalo menor que o mínimo', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id12 = sem.animais.find((x) => x.brinco === '12').animal_id;
  s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-11-03', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id12, peso: 290 }] }, 'p-antes');
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  await pesar(page, '12', '297,2');
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]');
  const t = await txt(page, '.curral-lista [data-estado="GRAVADA"]');
  assert.match(t, /\+7,2 kg em 10 dias/);
  assert.doesNotMatch(t, /kg\/dia/);
  await a.fechar();
});

test('achado 18: o gráfico do ganho de lote tem uma barra por lançamento, também com dois lançamentos no mesmo dia e com o mesmo número de animais', async () => {
  const s = A.sistema();
  const bichos = [];
  for (let i = 1; i <= 10; i++) bichos.push(S.bicho({ brinco: String(200 + i), data_nascimento: '2024-01-01', data_nascimento_confianca: 'CONFIRMADA' }));
  const ids = s.registrar({ tipo: 'ENTRADA_INICIAL', campos: {}, animais: bichos }, 'semente-10').animais.map((x) => x.animal_id);
  const P = (d, lista, chave) => s.registrar({ tipo: 'PESAGEM', campos: { event_date: d, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: lista }, chave);
  P('2026-08-01', ids.map((id) => ({ animal_id: id, peso: 300 })), 'p0');
  P('2026-10-01', ids.slice(0, 5).map((id) => ({ animal_id: id, peso: 330 })), 'p1');
  P('2026-10-01', ids.slice(5).map((id) => ({ animal_id: id, peso: 360 })), 'p2');
  const a = await A.abrir(s, { largura: 1280, hash: 'pesagens', relogio: RELOGIO });
  const { page } = a;
  await page.waitForSelector('[data-grafico-id="gmd-lote"]');
  await page.fill('#pd-de', '2026-07-01');
  await page.click('form[aria-label="Filtrar o desempenho"] button[type=submit]');
  await A.esperarServidor(page);
  await page.waitForFunction(() => document.querySelectorAll('[data-grafico-id="gmd-lote"] svg rect[data-valor]').length === 2, null, { timeout: 15000 });
  const barras = await page.$$eval('[data-grafico-id="gmd-lote"] svg rect[data-valor]', (rs) => rs.map((r) => r.dataset.valor).sort());
  assert.deepEqual(barras, ['0.492', '0.984']);
  const tab = await page.$$eval('[data-grafico-id="gmd-lote"] details table tbody tr', (trs) => trs.map((t) => t.textContent.replace(/\s+/g, ' ').trim()));
  assert.equal(tab.filter((t) => /lançamento [12] de 2, 5 animais/.test(t)).length, 2, JSON.stringify(tab));
  await a.fechar();
});

test('achados 19 e 28: o gráfico por categoria tem uma linha por categoria, com "(parcial)" no valor; os diagnosticados vêm do servidor', async () => {
  const s = A.sistema();
  const ids = s.registrar(S.entradaInicial([1, 2, 3, 4, 5, 6].map((i) => S.bicho({ brinco: 'V' + i, data_nascimento: '2021-03-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }))), 'rebanho').animais.map((x) => x.animal_id);
  const est = ok(s.api({ rota: 'estacao.salvar', idempotencyKey: 'est', dados: { campos: { nome: 'Estação 26', data_inicio: '2026-06-01', data_fim: '2026-08-31', tipo: 'MONTA_NATURAL' } } }));
  s.registrar({ tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-06-01', estacao_id: est.estacao_id }, animais: ids.map((animal_id) => ({ animal_id })) }, 'exp');
  s.registrar({ tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-10-01', estacao_id: est.estacao_id, metodo: 'PALPACAO' }, animais: ids.map((animal_id, i) => (i < 4 ? { animal_id, resultado: 'POSITIVO', idade_gestacional_dias: 100 } : { animal_id, resultado: 'NEGATIVO' })) }, 'dg');
  const a = await A.abrir(s, { largura: 360, hash: 'reproducao/indicadores', relogio: RELOGIO });
  const { page } = a;
  await page.waitForSelector('[data-grafico-id="taxas-categoria"] svg');
  const linhasTab = await page.$$eval('[data-grafico-id="taxas-categoria"] details table tbody tr', (trs) => trs.map((t) => [...t.children].map((c) => c.textContent.trim())));
  assert.equal(linhasTab.length, 1, JSON.stringify(linhasTab));
  assert.equal(linhasTab[0][0], 'Vaca');
  assert.match(linhasTab[0][1], /66,7%/);
  assert.match(linhasTab[0][2], /0,0% \(parcial\)/);
  const semDado = await page.$$eval('[data-grafico-id="taxas-categoria"] svg text', (ts) => ts.filter((t) => t.textContent === '— sem dado').length);
  assert.equal(semDado, 0);
  assert.match(await txt(page, '#conteudo'), /Diagnosticadas6 de 6|Diagnosticadas 6 de 6/);
  await a.fechar();
});

test('achado 20: a lista de aplicações mostra o produto do cadastro, o nome livre e o diagnóstico', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const vac = ok(s.api({ rota: 'produto.salvar', idempotencyKey: 'p1', dados: { campos: { nome: 'Vacina Aftosa', categoria: 'VACINA', unidade: 'dose', custo_unitario: 1.85 } } })).product_id;
  s.registrar({ tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-11-10', produto_id: vac, modo_dose: 'POR_CABECA', dose_referencia: 2 }, animais: sem.animais.slice(0, 2).map((x) => ({ animal_id: x.animal_id })) }, 'v1');
  s.registrar({ tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: { event_date: '2026-11-11', nome_produto: 'Ivermectina genérica', unidade_dose: 'mL', modo_dose: 'POR_CABECA', dose_referencia: 5 }, animais: sem.animais.slice(0, 1).map((x) => ({ animal_id: x.animal_id })) }, 'v2');
  s.registrar({ tipo: 'SANIDADE', subtipo: 'DOENCA', campos: { event_date: '2026-11-12', diagnostico: 'Tristeza parasitária' }, animais: sem.animais.slice(1, 2).map((x) => ({ animal_id: x.animal_id })) }, 'v3');
  const a = await A.abrir(s, { largura: 1280, hash: 'sanidade/aplicacoes', relogio: RELOGIO });
  const { page } = a;
  await page.waitForSelector('#aplicacoes tbody tr, [data-aplicacoes] table tbody tr');
  const t = await txt(page, '#conteudo');
  assert.match(t, /Vacina Aftosa/);
  assert.match(t, /Ivermectina genérica/);
  assert.match(t, /Tristeza parasitária/);
  await a.fechar();
});

test('achado 27: a aba Reprodução da ficha, com outra versão do app no servidor, oferece "Recarregar a página" (não "Tentar de novo" em laço)', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = sem.animais.find((x) => x.brinco === '0457').animal_id;
  const a = await A.abrir(s, { largura: 360, hash: 'animal/' + id + '/reproducao', relogio: RELOGIO, trocarVersao: 'versao-antiga' });
  const { page } = a;
  await page.waitForSelector('[data-bloco-reproducao] .estado', { timeout: 15000 });
  await A.esperarServidor(page);
  const bloco = page.locator('[data-bloco-reproducao]');
  assert.equal(await bloco.locator('text=Recarregar a página').count(), 1);
  assert.equal(await bloco.locator('button:has-text("Tentar de novo")').count(), 0);
  await a.fechar();
});
