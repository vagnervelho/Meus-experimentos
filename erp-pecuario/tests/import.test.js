'use strict';
/**
 * Importação de ANIMAIS (§14; 06, seção 5.3; RN-088 a RN-094). CT-12 nas partes da Fase 1 (a reconciliação com o
 * histórico nasce com os importadores de eventos, na Fase 2): 12 linhas — 7 válidas (uma sem nascimento), 3 com erro
 * (sexo "X", 31/02/2024, mãe inexistente), 2 duplicadas ("0012" e "12"; brinco já na base) —, lotes de 5:
 * (1) validar; (2) TOTAL recusado; (3) PARCIAL_APROVADO com queda após o commit do lote 1; (4) outro lançamento é
 * recusado; (5) retomar e concluir; (6) variante desfazer. E: desfazer importação concluída (com e sem dependentes),
 * queda na conclusão, mãe em outro lote e depois da filha no arquivo, linhas coladas, mesmo arquivo de novo,
 * mapeamento e ordem dos blocos, validação vencida, linha deixada de fora, leitor de CSV.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');
const S = require('./apoio-sistema');
const { instrumentar } = require('./apoio-persistencia');

const { js, D0, PASTOS } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
const MAPA = {
  colunas: { Brinco: 'brinco', Sexo: 'sexo', 'Nasc.': 'data_nascimento', 'Mãe': 'mae', Pasto: 'pasto' },
  confiancas: { data_nascimento: 'ESTIMADA', mae: 'CONFIRMADA' }, padroes: { castrado: false, reprodutor: false },
};
const CT12 = [
  'Brinco;Sexo;Nasc.;Mãe;Pasto',
  '0010;F;10/01/2019;;Pasto A',
  '0011;F;15/03/2022;0010;Pasto A',
  '0012;F;01/01/2023;;Pasto A',
  '12;F;01/02/2023;;Pasto B',
  '0231;F;01/01/2021;;Pasto B',
  '0050;X;01/01/2022;;Pasto A',
  '0051;F;31/02/2024;;Pasto A',
  '0052;M;01/01/2024;9999;Pasto A',
  '0053;M;01/02/2024;0010;P-B',
  '0054;F;;;Pasto B',
  '0055;M;05/05/2020;;Pasto A',
  '0056;F;06/06/2024;0011;Pasto A',
].join('\r\n');

function preparar(opcoes) {
  const s = S.sistema(Object.assign({ config: { importacao_lote_linhas: '5' } }, opcoes || {}));
  s.evento('registrar', S.entradaInicial([S.bicho({ brinco: '0231', data_nascimento: '2019-05-01', data_nascimento_confianca: 'CONFIRMADA' })]), 'ev-base');
  return s;
}
function criar(s, csv, extra) {
  const e = extra || {};
  return s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: e.chave || 'criar-1', avisosAceitos: e.avisos || [], dados: Object.assign({ tipo: 'ANIMAIS', arquivo_nome: 'rebanho.csv', conteudo_base64: b64(csv), formato: FORMATO }, e.dados || {}) })).dados;
}
function validarTudo(s, id, mapa) {
  let estado;
  for (let b = 1; b < 100; b++) {
    estado = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + id + '-' + b + '-' + JSON.stringify(mapa || MAPA).length, dados: { import_id: id, bloco: b, mapeamento: mapa || MAPA } })).dados;
    if (estado.importacao.status === 'VALIDADO') return estado;
  }
  throw new Error('validação não terminou');
}
function linhas(s, id, status) {
  return s.read(s.G.ImportService.consultaLinhas({ import_id: id, status, por_pagina: 500 })).itens;
}
function importar(s, id, bloco, extra) {
  return s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { dados: Object.assign({ import_id: id, bloco }, extra || {}) }));
}
const PARCIAL = { modo: 'PARCIAL_APROVADO', aprovacao: { importar: 7, ignorar: 5 } };
function vigentes(s) {
  return s.read({ rota: 't', reads: ['ANIMAIS'], tratador: (tx) => tx.repo.vigentes('ANIMAIS').map((a) => a.brinco).sort() });
}
/** Bloco 1 com a execução morrendo logo depois do commit (antes dos derivados). */
function importarComQueda(s, id) {
  const alvo = { depois: null };
  const r = s.gas.tentar(() => {
    const ctx = s.ctx();
    instrumentar(s.gas, ctx, Object.assign(alvo, { antesDe: (k, rotulo) => { if (rotulo === 'atualizar:OPERACOES.status' && alvo.depois === null) alvo.depois = k; } }));
    return s.G.ImportService.importarBloco(ctx, { dados: Object.assign({ import_id: id, bloco: 1 }, PARCIAL) });
  });
  assert.equal(r.morta, true, 'a execução morreu depois do commit do lote 1');
}

