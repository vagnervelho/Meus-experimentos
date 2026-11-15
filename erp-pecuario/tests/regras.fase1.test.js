'use strict';
/**
 * Regras de negócio da Fase 1 (05-regras-de-negocio.md) que não tinham teste próprio, ou que a revisão adversarial
 * encontrou implementadas pela metade. Mapa das demais regras da Fase 1 → teste que as exercita:
 *
 *  2.1  RN-002/003 events.test "CT-09: brinco duplicado"; RN-005 inventory.test "alertas da Fase 1"; RN-004 só tem caso
 *       real com a troca de brinco (Fase 3): o caso da Fase 1 (brinco corrigido não bloqueia) está em events.test
 *       "correção de cadastro".
 *  2.2  RN-007 a RN-010 na entrada: events.test "CT-09: mãe inválida"; na importação: import.test "genealogia".
 *  2.3  RN-013/024/025 integrity.test e jornada.fase1.test; RN-014/015/016/018 timeline.test "máquina de estados";
 *       RN-017 timeline.test "datas"; RN-020 events.test "(i) adaptado"; RN-022 events.test "ENTRADA_INICIAL: só na
 *       data do marco zero"; RN-023 timeline.test "ordem canônica"; RN-026 inventory.test.
 *  2.4  RN-028 events.test "300 animais com 1 inválido"; RN-030/031 unitofwork.test; RN-032 import.test "CT-12".
 *  2.5  RN-033/034/035/036/038 events.test "CT-10" e unitofwork.test.
 *  2.6  RN-039/041/043 events.test "estorno"; RN-040 timeline.test "(iii)"; RN-044 events.test "CT-18"; RN-042/046
 *       (parcela liquidada) são da Fase 4: na Fase 1 não há baixa de parcela.
 *  2.13 RN-088 a RN-094 import.test; RN-095 (reconciliação) é da Fase 2.
 *  2.14 RN-096 events.test "categorias" e animals.test; RN-097/098 config.test e inventory.test; RN-099 setup.test;
 *       RN-100/101 config.test; RN-102 config.test (lista e categoria; conta é da Fase 4).
 *  2.15 RN-103/104 api.test e static.test; RN-106 telas.test "exportação CSV"; RN-107 inventory.test.
 *  2.16 RN-109 animals.test e pastures.test; RN-111/112 jornada.fase1.test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('./apoio-cadastros');
const S = require('./apoio-sistema');

const { PASTOS, bicho, entradaInicial, outraEntrada, ajuste, codigos, js } = C;
const HOJE = '2026-11-13';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SRC = path.join(__dirname, '..', 'src');

/** Rebanho pequeno: avó → mãe → filha (com datas), um touro e o filho dele, todos no Pasto A. */
function rebanho() {
  const c = C.ambienteCadastros();
  const m = c.m;
  const ent = m.run('registrar', entradaInicial([
    bicho({ brinco: '1', ref: 'a', data_nascimento: '2015-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    bicho({ brinco: '2', ref: 'b', mae_ref: 'a', mae_confianca: 'CONFIRMADA', data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    bicho({ brinco: '3', mae_ref: 'b', mae_confianca: 'CONFIRMADA', data_nascimento: '2024-05-01', data_nascimento_confianca: 'ESTIMADA' }),
    bicho({ brinco: '4', sexo: 'M', reprodutor: true, ref: 't' }),
    bicho({ brinco: '5', sexo: 'M', pai_ref: 't', pai_confianca: 'ESTIMADA' }),
  ]));
  const [avo, mae, filha, touro, filho] = ent.dados.animais.map((a) => a.animal_id);
  return { c, m, ent, avo, mae, filha, touro, filho };
}
const correcao = (itens) => ajuste('CORRECAO_CADASTRO', HOJE, itens);
const erro = (r) => { assert.equal(r.ok, false, 'devia ter sido recusado'); return r.erro; };

// ------------------------------------------------------------------ 2.1 identificação e cadastro ----
test('RN-001: toda chave é UUID em texto, única na aba e independente da linha; codigo_interno é sequência própria', () => {
  const { c, m } = rebanho();
  m.run('registrar', outraEntrada('2026-03-01', [bicho({ brinco: '9' })]));
  for (const aba of ['ANIMAIS', 'EVENTOS', 'EVENTO_ANIMAIS', 'IDENTIFICACOES', 'OPERACOES']) {
    const pk = c.G.Schema.pk(aba);
    const ids = c.tabela(aba).map((r) => r[pk]);
    assert.ok(ids.length > 0, aba);
    ids.forEach((id) => assert.match(id, UUID, aba + '.' + pk));
    assert.equal(new Set(ids).size, ids.length, aba + ': chave repetida');
  }
  assert.deepEqual(c.tabela('ANIMAIS').map((a) => a.codigo_interno), ['A-000001', 'A-000002', 'A-000003', 'A-000004', 'A-000005', 'A-000006']);
});

test('RN-006: animal EXTERNO fica fora do inventário, não recebe evento de rebanho e só serve de progenitor', () => {
  const { c, m } = rebanho();
  const x = c.run('AnimalService.comandoCadastrarExterno', { campos: { nome: 'Touro de sêmen', sexo: 'M' } }).dados.animal_id;
  for (const dados of [
    ajuste('CORRECAO_LOCALIZACAO', '2026-05-01', [{ animal_id: x, pasto_destino_id: PASTOS.B }]),
    outraEntrada('2026-05-01', [{ animal_id: x, pasto_destino_id: PASTOS.B }]),
    correcao([{ animal_id: x, campo: 'castrado', valor_novo: 'S' }]),
  ]) assert.deepEqual(codigos(erro(m.tentar('registrar', dados))), ['ANIMAL_EXTERNO'], dados.tipo);
  const cria = m.run('registrar', outraEntrada('2026-05-02', [bicho({ brinco: '20', pai_id: x, pai_confianca: 'ESTIMADA' })]));
  assert.equal(m.animal(cria.dados.animais[0].animal_id).pai_id, x, 'externo aceito como pai');
  assert.equal(m.inventario(HOJE).total, 6, 'o externo não conta no inventário');
  assert.equal(m.animal(x).situacao_cadastral, 'EXTERNO');
});

// ------------------------------------------------------------------ 2.2 genealogia (pela correção de cadastro) ----
test('RN-007 a RN-012 na correção de cadastro: próprio progenitor, sexo, datas, ciclo, confiança e reflexo nos filhos', () => {
  const { m, avo, mae, filha, touro, filho } = rebanho();
  const casos = [
    ['RN-007 própria mãe', [{ animal_id: mae, campo: 'mae_id', valor_novo: mae }, { animal_id: mae, campo: 'mae_confianca', valor_novo: 'CONFIRMADA' }], 'PROPRIO_PROGENITOR'],
    ['RN-008 pai fêmea', [{ animal_id: filha, campo: 'pai_id', valor_novo: avo }, { animal_id: filha, campo: 'pai_confianca', valor_novo: 'ESTIMADA' }], 'SEXO_DO_PROGENITOR'],
    ['RN-009 mãe nascida depois', [{ animal_id: mae, campo: 'data_nascimento', valor_novo: '2025-01-01' }], 'NASCIMENTO_DO_PROGENITOR'],
    ['RN-010 ciclo com datas (avó filha da neta: a data já impede)', [{ animal_id: avo, campo: 'mae_id', valor_novo: filha }, { animal_id: avo, campo: 'mae_confianca', valor_novo: 'CONFIRMADA' }], 'NASCIMENTO_DO_PROGENITOR'],
    ['RN-010 ciclo sem datas (touro filho do filho)', [{ animal_id: touro, campo: 'pai_id', valor_novo: filho }, { animal_id: touro, campo: 'pai_confianca', valor_novo: 'CONFIRMADA' }], 'CICLO_GENEALOGICO'],
    ['RN-011 vínculo sem confiança', [{ animal_id: filho, campo: 'mae_id', valor_novo: mae }], 'CAMPO_OBRIGATORIO'],
    ['RN-012 sexo de quem é mãe', [{ animal_id: mae, campo: 'sexo', valor_novo: 'M' }], 'SEXO_DO_PROGENITOR'],
    ['RN-012 nascimento do pai depois do filho', [{ animal_id: filho, campo: 'data_nascimento', valor_novo: '2020-01-01' }, { animal_id: filho, campo: 'data_nascimento_confianca', valor_novo: 'CONFIRMADA' }, { animal_id: touro, campo: 'data_nascimento', valor_novo: '2022-01-01' }, { animal_id: touro, campo: 'data_nascimento_confianca', valor_novo: 'CONFIRMADA' }], 'NASCIMENTO_DO_PROGENITOR'],
  ];
  for (const [nome, itens, codigo] of casos) {
    const e = erro(m.tentar('registrar', correcao(itens)));
    assert.equal(e.code, 'VALIDATION', nome);
    assert.ok(codigos(e).includes(codigo), nome + ': ' + codigos(e));
  }
  // Mãe e pai podem ficar desconhecidos: apagar a mãe apaga a confiança junto.
  m.run('registrar', correcao([{ animal_id: filha, campo: 'mae_id', valor_novo: '' }]));
  assert.deepEqual([m.animal(filha).mae_id, m.animal(filha).mae_confianca], [null, null]);
});

// ------------------------------------------------------------------ 2.3 inventário e linha do tempo ----
test('RN-019 e RN-021: pasto de destino existe, está ativo e difere da origem; data não futura nem antes do nascimento', () => {
  const { m, mae } = rebanho();
  const casos = [
    [outraEntrada('2026-05-02', [bicho({ brinco: '11', pasto_destino_id: PASTOS.INATIVO })]), 'PASTO_INATIVO'],
    [ajuste('CORRECAO_LOCALIZACAO', '2026-05-02', [{ animal_id: mae, pasto_destino_id: C.id(0x999) }]), 'NAO_ENCONTRADO'],
    [ajuste('CORRECAO_LOCALIZACAO', '2026-05-02', [{ animal_id: mae, pasto_destino_id: PASTOS.A }]), 'VALOR_IGUAL'],
    [outraEntrada('2026-12-01', [bicho({ brinco: '12' })]), 'DATA_FUTURA'],
    [outraEntrada('2026-02-01', [bicho({ brinco: '13', data_nascimento: '2026-03-01', data_nascimento_confianca: 'CONFIRMADA' })]), 'NASCIMENTO_DEPOIS_DA_ENTRADA'],
  ];
  for (const [dados, codigo] of casos) {
    const e = erro(m.tentar('registrar', dados));
    assert.deepEqual([e.code, codigos(e)], ['VALIDATION', [codigo]], codigo);
  }
});

test('RN-027: entrada ou correção de localização que passa da capacidade informada pede confirmação; aceito, grava', () => {
  const { m, mae, filha, filho } = rebanho();
  const tres = [bicho({ brinco: '14', pasto_destino_id: PASTOS.PEQUENO }), bicho({ brinco: '15', pasto_destino_id: PASTOS.PEQUENO }), bicho({ brinco: '16', pasto_destino_id: PASTOS.PEQUENO })];
  const e = erro(m.tentar('registrar', outraEntrada('2026-05-03', tres)));
  assert.deepEqual([e.code, codigos(e)], ['NEEDS_CONFIRMATION', ['LOTACAO_ACIMA_DA_CAPACIDADE']]);
  assert.match(e.details[0].mensagem, /Piquete fica com 3 cabeças .* acima da capacidade informada \(2\)/);
  const loc = ajuste('CORRECAO_LOCALIZACAO', '2026-05-03', [mae, filha, filho].map((a) => ({ animal_id: a, pasto_destino_id: PASTOS.PEQUENO })));
  assert.deepEqual(codigos(erro(m.tentar('registrar', loc))), ['LOTACAO_ACIMA_DA_CAPACIDADE']);
  const ok = m.run('registrar', loc, { avisos: ['LOTACAO_ACIMA_DA_CAPACIDADE'] });
  assert.deepEqual(js(m.evento(ok.dados.event_id).payload_json).avisos_aceitos.map((a) => a.codigo), ['LOTACAO_ACIMA_DA_CAPACIDADE']);
});

// ------------------------------------------------------------------ 2.4 e 2.5 coletivo, versão ----
test('RN-029 e RN-037: animal repetido, lista vazia e campo repetido são recusados; versão esperada diferente é CONFLICT', () => {
  const { m, mae, filho } = rebanho();
  assert.deepEqual(codigos(erro(m.tentar('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-05-04', [{ animal_id: mae, pasto_destino_id: PASTOS.B }, { animal_id: mae, pasto_destino_id: PASTOS.C }])))), ['ANIMAL_REPETIDO']);
  assert.deepEqual(codigos(erro(m.tentar('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-05-04', [])))), ['SEM_ANIMAIS']);
  assert.deepEqual(codigos(erro(m.tentar('registrar', correcao([{ animal_id: filho, campo: 'castrado', valor_novo: 'S' }, { animal_id: filho, campo: 'castrado', valor_novo: 'N' }])))), ['CAMPO_REPETIDO']);
  const versao = m.amb.gas.exec(() => m.G.UnitOfWork.versao(m.amb.ctx()));
  const e = erro(m.tentar('registrar', outraEntrada('2026-05-05', [bicho({ brinco: '17' })]), { dataVersion: versao - 1 }));
  assert.equal(e.code, 'CONFLICT');
  assert.equal(m.porBrinco('17'), undefined, 'nada gravado');
  assert.equal(m.run('registrar', outraEntrada('2026-05-05', [bicho({ brinco: '17' })]), { dataVersion: versao }).duplicado, false, 'com a versão certa grava');
});

