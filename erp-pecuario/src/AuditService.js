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
 * (reconstruir projeções e o cache de status dos eventos) é um comando à parte, auditado. Fase 2 (E2.11): saída com
 * evento posterior, partos × reprodução × crias, brinco ativo repetido nas identificações, custo de aquisição e as
 * invariantes do financeiro de 03b, seção 14, pela conferência do próprio FinancialService (uma regra, um lugar).
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
  /** O porquê de um evento na trilha: o da correção ou do estorno; na baixa por divergência, o motivo do ajuste. */
  function motivoEvento_(pj) {
    if (!pj) return null;
    if (!vazio_(pj.justificativa)) return pj.justificativa;
    return vazio_(pj.motivo_ajuste) ? null : pj.motivo_ajuste;
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
          valor_anterior: null, valor_novo: null, usuario: ev.created_by, timestamp: ev.created_at, justificativa: motivoEvento_(ev.payload_json),
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
    { codigo: 'IDENTIFICACOES_ATIVAS', rotulo: 'Nenhum brinco ativo repetido nas identificações, nem em dois animais ao mesmo tempo', severidade: 'ERRO', correcao: 'Evento de identificação ou ajuste; investigar edição manual.' },
    { codigo: 'FK', rotulo: 'Referências apontam para registro existente e não anulado', severidade: 'ERRO', correcao: 'Ajuste; investigar edição manual.' },
    { codigo: 'ENTRADA_ABERTA', rotulo: 'Cada animal ativo tem exatamente uma entrada em aberto', severidade: 'ERRO', correcao: 'Estorno ou ajuste.' },
    { codigo: 'LINHA_DO_TEMPO', rotulo: 'Linha do tempo de todos os animais (com a ordem das identificações e das marcações)', severidade: 'ERRO', correcao: 'Estornar o evento conflitante.' },
    { codigo: 'BAIXADO_SEM_POSTERIOR', rotulo: 'Animal que saiu do rebanho sem evento valendo depois da saída', severidade: 'ERRO', correcao: 'Estornar o evento posterior ou a saída.' },
    { codigo: 'PARTOS', rotulo: 'Partos coerentes com a reprodução e com as crias', severidade: 'ERRO', correcao: 'Corrigir o nascimento por evento substituto; investigar edição manual.' },
    { codigo: 'GENEALOGIA', rotulo: 'Genealogia coerente: mãe fêmea, pai macho (também o pai do parto), nascidos antes do filho, sem ciclo', severidade: 'ERRO', correcao: 'Corrigir a mãe, o pai, o sexo ou o nascimento por correção de cadastro; investigar edição manual.' },
    { codigo: 'PROJECAO', rotulo: 'Situação gravada × reconstrução pelos eventos', severidade: 'ERRO', correcao: 'Reconstruir projeções.', reparo: 'RECONSTRUIR' },
    { codigo: 'STATUS_EVENTOS', rotulo: 'Situação dos eventos × regra de vigência', severidade: 'ERRO', correcao: 'Reconstruir.', reparo: 'RECONSTRUIR' },
    { codigo: 'INVENTARIO', rotulo: 'Inventário pelos eventos = animais ativos (total e por pasto)', severidade: 'ERRO', correcao: 'Reconstruir projeções; investigar edição manual.' },
    { codigo: 'ALOCACOES', rotulo: 'Alocações: soma ≤ lançamento, = total do rateio, 100% onde é obrigatório', severidade: 'ERRO', correcao: 'Novo rateio.' },
    { codigo: 'PARCELAS', rotulo: 'Soma das parcelas = valor do lançamento', severidade: 'ERRO', correcao: 'Evento substituto.' },
    { codigo: 'FINANCEIRO', rotulo: 'Invariantes do financeiro: valor, conta, parcelas pagas, caixa, rateio permitido, compra e venda × lançamentos, lançamento cancelado', severidade: 'ERRO', correcao: 'Corrigir pelo sistema (evento substituto ou estorno); investigar edição manual.' },
    { codigo: 'ALOCACAO_DIRETA', rotulo: 'Animal do lançamento ⇔ uma única alocação direta', severidade: 'ERRO', correcao: 'Reconstruir.', reparo: 'RECONSTRUIR' },
    { codigo: 'CUSTO_AQUISICAO', rotulo: 'Custo de aquisição de cada animal = soma das alocações de aquisição da permanência atual', severidade: 'ERRO', correcao: 'Reconstruir projeções; se a alocação foi mexida, corrigir pelo sistema.', reparo: 'RECONSTRUIR' },
    { codigo: 'BASE_RATEIO', rotulo: 'Rateio com base igual à recalculada hoje', severidade: 'ALERTA', correcao: 'Re-ratear, por decisão do dono.' },
    { codigo: 'COPIAS', rotulo: 'Cópias × fonte (data do detalhe = data do evento; subtipo = tipo do detalhe; o detalhe e as linhas dos animais que o tipo grava existem, com o papel, o efeito e a marca de anterior ao marco zero certos)', severidade: 'ERRO', correcao: 'Investigar edição manual.' },
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
  /**
   * Checagem de cada invariante de 03b, seção 14 (FinancialService.conferir). A 6 (situação de pagamento pelas parcelas)
   * é a própria projeção de FINANCEIRO, já conferida em PROJECAO; a 12 e a 18 também são projeções e ficam nas
   * checagens delas (uma vez por registro, junto com a diferença da reconstrução).
   */
  var CHECAGEM_DA_INVARIANTE = Object.freeze({
    1: 'FINANCEIRO', 2: 'FINANCEIRO', 3: 'PARCELAS', 4: 'FINANCEIRO', 5: 'FINANCEIRO', 6: null, 7: 'ALOCACOES', 8: 'ALOCACOES', 9: 'ALOCACOES',
    10: 'ALOCACOES', 11: 'ALOCACOES', 12: 'ALOCACAO_DIRETA', 13: 'ALOCACOES', 14: 'FINANCEIRO', 15: 'FINANCEIRO', 16: 'FINANCEIRO', 17: 'FINANCEIRO',
    18: 'CUSTO_AQUISICAO', 19: 'FINANCEIRO', 20: 'FINANCEIRO',
  });
  /** Campos da reconstrução que têm checagem própria (o resto da diferença fica em PROJECAO). */
  var CHECAGEM_DO_CAMPO = Object.freeze({ 'FINANCEIRO.animal_id': 'ALOCACAO_DIRETA', 'ANIMAIS.custo_aquisicao': 'CUSTO_AQUISICAO', 'ANIMAIS.custo_aquisicao_origem': 'CUSTO_AQUISICAO' });
  /** Como resolver, na trava, o touro e a fêmea de um registro reprodutivo que deixariam de valer na data dele. */
  var RESOLVER_TOURO = 'O pai (touro) de um parto ou de um registro reprodutivo é macho e nasceu antes dele: confira o sexo e o nascimento do touro, ou corrija antes o registro.';
  var RESOLVER_FEMEA = 'O registro reprodutivo é de uma fêmea nascida antes dele: confira o sexo e o nascimento, ou corrija antes o lançamento que gravou o registro.';
  /** Detalhes com data que citam o animal sem linha em EVENTO_ANIMAIS (edição à mão): a data de cada um. */
  var DETALHES_DO_ANIMAL = Object.freeze({ IDENTIFICACOES: 'data_inicio', PESAGENS: 'data_pesagem', REPRODUCAO: 'data' });

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
  /**
   * Coletor de achados com contagem por checagem e teto de achados detalhados. opcoes.completo (trava de integridade): sem
   * teto e com o que identifica cada achado entre o antes e o depois de um comando (chaves, event_id, animal_id, brinco).
   */
  function coletorAchados_(opcoes) {
    var completo = !!(opcoes && opcoes.completo);
    var por = {};
    var lista = [];
    var truncado = false;
    CHECAGENS.forEach(function (c) { por[c.codigo] = { n: 0, aplicada: false, severidades: {}, ids: {} }; });
    return {
      aplicar: function (codigo) { por[codigo].aplicada = true; },
      /** Já há achado da checagem para o registro? (uma mesma divergência vista por dois caminhos conta uma vez) */
      tem: function (codigo, id) { return !vazio_(id) && por[codigo].ids[String(id)] === true; },
      achado: function (codigo, a, severidade) {
        var def = CHECAGENS.filter(function (c) { return c.codigo === codigo; })[0];
        var sev = severidade || def.severidade;
        por[codigo].aplicada = true;
        por[codigo].n += 1;
        por[codigo].severidades[sev] = true;
        if (!vazio_(a.id)) por[codigo].ids[String(a.id)] = true;
        if (!completo && lista.length >= LIMITE_ACHADOS) { truncado = true; return; }
        var item = {
          checagem: codigo, severidade: sev, tabela: nulo_(a.tabela), id: vazio_(a.id) ? null : String(a.id), linha: typeof a.linha === 'number' ? a.linha : null,
          campo: nulo_(a.campo), mensagem: a.mensagem, reparo: def.reparo || null,
        };
        if (completo) {
          item.chaves = chavesDoAchado_(codigo, a);
          item.event_id = nulo_(a.event_id);
          item.animal_id = !vazio_(a.animal_id) ? String(a.animal_id) : a.tabela === 'ANIMAIS' && !vazio_(a.id) ? String(a.id) : null;
          item.brinco = nulo_(a.brinco);
          item.resolver = nulo_(a.resolver);
          item.oque = nulo_(a.oque);
        }
        lista.push(item);
      },
      relatorio: function () { return { por: por, lista: lista, truncado: truncado }; },
    };
  }
  /**
   * O que identifica um achado entre o retrato de antes e o de depois de um comando (trava de integridade): as chaves que
   * a checagem dá — o problema e o registro, sem o texto, e um átomo por animal ou período quando um problema pode
   * piorar sem mudar de registro (mais um animal com o brinco repetido) —; sem elas, a checagem, o registro, o campo e a
   * frase sem os números (o mesmo problema com outro valor é o mesmo achado; outro registro, campo ou problema, não).
   */
  function chavesDoAchado_(codigo, a) {
    var lista = Array.isArray(a.chaves) ? a.chaves : typeof a.chaves === 'string' ? [a.chaves] : null;
    if (lista && lista.length) return lista.map(function (k) { return codigo + '|' + k; });
    return [[codigo, a.tabela || '', a.id || '', a.campo || '', String(a.mensagem || '').replace(/[0-9]+/g, '#')].join('|')];
  }
  /** Escopo normalizado: {animais, eventos, lancamentos: {id: true}, linhas: [{tabela, id}], brincos: {número: true}} ou null (tudo). */
  function noEscopo_(esc, tipo, id) {
    return !esc || (!vazio_(id) && esc[tipo][id] === true);
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
  /** O evento a que um registro do financeiro pertence (para apontar o lançamento que impede, na trava). */
  function eventoDoRegistro_(tx, tabela, id) {
    var cru = tx.cru;
    if (!cru || vazio_(id)) return null;
    if (tabela === 'EVENTOS') return id;
    var r = Schema.temTabela(tabela) && tx.repo.carregada(tabela) ? cru.cruPorId(tabela, id) : null;
    if (!r) return null;
    if (!vazio_(r.event_id)) return r.event_id;
    if (!vazio_(r.financial_id) && tx.repo.carregada('FINANCEIRO')) { var f = cru.cruPorId('FINANCEIRO', r.financial_id); return f ? nulo_(f.event_id) : null; }
    if (!vazio_(r.rateio_id) && tx.repo.carregada('RATEIOS')) { var rt = cru.cruPorId('RATEIOS', r.rateio_id); return rt ? nulo_(rt.event_id) : null; }
    return null;
  }

  /**
   * Confere as invariantes sobre o que a unidade leu (tx com acesso cru). estrutura: {cabecalhos: {ABA: [...]|null},
   * meta: {fuso, locale}, ausentes: [abas]}. Devolve o relatório (ver verificarIntegridade). As checagens de domínio são
   * as da trava de integridade dos comandos (`conferirDominio_`, aqui sobre tudo); as demais são da estrutura e do
   * sistema (cabeçalhos, células, chaves, contadores, operações, status dos eventos, inventário, pendências, base de rateio).
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

    // As checagens de domínio — a mesma função da trava de integridade dos comandos, aqui sobre tudo —, com as pendências
    // de cada animal ativo no mesmo laço (alerta: não é regra que um comando possa quebrar).
    var temMotor = Timeline.LEITURAS.every(carregada);
    if (temMotor) col.aplicar('PENDENCIAS');
    var dom = conferirDominio_(tx, col, null, { parametros: params, projetor: Timeline.porta(), porAnimal: temMotor ? pendencias_(tx, col) : null });
    if (temMotor) conferirInventario_(tx, col, dom.fonte, params);
    conferirEventos_(tx, col);
    conferirBaseRateio_(tx, col);
    return finalizar_(tx, col.relatorio(), estrutura);
  }
  /** Pendências de cada animal ativo (alerta, 06, seção 9): sem pasto, sem brinco, sem categoria hoje. */
  function pendencias_(tx, col) {
    var cru = tx.cru;
    var categorias = tx.repo.carregada('CATEGORIAS') ? tx.repo.vigentes('CATEGORIAS').filter(function (c) { return c.ativo !== false; }) : [];
    var maes = {};
    cru.cru('ANIMAIS').forEach(function (a) { if (!vazio_(a.mae_id)) maes[a.mae_id] = true; });
    return function (a, id) {
      if (a.situacao_cadastral !== 'ATIVO') return;
      if (vazio_(a.pasto_atual_id)) col.achado('PENDENCIAS', { tabela: 'ANIMAIS', id: id, campo: 'pasto_atual_id', mensagem: rotuloAnimal_(a, id) + ' está sem pasto.' });
      if (vazio_(a.brinco)) col.achado('PENDENCIAS', { tabela: 'ANIMAIS', id: id, campo: 'brinco', mensagem: rotuloAnimal_(a, id) + ' está sem brinco.' });
      var perfil = {
        sexo: a.sexo, data_nascimento: a.data_nascimento, castrado: a.castrado === true, reprodutor: a.reprodutor === true,
        parida: (a.partos_previos || 0) > 0 || !!maes[id], categoria_modo: a.categoria_modo, categoria_manual_id: a.categoria_manual_id,
      };
      if (!EventService.classificarCategoria(perfil, tx.hoje, categorias)) col.achado('PENDENCIAS', { tabela: 'ANIMAIS', id: id, campo: 'categoria', mensagem: rotuloAnimal_(a, id) + ' não se encaixa em nenhuma categoria' + (vazio_(a.data_nascimento) ? ' (sem data de nascimento)' : '') + '.' });
    };
  }
  /** Inventário pelos eventos = animais ativos, total e por pasto, hoje (06, seção 9). */
  function conferirInventario_(tx, col, f, params) {
    col.aplicar('INVENTARIO');
    var hoje = tx.hoje;
    var D0 = params.data_marco_zero;
    if (!f || vazio_(D0) || !Utils.dataValida(hoje) || hoje < D0) return;
    var nomePasto = function (id) { var p = f.pasto(id); return p ? p.nome : id; };
    var inv = Timeline.inventario(f.todasAsLinhas(), hoje, D0);
    var ativos = tx.cru.cru('ANIMAIS').filter(function (a) { return a.situacao_cadastral === 'ATIVO'; });
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

  // ------------------------------------------------------------------ checagens de domínio ----
  /**
   * Checagens de domínio (06, seção 9): as que um comando de negócio pode quebrar. Uma função só, sobre um retrato (tx
   * com acesso cru: as linhas como estão e as projeções gravadas), para a verificação de integridade (escopo null = tudo)
   * e para a trava de integridade dos comandos (o retrato de antes e o de depois, no escopo afetado: `travar`).
   * opcoes: {parametros, projetor (porta de projeções para PROJECAO; sem ela, PROJECAO não roda), cobertos ({animais,
   * eventos} ou {tudo} já projetados pelo próprio comando: a PROJECAO deles é a da fase C), porAnimal(a, id, linhas)
   * (extra da verificação, no laço dos animais)}. Devolve {fonte} (a linha do tempo, quando as abas do motor foram lidas).
   */
  function conferirDominio_(tx, col, esc, opcoes) {
    var o = opcoes || {};
    var repo = tx.repo;
    var params = o.parametros || (repo.carregada('CONFIGURACOES') ? Timeline.parametros(repo) : {});
    conferirFK_(tx, col, esc);
    conferirBrincos_(tx, col, params, esc);
    conferirIdentificacoes_(tx, col, params, esc);
    var f = null;
    if (Timeline.LEITURAS.every(function (t) { return repo.carregada(t); })) {
      f = Timeline.fonte(tx, { parametros: params });
      var memo = {};
      var proj = function (id) { if (!memo[id]) memo[id] = Timeline.projetarAnimal(f, id); return memo[id]; };
      conferirAnimais_(tx, col, f, proj, esc, o.porAnimal || null);
      conferirPartos_(tx, col, f, proj, esc);
      conferirGenealogia_(tx, col, esc);
      conferirProjecoes_(tx, col, esc, o);
    }
    conferirFinanceiro_(tx, col, esc);
    conferirCopias_(tx, col, esc);
    return { fonte: f };
  }
  /**
   * O que ficaria errado (na trava) quando uma linha aponta para um animal que a mudança anula, na linguagem do pecuarista:
   * o filho com a mãe ou o pai anulado, o registro reprodutivo com o touro anulado, ou o lançamento que cita o animal.
   */
  function quemAponta_(tx, t, r, coluna, animal) {
    if (t === 'ANIMAIS' && (coluna === 'mae_id' || coluna === 'pai_id')) {
      var mae = coluna === 'mae_id';
      return rotuloAnimal_(r, r.animal_id) + ' ficaria com ' + (mae ? 'a mãe ' : 'o pai ') + animal + ', que seria ' + (mae ? 'anulada (sem o lançamento que a criou).' : 'anulado (sem o lançamento que o criou).');
    }
    if (t === 'REPRODUCAO' && coluna === 'touro_id') return 'O registro reprodutivo de ' + br_(r.data) + ' ficaria com o touro ' + animal + ', que seria anulado (sem o lançamento que o criou).';
    var ev = !vazio_(r.event_id) && tx.repo.carregada('EVENTOS') ? tx.cru.cruPorId('EVENTOS', r.event_id) : null;
    return (ev ? '"' + rotuloEvento_(ev) + '"' : 'Um registro') + ' continuaria citando o animal ' + animal + ', que seria anulado (sem o lançamento que o criou).';
  }
  /** A linha vale (o predicado de vigência da aba, como `repo.vigentes`), sem montar a lista de vigentes da aba inteira. */
  function vigenteNaAba_(repo, t, r) {
    switch (Repository.regra(t)) {
      case 'SEMPRE': return true;
      case 'EVENTO': return repo.eventoVigente(r.event_id);
      case 'FILHA': return vazio_(r.event_id) || repo.eventoVigente(r.event_id);
      case 'ANIMAL': return !vazio_(r.situacao_cadastral) && r.situacao_cadastral !== 'PENDENTE' && r.situacao_cadastral !== 'ANULADO';
      default: return !!repo.porId(t, r[Schema.pk(t)]);
    }
  }
  /** Colunas que apontam para ANIMAIS: no escopo, as linhas que citam um animal que a mudança pode anular. */
  function colunasParaAnimais_() {
    var out = [];
    Schema.nomesTabelas().forEach(function (t) {
      Schema.tabela(t).colunas.forEach(function (c) { if (c.fk && c.fk.tabela === 'ANIMAIS') out.push({ tabela: t, coluna: c.nome }); });
    });
    return out;
  }
  /**
   * Chaves estrangeiras das linhas vigentes: alvo inexistente ou animal anulado; anexo pela entidade (ERROS_LOG só
   * alerta). No escopo: as linhas dos animais, dos eventos e dos lançamentos dele, as linhas citadas e as que apontam
   * para os animais dele.
   */
  function conferirFK_(tx, col, esc) {
    col.aplicar('FK');
    var repo = tx.repo;
    var cru = tx.cru;
    var carregada = function (t) { return repo.carregada(t); };
    var colunasFK = {};
    var fksDe = function (t) {
      if (!colunasFK[t]) colunasFK[t] = Schema.tabela(t).colunas.filter(function (c) { return c.fk && carregada(c.fk.tabela); });
      return colunasFK[t];
    };
    function conferirLinha(t, r) {
      var id = r[Schema.pk(t)];
      var anexo = t === 'ANEXOS';
      var evento = t === 'EVENTOS' ? id : nulo_(r.event_id);
      fksDe(t).forEach(function (c) {
        var v = r[c.nome];
        if (vazio_(v)) return;
        var alvo = cru.cruPorId(c.fk.tabela, v);
        var sev = t === 'ERROS_LOG' ? 'ALERTA' : null;
        if (!alvo) { col.achado('FK', { tabela: t, id: id, campo: c.nome, mensagem: t + '.' + c.nome + ' do registro ' + id + ' aponta para ' + c.fk.tabela + ' ' + v + ', que não existe.', chaves: t + '|' + id + '|' + c.nome + '|INEXISTENTE|' + v, event_id: evento }, sev); return; }
        if (c.fk.tabela === 'ANIMAIS' && alvo.situacao_cadastral === 'ANULADO') {
          col.achado('FK', {
            tabela: t, id: id, campo: c.nome, mensagem: t + '.' + c.nome + ' do registro ' + id + ' aponta para o animal ' + rotuloAnimal_(alvo, v) + ', que está anulado.',
            oque: quemAponta_(tx, t, r, c.nome, rotuloAnimal_(alvo, v)), chaves: t + '|' + id + '|' + c.nome + '|ANULADO|' + v, event_id: evento, animal_id: t === 'ANIMAIS' ? id : v,
          }, sev);
        }
      });
      if (anexo && Schema.temTabela(r.entidade) && carregada(r.entidade) && !cru.cruPorId(r.entidade, r.entity_id)) {
        col.achado('FK', { tabela: t, id: id, campo: 'entity_id', mensagem: 'O anexo ' + r.nome_arquivo + ' pertence a ' + r.entidade + ' ' + r.entity_id + ', que não existe.', chaves: t + '|' + id + '|entity_id|INEXISTENTE|' + r.entity_id, event_id: evento });
      }
    }
    if (!esc) {
      Schema.nomesTabelas().filter(carregada).forEach(function (t) {
        if (!fksDe(t).length && t !== 'ANEXOS') return;
        repo.vigentes(t).forEach(function (r) { conferirLinha(t, r); });
      });
      return;
    }
    var vistos = {};
    var visitar = function (t, r) {
      if (!r || !vigenteNaAba_(repo, t, r)) return;
      var k = t + '\u0000' + r[Schema.pk(t)];
      if (vistos[k]) return;
      vistos[k] = true;
      if (fksDe(t).length || t === 'ANEXOS') conferirLinha(t, r);
    };
    // As linhas que o comando grava (as dos eventos dele) e a do cadastro de cada animal tocado; as que apontam para um
    // animal tocado só quando ele fica anulado (linha gravada não muda: só o alvo dela pode deixar de valer).
    var comEvento = Schema.nomesTabelas().filter(function (t) { return carregada(t) && Repository.regra(t) === 'FILHA'; });
    var paraAnimais = colunasParaAnimais_().filter(function (x) { return carregada(x.tabela); });
    Object.keys(esc.animais).forEach(function (id) {
      if (!carregada('ANIMAIS')) return;
      visitar('ANIMAIS', repo.porId('ANIMAIS', id));
      var a = cru.cruPorId('ANIMAIS', id);
      if (!a || a.situacao_cadastral !== 'ANULADO') return;
      paraAnimais.forEach(function (x) { repo.por(x.tabela, x.coluna, id).forEach(function (r) { visitar(x.tabela, r); }); });
    });
    // Os eventos que passam a valer sem estar no plano (a conclusão de uma importação): todas as linhas deles.
    Object.keys(esc.eventosImportados).forEach(function (id) {
      if (carregada('EVENTOS')) visitar('EVENTOS', cru.cruPorId('EVENTOS', id));
      comEvento.forEach(function (t) { cru.cruPor(t, 'event_id', id).forEach(function (r) { visitar(t, r); }); });
      if (carregada('FINANCEIRO')) {
        cru.cruPor('FINANCEIRO', 'event_id', id).forEach(function (f) {
          ['PARCELAS', 'RATEIOS', 'ALOCACOES_FINANCEIRAS'].forEach(function (t) { if (carregada(t)) cru.cruPor(t, 'financial_id', f.financial_id).forEach(function (r) { visitar(t, r); }); });
        });
      }
    });
    esc.linhas.forEach(function (x) { if (carregada(x.tabela)) visitar(x.tabela, cru.cruPorId(x.tabela, x.id)); });
  }
  /** Brinco único (projeção dos animais que valem); no escopo, só os números que os animais dele usam ou usaram. */
  function conferirBrincos_(tx, col, params, esc) {
    col.aplicar('BRINCO');
    if (!tx.repo.carregada('ANIMAIS')) return;
    var semZeros = params.brinco_ignora_zeros_esquerda !== false;
    var validos = tx.cru.cru('ANIMAIS').filter(function (a) { return !vazio_(a.brinco) && a.situacao_cadastral !== 'ANULADO' && a.situacao_cadastral !== 'PENDENTE'; });
    var dupB = duplicados_(validos, function (a) { return Utils.normalizarBrinco(a.brinco, !semZeros); });
    Object.keys(dupB).forEach(function (k) {
      if (esc && !esc.brincos[k]) return;
      col.achado('BRINCO', {
        tabela: 'ANIMAIS', campo: 'brinco', mensagem: 'O brinco ' + dupB[k][0].brinco + ' está em ' + dupB[k].length + ' animais: ' + dupB[k].map(function (a) { return a.codigo_interno; }).join(', ') + '.',
        chaves: dupB[k].map(function (a) { return k + '|' + a.animal_id; }), brinco: dupB[k][0].brinco,
      });
    });
  }
  /**
   * Cada animal (no escopo, só os dele): entrada em aberto, linha do tempo (com a chegada declarada, a categoria escolhida
   * à mão e a ordem das identificações e das marcações) e o que vale depois de uma saída. `proj(id)` = a projeção pela
   * reconstrução (memorizada); `porAnimal` = o extra da verificação no mesmo laço.
   */
  function conferirAnimais_(tx, col, f, proj, esc, porAnimal) {
    var cru = tx.cru;
    var nomePasto = function (id) { var p = f.pasto(id); return p ? p.nome : id; };
    ['ENTRADA_ABERTA', 'LINHA_DO_TEMPO', 'BAIXADO_SEM_POSTERIOR'].forEach(col.aplicar);
    var lista = esc ? Object.keys(esc.animais).map(function (id) { return cru.cruPorId('ANIMAIS', id); }).filter(Boolean) : cru.cru('ANIMAIS');
    lista.forEach(function (a) {
      var id = a.animal_id;
      var linhas = f.linhas(id);
      if (linhas.length) {
        var pr = proj(id);
        var calc = pr.campos;
        posterioresASaida_(f, id, linhas).forEach(function (x) {
          col.achado('BAIXADO_SEM_POSTERIOR', {
            tabela: 'ANIMAIS', id: id, mensagem: rotuloAnimal_(a, id) + ': "' + rotuloEvento_(x.evento) + '" vale depois da saída do rebanho ("' + rotuloEvento_(x.saida) + '")' + (x.detalhe ? ' (registro na aba ' + x.detalhe + ')' : '') + '. Estorne um dos dois.',
            chaves: id + '|' + x.evento.event_id + '|' + x.saida.event_id, event_id: x.evento.event_id,
          });
        });
        Timeline.validar(linhas, { nascimento: calc.data_nascimento, dataEntrada: pr.meta.chegada ? pr.meta.chegada.data : null }).problemas.forEach(function (p) {
          col.achado('LINHA_DO_TEMPO', { tabela: 'ANIMAIS', id: id, mensagem: rotuloAnimal_(a, id) + ': ' + Timeline.descrever(p, nomePasto) + ' (evento de ' + br_(p.event_date) + ').', chaves: id + '|' + p.codigo + '|' + p.event_id, event_id: p.event_id });
        });
        // A categoria escolhida à mão serve ao sexo do animal (RELATORIO_FASE2, decisão 8; RN-012).
        if (tx.repo.carregada('CATEGORIAS')) {
          f.ajustes(id).forEach(function (x) {
            if (x.tipo_ajuste !== 'RECLASSIFICACAO' || vazio_(x.valor_novo)) return;
            var cat = tx.repo.porId('CATEGORIAS', x.valor_novo);
            var evr = f.evento(x.event_id);
            if (!cat || !evr || cat.sexo_aplicavel === 'AMBOS' || cat.sexo_aplicavel === calc.sexo || vazio_(calc.sexo)) return;
            col.achado('LINHA_DO_TEMPO', {
              tabela: 'AJUSTES', id: x.ajuste_id, campo: 'valor_novo', mensagem: rotuloAnimal_(a, id) + ': a reclassificação de ' + br_(evr.event_date) + ' põe o animal na categoria ' + cat.nome + ', que é só de ' + (cat.sexo_aplicavel === 'M' ? 'machos' : 'fêmeas') + ', mas ele é ' + (calc.sexo === 'M' ? 'macho' : 'fêmea') + ' pelo cadastro. Volte-o à categoria automática ou corrija o sexo.',
              chaves: 'CATEGORIA|' + x.ajuste_id, event_id: x.event_id, animal_id: id,
              resolver: 'Mude antes a reclassificação do animal (volte-o à categoria automática ou escolha uma do sexo dele).',
            });
          });
        }
        // A chegada declarada no rebanho inicial não fica antes do nascimento (RN-021); nas demais entradas a chegada é o
        // próprio lançamento, que a linha do tempo acima já confere com o nascimento.
        var chegou = pr.meta.chegada ? pr.meta.chegada.data : null;
        if (pr.meta.criacao && pr.meta.criacao.event_type === 'ENTRADA_INICIAL' && Utils.dataValida(chegou) && Utils.dataValida(calc.data_nascimento) && chegou < calc.data_nascimento) {
          col.achado('LINHA_DO_TEMPO', { tabela: 'ANIMAIS', id: id, campo: 'data_entrada', mensagem: rotuloAnimal_(a, id) + ': a chegada na fazenda (' + br_(chegou) + ') está antes do nascimento (' + br_(calc.data_nascimento) + '). Corrija uma das datas por correção de cadastro.', chaves: 'CHEGADA|' + id, event_id: pr.meta.criacao.event_id, resolver: 'A chegada na fazenda não pode ficar antes do nascimento: confira as duas datas.' });
        }
        // A ordem das identificações (primeira, troca, retirada) e das marcações (marcar, desmarcar) do animal.
        Timeline.validarIdentificacoes(Timeline.identificacoes(f, id)).concat(Timeline.validarMarcacoes(linhas)).forEach(function (p) {
          col.achado('LINHA_DO_TEMPO', { tabela: 'ANIMAIS', id: id, mensagem: rotuloAnimal_(a, id) + ': ' + Timeline.descrever(p) + ' (evento de ' + br_(p.event_date) + ').', chaves: 'SEQUENCIA|' + id + '|' + p.codigo + '|' + p.event_id, event_id: p.event_id, resolver: 'Confira a ordem das identificações e das marcações do animal: mude a data deste lançamento ou estorne antes o registro que conflita.' });
        });
      }
      if (a.situacao_cadastral === 'ATIVO') {
        var soma = linhas.filter(function (l) { return !l.pre_marco_zero; }).reduce(function (s, l) { return s + (l.efeito || 0); }, 0);
        // Um átomo por entrada a mais (ou a menos): piorar é afastar a soma de 1.
        var atomos = [];
        for (var k = 1; k <= Math.abs(soma - 1); k++) atomos.push(id + '|' + (soma > 1 ? '+' : '-') + k);
        if (soma !== 1) col.achado('ENTRADA_ABERTA', { tabela: 'ANIMAIS', id: id, mensagem: rotuloAnimal_(a, id) + ' está ativo, mas os eventos somam ' + soma + ' entrada(s) em aberto.', chaves: atomos });
      }
      if (porAnimal) porAnimal(a, id, linhas);
    });
  }
  /**
   * Eventos vigentes do animal depois de uma saída do rebanho (06, seção 9, Fase 2): na ordem canônica, toda linha que
   * não seja correção de cadastro (NEUTRO) depois de uma saída e antes da reentrada — e, depois da morte, qualquer
   * uma, reentrada inclusive. O fato no dia da saída vem antes dela na ordem do dia e vale. Também os detalhes com
   * data (identificação, pesagem, reprodução) que citam o animal num evento em que ele não tem linha (edição à mão).
   * Devolve [{evento, saida, detalhe}] (um por evento).
   */
  function posterioresASaida_(f, id, linhas) {
    var out = [];
    var vistos = {};
    var fora = null;
    var periodos = [];
    var comLinha = {};
    function anotar(eventId, saida, detalhe) {
      if (vistos[eventId]) return;
      vistos[eventId] = true;
      var ev = f.evento(eventId);
      if (ev) out.push({ evento: ev, saida: f.evento(saida.event_id) || saida, detalhe: detalhe || null });
    }
    Timeline.ordenar(linhas.filter(function (l) { return !l.pre_marco_zero; })).forEach(function (l) {
      comLinha[l.event_id] = true;
      var papel = Timeline.papelNaLinha(l);
      if (papel === 'NEUTRO') return;
      if (fora && (fora.morte || papel !== 'ENTRADA')) { anotar(l.event_id, fora.saida); return; }
      if (fora) { fora.periodo.ate = l.event_date; fora = null; return; }
      if (papel === 'SAIDA') {
        fora = { saida: l, morte: l.event_type === 'MORTE', periodo: { desde: l.event_date, ate: null, saida: l } };
        periodos.push(fora.periodo);
      }
    });
    if (!periodos.length) return out;
    linhas.forEach(function (l) { comLinha[l.event_id] = true; });
    Object.keys(DETALHES_DO_ANIMAL).forEach(function (t) {
      var campo = DETALHES_DO_ANIMAL[t];
      var lista = t === 'IDENTIFICACOES' ? f.identificacoes(id) : t === 'PESAGENS' ? f.pesagens(id) : f.reproducao(id);
      lista.forEach(function (r) {
        if (comLinha[r.event_id] || !Utils.dataValida(r[campo])) return;
        var p = periodos.filter(function (x) { return r[campo] > x.desde && (x.ate === null || r[campo] < x.ate); })[0];
        if (p) anotar(r.event_id, p.saida, t);
      });
    });
    return out;
  }
  /**
   * Partos (06, seção 9, Fase 2): cada NASCIMENTO vigente tem uma mãe (linha MATRIZ, fêmea nascida antes do parto) e
   * exatamente um registro PARTO em REPRODUCAO, na mãe, com a data do parto, os nascidos vivos = crias do evento e ao
   * menos uma cria (viva ou natimorta); cada cria nasce no dia do parto, da mãe do parto, como NASCIDO, com o pai do
   * parto. Registro PARTO de evento que não é um nascimento vigente também é achado. No escopo, os nascimentos dele (o
   * escopo da trava traz os partos em que os animais dele são mãe ou cria).
   */
  function conferirPartos_(tx, col, f, proj, esc) {
    col.aplicar('PARTOS');
    var repo = tx.repo;
    var restantes = {};
    repo.vigentes('REPRODUCAO').forEach(function (r) {
      if (r.tipo_evento !== 'PARTO' || (esc && !esc.eventos[r.event_id] && !esc.animais[r.animal_id])) return;
      (restantes[r.event_id] = restantes[r.event_id] || []).push(r);
    });
    var nome = function (id) { return rotuloAnimal_(f.animal(id), id); };
    var eventos = esc ? Object.keys(esc.eventos).map(function (id) { return repo.porId('EVENTOS', id); }).filter(Boolean) : repo.vigentes('EVENTOS');
    eventos.forEach(function (ev) {
      if (ev.event_type !== 'NASCIMENTO') return;
      var reps = restantes[ev.event_id] || [];
      delete restantes[ev.event_id];
      var linhas = repo.por('EVENTO_ANIMAIS', 'event_id', ev.event_id);
      var maes = linhas.filter(function (l) { return l.papel === 'MATRIZ'; });
      var crias = linhas.filter(function (l) { return l.papel === 'CRIA'; });
      var mae = maes.length === 1 ? maes[0].animal_id : null;
      var quem = 'O parto de ' + br_(ev.event_date) + (mae ? ' (mãe ' + nome(mae) + ')' : '');
      var achado = function (mensagem, tabela, id, chave) {
        col.achado('PARTOS', { tabela: tabela || 'EVENTOS', id: id || ev.event_id, mensagem: quem + ' ' + mensagem, chaves: ev.event_id + '|' + chave, event_id: ev.event_id, animal_id: tabela === 'ANIMAIS' ? id : null });
      };
      if (maes.length !== 1) achado('tem ' + maes.length + ' mães nos animais do evento; um parto é de uma vaca só.', null, null, 'MAES');
      if (reps.length !== 1) achado('tem ' + reps.length + ' registros de parto na reprodução; precisa ter exatamente um.', null, null, 'REGISTROS');
      var r = reps.length === 1 ? reps[0] : null;
      if (mae) {
        var pm = proj(mae).campos || {};
        if (pm.sexo !== 'F') achado('tem como mãe um animal que não é fêmea pelo cadastro.', 'ANIMAIS', mae, 'MAE_SEXO|' + mae);
        if (Utils.dataValida(pm.data_nascimento) && pm.data_nascimento >= ev.event_date) achado('tem como mãe um animal nascido em ' + br_(pm.data_nascimento) + ', não antes do parto.', 'ANIMAIS', mae, 'MAE_NASCIMENTO|' + mae);
      }
      if (r) {
        var vivos = typeof r.qtd_nascidos_vivos === 'number' ? r.qtd_nascidos_vivos : null;
        var natimortos = typeof r.qtd_natimortos === 'number' ? r.qtd_natimortos : null;
        if (mae && r.animal_id !== mae) achado('está registrado na reprodução de outro animal (' + nome(r.animal_id) + ').', 'REPRODUCAO', r.reproduction_id, 'REGISTRO_ANIMAL|' + r.reproduction_id);
        if (r.data_parto !== ev.event_date) achado('tem a data do parto registrada como ' + br_(r.data_parto) + ' na reprodução.', 'REPRODUCAO', r.reproduction_id, 'REGISTRO_DATA|' + r.reproduction_id);
        if (vivos !== crias.length) achado('registra ' + (vivos === null ? 'sem número de' : vivos) + ' nascido(s) vivo(s) na reprodução, mas ' + crias.length + ' cria(s) entraram pelo evento.', 'REPRODUCAO', r.reproduction_id, 'REGISTRO_VIVOS|' + r.reproduction_id);
        if (natimortos === null || natimortos < 0 || (vivos || 0) + natimortos < 1) achado('não registra nenhuma cria (viva ou natimorta) na reprodução.', 'REPRODUCAO', r.reproduction_id, 'REGISTRO_CRIAS|' + r.reproduction_id);
      }
      crias.forEach(function (l) {
        var at = l.atributos_iniciais_json || {};
        var problemas = [];
        var tipos = [];
        if (mae && at.mae_id !== mae) { problemas.push('outra mãe'); tipos.push('MAE'); }
        if (at.data_nascimento !== ev.event_date) { problemas.push('nascimento em ' + br_(at.data_nascimento)); tipos.push('NASCIMENTO'); }
        if (at.origem !== 'NASCIDO') { problemas.push('origem ' + (at.origem || 'vazia')); tipos.push('ORIGEM'); }
        if (r && nulo_(at.pai_id) !== nulo_(r.touro_id)) { problemas.push('outro pai'); tipos.push('PAI'); }
        if (problemas.length) {
          col.achado('PARTOS', { tabela: 'EVENTO_ANIMAIS', id: l.event_animal_id, mensagem: quem + ' tem a cria ' + nome(l.animal_id) + ' registrada com ' + problemas.join(', ') + '.', chaves: tipos.map(function (t) { return ev.event_id + '|CRIA|' + l.animal_id + '|' + t; }), event_id: ev.event_id, animal_id: l.animal_id });
          return;
        }
        // O cadastro da cria (a projeção, com as correções vigentes) também é o do parto: uma correção só na cria ou a
        // edição à mão o tiram dele.
        var pc = f.linhas(l.animal_id).length ? proj(l.animal_id).campos : null;
        if (!pc) return;
        var noCadastro = [];
        var tiposCad = [];
        if (mae && pc.mae_id !== mae) { noCadastro.push('outra mãe'); tiposCad.push('MAE'); }
        if (pc.data_nascimento !== ev.event_date) { noCadastro.push('nascimento em ' + br_(pc.data_nascimento)); tiposCad.push('NASCIMENTO'); }
        if (pc.origem !== 'NASCIDO') { noCadastro.push('origem ' + (pc.origem || 'vazia')); tiposCad.push('ORIGEM'); }
        if (r && !vazio_(r.touro_id) && nulo_(pc.pai_id) !== r.touro_id) { noCadastro.push('outro pai'); tiposCad.push('PAI'); }
        if (noCadastro.length) {
          col.achado('PARTOS', { tabela: 'ANIMAIS', id: l.animal_id, mensagem: quem + ' tem a cria ' + nome(l.animal_id) + ' com ' + noCadastro.join(', ') + ' no cadastro (o parto é a fonte desses dados).', chaves: tiposCad.map(function (t) { return ev.event_id + '|CADASTRO|' + l.animal_id + '|' + t; }), event_id: ev.event_id });
        }
      });
    });
    Object.keys(restantes).forEach(function (eid) {
      var ev = repo.porId('EVENTOS', eid);
      // No escopo, o parto de um nascimento vigente fora dele não é achado daqui: o nascimento é conferido quando está no escopo.
      if (ev && ev.event_type === 'NASCIMENTO') return;
      restantes[eid].forEach(function (r) {
        col.achado('PARTOS', { tabela: 'REPRODUCAO', id: r.reproduction_id, mensagem: 'O registro de parto de ' + nome(r.animal_id) + ' em ' + br_(r.data) + ' pertence a ' + (ev ? '"' + rotuloEvento_(ev) + '"' : 'um evento que não existe') + ', que não é um nascimento.', chaves: 'FORA_DO_NASCIMENTO|' + r.reproduction_id, event_id: ev ? eid : null, animal_id: r.animal_id });
      });
    });
  }
  /**
   * Genealogia dos cadastros (05, seção 2.2: RN-008 a RN-010; algoritmo de 05, seção 4.2): de cada animal que vale, a
   * mãe é fêmea, o pai é macho, os dois nasceram antes dele e nenhum é ancestral dele mesmo (ciclo; um achado por
   * ciclo). A referência a registro inexistente ou anulado é da checagem FK. Cada registro reprodutivo vigente tem o
   * touro macho e nascido antes dele (RN-060) e, fora o parto (que a checagem PARTOS confere pela linha da mãe), é de uma
   * fêmea nascida antes dele. No escopo: os animais dele e os registros reprodutivos em que um deles é a fêmea ou o touro.
   */
  function conferirGenealogia_(tx, col, esc) {
    col.aplicar('GENEALOGIA');
    var vale = {};
    tx.cru.cru('ANIMAIS').forEach(function (a) { if (a.situacao_cadastral !== 'ANULADO' && a.situacao_cadastral !== 'PENDENTE') vale[a.animal_id] = a; });
    var nome = function (id) { return rotuloAnimal_(vale[id], id); };
    var noCiclo = {};
    var alvo = esc ? Object.keys(esc.genealogia).filter(function (id) { return !!vale[id]; }) : Object.keys(vale);
    alvo.forEach(function (id) {
      var a = vale[id];
      [['mae_id', 'F', 'mãe', 'fêmea'], ['pai_id', 'M', 'pai', 'macho']].forEach(function (cfg) {
        var p = vazio_(a[cfg[0]]) ? null : vale[a[cfg[0]]];
        if (!p) return;
        if (p.sexo !== cfg[1]) col.achado('GENEALOGIA', { tabela: 'ANIMAIS', id: id, campo: cfg[0], mensagem: nome(id) + ' tem como ' + cfg[2] + ' ' + nome(p.animal_id) + ', que não é ' + cfg[3] + ' pelo cadastro.', chaves: id + '|' + cfg[0] + '|SEXO|' + p.animal_id });
        else if (Utils.dataValida(p.data_nascimento) && Utils.dataValida(a.data_nascimento) && p.data_nascimento >= a.data_nascimento) {
          col.achado('GENEALOGIA', { tabela: 'ANIMAIS', id: id, campo: cfg[0], mensagem: nome(id) + ', nascido em ' + br_(a.data_nascimento) + ', tem como ' + cfg[2] + ' ' + nome(p.animal_id) + ', que nasceu em ' + br_(p.data_nascimento) + ', não antes dele.', chaves: id + '|' + cfg[0] + '|NASCIMENTO|' + p.animal_id });
        }
      });
      if (noCiclo[id]) return;
      cicloDe(id);
    });
    if (tx.repo.carregada('REPRODUCAO')) {
      tx.repo.vigentes('REPRODUCAO').forEach(function (r) {
        if (esc && !esc.genealogia[r.animal_id] && !(r.touro_id && esc.genealogia[r.touro_id])) return;
        var oque = (r.tipo_evento === 'PARTO' ? 'O parto de ' : 'O registro reprodutivo de ') + br_(r.data) + ' (mãe ' + nome(r.animal_id) + ')';
        // O touro de um registro reprodutivo (o pai do parto, mesmo só de natimorto): macho e nascido antes dele (RN-060).
        var t = vazio_(r.touro_id) ? null : vale[r.touro_id];
        if (t && t.sexo !== 'M') col.achado('GENEALOGIA', { tabela: 'REPRODUCAO', id: r.reproduction_id, campo: 'touro_id', mensagem: oque + ' tem como pai ' + nome(t.animal_id) + ', que não é macho pelo cadastro.', chaves: 'TOURO|' + r.reproduction_id + '|SEXO|' + t.animal_id, event_id: r.event_id, animal_id: t.animal_id, resolver: RESOLVER_TOURO });
        else if (t && Utils.dataValida(t.data_nascimento) && Utils.dataValida(r.data) && t.data_nascimento >= r.data) {
          col.achado('GENEALOGIA', { tabela: 'REPRODUCAO', id: r.reproduction_id, campo: 'touro_id', mensagem: oque + ' tem como pai ' + nome(t.animal_id) + ', que nasceu em ' + br_(t.data_nascimento) + ', não antes dele.', chaves: 'TOURO|' + r.reproduction_id + '|NASCIMENTO|' + t.animal_id, event_id: r.event_id, animal_id: t.animal_id, resolver: RESOLVER_TOURO });
        }
        // A fêmea do registro reprodutivo que não é parto (diagnóstico de gestação, cobertura...): fêmea e nascida antes dele.
        var m = r.tipo_evento === 'PARTO' ? null : vale[r.animal_id];
        if (m && !vazio_(m.sexo) && m.sexo !== 'F') col.achado('GENEALOGIA', { tabela: 'REPRODUCAO', id: r.reproduction_id, campo: 'animal_id', mensagem: 'O registro reprodutivo de ' + br_(r.data) + ' é de ' + nome(m.animal_id) + ', que não é fêmea pelo cadastro.', chaves: 'FEMEA|' + r.reproduction_id + '|SEXO|' + m.animal_id, event_id: r.event_id, animal_id: m.animal_id, resolver: RESOLVER_FEMEA });
        else if (m && Utils.dataValida(m.data_nascimento) && Utils.dataValida(r.data) && m.data_nascimento >= r.data) {
          col.achado('GENEALOGIA', { tabela: 'REPRODUCAO', id: r.reproduction_id, campo: 'animal_id', mensagem: 'O registro reprodutivo de ' + br_(r.data) + ' é de ' + nome(m.animal_id) + ', que nasceu em ' + br_(m.data_nascimento) + ', não antes dele.', chaves: 'FEMEA|' + r.reproduction_id + '|NASCIMENTO|' + m.animal_id, event_id: r.event_id, animal_id: m.animal_id, resolver: RESOLVER_FEMEA });
        }
      });
    }
    function cicloDe(id) {
      var fila = [[id]];
      var vistos = {};
      while (fila.length) {
        var c = fila.shift();
        var x = c[c.length - 1];
        var achou = null;
        [vale[x] && vale[x].mae_id, vale[x] && vale[x].pai_id].forEach(function (pid) {
          if (achou || vazio_(pid) || !vale[pid]) return;
          if (pid === id) achou = c.concat([pid]);
          else if (!vistos[pid]) { vistos[pid] = true; fila.push(c.concat([pid])); }
        });
        if (achou) {
          achou.forEach(function (k) { noCiclo[k] = true; });
          col.achado('GENEALOGIA', { tabela: 'ANIMAIS', id: id, campo: 'mae_id', mensagem: nome(id) + ' é ancestral de si mesmo: ' + achou.map(nome).join(' → ') + ' (ciclo na genealogia).', chaves: 'CICLO|' + Utils.unicos(achou).sort().join(',') });
          break;
        }
      }
    }
  }
  /**
   * Identificações (06, seção 9, Fase 2): nenhum brinco ativo (`data_fim` vazio) repetido entre as linhas vigentes de
   * IDENTIFICACOES, com a mesma normalização da unicidade de brinco (zeros à esquerda pelo parâmetro). O brinco de
   * animal vendido ou morto continua ativo: o número dele não é dado a outro (05, seção 4.1). No escopo, só os números que
   * os animais dele usam ou usaram.
   */
  function conferirIdentificacoes_(tx, col, params, esc) {
    col.aplicar('IDENTIFICACOES_ATIVAS');
    if (!tx.repo.carregada('IDENTIFICACOES')) return;
    var semZeros = params.brinco_ignora_zeros_esquerda !== false;
    var norm = function (r) { return Utils.normalizarBrinco(String(r.codigo), !semZeros); };
    var ativas = tx.repo.vigentes('IDENTIFICACOES').filter(function (r) { return r.tipo === 'BRINCO' && vazio_(r.data_fim) && !vazio_(r.codigo) && (!esc || esc.brincos[norm(r)]); });
    var dup = duplicados_(ativas, norm);
    Object.keys(dup).forEach(function (k) {
      var quem = dup[k].map(function (r) { return rotuloAnimal_(tx.cru.cruPorId('ANIMAIS', r.animal_id), r.animal_id) + ' desde ' + br_(r.data_inicio); });
      col.achado('IDENTIFICACOES_ATIVAS', { tabela: 'IDENTIFICACOES', id: dup[k][dup[k].length - 1].ident_id, campo: 'codigo', mensagem: 'O brinco ' + dup[k][0].codigo + ' está ativo em ' + dup[k].length + ' identificações: ' + quem.join('; ') + '.', chaves: dup[k].map(function (r) { return 'ATIVO|' + k + '|' + r.ident_id; }), brinco: dup[k][0].codigo, event_id: dup[k][dup[k].length - 1].event_id });
    });
    // Um número em dois animais ao mesmo tempo (RN-002; RN-004: com o reuso ligado, só de período já encerrado): os
    // períodos [data_inicio, data_fim) do mesmo brinco em animais diferentes não se cruzam. O número corrigido por
    // IDENTIFICACAO_INCORRETA não conta (desenho-base 16.2); os dois ainda em uso já estão no achado acima.
    var errados = {};
    if (tx.repo.carregada('AJUSTES')) {
      tx.repo.vigentes('AJUSTES').forEach(function (x) {
        if (x.tipo_ajuste === 'IDENTIFICACAO_INCORRETA' && x.campo === 'brinco' && !vazio_(x.valor_anterior)) errados[x.animal_id + '|' + Utils.normalizarBrinco(String(x.valor_anterior), !semZeros)] = true;
      });
    }
    var porNumero = {};
    tx.repo.vigentes('IDENTIFICACOES').forEach(function (r) {
      if (r.tipo !== 'BRINCO' || vazio_(r.codigo) || (!vazio_(r.data_fim) && r.data_fim <= r.data_inicio)) return;
      var k = norm(r);
      if (errados[r.animal_id + '|' + k] || (esc && !esc.brincos[k])) return;
      (porNumero[k] = porNumero[k] || []).push(r);
    });
    Object.keys(porNumero).forEach(function (k) {
      var lista = porNumero[k];
      for (var i = 0; i < lista.length; i++) {
        for (var j = i + 1; j < lista.length; j++) {
          var a = lista[i];
          var b = lista[j];
          if (a.animal_id === b.animal_id || (vazio_(a.data_fim) && vazio_(b.data_fim))) continue;
          if ((vazio_(b.data_fim) || a.data_inicio < b.data_fim) && (vazio_(a.data_fim) || b.data_inicio < a.data_fim)) {
            var periodo = function (r) { return rotuloAnimal_(tx.cru.cruPorId('ANIMAIS', r.animal_id), r.animal_id) + (vazio_(r.data_fim) ? ' desde ' + br_(r.data_inicio) : ' de ' + br_(r.data_inicio) + ' até ' + br_(r.data_fim)); };
            var par = [a.ident_id, b.ident_id].sort();
            col.achado('IDENTIFICACOES_ATIVAS', { tabela: 'IDENTIFICACOES', id: b.ident_id, campo: 'codigo', mensagem: 'O brinco ' + a.codigo + ' ficou em dois animais ao mesmo tempo: ' + periodo(a) + '; ' + periodo(b) + '.', chaves: 'CRUZA|' + k + '|' + par[0] + '|' + par[1], brinco: a.codigo, event_id: b.event_id });
          }
        }
      }
    });
  }
  /**
   * Projeção gravada × reconstrução pelos eventos vigentes, pelo projetor dado (a porta de projeções), na tabela dos
   * campos: FINANCEIRO.animal_id → ALOCACAO_DIRETA, custo de aquisição → CUSTO_AQUISICAO, o resto → PROJECAO. No escopo,
   * só os animais e eventos dele que o comando NÃO projetou (`cobertos`): os vizinhos que a fase C não regrava.
   */
  function conferirProjecoes_(tx, col, esc, o) {
    ['PROJECAO', 'ALOCACAO_DIRETA', 'CUSTO_AQUISICAO'].forEach(col.aplicar);
    if (!o.projetor || !tx.cru) return;
    var alvo = { tudo: true };
    var cob = o.cobertos || {};
    if (cob.tudo) return; // o próprio comando projeta tudo (a fase C grava o que o projetor deu no retrato)
    if (esc) {
      // No escopo, só o que o comando grava e não manda projetar: a projeção de um animal só depende das linhas dele (e a
      // cria ao pé, das crias: o projetor refaz a mãe junto), então o vizinho que o comando não tocou não muda.
      var animais = Object.keys(esc.tocados).filter(function (id) { return !(cob.animais && cob.animais[id]); });
      // Do evento, o projetor refaz os lançamentos (FINANCEIRO: situação e pagamento): só os eventos com lançamento contam.
      var comLancamento = function (id) { return tx.repo.carregada('FINANCEIRO') && tx.cru.cruPor('FINANCEIRO', 'event_id', id).length > 0; };
      var eventos = Object.keys(esc.eventosGravados).filter(function (id) { return !(cob.eventos && cob.eventos[id]) && comLancamento(id); });
      if (!animais.length && !eventos.length) return;
      alvo = { animais: animais, eventos: eventos };
    }
    var plano = Repository.plano();
    o.projetor.reconstruir({ repo: tx.repo, cru: tx.cru, plano: plano, agora: null, ctx: tx.ctx }, alvo);
    var iguais = function (a, b) { return JSON.stringify(vazio_(a) ? null : a) === JSON.stringify(vazio_(b) ? null : b); };
    var grupos = {};
    var ordem = [];
    plano.atualizacoes().forEach(function (u) {
      var reg = tx.cru.cruPorId(u.tabela, u.id) || {};
      Object.keys(u.campos).forEach(function (c) {
        if (c === 'updated_at' || iguais(reg[c], u.campos[c])) return;
        var k = u.tabela + '\u0000' + u.id;
        if (!grupos[k]) ordem.push(grupos[k] = { tabela: u.tabela, id: u.id, difs: [] });
        grupos[k].difs.push({ campo: c, gravado: nulo_(reg[c]), calculado: nulo_(u.campos[c]) });
      });
    });
    var texto = function (lista) { return lista.map(function (d) { return d.campo + ' gravado ' + JSON.stringify(d.gravado) + ', calculado ' + JSON.stringify(d.calculado); }).join('; '); };
    ordem.forEach(function (g) {
      var reg = tx.cru.cruPorId(g.tabela, g.id);
      var quem = g.tabela === 'ANIMAIS' ? rotuloAnimal_(reg, g.id) : g.tabela + ' ' + g.id;
      var porChecagem = {};
      g.difs.forEach(function (d) { var c = CHECAGEM_DO_CAMPO[g.tabela + '.' + d.campo] || 'PROJECAO'; (porChecagem[c] = porChecagem[c] || []).push(d); });
      ['ALOCACAO_DIRETA', 'CUSTO_AQUISICAO', 'PROJECAO'].forEach(function (c) {
        var lista = porChecagem[c];
        if (!lista) return;
        col.achado(c, {
          tabela: g.tabela, id: g.id, campo: lista.map(function (d) { return d.campo; }).join(','), linha: linhaDe_(tx.cru, g.tabela, g.id), mensagem: quem + ': ' + texto(lista) + '.',
          chaves: lista.map(function (d) { return g.tabela + '|' + g.id + '|' + d.campo + '|' + JSON.stringify(d.calculado); }), event_id: g.tabela === 'FINANCEIRO' && reg ? nulo_(reg.event_id) : null,
        });
      });
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
  /**
   * Financeiro: as invariantes de 03b, seção 14, pela conferência do próprio FinancialService (uma regra, um lugar),
   * distribuídas pelas checagens (CHECAGEM_DA_INVARIANTE). No escopo, os lançamentos dele (e os dos eventos dele) e o
   * custo de aquisição dos animais dele.
   */
  function conferirFinanceiro_(tx, col, esc) {
    var repo = tx.repo;
    ['ALOCACOES', 'PARCELAS', 'FINANCEIRO', 'ALOCACAO_DIRETA', 'CUSTO_AQUISICAO'].forEach(col.aplicar);
    if (!['FINANCEIRO', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'PARCELAS', 'EVENTOS', 'EVENTO_ANIMAIS'].every(function (t) { return repo.carregada(t); })) return;
    FinancialService.conferir(tx, esc ? { lancamentos: esc.lancamentos, eventos: esc.eventos, animais: esc.animais } : null).forEach(function (a) {
      var codigo = CHECAGEM_DA_INVARIANTE.hasOwnProperty(a.invariante) ? CHECAGEM_DA_INVARIANTE[a.invariante] : 'FINANCEIRO';
      if (!codigo) return;
      if ((codigo === 'ALOCACAO_DIRETA' || codigo === 'CUSTO_AQUISICAO') && col.tem(codigo, a.id)) return;
      col.achado(codigo, {
        tabela: a.tabela, id: a.id, linha: linhaDe_(tx.cru, a.tabela, a.id), mensagem: a.mensagem,
        chaves: a.invariante + '|' + a.tabela + '|' + a.id + '|' + String(a.mensagem || '').replace(/[0-9]+/g, '#'),
        event_id: eventoDoRegistro_(tx, a.tabela, a.id), animal_id: a.tabela === 'ANIMAIS' ? a.id : null,
      });
    });
  }
  /**
   * Base de rateio desatualizada (alerta, não invariante; 03b, seção 12.3): todo critério de escopo EVENTO que a linha do
   * evento permite recalcular (BASE_DA_LINHA) e a base estimada da venda só com o peso do lote. Nunca recalcula em silêncio.
   */
  function conferirBaseRateio_(tx, col) {
    var repo = tx.repo;
    col.aplicar('BASE_RATEIO');
    if (!['FINANCEIRO', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'PARCELAS', 'EVENTOS', 'EVENTO_ANIMAIS'].every(function (t) { return repo.carregada(t); })) return;
    // Base de cada animal pelo critério, a partir da linha do evento (03b, seção 12.3): VALOR_INDIVIDUAL, o valor do animal
    // no evento; DIRETO, o valor do próprio lançamento; PESO_VIVO, o peso do evento; PESO_CARCACA, a carcaça do animal no
    // evento; CABECAS, 1. A base estimada (última pesagem escalada, registrada na justificativa) e a MANUAL não se
    // recalculam pela linha do evento.
    var BASE_DA_LINHA = {
      VALOR_INDIVIDUAL: function (l) { return typeof l.valor_individual === 'number' ? l.valor_individual / 100 : undefined; },
      PESO_VIVO: function (l) { return typeof l.peso === 'number' ? l.peso : undefined; },
      PESO_CARCACA: function (l) { return typeof l.peso_carcaca_kg === 'number' ? l.peso_carcaca_kg : undefined; },
      CABECAS: function () { return 1; },
    };
    var f = Timeline.LEITURAS.every(function (t) { return repo.carregada(t); }) ? Timeline.fonte(tx, {}) : null;
    var nomeDe = function (id) { return rotuloAnimal_(tx.cru ? tx.cru.cruPorId('ANIMAIS', id) : null, id); };
    repo.vigentes('RATEIOS').forEach(function (r) {
      if ((!BASE_DA_LINHA[r.criterio] && r.criterio !== 'DIRETO') || r.escopo_tipo !== 'EVENTO' || vazio_(r.escopo_ref)) return;
      var allocs = repo.por('ALOCACOES_FINANCEIRAS', 'rateio_id', r.rateio_id);
      if (r.criterio === 'PESO_CARCACA' && /^Base estimada/.test(r.justificativa || '')) return;
      if (r.criterio === 'PESO_VIVO' && /^Base estimada/.test(r.justificativa || '')) {
        // Base estimada da venda só com o peso do lote: a última pesagem de cada animal até a data da venda, escalada para
        // o peso do lote, pela mesma conta da gravação (03b, seção 12.3: base desatualizada por evento retroativo ou
        // correção da pesagem → alerta, nunca recálculo em silêncio).
        var ev = repo.porId('EVENTOS', r.escopo_ref);
        var vd = repo.carregada('VENDAS') ? repo.por('VENDAS', 'event_id', r.escopo_ref)[0] : null;
        if (!f || !ev || !allocs.length) return;
        var ults = allocs.map(function (a) { var u = Timeline.ultimaPesagem(f, a.animal_id, ev.event_date); return u ? u.peso_kg : null; });
        var falta = allocs.filter(function (a, i) { return ults[i] === null; });
        if (falta.length) {
          col.achado('BASE_RATEIO', { tabela: 'RATEIOS', id: r.rateio_id, mensagem: 'A base estimada do rateio de "' + rotuloEvento_(ev) + '" não pode mais ser refeita: ' + falta.map(function (a) { return nomeDe(a.animal_id); }).join(', ') + ' não tem pesagem até ' + br_(ev.event_date) + '. Re-rateie por decisão do dono.' });
          return;
        }
        var estimadas = FinancialService.basesEstimadas(ults, vd && typeof vd.peso_vivo_total_kg === 'number' ? vd.peso_vivo_total_kg : null);
        allocs.forEach(function (a, i) {
          if (Math.abs(estimadas[i] - (a.base_valor || 0)) > 1e-9) {
            col.achado('BASE_RATEIO', { tabela: 'ALOCACOES_FINANCEIRAS', id: a.alloc_id, mensagem: 'A base estimada do rateio de ' + nomeDe(a.animal_id) + ' (' + a.base_valor + ') difere da recalculada hoje pela última pesagem até ' + br_(ev.event_date) + ', ajustada ao peso do lote (' + estimadas[i] + '): o rateio está desatualizado.' });
          }
        });
        return;
      }
      var bases = {};
      var lanc = r.criterio === 'DIRETO' ? repo.porId('FINANCEIRO', r.financial_id) : null;
      repo.por('EVENTO_ANIMAIS', 'event_id', r.escopo_ref).forEach(function (l) {
        if (lanc) bases[l.animal_id] = lanc.valor / 100;
        else if (BASE_DA_LINHA[r.criterio]) bases[l.animal_id] = BASE_DA_LINHA[r.criterio](l);
      });
      allocs.forEach(function (a) {
        if (bases[a.animal_id] !== undefined && Math.abs(bases[a.animal_id] - (a.base_valor || 0)) > 1e-9) {
          col.achado('BASE_RATEIO', { tabela: 'ALOCACOES_FINANCEIRAS', id: a.alloc_id, mensagem: 'A base do rateio de ' + rotuloAnimal_(tx.cru ? tx.cru.cruPorId('ANIMAIS', a.animal_id) : null, a.animal_id) + ' (' + a.base_valor + ') difere da recalculada hoje pela linha do evento (' + bases[a.animal_id] + ', critério ' + r.criterio + ').' });
        }
      });
    });
  }
  /**
   * Tipo da linha de detalhe esperado para o evento (03a, seção 3, SUBTIPO_EVENTO; 03b, seção 2.4): null = o evento não
   * grava esse detalhe. AJUSTES.tipo_ajuste = o subtipo; BAIXAS.tipo = o tipo (morte, descarte) ou o subtipo
   * (divergência de contagem); REPRODUCAO.tipo_evento = PARTO no nascimento, o diagnóstico declarado nas entradas e o
   * subtipo nos eventos de reprodução.
   */
  var TIPO_DO_DETALHE = Object.freeze({
    AJUSTES: { campo: 'tipo_ajuste', esperado: function (ev) { return ev.event_type === 'AJUSTE_INVENTARIO' && ev.event_subtype !== 'DIVERGENCIA_CONTAGEM' ? ev.event_subtype : null; } },
    BAIXAS: { campo: 'tipo', esperado: function (ev) { return ev.event_type === 'MORTE' || ev.event_type === 'DESCARTE' ? ev.event_type : ev.event_type === 'AJUSTE_INVENTARIO' && ev.event_subtype === 'DIVERGENCIA_CONTAGEM' ? 'DIVERGENCIA_CONTAGEM' : null; } },
    REPRODUCAO: { campo: 'tipo_evento', esperado: function (ev) {
      if (ev.event_type === 'NASCIMENTO') return 'PARTO';
      if (ev.event_type === 'REPRODUCAO') return ev.event_subtype;
      if (ev.event_type === 'DESMAMA') return 'DESMAMA';
      if (ev.event_type === 'ENTRADA_INICIAL' || ev.event_type === 'OUTRA_ENTRADA' || ev.event_type === 'COMPRA') return 'DIAGNOSTICO_GESTACAO';
      return null;
    } },
  });
  /**
   * Detalhe que o tipo do evento grava por animal (03b, seção 2.4; 06, seção 12: linha apagada à mão é acusada): uma
   * BAIXAS por animal na morte, no descarte e na baixa por divergência; ao menos um AJUSTES por animal nas correções;
   * uma IDENTIFICACOES por animal na identificação. `quantos`: 'UM' (exatamente um) ou 'ALGUM' (pelo menos um).
   */
  var DETALHE_OBRIGATORIO = Object.freeze([
    { tabela: 'BAIXAS', quantos: 'UM', aplica: function (ev) { return ev.event_type === 'MORTE' || ev.event_type === 'DESCARTE' || (ev.event_type === 'AJUSTE_INVENTARIO' && ev.event_subtype === 'DIVERGENCIA_CONTAGEM'); } },
    { tabela: 'AJUSTES', quantos: 'ALGUM', aplica: function (ev) { return ev.event_type === 'AJUSTE_INVENTARIO' && ev.event_subtype !== 'DIVERGENCIA_CONTAGEM'; } },
    { tabela: 'IDENTIFICACOES', quantos: 'UM', aplica: function (ev) { return ev.event_type === 'IDENTIFICACAO'; } },
  ]);
  function conferirDetalhes_(tx, col, eventos) {
    var repo = tx.repo;
    if (!repo.carregada('EVENTO_ANIMAIS')) return;
    DETALHE_OBRIGATORIO.forEach(function (d) {
      if (!repo.carregada(d.tabela)) return;
      eventos.forEach(function (ev) {
        if (!d.aplica(ev)) return;
        var porAnimal = {};
        repo.por(d.tabela, 'event_id', ev.event_id).forEach(function (r) { porAnimal[r.animal_id] = (porAnimal[r.animal_id] || 0) + 1; });
        Utils.unicos(repo.por('EVENTO_ANIMAIS', 'event_id', ev.event_id).map(function (l) { return l.animal_id; })).forEach(function (id) {
          var n = porAnimal[id] || 0;
          if (n === 1 || (n > 1 && d.quantos === 'ALGUM')) return;
          var quem = rotuloAnimal_(tx.cru.cruPorId('ANIMAIS', id), id);
          var oqueDet = '"' + rotuloEvento_(ev) + '" de ' + br_(ev.event_date) + ', ' + quem + ': ' + (n ? 'tem ' + n + ' linhas de ' + d.tabela + '; precisa ter uma só.' : 'está sem a linha de ' + d.tabela + ' que o lançamento grava.');
          col.achado('COPIAS', { tabela: 'EVENTOS', id: ev.event_id, campo: d.tabela, mensagem: oqueDet + (n ? '' : ' Restaure o backup ou investigue a edição manual.'), oque: oqueDet, chaves: ev.event_id + '|' + d.tabela + '|' + id + '|' + (n ? 'VARIAS' : 'FALTA'), event_id: ev.event_id, animal_id: id });
        });
      });
    });
  }
  /**
   * Linhas de EVENTO_ANIMAIS que cada tipo grava (desenho-base 4.1; 03b, seção 2.4): {papel: efeito no inventário}, e se
   * a linha leva o pasto de destino (o movimento). O registro anterior ao marco zero grava efeito 0 em toda linha. Tipo
   * sem regra aqui (das fases seguintes) não é conferido.
   */
  function linhasDoTipo_(ev) {
    var t = ev.event_type;
    var sub = ev.event_subtype;
    if (t === 'ENTRADA_INICIAL' || t === 'OUTRA_ENTRADA' || t === 'COMPRA') return { papeis: { SUJEITO: 1 }, pasto: false };
    // No parto, a linha sem papel de mãe ou de cria é da checagem PARTOS ("tem 0 mães"): aqui só o efeito de cada papel.
    if (t === 'NASCIMENTO') return { papeis: { MATRIZ: 0, CRIA: 1 }, pasto: false, outrosPapeisEmPartos: true };
    if (t === 'VENDA' || t === 'MORTE' || t === 'DESCARTE') return { papeis: { SUJEITO: -1 }, pasto: false };
    if (t === 'TRANSFERENCIA') return { papeis: { SUJEITO: 0 }, pasto: true };
    if (t === 'IDENTIFICACAO' || t === 'MARCACAO') return { papeis: { SUJEITO: 0 }, pasto: false };
    if (t === 'AJUSTE_INVENTARIO') return sub === 'DIVERGENCIA_CONTAGEM' ? { papeis: { SUJEITO: -1 }, pasto: false } : { papeis: { SUJEITO: 0 }, pasto: sub === 'CORRECAO_LOCALIZACAO' };
    return null;
  }
  var TEXTO_EFEITO = { '1': '+1 (entrada)', '0': '0 (sem entrada nem saída)', '-1': '−1 (saída)' };
  /** Como resolver, na trava, o lançamento cuja marca de anterior ao marco zero deixaria de bater com a data (o marco zero mudou). */
  var MARCO_ZERO_GRAVADO = 'Os registros anteriores ao marco zero foram gravados com a data dele: mantenha o marco zero, ou desfaça antes o que foi lançado com a data antiga.';
  /**
   * A fonte de cada evento vigente (06, seções 9 e 12: linha apagada ou mexida à mão é acusada, e o reparo automático é só
   * da projeção): o evento tem as linhas dos animais, cada uma com o papel e o efeito que o tipo grava (o movimento com o
   * pasto de destino), `pre_marco_zero` = (data antes do marco zero) e o detalhe do evento (BAIXAS, AJUSTES,
   * IDENTIFICACOES) só de animal que tem linha nele. Sem isso a reconstrução refaria a situação a partir do dado quebrado.
   */
  function conferirLinhasDosEventos_(tx, col, eventos) {
    var repo = tx.repo;
    if (!repo.carregada('EVENTO_ANIMAIS')) return;
    var D0 = repo.carregada('CONFIGURACOES') ? Timeline.parametros(repo).data_marco_zero : null;
    var aviso = ' Restaure o backup ou investigue a edição manual; o reparo automático só refaz a situação a partir dos lançamentos.';
    eventos.forEach(function (ev) {
      var nome = '"' + rotuloEvento_(ev) + '"';
      if (Utils.dataValida(D0) && Utils.dataValida(ev.event_date) && ev.event_type !== 'ESTORNO' && (ev.pre_marco_zero === true) !== (ev.event_date < D0)) {
        var oqueMarco = nome + ' está marcado como ' + (ev.pre_marco_zero === true ? 'anterior' : 'posterior') + ' ao marco zero (' + br_(D0) + '), mas a data é ' + (ev.pre_marco_zero === true ? 'depois' : 'antes') + ' dele.';
        col.achado('COPIAS', { tabela: 'EVENTOS', id: ev.event_id, campo: 'pre_marco_zero', mensagem: oqueMarco + aviso, oque: oqueMarco, resolver: MARCO_ZERO_GRAVADO, chaves: ev.event_id + '|MARCO_ZERO', event_id: ev.event_id });
      }
      var regra = linhasDoTipo_(ev);
      if (!regra) return;
      var linhas = repo.por('EVENTO_ANIMAIS', 'event_id', ev.event_id);
      if (!linhas.length) col.achado('COPIAS', { tabela: 'EVENTOS', id: ev.event_id, campo: 'EVENTO_ANIMAIS', mensagem: nome + ' está sem as linhas dos animais (EVENTO_ANIMAIS) que o lançamento grava.' + aviso, oque: nome + ' ficaria sem as linhas dos animais que o lançamento grava.', chaves: ev.event_id + '|SEM_LINHAS', event_id: ev.event_id });
      var comLinha = {};
      linhas.forEach(function (l) {
        comLinha[l.animal_id] = true;
        var quem = rotuloAnimal_(tx.cru.cruPorId('ANIMAIS', l.animal_id), l.animal_id);
        var papel = vazio_(l.papel) ? 'SUJEITO' : l.papel;
        var esperado = regra.papeis[papel];
        var ref = { tabela: 'EVENTO_ANIMAIS', id: l.event_animal_id, linha: linhaDe_(tx.cru, 'EVENTO_ANIMAIS', l.event_animal_id) };
        if (esperado === undefined && regra.outrosPapeisEmPartos) return;
        if (esperado === undefined) {
          var oquePapel = nome + ', ' + quem + ': a linha do animal tem o papel ' + papel + ', que esse lançamento não grava.';
          col.achado('COPIAS', { tabela: ref.tabela, id: ref.id, linha: ref.linha, campo: 'papel', mensagem: oquePapel + aviso, oque: oquePapel, chaves: l.event_animal_id + '|PAPEL', event_id: ev.event_id, animal_id: l.animal_id });
          return;
        }
        // Anterior ao marco zero pela data (a marca errada já é achado à parte): efeito 0 em toda linha.
        if (Utils.dataValida(D0) && Utils.dataValida(ev.event_date) ? ev.event_date < D0 : ev.pre_marco_zero === true) esperado = 0;
        if ((l.efeito_inventario || 0) !== esperado) {
          var oqueEfeito = nome + ', ' + quem + ': a linha do animal tem efeito ' + (TEXTO_EFEITO[String(l.efeito_inventario || 0)] || String(l.efeito_inventario)) + ' no inventário, mas esse lançamento grava ' + TEXTO_EFEITO[String(esperado)] + '.';
          col.achado('COPIAS', { tabela: ref.tabela, id: ref.id, linha: ref.linha, campo: 'efeito_inventario', mensagem: oqueEfeito + aviso, oque: oqueEfeito, resolver: MARCO_ZERO_GRAVADO, chaves: l.event_animal_id + '|EFEITO|' + esperado, event_id: ev.event_id, animal_id: l.animal_id });
        }
        if (regra.pasto && vazio_(l.pasto_destino_id)) {
          var oquePasto = nome + ', ' + quem + ': a linha do animal está sem o pasto de destino do movimento.';
          col.achado('COPIAS', { tabela: ref.tabela, id: ref.id, linha: ref.linha, campo: 'pasto_destino_id', mensagem: oquePasto + aviso, oque: oquePasto, chaves: l.event_animal_id + '|PASTO', event_id: ev.event_id, animal_id: l.animal_id });
        }
      });
      ['BAIXAS', 'AJUSTES', 'IDENTIFICACOES'].forEach(function (t) {
        if (!repo.carregada(t)) return;
        repo.por(t, 'event_id', ev.event_id).forEach(function (r) {
          if (vazio_(r.animal_id) || comLinha[r.animal_id]) return;
          var oqueSem = nome + ': a linha de ' + t + ' cita ' + rotuloAnimal_(tx.cru.cruPorId('ANIMAIS', r.animal_id), r.animal_id) + ', que não tem linha no lançamento (EVENTO_ANIMAIS).';
          col.achado('COPIAS', { tabela: t, id: r[Schema.pk(t)], campo: 'animal_id', mensagem: oqueSem + aviso, oque: oqueSem, chaves: r[Schema.pk(t)] + '|SEM_LINHA', event_id: ev.event_id, animal_id: r.animal_id });
        });
      });
    });
  }
  /**
   * Cópias × fonte (06, seção 9): a fonte de cada evento, o detalhe obrigatório, o tipo da linha de detalhe = o do evento e
   * a data do detalhe = a do evento. No escopo, os eventos dele.
   */
  function conferirCopias_(tx, col, esc) {
    col.aplicar('COPIAS');
    var repo = tx.repo;
    if (!repo.carregada('EVENTOS')) return;
    var eventos = esc ? Object.keys(esc.eventos).map(function (id) { return repo.porId('EVENTOS', id); }).filter(Boolean) : repo.vigentes('EVENTOS');
    conferirLinhasDosEventos_(tx, col, eventos);
    conferirDetalhes_(tx, col, eventos);
    var linhasDe = function (t) {
      if (!esc) return repo.vigentes(t);
      var out = [];
      eventos.forEach(function (ev) { out = out.concat(repo.por(t, 'event_id', ev.event_id)); });
      return out;
    };
    Object.keys(TIPO_DO_DETALHE).forEach(function (t) {
      if (!repo.carregada(t)) return;
      var def = TIPO_DO_DETALHE[t];
      linhasDe(t).forEach(function (r) {
        if (vazio_(r.event_id)) return;
        var ev = repo.porId('EVENTOS', r.event_id);
        if (!ev) return;
        var esperado = def.esperado(ev);
        if (r[def.campo] === esperado) return;
        col.achado('COPIAS', { tabela: t, id: r[Schema.pk(t)], campo: def.campo, mensagem: t + ': o tipo ' + (r[def.campo] || 'vazio') + ' não corresponde a "' + rotuloEvento_(ev) + '"' + (esperado ? ' (esperado ' + esperado + ')' : ', que não grava essa linha') + '.', chaves: r[Schema.pk(t)] + '|TIPO', event_id: ev.event_id, animal_id: r.animal_id });
      });
    });
    Object.keys(COPIAS_DATA).forEach(function (t) {
      if (!repo.carregada(t)) return;
      var campo = COPIAS_DATA[t];
      linhasDe(t).forEach(function (r) {
        if (vazio_(r.event_id)) return;
        var ev = repo.porId('EVENTOS', r.event_id);
        if (ev && r[campo] !== ev.event_date) {
          col.achado('COPIAS', { tabela: t, id: r[Schema.pk(t)], campo: campo, mensagem: t + ': a data ' + br_(r[campo]) + ' difere da data do evento (' + br_(ev.event_date) + ').', chaves: r[Schema.pk(t)] + '|DATA', event_id: ev.event_id, animal_id: r.animal_id });
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
      duracao_ms: null,
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
    var inicio = ctx.clock.agoraMs();
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
      return guardarResumo_(ctx, cronometrar_(ctx, inicio, { dados: conferirTudo_(tx0, estrutura), dataVersion: tx0.dataVersion }));
    }
    return guardarResumo_(ctx, cronometrar_(ctx, inicio, UnitOfWork.exclusivo(ctx, {
      rota: 'sistema.integridade', reads: leitura, acessoCru: true,
      tratador: function (tx) { return conferirTudo_(tx, estrutura); },
    })));
  }
  /** Tempo da verificação inteira (leitura, recuperação e conferência), pelo relógio do contexto: a margem até o limite de execução. */
  function cronometrar_(ctx, inicio, r) {
    r.dados.duracao_ms = Math.max(0, ctx.clock.agoraMs() - inicio);
    return r;
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

  // ------------------------------------------------------------------ trava de integridade dos comandos ----
  /**
   * Trava de integridade (06, seção 9; CONTRATOS, seção 10.5): antes da fase A de todo comando que grava dado de negócio,
   * a UnitOfWork monta o retrato de DEPOIS (o estado lido + o plano como se confirmado + a auditoria refeita + as
   * projeções que a fase C grava, pelo mesmo projetor) e `travar` roda as checagens de domínio — a mesma função da
   * verificação de integridade — no escopo que o comando toca, com os vizinhos que a mudança pode afetar. Achado de ERRO
   * que não existia no retrato de ANTES, no mesmo escopo, recusa o comando; o problema antigo não bloqueia, mas não pode
   * piorar (o achado é comparado pelas chaves dele: um átomo a mais é piorar).
   */
  var CHECAGENS_DOMINIO = Object.freeze(['BRINCO', 'IDENTIFICACOES_ATIVAS', 'FK', 'ENTRADA_ABERTA', 'LINHA_DO_TEMPO', 'BAIXADO_SEM_POSTERIOR', 'PARTOS',
    'GENEALOGIA', 'PROJECAO', 'ALOCACOES', 'PARCELAS', 'FINANCEIRO', 'ALOCACAO_DIRETA', 'CUSTO_AQUISICAO', 'COPIAS']);
  /** Como resolver, na linguagem do pecuarista, cada problema que a trava recusa (vai depois do que ficaria errado). */
  var COMO_RESOLVER = Object.freeze({
    BRINCO: 'Use outro número de brinco, ou tire antes o número do outro animal (troca ou retirada de identificação).',
    IDENTIFICACOES_ATIVAS: 'Um número de brinco fica em um animal por vez: use outro número, ou tire antes o número do outro animal.',
    FK: 'O registro citado não existe ou foi anulado: estorne antes o que depende dele, ou escolha outro.',
    ENTRADA_ABERTA: 'Cada animal do rebanho tem uma entrada só em aberto: confira as entradas e as saídas dele e estorne a que estiver sobrando.',
    LINHA_DO_TEMPO: 'Confira as datas: mude a data deste lançamento ou estorne antes o registro que conflita.',
    BAIXADO_SEM_POSTERIOR: 'Animal que saiu do rebanho não recebe lançamento depois da saída: estorne antes o lançamento posterior ou a saída.',
    PARTOS: 'A mãe, a data e as crias precisam bater com o parto: corrija pelo próprio parto (evento de nascimento).',
    GENEALOGIA: 'A mãe é fêmea, o pai é macho e os dois nasceram antes do filho: confira a mãe, o pai, o sexo e o nascimento.',
    PROJECAO: 'A ficha desse animal ficaria desatualizada: é um defeito do sistema, não do lançamento. Avise quem cuida do sistema.',
    ALOCACOES: 'Confira os valores e a divisão do valor entre os animais.',
    PARCELAS: 'As parcelas precisam somar o valor do lançamento: confira as parcelas.',
    FINANCEIRO: 'Confira os valores, as parcelas e os lançamentos do evento.',
    ALOCACAO_DIRETA: 'Confira a divisão do valor entre os animais.',
    CUSTO_AQUISICAO: 'Confira o valor de compra dos animais e a divisão dele.',
    COPIAS: 'Confira o lançamento: as linhas dos animais e os detalhes precisam combinar com o tipo e a data dele.',
  });
  /** Parâmetros que mudam o que as checagens de domínio acusam em todo o banco (a trava confere tudo). */
  var PARAMETROS_DO_DOMINIO = Object.freeze(['data_marco_zero', 'brinco_ignora_zeros_esquerda', 'idade_desmama_padrao_meses']);
  /** Atributos do animal que, mudados por auditoria (cadastro de referência do animal EXTERNO), mexem no domínio. */
  var ATRIBUTOS_DO_DOMINIO = Object.freeze(['sexo', 'data_nascimento', 'data_nascimento_confianca', 'situacao_cadastral']);
  var DETALHES_COM_ANIMAL = Object.freeze(['IDENTIFICACOES', 'PESAGENS', 'REPRODUCAO', 'AJUSTES', 'BAIXAS', 'SANIDADE']);
  /** Abas que a trava lê (além das do comando) quando ele toca animal, evento, lançamento ou parâmetro: as das checagens de domínio. */
  function leiturasTrava() {
    return Utils.unicos(Timeline.LEITURAS.concat(['CATEGORIAS', 'PLANO_CONTAS', 'COMPRAS', 'VENDAS', 'BAIXAS', 'PROPRIEDADES', 'PARCEIROS', 'ANEXOS', 'IMPORTACOES', 'OPERACOES']));
  }
  /**
   * O que o comando toca, pelo plano (sem ler a planilha): linhas novas (`lote`: {ABA: [registros]}), mudanças de
   * auditoria (`mudancas`, na forma da lógica) e o escopo das projeções (`derivados`). Devolve as sementes do escopo:
   * {animais, eventos, lancamentos, importacoes, categorias, contas, parcelas: {id: true}, linhas: [{tabela, id}], tudo,
   * dominio} — `dominio` = a trava lê as abas das checagens (`leiturasTrava`); sem ele, só as linhas citadas (a chave
   * estrangeira delas, com o que o comando já leu).
   */
  function sementesDaTrava(lote, mudancas, derivados) {
    var s = { animais: {}, eventos: {}, lancamentos: {}, importacoes: {}, categorias: {}, contas: {}, parcelas: {}, linhas: [], tudo: false, dominio: false };
    var marcar = function (tipo, id) { if (!vazio_(id)) { s[tipo][String(id)] = true; s.dominio = true; } };
    var linha = function (tabela, id) { if (!vazio_(id)) s.linhas.push({ tabela: tabela, id: String(id) }); };
    Object.keys(lote || {}).forEach(function (t) {
      (lote[t] || []).forEach(function (r) {
        linha(t, r[Schema.pk(t)]); // a chave estrangeira de toda linha que o comando grava
        if (t === 'EVENTOS') { marcar('eventos', r.event_id); marcar('eventos', r.reversal_of_event_id); return; }
        if (t === 'ANIMAIS') { marcar('animais', r.animal_id); return; }
        if (t === 'EVENTO_ANIMAIS' || DETALHES_COM_ANIMAL.indexOf(t) >= 0) { marcar('animais', r.animal_id); marcar('eventos', r.event_id); if (t === 'REPRODUCAO') marcar('animais', r.touro_id); return; }
        if (t === 'COMPRAS' || t === 'VENDAS') { marcar('eventos', r.event_id); return; }
        if (t === 'FINANCEIRO') { marcar('lancamentos', r.financial_id); marcar('eventos', r.event_id); marcar('animais', r.animal_id); return; }
        if (t === 'PARCELAS' || t === 'RATEIOS') { marcar('lancamentos', r.financial_id); return; }
        if (t === 'ALOCACOES_FINANCEIRAS') { marcar('lancamentos', r.financial_id); marcar('animais', r.animal_id); return; }
        if (t === 'CONFIGURACOES' && PARAMETROS_DO_DOMINIO.indexOf(r.chave) >= 0) { s.tudo = true; s.dominio = true; }
      });
    });
    (mudancas || []).forEach(function (m) {
      if (!Schema.temTabela(m.entidade) || vazio_(m.entity_id)) return;
      var e = m.entidade;
      if (e === 'ANIMAIS') {
        if (m.acao === 'CRIAR' || ATRIBUTOS_DO_DOMINIO.indexOf(m.campo) >= 0) marcar('animais', m.entity_id);
        else linha(e, m.entity_id);
        return;
      }
      if (e === 'IMPORTACOES') { if (m.campo === 'status') marcar('importacoes', m.entity_id); return; }
      if (e === 'CATEGORIAS') { if (m.acao !== 'CRIAR') marcar('categorias', m.entity_id); return; }
      if (e === 'CONFIGURACOES') { if (PARAMETROS_DO_DOMINIO.indexOf(m.entity_id) >= 0) { s.tudo = true; s.dominio = true; } return; }
      if (e === 'PLANO_CONTAS') { if (m.acao !== 'CRIAR') marcar('contas', m.entity_id); return; }
      if (e === 'PARCELAS') { marcar('parcelas', m.entity_id); return; }
      if (e === 'FINANCEIRO') { marcar('lancamentos', m.entity_id); return; }
      linha(e, m.entity_id);
    });
    if (derivados) {
      s.dominio = true;
      (derivados.animais || []).forEach(function (id) { marcar('animais', id); });
      (derivados.eventos || []).forEach(function (id) { marcar('eventos', id); });
    }
    return s;
  }
  /**
   * O escopo da trava, resolvido nos dois retratos (o de antes e o de depois):
   *  - `animais` (os tocados): os das sementes, os dos eventos que o comando grava ou anula, os dos lançamentos deles e os
   *    que a fase C regrava — as checagens de cada animal (linha do tempo, entrada aberta, saída, custo) rodam neles;
   *  - `genealogia`: os tocados e os vizinhos que a mudança pode afetar — mãe, pai, crias, o touro e as fêmeas dos
   *    registros reprodutivos (um nível: a checagem de genealogia de cada um olha só a ele e aos pais dele);
   *  - `eventos`: os que o comando grava ou anula (`eventosGravados`) e os partos em que um animal tocado é mãe ou cria;
   *  - `brincos`: os números que os animais tocados usam ou usaram (quem teve o mesmo número entra pela checagem do número);
   *  - `lancamentos` e `linhas` (as linhas citadas, para a chave estrangeira).
   */
  function escopoDaTrava_(antes, depois, s, projecoes, lote) {
    var esc = { animais: {}, genealogia: {}, eventos: {}, eventosGravados: {}, eventosImportados: {}, lancamentos: {}, linhas: s.linhas.slice(), brincos: {} };
    esc.tocados = esc.animais;
    var cru = antes.cru;
    var carregada = function (tab) { return antes.repo.carregada(tab); };
    // As linhas de antes (com os índices que o comando já montou) mais as que o comando grava: as linhas gravadas não mudam,
    // então o retrato de depois só acrescenta as do plano (as projeções que mudam entram pelas atualizações da fase C).
    var doPlano = {};
    var planoPor = function (tab, campo, valor) {
      var k = tab + '\u0000' + campo;
      if (!doPlano[k]) {
        var idx = {};
        ((lote || {})[tab] || []).forEach(function (r) { if (!vazio_(r[campo])) (idx[r[campo]] = idx[r[campo]] || []).push(r); });
        doPlano[k] = idx;
      }
      return doPlano[k][valor] || [];
    };
    var linhasPor = function (tab, campo, valor) {
      if (vazio_(valor)) return [];
      return (carregada(tab) ? cru.cruPor(tab, campo, valor) : []).concat(planoPor(tab, campo, valor));
    };
    Object.keys(s.animais).forEach(function (id) { esc.animais[id] = true; });
    Object.keys(s.eventos).forEach(function (id) { esc.eventos[id] = true; esc.eventosGravados[id] = true; });
    Object.keys(s.lancamentos).forEach(function (id) { esc.lancamentos[id] = true; });
    if (Object.keys(s.importacoes).length && carregada('EVENTOS')) {
      cru.cru('EVENTOS').forEach(function (e) { if (!vazio_(e.import_id) && s.importacoes[e.import_id]) { esc.eventos[e.event_id] = true; esc.eventosGravados[e.event_id] = true; esc.eventosImportados[e.event_id] = true; } });
    }
    if (Object.keys(s.categorias).length) {
      [antes, depois].forEach(function (t) {
        if (!t.repo.carregada('AJUSTES')) return;
        t.repo.vigentes('AJUSTES').forEach(function (x) { if (x.tipo_ajuste === 'RECLASSIFICACAO' && !vazio_(x.valor_novo) && s.categorias[x.valor_novo]) esc.animais[x.animal_id] = true; });
      });
    }
    if (Object.keys(s.contas).length && carregada('FINANCEIRO')) cru.cru('FINANCEIRO').forEach(function (f) { if (s.contas[f.conta_id]) esc.lancamentos[f.financial_id] = true; });
    if (carregada('PARCELAS')) Object.keys(s.parcelas).forEach(function (id) { var p = cru.cruPorId('PARCELAS', id); if (p) esc.lancamentos[p.financial_id] = true; });
    // O que a fase C regrava (as projeções que mudam) também é tocado pelo comando.
    (projecoes || []).forEach(function (u) {
      if (u.tabela === 'ANIMAIS') esc.animais[u.id] = true;
      else if (u.tabela === 'FINANCEIRO') esc.lancamentos[u.id] = true;
      else if (u.tabela === 'IDENTIFICACOES') {
        var r = (carregada('IDENTIFICACOES') ? cru.cruPorId('IDENTIFICACOES', u.id) : null) || planoPor('IDENTIFICACOES', 'ident_id', u.id)[0];
        if (r) esc.animais[r.animal_id] = true;
      }
    });
    // Os animais e os lançamentos dos eventos gravados ou anulados; os animais dos lançamentos do escopo.
    Object.keys(esc.eventosGravados).forEach(function (eid) {
      linhasPor('EVENTO_ANIMAIS', 'event_id', eid).forEach(function (l) { esc.animais[l.animal_id] = true; });
      DETALHES_COM_ANIMAL.forEach(function (tab) {
        linhasPor(tab, 'event_id', eid).forEach(function (r) { if (!vazio_(r.animal_id)) esc.animais[r.animal_id] = true; if (!vazio_(r.touro_id)) esc.genealogia[r.touro_id] = true; });
      });
      linhasPor('FINANCEIRO', 'event_id', eid).forEach(function (f) { esc.lancamentos[f.financial_id] = true; });
    });
    Object.keys(esc.lancamentos).forEach(function (fid) { linhasPor('ALOCACOES_FINANCEIRAS', 'financial_id', fid).forEach(function (a) { esc.animais[a.animal_id] = true; }); });
    // Os vizinhos de cada animal tocado (um nível), os partos dele e os números de brinco dele. A mãe e o pai de depois vêm do
    // retrato (a projeção pode tê-los mudado); a cria cuja mãe mudou é ela mesma um animal tocado (a projeção dela mudou).
    var base = Object.keys(esc.animais);
    base.forEach(function (id) { esc.genealogia[id] = true; });
    var numeros = [antes, depois].map(function (t) {
      var semZeros = (t.repo.carregada('CONFIGURACOES') ? Timeline.parametros(t.repo) : {}).brinco_ignora_zeros_esquerda !== false;
      return function (c) { return vazio_(c) ? null : Utils.normalizarBrinco(String(c), !semZeros); };
    });
    var marcarNumero = function (c) { numeros.forEach(function (n) { var k = n(c); if (k) esc.brincos[k] = true; }); };
    base.forEach(function (id) {
      [antes, depois].forEach(function (t) {
        var a = t.repo.carregada('ANIMAIS') ? t.cru.cruPorId('ANIMAIS', id) : null;
        if (!a) return;
        [a.mae_id, a.pai_id].forEach(function (p) { if (!vazio_(p)) esc.genealogia[p] = true; });
        marcarNumero(a.brinco);
      });
      ['mae_id', 'pai_id'].forEach(function (c) { linhasPor('ANIMAIS', c, id).forEach(function (x) { esc.genealogia[x.animal_id] = true; }); });
      linhasPor('REPRODUCAO', 'animal_id', id).forEach(function (r) { if (!vazio_(r.touro_id)) esc.genealogia[r.touro_id] = true; });
      linhasPor('REPRODUCAO', 'touro_id', id).forEach(function (r) { esc.genealogia[r.animal_id] = true; });
      linhasPor('EVENTO_ANIMAIS', 'animal_id', id).forEach(function (l) {
        var ev = (carregada('EVENTOS') ? cru.cruPorId('EVENTOS', l.event_id) : null) || planoPor('EVENTOS', 'event_id', l.event_id)[0];
        if (ev && ev.event_type === 'NASCIMENTO') esc.eventos[l.event_id] = true;
      });
      linhasPor('IDENTIFICACOES', 'animal_id', id).forEach(function (r) { if (r.tipo === 'BRINCO') marcarNumero(r.codigo); });
    });
    return esc;
  }
  /** Achados do retrato de depois que não existiam no de antes: um achado é novo quando tem uma chave (átomo) que o antes não tinha. */
  function novosAchados_(antes, depois) {
    var conta = {};
    antes.forEach(function (a) { a.chaves.forEach(function (k) { conta[k] = (conta[k] || 0) + 1; }); });
    return depois.filter(function (a) {
      a.atomosNovos = [];
      a.chaves.forEach(function (k) { if (conta[k]) conta[k] -= 1; else a.atomosNovos.push(k); });
      return a.atomosNovos.length > 0;
    });
  }
  /**
   * A recusa da trava: VALIDATION quando todo achado novo é do próprio lançamento (das linhas que ele grava), CONFLICT
   * quando algum cai num registro já gravado (com o lançamento que impede em `conflito`). Código INTEGRIDADE_<CHECAGEM>;
   * a mensagem diz o que ficaria errado e como resolver. Nada é gravado e a chave de idempotência continua livre.
   */
  function recusaDaTrava_(novos, depois, proprios) {
    var cru = depois.cru;
    // Do próprio lançamento: o achado aponta um evento ou uma linha que ele grava; no brinco, o número que ele dá (um
    // átomo novo com um animal ou uma identificação dele).
    var proprio = function (a) {
      if (!vazio_(a.event_id) && proprios.eventos[a.event_id]) return true;
      if (!vazio_(a.tabela) && !vazio_(a.id) && proprios.linhas[a.tabela + '\u0000' + a.id]) return true;
      if (a.checagem !== 'BRINCO' && a.checagem !== 'IDENTIFICACOES_ATIVAS') return false;
      return (a.atomosNovos || []).some(function (k) { return k.split('|').some(function (x) { return proprios.brincos[x] === true; }); });
    };
    var algumConflito = novos.some(function (a) { return !proprio(a); });
    var detalhes = novos.map(function (a) {
      var ev = !vazio_(a.event_id) && !proprios.eventos[a.event_id] && depois.repo.carregada('EVENTOS') ? cru.cruPorId('EVENTOS', a.event_id) : null;
      var animal = !vazio_(a.animal_id) && depois.repo.carregada('ANIMAIS') ? cru.cruPorId('ANIMAIS', a.animal_id) : null;
      return Validation.detalhe({
        codigo: 'INTEGRIDADE_' + a.checagem, animal_id: a.animal_id, brinco: animal && !vazio_(animal.brinco) ? animal.brinco : a.brinco,
        campo: a.campo, mensagem: (a.oque || a.mensagem) + ' ' + (a.resolver || COMO_RESOLVER[a.checagem]),
        conflito: ev ? { event_id: ev.event_id, tipo: ev.event_type, subtipo: nulo_(ev.event_subtype), data: ev.event_date, nome: EventCatalog.existe(ev.event_type) ? EventCatalog.nomeEvento(ev.event_type, ev.event_subtype) : null } : null,
      });
    });
    var mensagem = novos.length === 1
      ? 'Não dá para gravar: os dados ficariam errados. ' + detalhes[0].mensagem + ' Nada foi gravado.'
      : 'Não dá para gravar: os dados ficariam errados em ' + novos.length + ' pontos (veja cada um abaixo). Nada foi gravado.';
    return Validation.erro(algumConflito ? 'CONFLICT' : 'VALIDATION', mensagem, detalhes);
  }
  /**
   * A trava (chamada pela UnitOfWork entre o tratador e a fase A, também no SIMULAR). t: {antes, depois (tx com acesso
   * cru: o retrato de antes e o de depois), sementes (sementesDaTrava), lote (as linhas que o plano anexa: {ABA: [linhas]}),
   * projecoes (as atualizações que a fase C grava),
   * derivados (o escopo das projeções do tratador), projetor (ctx.projecoes), proprios: {eventos, linhas} (o que o plano
   * grava)}. Lança VALIDATION/CONFLICT INTEGRIDADE_<CHECAGEM>; devolve {escopo: {animais, eventos, lancamentos, linhas},
   * achados_depois, achados_antes (null quando não foi preciso olhar o antes)}.
   */
  function travar(t) {
    var s = t.sementes;
    var esc = s.tudo ? null : escopoDaTrava_(t.antes, t.depois, s, t.projecoes, t.lote);
    // O que o próprio comando projeta (a fase C grava o que o projetor deu no retrato): o escopo dele e o que o projetor
    // regravou (a mãe alcançada pela cria, por exemplo).
    var d = t.derivados || null;
    var cobertos = { animais: {}, eventos: {} };
    if (d && d.tudo) cobertos = { tudo: true };
    else {
      if (d) (d.animais || []).forEach(function (id) { cobertos.animais[id] = true; });
      if (d) (d.eventos || []).forEach(function (id) { cobertos.eventos[id] = true; });
      (t.projecoes || []).forEach(function (u) { if (u.tabela === 'ANIMAIS') cobertos.animais[u.id] = true; });
    }
    var opcoes = { projetor: t.projetor || null, cobertos: cobertos };
    var rodar = function (tx) {
      var col = coletorAchados_({ completo: true });
      conferirDominio_(tx, col, esc, opcoes);
      return col.relatorio().lista.filter(function (a) { return CHECAGENS_DOMINIO.indexOf(a.checagem) >= 0; });
    };
    var depois = rodar(t.depois);
    var resumo = {
      escopo: esc ? { animais: Object.keys(esc.animais).length, genealogia: Object.keys(esc.genealogia).length, eventos: Object.keys(esc.eventos).length, lancamentos: Object.keys(esc.lancamentos).length, linhas: esc.linhas.length } : { tudo: true },
      achados_depois: depois.length, achados_antes: null,
    };
    if (!depois.some(function (a) { return a.severidade === 'ERRO'; })) return resumo;
    var antes = rodar(t.antes);
    resumo.achados_antes = antes.length;
    var novos = novosAchados_(antes, depois).filter(function (a) { return a.severidade === 'ERRO'; });
    if (novos.length) throw recusaDaTrava_(novos, t.depois, t.proprios || { eventos: {}, linhas: {} });
    return resumo;
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
    CHECAGENS_DOMINIO: CHECAGENS_DOMINIO,
    leiturasTrava: leiturasTrava,
    sementesDaTrava: sementesDaTrava,
    travar: travar,
  };
})();