test('CT-12 (1)–(5): validar, TOTAL recusado, PARCIAL com queda no lote 1, outros lançamentos recusados, retomar e concluir', () => {
  const s = preparar();
  const { gas, G } = s;
  const c = criar(s, CT12);
  assert.deepEqual([c.status, c.total_linhas, c.cabecalho], ['RASCUNHO', 12, ['Brinco', 'Sexo', 'Nasc.', 'Mãe', 'Pasto']]);
  assert.deepEqual(c.sugestao, { Brinco: 'brinco', Sexo: 'sexo', 'Nasc.': 'data_nascimento', 'Mãe': 'mae', Pasto: 'pasto' }, 'modelo conhecido já vem mapeado');
  // Arquivo original preservado no Drive e em ANEXOS, com o hash.
  const imp0 = s.tabela('IMPORTACOES')[0];
  const anexo = s.tabela('ANEXOS').find((a) => a.anexo_id === imp0.arquivo_anexo_id);
  assert.deepEqual([anexo.entidade, anexo.entity_id, anexo.tipo, anexo.status], ['IMPORTACOES', c.import_id, 'DOCUMENTO', 'ATIVO']);
  assert.equal(gas.drive.conteudo(anexo.drive_file_id).toString('utf8'), CT12);
  assert.equal(imp0.arquivo_hash, require('node:crypto').createHash('sha256').update(CT12, 'utf8').digest('hex'));

  // (1) Validação em 3 blocos de 5.
  const v = validarTudo(s, c.import_id);
  assert.deepEqual([v.contadores.validas, v.contadores.erro, v.contadores.duplicadas, v.importacao.linhas_validas, v.importacao.linhas_erro], [7, 3, 2, 7, 5]);
  const por = {};
  linhas(s, c.import_id).forEach((l) => { por[l.linha_num] = l; });
  assert.deepEqual(Object.keys(por).map((n) => por[n].status), ['VALIDA', 'VALIDA', 'VALIDA', 'DUPLICADA', 'DUPLICADA', 'ERRO', 'ERRO', 'ERRO', 'VALIDA', 'VALIDA', 'VALIDA', 'VALIDA']);
  assert.match(por[5].erros[0].mensagem, /o brinco 12 já aparece na linha 4/);
  assert.match(por[6].erros[0].mensagem, /o brinco 0231 já é do animal A-000001 no rebanho/);
  assert.match(por[7].erros[0].mensagem, /sexo "X" não reconhecido/);
  assert.equal(por[8].erros[0].codigo, 'DATA_INVALIDA');
  assert.equal(por[9].erros[0].codigo, 'MAE_NAO_ENCONTRADA');
  assert.match(por[9].erros[0].mensagem, /Deixe em branco \(desconhecido\), cadastre-a antes como animal de referência ou corrija o brinco/, 'as três saídas do RN-094');
  assert.deepEqual(por[2].dados_originais, { Brinco: '0010', Sexo: 'F', 'Nasc.': '10/01/2019', 'Mãe': '', Pasto: 'Pasto A' }, 'texto original, sem interpretação');
  assert.deepEqual([por[2].interpretado.brinco, por[2].interpretado.data_nascimento, por[2].interpretado.pasto_destino_id, por[10].interpretado.pasto_destino_id], ['0010', '2019-01-10', PASTOS.A, PASTOS.B], 'pré-visualização: interpretado ao lado do original (pasto pela identificação)');
  assert.equal(por[11].interpretado.data_nascimento, undefined, 'nascimento vazio segue desconhecido');

  // (2) TOTAL recusado.
  const t = importar(s, c.import_id, 1, { modo: 'TOTAL' });
  assert.equal(t.erro.code, 'VALIDATION');
  assert.deepEqual(S.codigos(t.erro), ['IMPORTACAO_TOTAL_RECUSADA']);
  // Aprovação que não bate com o que a tela mostrou também é recusada.
  assert.deepEqual(S.codigos(importar(s, c.import_id, 1, { modo: 'PARCIAL_APROVADO', aprovacao: { importar: 7, ignorar: 4 } }).erro), ['APROVACAO_DIVERGENTE']);

  // (3) PARCIAL_APROVADO com queda após o commit do lote 1: IMPORTANDO, nenhum animal visível.
  importarComQueda(s, c.import_id);
  const e3 = s.read(G.ImportService.consultaObter({ import_id: c.import_id }));
  assert.equal(e3.importacao.status, 'IMPORTANDO');
  assert.deepEqual(e3.blocos, { tamanho: 5, total: 2, importados: 1, proximo: 2 });
  assert.equal(e3.contadores.importadas, 5);
  assert.deepEqual(vigentes(s), ['0231'], 'nenhum dos 5 animais do lote 1 vale antes de concluir');
  assert.ok(s.tabela('ANIMAIS').filter((a) => a.situacao_cadastral === 'PENDENTE').length === 5);
  assert.equal(s.read(G.Timeline.consultaInventario({ data: '2026-11-13' })).total, 1);
  s.conferirProjecoes('importação em curso: animais pendentes com os atributos declarados');
  assert.equal(s.integridade().ok, true, 'a integridade não acusa a importação em curso');

  // (4) Outro lançamento é recusado enquanto a importação está em curso; consultas e manutenção seguem.
  const outro = s.tentar((ctx) => G.EventService.registrar(ctx, { idempotencyKey: 'outra-1', dados: { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-03-01', description: 'Doação' }, animais: [S.bicho({ brinco: '900' })] } }));
  assert.equal(outro.erro.code, 'CONFLICT');
  assert.match(outro.erro.message, /importação de planilha em andamento/);
  assert.equal(s.tentar((ctx) => G.Maintenance.backup(ctx, {})).ok, true, 'a manutenção não é recusada');
  assert.equal(s.read(G.ImportService.consultaListar()).em_curso.import_id, c.import_id, 'a faixa "importação incompleta" sabe qual retomar');

  // (5) Retomar: o lote 1 reenviado devolve duplicado; lote 2; concluir com backup antes.
  const dup = importar(s, c.import_id, 1, PARCIAL);
  assert.equal(dup.valor.duplicado, true);
  const l2 = importar(s, c.import_id, 2);
  assert.equal(l2.ok, true, JSON.stringify(l2.erro));
  assert.deepEqual(l2.valor.dados.blocos, { tamanho: 5, total: 2, importados: 2, proximo: null });
  assert.equal(l2.valor.dados.pode.concluir, true);
  const fim = s.exec((ctx) => G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } })).dados;
  assert.equal(fim.importacao.status, 'IMPORTADO');
  assert.deepEqual(fim.criados, { animais: 7, eventos: 2, ativos: 7 });
  assert.deepEqual(fim.reprovadas.map((x) => [x.linha_num, x.status]), [[5, 'DUPLICADA'], [6, 'DUPLICADA'], [7, 'ERRO'], [8, 'ERRO'], [9, 'ERRO']], 'o relatório lista as reprovadas com o motivo');
  assert.equal(fim.aprovacao.modo, 'PARCIAL_APROVADO');
  assert.match(fim.aprovacao.texto, /aprovada por dono@gmail\.com: importar 7 linha\(s\) válidas e deixar de fora 5/, 'aprovação explícita registrada');
  assert.equal(fim.pendencias.sem_nascimento, 1);
  const backups = s.exec((ctx) => G.Maintenance.listarBackups(ctx)).filter((b) => b.motivo === 'IMPORTACAO');
  assert.equal(backups.length, 1, 'backup antes de concluir');
  assert.equal(s.tabela('IMPORTACOES', backups[0].id)[0].status, 'IMPORTANDO', 'o backup é de antes da conclusão');
  // 7 animais ATIVOS por ENTRADA_INICIAL em D0, vindos da importação.
  assert.deepEqual(vigentes(s), ['0010', '0011', '0012', '0053', '0054', '0055', '0056', '0231']);
  const evs = s.tabela('EVENTOS').filter((e) => e.source === 'IMPORTACAO');
  assert.deepEqual(evs.map((e) => [e.event_type, e.event_date, e.import_id, e.status]), [['ENTRADA_INICIAL', D0, c.import_id, 'CONFIRMADO'], ['ENTRADA_INICIAL', D0, c.import_id, 'CONFIRMADO']]);
  const animais = s.tabela('ANIMAIS');
  const porBrinco = (b) => animais.find((a) => a.brinco === b);
  assert.equal(porBrinco('0054').data_nascimento, null, 'nascimento vazio segue vazio');
  assert.equal(porBrinco('0011').mae_id, porBrinco('0010').animal_id);
  assert.equal(porBrinco('0056').mae_id, porBrinco('0011').animal_id, 'mãe importada em lote anterior');
  assert.equal(porBrinco('0053').pasto_atual_id, PASTOS.B);
  assert.deepEqual([porBrinco('0010').data_nascimento_confianca, porBrinco('0011').mae_confianca], ['ESTIMADA', 'CONFIRMADA'], 'níveis de confiança do mapeamento');
  const gravadas = s.tabela('IMPORTACAO_LINHAS');
  assert.equal(gravadas.length, 12, 'uma linha por linha do arquivo, preservadas');
  assert.ok(gravadas.filter((l) => l.status === 'IMPORTADA').every((l) => animais.some((a) => a.animal_id === l.entity_id_gerado)));
  s.conferirProjecoes('depois de concluir');
  assert.equal(s.integridade().ok, true);
  // Depois de concluir, os demais lançamentos voltam a valer.
  assert.equal(s.tentar((ctx) => G.EventService.registrar(ctx, { idempotencyKey: 'outra-2', dados: { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-03-01', description: 'Doação' }, animais: [S.bicho({ brinco: '900' })] } })).ok, true);
});

test('CT-12 (6) variante: desfazer a importação interrompida → CANCELADO, nenhum animal vale, linhas preservadas', () => {
  const s = preparar({ order: 'reverse' });
  const { G } = s;
  const c = criar(s, CT12);
  validarTudo(s, c.import_id);
  importarComQueda(s, c.import_id);
  assert.equal(s.tentar((ctx) => G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id } })).erro.details[0].codigo, 'CAMPO_OBRIGATORIO', 'desfazer pede justificativa');
  const r = s.exec((ctx) => G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id, justificativa: 'Arquivo errado' } })).dados;
  assert.equal(r.importacao.status, 'CANCELADO');
  assert.deepEqual(vigentes(s), ['0231']);
  assert.ok(s.tabela('ANIMAIS').filter((a) => a.brinco !== '0231').every((a) => a.situacao_cadastral === 'ANULADO'));
  assert.ok(s.tabela('EVENTOS').filter((e) => e.import_id === c.import_id).every((e) => e.status === 'CANCELADO'));
  assert.equal(s.tabela('IMPORTACAO_LINHAS').length, 12, 'linhas preservadas como prova');
  assert.equal(s.tabela('IMPORTACOES')[0].finished_at, '2026-11-13T14:00:00.000Z');
  s.conferirProjecoes('desfeita');
  assert.equal(s.integridade().ok, true);
  assert.equal(s.tentar((ctx) => G.EventService.registrar(ctx, { idempotencyKey: 'depois', dados: { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-03-01', description: 'Doação' }, animais: [S.bicho({ brinco: '0010' })] } })).ok, true, 'o brinco da importação desfeita fica livre');
  assert.equal(importar(s, c.import_id, 2).erro.code, 'CONFLICT');
});

test('desfazer importação concluída: bloqueado por lançamento posterior (CONFLICT com o evento); sem dependente → CANCELADO', () => {
  const s = preparar();
  const { G } = s;
  const csv = 'Brinco;Sexo;Nasc.;Mãe;Pasto\n500;F;01/01/2020;;Pasto A\n501;F;01/01/2024;500;Pasto A';
  const c = criar(s, csv);
  validarTudo(s, c.import_id);
  assert.equal(importar(s, c.import_id, 1, { modo: 'TOTAL' }).ok, true);
  s.exec((ctx) => G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } }));
  const a501 = s.tabela('ANIMAIS').find((a) => a.brinco === '501');
  const aj = s.evento('registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_LOCALIZACAO', campos: { event_date: '2026-02-01', justificativa: 'Mudou de pasto' }, animais: [{ animal_id: a501.animal_id, pasto_destino_id: PASTOS.B }] }, 'aj-1');
  let r = s.tentar((ctx) => G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id, justificativa: 'Teste' } }));
  assert.equal(r.erro.code, 'CONFLICT');
  assert.equal(r.erro.details[0].conflito.event_id, aj.dados.event_id);
  s.evento('estornar', { event_id: aj.dados.event_id, justificativa: 'Lançado errado' }, 'est-1');
  r = s.tentar((ctx) => G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id, justificativa: 'Teste' } }));
  assert.equal(r.ok, true, JSON.stringify(r.erro));
  assert.deepEqual(vigentes(s), ['0231']);
  s.conferirProjecoes('importação concluída desfeita');
  assert.equal(s.integridade().ok, true);
});