// ------------------------------------------------------------------ 2.6 estorno, substituição e ajuste ----
test('RN-045, RN-047 e RN-048: substituição só de observações não esbarra nos dependentes; ajuste exige justificativa e guarda anterior e novo; valor de criação preservado', () => {
  const { c, m, ent, mae, filha, touro } = rebanho();
  m.run('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-04-01', [{ animal_id: mae, pasto_destino_id: PASTOS.B }]));
  const itens = js(m.obter(ent.dados.event_id).linhas).map((l) => l.animal_id);
  assert.deepEqual(itens.length, 5);
  const mesmos = [
    bicho({ animal_id: ent.dados.animais[0].animal_id, brinco: '1', ref: 'a', data_nascimento: '2015-01-01', data_nascimento_confianca: 'CONFIRMADA', observacoes: 'mansa' }),
    bicho({ animal_id: mae, brinco: '2', ref: 'b', mae_ref: 'a', mae_confianca: 'CONFIRMADA', data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    bicho({ animal_id: filha, brinco: '3', mae_ref: 'b', mae_confianca: 'CONFIRMADA', data_nascimento: '2024-05-01', data_nascimento_confianca: 'ESTIMADA' }),
    bicho({ animal_id: touro, brinco: '4', sexo: 'M', reprodutor: true, ref: 't' }),
    bicho({ animal_id: ent.dados.animais[4].animal_id, brinco: '5', sexo: 'M', pai_ref: 't', pai_confianca: 'ESTIMADA' }),
  ];
  const sub = m.run('corrigir', Object.assign(entradaInicial(mesmos, { notes: 'contagem refeita' }), { event_id: ent.dados.event_id, justificativa: 'Observação esquecida' }));
  assert.equal(m.evento(sub.dados.event_id).status, 'CONFIRMADO');
  assert.equal(m.animal(mae).pasto_atual_id, PASTOS.B, 'a correção de localização posterior segue valendo');

  assert.deepEqual(codigos(erro(m.tentar('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-05-05', [{ animal_id: filha, pasto_destino_id: PASTOS.B }], { justificativa: '' })))), ['CAMPO_OBRIGATORIO']);
  m.run('registrar', correcao([{ animal_id: touro, campo: 'castrado', valor_novo: 'S' }, { animal_id: touro, campo: 'reprodutor', valor_novo: 'N' }]));
  const aj = c.tabela('AJUSTES').filter((a) => a.animal_id === touro).map((a) => [a.tipo_ajuste, a.campo, a.valor_anterior, a.valor_novo, a.justificativa]);
  assert.deepEqual(aj, [['CORRECAO_CADASTRO', 'castrado', 'N', 'S', 'Conferência no curral'], ['CORRECAO_CADASTRO', 'reprodutor', 'S', 'N', 'Conferência no curral']]);
  const t = m.animal(touro);
  assert.deepEqual([t.castrado, t.reprodutor], [true, false]);
  const criacao = c.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === sub.dados.event_id && l.animal_id === touro);
  assert.deepEqual([js(criacao.atributos_iniciais_json).castrado, js(criacao.atributos_iniciais_json).reprodutor], ['N', 'S'], 'o valor de criação continua o de criação (RN-048)');
  // Brinco, pasto e situação não se editam pela ficha: só por evento.
  for (const campo of ['brinco', 'pasto_atual_id', 'situacao_cadastral']) {
    const e = erro(c.tentar('AnimalService.comandoEditar', { animal_id: filha, campos: { [campo]: campo === 'brinco' ? '30' : campo === 'pasto_atual_id' ? PASTOS.C : 'MORTO' } }));
    assert.deepEqual(codigos(e), ['CAMPO_NAO_EDITAVEL'], campo);
  }
});

