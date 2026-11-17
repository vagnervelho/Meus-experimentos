'use strict';
/**
 * Regressões fixas do teste aleatório do curral e do tronco (`tests/ui/curral.fuzz.test.js`; etapa 3 do conserto da Fase 3
 * pela garantia): cada defeito que o teste achou, na sequência mínima, pela tela de verdade com o backend real e a rede
 * decidida no Node (`tests/ui/apoio-curral.js`). Cada um falha com o `src/` de antes da etapa.
 *  1. "Mudar data" com linhas na fila: o animal continuava o da data de antes (o número trocado e reaproveitado ia para outro
 *     animal); agora cada linha é conferida de novo pelo servidor na data nova (curral e tronco).
 *  2. A falha interna do servidor no reenvio de um bloco já gravado virava "recusada" e soltava a chave: corrigida, a linha
 *     gravaria duas vezes; agora o bloco fica com a chave e a mensagem do servidor, e o reenvio grava uma vez.
 *  3. O aviso aceito enquanto outro bloco estava no ar ficava parado na fila com o "Enviar" desligado; agora sai no mesmo envio.
 *  4. Sair e voltar com o envio no ar: a tela nova não via a resposta (e conferia o mesmo bloco por outro caminho); agora o envio
 *     redesenha a tela aberta.
 *  5. Tronco: a recusa do servidor à conferência de um bloco ia ao console como erro e não aparecia; agora aparece na tela.
 *  6. A linha pendente barrada por outra linha do mesmo animal ficava pendente para sempre, dizendo "tire um dos dois" depois de a
 *     outra sair; agora ela continua esperando e entra na fila quando a outra é tirada.
 * Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');
const { HOJE, RELOGIO, MSG_FALHA_INTERNA, T, montarSistema, novaRede, lerTela, esperarMs } = require('./apoio-curral');

test.after(() => A.fecharBrowser());

async function abrir(tela) {
  const sis = montarSistema();
  const rede = novaRede(sis.s);
  const a = await A.abrir(sis.s, { largura: 360, hash: T[tela].hash, relogio: RELOGIO, servidor: rede.servidor });
  await A.esperarTela(a.page, T[tela].titulo);
  return Object.assign({ sis, rede, tela, cfg: T[tela] }, a);
}
/** Espera a tela parar: nada no ar além do que está segurado de propósito, e nenhuma conferência de brinco pendente. */
async function parar(x) {
  for (let i = 0, quietas = 0; i < 2000; i++) {
    const st = await x.page.evaluate((sel) => ({ em: window.__gas.emCurso, conf: /Conferindo/.test((document.querySelector(sel) || {}).textContent || '') }), x.cfg.conferencia);
    if (st.em <= x.rede.segurados.length && !st.conf) { quietas += 1; if (quietas >= 3) return; } else quietas = 0;
    await esperarMs(15);
  }
  throw new Error('a tela não parou');
}
async function comecar(x, data) {
  if (data) await x.page.fill(x.tela === 'curral' ? '#cur-data' : '#tr-data', data);
  await x.page.click('button:has-text("' + x.cfg.comecar + '")');
  await x.page.waitForSelector(x.cfg.brinco);
}
async function lancar(x, brinco, valor) {
  await x.page.fill(x.cfg.brinco, brinco);
  await x.page.press(x.cfg.brinco, 'Enter');
  await x.page.fill(x.cfg.valor, valor);
  await x.page.press(x.cfg.valor, 'Enter');
  await parar(x);
}
const estados = async (x) => (await lerTela(x.page, x.tela)).linhas.map((l) => l.estado);
const linhasDoBanco = (x) => x.sis.s.tabela(x.cfg.aba).filter((r) => x.sis.s.tabela('EVENTOS').some((e) => e.event_id === r.event_id && String(e.idempotency_key || '').indexOf(x.cfg.prefixo) === 0));

