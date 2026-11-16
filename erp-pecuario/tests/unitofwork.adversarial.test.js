'use strict';
/**
 * Ataque à persistência (Database, Repository, UnitOfWork): testes que tentam quebrar o protocolo de 06.
 *
 * - Varredura exaustiva: a execução morre DEPOIS de cada escrita individual (cada chamada de serviço que escreve, e
 *   cada chamada de porta: marcador, flush, versão, lock) de um comando de evento que grava em várias abas, dos
 *   comandos-modelo da Fase 2 (venda do CT-04, correção de compra do CT-18, estorno de transferência do CT-07) e de
 *   comandos sem evento (criação e edição de cadastro); em cada ponto, chegam nenhuma, todas, cada prefixo e
 *   subconjuntos aleatórios (semente fixa) das escritas pendentes. Depois da recuperação valem os invariantes:
 *   (1) tudo ou nada; (2) projeções = reconstrução pelos eventos vigentes; (3) nenhuma linha vigente órfã;
 *   (4) nenhuma operação órfã; (5) marcador removido; (6) reenvio com a mesma chave não duplica e devolve o mesmo
 *   resultado; (7) recuperação morta no meio e repetida chega ao mesmo estado.
 * - Intercalações em cada ponto de troca que o lock do fake permite; leitor concorrente nunca vê estado parcial;
 *   dois bancos no mesmo projeto; exceção tratável em cada escrita; estado da operação com a original morta ou viva.
 * - Corpus de tipos com valores hostis nas três primitivas; células hostis digitadas pelo dono; valores hostis pelo
 *   caminho inteiro (AUDITORIA como registro de refazer e chave de idempotência).
 * - Nos comandos-modelo da Fase 2, depois de cada queda e recuperação, também os oráculos independentes de
 *   apoio-oraculos.js (invariantes de 03b, seção 14, sobre as linhas cruas; inventário por replay sem Timeline) e, nos
 *   pontos de buffer cheio (antes de cada flush, na primitiva SpreadsheetApp), subconjuntos densos das pendentes
 *   (todos até 5 escritas; acima, 24 sorteados com semente fixa e densidades de chegada de 10%, 50% e 90%: 09, seção 5).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio-persistencia');

const { js, ambiente, cmdEvento, cmdPasto, consultaVigentes, rodarInstrumentado, recuperarInstrumentado } = A;
const { sementes } = require('./apoio-eventos');
const O = require('./apoio-oraculos');
const PRIMITIVAS = ['SHEETS_TYPED', 'SHEETS_RAW', 'SPREADSHEET_APP'];
const ABAS = ['OPERACOES', 'EVENTOS', 'EVENTO_ANIMAIS', 'ANIMAIS', 'PASTOS', 'AUDITORIA', 'ERROS_LOG', 'IMPORTACOES'];

// ------------------------------------------------------------------ apoio ----
function erroDe(r) {
  return r.ok ? null : r.erro && r.erro.code ? r.erro.code : 'EXCECAO';
}
/** Registros DURÁVEIS das abas do protocolo, lidos por uma porta nova numa execução própria. */
function estado(amb) {
  const lido = amb.lido(ABAS);
  const e = {};
  ABAS.forEach((a) => { e[a] = lido[a].registros; });
  return e;
}
/** Status que o predicado de vigência dá a cada evento do retrato (a reconstrução, sem passar pela UnitOfWork). */
function avaliacoes(G, e) {
  const fontes = {
    operacao: (id) => e.OPERACOES.find((o) => o.op_id === id) || null,
    importacao: (id) => e.IMPORTACOES.find((i) => i.import_id === id) || null,
    anuladores: (id) => e.EVENTOS.filter((x) => x.reversal_of_event_id === id),
  };
  const out = {};
  e.EVENTOS.forEach((ev) => { out[ev.event_id] = js(G.Repository.avaliarEvento(ev, fontes)); });
  return out;
}
/** Partes do estado que não dependem do relógio nem da trilha: serve para comparar dois desfechos. */
function essencia(e) {
  return {
    operacoes: e.OPERACOES.map((o) => [o.op_id, o.idempotency_key, o.status, !!o.aplicada_em, !!o.finished_at, !!o.erro]),
    eventos: e.EVENTOS.map((x) => [x.event_id, x.status, x.event_seq, !!x.confirmed_at]),
    filhas: e.EVENTO_ANIMAIS.map((l) => [l.event_animal_id, l.event_id, l.animal_id]),
    animais: e.ANIMAIS.map((a) => [a.animal_id, a.codigo_interno, a.situacao_cadastral]),
    pastos: e.PASTOS.map((p) => [p.pasture_id, p.nome, p.area_hectares, p.observacoes, p.status]),
  };
}

/** Invariantes (2) a (5) e a completude das linhas de OPERACOES, sobre o estado DURÁVEL. */
function conferirInvariantes(amb, msg) {
  const G = amb.G;
  const e = estado(amb);
  assert.equal(amb.marcador(), null, msg + ': (5) marcador removido');
  const ops = e.OPERACOES;
  const opDe = (id) => ops.find((o) => o.op_id === id) || null;
  const confirmada = (id) => { const o = opDe(id); return !!o && o.status === 'CONFIRMADA'; };
  for (const op of ops) {
    assert.ok(op.status === 'FALHOU' || (op.status === 'CONFIRMADA' && op.aplicada_em), msg + ': (4) operação órfã ' + op.status + ' ' + op.op_id);
    assert.ok(op.finished_at, msg + ': operação ' + op.status + ' terminada sem finished_at');
    if (op.status === 'FALHOU') assert.ok(op.erro, msg + ': operação FALHOU sem o motivo em OPERACOES.erro');
  }
  const porChave = {};
  ops.filter((o) => o.status === 'CONFIRMADA').forEach((o) => { porChave[o.idempotency_key] = (porChave[o.idempotency_key] || 0) + 1; });
  Object.keys(porChave).forEach((k) => assert.equal(porChave[k], 1, msg + ': no máximo uma operação confirmada por chave (' + k + ')'));
  for (const aba of ABAS) {
    const pk = G.Schema.pk(aba);
    const ids = e[aba].map((r) => r[pk]);
    assert.equal(new Set(ids).size, ids.length, msg + ': chave primária repetida em ' + aba);
  }
  // (2) cache EVENTOS.status = predicado de vigência; projeção de ANIMAIS = reconstrução pelos eventos vigentes.
  const av = avaliacoes(G, e);
  for (const ev of e.EVENTOS) {
    assert.equal(ev.status, av[ev.event_id].status, msg + ': (2) EVENTOS.status do evento ' + ev.event_id);
    assert.equal(!!ev.confirmed_at, ev.status === 'CONFIRMADO' || ev.status === 'ESTORNADO', msg + ': (2) confirmed_at do evento ' + ev.event_id);
  }
  const filhasVigentes = e.EVENTO_ANIMAIS.filter((l) => !l.event_id || (av[l.event_id] && av[l.event_id].vigente));
  // Situação pela soma dos efeitos vigentes: dentro (≥ 1) → ATIVO; com a saída vigente → a situação da saída; sem entrada →
  // ANULADO, salvo o animal de um lote de importação já confirmado com a importação ainda em andamento: PENDENTE até
  // concluir ou desfazer (o evento dele está PENDENTE pelo predicado de vigência, não FALHOU).
  const SAIDA = { VENDA: 'VENDIDO', MORTE: 'MORTO', DESCARTE: 'DESCARTADO' };
  for (const a of e.ANIMAIS) {
    const ls = filhasVigentes.filter((l) => l.animal_id === a.animal_id);
    const entrada = ls.some((l) => l.efeito_inventario === 1);
    const soma = ls.reduce((t, l) => t + (l.efeito_inventario || 0), 0);
    const saida = ls.find((l) => l.efeito_inventario === -1);
    const tipoSaida = saida ? (e.EVENTOS.find((x) => x.event_id === saida.event_id) || {}).event_type : null;
    const pendente = e.EVENTO_ANIMAIS.some((l) => {
      const ev = e.EVENTOS.find((x) => x.event_id === l.event_id);
      return l.animal_id === a.animal_id && !!ev && !!ev.import_id && av[ev.event_id].status === 'PENDENTE' && confirmada(ev.op_id);
    });
    const esperado = !entrada ? (pendente ? 'PENDENTE' : 'ANULADO') : soma >= 1 ? 'ATIVO' : SAIDA[tipoSaida];
    assert.equal(a.situacao_cadastral, esperado, msg + ': (2) projeção do animal ' + a.codigo_interno);
  }
  // (3) nenhuma linha vigente órfã: filha vigente aponta para evento de operação confirmada e para animal existente;
  // cadastro só existe se uma operação CONFIRMADA o criou, e cada campo auditado tem o último valor confirmado.
  for (const l of filhasVigentes) {
    const ev = e.EVENTOS.find((x) => x.event_id === l.event_id);
    assert.ok(ev && confirmada(ev.op_id), msg + ': (3) filha vigente sem evento confirmado');
    assert.ok(e.ANIMAIS.some((a) => a.animal_id === l.animal_id), msg + ': (3) filha vigente aponta para animal inexistente');
  }
  for (const p of e.PASTOS) {
    const trilha = e.AUDITORIA.filter((l) => l.entidade === 'PASTOS' && l.entity_id === p.pasture_id && confirmada(l.op_id));
    assert.ok(trilha.some((l) => l.acao === 'CRIAR'), msg + ': (3) pasto sem criação confirmada ' + p.nome);
    const ultimo = {};
    trilha.filter((l) => l.acao === 'CRIAR' || l.acao === 'ALTERAR').forEach((l) => { ultimo[l.campo] = l.valor_novo; });
    for (const campo of Object.keys(ultimo)) {
      if (campo === 'pasture_id') continue;
      assert.deepEqual(js(p[campo]), js(G.Database.deTexto(G.Schema.coluna('PASTOS', campo), ultimo[campo])), msg + ': (3) PASTOS.' + campo + ' = último valor confirmado');
    }
  }
  return e;
}

/** Tudo ou nada (1) do comando de evento de exemplo (2 animais). */
function desfechoEvento(amb, e, chave, confirmado, msg) {
  const av = avaliacoes(amb.G, e);
  const op = e.OPERACOES.find((o) => o.idempotency_key === chave && o.status === 'CONFIRMADA');
  assert.equal(!!op, confirmado, msg + ': (1) a operação vale exatamente quando o commit chegou');
  const daChave = e.EVENTOS.filter((x) => x.idempotency_key === chave && av[x.event_id].vigente);
  if (!confirmado) {
    assert.deepEqual(daChave, [], msg + ': (1) nada do evento vale');
    const ids = e.EVENTOS.filter((x) => x.idempotency_key === chave).map((x) => x.event_id);
    const animais = e.EVENTO_ANIMAIS.filter((l) => ids.includes(l.event_id)).map((l) => l.animal_id);
    assert.ok(e.ANIMAIS.filter((a) => animais.includes(a.animal_id)).every((a) => a.situacao_cadastral === 'ANULADO'), msg + ': (1) animal da operação falhada fica ANULADO');
    return null;
  }
  assert.deepEqual(daChave.map((x) => x.event_id), [op.resumo_json.event_id], msg + ': (1) um evento vigente, o do resumo');
  const filhas = e.EVENTO_ANIMAIS.filter((l) => l.event_id === op.resumo_json.event_id);
  assert.equal(filhas.length, 2, msg + ': (1) com as duas filhas');
  assert.deepEqual(e.ANIMAIS.filter((a) => filhas.some((l) => l.animal_id === a.animal_id)).map((a) => a.situacao_cadastral), ['ATIVO', 'ATIVO'], msg + ': (1) os dois animais ATIVOS');
  return { event_id: op.resumo_json.event_id, vigente: true };
}