// ------------------------------------------------------------------ 2.14 configuração e categorias ----
test('RN-096 (faixa de idade da categoria): idade máxima exclusiva de pelo menos 1 mês e prioridade a partir de 0 — como a tela já exige', () => {
  const c = C.ambienteCadastros();
  const base = { sexo_aplicavel: 'M', condicao: 'NENHUMA', ativo: true };
  const casos = [
    [{ codigo: 'X1', nome: 'X1', idade_maxima_meses: 0, prioridade: 1 }, 'FAIXA_INVALIDA'],
    [{ codigo: 'X2', nome: 'X2', idade_minima_meses: 6, idade_maxima_meses: 6, prioridade: 2 }, 'FAIXA_INVALIDA'],
    [{ codigo: 'X3', nome: 'X3', idade_minima_meses: 400, prioridade: -1 }, 'VALOR_FORA_DA_FAIXA'],
  ];
  for (const [campos, codigo] of casos) {
    const e = erro(c.tentar('Config.comandoSalvarCategoria', { campos: Object.assign({}, base, campos) }, { avisos: ['CATEGORIAS_SEM_COBERTURA'] }));
    assert.deepEqual([e.code, codigos(e)], ['VALIDATION', [codigo]], campos.codigo);
  }
  const ok = c.run('Config.comandoSalvarCategoria', { campos: Object.assign({}, base, { codigo: 'X4', nome: 'Mamão', idade_maxima_meses: 1, prioridade: 0 }) }, { avisos: ['CATEGORIAS_SEM_COBERTURA'] });
  assert.ok(ok.dados.categorias.some((x) => x.codigo === 'X4'));
});

