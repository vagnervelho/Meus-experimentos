/**
 * Fronteira do Web App: página, includes, verificação do dono e envelope das
 * respostas. Erros viram {ok:false, error:{code, message}} com mensagem segura.
 */
var Api = (function () {
  var INCLUDES = ['styles', 'client'];
  var FRIENDLY = {
    CONFIG: 'Configuração incompleta. Veja a tela de Sistema ou execute setup().',
    AUTH: 'Sem permissão para acessar o Gmail ou o BigQuery. Reautorize o app no editor do Apps Script.',
    DENIED: 'Acesso negado: este app é de uso exclusivo do dono.',
    VALIDATION: 'Requisição inválida.',
    QUOTA: 'Cota do Google atingida. Tente novamente mais tarde.',
    RATE: 'Muitas requisições em pouco tempo. Tente de novo em instantes.',
    TIMEOUT: 'A consulta demorou demais. Tente de novo.',
    UPSTREAM: 'Serviço do Google indisponível no momento. Tente de novo.',
    QUERY_FAILED: 'A consulta ao BigQuery falhou.',
    NOT_FOUND: 'Item não encontrado.',
    LOCKED: 'Há uma sincronização em andamento. Tente de novo em alguns minutos.',
    INTERNAL: 'Erro inesperado. Detalhes técnicos ficam no log de execuções.',
  };
  // Códigos cujas mensagens são escritas pelo próprio app (seguras para exibir).
  var OWN_MESSAGE = ['CONFIG', 'VALIDATION', 'NOT_FOUND', 'DENIED', 'LOCKED'];

  function page() {
    return HtmlService.createTemplateFromFile('index').evaluate()
      .setTitle('Inbox Intelligence')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  function include(name) {
    if (INCLUDES.indexOf(String(name)) < 0) throw Util.appError('VALIDATION', 'Include não permitido.');
    return HtmlService.createHtmlOutputFromFile(String(name)).getContent();
  }

  /** Só o dono usa o app (o deploy já é "Somente eu"; isto é defesa em profundidade). */
  function assertOwner() {
    var active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
    var owner = String(Config.secret('ownerEmail') || Session.getEffectiveUser().getEmail() || '').toLowerCase();
    if (!active) {
      if (String(Config.secret('allowEmptyActiveUser') || '') === 'true') return;
      throw Util.appError('DENIED', 'Não foi possível identificar o usuário ativo.');
    }
    if (!owner || active !== owner) throw Util.appError('DENIED', 'Acesso negado.');
  }

  function plain_(v) {
    return v === undefined ? null : JSON.parse(JSON.stringify(v));
  }

  /**
   * Executa um endpoint com verificação do dono e envelope padronizado.
   * @param {string} name
   * @param {*} req
   * @param {function(*): *} fn
   */
  function handle(name, req, fn) {
    var t0 = Util.now();
    Util.resetMemo();
    try {
      assertOwner();
      var data = fn(req && typeof req === 'object' ? req : {});
      var cached = !!(data && data._cached);
      if (data && typeof data === 'object') delete data._cached;
      Monitoring.log('info', 'api', { endpoint: name, ms: Util.now() - t0, cached: cached });
      return { ok: true, data: plain_(data), meta: { generatedAt: Util.nowIso(), cached: cached } };
    } catch (e) {
      var c = Monitoring.classify(e, 'api_' + name);
      var code = FRIENDLY[c.code] ? c.code : 'INTERNAL';
      var message = OWN_MESSAGE.indexOf(code) >= 0 && e && e.message ? Util.sanitizeError(e) : FRIENDLY[code];
      Monitoring.log('warn', 'api_error', { endpoint: name, code: code, http: c.http });
      return { ok: false, error: { code: code, message: message } };
    }
  }

  return {
    page: page,
    include: include,
    assertOwner: assertOwner,
    handle: handle,
  };
})();
