'use strict';
/**
 * Database: codec de tipos ("valor lido === valor gravado"), corpus de ida e volta nas três primitivas, o fake
 * que denuncia o adaptador que esquece o tipo, operações da porta de E/S e as portas reais da execução.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, ORDENS } = require('./harness');
const { js } = require('./apoio-persistencia');

const PRIMITIVAS = ['SHEETS_TYPED', 'SHEETS_RAW', 'SPREADSHEET_APP'];
const col = (tipo, nome) => ({ nome: nome || 'c_' + tipo.toLowerCase(), tipo });
const serial = (a, m, d) => (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;

function codigoDe(fn) {
  try {
    fn();
  } catch (e) {
    return e.code || e.name;
  }
  return null;
}

// ------------------------------------------------------------------ codec ----
test('codec: ida e volta devolve exatamente o valor da lógica, em todos os tipos', () => {
  const D = createGas().G.Database;
  const casos = [
    ['ID', '3f2b8c1e-7a4d-4e9b-9c55-0d6a1f2e8b47'], ['TEXTO', '0012'], ['TEXTO', '=1+1'], ['TEXTO', '  espaços  '],
    ['DATA', '2026-11-13'], ['TS', '2026-11-14T01:30:00.000Z'], ['ENUM', 'ATIVO'], ['INT', -3], ['DEC1', 387.5],
    ['DEC4', 0.035], ['DINHEIRO', 123456], ['DINHEIRO', 1], ['BOOL', true], ['BOOL', false],
    ['JSON', { a: [1, 'x', null, true], b: { c: 'ç' } }], ['JSON', []],
  ];
  for (const [tipo, valor] of casos) {
    const c = col(tipo);
    const celula = D.codificar(c, valor);
    const lido = js(D.decodificar(c, celula, () => 'America/Porto_Velho'));
    assert.deepEqual(lido, { valor, alerta: null }, tipo + ' ' + JSON.stringify(valor));
  }
  for (const tipo of ['ID', 'TEXTO', 'DATA', 'TS', 'ENUM', 'INT', 'DEC1', 'DEC4', 'DINHEIRO', 'BOOL', 'JSON']) {
    assert.equal(D.codificar(col(tipo), null), '');
    assert.equal(D.codificar(col(tipo), ''), '');
    assert.deepEqual(js(D.decodificar(col(tipo), '', () => 'UTC')), { valor: null, alerta: null });
  }
  assert.equal(D.codificar(col('DINHEIRO'), 2030000), 20300, 'dinheiro vai à planilha em reais');
  assert.equal(D.codificar(col('BOOL'), true), 'S');
  assert.equal(D.codificar(col('JSON'), { b: 1 }), '{"b":1}');
});

test('codec: valor de tipo errado ou objeto de data é recusado antes de gravar (INTERNAL)', () => {
  const D = createGas().G.Database;
  const recusados = [
    ['TEXTO', 12], ['ID', true], ['DATA', new Date(0)], ['TS', new Date(0)], ['INT', '12'], ['DEC1', NaN],
    ['DINHEIRO', 12.5], ['DINHEIRO', '100'], ['BOOL', 'S'], ['JSON', 'texto'], ['JSON', { d: new Date(0) }],
  ];
  for (const [tipo, valor] of recusados) assert.equal(codigoDe(() => D.codificar(col(tipo), valor)), 'INTERNAL', tipo + ' ' + String(valor));
  assert.equal(codigoDe(() => D.codificar(col('XPTO'), 'a')), 'INTERNAL');
});

test('codec: leitura normaliza pelo tipo declarado e relata a célula coercida ou o erro de integridade', () => {
  const gas = createGas();
  const D = gas.G.Database;
  const fuso = () => 'America/Porto_Velho';
  const ler = (tipo, celula) => js(D.decodificar(col(tipo), celula, fuso));
  const dataNativa = gas.run('new Date(Date.UTC(2026, 10, 13, 4, 0, 0))'); // 00:00 de 13/11 em Porto Velho
  let r = ler('DATA', dataNativa);
  assert.deepEqual([r.valor, r.alerta.nivel, r.alerta.codigo], ['2026-11-13', 'COERCIDA', 'DATA_NATIVA']);
  r = ler('DATA', serial(2026, 11, 13));
  assert.deepEqual([r.valor, r.alerta.nivel], ['2026-11-13', 'COERCIDA']);
  r = ler('TS', dataNativa);
  assert.deepEqual([r.valor, r.alerta.codigo], ['2026-11-13T04:00:00.000Z', 'INSTANTE_NATIVO']);
  r = ler('TS', serial(2026, 11, 13) + 0.5); // meio-dia de parede em Porto Velho = 16:00 UTC
  assert.equal(r.valor, '2026-11-13T16:00:00.000Z');
  r = ler('TEXTO', 12);
  assert.deepEqual([r.valor, r.alerta.nivel, r.alerta.codigo], ['12', 'ERRO', 'TEXTO_VIROU_NUMERO']);
  r = ler('ENUM', true);
  assert.equal(r.alerta.codigo, 'TEXTO_VIROU_BOOLEANO');
  r = ler('INT', '12');
  assert.deepEqual([r.valor, r.alerta.nivel, r.alerta.codigo], [12, 'COERCIDA', 'NUMERO_COMO_TEXTO']);
  r = ler('DINHEIRO', '1234,56');
  assert.deepEqual([r.valor, r.alerta.nivel], [123456, 'COERCIDA']);
  r = ler('DEC1', 'dez');
  assert.deepEqual([r.valor, r.alerta.nivel, r.alerta.codigo], [null, 'ERRO', 'NUMERO_INVALIDO']);
  r = ler('BOOL', true);
  assert.deepEqual([r.valor, r.alerta.nivel, r.alerta.codigo], [true, 'COERCIDA', 'BOOLEANO_NATIVO']);
  assert.equal(ler('BOOL', 'X').alerta.codigo, 'BOOLEANO_INVALIDO');
  assert.equal(ler('JSON', '{quebrado').alerta.codigo, 'JSON_INVALIDO');
  assert.equal(ler('JSON', '5').alerta.codigo, 'JSON_INVALIDO');
  assert.equal(ler('DATA', '13/11/2026').alerta.codigo, 'DATA_INVALIDA');
  assert.equal(ler('TS', '2026-11-13').alerta.codigo, 'INSTANTE_INVALIDO');
});

test('codec: texto de AUDITORIA no formato de célula do tipo, com volta exata; texto adulterado é INTERNAL', () => {
  const D = createGas().G.Database;
  assert.equal(D.paraTexto(col('DINHEIRO'), 2030000), '20300.00');
  assert.equal(D.deTexto(col('DINHEIRO'), '20300.00'), 2030000);
  assert.equal(D.paraTexto(col('BOOL'), false), 'N');
  assert.equal(D.deTexto(col('BOOL'), 'N'), false);
  assert.equal(D.paraTexto(col('DEC4'), 38.5), '38.5');
  assert.equal(D.deTexto(col('DEC4'), '38.5'), 38.5);
  assert.deepEqual(js(D.deTexto(col('JSON'), '[1,"a"]')), [1, 'a']);
  assert.equal(D.paraTexto(col('TEXTO'), null), '');
  assert.equal(D.deTexto(col('DATA'), ''), null);
  assert.equal(codigoDe(() => D.deTexto(col('INT'), 'doze')), 'INTERNAL');
  assert.equal(codigoDe(() => D.deTexto(col('DATA'), '13/11/2026')), 'INTERNAL');
});

// ------------------------------------------------------------------ corpus ----
for (const order of ORDENS) {
  for (const primitiva of PRIMITIVAS) {
    test('corpus de tipos volta idêntico pela primitiva ' + primitiva + ' (carga ' + order + ')', () => {
      const gas = createGas({ order });
      const G = gas.G;
      const banco = gas.planilhas.criar('Corpus');
      const r = js(gas.exec(() => G.Database.corpus(banco, primitiva)));
      assert.equal(r.primitiva, primitiva);
      assert.deepEqual(r.divergencias, []);
      assert.deepEqual(r.alertas, []);
      assert.equal(r.ok, true);
      assert.equal(r.casos, G.Database.CORPUS.length + 1);
      // Os valores perigosos chegaram à planilha como TEXTO, sem interpretação.
      const linhas = gas.planilhas.objetos(banco, 'CORPUS_' + primitiva);
      const porTexto = {};
      linhas.forEach((l) => { porTexto[l.id] = l; });
      for (const [i, texto] of G.Database.CORPUS.entries()) {
        const l = porTexto['caso-' + String(i + 1).padStart(2, '0')];
        assert.equal(l.texto, texto, 'texto do caso ' + (i + 1));
        assert.equal(l.reescrito, texto, 'reescrita do caso ' + (i + 1));
      }
    });
  }
}

test('escolherPrimitiva adota a primeira que passa no corpus, na ordem de preferência', () => {
  const gas = createGas();
  const G = gas.G;
  const banco = gas.planilhas.criar('Corpus');
  let r = js(gas.exec(() => G.Database.escolherPrimitiva(banco)));
  assert.equal(r.primitiva, 'SHEETS_TYPED');
  assert.equal(r.resultados.length, 1);
  // Sem o serviço avançado (batchUpdate falha), as duas da Sheets API reprovam e fica a do SpreadsheetApp.
  const original = G.Sheets.Spreadsheets.batchUpdate;
  G.Sheets.Spreadsheets.batchUpdate = () => { throw gas.run('new Error("Sheets API has not been used in project")'); };
  try {
    const outro = gas.planilhas.criar('Corpus 2');
    r = js(gas.exec(() => G.Database.escolherPrimitiva(outro)));
  } finally {
    G.Sheets.Spreadsheets.batchUpdate = original;
  }
  assert.equal(r.primitiva, 'SPREADSHEET_APP');
  assert.deepEqual(r.resultados.map((x) => [x.primitiva, x.ok]), [['SHEETS_TYPED', false], ['SHEETS_RAW', false], ['SPREADSHEET_APP', true]]);
  assert.match(r.resultados[0].erro, /Sheets API/);
});

test('o fake denuncia o adaptador que esquece o tipo: setValues sem formato de texto e USER_ENTERED', () => {
  const gas = createGas();
  const G = gas.G;
  const D = G.Database;
  const casos = js(D.corpusRegistros());
  const def = D.corpusDefinicao('ESQUECE');
  const celulas = casos.map((r) => def.colunas.map((c) => D.codificar(c, r[c.nome])));
  const divergentes = (rel) => {
    const por = {};
    rel.divergencias.forEach((d) => { (por[d.id] = por[d.id] || []).push(d.coluna); });
    return por;
  };
  for (const forma of ['setValues', 'USER_ENTERED']) {
    const banco = gas.planilhas.criar('Esquece ' + forma);
    const rel = js(gas.exec(() => {
      D.abrir(banco, { primitiva: 'SPREADSHEET_APP', tabelas: { ESQUECE: def } }).criarTabelas(['ESQUECE']);
      G.SpreadsheetApp.flush(); // a Sheets API não enxerga o que o SpreadsheetApp ainda não descarregou
      if (forma === 'setValues') {
        const sh = G.SpreadsheetApp.openById(banco).getSheetByName('ESQUECE');
        sh.insertRowsAfter(sh.getMaxRows(), celulas.length); // herda o formato da linha livre (Geral), não o do cabeçalho
        sh.getRange(3, 1, celulas.length, def.colunas.length).setValues(celulas); // sem setNumberFormats('@')
      } else {
        G.Sheets.Spreadsheets.batchUpdate({ requests: [{ appendDimension: { sheetId: G.SpreadsheetApp.openById(banco).getSheetByName('ESQUECE').getSheetId(), dimension: 'ROWS', length: celulas.length } }] }, banco);
        G.Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'USER_ENTERED', data: [{ range: "'ESQUECE'!A3", values: celulas }] }, banco);
      }
      G.SpreadsheetApp.flush();
      return D.conferirCorpus(banco, 'SPREADSHEET_APP', 'ESQUECE');
    }));
    assert.equal(rel.ok, false, forma);
    const por = divergentes(rel);
    // Valor diferente do gravado: fórmula, telefone e peso negativo (fórmula com erro), zeros à esquerda,
    // notação científica, hora, porcentagem e o apóstrofo inicial engolido pela planilha.
    for (const caso of ['caso-01', 'caso-02', 'caso-03', 'caso-05', 'caso-06', 'caso-09', 'caso-12', 'caso-13']) {
      assert.ok((por[caso] || []).includes('texto'), forma + ': ' + caso + ' deveria divergir');
    }
    // Mesmo quando a releitura reconstrói o texto (data, TRUE), a célula mudou de tipo e é relatada como erro.
    const codigos = rel.alertas.map((a) => a.codigo);
    for (const c of ['TEXTO_VIROU_NUMERO', 'TEXTO_VIROU_DATA', 'TEXTO_VIROU_BOOLEANO']) assert.ok(codigos.includes(c), forma + ': relata ' + c);
    assert.ok(rel.alertas.some((a) => a.nivel === 'COERCIDA' && a.coluna === 'data'), forma + ': relata data coercida');
  }
});

// ------------------------------------------------------------------ porta de E/S ----
for (const primitiva of PRIMITIVAS) {
  test('porta de E/S (' + primitiva + '): abas na dimensão exata, cabeçalho, anexar, ler e atualizar por linha', () => {
    const gas = createGas();
    const G = gas.G;
    const banco = gas.planilhas.criar('Banco');
    const criadas = js(gas.exec(() => G.Database.abrir(banco, { primitiva }).criarTabelas(['PASTOS', 'ERROS_LOG', 'PASTOS'])));
    assert.deepEqual(criadas, ['PASTOS', 'ERROS_LOG']);
    assert.deepEqual(js(gas.exec(() => G.Database.abrir(banco, { primitiva }).criarTabelas(['PASTOS']))), [], 'não recria');
    const nCol = G.Schema.colunas('PASTOS').length;
    const dim = gas.planilhas.dimensoes(banco, 'PASTOS');
    assert.deepEqual([dim.linhas, dim.colunas, dim.congeladas], [2, nCol, 1]);
    assert.deepEqual(gas.planilhas.matriz(banco, 'PASTOS')[0], js(G.Schema.colunas('PASTOS')));

    const p1 = { pasture_id: 'p-1', property_id: 'prop', nome: '0012', area_hectares: 38.5, capacidade_estimada_cabecas: 40, posse: 'PROPRIO', status: 'ATIVO', created_at: '2026-11-13T14:00:00.000Z', updated_at: '2026-11-13T14:00:00.000Z' };
    const p2 = Object.assign({}, p1, { pasture_id: 'p-2', nome: '=1+1', area_hectares: 12 });
    const out = js(gas.exec(() => {
      const io = G.Database.abrir(banco, { primitiva });
      io.ler(['PASTOS']);
      const onde = io.anexar({ PASTOS: [p1, p2], ERROS_LOG: [] });
      io.flush();
      return { onde, conferido: io.conferirPosicoes([{ tabela: 'PASTOS', linha: onde.PASTOS, id: 'p-1' }, { tabela: 'PASTOS', linha: onde.PASTOS + 1, id: 'p-2' }]), errado: io.conferirPosicoes([{ tabela: 'PASTOS', linha: onde.PASTOS, id: 'p-2' }]) };
    }));
    assert.equal(out.conferido, true);
    assert.equal(out.errado, false);
    let lido = js(gas.exec(() => G.Database.abrir(banco, { primitiva }).ler(['PASTOS', 'ERROS_LOG'])));
    assert.deepEqual(lido.PASTOS.alertas, []);
    assert.deepEqual(lido.ERROS_LOG.registros, []);
    const reg = lido.PASTOS.registros;
    assert.equal(reg.length, 2);
    assert.equal(reg[0].nome, '0012');
    assert.equal(reg[1].nome, '=1+1');
    assert.equal(reg[0].area_hectares, 38.5);
    assert.equal(reg[0].identificacao, null);

    // Atualização: colunas vizinhas de linhas seguidas viram UM bloco (uma escrita na API; formato + valor no SpreadsheetApp).
    const antes = gas.falhas.escritas();
    const n = gas.exec(() => {
      const io = G.Database.abrir(banco, { primitiva });
      const l = io.ler(['PASTOS']).PASTOS.linhas;
      return io.atualizar([
        { tabela: 'PASTOS', linha: l[0], campos: { nome: 'Pasto do Rio', identificacao: 'P1' } },
        { tabela: 'PASTOS', linha: l[1], campos: { identificacao: 'P2', nome: '0013' } },
      ]);
    });
    assert.equal(n, 4);
    assert.equal(gas.falhas.escritas() - antes, primitiva === 'SPREADSHEET_APP' ? 2 : 1);
    lido = js(gas.exec(() => G.Database.abrir(banco, { primitiva }).ler(['PASTOS'])));
    assert.deepEqual(lido.PASTOS.registros.map((r) => [r.nome, r.identificacao, r.area_hectares]), [['Pasto do Rio', 'P1', 38.5], ['0013', 'P2', 12]]);
    assert.equal(codigoDe(() => gas.exec(() => G.Database.abrir(banco, { primitiva }).atualizar([{ tabela: 'PASTOS', linha: 1, campos: { nome: 'x' } }]))), 'INTERNAL', 'a linha 1 é o cabeçalho');
  });
}

test('porta de E/S: mapeamento por nome de cabeçalho, colunas novas ao final e coluna do dono preservada', () => {
  const gas = createGas();
  const G = gas.G;
  const banco = gas.planilhas.criar('Banco');
  const v1 = { nome: 'T', pk: 'id', colunas: [{ nome: 'id', tipo: 'ID' }, { nome: 'a', tipo: 'TEXTO' }] };
  const v2 = { nome: 'T', pk: 'id', colunas: [{ nome: 'id', tipo: 'ID' }, { nome: 'a', tipo: 'TEXTO' }, { nome: 'b', tipo: 'INT' }] };
  gas.exec(() => {
    const io = G.Database.abrir(banco, { tabelas: { T: v1 } });
    io.criarTabelas(['T']);
    io.anexar({ T: [{ id: 'x1', a: 'antigo' }] });
  });
  // O dono acrescenta uma coluna própria ao final; o setup da versão nova acrescenta a dele depois dela.
  gas.planilhas.gravar(banco, 'T', 1, 3, [['minha_coluna']]);
  gas.planilhas.gravar(banco, 'T', 2, 3, [['anotação do dono']]);
  const acrescidas = js(gas.exec(() => G.Database.abrir(banco, { tabelas: { T: v2 } }).acrescentarColunas(['T'])));
  assert.deepEqual(acrescidas, { T: ['b'] });
  assert.deepEqual(js(gas.exec(() => G.Database.abrir(banco, { tabelas: { T: v2 } }).acrescentarColunas(['T']))), { T: [] }, 'idempotente');
  gas.exec(() => G.Database.abrir(banco, { tabelas: { T: v2 } }).anexar({ T: [{ id: 'x2', a: 'novo', b: 7 }] }));
  const m = gas.planilhas.matriz(banco, 'T');
  assert.deepEqual(m[0], ['id', 'a', 'minha_coluna', 'b']);
  assert.deepEqual(m[1], ['x1', 'antigo', 'anotação do dono', '']);
  assert.deepEqual(m[2], ['x2', 'novo', '', 7]);
  // Cabeçalho em outra ordem (o dono reordenou): a leitura segue o nome, não a posição.
  const banco2 = gas.planilhas.criar('Banco 2');
  gas.exec(() => G.Database.abrir(banco2, { tabelas: { T: v2 } }).criarTabelas(['T']));
  gas.planilhas.gravar(banco2, 'T', 1, 1, [['b', 'id', 'a'], ['5', 'y1', 'ok']], '@');
  const lido = js(gas.exec(() => G.Database.abrir(banco2, { tabelas: { T: v2 } }).ler(['T']).T));
  assert.deepEqual(lido.registros, [{ id: 'y1', a: 'ok', b: 5 }]);
  assert.deepEqual(lido.alertas.map((a) => a.codigo), ['NUMERO_COMO_TEXTO'], 'número em célula de texto é relatado e convertido');
});

test('porta de E/S: linha sem chave, coluna ausente, aba ausente e configuração inválida', () => {
  const gas = createGas();
  const G = gas.G;
  const banco = gas.planilhas.criar('Banco');
  const v2 = { nome: 'T', pk: 'id', colunas: [{ nome: 'id', tipo: 'ID' }, { nome: 'a', tipo: 'TEXTO' }, { nome: 'b', tipo: 'INT' }] };
  gas.exec(() => G.Database.abrir(banco, { tabelas: { T: { nome: 'T', pk: 'id', colunas: v2.colunas.slice(0, 2) } } }).criarTabelas(['T']));
  gas.planilhas.gravar(banco, 'T', 2, 1, [['', 'sem chave'], ['z1', 'com chave']], '@');
  const lido = js(gas.exec(() => G.Database.abrir(banco, { tabelas: { T: v2 } }).ler(['T']).T));
  assert.deepEqual(lido.registros, [{ id: 'z1', a: 'com chave', b: null }]);
  assert.deepEqual(lido.alertas.map((a) => [a.codigo, a.linha]).sort(), [['COLUNA_AUSENTE', 1], ['LINHA_SEM_PK', 2]]);
  assert.equal(codigoDe(() => gas.exec(() => G.Database.abrir(banco, { tabelas: { T: v2 } }).anexar({ T: [{ id: 'z2', b: 1 }] }))), 'CONFIG', 'gravar em coluna que falta pede o setup');
  gas.exec(() => G.Database.abrir(banco, { tabelas: { T: v2 } }).anexar({ T: [{ id: 'z3', a: 'sem b' }] }));
  assert.equal(codigoDe(() => gas.exec(() => G.Database.abrir(banco, { tabelas: { T: v2 } }).anexar({ T: [{ id: 'z4', c: 1 }] }))), 'INTERNAL', 'coluna fora da definição');
  for (const primitiva of PRIMITIVAS) {
    assert.equal(codigoDe(() => gas.exec(() => G.Database.abrir(banco, { primitiva }).ler(['EVENTOS']))), 'CONFIG', primitiva + ': aba ausente');
  }
  assert.equal(codigoDe(() => G.Database.abrir('', {})), 'CONFIG');
  assert.equal(codigoDe(() => G.Database.abrir(banco, { primitiva: 'CSV' })), 'CONFIG');
});

test('porta de E/S: data digitada à mão numa célula Geral é lida como data coercida, no fuso da planilha', () => {
  const gas = createGas();
  const G = gas.G;
  const banco = gas.planilhas.criar('Banco');
  const def = { nome: 'T', pk: 'id', colunas: [{ nome: 'id', tipo: 'ID' }, { nome: 'dia', tipo: 'DATA' }, { nome: 'quando', tipo: 'TS' }] };
  gas.exec(() => G.Database.abrir(banco, { primitiva: 'SPREADSHEET_APP', tabelas: { T: def } }).criarTabelas(['T']));
  gas.planilhas.gravar(banco, 'T', 2, 1, [['d1']], '@');
  gas.planilhas.digitar(banco, 'T', 2, 2, '13/11/2026'); // a planilha nova do fake é en_US: mês/dia, logo não é data
  gas.planilhas.digitar(banco, 'T', 2, 3, '2026-11-13 10:30');
  for (const primitiva of PRIMITIVAS) {
    const t = js(gas.exec(() => G.Database.abrir(banco, { primitiva, tabelas: { T: def } }).ler(['T']).T));
    assert.equal(t.registros[0].dia, '13/11/2026', primitiva + ': texto fora do formato é devolvido como está');
    assert.ok(t.alertas.some((a) => a.coluna === 'dia' && a.nivel === 'ERRO' && a.codigo === 'DATA_INVALIDA'), primitiva);
    assert.equal(t.registros[0].quando, '2026-11-13T10:30:00.000Z', primitiva + ': hora de parede no fuso da planilha (Etc/GMT)');
    assert.ok(t.alertas.some((a) => a.coluna === 'quando' && a.nivel === 'COERCIDA'), primitiva);
  }
  gas.planilhas.digitar(banco, 'T', 2, 2, '11/13/2026');
  const t = js(gas.exec(() => G.Database.abrir(banco, { primitiva: 'SPREADSHEET_APP', tabelas: { T: def } }).ler(['T']).T));
  assert.equal(t.registros[0].dia, '2026-11-13');
  assert.ok(t.alertas.some((a) => a.coluna === 'dia' && a.codigo === 'DATA_NATIVA'));
});

test('porta de E/S: a Sheets API lê várias abas numa requisição só', () => {
  const gas = createGas();
  const G = gas.G;
  const banco = gas.planilhas.criar('Banco');
  gas.exec(() => G.Database.abrir(banco).criarTabelas(['PASTOS', 'EVENTOS', 'OPERACOES']));
  const original = G.Sheets.Spreadsheets.Values.batchGet;
  let chamadas = 0;
  G.Sheets.Spreadsheets.Values.batchGet = function () { chamadas += 1; return original.apply(this, arguments); };
  try {
    const lido = js(gas.exec(() => G.Database.abrir(banco).ler(['PASTOS', 'EVENTOS', 'OPERACOES', 'PASTOS'])));
    assert.deepEqual(Object.keys(lido), ['PASTOS', 'EVENTOS', 'OPERACOES']);
    assert.deepEqual(lido.EVENTOS.cabecalho, js(G.Schema.colunas('EVENTOS')));
  } finally {
    G.Sheets.Spreadsheets.Values.batchGet = original;
  }
  assert.equal(chamadas, 1);
});

// ------------------------------------------------------------------ portas reais ----
test('portas reais: Lock, Clock, IdGen, Hash e Props sobre os serviços do Apps Script', () => {
  const gas = createGas();
  const G = gas.G;
  const D = G.Database;
  assert.equal(D.clock().agora(), '2026-11-13T14:00:00.000Z');
  assert.equal(D.clock().agoraMs(), Date.UTC(2026, 10, 13, 14, 0, 0));
  assert.match(D.idGen().uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(D.hash().sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(D.hash().sha256Hex('ção'), require('node:crypto').createHash('sha256').update('ção', 'utf8').digest('hex'));

  gas.exec(() => {
    const l = D.lock();
    assert.equal(l.tem(), false);
    assert.equal(l.tentar(25000), true);
    assert.equal(l.tem(), true);
    l.soltar();
    assert.equal(l.tem(), false);
  });
  gas.lock.segurarPorOutra();
  const t0 = gas.clock.now;
  assert.equal(gas.exec(() => D.lock().tentar(25000)), false, 'outra execução segura o lock');
  assert.equal(gas.clock.now - t0, 25000, 'esperou os 25 s');
  gas.lock.soltarOutra();

  let leituras = 0;
  gas.ganchos.em('props.lido', () => { leituras += 1; }, { vezes: 100 });
  gas.exec(() => {
    const p = D.props();
    p.gravar('DATA_VERSION:x', 3);
    p.gravar('PENDING_OP:x', '{"op_id":"1"}');
    const retrato = p.ler();
    assert.equal(retrato['DATA_VERSION:x'], '3');
    p.remover('PENDING_OP:x');
    assert.equal(p.ler()['PENDING_OP:x'], undefined);
  });
  assert.equal(leituras, 2, 'cada ler() é UM getProperties(), nunca chave a chave');
});

test('contexto de execução: portas reais, banco, usuário e fuso do script', () => {
  const gas = createGas();
  const G = gas.G;
  const banco = gas.planilhas.criar('Banco');
  const ctx = G.Database.contexto({ banco, usuario: 'dono@gmail.com', primitiva: 'SHEETS_RAW' });
  for (const porta of ['io', 'lock', 'clock', 'idGen', 'hash', 'props']) assert.ok(ctx[porta], porta);
  assert.equal(ctx.banco, banco);
  assert.equal(ctx.io.banco, banco);
  assert.equal(ctx.io.primitiva, 'SHEETS_RAW');
  assert.equal(ctx.usuario, 'dono@gmail.com');
  assert.equal(ctx.fuso, 'America/Porto_Velho');
  assert.equal(ctx.files, null);
  assert.equal(ctx.session, null);
  assert.deepEqual(js(ctx.errosPendentes), []);
  assert.equal(codigoDe(() => G.Database.contexto({ banco: null })), 'CONFIG');
});
