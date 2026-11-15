'use strict';
/**
 * Manutenção (06, seção 10): backup sob demanda com o banco parado (lock e recuperação antes da cópia), retenção de
 * 30 diários + 12 mensais (extras pelo mesmo número de dias), o ENSAIO COMPLETO DE RESTAURAÇÃO (backup com operação
 * interrompida dentro → cópia vira o banco, versão acima da servida, marcador antes da troca, recoverAll, trilha,
 * integridade, banco anterior intacto), a rotina diária (backup → exportações → anexos temporários e órfãos), etapa
 * que falha sem impedir as outras, e a verificação semanal.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');
const { instrumentar } = require('./apoio-persistencia');

const { js, PASTOS } = S;
const DIA = 86400000;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function animaisAtivos(s, banco) {
  return s.tabela('ANIMAIS', banco).filter((a) => a.situacao_cadastral === 'ATIVO').map((a) => a.brinco).sort();
}

test('backup sob demanda: banco parado (recupera antes), cópia durável na pasta Backups com as marcas; listar do mais novo', () => {
  const s = S.sistema();
  const { gas, G } = s;
  s.evento('registrar', S.entradaInicial([S.bicho({ brinco: '1' })]), 'ev-1');
  // Operação interrompida antes do commit: o backup recupera (FALHOU) antes de copiar.
  const r = gas.tentar(() => {
    const ctx = s.ctx();
    instrumentar(gas, ctx, { depois: 3 });
    return G.EventService.registrar(ctx, { idempotencyKey: 'ev-2', dados: S.entradaInicial([S.bicho({ brinco: '2' })]) });
  });
  assert.equal(r.morta, true);
  gas.lock.segurarPorOutra({ liberaEmMs: 1000 });
  const b = s.exec((ctx) => G.Maintenance.backup(ctx, { motivo: 'SOB_DEMANDA' }));
  assert.equal(b.retencao, null, 'só o diário aplica a retenção');
  assert.match(b.backup.nome, /^ERP Pecuário — backup 2026-11-13 \d\dh\d\d \(sob demanda\)$/);
  const ap = gas.drive.arquivo(b.backup.id).appProperties;
  assert.deepEqual([ap.erp_tipo, ap.erp_banco, ap.erp_motivo, ap.erp_data], ['BACKUP', s.banco(), 'SOB_DEMANDA', '2026-11-13']);
  const ops = s.tabela('OPERACOES', b.backup.id);
  assert.ok(ops.every((o) => o.status !== 'INICIADA'), 'a cópia não leva operação órfã: a recuperação rodou antes');
  assert.deepEqual(animaisAtivos(s, b.backup.id), ['1']);
  gas.clock.now += 60000;
  s.exec((ctx) => G.Maintenance.backup(ctx, {}));
  const lista = s.exec((ctx) => G.Maintenance.listarBackups(ctx));
  assert.equal(lista.length, 2);
  assert.ok(lista[0].instante > lista[1].instante, 'do mais novo para o mais antigo');
  assert.equal(s.tentar((ctx) => G.Maintenance.backup(ctx, { motivo: 'QUALQUER' })).erro.code, 'INTERNAL');
});

test('retenção: 30 diários mais recentes + o último de cada mês nos 12 meses seguintes; extras ficam 30 dias', () => {
  const s = S.sistema({ semCadastro: true });
  const { gas, G } = s;
  const f = gas.exec(() => G.FileService.porta());
  const banco = s.banco();
  const hoje = Date.parse('2026-11-13T12:00:00.000Z');
  function backupFalso(data, motivo) {
    const instante = data + 'T06:00:00.000Z';
    return gas.exec(() => f.guardarArquivo({ nome: 'bk ' + data + ' ' + motivo, mimeType: 'text/plain', texto: 'x', pasta: 'backups', appProperties: { erp_tipo: 'BACKUP', erp_banco: banco, erp_data: data, erp_motivo: motivo, erp_instante: instante } })).id;
  }
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  for (let d = Date.parse('2025-10-01T12:00:00.000Z'); d <= hoje; d += DIA) backupFalso(iso(d), 'DIARIO');
  backupFalso('2026-11-01', 'SOB_DEMANDA');
  backupFalso('2026-09-01', 'IMPORTACAO');
  // Backup de outro banco (restauração antiga) não entra na conta deste.
  gas.exec(() => f.guardarArquivo({ nome: 'outro', mimeType: 'text/plain', texto: 'x', pasta: 'backups', appProperties: { erp_tipo: 'BACKUP', erp_banco: 'outro-banco', erp_data: '2025-01-01', erp_motivo: 'DIARIO', erp_instante: '2025-01-01T06:00:00.000Z' } }));
  const r = s.exec((ctx) => G.Maintenance.aplicarRetencao(ctx));
  const ficaram = s.exec((ctx) => G.Maintenance.listarBackups(ctx));
  const diarios = ficaram.filter((b) => b.motivo === 'DIARIO').map((b) => b.data);
  const recentes = diarios.slice(0, 30);
  assert.deepEqual([recentes[0], recentes[29]], ['2026-11-13', '2026-10-15']);
  assert.deepEqual(diarios.slice(30), ['2026-10-14', '2026-09-30', '2026-08-31', '2026-07-31', '2026-06-30', '2026-05-31', '2026-04-30', '2026-03-31', '2026-02-28', '2026-01-31', '2025-12-31', '2025-11-30'], '12 mensais: o último de cada mês');
  assert.deepEqual(ficaram.filter((b) => b.motivo !== 'DIARIO').map((b) => b.data), ['2026-11-01'], 'extra de 12 dias fica; o de 73 dias sai');
  assert.equal(r.mantidos, 43);
  assert.equal(r.removidos.length, 409 + 2 - 43);
  assert.equal(s.exec((ctx) => G.Maintenance.listarBackups(ctx, { todos: true })).length, 44, 'o backup do outro banco ficou');
  // Parâmetros do dono valem: 5 diários e 2 mensais.
  s.exec((ctx) => G.UnitOfWork.run(ctx, { rota: 't', idempotencyKey: 'ret', reads: ['CONFIGURACOES'], tratador: (tx) => { G.AuditService.alteracao(tx, 'CONFIGURACOES', 'backup_retencao_diarios', { valor: '5' }); G.AuditService.alteracao(tx, 'CONFIGURACOES', 'backup_retencao_mensais', { valor: '2' }); return { resumo: {} }; } }));
  s.exec((ctx) => G.Maintenance.aplicarRetencao(ctx));
  const datas = s.exec((ctx) => G.Maintenance.listarBackups(ctx)).filter((b) => b.motivo === 'DIARIO').map((b) => b.data);
  assert.deepEqual(datas, ['2026-11-13', '2026-11-12', '2026-11-11', '2026-11-10', '2026-11-09', '2026-11-08', '2026-10-31'], '5 diários; mensais: o último de novembro e o de outubro');
});

test('ENSAIO DE RESTAURAÇÃO: backup com operação interrompida → banco novo, versão acima, recoverAll, trilha, integridade; o anterior fica', () => {
  const s = S.sistema();
  const { gas, G } = s;
  s.evento('registrar', S.entradaInicial([S.bicho({ brinco: '10' }), S.bicho({ brinco: '11', pasto_destino_id: PASTOS.B })]), 'ev-1');
  // Operação confirmada, mas a execução morre antes dos derivados (fase C): fica órfã no banco.
  const alvo = { depois: null };
  const r = gas.tentar(() => {
    const ctx = s.ctx();
    instrumentar(gas, ctx, Object.assign(alvo, { antesDe: (k, rotulo) => { if (rotulo === 'atualizar:OPERACOES.status' && alvo.depois === null) alvo.depois = k; } }));
    return G.EventService.registrar(ctx, { idempotencyKey: 'ev-2', dados: { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-03-01', description: 'Doação' }, animais: [S.bicho({ brinco: '12' })] } });
  });
  assert.equal(r.morta, true);
  // O setup copia o banco como está (cópia crua, com a órfã) antes de mexer; depois recupera o banco em uso.
  const rel = js(gas.exec(() => G.Maintenance.setup({ usuario: S.USUARIO })));
  const backupId = rel.backup.id;
  assert.ok(s.tabela('OPERACOES', backupId).some((o) => o.status === 'CONFIRMADA' && !o.aplicada_em), 'o backup guarda a operação interrompida');
  const antigo = s.banco();
  s.evento('registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-04-01', description: 'Doação' }, animais: [S.bicho({ brinco: '13' })] }, 'ev-3');
  assert.deepEqual(animaisAtivos(s, antigo), ['10', '11', '12', '13']);
  const versaoAntiga = Number(s.props()['DATA_VERSION:' + antigo]);

  const res = s.exec((ctx) => G.Maintenance.restaurar(ctx, { dados: { backup_id: backupId, justificativa: 'Ensaio de restauração da Fase 1' } }));
  const novo = res.banco;
  assert.notEqual(novo, antigo);
  assert.equal(res.banco_anterior, antigo);
  assert.equal(s.banco(), novo, 'SPREADSHEET_ID trocado');
  assert.ok(gas.drive.chamadas.some((c) => c.metodo === 'copy' && c.id === novo && c.origem === backupId), 'a cópia do backup foi feita pelo Drive v3');
  assert.equal(gas.drive.arquivo(novo).appProperties.erp_tipo, 'BANCO');
  assert.ok(res.dataVersion > versaoAntiga, 'a versão do banco novo nasce acima da última servida');
  assert.equal(s.props()['PENDING_OP:' + novo], undefined, 'marcador removido pela recuperação');
  assert.deepEqual(res.recuperacao.refeitas.length, 1, 'recoverAll concluiu a operação confirmada que estava no backup');
  assert.deepEqual(animaisAtivos(s, novo), ['10', '11', '12'], 'o banco restaurado tem o que havia no backup (com a operação concluída)');
  assert.equal(s.tabela('OPERACOES', novo).filter((o) => o.status === 'CONFIRMADA' && !o.aplicada_em).length, 0);
  assert.ok(s.tabela('AUDITORIA', novo).some((a) => a.acao === 'MANUTENCAO' && /Banco restaurado do backup/.test(a.valor_novo) && a.justificativa === 'Ensaio de restauração da Fase 1'));
  assert.equal(res.integridade.ok, true, JSON.stringify(res.integridade.achados));
  assert.deepEqual(animaisAtivos(s, antigo), ['10', '11', '12', '13'], 'o banco anterior continua no Drive, intacto');
  assert.equal(gas.drive.arquivo(antigo).trashed, false);
  s.conferirProjecoes('banco restaurado');
  // O sistema segue funcionando sobre o banco restaurado.
  s.evento('registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-05-01', description: 'Doação' }, animais: [S.bicho({ brinco: '14' })] }, 'ev-4');
  assert.deepEqual(animaisAtivos(s, novo), ['10', '11', '12', '14']);
  // Recusas: arquivo que não é backup → NOT_FOUND; lock ocupado → LOCKED.
  assert.equal(s.tentar((ctx) => G.Maintenance.restaurar(ctx, { dados: { backup_id: antigo } })).erro.code, 'NOT_FOUND');
  gas.lock.segurarPorOutra();
  assert.equal(s.tentar((ctx) => G.Maintenance.restaurar(ctx, { dados: { backup_id: backupId, justificativa: 'Ensaio com o banco ocupado' } })).erro.code, 'LOCKED');
  gas.lock.soltarOutra();
});

test('rotina diária: backup e retenção → exportações velhas → anexos temporários vencidos, órfãos e removidos; semanal guarda o resumo', () => {
  const s = S.sistema();
  const { gas, G } = s;
  const ev = s.evento('registrar', S.entradaInicial([S.bicho({ brinco: '30' })]), 'ev-1');
  const animalId = ev.dados.animais[0].animal_id;
  const f = gas.exec(() => G.FileService.porta());
  const velha = gas.exec(() => f.guardarArquivo({ nome: 'relatorio.xlsx', mimeType: 'text/plain', texto: 'x', pasta: 'exportacoes' })).id;
  gas.drive.definirDatas(velha, { createdTime: '2026-11-01T00:00:00.000Z' });
  const nova = gas.exec(() => f.guardarArquivo({ nome: 'hoje.pdf', mimeType: 'text/plain', texto: 'x', pasta: 'exportacoes' })).id;
  const temp = s.exec((ctx) => G.FileService.adicionarAnexo(ctx, { idempotencyKey: 'a1', dados: { entidade: 'ANIMAIS', entity_id: animalId, tipo: 'DOCUMENTO', nome_arquivo: 'gta.pdf', mime_type: 'application/pdf', conteudo_base64: b64('%PDF'), temporario: true } })).dados;
  const ativo = s.exec((ctx) => G.FileService.adicionarAnexo(ctx, { idempotencyKey: 'a2', dados: { entidade: 'ANIMAIS', entity_id: animalId, tipo: 'FOTO', nome_arquivo: 'f.jpg', mime_type: 'image/jpeg', conteudo_base64: b64('jpg') } })).dados;
  // Arquivo de anexo sem linha (o comando dele não confirmou) e um removido cujo arquivo não foi para a lixeira.
  const orfao = gas.exec(() => f.guardarArquivo({ nome: 'perdido.jpg', mimeType: 'image/jpeg', texto: 'x', pasta: 'anexos', appProperties: { erp_tipo: 'ANEXO', erp_banco: s.banco() } })).id;
  const linhaAtivo = s.tabela('ANEXOS').find((a) => a.anexo_id === ativo.anexo_id);
  gas.clock.now += 25 * 3600000;
  const recente = gas.exec(() => f.guardarArquivo({ nome: 'subindo.jpg', mimeType: 'image/jpeg', texto: 'x', pasta: 'anexos', appProperties: { erp_tipo: 'ANEXO', erp_banco: s.banco() } })).id;
  s.exec((ctx) => G.UnitOfWork.run(ctx, { rota: 't', idempotencyKey: 'rem', reads: ['ANEXOS'], tratador: (tx) => { G.AuditService.alteracao(tx, 'ANEXOS', ativo.anexo_id, { status: 'REMOVIDO' }); return { resumo: {} }; } }));

  const rel = s.exec((ctx) => G.Maintenance.manutencaoDiaria(ctx));
  assert.equal(rel.backup.motivo, 'DIARIO');
  assert.ok(rel.retencao && rel.retencao.removidos.length === 0);
  assert.deepEqual(rel.exportacoes, { removidas: 1 });
  assert.deepEqual(rel.anexos, { temporarios: 1, orfaos: 1, arquivos_removidos: 2 }, 'arquivos do temporário vencido e do anexo removido');
  assert.deepEqual(rel.falhas, []);
  assert.equal(gas.drive.arquivo(velha).trashed, true);
  assert.equal(gas.drive.arquivo(nova).trashed, false);
  assert.equal(gas.drive.arquivo(orfao).trashed, true);
  assert.equal(gas.drive.arquivo(recente).trashed, false, 'arquivo de menos de 24 h pode estar esperando o comando');
  assert.equal(gas.drive.arquivo(linhaAtivo.drive_file_id).trashed, true);
  const linhaTemp = s.tabela('ANEXOS').find((a) => a.anexo_id === temp.anexo_id);
  assert.equal(linhaTemp.status, 'REMOVIDO');
  assert.equal(gas.drive.arquivo(linhaTemp.drive_file_id).trashed, true);
  assert.ok(s.tabela('AUDITORIA').some((a) => a.entidade === 'ANEXOS' && a.entity_id === temp.anexo_id && a.valor_novo === 'REMOVIDO' && /Limpeza diária/.test(a.justificativa)));
  // Semanal: relatório e resumo guardado.
  const sem = s.exec((ctx) => G.Maintenance.integridadeSemanal(ctx));
  assert.equal(sem.ok, true);
  assert.deepEqual(Object.keys(JSON.parse(s.props()['INTEGRIDADE:' + s.banco()])).sort(), ['alertas', 'erros', 'gerado_em', 'ok']);
  const est = s.exec((ctx) => G.Maintenance.estado(ctx));
  assert.equal(est.ultimo_backup.motivo, 'DIARIO');
  assert.deepEqual(est.gatilhos.sort(), ['trgIntegridadeSemanal', 'trgManutencaoDiaria']);
  assert.deepEqual(est.alertas_estado, { backup: { ultimo_em: rel.backup.instante }, integridade: { verificado_em: sem.gerado_em, erros: 0 } });
  const alertas = s.read(G.InventoryService.consultaAlertas(est.alertas_estado));
  assert.deepEqual(alertas.nao_avaliados, [], 'o estado da manutenção alimenta os alertas de backup e integridade');
  assert.ok(!alertas.alertas.some((a) => a.codigo === 'BACKUP_ATRASADO' || a.codigo === 'INTEGRIDADE_COM_ERRO'));
});

test('rotina diária: etapa que falha não impede as seguintes; vai para ERROS_LOG e a rotina termina com erro e relatório', () => {
  const s = S.sistema();
  const { gas, G } = s;
  const f = gas.exec(() => G.FileService.porta());
  const velha = gas.exec(() => f.guardarArquivo({ nome: 'velha.pdf', mimeType: 'text/plain', texto: 'x', pasta: 'exportacoes' })).id;
  gas.drive.definirDatas(velha, { createdTime: '2026-10-01T00:00:00.000Z' });
  // O Drive recusa copiar o banco (ex.: escopo insuficiente): o backup falha.
  const r = s.tentar((ctx) => {
    const files = ctx.files;
    ctx.files = Object.assign({}, files, { copiar: () => { throw new Error('Drive recusou a cópia (teste)'); } });
    return G.Maintenance.manutencaoDiaria(ctx);
  });
  assert.equal(r.erro.code, 'INTERNAL');
  assert.match(r.erro.message, /1 etapa\(s\) com falha: backup/);
  assert.deepEqual(r.erro.relatorio.falhas.map((x) => [x.etapa, x.code]), [['backup', 'CONFIG']]);
  assert.deepEqual(r.erro.relatorio.exportacoes, { removidas: 1 }, 'a limpeza rodou mesmo com o backup falhando');
  assert.equal(gas.drive.arquivo(velha).trashed, true);
  assert.ok(s.tabela('ERROS_LOG').some((e) => e.codigo === 'MANUTENCAO_BACKUP' && e.contexto === 'trgManutencaoDiaria'));
});
