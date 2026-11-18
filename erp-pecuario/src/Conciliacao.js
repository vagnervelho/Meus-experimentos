/**
 * Conciliacao — as três visões do financeiro e a identidade que as liga (07-financeiro-e-indicadores.md, seções 1.1, 2.1 e
 * 2.2; desenho-base, seções 7 e 16.14). Puro: `fatos(tx)` lê as linhas vigentes uma vez (o predicado único de lançamento,
 * parcela, rateio e alocação vigentes é o do Repository) e devolve dados simples; o resto são contas sobre esses dados, em
 * centavos inteiros, sem relógio e sem planilha.
 *
 * Regra de tempo (o número pedido numa data D): conta só o lançamento com `data_competencia` até D (o fato é do dia dele, e o
 * lançamento retroativo é um fato antigo), a parcela paga até D, a saída do rebanho até D e a alocação de lançamento que já
 * contava em D. Cadastro nenhum entra: a natureza e o tipo são cópias gravadas no lançamento. O histórico anterior ao marco
 * zero fica fora das três visões (o pagamento foi anterior ao controle do sistema; 04, seção 6).
 *
 * Visão 1 (caixa): Σ valor_pago das parcelas LIQUIDADAS com pagamento no período (receita soma, despesa subtrai).
 * Visão 2 (resultado gerencial): RV + OR − DV − CA − CT − J + DB, por competência, com o rateio por dias da competência por
 * período (maior resto por mês e, dentro do mês, por dia; no empate de resto, o mais antigo recebe o centavo).
 * Identidade (07, 2.1): resultado acumulado até D = caixa acumulado + a receber − a pagar + custo de aquisição do rebanho ativo
 * + insumos em estoque + despesa antecipada (líquida de receita antecipada) − saldo de abertura − não operacional líquido.
 */
