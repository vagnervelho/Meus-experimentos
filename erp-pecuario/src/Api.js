/**
 * Api — fronteira do Web App (01-arquitetura.md, seções 3 a 5; desenho-base, seções 2, 15.3, 16.3 e 17).
 *
 * Guarda de dono (com a contingência ALLOW_EMPTY_ACTIVE_USER e o reconhecimento de gatilho por triggerUid), roteador
 * de TODAS as rotas da lista canônica (as de módulo de fase futura respondem NOT_FOUND dizendo a fase), montagem do
 * contexto de execução (banco de produção, de TESTE ou de DEMO, escolhido pelo campo `ambiente` do pedido e nunca por
 * ID vindo do cliente) e envelope {ok, data | error, meta: {dataVersion, appVersion, serverTime}}, sempre serializado
 * por JSON (nenhum Date escapa). Comandos vão pela UnitOfWork (dentro dos serviços); consultas, pela leitura otimista.
 * Também: carga inicial condicional, estado da operação por chave, rascunho no servidor (propriedades do USUÁRIO, fora
 * da planilha; seção 17, SP-06) e inclusão de arquivos HTML por lista branca.
 */
var Api = (function () {
  /** Versão do app no envelope (o cliente mostra "nova versão — recarregar" quando muda). = package.json. */
  var APP_VERSION = '0.1.0';
  var TITULO = 'ERP Pecuário';
  var VIEWPORT = 'width=device-width, initial-scale=1';
  var PAGINA = 'Index';
  /** Arquivos HTML que um template pode incluir (01-arquitetura.md, seção 6.2). Outro nome → VALIDATION. */
  var INCLUDES = Object.freeze(['Styles', 'JavaScript', 'Components', 'Dashboard', 'Animals', 'Pastures', 'Events', 'Weights', 'Health', 'Reproduction', 'Financial', 'Reports', 'Settings', 'Import']);
  /**
   * Telas carregadas sob demanda (01, seção 6.2; risco R-31): não entram na página inicial e vão ao aparelho pela rota
   * `sistema.tela` quando o menu abre o módulo. Arquivo → módulo do EventCatalog (que declara `tela` e `sob_demanda`
   * quando o módulo é entregue). As das Fases 3 a 5 e a importação.
   */
  var TELAS_SOB_DEMANDA = Object.freeze({ Import: 'IMPORTACAO', Weights: 'PESAGENS', Health: 'SANIDADE', Reproduction: 'REPRODUCAO', Financial: 'FINANCEIRO', Reports: 'RELATORIOS' });
  var AMBIENTES = Object.freeze(['PRODUCAO', 'TESTE', 'DEMO']);
  var FAIXA_TESTE = 'BASE DE TESTE';
  var PROP_DONO = 'OWNER_EMAIL';
  var PROP_SEM_EMAIL = 'ALLOW_EMPTY_ACTIVE_USER';
  var CHAVE_MAX = 200;
  /** Rascunho no servidor: até 96 KB, em partes de 8 KB (um valor das Properties tem 9 KB); no máximo 40 guardados; vencem em 30 dias. */
  // Um rascunho grande (o lote de 80 animais do 08-ux-ui, seção 9) não cabe num valor das propriedades (9 KB): vai em
  // partes de até `parteBytes`, até `maxBytes` no total; os rascunhos juntos ficam abaixo de `totalBytes` (a cota do
  // store do usuário é 500 KB).
  var RASCUNHO = Object.freeze({ prefixo: 'RASCUNHO:', maxBytes: 96000, parteBytes: 8000, totalBytes: 400000, max: 40, validadeDias: 30 });
  var DIA_MS = 86400000;
  /** Rotas canônicas (desenho-base, seção 15.3), na ordem do desenho. Toda uma tem tratador ou NOT_FOUND explícito. */
  var ROTAS_CANONICAS = Object.freeze([
    'sistema.bootstrap', 'sistema.backup', 'sistema.restaurarBackup', 'sistema.integridade', 'operacao.status',
    'evento.simular', 'evento.registrar', 'evento.corrigir', 'evento.estornar', 'evento.listar', 'evento.obter',
    'animal.listar', 'animal.ficha', 'animal.editar', 'animal.cadastrarExterno', 'inventario.posicao',
    'inventario.elegiveis', 'pasto.listar', 'pasto.painel', 'pasto.salvar', 'propriedade.salvar', 'parceiro.salvar',
    'produto.salvar', 'protocolo.salvar', 'estacao.salvar', 'categoria.salvar', 'lista.salvar', 'conta.salvar',
    'preco.salvar', 'config.salvar', 'parcela.baixar', 'parcela.desfazerBaixa', 'financeiro.fluxoCaixa',
    'financeiro.resultado', 'financeiro.custosAnimal', 'sanidade.agenda', 'reproducao.indicadores', 'peso.desempenho',
    'dashboard.obter', 'alerta.listar', 'relatorio.obter', 'relatorio.exportar', 'importacao.criar',
    'importacao.validarBloco', 'importacao.importarBloco', 'importacao.concluir', 'importacao.desfazer',
    'anexo.adicionar', 'anexo.remover', 'anexo.obter', 'auditoria.listar',
  ]);

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function texto_(e) {
    return String(e && e.message ? e.message : e);
  }
  function validacao_(mensagem, campo) {
    return Validation.erro('VALIDATION', mensagem, campo ? [{ codigo: 'FORMATO_INVALIDO', campo: campo, mensagem: mensagem }] : []);
  }

  // ------------------------------------------------------------------ rotas ----
  // As funções `executar(ctx, pedido, info)` só citam os serviços quando chamadas (nada é lido na carga). Devolvem
  // {dados, dataVersion?, duplicado?, opId?, semAlteracao?, recuperada?}: a forma de UnitOfWork.run/read.
  function consulta_(fn) {
    return { tipo: 'CONSULTA', fase: 1, chave: false, executar: fn };
  }
  function comando_(fn, semChave) {
    return { tipo: 'COMANDO', fase: 1, chave: !semChave, executar: fn };
  }
  function manutencao_(fn) {
    return { tipo: 'MANUTENCAO', fase: 1, chave: false, executar: fn };
  }
  function futura_(fase, modulo) {
    return { tipo: 'FUTURA', fase: fase, modulo: modulo, chave: false, executar: null };
  }
  /** Consulta que não abre a planilha-banco (a tela sob demanda): sem contexto e sem versão dos dados no envelope. */
  function semBanco_(fn) {
    return { tipo: 'CONSULTA', fase: 1, chave: false, semBanco: true, executar: fn };
  }
  function rascunho_(acao) {
    return { tipo: 'RASCUNHO', fase: 1, chave: false, executar: function (ctx, p, info) { return rascunho(acao, p.dados, info); } };
  }
  function semDados_(r) {
    return { dados: r };
  }

  var ROTAS = {
    // Sistema
    'sistema.bootstrap': consulta_(function (ctx, p, info) { return bootstrap_(ctx, p, info); }),
    'sistema.estado': consulta_(function (ctx) { return semDados_(Maintenance.estado(ctx)); }),
    'sistema.diagnostico': consulta_(function (ctx) { return semDados_(diagnosticoSistema_(ctx)); }),
    'sistema.tela': semBanco_(function (ctx, p) { return semDados_(tela(p.dados)); }),
    'sistema.backup': manutencao_(function (ctx) { return semDados_(Maintenance.backup(ctx, { motivo: 'SOB_DEMANDA' })); }),
    'sistema.restaurarBackup': manutencao_(function (ctx, p) {
      var r = Maintenance.restaurar(ctx, { dados: p.dados });
      return { dados: r, dataVersion: r.dataVersion };
    }),
    'sistema.integridade': manutencao_(function (ctx, p) {
      if (p.dados.reparar === true) return semDados_(AuditService.repararIntegridade(ctx, p.dados.justificativa || null));
      return AuditService.verificarIntegridade(ctx);
    }),
    'operacao.status': consulta_(function (ctx, p) { return semDados_(UnitOfWork.status(ctx, p.dados.chave)); }),
    // Evento
    'evento.simular': consulta_(function (ctx, p) {
      var acao = vazio_(p.dados.acao) ? 'registrar' : p.dados.acao;
      if (['registrar', 'corrigir', 'estornar'].indexOf(acao) < 0) throw validacao_('A prévia é de registrar, corrigir ou estornar um evento (acao = "' + acao + '").', 'acao');
      return EventService.simular(ctx, { acao: acao, dados: p.dados.dados || {}, avisosAceitos: p.avisosAceitos });
    }),
    'evento.registrar': comando_(function (ctx, p) { return EventService.registrar(ctx, p); }),
    'evento.corrigir': comando_(function (ctx, p) { return EventService.corrigir(ctx, p); }),
    'evento.estornar': comando_(function (ctx, p) { return EventService.estornar(ctx, p); }),
    'evento.listar': consulta_(function (ctx, p) { return EventService.listar(ctx, p.dados); }),
    'evento.obter': consulta_(function (ctx, p) { return EventService.obter(ctx, p.dados); }),
    // Animal e inventário
    'animal.listar': consulta_(function (ctx, p) { return AnimalService.listar(ctx, p.dados); }),
    'animal.ficha': consulta_(function (ctx, p) { return AnimalService.ficha(ctx, p.dados); }),
    'animal.editar': comando_(function (ctx, p) { return AnimalService.editar(ctx, p); }),
    'animal.cadastrarExterno': comando_(function (ctx, p) { return AnimalService.cadastrarExterno(ctx, p); }),
    'inventario.posicao': consulta_(function (ctx, p) { return InventoryService.posicaoEm(ctx, p.dados); }),
    'inventario.elegiveis': consulta_(function (ctx, p) { return InventoryService.elegiveis(ctx, p.dados); }),
    'animal.resolver': consulta_(function (ctx, p) { return Identificacao.resolverRota(ctx, p.dados); }),
    // Pastos, propriedades e cadastros de apoio
    'pasto.listar': consulta_(function (ctx, p) { return PastureService.listar(ctx, p.dados); }),
    'pasto.painel': consulta_(function (ctx, p) { return PastureService.painel(ctx, p.dados); }),
    'pasto.salvar': comando_(function (ctx, p) { return PastureService.salvarPasto(ctx, p); }),
    'propriedade.salvar': comando_(function (ctx, p) { return PastureService.salvarPropriedade(ctx, p); }),
    'parceiro.salvar': comando_(function (ctx, p) { return Config.salvarParceiro(ctx, p); }),
    'produto.salvar': comando_(function (ctx, p) { return HealthService.salvarProduto(ctx, p); }),
    'protocolo.salvar': comando_(function (ctx, p) { return HealthService.salvarProtocolo(ctx, p); }),
    'estacao.salvar': comando_(function (ctx, p) { return ReproductionService.salvarEstacao(ctx, p); }),
    'categoria.salvar': comando_(function (ctx, p) { return Config.salvarCategoria(ctx, p); }),
    'lista.salvar': comando_(function (ctx, p) { return Config.salvarLista(ctx, p); }),
    'conta.salvar': futura_(4, 'Financeiro'),
    'preco.salvar': futura_(4, 'Financeiro'),
    'config.salvar': comando_(function (ctx, p) { return salvarConfig_(ctx, p); }),
    // Financeiro, manejo e gerencial
    'parcela.baixar': futura_(4, 'Financeiro'),
    'parcela.desfazerBaixa': futura_(4, 'Financeiro'),
    'financeiro.fluxoCaixa': futura_(4, 'Financeiro'),
    'financeiro.resultado': futura_(4, 'Financeiro'),
    'financeiro.custosAnimal': futura_(4, 'Financeiro'),
    // Os vencimentos do "Dividir em parcelas" (o aparelho não soma dias; CONTRATOS, seção 51).
    'financeiro.vencimentos': consulta_(function (ctx, p) { return semDados_(FinancialService.vencimentos(p.dados)); }),
    'sanidade.agenda': consulta_(function (ctx, p) { return HealthService.agenda(ctx, p.dados); }),
    'reproducao.indicadores': consulta_(function (ctx, p) { return ReproductionService.indicadores(ctx, p.dados); }),
    'reproducao.matrizes': consulta_(function (ctx, p) { return ReproductionService.matrizes(ctx, p.dados); }),
    'peso.desempenho': consulta_(function (ctx, p) { return WeightService.desempenho(ctx, p.dados); }),
    'dashboard.obter': consulta_(function (ctx, p) { return InventoryService.visaoGeral(ctx, p.dados); }),
    'alerta.listar': consulta_(function (ctx) { return InventoryService.listarAlertas(ctx, Maintenance.estado(ctx).alertas_estado); }),
    'relatorio.obter': futura_(5, 'Relatórios'),
    'relatorio.exportar': futura_(5, 'Relatórios'),
    // Importação (as chaves de importarBloco, concluir e desfazer são derivadas do import_id pelo ImportService)
    'importacao.criar': comando_(function (ctx, p) { return ImportService.criar(ctx, p); }),
    'importacao.validarBloco': comando_(function (ctx, p) { return ImportService.validarBloco(ctx, p); }),
    'importacao.importarBloco': comando_(function (ctx, p) { return ImportService.importarBloco(ctx, p); }, true),
    'importacao.concluir': comando_(function (ctx, p) { return ImportService.concluir(ctx, p); }, true),
    'importacao.desfazer': comando_(function (ctx, p) { return ImportService.desfazer(ctx, p); }, true),
    'importacao.obter': consulta_(function (ctx, p) { return ImportService.obter(ctx, p.dados); }),
    'importacao.previa': consulta_(function (ctx, p) { return ImportService.previaArquivo(ctx, p.dados); }),
    'importacao.linhas': consulta_(function (ctx, p) { return UnitOfWork.read(ctx, ImportService.consultaLinhas(p.dados)); }),
    'importacao.relatorio': consulta_(function (ctx, p) { return UnitOfWork.read(ctx, ImportService.consultaRelatorio(p.dados)); }),
    'importacao.listar': consulta_(function (ctx) { return UnitOfWork.read(ctx, ImportService.consultaListar()); }),
    'importacao.modelo': consulta_(function (ctx, p) { return semDados_(ImportService.modelo((p.dados || {}).tipo)); }),
    'importacao.reconciliacao': consulta_(function (ctx) { return UnitOfWork.read(ctx, ImportService.consultaReconciliacao()); }),
    // Anexos e auditoria
    'anexo.adicionar': comando_(function (ctx, p) { return FileService.adicionarAnexo(ctx, p); }),
    'anexo.remover': comando_(function (ctx, p) { return FileService.removerAnexo(ctx, p); }),
    'anexo.obter': consulta_(function (ctx, p) { return FileService.obterAnexo(ctx, p.dados); }),
    'auditoria.listar': consulta_(function (ctx, p) { return AuditService.listarAuditoria(ctx, p.dados); }),
    // Rascunho no servidor (seção 17, SP-06): propriedades do usuário, fora da planilha.
    'rascunho.salvar': rascunho_('salvar'),
    'rascunho.obter': rascunho_('obter'),
    'rascunho.remover': rascunho_('remover'),
  };

  /** Tabela das rotas para conferência: {rota: {tipo, fase, modulo, exigeChave}}. */
  function rotas() {
    var out = {};
    Object.keys(ROTAS).forEach(function (r) {
      var d = ROTAS[r];
      out[r] = { tipo: d.tipo, fase: d.fase, modulo: d.modulo || null, exigeChave: d.chave };
    });
    return out;
  }

  // ------------------------------------------------------------------ guarda de dono ----
  /**
   * Defesa em profundidade (o Web App já é "executar como eu, acesso só meu"; 01, seção 4.2). Devolve o e-mail de
   * quem executa (minúsculas). o: {props (retrato já lido), evento (objeto do gatilho)}. Erro: DENIED.
   *  - gatilho: `evento.triggerUid` precisa ser de um gatilho instalado do projeto → usuário = dono;
   *  - e-mail ativo igual ao dono (OWNER_EMAIL; na falta, o usuário efetivo, que é quem implantou) → passa;
   *  - e-mail ativo vazio → só com ALLOW_EMPTY_ACTIVE_USER = true (contingência ligada à mão), e o usuário é o dono.
   */
  function assertOwner(opcoes) {
    var o = opcoes || {};
    var props = o.props || Database.props().ler();
    var dono = String(props[PROP_DONO] || Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
    var ev = o.evento;
    if (ev && typeof ev === 'object' && !vazio_(ev.triggerUid)) {
      var uid = String(ev.triggerUid);
      var conhecido = ScriptApp.getProjectTriggers().some(function (t) { return t.getUniqueId() === uid; });
      if (!conhecido) throw Validation.erro('DENIED', 'Chamada de rotina automática não reconhecida: o gatilho não pertence a este sistema.');
      if (!dono) throw Validation.erro('DENIED', 'O dono do sistema não está registrado. Execute a configuração inicial (setup).');
      return dono;
    }
    var ativo = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    if (!ativo) {
      if (String(props[PROP_SEM_EMAIL] || '').trim().toLowerCase() === 'true' && dono) return dono;
      throw Validation.erro('DENIED', 'Não foi possível identificar a conta Google que abriu o sistema. Abra o link num perfil do navegador só com a conta dona; se continuar, siga o guia de implantação (opção ALLOW_EMPTY_ACTIVE_USER).');
    }
    if (!dono || ativo !== dono) throw Validation.erro('DENIED', 'Acesso negado: este sistema é de uso exclusivo do dono.');
    return ativo;
  }

  // ------------------------------------------------------------------ contexto ----
  /**
   * Contexto de execução de um pedido: banco do ambiente (PRODUCAO = SPREADSHEET_ID; TESTE e DEMO = TEST_/DEMO_
   * SPREADSHEET_ID), forma de gravação do banco, portas reais (Maintenance.contexto) e o fuso de "hoje" = o fuso da
   * planilha-banco, que o setup e o config.salvar mantêm igual a CONFIGURACOES.fuso (a integridade confere).
   * o: {ambiente, usuario, props}. Erros: CONFIG (sem banco; planilha inacessível), VALIDATION (ambiente).
   */
  function contexto(opcoes) {
    var o = opcoes || {};
    var ambiente = vazio_(o.ambiente) ? 'PRODUCAO' : o.ambiente;
    var ctx = Maintenance.contexto({ ambiente: ambiente, usuario: o.usuario, props: o.props });
    try {
      ctx.fuso = ctx.io.fuso();
    } catch (e) {
      if (Validation.ehAppError(e)) throw e;
      console.error('Api.contexto: planilha-banco inacessível: ' + texto_(e));
      var cfg = Validation.erro('CONFIG', 'Não foi possível abrir a planilha-banco' + (ambiente === 'PRODUCAO' ? '' : ' da base de teste') + '. Se ela foi apagada ou está na lixeira, restaure um backup pelo sistema; senão, tente de novo em instantes.');
      cfg.causa = texto_(e);
      throw cfg;
    }
    ctx.session = { usuario: o.usuario, ambiente: ambiente, base_de_teste: ambiente !== 'PRODUCAO' };
    return ctx;
  }
  function ambienteInfo_(ambiente) {
    var teste = ambiente !== 'PRODUCAO';
    return { codigo: ambiente, base_de_teste: teste, faixa: teste ? FAIXA_TESTE : null };
  }

  // ------------------------------------------------------------------ pedido e envelope ----
  function normalizarPedido_(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw validacao_('O pedido chegou vazio ou malformado. Recarregue a página e tente de novo.');
    var rota = typeof b.rota === 'string' ? b.rota.trim() : '';
    if (!rota) throw validacao_('Pedido sem rota.', 'rota');
    var dados = b.dados === undefined || b.dados === null ? {} : b.dados;
    if (typeof dados !== 'object' || Array.isArray(dados)) throw validacao_('Os dados do pedido precisam ser um objeto.', 'dados');
    var chave = b.idempotencyKey === undefined || b.idempotencyKey === null ? '' : b.idempotencyKey;
    if (typeof chave !== 'string' || chave.length > CHAVE_MAX) throw validacao_('Chave de idempotência inválida (texto de até ' + CHAVE_MAX + ' caracteres).', 'idempotencyKey');
    var brutos = b.avisosAceitos === undefined || b.avisosAceitos === null ? [] : b.avisosAceitos;
    if (!Array.isArray(brutos)) throw validacao_('avisosAceitos precisa ser uma lista.', 'avisosAceitos');
    var avisos = [];
    brutos.forEach(function (a) {
      var codigo = typeof a === 'string' ? a : a && typeof a === 'object' ? a.codigo : null;
      if (typeof codigo !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(codigo)) throw validacao_('Aviso aceito inválido: cada item é o código do aviso ou {codigo, animal_id, justificativa}.', 'avisosAceitos');
      if (avisos.indexOf(codigo) < 0) avisos.push(codigo);
    });
    var dv = b.dataVersionEsperada;
    if (dv !== undefined && dv !== null && (typeof dv !== 'number' || !isFinite(dv) || Math.floor(dv) !== dv || dv < 0)) throw validacao_('dataVersionEsperada precisa ser um número inteiro.', 'dataVersionEsperada');
    var ambiente = vazio_(b.ambiente) ? 'PRODUCAO' : b.ambiente;
    if (AMBIENTES.indexOf(ambiente) < 0) throw validacao_('Ambiente desconhecido: use PRODUCAO, TESTE ou DEMO.', 'ambiente');
    return { rota: rota, dados: dados, idempotencyKey: chave || null, avisosAceitos: avisos, dataVersionEsperada: dv === undefined || dv === null ? null : dv, ambiente: ambiente };
  }
  /** Cópia por JSON: nenhum Date, função ou undefined sai do servidor (P6). */
  function plano_(v) {
    return v === undefined ? null : JSON.parse(JSON.stringify(v));
  }
  /** Exceção inesperada (ou INTERNAL): detalhe no log de execuções e em ERROS_LOG, nunca para o cliente. */
  function registrarFalha_(ctx, rota, e, erro) {
    if (Validation.ehAppError(e) && e.code !== 'INTERNAL') return;
    console.error('api ' + (rota || '?') + ': ' + texto_(e) + (e && e.stack ? '\n' + String(e.stack).split('\n').slice(0, 6).join('\n') : ''));
    if (!ctx) return;
    try {
      UnitOfWork.anotarErro(ctx, { contexto: 'api:' + (rota || '?'), codigo: 'API_' + erro.code, mensagem: texto_(e), erro: e });
      UnitOfWork.descarregarErros(ctx);
    } catch (falha) {
      console.error('api ' + (rota || '?') + ': não foi possível gravar em ERROS_LOG: ' + texto_(falha));
    }
  }
  function versaoDe_(ctx) {
    try {
      return UnitOfWork.versao(ctx);
    } catch (e) {
      console.error('api: versão dos dados ilegível: ' + texto_(e));
      return null;
    }
  }

  /**
   * Trata um pedido de `google.script.run.api(...)`. `guarda` = {usuario} já conferido pelo Code.js (ou {erro}: o
   * DENIED vira envelope); sem guarda, confere aqui. Nunca lança: devolve o envelope.
   */
  function tratar(pedidoBruto, guarda) {
    var meta = { dataVersion: null, appVersion: APP_VERSION, serverTime: null };
    var ctx = null;
    var rota = null;
    var env;
    try {
      if (guarda && guarda.erro) throw guarda.erro;
      var props = Database.props().ler();
      var usuario = guarda && guarda.usuario ? guarda.usuario : assertOwner({ props: props });
      var p = normalizarPedido_(pedidoBruto);
      rota = p.rota;
      var def = Object.prototype.hasOwnProperty.call(ROTAS, p.rota) ? ROTAS[p.rota] : null;
      if (!def) throw Validation.erro('NOT_FOUND', 'Função desconhecida: "' + p.rota + '". Recarregue a página; se continuar, a versão do app pode estar desatualizada.');
      if (def.tipo === 'FUTURA') throw Validation.erro('NOT_FOUND', 'Esta função faz parte do módulo ' + def.modulo + ', que chega na fase ' + def.fase + ' e ainda não foi entregue.');
      if (def.chave && vazio_(p.idempotencyKey)) throw validacao_('Pedido de gravação sem chave de idempotência. Recarregue o formulário e tente de novo.', 'idempotencyKey');
      var pedido = { idempotencyKey: p.idempotencyKey, dados: p.dados, avisosAceitos: p.avisosAceitos, dataVersionEsperada: p.dataVersionEsperada };
      var info = { usuario: usuario, ambiente: p.ambiente, props: props };
      if (def.tipo !== 'RASCUNHO' && !def.semBanco) ctx = contexto({ ambiente: p.ambiente, usuario: usuario, props: props });
      var r = def.executar(ctx, pedido, info) || {};
      meta.dataVersion = typeof r.dataVersion === 'number' ? r.dataVersion : ctx ? versaoDe_(ctx) : null;
      if (def.tipo === 'COMANDO') {
        meta.duplicado = r.duplicado === true;
        meta.opId = r.opId || null;
        if (r.semAlteracao) meta.semAlteracao = true;
        if (r.recuperada) meta.recuperada = true;
      }
      env = { ok: true, data: r.dados === undefined ? null : r.dados, meta: meta };
    } catch (e) {
      var erro = Validation.serializarErro(e);
      registrarFalha_(ctx, rota, e, erro);
      if (ctx) meta.dataVersion = versaoDe_(ctx);
      env = { ok: false, error: erro, meta: meta };
    }
    meta.serverTime = Database.clock().agora();
    try {
      return plano_(env);
    } catch (e) {
      console.error('api ' + (rota || '?') + ': resposta não serializável: ' + texto_(e));
      return { ok: false, error: Validation.serializarErro(e), meta: { dataVersion: meta.dataVersion, appVersion: APP_VERSION, serverTime: meta.serverTime } };
    }
  }

  // ------------------------------------------------------------------ rotas com lógica própria ----
  /**
   * `sistema.bootstrap` (desenho-base, seção 8): com `dados.dataVersion` igual à versão atual e sem gravação em
   * curso, devolve só {atual: true} (o cache do cliente vale). Senão, numa leitura validada: configurações, listas,
   * categorias (com a cobertura), parceiros, propriedades, pastos (cartões de hoje, inclusive inativos), animais
   * ATIVOS + EXTERNOS em colunas, alertas; mais catálogo de eventos, módulos ativos, ambiente e estado do sistema.
   */
  function bootstrap_(ctx, p, info) {
    var d = p.dados;
    var props = ctx.props.ler();
    var versao = parseInt(props[UnitOfWork.chaveVersao(ctx.banco)], 10) || 0;
    var marcador = props[UnitOfWork.chaveMarcador(ctx.banco)];
    var ambiente = ambienteInfo_(info.ambiente);
    if (typeof d.dataVersion === 'number' && d.dataVersion === versao && vazio_(marcador)) {
      return { dados: { atual: true, dataVersion: versao, appVersion: APP_VERSION, ambiente: ambiente }, dataVersion: versao };
    }
    var estado = Maintenance.estado(ctx);
    var partes = {
      pastos: PastureService.consultaListar({ incluir_inativos: true }),
      animais: AnimalService.consultaCargaInicial(),
      alertas: InventoryService.consultaAlertas(estado.alertas_estado),
    };
    var reads = Config.LEITURAS_CADASTROS.concat(['PROPRIEDADES', 'ESTACOES_MONTA'], HealthService.LEITURAS_CADASTRO);
    var cru = false;
    Object.keys(partes).forEach(function (k) {
      reads = reads.concat(partes[k].reads || []);
      cru = cru || !!partes[k].acessoCru;
    });
    var r = UnitOfWork.read(ctx, {
      rota: 'sistema.bootstrap', reads: Utils.unicos(reads), acessoCru: cru,
      tratador: function (tx) {
        var out = { atual: false };
        var c = Config.cadastros(tx.repo);
        Object.keys(c).forEach(function (k) { out[k] = c[k]; });
        // Produtos (com o saldo) e protocolos sanitários: os cadastros da sanidade que alimentam os formulários (08, seção 16).
        var h = HealthService.cadastros(tx.repo);
        out.produtos = h.produtos;
        out.protocolos = h.protocolos;
        // Estações de monta: o formulário de reprodução sugere a estação da data (03a, seção 4.10).
        out.estacoes = ReproductionService.cadastros(tx.repo).estacoes;
        out.propriedades = Utils.ordenarPor(tx.repo.vigentes('PROPRIEDADES'), ['nome', 'property_id']).map(Utils.clonar);
        Object.keys(partes).forEach(function (k) { out[k] = partes[k].tratador(tx); });
        return out;
      },
    });
    var dados = r.dados;
    var catalogo = EventCatalog.serializar();
    dados.catalogo = catalogo;
    dados.modulos = catalogo.modulos;
    dados.dataVersion = r.dataVersion;
    dados.appVersion = APP_VERSION;
    dados.ambiente = ambiente;
    dados.usuario = info.usuario;
    dados.sistema = { primitiva: estado.primitiva, ultimo_backup: estado.ultimo_backup, integridade: estado.integridade, gatilhos: estado.gatilhos.length };
    return { dados: dados, dataVersion: r.dataVersion };
  }
  /**
   * `sistema.diagnostico` (tela de sistema): o que se confere sem planilha temporária nem dado sensível — sessão
   * (SP-04, `diagnosticoSessao`), forma de gravação, gatilhos esperados × instalados, fuso do script × da planilha,
   * versão dos dados e marcador de gravação em curso. O roteiro completo (SP-01 a SP-10) é o `runDiagnostics` do editor.
   */
  function diagnosticoSistema_(ctx) {
    var props = ctx.props.ler();
    var instalados = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    var esperados = Maintenance.GATILHOS.map(function (g) { return g.funcao; });
    var fusoPlanilha = null;
    try {
      fusoPlanilha = ctx.io.fuso();
    } catch (e) {
      console.error('diagnóstico: fuso da planilha ilegível: ' + texto_(e));
    }
    return {
      sessao: diagnosticoSessao(), primitiva: Maintenance.primitivaDoBanco(props, ctx.banco),
      gatilhos: { esperados: esperados, instalados: instalados, faltando: esperados.filter(function (f) { return instalados.indexOf(f) < 0; }) },
      fuso: { script: Session.getScriptTimeZone(), planilha: fusoPlanilha },
      data_version: parseInt(props[UnitOfWork.chaveVersao(ctx.banco)], 10) || 0, gravacao_em_curso: !vazio_(props[UnitOfWork.chaveMarcador(ctx.banco)]),
      app_version: APP_VERSION, editor: 'runDiagnostics',
    };
  }
  /** `config.salvar` + o fuso da planilha-banco acompanhando CONFIGURACOES.fuso (o "hoje" do servidor vem dele). */
  function salvarConfig_(ctx, p) {
    var r = Config.salvar(ctx, p);
    var chaves = r.dados && r.dados.chaves ? r.dados.chaves : [];
    if (chaves.indexOf('fuso') >= 0 && !r.duplicado) {
      var novo = Config.normalizar('fuso', p.dados.valores.fuso).texto;
      ctx.io.definirPropriedades({ fuso: novo, locale: 'pt_BR' });
      ctx.io.flush();
    }
    return r;
  }

  // ------------------------------------------------------------------ rascunho no servidor ----
  function bytesUtf8_(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  /** O texto em partes de até `max` bytes em UTF-8 (sem partir um caractere). */
  function partesUtf8_(texto, max) {
    var out = [];
    var ini = 0;
    var n = 0;
    for (var i = 0; i < texto.length; i++) {
      var c = texto.charCodeAt(i);
      var par = c >= 0xd800 && c <= 0xdbff;
      var b = c < 0x80 ? 1 : c < 0x800 ? 2 : par ? 4 : 3;
      if (n + b > max && i > ini) { out.push(texto.slice(ini, i)); ini = i; n = 0; }
      n += b;
      if (par) i++;
    }
    out.push(texto.slice(ini));
    return out;
  }
  /** Chave da parte p (1, 2, …) de um rascunho guardado em partes. */
  function parteRascunho_(k, p) { return k + '#' + p; }
  /** Apaga o rascunho e as partes dele (as de uma gravação anterior maior também). */
  function apagarRascunho_(store, k, todos) {
    store.deleteProperty(k);
    Object.keys(todos || store.getProperties()).forEach(function (chave) { if (chave.indexOf(k + '#') === 0) store.deleteProperty(chave); });
  }
  /**
   * Rascunho de formulário guardado no servidor quando o `localStorage` do iframe não serve (seção 17, SP-06):
   * propriedades do USUÁRIO (fora da planilha e do journal; não mudam a versão dos dados), chave
   * `RASCUNHO:<ambiente>:<chave>`; acima de um valor das propriedades, o texto vai em partes (`<chave>#1`, `#2`…) e a
   * chave guarda só quantas são. dados: {chave (letras, números, . _ : -; até 100), conteudo (salvar)}.
   * salvar → {chave, salvo_em, bytes, partes}; obter → {chave, existe, conteudo, salvo_em}; remover → {chave, removido}.
   * Erros VALIDATION: chave inválida, sem conteúdo, acima de 96 KB, mais de 40 rascunhos guardados, rascunhos juntos
   * acima de 400 KB.
   */
  function rascunho(acao, dados, info) {
    var d = dados || {};
    if (typeof d.chave !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(d.chave)) throw validacao_('Identificação do rascunho inválida.', 'chave');
    var ambiente = info && info.ambiente ? info.ambiente : 'PRODUCAO';
    var k = RASCUNHO.prefixo + ambiente + ':' + d.chave;
    var store = PropertiesService.getUserProperties();
    if (acao === 'obter') {
      var t = store.getProperty(k);
      if (t === null) return { dados: { chave: d.chave, existe: false, conteudo: null, salvo_em: null } };
      var o;
      try {
        o = JSON.parse(t);
        if (typeof o.partes === 'number') {
          var juntas = '';
          for (var p = 1; p <= o.partes; p++) {
            var parte = store.getProperty(parteRascunho_(k, p));
            if (parte === null) throw new Error('parte ' + p + ' ausente');
            juntas += parte;
          }
          o = JSON.parse(juntas);
        }
      } catch (e) {
        throw Validation.erro('INTERNAL', 'O rascunho guardado está ilegível. Descarte-o e preencha o formulário de novo.');
      }
      return { dados: { chave: d.chave, existe: true, conteudo: o.conteudo, salvo_em: o.salvo_em } };
    }
    if (acao === 'remover') {
      var existia = store.getProperty(k) !== null;
      apagarRascunho_(store, k);
      return { dados: { chave: d.chave, removido: existia } };
    }
    if (acao !== 'salvar') throw Validation.erro('INTERNAL', 'Ação de rascunho desconhecida: ' + acao + '.');
    if (d.conteudo === undefined || d.conteudo === null) throw validacao_('Não há nada para guardar no rascunho.', 'conteudo');
    var agora = Database.clock().agora();
    var texto = JSON.stringify({ conteudo: d.conteudo, salvo_em: agora });
    var bytes = bytesUtf8_(texto);
    if (bytes > RASCUNHO.maxBytes) throw validacao_('O rascunho ficou grande demais para guardar no servidor (' + Math.ceil(bytes / 1024) + ' KB; o limite é ' + Math.floor(RASCUNHO.maxBytes / 1000) + ' KB). Grave o lançamento em partes menores.', 'conteudo');
    var todos = store.getProperties();
    var limite = Date.parse(agora) - RASCUNHO.validadeDias * DIA_MS;
    var restantes = 0;
    var ocupado = 0;
    Object.keys(todos).forEach(function (chave) {
      if (chave.indexOf(RASCUNHO.prefixo) !== 0 || chave === k || chave.indexOf(k + '#') === 0 || chave.indexOf('#') >= 0) return;
      var salvo = null;
      try {
        salvo = Date.parse(JSON.parse(todos[chave]).salvo_em);
      } catch (e) {
        console.error('rascunho ilegível descartado (' + chave + '): ' + texto_(e));
      }
      if (!isFinite(salvo) || salvo < limite) { apagarRascunho_(store, chave, todos); return; }
      restantes += 1;
      ocupado += bytesUtf8_(todos[chave]);
      Object.keys(todos).forEach(function (x) { if (x.indexOf(chave + '#') === 0) ocupado += bytesUtf8_(todos[x]); });
    });
    if (restantes >= RASCUNHO.max) throw validacao_('Há rascunhos demais guardados no servidor (' + RASCUNHO.max + '). Conclua ou descarte alguns formulários abertos.', 'chave');
    if (ocupado + bytes > RASCUNHO.totalBytes) throw validacao_('Os rascunhos guardados no servidor já ocupam o espaço que ele tem (' + Math.ceil(ocupado / 1024) + ' KB). Conclua ou descarte alguns formulários abertos.', 'conteudo');
    var partes = bytes > RASCUNHO.parteBytes ? partesUtf8_(texto, RASCUNHO.parteBytes) : null;
    apagarRascunho_(store, k, todos);
    if (!partes) store.setProperty(k, texto);
    else {
      partes.forEach(function (x, i) { store.setProperty(parteRascunho_(k, i + 1), x); });
      store.setProperty(k, JSON.stringify({ partes: partes.length, salvo_em: agora }));
    }
    return { dados: { chave: d.chave, salvo_em: agora, bytes: bytes, partes: partes ? partes.length : 1 } };
  }

  // ------------------------------------------------------------------ páginas ----
  function escaparHtml_(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function paginaAviso_(titulo, texto) {
    var html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><style>body{font:16px/1.5 system-ui,sans-serif;margin:24px;color:#1b1b1b;background:#fff}h1{font-size:22px}</style></head>' +
      '<body><main><h1>' + escaparHtml_(titulo) + '</h1><p>' + escaparHtml_(texto) + '</p></main></body></html>';
    return HtmlService.createHtmlOutput(html).setTitle(TITULO).addMetaTag('viewport', VIEWPORT);
  }
  /**
   * doGet: a SPA (`Index.html`, template com includes) com título e viewport; `?pagina=concorrencia` serve a página
   * do teste de concorrência real (CT-10, passo 6), que só fala com a base de TESTE.
   */
  function pagina(evento) {
    var params = (evento && evento.parameter) || {};
    if (params.pagina === 'concorrencia') {
      return HtmlService.createHtmlOutput(TestRunner.paginaConcorrencia()).setTitle(TITULO + ' — teste de concorrência').addMetaTag('viewport', VIEWPORT);
    }
    var ambiente = vazio_(params.ambiente) ? 'PRODUCAO' : String(params.ambiente).toUpperCase();
    if (AMBIENTES.indexOf(ambiente) < 0) {
      return paginaAviso_('Endereço do app inválido', 'O ambiente "' + String(params.ambiente) + '" não existe. Abra o endereço do app sem parâmetros, ou com ?ambiente=DEMO para a base de demonstração.');
    }
    var t;
    try {
      t = HtmlService.createTemplateFromFile(PAGINA);
    } catch (e) {
      console.error('doGet: ' + texto_(e));
      return paginaAviso_('A interface ainda não foi instalada', 'Os arquivos de tela (.html) não estão no projeto do Apps Script. Envie o projeto de novo (npm run gas:push) e recarregue esta página.');
    }
    t.appVersion = APP_VERSION;
    t.ambiente = ambiente;
    t.urlApp = urlDoApp_(ambiente);
    return t.evaluate().setTitle(TITULO).addMetaTag('viewport', VIEWPORT);
  }
  /**
   * Endereço do app para o "Recarregar" e o "Entrar de novo" da página (link com target=_top: o iframe do HtmlService
   * não recarrega a janela de cima por script). Sem implantação publicada, `getUrl` falha ou vem vazio: a página usa
   * então o recarregamento do próprio quadro, e a causa fica no log.
   */
  function urlDoApp_(ambiente) {
    var url = '';
    try {
      url = ScriptApp.getService().getUrl() || '';
    } catch (e) {
      console.error('doGet: endereço do app indisponível: ' + texto_(e));
      return '';
    }
    return url && ambiente !== 'PRODUCAO' ? url + '?ambiente=' + ambiente : url;
  }
  function paginaNegada(erro) {
    return paginaAviso_('Acesso negado', erro && erro.code === 'DENIED' ? erro.message : 'Não foi possível conferir o acesso. Tente de novo.');
  }
  /**
   * Conteúdo de um arquivo HTML da lista branca, para `<?!= include_('Styles') ?>` nos templates, como vai ao
   * aparelho: compactado (`compactar`), para a página caber no orçamento de ~450 KB (01, seção 6.2).
   */
  function incluir(nome) {
    var n = String(nome);
    if (INCLUDES.indexOf(n) < 0) throw validacao_('Arquivo de tela não permitido: ' + n + '.', 'nome');
    return compactar(HtmlService.createHtmlOutputFromFile(n).getContent());
  }
  /**
   * Rota `sistema.tela` (01, seção 6.2; risco R-31): o arquivo de uma tela carregada sob demanda, compactado como o doGet
   * entrega os includes (`incluir`). dados: {nome} (o arquivo, como o EventCatalog o declara em `tela`). Não abre a
   * planilha-banco: a guarda de dono do `tratar` já passou e o arquivo é do projeto. → {nome, modulo, conteudo, bytes}.
   * Erros: VALIDATION (nome que não é de tela sob demanda), NOT_FOUND (módulo ainda não entregue, com a fase; arquivo que
   * não está no projeto do Apps Script).
   */
  function tela(dados) {
    var nome = dados && typeof dados.nome === 'string' ? dados.nome : '';
    if (!Object.prototype.hasOwnProperty.call(TELAS_SOB_DEMANDA, nome)) throw validacao_('Tela desconhecida para esta versão do app. Recarregue a página; se continuar, a versão do app pode estar desatualizada.', 'nome');
    var id = TELAS_SOB_DEMANDA[nome];
    var m = EventCatalog.modulosAtivos().filter(function (x) { return x.id === id && x.tela === nome && x.sob_demanda === true; })[0];
    if (!m) {
      var d = EventCatalog.modulo(id);
      throw Validation.erro('NOT_FOUND', 'Esta tela faz parte do módulo ' + d.rotulo + ', que chega na fase ' + d.fase + ' e ainda não foi entregue.');
    }
    var conteudo;
    try {
      conteudo = incluir(nome);
    } catch (e) {
      if (Validation.ehAppError(e)) throw e;
      console.error('sistema.tela ' + nome + ': ' + texto_(e));
      throw Validation.erro('NOT_FOUND', 'A tela de ' + m.rotulo + ' não está no projeto do Apps Script. Envie o projeto de novo (npm run gas:push) e recarregue a página.');
    }
    return { nome: nome, modulo: m.id, conteudo: conteudo, bytes: bytesUtf8_(conteudo) };
  }
  /**
   * Tira de um include (`<script>` ou `<style>`) o que só serve a quem lê o código: o recuo do começo das linhas, as
   * linhas vazias e as linhas que são só comentário (`// ...` e blocos que começam e terminam numa linha `/* ... *\/`).
   * Comentário no fim de uma linha de código fica (a linha não muda). Seguro porque os includes não têm template literal
   * nem texto que continue de uma linha para a outra (conferido por tests/interface.test.js).
   */
  function compactar(texto) {
    var out = [], bloco = false;
    String(texto).split(/\r?\n/).forEach(function (linha) {
      var t = linha.trim();
      if (bloco) { if (t.indexOf('*/') >= 0) bloco = false; return; }
      if (t === '' || t.indexOf('//') === 0) return;
      if (t.indexOf('/*') === 0) {
        var fim = t.indexOf('*/', 2);
        if (fim < 0) { bloco = true; return; }
        if (fim === t.length - 2) return;
      }
      out.push(t);
    });
    return out.join('\n');
  }

  // ------------------------------------------------------------------ funções do editor e gatilhos ----
  /**
   * Corpo comum das funções públicas que o dono roda no editor e dos gatilhos: executa, registra um resumo no log de
   * execuções e devolve o resultado em JSON simples. Erro: registrado no log e relançado (a execução aparece com falha).
   */
  function executarNoEditor(nome, fn) {
    try {
      var r = plano_(fn());
      console.log(nome + ': ' + JSON.stringify(r).slice(0, 4000));
      return r;
    } catch (e) {
      console.error(nome + ': ' + texto_(e) + (e && e.relatorio ? ' ' + JSON.stringify(e.relatorio).slice(0, 2000) : ''));
      throw e;
    }
  }
  /** SP-04 sem dado sensível: o e-mail ativo veio? é o do dono? a contingência está ligada? */
  function diagnosticoSessao() {
    var props = Database.props().ler();
    var ativo = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    var efetivo = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
    var dono = String(props[PROP_DONO] || efetivo).trim().toLowerCase();
    return {
      email_ativo_preenchido: !!ativo, email_ativo_e_do_dono: !!ativo && ativo === dono, email_efetivo_preenchido: !!efetivo,
      dono_registrado: !vazio_(props[PROP_DONO]), contingencia_email_vazio: String(props[PROP_SEM_EMAIL] || '').trim().toLowerCase() === 'true',
    };
  }

  return {
    APP_VERSION: APP_VERSION,
    TITULO: TITULO,
    INCLUDES: INCLUDES,
    TELAS_SOB_DEMANDA: TELAS_SOB_DEMANDA,
    tela: tela,
    compactar: compactar,
    ROTAS_CANONICAS: ROTAS_CANONICAS,
    FAIXA_TESTE: FAIXA_TESTE,
    RASCUNHO: RASCUNHO,
    rotas: rotas,
    assertOwner: assertOwner,
    contexto: contexto,
    tratar: tratar,
    rascunho: rascunho,
    pagina: pagina,
    paginaNegada: paginaNegada,
    incluir: incluir,
    executarNoEditor: executarNoEditor,
    diagnosticoSessao: diagnosticoSessao,
  };
})();
