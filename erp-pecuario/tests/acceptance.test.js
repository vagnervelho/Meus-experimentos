'use strict';
/**
 * Aceitação (E1.12): roda no Node, sobre os fakes do harness, os MESMOS cenários que runAcceptanceTests roda na conta do
 * dono (09, seção 8: CT-09 de brinco e mãe, CT-10, CT-11, CT-12, CT-18 de entradas, CT-20 e o ensaio de restauração),
 * com a nota do "cenário que usa peça de fase posterior" (passos NAO_SE_APLICA). O lock disputado, que uma execução
 * real não consegue provocar sozinha, entra por `injetar`. Também: a base real não muda, o teste é retomável, falha de
 * cenário aparece no relatório, a base de demonstração (304 ativos, só por comandos) e o diagnóstico do spike.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');
const S = require('./apoio-sistema');
const FIXTURE = require('./fixtures/coercao.json');

const { js, USUARIO } = S;
const CENARIOS = ['PREPARO', 'CT-09', 'CT-10', 'CT-12', 'CT-18', 'RESTAURACAO', 'CT-20', 'CT-11', 'ISOLAMENTO'];
/** Passos que a Fase 1 não roda (peça de fase posterior ou só na conta do dono), com a situação esperada. */
const FORA = {
  'CT-09': { 1: 'NAO_SE_APLICA', 2: 'NAO_SE_APLICA', 10: 'NAO_SE_APLICA' },
  'CT-10': { 3: 'NAO_SE_APLICA', 6: 'PENDENTE_NA_CONTA_DO_DONO' },
  'CT-20': { 2: 'NAO_SE_APLICA' },
};

function injetar(gas) {
  return { ocuparLock: () => gas.lock.segurarPorOutra(), liberarLock: () => gas.lock.soltarOutra() };
}
function aceitar(s, opcoes) {
  return js(s.gas.exec(() => s.G.TestRunner.runAcceptanceTests(Object.assign({ usuario: USUARIO, injetar: injetar(s.gas) }, opcoes || {}))));
}
/** Retrato da base real: todas as abas + as Script Properties dela. */
function retratoProducao(s) {
  const io = () => s.G.Database.abrir(s.banco(), { primitiva: s.primitiva() });
  const abas = js(s.gas.exec(() => { const l = io().ler(s.G.Schema.nomesTabelas()); const o = {}; Object.keys(l).forEach((k) => { o[k] = l[k].registros; }); return o; }));
  const p = s.props();
  const b = s.banco();
  return { abas, props: [p.SPREADSHEET_ID, p.IO_PRIMITIVE, p.IO_PRIMITIVE_RELATORIO, p['DATA_VERSION:' + b], p['PENDING_OP:' + b] || null] };
}
function situacoes(rel) {
  return Object.fromEntries(rel.cenarios.map((c) => [c.id, c.situacao]));
}

test('aceitação da Fase 1 no fake: todos os cenários passam; só ficam de fora os passos de fase posterior; a base real não muda', () => {
  const s = S.sistema({ order: 'reverse' });
  s.evento('registrar', S.entradaInicial([S.bicho({ brinco: '1' }), S.bicho({ brinco: '2' })]), 'prod-1');
  const antes = retratoProducao(s);
  const rel = aceitar(s);
  const falhas = rel.cenarios.filter((c) => c.situacao !== 'PASSOU').map((c) => c.id + ': ' + c.falha + ' ' + JSON.stringify(c.passos.filter((p) => p.situacao === 'FALHOU')));
  assert.deepEqual(falhas, []);
  assert.deepEqual([rel.ok, rel.completo, rel.plano], [true, true, 'ACEITACAO']);
  assert.deepEqual(rel.cenarios.map((c) => c.id), CENARIOS);
  for (const c of rel.cenarios) {
    const fora = FORA[c.id] || {};
    for (const p of c.passos) assert.equal(p.situacao, fora[p.passo] || 'PASSOU', c.id + ' passo ' + p.passo + ': ' + p.detalhe);
    Object.keys(fora).forEach((n) => assert.ok(c.passos.some((p) => String(p.passo) === n), c.id + ' sem o passo ' + n));
  }
  assert.deepEqual(rel.resumo.cenarios, { PASSOU: CENARIOS.length, FALHOU: 0 });
  assert.deepEqual(rel.corpus.map((c) => [c.primitiva, c.ok]), [['SHEETS_TYPED', true], ['SHEETS_RAW', true], ['SPREADSHEET_APP', true]], 'no fake as três formas preservam o corpus');
  // Nunca tocou a base real (abas, versão, marcador, forma de gravação).
  assert.deepEqual(retratoProducao(s), antes);
  const p = s.props();
  assert.ok(p.TEST_SPREADSHEET_ID && p.TEST_SPREADSHEET_ID !== p.SPREADSHEET_ID);
  // Relatório na pasta Testes; cursor e resultados parciais apagados; arquivos temporários na lixeira.
  const arq = s.gas.drive.arquivo(rel.arquivo.id);
  assert.equal(arq.appProperties.erp_tipo, 'RELATORIO_TESTES');
  assert.deepEqual(JSON.parse(s.gas.drive.conteudo(rel.arquivo.id).toString('utf8')).resumo, rel.resumo);
  assert.equal(Object.keys(p).some((k) => /^TEST_(CURSOR|RESULTADO)/.test(k)), false);
  assert.ok(rel.limpeza.backups >= 3 && rel.limpeza.bancos === 1, JSON.stringify(rel.limpeza));
  const bancoTesteAtual = s.gas.drive.arquivo(p.TEST_SPREADSHEET_ID);
  assert.notEqual(bancoTesteAtual.trashed, true, 'a base de teste final fica para a página de concorrência');
  // A mesma execução por Code.js (guarda de dono), de novo: base de teste nova, a anterior na lixeira.
  const anterior = p.TEST_SPREADSHEET_ID;
  const rel2 = js(s.gas.exec(() => s.G.runAcceptanceTests()));
  assert.equal(rel2.ok, true, JSON.stringify(rel2.cenarios.filter((c) => c.situacao !== 'PASSOU')));
  assert.equal(rel2.cenarios.find((c) => c.id === 'CT-10').passos.find((x) => x.passo === '5').situacao, 'NAO_SE_APLICA', 'sem injeção (conta real), o lock disputado fica para a página de concorrência');
  assert.equal(s.gas.drive.arquivo(anterior).trashed, true);
  assert.notEqual(s.props().TEST_SPREADSHEET_ID, anterior);
  assert.deepEqual(retratoProducao(s), antes);
  s.gas.session.activeEmail = 'outro@gmail.com';
  assert.throws(() => s.gas.exec(() => s.G.runAcceptanceTests()), (e) => e.code === 'DENIED');
});

