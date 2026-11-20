'use strict';
/**
 * Importação e período financeiro fechado na tela (nível 3, Playwright; RN-082), a 1280 e a 360 px. Achado da passada 4
 * do teste aleatório: o desfazer da importação cancelava os lançamentos de uma compra importada dentro do período
 * fechado sem o aviso PERIODO_BLOQUEADO; agora o servidor pede o aviso (o aviso da trava, CONTRATOS 10.5, item 6) e a
 * tela mostra o "Vi e confirmo" com o campo da justificativa, que segue como `justificativa_aviso`. O mesmo no bloco
 * importado dentro do período: a justificativa vai em todo bloco. Sem rolagem horizontal, alvos de toque ≥ 48 px a
 * 360 px e nenhum erro no console. Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

test.after(() => A.fecharBrowser());

const dialogo = '[role=dialog]';
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
const MAPA = { colunas: { grupo: 'grupo', data: 'data', fornecedor: 'fornecedor', modalidade: 'modalidade', valor: 'valor_animais', preco: 'preco', brinco: 'brinco', sexo: 'sexo', pasto: 'pasto' }, confiancas: {}, padroes: { castrado: false, reprodutor: false } };
const CSV = 'grupo;data;fornecedor;modalidade;valor;preco;brinco;sexo;pasto\nC1;10/03/2026;Fornecedor;cabeça;5.000,00;2.500,00;301;F;Pasto A\nC1;;;;;;302;M;Pasto A';
async function textoTela(page, sel) { return (await page.textContent(sel)).replace(/\s+/g, ' ').trim(); }
async function semProblemasDeLeiaute(page, largura, onde) {
  const r = await A.semRolagemHorizontal(page);
  assert.ok(r.sw <= r.cw, onde + ': sem rolagem horizontal a ' + largura + ' px (' + r.sw + ' > ' + r.cw + ')');
  if (largura < 900) assert.deepEqual(await A.alvosDeToque(page, '#conteudo'), [], onde + ': alvos de toque');
}
const vigentesDe = (s, aba) => s.read({ rota: 't', reads: [aba], tratador: (tx) => tx.repo.vigentes(aba) });
function ok(s, pedido) {
  const r = s.api(pedido);
  if (!r.ok) throw new Error('semente recusada: ' + JSON.stringify(r.error));
  return r.data;
}
/** A compra de 10/03/2026 importada (2 animais, R$ 5.000,00) e validada; `concluir` a importa e conclui. */
function semearImportacao(s, concluir) {
  A.semear(s);
  ok(s, { rota: 'parceiro.salvar', idempotencyKey: 'ui-forn', dados: { campos: { nome: 'Fornecedor', tipos: 'FORNECEDOR' } } });
  const id = ok(s, { rota: 'importacao.criar', idempotencyKey: 'ui-imp', dados: { tipo: 'COMPRAS', arquivo_nome: 'compras.csv', texto: CSV, formato: FORMATO } }).import_id;
  ok(s, { rota: 'importacao.validarBloco', idempotencyKey: 'ui-val', dados: { import_id: id, bloco: 1, mapeamento: MAPA } });
  if (concluir) {
    ok(s, { rota: 'importacao.importarBloco', idempotencyKey: 'ui-b1', dados: { import_id: id, bloco: 1, modo: 'TOTAL' } });
    ok(s, { rota: 'importacao.concluir', idempotencyKey: 'ui-conc', dados: { import_id: id } });
  }
  ok(s, { rota: 'config.salvar', idempotencyKey: 'ui-bloq', dados: { valores: { fin_bloqueio_ate: '2026-06-30' } } });
  return id;
}

