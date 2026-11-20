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
  /**
   * Campos que decidem a vigência de linhas de OUTRAS abas (o predicado de 02, seção 5.3): mudar um deles refaz toda a
   * memória da execução; mudar os demais refaz só a da própria aba (a situação do animal, a da parcela e os índices são da
   * própria aba).
   */
  var CAMPOS_DA_VIGENCIA = Object.freeze({
    OPERACOES: ['status'], IMPORTACOES: ['status'], EVENTOS: ['event_id', 'op_id', 'import_id', 'reversal_of_event_id', 'event_type', 'event_seq'],
    FINANCEIRO: ['financial_id', 'event_id'], RATEIOS: ['rateio_id', 'financial_id', 'event_id'],
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
    return abrir_(ctx, null);
  }
  /**
   * `base` (só de `bifurcar`): as abas já lidas de outro repositório, compartilhadas linha a linha, com CÓPIA NA ESCRITA —
   * o retrato em memória da trava de integridade (UnitOfWork) muda as suas linhas sem tocar nas do repositório de origem
   * e não lê a planilha (aba que faltava antes do retrato é erro de programação).
   */
  function abrir_(ctx, base) {
    if (!ctx || !ctx.io) throw interno_('Repository.abrir precisa da porta de E/S no contexto.');
    var io = ctx.io;
    var dados = base ? base.dados : {}; // tabela → {registros, linhas, cabecalho, coercidas: {linha: {coluna: true}}}
    var alertas = base ? base.alertas : [];
    var retrato = !!base;
    var proprias = {}; // retrato: tabela → {índice: true} das linhas já copiadas (as demais são do repositório de origem)
    var memo = {}; // derivados das linhas: vigentes, índices, avaliações — refeitos quando algo muda
    var contadores = {};

    function invalidar_() {
      memo = {};
    }
    /**
     * Depois de mudar células de uma aba: só a memória dela (índices, vigentes, chaves vigentes) é refeita, salvo quando o
     * campo mudado decide a vigência de outras abas (CAMPOS_DA_VIGENCIA): aí tudo. As posições não mudam.
     */
    function invalidarAba_(tabela, campos) {
      var gatilho = CAMPOS_DA_VIGENCIA[tabela];
      if (gatilho && campos.some(function (c) { return gatilho.indexOf(c) >= 0; })) { invalidar_(); return; }
      Object.keys(memo).forEach(function (k) {
        var p = k.split(SEP);
        if ((p[0] === 'i' && p[2] === tabela) || ((p[0] === 'v' || p[0] === 's') && p[1] === tabela)) delete memo[k];
      });
    }
    function carregada(tabela) {
      return Object.prototype.hasOwnProperty.call(dados, tabela);
    }
    /** Lê, numa requisição só, as tabelas pedidas e as de que a vigência delas depende (as já lidas não voltam). */
    function carregar(tabelas) {
      var faltam = dependencias(tabelas).filter(function (t) { return !carregada(t); });
      if (!faltam.length) return;
      if (retrato) throw interno_('O retrato em memória só tem as abas lidas antes dele; faltaram ' + faltam.join(', ') + '.');
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
    /**
     * A posição de um evento entre os rateios do mesmo lançamento (desenho-base 16.1): o `event_seq` do primeiro evento da
     * cadeia de substituição (a correção ocupa o lugar do original), depois o próprio `event_seq`.
     */
    function ordemDaCadeia_(ev) {
      var atual = ev;
      for (var guarda = 0; guarda < 10000; guarda++) {
        if (vazio_(atual.reversal_of_event_id) || atual.event_type === 'ESTORNO') break;
        var alvo = cruPorId('EVENTOS', atual.reversal_of_event_id);
        if (!alvo || alvo.event_type !== atual.event_type) break;
        atual = alvo;
      }
      return atual.event_seq || 0;
    }
    /**
     * Os rateios de cada lançamento que vale, de evento vigente (o do próprio evento de negócio e os dos eventos RATEIO), na
     * ordem em que um substitui o outro: {financial_id: [{rateio, data (event_date do evento), ord, seq}]}.
     */
    function candidatosRateio_() {
      return lembrar_('v' + SEP + 'RATEIOS' + SEP + 'candidatos', function () {
        var porLanc = mapa_();
        cru('RATEIOS').forEach(function (r) {
          if (!idsVigentes_('FINANCEIRO')[r.financial_id] || !eventoVigente(r.event_id)) return;
          var ev = cruPorId('EVENTOS', r.event_id) || {};
          (porLanc[r.financial_id] = porLanc[r.financial_id] || []).push({ rateio: r, data: ev.event_date, ord: ordemDaCadeia_(ev), seq: ev.event_seq || 0 });
        });
        Object.keys(porLanc).forEach(function (fid) { porLanc[fid].sort(function (a, b) { return a.ord - b.ord || a.seq - b.seq; }); });
        return porLanc;
      });
    }
    /**
     * O rateio vigente de um lançamento numa data (03b, seção 12.1; 07, seção 3.4; CONTRATOS, seção 57): entre os rateios de
     * evento vigente com `event_date` até `data`, o último na ordem da cadeia (o re-rateio substitui o anterior; a correção de
     * um rateio fica no lugar dele). Sem `data`, o de hoje — o mesmo predicado de `vigentes('RATEIOS')`. null sem rateio.
     */
    function rateioEm(financialId, data) {
      var lista = vazio_(financialId) ? null : candidatosRateio_()[financialId];
      if (!lista) return null;
      var achado = null;
      lista.forEach(function (c) { if (vazio_(data) || (!vazio_(c.data) && c.data <= data)) achado = c.rateio; });
      return achado;
    }
    /**
     * As alocações do rateio que valia no lançamento numa data (`rateioEm`): o que coube a cada animal naquele dia — o re-rateio
     * de depois não muda o número pedido nela (regra de tempo; CONTRATOS, seção 57.2). Sem data, as de hoje. [] sem rateio.
     */
    function alocacoesEm(financialId, data) {
      var r = rateioEm(financialId, data);
      return r ? cruPor('ALOCACOES_FINANCEIRAS', 'rateio_id', r.rateio_id) : [];
    }
    /** Os rateios de evento vigente de um lançamento que vale, na ordem em que um substitui o outro (o histórico do rateio). */
    function rateiosDoLancamento(financialId) {
      var lista = vazio_(financialId) ? null : candidatosRateio_()[financialId];
      return (lista || []).map(function (c) { return c.rateio; });
    }
    function rateiosVigentes_() {
      var porLanc = candidatosRateio_();
      var vale = mapa_();
      Object.keys(porLanc).forEach(function (fid) { var l = porLanc[fid]; vale[l[l.length - 1].rateio.rateio_id] = true; });
      return cru('RATEIOS').filter(function (r) { return vale[r.rateio_id] === true; });
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
    /**
     * Espelha na memória as linhas que acabaram de ser anexadas a partir de `primeiraLinha` (só UnitOfWork). No retrato,
     * sem `primeiraLinha`, as linhas entram depois da última (não há linha de planilha: nada dali é gravado).
     */
    function incluir(tabela, registros, primeiraLinha) {
      var t = tabela_(tabela);
      var inicio = primeiraLinha;
      if (typeof inicio !== 'number') {
        if (!retrato) throw interno_('incluir precisa da linha em que os registros de ' + tabela + ' foram gravados.');
        inicio = 2;
        t.linhas.forEach(function (n) { if (n >= inicio) inicio = n + 1; });
      }
      (registros || []).forEach(function (r, i) {
        t.registros.push(io.normalizar(tabela, r));
        t.linhas.push(inicio + i);
      });
      invalidar_();
    }
    /** Espelha na memória células que acabaram de ser gravadas (só UnitOfWork). No retrato, a linha é copiada antes da 1ª mudança. */
    function alterar(tabela, id, campos) {
      var i = vazio_(id) ? undefined : posicoes_(tabela)[id];
      if (i === undefined) throw interno_('Não existe ' + tabela + ' com a chave ' + id + ' para alterar na memória.');
      var t = tabela_(tabela);
      var reg = t.registros[i];
      if (retrato && !(proprias[tabela] && proprias[tabela][i])) {
        var copia = {};
        Object.keys(reg).forEach(function (k) { copia[k] = reg[k]; });
        t.registros[i] = reg = copia;
        (proprias[tabela] = proprias[tabela] || {})[i] = true;
      }
      var coercidas = t.coercidas[t.linhas[i]];
      Object.keys(campos).forEach(function (c) {
        reg[c] = io.normalizarValor(tabela, c, campos[c]);
        if (coercidas) delete coercidas[c];
      });
      invalidarAba_(tabela, Object.keys(campos));
    }
    /**
     * Retrato em memória (trava de integridade): um repositório novo com as abas JÁ lidas, que compartilha as linhas com
     * este e as copia antes de mudar (`incluir`/`alterar` no retrato não tocam neste). Não lê a planilha nem grava nada.
     */
    function bifurcar() {
      var copia = {};
      Object.keys(dados).forEach(function (t) {
        copia[t] = { registros: dados[t].registros.slice(), linhas: dados[t].linhas.slice(), cabecalho: dados[t].cabecalho, coercidas: {} };
      });
      return abrir_(ctx, { dados: copia, alertas: alertas.slice() });
    }
    /** Fachada entregue aos tratadores: só linhas vigentes, sem acesso cru e sem mutação. */
    function publico() {
      return {
        vigentes: vigentes, porId: porId, por: por, unico: unico, agrupados: agrupados,
        eventoVigente: eventoVigente, contador: contador, carregada: carregada,
        rateioEm: rateioEm, rateiosDoLancamento: rateiosDoLancamento, alocacoesEm: alocacoesEm,
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
      rateioEm: rateioEm, rateiosDoLancamento: rateiosDoLancamento, alocacoesEm: alocacoesEm,
      cru: cru, cruPorId: cruPorId, cruPor: cruPor, linhaDe: linhaDe,
      cabecalho: function (tabela) { return tabela_(tabela).cabecalho.slice(); },
      operacoesOrfas: operacoesOrfas, celulaCoercida: celulaCoercida,
      alertas: function () { return alertas.slice(); },
      resolver: resolver, incluir: incluir, alterar: alterar, bifurcar: bifurcar,
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
