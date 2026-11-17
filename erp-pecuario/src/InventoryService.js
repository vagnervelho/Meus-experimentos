/**
 * InventoryService — posição do rebanho hoje e na data D (desenho-base 4.3: inventário em D = Σ efeito das linhas
 * vigentes até D, a partir do marco zero), resumo da tela "Visão geral" e alertas da Fase 1 (desenho-base,
 * seção 6; RN-005, RN-098, RN-107).
 *
 * Contrato P9: dado ausente nunca vira zero. Antes do marco zero (ou sem ele) os números voltam `null` com o
 * `motivo` (ANTERIOR_AO_MARCO_ZERO, DADOS_INSUFICIENTES). Puro: lê pelo leitor do AnimalService.
 */
var InventoryService = (function () {
  /** Alertas entregues até a Fase 2 (lista fechada do desenho-base, seção 6, no recorte das fases entregues). */
  var ALERTAS = ['ATIVO_SEM_PASTO', 'SEM_BRINCO', 'SEM_CATEGORIA', 'NAO_LOCALIZADO', 'SANITARIO_VENCIDO', 'SANITARIO_PROXIMO', 'EM_CARENCIA', 'PARTO_PREVISTO', 'PRENHEZ_VENCIDA', 'BACKUP_ATRASADO', 'INTEGRIDADE_COM_ERRO', 'IMPORTACAO_INCOMPLETA'];
  var DIA_MS = 86400000;
  /**
   * Tipos cujas linhas são movimento ou saída: o elegível em D é quem está no rebanho ao fim do dia (depois das saídas
   * de D). Nos demais tipos de animais do rebanho (fatos: parto, identificação, marcação e, nas fases seguintes, pesagem,
   * sanidade...) vale quem esteve no rebanho em algum momento de D — o dia da saída conta (RN-017), como na validação.
   */
  var MOVIMENTO_OU_SAIDA = ['TRANSFERENCIA', 'VENDA', 'MORTE', 'DESCARTE'];
  var SEXOS = ['M', 'F'];
  /** Filtros da posição e da visão geral (07, seção 9): Pr, Pa, S e C. */
  var FILTROS = ['property_id', 'pasture_id', 'sexo', 'category_id'];

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function arred_(v, casas) {
    return v === null ? null : Utils.arredondar(v, casas);
  }
  function indicador_(valor, motivo, n, extra) {
    var o = { valor: valor, motivo: valor === null ? motivo || 'DADOS_INSUFICIENTES' : null, n: n };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  function nulo_(v) {
    return vazio_(v) ? null : v;
  }
  function leituras() {
    return AnimalService.leituras();
  }
  function leiturasPosicao_() {
    return Utils.unicos(leituras().concat(['PROPRIEDADES']));
  }
  function conferirData_(L, data, campo) {
    var c = campo || 'data';
    var d = vazio_(data) ? L.hoje : data;
    if (!Utils.dataValida(d)) throw Validation.erro('VALIDATION', 'Informe uma data válida (aaaa-mm-dd).', [Validation.detalhe({ codigo: 'FORMATO_INVALIDO', campo: c, mensagem: 'Data inválida.' })]);
    if (d > L.hoje) throw Validation.erro('VALIDATION', 'A data ' + Timeline.dataBr(d) + ' ainda não chegou: a posição do rebanho é de hoje ou de um dia passado.', [Validation.detalhe({ codigo: 'DATA_FUTURA', campo: c, mensagem: 'Data futura.' })]);
    return d;
  }

  // ------------------------------------------------------------------ filtros ----
  /**
   * Filtros da posição e da visão geral (07, seção 9: Pr, Pa, S e C): {property_id?, pasture_id?, sexo?, category_id?}.
   * Pasto e categoria são os do animal na data (na posição, o fim do dia D; no fluxo, o dia do evento, com o pasto de
   * destino na entrada e o de origem na saída). Filtro inexistente → NOT_FOUND; sexo fora de M/F → VALIDATION.
   */
  function lerFiltros_(L, d) {
    var f = {};
    if (!vazio_(d.sexo)) {
      if (SEXOS.indexOf(d.sexo) < 0) throw Validation.erro('VALIDATION', 'Escolha o sexo: macho ou fêmea.', [Validation.detalhe({ codigo: 'VALOR_FORA_DA_LISTA', campo: 'sexo', mensagem: 'Sexo inválido.' })]);
      f.sexo = d.sexo;
    }
    if (!vazio_(d.pasture_id)) {
      if (!L.f.pasto(d.pasture_id)) throw Validation.erro('NOT_FOUND', 'Pasto não encontrado. Atualize a tela e tente de novo.');
      f.pasture_id = d.pasture_id;
    }
    if (!vazio_(d.property_id)) {
      if (!L.repo.porId('PROPRIEDADES', d.property_id)) throw Validation.erro('NOT_FOUND', 'Propriedade não encontrada. Atualize a tela e tente de novo.');
      f.property_id = d.property_id;
    }
    if (!vazio_(d.category_id)) {
      if (!L.categoriaPorId[d.category_id]) throw Validation.erro('NOT_FOUND', 'Categoria não encontrada. Atualize a tela e tente de novo.');
      f.category_id = d.category_id;
    }
    return f;
  }
  function temFiltro_(f) {
    return FILTROS.some(function (k) { return !vazio_(f[k]); });
  }
  /** Propriedade do animal no lugar dado: a do pasto; sem pasto, a do evento que o pôs lá (a entrada). */
  function propriedadeDe_(L, pastureId, eventId) {
    var p = L.f.pasto(pastureId);
    if (p) return p.property_id;
    var ev = vazio_(eventId) ? null : L.f.evento(eventId);
    return ev ? nulo_(ev.property_id) : null;
  }
  /** O item ({animal, pasture_id, property_id}) casa com os filtros na data, menos os listados em `ignorar`. */
  function casa_(L, f, x, data, ignorar) {
    var ig = ignorar || [];
    var usa = function (k) { return !vazio_(f[k]) && ig.indexOf(k) < 0; };
    if (usa('sexo') && x.animal.sexo !== f.sexo) return false;
    if (usa('pasture_id') && x.pasture_id !== f.pasture_id) return false;
    if (usa('property_id') && x.property_id !== f.property_id) return false;
    if (usa('category_id')) {
      var c = AnimalService.categoriaEm(L, x.animal, data);
      if (!c || c.category_id !== f.category_id) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ presença e composição ----
  /**
   * Animais no rebanho ao fim do dia D, pela linha do tempo (Timeline.presentesEm, o replay das linhas vigentes):
   * {motivo, itens: [{animal, registro, pasture_id, property_id, no_rebanho_desde, no_pasto_desde}]} (ordem de código
   * interno). `animal` é o animal como estava em D (AnimalService.retratoEm: brinco, situação reprodutiva, marcas, peso e
   * cria ao pé daquele dia; CONTRATOS, seção 46), e `registro` a projeção de hoje (o que a consulta mostra como "hoje").
   * Sem marco zero → DADOS_INSUFICIENTES; D antes dele → ANTERIOR_AO_MARCO_ZERO (itens null).
   */
  function presentes(L, data) {
    var pr = Timeline.presentesEm(L.f.todasAsLinhas(), data, L.marcoZero);
    if (pr.motivo) return { motivo: pr.motivo, itens: null };
    var itens = [];
    pr.itens.forEach(function (x) {
      var a = L.repo.porId('ANIMAIS', x.animal_id);
      if (!a) return;
      itens.push({
        animal: AnimalService.retratoEm(L, a, data) || a, registro: a, pasture_id: x.pasture_id, property_id: propriedadeDe_(L, x.pasture_id, x.entrada ? x.entrada.event_id : null),
        no_rebanho_desde: x.no_rebanho_desde, no_pasto_desde: x.no_pasto_desde,
      });
    });
    return { motivo: null, itens: Utils.ordenarPor(itens, function (x) { return x.animal.codigo_interno; }) };
  }
  /**
   * Animais no rebanho em algum momento do dia D (o dia da entrada e o da saída contam: RN-017), com o pasto em que
   * estavam antes das saídas do dia (Timeline.pastoAntesDaSaida): os que podem receber um fato datado de D. Mesma
   * forma e mesmos motivos de `presentes` (o animal, o retrato no fim do dia D).
   */
  function presentesNoDia(L, data) {
    if (vazio_(L.marcoZero)) return { motivo: 'DADOS_INSUFICIENTES', itens: null };
    if (data < L.marcoZero) return { motivo: 'ANTERIOR_AO_MARCO_ZERO', itens: null };
    var porAnimal = Utils.agruparPor(L.f.todasAsLinhas(), 'animal_id');
    var itens = [];
    Object.keys(porAnimal).forEach(function (id) {
      var p = Timeline.pastoAntesDaSaida(porAnimal[id], data, L.marcoZero);
      if (!p.presente) return;
      var a = L.repo.porId('ANIMAIS', id);
      if (a) itens.push({ animal: AnimalService.retratoEm(L, a, data) || a, registro: a, pasture_id: p.pasture_id });
    });
    return { motivo: null, itens: Utils.ordenarPor(itens, function (x) { return x.animal.codigo_interno; }) };
  }
  /** Cabeças por categoria em D (em ordem de prioridade) e as sem categoria: {por_categoria, sem_categoria}. */
  function contarCategorias_(L, itens, data) {
    var cats = {};
    var sem = 0;
    itens.forEach(function (x) {
      var cat = AnimalService.categoriaEm(L, x.animal, data);
      if (!cat) { sem++; return; }
      var c = cats[cat.category_id] = cats[cat.category_id] || { category_id: cat.category_id, codigo: cat.codigo, nome: cat.nome, cabecas: 0 };
      c.cabecas++;
    });
    var lista = Utils.ordenarPor(Object.keys(cats).map(function (k) { return cats[k]; }), function (c) {
      var def = L.categoriaPorId[c.category_id];
      return def && typeof def.prioridade === 'number' ? def.prioridade : 0;
    });
    return { por_categoria: lista, sem_categoria: sem };
  }
  /**
   * Composição de um grupo de animais em D: cabeças, machos, fêmeas, categorias (calculadas em D), peso vivo total,
   * peso médio e UA com o peso vigente em D (desenho-base, seção 6; 07, seção 8.2: o último peso conhecido até D — o
   * da entrada, da compra, do nascimento e, na Fase 3, das pesagens —, dentro da validade; vencido ou ausente, o
   * peso de referência da categoria, estimado). UA = Σ peso vigente ÷ `ua_peso_kg`; a parte estimada vem separada em
   * "sem pesagem" e "pesagem vencida"; cabeça sem peso nenhum fica fora da UA e do peso médio e é contada. Grupo
   * vazio → peso vivo e UA zero de verdade (peso médio null); cabeças sem nenhum peso → null (DADOS_INSUFICIENTES).
   * opcoes: {animais: true} inclui a lista por animal (com `no_pasto_desde` e `no_rebanho_desde` quando o item traz).
   */
  function compor(L, itens, data, opcoes) {
    var o = opcoes || {};
    var r = { cabecas: itens.length, machos: 0, femeas: 0 };
    var partes = { pesada: { cabecas: 0, peso_kg: 0 }, estimativa_visual: { cabecas: 0, peso_kg: 0 }, pesagem_vencida: { cabecas: 0, peso_kg: 0 }, sem_pesagem: { cabecas: 0, peso_kg: 0 } };
    var semPeso = 0;
    var lista = [];
    itens.forEach(function (x) {
      var a = x.animal;
      if (a.sexo === 'M') r.machos++;
      else if (a.sexo === 'F') r.femeas++;
      var cat = AnimalService.categoriaEm(L, a, data);
      var pv = AnimalService.pesoVigente(L, a, data, cat);
      if (pv.situacao === 'PESADO') { partes.pesada.cabecas++; partes.pesada.peso_kg += pv.kg; }
      else if (pv.situacao === 'ESTIMATIVA_VISUAL') { partes.estimativa_visual.cabecas++; partes.estimativa_visual.peso_kg += pv.kg; }
      else if (pv.situacao === 'PESAGEM_VENCIDA') { partes.pesagem_vencida.cabecas++; partes.pesagem_vencida.peso_kg += pv.kg; }
      else if (pv.situacao === 'SEM_PESAGEM') { partes.sem_pesagem.cabecas++; partes.sem_pesagem.peso_kg += pv.kg; }
      else semPeso++;
      if (o.animais) {
        lista.push({
          animal_id: a.animal_id, codigo_interno: a.codigo_interno, brinco: a.brinco || null, sexo: a.sexo || null, idade_meses: AnimalService.idadeEm(a, data),
          categoria_id: cat ? cat.category_id : null, pasture_id: x.pasture_id, peso: pv,
          no_pasto_desde: x.no_pasto_desde || null, no_rebanho_desde: x.no_rebanho_desde || null,
        });
      }
    });
    var cats = contarCategorias_(L, itens, data);
    r.por_categoria = cats.por_categoria;
    r.sem_categoria = cats.sem_categoria;
    var comPeso = r.cabecas - semPeso;
    var total = partes.pesada.peso_kg + partes.estimativa_visual.peso_kg + partes.pesagem_vencida.peso_kg + partes.sem_pesagem.peso_kg;
    var estimadas = partes.estimativa_visual.cabecas + partes.pesagem_vencida.cabecas + partes.sem_pesagem.cabecas;
    var uaKg = L.params.ua_peso_kg;
    var valorPeso = r.cabecas === 0 ? 0 : comPeso === 0 ? null : arred_(total, 1);
    r.peso_vivo_total = indicador_(valorPeso, 'DADOS_INSUFICIENTES', comPeso, { estimado: estimadas > 0, unidade: 'kg' });
    r.peso_medio = indicador_(comPeso === 0 ? null : arred_(total / comPeso, 1), 'DADOS_INSUFICIENTES', comPeso, {
      estimado: estimadas > 0, pct_estimado: comPeso === 0 ? null : arred_(estimadas / comPeso * 100, 1), unidade: 'kg',
    });
    var ua = valorPeso === null ? null : typeof uaKg === 'number' && uaKg > 0 ? arred_(total / uaKg, 2) : null;
    Object.keys(partes).forEach(function (k) {
      partes[k].peso_kg = arred_(partes[k].peso_kg, 1);
      partes[k].ua = typeof uaKg === 'number' && uaKg > 0 ? arred_(partes[k].peso_kg / uaKg, 2) : null;
    });
    var rotulo = null;
    if (estimadas > 0) {
      var trechos = [];
      if (partes.estimativa_visual.cabecas) trechos.push(partes.estimativa_visual.cabecas + ' cabeça(s) por estimativa visual');
      if (partes.sem_pesagem.cabecas) trechos.push(partes.sem_pesagem.cabecas + ' cabeça(s) sem pesagem, pelo peso de referência da categoria');
      if (partes.pesagem_vencida.cabecas) trechos.push(partes.pesagem_vencida.cabecas + ' com pesagem vencida (mais de ' + L.params.peso_validade_dias + ' dias)');
      rotulo = 'UA estimada em parte: ' + trechos.join(' e ') + '.';
    }
    if (semPeso > 0) rotulo = (rotulo ? rotulo + ' ' : '') + semPeso + ' cabeça(s) sem peso ficaram fora da UA.';
    r.ua = indicador_(ua, valorPeso === null ? 'DADOS_INSUFICIENTES' : 'SEM_VALOR_DE_REFERENCIA', comPeso, {
      estimado: estimadas > 0, ua_peso_kg: typeof uaKg === 'number' ? uaKg : null, partes: partes, sem_peso: semPeso, rotulo: rotulo,
    });
    if (o.animais) r.animais = lista;
    return r;
  }

  // ------------------------------------------------------------------ posição ----
  function porPasto_(L, itens) {
    var g = {};
    var sem = 0;
    itens.forEach(function (x) {
      if (vazio_(x.pasture_id)) { sem++; return; }
      g[x.pasture_id] = (g[x.pasture_id] || 0) + 1;
    });
    var lista = Object.keys(g).map(function (id) {
      var p = L.f.pasto(id);
      return { pasture_id: id, nome: p ? p.nome : null, cabecas: g[id] };
    });
    return { lista: Utils.ordenarPor(lista, ['nome', 'pasture_id']), sem: sem };
  }
  /** Etiquetas do tratamento E (07, seção 9): o item ignora o filtro e diz isso. */
  function etiquetasPosicao_(f) {
    var e = {};
    if (!vazio_(f.sexo)) e.por_sexo = 'todos os sexos';
    if (!vazio_(f.pasture_id)) e.por_pasto = 'todos os pastos';
    if (!vazio_(f.category_id)) e.por_categoria = 'todas as categorias';
    if (temFiltro_(f)) e.por_situacao = 'rebanho inteiro, sem os filtros';
    return e;
  }
  /**
   * Posição do rebanho ao fim do dia D (padrão hoje; 04, seção 5.2 (v); 07, seção 9, itens 1 a 3, 8 a 10, 15 e 16):
   * {data, marco_zero, motivo, filtros, etiquetas, cabecas, por_sexo: {M, F}, por_pasto: [{pasture_id, nome,
   * cabecas}], sem_pasto, por_categoria: [{category_id, codigo, nome, cabecas}], sem_categoria, peso_vivo_total, ua,
   * peso_medio, por_situacao: {ATIVO, VENDIDO, MORTO, DESCARTADO, BAIXADO_AJUSTE}}. Os filtros (`lerFiltros_`) valem
   * para cabeças, peso e UA; por sexo ignora o de sexo, por pasto o de pasto e por categoria o de categoria (tratamento
   * E, com etiqueta); a situação na data é a do rebanho inteiro (quem já tinha entrado até D). Antes do marco zero:
   * tudo null, com o motivo. Sempre recalculada dos eventos vigentes hoje: um estorno muda o passado.
   */
  function posicao(L, data, filtros) {
    var f = filtros || {};
    var pr = presentes(L, data);
    var base = { data: data, marco_zero: L.marcoZero || null, motivo: pr.motivo, filtros: Utils.clonar(f), etiquetas: etiquetasPosicao_(f) };
    if (pr.motivo) {
      ['cabecas', 'por_sexo', 'por_pasto', 'sem_pasto', 'por_categoria', 'sem_categoria', 'por_situacao'].forEach(function (k) { base[k] = null; });
      base.peso_vivo_total = indicador_(null, pr.motivo, 0);
      base.ua = indicador_(null, pr.motivo, 0);
      base.peso_medio = indicador_(null, pr.motivo, 0);
      return base;
    }
    var itens = pr.itens;
    var c = compor(L, itens.filter(function (x) { return casa_(L, f, x, data); }), data);
    var sx = itens.filter(function (x) { return casa_(L, f, x, data, ['sexo']); });
    var pp = porPasto_(L, itens.filter(function (x) { return casa_(L, f, x, data, ['pasture_id']); }));
    var cats = contarCategorias_(L, itens.filter(function (x) { return casa_(L, f, x, data, ['category_id']); }), data);
    base.cabecas = c.cabecas;
    base.por_sexo = { M: sx.filter(function (x) { return x.animal.sexo === 'M'; }).length, F: sx.filter(function (x) { return x.animal.sexo === 'F'; }).length };
    base.por_pasto = pp.lista;
    base.sem_pasto = pp.sem;
    base.por_categoria = cats.por_categoria;
    base.sem_categoria = cats.sem_categoria;
    base.peso_vivo_total = c.peso_vivo_total;
    base.ua = c.ua;
    base.peso_medio = c.peso_medio;
    base.por_situacao = Timeline.inventario(L.f.todasAsLinhas(), data, L.marcoZero).porSituacao;
    return base;
  }
  /** Um animal na data D: onde estava, desde quando, em que situação, categoria, idade e peso vigente naquele dia. */
  function animalNaData_(L, a, data) {
    var s = Timeline.situacaoEm(L.f.linhas(a.animal_id), data, L.marcoZero);
    var cat = s.presente ? AnimalService.categoriaEm(L, a, data) : null;
    return {
      data: data, animal_id: a.animal_id, presente: s.presente, pasture_id: s.pasture_id, situacao: s.situacao,
      no_rebanho_desde: s.no_rebanho_desde, no_pasto_desde: s.no_pasto_desde, entrada: s.entrada, saida: s.saida,
      sexo: nulo_(a.sexo), idade_meses: s.presente ? AnimalService.idadeEm(a, data) : null,
      categoria: cat ? { category_id: cat.category_id, codigo: cat.codigo, nome: cat.nome, manual: cat.manual } : null,
      peso: s.presente ? AnimalService.pesoVigente(L, a, data, cat) : null, motivo: s.motivo,
    };
  }
  /**
   * Consulta `inventario.posicao`. dados: {data?, property_id?, pasture_id?, sexo?, category_id?} → `posicao`;
   * {data?, animal_id} → o animal na data (`animalNaData_`: {data, animal_id, presente, pasture_id, situacao,
   * no_rebanho_desde, no_pasto_desde, entrada, saida, sexo, idade_meses, categoria, peso, motivo}). Data futura ou
   * inválida e sexo inválido → VALIDATION; animal, pasto, propriedade ou categoria inexistente → NOT_FOUND.
   */
  function consultaPosicao(dados) {
    var d = dados || {};
    return {
      rota: 'inventario.posicao', dados: d, reads: leiturasPosicao_(), acessoCru: true,
      tratador: function (tx) {
        var L = AnimalService.leitor(tx);
        var data = conferirData_(L, d.data);
        if (!vazio_(d.animal_id)) {
          var a = tx.repo.porId('ANIMAIS', d.animal_id);
          if (!a) throw Validation.erro('NOT_FOUND', 'Animal não encontrado.');
          return animalNaData_(L, a, data);
        }
        return posicao(L, data, lerFiltros_(L, d));
      },
    };
  }

  // ------------------------------------------------------------------ visão geral (dashboard.obter) ----
  function dois_(n) {
    return (n < 10 ? '0' : '') + n;
  }
  /** Primeiro dia do mês `n` meses antes do mês da data. */
  function inicioDoMes_(data, n) {
    var ano = Number(data.slice(0, 4));
    var mes = Number(data.slice(5, 7)) - (n || 0);
    while (mes < 1) { mes += 12; ano--; }
    return String(ano) + '-' + dois_(mes) + '-01';
  }
  /** Meses que o período toca: [{mes: 'aaaa-mm', inicio, fim}], recortados ao período. */
  function meses_(inicio, fim) {
    var out = [];
    var m = inicioDoMes_(inicio, 0);
    while (m <= fim) {
      var prox = Utils.somaDias(m, 32).slice(0, 8) + '01';
      var ultimo = Utils.somaDias(prox, -1);
      out.push({ mes: m.slice(0, 7), inicio: m < inicio ? inicio : m, fim: ultimo > fim ? fim : ultimo });
      m = prox;
    }
    return out;
  }
  /**
   * Período da visão geral (07, seção 9: Di e Df; 08, seção 11: padrão = os últimos 12 meses, do primeiro dia do mês
   * 11 meses antes do de Df até Df; Df padrão = hoje). Df futura, data inválida ou início depois do fim → VALIDATION.
   * Devolve {inicio, fim, inicio_efetivo, parcial, motivo}: Df antes do marco zero → ANTERIOR_AO_MARCO_ZERO; sem marco
   * zero → DADOS_INSUFICIENTES; período que começa antes dele conta os fluxos dele em diante (`parcial`).
   */
  function periodo_(L, d) {
    var fim = conferirData_(L, d.data_fim, 'data_fim');
    var inicio = vazio_(d.data_inicio) ? inicioDoMes_(fim, 11) : d.data_inicio;
    if (!Utils.dataValida(inicio)) throw Validation.erro('VALIDATION', 'Informe uma data de início válida (aaaa-mm-dd).', [Validation.detalhe({ codigo: 'FORMATO_INVALIDO', campo: 'data_inicio', mensagem: 'Data inválida.' })]);
    if (inicio > fim) throw Validation.erro('VALIDATION', 'O início do período (' + Timeline.dataBr(inicio) + ') é depois do fim (' + Timeline.dataBr(fim) + ').', [Validation.detalhe({ codigo: 'FAIXA_INVALIDA', campo: 'data_inicio', mensagem: 'Período invertido.' })]);
    var out = { inicio: inicio, fim: fim, inicio_efetivo: inicio, parcial: false, motivo: null };
    if (vazio_(L.marcoZero)) out.motivo = 'DADOS_INSUFICIENTES';
    else if (fim < L.marcoZero) out.motivo = 'ANTERIOR_AO_MARCO_ZERO';
    else if (inicio < L.marcoZero) { out.inicio_efetivo = L.marcoZero; out.parcial = true; }
    return out;
  }
  /**
   * Linhas de fluxo do período (07, seção 9, itens 4 a 7): cada linha vigente de NASCIMENTO (cria nascida viva),
   * COMPRA (entrada), VENDA, MORTE, DESCARTE e baixa na contagem (saídas), de D0 em diante, com o animal, o pasto
   * (destino na entrada, origem na saída) e a propriedade do dia do evento, filtradas. [{tipo, data, mes, event_id,
   * valor (o que coube ao animal no lançamento principal: compra dos animais ou receita da venda, pelas alocações
   * vigentes; desenho-base §7: valor_individual é só base de rateio)}].
   */
  function fluxos_(L, periodo, f) {
    var out = [];
    var porEvento = {};
    function valor(l, tipo) {
      if (!COM_VALOR[tipo]) return null;
      if (!porEvento[l.event_id]) porEvento[l.event_id] = valoresDoPrincipal_(L, l.event_id, tipo);
      var v = porEvento[l.event_id][l.animal_id];
      return typeof v === 'number' ? v : null;
    }
    L.f.todasAsLinhas().forEach(function (l) {
      if (l.pre_marco_zero || l.event_date < periodo.inicio_efetivo || l.event_date > periodo.fim) return;
      var tipo = null;
      if (l.efeito === 1 && l.event_type === 'NASCIMENTO' && l.papel === 'CRIA') tipo = 'nascimentos';
      else if (l.efeito === 1 && l.event_type === 'COMPRA') tipo = 'compras';
      else if (l.efeito === -1 && l.event_type === 'VENDA') tipo = 'vendas';
      else if (l.efeito === -1 && l.event_type === 'MORTE') tipo = 'mortes';
      else if (l.efeito === -1 && l.event_type === 'DESCARTE') tipo = 'descartes';
      else if (l.efeito === -1 && l.event_type === 'AJUSTE_INVENTARIO' && l.event_subtype === 'DIVERGENCIA_CONTAGEM') tipo = 'baixas_contagem';
      if (!tipo) return;
      var a = L.repo.porId('ANIMAIS', l.animal_id);
      if (!a) return;
      var pasto = l.efeito === 1 ? l.pasto_destino_id
        : !vazio_(l.pasto_origem_id) ? l.pasto_origem_id : Timeline.pastoAntesDaSaida(L.f.linhas(l.animal_id), l.event_date, L.marcoZero).pasture_id;
      var x = { animal: a, pasture_id: nulo_(pasto), property_id: propriedadeDe_(L, pasto, l.event_id) };
      if (!casa_(L, f, x, l.event_date)) return;
      out.push({ tipo: tipo, data: l.event_date, mes: l.event_date.slice(0, 7), event_id: l.event_id, valor: valor(l, tipo) });
    });
    return out;
  }
  /**
   * {animal_id: valor alocado} do lançamento principal do evento (conta COMPRA_ANIMAIS na compra, VENDA_ANIMAIS na
   * venda), pelo rateio vigente dele: um re-rateio (Fase 4) muda o valor por animal sem estornar o evento.
   */
  function valoresDoPrincipal_(L, eventId, tipo) {
    var codigo = tipo === 'compras' ? FinancialService.CONTAS.COMPRA : FinancialService.CONTAS.VENDA;
    var conta = L.repo.carregada('PLANO_CONTAS') ? L.repo.vigentes('PLANO_CONTAS').filter(function (c) { return c.codigo === codigo; })[0] : null;
    var natureza = tipo === 'compras' ? 'AQUISICAO_ANIMAIS' : 'RECEITA_VENDA_ANIMAIS';
    var fin = L.repo.por('FINANCEIRO', 'event_id', eventId).filter(function (x) {
      return x.status !== 'CANCELADO' && (conta ? x.conta_id === conta.conta_id : x.natureza === natureza);
    })[0];
    var out = {};
    if (fin) alocacoesVigentes_(L, fin.financial_id).forEach(function (a) { out[a.animal_id] = (out[a.animal_id] || 0) + (a.valor_alocado || 0); });
    return out;
  }
  var TIPOS_FLUXO = ['nascimentos', 'compras', 'vendas', 'mortes', 'descartes', 'baixas_contagem'];
  var COM_VALOR = { compras: true, vendas: true };
  function somarFluxos_(linhas, motivo) {
    var out = {};
    TIPOS_FLUXO.forEach(function (t) {
      var ls = linhas.filter(function (x) { return x.tipo === t; });
      var item = { cabecas: motivo ? null : ls.length, eventos: motivo ? null : Utils.unicos(ls.map(function (x) { return x.event_id; })).length, motivo: motivo || null };
      if (COM_VALOR[t]) item.valor = motivo ? null : ls.reduce(function (s, x) { return s + (x.valor || 0); }, 0);
      out[t] = item;
    });
    return out;
  }
  /** Alocações do rateio vigente do lançamento: o do último evento vigente para o financial_id (03b, RATEIOS). */
  function alocacoesVigentes_(L, financialId) {
    var rateio = null;
    var seq = -1;
    L.repo.por('RATEIOS', 'financial_id', financialId).forEach(function (r) {
      var ev = L.f.evento(r.event_id);
      var s = ev ? ev.event_seq || 0 : 0;
      if (s > seq) { seq = s; rateio = r; }
    });
    return rateio ? L.repo.por('ALOCACOES_FINANCEIRAS', 'rateio_id', rateio.rateio_id) : [];
  }
  /**
   * Receita de vendas do período (07, seção 9, item 12): Σ FINANCEIRO de natureza RECEITA_VENDA_ANIMAIS por
   * competência, de D0 em diante; Pr pela propriedade do lançamento. Com Pa, S ou C (tratamento A) o valor é só a parte
   * alocada a animais do filtro, pelos atributos no dia da competência (o pasto em que o animal estava naquele dia);
   * no filtro de pasto, lançamento com `pasture_id` conta inteiro para o seu pasto e fica fora da soma por alocações.
   * `nao_atribuida` = a parte dos lançamentos sem alocação a animal. {valor (centavos), motivo, n, nao_atribuida, base}.
   */
  function receitaVendas_(L, periodo, f) {
    if (periodo.motivo) return { valor: null, motivo: periodo.motivo, n: 0, nao_atribuida: null, base: null };
    var porAnimal = !vazio_(f.pasture_id) || !vazio_(f.sexo) || !vazio_(f.category_id);
    var lancs = L.repo.vigentes('FINANCEIRO').filter(function (x) {
      return x.natureza === 'RECEITA_VENDA_ANIMAIS' && x.status !== 'CANCELADO' && x.data_competencia >= periodo.inicio_efetivo && x.data_competencia <= periodo.fim &&
        (vazio_(f.property_id) || x.property_id === f.property_id);
    });
    var total = 0;
    var naoAtribuida = 0;
    lancs.forEach(function (fin) {
      var alocs = alocacoesVigentes_(L, fin.financial_id);
      naoAtribuida += fin.valor - alocs.reduce(function (s, a) { return s + (a.valor_alocado || 0); }, 0);
      if (!porAnimal) { total += fin.valor; return; }
      if (!vazio_(f.pasture_id) && !vazio_(fin.pasture_id)) { if (fin.pasture_id === f.pasture_id) total += fin.valor; return; }
      alocs.forEach(function (al) {
        var a = L.repo.porId('ANIMAIS', al.animal_id);
        if (!a) return;
        var pasto = Timeline.pastoAntesDaSaida(L.f.linhas(al.animal_id), fin.data_competencia, L.marcoZero).pasture_id;
        if (casa_(L, f, { animal: a, pasture_id: pasto, property_id: null }, fin.data_competencia, ['property_id'])) total += al.valor_alocado || 0;
      });
    });
    return { valor: total, motivo: null, n: lancs.length, nao_atribuida: naoAtribuida, base: porAnimal ? 'ALOCACOES' : 'LANCAMENTOS' };
  }
  /**
   * Séries mensais da visão geral (07, seção 9): G1 evolução do rebanho (cabeças no fim de cada mês, ou em Df no mês
   * corrente, com os filtros), G6 nascimentos e mortes e G7 compras e vendas (cabeças e valor) por mês. Mês todo
   * antes do marco zero: null com ANTERIOR_AO_MARCO_ZERO; mês que começa antes dele conta dele em diante (`parcial`).
   */
  function series_(L, periodo, f, linhas) {
    var rebanho = [];
    var nm = [];
    var cv = [];
    if (periodo.motivo === 'DADOS_INSUFICIENTES') return { rebanho: rebanho, nascimentos_mortes: nm, compras_vendas: cv };
    meses_(periodo.inicio, periodo.fim).forEach(function (m) {
      var antes = m.fim < L.marcoZero;
      var parcial = !antes && m.inicio < L.marcoZero;
      var motivo = antes ? 'ANTERIOR_AO_MARCO_ZERO' : null;
      var pr = antes ? null : presentes(L, m.fim);
      rebanho.push({ mes: m.mes, data: m.fim, cabecas: pr ? pr.itens.filter(function (x) { return casa_(L, f, x, m.fim); }).length : null, motivo: motivo });
      var doMes = linhas.filter(function (x) { return x.mes === m.mes; });
      var soma = somarFluxos_(doMes, motivo);
      nm.push({ mes: m.mes, inicio: m.inicio, fim: m.fim, parcial: parcial, nascimentos: soma.nascimentos.cabecas, mortes: soma.mortes.cabecas, motivo: motivo });
      cv.push({ mes: m.mes, inicio: m.inicio, fim: m.fim, parcial: parcial, compras: soma.compras.cabecas, valor_compras: soma.compras.valor, vendas: soma.vendas.cabecas, valor_vendas: soma.vendas.valor, motivo: motivo });
    });
    return { rebanho: rebanho, nascimentos_mortes: nm, compras_vendas: cv };
  }
  /**
   * Consulta da tela "Visão geral" (rota `dashboard.obter`; 07, seção 9, no recorte da Fase 2). dados: {data_inicio?,
   * data_fim?, property_id?, pasture_id?, sexo?, category_id?}. Devolve a posição em Df (`posicao`, com os filtros) +
   * {geradoEm, periodo, pendencias: {sem_pasto, sem_brinco, sem_categoria}, titulos (`FinancialService.titulos` de
   * hoje, sem filtros), movimento: {nascimentos, compras, vendas, mortes, descartes, baixas_contagem: {cabecas,
   * eventos, valor?, motivo}}, receita_vendas, series: {rebanho, nascimentos_mortes, compras_vendas}}. Nos fluxos,
   * zero é informação; Df antes do marco zero devolve null em todos, com o motivo.
   */
  function consultaVisaoGeral(dados) {
    var d = dados || {};
    return {
      rota: 'dashboard.obter', dados: d,
      reads: Utils.unicos(leiturasPosicao_().concat(['FINANCEIRO', 'PARCELAS', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'PLANO_CONTAS'])), acessoCru: true,
      tratador: function (tx) {
        var L = AnimalService.leitor(tx);
        var periodo = periodo_(L, d);
        var f = lerFiltros_(L, d);
        var out = posicao(L, periodo.fim, f);
        var pend = pendenciasCadastro_(L);
        out.geradoEm = tx.agora;
        out.periodo = periodo;
        out.pendencias = { sem_pasto: pend.ATIVO_SEM_PASTO.length, sem_brinco: pend.SEM_BRINCO.length, sem_categoria: pend.SEM_CATEGORIA.length };
        out.titulos = FinancialService.titulos(tx.repo, L.hoje);
        if (temFiltro_(f) || periodo.fim !== L.hoje) out.etiquetas.titulos = 'em aberto hoje, sem os filtros';
        var linhas = periodo.motivo ? [] : fluxos_(L, periodo, f);
        out.movimento = somarFluxos_(linhas, periodo.motivo);
        out.receita_vendas = receitaVendas_(L, periodo, f);
        out.series = series_(L, periodo, f, linhas);
        return out;
      },
    };
  }

  // ------------------------------------------------------------------ alertas ----
  function pendenciasCadastro_(L) {
    var out = { ATIVO_SEM_PASTO: [], SEM_BRINCO: [], SEM_CATEGORIA: [] };
    L.animais.forEach(function (a) {
      if (a.situacao_cadastral !== 'ATIVO') return;
      if (vazio_(a.pasto_atual_id)) out.ATIVO_SEM_PASTO.push(a.animal_id);
      if (vazio_(a.brinco)) out.SEM_BRINCO.push(a.animal_id);
      if (!AnimalService.categoriaEm(L, a, L.hoje)) out.SEM_CATEGORIA.push(a.animal_id);
    });
    return out;
  }
  function alerta_(codigo, nivel, mensagem, ids, entidade) {
    return { codigo: codigo, nivel: nivel, mensagem: mensagem, n: ids.length, ids: ids, entidade: entidade };
  }
  function naoAvaliado_(codigo, mensagem) {
    return { codigo: codigo, motivo: 'DADOS_INSUFICIENTES', mensagem: mensagem };
  }
  /**
   * Alertas da Fase 1 (`alerta.listar`). `estado` vem de quem chama (Maintenance/Api), fora da planilha:
   * {backup: {ultimo_em: instante ISO | null}, integridade: {verificado_em, erros} | null}. Parte ausente do
   * estado não é presumida: o alerta vai para `nao_avaliados` com o motivo (P9).
   * Devolve {data, geradoEm, alertas: [{codigo, nivel (AVISO | ERRO), mensagem, n, ids, entidade}], nao_avaliados}.
   */
  function alertas(L, estado) {
    var e = estado || {};
    var lista = [];
    var nao = [];
    var pend = pendenciasCadastro_(L);
    if (pend.ATIVO_SEM_PASTO.length) lista.push(alerta_('ATIVO_SEM_PASTO', 'AVISO', pend.ATIVO_SEM_PASTO.length + ' animal(is) no rebanho sem pasto informado.', pend.ATIVO_SEM_PASTO, 'ANIMAIS'));
    if (pend.SEM_BRINCO.length) lista.push(alerta_('SEM_BRINCO', 'AVISO', pend.SEM_BRINCO.length + ' animal(is) no rebanho sem brinco.', pend.SEM_BRINCO, 'ANIMAIS'));
    if (pend.SEM_CATEGORIA.length) lista.push(alerta_('SEM_CATEGORIA', 'AVISO', pend.SEM_CATEGORIA.length + ' animal(is) que nenhuma categoria cobre. Confira as categorias nas configurações.', pend.SEM_CATEGORIA, 'ANIMAIS'));
    // Marcação "não localizado" (MARCACAO/NAO_LOCALIZADO): pendência até a baixa na contagem ou a desmarcação.
    var naoLocalizados = L.animais.filter(function (a) { return a.situacao_cadastral === 'ATIVO' && a.nao_localizado === true; }).map(function (a) { return a.animal_id; });
    if (naoLocalizados.length) lista.push(alerta_('NAO_LOCALIZADO', 'AVISO', naoLocalizados.length + ' animal(is) marcado(s) como não localizado(s): confirme a falta (baixa na contagem) ou desmarque quando aparecer(em).', naoLocalizados, 'ANIMAIS'));
    // Sanidade (RN-059; desenho-base, seção 6, alertas): procedimento vencido ou próximo pela agenda de hoje e animais em
    // carência (a mesma conta de `sanidade.agenda`, HealthService.agendaEm).
    var ag = HealthService.agendaEm(L, L.hoje, null);
    var porSit = { VENCIDA: {}, PROXIMA: {} };
    (ag.pendencias || []).forEach(function (p) { porSit[p.situacao][p.animal_id] = true; });
    var vencidos = Object.keys(porSit.VENCIDA);
    var proximos = Object.keys(porSit.PROXIMA).filter(function (id) { return !porSit.VENCIDA[id]; });
    if (vencidos.length) lista.push(alerta_('SANITARIO_VENCIDO', 'AVISO', ag.resumo.vencidas + ' procedimento(s) sanitário(s) vencido(s) em ' + vencidos.length + ' animal(is). Veja a agenda sanitária.', vencidos, 'ANIMAIS'));
    if (proximos.length || ag.resumo.proximas) {
      var comProxima = Object.keys(porSit.PROXIMA);
      lista.push(alerta_('SANITARIO_PROXIMO', 'AVISO', ag.resumo.proximas + ' procedimento(s) sanitário(s) para os próximos dias em ' + comProxima.length + ' animal(is). Veja a agenda sanitária.', comProxima, 'ANIMAIS'));
    }
    if (ag.carencia && ag.carencia.length) lista.push(alerta_('EM_CARENCIA', 'AVISO', ag.carencia.length + ' animal(is) em carência sanitária hoje: não podem ser abatidos até o fim dela.', ag.carencia.map(function (c) { return c.animal_id; }), 'ANIMAIS'));
    // Reprodução (desenho-base, seção 6, alertas: "parto previsto; prenhez com previsão vencida"): pela previsão de parto
    // das prenhas (ReproductionService, a mesma conta da tela de reprodução), sempre estimativa salvo a informada.
    if (L.repo.carregada('REPRODUCAO')) {
      var rep = ReproductionService.alertasHoje(L);
      var ids = function (cod) { return rep.itens.filter(function (x) { return x.codigo === cod; }).map(function (x) { return x.animal_id; }); };
      if (rep.PARTO_PREVISTO) lista.push(alerta_('PARTO_PREVISTO', 'AVISO', rep.PARTO_PREVISTO + ' parto(s) previsto(s) para os próximos ' + L.params.alerta_parto_previsto_dias + ' dias (estimativa). Veja a tela de reprodução.', ids('PARTO_PREVISTO'), 'ANIMAIS'));
      if (rep.PRENHEZ_VENCIDA) lista.push(alerta_('PRENHEZ_VENCIDA', 'AVISO', rep.PRENHEZ_VENCIDA + ' prenhez(es) com a previsão de parto vencida, sem parto nem aborto registrado. Confira as vacas e registre o parto ou o aborto.', ids('PRENHEZ_VENCIDA'), 'ANIMAIS'));
    }
    var limite = L.params.alerta_backup_atrasado_dias;
    if (e.backup === undefined) nao.push(naoAvaliado_('BACKUP_ATRASADO', 'A situação do backup não foi informada.'));
    else {
      var ultimo = e.backup && !vazio_(e.backup.ultimo_em) ? e.backup.ultimo_em : null;
      if (ultimo !== null && !Utils.instanteValido(ultimo)) throw Validation.erro('INTERNAL', 'Instante de backup inválido: ' + ultimo + '.');
      if (ultimo === null) lista.push(alerta_('BACKUP_ATRASADO', 'ERRO', 'Ainda não há nenhuma cópia de segurança da base. Faça um backup agora.', [], 'SISTEMA'));
      else {
        var dias = Math.floor((Date.parse(L.tx.agora) - Date.parse(ultimo)) / DIA_MS);
        if (typeof limite === 'number' && dias > limite) lista.push(alerta_('BACKUP_ATRASADO', 'ERRO', 'O último backup foi há ' + dias + ' dias (o limite é ' + limite + '). Faça um backup agora.', [], 'SISTEMA'));
      }
    }
    if (e.integridade === undefined) nao.push(naoAvaliado_('INTEGRIDADE_COM_ERRO', 'O resultado da verificação de integridade não foi informado.'));
    else if (e.integridade === null) nao.push(naoAvaliado_('INTEGRIDADE_COM_ERRO', 'A verificação de integridade ainda não foi feita.'));
    else if (typeof e.integridade.erros === 'number' && e.integridade.erros > 0) {
      lista.push(alerta_('INTEGRIDADE_COM_ERRO', 'ERRO', 'A última verificação de integridade' + (vazio_(e.integridade.verificado_em) ? '' : ' (' + Timeline.dataBr(String(e.integridade.verificado_em).slice(0, 10)) + ')') + ' encontrou ' + e.integridade.erros + ' problema(s). Abra o relatório em Configurações › Sistema.', [], 'SISTEMA'));
    }
    var importando = L.repo.vigentes('IMPORTACOES').filter(function (i) { return i.status === 'IMPORTANDO'; });
    if (importando.length) {
      lista.push(alerta_('IMPORTACAO_INCOMPLETA', 'ERRO', 'Importação incompleta' + (importando.length > 1 ? ' (' + importando.length + ')' : '') + ': ' + importando.map(function (i) { return i.arquivo_nome || i.tipo; }).join(', ') + '. Retome ou desfaça antes de lançar outros dados.', importando.map(function (i) { return i.import_id; }), 'IMPORTACOES'));
    }
    return { data: L.hoje, geradoEm: L.tx.agora, alertas: lista, nao_avaliados: nao };
  }
  /** Consulta `alerta.listar`: `estado` como em `alertas`. */
  function consultaAlertas(estado) {
    return {
      rota: 'alerta.listar', reads: Utils.unicos(leituras().concat(['IMPORTACOES', 'ESTACOES_MONTA'], HealthService.leiturasAgenda())), acessoCru: true,
      tratador: function (tx) { return alertas(AnimalService.leitor(tx), estado); },
    };
  }

  /**
   * Consulta `inventario.elegiveis` (08, seção 7): os animais que podem entrar num lançamento do tipo na data D,
   * resolvidos pela linha do tempo (o store do aparelho só sabe a posição de hoje). dados: {tipo, data?, pasture_id?}.
   * Vale para os tipos cujo filtro de elegíveis pede animal no rebanho (ATIVO): elegível = no rebanho ao fim do dia D
   * (movimentos e saídas) ou em algum momento de D (fatos: parto, identificação, marcação — o dia da saída conta, como
   * na validação), no pasto pedido nessa data e com o sexo que o tipo exige (`filtro_elegiveis.sexo`). Devolve {data, tipo,
   * pasture_id, motivo, n, itens: [{animal_id, codigo_interno, brinco (o em uso na data), brinco_hoje, sexo, pasture_id, categoria
   * (o nome na data), ultimo_peso: {kg, data, estimado} | null (a última pesagem até a data)}]};
   * antes do marco zero (ou
   * sem ele) n e itens voltam null com o motivo. VALIDATION: tipo indisponível ou sem elegíveis por presença, data
   * inválida ou futura; NOT_FOUND: pasto inexistente.
   */
  function consultaElegiveis(dados) {
    var d = dados || {};
    return {
      rota: 'inventario.elegiveis', dados: d, reads: leituras(), acessoCru: true,
      tratador: function (tx) {
        var tipo = d.tipo;
        var def = !vazio_(tipo) && EventCatalog.existe(tipo) && EventCatalog.ativo(tipo, d.subtipo || null) ? EventCatalog.tipo(tipo) : null;
        var filtro = def ? def.filtro_elegiveis : null;
        if (!def || !filtro || filtro.situacao !== 'ATIVO') {
          throw Validation.erro('VALIDATION', 'Escolha um tipo de lançamento de animais que estão no rebanho (transferência, nascimento, venda, morte, descarte).', [Validation.detalhe({ codigo: 'TIPO_SEM_ELEGIVEIS', campo: 'tipo', mensagem: 'Tipo sem lista de elegíveis por data.' })]);
        }
        var L = AnimalService.leitor(tx);
        var data = conferirData_(L, d.data);
        if (!vazio_(d.pasture_id) && !L.f.pasto(d.pasture_id)) throw Validation.erro('NOT_FOUND', 'Pasto não encontrado. Atualize a tela e tente de novo.');
        var pres = MOVIMENTO_OU_SAIDA.indexOf(tipo) >= 0 ? presentes(L, data) : presentesNoDia(L, data);
        var base = { data: data, tipo: tipo, pasture_id: vazio_(d.pasture_id) ? null : d.pasture_id, motivo: pres.motivo, n: null, itens: null };
        if (pres.motivo) return base;
        base.itens = pres.itens.filter(function (x) {
          if (!vazio_(d.pasture_id) && x.pasture_id !== d.pasture_id) return false;
          return !filtro.sexo || x.animal.sexo === filtro.sexo;
        }).map(function (x) {
          // O brinco em uso NA DATA (o do retrato: o número trocado ou reaproveitado depois é de outro animal naquele dia), e o
          // de hoje (a projeção gravada: o curral mostra "hoje X" quando os dois diferem).
          var hoje = vazio_(x.registro.brinco) ? null : x.registro.brinco;
          // A descrição do animal NA DATA (a conferência do curral e do tronco com data passada; desenho-base 4.3: o dado de
          // hoje não vale para a data passada): a categoria em D e a última pesagem até D (qualquer método, rotulada).
          var cat = AnimalService.categoriaEm(L, x.animal, data);
          var pv = AnimalService.pesoVigente(L, x.animal, data, null);
          return {
            animal_id: x.animal.animal_id, codigo_interno: x.animal.codigo_interno, brinco: vazio_(x.animal.brinco) ? null : x.animal.brinco, brinco_hoje: hoje, sexo: x.animal.sexo, pasture_id: x.pasture_id,
            categoria: cat ? cat.nome : null, ultimo_peso: pv.data_pesagem ? { kg: pv.kg, data: pv.data_pesagem, estimado: pv.metodo === 'ESTIMATIVA_VISUAL' } : null,
          };
        });
        base.n = base.itens.length;
        return base;
      },
    };
  }

  function posicaoEm(ctx, dados) { return UnitOfWork.read(ctx, consultaPosicao(dados)); }
  function elegiveis(ctx, dados) { return UnitOfWork.read(ctx, consultaElegiveis(dados)); }
  function visaoGeral(ctx, dados) { return UnitOfWork.read(ctx, consultaVisaoGeral(dados)); }
  function listarAlertas(ctx, estado) { return UnitOfWork.read(ctx, consultaAlertas(estado)); }

  return {
    ALERTAS: ALERTAS,
    leituras: leituras,
    presentes: presentes,
    presentesNoDia: presentesNoDia,
    compor: compor,
    posicao: posicao,
    alertas: alertas,
    consultaPosicao: consultaPosicao,
    consultaVisaoGeral: consultaVisaoGeral,
    consultaAlertas: consultaAlertas,
    consultaElegiveis: consultaElegiveis,
    posicaoEm: posicaoEm,
    elegiveis: elegiveis,
    visaoGeral: visaoGeral,
    listarAlertas: listarAlertas,
  };
})();
