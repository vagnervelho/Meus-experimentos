'use strict';
/**
 * CT-11 — setup() repetido: banco vazio → 34 abas com os cabeçalhos do Schema, sementes, SCHEMA_META, 2 gatilhos,
 * proteção de aviso, fuso e locale; o dono muda um parâmetro e desativa uma categoria; setup de novo não duplica nem
 * sobrescreve, faz backup antes e repõe gatilho apagado; setup com o esquema da fase seguinte acrescenta a coluna no fim
 * com os dados intactos. E a escolha da forma de gravação pelo corpus (SP-01): a primeira que passa, na ordem
 * preferida; nenhuma passa → CONFIG sem mexer no banco.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');
const S = require('./apoio-sistema');

const { js } = S;

function contagens(s) {
  const out = {};
  s.G.Schema.nomesTabelas().forEach((t) => { out[t] = s.gas.planilhas.matriz(s.banco(), t).length; });
  return out;
}

test('CT-11 (1): setup em banco vazio cria pastas, banco pelo Drive, 34 abas exatas, sementes, SCHEMA_META, gatilhos e proteção', () => {
  const s = S.sistema({ semCadastro: true });
  const { gas, G, setup } = s;
  const banco = s.banco();
  assert.equal(setup.banco_criado, true);
  assert.equal(setup.primitiva.primitiva, 'SHEETS_TYPED', 'a primeira forma de gravação da ordem preferida passou no corpus');
  assert.deepEqual(setup.primitiva.resultados.map((r) => [r.primitiva, r.ok]), [['SHEETS_TYPED', true]]);
  assert.deepEqual(gas.drive.arvore(), ['ERP Pecuário/', 'ERP Pecuário/Anexos/', 'ERP Pecuário/Backups/', 'ERP Pecuário/ERP Pecuário — Banco de dados', 'ERP Pecuário/Exportações/', 'ERP Pecuário/Testes/'],
    'pastas criadas; a planilha temporária do corpus e os arquivos da sonda foram para a lixeira');
  assert.ok(gas.drive.chamadas.some((c) => c.metodo === 'create' && c.id === banco), 'o banco nasce por Drive.Files.create (drive.file)');
  assert.equal(setup.drive.ok, true, 'sonda do Drive (SP-02): criar, copiar, ler, listar e lixeira');
  // Abas: as 34 do Schema, cabeçalho exato, dimensão exata; a aba padrão da planilha nova saiu.
  assert.deepEqual(js(gas.planilhas.abas(banco)), js(G.Schema.nomesTabelas()));
  assert.deepEqual(setup.abas.removidas, ['Página1']);
  for (const t of G.Schema.nomesTabelas()) {
    assert.deepEqual(gas.planilhas.matriz(banco, t)[0], js(G.Schema.colunas(t)), 'cabeçalho de ' + t);
  }
  assert.deepEqual(js(gas.planilhas.propriedades(banco)), { nome: 'ERP Pecuário — Banco de dados', fuso: 'America/Porto_Velho', locale: 'pt_BR' });
  // Sementes por chave natural.
  assert.deepEqual(setup.sementes, { CONFIGURACOES: 45, LISTAS: 69, PLANO_CONTAS: 29, CATEGORIAS: 9 });
  assert.equal(s.tabela('PLANO_CONTAS').length, 29);
  // SCHEMA_META: uma linha por aba, colunas na ordem, versão das sementes nas semeadas.
  const meta = s.tabela('SCHEMA_META');
  assert.equal(meta.length, 34);
  const pes = meta.find((m) => m.tabela === 'PESAGENS');
  assert.deepEqual([pes.versao, pes.colunas_json, pes.sementes_versao], [1, js(G.Schema.colunas('PESAGENS')), null]);
  assert.equal(meta.find((m) => m.tabela === 'CATEGORIAS').sementes_versao, G.Schema.SEMENTES_VERSAO);
  // Gatilhos, proteção de aviso, propriedades do script.
  assert.deepEqual(gas.triggers.map((t) => t.getHandlerFunction()).sort(), ['trgIntegridadeSemanal', 'trgManutencaoDiaria']);
  const diario = gas.triggers.find((t) => t.getHandlerFunction() === 'trgManutencaoDiaria')._spec;
  assert.deepEqual([diario.everyDays, diario.atHour, diario.timezone], [1, 3, 'America/Porto_Velho']);
  assert.equal(gas.triggers.find((t) => t.getHandlerFunction() === 'trgIntegridadeSemanal')._spec.weekDay, 'SUNDAY');
  assert.equal(setup.protecoes, 34);
  gas.exec(() => {
    const sh = G.SpreadsheetApp.openById(banco).getSheetByName('EVENTOS');
    assert.equal(sh.getProtections(G.SpreadsheetApp.ProtectionType.SHEET)[0].isWarningOnly(), true);
  });
  const p = s.props();
  assert.equal(p.OWNER_EMAIL, S.USUARIO);
  assert.equal(p.IO_PRIMITIVE, 'SHEETS_TYPED');
  assert.deepEqual(Object.keys(JSON.parse(p.DRIVE_FOLDERS)).sort(), ['anexos', 'backups', 'exportacoes', 'raiz', 'testes']);
  assert.equal(setup.backup, null, 'banco novo: nada a copiar antes');
  assert.deepEqual(setup.contadores, { proximo_event_seq: 1, proximo_codigo_interno: 1 });
  assert.equal(setup.integridade.ok, true, 'a verificação de integridade no fim do setup passa');
  assert.equal(setup.integridade.erros, 0);
  // Trilha: a inserção das sementes ficou em AUDITORIA (MANUTENCAO).
  assert.ok(s.tabela('AUDITORIA').some((a) => a.acao === 'MANUTENCAO' && /sementes inseridas/.test(a.valor_novo)));
});

test('CT-11 (2)–(3): setup de novo não duplica, não sobrescreve o dono, não recria item desativado; backup antes; repõe gatilho', () => {
  const s = S.sistema({ semCadastro: true, order: 'reverse' });
  const { gas, G } = s;
  const garrote = s.tabela('CATEGORIAS').find((c) => c.codigo === 'GARROTE');
  assert.ok(garrote, 'semente GARROTE existe');
  s.exec((ctx) => G.UnitOfWork.run(ctx, {
    rota: 'teste.config', idempotencyKey: 'mudar-config', dados: {}, reads: ['CONFIGURACOES', 'CATEGORIAS'],
    tratador: (tx) => {
      G.AuditService.alteracao(tx, 'CONFIGURACOES', 'ua_peso_kg', { valor: '400' });
      G.AuditService.alteracao(tx, 'CATEGORIAS', garrote.category_id, { ativo: false });
      return { resumo: {} };
    },
  }));
  const antes = contagens(s);
  // O dono apaga um gatilho e duplica o outro à mão.
  gas.exec(() => {
    const ts = G.ScriptApp.getProjectTriggers();
    G.ScriptApp.deleteTrigger(ts.find((t) => t.getHandlerFunction() === 'trgIntegridadeSemanal'));
    G.ScriptApp.newTrigger('trgManutencaoDiaria').timeBased().everyDays(1).atHour(9).create();
  });
  const rel = js(gas.exec(() => G.Maintenance.setup({ usuario: S.USUARIO })));
  assert.equal(rel.banco_criado, false);
  assert.equal(rel.banco, s.banco());
  assert.deepEqual(rel.sementes, { CONFIGURACOES: 0, LISTAS: 0, PLANO_CONTAS: 0, CATEGORIAS: 0 });
  assert.deepEqual(rel.abas, { criadas: [], colunas_acrescentadas: {}, removidas: [] });
  assert.deepEqual(rel.schema_meta, { criadas: 0, atualizadas: 0 });
  const depois = contagens(s);
  assert.deepEqual(depois, antes, 'mesmas contagens de linhas em todas as abas');
  assert.equal(s.tabela('CONFIGURACOES').find((c) => c.chave === 'ua_peso_kg').valor, '400', 'valor do dono preservado');
  const cats = s.tabela('CATEGORIAS').filter((c) => c.codigo === 'GARROTE');
  assert.deepEqual(cats.map((c) => c.ativo), [false], 'categoria desativada não é recriada');
  assert.deepEqual(rel.gatilhos, { criados: ['trgIntegridadeSemanal'], removidos: 1, total: 2 });
  assert.equal(gas.triggers.length, 2);
  // Backup feito antes de mexer no banco, com o estado de antes (o parâmetro do dono já estava lá).
  assert.ok(rel.backup && rel.backup.motivo === 'SETUP');
  const copia = gas.drive.arquivo(rel.backup.id);
  assert.deepEqual([copia.appProperties.erp_tipo, copia.appProperties.erp_banco, copia.appProperties.erp_motivo], ['BACKUP', s.banco(), 'SETUP']);
  assert.equal(s.tabela('CONFIGURACOES', rel.backup.id).find((c) => c.chave === 'ua_peso_kg').valor, '400');
  assert.equal(rel.integridade.ok, true);
});

test('CT-11 (4): setup com o esquema da fase seguinte acrescenta a coluna nova no fim, com os dados intactos', () => {
  const s = S.sistema();
  const { gas, G } = s;
  s.evento('registrar', S.entradaInicial([S.bicho({ brinco: '7', peso: 300.5, metodo_pesagem: 'BALANCA' })]), 'ev-1');
  const antes = s.tabela('PESAGENS');
  assert.equal(antes.length, 1);
  const base = G.Schema.tabela('PESAGENS');
  const nova = { nome: base.nome, pk: base.pk, colunas: js(base.colunas).concat([{ nome: 'escore_corporal', tipo: 'DEC1' }]) };
  const rel = js(gas.exec(() => G.Maintenance.setup({ usuario: S.USUARIO, tabelas: { PESAGENS: nova } })));
  assert.deepEqual(rel.abas.colunas_acrescentadas, { PESAGENS: ['escore_corporal'] });
  const cab = gas.planilhas.matriz(s.banco(), 'PESAGENS')[0];
  assert.deepEqual(cab, js(G.Schema.colunas('PESAGENS')).concat(['escore_corporal']), 'coluna nova no FIM; nada removido nem reordenado');
  assert.deepEqual(s.tabela('PESAGENS'), antes, 'dados intactos (a leitura do esquema atual ignora a coluna nova)');
  const meta = s.tabela('SCHEMA_META').find((m) => m.tabela === 'PESAGENS');
  assert.deepEqual([meta.versao, meta.colunas_json.slice(-1)], [2, ['escore_corporal']], 'SCHEMA_META sobe a versão da aba');
  assert.deepEqual(rel.schema_meta, { criadas: 0, atualizadas: 1 });
  // A versão publicada antiga (Schema atual) continua funcionando sobre o banco migrado.
  s.evento('registrar', S.entradaInicial([S.bicho({ brinco: '8', peso: 280, metodo_pesagem: 'FITA' })]), 'ev-2');
  assert.equal(s.tabela('PESAGENS').length, 2);
  s.conferirProjecoes('depois da migração');
});

test('setup: escolha da forma de gravação pelo corpus — cai para a seguinte quando a preferida falha; nenhuma → CONFIG sem banco', () => {
  const gas = createGas({ order: 'alpha' });
  const G = gas.G;
  // A gravação tipada falha no corpus (erro de serviço): a seguinte da ordem é adotada.
  gas.falhas.falharNaEscrita(1, { aba: 'CORPUS_SHEETS_TYPED', tipo: 'api', mensagem: 'Serviço indisponível (teste)' });
  const rel = js(gas.exec(() => G.Maintenance.setup({ usuario: S.USUARIO })));
  assert.equal(rel.primitiva.primitiva, 'SHEETS_RAW');
  assert.deepEqual(rel.primitiva.resultados.map((r) => [r.primitiva, r.ok]), [['SHEETS_TYPED', false], ['SHEETS_RAW', true]]);
  assert.match(rel.primitiva.resultados[0].erro, /Serviço indisponível/);
  assert.equal(gas.props.script._data.get('IO_PRIMITIVE'), 'SHEETS_RAW');
  assert.equal(rel.integridade.ok, true, 'o banco montado com a primitiva escolhida passa na integridade');

  // Nenhuma passa: CONFIG e o banco não é criado.
  const gas2 = createGas({ order: 'reverse' });
  ['CORPUS_SHEETS_TYPED', 'CORPUS_SHEETS_RAW', 'CORPUS_SPREADSHEET_APP'].forEach((aba) => gas2.falhas.falharNaEscrita(1, { aba, mensagem: 'falha (teste)' }));
  const r = gas2.tentar(() => gas2.G.Maintenance.setup({ usuario: S.USUARIO }));
  assert.equal(r.ok, false);
  assert.equal(r.erro.code, 'CONFIG');
  assert.match(r.erro.message, /Nenhuma forma de gravação/);
  assert.equal(gas2.props.script._data.get('SPREADSHEET_ID'), undefined, 'sem banco');
  assert.ok(JSON.parse(gas2.props.script._data.get('IO_PRIMITIVE_RELATORIO')).resultados.every((x) => !x.ok), 'o relatório do teste de gravação fica guardado');
});

test('setup: outro usuário → DENIED; lock ocupado → LOCKED; banco registrado sumido → CONFIG com instrução (nunca cria outro em silêncio)', () => {
  const s = S.sistema({ semCadastro: true });
  const { gas, G } = s;
  let r = gas.tentar(() => G.Maintenance.setup({ usuario: 'outro@gmail.com' }));
  assert.equal(r.erro.code, 'DENIED');
  gas.lock.segurarPorOutra();
  r = gas.tentar(() => G.Maintenance.setup({ usuario: S.USUARIO }));
  assert.equal(r.erro.code, 'LOCKED');
  gas.lock.soltarOutra();
  const banco = s.banco();
  gas.exec(() => G.Drive.Files.update({ trashed: true }, banco));
  r = gas.tentar(() => G.Maintenance.setup({ usuario: S.USUARIO }));
  assert.equal(r.erro.code, 'CONFIG');
  assert.match(r.erro.message, /não foi encontrada/);
  assert.equal(s.banco(), banco, 'o banco registrado continua o mesmo');
  assert.equal(gas.lock.dono(), null, 'o lock foi solto');
});