// ------------------------------------------------------------------ cenários ----
const NOVOS = { nome: 'Rio de Baixo', area_hectares: 40, observacoes: 'Beira do córrego\nsem cerca' };
const DATA_MOTOR = '2026-11-10';
/** Desfecho do comando REAL do motor (OUTRA_ENTRADA de 2 animais pelo EventService, projetor real na fase C). */
function desfechoMotor(amb, e, confirmado, msg, pasto) {
  const G = amb.G;
  const dif = amb.read({ rota: 'teste.projecoes', reads: G.Timeline.LEITURAS, acessoCru: true, tratador: (tx) => G.Timeline.conferir(tx) }).dados;
  assert.deepEqual(dif, [], msg + ': (2) projeção do motor = reconstrução pelos eventos vigentes');
  const op = e.OPERACOES.find((o) => o.idempotency_key === 'k-motor' && o.status === 'CONFIRMADA');
  assert.equal(!!op, confirmado, msg + ': (1) a operação vale exatamente quando o commit chegou');
  const evs = e.EVENTOS.filter((x) => x.idempotency_key === 'k-motor').map((x) => x.event_id);
  const animaisDe = (ids) => e.EVENTO_ANIMAIS.filter((l) => ids.includes(l.event_id)).map((l) => e.ANIMAIS.find((a) => a.animal_id === l.animal_id));
  if (!confirmado) {
    assert.ok(animaisDe(evs).filter(Boolean).every((a) => a.situacao_cadastral === 'ANULADO'), msg + ': (1) animal da operação falhada fica ANULADO');
    return null;
  }
  const evId = op.resumo_json.event_id;
  const animais = animaisDe([evId]);
  assert.deepEqual(animais.map((a) => [a.situacao_cadastral, a.pasto_atual_id, a.data_entrada]), [['ATIVO', pasto, DATA_MOTOR], ['ATIVO', pasto, DATA_MOTOR]], msg + ': (1) os dois animais ATIVOS no pasto');
  return {
    acao: 'registrar', event_id: evId, event_type: 'OUTRA_ENTRADA', event_subtype: null, event_date: DATA_MOTOR, status: 'CONFIRMADO',
    total_value: null, substitui: null, estorna: null,
    animais: animais.map((a) => ({ animal_id: a.animal_id, codigo_interno: a.codigo_interno, brinco: a.brinco || null, sexo: a.sexo, situacao_cadastral: a.situacao_cadastral, pasto_atual_id: a.pasto_atual_id })),
  };
}
// Correção de compra (09, seção 8: modelo da Fase 2): 3 garrotes por cabeça, 2 parcelas e frete; a correção troca o
// brinco de um animal e o frete de R$ 30,00 por R$ 300,00 (04, 5.2 iv), com os mesmos animal_id.
const DATA_COMPRA = '2026-11-05';
const FORNECEDOR = 'ffffffff-0000-4000-8000-00000000f0f0';
function dadosCompra(pasto, brincos, frete, extra) {
  return Object.assign({
    tipo: 'COMPRA', campos: { event_date: DATA_COMPRA, partner_id: FORNECEDOR, pasto_destino_id: pasto, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 900000 },
    animais: brincos.map((b) => ({ brinco: b, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 })),
    parcelas: [{ data_vencimento: '2026-12-05', valor: 450000 }, { data_vencimento: '2027-01-05', valor: 450000 }], custos: [{ tipo: 'FRETE', valor: frete }],
  }, extra || {});
}
function prepararCompra(amb) {
  const G = amb.G;
  const s = sementes(G);
  const parceiro = { partner_id: FORNECEDOR, nome: 'Fornecedor do lote', tipos: 'FORNECEDOR', ativo: true, created_at: '2026-11-01T12:00:00.000Z', updated_at: '2026-11-01T12:00:00.000Z' };
  amb.gas.exec(() => G.Database.abrir(amb.banco, { primitiva: amb.primitiva }).anexar({ CONFIGURACOES: s.CONFIGURACOES, PROPRIEDADES: s.PROPRIEDADES, PLANO_CONTAS: s.PLANO_CONTAS, LISTAS: s.LISTAS, CATEGORIAS: s.CATEGORIAS, PARCEIROS: [parceiro] }));
  const pasto = amb.run(cmdPasto(G, { chave: 'cria-retiro-compra', dados: { campos: { nome: 'Retiro' } } })).dados.pasture_id;
  const r = amb.run(G.EventService.comando('registrar', { idempotencyKey: 'prep-compra', dados: dadosCompra(pasto, ['0801', '0802', '0803'], 3000) }));
  amb.gas.clock.now += 60000;
  return { pasto, eventId: r.dados.event_id, ids: r.dados.animais.map((a) => a.animal_id) };
}
/**
 * Oráculos independentes (apoio-oraculos.js) depois da recuperação: invariantes de 03b, seção 14, sobre as linhas cruas
 * e o inventário por replay (sem Timeline) = Timeline.inventario nas datas dadas.
 */