for (const tela of ['curral', 'tronco']) {
  test('regressão 1 (' + tela + '): "Mudar data" com a linha na fila confere o brinco de novo na data nova — o 0457 de hoje é a vaca B, o de 04/11 é a vaca A', async () => {
    const x = await abrir(tela);
    const { page, sis } = x;
    await comecar(x);
    await lancar(x, '0457', tela === 'curral' ? '300' : 'v');
    assert.equal((await lerTela(page, tela)).c.linhas[0].animal_id, sis.ids.vacaB, 'hoje o 0457 é da vaca B');
    await page.click(x.cfg.mudar);
    await page.waitForSelector(x.cfg.inicio);
    await comecar(x, '2026-11-04');
    await parar(x);
    const v = await lerTela(page, tela);
    assert.equal(v.c.linhas[0].animal_id, sis.ids.vacaA, 'em 04/11 o 0457 era da vaca A');
    assert.equal(v.c.linhas[0].estado, 'FILA');
    await page.click('[data-enviar]');
    await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
    const banco = linhasDoBanco(x);
    assert.deepEqual(banco.map((r) => r.animal_id), [sis.ids.vacaA], 'gravado na vaca A, nunca na B');
    assert.equal(sis.s.tabela('EVENTOS').find((e) => e.event_id === banco[0].event_id).event_date, '2026-11-04');
    assert.equal(sis.s.integridade().erros, 0);
    assert.deepEqual(x.estado.erros, []);
    await x.fechar();
  });
}

test('regressão 2 (curral): a falha interna do servidor no reenvio de um bloco já gravado não vira "recusada" — o bloco fica com a chave e a mensagem do servidor, e o reenvio grava uma vez só', async () => {
  const x = await abrir('curral');
  const { page, rede, sis } = x;
  await comecar(x);
  await lancar(x, '0520', '430');
  // O servidor grava e a resposta se perde; a conferência (operacao.status) também cai: o bloco fica sem confirmação.
  rede.falhas.push({ classe: 'registrar', tipo: 'perdeDepois' }, { classe: 'status', tipo: 'transporte' });
  await page.click('[data-enviar]');
  await parar(x);
  await page.clock.fastForward(46000);
  await parar(x);
  assert.deepEqual(await estados(x), ['SEM_SINAL']);
  assert.equal(linhasDoBanco(x).length, 1, 'o servidor gravou');
  // O reenvio (mesma chave) recebe uma falha interna: ela não prova que nada foi gravado.
  rede.falhas.push({ classe: 'registrar', tipo: 'interna' });
  await page.click('[data-enviar]');
  await parar(x);
  const v = await lerTela(page, 'curral');
  assert.deepEqual(v.linhas.map((l) => l.estado), ['SEM_SINAL'], 'nem "recusada" nem pendência: pode estar gravada');
  assert.deepEqual(v.linhas[0].botoes, [], 'sem "Corrigir o peso" nem "Tirar" (corrigida, sairia com outra chave)');
  assert.match(v.status, new RegExp('O servidor recusou o envio de 1 pesagem: ' + MSG_FALHA_INTERNA.replace(/[.()]/g, '\\$&') + ' Elas continuam guardadas com a mesma chave'));
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
  const regs = rede.log.filter((r) => r.rota === 'evento.registrar');
  assert.equal(new Set(regs.map((r) => r.chave)).size, 1, 'todas as tentativas com a mesma chave');
  assert.equal(linhasDoBanco(x).length, 1, 'gravada uma vez');
  assert.equal(sis.s.integridade().erros, 0);
  assert.deepEqual(x.estado.erros, []);
  await x.fechar();
});

test('regressão 3 (curral): o "Está certo" dado enquanto outro bloco está no ar sai no mesmo envio — a linha não fica na fila com o "Enviar" desligado', async () => {
  const x = await abrir('curral');
  const { page, rede, sis } = x;
  await comecar(x);
  // 0520 pesou 420 kg em 03/09: 45 kg hoje pede confirmação (PESO_IMPLAUSIVEL).
  await lancar(x, '0520', '45');
  await page.click('[data-enviar]');
  await parar(x);
  assert.deepEqual(await estados(x), ['AVISO']);
  // Outra linha sai num bloco novo, e a resposta fica no ar.
  await lancar(x, '0611', '455');
  rede.falhas.push({ classe: 'registrar', tipo: 'segurar' });
  await page.click('[data-enviar]');
  await parar(x);
  assert.equal(rede.segurados.length, 1);
  // Com o envio no ar, o operador confirma o aviso; depois a resposta chega.
  await page.click('.curral-lista [data-estado="AVISO"] button:has-text("Está certo")');
  rede.soltar();
  await parar(x);
  await page.waitForFunction(() => document.querySelectorAll('.curral-lista [data-estado="GRAVADA"]').length === 2, null, { timeout: 15000 });
  const banco = linhasDoBanco(x);
  assert.deepEqual(banco.map((r) => r.peso_kg).sort((p, q) => p - q), [45, 455]);
  assert.equal(sis.s.integridade().erros, 0);
  assert.deepEqual(x.estado.erros, []);
  await x.fechar();
});

