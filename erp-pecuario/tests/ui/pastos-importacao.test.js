'use strict';
/**
 * Pastos em data, importação de eventos e anexos do formulário na tela (nível 3, Playwright; E2.8 a E2.10), a 1280 e
 * a 360 px: a lista de pastos na "posição em [data]" (pasto.listar com a data), com UA, UA/ha e ocupação e o "Sem
 * dado" com o motivo, e o painel abrindo na mesma data; a importação de compras pelo assistente (modelo do tipo para
 * baixar, colunas, validação, "Deixar de fora" no lançamento inteiro, confirmação parcial com os números, relatório
 * final com a reconciliação em tabela, a mesma reconciliação pela lista de importações); a GTA escolhida no formulário
 * da transferência, enviada ao lançamento depois de gravar (com falha e "Tentar de novo") e vista no detalhe. Sem rolagem
 * horizontal, alvos de toque ≥ 48 px a 360 px e nenhum erro no console. Roda por `npm run ui:check`.
 */
const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const dialogo = '[role=dialog]';
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
/** O rebanho do apoio (3 no A, 1 no B); em 01/03 0457 e 12 vão para o B; compra de 2 pesados no A em 01/10 (pesagem em dia); o A tem área e capacidade. */
function semearPastos(s) {
  const sem = A.semear(s);
  const id = (b) => sem.animais.filter((x) => x.brinco === b)[0].animal_id;
  const forn = ok(s, { rota: 'parceiro.salvar', idempotencyKey: 'ui-forn', dados: { campos: { nome: 'Fornecedor', tipos: 'FORNECEDOR' } } }).partner_id;
  s.registrar({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: id('0457') }, { animal_id: id('12') }] }, 'ui-t');
  s.registrar({ tipo: 'COMPRA', campos: { event_date: '2026-10-01', partner_id: forn, pasto_destino_id: S.PASTOS.A, modalidade: 'CABECA', preco_unitario: 250000, valor_animais: 500000 },
    animais: [{ brinco: 'C1', sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14, peso: 280, metodo_pesagem: 'BALANCA' }, { brinco: 'C2', sexo: 'F', idade_meses: 14, peso: 260, metodo_pesagem: 'BALANCA' }], parcelas: [{ data_vencimento: '2026-11-01' }] }, 'ui-c');
  ok(s, { rota: 'pasto.salvar', idempotencyKey: 'ui-pa', dados: { pasture_id: S.PASTOS.A, campos: { area_hectares: 2, capacidade_estimada_ua_ha: 1 } } });
  return { id };
}
const cartao = (id) => '[data-pasto="' + id + '"]';

for (const largura of [1280, 360]) {
  test('pastos na posição em uma data: UA, UA/ha e ocupação com "Sem dado" e o motivo; o painel abre na mesma data; antes do marco zero (' + largura + ' px)', async () => {
    const s = A.sistema();
    semearPastos(s);
    const a = await A.abrir(s, { largura, hash: 'pastos' });
    const { page } = a;
    await A.esperarTela(page, 'Pastos');
    assert.match(await textoTela(page, '[data-posicao-em]'), /Situação de hoje/);
    // Hoje (do aparelho): A com o sem brinco e os dois comprados (540 kg = 1,20 UA em 2 ha); B sem área nem capacidade e sem peso.
    assert.match(await textoTela(page, cartao(S.PASTOS.A)), /Cabeças\s*3\s*UA\s*1,20\s*UA\/ha\s*0,60\s*Ocupação\s*60% \(por UA\/ha\)/);
    assert.match(await textoTela(page, cartao(S.PASTOS.B)), /UA\s*Sem dado \(nenhum animal do pasto tem peso conhecido\)/);
    assert.match(await textoTela(page, cartao(S.PASTOS.B)), /Ocupação\s*Sem dado \(o pasto não tem capacidade informada\)/);
    assert.equal(a.pedidos('pasto.listar').length, 0, 'hoje vem da carga inicial');
    await semProblemasDeLeiaute(page, largura, 'pastos hoje');
    // Em 15/02 (antes da transferência e da compra): 3 no A, nenhum com peso; 1 no B.
    await page.fill('#pst-lista-data', '2026-02-15');
    await page.click('[data-posicao] button:has-text("Ver")');
    await page.waitForFunction(() => /Posição em 15\/02\/2026/.test(document.querySelector('[data-posicao-em]').textContent));
    assert.deepEqual(a.pedidos('pasto.listar').pop().dados, { data: '2026-02-15', incluir_inativos: true });
    assert.match(await textoTela(page, cartao(S.PASTOS.A)), /Cabeças\s*3\s*UA\s*Sem dado \(nenhum animal do pasto tem peso conhecido\)/);
    assert.match(await textoTela(page, cartao(S.PASTOS.B)), /Cabeças\s*1/);
    assert.match(await textoTela(page, cartao(S.PASTOS.B)), /UA\/ha\s*Sem dado \(nenhum animal do pasto tem peso conhecido\)/);
    await semProblemasDeLeiaute(page, largura, 'pastos em data passada');
    // O painel abre na data escolhida (a data fica na memória da tela, não na rota).
    await page.click(cartao(S.PASTOS.B) + ' a:has-text("Abrir painel")');
    await A.esperarTela(page, 'Pasto B');
    await page.waitForSelector('[data-secao="composicao"]');
    assert.equal(await page.inputValue('#pst-data'), '2026-02-15');
    assert.match(await textoTela(page, '[data-secao="composicao"]'), /Composição em 15\/02\/2026\s*Cabeças\s*1/);
    assert.equal(a.pedidos('pasto.painel').pop().dados.data, '2026-02-15');
    assert.equal(await page.$('[data-atalho-pasto]'), null, 'atalhos de registro só na posição de hoje');
    assert.match(await textoTela(page, '[data-secao="lotacao"]'), /informe a área e a capacidade do pasto/);
    // Antes do marco zero: nada inventado.
    await page.fill('#pst-data', '2025-12-31');
    await page.click('[data-posicao] button:has-text("Ver")');
    await page.waitForFunction(() => /Sem dado em 31\/12\/2025: a data é anterior ao marco zero, 01\/01\/2026/.test(document.getElementById('conteudo').textContent));
    await A.ir(page, 'pastos', 'Pastos');
    await page.waitForFunction(() => /Posição em 31\/12\/2025/.test(document.querySelector('[data-posicao-em]').textContent));
    assert.match(await textoTela(page, cartao(S.PASTOS.A)), /Cabeças\s*Sem dado \(a data é anterior ao marco zero, 01\/01\/2026\)/);
    assert.deepEqual(a.estado.erros, [], 'nenhum erro no console');
    await a.fechar();
  });
}