test('queda na conclusão depois do commit: a recuperação termina IMPORTADO, com os eventos valendo e as projeções refeitas', () => {
  const s = preparar();
  const { gas, G } = s;
  const c = criar(s, 'Brinco;Sexo;Pasto\n700;F;Pasto A\n701;M;Pasto B');
  validarTudo(s, c.import_id, { colunas: { Brinco: 'brinco', Sexo: 'sexo', Pasto: 'pasto' }, padroes: { castrado: true, reprodutor: false } });
  assert.equal(importar(s, c.import_id, 1, { modo: 'TOTAL' }).ok, true);
  const alvo = { depois: null };
  const r = gas.tentar(() => {
    const ctx = s.ctx();
    instrumentar(gas, ctx, Object.assign(alvo, { antesDe: (k, rotulo) => { if (rotulo === 'atualizar:OPERACOES.status' && alvo.depois === null) alvo.depois = k; } }));
    return G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } });
  });
  assert.equal(r.morta, true);
  const e = s.read(G.ImportService.consultaObter({ import_id: c.import_id }));
  assert.equal(e.importacao.status, 'IMPORTADO');
  assert.deepEqual(vigentes(s), ['0231', '700', '701']);
  assert.equal(s.tabela('ANIMAIS').find((a) => a.brinco === '701').castrado, true, 'valor padrão escolhido no mapeamento');
  assert.equal(s.tabela('EVENTOS').filter((x) => x.import_id === c.import_id && x.status === 'CONFIRMADO').length, 1);
  s.conferirProjecoes('recuperada');
  const de2 = s.exec((ctx) => G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } }));
  assert.equal(de2.duplicado, true, 'concluir de novo devolve o resultado gravado');
});