// ------------------------------------------------------------------ tela × servidor ----
function cliente(s) {
  const html = s.gas.exec(() => s.G.doGet({ parameter: {} })).getContent();
  const ctx = vm.createContext({ console });
  ctx.window = ctx;
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((b) => b.indexOf('DOMContentLoaded') < 0).forEach((b, i) => vm.runInContext(b, ctx, { filename: 'cliente' + i }));
  return ctx;
}

test('tela × servidor: campo que o servidor exige "maior que 0" também é recusado com 0 no formulário (área, capacidade, peso de referência)', () => {
  const s = S.sistema({ semCadastro: true });
  const Campos = cliente(s).Campos;
  const def = { id: 'area_hectares', tipo: 'decimal', casas: 4, unidade: 'ha', min: 0, min_exclusivo: true };
  assert.match(js(Campos.converter(def, '0')).erro, /maior que 0 ha/);
  assert.deepEqual(js(Campos.converter(def, '0,5')), { valor: 0.5 });
  assert.deepEqual(js(Campos.converter({ id: 'x', tipo: 'inteiro', min: 0 }, '0')), { valor: 0 }, 'sem min_exclusivo o mínimo vale');
  // Toda coluna de PASTOS, PROPRIEDADES e CATEGORIAS com mínimo exclusivo no esquema leva min_exclusivo no formulário.
  const telas = fs.readFileSync(path.join(SRC, 'Pastures.html'), 'utf8') + fs.readFileSync(path.join(SRC, 'Settings.html'), 'utf8');
  for (const aba of ['PASTOS', 'PROPRIEDADES', 'CATEGORIAS']) {
    s.G.Schema.TABELAS[aba].colunas.filter((col) => col.minExclusivo).forEach((col) => {
      const defs = [...telas.matchAll(new RegExp("\\{ id: '" + col.nome + "', rotulo: '[^']*', tipo: '[a-z]+'[^}]*\\}", 'g'))].map((x) => x[0]);
      assert.ok(defs.length, 'formulário com ' + aba + '.' + col.nome);
      defs.forEach((d) => assert.match(d, /min_exclusivo: true/, aba + '.' + col.nome));
    });
  }
});