function oraculosIndependentes(amb, msg, datas) {
  const G = amb.G;
  const r = O.cru(amb);
  assert.deepEqual(O.invariantesCruas(r), [], msg + ': invariantes de 03b, seção 14, sobre as linhas cruas');
  const R = O.replayCru(r);
  const sis = amb.read({ rota: 'teste.inventario', reads: G.Timeline.LEITURAS, acessoCru: true, tratador: (tx) => {
    const todas = G.Timeline.fonte(tx).todasAsLinhas();
    return datas.map((D) => G.Timeline.inventario(todas, D, '2026-01-01'));
  } }).dados;
  datas.forEach((D, i) => assert.deepEqual({ total: sis[i].total, porPasto: sis[i].porPasto, semPasto: sis[i].semPasto }, O.inventarioDe(R.linhas, D), msg + ': inventário em ' + D + ' (replay independente)'));
}
function desfechoCorrecaoCompra(amb, e, confirmado, msg, prep) {
  const G = amb.G;
  oraculosIndependentes(amb, msg, ['2026-11-04', DATA_COMPRA, '2026-11-13']);
  const r = amb.read({ rota: 'teste.compra', reads: G.FinancialService.leituras(), acessoCru: true, tratador: (tx) => ({
    proj: G.Timeline.conferir(tx), fin: G.FinancialService.conferir(tx),
    animais: prep.ids.map((id) => tx.cru.cruPorId('ANIMAIS', id)), original: tx.cru.avaliar(prep.eventId).status,
    ativos: tx.repo.vigentes('FINANCEIRO').map((f) => f.valor).sort((a, b) => a - b),
  }) }).dados;
  assert.deepEqual(r.proj, [], msg + ': (2) projeção = reconstrução');
  assert.deepEqual(r.fin, [], msg + ': (2) invariantes financeiras (03b, 14)');
  const op = e.OPERACOES.find((o) => o.idempotency_key === 'k-corr-compra' && o.status === 'CONFIRMADA');
  assert.equal(!!op, confirmado, msg + ': (1) a correção vale exatamente quando o commit chegou');
  assert.ok(r.animais.every((a) => a.situacao_cadastral === 'ATIVO'), msg + ': (1) os três seguem ATIVOS (mesmos animal_id)');
  if (!confirmado) {
    assert.deepEqual([r.original, r.animais.map((a) => [a.brinco, a.custo_aquisicao]), r.ativos], ['CONFIRMADO', [['0801', 301000], ['0802', 301000], ['0803', 301000]], [3000, 900000]], msg + ': (1) tudo como antes');
    return null;
  }
  assert.deepEqual([r.original, r.animais.map((a) => [a.brinco, a.custo_aquisicao, a.evento_origem_id]), r.ativos],
    ['ESTORNADO', [['0801', 310000, op.resumo_json.event_id], ['0812', 310000, op.resumo_json.event_id], ['0803', 310000, op.resumo_json.event_id]], [30000, 900000]], msg + ': (1) a correção inteira');
  return {
    acao: 'corrigir', event_id: op.resumo_json.event_id, event_type: 'COMPRA', event_subtype: null, event_date: DATA_COMPRA, status: 'CONFIRMADO',
    total_value: 930000, substitui: prep.eventId, estorna: null,
    animais: r.animais.map((a) => ({ animal_id: a.animal_id, codigo_interno: a.codigo_interno, brinco: a.brinco, sexo: a.sexo, situacao_cadastral: a.situacao_cadastral, pasto_atual_id: a.pasto_atual_id })),
  };
}
// Venda do CT-04 (09, seção 8: comando-modelo com 9 abas): 5 bois por kg vivo, receita com uma parcela e a comissão.
const DATA_VENDA = '2026-08-20';
const COMPRADOR = 'ffffffff-0000-4000-8000-00000000c0c0';
const PESOS_VENDA = [450, 462, 438, 471, 455];
function prepararVenda(amb) {
  const G = amb.G;
  const s = sementes(G);
  const parceiro = { partner_id: COMPRADOR, nome: 'Comprador C1', tipos: 'COMPRADOR', ativo: true, created_at: '2026-01-01T12:00:00.000Z', updated_at: '2026-01-01T12:00:00.000Z' };
  amb.gas.exec(() => G.Database.abrir(amb.banco, { primitiva: amb.primitiva }).anexar({ CONFIGURACOES: s.CONFIGURACOES, PROPRIEDADES: s.PROPRIEDADES, PLANO_CONTAS: s.PLANO_CONTAS, LISTAS: s.LISTAS, CATEGORIAS: s.CATEGORIAS, PARCEIROS: [parceiro] }));
  const pasto = amb.run(cmdPasto(G, { chave: 'cria-retiro-venda', dados: { campos: { nome: 'Retiro' } } })).dados.pasture_id;
  const animais = ['0401', '0402', '0403', '0404', '0405'].map((b) => ({ brinco: b, sexo: 'M', castrado: true, reprodutor: false, origem: 'DESCONHECIDA', pasto_destino_id: pasto, data_nascimento: '2023-06-01', data_nascimento_confianca: 'ESTIMADA' }));
  const r = amb.run(G.EventService.comando('registrar', { idempotencyKey: 'prep-venda', dados: { tipo: 'ENTRADA_INICIAL', campos: {}, animais } }));
  amb.gas.clock.now += 60000;
  return { pasto, ids: r.dados.animais.map((a) => a.animal_id) };
}
function desfechoVenda(amb, e, confirmado, msg, prep) {
  const G = amb.G;
  oraculosIndependentes(amb, msg, ['2026-01-01', '2026-08-19', DATA_VENDA, '2026-11-13']);
  const r = amb.read({ rota: 'teste.venda', reads: G.FinancialService.leituras(), acessoCru: true, tratador: (tx) => ({
    proj: G.Timeline.conferir(tx), fin: G.FinancialService.conferir(tx),
    animais: prep.ids.map((id) => tx.cru.cruPorId('ANIMAIS', id)), vendas: tx.repo.vigentes('VENDAS').length,
    ativos: tx.repo.vigentes('FINANCEIRO').map((f) => f.valor).sort((a, b) => a - b), pesagens: tx.repo.vigentes('PESAGENS').length,
    receber: G.FinancialService.titulos(tx.repo, null).a_receber,
  }) }).dados;
  assert.deepEqual(r.proj, [], msg + ': (2) projeção = reconstrução');
  assert.deepEqual(r.fin, [], msg + ': (2) invariantes financeiras (03b, 14)');
  const op = e.OPERACOES.find((o) => o.idempotency_key === 'k-venda' && o.status === 'CONFIRMADA');
  assert.equal(!!op, confirmado, msg + ': (1) a venda vale exatamente quando o commit chegou');
  if (!confirmado) {
    assert.deepEqual([r.animais.map((a) => [a.situacao_cadastral, a.pasto_atual_id, a.data_saida]), r.vendas, r.ativos, r.pesagens, r.receber],
      [prep.ids.map(() => ['ATIVO', prep.pasto, null]), 0, [], 0, 0], msg + ': (1) tudo como antes');
    return null;
  }
  assert.deepEqual([r.animais.map((a) => [a.situacao_cadastral, a.pasto_atual_id, a.data_saida, a.peso_atual]), r.vendas, r.ativos, r.pesagens, r.receber],
    [prep.ids.map((_, i) => ['VENDIDO', null, DATA_VENDA, PESOS_VENDA[i]]), 1, [45520, 2276000], 5, 2276000], msg + ': (1) a venda inteira');
  return {
    acao: 'registrar', event_id: op.resumo_json.event_id, event_type: 'VENDA', event_subtype: null, event_date: DATA_VENDA, status: 'CONFIRMADO',
    total_value: 2276000, substitui: null, estorna: null,
    animais: r.animais.map((a) => ({ animal_id: a.animal_id, codigo_interno: a.codigo_interno, brinco: a.brinco, sexo: a.sexo, situacao_cadastral: a.situacao_cadastral, pasto_atual_id: a.pasto_atual_id })),
  };
}
// Estorno de transferência (09, seção 8: comando-modelo da Fase 2, com o estorno do CT-07): 3 animais do Retiro para o
// Baixão em 10/04; o estorno os devolve ao Retiro sem apagar nada (a transferência fica ESTORNADA).
const DATA_TRANSF = '2026-04-10';
function prepararEstornoTransferencia(amb) {
  const G = amb.G;
  const s = sementes(G);
  amb.gas.exec(() => G.Database.abrir(amb.banco, { primitiva: amb.primitiva }).anexar({ CONFIGURACOES: s.CONFIGURACOES, PROPRIEDADES: s.PROPRIEDADES, PLANO_CONTAS: s.PLANO_CONTAS, LISTAS: s.LISTAS, CATEGORIAS: s.CATEGORIAS }));
  const origem = amb.run(cmdPasto(G, { chave: 'cria-retiro-transf', dados: { campos: { nome: 'Retiro' } } })).dados.pasture_id;
  const destino = amb.run(cmdPasto(G, { chave: 'cria-baixao-transf', dados: { campos: { nome: 'Baixão' } } })).dados.pasture_id;
  const animais = ['0701', '0702', '0703'].map((b) => ({ brinco: b, sexo: 'F', origem: 'DESCONHECIDA', pasto_destino_id: origem }));
  const ent = amb.run(G.EventService.comando('registrar', { idempotencyKey: 'prep-transf-entrada', dados: { tipo: 'ENTRADA_INICIAL', campos: {}, animais } }));
  const ids = ent.dados.animais.map((a) => a.animal_id);
  const tr = amb.run(G.EventService.comando('registrar', { idempotencyKey: 'prep-transf', dados: { tipo: 'TRANSFERENCIA', campos: { event_date: DATA_TRANSF, pasto_origem_id: origem, pasto_destino_id: destino }, animais: ids.map((animal_id) => ({ animal_id })) } }));
  amb.gas.clock.now += 60000;
  return { origem, destino, ids, transfer: tr.dados.event_id };
}
function desfechoEstornoTransferencia(amb, e, confirmado, msg, prep) {
  const G = amb.G;
  oraculosIndependentes(amb, msg, ['2026-04-09', DATA_TRANSF, '2026-11-13']);
  const r = amb.read({ rota: 'teste.estorno', reads: G.FinancialService.leituras(), acessoCru: true, tratador: (tx) => ({
    proj: G.Timeline.conferir(tx), fin: G.FinancialService.conferir(tx),
    animais: prep.ids.map((id) => tx.cru.cruPorId('ANIMAIS', id)), transfer: tx.cru.avaliar(prep.transfer).status,
    hoje: G.Timeline.inventario(G.Timeline.fonte(tx).todasAsLinhas(), '2026-04-15', '2026-01-01').porPasto,
  }) }).dados;
  assert.deepEqual(r.proj, [], msg + ': (2) projeção = reconstrução');
  assert.deepEqual(r.fin, [], msg + ': (2) invariantes financeiras (03b, 14)');
  const op = e.OPERACOES.find((o) => o.idempotency_key === 'k-est-transf' && o.status === 'CONFIRMADA');
  assert.equal(!!op, confirmado, msg + ': (1) o estorno vale exatamente quando o commit chegou');
  const estornos = e.EVENTOS.filter((x) => x.event_type === 'ESTORNO');
  if (!confirmado) {
    assert.deepEqual([r.transfer, r.animais.map((a) => [a.situacao_cadastral, a.pasto_atual_id]), r.hoje[prep.destino], estornos.filter((x) => x.status === 'CONFIRMADO').length],
      ['CONFIRMADO', prep.ids.map(() => ['ATIVO', prep.destino]), 3, 0], msg + ': (1) tudo como antes');
    return null;
  }
  assert.deepEqual([r.transfer, r.animais.map((a) => [a.situacao_cadastral, a.pasto_atual_id]), r.hoje[prep.origem], r.hoje[prep.destino] || 0],
    ['ESTORNADO', prep.ids.map(() => ['ATIVO', prep.origem]), 3, 0], msg + ': (1) o estorno inteiro');
  const est = estornos.find((x) => x.event_id === op.resumo_json.event_id);
  assert.deepEqual([est.reversal_of_event_id, e.EVENTO_ANIMAIS.filter((l) => l.event_id === est.event_id).length, e.EVENTOS.find((x) => x.event_id === prep.transfer).reversed_by_event_id],
    [prep.transfer, 0, est.event_id], msg + ': (1) ESTORNO sem linha filha, apontando a transferência');
  return {
    acao: 'estornar', event_id: est.event_id, event_type: 'ESTORNO', event_subtype: null, event_date: '2026-11-13', status: 'CONFIRMADO',
    total_value: null, substitui: null, estorna: prep.transfer,
    animais: r.animais.map((a) => ({ animal_id: a.animal_id, codigo_interno: a.codigo_interno, brinco: a.brinco, sexo: a.sexo, situacao_cadastral: a.situacao_cadastral, pasto_atual_id: a.pasto_atual_id })),
  };
}
const CENARIOS = {
  evento: {
    chave: 'chave-evento-1',
    preparar: () => null,
    comando: () => cmdEvento({}),
    desfecho: (amb, e, confirmado, msg) => desfechoEvento(amb, e, 'chave-evento-1', confirmado, msg),
  },
  criacao: {
    chave: 'k',
    preparar: () => null,
    comando: (amb) => cmdPasto(amb.G, { chave: 'k', dados: { campos: { nome: 'Capineira', area_hectares: 3.25, observacoes: '=1+1 não é fórmula' } } }),
    desfecho: (amb, e, confirmado, msg) => {
      const novos = e.PASTOS.filter((p) => p.nome === 'Capineira');
      assert.equal(novos.length, confirmado ? 1 : 0, msg + ': (1) o cadastro nasce uma vez só, e só se confirmado');
      if (!confirmado) return null;
      assert.deepEqual([novos[0].area_hectares, novos[0].observacoes, novos[0].status], [3.25, '=1+1 não é fórmula', 'ATIVO'], msg + ': (1) com todos os campos');
      return { pasture_id: novos[0].pasture_id, existe: true };
    },
  },
  edicao: {
    chave: 'k',
    preparar: (amb) => {
      const p = amb.run(cmdPasto(amb.G, { chave: 'cria', dados: { campos: { nome: 'Rio', area_hectares: 38.5 } } }));
      amb.gas.clock.now += 60000;
      return p.dados.pasture_id;
    },
    comando: (amb, id) => cmdPasto(amb.G, { chave: 'k', dados: { pasture_id: id, campos: NOVOS } }),
    desfecho: (amb, e, confirmado, msg, id) => {
      const p = e.PASTOS.find((x) => x.pasture_id === id);
      const esperado = confirmado ? [NOVOS.nome, NOVOS.area_hectares, NOVOS.observacoes] : ['Rio', 38.5, null];
      assert.deepEqual([p.nome, p.area_hectares, p.observacoes], esperado, msg + ': (1) a edição vale por inteiro ou não vale');
      return confirmado ? { pasture_id: id, campos: 3 } : null;
    },
  },
  motor: {
    chave: 'k-motor',
    ambiente: { projecoes: (G) => G.Timeline.porta(), propriedade: false },
    preparar: (amb) => {
      const s = sementes(amb.G);
      amb.gas.exec(() => amb.G.Database.abrir(amb.banco, { primitiva: amb.primitiva }).anexar({ CONFIGURACOES: s.CONFIGURACOES, PROPRIEDADES: s.PROPRIEDADES }));
      const p = amb.run(cmdPasto(amb.G, { chave: 'cria-retiro', dados: { campos: { nome: 'Retiro' } } }));
      amb.gas.clock.now += 60000;
      return p.dados.pasture_id;
    },
    comando: (amb, pasto) => amb.G.EventService.comando('registrar', {
      idempotencyKey: 'k-motor',
      dados: {
        tipo: 'OUTRA_ENTRADA', campos: { event_date: DATA_MOTOR, description: 'Doação do vizinho' },
        animais: [{ brinco: '0457', sexo: 'F', origem: 'DESCONHECIDA', pasto_destino_id: pasto }, { sexo: 'M', castrado: false, reprodutor: false, origem: 'NASCIDO', pasto_destino_id: pasto }],
      },
    }),
    desfecho: desfechoMotor,
  },
  correcaoCompra: {
    chave: 'k-corr-compra',
    ambiente: { projecoes: (G) => G.Timeline.porta(), propriedade: false },
    preparar: prepararCompra,
    comando: (amb, prep) => amb.G.EventService.comando('corrigir', {
      idempotencyKey: 'k-corr-compra',
      dados: Object.assign(dadosCompra(prep.pasto, ['0801', '0812', '0803'], 30000), { event_id: prep.eventId, justificativa: 'Brinco e frete digitados errado' }, {
        animais: ['0801', '0812', '0803'].map((b, i) => ({ animal_id: prep.ids[i], brinco: b, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 })),
      }),
    }),
    desfecho: desfechoCorrecaoCompra,
  },
  venda: {
    chave: 'k-venda',
    ambiente: { projecoes: (G) => G.Timeline.porta(), propriedade: false },
    preparar: prepararVenda,
    comando: (amb, prep) => amb.G.EventService.comando('registrar', {
      idempotencyKey: 'k-venda',
      dados: {
        tipo: 'VENDA', campos: { event_date: DATA_VENDA, partner_id: COMPRADOR, finalidade: 'RECRIA_ENGORDA', modalidade: 'KG_VIVO', preco_unitario: 1000, valor_bruto: 2276000 },
        animais: prep.ids.map((id, i) => ({ animal_id: id, peso: PESOS_VENDA[i] })),
        parcelas: [{ data_vencimento: '2026-09-19' }], deducoes: [{ tipo: 'COMISSAO', valor: 45520 }],
      },
    }),
    desfecho: desfechoVenda,
  },
  estornoTransferencia: {
    chave: 'k-est-transf',
    ambiente: { projecoes: (G) => G.Timeline.porta(), propriedade: false },
    preparar: prepararEstornoTransferencia,
    comando: (amb, prep) => amb.G.EventService.comando('estornar', { idempotencyKey: 'k-est-transf', dados: { event_id: prep.transfer, justificativa: 'pasto errado' } }),
    desfecho: desfechoEstornoTransferencia,
  },
};
/** Ambiente do cenário: o do motor usa o projetor real (Timeline) e o banco semeado. */
function ambienteDo(primitiva, cen) {
  return Object.assign({ primitiva }, cen.ambiente || {});
}
const MODOS = ['recoverAll', 'leitura', 'status', 'comando', 'simulacao'];
function recuperarPor(amb, modo, chave) {
  if (modo === 'recoverAll') return amb.recoverAll();
  if (modo === 'leitura') return amb.read(consultaVigentes());
  if (modo === 'status') return amb.status(chave);
  if (modo === 'simulacao') return amb.run(cmdEvento({ chave: 'sim', modo: 'SIMULAR' }));
  return amb.run(cmdEvento({ chave: 'outro-comando' }));
}

/** Pontos de chegada das escritas pendentes: nenhuma, todas, cada prefixo e 3 subconjuntos aleatórios (semente fixa). */
function combinacoes(p, semente) {
  const lista = [{ nome: 'nenhuma', chegam: 'nenhuma' }];
  if (!p) return lista;
  lista.push({ nome: 'todas', chegam: 'todas' });
  for (let k = 1; k < p; k++) lista.push({ nome: 'prefixo ' + k, chegam: k });
  const rnd = A.aleatorio(semente);
  for (let i = 0; i < 3 && p >= 2; i++) {
    const b = [];
    for (let j = 0; j < p; j++) b.push(rnd() < 0.5);
    lista.push({ nome: 'subconjunto ' + b.map((x) => (x ? 1 : 0)).join(''), chegam: b });
  }
  return lista;
}

/**
 * Depois da queda: o desfecho é decidido pela célula de commit DURÁVEL; recupera pelo modo dado e confere os
 * invariantes, o tudo-ou-nada, o estado por chave e o reenvio (6). Devolve o estado final.
 */
function conferirQueda(amb, cen, prep, modoPedido, msg) {
  const chave = typeof cen.chave === 'function' ? cen.chave(amb, prep) : cen.chave;
  // Com a importação em andamento os outros comandos de negócio são recusados: o cenário diz os modos que valem.
  const modo = cen.modos && cen.modos.indexOf(modoPedido) < 0 ? cen.modos[msg.length % cen.modos.length] : modoPedido;
  const mortas = estado(amb).OPERACOES.filter((o) => o.idempotency_key === chave);
  const confirmado = mortas.some((o) => o.status === 'CONFIRMADA');
  const r = recuperarPor(amb, modo, chave);
  if (modo === 'status') assert.equal(r.situacao, confirmado ? 'CONFIRMADA' : mortas.length ? 'FALHOU' : 'INEXISTENTE', msg + ': estado por chave com a original morta');
  const e = conferirInvariantes(amb, msg + ' [recuperado por ' + modo + ']');
  const esperado = cen.desfecho(amb, e, confirmado, msg, prep);
  // (6) reenvio com a mesma chave: duplicado exatamente quando a operação valeu; o segundo reenvio devolve o mesmo.
  const s = amb.status(chave).situacao;
  assert.equal(s === 'CONFIRMADA', confirmado, msg + ': o estado por chave prevê o reenvio');
  const um = amb.run(cen.comando(amb, prep));
  assert.equal(um.duplicado, confirmado, msg + ': (6) reenvio');
  if (esperado) assert.deepEqual(um.dados, esperado, msg + ': (6) o reenvio devolve o resultado da operação original');
  const escritas = amb.gas.falhas.escritas();
  const dois = amb.run(cen.comando(amb, prep));
  assert.deepEqual([dois.duplicado, dois.dados, dois.opId], [true, um.dados, um.opId], msg + ': (6) segundo reenvio idêntico');
  assert.equal(amb.gas.falhas.escritas(), escritas, msg + ': (6) o duplicado não grava nada');
  const final = conferirInvariantes(amb, msg + ' [depois do reenvio]');
  cen.desfecho(amb, final, true, msg + ' [depois do reenvio]', prep);
  return final;
}