test('genealogia: filha antes da mãe no arquivo e mãe em outro lote; ciclo e sexo do progenitor reprovam; linha deixada de fora', () => {
  const s = preparar();
  const { G } = s;
  const linhasCsv = ['Brinco;Sexo;Nasc.;Mãe;Pai;Pasto'];
  linhasCsv.push('1;F;01/01/2024;9;8;Pasto A'); // filha antes da mãe (9) e do pai (8)
  for (let i = 2; i <= 6; i++) linhasCsv.push(i + ';M;01/01/202' + (i % 3) + ';;;Pasto A');
  linhasCsv.push('8;M;01/01/2015;;;Pasto B');
  linhasCsv.push('9;F;01/01/2016;;;Pasto B');
  linhasCsv.push('20;F;;21;;Pasto A');
  linhasCsv.push('21;F;;20;;Pasto A'); // ciclo
  linhasCsv.push('22;F;01/01/2020;8;;Pasto A'); // mãe macho
  const mapa = { colunas: { Brinco: 'brinco', Sexo: 'sexo', 'Nasc.': 'data_nascimento', 'Mãe': 'mae', Pai: 'pai', Pasto: 'pasto' }, confiancas: { data_nascimento: 'CONFIRMADA', mae: 'CONFIRMADA', pai: 'ESTIMADA' }, padroes: { castrado: false, reprodutor: false } };
  const c = criar(s, linhasCsv.join('\n'));
  validarTudo(s, c.import_id, mapa);
  const st = {};
  linhas(s, c.import_id).forEach((l) => { st[l.dados_originais.Brinco] = [l.status, l.erros.map((x) => x.codigo)]; });
  assert.deepEqual(st['20'], ['ERRO', ['CICLO_GENEALOGICO']]);
  assert.deepEqual(st['22'], ['ERRO', ['SEXO_DO_PROGENITOR']]);
  assert.equal(st['1'][0], 'VALIDA');
  // Deixar de fora a mãe de uma linha que entra é recusado; deixar de fora outra linha vale (IGNORADA).
  const n9 = linhas(s, c.import_id).find((l) => l.dados_originais.Brinco === '9').linha_num;
  const n6 = linhas(s, c.import_id).find((l) => l.dados_originais.Brinco === '6').linha_num;
  assert.deepEqual(S.codigos(importar(s, c.import_id, 1, { modo: 'PARCIAL_APROVADO', aprovacao: { importar: 7, ignorar: 4 }, ignorar_linhas: [n9] }).erro), ['PROGENITOR_IGNORADO']);
  const r = importar(s, c.import_id, 1, { modo: 'PARCIAL_APROVADO', aprovacao: { importar: 7, ignorar: 4 }, ignorar_linhas: [n6] });
  assert.equal(r.ok, true, JSON.stringify(r.erro));
  assert.deepEqual(r.valor.dados.blocos, { tamanho: 5, total: 2, importados: 1, proximo: 2 });
  assert.equal(r.valor.dados.contadores.ignoradas, 1);
  // Ordem de importação: progenitores antes da filha, mesmo vindo depois no arquivo.
  const doLote1 = s.tabela('IMPORTACAO_LINHAS').filter((l) => l.status === 'IMPORTADA').map((l) => l.dados_originais_json.Brinco).sort();
  assert.deepEqual(doLote1, ['2', '3', '4', '5', '8'], 'o pai (8) entra no lote 1; a mãe (9) e a filha (1) no lote 2, com a filha depois');
  assert.equal(importar(s, c.import_id, 2).ok, true);
  s.exec((ctx) => G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } }));
  const a = s.tabela('ANIMAIS');
  const b = (x) => a.find((y) => y.brinco === x);
  assert.deepEqual([b('1').mae_id, b('1').pai_id, b('1').pai_confianca], [b('9').animal_id, b('8').animal_id, 'ESTIMADA']);
  assert.equal(b('6'), undefined, 'a linha deixada de fora não entrou');
  s.conferirProjecoes('genealogia');
});

