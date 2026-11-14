'use strict';
/**
 * Os fakes do harness precisam ser FIÉIS, senão os testes das próximas etapas dão verde falso. Aqui se confere:
 * coerção de célula Geral (contra tests/fixtures/coercao.json), as duas fachadas sobre o mesmo estado, buffer de
 * escritas e morte da execução, falha injetada, lock com intercalação, Properties, Drive (drive.file) e UrlFetch.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGas, ORDENS, RELOGIO_PADRAO, formatDateLikeJava, coagirEntrada, arquivosFonte } = require('./harness');

const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'coercao.json'), 'utf8'));
const plano = (v) => JSON.parse(JSON.stringify(v));

/** Contexto com uma planilha pt_BR e uma aba T de 20 × 6, pronta para escrever. */
function cenario(opcoes) {
  const gas = createGas(opcoes);
  const G = gas.G;
  const id = gas.planilhas.criar('Banco de teste');
  gas.exec(() => {
    const ss = G.SpreadsheetApp.openById(id);
    ss.setSpreadsheetLocale('pt_BR');
    ss.setSpreadsheetTimeZone('America/Porto_Velho');
    const sh = ss.insertSheet('T');
    sh.deleteRows(21, 980);
    sh.deleteColumns(7, 20);
  });
  const aba = () => G.SpreadsheetApp.openById(id).getSheetByName('T');
  const sheetId = gas.exec(() => aba().getSheetId());
  return { gas, G, id, aba, sheetId };
}
function classificar(G, valor, formula) {
  if (formula) return { tipo: 'formula', valor };
  if (typeof valor === 'number') return { tipo: 'numero', valor };
  if (typeof valor === 'boolean') return { tipo: 'booleano', valor };
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    const dia = formatDateLikeJava(valor, 'America/Porto_Velho', 'yyyy-MM-dd');
    return dia === '1899-12-30' ? { tipo: 'hora', valor: formatDateLikeJava(valor, 'America/Porto_Velho', 'HH:mm:ss') } : { tipo: 'data', valor: dia };
  }
  return { tipo: 'texto', valor };
}

// ------------------------------------------------------------------ carga e ambiente ----
test('createGas carrega src/*.js nas duas ordens, com relógio, IDs e sessão determinísticos', () => {
  const fontes = arquivosFonte();
  assert.ok(fontes.includes('Schema.js') && fontes.includes('Utils.js') && fontes.includes('Validation.js'));
  const [a, b] = ORDENS.map((order) => createGas({ order }));
  assert.deepEqual(a.files, fontes);
  assert.deepEqual(b.files, fontes.slice().reverse());
  for (const gas of [a, b]) {
    // Code.js é a exceção da regra: declara as funções públicas (01, seção 4.1) em vez de um namespace.
    fontes.forEach((f) => {
      if (f === 'Code.js') ['doGet', 'api', 'setup', 'runAcceptanceTests', 'runDiagnostics', 'verifyIntegrity', 'trgManutencaoDiaria', 'trgIntegridadeSemanal'].forEach((fn) => assert.equal(typeof gas.G[fn], 'function', 'Code.js declara ' + fn));
      else assert.equal(typeof gas.G[f.replace(/\.js$/, '')], 'object', f + ' declara o namespace');
    });
    assert.equal(gas.run('new Date().toISOString()'), '2026-11-13T14:00:00.000Z');
    assert.equal(gas.run('Date.now()'), RELOGIO_PADRAO);
    assert.equal(gas.run('new Date(2026, 0, 2).getDate()'), 2, 'Date com argumentos continua real');
    assert.equal(gas.G.Utilities.getUuid(), '00000000-0000-4000-8000-000000000001');
    assert.equal(gas.G.Utilities.getUuid(), '00000000-0000-4000-8000-000000000002');
    assert.equal(gas.G.Session.getActiveUser().getEmail(), 'dono@gmail.com');
    assert.equal(gas.G.Session.getScriptTimeZone(), 'America/Porto_Velho');
    assert.equal(gas.G.Utilities.formatDate(gas.run('new Date()'), 'America/Porto_Velho', "yyyy-MM-dd'T'HH:mm"), '2026-11-13T10:00');
    assert.equal(gas.G.LockService.getDocumentLock(), null, 'script autônomo não tem lock de documento');
    assert.equal(gas.G.SpreadsheetApp.getActiveSpreadsheet(), null);
    assert.equal(typeof gas.G.DriveApp, 'undefined', 'DriveApp não existe no contexto');
  }
  a.G.Utilities.sleep(1500);
  assert.equal(a.run('Date.now()'), RELOGIO_PADRAO + 1500, 'sleep avança o relógio falso');
  const outro = createGas({ email: 'terceiro@gmail.com', fakeClock: Date.UTC(2026, 0, 1), files: ['Utils.js'] });
  assert.equal(outro.G.Session.getEffectiveUser().getEmail(), 'terceiro@gmail.com');
  outro.session.activeEmail = '';
  assert.equal(outro.G.Session.getActiveUser().getEmail(), '', 'e-mail ativo vazio é simulável');
  assert.equal(typeof outro.G.Schema, 'undefined');
  assert.match(createGas({ uuidAleatorio: true }).G.Utilities.getUuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

// ------------------------------------------------------------------ coerção ----
test('coerção: célula Geral reinterpreta o texto gravado por setValues (corpus de ida e volta)', () => {
  const { gas, aba } = cenario();
  assert.equal(corpus.locale, 'pt_BR');
  assert.ok(corpus.casos.length >= 14);
  for (const caso of corpus.casos) {
    const lido = gas.exec(() => {
      const r = aba().getRange(2, 1);
      r.setValue(caso.entrada);
      return classificar(gas.G, r.getValue(), r.getFormula());
    });
    assert.deepEqual(plano(lido), caso.geral, 'entrada ' + JSON.stringify(caso.entrada));
  }
  // Os que mais doem: zeros à esquerda, fórmula e data.
  const [brinco, formula, data] = gas.exec(() => { const r = aba().getRange(3, 1, 1, 3); r.setValues([['0012', '=1+1', '2026-11-13']]); return r.getValues()[0]; });
  assert.equal(brinco, 12);
  assert.equal(formula, 2);
  assert.ok(data instanceof gas.G.Date, 'getValues devolve Date do próprio contexto');
  assert.equal(formatDateLikeJava(data, 'America/Porto_Velho', 'yyyy-MM-dd'), '2026-11-13');
});

test('coerção: com formato de texto (@) aplicado ANTES, o texto volta idêntico; aplicado depois, não conserta', () => {
  const { gas, aba } = cenario();
  const entradas = corpus.casos.map((c) => c.entrada);
  const lidos = gas.exec(() => {
    const r = aba().getRange(2, 1, 1, 6);
    const out = [];
    for (let i = 0; i < entradas.length; i += 6) {
      const bloco = entradas.slice(i, i + 6);
      while (bloco.length < 6) bloco.push('');
      r.setNumberFormats([bloco.map(() => '@')]);
      r.setValues([bloco]);
      out.push(...r.getValues()[0]);
    }
    return out.slice(0, entradas.length);
  });
  assert.deepEqual(plano(lidos), entradas);
  // Formato aplicado depois do valor: o zero à esquerda já se perdeu.
  const tarde = gas.exec(() => { const r = aba().getRange(5, 1); r.setValue('0012'); r.setNumberFormat('@'); return r.getValue(); });
  assert.equal(tarde, 12);
  // Número gravado em célula de texto vira texto: o adaptador não pode pôr @ em coluna numérica.
  const numero = gas.exec(() => { const r = aba().getRange(6, 1); r.setNumberFormat('@'); r.setValue(387.5); return r.getValue(); });
  assert.equal(numero, '387.5');
  // Tipos nativos em célula Geral ficam como são.
  const nativos = gas.exec(() => { const r = aba().getRange(7, 1, 1, 3); r.setValues([[387.5, true, null]]); return r.getValues()[0]; });
  assert.deepEqual(plano(nativos), [387.5, true, '']);
  assert.throws(() => gas.exec(() => aba().getRange(8, 1).setValue({ a: 1 })), /valor não primitivo/);
});

test('coerção: depende do locale da planilha (o setup precisa fixar pt_BR)', () => {
  assert.deepEqual(coagirEntrada('13/11/2026', 'pt_BR'), { data: 46339 });
  assert.equal(coagirEntrada('13/11/2026', 'en_US'), '13/11/2026', 'mês 13 não existe em en_US: fica texto');
  assert.deepEqual(coagirEntrada('03/11/2026', 'en_US'), { data: 46092 }, 'em en_US é 11 de março');
  assert.deepEqual(coagirEntrada('03/11/2026', 'pt_BR'), { data: 46329 });
  assert.equal(coagirEntrada('1.234,56', 'pt_BR'), 1234.56);
  assert.equal(coagirEntrada('1.234,56', 'en_US'), '1.234,56');
  assert.equal(coagirEntrada('1,234.56', 'en_US'), 1234.56);
  assert.equal(coagirEntrada('387,5', 'pt_BR'), 387.5);
  assert.equal(coagirEntrada('R$ 1.500,00', 'pt_BR'), 1500);
  assert.equal(coagirEntrada('verdadeiro', 'pt_BR'), true);
  assert.equal(coagirEntrada('verdadeiro', 'en_US'), 'verdadeiro');
  assert.equal(coagirEntrada('2026-02-30', 'pt_BR'), '2026-02-30', 'data impossível fica texto');
  assert.equal(coagirEntrada('-5', 'pt_BR'), -5);
  assert.equal(coagirEntrada('', 'pt_BR'), '');
  // Planilha nova nasce com locale e fuso que NÃO são os do app, de propósito.
  const gas = createGas();
  const id = gas.planilhas.criar('nova');
  assert.deepEqual(gas.planilhas.propriedades(id), { nome: 'nova', fuso: 'Etc/GMT', locale: 'en_US' });
  assert.deepEqual(gas.planilhas.abas(id), ['Página1']);
  assert.deepEqual(plano(gas.planilhas.dimensoes(id, 'Página1')), { linhas: 1000, colunas: 26, ultimaLinha: 0, ultimaColuna: 0, congeladas: 0, protecoes: [] });
});

test('coerção pela API: stringValue tipado e entrada RAW preservam; USER_ENTERED coage', () => {
  const { gas, G, id, sheetId } = cenario();
  const entradas = corpus.casos.map((c) => c.entrada);
  gas.exec(() => {
    G.Sheets.Spreadsheets.batchUpdate({ requests: [{ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: entradas.slice(0, 19).map((e) => ({ values: [{ userEnteredValue: { stringValue: e } }] })), fields: 'userEnteredValue' } }] }, id);
    G.Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: [{ range: 'T!B1', values: entradas.slice(0, 19).map((e) => [e]) }] }, id);
    G.Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'USER_ENTERED', data: [{ range: 'T!C1:C3', values: [['0012'], ['=1+1'], ['TRUE']] }] }, id);
  });
  const lido = gas.exec(() => G.Sheets.Spreadsheets.Values.batchGet(id, { ranges: ['T!A1:A19', 'T!B1:B19', 'T!C1:C3'], valueRenderOption: 'UNFORMATTED_VALUE' }));
  assert.deepEqual(plano(lido.valueRanges[0].values).map((l) => l[0]), entradas.slice(0, 19), 'stringValue nunca é interpretado');
  assert.deepEqual(plano(lido.valueRanges[1].values).map((l) => l[0]), entradas.slice(0, 19), 'RAW nunca é interpretado');
  assert.deepEqual(plano(lido.valueRanges[2].values), [[12], [2], [true]], 'USER_ENTERED se comporta como digitação');
  // Valores tipados: número e booleano chegam como tais; mais de um valor no mesmo ExtendedValue é pedido inválido.
  gas.exec(() => G.Sheets.Spreadsheets.batchUpdate({ requests: [{ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 3 }, rows: [{ values: [{ userEnteredValue: { numberValue: 387.5 } }, { userEnteredValue: { boolValue: false } }, {}] }], fields: 'userEnteredValue' } }] }, id));
  assert.deepEqual(gas.planilhas.matriz(id, 'T')[0].slice(3, 5), [387.5, false]);
  assert.throws(() => gas.exec(() => G.Sheets.Spreadsheets.batchUpdate({ requests: [{ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: [{ userEnteredValue: { stringValue: 'a', numberValue: 1 } }] }], fields: 'userEnteredValue' } }] }, id)), /oneof field/);
  assert.throws(() => gas.exec(() => G.Sheets.Spreadsheets.batchUpdate({ requests: [{ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: [{ userEnteredValue: { numberValue: '12' } }] }], fields: 'userEnteredValue' } }] }, id)), /TYPE_DOUBLE/);
  assert.throws(() => gas.exec(() => G.Sheets.Spreadsheets.batchUpdate({ requests: [{ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [] } }] }, id)), /At least one field must be listed/);
});