function escritasDoComando(primitiva, cen) {
  const amb = ambiente(ambienteDo(primitiva, cen));
  const prep = cen.preparar(amb);
  const antes = amb.gas.falhas.escritas();
  amb.run(cen.comando(amb, prep));
  return amb.gas.falhas.escritas() - antes;
}

// ------------------------------------------------------------------ (1)–(6): morte depois de cada escrita ----
for (const primitiva of PRIMITIVAS) {
  for (const nome of Object.keys(CENARIOS)) {
    test('varredura (' + primitiva + ', ' + nome + '): morte DEPOIS de cada escrita de serviço, com cada combinação de pendentes', () => {
      const cen = CENARIOS[nome];
      const n = escritasDoComando(primitiva, cen);
      assert.ok(n >= (primitiva === 'SPREADSHEET_APP' ? 10 : 4), 'o comando faz várias escritas: ' + n);
      let cenarios = 0;
      for (let w = 1; w <= n; w++) {
        let combos = null;
        for (let c = 0; combos === null || c < combos.length; c++) {
          const amb = ambiente(ambienteDo(primitiva, cen));
          const prep = cen.preparar(amb);
          const chegam = combos ? combos[c].chegam : 'nenhuma';
          amb.gas.falhas.matarNaEscrita(w, { incluiAtual: true, chegam });
          const r = amb.tentarRun(cen.comando(amb, prep));
          assert.equal(r.morta, true, nome + ' w=' + w + ': a execução morreu');
          if (!combos) combos = combinacoes(r.pendentes.length, w * 31 + 7);
          const msg = primitiva + ' ' + nome + ' depois da escrita ' + w + '/' + n + ' chegam=' + combos[c].nome;
          conferirQueda(amb, cen, prep, MODOS[cenarios++ % MODOS.length], msg);
        }
      }
      assert.ok(cenarios >= n);
    });
  }
}

for (const primitiva of PRIMITIVAS) {
  test('varredura (' + primitiva + '): morte DEPOIS de cada chamada de porta (marcador, anexar, flush, commit, versão, lock)', () => {
    for (const nome of Object.keys(CENARIOS)) {
      const cen = CENARIOS[nome];
      const ref = ambiente(ambienteDo(primitiva, cen));
      const passos = rodarInstrumentado(ref, cen.comando(ref, cen.preparar(ref)), {}).chamadas;
      let i = 0;
      for (let k = 1; k <= passos.length; k++) {
        let combos = null;
        for (let c = 0; combos === null || c < combos.length; c++) {
          const amb = ambiente(ambienteDo(primitiva, cen));
          const prep = cen.preparar(amb);
          const { r } = rodarInstrumentado(amb, cen.comando(amb, prep), { depois: k, chegam: combos ? combos[c].chegam : 'nenhuma' });
          assert.equal(r.morta, true);
          if (!combos) combos = combinacoes(r.pendentes.length, k * 17);
          conferirQueda(amb, cen, prep, MODOS[i++ % MODOS.length], primitiva + ' ' + nome + ' depois de ' + k + ' (' + passos[k - 1] + ') chegam=' + combos[c].nome);
        }
      }
    }
  });
}

/**
 * Subconjuntos das pendentes num ponto de buffer cheio: todos até 5 escritas; acima, 24 sorteados com semente fixa,
 * com densidades de chegada de 10%, 50% e 90% (o quase nada e o quase tudo também são cobertos).
 */
function subconjuntosDensos(p, semente) {
  if (p <= 5) {
    const todos = [];
    for (let mask = 0; mask < 1 << p; mask++) todos.push(Array.from({ length: p }, (_, j) => !!(mask & (1 << j))));
    return todos;
  }
  const rnd = A.aleatorio(semente);
  return Array.from({ length: 24 }, (_, i) => Array.from({ length: p }, () => rnd() < [0.1, 0.5, 0.9][i % 3]));
}
test('subconjuntos densos (SPREADSHEET_APP, 09 seção 5): venda, estorno de transferência e correção de compra mortos ANTES de cada flush, com o buffer cheio, em muitos subconjuntos das escritas pendentes; tudo ou nada, invariantes e reenvio', () => {
  let casos = 0;
  for (const nome of ['venda', 'estornoTransferencia', 'correcaoCompra']) {
    const cen = CENARIOS[nome];
    const ref = ambiente(ambienteDo('SPREADSHEET_APP', cen));
    const passos = rodarInstrumentado(ref, cen.comando(ref, cen.preparar(ref)), {}).chamadas;
    passos.forEach((rotulo, i) => {
      if (rotulo !== 'flush') return;
      const k = i + 1;
      let combos = null;
      for (let c = 0; combos === null || c < combos.length; c++) {
        const amb = ambiente(ambienteDo('SPREADSHEET_APP', cen));
        const prep = cen.preparar(amb);
        const { r } = rodarInstrumentado(amb, cen.comando(amb, prep), { antes: k, chegam: combos ? combos[c] : 'nenhuma' });
        assert.equal(r.morta, true);
        if (!combos) { combos = subconjuntosDensos(r.pendentes.length, k * 101 + nome.length); if (!combos.length) break; }
        const msg = 'SPREADSHEET_APP ' + nome + ' antes do flush ' + k + ' (' + r.pendentes.length + ' pendentes) chegam=' + (combos[c] || []).map((x) => (x ? 1 : 0)).join('');
        conferirQueda(amb, cen, prep, MODOS[casos++ % MODOS.length], msg);
      }
    });
  }
  assert.ok(casos >= 150, 'casos: ' + casos);
});

// ------------------------------------------------------------------ (7) recuperação morta e repetida ----
for (const primitiva of PRIMITIVAS) {
  test('(7) recuperação reentrante (' + primitiva + '): morta DEPOIS de cada passo, em cada queda do comando, chega ao mesmo estado', () => {
    for (const nome of ['evento', 'criacao']) {
      const cen = CENARIOS[nome];
      const ref0 = ambiente({ primitiva });
      const passosCmd = rodarInstrumentado(ref0, cen.comando(ref0, cen.preparar(ref0)), {}).chamadas.length;
      for (let k = 1; k < passosCmd; k++) {
        const montar = () => {
          const amb = ambiente({ primitiva });
          const prep = cen.preparar(amb);
          rodarInstrumentado(amb, cen.comando(amb, prep), { depois: k, chegam: 'nenhuma' });
          return { amb, prep };
        };
        const ref = montar();
        const passos = recuperarInstrumentado(ref.amb, {}).chamadas;
        const esperado = essencia(conferirInvariantes(ref.amb, 'referência k=' + k));
        for (let j = 1; j < passos.length; j++) {
          const chegadas = primitiva === 'SPREADSHEET_APP' ? ['nenhuma', 'todas', (p) => p.map((_, i) => (i * 7 + j) % 3 !== 0)] : ['nenhuma'];
          for (const chegam of chegadas) {
            const { amb } = montar();
            const msg = primitiva + ' ' + nome + ' comando morto depois de ' + k + ', recuperação morta depois de ' + j + ' (' + passos[j - 1] + ')';
            const morta = recuperarInstrumentado(amb, { depois: j, chegam });
            assert.equal(morta.r.morta, true, msg);
            if (j < passos.length - 2) assert.notEqual(amb.marcador(), null, msg + ': o marcador fica até a recuperação terminar');
            const segunda = recuperarInstrumentado(amb, { depois: j, chegam }); // pode morrer de novo no mesmo ponto
            if (segunda.r.morta) amb.read(consultaVigentes());
            assert.deepEqual(essencia(conferirInvariantes(amb, msg)), esperado, msg + ': (7) mesmo estado da recuperação sem queda');
          }
        }
      }
    }
  });
}

// ------------------------------------------------------------------ intercalações ----
/**
 * Numera as chamadas de LEITURA e de lock de um contexto e roda `antesDe(k, rótulo)` antes de cada uma. `io.ler`
 * é partido em uma chamada por aba (o pior caso: o SpreadsheetApp lê aba por aba; a Sheets API lê tudo numa
 * requisição) — cada aba lida é um ponto de troca.
 */
function instrumentarLeitura(ctx, antesDe) {
  const vistos = [];
  const marcar = (rotulo) => { vistos.push(rotulo); antesDe(vistos.length, rotulo); };
  const io = ctx.io;
  const props = ctx.props;
  const lock = ctx.lock;
  ctx.io = Object.assign({}, io, {
    esquecer: () => { marcar('esquecer'); return io.esquecer(); },
    ler: (abas) => {
      const out = {};
      abas.forEach((a) => { marcar('ler:' + a); Object.assign(out, io.ler([a])); });
      return out;
    },
  });
  ctx.props = Object.assign({}, props, { ler: () => { marcar('props.ler'); return props.ler(); } });
  ctx.lock = Object.assign({}, lock, {
    tentar: (ms) => { marcar('lock.tentar'); return lock.tentar(ms); },
    soltar: () => { marcar('lock.soltar'); return lock.soltar(); },
  });
  return vistos;
}
const LEITORES = {
  leitura: (amb, ctx) => {
    const r = amb.G.UnitOfWork.read(ctx, consultaVigentes());
    return { versao: r.dataVersion, eventos: js(r.dados.eventos).length, animais: js(r.dados.animais).length, linhas: r.dados.linhas };
  },
  simulacao: (amb, ctx) => {
    const visto = {};
    const r = amb.G.UnitOfWork.run(ctx, cmdEvento({ chave: 'sim', modo: 'SIMULAR', antes: (tx) => {
      visto.eventos = tx.repo.vigentes('EVENTOS').length;
      visto.animais = tx.repo.vigentes('ANIMAIS').length;
      visto.linhas = tx.repo.vigentes('EVENTO_ANIMAIS').length;
      visto.versao = tx.dataVersion;
    } }));
    assert.equal(r.dataVersion, visto.versao, 'a prévia diz a versão que leu');
    return visto;
  },
  status: (amb, ctx) => ({ situacao: js(amb.G.UnitOfWork.status(ctx, 'w')).situacao }),
};
const W_VARIANTES = [null, 3, 5, 7, 11]; // completa; morta antes do flush da fase A, do flush do commit, do flush da fase C, de remover o marcador