for (const largura of [1280, 360]) {
  test('desfazer a importação de uma compra dentro do período financeiro fechado: o aviso do período, o "Vi e confirmo" e a justificativa (' + largura + ' px)', async () => {
    const s = A.sistema();
    const id = semearImportacao(s, true);
    const a = await A.abrir(s, { largura, hash: 'importar/' + id + '/execucao' });
    const { page } = a;
    await page.waitForSelector('button:has-text("Desfazer importação")', { timeout: 20000 });
    await page.click('button:has-text("Desfazer importação")');
    await page.waitForSelector(dialogo + ' textarea');
    await page.fill(dialogo + ' textarea', 'Planilha errada');
    await page.click(dialogo + ' button:has-text("Desfazer a importação")');
    // O servidor pediu o aviso do período: nada gravado, o aviso com o lançamento e o campo da justificativa.
    await page.waitForSelector(dialogo + ' [data-avisos="desfazer"] [data-aviso="PERIODO_BLOQUEADO"]', { timeout: 20000 });
    assert.match(await textoTela(page, dialogo + ' [data-aviso="PERIODO_BLOQUEADO"]'), /Compra de 2 animais.*cancela.*10\/03\/2026, dentro do período financeiro fechado \(até 30\/06\/2026\)/);
    assert.equal(vigentesDe(s, 'IMPORTACOES')[0].status, 'IMPORTADO', 'o aviso não grava nada');
    await semProblemasDeLeiaute(page, largura, 'aviso do período no desfazer');
    // Sem marcar e sem justificativa, não envia.
    const antes = a.pedidos('importacao.desfazer').length;
    await page.click(dialogo + ' button:has-text("Desfazer a importação")');
    assert.equal(a.pedidos('importacao.desfazer').length, antes, 'sem o "Vi e confirmo" e a justificativa, nada vai ao servidor');
    await page.check(dialogo + ' #desf-av-0');
    await page.fill(dialogo + ' #desf-just-aviso', 'Nota fiscal cancelada pelo fornecedor');
    await page.click(dialogo + ' button:has-text("Desfazer a importação")');
    await page.waitForSelector('[data-relatorio="CANCELADO"]', { timeout: 20000 });
    const ult = a.pedidos('importacao.desfazer').pop();
    assert.deepEqual(ult.avisosAceitos, ['PERIODO_BLOQUEADO']);
    assert.equal(ult.dados.justificativa_aviso, 'Nota fiscal cancelada pelo fornecedor');
    assert.equal(ult.dados.justificativa, 'Planilha errada');
    const op = s.read({ rota: 't', reads: ['OPERACOES'], tratador: (tx) => tx.repo.vigentes('OPERACOES').filter((o) => o.comando === 'importacao.desfazer') })[0];
    assert.deepEqual(op.resumo_json.avisos_aceitos, [{ codigo: 'PERIODO_BLOQUEADO', justificativa: 'Nota fiscal cancelada pelo fornecedor' }], 'a justificativa fica na operação');
    assert.ok(vigentesDe(s, 'FINANCEIRO').every((f) => f.status === 'CANCELADO'), 'a compra desfeita deixa de valer');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}

test('importar uma compra dentro do período financeiro fechado: o aviso do bloco pede a justificativa, que vai no comando (1280 px)', async () => {
  const s = A.sistema();
  const id = semearImportacao(s, false);
  const a = await A.abrir(s, { largura: 1280, hash: 'importar/' + id + '/confirmacao' });
  const { page } = a;
  const importarB = page.locator('#conteudo button', { hasText: /^Importar/ }).last();
  await importarB.waitFor({ timeout: 20000 });
  await importarB.click();
  await page.waitForSelector('[data-aviso="PERIODO_BLOQUEADO"]', { timeout: 20000 });
  const seguir = page.locator('button:has-text("Confirmar mesmo assim")');
  await page.check('#imp-av-0');
  assert.ok(await seguir.isDisabled(), 'sem a justificativa, não segue');
  await page.fill('#imp-just-aviso', 'Compra lançada com atraso');
  assert.ok(!(await seguir.isDisabled()));
  await seguir.click();
  await page.waitForSelector('[data-relatorio="IMPORTADO"]', { timeout: 20000 });
  const blocos = a.pedidos('importacao.importarBloco');
  assert.deepEqual(blocos.pop().dados.justificativa_aviso, 'Compra lançada com atraso');
  assert.equal(vigentesDe(s, 'EVENTOS').filter((e) => e.event_type === 'COMPRA')[0].payload_json.avisos_aceitos[0].justificativa, 'Compra lançada com atraso');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