var Conciliacao = (function () {
  var RESULTADO_RECEITA = { RECEITA_VENDA_ANIMAIS: 'receita_venda', OUTRA_RECEITA: 'outras_receitas' };
  var RESULTADO_DESPESA = { DESPESA_VENDA: 'despesas_venda', CUSTEIO: 'custeio' };
  /** A linha do custo de aquisição de quem saiu (07, 2.1, CA), pelo tipo do lançamento da saída. */
  var LINHA_SAIDA = { VENDA: 'vendidos_descartados', DESCARTE: 'vendidos_descartados', MORTE: 'mortes' };
  var CONTA_ABERTURA = 'SALDO_ABERTURA_REBANHO';
  /** Os termos da identidade (07, 2.1), na ordem da fórmula. */
  var TERMOS = ['resultado_acumulado', 'caixa_acumulado', 'a_receber', 'a_pagar', 'custo_rebanho_ativo', 'insumos_estoque', 'despesa_antecipada', 'saldo_abertura', 'nao_operacional'];

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function inteiro_(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }
  function exigirData_(d, nome) {
    if (typeof d !== 'string' || !Utils.dataValida(d)) throw Validation.erro('VALIDATION', 'Informe ' + nome + ' como uma data válida (aaaa-mm-dd).', [{ codigo: 'FORMATO_INVALIDO', campo: nome, mensagem: 'Data inválida.' }]);
  }
  function mesDe_(d) {
    return d.slice(0, 7);
  }
  function fimDoMes_(mes) {
    return Utils.somaDias(Utils.somaMeses(mes + '-01', 1), -1);
  }
  /** Os meses de `de` a `ate` ('yyyy-MM'), na ordem. */
  function meses(de, ate) {
    var out = [];
    if (vazio_(de) || vazio_(ate) || de > ate) return out;
    var m = mesDe_(de);
    var ult = mesDe_(ate);
    for (var guarda = 0; m <= ult && guarda < 2400; guarda++) {
      out.push(m);
      m = mesDe_(Utils.somaMeses(m + '-01', 1));
    }
    return out;
  }

  // ------------------------------------------------------------------ competência por período ----
  /**
   * O valor de um lançamento com período, mês a mês (07, 1.1): valor × dias de interseção ÷ dias totais, fechado pelo maior
   * resto; no empate de resto, o mês mais antigo recebe o centavo. [{mes, inicio, fim, dias, valor}], na ordem dos meses.
   * Arrendamento de R$ 24.000,00 de 01/01 a 31/12/2027: março = R$ 2.038,36; a soma dos doze meses = R$ 24.000,00.
   */
  function porMes(valor, inicio, fim) {
    if (!inteiro_(valor) || valor < 0) throw Validation.erro('INTERNAL', 'porMes espera o valor em centavos inteiros, não negativo.');
    var total = Utils.diasNoIntervalo(inicio, fim);
    var itens = meses(inicio, fim).map(function (m) {
      var i = Utils.intersecaoIntervalos(m + '-01', fimDoMes_(m), inicio, fim);
      return { mes: m, inicio: i.inicio, fim: i.fim, dias: i.dias, valor: 0, resto: 0 };
    });
    var distribuido = 0;
    itens.forEach(function (x) {
      // valor × dias cabe no inteiro exato do JavaScript até R$ 24 trilhões em 366 dias.
      var p = valor * x.dias;
      x.valor = Math.floor(p / total);
      x.resto = p - x.valor * total;
      distribuido += x.valor;
    });
    var ordem = itens.slice().sort(function (a, b) { return b.resto - a.resto || (a.mes < b.mes ? -1 : 1); });
    for (var k = 0; k < valor - distribuido; k++) ordem[k].valor += 1;
    return itens.map(function (x) { return { mes: x.mes, inicio: x.inicio, fim: x.fim, dias: x.dias, valor: x.valor }; });
  }
  /**
   * A parte da competência do lançamento até o fim do dia D, em centavos: sem período, o valor inteiro quando a competência
   * é até D; com período, os meses inteiros até D (porMes) mais, no mês de D, os dias até D — o valor do mês dividido
   * igualmente pelos dias dele, com os centavos que sobram para os primeiros dias. Assim a parte até o fim de cada mês é a
   * soma dos meses, e nenhum centavo nasce ou some entre um dia e outro.
   */
  function competenciaAte(l, D) {
    if (vazio_(l.inicio) || vazio_(l.fim)) return l.data <= D ? l.valor : 0;
    if (D < l.inicio) return 0;
    if (D >= l.fim) return l.valor;
    var s = 0;
    porMes(l.valor, l.inicio, l.fim).forEach(function (m) {
      if (m.fim <= D) { s += m.valor; return; }
      if (m.inicio > D) return;
      var k = Utils.diffDias(m.inicio, D) + 1;
      var q = Math.floor(m.valor / m.dias);
      var r = m.valor - q * m.dias;
      s += q * k + Math.min(k, r);
    });
    return s;
  }

  // ------------------------------------------------------------------ fatos ----
  /** As abas que `fatos` lê (a consulta declara estas; o Timeline precisa de acesso cru para a ordem do dia). */
  function leituras() {
    return Utils.unicos(Timeline.LEITURAS.concat(['FINANCEIRO', 'PARCELAS', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'PLANO_CONTAS']));
  }
  /**
   * Os fatos das três visões, lidos uma vez das linhas vigentes: {marco_zero, lancamentos, permanencias}. Lançamento:
   * {financial_id, event_id, ancora (o evento de negócio: `ref_event_id` ou o criador), natureza, tipo, valor, data, inicio,
   * fim, consumo (custeio de insumo, sem caixa), abertura (saldo de abertura do rebanho), parcelas: [{valor, status,
   * data_pagamento, valor_pago, juros_multa, desconto}], alocacoes: [{animal_id, valor}]}. Permanências de cada animal com
   * alocação de aquisição: [{entrada: {event_id, data}, saida: {event_id, data, linha} | null}], na ordem canônica.
   */
  function fatos(tx, opcoes) {
    var so = opcoes && opcoes.animais ? Utils.indexarPor(opcoes.animais.map(function (id) { return { id: id }; }), 'id') : null;
    var repo = tx.repo;
    var f = Timeline.fonte(tx);
    var temContas = repo.carregada('PLANO_CONTAS');
    var lancamentos = [];
    var historico = [];
    var contas = {};
    if (temContas) {
      repo.vigentes('PLANO_CONTAS').forEach(function (c) {
        contas[c.conta_id] = { conta_id: c.conta_id, codigo: c.codigo, nome: c.nome, grupo: c.grupo, natureza: c.natureza, tipo: c.tipo, classe_custo_animal: c.classe_custo_animal, ordem: typeof c.ordem === 'number' ? c.ordem : 0 };
      });
    }
    repo.vigentes('FINANCEIRO').forEach(function (fin) {
      var ev = repo.porId('EVENTOS', fin.event_id);
      if (!ev) return;
      var conta = contas[fin.conta_id] || null;
      var l = {
        financial_id: fin.financial_id, event_id: fin.event_id, ancora: vazio_(fin.ref_event_id) ? fin.event_id : fin.ref_event_id,
        natureza: fin.natureza, tipo: fin.tipo, valor: fin.valor || 0, data: fin.data_competencia,
        inicio: vazio_(fin.competencia_inicio) ? null : fin.competencia_inicio, fim: vazio_(fin.competencia_fim) ? null : fin.competencia_fim,
        consumo: fin.natureza === 'CUSTEIO' && !vazio_(fin.product_id),
        abertura: !!conta && conta.codigo === CONTA_ABERTURA,
        // Fase 4, E4.4 e E4.5: o que o demonstrativo e o custo por animal e por pasto leem. O grupo é a cópia gravada no lançamento
        // (FINANCEIRO.categoria); a classe do custo do animal é a da conta, que não muda depois do primeiro lançamento (03a, 4.13).
        conta_id: fin.conta_id || null, grupo: fin.categoria || (conta ? conta.grupo : null), classe: conta ? conta.classe_custo_animal || null : null,
        pasture_id: vazio_(fin.pasture_id) ? null : fin.pasture_id, descricao: vazio_(fin.descricao) ? null : fin.descricao,
        partner_id: vazio_(fin.partner_id) ? null : fin.partner_id,
        event_type: ev.event_type || null, event_date: ev.event_date || null,
        parcelas: repo.por('PARCELAS', 'financial_id', fin.financial_id).map(function (p) {
          return { valor: p.valor || 0, status: p.status, data_pagamento: vazio_(p.data_pagamento) ? null : p.data_pagamento, valor_pago: p.valor_pago || 0, juros_multa: p.juros_multa || 0, desconto: p.desconto || 0 };
        }),
        alocacoes: repo.por('ALOCACOES_FINANCEIRAS', 'financial_id', fin.financial_id).map(function (a) { return { animal_id: a.animal_id, valor: a.valor_alocado || 0 }; }),
        // Os rateios de evento vigente, na ordem em que um substitui o outro (Fase 4, E4.3): o rateio que vale numa data D é o
        // último com data até D (o mesmo predicado de Repository.rateioEm), e a conta em D não muda com um re-rateio posterior.
        rateios: repo.rateiosDoLancamento(fin.financial_id).map(function (r) {
          var er = repo.porId('EVENTOS', r.event_id) || {};
          var alocs = tx.cru ? tx.cru.cruPor('ALOCACOES_FINANCEIRAS', 'rateio_id', r.rateio_id) : repo.por('ALOCACOES_FINANCEIRAS', 'rateio_id', r.rateio_id);
          return {
            rateio_id: r.rateio_id, event_id: r.event_id, event_type: er.event_type || null, data: er.event_date || null, criterio: r.criterio || null, escopo_tipo: r.escopo_tipo || null,
            data_base: vazio_(r.data_base) ? null : r.data_base, periodo_inicio: vazio_(r.periodo_inicio) ? null : r.periodo_inicio, periodo_fim: vazio_(r.periodo_fim) ? null : r.periodo_fim,
            base_total: r.base_total === undefined ? null : r.base_total,
            alocacoes: alocs.map(function (a) { return { animal_id: a.animal_id, valor: a.valor_alocado || 0, base: a.base_valor === undefined ? null : a.base_valor }; }),
          };
        }),
      };
      // O histórico anterior ao marco zero fica fora das três visões (04, seção 6); o custo do animal que só existe no histórico
      // (comprado e vendido antes do marco zero) o lê na passagem histórica dele (Custos).
      if (ev.pre_marco_zero === true) { l.pre_marco_zero = true; historico.push(l); } else lancamentos.push(l);
    });
    var permanencias = {};
    var historicas = {};
    var porAnimal = {};
    if (so) Object.keys(so).forEach(function (id) { porAnimal[id] = f.linhas(id); });
    else porAnimal = Utils.agruparPor(f.todasAsLinhas(), 'animal_id');
    Object.keys(porAnimal).sort().forEach(function (id) {
      var lista = passagensDe_(porAnimal[id]);
      if (lista.length) { permanencias[id] = lista; return; }
      var h = passagemHistorica_(porAnimal[id]);
      if (h) historicas[id] = [h];
    });
    return { marco_zero: f.marcoZero || null, lancamentos: lancamentos, historico: historico, permanencias: permanencias, historicas: historicas, contas: contas };
  }
  /** A ponta (entrada ou saída) de uma passagem, pela linha da linha do tempo. */
  function ponta_(x) {
    var p = { event_id: x.event_id, data: x.event_date, tipo: x.event_type, event_animal_id: x.event_animal_id || null };
    if (x.event_type === 'ENTRADA_INICIAL' && x.payload && x.payload.valor_abertura_origem === 'TABELA_PRECOS') p.abertura_estimada = true;
    return p;
  }
  /**
   * As passagens do animal pela fazenda do marco zero em diante, na ordem canônica: cada entrada (efeito +1) abre uma, e a saída
   * (efeito −1) a fecha. [{entrada: {event_id, data, tipo}, saida: {event_id, data, tipo, linha} | null}].
   */
  function passagensDe_(linhas) {
    var lista = [];
    var atual = null;
    Timeline.ordenar((linhas || []).filter(function (x) { return !x.pre_marco_zero; })).forEach(function (x) {
      if (x.efeito === 1) {
        atual = { entrada: ponta_(x), saida: null };
        lista.push(atual);
      } else if (x.efeito === -1 && atual) {
        atual.saida = ponta_(x);
        atual.saida.linha = LINHA_SAIDA[x.event_type] || 'baixas_ajuste';
        atual = null;
      }
    });
    return lista;
  }
  /**
   * A passagem do animal que só existe no histórico (comprado, ou nascido, e vendido antes do marco zero; a mesma fronteira do
   * custo de aquisição da projeção, Timeline.entradaDoCusto): a entrada histórica e a primeira saída histórica depois dela.
   */
  function passagemHistorica_(linhas) {
    var ent = Timeline.entradaDoCusto(linhas);
    if (!ent || !ent.pre_marco_zero) return null;
    var p = { entrada: ponta_(ent), saida: null, historica: true };
    var depois = false;
    Timeline.ordenar((linhas || []).filter(function (x) { return x.pre_marco_zero; })).forEach(function (x) {
      if (x.event_id === ent.event_id) { depois = true; return; }
      if (!depois || p.saida) return;
      if (x.efeito === -1 || (LINHA_SAIDA[x.event_type] && (x.papel || 'SUJEITO') === 'SUJEITO')) {
        p.saida = ponta_(x);
        p.saida.linha = LINHA_SAIDA[x.event_type] || 'baixas_ajuste';
      }
    });
    return p;
  }

  // ------------------------------------------------------------------ as visões ----
  /**
   * A passagem (permanência) do animal a que uma alocação pertence, numa lista de passagens (uma regra só, das três visões e do
   * custo por animal; Fase 4, E4.4): (1) a aberta ou fechada pelo evento de negócio do lançamento (`ancora`: a compra, o rebanho
   * inicial; a venda, a morte, o descarte); (2) sem ele, a última que começou até a data de referência da alocação — a data-base
   * do rateio (o dia em que o animal estava no escopo), o fim do período dele (os dias de permanência) ou a competência. null
   * quando o animal não tinha entrado (a conciliação acusa a de aquisição). `r` = o rateio (opcional).
   */
  function passagemNaLista(lista, l, r) {
    var ps = lista || [];
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].entrada.event_id === l.ancora || (ps[i].saida && ps[i].saida.event_id === l.ancora)) return ps[i];
    }
    var ref = r && !vazio_(r.data_base) ? r.data_base : r && !vazio_(r.periodo_fim) ? r.periodo_fim : l.data;
    var achada = null;
    ps.forEach(function (p) { if (p.entrada.data <= ref) achada = p; });
    return achada;
  }
  function permanenciaDe_(fx, l, animalId, r) {
    return passagemNaLista(fx.permanencias[animalId], l, r);
  }
  /**
   * O rateio do lançamento que vale em D (o último rateio com data até D) ou null; sem a lista de rateios, um rateio só com as
   * alocações de hoje. O re-rateio datado depois de D não muda a conta de D (a regra de tempo; CONTRATOS, seção 57).
   */
  function rateioEm(l, D) {
    if (!Array.isArray(l.rateios)) return { data: null, alocacoes: l.alocacoes || [] };
    var achado = null;
    l.rateios.forEach(function (r) { if (!vazio_(r.data) && r.data <= D) achado = r; });
    return achado;
  }
  /** As alocações do lançamento pelo rateio que vale em D (`rateioEm`); [] sem rateio. */
  function alocacoesEm(l, D) {
    var r = rateioEm(l, D);
    return r ? r.alocacoes : [];
  }
  /**
   * As alocações de aquisição dos lançamentos que contam em D, cada uma com a sua permanência, pelo rateio que vale em `em`
   * (padrão D; `em` ≥ D é a conta de uma data passada pedida depois: o demonstrativo do período pedido no fim dele).
   */
  function aquisicoes_(fx, D, em) {
    var quando = vazio_(em) ? D : em;
    var out = [];
    fx.lancamentos.forEach(function (l) {
      if (l.natureza !== 'AQUISICAO_ANIMAIS' || l.data > D) return;
      var r = rateioEm(l, quando);
      (r ? r.alocacoes : []).forEach(function (a) { out.push({ l: l, animal_id: a.animal_id, valor: a.valor, p: permanenciaDe_(fx, l, a.animal_id, r) }); });
    });
    return out;
  }
  function paga_(p, D) {
    return p.status === 'LIQUIDADA' && !vazio_(p.data_pagamento) && p.data_pagamento <= D;
  }
  function noPeriodo_(d, de, ate) {
    return !vazio_(d) && (de === null || d >= de) && d <= ate;
  }
  /**
   * Visão 1, o caixa realizado no período [de, ate] (de null = desde o começo): {entradas, saidas, liquido}, em centavos.
   * Todas as naturezas entram; o lançamento anterior ao marco zero não tem parcela.
   */
  function caixa(fx, de, ate) {
    var o = { entradas: 0, saidas: 0, liquido: 0 };
    fx.lancamentos.forEach(function (l) {
      l.parcelas.forEach(function (p) {
        if (p.status !== 'LIQUIDADA' || !noPeriodo_(p.data_pagamento, de, ate)) return;
        if (l.tipo === 'RECEITA') o.entradas += p.valor_pago; else o.saidas += p.valor_pago;
      });
    });
    o.liquido = o.entradas - o.saidas;
    return o;
  }
  /**
   * Visão 2, o resultado gerencial do período [de, ate] (de null = acumulado desde o começo), pedido em `em` (padrão: `ate`;
   * conta só o lançamento com competência até `em`): {receita_venda, outras_receitas, despesas_venda, custo_aquisicao:
   * {vendidos_descartados, mortes, baixas_ajuste, total}, custeio, juros, descontos, total, sem_permanencia}. `juros` é o
   * que reduz o resultado (juros pagos − juros recebidos) e `descontos` o que o aumenta (descontos obtidos − concedidos);
   * `sem_permanencia` = alocação de aquisição de animal que não estava no rebanho (a conciliação acusa).
   */
  function resultado(fx, de, ate, em) {
    var quando = vazio_(em) ? ate : em;
    var o = { receita_venda: 0, outras_receitas: 0, despesas_venda: 0, custo_aquisicao: { vendidos_descartados: 0, mortes: 0, baixas_ajuste: 0, total: 0 }, custeio: 0, juros: 0, descontos: 0, total: 0, sem_permanencia: 0 };
    var antes = de === null ? null : Utils.somaDias(de, -1);
    fx.lancamentos.forEach(function (l) {
      if (l.data > quando) return;
      var linha = RESULTADO_RECEITA[l.natureza] || RESULTADO_DESPESA[l.natureza];
      if (linha) o[linha] += competenciaAte(l, ate) - (antes === null ? 0 : competenciaAte(l, antes));
      l.parcelas.forEach(function (p) {
        if (p.status !== 'LIQUIDADA' || !noPeriodo_(p.data_pagamento, de, ate)) return;
        // Juros e desconto da baixa (07, 2.1): na despesa, juros pagos reduzem e desconto obtido aumenta; na receita, o contrário.
        if (l.tipo === 'RECEITA') { o.juros -= p.juros_multa; o.descontos -= p.desconto; } else { o.juros += p.juros_multa; o.descontos += p.desconto; }
      });
    });
    aquisicoes_(fx, ate, quando).forEach(function (a) {
      if (!a.p) { o.sem_permanencia += a.valor; return; }
      if (a.p.saida && noPeriodo_(a.p.saida.data, de, ate)) o.custo_aquisicao[a.p.saida.linha] += a.valor;
    });
    var ca = o.custo_aquisicao;
    ca.total = ca.vendidos_descartados + ca.mortes + ca.baixas_ajuste;
    o.total = o.receita_venda + o.outras_receitas - o.despesas_venda - ca.total - o.custeio - o.juros + o.descontos;
    return o;
  }
  /**
   * A posição em D (os termos de balanço da identidade): a receber e a pagar (nominal das parcelas não pagas até D, de
   * todas as naturezas), custo de aquisição do rebanho ativo (as alocações de aquisição da permanência aberta em D), insumos
   * em estoque (compras de insumo − consumos), despesa antecipada líquida de receita antecipada (a competência depois de D
   * dos lançamentos que já contam em D), saldo de abertura e não operacional líquido (receita − despesa).
   */
  function posicao(fx, D, em) {
    var o = { a_receber: 0, a_pagar: 0, custo_rebanho_ativo: 0, insumos_estoque: 0, despesa_antecipada: 0, saldo_abertura: 0, nao_operacional: 0 };
    fx.lancamentos.forEach(function (l) {
      if (l.data > D) return;
      l.parcelas.forEach(function (p) {
        if (paga_(p, D)) return;
        if (l.tipo === 'RECEITA') o.a_receber += p.valor; else o.a_pagar += p.valor;
      });
      if (l.natureza === 'ESTOQUE_INSUMOS') o.insumos_estoque += l.valor;
      if (l.consumo) o.insumos_estoque -= l.valor;
      if (RESULTADO_DESPESA[l.natureza]) o.despesa_antecipada += l.valor - competenciaAte(l, D);
      if (RESULTADO_RECEITA[l.natureza]) o.despesa_antecipada -= l.valor - competenciaAte(l, D);
      if (l.abertura) o.saldo_abertura += l.valor;
      if (l.natureza === 'NAO_OPERACIONAL') o.nao_operacional += l.tipo === 'RECEITA' ? l.valor : -l.valor;
    });
    aquisicoes_(fx, D, em).forEach(function (a) {
      if (a.p && a.p.entrada.data <= D && !(a.p.saida && a.p.saida.data <= D)) o.custo_rebanho_ativo += a.valor;
    });
    return o;
  }
  /**
   * A identidade das três visões (07, 2.1), aritmética pura sobre os termos: {esquerda (resultado acumulado), direita,
   * diferenca, fecha}. Termos (centavos): resultado_acumulado, caixa_acumulado, a_receber, a_pagar, custo_rebanho_ativo,
   * insumos_estoque, despesa_antecipada, saldo_abertura, nao_operacional. Termo que não é inteiro → INTERNAL.
   */
  function identidade(t) {
    TERMOS.forEach(function (n) { if (!inteiro_(t[n])) throw Validation.erro('INTERNAL', 'identidade: o termo ' + n + ' precisa ser um inteiro de centavos.'); });
    var direita = t.caixa_acumulado + t.a_receber - t.a_pagar + t.custo_rebanho_ativo + t.insumos_estoque + t.despesa_antecipada - t.saldo_abertura - t.nao_operacional;
    return { esquerda: t.resultado_acumulado, direita: direita, diferenca: t.resultado_acumulado - direita, fecha: t.resultado_acumulado === direita };
  }
  /**
   * Os termos da identidade em D: o resultado e o caixa acumulados até D, a posição em D e a conta da identidade
   * ({data, …TERMOS, sem_permanencia, direita, diferenca, fecha}). `em` (padrão D): o dia em que se pede a conta de D — só muda
   * qual rateio da aquisição vale (o de `em`); a identidade fecha em qualquer `em` ≥ D, porque o custo de quem saiu e o do
   * rebanho ativo repartem as mesmas alocações.
   */
  function termosEm(fx, D, em) {
    var r = resultado(fx, null, D, em);
    var c = caixa(fx, null, D);
    var p = posicao(fx, D, em);
    var t = {
      data: D, resultado_acumulado: r.total, caixa_acumulado: c.liquido, a_receber: p.a_receber, a_pagar: p.a_pagar,
      custo_rebanho_ativo: p.custo_rebanho_ativo, insumos_estoque: p.insumos_estoque, despesa_antecipada: p.despesa_antecipada,
      saldo_abertura: p.saldo_abertura, nao_operacional: p.nao_operacional, sem_permanencia: r.sem_permanencia,
    };
    var i = identidade(t);
    t.direita = i.direita;
    t.diferenca = i.diferenca;
    t.fecha = i.fecha;
    return t;
  }
  /** O primeiro dia com fato financeiro até `ate` (competência, início de período ou pagamento), ou null. */
  function primeiroDia_(fx, ate) {
    var d = null;
    fx.lancamentos.forEach(function (l) {
      [l.data, l.inicio].concat(l.parcelas.map(function (p) { return p.data_pagamento; })).forEach(function (x) { if (!vazio_(x) && x <= ate && (d === null || x < d)) d = x; });
    });
    return d;
  }
  /**
   * A conciliação até `ate` (07, 2.1; CT-19): a identidade no fim de cada mês, do mês do primeiro fato ao de `ate`, e em
   * `ate` (o período inteiro), cada uma pedida no seu dia; e o resultado e o caixa de cada mês, pedidos em `ate`, somando o
   * do período ao centavo. {ate, inicio, meses: [{mes, fim, resultado (pedido no fim do mês), caixa, termos}], periodo:
   * {resultado, caixa, termos}, fecha, problemas: [texto]}. Sem fato financeiro: nenhum mês, e fecha.
   */
  function conferir(fx, ate) {
    exigirData_(ate, 'ate');
    var inicio = primeiroDia_(fx, ate);
    var problemas = [];
    var lista = [];
    var somaR = 0;
    var somaC = 0;
    meses(inicio, ate).forEach(function (m) {
      var de = m + '-01';
      var fim = fimDoMes_(m) < ate ? fimDoMes_(m) : ate;
      var t = termosEm(fx, fim);
      var cm = caixa(fx, de, fim);
      if (!t.fecha) problemas.push('Em ' + fim + ' a identidade não fecha: resultado acumulado de ' + t.resultado_acumulado + ' centavos e ' + t.direita + ' pelo caixa e pela posição (diferença de ' + t.diferenca + ').');
      if (t.sem_permanencia) problemas.push('Em ' + fim + ', ' + t.sem_permanencia + ' centavos de custo de aquisição estão alocados a animal que não estava no rebanho.');
      somaR += resultado(fx, de, fim, ate).total;
      somaC += cm.liquido;
      lista.push({ mes: m, fim: fim, resultado: resultado(fx, de, fim), caixa: cm, termos: t });
    });
    var periodo = { resultado: resultado(fx, null, ate), caixa: caixa(fx, null, ate), termos: termosEm(fx, ate) };
    if (!periodo.termos.fecha) problemas.push('No período inteiro (até ' + ate + ') a identidade não fecha: diferença de ' + periodo.termos.diferenca + ' centavos.');
    if (lista.length && somaR !== periodo.resultado.total) problemas.push('O resultado dos meses soma ' + somaR + ' centavos e o do período, ' + periodo.resultado.total + '.');
    if (lista.length && somaC !== periodo.caixa.liquido) problemas.push('O caixa dos meses soma ' + somaC + ' centavos e o do período, ' + periodo.caixa.liquido + '.');
    return { ate: ate, inicio: inicio, meses: lista, periodo: periodo, fecha: problemas.length === 0, problemas: problemas };
  }

  // ------------------------------------------------------------------ resultado gerencial (Fase 4, E4.5) ----
  var MESES_ROTULO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  /** Os grupos do custeio na ordem do plano de contas (03a, 4.13: os blocos B, C e D da §11). */
  var GRUPOS_CUSTEIO = ['CUSTO_DIRETO', 'CUSTO_OPERACIONAL', 'DESPESA_ADMINISTRATIVA'];
  var ROTULO_GRUPO = { CUSTO_DIRETO: 'Custos diretos', CUSTO_OPERACIONAL: 'Custos operacionais', DESPESA_ADMINISTRATIVA: 'Despesas administrativas' };
  /** As linhas do custo de aquisição de quem saiu (07, 2.1, CA), na ordem. */
  var LINHAS_CA = [['vendidos_descartados', 'Vendidos e descartados'], ['mortes', 'Mortes'], ['baixas_ajuste', 'Baixas por ajuste de inventário']];
  /** O limite de colunas do demonstrativo (dez anos de meses). */
  var MAX_COLUNAS = 120;
  /** Os termos da ponte de um período (a identidade aplicada às variações; 07, 2.1), na ordem da fórmula. */
  var PONTE = ['resultado', 'caixa', 'a_receber', 'a_pagar', 'custo_rebanho_ativo', 'insumos_estoque', 'despesa_antecipada', 'saldo_abertura', 'nao_operacional'];

  /** As colunas do período [de, ate]: os meses, cortados nas pontas. [{chave (yyyy-MM), inicio, fim, rotulo}]. */
  function colunas(de, ate) {
    return meses(de, ate).map(function (m) {
      var ini = m + '-01' < de ? de : m + '-01';
      var fim = fimDoMes_(m) > ate ? ate : fimDoMes_(m);
      return { chave: m, inicio: ini, fim: fim, rotulo: MESES_ROTULO[Number(m.slice(5, 7)) - 1] + '/' + m.slice(0, 4) };
    });
  }
  /** A parte da competência de `l` em [ini, fim] (centavos): a conta da 1.1 até o fim menos a conta até a véspera do início. */
  function competenciaEntre(l, ini, fim) {
    return competenciaAte(l, fim) - competenciaAte(l, Utils.somaDias(ini, -1));
  }
  /**
   * A ponte de um período (a conciliação linha a linha; 07, 2.1): os termos da identidade no fim (`t1`) menos os da véspera do
   * início (`t0`), cada um pedido no mesmo dia. Resultado do período = caixa do período + Δ a receber − Δ a pagar + Δ custo de
   * aquisição do rebanho ativo (a variação do estoque de rebanho) + Δ insumos em estoque (a do estoque de insumos) + Δ despesa
   * antecipada − Δ saldo de abertura − Δ não operacional. Aritmética pura, pela mesma `identidade`: {resultado, caixa,
   * a_receber, a_pagar, custo_rebanho_ativo, insumos_estoque, despesa_antecipada, saldo_abertura, nao_operacional (as
   * variações), direita, diferenca, fecha}. Termo que não é inteiro → INTERNAL.
   */
  function ponte(t0, t1) {
    var v = {};
    TERMOS.forEach(function (n) { v[n] = (t1 || {})[n] - (t0 || {})[n]; });
    var i = identidade(v);
    return {
      resultado: v.resultado_acumulado, caixa: v.caixa_acumulado, a_receber: v.a_receber, a_pagar: v.a_pagar, custo_rebanho_ativo: v.custo_rebanho_ativo,
      insumos_estoque: v.insumos_estoque, despesa_antecipada: v.despesa_antecipada, saldo_abertura: v.saldo_abertura, nao_operacional: v.nao_operacional,
      direita: i.direita, diferenca: i.diferenca, fecha: i.fecha,
    };
  }
  /**
   * O custeio do período [de, ate] não alocado a nenhum animal, pedido em `ate` (07, 2.1, "Visão 3": a tela mostra ao lado
   * "custeio não alocado do período"): de cada lançamento de custeio, o que não foi alocado pelo rateio que vale em `ate`, na
   * mesma competência do lançamento (a 1.1: a parte do período, sem criar nem perder centavo).
   */
  function custeioNaoAlocado(fx, de, ate) {
    var s = 0;
    fx.lancamentos.forEach(function (l) {
      if (l.natureza !== 'CUSTEIO' || l.data > ate) return;
      var na = l.valor - alocacoesEm(l, ate).reduce(function (t, a) { return t + a.valor; }, 0);
      if (na > 0) s += competenciaEntre({ valor: na, data: l.data, inicio: l.inicio, fim: l.fim }, de, ate);
    });
    return s;
  }
  /** Uma linha do demonstrativo, com um valor por coluna (centavos, positivos: o sinal é o da seção). */
  function linhaDre_(chave, rotulo, n, extra) {
    var x = { chave: chave, rotulo: rotulo, valores: [], total: 0 };
    for (var k = 0; k < n; k++) x.valores.push(0);
    Object.keys(extra || {}).forEach(function (c) { x[c] = extra[c]; });
    return x;
  }
  function somarNa_(linha, k, v) {
    linha.valores[k] += v;
    linha.total += v;
  }
  /** As linhas por conta de uma seção, na ordem do plano de contas (a ordem, o código), sem as zeradas no período. */
  function contasDaSecao_(mapa) {
    return Object.keys(mapa).map(function (k) { return mapa[k]; }).filter(function (x) { return x.valores.some(function (v) { return v !== 0; }); })
      .sort(function (a, b) { return (a.ordem - b.ordem) || (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0); });
  }
  /**
   * O resultado gerencial do período [de, ate] mês a mês, pedido em `ate` (07, seção 2.1; 08, seção 3, "Financeiro: fluxo e
   * resultado"): as receitas e as despesas por natureza e por conta (RV, OR, DV; o custeio por grupo e por conta, pela competência
   * por período da 1.1), o custo de aquisição de quem saiu (vendidos e descartados, mortes, baixas por ajuste), os juros e os
   * descontos das baixas e o resultado de cada mês e do período; ao lado, o caixa líquido, o custeio não alocado aos animais, o
   * que ficou fora do resultado (a compra de animais e de insumos, o não operacional), os estoques no custo (rebanho e insumos:
   * o do início, o que entrou, o que saiu e o do fim) e a ponte de cada mês e do período (a conciliação linha a linha), e a
   * identidade acumulada em `ate`. `detalhe`: os lançamentos de cada conta e os animais de cada linha do custo de aquisição.
   * Compra de animais e de insumos e o não operacional não entram no resultado (07, 2.1; RN-083).
   */
  function demonstrativo(fx, de, ate, opcoes) {
    var o = opcoes || {};
    exigirData_(de, 'de');
    exigirData_(ate, 'ate');
    var cols = colunas(de, ate);
    var n = cols.length;
    var contas = fx.contas || {};
    var porConta = { RV: {}, OR: {}, DV: {}, CT: {} };
    var secao = { RV: linhaDre_('RV', 'Receita de venda de animais', n, { sinal: 1 }), OR: linhaDre_('OR', 'Outras receitas', n, { sinal: 1 }), DV: linhaDre_('DV', 'Despesas de venda', n, { sinal: -1 }), CT: linhaDre_('CT', 'Custeio', n, { sinal: -1 }) };
    var grupos = {};
    GRUPOS_CUSTEIO.forEach(function (g) { grupos[g] = linhaDre_(g, ROTULO_GRUPO[g], n, { grupo: g, contas: {} }); });
    var ca = linhaDre_('CA', 'Custo de aquisição dos animais que saíram', n, { sinal: -1 });
    var caLinhas = {};
    LINHAS_CA.forEach(function (x) { caLinhas[x[0]] = linhaDre_(x[0], x[1], n, o.detalhe ? { animais: [] } : {}); });
    var juros = linhaDre_('J', 'Juros e multas das baixas', n, { sinal: -1 });
    var descontos = linhaDre_('DB', 'Descontos das baixas', n, { sinal: 1 });
    var naoAlocado = linhaDre_('NAO_ALOCADO', 'Custeio não alocado aos animais', n);
    var fora = { aquisicao: linhaDre_('AQUISICAO', 'Compra de animais e saldo de abertura (vira custo quando o animal sai)', n), insumos: linhaDre_('INSUMOS', 'Compra de insumos (vira custo quando é aplicado)', n), nao_operacional: linhaDre_('NAO_OPERACIONAL', 'Não operacional líquido (aportes, retiradas, empréstimos)', n) };
    var secaoDaNatureza = { RECEITA_VENDA_ANIMAIS: 'RV', OUTRA_RECEITA: 'OR', DESPESA_VENDA: 'DV', CUSTEIO: 'CT' };
    function linhaConta(sec, l) {
      var c = contas[l.conta_id] || {};
      var k = l.conta_id || '-';
      var mapa = sec === 'CT' ? (grupos[GRUPOS_CUSTEIO.indexOf(l.grupo) >= 0 ? l.grupo : 'DESPESA_ADMINISTRATIVA'].contas) : porConta[sec];
      if (!mapa[k]) mapa[k] = linhaDre_('CONTA:' + k, c.nome || 'Conta sem cadastro', n, { conta_id: l.conta_id || null, codigo: c.codigo || '', nome: c.nome || null, ordem: typeof c.ordem === 'number' ? c.ordem : 0, lancamentos: o.detalhe ? [] : undefined });
      return mapa[k];
    }
    fx.lancamentos.forEach(function (l) {
      if (l.data > ate) return;
      var sec = secaoDaNatureza[l.natureza];
      var naoAloc = null;
      if (l.natureza === 'CUSTEIO') {
        var aloc = alocacoesEm(l, ate).reduce(function (s, a) { return s + a.valor; }, 0);
        naoAloc = { valor: l.valor - aloc, data: l.data, inicio: l.inicio, fim: l.fim };
      }
      cols.forEach(function (c, k) {
        var v = competenciaEntre(l, c.inicio, c.fim);
        if (sec && v) {
          somarNa_(secao[sec], k, v);
          var lc = linhaConta(sec, l);
          somarNa_(lc, k, v);
          if (sec === 'CT') somarNa_(grupos[GRUPOS_CUSTEIO.indexOf(l.grupo) >= 0 ? l.grupo : 'DESPESA_ADMINISTRATIVA'], k, v);
        }
        if (naoAloc && naoAloc.valor > 0) somarNa_(naoAlocado, k, competenciaEntre(naoAloc, c.inicio, c.fim));
        if (l.natureza === 'AQUISICAO_ANIMAIS') somarNa_(fora.aquisicao, k, v);
        if (l.natureza === 'ESTOQUE_INSUMOS') somarNa_(fora.insumos, k, v);
        if (l.natureza === 'NAO_OPERACIONAL') somarNa_(fora.nao_operacional, k, l.tipo === 'RECEITA' ? v : -v);
        l.parcelas.forEach(function (p) {
          if (p.status !== 'LIQUIDADA' || !noPeriodo_(p.data_pagamento, c.inicio, c.fim)) return;
          var sinal = l.tipo === 'RECEITA' ? -1 : 1;
          if (p.juros_multa) somarNa_(juros, k, sinal * p.juros_multa);
          if (p.desconto) somarNa_(descontos, k, sinal * p.desconto);
        });
      });
      if (o.detalhe && sec) {
        var parte = competenciaEntre(l, de, ate);
        if (parte) linhaConta(sec, l).lancamentos.push({ financial_id: l.financial_id, event_id: l.event_id, event_type: l.event_type, descricao: l.descricao, data_competencia: l.data, competencia_inicio: l.inicio, competencia_fim: l.fim, valor_lancamento: l.valor, valor: parte });
      }
    });
    aquisicoes_(fx, ate, ate).forEach(function (a) {
      if (!a.p || !a.p.saida) return;
      cols.forEach(function (c, k) {
        if (!noPeriodo_(a.p.saida.data, c.inicio, c.fim)) return;
        somarNa_(ca, k, a.valor);
        somarNa_(caLinhas[a.p.saida.linha], k, a.valor);
      });
      if (o.detalhe && noPeriodo_(a.p.saida.data, de, ate)) caLinhas[a.p.saida.linha].animais.push({ animal_id: a.animal_id, financial_id: a.l.financial_id, data_saida: a.p.saida.data, tipo_saida: a.p.saida.tipo, valor: a.valor });
    });
    // O resultado de cada coluna (07, 2.1): RV + OR − DV − CA − CT − J + DB.
    var res = linhaDre_('RESULTADO', 'Resultado', n);
    for (var k = 0; k < n; k++) somarNa_(res, k, secao.RV.valores[k] + secao.OR.valores[k] - secao.DV.valores[k] - ca.valores[k] - secao.CT.valores[k] - juros.valores[k] + descontos.valores[k]);
    // Ao lado: o caixa líquido, os estoques no custo e a ponte de cada coluna e do período (os termos pedidos em `ate`).
    var t0 = termosEm(fx, Utils.somaDias(de, -1), ate);
    var anterior = t0;
    var caixaCols = [];
    var estoques = [];
    var pontes = [];
    cols.forEach(function (c, k) {
      var t1 = termosEm(fx, c.fim, ate);
      caixaCols.push(caixa(fx, c.inicio, c.fim));
      var insEntrada = fora.insumos.valores[k];
      estoques.push({
        rebanho: { inicio: anterior.custo_rebanho_ativo, entradas: t1.custo_rebanho_ativo - anterior.custo_rebanho_ativo + ca.valores[k], saidas: ca.valores[k], fim: t1.custo_rebanho_ativo },
        insumos: { inicio: anterior.insumos_estoque, entradas: insEntrada, saidas: anterior.insumos_estoque + insEntrada - t1.insumos_estoque, fim: t1.insumos_estoque },
      });
      pontes.push(ponte(anterior, t1));
      anterior = t1;
    });
    var tFim = anterior;
    var pontePeriodo = ponte(t0, tFim);
    var caixaPeriodo = caixa(fx, de, ate);
    var problemas = [];
    pontes.forEach(function (p, k) {
      if (!p.fecha) problemas.push('Em ' + cols[k].rotulo + ' a ponte não fecha: diferença de ' + p.diferenca + ' centavos.');
      if (p.resultado !== res.valores[k]) problemas.push('Em ' + cols[k].rotulo + ' o resultado das linhas (' + res.valores[k] + ') difere do da identidade (' + p.resultado + ').');
    });
    if (!pontePeriodo.fecha) problemas.push('No período a ponte não fecha: diferença de ' + pontePeriodo.diferenca + ' centavos.');
    if (!tFim.fecha) problemas.push('Em ' + ate + ' a identidade acumulada não fecha: diferença de ' + tFim.diferenca + ' centavos.');
    var secoes = [
      Object.assign(secao.RV, { contas: contasDaSecao_(porConta.RV) }),
      Object.assign(secao.OR, { contas: contasDaSecao_(porConta.OR) }),
      Object.assign(secao.DV, { contas: contasDaSecao_(porConta.DV) }),
      Object.assign(ca, { linhas: LINHAS_CA.map(function (x) { return caLinhas[x[0]]; }) }),
      Object.assign(secao.CT, { grupos: GRUPOS_CUSTEIO.map(function (g) { var x = grupos[g]; x.contas = contasDaSecao_(x.contas); return x; }).filter(function (x) { return x.total !== 0 || x.valores.some(function (v) { return v !== 0; }); }) }),
      juros, descontos,
    ];
    return {
      de: de, ate: ate, colunas: cols, secoes: secoes, resultado: res,
      caixa: { colunas: caixaCols, periodo: caixaPeriodo },
      custeio_nao_alocado: naoAlocado,
      fora_do_resultado: [fora.aquisicao, fora.insumos, fora.nao_operacional],
      estoques: { colunas: estoques, periodo: {
        rebanho: { inicio: t0.custo_rebanho_ativo, entradas: tFim.custo_rebanho_ativo - t0.custo_rebanho_ativo + ca.total, saidas: ca.total, fim: tFim.custo_rebanho_ativo },
        insumos: { inicio: t0.insumos_estoque, entradas: fora.insumos.total, saidas: t0.insumos_estoque + fora.insumos.total - tFim.insumos_estoque, fim: tFim.insumos_estoque },
      } },
      ponte: { colunas: pontes, periodo: pontePeriodo },
      identidade: tFim,
      fecha: problemas.length === 0, problemas: problemas,
    };
  }
  /** O período do pedido do resultado: {de, ate} pelo ano, pelo mês ou pelas datas (padrão: o ano de hoje até hoje). */
  function periodoDoResultado_(o, hoje) {
    var erro = function (mensagem, campo, codigo) { return Validation.erro('VALIDATION', mensagem, [{ codigo: codigo || 'FORMATO_INVALIDO', campo: campo, mensagem: mensagem }]); };
    var de;
    var ate;
    if (!vazio_(o.mes)) {
      if (typeof o.mes !== 'string' || !/^\d{4}-\d{2}$/.test(o.mes) || !Utils.dataValida(o.mes + '-01')) throw erro('Informe o mês como ano e mês (aaaa-mm).', 'mes');
      de = o.mes + '-01';
      ate = fimDoMes_(o.mes);
    } else if (!vazio_(o.ano)) {
      var ano = String(o.ano);
      if (!/^\d{4}$/.test(ano)) throw erro('Informe o ano com quatro algarismos.', 'ano');
      de = ano + '-01-01';
      ate = ano + '-12-31';
    } else {
      de = vazio_(o.de) ? (vazio_(hoje) ? null : hoje.slice(0, 4) + '-01-01') : o.de;
      ate = vazio_(o.ate) ? hoje : o.ate;
      exigirData_(de, 'de');
      exigirData_(ate, 'ate');
      if (!vazio_(hoje) && ate > hoje) throw erro('O resultado vai até hoje: escolha hoje ou uma data passada.', 'ate', 'DATA_FUTURA');
    }
    if (!vazio_(hoje) && de > hoje) throw erro('Esse período ainda não começou: o resultado é de um período até hoje.', vazio_(o.mes) ? (vazio_(o.ano) ? 'de' : 'ano') : 'mes', 'DATA_FUTURA');
    // O mês e o ano em curso vão até hoje (o resto ainda não aconteceu).
    if (!vazio_(hoje) && ate > hoje) ate = hoje;
    if (de > ate) throw erro('O início (' + Timeline.dataBr(de) + ') é depois do fim (' + Timeline.dataBr(ate) + ').', 'de', 'PERIODO_INVERTIDO');
    if (colunas(de, ate).length > MAX_COLUNAS) throw erro('Período longo demais: até ' + MAX_COLUNAS + ' meses.', 'de', 'VALOR_FORA_DA_FAIXA');
    return { de: de, ate: ate };
  }
  /** Os animais citados no detalhe do custo de aquisição: o código interno e o brinco do dia da saída (Timeline.brincoEm). */
  function nomearAnimais_(tx, dre) {
    var f = Timeline.fonte(tx);
    dre.secoes.forEach(function (s) {
      (s.linhas || []).forEach(function (x) {
        (x.animais || []).forEach(function (a) {
          var an = tx.repo.porId('ANIMAIS', a.animal_id) || {};
          a.codigo_interno = an.codigo_interno || null;
          a.brinco = Timeline.brincoEm(f, a.animal_id, a.data_saida);
        });
      });
    });
  }
  /**
   * Consulta `financeiro.resultado` (rota canônica; 08, seção 3): o demonstrativo do período, pedido em `ate`. dados: {ano?
   * (aaaa), mes? (aaaa-mm), de?, ate? (padrão: de 1º de janeiro até hoje), detalhe? (os lançamentos de cada conta e os animais
   * do custo de aquisição)}. O mês e o ano em curso vão até hoje. Data inválida → FORMATO_INVALIDO; depois de hoje → DATA_FUTURA;
   * invertido → PERIODO_INVERTIDO; mais de 120 meses → VALOR_FORA_DA_FAIXA. Fim antes do marco zero → as colunas vazias e o
   * motivo ANTERIOR_AO_MARCO_ZERO (P9); começo antes dele → `antes_do_marco_zero` (a conta começa no marco zero: o histórico
   * anterior fica fora das três visões).
   */
  function consultaResultado(dados) {
    var o = dados || {};
    return {
      rota: 'financeiro.resultado', dados: o, reads: leituras(), acessoCru: true,
      tratador: function (tx) {
        var p = periodoDoResultado_(o, tx.hoje);
        var fx = fatos(tx);
        var mz = fx.marco_zero;
        if (!vazio_(mz) && p.ate < mz) {
          return { de: p.de, ate: p.ate, marco_zero: mz, motivo: 'ANTERIOR_AO_MARCO_ZERO', mensagem: 'O período termina antes do marco zero (' + Timeline.dataBr(mz) + '): o que veio antes não entra nas contas do sistema.', colunas: [], secoes: [], resultado: null };
        }
        var dre = demonstrativo(fx, p.de, p.ate, { detalhe: o.detalhe === true });
        if (o.detalhe === true) nomearAnimais_(tx, dre);
        dre.marco_zero = mz;
        dre.motivo = null;
        dre.antes_do_marco_zero = !vazio_(mz) && p.de < mz;
        return dre;
      },
    };
  }
  function resultadoGerencial(ctx, dados) {
    return UnitOfWork.read(ctx, consultaResultado(dados));
  }

  /**
   * Consulta `financeiro.conciliacao` (sem tela no MVP: o teste CT-19, o teste aleatório e a conferência do dono; 07, 2.1): a
   * conciliação até `ate` (padrão: hoje no fuso da fazenda), sobre as linhas vigentes. `ate` depois de hoje → VALIDATION
   * DATA_FUTURA; `ate` que não é data → VALIDATION FORMATO_INVALIDO.
   */
  function consulta(dados) {
    var o = dados || {};
    return {
      rota: 'financeiro.conciliacao', dados: o, reads: leituras(), acessoCru: true,
      tratador: function (tx) {
        var ate = vazio_(o.ate) ? tx.hoje : o.ate;
        exigirData_(ate, 'ate');
        if (!vazio_(tx.hoje) && ate > tx.hoje) throw Validation.erro('VALIDATION', 'A conciliação vai até hoje: escolha hoje ou uma data passada.', [{ codigo: 'DATA_FUTURA', campo: 'ate', mensagem: 'A data ainda não chegou.' }]);
        return conferir(fatos(tx), ate);
      },
    };
  }
  function consultar(ctx, dados) {
    return UnitOfWork.read(ctx, consulta(dados));
  }

  return {
    LINHA_SAIDA: LINHA_SAIDA,
    TERMOS: TERMOS,
    PONTE: PONTE,
    meses: meses,
    colunas: colunas,
    porMes: porMes,
    competenciaAte: competenciaAte,
    competenciaEntre: competenciaEntre,
    leituras: leituras,
    fatos: fatos,
    passagemNaLista: passagemNaLista,
    rateioEm: rateioEm,
    alocacoesEm: alocacoesEm,
    caixa: caixa,
    resultado: resultado,
    posicao: posicao,
    identidade: identidade,
    termosEm: termosEm,
    conferir: conferir,
    ponte: ponte,
    custeioNaoAlocado: custeioNaoAlocado,
    demonstrativo: demonstrativo,
    consulta: consulta,
    consultar: consultar,
    consultaResultado: consultaResultado,
    resultadoGerencial: resultadoGerencial,
  };
})();