for (const primitiva of PRIMITIVAS) {
  test('intercalação (' + primitiva + '): um comando inteiro, ou morto, em cada ponto de troca de leitura, prévia e estado da operação; o leitor nunca vê estado parcial', () => {
    const leitores = primitiva === 'SHEETS_RAW' ? ['leitura'] : Object.keys(LEITORES);
    for (const leitor of leitores) {
      const seco = ambiente({ primitiva });
      seco.run(cmdEvento({ chave: 'antes' }));
      let pontos = [];
      seco.gas.exec(() => { const ctx = seco.ctx(); pontos = instrumentarLeitura(ctx, () => {}); return LEITORES[leitor](seco, ctx); });
      assert.ok(pontos.length >= 3, leitor + ': pontos de troca ' + pontos.join(' | '));
      for (let j = 1; j <= pontos.length; j++) {
        for (const kW of W_VARIANTES) {
          const amb = ambiente({ primitiva });
          amb.run(cmdEvento({ chave: 'antes' })); // S0: um evento, dois animais, versão 1
          const msg = primitiva + ' ' + leitor + ': W ' + (kW ? 'morto antes de ' + kW : 'completo') + ' no ponto ' + j + ' (' + pontos[j - 1] + ')';
          let rodou = false;
          const r = amb.gas.tentar(() => {
            const ctx = amb.ctx();
            instrumentarLeitura(ctx, (k) => {
              if (k !== j || rodou) return;
              rodou = true;
              rodarInstrumentado(amb, cmdEvento({ chave: 'w' }), kW ? { antes: kW } : {});
            });
            return LEITORES[leitor](amb, ctx);
          });
          assert.equal(r.ok, true, msg + ': ' + (r.erro && r.erro.message));
          assert.ok(rodou, msg + ': o ponto de troca existiu');
          const v = r.valor;
          const final = amb.vigentes(); // recupera o que tiver ficado pendente
          const e = conferirInvariantes(amb, msg);
          const valeu = e.OPERACOES.some((o) => o.idempotency_key === 'w' && o.status === 'CONFIRMADA');
          assert.equal(final.eventos.length, valeu ? 2 : 1, msg);
          if (leitor === 'status') {
            assert.notEqual(v.situacao, 'EM_ANDAMENTO', msg + ': a original já terminou ou morreu; o lock estava livre');
            if (v.situacao === 'CONFIRMADA') assert.equal(valeu, true, msg + ': CONFIRMADA só se valeu');
            if (v.situacao === 'FALHOU') assert.equal(valeu, false, msg + ': FALHOU só se não valeu');
            continue;
          }
          // Versão 1 = o estado de antes; versão maior = o estado final. Nunca um meio-termo.
          const esperado = v.versao === 1 ? { eventos: 1, animais: 2, linhas: 2 } : { eventos: final.eventos.length, animais: final.animais.length, linhas: final.linhas };
          assert.deepEqual({ eventos: v.eventos, animais: v.animais, linhas: v.linhas }, esperado, msg + ': versão ' + v.versao + ' servida com o estado dela');
          assert.ok(v.versao >= 1 && v.versao <= amb.versao(), msg);
        }
      }
    }
  });
}

test('intercalação: com a gravação em curso, em cada passo dela, outro comando, recoverAll e gatilho esperam e recebem LOCKED sem deixar rastro; a leitura só serve antes do marcador ou depois de removido', () => {
  for (const primitiva of PRIMITIVAS) {
    const ref = ambiente({ primitiva });
    const passos = rodarInstrumentado(ref, cmdEvento({}), {}).chamadas;
    for (let k = 1; k <= passos.length; k++) {
      const amb = ambiente({ primitiva });
      amb.run(cmdEvento({ chave: 'antes' }));
      const msg = primitiva + ' passo ' + k + ' (' + passos[k - 1] + ')';
      const vistos = {};
      const { r } = rodarInstrumentado(amb, cmdEvento({}), {
        antesDe: (i) => {
          if (i !== k) return;
          const marcadorAntes = amb.gas.props.script._data.get(amb.chaveMarcador) || null;
          const t0 = amb.gas.clock.now;
          vistos.mesmaChave = erroDe(amb.gas.tentar(() => amb.G.UnitOfWork.run(amb.ctx(), cmdEvento({}))));
          vistos.outraChave = erroDe(amb.gas.tentar(() => amb.G.UnitOfWork.run(amb.ctx(), cmdEvento({ chave: 'outra' }))));
          vistos.recoverAll = erroDe(amb.gas.tentar(() => amb.G.UnitOfWork.recoverAll(amb.ctx())));
          vistos.gatilho = erroDe(amb.gas.tentar(() => amb.G.UnitOfWork.exclusivo(amb.ctx(), { rota: 'trgIntegridadeSemanal', tratador: () => 'ok' })));
          vistos.esperou = amb.gas.clock.now - t0 >= 3 * 25000;
          const leitura = amb.gas.tentar(() => js(amb.G.UnitOfWork.read(amb.ctx(), consultaVigentes())));
          vistos.leitura = leitura.ok ? leitura.valor.dados.eventos.length + '@' + leitura.valor.dataVersion : erroDe(leitura);
          vistos.marcadorIntacto = (amb.gas.props.script._data.get(amb.chaveMarcador) || null) === marcadorAntes;
        },
      });
      assert.equal(r.ok, true, msg + ': a gravação em curso termina bem');
      assert.deepEqual([vistos.mesmaChave, vistos.outraChave, vistos.recoverAll, vistos.gatilho], ['LOCKED', 'LOCKED', 'LOCKED', 'LOCKED'], msg);
      assert.equal(vistos.esperou, true, msg + ': cada um esperou os 25 s');
      assert.equal(vistos.marcadorIntacto, true, msg + ': ninguém mexeu no marcador da gravação em curso');
      const esperadoLeitura = k === 1 ? '1@1' : k === passos.length ? '2@2' : 'LOCKED';
      assert.equal(vistos.leitura, esperadoLeitura, msg + ': leitura');
      const e = conferirInvariantes(amb, msg);
      assert.deepEqual(e.OPERACOES.map((o) => [o.idempotency_key, o.status]), [['antes', 'CONFIRMADA'], ['chave-evento-1', 'CONFIRMADA']], msg + ': as recusadas não deixaram operação');
      assert.equal(amb.run(cmdEvento({})).duplicado, true, msg + ': o reenvio de depois é duplicado');
    }
  }
});

test('intercalação: o lock livre antes de o comando obtê-lo e depois de soltá-lo — o outro entra inteiro (ou morre em cada passo) e os dois terminam coerentes', () => {
  for (const primitiva of PRIMITIVAS) {
    const ref = ambiente({ primitiva });
    const passos = rodarInstrumentado(ref, cmdEvento({ chave: 'w2' }), {}).chamadas.length;
    for (const momento of ['lock.tentar', 'lock.liberado']) {
      for (const mesma of [false, true]) {
        for (let k2 = 0; k2 <= passos; k2++) {
          const amb = ambiente({ primitiva });
          const chave2 = mesma ? 'chave-evento-1' : 'w2';
          const msg = primitiva + ' ' + momento + (mesma ? ' mesma chave' : ' outra chave') + ' W2 ' + (k2 ? 'morto antes de ' + k2 : 'completo');
          let r2 = null;
          let valeuW2 = null;
          amb.gas.ganchos.em(momento, () => {
            r2 = rodarInstrumentado(amb, cmdEvento({ chave: chave2 }), k2 ? { antes: k2 } : {}).r;
            valeuW2 = estado(amb).OPERACOES.some((o) => o.idempotency_key === chave2 && o.status === 'CONFIRMADA');
          });
          const r1 = amb.tentarRun(cmdEvento({}));
          assert.ok(r2, msg + ': o outro rodou');
          assert.equal(r1.ok, true, msg + ': W1 termina bem (' + (r1.erro && r1.erro.message) + ')');
          if (mesma && momento === 'lock.tentar') assert.equal(r1.valor.duplicado, valeuW2, msg + ': W1 é duplicado exatamente quando W2 valeu');
          if (mesma && momento === 'lock.liberado' && r2.ok) assert.deepEqual([js(r2.valor).duplicado, js(r2.valor).dados], [true, r1.valor.dados], msg + ': o toque duplo depois é duplicado, com a mesma resposta');
          amb.read(consultaVigentes());
          const e = conferirInvariantes(amb, msg);
          const seqs = e.EVENTOS.map((x) => x.event_seq);
          assert.equal(new Set(seqs).size, seqs.length, msg + ': event_seq nunca se repete');
          const codigos = e.ANIMAIS.map((a) => a.codigo_interno);
          assert.equal(new Set(codigos).size, codigos.length, msg + ': codigo_interno nunca se repete');
          if (!mesma) {
            const valeu2 = e.OPERACOES.some((o) => o.idempotency_key === 'w2' && o.status === 'CONFIRMADA');
            assert.equal(js(amb.vigentes()).eventos.length, 1 + (valeu2 ? 1 : 0), msg);
          }
        }
      }
    }
  }
});

// ------------------------------------------------------------------ dois bancos ----
test('dois bancos no mesmo projeto: queda em cada passo de A não contamina B; B nunca recupera, versiona nem grava em A; o lock é um só', () => {
  for (const primitiva of ['SHEETS_TYPED', 'SPREADSHEET_APP']) {
    const ref = ambiente({ primitiva, nome: 'Ref' });
    const passos = rodarInstrumentado(ref, cmdEvento({}), {}).chamadas;
    for (let k = 1; k <= passos.length; k++) {
      const a = ambiente({ primitiva, nome: 'Banco A' });
      const b = ambiente({ primitiva, gas: a.gas, nome: 'Banco B' });
      const msg = primitiva + ' A morto antes de ' + k + ' (' + passos[k - 1] + ')';
      // Durante a gravação de A, um leitor de B não espera o lock (B não tem marcador); um comando em B espera (lock único).
      const durante = {};
      rodarInstrumentado(a, cmdEvento({}), {
        antes: k,
        antesDe: (i) => {
          if (i !== k) return;
          const t0 = a.gas.clock.now;
          durante.leituraB = b.gas.tentar(() => js(b.G.UnitOfWork.read(b.ctx(), consultaVigentes()))).ok;
          durante.esperouLeitura = a.gas.clock.now - t0;
          durante.comandoB = erroDe(b.gas.tentar(() => b.G.UnitOfWork.run(b.ctx(), cmdEvento({ chave: 'b-durante' }))));
        },
      });
      assert.deepEqual([durante.leituraB, durante.esperouLeitura, durante.comandoB], [true, 0, 'LOCKED'], msg + ': durante a gravação de A');
      const duravelA = () => ABAS.map((aba) => JSON.stringify(a.gas.planilhas.matrizDuravel(a.banco, aba)));
      const fotoA = duravelA();
      const marcadorA = a.marcador();
      const versaoA = a.versao();
      const rb = b.run(cmdEvento({})); // mesma chave, outro banco: outra operação
      assert.deepEqual([rb.duplicado, rb.dataVersion], [false, 1], msg);
      assert.equal(b.read(consultaVigentes()).dados.eventos.length, 1, msg);
      assert.equal(b.status('chave-evento-1').situacao, 'CONFIRMADA', msg);
      const tb = b.recoverAll();
      assert.deepEqual([tb.falharam, tb.refeitas], [[], []], msg + ': B não enxerga as órfãs de A');
      assert.deepEqual(duravelA(), fotoA, msg + ': nada de B foi gravado em A');
      assert.deepEqual([a.marcador(), a.versao()], [marcadorA, versaoA], msg + ': marcador e versão de A intactos');
      a.read(consultaVigentes()); // A recupera o que é seu
      conferirInvariantes(a, msg + ' [A]');
      conferirInvariantes(b, msg + ' [B]');
      assert.equal(b.versao(), 2, msg + ': a versão de B só andou com B');
    }
  }
});

// ------------------------------------------------------------------ exceção tratável ----
/** Envolve io.anexar/io.atualizar: na k-ésima chamada a escrita é FEITA e a resposta se perde (lança depois). */
function respostaPerdidaNa(amb, ctx, k) {
  let n = 0;
  const io = ctx.io;
  const envolver = (nome) => function () {
    const r = io[nome].apply(null, arguments);
    if (++n === k) throw amb.gas.run('new Error("Sheets API: a resposta se perdeu (" + ' + JSON.stringify(nome) + ' + ")")');
    return r;
  };
  ctx.io = Object.assign({}, io, { anexar: envolver('anexar'), atualizar: envolver('atualizar') });
}
function conferirExcecao(amb, cen, prep, r, msg) {
  const confirmado = estado(amb).OPERACOES.some((o) => o.idempotency_key === cen.chave && o.status === 'CONFIRMADA');
  if (r.ok) {
    assert.equal(confirmado, true, msg + ': sucesso só com a operação confirmada');
    assert.equal(js(r.valor).recuperada, true, msg + ': sucesso depois de exceção vem marcado como recuperado');
  } else {
    assert.equal(erroDe(r), 'INTERNAL', msg + ': ' + r.erro.message);
    if (amb.marcador() === null) {
      assert.equal(confirmado, false, msg + ': INTERNAL com a recuperação feita só quando nada valeu');
      assert.match(r.erro.message, /nada foi alterado/, msg);
    } else {
      // A recuperação também falhou: "nada foi alterado" só é verdade se o commit não pode ter chegado.
      if (confirmado) {
        assert.doesNotMatch(r.erro.message, /nada foi alterado/, msg + ': a operação já vale; não pode dizer que nada mudou');
        assert.match(r.erro.message, /confira/i, msg + ': manda conferir antes de lançar de novo');
      }
      assert.ok(r.erro.recuperacao, msg + ': o erro da recuperação acompanha');
      amb.read(consultaVigentes()); // a chamada seguinte recupera
    }
  }
  return conferirQueda(amb, cen, prep, 'leitura', msg);
}

