/**
 * Repository — leitura memoizada por execução, predicado de VIGÊNCIA, índices em memória e plano de escrita.
 * Puro: só fala com a porta de E/S do contexto (ctx.io). Não conhece pecuária.
 *
 * Regra do modelo (P3; 02, seção 5): o que o domínio enxerga são linhas VIGENTES. O acesso cru (linhas como
 * estão na planilha, inclusive inertes) fica no repositório interno, entregue só à UnitOfWork, à recuperação e à
 * verificação de integridade; os tratadores recebem a fachada `publico()`, que não tem acesso cru.
 */
var Repository = (function () {
  var SEP = '\u0000';
  /** Como cada tabela decide se uma linha vale (02, seção 5.2). Tabela fora da lista: FILHA se tem event_id; senão SEMPRE. */
  var REGRAS = Object.freeze({
    EVENTOS: 'EVENTO', AUDITORIA: 'OPERACAO', ANIMAIS: 'ANIMAL', FINANCEIRO: 'FILHA',
    PARCELAS: 'PARCELA', RATEIOS: 'RATEIO', ALOCACOES_FINANCEIRAS: 'ALOCACAO',
  });
  var DEPENDE = Object.freeze({
    EVENTO: ['OPERACOES', 'IMPORTACOES'], OPERACAO: ['OPERACOES'], FILHA: ['EVENTOS'], PARCELA: ['FINANCEIRO'],
    RATEIO: ['FINANCEIRO', 'EVENTOS'], ALOCACAO: ['RATEIOS'], ANIMAL: [], SEMPRE: [],
  });

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function interno_(mensagem) {
    return Validation.erro('INTERNAL', mensagem);
  }
  function mapa_() {
    return Object.create(null);
  }
  function regra(tabela) {
    if (REGRAS[tabela]) return REGRAS[tabela];
    return Schema.temColuna(tabela, 'event_id') ? 'FILHA' : 'SEMPRE';
  }
  /** Fecho das tabelas de que a vigência das pedidas depende (as pedidas vêm primeiro, sem repetição). */
  function dependencias(tabelas) {
    var out = [];
    function inclui(t) {
      if (out.indexOf(t) >= 0) return;
      out.push(t);
      DEPENDE[regra(t)].forEach(inclui);
    }
    (tabelas || []).forEach(function (t) { Schema.tabela(t); inclui(t); });
    return out;
  }

  /**
   * O predicado de vigência, numa função só (P3; 02, seções 5.1 e 5.3). Devolve o status que o cache
   * EVENTOS.status deve ter, se o evento é vigente e quem o anulou.
   * fontes: {operacao(op_id) → linha de OPERACOES ou null, importacao(import_id) → linha de IMPORTACOES ou null,
   *          anuladores(event_id) → eventos cujo reversal_of_event_id aponta para ele}.
   */
  function avaliarEvento(evento, fontes) {
    var op = vazio_(evento.op_id) ? null : fontes.operacao(evento.op_id);
    var status;
    var anulador = null;
    if (!op || (op.status !== 'CONFIRMADA' && op.status !== 'INICIADA')) status = 'FALHOU';
    else if (op.status === 'INICIADA') status = 'PENDENTE';
    else {
      var imp = vazio_(evento.import_id) ? null : fontes.importacao(evento.import_id);
      if (!vazio_(evento.import_id) && imp && imp.status === 'CANCELADO') status = 'CANCELADO';
      else if (!vazio_(evento.import_id) && (!imp || imp.status !== 'IMPORTADO')) status = 'PENDENTE';
      else {
        (fontes.anuladores(evento.event_id) || []).forEach(function (x) {
          var opX = vazio_(x.op_id) ? null : fontes.operacao(x.op_id);
          if (!opX || opX.status !== 'CONFIRMADA') return;
          if (!anulador || (x.event_seq || 0) < (anulador.event_seq || 0)) anulador = x;
        });
        status = anulador ? 'ESTORNADO' : 'CONFIRMADO';
      }
    }
    return { status: status, vigente: status === 'CONFIRMADO' && evento.event_type !== 'ESTORNO', anulador_id: anulador ? anulador.event_id : null };
  }

  function chave_(registro, campos) {
    if (typeof campos === 'string') return vazio_(registro[campos]) ? null : String(registro[campos]);
    var partes = [];
    for (var i = 0; i < campos.length; i++) {
      if (vazio_(registro[campos[i]])) return null;
      partes.push(String(registro[campos[i]]));
    }
    return partes.join(SEP);
  }
  function chaveDe_(valor) {
    if (Array.isArray(valor)) return valor.some(vazio_) ? null : valor.map(String).join(SEP);
    return vazio_(valor) ? null : String(valor);
  }
  function nomeIndice_(campos) {
    return typeof campos === 'string' ? campos : campos.join(SEP);
  }
  function iguais_(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /**
   * Abre o repositório INTERNO de uma execução (memoização por execução: cada aba é lida uma vez).
   * ctx.io é a porta de E/S (Database.abrir). Ver docs/CONTRATOS.md, seção Repository.
   */
  function abrir(ctx) {
    if (!ctx || !ctx.io) throw interno_('Repository.abrir precisa da porta de E/S no contexto.');
    var io = ctx.io;
    var dados = {}; // tabela → {registros, linhas, cabecalho, coercidas: {linha: {coluna: true}}}
    var alertas = [];
    var memo = {}; // derivados das linhas: vigentes, índices, avaliações — refeitos quando algo muda
    var contadores = {};

    function invalidar_() {
      memo = {};
    }
    function carregada(tabela) {
      return Object.prototype.hasOwnProperty.call(dados, tabela);
    }
    /** Lê, numa requisição só, as tabelas pedidas e as de que a vigência delas depende (as já lidas não voltam). */
    function carregar(tabelas) {
      var faltam = dependencias(tabelas).filter(function (t) { return !carregada(t); });
      if (!faltam.length) return;
      var lido = io.ler(faltam);
      faltam.forEach(function (t) {
        var coercidas = {};
        lido[t].alertas.forEach(function (a) {
          alertas.push(a);
          if (a.linha > 1) (coercidas[a.linha] = coercidas[a.linha] || {})[a.coluna] = true;
        });
        dados[t] = { registros: lido[t].registros, linhas: lido[t].linhas, cabecalho: lido[t].cabecalho, coercidas: coercidas };
      });
      invalidar_();
    }
    function tabela_(tabela) {
      if (!carregada(tabela)) throw interno_('A tabela ' + tabela + ' não foi declarada nas leituras (reads) deste comando ou consulta.');
      return dados[tabela];
    }
    function lembrar_(chave, fn) {
      if (!Object.prototype.hasOwnProperty.call(memo, chave)) memo[chave] = fn();
      return memo[chave];
    }
    /** Linhas como estão na planilha, inclusive inertes. Não altere a lista nem os registros. */
    function cru(tabela) {
      return tabela_(tabela).registros;
    }
    function indice_(tabela, campos, soVigentes) {
      return lembrar_('i' + SEP + (soVigentes ? 'v' : 'c') + SEP + tabela + SEP + nomeIndice_(campos), function () {
        var idx = mapa_();
        (soVigentes ? vigentes(tabela) : cru(tabela)).forEach(function (r) {
          var k = chave_(r, campos);
          if (k === null) return;
          (idx[k] = idx[k] || []).push(r);
        });
        return idx;
      });
    }
    function posicoes_(tabela) {
      return lembrar_('p' + SEP + tabela, function () {
        var pk = Schema.pk(tabela);
        var pos = mapa_();
        cru(tabela).forEach(function (r, i) { if (pos[r[pk]] === undefined) pos[r[pk]] = i; }); // chave repetida: vale a primeira
        return pos;
      });
    }
    function cruPorId(tabela, id) {
      var i = vazio_(id) ? undefined : posicoes_(tabela)[id];
      return i === undefined ? null : cru(tabela)[i];
    }
    function cruPor(tabela, campos, valor) {
      var k = chaveDe_(valor);
      return k === null ? [] : (indice_(tabela, campos, false)[k] || []).slice();
    }
    function linhaDe(tabela, id) {
      var i = vazio_(id) ? undefined : posicoes_(tabela)[id];
      return i === undefined ? null : tabela_(tabela).linhas[i];
    }
    function avaliacoes_() {
      return lembrar_('avaliacoes', function () {
        var fontes = {
          operacao: function (id) { return cruPorId('OPERACOES', id); },
          importacao: function (id) { return cruPorId('IMPORTACOES', id); },
          anuladores: function (id) { return indice_('EVENTOS', 'reversal_of_event_id', false)[id] || []; },
        };
        var out = mapa_();
        cru('EVENTOS').forEach(function (e) { if (out[e.event_id] === undefined) out[e.event_id] = avaliarEvento(e, fontes); });
        return out;
      });
    }
    /** {status, vigente, anulador_id} do evento, pelo predicado; null se o evento não existe. */
    function avaliar(eventId) {
      if (vazio_(eventId)) return null;
      return avaliacoes_()[eventId] || null;
    }
    function eventoVigente(eventId) {
      var a = avaliar(eventId);
      return !!a && a.vigente;
    }
    function idsVigentes_(tabela) {
      return lembrar_('s' + SEP + tabela, function () {
        var pk = Schema.pk(tabela);
        var s = mapa_();
        vigentes(tabela).forEach(function (r) { s[r[pk]] = true; });
        return s;
      });
    }
    function rateiosVigentes_() {
      var candidatos = cru('RATEIOS').filter(function (r) { return idsVigentes_('FINANCEIRO')[r.financial_id] && eventoVigente(r.event_id); });
      var melhor = mapa_();
      candidatos.forEach(function (r) {
        var seq = (cruPorId('EVENTOS', r.event_id) || {}).event_seq || 0;
        if (!melhor[r.financial_id] || seq > melhor[r.financial_id].seq) melhor[r.financial_id] = { seq: seq, rateio: r };
      });
      return candidatos.filter(function (r) { return melhor[r.financial_id].rateio === r; });
    }
    /** Linhas VIGENTES da tabela (P3). É o acesso padrão; não altere a lista nem os registros. */
    function vigentes(tabela) {
      return lembrar_('v' + SEP + tabela, function () {
        var linhas = cru(tabela);
        switch (regra(tabela)) {
          case 'SEMPRE': return linhas;
          case 'EVENTO': return linhas.filter(function (r) { return eventoVigente(r.event_id); });
          case 'OPERACAO': return linhas.filter(function (r) { var op = cruPorId('OPERACOES', r.op_id); return !!op && op.status === 'CONFIRMADA'; });
          case 'FILHA': return linhas.filter(function (r) { return vazio_(r.event_id) || eventoVigente(r.event_id); });
          case 'ANIMAL': return linhas.filter(function (r) { return !vazio_(r.situacao_cadastral) && r.situacao_cadastral !== 'PENDENTE' && r.situacao_cadastral !== 'ANULADO'; });
          case 'PARCELA': return linhas.filter(function (r) { return idsVigentes_('FINANCEIRO')[r.financial_id] && r.status !== 'CANCELADA'; });
          case 'RATEIO': return rateiosVigentes_();
          case 'ALOCACAO': return linhas.filter(function (r) { return idsVigentes_('RATEIOS')[r.rateio_id]; });
          default: throw interno_('Regra de vigência desconhecida para ' + tabela + '.');
        }
      });
    }
    /** Linha vigente pela chave primária, ou null. */
    function porId(tabela, id) {
      var k = chaveDe_(id);
      if (k === null) return null;
      var l = indice_(tabela, Schema.pk(tabela), true)[k];
      return l ? l[0] : null;
    }
    /** Linhas vigentes em que `campos` (nome ou lista de nomes) vale `valor` (valor ou lista). Índice múltiplo. */
    function por(tabela, campos, valor) {
      var k = chaveDe_(valor);
      return k === null ? [] : (indice_(tabela, campos, true)[k] || []).slice();
    }
    /** Primeira linha vigente em que `campos` vale `valor`, ou null. Índice único. */
    function unico(tabela, campos, valor) {
      var k = chaveDe_(valor);
      if (k === null) return null;
      var l = indice_(tabela, campos, true)[k];
      return l ? l[0] : null;
    }
    /** Mapa {chave: [linhas vigentes]} inteiro, para percorrer (não altere). Chave composta é unida por '\u0000'. */
    function agrupados(tabela, campos) {
      return indice_(tabela, campos, true);
    }
    /**
     * Próximo número de um contador derivado da planilha (máximo + 1, sob lock): conta TODAS as linhas, inclusive
     * inertes, para o número nunca se repetir. `extrair(valor)` converte o valor em inteiro (ex.: 'A-000123' →
     * 123); o padrão usa o próprio valor. Cada chamada reserva um número novo dentro da execução.
     */
    function contador(tabela, campo, extrair) {
      var k = tabela + SEP + campo;
      if (contadores[k] === undefined) {
        var mx = 0;
        cru(tabela).forEach(function (r) {
          var n = vazio_(r[campo]) ? null : extrair ? extrair(r[campo]) : r[campo];
          if (typeof n === 'number' && isFinite(n) && n > mx) mx = n;
        });
        contadores[k] = mx;
      }
      contadores[k] += 1;
      return contadores[k];
    }
    /** Operações órfãs (06, seção 6): INICIADA, ou CONFIRMADA com aplicada_em vazio. Na ordem da planilha. */
    function operacoesOrfas() {
      return cru('OPERACOES').filter(function (op) {
        return op.status === 'INICIADA' || (op.status === 'CONFIRMADA' && vazio_(op.aplicada_em));
      });
    }
    function celulaCoercida(tabela, linha, coluna) {
      var c = tabela_(tabela).coercidas[linha];
      return !!c && !!c[coluna];
    }
    /**
     * Converte atualizações por chave em escritas por linha, só com o que MUDA: [{tabela, id, campos}] →
     * [{tabela, id, linha, campos}]. Célula marcada como coercida na leitura é regravada mesmo com valor igual.
     * Chave inexistente é erro de programação (INTERNAL); a chave primária nunca é alterada.
     */
    function resolver(atualizacoes) {
      var porLinha = {};
      var saida = [];
      (atualizacoes || []).forEach(function (u) {
        var reg = cruPorId(u.tabela, u.id);
        if (!reg) throw interno_('Não existe ' + u.tabela + ' com a chave ' + u.id + ' para atualizar.');
        var linha = linhaDe(u.tabela, u.id);
        Object.keys(u.campos || {}).forEach(function (campo) {
          if (campo === Schema.pk(u.tabela)) throw interno_('A chave de ' + u.tabela + ' não pode ser alterada.');
          var novo = io.normalizarValor(u.tabela, campo, u.campos[campo]);
          if (iguais_(reg[campo], novo) && !celulaCoercida(u.tabela, linha, campo)) return;
          var k = u.tabela + SEP + linha;
          if (!porLinha[k]) saida.push(porLinha[k] = { tabela: u.tabela, id: u.id, linha: linha, campos: {} });
          porLinha[k].campos[campo] = novo;
        });
      });
      return saida;
    }
    /** Espelha na memória as linhas que acabaram de ser anexadas a partir de `primeiraLinha` (só UnitOfWork). */
    function incluir(tabela, registros, primeiraLinha) {
      var t = tabela_(tabela);
      if (typeof primeiraLinha !== 'number') throw interno_('incluir precisa da linha em que os registros de ' + tabela + ' foram gravados.');
      (registros || []).forEach(function (r, i) {
        t.registros.push(io.normalizar(tabela, r));
        t.linhas.push(primeiraLinha + i);
      });
      invalidar_();
    }
    /** Espelha na memória células que acabaram de ser gravadas (só UnitOfWork). */
    function alterar(tabela, id, campos) {
      var reg = cruPorId(tabela, id);
      if (!reg) throw interno_('Não existe ' + tabela + ' com a chave ' + id + ' para alterar na memória.');
      var coercidas = tabela_(tabela).coercidas[linhaDe(tabela, id)];
      Object.keys(campos).forEach(function (c) {
        reg[c] = io.normalizarValor(tabela, c, campos[c]);
        if (coercidas) delete coercidas[c];
      });
      invalidar_();
    }
    /** Fachada entregue aos tratadores: só linhas vigentes, sem acesso cru e sem mutação. */
    function publico() {
      return {
        vigentes: vigentes, porId: porId, por: por, unico: unico, agrupados: agrupados,
        eventoVigente: eventoVigente, contador: contador, carregada: carregada,
      };
    }
    /**
     * Fachada de leitura CRUA (UnitOfWork, recuperação, projeções da fase C e integridade): a pública mais as
     * linhas como estão na planilha, sem nenhum método que altere a memória.
     */
    function leituraCrua() {
      var f = publico();
      f.cru = cru;
      f.cruPorId = cruPorId;
      f.cruPor = cruPor;
      f.linhaDe = linhaDe;
      f.avaliar = avaliar;
      f.operacoesOrfas = operacoesOrfas;
      f.celulaCoercida = celulaCoercida;
      f.alertas = function () { return alertas.slice(); };
      f.cabecalho = function (tabela) { return tabela_(tabela).cabecalho.slice(); };
      return f;
    }
    return {
      carregar: carregar, carregada: carregada,
      carregadas: function () { return Object.keys(dados); },
      vigentes: vigentes, porId: porId, por: por, unico: unico, agrupados: agrupados,
      eventoVigente: eventoVigente, avaliar: avaliar, contador: contador,
      cru: cru, cruPorId: cruPorId, cruPor: cruPor, linhaDe: linhaDe,
      cabecalho: function (tabela) { return tabela_(tabela).cabecalho.slice(); },
      operacoesOrfas: operacoesOrfas, celulaCoercida: celulaCoercida,
      alertas: function () { return alertas.slice(); },
      resolver: resolver, incluir: incluir, alterar: alterar,
      publico: publico, leituraCrua: leituraCrua,
    };
  }

  /**
   * Plano de escrita de um comando: o que a fase A anexa (linhas inertes e auditoria) e o que a fase C atualiza.
   *   anexar(tabela, registro)        linha nova, na forma da lógica (fase A);
   *   auditar(mudanca)                mudança fora de evento: vira linha de AUDITORIA na fase A e é aplicada na C;
   *   atualizar(tabela, id, campos)   células derivadas (só o projetor, na fase C).
   */
  function plano() {
    var anexos = {};
    var mudancas = [];
    var atualizacoes = [];
    var p = {
      anexar: function (tabela, registro) {
        Schema.tabela(tabela);
        if (!registro || typeof registro !== 'object' || Array.isArray(registro)) throw interno_('plano.anexar precisa de um registro de ' + tabela + '.');
        (anexos[tabela] = anexos[tabela] || []).push(registro);
        return p;
      },
      auditar: function (mudanca) {
        if (!mudanca || typeof mudanca !== 'object') throw interno_('plano.auditar precisa de uma mudança.');
        mudancas.push(mudanca);
        return p;
      },
      atualizar: function (tabela, id, campos) {
        Schema.tabela(tabela);
        if (vazio_(id) || !campos || typeof campos !== 'object') throw interno_('plano.atualizar precisa da chave e dos campos de ' + tabela + '.');
        atualizacoes.push({ tabela: tabela, id: id, campos: campos });
        return p;
      },
      /** {TABELA: [registros]} a anexar, na ordem em que as tabelas apareceram. */
      linhas: function () { return anexos; },
      mudancas: function () { return mudancas; },
      atualizacoes: function () { return atualizacoes; },
      /** {TABELA: quantidade de linhas a anexar}. */
      contagem: function () {
        var c = {};
        Object.keys(anexos).forEach(function (t) { c[t] = anexos[t].length; });
        return c;
      },
      vazio: function () { return !Object.keys(anexos).length && !mudancas.length && !atualizacoes.length; },
    };
    return p;
  }

  return {
    REGRAS: REGRAS,
    regra: regra,
    dependencias: dependencias,
    avaliarEvento: avaliarEvento,
    abrir: abrir,
    plano: plano,
  };
})();
