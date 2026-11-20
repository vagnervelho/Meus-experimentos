'use strict';
/**
 * Telas da Fase 2, etapa de movimentos e saídas (nível 3, Playwright), a 1280 e a 360 px: registrar um parto a
 * partir da ficha da mãe (crias como grupo repetível, mãe e pasto herdados, gêmeo vivo e natimorto) e ver o
 * histórico de partos na ficha (bloco G); transferência coletiva com um animal fora do pasto de origem (erro
 * coletivo: "1 de 3 com problema", tirar da lista e gravar os restantes) e os dias em cada pasto (bloco D); morte com
 * a confirmação que repete o verbo; corrigir um parto pelo detalhe do evento (mesmas crias, diferença na revisão).
 * Em todas: sem rolagem horizontal, alvos de toque ≥ 48 px a 360 px e nenhum erro no console. Roda por
 * `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const LARGURAS = [1280, 360];
const dialogo = '[role=dialog]';
async function principal(page) {
  await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
  await page.click(dialogo + ' [data-acao-principal]');
}
async function semProblemasDeLeiaute(page, largura, onde) {
  const r = await A.semRolagemHorizontal(page);
  assert.ok(r.sw <= r.cw, onde + ': sem rolagem horizontal a ' + largura + ' px (' + r.sw + ' > ' + r.cw + ')');
  if (largura < 900) assert.deepEqual(await A.alvosDeToque(page, '#conteudo'), [], onde + ': alvos de toque');
}
const vigentesDe = (s, aba) => s.read({ rota: 't', reads: [aba], tratador: (tx) => tx.repo.vigentes(aba) });
async function textoTela(page, sel) { return (await page.textContent(sel)).replace(/\s+/g, ' ').trim(); }
const porBrinco = (sem, b) => sem.animais.find((x) => x.brinco === b).animal_id;

for (const largura of LARGURAS) {
  test('parto pela ficha da mãe: crias no grupo, gêmeo natimorto, resultado e histórico de partos na ficha (' + largura + ' px)', async () => {
    const s = A.sistema();
    const sem = A.semear(s);
    const mae = porBrinco(sem, '0457');
    const a = await A.abrir(s, { largura, hash: 'animal/' + mae + '/resumo' });
    const { page } = a;
    await A.esperarTela(page, '0457');
    await page.click('[data-atalho-ficha="NASCIMENTO"]');
    await A.esperarTela(page, 'Nascimento');
    const crias = page.locator('[data-grupo="crias"] [data-linha-grupo]');
    assert.equal(await crias.count(), 1, 'o parto começa com uma cria');
    await page.fill('[data-campo="event_date"] input', '2026-09-12');
    await crias.nth(0).locator('[data-campo="sexo"] label.opcao', { hasText: 'Macho' }).click();
    await crias.nth(0).locator('[data-campo="peso"] input').fill('32,0');
    await crias.nth(0).locator('[data-campo="metodo_pesagem"] label.opcao', { hasText: 'Balança' }).click();
    await page.click('[data-grupo="crias"] button:has-text("Outra cria")');
    assert.equal(await crias.count(), 2);
    await crias.nth(1).locator('[data-campo="situacao_nascimento"] label.opcao', { hasText: 'Natimorto' }).click();
    assert.equal(await crias.nth(1).locator('[data-campo="sexo"]').isVisible(), false, 'natimorto não pede sexo');
    await semProblemasDeLeiaute(page, largura, 'formulário do parto');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]');
    const rev = await textoTela(page, dialogo);
    assert.match(rev, /Crias\s*1 viva · 1 natimorta \(gemelar\)/);
    assert.match(rev, /Pasto das crias\s*o pasto em que a mãe está no dia/);
    assert.equal(a.pedidos('evento.simular').length, 0, 'revisão LOCAL: uma ida só');
    await principal(page);
    await page.waitForSelector('[data-resultado="NASCIMENTO"]');
    assert.match(await textoTela(page, '[data-resultado]'), /Parto gravado: 1 cria entrou no rebanho/);
    const rep = vigentesDe(s, 'REPRODUCAO').filter((r) => r.tipo_evento === 'PARTO');
    assert.deepEqual(rep.map((r) => [r.animal_id, r.qtd_nascidos_vivos, r.qtd_natimortos, r.data]), [[mae, 1, 1, '2026-09-12']]);
    const cria = vigentesDe(s, 'ANIMAIS').find((x) => x.mae_id === mae);
    assert.deepEqual([cria.sexo, cria.pasto_atual_id, cria.peso_atual, cria.origem], ['M', S.PASTOS.A, 32, 'NASCIDO']);
    await A.ir(page, 'animal/' + mae + '/reproducao', '0457');
    await page.waitForSelector('[data-secao="reproducao"] [data-bloco-reproducao]');
    const g = await textoTela(page, '[data-secao="reproducao"]');
    assert.match(g, /Situação reprodutiva\s*Vazia/);
    assert.match(g, /Cria ao pé\s*sim/);
    assert.match(g, /Partos\s*1/);
    assert.match(g, /12\/09\/2026/);
    assert.match(g, /Bezerros\s*1 nascidos vivos · 0 desmamados · 1 natimortos/, 'o bloco G inteiro (Fase 3, E3.4): os bezerros da matriz');
    assert.doesNotMatch(g, /Fase 3/, 'nada mais a esperar');
    await semProblemasDeLeiaute(page, largura, 'bloco de reprodução');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });

  test('transferência coletiva: erro em 1 de 3 (outro pasto), tirar da lista, gravar os restantes; dias em cada pasto na ficha (' + largura + ' px)', async () => {
    const s = A.sistema();
    const sem = A.semear(s);
    const ids = ['0457', '12', '0391'].map((b) => porBrinco(sem, b));
    const a = await A.abrir(s, { largura, hash: 'rebanho' });
    const { page } = a;
    await A.esperarTela(page, 'Rebanho');
    await page.evaluate((x) => window.Registro.abrir('TRANSFERENCIA', { campos: { pasto_origem_id: x.A }, linhas: x.ids.map((id) => ({ animal_id: id })), origem: 'rebanho' }), { A: S.PASTOS.A, ids });
    await A.esperarTela(page, 'Transferir de pasto');
    await page.fill('[data-campo="event_date"] input', '2026-03-01');
    await page.locator('[data-campo="pasto_destino_id"] select').selectOption({ label: 'Pasto B' });
    await semProblemasDeLeiaute(page, largura, 'formulário da transferência');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]');
    assert.match(await textoTela(page, dialogo), /Movimento\s*Pasto A → Pasto B/);
    await principal(page);
    await page.waitForSelector('[data-faixa-problemas="1"]');
    assert.match(await textoTela(page, '[data-faixa-problemas]'), /1 de 3 com problema/);
    const card = page.locator('[data-problema="true"]');
    assert.match(await textoTela(page, '[data-problema="true"]'), /0391: a transferência de 01\/03\/2026 parte do pasto Pasto A, mas nessa data o animal estaria no pasto Pasto B/);
    assert.equal(vigentesDe(s, 'EVENTOS').filter((e) => e.event_type === 'TRANSFERENCIA').length, 0, 'nada gravado');
    await card.locator('button:has-text("Tirar da lista")').first().click();
    await page.waitForSelector('.form-evento button[type=submit]:has-text("Gravar os 2 restantes")');
    await page.click('.form-evento button[type=submit]');
    await principal(page);
    await page.waitForSelector('[data-resultado="TRANSFERENCIA"]');
    assert.match(await textoTela(page, '[data-resultado]'), /2 animais transferidos/);
    const linhas = vigentesDe(s, 'EVENTO_ANIMAIS').filter((l) => l.pasto_origem_id === S.PASTOS.A && l.pasto_destino_id === S.PASTOS.B);
    assert.deepEqual(linhas.map((l) => l.animal_id).sort(), ids.slice(0, 2).sort());
    await A.ir(page, 'animal/' + ids[0] + '/pastos', '0457');
    await page.waitForSelector('[data-secao="dias-por-pasto"]');
    const d = await textoTela(page, '#conteudo');
    assert.match(d, /Pasto A\s*59 dias/, 'o dia da saída não conta');
    assert.match(d, /transferir de pasto/);
    await semProblemasDeLeiaute(page, largura, 'histórico de pastos');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}

test('morte: confirmação repete o verbo e diz a consequência; causa obrigatória no formulário (360 px)', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = porBrinco(sem, '12');
  const a = await A.abrir(s, { largura: 360, hash: 'animal/' + id + '/resumo' });
  const { page } = a;
  await A.esperarTela(page, '12');
  await page.click('[data-atalho-ficha="MORTE"]');
  await A.esperarTela(page, 'Morte');
  await page.fill('[data-campo="event_date"] input', '2026-05-01');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector('[data-campo="causa"] .campo-erro:not([hidden])');
  await page.locator('[data-campo="causa"] select').selectOption({ label: 'Raio' });
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-acao-principal]');
  assert.match(await textoTela(page, dialogo), /Consequência\s*1 animal sai do rebanho de vez/);
  assert.match(await textoTela(page, dialogo + ' [data-acao-principal]'), /Registrar a morte de 1 animal/);
  await principal(page);
  await page.waitForSelector('[data-resultado="MORTE"]');
  assert.match(await textoTela(page, '[data-resultado]'), /Morte registrada: 1 animal saiu do rebanho/);
  const bx = vigentesDe(s, 'BAIXAS');
  assert.deepEqual(bx.map((x) => [x.animal_id, x.tipo, x.causa]), [[id, 'MORTE', 'RAIO']]);
  assert.equal(vigentesDe(s, 'ANIMAIS').find((x) => x.animal_id === id).situacao_cadastral, 'MORTO');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('corrigir um parto pelo detalhe do evento: mesmas crias, diferença na revisão, simulação do servidor (1280 px)', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const mae = porBrinco(sem, '0391');
  const p = s.registrar({ tipo: 'NASCIMENTO', campos: { event_date: '2026-08-01' }, animais: [{ animal_id: mae }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '5001' }] }, 'parto-1');
  const cria = p.animais.find((x) => x.animal_id !== mae).animal_id;
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/' + p.event_id });
  const { page } = a;
  await A.esperarTela(page, 'Nascimento');
  await page.waitForSelector('[data-secao="parto"]');
  assert.match(await textoTela(page, '[data-secao="parto"]'), /1 nascido vivo/);
  await page.click('[data-acoes-evento] button:has-text("Corrigir")');
  await A.esperarTela(page, 'Corrigir: Nascimento');
  const crias = page.locator('[data-grupo="crias"] [data-linha-grupo]');
  assert.equal(await crias.count(), 1);
  assert.equal(await crias.nth(0).locator('[data-campo="brinco"] input').inputValue(), '5001');
  await crias.nth(0).locator('[data-campo="sexo"] label.opcao', { hasText: 'Macho' }).click();
  await page.fill('[data-campo="justificativa_correcao"] textarea', 'Era macho');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-diferencas="1"]');
  assert.match(await textoTela(page, dialogo + ' [data-diferencas]'), /Cria 1: sexo de Fêmea para Macho/);
  assert.equal(a.pedidos('evento.simular').filter((x) => x.dados.acao === 'corrigir').length, 1);
  await principal(page);
  await page.waitForSelector('[data-resultado]');
  assert.match(await textoTela(page, '[data-resultado]'), /Correção gravada/);
  const animal = vigentesDe(s, 'ANIMAIS').find((x) => x.animal_id === cria);
  assert.deepEqual([animal.sexo, animal.brinco, animal.mae_id], ['M', '5001', mae], 'mesmo animal, sexo corrigido');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('transferência com data passada: "Todos do pasto" usa a posição na data, pelo servidor (inventario.elegiveis), não a de hoje (1280 px)', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const b0457 = porBrinco(sem, '0457');
  s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-06-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: b0457 }] }, 'tr-junho');
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/novo/TRANSFERENCIA' });
  const { page } = a;
  await A.esperarTela(page, 'Transferir de pasto');
  await page.fill('[data-campo="event_date"] input', '2026-03-01');
  await page.click('.seletor-modos button:has-text("Todos do pasto")');
  await page.locator('.seletor-painel select').selectOption(S.PASTOS.A);
  await page.click('.seletor-painel button:has-text("Incluir todos")');
  await posicaoNaData(page);
  // A mudança de data já consulta a posição do rebanho inteiro na data (sem pasto); o "Incluir todos" pede a do pasto.
  assert.ok(a.pedidos('inventario.elegiveis').some((p) => p.dados.data === '2026-03-01' && !p.dados.pasture_id), 'a data passada reconsulta a posição');
  const pedido = a.pedidos('inventario.elegiveis').find((p) => p.dados.pasture_id);
  assert.deepEqual([pedido.dados.tipo, pedido.dados.data, pedido.dados.pasture_id], ['TRANSFERENCIA', '2026-03-01', S.PASTOS.A]);
  const escolhidos = await page.$$eval('.selecionados [data-animal]', (els) => els.map((e) => e.getAttribute('data-animal')));
  assert.ok(escolhidos.includes(b0457), 'em 01/03 o 0457 ainda estava no Pasto A (hoje está no B)');
  assert.equal(escolhidos.length, 3, 'os 3 que estavam no Pasto A em 01/03');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

/**
 * O estado esperado depois do "Incluir todos" numa data passada, sem espera fixa: os dois pedidos registrados (a posição
 * do rebanho na data, pela mudança de data, e a do pasto), todas as respostas entregues e o resultado na tela.
 */