test('aceitação retomável: com o limite de tempo sempre estourado (relógio falso parado), para depois de cada cenário, guarda o cursor e continua na chamada seguinte', () => {
  const s = S.sistema({ semCadastro: true });
  const parciais = [];
  let rel = aceitar(s, { limiteMs: -1 });
  while (rel.completo === false) {
    parciais.push(rel.proximo);
    const cursor = JSON.parse(s.props().TEST_CURSOR);
    assert.equal(cursor.plano, 'ACEITACAO');
    assert.match(rel.mensagem, /Rode runAcceptanceTests de novo/);
    rel = aceitar(s, { limiteMs: -1 });
  }
  assert.deepEqual(parciais, CENARIOS.slice(1), 'uma chamada por cenário');
  assert.deepEqual([rel.ok, situacoes(rel)], [true, Object.fromEntries(CENARIOS.map((c) => [c, 'PASSOU']))]);
  assert.equal(s.props().TEST_CURSOR, undefined);
  // Ainda sem base real (setup de produção nunca rodou): a aceitação não cria uma.
  assert.equal(s.props().SPREADSHEET_ID, s.banco());
});

test('falha de cenário aparece no relatório (não é engolida) e não impede os demais; falha no preparo encerra a rodada', () => {
  const s = S.sistema();
  const status = s.G.UnitOfWork.status;
  s.G.UnitOfWork.status = (ctx, chave) => { const r = status(ctx, chave); if (/ct10-k1/.test(chave)) r.situacao = 'INEXISTENTE'; return r; };
  const rel = aceitar(s);
  assert.equal(rel.ok, false);
  const ct10 = rel.cenarios.find((c) => c.id === 'CT-10');
  assert.equal(ct10.situacao, 'FALHOU');
  assert.match(ct10.falha, /situação e operação/);
  assert.equal(ct10.passos.find((p) => p.passo === '4').situacao, 'FALHOU');
  assert.deepEqual(rel.cenarios.filter((c) => c.situacao === 'FALHOU').map((c) => c.id), ['CT-10'], 'os outros seguiram');
  assert.ok(s.gas.logs.some((l) => l[0] === 'error' && /aceitação CT-10/.test(String(l[1][0]))));
  // Preparo que falha: só ele no relatório.
  s.G.UnitOfWork.status = status;
  const setup = s.G.Maintenance.setup;
  s.G.Maintenance.setup = (o) => { if (o.ambiente === 'TESTE') throw s.G.Validation.erro('CONFIG', 'Drive recusou (teste).'); return setup(o); };
  const r2 = aceitar(s, { reiniciar: true });
  assert.deepEqual([r2.ok, r2.cenarios.map((c) => [c.id, c.situacao])], [false, [['PREPARO', 'FALHOU']]]);
  assert.match(r2.cenarios[0].falha, /Drive recusou/);
  assert.equal(r2.resumo.cenarios.FALHOU, 1);
});

