'use strict';
/**
 * Apoio aos testes de operação do sistema (setup, manutenção, integridade, arquivos, importação): o banco nasce pelo
 * próprio Maintenance.setup (pastas, planilha pelo Drive, abas, sementes, SCHEMA_META, gatilhos, proteção), e o
 * contexto de execução tem as portas reais (Database, FileService, Timeline) sobre os fakes do harness.
 * Não é arquivo de teste.
 */
const assert = require('node:assert/strict');
const { createGas } = require('./harness');

const USUARIO = 'dono@gmail.com';
const FUSO = 'America/Porto_Velho';
const D0 = '2026-01-01';

function js(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
function id(n) {
  return 'eeeeeeee-0000-4000-8000-' + n.toString(16).padStart(12, '0');
}
const PROP = id(1);
const PASTOS = { A: id(0xa1), B: id(0xa2) };

/** Estado de erro comparável: {code, message, details}. */
function erroDe(r) {
  if (r.ok) return null;
  const e = r.erro || {};
  return { code: e.code || 'EXCECAO', message: e.message, details: js(e.details || []), relatorio: js(e.relatorio) };
}

/**
 * Sistema configurado pelo setup. opcoes: {order, gas, semCadastro (sem propriedade, pastos e marco zero),
 * config: {chave: valor texto}}. Devolve helpers.
 */
function sistema(opcoes) {
  const o = opcoes || {};
  const gas = o.gas || createGas({ order: o.order || 'alpha' });
  const G = gas.G;
  const rel = js(gas.exec(() => G.Maintenance.setup({ usuario: USUARIO })));
  const props = () => Object.fromEntries(gas.props.script._data);
  const s = {
    gas, G, setup: rel,
    banco: () => props().SPREADSHEET_ID,
    primitiva: () => props().IO_PRIMITIVE,
    props,
    ctx: (extra) => G.Database.contexto(Object.assign({
      banco: s.banco(), primitiva: s.primitiva(), usuario: USUARIO, fuso: FUSO, files: G.FileService.porta(), projecoes: G.Timeline.porta(),
    }, extra || {})),
    /** Roda fn(ctx) numa execução; devolve o valor (js) ou lança. */
    exec: (fn) => js(gas.exec(() => fn(s.ctx()))),
    /** Roda fn(ctx) numa execução sem lançar: {ok, valor, erro: {code, message, details}, morta}. */
    tentar: (fn) => { const r = gas.tentar(() => js(fn(s.ctx()))); return { ok: r.ok, valor: r.valor, erro: erroDe(r), morta: r.morta }; },
    read: (q) => s.exec((ctx) => G.UnitOfWork.read(ctx, q)).dados,
    tabela: (aba, banco) => js(gas.exec(() => G.Database.abrir(banco || s.banco(), { primitiva: s.primitiva() }).ler([aba])[aba].registros)),
    evento: (acao, dados, chave, avisos) => s.exec((ctx) => G.EventService[acao](ctx, { idempotencyKey: chave || 'ev-' + Math.random(), dados, avisosAceitos: avisos || [] })),
    integridade: () => s.exec((ctx) => G.AuditService.verificarIntegridade(ctx)).dados,
    conferirProjecoes: (msg) => {
      const dif = s.read({ rota: 'teste.projecoes', reads: G.Timeline.LEITURAS, acessoCru: true, tratador: (tx) => G.Timeline.conferir(tx) });
      assert.deepEqual(dif, [], 'projeção gravada = reconstrução (' + (msg || '') + ')');
    },
    /** Número da linha (planilha) do registro e o índice (1) da coluna, para editar à mão. */
    posicao: (aba, idReg, coluna) => {
      const cab = gas.planilhas.matriz(s.banco(), aba)[0];
      const pk = G.Schema.pk(aba);
      const m = gas.planilhas.matriz(s.banco(), aba);
      const ip = cab.indexOf(pk);
      const linha = m.findIndex((l, i) => i > 0 && l[ip] === idReg) + 1;
      assert.ok(linha > 1, 'registro ' + idReg + ' em ' + aba);
      return { linha, coluna: cab.indexOf(coluna) + 1, cabecalho: cab };
    },
    /** Grava um valor cru numa célula (edição à mão, sem coerção). */
    editar: (aba, idReg, coluna, valor) => {
      const p = s.posicao(aba, idReg, coluna);
      assert.ok(p.coluna > 0, 'coluna ' + coluna);
      gas.planilhas.gravar(s.banco(), aba, p.linha, p.coluna, [[valor]]);
    },
    /** Apaga a linha do registro (fica em branco: a leitura pula). */
    apagarLinha: (aba, idReg) => {
      const p = s.posicao(aba, idReg, G.Schema.pk(aba));
      gas.planilhas.gravar(s.banco(), aba, p.linha, 1, [p.cabecalho.map(() => '')]);
    },
  };
  if (!o.semCadastro) cadastrar(s, o.config || {});
  return s;
}

/** Propriedade, dois pastos e o marco zero, por um comando auditado (como a tela de cadastros fará). */
function cadastrar(s, config) {
  const G = s.G;
  const conf = Object.assign({ data_marco_zero: D0, propriedade_padrao_id: PROP }, config);
  s.exec((ctx) => G.UnitOfWork.run(ctx, {
    rota: 'teste.cadastro', idempotencyKey: 'cadastro-inicial', dados: conf, reads: ['PROPRIEDADES', 'PASTOS', 'CONFIGURACOES'],
    tratador: (tx) => {
      G.AuditService.criacao(tx, 'PROPRIEDADES', PROP, { nome: 'Fazenda Boa Vista', status: 'ATIVO' });
      G.AuditService.criacao(tx, 'PASTOS', PASTOS.A, { property_id: PROP, nome: 'Pasto A', posse: 'PROPRIO', status: 'ATIVO' });
      G.AuditService.criacao(tx, 'PASTOS', PASTOS.B, { property_id: PROP, nome: 'Pasto B', identificacao: 'P-B', posse: 'PROPRIO', status: 'ATIVO' });
      Object.keys(conf).forEach((k) => G.AuditService.alteracao(tx, 'CONFIGURACOES', k, { valor: conf[k] }));
      return { resumo: { ok: true } };
    },
  }));
}

/** Animal novo para ENTRADA_INICIAL, com o mínimo obrigatório. */
function bicho(extra) {
  const a = Object.assign({ sexo: 'F', origem: 'DESCONHECIDA', pasto_destino_id: PASTOS.A }, extra || {});
  if (a.sexo === 'M') {
    if (a.castrado === undefined) a.castrado = false;
    if (a.reprodutor === undefined) a.reprodutor = false;
  }
  return a;
}
function entradaInicial(animais, campos) {
  return { tipo: 'ENTRADA_INICIAL', campos: Object.assign({}, campos || {}), animais };
}
function codigos(erro) {
  return (erro && erro.details ? erro.details : []).map((d) => d.codigo);
}
/** Checagens com achados no relatório de integridade: {codigo: situacao}. */
function situacoes(rel) {
  const out = {};
  rel.checagens.forEach((c) => { if (c.situacao !== 'OK' && c.situacao !== 'NAO_EXECUTADA') out[c.codigo] = c.situacao; });
  return out;
}

module.exports = { USUARIO, FUSO, D0, PROP, PASTOS, js, id, sistema, cadastrar, bicho, entradaInicial, codigos, situacoes, erroDe };
