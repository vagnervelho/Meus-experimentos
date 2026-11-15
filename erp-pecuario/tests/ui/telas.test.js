'use strict';
/**
 * Telas da Fase 1 (nível 3, Playwright), nos fluxos críticos, a 1280 e a 360 px: cadastrar animal pela entrada
 * inicial ("Como entrou?") e vê-lo na lista e na ficha; editar campo sensível (justificativa → evento de ajuste) e
 * campo de cadastro (só auditoria); importar um CSV de 30 animais com 2 erros e 1 duplicata (total recusado, parcial
 * aprovado, blocos com progresso, relatório, desfazer); estornar e corrigir uma entrada pelo detalhe do evento, com a
 * simulação do servidor; exportar o CSV do rebanho e conferir contra a tela (BOM, ponto e vírgula, saneamento contra
 * fórmula). Em todas: sem rolagem horizontal, alvos de toque ≥ 48 px a 360 px e nenhum erro no console.
 * Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const LARGURAS = [1280, 360];
const cartoes = '.form-evento section.cartao-animal';
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

for (const largura of LARGURAS) {
  test('cadastrar animal pela entrada inicial e vê-lo na lista e na ficha (' + largura + ' px)', async () => {
    const s = A.sistema();
    const a = await A.abrir(s, { largura, hash: 'rebanho' });
    const { page } = a;
    await A.esperarTela(page, 'Rebanho');
    assert.match(await textoTela(page, '[data-contagem]'), /^0 animais/);
    await page.click('button:has-text("Cadastrar animal")');
    await page.waitForSelector(dialogo + ' [data-como-entrou]');
    const opcoes = await page.$$eval(dialogo + ' [data-entrada]', (els) => els.map((e) => e.getAttribute('data-entrada')));
    assert.deepEqual(opcoes, ['NASCIMENTO', 'ENTRADA_INICIAL', 'OUTRA_ENTRADA', 'EXTERNO'], 'só as entradas entregues (a compra chega na etapa seguinte da Fase 2)');
    await page.click(dialogo + ' [data-entrada="ENTRADA_INICIAL"]');
    await A.esperarTela(page, 'Rebanho inicial');
    const c = page.locator(cartoes).nth(0);
    await c.locator('[data-campo="brinco"] input').fill('0777');
    await c.locator('[data-campo="sexo"] label.opcao', { hasText: 'Fêmea' }).click();
    await c.locator('[data-campo="origem"] label.opcao', { hasText: 'Não se sabe' }).click();
    await c.locator('[data-campo="pasto_destino_id"] select').selectOption({ label: 'Pasto B' });
    await c.locator('[data-campo="data_nascimento"] input').fill('2024-04-04');
    await c.locator('[data-campo="data_nascimento_confianca"] label.opcao', { hasText: 'Confirmada' }).click();
    await semProblemasDeLeiaute(page, largura, 'formulário');
    await page.click('.form-evento button[type=submit]');
    await principal(page);
    await page.waitForSelector('[data-resultado="ENTRADA_INICIAL"]');
    assert.match(await textoTela(page, '[data-resultado]'), /1 animal entrou no rebanho/);
    await A.ir(page, 'rebanho', 'Rebanho');
    assert.match(await textoTela(page, '[data-contagem]'), /^1 animal/);
    const linha = largura >= 900 ? '.tabela tbody tr' : '.lista-cartoes .cartao-linha';
    assert.equal(await page.locator(linha).count(), 1);
    assert.match(await textoTela(page, linha), /0777/);
    assert.match(await textoTela(page, linha), /Pasto B/);
    await semProblemasDeLeiaute(page, largura, 'lista');
    await page.locator(linha).locator(largura >= 900 ? 'a:has-text("0777")' : 'a:has-text("Abrir ficha")').click();
    await A.esperarTela(page, '0777');
    await page.waitForSelector('[data-secao="geral"]');
    const geral = await textoTela(page, '[data-secao="geral"]');
    assert.match(geral, /Fêmea/);
    assert.match(geral, /04\/04\/2024 \(confirmada\)/);
    assert.match(await textoTela(page, '[data-secao="localizacao"]'), /Pasto B/);
    await semProblemasDeLeiaute(page, largura, 'ficha');
    await page.click('.abas a:has-text("Linha do tempo")');
    await page.waitForSelector('[data-secao="linha-tempo"] li');
    assert.match(await textoTela(page, '[data-secao="linha-tempo"]'), /01\/01\/2026 · Rebanho inicial/);
    await page.click('.abas a:has-text("Genealogia")');
    await page.waitForSelector('[data-secao="arvore"]');
    assert.match(await textoTela(page, '[data-secao="arvore"]'), /Sem genealogia registrada/);
    assert.deepEqual(a.estado.erros, []);
    assert.deepEqual(await page.evaluate(() => window.__gas.violacoes), []);
    await a.fechar();
  });

  test('editar: campo sensível pede justificativa e vira ajuste; campo de cadastro vai só para a auditoria (' + largura + ' px)', async () => {
    const s = A.sistema();
    const sem = A.semear(s);
    const id = sem.animais.filter((x) => x.brinco === '0457')[0].animal_id;
    const a = await A.abrir(s, { largura, hash: 'animal/' + id + '/resumo' });
    const { page } = a;
    await A.esperarTela(page, '0457');
    await page.waitForSelector('button:has-text("Editar cadastro")');
    await page.click('button:has-text("Editar cadastro")');
    const form = dialogo + ' [data-cadastro="animal.editar"]';
    await page.waitForSelector(form);
    assert.equal(await page.isVisible(form + ' [data-campo="justificativa"]'), false, 'sem mudança sensível, sem justificativa');
    await page.fill(form + ' [data-campo="data_nascimento"] input', '2023-03-03');
    await page.waitForSelector(form + ' [data-campo="justificativa"]:not([hidden])');
    await semProblemasDeLeiaute(page, largura, 'edição');
    await page.click(dialogo + ' [data-acao-principal]');
    await page.waitForSelector(form + ' [data-campo="justificativa"] .campo-erro:not([hidden])');
    assert.equal(a.pedidos('animal.editar').length, 0, 'sem justificativa nada vai ao servidor');
    await page.fill(form + ' [data-campo="justificativa"] textarea', 'Data copiada errada do caderno');
    await page.click(dialogo + ' [data-acao-principal]');
    await page.waitForSelector(dialogo, { state: 'detached' });
    const ped = a.pedidos('animal.editar')[0];
    assert.deepEqual(ped.dados, { animal_id: id, campos: { data_nascimento: '2023-03-03' }, justificativa: 'Data copiada errada do caderno' }, 'só o que mudou vai ao servidor');
    const ajustes = vigentesDe(s, 'AJUSTES').filter((x) => x.animal_id === id);
    assert.equal(ajustes.length, 1);
    assert.deepEqual([ajustes[0].campo, ajustes[0].valor_anterior, ajustes[0].valor_novo, ajustes[0].justificativa], ['data_nascimento', '2023-02-02', '2023-03-03', 'Data copiada errada do caderno']);
    await page.waitForFunction(() => /03\/03\/2023/.test((document.querySelector('[data-secao="geral"]') || {}).textContent || ''));
    // Campo de cadastro: nome → auditoria, sem evento e sem justificativa.
    const eventos = vigentesDe(s, 'EVENTOS').length;
    await page.click('button:has-text("Editar cadastro")');
    await page.waitForSelector(form);
    await page.fill(form + ' [data-campo="nome"] input', 'Mimosa');
    assert.equal(await page.isVisible(form + ' [data-campo="justificativa"]'), false);
    await page.click(dialogo + ' [data-acao-principal]');
    await page.waitForSelector(dialogo, { state: 'detached' });
    assert.equal(vigentesDe(s, 'EVENTOS').length, eventos, 'cadastro não gera evento');
    const aud = vigentesDe(s, 'AUDITORIA').filter((x) => x.entidade === 'ANIMAIS' && x.entity_id === id && x.campo === 'nome');
    assert.equal(aud.length, 1);
    assert.equal(aud[0].valor_novo, 'Mimosa');
    await page.waitForFunction(() => /Mimosa/.test((document.querySelector('[data-secao="geral"]') || {}).textContent || ''));
    await page.click('.abas a:has-text("Linha do tempo")');
    await page.waitForSelector('[data-secao="linha-tempo"] li');
    assert.match(await textoTela(page, '[data-secao="linha-tempo"]'), /Data de nascimento: 2023-02-02 → 2023-03-03 \(Data copiada errada do caderno\)/);
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });

  test('importar CSV de 30 animais com 2 erros e 1 duplicata: total recusado, parcial aprovado, blocos, relatório e desfazer (' + largura + ' px)', async () => {
    const s = A.sistema({ config: { importacao_lote_linhas: '10' } });
    A.semear(s);
    const linhas = ['Brinco;Sexo;Nasc.;Pasto'];
    for (let i = 1; i <= 30; i++) {
      let l = String(1000 + i) + ';' + (i % 2 ? 'F' : 'M') + ';' + String((i % 27) + 1).padStart(2, '0') + '/03/2024;' + (i % 3 ? 'Pasto A' : 'P-B');
      if (i === 7) l = '1007;X;01/03/2024;Pasto A';
      if (i === 15) l = '1015;F;31/02/2024;Pasto A';
      if (i === 22) l = '0457;F;01/03/2024;Pasto A';
      linhas.push(l);
    }
    const csv = linhas.join('\r\n');
    const a = await A.abrir(s, { largura, hash: 'importar' });
    const { page } = a;
    await A.esperarTela(page, 'Importação');
    await page.click('a:has-text("Nova importação")');
    await A.esperarTela(page, 'Importar animais');
    await page.setInputFiles('#imp-arquivo', { name: 'rebanho-30.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await semProblemasDeLeiaute(page, largura, 'importação, arquivo');
    await page.click('button:has-text("Ler o arquivo")');
    await page.waitForSelector('[data-mapeamento]');
    assert.match(await textoTela(page, '[data-secao="previa"]'), /Linhas\s*30/);
    assert.match(await textoTela(page, '[data-secao="previa"] pre'), /Linha 2: Brinco: 1001 \| Sexo: F/, 'primeiras linhas como texto bruto');
    assert.equal(await page.inputValue('[data-coluna="Nasc."]'), 'data_nascimento', 'modelo conhecido já vem mapeado');
    await page.click('button:has-text("Validar o arquivo")');
    await page.waitForSelector('.acao-final [role=alert]');
    assert.match(await textoTela(page, '.acao-final [role=alert]'), /confirmada ou estimada/, 'sem a confiança do nascimento, o servidor recusa o mapeamento');
    await page.selectOption('#conf-data_nascimento', 'ESTIMADA');
    await page.selectOption('#pad-castrado', 'false');
    await page.selectOption('#pad-reprodutor', 'false');
    await semProblemasDeLeiaute(page, largura, 'importação, colunas');
    await page.click('button:has-text("Validar o arquivo")');
    await page.waitForSelector('[data-secao="resultado"]');
    assert.ok(a.pedidos('importacao.validarBloco').filter((p) => p.dados.mapeamento.confiancas.data_nascimento).length >= 3, 'validação em blocos de 10');
    assert.match(await textoTela(page, '[data-secao="resultado"]'), /Linhas no arquivo\s*30\s*Válidas\s*27\s*Com erro\s*2\s*Duplicadas\s*1/);
    await page.click('[data-filtro="ERRO"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-secao="linhas"] tbody tr, [data-secao="linhas"] .cartao-linha').length === 2);
    const txt = await textoTela(page, '[data-secao="linhas"]');
    assert.match(txt, /Sexo: X/, 'texto original ao lado do motivo');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Baixar CSV dos erros")')]);
    const erros = fs.readFileSync(await dl.path(), 'utf8');
    assert.equal(erros.charCodeAt(0), 0xfeff, 'BOM');
    const corpoErros = erros.split('\r\n').filter((l) => /^(8|16|23);/.test(l));
    assert.equal(corpoErros.length, 3, 'as 3 linhas reprovadas (linha da planilha = número + 1 do cabeçalho)');
    assert.ok(corpoErros.some((l) => /^23;Duplicada;/.test(l)));
    await semProblemasDeLeiaute(page, largura, 'importação, validação');
    await page.click('a:has-text("Continuar para a confirmação")');
    await page.waitForSelector('[data-secao="confirmacao"]');
    const importarB = page.locator('button:has-text("Importar 27 animais")');
    assert.equal(await importarB.isDisabled(), true, 'com reprovadas, o botão só habilita com a caixa');
    assert.match(await textoTela(page, '[data-secao="confirmacao"]'), /Importação total recusada/);
    const id = (await page.evaluate(() => window.Roteador.atual())).split('/')[1];
    const total = await page.evaluate(async (imp) => {
      try { await window.Cliente.comando('importacao.importarBloco', { import_id: imp, bloco: 1, modo: 'TOTAL' }, { chave: 'teste-total' }); return 'gravou'; } catch (e) { return (e.details || []).map((d) => d.codigo).join(',') || e.code; }
    }, id);
    assert.match(total, /IMPORTACAO_TOTAL_RECUSADA/, 'o servidor também recusa a importação total');
    await page.click('label[for="imp-parcial"]');
    assert.equal(await importarB.isDisabled(), false);
    await semProblemasDeLeiaute(page, largura, 'importação, confirmação');
    // Queda de rede no bloco 2: a tela mostra a importação incompleta com Retomar, que continua do bloco 2.
    await page.evaluate(() => {
      const orig = window.__erpServidor;
      let caiu = false;
      window.__erpServidor = (json) => {
        const p = JSON.parse(json);
        if (!caiu && p.rota === 'importacao.importarBloco' && p.dados.bloco === 2) { caiu = true; return Promise.reject(new Error('NetworkError: queda de sinal')); }
        return orig(json);
      };
    });
    await importarB.click();
    await page.waitForSelector('button:has-text("Retomar")', { timeout: 20000 });
    assert.match(await textoTela(page, '#conteudo [role=alert]'), /Sem conexão/);
    assert.equal(vigentesDe(s, 'IMPORTACOES')[0].status, 'IMPORTANDO', 'só o bloco 1 gravado: importação incompleta');
    await page.click('button:has-text("Retomar")');
    await page.waitForSelector('[data-relatorio="IMPORTADO"]', { timeout: 20000 });
    assert.match(await textoTela(page, '[data-relatorio]'), /27 animais entraram no rebanho/);
    const blocos = a.pedidos('importacao.importarBloco').filter((p) => p.idempotencyKey !== 'teste-total');
    assert.deepEqual(blocos.map((p) => p.dados.bloco), [1, 2, 3], 'importação em blocos de 10, com progresso; o bloco 2 que caiu nem chegou ao servidor e foi reenviado pelo Retomar');
    assert.deepEqual(blocos[0].dados.aprovacao, { importar: 27, ignorar: 3 });
    assert.equal(blocos[0].dados.modo, 'PARCIAL_APROVADO');
    assert.match(await textoTela(page, '[data-secao="relatorio"]'), /parcial, aprovada por dono@gmail\.com/);
    assert.match(await textoTela(page, '[data-secao="reprovadas"]'), /Linha 23 \(duplicada\)/);
    await semProblemasDeLeiaute(page, largura, 'importação, relatório');
    assert.equal(vigentesDe(s, 'ANIMAIS').filter((x) => x.situacao_cadastral === 'ATIVO').length, 4 + 27);
    await A.ir(page, 'rebanho', 'Rebanho');
    assert.match(await textoTela(page, '[data-contagem]'), /^31 animais/);
    // Desfazer: os 27 deixam de valer.
    await A.ir(page, 'importar/' + id + '/execucao', 'Importar animais');
    await page.waitForSelector('button:has-text("Desfazer importação")');
    await page.click('button:has-text("Desfazer importação")');
    await page.waitForSelector(dialogo + ' textarea');
    await page.fill(dialogo + ' textarea', 'Planilha errada');
    await page.click(dialogo + ' button:has-text("Desfazer a importação")');
    await page.waitForSelector('[data-relatorio="CANCELADO"]', { timeout: 20000 });
    assert.equal(vigentesDe(s, 'ANIMAIS').filter((x) => x.situacao_cadastral === 'ATIVO').length, 4);
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });

  test('estornar e corrigir uma entrada pelo detalhe do evento, com a simulação do servidor (' + largura + ' px)', async () => {
    const s = A.sistema();
    const sem = A.semear(s);
    const a = await A.abrir(s, { largura, hash: 'eventos' });
    const { page } = a;
    await A.esperarTela(page, 'Eventos');
    await page.waitForSelector('a:has-text("Rebanho inicial")');
    await semProblemasDeLeiaute(page, largura, 'histórico');
    await page.click('a:has-text("Rebanho inicial")');
    await A.esperarTela(page, 'Rebanho inicial');
    await page.waitForSelector('[data-secao="animais"]');
    assert.match(await textoTela(page, '[data-secao="cabecalho"]'), /Situação\s*Vale\s*Animais\s*4/);
    await semProblemasDeLeiaute(page, largura, 'detalhe');
    // Corrigir: mesmo tipo, mesmos animais, diferença para o original na revisão.
    await page.click('[data-acoes-evento] button:has-text("Corrigir")');
    await A.esperarTela(page, 'Corrigir: Rebanho inicial');
    assert.equal(await page.locator(cartoes).count(), 4, 'os 4 animais do original');
    assert.equal(await page.locator(cartoes).nth(0).locator('[data-campo="brinco"] input').inputValue(), '0457');
    await page.locator(cartoes).nth(0).locator('[data-campo="brinco"] input').fill('0458');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector('[data-campo="justificativa_correcao"] .campo-erro:not([hidden])');
    await page.fill('[data-campo="justificativa_correcao"] textarea', 'Brinco trocado na contagem');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-diferencas="1"]');
    assert.match(await textoTela(page, dialogo + ' [data-diferencas]'), /0457: brinco de 0457 para 0458/);
    assert.equal(a.pedidos('evento.simular').filter((p) => p.dados.acao === 'corrigir').length, 1, 'correção simulada no servidor');
    await principal(page);
    await page.waitForSelector('[data-resultado]');
    assert.match(await textoTela(page, '[data-resultado]'), /Correção gravada/);
    const evs = vigentesDe(s, 'EVENTOS');
    const novo = evs.filter((e) => e.reversal_of_event_id === sem.event_id)[0];
    assert.ok(novo && novo.event_type === 'ENTRADA_INICIAL', 'evento substituto vigente');
    assert.equal(evs.filter((e) => e.event_id === sem.event_id).length, 0, 'o original deixou de valer');
    const animais = vigentesDe(s, 'ANIMAIS');
    assert.equal(animais.filter((x) => x.brinco === '0458').length, 1);
    assert.equal(animais.filter((x) => x.brinco === '0458')[0].animal_id, sem.animais.filter((x) => x.brinco === '0457')[0].animal_id, 'mesmo animal_id');
    // Estornar o substituto: some do rebanho.
    await page.click('button:has-text("Ver evento")');
    await A.esperarTela(page, 'Rebanho inicial');
    await page.waitForSelector('[data-acoes-evento] button:has-text("Estornar")');
    assert.match(await textoTela(page, '[data-secao="cabecalho"]'), /Substitui/);
    await page.click('[data-acoes-evento] button:has-text("Estornar")');
    await A.esperarTela(page, 'Estornar');
    await page.fill('[data-campo="justificativa"] textarea', 'Lançado na base errada');
    await page.click('.form-evento button[type=submit]');
    await page.waitForSelector(dialogo + ' [data-acao-principal]:not([disabled])');
    assert.match(await textoTela(page, dialogo), /Será desfeito\s*Rebanho inicial \(marco zero\) de 01\/01\/2026/);
    assert.match(await page.textContent(dialogo + ' [data-acao-principal]'), /Estornar rebanho inicial \(marco zero\) de 4 animais/, 'o botão repete o verbo');
    await semProblemasDeLeiaute(page, largura, 'revisão do estorno');
    await principal(page);
    await page.waitForSelector('[data-resultado="ESTORNO"]');
    assert.equal(vigentesDe(s, 'ANIMAIS').filter((x) => x.situacao_cadastral === 'ATIVO').length, 0);
    await A.ir(page, 'evento/' + novo.event_id, 'Rebanho inicial');
    await page.waitForSelector('[data-secao="cabecalho"]');
    assert.match(await textoTela(page, '[data-secao="cabecalho"]'), /Não vale/);
    assert.equal(await page.$('[data-acoes-evento] button'), null, 'evento que não vale não se estorna nem se corrige');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });

  test('exportar CSV do rebanho e conferir contra a tela: BOM, ponto e vírgula, filtros, saneamento contra fórmula (' + largura + ' px)', async () => {
    const s = A.sistema();
    const raca = s.api({ rota: 'lista.salvar', idempotencyKey: 'raca-formula', dados: { lista: 'RACA', codigo: 'FORMULA', rotulo: '=2+3 Nelore' } });
    assert.ok(raca.ok, JSON.stringify(raca.error));
    s.registrar({ tipo: 'ENTRADA_INICIAL', campos: {}, animais: [
      S.bicho({ brinco: '0457', raca: 'FORMULA', data_nascimento: '2023-02-02', data_nascimento_confianca: 'CONFIRMADA' }),
      S.bicho({ brinco: '0391', pasto_destino_id: S.PASTOS.B, data_nascimento: '2022-05-10', data_nascimento_confianca: 'ESTIMADA' }),
      S.bicho({ brinco: '12', sexo: 'M', data_nascimento: '2025-03-01', data_nascimento_confianca: 'CONFIRMADA' }),
      S.bicho({ brinco: '9', data_nascimento: '2025-09-12', data_nascimento_confianca: 'CONFIRMADA' }),
      S.bicho({ data_nascimento: '2025-09-13', data_nascimento_confianca: 'CONFIRMADA' }),
    ] }, 'semente-exportacao');
    const a = await A.abrir(s, { largura, hash: 'rebanho' });
    const { page } = a;
    await A.esperarTela(page, 'Rebanho');
    await page.waitForFunction(() => /^5 animais/.test(document.querySelector('[data-contagem]').textContent));
    await page.selectOption('select[id^="reb-"][id$="p"]', { label: 'Pasto A' });
    await page.waitForFunction(() => /^4 animais/.test(document.querySelector('[data-contagem]').textContent));
    if (largura >= 900) {
      await page.click('.tabela th button:has-text("Brinco")');
      assert.equal(await page.getAttribute('.tabela th:has(button:has-text("Brinco"))', 'aria-sort'), 'ascending');
    }
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Exportar CSV")')]);
    assert.match(dl.suggestedFilename(), /^rebanho-2026-11-13\.csv$/);
    const bruto = fs.readFileSync(await dl.path(), 'utf8');
    assert.equal(bruto.charCodeAt(0), 0xfeff, 'BOM para o Excel em pt-BR');
    const linhas = bruto.slice(1).split('\r\n');
    assert.match(linhas[0], /^Rebanho — 4 animais$/);
    assert.match(linhas[1], /^Filtros: situação: Ativos · pasto: Pasto A$/);
    assert.match(linhas[2], /^Dados de \d\d\/\d\d\/\d{4} \d\d:\d\d$/);
    const ci = linhas.indexOf('Brinco;ID;Sexo;Raça;Idade;Categoria;Peso atual;Pasto atual;Situação;Nascimento');
    assert.ok(ci > 0, 'cabeçalho com as 10 colunas da §5');
    const corpo = linhas.slice(ci + 1).filter(Boolean).map((l) => l.split(';'));
    assert.equal(corpo.length, 4);
    const formula = corpo.filter((r) => r[0] === '0457')[0];
    assert.equal(formula[3], "'=2+3 Nelore", 'saneamento: célula que começa com = ganha apóstrofo');
    if (largura >= 900) {
      const tela = await page.$$eval('.tabela tbody tr', (trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td')).slice(1).map((td) => td.textContent.trim())));
      const csvSemSaneamento = corpo.map((r) => r.map((c) => c.replace(/^'(?=[=+\-@])/, '')));
      assert.deepEqual(csvSemSaneamento, tela, 'CSV = tela, linha a linha e na mesma ordem (CT-16)');
      assert.deepEqual(corpo.map((r) => r[0]), ['9', '12', '0457', 'sem brinco'], 'brinco numérico ordena como número; sem brinco no fim');
    } else {
      const titulos = await page.$$eval('.lista-cartoes .cartao-linha-titulo', (els) => els.map((e) => e.textContent.trim()));
      assert.deepEqual(corpo.map((r) => r[0]), titulos, 'cartões e CSV na mesma ordem');
      await semProblemasDeLeiaute(page, largura, 'lista em cartões');
    }
    // Seleção múltipla → registrar com os selecionados (entrada por contexto).
    await page.click('button:has-text("Selecionar os 4 filtrados")');
    await page.click('[data-barra-selecao] button');
    await page.waitForSelector(dialogo + ' button:has-text("Brinco lançado errado")');
    await page.click(dialogo + ' button:has-text("Brinco lançado errado")');
    await A.esperarTela(page, 'Corrigir dados do animal');
    assert.equal(await page.locator(cartoes).count(), 4, 'os 4 selecionados entram no formulário');
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}

test('telas a 360 px: pastos, configurações e sistema sem rolagem e com alvos de 48 px; painel do pasto e parâmetros com dados reais', async () => {
  const s = A.sistema();
  A.semear(s);
  const a = await A.abrir(s, { largura: 360, hash: 'pastos' });
  const { page } = a;
  await A.esperarTela(page, 'Pastos');
  assert.match(await textoTela(page, '[data-pasto="' + S.PASTOS.A + '"]'), /Cabeças\s*3/);
  await semProblemasDeLeiaute(page, 360, 'pastos');
  await page.click('[data-pasto="' + S.PASTOS.A + '"] a');
  await A.esperarTela(page, 'Pasto A');
  await page.waitForSelector('[data-secao="composicao"]');
  assert.match(await textoTela(page, '[data-secao="composicao"]'), /Cabeças\s*3\s*Machos\s*1\s*Fêmeas\s*2/);
  await semProblemasDeLeiaute(page, 360, 'painel do pasto');
  await page.click('button:has-text("Editar pasto")');
  await page.waitForSelector(dialogo + ' [data-campo="posse"]');
  await page.click(dialogo + ' [data-campo="posse"] label.opcao:has-text("Arrendado")');
  await page.click(dialogo + ' [data-campo="arrendador_id"] button:has-text("+ Novo")');
  await page.fill(dialogo + ' >> nth=-1 >> [data-campo="nome"] input', 'Sítio do Zé');
  await page.click(dialogo + ' >> nth=-1 >> button:has-text("Salvar")');
  await page.waitForFunction(() => document.querySelectorAll('[role=dialog]').length === 1);
  await page.click(dialogo + ' [data-acao-principal]');
  await page.waitForSelector(dialogo, { state: 'detached' });
  const pasto = vigentesDe(s, 'PASTOS').filter((p) => p.pasture_id === S.PASTOS.A)[0];
  const parc = vigentesDe(s, 'PARCEIROS').filter((p) => p.nome === 'Sítio do Zé')[0];
  assert.equal(pasto.posse, 'ARRENDADO');
  assert.equal(pasto.arrendador_id, parc.partner_id);
  assert.match(String(parc.tipos), /^ARRENDADOR$/, '"+ Novo" do arrendador já nasce como arrendador');
  await page.waitForFunction(() => /Arrendado \(alugado\) · Sítio do Zé/.test((document.querySelector('[data-secao="dados"]') || {}).textContent || ''));
  await A.ir(page, 'config/parametros', 'Configurações');
  await semProblemasDeLeiaute(page, 360, 'parâmetros');
  await page.fill('[data-grupo="pecuaria"] [data-campo="ua_peso_kg"] input', '455');
  await page.click('[data-grupo="pecuaria"] button:has-text("Salvar pecuária")');
  await page.waitForFunction(() => /1 parâmetro salvo/.test(document.getElementById('avisos').textContent));
  assert.equal(vigentesDe(s, 'CONFIGURACOES').filter((c) => c.chave === 'ua_peso_kg')[0].valor, '455');
  assert.deepEqual(a.pedidos('config.salvar')[0].dados, { valores: { ua_peso_kg: 455 } }, 'só o parâmetro que mudou');
  await A.ir(page, 'config/categorias', 'Configurações');
  assert.match(await textoTela(page, '#conteudo'), /Cobertura completa/);
  await semProblemasDeLeiaute(page, 360, 'categorias');
  await A.ir(page, 'config/sistema', 'Configurações');
  await page.waitForSelector('[data-secao="backups"]');
  await semProblemasDeLeiaute(page, 360, 'sistema');
  await page.click('button:has-text("Fazer backup agora")');
  await page.waitForFunction(() => /Backup feito/.test(document.querySelector('[data-secao="backups"]').textContent));
  await page.waitForSelector('[data-secao="backups"] button:has-text("Restaurar")');
  // Restaurar: consequência descrita, palavra RESTAURAR e justificativa; o banco em uso passa a ser a cópia.
  const bancoAntes = s.banco();
  await page.click('[data-secao="backups"] button:has-text("Restaurar")');
  await page.waitForSelector(dialogo + ' #rst-palavra');
  assert.match(await textoTela(page, dialogo), /serão substituídos pela cópia/);
  await page.fill(dialogo + ' textarea', 'Ensaio de restauração');
  await page.click(dialogo + ' button:has-text("Restaurar o backup")');
  await page.waitForSelector(dialogo + ' .nota-erro');
  assert.equal(a.pedidos('sistema.restaurarBackup').length, 0, 'sem a palavra, nada vai ao servidor');
  await page.fill(dialogo + ' #rst-palavra', 'restaurar');
  await page.click(dialogo + ' button:has-text("Restaurar o backup")');
  await page.waitForSelector(dialogo, { state: 'detached', timeout: 20000 });
  assert.notEqual(s.banco(), bancoAntes, 'o banco em uso é a cópia restaurada');
  await page.waitForSelector('[data-secao="backups"] button:has-text("Restaurar")');
  await page.click('button:has-text("Verificar a integridade agora")');
  await page.waitForFunction(() => /Tudo certo/.test((document.querySelector('[data-integridade]') || {}).textContent || ''));
  await page.click('button:has-text("Rodar o diagnóstico")');
  await page.waitForFunction(() => /confirmado como dono/.test((document.querySelector('[data-diagnostico]') || {}).textContent || ''));
  await A.ir(page, 'config/auditoria', 'Configurações');
  await page.waitForSelector('.lista-cartoes, .tabela');
  assert.match(await textoTela(page, '#conteudo'), /registros de alteração/);
  await semProblemasDeLeiaute(page, 360, 'auditoria');
  await A.ir(page, 'inicio', 'Início');
  await page.waitForSelector('[data-gerado-em]:not(:empty)');
  assert.match(await textoTela(page, '[data-gerado-em]'), /^Dados de \d\d\/\d\d\/\d{4} \d\d:\d\d$/);
  assert.match(await textoTela(page, '[data-indicador="machos"]'), /Machos\s*1/);
  assert.match(await textoTela(page, '[data-indicador="femeas"]'), /Fêmeas\s*3/);
  await semProblemasDeLeiaute(page, 360, 'início');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});

test('fotos e documentos na ficha: imagem reduzida no aparelho, foto principal no cabeçalho, abrir e remover com justificativa', async () => {
  const s = A.sistema();
  const sem = A.semear(s);
  const id = sem.animais.filter((x) => x.brinco === '0391')[0].animal_id;
  const a = await A.abrir(s, { largura: 1280, hash: 'animal/' + id + '/anexos' });
  const { page } = a;
  await A.esperarTela(page, '0391');
  await page.waitForSelector('button:has-text("Adicionar foto ou documento")');
  await page.click('button:has-text("Adicionar foto ou documento")');
  const form = dialogo + ' [data-cadastro="anexo.adicionar"]';
  await page.waitForSelector(form);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles(form + ' input[type=file]', { name: 'vaca.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => /Arquivo: vaca\.jpg/.test(document.querySelector('[data-cadastro="anexo.adicionar"]').textContent));
  await page.click(form + ' [data-campo="definir_como_foto"] label.opcao:has-text("Sim")');
  await page.click(dialogo + ' [data-acao-principal]');
  await page.waitForSelector(dialogo, { state: 'detached' });
  const ped = a.pedidos('anexo.adicionar')[0];
  assert.equal(ped.dados.mime_type, 'image/jpeg', 'imagem convertida e reduzida no aparelho');
  assert.ok(ped.dados.miniatura_base64 && ped.dados.miniatura_base64.length * 3 / 4 <= 15 * 1024, 'miniatura de até ~15 KB');
  assert.equal(ped.dados.definir_como_foto, true);
  const anexo = vigentesDe(s, 'ANEXOS').filter((x) => x.entity_id === id)[0];
  assert.equal(anexo.status, 'ATIVO');
  assert.equal(vigentesDe(s, 'ANIMAIS').filter((x) => x.animal_id === id)[0].foto_anexo_id, anexo.anexo_id);
  await page.waitForSelector('.ficha-foto[src^="data:image/"]');
  await page.waitForSelector('[data-anexo="' + anexo.anexo_id + '"] img[src^="data:image/"]');
  await page.click('[data-anexo="' + anexo.anexo_id + '"] button:has-text("Abrir")');
  await page.waitForSelector(dialogo + ' img.imagem-cheia[src^="data:image/"]');
  await page.keyboard.press('Escape');
  await page.waitForSelector(dialogo, { state: 'detached' });
  await page.click('[data-anexo="' + anexo.anexo_id + '"] button:has-text("Remover")');
  await page.waitForSelector(dialogo + ' textarea');
  await page.click(dialogo + ' [data-acao-principal]');
  await page.waitForSelector(dialogo + ' [data-campo="justificativa"] .campo-erro:not([hidden])');
  await page.fill(dialogo + ' textarea', 'Foto de outro animal');
  await page.click(dialogo + ' [data-acao-principal]');
  await page.waitForSelector(dialogo, { state: 'detached' });
  await page.waitForFunction(() => /Nenhuma foto ou documento/.test(document.getElementById('conteudo').textContent));
  assert.equal(vigentesDe(s, 'ANEXOS').filter((x) => x.anexo_id === anexo.anexo_id)[0].status, 'REMOVIDO');
  assert.equal(vigentesDe(s, 'ANIMAIS').filter((x) => x.animal_id === id)[0].foto_anexo_id, null, 'a foto principal sai junto');
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