test('edição manual do dono: célula Geral coage, célula de texto preserva; a leitura devolve o que ficou', () => {
  const { gas, G, id, aba } = cenario();
  gas.exec(() => { aba().getRange(1, 1, 2, 2).setNumberFormats([['@', '@'], ['@', '']]); aba().getRange(1, 1, 2, 2).setValues([['brinco', 'data'], ['0412', '']]); });
  gas.planilhas.digitar(id, 'T', 2, 1, '0099'); // coluna de texto: preserva
  gas.planilhas.digitar(id, 'T', 2, 2, '13/11/2026'); // célula Geral: vira data
  const [linha] = gas.exec(() => aba().getRange(2, 1, 1, 2).getValues());
  assert.equal(linha[0], '0099');
  assert.ok(linha[1] instanceof G.Date);
  assert.deepEqual(gas.planilhas.matriz(id, 'T')[1], ['0099', { data: 46339 }]);
  assert.deepEqual(gas.planilhas.objetos(id, 'T'), [{ brinco: '0099', data: { data: 46339 } }]);
  assert.deepEqual(plano(gas.exec(() => aba().getRange(2, 1, 1, 2).getDisplayValues())), [['0099', '13/11/2026']]);
  // Pela API sem formatação a data chega como número serial (dias desde 30/12/1899).
  const api = gas.exec(() => G.Sheets.Spreadsheets.Values.batchGet(id, { ranges: ['T!A2:B2'], valueRenderOption: 'UNFORMATTED_VALUE' }));
  assert.deepEqual(plano(api.valueRanges[0].values), [['0099', 46339]]);
  assert.deepEqual(gas.planilhas.formatos(id, 'T'), [['@', '@'], ['@', null]]);
});

// ------------------------------------------------------------------ duas fachadas ----
test('duas fachadas, um estado: o que uma grava a outra lê; a API não enxerga o que ainda não foi descarregado', () => {
  const { gas, G, id, aba, sheetId } = cenario();
  gas.exec(() => {
    G.Sheets.Spreadsheets.batchUpdate({ requests: [{ appendCells: { sheetId, rows: [{ values: [{ userEnteredValue: { stringValue: 'event_id' } }, { userEnteredValue: { stringValue: 'event_seq' } }] }], fields: 'userEnteredValue' } }] }, id);
    assert.deepEqual(plano(aba().getRange(1, 1, 1, 2).getValues()), [['event_id', 'event_seq']], 'SpreadsheetApp lê o que a API gravou');
    aba().getRange(2, 1, 1, 2).setValues([['e-1', 1]]);
    const antes = G.Sheets.Spreadsheets.Values.batchGet(id, { ranges: ['T'], valueRenderOption: 'UNFORMATTED_VALUE' });
    assert.deepEqual(plano(antes.valueRanges[0].values), [['event_id', 'event_seq']], 'antes do flush a API não vê a linha');
    assert.equal(aba().getLastRow(), 2, 'a própria execução vê o que escreveu');
    G.SpreadsheetApp.flush();
    const depois = G.Sheets.Spreadsheets.Values.batchGet(id, { ranges: ['T'], valueRenderOption: 'UNFORMATTED_VALUE' });
    assert.deepEqual(plano(depois.valueRanges[0].values), [['event_id', 'event_seq'], ['e-1', 1]]);
    // appendCells anexa depois da última linha com dado, mesmo com escrita pendente por cima.
    aba().getRange(5, 1).setValue('pendente');
    G.Sheets.Spreadsheets.batchUpdate({ requests: [{ appendCells: { sheetId, rows: [{ values: [{ userEnteredValue: { stringValue: 'e-2' } }, { userEnteredValue: { numberValue: 2 } }] }], fields: 'userEnteredValue' } }] }, id);
  });
  assert.deepEqual(gas.planilhas.matriz(id, 'T'), [['event_id', 'event_seq'], ['e-1', 1], ['e-2', 2], ['', ''], ['pendente', '']]);
  const meta = gas.exec(() => G.Sheets.Spreadsheets.get(id));
  assert.deepEqual(plano(meta.properties), { title: 'Banco de teste', locale: 'pt_BR', timeZone: 'America/Porto_Velho' });
  assert.deepEqual(plano(meta.sheets.map((s) => [s.properties.title, s.properties.gridProperties.rowCount, s.properties.gridProperties.columnCount])), [['Página1', 1000, 26], ['T', 20, 6]]);
});

