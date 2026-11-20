'use strict';
/**
 * Repository (puro): predicado de vigência numa função só, vigentes por regra de tabela, leitura memoizada das
 * abas declaradas (com as dependências da vigência), índices em memória, contadores, órfãs, plano de escrita e
 * a separação entre a fachada pública (só vigentes) e o acesso cru.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, ORDENS } = require('./harness');
const { js } = require('./apoio-persistencia');

/** Porta de E/S em memória (sem planilha): devolve as linhas pelo codec real e conta as leituras. */
function ioMemoria(G, tabelas, alertas) {
  const D = G.Database;
  const col = (t, c) => G.Schema.coluna(t, c);
  const normalizarValor = (t, c, v) => D.decodificar(col(t, c), D.codificar(col(t, c), v), () => 'UTC').valor;
  const normalizar = (t, r) => {
    const out = {};
    G.Schema.colunas(t).forEach((c) => { out[c] = normalizarValor(t, c, r[c]); });
    return out;
  };
  const io = {
    leituras: [],
    ler(nomes) {
      io.leituras.push(nomes.slice());
      const out = {};
      nomes.forEach((t) => {
        const regs = (tabelas[t] || []).map((r) => normalizar(t, r));
        out[t] = { cabecalho: G.Schema.colunas(t), registros: regs, linhas: regs.map((_, i) => i + 2), ultimaLinha: regs.length + 1, alertas: (alertas && alertas[t]) || [] };
      });
      return out;
    },
    normalizarValor,
    normalizar,
  };
  return io;
}

const op = (op_id, status, aplicada) => ({ op_id, idempotency_key: 'k-' + op_id, payload_hash: 'h', comando: 'evento.registrar', status, aplicada_em: aplicada === undefined ? (status === 'CONFIRMADA' ? '2026-11-13T14:00:00.000Z' : null) : aplicada, usuario: 'dono', started_at: '2026-11-13T14:00:00.000Z' });
const ev = (event_id, op_id, extra) => Object.assign({ event_id, op_id, event_seq: 1, event_type: 'COMPRA', event_date: '2026-03-01', registration_date: '2026-03-01', property_id: 'prop', status: 'PENDENTE', created_by: 'dono', source: 'APP', pre_marco_zero: false, idempotency_key: 'k', created_at: '2026-03-01T12:00:00.000Z' }, extra || {});
const ea = (id, event_id, animal_id, efeito) => ({ event_animal_id: id, event_id, animal_id, papel: 'SUJEITO', efeito_inventario: efeito });

function abrir(G, tabelas, alertas) {
  const io = ioMemoria(G, tabelas, alertas);
  return { io, repo: G.Repository.abrir({ io }) };
}
function codigoDe(fn) {
  try {
    fn();
  } catch (e) {
    return e.code || e.name;
  }
  return null;
}

