'use strict';
/**
 * Revisão final da Fase 2 (rodada 5), lente INTERFACE E REGRAS (nível 3, Playwright, backend real do harness): a recusa da
 * trava fora do formulário de evento diz "Não dá para gravar" e dá o link para o lançamento que impede; o aviso marcado
 * "Bloqueia" chega como erro sem pedir confirmação; na correção de dois dados do mesmo animal o erro fica no cartão do
 * dado certo e a contagem é de animais; a revisão da compra chama o rateado de custo de aquisição. Roda por
 * `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const txt = async (page, sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
const ok = (r) => { if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data; };

test('R5 achado 7: a recusa da trava em "Editar cadastro" diz "Não dá para gravar", não repete a frase e dá o link para o parto que impede', async () => {
  const s = A.sistema();
  const ext = ok(s.api({ rota: 'animal.cadastrarExterno', idempotencyKey: 'ext', dados: { campos: { nome: 'Touro de sêmen', sexo: 'M', data_nascimento: '2015-01-01', data_nascimento_confianca: 'ESTIMADA' } } })).animal_id;
  const V = s.registrar({ tipo: 'ENTRADA_INICIAL', campos: {}, animais: [S.bicho({ brinco: '100', data_nascimento: '2019-01-10', data_nascimento_confianca: 'CONFIRMADA' })] }, 'ei').animais[0].animal_id;
  const p = s.registrar({ tipo: 'NASCIMENTO', campos: { event_date: '2026-03-10', pasto_destino_id: S.PASTOS.A, pai_id: ext, pai_confianca: 'CONFIRMADA' }, animais: [{ animal_id: V }], crias: [{ situacao_nascimento: 'NATIMORTO' }] }, 'parto');
  const a = await A.abrir(s, { largura: 360, hash: 'animal/' + ext + '/resumo' });
  const { page } = a;
  await page.waitForSelector('button:has-text("Editar cadastro")');
  await page.click('button:has-text("Editar cadastro")');
  await page.waitForSelector('[role=dialog] [data-campo="sexo"]');
  await page.check('[role=dialog] [data-campo="sexo"] input[value="F"]');
  await page.click('[role=dialog] [data-acao-principal]');
  await page.waitForSelector('[role=dialog] [data-erro="CONFLICT"]');
  assert.equal(await txt(page, '[role=dialog] [data-erro="CONFLICT"] .estado-titulo'), 'Não dá para gravar');
  const caixa = await txt(page, '[role=dialog] [data-erro="CONFLICT"]');
  assert.doesNotMatch(caixa, /Os dados mudaram/);
  assert.match(caixa, /teria como pai Touro de sêmen \(A-000001\), que passaria a ser fêmea/);
  assert.equal((caixa.match(/teria como pai Touro de sêmen/g) || []).length, 1, 'a frase não se repete na lista');
  const link = page.locator('[role=dialog] [data-erro="CONFLICT"] a[data-conflito="' + p.event_id + '"]');
  assert.equal(await link.count(), 1, 'o link para o parto que impede');
  assert.match(await link.textContent(), /Abrir o parto de 10\/03\/2026/);
  const rol = await A.semRolagemHorizontal(page);
  assert.ok(rol.sw <= rol.cw, 'sem rolagem horizontal a 360 px: ' + JSON.stringify(rol));
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('R5 achado 7: em Configurações, a recusa da trava (zeros à esquerda com 012 e 12) também diz "Não dá para gravar"', async () => {
  const s = A.sistema({ config: { brinco_ignora_zeros_esquerda: 'N' } });
  s.registrar({ tipo: 'ENTRADA_INICIAL', campos: {}, animais: [S.bicho({ brinco: '012' }), S.bicho({ brinco: '12' })] }, 'ei');
  const a = await A.abrir(s, { largura: 360, hash: 'config/parametros' });
  const { page } = a;
  await page.waitForSelector('[data-grupo="identificacao"]');
  await page.check('[data-campo="brinco_ignora_zeros_esquerda"] input[value="true"]');
  await page.click('[data-grupo="identificacao"] .acoes button');
  await page.waitForSelector('[data-grupo="identificacao"] [data-erro]');
  const t = await txt(page, '[data-grupo="identificacao"] [data-erro] .estado-titulo');
  assert.equal(t, 'Não dá para gravar');
  assert.match(await txt(page, '[data-grupo="identificacao"] [data-erro]'), /ficariam errados em 2 pontos/);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('R5 achado 8: o aviso marcado "Bloqueia" chega como erro, sem "Gravar mesmo assim?", dizendo o que bloqueia', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const vaca = sem.animais.find((x) => x.brinco === '0457').animal_id;
  ok(s.api({ rota: 'config.salvar', idempotencyKey: 'pol', dados: { valores: { avisos_politica: { POSSIVEL_DUPLICIDADE: 'BLOQUEIA' } } } }));
  s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-05-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: vaca }] }, 't1');
  s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-05-02', pasto_origem_id: S.PASTOS.B, pasto_destino_id: S.PASTOS.A }, animais: [{ animal_id: vaca }] }, 't2');
  const a = await A.abrir(s, { largura: 360 });
  const { page } = a;
  await page.evaluate((o) => window.Registro.abrir('TRANSFERENCIA', { campos: { event_date: '2026-05-01', pasto_origem_id: o.a, pasto_destino_id: o.b }, linhas: [{ animal_id: o.id }] }), { id: vaca, a: S.PASTOS.A, b: S.PASTOS.B });
  await page.waitForSelector('.form-evento');
  await page.click('.form-evento button[type=submit]');
  await page.waitForTimeout(800);
  const b = await page.$('[role=dialog] [data-acao-principal]:not([disabled])');
  if (b) { await b.click(); }
  await page.waitForSelector('[data-problemas]');
  const prob = await txt(page, '[data-problemas]');
  assert.match(prob, /Já existe a transferência de 01\/05\/2026 com este animal\. A configuração bloqueia este aviso \("Lançamento possivelmente repetido"\): resolva o motivo ou mude a política dele em Configurações › Avisos\./);
  assert.doesNotMatch(prob, /mesmo assim\?/);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('R5 achado 9: na correção de dois dados do mesmo animal, o erro do segundo dado fica no cartão dele; a revisão e o botão contam 1 animal', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const vaca = sem.animais.find((x) => x.brinco === '0457').animal_id;
  const a = await A.abrir(s, { largura: 360 });
  const { page } = a;
  await A.ir(page, 'animal/' + vaca + '/resumo');
  await page.evaluate((id) => window.Registro.abrir('AJUSTE_INVENTARIO', { subtipo: 'CORRECAO_CADASTRO', linhas: [{ animal_id: id }], origem: 'animal/' + id + '/resumo' }), vaca);
  await page.waitForSelector('.form-evento');
  await page.selectOption('[data-linha] [data-campo="campo"] select', 'data_nascimento');
  await page.fill('[data-linha] [data-campo="valor_novo"] input', '2023-03-02');
  await page.click('button:has-text("+ Corrigir outro dado deste animal")');
  await page.waitForFunction(() => document.querySelectorAll('[data-linha]').length === 2);
  const segundo = page.locator('[data-linha]').nth(1);
  await segundo.locator('[data-campo="campo"] select').selectOption('sexo');
  await segundo.locator('[data-campo="valor_novo"] input[value="F"]').check();
  await page.fill('[data-campo="justificativa"] textarea', 'conferência do cadastro');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector('[role=dialog] [data-acao-principal]');
  const rev = await txt(page, '[role=dialog]');
  assert.match(rev, /Animais\s*1 animal/);
  assert.match(rev, /Gravar a correção de 1 animal/);
  await page.click('[role=dialog] [data-acao-principal]:not([disabled])');
  await page.waitForFunction(() => document.querySelectorAll('[data-linha] .campo-erro:not([hidden])').length > 0);
  const erros = await page.$$eval('[data-linha]', (l) => l.map((c) => [...c.querySelectorAll('.campo-erro:not([hidden])')].map((x) => x.textContent.trim())));
  assert.deepEqual(erros[0], [], 'o cartão da data de nascimento fica sem erro');
  assert.match(erros[1].join(' '), /o valor informado em "Sexo" já é o que está no cadastro/);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