test('leitura pela API: corta os vazios do fim de cada linha e as linhas vazias do fim; aceita vários intervalos', () => {
  const { gas, G, id, aba } = cenario();
  gas.exec(() => aba().getRange(1, 1, 3, 4).setNumberFormat('@').setValues([['a', 'b', '', ''], ['c', '', '', ''], ['', '', '', '']]));
  const r = gas.exec(() => G.Sheets.Spreadsheets.Values.batchGet(id, { ranges: ['T!A1:D3', 'T!A2:D', 'T!C1:D3', "'T'!A1:A1", 'T!A:A'], valueRenderOption: 'UNFORMATTED_VALUE' }));
  assert.deepEqual(plano(r.valueRanges[0]), { range: 'T!A1:D3', majorDimension: 'ROWS', values: [['a', 'b'], ['c']] });
  assert.deepEqual(plano(r.valueRanges[1]), { range: 'T!A2:D20', majorDimension: 'ROWS', values: [['c']] });
  assert.deepEqual(plano(r.valueRanges[2]), { range: 'T!C1:D3', majorDimension: 'ROWS' }, 'intervalo vazio vem SEM a chave values');
  assert.deepEqual(plano(r.valueRanges[3].values), [['a']]);
  assert.deepEqual(plano(r.valueRanges[4].values), [['a'], ['c']]);
  assert.throws(() => gas.exec(() => G.Sheets.Spreadsheets.Values.batchGet(id, { ranges: ['NAO_EXISTE!A1:B2'] })), /Unable to parse range/);
  assert.throws(() => gas.exec(() => G.Sheets.Spreadsheets.get('id-inexistente')), /Requested entity was not found/);
  // Valor formatado (padrão) segue o locale.
  gas.exec(() => aba().getRange(4, 1, 1, 2).setValues([[1234.5, true]]));
  const fmt = gas.exec(() => G.Sheets.Spreadsheets.Values.get(id, 'T!A4:B4'));
  assert.deepEqual(plano(fmt.values), [['1234,5', 'VERDADEIRO']]);
});

test('batchUpdate é atômico: um pedido inválido no meio não aplica nada; Values.batchUpdate não é', () => {
  const { gas, G, id, sheetId } = cenario();
  const linha = (t) => ({ values: [{ userEnteredValue: { stringValue: t } }] });
  assert.throws(() => gas.exec(() => G.Sheets.Spreadsheets.batchUpdate({ requests: [
    { addSheet: { properties: { title: 'NOVA', gridProperties: { rowCount: 5, columnCount: 3 } } } },
    { appendCells: { sheetId, rows: [linha('a')], fields: 'userEnteredValue' } },
    { updateCells: { start: { sheetId, rowIndex: 99, columnIndex: 0 }, rows: [linha('fora da grade')], fields: 'userEnteredValue' } },
    { appendCells: { sheetId, rows: [linha('b')], fields: 'userEnteredValue' } },
  ] }, id)), /is after last row in grid/);
  assert.deepEqual(gas.planilhas.abas(id), ['Página1', 'T'], 'a aba do primeiro pedido não ficou');
  assert.deepEqual(gas.planilhas.matriz(id, 'T'), []);
  for (const ruim of [{ pintarDeAzul: {} }, { appendCells: { sheetId: 4242, rows: [linha('x')], fields: '*' } }, { addSheet: { properties: { title: 'T' } } }, {}]) {
    assert.throws(() => gas.exec(() => G.Sheets.Spreadsheets.batchUpdate({ requests: [{ appendCells: { sheetId, rows: [linha('a')], fields: '*' } }, ruim] }, id)), /Invalid|Unknown name|already exists|No grid/);
    assert.deepEqual(gas.planilhas.matriz(id, 'T'), []);
  }
  // Lote válido: várias abas numa chamada, com as respostas na ordem.
  const r = gas.exec(() => G.Sheets.Spreadsheets.batchUpdate({ requests: [
    { addSheet: { properties: { title: 'NOVA', sheetId: 77, gridProperties: { rowCount: 2, columnCount: 2, frozenRowCount: 1 } } } },
    { appendCells: { sheetId: 77, rows: [linha('cabecalho')], fields: 'userEnteredValue,userEnteredFormat.numberFormat' } },
    { appendCells: { sheetId, rows: [linha('a'), linha('b')], fields: 'userEnteredValue' } },
    { appendDimension: { sheetId: 77, dimension: 'ROWS', length: 3 } },
    { updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: 10, columnCount: 4 } }, fields: 'gridProperties(rowCount,columnCount)' } },
  ] }, id));
  assert.equal(r.replies.length, 5);
  assert.deepEqual(plano(r.replies[0].addSheet.properties), { sheetId: 77, title: 'NOVA', index: 2, sheetType: 'GRID', gridProperties: { rowCount: 2, columnCount: 2, frozenRowCount: 1 } });
  assert.deepEqual(plano(gas.planilhas.dimensoes(id, 'NOVA')), { linhas: 5, colunas: 2, ultimaLinha: 1, ultimaColuna: 1, congeladas: 1, protecoes: [] });
  assert.deepEqual(gas.planilhas.matriz(id, 'T'), [['a'], ['b']]);
  assert.equal(gas.planilhas.dimensoes(id, 'T').linhas, 10);
  assert.equal(gas.planilhas.dimensoes(id, 'T').colunas, 4);
  // appendCells cresce a grade quando as linhas acabam; coluna a mais é erro.
  gas.exec(() => G.Sheets.Spreadsheets.batchUpdate({ requests: [{ appendCells: { sheetId, rows: Array.from({ length: 12 }, (_, i) => linha('l' + i)), fields: 'userEnteredValue' } }] }, id));
  assert.equal(gas.planilhas.dimensoes(id, 'T').linhas, 14);
  assert.throws(() => gas.exec(() => G.Sheets.Spreadsheets.batchUpdate({ requests: [{ appendCells: { sheetId, rows: [{ values: [{}, {}, {}, {}, { userEnteredValue: { stringValue: 'x' } }] }], fields: 'userEnteredValue' } }] }, id)), /beyond the last requested column/);
  // Values.batchUpdate: o intervalo válido que veio antes do inválido FICA (hipótese pessimista do desenho).
  assert.throws(() => gas.exec(() => G.Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: [{ range: 'NOVA!A2', values: [['ficou']] }, { range: 'NOVA!A9', values: [['fora']] }] }, id)), /exceeds grid limits/);
  assert.deepEqual(gas.planilhas.matriz(id, 'NOVA'), [['cabecalho'], ['ficou']]);
  assert.throws(() => gas.exec(() => G.Sheets.Spreadsheets.Values.batchUpdate({ data: [{ range: 'NOVA!A1', values: [['x']] }] }, id)), /valueInputOption/);
  assert.throws(() => gas.exec(() => G.Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: [{ range: 'NOVA!A1:A2', values: [['1'], ['2'], ['3']] }] }, id)), /tried writing to row/);
});

