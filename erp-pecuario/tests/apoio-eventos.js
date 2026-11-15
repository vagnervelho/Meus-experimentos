'use strict';
/**
 * Apoio aos testes do motor de eventos (timeline.test.js, events.test.js): banco semeado (propriedade, pastos,
 * configurações, listas, plano de contas e categorias), o projetor REAL (Timeline.porta) na fase C e um invólucro
 * que, depois de CADA comando (com sucesso ou não), confere que a projeção gravada é a reconstrução pelos eventos
 * vigentes (Timeline.conferir). Não é arquivo de teste.
 */
const assert = require('node:assert/strict');
const A = require('./apoio-persistencia');

const { js } = A;
const PROP = A.PROPRIEDADE;
const D0 = '2026-01-01';
const HOJE = '2026-11-13';
const AGORA = '2026-11-13T14:00:00.000Z';

function id(n) {
  return 'ffffffff-0000-4000-8000-' + n.toString(16).padStart(12, '0');
}
const PASTOS = { A: id(0xa1), B: id(0xa2), C: id(0xa3), INATIVO: id(0xa4), PEQUENO: id(0xa5) };
const NOMES_PASTO = { A: 'Pasto A', B: 'Pasto B', C: 'Pasto C', INATIVO: 'Velho', PEQUENO: 'Piquete' };

/** Linhas de semente na forma da lógica. opcoes: {marcoZero (null = sem marco zero), config: {chave: texto}, categorias}. */
function sementes(G, opcoes) {
  const o = opcoes || {};
  const S = G.Schema.SEMENTES;
  const sobre = Object.assign({ data_marco_zero: o.marcoZero === undefined ? D0 : o.marcoZero, propriedade_padrao_id: PROP }, o.config || {});
  let n = 0x1000;
  const CONFIGURACOES = S.CONFIGURACOES.map((s) => ({
    chave: s.chave, valor: Object.prototype.hasOwnProperty.call(sobre, s.chave) ? sobre[s.chave] : s.padrao || null,
    tipo: s.tipo, grupo: s.grupo, descricao: s.descricao, updated_at: AGORA,
  }));
  const LISTAS = [];
  Object.keys(G.Schema.LISTAS_SEMENTE).forEach((lista) => G.Schema.LISTAS_SEMENTE[lista].forEach((x) => {
    LISTAS.push({ lista_id: id(n++), lista, codigo: x.codigo, rotulo: x.rotulo, ordem: x.ordem, ativo: true });
  }));
  const PLANO_CONTAS = S.PLANO_CONTAS.map((c) => Object.assign({ conta_id: id(n++) }, js(c)));
  const CATEGORIAS = (o.categorias || S.CATEGORIAS).map((c) => Object.assign({ category_id: id(n++) }, js(c)));
  const PASTOS_ = Object.keys(PASTOS).map((k) => ({
    pasture_id: PASTOS[k], property_id: PROP, nome: NOMES_PASTO[k], posse: 'PROPRIO', status: k === 'INATIVO' ? 'INATIVO' : 'ATIVO',
    capacidade_estimada_cabecas: k === 'PEQUENO' ? 2 : null, created_at: AGORA, updated_at: AGORA,
  }));
  return {
    PROPRIEDADES: [{ property_id: PROP, nome: 'Fazenda Boa Vista', status: 'ATIVO', created_at: AGORA, updated_at: AGORA }],
    PASTOS: PASTOS_, CONFIGURACOES, LISTAS, PLANO_CONTAS, CATEGORIAS,
  };
}

/** Ambiente com o projetor real e o banco semeado. opcoes: {primitiva, order, marcoZero, config, categorias}. */
function ambienteEventos(opcoes) {
  const o = opcoes || {};
  const amb = A.ambiente({ primitiva: o.primitiva, order: o.order, projecoes: (G) => G.Timeline.porta(), propriedade: false });
  const G = amb.G;
  const linhas = sementes(G, o);
  amb.gas.exec(() => G.Database.abrir(amb.banco, { primitiva: amb.primitiva }).anexar(linhas));
  return motor(amb, linhas);
}

function erroDe(r) {
  if (r.ok) return null;
  const e = r.erro || {};
  return { code: e.code || 'EXCECAO', message: e.message, details: js(e.details || []) };
}