test('regressão 4 (curral): sair e voltar com o envio no ar — a resposta que chega depois aparece na tela nova, e o mesmo bloco não é conferido por outro caminho ao mesmo tempo', async () => {
  const x = await abrir('curral');
  const { page, rede } = x;
  await comecar(x);
  await lancar(x, '0520', '430');
  // O pedido só chega ao servidor quando for solto.
  rede.falhas.push({ classe: 'registrar', tipo: 'segurarAntes' });
  await page.click('[data-enviar]');
  await parar(x);
  await A.ir(page, 'pesagens', 'Pesagens');
  await A.ir(page, 'pesagens/curral', 'Pesagem no curral');
  await parar(x);
  assert.equal(rede.log.filter((r) => r.rota === 'operacao.status').length, 0, 'o envio no ar termina sozinho: a tela nova não confere o bloco por outro caminho');
  rede.soltar();
  await parar(x);
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
  const v = await lerTela(page, 'curral');
  assert.deepEqual(v.c.linhas.map((l) => l.estado), ['GRAVADA']);
  assert.match(v.status, /1 gravada/);
  assert.equal(linhasDoBanco(x).length, 1);
  assert.deepEqual(x.estado.erros, []);
  await x.fechar();
});

test('regressão 5 (tronco): a recusa do servidor à conferência do bloco sem confirmação aparece na tela (nunca só no console) e o bloco segue com a chave', async () => {
  const x = await abrir('tronco');
  const { page, rede } = x;
  await comecar(x);
  await lancar(x, '0520', 'p');
  // O pedido se perde antes de chegar; a conferência depois do prazo é recusada pelo servidor (falha interna).
  rede.falhas.push({ classe: 'registrar', tipo: 'perdeAntes' }, { classe: 'status', tipo: 'interna' });
  await page.click('[data-enviar]');
  await parar(x);
  await page.clock.fastForward(46000);
  await parar(x);
  // Recarregar: a conferência do bloco na volta também é recusada.
  rede.falhas.push({ classe: 'status', tipo: 'interna' });
  await page.reload();
  await A.esperarTela(page, 'Diagnóstico no tronco');
  await parar(x);
  const v = await lerTela(page, 'tronco');
  assert.deepEqual(v.linhas.map((l) => l.estado), ['SEM_SINAL']);
  assert.match(v.status, new RegExp('O servidor recusou o envio de 1 diagnóstico: ' + MSG_FALHA_INTERNA.replace(/[.()]/g, '\\$&')));
  assert.deepEqual(x.estado.erros, [], 'nada no console');
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
  assert.equal(linhasDoBanco(x).length, 1);
  assert.equal(HOJE, x.sis.s.tabela('EVENTOS').find((e) => String(e.idempotency_key || '').indexOf('tronco:') === 0).event_date);
  await x.fechar();
});

test('regressão 6 (tronco): a linha pendente barrada por outra do mesmo animal entra na fila quando a outra é tirada — nunca fica dizendo "tire um dos dois" sozinha', async () => {
  const x = await abrir('tronco');
  const { page, rede, sis } = x;
  await comecar(x);
  // Sem sinal na conferência: a primeira 0520 fica pendente.
  rede.falhas.push({ classe: 'resolver', tipo: 'transporte' });
  await lancar(x, '0520', 'p');
  assert.deepEqual(await estados(x), ['NAO_ENCONTRADO']);
  // Com sinal, a mesma vaca de novo: vai para a fila; a pendente, conferida agora, é barrada pela outra linha.
  await lancar(x, '0520', 'v');
  let v = await lerTela(page, 'tronco');
  assert.deepEqual(v.c.linhas.map((l) => [l.estado, l.animal_id]), [['NAO_ENCONTRADO', null], ['FILA', sis.ids.v520]]);
  assert.match(v.linhas[1].texto, /já tem outro diagnóstico nesta sessão: tire um dos dois/);
  // O veterinário tira a segunda: a primeira, que só esperava por ela, entra na fila sozinha.
  await page.click('[data-linha="' + v.c.linhas[1].uid + '"] button:has-text("Tirar")');
  await parar(x);
  v = await lerTela(page, 'tronco');
  assert.deepEqual(v.c.linhas.map((l) => [l.estado, l.animal_id, l.resultado]), [['FILA', sis.ids.v520, 'POSITIVO']]);
  assert.doesNotMatch(v.textoTodo, /tire um dos dois/);
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
  assert.equal(linhasDoBanco(x).length, 1);
  assert.deepEqual(x.estado.erros, []);
  await x.fechar();
});
