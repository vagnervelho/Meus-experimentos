/**
 * WeightService — pesagem e desempenho (07, seção 8.1; 03b, seção 5; 05, seção 2.7; desenho-base, seção 6). Puro: lê
 * pela fonte da linha do tempo (Timeline.fonte) e devolve os números já calculados — a tela só mostra (P5). Nada aqui
 * grava: ganho, dias, GMD, variação, médias e projeção saem de PESAGENS na leitura (DV-08; P1). Projeção e média
 * calculada nunca viram pesagem (P10, RN-053) e saem sempre rotuladas.
 *
 * Regras (07, seção 8.1):
 * - pesagens do mesmo animal em ordem (data, posição na cadeia de substituição, event_seq); no mesmo dia, vale a de
 *   depois (o substituto fica no lugar do original);
 * - GMD individual só entre pesagens de método individual (BALANCA; FITA com `gmd_aceita_fita`) e dentro da mesma
 *   permanência no rebanho (o animal que saiu e voltou não soma o que ganhou fora); intervalo menor que
 *   `gmd_intervalo_min_dias` → GMD null (DADOS_INSUFICIENTES), nunca zero (RN-052); ganho, dias e variação continuam;
 * - GMD de grupo (pasto, categoria, período) = Σ ganho ÷ Σ dias dos intervalos dos animais do grupo, com n abaixo de
 *   `indicador_n_minimo` → null; o ganho de cada intervalo vai para os pastos na proporção dos dias em cada um e para a
 *   categoria do animal no início do intervalo;
 * - GMD de lote = (média da pesagem 2 − média da pesagem 1) ÷ dias, só com os animais nas duas; a média do lote pesado
 *   inteiro é o total da balança ÷ cabeças (o fato do payload);
 * - projeção = último peso individual + GMD de referência (da primeira à última pesagem individual dos últimos
 *   `gmd_referencia_janela_dias`) × dias, até `projecao_peso_horizonte_dias`, rotulada "Estimativa".
 */
