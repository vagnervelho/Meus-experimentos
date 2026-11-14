/**
 * AuditService (parte 1) — trilha de AUDITORIA e registro de erros.
 *
 * AUDITORIA guarda as mutações que não são evento (edição [cad], coluna [ctl], configuração, recuperação,
 * manutenção) e é o REGISTRO DE REFAZER dos comandos sem evento (06, seção 5.2): a fase A anexa as linhas, a
 * fase B confirma a operação e a fase C aplica `valor_novo`. Uma linha só vale se a operação dela está
 * CONFIRMADA. Puro: usa as portas do contexto. A verificação de integridade entra neste arquivo em etapa posterior.
 */
var AuditService = (function () {
  /** Tabelas que `listar` precisa nas leituras (reads) da consulta. */
  var LEITURAS = Object.freeze(['AUDITORIA']);
  var ACOES_DE_CAMPO = Object.freeze({ CRIAR: true, ALTERAR: true, CONTROLE: true });
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
      if (acao === 'ALTERAR' && col.marca !== 'CAD') throw interno_('A coluna ' + m.entidade + '.' + m.campo + ' não é de cadastro: não pode ser editada por comando direto.');
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
   */
  function alteracao(tx, tabela, id, campos, justificativa) {
    var atual = tx.repo.porId(tabela, id);
    if (!atual) throw Validation.erro('NOT_FOUND', 'O registro que você tentou alterar não existe mais. Atualize a tela e tente de novo.');
    var n = 0;
    Object.keys(campos || {}).forEach(function (campo) {
      var col = Schema.coluna(tabela, campo);
      var novo = tx.ctx.io.normalizarValor(tabela, campo, campos[campo]);
      var igual = col.tipo === 'JSON' ? JSON.stringify(atual[campo]) === JSON.stringify(novo) : atual[campo] === novo;
      if (igual) return;
      tx.plano.auditar({
        entidade: tabela, entity_id: id, acao: col.marca === 'CTL' ? 'CONTROLE' : 'ALTERAR', campo: campo,
        valor_anterior: atual[campo], valor_novo: novo, justificativa: justificativa,
      });
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

  return {
    LEITURAS: LEITURAS,
    linhas: linhas,
    alteracao: alteracao,
    criacao: criacao,
    refazer: refazer,
    listar: listar,
    linhaErro: linhaErro,
  };
})();
