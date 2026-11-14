'use strict';
/**
 * Interface (nível 3, Playwright): a SPA do doGet real conversando com o backend real do harness por um mock de
 * google.script.run. Cobre: carga inicial (e a condicional na recarga), navegação (menu só com módulos ativos,
 * barra inferior, folha "Mais", Voltar com google.script.history e sem ele), formulário renderizado do catálogo
 * (condicionais, padrões, "hoje" no fuso da fazenda), NEEDS_CONFIRMATION, erro por animal, rascunho que sobrevive à
 * recarga (no aparelho e no servidor), LOCKED com nova tentativa, sem resposta em 45 s, sem conexão, faixas de base de
 * teste e de nova versão, leiaute a 360 e 1280 px (sem rolagem horizontal; alvos ≥ 48 px com 8 px de respiro),
 * foco visível e diálogo acessível, tabela/cartões e gráficos com tabela equivalente.
 * Roda por `npm run ui:check` (não pelo `npm test`, que é só Node).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const textos = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').map((e) => e.textContent.trim()));
const cartoes = '.form-evento section.cartao-animal';
async function preencherCartao(page, i, v) {
  const c = page.locator(cartoes).nth(i);
  if (v.brinco !== undefined) await c.locator('[data-campo="brinco"] input').fill(v.brinco);
  if (v.sexo) await c.locator('[data-campo="sexo"] label.opcao', { hasText: v.sexo }).click();
  if (v.origem) await c.locator('[data-campo="origem"] label.opcao', { hasText: v.origem }).click();
  if (v.pasto) await c.locator('[data-campo="pasto_destino_id"] select').selectOption({ label: v.pasto });
  if (v.castrado) await c.locator('[data-campo="castrado"] label.opcao', { hasText: v.castrado }).click();
  if (v.reprodutor) await c.locator('[data-campo="reprodutor"] label.opcao', { hasText: v.reprodutor }).click();
}
async function revisarEGravar(page) {
  await page.locator('.form-evento button[type=submit]').click();
  await page.waitForSelector('[role=dialog] [data-acao-principal]:not([disabled])');
  await page.click('[role=dialog] [data-acao-principal]');
}
const eventosCom = (s, chave) => s.tabela('EVENTOS').filter((e) => e.idempotency_key === chave);

test('carga inicial: página do doGet, carga completa, casca com os módulos ativos; na recarga a carga é condicional (atual)', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 1280 });
  const { page } = a;
  await A.esperarTela(page, 'Início');
  assert.equal(await page.title(), 'ERP Pecuário');
  assert.equal(await page.getAttribute('meta[name=viewport]', 'content'), 'width=device-width, initial-scale=1');
  const boot = a.pedidos('sistema.bootstrap');
  assert.equal(boot.length, 1);
  assert.deepEqual(boot[0].dados, {}, 'primeira abertura: sem versão guardada');
  assert.equal(boot[0].ambiente, undefined, 'produção não envia ambiente');
  assert.match(await page.textContent('.grade-cartoes'), /Cabeças\s*4/);
  assert.deepEqual(await textos(page, '#menu .menu-item'), ['Visão geral']);
  assert.ok(await page.isVisible('.topo-acoes a:has-text("REGISTRAR EVENTO")'));
  assert.equal(await page.$('[data-faixa="base-teste"]'), null, 'produção sem faixa de base de teste');
  assert.match(await page.textContent('[data-alerta="SEM_BRINCO"]'), /sem brinco/);
  const v = s.props()['DATA_VERSION:' + s.banco()];
  await page.reload();
  await A.esperarTela(page, 'Início');
  const boot2 = a.pedidos('sistema.bootstrap');
  assert.equal(boot2.length, 2);
  assert.deepEqual(boot2[1].dados, { dataVersion: Number(v) }, 'recarga envia a versão da carga guardada');
  assert.match(await page.textContent('.grade-cartoes'), /Cabeças\s*4/, 'a carga guardada vale (servidor respondeu atual)');
  assert.deepEqual(await page.evaluate(() => window.__gas.violacoes), []);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

const TELAS_TESTE = [
  { padrao: 'rebanho', modulo: 'REBANHO', titulo: 'Rebanho (tela de teste)' },
  { padrao: 'pastos', modulo: 'PASTOS', titulo: 'Pastos (tela de teste)' },
  { padrao: 'eventos', modulo: 'EVENTOS', titulo: 'Eventos (tela de teste)' },
  { padrao: 'pesagens', modulo: 'PESAGENS', titulo: 'Pesagens (tela de teste)' },
  { padrao: 'config/parametros', modulo: 'CONFIGURACOES', titulo: 'Configurações (tela de teste)' },
];

test('navegação: menu lateral só com módulos ativos e telas instaladas; REGISTRAR; Voltar pelo google.script.history', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 1280, telasDeTeste: TELAS_TESTE });
  const { page } = a;
  assert.equal(await page.evaluate(() => window.Roteador.modo()), 'GAS');
  assert.deepEqual(await textos(page, '#menu .menu-item'), ['Visão geral', 'Rebanho', 'Pastos', 'Eventos', 'Configurações'], 'Pesagens (fase 3) não aparece mesmo com tela');
  await page.click('#menu .menu-item:has-text("Rebanho")');
  await A.esperarTela(page, 'Rebanho (tela de teste)');
  assert.match(page.url(), /#\/rebanho$/);
  assert.equal(await page.getAttribute('#menu .menu-item[data-rota="rebanho"]', 'aria-current'), 'page');
  await page.click('.topo-acoes a:has-text("REGISTRAR EVENTO")');
  await A.esperarTela(page, 'Registrar evento');
  assert.deepEqual(await textos(page, '[data-grupo] h2'), ['Movimentação', 'Correções']);
  assert.deepEqual(await textos(page, '[data-tipo-evento]'), ['Rebanho inicial (marco zero)', 'Outra entrada (doação, permuta, achado)', 'Corrigir dados do animal'], 'estorno não entra no seletor');
  await page.click('[data-tipo-evento="OUTRA_ENTRADA"]');
  await A.esperarTela(page, 'Outra entrada');
  await page.goBack();
  await A.esperarTela(page, 'Registrar evento');
  await page.goBack();
  await A.esperarTela(page, 'Rebanho (tela de teste)');
  await A.ir(page, 'pesagens');
  assert.match(await page.textContent('#conteudo'), /ainda não foi entregue/, 'rota de módulo inativo não abre');
  await A.ir(page, 'nao/existe');
  assert.match(await page.textContent('#conteudo'), /não existe nesta versão/);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('navegação no celular: barra inferior Início · Rebanho · Registrar · Pastos · Mais; folha Mais acessível; tela cheia sem barra; alternativa sem google.script.history', async () => {
  const s = A.sistema();
  const a = await A.abrir(s, { largura: 360, telasDeTeste: TELAS_TESTE, historico: false });
  const { page } = a;
  assert.equal(await page.evaluate(() => window.Roteador.modo()), 'HASH');
  assert.equal(await page.isVisible('#menu'), false, 'sem menu lateral abaixo de 900 px');
  assert.deepEqual(await textos(page, '#barra .barra-item'), ['Início', 'Rebanho', 'Registrar', 'Pastos', 'Mais']);
  const mais = page.locator('#barra [data-mais]');
  await mais.click();
  const dlg = page.locator('[role=dialog]');
  await dlg.waitFor();
  assert.equal(await dlg.getAttribute('aria-modal'), 'true');
  assert.equal(await page.textContent('#' + await dlg.getAttribute('aria-labelledby')), 'Mais');
  assert.deepEqual(await textos(page, '[role=dialog] .menu-item'), ['Eventos', 'Configurações']);
  assert.equal(await page.getAttribute('#app', 'aria-hidden'), 'true', 'fundo inerte enquanto a folha está aberta');
  await page.keyboard.press('Escape');
  await dlg.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-mais')), true, 'o foco volta ao botão Mais');
  await mais.click();
  await page.click('[role=dialog] .menu-item:has-text("Configurações")');
  await A.esperarTela(page, 'Configurações (tela de teste)');
  assert.equal(await page.$('[role=dialog]'), null);
  await page.click('#barra a:has-text("Registrar")');
  await A.esperarTela(page, 'Registrar evento');
  assert.equal(await page.isVisible('#barra'), false, 'registro em tela cheia, sem barra inferior');
  assert.ok(await page.isVisible('.topo-voltar'));
  await page.goBack();
  await A.esperarTela(page, 'Configurações (tela de teste)');
  assert.ok(await page.isVisible('#barra'));
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('formulário do catálogo: todos os campos com rótulo, padrões, visivel_se/obrigatorio_se, novo animal, "+ Novo" pasto e validação local', async () => {
  const s = A.sistema();
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/novo/ENTRADA_INICIAL' });
  const { page } = a;
  await A.esperarTela(page, 'Rebanho inicial');
  const def = await page.evaluate(() => window.Store.tipoEvento('ENTRADA_INICIAL'));
  for (const c of def.campos) {
    const rot = await page.textContent('.form-evento > form > .bloco-campos [data-campo="' + c.id + '"] .campo-rotulo');
    assert.equal(rot.trim(), c.rotulo, c.id);
  }
  for (const c of def.campos_animal) {
    const n = await page.locator(cartoes + ' [data-campo="' + c.id + '"]').count();
    assert.equal(n, 1, 'campo por animal renderizado: ' + c.id);
  }
  assert.equal(await page.inputValue('[data-campo="event_date"] input'), S.D0, 'padrão {de: marco zero}');
  assert.equal(await page.inputValue('[data-campo="property_id"] select'), S.PROP, 'padrão {de: propriedade padrão}');
  const visivel = (id) => page.isVisible(cartoes + ' [data-campo="' + id + '"]');
  assert.equal(await visivel('castrado'), false);
  await preencherCartao(page, 0, { sexo: 'Macho' });
  assert.equal(await visivel('castrado'), true, 'visivel_se sexo = M');
  assert.match(await page.textContent(cartoes + ' [data-campo="castrado"] legend'), /Castrado/);
  assert.match(await page.getAttribute(cartoes + ' [data-campo="castrado"] legend', 'class'), /campo-obrigatorio/, 'obrigatorio_se sexo = M');
  await preencherCartao(page, 0, { sexo: 'Fêmea' });
  assert.equal(await visivel('castrado'), false);
  await page.click(cartoes + ' .mais-dados > summary');
  assert.equal(await visivel('partos_previos'), true);
  assert.equal(await visivel('data_prevista_parto'), false);
  await page.selectOption(cartoes + ' [data-campo="situacao_reprodutiva"] select', 'PRENHA');
  assert.equal(await visivel('data_prevista_parto'), true, 'visivel_se situação = PRENHA');
  assert.equal(await page.getAttribute(cartoes + ' [data-campo="peso"] input', 'inputmode'), 'decimal', 'teclado decimal no peso');
  assert.equal(await visivel('metodo_pesagem'), false);
  await page.fill(cartoes + ' [data-campo="peso"] input', '412,5');
  assert.equal(await visivel('metodo_pesagem'), true, 'visivel_se peso preenchido');
  // Validação local: sem pasto e sem origem → erros sob os campos, foco no primeiro, nada enviado.
  await page.fill(cartoes + ' [data-campo="peso"] input', '');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(cartoes + ' [data-campo="origem"] .campo-erro:not([hidden])');
  assert.match(await page.textContent(cartoes + ' [data-campo="pasto_destino_id"] .campo-erro'), /Escolha uma opção/);
  assert.equal(await page.$('[role=dialog]'), null);
  assert.equal(a.pedidos('evento.simular').length, 0, 'formato inválido não vai ao servidor');
  // "+ Novo" pasto sem sair do formulário: grava pelo servidor e volta com o item escolhido.
  await page.click(cartoes + ' [data-campo="pasto_destino_id"] button:has-text("+ Novo")');
  await page.waitForSelector('[role=dialog] [data-campo="nome"] input');
  await page.fill('[role=dialog] [data-campo="nome"] input', 'Pasto do Córrego');
  await page.click('[role=dialog] button:has-text("Salvar")');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  const novo = s.tabela('PASTOS').filter((p) => p.nome === 'Pasto do Córrego')[0];
  assert.ok(novo, 'pasto gravado');
  assert.equal(await page.inputValue(cartoes + ' [data-campo="pasto_destino_id"] select'), novo.pasture_id);
  await preencherCartao(page, 0, { brinco: '0700', origem: 'Comprado' });
  await page.click('button:has-text("+ Outro animal")');
  assert.equal(await page.locator(cartoes).count(), 2);
  assert.equal(await page.locator(cartoes).nth(1).locator('[data-campo="pasto_destino_id"] select').inputValue(), novo.pasture_id, 'o novo animal herda o pasto do anterior');
  // Enter percorre os campos sem enviar.
  await page.focus(cartoes + ' >> nth=1 >> [data-campo="brinco"] input');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.closest('[data-campo]').getAttribute('data-campo')), 'nome');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('"hoje" no fuso da fazenda: às 21:30 de 13/11 em Porto Velho (01:30 UTC de 14/11, aparelho em Tóquio) o padrão é 13/11', async () => {
  const s = A.sistema();
  s.gas.clock.now = Date.parse('2026-11-14T01:30:00Z');
  const a = await A.abrir(s, { largura: 360, fuso: 'Asia/Tokyo', hash: 'evento/novo/OUTRA_ENTRADA' });
  await A.esperarTela(a.page, 'Outra entrada');
  assert.equal(await a.page.inputValue('[data-campo="event_date"] input'), '2026-11-13');
  assert.equal(await a.page.evaluate(() => window.Fmt.hoje()), '2026-11-13');
  await a.fechar();
});

test('correção pelo catálogo: subtipo primeiro, seletor resolve brinco sem zeros à esquerda, valor correto muda de tipo com o campo', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/novo/AJUSTE_INVENTARIO' });
  const { page } = a;
  await A.esperarTela(page, 'Corrigir dados');
  assert.equal(await page.isVisible('.seletor'), false, 'animais só depois do subtipo');
  await page.click('label.opcao:has-text("Corrigir cadastro")');
  await page.fill('.seletor input[type=search]', '457');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.seletor .selecionados li');
  assert.match(await page.textContent('.seletor .conferencia'), /sem os zeros à esquerda/);
  assert.match(await page.textContent('.seletor .selecionados'), /0457/);
  await page.fill('.seletor input[type=search]', '0391');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.seletor .selecionados li').length === 2);
  assert.equal(await page.locator(cartoes).count(), 2);
  await page.locator(cartoes).nth(0).locator('[data-campo="campo"] select').selectOption('sexo');
  await page.waitForSelector(cartoes + ' >> nth=0 >> [data-campo="valor_novo"] label.opcao');
  assert.deepEqual(await textos(page, cartoes + ':nth-of-type(1) [data-campo="valor_novo"] label.opcao'), ['Macho', 'Fêmea']);
  await page.locator(cartoes).nth(0).locator('[data-campo="campo"] select').selectOption('data_nascimento');
  assert.equal(await page.getAttribute(cartoes + ' >> nth=0 >> [data-campo="valor_novo"] input', 'type'), 'date');
  await page.locator('.seletor .selecionados li', { hasText: '0391' }).locator('button:has-text("Tirar")').click();
  assert.equal(await page.locator(cartoes).count(), 1);
  // "Colar lista": achados, não encontrados e repetidos antes de acrescentar.
  await page.click('.seletor-modos button:has-text("Colar lista")');
  await page.fill('.seletor textarea', '0391\n9999; 457');
  await page.click('button:has-text("Conferir a lista")');
  assert.match(await page.textContent('.seletor .conferencia'), /1 achados · 1 não encontrados · 1 repetidos/);
  await page.click('button:has-text("Incluir os 1 achados")');
  await page.waitForFunction(() => document.querySelectorAll('.seletor .selecionados li').length === 2);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

async function formOutraEntrada(page, animais, descricao) {
  await A.esperarTela(page, 'Outra entrada');
  await page.fill('[data-campo="description"] textarea', descricao || 'Doação do vizinho');
  for (let i = 0; i < animais.length; i++) {
    if (i > 0) await page.click('button:has-text("+ Outro animal")');
    await preencherCartao(page, i, animais[i]);
  }
}

test('NEEDS_CONFIRMATION: aviso com "Vi e confirmo"; reenvio com avisosAceitos e a MESMA chave; nada gravado antes do aceite', async () => {
  const s = A.sistema();
  assert.ok(s.api({ rota: 'pasto.salvar', idempotencyKey: 'cap-b', dados: { pasture_id: S.PASTOS.B, campos: { capacidade_estimada_cabecas: 1 } } }).ok);
  const a = await A.abrir(s, { largura: 360, hash: 'evento/novo/OUTRA_ENTRADA' });
  const { page } = a;
  await formOutraEntrada(page, [{ brinco: '90', sexo: 'Fêmea', origem: 'Comprado', pasto: 'Pasto B' }, { brinco: '91', sexo: 'Fêmea' }]);
  await page.locator('.form-evento button[type=submit]').click();
  await page.waitForSelector('[role=dialog] [data-acao-principal]');
  assert.match(await page.textContent('[role=dialog] .resumo-revisao'), /2 animais/);
  assert.match(await page.textContent('[role=dialog] .resumo-revisao'), /Pasto B: 2/);
  await page.click('[role=dialog] [data-acao-principal]');
  await page.waitForSelector('[role=dialog] [data-aviso="LOTACAO_ACIMA_DA_CAPACIDADE"]');
  assert.equal(s.tabela('EVENTOS').filter((e) => e.event_type === 'OUTRA_ENTRADA').length, 0, 'nada gravado');
  const principal = page.locator('[role=dialog] [data-acao-principal]');
  assert.equal(await principal.textContent(), 'Confirmar mesmo assim');
  assert.equal(await principal.isDisabled(), true, 'sem o aceite, não confirma');
  await page.click('[role=dialog] label.marca:has-text("Vi e confirmo")');
  assert.equal(await principal.isDisabled(), false);
  await principal.click();
  await page.waitForSelector('[data-resultado="OUTRA_ENTRADA"]');
  assert.match(await page.textContent('[data-resultado]'), /2 animais entraram no rebanho/);
  const regs = a.pedidos('evento.registrar');
  assert.equal(regs.length, 2);
  assert.equal(regs[0].idempotencyKey, regs[1].idempotencyKey, 'mesma chave no reenvio');
  assert.equal(regs[0].avisosAceitos, undefined);
  assert.deepEqual(regs[1].avisosAceitos, ['LOTACAO_ACIMA_DA_CAPACIDADE']);
  assert.equal(eventosCom(s, regs[0].idempotencyKey).length, 1);
  assert.equal(await page.evaluate(() => window.Store.animais().filter((x) => x.brinco === '90' || x.brinco === '91').length), 2, 'store atualizado');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('erro por animal: "2 de 4 com problema" (por brinco e por "Animal N da lista"), motivo na linha, Tirar da lista → "Gravar os 2 restantes" → nova revisão e gravação; Desfazer', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/novo/OUTRA_ENTRADA' });
  const { page } = a;
  await formOutraEntrada(page, [{ brinco: '77', sexo: 'Fêmea', origem: 'Comprado', pasto: 'Pasto A' }, { brinco: '457', sexo: 'Fêmea' }, { brinco: '78', sexo: 'Fêmea' }, { brinco: '', sexo: 'Fêmea' }]);
  const quarto = page.locator(cartoes).nth(3);
  await quarto.locator('[data-campo="data_nascimento"] input').fill('2026-11-14');
  await quarto.locator('[data-campo="data_nascimento_confianca"] label.opcao', { hasText: 'Confirmada' }).click();
  await revisarEGravar(page);
  await page.waitForSelector('[data-faixa-problemas]');
  assert.equal(await page.$('[role=dialog]'), null, 'volta ao formulário');
  assert.match(await page.textContent('[data-faixa-problemas]'), /2 de 4 com problema/);
  const ruins = page.locator(cartoes + '[data-problema="true"]');
  assert.equal(await ruins.count(), 2);
  assert.match(await ruins.nth(0).textContent(), /Brinco 457: o brinco 457 já é do animal A-000001/);
  assert.match(await ruins.nth(0).locator('[data-campo="brinco"] .campo-erro').textContent(), /já é do animal/);
  assert.match(await ruins.nth(1).textContent(), /Animal 4 da lista/, 'sem brinco: ligado à linha pela posição');
  assert.match(await ruins.nth(1).locator('.cartao-animal-titulo').textContent(), /^Animal 4$/);
  assert.equal(s.tabela('EVENTOS').filter((e) => e.event_type === 'OUTRA_ENTRADA').length, 0);
  await page.click('[data-faixa-problemas] button:has-text("Só com problema")');
  assert.equal(await page.locator(cartoes + ':visible').count(), 2);
  await ruins.nth(1).locator('.problema-animal button:has-text("Tirar da lista")').click();
  assert.match(await page.textContent('[data-faixa-problemas]'), /1 de 3 com problema/);
  await page.locator(cartoes + '[data-problema="true"]').locator('.problema-animal button:has-text("Tirar da lista")').click();
  assert.equal(await page.$('[data-faixa-problemas]'), null);
  assert.equal(await page.textContent('.form-evento button[type=submit]'), 'Gravar os 2 restantes');
  await revisarEGravar(page);
  await page.waitForSelector('[data-resultado]');
  assert.match(await page.textContent('[data-resultado]'), /2 animais entraram no rebanho/);
  const regs = a.pedidos('evento.registrar');
  assert.equal(regs[1].dados.animais.length, 2);
  assert.equal(regs[0].idempotencyKey, regs[1].idempotencyKey, 'VALIDATION não consome a chave');
  assert.equal(s.tabela('EVENTOS').filter((e) => e.event_type === 'OUTRA_ENTRADA').length, 1);
  // Desfazer: estorno pela revisão no servidor, com a consequência no botão.
  await page.click('[data-resultado] button:has-text("Desfazer")');
  await A.esperarTela(page, 'Estornar evento');
  assert.match(await page.textContent('[data-campo="event_id"]'), /Outra entrada/);
  await page.fill('[data-campo="justificativa"] textarea', 'Lançado por engano');
  await page.locator('.form-evento button[type=submit]').click();
  await page.waitForSelector('[role=dialog] [data-acao-principal]:not([disabled])');
  assert.equal(await page.textContent('[role=dialog] [data-acao-principal]'), 'Estornar outra entrada (doação, permuta, achado) de 2 animais');
  await page.click('[role=dialog] [data-acao-principal]');
  await page.waitForSelector('[data-resultado="ESTORNO"]');
  const est = a.pedidos('evento.estornar')[0];
  assert.equal(typeof est.dataVersionEsperada, 'number', 'revisão no servidor confirma com dataVersionEsperada');
  assert.equal(s.tabela('EVENTOS').filter((e) => e.event_type === 'ESTORNO').length, 1);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

for (const modo of ['aparelho', 'servidor']) {
  test('rascunho sobrevive à recarga (' + modo + '): faixa "não concluído", Continuar restaura os valores e a chave', async () => {
    const s = A.sistema();
    const a = await A.abrir(s, { largura: 360, hash: 'evento/novo/OUTRA_ENTRADA', semLocalStorage: modo === 'servidor' });
    const { page } = a;
    assert.equal(await page.evaluate(() => window.Rascunhos.modo()), modo === 'servidor' ? 'SERVIDOR' : 'LOCAL');
    await formOutraEntrada(page, [{ brinco: '55', sexo: 'Macho', origem: 'Comprado' }], 'Achado na estrada');
    const chave = await page.evaluate(() => window.Registro.sessao('OUTRA_ENTRADA').chave);
    if (modo === 'servidor') await page.waitForFunction(() => window.__gas.pedidos.some((p) => p.rota === 'rascunho.salvar' && p.dados.chave === 'indice'), null, { timeout: 8000 });
    else await page.waitForTimeout(700);
    await A.ir(page, 'inicio', 'Início');
    await page.reload();
    await A.esperarTela(page, 'Início');
    const faixa = page.locator('[data-faixa="rascunho-OUTRA_ENTRADA"]');
    await faixa.waitFor();
    assert.match(await faixa.textContent(), /Outra entrada .* de 13\/11 — registro não concluído \(1 animal\)/);
    assert.match(await page.textContent('[data-rascunho="OUTRA_ENTRADA"]'), /registro não concluído/, 'Início lista o rascunho');
    await faixa.locator('button:has-text("Continuar")').click();
    await A.esperarTela(page, 'Outra entrada');
    assert.equal(await page.inputValue('[data-campo="description"] textarea'), 'Achado na estrada');
    assert.equal(await page.inputValue(cartoes + ' [data-campo="brinco"] input'), '55');
    assert.equal(await page.isChecked(cartoes + ' [data-campo="sexo"] input[value="M"]'), true);
    assert.match(await page.textContent('.form-evento'), /Continuando o rascunho guardado/);
    assert.equal(await page.evaluate(() => window.Registro.sessao('OUTRA_ENTRADA').chave), chave, 'a chave só muda depois de sucesso');
    if (modo === 'servidor') assert.ok(a.pedidos('rascunho.obter').length >= 1);
    await preencherCartao(page, 0, { pasto: 'Pasto A', castrado: 'Não', reprodutor: 'Não' });
    await revisarEGravar(page);
    await page.waitForFunction(() => location.hash === '#/inicio');
    assert.equal(a.pedidos('evento.registrar')[0].idempotencyKey, chave);
    assert.equal(eventosCom(s, chave).length, 1);
    assert.equal(await page.evaluate(() => window.Rascunhos.listar().then((l) => l.length)), 0, 'sucesso apaga o rascunho');
    assert.deepEqual(a.estado.erros.filter((e) => !/armazenamento local indisponível/.test(e)), []);
    await a.fechar();
  });
}

test('LOCKED: "Sistema ocupado, tentando de novo (1 de 3)", nova tentativa sozinha com a mesma chave, grava uma vez', async () => {
  const s = A.sistema();
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/novo/OUTRA_ENTRADA' });
  const { page } = a;
  await formOutraEntrada(page, [{ brinco: '61', sexo: 'Fêmea', origem: 'Comprado', pasto: 'Pasto A' }, { brinco: '62', sexo: 'Fêmea' }]);
  s.gas.lock.segurarPorOutra();
  await revisarEGravar(page);
  await page.waitForFunction(() => /Sistema ocupado, tentando de novo \(1 de 3\)/.test((document.querySelector('[data-status-envio]') || {}).textContent || ''));
  assert.equal(await page.textContent('[role=dialog] [data-acao-principal]'), 'Aguardando…');
  assert.equal(await page.isDisabled('[role=dialog] [data-acao-principal]'), true, 'travado: sem duplo clique');
  s.gas.lock.soltarOutra();
  await page.waitForSelector('[data-resultado]', { timeout: 15000 });
  const regs = a.pedidos('evento.registrar');
  assert.equal(regs.length, 2);
  assert.equal(regs[0].idempotencyKey, regs[1].idempotencyKey);
  assert.equal(eventosCom(s, regs[0].idempotencyKey).length, 1);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('sem resposta em 45 s: "Verificando se gravou…", operacao.status CONFIRMADA, reenvio com a mesma chave, nada duplicado; sem conexão: guarda e reenvia', async () => {
  const s = A.sistema();
  const a = await A.abrir(s, { largura: 360, hash: 'evento/novo/OUTRA_ENTRADA', relogio: Date.parse('2026-11-13T14:00:00Z') });
  const { page } = a;
  await formOutraEntrada(page, [{ brinco: '81', sexo: 'Fêmea', origem: 'Comprado', pasto: 'Pasto A' }, { brinco: '82', sexo: 'Fêmea' }]);
  // Primeiro, sem conexão: nada chega ao servidor; a tela diz que o digitado está guardado e oferece reenviar.
  await page.evaluate(() => { window.__gas.falharTransporte = 1; });
  await revisarEGravar(page);
  await page.waitForSelector('[data-status-envio] [data-erro="TRANSPORTE"]');
  assert.match(await page.textContent('[data-status-envio]'), /Sem conexão. O que você digitou está guardado neste aparelho/);
  assert.equal(s.tabela('EVENTOS').filter((e) => e.event_type === 'OUTRA_ENTRADA').length, 0);
  // Depois, o servidor grava mas a resposta se perde: 45 s → verificação.
  await page.evaluate(() => { window.__gas.perder = 1; });
  await page.click('[data-status-envio] button:has-text("Enviar de novo")');
  await page.waitForFunction(() => window.__gas.pedidos.filter((p) => p.rota === 'evento.registrar').length === 2);
  assert.equal(s.tabela('EVENTOS').filter((e) => e.event_type === 'OUTRA_ENTRADA').length, 1, 'o servidor gravou');
  await page.clock.fastForward(46000);
  await page.waitForSelector('[data-resultado]', { timeout: 10000 });
  assert.match(await page.textContent('[data-resultado]'), /o servidor confirmou a gravação/);
  assert.ok(a.pedidos('operacao.status').length >= 1);
  const regs = a.pedidos('evento.registrar');
  assert.equal(regs.length, 2, 'no servidor: o envio sem resposta e o reenvio depois de CONFIRMADA');
  const daPagina = (await page.evaluate(() => window.__gas.pedidos)).filter((p) => p.rota === 'evento.registrar');
  assert.equal(daPagina.length, 3, 'na página: + o envio que falhou no transporte');
  assert.equal(new Set(daPagina.map((r) => r.idempotencyKey)).size, 1);
  assert.equal(eventosCom(s, regs[0].idempotencyKey).length, 1, 'nada duplicado');
  await a.fechar();
});

test('faixas: BASE DE TESTE fora da produção (pedidos com ambiente TESTE) e "Nova versão disponível" com Recarregar', async () => {
  const s = A.sistema();
  s.gas.exec(() => s.G.Maintenance.setup({ usuario: S.USUARIO, ambiente: 'TESTE' }));
  const a = await A.abrir(s, { largura: 360, params: { ambiente: 'TESTE' }, trocarVersao: '0.0.9' });
  const { page } = a;
  const teste = page.locator('[data-faixa="base-teste"]');
  await teste.waitFor();
  assert.match(await teste.textContent(), /BASE DE TESTE/);
  assert.ok(a.pedidos().every((p) => p.ambiente === 'TESTE'), 'todo pedido leva o ambiente da página');
  const nova = page.locator('[data-faixa="nova-versao"]');
  await nova.waitFor();
  assert.match(await nova.textContent(), /Nova versão disponível/);
  const link = nova.locator('a:has-text("Recarregar")');
  assert.equal(await link.getAttribute('target'), '_top');
  assert.equal(await link.getAttribute('href'), 'https://script.google.com/macros/s/TEST/exec?ambiente=TESTE');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

async function conferirLeiaute(page, rotulo) {
  const o = await A.semRolagemHorizontal(page);
  assert.ok(o.sw <= o.cw && o.bw <= o.cw, 'sem rolagem horizontal (' + rotulo + '): ' + JSON.stringify(o));
  assert.deepEqual(await A.alvosDeToque(page), [], 'alvos de toque (' + rotulo + ')');
}
for (const largura of [360, 1280]) {
  test('leiaute a ' + largura + ' px: sem rolagem horizontal e alvos ≥ 48 px com 8 px de respiro em início, seletor, formulário, revisão e resultado', async () => {
    const s = A.sistema();
    A.semear(s);
    const a = await A.abrir(s, { largura });
    const { page } = a;
    await conferirLeiaute(page, 'início');
    await A.ir(page, 'evento/novo', 'Registrar');
    await conferirLeiaute(page, 'seletor de tipo');
    await A.ir(page, 'evento/novo/ENTRADA_INICIAL', 'Rebanho inicial');
    await preencherCartao(page, 0, { brinco: '0800', sexo: 'Macho', origem: 'Comprado', pasto: 'Pasto A', castrado: 'Não', reprodutor: 'Sim' });
    await page.click(cartoes + ' .mais-dados > summary');
    await page.click('button:has-text("+ Identificação")');
    await conferirLeiaute(page, 'formulário com mais dados');
    await A.ir(page, 'evento/novo/AJUSTE_INVENTARIO', 'Corrigir');
    await page.click('label.opcao:has-text("Animal estava em outro pasto")');
    await page.click('.seletor-modos button:has-text("Filtros")');
    await conferirLeiaute(page, 'seletor de animais');
    await A.ir(page, 'evento/novo/ENTRADA_INICIAL', 'Rebanho inicial');
    await page.locator('.form-evento button[type=submit]').click();
    await page.waitForSelector('[role=dialog] [data-acao-principal]:not([disabled])');
    await conferirLeiaute(page, 'revisão');
    await page.click('[role=dialog] [data-acao-principal]');
    await page.waitForSelector('[data-resultado]');
    await conferirLeiaute(page, 'resultado');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}

test('foco visível no teclado, diálogo anunciado com retorno de foco e avisos em região aria-live', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 1280, telasDeTeste: TELAS_TESTE });
  const { page } = a;
  const vistos = new Set();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const f = await A.focoVisivel(page);
    assert.ok(f.ok, 'foco visível em ' + f.alvo + ': ' + f.outline);
    vistos.add(f.alvo);
  }
  assert.ok(vistos.size >= 3, 'percorreu elementos diferentes: ' + [...vistos].join(', '));
  await A.ir(page, 'evento/novo/ENTRADA_INICIAL', 'Rebanho inicial');
  await page.focus(cartoes + ' [data-campo="brinco"] input');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const radio = await A.focoVisivel(page);
  assert.ok(radio.ok && /LABEL/.test(radio.alvo), 'rádio mostra o foco no rótulo: ' + JSON.stringify(radio));
  const descartar = page.locator('.form-evento button:has-text("Descartar o rascunho")');
  await page.fill(cartoes + ' [data-campo="brinco"] input', '1');
  await descartar.focus();
  await page.keyboard.press('Enter');
  const dlg = page.locator('[role=dialog]');
  await dlg.waitFor();
  assert.equal(await dlg.getAttribute('aria-modal'), 'true');
  assert.ok(await page.evaluate(() => document.querySelector('[role=dialog]').contains(document.activeElement)), 'foco dentro do diálogo');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.querySelector('[role=dialog]').contains(document.activeElement)), 'foco preso no diálogo');
  await page.keyboard.press('Escape');
  await dlg.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Descartar o rascunho', 'foco volta a quem abriu');
  assert.equal(await page.getAttribute('#avisos', 'aria-live'), 'polite');
  await page.evaluate(() => window.UI.aviso('Teste de aviso', { tipo: 'ok' }));
  assert.match(await page.textContent('#avisos'), /Teste de aviso/);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('componentes: tabela ordenável e paginada vira cartões abaixo de 900 px; gráficos SVG de linha e barras com tabela equivalente', async () => {
  const s = A.sistema();
  const a = await A.abrir(s, { largura: 1280 });
  const { page } = a;
  const montar = () => page.evaluate(() => {
    const raiz = document.getElementById('conteudo');
    const caixa = document.createElement('div');
    caixa.id = 'teste-componentes';
    raiz.appendChild(caixa);
    const linhas = [];
    for (let i = 1; i <= 120; i++) linhas.push({ id: 'x' + i, brinco: String(i).padStart(4, '0'), peso: (i * 7) % 500 });
    window.__tab = window.UI.tabela({ rotulo: 'Animais', colunas: [{ id: 'brinco', rotulo: 'Brinco' }, { id: 'peso', rotulo: 'Peso', num: true, formatar: (l) => window.Fmt.peso(l.peso) }], linhas, porPagina: 50, chave: (l) => l.id });
    caixa.appendChild(window.__tab.el);
    caixa.appendChild(window.UI.grafico({ tipo: 'linha', titulo: 'Peso médio', rotuloX: 'Mês', formatar: (v) => window.Fmt.numero(v, 1), series: [{ nome: 'Lote 1', pontos: [{ x: '09/26', y: 380 }, { x: '10/26', y: null }, { x: '11/26', y: 412.5 }] }, { nome: 'Lote 2', pontos: [{ x: '11/26', y: 300 }] }] }));
    caixa.appendChild(window.UI.grafico({ tipo: 'barras', titulo: 'Nascimentos × mortes', rotuloX: 'Mês', series: [{ nome: 'Nascimentos', pontos: [{ x: 'out', y: 4 }, { x: 'nov', y: 2 }] }, { nome: 'Mortes', pontos: [{ x: 'out', y: 1 }, { x: 'nov', y: 0 }] }] }));
  });
  await montar();
  const t = '#teste-componentes';
  assert.equal(await page.locator(t + ' table.tabela tbody tr').first().locator('td').first().textContent(), '0001');
  assert.match(await page.textContent(t + ' .paginacao'), /Página 1 de 3 · 120 itens/);
  await page.click(t + ' th button:has-text("Peso")');
  assert.equal(await page.getAttribute(t + ' th:has(button:has-text("Peso"))', 'aria-sort'), 'ascending');
  await page.click(t + ' th button:has-text("Peso")');
  assert.equal(await page.getAttribute(t + ' th:has(button:has-text("Peso"))', 'aria-sort'), 'descending');
  assert.equal(await page.locator(t + ' table.tabela tbody tr td.num').first().textContent(), '497,0 kg');
  await page.click(t + ' .paginacao button:has-text("Próxima")');
  assert.match(await page.textContent(t + ' .paginacao'), /Página 2 de 3/);
  const graficos = page.locator(t + ' figure.grafico');
  assert.equal(await graficos.count(), 2);
  const linha = graficos.nth(0);
  assert.equal(await linha.locator('svg[role=img]').count(), 1);
  assert.equal(await linha.locator('polyline').count(), 0, 'com o buraco de outubro, nenhum trecho de 2 pontos seguidos');
  assert.match(await linha.textContent(), /Dados insuficientes para desenhar a linha de Lote 2/);
  assert.equal(await linha.locator('.grafico-tabela tbody tr').count(), 3, 'tabela equivalente: uma linha por mês');
  assert.deepEqual(await linha.locator('.grafico-tabela tbody tr').nth(1).locator('td').allTextContents(), ['—', '—']);
  const barras = graficos.nth(1);
  assert.equal(await barras.locator('rect').count(), 4);
  assert.deepEqual(await barras.locator('.grafico-tabela thead th').allTextContents(), ['Mês', 'Nascimentos', 'Mortes']);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForSelector(t + ' .lista-cartoes');
  assert.equal(await page.$(t + ' table.tabela:not(.grafico-tabela table)'), null);
  assert.equal(await page.locator(t + ' .lista-cartoes > li').count(), 50, 'cartões paginados no celular');
  await page.selectOption(t + ' .ordenacao-celular select', 'brinco:-1');
  assert.match(await page.locator(t + ' .lista-cartoes > li').first().textContent(), /0120/);
  const o = await A.semRolagemHorizontal(page);
  assert.ok(o.sw <= o.cw, JSON.stringify(o));
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