for (const order of ORDENS) {
  test('predicado de vigência: a tabela de 02, seção 5.3, avaliada numa função só (carga ' + order + ')', () => {
    const G = createGas({ order }).G;
    const ops = { C: op('C', 'CONFIRMADA'), I: op('I', 'INICIADA'), F: op('F', 'FALHOU') };
    const imps = { CANC: { import_id: 'CANC', status: 'CANCELADO' }, ANDA: { import_id: 'ANDA', status: 'IMPORTANDO' }, OK: { import_id: 'OK', status: 'IMPORTADO' } };
    const anuladores = {};
    const fontes = { operacao: (id) => ops[id] || null, importacao: (id) => imps[id] || null, anuladores: (id) => anuladores[id] || [] };
    const avaliar = (e) => js(G.Repository.avaliarEvento(e, fontes));
    assert.deepEqual(avaliar(ev('e1', 'X')), { status: 'FALHOU', vigente: false, anulador_id: null }, 'sem linha de operação');
    assert.equal(avaliar(ev('e2', 'F')).status, 'FALHOU');
    assert.equal(avaliar(ev('e3', 'I')).status, 'PENDENTE');
    assert.equal(avaliar(ev('e4', 'C', { import_id: 'CANC' })).status, 'CANCELADO');
    assert.equal(avaliar(ev('e5', 'C', { import_id: 'ANDA' })).status, 'PENDENTE');
    assert.equal(avaliar(ev('e5b', 'C', { import_id: 'SUMIU' })).status, 'PENDENTE', 'importação inexistente não vale');
    assert.deepEqual(avaliar(ev('e6', 'C', { import_id: 'OK' })), { status: 'CONFIRMADO', vigente: true, anulador_id: null });
    anuladores.e7 = [ev('x-falhou', 'F', { event_type: 'ESTORNO', event_seq: 2 }), ev('x-pend', 'I', { event_type: 'ESTORNO', event_seq: 3 })];
    assert.equal(avaliar(ev('e7', 'C')).status, 'CONFIRMADO', 'anulador sem commit não anula');
    anuladores.e7.push(ev('x-ok', 'C', { event_type: 'ESTORNO', event_seq: 9 }), ev('x-sub', 'C', { event_type: 'COMPRA', event_seq: 5 }));
    assert.deepEqual(avaliar(ev('e7', 'C')), { status: 'ESTORNADO', vigente: false, anulador_id: 'x-sub' }, 'vale o anulador confirmado de menor event_seq');
    assert.deepEqual(avaliar(ev('e8', 'C', { event_type: 'ESTORNO' })), { status: 'CONFIRMADO', vigente: false, anulador_id: null }, 'o ESTORNO nunca é vigente');
    assert.equal(avaliar(ev('e9', 'C', { pre_marco_zero: true })).vigente, true, 'histórico pré-marco zero é vigente (efeito 0)');
  });
}

test('vigência: o exemplo de 02, seção 5.1 — o estorno anula a compra sem linhas inversas', () => {
  const G = createGas().G;
  const linhas = [];
  for (let i = 0; i < 100; i++) linhas.push(ea('ini' + i, 'E0', 'a' + i, 1));
  for (let i = 0; i < 20; i++) linhas.push(ea('cmp' + i, 'E1', 'b' + i, 1));
  const tabelas = {
    OPERACOES: [op('o0', 'CONFIRMADA'), op('o1', 'CONFIRMADA')],
    EVENTOS: [ev('E0', 'o0', { event_type: 'ENTRADA_INICIAL' }), ev('E1', 'o1')],
    EVENTO_ANIMAIS: linhas,
  };
  let { repo } = abrir(G, tabelas);
  repo.carregar(['EVENTO_ANIMAIS']);
  const soma = (r) => r.vigentes('EVENTO_ANIMAIS').reduce((s, l) => s + l.efeito_inventario, 0);
  assert.equal(soma(repo), 120);
  tabelas.OPERACOES.push(op('o2', 'CONFIRMADA'));
  tabelas.EVENTOS.push(ev('E2', 'o2', { event_type: 'ESTORNO', event_seq: 2, reversal_of_event_id: 'E1' }));
  ({ repo } = abrir(G, tabelas));
  repo.carregar(['EVENTO_ANIMAIS']);
  assert.equal(soma(repo), 100);
  assert.equal(repo.eventoVigente('E1'), false);
  assert.equal(repo.eventoVigente('E2'), false);
  assert.deepEqual(js(repo.avaliar('E1')), { status: 'ESTORNADO', vigente: false, anulador_id: 'E2' });
  assert.equal(repo.avaliar('nao-existe'), null);
});