const COMPRAS = [
  'Nº da compra;Data da compra;Fornecedor;Como foi o preço;Preço (R$);Valor dos animais (R$);Brinco;Sexo;Idade (meses);Castrado;Reprodutor;Pasto',
  'C1;10/02/2026;Fazenda Vizinha;cabeça;2.000,00;4.000,00;200;M;14;N;N;Pasto A',
  'C1;;;;;;201;M;14;N;N;Pasto A',
  'C2;20/02/2026;Fazenda Vizinha;cabeça;2.100,00;2.100,00;203;M;12;S;N;Pasto A',
  'C0;15/03/2025;Fazenda Vizinha;cabeça;1.800,00;1.800,00;0457;;;;;Pasto B',
].join('\r\n');

for (const largura of [1280, 360]) {
  test('importar compras: modelo do tipo, validação, deixar de fora um lançamento inteiro, parcial com os números, reconciliação em tabela, também pela lista (' + largura + ' px)', async () => {
    const s = A.sistema();
    A.semear(s);
    ok(s, { rota: 'parceiro.salvar', idempotencyKey: 'p-viz', dados: { campos: { nome: 'Fazenda Vizinha', tipos: ['FORNECEDOR'] } } });
    const a = await A.abrir(s, { largura, hash: 'importar/novo' });
    const { page } = a;
    await A.esperarTela(page, 'Importar animais');
    await page.selectOption('select[id^="imp-tipo-"]', 'COMPRAS');
    await page.waitForFunction(() => /Importar compras de animais/.test(document.querySelector('#conteudo h1').textContent));
    await page.waitForFunction(() => /Nº da compra/.test(document.querySelector('#conteudo details.detalhe').textContent), null, { timeout: 10000 });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Baixar o modelo da planilha")')]);
    assert.equal(dl.suggestedFilename(), 'modelo-importacao-compras.csv');
    const modelo = fs.readFileSync(await dl.path(), 'utf8');
    assert.equal(modelo.charCodeAt(0), 0xfeff, 'BOM');
    assert.match(modelo, /^﻿Nº da compra;Data da compra;Fornecedor;/);
    await page.setInputFiles('#imp-arquivo', { name: 'compras.csv', mimeType: 'text/csv', buffer: Buffer.from(COMPRAS, 'utf8') });
    await page.click('button:has-text("Ler o arquivo")');
    await page.waitForSelector('[data-mapeamento]');
    assert.equal(await page.inputValue('[data-coluna="Nº da compra"]'), 'grupo');
    assert.equal(await page.inputValue('[data-coluna="Valor dos animais (R$)"]'), 'valor_animais');
    await page.selectOption('#conf-data_nascimento', 'ESTIMADA');
    await page.click('button:has-text("Validar o arquivo")');
    await page.waitForSelector('[data-secao="resultado"]');
    assert.match(await textoTela(page, '[data-secao="resultado"]'), /Linhas no arquivo\s*4\s*Válidas\s*4\s*Com erro\s*0/);
    const linhas = await textoTela(page, '[data-secao="linhas"]');
    assert.match(linhas, /Fornecedor: Fazenda Vizinha/, 'o que o sistema entendeu, em palavras');
    assert.match(linhas, /lançamento das linhas 2, 3/);
    await semProblemasDeLeiaute(page, largura, 'validação');
    // Deixar de fora a linha 3 leva a compra C1 inteira (linhas 2 e 3).
    await page.click('label[for="fora-3"]');
    assert.equal(await page.isChecked('#fora-2'), true, 'a outra linha do lançamento vai junto');
    assert.match(await textoTela(page, '[data-deixadas]'), /Deixadas de fora por você: 2 linhas \(2, 3\)/);
    await page.click('label[for="fora-2"]');
    assert.equal(await page.isChecked('#fora-3'), false, 'e volta junto');
    assert.equal(await page.getAttribute('[data-deixadas]', 'data-deixadas'), '0');
    await page.click('label[for="fora-2"]');
    await page.click('a:has-text("Continuar para a confirmação")');
    await page.waitForSelector('[data-secao="confirmacao"]');
    assert.match(await textoTela(page, '[data-secao="totais"]'), /Linhas que vão entrar\s*2\s*Linhas que ficam de fora\s*2 \(0 com problema; 2 deixadas de fora por você: linhas 2, 3\)/);
    const importarB = page.locator('button:has-text("Importar 2 linhas")');
    assert.equal(await importarB.isDisabled(), true, 'parcial só com a aprovação');
    assert.match(await textoTela(page, '[data-secao="confirmacao"]'), /Você deixou de fora 2 linhas válidas/);
    await page.click('label[for="imp-parcial"]');
    await importarB.click();
    await page.waitForSelector('[data-relatorio="IMPORTADO"]', { timeout: 20000 });
    const bloco1 = a.pedidos('importacao.importarBloco').filter((p) => p.dados.bloco === 1)[0];
    assert.deepEqual([bloco1.dados.modo, bloco1.dados.aprovacao, bloco1.dados.ignorar_linhas], ['PARCIAL_APROVADO', { importar: 2, ignorar: 2 }, [2, 3]]);
    assert.match(await textoTela(page, '[data-relatorio]'), /2 lançamentos entraram, com 1 animal novo/);
    assert.match(await textoTela(page, '[data-secao="relatorio"]'), /Deixadas de fora\s*2/);
    // Reconciliação legível: a compra antiga da 0457 põe a vaca no Pasto B, a fotografia do marco zero no A.
    const rec = await textoTela(page, '[data-secao="reconciliacao"]');
    assert.match(rec, /Animais na fotografia do marco zero\s*4/);
    assert.match(rec, /Pasto diferente: O animal de brinco 0457: o último pasto do histórico é Pasto B \(15\/03\/2025\), mas a fotografia do marco zero o põe no Pasto A/);
    assert.match(rec, /no rebanho, Pasto A/);
    assert.match(rec, /no rebanho, Pasto B/);
    assert.ok(await page.$('[data-reconciliacao="pastos"]'), 'pastos com contagem diferente');
    assert.ok(await page.$('[data-secao="reconciliacao"] a:has-text("Abrir a compra de 15/03/2025")'), 'o registro que explica, com link');
    await semProblemasDeLeiaute(page, largura, 'relatório com reconciliação');
    const ativos = vigentesDe(s, 'ANIMAIS').filter((x) => x.situacao_cadastral === 'ATIVO').map((x) => x.brinco).filter(Boolean).sort();
    assert.deepEqual(ativos, ['0391', '0457', '12', '203'], 'a compra deixada de fora não entrou');
    // A mesma reconciliação, sem gravar, pela lista de importações.
    await A.ir(page, 'importar', 'Importação');
    await page.click('[data-secao="reconciliacao"] button:has-text("Conferir agora")');
    await page.waitForSelector('[data-secao="reconciliacao"] [data-reconciliacao="animais"]');
    assert.match(await textoTela(page, '[data-secao="reconciliacao"]'), /Pasto diferente: O animal de brinco 0457/);
    assert.equal(a.pedidos('importacao.reconciliacao').length, 1);
    await semProblemasDeLeiaute(page, largura, 'lista de importações com a reconciliação');
    assert.deepEqual(a.estado.erros, [], 'nenhum erro no console');
    await a.fechar();
  });
}

