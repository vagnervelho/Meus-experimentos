/**
 * FinancialService — o núcleo financeiro que todo evento com dinheiro usa (07, seções 1 e 3; 03b, seções 10 a 14).
 * Puro: monta as linhas de FINANCEIRO (lançamento), PARCELAS (título), RATEIOS e ALOCACOES_FINANCEIRAS (a única fonte
 * de valor por animal) dentro do tratador de um comando, sem gravar nada; a UnitOfWork grava. Também traz a conta da
 * negociação de compra e venda (modalidade × base de peso, conferência, critério de rateio; 07, seção 4; 03b, 4.3 a
 * 4.5), a conferência das invariantes de 03b, seção 14 (reutilizada pela integridade), os totais "a pagar" e "a
 * receber" e o bloco financeiro da ficha do animal.
 *
 * Dinheiro sempre em centavos inteiros; bases de rateio na unidade do critério (R$, kg, cabeça, peso relativo).
 */
var FinancialService = (function () {
  /** Contas do plano que o motor lança sozinho (03a, seção 4.13: `sistema` = S), pelo código. */
  var CONTAS = Object.freeze({
    COMPRA: 'COMPRA_ANIMAIS', FRETE_COMPRA: 'FRETE_DESPESAS_COMPRA', ABERTURA: 'SALDO_ABERTURA_REBANHO',
    RECEITA_DESCARTE: 'OUTRAS_RECEITAS_OPERACIONAIS', VENDA: 'VENDA_ANIMAIS',
  });
  var MODALIDADES = ['CABECA', 'KG_VIVO', 'ARROBA', 'LOTE'];
  /** Critérios que o operador escolhe numa compra ou venda por lote (03b, seção 4.3); DIAS_PERMANENCIA não cabe num evento. */
  var CRITERIOS_LOTE = ['CABECAS', 'PESO_VIVO', 'PESO_CARCACA', 'VALOR_INDIVIDUAL', 'MANUAL'];
  /** Naturezas que nunca são rateadas (invariante 14: o insumo vira custo no consumo; não operacional não é do animal). */
  var SEM_RATEIO = ['ESTOQUE_INSUMOS', 'NAO_OPERACIONAL'];
  /** Eventos cujos lançamentos são 100% alocados aos animais (invariante 10; a abertura também: RN-070). */
  var CEM_POR_CENTO = { COMPRA: true, VENDA: true, ENTRADA_INICIAL: true };
  var MAX_PARCELAS = 120;
  var NOME_NATUREZA = {
    RECEITA_VENDA_ANIMAIS: 'venda de animais', OUTRA_RECEITA: 'outras receitas', AQUISICAO_ANIMAIS: 'aquisição de animais', CUSTEIO: 'custeio',
    DESPESA_VENDA: 'despesa de venda', ESTOQUE_INSUMOS: 'compra de insumos', NAO_OPERACIONAL: 'não operacional',
  };
  var SAIDAS = ['VENDIDO', 'MORTO', 'DESCARTADO', 'BAIXADO_AJUSTE'];

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function nulo_(v) {
    return vazio_(v) ? null : v;
  }
  function reais_(c) {
    return Utils.formatarReais(c || 0);
  }
  function br_(d) {
    return vazio_(d) ? '' : String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4);
  }
  function inteiroPositivo_(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v > 0;
  }
  function det_(codigo, campo, mensagem, extra) {
    var d = { codigo: codigo, campo: campo || null, mensagem: mensagem };
    Object.keys(extra || {}).forEach(function (k) { d[k] = extra[k]; });
    return d;
  }
  function soma_(lista, campo) {
    return lista.reduce(function (s, x) { return s + (typeof x[campo] === 'number' ? x[campo] : 0); }, 0);
  }

  /** Abas que a conferência das invariantes lê (a função cita Timeline só quando chamada: carga sem ordem). */
  function leituras() {
    return Utils.unicos(Timeline.LEITURAS.concat(['COMPRAS', 'VENDAS', 'PLANO_CONTAS', 'PARCEIROS']));
  }

  // ------------------------------------------------------------------ contas e parcelas ----
  /** Conta do plano pelo código; ausente ou inativa → CONFIG (o setup semeia as contas do sistema). */
  function conta(repo, codigo) {
    var c = repo.unico('PLANO_CONTAS', 'codigo', codigo);
    if (!c || c.ativo === false) throw Validation.erro('CONFIG', 'A conta "' + codigo + '" não está ativa no plano de contas. Execute a configuração inicial.');
    return c;
  }
  /**
   * N parcelas iguais de `total` centavos (03b, seção 11): o quociente inteiro para cada uma e os centavos que sobram
   * para as primeiras, na ordem. R$ 9.400,00 em 3 → 3.133,34 + 3.133,33 + 3.133,33.
   */
  function dividirParcelas(total, n) {
    if (!inteiroPositivo_(total) || !inteiroPositivo_(n)) throw Validation.erro('INTERNAL', 'dividirParcelas espera total e número de parcelas inteiros positivos.');
    var q = Math.floor(total / n);
    var sobra = total - q * n;
    var out = [];
    for (var i = 0; i < n; i++) out.push(q + (i < sobra ? 1 : 0));
    return out;
  }
  /**
   * Resolve os títulos de um lançamento: cada parcela informada traz o vencimento; o valor vazio recebe a divisão
   * igual do que falta (mesma regra de dividirParcelas). Devolve [{parcela_num, data_vencimento, valor,
   * forma_pagamento, documento}] e põe no coletor os erros (vencimento, valor, soma ≠ valor do lançamento).
   */
  function resolverParcelas(valor, parcelas, col, o) {
    var campo = o.campo;
    var rotulo = o.rotulo;
    var lista = Array.isArray(parcelas) ? parcelas : [];
    if (!lista.length) { col.erro(det_('SEM_PARCELAS', campo, 'Informe como ' + rotulo + ' será pago: ao menos uma parcela, com o vencimento.')); return null; }
    if (lista.length > MAX_PARCELAS) { col.erro(det_('PARCELAS_DEMAIS', campo, 'Um lançamento aceita até ' + MAX_PARCELAS + ' parcelas.')); return null; }
    var ok = true;
    var informado = 0;
    var semValor = 0;
    lista.forEach(function (p, i) {
      var x = p && typeof p === 'object' ? p : {};
      var quem = (lista.length > 1 ? 'Parcela ' + (i + 1) : 'A parcela') + (o.prefixo ? ' ' + o.prefixo : '');
      if (vazio_(x.data_vencimento)) { col.erro(det_('CAMPO_OBRIGATORIO', campo, quem + ': informe o vencimento.', { indice: i })); ok = false; }
      else if (typeof x.data_vencimento !== 'string' || !Utils.dataValida(x.data_vencimento)) { col.erro(det_('FORMATO_INVALIDO', campo, quem + ': o vencimento não é uma data válida.', { indice: i })); ok = false; }
      if (vazio_(x.valor)) semValor++;
      else if (!inteiroPositivo_(x.valor)) { col.erro(det_('VALOR_FORA_DA_FAIXA', campo, quem + ': o valor precisa ser maior que zero (em centavos inteiros).', { indice: i })); ok = false; }
      else informado += x.valor;
    });
    if (!ok || !inteiroPositivo_(valor)) return null;
    var falta = valor - informado;
    if (semValor && falta < semValor) {
      col.erro(det_('PARCELAS_NAO_SOMAM', campo, 'As parcelas informadas já somam ' + reais_(informado) + ' e ' + rotulo + ' vale ' + reais_(valor) + ': não sobra valor para as parcelas sem valor.'));
      return null;
    }
    if (!semValor && falta !== 0) {
      col.erro(det_('PARCELAS_NAO_SOMAM', campo, 'As parcelas somam ' + reais_(informado) + ' e ' + rotulo + ' vale ' + reais_(valor) + '. Acerte os valores ou deixe-os em branco para dividir em partes iguais.'));
      return null;
    }
    var partes = semValor ? dividirParcelas(falta, semValor) : [];
    var k = 0;
    return lista.map(function (p, i) {
      var v = vazio_(p.valor) ? partes[k++] : p.valor;
      return { parcela_num: i + 1, data_vencimento: p.data_vencimento, valor: v, forma_pagamento: nulo_(p.forma_pagamento), documento: nulo_(p.documento) };
    });
  }

  // ------------------------------------------------------------------ rateio ----
  /**
   * Rateio de `valor` centavos pelo maior resto (07, seção 3.2; 03b, seção 13.3; Utils.ratear), com o desempate
   * determinístico maior resto → maior base → menor `chave` (o codigo_interno). itens: [{animal_id, chave, base}],
   * base na unidade do critério. Um único animal = DIRETO, com a base igual ao valor do lançamento (invariante 13).
   * Devolve {criterio, baseTotal, totalAlocado, itens: [{animal_id, chave, base, valor}]}.
   */
  function ratear(valor, criterio, itens) {
    var lista = itens || [];
    var crit = lista.length === 1 ? 'DIRETO' : criterio;
    var entrada = lista.map(function (it) { return { chave: it.chave, base: crit === 'DIRETO' ? valor / 100 : it.base }; });
    var r = Utils.ratear(valor, entrada);
    var porChave = Utils.indexarPor(r.itens, 'chave');
    return {
      criterio: crit, baseTotal: r.baseTotal, totalAlocado: r.totalAlocado,
      itens: lista.map(function (it) { var x = porChave[it.chave]; return { animal_id: it.animal_id, chave: it.chave, base: x.base, valor: x.valor }; }),
    };
  }

  /**
   * Monta, no plano do evento, um lançamento completo: FINANCEIRO, as PARCELAS (ou nenhuma, em `semCaixa`), o RATEIOS
   * do próprio evento (escopo EVENTO) e uma ALOCACOES_FINANCEIRAS por animal. spec: {evento: {event_id, event_date,
   * property_id}, conta (linha de PLANO_CONTAS), naturezas (aceitas), valor, descricao, partner_id, documento,
   * observacoes, quantidade, pasture_id, retida, semCaixa, parcelas: [{data_vencimento, valor?, forma_pagamento,
   * documento}], rateio: {criterio, itens: [{animal_id, chave, base}], cemPorCento, justificativa} | null, campo,
   * rotulo, prefixo}. Erros vão para `col`; com erro devolve null. Devolve {linhas: {FINANCEIRO: [..], PARCELAS,
   * RATEIOS, ALOCACOES_FINANCEIRAS}, financial_id, rateio (o de `ratear`), parcelas}.
   */
  function planejar(tx, spec, col) {
    var s = spec || {};
    var c = s.conta;
    var campo = s.campo || 'valor';
    var rotulo = s.rotulo || 'o lançamento';
    var antes = col.erros.length;
    if (!c) throw Validation.erro('INTERNAL', 'planejar: conta ausente.');
    if (s.naturezas && s.naturezas.indexOf(c.natureza) < 0) col.erro(det_('CONTA_INVALIDA', campo, 'A conta "' + c.nome + '" não serve para ' + rotulo + ': escolha uma conta de ' + s.naturezas.map(function (n) { return NOME_NATUREZA[n] || n; }).join(' ou ') + '.'));
    if (c.ativo === false) col.erro(det_('CONTA_INATIVA', campo, 'A conta "' + c.nome + '" está desativada.'));
    if (!inteiroPositivo_(s.valor)) col.erro(det_('VALOR_FORA_DA_FAIXA', campo, 'O valor de ' + rotulo + ' precisa ser maior que zero.'));
    var parcelas = [];
    if (s.semCaixa) {
      if (Array.isArray(s.parcelas) && s.parcelas.length) throw Validation.erro('INTERNAL', 'Lançamento sem efeito de caixa não tem parcela (invariante 4).');
    } else parcelas = resolverParcelas(s.valor, s.parcelas, col, { campo: s.campoParcelas || campo, rotulo: rotulo, prefixo: s.prefixo });
    var rat = null;
    if (s.rateio) {
      if (SEM_RATEIO.indexOf(c.natureza) >= 0) throw Validation.erro('INTERNAL', 'Lançamento de natureza ' + c.natureza + ' não é rateado aos animais (invariante 14).');
      var itens = s.rateio.itens || [];
      if (!itens.length) throw Validation.erro('INTERNAL', 'Rateio sem animais.');
      itens.forEach(function (it) {
        if (typeof it.base !== 'number' || !isFinite(it.base) || it.base <= 0) col.erro(det_('BASE_INVALIDA', campo, (it.quem || it.chave) + ': a base do rateio precisa ser maior que zero.'));
      });
      var jaPediu = col.erros.some(function (e) { return e.campo === 'justificativa_rateio'; });
      if (s.rateio.criterio === 'MANUAL' && vazio_(s.rateio.justificativa) && !jaPediu) col.erro(det_('CAMPO_OBRIGATORIO', 'justificativa_rateio', 'Explique o rateio manual (por que esses pesos).'));
      if (col.erros.length === antes && inteiroPositivo_(s.valor)) {
        try {
          rat = ratear(s.valor, s.rateio.criterio, itens);
        } catch (e) {
          if (!Validation.ehAppError(e) || e.code !== 'VALIDATION') throw e;
          col.erro(det_('RATEIO_INVALIDO', campo, e.message));
        }
        if (rat && s.rateio.cemPorCento && rat.totalAlocado !== s.valor) col.erro(det_('RATEIO_INCOMPLETO', campo, rotulo + ' precisa ser 100% distribuído entre os animais.'));
      }
    }
    if (col.erros.length !== antes) return null;
    var ev = s.evento;
    var finId = tx.novoId();
    var fin = {
      financial_id: finId, event_id: ev.event_id, ref_event_id: null, conta_id: c.conta_id, natureza: c.natureza, tipo: c.tipo,
      categoria: c.grupo, descricao: nulo_(s.descricao), data_competencia: s.data_competencia || ev.event_date, competencia_inicio: null,
      competencia_fim: null, valor: s.valor, quantidade: typeof s.quantidade === 'number' ? s.quantidade : null, product_id: null,
      pasture_id: nulo_(s.pasture_id), property_id: nulo_(ev.property_id), categoria_animal_id: null, partner_id: nulo_(s.partner_id),
      retida_pelo_comprador: s.retida === true, documento: nulo_(s.documento), observacoes: nulo_(s.observacoes),
    };
    var linhas = { FINANCEIRO: [fin], PARCELAS: [], RATEIOS: [], ALOCACOES_FINANCEIRAS: [] };
    (parcelas || []).forEach(function (p) {
      linhas.PARCELAS.push({
        parcela_id: tx.novoId(), financial_id: finId, parcela_num: p.parcela_num, data_vencimento: p.data_vencimento, valor: p.valor,
        forma_pagamento: p.forma_pagamento, status: 'ABERTA', parcela_origem_id: null, documento: p.documento,
      });
    });
    if (rat) {
      var ratId = tx.novoId();
      linhas.RATEIOS.push({
        rateio_id: ratId, event_id: ev.event_id, financial_id: finId, criterio: rat.criterio, escopo_tipo: 'EVENTO', escopo_ref: ev.event_id,
        periodo_inicio: null, periodo_fim: null, data_base: ev.event_date, base_total: rat.baseTotal, total_alocado: rat.totalAlocado,
        justificativa: rat.criterio === 'MANUAL' ? nulo_(s.rateio.justificativa) : null, created_by: tx.usuario,
      });
      rat.itens.forEach(function (it) {
        linhas.ALOCACOES_FINANCEIRAS.push({ alloc_id: tx.novoId(), rateio_id: ratId, financial_id: finId, animal_id: it.animal_id, base_valor: it.base, valor_alocado: it.valor });
      });
    }
    return { linhas: linhas, financial_id: finId, rateio: rat, parcelas: parcelas || [] };
  }
  /** Junta as linhas de um lançamento planejado ao plano do evento (dicionário {aba: [linhas]}). */
  function juntar(plano, planejado) {
    Object.keys(planejado.linhas).forEach(function (t) {
      plano[t] = plano[t] || [];
      planejado.linhas[t].forEach(function (r) { plano[t].push(r); });
    });
  }
  /** Aviso PERIODO_BLOQUEADO (RN-082) quando a competência cai até `fin_bloqueio_ate`; null fora do período. */
  function avisoPeriodo(params, data, oque) {
    var ate = params && params.fin_bloqueio_ate;
    if (vazio_(ate) || vazio_(data) || data > ate) return null;
    return { codigo: 'PERIODO_BLOQUEADO', mensagem: oque + ' cai em ' + br_(data) + ', dentro do período financeiro fechado (até ' + br_(ate) + '). Confirme com uma justificativa.' };
  }

  // ------------------------------------------------------------------ negociação ----
  function dec_(v) {
    return Math.round(v * 10);
  }
  /**
   * Conta da negociação de compra ou venda (07, seções 4.1 e 4.2; 03b, seções 4.3 a 4.5; RN-067, RN-068, RN-073).
   * spec: {modalidade, base_peso, rendimento_carcaca_pct, rendimento_tipo, preco_unitario (centavos), peso_total_kg,
   * valor (centavos: valor dos animais ou receita), criterio_rateio (só LOTE), arroba_kg, tolerancia_pct,
   * animais: [{chave, peso, peso_carcaca_kg, valor_individual, base_manual}]}. Puro.
   * Devolve {base_peso, rendimento_pct, rendimento_tipo, unidade_preco, preco_unitario, peso_vivo_total,
   * peso_carcaca_total, arrobas, criterio, bases: [número por animal], conferencia, desvio_pct, erros, avisos}; erros
   * e avisos: [{codigo, campo, mensagem, indice?}] (indice = posição do animal).
   */
  function negociacao(spec) {
    var s = spec || {};
    var animais = s.animais || [];
    var n = animais.length;
    var erros = [];
    var avisos = [];
    var r = { base_peso: null, rendimento_pct: null, rendimento_tipo: null, unidade_preco: null, preco_unitario: nulo_(s.preco_unitario), peso_vivo_total: null,
      peso_carcaca_total: null, arrobas: null, criterio: null, bases: [], conferencia: null, desvio_pct: null, erros: erros, avisos: avisos };
    var arroba = typeof s.arroba_kg === 'number' && s.arroba_kg > 0 ? s.arroba_kg : 15;
    var mod = s.modalidade;
    if (MODALIDADES.indexOf(mod) < 0) { erros.push(det_('CAMPO_OBRIGATORIO', 'modalidade', 'Escolha como o preço foi feito: por cabeça, por kg vivo, por arroba ou lote fechado.')); return r; }
    var temPeso = animais.filter(function (a) { return typeof a.peso === 'number'; }).length;
    var temCarc = animais.filter(function (a) { return typeof a.peso_carcaca_kg === 'number'; }).length;
    var temValor = animais.filter(function (a) { return typeof a.valor_individual === 'number'; }).length;
    var temManual = animais.filter(function (a) { return typeof a.base_manual === 'number'; }).length;
    // Base de peso (RN-067): KG_VIVO é sempre VIVO; ARROBA exige a base; CABECA e LOTE não têm base.
    if (mod === 'KG_VIVO') {
      if (!vazio_(s.base_peso) && s.base_peso !== 'VIVO') erros.push(det_('BASE_PESO_INVALIDA', 'base_peso', 'Preço por kg vivo é sempre sobre o peso vivo.'));
      r.base_peso = 'VIVO';
    } else if (mod === 'ARROBA') {
      if (vazio_(s.base_peso)) erros.push(det_('CAMPO_OBRIGATORIO', 'base_peso', 'Diga se a arroba é de peso vivo (com rendimento) ou de carcaça (romaneio).'));
      else r.base_peso = s.base_peso;
    } else if (!vazio_(s.base_peso)) erros.push(det_('CAMPO_NAO_SE_APLICA', 'base_peso', 'A base de peso só se aplica a preço por kg ou por arroba.'));
    // Rendimento: informado em arroba de base VIVO (NEGOCIADO ou ESTIMADO); derivado (APURADO) em base CARCACA.
    var rend = typeof s.rendimento_carcaca_pct === 'number' ? s.rendimento_carcaca_pct : null;
    if (r.base_peso === 'VIVO' && mod === 'ARROBA') {
      if (rend === null) erros.push(det_('CAMPO_OBRIGATORIO', 'rendimento_carcaca_pct', 'Informe o rendimento de carcaça combinado (em %).'));
      else if (!(rend > 0 && rend < 100)) erros.push(det_('VALOR_FORA_DA_FAIXA', 'rendimento_carcaca_pct', 'O rendimento precisa estar entre 0 e 100%.'));
      if (s.rendimento_tipo !== 'NEGOCIADO' && s.rendimento_tipo !== 'ESTIMADO') erros.push(det_('CAMPO_OBRIGATORIO', 'rendimento_tipo', 'Diga se o rendimento foi negociado entre as partes ou é uma estimativa.'));
      r.rendimento_pct = rend;
      r.rendimento_tipo = s.rendimento_tipo || null;
    } else {
      if (rend !== null) erros.push(det_('CAMPO_NAO_SE_APLICA', 'rendimento_carcaca_pct', 'O rendimento só é informado na arroba de peso vivo; na carcaça ele é calculado.'));
      if (!vazio_(s.rendimento_tipo)) erros.push(det_('CAMPO_NAO_SE_APLICA', 'rendimento_tipo', 'O tipo do rendimento só é informado na arroba de peso vivo.'));
    }
    // Pesos: vivo individual (ou o total do lote) e carcaça individual.
    var somaVivo = animais.reduce(function (t, a) { return t + (typeof a.peso === 'number' ? dec_(a.peso) : 0); }, 0);
    var somaCarc = animais.reduce(function (t, a) { return t + (typeof a.peso_carcaca_kg === 'number' ? dec_(a.peso_carcaca_kg) : 0); }, 0);
    var vivoDec = null;
    if (typeof s.peso_total_kg === 'number') {
      vivoDec = dec_(s.peso_total_kg);
      if (temPeso === n && n && vivoDec !== somaVivo) erros.push(det_('PESO_TOTAL_DIVERGENTE', 'peso_total_kg', 'O peso total do lote (' + s.peso_total_kg + ' kg) difere da soma dos pesos dos animais (' + somaVivo / 10 + ' kg). Deixe o total em branco ou acerte os pesos.'));
    } else if (temPeso === n && n) vivoDec = somaVivo;
    r.peso_vivo_total = vivoDec === null ? null : vivoDec / 10;
    var carcaca = r.base_peso === 'CARCACA' || (mod === 'LOTE' && s.criterio_rateio === 'PESO_CARCACA');
    if (temCarc && !carcaca) animais.forEach(function (a, i) { if (typeof a.peso_carcaca_kg === 'number') erros.push(det_('CAMPO_NAO_SE_APLICA', 'peso_carcaca_kg', 'o peso de carcaça só se informa na arroba de carcaça ou no rateio por carcaça.', { indice: i })); });
    animais.forEach(function (a, i) {
      if (typeof a.peso_carcaca_kg === 'number' && typeof a.peso === 'number' && a.peso_carcaca_kg >= a.peso) erros.push(det_('CARCACA_MAIOR_QUE_VIVO', 'peso_carcaca_kg', 'o peso de carcaça (' + a.peso_carcaca_kg + ' kg) não pode passar do peso vivo (' + a.peso + ' kg).', { indice: i }));
    });
    if (carcaca && temCarc !== n) erros.push(det_('PESO_OBRIGATORIO', 'peso_carcaca_kg', 'Informe o peso de carcaça de cada animal (romaneio).'));
    if (carcaca && temCarc === n) {
      r.peso_carcaca_total = somaCarc / 10;
      if (vivoDec !== null && r.base_peso === 'CARCACA') {
        r.rendimento_pct = Utils.arredondar(somaCarc / vivoDec * 100, 1);
        r.rendimento_tipo = 'APURADO';
        if (!(r.rendimento_pct > 0 && r.rendimento_pct < 100)) erros.push(det_('VALOR_FORA_DA_FAIXA', 'peso_total_kg', 'A carcaça total não pode passar do peso vivo total.'));
      }
    }
    // Preço e valor por animal.
    var preco = typeof s.preco_unitario === 'number' ? s.preco_unitario : null;
    if (mod === 'LOTE') {
      if (preco !== null) erros.push(det_('CAMPO_NAO_SE_APLICA', 'preco_unitario', 'No lote fechado não há preço unitário: informe só o valor total.'));
    } else if (mod === 'CABECA') {
      if (temValor && preco !== null) erros.push(det_('CONFLITO_DE_CAMPOS', 'preco_unitario', 'Informe o preço por cabeça OU o valor de cada animal, não os dois.'));
      if (!temValor && preco === null) erros.push(det_('CAMPO_OBRIGATORIO', 'preco_unitario', 'Informe o preço por cabeça ou o valor de cada animal.'));
    } else if (preco === null) erros.push(det_('CAMPO_OBRIGATORIO', 'preco_unitario', mod === 'KG_VIVO' ? 'Informe o preço por kg vivo.' : 'Informe o preço por arroba.'));
    if (preco !== null && !(preco > 0)) erros.push(det_('VALOR_FORA_DA_FAIXA', 'preco_unitario', 'O preço precisa ser maior que zero.'));
    r.unidade_preco = mod === 'LOTE' || preco === null ? null : mod === 'CABECA' ? 'CABECA' : mod;
    var aceitaValor = mod === 'CABECA' || (mod === 'LOTE' && s.criterio_rateio === 'VALOR_INDIVIDUAL');
    if (temValor && !aceitaValor) animais.forEach(function (a, i) { if (typeof a.valor_individual === 'number') erros.push(det_('CAMPO_NAO_SE_APLICA', 'valor_individual', 'o valor por animal só se informa no preço por cabeça ou no lote com rateio pelo valor de cada animal: nos demais o sistema calcula.', { indice: i })); });
    if (aceitaValor && temValor && temValor !== n) erros.push(det_('VALORES_INCOMPLETOS', 'valor_individual', 'Informe o valor de todos os animais ou de nenhum.'));
    if (aceitaValor && temValor === n && n && typeof s.valor === 'number' && soma_(animais, 'valor_individual') !== s.valor) {
      erros.push(det_('VALOR_INDIVIDUAL_NAO_SOMA', 'valor_individual', 'A soma dos valores por animal (' + reais_(soma_(animais, 'valor_individual')) + ') difere do valor dos animais (' + reais_(s.valor) + ').'));
    }
    animais.forEach(function (a, i) { if (typeof a.valor_individual === 'number' && !(a.valor_individual > 0)) erros.push(det_('VALOR_FORA_DA_FAIXA', 'valor_individual', 'o valor do animal precisa ser maior que zero.', { indice: i })); });
    // Critério de rateio (03b, seção 4.5): um animal = DIRETO; LOTE = o escolhido; os demais derivam da modalidade.
    var crit;
    if (mod === 'LOTE') {
      crit = s.criterio_rateio;
      if (CRITERIOS_LOTE.indexOf(crit) < 0) erros.push(det_('CAMPO_OBRIGATORIO', 'criterio_rateio', 'No lote fechado, escolha como dividir o valor entre os animais.'));
      if (crit === 'PESO_VIVO' && temPeso !== n) erros.push(det_('PESO_OBRIGATORIO', 'peso', 'Para dividir pelo peso vivo, informe o peso de cada animal.'));
      if (crit === 'VALOR_INDIVIDUAL' && temValor !== n) erros.push(det_('VALORES_INCOMPLETOS', 'valor_individual', 'Para dividir pelo valor de cada animal, informe o valor de todos.'));
    } else {
      if (!vazio_(s.criterio_rateio)) erros.push(det_('CAMPO_NAO_SE_APLICA', 'criterio_rateio', 'O critério de rateio só se escolhe no lote fechado; nas demais formas ele vem da negociação.'));
      if (mod === 'CABECA') crit = temValor ? 'VALOR_INDIVIDUAL' : 'CABECAS';
      else if (r.base_peso === 'CARCACA') crit = 'PESO_CARCACA';
      else if (temPeso === n && n) crit = 'PESO_VIVO';
      else {
        crit = 'CABECAS';
        if (n > 1) avisos.push(det_('RATEIO_SEM_PESO', 'peso', 'Sem o peso de cada animal, o valor e os custos serão divididos igualmente por cabeça.'));
      }
      if (temPeso && temPeso !== n && crit === 'CABECAS' && mod !== 'CABECA') erros.push(det_('PESO_INCOMPLETO', 'peso', 'Informe o peso de todos os animais ou de nenhum (só o total do lote).'));
    }
    if (temManual && crit !== 'MANUAL') animais.forEach(function (a, i) { if (typeof a.base_manual === 'number') erros.push(det_('CAMPO_NAO_SE_APLICA', 'base_manual', 'o peso no rateio manual só se informa com o critério manual.', { indice: i })); });
    if (crit === 'MANUAL' && temManual !== n) erros.push(det_('CAMPO_OBRIGATORIO', 'base_manual', 'No rateio manual, informe o peso de cada animal na divisão (percentual ou proporção).'));
    if ((mod === 'KG_VIVO' || (mod === 'ARROBA' && r.base_peso === 'VIVO')) && vivoDec === null) erros.push(det_('PESO_OBRIGATORIO', 'peso_total_kg', 'Informe o peso vivo total do lote ou o peso de cada animal.'));
    r.criterio = n === 1 ? 'DIRETO' : crit || null;
    r.bases = animais.map(function (a) {
      switch (r.criterio) {
        case 'DIRETO': return typeof s.valor === 'number' ? s.valor / 100 : null;
        case 'VALOR_INDIVIDUAL': return typeof a.valor_individual === 'number' ? a.valor_individual / 100 : null;
        case 'CABECAS': return 1;
        case 'PESO_VIVO': return typeof a.peso === 'number' ? a.peso : null;
        case 'PESO_CARCACA': return typeof a.peso_carcaca_kg === 'number' ? a.peso_carcaca_kg : null;
        case 'MANUAL': return typeof a.base_manual === 'number' ? a.base_manual : null;
        default: return null;
      }
    });
    // Conferência (não gravada): quantidade × preço, peso × preço, arrobas × preço; o valor informado prevalece.
    if (preco !== null && preco > 0) {
      if (mod === 'CABECA') r.conferencia = n * preco;
      else if (mod === 'KG_VIVO' && vivoDec !== null) r.conferencia = Math.round(vivoDec * preco / 10);
      else if (mod === 'ARROBA' && r.base_peso === 'VIVO' && vivoDec !== null && rend !== null) {
        r.arrobas = Utils.arredondar(vivoDec / 10 * rend / 100 / arroba, 2);
        r.conferencia = Math.round(vivoDec * dec_(rend) * preco / (10000 * arroba));
      } else if (mod === 'ARROBA' && r.base_peso === 'CARCACA' && r.peso_carcaca_total !== null) {
        r.arrobas = Utils.arredondar(somaCarc / 10 / arroba, 2);
        r.conferencia = Math.round(somaCarc * preco / (10 * arroba));
      }
    } else if (mod === 'CABECA' && temValor === n && n) r.conferencia = soma_(animais, 'valor_individual');
    if (r.arrobas === null && r.peso_carcaca_total !== null) r.arrobas = Utils.arredondar(somaCarc / 10 / arroba, 2);
    if (r.conferencia !== null && r.conferencia > 0 && typeof s.valor === 'number') {
      r.desvio_pct = Utils.arredondar(Math.abs(s.valor - r.conferencia) / r.conferencia * 100, 2);
      var tol = typeof s.tolerancia_pct === 'number' ? s.tolerancia_pct : 1;
      if (Math.abs(s.valor - r.conferencia) * 100 > tol * r.conferencia) {
        avisos.push(det_('VALOR_DIVERGENTE', 'valor_animais', 'O valor informado (' + reais_(s.valor) + ') difere em ' + String(r.desvio_pct).replace('.', ',') + '% da conta pela negociação (' + reais_(r.conferencia) + '), acima da tolerância de ' + String(tol).replace('.', ',') + '%. Vale o valor informado: confira a nota.'));
      }
    }
    return r;
  }

  // ------------------------------------------------------------------ invariantes (03b, seção 14) ----
  /**
   * Confere as invariantes entre FINANCEIRO, PARCELAS, RATEIOS e ALOCACOES_FINANCEIRAS (03b, seção 14) sobre as linhas
   * vigentes da unidade (tx.repo; tx.cru para o que é anulado). Reutilizável pela verificação de integridade: a
   * consulta precisa ler `leituras()` com acesso cru. Aba não lida → as invariantes que dependem dela não rodam.
   * Devolve [{invariante, tabela, id, mensagem}] (vazio = tudo fecha, ao centavo e sem tolerância).
   */
  function conferir(tx) {
    var repo = tx.repo;
    var cru = tx.cru || null;
    var out = [];
    function achado(n, tabela, id, mensagem) { out.push({ invariante: n, tabela: tabela, id: id, mensagem: mensagem }); }
    var base = ['FINANCEIRO', 'PARCELAS', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'EVENTOS', 'EVENTO_ANIMAIS'];
    if (!base.every(function (t) { return repo.carregada(t); })) return out;
    var temContas = repo.carregada('PLANO_CONTAS');
    var lancs = repo.vigentes('FINANCEIRO');
    var rateioDe = {};
    lancs.forEach(function (fin) {
      var nome = '"' + (fin.descricao || fin.financial_id) + '"';
      if (!inteiroPositivo_(fin.valor)) achado(1, 'FINANCEIRO', fin.financial_id, 'O lançamento ' + nome + ' precisa ter valor positivo em centavos.');
      if (temContas) {
        var c = repo.porId('PLANO_CONTAS', fin.conta_id);
        if (!c) achado(2, 'FINANCEIRO', fin.financial_id, 'O lançamento ' + nome + ' aponta para uma conta que não existe.');
        else if (c.natureza !== fin.natureza || c.tipo !== fin.tipo || c.grupo !== fin.categoria) achado(2, 'FINANCEIRO', fin.financial_id, 'O lançamento ' + nome + ' tem natureza, tipo ou grupo diferentes da conta "' + c.nome + '".');
        if (c && c.codigo === CONTAS.ABERTURA && repo.por('PARCELAS', 'financial_id', fin.financial_id).length) achado(4, 'FINANCEIRO', fin.financial_id, 'O saldo de abertura ' + nome + ' não pode ter parcela: não é caixa.');
      }
      var parcelas = repo.por('PARCELAS', 'financial_id', fin.financial_id);
      if (!vazio_(fin.product_id) && fin.natureza === 'CUSTEIO' && parcelas.length) achado(4, 'FINANCEIRO', fin.financial_id, 'O consumo de insumo ' + nome + ' não pode ter parcela.');
      if (parcelas.length && soma_(parcelas, 'valor') !== fin.valor) achado(3, 'FINANCEIRO', fin.financial_id, 'As parcelas de ' + nome + ' somam ' + reais_(soma_(parcelas, 'valor')) + ' e o lançamento vale ' + reais_(fin.valor) + '.');
      parcelas.forEach(function (p) {
        if (p.status === 'LIQUIDADA') {
          var esperado = (p.valor || 0) + (p.juros_multa || 0) - (p.desconto || 0);
          if (vazio_(p.data_pagamento) || p.valor_pago !== esperado) achado(5, 'PARCELAS', p.parcela_id, 'A parcela ' + p.parcela_num + ' de ' + nome + ' está paga sem data ou com valor pago diferente de valor + juros − desconto (' + reais_(esperado) + ').');
        } else if (p.status === 'ABERTA' && [p.data_pagamento, p.valor_pago, p.juros_multa, p.desconto].some(function (v) { return !vazio_(v); })) {
          achado(5, 'PARCELAS', p.parcela_id, 'A parcela ' + p.parcela_num + ' de ' + nome + ' está em aberto mas tem dados de pagamento.');
        }
      });
      var sp = situacaoPagamento(parcelas, true);
      if (!parcelas.length && fin.status_pagamento !== 'SEM_CAIXA') achado(4, 'FINANCEIRO', fin.financial_id, 'O lançamento ' + nome + ' não tem parcela e precisa ficar "sem caixa".');
      else if (fin.status_pagamento !== sp.status_pagamento || nulo_(fin.data_pagamento) !== sp.data_pagamento) achado(6, 'FINANCEIRO', fin.financial_id, 'O lançamento ' + nome + ' registra pagamento ' + fin.status_pagamento + ', mas pelas parcelas seria ' + sp.status_pagamento + '.');
      var rats = repo.por('RATEIOS', 'financial_id', fin.financial_id);
      if (rats.length > 1) achado(7, 'FINANCEIRO', fin.financial_id, 'O lançamento ' + nome + ' tem ' + rats.length + ' rateios valendo ao mesmo tempo.');
      var rat = rats[0] || null;
      rateioDe[fin.financial_id] = rat;
      var ev = repo.porId('EVENTOS', fin.event_id);
      if (rat && SEM_RATEIO.indexOf(fin.natureza) >= 0) achado(14, 'RATEIOS', rat.rateio_id, 'O lançamento ' + nome + ' é de ' + fin.natureza + ' e não pode ser rateado aos animais.');
      if (rat && rat.total_alocado > fin.valor) achado(9, 'RATEIOS', rat.rateio_id, 'O rateio de ' + nome + ' distribui ' + reais_(rat.total_alocado) + ', mais que o lançamento (' + reais_(fin.valor) + ').');
      if (ev && CEM_POR_CENTO[ev.event_type] && (!rat || rat.total_alocado !== fin.valor)) achado(10, 'FINANCEIRO', fin.financial_id, 'O lançamento ' + nome + ' de ' + ev.event_type + ' precisa estar 100% alocado aos animais.');
      var allocs = rat ? repo.por('ALOCACOES_FINANCEIRAS', 'rateio_id', rat.rateio_id) : [];
      var direta = rat && rat.criterio === 'DIRETO' && allocs.length === 1 && allocs[0].valor_alocado === fin.valor ? allocs[0].animal_id : null;
      if (nulo_(fin.animal_id) !== direta) achado(12, 'FINANCEIRO', fin.financial_id, 'O animal do lançamento ' + nome + ' (' + (fin.animal_id || 'vazio') + ') não corresponde à alocação direta (' + (direta || 'nenhuma') + ').');
    });
    repo.vigentes('RATEIOS').forEach(function (rat) {
      var allocs = repo.por('ALOCACOES_FINANCEIRAS', 'rateio_id', rat.rateio_id);
      if (soma_(allocs, 'valor_alocado') !== rat.total_alocado) achado(8, 'RATEIOS', rat.rateio_id, 'O rateio soma ' + reais_(soma_(allocs, 'valor_alocado')) + ' nas alocações e registra ' + reais_(rat.total_alocado) + '.');
      var bases = Utils.arredondar(allocs.reduce(function (t, a) { return t + (a.base_valor || 0); }, 0), 4);
      if (Math.abs(bases - (rat.base_total || 0)) > 1e-9) achado(8, 'RATEIOS', rat.rateio_id, 'As bases das alocações somam ' + bases + ' e o rateio registra ' + rat.base_total + '.');
      var vistos = {};
      allocs.forEach(function (a) {
        if (vistos[a.animal_id]) achado(11, 'ALOCACOES_FINANCEIRAS', a.alloc_id, 'O animal ' + a.animal_id + ' aparece duas vezes no mesmo rateio.');
        vistos[a.animal_id] = true;
        if (a.financial_id !== rat.financial_id) achado(11, 'ALOCACOES_FINANCEIRAS', a.alloc_id, 'A alocação aponta para outro lançamento que o do seu rateio.');
      });
      if (allocs.length === 1 && rat.criterio !== 'DIRETO') achado(13, 'RATEIOS', rat.rateio_id, 'Rateio com um único animal precisa ser DIRETO (está ' + rat.criterio + ').');
      if (allocs.length !== 1 && rat.criterio === 'DIRETO') achado(13, 'RATEIOS', rat.rateio_id, 'Rateio DIRETO precisa ter exatamente um animal (tem ' + allocs.length + ').');
    });
    conferirNegocios_(repo, lancs, rateioDe, achado);
    if (repo.carregada('SANIDADE')) {
      Utils.unicos(repo.vigentes('SANIDADE').map(function (x) { return x.event_id; })).forEach(function (eid) {
        var copias = soma_(repo.por('SANIDADE', 'event_id', eid), 'custo');
        var alocado = 0;
        repo.por('RATEIOS', 'event_id', eid).forEach(function (r) { alocado += soma_(repo.por('ALOCACOES_FINANCEIRAS', 'rateio_id', r.rateio_id), 'valor_alocado'); });
        if (copias !== alocado) achado(17, 'EVENTOS', eid, 'O custo copiado na sanidade (' + reais_(copias) + ') difere do alocado pelo evento (' + reais_(alocado) + ').');
      });
    }
    if (repo.carregada('ANIMAIS')) conferirCustoAquisicao_(tx, achado);
    if (cru) {
      cru.cru('FINANCEIRO').forEach(function (fin) {
        var a = cru.avaliar(fin.event_id);
        if (!a || a.vigente) return;
        var anulador = a.anulador_id ? cru.cruPorId('EVENTOS', a.anulador_id) : null;
        var liquidadas = cru.cruPor('PARCELAS', 'financial_id', fin.financial_id).filter(function (p) { return p.status === 'LIQUIDADA'; });
        if (anulador && anulador.event_type === 'ESTORNO' && liquidadas.length) achado(19, 'FINANCEIRO', fin.financial_id, 'O lançamento "' + (fin.descricao || fin.financial_id) + '" foi estornado com parcela paga.');
        var restos = repo.por('PARCELAS', 'financial_id', fin.financial_id).length + repo.por('RATEIOS', 'financial_id', fin.financial_id).length + repo.por('ALOCACOES_FINANCEIRAS', 'financial_id', fin.financial_id).length;
        if (restos) achado(20, 'FINANCEIRO', fin.financial_id, 'O lançamento cancelado "' + (fin.descricao || fin.financial_id) + '" ainda tem parcela, rateio ou alocação valendo.');
      });
    }
    return out;
  }
  /** Invariantes 15 e 16: valor por animal × cabeçalho comercial × lançamentos do evento (COMPRA e VENDA). */
  function conferirNegocios_(repo, lancs, rateioDe, achado) {
    var porEvento = Utils.agruparPor(lancs, 'event_id');
    var contas = repo.carregada('PLANO_CONTAS');
    function principal(eid, codigo) {
      return (porEvento[eid] || []).filter(function (f) { var c = contas ? repo.porId('PLANO_CONTAS', f.conta_id) : null; return c && c.codigo === codigo; })[0] || null;
    }
    function alocado(fin) {
      var r = fin ? rateioDe[fin.financial_id] : null;
      return r ? soma_(repo.por('ALOCACOES_FINANCEIRAS', 'rateio_id', r.rateio_id), 'valor_alocado') : 0;
    }
    if (repo.carregada('COMPRAS')) {
      repo.vigentes('COMPRAS').forEach(function (c) {
        var ea = repo.por('EVENTO_ANIMAIS', 'event_id', c.event_id);
        var ev = repo.porId('EVENTOS', c.event_id);
        var individual = soma_(ea, 'valor_individual');
        var fin = principal(c.event_id, CONTAS.COMPRA);
        if (individual !== c.valor_animais || !fin || fin.valor !== c.valor_animais || alocado(fin) !== c.valor_animais) achado(15, 'COMPRAS', c.purchase_id, 'A compra de ' + br_(ev && ev.event_date) + ': valores por animal (' + reais_(individual) + '), valor dos animais (' + reais_(c.valor_animais) + ') e lançamento principal não fecham.');
        var total = soma_(porEvento[c.event_id] || [], 'valor');
        if (total !== c.valor_total || c.valor_total !== c.valor_animais + c.frete + c.outros_custos) achado(16, 'COMPRAS', c.purchase_id, 'A compra registra ' + reais_(c.valor_total) + ' no total e os lançamentos do evento somam ' + reais_(total) + '.');
        if (ev && ev.total_value !== c.valor_total) achado(16, 'EVENTOS', c.event_id, 'O valor do evento de compra (' + reais_(ev.total_value) + ') difere do total da compra (' + reais_(c.valor_total) + ').');
        // Fretes primeiro, depois os outros custos (EventService): o frete é um prefixo dos lançamentos acessórios.
        var acess = (porEvento[c.event_id] || []).filter(function (f) { return f !== fin; });
        if (tiposDosCustos(acess, c.frete) === null || soma_(acess, 'valor') - c.frete !== c.outros_custos) achado(16, 'COMPRAS', c.purchase_id, 'O frete (' + reais_(c.frete) + ') e os outros custos (' + reais_(c.outros_custos) + ') da compra não conferem com os lançamentos de cada item.');
        if (c.qtd_animais !== ea.filter(function (l) { return l.efeito_inventario === 1; }).length) achado(16, 'COMPRAS', c.purchase_id, 'A quantidade de animais da compra não confere com os animais do evento.');
      });
    }
    if (repo.carregada('VENDAS')) {
      repo.vigentes('VENDAS').forEach(function (v) {
        var receita = v.valor_bruto - (v.desconto_comercial || 0);
        var ea = repo.por('EVENTO_ANIMAIS', 'event_id', v.event_id);
        var fin = principal(v.event_id, CONTAS.VENDA);
        if (soma_(ea, 'valor_individual') !== receita || !fin || fin.valor !== receita || alocado(fin) !== receita) achado(15, 'VENDAS', v.sale_id, 'A venda: valores por animal, receita (' + reais_(receita) + ') e lançamento de receita não fecham.');
        var deducoes = soma_((porEvento[v.event_id] || []).filter(function (f) { return f.natureza === 'DESPESA_VENDA'; }), 'valor');
        if (deducoes !== (v.frete || 0) + (v.comissao || 0) + (v.outras_deducoes || 0)) achado(16, 'VENDAS', v.sale_id, 'As deduções da venda não conferem com os lançamentos de despesa de venda (' + reais_(deducoes) + ').');
      });
    }
  }
  /**
   * Tipo (FRETE ou OUTRO) de cada lançamento acessório de uma compra, na ordem em que foram gravados: o prefixo que
   * soma `frete` é de fretes (a compra lança os fretes antes dos outros custos). null se nenhum prefixo fecha.
   */
  function tiposDosCustos(lancamentos, frete) {
    var acum = 0;
    var corte = frete === 0 ? 0 : -1;
    for (var i = 0; i < lancamentos.length && corte < 0; i++) {
      acum += lancamentos[i].valor || 0;
      if (acum === frete) corte = i + 1;
    }
    if (corte < 0) return null;
    return lancamentos.map(function (f, i) { return i < corte ? 'FRETE' : 'OUTRO'; });
  }
  /** Invariante 18: custo de aquisição do animal = Σ alocações vigentes AQUISICAO_ANIMAIS do período mais recente. */
  function conferirCustoAquisicao_(tx, achado) {
    var f = Timeline.fonte(tx);
    tx.repo.vigentes('ANIMAIS').forEach(function (a) {
      if (a.situacao_cadastral === 'EXTERNO') return;
      var entrada = Timeline.ordenar(f.linhas(a.animal_id).filter(function (l) { return l.efeito === 1 && !l.pre_marco_zero; })).pop();
      if (!entrada) return;
      var alocs = f.aquisicoes(a.animal_id).filter(function (x) { return x.data_competencia >= entrada.event_date; });
      var esperado = alocs.length ? soma_(alocs, 'valor') : entrada.event_type === 'NASCIMENTO' ? 0 : null;
      if (nulo_(a.custo_aquisicao) !== esperado) achado(18, 'ANIMAIS', a.animal_id, 'O custo de aquisição de ' + (a.brinco || a.codigo_interno) + ' (' + (a.custo_aquisicao === null ? 'vazio' : reais_(a.custo_aquisicao)) + ') difere da soma das alocações (' + (esperado === null ? 'nenhuma' : reais_(esperado)) + ').');
    });
  }
  /**
   * `status_pagamento*` e `data_pagamento*` de um lançamento pelas parcelas (03b, seção 10.4): SEM_CAIXA sem parcela;
   * CANCELADO com o lançamento anulado; LIQUIDADO com todas pagas (a maior data de pagamento); ABERTO sem nenhuma
   * paga; PARCIAL nos demais. `parcelas` = as não canceladas.
   */
  function situacaoPagamento(parcelas, ativo) {
    var ps = (parcelas || []).filter(function (p) { return p.status !== 'CANCELADA'; });
    if (!ps.length) return { status_pagamento: 'SEM_CAIXA', data_pagamento: null };
    if (!ativo) return { status_pagamento: 'CANCELADO', data_pagamento: null };
    if (ps.every(function (p) { return p.status === 'LIQUIDADA'; })) {
      var d = ps.reduce(function (m, p) { return vazio_(p.data_pagamento) || (m && m >= p.data_pagamento) ? m : p.data_pagamento; }, null);
      return { status_pagamento: 'LIQUIDADO', data_pagamento: d };
    }
    return { status_pagamento: ps.some(function (p) { return p.status === 'LIQUIDADA'; }) ? 'PARCIAL' : 'ABERTO', data_pagamento: null };
  }

  // ------------------------------------------------------------------ leituras ----
  /**
   * Totais dos títulos vigentes em D (07, seção 2.1): a pagar e a receber = nominal das parcelas ainda não liquidadas
   * em D, de lançamentos com competência até D; vencidos = os desses com vencimento antes de D. `data` vazia = sem
   * corte. Lê FINANCEIRO e PARCELAS. Devolve {data, a_pagar, a_receber, vencido_pagar, vencido_receber, parcelas_abertas}.
   */
  function titulos(repo, data) {
    var out = { data: nulo_(data), a_pagar: 0, a_receber: 0, vencido_pagar: 0, vencido_receber: 0, parcelas_abertas: 0 };
    repo.vigentes('PARCELAS').forEach(function (p) {
      var fin = repo.porId('FINANCEIRO', p.financial_id);
      if (!fin || (!vazio_(data) && fin.data_competencia > data)) return;
      var aberta = p.status === 'ABERTA' || (p.status === 'LIQUIDADA' && !vazio_(data) && p.data_pagamento > data);
      if (!aberta) return;
      var receita = fin.tipo === 'RECEITA';
      out.parcelas_abertas++;
      if (receita) out.a_receber += p.valor; else out.a_pagar += p.valor;
      if (!vazio_(data) && p.data_vencimento < data) { if (receita) out.vencido_receber += p.valor; else out.vencido_pagar += p.valor; }
    });
    return out;
  }
  /**
   * Bloco H da ficha (§11.2): custo de aquisição (a projeção, que é a soma das alocações) e os lançamentos do animal,
   * sempre a partir de ALOCACOES_FINANCEIRAS vigentes (a única fonte de valor por animal). Lê FINANCEIRO, RATEIOS,
   * ALOCACOES_FINANCEIRAS, PLANO_CONTAS e EVENTOS. Devolve {entregue, animal_id, custo_aquisicao,
   * custo_aquisicao_origem, por_natureza, custeio, custo_acumulado, receitas, despesas_venda, resultado, lancamentos}.
   */
  function blocoFicha(repo, animal) {
    var a = animal || {};
    var temContas = repo.carregada('PLANO_CONTAS');
    var por = { RECEITA_VENDA_ANIMAIS: 0, OUTRA_RECEITA: 0, AQUISICAO_ANIMAIS: 0, CUSTEIO: 0, DESPESA_VENDA: 0 };
    var itens = repo.por('ALOCACOES_FINANCEIRAS', 'animal_id', a.animal_id).map(function (al) {
      var fin = repo.porId('FINANCEIRO', al.financial_id) || {};
      var rat = repo.porId('RATEIOS', al.rateio_id) || {};
      var ev = repo.porId('EVENTOS', fin.event_id) || {};
      var c = temContas ? repo.porId('PLANO_CONTAS', fin.conta_id) : null;
      if (Object.prototype.hasOwnProperty.call(por, fin.natureza)) por[fin.natureza] += al.valor_alocado || 0;
      return {
        financial_id: fin.financial_id || al.financial_id, event_id: fin.event_id || null, event_type: ev.event_type || null, event_date: ev.event_date || null,
        data_competencia: fin.data_competencia || null, conta_codigo: c ? c.codigo : null, conta_nome: c ? c.nome : null, natureza: fin.natureza || null,
        tipo: fin.tipo || null, classe_custo_animal: c ? c.classe_custo_animal : null, descricao: fin.descricao || null, valor_lancamento: fin.valor || 0,
        valor_alocado: al.valor_alocado || 0, criterio: rat.criterio || null, base_valor: al.base_valor, base_total: rat.base_total, partner_id: fin.partner_id || null,
      };
    });
    itens = Utils.ordenarPor(itens, [{ campo: 'event_date', desc: true }, 'conta_codigo']);
    var saiu = SAIDAS.indexOf(a.situacao_cadastral) >= 0;
    var custo = nulo_(a.custo_aquisicao);
    var receitas = por.RECEITA_VENDA_ANIMAIS + por.OUTRA_RECEITA;
    var acumulado = custo === null ? null : custo + por.CUSTEIO;
    var resultado = saiu && acumulado !== null
      ? { valor: receitas - por.DESPESA_VENDA - acumulado, motivo: null }
      : { valor: null, motivo: 'DADOS_INSUFICIENTES', mensagem: saiu ? 'Sem custo de aquisição conhecido, o resultado não é calculado.' : 'O resultado só existe depois que o animal sai do rebanho.' };
    return {
      entregue: true, animal_id: a.animal_id || null, custo_aquisicao: custo, custo_aquisicao_origem: nulo_(a.custo_aquisicao_origem),
      por_natureza: por, custeio: por.CUSTEIO, custo_acumulado: acumulado, receitas: receitas, despesas_venda: por.DESPESA_VENDA,
      resultado: resultado, lancamentos: itens,
    };
  }

  return {
    CONTAS: CONTAS,
    MODALIDADES: MODALIDADES,
    CRITERIOS_LOTE: CRITERIOS_LOTE,
    SEM_RATEIO: SEM_RATEIO,
    MAX_PARCELAS: MAX_PARCELAS,
    leituras: leituras,
    conta: conta,
    dividirParcelas: dividirParcelas,
    resolverParcelas: resolverParcelas,
    ratear: ratear,
    planejar: planejar,
    juntar: juntar,
    avisoPeriodo: avisoPeriodo,
    negociacao: negociacao,
    conferir: conferir,
    situacaoPagamento: situacaoPagamento,
    tiposDosCustos: tiposDosCustos,
    titulos: titulos,
    blocoFicha: blocoFicha,
  };
})();