test('vigentes por regra de tabela: filhas, auditoria, animais, parcelas, rateio vigente, alocações e cadastros', () => {
  const G = createGas().G;
  const fin = (financial_id, event_id) => ({ financial_id, event_id, conta_id: 'c', natureza: 'CUSTEIO', tipo: 'DESPESA', categoria: 'CUSTO_OPERACIONAL', descricao: 'x', data_competencia: '2026-03-01', valor: 10000, retida_pelo_comprador: false, status: 'ATIVO', status_pagamento: 'ABERTO', created_at: '2026-03-01T12:00:00.000Z' });
  const parc = (parcela_id, financial_id, status) => ({ parcela_id, financial_id, parcela_num: 1, data_vencimento: '2026-04-01', valor: 10000, status, created_at: '2026-03-01T12:00:00.000Z' });
  const rat = (rateio_id, event_id, financial_id) => ({ rateio_id, event_id, financial_id, criterio: 'CABECAS', escopo_tipo: 'EVENTO', data_base: '2026-03-01', base_total: 2, total_alocado: 10000, created_by: 'dono', created_at: '2026-03-01T12:00:00.000Z' });
  const alo = (alloc_id, rateio_id) => ({ alloc_id, rateio_id, financial_id: 'F1', animal_id: 'a1', base_valor: 1, valor_alocado: 5000 });
  const tabelas = {
    OPERACOES: [op('ok', 'CONFIRMADA'), op('ok2', 'CONFIRMADA'), op('ok3', 'CONFIRMADA'), op('pend', 'INICIADA'), op('falhou', 'FALHOU')],
    EVENTOS: [ev('E1', 'ok', { event_seq: 1 }), ev('E2', 'pend', { event_seq: 2 }), ev('R1', 'ok2', { event_type: 'RATEIO', event_seq: 3 }), ev('R2', 'ok3', { event_type: 'RATEIO', event_seq: 4 }), ev('R3', 'pend', { event_type: 'RATEIO', event_seq: 5 })],
    EVENTO_ANIMAIS: [ea('l1', 'E1', 'a1', 1), ea('l2', 'E2', 'a2', 1), ea('l3', 'SEM-PAI', 'a3', 1)],
    AUDITORIA: [
      { audit_id: 'au1', op_id: 'ok', entidade: 'PASTOS', entity_id: 'p', acao: 'ALTERAR', campo: 'nome', usuario: 'd', timestamp: '2026-11-13T14:00:00.000Z' },
      { audit_id: 'au2', op_id: 'falhou', entidade: 'PASTOS', entity_id: 'p', acao: 'ALTERAR', campo: 'nome', usuario: 'd', timestamp: '2026-11-13T14:00:00.000Z' },
    ],
    ANIMAIS: ['PENDENTE', 'ATIVO', 'ANULADO', 'VENDIDO', 'EXTERNO', 'HISTORICO'].map((s, i) => ({ animal_id: 'a' + i, codigo_interno: 'A-00000' + i, situacao_cadastral: s, created_at: '2026-03-01T12:00:00.000Z', updated_at: '2026-03-01T12:00:00.000Z' })),
    FINANCEIRO: [fin('F1', 'E1'), fin('F2', 'E2')],
    PARCELAS: [parc('P1', 'F1', 'ABERTA'), parc('P2', 'F1', 'CANCELADA'), parc('P3', 'F2', 'ABERTA')],
    RATEIOS: [rat('RA1', 'R1', 'F1'), rat('RA2', 'R2', 'F1'), rat('RA3', 'R3', 'F1'), rat('RB', 'E2', 'F2')],
    ALOCACOES_FINANCEIRAS: [alo('X1', 'RA1'), alo('X2', 'RA2'), alo('X3', 'RA3')],
    PASTOS: [{ pasture_id: 'p', property_id: 'prop', nome: 'Rio', posse: 'PROPRIO', status: 'INATIVO', created_at: '2026-03-01T12:00:00.000Z', updated_at: '2026-03-01T12:00:00.000Z' }],
  };
  const { repo } = abrir(G, tabelas);
  repo.carregar(['EVENTO_ANIMAIS', 'AUDITORIA', 'ANIMAIS', 'PARCELAS', 'ALOCACOES_FINANCEIRAS', 'PASTOS']);
  const ids = (t) => js(repo.vigentes(t).map((r) => r[G.Schema.pk(t)]));
  assert.deepEqual(ids('EVENTOS'), ['E1', 'R1', 'R2']);
  assert.deepEqual(ids('EVENTO_ANIMAIS'), ['l1'], 'filha de evento pendente e filha sem pai não valem');
  assert.deepEqual(ids('AUDITORIA'), ['au1'], 'auditoria só de operação confirmada');
  assert.deepEqual(ids('ANIMAIS'), ['a1', 'a3', 'a4', 'a5'], 'animal PENDENTE ou ANULADO fica fora');
  assert.deepEqual(ids('FINANCEIRO'), ['F1']);
  assert.deepEqual(ids('PARCELAS'), ['P1'], 'parcela cancelada ou de lançamento que não vale fica fora');
  assert.deepEqual(ids('RATEIOS'), ['RA2'], 'vale o rateio do último evento vigente (re-rateio)');
  assert.deepEqual(ids('ALOCACOES_FINANCEIRAS'), ['X2']);
  assert.deepEqual(ids('PASTOS'), ['p'], 'cadastro vale pelo estado corrente');
  assert.equal(repo.cru('EVENTO_ANIMAIS').length, 3, 'o acesso cru vê as linhas inertes');
});

