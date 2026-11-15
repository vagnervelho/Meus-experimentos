'use strict';
/**
 * Revisão independente da Fase 2, rodada 3, lentes INTERFACE E REGRAS e CORREÇÕES ANTERIORES (nível 3, Playwright,
 * backend real do harness): cada achado confirmado vira um teste que falhava antes do conserto — o rascunho no servidor
 * (sem localStorage) que não podia ser guardado sem a tela dizer, a correção com item de lista e parceiro desativados,
 * a confirmação do desfazer de uma importação de eventos e o rascunho ENVIANDO na Visão geral. Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const dialogo = '[role=dialog]';
const txt = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
const vigentes = (s, aba) => s.read({ rota: 't', reads: [aba], tratador: (tx) => tx.repo.vigentes(aba) });
const ok = (r) => { if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data; };
function parceiro(s, nome, tipos) { return ok(s.api({ rota: 'parceiro.salvar', idempotencyKey: 'p-' + nome, dados: { campos: { nome, tipos } } })).partner_id; }
const porBrinco = (sem, b) => sem.animais.find((x) => x.brinco === b).animal_id;
// O que a página registra de propósito: o aparelho sem localStorage e a falha de envio que o teste provoca.
const semArmazem = (erros) => erros.filter((e) => !/armazenamento local indisponível|\[ERP\] rascunho no servidor: Sem conexão/.test(e));

test('R3 achado 7: sem localStorage, o rascunho de 80 animais é guardado no servidor (em partes) e a tela só diz "guardado" depois da confirmação; a falha do envio adiado aparece', async () => {
  const s = A.sistema();
  A.semear(s);
  const forn = parceiro(s, 'Leilão', ['FORNECEDOR']);
  const a = await A.abrir(s, { largura: 360, hash: 'evento/novo/COMPRA', semLocalStorage: true });
  const { page } = a;
  assert.equal(await page.evaluate(() => window.Rascunhos.modo()), 'SERVIDOR');
  await A.esperarTela(page, 'Comprar animais');
  await page.fill('[data-campo="event_date"] input', '2026-03-10');
  await page.locator('[data-campo="partner_id"] select').selectOption(forn);
  await page.locator('[data-campo="modalidade"] select').selectOption('CABECA');
  await page.fill('[data-campo="valor_animais"] input', '240.000,00');
  await page.click('[data-grade="serie"]');
  await page.waitForSelector('[data-folha-serie]');
  await page.fill('[data-folha-serie] [data-campo="quantidade"] input', '80');
  await page.fill('[data-folha-serie] [data-campo="brinco_inicial"] input', '0801');
  await page.locator('[data-folha-serie] [data-campo="sexo"] label.opcao', { hasText: 'Macho' }).click();
  await page.locator('[data-folha-serie] [data-campo="castrado"] label.opcao', { hasText: 'Não' }).click();
  await page.locator('[data-folha-serie] [data-campo="reprodutor"] label.opcao', { hasText: 'Não' }).click();
  await page.fill('[data-folha-serie] [data-campo="idade_meses"] input', '14');
  await page.fill('[data-folha-serie] [data-campo="peso"] input', '280');
  await page.click(dialogo + ' [data-acao-principal]');
  await A.ir(page, 'inicio', 'Início');
  await page.waitForFunction(() => /Rascunho guardado no servidor/.test(document.getElementById('avisos').textContent), null, { timeout: 15000 });
  const guardado = s.api({ rota: 'rascunho.obter', dados: { chave: 'r.evento.COMPRA' } });
  assert.equal(guardado.ok, true, JSON.stringify(guardado.error));
  assert.equal(guardado.data.existe, true);
  assert.equal(guardado.data.conteudo.linhas.length, 80, 'os 80 animais voltam do servidor');
  assert.equal(await page.$('[data-faixa="rascunho-falhou"]'), null);
  // Sem conexão no envio adiado: a faixa avisa e a saída diz que o rascunho não foi guardado.
  await A.ir(page, 'evento/novo/COMPRA', 'Comprar animais');
  await page.evaluate(() => { window.__gas.falharTransporte = 20; });
  await page.fill('[data-campo="nota_fiscal"] input', 'NF-77');
  await page.waitForSelector('[data-faixa="rascunho-falhou"]', { timeout: 15000 });
  assert.match(await txt(page, '[data-faixa="rascunho-falhou"]'), /Não foi possível guardar o rascunho .*Não feche esta tela antes de gravar/);
  await A.ir(page, 'inicio', 'Início');
  await page.waitForFunction(() => /O rascunho não pôde ser guardado no servidor/.test(document.getElementById('avisos').textContent), null, { timeout: 15000 });
  assert.doesNotMatch(await txt(page, '#avisos'), /NF-77.*guardado no servidor/);
  assert.notEqual(s.api({ rota: 'rascunho.obter', dados: { chave: 'r.evento.COMPRA' } }).data.conteudo.campos.nota_fiscal, 'NF-77', 'o servidor não recebeu a última mudança');
  await page.evaluate(() => { window.__gas.falharTransporte = 0; });
  assert.deepEqual(semArmazem(a.estado.erros), []);
  await a.fechar();
});

test('R3 achado 13: correção de venda com dedução, forma de pagamento e comprador desativados: os nomes de verdade com "— desativado" e a revisão abre', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const comp = parceiro(s, 'Frigorífico Boi Bom', ['COMPRADOR']);
  const boi = porBrinco(sem, '12');
  const v = s.registrar({ tipo: 'VENDA', campos: { event_date: '2026-08-10', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 },
    animais: [{ animal_id: boi }], parcelas: [{ data_vencimento: '2026-09-10', forma_pagamento: 'BOLETO' }], deducoes: [{ tipo: 'SENAR', valor: 600 }] }, 'venda-1');
  const listas = vigentes(s, 'LISTAS');
  const item = (l, c) => listas.find((x) => x.lista === l && x.codigo === c);
  ok(s.api({ rota: 'lista.salvar', idempotencyKey: 'l1', dados: { lista_id: item('TIPO_DEDUCAO_VENDA', 'SENAR').lista_id, ativo: false } }));
  ok(s.api({ rota: 'lista.salvar', idempotencyKey: 'l2', dados: { lista_id: item('FORMA_PAGAMENTO', 'BOLETO').lista_id, ativo: false } }));
  ok(s.api({ rota: 'parceiro.salvar', idempotencyKey: 'p2', dados: { partner_id: comp, campos: { nome: 'Frigorífico Boi Bom', tipos: ['COMPRADOR'], ativo: false } } }));
  const a = await A.abrir(s, { largura: 360, hash: 'evento/' + v.event_id });
  const { page } = a;
  await A.esperarTela(page, 'Vender');
  await page.click('[data-acoes-evento] button:has-text("Corrigir")');
  await A.esperarTela(page, 'Corrigir');
  const sel = async (escopo, campo) => page.locator(escopo + ' [data-campo="' + campo + '"] select').first().evaluate((el) => el.options[el.selectedIndex].text);
  assert.equal(await sel('.form-evento', 'partner_id'), 'Frigorífico Boi Bom — desativado');
  assert.match(await sel('[data-grupo="deducoes"]', 'tipo'), /— desativado$/);
  assert.match(await sel('[data-grupo="parcelas"]', 'forma_pagamento'), /— desativado$/);
  assert.doesNotMatch(await txt(page, '.form-evento'), /Valor anterior \(/);
  await page.fill('[data-campo="valor_bruto"] input', '3.100,00');
  await page.fill('[data-campo="preco_unitario"] input', '3.100,00');
  await page.fill('[data-campo="justificativa_correcao"] textarea, [data-campo="justificativa_correcao"] input', 'preço errado');
  await page.click('.form-evento button[type=submit]');
  await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])', { timeout: 15000 });
  assert.doesNotMatch(await txt(page, '#conteudo'), /campos para corrigir|Escolha uma das opções da lista/);
  await page.click(dialogo + ' [data-acao-principal]');
  await page.waitForFunction(() => /Correção gravada/.test(document.getElementById('avisos').textContent) || !!document.querySelector('[data-resultado]'), null, { timeout: 15000 });
  assert.equal(vigentes(s, 'VENDAS').find((x) => x.event_id !== v.event_id).valor_bruto, 310000);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('R3 achado 16: desfazer uma importação de transferências: a confirmação fala dos lançamentos, não de animais que deixam de valer', async () => {
  const s = A.sistema();
  A.semear(s);
  const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
  const imp = ok(s.api({ rota: 'importacao.criar', idempotencyKey: 'ic', avisosAceitos: ['POSSIVEL_DUPLICIDADE'], dados: { tipo: 'TRANSFERENCIAS', arquivo_nome: 't.csv', conteudo_base64: Buffer.from('Data;Pasto de origem;Pasto de destino;Brinco\n05/02/2026;Pasto B;Pasto A;0391', 'utf8').toString('base64'), formato: FORMATO } }));
  const mapa = { colunas: { Data: 'data', 'Pasto de origem': 'pasto_origem', 'Pasto de destino': 'pasto_destino', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
  ok(s.api({ rota: 'importacao.validarBloco', idempotencyKey: 'iv', dados: { import_id: imp.import_id, bloco: 1, mapeamento: mapa } }));
  ok(s.api({ rota: 'importacao.importarBloco', idempotencyKey: 'ib', avisosAceitos: [], dados: { import_id: imp.import_id, bloco: 1, modo: 'TOTAL' } }));
  ok(s.api({ rota: 'importacao.concluir', idempotencyKey: 'ik', dados: { import_id: imp.import_id } }));
  const a = await A.abrir(s, { largura: 1280, hash: 'importar/' + imp.import_id + '/execucao' });
  const { page } = a;
  await page.waitForSelector('button:has-text("Desfazer importação")', { timeout: 15000 });
  await page.click('button:has-text("Desfazer importação")');
  await page.waitForSelector(dialogo + ' .nota-aviso');
  const nota = await txt(page, dialogo + ' .nota-aviso');
  assert.match(nota, /O lançamento desta importação deixa de valer/);
  assert.doesNotMatch(nota, /animais desta importação deixam de valer/);
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('R3 achado 20: na Visão geral, o rascunho ENVIANDO não é "não concluído" e o Descartar pergunta ao servidor antes de apagar', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const b12 = porBrinco(sem, '12');
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
  await page.evaluate(() => window.Roteador.ir('inicio'));
  await page.waitForSelector('[data-rascunho="VENDA"]', { timeout: 15000 });
  const linha = await txt(page, '[data-rascunho="VENDA"]');
  assert.match(linha, /enviado sem resposta do servidor/);
  assert.doesNotMatch(linha, /não concluído/);
  // Sem conexão: Descartar não apaga.
  await page.click('[data-rascunho="VENDA"] button:has-text("Descartar")');
  await page.waitForSelector(dialogo);
  assert.match(await txt(page, dialogo), /pergunta ao servidor se ele foi gravado/);
  await page.evaluate(() => { window.__gas.falharTransporte = 3; });
  await page.click(dialogo + ' button:has-text("Descartar o rascunho")');
  await page.waitForFunction(() => /Ainda não sabemos se o registro foi gravado/.test(document.getElementById('avisos').textContent), null, { timeout: 15000 });
  assert.deepEqual(await page.evaluate(async () => (await window.Rascunhos.listar()).map((r) => [r.tipo, r.estado])), [['VENDA', 'ENVIANDO']], 'mantido');
  // Com conexão: o servidor diz que gravou; nada se apaga às cegas e o resultado aparece.
  await page.evaluate(() => { window.__gas.falharTransporte = 0; });
  const statusAntes = a.pedidos('operacao.status').length;
  await page.click('[data-rascunho="VENDA"] button:has-text("Descartar")');
  await page.waitForSelector(dialogo + ' button:has-text("Descartar o rascunho")');
  await page.click(dialogo + ' button:has-text("Descartar o rascunho")');
  await page.waitForFunction(() => /já estava gravado no servidor: nada foi apagado/.test(document.getElementById('avisos').textContent), null, { timeout: 15000 });
  assert.ok(a.pedidos('operacao.status').length > statusAntes, 'operacao.status foi chamado');
  assert.equal(vigentes(s, 'EVENTOS').filter((e) => e.event_type === 'VENDA').length, 1, 'nada foi duplicado');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
