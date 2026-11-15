'use strict';
/**
 * Apoio comum aos testes de persistência (database, repository, unitofwork): banco com as 34 abas criado pela
 * própria porta de E/S, contexto de execução com as portas REAIS do Database (sobre os fakes do harness),
 * comandos de exemplo com e sem evento, um projetor mínimo e a instrumentação que mata a execução em cada
 * fronteira de escrita. Não é arquivo de teste (não termina em .test.js).
 */
const { createGas } = require('./harness');

const USUARIO = 'dono@gmail.com';
const FUSO = 'America/Porto_Velho';
const PROPRIEDADE = '11111111-1111-4111-8111-111111111111';
const TABELAS_EVENTO = ['EVENTOS', 'EVENTO_ANIMAIS', 'ANIMAIS'];

/** Converte valor do contexto vm para comparação com assert.deepStrictEqual. */
function js(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/**
 * Projetor mínimo para a porta `ctx.projecoes` (o real é do Timeline, etapa seguinte): animal com entrada vigente
 * fica ATIVO; sem entrada vigente, ANULADO. Registra cada chamada (escopo recebido).
 */
function projetorDeTeste() {
  const chamadas = [];
  return {
    chamadas,
    reads: ['ANIMAIS', 'EVENTO_ANIMAIS', 'EVENTOS'],
    reconstruir(tx, escopo) {
      chamadas.push(js(escopo));
      const alvo = escopo.tudo ? null : escopo.animais || [];
      tx.cru.cru('ANIMAIS').forEach((a) => {
        if (alvo && alvo.indexOf(a.animal_id) < 0) return;
        const entradas = tx.repo.por('EVENTO_ANIMAIS', 'animal_id', a.animal_id).filter((l) => l.efeito_inventario === 1);
        tx.plano.atualizar('ANIMAIS', a.animal_id, { situacao_cadastral: entradas.length ? 'ATIVO' : 'ANULADO' });
      });
    },
  };
}

/**
 * Ambiente de teste: harness + planilha-banco com todas as abas e a propriedade dos comandos de exemplo. opcoes:
 * {primitiva, order, projecoes (false desliga; função (G) → porta, ex.: G.Timeline.porta), gas (reaproveita um harness:
 * dois bancos no mesmo projeto), propriedade (false: o teste semeia o próprio cadastro, com a mesma propriedade)}.
 */
function ambiente(opcoes) {
  const o = opcoes || {};
  const gas = o.gas || createGas({ order: o.order || 'alpha' });
  const G = gas.G;
  const primitiva = o.primitiva || 'SHEETS_TYPED';
  const banco = gas.planilhas.criar(o.nome || 'Banco');
  gas.exec(() => G.Database.abrir(banco, { primitiva }).criarTabelas(G.Schema.nomesTabelas()));
  // A propriedade que os comandos de exemplo citam (EVENTOS.property_id, PASTOS.property_id) existe no banco desde o
  // começo, como um cadastro anterior: sem ela o evento de exemplo apontaria para uma propriedade inexistente — ERRO de
  // chave estrangeira que a verificação de integridade acusa e que a trava de integridade da UnitOfWork recusa. Quem
  // semeia o próprio cadastro (com a mesma propriedade) passa `propriedade: false`.
  if (o.propriedade !== false) {
    gas.exec(() => {
      const io = G.Database.abrir(banco, { primitiva });
      io.anexar({ PROPRIEDADES: [{ property_id: PROPRIEDADE, nome: 'Fazenda de teste', status: 'ATIVO', created_at: '2026-01-01T00:00:00.000Z' }] });
      io.flush();
    });
  }
  const projecoes = o.projecoes === false ? null : typeof o.projecoes === 'function' ? o.projecoes(G) : o.projecoes || projetorDeTeste();
  const amb = {
    gas, G, banco, primitiva, projecoes,
    chaveMarcador: 'PENDING_OP:' + banco,
    chaveVersao: 'DATA_VERSION:' + banco,
    /** Contexto novo (uma execução do Apps Script = um contexto). */
    ctx: (extra) => G.Database.contexto(Object.assign({ banco, primitiva, usuario: USUARIO, fuso: FUSO, projecoes }, extra || {})),
    run: (cmd, extra) => js(gas.exec(() => G.UnitOfWork.run(amb.ctx(extra), cmd))),
    tentarRun: (cmd, extra) => gas.tentar(() => js(G.UnitOfWork.run(amb.ctx(extra), cmd))),
    read: (q, extra) => js(gas.exec(() => G.UnitOfWork.read(amb.ctx(extra), q))),
    status: (chave) => js(gas.exec(() => G.UnitOfWork.status(amb.ctx(), chave))),
    recoverAll: () => js(gas.exec(() => G.UnitOfWork.recoverAll(amb.ctx()))),
    marcador: () => gas.props.script._data.get('PENDING_OP:' + banco) || null,
    versao: () => Number(gas.props.script._data.get('DATA_VERSION:' + banco) || 0),
    /** Registros decodificados, lidos do estado DURÁVEL por uma porta nova (numa execução própria). */
    tabela: (aba) => js(gas.exec(() => G.Database.abrir(banco, { primitiva }).ler([aba])[aba].registros)),
    lido: (abas) => js(gas.exec(() => G.Database.abrir(banco, { primitiva }).ler(abas))),
    /** O que vale hoje, pela leitura validada. */
    vigentes: () => amb.read(consultaVigentes()).dados,
  };
  return amb;
}

function consultaVigentes() {
  return {
    rota: 'teste.vigentes',
    reads: TABELAS_EVENTO.concat(['PASTOS', 'AUDITORIA']),
    tratador: (tx) => ({
      eventos: tx.repo.vigentes('EVENTOS').map((e) => e.event_id),
      linhas: tx.repo.vigentes('EVENTO_ANIMAIS').length,
      animais: tx.repo.vigentes('ANIMAIS').map((a) => a.animal_id),
      pastos: tx.repo.vigentes('PASTOS').map((p) => ({ id: p.pasture_id, nome: p.nome, area: p.area_hectares })),
      auditoria: tx.repo.vigentes('AUDITORIA').length,
    }),
  };
}

function extrairCodigo(v) {
  return Number(String(v).slice(2));
}

/** Comando de EVENTO de exemplo: um evento OUTRA_ENTRADA com `animais` animais novos. */
function cmdEvento(opcoes) {
  const o = opcoes || {};
  const n = o.animais === undefined ? 2 : o.animais;
  return {
    rota: 'evento.registrar',
    idempotencyKey: o.chave === undefined ? 'chave-evento-1' : o.chave,
    dados: o.dados || { tipo: 'OUTRA_ENTRADA', data: '2026-11-13', animais: n },
    avisosAceitos: o.avisosAceitos || [],
    dataVersionEsperada: o.dataVersionEsperada,
    modo: o.modo,
    reads: TABELAS_EVENTO,
    tratador(tx) {
      if (o.antes) o.antes(tx);
      const eventId = tx.novoId();
      tx.plano.anexar('EVENTOS', {
        event_id: eventId, event_seq: tx.repo.contador('EVENTOS', 'event_seq'), event_type: o.tipo || 'OUTRA_ENTRADA',
        event_date: '2026-11-13', registration_date: tx.hoje, property_id: PROPRIEDADE, source: 'APP', pre_marco_zero: false,
        reversal_of_event_id: o.anula || null,
      });
      const animais = [];
      for (let i = 0; i < n; i++) {
        const animalId = tx.novoId();
        animais.push(animalId);
        tx.plano.anexar('ANIMAIS', { animal_id: animalId, codigo_interno: 'A-' + String(tx.repo.contador('ANIMAIS', 'codigo_interno', extrairCodigo)).padStart(6, '0') });
        tx.plano.anexar('EVENTO_ANIMAIS', { event_animal_id: tx.novoId(), event_id: eventId, animal_id: animalId, papel: 'SUJEITO', efeito_inventario: 1 });
      }
      return {
        erros: o.erros || [],
        avisos: o.avisos || [],
        resumo: { event_id: eventId, animais: n },
        impactos: { event_id: eventId, animais: n },
        derivados: { animais },
        resposta: (t) => ({ event_id: eventId, vigente: t.repo.eventoVigente(eventId) }),
      };
    },
    reconstruir: (tx, op) => ({ event_id: op.resumo.event_id, vigente: tx.repo.eventoVigente(op.resumo.event_id) }),
  };
}

/**
 * Comando SEM evento de exemplo (`pasto.salvar`): cria o pasto (ação CRIAR) ou altera campos [cad] (ALTERAR).
 * dados: {pasture_id?, campos, justificativa?}.
 */
function cmdPasto(G, opcoes) {
  const o = opcoes || {};
  return {
    rota: 'pasto.salvar',
    idempotencyKey: o.chave === undefined ? 'chave-pasto-1' : o.chave,
    dados: o.dados,
    reads: ['PASTOS'],
    tratador(tx) {
      const d = tx.dados;
      if (d.pasture_id) {
        const n = G.AuditService.alteracao(tx, 'PASTOS', d.pasture_id, d.campos, d.justificativa);
        return { resumo: { pasture_id: d.pasture_id, campos: n }, resposta: { pasture_id: d.pasture_id, campos: n } };
      }
      const id = tx.novoId();
      G.AuditService.criacao(tx, 'PASTOS', id, Object.assign({ property_id: PROPRIEDADE, posse: 'PROPRIO', status: 'ATIVO' }, d.campos));
      return { resumo: { pasture_id: id }, resposta: (t) => ({ pasture_id: id, existe: !!t.repo.porId('PASTOS', id) }) };
    },
    // Duplicado devolve a MESMA forma da resposta original: edição → {pasture_id, campos}; criação → {pasture_id, existe}.
    reconstruir: (tx, op) => (op.resumo.campos !== undefined
      ? { pasture_id: op.resumo.pasture_id, campos: op.resumo.campos }
      : { pasture_id: op.resumo.pasture_id, existe: !!tx.repo.porId('PASTOS', op.resumo.pasture_id) }),
  };
}

/**
 * Instrumenta as portas de escrita do contexto (io.anexar, io.atualizar, io.flush, props.gravar, props.remover,
 * lock.soltar): cada chamada recebe um número e um rótulo. `alvo` = {antes: k} mata a execução ANTES da k-ésima
 * chamada; {depois: k} faz a chamada e mata em seguida. `chegam` escolhe as escritas pendentes que chegam
 * (só tem efeito na primitiva SPREADSHEET_APP); `antesDe(k, rotulo)` roda antes de cada chamada (intercalações).
 * Devolve {chamadas} com os rótulos vistos.
 */
function instrumentar(gas, ctx, alvo) {
  const a = alvo || {};
  const chamadas = [];
  function rotulo(nome, args) {
    if (nome === 'anexar') return 'anexar:' + Object.keys(args[0] || {}).filter((t) => (args[0][t] || []).length).join(',');
    if (nome === 'atualizar') {
      const campos = [];
      (args[0] || []).forEach((it) => Object.keys(it.campos || {}).forEach((c) => { const k = it.tabela + '.' + c; if (campos.indexOf(k) < 0) campos.push(k); }));
      return 'atualizar:' + campos.join(',');
    }
    if (nome === 'gravar' || nome === 'remover') return 'props.' + nome + ':' + String(args[0]).split(':')[0];
    return nome;
  }
  function envolver(obj, nome) {
    const original = obj[nome];
    obj[nome] = function () {
      const args = Array.prototype.slice.call(arguments);
      chamadas.push(rotulo(nome, args));
      const k = chamadas.length;
      if (a.antesDe) a.antesDe(k, chamadas[k - 1]);
      if (a.antes === k) gas.matar({ chegam: a.chegam });
      const r = original.apply(this, args);
      if (a.depois === k) gas.matar({ chegam: a.chegam });
      return r;
    };
  }
  ctx.io = Object.assign({}, ctx.io);
  ctx.props = Object.assign({}, ctx.props);
  ctx.lock = Object.assign({}, ctx.lock);
  ['anexar', 'atualizar', 'flush'].forEach((n) => envolver(ctx.io, n));
  ['gravar', 'remover'].forEach((n) => envolver(ctx.props, n));
  envolver(ctx.lock, 'soltar');
  return { chamadas };
}

/** Roda `cmd` instrumentado numa execução própria e devolve {r (resultado de gas.tentar), chamadas}. */
function rodarInstrumentado(amb, cmd, alvo) {
  let inst = null;
  const r = amb.gas.tentar(() => {
    const ctx = amb.ctx();
    inst = instrumentar(amb.gas, ctx, alvo);
    return js(amb.G.UnitOfWork.run(ctx, cmd));
  });
  return { r, chamadas: inst ? inst.chamadas : [] };
}

/** Recuperação instrumentada (recoverAll) numa execução própria. */
function recuperarInstrumentado(amb, alvo) {
  let inst = null;
  const r = amb.gas.tentar(() => {
    const ctx = amb.ctx();
    inst = instrumentar(amb.gas, ctx, alvo);
    return js(amb.G.UnitOfWork.recoverAll(ctx));
  });
  return { r, chamadas: inst ? inst.chamadas : [] };
}

/** Gerador pseudoaleatório determinístico (para escolher subconjuntos de escritas pendentes). */
function aleatorio(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

module.exports = {
  USUARIO, FUSO, PROPRIEDADE, TABELAS_EVENTO,
  js, ambiente, projetorDeTeste, consultaVigentes, cmdEvento, cmdPasto, instrumentar, rodarInstrumentado,
  recuperarInstrumentado, aleatorio,
};