test('leitura memoizada: cada aba é lida uma vez, junto com as de que a vigência depende; aba não declarada é INTERNAL', () => {
  const G = createGas().G;
  assert.deepEqual(js(G.Repository.dependencias(['ALOCACOES_FINANCEIRAS'])), ['ALOCACOES_FINANCEIRAS', 'RATEIOS', 'FINANCEIRO', 'EVENTOS', 'OPERACOES', 'IMPORTACOES']);
  assert.deepEqual(js(G.Repository.dependencias(['PASTOS', 'AUDITORIA'])), ['PASTOS', 'AUDITORIA', 'OPERACOES']);
  assert.throws(() => G.Repository.dependencias(['NAO_EXISTE']));
  assert.equal(G.Repository.regra('PESAGENS'), 'FILHA');
  assert.equal(G.Repository.regra('CONFIGURACOES'), 'SEMPRE');
  const { io, repo } = abrir(G, { OPERACOES: [op('ok', 'CONFIRMADA')], EVENTOS: [ev('E1', 'ok')], PESAGENS: [] });
  repo.carregar(['PESAGENS']);
  repo.carregar(['PESAGENS', 'EVENTOS']);
  repo.vigentes('PESAGENS');
  repo.vigentes('PESAGENS');
  assert.deepEqual(js(io.leituras), [['PESAGENS', 'EVENTOS', 'OPERACOES', 'IMPORTACOES']], 'uma leitura, em lote');
  assert.equal(codigoDe(() => repo.vigentes('PASTOS')), 'INTERNAL');
  assert.equal(codigoDe(() => G.Repository.abrir({})), 'INTERNAL');
});

test('índices em memória: único, múltiplo e composto, só com linhas vigentes; o cru enxerga tudo', () => {
  const G = createGas().G;
  const animal = (id, brinco, mae, pasto, situacao) => ({ animal_id: id, codigo_interno: 'A-' + id, brinco, brinco_norm: brinco, mae_id: mae, pasto_atual_id: pasto, situacao_cadastral: situacao || 'ATIVO', created_at: '2026-03-01T12:00:00.000Z', updated_at: '2026-03-01T12:00:00.000Z' });
  const { repo } = abrir(G, {
    ANIMAIS: [animal('1', '12', null, 'P1'), animal('2', '13', '1', 'P1'), animal('3', '14', '1', 'P2'), animal('4', '12', '1', 'P1', 'ANULADO')],
  });
  repo.carregar(['ANIMAIS']);
  assert.equal(repo.porId('ANIMAIS', '2').brinco, '13');
  assert.equal(repo.porId('ANIMAIS', '4'), null, 'ANULADO não está no índice vigente');
  assert.equal(repo.cruPorId('ANIMAIS', '4').situacao_cadastral, 'ANULADO');
  assert.equal(repo.unico('ANIMAIS', 'brinco_norm', '12').animal_id, '1', 'brinco do anulado não ocupa o índice');
  assert.deepEqual(js(repo.por('ANIMAIS', 'mae_id', '1').map((a) => a.animal_id)), ['2', '3']);
  assert.deepEqual(js(repo.cruPor('ANIMAIS', 'mae_id', '1').map((a) => a.animal_id)), ['2', '3', '4']);
  assert.deepEqual(js(repo.por('ANIMAIS', ['pasto_atual_id', 'mae_id'], ['P1', '1']).map((a) => a.animal_id)), ['2']);
  assert.deepEqual(js(Object.keys(repo.agrupados('ANIMAIS', 'pasto_atual_id')).sort()), ['P1', 'P2']);
  assert.deepEqual(js(repo.por('ANIMAIS', 'mae_id', null)), [], 'chave vazia não indexa');
  assert.equal(repo.linhaDe('ANIMAIS', '3'), 4);
  const lista = repo.por('ANIMAIS', 'pasto_atual_id', 'P1');
  lista.pop();
  assert.equal(repo.por('ANIMAIS', 'pasto_atual_id', 'P1').length, 2, 'devolve cópia da lista do índice');
});