async function posicaoNaData(page) {
  await page.waitForFunction(() => {
    const el = window.__gas.pedidos.filter((p) => p.rota === 'inventario.elegiveis' && p.dados.data === '2026-03-01');
    return el.some((p) => !p.dados.pasture_id) && el.some((p) => p.dados.pasture_id);
  }, null, { timeout: 10000 });
  await A.esperarServidor(page);
  await page.waitForSelector('.seletor-painel .conferencia :text("Posição em 01/03/2026")');
}

test('transferência com data passada, respostas fora de ordem: a posição da data que chega depois da do pasto não apaga o resultado nem a escolha (1280 px)', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const b0457 = porBrinco(sem, '0457');
  s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-06-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: b0457 }] }, 'tr-junho');
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/novo/TRANSFERENCIA' });
  const { page } = a;
  await A.esperarTela(page, 'Transferir de pasto');
  // A corrida que deixava o teste acima instável, forçada: a consulta da mudança de data (sem pasto) responde por último.
  await page.evaluate(() => { window.__gas.atrasar = (p) => (p.rota === 'inventario.elegiveis' && !p.dados.pasture_id ? 1500 : null); });
  await page.fill('[data-campo="event_date"] input', '2026-03-01');
  await page.click('.seletor-modos button:has-text("Todos do pasto")');
  await page.locator('.seletor-painel select').selectOption(S.PASTOS.A);
  await page.click('.seletor-painel button:has-text("Incluir todos")');
  await page.waitForSelector('.seletor-painel .conferencia :text("Posição em 01/03/2026")');
  assert.equal(await page.evaluate(() => window.__gas.emCurso), 1, 'a resposta da posição na data ainda não chegou');
  await posicaoNaData(page);
  assert.equal(await page.inputValue('.seletor-painel select'), S.PASTOS.A, 'o pasto escolhido continua escolhido');
  assert.match(await page.textContent('.seletor-painel .conferencia'), /3 de 3 animais do pasto incluídos/);
  const escolhidos = await page.$$eval('.selecionados [data-animal]', (els) => els.map((e) => e.getAttribute('data-animal')));
  assert.equal(escolhidos.length, 3);
  assert.ok(escolhidos.includes(b0457));
  // Trocar a data depois redesenha o painel: o resultado era de outra data.
  await page.evaluate(() => { window.__gas.atrasar = null; });
  await page.fill('[data-campo="event_date"] input', '2026-04-01');
  await page.locator('[data-campo="event_date"] input').dispatchEvent('change');
  await A.esperarServidor(page);
  await page.waitForFunction(() => !/Posição em 01\/03\/2026/.test(document.querySelector('.seletor-painel').textContent));
  assert.equal(await page.inputValue('.seletor-painel select'), '', 'painel novo para a data nova');
  assert.equal((await page.$$('.selecionados [data-animal]')).length, 3, 'a mudança de data marca, não tira');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