test('linhas coladas (tabulação), números e dinheiro no formato do arquivo, padrões do mapeamento e mesmo arquivo de novo', () => {
  const s = preparar();
  const { G } = s;
  const texto = 'Brinco\tSexo\tPeso\tComo pesou\tValor\tRaça\tNascimento\tObs\n'
    + '300\tmacho\t1.234,5\tbalança\t1.500,00\tNelore\t2020-05-01\t"com ""aspas""; e ponto e vírgula"\n'
    + '301\tFêmea\t380\t\tR$ 2.000,5\tnelore\t01/06/2021\t\n'
    + '302\tF\t380,25\t\t10,123\tGir\t01/06/2021\t';
  const c = s.exec((ctx) => G.ImportService.criar(ctx, { idempotencyKey: 'colado-1', dados: { tipo: 'ANIMAIS', texto, formato: { delimitador: 'TAB', formato_data: 'dd/MM/yyyy', decimal: ',' } } })).dados;
  const mapa = { colunas: { Brinco: 'brinco', Sexo: 'sexo', Peso: 'peso', 'Como pesou': 'metodo_pesagem', Valor: 'valor_abertura', 'Raça': 'raca', Nascimento: 'data_nascimento', Obs: 'observacoes' }, confiancas: { data_nascimento: 'CONFIRMADA' }, padroes: { pasto: PASTOS.B, castrado: false, reprodutor: true, metodo_pesagem: 'FITA', origem: 'NASCIDO' } };
  validarTudo(s, c.import_id, mapa);
  const ls = linhas(s, c.import_id);
  assert.deepEqual(ls.map((l) => l.status), ['VALIDA', 'VALIDA', 'ERRO']);
  const i0 = ls[0].interpretado;
  assert.deepEqual([i0.sexo, i0.peso, i0.metodo_pesagem, i0.valor_abertura, i0.raca, i0.data_nascimento, i0.observacoes, i0.reprodutor, i0.origem, i0.pasto_destino_id],
    ['M', 1234.5, 'BALANCA', 150000, 'NELORE', '2020-05-01', 'com "aspas"; e ponto e vírgula', true, 'NASCIDO', PASTOS.B]);
  assert.deepEqual([ls[1].interpretado.valor_abertura, ls[1].interpretado.metodo_pesagem, ls[1].interpretado.sexo], [200050, 'FITA', 'F'], 'padrão do método só onde o arquivo não diz');
  assert.deepEqual(ls[2].erros.map((e) => e.campo).sort(), ['peso', 'raca', 'valor_abertura'], 'casas a mais e raça fora da lista');
  // O mesmo texto colado de novo: aviso de duplicidade (com aceite).
  const de2 = s.tentar((ctx) => G.ImportService.criar(ctx, { idempotencyKey: 'colado-2', dados: { tipo: 'ANIMAIS', texto, formato: { delimitador: 'TAB', formato_data: 'dd/MM/yyyy', decimal: ',' } } }));
  assert.equal(de2.erro.code, 'NEEDS_CONFIRMATION');
  assert.deepEqual(S.codigos(de2.erro), ['POSSIVEL_DUPLICIDADE']);
  const aceito = s.tentar((ctx) => G.ImportService.criar(ctx, { idempotencyKey: 'colado-2', avisosAceitos: ['POSSIVEL_DUPLICIDADE'], dados: { tipo: 'ANIMAIS', texto, formato: { delimitador: 'TAB', formato_data: 'dd/MM/yyyy', decimal: ',' } } }));
  assert.equal(aceito.ok, true);
  assert.equal(s.tabela('IMPORTACOES').length, 2);
  const enviados = s.tabela('ANEXOS').filter((a) => a.entidade === 'IMPORTACOES').length;
  assert.equal(enviados, 2, 'o arquivo do pedido que pediu confirmação não ficou como anexo');
});

