'use strict';
/**
 * Segunda convergência da Fase 3, rodada 1 da revisão: os achados da interface (CONTRATOS, seção 53). Cada teste reproduz um
 * achado pela tela de verdade, com o backend real e a rede decidida no Node, e falha com o `src/` de antes do conserto (commit
 * 67ac9de). O teste aleatório do curral e do tronco (`tests/ui/curral.fuzz.test.js`) foi estendido para gerar estes estados.
 *  5. Sem localStorage, o pedido de rascunho que chega atrasado ao servidor apagava a chave do bloco já gravado (curral e tronco).
 *  6. O formulário de registro enviava o comando sem a chave guardada no rascunho (a regra 52.1 valia só no curral e no tronco).
 * 12. "Corrigir o brinco" punha na fila uma segunda linha do mesmo animal (o servidor recusava o bloco inteiro); e, pela mesma
 *     causa (achado pelo teste aleatório estendido), a linha que voltava de um bloco desfeito e a de "Pesar de novo" do mesmo
 *     animal saíam no mesmo bloco.
 * 13. A pendente sem sinal aparecia como "brinco não encontrado", e o toque em "Conferir os brincos pendentes" sem resposta do
 *     servidor não dizia nada; e, pela mesma causa (achado pelo teste aleatório estendido), com a resposta perdida a tela ficava
 *     muda até o prazo do aparelho (45 s).
 * 14. Sem localStorage, a falha só do índice dos rascunhos ficava para sempre (a nova tentativa não mandava nada).
 * 17. O contador do tronco contava as linhas que não entram no diagnóstico.
 * Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');
const { RELOGIO, T, TRANSPORTE, montarSistema, novaRede, lerTela, esperarMs } = require('./apoio-curral');

test.after(() => A.fecharBrowser());

/** Abre o curral ou o tronco (ou outra rota) com a rede do teste e um servidor que pode segurar um pedido escolhido. */
async function abrir(tela, o) {
  o = o || {};
  const sis = montarSistema();
  const rede = novaRede(sis.s);
  const presos = [];
  const regra = { segurar: null, transporte: null };
  const servidor = (pedido, executar) => {
    if (regra.transporte && regra.transporte(pedido)) return TRANSPORTE;
    if (regra.segurar && regra.segurar(pedido)) {
      regra.segurar = null;
      // O pedido segurado só chega ao servidor quando for solto (o aparelho já desistiu dele aos 45 s).
      return new Promise((res) => presos.push({ pedido, soltar: () => res(executar()) }));
    }
    return rede.servidor(pedido, executar);
  };
  const a = await A.abrir(sis.s, { largura: 360, hash: o.hash || T[tela].hash, relogio: RELOGIO, servidor, semLocalStorage: !!o.semLocalStorage });
  await A.esperarTela(a.page, o.titulo || T[tela].titulo);
  return Object.assign({ sis, rede, tela, cfg: T[tela], presos, regra }, a);
}
async function parar(x) {
  for (let i = 0, q = 0; i < 2000; i++) {
    const st = await x.page.evaluate((sel) => ({ em: window.__gas.emCurso, conf: /Conferindo/.test((document.querySelector(sel) || {}).textContent || '') }), x.cfg.conferencia);
    if (st.em <= x.rede.segurados.length + x.presos.length && !st.conf) { q += 1; if (q >= 3) return; } else q = 0;
    await esperarMs(15);
  }
  throw new Error('a tela não parou');
}
async function andar(x, ms) { x.rede.passou(ms); await x.page.clock.fastForward(ms); await parar(x); }
async function comecar(x) {
  await x.page.click('button:has-text("' + x.cfg.comecar + '")');
  await x.page.waitForSelector(x.cfg.brinco);
  await parar(x);
}
async function lancar(x, brinco, valor) {
  await x.page.fill(x.cfg.brinco, brinco);
  await x.page.press(x.cfg.brinco, 'Enter');
  await x.page.fill(x.cfg.valor, valor);
  await x.page.press(x.cfg.valor, 'Enter');
  await parar(x);
}
/** Os erros da página fora os registros esperados da falha simulada (o armazenamento bloqueado, o rascunho sem conexão). */
const inesperados = (x) => x.estado.erros.filter((m) => !/^console: \[ERP\] (armazenamento local indisponível|rascunho)/.test(m));
const rascunhoServidor = (x, chave) => { const r = x.sis.s.api({ rota: 'rascunho.obter', dados: { chave: chave || 'r.' + x.cfg.rascunho } }); return r.data.existe ? r.data.conteudo : null; };
const linhasDoBanco = (x) => x.sis.s.tabela(x.cfg.aba).filter((r) => x.sis.s.tabela('EVENTOS').some((e) => e.event_id === r.event_id && e.status !== 'CANCELADO' && String(e.idempotency_key || '').indexOf(x.cfg.prefixo) === 0));

