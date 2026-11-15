'use strict';
/**
 * Revisão independente da Fase 2, rodada 4, lente INTERFACE E REGRAS (nível 3, Playwright, backend real do harness):
 * cada achado confirmado vira um teste que falhava antes do conserto — o subtipo só para leitura na correção, a linha do
 * tempo da ficha sem identificador nem código cru, o pasto desativado sem ações que o servidor recusa e os documentos
 * do original avisados na correção. Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const txt = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
const ok = (r) => { if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data; };
const porBrinco = (sem, b) => sem.animais.find((x) => x.brinco === b).animal_id;
const vigentes = (s, aba) => s.read({ rota: 't', reads: [aba], tratador: (tx) => tx.repo.vigentes(aba) });

test('R4 achado 16: na correção de uma identificação o subtipo aparece só para leitura, sem os rádios que apagavam o número', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const semBrinco = sem.animais.find((x) => !x.brinco).animal_id;
  const ev = s.registrar({ tipo: 'IDENTIFICACAO', subtipo: 'PRIMEIRA_IDENTIFICACAO', campos: { event_date: '2026-03-01', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: semBrinco, codigo: '0777' }] }, 'ident');
  const a = await A.abrir(s, { largura: 360, hash: 'evento/' + ev.event_id });
  const { page } = a;
  await page.waitForSelector('[data-acoes-evento]');
  await page.click('[data-acoes-evento] button:has-text("Corrigir")');
  await page.waitForSelector('.form-evento');
  assert.equal(await page.locator('.form-evento input[name^="subtipo-"]').count(), 0, 'sem rádios de subtipo na correção');
  const sub = await txt(page, '[data-campo="__subtipo"][data-somente-leitura]');
  assert.match(sub, /Pôr o primeiro brinco|primeir/i);
  assert.match(sub, /Para mudar o que foi lançado, estorne este lançamento e lance de novo\./);
  assert.equal(await page.inputValue('[data-campo="codigo"] input'), '0777', 'o número do original continua na prévia');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('R4 achado 17: a linha do tempo da ficha mostra os ajustes pelo nome (pasto, categoria, certeza), nunca o identificador ou o código cru', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const vaca = porBrinco(sem, '0457');
  const cat = vigentes(s, 'CATEGORIAS').find((c) => c.codigo === 'VACA');
  s.registrar({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_LOCALIZACAO', campos: { event_date: '2026-03-01', justificativa: 'estava no B' }, animais: [{ animal_id: vaca, pasto_destino_id: S.PASTOS.B }] }, 'loc');
  s.registrar({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'RECLASSIFICACAO', campos: { event_date: '2026-03-02', justificativa: 'é vaca de cria' }, animais: [{ animal_id: vaca, categoria_manual_id: cat.category_id }] }, 'rec');
  s.registrar({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-03-03', justificativa: 'data estimada' }, animais: [{ animal_id: vaca, campo: 'data_nascimento_confianca', valor_novo: 'ESTIMADA' }] }, 'cad');
  const a = await A.abrir(s, { largura: 1280, hash: 'animal/' + vaca + '/eventos' });
  const { page } = a;
  await page.waitForSelector('[data-secao="linha-tempo"] li');
  const t = await txt(page, '[data-secao="linha-tempo"]');
  assert.match(t, /Pasto: Pasto A → Pasto B/);
  assert.match(t, /Categoria: automática → Vaca/);
  assert.match(t, /Confirmada → Estimada/);
  assert.doesNotMatch(t, /[0-9a-f]{8}-[0-9a-f]{4}-/, 'nenhum identificador cru');
  assert.doesNotMatch(t, /CONFIRMADA|ESTIMADA/, 'nenhum código cru');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('R4 achado 24: o pasto desativado e vazio não oferece "Transferir para cá" nem "Registrar a chegada"; diz como reativar', async () => {
  const s = A.sistema();
  A.semear(s);
  const novo = ok(s.api({ rota: 'pasto.salvar', idempotencyKey: 'pc', dados: { campos: { nome: 'Pasto C', property_id: S.PROP, posse: 'PROPRIO', status: 'ATIVO' } } }));
  const idC = novo.pasture_id;
  ok(s.api({ rota: 'pasto.salvar', idempotencyKey: 'pc-off', dados: { pasture_id: idC, campos: { nome: 'Pasto C', property_id: S.PROP, posse: 'PROPRIO', status: 'INATIVO' } } }));
  const a = await A.abrir(s, { largura: 360, hash: 'pasto/' + idC });
  const { page } = a;
  await A.esperarTela(page, 'Pasto C');
  await page.waitForFunction(() => /desativado/.test(document.body.textContent));
  const corpo = await txt(page, 'main');
  assert.match(corpo, /O pasto está desativado e não recebe animais: reative-o em "Editar pasto"/);
  assert.equal(await page.locator('button:has-text("Transferir para cá")').count(), 0);
  assert.equal(await page.locator('[data-entrada-pasto]').count(), 0);
  // O pasto ativo e vazio continua com as duas ações.
  await A.ir(page, 'pasto/' + S.PASTOS.B, 'Pasto B');
  ok(s.api({ rota: 'evento.registrar', idempotencyKey: 't', dados: { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: S.PASTOS.B, pasto_destino_id: S.PASTOS.A }, animais: [{ animal_id: vigentes(s, 'ANIMAIS').find((x) => x.brinco === '0391').animal_id }] } }));
  await A.ir(page, 'inicio', 'Início');
  await A.ir(page, 'pasto/' + S.PASTOS.B, 'Pasto B');
  await page.waitForSelector('button:has-text("Transferir para cá")');
  assert.equal(await page.locator('[data-entrada-pasto]').count(), 1);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('R4 achado 25: a correção de uma transferência com GTA anexada avisa que o documento do original passa a ela, no formulário e na revisão', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const vaca = porBrinco(sem, '0457');
  const t = s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: vaca }] }, 'transf');
  ok(s.api({ rota: 'anexo.adicionar', idempotencyKey: 'gta', dados: { entidade: 'EVENTOS', entity_id: t.event_id, tipo: 'DOCUMENTO', nome_arquivo: 'gta-123.pdf', mime_type: 'application/pdf', conteudo_base64: Buffer.from('%PDF-1.4 gta').toString('base64') } }));
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/' + t.event_id });
  const { page } = a;
  await page.waitForSelector('[data-acoes-evento]');
  await page.click('[data-acoes-evento] button:has-text("Corrigir")');
  await page.waitForSelector('.form-evento');
  assert.match(await txt(page, '.form-evento'), /1 documento do lançamento original passa a esta correção: gta-123\.pdf\. Anexe aqui só o que for novo\./);
  await page.fill('[data-campo="event_date"] input', '2026-03-02');
  await page.fill('[data-campo="justificativa_correcao"] textarea', 'data errada');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector('[role=dialog] [data-acao-principal]:not([disabled])');
  assert.match(await txt(page, '[role=dialog]'), /Documentos e fotos do original\s*gta-123\.pdf \(passa a esta correção\)/);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