function motor(amb, linhas) {
  const G = amb.G;
  let n = 0;
  const m = {
    amb, G, gas: amb.gas, linhas,
    categorias: linhas.CATEGORIAS,
    comando(acao, dados, op) {
      const o = op || {};
      return G.EventService.comando(acao, {
        idempotencyKey: o.chave || 'chave-' + (++n), dados, avisosAceitos: o.avisos || [], dataVersionEsperada: o.dataVersion, modo: o.modo,
      });
    },
    /** Executa e confere a projeção; relança o erro do comando. */
    run(acao, dados, op) {
      const r = m.tentar(acao, dados, op);
      if (!r.ok) {
        const e = new Error('comando falhou: ' + r.erro.code + ' ' + r.erro.message + ' ' + JSON.stringify(r.erro.details));
        e.erro = r.erro;
        throw e;
      }
      return r.valor;
    },
    /** Executa sem lançar: {ok, valor, erro: {code, message, details}}; confere a projeção depois. */
    tentar(acao, dados, op) {
      const r = amb.tentarRun(m.comando(acao, dados, op));
      m.conferirProjecoes('depois de ' + acao + (dados && dados.tipo ? ' ' + dados.tipo : ''));
      return { ok: r.ok, valor: r.ok ? r.valor : null, erro: erroDe(r), morta: r.morta };
    },
    simular(acao, dados, op) {
      const r = amb.gas.tentar(() => js(G.EventService.simular(amb.ctx(), { acao, dados, avisosAceitos: (op && op.avisos) || [] })));
      m.conferirProjecoes('depois da simulação');
      return { ok: r.ok, valor: r.ok ? r.valor : null, erro: erroDe(r) };
    },
    /** Projeção gravada = reconstrução (Timeline.conferir) e as invariantes financeiras de 03b, seção 14 (FinancialService.conferir). */
    conferirProjecoes(msg) {
      const r = amb.read({ rota: 'teste.projecoes', reads: G.FinancialService.leituras(), acessoCru: true, tratador: (tx) => ({ proj: G.Timeline.conferir(tx), fin: G.FinancialService.conferir(tx) }) }).dados;
      assert.deepEqual(r.proj, [], 'projeção gravada = reconstrução pelos eventos vigentes (' + (msg || '') + ')');
      assert.deepEqual(r.fin, [], 'invariantes financeiras de 03b, seção 14 (' + (msg || '') + ')');
    },
    /** Só as invariantes financeiras (03b, seção 14): [{invariante, tabela, id, mensagem}]. */
    invariantes() {
      return amb.read({ rota: 'teste.invariantes', reads: G.FinancialService.leituras(), acessoCru: true, tratador: (tx) => G.FinancialService.conferir(tx) }).dados;
    },
    ler(consulta) {
      return amb.read(consulta).dados;
    },
    tabela: (aba) => amb.tabela(aba),
    animal: (idAnimal) => amb.tabela('ANIMAIS').find((a) => a.animal_id === idAnimal),
    porBrinco: (b) => amb.tabela('ANIMAIS').find((a) => a.brinco === b),
    evento: (idEv) => amb.tabela('EVENTOS').find((e) => e.event_id === idEv),
    listar: (f) => m.ler(G.EventService.consultaListar(f || {})),
    obter: (idEv) => m.ler(G.EventService.consultaObter({ event_id: idEv })),
    inventario: (data) => m.ler(G.Timeline.consultaInventario({ data })),
    pastoEm: (idAnimal, data) => m.ler(G.Timeline.consultaInventario({ data, animal_id: idAnimal })),
    contagem: () => {
      const l = amb.lido(['EVENTOS', 'EVENTO_ANIMAIS', 'ANIMAIS', 'IDENTIFICACOES', 'PESAGENS', 'REPRODUCAO', 'AJUSTES', 'FINANCEIRO', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'OPERACOES']);
      const c = {};
      Object.keys(l).forEach((k) => { c[k] = l[k].registros.length; });
      return c;
    },
  };
  return m;
}

/** Animal novo para ENTRADA_INICIAL / OUTRA_ENTRADA, com o mínimo obrigatório. */
function bicho(extra) {
  const base = { sexo: 'F', origem: 'DESCONHECIDA', pasto_destino_id: PASTOS.A };
  const a = Object.assign(base, extra || {});
  if (a.sexo === 'M') {
    if (a.castrado === undefined) a.castrado = false;
    if (a.reprodutor === undefined) a.reprodutor = false;
  }
  return a;
}
function entradaInicial(animais, campos) {
  return { tipo: 'ENTRADA_INICIAL', campos: Object.assign({}, campos || {}), animais };
}
function outraEntrada(data, animais, campos) {
  return { tipo: 'OUTRA_ENTRADA', campos: Object.assign({ event_date: data, description: 'Doação do vizinho' }, campos || {}), animais };
}
function ajuste(subtipo, data, animais, campos) {
  return { tipo: 'AJUSTE_INVENTARIO', subtipo, campos: Object.assign({ event_date: data, justificativa: 'Conferência no curral' }, campos || {}), animais };
}
function codigos(erro) {
  return (erro && erro.details ? erro.details : []).map((d) => d.codigo);
}

module.exports = { D0, HOJE, PROP, PASTOS, id, js, ambienteEventos, bicho, entradaInicial, outraEntrada, ajuste, codigos, sementes };
