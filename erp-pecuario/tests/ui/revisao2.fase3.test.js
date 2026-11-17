'use strict';
/**
 * Revisão da Fase 3, rodada 2 (conserto), lente INTERFACE E REGRAS (nível 3, Playwright, backend real do harness): o curral e o
 * tronco com data passada acham o animal pelo brinco daquele dia (o número trocado e reaproveitado depois é de outro animal),
 * e "Corrigir o brinco" confere pela mesma posição; o animal sem brinco é achado pelo código interno e por "Pesar este";
 * "Desfazer o último" num bloco com aviso devolve as outras linhas à fila (nenhuma fica com aviso órfão) e diz o que de fato
 * aconteceu; o aviso geral do lançamento é um "Está certo" só; o ganho contra uma pesagem estimada vai rotulado; as telas do
 * curral e do tronco vêm com a Início aberta e abrem depois sem sinal; a tabela dos indicadores por categoria diz "(parcial)".
 * Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const RELOGIO = Date.parse('2026-11-13T14:00:00Z');
const txt = async (page, sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
const linhas = (page, lista) => page.$$eval((lista || '.curral-lista') + ' [data-linha]', (ls) => ls.map((l) => [l.dataset.estado, l.textContent.replace(/\s+/g, ' ').trim()]));
async function pesar(page, brinco, peso) {
  await page.fill('#cur-brinco', brinco);
  await A.enter(page, '#cur-brinco');
  await page.fill('#cur-peso', peso);
  await A.enter(page, '#cur-peso');
}
async function diagnosticar(page, brinco, resultado) {
  await page.fill('#tr-brinco', brinco);
  await A.enter(page, '#tr-brinco');
  await page.fill('#tr-resultado', resultado);
  await A.enter(page, '#tr-resultado');
}
const doServidor = (s, aba) => s.read({ rota: 't', reads: [aba, 'EVENTOS', 'OPERACOES'], tratador: (tx) => tx.repo.vigentes(aba) });
/** O rebanho de exemplo com o 0457 da vaca A trocado em 11/11 (1457) e o 0457 reaproveitado na vaca B (0391) em 12/11. */
function brincosTrocados() {
  const s = A.sistema({ config: { brinco_permite_reuso: 'S' } });
  const sem = A.semear(s);
  const vacaA = sem.animais.find((x) => x.brinco === '0457').animal_id;
  const vacaB = sem.animais.find((x) => x.brinco === '0391').animal_id;
  s.registrar({ tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-11-11', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: vacaA, codigo: '1457', motivo: 'PERDA' }] }, 'troca-a');
  s.registrar({ tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-11-12', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: vacaB, codigo: '0457', motivo: 'RENUMERACAO' }] }, 'troca-b');
  return { s, sem, vacaA, vacaB };
}

test('achados 7, 16 e 22 (curral): com data passada, o 0457 digitado é a vaca que tinha o 0457 NAQUELE dia (não a de hoje); o número que ninguém tinha no dia não vai para a dona de hoje; "Corrigir o brinco" usa a mesma posição', async () => {
  const { s, vacaA } = brincosTrocados();
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.fill('#cur-data', '2026-11-10');
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  await page.waitForFunction(() => /posição em 10\/11\/2026/.test((document.querySelector('[data-curral-posicao]') || {}).textContent || ''));
  await page.fill('#cur-brinco', '0457');
  await A.enter(page, '#cur-brinco');
  assert.equal(await page.getAttribute('#cur-conferencia [data-conferencia]', 'data-conferencia'), 'OK');
  assert.match(await txt(page, '#cur-conferencia'), /0457 em 10\/11\/2026 \(hoje 1457\)/, 'a vaca A, que tinha o 0457 naquele dia');
  assert.doesNotMatch(await txt(page, '#cur-conferencia'), /A-000002/);
  await page.fill('#cur-peso', '410');
  await A.enter(page, '#cur-peso');
  // O 1457 não era de ninguém em 10/11 (a vaca A ainda tinha o 0457): pendência, e nunca a vaca A por engano.
  await page.fill('#cur-brinco', '1457');
  await A.enter(page, '#cur-brinco');
  assert.equal(await page.getAttribute('#cur-conferencia [data-conferencia]', 'data-conferencia'), 'NAO_ENCONTRADO');
  assert.match(await txt(page, '#cur-conferencia'), /1457: em 10\/11\/2026 nenhum animal do rebanho tinha este brinco \(hoje ele é de 1457, que naquele dia tinha o 0457\)/);
  await page.fill('#cur-peso', '300');
  await A.enter(page, '#cur-peso');
  // "Corrigir o brinco" da pendência, para o 0391 (a vaca B naquele dia): aceita pela posição da data.
  await page.click('.curral-lista [data-estado="NAO_ENCONTRADO"] button:has-text("Corrigir o brinco")');
  await page.fill('#cur-corrige-brinco', '0391');
  await page.click('[role="dialog"] button:has-text("Corrigir")');
  await page.waitForFunction(() => !document.querySelector('.curral-lista [data-estado="NAO_ENCONTRADO"]'));
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 2, null, { timeout: 15000 });
  await A.esperarServidor(page);
  const pes = doServidor(s, 'PESAGENS').filter((p) => p.data_pesagem === '2026-11-10');
  assert.equal(pes.find((p) => p.peso_kg === 410).animal_id, vacaA, 'os 410 kg de 10/11 na vaca A');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achados 7, 16 e 22 (tronco): com data passada, a fêmea vem da posição do servidor naquele dia — a que morreu depois é achada; o 0457 é a vaca que o tinha no dia; a situação de hoje não aparece', async () => {
  const { s, vacaA } = brincosTrocados();
  const sem12 = s.tabela('ANIMAIS').find((x) => x.brinco === '0391' || x.brinco === '0457');
  assert.ok(sem12);
  // A vaca A morre em 12/11: no diagnóstico de 10/11 ela ainda estava no rebanho.
  s.registrar({ tipo: 'MORTE', campos: { event_date: '2026-11-12', causa: 'DOENCA' }, animais: [{ animal_id: vacaA }] }, 'morte-a');
  const a = await A.abrir(s, { largura: 360, hash: 'reproducao/tronco', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Diagnóstico no tronco');
  await page.fill('#tr-data', '2026-11-10');
  await page.click('button:has-text("Começar")');
  await page.waitForSelector('#tr-brinco');
  await page.waitForSelector('[data-tronco-posicao]');
  await page.fill('#tr-brinco', '0457');
  await A.enter(page, '#tr-brinco');
  assert.equal(await page.getAttribute('#tr-conferencia [data-conferencia]', 'data-conferencia'), 'OK');
  assert.match(await txt(page, '#tr-conferencia'), /0457 em 10\/11\/2026 \(hoje 1457\)/);
  await page.fill('#tr-resultado', 'p90');
  await A.enter(page, '#tr-resultado');
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
  await A.esperarServidor(page);
  const dg = doServidor(s, 'REPRODUCAO').filter((r) => r.tipo_evento === 'DIAGNOSTICO_GESTACAO');
  assert.deepEqual(dg.map((r) => [r.animal_id, r.data, r.resultado]), [[vacaA, '2026-11-10', 'POSITIVO']], 'na vaca A, que morreu depois');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 17: o animal sem brinco é achado pelo código interno (A-000004 e 000004) e pelo "Pesar este" da lista dos que faltam; o contador chega a zero', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.selectOption('#cur-pasto', S.PASTOS.A);
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  await page.fill('#cur-brinco', '000004');
  await A.enter(page, '#cur-brinco');
  assert.equal(await page.getAttribute('#cur-conferencia [data-conferencia]', 'data-conferencia'), 'OK');
  assert.match(await txt(page, '#cur-conferencia'), /A-000004/);
  await page.fill('#cur-brinco', 'A-000004');
  await A.enter(page, '#cur-brinco');
  assert.equal(await page.getAttribute('#cur-conferencia [data-conferencia]', 'data-conferencia'), 'OK');
  await page.fill('#cur-brinco', '');
  await pesar(page, '0457', '412');
  await pesar(page, '12', '300');
  assert.match(await txt(page, '.curral-contador'), /2 de 3 · faltam 1/);
  await page.click('[data-ver-faltam]');
  await page.click('[data-faltam] button:has-text("Pesar este")');
  assert.equal(await page.getAttribute('#cur-conferencia [data-conferencia]', 'data-conferencia'), 'OK');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'cur-peso');
  await page.fill('#cur-peso', '180');
  await A.enter(page, '#cur-peso');
  assert.match(await txt(page, '.curral-contador'), /3 de 3 · faltam 0/);
  assert.equal((await linhas(page)).filter((l) => l[0] === 'NAO_ENCONTRADO').length, 0);
  await page.click('[data-enviar]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 3, null, { timeout: 15000 });
  await A.esperarServidor(page);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achados 15 e 23 (curral): "Desfazer o último" num bloco com aviso devolve as outras linhas à fila e nenhuma fica com aviso órfão; com nada a desfazer além da gravada, a mensagem diz que foi gravada', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id0457 = sem.animais.find((x) => x.brinco === '0457').animal_id;
  s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-09-03', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id0457, peso: 441 }] }, 'p-antes');
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  await pesar(page, '0457', '45');
  await pesar(page, '0391', '400');
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="AVISO"]');
  await A.esperarServidor(page);
  // O 0391 (o último) sai: o bloco é desfeito e o 0457 volta à fila (sai de novo e pede o aviso outra vez).
  await page.click('[data-desfazer]');
  const ls = await linhas(page);
  assert.deepEqual(ls.map((l) => l[0]), ['FILA'], JSON.stringify(ls));
  assert.match(ls[0][1], /0457/);
  assert.equal(await page.isDisabled('[data-enviar]'), false, 'o envio continua possível');
  assert.match(await txt(page, '[data-curral-status]'), /1 na fila deste aparelho/);
  // Enviada de novo, o aviso volta na linha, e "Está certo" grava.
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="AVISO"]');
  await page.click('.curral-lista [data-estado="AVISO"] button:has-text("Está certo")');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
  await A.esperarServidor(page);
  await page.click('[data-desfazer]');
  await page.waitForFunction(() => /já foi gravada: corrija pelo lançamento gravado/.test(document.getElementById('avisos').textContent));
  assert.equal(doServidor(s, 'PESAGENS').filter((p) => p.animal_id === id0457).length, 2);
  await a.fechar();
});

test('achado 25 (curral): o aviso geral de duplicidade do lançamento inteiro é um "Está certo" só, na área de status; as linhas não pedem um toque cada', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const ids = ['0457', '0391', '12'].map((b) => sem.animais.find((x) => x.brinco === b).animal_id);
  s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-11-13', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: ids.map((animal_id, i) => ({ animal_id, peso: 400 + i })) }, 'p-hoje');
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  await pesar(page, '0457', '401');
  await pesar(page, '0391', '402');
  await pesar(page, '12', '403');
  await page.click('[data-enviar]');
  await page.waitForSelector('[data-aceitar-geral]');
  await A.esperarServidor(page);
  assert.match(await txt(page, '[data-curral-status]'), /Já existe a pesagem de 13\/11\/2026/);
  assert.equal(await page.locator('.curral-lista button:has-text("Está certo")').count(), 0, 'nenhum "Está certo" por linha');
  assert.match(await txt(page, '[data-curral-status]'), /3 para conferir/);
  await page.click('[data-aceitar-geral]');
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 3, null, { timeout: 15000 });
  await A.esperarServidor(page);
  assert.equal(a.pedidos('evento.registrar').length, 2, 'um envio com o aviso e um com o aceite');
  await a.fechar();
});

test('achado 20: a linha gravada do curral rotula o ganho contra uma estimativa visual e mostra o porquê do GMD vazio, como a ficha', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id0457 = sem.animais.find((x) => x.brinco === '0457').animal_id;
  s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-10-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'ESTIMATIVA_VISUAL' }, animais: [{ animal_id: id0457, peso: 380 }] }, 'p-estimada');
  const a = await A.abrir(s, { largura: 360, hash: 'pesagens/curral', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pesagem no curral');
  await page.click('button:has-text("Começar a pesar")');
  await page.waitForSelector('#cur-brinco');
  await pesar(page, '0457', '412,5');
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
  const t = await txt(page, '.curral-lista [data-estado="GRAVADA"]');
  assert.match(t, /\+32,5 kg em 43 dias contra peso estimado/);
  assert.doesNotMatch(t, /kg\/dia/);
  assert.match(t, /As pesagens anteriores são estimadas/);
  await a.fechar();
});

