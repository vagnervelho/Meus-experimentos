/**
 * AuditService (parte 1) — trilha de AUDITORIA e registro de erros.
 *
 * AUDITORIA guarda as mutações que não são evento (edição [cad], coluna [ctl], configuração, recuperação,
 * manutenção) e é o REGISTRO DE REFAZER dos comandos sem evento (06, seção 5.2): a fase A anexa as linhas, a
 * fase B confirma a operação e a fase C aplica `valor_novo`. Uma linha só vale se a operação dela está
 * CONFIRMADA. Puro: usa as portas do contexto.
 *
 * Parte 2: listagem paginada da trilha completa (auditoria.listar: EVENTOS + AJUSTES + AUDITORIA) e a VERIFICAÇÃO
 * DE INTEGRIDADE (06, seção 9), sob demanda,
 * no fim do setup e semanal: entra pela UnitOfWork (lock, depois da recuperação), lê tudo com acesso cru e confere
 * cada invariante, com severidade (ERRO | ALERTA) e o reparo oferecido. Nunca corrige em silêncio: o reparo
 * (reconstruir projeções e o cache de status dos eventos) é um comando à parte, auditado.
 */
var AuditService = (function () {
  /** Tabelas que `listar` precisa nas leituras (reads) da consulta. */
  var LEITURAS = Object.freeze(['AUDITORIA']);
  var ACOES_DE_CAMPO = Object.freeze({ CRIAR: true, ALTERAR: true, CONTROLE: true });
  /**
   * Exceção do animal EXTERNO (03a, seção 4.3.2): sem evento de criação, estes atributos de projeção são do
   * cadastro de referência, alterados por `animal.editar` com AUDITORIA, e o projetor os preserva. Só valem com a
   * marca `externo: true` na mudança, que `alteracao` põe depois de conferir que o animal é EXTERNO.
   */
  var ATRIBUTOS_EXTERNO = Object.freeze({ ANIMAIS: Object.freeze(['sexo', 'data_nascimento', 'data_nascimento_confianca']) });
  var TETO_MENSAGEM = 2000;

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function interno_(mensagem) {
    return Validation.erro('INTERNAL', mensagem);
  }

  /**
   * Monta as linhas de AUDITORIA de uma operação a partir das mudanças do plano.
   * op: {op_id, usuario, timestamp}. mudanca: {entidade, entity_id, acao, campo, valor_anterior, valor_novo,
   * justificativa}, com os valores na forma da LÓGICA; aqui viram texto no formato de célula do tipo da coluna.
   * Regras: ALTERAR só em coluna [cad]; CONTROLE só em coluna [ctl]; CRIAR em qualquer coluna; a chave nunca é
   * alterada; RECUPERACAO e MANUTENCAO não têm campo (valor_novo é a descrição do que foi feito).
   */
  function linhas(ctx, op, mudancas) {
    if (!op || vazio_(op.op_id) || vazio_(op.usuario) || vazio_(op.timestamp)) throw interno_('AuditService.linhas precisa de op_id, usuario e timestamp.');
    return (mudancas || []).map(function (m) {
      var acao = m.acao;
      if (Schema.enumValores('ACAO_AUDITORIA').indexOf(acao) < 0) throw interno_('Ação de auditoria desconhecida: ' + acao + '.');
      var linha = {
        audit_id: ctx.idGen.uuid(), op_id: op.op_id, entidade: m.entidade, entity_id: vazio_(m.entity_id) ? null : String(m.entity_id),
        acao: acao, campo: null, valor_anterior: null, valor_novo: null,
        usuario: op.usuario, timestamp: op.timestamp, justificativa: vazio_(m.justificativa) ? null : String(m.justificativa),
      };
      if (!ACOES_DE_CAMPO[acao]) {
        if (m.entidade !== 'SISTEMA' && !Schema.temTabela(m.entidade)) throw interno_('Entidade de auditoria desconhecida: ' + m.entidade + '.');
        if (m.entidade !== 'SISTEMA' && vazio_(m.entity_id)) throw interno_('Auditoria de ' + m.entidade + ' sem o registro alterado.');
        linha.valor_novo = vazio_(m.valor_novo) ? null : String(m.valor_novo);
        return linha;
      }
      if (!Schema.temTabela(m.entidade)) throw interno_('Entidade de auditoria desconhecida: ' + m.entidade + '.');
      if (vazio_(m.entity_id)) throw interno_('Auditoria de ' + m.entidade + ' sem o registro alterado.');
      if (!Schema.temColuna(m.entidade, m.campo)) throw interno_('A coluna ' + m.campo + ' não existe em ' + m.entidade + '.');
      var col = Schema.coluna(m.entidade, m.campo);
      if (acao !== 'CRIAR' && col.pk) throw interno_('A chave de ' + m.entidade + ' não pode ser alterada.');
      var deExterno = m.externo === true && (ATRIBUTOS_EXTERNO[m.entidade] || []).indexOf(m.campo) >= 0;
      if (acao === 'ALTERAR' && col.marca !== 'CAD' && !deExterno) throw interno_('A coluna ' + m.entidade + '.' + m.campo + ' não é de cadastro: não pode ser editada por comando direto.');
      if (acao === 'CONTROLE' && col.marca !== 'CTL') throw interno_('A coluna ' + m.entidade + '.' + m.campo + ' não é de controle.');
      linha.campo = m.campo;
      var anterior = ctx.io.paraTexto(m.entidade, m.campo, m.valor_anterior);
      var novo = ctx.io.paraTexto(m.entidade, m.campo, m.valor_novo);
      linha.valor_anterior = anterior === '' ? null : anterior;
      linha.valor_novo = novo === '' ? null : novo;
      return linha;
    });
  }

  /**
   * Edição de registro existente: compara `campos` com a linha atual e põe no plano (tx.plano.auditar) uma
   * mudança por campo que REALMENTE muda. A ação sai da marca da coluna ([cad] → ALTERAR, [ctl] → CONTROLE).
   * Devolve quantas mudanças entraram no plano. Registro inexistente → NOT_FOUND.
   * opcoes: {externo: true} — atributos do cadastro de referência de um animal EXTERNO (ATRIBUTOS_EXTERNO);
   * o registro precisa estar EXTERNO, senão INTERNAL.
   */
  function alteracao(tx, tabela, id, campos, justificativa, opcoes) {
    var atual = tx.repo.porId(tabela, id);
    if (!atual) throw Validation.erro('NOT_FOUND', 'O registro que você tentou alterar não existe mais. Atualize a tela e tente de novo.');
    var externo = !!(opcoes && opcoes.externo);
    if (externo && (tabela !== 'ANIMAIS' || atual.situacao_cadastral !== 'EXTERNO')) throw interno_('Só o cadastro de referência de um animal EXTERNO aceita a alteração direta de atributos.');
    var n = 0;
    Object.keys(campos || {}).forEach(function (campo) {
      var col = Schema.coluna(tabela, campo);
      var novo = tx.ctx.io.normalizarValor(tabela, campo, campos[campo]);
      var igual = col.tipo === 'JSON' ? JSON.stringify(atual[campo]) === JSON.stringify(novo) : atual[campo] === novo;
      if (igual) return;
      var mudanca = {
        entidade: tabela, entity_id: id, acao: col.marca === 'CTL' ? 'CONTROLE' : 'ALTERAR', campo: campo,
        valor_anterior: atual[campo], valor_novo: novo, justificativa: justificativa,
      };
      if (externo) mudanca.externo = true;
      tx.plano.auditar(mudanca);
      n += 1;
    });
    return n;
  }

  /**
   * Criação de registro de cadastro (ação CRIAR): uma mudança por campo preenchido. A chave nasce aqui, no plano,
   * e fica em AUDITORIA.entity_id; a linha do cadastro só é anexada na fase C. Devolve quantas mudanças entraram.
   */
  function criacao(tx, tabela, id, campos, justificativa) {
    var pk = Schema.pk(tabela);
    if (vazio_(id)) throw interno_('AuditService.criacao precisa da chave do novo registro de ' + tabela + '.');
    var nomes = Object.keys(campos || {}).filter(function (c) { return c !== pk && !vazio_(campos[c]); });
    if (!nomes.length) nomes = [pk];
    nomes.forEach(function (campo) {
      tx.plano.auditar({
        entidade: tabela, entity_id: id, acao: 'CRIAR', campo: campo,
        valor_anterior: null, valor_novo: campo === pk ? id : campos[campo], justificativa: justificativa,
      });
    });
    return nomes.length;
  }

  /**
   * Refaz (fase C e recuperação) as linhas de AUDITORIA de UMA operação confirmada: devolve o que aplicar.
   *   {atualizar: [{tabela, id, campos}], criar: {TABELA: [registro]}, semAlvo: [{entidade, entity_id, motivo}]}
   * Registro existente: os campos são regravados. Registro inexistente com linha CRIAR: é anexado (com a chave de
   * entity_id). `updated_at` (e `created_at`, na criação) recebem `op.started_at`: aplicar duas vezes dá o mesmo
   * resultado. `repo` é o repositório interno, com as tabelas-alvo carregadas.
   */
  function refazer(repo, io, op, linhasDaOperacao) {
    var grupos = {};
    var ordem = [];
    var semAlvo = [];
    (linhasDaOperacao || []).forEach(function (l) {
      if (!ACOES_DE_CAMPO[l.acao]) return;
      if (!Schema.temTabela(l.entidade) || vazio_(l.entity_id) || !Schema.temColuna(l.entidade, l.campo)) {
        semAlvo.push({ entidade: l.entidade, entity_id: l.entity_id, motivo: 'Linha de auditoria ' + l.audit_id + ' aponta para tabela, registro ou coluna que não existe.' });
        return;
      }
      var k = l.entidade + '\u0000' + l.entity_id;
      if (!grupos[k]) ordem.push(grupos[k] = { entidade: l.entidade, entity_id: l.entity_id, cria: false, campos: {} });
      if (l.acao === 'CRIAR') grupos[k].cria = true;
      if (l.campo !== Schema.pk(l.entidade)) grupos[k].campos[l.campo] = io.deTexto(l.entidade, l.campo, l.valor_novo);
    });
    var atualizar = [];
    var criar = {};
    ordem.forEach(function (g) {
      if (Schema.temColuna(g.entidade, 'updated_at')) g.campos.updated_at = op.started_at;
      if (repo.cruPorId(g.entidade, g.entity_id)) {
        atualizar.push({ tabela: g.entidade, id: g.entity_id, campos: g.campos });
        return;
      }
      if (!g.cria) {
        semAlvo.push({ entidade: g.entidade, entity_id: g.entity_id, motivo: 'O registro alterado não existe.' });
        return;
      }
      var registro = {};
      registro[Schema.pk(g.entidade)] = g.entity_id;
      Object.keys(g.campos).forEach(function (c) { registro[c] = g.campos[c]; });
      if (Schema.temColuna(g.entidade, 'created_at') && vazio_(registro.created_at)) registro.created_at = op.started_at;
      (criar[g.entidade] = criar[g.entidade] || []).push(registro);
    });
    return { atualizar: atualizar, criar: criar, semAlvo: semAlvo };
  }

  /**
   * Trilha de auditoria: só linhas de operações CONFIRMADAS (as inertes de uma fase A interrompida não aparecem),
   * da mais recente para a mais antiga. filtros: {entidade, entity_id, op_id, acao, de, ate} (instantes ISO,
   * limites inclusivos). A consulta declara `AuditService.LEITURAS` nas suas leituras.
   */
  function listar(tx, filtros) {
    var f = filtros || {};
    var lista = tx.repo.vigentes('AUDITORIA').filter(function (l) {
      if (!vazio_(f.entidade) && l.entidade !== f.entidade) return false;
      if (!vazio_(f.entity_id) && l.entity_id !== String(f.entity_id)) return false;
      if (!vazio_(f.op_id) && l.op_id !== f.op_id) return false;
      if (!vazio_(f.acao) && l.acao !== f.acao) return false;
      if (!vazio_(f.de) && l.timestamp < f.de) return false;
      if (!vazio_(f.ate) && l.timestamp > f.ate) return false;
      return true;
    });
    return Utils.ordenarPor(lista, [{ campo: 'timestamp', desc: true }]).map(function (l) { return Utils.clonar(l); });
  }

  /**
   * Linha de ERROS_LOG (fora do journal). e: {contexto, codigo, mensagem, erro, op_id}; `erro` (exceção) dá a
   * pilha resumida e, na falta de `mensagem`, o texto.
   */
  function linhaErro(ctx, e) {
    var o = e || {};
    var mensagem = vazio_(o.mensagem) ? (o.erro && o.erro.message ? String(o.erro.message) : 'Erro sem mensagem.') : String(o.mensagem);
    var pilha = o.erro && o.erro.stack ? String(o.erro.stack).split('\n').slice(0, 6).join('\n').slice(0, TETO_MENSAGEM) : null;
    return {
      error_id: ctx.idGen.uuid(), timestamp: ctx.clock.agora(), contexto: vazio_(o.contexto) ? 'sistema' : String(o.contexto),
      codigo: vazio_(o.codigo) ? 'INTERNAL' : String(o.codigo), mensagem: mensagem.slice(0, TETO_MENSAGEM),
      stack_resumida: pilha, op_id: vazio_(o.op_id) ? null : o.op_id, usuario: vazio_(ctx.usuario) ? null : ctx.usuario,
    };
  }


  // ------------------------------------------------------------------ listagem (auditoria.listar) ----
  /** Abas da trilha completa (`trilha`): a consulta lê com acesso cru (eventos anulados também contam a história). */
  var LEITURAS_TRILHA = Object.freeze(['AUDITORIA', 'EVENTOS', 'EVENTO_ANIMAIS', 'AJUSTES']);
  var ORIGENS = Object.freeze(['EVENTO', 'AJUSTE', 'AUDITORIA']);
  var ACOES_EVENTO = Object.freeze({ REGISTRAR: 'REGISTRAR', CORRIGIR: 'CORRIGIR', ESTORNAR: 'ESTORNAR', AJUSTAR: 'AJUSTAR' });
  function ehData_(v) {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Utils.dataValida(v);
  }
  /** Limite de período: data (yyyy-MM-dd, comparada pela data do instante no fuso da fazenda) ou instante ISO. */
  function limite_(v, campo) {
    if (vazio_(v)) return null;
    if (ehData_(v)) return { data: v };
    if (typeof v === 'string' && Utils.instanteValido(v)) return { instante: v };
    throw Validation.erro('VALIDATION', 'Período inválido: use uma data (aaaa-mm-dd).', [Validation.detalhe({ codigo: 'FORMATO_INVALIDO', campo: campo, mensagem: 'Período inválido: use uma data (aaaa-mm-dd).' })]);
  }
  function noPeriodo_(ts, de, ate, fuso) {
    if (!de && !ate) return true;
    var dia = (de && de.data) || (ate && ate.data) ? Utils.hoje(ts, fuso) : null;
    if (de && (de.data ? dia < de.data : ts < de.instante)) return false;
    if (ate && (ate.data ? dia > ate.data : ts > ate.instante)) return false;
    return true;
  }
  function rotuloEvento_(ev) {
    var def = EventCatalog.existe(ev.event_type) ? EventCatalog.tipo(ev.event_type) : null;
    var sub = def && def.subtipos && !vazio_(ev.event_subtype) ? def.subtipos[ev.event_subtype] : null;
    return (def ? def.rotulo : ev.event_type) + (sub ? ' · ' + sub.rotulo : '') + ' de ' + Timeline.dataBr(ev.event_date);
  }
  /**
   * Trilha completa (03a, seção 5.2; 05, seção 2.16): a união de EVENTOS (o evento registra quem, quando, o quê e com
   * quais animais; estorno e correção são eventos), AJUSTES (valor anterior e novo de cada correção de animal) e
   * AUDITORIA (o que não é evento), só de operações confirmadas, da mais recente para a mais antiga. Cada item tem a
   * forma da linha de AUDITORIA mais `origem` (EVENTO | AJUSTE | AUDITORIA), `id` e, nos de evento, `event_id`,
   * `event_type`, `event_subtype`, `event_date`, `registration_date`, `reversal_of_event_id`, `status`, `vigente` e
   * `descricao`. Ações dos itens de evento: REGISTRAR, CORRIGIR (substituto), ESTORNAR; dos ajustes: AJUSTAR.
   * filtros: {entidade, entity_id (registro), op_id (operação), acao, origem, de, ate (período: data ou instante)}.
   * `entity_id` de um animal traz também os eventos dele e os estornos e correções desses eventos; `entity_id` de um
   * evento traz o evento, quem o estornou ou corrigiu e os ajustes dele. Precisa de `tx.cru` (LEITURAS_TRILHA).
   */
  function trilha(tx, filtros) {
    var f = filtros || {};
    if (!tx.cru) throw interno_('A trilha de auditoria precisa de acesso cru (eventos anulados também contam a história).');
    if (!vazio_(f.origem) && ORIGENS.indexOf(f.origem) < 0) throw Validation.erro('VALIDATION', 'Origem desconhecida: ' + f.origem + '.', [Validation.detalhe({ codigo: 'VALOR_FORA_DA_LISTA', campo: 'origem', mensagem: 'Use EVENTO, AJUSTE ou AUDITORIA.' })]);
    var de = limite_(f.de, 'de');
    var ate = limite_(f.ate, 'ate');
    var fuso = tx.ctx && tx.ctx.fuso ? tx.ctx.fuso : 'UTC';
    var cru = tx.cru;
    var itens = [];
    var registro = vazio_(f.entity_id) ? null : String(f.entity_id);
    var confirmado = function (id) { var a = cru.avaliar(id); return a && a.status !== 'FALHOU' && a.status !== 'PENDENTE' ? a : null; };
    // Eventos do registro pedido: o próprio evento, os do animal, e quem anulou qualquer um deles.
    var doRegistro = null;
    if (registro) {
      doRegistro = {};
      doRegistro[registro] = true;
      cru.cruPor('EVENTO_ANIMAIS', 'animal_id', registro).forEach(function (l) { doRegistro[l.event_id] = true; });
      Object.keys(doRegistro).forEach(function (id) { cru.cruPor('EVENTOS', 'reversal_of_event_id', id).forEach(function (x) { doRegistro[x.event_id] = true; }); });
    }
    var querEventos = vazio_(f.entidade) || f.entidade === 'EVENTOS' || (f.entidade === 'ANIMAIS' && registro);
    if (querEventos && (vazio_(f.origem) || f.origem === 'EVENTO')) {
      cru.cru('EVENTOS').forEach(function (ev) {
        var a = confirmado(ev.event_id);
        if (!a || (doRegistro && !doRegistro[ev.event_id])) return;
        var alvo = vazio_(ev.reversal_of_event_id) ? null : cru.cruPorId('EVENTOS', ev.reversal_of_event_id);
        var acao = ev.event_type === 'ESTORNO' ? ACOES_EVENTO.ESTORNAR : alvo ? ACOES_EVENTO.CORRIGIR : ACOES_EVENTO.REGISTRAR;
        var n = Utils.unicos(cru.cruPor('EVENTO_ANIMAIS', 'event_id', ev.event_id).map(function (l) { return l.animal_id; })).length;
        var descricao = ev.event_type === 'ESTORNO' ? 'Estorno de: ' + (alvo ? rotuloEvento_(alvo) : 'evento') : (alvo ? 'Correção de: ' : '') + rotuloEvento_(ev) + (n ? ' (' + n + (n === 1 ? ' animal)' : ' animais)') : '');
        itens.push({
          origem: 'EVENTO', id: ev.event_id, audit_id: null, op_id: ev.op_id, entidade: 'EVENTOS', entity_id: ev.event_id, acao: acao, campo: null,
          valor_anterior: null, valor_novo: null, usuario: ev.created_by, timestamp: ev.created_at, justificativa: ev.payload_json && !vazio_(ev.payload_json.justificativa) ? ev.payload_json.justificativa : null,
          event_id: ev.event_id, event_type: ev.event_type, event_subtype: vazio_(ev.event_subtype) ? null : ev.event_subtype, event_date: ev.event_date,
          registration_date: ev.registration_date, reversal_of_event_id: vazio_(ev.reversal_of_event_id) ? null : ev.reversal_of_event_id,
          status: a.status, vigente: a.vigente, descricao: descricao,
        });
      });
    }
    if ((vazio_(f.entidade) || f.entidade === 'ANIMAIS') && (vazio_(f.origem) || f.origem === 'AJUSTE')) {
      cru.cru('AJUSTES').forEach(function (x) {
        var a = confirmado(x.event_id);
        if (!a || (!vazio_(f.entidade) && x.entidade !== f.entidade)) return;
        if (registro && x.entity_id !== registro && x.event_id !== registro) return;
        var ev = cru.cruPorId('EVENTOS', x.event_id);
        itens.push({
          origem: 'AJUSTE', id: x.ajuste_id, audit_id: null, op_id: ev.op_id, entidade: x.entidade, entity_id: x.entity_id, acao: ACOES_EVENTO.AJUSTAR,
          campo: x.campo, valor_anterior: vazio_(x.valor_anterior) ? null : x.valor_anterior, valor_novo: vazio_(x.valor_novo) ? null : x.valor_novo,
          usuario: ev.created_by, timestamp: ev.created_at, justificativa: vazio_(x.justificativa) ? null : x.justificativa,
          event_id: x.event_id, event_type: ev.event_type, event_subtype: x.tipo_ajuste, event_date: ev.event_date, registration_date: ev.registration_date,
          reversal_of_event_id: null, status: a.status, vigente: a.vigente, descricao: rotuloEvento_(ev),
        });
      });
    }
    if ((vazio_(f.origem) || f.origem === 'AUDITORIA') && f.entidade !== 'EVENTOS') {
      listar(tx, { entidade: f.entidade, entity_id: registro }).forEach(function (l) {
        var o = Utils.clonar(l);
        o.origem = 'AUDITORIA';
        o.id = l.audit_id;
        o.event_id = null;
        itens.push(o);
      });
    }
    var lista = itens.filter(function (x) {
      if (!vazio_(f.op_id) && x.op_id !== f.op_id) return false;
      if (!vazio_(f.acao) && x.acao !== f.acao) return false;
      return noPeriodo_(x.timestamp, de, ate, fuso);
    });
    lista.forEach(function (x) { x.ordem_origem_ = ORIGENS.indexOf(x.origem); });
    lista = Utils.ordenarPor(lista, [{ campo: 'timestamp', desc: true }, 'ordem_origem_', 'id']);
    lista.forEach(function (x) { delete x.ordem_origem_; });
    return lista;
  }
  /**
   * Consulta pronta para UnitOfWork.read (rota auditoria.listar): a trilha completa (`trilha`) com os filtros dela +
   * {pagina, por_pagina} (padrão 1 e 50, teto 500). Devolve {total, pagina, por_pagina, itens}.
   */
  function consultaListar(filtros) {
    var f = filtros || {};
    var pagina = Math.max(1, Math.floor(Number(f.pagina) || 1));
    var porPagina = Math.min(500, Math.max(1, Math.floor(Number(f.por_pagina) || 50)));
    return {
      rota: 'auditoria.listar', reads: LEITURAS_TRILHA, dados: f, acessoCru: true,
      tratador: function (tx) {
        var todos = trilha(tx, f);
        return { total: todos.length, pagina: pagina, por_pagina: porPagina, itens: todos.slice((pagina - 1) * porPagina, pagina * porPagina) };
      },
    };
  }
  function listarAuditoria(ctx, filtros) {
    return UnitOfWork.read(ctx, consultaListar(filtros));
  }

  // ------------------------------------------------------------------ verificação de integridade ----
  var LIMITE_ACHADOS = 300;
  var CHECAGENS = Object.freeze([
    { codigo: 'PK', rotulo: 'Chaves primárias únicas e preenchidas', severidade: 'ERRO', correcao: 'Restaurar backup ou corrigir a linha.' },
    { codigo: 'BRINCO', rotulo: 'Brinco único entre os preenchidos', severidade: 'ERRO', correcao: 'Evento de identificação ou ajuste.' },
    { codigo: 'FK', rotulo: 'Referências apontam para registro existente e não anulado', severidade: 'ERRO', correcao: 'Ajuste; investigar edição manual.' },
    { codigo: 'ENTRADA_ABERTA', rotulo: 'Cada animal ativo tem exatamente uma entrada em aberto', severidade: 'ERRO', correcao: 'Estorno ou ajuste.' },
    { codigo: 'LINHA_DO_TEMPO', rotulo: 'Linha do tempo de todos os animais (com a ordem das identificações e das marcações)', severidade: 'ERRO', correcao: 'Estornar o evento conflitante.' },
    { codigo: 'PROJECAO', rotulo: 'Situação gravada × reconstrução pelos eventos', severidade: 'ERRO', correcao: 'Reconstruir projeções.', reparo: 'RECONSTRUIR' },
    { codigo: 'STATUS_EVENTOS', rotulo: 'Situação dos eventos × regra de vigência', severidade: 'ERRO', correcao: 'Reconstruir.', reparo: 'RECONSTRUIR' },
    { codigo: 'INVENTARIO', rotulo: 'Inventário pelos eventos = animais ativos (total e por pasto)', severidade: 'ERRO', correcao: 'Reconstruir projeções; investigar edição manual.' },
    { codigo: 'ALOCACOES', rotulo: 'Alocações: soma ≤ lançamento, = total do rateio, 100% onde é obrigatório', severidade: 'ERRO', correcao: 'Novo rateio.' },
    { codigo: 'PARCELAS', rotulo: 'Soma das parcelas = valor do lançamento', severidade: 'ERRO', correcao: 'Evento substituto.' },
    { codigo: 'ALOCACAO_DIRETA', rotulo: 'Animal do lançamento ⇔ uma única alocação direta', severidade: 'ERRO', correcao: 'Reconstruir.', reparo: 'RECONSTRUIR' },
    { codigo: 'BASE_RATEIO', rotulo: 'Rateio com base igual à recalculada hoje', severidade: 'ALERTA', correcao: 'Re-ratear, por decisão do dono.' },
    { codigo: 'COPIAS', rotulo: 'Cópias × fonte (data do detalhe = data do evento)', severidade: 'ERRO', correcao: 'Investigar edição manual.' },
    { codigo: 'CELULAS', rotulo: 'Células fora do formato do tipo', severidade: 'ERRO', correcao: 'Corrigir a célula; rever a forma de gravação.' },
    { codigo: 'OPERACOES_ORFAS', rotulo: 'Operações interrompidas', severidade: 'ERRO', correcao: 'Recuperação.' },
    { codigo: 'FILHAS_SEM_PAI', rotulo: 'Linhas sem o registro de que dependem', severidade: 'ALERTA', correcao: 'Limpeza auditada; investigar edição manual.' },
    { codigo: 'CABECALHOS', rotulo: 'Cabeçalhos das abas × SCHEMA_META', severidade: 'ERRO', correcao: 'Executar a configuração (setup).' },
    { codigo: 'FUSO_LOCALE', rotulo: 'Fuso e localidade da planilha', severidade: 'ERRO', correcao: 'Executar a configuração (setup).' },
    { codigo: 'CONTADORES', rotulo: 'Numeração de eventos e animais sem repetição', severidade: 'ERRO', correcao: 'Investigar edição manual.' },
    { codigo: 'PENDENCIAS', rotulo: 'Animal ativo sem pasto, sem brinco ou sem categoria', severidade: 'ALERTA', correcao: 'Pendência visível na ficha.' },
  ]);
  var PAIS_FILHA = Object.freeze({ AUDITORIA: ['op_id', 'OPERACOES'], IMPORTACAO_LINHAS: ['import_id', 'IMPORTACOES'], ALOCACOES_FINANCEIRAS: ['rateio_id', 'RATEIOS'], PARCELAS: ['financial_id', 'FINANCEIRO'] });
  var COPIAS_DATA = Object.freeze({ PESAGENS: 'data_pesagem', REPRODUCAO: 'data', IDENTIFICACOES: 'data_inicio' });
  var CEM_POR_CENTO = Object.freeze({ COMPRA: true, VENDA: true, ENTRADA_INICIAL: true });

  function nulo_(v) {
    return vazio_(v) ? null : v;
  }
  function br_(d) {
    return Utils.dataValida(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : String(d);
  }
  function rotuloAnimal_(a, id) {
    if (!a) return 'animal ' + id;
    return (a.codigo_interno || 'animal') + (vazio_(a.brinco) ? '' : ' (brinco ' + a.brinco + ')');
  }
  /** Coletor de achados com contagem por checagem e teto de achados detalhados. */
  function coletorAchados_() {
    var por = {};
    var lista = [];
    var truncado = false;
    CHECAGENS.forEach(function (c) { por[c.codigo] = { n: 0, aplicada: false, severidades: {} }; });
    return {
      aplicar: function (codigo) { por[codigo].aplicada = true; },
      achado: function (codigo, a, severidade) {
        var def = CHECAGENS.filter(function (c) { return c.codigo === codigo; })[0];
        var sev = severidade || def.severidade;
        por[codigo].aplicada = true;
        por[codigo].n += 1;
        por[codigo].severidades[sev] = true;
        if (lista.length >= LIMITE_ACHADOS) { truncado = true; return; }
        lista.push({
          checagem: codigo, severidade: sev, tabela: nulo_(a.tabela), id: vazio_(a.id) ? null : String(a.id), linha: typeof a.linha === 'number' ? a.linha : null,
          campo: nulo_(a.campo), mensagem: a.mensagem, reparo: def.reparo || null,
        });
      },
      relatorio: function () { return { por: por, lista: lista, truncado: truncado }; },
    };
  }
  function duplicados_(lista, chaveFn) {
    var vistos = {};
    var dup = {};
    lista.forEach(function (r) {
      var k = chaveFn(r);
      if (vazio_(k)) return;
      if (vistos[k]) (dup[k] = dup[k] || [vistos[k]]).push(r);
      else vistos[k] = r;
    });
    return dup;
  }
  function linhaDe_(cru, tabela, id) {
    try {
      return cru.linhaDe(tabela, id);
    } catch (e) {
      return null;
    }
  }

  /**
   * Confere as invariantes sobre o que a unidade leu (tx com acesso cru). estrutura: {cabecalhos: {ABA: [...]|null},
   * meta: {fuso, locale}, ausentes: [abas]}. Devolve o relatório (ver verificarIntegridade).
   */
  function conferirTudo_(tx, estrutura) {
    var col = coletorAchados_();
    var repo = tx.repo;
    var cru = tx.cru;
    var carregada = function (t) { return repo.carregada(t); };
    var params = carregada('CONFIGURACOES') ? Timeline.parametros(repo) : {};
    var abas = Schema.nomesTabelas().filter(carregada);

    // Estrutura: abas, cabeçalhos × SCHEMA_META e × Schema; fuso e locale.
    col.aplicar('CABECALHOS');
    var meta = carregada('SCHEMA_META') ? Utils.indexarPor(cru.cru('SCHEMA_META'), 'tabela') : {};
    Schema.nomesTabelas().forEach(function (t) {
      var cab = estrutura.cabecalhos[t];
      if (!cab) { col.achado('CABECALHOS', { tabela: t, mensagem: 'A aba ' + t + ' não existe na planilha. Execute a configuração (setup).' }); return; }
      Schema.colunas(t).forEach(function (c) { if (cab.indexOf(c) < 0) col.achado('CABECALHOS', { tabela: t, campo: c, mensagem: 'A aba ' + t + ' está sem a coluna ' + c + '. Execute a configuração (setup).' }); });
      var m = meta[t];
      if (!m) { if (carregada('SCHEMA_META')) col.achado('CABECALHOS', { tabela: t, mensagem: 'A aba ' + t + ' não tem registro em SCHEMA_META. Execute a configuração (setup).' }); return; }
      var esperadas = Array.isArray(m.colunas_json) ? m.colunas_json : [];
      esperadas.forEach(function (c) { if (cab.indexOf(c) < 0) col.achado('CABECALHOS', { tabela: t, campo: c, mensagem: 'A coluna ' + c + ' da aba ' + t + ' foi apagada ou renomeada (SCHEMA_META a registra).' }); });
      cab.forEach(function (c) { if (c !== '' && esperadas.indexOf(c) < 0) col.achado('CABECALHOS', { tabela: t, campo: c, mensagem: 'A aba ' + t + ' tem a coluna ' + c + ', que o sistema não conhece e ignora.' }, 'ALERTA'); });
    });
    col.aplicar('FUSO_LOCALE');
    if (estrutura.meta) {
      if (estrutura.meta.locale !== 'pt_BR') col.achado('FUSO_LOCALE', { mensagem: 'A planilha está com a localidade ' + estrutura.meta.locale + '; o sistema usa pt_BR. Execute a configuração (setup).' });
      if (!vazio_(params.fuso) && estrutura.meta.fuso !== params.fuso) col.achado('FUSO_LOCALE', { mensagem: 'O fuso da planilha (' + estrutura.meta.fuso + ') é diferente do fuso configurado (' + params.fuso + '). Execute a configuração (setup).' });
    }
    if (estrutura.ausentes.length) {
      var r0 = col.relatorio();
      return finalizar_(tx, r0, estrutura);
    }

    // Células e linhas sem chave (alertas da leitura).
    col.aplicar('CELULAS');
    col.aplicar('PK');
    cru.alertas().forEach(function (a) {
      if (a.codigo === 'COLUNA_AUSENTE') return; // já em CABECALHOS
      if (a.codigo === 'LINHA_SEM_PK') { col.achado('PK', { tabela: a.tabela, linha: a.linha, campo: a.coluna, mensagem: a.mensagem }); return; }
      col.achado('CELULAS', { tabela: a.tabela, linha: a.linha, campo: a.coluna, mensagem: 'Aba ' + a.tabela + ', linha ' + a.linha + ', coluna ' + a.coluna + ': ' + a.mensagem }, a.nivel === 'COERCIDA' ? 'ALERTA' : 'ERRO');
    });
    abas.forEach(function (t) {
      var pk = Schema.pk(t);
      var dup = duplicados_(cru.cru(t), function (r) { return r[pk]; });
      Object.keys(dup).forEach(function (k) {
        col.achado('PK', { tabela: t, id: k, mensagem: 'A chave ' + k + ' aparece em ' + dup[k].length + ' linhas da aba ' + t + '.' });
      });
    });

    // Contadores.
    col.aplicar('CONTADORES');
    if (carregada('EVENTOS')) {
      var dupSeq = duplicados_(cru.cru('EVENTOS'), function (e) { return e.event_seq === null || e.event_seq === undefined ? null : String(e.event_seq); });
      Object.keys(dupSeq).forEach(function (k) { col.achado('CONTADORES', { tabela: 'EVENTOS', campo: 'event_seq', mensagem: 'O número de evento ' + k + ' aparece em ' + dupSeq[k].length + ' eventos.' }); });
    }
    if (carregada('ANIMAIS')) {
      var dupCod = duplicados_(cru.cru('ANIMAIS'), function (a) { return a.codigo_interno; });
      Object.keys(dupCod).forEach(function (k) { col.achado('CONTADORES', { tabela: 'ANIMAIS', campo: 'codigo_interno', mensagem: 'O código ' + k + ' aparece em ' + dupCod[k].length + ' animais.' }); });
    }

    // Operações órfãs e linhas sem o pai.
    col.aplicar('OPERACOES_ORFAS');
    if (carregada('OPERACOES')) {
      cru.operacoesOrfas().forEach(function (op) {
        col.achado('OPERACOES_ORFAS', { tabela: 'OPERACOES', id: op.op_id, mensagem: 'A operação ' + op.comando + ' de ' + op.started_at + ' ficou interrompida (' + op.status + ').' });
      });
    }
    col.aplicar('FILHAS_SEM_PAI');
    abas.forEach(function (t) {
      var ligacao = Repository.regra(t) === 'FILHA' ? ['event_id', 'EVENTOS'] : PAIS_FILHA[t];
      if (!ligacao || !carregada(ligacao[1])) return;
      cru.cru(t).forEach(function (r) {
        var v = r[ligacao[0]];
        if (vazio_(v) || cru.cruPorId(ligacao[1], v)) return;
        col.achado('FILHAS_SEM_PAI', { tabela: t, id: r[Schema.pk(t)], linha: linhaDe_(cru, t, r[Schema.pk(t)]), campo: ligacao[0], mensagem: 'Linha da aba ' + t + ' aponta para ' + ligacao[1] + ' ' + v + ', que não existe (registro apagado da planilha ou gravação interrompida).' });
      });
    });

    // Chaves estrangeiras das linhas vigentes.
    col.aplicar('FK');
    abas.forEach(function (t) {
      var fks = Schema.tabela(t).colunas.filter(function (c) { return c.fk && carregada(c.fk.tabela); });
      var anexo = t === 'ANEXOS';
      if (!fks.length && !anexo) return;
      repo.vigentes(t).forEach(function (r) {
        var id = r[Schema.pk(t)];
        fks.forEach(function (c) {
          var v = r[c.nome];
          if (vazio_(v)) return;
          var alvo = cru.cruPorId(c.fk.tabela, v);
          var sev = t === 'ERROS_LOG' ? 'ALERTA' : null;
          if (!alvo) { col.achado('FK', { tabela: t, id: id, campo: c.nome, mensagem: t + '.' + c.nome + ' do registro ' + id + ' aponta para ' + c.fk.tabela + ' ' + v + ', que não existe.' }, sev); return; }
          if (c.fk.tabela === 'ANIMAIS' && alvo.situacao_cadastral === 'ANULADO') col.achado('FK', { tabela: t, id: id, campo: c.nome, mensagem: t + '.' + c.nome + ' do registro ' + id + ' aponta para o animal ' + rotuloAnimal_(alvo, v) + ', que está anulado.' }, sev);
        });
        if (anexo && Schema.temTabela(r.entidade) && carregada(r.entidade) && !cru.cruPorId(r.entidade, r.entity_id)) {
          col.achado('FK', { tabela: t, id: id, campo: 'entity_id', mensagem: 'O anexo ' + r.nome_arquivo + ' pertence a ' + r.entidade + ' ' + r.entity_id + ', que não existe.' });
        }
      });
    });

    // Brinco único (projeção de animais que valem).
    col.aplicar('BRINCO');
    if (carregada('ANIMAIS')) {
      var semZeros = params.brinco_ignora_zeros_esquerda !== false;
      var validos = cru.cru('ANIMAIS').filter(function (a) { return !vazio_(a.brinco) && a.situacao_cadastral !== 'ANULADO' && a.situacao_cadastral !== 'PENDENTE'; });
      var dupB = duplicados_(validos, function (a) { return Utils.normalizarBrinco(a.brinco, !semZeros); });
      Object.keys(dupB).forEach(function (k) {
        col.achado('BRINCO', { tabela: 'ANIMAIS', campo: 'brinco', mensagem: 'O brinco ' + dupB[k][0].brinco + ' está em ' + dupB[k].length + ' animais: ' + dupB[k].map(function (a) { return a.codigo_interno; }).join(', ') + '.' });
      });
    }

    // Linha do tempo, entrada aberta, inventário e pendências (precisam do motor).
    var temMotor = Timeline.LEITURAS.every(carregada);
    if (temMotor) conferirAnimais_(tx, col, params);
    if (temMotor) conferirProjecoes_(tx, col);
    conferirEventos_(tx, col);
    conferirFinanceiro_(tx, col);
    conferirCopias_(tx, col);
    return finalizar_(tx, col.relatorio(), estrutura);
  }
  function conferirAnimais_(tx, col, params) {
    var cru = tx.cru;
    var f = Timeline.fonte(tx, { parametros: params });
    var nomePasto = function (id) { var p = f.pasto(id); return p ? p.nome : id; };
    var categorias = tx.repo.carregada('CATEGORIAS') ? tx.repo.vigentes('CATEGORIAS').filter(function (c) { return c.ativo !== false; }) : [];
    var hoje = tx.hoje;
    var D0 = params.data_marco_zero;
    ['ENTRADA_ABERTA', 'LINHA_DO_TEMPO', 'PENDENCIAS'].forEach(col.aplicar);
    var maes = {};
    cru.cru('ANIMAIS').forEach(function (a) { if (!vazio_(a.mae_id)) maes[a.mae_id] = true; });
    cru.cru('ANIMAIS').forEach(function (a) {
      var id = a.animal_id;
      var linhas = f.linhas(id);
      if (linhas.length) {
        var calc = Timeline.projetarAnimal(f, id).campos;
        Timeline.validar(linhas, { nascimento: calc.data_nascimento, dataEntrada: calc.data_entrada }).problemas.forEach(function (p) {
          col.achado('LINHA_DO_TEMPO', { tabela: 'ANIMAIS', id: id, mensagem: rotuloAnimal_(a, id) + ': ' + Timeline.descrever(p, nomePasto) + ' (evento de ' + br_(p.event_date) + ').' });
        });
        // A ordem das identificações (primeira, troca, retirada) e das marcações (marcar, desmarcar) do animal.
        Timeline.validarIdentificacoes(Timeline.identificacoes(f, id)).concat(Timeline.validarMarcacoes(linhas)).forEach(function (p) {
          col.achado('LINHA_DO_TEMPO', { tabela: 'ANIMAIS', id: id, mensagem: rotuloAnimal_(a, id) + ': ' + Timeline.descrever(p) + ' (evento de ' + br_(p.event_date) + ').' });
        });
      }
      if (a.situacao_cadastral === 'ATIVO') {
        var soma = linhas.filter(function (l) { return !l.pre_marco_zero; }).reduce(function (s, l) { return s + (l.efeito || 0); }, 0);
        if (soma !== 1) col.achado('ENTRADA_ABERTA', { tabela: 'ANIMAIS', id: id, mensagem: rotuloAnimal_(a, id) + ' está ativo, mas os eventos somam ' + soma + ' entrada(s) em aberto.' });
        if (vazio_(a.pasto_atual_id)) col.achado('PENDENCIAS', { tabela: 'ANIMAIS', id: id, campo: 'pasto_atual_id', mensagem: rotuloAnimal_(a, id) + ' está sem pasto.' });
        if (vazio_(a.brinco)) col.achado('PENDENCIAS', { tabela: 'ANIMAIS', id: id, campo: 'brinco', mensagem: rotuloAnimal_(a, id) + ' está sem brinco.' });
        var perfil = {
          sexo: a.sexo, data_nascimento: a.data_nascimento, castrado: a.castrado === true, reprodutor: a.reprodutor === true,
          parida: (a.partos_previos || 0) > 0 || !!maes[id], categoria_modo: a.categoria_modo, categoria_manual_id: a.categoria_manual_id,
        };
        if (!EventService.classificarCategoria(perfil, hoje, categorias)) col.achado('PENDENCIAS', { tabela: 'ANIMAIS', id: id, campo: 'categoria', mensagem: rotuloAnimal_(a, id) + ' não se encaixa em nenhuma categoria' + (vazio_(a.data_nascimento) ? ' (sem data de nascimento)' : '') + '.' });
      }
    });
    col.aplicar('INVENTARIO');
    if (vazio_(D0) || !Utils.dataValida(hoje) || hoje < D0) return;
    var inv = Timeline.inventario(f.todasAsLinhas(), hoje, D0);
    var ativos = cru.cru('ANIMAIS').filter(function (a) { return a.situacao_cadastral === 'ATIVO'; });
    if (inv.total !== ativos.length) col.achado('INVENTARIO', { tabela: 'ANIMAIS', mensagem: 'Os eventos somam ' + inv.total + ' animais no rebanho em ' + br_(hoje) + ', mas há ' + ativos.length + ' animais com situação ativa.' });
    var porPasto = {};
    ativos.forEach(function (a) { var k = vazio_(a.pasto_atual_id) ? '' : a.pasto_atual_id; porPasto[k] = (porPasto[k] || 0) + 1; });
    var pastos = Utils.unicos(Object.keys(porPasto).concat(Object.keys(inv.porPasto || {}))).filter(function (k) { return k !== ''; });
    pastos.forEach(function (k) {
      var pelosEventos = (inv.porPasto || {})[k] || 0;
      var gravados = porPasto[k] || 0;
      if (pelosEventos !== gravados) col.achado('INVENTARIO', { tabela: 'PASTOS', id: k, mensagem: 'Pasto ' + nomePasto(k) + ': os eventos dão ' + pelosEventos + ' cabeças e a situação dos animais dá ' + gravados + '.' });
    });
  }
  function conferirProjecoes_(tx, col) {
    col.aplicar('PROJECAO');
    col.aplicar('ALOCACAO_DIRETA');
    var grupos = {};
    var ordem = [];
    Timeline.conferir(tx).forEach(function (d) {
      var k = d.tabela + '\u0000' + d.id;
      if (!grupos[k]) ordem.push(grupos[k] = { tabela: d.tabela, id: d.id, difs: [] });
      grupos[k].difs.push(d);
    });
    ordem.forEach(function (g) {
      var reg = tx.cru.cruPorId(g.tabela, g.id);
      var quem = g.tabela === 'ANIMAIS' ? rotuloAnimal_(reg, g.id) : g.tabela + ' ' + g.id;
      var direta = g.difs.filter(function (d) { return g.tabela === 'FINANCEIRO' && d.campo === 'animal_id'; });
      var resto = g.difs.filter(function (d) { return direta.indexOf(d) < 0; });
      var texto = function (lista) { return lista.map(function (d) { return d.campo + ' gravado ' + JSON.stringify(d.gravado) + ', calculado ' + JSON.stringify(d.calculado); }).join('; '); };
      if (direta.length) col.achado('ALOCACAO_DIRETA', { tabela: g.tabela, id: g.id, campo: 'animal_id', mensagem: quem + ': ' + texto(direta) + '.' });
      if (resto.length) col.achado('PROJECAO', { tabela: g.tabela, id: g.id, campo: resto.map(function (d) { return d.campo; }).join(','), linha: linhaDe_(tx.cru, g.tabela, g.id), mensagem: quem + ': ' + texto(resto) + '.' });
    });
  }
  function conferirEventos_(tx, col) {
    col.aplicar('STATUS_EVENTOS');
    if (!tx.repo.carregada('EVENTOS')) return;
    tx.cru.cru('EVENTOS').forEach(function (e) {
      var a = tx.cru.avaliar(e.event_id);
      if (e.status !== a.status || nulo_(e.reversed_by_event_id) !== nulo_(a.anulador_id)) {
        col.achado('STATUS_EVENTOS', { tabela: 'EVENTOS', id: e.event_id, campo: 'status', linha: linhaDe_(tx.cru, 'EVENTOS', e.event_id), mensagem: 'Evento ' + e.event_type + ' de ' + br_(e.event_date) + ': situação gravada ' + e.status + ', pela regra de vigência ' + a.status + (nulo_(a.anulador_id) !== nulo_(e.reversed_by_event_id) ? ' (anulador divergente)' : '') + '.' });
      }
    });
  }
  function conferirFinanceiro_(tx, col) {
    var repo = tx.repo;
    ['ALOCACOES', 'PARCELAS', 'BASE_RATEIO'].forEach(col.aplicar);
    if (!['FINANCEIRO', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'PARCELAS', 'EVENTOS', 'EVENTO_ANIMAIS'].every(function (t) { return repo.carregada(t); })) return;
    var porLancamento = {};
    repo.vigentes('RATEIOS').forEach(function (r) {
      var allocs = repo.por('ALOCACOES_FINANCEIRAS', 'rateio_id', r.rateio_id);
      var soma = allocs.reduce(function (s, a) { return s + (a.valor_alocado || 0); }, 0);
      if (soma !== r.total_alocado) col.achado('ALOCACOES', { tabela: 'RATEIOS', id: r.rateio_id, mensagem: 'O rateio soma ' + Utils.formatarReais(soma) + ' nas alocações, mas registra ' + Utils.formatarReais(r.total_alocado || 0) + '.' });
      porLancamento[r.financial_id] = soma;
      if ((r.criterio === 'VALOR_INDIVIDUAL' || r.criterio === 'DIRETO') && r.escopo_tipo === 'EVENTO' && !vazio_(r.escopo_ref)) {
        var bases = {};
        // VALOR_INDIVIDUAL: a base é o valor do animal no evento; DIRETO: o valor do próprio lançamento (03b, seção 12.3).
        var lanc = r.criterio === 'DIRETO' ? repo.porId('FINANCEIRO', r.financial_id) : null;
        repo.por('EVENTO_ANIMAIS', 'event_id', r.escopo_ref).forEach(function (l) {
          if (lanc) bases[l.animal_id] = lanc.valor / 100;
          else if (typeof l.valor_individual === 'number') bases[l.animal_id] = l.valor_individual / 100;
        });
        allocs.forEach(function (a) {
          if (bases[a.animal_id] !== undefined && Math.abs(bases[a.animal_id] - (a.base_valor || 0)) > 1e-9) {
            col.achado('BASE_RATEIO', { tabela: 'ALOCACOES_FINANCEIRAS', id: a.alloc_id, mensagem: 'A base do rateio do animal ' + a.animal_id + ' (' + a.base_valor + ') difere da recalculada hoje (' + bases[a.animal_id] + ').' });
          }
        });
      }
    });
    repo.vigentes('FINANCEIRO').forEach(function (fin) {
      var ev = repo.porId('EVENTOS', fin.event_id);
      var soma = porLancamento[fin.financial_id];
      if (soma !== undefined) {
        if (soma > fin.valor) col.achado('ALOCACOES', { tabela: 'FINANCEIRO', id: fin.financial_id, mensagem: 'O lançamento "' + (fin.descricao || fin.financial_id) + '" tem ' + Utils.formatarReais(soma) + ' alocados, acima do valor (' + Utils.formatarReais(fin.valor) + ').' });
        else if (ev && CEM_POR_CENTO[ev.event_type] && soma !== fin.valor) col.achado('ALOCACOES', { tabela: 'FINANCEIRO', id: fin.financial_id, mensagem: 'O lançamento "' + (fin.descricao || fin.financial_id) + '" precisa estar 100% alocado aos animais: alocados ' + Utils.formatarReais(soma) + ' de ' + Utils.formatarReais(fin.valor) + '.' });
      } else if (ev && CEM_POR_CENTO[ev.event_type]) {
        col.achado('ALOCACOES', { tabela: 'FINANCEIRO', id: fin.financial_id, mensagem: 'O lançamento "' + (fin.descricao || fin.financial_id) + '" não tem rateio para os animais.' });
      }
      var parcelas = repo.por('PARCELAS', 'financial_id', fin.financial_id);
      if (!parcelas.length) return;
      var total = parcelas.reduce(function (s, p) { return s + (p.valor || 0); }, 0);
      if (total !== fin.valor) col.achado('PARCELAS', { tabela: 'FINANCEIRO', id: fin.financial_id, mensagem: 'As parcelas somam ' + Utils.formatarReais(total) + ' e o lançamento vale ' + Utils.formatarReais(fin.valor) + '.' });
    });
  }
  function conferirCopias_(tx, col) {
    col.aplicar('COPIAS');
    if (!tx.repo.carregada('EVENTOS')) return;
    Object.keys(COPIAS_DATA).forEach(function (t) {
      if (!tx.repo.carregada(t)) return;
      var campo = COPIAS_DATA[t];
      tx.repo.vigentes(t).forEach(function (r) {
        if (vazio_(r.event_id)) return;
        var ev = tx.repo.porId('EVENTOS', r.event_id);
        if (ev && r[campo] !== ev.event_date) {
          col.achado('COPIAS', { tabela: t, id: r[Schema.pk(t)], campo: campo, mensagem: t + ': a data ' + br_(r[campo]) + ' difere da data do evento (' + br_(ev.event_date) + ').' });
        }
      });
    });
  }
  function finalizar_(tx, r, estrutura) {
    var erros = 0;
    var alertas = 0;
    var reparavel = false;
    var checagens = CHECAGENS.map(function (c) {
      var x = r.por[c.codigo];
      var temErro = !!x.severidades.ERRO;
      var situacao = !x.aplicada ? 'NAO_EXECUTADA' : !x.n ? 'OK' : temErro ? 'ERRO' : 'ALERTA';
      if (situacao === 'ERRO' && c.reparo) reparavel = true;
      return { codigo: c.codigo, rotulo: c.rotulo, severidade: c.severidade, situacao: situacao, achados: x.n, correcao: c.correcao, reparo: c.reparo || null };
    });
    Object.keys(r.por).forEach(function (k) {
      var x = r.por[k];
      if (!x.n) return;
      if (x.severidades.ERRO) erros += x.n; else alertas += x.n;
    });
    return {
      gerado_em: tx.agora, banco: tx.ctx.banco, data_version: tx.dataVersion, ok: erros === 0, erros: erros, alertas: alertas,
      reparavel: reparavel, abas_ausentes: estrutura.ausentes.slice(), checagens: checagens, achados: r.lista, truncado: r.truncado,
    };
  }
  /**
   * Verificação de integridade (sistema.integridade; fim do setup; gatilho semanal). Entra pela UnitOfWork (lock e
   * recuperação antes), com acesso cru a todas as abas que existem. Devolve {dados: relatório, dataVersion}:
   * {gerado_em, banco, data_version, ok, erros, alertas, reparavel, abas_ausentes, checagens: [{codigo, rotulo,
   * severidade, situacao (OK|ERRO|ALERTA|NAO_EXECUTADA), achados, correcao, reparo}], achados: [{checagem,
   * severidade, tabela, id, linha, campo, mensagem, reparo}] (até 300), truncado}. Erros: LOCKED, CONFIG.
   */
  var CHAVE_RESUMO = 'INTEGRIDADE:';
  function verificarIntegridade(ctx) {
    var todas = Schema.nomesTabelas();
    var cabecalhos = ctx.io.lerCabecalhos(todas);
    var ausentes = todas.filter(function (t) { return !cabecalhos[t]; });
    var meta = ctx.io.meta();
    var estrutura = { cabecalhos: cabecalhos, meta: { fuso: meta.fuso, locale: meta.locale }, ausentes: ausentes };
    var leitura = todas.filter(function (t) {
      return Repository.dependencias([t]).every(function (d) { return ausentes.indexOf(d) < 0; });
    });
    if (ausentes.indexOf('OPERACOES') >= 0) {
      // Sem o journal não há unidade possível: só a estrutura é conferida.
      var tx0 = { repo: { carregada: function () { return false; } }, cru: null, agora: ctx.clock.agora(), dataVersion: UnitOfWork.versao(ctx), ctx: ctx };
      return guardarResumo_(ctx, { dados: conferirTudo_(tx0, estrutura), dataVersion: tx0.dataVersion });
    }
    return guardarResumo_(ctx, UnitOfWork.exclusivo(ctx, {
      rota: 'sistema.integridade', reads: leitura, acessoCru: true,
      tratador: function (tx) { return conferirTudo_(tx, estrutura); },
    }));
  }
  /**
   * Resumo da ÚLTIMA verificação do banco em `INTEGRIDADE:<banco>` (Script Properties, fora da planilha), que alimenta o
   * alerta INTEGRIDADE_COM_ERRO (RN-107): qualquer verificação completa o atualiza — a semanal, a sob demanda, a do fim
   * do setup, a da restauração e a que confirma um reparo —, para o alerta não ficar uma semana desatualizado.
   */
  function guardarResumo_(ctx, r) {
    var rel = r.dados;
    ctx.props.gravar(CHAVE_RESUMO + ctx.banco, JSON.stringify({ gerado_em: rel.gerado_em, ok: rel.ok, erros: rel.erros, alertas: rel.alertas }));
    return r;
  }
  /**
   * Reparo oferecido pela verificação (RECONSTRUIR): recuperação total (situação dos eventos e todas as projeções
   * refeitas pelas linhas vigentes), registrada em AUDITORIA (MANUTENCAO), e nova verificação.
   * Devolve {recuperacao, integridade}. Erros: LOCKED.
   */
  function repararIntegridade(ctx, justificativa) {
    var antes = verificarIntegridade(ctx).dados;
    var rec = UnitOfWork.recoverAll(ctx);
    UnitOfWork.run(ctx, {
      rota: 'sistema.reparar', idempotencyKey: 'reparo:' + ctx.idGen.uuid(), dados: {}, reads: [], permiteDuranteImportacao: true,
      tratador: function (tx) {
        tx.plano.auditar({
          entidade: 'SISTEMA', acao: 'MANUTENCAO', justificativa: vazio_(justificativa) ? null : String(justificativa),
          valor_novo: 'Reconstrução das projeções e da situação dos eventos pela verificação de integridade (' + antes.erros + ' erro(s) antes).',
        });
        return { resumo: { reparo: 'RECONSTRUIR', erros_antes: antes.erros } };
      },
    });
    return { recuperacao: rec, integridade: verificarIntegridade(ctx).dados };
  }

  return {
    LEITURAS: LEITURAS,
    linhas: linhas,
    alteracao: alteracao,
    criacao: criacao,
    refazer: refazer,
    listar: listar,
    linhaErro: linhaErro,
    consultaListar: consultaListar,
    listarAuditoria: listarAuditoria,
    trilha: trilha,
    LEITURAS_TRILHA: LEITURAS_TRILHA,
    CHECAGENS: CHECAGENS,
    verificarIntegridade: verificarIntegridade,
    repararIntegridade: repararIntegridade,
  };
})();