test('recusas: tipo de outra fase, formato, mapeamento, blocos fora de ordem, mapeamento trocado, validação vencida, importar antes de validar', () => {
  const s = preparar();
  const { G } = s;
  const er = (fn) => s.tentar(fn).erro;
  assert.match(er((ctx) => G.ImportService.criar(ctx, { idempotencyKey: 'x1', dados: { tipo: 'PESAGENS', texto: 'a', formato: FORMATO } })).message, /chega numa próxima fase/);
  assert.equal(er((ctx) => G.ImportService.criar(ctx, { idempotencyKey: 'x2', dados: { tipo: 'ANIMAIS', texto: 'a;b\n1;2', formato: { delimitador: ';', formato_data: 'dd/MM/yy', decimal: ';' } } })).details.length, 3);
  assert.match(er((ctx) => G.ImportService.criar(ctx, { idempotencyKey: 'x3', dados: { tipo: 'ANIMAIS', texto: 'Brinco;Brinco\n1;2', formato: FORMATO } })).message, /aparece duas vezes no cabeçalho/);
  assert.match(er((ctx) => G.ImportService.criar(ctx, { idempotencyKey: 'x4', dados: { tipo: 'ANIMAIS', texto: 'Brinco;Sexo\n', formato: FORMATO } })).message, /só tem o cabeçalho/);
  const csv = ['Brinco;Sexo;Pasto'].concat(Array.from({ length: 11 }, (_, i) => (800 + i) + ';F;Pasto A')).join('\n');
  const c = criar(s, csv, { chave: 'c-recusas' });
  const mapa = { colunas: { Brinco: 'brinco', Sexo: 'sexo', Pasto: 'pasto' } };
  const val = (bloco, m, chave) => s.tentar((ctx) => G.ImportService.validarBloco(ctx, { idempotencyKey: chave, dados: { import_id: c.import_id, bloco, mapeamento: m } }));
  let r = val(1, { colunas: { Brinco: 'brinco', Nada: 'sexo' } }, 'v0');
  assert.equal(r.erro.code, 'VALIDATION');
  assert.deepEqual(S.codigos(r.erro).sort(), ['CAMPO_OBRIGATORIO', 'CAMPO_OBRIGATORIO', 'COLUNA_DESCONHECIDA']);
  assert.equal(importar(s, c.import_id, 1, { modo: 'TOTAL' }).erro.code, 'CONFLICT', 'importar antes de validar');
  assert.equal(val(2, mapa, 'v1').erro.code, 'CONFLICT', 'bloco 2 antes do 1');
  assert.equal(val(1, mapa, 'v2').ok, true);
  assert.match(val(2, { colunas: { Brinco: 'brinco', Sexo: 'sexo' }, padroes: { pasto: PASTOS.B } }, 'v3').erro.message, /mapeamento das colunas mudou/);
  assert.match(val(3, mapa, 'v4').erro.message, /falta o bloco 2/);
  assert.equal(val(2, mapa, 'v5').ok, true);
  assert.equal(val(3, mapa, 'v6').valor.dados.importacao.status, 'VALIDADO');
  // O rebanho mudou depois da validação (um dos brincos foi cadastrado): o bloco 1 recusa e pede nova validação.
  s.evento('registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-03-01', description: 'Doação' }, animais: [S.bicho({ brinco: '803' })] }, 'ev-803');
  r = importar(s, c.import_id, 1, { modo: 'TOTAL' });
  assert.equal(r.erro.code, 'CONFLICT');
  assert.match(r.erro.message, /Valide o arquivo de novo/);
  assert.equal(s.read(G.ImportService.consultaObter({ import_id: c.import_id })).importacao.status, 'VALIDADO', 'nada gravado');
});

