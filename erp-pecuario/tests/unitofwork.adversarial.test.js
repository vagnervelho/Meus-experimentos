'use strict';
/**
 * Ataque à persistência (Database, Repository, UnitOfWork): testes que tentam quebrar o protocolo de 06.
 *
 * - Varredura exaustiva: a execução morre DEPOIS de cada escrita individual (cada chamada de serviço que escreve, e
 *   cada chamada de porta: marcador, flush, versão, lock) de um comando de evento que grava em várias abas e de
 *   comandos sem evento (criação e edição de cadastro); em cada ponto, chegam nenhuma, todas, cada prefixo e
 *   subconjuntos aleatórios (semente fixa) das escritas pendentes. Depois da recuperação valem os invariantes:
 *   (1) tudo ou nada; (2) projeções = reconstrução pelos eventos vigentes; (3) nenhuma linha vigente órfã;
 *   (4) nenhuma operação órfã; (5) marcador removido; (6) reenvio com a mesma chave não duplica e devolve o mesmo
 *   resultado; (7) recuperação morta no meio e repetida chega ao mesmo estado.
 * - Intercalações em cada ponto de troca que o lock do fake permite; leitor concorrente nunca vê estado parcial;
 *   dois bancos no mesmo projeto; exceção tratável em cada escrita; estado da operação com a original morta ou viva.
 * - Corpus de tipos com valores hostis nas três primitivas; células hostis digitadas pelo dono; valores hostis pelo
 *   caminho inteiro (AUDITORIA como registro de refazer e chave de idempotência).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio-persistencia');

const { js, ambiente, cmdEvento, cmdPasto, consultaVigentes, rodarInstrumentado, recuperarInstrumentado } = A;
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
  for (const a of e.ANIMAIS) {
    const entrada = filhasVigentes.some((l) => l.animal_id === a.animal_id && l.efeito_inventario === 1);
    assert.equal(a.situacao_cadastral, entrada ? 'ATIVO' : 'ANULADO', msg + ': (2) projeção do animal ' + a.codigo_interno);
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
};
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
function conferirQueda(amb, cen, prep, modo, msg) {
  const chave = cen.chave;
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
  const amb = ambiente({ primitiva });
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
          const amb = ambiente({ primitiva });
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
      const ref = ambiente({ primitiva });
      const passos = rodarInstrumentado(ref, cen.comando(ref, cen.preparar(ref)), {}).chamadas;
      let i = 0;
      for (let k = 1; k <= passos.length; k++) {
        let combos = null;
        for (let c = 0; combos === null || c < combos.length; c++) {
          const amb = ambiente({ primitiva });
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