test('base de demonstração (TEST_PLAN = DEMO): 304 ativos só por comandos, planilha DEMO com faixa BASE DE TESTE, idempotente e sem tocar a base real', () => {
  const s = S.sistema();
  const antes = retratoProducao(s);
  s.gas.props.script.setProperty('TEST_PLAN', 'DEMO');
  const rel = js(s.gas.exec(() => s.G.runAcceptanceTests()));
  assert.deepEqual([rel.plano, rel.completo, rel.ok, rel.demonstracao, rel.faixa], ['DEMO', true, true, { cabecas: 304, por_pasto: 6 }, 'BASE DE TESTE']);
  const demo = s.props().DEMO_SPREADSHEET_ID;
  assert.ok(demo && demo !== s.banco());
  assert.match(s.gas.drive.arquivo(demo).name, /BASE DE TESTE/);
  const boot = js(s.gas.exec(() => s.G.api({ rota: 'sistema.bootstrap', ambiente: 'DEMO', dados: {} })));
  assert.deepEqual([boot.data.ambiente.faixa, boot.data.animais.n, boot.data.pastos.length], ['BASE DE TESTE', 304, 6]);
  assert.equal(boot.data.pastos.filter((p) => p.posse === 'ARRENDADO').length, 1, 'um pasto arrendado');
  const eventos = s.tabela('EVENTOS', demo);
  assert.ok(eventos.every((e) => e.source === 'APP' && e.status !== 'FALHOU'), 'tudo pelos comandos do app');
  assert.equal(eventos.filter((e) => e.event_type === 'ESTORNO').length, 1);
  assert.ok(s.tabela('ANIMAIS', demo).filter((a) => a.mae_id).length >= 48, 'bezerros ao pé com a mãe');
  // Determinismo: rodar de novo não grava nada novo (mesmas chaves seed:<n>, mesmo conteúdo).
  const rel2 = js(s.gas.exec(() => s.G.runAcceptanceTests()));
  assert.deepEqual([rel2.ok, rel2.demonstracao.cabecas], [true, 304]);
  assert.equal(s.tabela('EVENTOS', demo).length, eventos.length);
  assert.deepEqual(retratoProducao(s), antes);
  // Mesmo sorteio a cada execução.
  const g1 = js(s.gas.exec(() => s.G.TestRunner.geracaoDemo('2023-11-14')));
  const gas2 = createGas({ order: 'reverse' });
  const g2 = js(gas2.exec(() => gas2.G.TestRunner.geracaoDemo('2023-11-14')));
  assert.deepEqual(g1, g2);
  assert.equal(g1.lotes.reduce((n, l) => n + l.length, 0), 240);
});

test('diagnóstico do spike (runDiagnostics): itens SP-01 a SP-10, coerção no formato do fixture, temporárias na lixeira, sem dado sensível', () => {
  const s = S.sistema();
  const rel = js(s.gas.exec(() => s.G.TestRunner.runDiagnostics({ usuario: USUARIO, linhas: 250 })));
  assert.equal(rel.ok, true, JSON.stringify(rel.itens.filter((i) => i.situacao === 'FALHOU')));
  assert.deepEqual(rel.itens.map((i) => i.id), ['SP-01', 'SP-02', 'SP-03', 'SP-04', 'SP-05', 'SP-06', 'SP-07', 'SP-08', 'SP-09', 'SP-10', 'RUNTIME']);
  const sp = Object.fromEntries(rel.itens.map((i) => [i.id, i]));
  assert.deepEqual(['SP-01', 'SP-02', 'SP-03', 'SP-04', 'SP-05', 'SP-09', 'RUNTIME'].map((k) => sp[k].situacao), ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK']);
  // O diagnóstico devolve a coerção "Geral" no MESMO formato do fixture do fake: no fake, os mesmos casos.
  const geral = sp['SP-01'].medidas.coercao_geral;
  assert.equal(geral.locale, 'pt_BR');
  const porEntrada = (l) => Object.fromEntries(l.map((c) => [c.entrada, c.geral]));
  assert.deepEqual(porEntrada(geral.casos), porEntrada(FIXTURE.casos));
  assert.equal(sp['SP-01'].medidas.atomicidade.atomico, true);
  assert.deepEqual([sp['SP-05'].medidas.linhas, sp['SP-05'].medidas.lidas], [250, 250]);
  assert.deepEqual(sp['SP-09'].medidas, { total: 2, funcoes: ['trgIntegridadeSemanal', 'trgManutencaoDiaria'] });
  // Sem dado sensível: nenhum e-mail nem ID de arquivo (o corpus é constante do código).
  const semCorpus = JSON.stringify(rel.itens.map((i) => Object.assign({}, i, { medidas: i.id === 'SP-01' ? null : i.medidas })));
  assert.doesNotMatch(semCorpus, /@gmail\.com|1Plan|1Arq|1Past/);
  assert.doesNotMatch(semCorpus, new RegExp(s.banco()));
  // Nada sobra fora da lixeira além do relatório; a base real não foi tocada.
  const lista = js(s.gas.exec(() => s.G.FileService.porta().listar('testes', {})));
  assert.deepEqual(lista.map((f) => f.appProperties.erp_tipo), ['DIAGNOSTICO'], 'só o relatório (as planilhas temporárias foram para a lixeira)');
  assert.match(lista[0].name, /diagnóstico .*\.json$/);
});