test('Range e Sheet: limites, dimensões e erros que o adaptador precisa respeitar', () => {
  const { gas, G, id, aba } = cenario();
  gas.exec(() => {
    const sh = aba();
    assert.equal(sh.getMaxRows(), 20);
    assert.equal(sh.getMaxColumns(), 6);
    assert.equal(sh.getLastRow(), 0);
    assert.equal(sh.getLastColumn(), 0);
    assert.throws(() => sh.getRange(2, 1, 0, 6), /number of rows in the range must be at least 1/, 'aba só com cabeçalho: ler "as linhas de dados" com 0 linhas é erro');
    assert.throws(() => sh.getRange(0, 1), /starting row of the range is too small/);
    assert.throws(() => sh.getRange(1, 1, 21, 1).getValues(), /Those rows are out of bounds/);
    assert.throws(() => sh.getRange(21, 1).setValue('x'), /Those rows are out of bounds/, 'gravar além da grade não a aumenta sozinho');
    assert.throws(() => sh.getRange(1, 7).setValue('x'), /Those columns are out of bounds/);
    assert.throws(() => sh.getRange(1, 1, 2, 2).setValues([['a', 'b']]), /The data has 1 but the range has 2/);
    assert.throws(() => sh.getRange(1, 1, 1, 2).setValues([['a', 'b', 'c']]), /number of columns in the data does not match/);
    assert.throws(() => sh.getRange(1, 1).setValue('x'.repeat(50001)), /maximum of 50000 characters/);
    assert.throws(() => sh.deleteRows(1, 20), /not possible to delete all/);
    assert.throws(() => sh.insertRowsAfter(21, 1), /out of bounds/);
    sh.getRange(1, 1, 1, 3).setNumberFormat('@').setValues([['id', 'nome', 'peso']]);
    sh.insertRowsAfter(20, 5);
    assert.equal(sh.getMaxRows(), 25);
    sh.getRange(25, 1, 1, 3).setValues([['x', 'y', 1]]);
    assert.equal(sh.getLastRow(), 25);
    assert.equal(sh.getLastColumn(), 3);
    assert.equal(sh.getDataRange().getA1Notation(), 'A1:C25');
    assert.equal(sh.getRange('B2:C3').getNumRows(), 2);
    assert.equal(sh.getRange('A1').getValue(), 'id');
    assert.equal(sh.getRange(1, 1, 1, 3).getNumberFormat(), '@');
    sh.deleteRows(2, 23);
    assert.equal(sh.getMaxRows(), 2);
    assert.deepEqual(plano(sh.getRange(1, 1, 2, 3).getValues()), [['id', 'nome', 'peso'], ['x', 'y', 1]]);
    sh.insertColumnsAfter(6, 2);
    assert.equal(sh.getMaxColumns(), 8);
    sh.deleteColumns(2, 1);
    assert.deepEqual(plano(sh.getRange(1, 1, 2, 2).getValues()), [['id', 'peso'], ['x', 1]]);
    sh.appendRow(['z', 2]);
    assert.equal(sh.getMaxRows(), 3, 'appendRow cria a linha que falta');
    sh.setFrozenRows(1);
    const p = sh.protect().setWarningOnly(true);
    assert.equal(p.isWarningOnly(), true);
  });
  assert.deepEqual(plano(gas.planilhas.dimensoes(id, 'T')), { linhas: 3, colunas: 7, ultimaLinha: 3, ultimaColuna: 2, congeladas: 1, protecoes: [{ soAviso: true }] });
  gas.exec(() => {
    const ss = G.SpreadsheetApp.openById(id);
    assert.equal(ss.getSheetByName('NAO_EXISTE'), null);
    assert.throws(() => ss.insertSheet('T'), /already exists/);
    assert.equal(ss.getSpreadsheetTimeZone(), 'America/Porto_Velho');
    assert.equal(ss.getSpreadsheetLocale(), 'pt_BR');
    assert.throws(() => ss.setSpreadsheetTimeZone('Marte/Olimpo'), /Invalid argument/);
    assert.deepEqual(plano(ss.getSheets().map((s) => s.getName())), ['Página1', 'T']);
    ss.deleteSheet(ss.getSheetByName('Página1'));
    assert.throws(() => ss.deleteSheet(ss.getSheetByName('T')), /can't remove all the sheets/);
    assert.throws(() => G.SpreadsheetApp.openById('nao-existe'), /openById/);
  });
});

test('linhas novas herdam o formato da linha de cima (padrão) ou nascem Gerais (herdaFormato: false)', () => {
  for (const herdaFormato of [true, false]) {
    const { gas, aba } = cenario({ planilha: { herdaFormato } });
    const lido = gas.exec(() => {
      const sh = aba();
      sh.getRange(1, 1, 1, 2).setNumberFormats([['@', '@']]).setValues([['brinco', 'peso']]);
      sh.deleteRows(2, 19); // aba aparada à dimensão exata: só o cabeçalho
      sh.insertRowsAfter(1, 1);
      sh.getRange(2, 1, 1, 2).setValues([['0012', 387.5]]);
      return sh.getRange(2, 1, 1, 2).getValues()[0];
    });
    // Herdando o @ do cabeçalho, o brinco se salva mas o peso vira texto; sem herdar, o brinco perde os zeros.
    assert.deepEqual(plano(lido), herdaFormato ? ['0012', '387.5'] : [12, 387.5], 'herdaFormato=' + herdaFormato);
    // A primitiva do desenho (insertRowsAfter → setNumberFormats no bloco exato → setValues) dá certo nos dois mundos.
    const certo = gas.exec(() => {
      const sh = aba();
      sh.insertRowsAfter(2, 1);
      sh.getRange(3, 1, 1, 2).setNumberFormats([['@', '0.0']]).setValues([['0012', 387.5]]);
      return sh.getRange(3, 1, 1, 2).getValues()[0];
    });
    assert.deepEqual(plano(certo), ['0012', 387.5]);
  }
});

// ------------------------------------------------------------------ buffer, morte e falha injetada ----
test('buffer: escrita por SpreadsheetApp fica pendente até flush() ou até o fim normal da execução', () => {
  const { gas, G, id, aba } = cenario();
  gas.exec(() => {
    aba().getRange(1, 1).setValue('a');
    aba().getRange(2, 1).setValue('b');
    assert.deepEqual(gas.pendentes().map((p) => [p.aba, p.tipo, p.intervalo]), [['T', 'valores', 'A1'], ['T', 'valores', 'A2']]);
    assert.deepEqual(gas.planilhas.matriz(id, 'T'), [['a'], ['b']], 'visão da execução');
    assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T'), [], 'nada durável ainda');
    G.SpreadsheetApp.flush();
    assert.deepEqual(gas.pendentes(), []);
    assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T'), [['a'], ['b']]);
    aba().getRange(3, 1).setValue('c');
    assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T'), [['a'], ['b']]);
  });
  assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T'), [['a'], ['b'], ['c']], 'o fim normal da execução descarrega');
  // Exceção não tratada: por padrão as pendentes chegam; o teste pode escolher outro destino.
  assert.throws(() => gas.exec(() => { aba().getRange(4, 1).setValue('d'); throw new Error('erro de regra'); }), /erro de regra/);
  assert.equal(gas.planilhas.matrizDuravel(id, 'T').length, 4);
  const r = gas.tentar(() => { aba().getRange(5, 1).setValue('e'); aba().getRange(6, 1).setValue('f'); throw new Error('erro de regra'); }, { seLancar: [1] });
  assert.equal(r.ok, false);
  assert.equal(r.morta, false);
  assert.match(r.erro.message, /erro de regra/);
  assert.deepEqual(r.chegaram, [1]);
  assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T').map((l) => l[0]), ['a', 'b', 'c', 'd', '', 'f']);
  // Fora de exec (código do teste), as escritas ficam pendentes até a próxima execução ou fimDaExecucao().
  aba().getRange(7, 1).setValue('g');
  assert.equal(gas.pendentes().length, 1);
  gas.fimDaExecucao();
  assert.equal(gas.planilhas.matrizDuravel(id, 'T')[6][0], 'g');
});

test('morte da execução: o teste escolhe qual subconjunto das escritas pendentes chega', () => {
  const casos = [
    { chegam: 'nenhuma', esperado: ['', '', '', ''] },
    { chegam: 'todas', esperado: ['w0', 'w1', 'w2', 'w3'] },
    { chegam: 2, esperado: ['w0', 'w1', '', ''] },
    { chegam: [1, 3], esperado: ['', 'w1', '', 'w3'] },
    { chegam: [3], esperado: ['', '', '', 'w3'] },
    { chegam: (pend) => pend.map((p) => p.intervalo === 'A1' || p.intervalo === 'A3'), esperado: ['w0', '', 'w2', ''] },
  ];
  for (const caso of casos) {
    const { gas, id, aba } = cenario();
    gas.exec(() => aba().getRange(1, 2, 4, 1).setValues([['fixo'], ['fixo'], ['fixo'], ['fixo']]));
    const r = gas.tentar(() => {
      for (let i = 0; i < 4; i++) aba().getRange(i + 1, 1).setValue('w' + i);
      gas.matar({ chegam: caso.chegam });
    });
    assert.equal(r.morta, true);
    assert.equal(r.ok, false);
    assert.equal(r.pendentes.length, 4);
    assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T').map((l) => l[0]), caso.esperado, 'chegam=' + String(caso.chegam));
    assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T').map((l) => l[1]), ['fixo', 'fixo', 'fixo', 'fixo'], 'o que já era durável não muda');
    assert.deepEqual(gas.pendentes(), []);
  }
  // exec() acusa a morte: o teste não a confunde com sucesso.
  const { gas, aba } = cenario();
  assert.throws(() => gas.exec(() => { aba().getRange(1, 1).setValue('x'); gas.matar(); }), (e) => e.execucaoMorta === true && e.pendentes.length === 1 && e.chegaram.length === 0);
  assert.throws(() => gas.matar(), /só vale dentro de gas\.exec/);
});

test('morte: depois dela nenhum serviço responde, mesmo que o código capture a exceção (catch e finally não salvam)', () => {
  const { gas, G, id, aba } = cenario();
  const tentativas = [];
  const r = gas.tentar(() => {
    try {
      aba().getRange(1, 1).setValue('antes');
      gas.matar({ chegam: 'todas' });
    } catch (e) {
      // "Recuperação" que um timeout real jamais executaria: tudo o que tocar em serviço falha de novo.
      for (const acao of [
        () => aba().getRange(2, 1).setValue('depois'),
        () => G.SpreadsheetApp.flush(),
        () => G.PropertiesService.getScriptProperties().setProperty('RECUPERADO', 'S'),
        () => G.LockService.getScriptLock().tryLock(10),
        () => G.Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: [{ range: 'T!A3', values: [['api']] }] }, id),
        () => G.Drive.Files.create({ name: 'x', mimeType: 'text/plain' }),
        () => G.Utilities.getUuid(),
      ]) {
        try { acao(); tentativas.push('passou'); } catch (e2) { tentativas.push(e2.execucaoMorta === true ? 'morta' : 'outro erro'); }
      }
    }
    return 'terminou como se nada tivesse acontecido';
  });
  assert.equal(r.morta, true, 'o harness sabe que morreu, mesmo com a exceção engolida');
  assert.deepEqual(tentativas, ['morta', 'morta', 'morta', 'morta', 'morta', 'morta', 'morta']);
  assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T'), [['antes']]);
  assert.equal(gas.props.script.getProperty('RECUPERADO'), null);
  assert.equal(gas.lock.dono(), null);
  assert.equal(gas.exec(() => aba().getRange(1, 1).getValue()), 'antes', 'a execução seguinte funciona normalmente');
});