for (const largura of [360, 1280]) {
  test('GTA escolhida no formulário da transferência: na revisão, enviada ao lançamento depois de gravar (falha e "Tentar de novo"), vista no detalhe (' + largura + ' px)', async () => {
    const s = A.sistema();
    const sem = A.semear(s);
    const id = sem.animais.filter((x) => x.brinco === '0457')[0].animal_id;
    const a = await A.abrir(s, { largura, hash: 'rebanho' });
    const { page } = a;
    await A.esperarTela(page, 'Rebanho');
    await page.evaluate((x) => window.Registro.abrir('TRANSFERENCIA', { campos: { pasto_origem_id: x.A, pasto_destino_id: x.B, event_date: '2026-03-01' }, linhas: [{ animal_id: x.id }], origem: 'rebanho' }), { A: S.PASTOS.A, B: S.PASTOS.B, id });
    await A.esperarTela(page, 'Transferir de pasto');
    await page.waitForSelector('[data-anexos-form]');
    await page.click('[data-anexos-form] button:has-text("Anexar nota fiscal, GTA, laudo ou foto")');
    await page.waitForSelector(dialogo + ' [data-escolher-anexo]');
    assert.equal(await page.inputValue(dialogo + ' [data-campo="tipo"] select'), 'GTA', 'na transferência, o tipo sugerido é a GTA');
    await page.setInputFiles(dialogo + ' input[type=file]', { name: 'gta-4567.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 gta', 'utf8') });
    await page.waitForFunction(() => /gta-4567\.pdf/.test(document.querySelector('[data-escolher-anexo]').textContent));
    await page.fill(dialogo + ' [data-campo="descricao"] input', 'GTA 4567');
    await page.click(dialogo + ' [data-acao-principal]');
    await page.waitForSelector('[data-anexo-form="gta-4567.pdf"]');
    assert.match(await textoTela(page, '[data-anexos-form]'), /GTA: gta-4567\.pdf \(GTA 4567\)/);
    assert.equal(a.pedidos('anexo.adicionar').length, 0, 'nada vai ao servidor antes de gravar');
    await semProblemasDeLeiaute(page, largura, 'formulário com o anexo');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]');
    assert.match(await textoTela(page, dialogo), /Documentos e fotos\s*gta-4567\.pdf \(enviados depois de gravar\)/);
    // A primeira tentativa de enviar o arquivo cai no transporte (o lançamento já está gravado).
    await page.evaluate(() => {
      const real = window.__erpServidor;
      let falhou = false;
      window.__erpServidor = (json) => (!falhou && JSON.parse(json).rota === 'anexo.adicionar' ? (falhou = true, Promise.reject(new Error('NetworkError: Connection failure due to HTTP 0'))) : real(json));
    });
    await page.click(dialogo + ' [data-acao-principal]');
    await page.waitForSelector('[data-resultado="TRANSFERENCIA"]');
    await page.waitForSelector('[data-anexos-resultado] [data-anexo-estado="FALHOU"]');
    assert.match(await textoTela(page, '[data-anexos-resultado]'), /GTA gta-4567\.pdf: não foi enviado/);
    const ev = vigentesDe(s, 'EVENTOS').filter((e) => e.event_type === 'TRANSFERENCIA')[0];
    assert.ok(ev, 'a transferência ficou gravada');
    assert.equal(vigentesDe(s, 'ANEXOS').filter((x) => x.event_id === ev.event_id).length, 0);
    await page.click('[data-anexos-resultado] button:has-text("Tentar de novo")');
    await page.waitForSelector('[data-anexos-resultado] [data-anexo-estado="ENVIADO"]');
    assert.match(await textoTela(page, '[data-anexos-resultado]'), /GTA gta-4567\.pdf: guardado no lançamento/);
    const enviados = await page.evaluate(() => window.__gas.pedidos.filter((p) => p.rota === 'anexo.adicionar'));
    assert.equal(enviados.length, 2);
    assert.equal(enviados[0].idempotencyKey, enviados[1].idempotencyKey, 'a mesma chave do arquivo no reenvio');
    assert.deepEqual(vigentesDe(s, 'ANEXOS').filter((x) => x.event_id === ev.event_id).map((x) => [x.tipo, x.nome_arquivo, x.descricao, x.entidade]), [['GTA', 'gta-4567.pdf', 'GTA 4567', 'EVENTOS']]);
    await semProblemasDeLeiaute(page, largura, 'resultado com o anexo');
    await page.click('button:has-text("Ver evento")');
    await page.waitForSelector('[data-secao="anexos"] [data-anexo]');
    assert.match(await textoTela(page, '[data-secao="anexos"]'), /gta-4567\.pdf/);
    assert.deepEqual(a.estado.erros.filter((e) => !/NetworkError/.test(e)), [], 'nenhum outro erro no console');
    await a.fechar();
  });
}