test('leitor de CSV e interpretação do arquivo: aspas, CRLF, BOM, linhas em branco na numeração, colunas a mais', () => {
  const G = createGas({ order: 'alpha' }).G;
  const I = G.ImportService;
  assert.deepEqual(js(I.lerCsv('a;"b;c";"d ""e"""\r\n1;2;3', ';')), [['a', 'b;c', 'd "e"'], ['1', '2', '3']]);
  assert.deepEqual(js(I.lerCsv('"multi\nlinha",x\n', ',')), [['multi\nlinha', 'x']]);
  assert.throws(() => I.lerCsv('a;"b\n1;2', ';'), /aspas abertas/);
  const arq = js(I.interpretarArquivo('﻿Brinco;Sexo;\n\n10;F\n;\n11;M;extra\n', ';'));
  assert.deepEqual(arq.cabecalho, ['Brinco', 'Sexo']);
  assert.deepEqual(arq.linhas, [
    { linha_num: 3, valores: { Brinco: '10', Sexo: 'F' } },
    { linha_num: 5, valores: { Brinco: '11', Sexo: 'M', '#coluna_extra_3': 'extra' } },
  ], 'a numeração segue a planilha do dono (cabeçalho = 1, linhas em branco contam)');
  assert.deepEqual(js(I.sugerirMapeamento(['Nº', 'Data de Nascimento', 'Brinco da Mãe', 'Piquete', 'Qualquer'])), { 'Data de Nascimento': 'data_nascimento', 'Brinco da Mãe': 'mae', Piquete: 'pasto' });
});

