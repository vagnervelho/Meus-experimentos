/**
 * Leitura do Gmail exclusivamente pelo serviço avançado (Gmail API v1, escopo
 * gmail.readonly). Nunca usa GmailApp (que exige acesso total à caixa).
 *
 * O gargalo é a quota por usuário (6.000 unidades/min em projetos novos;
 * messages.get full = 60 unidades), não a latência — por isso as chamadas são
 * sequenciais, passando por um limitador de unidades por minuto.
 */
var GmailClient = (function () {
  var UNITS = { profile: 1, historyList: 2, messagesList: 5, getFull: 60, getMetadata: 20, getMinimal: 20 };
  var HISTORY_TYPES = ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'];
  var METADATA_HEADERS = ['From', 'To', 'Cc', 'Reply-To', 'Subject', 'Date', 'Message-ID', 'In-Reply-To', 'References',
    'List-Unsubscribe', 'List-Id', 'Precedence', 'Auto-Submitted', 'Authentication-Results', 'Feedback-ID', 'Content-Type'];

  // --------------------------------------------------------- limitador ----
  /**
   * Limitador de unidades por janela de 1 minuto. Em erro de taxa, reduz a meta
   * em 25% e espera a virada do minuto (a quota é por minuto).
   */
  function createLimiter(unitsPerMinute) {
    var state = { windowStart: Util.now(), used: 0, target: unitsPerMinute, total: 0, waits: 0 };
    function rollIfNeeded_() {
      if (Util.now() - state.windowStart >= 60000) {
        state.windowStart = Util.now();
        state.used = 0;
      }
    }
    return {
      /** Reserva unidades; dorme até a próxima janela se necessário. Retorna false se o orçamento acabar. */
      spend: function (units, budget) {
        rollIfNeeded_();
        if (state.used + units > state.target) {
          var waitMs = 60000 - (Util.now() - state.windowStart) + 250;
          if (budget && !budget.hasTime(waitMs + 30000)) return false;
          Utilities.sleep(Math.max(0, waitMs));
          state.waits++;
          state.windowStart = Util.now();
          state.used = 0;
        }
        state.used += units;
        state.total += units;
        return true;
      },
      penalize: function (budget) {
        state.target = Math.max(300, Math.floor(state.target * 0.75));
        var waitMs = 60000 - (Util.now() - state.windowStart) + 1000;
        if (budget && !budget.hasTime(waitMs + 30000)) return false;
        Utilities.sleep(Math.max(1000, waitMs));
        state.windowStart = Util.now();
        state.used = 0;
        return true;
      },
      stats: function () {
        return { unitsUsed: state.total, target: state.target, waits: state.waits };
      },
    };
  }

  // ------------------------------------------------------- erros ----
  function isNotFound_(e) {
    return Util.errorCode(e) === 404 || /not found|requested entity was not found/i.test(String(e && e.message));
  }
  function isRateLimit_(e) {
    var code = Util.errorCode(e);
    return code === 429 || /rate ?limit|quota exceeded|too many (concurrent )?requests|userRateLimitExceeded/i.test(String(e && e.message));
  }
  function isAuthError_(e) {
    var code = Util.errorCode(e);
    return code === 401 || /authoriz|permission|insufficient|forbidden/i.test(String(e && e.message)) && !isRateLimit_(e);
  }

  /** Executa uma chamada com retry: taxa → espera a virada do minuto; 5xx → backoff. */
  function call_(fn, units, limiter, budget) {
    if (limiter && !limiter.spend(units, budget)) {
      var b = Util.appError('BUDGET', 'Orçamento de tempo esgotado antes da chamada ao Gmail.');
      throw b;
    }
    for (var attempt = 1; attempt <= 3; attempt++) {
      try {
        return fn();
      } catch (e) {
        if (isNotFound_(e) || isAuthError_(e) || attempt === 3) throw e;
        if (isRateLimit_(e)) {
          if (!limiter || !limiter.penalize(budget)) throw e;
          continue;
        }
        if (!Util.isTransientError(e)) throw e;
        Utilities.sleep(Util.backoffMs(attempt, 1000, 8000));
      }
    }
    return null;
  }

  // ------------------------------------------------------------- API ----
  function profile(limiter, budget) {
    var p = call_(function () {
      return Gmail.Users.getProfile('me');
    }, UNITS.profile, limiter, budget);
    return { emailAddress: String(p.emailAddress || '').toLowerCase(), historyId: String(p.historyId || '') };
  }

  /**
   * Uma página do histórico. Lança erro com code 'HISTORY_EXPIRED' em 404
   * (o historyId ficou velho demais: é preciso resync por janela).
   */
  function historyPage(startHistoryId, pageToken, limiter, budget) {
    try {
      var args = { startHistoryId: String(startHistoryId), historyTypes: HISTORY_TYPES, maxResults: 500 };
      if (pageToken) args.pageToken = pageToken;
      var r = call_(function () {
        return Gmail.Users.History.list('me', args);
      }, UNITS.historyList, limiter, budget);
      return { history: r.history || [], nextPageToken: r.nextPageToken || '', historyId: String(r.historyId || '') };
    } catch (e) {
      if (isNotFound_(e)) {
        var x = Util.appError('HISTORY_EXPIRED', 'Histórico do Gmail expirado; é necessário ressincronizar por janela de datas.');
        throw x;
      }
      throw e;
    }
  }

  /** Uma página de messages.list (sem spam/lixeira). */
  function listPage(q, pageToken, limiter, budget, maxResults) {
    var args = { q: q, maxResults: maxResults || 500, includeSpamTrash: false };
    if (pageToken) args.pageToken = pageToken;
    var r = call_(function () {
      return Gmail.Users.Messages.list('me', args);
    }, UNITS.messagesList, limiter, budget);
    return {
      ids: (r.messages || []).map(function (m) {
        return { id: m.id, threadId: m.threadId };
      }),
      nextPageToken: r.nextPageToken || '',
    };
  }

  /**
   * Busca mensagens em sequência. format: 'full' | 'metadata' | 'minimal'.
   * Nunca lança por mensagem individual: devolve status por item.
   * @return {{items: Array<{id: string, status: string, message: Object|null, error: string}>, stoppedEarly: boolean}}
   */
  function getMessages(requests, limiter, budget) {
    var items = [];
    var stoppedEarly = false;
    for (var i = 0; i < requests.length; i++) {
      var req = requests[i];
      if (budget && !budget.hasTime(40000)) {
        stoppedEarly = true;
        break;
      }
      var units = req.format === 'full' ? UNITS.getFull : UNITS.getMetadata;
      try {
        var args = { format: req.format };
        if (req.format === 'metadata') args.metadataHeaders = METADATA_HEADERS;
        var msg = call_(function () {
          return Gmail.Users.Messages.get('me', req.id, args);
        }, units, limiter, budget);
        items.push({ id: req.id, status: 'OK', message: msg, error: '' });
      } catch (e) {
        if (e && e.code === 'BUDGET') {
          stoppedEarly = true;
          break;
        }
        if (isNotFound_(e)) items.push({ id: req.id, status: 'NOT_FOUND', message: null, error: '' });
        else if (isAuthError_(e)) throw e;
        else items.push({ id: req.id, status: 'ERROR', message: null, error: Util.sanitizeError(e) });
      }
    }
    return { items: items, stoppedEarly: stoppedEarly };
  }

  // ------------------------------------------------------ elegibilidade ----
  /**
   * Regra única (incremental, backfill e resync) do que fazer com uma mensagem,
   * pelos labels: rascunhos e chats são ignorados; spam/lixeira só registram
   * estado; enviadas só metadados; o resto é processado.
   * @param {string[]} labelIds
   * @param {{ageDays: number, fullWindowDays: number}=} ctx
   * @return {{action: 'SKIP'|'STATE_ONLY'|'METADATA'|'FULL', reason: string}}
   */
  function eligibility(labelIds, ctx) {
    var labels = labelIds || [];
    function has(l) {
      return labels.indexOf(l) >= 0;
    }
    if (has('DRAFT')) return { action: 'SKIP', reason: 'draft' };
    if (has('CHAT')) return { action: 'SKIP', reason: 'chat' };
    if (has('SPAM') || has('TRASH')) return { action: 'STATE_ONLY', reason: has('SPAM') ? 'spam' : 'trash' };
    if (has('SENT')) return { action: 'METADATA', reason: 'sent' };
    var c = /** @type {any} */ (ctx || {});
    if (c.ageDays !== undefined && c.fullWindowDays !== undefined && c.ageDays > c.fullWindowDays) return { action: 'METADATA', reason: 'old' };
    return { action: 'FULL', reason: '' };
  }

  // ---------------------------------------------------------- links ----
  /** Link para abrir a mensagem na interface web do Gmail (u/N configurável). */
  function webUrl(messageId, accountIndex) {
    if (!/^[0-9a-f]+$/i.test(String(messageId || ''))) return '';
    return 'https://mail.google.com/mail/u/' + Number(accountIndex || 0) + '/#all/' + messageId;
  }

  /** Alternativa robusta em "clique a frio": busca pelo header Message-ID. */
  function searchUrl(rfc822MessageId, accountIndex) {
    var id = String(rfc822MessageId || '').replace(/^<|>$/g, '').trim();
    if (!id) return '';
    return 'https://mail.google.com/mail/u/' + Number(accountIndex || 0) + '/#search/' + encodeURIComponent('rfc822msgid:' + id);
  }

  return {
    UNITS: UNITS,
    HISTORY_TYPES: HISTORY_TYPES,
    METADATA_HEADERS: METADATA_HEADERS,
    createLimiter: createLimiter,
    profile: profile,
    historyPage: historyPage,
    listPage: listPage,
    getMessages: getMessages,
    eligibility: eligibility,
    webUrl: webUrl,
    searchUrl: searchUrl,
  };
})();