// ------------------------------------------------------------------ 2.15 e 2.16 acesso e histórico ----
test('RN-105, RN-108 e RN-110: nenhum compartilhamento de arquivo; nenhuma rota de edição de evento nem de exclusão de cadastro', () => {
  const s = S.sistema({ semCadastro: true });
  const rotas = Object.keys(s.G.Api.rotas());
  const removem = rotas.filter((r) => /\.(excluir|apagar|remover|deletar|editar)/i.test(r));
  assert.deepEqual(removem.sort(), ['anexo.remover', 'animal.editar', 'rascunho.remover'], 'só anexo (vira REMOVIDO), rascunho (fora da planilha) e o cadastro do animal');
  assert.deepEqual(rotas.filter((r) => /^evento\./.test(r)).sort(), ['evento.corrigir', 'evento.estornar', 'evento.listar', 'evento.obter', 'evento.registrar', 'evento.simular']);
  const codigo = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  assert.doesNotMatch(codigo, /Permissions\.|['"]anyone['"]|setSharing|addViewer|addEditor/, 'nenhum arquivo do app é compartilhado');
});

// ------------------------------------------------------------------ backup e restauração (RN-107, 06 seção 10) ----
test('restauração: exige o motivo; recusa backup de outra base; depois dela os backups anteriores seguem na lista e na retenção', () => {
  const s = S.sistema();
  const { G } = s;
  const bk = s.exec((ctx) => G.Maintenance.backup(ctx, { motivo: 'SOB_DEMANDA' })).backup;
  const semMotivo = s.tentar((ctx) => G.Maintenance.restaurar(ctx, { dados: { backup_id: bk.id } }));
  assert.deepEqual([semMotivo.erro.code, codigos(semMotivo.erro)], ['VALIDATION', ['CAMPO_OBRIGATORIO']]);
  // Base de TESTE com backup próprio: não pode ser restaurada no lugar da real.
  s.gas.exec(() => G.Maintenance.setup({ usuario: S.USUARIO, ambiente: 'TESTE' }));
  const bkTeste = js(s.gas.exec(() => G.Maintenance.backup(G.Maintenance.contexto({ ambiente: 'TESTE', usuario: S.USUARIO }), {}))).backup;
  const outra = s.tentar((ctx) => G.Maintenance.restaurar(ctx, { dados: { backup_id: bkTeste.id, justificativa: 'engano' } }));
  assert.deepEqual([outra.erro.code, codigos(outra.erro)], ['VALIDATION', ['BACKUP_DE_OUTRA_BASE']]);
  assert.ok(!s.exec((ctx) => G.Maintenance.listarBackups(ctx)).some((b) => b.id === bkTeste.id), 'a lista da base real não mostra backup da de teste');
  // Restaurar: o banco muda de ID, mas o backup restaurado (e os anteriores) continuam visíveis e na retenção.
  const anterior = s.banco();
  const r = s.exec((ctx) => G.Maintenance.restaurar(ctx, { dados: { backup_id: bk.id, justificativa: 'Ensaio' } }));
  assert.notEqual(s.banco(), anterior);
  const lista = s.exec((ctx) => G.Maintenance.listarBackups(ctx));
  assert.ok(lista.some((b) => b.id === bk.id && b.banco === anterior && b.ambiente === 'PRODUCAO'), 'backup do banco anterior na lista');
  const est = s.exec((ctx) => G.Maintenance.estado(ctx));
  assert.equal(est.ultimo_backup.id, bk.id);
  const alertas = s.read(G.InventoryService.consultaAlertas(est.alertas_estado)).alertas.map((a) => a.codigo);
  assert.ok(!alertas.includes('BACKUP_ATRASADO'), 'backup de agora há pouco não está atrasado: ' + alertas);
  assert.equal(r.integridade.ok, true);
  const novo = s.exec((ctx) => G.Maintenance.backup(ctx, {})).backup;
  assert.deepEqual(s.exec((ctx) => G.Maintenance.listarBackups(ctx)).map((b) => b.id).slice(0, 2), [novo.id, bk.id], 'do mais novo para o mais antigo, os dois bancos');
});

// ------------------------------------------------------------------ 2.13 importação ----
test('RN-094: progenitor fora do rebanho cadastrado como animal de referência é achado pelo nome (ou pelo código interno) ao validar de novo', () => {
  const s = S.sistema();
  const { G } = s;
  const csv = ['Brinco;Sexo;Pai;Mãe;Pasto', '700;F;;;Pasto A', '701;M;Touro Sêmen Nelore;700;Pasto A', '702;F;A-000099;;Pasto A'].join('\r\n');
  const formato = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
  const mapa = { colunas: { Brinco: 'brinco', Sexo: 'sexo', Pai: 'pai', 'Mãe': 'mae', Pasto: 'pasto' }, confiancas: { pai: 'ESTIMADA', mae: 'CONFIRMADA' }, padroes: { castrado: false, reprodutor: false } };
  const imp = s.exec((ctx) => G.ImportService.criar(ctx, { idempotencyKey: 'rn094', avisosAceitos: [], dados: { tipo: 'ANIMAIS', arquivo_nome: 'a.csv', texto: csv, formato } })).dados;
  const validar = (k) => s.exec((ctx) => G.ImportService.validarBloco(ctx, { idempotencyKey: 'rn094-v' + k, dados: { import_id: imp.import_id, bloco: 1, mapeamento: mapa } })).dados;
  const porLinha = () => Object.fromEntries(s.read(G.ImportService.consultaLinhas({ import_id: imp.import_id, por_pagina: 50 })).itens.map((l) => [l.linha_num, l]));
  let v = validar(1);
  assert.deepEqual([v.contadores.validas, v.contadores.erro], [1, 2]);
  assert.deepEqual([porLinha()[3].erros[0].codigo, porLinha()[4].erros[0].codigo], ['PAI_NAO_ENCONTRADO', 'PAI_NAO_ENCONTRADO']);
  // O dono segue a saída "cadastrar como animal de referência" e valida de novo.
  const touro = s.exec((ctx) => G.AnimalService.cadastrarExterno(ctx, { idempotencyKey: 'rn094-ext', dados: { campos: { nome: 'Touro Sêmen Nelore', sexo: 'M' } } })).dados;
  v = validar(2);
  assert.deepEqual([v.contadores.validas, v.contadores.erro], [2, 1], JSON.stringify(porLinha()[3].erros));
  assert.match(porLinha()[4].erros[0].mensagem, /A-000099 não está no arquivo nem no rebanho/);
  // Nome repetido entre animais de referência fica ambíguo: a linha pede o código interno.
  s.exec((ctx) => G.AnimalService.cadastrarExterno(ctx, { idempotencyKey: 'rn094-ext2', avisosAceitos: ['POSSIVEL_DUPLICIDADE'], dados: { campos: { nome: 'touro sêmen nelore', sexo: 'M' } } }));
  validar(3);
  assert.match(porLinha()[3].erros[0].mensagem, /mais de um animal de referência chamado "Touro Sêmen Nelore"\. Use o código interno/);
  const csv2 = ['Brinco;Sexo;Pai;Mãe;Pasto', '700;F;;;Pasto A', '701;M;' + touro.animal.codigo_interno + ';700;Pasto A'].join('\r\n');
  const imp2 = s.exec((ctx) => G.ImportService.criar(ctx, { idempotencyKey: 'rn094-2', avisosAceitos: [], dados: { tipo: 'ANIMAIS', arquivo_nome: 'b.csv', texto: csv2, formato } })).dados;
  const v2 = s.exec((ctx) => G.ImportService.validarBloco(ctx, { idempotencyKey: 'rn094-2v', dados: { import_id: imp2.import_id, bloco: 1, mapeamento: mapa } })).dados;
  assert.deepEqual([v2.contadores.validas, v2.contadores.erro], [2, 0]);
  s.exec((ctx) => G.ImportService.importarBloco(ctx, { dados: { import_id: imp2.import_id, bloco: 1, modo: 'TOTAL' } }));
  s.exec((ctx) => G.ImportService.concluir(ctx, { dados: { import_id: imp2.import_id } }));
  const filho = s.tabela('ANIMAIS').find((a) => a.brinco === '701');
  assert.deepEqual([filho.situacao_cadastral, filho.pai_id, filho.pai_confianca], ['ATIVO', touro.animal_id, 'ESTIMADA']);
  s.conferirProjecoes('importação com pai de referência');
});
