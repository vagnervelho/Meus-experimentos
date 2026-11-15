/**
 * EventService — tratadores de comando e de consulta do motor de eventos (04, seções 2 e 4; 05, seções 2 a 4).
 * Puro: monta comandos para a UnitOfWork (que grava em três fases) e consultas para UnitOfWork.read.
 *
 * Comandos: registrar, corrigir (substituto com os mesmos animal_id), estornar; simular = o mesmo tratador em
 * modo SIMULAR. Validação completa, tudo ou nada: campos pelo EventCatalog → regras do tipo (identificação,
 * genealogia, pastos, datas) → linha do tempo de cada animal (Timeline) → financeiro → tetos de célula. Erros por
 * animal e por campo; avisos com aceite conforme `avisos_politica`; avisos aceitos ficam em EVENTOS.payload_json.
 */
var EventService = (function () {
  var MAX_ANIMAIS = 1000;
  /** Crias por parto: um parto bovino passa raramente de gêmeos; quatro cobre trigêmeos e quadrigêmeos. */
  var MAX_CRIAS = 4;
  /** Tipos cujo evento pode ter data anterior ao marco zero: registro informativo, sem efeito no inventário (04, seção 6). */
  var ACEITA_HISTORICO = ['NASCIMENTO'];
  var ROTAS = { registrar: 'evento.registrar', corrigir: 'evento.corrigir', estornar: 'evento.estornar' };
  var IDENT_EXTRAS = ['BRINCO_ORIGEM', 'RFID', 'SISBOV', 'TATUAGEM', 'OUTRO'];
  var SITUACAO_ROTULO = {
    ATIVO: 'no rebanho', VENDIDO: 'vendido', MORTO: 'morto', DESCARTADO: 'descartado', BAIXADO_AJUSTE: 'baixado na contagem',
    HISTORICO: 'do histórico', EXTERNO: 'de fora do rebanho',
  };
  /** Campos de um animal já cadastrado que volta ao rebanho, por tipo de entrada (o resto está no cadastro dele). */
  var CAMPOS_REENTRADA = {
    OUTRA_ENTRADA: ['animal_id', 'brinco', 'pasto_destino_id', 'observacoes'],
    COMPRA: ['animal_id', 'brinco', 'brinco_origem', 'pasto_destino_id', 'peso', 'metodo_pesagem', 'peso_carcaca_kg', 'valor_individual', 'base_manual', 'observacoes'],
  };
  var CONTA_ABERTURA = 'SALDO_ABERTURA_REBANHO';
  var PERFIS_CATEGORIA = [
    { id: 'MACHO_REPRODUTOR', rotulo: 'macho reprodutor', sexo: 'M', castrado: false, reprodutor: true, parida: false },
    { id: 'MACHO_INTEIRO', rotulo: 'macho inteiro não reprodutor', sexo: 'M', castrado: false, reprodutor: false, parida: false },
    { id: 'MACHO_CASTRADO', rotulo: 'macho castrado', sexo: 'M', castrado: true, reprodutor: false, parida: false },
    { id: 'FEMEA_PARIDA', rotulo: 'fêmea parida', sexo: 'F', castrado: null, reprodutor: null, parida: true },
    { id: 'FEMEA_NAO_PARIDA', rotulo: 'fêmea não parida', sexo: 'F', castrado: null, reprodutor: null, parida: false },
  ];

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function nulo_(v) {
    return vazio_(v) ? null : v;
  }
  function interno_(mensagem) {
    return Validation.erro('INTERNAL', mensagem);
  }
  function br_(d) {
    return Timeline.dataBr(d);
  }
  function pad_(n, t) {
    var s = String(n);
    while (s.length < t) s = '0' + s;
    return s;
  }
  function extrairCodigo_(v) {
    var n = Number(String(v).slice(2));
    return isFinite(n) ? n : null;
  }
  function boolTexto_(v) {
    return v === true ? 'S' : v === false ? 'N' : null;
  }
  /** Data `meses` meses de calendário antes de `data` (dia limitado ao último do mês). */
  function menosMeses_(data, meses) {
    var a = Number(data.slice(0, 4));
    var mes = Number(data.slice(5, 7));
    var dia = Number(data.slice(8, 10));
    var total = a * 12 + (mes - 1) - meses;
    var na = Math.floor(total / 12);
    var nm = total - na * 12 + 1;
    var bis = (na % 4 === 0 && na % 100 !== 0) || na % 400 === 0;
    var dim = [31, bis ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][nm - 1];
    return pad_(na, 4) + '-' + pad_(nm, 2) + '-' + pad_(Math.min(dia, dim), 2);
  }

  // ------------------------------------------------------------------ comandos públicos ----
  /**
   * Comando pronto para UnitOfWork.run. acao: 'registrar' | 'corrigir' | 'estornar'.
   * pedido: {idempotencyKey, dados, avisosAceitos, dataVersionEsperada, modo}.
   */
  function comando(acao, pedido) {
    if (!ROTAS[acao]) throw interno_('Ação de evento desconhecida: ' + acao + '.');
    var p = pedido || {};
    var dados = p.dados || {};
    var tipo = acao === 'estornar' ? 'ESTORNO' : dados.tipo;
    return {
      rota: ROTAS[acao], idempotencyKey: p.idempotencyKey, dados: dados, avisosAceitos: p.avisosAceitos || [],
      dataVersionEsperada: p.dataVersionEsperada, modo: p.modo, acessoCru: true,
      reads: Utils.unicos(EventCatalog.leituras(EventCatalog.existe(tipo) ? tipo : null).concat(Timeline.LEITURAS)),
      tratador: function (tx) { return acao === 'estornar' ? planejarEstorno_(tx) : planejarEvento_(tx, acao); },
      reconstruir: function (tx, op) { return resposta_(tx, op.resumo); },
    };
  }
  function registrar(ctx, pedido) {
    return UnitOfWork.run(ctx, comando('registrar', pedido));
  }
  /**
   * Planeja, dentro do tratador de OUTRO comando (a importação de planilha), uma ENTRADA_INICIAL com as MESMAS regras
   * do formulário (RN-090), sem abrir unidade própria. O tx precisa ter lido `leiturasEntrada()` e ter acesso cru.
   * dados: {campos, animais} como em registrar. opcoes: {importacao: {import_id}} (o evento nasce com import_id e
   * source IMPORTACAO: só vale quando a importação chega a IMPORTADO); conhecidos: {animal_id: {sexo,
   * data_nascimento, mae_id, pai_id, nome}} — animais criados por lotes anteriores da mesma importação, ainda
   * pendentes, aceitos como mãe ou pai; rotulos: [texto por item] (ex.: 'Linha 12') para as mensagens.
   * Devolve o resultado do tratador ({erros} ou {avisos, resumo, impactos, derivados, resposta}); com erros, nada
   * entra no plano. CONFLICT e CONFIG são lançados como no registrar.
   */
  function planejarEntradaImportada(tx, dados, opcoes) {
    var o = opcoes || {};
    if (!o.importacao || vazio_(o.importacao.import_id)) throw interno_('planejarEntradaImportada precisa do import_id.');
    var d = { tipo: 'ENTRADA_INICIAL', campos: (dados && dados.campos) || {}, animais: (dados && dados.animais) || [] };
    return planejarEvento_(tx, 'registrar', { dados: d, importacao: o.importacao, conhecidos: o.conhecidos || {}, rotulos: o.rotulos || null });
  }
  /** Abas que o tratador precisa ler para planejar uma entrada (reads do comando que chama planejarEntradaImportada). */
  function leiturasEntrada() {
    return Utils.unicos(EventCatalog.leituras('ENTRADA_INICIAL').concat(Timeline.LEITURAS));
  }
  function corrigir(ctx, pedido) {
    return UnitOfWork.run(ctx, comando('corrigir', pedido));
  }
  function estornar(ctx, pedido) {
    return UnitOfWork.run(ctx, comando('estornar', pedido));
  }
  /** Prévia (evento.simular): pedido.acao = registrar | corrigir | estornar; mesmo tratador, sem gravar. */
  function simular(ctx, pedido) {
    var p = pedido || {};
    var c = comando(p.acao || 'registrar', { dados: p.dados, avisosAceitos: p.avisosAceitos, idempotencyKey: p.idempotencyKey || 'simulacao' });
    c.modo = 'SIMULAR';
    return UnitOfWork.run(ctx, c);
  }

  // ------------------------------------------------------------------ estado do motor ----
  function listasAtivas_(repo) {
    var out = {};
    repo.vigentes('LISTAS').forEach(function (l) {
      if (l.ativo === false) return;
      (out[l.lista] = out[l.lista] || []).push(l.codigo);
    });
    return out;
  }
  function motor_(tx, excluir, opcoes) {
    if (vazio_(tx.hoje)) throw interno_('Contexto sem fuso: não há como saber a data de hoje.');
    var params = Timeline.parametros(tx.repo);
    var f = Timeline.fonte(tx, { excluir: excluir, parametros: params });
    var m = {
      tx: tx, repo: tx.repo, params: params, D0: params.data_marco_zero, hoje: tx.hoje, f: f,
      real: excluir && excluir.length ? Timeline.fonte(tx, { parametros: params }) : f,
      col: Validation.coletor(), conflitos: [], avisos: [], listas: listasAtivas_(tx.repo), afetados: {}, cache: {},
      teto: params.json_celula_max_caracteres || Validation.TETO_CELULA,
      opcoes: opcoes || {}, conhecidos: (opcoes && opcoes.conhecidos) || {},
    };
    (excluir || []).forEach(function (id) { f.linhasDoEvento(id).forEach(function (l) { m.afetados[l.animal_id] = true; }); });
    return m;
  }
  /** Estado atual do animal (projeção gravada; recalculada sem os eventos excluídos quando ele é afetado). */
  function estado_(m, id) {
    if (vazio_(id)) return null;
    if (!(id in m.cache)) {
      var row = m.f.animal(id);
      if (!row) m.cache[id] = null;
      else if (m.afetados[id]) {
        var c = Timeline.projetarAnimal(m.f, id).campos;
        var o = {};
        Object.keys(row).forEach(function (k) { o[k] = row[k]; });
        Object.keys(c).forEach(function (k) { o[k] = c[k]; });
        m.cache[id] = o;
      } else m.cache[id] = row;
    }
    return m.cache[id];
  }
  function existente_(m, id) {
    var e = estado_(m, id);
    return e && e.situacao_cadastral !== 'ANULADO' && e.situacao_cadastral !== 'PENDENTE' ? e : null;
  }
  function nomeAnimal_(e) {
    if (!e) return 'animal';
    return !vazio_(e.brinco) ? e.brinco : e.codigo_interno;
  }
  function nomePasto_(m, id) {
    var p = m.f.pasto(id);
    return p ? p.nome : id;
  }
  function erroItem_(m, it, campo, codigo, mensagem) {
    m.col.erro({ codigo: codigo, animal_id: it.publico ? it.animal_id : null, brinco: it.brincoTexto || null, campo: campo, mensagem: it.quem + ': ' + mensagem });
  }
  function avisoItem_(m, it, codigo, mensagem, conflito) {
    m.avisos.push(Validation.detalhe({ codigo: codigo, animal_id: it && it.publico ? it.animal_id : null, brinco: it ? it.brincoTexto : null, mensagem: mensagem, conflito: conflito || null }));
  }
  function conflito_(m, it, p, mensagem) {
    m.conflitos.push(Validation.detalhe({
      codigo: p.codigo, animal_id: it.animal_id, brinco: it.brincoTexto || null, mensagem: it.quem + ': ' + mensagem,
      conflito: { event_id: p.event_id, tipo: p.event_subtype || p.event_type, data: p.event_date },
    }));
  }
  function erroGeral_(m, campo, codigo, mensagem) {
    m.col.erro({ codigo: codigo, campo: campo, mensagem: mensagem });
  }
  /** Erros de campo do catálogo, com o "quem" do item. */
  function camposDoItem_(m, it, definicoes, valores) {
    EventCatalog.validarCampos(definicoes, valores, { listas: m.listas }).forEach(function (d) { erroItem_(m, it, d.campo, d.codigo, d.mensagem); });
  }
  function pastoAtivo_(m, it, campo, id) {
    var p = m.f.pasto(id);
    if (!p) { erroItem_(m, it, campo, 'NAO_ENCONTRADO', 'o pasto informado não existe.'); return false; }
    if (p.status !== 'ATIVO') { erroItem_(m, it, campo, 'PASTO_INATIVO', 'o pasto ' + p.nome + ' está desativado.'); return false; }
    return true;
  }
  function exigirMarcoZero_(m) {
    if (vazio_(m.D0)) throw Validation.erro('CONFIG', 'Defina a data do marco zero (o dia do inventário inicial) nas configurações antes de registrar eventos.');
  }

  // ------------------------------------------------------------------ registrar / corrigir ----
  function alvo_(m, id, verbo) {
    if (vazio_(id)) { erroGeral_(m, 'event_id', 'CAMPO_OBRIGATORIO', 'Informe o evento a ' + verbo + '.'); return null; }
    var ev = m.tx.cru.cruPorId('EVENTOS', id);
    var st = ev ? m.tx.cru.avaliar(id).status : null;
    if (!ev || st === 'FALHOU' || st === 'PENDENTE') throw Validation.erro('NOT_FOUND', 'O evento informado não existe. Atualize a tela e tente de novo.');
    if (ev.event_type === 'ESTORNO') { erroGeral_(m, 'event_id', 'ESTORNO_NAO_SE_ESTORNA', 'Um estorno não pode ser ' + (verbo === 'estornar' ? 'estornado' : 'corrigido') + ': lance o evento de novo.'); return null; }
    if (st !== 'CONFIRMADO') { erroGeral_(m, 'event_id', 'JA_ANULADO', 'Este evento já foi estornado ou corrigido e não vale mais.'); return null; }
    return ev;
  }
  function planejarEvento_(tx, acao, opcoes) {
    var d = (opcoes && opcoes.dados) || tx.dados || {};
    var original = null;
    var m;
    if (acao === 'corrigir') {
      var pre = motor_(tx, []);
      exigirMarcoZero_(pre);
      original = alvo_(pre, d.event_id, 'corrigir');
      if (!original) return { erros: pre.col.erros };
      m = motor_(tx, [original.event_id]);
      if (vazio_(d.justificativa)) erroGeral_(m, 'justificativa', 'CAMPO_OBRIGATORIO', 'Diga por que o evento está sendo corrigido.');
    } else m = motor_(tx, [], opcoes);
    exigirMarcoZero_(m);
    var tipo = vazio_(d.tipo) && original ? original.event_type : d.tipo;
    var subtipo = vazio_(d.subtipo) ? (original ? nulo_(original.event_subtype) : null) : d.subtipo;
    if (vazio_(tipo) || !EventCatalog.existe(tipo)) return { erros: [Validation.detalhe({ codigo: 'TIPO_DESCONHECIDO', campo: 'tipo', mensagem: 'Escolha o tipo de evento.' })] };
    if (tipo === 'ESTORNO') return { erros: [Validation.detalhe({ codigo: 'TIPO_INVALIDO', campo: 'tipo', mensagem: 'Para estornar, use "Estornar evento".' })] };
    // Tipo com subtipos (correções, identificação, marcação): o subtipo diz o que se lança e é obrigatório.
    if (EventCatalog.ativo(tipo) && EventCatalog.subtipos(tipo).length && vazio_(subtipo)) {
      return { erros: [Validation.detalhe({ codigo: 'CAMPO_OBRIGATORIO', campo: 'subtipo', mensagem: tipo === 'AJUSTE_INVENTARIO' ? 'Escolha o tipo de correção.' : 'Escolha o que lançar em "' + EventCatalog.tipo(tipo).rotulo + '".' })] };
    }
    if (!EventCatalog.ativo(tipo, subtipo)) {
      return { erros: [Validation.detalhe({ codigo: 'TIPO_INDISPONIVEL', campo: vazio_(subtipo) ? 'tipo' : 'subtipo', mensagem: 'Este tipo de lançamento ainda não está disponível.' })] };
    }
    if (original && (original.event_type !== tipo || nulo_(original.event_subtype) !== subtipo)) {
      return { erros: [Validation.detalhe({ codigo: 'TIPO_DIFERENTE', campo: 'tipo', mensagem: 'A correção precisa ser do mesmo tipo do evento original. Para trocar o tipo, estorne e lance de novo.' })] };
    }
    var campos = d.campos || {};
    var animais = d.animais;
    var ev = cabecalho_(m, tipo, subtipo, campos, original);
    if (!Array.isArray(animais) || !animais.length) erroGeral_(m, 'animais', 'SEM_ANIMAIS', tipo === 'NASCIMENTO' ? 'Escolha a mãe (a vaca que pariu).' : 'Inclua ao menos um animal.');
    else if (animais.length > MAX_ANIMAIS) erroGeral_(m, 'animais', 'ANIMAIS_DEMAIS', 'Um lançamento aceita até ' + MAX_ANIMAIS + ' animais; divida em partes.');
    else if (tipo === 'NASCIMENTO' && animais.length > 1) { erroGeral_(m, 'animais', 'UMA_MATRIZ', 'Um parto é de uma vaca só: escolha só a mãe. Gêmeos vão como duas crias do mesmo parto.'); return { erros: m.col.erros }; }
    // Sem data válida ou sem lista de animais não há linha do tempo a conferir; os demais erros do cabeçalho seguem juntos com os dos animais.
    if (!Utils.dataValida(ev.event_date) || !Array.isArray(animais) || !animais.length || animais.length > MAX_ANIMAIS) return { erros: m.col.erros };
    // Data antes do marco zero num tipo sem registro histórico: a linha do tempo nem começou; só o erro da data.
    if (ev.event_date < m.D0 && ev.pre_marco_zero !== true) return { erros: m.col.erros };

    var plano = { EVENTOS: [], ANIMAIS: [], EVENTO_ANIMAIS: [], IDENTIFICACOES: [], PESAGENS: [], REPRODUCAO: [], BAIXAS: [], AJUSTES: [], COMPRAS: [], VENDAS: [], FINANCEIRO: [], PARCELAS: [], RATEIOS: [], ALOCACOES_FINANCEIRAS: [] };
    var ctxEv = { tipo: tipo, subtipo: subtipo, ev: ev, campos: campos, original: original, plano: plano, itens: [], criadosOriginal: {}, auditorias: [] };
    if (original) {
      m.f.linhasDoEvento(original.event_id).forEach(function (l) { if (l.atributos_iniciais_json) ctxEv.criadosOriginal[l.animal_id] = true; });
    }
    if (tipo === 'TRANSFERENCIA') cabecalhoTransferencia_(m, ctxEv);
    if (tipo === 'IDENTIFICACAO') cabecalhoIdentificacao_(m, ctxEv);
    if (tipo === 'MARCACAO') cabecalhoMarcacao_(m, ctxEv);
    if (tipo === 'COMPRA') cabecalhoCompra_(m, ctxEv);
    if (tipo === 'VENDA') cabecalhoVenda_(m, ctxEv);
    animais.forEach(function (item, i) {
      var it = novoItem_(m, item || {}, i);
      ctxEv.itens.push(it);
      if (tipo === 'AJUSTE_INVENTARIO') itemAjuste_(m, ctxEv, it);
      else if (tipo === 'TRANSFERENCIA') itemTransferencia_(m, ctxEv, it);
      else if (tipo === 'IDENTIFICACAO') itemIdentificacao_(m, ctxEv, it);
      else if (tipo === 'MARCACAO') itemMarcacao_(m, ctxEv, it);
      else if (tipo === 'MORTE' || tipo === 'DESCARTE') itemSaida_(m, ctxEv, it);
      else if (tipo === 'VENDA') itemVenda_(m, ctxEv, it);
      else if (tipo === 'NASCIMENTO') itemMatriz_(m, ctxEv, it);
      else itemEntrada_(m, ctxEv, it);
    });
    if (tipo === 'NASCIMENTO') crias_(m, ctxEv, d.crias);
    conferirRepetidos_(m, ctxEv);
    conferirBrincos_(m, ctxEv);
    conferirGenealogia_(m, ctxEv);
    conferirLinhaDoTempo_(m, ctxEv);
    if (original) conferirRemovidos_(m, ctxEv);
    conferirSequencias_(m, ctxEv, animaisConferidos_(m, ctxEv), ctxEv.ev.event_id);
    if (original) conferirEstadoRestaurado_(m, Object.keys(m.afetados).filter(function (id) { return !ctxEv.criadosOriginal[id]; }), 'a correção', ctxEv);
    guardaDuplicidade_(m, ctxEv);
    conferirLotacao_(m, ctxEv);
    if (tipo === 'NASCIMENTO') avisosDoParto_(m, ctxEv);
    if (tipo === 'ENTRADA_INICIAL') abertura_(m, ctxEv);
    if (tipo === 'COMPRA') financeiroCompra_(m, ctxEv, d);
    if (tipo === 'VENDA') { carenciaNaVenda_(m, ctxEv); financeiroVenda_(m, ctxEv, d); }
    if (tipo === 'MORTE' || tipo === 'DESCARTE') financeiroSaida_(m, ctxEv);
    if (original) {
      conferirParcelasLiquidadas_(m, original, 'corrigir');
      m.repo.por('FINANCEIRO', 'event_id', original.event_id).forEach(function (fin) {
        var a = FinancialService.avisoPeriodo(m.params, fin.data_competencia, 'A correção cancela um lançamento que');
        if (a) avisoItem_(m, null, a.codigo, a.mensagem);
      });
    }
    return fechar_(m, ctxEv);
  }
  /** Cabeçalho do evento: data, propriedade, textos; ENTRADA_INICIAL sempre no marco zero (RN-022). */
  function cabecalho_(m, tipo, subtipo, campos, original) {
    EventCatalog.validarCampos(EventCatalog.camposEvento(tipo, subtipo), campos, { listas: m.listas }).forEach(function (x) { erroGeral_(m, x.campo, x.codigo, x.mensagem); });
    var data = campos.event_date;
    if (tipo === 'ENTRADA_INICIAL') {
      if (!vazio_(data) && data !== m.D0) erroGeral_(m, 'event_date', 'FORA_DO_MARCO_ZERO', 'O rebanho inicial é sempre lançado na data do marco zero (' + br_(m.D0) + ').');
      data = m.D0;
    }
    var historico = false;
    if (Utils.dataValida(data)) {
      if (data > m.hoje) erroGeral_(m, 'event_date', 'DATA_FUTURA', 'A data ' + br_(data) + ' ainda não chegou.');
      if (data < m.D0 && ACEITA_HISTORICO.indexOf(tipo) >= 0) historico = true;
      else if (data < m.D0) erroGeral_(m, 'event_date', 'ANTES_DO_MARCO_ZERO', 'A data ' + br_(data) + ' é anterior ao marco zero (' + br_(m.D0) + '): o rebanho só é controlado a partir dele.');
    }
    var prop = vazio_(campos.property_id) ? m.params.propriedade_padrao_id : campos.property_id;
    if (vazio_(prop)) erroGeral_(m, 'property_id', 'CAMPO_OBRIGATORIO', 'Escolha a propriedade (ou defina a propriedade padrão nas configurações).');
    else {
      var p = m.repo.porId('PROPRIEDADES', prop);
      if (!p) erroGeral_(m, 'property_id', 'NAO_ENCONTRADO', 'A propriedade informada não existe.');
      else if (p.status !== 'ATIVO') erroGeral_(m, 'property_id', 'PROPRIEDADE_INATIVA', 'A propriedade ' + p.nome + ' está desativada.');
    }
    var seq = m.repo.contador('EVENTOS', 'event_seq');
    var imp = m.opcoes.importacao || null;
    return {
      event_id: m.tx.novoId(), event_seq: seq, ordem_seq: original ? m.f.ordemSeq(original.event_id) : seq,
      event_type: tipo, event_subtype: subtipo, event_date: data, registration_date: m.hoje, property_id: prop,
      description: nulo_(campos.description), total_value: null, responsible: nulo_(campos.responsible),
      created_by: m.tx.usuario, source: imp ? 'IMPORTACAO' : 'APP', confiabilidade: 'CONFIRMADA', pre_marco_zero: historico, partner_id: null,
      notes: nulo_(campos.notes), payload_json: null, reversal_of_event_id: original ? original.event_id : null, import_id: imp ? imp.import_id : null,
      justificativa: nulo_(campos.justificativa),
    };
  }
  function novoItem_(m, item, i) {
    var codigo = typeof item.brinco === 'string' ? Utils.aparar(item.brinco) : null;
    var existente = typeof item.animal_id === 'string' ? m.f.animal(item.animal_id) : null;
    var rotulo = m.opcoes.rotulos ? m.opcoes.rotulos[i] : null;
    var quem = !vazio_(rotulo) ? rotulo : !vazio_(codigo) ? 'Brinco ' + codigo : existente ? nomeAnimal_(existente) : 'Animal ' + (i + 1) + ' da lista';
    return { indice: i, dados: item, animal_id: null, publico: false, quem: quem, brincoTexto: vazio_(codigo) ? null : codigo, linhas: [], novo: false, final: {} };
  }
  /** Linha de EVENTO_ANIMAIS no plano e na forma da linha do tempo. */
  function linhaEA_(m, ctxEv, it, campos) {
    var r = { event_animal_id: m.tx.novoId(), event_id: ctxEv.ev.event_id, animal_id: it.animal_id, papel: 'SUJEITO' };
    Object.keys(campos).forEach(function (k) { r[k] = campos[k]; });
    ctxEv.plano.EVENTO_ANIMAIS.push(r);
    it.linhaEA = r;
    it.linhas.push(Timeline.linha(r, ctxEv.ev, ctxEv.ev.ordem_seq));
    return r;
  }

  // ------------------------------------------------------------------ entradas ----
  function itemEntrada_(m, ctxEv, it) {
    var d = it.dados;
    var tipo = ctxEv.tipo;
    var compra = tipo === 'COMPRA';
    var defs = EventCatalog.camposAnimal(tipo, null);
    if (!vazio_(d.animal_id) && !ctxEv.criadosOriginal[d.animal_id]) {
      if (!CAMPOS_REENTRADA[tipo]) { erroItem_(m, it, 'animal_id', 'SO_ANIMAIS_NOVOS', 'o rebanho inicial só cadastra animais novos; para um animal que já existe, use outra entrada.'); return; }
      return reentrada_(m, ctxEv, it, defs.filter(function (x) { return CAMPOS_REENTRADA[tipo].indexOf(x.id) >= 0; }));
    }
    camposDoItem_(m, it, defs.filter(function (x) { return x.id !== 'animal_id'; }), Object.keys(d).reduce(function (o, k) { if (k !== 'animal_id') o[k] = d[k]; return o; }, {}));
    // Na compra a origem é sempre COMPRADO (não é campo do formulário).
    if (compra) d = it.dados = Object.keys(d).reduce(function (o, k) { o[k] = d[k]; return o; }, { origem: 'COMPRADO' });
    var reuso = !vazio_(d.animal_id);
    it.novo = !reuso;
    it.reusado = reuso;
    if (reuso) {
      var ex = m.f.animal(d.animal_id);
      it.animal_id = d.animal_id;
      it.publico = true;
      it.codigo_interno = ex.codigo_interno;
      if (vazio_(it.brincoTexto)) it.quem = ex.codigo_interno;
      var cad = {};
      if (!vazio_(d.nome) && d.nome !== ex.nome) cad.nome = d.nome;
      if (!vazio_(d.raca) && d.raca !== ex.raca) cad.raca = d.raca;
      if (Object.keys(cad).length) ctxEv.auditorias.push({ id: it.animal_id, campos: cad });
    } else {
      it.animal_id = m.tx.novoId();
      it.codigo_interno = 'A-' + pad_(m.repo.contador('ANIMAIS', 'codigo_interno', extrairCodigo_), 6);
      if (vazio_(it.brincoTexto)) it.quem = it.quem + ' (' + it.codigo_interno + ')';
      ctxEv.plano.ANIMAIS.push({ animal_id: it.animal_id, codigo_interno: it.codigo_interno, nome: nulo_(d.nome), raca: nulo_(d.raca) });
    }
    var at = atributos_(m, ctxEv, it);
    if (!vazio_(d.pasto_destino_id)) pastoAtivo_(m, it, 'pasto_destino_id', d.pasto_destino_id);
    var pasto = nulo_(d.pasto_destino_id) || (compra ? nulo_(ctxEv.campos.pasto_destino_id) : null);
    var ea = { efeito_inventario: 1, pasto_destino_id: pasto, atributos_iniciais_json: at, observacoes: nulo_(d.observacoes) };
    if (tipo === 'ENTRADA_INICIAL') {
      if (typeof d.peso === 'number') ea.peso = d.peso;
      if (typeof d.valor_abertura === 'number') ea.valor_individual = d.valor_abertura;
    }
    if (compra) pesosDaCompra_(it, ea);
    linhaEA_(m, ctxEv, it, ea);
    identificacoes_(m, ctxEv, it);
    if (tipo === 'ENTRADA_INICIAL' && typeof d.peso === 'number' && !vazio_(d.metodo_pesagem)) {
      ctxEv.plano.PESAGENS.push({ weight_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ctxEv.ev.event_id, data_pesagem: ctxEv.ev.event_date, peso_kg: d.peso, metodo: d.metodo_pesagem, tipo: 'ENTRADA', observacoes: null });
    }
    if (compra) pesagemDaCompra_(m, ctxEv, it);
    if (at.sexo === 'F' && at.situacao_reprodutiva === 'PRENHA') {
      ctxEv.plano.REPRODUCAO.push({
        reproduction_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ctxEv.ev.event_id, tipo_evento: 'DIAGNOSTICO_GESTACAO',
        data: ctxEv.ev.event_date, metodo: 'INFORMADO', resultado: 'POSITIVO', data_prevista_parto: nulo_(at.data_prevista_parto),
      });
    }
  }
  /**
   * Volta ao rebanho de animal que já existe (OUTRA_ENTRADA, ou COMPRA de animal que tinha saído): só animal fora do
   * rebanho e não morto (RN-015, RN-016). Na compra, a linha traz também peso, carcaça e a base do rateio.
   */
  function reentrada_(m, ctxEv, it, defs) {
    var d = it.dados;
    var compra = ctxEv.tipo === 'COMPRA';
    var aceitos = CAMPOS_REENTRADA[ctxEv.tipo];
    var outros = Object.keys(d).filter(function (k) { return aceitos.indexOf(k) < 0 && !vazio_(d[k]); });
    camposDoItem_(m, it, defs, Object.keys(d).reduce(function (o, k) { if (aceitos.indexOf(k) >= 0) o[k] = d[k]; return o; }, {}));
    outros.forEach(function (k) { erroItem_(m, it, k, 'CAMPO_NAO_SE_APLICA', 'na volta de um animal já cadastrado não se informa "' + k + '": corrija o cadastro por "Corrigir dados do animal".'); });
    var e = existente_(m, d.animal_id);
    it.animal_id = d.animal_id;
    it.publico = true;
    if (!e) { erroItem_(m, it, 'animal_id', 'NAO_ENCONTRADO', 'animal não encontrado.'); return; }
    it.codigo_interno = e.codigo_interno;
    if (vazio_(it.brincoTexto)) it.quem = nomeAnimal_(e);
    if (e.situacao_cadastral === 'ATIVO') { erroItem_(m, it, 'animal_id', 'JA_NO_REBANHO', 'o animal já está no rebanho.'); return; }
    if (e.situacao_cadastral === 'MORTO') { erroItem_(m, it, 'animal_id', 'ANIMAL_MORTO', 'o animal morreu em ' + br_(e.data_saida) + ' e não pode voltar ao rebanho.'); return; }
    if (e.situacao_cadastral === 'EXTERNO') { erroItem_(m, it, 'animal_id', 'ANIMAL_EXTERNO', 'animal de referência (touro de sêmen, progenitor de outra fazenda) não entra no rebanho: ele é só um cadastro de referência. Se ele chegou à fazenda, lance a entrada como animal novo.'); return; }
    it.final = { sexo: e.sexo, data_nascimento: e.data_nascimento };
    if (!vazio_(d.pasto_destino_id)) pastoAtivo_(m, it, 'pasto_destino_id', d.pasto_destino_id);
    var pasto = nulo_(d.pasto_destino_id) || (compra ? nulo_(ctxEv.campos.pasto_destino_id) : null);
    var ea = { efeito_inventario: 1, pasto_destino_id: pasto, observacoes: nulo_(d.observacoes) };
    if (compra) pesosDaCompra_(it, ea);
    linhaEA_(m, ctxEv, it, ea);
    if (!vazio_(it.brincoTexto) && Utils.normalizarBrinco(it.brincoTexto) !== (e.brinco_norm || '')) identificacoes_(m, ctxEv, it);
    else {
      it.brincoProposto = null;
      if (compra) identificacoesExtras_(m, ctxEv, it);
    }
    if (compra) pesagemDaCompra_(m, ctxEv, it);
  }
  /** Peso vivo e de carcaça do animal na linha da compra; guarda o que a negociação usa (peso, carcaça, valor, base manual). */
  function pesosDaCompra_(it, ea) {
    var d = it.dados;
    if (typeof d.peso === 'number') ea.peso = d.peso;
    if (typeof d.peso_carcaca_kg === 'number') ea.peso_carcaca_kg = d.peso_carcaca_kg;
    it.negocio = {
      peso: typeof d.peso === 'number' ? d.peso : null, peso_carcaca_kg: typeof d.peso_carcaca_kg === 'number' ? d.peso_carcaca_kg : null,
      valor_individual: typeof d.valor_individual === 'number' ? d.valor_individual : null, base_manual: typeof d.base_manual === 'number' ? d.base_manual : null,
    };
  }
  /** Peso vivo individual da compra vira PESAGENS (tipo COMPRA; método padrão balança). Carcaça nunca vira pesagem. */
  function pesagemDaCompra_(m, ctxEv, it) {
    var d = it.dados;
    if (typeof d.peso !== 'number') return;
    ctxEv.plano.PESAGENS.push({ weight_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ctxEv.ev.event_id, data_pesagem: ctxEv.ev.event_date, peso_kg: d.peso, metodo: nulo_(d.metodo_pesagem) || 'BALANCA', tipo: 'COMPRA', observacoes: null });
  }
  /** atributos_iniciais_json (03b, seção 3.5) do item, com as regras de sexo, datas e reprodução. */
  function atributos_(m, ctxEv, it) {
    var d = it.dados;
    var data = ctxEv.ev.event_date;
    var at = { sexo: d.sexo, origem: d.origem };
    var nasc = nulo_(d.data_nascimento);
    var conf = nulo_(d.data_nascimento_confianca);
    if (typeof d.idade_meses === 'number' && Math.floor(d.idade_meses) === d.idade_meses) {
      if (nasc) erroItem_(m, it, 'idade_meses', 'CONFLITO_DE_CAMPOS', 'informe a data de nascimento ou a idade, não as duas.');
      else if (Utils.dataValida(data)) { nasc = menosMeses_(data, d.idade_meses); conf = 'ESTIMADA'; }
    }
    if (nasc && Utils.dataValida(nasc)) {
      at.data_nascimento = nasc;
      if (conf) at.data_nascimento_confianca = conf;
      if (Utils.dataValida(data) && nasc > data) erroItem_(m, it, 'data_nascimento', 'NASCIMENTO_DEPOIS_DA_ENTRADA', 'o nascimento (' + br_(nasc) + ') é depois da data do lançamento (' + br_(data) + ').');
    }
    if (!vazio_(d.raca)) at.raca = d.raca;
    if (d.sexo === 'M') {
      at.castrado = boolTexto_(d.castrado);
      at.reprodutor = boolTexto_(d.reprodutor);
      if (d.castrado === true && d.reprodutor === true) erroItem_(m, it, 'reprodutor', 'CASTRADO_REPRODUTOR', 'animal castrado não pode ser reprodutor.');
    }
    if (d.sexo === 'F') {
      if (typeof d.partos_previos === 'number') at.partos_previos = d.partos_previos;
      if (!vazio_(d.situacao_reprodutiva)) at.situacao_reprodutiva = d.situacao_reprodutiva;
      if (!vazio_(d.data_prevista_parto) && d.situacao_reprodutiva === 'PRENHA') {
        at.data_prevista_parto = d.data_prevista_parto;
        if (Utils.dataValida(d.data_prevista_parto) && d.data_prevista_parto <= data) erroItem_(m, it, 'data_prevista_parto', 'PREVISAO_PASSADA', 'a previsão de parto precisa ser depois de ' + br_(data) + '.');
      }
    }
    if (ctxEv.tipo === 'ENTRADA_INICIAL' && !vazio_(d.data_entrada) && Utils.dataValida(d.data_entrada)) {
      at.data_entrada = d.data_entrada;
      if (!vazio_(d.data_entrada_confianca)) at.data_entrada_confianca = d.data_entrada_confianca;
      if (d.data_entrada > m.D0) erroItem_(m, it, 'data_entrada', 'ENTRADA_DEPOIS_DO_MARCO_ZERO', 'a chegada na fazenda (' + br_(d.data_entrada) + ') não pode ser depois do marco zero.');
      if (nasc && d.data_entrada < nasc) erroItem_(m, it, 'data_entrada', 'ENTRADA_ANTES_DO_NASCIMENTO', 'a chegada na fazenda (' + br_(d.data_entrada) + ') é anterior ao nascimento (' + br_(nasc) + ').');
    }
    var mae = !vazio_(d.mae_id) || !vazio_(d.mae_ref);
    var pai = !vazio_(d.pai_id) || !vazio_(d.pai_ref);
    if (!vazio_(d.mae_id) && !vazio_(d.mae_ref)) erroItem_(m, it, 'mae_ref', 'CONFLITO_DE_CAMPOS', 'informe a mãe uma vez só.');
    if (!vazio_(d.pai_id) && !vazio_(d.pai_ref)) erroItem_(m, it, 'pai_ref', 'CONFLITO_DE_CAMPOS', 'informe o pai uma vez só.');
    if (mae && vazio_(d.mae_confianca)) erroItem_(m, it, 'mae_confianca', 'CAMPO_OBRIGATORIO', 'diga se a mãe é confirmada ou estimada.');
    if (pai && vazio_(d.pai_confianca)) erroItem_(m, it, 'pai_confianca', 'CAMPO_OBRIGATORIO', 'diga se o pai é confirmado ou estimado.');
    if (mae && !vazio_(d.mae_confianca)) at.mae_confianca = d.mae_confianca;
    if (pai && !vazio_(d.pai_confianca)) at.pai_confianca = d.pai_confianca;
    it.atributos = at;
    it.parentesco = { mae_id: nulo_(d.mae_id), mae_ref: nulo_(d.mae_ref), pai_id: nulo_(d.pai_id), pai_ref: nulo_(d.pai_ref) };
    it.final = { sexo: d.sexo, data_nascimento: nasc, data_entrada: nulo_(at.data_entrada), mudouSexo: true, mudouNascimento: true };
    return at;
  }
  /** Brinco e outras identificações do item (só no plano; a unicidade é conferida em conferirBrincos_). */
  function identificacoes_(m, ctxEv, it) {
    var d = it.dados;
    var data = ctxEv.ev.event_date;
    if (!vazio_(it.brincoTexto)) {
      it.brincoProposto = { codigo: it.brincoTexto, norm: Utils.normalizarBrinco(it.brincoTexto) };
      ctxEv.plano.IDENTIFICACOES.push({ ident_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ctxEv.ev.event_id, tipo: 'BRINCO', codigo: it.brincoTexto, codigo_norm: it.brincoProposto.norm, data_inicio: data, motivo: null, created_at: m.tx.agora });
    }
    identificacoesExtras_(m, ctxEv, it);
  }
  /** Brinco do vendedor (BRINCO_ORIGEM, sem unicidade; 03b, seção 16.9) e as demais identificações do item. */
  function identificacoesExtras_(m, ctxEv, it) {
    var d = it.dados;
    var data = ctxEv.ev.event_date;
    var origem = typeof d.brinco_origem === 'string' ? Utils.aparar(d.brinco_origem) : '';
    if (origem) ctxEv.plano.IDENTIFICACOES.push({ ident_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ctxEv.ev.event_id, tipo: 'BRINCO_ORIGEM', codigo: origem, codigo_norm: Utils.normalizarBrinco(origem), data_inicio: data, motivo: null, created_at: m.tx.agora });
    if (Array.isArray(d.outras_identificacoes)) {
      d.outras_identificacoes.forEach(function (x, k) {
        var t = x && x.tipo;
        var c = x && typeof x.codigo === 'string' ? Utils.aparar(x.codigo) : '';
        if (IDENT_EXTRAS.indexOf(t) < 0) { erroItem_(m, it, 'outras_identificacoes', 'VALOR_FORA_DA_LISTA', 'a identificação ' + (k + 1) + ' precisa ter tipo brinco de origem, RFID, SISBOV, tatuagem ou outro.'); return; }
        if (!c) { erroItem_(m, it, 'outras_identificacoes', 'CAMPO_OBRIGATORIO', 'a identificação ' + (k + 1) + ' está sem código.'); return; }
        ctxEv.plano.IDENTIFICACOES.push({ ident_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ctxEv.ev.event_id, tipo: t, codigo: c, codigo_norm: Utils.normalizarBrinco(c), data_inicio: data, motivo: null, created_at: m.tx.agora });
      });
    }
  }

  // ------------------------------------------------------------------ movimentos e saídas ----
  /**
   * Animal já cadastrado que é sujeito do evento (transferência, morte, descarte, matriz do parto): existe, não está
   * anulado e não é de fora do rebanho. A presença na data é da linha do tempo (conferirLinhaDoTempo_).
   */
  function sujeito_(m, it, verbo) {
    var d = it.dados;
    if (vazio_(d.animal_id)) { erroItem_(m, it, 'animal_id', 'CAMPO_OBRIGATORIO', 'escolha o animal.'); return null; }
    var e = existente_(m, d.animal_id);
    it.animal_id = d.animal_id;
    it.publico = true;
    if (!e) { erroItem_(m, it, 'animal_id', 'NAO_ENCONTRADO', 'animal não encontrado.'); return null; }
    it.codigo_interno = e.codigo_interno;
    it.estado = e;
    it.quem = nomeAnimal_(e);
    it.brincoTexto = nulo_(e.brinco);
    if (e.situacao_cadastral === 'EXTERNO') { erroItem_(m, it, 'animal_id', 'ANIMAL_EXTERNO', 'animal de fora do rebanho (touro de sêmen, progenitor de outra fazenda) não se ' + verbo + ': ele não está no inventário.'); return null; }
    return e;
  }
  function semAnimalId_(d) {
    return Object.keys(d).reduce(function (o, k) { if (k !== 'animal_id') o[k] = d[k]; return o; }, {});
  }
  /** Pastos do cabeçalho da transferência (RN-019): origem existe; destino existe, está ativo e é outro pasto. */
  function cabecalhoTransferencia_(m, ctxEv) {
    var c = ctxEv.campos;
    var ok = !vazio_(c.pasto_origem_id) && !vazio_(c.pasto_destino_id);
    if (!vazio_(c.pasto_origem_id) && !m.f.pasto(c.pasto_origem_id)) { erroGeral_(m, 'pasto_origem_id', 'NAO_ENCONTRADO', 'O pasto de origem não existe.'); ok = false; }
    if (!vazio_(c.pasto_destino_id)) {
      var p = m.f.pasto(c.pasto_destino_id);
      if (!p) { erroGeral_(m, 'pasto_destino_id', 'NAO_ENCONTRADO', 'O pasto de destino não existe.'); ok = false; }
      else if (p.status !== 'ATIVO') { erroGeral_(m, 'pasto_destino_id', 'PASTO_INATIVO', 'O pasto ' + p.nome + ' está desativado e não recebe animais.'); ok = false; }
    }
    if (ok && c.pasto_origem_id === c.pasto_destino_id) { erroGeral_(m, 'pasto_destino_id', 'DESTINO_IGUAL_ORIGEM', 'O pasto de destino precisa ser diferente do pasto de origem.'); ok = false; }
    ctxEv.transf = ok ? { pasto_origem_id: c.pasto_origem_id, pasto_destino_id: c.pasto_destino_id } : null;
  }
  /**
   * TRANSFERENCIA (04, seção 4.4): uma linha de movimento por animal, origem e destino do cabeçalho. A origem é
   * conferida pela linha do tempo na data (ORIGEM_DIVERGENTE por animal, RN-018); tudo ou nada (RN-028).
   */
  function itemTransferencia_(m, ctxEv, it) {
    camposDoItem_(m, it, EventCatalog.camposAnimal('TRANSFERENCIA'), semAnimalId_(it.dados));
    if (!sujeito_(m, it, 'transfere') || !ctxEv.transf) return;
    linhaEA_(m, ctxEv, it, { efeito_inventario: 0, pasto_origem_id: ctxEv.transf.pasto_origem_id, pasto_destino_id: ctxEv.transf.pasto_destino_id });
  }
  /**
   * MORTE e DESCARTE (04, seção 4.3; 03b, seção 8): saída (−1) com a origem tirada da linha do tempo no dia (antes
   * das saídas daquele dia) e uma linha de BAIXAS por animal com causa e diagnóstico (morte) ou motivo e destino
   * (descarte). A situação final (MORTO, DESCARTADO) é projeção; MORTO é terminal (RN-015).
   */
  function itemSaida_(m, ctxEv, it) {
    var d = it.dados;
    var c = ctxEv.campos;
    var ev = ctxEv.ev;
    camposDoItem_(m, it, EventCatalog.camposAnimal(ctxEv.tipo), semAnimalId_(d));
    if (!sujeito_(m, it, ctxEv.tipo === 'MORTE' ? 'registra como morto' : 'descarta')) return;
    var onde = Timeline.pastoAntesDaSaida(m.f.linhas(it.animal_id), ev.event_date, m.D0);
    it.origemDerivada = true;
    linhaEA_(m, ctxEv, it, { efeito_inventario: -1, pasto_origem_id: onde.presente ? nulo_(onde.pasture_id) : null, observacoes: nulo_(d.observacoes) });
    var morte = ctxEv.tipo === 'MORTE';
    ctxEv.plano.BAIXAS.push({
      baixa_id: m.tx.novoId(), event_id: ev.event_id, animal_id: it.animal_id, tipo: ctxEv.tipo,
      causa: morte ? nulo_(c.causa) : null, diagnostico: morte ? nulo_(c.diagnostico) : null,
      motivo: morte ? null : nulo_(c.motivo), destino: morte ? null : nulo_(c.destino),
      responsavel: nulo_(ev.responsible), observacoes: nulo_(d.observacoes),
    });
  }

  // ------------------------------------------------------------------ identificação e marcação ----
  /** Tipo de identificação do lançamento (03a, 4.4): o brinco do vendedor só nasce na compra; aqui ele só sai. */
  function cabecalhoIdentificacao_(m, ctxEv) {
    var t = ctxEv.campos.tipo_identificacao;
    ctxEv.identTipo = null;
    if (EventCatalog.TIPOS_IDENTIFICACAO.indexOf(t) < 0) return;
    if (t === 'BRINCO_ORIGEM' && ctxEv.subtipo !== 'REMOCAO') { erroGeral_(m, 'tipo_identificacao', 'TIPO_NAO_SE_APLICA', 'O brinco do vendedor é registrado na compra; aqui ele só pode ser retirado.'); return; }
    ctxEv.identTipo = t;
  }
  /** Código em uso de um tipo de identificação logo antes da posição do comando (sem os eventos excluídos), ou null. */
  function identificacaoAntes_(m, animalId, tipo, pos) {
    var emUso = null;
    Timeline.identificacoes(m.f, animalId).forEach(function (x) {
      if (x.tipo !== tipo || !antesDe_({ data: x.data_inicio, ordem_seq: x.ordem_seq, event_seq: x.event_seq }, pos)) return;
      emUso = x.remocao ? null : x;
    });
    return emUso;
  }
  /**
   * IDENTIFICACAO (04, seção 4.4; 03a, seção 4.4): primeira identificação, troca (com motivo) ou retirada (com motivo)
   * de um tipo de identificação, coletiva. Fato independente: o animal precisa estar no rebanho na data (o dia da saída
   * conta). Cada animal ganha uma linha de EVENTO_ANIMAIS (efeito 0) e uma de IDENTIFICACOES com o tipo do lançamento:
   * o código novo (a projeção fecha o anterior em `data_fim`) ou, na retirada, o código tirado (a linha fecha o código
   * e a si mesma). A ordem das identificações (primeira sem código em uso; troca e retirada com) é conferida por
   * `Timeline.validarIdentificacoes`; o brinco novo passa pela unicidade e pelo bloqueio de reuso (conferirBrincos_).
   */
  function itemIdentificacao_(m, ctxEv, it) {
    var d = it.dados;
    var ev = ctxEv.ev;
    var sub = ctxEv.subtipo;
    camposDoItem_(m, it, EventCatalog.camposAnimal('IDENTIFICACAO', sub), d);
    if (vazio_(d.animal_id)) return;
    var e = sujeito_(m, it, 'identifica');
    if (!e || !ctxEv.identTipo || !Utils.dataValida(ev.event_date)) return;
    var tipo = ctxEv.identTipo;
    var nomeTipo = Timeline.NOME_IDENTIFICACAO[tipo];
    var semZeros = m.params.brinco_ignora_zeros_esquerda !== false;
    var chave = function (c) { return Utils.normalizarBrinco(c, tipo === 'BRINCO' && !semZeros); };
    var emUso = identificacaoAntes_(m, it.animal_id, tipo, posicao_(ev));
    var row = { ident_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ev.event_id, tipo: tipo, data_inicio: ev.event_date, motivo: sub === 'PRIMEIRA_IDENTIFICACAO' ? null : nulo_(d.motivo), created_at: m.tx.agora };
    if (sub === 'REMOCAO') {
      if (!emUso) { erroItem_(m, it, 'animal_id', 'SEM_IDENTIFICACAO', 'em ' + br_(ev.event_date) + ' o animal não tinha ' + nomeTipo + ' para tirar.'); return; }
      row.codigo = emUso.codigo;
      row.codigo_norm = emUso.codigo_norm;
      it.quem = nomeAnimal_(e) + ' (tira o ' + nomeTipo + ' ' + emUso.codigo + ')';
    } else {
      var codigo = typeof d.codigo === 'string' ? Utils.aparar(d.codigo) : '';
      if (!codigo) return;
      if (emUso && chave(emUso.codigo) === chave(codigo)) { erroItem_(m, it, 'codigo', 'VALOR_IGUAL', 'o ' + nomeTipo + ' ' + codigo + ' já é o que o animal usa.'); return; }
      row.codigo = codigo;
      row.codigo_norm = Utils.normalizarBrinco(codigo);
      if (tipo === 'BRINCO') {
        it.brincoProposto = { codigo: codigo, norm: row.codigo_norm };
        it.quem = nomeAnimal_(e) + ' (novo brinco ' + codigo + ')';
      }
    }
    linhaEA_(m, ctxEv, it, { efeito_inventario: 0, observacoes: typeof d.observacoes === 'string' ? nulo_(Utils.aparar(d.observacoes)) : null });
    ctxEv.plano.IDENTIFICACOES.push(row);
  }
  /**
   * Ação da marcação (03b, seção 2.6): `acao` no payload, com o motivo do descarte (só na marcação para descarte). O
   * payload nasce aqui para que as linhas da linha do tempo do comando já levem a ação (validarMarcacoes).
   */
  function cabecalhoMarcacao_(m, ctxEv) {
    var c = ctxEv.campos;
    ctxEv.ev.payload_json = { acao: nulo_(c.acao), motivo_descarte: ctxEv.subtipo === 'DESCARTE' && c.acao === 'MARCAR' ? nulo_(c.motivo_descarte) : null };
  }
  /**
   * MARCACAO (04, seção 4.4): marca ou desmarca o animal "para descarte" ou "não localizado". Não mexe no inventário;
   * o animal precisa estar no rebanho na data; marcar o já marcado (ou desmarcar o desmarcado) é recusado pela
   * sequência das marcações (`Timeline.validarMarcacoes`). A projeção é `marcado_descarte` / `nao_localizado`.
   */
  function itemMarcacao_(m, ctxEv, it) {
    var d = it.dados;
    camposDoItem_(m, it, EventCatalog.camposAnimal('MARCACAO', ctxEv.subtipo), d);
    if (vazio_(d.animal_id)) return;
    if (!sujeito_(m, it, 'marca')) return;
    linhaEA_(m, ctxEv, it, { efeito_inventario: 0, observacoes: typeof d.observacoes === 'string' ? nulo_(Utils.aparar(d.observacoes)) : null });
  }

  // ------------------------------------------------------------------ nascimento ----
  /** A matriz do parto (papel MATRIZ, efeito 0): fêmea do rebanho; a presença na data é conferida como fato (RN-017). */
  function itemMatriz_(m, ctxEv, it) {
    camposDoItem_(m, it, EventCatalog.camposAnimal('NASCIMENTO'), semAnimalId_(it.dados));
    var e = sujeito_(m, it, 'registra como mãe');
    if (!e) return;
    if (e.sexo !== 'F') { erroItem_(m, it, 'animal_id', 'MATRIZ_NAO_FEMEA', 'só uma fêmea pode ser a mãe de um parto.'); return; }
    ctxEv.matriz = it;
    linhaEA_(m, ctxEv, it, { papel: 'MATRIZ', efeito_inventario: 0 });
  }
  /**
   * Crias do parto (grupo repetível `crias`; 04, seção 4.2; 03b, seções 3.5, 7 e 16.8): cada nascida viva cria um
   * animal (+1, papel CRIA) com mãe = matriz, nascimento = data do parto, origem NASCIDO, pasto do cabeçalho ou o da
   * mãe no dia, raça da mãe por padrão, brinco opcional e peso ao nascer em PESAGENS (NASCIMENTO); natimorto não cria
   * animal. Sempre uma linha REPRODUCAO (PARTO) na matriz, com vivos e natimortos (RN-062, RN-063).
   */
  function crias_(m, ctxEv, lista) {
    var ev = ctxEv.ev;
    var c = ctxEv.campos;
    var mat = ctxEv.matriz || null;
    var hist = ev.pre_marco_zero === true;
    if (!Array.isArray(lista) || !lista.length) { erroGeral_(m, 'crias', 'SEM_CRIAS', 'Informe a cria do parto (nascida viva ou natimorta).'); return; }
    if (lista.length > MAX_CRIAS) { erroGeral_(m, 'crias', 'CRIAS_DEMAIS', 'Um parto aceita no máximo ' + MAX_CRIAS + ' crias.'); return; }
    var pasto = nulo_(c.pasto_destino_id);
    if (pasto) {
      var p = m.f.pasto(pasto);
      if (!p) erroGeral_(m, 'pasto_destino_id', 'NAO_ENCONTRADO', 'O pasto informado para as crias não existe.');
      else if (!hist && p.status !== 'ATIVO') erroGeral_(m, 'pasto_destino_id', 'PASTO_INATIVO', 'O pasto ' + p.nome + ' está desativado e não recebe animais.');
    } else if (mat && !hist) {
      var onde = Timeline.pastoAntesDaSaida(m.f.linhas(mat.animal_id), ev.event_date, m.D0);
      pasto = onde.presente ? nulo_(onde.pasture_id) : null;
      if (onde.presente && !pasto) erroGeral_(m, 'pasto_destino_id', 'CAMPO_OBRIGATORIO', 'A mãe está sem pasto registrado em ' + br_(ev.event_date) + ': escolha o pasto das crias.');
    }
    var defs = EventCatalog.camposGrupo('NASCIMENTO', 'crias');
    var vivos = 0;
    var natimortos = 0;
    lista.forEach(function (bruto, k) {
      var d = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
      var codigo = typeof d.brinco === 'string' && !vazio_(Utils.aparar(d.brinco)) ? Utils.aparar(d.brinco) : null;
      var it = { indice: k, dados: d, animal_id: null, publico: false, quem: 'Cria ' + (k + 1) + (codigo ? ' (brinco ' + codigo + ')' : ''), brincoTexto: codigo, linhas: [], novo: false, final: {}, cria: true };
      camposDoItem_(m, it, defs, semAnimalId_(d));
      if (d.situacao_nascimento === 'NATIMORTO') { natimortos++; return; }
      if (d.situacao_nascimento !== 'VIVO') return;
      vivos++;
      ctxEv.itens.push(it);
      criaViva_(m, ctxEv, it, pasto);
    });
    ctxEv.parto = { nascidos_vivos: vivos, natimortos: natimortos, pasto_destino_id: pasto, historico: hist };
    if (!mat) return;
    ctxEv.plano.REPRODUCAO.push({
      reproduction_id: m.tx.novoId(), animal_id: mat.animal_id, event_id: ev.event_id, tipo_evento: 'PARTO', data: ev.event_date,
      touro_id: nulo_(c.pai_id), qtd_nascidos_vivos: vivos, qtd_natimortos: natimortos, tipo_parto: nulo_(c.tipo_parto), data_parto: ev.event_date,
    });
  }
  function criaViva_(m, ctxEv, it, pasto) {
    var d = it.dados;
    var c = ctxEv.campos;
    var ev = ctxEv.ev;
    var mat = ctxEv.matriz || null;
    var hist = ev.pre_marco_zero === true;
    var reuso = !vazio_(d.animal_id);
    if (reuso && !ctxEv.criadosOriginal[d.animal_id]) { erroItem_(m, it, 'animal_id', 'SO_ANIMAIS_NOVOS', 'a cria de um parto é sempre um animal novo.'); return; }
    var raca = !vazio_(d.raca) ? d.raca : mat && mat.estado ? nulo_(mat.estado.raca) : null;
    it.novo = !reuso;
    it.reusado = reuso;
    if (reuso) {
      var ex = m.f.animal(d.animal_id);
      it.animal_id = d.animal_id;
      it.publico = true;
      it.codigo_interno = ex.codigo_interno;
      var cad = {};
      if (!vazio_(d.nome) && d.nome !== ex.nome) cad.nome = d.nome;
      if (!vazio_(raca) && raca !== ex.raca) cad.raca = raca;
      if (Object.keys(cad).length) ctxEv.auditorias.push({ id: it.animal_id, campos: cad });
    } else {
      it.animal_id = m.tx.novoId();
      it.codigo_interno = 'A-' + pad_(m.repo.contador('ANIMAIS', 'codigo_interno', extrairCodigo_), 6);
      ctxEv.plano.ANIMAIS.push({ animal_id: it.animal_id, codigo_interno: it.codigo_interno, nome: nulo_(d.nome), raca: raca });
    }
    if (vazio_(it.brincoTexto)) it.quem = it.quem + ' (' + it.codigo_interno + ')';
    var at = { sexo: d.sexo, data_nascimento: ev.event_date, data_nascimento_confianca: 'CONFIRMADA', origem: 'NASCIDO' };
    if (raca) at.raca = raca;
    if (d.sexo === 'M') { at.castrado = 'N'; at.reprodutor = 'N'; }
    if (mat) { at.mae_id = mat.animal_id; at.mae_confianca = 'CONFIRMADA'; }
    if (!vazio_(c.pai_id)) { at.pai_id = c.pai_id; if (!vazio_(c.pai_confianca)) at.pai_confianca = c.pai_confianca; }
    it.atributos = at;
    // A genealogia (mãe fêmea, pai macho, nascimentos, ciclos) é a mesma das entradas; o aviso de idade da mãe é do parto.
    it.parentesco = { mae_id: mat ? mat.animal_id : null, mae_ref: null, pai_id: nulo_(c.pai_id), pai_ref: null };
    it.semAvisoIdade = true;
    it.final = { sexo: d.sexo, data_nascimento: ev.event_date, data_entrada: null, mudouSexo: true, mudouNascimento: true };
    var ea = { papel: 'CRIA', efeito_inventario: hist ? 0 : 1, pasto_destino_id: nulo_(pasto), atributos_iniciais_json: at, observacoes: nulo_(d.observacoes) };
    if (typeof d.peso === 'number') ea.peso = d.peso;
    linhaEA_(m, ctxEv, it, ea);
    identificacoes_(m, ctxEv, it);
    if (typeof d.peso === 'number' && !vazio_(d.metodo_pesagem)) {
      ctxEv.plano.PESAGENS.push({ weight_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ev.event_id, data_pesagem: ev.event_date, peso_kg: d.peso, metodo: d.metodo_pesagem, tipo: 'NASCIMENTO', observacoes: null });
    }
  }
  /** Avisos do parto na matriz (RN-061 idade reprodutiva; RN-064 intervalo entre partos), uma vez por parto. */
  function avisosDoParto_(m, ctxEv) {
    var mat = ctxEv.matriz;
    if (!mat || !mat.estado || !Utils.dataValida(ctxEv.ev.event_date)) return;
    var outros = ReproductionService.partos(m.f, mat.animal_id);
    ReproductionService.avisosParto(m.params, mat.estado, ctxEv.ev.event_date, outros).forEach(function (a) {
      avisoItem_(m, mat, a.codigo, mat.quem + ': ' + a.mensagem);
    });
  }

  // ------------------------------------------------------------------ ajustes ----
  function itemAjuste_(m, ctxEv, it) {
    var d = it.dados;
    camposDoItem_(m, it, EventCatalog.camposAnimal('AJUSTE_INVENTARIO', ctxEv.subtipo), d);
    if (vazio_(d.animal_id)) return;
    var e = existente_(m, d.animal_id);
    it.animal_id = d.animal_id;
    it.publico = true;
    if (!e) { erroItem_(m, it, 'animal_id', 'NAO_ENCONTRADO', 'animal não encontrado.'); return; }
    it.codigo_interno = e.codigo_interno;
    it.estado = e;
    it.quem = nomeAnimal_(e);
    it.brincoTexto = nulo_(e.brinco);
    if (e.situacao_cadastral === 'EXTERNO') { erroItem_(m, it, 'animal_id', 'ANIMAL_EXTERNO', 'animal de fora do rebanho é corrigido pela edição do cadastro de referência.'); return; }
    if (ctxEv.subtipo === 'CORRECAO_CADASTRO') return correcaoCadastro_(m, ctxEv, it, e);
    if (ctxEv.subtipo === 'IDENTIFICACAO_INCORRETA') return identificacaoIncorreta_(m, ctxEv, it, e);
    if (ctxEv.subtipo === 'RECLASSIFICACAO') return reclassificacao_(m, ctxEv, it, e);
    if (ctxEv.subtipo === 'DIVERGENCIA_CONTAGEM') return divergenciaContagem_(m, ctxEv, it);
    return correcaoLocalizacao_(m, ctxEv, it, e);
  }
  /** Posição do evento do comando na ordem dos fatos (data, posição na cadeia de substituição, event_seq). */
  function posicao_(ev) {
    return { data: ev.event_date, ordem_seq: ev.ordem_seq, event_seq: ev.event_seq };
  }
  function antesDe_(x, pos) {
    return x.data < pos.data || (x.data === pos.data && (x.ordem_seq < pos.ordem_seq || (x.ordem_seq === pos.ordem_seq && x.event_seq < pos.event_seq)));
  }
  /** Categoria manual que valia para o animal logo antes da posição do comando (null = automática). */
  function reclassificacaoAntes_(m, animalId, pos) {
    var ultima = null;
    m.f.ajustes(animalId).forEach(function (a) {
      if (a.tipo_ajuste !== 'RECLASSIFICACAO') return;
      var ev = m.f.evento(a.event_id);
      if (!ev) return;
      var x = { data: ev.event_date, ordem_seq: m.f.ordemSeq(a.event_id), event_seq: ev.event_seq, a: a };
      if (!antesDe_(x, pos)) return;
      if (!ultima || antesDe_(ultima, x)) ultima = x;
    });
    return ultima ? nulo_(ultima.a.valor_novo) : null;
  }
  /**
   * RECLASSIFICACAO (04, seção 4.6; 03b, seção 9): categoria escolhida à mão (MANUAL) ou volta à automática (vazio).
   * A categoria precisa existir, estar ativa e servir ao sexo do animal; idade e condição não contam (a escolha manual
   * vale sobre a regra). Grava AJUSTES (`categoria_manual_id`, valor que valia antes → novo); o projetor faz o resto.
   */
  function reclassificacao_(m, ctxEv, it, e) {
    var nova = nulo_(it.dados.categoria_manual_id);
    var cat = nova ? m.repo.porId('CATEGORIAS', nova) : null;
    if (nova) {
      if (!cat) { erroItem_(m, it, 'categoria_manual_id', 'NAO_ENCONTRADO', 'a categoria escolhida não existe. Atualize a tela e escolha de novo.'); return; }
      if (cat.ativo === false) { erroItem_(m, it, 'categoria_manual_id', 'CATEGORIA_INATIVA', 'a categoria ' + cat.nome + ' está desativada.'); return; }
      if (cat.sexo_aplicavel !== 'AMBOS' && cat.sexo_aplicavel !== e.sexo) { erroItem_(m, it, 'categoria_manual_id', 'CATEGORIA_INCOMPATIVEL', 'a categoria ' + cat.nome + ' é só de ' + (cat.sexo_aplicavel === 'M' ? 'machos' : 'fêmeas') + '.'); return; }
    }
    if (!Utils.dataValida(ctxEv.ev.event_date)) return;
    var antes = reclassificacaoAntes_(m, it.animal_id, posicao_(ctxEv.ev));
    if (antes === nova) {
      var nomeAntes = cat ? cat.nome : '';
      erroItem_(m, it, 'categoria_manual_id', 'VALOR_IGUAL', nova ? 'o animal já está na categoria ' + nomeAntes + ' em ' + br_(ctxEv.ev.event_date) + '.' : 'o animal já está na categoria automática em ' + br_(ctxEv.ev.event_date) + '.');
      return;
    }
    linhaEA_(m, ctxEv, it, { efeito_inventario: 0 });
    ajusteRow_(m, ctxEv, it, 'categoria_manual_id', antes, nova);
  }
  /**
   * DIVERGENCIA_CONTAGEM (04, seção 4.6; 03b, seções 8 e 16.15): animal dado como perdido na contagem. Saída (−1) com
   * a origem da linha do tempo no dia e uma linha de BAIXAS (tipo DIVERGENCIA_CONTAGEM, sem causa; observações =
   * em que contagem faltou, ou a justificativa do lançamento). Situação BAIXADO_AJUSTE (projeção); se o animal
   * reaparecer, estorna-se a baixa. Não grava AJUSTES (não corrige campo).
   */
  function divergenciaContagem_(m, ctxEv, it) {
    var ev = ctxEv.ev;
    var obs = typeof it.dados.observacoes === 'string' ? nulo_(Utils.aparar(it.dados.observacoes)) : null;
    var onde = Timeline.pastoAntesDaSaida(m.f.linhas(it.animal_id), ev.event_date, m.D0);
    it.origemDerivada = true;
    linhaEA_(m, ctxEv, it, { efeito_inventario: -1, pasto_origem_id: onde.presente ? nulo_(onde.pasture_id) : null, observacoes: obs });
    ctxEv.plano.BAIXAS.push({
      baixa_id: m.tx.novoId(), event_id: ev.event_id, animal_id: it.animal_id, tipo: 'DIVERGENCIA_CONTAGEM', causa: null, diagnostico: null,
      motivo: null, destino: null, responsavel: nulo_(ev.responsible), observacoes: obs || nulo_(ev.justificativa),
    });
  }
  function textoCampo_(campo, v) {
    if (vazio_(v)) return null;
    if (campo === 'castrado' || campo === 'reprodutor') return v === true || v === 'S' ? 'S' : 'N';
    return String(v);
  }
  function ajusteRow_(m, ctxEv, it, campo, anterior, novo) {
    ctxEv.plano.AJUSTES.push({
      ajuste_id: m.tx.novoId(), event_id: ctxEv.ev.event_id, animal_id: it.animal_id, entidade: 'ANIMAIS', entity_id: it.animal_id,
      tipo_ajuste: ctxEv.subtipo, campo: campo, valor_anterior: anterior, valor_novo: novo, justificativa: ctxEv.ev.justificativa,
    });
  }
  /** Correções do mesmo animal ficam juntas: uma linha de EVENTO_ANIMAIS, uma de AJUSTES por campo. */
  function correcaoCadastro_(m, ctxEv, it, e) {
    var campo = it.dados.campo;
    var def = EventCatalog.CAMPOS_CORRIGIVEIS[campo];
    if (!def) return;
    var grupo = ctxEv.porAnimal = ctxEv.porAnimal || {};
    var g = grupo[it.animal_id];
    if (!g) {
      g = grupo[it.animal_id] = { it: it, campos: {}, estado: e };
      it.final = { sexo: e.sexo, data_nascimento: e.data_nascimento, data_entrada: e.data_entrada, mudouSexo: false, mudouNascimento: false };
      it.parentesco = null;
      linhaEA_(m, ctxEv, it, { efeito_inventario: 0 });
    } else it.ignorarNaLinhaDoTempo = true;
    if (g.campos[campo] !== undefined) { erroItem_(m, it, 'campo', 'CAMPO_REPETIDO', 'o campo "' + campo + '" aparece duas vezes para o mesmo animal.'); return; }
    var texto = vazio_(it.dados.valor_novo) ? null : Utils.aparar(String(it.dados.valor_novo));
    var valor = valorCorrigido_(m, it, campo, def, texto);
    if (valor === undefined) return;
    var atual = e[campo] === undefined ? null : e[campo];
    if (textoCampo_(campo, atual) === textoCampo_(campo, valor)) { erroItem_(m, it, 'valor_novo', 'VALOR_IGUAL', 'o valor informado para "' + campo + '" já é o atual.'); return; }
    g.campos[campo] = valor;
    ajusteRow_(m, ctxEv, it, campo, textoCampo_(campo, atual), textoCampo_(campo, valor));
    var princ = g.it;
    if (campo === 'sexo') { princ.final.sexo = valor; princ.final.mudouSexo = true; }
    if (campo === 'data_nascimento') { princ.final.data_nascimento = valor; princ.final.mudouNascimento = true; }
    if (campo === 'data_entrada') princ.final.data_entrada = valor;
    if (campo === 'mae_id' || campo === 'pai_id') {
      princ.parentesco = princ.parentesco || { mae_id: e.mae_id, pai_id: e.pai_id, mudouMae: false, mudouPai: false };
      princ.parentesco[campo] = valor;
      princ.parentesco[campo === 'mae_id' ? 'mudouMae' : 'mudouPai'] = true;
    }
  }
  /** valor_novo (texto canônico) → valor do tipo do campo; undefined = inválido (erro já anotado). */
  function valorCorrigido_(m, it, campo, def, texto) {
    if (texto === null) {
      if (campo === 'sexo' || campo === 'origem' || campo === 'castrado' || campo === 'reprodutor') { erroItem_(m, it, 'valor_novo', 'CAMPO_OBRIGATORIO', 'informe o valor correto de "' + campo + '".'); return undefined; }
      return null;
    }
    if (def.tipo === 'data' && !Utils.dataValida(texto)) { erroItem_(m, it, 'valor_novo', 'FORMATO_INVALIDO', '"' + texto + '" não é uma data válida (aaaa-mm-dd).'); return undefined; }
    if (def.tipo === 'data' && texto > m.hoje) { erroItem_(m, it, 'valor_novo', 'DATA_FUTURA', 'a data ' + br_(texto) + ' ainda não chegou.'); return undefined; }
    if (def.tipo === 'lista' && def.opcoes.indexOf(texto) < 0) { erroItem_(m, it, 'valor_novo', 'VALOR_FORA_DA_LISTA', '"' + texto + '" não é uma opção de "' + campo + '".'); return undefined; }
    if (def.tipo === 'bool') {
      if (texto !== 'S' && texto !== 'N') { erroItem_(m, it, 'valor_novo', 'VALOR_FORA_DA_LISTA', 'use S ou N em "' + campo + '".'); return undefined; }
      return texto === 'S';
    }
    if (def.tipo === 'inteiro') {
      if (!/^\d+$/.test(texto) || Number(texto) > def.max) { erroItem_(m, it, 'valor_novo', 'VALOR_FORA_DA_FAIXA', '"' + campo + '" precisa ser um número inteiro de ' + def.min + ' a ' + def.max + '.'); return undefined; }
      return Number(texto);
    }
    return texto;
  }
  /** Coerência do animal depois das correções (sexo × castrado/partos, confianças, data de entrada). */
  function fecharCorrecoes_(m, ctxEv) {
    var grupo = ctxEv.porAnimal || {};
    Object.keys(grupo).forEach(function (id) {
      var g = grupo[id];
      var it = g.it;
      var e = g.estado;
      var fim = {};
      ['sexo', 'castrado', 'reprodutor', 'partos_previos', 'mae_id', 'mae_confianca', 'pai_id', 'pai_confianca', 'data_nascimento', 'data_nascimento_confianca', 'data_entrada', 'data_entrada_confianca'].forEach(function (c) {
        fim[c] = g.campos[c] !== undefined ? g.campos[c] : e[c] === undefined ? null : e[c];
      });
      if (fim.sexo === 'F' && (g.campos.castrado !== undefined || g.campos.reprodutor !== undefined)) erroItem_(m, it, 'campo', 'NAO_SE_APLICA', 'castrado e reprodutor só se aplicam a machos.');
      if (fim.sexo === 'M' && g.campos.partos_previos !== undefined) erroItem_(m, it, 'campo', 'NAO_SE_APLICA', 'partos anteriores só se aplicam a fêmeas.');
      if (fim.sexo === 'M' && fim.castrado === true && fim.reprodutor === true && (g.campos.castrado !== undefined || g.campos.reprodutor !== undefined)) erroItem_(m, it, 'campo', 'CASTRADO_REPRODUTOR', 'animal castrado não pode ser reprodutor.');
      // Apagar a mãe, o pai ou uma data apaga também a confiança (que deixaria de ter a que se referir).
      [['mae_id', 'mae_confianca'], ['pai_id', 'pai_confianca'], ['data_nascimento', 'data_nascimento_confianca']].forEach(function (par) {
        if (g.campos[par[0]] === null && g.campos[par[1]] === undefined && !vazio_(e[par[1]])) {
          ajusteRow_(m, ctxEv, it, par[1], textoCampo_(par[1], e[par[1]]), null);
          fim[par[1]] = null;
        }
        if (!vazio_(fim[par[0]]) && vazio_(fim[par[1]])) erroItem_(m, it, par[1], 'CAMPO_OBRIGATORIO', 'informe também "' + par[1] + '".');
        if (vazio_(fim[par[0]]) && !vazio_(g.campos[par[1]])) erroItem_(m, it, par[1], 'CAMPO_SEM_VINCULO', '"' + par[1] + '" precisa de "' + par[0] + '" preenchido.');
      });
      if (g.campos.data_entrada !== undefined || g.campos.data_entrada_confianca !== undefined) {
        var entrada = Timeline.ordenar(m.f.linhas(id).filter(function (l) { return l.efeito === 1 && !l.pre_marco_zero; })).pop();
        if (!entrada || entrada.event_type !== 'ENTRADA_INICIAL') erroItem_(m, it, 'campo', 'NAO_SE_APLICA', 'a data de chegada só se corrige em animal do rebanho inicial; nos demais ela é a data do lançamento de entrada.');
        else if (!vazio_(fim.data_entrada) && fim.data_entrada > m.D0) erroItem_(m, it, 'valor_novo', 'ENTRADA_DEPOIS_DO_MARCO_ZERO', 'a chegada na fazenda não pode ser depois do marco zero (' + br_(m.D0) + ').');
      }
      if (!vazio_(fim.data_nascimento) && !vazio_(fim.data_entrada) && fim.data_entrada < fim.data_nascimento) erroItem_(m, it, 'valor_novo', 'ENTRADA_ANTES_DO_NASCIMENTO', 'a chegada na fazenda (' + br_(fim.data_entrada) + ') ficaria antes do nascimento (' + br_(fim.data_nascimento) + ').');
    });
  }
  function identificacaoIncorreta_(m, ctxEv, it, e) {
    var novo = it.dados.brinco;
    if (vazio_(novo)) return;
    var codigo = Utils.aparar(novo);
    if (vazio_(e.brinco)) { erroItem_(m, it, 'brinco', 'SEM_BRINCO', 'o animal não tem brinco para corrigir; o primeiro brinco é colocado pelo lançamento de identificação.'); return; }
    if (Utils.normalizarBrinco(codigo) === e.brinco_norm) { erroItem_(m, it, 'brinco', 'VALOR_IGUAL', 'o brinco informado é o mesmo que já está no cadastro.'); return; }
    var aberta = m.f.identificacoes(it.animal_id).filter(function (r) { return r.tipo === 'BRINCO' && r.codigo_norm === e.brinco_norm; });
    if (aberta.some(function (r) { return ctxEv.ev.event_date < r.data_inicio; })) { erroItem_(m, it, 'brinco', 'ANTES_DA_IDENTIFICACAO', 'a correção não pode ter data anterior ao lançamento do brinco errado.'); return; }
    linhaEA_(m, ctxEv, it, { efeito_inventario: 0 });
    ajusteRow_(m, ctxEv, it, 'brinco', e.brinco, codigo);
    it.brincoTexto = codigo;
    it.brincoLibera = true;
    it.brincoProposto = { codigo: codigo, norm: Utils.normalizarBrinco(codigo) };
    ctxEv.plano.IDENTIFICACOES.push({ ident_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ctxEv.ev.event_id, tipo: 'BRINCO', codigo: codigo, codigo_norm: it.brincoProposto.norm, data_inicio: ctxEv.ev.event_date, motivo: null, created_at: m.tx.agora });
    it.quem = nomeAnimal_(e) + ' (novo brinco ' + codigo + ')';
  }
  function correcaoLocalizacao_(m, ctxEv, it, e) {
    var d = it.dados;
    var data = ctxEv.ev.event_date;
    if (vazio_(d.pasto_destino_id) || !Utils.dataValida(data)) return;
    var onde = Timeline.pastoEm(m.f.linhas(it.animal_id), data, m.D0);
    if (!onde.presente) { erroItem_(m, it, 'animal_id', 'FORA_DO_REBANHO', 'em ' + br_(data) + ' o animal não estava no rebanho.'); return; }
    var origem = onde.pasture_id;
    if (!vazio_(d.pasto_origem_id) && d.pasto_origem_id !== origem) {
      erroItem_(m, it, 'pasto_origem_id', 'ORIGEM_DIVERGENTE', 'em ' + br_(data) + ' o sistema registrava o animal no pasto ' + nomePasto_(m, origem) + ', não no ' + nomePasto_(m, d.pasto_origem_id) + '. Confira a origem ou tire o animal da lista.');
      return;
    }
    if (d.pasto_destino_id === origem) { erroItem_(m, it, 'pasto_destino_id', 'VALOR_IGUAL', 'o animal já está registrado no pasto ' + nomePasto_(m, origem) + '.'); return; }
    if (!pastoAtivo_(m, it, 'pasto_destino_id', d.pasto_destino_id)) return;
    linhaEA_(m, ctxEv, it, { efeito_inventario: 0, pasto_origem_id: origem, pasto_destino_id: d.pasto_destino_id });
    ajusteRow_(m, ctxEv, it, 'pasto_atual_id', origem, d.pasto_destino_id);
  }

  // ------------------------------------------------------------------ conferências ----
  /** Cada animal aparece uma vez por papel (RN-029); na correção de cadastro, uma vez por campo. */
  function conferirRepetidos_(m, ctxEv) {
    var vistos = {};
    ctxEv.itens.forEach(function (it) {
      if (!it.publico || ctxEv.subtipo === 'CORRECAO_CADASTRO') return;
      if (vistos[it.animal_id]) { erroItem_(m, it, 'animal_id', 'ANIMAL_REPETIDO', 'o animal aparece mais de uma vez neste lançamento.'); ctxEv.repetidos = ctxEv.repetidos || {}; ctxEv.repetidos[it.animal_id] = true; }
      vistos[it.animal_id] = true;
    });
    if (ctxEv.subtipo === 'CORRECAO_CADASTRO') fecharCorrecoes_(m, ctxEv);
  }
  /**
   * Unicidade de brinco com normalização (05, seção 4.1; desenho-base 16.2): repetição no lançamento; colisão com
   * brinco em uso de animal não anulado; BRINCO_PARECIDO quando os zeros à esquerda contam; reuso de brinco
   * aposentado (o código corrigido por identificação incorreta não conta).
   */
  function conferirBrincos_(m, ctxEv) {
    var semZeros = m.params.brinco_ignora_zeros_esquerda !== false;
    var chave = function (codigo) { return Utils.normalizarBrinco(codigo, !semZeros); };
    var propostos = ctxEv.itens.filter(function (it) { return it.brincoProposto; });
    if (!propostos.length) return;
    var liberados = {};
    ctxEv.itens.forEach(function (it) { if (it.publico && (it.brincoProposto || it.reusado || it.brincoLibera)) liberados[it.animal_id] = true; });
    Object.keys(ctxEv.criadosOriginal).forEach(function (id) { liberados[id] = true; });
    var ocupados = {};
    var parecidos = {};
    m.repo.vigentes('ANIMAIS').forEach(function (a) {
      if (liberados[a.animal_id]) return;
      var e = estado_(m, a.animal_id);
      if (!e || vazio_(e.brinco) || e.situacao_cadastral === 'ANULADO' || e.situacao_cadastral === 'PENDENTE') return;
      ocupados[chave(e.brinco)] = e;
      parecidos[e.brinco_norm || Utils.normalizarBrinco(e.brinco)] = e;
    });
    // Brinco que um animal deixa neste mesmo lançamento (troca de brinco, volta com brinco novo): com o reuso desligado,
    // outro animal do lançamento não pode recebê-lo (seria o reuso de um número aposentado). A correção de brinco
    // lançado errado não aposenta o número (desenho-base 16.2).
    var saem = {};
    ctxEv.itens.forEach(function (it) {
      if (!it.publico || !it.brincoProposto || it.brincoLibera) return;
      var e = estado_(m, it.animal_id);
      if (e && !vazio_(e.brinco) && chave(e.brinco) !== chave(it.brincoProposto.codigo)) saem[chave(e.brinco)] = it;
    });
    var noEvento = {};
    propostos.forEach(function (it) {
      var b = it.brincoProposto;
      if (m.params.brinco_somente_numerico === true && !/^\d+$/.test(b.codigo.replace(/\s+/g, ''))) {
        erroItem_(m, it, 'brinco', 'BRINCO_NAO_NUMERICO', 'o brinco precisa ter só números.');
        return;
      }
      var k = chave(b.codigo);
      if (noEvento[k]) { erroItem_(m, it, 'brinco', 'BRINCO_REPETIDO', 'o brinco ' + b.codigo + ' aparece mais de uma vez neste lançamento.'); return; }
      noEvento[k] = it;
      var dono = ocupados[k];
      if (dono) {
        var sit = dono.situacao_cadastral === 'ATIVO' ? '' : ', ' + (SITUACAO_ROTULO[dono.situacao_cadastral] || '') + (vazio_(dono.data_saida) ? '' : ' em ' + br_(dono.data_saida));
        erroItem_(m, it, 'brinco', 'BRINCO_DUPLICADO', 'o brinco ' + b.codigo + ' já é do animal ' + dono.codigo_interno + sit + '. Escolha outro número.');
        return;
      }
      var sai = saem[k];
      if (sai && sai.animal_id !== it.animal_id && m.params.brinco_permite_reuso !== true) {
        erroItem_(m, it, 'brinco', 'BRINCO_APOSENTADO', 'o brinco ' + b.codigo + ' sai do animal ' + (sai.codigo_interno || '') + ' neste mesmo lançamento e o reuso de brinco está desligado nas configurações.');
        return;
      }
      if (!semZeros && parecidos[b.norm]) {
        avisoItem_(m, it, 'BRINCO_PARECIDO', it.quem + ': o brinco ' + b.codigo + ' difere só por zeros à esquerda do brinco ' + parecidos[b.norm].brinco + ' (animal ' + parecidos[b.norm].codigo_interno + ').');
      }
      reusoDeBrinco_(m, it, b, chave);
    });
  }
  function reusoDeBrinco_(m, it, b, chave) {
    if (m.params.brinco_permite_reuso === true) return;
    var corrigidos = {};
    var aposentado = m.repo.por('IDENTIFICACOES', 'codigo_norm', b.norm).filter(function (r) {
      if (r.tipo !== 'BRINCO' || r.animal_id === it.animal_id || vazio_(r.data_fim) || m.f.excluidos[r.event_id]) return false;
      if (chave(r.codigo) !== chave(b.codigo)) return false;
      if (!(r.animal_id in corrigidos)) {
        corrigidos[r.animal_id] = m.f.ajustes(r.animal_id).filter(function (a) { return a.tipo_ajuste === 'IDENTIFICACAO_INCORRETA' && a.campo === 'brinco'; })
          .map(function (a) { return Utils.normalizarBrinco(a.valor_anterior || ''); });
      }
      return corrigidos[r.animal_id].indexOf(r.codigo_norm) < 0;
    })[0];
    if (aposentado) {
      var dono = estado_(m, aposentado.animal_id);
      erroItem_(m, it, 'brinco', 'BRINCO_APOSENTADO', 'o brinco ' + b.codigo + ' já foi do animal ' + (dono ? dono.codigo_interno : '') + ' até ' + br_(aposentado.data_fim) + ' e o reuso de brinco está desligado nas configurações.');
    }
  }
  /**
   * Genealogia (05, seção 4.2): mãe fêmea e pai macho; ninguém é progenitor de si; nascimento do filho depois do
   * dos pais; sem ciclos; aviso de idade reprodutiva da mãe; correção de sexo ou nascimento reaplica as regras aos
   * filhos (RN-012).
   */
  function conferirGenealogia_(m, ctxEv) {
    var porRef = {};
    var itens = ctxEv.itens.filter(function (it) { return it.animal_id && !it.ignorarNaLinhaDoTempo; });
    itens.forEach(function (it) {
      var ref = it.dados.ref;
      if (vazio_(ref) || !it.novo && !it.reusado) return;
      if (porRef[ref]) erroItem_(m, it, 'ref', 'REFERENCIA_REPETIDA', 'a referência "' + ref + '" aparece em mais de um animal.');
      else porRef[ref] = it;
    });
    var final = {};
    itens.forEach(function (it) { if (!it.ignorarNaLinhaDoTempo && !final[it.animal_id]) final[it.animal_id] = it; });
    var conhecidos = m.conhecidos;
    function base(id) { return conhecidos[id] || estado_(m, id) || {}; }
    function sexoDe(id) { return final[id] && final[id].final.sexo !== undefined ? final[id].final.sexo : base(id).sexo; }
    function nascDe(id) { return final[id] && final[id].final.data_nascimento !== undefined ? final[id].final.data_nascimento : base(id).data_nascimento; }
    function nomeDe(id) { return final[id] ? final[id].quem.replace(/^Brinco /, '') : conhecidos[id] ? conhecidos[id].nome : nomeAnimal_(estado_(m, id)); }
    function resolver(it, campoId, campoRef) {
      var p = it.parentesco || {};
      if (!vazio_(p[campoRef])) {
        var alvo = porRef[p[campoRef]];
        if (!alvo) { erroItem_(m, it, campoRef, 'REFERENCIA_DESCONHECIDA', 'não há animal com a referência "' + p[campoRef] + '" neste lançamento.'); return undefined; }
        return alvo.animal_id;
      }
      return p[campoId];
    }
    itens.forEach(function (it) {
      if (!it.parentesco) return;
      var mae = resolver(it, 'mae_id', 'mae_ref');
      var pai = resolver(it, 'pai_id', 'pai_ref');
      it.genealogia = { mae_id: mae === undefined ? null : nulo_(mae), pai_id: pai === undefined ? null : nulo_(pai) };
      if (it.novo || it.reusado) {
        if (it.atributos && it.genealogia.mae_id) it.atributos.mae_id = it.genealogia.mae_id;
        if (it.atributos && it.genealogia.pai_id) it.atributos.pai_id = it.genealogia.pai_id;
      }
    });
    function maeDe(id) { return final[id] && final[id].genealogia ? final[id].genealogia.mae_id : base(id).mae_id; }
    function paiDe(id) { return final[id] && final[id].genealogia ? final[id].genealogia.pai_id : base(id).pai_id; }
    function caminho(de, ate) {
      var fila = [[de]];
      var vistos = {};
      while (fila.length) {
        var c = fila.shift();
        var x = c[c.length - 1];
        if (x === ate) return c;
        if (vistos[x]) continue;
        vistos[x] = true;
        [maeDe(x), paiDe(x)].forEach(function (p) { if (!vazio_(p) && !vistos[p]) fila.push(c.concat([p])); });
      }
      return null;
    }
    itens.forEach(function (it) {
      if (!it.genealogia) return;
      var novo = it.novo || it.reusado;
      [['mae_id', 'F', 'mãe', 'fêmea'], ['pai_id', 'M', 'pai', 'macho']].forEach(function (cfg) {
        var pid = it.genealogia[cfg[0]];
        var mudou = novo || (it.parentesco && it.parentesco[cfg[0] === 'mae_id' ? 'mudouMae' : 'mudouPai']);
        if (vazio_(pid) || !mudou) return;
        if (pid === it.animal_id) { erroItem_(m, it, cfg[0], 'PROPRIO_PROGENITOR', 'o animal não pode ser ' + cfg[2] + ' de si mesmo.'); return; }
        var p = final[pid] || conhecidos[pid] ? { situacao_cadastral: 'ATIVO' } : existente_(m, pid);
        if (!p) { erroItem_(m, it, cfg[0], 'NAO_ENCONTRADO', 'a ' + cfg[2] + ' informada não foi encontrada.'); return; }
        if (sexoDe(pid) !== cfg[1]) { erroItem_(m, it, cfg[0], 'SEXO_DO_PROGENITOR', nomeDe(pid) + ' não pode ser ' + cfg[2] + ': precisa ser ' + cfg[3] + '.'); return; }
        var nf = nascDe(it.animal_id);
        var np = nascDe(pid);
        if (!vazio_(nf) && !vazio_(np) && np >= nf) {
          erroItem_(m, it, cfg[0], 'NASCIMENTO_DO_PROGENITOR', 'a ' + cfg[2] + ' ' + nomeDe(pid) + ' nasceu em ' + br_(np) + ', não antes do animal (' + br_(nf) + '). Confira a ' + cfg[2] + ' ou as datas.');
          return;
        }
        var ciclo = caminho(pid, it.animal_id);
        if (ciclo) {
          erroItem_(m, it, cfg[0], 'CICLO_GENEALOGICO', nomeDe(pid) + ' não pode ser ' + cfg[2] + ' de ' + nomeDe(it.animal_id) + ': ' + nomeDe(it.animal_id) + ' já é ancestral de ' + nomeDe(pid) + ' (' + ciclo.slice().reverse().map(nomeDe).join(' → ') + ').');
          return;
        }
        var minimo = m.params.idade_min_reprodutiva_meses;
        if (cfg[0] === 'mae_id' && !it.semAvisoIdade && !vazio_(nf) && !vazio_(np) && typeof minimo === 'number' && Utils.idadeMeses(np, nf) < minimo) {
          avisoItem_(m, it, 'IDADE_REPRODUTIVA', it.quem + ': a mãe ' + nomeDe(pid) + ' tinha ' + Utils.idadeMeses(np, nf) + ' meses no nascimento, abaixo da idade reprodutiva mínima (' + minimo + ' meses).');
        }
      });
    });
    // RN-012: corrigir sexo ou nascimento de quem já é mãe ou pai.
    itens.forEach(function (it) {
      if (it.novo || !it.final || (!it.final.mudouSexo && !it.final.mudouNascimento)) return;
      var filhos = Utils.unicos(m.repo.por('ANIMAIS', 'mae_id', it.animal_id).concat(m.repo.por('ANIMAIS', 'pai_id', it.animal_id)).map(function (a) { return a.animal_id; }));
      filhos.forEach(function (fid) {
        var comoMae = maeDe(fid) === it.animal_id;
        var comoPai = paiDe(fid) === it.animal_id;
        if (!comoMae && !comoPai) return;
        var sexo = sexoDe(it.animal_id);
        if ((comoMae && sexo !== 'F') || (comoPai && sexo !== 'M')) erroItem_(m, it, 'valor_novo', 'SEXO_DO_PROGENITOR', 'o animal é ' + (comoMae ? 'mãe' : 'pai') + ' de ' + nomeDe(fid) + ' e não pode ter o sexo trocado.');
        var nf = nascDe(fid);
        var np = nascDe(it.animal_id);
        if (!vazio_(nf) && !vazio_(np) && np >= nf) erroItem_(m, it, 'valor_novo', 'NASCIMENTO_DO_PROGENITOR', 'o animal é ' + (comoMae ? 'mãe' : 'pai') + ' de ' + nomeDe(fid) + ', nascido em ' + br_(nf) + ', e precisa ter nascido antes.');
      });
    });
  }
  /**
   * Linha do tempo de cada animal (04, seção 5.1): problema em linha do comando → VALIDATION; problema que a
   * alteração cria em evento já gravado → CONFLICT, listando-o (retroativo, substituição).
   */
  function conferirLinhaDoTempo_(m, ctxEv) {
    var feitos = {};
    ctxEv.itens.forEach(function (it) {
      if (!it.animal_id || it.ignorarNaLinhaDoTempo || feitos[it.animal_id] || !it.linhas.length) return;
      feitos[it.animal_id] = true;
      var e = it.novo ? null : estado_(m, it.animal_id);
      var nasc = it.final && it.final.data_nascimento !== undefined ? it.final.data_nascimento : e && e.data_nascimento;
      var entrada = it.final && it.final.data_entrada !== undefined ? it.final.data_entrada : e && e.data_entrada;
      var antes = it.novo ? [] : m.real.linhas(it.animal_id);
      var depois = (it.novo ? [] : m.f.linhas(it.animal_id)).concat(it.linhas);
      var opc = { nascimento: nasc, dataEntrada: entrada };
      var opcAntes = { nascimento: e && e.data_nascimento, dataEntrada: e && e.data_entrada };
      var novos = Timeline.problemasNovos(Timeline.validar(antes, opcAntes).problemas, Timeline.validar(depois, opc).problemas);
      novos.forEach(function (p) {
        // Nascimento × a própria entrada já foi conferido nos atributos (mensagem mais clara).
        if (p.codigo === 'ANTES_DO_NASCIMENTO' && it.atributos && p.event_id === ctxEv.ev.event_id) return;
        // A origem que o servidor tirou da linha do tempo só diverge quando outro registro a quebrou: esse é o problema
        // que se mostra (erro ou CONFLICT com o evento), não a origem derivada.
        if (p.codigo === 'ORIGEM_DIVERGENTE' && it.origemDerivada && p.event_id === ctxEv.ev.event_id) return;
        var texto = Timeline.descrever(p, function (id) { return nomePasto_(m, id); });
        if (p.event_id === ctxEv.ev.event_id) erroItem_(m, it, null, p.codigo, texto);
        else conflito_(m, it, p, texto + ' Estorne ou corrija esse registro antes, ou mude este lançamento.');
      });
    });
  }
  /** Animais já cadastrados que o comando toca (itens que não são animal novo) e os do original, na correção. */
  function animaisConferidos_(m, ctxEv) {
    var ids = ctxEv.itens.filter(function (it) { return it.animal_id && !it.novo; }).map(function (it) { return it.animal_id; });
    var porAnimal = itensPorAnimal_(ctxEv);
    Object.keys(m.afetados).forEach(function (id) { if (!ctxEv.criadosOriginal[id] || porAnimal[id]) ids.push(id); });
    return Utils.unicos(ids);
  }
  /** Itens do comando por animal (memoizado no ctxEv, depois que os itens foram montados): {animal_id: [item]}. */
  function itensPorAnimal_(ctxEv) {
    if (!ctxEv.porAnimalItens) {
      var por = {};
      ctxEv.itens.forEach(function (it) { if (it.animal_id) (por[it.animal_id] = por[it.animal_id] || []).push(it); });
      ctxEv.porAnimalItens = por;
    }
    return ctxEv.porAnimalItens;
  }
  function itemDoAnimal_(m, ctxEv, id) {
    var it = ctxEv && itensPorAnimal_(ctxEv)[id] ? itensPorAnimal_(ctxEv)[id][0] : null;
    if (it) return it;
    var e = m.f.animal(id) || {};
    return { animal_id: id, publico: true, brincoTexto: e.brinco || null, quem: nomeAnimal_(e), linhas: [] };
  }
  /**
   * Sequências que não são de entrada e saída (04, seção 5.1, aplicada aos fatos com ordem própria): identificações
   * por tipo (`Timeline.validarIdentificacoes`) e marcações por subtipo (`Timeline.validarMarcacoes`), antes e depois
   * da mudança, para cada animal. Problema em linha do comando → VALIDATION; o que a mudança quebra num evento gravado
   * (uma troca de brinco que ficou sem brinco para trocar, uma desmarcação que ficou sem marcação) → CONFLICT com ele.
   * ctxEv null = estorno (só as linhas gravadas, sem as do evento estornado).
   */
  function conferirSequencias_(m, ctxEv, ids, proprio) {
    var identPorAnimal = ctxEv ? Utils.agruparPor(ctxEv.plano.IDENTIFICACOES, 'animal_id') : {};
    ids.forEach(function (id) {
      // Animal repetido no lançamento: o erro ANIMAL_REPETIDO já explica; as linhas duplicadas não têm sequência a conferir.
      if (ctxEv && ctxEv.repetidos && ctxEv.repetidos[id]) return;
      var it = itemDoAnimal_(m, ctxEv, id);
      var novasIdent = ctxEv ? (identPorAnimal[id] || []).map(function (r) { return Timeline.linhaIdentificacao(r, ctxEv.ev, ctxEv.ev.ordem_seq); }) : [];
      var novasLinhas = [];
      if (ctxEv) (itensPorAnimal_(ctxEv)[id] || []).forEach(function (x) { novasLinhas = novasLinhas.concat(x.linhas); });
      var antes = Timeline.validarIdentificacoes(Timeline.identificacoes(m.real, id)).concat(Timeline.validarMarcacoes(m.real.linhas(id)));
      var depois = Timeline.validarIdentificacoes(Timeline.identificacoes(m.f, id).concat(novasIdent)).concat(Timeline.validarMarcacoes(m.f.linhas(id).concat(novasLinhas)));
      Timeline.problemasNovos(antes, depois).forEach(function (p) {
        var texto = Timeline.descrever(p);
        if (proprio && p.event_id === proprio) erroItem_(m, it, p.event_type === 'MARCACAO' ? 'animal_id' : 'codigo', p.codigo, texto);
        else conflito_(m, it, p, texto + (proprio ? ' Estorne ou corrija esse registro antes, ou mude este lançamento.' : ' Estorne esse registro antes.'));
      });
    });
  }
  /** Evento que deu ao animal o brinco que ele usa hoje (a linha aberta de IDENTIFICACOES). */
  function eventoDoBrinco_(m, id) {
    var lista = Timeline.identificacoes(m.f, id).filter(function (x) { return x.tipo === 'BRINCO'; });
    var x = lista.length ? lista[lista.length - 1] : null;
    return x && !x.remocao ? { codigo: 'BRINCO_DUPLICADO', event_id: x.event_id, event_type: x.event_type, event_subtype: x.event_subtype, event_date: x.data_inicio } : null;
  }
  /**
   * O que um estorno ou uma correção DEVOLVE a um animal que fica no rebanho (a projeção sem o evento anulado): o
   * brinco anterior (que outro animal pode ter recebido depois, com o reuso ligado ou pela exceção da correção de
   * brinco), o sexo ou o nascimento anterior (que pode não caber mais com os filhos dele: RN-012) e a categoria manual
   * anterior (que pode ter sido desativada). Em todos, CONFLICT com o registro que impede. Animal que recebe brinco,
   * correção de cadastro ou categoria nova no próprio comando é conferido pelas regras do comando.
   */
  function conferirEstadoRestaurado_(m, ids, verbo, ctxEv) {
    var semZeros = m.params.brinco_ignora_zeros_esquerda !== false;
    var chave = function (c) { return Utils.normalizarBrinco(c, !semZeros); };
    var donos = null;
    var conjunto = {};
    ids.forEach(function (id) { conjunto[id] = true; });
    ids.forEach(function (id) {
      var gravado = m.f.animal(id);
      var depois = estado_(m, id);
      if (!gravado || !depois || depois.situacao_cadastral === 'ANULADO' || depois.situacao_cadastral === 'PENDENTE') return;
      var item = ctxEv && itensPorAnimal_(ctxEv)[id] ? itensPorAnimal_(ctxEv)[id][0] : null;
      var it = itemDoAnimal_(m, ctxEv, id);
      if (!(item && item.brincoProposto) && !vazio_(depois.brinco) && chave(depois.brinco) !== chave(gravado.brinco || '')) {
        if (!donos) {
          donos = {};
          m.repo.vigentes('ANIMAIS').forEach(function (a) {
            if (conjunto[a.animal_id] || vazio_(a.brinco) || a.situacao_cadastral === 'ANULADO' || a.situacao_cadastral === 'PENDENTE') return;
            donos[chave(a.brinco)] = a;
          });
        }
        var dono = donos[chave(depois.brinco)];
        if (dono) {
          var p = eventoDoBrinco_(m, dono.animal_id) || { codigo: 'BRINCO_DUPLICADO', event_id: null, event_type: null, event_date: null };
          conflito_(m, it, p, verbo + ' devolveria ao animal o brinco ' + depois.brinco + ', que hoje é do animal ' + nomeAnimal_(dono) + ' (' + dono.codigo_interno + '). Troque o brinco de um dos dois antes.');
        }
      }
      // Sexo ou nascimento que voltam (estorno de uma correção de cadastro) e o animal já é mãe ou pai (RN-012).
      var corrigeNoComando = item && ctxEv.tipo === 'AJUSTE_INVENTARIO' && ctxEv.subtipo === 'CORRECAO_CADASTRO';
      if (!corrigeNoComando && (depois.sexo !== gravado.sexo || nulo_(depois.data_nascimento) !== nulo_(gravado.data_nascimento))) {
        Utils.unicos(m.repo.por('ANIMAIS', 'mae_id', id).concat(m.repo.por('ANIMAIS', 'pai_id', id)).map(function (a) { return a.animal_id; })).forEach(function (fid) {
          var filho = estado_(m, fid);
          if (!filho || filho.situacao_cadastral === 'ANULADO' || filho.situacao_cadastral === 'PENDENTE') return;
          var comoMae = filho.mae_id === id;
          var comoPai = filho.pai_id === id;
          if (!comoMae && !comoPai) return;
          var ref = { codigo: 'REFERENCIA_GENEALOGICA', event_id: filho.evento_origem_id, event_type: 'GENEALOGIA', event_date: filho.data_nascimento };
          if ((comoMae && depois.sexo !== 'F') || (comoPai && depois.sexo !== 'M')) conflito_(m, it, ref, verbo + ' voltaria o sexo do animal para ' + (depois.sexo === 'M' ? 'macho' : 'fêmea') + ', mas ele é ' + (comoMae ? 'mãe' : 'pai') + ' de ' + nomeAnimal_(filho) + '.');
          else if (!vazio_(depois.data_nascimento) && !vazio_(filho.data_nascimento) && depois.data_nascimento >= filho.data_nascimento) conflito_(m, it, ref, verbo + ' voltaria o nascimento do animal para ' + br_(depois.data_nascimento) + ', mas ele é ' + (comoMae ? 'mãe' : 'pai') + ' de ' + nomeAnimal_(filho) + ', nascido em ' + br_(filho.data_nascimento) + '.');
        });
      }
      var reclassNoComando = item && ctxEv.tipo === 'AJUSTE_INVENTARIO' && ctxEv.subtipo === 'RECLASSIFICACAO';
      if (!reclassNoComando && depois.categoria_modo === 'MANUAL' && depois.categoria_manual_id !== gravado.categoria_manual_id) {
        var cat = m.repo.porId('CATEGORIAS', depois.categoria_manual_id);
        if (cat && cat.ativo === false) {
          var aj = m.f.ajustes(id).filter(function (a) { return a.tipo_ajuste === 'RECLASSIFICACAO' && a.valor_novo === cat.category_id; }).map(function (a) { return m.f.evento(a.event_id); }).filter(Boolean)
            .sort(function (a, b) { return a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : a.event_seq - b.event_seq; }).pop();
          conflito_(m, it, { codigo: 'CATEGORIA_INATIVA', event_id: aj ? aj.event_id : null, event_type: 'AJUSTE_INVENTARIO', event_subtype: 'RECLASSIFICACAO', event_date: aj ? aj.event_date : null },
            verbo + ' devolveria o animal à categoria ' + cat.nome + ', que está desativada. Reative a categoria ou reclassifique o animal antes.');
        }
      }
    });
  }
  /** Animal que deixa de ter a entrada (estorno, ou correção que o tira da lista): sem outro evento nem referência (RN-041). */
  function conferirAnulacao_(m, animalId, eventoId, anulados) {
    var e = m.f.animal(animalId) || {};
    var it = { animal_id: animalId, brincoTexto: e.brinco || null, quem: nomeAnimal_(e) };
    var outros = {};
    m.real.linhas(animalId).forEach(function (l) {
      if (l.event_id === eventoId || outros[l.event_id] || m.f.excluidos[l.event_id] && l.event_id !== eventoId) return;
      outros[l.event_id] = true;
      conflito_(m, it, { codigo: 'EVENTO_DEPENDENTE', event_id: l.event_id, event_type: l.event_type, event_subtype: l.event_subtype, event_date: l.event_date },
        'tem ' + Timeline.descrever({ codigo: '', event_type: l.event_type, event_subtype: l.event_subtype, event_date: l.event_date }).replace(/ não é compatível.*$/, '') + ', que depende desta entrada.');
    });
    ['mae_id', 'pai_id'].forEach(function (c) {
      m.repo.por('ANIMAIS', c, animalId).forEach(function (f) {
        if (anulados[f.animal_id]) return;
        conflito_(m, it, { codigo: 'REFERENCIA_GENEALOGICA', event_id: f.evento_origem_id, event_type: 'GENEALOGIA', event_date: null }, 'é ' + (c === 'mae_id' ? 'mãe' : 'pai') + ' de ' + nomeAnimal_(f) + '.');
      });
    });
    m.repo.por('REPRODUCAO', 'touro_id', animalId).forEach(function (r) {
      if (r.event_id === eventoId) return;
      conflito_(m, it, { codigo: 'REFERENCIA_TOURO', event_id: r.event_id, event_type: 'REPRODUCAO', event_date: r.data }, 'é o touro de um registro reprodutivo de ' + br_(r.data) + '.');
    });
    m.repo.por('ALOCACOES_FINANCEIRAS', 'animal_id', animalId).forEach(function (a) {
      var rat = m.repo.porId('RATEIOS', a.rateio_id);
      if (!rat || rat.event_id === eventoId) return;
      conflito_(m, it, { codigo: 'REFERENCIA_RATEIO', event_id: rat.event_id, event_type: 'RATEIO', event_date: null }, 'recebeu ' + Utils.formatarReais(a.valor_alocado) + ' de um custo rateado; refaça o rateio antes.');
    });
  }
  /** Na correção de evento que criou animais: o animal criado que ficou fora do substituto é anulado. */
  function conferirRemovidos_(m, ctxEv) {
    var presentes = {};
    ctxEv.itens.forEach(function (it) { if (it.animal_id) presentes[it.animal_id] = true; });
    var removidos = Object.keys(ctxEv.criadosOriginal).filter(function (id) { return !presentes[id]; });
    var anulados = {};
    removidos.forEach(function (id) { anulados[id] = true; });
    removidos.forEach(function (id) { conferirAnulacao_(m, id, ctxEv.original.event_id, anulados); });
    ctxEv.removidos = removidos;
    // Animais não criados pelo original que ficaram fora do substituto: a linha do tempo deles sem o original.
    m.f.linhasDoEvento(ctxEv.original.event_id).forEach(function (l) {
      if (presentes[l.animal_id] || ctxEv.criadosOriginal[l.animal_id]) return;
      var e = m.f.animal(l.animal_id) || {};
      var it = { animal_id: l.animal_id, brincoTexto: e.brinco || null, quem: nomeAnimal_(e) };
      var novos = Timeline.problemasNovos(Timeline.validar(m.real.linhas(l.animal_id), { nascimento: e.data_nascimento }).problemas, Timeline.validar(m.f.linhas(l.animal_id), { nascimento: e.data_nascimento }).problemas);
      novos.forEach(function (p) { conflito_(m, it, p, Timeline.descrever(p, function (x) { return nomePasto_(m, x); })); });
      (ctxEv.removidos = ctxEv.removidos || []).push(l.animal_id);
    });
  }
  function conferirParcelasLiquidadas_(m, ev, verbo) {
    m.repo.por('FINANCEIRO', 'event_id', ev.event_id).forEach(function (fin) {
      m.repo.por('PARCELAS', 'financial_id', fin.financial_id).forEach(function (p) {
        if (p.status !== 'LIQUIDADA') return;
        m.conflitos.push(Validation.detalhe({
          codigo: 'PARCELA_LIQUIDADA', campo: 'event_id',
          mensagem: 'O evento tem parcela paga em ' + br_(p.data_pagamento) + ' (' + Utils.formatarReais(p.valor) + '). Desfaça a baixa antes de ' + verbo + '.',
          conflito: { event_id: ev.event_id, tipo: ev.event_type, data: ev.event_date },
        }));
      });
    });
  }
  function assinatura_(at, pasto) {
    var a = at || {};
    return [a.sexo, a.data_nascimento || '', a.raca || '', pasto || ''].join('|');
  }
  /**
   * Guarda semântica de duplicidade (05, seção 4.4): mesmo tipo, subtipo e data, com ≥ 80% dos mesmos animais.
   * Animal novo não tem id anterior: conta como "o mesmo" o animal sem brinco de mesma assinatura (sexo,
   * nascimento, raça, pasto) já lançado no evento candidato.
   */
  function guardaDuplicidade_(m, ctxEv) {
    var ev = ctxEv.ev;
    var itens = ctxEv.itens.filter(function (it) { return it.animal_id && it.linhaEA; });
    if (!itens.length || !Utils.dataValida(ev.event_date)) return;
    var candidatos = m.repo.por('EVENTOS', 'event_date', ev.event_date).filter(function (c) {
      if (c.event_type !== ev.event_type || nulo_(c.event_subtype) !== nulo_(ev.event_subtype) || m.f.excluidos[c.event_id]) return false;
      // Marcar e desmarcar no mesmo dia não são o mesmo lançamento.
      return ev.event_type !== 'MARCACAO' || (c.payload_json || {}).acao === (ev.payload_json || {}).acao;
    });
    candidatos.forEach(function (c) {
      var linhas = m.repo.por('EVENTO_ANIMAIS', 'event_id', c.event_id).filter(function (l) { return l.papel === 'SUJEITO' || l.papel === 'CRIA' || l.papel === 'MATRIZ'; });
      var ids = {};
      var assin = {};
      linhas.forEach(function (l) {
        ids[l.animal_id] = true;
        var e = estado_(m, l.animal_id);
        if (l.atributos_iniciais_json && e && vazio_(e.brinco)) { var k = assinatura_(l.atributos_iniciais_json, l.pasto_destino_id); assin[k] = (assin[k] || 0) + 1; }
      });
      var comuns = 0;
      itens.forEach(function (it) {
        if (!it.novo) { if (ids[it.animal_id]) comuns++; return; }
        if (it.brincoProposto) return;
        var k = assinatura_(it.atributos, it.linhaEA.pasto_destino_id);
        if (assin[k]) { assin[k]--; comuns++; }
      });
      if (comuns && comuns / itens.length >= 0.8) {
        avisoItem_(m, null, 'POSSIVEL_DUPLICIDADE', 'Já existe ' + (EventCatalog.tipo(c.event_type).rotulo || c.event_type).toLowerCase() + ' de ' + br_(c.event_date) + ' com ' + comuns + ' destes ' + itens.length + ' animais. Gravar mesmo assim?',
          { event_id: c.event_id, tipo: c.event_subtype || c.event_type, data: c.event_date });
      }
    });
  }
  /** Lotação (RN-027): entrada ou correção de pasto que leva o pasto acima da capacidade em cabeças informada. */
  function conferirLotacao_(m, ctxEv) {
    var destinos = {};
    ctxEv.itens.forEach(function (it) { if (it.linhaEA && !vazio_(it.linhaEA.pasto_destino_id)) destinos[it.linhaEA.pasto_destino_id] = true; });
    var comCapacidade = Object.keys(destinos).filter(function (id) { var p = m.f.pasto(id); return p && typeof p.capacidade_estimada_cabecas === 'number'; });
    if (!comCapacidade.length || !Utils.dataValida(ctxEv.ev.event_date)) return;
    var novas = [];
    ctxEv.itens.forEach(function (it) { novas = novas.concat(it.linhas); });
    var linhas = m.f.todasAsLinhas().concat(novas);
    var inv = Timeline.inventario(linhas, ctxEv.ev.event_date, m.D0);
    comCapacidade.forEach(function (id) {
      var p = m.f.pasto(id);
      var n = (inv.porPasto || {})[id] || 0;
      if (n > p.capacidade_estimada_cabecas) avisoItem_(m, null, 'LOTACAO_ACIMA_DA_CAPACIDADE', 'O pasto ' + p.nome + ' fica com ' + n + ' cabeças em ' + br_(ctxEv.ev.event_date) + ', acima da capacidade informada (' + p.capacidade_estimada_cabecas + ').');
    });
  }

  // ------------------------------------------------------------------ compra e financeiro do evento ----
  /** Parceiros que o evento original já usava: continuam aceitos na correção mesmo se foram desativados depois. */
  function parceirosDoOriginal_(m, ctxEv) {
    if (!ctxEv.original) return {};
    var out = {};
    if (!vazio_(ctxEv.original.partner_id)) out[ctxEv.original.partner_id] = true;
    m.tx.cru.cruPor('FINANCEIRO', 'event_id', ctxEv.original.event_id).forEach(function (f) { if (!vazio_(f.partner_id)) out[f.partner_id] = true; });
    return out;
  }
  /** Parceiro de um lançamento (03a, seção 4.8): existe e está ativo; o tipo só filtra a tela, não bloqueia. */
  function parceiroValido_(m, ctxEv, campo, id, prefixo) {
    if (vazio_(id)) return true;
    var p = m.repo.porId('PARCEIROS', id);
    if (!p) { erroGeral_(m, campo, 'NAO_ENCONTRADO', (prefixo || '') + 'O parceiro informado não existe. Atualize a tela e escolha de novo.'); return false; }
    ctxEv.parceirosOriginal = ctxEv.parceirosOriginal || parceirosDoOriginal_(m, ctxEv);
    if (p.ativo === false && !ctxEv.parceirosOriginal[id]) { erroGeral_(m, campo, 'PARCEIRO_INATIVO', (prefixo || '') + 'O parceiro ' + p.nome + ' está desativado. Reative-o nas configurações ou escolha outro.'); return false; }
    return true;
  }
  /** Cabeçalho da compra: fornecedor e pasto de destino do lote. */
  function cabecalhoCompra_(m, ctxEv) {
    var c = ctxEv.campos;
    parceiroValido_(m, ctxEv, 'partner_id', c.partner_id);
    if (!vazio_(c.pasto_destino_id)) {
      var p = m.f.pasto(c.pasto_destino_id);
      if (!p) erroGeral_(m, 'pasto_destino_id', 'NAO_ENCONTRADO', 'O pasto de destino não existe.');
      else if (p.status !== 'ATIVO') erroGeral_(m, 'pasto_destino_id', 'PASTO_INATIVO', 'O pasto ' + p.nome + ' está desativado e não recebe animais.');
    }
  }
  function plural_(n, um, varios) {
    return n + ' ' + (n === 1 ? um : varios);
  }
  /** Lançamento planejado → item do resumo financeiro (impactos da simulação). */
  function resumoLancamento_(m, pl, conta, extra) {
    var f = pl.linhas.FINANCEIRO[0];
    var o = {
      financial_id: f.financial_id, descricao: f.descricao, conta_codigo: conta.codigo, conta_nome: conta.nome, natureza: f.natureza, tipo: f.tipo,
      valor: f.valor, partner_id: f.partner_id, criterio: pl.rateio ? pl.rateio.criterio : null,
      parcelas: pl.parcelas.map(function (p) { return { parcela_num: p.parcela_num, data_vencimento: p.data_vencimento, valor: p.valor, forma_pagamento: p.forma_pagamento }; }),
    };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  /** Resumo financeiro do evento: os lançamentos e o valor de cada animal (soma das alocações, a fonte única). */
  function resumoFinanceiro_(m, ctxEv, lancs, planejados) {
    var por = {};
    planejados.forEach(function (pl) { (pl.rateio ? pl.rateio.itens : []).forEach(function (x) { por[x.animal_id] = (por[x.animal_id] || 0) + x.valor; }); });
    var t = { a_pagar: 0, a_receber: 0 };
    lancs.forEach(function (l) { if (l.parcelas.length) t[l.tipo === 'RECEITA' ? 'a_receber' : 'a_pagar'] += l.valor; });
    ctxEv.financeiro = {
      lancamentos: lancs, total: lancs.reduce(function (s, l) { return s + l.valor; }, 0), a_pagar: t.a_pagar, a_receber: t.a_receber,
      por_animal: ctxEv.itens.filter(function (it) { return it.animal_id && por[it.animal_id] !== undefined; }).map(function (it) {
        return { animal_id: it.animal_id, codigo_interno: it.codigo_interno || null, brinco: it.brincoTexto || null, valor: por[it.animal_id] };
      }),
    };
  }
  /** Itens do grupo repetível `custos` da compra, validados pelo catálogo; erros com "Custo k:". */
  function custosDaCompra_(m, ctxEv, lista) {
    var defs = EventCatalog.camposGrupo('COMPRA', 'custos');
    if (lista !== undefined && lista !== null && !Array.isArray(lista)) { erroGeral_(m, 'custos', 'TIPO_INVALIDO', 'O frete e os outros custos precisam vir como lista.'); return []; }
    return (lista || []).map(function (bruto, k) {
      var x = bruto && typeof bruto === 'object' ? bruto : {};
      var quem = 'Custo ' + (k + 1) + ': ';
      EventCatalog.validarCampos(defs, x, { listas: m.listas }).forEach(function (e) { erroGeral_(m, 'custos', e.codigo, quem + e.mensagem); });
      parceiroValido_(m, ctxEv, 'custos', x.partner_id, quem);
      return x;
    });
  }
  /**
   * Financeiro da COMPRA (03b, seções 4.5 e 10.3; P11): a negociação dá o critério e as bases; o valor dos animais é um
   * lançamento AQUISICAO_ANIMAIS (COMPRA_ANIMAIS) com as parcelas, e cada frete ou outro custo é outro lançamento
   * (FRETE_DESPESAS_COMPRA), com parceiro e vencimento próprios; todos 100% rateados pelas mesmas bases. O valor
   * individual de cada animal é a alocação do lançamento principal (passo 3 da seção 4.5); o custo de aquisição é a
   * soma das alocações (projeção), nunca gravado em outra fonte.
   */
  function financeiroCompra_(m, ctxEv, d) {
    var c = ctxEv.campos;
    var ev = ctxEv.ev;
    var itens = ctxEv.itens.filter(function (it) { return it.linhaEA && it.negocio; });
    var custos = custosDaCompra_(m, ctxEv, d.custos);
    if (d.parcelas !== undefined && d.parcelas !== null && !Array.isArray(d.parcelas)) { erroGeral_(m, 'parcelas', 'TIPO_INVALIDO', 'As parcelas precisam vir como lista.'); return; }
    var defsParcela = EventCatalog.camposGrupo('COMPRA', 'parcelas');
    (d.parcelas || []).forEach(function (p, k) {
      EventCatalog.validarCampos(defsParcela, p && typeof p === 'object' ? p : {}, { listas: m.listas }).forEach(function (e) {
        if (e.campo === 'data_vencimento' || e.campo === 'valor') return; // vencimento e valor: FinancialService.resolverParcelas
        erroGeral_(m, 'parcelas', e.codigo, 'Parcela ' + (k + 1) + ': ' + e.mensagem);
      });
    });
    if (!itens.length || itens.length !== ctxEv.itens.length) return;
    var neg = FinancialService.negociacao({
      modalidade: c.modalidade, base_peso: nulo_(c.base_peso), rendimento_carcaca_pct: typeof c.rendimento_carcaca_pct === 'number' ? c.rendimento_carcaca_pct : null,
      rendimento_tipo: nulo_(c.rendimento_tipo), preco_unitario: typeof c.preco_unitario === 'number' ? c.preco_unitario : null,
      peso_total_kg: typeof c.peso_total_kg === 'number' ? c.peso_total_kg : null, valor: c.valor_animais, criterio_rateio: nulo_(c.criterio_rateio),
      arroba_kg: m.params.arroba_kg, tolerancia_pct: m.params.fin_tolerancia_conferencia_pct,
      animais: itens.map(function (it) { var n = it.negocio; return { chave: it.codigo_interno, peso: n.peso, peso_carcaca_kg: n.peso_carcaca_kg, valor_individual: n.valor_individual, base_manual: n.base_manual }; }),
    });
    // O campo do cabeçalho que o catálogo já recusou (obrigatório, fora da lista) não leva um segundo erro da negociação.
    var jaRecusados = {};
    m.col.erros.forEach(function (e) { if (!e.animal_id && e.campo) jaRecusados[e.campo] = true; });
    neg.erros.forEach(function (e) {
      if (typeof e.indice === 'number') erroItem_(m, itens[e.indice], e.campo, e.codigo, e.mensagem);
      else if (!jaRecusados[e.campo]) erroGeral_(m, e.campo, e.codigo, e.mensagem);
    });
    neg.avisos.forEach(function (a) { avisoItem_(m, null, a.codigo, a.mensagem); });
    ctxEv.negociacao = neg;
    if (neg.erros.length || typeof c.valor_animais !== 'number') return;
    var contaAnimais = FinancialService.conta(m.repo, FinancialService.CONTAS.COMPRA);
    var contaCustos = custos.length ? FinancialService.conta(m.repo, FinancialService.CONTAS.FRETE_COMPRA) : null;
    var rateioItens = itens.map(function (it, i) { return { animal_id: it.animal_id, chave: it.codigo_interno, base: neg.bases[i], quem: it.quem }; });
    var rateio = { criterio: neg.criterio, itens: rateioItens, cemPorCento: true, justificativa: nulo_(c.justificativa_rateio) };
    var n = itens.length;
    var planejados = [];
    var lancs = [];
    var principal = FinancialService.planejar(m.tx, {
      evento: ev, conta: contaAnimais, naturezas: ['AQUISICAO_ANIMAIS'], valor: c.valor_animais, descricao: 'Compra de ' + plural_(n, 'animal', 'animais'),
      partner_id: c.partner_id, documento: nulo_(c.nota_fiscal), quantidade: n, parcelas: d.parcelas, rateio: rateio,
      campo: 'valor_animais', campoParcelas: 'parcelas', rotulo: 'a compra',
    }, m.col);
    if (principal) {
      planejados.push(principal);
      lancs.push(resumoLancamento_(m, principal, contaAnimais, { papel: 'ANIMAIS' }));
      var porAnimal = Utils.indexarPor(principal.rateio.itens, 'animal_id');
      itens.forEach(function (it) { it.linhaEA.valor_individual = porAnimal[it.animal_id].valor; });
    }
    var frete = 0;
    var outros = 0;
    // Os fretes são lançados antes dos outros custos: COMPRAS guarda só os dois totais, e assim o tipo de cada item
    // se reconstrói pela ordem das linhas (o prefixo que soma o frete), sem chave própria no payload (03b, seção 2.6).
    custos.map(function (x, k) { return { x: x, k: k }; }).sort(function (a, b) { return ((a.x.tipo === 'OUTRO') - (b.x.tipo === 'OUTRO')) || a.k - b.k; }).forEach(function (o) {
      var x = o.x;
      var k = o.k;
      if (typeof x.valor !== 'number') return;
      var eFrete = x.tipo !== 'OUTRO';
      var pl = FinancialService.planejar(m.tx, {
        evento: ev, conta: contaCustos, naturezas: ['AQUISICAO_ANIMAIS'], valor: x.valor,
        descricao: nulo_(x.descricao) || (eFrete ? 'Frete' : 'Outros custos') + ' da compra de ' + br_(ev.event_date), partner_id: nulo_(x.partner_id), documento: nulo_(x.documento),
        parcelas: [{ data_vencimento: nulo_(x.data_vencimento) || ev.event_date, valor: x.valor, forma_pagamento: nulo_(x.forma_pagamento), documento: nulo_(x.documento) }],
        rateio: rateio, campo: 'custos', rotulo: (eFrete ? 'o frete' : 'o custo') + (custos.length > 1 ? ' ' + (k + 1) : ''),
      }, m.col);
      if (!pl) return;
      if (eFrete) frete += x.valor; else outros += x.valor;
      planejados.push(pl);
      lancs.push(resumoLancamento_(m, pl, contaCustos, { papel: eFrete ? 'FRETE' : 'OUTRO' }));
    });
    if (m.col.temErros()) return;
    planejados.forEach(function (pl) { FinancialService.juntar(ctxEv.plano, pl); });
    var total = c.valor_animais + frete + outros;
    ctxEv.plano.COMPRAS.push({
      purchase_id: m.tx.novoId(), event_id: ev.event_id, finalidade: nulo_(c.finalidade), modalidade: c.modalidade, base_peso: neg.base_peso,
      rendimento_carcaca_pct: neg.rendimento_pct, rendimento_tipo: neg.rendimento_tipo, qtd_animais: n, peso_total_kg: neg.peso_vivo_total,
      preco_unitario: neg.unidade_preco ? neg.preco_unitario : null, unidade_preco: neg.unidade_preco, valor_animais: c.valor_animais, frete: frete,
      outros_custos: outros, valor_total: total, criterio_rateio: neg.criterio, gta_numero: nulo_(c.gta_numero), nota_fiscal: nulo_(c.nota_fiscal),
      observacoes: nulo_(c.condicoes),
    });
    ev.partner_id = c.partner_id;
    ev.total_value = total;
    resumoFinanceiro_(m, ctxEv, lancs, planejados);
    ctxEv.compra = {
      modalidade: c.modalidade, base_peso: neg.base_peso, criterio: neg.criterio, valor_animais: c.valor_animais, frete: frete, outros_custos: outros, valor_total: total,
      conferencia: neg.conferencia, desvio_pct: neg.desvio_pct, peso_vivo_total: neg.peso_vivo_total, peso_carcaca_total: neg.peso_carcaca_total, arrobas: neg.arrobas,
      rendimento_pct: neg.rendimento_pct, rendimento_tipo: neg.rendimento_tipo, preco_unitario: neg.preco_unitario, unidade_preco: neg.unidade_preco,
    };
    var a = FinancialService.avisoPeriodo(m.params, ev.event_date, 'A compra');
    if (a) avisoItem_(m, null, a.codigo, a.mensagem);
  }
  /**
   * Lançamento opcional da MORTE (custos associados, CUSTEIO na conta escolhida) e do DESCARTE (receita simples,
   * OUTRAS_RECEITAS_OPERACIONAIS), com um título e rateio por cabeça entre os animais do evento (03b, seção 10.3).
   */
  function financeiroSaida_(m, ctxEv) {
    var c = ctxEv.campos;
    var ev = ctxEv.ev;
    var morte = ctxEv.tipo === 'MORTE';
    var p = morte ? 'custo_' : 'receita_';
    if (vazio_(c[p + 'valor'])) return;
    var conta;
    if (morte) {
      if (vazio_(c.custo_conta_id)) return;
      conta = m.repo.porId('PLANO_CONTAS', c.custo_conta_id);
      if (!conta) { erroGeral_(m, 'custo_conta_id', 'NAO_ENCONTRADO', 'A conta escolhida não existe no plano de contas.'); return; }
    } else conta = FinancialService.conta(m.repo, FinancialService.CONTAS.RECEITA_DESCARTE);
    parceiroValido_(m, ctxEv, p + 'partner_id', c[p + 'partner_id']);
    var itens = ctxEv.itens.filter(function (it) { return it.linhaEA; });
    if (!itens.length || itens.length !== ctxEv.itens.length || typeof c[p + 'valor'] !== 'number') return;
    var pl = FinancialService.planejar(m.tx, {
      evento: ev, conta: conta, naturezas: morte ? ['CUSTEIO'] : ['OUTRA_RECEITA'], valor: c[p + 'valor'],
      descricao: nulo_(c[p + 'descricao']) || (morte ? 'Custos da morte de ' : 'Receita do descarte de ') + br_(ev.event_date),
      partner_id: nulo_(c[p + 'partner_id']), documento: nulo_(c[p + 'documento']),
      parcelas: [{ data_vencimento: nulo_(c[p + 'vencimento']) || ev.event_date, valor: c[p + 'valor'], forma_pagamento: nulo_(c[p + 'forma_pagamento']), documento: nulo_(c[p + 'documento']) }],
      rateio: { criterio: 'CABECAS', itens: itens.map(function (it) { return { animal_id: it.animal_id, chave: it.codigo_interno, base: 1, quem: it.quem }; }), cemPorCento: true },
      campo: morte ? 'custo_conta_id' : 'receita_valor', rotulo: morte ? 'o custo da morte' : 'a receita do descarte',
    }, m.col);
    if (!pl) return;
    FinancialService.juntar(ctxEv.plano, pl);
    ev.total_value = c[p + 'valor'];
    if (!morte) ev.partner_id = nulo_(c.receita_partner_id);
    resumoFinanceiro_(m, ctxEv, [resumoLancamento_(m, pl, conta, { papel: morte ? 'CUSTO' : 'RECEITA' })], [pl]);
    var a = FinancialService.avisoPeriodo(m.params, ev.event_date, morte ? 'O custo da morte' : 'A receita do descarte');
    if (a) avisoItem_(m, null, a.codigo, a.mensagem);
  }

  // ------------------------------------------------------------------ venda ----
  /** Cabeçalho da venda: comprador e o pasto de onde o lote sai (opcional; a origem de cada animal é conferida). */
  function cabecalhoVenda_(m, ctxEv) {
    var c = ctxEv.campos;
    parceiroValido_(m, ctxEv, 'partner_id', c.partner_id);
    ctxEv.pastoOrigem = null;
    if (!vazio_(c.pasto_origem_id)) {
      if (!m.f.pasto(c.pasto_origem_id)) erroGeral_(m, 'pasto_origem_id', 'NAO_ENCONTRADO', 'O pasto de origem não existe.');
      else ctxEv.pastoOrigem = c.pasto_origem_id;
    }
  }
  /** Última pesagem individual (não MEDIA_LOTE) do animal até a data: base estimada do rateio sem peso na venda. */
  function ultimaPesagem_(m, animalId, data) {
    var melhor = null;
    m.f.pesagens(animalId).forEach(function (p) {
      if (p.data_pesagem > data || p.metodo === 'MEDIA_LOTE' || typeof p.peso_kg !== 'number') return;
      var ev = m.f.evento(p.event_id);
      var x = { peso_kg: p.peso_kg, data: p.data_pesagem, seq: ev ? ev.event_seq : 0 };
      if (!melhor || x.data > melhor.data || (x.data === melhor.data && x.seq > melhor.seq)) melhor = x;
    });
    return melhor;
  }
  /**
   * Animal vendido (04, seção 4.3; 03b, seções 3.4 e 16.10): saída (−1) com a origem do cabeçalho (conferida pela
   * linha do tempo: ORIGEM_DIVERGENTE) ou, sem ela, a da linha do tempo no dia; peso vivo, carcaça, valor e motivo de
   * saída na linha; o peso vivo individual vira PESAGENS (VENDA). A situação VENDIDO é projeção; o histórico fica.
   */
  function itemVenda_(m, ctxEv, it) {
    var d = it.dados;
    var ev = ctxEv.ev;
    camposDoItem_(m, it, EventCatalog.camposAnimal('VENDA'), semAnimalId_(d));
    if (!sujeito_(m, it, 'vende')) return;
    var onde = Timeline.pastoAntesDaSaida(m.f.linhas(it.animal_id), ev.event_date, m.D0);
    var origem = ctxEv.pastoOrigem || (onde.presente ? nulo_(onde.pasture_id) : null);
    it.origemDerivada = !ctxEv.pastoOrigem;
    var ea = { efeito_inventario: -1, pasto_origem_id: origem, motivo_saida: nulo_(d.motivo_saida), observacoes: nulo_(d.observacoes) };
    if (typeof d.peso === 'number') ea.peso = d.peso;
    if (typeof d.peso_carcaca_kg === 'number') ea.peso_carcaca_kg = d.peso_carcaca_kg;
    it.negocio = {
      peso: typeof d.peso === 'number' ? d.peso : null, peso_carcaca_kg: typeof d.peso_carcaca_kg === 'number' ? d.peso_carcaca_kg : null,
      valor_individual: typeof d.valor_individual === 'number' ? d.valor_individual : null, base_manual: typeof d.base_manual === 'number' ? d.base_manual : null,
    };
    it.ultimaPesagem = ultimaPesagem_(m, it.animal_id, ev.event_date);
    linhaEA_(m, ctxEv, it, ea);
    if (typeof d.peso === 'number') {
      ctxEv.plano.PESAGENS.push({ weight_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ev.event_id, data_pesagem: ev.event_date, peso_kg: d.peso, metodo: nulo_(d.metodo_pesagem) || 'BALANCA', tipo: 'VENDA', observacoes: null });
    }
  }
  /**
   * Carência na venda (RN-072; 05, seção 4.8): animal com carência sanitária vigente na data gera CARENCIA_ATIVA, um
   * aviso por animal. Na finalidade ABATE vale a política de `avisos_politica` (padrão BLOQUEIA → VALIDATION); nas
   * demais é sempre aviso com aceite (aplicarPolitica_).
   */
  function carenciaNaVenda_(m, ctxEv) {
    var data = ctxEv.ev.event_date;
    var abate = ctxEv.campos.finalidade === 'ABATE';
    m.carenciaSemPolitica = !abate;
    ctxEv.itens.forEach(function (it) {
      if (!it.linhaEA) return;
      var regs = m.repo.por('SANIDADE', 'animal_id', it.animal_id).filter(function (r) { return !m.f.excluidos[r.event_id]; });
      var car = HealthService.carenciaEm(regs, data);
      if (!car) return;
      var oque = car.nome_produto ? car.nome_produto + ', aplicado em ' + br_(car.data_aplicacao) : 'aplicação de ' + br_(car.data_aplicacao);
      avisoItem_(m, it, 'CARENCIA_ATIVA', it.quem + ': está em carência sanitária até ' + br_(car.fim) + ' (' + oque + ').' +
        (abate ? ' Para o abate, a carência precisa ter terminado.' : ' Confirme que o comprador sabe da carência.'));
    });
  }
  function rotuloLista_(m, lista, codigo) {
    var l = m.repo.por('LISTAS', 'lista', lista).filter(function (x) { return x.codigo === codigo; })[0];
    return l && !vazio_(l.rotulo) ? l.rotulo : codigo;
  }
  /** Itens do grupo repetível `deducoes` da venda, validados pelo catálogo; erros com "Dedução k:". */
  function deducoesDaVenda_(m, ctxEv, lista) {
    var defs = EventCatalog.camposGrupo('VENDA', 'deducoes');
    if (lista !== undefined && lista !== null && !Array.isArray(lista)) { erroGeral_(m, 'deducoes', 'TIPO_INVALIDO', 'As deduções precisam vir como lista.'); return []; }
    return (lista || []).map(function (bruto, k) {
      var x = bruto && typeof bruto === 'object' ? bruto : {};
      var quem = 'Dedução ' + (k + 1) + ': ';
      EventCatalog.validarCampos(defs, x, { listas: m.listas }).forEach(function (e) { erroGeral_(m, 'deducoes', e.codigo, quem + e.mensagem); });
      parceiroValido_(m, ctxEv, 'deducoes', x.partner_id, quem);
      return x;
    });
  }
  /**
   * Financeiro da VENDA (03b, seções 4.2, 4.5, 10.3 e 2.6; 07, seção 4; P11): a receita (bruto − desconto comercial) é
   * um lançamento RECEITA_VENDA_ANIMAIS com as parcelas de recebimento; cada dedução é um lançamento DESPESA_VENDA na
   * conta do tipo (frete, comissão, taxas e retenções), com parceiro e título próprios; todos 100% rateados pelas
   * mesmas bases do critério do evento. A dedução retida pelo comprador nasce com `retida_pelo_comprador` = S e o
   * título no vencimento de um recebimento da venda (o encontro de contas da Fase 4 liquida os dois juntos). O valor
   * individual de cada animal é a alocação da receita; VENDAS guarda o cabeçalho e os totais; o tipo de cada dedução
   * fica em `payload_json.deducoes`.
   */
  function financeiroVenda_(m, ctxEv, d) {
    var c = ctxEv.campos;
    var ev = ctxEv.ev;
    var itens = ctxEv.itens.filter(function (it) { return it.linhaEA && it.negocio; });
    var deducoes = deducoesDaVenda_(m, ctxEv, d.deducoes);
    if (d.parcelas !== undefined && d.parcelas !== null && !Array.isArray(d.parcelas)) { erroGeral_(m, 'parcelas', 'TIPO_INVALIDO', 'As parcelas precisam vir como lista.'); return; }
    var defsParcela = EventCatalog.camposGrupo('VENDA', 'parcelas');
    (d.parcelas || []).forEach(function (p, k) {
      EventCatalog.validarCampos(defsParcela, p && typeof p === 'object' ? p : {}, { listas: m.listas }).forEach(function (e) {
        if (e.campo === 'data_vencimento' || e.campo === 'valor') return; // vencimento e valor: FinancialService.resolverParcelas
        erroGeral_(m, 'parcelas', e.codigo, 'Parcela ' + (k + 1) + ': ' + e.mensagem);
      });
    });
    // Animal com erro ou repetido (ANIMAL_REPETIDO já apontado): sem conjunto de animais certo não há rateio a montar.
    if (!itens.length || itens.length !== ctxEv.itens.length || Utils.unicos(itens.map(function (it) { return it.animal_id; })).length !== itens.length) return;
    var bruto = typeof c.valor_bruto === 'number' ? c.valor_bruto : null;
    var desconto = typeof c.desconto_comercial === 'number' ? c.desconto_comercial : 0;
    if (bruto !== null && desconto >= bruto) erroGeral_(m, 'desconto_comercial', 'VALOR_FORA_DA_FAIXA', 'O desconto (' + Utils.formatarReais(desconto) + ') precisa ser menor que o valor bruto da venda (' + Utils.formatarReais(bruto) + ').');
    var receita = bruto !== null && desconto < bruto ? bruto - desconto : null;
    var neg = FinancialService.negociacao({
      modalidade: c.modalidade, base_peso: nulo_(c.base_peso), rendimento_carcaca_pct: typeof c.rendimento_carcaca_pct === 'number' ? c.rendimento_carcaca_pct : null,
      rendimento_tipo: nulo_(c.rendimento_tipo), preco_unitario: typeof c.preco_unitario === 'number' ? c.preco_unitario : null,
      peso_total_kg: typeof c.peso_vivo_total_kg === 'number' ? c.peso_vivo_total_kg : null,
      peso_carcaca_total_kg: typeof c.peso_carcaca_total_kg === 'number' ? c.peso_carcaca_total_kg : null, carcacaTotal: true,
      valor: receita, valor_conferencia: bruto, campo_valor: 'valor_bruto', rotulo_valor: 'a receita da venda (bruto menos desconto)',
      criterio_rateio: nulo_(c.criterio_rateio), arroba_kg: m.params.arroba_kg, tolerancia_pct: m.params.fin_tolerancia_conferencia_pct,
      animais: itens.map(function (it) { var n = it.negocio; return { chave: it.codigo_interno, peso: n.peso, peso_carcaca_kg: n.peso_carcaca_kg, valor_individual: n.valor_individual, base_manual: n.base_manual }; }),
      pesagens: itens.map(function (it) { return it.ultimaPesagem ? it.ultimaPesagem.peso_kg : null; }),
    });
    var jaRecusados = {};
    m.col.erros.forEach(function (e) { if (!e.animal_id && e.campo) jaRecusados[e.campo] = true; });
    neg.erros.forEach(function (e) {
      if (typeof e.indice === 'number') erroItem_(m, itens[e.indice], e.campo, e.codigo, e.mensagem);
      else if (!jaRecusados[e.campo]) erroGeral_(m, e.campo, e.codigo, e.mensagem);
    });
    neg.avisos.forEach(function (a) { avisoItem_(m, null, a.codigo, a.mensagem); });
    ctxEv.negociacao = neg;
    if (neg.erros.length || receita === null) return;
    var contaReceita = FinancialService.conta(m.repo, FinancialService.CONTAS.VENDA);
    var n = itens.length;
    var rateioItens = itens.map(function (it, i) { return { animal_id: it.animal_id, chave: it.codigo_interno, base: neg.bases[i], quem: it.quem }; });
    var justificativa = neg.criterio === 'MANUAL' ? nulo_(c.justificativa_rateio)
      : neg.estimado ? 'Base estimada: última pesagem de cada animal até ' + br_(ev.event_date) + (neg.peso_vivo_total !== null ? ', ajustada ao peso vivo do lote (' + String(neg.peso_vivo_total).replace('.', ',') + ' kg).' : '.') : null;
    var rateio = { criterio: neg.criterio, itens: rateioItens, cemPorCento: true, justificativa: justificativa, estimado: neg.estimado };
    var planejados = [];
    var lancs = [];
    var principal = FinancialService.planejar(m.tx, {
      evento: ev, conta: contaReceita, naturezas: ['RECEITA_VENDA_ANIMAIS'], valor: receita, descricao: 'Venda de ' + plural_(n, 'animal', 'animais'),
      partner_id: c.partner_id, documento: nulo_(c.nota_fiscal), quantidade: n, parcelas: d.parcelas, rateio: rateio,
      campo: 'valor_bruto', campoParcelas: 'parcelas', rotulo: 'a receita da venda', pagamento: 'será recebida',
    }, m.col);
    var porVenc = {};
    if (principal) {
      planejados.push(principal);
      lancs.push(resumoLancamento_(m, principal, contaReceita, { papel: 'RECEITA' }));
      var porAnimal = Utils.indexarPor(principal.rateio.itens, 'animal_id');
      itens.forEach(function (it) { it.linhaEA.valor_individual = porAnimal[it.animal_id].valor; });
      principal.parcelas.forEach(function (p) { porVenc[p.data_vencimento] = (porVenc[p.data_vencimento] || 0) + p.valor; });
    }
    var vencimentos = principal ? principal.parcelas.map(function (p) { return p.data_vencimento; }) : [];
    var retidoPorVenc = {};
    var feitas = [];
    deducoes.forEach(function (x, k) {
      if (typeof x.valor !== 'number' || vazio_(x.tipo)) return;
      var retida = x.retida_pelo_comprador === true;
      var quem = 'Dedução ' + (k + 1) + ': ';
      var venc = nulo_(x.data_vencimento);
      if (retida) {
        if (!principal) return;
        if (venc && vencimentos.indexOf(venc) < 0) {
          erroGeral_(m, 'deducoes', 'RETIDA_FORA_DO_RECEBIMENTO', quem + 'o que o comprador desconta sai num recebimento da venda: use o vencimento de uma parcela da venda (' + Utils.unicos(vencimentos).map(br_).join(', ') + ') ou deixe em branco.');
          return;
        }
        venc = venc || vencimentos[0];
        retidoPorVenc[venc] = (retidoPorVenc[venc] || 0) + x.valor;
      } else venc = venc || ev.event_date;
      var conta = FinancialService.conta(m.repo, FinancialService.contaDeducao(x.tipo));
      var nome = rotuloLista_(m, 'TIPO_DEDUCAO_VENDA', x.tipo);
      var pl = FinancialService.planejar(m.tx, {
        evento: ev, conta: conta, naturezas: ['DESPESA_VENDA'], valor: x.valor, descricao: nulo_(x.descricao) || nome + ' da venda de ' + br_(ev.event_date),
        partner_id: nulo_(x.partner_id) || (retida ? nulo_(c.partner_id) : null), documento: nulo_(x.documento), retida: retida,
        parcelas: [{ data_vencimento: venc, valor: x.valor, forma_pagamento: nulo_(x.forma_pagamento), documento: nulo_(x.documento) }],
        rateio: rateio, campo: 'deducoes', rotulo: 'a dedução ' + (k + 1) + ' (' + nome.toLowerCase() + ')',
      }, m.col);
      if (!pl) return;
      planejados.push(pl);
      lancs.push(resumoLancamento_(m, pl, conta, { papel: 'DEDUCAO', tipo_deducao: x.tipo, retida: retida }));
      feitas.push({ financial_id: pl.financial_id, tipo: x.tipo, valor: x.valor, retida: retida });
    });
    Object.keys(retidoPorVenc).sort().forEach(function (v) {
      if (retidoPorVenc[v] > (porVenc[v] || 0)) {
        erroGeral_(m, 'deducoes', 'RETENCAO_MAIOR_QUE_RECEBIMENTO', 'O comprador descontaria ' + Utils.formatarReais(retidoPorVenc[v]) + ' em ' + br_(v) + ', mais do que ele paga nesse dia (' + Utils.formatarReais(porVenc[v] || 0) + ').');
      }
    });
    if (m.col.temErros()) return;
    planejados.forEach(function (pl) { FinancialService.juntar(ctxEv.plano, pl); });
    var tot = FinancialService.totaisVenda({ valor_bruto: bruto, desconto_comercial: desconto, deducoes: feitas });
    ctxEv.plano.VENDAS.push({
      sale_id: m.tx.novoId(), event_id: ev.event_id, finalidade: c.finalidade, modalidade: c.modalidade, base_peso: neg.base_peso,
      rendimento_carcaca_pct: neg.rendimento_pct, rendimento_tipo: neg.rendimento_tipo, qtd_animais: n, peso_vivo_total_kg: neg.peso_vivo_total,
      peso_carcaca_total_kg: neg.peso_carcaca_total, preco_unitario: neg.unidade_preco ? neg.preco_unitario : null, unidade_preco: neg.unidade_preco,
      valor_bruto: bruto, desconto_comercial: desconto, frete: tot.frete, comissao: tot.comissao, outras_deducoes: tot.outras_deducoes,
      criterio_rateio: neg.criterio, gta_numero: nulo_(c.gta_numero), nota_fiscal: nulo_(c.nota_fiscal), observacoes: nulo_(c.condicoes),
    });
    ev.partner_id = c.partner_id;
    ev.total_value = bruto;
    ctxEv.deducoes = feitas.map(function (x) { return { financial_id: x.financial_id, tipo: x.tipo }; });
    resumoFinanceiro_(m, ctxEv, lancs, planejados);
    // Por animal, a receita e as deduções separadas (não se somam: uma é entrada, a outra saída).
    var receitaDe = Utils.indexarPor(principal.rateio.itens, 'animal_id');
    var deducaoDe = {};
    planejados.slice(1).forEach(function (pl) { pl.rateio.itens.forEach(function (x) { deducaoDe[x.animal_id] = (deducaoDe[x.animal_id] || 0) + x.valor; }); });
    ctxEv.financeiro.por_animal = itens.map(function (it) {
      var r = receitaDe[it.animal_id];
      return { animal_id: it.animal_id, codigo_interno: it.codigo_interno || null, brinco: it.brincoTexto || null, base: r.base, valor: r.valor, deducoes: deducaoDe[it.animal_id] || 0, liquido: r.valor - (deducaoDe[it.animal_id] || 0) };
    });
    ctxEv.venda = resumoVenda_(m, c, neg, tot, n);
    var a = FinancialService.avisoPeriodo(m.params, ev.event_date, 'A venda');
    if (a) avisoItem_(m, null, a.codigo, a.mensagem);
  }
  /**
   * Resumo da negociação para a revisão (07, seções 4.2 e 4.3; calculado na leitura, nunca gravado): totais, conferência
   * pelo preço, pesos, arrobas com a base, preços médios pela receita e, sem arroba na negociação, o equivalente em
   * arrobas estimadas pelo rendimento padrão (rotulado).
   */
  function resumoVenda_(m, c, neg, tot, n) {
    var arroba = m.params.arroba_kg || 15;
    var vivo = neg.peso_vivo_total;
    var exatas = neg.peso_carcaca_total !== null ? neg.peso_carcaca_total / arroba
      : neg.base_peso === 'VIVO' && vivo !== null && neg.rendimento_pct !== null ? vivo * neg.rendimento_pct / 100 / arroba : null;
    var base = neg.peso_carcaca_total !== null ? 'CARCACA' : exatas !== null ? (neg.rendimento_tipo === 'NEGOCIADO' ? 'NEGOCIADA' : 'ESTIMADA') : null;
    var equivalente = null;
    var rend = m.params.rendimento_carcaca_padrao_pct;
    if (exatas === null && vivo !== null && typeof rend === 'number' && rend > 0) {
      var eq = vivo * rend / 100 / arroba;
      equivalente = { rendimento_pct: rend, arrobas: Utils.arredondar(eq, 2), preco_arroba: Math.round(tot.receita / eq), base: 'ESTIMADA' };
    }
    return {
      finalidade: c.finalidade, modalidade: c.modalidade, base_peso: neg.base_peso, criterio: neg.criterio, base_estimada: neg.estimado,
      valor_bruto: tot.valor_bruto, desconto_comercial: tot.desconto_comercial, receita: tot.receita, frete: tot.frete, comissao: tot.comissao,
      outras_deducoes: tot.outras_deducoes, deducoes: tot.deducoes, retidas: tot.retidas, resultado_negociacao: tot.resultado_negociacao,
      deposito_esperado: tot.deposito_esperado, conferencia: neg.conferencia, desvio_pct: neg.desvio_pct, peso_vivo_total: vivo,
      peso_carcaca_total: neg.peso_carcaca_total, rendimento_pct: neg.rendimento_pct, rendimento_tipo: neg.rendimento_tipo,
      arrobas: exatas === null ? null : Utils.arredondar(exatas, 2), arroba_base: base, preco_unitario: neg.preco_unitario, unidade_preco: neg.unidade_preco,
      preco_medio_cabeca: Math.round(tot.receita / n), preco_medio_kg: vivo ? Math.round(tot.receita / vivo) : null,
      preco_medio_arroba: exatas ? Math.round(tot.receita / exatas) : null, equivalente_arroba: equivalente,
    };
  }

  // ------------------------------------------------------------------ valor de abertura ----
  /**
   * Valor de abertura (03b, seções 10.3 e 13): um lançamento AQUISICAO_ANIMAIS na conta SALDO_ABERTURA_REBANHO,
   * sem parcela (não é caixa), com rateio VALOR_INDIVIDUAL (DIRETO com um animal) e uma alocação por animal.
   */
  function abertura_(m, ctxEv) {
    var com = ctxEv.itens.filter(function (it) { return it.linhaEA && typeof it.linhaEA.valor_individual === 'number'; });
    if (!com.length) return;
    var conta = m.repo.unico('PLANO_CONTAS', 'codigo', CONTA_ABERTURA);
    if (!conta || conta.ativo === false) throw Validation.erro('CONFIG', 'A conta "Saldo de abertura do rebanho" não está no plano de contas. Execute a configuração inicial.');
    if (m.col.temErros()) return;
    var ev = ctxEv.ev;
    var total = com.reduce(function (s, it) { return s + it.linhaEA.valor_individual; }, 0);
    var r = Utils.ratear(total, com.map(function (it) { return { chave: it.codigo_interno, base: it.linhaEA.valor_individual / 100 }; }));
    var finId = m.tx.novoId();
    var ratId = m.tx.novoId();
    ctxEv.plano.FINANCEIRO.push({
      financial_id: finId, event_id: ev.event_id, ref_event_id: null, conta_id: conta.conta_id, natureza: conta.natureza, tipo: conta.tipo,
      categoria: conta.grupo, descricao: 'Saldo de abertura do rebanho em ' + br_(ev.event_date), data_competencia: ev.event_date,
      competencia_inicio: null, competencia_fim: null, valor: total, quantidade: com.length, product_id: null, pasture_id: null,
      property_id: ev.property_id, categoria_animal_id: null, partner_id: null, retida_pelo_comprador: false, documento: null, observacoes: null,
    });
    ctxEv.plano.RATEIOS.push({
      rateio_id: ratId, event_id: ev.event_id, financial_id: finId, criterio: com.length === 1 ? 'DIRETO' : 'VALOR_INDIVIDUAL',
      escopo_tipo: 'EVENTO', escopo_ref: ev.event_id, periodo_inicio: null, periodo_fim: null, data_base: ev.event_date,
      base_total: r.baseTotal, total_alocado: r.totalAlocado, justificativa: null, created_by: m.tx.usuario,
    });
    var porChave = Utils.indexarPor(r.itens, 'chave');
    com.forEach(function (it) {
      ctxEv.plano.ALOCACOES_FINANCEIRAS.push({ alloc_id: m.tx.novoId(), rateio_id: ratId, financial_id: finId, animal_id: it.animal_id, base_valor: porChave[it.codigo_interno].base, valor_alocado: porChave[it.codigo_interno].valor });
    });
    ev.total_value = total;
    ctxEv.abertura = { total: total, animais: com.length, data: ev.event_date };
    var aviso = FinancialService.avisoPeriodo(m.params, ev.event_date, 'O valor de abertura');
    if (aviso) avisoItem_(m, null, aviso.codigo, aviso.mensagem);
  }

  // ------------------------------------------------------------------ avisos, plano e resposta ----
  /** Política por código (avisos_politica): IGNORA some; BLOQUEIA vira erro com o mesmo código; AVISA pede aceite. */
  function aplicarPolitica_(m) {
    var pol = m.params.avisos_politica || {};
    var ficam = [];
    var periodo = false;
    m.avisos.forEach(function (a) {
      // Período bloqueado: um aviso só por comando (a justificativa é uma), mesmo com vários lançamentos no período.
      if (a.codigo === 'PERIODO_BLOQUEADO') { if (periodo) return; periodo = true; }
      var p = pol[a.codigo] || 'AVISA';
      // Carência (RN-072; 05, seção 4.8): a política vale só na venda para ABATE; nas demais vendas é sempre aviso.
      if (a.codigo === 'CARENCIA_ATIVA' && m.carenciaSemPolitica) p = 'AVISA';
      if (p === 'IGNORA') return;
      if (p === 'BLOQUEIA') m.col.erro(a);
      else ficam.push(a);
    });
    m.avisos = ficam;
  }
  function payload_(m, ctxEv, extra) {
    var aceitos = m.tx.avisosAceitos || [];
    var porCodigo = {};
    m.avisos.forEach(function (a) { if (aceitos.indexOf(a.codigo) >= 0) porCodigo[a.codigo] = (porCodigo[a.codigo] || 0) + 1; });
    var lista = Object.keys(porCodigo).sort().map(function (c) {
      var o = { codigo: c, n: porCodigo[c] };
      if (c === 'PERIODO_BLOQUEADO') o.justificativa = nulo_(m.tx.dados.justificativa_aviso);
      return o;
    });
    if (porCodigo.PERIODO_BLOQUEADO && vazio_(m.tx.dados.justificativa_aviso)) erroGeral_(m, 'justificativa_aviso', 'CAMPO_OBRIGATORIO', 'Para lançar dentro do período financeiro fechado, escreva a justificativa.');
    var p = {};
    Object.keys(extra || {}).forEach(function (k) { if (!vazio_(extra[k])) p[k] = extra[k]; });
    if (lista.length) p.avisos_aceitos = lista;
    return Object.keys(p).length ? p : null;
  }
  /** Valida as linhas montadas contra o esquema (tipos, listas, tetos) com o "quem" de cada animal. */
  function validarLinhas_(m, plano, itensPorAnimal) {
    var listas = m.listas;
    Object.keys(plano).forEach(function (t) {
      plano[t].forEach(function (r) {
        var it = r.animal_id ? itensPorAnimal[r.animal_id] : null;
        var row = {};
        Object.keys(r).forEach(function (k) { if (Schema.temColuna(t, k)) row[k] = r[k]; });
        Validation.validarRegistro(t, row, { parcial: true, semProjecoes: true, tetoCelula: m.teto, listas: listas }).forEach(function (d) {
          m.col.erro({ codigo: d.codigo, animal_id: it && it.publico ? it.animal_id : null, brinco: it ? it.brincoTexto : null, campo: d.campo, mensagem: (it ? it.quem + ': ' : '') + d.mensagem });
        });
      });
    });
  }
  function fechar_(m, ctxEv) {
    var ev = ctxEv.ev;
    aplicarPolitica_(m);
    var extra = {
      justificativa: ctxEv.original ? nulo_(m.tx.dados.justificativa) : null, valor_abertura_origem: ctxEv.abertura ? 'INFORMADO' : null,
      gta_numero: ctxEv.tipo === 'TRANSFERENCIA' && typeof ctxEv.campos.gta_numero === 'string' ? nulo_(Utils.aparar(ctxEv.campos.gta_numero)) : null,
      deducoes: ctxEv.deducoes && ctxEv.deducoes.length ? ctxEv.deducoes : null,
      acao: ctxEv.tipo === 'MARCACAO' ? ctxEv.ev.payload_json.acao : null,
      motivo_descarte: ctxEv.tipo === 'MARCACAO' ? ctxEv.ev.payload_json.motivo_descarte : null,
    };
    ev.payload_json = payload_(m, ctxEv, extra);
    var itensPorAnimal = {};
    ctxEv.itens.forEach(function (it) { if (it.animal_id && !itensPorAnimal[it.animal_id]) itensPorAnimal[it.animal_id] = it; });
    var linhaEv = {};
    Object.keys(ev).forEach(function (k) { if (Schema.temColuna('EVENTOS', k)) linhaEv[k] = ev[k]; });
    ctxEv.plano.EVENTOS.push(linhaEv);
    if (!m.col.temErros()) validarLinhas_(m, ctxEv.plano, itensPorAnimal);
    if (m.col.temErros()) return { erros: m.col.erros };
    if (m.conflitos.length) throw Validation.erro('CONFLICT', m.conflitos.length === 1 ? m.conflitos[0].mensagem : m.conflitos.length + ' registros já gravados impedem este lançamento.', m.conflitos);
    Object.keys(ctxEv.plano).forEach(function (t) { ctxEv.plano[t].forEach(function (r) { m.tx.plano.anexar(t, r); }); });
    ctxEv.auditorias.forEach(function (a) { AuditService.alteracao(m.tx, 'ANIMAIS', a.id, a.campos, m.tx.dados.justificativa); });
    var animais = Utils.unicos(ctxEv.itens.filter(function (it) { return it.animal_id; }).map(function (it) { return it.animal_id; }).concat(ctxEv.removidos || []));
    var resumo = { acao: ctxEv.original ? 'corrigir' : 'registrar', event_id: ev.event_id, event_type: ev.event_type, event_subtype: ev.event_subtype, event_date: ev.event_date, animais: animais.length, substitui: ctxEv.original ? ctxEv.original.event_id : null };
    return {
      avisos: m.avisos,
      resumo: resumo,
      impactos: {
        acao: resumo.acao, event_type: ev.event_type, event_subtype: ev.event_subtype, event_date: ev.event_date,
        animais: animais.length, novos: ctxEv.plano.ANIMAIS.length, anulados: (ctxEv.removidos || []).length, substitui: resumo.substitui,
        total_value: ev.total_value, abertura: ctxEv.abertura || null, pre_marco_zero: ev.pre_marco_zero === true,
        parto: ctxEv.parto || null, transferencia: ctxEv.transf || null, baixas: ctxEv.plano.BAIXAS.length,
        identificacoes: ctxEv.plano.IDENTIFICACOES.length, ajustes: ctxEv.plano.AJUSTES.length,
        marcacao: ctxEv.tipo === 'MARCACAO' ? { subtipo: ctxEv.subtipo, acao: ctxEv.ev.payload_json.acao, motivo_descarte: ctxEv.ev.payload_json.motivo_descarte } : null,
        compra: ctxEv.compra || null, venda: ctxEv.venda || null, financeiro: ctxEv.financeiro || null,
      },
      derivados: { animais: animais, eventos: [ev.event_id].concat(ctxEv.original ? [ctxEv.original.event_id] : []) },
      resposta: function (t) { return resposta_(t, resumo); },
    };
  }

  // ------------------------------------------------------------------ estorno ----
  function planejarEstorno_(tx) {
    var d = tx.dados || {};
    var m = motor_(tx, []);
    exigirMarcoZero_(m);
    EventCatalog.validarCampos(EventCatalog.camposEvento('ESTORNO'), { event_id: d.event_id, justificativa: d.justificativa }).forEach(function (x) { erroGeral_(m, x.campo, x.codigo, x.mensagem); });
    var alvo = vazio_(d.event_id) ? null : alvo_(m, d.event_id, 'estornar');
    if (!alvo) return { erros: m.col.erros };
    var anteriores = m.col.erros;
    m = motor_(tx, [alvo.event_id]);
    anteriores.forEach(function (x) { m.col.erro(x); });
    var linhas = m.f.linhasDoEvento(alvo.event_id);
    var animais = Utils.unicos(linhas.map(function (l) { return l.animal_id; }));
    var criados = {};
    linhas.forEach(function (l) { if (l.atributos_iniciais_json) criados[l.animal_id] = true; });
    animais.forEach(function (id) {
      if (criados[id]) return conferirAnulacao_(m, id, alvo.event_id, criados);
      var e = m.f.animal(id) || {};
      var it = { animal_id: id, brincoTexto: e.brinco || null, quem: nomeAnimal_(e) };
      var novos = Timeline.problemasNovos(Timeline.validar(m.real.linhas(id), { nascimento: e.data_nascimento }).problemas, Timeline.validar(m.f.linhas(id), { nascimento: e.data_nascimento }).problemas);
      novos.forEach(function (p) { conflito_(m, it, p, Timeline.descrever(p, function (x) { return nomePasto_(m, x); }) + ' Estorne esse registro antes.'); });
    });
    var ficam = animais.filter(function (id) { return !criados[id]; });
    conferirSequencias_(m, null, ficam, null);
    conferirEstadoRestaurado_(m, ficam, 'o estorno', null);
    conferirParcelasLiquidadas_(m, alvo, 'estornar');
    m.repo.por('FINANCEIRO', 'event_id', alvo.event_id).forEach(function (fin) {
      if (!vazio_(m.params.fin_bloqueio_ate) && fin.data_competencia <= m.params.fin_bloqueio_ate) {
        avisoItem_(m, null, 'PERIODO_BLOQUEADO', 'O estorno cancela um lançamento de ' + br_(fin.data_competencia) + ', dentro do período financeiro fechado (até ' + br_(m.params.fin_bloqueio_ate) + '). Confirme com uma justificativa.');
      }
    });
    aplicarPolitica_(m);
    var id = tx.novoId();
    var ev = {
      event_id: id, event_seq: m.repo.contador('EVENTOS', 'event_seq'), event_type: 'ESTORNO', event_subtype: null, event_date: m.hoje,
      registration_date: m.hoje, property_id: alvo.property_id, description: null, total_value: null, responsible: null,
      created_by: tx.usuario, source: 'APP', confiabilidade: 'CONFIRMADA', pre_marco_zero: false, partner_id: null, notes: null,
      payload_json: payload_(m, null, { justificativa: nulo_(d.justificativa) }), reversal_of_event_id: alvo.event_id, import_id: null,
    };
    Validation.validarRegistro('EVENTOS', ev, { parcial: true, semProjecoes: true, tetoCelula: m.teto }).forEach(function (x) { m.col.erro(x); });
    if (m.col.temErros()) return { erros: m.col.erros };
    if (m.conflitos.length) {
      throw Validation.erro('CONFLICT', 'Não dá para estornar: ' + (m.conflitos.length === 1 ? m.conflitos[0].mensagem : m.conflitos.length + ' registros dependem deste evento.'), m.conflitos);
    }
    tx.plano.anexar('EVENTOS', ev);
    var resumo = { acao: 'estornar', event_id: id, event_type: 'ESTORNO', event_date: m.hoje, estorna: alvo.event_id, animais: animais.length };
    return {
      avisos: m.avisos,
      resumo: resumo,
      impactos: { acao: 'estornar', estorna: alvo.event_id, event_type: alvo.event_type, event_date: alvo.event_date, animais: animais.length, anulados: Object.keys(criados).length },
      derivados: { animais: animais, eventos: [alvo.event_id, id] },
      resposta: function (t) { return resposta_(t, resumo); },
    };
  }

  // ------------------------------------------------------------------ respostas e consultas ----
  function animalPublico_(a) {
    return a ? { animal_id: a.animal_id, codigo_interno: a.codigo_interno, brinco: nulo_(a.brinco), sexo: nulo_(a.sexo), situacao_cadastral: a.situacao_cadastral, pasto_atual_id: nulo_(a.pasto_atual_id) } : null;
  }
  /** Resposta de comando (também a do reenvio duplicado): o evento e os animais com as projeções já aplicadas. */
  function resposta_(tx, resumo) {
    var r = resumo || {};
    var alvo = r.acao === 'estornar' ? r.estorna : r.event_id;
    var ev = tx.cru ? tx.cru.cruPorId('EVENTOS', r.event_id) : tx.repo.porId('EVENTOS', r.event_id);
    var linhas = tx.cru ? tx.cru.cruPor('EVENTO_ANIMAIS', 'event_id', alvo) : tx.repo.por('EVENTO_ANIMAIS', 'event_id', alvo);
    var ids = Utils.unicos(linhas.map(function (l) { return l.animal_id; }));
    return {
      acao: r.acao || null, event_id: r.event_id, event_type: ev ? ev.event_type : r.event_type, event_subtype: ev ? nulo_(ev.event_subtype) : null,
      event_date: ev ? ev.event_date : r.event_date, status: tx.cru ? tx.cru.avaliar(r.event_id).status : null,
      total_value: ev ? nulo_(ev.total_value) : null, substitui: r.substitui || null, estorna: r.estorna || null,
      animais: ids.map(function (id) { return animalPublico_(tx.cru ? tx.cru.cruPorId('ANIMAIS', id) : tx.repo.porId('ANIMAIS', id)); }).filter(Boolean),
    };
  }
  function leiturasConsulta_() {
    return Timeline.LEITURAS.concat(['PROPRIEDADES', 'BAIXAS', 'COMPRAS', 'VENDAS']);
  }
  function eventoPublico_(tx, ev) {
    var a = tx.cru.avaliar(ev.event_id);
    var n = Utils.unicos(tx.cru.cruPor('EVENTO_ANIMAIS', 'event_id', ev.event_id).map(function (l) { return l.animal_id; })).length;
    var def = EventCatalog.existe(ev.event_type) ? EventCatalog.tipo(ev.event_type) : null;
    var sub = def && def.subtipos && !vazio_(ev.event_subtype) ? def.subtipos[ev.event_subtype] : null;
    return {
      event_id: ev.event_id, event_seq: ev.event_seq, event_type: ev.event_type, event_subtype: nulo_(ev.event_subtype),
      rotulo: def ? def.rotulo : ev.event_type, rotulo_subtipo: sub ? sub.rotulo : null,
      event_date: ev.event_date, registration_date: ev.registration_date, property_id: ev.property_id, partner_id: nulo_(ev.partner_id), status: a.status, vigente: a.vigente,
      description: nulo_(ev.description), notes: nulo_(ev.notes), responsible: nulo_(ev.responsible), total_value: nulo_(ev.total_value),
      created_by: ev.created_by, source: ev.source, pre_marco_zero: ev.pre_marco_zero === true, payload: ev.payload_json || null,
      reversal_of_event_id: nulo_(ev.reversal_of_event_id), anulado_por: a.anulador_id, animais: n, created_at: ev.created_at,
    };
  }
  /**
   * Consulta evento.listar: filtros {tipo, subtipo, de, ate, animal_id, vigentes (só os que valem), pagina, por_pagina}.
   * Mostra também os anulados (histórico); operações que falharam não aparecem. Mais recentes primeiro.
   */
  function consultaListar(filtros) {
    var o = filtros || {};
    return {
      rota: 'evento.listar', dados: o, reads: leiturasConsulta_(), acessoCru: true,
      tratador: function (tx) {
        var porPagina = typeof o.por_pagina === 'number' && o.por_pagina > 0 ? Math.min(o.por_pagina, 500) : Timeline.parametros(tx.repo).itens_por_pagina || 50;
        var pagina = typeof o.pagina === 'number' && o.pagina >= 1 ? Math.floor(o.pagina) : 1;
        var base = vazio_(o.animal_id) ? tx.cru.cru('EVENTOS') : Utils.unicos(tx.cru.cruPor('EVENTO_ANIMAIS', 'animal_id', o.animal_id).map(function (l) { return l.event_id; })).map(function (id) { return tx.cru.cruPorId('EVENTOS', id); }).filter(Boolean);
        // No histórico de um animal entram também os estornos dos eventos dele (o ESTORNO não tem linha de animal).
        if (!vazio_(o.animal_id)) {
          var doAnimal = {};
          base.forEach(function (ev) { doAnimal[ev.event_id] = true; });
          base = base.concat(Utils.unicos(base.map(function (ev) { return ev.event_id; })).reduce(function (acc, id) {
            return acc.concat(tx.cru.cruPor('EVENTOS', 'reversal_of_event_id', id).filter(function (x) { return x.event_type === 'ESTORNO' && !doAnimal[x.event_id]; }));
          }, []));
        }
        var lista = base.filter(function (ev) {
          var st = tx.cru.avaliar(ev.event_id).status;
          if (st === 'FALHOU' || st === 'PENDENTE') return false;
          if (o.vigentes === true && !tx.cru.avaliar(ev.event_id).vigente) return false;
          if (!vazio_(o.tipo) && ev.event_type !== o.tipo) return false;
          if (!vazio_(o.subtipo) && nulo_(ev.event_subtype) !== o.subtipo) return false;
          if (!vazio_(o.de) && ev.event_date < o.de) return false;
          if (!vazio_(o.ate) && ev.event_date > o.ate) return false;
          return true;
        });
        lista = Utils.ordenarPor(lista, [{ campo: 'event_date', desc: true }, { campo: 'event_seq', desc: true }]);
        var inicio = (pagina - 1) * porPagina;
        return { total: lista.length, pagina: pagina, por_pagina: porPagina, itens: lista.slice(inicio, inicio + porPagina).map(function (ev) { return eventoPublico_(tx, ev); }) };
      },
    };
  }
  /** Consulta evento.obter: cabeçalho, situação, animais e todas as linhas de detalhe do evento (inclusive se anulado). */
  function consultaObter(dados) {
    var o = dados || {};
    return {
      rota: 'evento.obter', dados: o, reads: leiturasConsulta_(), acessoCru: true,
      tratador: function (tx) {
        var ev = vazio_(o.event_id) ? null : tx.cru.cruPorId('EVENTOS', o.event_id);
        var st = ev ? tx.cru.avaliar(ev.event_id).status : null;
        if (!ev || st === 'FALHOU' || st === 'PENDENTE') throw Validation.erro('NOT_FOUND', 'Evento não encontrado.');
        var detalhes = {};
        ['IDENTIFICACOES', 'PESAGENS', 'REPRODUCAO', 'BAIXAS', 'AJUSTES', 'COMPRAS', 'VENDAS', 'FINANCEIRO', 'RATEIOS'].forEach(function (t) {
          detalhes[t] = tx.cru.cruPor(t, 'event_id', ev.event_id).map(Utils.clonar);
        });
        detalhes.PARCELAS = [];
        detalhes.FINANCEIRO.forEach(function (f) {
          detalhes.PARCELAS = detalhes.PARCELAS.concat(Utils.ordenarPor(tx.cru.cruPor('PARCELAS', 'financial_id', f.financial_id), 'parcela_num').map(Utils.clonar));
        });
        detalhes.ALOCACOES_FINANCEIRAS = [];
        detalhes.RATEIOS.forEach(function (r) { detalhes.ALOCACOES_FINANCEIRAS = detalhes.ALOCACOES_FINANCEIRAS.concat(tx.cru.cruPor('ALOCACOES_FINANCEIRAS', 'rateio_id', r.rateio_id).map(Utils.clonar)); });
        var linhas = tx.cru.cruPor('EVENTO_ANIMAIS', 'event_id', ev.event_id).map(function (l) {
          var c = Utils.clonar(l);
          var a = tx.cru.cruPorId('ANIMAIS', l.animal_id);
          c.codigo_interno = a ? a.codigo_interno : null;
          c.brinco = a ? nulo_(a.brinco) : null;
          return c;
        });
        var anula = vazio_(ev.reversal_of_event_id) ? null : tx.cru.cruPorId('EVENTOS', ev.reversal_of_event_id);
        return { evento: eventoPublico_(tx, ev), linhas: linhas, detalhes: detalhes, anula: anula ? eventoPublico_(tx, anula) : null };
      },
    };
  }
  function listar(ctx, filtros) {
    return UnitOfWork.read(ctx, consultaListar(filtros));
  }
  function obter(ctx, dados) {
    return UnitOfWork.read(ctx, consultaObter(dados));
  }

  // ------------------------------------------------------------------ categorias ----
  function casaCategoria_(c, perfil, idade) {
    if (c.sexo_aplicavel !== 'AMBOS' && c.sexo_aplicavel !== perfil.sexo) return false;
    var min = nulo_(c.idade_minima_meses);
    var max = nulo_(c.idade_maxima_meses);
    if (idade === null || idade === undefined) { if (min !== null || max !== null) return false; } else if ((min !== null && idade < min) || (max !== null && idade >= max)) return false;
    switch (c.condicao) {
      case 'CASTRADO': return perfil.castrado === true;
      case 'INTEIRO': return perfil.castrado !== true;
      case 'REPRODUTOR': return perfil.reprodutor === true;
      case 'NAO_REPRODUTOR': return perfil.reprodutor !== true;
      case 'PARIDA': return perfil.parida === true;
      case 'NAO_PARIDA': return perfil.parida !== true;
      default: return true;
    }
  }
  function porIdade_(perfil, idade, categorias) {
    var ativas = Utils.ordenarPor((categorias || []).filter(function (c) { return c.ativo !== false; }), 'prioridade');
    for (var i = 0; i < ativas.length; i++) if (casaCategoria_(ativas[i], perfil, idade)) return ativas[i];
    return null;
  }
  /**
   * Categoria do animal na data D (05, seção 4.9), função pura sobre CATEGORIAS. perfil: {sexo, data_nascimento,
   * castrado, reprodutor, parida, categoria_modo, categoria_manual_id} (os valores que valiam em D).
   * Devolve {category_id, codigo, nome, manual} ou null (sem categoria).
   */
  function classificarCategoria(perfil, data, categorias) {
    var p = perfil || {};
    if (p.categoria_modo === 'MANUAL' && !vazio_(p.categoria_manual_id)) {
      var manual = (categorias || []).filter(function (c) { return c.category_id === p.categoria_manual_id; })[0];
      if (manual) return { category_id: manual.category_id, codigo: manual.codigo, nome: manual.nome, manual: true };
    }
    var idade = vazio_(p.data_nascimento) || !Utils.dataValida(data) ? null : Utils.idadeMeses(p.data_nascimento, data);
    if (idade !== null && idade < 0) return null;
    var c = porIdade_(p, idade, categorias);
    return c ? { category_id: c.category_id, codigo: c.codigo, nome: c.nome, manual: false } : null;
  }
  /**
   * Cobertura (RN-097): para cada perfil (macho reprodutor, inteiro, castrado; fêmea parida, não parida) e cada
   * faixa entre os cortes de idade das categorias ativas, classifica um animal na idade do corte inferior.
   * Devolve {completa, testes, lacunas: [{perfil, rotulo, idade_de, idade_ate}]} (idade_ate null = sem teto).
   */
  function coberturaCategorias(categorias) {
    var cortes = [0];
    (categorias || []).forEach(function (c) {
      if (c.ativo === false) return;
      [c.idade_minima_meses, c.idade_maxima_meses].forEach(function (v) { if (typeof v === 'number' && cortes.indexOf(v) < 0) cortes.push(v); });
    });
    cortes.sort(function (a, b) { return a - b; });
    var lacunas = [];
    var testes = 0;
    PERFIS_CATEGORIA.forEach(function (p) {
      cortes.forEach(function (de, i) {
        testes++;
        if (!porIdade_(p, de, categorias)) lacunas.push({ perfil: p.id, rotulo: p.rotulo, idade_de: de, idade_ate: i + 1 < cortes.length ? cortes[i + 1] : null });
      });
    });
    return { completa: !lacunas.length, testes: testes, lacunas: lacunas };
  }

  return {
    MAX_ANIMAIS: MAX_ANIMAIS,
    MAX_CRIAS: MAX_CRIAS,
    ROTAS: ROTAS,
    comando: comando,
    registrar: registrar,
    planejarEntradaImportada: planejarEntradaImportada,
    leiturasEntrada: leiturasEntrada,
    corrigir: corrigir,
    estornar: estornar,
    simular: simular,
    consultaListar: consultaListar,
    consultaObter: consultaObter,
    listar: listar,
    obter: obter,
    classificarCategoria: classificarCategoria,
    coberturaCategorias: coberturaCategorias,
  };
})();
