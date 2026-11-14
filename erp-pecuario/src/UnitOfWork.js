/**
 * UnitOfWork — a única fronteira de escrita (P2) e a leitura otimista validada.
 *
 * Comando (06, seção 5; desenho-base 4.2 e 16.4/16.5): lock de script (até 25 s) → recuperação preventiva →
 * idempotência por OPERACOES → tratador → fase A (marcador, OPERACOES INICIADA, linhas inertes, flush) →
 * fase B (OPERACOES.status = CONFIRMADA: a célula de commit, flush) → fase C (derivados, flush, aplicada_em,
 * flush, DATA_VERSION, remove o marcador) → solta o lock.
 * Regra que sustenta tudo: a fase A só anexa; a fase B troca uma célula; a fase C recalcula e pode ser repetida.
 * A recuperação nunca desfaz nada, decide só pelo que relê com o lock na mão e é reentrante.
 *
 * Puro: só portas do contexto (docs/CONTRATOS.md, "Portas e contexto de execução"). Não conhece pecuária: as
 * projeções vêm da porta `ctx.projecoes`.
 */
var UnitOfWork = (function () {
  var ESPERA_COMANDO_MS = 25000;
  var ESPERA_LEITURA_MS = 5000;
  var ESPERA_ERROS_MS = 2000;
  var TENTATIVAS_LEITURA = 3;
  var MSG_OCUPADO = 'O sistema está ocupado gravando outra operação. Aguarde alguns segundos e tente de novo.';
  var MSG_FALHA = 'Não foi possível concluir a gravação e nada foi alterado. Tente de novo.';
  var MSG_INCERTA = 'A gravação foi interrompida depois da confirmação e pode já valer. Atualize a tela e confira antes de lançar de novo; reenviar este mesmo formulário não duplica.';
  var MSG_ORFA = 'Execução interrompida antes da confirmação.';
  var MSG_IMPORTANDO = 'Há uma importação de planilha em andamento. Conclua ou desfaça a importação antes de fazer outros lançamentos.';
  var RESERVADAS = Object.freeze({ OPERACOES: true, AUDITORIA: true, ERROS_LOG: true });

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function interno_(mensagem) {
    return Validation.erro('INTERNAL', mensagem);
  }
  function chaveVersao(banco) {
    return 'DATA_VERSION:' + banco;
  }
  function chaveMarcador(banco) {
    return 'PENDING_OP:' + banco;
  }
  function exigirContexto_(ctx) {
    ['io', 'lock', 'clock', 'idGen', 'hash', 'props'].forEach(function (porta) {
      if (!ctx || !ctx[porta]) throw interno_('Contexto de execução sem a porta ' + porta + '.');
    });
    if (vazio_(ctx.banco)) throw Validation.erro('CONFIG', 'O sistema ainda não tem planilha configurada. Execute a configuração inicial (setup).');
    if (ctx.unidadeAtiva) throw interno_('A UnitOfWork não é reentrante: tratador não chama run, read, status nem recoverAll.');
  }
  /** Um ponto de leitura das Script Properties: UM getProperties(), só as chaves deste banco. */
  function estadoProps_(ctx) {
    var p = ctx.props.ler();
    var v = parseInt(p[chaveVersao(ctx.banco)], 10);
    var m = p[chaveMarcador(ctx.banco)];
    return { versao: isFinite(v) ? v : 0, marcador: vazio_(m) ? null : m };
  }
  function novoEstado_(ctx, cmd) {
    return { ctx: ctx, cmd: cmd, repo: Repository.abrir(ctx), versao: 0, agora: ctx.clock.agora(), opId: null, fase: 'INICIO' };
  }
  function leiturasDasProjecoes_(ctx) {
    return (ctx.projecoes && ctx.projecoes.reads) || [];
  }
  function novoTx_(est, simulacao, comCru) {
    var ctx = est.ctx;
    var cmd = est.cmd || {};
    return {
      repo: est.repo.publico(),
      cru: comCru || cmd.acessoCru ? est.repo.leituraCrua() : null,
      plano: Repository.plano(),
      rota: cmd.rota || null,
      dados: cmd.dados === undefined ? {} : cmd.dados,
      avisosAceitos: cmd.avisosAceitos || [],
      usuario: ctx.usuario,
      agora: est.agora,
      hoje: vazio_(ctx.fuso) ? null : Utils.hoje(est.agora, ctx.fuso),
      opId: est.opId,
      novoId: function () { return ctx.idGen.uuid(); },
      simulacao: !!simulacao,
      dataVersion: est.versao,
      ctx: ctx,
    };
  }

  // ------------------------------------------------------------------ ERROS_LOG (fora do journal) ----
  /** Guarda um registro de erro para gravar no fim da execução: {contexto, codigo, mensagem, erro, op_id}. */
  function anotarErro(ctx, registro) {
    if (!ctx.errosPendentes) ctx.errosPendentes = [];
    ctx.errosPendentes.push(registro);
  }
  /**
   * Anexa em ERROS_LOG os registros anotados (06, seção 6): linha completa em si mesma, sem operação, sem commit e
   * sem mudar a versão dos dados. Usa o lock que a execução já tem, ou tenta obtê-lo por pouco tempo; sem lock, ou
   * se a gravação falhar, os registros são descartados (perdê-los é aceitável) e o motivo vem no retorno.
   */
  function descarregarErros(ctx) {
    var fila = ctx.errosPendentes || [];
    var n = fila.length;
    if (!n) return { gravados: 0, descartados: 0, motivo: null };
    var lote = fila.splice(0, n);
    var tinha = null;
    try {
      tinha = ctx.lock.tem();
      if (!tinha && !ctx.lock.tentar(ESPERA_ERROS_MS)) {
        tinha = null;
        return { gravados: 0, descartados: n, motivo: 'LOCKED' };
      }
      ctx.io.anexar({ ERROS_LOG: lote.map(function (r) { return AuditService.linhaErro(ctx, r); }) });
      ctx.io.flush();
      return { gravados: n, descartados: 0, motivo: null };
    } catch (e) {
      return { gravados: 0, descartados: n, motivo: String(e && e.message ? e.message : e) };
    } finally {
      if (tinha === false) soltarSemFalhar_(ctx);
    }
  }
  /** Solta o lock obtido só para gravar ERROS_LOG; falha aqui não muda o resultado (o lock cai com a execução). */
  function soltarSemFalhar_(ctx) {
    try {
      ctx.lock.soltar();
      return null;
    } catch (e) {
      return e;
    }
  }
  function anotarCoercoes_(est, contexto) {
    var porTabela = {};
    est.repo.alertas().forEach(function (a) {
      if (!porTabela[a.tabela]) porTabela[a.tabela] = { n: 0, primeiro: a };
      porTabela[a.tabela].n += 1;
    });
    Object.keys(porTabela).forEach(function (t) {
      var p = porTabela[t];
      anotarErro(est.ctx, {
        contexto: contexto || 'leitura', codigo: 'CELULA_COERCIDA',
        mensagem: 'Aba ' + t + ': ' + p.n + ' célula(s) fora do formato esperado. Primeira: linha ' + p.primeiro.linha + ', coluna ' + p.primeiro.coluna + ' — ' + p.primeiro.mensagem,
      });
    });
  }
  /** Solta o lock no fim da unidade. Se a unidade já falhou, o erro dela prevalece sobre o da liberação. */
  function liberar_(ctx, houveFalha) {
    ctx.unidadeAtiva = false;
    try {
      descarregarErros(ctx);
      ctx.lock.soltar();
    } catch (e) {
      if (!houveFalha) throw e;
    }
  }

  // ------------------------------------------------------------------ escrita com espelho na memória ----
  /** Relê da planilha tudo o que estava na memória (posições e valores deixam de ser supostos). */
  function recarregar_(est) {
    var tabelas = est.repo.carregadas();
    est.ctx.io.esquecer();
    est.repo = Repository.abrir(est.ctx);
    est.repo.carregar(tabelas);
  }
  /** Grava só as células que mudam e espelha na memória. Devolve quantas células gravou. */
  function gravar_(est, atualizacoes) {
    var escritas = est.repo.resolver(atualizacoes);
    if (!escritas.length) return 0;
    var n = est.ctx.io.atualizar(escritas);
    escritas.forEach(function (w) { est.repo.alterar(w.tabela, w.id, w.campos); });
    return n;
  }
  /**
   * Anexa o lote e espelha na memória as tabelas já carregadas. A posição das linhas novas é CONFERIDA na
   * planilha (uma leitura); se não conferir, relê as abas inteiras em vez de confiar na posição suposta.
   */
  function anexar_(est, lote, descarregar) {
    var io = est.ctx.io;
    var tabelas = Object.keys(lote).filter(function (t) { return lote[t] && lote[t].length; });
    if (!tabelas.length) return;
    var onde = io.anexar(lote);
    if (descarregar) io.flush();
    var conferir = tabelas.filter(function (t) { return est.repo.carregada(t); }).map(function (t) {
      return { tabela: t, linha: onde[t], id: lote[t][0][Schema.pk(t)] };
    });
    if (io.conferirPosicoes(conferir)) conferir.forEach(function (c) { est.repo.incluir(c.tabela, lote[c.tabela], c.linha); });
    else recarregar_(est);
  }

  // ------------------------------------------------------------------ fase C (derivados) ----
  /** O que o cache EVENTOS.status / confirmed_at / reversed_by_event_id deve guardar, pelo predicado de vigência. */
  function statusDosEventos_(est, agora) {
    if (!est.repo.carregada('EVENTOS')) return [];
    return est.repo.cru('EVENTOS').map(function (e) {
      var a = est.repo.avaliar(e.event_id);
      var campos = { status: a.status, reversed_by_event_id: a.anulador_id };
      if ((a.status === 'CONFIRMADO' || a.status === 'ESTORNADO') && vazio_(e.confirmed_at)) campos.confirmed_at = agora;
      return { tabela: 'EVENTOS', id: e.event_id, campos: campos };
    });
  }
  /**
   * Derivados de operações CONFIRMADAS — repetível: (1) refaz a auditoria de cada operação (aplica valor_novo;
   * cria o cadastro que ainda não existe); (2) cache de status dos eventos; (3) projeções pela porta
   * ctx.projecoes (`tudo` na recuperação, `escopo` do tratador no caminho normal). Só grava o que difere.
   * o: {operacoes: [{op, linhas}], escopo, tudo, agora, fecho}. `fecho` (ex.: OPERACOES.finished_at) vai na mesma
   * gravação dos derivados: fica durável no flush que precede aplicada_em, nunca depois dela.
   */
  function derivar_(est, o) {
    var ctx = est.ctx;
    (o.operacoes || []).forEach(function (a) {
      var r = AuditService.refazer(est.repo, ctx.io, a.op, a.linhas);
      r.semAlvo.forEach(function (s) {
        anotarErro(ctx, { contexto: 'auditoria', codigo: 'AUDITORIA_SEM_ALVO', mensagem: s.entidade + ' ' + s.entity_id + ': ' + s.motivo, op_id: a.op.op_id });
      });
      anexar_(est, r.criar, false);
      gravar_(est, r.atualizar);
    });
    var derivados = statusDosEventos_(est, o.agora);
    if (ctx.projecoes && (o.tudo || (o.escopo !== null && o.escopo !== undefined))) {
      var tx = novoTx_(est, false, true);
      ctx.projecoes.reconstruir(tx, o.tudo ? { tudo: true } : o.escopo);
      derivados = derivados.concat(tx.plano.atualizacoes());
    }
    gravar_(est, derivados.concat(o.fecho || []));
  }

  // ------------------------------------------------------------------ recuperação ----
  /**
   * Recuperação (06, seção 6). Pré-condição: quem chama TEM o lock. Relê marcador e OPERACOES descartando a
   * memória; INICIADA → FALHOU; CONFIRMADA sem aplicada_em → fase C refeita; com marcador presente (ou `tudo`)
   * reconstrói status e projeções de tudo; registra (ERROS_LOG sempre; AUDITORIA quando refez a fase C); flush;
   * versão; remove o marcador. Pode morrer em qualquer ponto: a execução seguinte refaz e chega ao mesmo estado.
   * opcoes: {tudo, motivo} — `motivo` vai para OPERACOES.erro da operação da própria unidade (exceção tratada).
   */
  function recuperar_(est, opcoes) {
    var ctx = est.ctx;
    var io = ctx.io;
    var o = opcoes || {};
    io.esquecer();
    var p = estadoProps_(ctx);
    est.versao = p.versao;
    est.repo = Repository.abrir(ctx);
    est.repo.carregar(['OPERACOES']);
    var orfas = est.repo.operacoesOrfas().map(function (op) { return { op_id: op.op_id, status: op.status, comando: op.comando }; });
    var resumo = { recuperou: false, marcador: !!p.marcador, falharam: [], refeitas: [], dataVersion: p.versao };
    if (!p.marcador && !orfas.length && !o.tudo) return resumo;
    // Daqui em diante há trabalho: o marcador garante que uma queda no meio leve a próxima execução a refazer.
    if (!p.marcador) ctx.props.gravar(chaveMarcador(ctx.banco), JSON.stringify({ recuperacao: true, desde: ctx.clock.agora() }));
    var agora = ctx.clock.agora();
    est.repo.carregar(['EVENTOS', 'IMPORTACOES', 'AUDITORIA'].concat(leiturasDasProjecoes_(ctx)));

    var registros = [];
    var motivos = [];
    orfas.forEach(function (op) {
      if (op.status !== 'INICIADA') return;
      var propria = op.op_id === est.opId && !vazio_(o.motivo);
      resumo.falharam.push(op.op_id);
      motivos.push({ tabela: 'OPERACOES', id: op.op_id, campos: { erro: propria ? o.motivo : MSG_ORFA, finished_at: agora } });
      registros.push({
        contexto: 'recuperacao', codigo: 'OPERACAO_INTERROMPIDA', op_id: op.op_id, erro: propria ? o.erro : null,
        mensagem: 'Operação ' + op.comando + ' interrompida antes da confirmação: marcada como FALHOU; nada foi alterado.' + (propria ? ' Motivo: ' + o.motivo : ''),
      });
    });
    // Motivo e fim ficam duráveis ANTES do status: uma linha FALHOU nunca fica sem OPERACOES.erro e finished_at
    // (células vizinhas não chegam juntas; FALHOU não é órfã, logo nenhuma recuperação voltaria a completá-la).
    if (motivos.length) {
      gravar_(est, motivos);
      io.flush();
      gravar_(est, motivos.map(function (m) { return { tabela: 'OPERACOES', id: m.id, campos: { status: 'FALHOU' } }; }));
    }

    var refazer = [];
    var entidades = [];
    orfas.forEach(function (o2) {
      if (o2.status !== 'CONFIRMADA') return;
      var linhas = est.repo.cruPor('AUDITORIA', 'op_id', o2.op_id);
      linhas.forEach(function (l) { if (Schema.temTabela(l.entidade) && entidades.indexOf(l.entidade) < 0) entidades.push(l.entidade); });
      refazer.push({ op: est.repo.cruPorId('OPERACOES', o2.op_id), linhas: linhas });
      resumo.refeitas.push(o2.op_id);
      registros.push({ contexto: 'recuperacao', codigo: 'FASE_C_REFEITA', op_id: o2.op_id, mensagem: 'Operação ' + o2.comando + ' confirmada sem os derivados: fase C reexecutada.' });
    });
    if (entidades.indexOf('IMPORTACOES') >= 0 && entidades.indexOf('EVENTOS') < 0) entidades.push('EVENTOS');
    est.repo.carregar(entidades);
    derivar_(est, {
      operacoes: refazer, tudo: true, agora: agora,
      fecho: resumo.refeitas.map(function (id) { return { tabela: 'OPERACOES', id: id, campos: { finished_at: agora } }; }),
    });
    io.flush();

    if (!registros.length && p.marcador) {
      registros.push({ contexto: 'recuperacao', codigo: 'MARCADOR_SEM_OPERACAO', mensagem: 'Havia marcador de operação em curso sem operação pendente: derivados conferidos e marcador removido.' });
    }
    // A trilha vai antes de aplicada_em: uma queda depois dela leva a próxima recuperação a refazer (e a registrar de novo).
    var lote = { AUDITORIA: [], ERROS_LOG: registros.map(function (r) { return AuditService.linhaErro(ctx, r); }) };
    resumo.refeitas.forEach(function (id) {
      lote.AUDITORIA = lote.AUDITORIA.concat(AuditService.linhas(ctx, { op_id: id, usuario: vazio_(ctx.usuario) ? 'sistema' : ctx.usuario, timestamp: agora }, [
        { entidade: 'OPERACOES', entity_id: id, acao: 'RECUPERACAO', valor_novo: 'fase C reexecutada' },
      ]));
    });
    anexar_(est, lote, false);
    io.flush();
    gravar_(est, resumo.refeitas.map(function (id) { return { tabela: 'OPERACOES', id: id, campos: { aplicada_em: agora } }; }));
    io.flush();
    est.versao += 1;
    ctx.props.gravar(chaveVersao(ctx.banco), String(est.versao));
    ctx.props.remover(chaveMarcador(ctx.banco));
    resumo.recuperou = true;
    resumo.dataVersion = est.versao;
    return resumo;
  }
  /** Abertura de toda unidade que tem o lock: lê propriedades e abas e, havendo marcador ou órfã, recupera antes. */
  function abrirSobLock_(est, tabelas) {
    var ctx = est.ctx;
    var lista = ['OPERACOES'].concat(tabelas || []);
    ctx.io.esquecer();
    var p = estadoProps_(ctx);
    est.versao = p.versao;
    est.repo = Repository.abrir(ctx);
    est.repo.carregar(lista);
    if (!p.marcador && !est.repo.operacoesOrfas().length) return;
    recuperar_(est, {});
    ctx.io.esquecer();
    est.repo = Repository.abrir(ctx);
    est.repo.carregar(lista);
  }

  // ------------------------------------------------------------------ comando ----
  function normalizarComando_(c) {
    var o = c || {};
    if (typeof o.rota !== 'string' || o.rota === '') throw interno_('Comando sem rota.');
    if (typeof o.tratador !== 'function') throw interno_('Comando ' + o.rota + ' sem tratador.');
    return {
      rota: o.rota,
      dados: o.dados === undefined || o.dados === null ? {} : o.dados,
      chave: vazio_(o.idempotencyKey) ? null : String(o.idempotencyKey),
      avisosAceitos: o.avisosAceitos || [],
      dataVersionEsperada: vazio_(o.dataVersionEsperada) ? null : Number(o.dataVersionEsperada),
      modo: o.modo || 'EXECUTAR',
      reads: o.reads || [],
      tratador: o.tratador,
      reconstruir: typeof o.reconstruir === 'function' ? o.reconstruir : null,
      acessoCru: !!o.acessoCru,
      anexaSemPai: o.anexaSemPai || [],
      permiteDuranteImportacao: !!o.permiteDuranteImportacao,
    };
  }
  function conferirValidacoes_(res, aceitos) {
    var erros = res.erros || [];
    if (erros.length) throw Validation.erro('VALIDATION', erros.length === 1 && !vazio_(erros[0].mensagem) ? erros[0].mensagem : 'Há ' + erros.length + ' problemas a corrigir antes de gravar.', erros);
    return (res.avisos || []).filter(function (a) { return aceitos.indexOf(a.codigo) < 0; });
  }
  function carimbar_(est, tabela, registro) {
    var r = {};
    Object.keys(registro).forEach(function (k) { r[k] = registro[k]; });
    if (tabela === 'EVENTOS') {
      r.op_id = est.opId;
      r.status = 'PENDENTE';
      r.idempotency_key = est.cmd.chave;
      r.reversed_by_event_id = null;
      r.confirmed_at = null;
      if (vazio_(r.created_by)) r.created_by = est.ctx.usuario;
    }
    if (tabela === 'ANIMAIS') r.situacao_cadastral = 'PENDENTE';
    if (Schema.temColuna(tabela, 'created_at') && vazio_(r.created_at)) r.created_at = est.agora;
    if (Schema.temColuna(tabela, 'updated_at') && vazio_(r.updated_at)) r.updated_at = est.agora;
    return r;
  }
  /**
   * Fecha o plano do tratador: confere o que pode ser anexado na fase A (só linha que fica inerte até o commit),
   * carimba as colunas do journal, monta as linhas de AUDITORIA e valida tudo contra o esquema e os tetos.
   */
  function fecharPlano_(est, tx) {
    var plano = tx.plano;
    if (plano.atualizacoes().length) throw interno_('O tratador não atualiza células direto: mudança de cadastro vai por auditoria e derivado vai pela projeção da fase C.');
    var linhas = plano.linhas();
    var lote = {};
    var detalhes = [];
    Object.keys(linhas).forEach(function (tabela) {
      if (RESERVADAS[tabela]) throw interno_('A tabela ' + tabela + ' é gravada só pela UnitOfWork.');
      if (Repository.regra(tabela) === 'SEMPRE' && est.cmd.anexaSemPai.indexOf(tabela) < 0) {
        throw interno_('Linha de ' + tabela + ' não fica inerte na fase A (não tem evento pai): crie o registro por auditoria (AuditService.criacao).');
      }
      lote[tabela] = linhas[tabela].map(function (r) { return carimbar_(est, tabela, r); });
      lote[tabela].forEach(function (r) { detalhes = detalhes.concat(Validation.validarRegistro(tabela, r, { semProjecoes: true })); });
    });
    var auditoria = AuditService.linhas(est.ctx, { op_id: est.opId, usuario: est.ctx.usuario, timestamp: est.agora }, plano.mudancas());
    auditoria.forEach(function (r) { detalhes = detalhes.concat(Validation.validarRegistro('AUDITORIA', r)); });
    if (detalhes.length) throw Validation.erro('VALIDATION', 'Há ' + detalhes.length + ' campo(s) com problema no que seria gravado.', detalhes);
    var entidades = Utils.unicos(auditoria.map(function (l) { return l.entidade; }).filter(function (e) { return Schema.temTabela(e); }));
    return { lote: lote, auditoria: auditoria, entidades: entidades, vazio: !Object.keys(lote).length && !auditoria.length };
  }
  function operacaoPublica_(op) {
    return {
      op_id: op.op_id, comando: op.comando, status: op.status, resumo: op.resumo_json === undefined ? null : op.resumo_json,
      erro: op.erro || null, started_at: op.started_at, finished_at: op.finished_at || null,
    };
  }
  /** Resposta de operação já confirmada (duplicado ou concluída pela recuperação): reconstruída do que está gravado. */
  function reconstruir_(est, op) {
    var publica = operacaoPublica_(op);
    if (!est.cmd.reconstruir) return { resumo: publica.resumo };
    est.repo.carregar(est.cmd.reads);
    return est.cmd.reconstruir(novoTx_(est, false), publica);
  }
  /**
   * Erro devolvido quando a gravação não terminou bem. `incerta` = a recuperação falhou depois de o commit poder
   * ter chegado (fase B ou C): aí não se pode dizer ao usuário que nada foi alterado — ele lançaria de novo, com
   * outra chave, e duplicaria o lançamento.
   */
  function falha_(erro, erroDaRecuperacao, incerta) {
    if (Validation.ehAppError(erro)) return erro;
    var e = Validation.erro('INTERNAL', incerta ? MSG_INCERTA : MSG_FALHA);
    e.causa = String(erro && erro.message ? erro.message : erro);
    if (erroDaRecuperacao) e.recuperacao = String(erroDaRecuperacao.message || erroDaRecuperacao);
    return e;
  }
  function executar_(est) {
    var ctx = est.ctx;
    var cmd = est.cmd;
    var io = ctx.io;
    var hash = Utils.payloadHash(cmd.rota, cmd.dados, ctx.hash);
    abrirSobLock_(est, cmd.permiteDuranteImportacao ? cmd.reads : cmd.reads.concat(['IMPORTACOES']));

    // Idempotência: a autoridade é OPERACOES (no máximo uma CONFIRMADA por chave).
    var confirmada = est.repo.cruPor('OPERACOES', 'idempotency_key', cmd.chave).filter(function (op) { return op.status === 'CONFIRMADA'; })[0];
    if (confirmada) {
      if (confirmada.payload_hash !== hash) {
        throw Validation.erro('IDEMPOTENCY_MISMATCH', 'Este formulário já foi gravado com outro conteúdo. Atualize a tela e comece um lançamento novo.');
      }
      return { dados: reconstruir_(est, confirmada), duplicado: true, opId: confirmada.op_id, dataVersion: est.versao };
    }
    // Importação em curso (desenho-base, 16.8): recusam-se os comandos de negócio; importacao.* e manutenção passam.
    if (!cmd.permiteDuranteImportacao && est.repo.cru('IMPORTACOES').some(function (i) { return i.status === 'IMPORTANDO'; })) {
      throw Validation.erro('CONFLICT', MSG_IMPORTANDO);
    }
    if (cmd.dataVersionEsperada !== null && cmd.dataVersionEsperada !== est.versao) {
      throw Validation.erro('CONFLICT', 'Os dados mudaram desde que você abriu a revisão. Confira de novo antes de confirmar.');
    }

    est.opId = ctx.idGen.uuid();
    var tx = novoTx_(est, false);
    var res = cmd.tratador(tx) || {};
    var pendentes = conferirValidacoes_(res, cmd.avisosAceitos);
    if (pendentes.length) throw Validation.erro('NEEDS_CONFIRMATION', 'Confira os avisos antes de confirmar.', pendentes);
    var plano = fecharPlano_(est, tx);
    if (plano.vazio) {
      anotarCoercoes_(est, cmd.rota);
      return { dados: typeof res.resposta === 'function' ? res.resposta(novoTx_(est, false)) : res.resposta === undefined ? null : res.resposta, duplicado: false, semAlteracao: true, opId: null, dataVersion: est.versao };
    }
    var op = {
      op_id: est.opId, idempotency_key: cmd.chave, payload_hash: hash, comando: cmd.rota, status: 'INICIADA', aplicada_em: null,
      resumo_json: res.resumo === undefined ? null : res.resumo, erro: null, usuario: ctx.usuario, started_at: est.agora, finished_at: null,
    };
    var problemas = Validation.validarRegistro('OPERACOES', op);
    if (problemas.length) throw Validation.erro('VALIDATION', 'O resumo da operação não pôde ser gravado.', problemas);
    // Tudo o que a fase C vai atualizar precisa estar na memória ANTES de gravar: linhas novas, alvos da auditoria e projeções.
    var extras = Object.keys(plano.lote).concat(plano.entidades);
    if (plano.entidades.indexOf('IMPORTACOES') >= 0) extras.push('EVENTOS');
    if (res.derivados !== null && res.derivados !== undefined) extras = extras.concat(leiturasDasProjecoes_(ctx));
    est.repo.carregar(extras);

    // Fase A — só anexa: marcador, OPERACOES INICIADA, linhas inertes, auditoria.
    est.fase = 'A';
    ctx.props.gravar(chaveMarcador(ctx.banco), JSON.stringify({ op_id: est.opId, comando: cmd.rota, desde: est.agora }));
    // Ordem das escritas da fase A (06, seção 5): OPERACOES, EVENTOS, linhas filhas, AUDITORIA.
    var lote = { OPERACOES: [op] };
    if (plano.lote.EVENTOS) lote.EVENTOS = plano.lote.EVENTOS;
    Object.keys(plano.lote).forEach(function (t) { lote[t] = plano.lote[t]; });
    if (plano.auditoria.length) lote.AUDITORIA = plano.auditoria;
    anexar_(est, lote, true);
    if (!est.repo.cruPorId('OPERACOES', est.opId)) throw new Error('A linha da operação não foi encontrada depois da fase A.');

    // Fase B — commit: uma célula.
    est.fase = 'B';
    gravar_(est, [{ tabela: 'OPERACOES', id: est.opId, campos: { status: 'CONFIRMADA' } }]);
    io.flush();

    // Fase C — derivados (repetível), em dois passos: derivados e finished_at → flush → aplicada_em → flush.
    est.fase = 'C';
    var fim = ctx.clock.agora();
    derivar_(est, {
      operacoes: plano.auditoria.length ? [{ op: op, linhas: plano.auditoria }] : [],
      escopo: res.derivados, agora: fim,
      fecho: [{ tabela: 'OPERACOES', id: est.opId, campos: { finished_at: fim } }],
    });
    io.flush();
    gravar_(est, [{ tabela: 'OPERACOES', id: est.opId, campos: { aplicada_em: fim } }]);
    io.flush();
    est.versao += 1;
    ctx.props.gravar(chaveVersao(ctx.banco), String(est.versao));
    ctx.props.remover(chaveMarcador(ctx.banco));
    est.fase = 'FIM';

    anotarCoercoes_(est, cmd.rota);
    var dados = typeof res.resposta === 'function' ? res.resposta(novoTx_(est, false)) : res.resposta === undefined ? null : res.resposta;
    return { dados: dados, duplicado: false, opId: est.opId, dataVersion: est.versao };
  }
  /**
   * Exceção tratada depois de a gravação começar (06, seção 5.1): não há limpeza própria. Com o lock, aplica a
   * recuperação à própria operação, relendo a planilha. Operação CONFIRMADA → fase C refeita e resposta de
   * sucesso; INICIADA ou ausente → FALHOU (motivo em OPERACOES.erro) e erro retentável com a mesma chave. Se a
   * própria recuperação falhar, o marcador fica e a chamada seguinte recupera.
   */
  function aposFalha_(est, erro) {
    var motivo = String(erro && erro.message ? erro.message : erro).slice(0, 500);
    try {
      recuperar_(est, { motivo: motivo, erro: erro });
    } catch (e2) {
      throw falha_(erro, e2, est.fase !== 'A'); // na fase A o commit ainda não foi pedido: nada vale, com ou sem recuperação
    }
    var op = est.repo.cruPorId('OPERACOES', est.opId);
    if (!op || op.status !== 'CONFIRMADA' || vazio_(op.aplicada_em)) throw falha_(erro);
    return { dados: reconstruir_(est, op), duplicado: false, recuperada: true, opId: est.opId, dataVersion: est.versao };
  }
  /**
   * Executa um comando (toda mutação passa por aqui). Ver docs/CONTRATOS.md, seção UnitOfWork.
   * Devolve {dados, duplicado, opId, dataVersion} (+ semAlteracao, recuperada). Erros: LOCKED, VALIDATION,
   * NEEDS_CONFIRMATION, CONFLICT, IDEMPOTENCY_MISMATCH, CONFIG, INTERNAL.
   */
  function run(ctx, comando) {
    exigirContexto_(ctx);
    var cmd = normalizarComando_(comando);
    if (cmd.modo === 'SIMULAR') {
      try {
        return simular_(ctx, cmd);
      } finally {
        descarregarErros(ctx);
      }
    }
    if (cmd.modo !== 'EXECUTAR') throw interno_('Modo de comando desconhecido: ' + cmd.modo + '.');
    if (!cmd.chave) throw Validation.erro('VALIDATION', 'O pedido veio sem a chave de idempotência. Atualize a tela e tente de novo.');
    if (vazio_(ctx.usuario)) throw interno_('Contexto de execução sem usuário.');
    if (!ctx.lock.tentar(ESPERA_COMANDO_MS)) throw Validation.erro('LOCKED', MSG_OCUPADO);
    ctx.unidadeAtiva = true;
    var est = novoEstado_(ctx, cmd);
    var falhou = true;
    try {
      var r;
      try {
        r = executar_(est);
      } catch (e) {
        if (est.fase === 'INICIO' || est.fase === 'FIM') throw e; // nada gravado (ou tudo gravado): o erro é só a resposta
        r = aposFalha_(est, e);
      }
      falhou = false;
      return r;
    } finally {
      liberar_(ctx, falhou);
    }
  }
  /**
   * Modo SIMULAR: roda o MESMO tratador e fecha o MESMO plano do comando, como consulta (leitura validada, sem
   * lock de escrita, sem gravar). Erro de validação é lançado como no comando; avisos voltam na resposta.
   */
  function simular_(ctx, cmd) {
    return lerValidado_(ctx, cmd, cmd.reads, function (est) {
      est.opId = ctx.idGen.uuid();
      if (!est.cmd.chave) est.cmd.chave = 'simulacao';
      var tx = novoTx_(est, true);
      var res = cmd.tratador(tx) || {};
      var pendentes = conferirValidacoes_(res, []);
      var plano = fecharPlano_(est, tx);
      var linhas = tx.plano.contagem();
      if (plano.auditoria.length) linhas.AUDITORIA = plano.auditoria.length;
      return {
        simulacao: true,
        impactos: res.impactos !== undefined ? res.impactos : res.resumo === undefined ? null : res.resumo,
        avisos: pendentes.map(Validation.detalhe),
        linhas: linhas,
      };
    });
  }

  // ------------------------------------------------------------------ consulta ----
  /**
   * Leitura otimista validada (06, seção 7): (1) lê marcador e versão; com marcador, tenta o lock por até 5 s —
   * obteve: recupera; não obteve: LOCKED; (2) lê as abas; (3) relê marcador e versão; mudou: repete. Depois de 3
   * tentativas, LOCKED. Nunca serve dados com marcador presente.
   */
  function lerValidado_(ctx, cmd, tabelas, fn) {
    for (var tentativa = 1; tentativa <= TENTATIVAS_LEITURA; tentativa++) {
      ctx.io.esquecer();
      var est = novoEstado_(ctx, cmd);
      var antes = estadoProps_(ctx);
      if (antes.marcador) {
        if (!ctx.lock.tentar(ESPERA_LEITURA_MS)) throw Validation.erro('LOCKED', MSG_OCUPADO);
        try {
          recuperar_(est, {});
        } finally {
          ctx.lock.soltar();
        }
        continue;
      }
      est.versao = antes.versao;
      est.repo = Repository.abrir(ctx);
      est.repo.carregar(tabelas);
      var depois = estadoProps_(ctx);
      if (depois.marcador || depois.versao !== antes.versao) continue;
      var dados = fn(est);
      anotarCoercoes_(est, cmd.rota);
      return { dados: dados, dataVersion: antes.versao };
    }
    throw Validation.erro('LOCKED', MSG_OCUPADO);
  }
  /**
   * Executa uma consulta: {rota, dados, reads, tratador(tx) → dados, acessoCru}. Não toma o lock de escrita e não
   * grava dado de negócio. Devolve {dados, dataVersion}. Erros: LOCKED (retentável), além dos do tratador.
   */
  function read(ctx, consulta) {
    exigirContexto_(ctx);
    var q = consulta || {};
    if (typeof q.tratador !== 'function') throw interno_('Consulta sem tratador.');
    var cmd = { rota: q.rota || 'consulta', dados: q.dados === undefined || q.dados === null ? {} : q.dados, avisosAceitos: [], reads: q.reads || [], acessoCru: !!q.acessoCru };
    try {
      return lerValidado_(ctx, cmd, cmd.reads, function (est) { return q.tratador(novoTx_(est, false)); });
    } finally {
      descarregarErros(ctx); // ERROS_LOG: a única escrita que uma consulta pode causar (06, seção 6)
    }
  }

  // ------------------------------------------------------------------ estado da operação ----
  function situacao_(situacao, op) {
    var p = op ? operacaoPublica_(op) : { op_id: null, comando: null, resumo: null, erro: null, started_at: null, finished_at: null };
    return { situacao: situacao, op_id: p.op_id, comando: p.comando, resumo: p.resumo, erro: p.erro, started_at: p.started_at, finished_at: p.finished_at };
  }
  /**
   * `operacao.status(chave)` (06, seções 7 e 8): CONFIRMADA | EM_ANDAMENTO | FALHOU | INEXISTENTE. Com marcador
   * presente, ou operação da chave ainda pendente, tenta o lock SEM esperar: não obteve → EM_ANDAMENTO (há
   * gravação em curso; CONFIRMADA se a da chave já está completa); obteve → recupera e responde o estado final.
   */
  function status(ctx, chave) {
    exigirContexto_(ctx);
    if (vazio_(chave)) throw Validation.erro('VALIDATION', 'Informe a chave da operação a consultar.');
    ctx.io.esquecer();
    var est = novoEstado_(ctx, null);
    var p = estadoProps_(ctx);
    est.repo.carregar(['OPERACOES']);
    var ops = est.repo.cruPor('OPERACOES', 'idempotency_key', String(chave));
    var completa = ops.filter(function (op) { return op.status === 'CONFIRMADA' && !vazio_(op.aplicada_em); })[0];
    var pendente = ops.some(function (op) { return op.status === 'INICIADA' || (op.status === 'CONFIRMADA' && vazio_(op.aplicada_em)); });
    if (p.marcador || pendente) {
      // Regra dos leitores (desenho-base, 16.5): com marcador ou operação pendente, tenta o lock sem esperar.
      if (!ctx.lock.tentar(0)) return completa && !pendente ? situacao_('CONFIRMADA', completa) : situacao_('EM_ANDAMENTO', null);
      try {
        recuperar_(est, {});
        ops = est.repo.cruPor('OPERACOES', 'idempotency_key', String(chave));
        descarregarErros(ctx); // com o lock ainda na mão: a trilha anotada pela recuperação (ex.: AUDITORIA_SEM_ALVO) não se perde
      } finally {
        ctx.lock.soltar();
      }
    }
    var confirmada = ops.filter(function (op) { return op.status === 'CONFIRMADA'; })[0];
    if (confirmada) return situacao_('CONFIRMADA', confirmada);
    var falhas = ops.filter(function (op) { return op.status === 'FALHOU'; });
    if (falhas.length) return situacao_('FALHOU', falhas[falhas.length - 1]);
    return situacao_('INEXISTENTE', null);
  }

  // ------------------------------------------------------------------ manutenção ----
  /**
   * recoverAll (06, seção 6): a recuperação sobre OPERACOES inteira, com reconstrução de TODAS as projeções,
   * mesmo sem marcador. Usada depois de restaurar um backup e pela verificação semanal.
   * Devolve {recuperou, marcador, falharam, refeitas, dataVersion}. Erro: LOCKED.
   */
  function recoverAll(ctx) {
    exigirContexto_(ctx);
    if (!ctx.lock.tentar(ESPERA_COMANDO_MS)) throw Validation.erro('LOCKED', MSG_OCUPADO);
    ctx.unidadeAtiva = true;
    var falhou = true;
    try {
      var r = recuperar_(novoEstado_(ctx, null), { tudo: true });
      falhou = false;
      return r;
    } finally {
      liberar_(ctx, falhou);
    }
  }
  /**
   * Trabalho exclusivo sem journal (backup, verificação de integridade): espera o lock, recupera antes de
   * trabalhar e roda `tarefa.tratador(tx)` com o banco parado. tarefa: {rota, reads, acessoCru, tratador}.
   * O que a tarefa precisar GRAVAR em dado de negócio vai por `run`, fora daqui. Devolve {dados, dataVersion}.
   */
  function exclusivo(ctx, tarefa) {
    exigirContexto_(ctx);
    var t = tarefa || {};
    if (typeof t.tratador !== 'function') throw interno_('Tarefa exclusiva sem tratador.');
    if (!ctx.lock.tentar(ESPERA_COMANDO_MS)) throw Validation.erro('LOCKED', MSG_OCUPADO);
    ctx.unidadeAtiva = true;
    var falhou = true;
    try {
      var est = novoEstado_(ctx, { rota: t.rota || 'manutencao', dados: t.dados === undefined ? {} : t.dados, avisosAceitos: [], reads: t.reads || [], acessoCru: !!t.acessoCru });
      abrirSobLock_(est, est.cmd.reads);
      var dados = t.tratador(novoTx_(est, false));
      anotarCoercoes_(est, est.cmd.rota);
      falhou = false;
      return { dados: dados, dataVersion: est.versao };
    } finally {
      liberar_(ctx, falhou);
    }
  }
  /** Versão dos dados deste banco (DATA_VERSION:<id>), para o envelope da API. */
  function versao(ctx) {
    return estadoProps_(ctx).versao;
  }

  return {
    ESPERA_COMANDO_MS: ESPERA_COMANDO_MS,
    ESPERA_LEITURA_MS: ESPERA_LEITURA_MS,
    TENTATIVAS_LEITURA: TENTATIVAS_LEITURA,
    chaveVersao: chaveVersao,
    chaveMarcador: chaveMarcador,
    run: run,
    read: read,
    status: status,
    recoverAll: recoverAll,
    exclusivo: exclusivo,
    versao: versao,
    anotarErro: anotarErro,
    descarregarErros: descarregarErros,
  };
})();
