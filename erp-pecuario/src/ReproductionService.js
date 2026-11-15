/**
 * ReproductionService — o que a reprodução já entrega na Fase 2: o histórico de partos da matriz (03b, seção 7;
 * 03a, seções 4.3.3 e 4.3.4) e os avisos do parto (05, RN-061 e RN-064). Exposição, cobertura, inseminação,
 * diagnóstico, aborto, desmama e os indicadores por estação chegam na Fase 3.
 *
 * Puro: recebe a fonte da linha do tempo (`Timeline.fonte`) ou o leitor do AnimalService; nunca grava. Um parto é um
 * evento NASCIMENTO com UMA linha REPRODUCAO (PARTO), mesmo gemelar e mesmo com zero nascidos vivos (DV-15).
 */
var ReproductionService = (function () {
  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function nulo_(v) {
    return vazio_(v) ? null : v;
  }

  /**
   * Partos vigentes da matriz, do mais antigo ao mais recente (data, event_seq). f = Timeline.fonte (respeita os
   * eventos excluídos da fonte: validação de estorno e de substituição). Cada item: {reproduction_id, event_id,
   * event_seq, data, nascidos_vivos, natimortos, tipo_parto, pai_id, pre_marco_zero}.
   */
  function partos(f, matrizId) {
    var out = [];
    f.reproducao(matrizId).forEach(function (r) {
      if (r.tipo_evento !== 'PARTO') return;
      var ev = f.evento(r.event_id);
      out.push({
        reproduction_id: r.reproduction_id, event_id: r.event_id, event_seq: ev ? ev.event_seq : 0, data: r.data,
        nascidos_vivos: typeof r.qtd_nascidos_vivos === 'number' ? r.qtd_nascidos_vivos : 0,
        natimortos: typeof r.qtd_natimortos === 'number' ? r.qtd_natimortos : 0,
        tipo_parto: nulo_(r.tipo_parto), pai_id: nulo_(r.touro_id), pre_marco_zero: !!(ev && ev.pre_marco_zero === true),
      });
    });
    return out.sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : a.event_seq - b.event_seq; });
  }

  /**
   * Número de partos da matriz. `partos_previos` é o que se declarou na entrada sobre os partos ANTERIORES a ela;
   * partos registrados antes da entrada descrevem o mesmo passado, por isso vale o maior dos dois; os registrados
   * da entrada em diante somam. dataEntrada = data do evento de entrada vigente (marco zero no rebanho inicial).
   */
  function contarPartos(partosPrevios, lista, dataEntrada) {
    var antes = 0;
    var depois = 0;
    (lista || []).forEach(function (p) {
      if (!vazio_(dataEntrada) && p.data < dataEntrada) antes++;
      else depois++;
    });
    var previos = typeof partosPrevios === 'number' ? partosPrevios : 0;
    return Math.max(previos, antes) + depois;
  }

  /**
   * Avisos de um parto em `data` (05, RN-061 e RN-064). matriz: {data_nascimento}; outros: partos vigentes da matriz
   * (sem o próprio, na correção); params: CONFIGURACOES tipadas. Devolve [{codigo, mensagem}] (sem o "quem").
   *  - IDADE_REPRODUTIVA: a matriz tinha menos de `idade_min_reprodutiva_meses` meses completos no parto;
   *  - INTERVALO_PARTO_CURTO: outro parto da matriz a menos de `dias_gestacao` dias (antes ou depois deste).
   */
  function avisosParto(params, matriz, data, outros) {
    var out = [];
    var minimo = params.idade_min_reprodutiva_meses;
    if (matriz && !vazio_(matriz.data_nascimento) && typeof minimo === 'number' && matriz.data_nascimento < data) {
      var idade = Utils.idadeMeses(matriz.data_nascimento, data);
      if (idade < minimo) out.push({ codigo: 'IDADE_REPRODUTIVA', mensagem: 'a mãe tinha ' + idade + ' meses no parto, abaixo da idade reprodutiva mínima (' + minimo + ' meses).' });
    }
    var gest = params.dias_gestacao;
    if (typeof gest === 'number') {
      var perto = null;
      (outros || []).forEach(function (p) {
        var d = Math.abs(Utils.diffDias(p.data, data));
        if (d < gest && (perto === null || d < perto.dias)) perto = { dias: d, data: p.data };
      });
      if (perto) {
        var quando = perto.data === data ? 'no mesmo dia' : perto.data < data ? perto.dias + ' dias antes' : perto.dias + ' dias depois';
        out.push({ codigo: 'INTERVALO_PARTO_CURTO', mensagem: 'a mãe tem outro parto registrado em ' + Timeline.dataBr(perto.data) + ' (' + quando + '); a gestação dura cerca de ' + gest + ' dias. Se for o mesmo parto, corrija aquele lançamento em vez de lançar outro.' });
      }
    }
    return out;
  }

  /** Data do evento de entrada vigente mais recente do animal (a partir do marco zero), ou null. */
  function dataDaEntrada_(f, animalId) {
    var entradas = Timeline.ordenar(f.linhas(animalId).filter(function (l) { return l.efeito === 1 && !l.pre_marco_zero; }));
    return entradas.length ? entradas[entradas.length - 1].event_date : null;
  }
  function cria_(f, id) {
    var a = f.animal(id);
    if (!a) return { animal_id: id, codigo_interno: null, brinco: null, sexo: null, situacao_cadastral: null };
    return { animal_id: a.animal_id, codigo_interno: a.codigo_interno, brinco: nulo_(a.brinco), sexo: nulo_(a.sexo), situacao_cadastral: a.situacao_cadastral };
  }

  /**
   * Histórico de partos de uma fêmea (bloco G da ficha, parte de partos), na leitura: {partos (do mais antigo ao mais
   * recente, cada um com intervalo_dias até o anterior, crias vivas e natimortos), n_partos, partos_previos,
   * partos_registrados, ultimo_parto, crias_nascidas_vivas, natimortos, intervalo_medio_dias: {valor, motivo, n}}.
   * f = Timeline.fonte; a = registro vigente de ANIMAIS.
   */
  function historico(f, a) {
    var lista = partos(f, a.animal_id);
    var anterior = null;
    var intervalos = [];
    var vivos = 0;
    var mortos = 0;
    var itens = lista.map(function (p) {
      var crias = f.linhasDoEvento(p.event_id).filter(function (l) { return l.papel === 'CRIA'; }).map(function (l) { return cria_(f, l.animal_id); });
      var intervalo = anterior ? Utils.diffDias(anterior.data, p.data) : null;
      if (intervalo !== null) intervalos.push(intervalo);
      anterior = p;
      vivos += p.nascidos_vivos;
      mortos += p.natimortos;
      return {
        event_id: p.event_id, data: p.data, nascidos_vivos: p.nascidos_vivos, natimortos: p.natimortos, gemelar: p.nascidos_vivos + p.natimortos > 1,
        tipo_parto: p.tipo_parto, pai_id: p.pai_id, pre_marco_zero: p.pre_marco_zero, intervalo_dias: intervalo, crias: crias,
      };
    });
    var media = intervalos.length ? Math.round(intervalos.reduce(function (s, x) { return s + x; }, 0) / intervalos.length) : null;
    return {
      partos: itens,
      partos_previos: typeof a.partos_previos === 'number' ? a.partos_previos : null,
      partos_registrados: itens.length,
      n_partos: contarPartos(a.partos_previos, lista, dataDaEntrada_(f, a.animal_id)),
      ultimo_parto: itens.length ? itens[itens.length - 1].data : null,
      crias_nascidas_vivas: vivos,
      natimortos: mortos,
      intervalo_medio_dias: { valor: media, motivo: media === null ? 'DADOS_INSUFICIENTES' : null, n: intervalos.length },
    };
  }

  /**
   * Bloco G da ficha (reprodutivo). Fêmea: situação reprodutiva, cria ao pé e o histórico de partos; macho: só a
   * marca de que o bloco não se aplica a partos. Sempre `parcial: true` com o que falta e a fase em que chega.
   */
  function blocoFicha(f, a) {
    var femea = a.sexo === 'F';
    var out = {
      entregue: true, parcial: true, aplica: femea,
      pendente: { modulo: 'REPRODUCAO', fase: 3, mensagem: 'Exposição, cobertura, inseminação, diagnóstico de gestação, aborto e desmama chegam com o módulo de reprodução (Fase 3).' },
      situacao_reprodutiva: femea ? nulo_(a.situacao_reprodutiva) : null,
      cria_ao_pe: femea ? a.cria_ao_pe === true : null,
    };
    if (!femea) {
      out.mensagem = 'Partos só se registram em fêmeas.';
      out.partos = [];
      return out;
    }
    var h = historico(f, a);
    Object.keys(h).forEach(function (k) { out[k] = h[k]; });
    return out;
  }

  return {
    partos: partos,
    contarPartos: contarPartos,
    avisosParto: avisosParto,
    historico: historico,
    blocoFicha: blocoFicha,
  };
})();
