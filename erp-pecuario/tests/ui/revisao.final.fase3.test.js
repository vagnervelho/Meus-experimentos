'use strict';
/**
 * Revisão final da Fase 3 (conserto), achados de tela: o curral e o tronco pela garantia "o bloco que saiu é intocável no
 * aparelho" (a decisão do repetido vale pelo estado da hora do clique; a tela some com "Tirar" e "Mudar" antes de guardar a
 * chave no rascunho do servidor), o animal conferido vale só na data em que o servidor o deu, a linha pendente resolvida pela
 * mesma pergunta antes da decisão do repetido, a linha de uma data passada pelo brinco daquele dia e "Corrigir o resultado"
 * pelo texto digitado. Cada teste falha com o `src/` de antes desta etapa (commit 11b744a). Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');
const { HOJE, RELOGIO, T, montarSistema, novaRede, lerTela, esperarMs } = require('./apoio-curral');

test.after(() => A.fecharBrowser());

async function abrir(tela, o) {
  const sis = montarSistema();
  const rede = novaRede(sis.s);
  const op = o || {};
  const servidor = op.servidor ? op.servidor(rede) : rede.servidor;
  const a = await A.abrir(sis.s, { largura: 360, hash: T[tela].hash, relogio: RELOGIO, servidor, semLocalStorage: !!op.semLocalStorage });
  await A.esperarTela(a.page, T[tela].titulo);
  return Object.assign({ sis, rede, tela, cfg: T[tela] }, a);
}
async function parar(x) {
  for (let i = 0, quietas = 0; i < 2000; i++) {
    const st = await x.page.evaluate((sel) => ({ em: window.__gas.emCurso, conf: /Conferindo/.test((document.querySelector(sel) || {}).textContent || '') }), x.cfg.conferencia);
    if (st.em <= x.rede.segurados.length + (x.extra ? x.extra() : 0) && !st.conf) { quietas += 1; if (quietas >= 3) return; } else quietas = 0;
    await esperarMs(15);
  }
  throw new Error('a tela não parou');
}
async function esperar(fn) {
  for (let i = 0; i < 400; i++) { if (await fn()) return; await esperarMs(15); }
  throw new Error('a condição não chegou');
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
const linhasDoBanco = (x) => x.sis.s.tabela(x.cfg.aba).filter((r) => x.sis.s.tabela('EVENTOS').some((e) => e.event_id === r.event_id && String(e.idempotency_key || '').indexOf(x.cfg.prefixo) === 0));
const pesosDoBanco = (x) => linhasDoBanco(x).map((r) => [r.animal_id, r.peso_kg]).sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));

for (const depois of ['no ar', 'gravado']) {
  test('achado 3 (curral): "Substituir o peso" vale pelo estado da hora do clique — com a linha anterior num bloco ' + depois + ', a pergunta é refeita e nada sai do bloco nem volta à fila; nada grava duas vezes', async () => {
    const x = await abrir('curral');
    const { page, rede, sis } = x;
    await comecar(x);
    rede.falhas.push({ classe: 'registrar', tipo: 'segurar' }, { classe: 'registrar', tipo: 'segurar' });
    await lancar(x, '0520', '430');
    await page.click('[data-enviar]');
    await esperar(() => rede.segurados.length === 1);
    await lancar(x, '0611', '450');
    await lancar(x, '0815', '412');
    await page.fill(x.cfg.brinco, '0611');
    await page.press(x.cfg.brinco, 'Enter');
    await parar(x);
    await page.fill(x.cfg.valor, '455');
    await page.press(x.cfg.valor, 'Enter');
    await parar(x);
    assert.equal(await page.getAttribute('[data-decisao-repetido]', 'data-decisao-repetido'), 'substitui');
    // O bloco 1 volta; o mesmo envio cria o bloco 2 com 0611 450 e 0815 412 e o manda (segurado ou gravado).
    rede.soltar();
    await esperar(() => rede.segurados.length === 1);
    if (depois === 'gravado') { rede.soltar(); await parar(x); }
    const antes = (await lerTela(page, 'curral')).c;
    await page.click('button:has-text("Substituir o peso")');
    await parar(x);
    let v = await lerTela(page, 'curral');
    assert.deepEqual(v.c.linhas.map((l) => [l.uid, l.estado, l.peso, l.bloco]), antes.linhas.map((l) => [l.uid, l.estado, l.peso, l.bloco]), 'nada mudou no clique velho');
    assert.equal(await page.getAttribute('[data-decisao-repetido]', 'data-decisao-repetido'), 'outra');
    assert.match(v.textoTodo, /mudou enquanto você decidia/);
    assert.ok(await page.isVisible('.curral-candidatos button:has-text("Pesar de novo")'));
    await page.click('button:has-text("Manter o anterior")');
    if (depois === 'no ar') rede.soltar();
    await parar(x);
    v = await lerTela(page, 'curral');
    assert.deepEqual(v.c.linhas.map((l) => [l.peso, l.estado]), [[430, 'GRAVADA'], [450, 'GRAVADA'], [412, 'GRAVADA']]);
    assert.deepEqual(pesosDoBanco(x), [[sis.ids.v520, 430], [sis.ids.v611, 450], [sis.ids.v815, 412]].sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1)));
    assert.doesNotMatch(v.status, /na fila/);
    assert.equal(sis.s.integridade().erros, 0);
    assert.deepEqual(x.estado.erros, []);
    await x.fechar();
  });
}

for (const tela of ['curral', 'tronco']) {
  test('achado 4 (' + tela + ', sem localStorage): enquanto o rascunho com a chave do bloco vai ao servidor, a tela já mostra as linhas saindo — sem "Tirar" e sem "Mudar data" —, e o bloco grava na data da sessão', async () => {
    const seg = [];
    let segurar = false;
    const x = await abrir(tela, { semLocalStorage: true, servidor: (rede) => (pedido, executar) => {
      if (segurar && /^rascunho\./.test(pedido.rota)) return new Promise((res) => seg.push(() => res(rede.servidor(pedido, executar))));
      return rede.servidor(pedido, executar);
    } });
    x.extra = () => seg.length;
    const { page, sis } = x;
    await comecar(x);
    await lancar(x, '0520', tela === 'curral' ? '430' : 'p');
    await lancar(x, '0611', tela === 'curral' ? '450' : 'v');
    assert.equal(await page.evaluate(() => Rascunhos.modo()), 'SERVIDOR');
    segurar = true;
    await page.click('[data-enviar]');
    await esperar(() => seg.length >= 1);
    const v = await lerTela(page, tela);
    assert.deepEqual(v.linhas.map((l) => l.estado), ['ENVIANDO', 'ENVIANDO']);
    v.linhas.forEach((l) => assert.equal(l.botoes.indexOf('Tirar'), -1, 'a linha que sai não tem "Tirar": ' + JSON.stringify(l.botoes)));
    assert.equal(v.mudar, false, '"Mudar data" some quando o bloco começa a sair');
    segurar = false;
    while (seg.length) seg.shift()();
    await parar(x);
    await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
    await parar(x);
    const w = await lerTela(page, tela);
    assert.deepEqual(w.linhas.map((l) => l.estado), ['GRAVADA', 'GRAVADA']);
    assert.equal(linhasDoBanco(x).length, 2);
    assert.ok(sis.s.tabela('EVENTOS').filter((e) => String(e.idempotency_key || '').indexOf(x.cfg.prefixo) === 0).every((e) => e.event_date === HOJE));
    assert.equal(sis.s.integridade().erros, 0);
    assert.deepEqual(x.estado.erros.filter((e) => !/armazenamento local indisponível/.test(e)), []);
    await x.fechar();
  });

  test('achado 7 (' + tela + '): o animal conferido no campo do brinco (sem lançar) não sobrevive ao "Mudar data" — o valor lançado na data nova sem brinco não entra, e o 0457 de 04/11 é a vaca A', async () => {
    const x = await abrir(tela);
    const { page, sis } = x;
    await comecar(x);
    await page.fill(x.cfg.brinco, '0457');
    await A.enter(page, x.cfg.brinco);
    assert.match(await page.textContent(x.cfg.conferencia), /0457/);
    await page.click(x.cfg.mudar);
    await page.waitForSelector(x.cfg.inicio);
    await comecar(x, '2026-11-04');
    await parar(x);
    await page.fill(x.cfg.valor, tela === 'curral' ? '300' : 'v');
    await page.press(x.cfg.valor, 'Enter');
    await parar(x);
    assert.deepEqual((await lerTela(page, tela)).c.linhas, [], 'sem brinco, nada entra (a vaca B conferida hoje não vale em 04/11)');
    await lancar(x, '0457', tela === 'curral' ? '300' : 'v');
    const v = await lerTela(page, tela);
    assert.deepEqual(v.c.linhas.map((l) => [l.animal_id, l.dataAnimal]), [[sis.ids.vacaA, '2026-11-04']]);
    await page.click('[data-enviar]');
    await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
    assert.deepEqual(linhasDoBanco(x).map((r) => r.animal_id), [sis.ids.vacaA]);
    assert.deepEqual(x.estado.erros, []);
    await x.fechar();
  });
}

test('achado 6 (tronco): numa data passada a linha e a mensagem do servidor citam o brinco daquele dia, e "Corrigir o resultado" (mesmo depois de recarregar) confere o texto digitado — a mesma vaca, nunca a do brinco de hoje', async () => {
  const x = await abrir('tronco');
  const { page, sis } = x;
  await comecar(x, '2026-11-04');
  await parar(x);
  await lancar(x, '0391', 'p400');
  await page.click('[data-enviar]');
  await parar(x);
  let v = await lerTela(page, 'tronco');
  assert.deepEqual(v.c.linhas.map((l) => [l.estado, l.animal_id]), [['ERRO', sis.ids.vacaB]]);
  assert.match(v.linhas[0].texto, /^1 · 0391 \(hoje 0457\) · prenhe/);
  assert.match(v.linhas[0].texto, /0391 \(hoje 0457\): /, 'a mensagem do servidor cita o brinco de 04/11');
  await page.reload();
  await A.esperarTela(page, 'Diagnóstico no tronco');
  await parar(x);
  v = await lerTela(page, 'tronco');
  assert.match(v.linhas[0].texto, /0391 \(hoje 0457\)/);
  await page.click('[data-linha="' + v.c.linhas[0].uid + '"] button:has-text("Corrigir o resultado")');
  await parar(x);
  assert.equal(await page.inputValue('#tr-brinco'), '0391');
  await page.fill('#tr-resultado', 'p90');
  await page.press('#tr-resultado', 'Enter');
  await parar(x);
  v = await lerTela(page, 'tronco');
  assert.deepEqual(v.c.linhas.map((l) => [l.estado, l.animal_id, l.resultado, l.idade]), [['FILA', sis.ids.vacaB, 'POSITIVO', 90]], 'a linha recusada da vaca B foi corrigida (nenhuma linha da vaca A)');
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
  assert.deepEqual(linhasDoBanco(x).map((r) => [r.animal_id, r.idade_gestacional_dias]), [[sis.ids.vacaB, 90]]);
  assert.deepEqual(x.estado.erros, []);
  await x.fechar();
});

test('achado 12 (curral): a pendente resolvida para um animal que já tem pesagem gravada pede a decisão de pesar de novo ("Está certo" ou "Tirar") e não barra o envio das outras', async () => {
  const x = await abrir('curral');
  const { page, rede, sis } = x;
  await comecar(x);
  await lancar(x, '0520', '430');
  await page.click('[data-enviar]');
  await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
  rede.falhas.push({ classe: 'resolver', tipo: 'transporte' });
  await lancar(x, '0520', '436');
  assert.deepEqual((await lerTela(page, 'curral')).c.linhas.map((l) => l.estado), ['GRAVADA', 'NAO_ENCONTRADO']);
  await lancar(x, '0611', '450');
  let v = await lerTela(page, 'curral');
  assert.deepEqual(v.c.linhas.map((l) => [l.estado, l.peso]), [['GRAVADA', 430], ['AVISO', 436], ['FILA', 450]]);
  const pend = v.linhas.find((l) => l.uid === v.c.linhas[1].uid);
  assert.match(pend.texto, /já foi pesado nesta pesagem com 430,0 kg \(gravada\)\. Pesar de novo grava outra pesagem do mesmo dia/);
  assert.deepEqual(pend.botoes, ['Está certo', 'Corrigir o peso', 'Tirar']);
  assert.equal(v.enviar.desabilitado, false, 'a decisão pendente não barra o envio do 0611');
  assert.doesNotMatch(v.status, /pendência impede/);
  await page.click('[data-enviar]');
  // O envio termina quando o "Enviar" volta sem nada a enviar (a tela redesenhada no fim do envio).
  await page.waitForSelector('[data-linha="' + v.c.linhas[2].uid + '"][data-estado="GRAVADA"]', { timeout: 15000 });
  await esperar(() => page.evaluate(() => { const b = document.querySelector('[data-enviar]'); return !!b && b.disabled && b.textContent.trim() === 'Enviar'; }));
  await page.click('[data-linha="' + v.c.linhas[1].uid + '"] button:has-text("Está certo")');
  await parar(x);
  assert.equal((await lerTela(page, 'curral')).c.linhas[1].estado, 'FILA');
  await page.click('[data-enviar]');
  await parar(x);
  // O servidor confirma de novo a segunda pesagem do mesmo dia (o aviso dele); aceita, ela grava.
  v = await lerTela(page, 'curral');
  if (v.c.linhas[1].estado === 'AVISO') {
    await page.click(v.avisoGeral ? '[data-aceitar-geral]' : '[data-linha="' + v.c.linhas[1].uid + '"] button:has-text("Está certo")');
    await parar(x);
    await page.waitForSelector('[data-linha="' + v.c.linhas[1].uid + '"][data-estado="GRAVADA"]', { timeout: 15000 });
  }
  v = await lerTela(page, 'curral');
  assert.deepEqual(v.c.linhas.map((l) => l.estado), ['GRAVADA', 'GRAVADA', 'GRAVADA']);
  assert.deepEqual(linhasDoBanco(x).map((r) => [r.animal_id, r.peso_kg]).sort(), [[sis.ids.v520, 430], [sis.ids.v520, 436], [sis.ids.v611, 450]].sort());
  assert.deepEqual(x.estado.erros, []);
  await x.fechar();
});

for (const ordem of ['devagar', 'depressa']) {
  test('achado 13 (tronco, ' + ordem + '): o mesmo brinco digitado de novo com sinal resolve a pendente na mesma pergunta, antes da decisão — o novo resultado substitui o anterior, com o aviso, qualquer que seja a ordem das respostas', async () => {
    const x = await abrir('tronco');
    const { page, rede, sis } = x;
    await comecar(x);
    rede.falhas.push({ classe: 'resolver', tipo: 'transporte' });
    await lancar(x, '0520', 'p');
    assert.deepEqual((await lerTela(page, 'tronco')).c.linhas.map((l) => l.estado), ['NAO_ENCONTRADO']);
    if (ordem === 'devagar') {
      await page.fill(x.cfg.brinco, '0520');
      await A.enter(page, x.cfg.brinco);
      await parar(x);
      assert.equal(await page.getAttribute('[data-conferencia-repetido]', 'data-conferencia-repetido'), 'substitui');
      await page.fill(x.cfg.valor, 'v');
      await page.press(x.cfg.valor, 'Enter');
    } else {
      rede.falhas.push({ classe: 'resolver', tipo: 'segurar' });
      await page.fill(x.cfg.brinco, '0520');
      await page.press(x.cfg.brinco, 'Enter');
      await page.fill(x.cfg.valor, 'v');
      await page.press(x.cfg.valor, 'Enter');
      await esperar(() => rede.segurados.length === 1);
      rede.soltar();
    }
    await parar(x);
    const v = await lerTela(page, 'tronco');
    assert.deepEqual(v.c.linhas.map((l) => [l.estado, l.animal_id, l.resultado]), [['FILA', sis.ids.v520, 'NEGATIVO']]);
    assert.match(v.textoTodo, /o novo resultado \(vazia\) substituiu o anterior \(prenhe\)/);
    assert.doesNotMatch(v.textoTodo, /tire um dos dois/);
    await page.click('[data-enviar]');
    await page.waitForSelector('.curral-lista [data-estado="GRAVADA"]', { timeout: 15000 });
    assert.deepEqual(linhasDoBanco(x).map((r) => [r.animal_id, r.resultado]), [[sis.ids.v520, 'NEGATIVO']]);
    assert.deepEqual(x.estado.erros, []);
    await x.fechar();
  });
}

// ---------------------------------------------------------------- telas fora do curral ----
const dialogo = '[role=dialog]';
function ok(s, rota, dados, chave) {
  const r = s.api({ rota, idempotencyKey: chave, dados, avisosAceitos: ['ESTOQUE_INSUFICIENTE', 'CARENCIA_ATIVA', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'POSSIVEL_DUPLICIDADE'] });
  if (!r.ok) throw new Error(rota + ': ' + JSON.stringify(r.error));
  return r.data;
}
const vigentesDe = (s, aba) => s.read({ rota: 't', reads: [aba, 'EVENTOS', 'OPERACOES'], tratador: (tx) => tx.repo.vigentes(aba) });
async function textoTela(page, sel) { return (await page.textContent(sel)).replace(/\s+/g, ' ').trim(); }

test('achado 5 (Eventos): a correção de uma aplicação reconhece a próxima proposta pelo intervalo congelado no lançamento — com o protocolo mudado depois, o campo vem vazio e a data corrigida refaz a próxima pelo intervalo do fato', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const vac = ok(s, 'produto.salvar', { campos: { nome: 'Vacina Aftosa', categoria: 'VACINA', unidade: 'dose', controla_estoque: false } }, 'p1').product_id;
  const prot = ok(s, 'protocolo.salvar', { campos: { nome: 'Aftosa semestral', tipo_procedimento: 'VACINA', product_id: vac, sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180 } }, 'q1').protocol_id;
  const ids = sem.animais.filter((x) => x.brinco === '0457' || x.brinco === '12').map((x) => x.animal_id);
  const ev = s.registrar({ tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-11-10', produto_id: vac, protocol_id: prot, modo_dose: 'POR_CABECA', dose_referencia: 1, periodo_carencia_dias: 0 }, animais: ids.map((animal_id) => ({ animal_id })) }, 'v1');
  assert.deepEqual(vigentesDe(s, 'SANIDADE').map((r) => r.data_proxima_aplicacao), ['2027-05-09', '2027-05-09']);
  ok(s, 'protocolo.salvar', { protocol_id: prot, campos: { intervalo_dias: 90 }, justificativa: 'O veterinário mudou o calendário' }, 'q2');
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/' + ev.event_id, relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Sanidade');
  await page.click('[data-acoes-evento] button:has-text("Corrigir")');
  await A.esperarTela(page, 'Corrigir:');
  assert.equal(await page.locator('[data-campo="data_proxima_aplicacao"] input').inputValue(), '', 'a próxima proposta (intervalo congelado de 180 dias) não vira valor digitado');
  await page.fill('[data-campo="event_date"] input', '2026-11-12');
  await page.fill('[data-campo="justificativa_correcao"] textarea', 'A vacinação foi no dia 12');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])', { timeout: 15000 });
  assert.match(await textoTela(page, dialogo), /11\/05\/2027/);
  await page.click(dialogo + ' [data-acao-principal]');
  await page.waitForSelector('[data-resultado]');
  assert.deepEqual(vigentesDe(s, 'SANIDADE').map((r) => [r.data_aplicacao, r.data_proxima_aplicacao]), [['2026-11-12', '2027-05-11'], ['2026-11-12', '2027-05-11']], 'a próxima da data corrigida + os 180 dias do fato, não a de antes');
  assert.equal(s.integridade().erros, 0);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 14 (Sanidade): a agenda de uma data passada mostra o animal pelo brinco daquele dia, o que o servidor manda — nunca o de hoje do aparelho', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = sem.animais.find((x) => x.brinco === '0457').animal_id;
  const verm = ok(s, 'produto.salvar', { campos: { nome: 'Vermífugo C', categoria: 'VERMIFUGO', unidade: 'mL', controla_estoque: false } }, 'p1').product_id;
  s.registrar({ tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: { event_date: '2026-11-01', produto_id: verm, modo_dose: 'POR_CABECA', dose_referencia: 5, periodo_carencia_dias: 60 }, animais: [{ animal_id: id }] }, 'v1');
  s.registrar({ tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-11-10', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: id, codigo: '1457', motivo: 'PERDA' }] }, 'troca');
  const a = await A.abrir(s, { largura: 360, hash: 'sanidade/agenda', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Sanidade');
  await page.waitForSelector('[data-resumo-agenda]');
  await page.fill('#sa-data', '2026-11-05');
  await page.click('button:has-text("Atualizar")');
  await page.waitForFunction(() => /0457/.test((document.querySelector('[data-secao="carencia"]') || {}).textContent || ''));
  const car = await textoTela(page, '[data-secao="carencia"]');
  assert.match(car, /0457 \(hoje 1457\)/);
  assert.doesNotMatch(car.replace(/\(hoje 1457\)/g, ''), /1457/);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 15 (Pastos): numa data passada, o pasto desativado depois que tinha animal aparece (marcado inativo) sem "Mostrar pastos inativos" — as cabeças por pasto fecham com o rebanho da data', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const PASTOS = A.S.PASTOS;
  const noB = sem.animais.filter((x) => x.pasto_destino_id === PASTOS.B || x.brinco === '0391').map((x) => x.animal_id);
  s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-11-05', pasto_origem_id: PASTOS.B, pasto_destino_id: PASTOS.A }, animais: noB.map((animal_id) => ({ animal_id })) }, 't1');
  ok(s, 'pasto.salvar', { pasture_id: PASTOS.B, campos: { status: 'INATIVO' }, justificativa: 'Pasto em reforma' }, 'pb');
  const posicao = s.api({ rota: 'inventario.posicao', dados: { data: '2026-11-01' } });
  assert.ok(posicao.ok, JSON.stringify(posicao.error));
  const total = posicao.data.cabecas;
  const a = await A.abrir(s, { largura: 360, hash: 'pastos', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Pastos');
  await page.fill('#pst-lista-data', '2026-11-01');
  await page.click('[data-posicao] button:has-text("Ver")');
  await page.waitForFunction(() => /Posição em 01\/11\/2026/.test(document.querySelector('[data-posicao-em]').textContent));
  assert.equal(await page.isChecked('#pst-inativos'), false);
  const cartaoB = '[data-pasto="' + PASTOS.B + '"]';
  await page.waitForSelector(cartaoB);
  assert.match(await textoTela(page, cartaoB), /Inativo/);
  const cabecas = await page.$$eval('[data-pasto]', (els) => els.map((e) => { const m = /Cabeças\s*(\d+)/.exec(e.textContent.replace(/\s+/g, ' ')); return m ? Number(m[1]) : 0; }));
  assert.equal(cabecas.reduce((t, n) => t + n, 0), total, 'as cabeças por pasto somam o rebanho de 01/11');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