for (const primitiva of PRIMITIVAS) {
  test('exceção tratável (' + primitiva + ') em cada escrita do comando, também na recuperação que ela dispara, e resposta perdida em cada gravação', () => {
    for (const nome of Object.keys(CENARIOS)) {
      const cen = CENARIOS[nome];
      const n = escritasDoComando(primitiva, cen);
      for (let w = 1; w <= n; w++) {
        for (let m = 0; m <= 6; m++) { // m = 0: só a escrita w falha; m > 0: a m-ésima escrita depois dela também (dentro da recuperação)
          const amb = ambiente(ambienteDo(primitiva, cen));
          const prep = cen.preparar(amb);
          amb.gas.falhas.falharNaEscrita(w, { mensagem: 'Service Spreadsheets timed out while accessing document' });
          if (m) amb.gas.falhas.falharNaEscrita(w + m, { mensagem: 'Service Spreadsheets failed again' });
          const r = amb.tentarRun(cen.comando(amb, prep));
          amb.gas.falhas.limpar();
          assert.equal(r.morta, false);
          conferirExcecao(amb, cen, prep, r, primitiva + ' ' + nome + ' falha na escrita ' + w + '/' + n + (m ? ' e na ' + (w + m) : ''));
        }
      }
      const ref = ambiente(ambienteDo(primitiva, cen));
      let gravacoes = 0;
      ref.gas.exec(() => {
        const ctx = ref.ctx();
        const io = ctx.io;
        ctx.io = Object.assign({}, io, { anexar: (x) => { gravacoes++; return io.anexar(x); }, atualizar: (x) => { gravacoes++; return io.atualizar(x); } });
        return ref.G.UnitOfWork.run(ctx, cen.comando(ref, cen.preparar(ref)));
      });
      for (let k = 1; k <= gravacoes; k++) {
        const amb = ambiente(ambienteDo(primitiva, cen));
        const prep = cen.preparar(amb);
        const r = amb.gas.tentar(() => {
          const ctx = amb.ctx();
          respostaPerdidaNa(amb, ctx, k);
          return js(amb.G.UnitOfWork.run(ctx, cen.comando(amb, prep)));
        });
        conferirExcecao(amb, cen, prep, r, primitiva + ' ' + nome + ' resposta perdida na gravação ' + k + '/' + gravacoes);
      }
    }
  });
}

// ------------------------------------------------------------------ estado da operação ----
test('estado da operação com a original VIVA em cada passo: nunca FALHOU, CONFIRMADA só com tudo aplicado, e a consulta não mexe em nada', () => {
  for (const primitiva of PRIMITIVAS) {
    const ref = ambiente({ primitiva });
    const passos = rodarInstrumentado(ref, cmdEvento({}), {}).chamadas;
    for (let k = 1; k <= passos.length; k++) {
      const amb = ambiente({ primitiva });
      const msg = primitiva + ' passo ' + k + ' (' + passos[k - 1] + ')';
      let visto = null;
      let completa = null;
      const { r } = rodarInstrumentado(amb, cmdEvento({}), {
        antesDe: (i) => {
          if (i !== k) return;
          completa = estado(amb).OPERACOES.some((o) => o.status === 'CONFIRMADA' && o.aplicada_em);
          visto = js(amb.gas.tentar(() => amb.G.UnitOfWork.status(amb.ctx(), 'chave-evento-1')).valor).situacao;
        },
      });
      assert.equal(r.ok, true, msg + ': a original termina bem');
      assert.ok(['INEXISTENTE', 'EM_ANDAMENTO', 'CONFIRMADA'].includes(visto), msg + ': ' + visto);
      assert.equal(visto === 'CONFIRMADA', completa, msg + ': CONFIRMADA exatamente quando a operação já está aplicada');
      if (k >= 2 && !completa) assert.equal(visto, 'EM_ANDAMENTO', msg + ': com o marcador e o lock tomado, em andamento');
      conferirInvariantes(amb, msg);
      assert.equal(amb.status('chave-evento-1').situacao, 'CONFIRMADA', msg);
    }
  }
});

test('estado da operação que recupera grava a mesma trilha em ERROS_LOG que a leitura que recupera (AUDITORIA_SEM_ALVO não se perde)', () => {
  const trilhas = {};
  for (const via of ['leitura', 'status', 'recoverAll']) {
    const amb = ambiente();
    const p = amb.run(cmdPasto(amb.G, { chave: 'cria', dados: { campos: { nome: 'Rio' } } }));
    rodarInstrumentado(amb, cmdPasto(amb.G, { chave: 'k', dados: { pasture_id: p.dados.pasture_id, campos: { nome: 'Novo' } } }), { antes: 6 });
    const m = amb.gas.planilhas.matriz(amb.banco, 'PASTOS');
    amb.gas.planilhas.gravar(amb.banco, 'PASTOS', 2, 1, [m[1].map(() => '')]); // o dono apaga a linha do pasto à mão
    recuperarPor(amb, via, 'k');
    trilhas[via] = amb.tabela('ERROS_LOG').map((e) => e.codigo).sort();
    assert.equal(amb.marcador(), null, via);
  }
  assert.deepEqual(trilhas.leitura, ['AUDITORIA_SEM_ALVO', 'FASE_C_REFEITA']);
  assert.deepEqual(trilhas.status, trilhas.leitura, 'pelo estado da operação');
  assert.deepEqual(trilhas.recoverAll, trilhas.leitura, 'pelo recoverAll');
});

// ------------------------------------------------------------------ corpus hostil ----
function profundo(n) {
  let v = { fim: '=1+1' };
  for (let i = 0; i < n; i++) v = { nivel: i, filho: v, lista: [i, String(i), null] };
  return v;
}
const HOSTIS = {
  TEXTO: [
    '=SOMA(1;2)', '=HYPERLINK("http://x";"y")', "'=1+1", '==', '=', '+', '-', '@', "'", "''", ' ', '\t', 'linha 1\nlinha 2', 'a\r\nb',
    ' ', 'zero​largura', '﻿0012', 'Ração São João — "Baixada"', '🐄🐂 Nelore', '#N/A', '#REF!', '#DIV/0!', 'R$ 1.234,56',
    '1/2', '3-4', '1e400', '-0', '+0', '0x1F', 'E5', '1E-5', 'Infinity', 'NaN', 'null', 'undefined', 'true', 'VERDADEIRO', 'FALSO',
    '00:00', '24:00', '2026-02-30', '30/02/2026', '1.0', '.5', '5.', ' 12 ', '١٢٣', '\\', '<script>alert(1)</script>', '{"a":1}', '[1,2]',
    '50 %', '$1', 'x'.repeat(40000),
  ],
  ID: ['0012', '1E5', '=1', 'TRUE', '2026-11-13', '00000000-0000-4000-8000-000000000001', '-1', '+1', "'x", ' id '],
  DATA: ['1899-12-30', '1899-12-31', '1900-01-01', '1900-02-28', '1900-03-01', '0001-01-01', '9999-12-31', '2024-02-29', '1970-01-01', '2026-11-13'],
  TS: ['1970-01-01T00:00:00.000Z', '1899-12-30T00:00:00.000Z', '2026-11-14T03:59:59.999Z', '9999-12-31T23:59:59.999Z', '0001-01-01T00:00:00.000Z', '2026-03-08T07:00:00.001Z'],
  INT: [0, -1, 1, 2147483648, -2147483649, 9007199254740991, -9007199254740991, 1e15, 12, 100000],
  DEC1: [0.1, -0.1, 387.5, 1e21, 0, 99999999999.9],
  DEC4: [0.0001, 37.4501, 123456789.1234, 0.1 + 0.2, -0.0001, 1e21, 5e-324],
  DINHEIRO: [1, -1, 0, 5, 105, 1005, 10005, 123456789, 99999999999, 900719925474099, -900719925474099, 999999999999999, -999999999999999],
  BOOL: [true, false],
  ENUM: ['N', 'S', 'TRUE', '0', '=X', 'ATIVO', ' A '],
  JSON: [{}, [], [[]], { a: { b: { c: [1, 2, { d: '=1+1' }] } } }, { 'chave com espaço': ' v ' }, { ' ': ' ' }, { n: 1e21, f: 0.1, z: -1e-7 },
    { s: 'x'.repeat(39000) }, [null], [true, false], { emoji: '🐄' }, profundo(40), { '': '' }, { '=': '+' }, ['=1+1', '0012', '2026-11-13']],
};
const DEF_HOSTIL = {
  nome: 'HOSTIL', pk: 'id',
  colunas: [{ nome: 'id', tipo: 'TEXTO' }, { nome: 'texto', tipo: 'TEXTO' }, { nome: 'ident', tipo: 'ID' }, { nome: 'data', tipo: 'DATA' },
    { nome: 'instante', tipo: 'TS' }, { nome: 'inteiro', tipo: 'INT' }, { nome: 'dec1', tipo: 'DEC1' }, { nome: 'dec4', tipo: 'DEC4' },
    { nome: 'dinheiro', tipo: 'DINHEIRO' }, { nome: 'sim_nao', tipo: 'BOOL' }, { nome: 'enumerado', tipo: 'ENUM' }, { nome: 'json', tipo: 'JSON' }],
};
function registrosHostis(desloca) {
  const n = Math.max(...Object.values(HOSTIS).map((l) => l.length));
  const regs = [];
  for (let i = 0; i < n; i++) {
    const r = { id: 'hostil-' + String(i).padStart(3, '0') };
    DEF_HOSTIL.colunas.slice(1).forEach((c) => { const l = HOSTIS[c.tipo]; r[c.nome] = l[(i + desloca) % l.length]; });
    regs.push(r);
  }
  regs.push({ id: 'hostil-vazio', texto: '', ident: null, data: '', instante: null, inteiro: null, dec1: null, dec4: null, dinheiro: null, sim_nao: null, enumerado: '', json: null });
  return regs;
}

for (const primitiva of PRIMITIVAS) {
  test('corpus hostil (' + primitiva + '): cada valor volta idêntico ao anexar e ao reescrever, e a memória da unidade espelha a planilha', () => {
    const amb = ambiente({ primitiva });
    const { G, gas, banco } = amb;
    const abrir = () => G.Database.abrir(banco, { primitiva, tabelas: { HOSTIL: DEF_HOSTIL } });
    const originais = registrosHostis(0);
    const reescritos = registrosHostis(1);
    const espelho = js(gas.exec(() => {
      const io = abrir();
      io.criarTabelas(['HOSTIL']);
      const ultima = io.ler(['HOSTIL']).HOSTIL.ultimaLinha;
      const onde = io.anexar({ HOSTIL: originais });
      const primeira = onde.HOSTIL === null || onde.HOSTIL === undefined ? ultima + 1 : onde.HOSTIL;
      io.flush();
      assert.equal(io.conferirPosicoes([{ tabela: 'HOSTIL', linha: primeira, id: originais[0].id }]), true, 'a posição anexada confere');
      io.atualizar(reescritos.map((r, i) => {
        const campos = Object.assign({}, r);
        delete campos.id;
        return { tabela: 'HOSTIL', linha: primeira + i, campos };
      }));
      io.flush();
      return reescritos.map((r) => io.normalizar('HOSTIL', r));
    }));
    const lido = js(gas.exec(() => abrir().ler(['HOSTIL']).HOSTIL));
    assert.deepEqual(lido.alertas, [], primitiva + ': nenhuma célula coercida');
    assert.equal(lido.registros.length, reescritos.length);
    lido.registros.forEach((reg, i) => {
      for (const c of DEF_HOSTIL.colunas) {
        const esperado = js(reescritos[i][c.nome]);
        assert.deepEqual(reg[c.nome], esperado === '' ? null : esperado, primitiva + ' ' + reg.id + '.' + c.nome + ' = ' + JSON.stringify(reescritos[i][c.nome]).slice(0, 60));
      }
    });
    assert.deepEqual(lido.registros, espelho, primitiva + ': normalizar (o espelho da memória) = o que a planilha devolve');
  });
}

