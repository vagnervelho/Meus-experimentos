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
  /**
   * Tipos cujo histórico anterior ao marco zero entra pela importação de planilha (04, seção 6: compras, vendas,
   * transferências, nascimentos e mortes antigos; Fase 3, E3.6: pesagens, aplicações sanitárias, registros reprodutivos e
   * ocorrências antigos, que contam para a curva de peso, o histórico sanitário e a reprodução): no formulário só o parto
   * aceita data antiga; a correção de um registro histórico continua histórica.
   */
  var HISTORICO_IMPORTADO = ['COMPRA', 'VENDA', 'TRANSFERENCIA', 'NASCIMENTO', 'MORTE', 'PESAGEM', 'SANIDADE', 'REPRODUCAO', 'OCORRENCIA'];
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
      // ANEXOS: a correção passa os anexos do original ao substituto (FileService.anexosDoSubstituto).
      reads: Utils.unicos(EventCatalog.leituras(EventCatalog.existe(tipo) ? tipo : null).concat(Timeline.LEITURAS, ['ANEXOS'])),
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
  /**
   * O equivalente de planejarEntradaImportada para os eventos históricos da importação (COMPRA, VENDA, TRANSFERENCIA,
   * NASCIMENTO, MORTE e, na Fase 3, PESAGEM, SANIDADE, REPRODUCAO, OCORRENCIA; RN-090): o MESMO planejamento do formulário,
   * dentro do tratador de outro comando, sem abrir
   * unidade. dados: {tipo, subtipo, campos, animais, crias, parcelas, custos, deducoes} como em registrar. opcoes:
   * {importacao: {import_id}, rotulos: [texto por item], rotulosCrias: [texto por cria]}. Com import_id a data anterior
   * ao marco zero vira registro histórico (pre_marco_zero, efeito 0, financeiro sem caixa). O tx precisa ter lido
   * `leiturasEvento(tipo)` e ter acesso cru. Devolve o resultado do tratador; CONFLICT e CONFIG são lançados.
   */
  function planejarEventoImportado(tx, dados, opcoes) {
    var o = opcoes || {};
    var d = dados || {};
    if (!o.importacao || vazio_(o.importacao.import_id)) throw interno_('planejarEventoImportado precisa do import_id.');
    if (HISTORICO_IMPORTADO.indexOf(d.tipo) < 0) throw interno_('Tipo sem importação de eventos: ' + d.tipo + '.');
    return planejarEvento_(tx, 'registrar', { dados: d, importacao: o.importacao, conhecidos: o.conhecidos || {}, rotulos: o.rotulos || null, rotulosCrias: o.rotulosCrias || null });
  }
  /** Abas que o tratador precisa ler para planejar um evento do tipo (reads do comando que chama planejarEventoImportado). */
  function leiturasEvento(tipo) {
    return Utils.unicos(EventCatalog.leituras(tipo).concat(Timeline.LEITURAS, ['ANEXOS']));
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
  /** Itens desativados das listas: {lista: {codigo: rótulo}} (a mensagem diz o nome do item, não o código). */
  function listasDesativadas_(repo) {
    var out = {};
    repo.vigentes('LISTAS').forEach(function (l) { if (l.ativo === false) (out[l.lista] = out[l.lista] || {})[l.codigo] = l.rotulo || l.codigo; });
    return out;
  }
  /**
   * Correção: o item de lista desativado depois de usado continua valendo para o substituto (03a, seção 3, LISTAS: o
   * item desativado sai dos seletores e continua resolvendo o histórico; CONTRATOS, seção 30: a correção substitui o
   * original com os mesmos dados que não mudaram), como o parceiro desativado do original. Só o código desativado que
   * aparece nas linhas do original volta a ser aceito; um desativado novo continua recusado.
   */
  var TABELAS_DO_ORIGINAL = ['EVENTO_ANIMAIS', 'COMPRAS', 'VENDAS', 'BAIXAS', 'IDENTIFICACOES', 'PESAGENS', 'REPRODUCAO', 'AJUSTES', 'SANIDADE', 'MOVIMENTOS_ESTOQUE', 'FINANCEIRO'];
  function aceitarListasDoOriginal_(m, original) {
    var usados = {};
    var coletar = function (v) {
      if (typeof v === 'string') usados[v] = true;
      else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { coletar(v[k]); });
    };
    // O pasto informado que nenhum animal recebeu (o do parto só de natimorto, no payload; o da desmama do bezerro que já estava
    // nele, origem = destino) não conta como usado: a correção que passa a levar animal para ele confere se está ativo.
    coletar(Object.assign({}, original.payload_json || {}, { pasto_destino_id: null }));
    TABELAS_DO_ORIGINAL.forEach(function (t) {
      if (!m.repo.carregada(t)) return;
      m.repo.por(t, 'event_id', original.event_id).forEach(function (r) {
        if (t === 'EVENTO_ANIMAIS' && !vazio_(r.pasto_destino_id) && r.pasto_origem_id === r.pasto_destino_id) { coletar(Object.assign({}, r, { pasto_origem_id: null, pasto_destino_id: null })); return; }
        coletar(r);
        if (t === 'FINANCEIRO' && m.repo.carregada('PARCELAS')) m.repo.por('PARCELAS', 'financial_id', r.financial_id).forEach(coletar);
      });
    });
    // O pasto, a propriedade e a categoria desativados depois de usados pelo original também continuam valendo (RN-045:
    // mudar só valores ou observações nunca é bloqueado); um desativado novo continua recusado.
    coletar(original.property_id);
    m.usadosOriginal = usados;
    Object.keys(m.desativados).forEach(function (lista) {
      Object.keys(m.desativados[lista]).forEach(function (codigo) {
        if (!usados[codigo]) return;
        (m.listas[lista] = m.listas[lista] || []).push(codigo);
        delete m.desativados[lista][codigo];
      });
    });
  }
  function motor_(tx, excluir, opcoes) {
    if (vazio_(tx.hoje)) throw interno_('Contexto sem fuso: não há como saber a data de hoje.');
    var params = Timeline.parametros(tx.repo);
    var f = Timeline.fonte(tx, { excluir: excluir, parametros: params });
    var m = {
      tx: tx, repo: tx.repo, params: params, D0: params.data_marco_zero, hoje: tx.hoje, f: f,
      real: excluir && excluir.length ? Timeline.fonte(tx, { parametros: params }) : f,
      col: Validation.coletor(), conflitos: [], avisos: [], listas: listasAtivas_(tx.repo), desativados: listasDesativadas_(tx.repo), afetados: {}, cache: {},
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
  /**
   * O animal nas mensagens de um lançamento numa data passada: pelo brinco que ele tinha NAQUELE dia (CONTRATOS, seção 47; o
   * número trocado ou reaproveitado depois é de outro animal), com o de hoje entre parênteses quando mudou.
   */
  function nomeNaData_(m, e) {
    if (!e || vazio_(m.dataEv) || !Utils.dataValida(m.dataEv) || m.dataEv >= m.hoje || e.situacao_cadastral === 'EXTERNO') return nomeAnimal_(e);
    var b = Timeline.brincoEm(m.f, e.animal_id, m.dataEv);
    var naData = vazio_(b) ? e.codigo_interno : b;
    var hoje = nomeAnimal_(e);
    return naData === hoje ? hoje : naData + ' (hoje ' + hoje + ')';
  }
  function nomePasto_(m, id) {
    var p = m.f.pasto(id);
    return p ? p.nome : id;
  }
  function erroItem_(m, it, campo, codigo, mensagem) {
    if (campo) (it.camposComErro = it.camposComErro || {})[campo] = true;
    m.col.erro({ codigo: codigo, animal_id: it.publico ? it.animal_id : null, brinco: it.brincoTexto || null, campo: campo, mensagem: it.quem + ': ' + mensagem });
  }
  function avisoItem_(m, it, codigo, mensagem, conflito) {
    m.avisos.push(Validation.detalhe({ codigo: codigo, animal_id: it && it.publico ? it.animal_id : null, brinco: it ? it.brincoTexto : null, mensagem: mensagem, conflito: conflito || null }));
  }
  function conflito_(m, it, p, mensagem) {
    m.conflitos.push(Validation.detalhe({
      codigo: p.codigo, animal_id: it.animal_id, brinco: it.brincoTexto || null, mensagem: it.quem + ': ' + mensagem,
      conflito: conflitoCom_(p.event_id, p.event_type, p.event_subtype, p.event_date),
    }));
  }
  /**
   * Estorno de um substituto: o original que ele corrigiu ({event_id, event_date, nome}), para a revisão avisar que o
   * lançamento some por inteiro e o original não volta (03b, seção 4: anulação definitiva); null se não é correção.
   */
  function originalDaCorrecao_(m, alvo) {
    if (vazio_(alvo.reversal_of_event_id) || alvo.event_type === 'ESTORNO') return null;
    var o = m.tx.cru ? m.tx.cru.cruPorId('EVENTOS', alvo.reversal_of_event_id) : m.repo.porId('EVENTOS', alvo.reversal_of_event_id);
    return o ? { event_id: o.event_id, event_date: o.event_date, nome: EventCatalog.nomeEvento(o.event_type, o.event_subtype) } : { event_id: alvo.reversal_of_event_id, event_date: null, nome: null };
  }
  /** O evento que impede, para o link da tela (CONTRATOS, seção 14): tipo e subtipo separados e o nome pronto. */
  function conflitoCom_(eventId, tipoEvento, subtipo, data) {
    var conhecido = !vazio_(tipoEvento) && EventCatalog.existe(tipoEvento);
    return { event_id: eventId, tipo: conhecido ? tipoEvento : null, subtipo: conhecido ? nulo_(subtipo) : null, data: data, nome: conhecido ? EventCatalog.nomeEvento(tipoEvento, subtipo) : null };
  }
  function erroGeral_(m, campo, codigo, mensagem) {
    m.col.erro({ codigo: codigo, campo: campo, mensagem: mensagem });
  }
  /** Campos do cabeçalho que a negociação calcula com os do animal (o rendimento apurado vai para o peso vivo total). */
  var DERIVADOS_NEGOCIO = { peso: ['peso_total_kg', 'peso_vivo_total_kg'], peso_carcaca_kg: ['peso_carcaca_total_kg', 'peso_vivo_total_kg'], valor_individual: ['valor_animais', 'valor_bruto'] };
  /**
   * Campos do cabeçalho que já têm erro (o catálogo recusou) ou que a negociação só calcularia com um valor de animal já
   * recusado: nenhum deles leva um segundo erro da negociação (uma causa, um erro).
   */
  function recusadosNegocio_(m, itens) {
    var out = {};
    m.col.erros.forEach(function (e) { if (!e.animal_id && e.campo) out[e.campo] = true; });
    itens.forEach(function (it) { Object.keys(it.camposComErro || {}).forEach(function (c) { (DERIVADOS_NEGOCIO[c] || []).forEach(function (h) { out[h] = true; }); }); });
    return out;
  }
  /**
   * Item que cita um animal já cadastrado (sujeito do evento): o erro de campo do catálogo já aponta o animal (animal_id
   * e brinco), como as regras do sujeito que vêm depois (contrato da Api: detalhes por animal e campo).
   */
  function apontarExistente_(m, it) {
    var id = it.dados && it.dados.animal_id;
    if (it.publico || vazio_(id)) return;
    var e = existente_(m, id);
    if (!e) return;
    it.animal_id = id;
    it.publico = true;
    if (vazio_(it.brincoTexto)) it.brincoTexto = nulo_(e.brinco);
  }
  /** Erros de campo do catálogo, com o "quem" do item. */
  function camposDoItem_(m, it, definicoes, valores) {
    EventCatalog.validarCampos(definicoes, valores, { listas: m.listas, desativados: m.desativados }).forEach(function (d) { erroItem_(m, it, d.campo, d.codigo, d.mensagem); });
  }
  /** Na correção, o cadastro (pasto, propriedade, categoria) que o original já usava: desativado depois, ainda vale. */
  function usadoNoOriginal_(m, id) {
    return !!m.usadosOriginal && !vazio_(id) && m.usadosOriginal[id] === true;
  }
  function pastoAtivo_(m, it, campo, id, historico) {
    var p = m.f.pasto(id);
    if (!p) { erroItem_(m, it, campo, 'NAO_ENCONTRADO', 'o pasto informado não existe.'); return false; }
    // Registro anterior ao marco zero: o pasto pode ter sido desativado depois; basta existir.
    if (p.status !== 'ATIVO' && !historico && !usadoNoOriginal_(m, id)) { erroItem_(m, it, campo, 'PASTO_INATIVO', 'o pasto ' + p.nome + ' está desativado.'); return false; }
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
      aceitarListasDoOriginal_(m, original);
      if (vazio_(d.justificativa)) erroGeral_(m, 'justificativa', 'CAMPO_OBRIGATORIO', 'Diga por que o evento está sendo corrigido.');
      // Só a mudança (dados.mudanca): o evento corrigido é a entrada sem mudança do vigente com ela (Correcao.montar; CONTRATOS,
      // seção 50) — os campos que ela não cita ficam como estão no original.
      if (d.mudanca && typeof d.mudanca === 'object') d = correcaoPelaMudanca_(m, original, d);
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
    // Tipo sem animais (ESTOQUE: entrada e acerto de insumo): a lista de animais não se aplica.
    var semAnimais = EventCatalog.tipo(tipo).selecao_animais === 'NENHUM';
    if (semAnimais) {
      if (Array.isArray(animais) && animais.length) erroGeral_(m, 'animais', 'CAMPO_NAO_SE_APLICA', 'Este lançamento não leva animais.');
      animais = [];
    } else if (!Array.isArray(animais) || !animais.length) erroGeral_(m, 'animais', 'SEM_ANIMAIS', tipo === 'NASCIMENTO' ? 'Escolha a mãe (a vaca que pariu).' : 'Inclua ao menos um animal.');
    else if (animais.length > MAX_ANIMAIS) erroGeral_(m, 'animais', 'ANIMAIS_DEMAIS', 'Um lançamento aceita até ' + MAX_ANIMAIS + ' animais; divida em partes.');
    else if (tipo === 'NASCIMENTO' && animais.length > 1) { erroGeral_(m, 'animais', 'UMA_MATRIZ', 'Um parto é de uma vaca só: escolha só a mãe. Gêmeos vão como duas crias do mesmo parto.'); return { erros: m.col.erros }; }
    // Sem data válida ou sem lista de animais não há linha do tempo a conferir; os demais erros do cabeçalho seguem juntos com os dos animais.
    if (!Utils.dataValida(ev.event_date) || (!semAnimais && (!Array.isArray(animais) || !animais.length || animais.length > MAX_ANIMAIS))) return { erros: m.col.erros };
    // Data antes do marco zero num tipo sem registro histórico: a linha do tempo nem começou; só o erro da data.
    if (ev.event_date < m.D0 && ev.pre_marco_zero !== true) return { erros: m.col.erros };

    var plano = { EVENTOS: [], ANIMAIS: [], EVENTO_ANIMAIS: [], IDENTIFICACOES: [], PESAGENS: [], REPRODUCAO: [], BAIXAS: [], AJUSTES: [], SANIDADE: [], MOVIMENTOS_ESTOQUE: [], COMPRAS: [], VENDAS: [], FINANCEIRO: [], PARCELAS: [], RATEIOS: [], ALOCACOES_FINANCEIRAS: [], ANEXOS: [] };
    var ctxEv = { tipo: tipo, subtipo: subtipo, ev: ev, campos: campos, original: original, plano: plano, itens: [], criadosOriginal: {}, auditorias: [] };
    // O ponto único da correção: o que ela mantém do original (as cópias congeladas e os derivados; Correcao.congelado).
    ctxEv.correcao = Correcao.contexto(m.repo, original);
    m.dataEv = ev.event_date;
    if (original) {
      // A raça que o original deu a cada animal criado (os atributos da criação): a correção só a grava no cadastro quando a muda.
      ctxEv.racaOriginal = {};
      m.f.linhasDoEvento(original.event_id).forEach(function (l) { if (l.atributos_iniciais_json) { ctxEv.criadosOriginal[l.animal_id] = true; ctxEv.racaOriginal[l.animal_id] = nulo_(l.atributos_iniciais_json.raca); } });
    }
    if (semAnimais) {
      if (tipo === 'LANCAMENTO_FINANCEIRO') lancamentoAvulso_(m, ctxEv, d);
      else estoque_(m, ctxEv);
      if (original) {
        m.repo.por('FINANCEIRO', 'event_id', original.event_id).forEach(function (fin) {
          var a0 = FinancialService.avisoPeriodo(m.params, fin.data_competencia, 'A correção cancela um lançamento que');
          if (a0) avisoItem_(m, null, a0.codigo, a0.mensagem);
        });
      }
      return fechar_(m, ctxEv);
    }
    if (tipo === 'TRANSFERENCIA') cabecalhoTransferencia_(m, ctxEv);
    if (tipo === 'IDENTIFICACAO') cabecalhoIdentificacao_(m, ctxEv);
    if (tipo === 'MARCACAO') cabecalhoMarcacao_(m, ctxEv);
    if (tipo === 'COMPRA') cabecalhoCompra_(m, ctxEv, animais);
    if (tipo === 'VENDA') cabecalhoVenda_(m, ctxEv);
    if (tipo === 'PESAGEM') cabecalhoPesagem_(m, ctxEv, animais);
    if (tipo === 'SANIDADE') cabecalhoSanidade_(m, ctxEv);
    if (tipo === 'REPRODUCAO') cabecalhoReproducao_(m, ctxEv);
    if (tipo === 'DESMAMA') cabecalhoDesmama_(m, ctxEv);
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
      else if (tipo === 'PESAGEM') itemPesagem_(m, ctxEv, it);
      else if (tipo === 'SANIDADE') itemSanidade_(m, ctxEv, it);
      else if (tipo === 'REPRODUCAO') itemReproducao_(m, ctxEv, it);
      else if (tipo === 'DESMAMA') itemDesmama_(m, ctxEv, it);
      else if (tipo === 'CASTRACAO') itemCastracao_(m, ctxEv, it);
      else if (tipo === 'OCORRENCIA') itemOcorrencia_(m, ctxEv, it);
      else itemEntrada_(m, ctxEv, it);
    });
    if (tipo === 'NASCIMENTO') crias_(m, ctxEv, d.crias);
    if (tipo === 'REPRODUCAO') fecharReproducao_(m, ctxEv);
    if (tipo === 'DESMAMA') fecharDesmama_(m, ctxEv);
    conferirRepetidos_(m, ctxEv);
    conferirBrincos_(m, ctxEv);
    conferirPeriodosDeBrinco_(m, ctxEv);
    conferirGenealogia_(m, ctxEv);
    conferirCategoriasDoSexo_(m, ctxEv);
    conferirLinhaDoTempo_(m, ctxEv);
    conferirManejo_(m, ctxEv);
    if (original) conferirRemovidos_(m, ctxEv);
    conferirSequencias_(m, ctxEv, animaisConferidos_(m, ctxEv), ctxEv.ev.event_id);
    if (original) conferirEstadoRestaurado_(m, Object.keys(m.afetados).filter(function (id) { return !ctxEv.criadosOriginal[id]; }), 'a correção', ctxEv);
    // Sem o original, os números dos animais que ele tocava (mesmo sem linha de brinco no substituto) mudam de período.
    if (original) conferirPeriodosDeBrinco_(m, ctxEv, Object.keys(m.afetados), null);
    guardaDuplicidade_(m, ctxEv);
    conferirLotacao_(m, ctxEv);
    if (tipo === 'PESAGEM' || tipo === 'DESMAMA') avisosDaPesagem_(m, ctxEv);
    if (tipo === 'NASCIMENTO') avisosDoParto_(m, ctxEv);
    if (tipo === 'ENTRADA_INICIAL') abertura_(m, ctxEv);
    if (tipo === 'COMPRA') financeiroCompra_(m, ctxEv, d);
    if (tipo === 'VENDA') { carenciaNaVenda_(m, ctxEv); financeiroVenda_(m, ctxEv, d); }
    if (tipo === 'MORTE' || tipo === 'DESCARTE') financeiroSaida_(m, ctxEv);
    if (tipo === 'SANIDADE') consumoSanidade_(m, ctxEv);
    if (tipo === 'REPRODUCAO') despesaDoManejo_(m, ctxEv, ctxEv.itens.filter(function (it) { return it.femea && it.linhaEA; }));
    if (tipo === 'CASTRACAO' || tipo === 'OCORRENCIA') despesaDoManejo_(m, ctxEv, ctxEv.itens.filter(function (it) { return it.linhaEA; }));
    if (original) {
      produtosQueSaem_(m, ctxEv, original);
      m.repo.por('FINANCEIRO', 'event_id', original.event_id).forEach(function (fin) {
        var a = FinancialService.avisoPeriodo(m.params, fin.data_competencia, 'A correção cancela um lançamento que');
        if (a) avisoItem_(m, null, a.codigo, a.mensagem);
      });
    }
    return fechar_(m, ctxEv);
  }
  /**
   * O pedido de correção com só a mudança: a entrada sem mudança do vigente (Correcao.entrada, a mesma da prévia da correção)
   * com a mudança aplicada (Correcao.montar), mais o event_id, a justificativa e a justificativa do aviso do pedido.
   */
  function correcaoPelaMudanca_(m, original, d) {
    var L = { por: function (t, c, v) { return m.repo.por(t, c, v); }, porId: function (t, id) { return m.repo.porId(t, id); } };
    var base = Correcao.entrada(L, original);
    var out = Correcao.montar(base, d.mudanca);
    ['event_id', 'justificativa', 'justificativa_aviso'].forEach(function (k) { if (d[k] !== undefined) out[k] = d[k]; });
    return out;
  }
  /**
   * Na correção, o produto do original que sai do lançamento (a aplicação passada a outro produto ou ao nome livre, a entrada
   * de outro produto): o saldo dele muda sem o movimento do original — o estoque negativo pede confirmação e a contagem
   * posterior recusa (CONTAGEM_POSTERIOR), pelo motor, como no produto que entra (o tratador do tipo confere esse).
   */
  function produtosQueSaem_(m, ctxEv, original) {
    var noPlano = {};
    ctxEv.plano.MOVIMENTOS_ESTOQUE.forEach(function (x) { noPlano[x.product_id] = true; });
    var vistos = {};
    (m.repo.carregada('MOVIMENTOS_ESTOQUE') ? m.repo.por('MOVIMENTOS_ESTOQUE', 'event_id', original.event_id) : []).forEach(function (x) {
      if (noPlano[x.product_id] || vistos[x.product_id]) return;
      vistos[x.product_id] = true;
      var outro = m.repo.porId('PRODUTOS', x.product_id);
      var ab = movimentosAntesDepois_(m, ctxEv, x.product_id);
      avisoEstoque_(m, outro, ab.antes, ab.depois);
      contagemPosterior_(m, outro, ab.antes, ab.depois, ctxEv);
    });
  }
  /** Cabeçalho do evento: data, propriedade, textos; ENTRADA_INICIAL sempre no marco zero (RN-022). */
  function cabecalho_(m, tipo, subtipo, campos, original) {
    EventCatalog.validarCampos(EventCatalog.camposEvento(tipo, subtipo), campos, { listas: m.listas, desativados: m.desativados }).forEach(function (x) { erroGeral_(m, x.campo, x.codigo, x.mensagem); });
    var data = campos.event_date;
    if (tipo === 'ENTRADA_INICIAL') {
      if (!vazio_(data) && data !== m.D0) erroGeral_(m, 'event_date', 'FORA_DO_MARCO_ZERO', 'O rebanho inicial é sempre lançado na data do marco zero (' + br_(m.D0) + ').');
      data = m.D0;
    }
    var historico = false;
    if (Utils.dataValida(data)) {
      if (data > m.hoje) erroGeral_(m, 'event_date', 'DATA_FUTURA', 'A data ' + br_(data) + ' ainda não chegou.');
      var importado = HISTORICO_IMPORTADO.indexOf(tipo) >= 0 && (!!m.opcoes.importacao || (!!original && original.pre_marco_zero === true));
      if (data < m.D0 && (EventCatalog.tipo(tipo).aceita_historico === true || importado)) historico = true;
      else if (data < m.D0) erroGeral_(m, 'event_date', 'ANTES_DO_MARCO_ZERO', 'A data ' + br_(data) + ' é anterior ao marco zero (' + br_(m.D0) + '): o rebanho só é controlado a partir dele.');
    }
    // A propriedade vazia é a padrão das configurações; na correção, a que o original gravou (a padrão de hoje pode ser outra:
    // Correcao.congelado).
    var propCong = vazio_(campos.property_id) ? Correcao.congelado(Correcao.contexto(m.repo, original), 'EVENTO.propriedade', {}) : null;
    var prop = !vazio_(campos.property_id) ? campos.property_id : propCong ? propCong.v : m.params.propriedade_padrao_id;
    if (vazio_(prop)) erroGeral_(m, 'property_id', 'CAMPO_OBRIGATORIO', 'Escolha a propriedade (ou defina a propriedade padrão nas configurações).');
    else {
      var p = m.repo.porId('PROPRIEDADES', prop);
      if (!p) erroGeral_(m, 'property_id', 'NAO_ENCONTRADO', 'A propriedade informada não existe.');
      else if (p.status !== 'ATIVO' && !usadoNoOriginal_(m, prop)) erroGeral_(m, 'property_id', 'PROPRIEDADE_INATIVA', 'A propriedade ' + p.nome + ' está desativada.');
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
    var quem = !vazio_(rotulo) ? rotulo : !vazio_(codigo) ? 'Brinco ' + codigo : existente ? nomeNaData_(m, existente) : 'Animal ' + (i + 1) + ' da lista';
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
  /**
   * A raça é cadastro do animal (a ficha a corrige, com auditoria); o lançamento que o criou guarda a de origem nos atributos.
   * Na correção desse lançamento, a raça vai para o cadastro só quando a correção a muda em relação à que o original deu ao
   * animal — a correção sem mudança (ou de outro campo) não desfaz a raça corrigida na ficha (CONTRATOS, seção 54).
   */
  function racaMudou_(ctxEv, id, raca) {
    if (vazio_(raca)) return false;
    var orig = ctxEv.racaOriginal && Object.prototype.hasOwnProperty.call(ctxEv.racaOriginal, id) ? ctxEv.racaOriginal[id] : undefined;
    return orig === undefined || raca !== orig;
  }
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
      if (racaMudou_(ctxEv, it.animal_id, d.raca) && d.raca !== ex.raca) cad.raca = d.raca;
      if (Object.keys(cad).length) ctxEv.auditorias.push({ id: it.animal_id, campos: cad });
    } else {
      it.animal_id = m.tx.novoId();
      it.codigo_interno = 'A-' + pad_(m.repo.contador('ANIMAIS', 'codigo_interno', extrairCodigo_), 6);
      if (vazio_(it.brincoTexto)) it.quem = it.quem + ' (' + it.codigo_interno + ')';
      ctxEv.plano.ANIMAIS.push({ animal_id: it.animal_id, codigo_interno: it.codigo_interno, nome: nulo_(d.nome), raca: nulo_(d.raca) });
    }
    var at = atributos_(m, ctxEv, it);
    var hist = ctxEv.ev.pre_marco_zero === true;
    if (!vazio_(d.pasto_destino_id)) pastoAtivo_(m, it, 'pasto_destino_id', d.pasto_destino_id, hist);
    var pasto = nulo_(d.pasto_destino_id) || (compra ? nulo_(ctxEv.campos.pasto_destino_id) : null);
    // Compra anterior ao marco zero (importação): registro histórico, efeito 0 no inventário (04, seção 6).
    var ea = { efeito_inventario: hist ? 0 : 1, pasto_destino_id: pasto, atributos_iniciais_json: at, observacoes: nulo_(d.observacoes) };
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
      // A prenhez declarada é o diagnóstico de gestação do dia da entrada: a fêmea nascida nesse dia não pode
      // estar prenhe (RN-060; a trava confere o mesmo na genealogia, por todo caminho).
      if (Utils.dataValida(at.data_nascimento) && Utils.dataValida(ctxEv.ev.event_date) && at.data_nascimento === ctxEv.ev.event_date) {
        erroItem_(m, it, 'situacao_reprodutiva', 'PRENHA_SEM_IDADE', 'a fêmea nasceu em ' + br_(at.data_nascimento) + ' e não pode entrar prenhe em ' + br_(ctxEv.ev.event_date) + ': confira o nascimento ou a situação reprodutiva.');
      }
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
    apontarExistente_(m, it);
    camposDoItem_(m, it, defs, Object.keys(d).reduce(function (o, k) { if (aceitos.indexOf(k) >= 0) o[k] = d[k]; return o; }, {}));
    outros.forEach(function (k) { erroItem_(m, it, k, 'CAMPO_NAO_SE_APLICA', 'na volta de um animal já cadastrado não se informa "' + k + '": corrija o cadastro por "Corrigir dados do animal".'); });
    var e = existente_(m, d.animal_id);
    it.animal_id = d.animal_id;
    it.publico = true;
    if (!e) { erroItem_(m, it, 'animal_id', 'NAO_ENCONTRADO', 'animal não encontrado.'); return; }
    it.codigo_interno = e.codigo_interno;
    if (vazio_(it.brincoTexto)) it.quem = nomeAnimal_(e);
    // Compra histórica (antes do marco zero) de animal já cadastrado: registro informativo, validado só contra o
    // nascimento e a chegada declarada (04, seção 6); a situação de hoje não conta.
    var hist = ctxEv.ev.pre_marco_zero === true;
    // Na correção de uma volta, a situação de hoje sem o original não diz nada (a morte ou a venda posterior viram a
    // "última saída"): a linha do tempo final, com o substituto no lugar do original, decide (RN-045).
    var doOriginal = !!ctxEv.original && !!m.afetados[d.animal_id];
    if (e.situacao_cadastral === 'ATIVO' && !hist && !doOriginal) { erroItem_(m, it, 'animal_id', 'JA_NO_REBANHO', 'o animal já está no rebanho.'); return; }
    if (e.situacao_cadastral === 'MORTO' && !hist && !doOriginal) { erroItem_(m, it, 'animal_id', 'ANIMAL_MORTO', 'o animal morreu em ' + br_(e.data_saida) + ' e não pode voltar ao rebanho.'); return; }
    if (e.situacao_cadastral === 'EXTERNO') { erroItem_(m, it, 'animal_id', 'ANIMAL_EXTERNO', 'animal de referência (touro de sêmen, progenitor de outra fazenda) não entra no rebanho: ele é só um cadastro de referência. Se ele chegou à fazenda, lance a entrada como animal novo.'); return; }
    it.final = { sexo: e.sexo, data_nascimento: e.data_nascimento };
    if (!vazio_(d.pasto_destino_id)) pastoAtivo_(m, it, 'pasto_destino_id', d.pasto_destino_id, hist);
    var pasto = nulo_(d.pasto_destino_id) || (compra ? nulo_(ctxEv.campos.pasto_destino_id) : null);
    var ea = { efeito_inventario: hist ? 0 : 1, pasto_destino_id: pasto, observacoes: nulo_(d.observacoes) };
    if (compra) pesosDaCompra_(it, ea);
    linhaEA_(m, ctxEv, it, ea);
    // No registro histórico o brinco da casa não muda (o de hoje veio depois); só o brinco do vendedor entra.
    if (!hist && !vazio_(it.brincoTexto) && Utils.normalizarBrinco(it.brincoTexto) !== (e.brinco_norm || '')) identificacoes_(m, ctxEv, it);
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
    if (it.reusado) {
      // Correção do lançamento que criou o animal: o que vale depois é o conjunto final — os atributos do substituto com
      // as correções de cadastro que continuam valendo — e a chegada declarada sai dele (04, seção 6: os registros
      // anteriores ao marco zero são conferidos contra ela): no rebanho inicial, a data de chegada; na compra e na outra
      // entrada, a data do próprio substituto.
      it.final.sexo = corrigidoDepois_(m, it.animal_id, 'sexo', it.final.sexo);
      it.final.data_nascimento = corrigidoDepois_(m, it.animal_id, 'data_nascimento', it.final.data_nascimento);
      it.final.data_entrada = ctxEv.tipo === 'ENTRADA_INICIAL' ? corrigidoDepois_(m, it.animal_id, 'data_entrada', it.final.data_entrada) : data;
      it.final.mudouEntrada = true;
      // A chegada e o nascimento do conjunto final (RN-021, RN-045): a correção de cadastro que continua valendo entra na
      // conta, não só o que o substituto traz (o que ele mesmo traz já foi conferido acima).
      var fn = it.final.data_nascimento;
      var fe = it.final.data_entrada;
      var corrigido = function (campo) { return corrigidoDepois_(m, it.animal_id, campo, undefined) !== undefined; };
      var nota = function (campo) { return corrigido(campo) ? ', de uma correção de cadastro que continua valendo' : ''; };
      if (ctxEv.tipo === 'ENTRADA_INICIAL') {
        var jaVisto = !!nasc && !vazio_(d.data_entrada) && d.data_entrada < nasc;
        if (!jaVisto && Utils.dataValida(fn) && Utils.dataValida(fe) && fe < fn) {
          erroItem_(m, it, 'data_nascimento', 'ENTRADA_ANTES_DO_NASCIMENTO', 'a chegada na fazenda (' + br_(fe) + nota('data_entrada') + ') ficaria antes do nascimento (' + br_(fn) + nota('data_nascimento') + '). Confira as datas do animal.');
        }
      } else if (Utils.dataValida(fn) && Utils.dataValida(data) && fn > data && !(nasc && nasc > data)) {
        erroItem_(m, it, 'event_date', 'NASCIMENTO_DEPOIS_DA_ENTRADA', 'o nascimento (' + br_(fn) + nota('data_nascimento') + ') ficaria depois da data do lançamento (' + br_(data) + '). Confira a data ou o nascimento do animal.');
      }
    }
    return at;
  }
  /** Valor de um campo do cadastro com a correção de cadastro vigente mais recente (na ordem da projeção), ou `padrao`. */
  function corrigidoDepois_(m, id, campo, padrao) {
    var ultima = m.f.ajustes(id).filter(function (a) { return a.tipo_ajuste === 'CORRECAO_CADASTRO' && a.campo === campo; })
      .map(function (a) { var ev = m.f.evento(a.event_id); return { a: a, ord: ev ? m.f.ordemSeq(a.event_id) : 0, seq: ev ? ev.event_seq : 0 }; })
      .sort(function (x, y) { return x.ord - y.ord || x.seq - y.seq; }).pop();
    if (!ultima) return padrao;
    return vazio_(ultima.a.valor_novo) ? null : ultima.a.valor_novo;
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
    it.quem = nomeNaData_(m, e);
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
      else if (p.status !== 'ATIVO' && ctxEv.ev.pre_marco_zero !== true && !usadoNoOriginal_(m, p.pasture_id)) { erroGeral_(m, 'pasto_destino_id', 'PASTO_INATIVO', 'O pasto ' + p.nome + ' está desativado e não recebe animais.'); ok = false; }
    }
    if (ok && c.pasto_origem_id === c.pasto_destino_id) { erroGeral_(m, 'pasto_destino_id', 'DESTINO_IGUAL_ORIGEM', 'O pasto de destino precisa ser diferente do pasto de origem.'); ok = false; }
    ctxEv.transf = ok ? { pasto_origem_id: c.pasto_origem_id, pasto_destino_id: c.pasto_destino_id } : null;
  }
  /**
   * TRANSFERENCIA (04, seção 4.4): uma linha de movimento por animal, origem e destino do cabeçalho. A origem é
   * conferida pela linha do tempo na data (ORIGEM_DIVERGENTE por animal, RN-018); tudo ou nada (RN-028).
   */
  function itemTransferencia_(m, ctxEv, it) {
    apontarExistente_(m, it);
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
    apontarExistente_(m, it);
    camposDoItem_(m, it, EventCatalog.camposAnimal(ctxEv.tipo), semAnimalId_(d));
    if (!sujeito_(m, it, ctxEv.tipo === 'MORTE' ? 'registra como morto' : 'descarta')) return;
    // Morte anterior ao marco zero (importação): registro histórico, sem efeito no inventário nem pasto de origem.
    var hist = ev.pre_marco_zero === true;
    var onde = hist ? { presente: false } : Timeline.pastoAntesDaSaida(m.f.linhas(it.animal_id), ev.event_date, m.D0);
    it.origemDerivada = true;
    linhaEA_(m, ctxEv, it, { efeito_inventario: hist ? 0 : -1, pasto_origem_id: onde.presente ? nulo_(onde.pasture_id) : null, observacoes: nulo_(d.observacoes) });
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
    apontarExistente_(m, it);
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
    apontarExistente_(m, it);
    camposDoItem_(m, it, EventCatalog.camposAnimal('MARCACAO', ctxEv.subtipo), d);
    if (vazio_(d.animal_id)) return;
    if (!sujeito_(m, it, 'marca')) return;
    linhaEA_(m, ctxEv, it, { efeito_inventario: 0, observacoes: typeof d.observacoes === 'string' ? nulo_(Utils.aparar(d.observacoes)) : null });
  }

  // ------------------------------------------------------------------ pesagem ----
  /**
   * Cabeçalho da PESAGEM (04, seção 4.5; 03b, seções 2.6, 5 e 16.11): o momento da pesagem (PESAGENS.tipo), o método e,
   * na pesagem por lote, o fato do lote — o peso total na balança e as cabeças, que precisam bater com os animais da lista
   * (RN-029). Cada animal do lote fica com a média, arredondada a uma casa, e o método MEDIA_LOTE (estimada); a soma das
   * linhas pode diferir do total em décimos. O jejum vale para o lançamento inteiro (payload).
   */
  function cabecalhoPesagem_(m, ctxEv, animais) {
    var c = ctxEv.campos;
    var porLote = !vazio_(c.peso_total_lote_kg);
    var p = { tipo: EventCatalog.MOMENTOS_PESAGEM.indexOf(c.tipo_pesagem) >= 0 ? c.tipo_pesagem : null, metodo: porLote ? 'MEDIA_LOTE' : nulo_(c.metodo_pesagem), jejum: c.jejum === true, porLote: porLote, lote: null };
    var numero = function (v) { return typeof v === 'number' && isFinite(v); };
    if (porLote && numero(c.peso_total_lote_kg) && numero(c.qtd_cabecas_lote) && Math.floor(c.qtd_cabecas_lote) === c.qtd_cabecas_lote && c.peso_total_lote_kg > 0) {
      var n = animais.length;
      if (c.qtd_cabecas_lote !== n) {
        erroGeral_(m, 'qtd_cabecas_lote', 'QTD_DIVERGENTE', 'A lista tem ' + n + (n === 1 ? ' animal' : ' animais') + ', mas "Cabeças na balança" diz ' + c.qtd_cabecas_lote + '. Os dois precisam bater.');
      } else {
        var media = Utils.arredondar(c.peso_total_lote_kg / n, 1);
        if (media < 0.1 || media > EventCatalog.PESO_MAX_KG) erroGeral_(m, 'peso_total_lote_kg', 'VALOR_FORA_DA_FAIXA', 'A média do lote fica em ' + Utils.formatarNumero(media, 1) + ' kg por cabeça, fora da faixa de peso vivo (de 0,1 a ' + Utils.formatarNumero(EventCatalog.PESO_MAX_KG) + ' kg).');
        else p.lote = { total_kg: c.peso_total_lote_kg, cabecas: n, media_kg: media };
      }
    }
    ctxEv.pesagem = p;
  }
  /**
   * PESAGEM, um animal (04, seções 4.5 e 5.1; 05, seção 2.7): fato independente — o animal precisa estar no rebanho na
   * data (o dia da saída conta). Uma linha de EVENTO_ANIMAIS (efeito 0, com o peso copiado) e uma de PESAGENS, que nunca
   * substitui nem altera a anterior (RN-051). Individual: o peso de cada animal, de 0,1 a 2.000 kg (RN-049); por lote: o
   * peso de cada um fica vazio e ele recebe a média do lote.
   */
  function itemPesagem_(m, ctxEv, it) {
    var d = it.dados;
    var p = ctxEv.pesagem;
    apontarExistente_(m, it);
    camposDoItem_(m, it, EventCatalog.camposAnimal('PESAGEM'), d);
    if (vazio_(d.animal_id)) return;
    if (!sujeito_(m, it, 'pesa')) return;
    var temPeso = !vazio_(d.peso);
    if (p.porLote && temPeso) { erroItem_(m, it, 'peso', 'CAMPO_NAO_SE_APLICA', 'na pesagem por lote o peso de cada animal fica vazio: cada um recebe a média do lote.'); return; }
    if (!p.porLote && !temPeso) erroItem_(m, it, 'peso', 'CAMPO_OBRIGATORIO', 'informe o peso.');
    var kg = p.porLote ? (p.lote ? p.lote.media_kg : null) : (it.camposComErro && it.camposComErro.peso ? null : d.peso);
    var obs = typeof d.observacoes === 'string' ? nulo_(Utils.aparar(d.observacoes)) : null;
    linhaEA_(m, ctxEv, it, { efeito_inventario: 0, peso: typeof kg === 'number' ? kg : null, observacoes: obs });
    if (typeof kg !== 'number' || !p.tipo || !p.metodo) return;
    it.pesoKg = kg;
    ctxEv.plano.PESAGENS.push({ weight_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ctxEv.ev.event_id, data_pesagem: ctxEv.ev.event_date, peso_kg: kg, metodo: p.metodo, tipo: p.tipo, observacoes: obs });
  }
  /**
   * Avisos da pesagem (RN-050; 04, seção 4.5): a variação por dia contra a pesagem anterior do animal (e contra a seguinte,
   * no retroativo) fora de `gmd_plausivel_min_kg_dia` a `gmd_plausivel_max_kg_dia` pede confirmação (PESO_IMPLAUSIVEL: a
   * digitação que perdeu um dígito); o animal já pesado no mesmo dia, por outro lançamento, também (POSSIVEL_DUPLICIDADE,
   * quando a guarda do lançamento inteiro não o pegou). Um aviso por animal, com o animal. As contas são as do servidor
   * (WeightService.variacao); nada bloqueia.
   */
  function avisosDaPesagem_(m, ctxEv) {
    var data = ctxEv.ev.event_date;
    var minimo = m.params.gmd_plausivel_min_kg_dia;
    var maximo = m.params.gmd_plausivel_max_kg_dia;
    var jaDuplicado = m.avisos.some(function (a) { return a.codigo === 'POSSIVEL_DUPLICIDADE'; });
    var faixa = 'de ' + Utils.formatarNumero(typeof minimo === 'number' ? minimo : -1, 1) + ' a ' + Utils.formatarNumero(typeof maximo === 'number' ? maximo : 2, 1) + ' kg por dia';
    ctxEv.itens.forEach(function (it) {
      if (typeof it.pesoKg !== 'number' || (ctxEv.repetidos && ctxEv.repetidos[it.animal_id])) return;
      var viz = WeightService.vizinhas(m.f, it.animal_id, data);
      if (viz.mesmoDia.length && !jaDuplicado) {
        var x = viz.mesmoDia[viz.mesmoDia.length - 1];
        avisoItem_(m, it, 'POSSIVEL_DUPLICIDADE', it.quem + ' já tem pesagem em ' + br_(data) + ' (' + Utils.formatarNumero(x.peso_kg, 1) + ' kg, ' + WeightService.origemDaPesagem(m.f, x) + '). Gravar mesmo assim?',
          conflitoCom_(x.event_id, x.event_type, x.event_subtype, data));
      }
      [['anterior', viz.anterior], ['seguinte', viz.seguinte]].forEach(function (par) {
        var v = par[1];
        if (!v) return;
        var r = WeightService.variacao(par[0] === 'anterior' ? v : { data: data, peso_kg: it.pesoKg }, par[0] === 'anterior' ? { data: data, peso_kg: it.pesoKg } : v);
        if (r.gmd_kg_dia === null || !WeightService.implausivel(r.gmd_kg_dia, m.params)) return;
        var contra = par[0] === 'anterior' ? 'contra ' + Utils.formatarNumero(v.peso_kg, 1) + ' kg em ' + br_(v.data) : 'contra a pesagem seguinte, ' + Utils.formatarNumero(v.peso_kg, 1) + ' kg em ' + br_(v.data);
        avisoItem_(m, it, 'PESO_IMPLAUSIVEL', it.quem + ': ' + Utils.formatarNumero(it.pesoKg, 1) + ' kg em ' + br_(data) + ' ' + contra + ' (' + r.dias + (r.dias === 1 ? ' dia' : ' dias') + ') dá ' +
          Utils.formatarNumero(r.gmd_kg_dia, 2) + ' kg por dia, fora da faixa esperada (' + faixa + '). Confira a digitação.', conflitoCom_(v.event_id, v.event_type, v.event_subtype, v.data));
      });
    });
  }

  // ------------------------------------------------------------------ sanidade ----
  /** Produto do cadastro citado pelo lançamento: existe; desativado só quando o original já o usava (correção). */
  function produtoDoCampo_(m, campo, id) {
    if (vazio_(id)) return null;
    var p = m.repo.porId('PRODUTOS', id);
    if (!p) { erroGeral_(m, campo, 'NAO_ENCONTRADO', 'O produto escolhido não está no cadastro. Atualize a tela e escolha de novo.'); return null; }
    if (p.ativo === false && !usadoNoOriginal_(m, id)) { erroGeral_(m, campo, 'PRODUTO_INATIVO', 'O produto ' + p.nome + ' está desativado. Reative-o no cadastro de produtos ou escolha outro.'); return null; }
    return p;
  }
  /**
   * Cabeçalho da SANIDADE (03b, seções 2.6, 6 e 15.2; 05, RN-055 a RN-057): o procedimento é o do subtipo; o produto vem do
   * cadastro (o nome é a cópia congelada do cadastro, o fabricante também quando vazio) ou do texto livre; o protocolo cumprido
   * é do mesmo procedimento e está ativo; o modo da dose decide a dose de cada animal e a quantidade consumida (o fato que
   * gera o movimento de saída e o custo; vazia = a soma das doses); a carência dá o último dia (`data_aplicacao` +
   * dias) e a próxima aplicação vem do protocolo a cada N dias quando não é informada. Nada aqui prescreve: o sistema
   * registra o que foi decidido.
   */
  function cabecalhoSanidade_(m, ctxEv) {
    var sub = ctxEv.subtipo;
    // Só os campos do subtipo valem (o registro de doença não tem produto): o campo de fora já foi recusado pelo catálogo.
    var doSubtipo = {};
    EventCatalog.camposEvento('SANIDADE', sub).forEach(function (d) { doSubtipo[d.id] = true; });
    var c = {};
    Object.keys(ctxEv.campos).forEach(function (k) { if (doSubtipo[k]) c[k] = ctxEv.campos[k]; });
    var data = ctxEv.ev.event_date;
    var s = {
      procedimento: HealthService.PROCEDIMENTO[sub] || null, produto: null, protocolo: null, nome: null, fabricante: null, unidade: null,
      modo: null, doseRef: null, quantidadeInformada: null, quantidade: null, carenciaDias: null, fimCarencia: null, proxima: null, ok: true,
    };
    ctxEv.sanidade = s;
    var produto = produtoDoCampo_(m, 'produto_id', c.produto_id);
    if (!vazio_(c.produto_id) && !produto) s.ok = false;
    s.produto = produto;
    // Na correção com o mesmo produto, as cópias do cadastro feitas no lançamento (o nome, o fabricante e a carência
    // proposta) são as do original, não as do cadastro de hoje (03b, SANIDADE.nome_produto e periodo_carencia_dias: cópias
    // congeladas; o ponto único Correcao.congelado, CONTRATOS, seção 50).
    var cc = ctxEv.correcao;
    var doProduto = produto ? { produto_id: produto.product_id } : null;
    var nomeCong = doProduto ? Correcao.congelado(cc, 'SANIDADE.nome_produto', doProduto) : null;
    var nomeLivre = typeof c.nome_produto === 'string' ? nulo_(Utils.aparar(c.nome_produto)) : null;
    if (produto && nomeLivre && Utils.normalizarTexto(nomeLivre) !== Utils.normalizarTexto(produto.nome) && !(nomeCong && Utils.normalizarTexto(nomeLivre) === Utils.normalizarTexto(nomeCong.v))) {
      erroGeral_(m, 'nome_produto', 'CAMPO_NAO_SE_APLICA', 'Com o produto do cadastro, o nome vem do cadastro (' + produto.nome + '): deixe o nome em branco ou escolha outro produto.');
      s.ok = false;
    }
    s.nome = produto ? (nomeCong ? nomeCong.v : produto.nome) : nomeLivre;
    var fabCong = doProduto ? Correcao.congelado(cc, 'SANIDADE.fabricante', doProduto) : null;
    s.fabricanteInformado = typeof c.fabricante === 'string' && !!nulo_(Utils.aparar(c.fabricante));
    s.fabricante = s.fabricanteInformado ? Utils.aparar(c.fabricante) : fabCong ? fabCong.v : produto ? nulo_(produto.fabricante) : null;
    if (HealthService.COM_PRODUTO_OBRIGATORIO.indexOf(sub) >= 0 && !s.nome && vazio_(c.produto_id)) {
      erroGeral_(m, 'produto_id', 'CAMPO_OBRIGATORIO', 'Escolha o produto do cadastro ou digite o nome do produto aplicado.');
      s.ok = false;
    }
    if (!vazio_(c.protocol_id)) {
      var p = m.repo.porId('PROTOCOLOS_SANITARIOS', c.protocol_id);
      if (!p) { erroGeral_(m, 'protocol_id', 'NAO_ENCONTRADO', 'O protocolo escolhido não existe. Atualize a tela e escolha de novo.'); s.ok = false; }
      else if (p.ativo === false && !usadoNoOriginal_(m, p.protocol_id)) { erroGeral_(m, 'protocol_id', 'PROTOCOLO_INATIVO', 'O protocolo ' + p.nome + ' está desativado. Reative-o no cadastro de protocolos ou deixe o campo em branco.'); s.ok = false; }
      else if (p.tipo_procedimento !== s.procedimento && !Correcao.congelado(cc, 'SANIDADE.procedimento_protocolo', { protocol_id: p.protocol_id, procedimento: s.procedimento })) { erroGeral_(m, 'protocol_id', 'PROTOCOLO_DE_OUTRO_PROCEDIMENTO', 'O protocolo ' + p.nome + ' é cumprido por ' + rotuloProcedimento_(p.tipo_procedimento) + ', não por ' + rotuloProcedimento_(s.procedimento) + '.'); s.ok = false; }
      else s.protocolo = p;
    }
    var temProduto = !!s.nome || !vazio_(c.produto_id);
    // Modo da dose (03b, seção 2.6: obrigatório quando há produto).
    s.modo = HealthService.MODOS_DOSE.indexOf(c.modo_dose) >= 0 ? c.modo_dose : null;
    if (temProduto && vazio_(c.modo_dose)) { erroGeral_(m, 'modo_dose', 'CAMPO_OBRIGATORIO', 'Diga como foi a dose: por cabeça, por peso ou só o total que saiu do frasco.'); s.ok = false; }
    if (!temProduto && !vazio_(c.modo_dose)) { erroGeral_(m, 'modo_dose', 'CAMPO_NAO_SE_APLICA', 'Sem produto não há dose: escolha o produto ou deixe a dose em branco.'); s.ok = false; s.modo = null; }
    s.doseRef = typeof c.dose_referencia === 'number' ? c.dose_referencia : null;
    // Unidade: a do cadastro (dose, estoque e custo na mesma língua); no texto livre, a informada.
    var unidadeLivre = typeof c.unidade_dose === 'string' ? nulo_(Utils.aparar(c.unidade_dose)) : null;
    if (produto) {
      s.unidade = produto.unidade;
      if (unidadeLivre && unidadeLivre !== produto.unidade) { erroGeral_(m, 'unidade_dose', 'UNIDADE_DIFERENTE', 'O produto ' + produto.nome + ' é controlado em "' + produto.unidade + '": informe a dose nessa unidade e deixe a unidade em branco.'); s.ok = false; }
    } else s.unidade = unidadeLivre;
    s.quantidadeInformada = typeof c.quantidade_consumida_total === 'number' ? c.quantidade_consumida_total : null;
    if (!vazio_(c.quantidade_consumida_total) && !produto && vazio_(c.produto_id)) { erroGeral_(m, 'quantidade_consumida_total', 'CAMPO_NAO_SE_APLICA', 'A quantidade que saiu do frasco só se informa com produto do cadastro (é ela que baixa o estoque e vira custo).'); s.ok = false; }
    // Carência e próxima aplicação. Sem os dias informados, a carência padrão do produto do cadastro (05, seção 4.8: "usa os
    // dias informados no produto ou na aplicação"; 03b, SANIDADE.periodo_carencia_dias: proposta por
    // PRODUTOS.carencia_padrao_dias): a mesma regra no formulário, na API e na importação (o 0 informado é "sem carência").
    // Na correção com o mesmo produto, o vazio é a carência gravada no original (que pode ser nenhuma), não a padrão de hoje.
    var carCong = doProduto && doSubtipo.periodo_carencia_dias && vazio_(c.periodo_carencia_dias) ? Correcao.congelado(cc, 'SANIDADE.periodo_carencia_dias', doProduto) : null;
    // A marca do digitado (CONTRATOS, seção 54): com o produto do cadastro, o payload diz se a carência foi digitada ou copiada.
    s.carenciaInformada = produto && doSubtipo.periodo_carencia_dias ? typeof c.periodo_carencia_dias === 'number' : null;
    s.carenciaDias = typeof c.periodo_carencia_dias === 'number' ? c.periodo_carencia_dias
      : !doSubtipo.periodo_carencia_dias || !vazio_(c.periodo_carencia_dias) ? null
      : carCong ? carCong.v
      : produto && typeof produto.carencia_padrao_dias === 'number' ? produto.carencia_padrao_dias : null;
    s.fimCarencia = HealthService.fimPeloPeriodo(data, s.carenciaDias);
    if (!vazio_(c.data_proxima_aplicacao)) {
      if (Utils.dataValida(c.data_proxima_aplicacao) && Utils.dataValida(data) && c.data_proxima_aplicacao <= data) { erroGeral_(m, 'data_proxima_aplicacao', 'DATA_INVALIDA', 'A próxima aplicação precisa ser depois de ' + br_(data) + '.'); s.ok = false; }
      s.proxima = c.data_proxima_aplicacao;
    }
    // A recorrência e o intervalo do protocolo que propõem a próxima são os de quando a aplicação foi lançada (payload
    // `recorrencia_protocolo` e `intervalo_protocolo_dias`): a correção com o mesmo protocolo não a refaz pelo cadastro de hoje
    // (Correcao.congelado). A próxima digitada vale como foi digitada.
    if (s.protocolo) {
      var rec = Correcao.congelado(cc, 'SANIDADE.recorrencia_protocolo', { protocol_id: s.protocolo.protocol_id });
      s.recorrenciaProtocolo = rec ? rec.v.recorrencia : s.protocolo.recorrencia_tipo;
      var intervalo = rec && typeof rec.v.intervalo === 'number' ? rec.v.intervalo : typeof s.protocolo.intervalo_dias === 'number' ? s.protocolo.intervalo_dias : null;
      // O intervalo do protocolo fica congelado no payload também quando a próxima é digitada (com a marca
      // `proxima_informada`): a correção seguinte que volta à proposta usa o do original, não o de hoje (CONTRATOS, seção 54).
      if (s.recorrenciaProtocolo === 'INTERVALO_DIAS' && intervalo !== null) {
        s.intervaloProtocolo = intervalo;
        s.proximaInformada = !vazio_(c.data_proxima_aplicacao);
        if (!s.proximaInformada && Utils.dataValida(data)) s.proxima = Utils.somaDias(data, intervalo);
      }
    }
    // Lote vencido (RN-056): aviso, não bloqueio.
    if (!vazio_(c.validade) && Utils.dataValida(c.validade) && Utils.dataValida(data) && c.validade < data) {
      avisoItem_(m, null, 'PRODUTO_VENCIDO', 'O lote ' + (vazio_(c.lote) ? '' : c.lote + ' ') + 'de ' + (s.nome || 'produto') + ' venceu em ' + br_(c.validade) + ', antes da aplicação (' + br_(data) + '). Gravar mesmo assim?');
    }
  }
  /** As contas em que o consumo de insumo cai (07, seção 1.3): o produto do cadastro com custo nunca é comprado nelas. */
  function contasDeConsumo_() {
    var out = {};
    Object.keys(HealthService.CONTA_DA_CATEGORIA).forEach(function (k) { out[HealthService.CONTA_DA_CATEGORIA[k]] = true; });
    out.TRATAMENTOS = true;
    return out;
  }
  function rotuloProcedimento_(p) {
    return { VACINA: 'vacina', VERMIFUGO: 'vermífugo', MEDICAMENTO: 'medicamento', TRATAMENTO: 'tratamento', EXAME: 'exame', DOENCA: 'registro de doença' }[p] || 'outro procedimento';
  }
  /**
   * SANIDADE, um animal (03b, seção 6; 04, seção 4.5): fato independente — o animal precisa estar no rebanho na data (o dia da
   * saída conta). Uma linha de EVENTO_ANIMAIS (efeito 0) e uma de SANIDADE. A dose: a do animal, quando informada; senão,
   * por cabeça, a do lançamento; por peso, a dose por kg × o peso atual do animal na data (a regra do peso vigente:
   * pesagem dentro da validade, senão o peso de referência da categoria, marcado como estimado; sem peso nenhum, a dose
   * precisa ser informada); no modo total, sem dose por animal.
   */
  function itemSanidade_(m, ctxEv, it) {
    var d = it.dados;
    var s = ctxEv.sanidade;
    var c = ctxEv.campos;
    apontarExistente_(m, it);
    camposDoItem_(m, it, EventCatalog.camposAnimal('SANIDADE', ctxEv.subtipo), d);
    if (vazio_(d.animal_id)) return;
    if (!sujeito_(m, it, 'trata')) return;
    var obs = typeof d.observacoes === 'string' ? nulo_(Utils.aparar(d.observacoes)) : null;
    linhaEA_(m, ctxEv, it, { efeito_inventario: 0, observacoes: obs });
    var dose = it.camposComErro && it.camposComErro.dose ? null : typeof d.dose === 'number' ? d.dose : null;
    // Por peso, a dose digitada de um animal é fato informado (03b, SANIDADE.dose): o payload guarda de quem ela foi digitada
    // (`doses_informadas`), para a correção levá-la como foi gravada e só refazer pelo peso a que foi proposta (CONTRATOS, 50.2).
    it.doseInformada = s.modo === 'POR_PESO' && dose !== null;
    it.peso = null;
    if (s.modo === 'TOTAL' && !vazio_(d.dose)) { erroItem_(m, it, 'dose', 'CAMPO_NAO_SE_APLICA', 'no modo "total" a dose de cada animal fica vazia: vale a quantidade que saiu do frasco.'); dose = null; }
    else if (s.modo === 'POR_CABECA' && dose === null) {
      if (s.doseRef === null) erroItem_(m, it, 'dose', 'CAMPO_OBRIGATORIO', 'informe a dose (a do lançamento ou a deste animal).');
      else dose = s.doseRef;
    } else if (s.modo === 'POR_PESO' && dose === null) {
      // Na correção, com o mesmo produto, o mesmo modo, a mesma dose por kg e a mesma data, a dose gravada do animal no
      // original (03b, SANIDADE.dose: imutável; o operador confirmou a dose proposta pelo peso daquele dia), não a do peso de
      // hoje (a pesagem lançada depois, o peso de referência ou a validade do peso mudados): Correcao.congelado.
      var gravada = s.doseRef === null ? null : Correcao.congelado(ctxEv.correcao, 'SANIDADE.dose_por_peso', { produto_id: s.produto ? s.produto.product_id : null, nome_produto: s.nome, dose_referencia: s.doseRef, data: ctxEv.ev.event_date, animal_id: it.animal_id });
      if (s.doseRef === null) erroItem_(m, it, 'dose', 'CAMPO_OBRIGATORIO', 'informe a dose por kg (no lançamento) ou a dose deste animal.');
      else if (gravada) { dose = gravada.v; it.doseDoOriginal = true; }
      else {
        var L = m.leitorSanidade || (m.leitorSanidade = AnimalService.leitor(m.tx, { fonte: m.f, parametros: m.params }));
        var a = estado_(m, it.animal_id);
        var pv = AnimalService.pesoVigente(L, a, ctxEv.ev.event_date, AnimalService.categoriaEm(L, a, ctxEv.ev.event_date));
        it.peso = pv;
        if (typeof pv.kg !== 'number') erroItem_(m, it, 'dose', 'SEM_PESO', 'não há peso para calcular a dose por kg (nenhuma pesagem nem peso de referência da categoria): informe a dose deste animal ou pese antes.');
        else dose = Utils.arredondar(s.doseRef * pv.kg, 4);
      }
    } else if (!s.modo && !vazio_(d.dose) && s.ok) { erroItem_(m, it, 'dose', 'CAMPO_NAO_SE_APLICA', 'sem produto não há dose.'); dose = null; }
    if (dose !== null && !s.unidade && s.ok) erroItem_(m, it, 'dose', 'CAMPO_OBRIGATORIO', 'informe a unidade da dose (mL, dose, g) no lançamento.');
    it.dose = dose;
    var r = {
      health_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ctxEv.ev.event_id, tipo_procedimento: s.procedimento,
      protocol_id: s.protocolo ? s.protocolo.protocol_id : null, produto_id: s.produto ? s.produto.product_id : null, nome_produto: s.nome,
      fabricante: s.fabricante, lote: typeof c.lote === 'string' ? nulo_(Utils.aparar(c.lote)) : null, validade: nulo_(c.validade), dose: dose,
      unidade_dose: dose === null ? null : s.unidade, via_aplicacao: nulo_(c.via_aplicacao), motivo: typeof c.motivo === 'string' ? nulo_(Utils.aparar(c.motivo)) : null,
      diagnostico: typeof c.diagnostico === 'string' ? nulo_(Utils.aparar(c.diagnostico)) : null,
      resultado_exame: typeof d.resultado_exame === 'string' ? nulo_(Utils.aparar(d.resultado_exame)) : null,
      data_aplicacao: ctxEv.ev.event_date, data_proxima_aplicacao: s.proxima, periodo_carencia_dias: s.carenciaDias, data_fim_carencia: s.fimCarencia,
      custo: null, veterinario: typeof c.veterinario === 'string' ? nulo_(Utils.aparar(c.veterinario)) : null, observacoes: obs,
    };
    it.sanidade = r;
    ctxEv.plano.SANIDADE.push(r);
  }
  /** Movimentos do produto antes do comando (os vigentes) e depois (sem os do original da correção, com os do plano). */
  function movimentosAntesDepois_(m, ctxEv, productId) {
    var antes = HealthService.movimentosDoProduto(m.repo, productId, null);
    var depois = HealthService.movimentosDoProduto(m.repo, productId, m.f.excluidos).concat(ctxEv ? ctxEv.plano.MOVIMENTOS_ESTOQUE.filter(function (x) { return x.product_id === productId; }) : []);
    return { antes: antes, depois: depois };
  }
  /**
   * Estoque negativo (RN-057): o comando que deixa o saldo de um produto com o estoque controlado abaixo de zero em alguma
   * data, mais baixo que antes, pede confirmação (ESTOQUE_INSUFICIENTE; a política por código pode fazê-lo bloquear).
   */
  function avisoEstoque_(m, produto, antes, depois) {
    if (!produto || produto.controla_estoque !== true) return;
    var a = HealthService.menorSaldo(antes);
    var dp = HealthService.menorSaldo(depois);
    if (!(dp.saldo < 0) || !(dp.saldo < a.saldo)) return;
    // A compra lançada antes de ligar o controle não tem movimento (desenho-base 16.9): o caminho é o acerto pela contagem,
    // não lançar de novo a entrada já paga.
    var conselho = HealthService.compraSemMovimento(m.repo, produto.product_id)
      ? 'Há compra deste produto lançada antes de ligar o controle de estoque, que o saldo não conta: acerte o estoque pela contagem (Produtos, "Acertar") em vez de lançar a entrada de novo.'
      : 'Confira a quantidade ou lance antes a entrada do produto.';
    avisoItem_(m, null, 'ESTOQUE_INSUFICIENTE', produto.nome + ': o estoque ficaria em ' + HealthService.quantidadeTexto(dp.saldo, produto.unidade) + ' em ' + br_(dp.data) +
      ' (o saldo não cobre o que sai). ' + conselho + ' Gravar mesmo assim?');
  }
  /**
   * A ordem de um movimento no dia (desenho-base 16.1): a posição do evento na cadeia de substituição e o event_seq; o evento
   * do comando (ctxEv) na posição dele (o substituto na do original). null para evento desconhecido.
   */
  function ordemDoMovimento_(m, ctxEv) {
    return function (eventId) {
      if (ctxEv && eventId === ctxEv.ev.event_id) return { ordem_seq: ctxEv.ev.ordem_seq, event_seq: ctxEv.ev.event_seq };
      var ev = m.f.evento(eventId);
      return ev ? { ordem_seq: m.f.ordemSeq(eventId), event_seq: ev.event_seq } : null;
    };
  }
  /**
   * Contagem vigente do produto depois da data do movimento (03a, MOVIMENTOS_ESTOQUE, AJUSTE: o acerto corrige o saldo pela
   * contagem; desenho-base 4.3: "na data D" é o fim do dia D). O acerto gravou a diferença para o saldo daquele dia: o
   * comando que muda o saldo do fim do dia contado (o movimento retroativo, a correção que muda a quantidade, o estorno, a
   * contagem anterior a ela) desfaria em silêncio o que foi contado. Recusado (CONFLICT CONTAGEM_POSTERIOR, com a contagem
   * que impede): estornar a contagem, gravar o lançamento e contar de novo. As contagens anuladas pelo próprio comando
   * (`m.f.excluidos`) não contam.
   */
  function contagemPosterior_(m, produto, antes, depois, ctxEv, acao) {
    if (!produto) return;
    // O que o comando faz, na mensagem: gravar ou corrigir um lançamento (padrão), estornar, desfazer uma importação.
    var a = acao || { oque: 'este lançamento', fazer: 'grave este lançamento' };
    var ordem = ordemDoMovimento_(m, ctxEv);
    var c = HealthService.contagemAfetada(HealthService.contagensDoProduto(m.repo, produto.product_id, m.f.excluidos), antes, depois, ordem);
    if (!c) return;
    var ev = m.repo.porId('EVENTOS', c.event_id) || {};
    var oc = ordem(c.event_id);
    var pos = { data: c.data, ordem_seq: oc ? oc.ordem_seq : null, event_seq: oc ? oc.event_seq : null };
    m.conflitos.push(Validation.detalhe({
      codigo: 'CONTAGEM_POSTERIOR', campo: 'product_id',
      mensagem: produto.nome + ': a contagem do estoque de ' + br_(c.data) + ' (' + HealthService.quantidadeTexto(c.saldo_contado, produto.unidade) + ' contados) já acertou o saldo daquele dia, e ' + a.oque + ' o mudaria (de ' +
        HealthService.quantidadeTexto(HealthService.saldoNaPosicao(antes, pos, ordem), produto.unidade) + ' para ' + HealthService.quantidadeTexto(HealthService.saldoNaPosicao(depois, pos, ordem), produto.unidade) + '). Estorne antes a contagem de ' + br_(c.data) + ', ' + a.fazer + ' e conte de novo.',
      conflito: conflitoCom_(c.event_id, ev.event_type || 'ESTOQUE', ev.event_subtype || 'AJUSTE', c.data),
    }));
  }
  /**
   * Consumo, custo e carência da SANIDADE (03b, seções 10.3 e 15.2; 07, seção 5; PR-11; RN-054): a quantidade consumida
   * (informada, ou a soma das doses) gera o movimento de SAIDA do produto do cadastro, com o custo unitário congelado, em
   * qualquer produto do cadastro (com ou sem estoque controlado); com custo unitário, o lançamento de consumo CUSTEIO sem
   * parcela na conta da categoria do produto, 100% rateado aos animais tratados (por cabeça; por peso, pela dose de cada um);
   * o serviço ou produto pago no ato é outro lançamento CUSTEIO, com parcelas, por cabeça. `SANIDADE.custo` = o que coube a
   * cada animal nos rateios do evento; `total_value` = Σ lançamentos. A carência confere as vendas já gravadas do animal.
   */
  function consumoSanidade_(m, ctxEv) {
    var s = ctxEv.sanidade;
    var ev = ctxEv.ev;
    var c = ctxEv.campos;
    var itens = ctxEv.itens.filter(function (it) { return it.linhaEA && it.sanidade; });
    if (!s || !itens.length || itens.length !== ctxEv.itens.length) return;
    var hist = ev.pre_marco_zero === true;
    var lancs = [];
    var planejados = [];
    if (s.produto && s.modo) {
      var soma = 0;
      var todas = itens.every(function (it) { return typeof it.dose === 'number'; });
      itens.forEach(function (it) { if (typeof it.dose === 'number') soma += Math.round(it.dose * 10000); });
      s.quantidade = s.quantidadeInformada !== null ? s.quantidadeInformada : s.modo !== 'TOTAL' && todas && soma > 0 ? soma / 10000 : null;
      if (s.quantidade === null && s.modo === 'TOTAL' && vazio_(c.quantidade_consumida_total)) return; // o catálogo já pediu a quantidade
      if (s.quantidade === null) return;
      // Na correção (e na correção do substituto) com o mesmo produto, o custo do insumo, a conta do consumo e o nome da
      // categoria na descrição são os congelados na aplicação original (03a, MOVIMENTOS_ESTOQUE.custo_unitario: "custo
      // congelado no momento do movimento"; 07, seção 5, item 2; PR-11) — não os do cadastro de hoje (Correcao.congelado).
      var doProduto = { produto_id: s.produto.product_id };
      var custoCong = Correcao.congelado(ctxEv.correcao, 'SANIDADE.custo_unitario', doProduto);
      var contaCong = Correcao.congelado(ctxEv.correcao, 'SANIDADE.conta_consumo', doProduto);
      var rotuloCong = Correcao.congelado(ctxEv.correcao, 'SANIDADE.rotulo_consumo', doProduto);
      var cu = custoCong ? custoCong.v : typeof s.produto.custo_unitario === 'number' && s.produto.custo_unitario > 0 ? s.produto.custo_unitario : null;
      var contaConsumo = (contaCong && m.repo.porId('PLANO_CONTAS', contaCong.v)) || FinancialService.conta(m.repo, HealthService.CONTA_DA_CATEGORIA[s.produto.categoria] || 'TRATAMENTOS');
    }
    // Aplicação anterior ao marco zero (importação do histórico sanitário; 04, seção 6): efeito zero no inventário, também no
    // de insumos — o estoque e o custo do insumo começam no marco zero (a saída de 2025 não baixa o frasco de hoje, e o custo
    // unitário de hoje não é o da época). Fica o registro: produto, dose, quantidade, carência e próxima aplicação.
    if (hist) s.historico = true;
    if (s.produto && s.modo && !hist) {
      ctxEv.plano.MOVIMENTOS_ESTOQUE.push({
        mov_id: m.tx.novoId(), product_id: s.produto.product_id, event_id: ev.event_id, data: ev.event_date, tipo: 'SAIDA', quantidade: s.quantidade,
        custo_unitario: cu, lote: typeof c.lote === 'string' ? nulo_(Utils.aparar(c.lote)) : null, validade: nulo_(c.validade), observacoes: null,
      });
      var aa = movimentosAntesDepois_(m, ctxEv, s.produto.product_id);
      avisoEstoque_(m, s.produto, aa.antes, aa.depois);
      contagemPosterior_(m, s.produto, aa.antes, aa.depois, ctxEv);
      s.saldo = s.produto.controla_estoque === true ? { antes: HealthService.saldo(aa.antes, null), depois: HealthService.saldo(aa.depois, null) } : null;
      var valor = HealthService.valorConsumo(s.quantidade, cu);
      s.consumo = { custo_unitario: cu, valor: valor };
      // Sem custo pelo custo congelado vazio do original (a aplicação gravada quando o cadastro não tinha custo): a correção
      // mantém o custo daquele dia (03a, MOVIMENTOS_ESTOQUE.custo_unitario: congelado no movimento), e preencher o cadastro
      // agora não muda esta aplicação. A revisão diz isso, e não "preencha o custo no cadastro".
      if (!(valor > 0) && custoCong && custoCong.v === null) s.consumo.porque_sem_custo = 'sem custo: a aplicação original foi gravada sem custo (o produto não tinha custo por unidade no cadastro naquele dia), e a correção mantém o custo daquele dia. O custo preenchido depois no cadastro vale para as aplicações novas.';
      if (valor > 0) {
        var porPeso = s.modo === 'POR_PESO' && itens.length > 1 && todas;
        var pl = FinancialService.planejar(m.tx, {
          evento: ev, conta: contaConsumo, naturezas: ['CUSTEIO'], valor: valor,
          descricao: rotuloCong ? 'Consumo de ' + rotuloCong.v + ': ' + HealthService.quantidadeTexto(s.quantidade, s.produto.unidade) : HealthService.descricaoConsumo(s.produto, s.quantidade),
          quantidade: s.quantidade, product_id: s.produto.product_id, semCaixa: true,
          rateio: porPeso
            ? { criterio: 'MANUAL', justificativa: 'Proporcional à dose de cada animal (dose por kg de peso vivo).', itens: itens.map(function (it) { return { animal_id: it.animal_id, chave: it.codigo_interno, base: it.dose, quem: it.quem }; }), cemPorCento: true }
            : { criterio: 'CABECAS', itens: itens.map(function (it) { return { animal_id: it.animal_id, chave: it.codigo_interno, base: 1, quem: it.quem }; }), cemPorCento: true },
          campo: 'produto_id', rotulo: 'o consumo do produto',
        }, m.col);
        if (pl) {
          FinancialService.juntar(ctxEv.plano, pl);
          planejados.push(pl);
          lancs.push(resumoLancamento_(m, pl, m.repo.porId('PLANO_CONTAS', pl.linhas.FINANCEIRO[0].conta_id), { papel: 'CONSUMO' }));
        }
      }
    }
    if (!vazio_(c.custo_valor) && !vazio_(c.custo_conta_id) && typeof c.custo_valor === 'number') {
      var conta = m.repo.porId('PLANO_CONTAS', c.custo_conta_id);
      parceiroValido_(m, ctxEv, 'custo_partner_id', c.custo_partner_id);
      if (!conta) erroGeral_(m, 'custo_conta_id', 'NAO_ENCONTRADO', 'A conta escolhida não existe no plano de contas.');
      else if (s.consumo && s.consumo.valor > 0 && contasDeConsumo_()[conta.codigo]) {
        // O produto do cadastro com custo já entra no resultado pelo consumo (07, seção 5: nunca é comprado em conta CUSTEIO);
        // o mesmo frasco pago aqui, numa conta de insumo, sairia duas vezes do resultado (13, FIN-04).
        erroGeral_(m, 'custo_conta_id', 'CUSTO_EM_DOBRO', s.produto.nome + ' é do cadastro e já entra no custo pelo consumo (' + HealthService.quantidadeTexto(s.quantidade, s.produto.unidade) + ', ' +
          Utils.formatarReais(s.consumo.valor) + ' pelo custo do cadastro). Lance a compra do frasco pela entrada no estoque e deixe aqui só o serviço (a conta Serviços veterinários, por exemplo), ou aplique pelo nome do produto, sem o cadastro.');
      } else {
        var ps = FinancialService.planejar(m.tx, {
          evento: ev, conta: conta, naturezas: ['CUSTEIO'], valor: c.custo_valor,
          descricao: nulo_(c.custo_descricao) || (rotuloProcedimento_(s.procedimento).replace(/^./, function (x) { return x.toUpperCase(); }) + ' de ' + br_(ev.event_date) + ': serviço ou produto pago no ato'),
          partner_id: nulo_(c.custo_partner_id), documento: nulo_(c.custo_documento),
          // Antes do marco zero, o pagamento é anterior ao controle: sem caixa, como a compra e a morte históricas.
          parcelas: hist ? undefined : FinancialService.parcelasMensais(c.custo_valor, nulo_(c.custo_vencimento) || ev.event_date, nulo_(c.custo_parcelas_qtd), { forma_pagamento: c.custo_forma_pagamento, documento: c.custo_documento }), semCaixa: hist,
          rateio: { criterio: 'CABECAS', itens: itens.map(function (it) { return { animal_id: it.animal_id, chave: it.codigo_interno, base: 1, quem: it.quem }; }), cemPorCento: true },
          campo: 'custo_conta_id', rotulo: 'o custo pago no ato', inativaAceita: usadoNoOriginal_(m, conta.conta_id),
        }, m.col);
        if (ps) {
          FinancialService.juntar(ctxEv.plano, ps);
          planejados.push(ps);
          lancs.push(resumoLancamento_(m, ps, conta, { papel: 'SERVICO' }));
        }
      }
    }
    if (planejados.length) {
      var por = {};
      planejados.forEach(function (pl) { pl.rateio.itens.forEach(function (x) { por[x.animal_id] = (por[x.animal_id] || 0) + x.valor; }); });
      itens.forEach(function (it) { it.sanidade.custo = por[it.animal_id] === undefined ? null : por[it.animal_id]; });
      ev.total_value = lancs.reduce(function (t, l) { return t + l.valor; }, 0);
      resumoFinanceiro_(m, ctxEv, lancs, planejados);
      planejados.forEach(function (pl) {
        var a = FinancialService.avisoPeriodo(m.params, ev.event_date, 'O lançamento "' + pl.linhas.FINANCEIRO[0].descricao + '"');
        if (a) avisoItem_(m, null, a.codigo, a.mensagem);
      });
    }
    carenciaContraVendas_(m, ctxEv, itens);
  }
  /**
   * Carência × venda já gravada (RN-072 pelo outro caminho): a aplicação retroativa — ou a correção que estende a carência —
   * cuja carência cobre a data de uma venda vigente do animal. Na venda para ABATE vale a política de CARENCIA_ATIVA (padrão
   * BLOQUEIA: o animal abatido antes do fim da carência); nas demais, aviso com aceite.
   */
  function carenciaContraVendas_(m, ctxEv, itens) {
    var s = ctxEv.sanidade;
    if (!s || !s.fimCarencia) return;
    var data = ctxEv.ev.event_date;
    itens.forEach(function (it) {
      m.f.linhas(it.animal_id).forEach(function (l) {
        if (l.event_type !== 'VENDA' || l.event_date < data || l.event_date > s.fimCarencia || l.pre_marco_zero === true) return;
        var vd = m.repo.por('VENDAS', 'event_id', l.event_id)[0] || {};
        var abate = vd.finalidade === 'ABATE';
        avisoItem_(m, it, 'CARENCIA_ATIVA', it.quem + ': foi vendido' + (abate ? ' para abate' : '') + ' em ' + br_(l.event_date) + ', dentro da carência desta aplicação (até ' + br_(s.fimCarencia) + ').' +
          (abate ? ' Para o abate, a carência precisa ter terminado: confira a data e a carência.' : ' Confirme que o comprador soube da carência.'), conflitoCom_(l.event_id, l.event_type, l.event_subtype, l.event_date));
        if (!abate) (m.carenciaAvisa = m.carenciaAvisa || []).push(m.avisos[m.avisos.length - 1]);
      });
    });
  }
  /** Resumo da sanidade para a revisão (impactos): as contas do servidor, que a tela só mostra. */
  function resumoSanidade_(m, ctxEv) {
    var s = ctxEv.sanidade;
    if (!s) return null;
    return {
      procedimento: s.procedimento, produto_id: s.produto ? s.produto.product_id : null, nome_produto: s.nome, unidade: s.unidade, modo_dose: s.modo,
      dose_referencia: s.doseRef, quantidade: s.quantidade, quantidade_informada: s.quantidadeInformada !== null, consumo: s.consumo || null, estoque: s.saldo || null, historico: !!s.historico,
      protocol_id: s.protocolo ? s.protocolo.protocol_id : null, carencia_dias: s.carenciaDias, fim_carencia: s.fimCarencia, proxima_aplicacao: s.proxima,
      animais: ctxEv.itens.filter(function (it) { return it.sanidade; }).map(function (it) {
        return { animal_id: it.animal_id, codigo_interno: it.codigo_interno || null, brinco: it.brincoTexto || null, dose: it.dose, dose_do_original: it.doseDoOriginal === true, peso_kg: it.peso ? it.peso.kg : null, peso_situacao: it.peso ? it.peso.situacao : null, peso_estimado: it.peso ? it.peso.estimado : null, custo: it.sanidade.custo };
      }),
    };
  }

  // ------------------------------------------------------------------ reprodução, desmama, castração e ocorrência ----
  /**
   * Cabeçalho da REPRODUCAO (03b, seções 7.1 e 7.2; 05, RN-060): a estação de monta (existe; na exposição, na cobertura e na
   * inseminação a data cai no período dela, no diagnóstico é depois do início — na correção, a estação que o original já
   * usava vale como estava: mudar as datas da estação não mexe nos registros, 03a, seção 4.10); a retirada dos touros (na
   * exposição, no dia do início ou depois); o touro da cobertura e da inseminação (macho, não anulado, nascido antes; na
   * cobertura, do rebanho na data — linha TOURO — ou de fora; na inseminação, o do sêmen pode já ter saído do rebanho).
   */
  function cabecalhoReproducao_(m, ctxEv) {
    var c = ctxEv.campos;
    var sub = ctxEv.subtipo;
    var data = ctxEv.ev.event_date;
    var r = { sub: sub, estacao: null, touro: null, touroLinha: false, touros: [], dataFim: sub === 'EXPOSICAO' ? nulo_(c.data_fim) : null, metodo: nulo_(c.metodo), semen: typeof c.semen_identificacao === 'string' ? nulo_(Utils.aparar(c.semen_identificacao)) : null };
    if (!vazio_(c.estacao_id)) {
      var est = m.repo.porId('ESTACOES_MONTA', c.estacao_id);
      if (!est) erroGeral_(m, 'estacao_id', 'NAO_ENCONTRADO', 'A estação de monta escolhida não existe. Atualize a tela e escolha de novo.');
      else {
        r.estacao = est;
        if (Utils.dataValida(data) && !Correcao.congelado(ctxEv.correcao, 'REPRODUCAO.estacao', { estacao_id: est.estacao_id, subtipo: sub, data: data })) {
          var fora = sub === 'DIAGNOSTICO_GESTACAO' ? data < est.data_inicio : data < est.data_inicio || data > est.data_fim;
          if (fora) erroGeral_(m, 'estacao_id', 'FORA_DA_ESTACAO', sub === 'DIAGNOSTICO_GESTACAO'
            ? 'O diagnóstico de ' + br_(data) + ' é anterior ao início da estação ' + est.nome + ' (' + br_(est.data_inicio) + ').'
            : 'A data ' + br_(data) + ' fica fora da estação ' + est.nome + ' (de ' + br_(est.data_inicio) + ' a ' + br_(est.data_fim) + '). Escolha outra estação ou deixe sem estação.');
        }
      }
    }
    if (r.dataFim && Utils.dataValida(r.dataFim) && Utils.dataValida(data) && r.dataFim < data) erroGeral_(m, 'data_fim', 'DATA_INVALIDA', 'A retirada dos touros (' + br_(r.dataFim) + ') precisa ser no dia do início da exposição ou depois (' + br_(data) + ').');
    if ((sub === 'COBERTURA' || sub === 'INSEMINACAO') && !vazio_(c.touro_id)) {
      var t = existente_(m, c.touro_id);
      if (!t) erroGeral_(m, 'touro_id', 'NAO_ENCONTRADO', 'O touro informado não foi encontrado.');
      else if (t.sexo !== 'M') erroGeral_(m, 'touro_id', 'SEXO_DO_PROGENITOR', nomeAnimal_(t) + ' não pode ser o touro: precisa ser macho.');
      else if (!vazio_(t.data_nascimento) && Utils.dataValida(data) && t.data_nascimento >= data) erroGeral_(m, 'touro_id', 'NASCIMENTO_DO_PROGENITOR', 'O touro ' + nomeAnimal_(t) + ' nasceu em ' + br_(t.data_nascimento) + ', não antes de ' + br_(data) + '.');
      else {
        r.touro = t;
        r.touroLinha = sub === 'COBERTURA' && t.situacao_cadastral !== 'EXTERNO';
      }
    }
    ctxEv.reproducao = r;
  }
  function observacoes_(d) {
    return typeof d.observacoes === 'string' ? nulo_(Utils.aparar(d.observacoes)) : null;
  }
  /**
   * REPRODUCAO, um animal (03b, seções 3.4 e 7): a fêmea do rebanho na data (fato: o dia da saída conta) tem a linha SUJEITO
   * (efeito 0) e uma linha REPRODUCAO do subtipo, com o que é dela (no diagnóstico, o resultado, a idade da gestação e a
   * previsão informada; no aborto, a idade da gestação perdida). Na exposição, o macho da lista é um touro do lote (linha
   * TOURO, efeito 0); nos demais subtipos, o registro é só de fêmea (RN-060).
   */
  function itemReproducao_(m, ctxEv, it) {
    var d = it.dados;
    var r = ctxEv.reproducao;
    var sub = ctxEv.subtipo;
    var ev = ctxEv.ev;
    apontarExistente_(m, it);
    camposDoItem_(m, it, EventCatalog.camposAnimal('REPRODUCAO', sub), d);
    if (vazio_(d.animal_id)) return;
    var e = sujeito_(m, it, sub === 'EXPOSICAO' ? 'expõe' : 'registra na reprodução');
    if (!e) return;
    var obs = observacoes_(d);
    if (sub === 'EXPOSICAO' && e.sexo === 'M') {
      if (!vazio_(e.data_nascimento) && Utils.dataValida(ev.event_date) && e.data_nascimento >= ev.event_date) { erroItem_(m, it, 'animal_id', 'NASCIMENTO_DO_PROGENITOR', 'o touro nasceu em ' + br_(e.data_nascimento) + ', não antes da exposição.'); return; }
      it.touro = true;
      linhaEA_(m, ctxEv, it, { papel: 'TOURO', efeito_inventario: 0, observacoes: obs });
      r.touros.push(it.animal_id);
      return;
    }
    if (e.sexo !== 'F') { erroItem_(m, it, 'animal_id', 'NAO_E_FEMEA', sub === 'COBERTURA' || sub === 'INSEMINACAO' ? 'o registro é da fêmea; o touro vai no campo "' + (sub === 'INSEMINACAO' ? 'Touro do sêmen' : 'Touro') + '".' : 'o registro reprodutivo é de uma fêmea.'); return; }
    var erroCampo = function (campo) { return !!(it.camposComErro && it.camposComErro[campo]); };
    var res = sub === 'DIAGNOSTICO_GESTACAO' && !erroCampo('resultado') ? nulo_(d.resultado) : null;
    var idade = (sub === 'ABORTO' || res === 'POSITIVO') && typeof d.idade_gestacional_dias === 'number' && !erroCampo('idade_gestacional_dias') ? d.idade_gestacional_dias : null;
    // A duração da gestação é parâmetro: a idade que o original da correção já tinha nesta fêmea continua valendo depois de o
    // parâmetro mudar (o registro legítimo não vira erro; a faixa é regra do lançamento, não da integridade).
    var idadeDoOriginal = !!Correcao.congelado(ctxEv.correcao, 'REPRODUCAO.idade_gestacional', { animal_id: it.animal_id, idade: idade });
    if (idade !== null && !idadeDoOriginal && typeof m.params.dias_gestacao === 'number' && idade > m.params.dias_gestacao) erroItem_(m, it, 'idade_gestacional_dias', 'VALOR_FORA_DA_FAIXA', 'a idade da gestação (' + idade + ' dias) passa da duração da gestação (' + m.params.dias_gestacao + ' dias).');
    var prevista = res === 'POSITIVO' && !erroCampo('data_prevista_parto') ? nulo_(d.data_prevista_parto) : null;
    if (prevista && Utils.dataValida(prevista) && Utils.dataValida(ev.event_date) && prevista <= ev.event_date) erroItem_(m, it, 'data_prevista_parto', 'DATA_INVALIDA', 'a previsão de parto (' + br_(prevista) + ') precisa ser depois do diagnóstico (' + br_(ev.event_date) + ').');
    linhaEA_(m, ctxEv, it, { efeito_inventario: 0, observacoes: obs });
    it.femea = true;
    it.reproducao = {
      reproduction_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ev.event_id, tipo_evento: sub, data: ev.event_date, data_fim: r.dataFim,
      estacao_id: r.estacao ? r.estacao.estacao_id : null, touro_id: null, semen_identificacao: sub === 'INSEMINACAO' ? r.semen : null,
      metodo: EventCatalog.METODOS_REPRODUCAO[sub] ? r.metodo : null, resultado: res, idade_gestacional_dias: idade, data_prevista_parto: prevista, observacoes: obs,
    };
    ctxEv.plano.REPRODUCAO.push(it.reproducao);
  }
  /**
   * Depois dos animais da REPRODUCAO: ao menos uma fêmea; o touro de cada registro (na exposição, o único touro do lote;
   * na cobertura e na inseminação, o do cabeçalho); a linha TOURO do touro do rebanho na cobertura (a presença dele na
   * data é conferida pela linha do tempo); e o aviso de fêmea jovem (RN-061, um por fêmea).
   */
  function fecharReproducao_(m, ctxEv) {
    var r = ctxEv.reproducao;
    if (!r) return;
    var femeas = ctxEv.itens.filter(function (it) { return it.femea && it.reproducao; });
    var recusadas = ctxEv.itens.some(function (it) { return !it.linhaEA; });
    if (!femeas.length && !recusadas) erroGeral_(m, 'animais', 'SEM_FEMEAS', r.sub === 'EXPOSICAO' ? 'Inclua as fêmeas do lote (os machos da lista são os touros).' : 'Inclua ao menos uma fêmea.');
    var touro = r.sub === 'EXPOSICAO' ? (r.touros.length === 1 ? r.touros[0] : null) : r.touro ? r.touro.animal_id : null;
    femeas.forEach(function (it) { it.reproducao.touro_id = touro; });
    if (r.touroLinha && femeas.length) {
      var t = r.touro;
      var itT = { indice: ctxEv.itens.length, dados: { animal_id: t.animal_id }, animal_id: t.animal_id, publico: true, quem: 'O touro ' + nomeAnimal_(t), brincoTexto: nulo_(t.brinco), linhas: [], novo: false, final: {}, estado: t, codigo_interno: t.codigo_interno, touro: true };
      ctxEv.itens.push(itT);
      linhaEA_(m, ctxEv, itT, { papel: 'TOURO', efeito_inventario: 0 });
    }
    femeas.forEach(function (it) {
      var msg = ReproductionService.avisoIdade(m.params, it.estado, ctxEv.ev.event_date);
      if (msg) avisoItem_(m, it, 'IDADE_REPRODUTIVA', it.quem + ' ' + msg + ' Confirme o registro.');
    });
  }
  /** Pasto de destino dos bezerros (opcional; ativo, salvo o que o original já usava) e o método das pesagens. */
  function cabecalhoDesmama_(m, ctxEv) {
    var c = ctxEv.campos;
    var pasto = nulo_(c.pasto_destino_id);
    var ok = true;
    var inativo = null;
    if (pasto) {
      var p = m.f.pasto(pasto);
      if (!p) { erroGeral_(m, 'pasto_destino_id', 'NAO_ENCONTRADO', 'O pasto escolhido não existe.'); ok = false; }
      // O pasto desativado só recusa a desmama que leva bezerro para ele (itemDesmama_): o bezerro que já estava nele não muda
      // de pasto, e o pasto não fica gravado.
      else if (p.status !== 'ATIVO' && !usadoNoOriginal_(m, pasto)) inativo = p;
    }
    ctxEv.desmama = { pasto: ok ? pasto : null, pastoInativo: inativo, metodo: nulo_(c.metodo_pesagem) || 'BALANCA', maes: {} };
  }
  /** Presença do animal no rebanho no dia (fato: os dois limites contam), pela linha do tempo do motor. */
  function presenteNoDia_(m, id, data) {
    return Timeline.validar(m.f.linhas(id), {}).periodos.some(function (p) { return data >= p.inicio && (p.fim === null || data <= p.fim); });
  }
  /**
   * DESMAMA, um bezerro (03b, seções 3.4, 7.2 e 16.14): a cria (nascida na fazenda, ou que entrou com menos que a idade de
   * desmama de referência; 03a, DL-06) ainda não desmamada, no rebanho na data; a linha SUJEITO (efeito 0) leva o peso à
   * desmama e, com o pasto de destino diferente do pasto em que o bezerro está na posição do lançamento, vale como
   * movimento; o peso vira a pesagem DESMAMA. A mãe conhecida e no rebanho na data tem a linha MATRIZ e o registro DESMAMA
   * (uma vez por mãe, mesmo com gêmeos).
   */
  function itemDesmama_(m, ctxEv, it) {
    var d = it.dados;
    var ev = ctxEv.ev;
    var dz = ctxEv.desmama;
    apontarExistente_(m, it);
    camposDoItem_(m, it, EventCatalog.camposAnimal('DESMAMA'), d);
    if (vazio_(d.animal_id)) return;
    var e = sujeito_(m, it, 'desmama');
    if (!e || !Utils.dataValida(ev.event_date)) return;
    // A cria que o original da correção já desmamava continua aceita depois de mudar `idade_desmama_padrao_meses` (o fato
    // congelado na correção, como a idade da gestação do diagnóstico): a regra do parâmetro vale para o lançamento novo.
    var jaDesmamadaNoOriginal = !!Correcao.congelado(ctxEv.correcao, 'DESMAMA.cria', { animal_id: it.animal_id });
    if (!jaDesmamadaNoOriginal && !ReproductionService.ehCria(m.f, e, m.params)) { erroItem_(m, it, 'animal_id', 'NAO_E_CRIA', 'não é cria ao pé: não nasceu na fazenda e entrou no rebanho com ' + (vazio_(e.data_nascimento) ? 'idade desconhecida' : 'idade igual ou acima da desmama de referência (' + m.params.idade_desmama_padrao_meses + ' meses)') + '.'); return; }
    var outra = Timeline.ordenar(m.f.linhas(it.animal_id).filter(function (l) { return l.event_type === 'DESMAMA' && l.papel === 'SUJEITO'; }))[0];
    if (outra) { erroItem_(m, it, 'animal_id', 'JA_DESMAMADO', 'já foi desmamado em ' + br_(outra.event_date) + '. Para mudar a data, corrija aquela desmama.'); return; }
    var kg = typeof d.peso === 'number' && !(it.camposComErro && it.camposComErro.peso) ? d.peso : null;
    var campos = { efeito_inventario: 0, peso: kg, observacoes: observacoes_(d) };
    if (dz.pasto) {
      var onde = pastoNaPosicao_(m, it.animal_id, ev);
      if (onde.presente && onde.pasture_id !== dz.pasto) {
        if (dz.pastoInativo) {
          if (!dz.avisouInativo) erroGeral_(m, 'pasto_destino_id', 'PASTO_INATIVO', 'O pasto ' + dz.pastoInativo.nome + ' está desativado e não recebe animais.');
          dz.avisouInativo = true;
        } else { campos.pasto_origem_id = nulo_(onde.pasture_id); campos.pasto_destino_id = dz.pasto; it.movido = true; }
      } else if (onde.presente && onde.pasture_id === dz.pasto) {
        // O pasto informado fica gravado também quando o bezerro já está nele (origem = destino, sem estada nova): o dado
        // digitado não some (a entrada da correção o lê das linhas), e a linha do tempo confere a origem — o fato que tiraria o
        // bezerro desse pasto naquele dia (o estorno da transferência, a transferência retroativa) é recusado com o conflito,
        // em vez de mudar em silêncio o efeito desta desmama (CONTRATOS, seção 54).
        campos.pasto_origem_id = dz.pasto; campos.pasto_destino_id = dz.pasto;
      }
    }
    if (campos.pasto_destino_id && !campos.pasto_origem_id) { delete campos.pasto_destino_id; it.movido = false; }
    linhaEA_(m, ctxEv, it, campos);
    if (kg !== null) {
      it.pesoKg = kg;
      ctxEv.plano.PESAGENS.push({ weight_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ev.event_id, data_pesagem: ev.event_date, peso_kg: kg, metodo: dz.metodo, tipo: 'DESMAMA', observacoes: campos.observacoes });
    }
    it.cria = true;
    var mae = nulo_(e.mae_id);
    if (mae && !dz.maes[mae]) {
      var em = existente_(m, mae);
      if (em && em.sexo === 'F' && presenteNoDia_(m, mae, ev.event_date)) dz.maes[mae] = em;
    }
  }
  /** As mães dos bezerros desmamados: a linha MATRIZ e o registro DESMAMA (depois de todos os bezerros: uma vez por mãe). */
  function fecharDesmama_(m, ctxEv) {
    var dz = ctxEv.desmama;
    if (!dz) return;
    // Na correção com os mesmos bezerros e a mesma data, as mães são as que o original registrou: a mãe que o cadastro do
    // bezerro ganhou depois, ou que passou a estar no rebanho naquele dia por outro lançamento, não muda a desmama
    // (Correcao.congelado).
    var bezerros = ctxEv.itens.filter(function (it) { return it.cria && it.animal_id; }).map(function (it) { return it.animal_id; });
    var maesCong = Correcao.congelado(ctxEv.correcao, 'DESMAMA.maes', { data: ctxEv.ev.event_date, bezerros: bezerros });
    if (maesCong) {
      var doOriginal = {};
      maesCong.v.forEach(function (id) { var em = existente_(m, id); if (em) doOriginal[id] = em; });
      dz.maes = doOriginal;
    }
    Object.keys(dz.maes).forEach(function (id) {
      var e = dz.maes[id];
      var it = { indice: ctxEv.itens.length, dados: { animal_id: id }, animal_id: id, publico: true, quem: 'A mãe ' + nomeAnimal_(e), brincoTexto: nulo_(e.brinco), linhas: [], novo: false, final: {}, estado: e, codigo_interno: e.codigo_interno, matrizDesmama: true };
      ctxEv.itens.push(it);
      linhaEA_(m, ctxEv, it, { papel: 'MATRIZ', efeito_inventario: 0 });
      ctxEv.plano.REPRODUCAO.push({ reproduction_id: m.tx.novoId(), animal_id: id, event_id: ctxEv.ev.event_id, tipo_evento: 'DESMAMA', data: ctxEv.ev.event_date });
    });
  }
  /**
   * CASTRACAO, um animal (04, seção 4.5): macho do rebanho na data, ainda inteiro (nem castrado de origem nem castrado por
   * outra castração vigente). A castração muda a categoria automática pelo cadastro de categorias (castrado e, por isso,
   * não reprodutor; 03a, seção 4.3.3); o touro de exposição ou cobertura posterior é conferido pelas regras de manejo.
   */
  function itemCastracao_(m, ctxEv, it) {
    var d = it.dados;
    apontarExistente_(m, it);
    camposDoItem_(m, it, EventCatalog.camposAnimal('CASTRACAO'), d);
    if (vazio_(d.animal_id)) return;
    var e = sujeito_(m, it, 'castra');
    if (!e) return;
    if (e.sexo !== 'M') { erroItem_(m, it, 'animal_id', 'NAO_E_MACHO', 'só macho é castrado.'); return; }
    if (ReproductionService.castradoDeOrigem(m.f, it.animal_id)) { erroItem_(m, it, 'animal_id', 'JA_CASTRADO', 'já é castrado pelo cadastro.'); return; }
    var outra = ReproductionService.castracoes(m.f.linhas(it.animal_id))[0];
    if (outra) { erroItem_(m, it, 'animal_id', 'JA_CASTRADO', 'já foi castrado em ' + br_(outra.event_date) + '. Para mudar a data, corrija aquela castração.'); return; }
    linhaEA_(m, ctxEv, it, { efeito_inventario: 0, observacoes: observacoes_(d) });
  }
  /** OCORRENCIA, um animal: o animal do rebanho na data (fato); sem efeito no inventário. */
  function itemOcorrencia_(m, ctxEv, it) {
    var d = it.dados;
    apontarExistente_(m, it);
    camposDoItem_(m, it, EventCatalog.camposAnimal('OCORRENCIA'), d);
    if (vazio_(d.animal_id)) return;
    if (!sujeito_(m, it, 'registra')) return;
    linhaEA_(m, ctxEv, it, { efeito_inventario: 0, observacoes: observacoes_(d) });
  }
  /**
   * Regras de manejo de cada animal que o comando toca (ReproductionService.problemasDoAnimal: castração de fêmea ou
   * repetida, touro castrado, desmama repetida, parto dentro da gestação de um diagnóstico positivo), antes e depois do
   * comando, com as linhas e os registros dele no lugar: problema do próprio lançamento → VALIDATION; o que ele quebra num
   * lançamento gravado → CONFLICT com ele. A verificação de integridade e a trava usam a mesma função.
   */
  function conferirManejo_(m, ctxEv) {
    var regsPlano = Utils.agruparPor(ctxEv.plano.REPRODUCAO, 'animal_id');
    var feitos = {};
    ctxEv.itens.forEach(function (it) {
      if (!it.animal_id || it.novo || feitos[it.animal_id] || (ctxEv.repetidos && ctxEv.repetidos[it.animal_id])) return;
      feitos[it.animal_id] = true;
      var id = it.animal_id;
      var e = estado_(m, id);
      if (!e) return;
      var linhasNovas = [];
      (itensPorAnimal_(ctxEv)[id] || []).forEach(function (x) { linhasNovas = linhasNovas.concat(x.linhas); });
      var novos = (regsPlano[id] || []).map(function (r) { var o = Utils.clonar(r); o.ord = ctxEv.ev.ordem_seq; o.seq = ctxEv.ev.event_seq; o.event_type = ctxEv.tipo; o.event_subtype = ctxEv.subtipo; return o; });
      var depoisRegs = ReproductionService.registros(m.f, id).concat(novos).sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : (a.ord - b.ord) || (a.seq - b.seq); });
      var gravado = m.real.animal(id) || e;
      var antes = ReproductionService.problemasDoAnimal({ linhas: m.real.linhas(id), regs: ReproductionService.registros(m.real, id), sexo: gravado.sexo, castradoOrigem: ReproductionService.castradoDeOrigem(m.real, id) });
      // Depois do comando, o castrado de origem conta também o que o comando grava (a correção de cadastro do campo e os
      // atributos da criação): sem isso, a correção sem mudança da correção para "não castrado" veria repetida a castração
      // lançada depois dela.
      var castradoDepois = ReproductionService.castradoDeOrigem(m.f, id, { linhas: linhasNovas, ajustes: ctxEv.plano.AJUSTES, ord: ctxEv.ev.ordem_seq, seq: ctxEv.ev.event_seq });
      var depois = ReproductionService.problemasDoAnimal({ linhas: m.f.linhas(id).concat(linhasNovas), regs: depoisRegs, sexo: it.final && it.final.sexo !== undefined ? it.final.sexo : e.sexo, castradoOrigem: castradoDepois });
      ReproductionService.problemasNovos(antes, depois).forEach(function (p) {
        if (p.event_id === ctxEv.ev.event_id) erroItem_(m, it, 'animal_id', p.codigo, p.mensagem);
        else conflito_(m, it, p, p.mensagem + ' Estorne ou corrija esse registro antes, ou mude este lançamento.');
      });
    });
  }
  /**
   * A despesa paga no ato de um manejo (REPRODUCAO, CASTRACAO, OCORRENCIA; 03b, seção 2.5: "despesa informada no evento"):
   * um lançamento CUSTEIO na conta escolhida, com as parcelas mensais, rateado por cabeça entre os animais do lançamento (na
   * reprodução, as fêmeas; DIRETO com um), 100% alocado; `total_value` = o valor.
   */
  function despesaDoManejo_(m, ctxEv, itens) {
    var c = ctxEv.campos;
    var ev = ctxEv.ev;
    if (vazio_(c.custo_valor) || vazio_(c.custo_conta_id) || typeof c.custo_valor !== 'number') return;
    var conta = m.repo.porId('PLANO_CONTAS', c.custo_conta_id);
    parceiroValido_(m, ctxEv, 'custo_partner_id', c.custo_partner_id);
    if (!conta) { erroGeral_(m, 'custo_conta_id', 'NAO_ENCONTRADO', 'A conta escolhida não existe no plano de contas.'); return; }
    if (!itens.length || m.col.temErros()) return;
    var nome = EventCatalog.nomeEvento(ctxEv.tipo, ctxEv.subtipo);
    var pl = FinancialService.planejar(m.tx, {
      evento: ev, conta: conta, naturezas: ['CUSTEIO'], valor: c.custo_valor,
      descricao: nulo_(c.custo_descricao) || (nome.replace(/^(a|o) /, '').replace(/^./, function (x) { return x.toUpperCase(); }) + ' de ' + br_(ev.event_date) + ': despesa'),
      partner_id: nulo_(c.custo_partner_id), documento: nulo_(c.custo_documento),
      // Registro anterior ao marco zero (importação do histórico): o pagamento é anterior ao controle, sem caixa.
      parcelas: ev.pre_marco_zero === true ? undefined : FinancialService.parcelasMensais(c.custo_valor, nulo_(c.custo_vencimento) || ev.event_date, nulo_(c.custo_parcelas_qtd), { forma_pagamento: c.custo_forma_pagamento, documento: c.custo_documento }),
      semCaixa: ev.pre_marco_zero === true,
      rateio: { criterio: 'CABECAS', itens: itens.map(function (it) { return { animal_id: it.animal_id, chave: it.codigo_interno, base: 1, quem: it.quem }; }), cemPorCento: true },
      campo: 'custo_conta_id', rotulo: 'a despesa', inativaAceita: usadoNoOriginal_(m, conta.conta_id),
    }, m.col);
    if (!pl) return;
    FinancialService.juntar(ctxEv.plano, pl);
    ev.total_value = c.custo_valor;
    resumoFinanceiro_(m, ctxEv, [resumoLancamento_(m, pl, conta, { papel: 'CUSTO' })], [pl]);
    var a = FinancialService.avisoPeriodo(m.params, ev.event_date, 'A despesa ' + nome.replace(/^a /, 'da ').replace(/^o /, 'do '));
    if (a) avisoItem_(m, null, a.codigo, a.mensagem);
  }
  /** Resumo do manejo para a revisão (impactos): as contas do servidor, que a tela só mostra. */
  function resumoManejo_(m, ctxEv) {
    var t = ctxEv.tipo;
    if (t === 'REPRODUCAO' && ctxEv.reproducao) {
      var r = ctxEv.reproducao;
      var femeas = ctxEv.itens.filter(function (it) { return it.femea && it.reproducao; });
      var por = {};
      femeas.forEach(function (it) { var k = it.reproducao.resultado || 'SEM'; por[k] = (por[k] || 0) + 1; });
      var est = r.estacao ? { estacao_id: r.estacao.estacao_id, nome: r.estacao.nome } : null;
      var touro = r.touro ? { animal_id: r.touro.animal_id, nome: nomeAnimal_(r.touro), externo: r.touro.situacao_cadastral === 'EXTERNO' } : null;
      var touros = r.touros.map(function (id) { var e = estado_(m, id) || {}; return { animal_id: id, nome: nomeAnimal_(e) }; });
      return { tipo: 'REPRODUCAO', subtipo: ctxEv.subtipo, femeas: femeas.length, touros: touros, touro: touro, estacao: est, data_fim: r.dataFim, metodo: r.metodo, semen: r.semen,
        resultados: ctxEv.subtipo === 'DIAGNOSTICO_GESTACAO' ? { POSITIVO: por.POSITIVO || 0, NEGATIVO: por.NEGATIVO || 0, INCONCLUSIVO: por.INCONCLUSIVO || 0 } : null };
    }
    if (t === 'DESMAMA' && ctxEv.desmama) {
      var bez = ctxEv.itens.filter(function (it) { return it.cria && it.linhaEA; });
      var pesos = bez.filter(function (it) { return typeof it.pesoKg === 'number'; }).map(function (it) { return it.pesoKg; });
      var idades = bez.map(function (it) { var e = it.estado || {}; return vazio_(e.data_nascimento) || !Utils.dataValida(ctxEv.ev.event_date) || e.data_nascimento > ctxEv.ev.event_date ? null : Utils.idadeMeses(e.data_nascimento, ctxEv.ev.event_date); });
      return { tipo: 'DESMAMA', bezerros: bez.length, maes: Object.keys(ctxEv.desmama.maes).length, movidos: bez.filter(function (it) { return it.movido; }).length, pasto_destino_id: ctxEv.desmama.pasto,
        pesados: pesos.length, peso_medio_kg: pesos.length ? Utils.arredondar(pesos.reduce(function (s, x) { return s + x; }, 0) / pesos.length, 1) : null,
        animais: bez.map(function (it, i) { return { animal_id: it.animal_id, codigo_interno: it.codigo_interno || null, brinco: it.brincoTexto || null, peso_kg: typeof it.pesoKg === 'number' ? it.pesoKg : null, idade_meses: idades[i], mae_id: it.estado ? nulo_(it.estado.mae_id) : null }; }) };
    }
    if (t === 'CASTRACAO') return { tipo: 'CASTRACAO', machos: ctxEv.itens.filter(function (it) { return it.linhaEA; }).length, metodo: typeof ctxEv.campos.metodo === 'string' ? nulo_(Utils.aparar(ctxEv.campos.metodo)) : null };
    if (t === 'OCORRENCIA') return { tipo: 'OCORRENCIA', tipo_ocorrencia: nulo_(ctxEv.campos.tipo_ocorrencia), animais: ctxEv.itens.filter(function (it) { return it.linhaEA; }).length };
    return null;
  }

  // ------------------------------------------------------------------ estoque de insumos ----
  /**
   * ESTOQUE (04, seção 4.7; 03a, seções 4.6 e 4.7; 07, seção 5; desenho-base 16.9). ENTRADA: a compra do insumo do cadastro é
   * sempre um lançamento COMPRA_INSUMOS (natureza ESTOQUE_INSUMOS: caixa, fora do resultado e sem rateio aos animais), com o
   * produto, a quantidade e as parcelas; o movimento de ENTRADA (quantidade e custo unitário = valor ÷ quantidade) só existe
   * com `controla_estoque = S`. A quantidade é a informada na unidade do produto ou as embalagens × a quantidade por
   * embalagem do cadastro (congelada no payload). AJUSTE (só com o estoque controlado): pela contagem (a diferença entre o
   * saldo contado e o do sistema na data), por perda ou por vencimento (sai a quantidade perdida). Nenhum animal.
   */
  function estoque_(m, ctxEv) {
    var c = ctxEv.campos;
    var ev = ctxEv.ev;
    var sub = ctxEv.subtipo;
    var e = { subtipo: sub, produto: null, quantidade: null, variacao: null, motivo: null, saldo_contado: null, qtd_apresentacao: null, fator_conversao: null, valor: null };
    ctxEv.estoque = e;
    var produto = produtoDoCampo_(m, 'product_id', c.product_id);
    if (!produto) return;
    e.produto = produto;
    var lote = typeof c.lote === 'string' ? nulo_(Utils.aparar(c.lote)) : null;
    var obs = typeof c.notes === 'string' ? nulo_(Utils.aparar(c.notes)) : null;
    if (sub === 'ENTRADA') {
      var q = typeof c.quantidade === 'number' ? c.quantidade : null;
      // Na correção do mesmo produto, a quantidade por embalagem, o movimento e o nome do produto na descrição são os que o
      // original gravou (o payload congela o fator e o movimento): mudar o cadastro depois não muda a compra (Correcao.congelado).
      var doProduto = { product_id: produto.product_id };
      var fatorCong = Correcao.congelado(ctxEv.correcao, 'ESTOQUE.fator_conversao', doProduto);
      var movCong = Correcao.congelado(ctxEv.correcao, 'ESTOQUE.com_movimento', doProduto);
      var nomeCong = Correcao.congelado(ctxEv.correcao, 'ESTOQUE.nome_produto', doProduto);
      var fator = fatorCong ? fatorCong.v : produto.fator_conversao;
      // O movimento de entrada só com o estoque controlado (desenho-base 16.9); na correção, como o original gravou. O payload
      // congela se a compra tem o movimento (`com_movimento`): a entrada apagada à mão vira fonte quebrada na verificação,
      // não "compra lançada antes de ligar o controle".
      e.comMovimento = movCong ? movCong.v : produto.controla_estoque === true;
      // O lote e a validade só ficam no movimento: sem ele, o campo informado não teria onde ficar — recusado, não descartado.
      if (!e.comMovimento) {
        [['lote', lote, 'o lote'], ['validade', nulo_(c.validade), 'a validade']].forEach(function (x) {
          if (x[1] !== null) erroGeral_(m, x[0], 'CAMPO_NAO_SE_APLICA', 'O produto ' + produto.nome + ' não controla o estoque' + (produto.controla_estoque === true ? ' nesta compra (lançada sem o controle)' : '') + ': ' + x[2] + ' só fica no movimento do estoque. Deixe ' + x[2] + ' em branco ou ligue o controle de estoque no cadastro do produto.');
        });
      }
      if (!vazio_(c.qtd_apresentacao) && typeof c.qtd_apresentacao === 'number') {
        if (typeof fator !== 'number' || !(fator > 0)) {
          erroGeral_(m, 'qtd_apresentacao', 'SEM_FATOR', 'O produto ' + produto.nome + ' não tem no cadastro quantas unidades vêm em cada embalagem: informe a quantidade em ' + produto.unidade + ' ou complete o cadastro.');
          return;
        }
        var calc = Utils.arredondar(c.qtd_apresentacao * fator, 4);
        if (q !== null && q !== calc) { erroGeral_(m, 'quantidade', 'CONFLITO_DE_CAMPOS', 'As ' + Utils.formatarNumero(c.qtd_apresentacao) + ' embalagens de ' + Utils.formatarNumero(fator) + ' dão ' + HealthService.quantidadeTexto(calc, produto.unidade) + ', mas a quantidade informada é ' + HealthService.quantidadeTexto(q, produto.unidade) + '. Deixe só uma das duas.'); return; }
        q = calc;
        e.qtd_apresentacao = c.qtd_apresentacao;
        e.fator_conversao = fator;
      }
      if (q === null) { if (vazio_(c.quantidade)) erroGeral_(m, 'quantidade', 'CAMPO_OBRIGATORIO', 'Informe a quantidade comprada (na unidade do produto, ' + produto.unidade + ') ou as embalagens.'); return; }
      if (!(q > 0)) { erroGeral_(m, 'quantidade', 'VALOR_FORA_DA_FAIXA', 'A quantidade comprada precisa ser maior que zero.'); return; }
      e.quantidade = q;
      e.variacao = q;
      if (typeof c.valor !== 'number') return;
      e.valor = c.valor;
      parceiroValido_(m, ctxEv, 'partner_id', c.partner_id);
      var pl = FinancialService.planejar(m.tx, {
        evento: ev, conta: FinancialService.conta(m.repo, FinancialService.CONTAS.INSUMOS), naturezas: ['ESTOQUE_INSUMOS'], valor: c.valor,
        descricao: 'Compra de ' + (nomeCong ? nomeCong.v : produto.nome) + ': ' + HealthService.quantidadeTexto(q, produto.unidade), quantidade: q, product_id: produto.product_id,
        partner_id: nulo_(c.partner_id), documento: nulo_(c.documento),
        parcelas: FinancialService.parcelasMensais(c.valor, nulo_(c.vencimento) || ev.event_date, nulo_(c.parcelas_qtd), { forma_pagamento: c.forma_pagamento, documento: c.documento }),
        rateio: null, campo: 'valor', rotulo: 'a compra do insumo',
      }, m.col);
      if (!pl) return;
      FinancialService.juntar(ctxEv.plano, pl);
      ev.total_value = c.valor;
      ev.partner_id = nulo_(c.partner_id);
      resumoFinanceiro_(m, ctxEv, [resumoLancamento_(m, pl, m.repo.porId('PLANO_CONTAS', pl.linhas.FINANCEIRO[0].conta_id), { papel: 'INSUMO' })], [pl]);
      var a = FinancialService.avisoPeriodo(m.params, ev.event_date, 'A compra do insumo');
      if (a) avisoItem_(m, null, a.codigo, a.mensagem);
      if (e.comMovimento) {
        ctxEv.plano.MOVIMENTOS_ESTOQUE.push({ mov_id: m.tx.novoId(), product_id: produto.product_id, event_id: ev.event_id, data: ev.event_date, tipo: 'ENTRADA', quantidade: q, custo_unitario: HealthService.custoUnitarioEntrada(c.valor, q), lote: lote, validade: nulo_(c.validade), observacoes: obs });
      }
    } else {
      if (produto.controla_estoque !== true) { erroGeral_(m, 'product_id', 'PRODUTO_SEM_ESTOQUE', 'O produto ' + produto.nome + ' não controla estoque: ligue o controle de estoque no cadastro dele para acertar o saldo.'); return; }
      e.motivo = HealthService.MOTIVOS_AJUSTE.indexOf(c.motivo_ajuste) >= 0 ? c.motivo_ajuste : null;
      if (!e.motivo) return;
      var mov = movimentosAntesDepois_(m, null, produto.product_id);
      // O saldo na posição da contagem no dia (a correção dela fica no lugar do original: o movimento do mesmo dia gravado
      // depois da contagem original não entra no que ela contou).
      var saldoNaData = HealthService.saldoNaPosicao(mov.depois, { data: ev.event_date, ordem_seq: ev.ordem_seq, event_seq: ev.event_seq }, ordemDoMovimento_(m, ctxEv));
      if (e.motivo === 'CONTAGEM') {
        if (typeof c.saldo_contado !== 'number') return;
        e.saldo_contado = c.saldo_contado;
        e.variacao = Math.round((c.saldo_contado - saldoNaData) * 10000) / 10000;
        if (e.variacao === 0) { erroGeral_(m, 'saldo_contado', 'VALOR_IGUAL', 'O saldo contado é igual ao do sistema em ' + br_(ev.event_date) + ' (' + HealthService.quantidadeTexto(saldoNaData, produto.unidade) + '): não há o que acertar.'); return; }
      } else {
        if (typeof c.quantidade !== 'number') return;
        e.variacao = -c.quantidade;
      }
      e.quantidade = e.variacao;
      e.saldo_na_data = saldoNaData;
      ctxEv.plano.MOVIMENTOS_ESTOQUE.push({ mov_id: m.tx.novoId(), product_id: produto.product_id, event_id: ev.event_id, data: ev.event_date, tipo: 'AJUSTE', quantidade: e.variacao, custo_unitario: null, lote: lote, validade: nulo_(c.validade), observacoes: obs });
    }
    var aa = movimentosAntesDepois_(m, ctxEv, produto.product_id);
    // Na correção, o produto do original que sai do lançamento também muda de saldo.
    avisoEstoque_(m, produto, aa.antes, aa.depois);
    contagemPosterior_(m, produto, aa.antes, aa.depois, ctxEv);
    e.saldo = produto.controla_estoque === true ? { antes: HealthService.saldo(aa.antes, null), depois: HealthService.saldo(aa.depois, null) } : null;
  }
  /** Resumo do estoque para a revisão (impactos). */
  function resumoEstoque_(ctxEv) {
    var e = ctxEv.estoque;
    if (!e || !e.produto) return null;
    return {
      subtipo: e.subtipo, product_id: e.produto.product_id, nome: e.produto.nome, unidade: e.produto.unidade, controla_estoque: e.produto.controla_estoque === true,
      quantidade: e.quantidade, motivo: e.motivo, saldo_contado: e.saldo_contado, saldo_na_data: e.saldo_na_data === undefined ? null : e.saldo_na_data,
      qtd_apresentacao: e.qtd_apresentacao, fator_conversao: e.fator_conversao, valor: e.valor, saldo: e.saldo || null,
      custo_unitario: e.valor !== null && e.quantidade ? HealthService.custoUnitarioEntrada(e.valor, e.quantidade) : null,
      // O produto do cadastro sem custo por unidade (03a, seção 4.6: vazio = consumo sem custo; desenho-base 16.9: a compra
      // fica no estoque, fora do resultado): o que foi pago nunca vira custo. A revisão diz, e manda preencher o cadastro.
      produto_sem_custo: !(typeof e.produto.custo_unitario === 'number' && e.produto.custo_unitario > 0),
      // A entrada: o que o servidor grava (o movimento congelado em `com_movimento`), não o controle de estoque de hoje. Sem
      // movimento, o porquê.
      fora_do_estoque: e.subtipo !== 'ENTRADA' || e.comMovimento !== false ? null : e.produto.controla_estoque === true
        ? 'a compra foi lançada quando ' + e.produto.nome + ' não controlava estoque, e a correção a mantém fora do saldo (como o lançamento original). Para pôr a quantidade no saldo, acerte o estoque pela contagem (Produtos, "Acertar").'
        : e.produto.nome + ' não controla estoque (fica só o lançamento da compra)',
    };
  }
  /** Produtos cujo saldo o comando muda: os dos movimentos do plano e os do original anulado. */
  function produtosDoComando_(m, ctxEv, anulado) {
    var ids = (ctxEv ? ctxEv.plano.MOVIMENTOS_ESTOQUE : []).map(function (x) { return x.product_id; });
    if (anulado && m.repo.carregada('MOVIMENTOS_ESTOQUE')) ids = ids.concat(m.repo.por('MOVIMENTOS_ESTOQUE', 'event_id', anulado).map(function (x) { return x.product_id; }));
    return Utils.unicos(ids);
  }

  // ------------------------------------------------------------------ lançamento financeiro avulso (Fase 4, E4.1) ----
  /** Onde nasce o lançamento de cada natureza que o avulso não aceita (07, seção 1.3; CONTRATOS, seção 56). */
  var CAMINHO_DA_NATUREZA = {
    AQUISICAO_ANIMAIS: 'a compra de animais (e o frete e os custos dela) é lançada em "Comprar animais"; o frete cobrado depois entra pela correção da compra',
    RECEITA_VENDA_ANIMAIS: 'a receita da venda de animais nasce em "Vender animais"',
    DESPESA_VENDA: 'a despesa de venda (frete, comissão, taxas) entra na própria venda, como dedução; cobrada depois, pela correção da venda',
    ESTOQUE_INSUMOS: 'a compra de insumo do cadastro é lançada na entrada de estoque',
  };
  var CONTA_ARRENDAMENTO = 'ARRENDAMENTO_PASTO';
  /** Período de competência: no máximo dez anos (a conta mês a mês da conciliação; 07, seção 1.1). */
  var PERIODO_MAX_DIAS = 3653;
  /**
   * O lançamento avulso (03b, seções 10.2, 10.3 e 16.6; 07, seções 1.1 e 1.3): a conta (custeio, outra receita ou não
   * operacional), o valor, a competência (a data do evento) e o período opcional (só custeio e outra receita, a partir da
   * competência), o parceiro, o pasto (obrigatório no arrendamento de pasto), a categoria, o registro de negócio a que se
   * refere, o documento e as parcelas — em aberto ou já pagas ("Já pago em": nunca antes da competência nem no futuro). Uma
   * regra, um lugar: o mesmo tratador no registro, na simulação e na correção; a verificação confere o que ele grava
   * (FinancialService.conferir, invariante 21).
   */
  function lancamentoAvulso_(m, ctxEv, d) {
    var c = ctxEv.campos;
    var ev = ctxEv.ev;
    var conta = vazio_(c.conta_id) ? null : m.repo.porId('PLANO_CONTAS', c.conta_id);
    if (!vazio_(c.conta_id) && !conta) erroGeral_(m, 'conta_id', 'NAO_ENCONTRADO', 'A conta escolhida não existe no plano de contas.');
    if (conta && EventCatalog.NATUREZAS_AVULSO.indexOf(conta.natureza) < 0) {
      erroGeral_(m, 'conta_id', 'CONTA_INVALIDA', 'A conta "' + conta.nome + '" não serve para um lançamento avulso: ' + (CAMINHO_DA_NATUREZA[conta.natureza] || 'escolha uma conta de custeio, outra receita ou não operacional') + '.');
      conta = null;
    }
    var comPeriodo = !vazio_(c.competencia_inicio) || !vazio_(c.competencia_fim);
    if (conta && comPeriodo && conta.natureza === 'NAO_OPERACIONAL') erroGeral_(m, 'competencia_inicio', 'CAMPO_NAO_SE_APLICA', 'O período só vale para custeio e outras receitas: "' + conta.nome + '" é não operacional e não entra no resultado.');
    if (!vazio_(c.competencia_inicio) && !vazio_(c.competencia_fim) && Utils.dataValida(c.competencia_inicio) && Utils.dataValida(c.competencia_fim)) {
      if (c.competencia_fim < c.competencia_inicio) erroGeral_(m, 'competencia_fim', 'PERIODO_INVERTIDO', 'O fim do período (' + br_(c.competencia_fim) + ') é antes do início (' + br_(c.competencia_inicio) + ').');
      else if (Utils.diasNoIntervalo(c.competencia_inicio, c.competencia_fim) > PERIODO_MAX_DIAS) erroGeral_(m, 'competencia_fim', 'VALOR_FORA_DA_FAIXA', 'O período vai até dez anos.');
      // A competência no início do período ou antes (o resultado de cada mês pedido no fim dele é o do mês; CONTRATOS, seção 55).
      if (Utils.dataValida(ev.event_date) && c.competencia_inicio < ev.event_date) erroGeral_(m, 'competencia_inicio', 'PERIODO_ANTES_DA_DATA', 'O período começa em ' + br_(c.competencia_inicio) + ', antes da data do lançamento (' + br_(ev.event_date) + '): lance com a data do início do período (ou antes) e o período a partir dela.');
    }
    if (conta && conta.codigo === CONTA_ARRENDAMENTO) {
      if (vazio_(c.pasture_id)) erroGeral_(m, 'pasture_id', 'CAMPO_OBRIGATORIO', 'O arrendamento é de um pasto: escolha o pasto arrendado.');
      if (vazio_(c.competencia_inicio)) erroGeral_(m, 'competencia_inicio', 'CAMPO_OBRIGATORIO', 'Informe o período do arrendamento (de quando até quando o pasto foi alugado).');
    }
    if (!vazio_(c.pasture_id)) {
      var pasto = m.f.pasto(c.pasture_id);
      if (!pasto) erroGeral_(m, 'pasture_id', 'NAO_ENCONTRADO', 'O pasto escolhido não existe.');
      else if (pasto.status !== 'ATIVO' && !usadoNoOriginal_(m, pasto.pasture_id)) erroGeral_(m, 'pasture_id', 'PASTO_INATIVO', 'O pasto ' + pasto.nome + ' está desativado.');
    }
    if (!vazio_(c.categoria_animal_id)) {
      var cat = m.repo.porId('CATEGORIAS', c.categoria_animal_id);
      if (!cat) erroGeral_(m, 'categoria_animal_id', 'NAO_ENCONTRADO', 'A categoria escolhida não existe.');
      else if (cat.ativo === false && !usadoNoOriginal_(m, cat.category_id)) erroGeral_(m, 'categoria_animal_id', 'CATEGORIA_INATIVA', 'A categoria ' + cat.nome + ' está desativada.');
    }
    if (!vazio_(c.ref_event_id)) {
      var ref = m.tx.cru.cruPorId('EVENTOS', c.ref_event_id);
      var vale = ref ? m.tx.cru.avaliar(ref.event_id).status === 'CONFIRMADO' : false;
      var doOriginal = ctxEv.original && m.tx.cru.cruPor('FINANCEIRO', 'event_id', ctxEv.original.event_id).some(function (f) { return f.ref_event_id === c.ref_event_id; });
      if (!ref || ref.event_type === 'ESTORNO') erroGeral_(m, 'ref_event_id', 'NAO_ENCONTRADO', 'O registro a que o lançamento se refere não existe.');
      else if (ctxEv.original && (ref.event_id === ctxEv.original.event_id)) erroGeral_(m, 'ref_event_id', 'REFERENCIA_INVALIDA', 'O lançamento não pode se referir a ele mesmo.');
      else if (!vale && !doOriginal) erroGeral_(m, 'ref_event_id', 'JA_ANULADO', 'O registro a que o lançamento se refere foi estornado ou corrigido e não vale mais: escolha o que vale.');
    }
    parceiroValido_(m, ctxEv, 'partner_id', c.partner_id);
    // As parcelas: o formato pelo catálogo (o grupo do tipo) e "Já pago em" a partir da competência, até hoje.
    var lista = Array.isArray(d.parcelas) ? d.parcelas : [];
    var defs = EventCatalog.camposGrupo('LANCAMENTO_FINANCEIRO', 'parcelas');
    lista.forEach(function (p, i) {
      var quem = lista.length > 1 ? 'Parcela ' + (i + 1) + ': ' : 'A parcela: ';
      var x = p && typeof p === 'object' ? p : {};
      EventCatalog.validarCampos(defs, x, { listas: m.listas, desativados: m.desativados }).forEach(function (e) { m.col.erro(Validation.detalhe({ codigo: e.codigo, campo: 'parcelas', mensagem: quem + e.mensagem, indice: i })); });
      if (vazio_(x.pago_em) || !Utils.dataValida(x.pago_em)) return;
      if (x.pago_em > m.hoje) m.col.erro(Validation.detalhe({ codigo: 'DATA_FUTURA', campo: 'parcelas', mensagem: quem + 'o pagamento em ' + br_(x.pago_em) + ' ainda não aconteceu: deixe "Já pago em" vazio e dê a baixa quando pagar.', indice: i }));
      else if (Utils.dataValida(ev.event_date) && x.pago_em < ev.event_date) m.col.erro(Validation.detalhe({ codigo: 'PAGAMENTO_ANTES_DA_COMPETENCIA', campo: 'parcelas', mensagem: quem + 'o pagamento em ' + br_(x.pago_em) + ' é antes da data do lançamento (' + br_(ev.event_date) + '). O pagamento adiantado de um período vai num lançamento com a data do pagamento e o período depois dela.', indice: i }));
    });
    if (!conta || typeof c.valor !== 'number' || m.col.temErros()) return;
    var tipoTxt = conta.tipo === 'RECEITA' ? 'a receita' : 'a despesa';
    var pl = FinancialService.planejar(m.tx, {
      evento: ev, conta: conta, naturezas: EventCatalog.NATUREZAS_AVULSO, valor: c.valor, descricao: nulo_(c.descricao),
      partner_id: nulo_(c.partner_id), documento: nulo_(c.documento), observacoes: nulo_(c.notes), quantidade: typeof c.quantidade === 'number' ? c.quantidade : null,
      pasture_id: nulo_(c.pasture_id), categoria_animal_id: nulo_(c.categoria_animal_id), ref_event_id: nulo_(c.ref_event_id),
      competencia_inicio: nulo_(c.competencia_inicio), competencia_fim: nulo_(c.competencia_fim),
      parcelas: lista, aceitaPago: true, pagamento: conta.tipo === 'RECEITA' ? 'será recebida' : 'será paga', rateio: null,
      campo: 'valor', campoParcelas: 'parcelas', rotulo: tipoTxt, inativaAceita: usadoNoOriginal_(m, conta.conta_id),
    }, m.col);
    if (!pl) return;
    FinancialService.juntar(ctxEv.plano, pl);
    ev.total_value = c.valor;
    ev.partner_id = nulo_(c.partner_id);
    ev.description = nulo_(c.descricao);
    resumoFinanceiro_(m, ctxEv, [resumoLancamento_(m, pl, conta, { papel: 'AVULSO', pagas: pl.linhas.PARCELAS.filter(function (x) { return x.status === 'LIQUIDADA'; }).length })], [pl]);
    var a = FinancialService.avisoPeriodo(m.params, ev.event_date, 'O lançamento');
    if (a) avisoItem_(m, null, a.codigo, a.mensagem);
  }
  /**
   * O transporte da baixa na correção (RN-046; 03b, seção 11; CONTRATOS, seção 56): cada parcela paga do original vai para a
   * parcela do lançamento correspondente do substituto com o mesmo valor e o mesmo vencimento, que nasce paga com a baixa dela
   * (data, valor pago, juros e multa, desconto, forma) — Correcao.congelado('PARCELAS.baixa'). Sem a correspondente (o valor
   * ou o vencimento mudou, ou o lançamento saiu), a correção é recusada: desfaça a baixa antes (CONFLICT PARCELA_LIQUIDADA).
   * A baixa transportada não fica antes da data do lançamento novo (a identidade das três visões; seção 55). Vale para todo
   * tipo de evento, no mesmo ponto (fechar_).
   */
  function transportarBaixas_(m, ctxEv) {
    var original = ctxEv.original;
    var corresp = lancamentosCorrespondentes_(m, ctxEv);
    var usadas = {};
    m.repo.por('FINANCEIRO', 'event_id', original.event_id).forEach(function (fin) {
      var pagas = m.repo.por('PARCELAS', 'financial_id', fin.financial_id).filter(function (p) { return p.status === 'LIQUIDADA'; })
        .sort(function (a, b) { return (a.parcela_num || 0) - (b.parcela_num || 0) || (a.data_vencimento < b.data_vencimento ? -1 : a.data_vencimento > b.data_vencimento ? 1 : 0); });
      if (!pagas.length) return;
      var novoId = corresp[fin.financial_id] || null;
      var novoFin = novoId ? ctxEv.plano.FINANCEIRO.filter(function (f) { return f.financial_id === novoId; })[0] : null;
      var novas = novoId ? ctxEv.plano.PARCELAS.filter(function (q) { return q.financial_id === novoId; }) : [];
      pagas.forEach(function (p) {
        var b = Correcao.congelado(ctxEv.correcao, 'PARCELAS.baixa', { financial_id: fin.financial_id, valor: p.valor, data_vencimento: p.data_vencimento, parcela_id: p.parcela_id });
        var q = b ? novas.filter(function (x) { return !usadas[x.parcela_id] && x.valor === p.valor && x.data_vencimento === p.data_vencimento; })[0] : null;
        var nome = '"' + (fin.descricao || EventCatalog.nomeEvento(original.event_type, original.event_subtype)) + '"';
        if (!q) {
          m.conflitos.push(Validation.detalhe({
            codigo: 'PARCELA_LIQUIDADA', campo: 'parcelas',
            mensagem: 'A parcela de ' + Utils.formatarReais(p.valor) + ' com vencimento em ' + br_(p.data_vencimento) + ' do lançamento ' + nome + ' foi paga em ' + br_(p.data_pagamento) + (novoFin ? ', e a correção muda o valor ou o vencimento dela.' : ', e a correção tira o lançamento.') + ' Mantenha o valor e o vencimento da parcela paga, ou desfaça a baixa antes de corrigir.',
            conflito: conflitoCom_(original.event_id, original.event_type, original.event_subtype, original.event_date),
          }));
          return;
        }
        usadas[q.parcela_id] = true;
        if (q.status === 'LIQUIDADA') { erroGeral_(m, 'parcelas', 'PARCELA_JA_PAGA', 'A parcela de ' + Utils.formatarReais(p.valor) + ' com vencimento em ' + br_(p.data_vencimento) + ' já está paga (em ' + br_(p.data_pagamento) + '): deixe "Já pago em" vazio; a correção mantém a baixa dela.'); return; }
        if (novoFin && b.v.data_pagamento < novoFin.data_competencia) {
          m.conflitos.push(Validation.detalhe({
            codigo: 'PAGAMENTO_ANTES_DA_COMPETENCIA', campo: 'event_date',
            mensagem: 'A parcela do lançamento ' + nome + ' foi paga em ' + br_(b.v.data_pagamento) + ', antes da data nova (' + br_(novoFin.data_competencia) + '). Desfaça a baixa antes de levar o lançamento para depois do pagamento.',
            conflito: conflitoCom_(original.event_id, original.event_type, original.event_subtype, original.event_date),
          }));
          return;
        }
        ['status', 'data_pagamento', 'valor_pago', 'juros_multa', 'desconto', 'forma_pagamento'].forEach(function (k) { q[k] = b.v[k]; });
      });
    });
  }

  // ------------------------------------------------------------------ nascimento ----
  /** A matriz do parto (papel MATRIZ, efeito 0): fêmea do rebanho; a presença na data é conferida como fato (RN-017). */
  function itemMatriz_(m, ctxEv, it) {
    apontarExistente_(m, it);
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
    // O pasto e a raça das crias digitados são fatos informados; os que o servidor tira da mãe, derivados. O payload guarda
    // quais foram digitados (`pasto_crias_informado`, `racas_informadas`): a entrada da correção os lê das linhas gravadas,
    // nunca comparando com o estado de hoje da mãe (CONTRATOS, 50.2).
    ctxEv.pastoCriasInformado = pasto !== null;
    ctxEv.pastoParto = pasto;
    // Só a cria viva vai para um pasto: sem ela, o pasto da mãe não é pedido nem conferido, e o pasto informado não é conferido
    // como quem recebe animais (o parto só de natimorto não grava pasto; a correção sem mudança dele não depende do pasto da mãe
    // naquele dia nem do cadastro do pasto).
    var comViva = lista.some(function (x) { return x && typeof x === 'object' && x.situacao_nascimento === 'VIVO'; });
    if (pasto) {
      var p = m.f.pasto(pasto);
      if (!p) erroGeral_(m, 'pasto_destino_id', 'NAO_ENCONTRADO', 'O pasto informado para as crias não existe.');
      else if (comViva && !hist && p.status !== 'ATIVO' && !usadoNoOriginal_(m, pasto)) erroGeral_(m, 'pasto_destino_id', 'PASTO_INATIVO', 'O pasto ' + p.nome + ' está desativado e não recebe animais.');
    } else if (!comViva) {
      pasto = null;
    } else if (mat && !hist && Correcao.congelado(ctxEv.correcao, 'NASCIMENTO.pasto_crias', { mae_id: mat.animal_id, data: ev.event_date })) {
      // Na correção com a mesma mãe e a mesma data, o pasto que o parto tirou da mãe naquele dia é o do original (o estado da
      // mãe mudado depois por outro lançamento não muda o parto: Correcao.congelado).
      pasto = Correcao.congelado(ctxEv.correcao, 'NASCIMENTO.pasto_crias', { mae_id: mat.animal_id, data: ev.event_date }).v;
    } else if (mat && !hist) {
      var onde = Timeline.pastoAntesDaSaida(m.f.linhas(mat.animal_id), ev.event_date, m.D0);
      pasto = onde.presente ? nulo_(onde.pasture_id) : null;
      if (onde.presente && !pasto) erroGeral_(m, 'pasto_destino_id', 'CAMPO_OBRIGATORIO', 'A mãe está sem pasto registrado em ' + br_(ev.event_date) + ': escolha o pasto das crias.');
      // O pasto que vem da mãe passa pela mesma regra do pasto informado (03a, seção 2.1): pasto desativado não recebe
      // animais, e a cria nasce nele.
      var pm = pasto ? m.f.pasto(pasto) : null;
      if (pm && pm.status !== 'ATIVO' && !usadoNoOriginal_(m, pasto)) erroGeral_(m, 'pasto_destino_id', 'PASTO_INATIVO', 'A mãe estava no pasto ' + pm.nome + ' em ' + br_(ev.event_date) + ', e ele está desativado: escolha o pasto das crias (um pasto ativo) ou reative o ' + pm.nome + ' na tela Pastos.');
    }
    var defs = EventCatalog.camposGrupo('NASCIMENTO', 'crias');
    var vivos = 0;
    var natimortos = 0;
    lista.forEach(function (bruto, k) {
      var d = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
      var codigo = typeof d.brinco === 'string' && !vazio_(Utils.aparar(d.brinco)) ? Utils.aparar(d.brinco) : null;
      var rotulo = m.opcoes.rotulosCrias ? m.opcoes.rotulosCrias[k] : null;
      var it = { indice: k, dados: d, animal_id: null, publico: false, quem: !vazio_(rotulo) ? rotulo : 'Cria ' + (k + 1) + (codigo ? ' (brinco ' + codigo + ')' : ''), brincoTexto: codigo, linhas: [], novo: false, final: {}, cria: true };
      camposDoItem_(m, it, defs, semAnimalId_(d));
      if (d.situacao_nascimento === 'NATIMORTO') { natimortos++; return; }
      if (d.situacao_nascimento !== 'VIVO') return;
      vivos++;
      ctxEv.itens.push(it);
      criaViva_(m, ctxEv, it, pasto);
    });
    ctxEv.parto = { nascidos_vivos: vivos, natimortos: natimortos, pasto_destino_id: pasto, historico: hist };
    // Sem cria viva não há cria que leve a mãe e o pai à genealogia: os dois são conferidos aqui (RN-009, RN-060).
    if (!vivos) conferirPaiDoParto_(m, ctxEv);
    // Nascida depois do parto, a linha do tempo já recusa (ANTES_DO_NASCIMENTO); no próprio dia do parto, é aqui.
    if (!vivos && mat && mat.estado && Utils.dataValida(ev.event_date) && mat.estado.data_nascimento === ev.event_date) {
      erroItem_(m, mat, 'animal_id', 'NASCIMENTO_DO_PROGENITOR', 'a mãe nasceu em ' + br_(mat.estado.data_nascimento) + ', não antes do parto (' + br_(ev.event_date) + '). Confira a mãe ou as datas.');
    }
    if (!mat) return;
    ctxEv.plano.REPRODUCAO.push({
      reproduction_id: m.tx.novoId(), animal_id: mat.animal_id, event_id: ev.event_id, tipo_evento: 'PARTO', data: ev.event_date,
      touro_id: nulo_(c.pai_id), qtd_nascidos_vivos: vivos, qtd_natimortos: natimortos, tipo_parto: nulo_(c.tipo_parto), data_parto: ev.event_date,
    });
  }
  /**
   * Pai do parto sem cria viva (05, seção 2.2: RN-008; seção 2.9: RN-060, touro_id é macho): o mesmo que a genealogia
   * confere na cria viva — existe e não foi anulado (o animal de referência serve), é macho e nasceu antes do parto.
   */
  function conferirPaiDoParto_(m, ctxEv) {
    var pid = nulo_(ctxEv.campos.pai_id);
    if (pid === null) return;
    var data = ctxEv.ev.event_date;
    var p = m.conhecidos[pid] || existente_(m, pid);
    if (!p) { erroGeral_(m, 'pai_id', 'NAO_ENCONTRADO', 'O pai informado não foi encontrado.'); return; }
    var nome = m.conhecidos[pid] ? m.conhecidos[pid].nome || 'o animal informado' : nomeAnimal_(p);
    if (p.sexo !== 'M') { erroGeral_(m, 'pai_id', 'SEXO_DO_PROGENITOR', nome + ' não pode ser pai: precisa ser macho.'); return; }
    if (!vazio_(p.data_nascimento) && Utils.dataValida(data) && p.data_nascimento >= data) {
      erroGeral_(m, 'pai_id', 'NASCIMENTO_DO_PROGENITOR', 'O pai ' + nome + ' nasceu em ' + br_(p.data_nascimento) + ', não antes do parto (' + br_(data) + '). Confira o pai ou as datas.');
    }
  }
  /** Registros reprodutivos vigentes (fora os que o comando anula) que têm o animal como touro, na ordem da data. */
  function comoTouro_(m, id) {
    return m.repo.por('REPRODUCAO', 'touro_id', id).filter(function (r) { return !m.f.excluidos[r.event_id]; })
      .sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });
  }
  /** O registro reprodutivo nas mensagens, depois de "pai": "do parto de 01/06/2026" ou "do registro reprodutivo de …". */
  function doReproducao_(r) {
    return (r.tipo_evento === 'PARTO' ? 'do parto de ' : 'do registro reprodutivo de ') + br_(r.data);
  }
  function criaViva_(m, ctxEv, it, pasto) {
    var d = it.dados;
    var c = ctxEv.campos;
    var ev = ctxEv.ev;
    var mat = ctxEv.matriz || null;
    var hist = ev.pre_marco_zero === true;
    var reuso = !vazio_(d.animal_id);
    if (reuso && !ctxEv.criadosOriginal[d.animal_id]) { erroItem_(m, it, 'animal_id', 'SO_ANIMAIS_NOVOS', 'a cria de um parto é sempre um animal novo.'); return; }
    // A cria nova não pode ser um animal que já está no cadastro: o filho da mesma mãe, com o mesmo nascimento, que não
    // veio de parto registrado (o bezerro da fotografia do marco zero cujo parto antigo é lançado depois). A cria do parto
    // é sempre um animal novo, então lançar o parto dele o poria duas vezes no rebanho (04, seção 6: o inventário é exato
    // a partir do marco zero). A trava confere o mesmo estado por todos os caminhos (GENEALOGIA, cria em dobro).
    if (!reuso && mat && Utils.dataValida(ev.event_date)) {
      var jaNoCadastro = filhoSemParto_(m, mat.animal_id, ev.event_date);
      if (jaNoCadastro) {
        erroItem_(m, it, 'situacao_nascimento', 'CRIA_JA_NO_CADASTRO', 'a mãe já tem no cadastro um filho nascido em ' + br_(ev.event_date) + ' que não veio de parto registrado: ' + (vazio_(jaNoCadastro.brinco) ? jaNoCadastro.codigo_interno : jaNoCadastro.codigo_interno + ' (brinco ' + jaNoCadastro.brinco + ')') + '. A cria deste parto seria o mesmo animal duas vezes no rebanho. O parto de um animal que já está no cadastro não se lança: a mãe e o nascimento dele já estão lá (corrija-os em "Corrigir dados do animal", se preciso).');
        return;
      }
      // No parto antigo, o animal do cadastro nascido no mesmo dia e sem mãe informada pode ser o próprio bezerro: o dono
      // confirma (o aviso de lançamento possivelmente repetido) antes de pôr uma cria nova.
      var parecido = hist ? m.repo.vigentes('ANIMAIS').filter(function (a) { return a.data_nascimento === ev.event_date && vazio_(a.mae_id) && !criaDeParto_(m, a.animal_id); })[0] : null;
      if (parecido) avisoItem_(m, it, 'POSSIVEL_DUPLICIDADE', it.quem + ': ' + (vazio_(parecido.brinco) ? parecido.codigo_interno : parecido.codigo_interno + ' (brinco ' + parecido.brinco + ')') + ' já está no cadastro, nascido em ' + br_(ev.event_date) + ' e sem a mãe informada. Se ele for a cria deste parto, não lance o parto: informe a mãe dele em "Corrigir dados do animal". Gravar uma cria nova mesmo assim?');
    }
    // A raça vazia é a da mãe; na correção, a da cria no original enquanto a mãe é a mesma (Correcao.congelado).
    var racaCong = vazio_(d.raca) && reuso ? Correcao.congelado(ctxEv.correcao, 'NASCIMENTO.raca_cria', { mae_id: mat ? mat.animal_id : null, animal_id: d.animal_id }) : null;
    var raca = !vazio_(d.raca) ? d.raca : racaCong ? racaCong.v : mat && mat.estado ? nulo_(mat.estado.raca) : null;
    it.racaInformada = !vazio_(d.raca);
    it.novo = !reuso;
    it.reusado = reuso;
    if (reuso) {
      var ex = m.f.animal(d.animal_id);
      it.animal_id = d.animal_id;
      it.publico = true;
      it.codigo_interno = ex.codigo_interno;
      var cad = {};
      if (!vazio_(d.nome) && d.nome !== ex.nome) cad.nome = d.nome;
      if (racaMudou_(ctxEv, d.animal_id, raca) && raca !== ex.raca) cad.raca = raca;
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
    // Cria do original (correção do parto): o sexo corrigido depois do parto continua valendo.
    if (reuso) it.final.sexo = corrigidoDepois_(m, it.animal_id, 'sexo', it.final.sexo);
    // O pai da cria nascida na fazenda é o do parto (RELATORIO_FASE2, decisão 5; 06, seção 9): o pai posto na cria por
    // correção de cadastro (aceita enquanto o parto não dizia o pai) continuaria valendo por cima do que o parto passa a
    // dizer. O dono decide qual vale: estorna essa correção ou deixa o pai do parto igual a ela.
    if (reuso && !vazio_(c.pai_id)) {
      var paiNaCria = corrigidoDepois_(m, it.animal_id, 'pai_id', undefined);
      if (paiNaCria !== undefined && paiNaCria !== c.pai_id) {
        var corPai = ultimaCorrecaoCampo_(m, it.animal_id, 'pai_id', 'PAI_DA_CRIA');
        var nomePai = paiNaCria ? nomeAnimal_(existente_(m, paiNaCria)) : null;
        conflito_(m, it, corPai, 'a correção de cadastro de ' + br_(corPai.event_date) + ' ' + (nomePai ? 'pôs ' + nomePai + ' como pai da cria' : 'tirou o pai da cria') + ', e ela continuaria valendo por cima do pai que o parto passa a informar. Estorne essa correção antes ou informe no parto o mesmo pai.');
      }
    }
    var ea = { papel: 'CRIA', efeito_inventario: hist ? 0 : 1, pasto_destino_id: nulo_(pasto), atributos_iniciais_json: at, observacoes: nulo_(d.observacoes) };
    if (typeof d.peso === 'number') ea.peso = d.peso;
    linhaEA_(m, ctxEv, it, ea);
    identificacoes_(m, ctxEv, it);
    if (typeof d.peso === 'number' && !vazio_(d.metodo_pesagem)) {
      ctxEv.plano.PESAGENS.push({ weight_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ev.event_id, data_pesagem: ev.event_date, peso_kg: d.peso, metodo: d.metodo_pesagem, tipo: 'NASCIMENTO', observacoes: null });
    }
  }
  /**
   * O filho da mãe, nascido na data, que está no cadastro sem ter vindo de parto (sem linha CRIA vigente): o animal da
   * fotografia, da compra ou da outra entrada com essa mãe e esse nascimento. null se não há.
   */
  function filhoSemParto_(m, maeId, data) {
    return m.repo.por('ANIMAIS', 'mae_id', maeId).filter(function (a) { return a.data_nascimento === data && !criaDeParto_(m, a.animal_id); })[0] || null;
  }
  /** O animal veio de um parto registrado (tem linha CRIA vigente). */
  function criaDeParto_(m, id) {
    return m.repo.por('EVENTO_ANIMAIS', 'animal_id', id).some(function (l) { return l.papel === 'CRIA'; });
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
    apontarExistente_(m, it);
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
      if (cat.ativo === false && !usadoNoOriginal_(m, cat.category_id)) { erroItem_(m, it, 'categoria_manual_id', 'CATEGORIA_INATIVA', 'a categoria ' + cat.nome + ' está desativada.'); return; }
      if (cat.sexo_aplicavel !== 'AMBOS' && cat.sexo_aplicavel !== e.sexo) { erroItem_(m, it, 'categoria_manual_id', 'CATEGORIA_INCOMPATIVEL', 'a categoria ' + cat.nome + ' é só de ' + (cat.sexo_aplicavel === 'M' ? 'machos' : 'fêmeas') + '.'); return; }
    }
    if (!Utils.dataValida(ctxEv.ev.event_date)) return;
    // Na correção do mesmo ajuste, o valor de antes é o que o original gravou (Correcao.congelado): o estado mudado depois não
    // o refaz nem o torna VALOR_IGUAL.
    var antCong = Correcao.congelado(ctxEv.correcao, 'AJUSTE.valor_anterior', { animal_id: it.animal_id, campo: 'categoria_manual_id', valor_novo: nova, data: ctxEv.ev.event_date });
    var antes = antCong ? antCong.v : reclassificacaoAntes_(m, it.animal_id, posicao_(ctxEv.ev));
    if (antes === nova && !antCong) {
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
      // A data de chegada que se corrige é a declarada no rebanho inicial, mesmo depois de uma volta ao rebanho.
      var chegada = Timeline.chegadaDeclarada(m.f, it.animal_id);
      var estado = {};
      Object.keys(e).forEach(function (k) { estado[k] = e[k]; });
      estado.data_entrada = chegada.data;
      estado.data_entrada_confianca = chegada.confianca;
      e = estado;
      g = grupo[it.animal_id] = { it: it, campos: {}, estado: e };
      it.final = { sexo: e.sexo, data_nascimento: e.data_nascimento, data_entrada: e.data_entrada, mudouSexo: false, mudouNascimento: false, mudouEntrada: false };
      it.parentesco = null;
      linhaEA_(m, ctxEv, it, { efeito_inventario: 0 });
    } else it.ignorarNaLinhaDoTempo = true;
    e = g.estado;
    if (g.campos[campo] !== undefined) { erroItem_(m, it, 'campo', 'CAMPO_REPETIDO', '"' + def.rotulo + '" aparece duas vezes para o mesmo animal: corrija cada dado uma vez só.'); return; }
    // Cria nascida na fazenda: mãe, nascimento, origem e o pai informado no parto são do parto (04, seção 4.2); corrigir
    // só a cria deixaria o parto, a cria ao pé e a reprodução da mãe apontando para outro animal.
    var parto = partoDaCria_(m, e);
    if (parto && (CAMPOS_DO_PARTO[campo] || ((campo === 'pai_id' || campo === 'pai_confianca') && parto.informaPai))) {
      erroItem_(m, it, 'campo', 'NAO_SE_APLICA', CAMPOS_DO_PARTO[campo] ? CAMPOS_DO_PARTO[campo] + ' de uma cria nascida na fazenda é ' + (campo === 'origem' ? 'NASCIDO' : 'a do parto') + ' de ' + br_(parto.ev.event_date) + '. Corrija o parto (evento de nascimento) em vez da cria.'
        : 'o pai de uma cria nascida na fazenda é o informado no parto de ' + br_(parto.ev.event_date) + '. Corrija o parto (evento de nascimento) em vez da cria.');
      return;
    }
    var texto = vazio_(it.dados.valor_novo) ? null : Utils.aparar(String(it.dados.valor_novo));
    var valor = valorCorrigido_(m, it, campo, def, texto);
    if (valor === undefined) return;
    var atual = e[campo] === undefined ? null : e[campo];
    var antCong = Correcao.congelado(ctxEv.correcao, 'AJUSTE.valor_anterior', { animal_id: it.animal_id, campo: campo, valor_novo: textoCampo_(campo, valor), data: ctxEv.ev.event_date });
    if (!antCong && textoCampo_(campo, atual) === textoCampo_(campo, valor)) { erroItem_(m, it, 'valor_novo', 'VALOR_IGUAL', 'o valor informado em "' + def.rotulo + '" já é o que está no cadastro.'); return; }
    g.campos[campo] = valor;
    ajusteRow_(m, ctxEv, it, campo, antCong ? antCong.v : textoCampo_(campo, atual), textoCampo_(campo, valor));
    var princ = g.it;
    if (campo === 'sexo') { princ.final.sexo = valor; princ.final.mudouSexo = true; }
    if (campo === 'data_nascimento') { princ.final.data_nascimento = valor; princ.final.mudouNascimento = true; }
    if (campo === 'data_entrada') { princ.final.data_entrada = valor; princ.final.mudouEntrada = true; }
    if (campo === 'mae_id' || campo === 'pai_id') {
      princ.parentesco = princ.parentesco || { mae_id: e.mae_id, pai_id: e.pai_id, mudouMae: false, mudouPai: false };
      princ.parentesco[campo] = valor;
      princ.parentesco[campo === 'mae_id' ? 'mudouMae' : 'mudouPai'] = true;
    }
  }
  /** Campos que o parto define na cria (04, seção 4.2; a checagem PARTOS os confere) e como cada um aparece na mensagem. */
  var CAMPOS_DO_PARTO = { mae_id: 'a mãe', mae_confianca: 'a mãe', data_nascimento: 'o nascimento', data_nascimento_confianca: 'o nascimento', origem: 'a origem' };
  /** O parto que criou o animal ({ev, informaPai}), se ele nasceu por evento NASCIMENTO vigente; senão null. */
  function partoDaCria_(m, e) {
    if (!e || vazio_(e.evento_origem_id)) return null;
    var ev = m.f.evento(e.evento_origem_id);
    if (!ev || ev.event_type !== 'NASCIMENTO') return null;
    var rep = m.repo.por('REPRODUCAO', 'event_id', ev.event_id).filter(function (r) { return r.tipo_evento === 'PARTO'; })[0];
    return { ev: ev, informaPai: !!rep && !vazio_(rep.touro_id) };
  }
  /** valor_novo (texto canônico) → valor do tipo do campo; undefined = inválido (erro já anotado). */
  function valorCorrigido_(m, it, campo, def, texto) {
    if (texto === null) {
      if (campo === 'sexo' || campo === 'origem' || campo === 'castrado' || campo === 'reprodutor') { erroItem_(m, it, 'valor_novo', 'CAMPO_OBRIGATORIO', 'informe o valor correto de "' + def.rotulo + '".'); return undefined; }
      return null;
    }
    if (def.tipo === 'data' && !Utils.dataValida(texto)) { erroItem_(m, it, 'valor_novo', 'FORMATO_INVALIDO', '"' + texto + '" não é uma data válida (aaaa-mm-dd).'); return undefined; }
    if (def.tipo === 'data' && texto > m.hoje) { erroItem_(m, it, 'valor_novo', 'DATA_FUTURA', 'a data ' + br_(texto) + ' ainda não chegou.'); return undefined; }
    if (def.tipo === 'lista' && def.opcoes.indexOf(texto) < 0) { erroItem_(m, it, 'valor_novo', 'VALOR_FORA_DA_LISTA', '"' + texto + '" não é uma opção de "' + def.rotulo + '".'); return undefined; }
    if (def.tipo === 'bool') {
      if (texto !== 'S' && texto !== 'N') { erroItem_(m, it, 'valor_novo', 'VALOR_FORA_DA_LISTA', 'escolha sim ou não em "' + def.rotulo + '".'); return undefined; }
      return texto === 'S';
    }
    if (def.tipo === 'inteiro') {
      if (!/^\d+$/.test(texto) || Number(texto) > def.max) { erroItem_(m, it, 'valor_novo', 'VALOR_FORA_DA_FAIXA', '"' + def.rotulo + '" precisa ser um número inteiro de ' + def.min + ' a ' + def.max + '.'); return undefined; }
      return Number(texto);
    }
    return texto;
  }
  /** O dado e a certeza dele (a mãe, o pai, o nascimento), nas palavras do pecuarista. */
  var PAR_CERTEZA = {
    mae_id: { falta: 'diga também se a mãe é confirmada ou estimada.', semCerteza: 'a mãe não fica sem a certeza: diga se ela é confirmada ou estimada, ou apague também a mãe.', semDado: 'a certeza da mãe precisa da mãe: informe a mãe ou deixe a certeza em branco.' },
    pai_id: { falta: 'diga também se o pai é confirmado ou estimado.', semCerteza: 'o pai não fica sem a certeza: diga se ele é confirmado ou estimado, ou apague também o pai.', semDado: 'a certeza do pai precisa do pai: informe o pai ou deixe a certeza em branco.' },
    data_nascimento: { falta: 'diga também se a data de nascimento é confirmada ou estimada.', semCerteza: 'a data de nascimento não fica sem a certeza: diga se ela é confirmada ou estimada, ou apague também a data.', semDado: 'a certeza do nascimento precisa da data de nascimento: informe a data ou deixe a certeza em branco.' },
  };
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
      // As regras entre campos são conferidas com o cadastro de hoje (com as correções de cadastro posteriores). Na correção do
      // mesmo ajuste — cada campo que o comando corrige neste animal é um que o original corrigiu, com o mesmo valor e na mesma
      // data —, valem como o original as cumpria: a correção posterior (o sexo, a certeza, o nascimento) não recusa a correção
      // sem mudança dele (Correcao.congelado).
      var doOriginal = function (campo) { return g.campos[campo] !== undefined && !!Correcao.congelado(ctxEv.correcao, 'AJUSTE.valor_anterior', { animal_id: id, campo: campo, valor_novo: textoCampo_(campo, g.campos[campo]), data: ctxEv.ev.event_date }); };
      var corrigidos = Object.keys(g.campos);
      var mesmoAjuste = corrigidos.length > 0 && corrigidos.every(doOriginal);
      if (!mesmoAjuste && fim.sexo === 'F' && (g.campos.castrado !== undefined || g.campos.reprodutor !== undefined)) erroItem_(m, it, 'campo', 'NAO_SE_APLICA', 'castrado e reprodutor só se aplicam a machos.');
      if (!mesmoAjuste && fim.sexo === 'M' && g.campos.partos_previos !== undefined) erroItem_(m, it, 'campo', 'NAO_SE_APLICA', 'partos anteriores só se aplicam a fêmeas.');
      if (!mesmoAjuste && fim.sexo === 'M' && fim.castrado === true && fim.reprodutor === true && (g.campos.castrado !== undefined || g.campos.reprodutor !== undefined)) erroItem_(m, it, 'campo', 'CASTRADO_REPRODUTOR', 'animal castrado não pode ser reprodutor.');
      // Apagar a mãe, o pai ou uma data apaga também a confiança (que deixaria de ter a que se referir).
      [['mae_id', 'mae_confianca'], ['pai_id', 'pai_confianca'], ['data_nascimento', 'data_nascimento_confianca']].forEach(function (par) {
        // Na correção do mesmo ajuste, a confiança que o original apagou junto continua apagada com o valor de antes que ele
        // gravou, mesmo que o cadastro de hoje já não a tenha (Correcao.congelado).
        var confCong = g.campos[par[0]] === null && g.campos[par[1]] === undefined ? Correcao.congelado(ctxEv.correcao, 'AJUSTE.valor_anterior', { animal_id: id, campo: par[1], valor_novo: null, data: ctxEv.ev.event_date }) : null;
        if (g.campos[par[0]] === null && g.campos[par[1]] === undefined && (confCong || !vazio_(e[par[1]]))) {
          ajusteRow_(m, ctxEv, it, par[1], confCong ? confCong.v : textoCampo_(par[1], e[par[1]]), null);
          fim[par[1]] = null;
        }
        // O par (o dado e a certeza dele), também: a correção de cadastro posterior que apagou a certeza (ou o dado) não recusa a
        // correção sem mudança do original.
        // As mensagens em português do pecuarista, com o conselho que leva à solução (sem o nome da coluna).
        var txt = PAR_CERTEZA[par[0]];
        if (!vazio_(fim[par[0]]) && vazio_(fim[par[1]]) && !(g.campos[par[1]] === undefined && doOriginal(par[0]))) erroItem_(m, it, par[1], 'CAMPO_OBRIGATORIO', g.campos[par[1]] === null ? txt.semCerteza : txt.falta);
        if (vazio_(fim[par[0]]) && !vazio_(g.campos[par[1]]) && !(g.campos[par[0]] === undefined && doOriginal(par[1]))) erroItem_(m, it, par[1], 'CAMPO_SEM_VINCULO', txt.semDado);
      });
      if (g.campos.data_entrada !== undefined || g.campos.data_entrada_confianca !== undefined) {
        var entrada = Timeline.ordenar(m.f.linhas(id).filter(function (l) { return l.efeito === 1 && !l.pre_marco_zero; }))[0];
        if (!entrada || entrada.event_type !== 'ENTRADA_INICIAL') erroItem_(m, it, 'campo', 'NAO_SE_APLICA', 'a data de chegada só se corrige em animal do rebanho inicial; nos demais ela é a data do lançamento de entrada.');
        else if (!vazio_(fim.data_entrada) && fim.data_entrada > m.D0) erroItem_(m, it, 'valor_novo', 'ENTRADA_DEPOIS_DO_MARCO_ZERO', 'a chegada na fazenda não pode ser depois do marco zero (' + br_(m.D0) + ').');
      }
      if (!mesmoAjuste && !vazio_(fim.data_nascimento) && !vazio_(fim.data_entrada) && fim.data_entrada < fim.data_nascimento) erroItem_(m, it, 'valor_novo', 'ENTRADA_ANTES_DO_NASCIMENTO', 'a chegada na fazenda (' + br_(fim.data_entrada) + ') ficaria antes do nascimento (' + br_(fim.data_nascimento) + ').');
    });
  }
  function identificacaoIncorreta_(m, ctxEv, it, e) {
    var novo = it.dados.brinco;
    if (vazio_(novo)) return;
    var codigo = Utils.aparar(novo);
    // Na correção do mesmo ajuste (o mesmo animal, o mesmo número novo, a mesma data), o número trocado é o que o original
    // gravou (Correcao.congelado), e as conferências pelo brinco de hoje — sem brinco, o mesmo número, o brinco lançado depois
    // do ajuste — não se aplicam: a troca posterior do brinco não desfaz o acerto daquele dia (a verificação de integridade
    // confere o número trocado contra o brinco em uso na data).
    var antCong = Correcao.congelado(ctxEv.correcao, 'AJUSTE.valor_anterior', { animal_id: it.animal_id, campo: 'brinco', valor_novo: codigo, data: ctxEv.ev.event_date });
    if (!antCong) {
      if (vazio_(e.brinco)) { erroItem_(m, it, 'brinco', 'SEM_BRINCO', 'o animal não tem brinco para corrigir; o primeiro brinco é colocado pelo lançamento de identificação.'); return; }
      if (Utils.normalizarBrinco(codigo) === e.brinco_norm) { erroItem_(m, it, 'brinco', 'VALOR_IGUAL', 'o brinco informado é o mesmo que já está no cadastro.'); return; }
      var aberta = m.f.identificacoes(it.animal_id).filter(function (r) { return r.tipo === 'BRINCO' && r.codigo_norm === e.brinco_norm; });
      // A correção vem depois do lançamento do brinco que está no cadastro, na ordem canônica: no mesmo dia, pela posição
      // (o substituto fica no lugar do original, desenho-base 16.1; antes de uma troca do mesmo dia, ele corrigiria um
      // número que a troca ainda não tinha posto, e a troca continuaria valendo depois dele).
      var pos = posicao_(ctxEv.ev);
      var antes = aberta.some(function (r) {
        var evr = m.f.evento(r.event_id);
        return antesDe_(pos, { data: r.data_inicio, ordem_seq: evr ? m.f.ordemSeq(r.event_id) : 0, event_seq: evr ? evr.event_seq : 0 });
      });
      if (antes) { erroItem_(m, it, 'brinco', 'ANTES_DA_IDENTIFICACAO', 'a correção precisa vir depois do lançamento do brinco ' + e.brinco + ', que está no cadastro desde ' + br_(aberta[0].data_inicio) + '.'); return; }
    }
    linhaEA_(m, ctxEv, it, { efeito_inventario: 0 });
    ajusteRow_(m, ctxEv, it, 'brinco', antCong ? antCong.v : e.brinco, codigo);
    it.brincoTexto = codigo;
    it.brincoLibera = true;
    it.brincoProposto = { codigo: codigo, norm: Utils.normalizarBrinco(codigo) };
    ctxEv.plano.IDENTIFICACOES.push({ ident_id: m.tx.novoId(), animal_id: it.animal_id, event_id: ctxEv.ev.event_id, tipo: 'BRINCO', codigo: codigo, codigo_norm: it.brincoProposto.norm, data_inicio: ctxEv.ev.event_date, motivo: null, created_at: m.tx.agora });
    it.quem = nomeAnimal_(e) + ' (novo brinco ' + codigo + ')';
  }
  /**
   * Onde o animal está na posição de uma linha de movimento do comando no dia (desenho-base 16.1): depois das entradas
   * do dia e dos movimentos do dia que vêm antes dela na ordem canônica; as saídas do dia vêm depois. O substituto fica
   * no lugar do original: a origem dele é a de antes do original, não a do fim do dia.
   */
  function pastoNaPosicao_(m, animalId, ev) {
    var pos = posicao_(ev);
    var antes = m.f.linhas(animalId).filter(function (l) {
      if (l.event_date !== ev.event_date) return l.event_date < ev.event_date;
      var c = Timeline.classe(l);
      return c === 0 || (c === 1 && antesDe_({ data: l.event_date, ordem_seq: l.ordem_seq, event_seq: l.event_seq }, pos));
    });
    return Timeline.pastoEm(antes, ev.event_date, m.D0);
  }
  function correcaoLocalizacao_(m, ctxEv, it, e) {
    var d = it.dados;
    var data = ctxEv.ev.event_date;
    if (vazio_(d.pasto_destino_id) || !Utils.dataValida(data)) return;
    var onde = pastoNaPosicao_(m, it.animal_id, ctxEv.ev);
    if (!onde.presente) { erroItem_(m, it, 'animal_id', 'FORA_DO_REBANHO', 'em ' + br_(data) + ' o animal não estava no rebanho.'); return; }
    var origem = onde.pasture_id;
    if (!vazio_(d.pasto_origem_id) && d.pasto_origem_id !== origem) {
      erroItem_(m, it, 'pasto_origem_id', 'ORIGEM_DIVERGENTE', 'em ' + br_(data) + ' o sistema registrava o animal no pasto ' + nomePasto_(m, origem) + ', não no ' + nomePasto_(m, d.pasto_origem_id) + '. Confira a origem ou tire o animal da lista.');
      return;
    }
    var antCong = Correcao.congelado(ctxEv.correcao, 'AJUSTE.valor_anterior', { animal_id: it.animal_id, campo: 'pasto_atual_id', valor_novo: d.pasto_destino_id, data: data });
    if (!antCong && d.pasto_destino_id === origem) { erroItem_(m, it, 'pasto_destino_id', 'VALOR_IGUAL', 'o animal já está registrado no pasto ' + nomePasto_(m, origem) + '.'); return; }
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
    // O número que a correção de brinco lançado errado DESTE lançamento tira de um animal (no substituto, o número que o
    // original já tinha tirado e que a projeção gravada mostra encerrado): não é reuso (passada 4 do teste aleatório).
    var acertados = {};
    ctxEv.itens.forEach(function (it) {
      if (!it.publico || !it.brincoLibera) return;
      var e = estado_(m, it.animal_id);
      if (e && !vazio_(e.brinco)) (acertados[it.animal_id] = acertados[it.animal_id] || []).push(Utils.normalizarBrinco(e.brinco));
    });
    ctxEv.itens.forEach(function (it) {
      if (!it.publico || !it.brincoProposto || it.brincoLibera) return;
      var e = estado_(m, it.animal_id);
      if (e && !vazio_(e.brinco) && chave(e.brinco) !== chave(it.brincoProposto.codigo)) saem[chave(e.brinco)] = it;
    });
    // Na correção, o brinco que o original já dava ao mesmo animal não é proposta nova (RN-045: corrigir só valores nunca é
    // bloqueado; Correcao.congelado): as regras do número que só o parâmetro de hoje quebraria (só números, reuso desligado)
    // não o recusam; o número pode ter sido acertado depois (brinco lançado errado, desenho-base 16.2) ou trocado e
    // reaproveitado por outro animal; se a nova data o deixaria em dois animais, conferirPeriodosDeBrinco_ acusa.
    var noEvento = {};
    propostos.forEach(function (it) {
      var b = it.brincoProposto;
      var mantido = !!it.animal_id && !!Correcao.congelado(ctxEv.correcao, 'IDENTIFICACAO.brinco', { animal_id: it.animal_id, codigo: b.codigo, chave: chave });
      if (!mantido && m.params.brinco_somente_numerico === true && !/^\d+$/.test(b.codigo.replace(/\s+/g, ''))) {
        erroItem_(m, it, 'brinco', 'BRINCO_NAO_NUMERICO', 'o brinco precisa ter só números.');
        return;
      }
      var k = chave(b.codigo);
      if (noEvento[k]) { erroItem_(m, it, 'brinco', 'BRINCO_REPETIDO', 'o brinco ' + b.codigo + ' aparece mais de uma vez neste lançamento.'); return; }
      noEvento[k] = it;
      if (mantido) return;
      var dono = ocupados[k];
      // A cria com o brinco de um animal que já está no cadastro, nascido no dia do parto e sem parto registrado: é o
      // bezerro da fotografia (ou da compra) cujo parto se lança agora, e a cria seria ele duas vezes.
      if (dono && it.cria && dono.data_nascimento === ctxEv.ev.event_date && !criaDeParto_(m, dono.animal_id)) {
        erroItem_(m, it, 'brinco', 'CRIA_JA_NO_CADASTRO', 'o brinco ' + b.codigo + ' é de ' + dono.codigo_interno + ', que já está no cadastro, nascido em ' + br_(dono.data_nascimento) + ', sem parto registrado. A cria de um parto é sempre um animal novo, então ele ficaria duas vezes no rebanho: o parto de um animal que já está no cadastro não se lança (a mãe e o nascimento dele ficam no cadastro; corrija-os em "Corrigir dados do animal", se preciso).');
        return;
      }
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
      reusoDeBrinco_(m, it, b, chave, acertados);
    });
  }
  /**
   * Um número fica em um animal por vez (05, seção 4.1; RN-002 e RN-004, com o reuso ligado só de período JÁ ENCERRADO):
   * com as linhas de brinco do comando no lugar (o substituto no lugar do original), cada período de uso de um número
   * que começa ou termina numa linha do comando — a primeira identificação, a troca, a retirada, a entrada com brinco,
   * a correção de brinco, a correção que muda a data de qualquer delas — não pode cruzar o período de outro animal com o
   * mesmo número. O número corrigido por IDENTIFICACAO_INCORRETA não conta (desenho-base 16.2). CONFLICT com o registro
   * do outro animal: a troca que fecha o período dele, ou a linha que lhe deu o número.
   */
  function conferirPeriodosDeBrinco_(m, ctxEv, extras, verboRestauracao) {
    var plano = ctxEv ? ctxEv.plano.IDENTIFICACOES.filter(function (r) { return r.tipo === 'BRINCO' && !vazio_(r.codigo); }) : [];
    var doPlano = Utils.agruparPor(plano, 'animal_id');
    // Animais cujos períodos podem mudar: os que recebem linha de brinco do comando e os que o evento anulado tocava
    // (o estorno, a correção que tira a linha de brinco do original, o desfazer de uma importação: RN-040, RN-045).
    var alvos = Utils.unicos(Object.keys(doPlano).concat(extras || []));
    if (!alvos.length) return;
    var semZeros = m.params.brinco_ignora_zeros_esquerda !== false;
    var chave = function (c) { return Utils.normalizarBrinco(String(c), !semZeros); };
    var ajustesDoPlano = ctxEv ? ctxEv.plano.AJUSTES : [];
    function errados(fonte, comPlano, id) {
      var out = {};
      fonte.ajustes(id).concat(comPlano ? ajustesDoPlano.filter(function (a) { return a.animal_id === id; }) : []).forEach(function (a) {
        if (a.tipo_ajuste === 'IDENTIFICACAO_INCORRETA' && a.campo === 'brinco' && !vazio_(a.valor_anterior)) out[chave(a.valor_anterior)] = true;
      });
      return out;
    }
    // Períodos de cada número no animal: [{k, codigo, inicio, fim (null = em uso), linha, fecha}]. "Depois" = sem o evento
    // anulado e com as linhas do comando; "antes" = o que está gravado.
    function calcular(fonte, comPlano, id) {
      var seq = Timeline.identificacoes(fonte, id).filter(function (x) { return x.tipo === 'BRINCO'; })
        .concat(comPlano ? (doPlano[id] || []).map(function (r) { return Timeline.linhaIdentificacao(r, ctxEv.ev, ctxEv.ev.ordem_seq); }) : [])
        .sort(function (a, b) { return (a.data_inicio < b.data_inicio ? -1 : a.data_inicio > b.data_inicio ? 1 : 0) || (a.ordem_seq - b.ordem_seq) || (a.event_seq - b.event_seq); });
      var err = errados(fonte, comPlano, id);
      var out = [];
      seq.forEach(function (x, i) {
        if (x.remocao) return;
        var prox = seq[i + 1] || null;
        var k = chave(x.codigo);
        if (err[k] === true || (prox && prox.data_inicio <= x.data_inicio)) return;
        out.push({ k: k, codigo: x.codigo, inicio: x.data_inicio, fim: prox ? prox.data_inicio : null, linha: x, fecha: prox });
      });
      return out;
    }
    var memo = {};
    function periodos(id) { return memo[id] || (memo[id] = calcular(m.f, true, id)); }
    var assinatura = function (p) { return p.k + '|' + p.inicio + '|' + (p.fim || ''); };
    var cruza = function (a, b) { return (b.fim === null || a.inicio < b.fim) && (a.fim === null || b.inicio < a.fim); };
    var verbo = verboRestauracao || (ctxEv && ctxEv.original ? 'a correção' : 'o lançamento');
    var citados = {};
    alvos.forEach(function (id) {
      // Animal que o comando anula (criado pelo evento que sai) não fica com número nenhum; o que recebe linha do comando conta.
      var eu = estado_(m, id);
      if (!doPlano[id] && (!eu || eu.situacao_cadastral === 'ANULADO' || eu.situacao_cadastral === 'PENDENTE')) return;
      var gravados = {};
      calcular(m.real, false, id).forEach(function (p) { gravados[assinatura(p)] = true; });
      periodos(id).forEach(function (a) {
        // Período que começa ou termina numa linha do comando, ou que o evento anulado mudou (não está gravado assim).
        var meu = function (x) { return !!ctxEv && !!x && x.event_id === ctxEv.ev.event_id; };
        if (!meu(a.linha) && !meu(a.fecha) && gravados[assinatura(a)]) return;
        var outros = Utils.unicos(m.repo.por('IDENTIFICACOES', 'codigo_norm', Utils.normalizarBrinco(a.codigo)).map(function (r) { return r.animal_id; })
          .concat(plano.filter(function (r) { return chave(r.codigo) === a.k; }).map(function (r) { return r.animal_id; })));
        outros.forEach(function (oid) {
          if (oid === id) return;
          var o = estado_(m, oid);
          if (!o || (!doPlano[oid] && (o.situacao_cadastral === 'ANULADO' || o.situacao_cadastral === 'PENDENTE'))) return;
          // Reuso desligado (RN-004): o período que o comando devolve ao animal sem linha própria (o estorno, a correção que
          // tira a linha do original, o desfazer) não pode ter um número que outro animal usou em qualquer época — a mesma
          // regra do registro (reusoDeBrinco_), descontado o número corrigido por "brinco lançado errado" (desenho-base 16.2).
          if (m.params.brinco_permite_reuso !== true && !meu(a.linha) && !meu(a.fecha)) {
            var usado = periodos(oid).filter(function (b) { return b.k === a.k && !cruza(a, b); })[0];
            if (usado && !citados[id + '|REUSO|' + oid]) {
              citados[id + '|REUSO|' + oid] = true;
              var evu = usado.inicio > a.inicio ? usado.linha : (usado.fecha || usado.linha);
              var outroU = nomeAnimal_(o) + ' (' + o.codigo_interno + ')';
              var quando = usado.inicio > a.inicio ? 'desde ' + br_(usado.inicio) + ' ele é do animal ' + outroU : 'ele foi do animal ' + outroU + ' até ' + br_(usado.fim);
              conflito_(m, itemDoAnimal_(m, ctxEv, id), { codigo: 'BRINCO_APOSENTADO', event_id: evu.event_id, event_type: evu.event_type, event_subtype: evu.event_subtype, event_date: evu.data_inicio },
                verbo + ' devolveria ao animal o brinco ' + a.codigo + ', mas ' + quando + ', e o reuso de brinco está desligado nas configurações. Corrija ou estorne antes o registro do outro animal.');
            }
          }
          periodos(oid).filter(function (b) { return b.k === a.k && cruza(a, b); }).forEach(function (b) {
            var ev = b.inicio > a.inicio ? b.linha : (b.fecha || b.linha);
            // Um conflito por par de animais e registro (os dois animais tocados pelo mesmo comando não se repetem).
            if (citados[id + '|' + ev.event_id] || citados[oid + '|' + ev.event_id] || jaCitado_(m, id, 'BRINCO_DUPLICADO', ev.event_id)) return;
            citados[id + '|' + ev.event_id] = true;
            var outro = nomeAnimal_(o) + ' (' + o.codigo_interno + ')';
            var texto;
            if (verboRestauracao) {
              texto = b.inicio > a.inicio
                ? verbo + ' devolveria ao animal o brinco ' + a.codigo + (a.fim ? ' até ' + br_(a.fim) : ' desde ' + br_(a.inicio)) + ', mas desde ' + br_(b.inicio) + ' ele é do animal ' + outro + '.'
                : verbo + ' devolveria ao animal o brinco ' + a.codigo + ' desde ' + br_(a.inicio) + ', mas nessa data ele era do animal ' + outro + (b.fim ? ', até ' + br_(b.fim) : '') + '.';
              texto += ' Um número fica em um animal por vez: corrija ou estorne antes o registro do outro animal.';
            } else {
              texto = b.inicio > a.inicio
                ? verbo + ' deixaria o brinco ' + a.codigo + ' no animal ' + (a.fim ? 'até ' + br_(a.fim) : 'desde ' + br_(a.inicio)) + ', mas desde ' + br_(b.inicio) + ' ele é do animal ' + outro + '.'
                : verbo + ' daria ao animal o brinco ' + a.codigo + ' em ' + br_(a.inicio) + ', mas nessa data ele era do animal ' + outro + (b.fim ? ', até ' + br_(b.fim) : '') + '.';
              texto += ' Um número fica em um animal por vez: mude a data deste lançamento ou corrija o registro do outro animal antes.';
            }
            conflito_(m, itemDoAnimal_(m, ctxEv, id), { codigo: 'BRINCO_DUPLICADO', event_id: ev.event_id, event_type: ev.event_type, event_subtype: ev.event_subtype, event_date: ev.data_inicio }, texto);
          });
        });
      });
    });
  }
  /** O comando já tem um conflito com esse código, desse animal, com esse registro (uma causa, um conflito). */
  function jaCitado_(m, animalId, codigo, eventId) {
    return m.conflitos.some(function (c) { return c.animal_id === animalId && c.codigo === codigo && c.conflito && c.conflito.event_id === eventId; });
  }
  function reusoDeBrinco_(m, it, b, chave, acertados) {
    if (m.params.brinco_permite_reuso === true) return;
    var corrigidos = {};
    var aposentado = m.repo.por('IDENTIFICACOES', 'codigo_norm', b.norm).filter(function (r) {
      if (r.tipo !== 'BRINCO' || r.animal_id === it.animal_id || vazio_(r.data_fim) || m.f.excluidos[r.event_id]) return false;
      if (chave(r.codigo) !== chave(b.codigo)) return false;
      if (!(r.animal_id in corrigidos)) {
        corrigidos[r.animal_id] = m.f.ajustes(r.animal_id).filter(function (a) { return a.tipo_ajuste === 'IDENTIFICACAO_INCORRETA' && a.campo === 'brinco'; })
          .map(function (a) { return Utils.normalizarBrinco(a.valor_anterior || ''); }).concat((acertados || {})[r.animal_id] || []);
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
      // Correção do lançamento que criou o animal: a mãe e o pai do conjunto final são os do substituto com as correções de
      // cadastro que continuam valendo (RN-045), e é com eles que as regras de genealogia (RN-007 a RN-010) se conferem.
      if (it.reusado) {
        it.genealogia = { mae_id: corrigidoDepois_(m, it.animal_id, 'mae_id', it.genealogia.mae_id), pai_id: corrigidoDepois_(m, it.animal_id, 'pai_id', it.genealogia.pai_id) };
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
          var art = cfg[0] === 'mae_id' ? 'a ' : 'o ';
          erroItem_(m, it, cfg[0], 'NASCIMENTO_DO_PROGENITOR', art + cfg[2] + ' ' + nomeDe(pid) + ' nasceu em ' + br_(np) + ', não antes do animal (' + br_(nf) + '). Confira ' + art + cfg[2] + ' ou as datas.');
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
    // RN-009: o nascimento corrigido do próprio animal fica depois do nascimento da mãe e do pai que ele já tem (a mãe
    // ou o pai que o comando muda já foram conferidos acima).
    itens.forEach(function (it) {
      if (it.novo || it.reusado || !it.final || !it.final.mudouNascimento) return;
      var nf = nascDe(it.animal_id);
      if (vazio_(nf)) return;
      [['mae_id', 'mudouMae', 'a mãe'], ['pai_id', 'mudouPai', 'o pai']].forEach(function (cfg) {
        if (it.parentesco && it.parentesco[cfg[1]]) return;
        var pid = cfg[0] === 'mae_id' ? maeDe(it.animal_id) : paiDe(it.animal_id);
        var np = vazio_(pid) ? null : nascDe(pid);
        if (!vazio_(np) && np >= nf) erroItem_(m, it, 'valor_novo', 'NASCIMENTO_DO_PROGENITOR', 'o animal ficaria nascido em ' + br_(nf) + ', mas ' + cfg[2] + ' dele, ' + nomeDe(pid) + ', nasceu em ' + br_(np) + '. O filho nasce depois dos pais: confira as datas ou ' + cfg[2] + '.');
      });
    });
    // RN-012: corrigir sexo ou nascimento de quem já é mãe ou pai.
    itens.forEach(function (it) {
      if (it.novo || !it.final || (!it.final.mudouSexo && !it.final.mudouNascimento)) return;
      var filhos = Utils.unicos(m.repo.por('ANIMAIS', 'mae_id', it.animal_id).concat(m.repo.por('ANIMAIS', 'pai_id', it.animal_id)).map(function (a) { return a.animal_id; }));
      var maeRecusada = false;
      var maeNascRecusada = false;
      var paiRecusado = { sexo: false, nascimento: false };
      filhos.forEach(function (fid) {
        var comoMae = maeDe(fid) === it.animal_id;
        var comoPai = paiDe(fid) === it.animal_id;
        if (!comoMae && !comoPai) return;
        // Filho que o próprio comando cria ou recria: a mãe e o pai dele já foram conferidos acima (uma causa, um erro).
        if (final[fid] && (final[fid].novo || final[fid].reusado)) return;
        var sexo = sexoDe(it.animal_id);
        if (comoMae && sexo !== 'F') maeRecusada = true;
        if (comoPai && sexo !== 'M') paiRecusado.sexo = true;
        if ((comoMae && sexo !== 'F') || (comoPai && sexo !== 'M')) erroItem_(m, it, 'valor_novo', 'SEXO_DO_PROGENITOR', 'o animal é ' + (comoMae ? 'mãe' : 'pai') + ' de ' + nomeDe(fid) + ' e não pode ter o sexo trocado.');
        var nf = nascDe(fid);
        var np = nascDe(it.animal_id);
        if (!vazio_(nf) && !vazio_(np) && np >= nf) {
          if (comoPai) paiRecusado.nascimento = true;
          if (comoMae) maeNascRecusada = true;
          erroItem_(m, it, 'valor_novo', 'NASCIMENTO_DO_PROGENITOR', 'o animal é ' + (comoMae ? 'mãe' : 'pai') + ' de ' + nomeDe(fid) + ', nascido em ' + br_(nf) + ', e precisa ter nascido antes.');
        }
      });
      // A mãe de um parto vigente (mesmo só de natimorto, sem cria cadastrada) nasceu antes dele (RN-009, RN-012): o parto
      // anterior ao nascimento a linha do tempo já acusa (ANTES_DO_NASCIMENTO); o do próprio dia, aqui.
      var npM = nascDe(it.animal_id);
      var partoN = maeNascRecusada || vazio_(npM) ? null : Timeline.ordenar(m.f.linhas(it.animal_id).filter(function (l) { return l.papel === 'MATRIZ' && l.event_type === 'NASCIMENTO' && npM === l.event_date; }))[0];
      if (partoN) erroItem_(m, it, 'valor_novo', 'NASCIMENTO_DO_PROGENITOR', 'o animal é a mãe do parto de ' + br_(partoN.event_date) + ' e precisa ter nascido antes dele.');
      // O touro de um parto (mesmo só de natimorto, sem cria cadastrada) é macho e nasceu antes dele (RN-012, RN-060).
      var touroDe = comoTouro_(m, it.animal_id);
      var sexoT = touroDe.length && !paiRecusado.sexo && sexoDe(it.animal_id) !== 'M' ? touroDe[0] : null;
      if (sexoT) erroItem_(m, it, 'valor_novo', 'SEXO_DO_PROGENITOR', 'o animal é o pai ' + doReproducao_(sexoT) + ' e não pode deixar de ser macho. Se o pai foi lançado errado, corrija o parto antes.');
      var npT = nascDe(it.animal_id);
      var nascT = paiRecusado.nascimento || vazio_(npT) ? null : touroDe.filter(function (r) { return Utils.dataValida(r.data) && npT >= r.data; })[0];
      if (nascT) erroItem_(m, it, 'valor_novo', 'NASCIMENTO_DO_PROGENITOR', 'o animal é o pai ' + doReproducao_(nascT) + ' e precisa ter nascido antes dele.');
      // A mãe de um parto vigente (mesmo só de natimorto, sem cria cadastrada) é fêmea (RN-012, RN-060).
      var parto = sexoDe(it.animal_id) !== 'F' && !maeRecusada ? partoDaMatriz_(m.f, it.animal_id) : null;
      if (parto) erroItem_(m, it, 'valor_novo', 'SEXO_DA_MATRIZ', 'o animal é a mãe do parto de ' + br_(parto.event_date) + ' e não pode deixar de ser fêmea. Se o parto foi lançado na vaca errada, corrija o parto antes.');
    });
  }
  /**
   * Reclassificação vigente do animal (na fonte do motor, sem o evento anulado) para uma categoria que não serve ao sexo
   * `sexo` (RELATORIO_FASE2, decisão 8: a categoria escolhida à mão serve ao sexo; RN-012: corrigir o sexo reaplica as
   * regras que dependem dele): {ajuste, categoria, evento} da primeira, ou null.
   */
  function reclassificacaoIncompativel_(m, id, sexo) {
    if (vazio_(sexo) || !m.repo.carregada('CATEGORIAS')) return null;
    var achada = null;
    m.f.ajustes(id).forEach(function (a) {
      if (achada || a.tipo_ajuste !== 'RECLASSIFICACAO' || vazio_(a.valor_novo)) return;
      var cat = m.repo.porId('CATEGORIAS', a.valor_novo);
      var ev = m.f.evento(a.event_id);
      if (cat && ev && cat.sexo_aplicavel !== 'AMBOS' && cat.sexo_aplicavel !== sexo) achada = { ajuste: a, categoria: cat, evento: ev };
    });
    return achada;
  }
  /**
   * O caminho que resolve a reclassificação que não serve ao sexo: toda reclassificação que vale conta (a categoria de
   * hoje e as antigas), então voltar à categoria automática ou reclassificar de novo não a tira do histórico; estorná-la ou
   * corrigi-la, sim.
   */
  function resolverCategoria_(x, quando) {
    return (quando ? 'Antes ' + quando + ', estorne' : 'Estorne antes') + ' a reclassificação de ' + br_(x.evento.event_date) + ' (ou corrija-a para uma categoria do sexo novo): voltar à categoria automática ou reclassificar de novo não apaga a reclassificação antiga.';
  }
  function textoCategoriaDoSexo_(x) {
    return 'a reclassificação de ' + br_(x.evento.event_date) + ' pôs o animal na categoria ' + x.categoria.nome + ', que é só de ' + (x.categoria.sexo_aplicavel === 'M' ? 'machos' : 'fêmeas');
  }
  /**
   * O sexo que o comando muda (correção de cadastro, correção de quem criou o animal ou do parto da cria) e a categoria
   * escolhida à mão que continua valendo: a que não serve ao sexo novo dá CONFLICT com a reclassificação.
   */
  function conferirCategoriasDoSexo_(m, ctxEv) {
    var feitos = {};
    ctxEv.itens.forEach(function (it) {
      if (!it.animal_id || it.novo || it.ignorarNaLinhaDoTempo || feitos[it.animal_id] || !it.final || !it.final.mudouSexo) return;
      feitos[it.animal_id] = true;
      var gravado = m.real.animal(it.animal_id);
      if (!gravado || gravado.sexo === it.final.sexo) return;
      var x = reclassificacaoIncompativel_(m, it.animal_id, it.final.sexo);
      if (!x) return;
      conflito_(m, it, { codigo: 'CATEGORIA_INCOMPATIVEL', event_id: x.evento.event_id, event_type: x.evento.event_type, event_subtype: x.evento.event_subtype, event_date: x.evento.event_date },
        'o animal ficaria ' + (it.final.sexo === 'M' ? 'macho' : 'fêmea') + ', mas ' + textoCategoriaDoSexo_(x) + '. ' + resolverCategoria_(x, 'de corrigir o sexo'));
    });
  }
  /** Primeira linha MATRIZ vigente (parto) do animal na fonte f, ou null. */
  function partoDaMatriz_(f, id) {
    var partos = Timeline.ordenar(f.linhas(id).filter(function (l) { return l.papel === 'MATRIZ' && l.event_type === 'NASCIMENTO'; }));
    return partos.length ? partos[0] : null;
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
      // Registro anterior ao marco zero se confere com a chegada DECLARADA (04, seção 6), não com a volta mais recente.
      var chegadaAntes = it.novo ? null : Timeline.chegadaDeclarada(m.real, it.animal_id).data;
      var entrada = it.novo ? (it.final ? nulo_(it.final.data_entrada) : null)
        : it.final && it.final.mudouEntrada ? it.final.data_entrada : Timeline.chegadaDeclarada(m.f, it.animal_id).data;
      var antes = it.novo ? [] : m.real.linhas(it.animal_id);
      var depois = (it.novo ? [] : m.f.linhas(it.animal_id)).concat(it.linhas);
      var opc = { nascimento: nasc, dataEntrada: entrada };
      // "Antes" é o que está gravado (com o original, na correção), não o estado sem ele: um problema que só o original
      // escondia (o nascimento ou a chegada que ele corrigiu) aparece como novo e é conferido.
      var gravado = it.novo ? null : m.real.animal(it.animal_id);
      var opcAntes = { nascimento: gravado ? gravado.data_nascimento : null, dataEntrada: chegadaAntes };
      var novos = Timeline.problemasNovos(Timeline.validar(antes, opcAntes).problemas, Timeline.validar(depois, opc).problemas);
      novos.forEach(function (p) {
        // Nascimento × a própria entrada já foi conferido nos atributos (mensagem mais clara).
        if (p.codigo === 'ANTES_DO_NASCIMENTO' && it.atributos && p.event_id === ctxEv.ev.event_id) return;
        // A origem que o servidor tirou da linha do tempo só diverge quando outro registro a quebrou: esse é o problema
        // que se mostra (erro ou CONFLICT com o evento), não a origem derivada.
        if (p.codigo === 'ORIGEM_DIVERGENTE' && it.origemDerivada && p.event_id === ctxEv.ev.event_id) return;
        var texto = Timeline.descrever(p, function (id) { return nomePasto_(m, id); });
        if (p.event_id === ctxEv.ev.event_id) erroItem_(m, it, null, p.codigo, texto);
        // A origem do registro posterior é imutável e conferida pela linha do tempo de hoje (03b, seção 3: pasto_origem_id;
        // 04, seção 5.2 ii): corrigi-lo antes não a muda. O caminho é estorná-lo, lançar este e registrá-lo de novo.
        else if (p.codigo === 'ORIGEM_DIVERGENTE') conflito_(m, it, p, texto + ' Corrigir esse registro não muda a origem dele: estorne-o, lance este e depois registre-o de novo (ou mude este lançamento).');
        // A mãe na desmama é posta pelo servidor (a mãe do bezerro que estava no rebanho naquele dia; 03b, seção 16.14):
        // corrigir a desmama com ela ainda no rebanho a põe de novo. O caminho é refazer a desmama depois deste lançamento.
        else if (p.event_type === 'DESMAMA' && p.papel === 'MATRIZ') conflito_(m, it, p, texto + ' Ela está nessa desmama como a mãe do bezerro, que o sistema põe sozinho enquanto ela está no rebanho, e corrigir a desmama não a tira: estorne a desmama de ' + br_(p.event_date) + ', grave este lançamento e lance a desmama dos bezerros de novo (sem ela como mãe).');
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
    var identPorAnimal = ctxEv ? Utils.agruparPor(ctxEv.plano.IDENTIFICACOES.filter(function (r) { return r.tipo === 'BRINCO'; }), 'animal_id') : {};
    var donoDe = function (codigo) {
      if (!donos) {
        donos = {};
        m.repo.vigentes('ANIMAIS').forEach(function (a) {
          if (conjunto[a.animal_id]) return;
          // Animal que o próprio comando anula (criado pelo evento que sai) libera o brinco: vale o estado de depois.
          var e = m.afetados[a.animal_id] ? estado_(m, a.animal_id) : a;
          if (!e || vazio_(e.brinco) || e.situacao_cadastral === 'ANULADO' || e.situacao_cadastral === 'PENDENTE') return;
          donos[chave(e.brinco)] = e;
        });
      }
      return donos[chave(codigo)] || null;
    };
    ids.forEach(function (id) {
      var gravado = m.f.animal(id);
      var depois = estado_(m, id);
      if (!gravado || !depois || depois.situacao_cadastral === 'ANULADO' || depois.situacao_cadastral === 'PENDENTE') return;
      var item = ctxEv && itensPorAnimal_(ctxEv)[id] ? itensPorAnimal_(ctxEv)[id][0] : null;
      var it = itemDoAnimal_(m, ctxEv, id);
      // O brinco do conjunto FINAL (RN-045): sem o original e com as linhas de brinco do substituto no lugar dele.
      var brincoFinal = depois.brinco;
      if (identPorAnimal[id]) {
        var seq = Timeline.identificacoes(m.f, id).filter(function (x) { return x.tipo === 'BRINCO'; })
          .concat(identPorAnimal[id].map(function (r) { return Timeline.linhaIdentificacao(r, ctxEv.ev, ctxEv.ev.ordem_seq); }))
          .sort(function (a, b) { return (a.data_inicio < b.data_inicio ? -1 : a.data_inicio > b.data_inicio ? 1 : 0) || (a.ordem_seq - b.ordem_seq) || (a.event_seq - b.event_seq); });
        var ultima = seq.length ? seq[seq.length - 1] : null;
        brincoFinal = ultima && !ultima.remocao ? ultima.codigo : null;
      }
      if (!(item && item.brincoProposto) && !vazio_(brincoFinal) && chave(brincoFinal) !== chave(gravado.brinco || '')) {
        var dono = donoDe(brincoFinal);
        var pDono = dono ? eventoDoBrinco_(m, dono.animal_id) : null;
        if (dono && !(pDono && jaCitado_(m, id, 'BRINCO_DUPLICADO', pDono.event_id))) {
          var p = pDono || { codigo: 'BRINCO_DUPLICADO', event_id: null, event_type: null, event_date: null };
          conflito_(m, it, p, verbo + ' devolveria ao animal o brinco ' + brincoFinal + ', que hoje é do animal ' + nomeAnimal_(dono) + ' (' + dono.codigo_interno + '). Troque o brinco de um dos dois antes.');
        }
      }
      // A retirada (ou a troca) levada para depois de o número ir para outro animal é conferida com os períodos de uso
      // de cada número (conferirPeriodosDeBrinco_), para toda linha de brinco do substituto.
      // Sexo ou nascimento que voltam (estorno de uma correção de cadastro) e o animal já é mãe ou pai (RN-012).
      var corrigeNoComando = item && ctxEv.tipo === 'AJUSTE_INVENTARIO' && ctxEv.subtipo === 'CORRECAO_CADASTRO' && !!item.final && (item.final.mudouSexo || item.final.mudouNascimento);
      // Cada registro que impede entra uma vez (o parto da mãe e a cria dele são o mesmo lançamento).
      var citados = {};
      var citar = function (ref, texto) {
        if (ref.event_id && citados[ref.event_id]) return;
        if (ref.event_id) citados[ref.event_id] = true;
        conflito_(m, it, ref, texto);
      };
      // A categoria escolhida à mão que continua valendo serve ao sexo que volta (decisão 8; RN-012).
      var catSexo = !corrigeNoComando && depois.sexo !== gravado.sexo ? reclassificacaoIncompativel_(m, id, depois.sexo) : null;
      if (catSexo) {
        citar({ codigo: 'CATEGORIA_INCOMPATIVEL', event_id: catSexo.evento.event_id, event_type: catSexo.evento.event_type, event_subtype: catSexo.evento.event_subtype, event_date: catSexo.evento.event_date },
          verbo + ' voltaria o sexo do animal para ' + (depois.sexo === 'M' ? 'macho' : 'fêmea') + ', mas ' + textoCategoriaDoSexo_(catSexo) + '. ' + resolverCategoria_(catSexo, null));
      }
      if (!corrigeNoComando && depois.sexo !== 'F' && gravado.sexo === 'F') {
        var parto = partoDaMatriz_(m.f, id);
        if (parto) citar({ codigo: 'PARTO_DA_MATRIZ', event_id: parto.event_id, event_type: parto.event_type, event_subtype: parto.event_subtype, event_date: parto.event_date }, verbo + ' voltaria o sexo do animal para macho, mas ele é a mãe do parto de ' + br_(parto.event_date) + '. Corrija ou estorne o parto antes.');
      }
      if (!corrigeNoComando && (depois.sexo !== gravado.sexo || nulo_(depois.data_nascimento) !== nulo_(gravado.data_nascimento))) {
        Utils.unicos(m.repo.por('ANIMAIS', 'mae_id', id).concat(m.repo.por('ANIMAIS', 'pai_id', id)).map(function (a) { return a.animal_id; })).forEach(function (fid) {
          var filho = estado_(m, fid);
          if (!filho || filho.situacao_cadastral === 'ANULADO' || filho.situacao_cadastral === 'PENDENTE') return;
          var comoMae = filho.mae_id === id;
          var comoPai = filho.pai_id === id;
          if (!comoMae && !comoPai) return;
          var ref = refVinculo_(m, fid, comoMae ? 'mae_id' : 'pai_id', id, filho.evento_origem_id);
          if ((comoMae && depois.sexo !== 'F') || (comoPai && depois.sexo !== 'M')) citar(ref, verbo + ' voltaria o sexo do animal para ' + (depois.sexo === 'M' ? 'macho' : 'fêmea') + ', mas ele é ' + (comoMae ? 'mãe' : 'pai') + ' de ' + nomeAnimal_(filho) + '.');
          else if (!vazio_(depois.data_nascimento) && !vazio_(filho.data_nascimento) && depois.data_nascimento >= filho.data_nascimento) citar(ref, verbo + ' voltaria o nascimento do animal para ' + br_(depois.data_nascimento) + ', mas ele é ' + (comoMae ? 'mãe' : 'pai') + ' de ' + nomeAnimal_(filho) + ', nascido em ' + br_(filho.data_nascimento) + '.');
        });
        // O touro de um parto (mesmo só de natimorto): macho e nascido antes dele (RN-012, RN-060).
        comoTouro_(m, id).forEach(function (r) {
          var ref = refEvento_(m, 'REFERENCIA_TOURO', r.event_id);
          if (depois.sexo !== 'M') citar(ref, verbo + ' voltaria o sexo do animal para fêmea, mas ele é o pai ' + doReproducao_(r) + '. Corrija ou estorne esse lançamento antes.');
          else if (!vazio_(depois.data_nascimento) && Utils.dataValida(r.data) && depois.data_nascimento >= r.data) citar(ref, verbo + ' voltaria o nascimento do animal para ' + br_(depois.data_nascimento) + ', mas ele é o pai ' + doReproducao_(r) + '. Corrija as datas ou esse lançamento antes.');
        });
        // A mãe de um parto (mesmo só de natimorto): nascida antes dele (RN-009, RN-012). O parto anterior ao nascimento
        // que volta a linha do tempo já acusa (ANTES_DO_NASCIMENTO); o do próprio dia, aqui.
        if (!vazio_(depois.data_nascimento) && nulo_(depois.data_nascimento) !== nulo_(gravado.data_nascimento)) {
          Timeline.ordenar(m.f.linhas(id).filter(function (l) { return l.papel === 'MATRIZ' && l.event_type === 'NASCIMENTO' && depois.data_nascimento === l.event_date; })).forEach(function (l) {
            citar({ codigo: 'PARTO_DA_MATRIZ', event_id: l.event_id, event_type: l.event_type, event_subtype: l.event_subtype, event_date: l.event_date }, verbo + ' voltaria o nascimento do animal para ' + br_(depois.data_nascimento) + ', mas ele é a mãe do parto de ' + br_(l.event_date) + '. Corrija as datas ou o parto antes.');
          });
        }
      }
      // A chegada declarada no rebanho inicial não fica antes do nascimento (RN-021): o que volta é conferido com o que fica.
      var corrigeDatas = item && ctxEv.tipo === 'AJUSTE_INVENTARIO' && ctxEv.subtipo === 'CORRECAO_CADASTRO' && !!item.final && (item.final.mudouNascimento || item.final.mudouEntrada);
      var origemEv = vazio_(depois.evento_origem_id) ? null : m.f.evento(depois.evento_origem_id);
      if (!corrigeDatas && origemEv && origemEv.event_type === 'ENTRADA_INICIAL') {
        var chegou = Timeline.chegadaDeclarada(m.f, id).data;
        var chegouAntes = Timeline.chegadaDeclarada(m.real, id).data;
        var mudouData = nulo_(chegou) !== nulo_(chegouAntes) || nulo_(depois.data_nascimento) !== nulo_(gravado.data_nascimento);
        if (mudouData && Utils.dataValida(chegou) && Utils.dataValida(depois.data_nascimento) && chegou < depois.data_nascimento) {
          // Quem impede é o registro que deixou a outra data como está: a correção vigente dela, ou o rebanho inicial.
          var campoQueFica = nulo_(chegou) !== nulo_(chegouAntes) ? 'data_nascimento' : 'data_entrada';
          var refData = ultimaCorrecaoCampo_(m, id, campoQueFica, 'ENTRADA_ANTES_DO_NASCIMENTO') || refEvento_(m, 'ENTRADA_ANTES_DO_NASCIMENTO', origemEv.event_id);
          conflito_(m, it, refData, verbo + ' deixaria a chegada na fazenda (' + br_(chegou) + ') antes do nascimento (' + br_(depois.data_nascimento) + '). Corrija a data de chegada ou o nascimento antes.');
        }
      }
      conferirGenealogiaRestaurada_(m, ctxEv, id, depois, gravado, item, it, verbo);
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
  /**
   * A mãe ou o pai que um estorno ou uma correção DEVOLVE ao animal (a projeção sem o evento anulado) passam pelas regras
   * da genealogia com os valores de depois (05, seção 2.2: RN-007 a RN-010; algoritmo de 05, seção 4.2): o progenitor
   * existe, a mãe é fêmea e o pai é macho, nasceu antes do filho e não há ciclo. Quem impede é o registro que deixou o
   * progenitor como está hoje (a correção do sexo, do nascimento ou da mãe/pai que fecha o ciclo): CONFLICT com ele.
   * Mãe ou pai que o próprio comando muda é conferido por conferirGenealogia_.
   */
  function conferirGenealogiaRestaurada_(m, ctxEv, id, depois, gravado, item, it, verbo) {
    var finais = {};
    if (ctxEv) ctxEv.itens.forEach(function (x) { if (x.animal_id && !x.ignorarNaLinhaDoTempo && !finais[x.animal_id]) finais[x.animal_id] = x; });
    function sexoDe(x) { return finais[x] && finais[x].final && finais[x].final.mudouSexo ? finais[x].final.sexo : (estado_(m, x) || {}).sexo; }
    function nascDe(x) { return finais[x] && finais[x].final && finais[x].final.mudouNascimento ? finais[x].final.data_nascimento : (estado_(m, x) || {}).data_nascimento; }
    function vinculo(x, campo) {
      if (finais[x] && finais[x].genealogia) return finais[x].genealogia[campo];
      if (x === id) return depois[campo];
      return (estado_(m, x) || {})[campo];
    }
    // A correção vigente mais recente de um campo do animal (o registro que o deixou assim), ou null.
    function ultimaCorrecao(x, campos, valor) {
      var aj = m.f.ajustes(x).filter(function (a) { return a.tipo_ajuste === 'CORRECAO_CADASTRO' && campos.indexOf(a.campo) >= 0 && (valor === undefined || a.valor_novo === valor); })
        .map(function (a) { return m.f.evento(a.event_id); }).filter(Boolean)
        .sort(function (a, b) { return a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : a.event_seq - b.event_seq; }).pop();
      return aj ? { codigo: 'REFERENCIA_GENEALOGICA', event_id: aj.event_id, event_type: aj.event_type, event_subtype: aj.event_subtype, event_date: aj.event_date } : null;
    }
    function origem(x) {
      var e = estado_(m, x) || {};
      var ev = vazio_(e.evento_origem_id) ? null : m.f.evento(e.evento_origem_id);
      return ev ? { codigo: 'REFERENCIA_GENEALOGICA', event_id: ev.event_id, event_type: ev.event_type, event_subtype: ev.event_subtype, event_date: ev.event_date } : { codigo: 'REFERENCIA_GENEALOGICA', event_id: null, event_type: null, event_date: null };
    }
    function nomeDe(x) { return nomeAnimal_(estado_(m, x)); }
    function caminho(de, ate) {
      var fila = [[de]];
      var vistos = {};
      while (fila.length) {
        var c = fila.shift();
        var x = c[c.length - 1];
        if (x === ate) return c;
        if (vistos[x]) continue;
        vistos[x] = true;
        [vinculo(x, 'mae_id'), vinculo(x, 'pai_id')].forEach(function (p) { if (!vazio_(p) && !vistos[p]) fila.push(c.concat([p])); });
      }
      return null;
    }
    [['mae_id', 'F', 'a mãe', 'fêmea', 'macho', 'mudouMae'], ['pai_id', 'M', 'o pai', 'macho', 'fêmea', 'mudouPai']].forEach(function (cfg) {
      var campo = cfg[0];
      if (item && item.parentesco && item.parentesco[cfg[5]]) return;
      var pid = nulo_(depois[campo]);
      if (pid === null) return;
      if (pid === nulo_(gravado[campo])) {
        // A mãe ou o pai não mudam, mas o nascimento do próprio animal volta (RN-009): o filho nasce depois dos pais.
        var nfv = nascDe(id);
        var npv = nascDe(pid);
        var corrigeNasc = item && item.final && item.final.mudouNascimento;
        if (corrigeNasc || nulo_(depois.data_nascimento) === nulo_(gravado.data_nascimento) || vazio_(nfv) || vazio_(npv) || npv < nfv) return;
        conflito_(m, it, ultimaCorrecao(id, [campo], pid) || ultimaCorrecao(pid, ['data_nascimento']) || origem(pid),
          verbo + ' voltaria o nascimento do animal para ' + br_(nfv) + ', mas ' + cfg[2] + ' dele, ' + nomeDe(pid) + ', nasceu em ' + br_(npv) + '. Corrija as datas ou ' + cfg[2] + ' antes.');
        return;
      }
      var p = estado_(m, pid);
      var inicio = verbo + ' voltaria ' + cfg[2] + ' do animal para ' + nomeDe(pid);
      if (pid === id) { conflito_(m, it, origem(id), inicio + ', o próprio animal.'); return; }
      if (!p || p.situacao_cadastral === 'ANULADO' || p.situacao_cadastral === 'PENDENTE') {
        conflito_(m, it, origem(pid), inicio + ', que foi anulado. Corrija ' + cfg[2] + ' do animal antes.');
        return;
      }
      if (sexoDe(pid) !== cfg[1]) {
        conflito_(m, it, ultimaCorrecao(pid, ['sexo']) || origem(pid), inicio + ', que é ' + cfg[4] + '. Corrija o sexo de ' + nomeDe(pid) + ' ou ' + cfg[2] + ' do animal antes.');
        return;
      }
      var nf = nascDe(id);
      var np = nascDe(pid);
      if (!vazio_(nf) && !vazio_(np) && np >= nf) {
        conflito_(m, it, ultimaCorrecao(pid, ['data_nascimento']) || ultimaCorrecao(id, ['data_nascimento']) || origem(pid), inicio + ', nascido em ' + br_(np) + ', que não é antes do animal (' + br_(nf) + '). Corrija as datas ou ' + cfg[2] + ' antes.');
        return;
      }
      var ciclo = caminho(pid, id);
      if (ciclo) {
        // O elo do ciclo gravado por último (a correção de mãe ou pai que o fecharia) é o registro que impede.
        var impede = null;
        for (var k = 0; k + 1 < ciclo.length; k++) {
          var x = ciclo[k];
          var prox = ciclo[k + 1];
          var c = ultimaCorrecao(x, [vinculo(x, 'mae_id') === prox ? 'mae_id' : 'pai_id'], prox);
          if (c && (!impede || c.event_date > impede.event_date || (c.event_date === impede.event_date && (m.f.evento(c.event_id) || {}).event_seq > (m.f.evento(impede.event_id) || {}).event_seq))) impede = c;
        }
        conflito_(m, it, impede || origem(pid), inicio + ', mas o animal já é ancestral de ' + nomeDe(pid) + ' (' + ciclo.slice().reverse().map(nomeDe).join(' → ') + '): a genealogia fecharia um ciclo. Estorne ou corrija esse registro antes.');
      }
    });
  }
  /**
   * O registro que deu ao filho a mãe ou o pai `paiId` (CONTRATOS, seção 14: o conflito aponta o registro que impede): a
   * correção de cadastro vigente mais recente do campo, quando foi ela que pôs esse animal; senão o lançamento que criou o
   * filho (onde o vínculo nasceu).
   */
  function refVinculo_(m, filhoId, campo, paiId, origemId) {
    var cor = ultimaCorrecaoCampo_(m, filhoId, campo, 'REFERENCIA_GENEALOGICA');
    if (cor) {
      var aj = m.f.ajustes(filhoId).filter(function (a) { return a.event_id === cor.event_id && a.tipo_ajuste === 'CORRECAO_CADASTRO' && a.campo === campo; })[0];
      if (aj && aj.valor_novo === paiId) return cor;
    }
    return refEvento_(m, 'REFERENCIA_GENEALOGICA', origemId);
  }
  /** A correção de cadastro vigente mais recente de um campo do animal (o registro que o deixou assim), como conflito; ou null. */
  function ultimaCorrecaoCampo_(m, id, campo, codigo) {
    // Na ordem em que a projeção aplica as correções (a de corrigidoDepois_): a última é a que vale.
    var ev = m.f.ajustes(id).filter(function (a) { return a.tipo_ajuste === 'CORRECAO_CADASTRO' && a.campo === campo; })
      .map(function (a) { return m.f.evento(a.event_id); }).filter(Boolean)
      .sort(function (a, b) { return (m.f.ordemSeq(a.event_id) - m.f.ordemSeq(b.event_id)) || (a.event_seq - b.event_seq); }).pop();
    return ev ? { codigo: codigo, event_id: ev.event_id, event_type: ev.event_type, event_subtype: ev.event_subtype, event_date: ev.event_date } : null;
  }
  /**
   * O registro que impede, para o conflito (CONTRATOS, seção 14): tipo, subtipo e data do próprio lançamento, nunca um
   * pseudo-tipo; sem o lançamento (cadastro sem evento), tudo nulo.
   */
  function refEvento_(m, codigo, eventId) {
    var ev = vazio_(eventId) ? null : m.f.evento(eventId);
    return ev ? { codigo: codigo, event_id: ev.event_id, event_type: ev.event_type, event_subtype: ev.event_subtype, event_date: ev.event_date } : { codigo: codigo, event_id: nulo_(eventId), event_type: null, event_date: null };
  }
  /** Animal que deixa de ter a entrada (estorno, ou correção que o tira da lista): sem outro evento nem referência (RN-041). */
  function conferirAnulacao_(m, animalId, eventoId, anulados) {
    var e = m.f.animal(animalId) || {};
    var it = { animal_id: animalId, brincoTexto: e.brinco || null, quem: nomeAnimal_(e) };
    // Cada lançamento que impede entra uma vez: o parto que é dependente pela linha do tempo e cria do animal, ou o
    // registro reprodutivo de que ele é o touro e cuja cria é filha dele, não se repetem.
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
        // O registro que criou o vínculo: a correção de cadastro que pôs a mãe ou o pai, ou o lançamento que criou o filho.
        var ref = refVinculo_(m, f.animal_id, c, animalId, f.evento_origem_id);
        if (!vazio_(ref.event_id) && outros[ref.event_id]) return;
        if (!vazio_(ref.event_id)) outros[ref.event_id] = true;
        conflito_(m, it, ref, 'é ' + (c === 'mae_id' ? 'mãe' : 'pai') + ' de ' + nomeAnimal_(f) + '.');
      });
    });
    m.repo.por('REPRODUCAO', 'touro_id', animalId).forEach(function (r) {
      if (r.event_id === eventoId || outros[r.event_id]) return;
      outros[r.event_id] = true;
      conflito_(m, it, refEvento_(m, 'REFERENCIA_TOURO', r.event_id), 'é o pai ' + doReproducao_(r) + '.');
    });
    // Valor alocado ao animal por outro evento: o conflito é com o evento dono do rateio (tipo e data dele), uma vez
    // só por evento (o que já entrou como dependente pela linha do tempo não se repete).
    var porRateio = {};
    m.repo.por('ALOCACOES_FINANCEIRAS', 'animal_id', animalId).forEach(function (a) {
      var rat = m.repo.porId('RATEIOS', a.rateio_id);
      if (!rat || rat.event_id === eventoId || m.f.excluidos[rat.event_id]) return;
      porRateio[rat.event_id] = (porRateio[rat.event_id] || 0) + (a.valor_alocado || 0);
    });
    Object.keys(porRateio).forEach(function (evId) {
      if (outros[evId]) return;
      outros[evId] = true;
      var dono = m.f.evento(evId) || {};
      var rateio = dono.event_type === 'RATEIO';
      var texto = rateio
        ? 'recebeu ' + Utils.formatarReais(porRateio[evId]) + ' do rateio de custo de ' + br_(dono.event_date) + '; refaça o rateio sem este animal antes.'
        : 'recebeu ' + Utils.formatarReais(porRateio[evId]) + ' do financeiro de ' + EventCatalog.nomeEvento(dono.event_type, dono.event_subtype) + ' de ' + br_(dono.event_date) + '; estorne ou corrija esse lançamento antes.';
      conflito_(m, it, { codigo: 'REFERENCIA_RATEIO', event_id: evId, event_type: dono.event_type || null, event_subtype: dono.event_subtype || null, event_date: dono.event_date || null }, texto);
    });
  }
  /**
   * Linha do tempo de um animal que o comando só tocou, sem o evento anulado (04, seção 5.1: estorno e substituição
   * revalidam os dependentes): antes com o nascimento e a chegada gravados, depois com os da projeção sem o evento — o
   * estorno de uma correção de nascimento ou de chegada devolve a data antiga, e o registro anterior ao marco zero que
   * só cabia com a corrigida vira CONFLICT (04, seção 6; RN-021, RN-040).
   */
  function linhaDoTempoSem_(m, it, sufixo) {
    var id = it.animal_id;
    var gravado = m.real.animal(id) || {};
    var depois = estado_(m, id) || gravado;
    var antes = { nascimento: gravado.data_nascimento, dataEntrada: Timeline.chegadaDeclarada(m.real, id).data };
    var sem = { nascimento: depois.data_nascimento, dataEntrada: Timeline.chegadaDeclarada(m.f, id).data };
    Timeline.problemasNovos(Timeline.validar(m.real.linhas(id), antes).problemas, Timeline.validar(m.f.linhas(id), sem).problemas).forEach(function (p) {
      conflito_(m, it, p, Timeline.descrever(p, function (x) { return nomePasto_(m, x); }) + sufixo);
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
    // Só o animal criado pelo original fica ANULADO (desenho-base 4.4); o que já existia volta ao que era sem ele.
    ctxEv.removidos = removidos.slice();
    ctxEv.anuladosCriados = removidos;
    ctxEv.voltam = [];
    // Animais não criados pelo original que ficaram fora do substituto: a linha do tempo deles sem o original.
    m.f.linhasDoEvento(ctxEv.original.event_id).forEach(function (l) {
      if (presentes[l.animal_id] || ctxEv.criadosOriginal[l.animal_id]) return;
      var e = m.f.animal(l.animal_id) || {};
      var it = { animal_id: l.animal_id, brincoTexto: e.brinco || null, quem: nomeAnimal_(e) };
      linhaDoTempoSem_(m, it, '');
      if (ctxEv.voltam.indexOf(l.animal_id) < 0) ctxEv.voltam.push(l.animal_id);
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
          conflito: conflitoCom_(ev.event_id, ev.event_type, ev.event_subtype, ev.event_date),
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
  /** O produto de um registro sanitário, para a guarda de duplicidade: o do cadastro ou o nome em texto livre. */
  function chaveSanidade_(r) {
    if (!r) return '';
    if (!vazio_(r.produto_id)) return 'P:' + r.produto_id;
    if (!vazio_(r.nome_produto)) return 'N:' + Utils.normalizarTexto(String(r.nome_produto));
    // Sem produto (a doença, o exame): a mesma doença ou o mesmo diagnóstico, como na importação (jaRegistrado_).
    return 'D:' + Utils.normalizarTexto(String(r.diagnostico || ''));
  }
  /** Tipos cujo fato é de cada animal (a mesma chave da importação, jaRegistrado_): o aviso de duplicidade vai por animal. */
  var FATO_POR_ANIMAL = Object.freeze({ REPRODUCAO: true, SANIDADE: true, OCORRENCIA: true });
  function guardaDuplicidade_(m, ctxEv) {
    var ev = ctxEv.ev;
    // O touro do lote não conta: o lançamento é das fêmeas (a reprodução) e dos bezerros (a desmama).
    var itens = ctxEv.itens.filter(function (it) { return it.animal_id && it.linhaEA && it.linhaEA.papel !== 'TOURO'; });
    if (!itens.length || !Utils.dataValida(ev.event_date)) return;
    var candidatos = m.repo.por('EVENTOS', 'event_date', ev.event_date).filter(function (c) {
      if (c.event_type !== ev.event_type || nulo_(c.event_subtype) !== nulo_(ev.event_subtype) || m.f.excluidos[c.event_id]) return false;
      // Marcar e desmarcar no mesmo dia não são o mesmo lançamento; duas vacinas diferentes no mesmo dia, também não.
      if (ev.event_type === 'SANIDADE') return chaveSanidade_(m.repo.por('SANIDADE', 'event_id', c.event_id)[0]) === chaveSanidade_(ctxEv.plano.SANIDADE[0]);
      // Duas ocorrências de tipos diferentes no mesmo dia não são o mesmo lançamento.
      if (ev.event_type === 'OCORRENCIA') return (c.payload_json || {}).tipo_ocorrencia === nulo_(ctxEv.campos.tipo_ocorrencia);
      return ev.event_type !== 'MARCACAO' || (c.payload_json || {}).acao === (ev.payload_json || {}).acao;
    });
    var avisados = {};
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
        // O lançamento como substantivo (CONTRATOS, seção 14: conflito.tipo é o event_type; nome = EventCatalog.nomeEvento).
        var nome = EventCatalog.nomeEvento(c.event_type, c.event_subtype);
        if (c.event_type === 'MARCACAO' && (c.payload_json || {}).acao === 'DESMARCAR') nome = 'a retirada da ' + nome.replace(/^a /, '');
        var quantos = itens.length === 1 ? 'com este animal' : 'com ' + comuns + ' destes ' + itens.length + ' animais';
        avisoItem_(m, null, 'POSSIVEL_DUPLICIDADE', 'Já existe ' + nome + ' de ' + br_(c.event_date) + ' ' + quantos + '. Gravar mesmo assim?',
          conflitoCom_(c.event_id, c.event_type, c.event_subtype, c.event_date));
        avisados[c.event_id] = true;
      }
    });
    // Por animal (RN-090 e RN-091; revisão da Fase 3): o mesmo diagnóstico, a mesma aplicação ou a mesma ocorrência do animal
    // no mesmo dia, gravada num lançamento que não chega aos 80% deste (o bloco do tronco com outras fêmeas, a vacinação do
    // lote), pede confirmação na linha dele — a mesma chave da importação, que a marca DUPLICADA. A pesagem tem o aviso dela.
    if (!FATO_POR_ANIMAL[ev.event_type]) return;
    var porAnimal = {};
    candidatos.forEach(function (c) {
      if (avisados[c.event_id]) return;
      m.repo.por('EVENTO_ANIMAIS', 'event_id', c.event_id).forEach(function (l) { if ((l.papel || 'SUJEITO') === 'SUJEITO' && !porAnimal[l.animal_id]) porAnimal[l.animal_id] = c; });
    });
    itens.forEach(function (it) {
      var c = porAnimal[it.animal_id];
      if (!c || it.novo) return;
      var nome = EventCatalog.nomeEvento(c.event_type, c.event_subtype).replace(/^(a|o) /, '');
      avisoItem_(m, it, 'POSSIVEL_DUPLICIDADE', it.quem + ': já tem ' + nome + ' de ' + br_(c.event_date) + (c.event_type === 'SANIDADE' ? ' com o mesmo produto' : c.event_type === 'OCORRENCIA' ? ' do mesmo tipo' : '') +
        ', em outro lançamento. Gravar mesmo assim?', conflitoCom_(c.event_id, c.event_type, c.event_subtype, c.event_date));
    });
  }
  /**
   * Leitor das consultas (AnimalService.leitor) sobre a linha do tempo do motor com o lançamento em análise: as linhas,
   * pesagens e registros reprodutivos do plano entram como se já valessem, e os eventos excluídos (a correção) ficam
   * fora. Serve para calcular categoria e peso vigente pelas MESMAS regras das consultas (um caminho só).
   */
  function leitorDoLancamento_(m, ctxEv) {
    var novas = {};
    var pes = {};
    var rep = {};
    ctxEv.itens.forEach(function (it) { if (it.animal_id && it.linhas.length) novas[it.animal_id] = (novas[it.animal_id] || []).concat(it.linhas); });
    ctxEv.plano.PESAGENS.forEach(function (x) { (pes[x.animal_id] = pes[x.animal_id] || []).push(x); });
    ctxEv.plano.REPRODUCAO.forEach(function (x) { (rep[x.animal_id] = rep[x.animal_id] || []).push(x); });
    var f = Object.create(m.f);
    f.linhas = function (id) { return m.f.linhas(id).concat(novas[id] || []); };
    f.pesagens = function (id) { return m.f.pesagens(id).concat(pes[id] || []); };
    f.reproducao = function (id) { return m.f.reproducao(id).concat(rep[id] || []); };
    f.evento = function (id) { return id === ctxEv.ev.event_id ? ctxEv.ev : m.f.evento(id); };
    return AnimalService.leitor(m.tx, { fonte: f, parametros: m.params });
  }
  /** O animal como as regras de categoria o leem: o declarado no lançamento (animal novo) ou o estado atual. */
  function animalParaLotacao_(m, porId, id) {
    var it = porId[id];
    if (it && it.atributos) {
      var at = it.atributos;
      return {
        animal_id: id, codigo_interno: it.codigo_interno || null, brinco: it.brincoTexto || null, sexo: nulo_(at.sexo), data_nascimento: nulo_(at.data_nascimento),
        castrado: at.castrado === 'S' || at.castrado === true, reprodutor: at.reprodutor === 'S' || at.reprodutor === true,
        partos_previos: typeof at.partos_previos === 'number' ? at.partos_previos : null,
      };
    }
    return estado_(m, id);
  }
  /**
   * Lotação (RN-027; 07, seção 8.2): entrada, transferência ou correção de pasto que leva o pasto de destino acima da
   * capacidade informada, em cabeças ou em UA/ha, no dia do evento. A UA é a das consultas (InventoryService.compor:
   * peso vigente na data, com o peso do próprio lançamento; vencido ou ausente, o de referência da categoria) e a
   * comparação, a do painel (PastureService.lotacao); sem área ou sem peso nenhum não há UA/ha a comparar. Um aviso
   * por pasto, com as duas contas quando as duas passam.
   */
  function conferirLotacao_(m, ctxEv) {
    if (ctxEv.ev.pre_marco_zero === true) return; // antes do marco zero não há inventário nem lotação
    var destinos = {};
    ctxEv.itens.forEach(function (it) { if (it.linhaEA && !vazio_(it.linhaEA.pasto_destino_id)) destinos[it.linhaEA.pasto_destino_id] = true; });
    var comCapacidade = Object.keys(destinos).filter(function (id) {
      var p = m.f.pasto(id);
      return p && (typeof p.capacidade_estimada_cabecas === 'number' || typeof p.capacidade_estimada_ua_ha === 'number');
    });
    if (!comCapacidade.length || !Utils.dataValida(ctxEv.ev.event_date)) return;
    var data = ctxEv.ev.event_date;
    var novas = [];
    var porId = {};
    ctxEv.itens.forEach(function (it) { novas = novas.concat(it.linhas); if (it.animal_id) porId[it.animal_id] = it; });
    var pres = Timeline.presentesEm(m.f.todasAsLinhas().concat(novas), data, m.D0);
    if (pres.motivo) return;
    var L = null;
    comCapacidade.forEach(function (id) {
      var p = m.f.pasto(id);
      var ids = pres.itens.filter(function (x) { return x.pasture_id === id; }).map(function (x) { return x.animal_id; });
      var n = ids.length;
      var capCab = typeof p.capacidade_estimada_cabecas === 'number' ? p.capacidade_estimada_cabecas : null;
      var capUa = typeof p.capacidade_estimada_ua_ha === 'number' ? p.capacidade_estimada_ua_ha : null;
      var acimaCab = capCab !== null && n > capCab;
      var lot = null;
      if (capUa !== null && typeof p.area_hectares === 'number' && p.area_hectares > 0 && n) {
        L = L || leitorDoLancamento_(m, ctxEv);
        var itens = ids.map(function (a) { return { animal: animalParaLotacao_(m, porId, a), pasture_id: id }; }).filter(function (x) { return !!x.animal; });
        var comp = InventoryService.compor(L, itens, data);
        lot = PastureService.lotacao(p, comp);
        lot.ua = comp.ua;
      }
      var acimaUa = !!(lot && lot.acima_da_capacidade.ua_ha);
      if (!acimaCab && !acimaUa) return;
      var uaHa = acimaUa ? Utils.formatarNumero(lot.ua_ha.valor, 2) + ' UA/ha' : null;
      var msg;
      if (acimaCab && acimaUa) msg = 'O pasto ' + p.nome + ' fica com ' + n + ' cabeças e ' + uaHa + ' em ' + br_(data) + ', acima da capacidade informada (' + capCab + ' cabeças; ' + Utils.formatarNumero(capUa) + ' UA/ha).';
      else if (acimaCab) msg = 'O pasto ' + p.nome + ' fica com ' + n + ' cabeças em ' + br_(data) + ', acima da capacidade informada (' + capCab + ').';
      else msg = 'O pasto ' + p.nome + ' fica com ' + uaHa + ' em ' + br_(data) + ' (' + n + ' cabeças, ' + Utils.formatarNumero(lot.ua.valor, 2) + ' UA em ' + Utils.formatarNumero(p.area_hectares) + ' ha), acima da capacidade informada (' + Utils.formatarNumero(capUa) + ' UA/ha).';
      // O rótulo da composição diz de onde vem a parte estimada (estimativa visual, peso de referência, pesagem vencida; P10).
      if (acimaUa && lot.ua.estimado) msg += ' ' + (lot.ua.rotulo || 'Parte da UA é estimada.');
      avisoItem_(m, null, 'LOTACAO_ACIMA_DA_CAPACIDADE', msg);
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
  /**
   * Cabeçalho da compra: fornecedor e pasto de destino do lote. O pasto do lote só recebe os animais sem pasto próprio: com
   * todos de pasto próprio ele não recebe ninguém, não fica gravado, e estar desativado não recusa o lançamento.
   */
  function cabecalhoCompra_(m, ctxEv, animais) {
    var c = ctxEv.campos;
    parceiroValido_(m, ctxEv, 'partner_id', c.partner_id);
    if (!vazio_(c.pasto_destino_id)) {
      var p = m.f.pasto(c.pasto_destino_id);
      var recebe = !Array.isArray(animais) || animais.some(function (a) { return !a || typeof a !== 'object' || vazio_(a.pasto_destino_id); });
      if (!p) erroGeral_(m, 'pasto_destino_id', 'NAO_ENCONTRADO', 'O pasto de destino não existe.');
      else if (recebe && p.status !== 'ATIVO' && ctxEv.ev.pre_marco_zero !== true && !usadoNoOriginal_(m, p.pasture_id)) erroGeral_(m, 'pasto_destino_id', 'PASTO_INATIVO', 'O pasto ' + p.nome + ' está desativado e não recebe animais.');
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
  /**
   * Evento anterior ao marco zero (importação): o pagamento é anterior ao controle do sistema, então os lançamentos
   * nascem sem caixa (sem parcela, como o saldo de abertura) e ficam no custo e no resultado da época. Parcela
   * informada nesse evento é recusada. Devolve se o evento é histórico.
   */
  function semCaixaHistorico_(m, ctxEv, d) {
    if (ctxEv.ev.pre_marco_zero !== true) return false;
    if (Array.isArray(d.parcelas) && d.parcelas.length) erroGeral_(m, 'parcelas', 'PARCELA_ANTES_DO_MARCO_ZERO', 'Este lançamento é anterior ao marco zero (' + br_(m.D0) + '): o pagamento já aconteceu antes do controle do sistema e não leva parcelas.');
    return true;
  }
  /** Itens do grupo repetível `custos` da compra, validados pelo catálogo; erros com "Custo k:". */
  function custosDaCompra_(m, ctxEv, lista) {
    var defs = EventCatalog.camposGrupo('COMPRA', 'custos');
    if (lista !== undefined && lista !== null && !Array.isArray(lista)) { erroGeral_(m, 'custos', 'TIPO_INVALIDO', 'O frete e os outros custos precisam vir como lista.'); return []; }
    return (lista || []).map(function (bruto, k) {
      var x = bruto && typeof bruto === 'object' ? bruto : {};
      var quem = 'Custo ' + (k + 1) + ': ';
      EventCatalog.validarCampos(defs, x, { listas: m.listas, desativados: m.desativados }).forEach(function (e) { erroGeral_(m, 'custos', e.codigo, quem + e.mensagem); });
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
    var hist = semCaixaHistorico_(m, ctxEv, d);
    var defsParcela = EventCatalog.camposGrupo('COMPRA', 'parcelas');
    (d.parcelas || []).forEach(function (p, k) {
      EventCatalog.validarCampos(defsParcela, p && typeof p === 'object' ? p : {}, { listas: m.listas, desativados: m.desativados }).forEach(function (e) {
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
    var jaRecusados = recusadosNegocio_(m, itens);
    neg.erros.forEach(function (e) {
      // O campo do animal que o catálogo já recusou (fora da faixa, casas demais) também não leva um segundo erro.
      if (typeof e.indice === 'number') { if (!(itens[e.indice].camposComErro || {})[e.campo]) erroItem_(m, itens[e.indice], e.campo, e.codigo, e.mensagem); }
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
      partner_id: c.partner_id, documento: nulo_(c.nota_fiscal), quantidade: n, parcelas: hist ? undefined : d.parcelas, semCaixa: hist, rateio: rateio,
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
    // Os fretes são lançados antes dos outros custos e recebem os menores identificadores da compra: COMPRAS guarda só os
    // dois totais (03b, seção 4.1) e o payload não tem chave para o tipo (03b, seção 2.6), então o tipo de cada item se
    // reconstrói pelo prefixo que soma o frete na ordem do financial_id (FinancialService.tiposDosCustos), nunca na ordem
    // física das linhas (06, seção 12: o dono pode classificar a aba).
    var idsCustos = custos.map(function () { return m.tx.novoId(); }).sort();
    var proximoId = 0;
    custos.map(function (x, k) { return { x: x, k: k }; }).sort(function (a, b) { return ((a.x.tipo === 'OUTRO') - (b.x.tipo === 'OUTRO')) || a.k - b.k; }).forEach(function (o) {
      var x = o.x;
      var k = o.k;
      if (typeof x.valor !== 'number') return;
      var eFrete = x.tipo !== 'OUTRO';
      var pl = FinancialService.planejar(m.tx, {
        evento: ev, conta: contaCustos, naturezas: ['AQUISICAO_ANIMAIS'], valor: x.valor,
        descricao: nulo_(x.descricao) || (eFrete ? 'Frete' : 'Outros custos') + ' da compra de ' + br_(ev.event_date), partner_id: nulo_(x.partner_id), documento: nulo_(x.documento),
        parcelas: hist ? undefined : FinancialService.parcelasMensais(x.valor, nulo_(x.data_vencimento) || ev.event_date, nulo_(x.parcelas_qtd), { forma_pagamento: x.forma_pagamento, documento: x.documento }), semCaixa: hist,
        rateio: rateio, campo: 'custos', rotulo: (eFrete ? 'o frete' : 'o custo') + (custos.length > 1 ? ' ' + (k + 1) : ''),
        financial_id: idsCustos[proximoId++],
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
    var hist = ctxEv.ev.pre_marco_zero === true;
    var pl = FinancialService.planejar(m.tx, {
      evento: ev, conta: conta, naturezas: morte ? ['CUSTEIO'] : ['OUTRA_RECEITA'], valor: c[p + 'valor'],
      descricao: nulo_(c[p + 'descricao']) || (morte ? 'Custos da morte de ' : 'Receita do descarte de ') + br_(ev.event_date),
      partner_id: nulo_(c[p + 'partner_id']), documento: nulo_(c[p + 'documento']),
      parcelas: hist ? undefined : FinancialService.parcelasMensais(c[p + 'valor'], nulo_(c[p + 'vencimento']) || ev.event_date, nulo_(c[p + 'parcelas_qtd']), { forma_pagamento: c[p + 'forma_pagamento'], documento: c[p + 'documento'] }), semCaixa: hist,
      rateio: { criterio: 'CABECAS', itens: itens.map(function (it) { return { animal_id: it.animal_id, chave: it.codigo_interno, base: 1, quem: it.quem }; }), cemPorCento: true },
      campo: morte ? 'custo_conta_id' : 'receita_valor', rotulo: morte ? 'o custo da morte' : 'a receita do descarte', inativaAceita: usadoNoOriginal_(m, conta.conta_id),
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
    return Timeline.ultimaPesagem(m.f, animalId, data);
  }
  /**
   * Animal vendido (04, seção 4.3; 03b, seções 3.4 e 16.10): saída (−1) com a origem do cabeçalho (conferida pela
   * linha do tempo: ORIGEM_DIVERGENTE) ou, sem ela, a da linha do tempo no dia; peso vivo, carcaça, valor e motivo de
   * saída na linha; o peso vivo individual vira PESAGENS (VENDA). A situação VENDIDO é projeção; o histórico fica.
   */
  function itemVenda_(m, ctxEv, it) {
    var d = it.dados;
    var ev = ctxEv.ev;
    apontarExistente_(m, it);
    camposDoItem_(m, it, EventCatalog.camposAnimal('VENDA'), semAnimalId_(d));
    if (!sujeito_(m, it, 'vende')) return;
    // Venda anterior ao marco zero (importação): registro histórico, efeito 0, origem só a informada.
    var hist = ev.pre_marco_zero === true;
    var onde = hist ? { presente: false } : Timeline.pastoAntesDaSaida(m.f.linhas(it.animal_id), ev.event_date, m.D0);
    var origem = ctxEv.pastoOrigem || (onde.presente ? nulo_(onde.pasture_id) : null);
    it.origemDerivada = !ctxEv.pastoOrigem;
    var ea = { efeito_inventario: hist ? 0 : -1, pasto_origem_id: origem, motivo_saida: nulo_(d.motivo_saida), observacoes: nulo_(d.observacoes) };
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
    // A venda anterior ao marco zero (o histórico importado) não confere a carência: a aplicação também não confere a venda
    // histórica (carenciaContraVendas_), e o resultado da importação não pode depender da ordem dos arquivos.
    if (ctxEv.ev.pre_marco_zero === true) return;
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
      EventCatalog.validarCampos(defs, x, { listas: m.listas, desativados: m.desativados }).forEach(function (e) { erroGeral_(m, 'deducoes', e.codigo, quem + e.mensagem); });
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
    var hist = semCaixaHistorico_(m, ctxEv, d);
    var defsParcela = EventCatalog.camposGrupo('VENDA', 'parcelas');
    (d.parcelas || []).forEach(function (p, k) {
      EventCatalog.validarCampos(defsParcela, p && typeof p === 'object' ? p : {}, { listas: m.listas, desativados: m.desativados }).forEach(function (e) {
        if (e.campo === 'data_vencimento' || e.campo === 'valor') return; // vencimento e valor: FinancialService.resolverParcelas
        erroGeral_(m, 'parcelas', e.codigo, 'Parcela ' + (k + 1) + ': ' + e.mensagem);
      });
    });
    // Animal com erro ou repetido (ANIMAL_REPETIDO já apontado): sem conjunto de animais certo não há rateio a montar.
    if (!itens.length || itens.length !== ctxEv.itens.length || Utils.unicos(itens.map(function (it) { return it.animal_id; })).length !== itens.length) return;
    var bruto = typeof c.valor_bruto === 'number' ? c.valor_bruto : null;
    var desconto = typeof c.desconto_comercial === 'number' ? c.desconto_comercial : 0;
    // Bruto zero ou negativo o catálogo já recusou: comparar o desconto com ele só repetiria a causa.
    if (bruto !== null && bruto > 0 && desconto >= bruto) erroGeral_(m, 'desconto_comercial', 'VALOR_FORA_DA_FAIXA', 'O desconto (' + Utils.formatarReais(desconto) + ') precisa ser menor que o valor bruto da venda (' + Utils.formatarReais(bruto) + ').');
    var receita = bruto !== null && desconto < bruto ? bruto - desconto : null;
    var contaReceita = FinancialService.conta(m.repo, FinancialService.CONTAS.VENDA);
    // Na correção com os mesmos animais, data, modalidade e peso do lote, as bases estimadas do rateio (a última pesagem de
    // cada animal até a data) são as do original: a pesagem lançada depois não refaz a divisão da venda (Correcao.congelado).
    var basesCong = Correcao.congelado(ctxEv.correcao, 'VENDA.bases_estimadas', {
      data: ev.event_date, modalidade: c.modalidade, peso_vivo_total_kg: typeof c.peso_vivo_total_kg === 'number' ? c.peso_vivo_total_kg : null, conta_receita: contaReceita.conta_id,
      animais: itens.map(function (it) { return it.animal_id; }),
    });
    var neg = FinancialService.negociacao({
      modalidade: c.modalidade, base_peso: nulo_(c.base_peso), rendimento_carcaca_pct: typeof c.rendimento_carcaca_pct === 'number' ? c.rendimento_carcaca_pct : null,
      rendimento_tipo: nulo_(c.rendimento_tipo), preco_unitario: typeof c.preco_unitario === 'number' ? c.preco_unitario : null,
      peso_total_kg: typeof c.peso_vivo_total_kg === 'number' ? c.peso_vivo_total_kg : null,
      peso_carcaca_total_kg: typeof c.peso_carcaca_total_kg === 'number' ? c.peso_carcaca_total_kg : null, carcacaTotal: true,
      valor: receita, valor_conferencia: bruto, campo_valor: 'valor_bruto', rotulo_valor: 'a receita da venda (bruto menos desconto)',
      criterio_rateio: nulo_(c.criterio_rateio), arroba_kg: m.params.arroba_kg, tolerancia_pct: m.params.fin_tolerancia_conferencia_pct,
      animais: itens.map(function (it) { var n = it.negocio; return { chave: it.codigo_interno, peso: n.peso, peso_carcaca_kg: n.peso_carcaca_kg, valor_individual: n.valor_individual, base_manual: n.base_manual }; }),
      pesagens: itens.map(function (it) { return it.ultimaPesagem ? it.ultimaPesagem.peso_kg : null; }),
      bases_congeladas: basesCong ? basesCong.v : null,
    });
    var jaRecusados = recusadosNegocio_(m, itens);
    neg.erros.forEach(function (e) {
      // O campo do animal que o catálogo já recusou (fora da faixa, casas demais) também não leva um segundo erro.
      if (typeof e.indice === 'number') { if (!(itens[e.indice].camposComErro || {})[e.campo]) erroItem_(m, itens[e.indice], e.campo, e.codigo, e.mensagem); }
      else if (!jaRecusados[e.campo]) erroGeral_(m, e.campo, e.codigo, e.mensagem);
    });
    neg.avisos.forEach(function (a) { avisoItem_(m, null, a.codigo, a.mensagem); });
    ctxEv.negociacao = neg;
    if (neg.erros.length || receita === null) return;
    var n = itens.length;
    var rateioItens = itens.map(function (it, i) { return { animal_id: it.animal_id, chave: it.codigo_interno, base: neg.bases[i], quem: it.quem }; });
    var justificativa = neg.criterio === 'MANUAL' ? nulo_(c.justificativa_rateio)
      : neg.estimado ? 'Base estimada: última pesagem de cada animal até ' + br_(ev.event_date) + (neg.peso_vivo_total !== null ? ', ajustada ao peso vivo do lote (' + String(neg.peso_vivo_total).replace('.', ',') + ' kg).' : '.') : null;
    var rateio = { criterio: neg.criterio, itens: rateioItens, cemPorCento: true, justificativa: justificativa, estimado: neg.estimado };
    var planejados = [];
    var lancs = [];
    var principal = FinancialService.planejar(m.tx, {
      evento: ev, conta: contaReceita, naturezas: ['RECEITA_VENDA_ANIMAIS'], valor: receita, descricao: 'Venda de ' + plural_(n, 'animal', 'animais'),
      partner_id: c.partner_id, documento: nulo_(c.nota_fiscal), quantidade: n, parcelas: hist ? undefined : d.parcelas, semCaixa: hist, rateio: rateio,
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
      if (hist) venc = null; // sem caixa: a dedução histórica não tem título
      else if (retida) {
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
      // A descrição proposta leva o nome do tipo da dedução de quando a venda foi lançada (Correcao.congelado).
      var rotCong = vazio_(x.descricao) ? Correcao.congelado(ctxEv.correcao, 'VENDA.rotulo_deducao', { tipo: x.tipo }) : null;
      var pl = FinancialService.planejar(m.tx, {
        evento: ev, conta: conta, naturezas: ['DESPESA_VENDA'], valor: x.valor, descricao: nulo_(x.descricao) || (rotCong ? rotCong.v : nome) + ' da venda de ' + br_(ev.event_date),
        partner_id: nulo_(x.partner_id) || (retida ? nulo_(c.partner_id) : null), documento: nulo_(x.documento), retida: retida,
        parcelas: hist ? undefined : [{ data_vencimento: venc, valor: x.valor, forma_pagamento: nulo_(x.forma_pagamento), documento: nulo_(x.documento) }], semCaixa: hist,
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
      // Na sanidade retroativa, a carência que cobre uma venda que não foi para abate também é só aviso.
      if (a.codigo === 'CARENCIA_ATIVA' && (m.carenciaSemPolitica || (m.carenciaAvisa && m.carenciaAvisa.indexOf(a) >= 0))) p = 'AVISA';
      if (p === 'IGNORA') return;
      if (p === 'BLOQUEIA') m.col.erro(Validation.bloqueado(a));
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
  /**
   * Papel de cada lançamento de um evento gravado, na linguagem do resumo financeiro (ANIMAIS, FRETE, OUTRO, RECEITA,
   * DEDUCAO:<tipo>); sem papel próprio (morte, descarte, abertura), a conta. {financial_id: papel}.
   */
  function papeisGravados_(m, ev, fins) {
    var out = {};
    var codigo = function (f) { var c = m.repo.porId('PLANO_CONTAS', f.conta_id); return c ? c.codigo : null; };
    if (ev.event_type === 'COMPRA' && fins.length) {
      var custos = fins.filter(function (f) { if (codigo(f) !== 'COMPRA_ANIMAIS') return true; out[f.financial_id] = 'ANIMAIS'; return false; });
      var cp = m.repo.por('COMPRAS', 'event_id', ev.event_id)[0] || {};
      var tipos = FinancialService.tiposDosCustos(custos, cp.frete || 0);
      custos.forEach(function (f, i) { out[f.financial_id] = tipos ? tipos[i] : f.conta_id; });
    } else if (ev.event_type === 'VENDA' && fins.length) {
      var deducoes = {};
      ((ev.payload_json || {}).deducoes || []).forEach(function (x) { deducoes[x.financial_id] = x.tipo; });
      fins.forEach(function (f) { out[f.financial_id] = codigo(f) === 'VENDA_ANIMAIS' ? 'RECEITA' : deducoes[f.financial_id] ? 'DEDUCAO:' + deducoes[f.financial_id] : f.conta_id; });
    } else if (ev.event_type === 'SANIDADE') {
      // O consumo do produto do cadastro leva o produto; o serviço ou produto pago no ato, não.
      fins.forEach(function (f) { out[f.financial_id] = vazio_(f.product_id) ? 'SERVICO' : 'CONSUMO'; });
    } else if (ev.event_type === 'ESTOQUE') fins.forEach(function (f) { out[f.financial_id] = 'INSUMO'; });
    else fins.forEach(function (f) { out[f.financial_id] = f.conta_id; });
    return out;
  }
  /**
   * Na correção: lançamento do original → lançamento do substituto com o mesmo papel, na mesma ordem (o frete vai para
   * o frete, a comissão para a comissão). Lançamento sem par (custo retirado) fica de fora. {financial_id: financial_id}.
   */
  function lancamentosCorrespondentes_(m, ctxEv) {
    var finsOriginal = m.repo.por('FINANCEIRO', 'event_id', ctxEv.original.event_id);
    var finsNovos = ctxEv.plano.FINANCEIRO;
    var out = {};
    // Um lançamento só nos dois (morte, descarte, abertura): é o mesmo, ainda que a conta tenha mudado.
    if (finsOriginal.length === 1 && finsNovos.length === 1) { out[finsOriginal[0].financial_id] = finsNovos[0].financial_id; return out; }
    var papelNovo = {};
    if (ctxEv.tipo === 'COMPRA' || ctxEv.tipo === 'VENDA' || ctxEv.tipo === 'SANIDADE' || ctxEv.tipo === 'ESTOQUE') {
      ((ctxEv.financeiro && ctxEv.financeiro.lancamentos) || []).forEach(function (l) { papelNovo[l.financial_id] = l.papel === 'DEDUCAO' ? 'DEDUCAO:' + l.tipo_deducao : l.papel; });
    }
    var grupos = function (lista, papel) {
      var g = {};
      lista.forEach(function (f) { var p = papel[f.financial_id] || f.conta_id; (g[p] = g[p] || []).push(f); });
      return g;
    };
    // O original na ordem do identificador (a ordem física das linhas o dono pode classificar: 06, seção 12), o
    // substituto na ordem do pedido. Dentro do papel (o frete, o outro custo, a dedução), o lançamento do original casa
    // com o do substituto pelo parceiro e pelo valor; depois, só pelo parceiro; o que sobra casa pela posição só quando os
    // dois lados têm o mesmo número de itens. O que não casa (o item tirado) leva o documento para o evento.
    var antigos = grupos(Utils.ordenarPor(finsOriginal.slice(), 'financial_id'), papeisGravados_(m, ctxEv.original, finsOriginal));
    var novos = grupos(finsNovos, papelNovo);
    Object.keys(antigos).forEach(function (p) {
      var restam = antigos[p].slice();
      var livres = (novos[p] || []).slice();
      var casar = function (igual) {
        restam = restam.filter(function (a) {
          var i = -1;
          livres.some(function (n, k) { if (igual(a, n)) { i = k; return true; } return false; });
          if (i < 0) return true;
          out[a.financial_id] = livres[i].financial_id;
          livres.splice(i, 1);
          return false;
        });
      };
      casar(function (a, n) { return nulo_(a.partner_id) === nulo_(n.partner_id) && a.valor === n.valor; });
      casar(function (a, n) { return !vazio_(a.partner_id) && a.partner_id === n.partner_id; });
      if (restam.length === livres.length) restam.forEach(function (a, k) { out[a.financial_id] = livres[k].financial_id; });
    });
    return out;
  }
  /** No parto, as crias vivas cuja raça foi digitada (na ordem do lançamento); null quando nenhuma foi. */
  function racasInformadas_(ctxEv) {
    var ids = ctxEv.itens.filter(function (it) { return it.cria && it.racaInformada && it.animal_id; }).map(function (it) { return it.animal_id; });
    return ids.length ? ids : null;
  }
  /** Na aplicação por peso, os animais cuja dose foi digitada (na ordem do lançamento); null quando nenhuma foi. */
  function dosesInformadas_(ctxEv) {
    var ids = [];
    ctxEv.itens.forEach(function (it) { if (it.doseInformada && it.animal_id && ids.indexOf(it.animal_id) < 0) ids.push(it.animal_id); });
    return ids.length ? ids : null;
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
      // A baixa por divergência não grava AJUSTES: o porquê do lançamento fica no evento (BAIXAS guarda em que contagem faltou).
      motivo_ajuste: ctxEv.subtipo === 'DIVERGENCIA_CONTAGEM' ? nulo_(ctxEv.ev.justificativa) : ctxEv.estoque ? ctxEv.estoque.motivo : null,
      // Pesagem por lote (03b, seção 2.6): o peso total e as cabeças são o fato; o jejum vale para o lançamento.
      peso_total_lote_kg: ctxEv.pesagem && ctxEv.pesagem.lote ? ctxEv.pesagem.lote.total_kg : null,
      qtd_cabecas_lote: ctxEv.pesagem && ctxEv.pesagem.lote ? ctxEv.pesagem.lote.cabecas : null,
      jejum: ctxEv.pesagem && ctxEv.pesagem.jejum ? true : null,
      // Sanidade (03b, seção 2.6): o modo da dose, a dose de referência e a quantidade que saiu do frasco (o fato do consumo).
      modo_dose: ctxEv.sanidade ? ctxEv.sanidade.modo : null,
      dose_referencia: ctxEv.sanidade && ctxEv.sanidade.modo && ctxEv.sanidade.modo !== 'TOTAL' ? ctxEv.sanidade.doseRef : null,
      quantidade_consumida_total: ctxEv.sanidade ? ctxEv.sanidade.quantidade : null,
      // A marca do digitado (CONTRATOS, seção 54): a quantidade informada ou a soma das doses (a verificação confere a soma).
      quantidade_informada: ctxEv.sanidade && typeof ctxEv.sanidade.quantidade === 'number' ? ctxEv.sanidade.quantidadeInformada !== null : null,
      doses_informadas: ctxEv.sanidade && ctxEv.sanidade.modo === 'POR_PESO' ? dosesInformadas_(ctxEv) : null,
      // As marcas do digitado quando o valor gravado não diz (CONTRATOS, seção 54): a carência e o fabricante com o produto do
      // cadastro (o vazio o servidor copia do produto).
      carencia_informada: ctxEv.sanidade && typeof ctxEv.sanidade.carenciaInformada === 'boolean' ? ctxEv.sanidade.carenciaInformada : null,
      fabricante_informado: ctxEv.sanidade && ctxEv.sanidade.produto && ctxEv.sanidade.fabricanteInformado ? true : null,
      // O intervalo do protocolo que propôs a próxima aplicação (vazia no formulário) e a recorrência do protocolo: congelados
      // para a correção (Correcao.congelado: a correção com o mesmo protocolo não refaz a próxima pelo cadastro de hoje).
      intervalo_protocolo_dias: ctxEv.sanidade && typeof ctxEv.sanidade.intervaloProtocolo === 'number' ? ctxEv.sanidade.intervaloProtocolo : null,
      recorrencia_protocolo: ctxEv.sanidade && ctxEv.sanidade.protocolo ? nulo_(ctxEv.sanidade.recorrenciaProtocolo) : null,
      proxima_informada: ctxEv.sanidade && typeof ctxEv.sanidade.intervaloProtocolo === 'number' && ctxEv.sanidade.proximaInformada ? true : null,
      // Estoque (03b, seção 2.6): as embalagens e a quantidade por embalagem congelada; no acerto pela contagem, o saldo contado.
      qtd_apresentacao: ctxEv.estoque ? ctxEv.estoque.qtd_apresentacao : null,
      fator_conversao: ctxEv.estoque ? ctxEv.estoque.fator_conversao : null,
      saldo_contado: ctxEv.estoque ? ctxEv.estoque.saldo_contado : null,
      // A entrada com o movimento gravado (o controle de estoque no dia da compra, ou o do original na correção).
      com_movimento: ctxEv.estoque && ctxEv.subtipo === 'ENTRADA' && typeof ctxEv.estoque.comMovimento === 'boolean' ? ctxEv.estoque.comMovimento : null,
      // Castração e ocorrência (03b, seção 2.6): o método (texto livre) e o tipo da ocorrência (LISTAS.TIPO_OCORRENCIA).
      metodo: ctxEv.tipo === 'CASTRACAO' && typeof ctxEv.campos.metodo === 'string' ? nulo_(Utils.aparar(ctxEv.campos.metodo)) : null,
      tipo_ocorrencia: ctxEv.tipo === 'OCORRENCIA' ? nulo_(ctxEv.campos.tipo_ocorrencia) : null,
      // Parto sem cria viva com o pai informado: a certeza do pai (obrigatória com ele) não fica em cria nenhuma; fica no evento,
      // para a correção sem mudança (Correcao.entrada) levá-la como foi digitada.
      pai_confianca: ctxEv.tipo === 'NASCIMENTO' && ctxEv.parto && !ctxEv.parto.nascidos_vivos && !vazio_(ctxEv.campos.pai_id) ? nulo_(ctxEv.campos.pai_confianca) : null,
      // Parto com cria viva: o pasto das crias e a raça de cada cria digitados (o vazio o servidor tira da mãe).
      pasto_crias_informado: ctxEv.tipo === 'NASCIMENTO' && ctxEv.parto && ctxEv.parto.nascidos_vivos && ctxEv.pastoCriasInformado ? true : null,
      // Parto sem cria viva com o pasto informado: nenhuma linha o grava, e o digitado não some (a correção que torna a cria viva
      // a leva para ele, não para o da mãe; CONTRATOS, seção 54).
      pasto_destino_id: ctxEv.tipo === 'NASCIMENTO' && ctxEv.parto && !ctxEv.parto.nascidos_vivos && ctxEv.pastoCriasInformado ? ctxEv.pastoParto : null,
      racas_informadas: ctxEv.tipo === 'NASCIMENTO' ? racasInformadas_(ctxEv) : null,
    };
    ev.payload_json = payload_(m, ctxEv, extra);
    var itensPorAnimal = {};
    ctxEv.itens.forEach(function (it) { if (it.animal_id && !itensPorAnimal[it.animal_id]) itensPorAnimal[it.animal_id] = it; });
    var linhaEv = {};
    Object.keys(ev).forEach(function (k) { if (Schema.temColuna('EVENTOS', k)) linhaEv[k] = ev[k]; });
    ctxEv.plano.EVENTOS.push(linhaEv);
    // Correção: os anexos do original (nota fiscal, GTA, laudo, foto) passam ao substituto, que ocupa o lugar dele.
    if (ctxEv.original) {
      var correspondentes = lancamentosCorrespondentes_(m, ctxEv);
      ctxEv.plano.ANEXOS = FileService.anexosDoSubstituto(m.tx, ctxEv.original.event_id, { event_id: ev.event_id, lancamentos: correspondentes });
      // O documento do lançamento que a correção tira (sem correspondente no substituto) fica só no evento: a revisão diz.
      ctxEv.anexosSoltos = m.repo.por('ANEXOS', 'event_id', ctxEv.original.event_id).filter(function (a) { return a.status === 'ATIVO' && a.entidade === 'FINANCEIRO' && !correspondentes[a.entity_id]; }).map(function (a) { return a.nome_arquivo; });
    }
    // A baixa das parcelas pagas do original passa às do substituto (RN-046), antes de validar as linhas.
    if (ctxEv.original && !m.col.temErros()) transportarBaixas_(m, ctxEv);
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
        animais: animais.length, novos: ctxEv.plano.ANIMAIS.length, anulados: (ctxEv.anuladosCriados || []).length, voltam: (ctxEv.voltam || []).length, substitui: resumo.substitui,
        total_value: ev.total_value, abertura: ctxEv.abertura || null, pre_marco_zero: ev.pre_marco_zero === true,
        parto: ctxEv.parto || null, transferencia: ctxEv.transf || null, baixas: ctxEv.plano.BAIXAS.length, anexos: ctxEv.plano.ANEXOS.length,
        anexos_nomes: ctxEv.plano.ANEXOS.map(function (a) { return a.nome_arquivo; }), anexos_soltos: ctxEv.anexosSoltos || [],
        identificacoes: ctxEv.plano.IDENTIFICACOES.length, ajustes: ctxEv.plano.AJUSTES.length,
        marcacao: ctxEv.tipo === 'MARCACAO' ? { subtipo: ctxEv.subtipo, acao: ctxEv.ev.payload_json.acao, motivo_descarte: ctxEv.ev.payload_json.motivo_descarte } : null,
        compra: ctxEv.compra || null, venda: ctxEv.venda || null, financeiro: ctxEv.financeiro || null,
        pesagem: ctxEv.pesagem ? WeightService.resumoDoPlano(ctxEv.pesagem, ctxEv.plano.PESAGENS) : null,
        sanidade: ctxEv.sanidade ? resumoSanidade_(m, ctxEv) : null,
        estoque: ctxEv.estoque ? resumoEstoque_(ctxEv) : null,
        manejo: resumoManejo_(m, ctxEv),
      },
      derivados: { animais: animais, eventos: [ev.event_id].concat(ctxEv.original ? [ctxEv.original.event_id] : []), produtos: produtosDoComando_(m, ctxEv, ctxEv.original ? ctxEv.original.event_id : null) },
      resposta: function (t) { return resposta_(t, resumo); },
    };
  }

  /**
   * O que deixar de valer um conjunto de eventos (desfazer uma importação de eventos concluída: 06, seção 5.3) DEVOLVE aos
   * animais `ids` que esses eventos só tocaram: as mesmas conferências do estorno (brinco hoje de outro animal, sexo e
   * nascimento com os filhos, mãe e pai pela genealogia, categoria manual desativada). Devolve os conflitos (detalhes com
   * `conflito` do registro que impede), sem lançar; exige as leituras do motor e acesso cru.
   */
  function conferirRestauracao(tx, eventos, ids, verbo) {
    var m = motor_(tx, eventos || []);
    conferirEstadoRestaurado_(m, ids || [], verbo || 'sem esses lançamentos, o animal', null);
    conferirPeriodosDeBrinco_(m, null, ids || [], verbo || 'sem esses lançamentos, o animal');
    return m.conflitos;
  }

  /**
   * O estoque sem um conjunto de eventos (desfazer uma importação de manejo: as saídas das aplicações importadas deixam de
   * valer): a contagem posterior que já acertou o saldo de um dia que mudaria recusa (CONTAGEM_POSTERIOR, a mesma regra do
   * motor, com o caminho), em vez de a trava recusar com o texto dela. Devolve os conflitos, sem lançar.
   */
  function conferirEstoqueSem(tx, eventos, acao) {
    if (!tx.repo.carregada('MOVIMENTOS_ESTOQUE')) return [];
    var m = motor_(tx, eventos || []);
    var pids = {};
    (eventos || []).forEach(function (id) { m.repo.por('MOVIMENTOS_ESTOQUE', 'event_id', id).forEach(function (x) { pids[x.product_id] = true; }); });
    Object.keys(pids).forEach(function (pid) {
      var mv = movimentosAntesDepois_(m, null, pid);
      contagemPosterior_(m, m.repo.porId('PRODUTOS', pid), mv.antes, mv.depois, null, acao);
    });
    return m.conflitos;
  }

  // ------------------------------------------------------------------ estorno ----
  /**
   * O que o estorno cancela no financeiro (para a revisão: 08, 4.4): os lançamentos do evento, o valor e os títulos em
   * aberto, que deixam de valer pela vigência. null quando o evento não tem lançamento.
   */
  function canceladosDoEstorno_(m, alvo) {
    var fins = m.repo.por('FINANCEIRO', 'event_id', alvo.event_id);
    if (!fins.length) return null;
    var abertos = 0;
    var receitas = 0;
    var despesas = 0;
    fins.forEach(function (f) {
      abertos += m.repo.por('PARCELAS', 'financial_id', f.financial_id).filter(function (p) { return p.status === 'ABERTA'; }).length;
      if (f.tipo === 'RECEITA') receitas += f.valor || 0; else despesas += f.valor || 0;
    });
    // Receita e despesa não se somam (03b, seção 2.5: a venda gera uma receita e as deduções; 07, seção 1.2): cada
    // natureza vem à parte, e o total só existe quando os lançamentos são todos de uma natureza.
    return { lancamentos: fins.length, receitas: receitas, despesas: despesas, total: receitas && despesas ? null : receitas + despesas, parcelas_abertas: abertos };
  }
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
      linhaDoTempoSem_(m, it, ' Estorne esse registro antes.');
    });
    var ficam = animais.filter(function (id) { return !criados[id]; });
    conferirSequencias_(m, null, ficam, null);
    conferirEstadoRestaurado_(m, ficam, 'o estorno', null);
    conferirPeriodosDeBrinco_(m, null, ficam, 'o estorno');
    conferirParcelasLiquidadas_(m, alvo, 'estornar');
    // Insumo: o estorno da entrada (ou de um acerto que somou) que deixa o saldo negativo pede confirmação (RN-057).
    var produtos = produtosDoComando_(m, null, alvo.event_id);
    produtos.forEach(function (pid) {
      var mv = movimentosAntesDepois_(m, null, pid);
      avisoEstoque_(m, m.repo.porId('PRODUTOS', pid), mv.antes, mv.depois);
      contagemPosterior_(m, m.repo.porId('PRODUTOS', pid), mv.antes, mv.depois, null, { oque: 'este estorno', fazer: 'estorne o lançamento' });
    });
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
      impactos: { acao: 'estornar', estorna: alvo.event_id, event_type: alvo.event_type, event_subtype: nulo_(alvo.event_subtype), nome: EventCatalog.nomeEvento(alvo.event_type, alvo.event_subtype),
        event_date: alvo.event_date, animais: animais.length, anulados: Object.keys(criados).length, cancelados: canceladosDoEstorno_(m, alvo), corrige: originalDaCorrecao_(m, alvo) },
      derivados: { animais: animais, eventos: [alvo.event_id, id], produtos: produtos },
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
    var out = {
      acao: r.acao || null, event_id: r.event_id, event_type: ev ? ev.event_type : r.event_type, event_subtype: ev ? nulo_(ev.event_subtype) : null,
      event_date: ev ? ev.event_date : r.event_date, status: tx.cru ? tx.cru.avaliar(r.event_id).status : null,
      total_value: ev ? nulo_(ev.total_value) : null, substitui: r.substitui || null, estorna: r.estorna || null,
      animais: ids.map(function (id) { return animalPublico_(tx.cru ? tx.cru.cruPorId('ANIMAIS', id) : tx.repo.porId('ANIMAIS', id)); }).filter(Boolean),
    };
    // Pesagem (só no registro e na correção de uma PESAGEM; a resposta dos outros tipos não muda): a média, o total e a
    // comparação de cada animal com a pesagem anterior, calculados aqui (a tela só mostra).
    if (ev && ev.event_type === 'PESAGEM' && r.acao !== 'estornar') out.pesagem = WeightService.resultadoDoEvento(tx, r.event_id);
    // Sanidade e estoque (só nesses tipos; a resposta dos outros não muda): o saldo de cada produto movimentado, depois da
    // fase C, para a tela de resultado e o cadastro de produtos do aparelho (a tela só mostra).
    // Reprodução, desmama e castração (só nesses tipos; a resposta dos outros não muda): a situação reprodutiva, a cria ao pé,
    // a categoria e a previsão de parto de cada animal depois da fase C (a tela de resultado e a loja só mostram).
    if (ev && r.acao !== 'estornar' && (ev.event_type === 'REPRODUCAO' || ev.event_type === 'DESMAMA' || ev.event_type === 'CASTRACAO')) out.reproducao = ReproductionService.resultadoDoEvento(tx, r.event_id);
    var alvoEv = ev && r.acao === 'estornar' ? (tx.cru ? tx.cru.cruPorId('EVENTOS', alvo) : null) : ev;
    if (alvoEv && (alvoEv.event_type === 'SANIDADE' || alvoEv.event_type === 'ESTOQUE')) {
      var movs = (tx.cru ? tx.cru.cruPor('MOVIMENTOS_ESTOQUE', 'event_id', alvo) : []).concat(r.acao === 'corrigir' && r.substitui && tx.cru ? tx.cru.cruPor('MOVIMENTOS_ESTOQUE', 'event_id', r.substitui) : []);
      out.produtos = Utils.unicos(movs.map(function (x) { return x.product_id; })).map(function (pid) { return HealthService.produtoPublico(tx.repo, tx.repo.porId('PRODUTOS', pid)); }).filter(Boolean);
    }
    return out;
  }
  function leiturasConsulta_() {
    return Timeline.LEITURAS.concat(['PROPRIEDADES', 'BAIXAS', 'COMPRAS', 'VENDAS', 'ANEXOS', 'PLANO_CONTAS'], EventCatalog.LEITURAS_INSUMOS);
  }
  /**
   * Totais de uma venda gravada (FinancialService.totaisVenda sobre a linha de VENDAS e os lançamentos de dedução do
   * evento, com o tipo de cada um pelo papel e a retenção pelo lançamento); null fora da venda.
   */
  function totaisDaVendaGravada_(detalhes, papeis) {
    var vd = (detalhes.VENDAS || [])[0];
    if (!vd) return null;
    var deducoes = (detalhes.FINANCEIRO || []).filter(function (f) { return /^DEDUCAO:/.test(papeis[f.financial_id] || ''); }).map(function (f) {
      return { tipo: papeis[f.financial_id].slice('DEDUCAO:'.length), valor: f.valor, retida: f.retida_pelo_comprador === true };
    });
    return FinancialService.totaisVenda({ valor_bruto: vd.valor_bruto, desconto_comercial: vd.desconto_comercial || 0, deducoes: deducoes });
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
      sanidade: ev.event_type === 'SANIDADE' ? sanidadeDoItem_(tx, ev.event_id) : null,
    };
  }
  /**
   * O produto (do cadastro, pelo nome congelado, ou o nome livre) e o diagnóstico da SANIDADE, para a lista de aplicações:
   * eles ficam nos registros SANIDADE, não no payload (um lançamento é um procedimento com um produto).
   */
  function sanidadeDoItem_(tx, eventId) {
    var r0 = tx.repo.carregada('SANIDADE') ? tx.cru.cruPor('SANIDADE', 'event_id', eventId)[0] : null;
    if (!r0) return null;
    return { produto_id: nulo_(r0.produto_id), nome_produto: nulo_(r0.nome_produto), diagnostico: nulo_(r0.diagnostico), tipo_procedimento: nulo_(r0.tipo_procedimento) };
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
        // Mais recentes primeiro, com o substituto na posição do evento que ele corrige (desenho-base 16.1): a correção
        // não vira o lançamento mais recente do dia.
        var fonte = Timeline.fonte(tx);
        var pos = {};
        lista.forEach(function (ev) { pos[ev.event_id] = fonte.ordemSeq(ev.event_id) || ev.event_seq || 0; });
        lista.sort(function (a, b) { return (a.event_date < b.event_date ? 1 : a.event_date > b.event_date ? -1 : 0) || (pos[b.event_id] - pos[a.event_id]) || (b.event_seq - a.event_seq); });
        var inicio = (pagina - 1) * porPagina;
        return { total: lista.length, pagina: pagina, por_pagina: porPagina, itens: lista.slice(inicio, inicio + porPagina).map(function (ev) { return eventoPublico_(tx, ev); }) };
      },
    };
  }
  /**
   * Consulta evento.obter: cabeçalho, situação, animais, todas as linhas de detalhe do evento (inclusive se anulado) e os
   * anexos dele e dos lançamentos dele (FileService.anexosDoEvento; os de evento anulado, como histórico).
   */
  function consultaObter(dados) {
    var o = dados || {};
    return {
      rota: 'evento.obter', dados: o, reads: leiturasConsulta_(), acessoCru: true,
      tratador: function (tx) {
        var ev = vazio_(o.event_id) ? null : tx.cru.cruPorId('EVENTOS', o.event_id);
        var st = ev ? tx.cru.avaliar(ev.event_id).status : null;
        if (!ev || st === 'FALHOU' || st === 'PENDENTE') throw Validation.erro('NOT_FOUND', 'Evento não encontrado.');
        var detalhes = {};
        ['IDENTIFICACOES', 'PESAGENS', 'REPRODUCAO', 'BAIXAS', 'AJUSTES', 'SANIDADE', 'MOVIMENTOS_ESTOQUE', 'COMPRAS', 'VENDAS', 'FINANCEIRO', 'RATEIOS'].forEach(function (t) {
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
        // Papel de cada lançamento e os totais da venda pelas mesmas funções que gravam: a tela só exibe (§20, regra 8).
        var leitor = { repo: { porId: function (t, id) { return tx.repo.porId(t, id); }, por: function (t, c, v) { return tx.cru.cruPor(t, c, v); } } };
        var papeis = papeisGravados_(leitor, ev, detalhes.FINANCEIRO);
        var aval = tx.cru.avaliar(ev.event_id);
        // A entrada sem mudança do evento que vale (a prévia da correção: a tela só a mostra; CONTRATOS, seção 50).
        var correcao = aval.vigente && ev.event_type !== 'ESTORNO' && EventCatalog.ativo(ev.event_type, nulo_(ev.event_subtype))
          ? Correcao.entrada({ por: function (tb, c, v) { return tx.cru.cruPor(tb, c, v).map(Utils.clonar); }, porId: function (tb, id) { return tx.cru.cruPorId(tb, id) || tx.repo.porId(tb, id); } }, ev) : null;
        return {
          evento: eventoPublico_(tx, ev), linhas: linhas, detalhes: detalhes, anexos: FileService.anexosDoEvento(tx.cru, ev.event_id), anula: anula ? eventoPublico_(tx, anula) : null,
          papeis: papeis, totais_venda: totaisDaVendaGravada_(detalhes, papeis), correcao: correcao,
        };
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
    planejarEventoImportado: planejarEventoImportado,
    leiturasEvento: leiturasEvento,
    conferirRestauracao: conferirRestauracao,
    conferirEstoqueSem: conferirEstoqueSem,
    HISTORICO_IMPORTADO: HISTORICO_IMPORTADO,
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
