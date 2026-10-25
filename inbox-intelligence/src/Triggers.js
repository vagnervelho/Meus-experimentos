/**
 * Instalação, gatilhos e manutenção.
 *
 * - setup(): idempotente e não destrutivo. Cria dataset, tabelas da geração
 *   vigente e views; instala os gatilhos deste projeto (sem tocar em outros).
 * - Manutenção diária: reescore por prazo, renovação da geração (o Sandbox
 *   expira tabelas em 60 dias), descarte adiado da geração anterior, recriação
 *   de views perto de expirar e verificação de expiração. Se algo ficar a menos
 *   de 10 dias de expirar, a execução termina com erro para o Apps Script
 *   enviar o e-mail de falha ao dono.
 */
var Triggers = (function () {
  var HANDLERS = { pipeline: 'runPipeline', maintenance: 'runMaintenance' };
  var KEYS = { setup: 'SETUP_VERSION', oneShot: 'ONE_SHOT_TRIGGER', dropAt: 'BQ_DROP_AFTER', viewsSig: 'VIEWS_SIG' };
  var EXPIRY_ALERT_DAYS = 10;
  var VIEW_REFRESH_DAYS = 20;

  function props_() {
    return PropertiesService.getScriptProperties();
  }

  function isSetupDone() {
    return Number(props_().getProperty(KEYS.setup) || 0) >= Config.SCHEMA_VERSION;
  }

  /** Lista de pendências de configuração (para a tela inicial e o diagnóstico). */
  function missingSetup() {
    var missing = [];
    if (!Config.secret('projectId')) missing.push('GCP_PROJECT_ID nas Propriedades do script (ID do projeto do BigQuery Sandbox).');
    if (!isSetupDone()) missing.push('Executar a função setup() no editor do Apps Script (cria o banco e os gatilhos).');
    var handlers = installedHandlers_();
    if (isSetupDone() && handlers.indexOf(HANDLERS.pipeline) < 0) missing.push('Gatilho de sincronização ausente: execute setupTriggers().');
    return missing;
  }

  // ------------------------------------------------------------- setup ----
  function setup() {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw Util.appError('LOCKED', 'Outra execução está em andamento; tente de novo em alguns minutos.');
    try {
      var me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
      var owner = String(Config.secret('ownerEmail') || '').toLowerCase();
      if (owner && me && owner !== me) throw Util.appError('AUTH', 'setup() deve ser executado pelo dono configurado.');
      if (!owner && me) Config.setSecret('ownerEmail', me);
      if (!Config.projectId()) throw Util.appError('CONFIG', 'Defina GCP_PROJECT_ID nas Propriedades do script (Configurações do projeto → Propriedades do script) antes do setup().');
      var absent = [typeof Gmail === 'undefined' ? 'Gmail API v1' : '', typeof BigQuery === 'undefined' ? 'BigQuery API v2' : ''].filter(String);
      if (absent.length) throw Util.appError('CONFIG', 'Serviços avançados ausentes: ' + absent.join(', ') + '. Envie o código de novo com npm run gas:push ou, no editor, adicione-os em Serviços.');
      if (!props_().getProperty('BQ_LOCATION')) Config.setSecret('bqLocation', Config.bqLocation());
      var ds = BigQueryClient.ensureDataset();
      var gen = Schema.generation();
      Schema.setGeneration(gen);
      Schema.names().forEach(function (name) {
        BigQueryClient.ddl(Schema.createTableSql(name, gen), 'setup_table');
      });
      recreateViews_(gen);
      var renewal = probeRenewal_();
      props_().setProperty(KEYS.setup, String(Config.SCHEMA_VERSION));
      var trig = install();
      Monitoring.log('info', 'setup_done', { generation: gen, dataset_created: ds.created, renewal_ok: renewal === 'ok' });
      return { ok: true, datasetCreated: ds.created, generation: gen, renewalProbe: renewal, triggers: trig };
    } catch (e) {
      var hint = Util.apiDisabledHint(e);
      if (hint) throw Util.appError('CONFIG', hint);
      throw e;
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * A renovação aos 45 dias usa CREATE OR REPLACE TABLE … AS SELECT. A documentação do Sandbox proíbe
   * DML e streaming, mas não fala de CTAS: o setup testa com uma tabela descartável para não descobrir
   * só no dia 45. Uma falha aqui não impede o resto do setup.
   */
  function probeRenewal_() {
    var ref = BigQueryClient.tableRef('_probe_renovacao');
    try {
      BigQueryClient.ddl('CREATE OR REPLACE TABLE ' + ref + ' AS SELECT 1 AS ok', 'setup_probe');
      BigQueryClient.ddl('DROP TABLE IF EXISTS ' + ref, 'setup_probe');
      return 'ok';
    } catch (e) {
      Monitoring.log('warn', 'setup_probe_failed', { code: Monitoring.classify(e, 'setup').code });
      return 'falhou (' + Util.sanitizeError(e) + '): a renovação automática das tabelas aos 45 dias não vai funcionar neste projeto';
    }
  }

  function recreateViews_(gen) {
    var statements = Schema.allViewStatements(gen, Schema.viewOptions());
    statements.forEach(function (v) {
      BigQueryClient.ddl(v.sql, 'setup_view');
    });
    props_().setProperty(KEYS.viewsSig, viewsSignature_(statements));
  }

  function viewsSignature_(statements) {
    return Util.sha256Hex(statements.map(function (v) { return v.sql; }).join('\n;\n')).slice(0, 32);
  }

  /**
   * As views no BigQuery são de uma definição anterior (código novo enviado, fuso trocado no manifesto)?
   * Compara a assinatura do SQL atual com a da última recriação.
   */
  function viewsOutdated() {
    if (!isSetupDone()) return false;
    var current = viewsSignature_(Schema.allViewStatements(Schema.generation(), Schema.viewOptions()));
    return props_().getProperty(KEYS.viewsSig) !== current;
  }

  // ----------------------------------------------------------- gatilhos ----
  function installedHandlers_() {
    return ScriptApp.getProjectTriggers().map(function (t) {
      return t.getHandlerFunction();
    });
  }

  /** Garante exatamente um gatilho por handler deste app; não mexe em outros. */
  function install() {
    var cfg = Config.get().pipeline;
    var seen = {};
    ScriptApp.getProjectTriggers().forEach(function (t) {
      var h = t.getHandlerFunction();
      if (h !== HANDLERS.pipeline && h !== HANDLERS.maintenance) return;
      if (h === HANDLERS.pipeline && t.getUniqueId && t.getUniqueId() === oneShotId_()) return;
      if (seen[h]) ScriptApp.deleteTrigger(t);
      else seen[h] = true;
    });
    if (!seen[HANDLERS.pipeline]) ScriptApp.newTrigger(HANDLERS.pipeline).timeBased().everyHours(cfg.triggerEveryHours).create();
    if (!seen[HANDLERS.maintenance]) ScriptApp.newTrigger(HANDLERS.maintenance).timeBased().everyDays(1).atHour(cfg.maintenanceHour).create();
    return list();
  }

  function uninstall() {
    var n = 0;
    ScriptApp.getProjectTriggers().forEach(function (t) {
      var h = t.getHandlerFunction();
      if (h === HANDLERS.pipeline || h === HANDLERS.maintenance) {
        ScriptApp.deleteTrigger(t);
        n++;
      }
    });
    props_().deleteProperty(KEYS.oneShot);
    return { removed: n };
  }

  function list() {
    return ScriptApp.getProjectTriggers().map(function (t) {
      return { handler: t.getHandlerFunction(), type: String(t.getEventType()) };
    });
  }

  function oneShotId_() {
    var v = Util.safeJsonParse(props_().getProperty(KEYS.oneShot), null);
    return v ? v.id : '';
  }

  /**
   * Agenda uma execução avulsa em ~1 min (o Web App nunca roda o pipeline na
   * própria chamada). Idempotente: se já há uma agendada há menos de 10 min, reaproveita.
   */
  function scheduleOneShot() {
    var cur = Util.safeJsonParse(props_().getProperty(KEYS.oneShot), null);
    if (cur && Util.now() - cur.at < 10 * 60000 && ScriptApp.getProjectTriggers().some(function (t) {
      return t.getUniqueId && t.getUniqueId() === cur.id;
    })) {
      return { scheduled: true, at: Util.toIso(cur.at + 60000), reason: 'já agendada' };
    }
    var t = ScriptApp.newTrigger(HANDLERS.pipeline).timeBased().after(60 * 1000).create();
    props_().setProperty(KEYS.oneShot, JSON.stringify({ id: t.getUniqueId(), at: Util.now() }));
    return { scheduled: true, at: Util.toIso(Util.now() + 60000), reason: '' };
  }

  /** Chamado pelo handler: identifica e remove o gatilho avulso que disparou. */
  function consumeOneShot(e) {
    var id = e && e.triggerUid ? String(e.triggerUid) : '';
    var cur = oneShotId_();
    if (!id || !cur || id !== cur) return false;
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getUniqueId && t.getUniqueId() === id) ScriptApp.deleteTrigger(t);
    });
    props_().deleteProperty(KEYS.oneShot);
    return true;
  }

  /** Gatilhos validam o usuário efetivo contra o dono configurado. */
  function assertTriggerOwner() {
    var owner = String(Config.secret('ownerEmail') || '').toLowerCase();
    var me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    if (owner && me && owner !== me) throw Util.appError('AUTH', 'Execução por usuário diferente do dono.');
  }

  // --------------------------------------------------------- manutenção ----
  function maintenance(triggerSource) {
    Util.resetMemo();
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(60000)) {
      Monitoring.log('info', 'maintenance_locked', {});
      return { status: 'LOCKED' };
    }
    var cfg = Config.get();
    var run = Monitoring.startRun('MAINTENANCE', triggerSource || 'TIME');
    var budget = Util.createBudget(cfg.pipeline.maxRuntimeMs);
    var alerts = [];
    var status = '';
    try {
      if (!isSetupDone()) throw Util.appError('CONFIG', 'Execute setup() antes da manutenção.');
      Monitoring.recoverStale(true);
      safe_(run, 'rescore', function () {
        Pipeline.rescore(run, null, budget);
      });
      safe_(run, 'drop_previous', function () {
        dropPreviousIfDue_(run);
      });
      safe_(run, 'renew', function () {
        renewIfDue_(run, budget);
      });
      safe_(run, 'views', function () {
        refreshViewsIfNeeded_(run);
      });
      alerts = expiryAlerts_();
      Monitoring.count(run, 'expiry_alerts', alerts.length);
      pruneProperties_();
      var life = BigQueryClient.lifetimeBytes();
      if (life > cfg.storage.lifetimeLimitBytes * 0.8) {
        alerts.push('Armazenamento acumulado do BigQuery em ' + Math.round((100 * life) / cfg.storage.lifetimeLimitBytes) + '% do limite do Sandbox.');
      }
    } catch (e) {
      Monitoring.addError(run, e, 'maintenance');
      status = 'FAILED';
    } finally {
      Monitoring.finishRun(run, status || undefined);
      try {
        if (isSetupDone()) Repository.append('runs', [Monitoring.runRow(run)], run.run_id + ':run');
      } catch (e2) {
        Monitoring.log('warn', 'run_row_failed', { code: Monitoring.classify(e2, 'runs').code });
      }
      Monitoring.clearHeartbeat();
      if (triggerSource === 'TIME') Monitoring.addTriggerRuntime(run.duration_ms);
      lock.releaseLock();
    }
    if (alerts.length) {
      // Falha proposital: o Apps Script envia e-mail de falha ao dono.
      throw Util.appError('CONFIG', 'Inbox Intelligence precisa de atenção: ' + alerts.join(' '));
    }
    return { status: run.status, runId: run.run_id, counts: run.counts };
  }

  function safe_(run, name, fn) {
    try {
      Monitoring.stage(run, name, fn);
    } catch (e) {
      // registrado em stage(); segue para a próxima etapa
    }
  }

  function tableAgeDays_(info) {
    return info && info.exists && info.creationTime ? (Util.now() - info.creationTime) / Util.DAY_MS : 0;
  }

  /** Renova a geração quando a tabela mais antiga passa de renewAfterDays. */
  function renewIfDue_(run, budget) {
    var cfg = Config.get();
    var gen = Schema.generation();
    var oldest = 0;
    Schema.names().forEach(function (name) {
      oldest = Math.max(oldest, tableAgeDays_(BigQueryClient.tableInfo(Schema.physical(name, gen))));
    });
    if (oldest < cfg.storage.renewAfterDays) return false;
    if (Schema.pendingDrop()) {
      // A geração anterior ainda não foi descartada: descarta antes de criar outra.
      dropGeneration_(Schema.pendingDrop());
      Schema.setPendingDrop(0);
    }
    var next = gen + 1;
    var opts = Schema.renewOptions();
    var names = Schema.names();
    for (var i = 0; i < names.length; i++) {
      if (!budget.hasTime(45000)) throw Util.appError('BUDGET', 'Tempo insuficiente para concluir a renovação; continua amanhã.');
      BigQueryClient.ddl(Schema.dropTableSql(names[i], next), 'renew_cleanup');
      BigQueryClient.ddl(Schema.renewSql(names[i], gen, next, opts), 'renew_table');
      var info = BigQueryClient.tableInfo(Schema.physical(names[i], next));
      if (!info.exists) throw Util.appError('QUERY_FAILED', 'Renovação não criou a tabela ' + names[i]);
      BigQueryClient.addLifetimeBytes(info.numBytes);
    }
    // Se a recriação das views falhar no meio, o pipeline as refaz (VIEWS_DIRTY) e o descarte espera.
    props_().setProperty('VIEWS_DIRTY', '1');
    Schema.setGeneration(next);
    recreateViews_(next);
    props_().deleteProperty('VIEWS_DIRTY');
    Schema.setPendingDrop(gen);
    props_().setProperty(KEYS.dropAt, String(Util.now() + 20 * 3600000));
    Repository.bumpDataVersion();
    Monitoring.count(run, 'renewed_generation', next);
    Monitoring.log('info', 'generation_renewed', { from: gen, to: next });
    return true;
  }

  /** Descarte adiado (≥ 20 h depois da troca), para leituras em voo terminarem. */
  function dropPreviousIfDue_(run) {
    var prev = Schema.pendingDrop();
    if (!prev) return;
    if (Util.now() < Number(props_().getProperty(KEYS.dropAt) || 0)) return;
    if (props_().getProperty('VIEWS_DIRTY')) {
      // Views ainda podem apontar para a geração anterior: recria antes de descartar.
      recreateViews_(Schema.generation());
      props_().deleteProperty('VIEWS_DIRTY');
    }
    dropGeneration_(prev);
    Schema.setPendingDrop(0);
    props_().deleteProperty(KEYS.dropAt);
    Monitoring.count(run, 'dropped_generation', prev);
  }

  function dropGeneration_(gen) {
    if (!gen || gen === Schema.generation()) return;
    Schema.names().forEach(function (name) {
      BigQueryClient.ddl(Schema.dropTableSql(name, gen), 'drop_generation');
    });
  }

  /** Views também expiram no Sandbox: recria as que estão perto de expirar. */
  function refreshViewsIfNeeded_(run) {
    var gen = Schema.generation();
    var stale = Schema.VIEW_ORDER.some(function (short) {
      var info = BigQueryClient.tableInfo('v_' + short);
      if (!info.exists) return true;
      return info.expirationTime && (info.expirationTime - Util.now()) / Util.DAY_MS < VIEW_REFRESH_DAYS;
    });
    if (!stale) return;
    recreateViews_(gen);
    // Se CREATE OR REPLACE não renovou a expiração, recria do zero.
    var still = Schema.VIEW_ORDER.filter(function (short) {
      var info = BigQueryClient.tableInfo('v_' + short);
      return !info.exists || (info.expirationTime && (info.expirationTime - Util.now()) / Util.DAY_MS < VIEW_REFRESH_DAYS);
    });
    if (still.length) {
      still.slice().reverse().forEach(function (short) {
        BigQueryClient.deleteTable('v_' + short);
      });
      recreateViews_(gen);
    }
    Monitoring.count(run, 'views_refreshed');
  }

  /** Tabelas e views da geração vigente e dias até expirar. */
  function tablesStatus() {
    var gen = Schema.generation();
    var out = [];
    Schema.names().forEach(function (name) {
      var info = BigQueryClient.tableInfo(Schema.physical(name, gen));
      out.push(statusRow_(name, Schema.physical(name, gen), gen, info));
    });
    Schema.VIEW_ORDER.forEach(function (short) {
      var info = BigQueryClient.tableInfo('v_' + short);
      out.push(statusRow_('v_' + short, 'v_' + short, gen, info));
    });
    return out;
  }

  function statusRow_(name, physicalName, gen, info) {
    return {
      name: name, physical: physicalName, generation: gen, exists: !!info.exists,
      ageDays: info.exists ? Util.round(tableAgeDays_(info), 1) : null,
      expiresInDays: info.exists && info.expirationTime ? Util.round((info.expirationTime - Util.now()) / Util.DAY_MS, 1) : null,
      rows: info.exists ? info.numRows : 0, bytes: info.exists ? info.numBytes : 0,
    };
  }

  function expiryAlerts_() {
    var alerts = [];
    tablesStatus().forEach(function (t) {
      if (!t.exists) alerts.push('Objeto ausente no BigQuery: ' + t.name + '.');
      else if (t.expiresInDays !== null && t.expiresInDays < EXPIRY_ALERT_DAYS) alerts.push(t.name + ' expira em ' + t.expiresInDays + ' dias.');
    });
    return alerts;
  }

  /** Remove contadores antigos das Propriedades (o armazenamento é limitado a 500 KB). */
  function pruneProperties_() {
    var p = props_();
    var all = p.getKeys();
    var dayLimit = Util.addDays(Util.todayYmd(), -40);
    var monthLimit = Util.addDays(Util.todayYmd(), -400).slice(0, 7);
    all.forEach(function (k) {
      var m = /^AI_USAGE_D_(\d{4}-\d{2}-\d{2})$/.exec(k);
      if (m && m[1] < dayLimit) p.deleteProperty(k);
      var mm = /^(?:AI_USAGE_M_|BQ_QUERY_BYTES_)(\d{4}-\d{2})$/.exec(k);
      if (mm && mm[1] < monthLimit) p.deleteProperty(k);
    });
  }

  // ------------------------------------------------------ diagnóstico ----
  /**
   * Checagens reais e somente leitura para o primeiro deploy: Gmail, BigQuery,
   * tabelas/views, gatilhos e IA. Sem conteúdo de e-mail nem segredos.
   * @return {{ok: boolean, checks: Array<{name: string, ok: boolean, detail: string}>}}
   */
  function liveChecks() {
    var checks = [];
    function check(name, fn) {
      try {
        var detail = fn();
        checks.push({ name: name, ok: true, detail: String(detail || 'ok') });
      } catch (e) {
        checks.push({ name: name, ok: false, detail: Monitoring.classify(e, name).code + ': ' + (Util.apiDisabledHint(e) || Util.sanitizeError(e)) });
      }
    }
    check('gmail_perfil', function () {
      var p = GmailClient.profile();
      var owner = String(Config.secret('ownerEmail') || '').toLowerCase();
      if (owner && p.emailAddress !== owner) throw Util.appError('AUTH', 'A caixa lida não é a do dono configurado.');
      return 'caixa do dono acessível (somente leitura); historyId ' + (p.historyId ? 'presente' : 'ausente');
    });
    check('gmail_listagem', function () {
      return GmailClient.listPage('newer_than:2d', '', null, null, 5).ids.length + ' mensagem(ns) recente(s) visível(is)';
    });
    check('bigquery_consulta', function () {
      var r = BigQueryClient.query('SELECT 1 AS ok', {}, { name: 'diagnose', maxRows: 1 });
      if (!r.rows.length) throw Util.appError('QUERY_FAILED', 'Consulta de teste sem resultado.');
      return 'consulta parametrizada ok (' + Config.bqLocation() + ')';
    });
    check('bigquery_objetos', function () {
      var t = tablesStatus();
      var missing = t.filter(function (x) { return !x.exists; }).map(function (x) { return x.name; });
      if (missing.length) throw Util.appError('CONFIG', 'Ausentes: ' + missing.join(', ') + '. Execute setup().');
      var soon = t.filter(function (x) { return x.expiresInDays !== null && x.expiresInDays < EXPIRY_ALERT_DAYS; }).map(function (x) { return x.name; });
      return t.length + ' tabelas/views presentes' + (soon.length ? '; expirando em breve: ' + soon.join(', ') : '');
    });
    check('bigquery_view_inbox', function () {
      var r = BigQueryClient.query('SELECT COUNT(*) AS n FROM ' + BigQueryClient.tableRef('v_inbox'), {}, { name: 'diagnose_inbox', maxRows: 1 });
      return (r.rows[0] ? r.rows[0].n : 0) + ' mensagem(ns) na caixa inteligente';
    });
    check('gatilhos', function () {
      var hs = list().map(function (x) { return x.handler; });
      if (hs.indexOf(HANDLERS.pipeline) < 0 || hs.indexOf(HANDLERS.maintenance) < 0) throw Util.appError('CONFIG', 'Gatilhos ausentes: execute setupTriggers().');
      return hs.join(', ');
    });
    check('ia', function () {
      var s = AiClient.status();
      return s.provider === 'none' ? 'desativada (sem chave): funcionando só com regras' : s.provider + ' · política efetiva ' + s.policy + (s.consent ? '' : ' (aguardando consentimento)');
    });
    return { ok: checks.every(function (c) { return c.ok; }), checks: checks };
  }

  return {
    HANDLERS: HANDLERS,
    liveChecks: liveChecks,
    isSetupDone: isSetupDone,
    missingSetup: missingSetup,
    setup: setup,
    install: install,
    uninstall: uninstall,
    list: list,
    scheduleOneShot: scheduleOneShot,
    consumeOneShot: consumeOneShot,
    assertTriggerOwner: assertTriggerOwner,
    maintenance: maintenance,
    recreateViews: recreateViews_,
    viewsOutdated: viewsOutdated,
    tablesStatus: tablesStatus,
  };
})();
