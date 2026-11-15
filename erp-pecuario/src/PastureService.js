/**
 * PastureService — propriedades e pastos (03a, seções 4.1 e 4.2; §7): `propriedade.salvar`, `pasto.salvar` (com
 * posse e arrendador, DV-20), `pasto.listar` e `pasto.painel` (cabeças, machos, fêmeas, categorias, peso vivo
 * total, UA, UA/ha, capacidade e ocupação, com o peso vigente e a parcela estimada separada; 07, seção 8.2).
 *
 * P9: sem área, UA/ha é null; sem capacidade informada, ocupação é null (nunca deduzida da área); pasto com cabeças
 * e nenhum peso dá UA null. Comandos sem evento: AUDITORIA pela UnitOfWork. Puro.
 */
var PastureService = (function () {
  var CAMPOS_PROPRIEDADE = ['nome', 'descricao', 'localizacao', 'area_total_ha', 'status'];
  var CAMPOS_PASTO = ['property_id', 'nome', 'identificacao', 'area_hectares', 'tipo_capim', 'capacidade_estimada_ua_ha',
    'capacidade_estimada_cabecas', 'posse', 'arrendador_id', 'observacoes', 'status'];

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function nulo_(v) {
    return vazio_(v) ? null : v;
  }
  function arred_(v, casas) {
    return v === null ? null : Utils.arredondar(v, casas);
  }
  function chaveNome_(t) {
    return Utils.normalizarTexto(t || '');
  }
  function camposDe_(col, d, permitidos, entidade) {
    var campos = {};
    Object.keys(d.campos || {}).forEach(function (c) {
      if (permitidos.indexOf(c) < 0) {
        col.erro({ codigo: Schema.temColuna(entidade, c) ? 'CAMPO_NAO_EDITAVEL' : 'CAMPO_DESCONHECIDO', campo: c, mensagem: 'O campo "' + c + '" não se altera por aqui.' });
        return;
      }
      var v = d.campos[c];
      v = typeof v === 'string' ? Utils.aparar(v) : v;
      campos[c] = vazio_(v) ? null : v;
    });
    return campos;
  }
  function validar_(col, tabela, campos) {
    var presentes = {};
    Object.keys(campos).forEach(function (c) { if (campos[c] !== null) presentes[c] = campos[c]; });
    Validation.validarRegistro(tabela, presentes, { parcial: true }).forEach(function (x) { col.erro(x); });
  }

  // ------------------------------------------------------------------ propriedade.salvar ----
  /**
   * Comando `propriedade.salvar`. dados: {property_id?, campos: {nome, descricao, localizacao, area_total_ha,
   * status}, justificativa?}. Nome obrigatório e único entre as propriedades; status padrão ATIVO; INATIVO só sem
   * pasto ativo e se não for a propriedade padrão. A primeira propriedade cadastrada vira `propriedade_padrao_id`
   * quando o parâmetro está vazio (mesma operação). Resposta: a propriedade gravada.
   */
  function comandoSalvarPropriedade(pedido) {
    var p = pedido || {};
    return {
      rota: 'propriedade.salvar', idempotencyKey: p.idempotencyKey, dados: p.dados, avisosAceitos: p.avisosAceitos || [],
      dataVersionEsperada: p.dataVersionEsperada, reads: ['PROPRIEDADES', 'PASTOS', 'CONFIGURACOES'],
      tratador: function (tx) {
        var d = tx.dados || {};
        var col = Validation.coletor();
        var atual = vazio_(d.property_id) ? null : tx.repo.porId('PROPRIEDADES', d.property_id);
        if (!vazio_(d.property_id) && !atual) throw Validation.erro('NOT_FOUND', 'A propriedade não existe mais. Atualize a tela e tente de novo.');
        var campos = camposDe_(col, d, CAMPOS_PROPRIEDADE, 'PROPRIEDADES');
        if (!atual && (campos.status === undefined || campos.status === null)) campos.status = 'ATIVO';
        var nome = campos.nome !== undefined ? campos.nome : atual ? atual.nome : null;
        if (vazio_(nome)) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'nome', mensagem: 'Informe o nome da propriedade.' });
        if (campos.status === null) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'status', mensagem: 'Diga se a propriedade está ativa.' });
        validar_(col, 'PROPRIEDADES', campos);
        var id = atual ? atual.property_id : tx.novoId();
        if (!vazio_(nome) && tx.repo.vigentes('PROPRIEDADES').some(function (x) { return x.property_id !== id && chaveNome_(x.nome) === chaveNome_(nome); })) {
          col.erro({ codigo: 'NOME_REPETIDO', campo: 'nome', mensagem: 'Já existe uma propriedade chamada "' + nome + '".' });
        }
        var params = Config.parametros(tx.repo);
        if (atual && campos.status === 'INATIVO' && atual.status !== 'INATIVO') {
          var ativos = tx.repo.por('PASTOS', 'property_id', id).filter(function (x) { return x.status === 'ATIVO'; });
          if (ativos.length) col.erro({ codigo: 'PROPRIEDADE_COM_PASTOS', campo: 'status', mensagem: 'A propriedade ainda tem ' + ativos.length + ' pasto(s) ativo(s) (' + ativos.map(function (x) { return x.nome; }).join(', ') + '). Desative-os antes.' });
          if (params.propriedade_padrao_id === id) col.erro({ codigo: 'PROPRIEDADE_PADRAO', campo: 'status', mensagem: 'Esta é a propriedade padrão dos lançamentos. Escolha outra propriedade padrão nas configurações antes de desativá-la.' });
        }
        if (col.temErros()) return { erros: col.erros };
        if (atual) AuditService.alteracao(tx, 'PROPRIEDADES', id, campos, d.justificativa);
        else {
          AuditService.criacao(tx, 'PROPRIEDADES', id, campos, d.justificativa);
          if (vazio_(params.propriedade_padrao_id)) Config.planejarParametro(tx, 'propriedade_padrao_id', id, 'Primeira propriedade cadastrada');
        }
        return { resumo: { property_id: id }, resposta: function (t) { return Utils.clonar(t.repo.porId('PROPRIEDADES', id)); } };
      },
      reconstruir: function (tx, op) { return Utils.clonar(tx.repo.porId('PROPRIEDADES', op.resumo.property_id)); },
    };
  }

  // ------------------------------------------------------------------ pasto.salvar ----
  /**
   * Comando `pasto.salvar`. dados: {pasture_id?, campos: {property_id (só na criação; imutável), nome,
   * identificacao, area_hectares, tipo_capim, capacidade_estimada_ua_ha, capacidade_estimada_cabecas, posse
   * (PROPRIO padrão | ARRENDADO), arrendador_id, observacoes, status}, justificativa?}.
   * Regras: propriedade existente e ativa; nome único entre os pastos ativos da propriedade; arrendador só com posse
   * ARRENDADO e precisa existir em PARCEIROS (opcional mesmo arrendado); INATIVO só sem animal no pasto.
   * Resposta: o pasto gravado.
   */
  function comandoSalvarPasto(pedido) {
    var p = pedido || {};
    return {
      rota: 'pasto.salvar', idempotencyKey: p.idempotencyKey, dados: p.dados, avisosAceitos: p.avisosAceitos || [],
      dataVersionEsperada: p.dataVersionEsperada, reads: ['PASTOS', 'PROPRIEDADES', 'PARCEIROS', 'ANIMAIS'],
      tratador: function (tx) {
        var d = tx.dados || {};
        var col = Validation.coletor();
        var atual = vazio_(d.pasture_id) ? null : tx.repo.porId('PASTOS', d.pasture_id);
        if (!vazio_(d.pasture_id) && !atual) throw Validation.erro('NOT_FOUND', 'O pasto não existe mais. Atualize a tela e tente de novo.');
        var campos = camposDe_(col, d, CAMPOS_PASTO, 'PASTOS');
        var id = atual ? atual.pasture_id : tx.novoId();
        if (atual) {
          if (campos.property_id !== undefined && campos.property_id !== atual.property_id) col.erro({ codigo: 'CAMPO_IMUTAVEL', campo: 'property_id', mensagem: 'Um pasto não muda de propriedade: cadastre um pasto novo na outra propriedade.' });
          delete campos.property_id;
        } else {
          if (campos.posse === undefined || campos.posse === null) campos.posse = 'PROPRIO';
          if (campos.status === undefined || campos.status === null) campos.status = 'ATIVO';
          var prop = vazio_(campos.property_id) ? null : tx.repo.porId('PROPRIEDADES', campos.property_id);
          if (vazio_(campos.property_id)) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'property_id', mensagem: 'Escolha a propriedade do pasto.' });
          else if (!prop) col.erro({ codigo: 'NAO_ENCONTRADO', campo: 'property_id', mensagem: 'A propriedade escolhida não existe.' });
          else if (prop.status !== 'ATIVO') col.erro({ codigo: 'PROPRIEDADE_INATIVA', campo: 'property_id', mensagem: 'A propriedade ' + prop.nome + ' está desativada.' });
        }
        var final = Utils.clonar(atual || {});
        Object.keys(campos).forEach(function (c) { final[c] = campos[c]; });
        if (vazio_(final.nome)) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'nome', mensagem: 'Informe o nome do pasto.' });
        if (campos.posse === null) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'posse', mensagem: 'Diga se o pasto é próprio ou arrendado.' });
        if (campos.status === null) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'status', mensagem: 'Diga se o pasto está ativo.' });
        validar_(col, 'PASTOS', campos);
        if (!vazio_(final.arrendador_id)) {
          if (final.posse !== 'ARRENDADO') col.erro({ codigo: 'ARRENDADOR_SEM_ARRENDAMENTO', campo: 'arrendador_id', mensagem: 'Arrendador só se informa em pasto arrendado. Marque o pasto como arrendado ou tire o arrendador.' });
          else if (campos.arrendador_id !== undefined && !tx.repo.porId('PARCEIROS', final.arrendador_id)) col.erro({ codigo: 'NAO_ENCONTRADO', campo: 'arrendador_id', mensagem: 'O arrendador escolhido não está no cadastro de parceiros.' });
        }
        if (final.status === 'ATIVO' && !vazio_(final.nome) && !vazio_(final.property_id)) {
          var igual = tx.repo.por('PASTOS', 'property_id', final.property_id).filter(function (x) { return x.pasture_id !== id && x.status === 'ATIVO' && chaveNome_(x.nome) === chaveNome_(final.nome); })[0];
          if (igual) col.erro({ codigo: 'NOME_REPETIDO', campo: 'nome', mensagem: 'Já existe um pasto ativo chamado "' + igual.nome + '" nesta propriedade.' });
        }
        if (atual && final.status === 'INATIVO' && atual.status !== 'INATIVO') {
          var dentro = tx.repo.por('ANIMAIS', 'pasto_atual_id', id).filter(function (a) { return a.situacao_cadastral === 'ATIVO'; });
          if (dentro.length) col.erro({ codigo: 'PASTO_COM_ANIMAIS', campo: 'status', mensagem: 'O pasto ' + atual.nome + ' ainda tem ' + dentro.length + ' animal(is). Transfira-os antes de desativá-lo.' });
        }
        if (col.temErros()) return { erros: col.erros };
        if (atual) AuditService.alteracao(tx, 'PASTOS', id, campos, d.justificativa);
        else AuditService.criacao(tx, 'PASTOS', id, campos, d.justificativa);
        return { resumo: { pasture_id: id }, resposta: function (t) { return Utils.clonar(t.repo.porId('PASTOS', id)); } };
      },
      reconstruir: function (tx, op) { return Utils.clonar(tx.repo.porId('PASTOS', op.resumo.pasture_id)); },
    };
  }

  // ------------------------------------------------------------------ lotação ----
  /**
   * Lotação de um pasto a partir da composição (07, seção 8.2): UA/ha = UA ÷ área (null sem área: SEM_VALOR_DE_
   * REFERENCIA); ocupação % = UA/ha ÷ capacidade em UA/ha; sem ela (ou sem UA/ha), cabeças ÷ capacidade em cabeças;
   * sem capacidade informada → null (SEM_VALOR_DE_REFERENCIA). Contas sobre o peso total, arredondando só no fim.
   * `acima_da_capacidade` (RN-027, a regra do aviso LOTACAO_ACIMA_DA_CAPACIDADE): {ua_ha, cabecas} = true quando a
   * conta exata passa da capacidade informada, false quando não passa, null quando não há como comparar.
   * comp: {cabecas, peso_vivo_total: {valor}, ua: {valor, motivo, n, estimado, ua_peso_kg}} (InventoryService.compor).
   */
  function lotacao(pasto, comp) {
    var area = typeof pasto.area_hectares === 'number' && pasto.area_hectares > 0 ? pasto.area_hectares : null;
    var ua = comp.ua.valor;
    var uaBruta = ua === null || typeof comp.ua.ua_peso_kg !== 'number' ? ua : comp.peso_vivo_total.valor / comp.ua.ua_peso_kg;
    var uaHaBruta = ua === null || area === null ? null : uaBruta / area;
    var uaHa = arred_(uaHaBruta, 2);
    var motivoUaHa = ua === null ? comp.ua.motivo : area === null ? 'SEM_VALOR_DE_REFERENCIA' : null;
    var capUa = typeof pasto.capacidade_estimada_ua_ha === 'number' ? pasto.capacidade_estimada_ua_ha : null;
    var capCab = typeof pasto.capacidade_estimada_cabecas === 'number' ? pasto.capacidade_estimada_cabecas : null;
    var ocup = null;
    var base = null;
    var motivoOcup = null;
    if (capUa !== null && uaHa !== null) { ocup = arred_(uaHaBruta / capUa * 100, 1); base = 'UA_HA'; }
    else if (capCab !== null) { ocup = arred_(comp.cabecas / capCab * 100, 1); base = 'CABECAS'; }
    else motivoOcup = capUa === null ? 'SEM_VALOR_DE_REFERENCIA' : motivoUaHa;
    return {
      ua_ha: { valor: uaHa, motivo: uaHa === null ? motivoUaHa : null, n: comp.ua.n, estimado: comp.ua.estimado, area_hectares: area },
      capacidade: { ua_ha: capUa, cabecas: capCab },
      ocupacao_pct: { valor: ocup, motivo: ocup === null ? motivoOcup : null, n: comp.cabecas, base: base, estimado: base === 'UA_HA' && comp.ua.estimado },
      acima_da_capacidade: {
        ua_ha: capUa === null || uaHaBruta === null ? null : uaHaBruta > capUa,
        cabecas: capCab === null ? null : comp.cabecas > capCab,
      },
    };
  }
  function cabecalhoPasto_(L, p) {
    var prop = L.repo.porId('PROPRIEDADES', p.property_id);
    var arr = vazio_(p.arrendador_id) ? null : L.repo.porId('PARCEIROS', p.arrendador_id);
    return {
      pasture_id: p.pasture_id, nome: p.nome, identificacao: nulo_(p.identificacao), property_id: p.property_id, propriedade_nome: prop ? prop.nome : null,
      area_hectares: nulo_(p.area_hectares), tipo_capim: nulo_(p.tipo_capim), posse: p.posse, arrendador_id: nulo_(p.arrendador_id),
      arrendador_nome: arr ? arr.nome : null, status: p.status, capacidade_estimada_ua_ha: nulo_(p.capacidade_estimada_ua_ha),
      capacidade_estimada_cabecas: nulo_(p.capacidade_estimada_cabecas), observacoes: nulo_(p.observacoes),
    };
  }
  function vazioPorMotivo_(motivo) {
    var ind = { valor: null, motivo: motivo, n: 0 };
    return {
      cabecas: null, machos: null, femeas: null, por_categoria: null, sem_categoria: null,
      peso_vivo_total: ind, peso_medio: ind, ua: ind, ua_ha: ind, ocupacao_pct: { valor: null, motivo: motivo, n: 0, base: null },
      acima_da_capacidade: { ua_ha: null, cabecas: null }, animais: null,
    };
  }
  function painel_(L, p, data, pr, comAnimais) {
    var out = cabecalhoPasto_(L, p);
    out.data = data;
    out.motivo = pr.motivo;
    if (pr.motivo) {
      var v = vazioPorMotivo_(pr.motivo);
      Object.keys(v).forEach(function (k) { out[k] = v[k]; });
      out.capacidade = { ua_ha: out.capacidade_estimada_ua_ha, cabecas: out.capacidade_estimada_cabecas };
      return out;
    }
    var itens = pr.itens.filter(function (x) { return x.pasture_id === p.pasture_id; });
    var comp = InventoryService.compor(L, itens, data, { animais: comAnimais });
    var lot = lotacao(p, comp);
    ['cabecas', 'machos', 'femeas', 'por_categoria', 'sem_categoria', 'peso_vivo_total', 'peso_medio', 'ua'].forEach(function (k) { out[k] = comp[k]; });
    out.ua_ha = lot.ua_ha;
    out.capacidade = lot.capacidade;
    out.ocupacao_pct = lot.ocupacao_pct;
    out.acima_da_capacidade = lot.acima_da_capacidade;
    if (comAnimais) out.animais = comp.animais;
    return out;
  }
  /**
   * Dias de permanência de cada animal no pasto num período (05, seção 4.6: a base do rateio DIAS_PERMANENCIA), pela
   * função única da linha do tempo (Timeline.diasPermanencia, escopo PASTO). {inicio, fim, inicio_efetivo, parcial,
   * motivo, base_total, n, itens: [{animal_id, codigo_interno, brinco, sexo, dias, intervalos}]}.
   */
  function permanencia_(L, p, inicio, fim) {
    var r = Timeline.diasPermanencia(L.f.todasAsLinhas(), { inicio: inicio, fim: fim }, { tipo: 'PASTO', ref: p.pasture_id }, { marcoZero: L.marcoZero });
    var itens = r.itens === null ? null : Utils.ordenarPor(r.itens.map(function (x) {
      var a = L.repo.porId('ANIMAIS', x.animal_id) || {};
      return { animal_id: x.animal_id, codigo_interno: nulo_(a.codigo_interno), brinco: nulo_(a.brinco), sexo: nulo_(a.sexo), dias: x.dias, intervalos: x.intervalos.map(function (i) { return { inicio: i.inicio, fim: i.fim, dias: i.dias }; }) };
    }), [{ campo: 'dias', desc: true }, 'codigo_interno']);
    return { inicio: r.inicio, fim: r.fim, inicio_efetivo: r.inicio_efetivo, parcial: r.parcial, motivo: r.motivo, base_total: r.base_total, n: r.n, itens: itens };
  }
  function leiturasConsulta_() {
    return Utils.unicos(AnimalService.leituras().concat(['PROPRIEDADES', 'PARCEIROS']));
  }
  function dataConsulta_(L, data) {
    var d = vazio_(data) ? L.hoje : data;
    if (!Utils.dataValida(d)) throw Validation.erro('VALIDATION', 'Informe uma data válida (aaaa-mm-dd).', [Validation.detalhe({ codigo: 'FORMATO_INVALIDO', campo: 'data', mensagem: 'Data inválida.' })]);
    if (d > L.hoje) throw Validation.erro('VALIDATION', 'A data ' + Timeline.dataBr(d) + ' ainda não chegou.', [Validation.detalhe({ codigo: 'DATA_FUTURA', campo: 'data', mensagem: 'Data futura.' })]);
    return d;
  }
  /**
   * Consulta `pasto.painel`: a composição do pasto numa data (08, seção 3: "posição em [data]"; a data histórica é da
   * Fase 2). dados: {pasture_id, data? (padrão hoje; composição ao fim do dia D, a partir do marco zero),
   * periodo_inicio?, periodo_fim? (os dois juntos: dias de permanência de cada animal no pasto no período, até hoje)}.
   * Devolve o cabeçalho do pasto + {data, motivo, cabecas, machos, femeas, por_categoria, sem_categoria,
   * peso_vivo_total, peso_medio, ua (com partes pesada / pesagem_vencida / sem_pesagem, sem_peso e rótulo da
   * estimativa), ua_ha, capacidade, ocupacao_pct, acima_da_capacidade, animais (quem estava: categoria, idade e peso
   * vigente em D, `no_pasto_desde` e `no_rebanho_desde`), permanencia (só com o período), parametros}. Indicadores na
   * forma {valor, motivo, n}. NOT_FOUND para pasto inexistente; VALIDATION para data inválida ou futura e período
   * incompleto, invertido ou que termina depois de hoje.
   */
  function consultaPainel(dados) {
    var d = dados || {};
    return {
      rota: 'pasto.painel', dados: d, reads: leiturasConsulta_(), acessoCru: true,
      tratador: function (tx) {
        var L = AnimalService.leitor(tx);
        var data = dataConsulta_(L, d.data);
        var p = vazio_(d.pasture_id) ? null : tx.repo.porId('PASTOS', d.pasture_id);
        if (!p) throw Validation.erro('NOT_FOUND', 'Pasto não encontrado. Atualize a tela e tente de novo.');
        var comPeriodo = !vazio_(d.periodo_inicio) || !vazio_(d.periodo_fim);
        if (comPeriodo && (vazio_(d.periodo_inicio) || vazio_(d.periodo_fim))) {
          throw Validation.erro('VALIDATION', 'Para os dias de permanência, informe o início e o fim do período.', [Validation.detalhe({ codigo: 'CAMPO_OBRIGATORIO', campo: vazio_(d.periodo_inicio) ? 'periodo_inicio' : 'periodo_fim', mensagem: 'Período incompleto.' })]);
        }
        if (comPeriodo && Utils.dataValida(d.periodo_fim) && d.periodo_fim > L.hoje) {
          throw Validation.erro('VALIDATION', 'O período dos dias de permanência vai até hoje no máximo (' + Timeline.dataBr(L.hoje) + ').', [Validation.detalhe({ codigo: 'DATA_FUTURA', campo: 'periodo_fim', mensagem: 'Data futura.' })]);
        }
        var out = painel_(L, p, data, InventoryService.presentes(L, data), true);
        if (comPeriodo) out.permanencia = permanencia_(L, p, d.periodo_inicio, d.periodo_fim);
        out.parametros = { ua_peso_kg: L.params.ua_peso_kg, peso_validade_dias: L.params.peso_validade_dias };
        return out;
      },
    };
  }
  /**
   * Consulta `pasto.listar`. filtros: {property_id?, incluir_inativos? (padrão false)}. Cartões de hoje: o cabeçalho
   * de cada pasto + cabeças, UA, UA/ha e ocupação (sem a lista de animais), em ordem de nome.
   */
  function consultaListar(filtros) {
    var o = filtros || {};
    return {
      rota: 'pasto.listar', dados: o, reads: leiturasConsulta_(), acessoCru: true,
      tratador: function (tx) {
        var L = AnimalService.leitor(tx);
        var pr = InventoryService.presentes(L, L.hoje);
        var pastos = tx.repo.vigentes('PASTOS').filter(function (p) {
          if (!vazio_(o.property_id) && p.property_id !== o.property_id) return false;
          return o.incluir_inativos === true || p.status === 'ATIVO';
        });
        return Utils.ordenarPor(pastos, ['nome', 'pasture_id']).map(function (p) { return painel_(L, p, L.hoje, pr, false); });
      },
    };
  }

  function salvarPropriedade(ctx, pedido) { return UnitOfWork.run(ctx, comandoSalvarPropriedade(pedido)); }
  function salvarPasto(ctx, pedido) { return UnitOfWork.run(ctx, comandoSalvarPasto(pedido)); }
  function listar(ctx, filtros) { return UnitOfWork.read(ctx, consultaListar(filtros)); }
  function painel(ctx, dados) { return UnitOfWork.read(ctx, consultaPainel(dados)); }

  return {
    lotacao: lotacao,
    comandoSalvarPropriedade: comandoSalvarPropriedade,
    comandoSalvarPasto: comandoSalvarPasto,
    consultaListar: consultaListar,
    consultaPainel: consultaPainel,
    salvarPropriedade: salvarPropriedade,
    salvarPasto: salvarPasto,
    listar: listar,
    painel: painel,
  };
})();
