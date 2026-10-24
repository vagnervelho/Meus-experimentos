/**
 * Pontos de entrada do Apps Script. São as ÚNICAS funções de topo do projeto
 * (um teste estático garante isso); toda a lógica vive em namespaces.
 *
 * - doGet/include: Web App (deploy "Executar como: eu", "Acesso: somente eu").
 * - api*: chamadas do cliente via google.script.run (sempre via Api.handle).
 * - runPipeline/runMaintenance: gatilhos de tempo.
 * - setup/setupTriggers/uninstallTriggers/runBackfillNow/diagnose: editor.
 */

function doGet() {
  return Api.page();
}

function include(name) {
  return Api.include(name);
}

// --------------------------------------------------------------- leitura ----
function apiBootstrap() {
  return Api.handle('bootstrap', {}, DashboardService.bootstrap);
}
function apiGetRadar(req) {
  return Api.handle('radar', req, DashboardService.radar);
}
function apiListMessages(req) {
  return Api.handle('list_messages', req, DashboardService.listMessages);
}
function apiGetMessage(req) {
  return Api.handle('get_message', req, DashboardService.getMessage);
}
function apiListTasks(req) {
  return Api.handle('list_tasks', req, DashboardService.listTasks);
}
function apiListOpportunities(req) {
  return Api.handle('list_opportunities', req, DashboardService.listOpportunities);
}
function apiGetNews(req) {
  return Api.handle('news', req, DashboardService.news);
}
function apiGetSenders(req) {
  return Api.handle('senders', req, DashboardService.senders);
}
function apiSearch(req) {
  return Api.handle('search', req, SearchService.search);
}
function apiGetSystemStatus() {
  return Api.handle('system_status', {}, DashboardService.systemStatus);
}
function apiGetQualitySample() {
  return Api.handle('quality_sample', {}, DashboardService.qualitySample);
}
function apiGetSettings() {
  return Api.handle('get_settings', {}, DashboardService.getSettings);
}
function apiAiDryRun(req) {
  return Api.handle('ai_dry_run', req, DashboardService.aiDryRun);
}

// ----------------------------------------------------- escrita (do app) ----
// Nada aqui escreve no Gmail: feedback, preferências e consentimento ficam no próprio app.
function apiSubmitFeedback(req) {
  return Api.handle('feedback', req, function (r) {
    Repository.queueFeedback({ targetType: r.targetType, targetId: r.targetId, messageId: r.messageId, type: r.type, payload: r.payload || {} });
    return { saved: true, pending: Repository.pendingFeedback().length };
  });
}
function apiSaveSettings(req) {
  return Api.handle('save_settings', req, DashboardService.saveSettings);
}
function apiSetAiConsent(req) {
  return Api.handle('ai_consent', req, DashboardService.setAiConsent);
}
function apiRunSyncNow() {
  return Api.handle('run_sync_now', {}, function () {
    return Triggers.scheduleOneShot();
  });
}
function apiMarkVisit() {
  return Api.handle('mark_visit', {}, DashboardService.markVisit);
}

// -------------------------------------------------------------- gatilhos ----
function runPipeline(e) {
  Triggers.assertTriggerOwner();
  var fromTrigger = !!(e && e.triggerUid);
  if (!fromTrigger) Api.assertOwner();
  var oneShot = Triggers.consumeOneShot(e);
  return Pipeline.run(fromTrigger ? (oneShot ? 'ONE_SHOT' : 'TIME') : 'MANUAL');
}

function runMaintenance(e) {
  Triggers.assertTriggerOwner();
  if (!(e && e.triggerUid)) Api.assertOwner();
  return Triggers.maintenance(e && e.triggerUid ? 'TIME' : 'MANUAL');
}

// ---------------------------------------------------------------- editor ----
// Funções de editor também são chamáveis por google.script.run: exigem o dono
// (no editor, o usuário ativo é quem executa).
function setup() {
  Api.assertOwner();
  var r = Triggers.setup();
  console.log(JSON.stringify(r));
  return r;
}

function setupTriggers() {
  Api.assertOwner();
  return Triggers.install();
}

function uninstallTriggers() {
  Api.assertOwner();
  return Triggers.uninstall();
}

function runBackfillNow() {
  Api.assertOwner();
  Pipeline.restartBackfill();
  return Triggers.scheduleOneShot();
}

/** Relatório de diagnóstico sem segredos nem conteúdo (para o log do editor). */
function diagnose() {
  Api.assertOwner();
  var report = {
    version: Config.APP_VERSION,
    setupDone: Triggers.isSetupDone(),
    missing: Triggers.missingSetup(),
    triggers: Triggers.list(),
    sync: Pipeline.syncState(),
    ai: DashboardService.aiInfo(),
    lastRun: Monitoring.lastRun(),
    triggerMinutes24h: Monitoring.triggerMinutesLast24h(),
    bqLifetimeBytes: BigQueryClient.lifetimeBytes(),
    generation: Schema.generation(),
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}
