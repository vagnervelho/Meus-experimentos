/**
 * Maintenance — configuração inicial (setup), backup, retenção, restauração, rotina diária e verificação semanal.
 *
 * setup (06, seção 4) pode rodar quantas vezes for preciso: só acrescenta (pastas, planilha-banco, abas, colunas ao
 * final, sementes "insere se ausente", SCHEMA_META, gatilhos, proteção de aviso) e faz backup antes de mexer num banco
 * que já existe. A forma de gravação (IO_PRIMITIVE) é escolhida pelo corpus de tipos numa planilha temporária
 * (desenho-base, seção 17, SP-01). Backup = cópia da planilha pelo Drive v3 (06, seção 10); restauração só por
 * comando: copia o backup, troca o banco em uso, sobe a versão dos dados e roda recoverAll.
 *
 * A guarda de dono das funções públicas (assertOwner_) é de Code.js; aqui o setup só confere e grava OWNER_EMAIL.
 */
var Maintenance = (function () {
  var PROP_BANCO = 'SPREADSHEET_ID';
  var PROP_DONO = 'OWNER_EMAIL';
  var PROP_PRIMITIVA = 'IO_PRIMITIVE';
  var PROP_PRIMITIVA_RELATORIO = 'IO_PRIMITIVE_RELATORIO';
  var CHAVES_BANCO = Object.freeze(['SPREADSHEET_ID', 'TEST_SPREADSHEET_ID', 'DEMO_SPREADSHEET_ID']);
  /**
   * Bancos por ambiente (desenho-base 16.3): produção, teste de aceitação e demonstração. Os de teste nascem na pasta
   * Testes e guardam a forma de gravação na própria chave (`IO_PRIMITIVE:<banco>`), para nunca mexer na de produção.
   */
  var AMBIENTES = Object.freeze({ PRODUCAO: 'SPREADSHEET_ID', TESTE: 'TEST_SPREADSHEET_ID', DEMO: 'DEMO_SPREADSHEET_ID' });
  var NOME_BANCO = 'ERP Pecuário — Banco de dados';
  var NOMES_BANCO_TESTE = Object.freeze({ TESTE: 'ERP Pecuário — BASE DE TESTE', DEMO: 'ERP Pecuário — BASE DE TESTE (demonstração)' });
  var FUSO_PADRAO = 'America/Porto_Velho';
  var ESPERA_LOCK_MS = 25000;
  var GATILHOS = Object.freeze([
    { funcao: 'trgManutencaoDiaria', descricao: 'diário, de madrugada (03h)', hora: 3 },
    { funcao: 'trgIntegridadeSemanal', descricao: 'semanal, domingo (05h)', hora: 5, semanal: true },
  ]);
  var SEMEADAS = Object.freeze(['CONFIGURACOES', 'LISTAS', 'PLANO_CONTAS', 'CATEGORIAS']);
  var MOTIVOS_BACKUP = Object.freeze({ DIARIO: 'diário', SOB_DEMANDA: 'sob demanda', SETUP: 'antes da configuração', IMPORTACAO: 'antes de concluir importação', RESTAURACAO: 'antes de restaurar' });
  /** Exportações (XLSX/PDF) são links de entrega: a limpeza diária leva à lixeira as com mais de 7 dias. */
  var EXPORTACAO_VALIDADE_DIAS = 7;
  /** Anexo TEMPORARIO (ou arquivo sem linha em ANEXOS) com mais de 24 h não foi promovido: vai para a lixeira. */
  var ANEXO_TEMPORARIO_HORAS = 24;
  var MS_HORA = 3600000;

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function interno_(mensagem) {
    return Validation.erro('INTERNAL', mensagem);
  }
  function texto_(e) {
    return String(e && e.message ? e.message : e);
  }
  function chaveVersao_(banco) {
    return UnitOfWork.chaveVersao(banco);
  }
  /** Chave de Script Properties do banco do ambiente (PRODUCAO, TESTE ou DEMO). Outro valor → VALIDATION. */
  function chaveDoAmbiente(ambiente) {
    var a = vazio_(ambiente) ? 'PRODUCAO' : String(ambiente);
    if (!Object.prototype.hasOwnProperty.call(AMBIENTES, a)) throw Validation.erro('VALIDATION', 'Ambiente desconhecido: "' + a + '". Use PRODUCAO, TESTE ou DEMO.');
    return AMBIENTES[a];
  }
  /** Forma de gravação do banco: a própria (`IO_PRIMITIVE:<banco>`, bancos de teste), a geral ou a preferida. */
  function primitivaDoBanco(props, banco) {
    var p = props || {};
    return p['IO_PRIMITIVE:' + banco] || p[PROP_PRIMITIVA] || Database.PRIMITIVAS[0];
  }

  // ------------------------------------------------------------------ contexto ----
  /**
   * Contexto de produção (gatilhos e rotas de sistema): banco do ambiente (SPREADSHEET_ID, ou TEST_/DEMO_ com
   * `ambiente`; ou `banco`), forma de gravação do banco, porta de arquivos, projetor real.
   * o: {banco, ambiente, usuario, fuso, props (retrato já lido das Script Properties)}.
   */
  function contexto(opcoes) {
    var o = opcoes || {};
    var p = o.props || PropertiesService.getScriptProperties().getProperties();
    var chave = chaveDoAmbiente(o.ambiente);
    var banco = o.banco || p[chave];
    if (vazio_(banco)) {
      if (chave !== PROP_BANCO) throw Validation.erro('CONFIG', 'A base de teste (' + o.ambiente + ') ainda não existe. Rode runAcceptanceTests no editor do Apps Script para criá-la.');
      throw Validation.erro('CONFIG', 'O sistema ainda não tem planilha configurada. Execute a configuração inicial (setup).');
    }
    return Database.contexto({
      banco: banco, primitiva: primitivaDoBanco(p, banco), usuario: o.usuario || Session.getEffectiveUser().getEmail() || 'sistema',
      fuso: o.fuso || Session.getScriptTimeZone(), files: FileService.porta(), projecoes: Timeline.porta(),
    });
  }
  /** Mesmo contexto (mesmas portas e usuário), apontado para outro banco. */
  function contextoDoBanco_(ctx, banco) {
    var novo = {};
    Object.keys(ctx).forEach(function (k) { novo[k] = ctx[k]; });
    novo.banco = banco;
    novo.io = Database.abrir(banco, { primitiva: ctx.io.primitiva });
    novo.errosPendentes = [];
    novo.unidadeAtiva = false;
    return novo;
  }
  function parametros_(ctx) {
    return UnitOfWork.read(ctx, { rota: 'sistema.parametros', reads: ['CONFIGURACOES'], tratador: function (tx) { return Timeline.parametros(tx.repo); } }).dados;
  }

  // ------------------------------------------------------------------ backup e retenção ----
  function horaLocal_(instante, fuso) {
    return Utilities.formatDate(new Date(Date.parse(instante)), fuso, "HH'h'mm");
  }
  /** Cópia da planilha para Backups, marcada nas appProperties (banco, data, motivo, instante). Sem lock próprio. */
  function copiar_(files, banco, motivo, agora, fuso, ambiente) {
    var data = Utils.hoje(agora, fuso);
    var nome = 'ERP Pecuário — backup ' + data + ' ' + horaLocal_(agora, fuso) + ' (' + MOTIVOS_BACKUP[motivo] + ')';
    var marcas = { erp_tipo: 'BACKUP', erp_banco: banco, erp_data: data, erp_motivo: motivo, erp_instante: agora };
    if (ambiente) marcas.erp_ambiente = ambiente;
    var c = files.copiar(banco, {
      nome: nome, pasta: 'backups', descricao: 'Backup ' + MOTIVOS_BACKUP[motivo] + ' do ERP Pecuário. Restaure só pelo sistema (Sistema → Restaurar backup).',
      appProperties: marcas,
    });
    return { id: c.id, nome: nome, data: data, instante: agora, motivo: motivo };
  }
  /**
   * Ambiente (PRODUCAO, TESTE, DEMO) cujo banco em uso é `banco`, pela chave de Script Properties que o aponta; null se
   * nenhuma aponta. É a "linhagem" dos backups: depois de uma restauração o banco muda de ID, mas os backups do banco
   * anterior continuam sendo do mesmo ambiente (listar, reter e restaurar enxergam todos eles).
   */
  function ambienteDoBanco_(props, banco) {
    var achado = null;
    Object.keys(AMBIENTES).forEach(function (a) {
      if (!achado && !vazio_(banco) && props[AMBIENTES[a]] === banco) achado = a;
    });
    return achado;
  }
  /**
   * Backup (sistema.backup; antes do setup e de concluir importação; rotina diária). Com o banco parado: lock,
   * recuperação, flush, cópia pelo Drive. o: {motivo: DIARIO | SOB_DEMANDA | SETUP | IMPORTACAO | RESTAURACAO}.
   * O diário aplica a retenção. Devolve {backup: {id, nome, data, instante, motivo}, retencao}. Erros: LOCKED, CONFIG.
   */
  function backup(ctx, opcoes) {
    var motivo = (opcoes && opcoes.motivo) || 'SOB_DEMANDA';
    if (!MOTIVOS_BACKUP[motivo]) throw interno_('Motivo de backup desconhecido: ' + motivo + '.');
    if (!ctx.files) throw interno_('Contexto de execução sem a porta de arquivos (files).');
    var r = UnitOfWork.exclusivo(ctx, {
      rota: 'sistema.backup', reads: ['CONFIGURACOES'],
      tratador: function (tx) {
        tx.ctx.io.flush();
        var fuso = Timeline.parametros(tx.repo).fuso || ctx.fuso || FUSO_PADRAO;
        var feito;
        try {
          feito = copiar_(ctx.files, ctx.banco, motivo, tx.agora, fuso, ambienteDoBanco_(ctx.props.ler(), ctx.banco));
        } catch (e) {
          if (Validation.ehAppError(e)) throw e;
          var erro = Validation.erro('CONFIG', 'Não foi possível copiar a planilha para a pasta de backups. Se a planilha foi copiada à mão ou criada fora do sistema, restaure um backup pelo sistema; se o erro continuar, autorize o acesso completo ao Drive conforme o guia.');
          erro.causa = texto_(e);
          throw erro;
        }
        return { backup: feito, fuso: fuso };
      },
    }).dados;
    var retencao = motivo === 'DIARIO' ? aplicarRetencao(ctx) : null;
    return { backup: r.backup, retencao: retencao };
  }
  /**
   * Backups deste banco e dos bancos anteriores do mesmo ambiente (os de antes de uma restauração), do mais novo para o
   * mais antigo: [{id, nome, data, instante, motivo, banco, ambiente}]. `{todos: true}`: os de todos os ambientes.
   */
  function listarBackups(ctx, opcoes) {
    var todos = opcoes && opcoes.todos;
    var filtros = [{ erp_tipo: 'BACKUP' }];
    if (!todos) {
      filtros = [{ erp_tipo: 'BACKUP', erp_banco: ctx.banco }];
      var ambiente = ambienteDoBanco_(ctx.props.ler(), ctx.banco);
      if (ambiente) filtros.push({ erp_tipo: 'BACKUP', erp_ambiente: ambiente });
    }
    var vistos = {};
    var lista = [];
    filtros.forEach(function (ap) {
      ctx.files.listar('backups', { appProperties: ap }).forEach(function (f) {
        if (vistos[f.id]) return;
        vistos[f.id] = true;
        var a = f.appProperties || {};
        lista.push({ id: f.id, nome: f.name, data: a.erp_data || null, instante: a.erp_instante || f.createdTime, motivo: a.erp_motivo || null, banco: a.erp_banco || null, ambiente: a.erp_ambiente || null });
      });
    });
    return Utils.ordenarPor(lista, [{ campo: 'instante', desc: true }]);
  }
  /**
   * Retenção (06, seção 10): mantém os `backup_retencao_diarios` diários mais recentes; dos mais antigos, o último
   * de cada mês, nos `backup_retencao_mensais` meses mais recentes. Backups extras (sob demanda, setup, importação,
   * restauração) ficam pelo mesmo número de dias. O resto vai para a lixeira do Drive (recuperável por 30 dias).
   * Devolve {mantidos, removidos: [nome]}.
   */
  function aplicarRetencao(ctx) {
    var p = parametros_(ctx);
    var nDiarios = typeof p.backup_retencao_diarios === 'number' ? p.backup_retencao_diarios : 30;
    var nMensais = typeof p.backup_retencao_mensais === 'number' ? p.backup_retencao_mensais : 12;
    var hoje = Utils.hoje(ctx.clock.agora(), p.fuso || ctx.fuso || FUSO_PADRAO);
    var lista = listarBackups(ctx);
    var manter = {};
    var diarios = lista.filter(function (b) { return b.motivo === 'DIARIO'; });
    diarios.slice(0, nDiarios).forEach(function (b) { manter[b.id] = true; });
    var meses = [];
    diarios.slice(nDiarios).forEach(function (b) {
      var mes = String(b.data || b.instante).slice(0, 7);
      if (meses.indexOf(mes) >= 0 || meses.length >= nMensais) return;
      meses.push(mes);
      manter[b.id] = true;
    });
    lista.forEach(function (b) {
      if (b.motivo !== 'DIARIO' && Utils.dataValida(b.data) && Utils.diffDias(b.data, hoje) < nDiarios) manter[b.id] = true;
    });
    var removidos = [];
    lista.forEach(function (b) {
      if (manter[b.id]) return;
      ctx.files.lixeira(b.id);
      removidos.push(b.nome);
    });
    return { mantidos: lista.length - removidos.length, removidos: removidos };
  }

  // ------------------------------------------------------------------ restauração ----
  /**
   * Restauração (sistema.restaurarBackup; 06, seção 10): copia o backup pelo Drive (a cópia passa a ser o banco),
   * cria a versão de dados do banco novo acima da última servida, grava o marcador do banco novo ANTES de trocá-lo,
   * troca o banco em uso e roda recoverAll; registra em AUDITORIA e verifica a integridade. O banco anterior fica no
   * Drive. pedido: {dados: {backup_id, justificativa (obrigatória)}}. Devolve {banco_anterior, banco, backup, recuperacao,
   * dataVersion, integridade}. Erros: NOT_FOUND, VALIDATION (sem justificativa; backup de outro ambiente:
   * BACKUP_DE_OUTRA_BASE), LOCKED, CONFIG.
   */
  function restaurar(ctx, pedido) {
    var d = (pedido && pedido.dados) || {};
    var files = ctx.files;
    if (!files) throw interno_('Contexto de execução sem a porta de arquivos (files).');
    var b = vazio_(d.backup_id) ? null : files.obter(d.backup_id);
    var ap = (b && b.appProperties) || {};
    if (!b || b.trashed === true || ap.erp_tipo !== 'BACKUP') throw Validation.erro('NOT_FOUND', 'O backup escolhido não foi encontrado (pode ter ido para a lixeira). Escolha outro na lista.');
    var props = ctx.props.ler();
    var chave = CHAVES_BANCO.filter(function (k) { return props[k] === ctx.banco; })[0];
    if (!chave) throw Validation.erro('CONFIG', 'O banco em uso não está registrado nas propriedades do sistema. Execute a configuração inicial (setup).');
    // Backup de outra base (a de teste ou a de demonstração no lugar da real, ou o contrário) nunca é restaurado.
    var ambiente = ambienteDoBanco_(props, ctx.banco);
    var deOutra = !vazio_(ap.erp_ambiente) ? ap.erp_ambiente !== ambiente : CHAVES_BANCO.some(function (k) { return k !== chave && !vazio_(props[k]) && props[k] === ap.erp_banco; });
    if (vazio_(d.justificativa) || !String(d.justificativa).trim()) {
      throw Validation.erro('VALIDATION', 'Diga por que está restaurando o backup: o motivo fica registrado no histórico do sistema.', [Validation.detalhe({ codigo: 'CAMPO_OBRIGATORIO', campo: 'justificativa', mensagem: 'Diga por que está restaurando o backup.' })]);
    }
    if (deOutra) throw Validation.erro('VALIDATION', 'Este backup é de outra base (' + (ap.erp_ambiente === 'PRODUCAO' ? 'a base real' : 'uma base de teste ou de demonstração') + '), não da que está aberta. Escolha um backup desta base na lista.', [Validation.detalhe({ codigo: 'BACKUP_DE_OUTRA_BASE', campo: 'backup_id', mensagem: 'Escolha um backup desta base.' })]);
    if (!ctx.lock.tentar(ESPERA_LOCK_MS)) throw Validation.erro('LOCKED', 'O sistema está ocupado gravando outra operação. Aguarde alguns segundos e tente de novo.');
    var novo;
    var rec;
    try {
      var agora = ctx.clock.agora();
      var copia = files.copiar(b.id, { nome: NOME_BANCO + ' (restaurado do backup de ' + (ap.erp_data || b.createdTime) + ')', pasta: 'raiz', appProperties: { erp_tipo: 'BANCO', erp_restaurado_de: b.id } });
      novo = copia.id;
      var versaoAnterior = parseInt(props[chaveVersao_(ctx.banco)], 10) || 0;
      var versaoCopia = parseInt(props[chaveVersao_(novo)], 10) || 0;
      ctx.props.gravar(chaveVersao_(novo), String(Math.max(versaoAnterior, versaoCopia) + 1));
      ctx.props.gravar(UnitOfWork.chaveMarcador(novo), JSON.stringify({ restauracao: true, backup: b.id, desde: agora }));
      if (!vazio_(props['IO_PRIMITIVE:' + ctx.banco])) ctx.props.gravar('IO_PRIMITIVE:' + novo, props['IO_PRIMITIVE:' + ctx.banco]);
      ctx.props.gravar(chave, novo);
      rec = UnitOfWork.recoverAll(contextoDoBanco_(ctx, novo));
    } finally {
      if (ctx.lock.tem()) ctx.lock.soltar();
    }
    var nc = contextoDoBanco_(ctx, novo);
    UnitOfWork.run(nc, {
      rota: 'sistema.restaurarBackup', idempotencyKey: 'restauracao:' + novo, dados: { backup_id: b.id }, reads: [], permiteDuranteImportacao: true,
      tratador: function (tx) {
        tx.plano.auditar({
          entidade: 'SISTEMA', acao: 'MANUTENCAO', justificativa: String(d.justificativa).trim(),
          valor_novo: 'Banco restaurado do backup "' + b.name + '" (' + b.id + '). O banco anterior (' + ctx.banco + ') continua no Drive.',
        });
        return { resumo: { banco: novo, backup_id: b.id, banco_anterior: ctx.banco } };
      },
    });
    var integridade = AuditService.verificarIntegridade(nc).dados;
    return {
      banco_anterior: ctx.banco, banco: novo, backup: { id: b.id, nome: b.name, data: ap.erp_data || null, motivo: ap.erp_motivo || null },
      recuperacao: rec, dataVersion: UnitOfWork.versao(nc), integridade: integridade,
    };
  }

  // ------------------------------------------------------------------ limpeza ----
  /** Exportações com mais de 7 dias vão para a lixeira. Devolve {removidas}. */
  function limparExportacoes(ctx) {
    var limite = Utils.instanteIso(ctx.clock.agoraMs() - EXPORTACAO_VALIDADE_DIAS * 24 * MS_HORA);
    var velhas = ctx.files.listar('exportacoes', { criadoAntesDe: limite });
    velhas.forEach(function (f) { ctx.files.lixeira(f.id); });
    return { removidas: velhas.length };
  }
  /**
   * Anexos: TEMPORARIO com mais de 24 h → REMOVIDO (comando auditado) e arquivo na lixeira; arquivo deste banco na
   * pasta Anexos sem linha em ANEXOS (comando que não confirmou) e com mais de 24 h → lixeira; arquivo de anexo
   * REMOVIDO que ainda não foi para a lixeira → lixeira. Devolve {temporarios (linhas), orfaos, arquivos_removidos}.
   */
  function limparAnexos(ctx) {
    var agoraMs = ctx.clock.agoraMs();
    var limite = Utils.instanteIso(agoraMs - ANEXO_TEMPORARIO_HORAS * MS_HORA);
    var linhas = UnitOfWork.read(ctx, { rota: 'sistema.limpeza', reads: ['ANEXOS'], acessoCru: true, tratador: function (tx) { return Utils.clonar(tx.cru.cru('ANEXOS')); } }).dados;
    var vencidos = linhas.filter(function (a) { return a.status === 'TEMPORARIO' && a.created_at < limite; });
    if (vencidos.length) {
      UnitOfWork.run(ctx, {
        rota: 'sistema.limpeza', idempotencyKey: 'limpeza:' + ctx.idGen.uuid(), dados: { anexos: vencidos.map(function (a) { return a.anexo_id; }) },
        reads: ['ANEXOS'], permiteDuranteImportacao: true,
        tratador: function (tx) {
          tx.dados.anexos.forEach(function (id) {
            var a = tx.repo.porId('ANEXOS', id);
            if (a && a.status === 'TEMPORARIO') AuditService.alteracao(tx, 'ANEXOS', id, { status: 'REMOVIDO' }, 'Limpeza diária: arquivo temporário não usado por nenhum lançamento.');
          });
          return { resumo: { anexos: tx.dados.anexos.length } };
        },
      });
    }
    var usados = {};
    var removidos = {};
    linhas.forEach(function (a) {
      var removido = a.status === 'REMOVIDO' || vencidos.indexOf(a) >= 0;
      [a.drive_file_id, a.thumb_drive_file_id].forEach(function (id) {
        if (vazio_(id)) return;
        if (removido) removidos[id] = true;
        else usados[id] = true;
      });
    });
    var vivos = ctx.files.listar('anexos', { appProperties: { erp_banco: ctx.banco } });
    var n = { temporarios: vencidos.length, orfaos: 0, arquivos_removidos: 0 };
    vivos.forEach(function (f) {
      if (usados[f.id]) return;
      if (removidos[f.id]) { ctx.files.lixeira(f.id); n.arquivos_removidos += 1; return; }
      if (f.createdTime < limite) { ctx.files.lixeira(f.id); n.orfaos += 1; }
    });
    return n;
  }

  // ------------------------------------------------------------------ rotinas agendadas ----
  /**
   * Rotina diária (trgManutencaoDiaria), em ordem: backup com retenção → limpeza de exportações → limpeza de anexos.
   * Uma etapa que falha não impede as seguintes; cada falha vai para ERROS_LOG e, no fim, a rotina lança INTERNAL
   * com o relatório em `erro.relatorio` (o Apps Script avisa o dono da falha do gatilho). Devolve o relatório.
   */
  function manutencaoDiaria(ctx) {
    var rel = { backup: null, retencao: null, exportacoes: null, anexos: null, falhas: [] };
    function etapa(nome, fn) {
      try {
        fn();
      } catch (e) {
        rel.falhas.push({ etapa: nome, code: e && e.code ? e.code : 'INTERNAL', mensagem: texto_(e) });
        UnitOfWork.anotarErro(ctx, { contexto: 'trgManutencaoDiaria', codigo: 'MANUTENCAO_' + nome.toUpperCase(), mensagem: 'Rotina diária, etapa ' + nome + ': ' + texto_(e), erro: e });
      }
    }
    etapa('backup', function () { var b = backup(ctx, { motivo: 'DIARIO' }); rel.backup = b.backup; rel.retencao = b.retencao; });
    etapa('exportacoes', function () { rel.exportacoes = limparExportacoes(ctx); });
    etapa('anexos', function () { rel.anexos = limparAnexos(ctx); });
    UnitOfWork.descarregarErros(ctx);
    if (rel.falhas.length) {
      var erro = Validation.erro('INTERNAL', 'A rotina diária terminou com ' + rel.falhas.length + ' etapa(s) com falha: ' + rel.falhas.map(function (f) { return f.etapa; }).join(', ') + '. Veja o registro de erros.');
      erro.relatorio = rel;
      throw erro;
    }
    return rel;
  }
  /**
   * Verificação semanal (trgIntegridadeSemanal): relatório completo; o resumo fica em Script Properties
   * (`INTEGRIDADE:<banco>`, para o alerta "integridade com erro") e, havendo erro, em ERROS_LOG. Devolve o relatório.
   */
  function integridadeSemanal(ctx) {
    var rel = AuditService.verificarIntegridade(ctx).dados;
    ctx.props.gravar('INTEGRIDADE:' + ctx.banco, JSON.stringify({ gerado_em: rel.gerado_em, ok: rel.ok, erros: rel.erros, alertas: rel.alertas }));
    if (!rel.ok) {
      UnitOfWork.anotarErro(ctx, { contexto: 'trgIntegridadeSemanal', codigo: 'INTEGRIDADE_COM_ERRO', mensagem: 'Verificação de integridade: ' + rel.erros + ' erro(s) e ' + rel.alertas + ' alerta(s). Abra Sistema → Integridade.' });
      UnitOfWork.descarregarErros(ctx);
    }
    return rel;
  }

  // ------------------------------------------------------------------ gatilhos ----
  /**
   * Gatilhos garantidos de forma idempotente (06, seção 4, passo 9): compara pelo nome da função, cria o que falta,
   * apaga duplicata. Devolve {criados: [funcao], removidos: n, total}.
   */
  function garantirGatilhos(fuso) {
    var existentes = ScriptApp.getProjectTriggers();
    var criados = [];
    var removidos = 0;
    GATILHOS.forEach(function (g) {
      var mesmos = existentes.filter(function (t) { return t.getHandlerFunction() === g.funcao; });
      mesmos.slice(1).forEach(function (t) { ScriptApp.deleteTrigger(t); removidos += 1; });
      if (mesmos.length) return;
      var b = ScriptApp.newTrigger(g.funcao).timeBased();
      b = g.semanal ? b.everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY) : b.everyDays(1);
      b.atHour(g.hora).inTimezone(fuso).create();
      criados.push(g.funcao);
    });
    var total = ScriptApp.getProjectTriggers().filter(function (t) {
      return GATILHOS.some(function (g) { return g.funcao === t.getHandlerFunction(); });
    }).length;
    return { criados: criados, removidos: removidos, total: total };
  }

  /** Gatilhos do projeto que são deste sistema: [{funcao, id}] (diagnóstico SP-09 e tela de sistema). */
  function listarGatilhos() {
    return ScriptApp.getProjectTriggers().filter(function (t) {
      return GATILHOS.some(function (g) { return g.funcao === t.getHandlerFunction(); });
    }).map(function (t) { return { funcao: t.getHandlerFunction(), id: t.getUniqueId() }; });
  }

  // ------------------------------------------------------------------ setup ----
  /** Corpus de tipos numa planilha temporária (pasta Testes), que vai para a lixeira no fim. */
  function escolherPrimitiva_(files) {
    var temp = files.criarPlanilha('ERP Pecuário — teste de gravação (temporária)', 'testes', { erp_tipo: 'CORPUS' });
    var r;
    try {
      r = Database.escolherPrimitiva(temp);
    } finally {
      files.lixeira(temp);
    }
    return {
      primitiva: r.primitiva,
      resultados: r.resultados.map(function (x) { return { primitiva: x.primitiva, ok: !!x.ok, divergencias: (x.divergencias || []).length, erro: x.erro || null }; }),
    };
  }
  function semear_(tx) {
    var n = { CONFIGURACOES: 0, LISTAS: 0, PLANO_CONTAS: 0, CATEGORIAS: 0 };
    var conf = Utils.indexarPor(tx.repo.vigentes('CONFIGURACOES'), 'chave');
    Schema.SEMENTES.CONFIGURACOES.forEach(function (s) {
      if (conf[s.chave]) return;
      tx.plano.anexar('CONFIGURACOES', { chave: s.chave, valor: s.padrao === '' ? null : s.padrao, tipo: s.tipo, grupo: s.grupo, descricao: s.descricao, updated_at: tx.agora });
      n.CONFIGURACOES += 1;
    });
    var listas = {};
    tx.repo.vigentes('LISTAS').forEach(function (l) { listas[l.lista + '\u0000' + l.codigo] = true; });
    Object.keys(Schema.LISTAS_SEMENTE).forEach(function (lista) {
      Schema.LISTAS_SEMENTE[lista].forEach(function (x) {
        if (listas[lista + '\u0000' + x.codigo]) return;
        tx.plano.anexar('LISTAS', { lista_id: tx.novoId(), lista: lista, codigo: x.codigo, rotulo: x.rotulo, ordem: x.ordem, ativo: true });
        n.LISTAS += 1;
      });
    });
    [['PLANO_CONTAS', 'conta_id'], ['CATEGORIAS', 'category_id']].forEach(function (par) {
      var ja = Utils.indexarPor(tx.repo.vigentes(par[0]), 'codigo');
      Schema.SEMENTES[par[0]].forEach(function (s) {
        if (ja[s.codigo]) return;
        var r = Utils.clonar(s);
        r[par[1]] = tx.novoId();
        tx.plano.anexar(par[0], r);
        n[par[0]] += 1;
      });
    });
    var total = n.CONFIGURACOES + n.LISTAS + n.PLANO_CONTAS + n.CATEGORIAS;
    if (total) {
      tx.plano.auditar({
        entidade: 'SISTEMA', acao: 'MANUTENCAO',
        valor_novo: 'Configuração inicial: sementes inseridas (versão ' + Schema.SEMENTES_VERSAO + ') — ' + n.CONFIGURACOES + ' parâmetros, ' + n.LISTAS + ' itens de lista, ' + n.PLANO_CONTAS + ' contas, ' + n.CATEGORIAS + ' categorias.',
      });
    }
    return n;
  }
  /** SCHEMA_META: uma linha por aba, com as colunas do sistema na ordem real; só grava o que muda. */
  function gravarSchemaMeta_(io, nomes, agora) {
    var lido = io.ler(['SCHEMA_META']).SCHEMA_META;
    var porTabela = {};
    lido.registros.forEach(function (r, i) { if (!porTabela[r.tabela]) porTabela[r.tabela] = { r: r, linha: lido.linhas[i] }; });
    var cabecalhos = io.lerCabecalhos(nomes);
    var novos = [];
    var mudancas = [];
    nomes.forEach(function (t) {
      var conhecidas = io.definicao(t).colunas.map(function (c) { return c.nome; });
      var colunas = (cabecalhos[t] || []).filter(function (c) { return conhecidas.indexOf(c) >= 0; });
      var sementes = SEMEADAS.indexOf(t) >= 0 ? Schema.SEMENTES_VERSAO : null;
      var atual = porTabela[t];
      if (!atual) {
        novos.push({ tabela: t, versao: 1, colunas_json: colunas, sementes_versao: sementes, updated_at: agora });
        return;
      }
      var antes = Array.isArray(atual.r.colunas_json) ? atual.r.colunas_json : [];
      var mudouColunas = JSON.stringify(antes) !== JSON.stringify(colunas);
      if (!mudouColunas && (atual.r.sementes_versao || null) === sementes) return;
      var campos = { colunas_json: colunas, sementes_versao: sementes, updated_at: agora };
      if (mudouColunas) campos.versao = (atual.r.versao || 1) + (colunas.length > antes.length ? 1 : 0);
      mudancas.push({ tabela: 'SCHEMA_META', linha: atual.linha, campos: campos });
    });
    if (novos.length) io.anexar({ SCHEMA_META: novos });
    if (mudancas.length) io.atualizar(mudancas);
    io.flush();
    return { criadas: novos.length, atualizadas: mudancas.length };
  }
  /** Proteção "somente aviso" em cada aba do sistema (passo 10); aba já protegida pelo dono fica como está. */
  function protegerAbas_(banco, nomes) {
    var ss = SpreadsheetApp.openById(banco);
    var n = 0;
    nomes.forEach(function (t) {
      var sh = ss.getSheetByName(t);
      if (!sh || sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) return;
      sh.protect().setDescription('ERP Pecuário: registre e corrija pelo aplicativo. Edição direta aqui pode corromper os dados.').setWarningOnly(true);
      n += 1;
    });
    SpreadsheetApp.flush();
    return n;
  }
  /** Banco recém-criado: tira a aba padrão vazia que a planilha nova traz. */
  function removerAbaPadrao_(banco, nomes) {
    var ss = SpreadsheetApp.openById(banco);
    var removidas = [];
    ss.getSheets().forEach(function (sh) {
      if (nomes.indexOf(sh.getName()) >= 0 || sh.getLastRow() > 0 || ss.getSheets().length <= 1) return;
      removidas.push(sh.getName());
      ss.deleteSheet(sh);
    });
    SpreadsheetApp.flush();
    return removidas;
  }
  /**
   * Configuração inicial e migração (06, seção 4), idempotente. o: {usuario (obrigatório: quem executa; vira
   * OWNER_EMAIL na primeira vez), fuso (fuso da sessão; padrão America/Porto_Velho), tabelas (definições na forma do
   * Schema que substituem as do Schema: migração de teste e esquema da fase seguinte)}.
   * Passos: dono → lock → pastas e sonda do Drive → backup do banco existente → forma de gravação pelo corpus →
   * planilha-banco → abas → colunas ao final → sementes → fuso e locale → SCHEMA_META → contadores → gatilhos →
   * proteção de aviso → integridade. Devolve o relatório (ver docs/CONTRATOS.md). Erros: DENIED, LOCKED, CONFIG.
   */
  function setup(opcoes) {
    var o = opcoes || {};
    if (vazio_(o.usuario)) throw interno_('A configuração inicial precisa do e-mail de quem a executa.');
    var chaveBanco = chaveDoAmbiente(o.ambiente);
    var producao = chaveBanco === PROP_BANCO;
    var store = PropertiesService.getScriptProperties();
    var props = store.getProperties();
    if (!vazio_(props[PROP_DONO]) && String(props[PROP_DONO]).toLowerCase() !== String(o.usuario).toLowerCase()) {
      throw Validation.erro('DENIED', 'Só o dono do sistema pode executar a configuração inicial.');
    }
    var lock = Database.lock();
    if (!lock.tentar(ESPERA_LOCK_MS)) throw Validation.erro('LOCKED', 'O sistema está ocupado gravando outra operação. Aguarde alguns segundos e tente de novo.');
    var rel = { banco: null, banco_criado: false, pastas: null, drive: null, backup: null, primitiva: null, abas: null, sementes: null, schema_meta: null, contadores: null, gatilhos: null, protecoes: 0, integridade: null };
    var files = FileService.porta();
    var clock = Database.clock();
    var nomes = Schema.nomesTabelas();
    var fusoSessao = o.fuso || FUSO_PADRAO;
    try {
      rel.pastas = files.garantirPastas();
      rel.drive = files.sondar();
      if (!rel.drive.ok) {
        var falhou = rel.drive.passos.filter(function (p) { return !p.ok; }).map(function (p) { return p.passo + ': ' + p.erro; }).join('; ');
        throw Validation.erro('CONFIG', 'O Google Drive recusou uma operação de que o sistema precisa (' + falhou + '). Autorize o acesso completo ao Drive (escopo "drive") conforme o guia de implantação e rode a configuração de novo.');
      }
      var banco = props[chaveBanco] || null;
      if (banco) {
        var arq = files.obter(banco);
        if (!arq || arq.trashed === true) {
          throw Validation.erro('CONFIG', 'A planilha-banco registrada (' + banco + ') não foi encontrada: foi apagada, está na lixeira ou foi criada fora do sistema. Tire-a da lixeira do Drive ou restaure um backup pelo sistema. Para começar do zero, apague a propriedade SPREADSHEET_ID e rode a configuração de novo.');
        }
        rel.backup = copiar_(files, banco, 'SETUP', clock.agora(), fusoSessao, vazio_(o.ambiente) ? 'PRODUCAO' : String(o.ambiente));
      }
      var escolha = escolherPrimitiva_(files);
      rel.primitiva = escolha;
      if (producao) store.setProperty(PROP_PRIMITIVA_RELATORIO, JSON.stringify(escolha).slice(0, 8000));
      if (!escolha.primitiva) throw Validation.erro('CONFIG', 'Nenhuma forma de gravação preservou os tipos dos dados nesta conta (veja o relatório do teste de gravação). A configuração foi interrompida sem mexer na planilha-banco.');
      if (!banco) {
        banco = producao
          ? files.criarPlanilha(NOME_BANCO, 'raiz', { erp_tipo: 'BANCO' })
          : files.criarPlanilha(NOMES_BANCO_TESTE[o.ambiente], 'testes', { erp_tipo: 'BANCO', erp_ambiente: o.ambiente });
        store.setProperty(chaveBanco, banco);
        rel.banco_criado = true;
      }
      // A forma de gravação de produção fica em IO_PRIMITIVE; a de um banco de teste, só nele.
      store.setProperty(producao ? PROP_PRIMITIVA : 'IO_PRIMITIVE:' + banco, escolha.primitiva);
      rel.banco = banco;
      if (vazio_(props[PROP_DONO])) store.setProperty(PROP_DONO, o.usuario);
      var io = Database.abrir(banco, { primitiva: escolha.primitiva, tabelas: o.tabelas });
      var criadas = io.criarTabelas(nomes);
      var colunas = io.acrescentarColunas(nomes);
      var acrescentadas = {};
      Object.keys(colunas).forEach(function (t) { if (colunas[t].length) acrescentadas[t] = colunas[t]; });
      rel.abas = { criadas: criadas, colunas_acrescentadas: acrescentadas, removidas: rel.banco_criado ? removerAbaPadrao_(banco, nomes) : [] };
      io.flush();

      var ctx = Database.contexto({ banco: banco, primitiva: escolha.primitiva, usuario: o.usuario, fuso: fusoSessao, files: files, projecoes: Timeline.porta() });
      var sem = UnitOfWork.run(ctx, {
        rota: 'sistema.setup', idempotencyKey: 'setup:' + ctx.idGen.uuid(), dados: { sementes_versao: Schema.SEMENTES_VERSAO },
        reads: SEMEADAS.slice(), anexaSemPai: SEMEADAS.slice(), permiteDuranteImportacao: true,
        tratador: function (tx) { var n = semear_(tx); return { resumo: n, resposta: n }; },
      });
      rel.sementes = sem.dados;
      // A unidade de sementes solta o lock ao terminar: o resto da configuração volta a segurá-lo.
      if (!lock.tentar(ESPERA_LOCK_MS)) throw Validation.erro('LOCKED', 'O sistema está ocupado gravando outra operação. Rode a configuração de novo.');
      var p = parametros_(ctx);
      var fuso = p.fuso || fusoSessao;
      io.definirPropriedades({ fuso: fuso, locale: 'pt_BR' });
      io.flush();
      rel.fuso = fuso;
      rel.schema_meta = gravarSchemaMeta_(io, nomes, clock.agora());
      rel.contadores = UnitOfWork.read(ctx, {
        rota: 'sistema.setup', reads: ['EVENTOS', 'ANIMAIS'], acessoCru: true,
        tratador: function (tx) {
          var seq = Utils.maximo(tx.cru.cru('EVENTOS'), 'event_seq');
          var cod = Utils.maximo(tx.cru.cru('ANIMAIS'), function (a) { var n = Number(String(a.codigo_interno || '').slice(2)); return isFinite(n) ? n : null; });
          return { proximo_event_seq: (seq || 0) + 1, proximo_codigo_interno: (cod || 0) + 1 };
        },
      }).dados;
      rel.gatilhos = garantirGatilhos(fuso);
      rel.protecoes = protegerAbas_(banco, nomes);
    } finally {
      if (lock.tem()) lock.soltar();
    }
    rel.integridade = AuditService.verificarIntegridade(Database.contexto({ banco: rel.banco, primitiva: rel.primitiva.primitiva, usuario: o.usuario, fuso: rel.fuso, files: files, projecoes: Timeline.porta() })).dados;
    return rel;
  }

  /** Estado para a tela de sistema: banco, forma de gravação, backups, último resumo de integridade e gatilhos. */
  function estado(ctx) {
    var p = ctx.props.ler();
    var integridade = null;
    try {
      integridade = p['INTEGRIDADE:' + ctx.banco] ? JSON.parse(p['INTEGRIDADE:' + ctx.banco]) : null;
    } catch (e) {
      integridade = { erro: 'Resumo ilegível: ' + texto_(e) };
    }
    var backups = listarBackups(ctx);
    return {
      banco: ctx.banco, primitiva: p['IO_PRIMITIVE:' + ctx.banco] || p[PROP_PRIMITIVA] || null, data_version: UnitOfWork.versao(ctx), backups: backups,
      ultimo_backup: backups[0] || null, integridade: integridade,
      gatilhos: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }),
      // O estado que InventoryService.consultaAlertas espera (BACKUP_ATRASADO, INTEGRIDADE_COM_ERRO).
      alertas_estado: {
        backup: { ultimo_em: backups[0] ? backups[0].instante : null },
        integridade: integridade && !integridade.erro ? { verificado_em: integridade.gerado_em, erros: integridade.erros } : null,
      },
    };
  }

  return {
    GATILHOS: GATILHOS,
    MOTIVOS_BACKUP: MOTIVOS_BACKUP,
    EXPORTACAO_VALIDADE_DIAS: EXPORTACAO_VALIDADE_DIAS,
    ANEXO_TEMPORARIO_HORAS: ANEXO_TEMPORARIO_HORAS,
    AMBIENTES: AMBIENTES,
    chaveDoAmbiente: chaveDoAmbiente,
    primitivaDoBanco: primitivaDoBanco,
    contexto: contexto,
    setup: setup,
    backup: backup,
    listarBackups: listarBackups,
    aplicarRetencao: aplicarRetencao,
    restaurar: restaurar,
    limparExportacoes: limparExportacoes,
    limparAnexos: limparAnexos,
    manutencaoDiaria: manutencaoDiaria,
    integridadeSemanal: integridadeSemanal,
    garantirGatilhos: garantirGatilhos,
    listarGatilhos: listarGatilhos,
    estado: estado,
  };
})();