var WeightService = (function () {
  var ESTIMADOS = ['ESTIMATIVA_VISUAL', 'MEDIA_LOTE'];
  var MAX_CURVAS = 5;
  var ROTULO_PROJECAO = 'Estimativa';
  var DE_EVENTO = {
    PESAGEM: 'de outra pesagem', COMPRA: 'da compra', VENDA: 'da venda', NASCIMENTO: 'do parto', ENTRADA_INICIAL: 'do rebanho inicial',
    DESMAMA: 'da desmama', OUTRA_ENTRADA: 'da entrada',
  };

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function arred_(v, casas) {
    return v === null || v === undefined ? null : Utils.arredondar(v, casas);
  }
  function indicador_(valor, motivo, n, extra) {
    var o = { valor: valor, motivo: valor === null ? motivo || 'DADOS_INSUFICIENTES' : null, n: n };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  function erroFiltro_(campo, mensagem, codigo) {
    return Validation.erro('VALIDATION', mensagem, [Validation.detalhe({ codigo: codigo || 'FORMATO_INVALIDO', campo: campo, mensagem: mensagem })]);
  }
  function cmp_(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function ordem_(a, b) {
    return cmp_(a.data, b.data) || (a.ord - b.ord) || (a.seq - b.seq) || cmp_(String(a.weight_id), String(b.weight_id));
  }

  // ------------------------------------------------------------------ série do animal ----
  function individual(metodo, params) {
    return metodo === 'BALANCA' || (metodo === 'FITA' && !!params && params.gmd_aceita_fita === true);
  }
  function estimado(metodo) {
    return ESTIMADOS.indexOf(metodo) >= 0;
  }
  /**
   * Pesagens vigentes do animal na fonte, em ordem: [{weight_id, event_id, event_type, event_subtype, data, peso_kg,
   * metodo, tipo, observacoes, jejum, individual, estimado, ord, seq}].
   */
  function serie(f, animalId, params) {
    return f.pesagens(animalId).filter(function (p) { return typeof p.peso_kg === 'number' && Utils.dataValida(p.data_pesagem); }).map(function (p) {
      var ev = f.evento(p.event_id);
      return {
        weight_id: p.weight_id, event_id: p.event_id, event_type: ev ? ev.event_type : null, event_subtype: ev && !vazio_(ev.event_subtype) ? ev.event_subtype : null,
        data: p.data_pesagem, peso_kg: p.peso_kg, metodo: p.metodo, tipo: p.tipo, observacoes: vazio_(p.observacoes) ? null : p.observacoes,
        jejum: !!(ev && ev.payload_json && ev.payload_json.jejum === true), individual: individual(p.metodo, params), estimado: estimado(p.metodo),
        ord: ev ? f.ordemSeq(p.event_id) || 0 : 0, seq: ev ? ev.event_seq || 0 : 0, historico: !!(ev && ev.pre_marco_zero === true),
      };
    }).sort(ordem_);
  }
  /**
   * As pesagens em volta de uma data, para os avisos do lançamento (RN-050): {anterior (a última antes da data),
   * seguinte (a primeira depois), mesmoDia: [as da própria data]}, de qualquer método.
   */
  function vizinhas(f, animalId, data) {
    var todas = serie(f, animalId, null);
    var antes = todas.filter(function (x) { return x.data < data; });
    var depois = todas.filter(function (x) { return x.data > data; });
    return { anterior: antes.length ? antes[antes.length - 1] : null, seguinte: depois.length ? depois[0] : null, mesmoDia: todas.filter(function (x) { return x.data === data; }) };
  }
  /** "da compra", "de outra pesagem": de onde veio a pesagem, para as mensagens. */
  function origemDaPesagem(f, x) {
    if (DE_EVENTO[x.event_type]) return DE_EVENTO[x.event_type];
    var nome = EventCatalog.nomeEvento(x.event_type, x.event_subtype);
    return nome.indexOf('a ') === 0 ? 'da ' + nome.slice(2) : nome.indexOf('o ') === 0 ? 'do ' + nome.slice(2) : 'de ' + nome;
  }
  /**
   * Entre duas pesagens {data, peso_kg} (03b, seção 5): ganho = P2 − P1 (1 casa); dias = D2 − D1; GMD = ganho ÷ dias (3
   * casas; null com 0 dias); variação = (P2 ÷ P1 − 1) × 100 (2 casas).
   */
  function variacao(p1, p2) {
    var dias = Utils.diffDias(p1.data, p2.data);
    var ganho = Utils.arredondar(p2.peso_kg - p1.peso_kg, 1);
    return {
      de: p1.data, ate: p2.data, peso_de_kg: p1.peso_kg, peso_ate_kg: p2.peso_kg, ganho_kg: ganho, dias: dias,
      gmd_kg_dia: dias > 0 ? Utils.arredondar(ganho / dias, 3) : null, variacao_pct: p1.peso_kg > 0 ? Utils.arredondar((p2.peso_kg / p1.peso_kg - 1) * 100, 2) : null,
    };
  }
  /** A variação por dia fora da faixa plausível (`gmd_plausivel_min_kg_dia` a `gmd_plausivel_max_kg_dia`; RN-050). */
  function implausivel(gmd, params) {
    if (typeof gmd !== 'number') return false;
    var min = typeof params.gmd_plausivel_min_kg_dia === 'number' ? params.gmd_plausivel_min_kg_dia : -1;
    var max = typeof params.gmd_plausivel_max_kg_dia === 'number' ? params.gmd_plausivel_max_kg_dia : 2;
    return gmd < min || gmd > max;
  }
  /** Uma pesagem individual por dia (a de depois na posição), na ordem. */
  function porDia_(lista) {
    var out = [];
    lista.forEach(function (x) {
      if (out.length && out[out.length - 1].data === x.data) out[out.length - 1] = x;
      else out.push(x);
    });
    return out;
  }
  /** Permanências do animal no rebanho (Timeline.validar): [{inicio, fim}], os dois limites inclusivos; fim null = aberta. */
  function permanencias_(f, animalId) {
    return Timeline.validar(f.linhas(animalId), {}).periodos;
  }
  function permanenciaDe_(periodos, data) {
    for (var i = 0; i < periodos.length; i++) {
      var p = periodos[i];
      if (data >= p.inicio && (p.fim === null || data <= p.fim)) return i;
    }
    return -1;
  }
  function publico_(x) {
    return {
      weight_id: x.weight_id, event_id: x.event_id, event_type: x.event_type, data: x.data, peso_kg: x.peso_kg, metodo: x.metodo, tipo: x.tipo,
      jejum: x.jejum, individual: x.individual, estimado: x.estimado, observacoes: x.observacoes,
    };
  }
  /**
   * Intervalos entre as pesagens individuais consecutivas do animal (uma por dia): [{de, ate, peso_de_kg, peso_ate_kg,
   * ganho_kg, dias, gmd_kg_dia, variacao_pct, motivo, explicacao, conta}]. `conta` = entra nas somas do período e dos
   * grupos (os dois lados na mesma permanência). Fora da mesma permanência, ou com menos dias que o mínimo, GMD null.
   */
  function intervalos(serieDoAnimal, periodos, params) {
    var min = typeof params.gmd_intervalo_min_dias === 'number' ? params.gmd_intervalo_min_dias : 28;
    var dias = porDia_(serieDoAnimal.filter(function (x) { return x.individual; }));
    var out = [];
    for (var i = 1; i < dias.length; i++) {
      var a = dias[i - 1];
      var b = dias[i];
      var v = variacao(a, b);
      v.weight_de = a.weight_id;
      v.weight_ate = b.weight_id;
      var pa = permanenciaDe_(periodos, a.data);
      v.conta = pa >= 0 && pa === permanenciaDe_(periodos, b.data);
      v.motivo = null;
      v.explicacao = null;
      if (!v.conta) {
        v.gmd_kg_dia = null;
        v.motivo = 'DADOS_INSUFICIENTES';
        // A pesagem anterior ao marco zero (histórico importado) fica na curva, mas fora de qualquer permanência do controle.
        v.explicacao = a.historico || b.historico ? 'Pesagem anterior ao marco zero: o ganho médio diário só é calculado a partir do marco zero (a pesagem antiga aparece na curva).' : 'O animal esteve fora do rebanho entre as duas pesagens.';
      } else if (v.dias < min) {
        v.gmd_kg_dia = null;
        v.motivo = 'DADOS_INSUFICIENTES';
        v.explicacao = 'Intervalo de ' + v.dias + (v.dias === 1 ? ' dia' : ' dias') + ', menor que os ' + min + ' dias mínimos para o ganho médio diário.';
      }
      out.push(v);
    }
    return out;
  }
  /**
   * Por que nenhum intervalo conta (P9, o motivo de cada vazio): menos de duas pesagens individuais, ou várias pesagens com
   * nenhum intervalo dentro do controle (a pesagem anterior ao marco zero; o animal fora do rebanho entre as duas).
   */
  function semIntervalo_(ints) {
    if (!ints.length) return 'Menos de duas pesagens individuais.';
    var hist = ints.some(function (v) { return /marco zero/.test(v.explicacao || ''); });
    var fora = ints.some(function (v) { return /fora do rebanho/.test(v.explicacao || ''); });
    return 'Há ' + (ints.length + 1) + ' pesagens individuais, mas nenhum intervalo entre elas conta: ' +
      (hist && fora ? 'umas são anteriores ao marco zero e, nas outras, o animal esteve fora do rebanho entre as pesagens.' : hist ? 'as pesagens anteriores ao marco zero ficam fora do ganho médio diário.' : 'o animal esteve fora do rebanho entre as pesagens.');
  }
  /** Σ ganho ÷ Σ dias dos intervalos que contam (no período), com o mínimo de dias: {ganho_kg, dias, gmd: indicador}. */
  function somaPeriodo_(ints, params) {
    var min = typeof params.gmd_intervalo_min_dias === 'number' ? params.gmd_intervalo_min_dias : 28;
    var ganho = 0;
    var dias = 0;
    ints.forEach(function (v) { if (v.conta) { ganho += v.ganho_kg; dias += v.dias; } });
    ganho = Utils.arredondar(ganho, 1);
    var gmd = dias >= min && dias > 0 ? Utils.arredondar(ganho / dias, 3) : null;
    return { ganho_kg: dias ? ganho : null, dias: dias, gmd: indicador_(gmd, 'DADOS_INSUFICIENTES', dias ? 1 : 0, { dias: dias, explicacao: gmd === null ? (dias ? 'Menos de ' + min + ' dias entre a primeira e a última pesagem individual.' : semIntervalo_(ints)) : null }) };
  }
  /**
   * Projeção de peso (07, seção 8.1): base = a última pesagem individual na permanência aberta; GMD de referência = da
   * primeira à última pesagem individual dos `gmd_referencia_janela_dias` anteriores à base (com o mínimo de dias);
   * pontos da base até a base + `projecao_peso_horizonte_dias`; `hoje` = o peso estimado na data de hoje, se ela couber no
   * horizonte. Sempre rotulada "Estimativa" e nunca gravada. null com o motivo quando não há base ou GMD de referência.
   */
  function projecao_(serieDoAnimal, periodos, params, hoje) {
    var aberta = periodos.length && periodos[periodos.length - 1].fim === null ? periodos[periodos.length - 1] : null;
    var nada = function (explicacao) { return { valor: null, motivo: 'DADOS_INSUFICIENTES', explicacao: explicacao, rotulo: ROTULO_PROJECAO }; };
    if (!aberta) return nada('O animal não está no rebanho: não há peso a projetar.');
    var ind = porDia_(serieDoAnimal.filter(function (x) { return x.individual && x.data >= aberta.inicio; }));
    if (!ind.length) return nada('Sem pesagem individual na permanência atual.');
    var base = ind[ind.length - 1];
    var janela = typeof params.gmd_referencia_janela_dias === 'number' ? params.gmd_referencia_janela_dias : 120;
    var min = typeof params.gmd_intervalo_min_dias === 'number' ? params.gmd_intervalo_min_dias : 28;
    var desde = Utils.somaDias(base.data, -janela);
    var primeira = ind.filter(function (x) { return x.data >= desde; })[0];
    var dias = Utils.diffDias(primeira.data, base.data);
    if (primeira === base || dias < min) return nada('Sem ganho médio diário de referência: são precisas duas pesagens individuais com ao menos ' + min + ' dias entre elas nos últimos ' + janela + ' dias antes da última.');
    var gmd = Utils.arredondar(Utils.arredondar(base.peso_kg - primeira.peso_kg, 1) / dias, 3);
    var h = typeof params.projecao_peso_horizonte_dias === 'number' ? params.projecao_peso_horizonte_dias : 90;
    var ate = Utils.somaDias(base.data, h);
    var em = function (d) { return Utils.arredondar(base.peso_kg + gmd * Utils.diffDias(base.data, d), 1); };
    var naData = hoje > base.data && hoje <= ate ? { data: hoje, peso_kg: em(hoje) } : null;
    return {
      valor: true, motivo: null, rotulo: ROTULO_PROJECAO, base: { data: base.data, peso_kg: base.peso_kg }, referencia_de: primeira.data, gmd_referencia_kg_dia: gmd,
      horizonte_dias: h, ate: ate, pontos: [{ data: base.data, peso_kg: base.peso_kg }, { data: ate, peso_kg: em(ate) }], hoje: naData,
      explicacao_hoje: naData ? null : hoje > ate ? 'Hoje passa do horizonte de ' + h + ' dias depois da última pesagem: sem estimativa.' : null,
    };
  }
  function ultimoDoTipo_(s, tipo) {
    var l = s.filter(function (x) { return x.tipo === tipo; });
    return l.length ? l[l.length - 1] : null;
  }
  /**
   * Desempenho de UM animal (bloco E da ficha; curvas da tela): {serie, intervalos, ganho_acumulado, gmd_periodo,
   * peso_atual, peso_ao_nascer, peso_desmama, ponto_nascer_estimado, projecao}. `ponto_nascer_estimado`: sem pesagem ao
   * nascer, o `peso_nascer_padrao_kg_macho`/`_femea` na data do nascimento, como ponto estimado da curva, fora das
   * contas (07, seção 8.1; P10). opcoes: {de, ate} recortam a série e os intervalos (os dois lados no período).
   */
  function desempenhoAnimal(f, a, params, hoje, opcoes) {
    var o = opcoes || {};
    var s = serie(f, a.animal_id, params);
    var periodos = permanencias_(f, a.animal_id);
    var no = function (d) { return (vazio_(o.de) || d >= o.de) && (vazio_(o.ate) || d <= o.ate); };
    var sp = s.filter(function (x) { return no(x.data); });
    var ints = intervalos(sp, periodos, params);
    var soma = somaPeriodo_(ints, params);
    var ultima = s.length ? s[s.length - 1] : null;
    var nasc = ultimoDoTipo_(s, 'NASCIMENTO');
    var desm = ultimoDoTipo_(s, 'DESMAMA');
    var padrao = a.sexo === 'M' ? params.peso_nascer_padrao_kg_macho : a.sexo === 'F' ? params.peso_nascer_padrao_kg_femea : null;
    return {
      serie: sp.map(publico_),
      intervalos: ints,
      ganho_acumulado: indicador_(soma.ganho_kg, 'DADOS_INSUFICIENTES', ints.filter(function (v) { return v.conta; }).length, { dias: soma.dias, unidade: 'kg' }),
      gmd_periodo: soma.gmd,
      peso_atual: indicador_(ultima ? ultima.peso_kg : null, 'DADOS_INSUFICIENTES', s.length, { data: ultima ? ultima.data : null, metodo: ultima ? ultima.metodo : null, estimado: ultima ? ultima.estimado : false, unidade: 'kg' }),
      peso_ao_nascer: indicador_(nasc ? nasc.peso_kg : null, 'DADOS_INSUFICIENTES', nasc ? 1 : 0, { data: nasc ? nasc.data : null, unidade: 'kg' }),
      peso_desmama: indicador_(desm ? desm.peso_kg : null, 'DADOS_INSUFICIENTES', desm ? 1 : 0, { data: desm ? desm.data : null, unidade: 'kg' }),
      ponto_nascer_estimado: !nasc && typeof padrao === 'number' && Utils.dataValida(a.data_nascimento) && no(a.data_nascimento)
        ? { data: a.data_nascimento, peso_kg: padrao, rotulo: 'Peso ao nascer de referência (estimado, fora das contas)' } : null,
      projecao: projecao_(s, periodos, params, hoje),
    };
  }
  /** Os parâmetros que a tela mostra junto das contas (o porquê de um "—"). */
  function parametrosDasContas_(params) {
    return {
      intervalo_min_dias: params.gmd_intervalo_min_dias, aceita_fita: params.gmd_aceita_fita === true, n_minimo: params.indicador_n_minimo,
      janela_referencia_dias: params.gmd_referencia_janela_dias, horizonte_projecao_dias: params.projecao_peso_horizonte_dias,
      plausivel_min_kg_dia: params.gmd_plausivel_min_kg_dia, plausivel_max_kg_dia: params.gmd_plausivel_max_kg_dia, validade_peso_dias: params.peso_validade_dias,
    };
  }
  /** Bloco E da ficha (08, seção 3): a curva, a tabela com ganho, dias, GMD e variação, e a projeção rotulada. */
  function blocoFicha(L, a) {
    var d = desempenhoAnimal(L.f, a, L.params, L.hoje);
    d.entregue = true;
    d.parametros = parametrosDasContas_(L.params);
    return d;
  }

  /** O animal no pasto e na categoria do filtro na data (a presença no fim do período). */
  function noFiltroEm_(L, a, data, d) {
    if (!vazio_(d.pasture_id)) {
      var sit = Timeline.situacaoEm(L.f.linhas(a.animal_id), data, L.marcoZero);
      if (!sit.presente || sit.pasture_id !== d.pasture_id) return false;
    }
    if (!vazio_(d.category_id)) { var c = AnimalService.categoriaEm(L, a, data); if (!c || c.category_id !== d.category_id) return false; }
    return true;
  }
  /**
   * O ganho médio diário da pesagem `s[i]`, pela MESMA conta da ficha (intervalos: só entre individuais da mesma permanência,
   * a última de cada dia, com o intervalo mínimo; RN-052, 07, seção 8.1): o do intervalo que termina nesta pesagem, contra a
   * pesagem individual anterior (a estimada ou a média do lote no meio não contam). Sem intervalo, vazio com o porquê
   * verdadeiro: a própria pesagem estimada, outra individual depois dela no mesmo dia, ou nenhuma individual antes.
   * {gmd_kg_dia, motivo, explicacao}. O modo curral mostra o que vem daqui, nunca uma conta própria.
   */
  function gmdDaPesagem_(s, i, periodos, params) {
    var x = s[i];
    var nada = function (explicacao) { return { gmd_kg_dia: null, motivo: 'DADOS_INSUFICIENTES', explicacao: explicacao }; };
    var v = intervalos(s, periodos, params).filter(function (y) { return y.weight_ate === x.weight_id; })[0];
    if (v) return { gmd_kg_dia: v.gmd_kg_dia, motivo: v.motivo, explicacao: v.explicacao, intervalo: { de: v.de, peso_de_kg: v.peso_de_kg, ganho_kg: v.ganho_kg, dias: v.dias } };
    if (!x.individual) return nada('Esta pesagem é estimada (estimativa visual, média do lote' + (params && params.gmd_aceita_fita === true ? '' : ' ou fita') + '): fica fora do ganho médio diário.');
    if (s.slice(i + 1).some(function (y) { return y.individual && y.data === x.data; })) return nada('Há outra pesagem no mesmo dia, depois desta: o ganho médio diário fica com a última do dia.');
    if (s.slice(0, i).some(function (y) { return y.data < x.data; })) return nada('As pesagens anteriores são estimadas (estimativa visual, média do lote' + (params && params.gmd_aceita_fita === true ? '' : ' ou fita') + '): ficam fora do ganho médio diário.');
    return nada('Primeira pesagem do animal: sem anterior para comparar.');
  }

  // ------------------------------------------------------------------ resultado do lançamento ----
  /** Resumo da pesagem no plano (impactos do SIMULAR): o momento, o método, o lote, quantas, total e média. */
  function resumoDoPlano(p, linhas) {
    var total = linhas.reduce(function (t, x) { return t + x.peso_kg; }, 0);
    return {
      tipo: p.tipo, metodo: p.metodo, jejum: p.jejum, lote: p.lote, n: linhas.length,
      total_kg: linhas.length ? Utils.arredondar(total, 1) : null, media_kg: linhas.length ? Utils.arredondar(total / linhas.length, 1) : null,
    };
  }
  /**
   * Resultado de um evento PESAGEM gravado (resposta do registrar e do reenvio): {n, total_kg, media_kg, tipo, metodo,
   * jejum, lote, animais: [{animal_id, peso_kg, anterior: {data, peso_kg, metodo, estimado} | null, ganho_kg, dias, gmd_kg_dia, gmd_motivo,
   * gmd_explicacao, gmd_intervalo: {de, peso_de_kg, ganho_kg, dias} | null, variacao_pct}]} — o ganho, os dias e a variação
   * contra a pesagem imediatamente anterior (qualquer método); o GMD pela conta da ficha (gmdDaPesagem_: vazio com o porquê no
   * intervalo curto e na pesagem estimada), com o intervalo dele.
   */
  function resultadoDoEvento(tx, eventId) {
    var linhas = tx.cru ? tx.cru.cruPor('PESAGENS', 'event_id', eventId) : tx.repo.por('PESAGENS', 'event_id', eventId);
    var ev = tx.cru ? tx.cru.cruPorId('EVENTOS', eventId) : tx.repo.porId('EVENTOS', eventId);
    if (!linhas.length || !ev) return null;
    var f = Timeline.fonte(tx);
    var params = Config.parametros(tx.repo);
    var validade = params.peso_validade_dias;
    var total = 0;
    var animais = linhas.map(function (r) {
      total += r.peso_kg;
      var s = serie(f, r.animal_id, params);
      var i = -1;
      s.forEach(function (x, k) { if (x.weight_id === r.weight_id) i = k; });
      var ant = i > 0 ? s[i - 1] : null;
      var v = ant ? variacao(ant, { data: r.data_pesagem, peso_kg: r.peso_kg }) : null;
      var g = i >= 0 ? gmdDaPesagem_(s, i, permanencias_(f, r.animal_id), params) : { gmd_kg_dia: null, motivo: 'DADOS_INSUFICIENTES', explicacao: null };
      // O peso atual do animal depois do lançamento (a projeção gravada: no retroativo continua o mais recente), para a lista
      // do aparelho se atualizar sem recarregar o rebanho inteiro.
      var a = tx.cru ? tx.cru.cruPorId('ANIMAIS', r.animal_id) : tx.repo.porId('ANIMAIS', r.animal_id);
      var dataAtual = a && !vazio_(a.data_ultima_pesagem) ? a.data_ultima_pesagem : null;
      return {
        animal_id: r.animal_id, peso_kg: r.peso_kg, anterior: ant ? { data: ant.data, peso_kg: ant.peso_kg, metodo: ant.metodo, estimado: ant.estimado === true } : null,
        ganho_kg: v ? v.ganho_kg : null, dias: v ? v.dias : null, gmd_kg_dia: g.gmd_kg_dia, gmd_motivo: g.gmd_kg_dia === null ? g.motivo : null, gmd_explicacao: g.gmd_kg_dia === null ? g.explicacao : null,
        // O intervalo do GMD (07, seção 8.1: o ganho e os dias do MESMO intervalo), que pode começar antes da pesagem anterior
        // mostrada (a estimada ou a do mesmo dia no meio ficam fora): a linha do curral diz desde quando ele é contado.
        gmd_intervalo: g.intervalo || null,
        variacao_pct: v ? v.variacao_pct : null,
        peso_atual: a && typeof a.peso_atual === 'number' ? a.peso_atual : null, data_ultima_pesagem: dataAtual,
        peso_vencido: a && a.situacao_cadastral === 'ATIVO' && dataAtual && typeof validade === 'number' && !vazio_(tx.hoje) ? Utils.diffDias(dataAtual, tx.hoje) > validade : null,
      };
    });
    var pj = ev.payload_json || {};
    return {
      n: linhas.length, total_kg: Utils.arredondar(total, 1), media_kg: Utils.arredondar(total / linhas.length, 1), tipo: linhas[0].tipo, metodo: linhas[0].metodo,
      jejum: pj.jejum === true, lote: typeof pj.peso_total_lote_kg === 'number' ? { total_kg: pj.peso_total_lote_kg, cabecas: pj.qtd_cabecas_lote } : null, animais: animais,
    };
  }

  // ------------------------------------------------------------------ lote ----
  function aceitaNoLote_(metodo, params) {
    return metodo === 'MEDIA_LOTE' || individual(metodo, params);
  }
  /** As linhas de um evento de pesagem (vigente), por animal: {ev, porAnimal: {id: peso}, lote: {total, cabecas} | null}. */
  function pesagemDoEvento_(tx, ev, params) {
    var porAnimal = {};
    tx.repo.por('PESAGENS', 'event_id', ev.event_id).forEach(function (r) { if (typeof r.peso_kg === 'number' && aceitaNoLote_(r.metodo, params)) porAnimal[r.animal_id] = r.peso_kg; });
    var pj = ev.payload_json || {};
    return { ev: ev, porAnimal: porAnimal, lote: typeof pj.peso_total_lote_kg === 'number' && typeof pj.qtd_cabecas_lote === 'number' ? { total: pj.peso_total_lote_kg, cabecas: pj.qtd_cabecas_lote } : null };
  }
  function mediaNoLote_(p, comuns) {
    var todos = Object.keys(p.porAnimal);
    if (p.lote && comuns.length === todos.length && p.lote.cabecas === todos.length) return p.lote.total / p.lote.cabecas;
    return comuns.reduce(function (t, id) { return t + p.porAnimal[id]; }, 0) / comuns.length;
  }
  /**
   * GMD de lote (07, seção 8.1) entre duas pesagens: (média 2 − média 1) ÷ dias, só com os animais presentes nas duas; a
   * média da pesagem por lote com todos os animais em comum é o total da balança ÷ cabeças. Pesagem por estimativa visual
   * fica de fora. n abaixo de `indicador_n_minimo` ou intervalo menor que `gmd_intervalo_min_dias` → null.
   */
  function gmdLote_(a, b, params) {
    var comuns = Object.keys(a.porAnimal).filter(function (id) { return id in b.porAnimal; }).sort();
    var dias = Utils.diffDias(a.ev.event_date, b.ev.event_date);
    var nMin = typeof params.indicador_n_minimo === 'number' ? params.indicador_n_minimo : 5;
    var min = typeof params.gmd_intervalo_min_dias === 'number' ? params.gmd_intervalo_min_dias : 28;
    var extra = { dias: dias, comparada_com: { event_id: a.ev.event_id, data: a.ev.event_date }, media_de_kg: null, media_ate_kg: null };
    if (!comuns.length) return indicador_(null, 'DADOS_INSUFICIENTES', 0, extra);
    var m1 = mediaNoLote_(a, comuns);
    var m2 = mediaNoLote_(b, comuns);
    extra.media_de_kg = Utils.arredondar(m1, 1);
    extra.media_ate_kg = Utils.arredondar(m2, 1);
    var ok = comuns.length >= nMin && dias >= min;
    extra.explicacao = ok ? null : comuns.length < nMin ? 'Só ' + comuns.length + (comuns.length === 1 ? ' animal está' : ' animais estão') + ' nas duas pesagens (mínimo ' + nMin + ').' : 'Intervalo de ' + dias + ' dias, menor que os ' + min + ' dias mínimos.';
    return indicador_(ok ? Utils.arredondar((m2 - m1) / dias, 3) : null, 'DADOS_INSUFICIENTES', comuns.length, extra);
  }

  // ------------------------------------------------------------------ consulta de desempenho ----
  function leituras() {
    return Utils.unicos(AnimalService.leituras().concat(Timeline.LEITURAS, ['PROPRIEDADES']));
  }
  /** Dias do intervalo [de, ate) em cada pasto, pelas estadas do animal: {pasture_id | SEM_PASTO: dias}. */
  function diasPorPasto_(estadas, de, ate) {
    var out = {};
    estadas.forEach(function (s) {
      var a = s.inicio > de ? s.inicio : de;
      var b = s.fim === null || s.fim > ate ? ate : s.fim;
      if (a >= b) return;
      var k = s.pasture_id === null ? 'SEM_PASTO' : s.pasture_id;
      out[k] = (out[k] || 0) + Utils.diffDias(a, b);
    });
    return out;
  }
  function conferirFiltros_(L, d) {
    var de = vazio_(d.de) ? L.marcoZero : d.de;
    var ate = vazio_(d.ate) ? L.hoje : d.ate;
    if (!vazio_(d.de) && !Utils.dataValida(d.de)) throw erroFiltro_('de', 'O início do período não é uma data válida.');
    if (!vazio_(d.ate) && !Utils.dataValida(d.ate)) throw erroFiltro_('ate', 'O fim do período não é uma data válida.');
    if (!vazio_(de) && !vazio_(ate) && de > ate) throw erroFiltro_('ate', 'O fim do período (' + Timeline.dataBr(ate) + ') é anterior ao início (' + Timeline.dataBr(de) + ').', 'FAIXA_INVALIDA');
    if (!vazio_(ate) && ate > L.hoje) throw erroFiltro_('ate', 'O fim do período (' + Timeline.dataBr(ate) + ') ainda não chegou.', 'DATA_FUTURA');
    if (!vazio_(d.sexo) && ['M', 'F'].indexOf(d.sexo) < 0) throw erroFiltro_('sexo', 'Sexo é macho ou fêmea.', 'VALOR_FORA_DA_LISTA');
    if (!vazio_(d.pasture_id) && !L.f.pasto(d.pasture_id)) throw Validation.erro('NOT_FOUND', 'Pasto não encontrado. Atualize a tela e tente de novo.');
    if (!vazio_(d.category_id) && !L.categoriaPorId[d.category_id]) throw Validation.erro('NOT_FOUND', 'Categoria não encontrada. Atualize a tela e tente de novo.');
    var animais = d.animais === undefined || d.animais === null ? [] : d.animais;
    if (!Array.isArray(animais) || animais.some(function (x) { return typeof x !== 'string'; })) throw erroFiltro_('animais', 'Escolha os animais das curvas pela lista.', 'TIPO_INVALIDO');
    if (animais.length > MAX_CURVAS) throw erroFiltro_('animais', 'As curvas comparam até ' + MAX_CURVAS + ' animais por vez.', 'VALOR_FORA_DA_FAIXA');
    return { de: de, ate: ate, animais: Utils.unicos(animais) };
  }
  function nomeCategoria_(L, id) {
    var c = id ? L.categoriaPorId[id] : null;
    return c ? c.nome : null;
  }
  function ganhoDoGrupo_(g, params) {
    var nMin = typeof params.indicador_n_minimo === 'number' ? params.indicador_n_minimo : 5;
    var n = Object.keys(g.animais).length;
    var valor = n >= nMin && g.dias > 0 ? Utils.arredondar(g.ganho / g.dias, 3) : null;
    return indicador_(valor, 'DADOS_INSUFICIENTES', n, { dias: g.dias, ganho_kg: g.dias ? Utils.arredondar(g.ganho, 1) : null, explicacao: valor === null ? (n ? 'Só ' + n + (n === 1 ? ' animal' : ' animais') + ' com ganho medido no período (mínimo ' + nMin + ').' : 'Nenhum animal com duas pesagens individuais no período.') : null });
  }
  function grupo_(mapa, chave) {
    if (!mapa[chave]) mapa[chave] = { ganho: 0, dias: 0, animais: {} };
    return mapa[chave];
  }
  /**
   * Evolução do peso (07, seção 9, G5; 07, seção 8.1): a média das pesagens individuais (uma por animal e dia, as que
   * entram no GMD) de cada mês do período, com o n; mês com n abaixo de `indicador_n_minimo` → null com
   * DADOS_INSUFICIENTES. A projeção e os pesos estimados nunca entram. → [{mes, valor, motivo, n, animais, explicacao}].
   */
  function evolucaoMensal_(mensal, de, ate, params) {
    var nMin = typeof params.indicador_n_minimo === 'number' ? params.indicador_n_minimo : 5;
    var chaves = Object.keys(mensal).sort();
    var m = vazio_(de) ? chaves[0] : de.slice(0, 7);
    var out = [];
    while (m && m <= ate.slice(0, 7)) {
      var g = mensal[m] || { soma: 0, n: 0, animais: {} };
      var valor = g.n >= nMin ? Utils.arredondar(g.soma / g.n, 1) : null;
      out.push(indicador_(valor, 'DADOS_INSUFICIENTES', g.n, { mes: m, animais: Object.keys(g.animais).length,
        explicacao: valor !== null ? null : g.n ? 'Só ' + g.n + (g.n === 1 ? ' pesagem' : ' pesagens') + ' no mês (mínimo ' + nMin + ').' : 'Nenhuma pesagem individual no mês.' }));
      m = Utils.somaMeses(m + '-01', 1).slice(0, 7);
    }
    return out;
  }
  /**
   * Consulta `peso.desempenho` (07, seção 8.1; 08, seção 3, tela Pesagens). filtros: {de, ate (período; padrão: o marco
   * zero e hoje), pasture_id, sexo, category_id, raca, animais: [até 5 animal_id para as curvas]}. Devolve {periodo,
   * filtros, parametros, geral, por_pasto, por_categoria, pesagens, evolucao, animais, curvas}:
   * - geral, por_pasto e por_categoria: cabeças e peso médio no fim do período (o peso vigente, com a validade e a parte
   *   estimada: InventoryService.compor) e o GMD do período (Σ ganho ÷ Σ dias dos animais do grupo, n mínimo);
   * - pesagens: os eventos PESAGEM do período, com o GMD de lote contra a pesagem anterior com animais em comum;
   * - animais: cada animal com pesagem no período (peso atual, GMD do período);
   * - curvas: a série, os intervalos e a projeção de cada animal pedido;
   * - evolucao: a média mensal das pesagens individuais (G5, `evolucaoMensal_`), com os mesmos filtros (pasto e categoria
   *   da data da pesagem);
   * - por_pasto[].por_categoria e sem_categoria: as cabeças de cada categoria no pasto, no fim do período (o gráfico do
   *   rebanho por categoria).
   * Antes do marco zero (ou sem ele) as composições vêm null com o motivo. VALIDATION nos filtros; NOT_FOUND no pasto ou
   * na categoria que não existe.
   */
  function consultaDesempenho(filtros) {
    var d = filtros || {};
    return {
      rota: 'peso.desempenho', dados: d, reads: leituras(), acessoCru: true,
      tratador: function (tx) {
        var L = AnimalService.leitor(tx);
        var per = conferirFiltros_(L, d);
        var params = L.params;
        var casa = function (a) {
          if (!vazio_(d.sexo) && a.sexo !== d.sexo) return false;
          if (!vazio_(d.raca) && a.raca !== d.raca) return false;
          return true;
        };
        // GMD do período: os intervalos de cada animal, com o ganho dividido pelos pastos (dias) e pela categoria do início.
        var geral = { ganho: 0, dias: 0, animais: {} };
        var porPasto = {};
        var porCat = {};
        var linhasAnimais = [];
        var mensal = {};
        var minDias = typeof params.gmd_intervalo_min_dias === 'number' ? params.gmd_intervalo_min_dias : 28;
        L.animais.forEach(function (a) {
          if (a.situacao_cadastral === 'EXTERNO' || a.situacao_cadastral === 'ANULADO' || a.situacao_cadastral === 'PENDENTE' || !casa(a)) return;
          var s = serie(L.f, a.animal_id, params);
          if (!s.length) return;
          var noPeriodo = s.filter(function (x) { return (vazio_(per.de) || x.data >= per.de) && x.data <= per.ate; });
          if (!noPeriodo.length) return;
          var pesadoNoFiltro = false;
          porDia_(noPeriodo.filter(function (x) { return x.individual; })).forEach(function (x) {
            if (!vazio_(d.pasture_id) && Timeline.situacaoEm(L.f.linhas(a.animal_id), x.data, L.marcoZero).pasture_id !== d.pasture_id) return;
            if (!vazio_(d.category_id)) { var cx = AnimalService.categoriaEm(L, a, x.data); if (!cx || cx.category_id !== d.category_id) return; }
            pesadoNoFiltro = true;
            var gm = mensal[x.data.slice(0, 7)] = mensal[x.data.slice(0, 7)] || { soma: 0, n: 0, animais: {} };
            gm.soma += x.peso_kg; gm.n++; gm.animais[a.animal_id] = true;
          });
          var periodos = permanencias_(L.f, a.animal_id);
          var todos = intervalos(noPeriodo, periodos, params);
          var ints = todos.filter(function (v) { return v.conta; });
          var soma = somaPeriodo_(todos, params);
          var noFiltro = vazio_(d.pasture_id) && vazio_(d.category_id);
          var estadas = Timeline.estadas(L.f.linhas(a.animal_id));
          var contou = soma.dias >= minDias;
          ints.forEach(function (v) {
            if (!contou) return;
            var cat = AnimalService.categoriaEm(L, a, v.de);
            var catId = cat ? cat.category_id : 'SEM_CATEGORIA';
            if (!vazio_(d.category_id) && catId !== d.category_id) return;
            var dp = diasPorPasto_(estadas, v.de, v.ate);
            Object.keys(dp).forEach(function (pid) {
              if (!vazio_(d.pasture_id) && pid !== d.pasture_id) return;
              noFiltro = true;
              var parte = v.ganho_kg * dp[pid] / v.dias;
              var gp = grupo_(porPasto, pid);
              gp.ganho += parte; gp.dias += dp[pid]; gp.animais[a.animal_id] = true;
              geral.ganho += parte; geral.dias += dp[pid]; geral.animais[a.animal_id] = true;
              var gc = grupo_(porCat, catId);
              gc.ganho += parte; gc.dias += dp[pid]; gc.animais[a.animal_id] = true;
            });
          });
          // A tabela "Animais" segue o filtro de pasto e de categoria do GMD (07, seção 8.1): o animal com intervalo no pasto ou
          // na categoria filtrada, com pesagem lá no período, ou presente lá no fim do período.
          if (!noFiltro) noFiltro = pesadoNoFiltro || noFiltroEm_(L, a, per.ate, d);
          if (!noFiltro) return;
          var ultima = s.filter(function (x) { return x.data <= per.ate; }).pop();
          // O animal no fim do período (o retrato em `ate`; CONTRATOS, seção 46): o brinco, a situação e o pasto daquele dia,
          // não os de hoje (a venda ou a transferência depois do período não mudam a tabela do período).
          var r = AnimalService.retratoEm(L, a, per.ate) || a;
          linhasAnimais.push({
            animal_id: a.animal_id, codigo_interno: a.codigo_interno, brinco: vazio_(r.brinco) ? null : r.brinco, sexo: a.sexo || null, raca: a.raca || null,
            situacao_cadastral: r.situacao_cadastral, pasture_id: vazio_(r.pasto_atual_id) ? null : r.pasto_atual_id,
            ultima: ultima ? { data: ultima.data, peso_kg: ultima.peso_kg, metodo: ultima.metodo, estimado: ultima.estimado } : null,
            pesagens: noPeriodo.length, ganho_kg: soma.ganho_kg, dias: soma.dias, gmd: soma.gmd,
          });
        });
        // Peso médio e cabeças no fim do período: os presentes (com os filtros), pelo peso vigente (validade e referência).
        var pres = vazio_(L.marcoZero) || per.ate < L.marcoZero ? { motivo: vazio_(L.marcoZero) ? 'DADOS_INSUFICIENTES' : 'ANTERIOR_AO_MARCO_ZERO', itens: null } : InventoryService.presentes(L, per.ate);
        var compoeGeral = null;
        var compPasto = {};
        var compCat = {};
        if (!pres.motivo) {
          // Contas de cabeças, categoria e peso em `ate`: pela projeção (o sexo e a raça não mudam com a data; a categoria e o
          // peso em `ate` saem da linha do tempo), sem o retrato de cada animal (InventoryService.presentes, `registro`).
          var itens = pres.itens.filter(function (x) {
            if (!casa(x.registro)) return false;
            if (!vazio_(d.pasture_id) && x.pasture_id !== d.pasture_id) return false;
            if (!vazio_(d.category_id)) { var c = AnimalService.categoriaEm(L, x.registro, per.ate); if (!c || c.category_id !== d.category_id) return false; }
            return true;
          });
          compoeGeral = InventoryService.compor(L, itens, per.ate);
          Utils.unicos(itens.map(function (x) { return x.pasture_id || 'SEM_PASTO'; })).forEach(function (pid) {
            compPasto[pid] = InventoryService.compor(L, itens.filter(function (x) { return (x.pasture_id || 'SEM_PASTO') === pid; }), per.ate);
          });
          var catDe = {};
          itens.forEach(function (x) { var c = AnimalService.categoriaEm(L, x.registro, per.ate); var k = c ? c.category_id : 'SEM_CATEGORIA'; (catDe[k] = catDe[k] || []).push(x); });
          Object.keys(catDe).forEach(function (k) { compCat[k] = InventoryService.compor(L, catDe[k], per.ate); });
        }
        var linhaGrupo = function (comp, g) {
          return { cabecas: comp ? comp.cabecas : null, peso_medio: comp ? comp.peso_medio : indicador_(null, pres.motivo, 0), ua: comp ? comp.ua : null, gmd: ganhoDoGrupo_(g || { ganho: 0, dias: 0, animais: {} }, params),
            por_categoria: comp ? comp.por_categoria.map(function (c) { return { category_id: c.category_id, nome: c.nome, cabecas: c.cabecas }; }) : null, sem_categoria: comp ? comp.sem_categoria : null };
        };
        var pastosIds = Utils.unicos(Object.keys(porPasto).concat(Object.keys(compPasto)));
        var listaPastos = pastosIds.map(function (pid) {
          var p = pid === 'SEM_PASTO' ? null : L.f.pasto(pid);
          var x = linhaGrupo(compPasto[pid] || (pres.motivo ? null : InventoryService.compor(L, [], per.ate)), porPasto[pid]);
          x.pasture_id = pid === 'SEM_PASTO' ? null : pid;
          x.nome = p ? p.nome : 'Sem pasto';
          x.rotulo = x.nome;
          return x;
        });
        // Dois pastos com o mesmo nome (permitido em propriedades diferentes; ESPECIFICACAO, seção 21): o rótulo leva a
        // propriedade (e, se ainda repetir, a identificação), e o gráfico e a tabela usam o rótulo — um pasto nunca some no outro.
        var rotular = function (campo) {
          var vistos = {};
          listaPastos.forEach(function (x) { vistos[x.rotulo] = (vistos[x.rotulo] || 0) + 1; });
          listaPastos.forEach(function (x) { if (vistos[x.rotulo] > 1 && x.pasture_id) { var t = campo(L.f.pasto(x.pasture_id) || {}); if (t) x.rotulo = x.rotulo + ' (' + t + ')'; } });
        };
        rotular(function (p) { var pr = !vazio_(p.property_id) && L.repo.carregada('PROPRIEDADES') ? L.repo.porId('PROPRIEDADES', p.property_id) : null; return pr ? pr.nome : null; });
        rotular(function (p) { return vazio_(p.identificacao) ? p.pasture_id : p.identificacao; });
        var catIds = Utils.unicos(Object.keys(porCat).concat(Object.keys(compCat)));
        var listaCats = catIds.map(function (cid) {
          var x = linhaGrupo(compCat[cid] || (pres.motivo ? null : InventoryService.compor(L, [], per.ate)), porCat[cid]);
          x.category_id = cid === 'SEM_CATEGORIA' ? null : cid;
          x.nome = cid === 'SEM_CATEGORIA' ? 'Sem categoria' : nomeCategoria_(L, cid);
          return x;
        });
        var g = linhaGrupo(compoeGeral, geral);
        g.motivo = pres.motivo;
        return {
          periodo: { de: per.de, ate: per.ate }, filtros: { pasture_id: d.pasture_id || null, sexo: d.sexo || null, category_id: d.category_id || null, raca: d.raca || null },
          parametros: parametrosDasContas_(params),
          geral: g,
          por_pasto: Utils.ordenarPor(listaPastos, function (x) { return x.rotulo || ''; }),
          por_categoria: Utils.ordenarPor(listaCats, function (x) { var c = x.category_id ? L.categoriaPorId[x.category_id] : null; return c && typeof c.prioridade === 'number' ? c.prioridade : 9999; }),
          pesagens: pesagensDoPeriodo_(tx, L, per, params, function (a, data) {
            if (!casa(a)) return false;
            if (!vazio_(d.pasture_id)) { var sit = Timeline.situacaoEm(L.f.linhas(a.animal_id), data, L.marcoZero); if (sit.pasture_id !== d.pasture_id) return false; }
            if (!vazio_(d.category_id)) { var c = AnimalService.categoriaEm(L, a, data); if (!c || c.category_id !== d.category_id) return false; }
            return true;
          }),
          evolucao: evolucaoMensal_(mensal, per.de, per.ate, params),
          animais: Utils.ordenarPor(linhasAnimais, function (x) { return x.brinco || x.codigo_interno; }),
          curvas: per.animais.map(function (id) {
            var a = tx.repo.porId('ANIMAIS', id);
            if (!a) throw Validation.erro('NOT_FOUND', 'Animal da curva não encontrado. Atualize a tela e tente de novo.');
            var x = desempenhoAnimal(L.f, a, params, L.hoje);
            x.animal_id = a.animal_id;
            x.brinco = vazio_(a.brinco) ? null : a.brinco;
            x.codigo_interno = a.codigo_interno;
            return x;
          }),
        };
      },
    };
  }
  /**
   * Os eventos PESAGEM vigentes do período, do mais recente ao mais antigo: {event_id, data, tipo, metodo, jejum, lote,
   * n, media_kg, gmd_lote} — o GMD de lote contra a pesagem anterior mais recente com ao menos `indicador_n_minimo`
   * animais em comum e o intervalo mínimo (sem ela, null com o motivo). Com filtro (`noFiltro(animal, data)`: o pasto, o
   * sexo, a categoria e a raça da tela, o pasto e a categoria na data da pesagem; 07, seção 8.1), cada lançamento conta só
   * os animais do filtro — n, a média e o GMD de lote —, e o lançamento sem nenhum deles sai da lista.
   */
  function pesagensDoPeriodo_(tx, L, per, params, noFiltro) {
    var todas = tx.repo.vigentes('EVENTOS').filter(function (e) { return e.event_type === 'PESAGEM'; }).map(function (e) {
      var p = pesagemDoEvento_(tx, e, params);
      var linhas = tx.repo.por('PESAGENS', 'event_id', e.event_id);
      p.linhas = noFiltro ? linhas.filter(function (r) { var a = L.f.animal(r.animal_id); return a && noFiltro(a, e.event_date); }) : linhas;
      if (p.linhas.length !== linhas.length) {
        // O lote filtrado não é o lote da balança: a média é a dos animais do filtro.
        var ids = {};
        p.linhas.forEach(function (r) { ids[r.animal_id] = true; });
        Object.keys(p.porAnimal).forEach(function (id) { if (!ids[id]) delete p.porAnimal[id]; });
        p.lote = null;
      }
      return p;
    });
    todas.sort(function (a, b) { return cmp_(a.ev.event_date, b.ev.event_date) || ((L.f.ordemSeq(a.ev.event_id) || 0) - (L.f.ordemSeq(b.ev.event_id) || 0)); });
    var nMin = typeof params.indicador_n_minimo === 'number' ? params.indicador_n_minimo : 5;
    var min = typeof params.gmd_intervalo_min_dias === 'number' ? params.gmd_intervalo_min_dias : 28;
    var out = [];
    todas.forEach(function (b, i) {
      if ((!vazio_(per.de) && b.ev.event_date < per.de) || b.ev.event_date > per.ate) return;
      var linhas = b.linhas;
      if (!linhas.length) return;
      var total = linhas.reduce(function (t, r) { return t + (r.peso_kg || 0); }, 0);
      var gl = null;
      for (var k = i - 1; k >= 0 && !gl; k--) {
        var a = todas[k];
        if (Utils.diffDias(a.ev.event_date, b.ev.event_date) < min) continue;
        var comuns = Object.keys(a.porAnimal).filter(function (id) { return id in b.porAnimal; }).length;
        if (comuns >= nMin) gl = gmdLote_(a, b, params);
      }
      out.push({
        event_id: b.ev.event_id, data: b.ev.event_date, tipo: linhas.length ? linhas[0].tipo : null, metodo: linhas.length ? linhas[0].metodo : null,
        jejum: !!(b.ev.payload_json && b.ev.payload_json.jejum === true), lote: b.lote ? { total_kg: b.lote.total, cabecas: b.lote.cabecas } : null,
        n: linhas.length, media_kg: linhas.length ? Utils.arredondar(total / linhas.length, 1) : null,
        gmd_lote: gl || indicador_(null, 'DADOS_INSUFICIENTES', 0, { explicacao: 'Sem pesagem anterior com ao menos ' + nMin + ' destes animais e ' + min + ' dias de intervalo.' }),
      });
    });
    return out.reverse();
  }
  function desempenho(ctx, filtros) {
    return UnitOfWork.read(ctx, consultaDesempenho(filtros));
  }

  return {
    MAX_CURVAS: MAX_CURVAS,
    ROTULO_PROJECAO: ROTULO_PROJECAO,
    individual: individual,
    estimado: estimado,
    serie: serie,
    vizinhas: vizinhas,
    origemDaPesagem: origemDaPesagem,
    variacao: variacao,
    implausivel: implausivel,
    intervalos: intervalos,
    desempenhoAnimal: desempenhoAnimal,
    blocoFicha: blocoFicha,
    resumoDoPlano: resumoDoPlano,
    resultadoDoEvento: resultadoDoEvento,
    gmdLote: function (tx, eventoA, eventoB, params) { return gmdLote_(pesagemDoEvento_(tx, eventoA, params), pesagemDoEvento_(tx, eventoB, params), params); },
    leituras: leituras,
    consultaDesempenho: consultaDesempenho,
    desempenho: desempenho,
  };
})();