test('queda em cada fronteira do lote e da conclusão: a recuperação decide pela célula de commit; reenviar com a mesma chave completa', () => {
  const CSV = 'Brinco;Sexo;Nasc.;Mãe;Pasto\n40;F;01/01/2019;;Pasto A\n41;F;01/01/2023;40;Pasto B\n42;M;01/01/2024;40;Pasto A';
  function montar() {
    const s = preparar();
    const c = criar(s, CSV);
    validarTudo(s, c.import_id);
    return { s, id: c.import_id };
  }
  function passos(fn) {
    const { s, id } = montar();
    let inst = null;
    s.gas.exec(() => { const ctx = s.ctx(); inst = instrumentar(s.gas, ctx, {}); return fn(s, ctx, id); });
    return inst.chamadas;
  }
  const lote = (s, ctx, id) => s.G.ImportService.importarBloco(ctx, { dados: { import_id: id, bloco: 1, modo: 'TOTAL' } });
  const fim = (s, ctx, id) => s.G.ImportService.concluir(ctx, { dados: { import_id: id } });
  const nLote = passos(lote);
  assert.ok(nLote.length >= 8, 'o lote passa por várias fronteiras: ' + nLote.join(' | '));
  for (let k = 1; k <= nLote.length; k++) {
    const { s, id } = montar();
    const r = s.gas.tentar(() => { const ctx = s.ctx(); instrumentar(s.gas, ctx, { depois: k }); return lote(s, ctx, id); });
    assert.equal(r.morta, true);
    const msg = 'lote, queda depois de ' + k + ' (' + nLote[k - 1] + ')';
    const commit = s.tabela('OPERACOES').some((o) => o.idempotency_key === s.G.ImportService.chaveBloco(id, 1) && o.status === 'CONFIRMADA');
    const e = s.read(s.G.ImportService.consultaObter({ import_id: id })); // a leitura recupera
    assert.equal(e.importacao.status, commit ? 'IMPORTANDO' : 'VALIDADO', msg);
    assert.equal(e.contadores.importadas, commit ? 3 : 0, msg);
    assert.ok(s.tabela('OPERACOES').every((o) => o.status === 'FALHOU' || (o.status === 'CONFIRMADA' && o.aplicada_em)), msg + ': nenhuma órfã');
    assert.deepEqual(vigentes(s), ['0231'], msg + ': nada vale antes de concluir');
    s.conferirProjecoes(msg);
    const de2 = importar(s, id, 1, { modo: 'TOTAL' });
    assert.equal(de2.valor.duplicado, commit, msg + ': o reenvio é duplicado exatamente quando o commit chegou');
    s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: id } }));
    assert.deepEqual(vigentes(s), ['0231', '40', '41', '42'], msg + ': concluída, sem duplicar animal');
  }
  const nFim = passos((s, ctx, id) => { lote(s, ctx, id); return null; }).length;
  const comFim = passos((s, ctx, id) => { lote(s, ctx, id); return fim(s, ctx, id); });
  for (let k = nFim + 1; k <= comFim.length; k++) {
    const { s, id } = montar();
    const r = s.gas.tentar(() => { const ctx = s.ctx(); instrumentar(s.gas, ctx, { depois: k }); lote(s, ctx, id); return fim(s, ctx, id); });
    assert.equal(r.morta, true);
    const msg = 'conclusão, queda depois de ' + k + ' (' + comFim[k - 1] + ')';
    const commit = s.tabela('OPERACOES').some((o) => o.idempotency_key === s.G.ImportService.chaveBloco(id, 'concluir') && o.status === 'CONFIRMADA');
    const e = s.read(s.G.ImportService.consultaObter({ import_id: id }));
    assert.equal(e.importacao.status, commit ? 'IMPORTADO' : 'IMPORTANDO', msg);
    assert.deepEqual(vigentes(s), commit ? ['0231', '40', '41', '42'] : ['0231'], msg);
    s.conferirProjecoes(msg);
    const de2 = s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: id } }));
    assert.equal(de2.duplicado, commit, msg + ': reenvio da conclusão');
    assert.deepEqual(vigentes(s), ['0231', '40', '41', '42'], msg + ': concluída');
    assert.equal(s.tabela('ANIMAIS').find((a) => a.brinco === '41').mae_id, s.tabela('ANIMAIS').find((a) => a.brinco === '40').animal_id);
  }
});
