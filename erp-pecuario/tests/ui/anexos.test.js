'use strict';
/**
 * Documentos e fotos do lançamento na tela (nível 3, Playwright; E2.9): no detalhe de uma compra, anexar a nota fiscal ao
 * lançamento todo e o boleto ao lançamento do frete (a escolha "O arquivo é de"), ver o arquivo na lista e no lançamento
 * financeiro, recusar no aparelho o tipo de arquivo que o servidor não aceita, abrir como data URL, remover com
 * justificativa; estornada a compra, os arquivos ficam como histórico (só abrir: sem anexar nem remover). A 360 px, sem
 * rolagem horizontal, alvos de toque ≥ 48 px e nenhum erro no console. Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const dialogo = '[role=dialog]';
const secao = '[data-secao="anexos"]';
const pdf = (texto) => Buffer.from('%PDF-1.4 ' + texto, 'utf8');
async function textoTela(page, sel) { return (await page.textContent(sel)).replace(/\s+/g, ' ').trim(); }
const vigentesDe = (s, aba) => s.read({ rota: 't', reads: [aba], tratador: (tx) => tx.repo.vigentes(aba) });
function parceiro(s, nome, tipos) {
  const r = s.api({ rota: 'parceiro.salvar', idempotencyKey: 'p-' + nome, dados: { campos: { nome, tipos } } });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data.partner_id;
}
async function semProblemasDeLeiaute(page, onde) {
  const r = await A.semRolagemHorizontal(page);
  assert.ok(r.sw <= r.cw, onde + ': sem rolagem horizontal a 360 px (' + r.sw + ' > ' + r.cw + ')');
  assert.deepEqual(await A.alvosDeToque(page, '#conteudo'), [], onde + ': alvos de toque');
}
async function abrirEnvio(page) {
  await page.click(secao + ' button:has-text("Anexar nota fiscal, GTA, laudo ou foto")');
  await page.waitForSelector(dialogo + ' [data-cadastro="anexo.adicionar"]');
}
async function escolherArquivo(page, nome, mimeType, buffer) {
  await page.setInputFiles(dialogo + ' input[type=file]', { name: nome, mimeType, buffer });
}

test('compra: nota fiscal no lançamento, boleto no frete, tipo recusado no aparelho, abrir, remover com justificativa; estornada, só o histórico (360 px)', async () => {
  const s = A.sistema();
  const forn = parceiro(s, 'Leilão Rondônia', ['FORNECEDOR']);
  const c = s.registrar({
    tipo: 'COMPRA', campos: { event_date: '2026-02-05', partner_id: forn, pasto_destino_id: S.PASTOS.A, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 600000 },
    animais: ['0801', '0802'].map((b) => ({ brinco: b, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 })),
    parcelas: [{ data_vencimento: '2026-03-05' }], custos: [{ tipo: 'FRETE', valor: 3000 }],
  }, 'compra-anexos');
  const fins = s.api({ rota: 'evento.obter', dados: { event_id: c.event_id } }).data.detalhes.FINANCEIRO;
  const frete = fins[1];
  const a = await A.abrir(s, { largura: 360, hash: 'evento/' + c.event_id });
  const { page } = a;
  await A.esperarTela(page, 'Comprar animais');
  await page.waitForSelector(secao);
  assert.match(await textoTela(page, secao), /Nenhum arquivo neste lançamento/);
  // Nota fiscal do lançamento todo (o padrão na compra é nota fiscal; "O arquivo é de": o lançamento todo).
  await abrirEnvio(page);
  await escolherArquivo(page, 'nf-000123.pdf', 'application/pdf', pdf('nota'));
  await page.waitForFunction(() => /Arquivo: nf-000123\.pdf/.test(document.querySelector('[data-cadastro="anexo.adicionar"]').textContent));
  assert.equal(await page.inputValue(dialogo + ' [data-campo="tipo"] select'), 'NOTA_FISCAL');
  await page.fill(dialogo + ' [data-campo="descricao"] input', 'NF 000123');
  await page.click(dialogo + ' [data-acao-principal]');
  await page.waitForSelector(dialogo, { state: 'detached' });
  await page.waitForSelector(secao + ' [data-anexo]');
  const p1 = a.pedidos('anexo.adicionar')[0].dados;
  assert.deepEqual([p1.entidade, p1.entity_id, p1.tipo, p1.mime_type, p1.descricao], ['EVENTOS', c.event_id, 'NOTA_FISCAL', 'application/pdf', 'NF 000123']);
  // Boleto do frete: ligado ao lançamento financeiro do frete.
  await abrirEnvio(page);
  await escolherArquivo(page, 'boleto-frete.pdf', 'application/pdf', pdf('boleto'));
  await page.waitForFunction(() => /Arquivo: boleto-frete\.pdf/.test(document.querySelector('[data-cadastro="anexo.adicionar"]').textContent));
  await page.selectOption(dialogo + ' [data-campo="tipo"] select', 'DOCUMENTO');
  await page.click(dialogo + ' [data-campo="ligar_a"] label.opcao:has-text("Frete da compra")');
  await page.click(dialogo + ' [data-acao-principal]');
  await page.waitForSelector(dialogo, { state: 'detached' });
  await page.waitForFunction(() => document.querySelectorAll('[data-secao="anexos"] [data-anexo]').length === 2);
  const p2 = a.pedidos('anexo.adicionar')[1].dados;
  assert.deepEqual([p2.entidade, p2.entity_id, p2.tipo], ['FINANCEIRO', frete.financial_id, 'DOCUMENTO']);
  assert.match(await textoTela(page, '[data-secao="financeiro"] [data-lancamento="' + frete.financial_id + '"]'), /Arquivos: boleto-frete\.pdf/);
  assert.match(await textoTela(page, secao), /Documento ou laudo · de Frete da compra/);
  const anexos = vigentesDe(s, 'ANEXOS');
  assert.deepEqual(anexos.map((x) => [x.entidade, x.event_id]).sort(), [['EVENTOS', c.event_id], ['FINANCEIRO', c.event_id]]);
  await semProblemasDeLeiaute(page, 'documentos do lançamento');
  // Tipo de arquivo que o servidor não aceita: recusado no aparelho, nada enviado.
  await abrirEnvio(page);
  await escolherArquivo(page, 'planilha.txt', 'text/plain', Buffer.from('a;b'));
  await page.waitForFunction(() => /não é aceito/.test(document.querySelector('[data-cadastro="anexo.adicionar"]').textContent));
  await page.keyboard.press('Escape');
  await page.waitForSelector(dialogo, { state: 'detached' });
  assert.equal(a.pedidos('anexo.adicionar').length, 2);
  // Abrir: o documento vem como data URL para baixar (nunca URL do Drive).
  const nf = anexos.find((x) => x.entidade === 'EVENTOS');
  await page.click('[data-anexo="' + nf.anexo_id + '"] button:has-text("Abrir")');
  await page.waitForSelector(dialogo + ' a[download="nf-000123.pdf"][href^="data:application/pdf;base64,"]');
  await page.keyboard.press('Escape');
  await page.waitForSelector(dialogo, { state: 'detached' });
  // Remover pede justificativa.
  await page.click('[data-anexo="' + nf.anexo_id + '"] button:has-text("Remover")');
  await page.waitForSelector(dialogo + ' textarea');
  await page.click(dialogo + ' [data-acao-principal]');
  await page.waitForSelector(dialogo + ' [data-campo="justificativa"] .campo-erro:not([hidden])');
  await page.fill(dialogo + ' textarea', 'Nota de outra compra');
  await page.click(dialogo + ' [data-acao-principal]');
  await page.waitForSelector(dialogo, { state: 'detached' });
  await page.waitForFunction(() => document.querySelectorAll('[data-secao="anexos"] [data-anexo]').length === 1);
  assert.equal(vigentesDe(s, 'ANEXOS').find((x) => x.anexo_id === nf.anexo_id).status, 'REMOVIDO');
  assert.equal(a.pedidos('anexo.remover')[0].dados.justificativa, 'Nota de outra compra');
  // Estornada a compra, o boleto fica como histórico: abre, mas não há anexar nem remover.
  const est = s.api({ rota: 'evento.estornar', idempotencyKey: 'est-anexos', dados: { event_id: c.event_id, justificativa: 'Compra desfeita' } });
  assert.equal(est.ok, true);
  await A.ir(page, 'eventos', 'Eventos');
  await A.ir(page, 'evento/' + c.event_id, 'Comprar animais');
  await page.waitForSelector(secao + ' [data-anexo]');
  assert.match(await textoTela(page, secao), /não vale mais: os arquivos dele ficam guardados como histórico/);
  assert.equal(await page.locator(secao + ' button:has-text("Anexar")').count(), 0);
  assert.equal(await page.locator(secao + ' button:has-text("Remover")').count(), 0);
  await page.click(secao + ' [data-anexo] button:has-text("Abrir")');
  await page.waitForSelector(dialogo + ' a[download="boleto-frete.pdf"]');
  assert.match(await textoTela(page, dialogo), /guardado como histórico/);
  await page.keyboard.press('Escape');
  await semProblemasDeLeiaute(page, 'histórico do estornado');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
