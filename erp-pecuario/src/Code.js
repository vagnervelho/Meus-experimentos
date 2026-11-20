/**
 * Code — as únicas funções globais públicas do projeto (01-arquitetura.md, seção 4.1). Toda função global sem "_" no
 * fim é chamável do navegador por google.script.run; por isso a lista é fechada nestas oito e cada uma começa pela
 * guarda de dono. A lógica fica nos namespaces (Api, Maintenance, TestRunner...).
 *
 *  - doGet: a página do app (ou a de acesso negado);
 *  - api: a única porta de negócio (todas as rotas; devolve sempre o envelope, nunca lança);
 *  - setup, runAcceptanceTests, runDiagnostics, verifyIntegrity: o dono roda no editor do Apps Script;
 *  - trgManutencaoDiaria, trgIntegridadeSemanal: gatilhos de tempo (reconhecidos pelo triggerUid).
 */

/** Guarda de dono: {usuario} ou, com `semLancar`, {usuario: null, erro} em vez de lançar DENIED. */
function assertOwner_(evento, semLancar) {
  try {
    return { usuario: Api.assertOwner({ evento: evento }), erro: null };
  } catch (e) {
    if (!semLancar) throw e;
    return { usuario: null, erro: e };
  }
}

/** Para os templates HTML: `<?!= include_('Styles') ?>` (só arquivos da lista branca de Api.INCLUDES). */
function include_(nome) {
  return Api.incluir(nome);
}

function doGet(e) {
  var guarda = assertOwner_(null, true);
  if (guarda.erro) return Api.paginaNegada(guarda.erro);
  return Api.pagina(e);
}

function api(pedido) {
  var guarda = assertOwner_(null, true);
  return Api.tratar(pedido, guarda);
}

function setup() {
  var guarda = assertOwner_();
  return Api.executarNoEditor('setup', function () {
    return Maintenance.setup({ usuario: guarda.usuario, fuso: Session.getScriptTimeZone() });
  });
}

function runAcceptanceTests() {
  var guarda = assertOwner_();
  return Api.executarNoEditor('runAcceptanceTests', function () {
    return TestRunner.runAcceptanceTests({ usuario: guarda.usuario });
  });
}

function runDiagnostics() {
  var guarda = assertOwner_();
  return Api.executarNoEditor('runDiagnostics', function () {
    return TestRunner.runDiagnostics({ usuario: guarda.usuario });
  });
}

function verifyIntegrity() {
  var guarda = assertOwner_();
  return Api.executarNoEditor('verifyIntegrity', function () {
    return AuditService.verificarIntegridade(Api.contexto({ usuario: guarda.usuario })).dados;
  });
}

function trgManutencaoDiaria(e) {
  var guarda = assertOwner_(e);
  return Api.executarNoEditor('trgManutencaoDiaria', function () {
    return Maintenance.manutencaoDiaria(Api.contexto({ usuario: guarda.usuario }));
  });
}

function trgIntegridadeSemanal(e) {
  var guarda = assertOwner_(e);
  return Api.executarNoEditor('trgIntegridadeSemanal', function () {
    return Maintenance.integridadeSemanal(Api.contexto({ usuario: guarda.usuario }));
  });
}
