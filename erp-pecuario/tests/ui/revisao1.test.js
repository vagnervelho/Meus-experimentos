'use strict';
/**
 * Revisão independente da Fase 2, rodada 1, lente INTERFACE_E_REGRAS (nível 3, Playwright, backend real do harness):
 * cada achado confirmado vira um teste que falhava antes do conserto — rascunho ENVIANDO que outro atalho apagaria sem
 * perguntar ao servidor, "Desfazer" de uma correção, seletor com data retroativa, o link do conflito com o subtipo, a
 * trilha de auditoria em palavras e os rótulos de subtipo e de aviso. Roda por `npm run ui:check`.
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
function registrar(s, dados, chave) {
  let r = s.api({ rota: 'evento.registrar', idempotencyKey: chave, dados });
  if (!r.ok && r.error.code === 'NEEDS_CONFIRMATION') r = s.api({ rota: 'evento.registrar', idempotencyKey: chave, dados, avisosAceitos: r.error.details.map((d) => d.codigo) });
  if (!r.ok) throw new Error(chave + ': ' + JSON.stringify(r.error));
  return r.data;
}
const porBrinco = (sem, b) => sem.animais.find((x) => x.brinco === b).animal_id;

test('achado 10: rascunho ENVIANDO não é apagado por outro atalho do mesmo tipo: o servidor é consultado antes (gravou → resultado; sem conexão → mantido)', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const b12 = porBrinco(sem, '12');
  const v0457 = porBrinco(sem, '0457');
  const comp = parceiro(s, 'Comprador Z', ['COMPRADOR']);
  const a = await A.abrir(s, { largura: 360, hash: 'animal/' + b12 + '/resumo', relogio: Date.parse('2026-11-13T14:00:00Z') });
  const { page } = a;
  await A.esperarTela(page, '12');
  await page.evaluate((x) => window.Registro.abrir('VENDA', {
    campos: { event_date: '2026-06-01', partner_id: x.comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: '3.000,00', valor_bruto: '3.000,00' },
    linhas: [{ animal_id: x.b12, valores: { peso: '300,0' } }], grupos: { parcelas: [{ valores: { data_vencimento: '2026-07-01' } }] }, origem: 'animal/' + x.b12 + '/resumo',
  }), { comp, b12 });
  await A.esperarTela(page, 'Vender');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])', { timeout: 15000 });
  // O servidor grava, a resposta se perde e a verificação cai por falta de conexão: o rascunho fica ENVIANDO.
  await page.evaluate(() => { window.__gas.perder = 1; });
  await page.click(dialogo + ' [data-acao-principal]');
  await page.waitForFunction(() => window.__gas.pedidos.filter((p) => p.rota === 'evento.registrar').length === 1);
  await page.evaluate(() => { window.__gas.falharTransporte = 1; });
  await page.clock.fastForward(46000);
  await page.waitForSelector('[data-status-envio] [data-erro]', { timeout: 15000 });
  assert.deepEqual(await page.evaluate(async () => (await window.Rascunhos.listar()).map((r) => [r.tipo, r.estado])), [['VENDA', 'ENVIANDO']]);
  assert.equal(vigentes(s, 'EVENTOS').filter((e) => e.event_type === 'VENDA').length, 1, 'o servidor gravou');
  const statusAntes = a.pedidos('operacao.status').length;
  // Sem conexão: o atalho de outra venda consulta o servidor, não consegue e mantém o rascunho (sem "apagar").
  await page.evaluate((id) => window.Roteador.ir('animal/' + id + '/resumo'), v0457);
  await A.esperarTela(page, '0457');
  await page.waitForSelector('[data-atalho-ficha="VENDA"]');
  await page.evaluate(() => { window.__gas.falharTransporte = 1; });
  await page.click('[data-atalho-ficha="VENDA"]');
  await page.waitForFunction(() => /Ainda não sabemos se o registro anterior \(a venda\) foi gravado/.test(document.getElementById('avisos').textContent));
  assert.equal(!!(await page.$(dialogo)), false, 'nenhuma pergunta de apagar o rascunho');
  assert.deepEqual(await page.evaluate(async () => (await window.Rascunhos.listar()).map((r) => [r.tipo, r.estado])), [['VENDA', 'ENVIANDO']], 'rascunho mantido');
  // Com conexão: consulta operacao.status antes de qualquer outra coisa, acha a gravação e mostra o resultado.
  await page.click('[data-atalho-ficha="VENDA"]');
  await page.waitForFunction(() => /já estava gravado no servidor/.test(document.getElementById('avisos').textContent));
  assert.ok(a.pedidos('operacao.status').length > statusAntes, 'operacao.status foi chamado');
  assert.equal(!!(await page.$(dialogo + ' button:has-text("Apagar o rascunho e começar")')), false);
  assert.deepEqual(await page.evaluate(async () => (await window.Rascunhos.listar()).length), 0, 'o rascunho só some com o sucesso confirmado');
  assert.equal(vigentes(s, 'EVENTOS').filter((e) => e.event_type === 'VENDA').length, 1, 'nada foi duplicado');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 11: o resultado de uma correção não oferece "Desfazer"; o estorno do substituto avisa que o original não volta e o botão diz a consequência', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const ids = ['12', '0457'].map((b) => porBrinco(sem, b));
  const t = s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: ids.map((animal_id) => ({ animal_id })) }, 't1');
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/' + t.event_id });
  const { page } = a;
  await page.waitForSelector('#conteudo button:has-text("Corrigir")');
  await page.click('#conteudo button:has-text("Corrigir")');
  await A.esperarTela(page, 'Corrigir');
  await page.fill('[data-campo="event_date"] input', '2026-03-05');
  await page.fill('[data-campo="justificativa_correcao"] input, [data-campo="justificativa_correcao"] textarea', 'data errada');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])', { timeout: 15000 });
  await page.click(dialogo + ' [data-acao-principal]');
  await page.waitForSelector('[data-resultado]', { timeout: 15000 });
  assert.equal(!!(await page.$('[data-resultado] button:has-text("Desfazer")')), false, 'sem "Desfazer" na correção');
  await page.click('[data-resultado] button:has-text("Ver evento")');
  await page.waitForSelector('[data-acoes-evento] button:has-text("Estornar")');
  await page.click('[data-acoes-evento] button:has-text("Estornar")');
  await A.esperarTela(page, 'Estornar');
  await page.fill('[data-campo="justificativa"] input, [data-campo="justificativa"] textarea', 'lançado por engano');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])', { timeout: 15000 });
  const rev = await txt(page, dialogo);
  assert.match(rev, /Será desfeito\s*A transferência de 05\/03\/2026/);
  assert.match(rev, /Atenção\s*Este lançamento corrigiu a transferência de 01\/03\/2026\. Estornar apaga o lançamento inteiro: o original não volta a valer/);
  assert.equal(await txt(page, dialogo + ' [data-acao-principal]'), 'Estornar a transferência de 2 animais');
  // Fora da correção, o "Desfazer" continua no resultado (estorno do próprio lançamento).
  await page.click(dialogo + ' button:has-text("Voltar e corrigir")');
  await page.evaluate((x) => window.Registro.abrir('TRANSFERENCIA', { campos: { event_date: '2026-04-01', pasto_origem_id: x.b, pasto_destino_id: x.a }, linhas: [{ animal_id: x.id, valores: {} }], origem: 'rebanho' }), { a: S.PASTOS.A, b: S.PASTOS.B, id: ids[0] });
  await A.esperarTela(page, 'Transferir');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 12: com data retroativa, Filtros e Busca usam a posição na data (servidor); mudar a data remarca os escolhidos sem tirá-los', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = porBrinco(sem, '0457');
  s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-05', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: id }] }, 't1');
  const a = await A.abrir(s, { largura: 1280, hash: 'rebanho' });
  const { page } = a;
  await page.evaluate((x) => window.Registro.abrir('TRANSFERENCIA', { campos: { event_date: '2026-03-01', pasto_origem_id: x.a, pasto_destino_id: x.b }, origem: 'rebanho' }), { a: S.PASTOS.A, b: S.PASTOS.B });
  await A.esperarTela(page, 'Transferir');
  await page.click('.seletor-modos button:has-text("Filtros")');
  await page.waitForSelector('.seletor-painel .conferencia :text("conferidos pelo servidor")');
  assert.match(await txt(page, '.seletor-painel .conferencia'), /3 animais elegíveis com esses filtros/, 'em 01/03 o 0457 ainda estava no Pasto A');
  assert.ok(!!(await page.$('.seletor-painel .candidatos :text("0457")')));
  await page.click('.seletor-modos button:has-text("Buscar")');
  await page.fill('.seletor-painel input[type=search]', '0457');
  await page.click('.seletor-painel button:has-text("Buscar")');
  await page.waitForSelector('.selecionados [data-animal="' + id + '"]');
  assert.equal(!!(await page.$('.selecionados [data-animal="' + id + '"] .marca-inelegivel')), false, 'elegível na data');
  // A data muda para depois da ida ao Pasto B: o servidor é consultado de novo e o 0457 fica marcado, não tirado.
  const antes = a.pedidos('inventario.elegiveis').length;
  await page.fill('[data-campo="event_date"] input', '2026-03-10');
  await page.waitForSelector('.selecionados [data-animal="' + id + '"] .marca-inelegivel');
  assert.match(await txt(page, '.selecionados [data-animal="' + id + '"]'), /Não elegível: fora do pasto de origem em 10\/03\/2026/);
  assert.ok(a.pedidos('inventario.elegiveis').length > antes && a.pedidos('inventario.elegiveis').some((p) => p.dados.data === '2026-03-10'));
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 13: o link do conflito usa o subtipo (a marcação para descarte), não o tipo DESCARTE', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = porBrinco(sem, '0457');
  const comp = parceiro(s, 'Comprador Z', ['COMPRADOR']);
  registrar(s, { tipo: 'VENDA', campos: { event_date: '2026-03-01', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: id }], parcelas: [{ data_vencimento: '2026-04-01' }] }, 'v');
  const volta = registrar(s, { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-04-01', description: 'voltou' }, animais: [{ animal_id: id, pasto_destino_id: S.PASTOS.A }] }, 'volta');
  const marca = registrar(s, { tipo: 'MARCACAO', subtipo: 'DESCARTE', campos: { event_date: '2026-05-01', acao: 'MARCAR', motivo_descarte: 'IDADE' }, animais: [{ animal_id: id }] }, 'marca');
  const a = await A.abrir(s, { largura: 360, hash: 'evento/' + volta.event_id });
  const { page } = a;
  await page.waitForSelector('#conteudo button:has-text("Estornar")');
  await page.click('#conteudo button:has-text("Estornar")');
  await A.esperarTela(page, 'Estornar');
  await page.fill('[data-campo="justificativa"] input, [data-campo="justificativa"] textarea', 'lançado por engano');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector('[data-conflito]', { timeout: 15000 });
  assert.equal(await page.getAttribute('[data-conflito]', 'data-conflito'), marca.event_id);
  assert.equal(await txt(page, '[data-conflito]'), 'Abrir a marcação para descarte de 01/05/2026');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achados 14 e 21: auditoria em palavras (campo e valores pelo nome) e lista/detalhe com o rótulo do subtipo e dos avisos aceitos', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = porBrinco(sem, '12');
  const cat = vigentes(s, 'CATEGORIAS').find((c) => c.ativo !== false);
  s.registrar({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_LOCALIZACAO', campos: { event_date: '2026-03-01', justificativa: 'estava no B' }, animais: [{ animal_id: id, pasto_destino_id: S.PASTOS.B }] }, 'aj1');
  s.registrar({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'RECLASSIFICACAO', campos: { event_date: '2026-03-02', justificativa: 'é touro' }, animais: [{ animal_id: id, categoria_manual_id: cat.category_id }] }, 'aj2');
  const semBrinco = sem.animais.find((x) => !x.brinco).animal_id;
  const ident = registrar(s, { tipo: 'IDENTIFICACAO', subtipo: 'PRIMEIRA_IDENTIFICACAO', campos: { event_date: '2026-03-03', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: semBrinco, codigo: '0999' }] }, 'id1');
  const nl = registrar(s, { tipo: 'MARCACAO', subtipo: 'NAO_LOCALIZADO', campos: { event_date: '2026-03-04', acao: 'MARCAR' }, animais: [{ animal_id: porBrinco(sem, '0391') }] }, 'nl1');
  const a = await A.abrir(s, { largura: 1280, hash: 'config/auditoria' });
  const { page } = a;
  await page.waitForSelector('#conteudo table#auditoria, #conteudo table');
  const linhas = await page.$$eval('#conteudo table tbody tr', (trs) => trs.map((tr) => Array.from(tr.cells).map((td) => td.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));
  const tudo = linhas.join('\n');
  assert.ok(linhas.some((l) => /Dado do animal corrigido \| Pasto · .*\| Pasto A → Pasto B/.test(l)), tudo);
  assert.ok(linhas.some((l) => new RegExp('Categoria · .*\\| automática → ' + cat.nome).test(l)), tudo);
  assert.ok(linhas.some((l) => /Pasto · Pasto A · Propriedade \| — → Fazenda Boa Vista/.test(l)), tudo);
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/.test(tudo), 'nenhum identificador cru na trilha');
  assert.ok(!/ id\b|_id\b|· valor\b/.test(tudo), 'nenhum nome de coluna');
  // Parâmetros: o rótulo do parâmetro no lugar de "Parâmetro · valor".
  await page.locator('#aud-ent').selectOption('CONFIGURACOES');
  await page.click('#conteudo form.filtros button[type=submit]');
  await page.waitForFunction(() => { const t = document.querySelector('#conteudo table tbody'); return !!t && /Parâmetro · /.test(t.textContent); });
  const params = await page.$$eval('#conteudo table tbody tr', (trs) => trs.map((tr) => Array.from(tr.cells).map((td) => td.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));
  assert.ok(params.some((l) => /Parâmetro · Marco zero \(data do rebanho inicial\) \| — → 01\/01\/2026/.test(l)), params.join('\n'));
  assert.ok(!params.some((l) => /· valor\b/.test(l)));
  // Lista e detalhe de eventos: o rótulo do subtipo do servidor, com acento.
  await A.ir(page, 'eventos', 'Eventos');
  await page.waitForSelector('a:has-text("Pôr o primeiro brinco")');
  const lista = await txt(page, '#conteudo');
  assert.match(lista, /Identificação \(brinco\) · Pôr o primeiro brinco \(ou outra identificação\)/);
  assert.match(lista, /Marcar para descarte ou não localizado · Não localizado/);
  assert.ok(!/identificacao|Nao localizado/.test(lista));
  await A.ir(page, 'evento/' + nl.event_id, 'Não localizado');
  assert.ok(ident.event_id);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('achado 21: os avisos aceitos ao gravar aparecem pelo rótulo (Pasto acima da capacidade), não pelo código', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  // Capacidade de 1 cabeça no Pasto B: a transferência do 12 deixa o pasto acima e o aviso é aceito.
  const pastoB = vigentes(s, 'PASTOS').find((p) => p.pasture_id === S.PASTOS.B);
  const r = s.api({ rota: 'pasto.salvar', idempotencyKey: 'cap', dados: { pasture_id: pastoB.pasture_id, campos: { nome: pastoB.nome, property_id: pastoB.property_id, posse: pastoB.posse, status: 'ATIVO', capacidade_estimada_cabecas: 1 } } });
  assert.ok(r.ok, JSON.stringify(r.error));
  const t = registrar(s, { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: porBrinco(sem, '12') }] }, 'tcap');
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/' + t.event_id });
  const { page } = a;
  await page.waitForSelector('[data-secao="avisos"]');
  assert.match(await txt(page, '[data-secao="avisos"]'), /Pasto acima da capacidade/);
  assert.ok(!/Lotacao/.test(await txt(page, '[data-secao="avisos"]')));
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