test('contadores (máximo + 1 sob lock) contam também as linhas inertes; órfãs e células coercidas', () => {
  const G = createGas().G;
  const { repo } = abrir(G, {
    OPERACOES: [op('a', 'CONFIRMADA'), op('b', 'INICIADA'), op('c', 'CONFIRMADA', null), op('d', 'FALHOU')],
    EVENTOS: [ev('E1', 'a', { event_seq: 7 }), ev('E2', 'b', { event_seq: 9 })],
    ANIMAIS: [{ animal_id: 'x', codigo_interno: 'A-000041', situacao_cadastral: 'PENDENTE', created_at: '2026-03-01T12:00:00.000Z', updated_at: '2026-03-01T12:00:00.000Z' }],
  }, { ANIMAIS: [{ tabela: 'ANIMAIS', linha: 2, coluna: 'codigo_interno', nivel: 'COERCIDA', codigo: 'X', mensagem: 'x' }] });
  repo.carregar(['EVENTOS', 'ANIMAIS']);
  assert.equal(repo.contador('EVENTOS', 'event_seq'), 10, 'o evento da operação pendente também conta');
  assert.equal(repo.contador('EVENTOS', 'event_seq'), 11);
  assert.equal(repo.contador('ANIMAIS', 'codigo_interno', (v) => Number(v.slice(2))), 42);
  assert.deepEqual(js(repo.operacoesOrfas().map((o) => o.op_id)), ['b', 'c']);
  assert.equal(repo.celulaCoercida('ANIMAIS', 2, 'codigo_interno'), true);
  assert.equal(repo.alertas().length, 1);
});

