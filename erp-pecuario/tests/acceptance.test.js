'use strict';
/**
 * Aceitação (E1.12, Fase 2 e Fase 3): roda no Node, sobre os fakes do harness, os MESMOS cenários que runAcceptanceTests
 * roda na conta do dono (09, seção 8): CT-09 inteiro (saídas, brinco, mãe, pasto, data, reentrada), os da Fase 2 (CT-01,
 * CT-02, CT-03, CT-04, CT-07, CT-08, CT-13 na compra, CT-14, CT-17 e CT-18 com a compra), os da Fase 3 (CT-05, CT-06 e os
 * casos de 09, seção 4.1: SANIDADE — lote vencido, estoque insuficiente, carência na agenda e na venda, o exemplo de 05,
 * seção 4.7, e a aplicação única —, ESTOQUE — o exemplo de 03a, seção 4.7 — e REPRODUCAO — RN-060, 061, 064 e 066 e os
 * desfechos da estação), CT-10, CT-11, CT-12 com a
 * reconciliação, CT-20 e o ensaio de restauração, com a nota do "cenário que usa peça de fase posterior" (passos
 * NAO_SE_APLICA). O lock disputado, que uma execução real não consegue provocar sozinha, entra por `injetar`. Também: a
 * base real não muda, o teste é retomável, falha de cenário aparece no relatório (e uma conta errada do servidor faz o
 * cenário falhar), a base de demonstração (só por comandos, sem recusa) e o diagnóstico do spike. No fim da rodada,
 * projeção = reconstrução e as invariantes do financeiro na base de teste.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');
const S = require('./apoio-sistema');
const FIXTURE = require('./fixtures/coercao.json');

const { js, USUARIO } = S;
const CENARIOS = ['PREPARO', 'CT-09', 'CT-01', 'CT-02', 'CT-03', 'CT-04', 'CT-05', 'CT-06', 'SANIDADE', 'ESTOQUE', 'REPRODUCAO', 'CT-07', 'CT-08', 'CT-13', 'CT-14', 'CT-17', 'CT-18', 'CT-10', 'CT-12', 'RESTAURACAO', 'CT-20', 'CT-11', 'ISOLAMENTO'];
/**
 * Passos que ainda não rodam (peça de fase posterior ou só na conta do dono), com a situação esperada. O CT-09 roda
 * inteiro desde a venda e o CT-12 com a reconciliação (Fase 2); ficam o resultado gerencial (CT-03, Fase 4), o rateio
 * por evento RATEIO (CT-13 c a f, Fase 4) e o que só a conta do dono prova. A pesagem (Fase 3) roda: CT-05 inteiro, o passo 3
 * do CT-10, o dia da venda do CT-17 (b) e a massa do CT-18.
 */
