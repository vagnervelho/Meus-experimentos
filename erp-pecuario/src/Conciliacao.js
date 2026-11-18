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
  function fatos(tx) {
    var repo = tx.repo;
    var f = Timeline.fonte(tx);
    var temContas = repo.carregada('PLANO_CONTAS');
    var lancamentos = [];
    var comAquisicao = {};
    repo.vigentes('FINANCEIRO').forEach(function (fin) {
      var ev = repo.porId('EVENTOS', fin.event_id);
      if (!ev || ev.pre_marco_zero === true) return;
      var conta = temContas ? repo.porId('PLANO_CONTAS', fin.conta_id) : null;
      var l = {
        financial_id: fin.financial_id, event_id: fin.event_id, ancora: vazio_(fin.ref_event_id) ? fin.event_id : fin.ref_event_id,
        natureza: fin.natureza, tipo: fin.tipo, valor: fin.valor || 0, data: fin.data_competencia,
        inicio: vazio_(fin.competencia_inicio) ? null : fin.competencia_inicio, fim: vazio_(fin.competencia_fim) ? null : fin.competencia_fim,
        consumo: fin.natureza === 'CUSTEIO' && !vazio_(fin.product_id),
        abertura: !!conta && conta.codigo === CONTA_ABERTURA,
        parcelas: repo.por('PARCELAS', 'financial_id', fin.financial_id).map(function (p) {
          return { valor: p.valor || 0, status: p.status, data_pagamento: vazio_(p.data_pagamento) ? null : p.data_pagamento, valor_pago: p.valor_pago || 0, juros_multa: p.juros_multa || 0, desconto: p.desconto || 0 };
        }),
        alocacoes: repo.por('ALOCACOES_FINANCEIRAS', 'financial_id', fin.financial_id).map(function (a) { return { animal_id: a.animal_id, valor: a.valor_alocado || 0 }; }),
      };
      if (l.natureza === 'AQUISICAO_ANIMAIS') l.alocacoes.forEach(function (a) { comAquisicao[a.animal_id] = true; });
      lancamentos.push(l);
    });
    var permanencias = {};
    Object.keys(comAquisicao).sort().forEach(function (id) {
      var lista = [];
      var atual = null;
      Timeline.ordenar(f.linhas(id).filter(function (x) { return !x.pre_marco_zero; })).forEach(function (x) {
        if (x.efeito === 1) {
          atual = { entrada: { event_id: x.event_id, data: x.event_date }, saida: null };
          lista.push(atual);
        } else if (x.efeito === -1 && atual) {
          atual.saida = { event_id: x.event_id, data: x.event_date, linha: LINHA_SAIDA[x.event_type] || 'baixas_ajuste' };
          atual = null;
        }
      });
      permanencias[id] = lista;
    });
    return { marco_zero: f.marcoZero || null, lancamentos: lancamentos, permanencias: permanencias };
  }

  // ------------------------------------------------------------------ as visões ----
  /**
   * A permanência a que a alocação de aquisição pertence: a aberta pelo evento de negócio do lançamento (a compra, o rebanho
   * inicial); sem ele, a última que começou até a competência. null quando o animal não tinha entrado (a conciliação acusa).
   */
  function permanenciaDe_(fx, l, animalId) {
    var lista = fx.permanencias[animalId] || [];
    var porAncora = lista.filter(function (p) { return p.entrada.event_id === l.ancora; })[0];
    if (porAncora) return porAncora;
    var achada = null;
    lista.forEach(function (p) { if (p.entrada.data <= l.data) achada = p; });
    return achada;
  }
  /** As alocações de aquisição dos lançamentos que contam em D, cada uma com a sua permanência. */
  function aquisicoes_(fx, D) {
    var out = [];
    fx.lancamentos.forEach(function (l) {
      if (l.natureza !== 'AQUISICAO_ANIMAIS' || l.data > D) return;
      l.alocacoes.forEach(function (a) { out.push({ l: l, animal_id: a.animal_id, valor: a.valor, p: permanenciaDe_(fx, l, a.animal_id) }); });
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
    aquisicoes_(fx, quando).forEach(function (a) {
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
  function posicao(fx, D) {
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
    aquisicoes_(fx, D).forEach(function (a) {
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
   * ({data, …TERMOS, sem_permanencia, direita, diferenca, fecha}).
   */
  function termosEm(fx, D) {
    var r = resultado(fx, null, D);
    var c = caixa(fx, null, D);
    var p = posicao(fx, D);
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
    meses: meses,
    porMes: porMes,
    competenciaAte: competenciaAte,
    leituras: leituras,
    fatos: fatos,
    caixa: caixa,
    resultado: resultado,
    posicao: posicao,
    identidade: identidade,
    termosEm: termosEm,
    conferir: conferir,
    consulta: consulta,
    consultar: consultar,
  };
})();
