/**
 * Observabilidade sem vazamento de conteúdo.
 *
 * - Logs e erros persistidos usam um ENUM fechado de códigos ({code, module, http}).
 *   Nunca se grava e.message de parse ou de provedor (o V8 inclui trechos da
 *   entrada em erros de JSON.parse, por exemplo).
 * - Heartbeat da execução com o ID da mensagem em processamento: se a execução
 *   morrer (timeout de 6 min), a próxima coloca a mensagem em quarentena.
 * - Orçamento de runtime de triggers em janela móvel de 24 h (90 min/dia em
 *   contas gmail.com, compartilhados por todos os projetos do usuário).
 */
var Monitoring = (function () {
  var CODES = ['CONFIG', 'AUTH', 'NOT_FOUND', 'RATE', 'QUOTA', 'TIMEOUT', 'UPSTREAM', 'PARSE', 'BUDGET', 'LOCKED',
    'HISTORY_EXPIRED', 'LOAD_FAILED', 'QUERY_FAILED', 'VALIDATION', 'QUARANTINED', 'DENIED', 'INTERNAL'];
  var KEYS = { heartbeat: 'RUN_HEARTBEAT', runtime: 'TRIGGER_RUNTIME', quarantine: 'QUARANTINE_IDS', lastRun: 'LAST_RUN' };
  var SAFE_KEY = /^[a-z_][a-z0-9_]*$/i;

  /** Classifica um erro em {code, module, http} sem carregar o texto original. */
  function classify(e, module) {
    var http = Util.errorCode(e) || 0;
    var raw = e && e.code && typeof e.code === 'string' ? e.code : '';
    var code = CODES.indexOf(raw) >= 0 ? raw : '';
    if (!code) {
      var msg = String((e && e.message) || e || '');
      if (http === 401 || http === 403 || /authoriz|permission|insufficient/i.test(msg)) code = 'AUTH';
      else if (http === 404 || /not found/i.test(msg)) code = 'NOT_FOUND';
      else if (http === 429 || /rate ?limit|too many/i.test(msg)) code = 'RATE';
      else if (/quota|exceeded|limit/i.test(msg)) code = 'QUOTA';
      else if (/timed? ?out|timeout|tempo esgotado/i.test(msg)) code = 'TIMEOUT';
      else if (http >= 500) code = 'UPSTREAM';
      else if (e instanceof SyntaxError || /JSON|Unexpected token/i.test(msg)) code = 'PARSE';
      else if (/GCP_PROJECT_ID|configur/i.test(msg)) code = 'CONFIG';
      else code = 'INTERNAL';
    }
    return { code: code, module: String(module || 'app'), http: http };
  }

  /** Log estruturado. Só aceita valores primitivos curtos; e-mails são mascarados. */
  function log(level, event, fields) {
    var safe = { event: event };
    Object.keys(fields || {}).forEach(function (k) {
      if (!SAFE_KEY.test(k)) return;
      var v = fields[k];
      if (typeof v === 'number' || typeof v === 'boolean') safe[k] = v;
      else if (typeof v === 'string') safe[k] = Util.truncate(v.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'), 100);
    });
    var line = JSON.stringify(safe);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  // ------------------------------------------------------------ execução ----
  function startRun(kind, triggerSource) {
    return {
      run_id: kind.toLowerCase() + '_' + Utilities.formatDate(new Date(Util.now()), 'UTC', "yyyyMMdd'T'HHmmss") + '_' + Util.nonce().slice(0, 6),
      kind: kind,
      trigger_source: triggerSource || 'TIME',
      started_at: Util.nowIso(),
      startedMs: Util.now(),
      status: 'RUNNING',
      stages: {},
      counts: {},
      errors: [],
      gmail_units: 0,
      bq_bytes_processed: 0,
      bq_bytes_written: 0,
      ai_requests: 0,
      ai_input_tokens: 0,
      ai_output_tokens: 0,
      ai_cost_usd: 0,
      checkpoint: {},
    };
  }

  /** Executa uma etapa cronometrada. Erros viram códigos e são relançados. */
  function stage(run, name, fn) {
    var t0 = Util.now();
    heartbeat(run, name);
    try {
      return fn();
    } catch (e) {
      addError(run, e, name);
      throw e;
    } finally {
      run.stages[name] = (run.stages[name] || 0) + (Util.now() - t0);
    }
  }

  function addError(run, e, module) {
    var c = classify(e, module);
    if (run.errors.length < 30) run.errors.push(c);
    log('warn', 'error', { run_id: run.run_id, code: c.code, module: c.module, http: c.http });
    return c;
  }

  function count(run, key, n) {
    run.counts[key] = (run.counts[key] || 0) + (n === undefined ? 1 : n);
  }

  function finishRun(run, status) {
    run.status = status || (run.errors.length ? 'PARTIAL' : 'SUCCESS');
    run.finished_at = Util.nowIso();
    run.duration_ms = Util.now() - run.startedMs;
    PropertiesService.getScriptProperties().setProperty(KEYS.lastRun, JSON.stringify({
      run_id: run.run_id, kind: run.kind, status: run.status, finished_at: run.finished_at, duration_ms: run.duration_ms,
      counts: run.counts, errors: run.errors.slice(0, 5),
    }));
    log(run.status === 'FAILED' ? 'error' : 'info', 'run_finished', { run_id: run.run_id, kind: run.kind, status: run.status, duration_ms: run.duration_ms });
    return run;
  }

  /** Linha da tabela runs (sem conteúdo). */
  function runRow(run) {
    return {
      run_id: run.run_id, kind: run.kind, trigger_source: run.trigger_source, started_at: run.started_at, finished_at: run.finished_at,
      status: run.status, duration_ms: run.duration_ms, stages_json: JSON.stringify(run.stages), counts_json: JSON.stringify(run.counts),
      gmail_units: run.gmail_units, bq_bytes_processed: run.bq_bytes_processed, bq_bytes_written: run.bq_bytes_written,
      ai_requests: run.ai_requests, ai_input_tokens: run.ai_input_tokens, ai_output_tokens: run.ai_output_tokens,
      ai_cost_usd: Util.round(run.ai_cost_usd, 6), errors_json: JSON.stringify(run.errors), checkpoint_json: JSON.stringify(run.checkpoint || {}),
      app_version: Config.APP_VERSION, classifier_version: Config.CLASSIFIER_VERSION, version_ts: run.finished_at || Util.nowIso(),
    };
  }

  function lastRun() {
    return Util.safeJsonParse(PropertiesService.getScriptProperties().getProperty(KEYS.lastRun), null);
  }

  // ----------------------------------------------------------- heartbeat ----
  function heartbeat(run, stageName, processingId) {
    var hb = { run_id: run.run_id, kind: run.kind, at: Util.now(), stage: stageName || '', processing: processingId || '' };
    PropertiesService.getScriptProperties().setProperty(KEYS.heartbeat, JSON.stringify(hb));
  }

  /** Marca a mensagem em processamento (antes do parse). */
  function markProcessing(run, messageId) {
    heartbeat(run, 'parse', messageId);
  }

  function clearHeartbeat() {
    PropertiesService.getScriptProperties().deleteProperty(KEYS.heartbeat);
  }

  /**
   * Execução anterior morreu sem terminar? Se havia uma mensagem em
   * processamento, ela vai para a quarentena (só metadados daqui em diante).
   * Com `underLock` (chamador detém o lock do pipeline), qualquer heartbeat
   * remanescente é de uma execução morta: não há espera pelo tempo de staleness.
   * @return {{runId: string, kind: string, stage: string, quarantined: string}|null}
   */
  function recoverStale(underLock) {
    var p = PropertiesService.getScriptProperties();
    var hb = Util.safeJsonParse(p.getProperty(KEYS.heartbeat), null);
    if (!hb) return null;
    if (!underLock && Util.now() - Number(hb.at || 0) < Config.get().pipeline.staleHeartbeatMs) return null;
    p.deleteProperty(KEYS.heartbeat);
    if (hb.processing) quarantine(hb.processing);
    log('warn', 'run_aborted_detected', { run_id: hb.run_id, stage: hb.stage, quarantined: !!hb.processing });
    return { runId: hb.run_id, kind: hb.kind, stage: hb.stage, quarantined: hb.processing || '' };
  }

  function quarantine(messageId) {
    var p = PropertiesService.getScriptProperties();
    var list = Util.safeJsonParse(p.getProperty(KEYS.quarantine), []) || [];
    if (list.indexOf(messageId) < 0) list.push(messageId);
    p.setProperty(KEYS.quarantine, JSON.stringify(list.slice(-200)));
  }

  function isQuarantined(messageId) {
    var list = Util.safeJsonParse(PropertiesService.getScriptProperties().getProperty(KEYS.quarantine), []) || [];
    return list.indexOf(messageId) >= 0;
  }

  function quarantinedIds() {
    return Util.safeJsonParse(PropertiesService.getScriptProperties().getProperty(KEYS.quarantine), []) || [];
  }

  // ---------------------------------------------------- runtime de triggers ----
  function readRuntime_() {
    var list = Util.safeJsonParse(PropertiesService.getScriptProperties().getProperty(KEYS.runtime), []) || [];
    var since = Util.now() - 24 * 3600000;
    return list.filter(function (x) {
      return x[0] >= since;
    });
  }

  function addTriggerRuntime(ms) {
    var list = readRuntime_();
    list.push([Util.now(), Math.round(ms)]);
    PropertiesService.getScriptProperties().setProperty(KEYS.runtime, JSON.stringify(list.slice(-200)));
  }

  /** Minutos de runtime de triggers nas últimas 24 h (contabilizados pelo app). */
  function triggerMinutesLast24h() {
    return Util.round(readRuntime_().reduce(function (s, x) {
      return s + x[1];
    }, 0) / 60000, 1);
  }

  /** O backfill (Gmail e IA) pode rodar? Fica suspenso acima do orçamento diário. */
  function backfillAllowed() {
    return triggerMinutesLast24h() < Config.get().pipeline.dailyTriggerBudgetMin;
  }

  return {
    CODES: CODES,
    classify: classify,
    log: log,
    startRun: startRun,
    stage: stage,
    addError: addError,
    count: count,
    finishRun: finishRun,
    runRow: runRow,
    lastRun: lastRun,
    heartbeat: heartbeat,
    markProcessing: markProcessing,
    clearHeartbeat: clearHeartbeat,
    recoverStale: recoverStale,
    quarantine: quarantine,
    isQuarantined: isQuarantined,
    quarantinedIds: quarantinedIds,
    addTriggerRuntime: addTriggerRuntime,
    triggerMinutesLast24h: triggerMinutesLast24h,
    backfillAllowed: backfillAllowed,
  };
})();