test('achados 15 e 23 (tronco) e 25: "Desfazer o último" no bloco com aviso devolve a outra à fila; o aviso geral é um "Está certo" só', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const ids = ['0457', '0391'].map((b) => sem.animais.find((x) => x.brinco === b).animal_id);
  s.registrar({ tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-11-13', metodo: 'PALPACAO' }, animais: ids.map((animal_id) => ({ animal_id, resultado: 'NEGATIVO' })) }, 'dg-hoje');
  const a = await A.abrir(s, { largura: 360, hash: 'reproducao/tronco', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Diagnóstico no tronco');
  await page.click('button:has-text("Começar")');
  await page.waitForSelector('#tr-brinco');
  await diagnosticar(page, '0457', 'v');
  await diagnosticar(page, '0391', 'v');
  await page.click('[data-enviar]');
  await page.waitForSelector('[data-aceitar-geral]');
  await A.esperarServidor(page);
  assert.equal(await page.locator('.curral-lista button:has-text("Está certo")').count(), 0, 'o aviso é do lançamento inteiro');
  // Desfazer o último: a outra volta à fila; nada fica com aviso órfão.
  await page.click('[data-desfazer]');
  const ls = await linhas(page);
  assert.deepEqual(ls.map((l) => l[0]), ['FILA'], JSON.stringify(ls));
  assert.equal(await page.isDisabled('[data-enviar]'), false);
  assert.match(await txt(page, '[data-tronco-status]'), /1 na fila deste aparelho/);
  await a.fechar();
});

test('achado 18: com a Início aberta (com sinal), as telas do curral e do tronco vêm em segundo plano; sem sinal depois, "Pesar no curral" e o tronco abrem; sem sinal desde a Início, ela avisa antes de ir ao curral', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 360, hash: 'inicio', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Início');
  await page.waitForFunction(() => window.Modulos.carregado('Weights') && window.Modulos.carregado('Reproduction'), null, { timeout: 15000 });
  await A.esperarServidor(page);
  await page.evaluate(() => { window.__gas.falharTransporte = 50; });
  await A.ir(page, 'pesagens/curral', 'Pesagem no curral');
  await A.ir(page, 'reproducao/tronco', 'Diagnóstico no tronco');
  await page.evaluate(() => { window.__gas.falharTransporte = 0; });
  await a.fechar();
  // A Início abriu, mas as telas não vieram (aqui, outra versão do app no servidor): a Início avisa antes de ir ao curral.
  const b = await A.abrir(s, { largura: 360, hash: 'inicio', relogio: RELOGIO, trocarVersao: '0.0.1' });
  await A.esperarTela(b.page, 'Início');
  await b.page.waitForSelector('[data-pre-carga="Weights"]', { timeout: 15000 });
  assert.match(await txt(b.page, '[data-pre-carga="Weights"]'), /A tela Pesagens ainda não veio para este aparelho .*abra-a uma vez com sinal antes de ir ao curral/);
  assert.equal(await b.page.locator('[data-pre-carga="Reproduction"]').count(), 1);
  assert.deepEqual(b.estado.erros, [], 'nenhum erro no console');
  await b.fechar();
});

test('achado 24: a tabela dos indicadores por categoria diz "(parcial)" na parição, na natalidade e na desmama, como o gráfico', async () => {
  const s = A.sistema();
  const bichos = [];
  for (let i = 0; i < 6; i++) bichos.push(S.bicho({ brinco: 'V' + i, data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }));
  bichos.push(S.bicho({ brinco: 'T1', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA' }));
  const ent = s.registrar(S.entradaInicial(bichos), 'rebanho');
  const id = Object.fromEntries(ent.animais.map((x) => [x.brinco, x.animal_id]));
  const est = s.api({ rota: 'estacao.salvar', idempotencyKey: 'est', dados: { campos: { nome: 'E26', data_inicio: '2026-01-10', data_fim: '2026-03-31', tipo: 'MONTA_NATURAL' } } }).data;
  s.registrar({ tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-01-10', estacao_id: est.estacao_id }, animais: ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'T1'].map((b) => ({ animal_id: id[b] })) }, 'exp');
  s.registrar({ tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-10-01', estacao_id: est.estacao_id }, animais: ['V0', 'V1', 'V2', 'V3', 'V4', 'V5'].map((b, i) => (i < 4 ? { animal_id: id[b], resultado: 'POSITIVO', idade_gestacional_dias: 200 } : { animal_id: id[b], resultado: 'NEGATIVO' })) }, 'dg');
  const a = await A.abrir(s, { largura: 1280, hash: 'reproducao/indicadores', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Reprodução');
  await page.waitForSelector('[data-secao="estacao-categorias"] [data-grafico-id="taxas-categoria"] svg', { timeout: 15000 });
  // A tabela da seção (seis colunas: categoria, expostas e as quatro taxas), não a do gráfico.
  const tab = await page.$$eval('[data-secao="estacao-categorias"] table tbody tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim())).filter((l) => l.length === 6));
  assert.equal(tab.length, 1, JSON.stringify(tab));
  assert.deepEqual(tab[0].slice(0, 3), ['Vaca', '6', '66,7%']);
  assert.deepEqual(tab[0].slice(3), ['0,0% (parcial)', '0,0% (parcial)', '0,0% (parcial)'], 'parição, natalidade e desmama rotuladas, como o gráfico');
  await a.fechar();
});

test('achado 9: a revisão da entrada de estoque de um produto do cadastro sem custo por unidade avisa que o que foi pago nunca vira custo e manda preencher o cadastro', async () => {
  const s = A.sistema();
  A.semear(s);
  const r = s.api({ rota: 'produto.salvar', idempotencyKey: 'p', dados: { campos: { nome: 'Vacina sem custo', categoria: 'VACINA', unidade: 'dose', controla_estoque: true } } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const a = await A.abrir(s, { largura: 360, hash: 'sanidade/produtos', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Sanidade');
  await page.click('button[aria-label="Entrada de Vacina sem custo no estoque"]');
  await A.esperarTela(page, 'Estoque de insumos');
  await page.fill('[data-campo="quantidade"] input', '100');
  await page.fill('[data-campo="valor"] input', '300,00');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector('[role=dialog] [data-acao-principal]:not([disabled])');
  const rev = await txt(page, '[role=dialog]');
  assert.match(rev, /Custo do insumo\s*sem custo: o produto não tem custo por unidade no cadastro, e o que foi pago na compra nunca vira custo dos animais\. Preencha o custo por unidade no cadastro do produto\./);
  await a.fechar();
});
