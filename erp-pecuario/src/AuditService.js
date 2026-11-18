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
 * As checagens de domínio são uma função só, com escopo: a verificação a roda sobre tudo, e a TRAVA DE INTEGRIDADE dos
 * comandos (`travar`, chamada pela UnitOfWork antes da fase A) a roda sobre o retrato de antes e o de depois do comando,
 * no escopo que ele toca — o que a verificação acusaria como ERRO não chega a ser gravado (CONTRATOS, seção 10.5).
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
  /**
   * Checagens cujo achado é sempre a FONTE da reconstrução quebrada (linha dos animais, detalhe ou registro de que outra
   * linha depende, apagados ou mexidos à mão). Somadas aos achados marcados `fonte` (as parcelas do lançamento), impedem o
   * reparo RECONSTRUIR: ele refaria a situação a partir do dado quebrado (06, seções 9 e 12; RN-112) — ressuscitaria o
   * animal morto, apagaria a dívida. O caminho é restaurar o backup ou investigar a edição manual.
   */
  var FONTE_QUEBRADA = Object.freeze({ COPIAS: true, FILHAS_SEM_PAI: true });
  var PAIS_FILHA = Object.freeze({ AUDITORIA: ['op_id', 'OPERACOES'], IMPORTACAO_LINHAS: ['import_id', 'IMPORTACOES'], ALOCACOES_FINANCEIRAS: ['rateio_id', 'RATEIOS'], PARCELAS: ['financial_id', 'FINANCEIRO'] });
  var COPIAS_DATA = Object.freeze({ PESAGENS: 'data_pesagem', REPRODUCAO: 'data', IDENTIFICACOES: 'data_inicio', SANIDADE: 'data_aplicacao', MOVIMENTOS_ESTOQUE: 'data' });
  /**
   * Checagem de cada invariante de 03b, seção 14 (FinancialService.conferir). A 6 (situação de pagamento pelas parcelas)
   * é a própria projeção de FINANCEIRO, já conferida em PROJECAO; a 12 e a 18 também são projeções e ficam nas
   * checagens delas (uma vez por registro, junto com a diferença da reconstrução).
   */
  var CHECAGEM_DA_INVARIANTE = Object.freeze({
    1: 'FINANCEIRO', 2: 'FINANCEIRO', 3: 'PARCELAS', 4: 'FINANCEIRO', 5: 'FINANCEIRO', 6: null, 7: 'ALOCACOES', 8: 'ALOCACOES', 9: 'ALOCACOES',
    10: 'ALOCACOES', 11: 'ALOCACOES', 12: 'ALOCACAO_DIRETA', 13: 'ALOCACOES', 14: 'FINANCEIRO', 15: 'FINANCEIRO', 16: 'FINANCEIRO', 17: 'FINANCEIRO',
    18: 'CUSTO_AQUISICAO', 19: 'FINANCEIRO', 20: 'FINANCEIRO', 21: 'FINANCEIRO', 22: 'PARCELAS', 23: 'PARCELAS', 24: 'FINANCEIRO',
  });
  /** Campos da reconstrução que têm checagem própria (o resto da diferença fica em PROJECAO). */
  var CHECAGEM_DO_CAMPO = Object.freeze({ 'FINANCEIRO.animal_id': 'ALOCACAO_DIRETA', 'ANIMAIS.custo_aquisicao': 'CUSTO_AQUISICAO', 'ANIMAIS.custo_aquisicao_origem': 'CUSTO_AQUISICAO' });
  /** Como resolver, na trava, o touro e a fêmea de um registro reprodutivo que deixariam de valer na data dele. */
  var RESOLVER_TOURO = 'O pai (touro) de um parto ou de um registro reprodutivo é macho e nasceu antes dele: confira o sexo e o nascimento do touro, ou corrija antes o registro.';
  /** Como resolver cada regra de manejo na mensagem da trava (a frase da regra diz o que ficaria errado). */
  var RESOLVER_MANEJO = Object.freeze({
    CASTRACAO_DE_FEMEA: 'Só macho é castrado: estorne a castração, ou confira o sexo do animal.',
    CASTRACAO_REPETIDA: 'O animal já era castrado: estorne a castração repetida, ou confira o cadastro de origem.',
    TOURO_CASTRADO: 'Um touro castrado não cobre: estorne ou corrija o registro reprodutivo, ou mude a data da castração.',
    DESMAMA_REPETIDA: 'Cada cria é desmamada uma vez: estorne a desmama repetida (ou corrija a data da primeira).',
    PARTO_NA_GESTACAO: 'Confira a idade da gestação do diagnóstico ou a data do parto: a gestação diagnosticada começou depois do parto.',
  });
  var RESOLVER_FONTE = 'Este lançamento refaria a situação a partir desses dados, como se estivessem certos. Restaure o backup ou investigue a edição manual da planilha antes de lançar para eles.';
  var RESOLVER_FONTE_CORRECAO = 'A correção refaria o lançamento a partir desses dados, como se estivessem certos. Restaure o backup ou investigue a edição manual da planilha; se o lançamento estiver errado, estorne-o e lance de novo.';
  var RESOLVER_CRIA_EM_DOBRO = 'O parto de um animal que já está no cadastro não se lança: a mãe e o nascimento dele ficam no cadastro. Se o parto antigo já foi gravado, estorne-o ou desfaça a importação dele; para pôr no rebanho inicial a cria de um parto antigo, lance "Outra entrada" dela datada do marco zero, em vez de cadastrar um animal novo.';
  var RESOLVER_FEMEA = 'O registro reprodutivo é de uma fêmea nascida antes dele: confira o sexo e o nascimento, ou corrija antes o lançamento que gravou o registro.';
  var RESOLVER_TOURO_LINHA = 'O touro de uma exposição ou de uma cobertura é macho: confira o sexo do animal, ou corrija antes o lançamento (tire o animal do lote ou troque o touro).';
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
    CHECAGENS.forEach(function (c) { por[c.codigo] = { n: 0, aplicada: false, severidades: {}, ids: {}, fonte: 0 }; });
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
        var fonte = a.fonte === true || (!!FONTE_QUEBRADA[codigo] && a.fonte !== false);
        if (fonte) por[codigo].fonte += 1;
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
          item.fonte = fonte;
          // A fonte que a correção do lançamento LÊ (a entrada sem mudança e os valores que ela mantém do original): a correção dele
          // é recusada pela trava, em vez de refazer o substituto a partir do dado mexido (CONTRATOS, seção 54).
          item.lidaPelaCorrecao = a.lidaPelaCorrecao === true;
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
    var proj = null;
    if (Timeline.LEITURAS.every(function (t) { return repo.carregada(t); })) {
      f = Timeline.fonte(tx, { parametros: params });
      var memo = {};
      proj = function (id) { if (!memo[id]) memo[id] = Timeline.projetarAnimal(f, id); return memo[id]; };
      conferirAnimais_(tx, col, f, proj, esc, o.porAnimal || null);
      conferirPartos_(tx, col, f, proj, esc);
      conferirGenealogia_(tx, col, esc);
      conferirProjecoes_(tx, col, esc, o);
    }
    conferirFinanceiro_(tx, col, esc);
    conferirCopias_(tx, col, esc, proj, f);
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
              tabela: 'AJUSTES', id: x.ajuste_id, campo: 'valor_novo', mensagem: rotuloAnimal_(a, id) + ': a reclassificação de ' + br_(evr.event_date) + ' põe o animal na categoria ' + cat.nome + ', que é só de ' + (cat.sexo_aplicavel === 'M' ? 'machos' : 'fêmeas') + ', mas ele é ' + (calc.sexo === 'M' ? 'macho' : 'fêmea') + ' pelo cadastro. Estorne essa reclassificação (ou corrija-a para uma categoria do sexo dele), ou corrija o sexo.',
              // O que ficaria, sem dizer qual lado mudou: o sexo do animal (correção de cadastro) ou o da categoria (cadastro dela).
              oque: rotuloAnimal_(a, id) + ': a reclassificação de ' + br_(evr.event_date) + ' deixaria o animal, ' + (calc.sexo === 'M' ? 'macho' : 'fêmea') + ' pelo cadastro, numa categoria só de ' + (cat.sexo_aplicavel === 'M' ? 'machos' : 'fêmeas') + ' (' + cat.nome + ').',
              chaves: 'CATEGORIA|' + x.ajuste_id, event_id: x.event_id, animal_id: id,
              // Toda reclassificação que vale conta, também a que já não é a categoria de hoje: voltar o animal à categoria
              // automática ou reclassificá-lo de novo não a tira do histórico. O caminho é estorná-la ou corrigi-la.
              resolver: 'Estorne antes a reclassificação de ' + br_(evr.event_date) + ' (ou corrija-a para uma categoria que sirva ao sexo do animal): voltar à categoria automática ou reclassificar de novo não apaga a reclassificação antiga.',
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
        var idents = Timeline.identificacoes(f, id);
        Timeline.validarIdentificacoes(idents).concat(Timeline.validarMarcacoes(linhas)).forEach(function (p) {
          col.achado('LINHA_DO_TEMPO', { tabela: 'ANIMAIS', id: id, mensagem: rotuloAnimal_(a, id) + ': ' + Timeline.descrever(p) + ' (evento de ' + br_(p.event_date) + ').', chaves: 'SEQUENCIA|' + id + '|' + p.codigo + '|' + p.event_id, event_id: p.event_id, resolver: 'Confira a ordem das identificações e das marcações do animal: mude a data deste lançamento ou estorne antes o registro que conflita.' });
        });
        conferirBrincoCorrigido_(f, col, a, id, idents);
        // Regras de manejo do animal (a mesma função do motor): castração de fêmea ou repetida, touro castrado, desmama
        // repetida, parto dentro da gestação de um diagnóstico positivo (ReproductionService.problemasDoAnimal).
        ReproductionService.problemasNaFonte(f, id, calc.sexo).forEach(function (p) {
          col.achado('LINHA_DO_TEMPO', {
            tabela: 'ANIMAIS', id: id, mensagem: rotuloAnimal_(a, id) + ': ' + p.mensagem, oque: rotuloAnimal_(a, id) + ': ' + p.mensagem,
            chaves: 'MANEJO|' + id + '|' + p.codigo + '|' + p.event_id + '|' + (p.parto_event_id || ''), event_id: p.event_id, animal_id: id,
            resolver: RESOLVER_MANEJO[p.codigo] || null,
          });
        });
      }
      if (a.situacao_cadastral === 'ATIVO') {
        var soma = linhas.filter(function (l) { return !l.pre_marco_zero; }).reduce(function (s, l) { return s + (l.efeito || 0); }, 0);
        // Um átomo por entrada a mais (ou a menos): piorar é afastar a soma de 1.
        var atomos = [];
        for (var k = 1; k <= Math.abs(soma - 1); k++) atomos.push(id + '|' + (soma > 1 ? '+' : '-') + k);
        if (soma !== 1) col.achado('ENTRADA_ABERTA', { tabela: 'ANIMAIS', id: id, mensagem: rotuloAnimal_(a, id) + ' está ativo, mas os eventos somam ' + soma + ' entrada(s) em aberto.', chaves: atomos });
        // Pasto desativado só sem animal no rebanho dentro dele (03a, seção 2.1), por qualquer caminho: o estorno da saída
        // ou da transferência que o tirou de lá, a correção que o tira da transferência, o desfazer da importação.
        var pastoAtual = f.pasto(a.pasto_atual_id);
        if (pastoAtual && pastoAtual.status !== 'ATIVO') {
          var oPasto = (/^pasto\b/i.test(pastoAtual.nome || '') ? 'o ' : 'o pasto ') + pastoAtual.nome;
          var poe = Timeline.ordenar(linhas.filter(function (l) { return !l.pre_marco_zero && l.pasto_destino_id === a.pasto_atual_id; })).pop();
          col.achado('LINHA_DO_TEMPO', {
            tabela: 'ANIMAIS', id: id, campo: 'pasto_atual_id', animal_id: id, event_id: poe ? poe.event_id : null, chaves: 'PASTO_INATIVO|' + id + '|' + a.pasto_atual_id,
            mensagem: rotuloAnimal_(a, id) + ' está no rebanho dentro d' + oPasto + ', que está desativado.',
            resolver: 'Reative ' + oPasto + ' na tela Pastos antes; depois transfira os animais dele e desative-o de novo, se for o caso.',
          });
        }
        // A propriedade do pasto também (03a, seções 4.1 e 4.2: propriedade desativada só sem pasto ativo).
        var prop = pastoAtual && pastoAtual.status === 'ATIVO' && tx.repo.carregada('PROPRIEDADES') ? tx.repo.porId('PROPRIEDADES', pastoAtual.property_id) : null;
        if (prop && prop.status !== 'ATIVO') {
          var poeP = Timeline.ordenar(linhas.filter(function (l) { return !l.pre_marco_zero && l.pasto_destino_id === a.pasto_atual_id; })).pop();
          col.achado('LINHA_DO_TEMPO', {
            tabela: 'ANIMAIS', id: id, campo: 'pasto_atual_id', animal_id: id, event_id: poeP ? poeP.event_id : null, chaves: 'PROPRIEDADE_INATIVA|' + id + '|' + prop.property_id,
            mensagem: rotuloAnimal_(a, id) + ' está no rebanho no pasto ' + pastoAtual.nome + ', da propriedade ' + prop.nome + ', que está desativada.',
            resolver: 'Reative a propriedade ' + prop.nome + ' antes, ou mantenha os animais em pastos de propriedades ativas.',
          });
        }
      }
      // Categoria desativada só sem animal reclassificado à mão nela (Config, CATEGORIA_EM_USO), por qualquer caminho: a
      // correção que muda a ordem das reclassificações, o estorno da última.
      if (a.categoria_modo === 'MANUAL' && !vazio_(a.categoria_manual_id) && a.situacao_cadastral !== 'ANULADO' && a.situacao_cadastral !== 'PENDENTE' && tx.repo.carregada('CATEGORIAS')) {
        var catManual = tx.repo.porId('CATEGORIAS', a.categoria_manual_id);
        if (catManual && catManual.ativo === false) {
          var rec = f.ajustes(id).filter(function (x) { return x.tipo_ajuste === 'RECLASSIFICACAO' && x.valor_novo === catManual.category_id; }).map(function (x) { return f.evento(x.event_id); }).filter(Boolean)
            .sort(function (x, y) { return x.event_date < y.event_date ? -1 : x.event_date > y.event_date ? 1 : x.event_seq - y.event_seq; }).pop();
          col.achado('LINHA_DO_TEMPO', {
            tabela: 'ANIMAIS', id: id, campo: 'categoria_manual_id', animal_id: id, event_id: rec ? rec.event_id : null, chaves: 'CATEGORIA_INATIVA|' + id + '|' + catManual.category_id,
            mensagem: rotuloAnimal_(a, id) + ' está na categoria ' + catManual.nome + ', escolhida à mão, que está desativada.',
            resolver: 'Reative a categoria ' + catManual.nome + ' nas configurações antes, ou reclassifique o animal.',
          });
        }
      }
      if (porAnimal) porAnimal(a, id, linhas);
    });
  }
  /**
   * O brinco lançado errado (AJUSTE_INVENTARIO/IDENTIFICACAO_INCORRETA) corrige o número que estava em uso na posição
   * dele (data, posição na cadeia de substituição, sequência): é esse número que deixa de contar para o reuso
   * (desenho-base 16.2). Vale em todo caminho: o registro, a correção dele e a correção ou o estorno das identificações
   * em volta (a troca levada para antes dele, a primeira identificação estornada).
   */
  function conferirBrincoCorrigido_(f, col, a, id, idents) {
    f.ajustes(id).forEach(function (x) {
      if (x.tipo_ajuste !== 'IDENTIFICACAO_INCORRETA' || x.campo !== 'brinco') return;
      var evx = f.evento(x.event_id);
      if (!evx) return;
      var pos = { data: evx.event_date, ordem_seq: f.ordemSeq(x.event_id), event_seq: evx.event_seq };
      var emUso = null;
      idents.forEach(function (r) {
        if (r.tipo !== 'BRINCO' || r.event_id === x.event_id) return;
        var antes = r.data_inicio < pos.data || (r.data_inicio === pos.data && (r.ordem_seq < pos.ordem_seq || (r.ordem_seq === pos.ordem_seq && r.event_seq < pos.event_seq)));
        if (antes) emUso = r.remocao ? null : r;
      });
      if (Utils.normalizarBrinco(emUso ? String(emUso.codigo) : '') === Utils.normalizarBrinco(vazio_(x.valor_anterior) ? '' : String(x.valor_anterior))) return;
      col.achado('LINHA_DO_TEMPO', {
        tabela: 'AJUSTES', id: x.ajuste_id, campo: 'valor_anterior', animal_id: id, event_id: x.event_id, chaves: 'BRINCO_CORRIGIDO|' + x.ajuste_id,
        mensagem: rotuloAnimal_(a, id) + ': a correção de brinco lançado errado de ' + br_(evx.event_date) + ' troca o brinco ' + x.valor_anterior + ', mas nessa data o animal estava ' + (emUso ? 'com o brinco ' + emUso.codigo : 'sem brinco') + '.',
        oque: rotuloAnimal_(a, id) + ': a correção de brinco lançado errado de ' + br_(evx.event_date) + ' trocaria o brinco ' + x.valor_anterior + ', mas nessa data o animal ficaria ' + (emUso ? 'com o brinco ' + emUso.codigo : 'sem brinco') + '.',
        // O conselho serve a qualquer identificação (troca, retirada, primeira): é ela que fica antes ou depois da correção.
        resolver: 'Estorne antes a correção do brinco lançado errado, ou dê a esta identificação uma data depois da correção (' + br_(evx.event_date) + ').',
      });
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
      var achado = function (mensagem, tabela, id, chave, oque) {
        col.achado('PARTOS', { tabela: tabela || 'EVENTOS', id: id || ev.event_id, mensagem: quem + ' ' + mensagem, oque: oque ? quem + ' ' + oque : null, chaves: ev.event_id + '|' + chave, event_id: ev.event_id, animal_id: tabela === 'ANIMAIS' ? id : null });
      };
      if (maes.length !== 1) achado('tem ' + maes.length + ' mães nos animais do evento; um parto é de uma vaca só.', null, null, 'MAES');
      if (reps.length !== 1) achado('tem ' + reps.length + ' registros de parto na reprodução; precisa ter exatamente um.', null, null, 'REGISTROS');
      var r = reps.length === 1 ? reps[0] : null;
      if (mae) {
        var pm = proj(mae).campos || {};
        if (pm.sexo !== 'F') achado('tem como mãe um animal que não é fêmea pelo cadastro.', 'ANIMAIS', mae, 'MAE_SEXO|' + mae, 'teria como mãe um animal que passaria a ser macho.');
        if (Utils.dataValida(pm.data_nascimento) && pm.data_nascimento >= ev.event_date) achado('tem como mãe um animal nascido em ' + br_(pm.data_nascimento) + ', não antes do parto.', 'ANIMAIS', mae, 'MAE_NASCIMENTO|' + mae, 'teria como mãe um animal que ficaria nascido em ' + br_(pm.data_nascimento) + ', não antes do parto.');
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
    // O animal de referência (de fora, como o touro do sêmen) aparece pelo nome, que é como o dono o conhece.
    var nome = function (id) { var x = vale[id]; return x && x.situacao_cadastral === 'EXTERNO' && !vazio_(x.nome) ? x.nome + ' (' + (x.codigo_interno || id) + ')' : rotuloAnimal_(x, id); };
    var noCiclo = {};
    var alvo = esc ? Object.keys(esc.genealogia).filter(function (id) { return !!vale[id]; }) : Object.keys(vale);
    alvo.forEach(function (id) {
      var a = vale[id];
      [['mae_id', 'F', 'mãe', 'fêmea'], ['pai_id', 'M', 'pai', 'macho']].forEach(function (cfg) {
        var p = vazio_(a[cfg[0]]) ? null : vale[a[cfg[0]]];
        if (!p) return;
        if (p.sexo !== cfg[1]) {
          col.achado('GENEALOGIA', { tabela: 'ANIMAIS', id: id, campo: cfg[0], mensagem: nome(id) + ' tem como ' + cfg[2] + ' ' + nome(p.animal_id) + ', que não é ' + cfg[3] + ' pelo cadastro.',
            oque: nome(id) + ' teria como ' + cfg[2] + ' ' + nome(p.animal_id) + ', que passaria a ser ' + (p.sexo === 'M' ? 'macho' : p.sexo === 'F' ? 'fêmea' : 'de sexo desconhecido') + '.', chaves: id + '|' + cfg[0] + '|SEXO|' + p.animal_id });
        } else if (Utils.dataValida(p.data_nascimento) && Utils.dataValida(a.data_nascimento) && p.data_nascimento >= a.data_nascimento) {
          col.achado('GENEALOGIA', { tabela: 'ANIMAIS', id: id, campo: cfg[0], mensagem: nome(id) + ', nascido em ' + br_(a.data_nascimento) + ', tem como ' + cfg[2] + ' ' + nome(p.animal_id) + ', que nasceu em ' + br_(p.data_nascimento) + ', não antes dele.',
            oque: nome(id) + ', nascido em ' + br_(a.data_nascimento) + ', teria como ' + cfg[2] + ' ' + nome(p.animal_id) + ', que ficaria nascido em ' + br_(p.data_nascimento) + ', não antes dele.', chaves: id + '|' + cfg[0] + '|NASCIMENTO|' + p.animal_id });
        }
      });
      if (noCiclo[id]) return;
      cicloDe(id);
    });
    conferirCriaEmDobro_(tx, col, vale, alvo, nome);
    if (tx.repo.carregada('REPRODUCAO')) {
      tx.repo.vigentes('REPRODUCAO').forEach(function (r) {
        if (esc && !esc.genealogia[r.animal_id] && !(r.touro_id && esc.genealogia[r.touro_id])) return;
        var oque = (r.tipo_evento === 'PARTO' ? 'O parto de ' : 'O registro reprodutivo de ') + br_(r.data) + ' (mãe ' + nome(r.animal_id) + ')';
        // O touro de um registro reprodutivo (o pai do parto, mesmo só de natimorto): macho e nascido antes dele (RN-060).
        var t = vazio_(r.touro_id) ? null : vale[r.touro_id];
        if (t && t.sexo !== 'M') {
          col.achado('GENEALOGIA', { tabela: 'REPRODUCAO', id: r.reproduction_id, campo: 'touro_id', mensagem: oque + ' tem como pai ' + nome(t.animal_id) + ', que não é macho pelo cadastro.',
            oque: oque + ' teria como pai ' + nome(t.animal_id) + ', que passaria a ser ' + (t.sexo === 'F' ? 'fêmea' : 'de sexo desconhecido') + '.', chaves: 'TOURO|' + r.reproduction_id + '|SEXO|' + t.animal_id, event_id: r.event_id, animal_id: t.animal_id, resolver: RESOLVER_TOURO });
        } else if (t && Utils.dataValida(t.data_nascimento) && Utils.dataValida(r.data) && t.data_nascimento >= r.data) {
          col.achado('GENEALOGIA', { tabela: 'REPRODUCAO', id: r.reproduction_id, campo: 'touro_id', mensagem: oque + ' tem como pai ' + nome(t.animal_id) + ', que nasceu em ' + br_(t.data_nascimento) + ', não antes dele.',
            oque: oque + ' teria como pai ' + nome(t.animal_id) + ', que ficaria nascido em ' + br_(t.data_nascimento) + ', não antes dele.', chaves: 'TOURO|' + r.reproduction_id + '|NASCIMENTO|' + t.animal_id, event_id: r.event_id, animal_id: t.animal_id, resolver: RESOLVER_TOURO });
        }
        // A fêmea do registro reprodutivo que não é parto (diagnóstico de gestação, cobertura...): fêmea e nascida antes dele.
        var m = r.tipo_evento === 'PARTO' ? null : vale[r.animal_id];
        if (m && !vazio_(m.sexo) && m.sexo !== 'F') {
          col.achado('GENEALOGIA', { tabela: 'REPRODUCAO', id: r.reproduction_id, campo: 'animal_id', mensagem: 'O registro reprodutivo de ' + br_(r.data) + ' é de ' + nome(m.animal_id) + ', que não é fêmea pelo cadastro.',
            oque: 'O registro reprodutivo de ' + br_(r.data) + ' é de ' + nome(m.animal_id) + ', que passaria a ser macho.', chaves: 'FEMEA|' + r.reproduction_id + '|SEXO|' + m.animal_id, event_id: r.event_id, animal_id: m.animal_id, resolver: RESOLVER_FEMEA });
        } else if (m && Utils.dataValida(m.data_nascimento) && Utils.dataValida(r.data) && m.data_nascimento >= r.data) {
          col.achado('GENEALOGIA', { tabela: 'REPRODUCAO', id: r.reproduction_id, campo: 'animal_id', mensagem: 'O registro reprodutivo de ' + br_(r.data) + ' é de ' + nome(m.animal_id) + ', que nasceu em ' + br_(m.data_nascimento) + ', não antes dele.',
            oque: 'O registro reprodutivo de ' + br_(r.data) + ' é de ' + nome(m.animal_id) + ', que ficaria nascida em ' + br_(m.data_nascimento) + ', não antes dele.', chaves: 'FEMEA|' + r.reproduction_id + '|NASCIMENTO|' + m.animal_id, event_id: r.event_id, animal_id: m.animal_id, resolver: RESOLVER_FEMEA });
        }
      });
    }
    // A linha de touro (o macho do lote da exposição; o touro do rebanho na cobertura) é de um macho pelo cadastro (RN-060). Com
    // vários touros no lote o registro da fêmea fica sem touro, e a correção do sexo de um deles deixaria uma fêmea como touro
    // — que a correção sem mudança da exposição refaria como fêmea exposta (CONTRATOS, seção 50).
    if (tx.repo.carregada('EVENTO_ANIMAIS')) {
      tx.repo.vigentes('EVENTO_ANIMAIS').forEach(function (l) {
        if (l.papel !== 'TOURO' || (esc && !esc.genealogia[l.animal_id])) return;
        var t = vale[l.animal_id];
        if (!t || t.sexo === 'M') return;
        var ev = tx.repo.porId('EVENTOS', l.event_id) || {};
        var oque = (ev.event_subtype === 'COBERTURA' ? 'A cobertura de ' : 'A exposição de ') + br_(ev.event_date) + ' tem ' + nome(l.animal_id) + ' como touro';
        col.achado('GENEALOGIA', { tabela: 'EVENTO_ANIMAIS', id: l.event_animal_id, campo: 'animal_id', mensagem: oque + ', que não é macho pelo cadastro.',
          oque: oque + ', que passaria a ser ' + (t.sexo === 'F' ? 'fêmea' : 'de sexo desconhecido') + '.', chaves: 'TOURO_LINHA|' + l.event_animal_id + '|SEXO|' + l.animal_id, event_id: l.event_id, animal_id: l.animal_id, resolver: RESOLVER_TOURO_LINHA });
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
   * A cria de um parto e outro filho da mesma mãe com o mesmo nascimento que não veio de parto (o bezerro da fotografia do
   * marco zero, da compra ou da outra entrada): é o mesmo animal cadastrado duas vezes — a cria do parto é sempre um animal
   * novo (04, seção 6: o inventário é exato a partir do marco zero). Gêmeos do mesmo parto são todos crias; gêmeos da
   * fotografia, nenhum. Um achado por par; no escopo da trava, as mães que estão nele (vizinhas de cada cria tocada).
   */
  function conferirCriaEmDobro_(tx, col, vale, alvo, nome) {
    if (!tx.repo.carregada('EVENTO_ANIMAIS')) return;
    var partoDa = {};
    tx.repo.vigentes('EVENTO_ANIMAIS').forEach(function (l) { if (l.papel === 'CRIA' && !partoDa[l.animal_id]) partoDa[l.animal_id] = l.event_id; });
    var filhos = {};
    Object.keys(vale).forEach(function (id) {
      var a = vale[id];
      if (vazio_(a.mae_id) || !Utils.dataValida(a.data_nascimento)) return;
      (filhos[a.mae_id] = filhos[a.mae_id] || []).push(a);
    });
    alvo.forEach(function (maeId) {
      var porDia = Utils.agruparPor(filhos[maeId] || [], 'data_nascimento');
      Object.keys(porDia).sort().forEach(function (dia) {
        var crias = porDia[dia].filter(function (a) { return partoDa[a.animal_id]; });
        var outros = porDia[dia].filter(function (a) { return !partoDa[a.animal_id]; });
        if (!crias.length || !outros.length) return;
        outros.forEach(function (o) {
          crias.forEach(function (c) {
            var ev = tx.repo.porId('EVENTOS', partoDa[c.animal_id]);
            col.achado('GENEALOGIA', {
              tabela: 'ANIMAIS', id: o.animal_id, campo: 'mae_id', event_id: partoDa[c.animal_id], animal_id: o.animal_id,
              mensagem: nome(c.animal_id) + ', a cria do parto de ' + br_(ev ? ev.event_date : dia) + ' (mãe ' + nome(maeId) + '), e ' + nome(o.animal_id) + ', que já estava no cadastro sem parto registrado, têm a mesma mãe e o mesmo nascimento: é o mesmo bezerro cadastrado duas vezes.',
              oque: nome(o.animal_id) + ', que já está no cadastro com a mesma mãe e o mesmo nascimento (' + br_(dia) + '), ficaria duas vezes no rebanho: a cria do parto de ' + br_(ev ? ev.event_date : dia) + ' é sempre um animal novo.',
              chaves: 'CRIA_EM_DOBRO|' + o.animal_id + '|' + c.animal_id, resolver: RESOLVER_CRIA_EM_DOBRO,
            });
          });
        });
      });
    });
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
      // O saldo de cada produto movimentado (PRODUTOS.estoque_atual* = Σ dos movimentos).
      var produtos = Object.keys(esc.produtos || {}).filter(function (id) { return !(cob.produtos && cob.produtos[id]); });
      if (!animais.length && !eventos.length && !produtos.length) return;
      alvo = { animais: animais, eventos: eventos, produtos: produtos };
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
        event_id: eventoDoRegistro_(tx, a.tabela, a.id), animal_id: a.tabela === 'ANIMAIS' ? a.id : null, fonte: a.fonte === true,
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
    // PESAGENS.tipo = o momento fixado pelo evento (03b, seção 2.4); a PESAGEM escolhe um dos seus momentos (conferirPesagens_
    // exige o mesmo em todas as linhas do lançamento).
    PESAGENS: { campo: 'tipo', esperado: function (ev) {
      if (ev.event_type === 'PESAGEM') return EventCatalog.MOMENTOS_PESAGEM;
      return { NASCIMENTO: 'NASCIMENTO', COMPRA: 'COMPRA', VENDA: 'VENDA', ENTRADA_INICIAL: 'ENTRADA', DESMAMA: 'DESMAMA' }[ev.event_type] || null;
    } },
    // SANIDADE.tipo_procedimento = o do subtipo (VACINACAO → VACINA ...); MOVIMENTOS_ESTOQUE.tipo = o subtipo do ESTOQUE
    // (ENTRADA, AJUSTE) ou SAIDA na sanidade (03b, seção 2.4).
    SANIDADE: { campo: 'tipo_procedimento', esperado: function (ev) { return ev.event_type === 'SANIDADE' ? HealthService.PROCEDIMENTO[ev.event_subtype] || null : null; } },
    MOVIMENTOS_ESTOQUE: { campo: 'tipo', esperado: function (ev) { return ev.event_type === 'ESTOQUE' ? ev.event_subtype : ev.event_type === 'SANIDADE' ? 'SAIDA' : null; } },
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
    { tabela: 'PESAGENS', quantos: 'UM', aplica: function (ev) { return ev.event_type === 'PESAGEM'; } },
    { tabela: 'SANIDADE', quantos: 'UM', aplica: function (ev) { return ev.event_type === 'SANIDADE'; } },
    // Reprodução: um registro por fêmea (a linha SUJEITO; o touro do lote não tem); desmama: um registro DESMAMA por mãe.
    { tabela: 'REPRODUCAO', quantos: 'UM', papel: 'SUJEITO', aplica: function (ev) { return ev.event_type === 'REPRODUCAO'; } },
    { tabela: 'REPRODUCAO', quantos: 'UM', papel: 'MATRIZ', aplica: function (ev) { return ev.event_type === 'DESMAMA'; } },
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
        Utils.unicos(repo.por('EVENTO_ANIMAIS', 'event_id', ev.event_id).filter(function (l) { return !d.papel || (vazio_(l.papel) ? 'SUJEITO' : l.papel) === d.papel; }).map(function (l) { return l.animal_id; })).forEach(function (id) {
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
    if (t === 'IDENTIFICACAO' || t === 'MARCACAO' || t === 'PESAGEM' || t === 'SANIDADE' || t === 'CASTRACAO' || t === 'OCORRENCIA') return { papeis: { SUJEITO: 0 }, pasto: false };
    // Reprodução: a fêmea (SUJEITO) e o touro do rebanho do lote ou da cobertura (TOURO); desmama: o bezerro (SUJEITO, que
    // com o pasto de destino vale como movimento: conferido em conferirReproducao_) e a mãe (MATRIZ). Todos com efeito 0.
    if (t === 'REPRODUCAO') return { papeis: { SUJEITO: 0, TOURO: 0 }, pasto: false };
    if (t === 'DESMAMA') return { papeis: { SUJEITO: 0, MATRIZ: 0 }, pasto: false };
    // ESTOQUE não tem animais: nenhuma linha (conferirInsumos_ acusa a que aparecer).
    if (t === 'ESTOQUE') return null;
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
      ['BAIXAS', 'AJUSTES', 'IDENTIFICACOES', 'PESAGENS', 'SANIDADE', 'REPRODUCAO'].forEach(function (t) {
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
   * As pesagens que cada evento grava (03b, seções 3.4 e 5; 05, seção 2.7), conferidas aqui para valerem em todo caminho
   * (registro, correção, estorno, importação; e na trava de integridade): peso vivo de 0,1 a 2.000 kg (RN-049) e uma linha
   * por animal no evento; na PESAGEM, o mesmo momento em todas as linhas, o peso copiado na linha do animal
   * (EVENTO_ANIMAIS.peso) e, na pesagem por lote, as cabeças = os animais do lançamento e cada linha com a média do lote
   * (total ÷ cabeças, 1 casa) e o método MEDIA_LOTE — sem as chaves do lote, nenhuma linha de média. Data e animal no
   * rebanho na data: COPIAS (data) e LINHA_DO_TEMPO (a linha do animal é um fato). Achados de COPIAS (a fonte quebrada).
   */
  function conferirPesagens_(tx, col, eventos) {
    var repo = tx.repo;
    if (!repo.carregada('PESAGENS')) return;
    var aviso = ' Restaure o backup ou investigue a edição manual; o reparo automático só refaz a situação a partir dos lançamentos.';
    var max = EventCatalog.PESO_MAX_KG;
    eventos.forEach(function (ev) {
      var linhas = repo.por('PESAGENS', 'event_id', ev.event_id);
      var nome = '"' + rotuloEvento_(ev) + '" de ' + br_(ev.event_date);
      var quem = function (id) { return rotuloAnimal_(tx.cru.cruPorId('ANIMAIS', id), id); };
      var achado = function (r, campo, oque, chave) {
        col.achado('COPIAS', { tabela: 'PESAGENS', id: r.weight_id, campo: campo, mensagem: oque + aviso, oque: oque, chaves: r.weight_id + '|' + chave, event_id: ev.event_id, animal_id: r.animal_id, lidaPelaCorrecao: chave === 'METODO' });
      };
      var semPesagem = function (l, oque) {
        col.achado('COPIAS', { tabela: 'EVENTO_ANIMAIS', id: l.event_animal_id, campo: 'peso', mensagem: oque + aviso, oque: oque, chaves: l.event_animal_id + '|SEM_PESAGEM', event_id: ev.event_id, animal_id: l.animal_id });
      };
      if (!linhas.length) { conferirPesoCopiado_(repo, ev, linhas, achado, nome, quem, semPesagem); return; }
      var porAnimal = {};
      linhas.forEach(function (r) {
        if (typeof r.peso_kg !== 'number' || !(r.peso_kg > 0) || r.peso_kg > max) achado(r, 'peso_kg', nome + ', ' + quem(r.animal_id) + ': a pesagem tem ' + (typeof r.peso_kg === 'number' ? Utils.formatarNumero(r.peso_kg) + ' kg' : 'peso vazio') + ', fora da faixa de peso vivo (de 0,1 a ' + Utils.formatarNumero(max) + ' kg).', 'FAIXA');
        if (porAnimal[r.animal_id]) achado(r, 'animal_id', nome + ', ' + quem(r.animal_id) + ': o animal tem mais de uma pesagem no mesmo lançamento.', 'REPETIDA');
        porAnimal[r.animal_id] = r;
      });
      // O método é do lançamento na pesagem e na desmama (03b, seção 2.6; CONTRATOS, seção 50.3): todas as linhas com o mesmo —
      // a linha mexida à mão é a fonte quebrada (a entrada da correção lê o método de uma linha e o espalharia às outras).
      if (METODO_DO_LANCAMENTO[ev.event_type]) {
        var metodo = maioria_(linhas, 'metodo');
        linhas.forEach(function (r) {
          if (nulo_(r.metodo) !== metodo) achado(r, 'metodo', nome + ', ' + quem(r.animal_id) + ': o método da pesagem (' + (r.metodo || 'vazio') + ') difere do das outras linhas do lançamento (' + (metodo || 'vazio') + '): o método é do lançamento.', 'METODO');
        });
      }
      if (ev.event_type !== 'PESAGEM') { conferirPesoCopiado_(repo, ev, linhas, achado, nome, quem, semPesagem); return; }
      var tipos = Utils.unicos(linhas.map(function (r) { return r.tipo; }));
      if (tipos.length > 1) linhas.slice(1).forEach(function (r) { if (r.tipo !== linhas[0].tipo) achado(r, 'tipo', nome + ', ' + quem(r.animal_id) + ': o momento da pesagem (' + r.tipo + ') difere do das outras linhas do lançamento (' + linhas[0].tipo + ').', 'MOMENTO'); });
      var ea = {};
      if (repo.carregada('EVENTO_ANIMAIS')) repo.por('EVENTO_ANIMAIS', 'event_id', ev.event_id).forEach(function (l) { ea[l.animal_id] = l; });
      linhas.forEach(function (r) {
        var l = ea[r.animal_id];
        if (l && typeof r.peso_kg === 'number' && l.peso !== r.peso_kg) achado(r, 'peso_kg', nome + ', ' + quem(r.animal_id) + ': a pesagem tem ' + Utils.formatarNumero(r.peso_kg) + ' kg, mas a linha do animal no lançamento diz ' + (typeof l.peso === 'number' ? Utils.formatarNumero(l.peso) + ' kg' : 'peso vazio') + '.', 'COPIA');
      });
      var pj = ev.payload_json || {};
      var lote = typeof pj.peso_total_lote_kg === 'number' || typeof pj.qtd_cabecas_lote === 'number';
      if (!lote) {
        linhas.forEach(function (r) { if (r.metodo === 'MEDIA_LOTE') achado(r, 'metodo', nome + ', ' + quem(r.animal_id) + ': a pesagem é "média do lote", mas o lançamento não tem o peso total nem as cabeças do lote.', 'SEM_LOTE'); });
        return;
      }
      var cabecas = Object.keys(ea).length;
      var media = typeof pj.peso_total_lote_kg === 'number' && typeof pj.qtd_cabecas_lote === 'number' && pj.qtd_cabecas_lote > 0 ? Utils.arredondar(pj.peso_total_lote_kg / pj.qtd_cabecas_lote, 1) : null;
      if (pj.qtd_cabecas_lote !== cabecas || media === null) {
        var oqueLote = nome + ': a pesagem por lote diz ' + (typeof pj.qtd_cabecas_lote === 'number' ? pj.qtd_cabecas_lote : 'sem número de') + ' cabeças' + (typeof pj.peso_total_lote_kg === 'number' ? ' e ' + Utils.formatarNumero(pj.peso_total_lote_kg) + ' kg' : ', sem o peso total') + ', mas o lançamento tem ' + cabecas + ' animais.';
        col.achado('COPIAS', { tabela: 'EVENTOS', id: ev.event_id, campo: 'payload_json', mensagem: oqueLote + aviso, oque: oqueLote, chaves: ev.event_id + '|LOTE', event_id: ev.event_id });
      }
      linhas.forEach(function (r) {
        if (typeof r.peso_kg !== 'number') return;
        if (r.metodo !== 'MEDIA_LOTE' || (media !== null && r.peso_kg !== media)) achado(r, r.metodo !== 'MEDIA_LOTE' ? 'metodo' : 'peso_kg', nome + ', ' + quem(r.animal_id) + ': na pesagem por lote cada animal fica com a média do lote' + (media !== null ? ' (' + Utils.formatarNumero(media, 1) + ' kg)' : '') + ', mas a linha tem ' + Utils.formatarNumero(r.peso_kg) + ' kg (' + r.metodo + ').', 'MEDIA');
      });
    });
  }
  /**
   * Os tipos que copiam o peso da linha do animal numa pesagem (03b, seção 5): o rebanho inicial, a outra entrada, a compra,
   * a venda (o peso do animal) e o nascimento (o da cria). A desmama tem a conferência dela (conferirReproducao_).
   */
  var METODO_DO_LANCAMENTO = Object.freeze({ PESAGEM: true, DESMAMA: true });
  /** O valor de `campo` que a maioria das linhas tem (no empate, o da primeira): a linha diferente dele é a mexida. */
  function maioria_(linhas, campo) {
    var n = {};
    var melhor = null;
    var nMelhor = 0;
    linhas.forEach(function (r) {
      var k = JSON.stringify(nulo_(r[campo]));
      n[k] = (n[k] || 0) + 1;
      if (n[k] > nMelhor) { nMelhor = n[k]; melhor = nulo_(r[campo]); }
    });
    return melhor;
  }
  var COPIAM_PESO = Object.freeze({ ENTRADA_INICIAL: ['SUJEITO'], OUTRA_ENTRADA: ['SUJEITO'], COMPRA: ['SUJEITO'], VENDA: ['SUJEITO'], NASCIMENTO: ['CRIA'] });
  /**
   * Nos tipos que copiam o peso (COPIAM_PESO), cada pesagem é a do peso da linha do animal no evento (EVENTO_ANIMAIS.peso):
   * o peso mexido à mão numa das duas e a pesagem apagada com o peso na linha são a fonte quebrada (achados de COPIAS, sem
   * reparo: o reparo adotaria o peso adulterado na curva, no GMD e no peso atual).
   */
  function conferirPesoCopiado_(repo, ev, linhas, achado, nome, quem, semPesagem) {
    var papeis = COPIAM_PESO[ev.event_type];
    if (!papeis || !repo.carregada('EVENTO_ANIMAIS')) return;
    var ea = {};
    repo.por('EVENTO_ANIMAIS', 'event_id', ev.event_id).forEach(function (l) { if (papeis.indexOf(vazio_(l.papel) ? 'SUJEITO' : l.papel) >= 0) ea[l.animal_id] = l; });
    var comPesagem = {};
    linhas.forEach(function (r) {
      comPesagem[r.animal_id] = true;
      var l = ea[r.animal_id];
      if (!l) return;
      if (typeof r.peso_kg === 'number' && l.peso !== r.peso_kg) achado(r, 'peso_kg', nome + ', ' + quem(r.animal_id) + ': a pesagem tem ' + Utils.formatarNumero(r.peso_kg) + ' kg, mas a linha do animal no lançamento diz ' + (typeof l.peso === 'number' ? Utils.formatarNumero(l.peso) + ' kg' : 'peso vazio') + '.', 'COPIA');
    });
    // A linha com peso sem a pesagem dele (o catálogo exige o método com o peso: o peso informado sempre vira pesagem).
    Object.keys(ea).forEach(function (id) {
      var l = ea[id];
      if (comPesagem[id] || typeof l.peso !== 'number') return;
      semPesagem(l, nome + ', ' + quem(id) + ': a linha do animal tem o peso de ' + Utils.formatarNumero(l.peso) + ' kg, mas o lançamento não tem a pesagem dele.');
    });
  }
  /**
   * A ordem de um evento no dia (desenho-base 16.1): {ordem_seq (a posição do primeiro da cadeia de substituição), event_seq};
   * pela linha do tempo quando há, senão pela cadeia de reversal_of_event_id nos eventos (crus, quando lidos). null sem o evento.
   */
  function ordemDoEvento_(tx, f) {
    return function (id) {
      if (f) { var e = f.evento(id); return e ? { ordem_seq: f.ordemSeq(id), event_seq: e.event_seq } : null; }
      var porId = function (x) { return tx.cru ? tx.cru.cruPorId('EVENTOS', x) : tx.repo.porId('EVENTOS', x); };
      var at = porId(id);
      if (!at) return null;
      var seq = at.event_seq;
      for (var g = 0; g < 10000 && !vazio_(at.reversal_of_event_id) && at.event_type !== 'ESTORNO'; g++) {
        var alvo = porId(at.reversal_of_event_id);
        if (!alvo || alvo.event_type !== at.event_type) break;
        at = alvo;
      }
      return { ordem_seq: at.event_seq, event_seq: seq };
    };
  }
  /**
   * Sanidade e estoque de insumos (03a, seções 4.6 e 4.7; 03b, seções 2.6, 6 e 15.2; 07, seção 5; desenho-base 16.9),
   * conferidos aqui para valerem em todo caminho (registro, correção, estorno, importação e a trava de integridade):
   *  - SANIDADE: uma linha por animal (DETALHE_OBRIGATORIO), o mesmo produto, nome e protocolo em todo o lançamento, o nome
   *    do produto nas vacinas, vermífugos e medicamentos, a doença sem produto nem dose, a dose conforme o modo do payload
   *    (por cabeça ou por peso: em todo animal; total: em nenhum), a unidade da dose = a do produto do cadastro, o último dia
   *    de carência = aplicação + dias, a cópia do custo = o que coube ao animal nos rateios do evento; o movimento de SAIDA
   *    do produto do cadastro = a quantidade consumida do payload (e nenhum sem produto); o consumo com custo unitário é
   *    exatamente um lançamento CUSTEIO sem parcela, com o produto, a quantidade e o valor = quantidade × custo congelado;
   *  - ESTOQUE: nenhuma linha de animal; na ENTRADA, um lançamento ESTOQUE_INSUMOS com o produto e a quantidade e no máximo
   *    um movimento de ENTRADA do mesmo produto, com a mesma quantidade e o custo unitário = valor ÷ quantidade (embalagens ×
   *    quantidade por embalagem = quantidade); no AJUSTE, exatamente um movimento de AJUSTE diferente de zero (negativo na
   *    perda e no vencimento) e nenhum lançamento;
   *  - nos demais tipos, nenhum movimento de estoque nem lançamento com produto.
   * O saldo (`PRODUTOS.estoque_atual*` = Σ dos movimentos) é projeção, conferido em PROJECAO. Achados de COPIAS (fonte).
   */
  /** Os achados da sanidade sobre o que a correção lê do original (o cabeçalho de uma linha, as doses, o lote da saída, o rateio). */
  var LIDAS_PELA_CORRECAO = /^(MESMO_|SOMA_DOSES$|BASE_DOSE$|SAIDA_LOTE$|RATEIO_MODO$)/;
  var CABECALHO_SANIDADE = Object.freeze(['produto_id', 'nome_produto', 'protocol_id', 'tipo_procedimento', 'fabricante', 'lote', 'validade', 'via_aplicacao', 'motivo', 'diagnostico', 'veterinario', 'periodo_carencia_dias', 'data_proxima_aplicacao']);
  var NOME_CABECALHO_SANIDADE = Object.freeze({ tipo_procedimento: 'procedimento', fabricante: 'fabricante', lote: 'lote', validade: 'validade do lote', via_aplicacao: 'via de aplicação', motivo: 'motivo', diagnostico: 'diagnóstico', veterinario: 'veterinário', periodo_carencia_dias: 'período de carência', data_proxima_aplicacao: 'dia da próxima aplicação' });
  function conferirInsumos_(tx, col, eventos, f) {
    var repo = tx.repo;
    var temMov = repo.carregada('MOVIMENTOS_ESTOQUE');
    var temSan = repo.carregada('SANIDADE');
    var temFin = repo.carregada('FINANCEIRO');
    var aviso = ' Restaure o backup ou investigue a edição manual; o reparo automático só refaz a situação a partir dos lançamentos.';
    var produto = function (id) { return vazio_(id) || !repo.carregada('PRODUTOS') ? null : repo.porId('PRODUTOS', id); };
    eventos.forEach(function (ev) {
      var nome = '"' + rotuloEvento_(ev) + '" de ' + br_(ev.event_date);
      var achado = function (tabela, id, campo, oque, chave, animal) {
        col.achado('COPIAS', { tabela: tabela, id: id, campo: campo, mensagem: oque + aviso, oque: oque, chaves: id + '|' + chave, event_id: ev.event_id, animal_id: animal || null, lidaPelaCorrecao: LIDAS_PELA_CORRECAO.test(chave) });
      };
      var movs = temMov ? repo.por('MOVIMENTOS_ESTOQUE', 'event_id', ev.event_id) : [];
      var fins = temFin ? repo.por('FINANCEIRO', 'event_id', ev.event_id) : [];
      var comProduto = fins.filter(function (f) { return !vazio_(f.product_id); });
      var pj = ev.payload_json || {};
      if (ev.event_type === 'SANIDADE') {
        var linhas = temSan ? repo.por('SANIDADE', 'event_id', ev.event_id) : [];
        if (!linhas.length) return;
        var r0 = linhas[0];
        var quem = function (r) { return rotuloAnimal_(tx.cru.cruPorId('ANIMAIS', r.animal_id), r.animal_id); };
        var cabecalho = {};
        CABECALHO_SANIDADE.forEach(function (c) { cabecalho[c] = maioria_(linhas, c); });
        linhas.forEach(function (r) {
          // O cabeçalho da aplicação (03b, seção 2.6) é copiado em cada linha: todas com o mesmo — a linha mexida à mão é a fonte
          // quebrada (a entrada da correção lê o cabeçalho da primeira linha e o espalharia às outras).
          CABECALHO_SANIDADE.forEach(function (c) {
            if (nulo_(r[c]) !== cabecalho[c]) achado('SANIDADE', r.health_id, c, nome + ', ' + quem(r) + ': ' + (c === 'produto_id' || c === 'nome_produto' || c === 'protocol_id' ? 'o produto ou o protocolo da linha difere do das outras linhas do lançamento (um lançamento é um procedimento com um produto).' : 'o ' + NOME_CABECALHO_SANIDADE[c] + ' da linha difere do das outras linhas do lançamento (é um dado do lançamento).'), 'MESMO_' + c, r.animal_id);
          });
          if (['VACINA', 'VERMIFUGO', 'MEDICAMENTO'].indexOf(r.tipo_procedimento) >= 0 && vazio_(r.nome_produto)) achado('SANIDADE', r.health_id, 'nome_produto', nome + ', ' + quem(r) + ': a aplicação está sem o nome do produto.', 'NOME', r.animal_id);
          if (r.tipo_procedimento === 'DOENCA' && (!vazio_(r.produto_id) || !vazio_(r.dose))) achado('SANIDADE', r.health_id, 'produto_id', nome + ', ' + quem(r) + ': o registro de doença tem produto ou dose, que ele não grava.', 'DOENCA', r.animal_id);
          var modo = pj.modo_dose;
          if ((modo === 'POR_CABECA' || modo === 'POR_PESO') && !(typeof r.dose === 'number' && r.dose > 0)) achado('SANIDADE', r.health_id, 'dose', nome + ', ' + quem(r) + ': a dose está vazia, mas o lançamento é por ' + (modo === 'POR_PESO' ? 'peso' : 'cabeça') + '.', 'DOSE', r.animal_id);
          if ((modo === 'TOTAL' || vazio_(modo)) && !vazio_(r.dose)) achado('SANIDADE', r.health_id, 'dose', nome + ', ' + quem(r) + ': a linha tem dose, mas o lançamento ' + (modo === 'TOTAL' ? 'só informa o total que saiu do frasco' : 'não tem modo de dose') + '.', 'DOSE_SEM_MODO', r.animal_id);
          var prod = produto(r.produto_id);
          if (prod && !vazio_(r.dose) && r.unidade_dose !== prod.unidade) achado('SANIDADE', r.health_id, 'unidade_dose', nome + ', ' + quem(r) + ': a dose está em "' + (r.unidade_dose || 'sem unidade') + '", mas o produto ' + prod.nome + ' é controlado em "' + prod.unidade + '".', 'UNIDADE', r.animal_id);
          var fim = HealthService.fimPeloPeriodo(r.data_aplicacao, r.periodo_carencia_dias);
          if (nulo_(r.data_fim_carencia) !== fim) achado('SANIDADE', r.health_id, 'data_fim_carencia', nome + ', ' + quem(r) + ': o fim da carência gravado (' + (vazio_(r.data_fim_carencia) ? 'vazio' : br_(r.data_fim_carencia)) + ') não é a aplicação mais os dias de carência (' + (fim ? br_(fim) : 'sem carência') + ').', 'CARENCIA', r.animal_id);
          // A próxima proposta pelo protocolo (payload `intervalo_protocolo_dias`, o intervalo congelado): aplicação + intervalo.
          if (typeof pj.intervalo_protocolo_dias === 'number' && (vazio_(r.protocol_id) || (pj.proxima_informada !== true && nulo_(r.data_proxima_aplicacao) !== Utils.somaDias(r.data_aplicacao, pj.intervalo_protocolo_dias)))) {
            achado('SANIDADE', r.health_id, 'data_proxima_aplicacao', nome + ', ' + quem(r) + ': a próxima aplicação gravada (' + (vazio_(r.data_proxima_aplicacao) ? 'vazia' : br_(r.data_proxima_aplicacao)) + ') não é a aplicação mais o intervalo do protocolo (' + pj.intervalo_protocolo_dias + ' dias).', 'PROXIMA', r.animal_id);
          }
          if (temFin && repo.carregada('RATEIOS') && repo.carregada('ALOCACOES_FINANCEIRAS')) {
            var alocado = null;
            fins.forEach(function (f) { repo.por('RATEIOS', 'financial_id', f.financial_id).forEach(function (rt) { repo.por('ALOCACOES_FINANCEIRAS', 'rateio_id', rt.rateio_id).forEach(function (al) { if (al.animal_id === r.animal_id) alocado = (alocado || 0) + (al.valor_alocado || 0); }); }); });
            if (nulo_(r.custo) !== alocado) achado('SANIDADE', r.health_id, 'custo', nome + ', ' + quem(r) + ': o custo copiado na aplicação (' + (vazio_(r.custo) ? 'vazio' : Utils.formatarReais(r.custo)) + ') difere do que coube ao animal no lançamento (' + (alocado === null ? 'nada' : Utils.formatarReais(alocado)) + ').', 'CUSTO', r.animal_id);
          }
        });
        // Aplicação anterior ao marco zero (o histórico sanitário importado): nem saída de estoque nem consumo — o estoque e o
        // custo do insumo começam no marco zero (EventService, consumo da sanidade).
        if (ev.pre_marco_zero === true) {
          movs.forEach(function (x) { achado('MOVIMENTOS_ESTOQUE', x.mov_id, 'event_id', nome + ': a aplicação é anterior ao marco zero e tem saída de estoque, que o registro histórico não grava.', 'HISTORICO_ESTOQUE'); });
          comProduto.forEach(function (f) { achado('FINANCEIRO', f.financial_id, 'product_id', nome + ': a aplicação é anterior ao marco zero e tem lançamento de consumo do produto, que o registro histórico não grava.', 'HISTORICO_CONSUMO'); });
          return;
        }
        if (!temMov) return;
        var q = pj.quantidade_consumida_total;
        if (vazio_(r0.produto_id)) {
          if (movs.length) achado('MOVIMENTOS_ESTOQUE', movs[0].mov_id, 'product_id', nome + ': há movimento de estoque, mas a aplicação não é de produto do cadastro.', 'SEM_PRODUTO');
        } else if (typeof q === 'number') {
          if (movs.length !== 1 || movs[0].product_id !== r0.produto_id || movs[0].quantidade !== q) achado('EVENTOS', ev.event_id, 'MOVIMENTOS_ESTOQUE', nome + ': a saída do estoque não confere com o consumo do lançamento (' + Utils.formatarNumero(q) + ' do produto, um movimento só).', 'SAIDA');
          else if (nulo_(movs[0].lote) !== nulo_(r0.lote) || nulo_(movs[0].validade) !== nulo_(r0.validade)) achado('MOVIMENTOS_ESTOQUE', movs[0].mov_id, 'lote', nome + ': o lote ou a validade da saída do estoque difere do da aplicação.', 'SAIDA_LOTE');
          // A quantidade que não foi informada é a soma das doses (o payload marca a informada: `quantidade_informada`): a dose
          // mexida à mão numa linha não fecha mais com a saída do frasco.
          if (pj.quantidade_informada === false && (pj.modo_dose === 'POR_CABECA' || pj.modo_dose === 'POR_PESO')) {
            var somaDoses = linhas.reduce(function (t, r) { return t + (typeof r.dose === 'number' ? Math.round(r.dose * 10000) : 0); }, 0) / 10000;
            if (somaDoses !== q) achado('EVENTOS', ev.event_id, 'payload_json', nome + ': a soma das doses dos animais (' + Utils.formatarNumero(somaDoses) + ') não é a quantidade que saiu do frasco (' + Utils.formatarNumero(q) + '), que não foi informada: a dose de alguma linha foi mexida.', 'SOMA_DOSES');
          }
        } else if (movs.length) achado('MOVIMENTOS_ESTOQUE', movs[0].mov_id, 'quantidade', nome + ': há saída de estoque, mas o lançamento não tem a quantidade consumida.', 'SEM_QUANTIDADE');
        if (!temFin) return;
        var mv = movs.length === 1 ? movs[0] : null;
        var valor = mv ? HealthService.valorConsumo(mv.quantidade, mv.custo_unitario) : 0;
        if (valor > 0) {
          var f0 = comProduto[0];
          if (comProduto.length !== 1 || f0.product_id !== r0.produto_id || f0.natureza !== 'CUSTEIO' || f0.valor !== valor || f0.quantidade !== mv.quantidade) {
            achado('EVENTOS', ev.event_id, 'FINANCEIRO', nome + ': o consumo do produto (' + Utils.formatarNumero(mv.quantidade) + ' × ' + Utils.formatarNumero(mv.custo_unitario) + ' = ' + Utils.formatarReais(valor) + ') não confere com o lançamento de consumo do evento.', 'CONSUMO');
          } else if (repo.carregada('RATEIOS') && repo.carregada('ALOCACOES_FINANCEIRAS')) {
            // O consumo da aplicação por peso é rateado pela dose de cada animal (03b, seção 15.2; 07, seção 5): a base de cada
            // um é a cópia da dose dele (o rateio MANUAL que o motor monta), conferida aqui — a verificação genérica da base do
            // rateio não recalcula o MANUAL.
            var doseDe = {};
            linhas.forEach(function (r) { doseDe[r.animal_id] = r.dose; });
            repo.por('RATEIOS', 'financial_id', f0.financial_id).forEach(function (rt) {
              var pelaDose = rt.criterio === 'MANUAL' && /^Proporcional à dose/.test(rt.justificativa || '');
              var porPeso = pj.modo_dose === 'POR_PESO' && linhas.length > 1 && linhas.every(function (r) { return typeof r.dose === 'number'; });
              if (pelaDose !== porPeso) achado('RATEIOS', rt.rateio_id, 'criterio', nome + ': o consumo está rateado ' + (pelaDose ? 'pela dose de cada animal' : 'por cabeça') + ', mas o lançamento é ' + (porPeso ? 'por peso (rateio pela dose)' : 'de dose por cabeça ou do total (rateio por cabeça)') + '.', 'RATEIO_MODO');
              if (!pelaDose) return;
              repo.por('ALOCACOES_FINANCEIRAS', 'rateio_id', rt.rateio_id).forEach(function (al) {
                if (al.base_valor !== doseDe[al.animal_id]) achado('ALOCACOES_FINANCEIRAS', al.alloc_id, 'base_valor', nome + ', ' + rotuloAnimal_(tx.cru.cruPorId('ANIMAIS', al.animal_id), al.animal_id) + ': a base do rateio do consumo (' + al.base_valor + ') não é a dose do animal na aplicação (' + (typeof doseDe[al.animal_id] === 'number' ? Utils.formatarNumero(doseDe[al.animal_id]) : 'vazia') + ').', 'BASE_DOSE', al.animal_id);
              });
            });
          }
        } else if (comProduto.length) achado('FINANCEIRO', comProduto[0].financial_id, 'product_id', nome + ': há lançamento de consumo, mas a saída do estoque não tem custo.', 'CONSUMO_SEM_CUSTO');
        return;
      }
      if (ev.event_type === 'ESTOQUE') {
        if (repo.carregada('EVENTO_ANIMAIS') && repo.por('EVENTO_ANIMAIS', 'event_id', ev.event_id).length) achado('EVENTOS', ev.event_id, 'EVENTO_ANIMAIS', nome + ': o lançamento de estoque tem linhas de animais, que ele não grava.', 'ANIMAIS');
        if (!temMov || !temFin) return;
        if (ev.event_subtype === 'ENTRADA') {
          var fe = fins[0];
          if (fins.length !== 1 || fe.natureza !== 'ESTOQUE_INSUMOS' || vazio_(fe.product_id) || !(fe.quantidade > 0)) { achado('EVENTOS', ev.event_id, 'FINANCEIRO', nome + ': a entrada de insumo precisa de um lançamento de compra de insumos com o produto e a quantidade.', 'COMPRA'); return; }
          if (typeof pj.qtd_apresentacao === 'number' && (typeof pj.fator_conversao !== 'number' || Utils.arredondar(pj.qtd_apresentacao * pj.fator_conversao, 4) !== fe.quantidade)) achado('EVENTOS', ev.event_id, 'payload_json', nome + ': as embalagens × a quantidade por embalagem não dão a quantidade comprada.', 'EMBALAGENS');
          if (movs.length > 1) achado('EVENTOS', ev.event_id, 'MOVIMENTOS_ESTOQUE', nome + ': a entrada tem ' + movs.length + ' movimentos; precisa ter um só.', 'VARIAS');
          // O payload congela se a compra tem o movimento de entrada (`com_movimento`; sem o campo, a entrada anterior a ele
          // vale com ou sem): a que tinha e não tem mais foi apagada à mão, e o saldo não pode ser refeito sem ela.
          if (pj.com_movimento === true && !movs.length) achado('EVENTOS', ev.event_id, 'MOVIMENTOS_ESTOQUE', nome + ': a compra de ' + Utils.formatarNumero(fe.quantidade) + ' do produto foi gravada com o movimento de entrada no estoque, que não está mais na planilha.', 'ENTRADA_SEM_MOVIMENTO');
          if (pj.com_movimento === false && movs.length) achado('MOVIMENTOS_ESTOQUE', movs[0].mov_id, 'event_id', nome + ': a compra foi gravada sem movimento de entrada (o produto não controlava estoque), mas há um na planilha.', 'ENTRADA_ALHEIA');
          movs.forEach(function (x) {
            if (x.product_id !== fe.product_id || x.quantidade !== fe.quantidade || x.custo_unitario !== HealthService.custoUnitarioEntrada(fe.valor, fe.quantidade)) achado('MOVIMENTOS_ESTOQUE', x.mov_id, 'quantidade', nome + ': o movimento de entrada não confere com a compra (produto, quantidade e custo unitário = valor ÷ quantidade).', 'ENTRADA');
          });
        } else {
          if (fins.length) achado('FINANCEIRO', fins[0].financial_id, 'event_id', nome + ': o acerto de estoque tem lançamento financeiro, que ele não grava.', 'AJUSTE_FIN');
          if (movs.length !== 1 || !(typeof movs[0].quantidade === 'number' && movs[0].quantidade !== 0)) achado('EVENTOS', ev.event_id, 'MOVIMENTOS_ESTOQUE', nome + ': o acerto de estoque precisa de exatamente um movimento diferente de zero.', 'AJUSTE');
          else if ((pj.motivo_ajuste === 'PERDA' || pj.motivo_ajuste === 'VENCIMENTO') && movs[0].quantidade > 0) achado('MOVIMENTOS_ESTOQUE', movs[0].mov_id, 'quantidade', nome + ': a perda ou o vencimento aumenta o estoque no movimento gravado.', 'SINAL');
          else if (pj.motivo_ajuste === 'CONTAGEM' && typeof pj.saldo_contado === 'number') {
            // O acerto pela contagem: no fim do dia contado, o saldo dos movimentos vigentes é o contado (03a, MOVIMENTOS_ESTOQUE,
            // AJUSTE). O movimento até aquele dia gravado depois (ou mexido à mão) desfaz o que foi contado. O motor recusa o
            // comando que faria isso (CONTAGEM_POSTERIOR); aqui vale para todo caminho. Não é a fonte apagada: o caminho é
            // estornar a contagem e contar de novo (a chave leva o saldo, para a trava recusar também o que piora).
            var pc = produto(movs[0].product_id) || {};
            // O saldo na posição da contagem no dia (11: a ordem dentro do dia é a de registro; o movimento do mesmo dia
            // gravado depois da contagem não desfaz o que foi contado).
            var ordem = ordemDoEvento_(tx, f);
            var oc = ordem(ev.event_id);
            var naData = HealthService.saldoNaPosicao(HealthService.movimentosDoProduto(repo, movs[0].product_id, null), { data: ev.event_date, ordem_seq: oc ? oc.ordem_seq : null, event_seq: oc ? oc.event_seq : null }, ordem);
            if (naData !== pj.saldo_contado) {
              var oqueC = 'A contagem de ' + br_(ev.event_date) + ' de ' + (pc.nome || 'insumo') + ' (' + HealthService.quantidadeTexto(pj.saldo_contado, pc.unidade) + ' contados) não confere com o saldo do sistema no fim daquele dia (' +
                HealthService.quantidadeTexto(naData, pc.unidade) + '): há movimento até aquele dia gravado depois da contagem.';
              col.achado('COPIAS', { tabela: 'MOVIMENTOS_ESTOQUE', id: movs[0].mov_id, campo: 'quantidade', mensagem: oqueC + ' Estorne a contagem e conte de novo.', oque: oqueC, chaves: movs[0].mov_id + '|CONTAGEM|' + naData, event_id: ev.event_id, fonte: false,
                resolver: 'Estorne antes a contagem de ' + br_(ev.event_date) + ' (ela acertou o saldo daquele dia), grave o lançamento e conte de novo.' });
            }
          }
        }
        return;
      }
      movs.forEach(function (x) { achado('MOVIMENTOS_ESTOQUE', x.mov_id, 'event_id', nome + ': o lançamento tem movimento de estoque, que esse tipo não grava.', 'ALHEIO'); });
      comProduto.forEach(function (f) { achado('FINANCEIRO', f.financial_id, 'product_id', nome + ': o lançamento financeiro cita um produto, que esse tipo não grava.', 'PRODUTO_ALHEIO'); });
    });
  }
  /**
   * Reprodução e desmama (03b, seções 3.3, 3.4, 7.1, 7.2 e 16.14), conferidas aqui para valerem em todo caminho (registro,
   * correção, estorno, importação e a trava de integridade):
   *  - REPRODUCAO: cada registro com as colunas do seu tipo (matriz da seção 7.2: a retirada só na exposição e não antes
   *    dela; o sêmen só na inseminação; o resultado só e sempre no diagnóstico; a idade da gestação só no diagnóstico
   *    positivo e no aborto, de 1 dia em diante (a duração da gestação é parâmetro: a faixa fica no motor); a previsão informada só no diagnóstico positivo e depois dele; o
   *    touro nunca no diagnóstico nem no aborto; nada do parto), o mesmo cabeçalho (retirada, estação, touro, sêmen e
   *    método) em todos os registros do lançamento, e o touro coerente com as linhas TOURO: na exposição, o único touro do
   *    lote (ou nenhum, com vários); na cobertura, no máximo um, que é o touro do registro; nos demais, nenhuma linha TOURO;
   *  - DESMAMA: cada mãe (linha MATRIZ) é a mãe de um bezerro do lançamento, com o registro DESMAMA vazio (nenhuma coluna
   *    de outro tipo); nenhum registro reprodutivo de bezerro; a linha do bezerro com o pasto de origem e o de destino
   *    juntos ou nenhum, e a pesagem DESMAMA (no máximo uma) com o peso da linha do animal.
   * Achados de COPIAS (a fonte quebrada: o reparo refaria a situação a partir do dado quebrado).
   */
  var CABECALHO_REPRODUCAO = Object.freeze(['data_fim', 'estacao_id', 'touro_id', 'semen_identificacao', 'metodo']);
  function conferirReproducao_(tx, col, eventos, proj) {
    var repo = tx.repo;
    if (!repo.carregada('REPRODUCAO') || !repo.carregada('EVENTO_ANIMAIS')) return;
    var aviso = ' Restaure o backup ou investigue a edição manual; o reparo automático só refaz a situação a partir dos lançamentos.';
    // A idade da gestação acima de `dias_gestacao` é regra do lançamento (o motor), não da integridade: o parâmetro muda
    // depois, e o diagnóstico legítimo de antes não pode virar "fonte quebrada" (trava única; a decisão do reuso de brinco).
    eventos.forEach(function (ev) {
      if (ev.event_type !== 'REPRODUCAO' && ev.event_type !== 'DESMAMA') return;
      var nome = '"' + rotuloEvento_(ev) + '" de ' + br_(ev.event_date);
      var quem = function (id) { return rotuloAnimal_(tx.cru.cruPorId('ANIMAIS', id), id); };
      var achado = function (tabela, id, campo, oque, chave, animal) {
        col.achado('COPIAS', { tabela: tabela, id: id, campo: campo, mensagem: oque + aviso, oque: oque, chaves: id + '|' + chave, event_id: ev.event_id, animal_id: animal || null });
      };
      var regs = repo.por('REPRODUCAO', 'event_id', ev.event_id);
      var linhas = repo.por('EVENTO_ANIMAIS', 'event_id', ev.event_id);
      var papel = function (l) { return vazio_(l.papel) ? 'SUJEITO' : l.papel; };
      if (ev.event_type === 'REPRODUCAO') {
        var sub = ev.event_subtype;
        var touros = linhas.filter(function (l) { return papel(l) === 'TOURO'; }).map(function (l) { return l.animal_id; });
        regs.forEach(function (r, i) {
          var falta = function (campo, oque) { achado('REPRODUCAO', r.reproduction_id, campo, nome + ', ' + quem(r.animal_id) + ': ' + oque, 'COLUNA_' + campo, r.animal_id); };
          if (!vazio_(r.data_fim) && (sub !== 'EXPOSICAO' || r.data_fim < r.data)) falta('data_fim', sub !== 'EXPOSICAO' ? 'o registro tem a retirada dos touros, que só existe na exposição.' : 'a retirada dos touros (' + br_(r.data_fim) + ') é anterior ao início da exposição.');
          if (!vazio_(r.semen_identificacao) && sub !== 'INSEMINACAO') falta('semen_identificacao', 'o registro tem a identificação do sêmen, que só existe na inseminação.');
          if ((sub === 'DIAGNOSTICO_GESTACAO') !== !vazio_(r.resultado)) falta('resultado', sub === 'DIAGNOSTICO_GESTACAO' ? 'o diagnóstico está sem o resultado.' : 'o registro tem resultado de diagnóstico, que ele não grava.');
          var comIdade = sub === 'ABORTO' || (sub === 'DIAGNOSTICO_GESTACAO' && r.resultado === 'POSITIVO');
          if (!vazio_(r.idade_gestacional_dias) && (!comIdade || !(r.idade_gestacional_dias >= 1))) falta('idade_gestacional_dias', comIdade ? 'a idade da gestação (' + r.idade_gestacional_dias + ' dias) está fora da faixa (de 1 dia em diante).' : 'o registro tem idade da gestação, que só existe no diagnóstico positivo e no aborto.');
          if (!vazio_(r.data_prevista_parto) && (sub !== 'DIAGNOSTICO_GESTACAO' || r.resultado !== 'POSITIVO' || r.data_prevista_parto <= r.data)) falta('data_prevista_parto', sub === 'DIAGNOSTICO_GESTACAO' && r.resultado === 'POSITIVO' ? 'a previsão de parto informada (' + br_(r.data_prevista_parto) + ') não é depois do diagnóstico.' : 'o registro tem previsão de parto, que só o diagnóstico positivo informa.');
          if (!vazio_(r.touro_id) && (sub === 'DIAGNOSTICO_GESTACAO' || sub === 'ABORTO')) falta('touro_id', 'o registro tem touro, que o diagnóstico e o aborto não gravam.');
          ['qtd_nascidos_vivos', 'qtd_natimortos', 'tipo_parto', 'data_parto'].forEach(function (c) { if (!vazio_(r[c])) falta(c, 'o registro tem dado de parto, que só o nascimento grava.'); });
          if (i > 0) CABECALHO_REPRODUCAO.forEach(function (c) {
            if (nulo_(r[c]) !== nulo_(regs[0][c])) falta(c, 'o cabeçalho do registro (retirada, estação, touro, sêmen ou método) difere do das outras fêmeas do lançamento.');
          });
        });
        var r0 = regs[0];
        if (r0) {
          var oqueTouro = null;
          if (sub === 'EXPOSICAO' && nulo_(r0.touro_id) !== (touros.length === 1 ? touros[0] : null)) oqueTouro = 'o touro do registro não é o touro do lote (com um touro só, é ele; com vários, nenhum).';
          if (sub === 'COBERTURA' && (touros.length > 1 || (touros.length === 1 && touros[0] !== r0.touro_id))) oqueTouro = 'o touro do rebanho na cobertura (linha do touro) não é o touro do registro.';
          if (sub !== 'EXPOSICAO' && sub !== 'COBERTURA' && touros.length) oqueTouro = 'o lançamento tem linha de touro, que só a exposição e a cobertura gravam.';
          if (oqueTouro) achado('EVENTOS', ev.event_id, 'touro_id', nome + ': ' + oqueTouro, 'TOURO');
        }
        return;
      }
      // DESMAMA
      var bezerros = linhas.filter(function (l) { return papel(l) === 'SUJEITO'; });
      var maes = {};
      bezerros.forEach(function (l) {
        // A mãe do bezerro pela reconstrução (a criação e as correções de cadastro vigentes), não pela célula da projeção
        // gravada em ANIMAIS: a projeção mexida à mão é achado de PROJECAO (o reparo refaz), não fonte quebrada.
        var b = proj ? proj(l.animal_id).campos : tx.cru.cruPorId('ANIMAIS', l.animal_id);
        if (b && !vazio_(b.mae_id)) maes[b.mae_id] = true;
        if (vazio_(l.pasto_origem_id) !== vazio_(l.pasto_destino_id)) achado('EVENTO_ANIMAIS', l.event_animal_id, 'pasto_destino_id', nome + ', ' + quem(l.animal_id) + ': a linha do bezerro tem só um dos pastos (origem e destino vão juntos, quando a desmama muda o pasto).', 'PASTOS', l.animal_id);
        var ps = repo.carregada('PESAGENS') ? repo.por('PESAGENS', 'event_id', ev.event_id).filter(function (p) { return p.animal_id === l.animal_id; }) : [];
        if (ps.length > 1 || (ps.length === 1 && ps[0].peso_kg !== l.peso) || (!ps.length && typeof l.peso === 'number')) achado('EVENTO_ANIMAIS', l.event_animal_id, 'peso', nome + ', ' + quem(l.animal_id) + ': o peso à desmama da linha do bezerro não confere com a pesagem da desmama.', 'PESO', l.animal_id);
      });
      linhas.filter(function (l) { return papel(l) === 'MATRIZ'; }).forEach(function (l) {
        if (!maes[l.animal_id]) {
          var oqueMae = nome + ': ' + quem(l.animal_id) + ' está como mãe, mas não é a mãe de nenhum bezerro desmamado no lançamento.';
          // O caminho que funciona quando a mãe do bezerro é trocada por correção de cadastro (a desmama registra a mãe).
          col.achado('COPIAS', { tabela: 'EVENTO_ANIMAIS', id: l.event_animal_id, campo: 'animal_id', mensagem: oqueMae + aviso, oque: oqueMae, chaves: l.event_animal_id + '|MAE', event_id: ev.event_id, animal_id: l.animal_id,
            resolver: 'Estorne antes a desmama de ' + br_(ev.event_date) + ' (ela registra a mãe do bezerro), troque a mãe e lance a desmama de novo.' });
        }
      });
      var comLinhaMae = {};
      linhas.forEach(function (l) { if (papel(l) === 'MATRIZ') comLinhaMae[l.animal_id] = true; });
      regs.forEach(function (r) {
        if (!comLinhaMae[r.animal_id]) achado('REPRODUCAO', r.reproduction_id, 'animal_id', nome + ': o registro de desmama está em ' + quem(r.animal_id) + ', que não é a mãe no lançamento.', 'DESMAMA_FORA', r.animal_id);
        var cheias = ['data_fim', 'estacao_id', 'touro_id', 'semen_identificacao', 'metodo', 'resultado', 'idade_gestacional_dias', 'qtd_nascidos_vivos', 'qtd_natimortos', 'tipo_parto', 'data_prevista_parto', 'data_parto'].filter(function (c) { return !vazio_(r[c]); });
        if (cheias.length) achado('REPRODUCAO', r.reproduction_id, cheias[0], nome + ', ' + quem(r.animal_id) + ': o registro de desmama tem dados de outro tipo de registro reprodutivo.', 'DESMAMA_COLUNAS', r.animal_id);
      });
    });
  }
  /**
   * Cópias × fonte (06, seção 9): a fonte de cada evento, o detalhe obrigatório, o tipo da linha de detalhe = o do evento e
   * a data do detalhe = a do evento. No escopo, os eventos dele.
   */
  function conferirCopias_(tx, col, esc, proj, f) {
    col.aplicar('COPIAS');
    var repo = tx.repo;
    if (!repo.carregada('EVENTOS')) return;
    var eventos = esc ? Utils.unicos(Object.keys(esc.eventos).concat(Object.keys(esc.fonte || {}))).map(function (id) { return repo.porId('EVENTOS', id); }).filter(Boolean) : repo.vigentes('EVENTOS');
    conferirLinhasDosEventos_(tx, col, eventos);
    conferirDetalhes_(tx, col, eventos);
    conferirPesagens_(tx, col, eventos);
    conferirInsumos_(tx, col, eventos, f);
    conferirReproducao_(tx, col, eventos, proj);
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
        if (Array.isArray(esperado) ? esperado.indexOf(r[def.campo]) >= 0 : r[def.campo] === esperado) return;
        var texto = Array.isArray(esperado) ? esperado.slice(0, -1).join(', ') + ' ou ' + esperado[esperado.length - 1] : esperado;
        col.achado('COPIAS', { tabela: t, id: r[Schema.pk(t)], campo: def.campo, mensagem: t + ': o tipo ' + (r[def.campo] || 'vazio') + ' não corresponde a "' + rotuloEvento_(ev) + '"' + (esperado ? ' (esperado ' + texto + ')' : ', que não grava essa linha') + '.', chaves: r[Schema.pk(t)] + '|TIPO', event_id: ev.event_id, animal_id: r.animal_id });
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
    var fontes = 0;
    var checagens = CHECAGENS.map(function (c) {
      var x = r.por[c.codigo];
      var temErro = !!x.severidades.ERRO;
      var situacao = !x.aplicada ? 'NAO_EXECUTADA' : !x.n ? 'OK' : temErro ? 'ERRO' : 'ALERTA';
      if (situacao === 'ERRO' && c.reparo) reparavel = true;
      fontes += x.fonte;
      return { codigo: c.codigo, rotulo: c.rotulo, severidade: c.severidade, situacao: situacao, achados: x.n, correcao: c.correcao, reparo: c.reparo || null };
    });
    // O reparo refaz a situação pelos lançamentos; com a fonte deles quebrada, ele gravaria o defeito como certo.
    var impedido = reparavel && fontes ? 'Não dá para reparar: ' + (fontes === 1 ? 'um achado mostra' : fontes + ' achados mostram') + ' linhas apagadas ou mexidas à mão na planilha (os que pedem para restaurar o backup), e o reparo refaria a situação a partir delas, como se estivessem certas. Restaure o backup ou investigue a edição manual antes.' : null;
    if (impedido) reparavel = false;
    Object.keys(r.por).forEach(function (k) {
      var x = r.por[k];
      if (!x.n) return;
      if (x.severidades.ERRO) erros += x.n; else alertas += x.n;
    });
    return {
      gerado_em: tx.agora, banco: tx.ctx.banco, data_version: tx.dataVersion, ok: erros === 0, erros: erros, alertas: alertas,
      reparavel: reparavel, reparo_impedido: impedido, abas_ausentes: estrutura.ausentes.slice(), checagens: checagens, achados: r.lista, truncado: r.truncado,
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
    if (antes.reparo_impedido) throw Validation.erro('CONFLICT', antes.reparo_impedido);
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
    return Utils.unicos(Timeline.LEITURAS.concat(['CATEGORIAS', 'PLANO_CONTAS', 'COMPRAS', 'VENDAS', 'BAIXAS', 'PROPRIEDADES', 'PARCEIROS', 'ANEXOS', 'IMPORTACOES', 'OPERACOES', 'ESTACOES_MONTA'], EventCatalog.LEITURAS_INSUMOS));
  }
  /**
   * O que o comando toca, pelo plano (sem ler a planilha): linhas novas (`lote`: {ABA: [registros]}), mudanças de
   * auditoria (`mudancas`, na forma da lógica) e o escopo das projeções (`derivados`). Devolve as sementes do escopo:
   * {animais, eventos, lancamentos, importacoes, categorias, contas, parcelas: {id: true}, linhas: [{tabela, id}], tudo,
   * dominio} — `dominio` = a trava lê as abas das checagens (`leiturasTrava`); sem ele, só as linhas citadas (a chave
   * estrangeira delas, com o que o comando já leu).
   */
  function sementesDaTrava(lote, mudancas, derivados) {
    var s = { animais: {}, eventos: {}, lancamentos: {}, importacoes: {}, categorias: {}, contas: {}, parcelas: {}, produtos: {}, linhas: [], tudo: false, dominio: false };
    var marcar = function (tipo, id) { if (!vazio_(id)) { s[tipo][String(id)] = true; s.dominio = true; } };
    var linha = function (tabela, id) { if (!vazio_(id)) s.linhas.push({ tabela: tabela, id: String(id) }); };
    Object.keys(lote || {}).forEach(function (t) {
      (lote[t] || []).forEach(function (r) {
        linha(t, r[Schema.pk(t)]); // a chave estrangeira de toda linha que o comando grava
        if (t === 'EVENTOS') { marcar('eventos', r.event_id); marcar('eventos', r.reversal_of_event_id); return; }
        if (t === 'ANIMAIS') { marcar('animais', r.animal_id); return; }
        if (t === 'EVENTO_ANIMAIS' || DETALHES_COM_ANIMAL.indexOf(t) >= 0) { marcar('animais', r.animal_id); marcar('eventos', r.event_id); if (t === 'REPRODUCAO') marcar('animais', r.touro_id); return; }
        if (t === 'COMPRAS' || t === 'VENDAS') { marcar('eventos', r.event_id); return; }
        if (t === 'MOVIMENTOS_ESTOQUE') { marcar('eventos', r.event_id); marcar('produtos', r.product_id); return; }
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
      if (e === 'PRODUTOS') { linha(e, m.entity_id); marcar('produtos', m.entity_id); return; }
      linha(e, m.entity_id);
    });
    if (derivados) {
      s.dominio = true;
      (derivados.animais || []).forEach(function (id) { marcar('animais', id); });
      (derivados.eventos || []).forEach(function (id) { marcar('eventos', id); });
      (derivados.produtos || []).forEach(function (id) { marcar('produtos', id); });
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
    var esc = { animais: {}, genealogia: {}, eventos: {}, eventosGravados: {}, eventosImportados: {}, lancamentos: {}, produtos: {}, linhas: s.linhas.slice(), brincos: {}, fonte: {} };
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
    Object.keys(s.produtos || {}).forEach(function (id) { esc.produtos[id] = true; });
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
      else if (u.tabela === 'PRODUTOS') esc.produtos[u.id] = true;
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
      linhasPor('MOVIMENTOS_ESTOQUE', 'event_id', eid).forEach(function (x) { esc.produtos[x.product_id] = true; });
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
      // A fonte dos eventos do animal tocado (COPIAS): as linhas dele e os detalhes que o citam. Com a fonte quebrada à mão,
      // o projetor refaria a situação do animal a partir dela (a vaca morta sem a linha da morte voltaria ao rebanho).
      linhasPor('EVENTO_ANIMAIS', 'animal_id', id).forEach(function (l) { esc.fonte[l.event_id] = true; });
      DETALHES_COM_ANIMAL.forEach(function (tab) { linhasPor(tab, 'animal_id', id).forEach(function (r) { if (!vazio_(r.event_id)) esc.fonte[r.event_id] = true; }); });
    });
    // A fonte do saldo de cada produto tocado (o estoque é projeção dos movimentos): os eventos que o movimentam, o consomem
    // ou o aplicam. A saída apagada à mão é achada pela aplicação dela; o comando que regravaria o saldo é recusado.
    Object.keys(esc.produtos).forEach(function (pid) {
      linhasPor('MOVIMENTOS_ESTOQUE', 'product_id', pid).forEach(function (x) { esc.fonte[x.event_id] = true; });
      linhasPor('FINANCEIRO', 'product_id', pid).forEach(function (f) { if (!vazio_(f.event_id)) esc.fonte[f.event_id] = true; });
      linhasPor('SANIDADE', 'produto_id', pid).forEach(function (r) { esc.fonte[r.event_id] = true; });
    });
    return esc;
  }
  /**
   * Fonte quebrada à mão (COPIAS, FILHAS_SEM_PAI, parcela apagada ou cancelada: os achados `fonte`): refazer a situação do
   * que ela cita — o animal, os animais do evento, o lançamento — a partir do dado quebrado é o mesmo que o reparo
   * RECONSTRUIR, que a verificação recusa (06, seções 9 e 12; RN-112). O comando que lança para o que a fonte quebrada
   * cita (as linhas dele tocam o animal, o evento ou o lançamento) é recusado; o que só o alcança pela reconstrução (a
   * conclusão de uma importação, um parâmetro) segue sem regravar a situação dele: o registro fica em quarentena, como
   * está, e a verificação continua acusando. Devolve {diretos: [achados], quarentena: {ABA\u0000id: true}}.
   */
  function fonteTocada_(achados, t, esc) {
    var out = { diretos: [], quarentena: {} };
    var quebrados = achados.filter(function (a) { return a.severidade === 'ERRO' && a.fonte; });
    if (!quebrados.length) return out;
    var s = t.sementes;
    // O que o comando lança: os animais, eventos e lançamentos das linhas dele e os eventos importados que ele faz valer.
    var lanca = { animais: Object.assign({}, s.animais), eventos: Object.assign({}, s.eventos) };
    var regrava = {};
    (t.projecoes || []).forEach(function (u) { regrava[u.tabela + '\u0000' + u.id] = true; });
    var cru = t.antes.cru;
    var carregada = function (tab) { return t.antes.repo.carregada(tab); };
    var animaisDoEvento = function (eid) {
      var ids = [];
      ['EVENTO_ANIMAIS'].concat(DETALHES_COM_ANIMAL).forEach(function (tab) { if (carregada(tab)) cru.cruPor(tab, 'event_id', eid).forEach(function (r) { if (!vazio_(r.animal_id)) ids.push(r.animal_id); }); });
      return ids;
    };
    // Os eventos importados que passam a valer (a conclusão); os que deixam de valer (o desfazer) não lançam nada.
    Object.keys((esc && esc.eventosImportados) || {}).forEach(function (eid) {
      if (!t.depois.repo.eventoVigente(eid)) return;
      lanca.eventos[eid] = true;
      animaisDoEvento(eid).forEach(function (id) { lanca.animais[id] = true; });
    });
    quebrados.forEach(function (a) {
      var registros = [];
      var animais = [];
      if (!vazio_(a.animal_id)) animais.push(a.animal_id);
      if (!vazio_(a.event_id)) animais = animais.concat(animaisDoEvento(a.event_id));
      animais.forEach(function (id) { registros.push('ANIMAIS\u0000' + id); });
      var fin = a.tabela === 'FINANCEIRO' ? a.id : a.tabela === 'PARCELAS' && carregada('PARCELAS') ? (cru.cruPorId('PARCELAS', a.id) || {}).financial_id : null;
      if (!vazio_(fin)) registros.push('FINANCEIRO\u0000' + fin);
      // O saldo do insumo (PRODUTOS.estoque_atual, Fase 3) é projeção como a do animal: o produto do movimento, do consumo ou
      // da aplicação citados pelo achado entra na quarentena, e o comando que movimenta o produto é recusado.
      var produtos = produtosDoAchado_(a, cru, carregada);
      produtos.forEach(function (pid) { registros.push('PRODUTOS\u0000' + pid); });
      var tocados = registros.filter(function (k) { return regrava[k]; });
      if (!tocados.length) return;
      var direto = animais.some(function (id) { return lanca.animais[id]; }) || (!vazio_(a.event_id) && lanca.eventos[a.event_id]) || (!vazio_(fin) && s.lancamentos[fin]) ||
        produtos.some(function (pid) { return s.produtos && s.produtos[pid]; });
      if (direto && !s.tudo) out.diretos.push(a);
      else tocados.forEach(function (k) { out.quarentena[k] = true; });
    });
    return out;
  }
  /** Os produtos de um achado da fonte quebrada: o próprio, o do movimento, e os dos movimentos, lançamentos e aplicações do evento. */
  function produtosDoAchado_(a, cru, carregada) {
    var ids = [];
    var mais = function (tab, campo, chave, valor) { if (carregada(tab)) cru.cruPor(tab, chave, valor).forEach(function (r) { if (!vazio_(r[campo])) ids.push(r[campo]); }); };
    if (a.tabela === 'PRODUTOS') ids.push(a.id);
    if (a.tabela === 'MOVIMENTOS_ESTOQUE' && carregada('MOVIMENTOS_ESTOQUE')) { var mv = cru.cruPorId('MOVIMENTOS_ESTOQUE', a.id); if (mv && !vazio_(mv.product_id)) ids.push(mv.product_id); }
    if (a.tabela === 'FINANCEIRO' && carregada('FINANCEIRO')) { var f = cru.cruPorId('FINANCEIRO', a.id); if (f && !vazio_(f.product_id)) ids.push(f.product_id); }
    if (!vazio_(a.event_id)) {
      mais('MOVIMENTOS_ESTOQUE', 'product_id', 'event_id', a.event_id);
      mais('FINANCEIRO', 'product_id', 'event_id', a.event_id);
      mais('SANIDADE', 'produto_id', 'event_id', a.event_id);
    }
    return Utils.unicos(ids);
  }
  /**
   * O que o lote grava (para a trava dizer se o problema é do próprio lançamento): {eventos, linhas: {ABA\u0000id: true},
   * brincos: {id: true} (os animais novos e as identificações que ele grava, com os animais delas)}. Usado pela UnitOfWork
   * e pelo ensaio da importação.
   */
  function propriosDoLote(lote) {
    var out = { eventos: {}, linhas: {}, brincos: {} };
    Object.keys(lote || {}).forEach(function (t) {
      var pk = Schema.pk(t);
      (lote[t] || []).forEach(function (r) {
        out.linhas[t + '\u0000' + r[pk]] = true;
        if (t === 'EVENTOS') out.eventos[r.event_id] = true;
        if (t === 'ANIMAIS') out.brincos[r.animal_id] = true;
        if (t === 'IDENTIFICACOES') { out.brincos[r.ident_id] = true; out.brincos[r.animal_id] = true; }
      });
    });
    return out;
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
  function recusaDaTrava_(novos, depois, proprios, fonte) {
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
    var mensagem = fonte
      ? 'Não dá para gravar: a planilha tem dados apagados ou mexidos à mão ' + (novos.length === 1 ? '(' + String(novos[0].oque).replace(/\.$/, '') + ')' : 'em ' + novos.length + ' pontos (veja cada um abaixo)') + ', e este lançamento refaria a situação a partir deles, como se estivessem certos. Restaure o backup ou investigue a edição manual antes. Nada foi gravado.'
      : novos.length === 1
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
    var cobertos = { animais: {}, eventos: {}, produtos: {} };
    if (d && d.tudo) cobertos = { tudo: true };
    else {
      if (d) (d.animais || []).forEach(function (id) { cobertos.animais[id] = true; });
      if (d) (d.eventos || []).forEach(function (id) { cobertos.eventos[id] = true; });
      if (d) (d.produtos || []).forEach(function (id) { cobertos.produtos[id] = true; });
      (t.projecoes || []).forEach(function (u) { if (u.tabela === 'ANIMAIS') cobertos.animais[u.id] = true; if (u.tabela === 'PRODUTOS') cobertos.produtos[u.id] = true; });
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
    // A correção de um lançamento lê o original (a entrada sem mudança e os valores que ela mantém dele): com o que ela lê quebrado
    // à mão (os achados `lidaPelaCorrecao`), o substituto sairia coerente a partir do dado mexido — o mesmo que o reparo
    // RECONSTRUIR, que a verificação recusa —, e o "depois" não teria achado nenhum. Por isso a correção sempre olha o "antes" do
    // original. A cópia apagada que a correção refaz da fonte intacta (o movimento da compra, pelo `com_movimento`) continua
    // sendo o caminho do conserto.
    var corrigidos = {};
    ((t.lote || {}).EVENTOS || []).forEach(function (r) { if (!vazio_(r.reversal_of_event_id) && r.event_type !== 'ESTORNO') corrigidos[r.reversal_of_event_id] = true; });
    var corrige = Object.keys(corrigidos).length > 0;
    if (!corrige && !depois.some(function (a) { return a.severidade === 'ERRO'; })) return resumo;
    var antes = rodar(t.antes);
    resumo.achados_antes = antes.length;
    var doOriginal = antes.filter(function (a) { return a.severidade === 'ERRO' && a.fonte && a.lidaPelaCorrecao && !vazio_(a.event_id) && corrigidos[a.event_id]; });
    if (doOriginal.length) {
      throw recusaDaTrava_(doOriginal.map(function (a) {
        return Object.assign({}, a, { resolver: RESOLVER_FONTE_CORRECAO, oque: String(a.mensagem || '').replace(/\s*Restaure o backup ou investigue a edição manual.*$/, '') });
      }), t.depois, { eventos: {}, linhas: {}, brincos: {} }, true);
    }
    if (!depois.some(function (a) { return a.severidade === 'ERRO'; })) return resumo;
    var fonte = fonteTocada_(antes, t, esc);
    if (fonte.diretos.length) {
      throw recusaDaTrava_(fonte.diretos.map(function (a) {
        return Object.assign({}, a, { resolver: RESOLVER_FONTE, oque: String(a.mensagem || '').replace(/\s*Restaure o backup ou investigue a edição manual.*$/, '') });
      }), t.depois, { eventos: {}, linhas: {}, brincos: {} }, true);
    }
    // A reconstrução que o comando só alcança de passagem regravaria o que a fonte quebrada cita: quem chama refaz o retrato
    // sem essas projeções (quarentena) e roda a trava de novo sobre ele.
    var q = Object.keys(fonte.quarentena).filter(function (k) { return !(t.quarentena && t.quarentena.indexOf(k) >= 0); });
    if (q.length) { resumo.refazer_sem = (t.quarentena || []).concat(q); return resumo; }
    resumo.quarentena = (t.quarentena || []).slice();
    var novos = novosAchados_(antes, depois).filter(function (a) { return a.severidade === 'ERRO'; });
    if (novos.length) throw recusaDaTrava_(novos, t.depois, t.proprios || { eventos: {}, linhas: {} });
    return resumo;
  }

  // ------------------------------------------------------------------ avisos da trava ----
  /**
   * A política de avisos (`avisos_politica`) aplicada pela UnitOfWork a todo aviso de todo caminho (CONTRATOS, seção
   * 10.5, item 6): IGNORA some, BLOQUEIA vira erro com o mesmo código, AVISA pede aceite. Os serviços que já a aplicam
   * (o motor de eventos, as categorias, os parceiros, o animal de referência) não mudam de resultado: aplicá-la de novo
   * dá o mesmo. A carência fica como veio: a política dela vale só na venda para abate, e quem sabe a finalidade é a
   * venda (05, seção 4.8). Devolve {avisos, erros}.
   */
  function politicaDosAvisos(repo, avisos) {
    var lista = avisos || [];
    if (!lista.length) return { avisos: [], erros: [] };
    var pol = (repo.carregada('CONFIGURACOES') ? Timeline.parametros(repo).avisos_politica : null) || {};
    var out = { avisos: [], erros: [] };
    lista.forEach(function (a) {
      var p = a.codigo === 'CARENCIA_ATIVA' ? 'AVISA' : pol[a.codigo] || 'AVISA';
      if (p === 'BLOQUEIA') out.erros.push(Validation.bloqueado(a));
      else if (p !== 'IGNORA') out.avisos.push(a);
    });
    return out;
  }
  /**
   * Avisos da trava (CONTRATOS, seção 10.5, item 6): o que o ESTADO RESULTANTE pede confirmar, por qualquer caminho, pelo
   * retrato de antes e o de depois do comando. Hoje, o período financeiro fechado (RN-082; desenho-base, seção 11.3): o
   * comando que cria lançamento ou cancela um que valia com competência até `fin_bloqueio_ate` — o registro, a correção, o
   * estorno, o bloco importado ou o desfazer da importação — pede o aviso PERIODO_BLOQUEADO, um só por comando. O caminho
   * que já pediu o aviso (o motor de eventos, com a mensagem dele) não o recebe de novo (`jaPedidos`: {codigo: true}).
   * t: {antes, depois (tx com acesso cru), lote, jaPedidos}. Devolve os avisos, sem a política (a UnitOfWork a aplica).
   */
  /**
   * A baixa do período fechado (RN-082; 03b, seção 11: "mexer em baixa com data_pagamento até fin_bloqueio_ate"): o comando
   * que dá, desfaz ou muda a baixa de uma parcela de lançamento que vale (a baixa, o desfazer, a parcela paga de um
   * desdobramento) com o pagamento — o de antes ou o de depois — até `fin_bloqueio_ate` pede PERIODO_BLOQUEADO, um só.
   */
  function avisoDasBaixas_(t, params) {
    if (!t.antes.repo.carregada('PARCELAS') || !t.depois.repo.carregada('PARCELAS')) return [];
    var velhas = {};
    t.antes.cru.cru('PARCELAS').forEach(function (p) { velhas[p.parcela_id] = p; });
    var fechada = function (d) { return !vazio_(d) && d <= params.fin_bloqueio_ate; };
    var achada = null;
    t.depois.cru.cru('PARCELAS').forEach(function (p) {
      if (achada) return;
      var v = velhas[p.parcela_id] || null;
      var antes = v && v.status === 'LIQUIDADA' ? v.data_pagamento : null;
      var depois = p.status === 'LIQUIDADA' ? p.data_pagamento : null;
      if (antes === depois && (!v || v.valor_pago === p.valor_pago)) return;
      // A parcela nova de um lançamento novo (o evento que nasce pago) já pediu o aviso pela competência do lançamento.
      if (!v && !t.antes.cru.cruPorId('FINANCEIRO', p.financial_id)) return;
      if (fechada(antes) || fechada(depois)) achada = { p: p, data: fechada(antes) ? antes : depois };
    });
    if (!achada) return [];
    var fin = t.depois.cru.cruPorId('FINANCEIRO', achada.p.financial_id) || {};
    var a = FinancialService.avisoPeriodo(params, achada.data, 'A baixa da parcela ' + achada.p.parcela_num + ' de "' + (fin.descricao || fin.natureza || 'lançamento') + '", que este comando muda,');
    return [Validation.detalhe({ codigo: a.codigo, campo: 'justificativa_aviso', mensagem: a.mensagem })];
  }
  function avisosDaTrava(t) {
    var antes = t.antes.repo;
    var ja = t.jaPedidos || {};
    if (ja.PERIODO_BLOQUEADO || !antes.carregada('CONFIGURACOES')) return [];
    var params = Timeline.parametros(antes);
    if (vazio_(params.fin_bloqueio_ate)) return [];
    var velhos = {};
    if (antes.carregada('FINANCEIRO')) t.antes.cru.cru('FINANCEIRO').forEach(function (f) { velhos[f.financial_id] = f; });
    var lista = t.depois.repo.carregada('FINANCEIRO') ? t.depois.cru.cru('FINANCEIRO') : (t.lote && t.lote.FINANCEIRO) || [];
    var mexidos = [];
    lista.forEach(function (f) {
      var v = velhos[f.financial_id];
      // O lançamento do bloco importado nasce sem status (vale na conclusão), mas é criado ali.
      var criou = !v && f.status !== 'CANCELADO';
      var cancelou = !!v && v.status === 'ATIVO' && f.status === 'CANCELADO';
      if ((criou || cancelou) && !vazio_(f.data_competencia) && FinancialService.avisoPeriodo(params, f.data_competencia, '-')) mexidos.push({ f: f, criou: criou });
    });
    if (!mexidos.length) return avisoDasBaixas_(t, params);
    mexidos.sort(function (a, b) { return a.f.data_competencia < b.f.data_competencia ? -1 : a.f.data_competencia > b.f.data_competencia ? 1 : 0; });
    var m = mexidos[0];
    var oque = 'O lançamento "' + (m.f.descricao || m.f.natureza) + '", que este comando ' + (m.criou ? 'cria' : 'cancela') + (mexidos.length > 1 ? ' (e mais ' + (mexidos.length - 1) + ')' : '') + ',';
    var a = FinancialService.avisoPeriodo(params, m.f.data_competencia, oque);
    return [Validation.detalhe({ codigo: a.codigo, campo: 'justificativa_aviso', mensagem: a.mensagem })];
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
    propriosDoLote: propriosDoLote,
    politicaDosAvisos: politicaDosAvisos,
    avisosDaTrava: avisosDaTrava,
  };
})();