test('codec: limites do que ida e volta preserva — dinheiro além de 15 dígitos é recusado antes de gravar; texto de AUDITORIA de número grande volta exato', () => {
  const amb = ambiente();
  const D = amb.G.Database;
  const col = (tipo) => ({ nome: 'x', tipo });
  const codigo = (fn) => { try { fn(); return null; } catch (e) { return e.code || 'EXCECAO'; } };
  for (const c of [1e15, -1e15, 4503599627370495, 9007199254740991]) {
    assert.equal(codigo(() => D.codificar(col('DINHEIRO'), c)), 'INTERNAL', 'centavos ' + c + ' não voltariam exatos');
    if (c > 0) assert.equal(js(amb.G.Validation.validarValor(amb.G.Schema.coluna('EVENTOS', 'total_value'), c)).codigo, 'VALOR_FORA_DA_FAIXA', 'a validação recusa antes: ' + c);
  }
  assert.equal(amb.G.Validation.validarValor(amb.G.Schema.coluna('EVENTOS', 'total_value'), 999999999999999), null, 'o limite ainda vale');
  assert.equal(D.codificar(col('DINHEIRO'), 999999999999999), 9999999999999.99);
  for (const [tipo, v] of [['DEC4', 1e21], ['DEC1', -1e21], ['DEC4', 123456789.1234], ['INT', 9007199254740991], ['DINHEIRO', -999999999999999]]) {
    const texto = D.paraTexto(col(tipo), v);
    assert.equal(D.deTexto(col(tipo), texto), v, tipo + ' ' + v + ' → "' + texto + '" → volta');
  }
});

test('células hostis digitadas pelo dono: a leitura nunca lança, e conversão impossível é erro de integridade, nunca "coercida sem perda"', () => {
  const celulas = {
    // {data: 2958466} é 01/01/10000: Date válido que não cabe em yyyy-MM-dd (o fake não representa serial além do Date).
    data: [{ data: 2958466 }, 1e10, -1e10, 2958466, true, 'abc', { data: 46339 }],
    instante: [{ data: 2958466.5 }, 1e10, -1e10, 2958466.5, false, '2026-11-13', { data: 46339.5 }],
    dinheiro: [1e300, -1e300, 1e13, 'R$ 10,00', true],
    inteiro: [2.5, 1e300, '12', 'doze', -0.5],
    dec4: ['1e5', 'x', true],
    sim_nao: ['s', 'SIM', 1, true],
    json: ['{', '"texto"', '12', 'null', '[1]'],
    ident: [12, true, { data: 46339 }],
  };
  for (const primitiva of PRIMITIVAS) {
    const amb = ambiente({ primitiva });
    const { G, gas, banco } = amb;
    const abrir = () => G.Database.abrir(banco, { primitiva, tabelas: { HOSTIL: DEF_HOSTIL } });
    gas.exec(() => abrir().criarTabelas(['HOSTIL']));
    const cols = DEF_HOSTIL.colunas.map((c) => c.nome);
    let linha = 3;
    const casos = [];
    for (const [coluna, lista] of Object.entries(celulas)) {
      for (const valor of lista) {
        gas.planilhas.gravar(banco, 'HOSTIL', linha, 1, [['dono-' + linha]]);
        gas.planilhas.gravar(banco, 'HOSTIL', linha, cols.indexOf(coluna) + 1, [[valor]]);
        casos.push({ linha, coluna, valor });
        linha++;
      }
    }
    const r = gas.tentar(() => js(abrir().ler(['HOSTIL']).HOSTIL));
    assert.equal(r.ok, true, primitiva + ': a leitura de célula hostil não pode derrubar a aba inteira: ' + (r.erro && r.erro.message));
    const lido = r.valor;
    for (const caso of casos) {
      const reg = lido.registros.find((x) => x.id === 'dono-' + caso.linha);
      const alerta = lido.alertas.find((a) => a.linha === caso.linha && a.coluna === caso.coluna);
      const v = reg[caso.coluna];
      const tipo = DEF_HOSTIL.colunas.find((c) => c.nome === caso.coluna).tipo;
      const msg = primitiva + ' ' + caso.coluna + ' ← ' + JSON.stringify(caso.valor) + ' lido ' + JSON.stringify(v) + ' ' + (alerta ? alerta.nivel + ' ' + alerta.codigo : 'sem alerta');
      const valido = v === null || (tipo === 'DATA' ? G.Utils.dataValida(v) : tipo === 'TS' ? G.Utils.instanteValido(v)
        : tipo === 'INT' || tipo === 'DINHEIRO' ? Number.isSafeInteger(v) : tipo === 'DEC4' ? Number.isFinite(v)
          : tipo === 'BOOL' ? typeof v === 'boolean' : tipo === 'JSON' ? typeof v === 'object' : typeof v === 'string');
      if (!alerta) assert.ok(valido, msg + ': sem alerta, o valor tem de ser do tipo');
      else if (alerta.nivel === 'COERCIDA') assert.ok(valido && v !== null, msg + ': "coercida" promete conversão sem perda');
      else assert.equal(alerta.nivel, 'ERRO', msg);
    }
  }
});

test('valores hostis pelo caminho inteiro: cadastro criado e editado com eles volta exato, AUDITORIA refaz, o reenvio é duplicado e o banco segue usável', () => {
  for (const primitiva of PRIMITIVAS) {
    const amb = ambiente({ primitiva });
    const G = amb.G;
    const textos = ['=SOMA(1;2)', "'0012", 'linha 1\nlinha 2', ' ', '#N/A', '🐄 Ração São João', 'null', '-10 kg', 'x'.repeat(30000)];
    const areas = [1e21, 0.0001, 123456789.1234, 0.1 + 0.2 > 0.3 ? 0.3 : 0.3, 99999999999.9999];
    const criado = amb.run(cmdPasto(G, { chave: 'h-cria', dados: { campos: { nome: textos[0], area_hectares: areas[0], observacoes: textos[1] } } }));
    const id = criado.dados.pasture_id;
    for (let i = 1; i < Math.max(textos.length, areas.length); i++) {
      const campos = { nome: textos[i % textos.length], area_hectares: areas[i % areas.length], observacoes: textos[(i + 3) % textos.length] };
      const msg = primitiva + ' edição ' + i;
      const r = amb.tentarRun(cmdPasto(G, { chave: 'h-' + i, dados: { pasture_id: id, campos } }));
      assert.equal(r.ok, true, msg + ': ' + (r.erro && (r.erro.causa || r.erro.message)));
      const p = amb.tabela('PASTOS').find((x) => x.pasture_id === id);
      assert.deepEqual([p.nome, p.area_hectares, p.observacoes], [campos.nome, campos.area_hectares, campos.observacoes], msg + ': volta exato');
      assert.equal(amb.run(cmdPasto(G, { chave: 'h-' + i, dados: { pasture_id: id, campos } })).duplicado, true, msg + ': reenvio');
    }
    // A fase C refeita pela recuperação lê de volta o texto da AUDITORIA de cada tipo.
    rodarInstrumentado(amb, cmdPasto(G, { chave: 'h-rec', dados: { pasture_id: id, campos: { nome: '=1+1', area_hectares: 1e21, observacoes: '\t' } } }), { antes: 6 });
    amb.recoverAll();
    conferirInvariantes(amb, primitiva + ' fase C refeita com valores hostis');
    assert.equal(amb.run(cmdEvento({ chave: 'depois' })).duplicado, false, primitiva + ': o banco segue usável');
  }
});

test('chaves de idempotência hostis: cada uma é uma operação só, o reenvio é duplicado e chaves parecidas não se confundem', () => {
  const chaves = ['0012', '12', "'0012", '1E5', '100000', '=1+1', 'TRUE', 'true', ' k ', 'k', 'k\nk', '🐄', '2026-11-13', '13/11/2026', 'x'.repeat(2000)];
  for (const primitiva of PRIMITIVAS) {
    const amb = ambiente({ primitiva });
    const ids = {};
    for (const chave of chaves) {
      const r = amb.run(cmdEvento({ chave, animais: 1 }));
      assert.equal(r.duplicado, false, primitiva + ' ' + JSON.stringify(chave).slice(0, 20) + ': primeira vez');
      ids[chave] = r.dados.event_id;
    }
    for (const chave of chaves) {
      const r = amb.run(cmdEvento({ chave, animais: 1 }));
      assert.deepEqual([r.duplicado, r.dados.event_id], [true, ids[chave]], primitiva + ' ' + JSON.stringify(chave).slice(0, 20) + ': reenvio');
      assert.equal(amb.status(chave).situacao, 'CONFIRMADA');
    }
    const e = conferirInvariantes(amb, primitiva);
    assert.deepEqual(e.OPERACOES.map((o) => o.idempotency_key), chaves, primitiva + ': as chaves voltam exatas');
    assert.equal(amb.status(' 0012').situacao, 'INEXISTENTE', primitiva + ': sem aparar nem converter');
  }
});

// ------------------------------------------------------------------ órfã sem marcador ----
test('backup restaurado no meio de uma operação (sem as Script Properties): leitura, prévia e comando no banco novo nunca servem estado parcial', () => {
  for (const primitiva of PRIMITIVAS) {
    const ref = ambiente({ primitiva });
    const passos = rodarInstrumentado(ref, cmdEvento({}), {}).chamadas;
    for (let k = 2; k <= passos.length; k++) {
      for (const via of ['leitura', 'simulacao', 'comando']) {
        const amb = ambiente({ primitiva });
        amb.run(cmdEvento({ chave: 'antes' }));
        rodarInstrumentado(amb, cmdEvento({}), { antes: k, chegam: 'todas' });
        const copia = js(amb.gas.exec(() => amb.G.Drive.Files.copy({ name: 'Banco restaurado' }, amb.banco))).id;
        // O banco restaurado, visto pela mesma API do ambiente (outro banco, sem marcador nem versão).
        const rest = Object.assign({}, amb, {
          banco: copia,
          ctx: () => amb.G.Database.contexto({ banco: copia, primitiva, usuario: A.USUARIO, fuso: A.FUSO, projecoes: amb.projecoes }),
          marcador: () => amb.gas.props.script._data.get('PENDING_OP:' + copia) || null,
          versao: () => Number(amb.gas.props.script._data.get('DATA_VERSION:' + copia) || 0),
          lido: (abas) => js(amb.gas.exec(() => amb.G.Database.abrir(copia, { primitiva }).ler(abas))),
        });
        rest.read = (q) => js(amb.gas.exec(() => amb.G.UnitOfWork.read(rest.ctx(), q)));
        rest.run = (cmd) => js(amb.gas.exec(() => amb.G.UnitOfWork.run(rest.ctx(), cmd)));
        rest.status = (chave) => js(amb.gas.exec(() => amb.G.UnitOfWork.status(rest.ctx(), chave)));
        rest.recoverAll = () => js(amb.gas.exec(() => amb.G.UnitOfWork.recoverAll(rest.ctx())));
        rest.vigentes = () => rest.read(consultaVigentes()).dados;
        assert.equal(rest.marcador(), null);
        const msg = primitiva + ' cópia feita com a operação morta antes de ' + k + ' (' + passos[k - 1] + '), primeira chamada: ' + via;
        let visto;
        if (via === 'leitura') visto = rest.read(consultaVigentes()).dados;
        else if (via === 'simulacao') {
          const v = {};
          rest.run(cmdEvento({ chave: 'sim', modo: 'SIMULAR', antes: (tx) => { v.eventos = tx.repo.vigentes('EVENTOS').map((e) => e.event_id); v.animais = tx.repo.vigentes('ANIMAIS').map((a) => a.animal_id); v.linhas = tx.repo.vigentes('EVENTO_ANIMAIS').length; } }));
          visto = v;
        } else {
          rest.run(cmdEvento({ chave: 'depois-da-restauracao' }));
          visto = null;
        }
        const e = conferirInvariantes(rest, msg);
        const final = rest.vigentes();
        if (visto) {
          assert.deepEqual([js(visto.eventos), js(visto.animais), visto.linhas], [final.eventos, final.animais, final.linhas], msg + ': serviu o estado recuperado, não o parcial');
        }
        const valeu = e.OPERACOES.some((o) => o.idempotency_key === 'chave-evento-1' && o.status === 'CONFIRMADA');
        assert.equal(rest.run(cmdEvento({})).duplicado, valeu, msg + ': reenvio no banco restaurado');
        conferirInvariantes(rest, msg + ' [depois do reenvio]');
      }
    }
  }
});

// ------------------------------------------------------------------ importação: quedas nas três primitivas ----
/**
 * Um lote de importação (de animais e de compras: vários eventos numa operação) morto depois de cada escrita e depois
 * de cada chamada de porta, nas três primitivas. Tudo ou nada por lote: confirmado → linhas IMPORTADA, eventos e
 * animais inertes (PENDENTE) até concluir; senão → nada do lote, a importação continua VALIDADO. O invariante (2)
 * aceita o animal PENDENTE do lote confirmado. Com a importação em andamento, outros comandos são recusados: a
 * recuperação é pela própria recuperação, pela leitura ou pelo estado da chave.
 */