test('falha injetada na N-ésima escrita: como exceção tratável ou como morte', () => {
  const { gas, G, id, aba } = cenario();
  // Exceção tratável: a escrita não é aplicada e o código pode reagir.
  gas.falhas.falharNaEscrita(2);
  const tratou = gas.exec(() => {
    aba().getRange(1, 1).setValue('1');
    try { aba().getRange(2, 1).setValue('2'); return 'não falhou'; } catch (e) { aba().getRange(3, 1).setValue('3'); return e.message; }
  });
  assert.match(tratou, /Service Spreadsheets failed while accessing document with id/);
  assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T').map((l) => l[0]), [1, '', 3]);
  // Filtro por aba e mensagem própria; a contagem só olha as escritas que casam.
  gas.exec(() => G.SpreadsheetApp.openById(id).insertSheet('OUTRA'));
  gas.falhas.falharNaEscrita(1, { aba: 'OUTRA', mensagem: 'cota estourada' });
  assert.throws(() => gas.exec(() => { aba().getRange(4, 1).setValue('4'); G.SpreadsheetApp.openById(id).getSheetByName('OUTRA').getRange(1, 1).setValue('x'); }), /cota estourada/);
  assert.equal(gas.planilhas.matrizDuravel(id, 'T')[3][0], 4);
  // Morte na 3ª escrita, sem incluir a própria: das 2 pendentes chega só a segunda.
  gas.falhas.matarNaEscrita(3, { chegam: [1] });
  const r = gas.tentar(() => { for (let i = 5; i <= 8; i++) aba().getRange(i, 1).setValue('m' + i); });
  assert.equal(r.morta, true);
  assert.deepEqual(r.pendentes.map((p) => p.intervalo), ['A5', 'A6']);
  assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T').slice(4).map((l) => l[0]), ['', 'm6']);
  // Morte incluindo a própria escrita, com todas chegando: é a queda logo depois do último setValues.
  gas.falhas.matarNaEscrita(2, { chegam: 'todas', incluiAtual: true });
  const r2 = gas.tentar(() => { for (let i = 9; i <= 12; i++) aba().getRange(i, 1).setValue('n' + i); });
  assert.equal(r2.morta, true);
  assert.deepEqual(r2.pendentes.map((p) => p.intervalo), ['A9', 'A10']);
  assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T').slice(8).map((l) => l[0]), ['n9', 'n10']);
  // API: morte antes da chamada (nada gravado) × depois dela (gravado, resposta perdida).
  const chamada = (texto) => () => G.Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: [{ range: 'OUTRA!A1', values: [[texto]] }] }, id);
  gas.falhas.matarNaEscrita(1, { aba: 'OUTRA' });
  assert.equal(gas.tentar(chamada('antes')).morta, true);
  assert.deepEqual(gas.planilhas.matrizDuravel(id, 'OUTRA'), []);
  gas.falhas.matarNaEscrita(1, { tipo: 'api', incluiAtual: true });
  assert.equal(gas.tentar(chamada('resposta perdida')).morta, true);
  assert.deepEqual(gas.planilhas.matrizDuravel(id, 'OUTRA'), [['resposta perdida']]);
  // Regras consumidas não sobram; limpar() remove as que ainda não dispararam.
  gas.falhas.falharNaEscrita(1);
  gas.falhas.limpar();
  assert.equal(gas.exec(() => { aba().getRange(1, 2).setValue('ok'); return 'ok'; }), 'ok');
  assert.ok(gas.falhas.escritas() > 15);
});

test('gancho de flush: matar entre a fase que anexou e a que confirmaria', () => {
  const { gas, G, id, aba } = cenario();
  const visto = [];
  gas.ganchos.em('escrita', (info) => visto.push(info.tipo + ':' + info.intervalo), { vezes: 3 });
  gas.ganchos.em('flush', () => gas.matar({ chegam: 1 })); // morre no primeiro flush; só a primeira pendente chega
  const r = gas.tentar(() => {
    aba().getRange(1, 1).setValue('fase A: operação');
    aba().getRange(2, 1).setValue('fase A: evento');
    G.SpreadsheetApp.flush();
    aba().getRange(3, 1).setValue('fase B: confirmada');
  });
  assert.equal(r.morta, true);
  assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T'), [['fase A: operação']]);
  assert.deepEqual(visto, ['valores:A1', 'valores:A2']);
  // Gancho de uma vez só: a execução seguinte descarrega normalmente.
  gas.exec(() => { aba().getRange(2, 1).setValue('de novo'); G.SpreadsheetApp.flush(); });
  assert.equal(gas.planilhas.matrizDuravel(id, 'T')[1][0], 'de novo');
  const cancelar = gas.ganchos.em('flush', () => { throw new Error('não deveria disparar'); });
  cancelar();
  gas.exec(() => G.SpreadsheetApp.flush());
});

// ------------------------------------------------------------------ lock ----
test('lock: outra execução segura; tryLock devolve false e waitLock lança depois de esperar o tempo pedido', () => {
  const gas = createGas();
  const G = gas.G;
  gas.lock.segurarPorOutra();
  assert.equal(gas.lock.dono(), 'outra');
  const t0 = gas.clock.now;
  assert.equal(gas.exec(() => G.LockService.getScriptLock().tryLock(5000)), false);
  assert.equal(gas.clock.now - t0, 5000, 'a espera consome relógio');
  assert.throws(() => gas.exec(() => G.LockService.getScriptLock().waitLock(25000)), /Lock timeout: another process was holding the lock for too long/);
  assert.equal(gas.clock.now - t0, 30000);
  gas.lock.soltarOutra();
  assert.equal(gas.exec(() => { const l = G.LockService.getScriptLock(); const ok = l.tryLock(1000); return ok && l.hasLock(); }), true);
  assert.equal(gas.clock.now - t0, 30000, 'lock livre não espera');
  // A outra execução termina no meio da espera: quem esperava consegue.
  gas.lock.segurarPorOutra({ liberaEmMs: 3000 });
  const t1 = gas.clock.now;
  assert.equal(gas.exec(() => { G.LockService.getScriptLock().waitLock(25000); return G.LockService.getScriptLock().hasLock(); }), true);
  assert.equal(gas.clock.now - t1, 3000);
  gas.lock.segurarPorOutra({ liberaEmMs: 30000 });
  assert.equal(gas.exec(() => G.LockService.getScriptLock().tryLock(25000)), false, 'libera tarde demais');
  gas.lock.soltarOutra();
  assert.deepEqual(gas.lock.estatisticas().tentativas, [5000, 25000, 1000, 25000, 25000]);
});

