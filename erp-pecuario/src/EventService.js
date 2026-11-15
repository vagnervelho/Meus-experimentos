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
    if (!EventCatalog.ativo(tipo, subtipo)) {
      return { erros: [Validation.detalhe({ codigo: 'TIPO_INDISPONIVEL', campo: vazio_(subtipo) ? 'tipo' : 'subtipo', mensagem: EventCatalog.subtipos(tipo).length && vazio_(subtipo) ? 'Escolha o tipo de correção.' : 'Este tipo de lançamento ainda não está disponível.' })] };
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

    var plano = { EVENTOS: [], ANIMAIS: [], EVENTO_ANIMAIS: [], IDENTIFICACOES: [], PESAGENS: [], REPRODUCAO: [], BAIXAS: [], AJUSTES: [], COMPRAS: [], FINANCEIRO: [], PARCELAS: [], RATEIOS: [], ALOCACOES_FINANCEIRAS: [] };
    var ctxEv = { tipo: tipo, subtipo: subtipo, ev: ev, campos: campos, original: original, plano: plano, itens: [], criadosOriginal: {}, auditorias: [] };
    if (original) {
      m.f.linhasDoEvento(original.event_id).forEach(function (l) { if (l.atributos_iniciais_json) ctxEv.criadosOriginal[l.animal_id] = true; });
    }
    if (tipo === 'TRANSFERENCIA') cabecalhoTransferencia_(m, ctxEv);
    if (tipo === 'COMPRA') cabecalhoCompra_(m, ctxEv);
    animais.forEach(function (item, i) {
      var it = novoItem_(m, item || {}, i);
      ctxEv.itens.push(it);
      if (tipo === 'AJUSTE_INVENTARIO') itemAjuste_(m, ctxEv, it);
      else if (tipo === 'TRANSFERENCIA') itemTransferencia_(m, ctxEv, it);
      else if (tipo === 'MORTE' || tipo === 'DESCARTE') itemSaida_(m, ctxEv, it);
      else if (tipo === 'NASCIMENTO') itemMatriz_(m, ctxEv, it);
      else itemEntrada_(m, ctxEv, it);
    });
    if (tipo === 'NASCIMENTO') crias_(m, ctxEv, d.crias);
    conferirRepetidos_(m, ctxEv);
    conferirBrincos_(m, ctxEv);
    conferirGenealogia_(m, ctxEv);
    conferirLinhaDoTempo_(m, ctxEv);
    if (original) conferirRemovidos_(m, ctxEv);
    guardaDuplicidade_(m, ctxEv);
    conferirLotacao_(m, ctxEv);
    if (tipo === 'NASCIMENTO') avisosDoParto_(m, ctxEv);
    if (tipo === 'ENTRADA_INICIAL') abertura_(m, ctxEv);
    if (tipo === 'COMPRA') financeiroCompra_(m, ctxEv, d);
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
    EventCatalog.validarCampos(EventCatalog.camposEvento(tipo), campos, { listas: m.listas }).forEach(function (x) { erroGeral_(m, x.campo, x.codigo, x.mensagem); });
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
    linhaEA_(m, ctxEv, it, { efeito_inventario: -1, pasto_origem_id: onde.presente ? nulo_(onde.pasture_id) : null, observacoes: nulo_(d.observacoes) });
    var morte = ctxEv.tipo === 'MORTE';
    ctxEv.plano.BAIXAS.push({
      baixa_id: m.tx.novoId(), event_id: ev.event_id, animal_id: it.animal_id, tipo: ctxEv.tipo,
      causa: morte ? nulo_(c.causa) : null, diagnostico: morte ? nulo_(c.diagnostico) : null,
      motivo: morte ? null : nulo_(c.motivo), destino: morte ? null : nulo_(c.destino),
      responsavel: nulo_(ev.responsible), observacoes: nulo_(d.observacoes),
    });
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
    return correcaoLocalizacao_(m, ctxEv, it, e);
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
      if (vistos[it.animal_id]) erroItem_(m, it, 'animal_id', 'ANIMAL_REPETIDO', 'o animal aparece mais de uma vez neste lançamento.');
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
        var texto = Timeline.descrever(p, function (id) { return nomePasto_(m, id); });
        if (p.event_id === ctxEv.ev.event_id) erroItem_(m, it, null, p.codigo, texto);
        else conflito_(m, it, p, texto + ' Estorne ou corrija esse registro antes, ou mude este lançamento.');
      });
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
      return c.event_type === ev.event_type && nulo_(c.event_subtype) === nulo_(ev.event_subtype) && !m.f.excluidos[c.event_id];
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
    if (!vazio_(m.params.fin_bloqueio_ate) && ev.event_date <= m.params.fin_bloqueio_ate) {
      avisoItem_(m, null, 'PERIODO_BLOQUEADO', 'O valor de abertura cai em ' + br_(ev.event_date) + ', dentro do período financeiro fechado (até ' + br_(m.params.fin_bloqueio_ate) + '). Confirme com uma justificativa.');
    }
  }

  // ------------------------------------------------------------------ avisos, plano e resposta ----
  /** Política por código (avisos_politica): IGNORA some; BLOQUEIA vira erro com o mesmo código; AVISA pede aceite. */
  function aplicarPolitica_(m) {
    var pol = m.params.avisos_politica || {};
    var ficam = [];
    m.avisos.forEach(function (a) {
      var p = pol[a.codigo] || 'AVISA';
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
    return Timeline.LEITURAS.concat(['PROPRIEDADES', 'BAIXAS']);
  }
  function eventoPublico_(tx, ev) {
    var a = tx.cru.avaliar(ev.event_id);
    var n = Utils.unicos(tx.cru.cruPor('EVENTO_ANIMAIS', 'event_id', ev.event_id).map(function (l) { return l.animal_id; })).length;
    return {
      event_id: ev.event_id, event_seq: ev.event_seq, event_type: ev.event_type, event_subtype: nulo_(ev.event_subtype),
      rotulo: EventCatalog.existe(ev.event_type) ? EventCatalog.tipo(ev.event_type).rotulo : ev.event_type,
      event_date: ev.event_date, registration_date: ev.registration_date, property_id: ev.property_id, status: a.status, vigente: a.vigente,
      description: nulo_(ev.description), notes: nulo_(ev.notes), responsible: nulo_(ev.responsible), total_value: nulo_(ev.total_value),
      created_by: ev.created_by, source: ev.source, pre_marco_zero: ev.pre_marco_zero === true, payload: ev.payload_json || null,
      reversal_of_event_id: nulo_(ev.reversal_of_event_id), anulado_por: a.anulador_id, animais: n, created_at: ev.created_at,
    };
  }
  /**
   * Consulta evento.listar: filtros {tipo, de, ate, animal_id, vigentes (só os que valem), pagina, por_pagina}.
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
        var lista = base.filter(function (ev) {
          var st = tx.cru.avaliar(ev.event_id).status;
          if (st === 'FALHOU' || st === 'PENDENTE') return false;
          if (o.vigentes === true && !tx.cru.avaliar(ev.event_id).vigente) return false;
          if (!vazio_(o.tipo) && ev.event_type !== o.tipo) return false;
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
        ['IDENTIFICACOES', 'PESAGENS', 'REPRODUCAO', 'BAIXAS', 'AJUSTES', 'FINANCEIRO', 'RATEIOS'].forEach(function (t) {
          detalhes[t] = tx.cru.cruPor(t, 'event_id', ev.event_id).map(Utils.clonar);
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
