'use strict';
/**
 * Segunda convergência da Fase 3, rodada 2 da revisão: os achados da interface (CONTRATOS, seção 54). Cada teste reproduz um
 * achado pela tela de verdade, com o backend real e a rede decidida no Node, e falha com o `src/` de antes do conserto (commit
 * 5e69ebf). O teste aleatório do curral e do tronco (`tests/ui/curral.fuzz.test.js`) foi estendido para gerar o "Terminar" com a
 * remoção do rascunho que falha.
 *  7. Trocar o produto (ou o protocolo) na aplicação sanitária mantinha a carência, a dose, o lote e a validade do anterior — no
 *     lançamento novo e na correção.
 *  8. Fêmeas → "Diagnóstico": o aparelho escolhia a estação pela data de hoje, e não pela exposição da fêmea.
 * 14. Sem localStorage, "Terminar" com a remoção do rascunho do servidor sem chegar terminava a sessão; a que voltava do rascunho
 *     enviava as linhas descartadas.
 * 15. A recusa do servidor ao resolvedor (a data futura) aparecia como falta de sinal: as linhas ficavam pendentes para sempre.
 * 16. A pendente barrada por outra linha do mesmo animal aparecia como "sem resposta na hora", com "Conferir" que não resolvia.
 * Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');
const { RELOGIO, T, TRANSPORTE, montarSistema, novaRede, lerTela, esperarMs } = require('./apoio-curral');

test.after(() => A.fecharBrowser());

async function abrir(tela, o) {
  o = o || {};
  const sis = montarSistema();
  const rede = novaRede(sis.s);
  const regra = { transporte: null };
  const servidor = (pedido, executar) => {
    if (regra.transporte && regra.transporte(pedido)) return TRANSPORTE;
    return rede.servidor(pedido, executar);
  };
  const a = await A.abrir(sis.s, { largura: 360, hash: o.hash || T[tela].hash, relogio: RELOGIO, servidor, semLocalStorage: !!o.semLocalStorage });
  await A.esperarTela(a.page, o.titulo || T[tela].titulo);
  return Object.assign({ sis, rede, tela, cfg: T[tela], regra }, a);
}
async function parar(x) {
  for (let i = 0, q = 0; i < 2000; i++) {
    const st = await x.page.evaluate((sel) => ({ em: window.__gas.emCurso, conf: /Conferindo/.test((document.querySelector(sel) || {}).textContent || '') }), x.cfg.conferencia);
    if (st.em <= x.rede.segurados.length && !st.conf) { q += 1; if (q >= 3) return; } else q = 0;
    await esperarMs(15);
  }
  throw new Error('a tela não parou');
}
async function comecar(x, data) {
  if (data) await x.page.fill(x.tela === 'curral' ? '#cur-data' : '#tr-data', data);
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
const inesperados = (x) => x.estado.erros.filter((m) => !/^console: \[ERP\] (armazenamento local indisponível|rascunho|remover o rascunho)/.test(m));
const rascunhoServidor = (x) => { const r = x.sis.s.api({ rota: 'rascunho.obter', dados: { chave: 'r.' + x.cfg.rascunho } }); return r.data.existe ? r.data.conteudo : null; };
function ok(s, rota, dados, chave) {
  const r = s.api({ rota, idempotencyKey: chave, dados });
  assert.equal(r.ok, true, rota + ': ' + JSON.stringify(r.error));
  return r.data;
}

// ------------------------------------------------------------------ achado 7 ----

test('achado 7: trocar o produto na aplicação troca o que veio do anterior (lote, validade, dose) e a carência fica com o servidor (a padrão do produto novo) — no lançamento novo e na correção; o protocolo traz o produto dele', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = sem.animais.find((x) => x.brinco === '0457').animal_id;
  s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-11-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id, peso: 400 }] }, 'peso');
  const pa = ok(s, 'produto.salvar', { campos: { nome: 'Vermífugo Oral A', categoria: 'VERMIFUGO', unidade: 'mL', custo_unitario: 0.5, dose_padrao_por_kg: 0.01, carencia_padrao_dias: 0, lote: 'LOTE-A', validade: '2027-01-31', controla_estoque: false } }, 'pa').product_id;
  const pb = ok(s, 'produto.salvar', { campos: { nome: 'Ivermectina 3,15% B', categoria: 'VERMIFUGO', unidade: 'mL', custo_unitario: 2.0, dose_padrao_por_kg: 0.02, carencia_padrao_dias: 122, lote: 'LOTE-B', validade: '2028-05-31', controla_estoque: false } }, 'pb').product_id;
  // A correção (mais abaixo): o original com o C (a carência pelo padrão dele, 10 mL por cabeça); trocar o produto para o D traz
  // a carência e a dose do D.
  const pc = ok(s, 'produto.salvar', { campos: { nome: 'Vermífugo C', categoria: 'VERMIFUGO', unidade: 'mL', custo_unitario: 0.5, dose_padrao_por_cabeca: 10, carencia_padrao_dias: 14, controla_estoque: false } }, 'pc').product_id;
  const pd = ok(s, 'produto.salvar', { campos: { nome: 'Vermífugo D', categoria: 'VERMIFUGO', unidade: 'mL', custo_unitario: 2.0, dose_padrao_por_cabeca: 20, carencia_padrao_dias: 122, controla_estoque: false } }, 'pd').product_id;
  const ev = s.registrar({ tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: { event_date: '2026-11-10', produto_id: pc, modo_dose: 'POR_CABECA', dose_referencia: 10 }, animais: [{ animal_id: id }] }, 'apl');
  const t1 = ok(s, 'protocolo.salvar', { campos: { nome: 'Vermifugação A', tipo_procedimento: 'VERMIFUGO', product_id: pa, sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'UNICA' } }, 't1').protocol_id;
  const t2 = ok(s, 'protocolo.salvar', { campos: { nome: 'Vermifugação B', tipo_procedimento: 'VERMIFUGO', product_id: pb, sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'UNICA' } }, 't2').protocol_id;
  const a = await A.abrir(s, { largura: 360, hash: 'sanidade/agenda' });
  const { page } = a;
  await A.esperarTela(page, 'Sanidade');
  await page.evaluate((x) => window.Registro.abrir('SANIDADE', { subtipo: 'VERMIFUGACAO', campos: { event_date: '2026-11-13' }, linhas: [{ animal_id: x }] }), id);
  await page.waitForSelector('[data-campo="produto_id"] select');
  const ler = () => page.evaluate(() => {
    const v = (c) => { const el = document.querySelector('[data-campo="' + c + '"] input:not([type=radio]), [data-campo="' + c + '"] select'); return el ? el.value : null; };
    const modo = document.querySelector('[data-campo="modo_dose"] input:checked') || document.querySelector('[data-campo="modo_dose"] select');
    return [modo ? modo.value : null, v('dose_referencia'), v('periodo_carencia_dias'), v('lote'), v('validade')];
  });
  await page.locator('[data-campo="produto_id"] select').selectOption(pa);
  assert.deepEqual(await ler(), ['POR_PESO', '0,01', '', 'LOTE-A', '2027-01-31'], 'o produto A sugere; a carência fica em branco (a do servidor)');
  await page.locator('[data-campo="produto_id"] select').selectOption(pb);
  assert.deepEqual(await ler(), ['POR_PESO', '0,02', '', 'LOTE-B', '2028-05-31'], 'o B troca o que veio do A');
  // O digitado fica: o lote mudado à mão não segue o produto.
  await page.fill('[data-campo="lote"] input', 'L-MEU');
  await page.locator('[data-campo="produto_id"] select').selectOption(pa);
  assert.deepEqual(await ler(), ['POR_PESO', '0,01', '', 'L-MEU', '2027-01-31']);
  await page.locator('[data-campo="produto_id"] select').selectOption(pb);
  await page.fill('[data-campo="lote"] input', 'LOTE-B');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector('[role=dialog] [data-acao-principal]:not([disabled])', { timeout: 15000 });
  const rev = (await page.textContent('[role=dialog]')).replace(/\s+/g, ' ');
  assert.match(rev, /Dose por animal\s*8 mL/);
  assert.match(rev, /Carência\s*122 dias: não abater até 15\/03\/2027/, 'a revisão do servidor mostra a carência do produto B');
  await page.click('[role=dialog] [data-acao-principal]');
  await A.esperarServidor(page);
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
  const r = s.tabela('SANIDADE').filter((x) => x.produto_id === pb);
  assert.deepEqual(r.map((x) => [x.periodo_carencia_dias, x.data_fim_carencia, x.lote, x.validade, x.dose]), [[122, '2027-03-15', 'LOTE-B', '2028-05-31', 8]]);
  await A.ir(page, 'evento/' + ev.event_id, 'Sanidade');
  await page.click('[data-acoes-evento] button:has-text("Corrigir")');
  await A.esperarTela(page, 'Corrigir:');
  assert.equal(await page.locator('[data-campo="periodo_carencia_dias"] input').inputValue(), '', 'a carência que o servidor copiou do produto vem em branco');
  await page.locator('[data-campo="produto_id"] select').selectOption(pd);
  assert.equal(await page.locator('[data-campo="dose_referencia"] input').inputValue(), '20', 'a dose do produto novo');
  await page.fill('[data-campo="justificativa_correcao"] textarea', 'produto errado');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector('[role=dialog] [data-acao-principal]:not([disabled])', { timeout: 15000 });
  await page.click('[role=dialog] [data-acao-principal]');
  await A.esperarServidor(page);
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
  const st = {};
  s.tabela('EVENTOS').forEach((e) => { st[e.event_id] = e.status; });
  const novo = s.tabela('SANIDADE').filter((x) => x.produto_id === pd && st[x.event_id] !== 'ESTORNADO');
  assert.deepEqual(novo.map((x) => [x.periodo_carencia_dias, x.data_fim_carencia, x.dose]), [[122, '2027-03-12', 20]]);
  // O protocolo traz o produto dele; trocar o protocolo troca o produto que veio do anterior (e o que veio do produto).
  await page.evaluate((x) => window.Registro.abrir('SANIDADE', { subtipo: 'VERMIFUGACAO', campos: { event_date: '2026-11-13' }, linhas: [{ animal_id: x }] }), id);
  await page.waitForSelector('[data-campo="protocol_id"] select');
  await page.locator('[data-campo="protocol_id"] select').selectOption(t1);
  assert.equal(await page.locator('[data-campo="produto_id"] select').inputValue(), pa);
  await page.locator('[data-campo="protocol_id"] select').selectOption(t2);
  assert.equal(await page.locator('[data-campo="produto_id"] select').inputValue(), pb, 'o produto do protocolo novo');
  assert.deepEqual((await ler()).slice(1), ['0,02', '', 'LOTE-B', '2028-05-31']);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

// ------------------------------------------------------------------ achado 8 ----

test('achado 8: Fêmeas → "Diagnóstico" leva a estação do filtro da lista (a escolha do dono), nunca uma deduzida da data de hoje; sem o filtro, vai sem estação (a regra do servidor: a exposição mais recente da fêmea)', async () => {
  const sis = montarSistema();
  const { s, ids, estacoes } = sis;
  const [e26] = estacoes;
  const anim = s.tabela('ANIMAIS');
  const femeas = ['0520', '0611', '0815'].map((b) => anim.find((x) => x.brinco === b).animal_id);
  s.registrar({ tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-06-10', data_fim: '2026-08-31', estacao_id: e26 }, animais: femeas.map((id) => ({ animal_id: id })).concat([{ animal_id: ids.m33 }]) }, 'expo26');
  const a = await A.abrir(s, { largura: 1280, hash: 'reproducao/matrizes', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Reprodução');
  await page.selectOption('#rm-estacao', e26);
  await page.click('button:has-text("Atualizar")');
  await A.esperarServidor(page);
  await page.waitForSelector('.tabela-componente');
  await page.click('button:has-text("Selecionar os")');
  await page.click('[data-registrar="DIAGNOSTICO_GESTACAO"]');
  await page.waitForSelector('.form-evento');
  assert.equal(await page.locator('[data-campo="estacao_id"] select').inputValue(), e26, 'a estação 26 do filtro (antes: a 27, a mais recente já iniciada)');
  assert.deepEqual(a.estado.erros.filter((m) => !/rascunho/.test(m)), []);
  await a.fechar();
  // Sem o filtro da estação, numa página nova: o diagnóstico vai sem estação.
  const b = await A.abrir(s, { largura: 1280, hash: 'reproducao/matrizes', relogio: RELOGIO });
  await A.esperarTela(b.page, 'Reprodução');
  await b.page.waitForSelector('.tabela-componente');
  await b.page.click('button:has-text("Selecionar os")');
  await b.page.click('[data-registrar="DIAGNOSTICO_GESTACAO"]');
  await b.page.waitForSelector('.form-evento');
  assert.equal(await b.page.locator('[data-campo="estacao_id"] select').inputValue(), '', 'sem o filtro, sem estação');
  await b.fechar();
});

for (const tela of ['curral', 'tronco']) {
  // ---------------------------------------------------------------- achado 14 ----
  test('achado 14 (' + tela + ', sem localStorage): "Terminar" com a remoção do rascunho do servidor sem chegar não termina — a tela diz por quê, a faixa fala da remoção, o rascunho do servidor continua igual à tela; com sinal, termina e o rascunho sai do servidor', async () => {
    const x = await abrir(tela, { semLocalStorage: true });
    const { page } = x;
    const valor = tela === 'curral' ? '430' : 'p';
    await comecar(x);
    await lancar(x, '0520', valor);
    await page.click('[data-enviar]');
    await parar(x);
    await lancar(x, '0611', valor);
    await x.page.clock.fastForward(1500);
    await parar(x);
    x.regra.transporte = (p) => p.rota === 'rascunho.remover' || (p.rota === 'rascunho.salvar' && p.dados && p.dados.chave === 'indice');
    await page.click(x.cfg.status + ' button:has-text("' + x.cfg.terminar + '")');
    await page.waitForSelector('[role=dialog]');
    await page.click('[role=dialog] button:has-text("Descartar e terminar")');
    await parar(x);
    let v = await lerTela(page, tela);
    assert.equal(v.fase, 'sessao', 'a sessão continua: o descarte não foi confirmado pelo servidor');
    assert.match(v.textoTodo, /não terminou: o servidor não confirmou que apagou o rascunho/);
    assert.equal(v.linhas.length, 2, 'as duas linhas continuam na tela');
    const noServidor = rascunhoServidor(x);
    assert.ok(noServidor, 'o rascunho continua no servidor');
    assert.equal(noServidor.linhas.length, 2, 'igual à tela');
    // Com sinal: terminar de novo termina, e o rascunho sai do servidor.
    x.regra.transporte = null;
    await page.click(x.cfg.status + ' button:has-text("' + x.cfg.terminar + '")');
    await page.waitForSelector('[role=dialog]');
    await page.click('[role=dialog] button:has-text("Descartar e terminar")');
    await page.waitForSelector(x.cfg.resultado);
    v = await lerTela(page, tela);
    assert.equal(v.resultadoN, 1);
    assert.equal(rascunhoServidor(x), null, 'o rascunho saiu do servidor');
    assert.deepEqual(inesperados(x), []);
    await x.fechar();
  });

  // ------------------------------------------- o fuzz estendido (semente 14 fixa) ----
  test('fuzz do curral estendido, semente 14 (' + tela + ', sem localStorage): o envio que não saiu por falta da chave guardada (o rascunho chegou, o índice não) volta à fila também no rascunho do servidor — o servidor não fica com o bloco "saindo" que a tela não tem', async () => {
    const x = await abrir(tela, { semLocalStorage: true });
    const { page } = x;
    await comecar(x);
    await lancar(x, '0520', tela === 'curral' ? '430' : 'p');
    await page.clock.fastForward(1500);
    await parar(x);
    // O rascunho chega ao servidor com o bloco saindo; o índice, não: a chave não ficou guardada, e o bloco não sai.
    x.regra.transporte = (p) => p.rota === 'rascunho.salvar' && p.dados && p.dados.chave === 'indice';
    await page.click('[data-enviar]');
    await parar(x);
    let v = await lerTela(page, tela);
    assert.equal(v.c.blocos.length, 1);
    assert.equal(v.c.blocos[0].estado, 'NOVO', 'o bloco não saiu');
    assert.equal(v.c.linhas[0].estado, 'FILA');
    assert.deepEqual(v.naoGuardado, [v.c.blocos[0].chave], 'a tela diz que o envio não saiu');
    // Com o servidor de volta: o rascunho do servidor é o da tela (o bloco na fila, não saindo).
    x.regra.transporte = null;
    await page.clock.fastForward(6000);
    await parar(x);
    await page.clock.fastForward(1500);
    await parar(x);
    v = await lerTela(page, tela);
    const r = rascunhoServidor(x);
    assert.ok(r, 'o rascunho está no servidor');
    assert.deepEqual(r.blocos.map((b) => [b.chave, b.estado]), v.c.blocos.map((b) => [b.chave, b.estado]), 'os blocos do servidor são os da tela');
    assert.deepEqual(r.linhas.map((l) => [l.uid, l.estado]), v.c.linhas.map((l) => [l.uid, l.estado]), 'as linhas do servidor são as da tela');
    assert.equal(r.blocos[0].estado, 'NOVO');
    assert.equal(x.rede.log.filter((p) => p.rota === 'evento.registrar').length, 0, 'nada saiu para o servidor');
    assert.deepEqual(inesperados(x), []);
    await x.fechar();
  });

  // ---------------------------------------------------------------- achado 15 ----
  test('achado 15 (' + tela + '): a recusa do servidor ao resolvedor (a data futura) não é falta de sinal — a nota da data, a conferência e a linha dizem o porquê e o caminho ("Mudar data"), e nada fica pendente à espera de um sinal', async () => {
    const x = await abrir(tela);
    const { page } = x;
    const valor = tela === 'curral' ? '430' : 'p';
    await comecar(x, '2026-11-14');
    let v = await lerTela(page, tela);
    assert.match(v.textoTodo, /O servidor recusou a data 14\/11\/2026: A data 14\/11\/2026 ainda não chegou/);
    assert.match(v.textoTodo, /toque em "Mudar data/);
    assert.doesNotMatch(v.textoTodo, /Sem resposta do servidor para 14\/11\/2026/);
    assert.equal(v.posicaoTentar, false, 'sem "Tentar de novo" que repete a mesma recusa');
    await lancar(x, '0520', valor);
    v = await lerTela(page, tela);
    assert.equal(v.c.linhas.length, 1);
    assert.equal(!!v.c.linhas[0].semPosicao, false, 'não fica à espera de sinal');
    assert.match(v.linhas[0].texto, /recusada pelo servidor/);
    assert.match(v.linhas[0].texto, /O servidor recusou a conferência: A data 14\/11\/2026 ainda não chegou/);
    assert.equal(v.resolverPendentes, false, 'sem "Conferir os brincos pendentes", que nunca resolveria');
    assert.doesNotMatch(v.status, /espera a conferência do servidor/);
    if (tela === 'curral') {
      // "Corrigir o brinco" na data recusada: a mesma recusa, dita como recusa (não "sem resposta, corrija com sinal").
      await page.click('[data-linha="' + v.c.linhas[0].uid + '"] button:has-text("Corrigir o brinco")');
      await page.fill('#cur-corrige-brinco', '0611');
      await page.click('[role=dialog] button:has-text("Corrigir")');
      await parar(x);
      const texto = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      assert.match(texto, /O servidor recusou a conferência do brinco 0611: A data 14\/11\/2026 ainda não chegou/);
      assert.match(texto, /toque em "Mudar data/);
      assert.doesNotMatch(texto, /Corrija com sinal/);
      await page.click('[role=dialog] button:has-text("Voltar")');
    }
    assert.deepEqual(inesperados(x), []);
    await x.fechar();
  });

  // ---------------------------------------------------------------- achado 16 ----
  test('achado 16 (' + tela + '): a pendente barrada por outra linha do mesmo animal, depois da resposta do servidor, se lê "barrada", e o status diz para tirar uma das duas — não "sem resposta na hora", sem o botão que não resolve', async () => {
    const x = await abrir(tela);
    const { page, rede } = x;
    await comecar(x);
    rede.falhas.push({ classe: 'resolver', tipo: 'transporte' }, { classe: 'resolver', tipo: 'transporte' });
    await lancar(x, '0520', tela === 'curral' ? '430' : 'p');
    await lancar(x, '0520', tela === 'curral' ? '432' : 'v');
    let v = await lerTela(page, tela);
    assert.deepEqual(v.c.linhas.map((l) => [l.estado, !!l.semPosicao]), [['NAO_ENCONTRADO', true], ['NAO_ENCONTRADO', true]]);
    await page.click('[data-resolver-pendentes]');
    await parar(x);
    v = await lerTela(page, tela);
    const barrada = v.linhas.find((l) => l.estado === 'NAO_ENCONTRADO');
    assert.ok(barrada, JSON.stringify(v.linhas));
    assert.match(barrada.texto, /barrada: (o animal|a fêmea) já tem outra linha/);
    assert.doesNotMatch(barrada.texto, /pendente: a conferir no servidor/);
    assert.match(v.status, /tire (uma das duas|um dos dois)/);
    assert.doesNotMatch(v.status, /sem resposta na hora/);
    assert.equal(v.resolverPendentes, false, 'sem "Conferir os brincos pendentes": não há o que conferir');
    // Tirada a barrada, o envio segue.
    await page.locator('[data-linha="' + barrada.uid + '"] button:has-text("Tirar")').click();
    await parar(x);
    v = await lerTela(page, tela);
    assert.equal(v.enviar.desabilitado, false);
    assert.deepEqual(inesperados(x), []);
    await x.fechar();
  });
}

// ------------------------------------------- o fuzz estendido (semente 95022) ----
test('fuzz do curral estendido, semente 95022 (tronco): a linha da fêmea que não entra (morta na data), conferida de novo na data nova e recusada pelo servidor, se lê "recusada pelo servidor" — o "não entra" da data antiga não fica', async () => {
  const x = await abrir('tronco');
  const { page, rede } = x;
  await comecar(x, '2026-11-12');
  await lancar(x, '0702', 'p');
  let v = await lerTela(page, 'tronco');
  assert.equal(v.c.linhas.length, 1);
  assert.match(v.linhas[0].texto, /não entra no diagnóstico/, 'a 0702 morreu em 05/11: não entra em 12/11');
  // A data nova: a linha é conferida de novo, e o servidor recusa a conferência.
  rede.falhas.push({ classe: 'resolver', tipo: 'recusa' });
  await page.click(x.cfg.mudar);
  await page.waitForSelector(x.cfg.inicio);
  await page.fill('#tr-data', '2026-11-13');
  await page.click('button:has-text("' + x.cfg.comecar + '")');
  await page.waitForSelector(x.cfg.brinco);
  await parar(x);
  v = await lerTela(page, 'tronco');
  const l = v.c.linhas[0];
  assert.ok(x.rede.log.some((p) => p.rota === 'animal.resolver' && p.falha === 'recusa'), 'a conferência na data nova foi recusada');
  assert.equal(!!l.recusada, true, 'a linha saiu da espera, recusada');
  assert.equal(!!l.naoEntra, false, 'o "não entra" era da data antiga');
  assert.match(v.linhas[0].texto, /recusada pelo servidor/);
  assert.doesNotMatch(v.linhas[0].texto, /não entra no diagnóstico/);
  assert.deepEqual(inesperados(x), []);
  await x.fechar();
});