for (const tela of ['curral', 'tronco']) {
  test('achado 5 (' + tela + ', sem localStorage): o pedido de rascunho que chega atrasado ao servidor não apaga o bloco já gravado — a versão mais nova vence; recarregada, a linha continua gravada, e nada grava duas vezes', async () => {
    const x = await abrir(tela, { semLocalStorage: true });
    const { page } = x;
    const valor = tela === 'curral' ? '430' : 'p';
    await comecar(x);
    await andar(x, 1500);
    // O próximo rascunho do lote (a linha na fila, sem bloco) fica no caminho: chega ao servidor só quando for solto.
    x.regra.segurar = (p) => p.rota === 'rascunho.salvar' && p.dados && p.dados.chave === 'r.' + x.cfg.rascunho;
    await lancar(x, '0520', valor);
    await andar(x, 1500);
    assert.equal(x.presos.length, 1, 'o rascunho adiado ficou no caminho');
    await page.click('[data-enviar]');
    await parar(x);
    // O aparelho desiste do pedido velho aos 45 s; o rascunho com a chave chega, e o bloco é gravado.
    await andar(x, 46000);
    await andar(x, 6000);
    let v = await lerTela(page, tela);
    assert.deepEqual(v.c.linhas.map((l) => l.estado), ['GRAVADA']);
    assert.equal(linhasDoBanco(x).length, 1);
    // O pedido velho chega agora: não muda o que o servidor guardou.
    x.presos.splice(0).forEach((p) => p.soltar());
    await parar(x);
    const r = rascunhoServidor(x);
    assert.deepEqual(r.linhas.map((l) => l.estado), ['GRAVADA'], 'o rascunho do servidor continua com a linha gravada');
    assert.deepEqual(r.blocos.map((b) => b.estado), ['GRAVADO']);
    // A página vai embora e volta: a linha é a gravada, e "Enviar" não tem nada a mandar.
    await page.reload();
    await A.esperarTela(page, x.cfg.titulo);
    await parar(x);
    v = await lerTela(page, tela);
    assert.deepEqual(v.c.linhas.map((l) => l.estado), ['GRAVADA'], 'recarregada, nada volta "na fila"');
    assert.ok(v.enviar.desabilitado, 'nada a enviar');
    assert.equal(linhasDoBanco(x).length, 1, 'gravada uma vez');
    assert.equal(new Set(x.rede.log.filter((l) => l.rota === 'evento.registrar').map((l) => l.chave)).size, 1, 'uma chave só');
    assert.deepEqual(inesperados(x), []);
    await x.fechar();
  });
}

