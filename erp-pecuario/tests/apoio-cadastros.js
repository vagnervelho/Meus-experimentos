'use strict';
/**
 * Apoio aos testes dos serviços de cadastro e consulta (config, animals, pastures, inventory): o banco semeado e o
 * projetor real de apoio-eventos, mais um invólucro para os comandos sem evento (pedido → fábrica de comando →
 * UnitOfWork.run) que confere, depois de CADA comando, a projeção gravada × reconstrução. Não é arquivo de teste.
 */
const E = require('./apoio-eventos');

const { js } = E;

function erroDe(r) {
  if (r.ok) return null;
  const e = r.erro || {};
  return { code: e.code || 'EXCECAO', message: e.message, details: js(e.details || []) };
}

/** Ambiente: o de apoio-eventos (opções iguais) + `cmd`, `tentar`, `run`, `ler`, `auditoria`, `fabricas`. */
function ambienteCadastros(opcoes) {
  const m = E.ambienteEventos(opcoes);
  const G = m.G;
  let n = 0;
  const c = {
    m, G, amb: m.amb, gas: m.gas,
    pedido(dados, op) {
      const o = op || {};
      return { idempotencyKey: o.chave || 'cad-' + (++n), dados, avisosAceitos: o.avisos || [], dataVersionEsperada: o.dataVersion };
    },
    /** fabrica: nome 'Modulo.funcao' (ex.: 'Config.comandoSalvar'). Nunca lança: {ok, valor, erro, morta}. */
    tentar(fabrica, dados, op) {
      const partes = fabrica.split('.');
      const r = m.amb.tentarRun(G[partes[0]][partes[1]](c.pedido(dados, op)));
      m.conferirProjecoes('depois de ' + fabrica);
      return { ok: r.ok, valor: r.ok ? r.valor : null, erro: erroDe(r), morta: r.morta };
    },
    run(fabrica, dados, op) {
      const r = c.tentar(fabrica, dados, op);
      if (!r.ok) {
        const e = new Error('comando falhou: ' + r.erro.code + ' ' + r.erro.message + ' ' + JSON.stringify(r.erro.details));
        e.erro = r.erro;
        throw e;
      }
      return r.valor;
    },
    /** Consulta pronta ({rota, reads, tratador}) pela leitura validada; devolve os dados. */
    ler(q) {
      return m.ler(q);
    },
    /** Leitura ad hoc: tratador(tx, G) sobre as abas dadas. */
    lerCom(reads, tratador, acessoCru) {
      return m.ler({ rota: 'teste.leitura', reads, acessoCru: !!acessoCru, tratador: (tx) => tratador(tx, G) });
    },
    auditoria: (filtro) => m.tabela('AUDITORIA').filter((l) => Object.keys(filtro || {}).every((k) => l[k] === filtro[k])),
    tabela: (aba) => m.tabela(aba),
  };
  return c;
}

function codigos(erro) {
  return (erro && erro.details ? erro.details : []).map((d) => d.codigo);
}

module.exports = Object.assign({}, E, { ambienteCadastros, codigos, erroDe });