const FORA = {
  'CT-03': { 4: 'NAO_SE_APLICA' },
  'CT-13': { c: 'NAO_SE_APLICA', d: 'NAO_SE_APLICA', e: 'NAO_SE_APLICA', f: 'NAO_SE_APLICA' },
  'CT-10': { 6: 'PENDENTE_NA_CONTA_DO_DONO' },
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

test('aceitação das Fases 1 a 3 no fake: todos os cenários passam; só ficam de fora os passos de fase posterior; a base real não muda; no fim, projeção = reconstrução na base de teste', () => {
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
  // Na base de teste que ficou: projeção gravada = reconstrução (Timeline.conferir) e as invariantes do financeiro.
  const ctxTeste = () => s.G.Api.contexto({ ambiente: 'TESTE', usuario: USUARIO });
  const conferencia = js(s.gas.exec(() => s.G.UnitOfWork.read(ctxTeste(), {
    rota: 'teste.projecoes', reads: s.G.FinancialService.leituras(), acessoCru: true, tratador: (tx) => ({ proj: s.G.Timeline.conferir(tx), fin: s.G.FinancialService.conferir(tx) }),
  }).dados));
  assert.deepEqual(conferencia, { proj: [], fin: [] });
  // Os cenários da Fase 2 gravaram de fato o que conferem: compras, vendas, partos, transferências, estornos e correções.
  const evTeste = js(s.gas.exec(() => { const p = s.props(); return s.G.Database.abrir(p.TEST_SPREADSHEET_ID, { primitiva: s.G.Maintenance.primitivaDoBanco(p, p.TEST_SPREADSHEET_ID) }).ler(['EVENTOS']).EVENTOS.registros; }));
  const tipos = new Set(evTeste.filter((e) => e.status === 'CONFIRMADO').map((e) => e.event_type));
  ['COMPRA', 'VENDA', 'NASCIMENTO', 'TRANSFERENCIA', 'MORTE', 'IDENTIFICACAO', 'ESTORNO', 'AJUSTE_INVENTARIO'].forEach((x) => assert.ok(tipos.has(x), 'evento ' + x + ' na base de teste'));
  // E os da Fase 3: pesagem, sanidade, estoque, reprodução, desmama, castração e ocorrência.
  ['PESAGEM', 'SANIDADE', 'ESTOQUE', 'REPRODUCAO', 'DESMAMA', 'CASTRACAO', 'OCORRENCIA'].forEach((x) => assert.ok(tipos.has(x), 'evento ' + x + ' na base de teste'));
  assert.ok(evTeste.some((e) => e.event_type === 'COMPRA' && e.reversal_of_event_id), 'a correção da compra (CT-18)');
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
  // Uma conta errada do servidor (uma cabeça a mais em cada pasto, em toda data) derruba os cenários que conferem o
  // inventário, com a conta no relatório.
  s.G.UnitOfWork.status = status;
  const posicaoEm = s.G.InventoryService.posicaoEm;
  s.G.InventoryService.posicaoEm = (ctx, d) => { const r = posicaoEm(ctx, d); (r.dados.por_pasto || []).forEach((x) => { x.cabecas += 1; }); return r; };
  const errado = aceitar(s, { reiniciar: true });
  s.G.InventoryService.posicaoEm = posicaoEm;
  const caidos = errado.cenarios.filter((c) => c.situacao === 'FALHOU').map((c) => c.id);
  ['CT-01', 'CT-02', 'CT-03', 'CT-04', 'CT-07', 'CT-08'].forEach((c) => assert.ok(caidos.includes(c), c + ' devia falhar com a conta errada; caíram ' + caidos));
  assert.match(errado.cenarios.find((c) => c.id === 'CT-08').falha, /D0\+30 \(100 \+ 2\) \(esperado \[102,62,40\]; obtido \[102,63,41\]\)/);
  // Preparo que falha: só ele no relatório.
  const setup = s.G.Maintenance.setup;
  s.G.Maintenance.setup = (o) => { if (o.ambiente === 'TESTE') throw s.G.Validation.erro('CONFIG', 'Drive recusou (teste).'); return setup(o); };
  const r2 = aceitar(s, { reiniciar: true });
  assert.deepEqual([r2.ok, r2.cenarios.map((c) => [c.id, c.situacao])], [false, [['PREPARO', 'FALHOU']]]);
  assert.match(r2.cenarios[0].falha, /Drive recusou/);
  assert.equal(r2.resumo.cenarios.FALHOU, 1);
});

test('base de demonstração (TEST_PLAN = DEMO): a composição de 09, seção 7 (240 + 255 − 240 … = 304 ativos) e os manejos da Fase 3 (pesagens, vacinações e vermifugações pelo protocolo, estações com diagnóstico, partos e desmama, castração, ocorrências), só por comandos e sem recusa, planilha DEMO com faixa BASE DE TESTE, idempotente e sem tocar a base real', () => {
  const s = S.sistema();
  const antes = retratoProducao(s);
  s.gas.props.script.setProperty('TEST_PLAN', 'DEMO');
  const rel = js(s.gas.exec(() => s.G.runAcceptanceTests()));
  assert.deepEqual([rel.plano, rel.completo, rel.ok, rel.faixa], ['DEMO', true, true, 'BASE DE TESTE'], JSON.stringify(rel).slice(0, 600));
  const d = rel.demonstracao;
  assert.deepEqual([d.cabecas, d.por_pasto, d.integridade], [304, 6, 'sem erro']);
  assert.deepEqual(d.totais, { d0: 240, nascimentos: 255, partos: d.totais.partos, natimortos: d.totais.natimortos, compras: 70, vendas: 240, mortes: 15, descartes: 5, divergencias: 1, ativos: 304 });
  assert.ok(d.totais.natimortos > 0 && d.totais.partos >= 250, 'partos com natimortos e gêmeos');
  assert.deepEqual(d.saidas, { VENDIDO: 240, MORTO: 15, DESCARTADO: 5, BAIXADO_AJUSTE: 1 }, 'as saídas conferidas no cadastro pelo servidor');
  assert.deepEqual(d.fora_desta_fase.map((x) => x.fase), [4, 4], 'o que da seção 7 chega na Fase 4 fica listado (os manejos sanitários entraram na E3.3; as estações de monta, na E3.4)');
  const demo = s.props().DEMO_SPREADSHEET_ID;
  assert.ok(demo && demo !== s.banco());
  assert.match(s.gas.drive.arquivo(demo).name, /BASE DE TESTE/);
  const boot = js(s.gas.exec(() => s.G.api({ rota: 'sistema.bootstrap', ambiente: 'DEMO', dados: {} })));
  assert.deepEqual([boot.data.ambiente.faixa, boot.data.animais.n, boot.data.pastos.length], ['BASE DE TESTE', 304, 6]);
  assert.equal(boot.data.pastos.filter((p) => p.posse === 'ARRENDADO').length, 1, 'um pasto arrendado');
  // Tudo pelos comandos do app, nenhum falhou; um comando por passo do plano.
  const eventos = s.tabela('EVENTOS', demo);
  assert.ok(eventos.every((e) => e.source === 'APP' && e.status !== 'FALHOU'), 'tudo pelos comandos do app');
  const vig = eventos.filter((e) => e.status === 'CONFIRMADO');
  const conta = (tipo) => vig.filter((e) => e.event_type === tipo).length;
  assert.deepEqual([conta('ENTRADA_INICIAL'), conta('COMPRA'), conta('NASCIMENTO'), conta('MORTE'), conta('DESCARTE'), conta('ESTORNO')], [6, 10, d.totais.partos, 15, 5, 2]);
  assert.ok(conta('VENDA') >= 20 && conta('IDENTIFICACAO') >= 10, 'vendas e identificações ao longo dos três anos');
  // Movimentos: a ida e a volta do pasto arrendado são transferências; a desmama leva os bezerros para a recria e para as
  // novilhas pelo pasto de destino da própria desmama (Fase 3, aceitação: antes eram transferências no dia da desmama).
  const linhasDe = (tipo) => { const ids = new Set(vig.filter((e) => e.event_type === tipo).map((e) => e.event_id)); return s.tabela('EVENTO_ANIMAIS', demo).filter((l) => ids.has(l.event_id)); };
  const desmamados = linhasDe('DESMAMA').filter((l) => l.papel === 'SUJEITO');
  assert.ok(conta('TRANSFERENCIA') >= 2 && conta('DESMAMA') >= 10, conta('TRANSFERENCIA') + ' transferências e ' + conta('DESMAMA') + ' desmamas');
  assert.ok(desmamados.length >= 200 && desmamados.filter((l) => l.pasto_destino_id && l.pasto_destino_id !== l.pasto_origem_id).length >= 100, desmamados.length + ' bezerros desmamados, os da recria e das novilhas com o movimento');
  assert.ok(s.tabela('PESAGENS', demo).filter((p) => p.tipo === 'DESMAMA' && vig.some((e) => e.event_id === p.event_id)).length >= 100, 'o peso à desmama dos que ficam');
  // Fase 3: as pesagens coletivas da recria, das novilhas e do pasto arrendado (a cada 120 dias), aceitas sem aviso.
  const pesagens = s.tabela('PESAGENS', demo).filter((x) => vig.some((e) => e.event_id === x.event_id && e.event_type === 'PESAGEM'));
  assert.ok(conta('PESAGEM') >= 20 && pesagens.length >= 1000, conta('PESAGEM') + ' pesagens com ' + pesagens.length + ' animais');
  assert.ok(pesagens.every((x) => x.tipo === 'ROTINA' && x.metodo === 'BALANCA'), 'pesagens de rotina, na balança');
  assert.ok(vig.filter((e) => e.event_type === 'PESAGEM').every((e) => !e.payload_json || !e.payload_json.avisos_aceitos), 'nenhum aviso aceito: o plano só pesa o plausível');
  assert.equal(eventos.filter((e) => e.reversal_of_event_id && e.event_type !== 'ESTORNO').length, 2, 'uma compra e uma venda corrigidas (substitutos)');
  // Fase 3, E3.4: três estações de monta, cada uma com a exposição das fêmeas aptas e os touros e o diagnóstico 150 dias
  // depois (positivo quando o plano tem o parto na janela); os indicadores de cada estação com taxa (n acima do mínimo).
  const estacoes = s.tabela('ESTACOES_MONTA', demo);
  assert.equal(estacoes.length, 3);
  const repro = vig.filter((e) => e.event_type === 'REPRODUCAO');
  assert.deepEqual(repro.map((e) => e.event_subtype).sort(), ['DIAGNOSTICO_GESTACAO', 'DIAGNOSTICO_GESTACAO', 'DIAGNOSTICO_GESTACAO', 'EXPOSICAO', 'EXPOSICAO', 'EXPOSICAO']);
  for (const est of estacoes) {
    const ind = js(s.gas.exec(() => s.G.api({ rota: 'reproducao.indicadores', ambiente: 'DEMO', dados: { estacao_id: est.estacao_id } })));
    assert.equal(ind.ok, true, JSON.stringify(ind.error));
    const g = ind.data.estacao.geral;
    assert.ok(g.expostas >= 100 && g.diagnosticadas > 0 && g.prenhez.valor !== null && g.prenhez.valor > 0, est.nome + ': ' + JSON.stringify([g.expostas, g.diagnosticadas, g.prenhez]));
  }
  // Fase 3, aceitação: os partos caem na janela da estação (09, seção 7: estações com diagnósticos, partos e desmama). Nas duas
  // estações encerradas, prenhez, parição, natalidade e desmama plausíveis; a última, com partos por vir, fica parcial.
  const taxas = [];
  for (const est of estacoes) {
    const g = js(s.gas.exec(() => s.G.api({ rota: 'reproducao.indicadores', ambiente: 'DEMO', dados: { estacao_id: est.estacao_id } }))).data.estacao.geral;
    taxas.push([g.prenhez.valor, g.paricao.valor, g.natalidade.valor, g.desmama.valor, g.paricao.parcial || null]);
  }
  taxas.slice(0, 2).forEach((x, i) => assert.ok(x[0] >= 70 && x[0] <= 98 && x[1] >= 70 && x[2] >= 65 && x[3] >= 60 && x[4] === null, 'estação ' + (i + 1) + ' encerrada: ' + JSON.stringify(x)));
  assert.ok(taxas[2][0] >= 70 && taxas[2][4] === 'parcial', 'a estação em curso: ' + JSON.stringify(taxas[2]));
  // O relatório da demonstração traz os mesmos números do servidor (a conferência final os leu pela api e os conferiu).
  assert.deepEqual(d.manejo.estacoes.map((e) => [e.prenhez, e.paricao, e.natalidade, e.desmama, e.parcial]), taxas, 'as taxas das estações no relatório');
  assert.deepEqual(d.manejo.estacoes.map((e) => e.nome), estacoes.map((e) => e.nome));
  // Sanidade pelo protocolo: toda vacinação com o semestral e toda vermifugação com o da recria; a agenda cobre os dois.
  const san = s.tabela('SANIDADE', demo).filter((x) => vig.some((e) => e.event_id === x.event_id));
  const protos = Object.fromEntries(s.tabela('PROTOCOLOS_SANITARIOS', demo).map((p) => [p.nome, p.protocol_id]));
  const doTipo = (proc) => san.filter((x) => x.tipo_procedimento === proc);
  assert.deepEqual(san.filter((x) => x.tipo_procedimento !== 'VACINA' && x.tipo_procedimento !== 'VERMIFUGO').length, 0, 'só vacinação e vermifugação');
  assert.ok(doTipo('VACINA').length > 1000 && doTipo('VACINA').every((x) => x.protocol_id === protos['Vacina semestral (demonstração)']), doTipo('VACINA').length + ' vacinações pelo protocolo semestral');
  assert.ok(doTipo('VERMIFUGO').length > 500 && doTipo('VERMIFUGO').every((x) => x.protocol_id === protos['Vermifugação da recria (demonstração)']), doTipo('VERMIFUGO').length + ' vermifugações pelo protocolo da recria');
  const agenda = js(s.gas.exec(() => s.G.api({ rota: 'sanidade.agenda', ambiente: 'DEMO', dados: {} }))).data;
  assert.ok(agenda.protocolos.length === 2 && agenda.protocolos.every((p) => p.cobertura.valor >= 80), 'cobertura dos protocolos: ' + JSON.stringify(agenda.protocolos.map((p) => [p.nome, p.cobertura.valor])));
  assert.deepEqual(d.manejo.protocolos, agenda.protocolos.map((p) => ({ nome: p.nome, elegiveis: p.elegiveis, em_dia: p.em_dia, cobertura: p.cobertura.valor })), 'a cobertura no relatório');
  // Pesagens periódicas com GMD plausível: o do rebanho e o de cada pasto entre 0,3 e 0,8 kg/dia; nenhum aviso aceito em lançamento nenhum.
  const desemp = js(s.gas.exec(() => s.G.api({ rota: 'peso.desempenho', ambiente: 'DEMO', dados: {} }))).data;
  assert.ok(desemp.geral.gmd.valor >= 0.3 && desemp.geral.gmd.valor <= 0.8 && desemp.geral.gmd.n >= 300, 'GMD do rebanho: ' + JSON.stringify(desemp.geral.gmd));
  assert.ok(desemp.por_pasto.every((p) => p.gmd.valor === null || (p.gmd.valor >= 0.3 && p.gmd.valor <= 0.8)), 'GMD por pasto: ' + JSON.stringify(desemp.por_pasto.map((p) => p.gmd.valor)));
  assert.deepEqual(d.manejo.gmd, { valor: desemp.geral.gmd.valor, n: desemp.geral.gmd.n }, 'o GMD no relatório');
  assert.deepEqual(vig.filter((e) => e.payload_json && e.payload_json.avisos_aceitos).map((e) => e.event_type), [], 'nenhum aviso aceito: o plano só lança o plausível');
  // Castração (os garrotes inteiros do marco zero, com a visita paga e rateada, e os machos desmamados da recria) e ocorrências.
  const castrados = linhasDe('CASTRACAO');
  assert.ok(conta('CASTRACAO') >= 2 && castrados.length >= 30, castrados.length + ' castrados');
  const visita = s.tabela('FINANCEIRO', demo).filter((f) => vig.some((e) => e.event_id === f.event_id && e.event_type === 'CASTRACAO'));
  assert.deepEqual(visita.map((f) => [f.natureza, f.valor]), [['CUSTEIO', 30000]], 'a visita do veterinário na castração dos garrotes');
  assert.ok(castrados.every((l) => s.tabela('ANIMAIS', demo).find((a) => a.animal_id === l.animal_id).castrado === true), 'castrados no cadastro');
  assert.deepEqual(vig.filter((e) => e.event_type === 'OCORRENCIA').map((e) => e.payload_json.tipo_ocorrencia || e.event_subtype).length, 5, 'cinco ocorrências do curral');
  assert.deepEqual(eventos.filter((e) => e.event_type === 'ESTORNO').map((e) => eventos.find((x) => x.event_id === e.reversal_of_event_id).event_type).sort(), ['OUTRA_ENTRADA', 'TRANSFERENCIA']);
  // Vendas nas três formas de preço, com as bases de peso; descarte com receita; baixa na contagem depois de não localizado.
  const vendas = s.tabela('VENDAS', demo).filter((v) => vig.some((e) => e.event_id === v.event_id));
  const formas = new Set(vendas.map((v) => v.modalidade + (v.base_peso ? '/' + v.base_peso : '')));
  ['CABECA/', 'KG_VIVO/VIVO', 'ARROBA/CARCACA', 'ARROBA/VIVO'].forEach((f) => assert.ok(formas.has(f.replace(/\/$/, '')) || formas.has(f), 'venda ' + f + ' em ' + [...formas]));
  assert.equal(vendas.reduce((n, v) => n + v.qtd_animais, 0), 240);
  assert.deepEqual(s.tabela('BAIXAS', demo).filter((b) => vig.some((e) => e.event_id === b.event_id)).map((b) => b.tipo).sort().filter((x, i, a) => a.indexOf(x) === i), ['DESCARTE', 'DIVERGENCIA_CONTAGEM', 'MORTE']);
  // Identificações: as crias recebem o brinco nas campanhas (e uma troca por perda); as últimas crias ficam sem brinco (pendência).
  const idents = s.tabela('IDENTIFICACOES', demo).filter((x) => vig.some((e) => e.event_id === x.event_id && e.event_type === 'IDENTIFICACAO'));
  assert.ok(idents.length >= 100, idents.length + ' brincos postos por identificação');
  assert.ok(vig.some((e) => e.event_type === 'IDENTIFICACAO' && e.event_subtype === 'SUBSTITUICAO'), 'uma troca de brinco');
  const animais = s.tabela('ANIMAIS', demo);
  assert.equal(animais.filter((a) => a.origem === 'NASCIDO').length, 255);
  assert.ok(animais.filter((a) => a.situacao_cadastral === 'ATIVO' && !a.brinco).length > 0, 'crias novas ainda sem brinco');
  // Financeiro do próprio evento (P11): o custo dos comprados é o custo total das compras vigentes (frete incluído).
  const compras = s.tabela('COMPRAS', demo).filter((c) => vig.some((e) => e.event_id === c.event_id));
  const comprados = animais.filter((a) => a.origem === 'COMPRADO');
  assert.equal(comprados.length, 70);
  assert.equal(comprados.reduce((t, a) => t + a.custo_aquisicao, 0), compras.reduce((t, c) => t + c.valor_total, 0), 'custo de aquisição = soma das alocações = custo total das compras');
  // Determinismo: rodar de novo não grava nada novo (mesmas chaves seed:<n>, mesmo conteúdo).
  const rel2 = js(s.gas.exec(() => s.G.runAcceptanceTests()));
  assert.deepEqual([rel2.ok, rel2.demonstracao.cabecas], [true, 304]);
  assert.equal(s.tabela('EVENTOS', demo).length, eventos.length);
  assert.deepEqual(retratoProducao(s), antes);
  // Mesmo sorteio a cada execução e nas duas ordens de carga.
  const g1 = js(s.gas.exec(() => s.G.TestRunner.geracaoDemo('2023-11-14')));
  const gas2 = createGas({ order: 'reverse' });
  const g2 = js(gas2.exec(() => gas2.G.TestRunner.geracaoDemo('2023-11-14')));
  assert.deepEqual(g1, g2);
  assert.equal(g1.lotes.reduce((n, l) => n + l.length, 0), 240);
  assert.equal(g1.comandos.length + 1, rel.demonstracao.comandos + 1, 'um passo por comando, mais a conferência');
});

test('base de demonstração retomável: comando recusado para o seed (cursor no passo); corrigida a causa, continua dali numa execução nova, achando pela base os animais já gravados (a cria pela mãe e pelo nascimento); a conferência final derruba um número da Fase 3 fora da faixa do plano', () => {
  const s = S.sistema({ semCadastro: true });
  s.gas.props.script.setProperty('TEST_PLAN', 'DEMO');
  // A primeira campanha de identificação das crias é recusada (o motor fica sem aceitar IDENTIFICACAO por um tempo).
  const gen = js(s.gas.exec(() => s.G.TestRunner.geracaoDemo(s.G.Utils.somaDias('2026-11-13', -1095))));
  const n = gen.comandos.findIndex((c) => /^identificacao-/.test(c.nome));
  assert.ok(n > 20 && gen.comandos[n].dados.animais.length > 1, 'a campanha cita crias nascidas antes (sem brinco)');
  const registrar = s.G.EventService.registrar;
  let recusar = true;
  s.G.EventService.registrar = (ctx, pedido) => {
    if (recusar && pedido.idempotencyKey === 'seed:' + n) throw s.G.Validation.erro('VALIDATION', 'Recusa de teste.');
    return registrar(ctx, pedido);
  };
  const parou = js(s.gas.exec(() => s.G.runAcceptanceTests()));
  assert.deepEqual([parou.completo, parou.ok, parou.proximo], [false, false, gen.comandos[n].nome]);
  assert.match(parou.falha, /Recusa de teste/);
  const cursor = JSON.parse(s.props().TEST_CURSOR);
  assert.deepEqual([cursor.plano, cursor.proximo, cursor.estado.d0], ['DEMO', n + 1, gen.d0], 'o cursor fica no passo recusado');
  // Corrigida a causa, cada chamada (pausa pelo tempo a cada passo) retoma sem a memória da anterior: a campanha acha
  // as crias pela mãe e pelo nascimento, na base.
  recusar = false;
  for (let i = 0; i < 3; i++) {
    const r = js(s.gas.exec(() => s.G.TestRunner.runAcceptanceTests({ usuario: USUARIO, limiteMs: -1 })));
    assert.deepEqual([r.completo, r.proximo], [false, gen.comandos[n + 1 + i].nome]);
  }
  const ident = s.tabela('IDENTIFICACOES', s.props().DEMO_SPREADSHEET_ID).filter((x) => gen.comandos[n].dados.animais.some((a) => a.codigo === x.codigo));
  assert.equal(ident.length, gen.comandos[n].dados.animais.length, 'a campanha retomada gravou o brinco de cada cria');
  // A conferência final lê os números da Fase 3 do servidor e os confere com a faixa do plano: um GMD absurdo (a conta do
  // servidor errada) derruba a demonstração no passo da conferência, que a execução seguinte refaz.
  const desempenho = s.G.WeightService.desempenho;
  s.G.WeightService.desempenho = (ctx, f) => { const r = desempenho(ctx, f); r.dados.geral.gmd.valor = 7; return r; };
  const errada = js(s.gas.exec(() => s.G.runAcceptanceTests()));
  assert.deepEqual([errada.completo, errada.ok, errada.proximo], [false, false, 'conferir']);
  assert.match(errada.falha, /GMD do rebanho fora da faixa do plano/);
  s.G.WeightService.desempenho = desempenho;
  const fim = js(s.gas.exec(() => s.G.runAcceptanceTests()));
  assert.deepEqual([fim.ok, fim.demonstracao.cabecas, fim.demonstracao.saidas.VENDIDO], [true, 304, 240]);
  assert.ok(fim.demonstracao.manejo.gmd.valor >= 0.3 && fim.demonstracao.manejo.gmd.valor <= 0.8 && fim.demonstracao.manejo.estacoes.length === 3, JSON.stringify(fim.demonstracao.manejo));
  assert.equal(s.props().TEST_CURSOR, undefined);
  const opsDemo = s.tabela('OPERACOES', s.props().DEMO_SPREADSHEET_ID).filter((o) => /^seed:\d+$/.test(o.idempotency_key));
  assert.equal(opsDemo.length, gen.comandos.length, 'cada comando do plano gravado uma vez');
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