const FORMATO_IMP = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
const IMPORTACOES_TESTE = {
  ANIMAIS: {
    csv: 'Brinco;Sexo;Pasto\n0901;F;Retiro\n0902;M;Retiro\n0903;F;Retiro',
    mapa: { colunas: { Brinco: 'brinco', Sexo: 'sexo', Pasto: 'pasto' }, confiancas: {}, padroes: { castrado: false, reprodutor: false } },
    linhas: 3, eventos: 1, novos: 3,
  },
  COMPRAS: {
    csv: 'Nº da compra;Data da compra;Fornecedor;Como foi o preço;Preço (R$);Valor dos animais (R$);Frete (R$);Primeiro vencimento;Brinco;Sexo;Pasto\n'
      + 'K1;05/11/2026;Fornecedor do lote;cabeça;3.000,00;6.000,00;300,00;05/12/2026;0911;M;Retiro\nK1;;;;;;;;0912;F;Retiro\n'
      + 'K2;06/11/2026;Fornecedor do lote;cabeça;3.000,00;3.000,00;;;0913;M;Retiro',
    mapa: {
      colunas: { 'Nº da compra': 'grupo', 'Data da compra': 'data', Fornecedor: 'fornecedor', 'Como foi o preço': 'modalidade', 'Preço (R$)': 'preco', 'Valor dos animais (R$)': 'valor_animais', 'Frete (R$)': 'frete', 'Primeiro vencimento': 'vencimento', Brinco: 'brinco', Sexo: 'sexo', Pasto: 'pasto' },
      confiancas: {}, padroes: { castrado: false, reprodutor: false },
    },
    linhas: 3, eventos: 2, novos: 3,
  },
  // Fase 3, E3.6: manejo sobre animais que já estão no rebanho (ativos = os do rebanho inicial, que não mudam). A pesagem
  // tem a histórica (antes do marco zero) e a coletiva; a aplicação grava a saída do produto (sem controle de estoque, para
  // não pedir o aviso de estoque insuficiente) e o consumo, que só valem ao concluir.
  PESAGENS: {
    csv: 'Data da pesagem;Brinco;Peso (kg)\n01/03/2026;0921;300\n01/03/2026;0922;310,5\n15/09/2025;0921;250',
    mapa: { colunas: { 'Data da pesagem': 'data', Brinco: 'brinco', 'Peso (kg)': 'peso' }, confiancas: {}, padroes: { momento: 'ROTINA', metodo: 'BALANCA' } },
    linhas: 3, eventos: 2, novos: 0, ativos: 2, rebanho: true,
  },
  SANIDADE: {
    csv: 'Data;Procedimento;Produto do cadastro;Como foi a dose;Dose do lançamento (por cabeça ou por kg);Brinco\n01/03/2026;vacinação;Vacina K;por cabeça;1;0921\n01/03/2026;vacinação;Vacina K;por cabeça;1;0922',
    mapa: { colunas: { Data: 'data', Procedimento: 'procedimento', 'Produto do cadastro': 'produto', 'Como foi a dose': 'modo_dose', 'Dose do lançamento (por cabeça ou por kg)': 'dose_lancamento', Brinco: 'brinco' }, confiancas: {}, padroes: {} },
    linhas: 2, eventos: 1, novos: 0, ativos: 2, rebanho: true, produto: true,
  },
};
function prepararImportacao(amb, tipo) {
  const G = amb.G;
  const t = IMPORTACOES_TESTE[tipo];
  const s = sementes(G);
  const parceiro = { partner_id: FORNECEDOR, nome: 'Fornecedor do lote', tipos: 'FORNECEDOR', ativo: true, created_at: '2026-11-01T12:00:00.000Z', updated_at: '2026-11-01T12:00:00.000Z' };
  amb.gas.exec(() => G.Database.abrir(amb.banco, { primitiva: amb.primitiva }).anexar({ CONFIGURACOES: s.CONFIGURACOES, PROPRIEDADES: s.PROPRIEDADES, PLANO_CONTAS: s.PLANO_CONTAS, LISTAS: s.LISTAS, CATEGORIAS: s.CATEGORIAS, PARCEIROS: [parceiro] }));
  const retiro = amb.run(cmdPasto(G, { chave: 'cria-retiro-imp', dados: { campos: { nome: 'Retiro' } } })).dados.pasture_id;
  if (t.rebanho) {
    const animais = ['0921', '0922'].map((b) => ({ brinco: b, sexo: 'M', castrado: true, reprodutor: false, origem: 'DESCONHECIDA', pasto_destino_id: retiro, data_nascimento: '2023-06-01', data_nascimento_confianca: 'ESTIMADA' }));
    amb.run(G.EventService.comando('registrar', { idempotencyKey: 'prep-rebanho-imp', dados: { tipo: 'ENTRADA_INICIAL', campos: {}, animais } }));
  }
  if (t.produto) {
    amb.run(G.HealthService.comandoSalvarProduto({ idempotencyKey: 'prep-produto-imp', dados: { campos: { nome: 'Vacina K', categoria: 'VACINA', unidade: 'dose', controla_estoque: false, custo_unitario: 2 } } }));
  }
  const comArquivos = () => amb.ctx({ files: G.FileService.porta() });
  const c = js(amb.gas.exec(() => G.ImportService.criar(comArquivos(), { idempotencyKey: 'imp-criar', dados: { tipo, arquivo_nome: tipo + '.csv', texto: t.csv, formato: FORMATO_IMP } }))).dados;
  const v = js(amb.gas.exec(() => G.ImportService.validarBloco(comArquivos(), { idempotencyKey: 'imp-val', dados: { import_id: c.import_id, bloco: 1, mapeamento: t.mapa } }))).dados;
  assert.deepEqual([v.importacao.status, v.contadores.validas], ['VALIDADO', t.linhas], tipo + ': arquivo validado');
  amb.gas.clock.now += 60000;
  return { id: c.import_id, tipo, t };
}
function desfechoImportacao(amb, e, confirmado, msg, prep) {
  const opOk = (id) => e.OPERACOES.some((o) => o.op_id === id && o.status === 'CONFIRMADA');
  const imp = e.IMPORTACOES.find((i) => i.import_id === prep.id);
  assert.equal(imp.status, confirmado ? 'IMPORTANDO' : 'VALIDADO', msg + ': (1) a importação');
  const ls = amb.tabela('IMPORTACAO_LINHAS').filter((l) => l.import_id === prep.id);
  assert.deepEqual(ls.map((l) => l.status), Array(prep.t.linhas).fill(confirmado ? 'IMPORTADA' : 'VALIDA'), msg + ': (1) as linhas do lote');
  const evs = e.EVENTOS.filter((x) => x.import_id === prep.id && opOk(x.op_id));
  assert.equal(evs.length, confirmado ? prep.t.eventos : 0, msg + ': (1) os eventos do lote');
  evs.forEach((x) => assert.equal(x.status, 'PENDENTE', msg + ': evento importado não vale antes de concluir'));
  assert.equal(e.ANIMAIS.filter((a) => a.situacao_cadastral === 'PENDENTE').length, confirmado ? prep.t.novos : 0, msg + ': animais do lote ficam PENDENTE');
  assert.equal(e.ANIMAIS.filter((a) => a.situacao_cadastral === 'ATIVO').length, prep.t.ativos || 0, msg + ': nada do lote vale');
  if (prep.tipo === 'PESAGENS' || prep.tipo === 'SANIDADE') {
    // O manejo do lote: as linhas de detalhe gravadas (inertes até concluir) e nenhuma projeção mexida.
    const doLote = (aba) => amb.tabela(aba).filter((x) => evs.some((y) => y.event_id === x.event_id));
    const vivos = e.ANIMAIS.filter((a) => a.situacao_cadastral === 'ATIVO');
    if (prep.tipo === 'PESAGENS') {
      assert.equal(doLote('PESAGENS').length, confirmado ? 3 : 0, msg + ': (1) as pesagens do lote');
      assert.ok(vivos.every((a) => (a.peso_atual === undefined ? null : a.peso_atual) === null), msg + ': o peso atual só muda ao concluir');
    } else {
      assert.equal(doLote('SANIDADE').length, confirmado ? 2 : 0, msg + ': (1) as aplicações do lote');
      assert.deepEqual(doLote('MOVIMENTOS_ESTOQUE').map((x) => [x.tipo, x.quantidade]), confirmado ? [['SAIDA', 2]] : [], msg + ': (1) a saída do estoque do lote');
      const fin = doLote('FINANCEIRO');
      assert.deepEqual(fin.map((f) => [f.valor, f.natureza]), confirmado ? [[400, 'CUSTEIO']] : [], msg + ': (1) o consumo do lote (2 doses × R$ 2,00)');
    }
  }
  if (prep.tipo === 'COMPRAS') {
    const fin = amb.tabela('FINANCEIRO').filter((f) => evs.some((x) => x.event_id === f.event_id));
    assert.equal(fin.length, confirmado ? 3 : 0, msg + ': (1) os lançamentos das compras (2 principais e o frete)');
  }
  return null;
}
const CENARIOS_IMPORTACAO = {};
['ANIMAIS', 'COMPRAS', 'PESAGENS', 'SANIDADE'].forEach((tipo) => {
  CENARIOS_IMPORTACAO['importacao' + tipo] = {
    chave: (amb, prep) => amb.G.ImportService.chaveBloco(prep.id, 1),
    ambiente: { projecoes: (G) => G.Timeline.porta(), propriedade: false },
    modos: ['recoverAll', 'leitura', 'status'],
    preparar: (amb) => prepararImportacao(amb, tipo),
    comando: (amb, prep) => amb.G.ImportService.comandoBloco({ dados: { import_id: prep.id, bloco: 1, modo: 'TOTAL' } }),
    desfecho: desfechoImportacao,
  };
});
/** Chegadas reduzidas (a importação é cara de montar): nenhuma, todas, a metade e um subconjunto sorteado. */
function combinacoesImportacao(p, semente) {
  const lista = [{ nome: 'nenhuma', chegam: 'nenhuma' }];
  if (!p) return lista;
  lista.push({ nome: 'todas', chegam: 'todas' });
  if (p >= 2) lista.push({ nome: 'prefixo ' + Math.floor(p / 2), chegam: Math.floor(p / 2) });
  const rnd = A.aleatorio(semente);
  const b = Array.from({ length: p }, () => rnd() < 0.5);
  lista.push({ nome: 'subconjunto ' + b.map((x) => (x ? 1 : 0)).join(''), chegam: b });
  return lista;
}
for (const primitiva of PRIMITIVAS) {
  for (const nome of Object.keys(CENARIOS_IMPORTACAO)) {
    test('varredura da importação (' + primitiva + ', ' + nome + '): morte DEPOIS de cada escrita do lote, e de cada chamada de porta; tudo ou nada por lote, invariantes com o animal PENDENTE e reenvio pela chave do bloco', () => {
      const cen = CENARIOS_IMPORTACAO[nome];
      const n = escritasDoComando(primitiva, cen);
      assert.ok(n >= (primitiva === 'SPREADSHEET_APP' ? 10 : 4), 'o lote faz várias escritas: ' + n);
      let casos = 0;
      for (let w = 1; w <= n; w++) {
        let combos = null;
        for (let c = 0; combos === null || c < combos.length; c++) {
          const amb = ambiente(ambienteDo(primitiva, cen));
          const prep = cen.preparar(amb);
          amb.gas.falhas.matarNaEscrita(w, { incluiAtual: true, chegam: combos ? combos[c].chegam : 'nenhuma' });
          const r = amb.tentarRun(cen.comando(amb, prep));
          assert.equal(r.morta, true, nome + ' w=' + w + ': a execução morreu');
          if (!combos) combos = combinacoesImportacao(r.pendentes.length, w * 13 + 5);
          conferirQueda(amb, cen, prep, MODOS[casos++ % MODOS.length], primitiva + ' ' + nome + ' depois da escrita ' + w + '/' + n + ' chegam=' + combos[c].nome);
        }
      }
      const ref = ambiente(ambienteDo(primitiva, cen));
      const passos = rodarInstrumentado(ref, cen.comando(ref, cen.preparar(ref)), {}).chamadas;
      for (let k = 1; k <= passos.length; k++) {
        const amb = ambiente(ambienteDo(primitiva, cen));
        const prep = cen.preparar(amb);
        const { r } = rodarInstrumentado(amb, cen.comando(amb, prep), { depois: k, chegam: k % 2 ? 'nenhuma' : 'todas' });
        assert.equal(r.morta, true);
        conferirQueda(amb, cen, prep, MODOS[casos++ % MODOS.length], primitiva + ' ' + nome + ' depois de ' + k + ' (' + passos[k - 1] + ')');
      }
      assert.ok(casos >= n + passos.length);
    });
  }
}