test('lock: cai ao fim da execução — fim normal, exceção ou morte', () => {
  const gas = createGas();
  const G = gas.G;
  gas.exec(() => { G.LockService.getScriptLock().waitLock(1000); });
  assert.equal(gas.lock.dono(), null, 'fim normal sem releaseLock');
  assert.throws(() => gas.exec(() => { G.LockService.getScriptLock().waitLock(1000); throw new Error('falhou com o lock na mão'); }));
  assert.equal(gas.lock.dono(), null, 'exceção');
  assert.equal(gas.tentar(() => { G.LockService.getScriptLock().waitLock(1000); gas.matar(); }).morta, true);
  assert.equal(gas.lock.dono(), null, 'morte');
  const e = gas.lock.estatisticas();
  assert.equal(e.aquisicoes, 3);
  assert.equal(e.liberacoes, 3);
  // Código do teste fora de exec também é uma execução: o lock que ele pegar cai quando a próxima começa.
  assert.equal(G.LockService.getScriptLock().tryLock(1000), true);
  assert.equal(typeof gas.lock.dono(), 'number');
  assert.equal(gas.exec(() => G.LockService.getScriptLock().tryLock(1000)), true, 'a execução seguinte não fica trancada para fora');
  assert.equal(gas.lock.dono(), null);
  assert.equal(gas.lock.estatisticas().liberacoes, 5);
  // releaseLock explícito conta uma vez só; soltar sem ter não faz nada.
  gas.exec(() => { const l = G.LockService.getScriptLock(); l.waitLock(1000); l.releaseLock(); l.releaseLock(); assert.equal(l.hasLock(), false); });
  assert.equal(gas.lock.estatisticas().liberacoes, 6);
  assert.throws(() => gas.exec(() => G.LockService.getScriptLock().tryLock()), /don't match the method signature/);
});

test('lock com intercalação: outra execução entra entre "ler o marcador" e "obter o lock"', () => {
  const { gas, G, id, aba } = cenario();
  const props = () => G.PropertiesService.getScriptProperties();
  gas.exec(() => { aba().getRange(1, 1).setNumberFormat('@').setValue('seq'); });
  // Código ingênuo: decide com o que leu ANTES do lock.
  function proximoSeqIngenuo() {
    const visto = props().getProperty('ULTIMO_SEQ');
    const ultimaLinhaVista = aba().getLastRow();
    G.LockService.getScriptLock().waitLock(25000);
    const seq = Number(visto || 0) + 1;
    aba().getRange(ultimaLinhaVista + 1, 1).setValue(seq);
    props().setProperty('ULTIMO_SEQ', String(seq));
    return seq;
  }
  // Código correto: relê tudo com o lock na mão.
  function proximoSeqCorreto() {
    G.LockService.getScriptLock().waitLock(25000);
    const seq = Number(props().getProperty('ULTIMO_SEQ') || 0) + 1;
    aba().getRange(aba().getLastRow() + 1, 1).setValue(seq);
    props().setProperty('ULTIMO_SEQ', String(seq));
    return seq;
  }
  // Troca de execução exatamente antes de A obter o lock: B roda inteira (lê, trava, grava, descarrega, solta).
  let seqB = null;
  gas.ganchos.em('lock.tentar', () => { seqB = gas.exec(proximoSeqCorreto); });
  const seqA = gas.exec(proximoSeqIngenuo);
  assert.equal(seqB, 1);
  assert.equal(seqA, 1, 'A usou o marcador velho: sequência duplicada');
  assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T').map((l) => l[0]), ['seq', 1], 'e A sobrescreveu a linha de B');
  // Com a releitura sob lock, a mesma intercalação dá sequência e linhas corretas.
  gas.ganchos.em('lock.tentar', () => { seqB = gas.exec(proximoSeqCorreto); });
  const seqA2 = gas.exec(proximoSeqCorreto);
  assert.deepEqual([seqB, seqA2], [2, 3]);
  assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T').map((l) => l[0]), ['seq', 1, 2, 3]);
  assert.equal(gas.props.script.getProperty('ULTIMO_SEQ'), '3');
});

test('lock com intercalação: quem segura o lock exclui a outra execução, que também não vê as escritas pendentes', () => {
  const { gas, G, id, aba } = cenario();
  let vistoPorB = null;
  let lockDeB = null;
  let pendentesDeB = null;
  const a = gas.exec(() => {
    G.LockService.getScriptLock().waitLock(25000);
    aba().getRange(1, 1).setValue('A: ainda não descarregado');
    // Troca de execução no meio da seção crítica de A.
    const t0 = gas.clock.now;
    const r = gas.tentar(() => {
      lockDeB = G.LockService.getScriptLock().tryLock(2000);
      vistoPorB = aba().getLastRow();
      pendentesDeB = gas.pendentes().length;
      return 'B terminou';
    });
    assert.equal(r.valor, 'B terminou');
    assert.equal(gas.clock.now - t0, 2000);
    assert.equal(G.LockService.getScriptLock().hasLock(), true, 'A continua com o lock');
    assert.equal(aba().getLastRow(), 1, 'A volta a ver a própria escrita pendente');
    assert.equal(gas.pendentes().length, 1);
    return 'A terminou';
  });
  assert.equal(a, 'A terminou');
  assert.equal(lockDeB, false, 'B não obtém o lock que A segura');
  assert.equal(vistoPorB, 0, 'B não vê o que A ainda não descarregou');
  assert.equal(pendentesDeB, 0);
  assert.deepEqual(gas.planilhas.matrizDuravel(id, 'T'), [['A: ainda não descarregado']]);
  // Gancho depois de ler propriedade: B muda o marcador logo depois de A ler.
  gas.props.script.setProperty('PENDING_OP:x', '');
  gas.ganchos.em('props.lido', () => { gas.exec(() => G.PropertiesService.getScriptProperties().setProperty('PENDING_OP:x', 'op-de-B')); });
  const lidoPorA = gas.exec(() => {
    const antes = G.PropertiesService.getScriptProperties().getProperties()['PENDING_OP:x'];
    const depois = G.PropertiesService.getScriptProperties().getProperties()['PENDING_OP:x'];
    return [antes, depois];
  });
  assert.deepEqual(plano(lidoPorA), ['', 'op-de-B'], 'quem guarda a primeira leitura trabalha com marcador velho');
});

// ------------------------------------------------------------------ properties ----
test('Properties: limites reais (9 KB por valor, 500 KB no total) e gravação imediata, fora do buffer', () => {
  const { gas, G, aba } = cenario();
  const sp = () => G.PropertiesService.getScriptProperties();
  gas.exec(() => {
    sp().setProperty('OK', 'x'.repeat(9 * 1024));
    assert.throws(() => sp().setProperty('GRANDE', 'x'.repeat(9 * 1024 + 1)), /Argument too large/);
    assert.throws(() => sp().setProperty('ACENTO', 'ç'.repeat(5000)), /Argument too large/, 'o limite é em bytes');
    assert.equal(sp().getProperty('GRANDE'), null);
    assert.equal(sp().getProperty('NAO_EXISTE'), null);
    sp().setProperties({ A: 1, B: 'dois' });
    assert.deepEqual(plano(sp().getProperties()), { OK: 'x'.repeat(9216), A: '1', B: 'dois' });
    assert.deepEqual(plano(sp().getKeys()).sort(), ['A', 'B', 'OK']);
    sp().deleteProperty('OK');
    for (let i = 0; i < 56; i++) sp().setProperty('K' + String(i).padStart(2, '0'), 'y'.repeat(9000));
    assert.throws(() => sp().setProperty('K99', 'y'.repeat(9000)), /exceeded the property storage quota/);
    assert.equal(sp().getProperty('K99'), null, 'a gravação que estourou a cota não ficou');
    sp().deleteAllProperties();
    assert.deepEqual(plano(sp().getKeys()), []);
  });
  // Propriedade gravada antes da morte fica; a escrita de planilha pendente não.
  const r = gas.tentar(() => { aba().getRange(1, 1).setValue('pendente'); sp().setProperty('DATA_VERSION:x', '7'); gas.matar(); });
  assert.equal(r.morta, true);
  assert.equal(gas.props.script.getProperty('DATA_VERSION:x'), '7');
  assert.equal(aba().getLastRow(), 0);
  assert.notEqual(G.PropertiesService.getUserProperties(), G.PropertiesService.getScriptProperties());
});

// ------------------------------------------------------------------ Drive ----
test('Drive v3: árvore de pastas, create, copy, update, get e list', () => {
  const gas = createGas();
  const { Drive } = gas.G;
  const PASTA = gas.drive.MIME_PASTA;
  const PLAN = gas.drive.MIME_PLANILHA;
  const ids = gas.exec(() => {
    const raiz = Drive.Files.create({ name: 'ERP Pecuário', mimeType: PASTA });
    assert.deepEqual(Object.keys(plano(raiz)), ['kind', 'id', 'name', 'mimeType'], 'campos padrão da resposta');
    const backups = Drive.Files.create({ name: 'Backups', mimeType: PASTA, parents: [raiz.id] }, null, { fields: 'id,parents' });
    assert.deepEqual(plano(backups.parents), [raiz.id]);
    const anexos = Drive.Files.create({ name: 'Anexos', mimeType: PASTA, parents: [raiz.id] });
    const banco = Drive.Files.create({ name: 'ERP Pecuário — Banco', mimeType: PLAN, parents: [raiz.id], appProperties: { papel: 'BANCO' } });
    const foto = Drive.Files.create({ name: 'foto.jpg', parents: [anexos.id] }, gas.G.Utilities.newBlob([-1, -40, -1, 0, 16], 'image/jpeg', 'foto.jpg'), { fields: 'id,mimeType,size' });
    assert.deepEqual(plano(foto), { id: foto.id, mimeType: 'image/jpeg', size: '5' });
    return { raiz: raiz.id, backups: backups.id, anexos: anexos.id, banco: banco.id, foto: foto.id };
  });
  assert.deepEqual(gas.drive.arvore(), ['ERP Pecuário/', 'ERP Pecuário/Anexos/', 'ERP Pecuário/Anexos/foto.jpg', 'ERP Pecuário/Backups/', 'ERP Pecuário/ERP Pecuário — Banco']);
  assert.equal(gas.planilhas.existe(ids.banco), true, 'a planilha criada pelo Drive abre no SpreadsheetApp');
  gas.exec(() => gas.G.SpreadsheetApp.openById(ids.banco).getSheets()[0].getRange(1, 1).setNumberFormat('@').setValue('0012'));
  // copy: cópia profunda da planilha, na pasta pedida.
  const copia = gas.exec(() => Drive.Files.copy({ name: 'backup-2026-11-13', parents: [ids.backups] }, ids.banco, { fields: 'id,name,mimeType,parents' }));
  assert.deepEqual(plano(copia), { id: copia.id, name: 'backup-2026-11-13', mimeType: PLAN, parents: [ids.backups] });
  gas.exec(() => gas.G.SpreadsheetApp.openById(ids.banco).getSheets()[0].getRange(1, 1).setValue('mudou depois'));
  assert.deepEqual(gas.planilhas.matriz(copia.id, 'Página1'), [['0012']], 'a cópia não acompanha o original');
  assert.deepEqual(gas.planilhas.formatos(copia.id, 'Página1'), [['@']]);
  // A cópia é do que está no servidor: escrita pendente do original não entra.
  const outra = gas.exec(() => {
    gas.G.SpreadsheetApp.openById(ids.banco).getSheets()[0].getRange(2, 1).setValue('pendente');
    return Drive.Files.copy({ name: 'backup-sem-flush', parents: [ids.backups] }, ids.banco).id;
  });
  assert.equal(gas.planilhas.matriz(outra, 'Página1').length, 1);
  assert.equal(gas.planilhas.matriz(ids.banco, 'Página1').length, 2);
  // update: renomear, mover, lixeira, appProperties.
  gas.exec(() => {
    const u = Drive.Files.update({ name: 'foto-0412.jpg', appProperties: { animal: 'A-000123' } }, ids.foto, null, { addParents: ids.backups, removeParents: ids.anexos, fields: 'name,parents,appProperties' });
    assert.deepEqual(plano(u), { name: 'foto-0412.jpg', parents: [ids.backups], appProperties: { animal: 'A-000123' } });
    Drive.Files.update({ trashed: true }, outra);
    assert.equal(Drive.Files.get(outra, { fields: 'trashed' }).trashed, true);
    assert.throws(() => Drive.Files.update({ name: '' }, ids.foto), /Invalid value for field name/);
    assert.throws(() => Drive.Files.get('nao-existe'), /File not found: nao-existe/);
    assert.throws(() => Drive.Files.get(ids.foto, { fields: 'id,permissions' }), /Invalid field selection/);
    assert.throws(() => Drive.Files.create({ name: 'x', mimeType: 'text/plain', parents: [ids.foto] }), /not a folder/);
    assert.throws(() => Drive.Files.create({ mimeType: PASTA }), /Invalid value for field name/);
    assert.throws(() => Drive.Files.copy({}, ids.backups), /cannot be copied/);
  });
  assert.deepEqual(gas.drive.arvore(), ['ERP Pecuário/', 'ERP Pecuário/Anexos/', 'ERP Pecuário/Backups/', 'ERP Pecuário/Backups/backup-2026-11-13', 'ERP Pecuário/Backups/foto-0412.jpg', 'ERP Pecuário/ERP Pecuário — Banco']);
  // list: consulta por pasta, tipo, nome, lixeira e appProperties; ordenação e paginação.
  gas.exec(() => {
    const q = (texto, extra) => plano(Drive.Files.list(Object.assign({ q: texto, fields: 'files(id,name)' }, extra || {})).files).map((f) => f.name);
    assert.deepEqual(q("'" + ids.backups + "' in parents and trashed = false", { orderBy: 'name' }), ['backup-2026-11-13', 'foto-0412.jpg']);
    assert.deepEqual(q("'" + ids.backups + "' in parents", { orderBy: 'name desc' }), ['foto-0412.jpg', 'backup-sem-flush', 'backup-2026-11-13'], 'a lixeira aparece se a consulta não a exclui');
    assert.deepEqual(q("'" + ids.raiz + "' in parents and mimeType = '" + PASTA + "' and name = 'Backups'"), ['Backups']);
    // A cópia herda as appProperties do original (hipótese): quem acha o banco por elas precisa remarcar o backup.
    assert.deepEqual(q("mimeType = '" + PLAN + "' and trashed = false and appProperties has { key='papel' and value='BANCO' }", { orderBy: 'name' }), ['ERP Pecuário — Banco', 'backup-2026-11-13']);
    Drive.Files.update({ appProperties: { papel: 'BACKUP' } }, copia.id);
    assert.deepEqual(q("mimeType = '" + PLAN + "' and trashed = false and appProperties has { key='papel' and value='BANCO' }"), ['ERP Pecuário — Banco']);
    assert.deepEqual(q("appProperties has { key='papel' and value='BACKUP' }"), ['backup-2026-11-13']);
    assert.deepEqual(q("name contains 'backup' and mimeType != '" + PASTA + "'", { orderBy: 'name' }), ['backup-2026-11-13', 'backup-sem-flush']);
    const p1 = Drive.Files.list({ q: 'trashed = false', pageSize: 2, orderBy: 'name' });
    assert.equal(p1.files.length, 2);
    assert.equal(typeof p1.nextPageToken, 'string');
    const p2 = Drive.Files.list({ q: 'trashed = false', pageSize: 2, orderBy: 'name', pageToken: p1.nextPageToken });
    assert.notEqual(p2.files[0].id, p1.files[0].id);
    assert.throws(() => Drive.Files.list({ q: "fullText contains 'gado'" }), /cláusula de consulta não emulada/, 'consulta não emulada falha em vez de filtrar errado');
    Drive.Files.remove(outra);
    assert.throws(() => Drive.Files.get(outra), /File not found/);
  });
  assert.equal(gas.planilhas.existe(outra), false);
  assert.ok(gas.drive.chamadas.some((c) => c.metodo === 'copy' && c.origem === ids.banco));
});

test('Drive sob drive.file: arquivo que o app não criou é invisível, inclusive para o SpreadsheetApp', () => {
  const gas = createGas();
  const { Drive, SpreadsheetApp, Sheets } = gas.G;
  const externa = gas.drive.plantarExterno({ name: 'Planilha copiada à mão', mimeType: gas.drive.MIME_PLANILHA });
  const texto = gas.drive.plantarExterno({ name: 'notas.txt', conteudo: 'segredo' });
  gas.exec(() => {
    assert.throws(() => Drive.Files.get(externa), /File not found/);
    assert.throws(() => Drive.Files.copy({ name: 'backup' }, externa), /File not found/);
    assert.throws(() => Drive.Files.update({ trashed: true }, texto), /File not found/);
    assert.throws(() => Drive.Files.create({ name: 'x', mimeType: 'text/plain', parents: [externa] }), /File not found/);
    assert.deepEqual(plano(Drive.Files.list({}).files), []);
    assert.throws(() => SpreadsheetApp.openById(externa), /do not have permission/);
    assert.throws(() => Sheets.Spreadsheets.get(externa), /does not have permission/);
  });
  assert.deepEqual(gas.drive.arvore(), ['Planilha copiada à mão', 'notas.txt'], 'o arquivo existe no Drive do dono; só não é do app');
});

test('UrlFetchApp: alt=media e export da API do Drive, com token; export() do serviço avançado não devolve conteúdo', () => {
  const { gas, G, id, aba } = cenario();
  const { Drive, UrlFetchApp, ScriptApp } = G;
  const base = 'https://www.googleapis.com/drive/v3/files/';
  const auth = () => ({ headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  gas.exec(() => aba().getRange(1, 1, 2, 2).setNumberFormat('@').setValues([['brinco', 'nome']]. concat([['0012', 'Mimosa, a "braba"']])));
  const foto = gas.exec(() => Drive.Files.create({ name: 'foto.jpg' }, G.Utilities.newBlob([-1, -40, -1, 0, 16, 127], 'image/jpeg', 'foto.jpg')).id);
  gas.exec(() => {
    // alt=media: os bytes exatos, com sinal, como o Apps Script devolve.
    const r = UrlFetchApp.fetch(base + foto + '?alt=media', auth());
    assert.equal(r.getResponseCode(), 200);
    assert.deepEqual(plano(r.getContent()), [-1, -40, -1, 0, 16, 127]);
    assert.equal(r.getBlob().getContentType(), 'image/jpeg');
    assert.equal(JSON.parse(UrlFetchApp.fetch(base + foto + '?fields=id,name', auth()).getContentText()).name, 'foto.jpg');
    // Sem token, token errado e arquivo inexistente.
    assert.equal(UrlFetchApp.fetch(base + foto + '?alt=media', { muteHttpExceptions: true }).getResponseCode(), 401);
    assert.equal(UrlFetchApp.fetch(base + foto + '?alt=media', { headers: { Authorization: 'Bearer outro' }, muteHttpExceptions: true }).getResponseCode(), 401);
    assert.equal(UrlFetchApp.fetch(base + 'nao-existe?alt=media', auth()).getResponseCode(), 404);
    assert.throws(() => UrlFetchApp.fetch(base + 'nao-existe?alt=media', { headers: auth().headers }), /returned code 404/, 'sem muteHttpExceptions o erro HTTP vira exceção');
    // Planilha não tem bytes: é exportação.
    assert.equal(UrlFetchApp.fetch(base + id + '?alt=media', auth()).getResponseCode(), 403);
    assert.throws(() => Drive.Files.get(id, { alt: 'media' }), /Use Export with Docs Editors files/);
    const csv = UrlFetchApp.fetch(base + id + '/export?mimeType=' + encodeURIComponent('text/csv'), auth());
    assert.equal(csv.getResponseCode(), 200);
    assert.equal(csv.getContentText(), '');
    const xlsx = UrlFetchApp.fetch(base + id + '/export?mimeType=' + encodeURIComponent(gas.drive.MIME_XLSX), auth());
    assert.deepEqual(plano(xlsx.getContent()).slice(0, 4), [80, 75, 3, 4], 'assinatura de arquivo zip');
    assert.match(xlsx.getContentText(), /Mimosa/);
    assert.match(UrlFetchApp.fetch(base + id + '/export?mimeType=application/pdf', auth()).getContentText(), /^%PDF-/);
    assert.equal(UrlFetchApp.fetch(base + id + '/export', auth()).getResponseCode(), 400);
    assert.equal(UrlFetchApp.fetch(base + id + '/export?mimeType=image/png', auth()).getResponseCode(), 400);
    assert.equal(UrlFetchApp.fetch(base + foto + '/export?mimeType=application/pdf', auth()).getResponseCode(), 403, 'arquivo binário não se exporta');
    // Pelos tipos, Drive.Files.export devolve void: o conteúdo só sai pela rota REST.
    assert.equal(Drive.Files.export(id, 'application/pdf'), undefined);
    assert.throws(() => Drive.Files.export(foto, 'application/pdf'), /Export only supports Docs Editors files/);
    // Host fora da API do Drive: sem handler registrado, a chamada falha (nada sai para a rede).
    assert.throws(() => UrlFetchApp.fetch('https://exemplo.com/'), /nenhum handler HTTP registrado/);
  });
  // A primeira aba é a Página1 (vazia): o CSV exporta a primeira aba, como a API.
  gas.exec(() => G.SpreadsheetApp.openById(id).deleteSheet(G.SpreadsheetApp.openById(id).getSheetByName('Página1')));
  const csv2 = gas.exec(() => UrlFetchApp.fetch(base + id + '/export?mimeType=text/csv', auth()).getContentText());
  assert.equal(csv2, 'brinco,nome\r\n0012,"Mimosa, a ""braba"""');
  // Teto de exportação de 10 MB.
  gas.drive.definirTamanhoExportado(id, 10 * 1024 * 1024 + 1);
  assert.equal(gas.exec(() => UrlFetchApp.fetch(base + id + '/export?mimeType=application/pdf', auth()).getResponseCode()), 403);
  assert.ok(gas.http.calls.length >= 15 && gas.http.calls.every((c) => c.method === 'get'));
  // Handler próprio do teste para outros hosts.
  gas.http.handler = (req) => (req.url === 'https://exemplo.com/ok' ? { code: 200, body: { ok: true } } : null);
  assert.deepEqual(JSON.parse(gas.exec(() => UrlFetchApp.fetch('https://exemplo.com/ok').getContentText())), { ok: true });
});

// ------------------------------------------------------------------ gatilhos e portas ----
test('ScriptApp: gatilhos por função, com a cota de 20; portas falsas para o domínio puro', () => {
  const gas = createGas();
  const { ScriptApp } = gas.G;
  gas.exec(() => {
    ScriptApp.newTrigger('trgManutencaoDiaria').timeBased().everyDays(1).atHour(3).inTimezone('America/Porto_Velho').create();
    ScriptApp.newTrigger('trgIntegridadeSemanal').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(4).create();
  });
  assert.deepEqual(gas.triggers.map((t) => t.getHandlerFunction()), ['trgManutencaoDiaria', 'trgIntegridadeSemanal']);
  assert.deepEqual(gas.triggers[0]._spec, { handler: 'trgManutencaoDiaria', type: 'CLOCK', everyDays: 1, atHour: 3, timezone: 'America/Porto_Velho' });
  gas.exec(() => ScriptApp.deleteTrigger(ScriptApp.getProjectTriggers()[0]));
  assert.equal(gas.triggers.length, 1);
  assert.throws(() => gas.exec(() => { for (let i = 0; i < 20; i++) ScriptApp.newTrigger('f' + i).timeBased().everyHours(1).create(); }), /too many triggers/);
  assert.equal(gas.triggers.length, 20);
  const p = gas.portas();
  assert.equal(p.hash.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(p.clock.agora(), '2026-11-13T14:00:00.000Z');
  assert.equal(p.clock.agoraMs(), RELOGIO_PADRAO);
  assert.match(p.idGen.uuid(), /^00000000-0000-4000-8000-0000000000\d\d$/);
  assert.equal(gas.G.Validation.validarValor(gas.G.Schema.coluna('PASTOS', 'pasture_id'), p.idGen.uuid()), null, 'os IDs do harness passam como ID do Schema');
});
