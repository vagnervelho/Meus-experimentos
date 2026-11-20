'use strict';
/**
 * Revisão independente da Fase 2, rodada 2, lentes INTERFACE_E_REGRAS e FINANCEIRO (nível 3, Playwright, backend real
 * do harness): cada achado confirmado vira um teste que falhava antes do conserto — a nota de data antes do marco zero
 * pelo catálogo, a nota da correção, o link do lançamento na possível duplicidade, o abrir que trata a própria falha,
 * o pasto vazio, o parto histórico e o detalhe de um lançamento estornado. Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const dialogo = '[role=dialog]';
const txt = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
const vigentes = (s, aba) => s.read({ rota: 't', reads: [aba], tratador: (tx) => tx.repo.vigentes(aba) });
function parceiro(s, nome, tipos) {
  const r = s.api({ rota: 'parceiro.salvar', idempotencyKey: 'p-' + nome, dados: { campos: { nome, tipos } } });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data.partner_id;
}
const porBrinco = (sem, b) => sem.animais.find((x) => x.brinco === b).animal_id;

test('achado 9 (interface): a nota de data antes do marco zero vem do catálogo — transferência não vira "histórico"; nascimento sim', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = porBrinco(sem, '0457');
  const a = await A.abrir(s, { largura: 360, hash: 'animal/' + id + '/resumo' });
  const { page } = a;
  await A.esperarTela(page, '0457');
  await page.click('[data-atalho-ficha="TRANSFERENCIA"]');
  await A.esperarTela(page, 'Transferir');
  await page.fill('[data-campo="event_date"] input', '2025-12-15');
  await page.waitForSelector('.nota-erro:has-text("marco zero")');
  const nota = await txt(page, '#conteudo');
  assert.match(nota, /Data anterior ao marco zero \(01\/01\/2026\): o rebanho só é controlado a partir dele, e este lançamento não pode ter data antes disso/);
  assert.doesNotMatch(nota, /histórico informativo/);
  await page.evaluate((x) => window.Registro.abrir('NASCIMENTO', { linhas: [{ animal_id: x }], origem: 'rebanho' }), id);
  await A.esperarTela(page, 'Nascimento');
  await page.fill('[data-campo="event_date"] input', '2025-10-10');
  await page.waitForSelector('.nota-aviso:has-text("histórico informativo")');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 18 (interface): parto anterior ao marco zero — a revisão diz que é registro histórico e o resultado não diz que a cria entrou no rebanho', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const mae = porBrinco(sem, '0457');
  const a = await A.abrir(s, { largura: 1280, hash: 'animal/' + mae + '/resumo' });
  const { page } = a;
  await A.esperarTela(page, '0457');
  await page.click('[data-atalho-ficha="NASCIMENTO"]');
  await A.esperarTela(page, 'Nascimento');
  await page.fill('[data-campo="event_date"] input', '2025-10-10');
  const cria = page.locator('[data-grupo="crias"] [data-linha-grupo]').nth(0);
  await cria.locator('[data-campo="sexo"] label.opcao', { hasText: 'Fêmea' }).click();
  await page.locator('[data-campo="pasto_destino_id"] select[id^="ev-"]').selectOption({ label: 'Pasto A' });
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-acao-principal]');
  const rev = await txt(page, dialogo);
  assert.match(rev, /Registro histórico\s*parto anterior ao marco zero \(01\/01\/2026\): a cria fica no histórico, fora do inventário e sem pasto/);
  assert.doesNotMatch(rev, /Pasto das crias/);
  await page.click(dialogo + ' [data-acao-principal]');
  const aceite = await page.waitForSelector(dialogo + ' label.marca:has-text("Vi e confirmo"), [data-resultado="NASCIMENTO"]', { timeout: 15000 });
  if (await aceite.evaluate((el) => el.tagName === 'LABEL')) {
    for (const l of await page.$$(dialogo + ' label.marca:has-text("Vi e confirmo")')) await l.click();
    await page.click(dialogo + ' [data-acao-principal]');
  }
  await page.waitForSelector('[data-resultado="NASCIMENTO"]', { timeout: 15000 });
  const res = await txt(page, '[data-resultado]');
  assert.match(res, /Parto histórico gravado \(antes do marco zero\): a cria fica no histórico e não entra no inventário/);
  assert.doesNotMatch(res, /entrou no rebanho/);
  const c = vigentes(s, 'ANIMAIS').find((x) => x.mae_id === mae);
  assert.deepEqual([c.situacao_cadastral, c.pasto_atual_id], ['HISTORICO', null]);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achados 10 e 14 (interface e financeiro): a correção de uma venda diz que o animal tirado continua como estava; o detalhe da venda estornada mostra os títulos e o rateio sem efeito', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const ids = ['0457', '12'].map((b) => porBrinco(sem, b));
  const comp = parceiro(s, 'Frigorífico', ['COMPRADOR']);
  const v = s.registrar({ tipo: 'VENDA', campos: { event_date: '2026-06-01', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 150000, valor_bruto: 300000 },
    animais: ids.map((animal_id) => ({ animal_id })), parcelas: [{ data_vencimento: '2026-12-10' }], deducoes: [{ tipo: 'COMISSAO', valor: 5000 }] }, 'v1');
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/' + v.event_id });
  const { page } = a;
  await page.waitForSelector('#conteudo button:has-text("Corrigir")');
  await page.click('#conteudo button:has-text("Corrigir")');
  await A.esperarTela(page, 'Corrigir');
  const corpo = await txt(page, '#conteudo');
  assert.match(corpo, /O animal tirado da lista fica como estava antes deste lançamento/);
  assert.doesNotMatch(corpo, /anula o cadastro/);
  // Estorna pela api e abre o detalhe do lançamento estornado.
  const e = s.api({ rota: 'evento.estornar', idempotencyKey: 'est', dados: { event_id: v.event_id, justificativa: 'venda desfeita' } });
  assert.ok(e.ok, JSON.stringify(e.error));
  await page.evaluate((r) => window.Roteador.ir(r), 'evento/' + v.event_id);
  await page.waitForSelector('[data-secao="financeiro"] [data-titulos="sem-efeito"]');
  const fin = await txt(page, '[data-secao="financeiro"]');
  assert.doesNotMatch(fin, /em aberto/);
  assert.doesNotMatch(fin, /distribuídos/);
  assert.match(fin, /Títulos sem efeito \(lançamento cancelado\): R\$\s3\.000,00 com vencimento em 10\/12\/2026/);
  assert.match(fin, /Rateio sem efeito \(lançamento cancelado\)/);
  assert.equal(await page.locator('[data-titulos="sem-efeito"]').count(), 2, 'a receita e a comissão');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 12 (interface): na possível duplicidade a folha mostra o nome do lançamento e o link para ver o existente', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = porBrinco(sem, '0457');
  const t1 = s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-04-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: id }] }, 't1');
  const a = await A.abrir(s, { largura: 360, hash: 'rebanho' });
  const { page } = a;
  await page.evaluate((x) => window.Registro.abrir('TRANSFERENCIA', { campos: { event_date: '2026-04-01', pasto_origem_id: x.b, pasto_destino_id: x.a }, linhas: [{ animal_id: x.id, valores: {} }], origem: 'rebanho' }), { a: S.PASTOS.A, b: S.PASTOS.B, id });
  await A.esperarTela(page, 'Transferir');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])', { timeout: 15000 });
  await page.click(dialogo + ' [data-acao-principal]');
  await page.waitForSelector(dialogo + ' [data-aviso="POSSIVEL_DUPLICIDADE"]', { timeout: 15000 });
  const av = await txt(page, dialogo + ' [data-aviso="POSSIVEL_DUPLICIDADE"]');
  assert.match(av, /Já existe a transferência de 01\/04\/2026 com este animal\. Gravar mesmo assim\?/);
  const link = page.locator(dialogo + ' [data-aviso="POSSIVEL_DUPLICIDADE"] a[data-conflito="' + t1.event_id + '"]');
  assert.equal(await link.count(), 1);
  assert.equal((await link.textContent()).trim(), 'Abrir a transferência de 01/04/2026');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 16 (interface): sem armazenamento no aparelho e sem conexão, Transferir, Estornar e Corrigir avisam em vez de não fazer nada', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = porBrinco(sem, '0457');
  const t = s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: id }] }, 't1');
  const a = await A.abrir(s, { largura: 360, hash: 'animal/' + id + '/resumo', semLocalStorage: true });
  const { page } = a;
  await A.esperarTela(page, '0457');
  await page.evaluate(() => { window.__gas.falharTransporte = 1; });
  await page.click('[data-atalho-ficha="TRANSFERENCIA"]');
  await page.waitForFunction(() => /Não foi possível abrir o registro/.test(document.getElementById('avisos').textContent));
  assert.match(await page.evaluate(() => window.Roteador.atual()), /^animal\//, 'continua na ficha');
  await page.evaluate((r) => window.Roteador.ir(r), 'evento/' + t.event_id);
  for (const botao of ['Estornar', 'Corrigir']) {
    await page.waitForSelector('[data-acoes-evento] button:has-text("' + botao + '")');
    await page.evaluate(() => { document.getElementById('avisos').textContent = ''; window.__gas.falharTransporte = 1; });
    await page.click('[data-acoes-evento] button:has-text("' + botao + '")');
    await page.waitForFunction(() => /Não foi possível abrir o registro: Sem conexão/.test(document.getElementById('avisos').textContent));
    assert.match(await page.evaluate(() => window.Roteador.atual()), /^evento\//, botao + ': continua no detalhe');
  }
  // Com a conexão de volta, o mesmo toque abre o formulário.
  await page.click('[data-acoes-evento] button:has-text("Corrigir")');
  await A.esperarTela(page, 'Corrigir');
  assert.deepEqual(a.estado.erros.filter((x) => /pageerror/.test(x)), [], 'nenhuma rejeição sem tratamento');
  await a.fechar();
});

test('achado 17 (interface): pasto vazio oferece "Transferir para cá" e a folha "Como o animal entrou?" com o pasto escolhido — nunca o rebanho inicial direto', async () => {
  const s = A.sistema();
  A.semear(s);
  const c = s.api({ rota: 'pasto.salvar', idempotencyKey: 'pasto-c', dados: { campos: { property_id: S.PROP, nome: 'Pasto C', posse: 'PROPRIO', status: 'ATIVO' } } });
  assert.ok(c.ok, JSON.stringify(c.error));
  const idC = c.data.pasture_id;
  const a = await A.abrir(s, { largura: 360, hash: 'pasto/' + idC });
  const { page } = a;
  await A.esperarTela(page, 'Pasto C');
  await page.waitForSelector('[data-secao="animais"] .estado-vazio');
  const vazio = await txt(page, '[data-secao="animais"]');
  assert.doesNotMatch(vazio, /Registrar entrada aqui/);
  await page.click('[data-secao="animais"] button:has-text("Transferir para cá")');
  await A.esperarTela(page, 'Transferir');
  assert.equal(await page.locator('[data-campo="pasto_destino_id"] select').inputValue(), idC);
  await A.ir(page, 'pasto/' + idC, 'Pasto C');
  await page.click('[data-entrada-pasto]');
  await page.waitForSelector(dialogo + ' [data-como-entrou]');
  await page.click(dialogo + ' [data-entrada="COMPRA"]');
  await A.esperarTela(page, 'Comprar');
  assert.equal(await page.locator('[data-campo="pasto_destino_id"] select[id^="ev-"]').inputValue(), idC);
  assert.equal(a.pedidos('evento.registrar').length, 0);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
