/**
 * AnimalService — rebanho (E1.7 e E1.8, backend): lista leve em colunas para a carga inicial (ATIVOS e EXTERNOS) e
 * para os baixados sob demanda (08, seções 3 e 10); ficha do animal com os blocos A a J (§5.1); edição em um
 * formulário só — campos de cadastro [cad] com AUDITORIA e campos sensíveis como AJUSTE_INVENTARIO /
 * CORRECAO_CADASTRO pelo EventService, na MESMA operação (DV-07); cadastro de animal EXTERNO (DV-06).
 *
 * Idade, categoria e peso vigente são calculados na leitura, nunca gravados (DV-08, DV-09; desenho-base, seção 6).
 * O "leitor" (`leitor(tx)`) junta, para uma consulta, a fonte da linha do tempo, os parâmetros e as categorias; é
 * reaproveitado por PastureService e InventoryService. Puro: lê por `tx.repo`/`tx.cru` e escreve só no plano.
 */
var AnimalService = (function () {
  /** Campos [cad] do animal: comando direto com AUDITORIA. */
  var CAMPOS_CADASTRO = ['nome', 'raca', 'observacoes', 'foto_anexo_id'];
  /** Atributos do cadastro de referência do EXTERNO (AuditService, exceção do EXTERNO). */
  var CAMPOS_EXTERNO = ['sexo', 'data_nascimento', 'data_nascimento_confianca'];
  var CAMPOS_NOVO_EXTERNO = ['nome', 'sexo', 'raca', 'data_nascimento', 'data_nascimento_confianca', 'observacoes'];
  var MSG_BRINCO = 'O brinco não se troca aqui: use "Pôr ou trocar brinco" ou, se foi lançado errado, "Corrigir identificação".';
  var MSG_PASTO = 'O pasto muda por transferência; se o registro está errado, use "Corrigir localização".';
  var NAO_EDITAVEIS = {
    brinco: MSG_BRINCO, brinco_norm: MSG_BRINCO, pasto_atual_id: MSG_PASTO, propriedade_atual_id: MSG_PASTO,
    situacao_cadastral: 'A situação do animal muda pelos lançamentos (entrada, venda, morte).',
    codigo_interno: 'O código interno é fixo e não muda.', animal_id: 'O identificador do animal não muda.',
  };
  var SITUACOES_CARGA = ['ATIVO', 'EXTERNO'];
  var SITUACOES_BAIXADOS = ['VENDIDO', 'MORTO', 'DESCARTADO', 'BAIXADO_AJUSTE', 'HISTORICO'];
  /** Colunas da lista leve (08, seção 10, e o que o store usa em seletores, filtros e genealogia). */
  var COLUNAS_LEVE = ['animal_id', 'codigo_interno', 'brinco', 'brinco_norm', 'nome', 'sexo', 'raca', 'data_nascimento',
    'data_nascimento_confianca', 'idade_meses', 'categoria_id', 'categoria_manual', 'peso_atual', 'data_ultima_pesagem',
    'peso_vencido', 'pasto_atual_id', 'propriedade_atual_id', 'situacao_cadastral', 'data_entrada', 'data_saida', 'mae_id',
    'pai_id', 'castrado', 'reprodutor', 'situacao_reprodutiva', 'cria_ao_pe', 'marcado_descarte', 'nao_localizado',
    'foto_anexo_id', 'carencia_ate'];
  var GERACOES_PADRAO = 3;
  var GERACOES_MAX = 6;
  /** Blocos da ficha cujo módulo ainda não foi entregue: voltam vazios, com a marca (§20: nada sem função). */
  var BLOCOS_DE_MODULO = {};

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function nulo_(v) {
    return vazio_(v) ? null : v;
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
  function ehObjeto_(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }
  function nomeAnimal_(a) {
    if (!a) return 'animal';
    return !vazio_(a.brinco) ? a.brinco : !vazio_(a.nome) && a.situacao_cadastral === 'EXTERNO' ? a.nome : a.codigo_interno;
  }
  /** Posição do evento na ordem do dia: a do primeiro da cadeia de substituição (desenho-base 16.1), depois o event_seq. */
  function posicaoDe_(L, eventId) {
    var ev = L.f.evento(eventId);
    return ev ? { ord: L.f.ordemSeq(eventId) || 0, seq: ev.event_seq || 0 } : { ord: 0, seq: 0 };
  }
  function depoisOuIgual_(a, b) {
    return a.ord > b.ord || (a.ord === b.ord && a.seq >= b.seq);
  }
  function listasAtivas_(repo) {
    var out = {};
    if (!repo.carregada('LISTAS')) return out;
    repo.vigentes('LISTAS').forEach(function (l) {
      if (l.ativo === false) return;
      (out[l.lista] = out[l.lista] || []).push(l.codigo);
    });
    return out;
  }

  // ------------------------------------------------------------------ leitor e cálculos na leitura ----
  /** Abas que toda consulta de animal lê (o leitor). */
  function leituras() {
    // SANIDADE: a carência de hoje na lista leve (o selo "em carência até" no rebanho e na venda).
    return ['ANIMAIS', 'EVENTO_ANIMAIS', 'EVENTOS', 'IDENTIFICACOES', 'PESAGENS', 'REPRODUCAO', 'AJUSTES', 'PASTOS',
      'CONFIGURACOES', 'CATEGORIAS', 'SANIDADE'];
  }
  /**
   * Contexto de leitura de uma consulta: {tx, repo, f (Timeline.fonte), params, marcoZero, hoje, categorias,
   * categoriaPorId, animais (vigentes), filhosMae, filhosPai, memo}. A consulta precisa declarar `leituras()`.
   * opcoes: {fonte, parametros} — o motor de eventos passa a própria fonte (com os eventos excluídos da correção e as
   * linhas do lançamento em análise) para calcular categoria e peso vigente pelas mesmas regras das consultas.
   * `memo` guarda a categoria de cada animal em cada data durante a consulta (o leitor vale para uma leitura só).
   */
  function leitor(tx, opcoes) {
    var o = opcoes || {};
    if (vazio_(tx.hoje)) throw Validation.erro('INTERNAL', 'Contexto sem fuso: não há como saber a data de hoje.');
    var params = o.parametros || Config.parametros(tx.repo);
    var categorias = tx.repo.carregada('CATEGORIAS') ? tx.repo.vigentes('CATEGORIAS') : [];
    var animais = tx.repo.vigentes('ANIMAIS');
    var filhosMae = {};
    var filhosPai = {};
    animais.forEach(function (a) {
      if (!vazio_(a.mae_id)) (filhosMae[a.mae_id] = filhosMae[a.mae_id] || []).push(a);
      if (!vazio_(a.pai_id)) (filhosPai[a.pai_id] = filhosPai[a.pai_id] || []).push(a);
    });
    return {
      tx: tx, repo: tx.repo, f: o.fonte || Timeline.fonte(tx, { parametros: params }), params: params, marcoZero: params.data_marco_zero,
      hoje: tx.hoje, categorias: categorias, categoriaPorId: Utils.indexarPor(categorias, 'category_id'), animais: animais,
      filhosMae: filhosMae, filhosPai: filhosPai, memo: Object.create(null),
    };
  }
  /** Idade em meses completos na data (03a, seção 4.5); null sem nascimento ou antes dele. */
  function idadeEm(animal, data) {
    if (!animal || vazio_(animal.data_nascimento) || !Utils.dataValida(data)) return null;
    var m = Utils.idadeMeses(animal.data_nascimento, data);
    return m < 0 ? null : m;
  }
  /** Atributo de criação com a última correção vigente (sem eventos que o mudam depois, como a castração). */
  function atributoBase_(L, id, campo) {
    var criacao = null;
    L.f.linhas(id).forEach(function (l) {
      if (l.atributos && (!criacao || l.ordem_seq > criacao.ordem_seq || (l.ordem_seq === criacao.ordem_seq && l.event_seq > criacao.event_seq))) criacao = l;
    });
    var v = criacao ? criacao.atributos[campo] : null;
    var ultima = null;
    L.f.ajustes(id).forEach(function (x) {
      if (x.tipo_ajuste !== 'CORRECAO_CADASTRO' || x.campo !== campo) return;
      var pos = posicaoDe_(L, x.event_id);
      if (!ultima || depoisOuIgual_(pos, ultima.pos)) ultima = { pos: pos, valor: x.valor_novo };
    });
    if (ultima) v = ultima.valor;
    return v === true || v === 'S';
  }
  function paridaEm_(L, a, data) {
    if (typeof a.partos_previos === 'number' && a.partos_previos >= 1) return true;
    if (L.f.reproducao(a.animal_id).some(function (r) { return r.tipo_evento === 'PARTO' && r.data <= data; })) return true;
    return (L.filhosMae[a.animal_id] || []).some(function (c) { return vazio_(c.data_nascimento) || c.data_nascimento <= data; });
  }
  /**
   * Perfil do animal na data D para a classificação (05, seção 4.9): sexo e nascimento (projeção: as correções
   * valem para todo o histórico); castrado e reprodutor em D (castração posterior a D não conta); parida em D
   * (partos anteriores declarados, parto vigente até D ou cria cadastrada nascida até D); reclassificação vigente
   * em D.
   */
  function perfilEm(L, a, data) {
    var id = a.animal_id;
    var macho = a.sexo === 'M';
    var castrado = macho ? a.castrado === true : null;
    var reprodutor = macho ? a.reprodutor === true : null;
    if (macho) {
      var castracoes = L.f.linhas(id).filter(function (l) { return l.event_type === 'CASTRACAO'; }).map(function (l) { return l.event_date; }).sort();
      if (castracoes.length && castracoes[0] > data) {
        castrado = atributoBase_(L, id, 'castrado');
        reprodutor = castrado ? false : atributoBase_(L, id, 'reprodutor');
      }
    }
    var reclass = null;
    L.f.ajustes(id).forEach(function (x) {
      if (x.tipo_ajuste !== 'RECLASSIFICACAO') return;
      var ev = L.f.evento(x.event_id);
      if (!ev || ev.event_date > data) return;
      // Mesma ordem do projetor: data, posição na cadeia de substituição (o substituto fica no lugar do original), event_seq.
      var ord = L.f.ordemSeq(x.event_id);
      if (!reclass || ev.event_date > reclass.data || (ev.event_date === reclass.data && (ord > reclass.ord || (ord === reclass.ord && ev.event_seq >= reclass.seq)))) reclass = { data: ev.event_date, ord: ord, seq: ev.event_seq, valor: x.valor_novo };
    });
    var manual = !!reclass && !vazio_(reclass.valor);
    return {
      sexo: a.sexo, data_nascimento: nulo_(a.data_nascimento), castrado: castrado, reprodutor: reprodutor,
      parida: a.sexo === 'F' ? paridaEm_(L, a, data) : false,
      categoria_modo: manual ? 'MANUAL' : 'AUTO', categoria_manual_id: manual ? reclass.valor : null,
    };
  }
  /** Categoria em D: {category_id, codigo, nome, manual} ou null ("sem categoria", RN-098). Memorizada no leitor. */
  function categoriaEm(L, a, data) {
    var k = 'c|' + a.animal_id + '|' + data;
    if (L.memo && k in L.memo) return L.memo[k];
    var c = EventService.classificarCategoria(perfilEm(L, a, data), data, L.categorias);
    if (L.memo) L.memo[k] = c;
    return c;
  }
  /**
   * Peso vigente em D (desenho-base, seção 6): última pesagem até D dentro de `peso_validade_dias` → PESADO; vencida
   * → o maior entre o último peso e o `peso_referencia_kg` da categoria, estimado (PESAGEM_VENCIDA); sem pesagem →
   * o peso de referência, estimado (SEM_PESAGEM); sem os dois → SEM_PESO (kg null, nunca zero).
   * Devolve {kg, situacao, estimado, data_pesagem, metodo, referencia_kg}.
   */
  function pesoVigente(L, a, data, categoria) {
    var ult = null;
    L.f.pesagens(a.animal_id).forEach(function (p) {
      if (p.data_pesagem > data || typeof p.peso_kg !== 'number') return;
      var pos = posicaoDe_(L, p.event_id);
      if (!ult || p.data_pesagem > ult.data || (p.data_pesagem === ult.data && depoisOuIgual_(pos, ult.pos))) ult = { data: p.data_pesagem, kg: p.peso_kg, metodo: p.metodo, pos: pos };
    });
    var cat = categoria ? L.categoriaPorId[categoria.category_id] : null;
    var ref = cat && typeof cat.peso_referencia_kg === 'number' ? cat.peso_referencia_kg : null;
    var validade = L.params.peso_validade_dias;
    if (ult && (typeof validade !== 'number' || Utils.diffDias(ult.data, data) <= validade)) {
      return { kg: ult.kg, situacao: 'PESADO', estimado: false, data_pesagem: ult.data, metodo: ult.metodo, referencia_kg: ref };
    }
    if (ult) return { kg: ref !== null && ref > ult.kg ? ref : ult.kg, situacao: 'PESAGEM_VENCIDA', estimado: true, data_pesagem: ult.data, metodo: ult.metodo, referencia_kg: ref };
    if (ref !== null) return { kg: ref, situacao: 'SEM_PESAGEM', estimado: true, data_pesagem: null, metodo: null, referencia_kg: ref };
    return { kg: null, situacao: 'SEM_PESO', estimado: false, data_pesagem: null, metodo: null, referencia_kg: null };
  }
  /** Data de referência dos cálculos: hoje para quem está no rebanho; a data da saída para o baixado. */
  function dataReferencia_(L, a) {
    return a.situacao_cadastral === 'ATIVO' || a.situacao_cadastral === 'EXTERNO' || vazio_(a.data_saida) ? L.hoje : a.data_saida;
  }

  // ------------------------------------------------------------------ lista leve (colunar) ----
  /** Uma linha da lista leve (objeto com as COLUNAS_LEVE), com idade e categoria calculadas. */
  function linhaLeve(L, a) {
    var ref = dataReferencia_(L, a);
    var cat = a.situacao_cadastral === 'EXTERNO' ? null : categoriaEm(L, a, ref);
    var validade = L.params.peso_validade_dias;
    var l = {};
    COLUNAS_LEVE.forEach(function (c) { l[c] = a[c] === undefined ? null : nulo_(a[c]); });
    l.idade_meses = idadeEm(a, ref);
    l.categoria_id = cat ? cat.category_id : null;
    l.categoria_manual = cat ? cat.manual : false;
    l.peso_vencido = a.situacao_cadastral === 'ATIVO' && !vazio_(a.data_ultima_pesagem) && typeof validade === 'number' ? Utils.diffDias(a.data_ultima_pesagem, L.hoje) > validade : null;
    // O último dia da carência sanitária de hoje (RN-072), calculado aqui pela mesma regra da venda; a tela só mostra.
    l.carencia_ate = HealthService.carenciaHoje(L, a);
    return l;
  }
  function colunar_(L, animais) {
    var valores = {};
    COLUNAS_LEVE.forEach(function (c) { valores[c] = []; });
    Utils.ordenarPor(animais, 'codigo_interno').forEach(function (a) {
      var l = linhaLeve(L, a);
      COLUNAS_LEVE.forEach(function (c) { valores[c].push(l[c]); });
    });
    return { data: L.hoje, n: animais.length, colunas: COLUNAS_LEVE.slice(), valores: valores };
  }
  /**
   * Consulta da carga inicial (parte de `sistema.bootstrap`): ATIVOS e EXTERNOS em colunas
   * {data, n, colunas, valores: {coluna: [valores na ordem de codigo_interno]}}.
   */
  function consultaCargaInicial() {
    return {
      rota: 'sistema.bootstrap', reads: leituras(), acessoCru: true,
      tratador: function (tx) {
        var L = leitor(tx);
        return colunar_(L, L.animais.filter(function (a) { return SITUACOES_CARGA.indexOf(a.situacao_cadastral) >= 0; }));
      },
    };
  }
  /**
   * Consulta `animal.listar` (baixados sob demanda): filtros {situacoes: [...]} (padrão: VENDIDO, MORTO,
   * DESCARTADO, BAIXADO_AJUSTE e HISTORICO; aceita também ATIVO e EXTERNO). PENDENTE e ANULADO nunca aparecem.
   * Mesmo formato colunar da carga inicial.
   */
  function consultaListar(filtros) {
    var o = filtros || {};
    return {
      rota: 'animal.listar', dados: o, reads: leituras(), acessoCru: true,
      tratador: function (tx) {
        var sit = vazio_(o.situacoes) ? SITUACOES_BAIXADOS : o.situacoes;
        var validas = SITUACOES_CARGA.concat(SITUACOES_BAIXADOS);
        if (!Array.isArray(sit) || !sit.length || sit.some(function (s) { return validas.indexOf(s) < 0; })) {
          throw Validation.erro('VALIDATION', 'Escolha situações do rebanho válidas (ativos, vendidos, mortos, descartados, baixados na contagem, do histórico ou de fora do rebanho).', [Validation.detalhe({ codigo: 'VALOR_FORA_DA_LISTA', campo: 'situacoes', mensagem: 'Situação desconhecida.' })]);
        }
        var L = leitor(tx);
        return colunar_(L, L.animais.filter(function (a) { return sit.indexOf(a.situacao_cadastral) >= 0; }));
      },
    };
  }

  // ------------------------------------------------------------------ ficha ----
  function resumo_(a) {
    return {
      animal_id: a.animal_id, codigo_interno: a.codigo_interno, brinco: nulo_(a.brinco), nome: nulo_(a.nome), sexo: nulo_(a.sexo),
      data_nascimento: nulo_(a.data_nascimento), data_nascimento_confianca: nulo_(a.data_nascimento_confianca),
      situacao_cadastral: a.situacao_cadastral, rotulo: nomeAnimal_(a),
    };
  }
  function noArvore_(L, id, confianca, geracao, maximo, caminho) {
    if (vazio_(id)) return null;
    var p = L.repo.porId('ANIMAIS', id);
    var base = { confianca: nulo_(confianca), confirmado: confianca === 'CONFIRMADA', geracao: geracao };
    if (!p) return Object.assign({ animal_id: id, disponivel: false, mae: null, pai: null, tem_ancestrais: false }, base);
    var n = resumo_(p);
    Object.keys(base).forEach(function (k) { n[k] = base[k]; });
    n.disponivel = true;
    n.mae = null;
    n.pai = null;
    n.tem_ancestrais = !vazio_(p.mae_id) || !vazio_(p.pai_id);
    if (caminho[id]) { n.ciclo = true; return n; }
    if (geracao >= maximo) return n;
    var c = {};
    Object.keys(caminho).forEach(function (k) { c[k] = true; });
    c[id] = true;
    n.mae = noArvore_(L, p.mae_id, p.mae_confianca, geracao + 1, maximo, c);
    n.pai = noArvore_(L, p.pai_id, p.pai_confianca, geracao + 1, maximo, c);
    return n;
  }
  /**
   * Genealogia (§5.2; 08, seção 3): mãe e pai com a confiança do vínculo, árvore até `geracoes` gerações (1 = pais,
   * 2 = avós, 3 = bisavós) e todas as crias (de mãe e de pai). Vínculo para animal inexistente ou anulado aparece
   * como `disponivel: false` (erro de integridade, nunca escondido).
   */
  function genealogia(L, a, geracoes) {
    var max = geracoes === undefined || geracoes === null ? GERACOES_PADRAO : geracoes;
    var arvore = noArvore_(L, a.animal_id, null, 0, max, {});
    var filhos = [];
    (L.filhosMae[a.animal_id] || []).forEach(function (c) { var r = resumo_(c); r.papel = 'MAE'; r.confianca = nulo_(c.mae_confianca); filhos.push(r); });
    (L.filhosPai[a.animal_id] || []).forEach(function (c) { var r = resumo_(c); r.papel = 'PAI'; r.confianca = nulo_(c.pai_confianca); filhos.push(r); });
    return {
      entregue: true, sem_genealogia: vazio_(a.mae_id) && vazio_(a.pai_id), geracoes: max,
      mae: arvore.mae, pai: arvore.pai, arvore: arvore,
      filhos: Utils.ordenarPor(filhos, ['data_nascimento', 'codigo_interno']), total_filhos: filhos.length,
    };
  }
  /** Períodos de permanência por pasto ([início, fim), fim vazio = em andamento), a partir do marco zero (Timeline.estadas). */
  function periodos_(L, a) {
    var out = Timeline.estadas(L.f.linhas(a.animal_id));
    out.forEach(function (p) {
      var pst = L.f.pasto(p.pasture_id);
      p.pasto_nome = pst ? pst.nome : null;
      p.em_andamento = p.fim === null;
      p.dias = Utils.diffDias(p.inicio, p.fim === null ? L.hoje : p.fim);
    });
    return out;
  }
  /** Dias de permanência somados por pasto (o dia da saída não conta; período aberto conta até hoje). */
  function diasPorPasto_(periodos) {
    var g = {};
    periodos.forEach(function (p) {
      var k = p.pasture_id || '';
      var x = g[k] = g[k] || { pasture_id: p.pasture_id, pasto_nome: p.pasto_nome, dias: 0, periodos: 0, atual: false };
      x.dias += p.dias;
      x.periodos++;
      if (p.em_andamento) x.atual = true;
    });
    return Utils.ordenarPor(Object.keys(g).map(function (k) { return g[k]; }), [{ campo: 'dias', desc: true }, 'pasto_nome']);
  }
  /**
   * Bloco H (§11.2): custo de aquisição e lançamentos do animal a partir das alocações (FinancialService.blocoFicha).
   * Parcial na Fase 2: rateio de custos compartilhados, baixa de parcelas e custos por animal chegam com o Financeiro.
   */
  function blocoFinanceiro_(tx, L, a) {
    // A passagem atual começa na entrada vigente mais recente (a mesma fronteira do custo de aquisição, 03a DL-08).
    var entrada = Timeline.projetarAnimal(L.f, a.animal_id).meta.entradaCusto;
    var b = FinancialService.blocoFicha(tx.repo, a, { desde: entrada ? entrada.event_date : null });
    var m = EventCatalog.modulo('FINANCEIRO');
    b.parcial = true;
    b.pendente = { modulo: 'FINANCEIRO', fase: m ? m.fase : null, mensagem: 'O rateio de custos gerais (pasto, mão de obra, insumos) e o custo completo por animal chegam com o módulo Financeiro.' };
    return b;
  }
  function moduloNaoEntregue_(modulo) {
    var m = EventCatalog.modulo(modulo);
    return {
      entregue: false, modulo: modulo, fase: m ? m.fase : null, itens: [],
      mensagem: (m ? m.rotulo : modulo) + ' ainda não está disponível no sistema: chega numa próxima etapa.',
    };
  }
  function eventos_(tx, L, a) {
    var porEvento = Utils.agruparPor(tx.cru.cruPor('EVENTO_ANIMAIS', 'animal_id', a.animal_id), 'event_id');
    var itens = [];
    Object.keys(porEvento).forEach(function (eid) {
      var ev = tx.cru.cruPorId('EVENTOS', eid);
      if (!ev) return;
      var av = tx.cru.avaliar(eid);
      if (av.status === 'FALHOU' || av.status === 'PENDENTE') return;
      var l = porEvento[eid][0];
      var def = EventCatalog.existe(ev.event_type) ? EventCatalog.tipo(ev.event_type) : null;
      var sub = def && def.subtipos && !vazio_(ev.event_subtype) ? def.subtipos[ev.event_subtype] : null;
      itens.push({
        // Ordem canônica (desenho-base 4.3 e 16.1): data, classe da linha (entrada, movimento, saída) e a posição na cadeia
        // de substituição — corrigir um lançamento não muda a ordem dos movimentos do dia.
        ordem_: { classe: Timeline.classe({ efeito: l.efeito_inventario, event_type: ev.event_type }), posicao: L.f.ordemSeq(eid) || ev.event_seq || 0 },
        event_id: ev.event_id, event_seq: ev.event_seq, event_type: ev.event_type, event_subtype: nulo_(ev.event_subtype),
        rotulo: def ? def.rotulo : ev.event_type, rotulo_subtipo: sub ? sub.rotulo : null, event_date: ev.event_date,
        registration_date: ev.registration_date, status: av.status, vigente: av.vigente, anulado_por: av.anulador_id,
        reversal_of_event_id: nulo_(ev.reversal_of_event_id), pre_marco_zero: ev.pre_marco_zero === true,
        description: nulo_(ev.description), papel: l.papel, efeito: l.efeito_inventario, pasto_origem_id: nulo_(l.pasto_origem_id),
        pasto_destino_id: nulo_(l.pasto_destino_id),
        ajustes: tx.cru.cruPor('AJUSTES', 'event_id', eid).filter(function (x) { return x.animal_id === a.animal_id; }).map(function (x) {
          return { tipo_ajuste: x.tipo_ajuste, campo: x.campo, valor_anterior: nulo_(x.valor_anterior), valor_novo: nulo_(x.valor_novo), justificativa: nulo_(x.justificativa) };
        }),
      });
    });
    itens.sort(function (x, y) {
      return (x.event_date < y.event_date ? -1 : x.event_date > y.event_date ? 1 : 0) || (x.ordem_.classe - y.ordem_.classe) || (x.ordem_.posicao - y.ordem_.posicao) || (x.event_seq - y.event_seq);
    });
    itens.forEach(function (x) { delete x.ordem_; });
    return itens;
  }
  function anexos_(tx, a) {
    return Utils.ordenarPor(tx.repo.por('ANEXOS', 'entity_id', a.animal_id).filter(function (x) { return x.entidade === 'ANIMAIS' && x.status === 'ATIVO'; }), 'created_at').map(function (x) {
      return {
        anexo_id: x.anexo_id, tipo: x.tipo, nome_arquivo: x.nome_arquivo, mime_type: x.mime_type, tamanho_bytes: nulo_(x.tamanho_bytes),
        descricao: nulo_(x.descricao), tem_miniatura: !vazio_(x.thumb_drive_file_id), principal: x.anexo_id === a.foto_anexo_id, created_at: x.created_at,
      };
    });
  }
  function rotuloLista_(repo, lista, codigo) {
    if (vazio_(codigo) || !repo.carregada('LISTAS')) return null;
    var item = repo.por('LISTAS', 'lista', lista).filter(function (x) { return x.codigo === codigo; })[0];
    return item ? item.rotulo : null;
  }
  function blocoGeral_(L, a, ref, cat) {
    var g = resumo_(a);
    ['raca', 'origem', 'castrado', 'reprodutor', 'partos_previos', 'situacao_reprodutiva', 'cria_ao_pe', 'marcado_descarte', 'nao_localizado',
      'data_entrada', 'data_entrada_confianca', 'data_saida', 'peso_atual', 'data_ultima_pesagem', 'observacoes', 'foto_anexo_id',
      'created_at', 'updated_at'].forEach(function (c) { g[c] = a[c] === undefined ? null : nulo_(a[c]); });
    g.entregue = true;
    g.raca_rotulo = rotuloLista_(L.repo, 'RACA', a.raca);
    g.data_referencia = ref;
    g.idade_meses = idadeEm(a, ref);
    g.categoria = cat;
    g.sem_categoria = !cat && a.situacao_cadastral !== 'EXTERNO';
    g.peso_vigente = a.situacao_cadastral === 'ATIVO' ? pesoVigente(L, a, L.hoje, cat) : null;
    // A linha de uma retirada (IDENTIFICACAO/REMOCAO) vem marcada `remocao`: guarda o código tirado e o motivo.
    var porIdent = Utils.indexarPor(L.f.identificacoes(a.animal_id), 'ident_id');
    g.identificacoes = Utils.ordenarPor(Timeline.identificacoes(L.f, a.animal_id), ['tipo']).map(function (x) {
      return { tipo: x.tipo, codigo: x.codigo, data_inicio: x.data_inicio, data_fim: nulo_(porIdent[x.ident_id].data_fim), motivo: nulo_(x.motivo), remocao: x.remocao, event_id: x.event_id };
    });
    return g;
  }
  /**
   * Ficha do animal (§5.1; consulta `animal.ficha`): dados {animal_id, geracoes?} (1 a 6; padrão 3).
   * Devolve {animal_id, data, geral (A), genealogia (B), localizacao (C), pastos (D), peso (E), sanitario (F),
   * reprodutivo (G), financeiro (H), eventos (I), anexos (J)}; cada bloco traz `entregue`. Os blocos de módulos
   * ainda não entregues voltam com `entregue: false`, o módulo, a fase e `itens: []`. O bloco G é a ficha reprodutiva
   * inteira (ReproductionService.blocoFicha, Fase 3: situação, previsão, partos, registros, bezerros, perdas, IEP); o H, o custo de aquisição
   * e os lançamentos pelas alocações (FinancialService.blocoFicha), também `parcial`. NOT_FOUND se o animal não
   * existe (ou foi anulado).
   */
  function consultaFicha(dados) {
    var d = dados || {};
    return {
      rota: 'animal.ficha', dados: d, reads: Utils.unicos(leituras().concat(['PROPRIEDADES', 'LISTAS', 'ANEXOS', 'FINANCEIRO', 'PARCELAS', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'PLANO_CONTAS', 'ESTACOES_MONTA'], HealthService.LEITURAS_CADASTRO)), acessoCru: true,
      tratador: function (tx) {
        var g = d.geracoes === undefined || d.geracoes === null ? GERACOES_PADRAO : d.geracoes;
        if (typeof g !== 'number' || Math.floor(g) !== g || g < 1 || g > GERACOES_MAX) {
          throw Validation.erro('VALIDATION', 'A árvore genealógica mostra de 1 a ' + GERACOES_MAX + ' gerações.', [Validation.detalhe({ codigo: 'VALOR_FORA_DA_FAIXA', campo: 'geracoes', mensagem: 'Gerações de 1 a ' + GERACOES_MAX + '.' })]);
        }
        if (vazio_(d.animal_id)) throw Validation.erro('VALIDATION', 'Escolha o animal.', [Validation.detalhe({ codigo: 'CAMPO_OBRIGATORIO', campo: 'animal_id', mensagem: 'Escolha o animal.' })]);
        var L = leitor(tx);
        var a = tx.repo.porId('ANIMAIS', d.animal_id);
        if (!a) throw Validation.erro('NOT_FOUND', 'Animal não encontrado. Atualize a tela e tente de novo.');
        var ref = dataReferencia_(L, a);
        var cat = a.situacao_cadastral === 'EXTERNO' ? null : categoriaEm(L, a, ref);
        var periodos = periodos_(L, a);
        var aberto = periodos.length && periodos[periodos.length - 1].em_andamento ? periodos[periodos.length - 1] : null;
        var pasto = L.f.pasto(a.pasto_atual_id);
        var prop = vazio_(a.propriedade_atual_id) ? null : tx.repo.porId('PROPRIEDADES', a.propriedade_atual_id);
        var out = {
          animal_id: a.animal_id, data: L.hoje,
          geral: blocoGeral_(L, a, ref, cat),
          genealogia: genealogia(L, a, g),
          localizacao: {
            entregue: true, pasture_id: nulo_(a.pasto_atual_id), pasto_nome: pasto ? pasto.nome : null, propriedade_atual_id: nulo_(a.propriedade_atual_id),
            propriedade_nome: prop ? prop.nome : null, desde: aberto && aberto.pasture_id === nulo_(a.pasto_atual_id) ? aberto.inicio : null,
            sem_pasto: a.situacao_cadastral === 'ATIVO' && vazio_(a.pasto_atual_id), situacao_cadastral: a.situacao_cadastral,
          },
          pastos: { entregue: true, periodos: periodos, por_pasto: diasPorPasto_(periodos) },
          // Bloco E (Fase 3): a curva, a tabela com ganho, dias, GMD e variação e a projeção rotulada (WeightService).
          peso: a.situacao_cadastral === 'EXTERNO' ? { entregue: true, externo: true, serie: [], intervalos: [] } : WeightService.blocoFicha(L, a),
          // Bloco F (Fase 3, E3.3): os registros sanitários, a carência e as próximas doses (HealthService).
          sanitario: a.situacao_cadastral === 'EXTERNO' ? { entregue: true, externo: true, animal_id: a.animal_id, itens: [], carencia: null, proximas: [], custo_total: null } : HealthService.blocoFicha(L, a),
          reprodutivo: ReproductionService.blocoFicha(L, a),
          financeiro: blocoFinanceiro_(tx, L, a),
          eventos: { entregue: true, itens: eventos_(tx, L, a) },
          anexos: { entregue: true, itens: anexos_(tx, a) },
        };
        Object.keys(BLOCOS_DE_MODULO).forEach(function (b) { out[b] = moduloNaoEntregue_(BLOCOS_DE_MODULO[b]); });
        return out;
      },
    };
  }

  // ------------------------------------------------------------------ edição ----
  function textoSensivel_(campo, v) {
    if (vazio_(v)) return null;
    if (v === true) return 'S';
    if (v === false) return 'N';
    return typeof v === 'string' ? Utils.aparar(v) || null : String(v);
  }
  function limparTexto_(v) {
    var t = typeof v === 'string' ? Utils.aparar(v) : v;
    return vazio_(t) ? null : t;
  }
  function conferirFoto_(tx, col, a, anexoId) {
    var x = tx.repo.porId('ANEXOS', anexoId);
    if (!x || x.status !== 'ATIVO' || x.entidade !== 'ANIMAIS' || x.entity_id !== a.animal_id) {
      col.erro({ codigo: 'ANEXO_INVALIDO', animal_id: a.animal_id, campo: 'foto_anexo_id', mensagem: 'A foto escolhida não está entre os anexos deste animal. Anexe a foto antes de usá-la como principal.' });
      return;
    }
    if (String(x.mime_type || '').indexOf('image/') !== 0) col.erro({ codigo: 'ANEXO_INVALIDO', animal_id: a.animal_id, campo: 'foto_anexo_id', mensagem: 'O anexo escolhido como foto principal não é uma imagem.' });
  }
  /** Externo: sexo e nascimento conferidos contra as crias de que ele é pai ou mãe (RN-008, RN-009, RN-012). */
  function conferirExterno_(tx, col, a, ext) {
    var sexo = ext.sexo !== undefined ? ext.sexo : a.sexo;
    var nasc = ext.data_nascimento !== undefined ? ext.data_nascimento : nulo_(a.data_nascimento);
    var conf = ext.data_nascimento_confianca !== undefined ? ext.data_nascimento_confianca : nulo_(a.data_nascimento_confianca);
    var quem = nomeAnimal_(a) + ': ';
    if (vazio_(sexo)) col.erro({ codigo: 'CAMPO_OBRIGATORIO', animal_id: a.animal_id, campo: 'sexo', mensagem: quem + 'informe o sexo.' });
    if (!vazio_(nasc) && Utils.dataValida(nasc) && nasc > tx.hoje) col.erro({ codigo: 'DATA_FUTURA', animal_id: a.animal_id, campo: 'data_nascimento', mensagem: quem + 'a data de nascimento ' + Timeline.dataBr(nasc) + ' ainda não chegou.' });
    if (vazio_(nasc) && ext.data_nascimento === null && !vazio_(a.data_nascimento_confianca) && ext.data_nascimento_confianca === undefined) {
      ext.data_nascimento_confianca = null;
      conf = null;
    }
    if (!vazio_(nasc) && vazio_(conf)) col.erro({ codigo: 'CAMPO_OBRIGATORIO', animal_id: a.animal_id, campo: 'data_nascimento_confianca', mensagem: quem + 'diga se a data de nascimento é confirmada ou estimada.' });
    if (vazio_(nasc) && !vazio_(conf)) col.erro({ codigo: 'CAMPO_SEM_VINCULO', animal_id: a.animal_id, campo: 'data_nascimento_confianca', mensagem: quem + 'a confiança precisa de uma data de nascimento.' });
    var crias = tx.repo.por('ANIMAIS', 'mae_id', a.animal_id).map(function (c) { return { c: c, papel: 'mãe' }; })
      .concat(tx.repo.por('ANIMAIS', 'pai_id', a.animal_id).map(function (c) { return { c: c, papel: 'pai' }; }));
    crias.forEach(function (x) {
      if (ext.sexo !== undefined && ((x.papel === 'mãe' && sexo !== 'F') || (x.papel === 'pai' && sexo !== 'M'))) {
        col.erro({ codigo: 'SEXO_DO_PROGENITOR', animal_id: a.animal_id, campo: 'sexo', mensagem: quem + 'é ' + x.papel + ' de ' + nomeAnimal_(x.c) + ' e não pode ter o sexo trocado.' });
      }
      if (ext.data_nascimento !== undefined && !vazio_(nasc) && !vazio_(x.c.data_nascimento) && nasc >= x.c.data_nascimento) {
        col.erro({ codigo: 'NASCIMENTO_DO_PROGENITOR', animal_id: a.animal_id, campo: 'data_nascimento', mensagem: quem + 'é ' + x.papel + ' de ' + nomeAnimal_(x.c) + ', nascido em ' + Timeline.dataBr(x.c.data_nascimento) + ', e precisa ter nascido antes.' });
      }
    });
  }
  function respostaEdicao_(t, resumo) {
    var r = resumo || {};
    var a = t.repo.porId('ANIMAIS', r.animal_id);
    return {
      animal_id: r.animal_id, event_id: r.event_id || null, correcoes: r.correcoes || [], cadastro: r.cadastro || [],
      animal: a ? linhaLeve(leitor(t), a) : null,
    };
  }
  function planejarEdicao_(tx) {
    var d = tx.dados || {};
    if (vazio_(d.animal_id)) return { erros: [Validation.detalhe({ codigo: 'CAMPO_OBRIGATORIO', campo: 'animal_id', mensagem: 'Escolha o animal.' })] };
    var a = tx.repo.porId('ANIMAIS', d.animal_id);
    if (!a) throw Validation.erro('NOT_FOUND', 'Animal não encontrado. Atualize a tela e tente de novo.');
    if (!ehObjeto_(d.campos)) return { erros: [Validation.detalhe({ codigo: 'CAMPO_OBRIGATORIO', animal_id: a.animal_id, campo: 'campos', mensagem: 'Informe o que mudar no cadastro.' })] };
    var externo = a.situacao_cadastral === 'EXTERNO';
    var col = Validation.coletor();
    var cad = {};
    var ext = {};
    var correcoes = [];
    Object.keys(d.campos).forEach(function (c) {
      var v = d.campos[c];
      if (CAMPOS_CADASTRO.indexOf(c) >= 0) { cad[c] = limparTexto_(v); return; }
      if (NAO_EDITAVEIS[c]) { col.erro({ codigo: 'CAMPO_NAO_EDITAVEL', animal_id: a.animal_id, campo: c, mensagem: NAO_EDITAVEIS[c] }); return; }
      if (externo && CAMPOS_EXTERNO.indexOf(c) >= 0) { ext[c] = limparTexto_(v); return; }
      if (externo && EventCatalog.CAMPOS_CORRIGIVEIS[c]) {
        col.erro({ codigo: 'CAMPO_NAO_SE_APLICA', animal_id: a.animal_id, campo: c, mensagem: 'Em animal de fora do rebanho só se informam nome, raça, sexo, nascimento e observações.' });
        return;
      }
      if (EventCatalog.CAMPOS_CORRIGIVEIS[c]) {
        var novo = textoSensivel_(c, v);
        if (novo !== textoSensivel_(c, a[c])) correcoes.push({ animal_id: a.animal_id, campo: c, valor_novo: novo === null ? '' : novo });
        return;
      }
      if (Schema.temColuna('ANIMAIS', c)) { col.erro({ codigo: 'CAMPO_NAO_EDITAVEL', animal_id: a.animal_id, campo: c, mensagem: 'Este dado é calculado pelo sistema a partir dos lançamentos e não se edita.' }); return; }
      col.erro({ codigo: 'CAMPO_DESCONHECIDO', animal_id: a.animal_id, campo: c, mensagem: 'O animal não tem o campo "' + c + '".' });
    });
    var listas = listasAtivas_(tx.repo);
    var paraValidar = {};
    Object.keys(cad).concat(Object.keys(ext)).forEach(function (c) { var v = cad[c] !== undefined ? cad[c] : ext[c]; if (v !== null) paraValidar[c] = v; });
    Validation.validarRegistro('ANIMAIS', paraValidar, { parcial: true, listas: listas, animal_id: a.animal_id, brinco: nulo_(a.brinco) }).forEach(function (x) { col.erro(x); });
    if (!vazio_(cad.foto_anexo_id)) conferirFoto_(tx, col, a, cad.foto_anexo_id);
    if (externo && Object.keys(ext).length) conferirExterno_(tx, col, a, ext);
    if (correcoes.length && vazio_(d.justificativa)) {
      col.erro({ codigo: 'CAMPO_OBRIGATORIO', animal_id: a.animal_id, campo: 'justificativa', mensagem: 'Diga por que ' + correcoes.map(function (x) { return x.campo; }).join(', ') + ' está sendo corrigido: a mudança fica registrada como correção.' });
    }
    if (col.temErros()) return { erros: col.erros };
    var res = null;
    if (correcoes.length) {
      var etx = {};
      Object.keys(tx).forEach(function (k) { etx[k] = tx[k]; });
      etx.dados = {
        tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO',
        campos: { event_date: tx.hoje, justificativa: d.justificativa, property_id: nulo_(a.propriedade_atual_id) },
        animais: correcoes, justificativa_aviso: d.justificativa_aviso,
      };
      res = EventService.comando('registrar', { dados: etx.dados }).tratador(etx);
      if (res.erros && res.erros.length) return { erros: res.erros };
    }
    if (Object.keys(cad).length) AuditService.alteracao(tx, 'ANIMAIS', a.animal_id, cad, d.justificativa);
    if (Object.keys(ext).length) AuditService.alteracao(tx, 'ANIMAIS', a.animal_id, ext, d.justificativa, { externo: true });
    var cadastro = tx.plano.mudancas().filter(function (m) { return m.entidade === 'ANIMAIS' && m.entity_id === a.animal_id; }).map(function (m) { return m.campo; });
    var resumo = { animal_id: a.animal_id, event_id: res ? res.resumo.event_id : null, correcoes: correcoes.map(function (x) { return x.campo; }), cadastro: cadastro };
    return {
      avisos: res ? res.avisos : [],
      resumo: resumo,
      impactos: { animal_id: a.animal_id, correcoes: resumo.correcoes, cadastro: cadastro, evento: res ? res.impactos : null },
      derivados: res ? res.derivados : null,
      resposta: function (t) { return respostaEdicao_(t, resumo); },
    };
  }
  /**
   * Comando `animal.editar` — um formulário só (DV-07). dados: {animal_id, campos: {...}, justificativa?,
   * justificativa_aviso?}. `campos` pode trazer o formulário inteiro: só o que muda é gravado.
   * - nome, raca (lista RACA), observacoes, foto_anexo_id (anexo ATIVO do próprio animal, imagem): AUDITORIA.
   * - sexo, data_nascimento(_confianca), mae_id/pai_id(_confianca), castrado, reprodutor, partos_previos, origem,
   *   data_entrada(_confianca): evento AJUSTE_INVENTARIO/CORRECAO_CADASTRO com a justificativa (obrigatória),
   *   datado de hoje, com todas as regras do motor (genealogia, linha do tempo, avisos). Mesmo commit da auditoria.
   * - Animal EXTERNO: sexo e nascimento são do cadastro de referência (AUDITORIA, sem evento); os demais campos
   *   sensíveis não se aplicam.
   * - brinco, pasto, situação e colunas calculadas: CAMPO_NAO_EDITAVEL, com o caminho certo na mensagem.
   * Resposta: {animal_id, event_id, correcoes: [campos], cadastro: [campos], animal: linha leve}.
   */
  function comandoEditar(pedido) {
    var p = pedido || {};
    return {
      rota: 'animal.editar', idempotencyKey: p.idempotencyKey, dados: p.dados, avisosAceitos: p.avisosAceitos || [],
      dataVersionEsperada: p.dataVersionEsperada, modo: p.modo, acessoCru: true,
      // As abas do leitor (leituras()) também: a resposta traz a linha leve inteira, com a carência de hoje (SANIDADE).
      reads: Utils.unicos(EventCatalog.leituras('AJUSTE_INVENTARIO').concat(Timeline.LEITURAS, leituras(), ['ANEXOS'])),
      tratador: planejarEdicao_,
      reconstruir: function (tx, op) { return respostaEdicao_(tx, op.resumo); },
    };
  }

  // ------------------------------------------------------------------ cadastro de animal externo ----
  /**
   * Comando `animal.cadastrarExterno` (DV-06): animal de referência fora do rebanho (touro de sêmen, progenitor de
   * outra fazenda), sem evento e fora do inventário. dados: {campos: {nome (identificação do touro ou do sêmen,
   * obrigatório), sexo (obrigatório), raca, data_nascimento, data_nascimento_confianca, observacoes},
   * justificativa?}. Nome repetido entre os externos gera o aviso POSSIVEL_DUPLICIDADE. A linha de ANIMAIS nasce
   * na fase C pela AUDITORIA (CRIAR), com código interno sequencial e situação EXTERNO.
   * Resposta: {animal_id, animal: linha leve}.
   */
  function comandoCadastrarExterno(pedido) {
    var p = pedido || {};
    return {
      rota: 'animal.cadastrarExterno', idempotencyKey: p.idempotencyKey, dados: p.dados, avisosAceitos: p.avisosAceitos || [],
      dataVersionEsperada: p.dataVersionEsperada, reads: Utils.unicos(leituras().concat(['LISTAS'])),
      tratador: function (tx) {
        var d = tx.dados || {};
        var col = Validation.coletor();
        var campos = {};
        Object.keys(ehObjeto_(d.campos) ? d.campos : {}).forEach(function (c) {
          if (CAMPOS_NOVO_EXTERNO.indexOf(c) < 0) {
            col.erro({ codigo: 'CAMPO_NAO_SE_APLICA', campo: c, mensagem: 'Animal de fora do rebanho não tem "' + c + '": informe só nome, sexo, raça, nascimento e observações.' });
            return;
          }
          campos[c] = limparTexto_(d.campos[c]);
        });
        if (vazio_(campos.nome)) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'nome', mensagem: 'Dê um nome ou a identificação do touro ou do sêmen.' });
        if (vazio_(campos.sexo)) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'sexo', mensagem: 'Informe o sexo do animal.' });
        var paraValidar = {};
        Object.keys(campos).forEach(function (c) { if (campos[c] !== null) paraValidar[c] = campos[c]; });
        Validation.validarRegistro('ANIMAIS', paraValidar, { parcial: true, listas: listasAtivas_(tx.repo) }).forEach(function (x) { col.erro(x); });
        var nasc = campos.data_nascimento;
        if (!vazio_(nasc) && Utils.dataValida(nasc) && nasc > tx.hoje) col.erro({ codigo: 'DATA_FUTURA', campo: 'data_nascimento', mensagem: 'A data de nascimento ' + Timeline.dataBr(nasc) + ' ainda não chegou.' });
        if (!vazio_(nasc) && vazio_(campos.data_nascimento_confianca)) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'data_nascimento_confianca', mensagem: 'Diga se a data de nascimento é confirmada ou estimada.' });
        if (vazio_(nasc) && !vazio_(campos.data_nascimento_confianca)) col.erro({ codigo: 'CAMPO_SEM_VINCULO', campo: 'data_nascimento_confianca', mensagem: 'A confiança precisa de uma data de nascimento.' });
        if (col.temErros()) return { erros: col.erros };
        var avisos = [];
        var chave = Utils.normalizarTexto(campos.nome);
        var igual = tx.repo.vigentes('ANIMAIS').filter(function (x) { return x.situacao_cadastral === 'EXTERNO' && Utils.normalizarTexto(x.nome || '') === chave; })[0];
        if (igual) avisos.push(Validation.detalhe({ codigo: 'POSSIVEL_DUPLICIDADE', campo: 'nome', mensagem: 'Já existe um animal de fora do rebanho chamado "' + igual.nome + '" (' + igual.codigo_interno + '). Cadastrar outro mesmo assim?' }));
        avisos = Config.aplicarPolitica(Config.parametros(tx.repo), avisos, col);
        if (col.temErros()) return { erros: col.erros };
        var id = tx.novoId();
        var registro = {
          codigo_interno: 'A-' + pad_(tx.repo.contador('ANIMAIS', 'codigo_interno', extrairCodigo_), 6), nome: campos.nome, sexo: campos.sexo,
          raca: nulo_(campos.raca), data_nascimento: nulo_(nasc), data_nascimento_confianca: nulo_(campos.data_nascimento_confianca),
          observacoes: nulo_(campos.observacoes), categoria_modo: 'AUTO', marcado_descarte: false, nao_localizado: false, situacao_cadastral: 'EXTERNO',
        };
        AuditService.criacao(tx, 'ANIMAIS', id, registro, d.justificativa);
        return { avisos: avisos, resumo: { animal_id: id }, resposta: function (t) { return respostaExterno_(t, id); } };
      },
      reconstruir: function (tx, op) { return respostaExterno_(tx, op.resumo.animal_id); },
    };
  }
  function respostaExterno_(t, id) {
    var a = t.repo.porId('ANIMAIS', id);
    return { animal_id: id, animal: a ? linhaLeve(leitor(t), a) : null };
  }

  function editar(ctx, pedido) { return UnitOfWork.run(ctx, comandoEditar(pedido)); }
  function cadastrarExterno(ctx, pedido) { return UnitOfWork.run(ctx, comandoCadastrarExterno(pedido)); }
  function listar(ctx, filtros) { return UnitOfWork.read(ctx, consultaListar(filtros)); }
  function ficha(ctx, dados) { return UnitOfWork.read(ctx, consultaFicha(dados)); }
  function cargaInicial(ctx) { return UnitOfWork.read(ctx, consultaCargaInicial()); }

  return {
    CAMPOS_CADASTRO: CAMPOS_CADASTRO,
    CAMPOS_EXTERNO: CAMPOS_EXTERNO,
    COLUNAS_LEVE: COLUNAS_LEVE,
    SITUACOES_CARGA: SITUACOES_CARGA,
    SITUACOES_BAIXADOS: SITUACOES_BAIXADOS,
    GERACOES_MAX: GERACOES_MAX,
    leituras: leituras,
    leitor: leitor,
    idadeEm: idadeEm,
    perfilEm: perfilEm,
    categoriaEm: categoriaEm,
    pesoVigente: pesoVigente,
    linhaLeve: linhaLeve,
    genealogia: genealogia,
    consultaCargaInicial: consultaCargaInicial,
    consultaListar: consultaListar,
    consultaFicha: consultaFicha,
    comandoEditar: comandoEditar,
    comandoCadastrarExterno: comandoCadastrarExterno,
    editar: editar,
    cadastrarExterno: cadastrarExterno,
    listar: listar,
    ficha: ficha,
    cargaInicial: cargaInicial,
  };
})();
