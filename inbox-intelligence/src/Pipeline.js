/**
 * Orquestração da ingestão incremental e agendada.
 *
 * Ordem de uma execução (sob o lock do script, com orçamento de tempo):
 *   1. recupera execução abortada (quarentena da mensagem em processamento)
 *   2. descarrega a fila de feedback e reescora as mensagens afetadas
 *   3. sincronização incremental pelo histórico do Gmail (404 → resync por janela)
 *   4. janelas pendentes: resync primeiro, depois backfill (respeitando o
 *      orçamento diário de runtime de triggers)
 *   5. backlog de IA (mensagens já gravadas só com regras)
 *   6. briefing por IA do dia (opcional, no máximo N por dia)
 *   7. linha em `runs`, heartbeat limpo, runtime contabilizado
 *
 * Somente leitura no Gmail: nada é enviado, arquivado, marcado ou excluído.
 */
var Pipeline = (function () {
  var KEYS = {
    historyId: 'GMAIL_HISTORY_ID',
    lastSync: 'GMAIL_LAST_SYNC_YMD',
    windows: 'GMAIL_WINDOWS',
    backfill: 'BACKFILL_STATE',
    fetchFails: 'FETCH_FAILS',
    partial: 'PARTIAL_COMMIT_IDS',
    briefing: 'BRIEFING_STATE',
  };
  var TRIGGER_SOURCES = ['TIME', 'ONE_SHOT'];
  var STATE_FETCH_CAP = 150;
  var DEFERRED_AI_ERRORS = ['BUDGET', 'TIME', 'CIRCUIT_OPEN', 'NO_CONSENT', 'DISABLED'];

  function props_() {
    return PropertiesService.getScriptProperties();
  }
  function getJson_(key, fallback) {
    return Util.safeJsonParse(props_().getProperty(key), fallback);
  }
  function setJson_(key, value) {
    props_().setProperty(key, JSON.stringify(value));
  }

  function ownerEmail_() {
    return String(Config.secret('ownerEmail') || Session.getEffectiveUser().getEmail() || '').toLowerCase();
  }

  function requireSetup_() {
    if (!Config.projectId()) throw Util.appError('CONFIG', 'GCP_PROJECT_ID não configurado nas Propriedades do script.');
    if (!Triggers.isSetupDone()) throw Util.appError('CONFIG', 'Banco ainda não criado. Execute setup() no editor do Apps Script.');
  }

  // ------------------------------------------------------------ contexto ----
  /** Contexto preguiçoso da execução: consultas só quando a etapa precisa. */
  function context_(run, cfg, budget, limiter) {
    var memo = {};
    return {
      run: run,
      cfg: cfg,
      budget: budget,
      limiter: limiter,
      today: Util.todayYmd(),
      versionTs: Util.nowIso(),
      owner: ownerEmail_(),
      taxonomy: Config.taxonomy(),
      knownContacts: function () {
        if (!memo.kc) memo.kc = safeRead_(run, 'known_contacts', Repository.knownContacts, {});
        return memo.kc;
      },
      senderAffinity: function () {
        if (!memo.sa) memo.sa = safeRead_(run, 'sender_affinity', Repository.senderAffinity, {});
        return memo.sa;
      },
    };
  }

  function safeRead_(run, name, fn, fallback) {
    try {
      return fn();
    } catch (e) {
      Monitoring.addError(run, e, name);
      return fallback;
    }
  }

  function aiRequestsLeft_(ctx) {
    return Math.max(0, ctx.cfg.ai.maxRequestsPerRun - ctx.run.ai_requests);
  }

  function aiActive_() {
    return AiClient.provider() !== 'none' && AiClient.effectivePolicy() !== 'OFF' && !AiClient.circuitOpenUntil();
  }

  function addUsage_(run, usage) {
    if (!usage) return;
    run.ai_requests += usage.requests || 0;
    run.ai_input_tokens += usage.input_tokens || 0;
    run.ai_output_tokens += usage.output_tokens || 0;
    run.ai_cost_usd += usage.cost_usd || 0;
  }

  // ---------------------------------------------------------- execução ----
  /**
   * Executa o pipeline. Nunca roda em paralelo (lock do script).
   * @param {string=} triggerSource 'TIME' | 'ONE_SHOT' | 'MANUAL'
   */
  function run(triggerSource) {
    var cfg = Config.get();
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) {
      Monitoring.log('info', 'pipeline_locked', {});
      return { status: 'LOCKED' };
    }
    var source = triggerSource || 'MANUAL';
    var r = Monitoring.startRun('PIPELINE', source);
    var budget = Util.createBudget(cfg.pipeline.maxRuntimeMs);
    var limiter = GmailClient.createLimiter(cfg.gmail.unitsPerMinute);
    var bq0 = { processed: BigQueryClient.monthlyQueryBytes(), written: BigQueryClient.lifetimeBytes() };
    var status = '';
    try {
      requireSetup_();
      var stale = Monitoring.recoverStale(true);
      if (stale) Monitoring.count(r, 'recovered_aborted_run');
      if (props_().getProperty('VIEWS_DIRTY')) {
        step_(r, 'views', function () {
          Triggers.recreateViews(Schema.generation());
          props_().deleteProperty('VIEWS_DIRTY');
          Repository.bumpDataVersion();
        });
      }
      var ctx = context_(r, cfg, budget, limiter);
      step_(r, 'feedback', function () {
        flushAndRescore_(ctx);
      });
      step_(r, 'sync', function () {
        syncIncremental_(ctx);
      });
      step_(r, 'windows', function () {
        processWindows_(ctx);
      });
      if (budget.hasTime(cfg.pipeline.safetyMarginMs + 60000)) {
        step_(r, 'ai_backlog', function () {
          aiBacklog_(ctx);
        });
      }
      if (budget.hasTime(cfg.pipeline.safetyMarginMs)) {
        step_(r, 'briefing', function () {
          briefing_(ctx);
        });
      }
    } catch (e) {
      Monitoring.addError(r, e, 'pipeline');
      status = 'FAILED';
    } finally {
      r.gmail_units = limiter.stats().unitsUsed;
      r.bq_bytes_processed = Math.max(0, BigQueryClient.monthlyQueryBytes() - bq0.processed);
      r.bq_bytes_written = Math.max(0, BigQueryClient.lifetimeBytes() - bq0.written);
      r.checkpoint = checkpoint_();
      Monitoring.finishRun(r, status || undefined);
      if (r.status !== 'FAILED') props_().setProperty('LAST_SYNC_OK_AT', r.finished_at);
      try {
        if (Triggers.isSetupDone()) Repository.append('runs', [Monitoring.runRow(r)], r.run_id + ':run');
      } catch (e2) {
        Monitoring.log('warn', 'run_row_failed', { code: Monitoring.classify(e2, 'runs').code });
      }
      Monitoring.clearHeartbeat();
      if (TRIGGER_SOURCES.indexOf(source) >= 0) Monitoring.addTriggerRuntime(r.duration_ms);
      lock.releaseLock();
    }
    return { status: r.status, runId: r.run_id, counts: r.counts, errors: r.errors };
  }

  /** Etapa isolada: falha registrada não derruba as seguintes (exceto autorização). */
  function step_(run, name, fn) {
    try {
      Monitoring.stage(run, name, fn);
    } catch (e) {
      if (Monitoring.classify(e, name).code === 'AUTH') throw e;
    }
  }

  function checkpoint_() {
    return {
      historyId: props_().getProperty(KEYS.historyId) || '',
      lastSync: props_().getProperty(KEYS.lastSync) || '',
      backfill: getJson_(KEYS.backfill, null),
      windows: (getJson_(KEYS.windows, []) || []).length,
    };
  }

  // ---------------------------------------------- feedback e reescore ----
  function flushAndRescore_(ctx) {
    var fb = Repository.flushFeedback(ctx.run.run_id, ctx.budget);
    if (fb.error) {
      var e = Util.appError('LOAD_FAILED', 'Falha ao gravar feedback');
      throw e;
    }
    Monitoring.count(ctx.run, 'feedback_flushed', fb.flushed);
    var ids = Util.uniq(fb.rows.filter(function (row) {
      return row.target_type === 'MESSAGE' && ['RELEVANT', 'IRRELEVANT', 'SHOULD_BE_HIGHER', 'MISCLASSIFIED'].indexOf(row.feedback_type) >= 0;
    }).map(function (row) {
      return row.target_id;
    }));
    if (ids.length) rescore(ctx.run, ids, ctx.budget);
  }

  /**
   * Reescora a partir das features gravadas. Com `onlyIds`, só essas
   * mensagens (feedback); sem, todas com prazo na janela (manutenção diária).
   */
  function rescore(run, onlyIds, budget) {
    var cfg = Config.get();
    var today = Util.todayYmd();
    var rows = Repository.rescoreCandidates(today, onlyIds || []);
    if (onlyIds) {
      var want = {};
      onlyIds.forEach(function (id) {
        want[id] = true;
      });
      rows = rows.filter(function (row) {
        return want[row.message_id];
      });
    }
    var versionTs = Util.nowIso();
    var out = [];
    rows.forEach(function (row) {
      var f = Util.safeJsonParse(row.features_json, null);
      if (!f || f.importance === undefined) return;
      var ov = { category: row.correct_category || '', irrelevant: row.user_relevance === 'IRRELEVANT', higher: row.user_relevance === 'SHOULD_BE_HIGHER' };
      var res = Scoring.compute(Scoring.applyOverride(f, ov, cfg), cfg, today);
      if (Math.abs(res.score - Number(row.score || 0)) < 0.0005 && res.level === row.level) return;
      out.push(Repository.scoreRow({ message_id: row.message_id, received_date: row.received_date }, row.analysis_id, res, {
        deadlineDate: row.deadline_date || null, source: onlyIds ? 'FEEDBACK' : 'RESCORE', runId: run.run_id, versionTs: versionTs,
      }));
    });
    if (out.length) {
      var res2 = Repository.append('scores', out, run.run_id + ':rescore:' + (onlyIds ? 'fb' : 'daily'), budget);
      if (!res2.ok) {
        var e = Util.appError('LOAD_FAILED', 'Falha ao gravar reescore');
        throw e;
      }
    }
    Monitoring.count(run, onlyIds ? 'rescored_feedback' : 'rescored', out.length);
    return out.length;
  }

  // ---------------------------------------------------- incremental ----
  function initialize_(ctx) {
    var prof = GmailClient.profile(ctx.limiter, ctx.budget);
    if (prof.emailAddress && ctx.owner && prof.emailAddress !== ctx.owner) {
      var e = Util.appError('AUTH', 'A caixa do Gmail não pertence ao dono configurado.');
      throw e;
    }
    props_().setProperty(KEYS.historyId, prof.historyId);
    props_().setProperty(KEYS.lastSync, ctx.today);
    // O backfill cobre até amanhã (exclusivo): o que chegou antes do historyId inicial entra por ele.
    setJson_(KEYS.backfill, { floor: Util.addDays(ctx.today, -ctx.cfg.gmail.backfillDays), cursor: Util.addDays(ctx.today, 1), pageToken: '', done: false });
    Monitoring.count(ctx.run, 'initialized');
  }

  function syncIncremental_(ctx) {
    var start = props_().getProperty(KEYS.historyId);
    if (!start) {
      initialize_(ctx);
      return;
    }
    var added = {};
    var changed = {};
    var deleted = {};
    var pageToken = '';
    var latest = start;
    var pages = 0;
    try {
      do {
        var page = GmailClient.historyPage(start, pageToken, ctx.limiter, ctx.budget);
        page.history.forEach(function (h) {
          (h.messagesAdded || []).forEach(function (x) {
            var m = x.message || {};
            if (m.id) added[m.id] = { id: m.id, threadId: m.threadId, labelIds: m.labelIds || [] };
          });
          (h.labelsAdded || []).concat(h.labelsRemoved || []).forEach(function (x) {
            var m = x.message || {};
            if (m.id) changed[m.id] = { id: m.id, threadId: m.threadId, labelIds: m.labelIds || [] };
          });
          (h.messagesDeleted || []).forEach(function (x) {
            var m = x.message || {};
            if (!m.id) return;
            deleted[m.id] = { id: m.id, threadId: m.threadId };
            delete added[m.id];
            delete changed[m.id];
          });
        });
        if (page.historyId) latest = page.historyId;
        pageToken = page.nextPageToken;
        pages++;
      } while (pageToken && ctx.budget.hasTime(120000) && pages < 40);
    } catch (e) {
      if (e && e.code === 'HISTORY_EXPIRED') {
        scheduleResync_(ctx);
        return;
      }
      throw e;
    }
    var complete = !pageToken;
    var ids = Util.uniq(Object.keys(added).concat(Object.keys(changed), Object.keys(deleted)));
    Monitoring.count(ctx.run, 'history_events', ids.length);
    var ok = true;
    if (ids.length) {
      var existing = Repository.existingMessageIds(ids);
      var fresh = Object.keys(added).filter(function (id) {
        return !existing[id];
      }).map(function (id) {
        return added[id];
      });
      var touched = Util.uniq(Object.keys(added).concat(Object.keys(changed))).filter(function (id) {
        return existing[id];
      });
      var gone = Object.keys(deleted).filter(function (id) {
        return existing[id];
      });
      Monitoring.count(ctx.run, 'duplicates_avoided', Object.keys(added).length - fresh.length);
      var ing = ingest_(ctx, fresh, { source: 'INCREMENTAL', ageDays: 0 });
      ok = ing.ok && !ing.stoppedEarly && !ing.retryLater;
      var st = refreshStates_(ctx, touched, changed, added, gone);
      ok = ok && st.ok;
    }
    if (ok && complete) {
      props_().setProperty(KEYS.historyId, latest);
      props_().setProperty(KEYS.lastSync, ctx.today);
    } else {
      Monitoring.count(ctx.run, 'history_not_advanced');
    }
  }

  /** O histórico expirou: novo ponto de partida + janela de resync desde a última sync boa. */
  function scheduleResync_(ctx) {
    var prof = GmailClient.profile(ctx.limiter, ctx.budget);
    var last = props_().getProperty(KEYS.lastSync) || Util.addDays(ctx.today, -7);
    var windows = getJson_(KEYS.windows, []) || [];
    windows.unshift({ kind: 'RESYNC', start: Util.addDays(last, -1), end: Util.addDays(ctx.today, 1), pageToken: '' });
    setJson_(KEYS.windows, windows.slice(0, 10));
    props_().setProperty(KEYS.historyId, prof.historyId);
    Monitoring.count(ctx.run, 'resync_scheduled');
    Monitoring.log('warn', 'history_expired_resync', { since: last });
  }

  /** Snapshots de estado (labels) de mensagens já gravadas. */
  function refreshStates_(ctx, touchedIds, changed, added, goneIds) {
    var rows = [];
    var meta = { source: 'HISTORY', runId: ctx.run.run_id, versionTs: ctx.versionTs };
    goneIds.forEach(function (id) {
      var t = (changed[id] || added[id] || {}).threadId || '';
      rows.push(Repository.stateRow(id, t, [], Object.assign({ gone: 'DELETED' }, meta)));
    });
    var fetchIds = touchedIds.slice(0, STATE_FETCH_CAP);
    var rest = touchedIds.slice(STATE_FETCH_CAP);
    if (fetchIds.length) {
      var res = GmailClient.getMessages(fetchIds.map(function (id) {
        return { id: id, format: 'minimal' };
      }), ctx.limiter, ctx.budget);
      var seen = {};
      res.items.forEach(function (it) {
        seen[it.id] = true;
        if (it.status === 'OK') rows.push(Repository.stateRow(it.id, it.message.threadId, it.message.labelIds || [], meta));
        else if (it.status === 'NOT_FOUND') rows.push(Repository.stateRow(it.id, '', [], Object.assign({ gone: 'DELETED' }, meta)));
      });
      // O que não coube no orçamento usa os labels que vieram no próprio histórico.
      fetchIds.forEach(function (id) {
        if (!seen[id]) rest.push(id);
      });
    }
    rest.forEach(function (id) {
      var h = changed[id] || added[id];
      if (h && h.labelIds && h.labelIds.length) rows.push(Repository.stateRow(id, h.threadId, h.labelIds, meta));
    });
    Monitoring.count(ctx.run, 'state_updates', rows.length);
    if (!rows.length) return { ok: true };
    var r = Repository.append('message_state', rows, ctx.run.run_id + ':state:' + Util.shortHash(touchedIds.join(',') + goneIds.join(','), 10), ctx.budget);
    if (!r.ok) Monitoring.addError(ctx.run, { code: 'LOAD_FAILED' }, 'state');
    return { ok: r.ok };
  }

  // ------------------------------------------------------------ janelas ----
  function processWindows_(ctx) {
    var cfg = ctx.cfg;
    var guard = 0;
    while (ctx.budget.hasTime(cfg.pipeline.safetyMarginMs + 60000) && guard++ < 20) {
      var windows = getJson_(KEYS.windows, []) || [];
      if (windows.length) {
        var w = windows[0];
        var r = processWindowPage_(ctx, w);
        if (!r.ok) return;
        if (r.done) windows.shift();
        else windows[0].pageToken = r.nextPageToken;
        setJson_(KEYS.windows, windows);
        continue;
      }
      var bf = getJson_(KEYS.backfill, null);
      if (!bf || bf.done) return;
      if (!Monitoring.backfillAllowed()) {
        Monitoring.count(ctx.run, 'backfill_paused_runtime_budget');
        return;
      }
      if (bf.cursor <= bf.floor) {
        bf.done = true;
        setJson_(KEYS.backfill, bf);
        return;
      }
      var winStart = Util.addDays(bf.cursor, -cfg.gmail.backfillWindowDays);
      if (winStart < bf.floor) winStart = bf.floor;
      var res = processWindowPage_(ctx, { kind: 'BACKFILL', start: winStart, end: bf.cursor, pageToken: bf.pageToken || '' });
      if (!res.ok) return;
      if (res.done) {
        bf.cursor = winStart;
        bf.pageToken = '';
        bf.done = bf.cursor <= bf.floor;
      } else {
        bf.pageToken = res.nextPageToken;
      }
      setJson_(KEYS.backfill, bf);
    }
  }

  /** Uma página (até 100 ids) de uma janela de datas [start, end). */
  function processWindowPage_(ctx, w) {
    var q = 'after:' + (Util.ymdStartEpochSec(w.start) - 1) + ' before:' + Util.ymdStartEpochSec(w.end) + (ctx.cfg.gmail.listQueryExtra ? ' ' + ctx.cfg.gmail.listQueryExtra : '');
    if (!ctx.cfg.gmail.includeSent) q += ' -in:sent';
    var page = GmailClient.listPage(q, w.pageToken || '', ctx.limiter, ctx.budget, 100);
    Monitoring.count(ctx.run, w.kind === 'RESYNC' ? 'resync_listed' : 'backfill_listed', page.ids.length);
    if (!page.ids.length) return { ok: true, done: !page.nextPageToken, nextPageToken: page.nextPageToken };
    var existing = Repository.existingMessageIds(page.ids.map(function (x) {
      return x.id;
    }));
    var fresh = page.ids.filter(function (x) {
      return !existing[x.id];
    });
    Monitoring.count(ctx.run, 'duplicates_avoided', page.ids.length - fresh.length);
    var age = Math.max(0, Util.daysBetween(Util.addDays(w.end, -1), ctx.today));
    var ing = ingest_(ctx, fresh, { source: w.kind, ageDays: age });
    if (!ing.ok || ing.stoppedEarly) return { ok: false };
    return { ok: true, done: !page.nextPageToken, nextPageToken: page.nextPageToken };
  }

  // ------------------------------------------------------------- ingestão ----
  /**
   * Busca, interpreta, classifica, (opcionalmente) analisa com IA, pontua e
   * grava mensagens novas, em lotes pequenos com commit por lote.
   * @param {Object} ctx
   * @param {Array<{id: string, threadId?: string, labelIds?: string[]}>} refs
   * @param {{source: string, ageDays: number}} opts
   * @return {{ok: boolean, stoppedEarly: boolean, retryLater: boolean, committed: number}}
   */
  function ingest_(ctx, refs, opts) {
    var out = { ok: true, stoppedEarly: false, retryLater: false, committed: 0 };
    if (!refs.length) return out;
    var cfg = ctx.cfg;
    var fails = getJson_(KEYS.fetchFails, {}) || {};
    var partial = getJson_(KEYS.partial, []) || [];
    var todo = [];
    refs.forEach(function (ref) {
      var el = GmailClient.eligibility(ref.labelIds, { ageDays: opts.ageDays, fullWindowDays: cfg.storage.excerptRetentionDays });
      if (ref.labelIds && ref.labelIds.length && (el.action === 'SKIP' || el.action === 'STATE_ONLY')) return;
      if ((fails[ref.id] || 0) >= 3) return;
      var quarantined = Monitoring.isQuarantined(ref.id);
      todo.push({ id: ref.id, format: quarantined || el.action === 'METADATA' ? 'metadata' : 'full', quarantined: quarantined });
    });
    Monitoring.count(ctx.run, 'to_fetch', todo.length);
    var chunks = Util.chunk(todo, cfg.gmail.fetchBatchSize);
    for (var c = 0; c < chunks.length; c++) {
      if (!ctx.budget.hasTime(cfg.pipeline.safetyMarginMs)) {
        out.stoppedEarly = true;
        break;
      }
      var r = ingestChunk_(ctx, chunks[c], fails, partial, opts);
      out.committed += r.committed;
      if (r.retryLater) out.retryLater = true;
      if (!r.ok) {
        out.ok = false;
        break;
      }
      if (r.stoppedEarly) {
        out.stoppedEarly = true;
        break;
      }
    }
    setJson_(KEYS.fetchFails, pruneFails_(fails));
    setJson_(KEYS.partial, partial.slice(-400));
    return out;
  }

  function pruneFails_(fails) {
    var keys = Object.keys(fails);
    if (keys.length <= 300) return fails;
    var out = {};
    keys.slice(-300).forEach(function (k) {
      out[k] = fails[k];
    });
    return out;
  }

  function ingestChunk_(ctx, chunk, fails, partial, opts) {
    var cfg = ctx.cfg;
    var res = GmailClient.getMessages(chunk.map(function (t) {
      return { id: t.id, format: t.format };
    }), ctx.limiter, ctx.budget);
    var byId = {};
    chunk.forEach(function (t) {
      byId[t.id] = t;
    });
    var parsedList = [];
    var retryLater = false;
    res.items.forEach(function (it) {
      if (it.status === 'NOT_FOUND') {
        Monitoring.count(ctx.run, 'not_found');
        return;
      }
      if (it.status !== 'OK') {
        fails[it.id] = (fails[it.id] || 0) + 1;
        retryLater = true;
        Monitoring.count(ctx.run, 'fetch_errors');
        return;
      }
      var t = byId[it.id];
      var el = GmailClient.eligibility(it.message.labelIds || [], { ageDays: opts.ageDays, fullWindowDays: cfg.storage.excerptRetentionDays });
      if (el.action === 'SKIP' || el.action === 'STATE_ONLY') {
        Monitoring.count(ctx.run, 'skipped_' + el.reason);
        return;
      }
      try {
        Monitoring.markProcessing(ctx.run, it.id);
        var p = MessageParser.parse(it.message, { ownerEmail: ctx.owner, excerptChars: cfg.storage.excerptChars, maxDecodedBodyChars: cfg.gmail.maxDecodedBodyChars });
        if (p.direction === 'OUTBOUND') AiClient.rememberOwnerName(p.from_name);
        var rules = RulesClassifier.classify(p, { refYmd: p.received_date, taxonomy: ctx.taxonomy, profile: cfg.profile, knownContacts: ctx.knownContacts() });
        parsedList.push({ p: p, rules: rules, metadataOnly: t.format !== 'full' || el.action === 'METADATA', quarantined: t.quarantined, labelIds: it.message.labelIds || [] });
      } catch (e) {
        Monitoring.addError(ctx.run, { code: 'PARSE' }, 'parse');
        Monitoring.quarantine(it.id);
      }
    });
    Monitoring.heartbeat(ctx.run, 'ingest');
    var committed = 0;
    if (parsedList.length) {
      var batch = buildBatch_(ctx, parsedList, partial);
      var commit = Repository.commitIngest(batch, ctx.run.run_id, ctx.budget);
      if (commit.counters.validation) Monitoring.count(ctx.run, 'row_validation_errors', commit.counters.validation);
      if (!commit.ok) {
        Monitoring.addError(ctx.run, { code: 'LOAD_FAILED' }, 'commit_' + commit.phase);
        if (commit.phase === 'messages') {
          parsedList.forEach(function (x) {
            if (partial.indexOf(x.p.message_id) < 0) partial.push(x.p.message_id);
          });
        }
        return { ok: false, committed: 0, stoppedEarly: res.stoppedEarly, retryLater: retryLater };
      }
      committed = parsedList.length;
      parsedList.forEach(function (x) {
        delete fails[x.p.message_id];
        var k = partial.indexOf(x.p.message_id);
        if (k >= 0) partial.splice(k, 1);
      });
      Monitoring.count(ctx.run, 'ingested', committed);
      Monitoring.count(ctx.run, 'ingested_' + opts.source.toLowerCase(), committed);
    }
    return { ok: true, committed: committed, stoppedEarly: res.stoppedEarly, retryLater: retryLater };
  }

  /** Monta as linhas de um lote: regras sempre; IA quando permitida; score. */
  function buildBatch_(ctx, list, partial) {
    var cfg = ctx.cfg;
    var run = ctx.run;
    var meta = { runId: run.run_id, versionTs: ctx.versionTs };
    var batch = { messages: [], states: [], analyses: [], scores: [], key: Util.shortHash(list.map(function (x) { return x.p.message_id; }).join(','), 12) };

    // Commit anterior gravou tudo menos `messages`: só falta o marcador.
    var fresh = [];
    list.forEach(function (x) {
      if (partial.indexOf(x.p.message_id) >= 0) {
        batch.messages.push(Repository.messageRow(x.p, Object.assign({ metadataOnly: x.metadataOnly, quarantined: x.quarantined }, meta)));
        Monitoring.count(run, 'partial_commit_completed');
      } else fresh.push(x);
    });

    var inbound = fresh.filter(function (x) {
      return x.p.direction === 'INBOUND';
    });
    var dup = {};
    var hashes = Util.uniq(inbound.map(function (x) { return x.p.content_hash; }).filter(Boolean));
    if (hashes.length) {
      dup = safeRead_(run, 'duplicate_hashes', function () {
        return Repository.duplicateHashes(hashes, inbound.map(function (x) { return x.p.message_id; }));
      }, {});
    }
    var seenHash = {};
    inbound.forEach(function (x) {
      if (seenHash[x.p.content_hash]) dup[x.p.content_hash] = true;
      seenHash[x.p.content_hash] = true;
    });

    var ai = analyzeFresh_(ctx, fresh);
    var featCtx = { profile: cfg.profile, knownContacts: ctx.knownContacts(), senderAffinity: ctx.senderAffinity(), duplicateHashes: dup, cfg: cfg };

    fresh.forEach(function (x) {
      var p = x.p;
      var rules = x.rules;
      var a = ai[p.message_id] || { status: x.metadataOnly || p.direction === 'OUTBOUND' ? 'SKIPPED' : 'PENDING', error: '' };
      if (rules.ai_eligible === false && a.status === 'PENDING') a = { status: 'SKIPPED', error: 'CATEGORY' };
      batch.messages.push(Repository.messageRow(p, Object.assign({ metadataOnly: x.metadataOnly, quarantined: x.quarantined }, meta)));
      batch.states.push(Repository.stateRow(p.message_id, p.thread_id, x.labelIds, Object.assign({ source: 'INGEST' }, meta)));

      var rulesMerged = AiSchema.merge(rules, null, cfg.profile);
      var rulesFeatures = Scoring.features(p, rulesMerged, featCtx);
      var rulesRow = Repository.analysisRow(p, rulesMerged, Object.assign({
        provider: 'rules', policy: a.policy || AiClient.effectivePolicy(), features: rulesFeatures,
        aiStatus: a.status === 'DONE' ? 'DONE' : a.status, aiAttempts: a.status === 'FAILED' ? 1 : 0, aiError: a.error || '',
      }, meta));
      batch.analyses.push(rulesRow);

      var finalRow = rulesRow;
      var finalMerged = rulesMerged;
      var finalFeatures = rulesFeatures;
      if (a.status === 'DONE') {
        finalMerged = AiSchema.merge(rules, a.analysis, cfg.profile);
        finalFeatures = Scoring.features(p, finalMerged, featCtx);
        finalRow = Repository.analysisRow(p, finalMerged, Object.assign({
          provider: a.provider, model: a.model, policy: a.policy, fidelity: a.fidelity, features: finalFeatures,
          redactions: a.redactions, usage: a.usage, aiStatus: 'DONE',
        }, meta));
        batch.analyses.push(finalRow);
      }
      var result = Scoring.compute(finalFeatures, cfg, ctx.today);
      batch.scores.push(Repository.scoreRow(p, finalRow.analysis_id, result, Object.assign({
        deadlineDate: finalMerged.deadline ? finalMerged.deadline.date : null, source: 'ANALYSIS',
      }, meta)));
      Monitoring.count(run, 'level_' + result.level.toLowerCase());
      if (rules.injection && rules.injection.suspected) Monitoring.count(run, 'injection_suspected');
    });
    return batch;
  }

  /** IA no momento da ingestão (mensagens recentes, de entrada, com corpo). */
  function analyzeFresh_(ctx, list) {
    var out = {};
    var cfg = ctx.cfg;
    if (!aiActive_()) return out;
    var policy = AiClient.effectivePolicy();
    var since = Util.addDays(ctx.today, -cfg.ai.backfillDays);
    var cands = list.filter(function (x) {
      return x.p.direction === 'INBOUND' && !x.metadataOnly && !x.quarantined && x.p.received_date >= since &&
        x.rules.ai_eligible !== false && !x.p.auth_fail;
    });
    if (!cands.length) return out;
    var threadCtx = {};
    var replyThreads = Util.uniq(cands.filter(function (x) { return x.p.is_reply; }).map(function (x) { return x.p.thread_id; }));
    if (replyThreads.length) {
      threadCtx = safeRead_(ctx.run, 'thread_context', function () {
        return Repository.threadContext(replyThreads, list.map(function (x) { return x.p.message_id; }));
      }, {});
    }
    var inputs = [];
    var byRef = {};
    cands.forEach(function (x, i) {
      var tc = threadCtx[x.p.thread_id];
      var tcText = tc && AiClient.allowedByPolicy(tc, tc, policy).allowed ? tc.summary : '';
      var prep = AiClient.prepareInput(x.p, x.rules, { ref: 'm' + (i + 1), text: x.p.body_text || x.p.body_excerpt, threadContext: tcText, policy: policy });
      if (!prep.input) {
        out[x.p.message_id] = { status: 'BLOCKED', error: policy, policy: policy };
        return;
      }
      inputs.push(prep.input);
      byRef[prep.input.ref] = { x: x, redactions: prep.redactions };
    });
    if (!inputs.length) return out;
    var left = aiRequestsLeft_(ctx);
    if (left <= 0 || !ctx.budget.hasTime(cfg.pipeline.safetyMarginMs + 75000)) return out;
    var res = AiClient.analyzeBatch(inputs, { refYmd: ctx.today, budget: ctx.budget, maxRequests: left });
    addUsage_(ctx.run, res.usage);
    res.results.forEach(function (r) {
      var ref = byRef[r.ref];
      if (!ref) return;
      var id = ref.x.p.message_id;
      if (r.ok) {
        out[id] = {
          status: 'DONE', analysis: r.analysis, fidelity: r.fidelity, provider: res.provider, model: res.model, policy: policy, redactions: ref.redactions,
          usage: { input_tokens: r.input_tokens, output_tokens: r.output_tokens, cost_usd: r.cost_usd, latency_ms: r.latency_ms },
        };
        Monitoring.count(ctx.run, 'ai_done');
      } else if (DEFERRED_AI_ERRORS.indexOf(r.error) >= 0) {
        out[id] = { status: 'PENDING', error: r.error, policy: policy };
        Monitoring.count(ctx.run, 'ai_deferred');
      } else {
        out[id] = { status: 'FAILED', error: r.error, policy: policy };
        Monitoring.count(ctx.run, 'ai_failed');
      }
    });
    return out;
  }

  // ---------------------------------------------------- backlog de IA ----
  /** Reconstrói um RulesResult a partir da linha da view (para merge e nova versão). */
  function rulesFromRow_(row) {
    var f = Util.safeJsonParse(row.features_json, {}) || {};
    var opp = Util.safeJsonParse(row.opportunity_json, null);
    return {
      primary_category: row.model_category,
      secondary_categories: row.secondary_categories || [],
      category_scores: {},
      confidence: Number(row.confidence || 0.5),
      reason: row.reason || '',
      signals: [],
      is_newsletter: !!row.is_newsletter,
      is_marketing: !!row.is_marketing,
      is_probable_spam: !!row.is_probable_spam,
      is_automated: !!row.is_automated,
      is_bulk: !!row.is_bulk,
      action_required: !!row.action_required,
      action_score: Number(f.action || (row.action_required ? 0.6 : 0)),
      actions: Util.safeJsonParse(row.actions_json, []) || [],
      deadline: row.deadline_date ? { date: row.deadline_date, certainty: row.deadline_certainty || 'INFERRED', evidence: row.deadline_evidence || '' } : null,
      opportunity: opp,
      summary: row.summary || '',
      key_facts: Util.safeJsonParse(row.key_facts_json, []) || [],
      topics: row.topics || [],
      interest_score: Number(f.interest || 0),
      entities: Util.safeJsonParse(row.entities_json, []) || [],
      sensitive: !!row.sensitive,
      ai_eligible: row.ai_eligible !== false,
      injection: { suspected: !!row.injection_suspected, signals: [] },
    };
  }

  function aiBacklog_(ctx) {
    var cfg = ctx.cfg;
    if (!aiActive_()) return;
    var left = aiRequestsLeft_(ctx);
    if (left <= 0) return;
    if (!Monitoring.backfillAllowed()) {
      Monitoring.count(ctx.run, 'ai_backlog_paused_runtime_budget');
      return;
    }
    var policy = AiClient.effectivePolicy();
    var batchSize = AiClient.provider() === 'anthropic' ? cfg.ai.anthropic.batchSize : cfg.ai.batchSize;
    var rows = Repository.pendingAi(Math.min(60, left * batchSize), Util.addDays(ctx.today, -cfg.ai.backfillDays), policy);
    if (!rows.length) return;
    var inputs = [];
    var byRef = {};
    var blocked = [];
    rows.forEach(function (row, i) {
      var rules = rulesFromRow_(row);
      var prep = AiClient.prepareInput(row, rules, { ref: 'm' + (i + 1), text: row.body_excerpt, policy: policy });
      if (!prep.input) {
        blocked.push({ row: row, rules: rules });
        return;
      }
      inputs.push(prep.input);
      byRef[prep.input.ref] = { row: row, rules: rules, redactions: prep.redactions };
    });
    var meta = { runId: ctx.run.run_id, versionTs: Util.nowIso() };
    var analyses = [];
    var scores = [];
    function statusRow(row, rules, status, err, attempts) {
      return Repository.analysisRow(row, AiSchema.merge(rules, null, cfg.profile), Object.assign({
        provider: 'rules', policy: policy, features: Util.safeJsonParse(row.features_json, {}), evidenceJson: row.evidence_json,
        fidelity: row.evidence_total === null || row.evidence_total === undefined ? null : { evidence_total: row.evidence_total, evidence_verified: row.evidence_verified },
        aiStatus: status, aiAttempts: attempts, aiError: err,
      }, meta));
    }
    blocked.forEach(function (b) {
      analyses.push(statusRow(b.row, b.rules, 'BLOCKED', policy, Number(b.row.ai_attempts || 0)));
    });
    Monitoring.count(ctx.run, 'ai_backlog_blocked', blocked.length);
    if (inputs.length && ctx.budget.hasTime(cfg.pipeline.safetyMarginMs + 75000)) {
      var res = AiClient.analyzeBatch(inputs, { refYmd: ctx.today, budget: ctx.budget, maxRequests: left });
      addUsage_(ctx.run, res.usage);
      var featCtx = { profile: cfg.profile, knownContacts: ctx.knownContacts(), senderAffinity: ctx.senderAffinity(), cfg: cfg };
      res.results.forEach(function (r) {
        var ref = byRef[r.ref];
        if (!ref) return;
        var row = ref.row;
        if (r.ok) {
          var merged = AiSchema.merge(ref.rules, r.analysis, cfg.profile);
          var f = Scoring.features(row, merged, featCtx);
          var aRow = Repository.analysisRow(row, merged, Object.assign({
            provider: res.provider, model: res.model, policy: policy, fidelity: r.fidelity, features: f, redactions: ref.redactions, aiStatus: 'DONE',
            usage: { input_tokens: r.input_tokens, output_tokens: r.output_tokens, cost_usd: r.cost_usd, latency_ms: r.latency_ms },
          }, meta));
          analyses.push(aRow);
          var ov = { category: row.correct_category || '', irrelevant: row.user_relevance === 'IRRELEVANT', higher: row.user_relevance === 'SHOULD_BE_HIGHER' };
          var result = Scoring.compute(Scoring.applyOverride(f, ov, cfg), cfg, ctx.today);
          scores.push(Repository.scoreRow(row, aRow.analysis_id, result, Object.assign({ deadlineDate: merged.deadline ? merged.deadline.date : null, source: 'AI_BACKLOG' }, meta)));
          Monitoring.count(ctx.run, 'ai_backlog_done');
        } else if (DEFERRED_AI_ERRORS.indexOf(r.error) < 0) {
          analyses.push(statusRow(row, ref.rules, 'FAILED', r.error, Number(row.ai_attempts || 0) + 1));
          Monitoring.count(ctx.run, 'ai_backlog_failed');
        }
      });
    }
    if (!analyses.length) return;
    var key = ctx.run.run_id + ':ai_backlog:' + Util.shortHash(rows.map(function (x) { return x.message_id; }).join(','), 10);
    var a1 = Repository.append('analyses', analyses, key + ':a', ctx.budget);
    if (!a1.ok) {
      Monitoring.addError(ctx.run, { code: 'LOAD_FAILED' }, 'ai_backlog_analyses');
      return;
    }
    if (scores.length) {
      var a2 = Repository.append('scores', scores, key + ':s', ctx.budget);
      if (!a2.ok) Monitoring.addError(ctx.run, { code: 'LOAD_FAILED' }, 'ai_backlog_scores');
    }
  }

  // ------------------------------------------------------------ briefing ----
  /**
   * Briefing do dia por IA: no máximo `briefingMaxPerDay`, com intervalo mínimo
   * de 3 h e só quando surgiram itens de prioridade alta desde o último.
   * Sem IA, o Radar monta um briefing determinístico na leitura.
   */
  function briefing_(ctx) {
    var cfg = ctx.cfg;
    if (!aiActive_() || aiRequestsLeft_(ctx) < 1) return;
    var st = getJson_(KEYS.briefing, null) || {};
    if (st.day !== ctx.today) st = { day: ctx.today, count: 0, lastAt: 0, lastHigh: -1 };
    if (st.count >= cfg.ai.briefingMaxPerDay) return;
    if (st.lastAt && Util.now() - st.lastAt < 3 * 3600000) return;
    var rows = Repository.query('briefing_input', { start: Repository.date(ctx.today), end: Repository.date(ctx.today) }, { maxRows: 40 }).rows;
    if (rows.length < 3) return;
    var high = rows.filter(function (r) {
      return r.display_level === 'CRITICAL' || r.display_level === 'HIGH';
    }).length;
    if (st.count > 0 && high <= st.lastHigh) return;
    var byCat = {};
    rows.forEach(function (r) {
      byCat[r.primary_category] = (byCat[r.primary_category] || 0) + 1;
    });
    var refMap = {};
    var items = rows.slice(0, 25).map(function (r, i) {
      var ref = 'b' + (i + 1);
      refMap[ref] = r.message_id;
      var cat = Config.category(r.primary_category);
      return {
        ref: ref, msg: r, rules: r, category: cat ? cat.label : r.primary_category, level: r.display_level, summary: r.summary || r.subject || '',
        deadline: r.deadline_date ? Util.formatBrDate(r.deadline_date) : '', action: !!r.action_required,
      };
    });
    var res = AiClient.generateBriefing({ periodLabel: 'Hoje, ' + Util.formatBrDate(ctx.today), stats: { mensagens: rows.length, prioridade_alta: high, por_categoria: byCat }, items: items });
    ctx.run.ai_requests += 1;
    ctx.run.ai_cost_usd += res.cost_usd || 0;
    st.lastAt = Util.now();
    if (!res.ok) {
      setJson_(KEYS.briefing, st);
      Monitoring.count(ctx.run, 'briefing_failed');
      return;
    }
    var content = {
      headline: res.briefing.headline,
      bullets: res.briefing.bullets.map(function (b) {
        return { text: b.text, refs: b.refs.map(function (x) { return refMap[x]; }).filter(Boolean) };
      }),
    };
    var json = JSON.stringify(content);
    var row = {
      briefing_id: Util.shortHash('today|' + ctx.today + '|' + Util.nowIso(), 20), period: 'today', period_start: ctx.today, period_end: ctx.today,
      method: 'AI', provider: res.provider, model: res.model, content_hash: Util.shortHash(json, 16), content_json: json,
      stats_json: JSON.stringify({ messages: rows.length, high: high }), run_id: ctx.run.run_id, version_ts: Util.nowIso(),
    };
    var ap = Repository.append('briefings', [row], ctx.run.run_id + ':briefing', ctx.budget);
    if (ap.ok) {
      st.count += 1;
      st.lastHigh = high;
      Monitoring.count(ctx.run, 'briefing_ai');
    }
    setJson_(KEYS.briefing, st);
  }

  // ------------------------------------------------------------- estado ----
  /** Estado de sincronização para a tela de Sistema. */
  function syncState() {
    var bf = getJson_(KEYS.backfill, null);
    return {
      historyId: props_().getProperty(KEYS.historyId) || '',
      lastSyncYmd: props_().getProperty(KEYS.lastSync) || '',
      windows: (getJson_(KEYS.windows, []) || []).map(function (w) {
        return { kind: w.kind, start: w.start, end: w.end };
      }),
      backfill: bf ? { done: !!bf.done, cursorDate: bf.cursor, floorDate: bf.floor } : null,
      partialCommits: (getJson_(KEYS.partial, []) || []).length,
      fetchFailures: Object.keys(getJson_(KEYS.fetchFails, {}) || {}).length,
      quarantined: Monitoring.quarantinedIds().length,
    };
  }

  /** Reinicia o backfill (ex.: depois de ampliar backfillDays). Não apaga dados. */
  function restartBackfill(days) {
    var today = Util.todayYmd();
    var d = Math.max(1, Math.min(365, Number(days || Config.get().gmail.backfillDays)));
    setJson_(KEYS.backfill, { floor: Util.addDays(today, -d), cursor: Util.addDays(today, 1), pageToken: '', done: false });
  }

  return {
    KEYS: KEYS,
    run: run,
    rescore: rescore,
    syncState: syncState,
    restartBackfill: restartBackfill,
    _rulesFromRow: rulesFromRow_,
  };
})();