test('resolver, incluir e alterar: só o que muda vira escrita; a memória acompanha e os derivados são refeitos', () => {
  const G = createGas().G;
  const pasto = { pasture_id: 'p1', property_id: 'prop', nome: 'Rio', area_hectares: 38.5, posse: 'PROPRIO', status: 'ATIVO', created_at: '2026-03-01T12:00:00.000Z', updated_at: '2026-03-01T12:00:00.000Z' };
  const { repo } = abrir(G, { PASTOS: [pasto], OPERACOES: [op('ok', 'CONFIRMADA')], EVENTOS: [] }, { PASTOS: [{ tabela: 'PASTOS', linha: 2, coluna: 'status', nivel: 'COERCIDA', codigo: 'X', mensagem: 'x' }] });
  repo.carregar(['PASTOS', 'EVENTOS']);
  const escritas = js(repo.resolver([{ tabela: 'PASTOS', id: 'p1', campos: { nome: 'Rio', area_hectares: 40, status: 'ATIVO' } }]));
  assert.deepEqual(escritas, [{ tabela: 'PASTOS', id: 'p1', linha: 2, campos: { area_hectares: 40, status: 'ATIVO' } }], 'nome igual não regrava; célula coercida regrava');
  assert.deepEqual(js(repo.resolver([{ tabela: 'PASTOS', id: 'p1', campos: { nome: 'Rio' } }])), []);
  assert.equal(codigoDe(() => repo.resolver([{ tabela: 'PASTOS', id: 'nao', campos: { nome: 'x' } }])), 'INTERNAL');
  assert.equal(codigoDe(() => repo.resolver([{ tabela: 'PASTOS', id: 'p1', campos: { pasture_id: 'outro' } }])), 'INTERNAL');
  repo.alterar('PASTOS', 'p1', { area_hectares: 40, status: 'ATIVO' });
  assert.equal(repo.porId('PASTOS', 'p1').area_hectares, 40);
  assert.equal(repo.celulaCoercida('PASTOS', 2, 'status'), false, 'regravada, deixa de ser coercida');
  assert.equal(repo.vigentes('EVENTOS').length, 0);
  repo.incluir('EVENTOS', [ev('E9', 'ok')], 2);
  assert.deepEqual(js(repo.vigentes('EVENTOS').map((e) => e.event_id)), ['E9'], 'memo de vigentes refeito');
  assert.equal(repo.linhaDe('EVENTOS', 'E9'), 2);
  assert.equal(codigoDe(() => repo.incluir('EVENTOS', [ev('E10', 'ok')])), 'INTERNAL', 'sem a linha não há espelho');
});

test('fachada pública só tem leitura de vigentes; a crua lê tudo mas não altera a memória', () => {
  const G = createGas().G;
  const { repo } = abrir(G, { OPERACOES: [], EVENTOS: [] });
  const pub = repo.publico();
  for (const m of ['vigentes', 'porId', 'por', 'unico', 'agrupados', 'eventoVigente', 'contador', 'carregada']) assert.equal(typeof pub[m], 'function', m);
  for (const m of ['cru', 'cruPorId', 'resolver', 'incluir', 'alterar', 'carregar']) assert.equal(pub[m], undefined, m);
  const crua = repo.leituraCrua();
  for (const m of ['cru', 'cruPorId', 'cruPor', 'linhaDe', 'avaliar', 'operacoesOrfas', 'celulaCoercida', 'vigentes']) assert.equal(typeof crua[m], 'function', m);
  for (const m of ['resolver', 'incluir', 'alterar', 'carregar']) assert.equal(crua[m], undefined, m);
});

test('plano de escrita: linhas a anexar por aba, mudanças auditadas e atualizações de células', () => {
  const G = createGas().G;
  const p = G.Repository.plano();
  assert.equal(p.vazio(), true);
  p.anexar('EVENTOS', { event_id: 'e1' }).anexar('EVENTO_ANIMAIS', { event_animal_id: 'l1' }).anexar('EVENTO_ANIMAIS', { event_animal_id: 'l2' });
  p.auditar({ entidade: 'PASTOS', entity_id: 'p1', acao: 'ALTERAR', campo: 'nome', valor_novo: 'x' });
  p.atualizar('ANIMAIS', 'a1', { situacao_cadastral: 'ATIVO' });
  assert.deepEqual(js(p.contagem()), { EVENTOS: 1, EVENTO_ANIMAIS: 2 });
  assert.deepEqual(js(Object.keys(p.linhas())), ['EVENTOS', 'EVENTO_ANIMAIS']);
  assert.equal(p.mudancas().length, 1);
  assert.deepEqual(js(p.atualizacoes()), [{ tabela: 'ANIMAIS', id: 'a1', campos: { situacao_cadastral: 'ATIVO' } }]);
  assert.equal(p.vazio(), false);
  assert.throws(() => p.anexar('NAO_EXISTE', {}));
  assert.equal(codigoDe(() => p.anexar('EVENTOS', [])), 'INTERNAL');
  assert.equal(codigoDe(() => p.auditar(null)), 'INTERNAL');
  assert.equal(codigoDe(() => p.atualizar('ANIMAIS', '', { x: 1 })), 'INTERNAL');
});