test('achado 6 (formulário de registro, sem localStorage): o lançamento só sai com a chave guardada no rascunho — sem ela, nada é enviado e a tela diz por quê; com o rascunho de volta, grava uma vez', async () => {
  const x = await abrir('curral', { semLocalStorage: true, hash: 'pesagens', titulo: 'Pesagens' });
  const { page, sis } = x;
  // O rascunho no servidor não chega (sem conexão para ele).
  x.regra.transporte = (p) => p.rota === 'rascunho.salvar';
  await page.evaluate((id) => window.Registro.abrir('PESAGEM', { campos: { event_date: '2026-11-13', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, linhas: [{ animal_id: id, valores: { peso: '430,0' } }] }), sis.ids.v520);
  await A.esperarTela(page, 'Pesagem');
  await page.waitForSelector('.form-evento button[type=submit]');
  await andar(x, 2000);
  await page.locator('.form-evento button[type=submit]').click();
  await page.waitForSelector('[role=dialog] [data-acao-principal]:not([disabled])');
  await page.click('[role=dialog] [data-acao-principal]');
  await parar(x);
  assert.equal(x.estado.chamadas.filter((p) => p.rota === 'evento.registrar').length, 0, 'sem a chave guardada, o comando não sai');
  await page.waitForSelector('[role=dialog] [data-nao-guardado]');
  assert.match(await page.textContent('[role=dialog] [data-nao-guardado]'), /Nada foi enviado: não foi possível guardar o lançamento antes de enviar/);
  const pesagens = () => sis.s.tabela('PESAGENS').filter((p) => p.animal_id === sis.ids.v520 && p.data_pesagem === '2026-11-13');
  assert.equal(pesagens().length, 0);
  // O rascunho volta a chegar: "Enviar de novo" guarda a chave e grava.
  x.regra.transporte = null;
  await page.click('[role=dialog] [data-nao-guardado] button:has-text("Enviar de novo")');
  await parar(x);
  await andar(x, 1500);
  assert.equal(pesagens().length, 1, 'gravada uma vez');
  const chaves = new Set(x.estado.chamadas.filter((p) => p.rota === 'evento.registrar').map((p) => p.idempotencyKey));
  assert.equal(chaves.size, 1, 'uma chave só');
  assert.deepEqual(inesperados(x), []);
  await x.fechar();
});

test('achado 12 (curral): "Corrigir o brinco" segue a regra do repetido — o brinco de um animal que já tem linha na fila é barrado (tire uma das duas); o de um animal já gravado entra com o aviso de pesar de novo; nada é recusado por animal repetido', async () => {
  const x = await abrir('curral');
  const { page } = x;
  await comecar(x);
  await lancar(x, '0520', '430');
  await lancar(x, '9999', '400');
  let v = await lerTela(page, 'curral');
  assert.deepEqual(v.c.linhas.map((l) => l.estado), ['FILA', 'NAO_ENCONTRADO']);
  const pend = v.c.linhas[1].uid;
  await page.click('[data-linha="' + pend + '"] button:has-text("Corrigir o brinco")');
  await page.fill('#cur-corrige-brinco', '0520');
  await page.click('[role=dialog] button:has-text("Corrigir")');
  await parar(x);
  assert.match(await page.textContent('#avisos'), /0520 já tem outra pesagem nesta sessão \(430,0 kg\): tire uma das duas\./);
  v = await lerTela(page, 'curral');
  assert.deepEqual(v.c.linhas.map((l) => [l.estado, l.animal_id || null]), [['FILA', x.sis.ids.v520], ['NAO_ENCONTRADO', null]], 'a pendente não muda');
  await page.click('[role=dialog] button:has-text("Voltar")');
  // Tirada a pendente, a 0520 grava sozinha.
  await page.click('[data-linha="' + pend + '"] button:has-text("Tirar")');
  await parar(x);
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
  // Com a 0520 já gravada, a pendente corrigida para 0520 entra com o aviso de pesar de novo ("Está certo" ou "Tirar").
  await lancar(x, '9998', '415');
  v = await lerTela(page, 'curral');
  const pend2 = v.c.linhas.find((l) => l.estado === 'NAO_ENCONTRADO').uid;
  await page.click('[data-linha="' + pend2 + '"] button:has-text("Corrigir o brinco")');
  await page.fill('#cur-corrige-brinco', '0520');
  await page.click('[role=dialog] button:has-text("Corrigir")');
  await parar(x);
  v = await lerTela(page, 'curral');
  const nova = v.c.linhas.find((l) => l.uid === pend2);
  assert.equal(nova.estado, 'AVISO');
  assert.match(nova.mensagem, /já foi pesado nesta pesagem com 430,0 kg \(gravada\)\. Pesar de novo grava outra pesagem do mesmo dia/);
  assert.ok(!x.rede.log.some((l) => l.rota === 'evento.registrar' && l.entregue && !l.resposta.ok && (l.resposta.error.details || []).some((d) => d.codigo === 'ANIMAL_REPETIDO')), 'nenhum bloco recusado por animal repetido');
  assert.equal(linhasDoBanco(x).length, 1);
  assert.deepEqual(inesperados(x), []);
  await x.fechar();
});

for (const tela of ['curral', 'tronco']) {
  test('achado 13 (' + tela + '): a pendente sem sinal se lê "pendente: a conferir no servidor", com o porquê; "Conferir os brincos pendentes no servidor" sem resposta diz que elas continuam à espera', async () => {
    const x = await abrir(tela);
    const { page, rede } = x;
    const valor = tela === 'curral' ? '430' : 'p';
    await comecar(x);
    rede.falhas.push({ classe: 'resolver', tipo: 'transporte' });
    await lancar(x, '0520', valor);
    let v = await lerTela(page, tela);
    assert.deepEqual(v.c.linhas.map((l) => [l.estado, !!l.semPosicao]), [['NAO_ENCONTRADO', true]]);
    assert.match(v.linhas[0].texto, /pendente: a conferir no servidor/);
    assert.doesNotMatch(v.linhas[0].texto, /brinco não encontrado/);
    assert.match(v.linhas[0].texto, /Sem resposta do servidor na hora: o brinco é conferido por ele quando houver sinal/);
    assert.match(v.status, /1 brinco espera a conferência do servidor/);
    // O toque sem resposta do servidor responde na tela.
    rede.falhas.push({ classe: 'resolver', tipo: 'transporte' });
    await page.click('[data-resolver-pendentes]');
    await parar(x);
    assert.match(await page.textContent('#avisos'), /Sem resposta do servidor .*o brinco pendente continua à espera dele/);
    // Com sinal, a pendente é resolvida e entra na fila.
    await page.click('[data-resolver-pendentes]');
    await parar(x);
    v = await lerTela(page, tela);
    assert.deepEqual(v.c.linhas.map((l) => l.estado), ['FILA']);
    if (tela === 'tronco') {
      // O macho achado não é "brinco não encontrado": não entra no diagnóstico.
      await lancar(x, '12', 'p');
      v = await lerTela(page, tela);
      const macho = v.linhas.find((l) => /· 12 ·|^\d+ · 12/.test(l.texto));
      assert.ok(macho, JSON.stringify(v.linhas));
      assert.match(macho.texto, /não entra no diagnóstico/);
      assert.doesNotMatch(macho.texto, /brinco não encontrado/);
    }
    assert.deepEqual(inesperados(x), []);
    await x.fechar();
  });

  test('achado 13, a resposta perdida (' + tela + '; achado pelo teste aleatório estendido, semente 80028): até o prazo do aparelho, "Conferir os brincos pendentes no servidor" diz "Conferindo…" e fica travado; depois do prazo, diz que as pendentes continuam à espera', async () => {
    const x = await abrir(tela);
    const { page, rede } = x;
    const valor = tela === 'curral' ? '430' : 'p';
    await comecar(x);
    rede.falhas.push({ classe: 'resolver', tipo: 'transporte' });
    await lancar(x, '0520', valor);
    // A resposta do servidor se perde: o aparelho espera o prazo (45 s).
    rede.falhas.push({ classe: 'resolver', tipo: 'perdeDepois' });
    const n0 = rede.log.length;
    await page.click('[data-resolver-pendentes]');
    await parar(x);
    const b = page.locator('[data-resolver-pendentes]');
    assert.match(await b.textContent(), /Conferindo os brincos pendentes no servidor…/);
    assert.equal(await b.isDisabled(), true, 'travado: o toque repetido não pede de novo');
    assert.equal(rede.log.slice(n0).filter((r) => r.rota === 'animal.resolver').length, 1);
    // Vencido o prazo, a tela diz que a pendente continua esperando, e o botão volta.
    await andar(x, 46000);
    assert.match(await page.textContent('#avisos'), /Sem resposta do servidor .*o brinco pendente continua à espera dele/);
    assert.match(await b.textContent(), /^Conferir os brincos pendentes no servidor$/);
    assert.equal(await b.isDisabled(), false);
    const v = await lerTela(page, tela);
    assert.deepEqual(v.c.linhas.map((l) => [l.estado, !!l.semPosicao]), [['NAO_ENCONTRADO', true]]);
    // Com sinal, resolve.
    await page.click('[data-resolver-pendentes]');
    await parar(x);
    assert.deepEqual((await lerTela(page, tela)).c.linhas.map((l) => l.estado), ['FILA']);
    assert.deepEqual(inesperados(x), []);
    await x.fechar();
  });
}

test('achado 14 (curral, sem localStorage): a falha só do índice dos rascunhos vai de novo sozinha — a faixa sai e o Início lista o rascunho do curral', async () => {
  const x = await abrir('curral', { semLocalStorage: true });
  const { page, rede } = x;
  await comecar(x);
  await andar(x, 1500);
  // O próximo índice falha (o rascunho do curral chega; o índice não).
  rede.falhas.push({ classe: 'rascunho', tipo: 'transporte', rota: 'rascunho.salvar', chave: 'indice' });
  await lancar(x, '0520', '430');
  await andar(x, 1500);
  let v = await lerTela(page, 'curral');
  assert.equal(v.situacaoRascunho.estado, 'FALHOU');
  assert.ok(v.faixaRascunho);
  // Sem outra mudança na tela, o índice vai de novo sozinho em 5 s.
  await andar(x, 6000);
  v = await lerTela(page, 'curral');
  assert.equal(v.situacaoRascunho.estado, 'GUARDADO', 'a nova tentativa mandou o índice');
  assert.ok(!v.faixaRascunho, 'guardado, a faixa sai');
  const ix = rascunhoServidor(x, 'indice');
  assert.ok((ix || []).some((r) => r.id === x.cfg.rascunho), 'o índice do servidor lista o rascunho do curral');
  const lista = await page.evaluate(() => window.Rascunhos.listar());
  assert.ok(lista.some((r) => r.id === 'curral-pesagem'));
  assert.deepEqual(inesperados(x), []);
  await x.fechar();
});

test('achado 17 (tronco): o contador conta as fêmeas achadas — não o macho, o brinco que não existe nem a pendente sem sinal', async () => {
  const x = await abrir('tronco');
  const { page, rede } = x;
  await comecar(x);
  await lancar(x, '0520', 'p');
  await lancar(x, '12', 'p');
  await lancar(x, '9999', 'v');
  rede.falhas.push({ classe: 'resolver', tipo: 'transporte' });
  await lancar(x, '0611', 'p');
  const v = await lerTela(page, 'tronco');
  assert.equal(v.c.linhas.length, 4);
  const cont = (await page.textContent('.curral-contador')).replace(/\s+/g, ' ').trim();
  assert.equal(cont, '1 diagnosticadas · 1 prenhes · 0 vazias · 0 duvidosas');
  assert.equal(v.contador, '1');
  assert.deepEqual(inesperados(x), []);
  await x.fechar();
});

test('achado 12, a mesma causa por outro caminho (curral; achado pelo teste aleatório estendido, semente 70005): a linha que volta de um bloco com aviso ("Corrigir o peso") e a de "Pesar de novo" do mesmo animal nunca saem no mesmo bloco — o servidor não recusa por animal repetido', async () => {
  const x = await abrir('curral');
  const { page, rede, sis } = x;
  await comecar(x);
  // Outro usuário já pesou o 0520 hoje: o bloco do aparelho volta com o aviso de pesagem repetida.
  const r = sis.s.api({ rota: 'evento.registrar', idempotencyKey: 'outro-0520', avisosAceitos: ['POSSIVEL_DUPLICIDADE', 'PESO_IMPLAUSIVEL'], dados: { tipo: 'PESAGEM', campos: { event_date: '2026-11-13', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: sis.ids.v520, peso: 400 }] } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  await lancar(x, '0520', '430');
  rede.falhas.push({ classe: 'registrar', tipo: 'segurar' });
  await page.click('[data-enviar]');
  await parar(x);
  // Com o bloco no ar, o 0520 de novo: "Pesar de novo" (outra pesagem do mesmo dia).
  await page.fill(x.cfg.brinco, '0520');
  await page.press(x.cfg.brinco, 'Enter');
  await page.fill(x.cfg.valor, '440');
  await page.press(x.cfg.valor, 'Enter');
  await parar(x);
  await page.click('button:has-text("Pesar de novo")');
  await parar(x);
  // A resposta chega: o bloco volta com o aviso, e a segunda pesagem sai no bloco seguinte (também com o aviso). O operador
  // corrige o peso das duas: os dois blocos se desfazem, e as duas linhas do 0520 voltam à fila.
  rede.soltar();
  await parar(x);
  let v = await lerTela(page, 'curral');
  assert.deepEqual(v.c.linhas.map((l) => l.estado), ['AVISO', 'AVISO']);
  for (const [i, kg] of [[0, '435'], [1, '445']]) {
    const uid = (await lerTela(page, 'curral')).c.linhas[i].uid;
    await page.click('[data-linha="' + uid + '"] button:has-text("Corrigir o peso")');
    await page.fill('#cur-corrige', kg);
    await page.click('[role=dialog] button:has-text("Corrigir")');
    await parar(x);
  }
  v = await lerTela(page, 'curral');
  assert.deepEqual(v.c.linhas.map((l) => [l.estado, l.animal_id]), [['FILA', sis.ids.v520], ['FILA', sis.ids.v520]]);
  await page.click('[data-enviar]');
  await parar(x);
  v = await lerTela(page, 'curral');
  assert.ok(!rede.log.some((l) => l.rota === 'evento.registrar' && l.entregue && !l.resposta.ok && (l.resposta.error.details || []).some((d) => d.codigo === 'ANIMAL_REPETIDO')), 'nenhum bloco recusado por animal repetido');
  const blocos = v.c.linhas.map((l) => l.bloco);
  assert.ok(blocos[0] && blocos[1] && blocos[0] !== blocos[1], 'cada pesagem do 0520 no seu bloco: ' + JSON.stringify(v.c.linhas.map((l) => [l.estado, l.bloco])));
  assert.deepEqual(v.c.linhas.map((l) => l.estado), ['AVISO', 'AVISO'], 'as duas pedem a confirmação da pesagem repetida do dia');
  assert.deepEqual(inesperados(x), []);
  await x.fechar();
});
