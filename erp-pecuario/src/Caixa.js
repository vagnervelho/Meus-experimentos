/**
 * Caixa — os títulos (PARCELAS) e o fluxo de caixa (Fase 4, E4.2; 03b, seção 11; 07, seções 1.1 e 2.1; 05, RN-076, RN-081,
 * RN-082 e RN-046; CONTRATOS, seção 56). Puro: nada aqui lê o relógio nem chama serviço do Apps Script.
 *
 * Comandos sem evento (desenho-base 4.2): a baixa (`parcela.baixar`, uma ou várias parcelas na mesma data, inteira ou em
 * parte), o desfazer da baixa (`parcela.desfazerBaixa`) e o desdobramento (`parcela.desdobrar`: a parcela em aberto
 * substituída por outras que somam o mesmo). Mudam só as colunas de controle das parcelas e criam as parcelas do
 * desdobramento, pela auditoria (o registro de refazer: a fase C aplica); a projeção do lançamento (situação do pagamento)
 * é refeita pelo mesmo projetor. A validação e o efeito de cada um ficam num tratador só, o mesmo no SIMULAR. O que eles
 * gravam é conferido pela verificação de integridade (FinancialService.conferir, invariantes 5, 22, 23 e 24), a mesma
 * função da trava única.
 *
 * Regras da baixa (03b, seção 11): a parcela está em aberto; a data não é futura e não é antes da competência do
 * lançamento (a identidade das três visões; CONTRATOS, seção 55); juros e multa ≥ 0; desconto ≥ 0 e menor que o valor;
 * valor pago = valor + juros e multa − desconto (o informado é conferido: RN-081). Baixa parcial = desdobramento: a parcela
 * vira CANCELADA e nascem duas, a paga (o valor baixado) e a que resta (o mesmo vencimento), as duas com `parcela_origem_id`.
 * Encontro de contas (03b, seção 10.3; 07, seção 4): a baixa do recebimento de uma venda quita junto, na mesma data e pelo
 * nominal, as deduções descontadas pelo comprador que vencem nele; a dedução retida não se baixa sozinha. Caixa único (07,
 * seção 11): a "conta ou caixa" da baixa é a forma de pagamento (LISTAS.FORMA_PAGAMENTO).
 *
 * Regra de tempo das consultas (o número pedido numa data D): o lançamento com competência até D, a parcela paga até D e as
 * parcelas como estavam em D — a parcela desdobrada vale até o dia do desdobramento (o primeiro pagamento das que nasceram
 * dela, ou o dia em que ele foi registrado, no fuso da fazenda); depois, as que nasceram dela. O saldo de caixa parte da
 * observação do dono (`caixa_saldo_inicial` no começo do dia `caixa_saldo_inicial_data`): antes dela não há saldo
 * (DADOS_INSUFICIENTES), e o pagamento lançado depois com data anterior a ela muda só o movimento anterior, nunca o saldo
 * observado.
 */
var Caixa = (function () {
  var AGRUPAMENTOS = ['DIA', 'SEMANA', 'MES'];
  var MAX_PERIODOS = 400;
  var MAX_ITENS = 200;
  var SITUACOES_TITULOS = ['ABERTOS', 'VENCIDOS', 'A_VENCER', 'PAGOS'];
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function nulo_(v) {
    return vazio_(v) ? null : v;
  }
  function br_(d) {
    return vazio_(d) ? '' : String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4);
  }
  function reais_(c) {
    return Utils.formatarReais(c || 0);
  }
  function inteiroNaoNegativo_(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0;
  }
  function det_(codigo, campo, mensagem, extra) {
    var d = { codigo: codigo, campo: campo || null, mensagem: mensagem };
    Object.keys(extra || {}).forEach(function (k) { d[k] = extra[k]; });
    return Validation.detalhe(d);
  }
  function validacao_(mensagem, campo, codigo) {
    return Validation.erro('VALIDATION', mensagem, [det_(codigo || 'FORMATO_INVALIDO', campo, mensagem)]);
  }

  /** As abas que os comandos e as consultas leem (a vigência do lançamento e do evento, os parâmetros, a forma de pagamento). */
  function leituras() {
    return ['FINANCEIRO', 'PARCELAS', 'EVENTOS', 'VENDAS', 'PLANO_CONTAS', 'PARCEIROS', 'CONFIGURACOES', 'LISTAS', 'PASTOS'];
  }

  // ------------------------------------------------------------------ a parcela em D ----
  /** O dia (yyyy-MM-dd) de um instante no fuso da fazenda (o dia em que o desdobramento foi registrado). */
  function diaDo_(tx, instante) {
    if (vazio_(instante) || !tx.ctx || vazio_(tx.ctx.fuso)) return null;
    return Utils.hoje(instante, tx.ctx.fuso);
  }
  /**
   * O dia do desdobramento da parcela `p` (as que nasceram dela): o primeiro pagamento entre elas ou, sem pagamento antes, o
   * dia em que foram registradas. null quando nada nasceu dela.
   */
  function diaDoDesdobramento_(tx, filhas) {
    var d = null;
    (filhas || []).forEach(function (q) {
      [diaDo_(tx, q.created_at), q.status === 'LIQUIDADA' ? nulo_(q.data_pagamento) : null].forEach(function (x) { if (x && (d === null || x < d)) d = x; });
    });
    return d;
  }
  /**
   * As parcelas do lançamento como estavam no fim do dia D (D vazio = hoje, as que valem): [{p (a linha), paga (até D)}]. A
   * parcela desdobrada até D dá lugar às que nasceram dela; a desdobrada depois de D ainda vale em D (em aberto).
   */
  function parcelasEm(tx, fin, D) {
    var todas = tx.cru ? tx.cru.cruPor('PARCELAS', 'financial_id', fin.financial_id) : tx.repo.por('PARCELAS', 'financial_id', fin.financial_id);
    var filhas = {};
    todas.forEach(function (q) { if (!vazio_(q.parcela_origem_id)) (filhas[q.parcela_origem_id] = filhas[q.parcela_origem_id] || []).push(q); });
    var out = [];
    function expandir(p) {
      var f = filhas[p.parcela_id] || [];
      if (p.status === 'CANCELADA') {
        // Cancelada sem as do desdobramento: a fonte quebrada (a verificação acusa); não vale.
        if (!f.length) return;
        var dia = diaDoDesdobramento_(tx, f);
        if (D === null || (dia !== null && dia <= D)) { f.forEach(expandir); return; }
        out.push({ p: p, paga: false });
        return;
      }
      out.push({ p: p, paga: p.status === 'LIQUIDADA' && !vazio_(p.data_pagamento) && (D === null || p.data_pagamento <= D) });
    }
    todas.filter(function (q) { return vazio_(q.parcela_origem_id); }).forEach(expandir);
    return out;
  }
  /** Os lançamentos que valem com competência até D (sem o histórico anterior ao marco zero, que não tem caixa). */
  function lancamentosAte_(tx, D) {
    return tx.repo.vigentes('FINANCEIRO').filter(function (f) {
      var ev = tx.repo.porId('EVENTOS', f.event_id);
      return ev && ev.pre_marco_zero !== true && (D === null || f.data_competencia <= D);
    });
  }

  // ------------------------------------------------------------------ comandos ----
  /** A parcela que vale, o lançamento e o evento dela; senão NOT_FOUND. */
  function parcelaQueVale_(tx, id) {
    var p = vazio_(id) ? null : tx.repo.porId('PARCELAS', id);
    var fin = p ? tx.repo.porId('FINANCEIRO', p.financial_id) : null;
    var ev = fin ? tx.repo.porId('EVENTOS', fin.event_id) : null;
    if (!p || !fin || !ev) throw Validation.erro('NOT_FOUND', 'A parcela não existe mais, ou o lançamento dela foi cancelado. Atualize a tela e tente de novo.');
    return { p: p, fin: fin, ev: ev };
  }
  function nomeDoLancamento_(tx, fin) {
    if (!vazio_(fin.descricao)) return fin.descricao;
    var c = tx.repo.porId('PLANO_CONTAS', fin.conta_id);
    return c ? c.nome : 'lançamento';
  }
  function quemParcela_(tx, x) {
    return 'Parcela ' + x.p.parcela_num + ' de "' + nomeDoLancamento_(tx, x.fin) + '" (vence em ' + br_(x.p.data_vencimento) + ')';
  }
  /** As deduções descontadas pelo comprador que vencem no recebimento `p` da venda (o encontro de contas). */
  function retidasDoRecebimento_(tx, fin, p) {
    if (fin.natureza !== 'RECEITA_VENDA_ANIMAIS') return [];
    var out = [];
    tx.repo.por('FINANCEIRO', 'event_id', fin.event_id).forEach(function (f) {
      if (f.retida_pelo_comprador !== true) return;
      tx.repo.por('PARCELAS', 'financial_id', f.financial_id).forEach(function (q) { if (q.data_vencimento === p.data_vencimento) out.push({ p: q, fin: f }); });
    });
    return out;
  }
  /**
   * O título que a correção do evento de origem refaz parcela a parcela (o grupo `parcelas` do formulário): a compra (o valor dos
   * animais), a receita da venda e o lançamento avulso. Os demais (o frete e os outros custos da compra, as deduções da venda, o
   * custo da morte, a receita do descarte, a despesa do manejo, a compra de insumo) são em N parcelas iguais de mês em mês: a
   * baixa é inteira e a parcela não se divide (a correção os refaria iguais; CONTRATOS, seção 56).
   */
  function tituloLivre_(tx, fin, ev) {
    if (ev.event_type === 'LANCAMENTO_FINANCEIRO') return true;
    if (ev.event_type === 'VENDA') return fin.natureza === 'RECEITA_VENDA_ANIMAIS';
    if (ev.event_type !== 'COMPRA') return false;
    var c = tx.repo.porId('PLANO_CONTAS', fin.conta_id);
    return !!c && c.codigo === FinancialService.CONTAS.COMPRA;
  }
  var EM_PARTES_IGUAIS = 'é de um lançamento em parcelas iguais (o frete, o custo da morte, a compra do insumo…): dê a baixa da parcela inteira, ou corrija o lançamento de origem para mudar as parcelas.';
  function formasAtivas_(tx) {
    return tx.repo.vigentes('LISTAS').filter(function (l) { return l.lista === 'FORMA_PAGAMENTO' && l.ativo !== false; }).map(function (l) { return l.codigo; });
  }
  function conferirForma_(tx, col, forma, quem) {
    if (vazio_(forma)) return;
    if (formasAtivas_(tx).indexOf(forma) < 0) col.erro(det_('VALOR_FORA_DA_LISTA', 'forma_pagamento', quem + 'a forma de pagamento "' + forma + '" não está entre as ativas da lista.'));
  }
  /** Os dados do pedido: a justificativa vale também como a do aviso do período fechado (um campo só na tela). */
  function dadosDoPedido_(p) {
    var d = Utils.clonar((p && p.dados) || {});
    if (vazio_(d.justificativa_aviso) && !vazio_(d.justificativa)) d.justificativa_aviso = d.justificativa;
    return d;
  }
  function comando_(rota, pedido, tratador, reconstruir) {
    var p = pedido || {};
    return {
      rota: rota, idempotencyKey: p.idempotencyKey, dados: dadosDoPedido_(p), avisosAceitos: p.avisosAceitos || [],
      dataVersionEsperada: p.dataVersionEsperada, modo: p.modo, acessoCru: true, reads: leituras(),
      tratador: tratador, reconstruir: reconstruir,
    };
  }
  /** As parcelas citadas, como estão depois do comando (a resposta e o reenvio duplicado). */
  function respostaParcelas_(tx, ids) {
    return { parcelas: (ids || []).map(function (id) { var p = tx.cru ? tx.cru.cruPorId('PARCELAS', id) : tx.repo.porId('PARCELAS', id); return p ? Utils.clonar(p) : null; }).filter(Boolean) };
  }

  /**
   * `parcela.baixar` (RN-081): dados {data_pagamento, forma_pagamento?, justificativa?, justificativa_aviso?, e uma parcela
   * (parcela_id, valor?, juros_multa?, desconto?, valor_pago?) ou várias em `itens` (a baixa em lote: a mesma data e a mesma
   * forma; cada item com o seu valor, juros, desconto e valor pago)}. `valor` (o nominal baixado) menor que o da parcela =
   * baixa parcial. Devolve {impactos: {data_pagamento, itens, entradas, saidas, liquido}, resposta: {parcelas}}.
   */
  function tratadorBaixar_(tx) {
    var d = tx.dados || {};
    var col = Validation.coletor();
    var itens = Array.isArray(d.itens) ? d.itens : [{ parcela_id: d.parcela_id, valor: d.valor, juros_multa: d.juros_multa, desconto: d.desconto, valor_pago: d.valor_pago, forma_pagamento: d.forma_pagamento }];
    if (!itens.length) return { erros: [det_('CAMPO_OBRIGATORIO', 'itens', 'Escolha ao menos uma parcela para dar baixa.')] };
    if (itens.length > MAX_ITENS) return { erros: [det_('VALOR_FORA_DA_FAIXA', 'itens', 'Uma baixa em lote vai até ' + MAX_ITENS + ' parcelas; divida em partes.')] };
    var data = d.data_pagamento;
    if (vazio_(data)) col.erro(det_('CAMPO_OBRIGATORIO', 'data_pagamento', 'Informe a data do pagamento (ou do recebimento).'));
    else if (typeof data !== 'string' || !Utils.dataValida(data)) col.erro(det_('FORMATO_INVALIDO', 'data_pagamento', 'A data do pagamento não é uma data válida.'));
    else if (!vazio_(tx.hoje) && data > tx.hoje) col.erro(det_('DATA_FUTURA', 'data_pagamento', 'A data do pagamento (' + br_(data) + ') ainda não chegou: dê a baixa no dia em que pagar ou receber.'));
    conferirForma_(tx, col, d.forma_pagamento, '');
    var vistos = {};
    var planos = [];
    itens.forEach(function (it, i) {
      var x = it && typeof it === 'object' ? it : {};
      if (vazio_(x.parcela_id)) { col.erro(det_('CAMPO_OBRIGATORIO', 'parcela_id', 'Item ' + (i + 1) + ': escolha a parcela.', { indice: i })); return; }
      if (vistos[x.parcela_id]) { col.erro(det_('PARCELA_REPETIDA', 'parcela_id', 'Item ' + (i + 1) + ': a mesma parcela aparece duas vezes na baixa.', { indice: i })); return; }
      vistos[x.parcela_id] = true;
      var alvo = parcelaQueVale_(tx, x.parcela_id);
      var p = alvo.p;
      var quem = quemParcela_(tx, alvo) + ': ';
      if (p.status !== 'ABERTA') { col.erro(det_('PARCELA_JA_PAGA', 'parcela_id', quem + 'já está paga (em ' + br_(p.data_pagamento) + '). Para mudar o pagamento, desfaça a baixa antes.', { indice: i })); return; }
      if (alvo.fin.retida_pelo_comprador === true) { col.erro(det_('PARCELA_RETIDA', 'parcela_id', quem + 'é descontada pelo comprador: ela é quitada junto com o recebimento da venda (encontro de contas). Dê a baixa no recebimento.', { indice: i })); return; }
      var valor = vazio_(x.valor) ? p.valor : x.valor;
      var juros = vazio_(x.juros_multa) ? 0 : x.juros_multa;
      var desconto = vazio_(x.desconto) ? 0 : x.desconto;
      if (!inteiroNaoNegativo_(valor) || valor === 0) { col.erro(det_('VALOR_FORA_DA_FAIXA', 'valor', quem + 'o valor baixado precisa ser maior que zero, em centavos inteiros.', { indice: i })); return; }
      if (valor > p.valor) { col.erro(det_('VALOR_FORA_DA_FAIXA', 'valor', quem + 'o valor baixado (' + reais_(valor) + ') é maior que o da parcela (' + reais_(p.valor) + '). Juros e multa vão no campo próprio.', { indice: i })); return; }
      if (!inteiroNaoNegativo_(juros)) { col.erro(det_('VALOR_FORA_DA_FAIXA', 'juros_multa', quem + 'juros e multa não podem ser negativos (centavos inteiros).', { indice: i })); return; }
      if (!inteiroNaoNegativo_(desconto)) { col.erro(det_('VALOR_FORA_DA_FAIXA', 'desconto', quem + 'o desconto não pode ser negativo (centavos inteiros).', { indice: i })); return; }
      if (desconto >= valor) { col.erro(det_('VALOR_FORA_DA_FAIXA', 'desconto', quem + 'o desconto (' + reais_(desconto) + ') precisa ser menor que o valor baixado (' + reais_(valor) + ').', { indice: i })); return; }
      var pago = valor + juros - desconto;
      if (!vazio_(x.valor_pago) && x.valor_pago !== pago) { col.erro(det_('VALOR_PAGO_DIVERGENTE', 'valor_pago', quem + 'o valor pago precisa ser o valor (' + reais_(valor) + ') + juros e multa (' + reais_(juros) + ') − desconto (' + reais_(desconto) + ') = ' + reais_(pago) + '; foi informado ' + reais_(x.valor_pago) + '.', { indice: i })); return; }
      if (Utils.dataValida(data) && data < alvo.fin.data_competencia) {
        col.erro(det_('PAGAMENTO_ANTES_DA_COMPETENCIA', 'data_pagamento', quem + 'o pagamento em ' + br_(data) + ' é antes da data do lançamento (' + br_(alvo.fin.data_competencia) + '). O pagamento adiantado de um período vai num lançamento com a data do pagamento e o período depois dela.', { indice: i }));
        return;
      }
      var forma = !vazio_(x.forma_pagamento) ? x.forma_pagamento : !vazio_(d.forma_pagamento) ? d.forma_pagamento : nulo_(p.forma_pagamento);
      if (!vazio_(x.forma_pagamento)) conferirForma_(tx, col, x.forma_pagamento, quem);
      var retidas = retidasDoRecebimento_(tx, alvo.fin, p);
      var parcial = valor < p.valor;
      if (parcial && !tituloLivre_(tx, alvo.fin, alvo.ev)) { col.erro(det_('TITULO_EM_PARTES_IGUAIS', 'valor', quem + EM_PARTES_IGUAIS, { indice: i })); return; }
      if (parcial && retidas.length) { col.erro(det_('BAIXA_PARCIAL_COM_RETENCAO', 'valor', quem + 'tem dedução descontada pelo comprador no mesmo recebimento: dê a baixa no recebimento inteiro (o depósito esperado já vem líquido).', { indice: i })); return; }
      retidas.forEach(function (r) {
        if (r.p.status !== 'ABERTA') col.erro(det_('ENCONTRO_DESFEITO', 'parcela_id', quem + 'a dedução "' + nomeDoLancamento_(tx, r.fin) + '" deste recebimento já está quitada sem ele. Restaure o backup ou investigue a edição manual.', { indice: i }));
        else if (Utils.dataValida(data) && data < r.fin.data_competencia) col.erro(det_('PAGAMENTO_ANTES_DA_COMPETENCIA', 'data_pagamento', quem + 'a dedução "' + nomeDoLancamento_(tx, r.fin) + '" é de ' + br_(r.fin.data_competencia) + ', depois do recebimento em ' + br_(data) + '.', { indice: i }));
      });
      planos.push({ alvo: alvo, valor: valor, juros: juros, desconto: desconto, pago: pago, forma: forma, parcial: parcial, retidas: retidas });
    });
    if (col.temErros()) return { erros: col.erros };
    var avisos = [];
    var ids = [];
    var eventos = {};
    var entradas = 0;
    var saidas = 0;
    var impactos = planos.map(function (pl) {
      var p = pl.alvo.p;
      var fin = pl.alvo.fin;
      eventos[fin.event_id] = true;
      var paga = { status: 'LIQUIDADA', data_pagamento: data, valor_pago: pl.pago, juros_multa: pl.juros || null, desconto: pl.desconto || null, forma_pagamento: pl.forma };
      var resta = null;
      if (pl.parcial) {
        // Baixa parcial = desdobramento (03b, seção 11): a parcela vira CANCELADA; nascem a paga e a que resta, com o mesmo
        // número e o mesmo vencimento, apontando para ela.
        var idPaga = tx.novoId();
        var idResta = tx.novoId();
        AuditService.alteracao(tx, 'PARCELAS', p.parcela_id, { status: 'CANCELADA' }, d.justificativa);
        AuditService.criacao(tx, 'PARCELAS', idPaga, Object.assign({ financial_id: fin.financial_id, parcela_num: p.parcela_num, data_vencimento: p.data_vencimento, valor: pl.valor, parcela_origem_id: p.parcela_id, documento: nulo_(p.documento) }, paga), d.justificativa);
        AuditService.criacao(tx, 'PARCELAS', idResta, { financial_id: fin.financial_id, parcela_num: p.parcela_num, data_vencimento: p.data_vencimento, valor: p.valor - pl.valor, status: 'ABERTA', forma_pagamento: nulo_(p.forma_pagamento), parcela_origem_id: p.parcela_id, documento: nulo_(p.documento) }, d.justificativa);
        ids.push(p.parcela_id, idPaga, idResta);
        resta = { parcela_id: idResta, valor: p.valor - pl.valor, data_vencimento: p.data_vencimento };
      } else {
        AuditService.alteracao(tx, 'PARCELAS', p.parcela_id, paga, d.justificativa);
        ids.push(p.parcela_id);
      }
      var encontro = pl.retidas.map(function (r) {
        AuditService.alteracao(tx, 'PARCELAS', r.p.parcela_id, { status: 'LIQUIDADA', data_pagamento: data, valor_pago: r.p.valor, juros_multa: null, desconto: null, forma_pagamento: pl.forma }, d.justificativa);
        ids.push(r.p.parcela_id);
        eventos[r.fin.event_id] = true;
        return { parcela_id: r.p.parcela_id, descricao: nomeDoLancamento_(tx, r.fin), valor: r.p.valor };
      });
      var retido = encontro.reduce(function (s, e) { return s + e.valor; }, 0);
      if (fin.tipo === 'RECEITA') entradas += pl.pago; else saidas += pl.pago;
      saidas += retido;
      return {
        parcela_id: p.parcela_id, financial_id: fin.financial_id, lancamento: nomeDoLancamento_(tx, fin), tipo: fin.tipo, parcela_num: p.parcela_num,
        data_vencimento: p.data_vencimento, valor_parcela: p.valor, valor: pl.valor, juros_multa: pl.juros, desconto: pl.desconto, valor_pago: pl.pago,
        forma_pagamento: pl.forma, parcial: pl.parcial, resta: resta, encontro: encontro, deposito: fin.tipo === 'RECEITA' ? pl.pago - retido : null,
      };
    });
    return {
      avisos: avisos,
      resumo: { acao: 'baixar', data_pagamento: data, parcelas: ids },
      impactos: { acao: 'baixar', data_pagamento: data, itens: impactos, entradas: entradas, saidas: saidas, liquido: entradas - saidas },
      derivados: { eventos: Object.keys(eventos) },
      resposta: function (t) { return respostaParcelas_(t, ids); },
    };
  }

  /**
   * `parcela.desfazerBaixa` (03b, seção 11; RN-042: o caminho antes do estorno): dados {parcela_id, justificativa}. A parcela
   * paga volta a ficar em aberto (as colunas da baixa vazias); a forma de pagamento fica a última. No recebimento da venda, as
   * deduções descontadas pelo comprador quitadas no mesmo encontro voltam junto; a dedução retida não se desfaz sozinha.
   */
  function tratadorDesfazer_(tx) {
    var d = tx.dados || {};
    var col = Validation.coletor();
    if (vazio_(d.parcela_id)) return { erros: [det_('CAMPO_OBRIGATORIO', 'parcela_id', 'Escolha a parcela.')] };
    if (vazio_(d.justificativa)) col.erro(det_('CAMPO_OBRIGATORIO', 'justificativa', 'Diga por que a baixa está sendo desfeita.'));
    var alvo = parcelaQueVale_(tx, d.parcela_id);
    var p = alvo.p;
    var quem = quemParcela_(tx, alvo) + ': ';
    if (p.status !== 'LIQUIDADA') col.erro(det_('PARCELA_EM_ABERTO', 'parcela_id', quem + 'não está paga; não há baixa a desfazer.'));
    if (alvo.fin.retida_pelo_comprador === true) col.erro(det_('PARCELA_RETIDA', 'parcela_id', quem + 'foi quitada no recebimento da venda (encontro de contas): desfaça a baixa do recebimento.'));
    if (col.temErros()) return { erros: col.erros };
    var retidas = retidasDoRecebimento_(tx, alvo.fin, p).filter(function (r) { return r.p.status === 'LIQUIDADA' && r.p.data_pagamento === p.data_pagamento; });
    var limpa = { status: 'ABERTA', data_pagamento: null, valor_pago: null, juros_multa: null, desconto: null };
    AuditService.alteracao(tx, 'PARCELAS', p.parcela_id, limpa, d.justificativa);
    var ids = [p.parcela_id];
    var eventos = {};
    eventos[alvo.fin.event_id] = true;
    retidas.forEach(function (r) { AuditService.alteracao(tx, 'PARCELAS', r.p.parcela_id, limpa, d.justificativa); ids.push(r.p.parcela_id); eventos[r.fin.event_id] = true; });
    var avisos = [];
    return {
      avisos: avisos,
      resumo: { acao: 'desfazerBaixa', parcelas: ids },
      impactos: { acao: 'desfazerBaixa', parcela_id: p.parcela_id, lancamento: nomeDoLancamento_(tx, alvo.fin), tipo: alvo.fin.tipo, data_pagamento: p.data_pagamento, valor_pago: p.valor_pago, encontro: retidas.map(function (r) { return { parcela_id: r.p.parcela_id, descricao: nomeDoLancamento_(tx, r.fin), valor: r.p.valor }; }) },
      derivados: { eventos: Object.keys(eventos) },
      resposta: function (t) { return respostaParcelas_(t, ids); },
    };
  }

  /**
   * `parcela.desdobrar` (03b, seção 11; desenho-base 16.11): dados {parcela_id, parcelas: [{data_vencimento, valor?,
   * forma_pagamento?, documento?}], justificativa}. A parcela em aberto vira CANCELADA e nascem as novas (em aberto, com o
   * número dela e `parcela_origem_id`), que somam o mesmo (valor vazio = divisão igual do que falta: FinancialService).
   * O recebimento da venda com dedução descontada pelo comprador e a própria dedução não se desdobram (o encontro de contas
   * é pelo vencimento).
   */
  function tratadorDesdobrar_(tx) {
    var d = tx.dados || {};
    var col = Validation.coletor();
    if (vazio_(d.parcela_id)) return { erros: [det_('CAMPO_OBRIGATORIO', 'parcela_id', 'Escolha a parcela.')] };
    if (vazio_(d.justificativa)) col.erro(det_('CAMPO_OBRIGATORIO', 'justificativa', 'Diga por que a parcela está sendo dividida ou remarcada.'));
    var alvo = parcelaQueVale_(tx, d.parcela_id);
    var p = alvo.p;
    var quem = quemParcela_(tx, alvo) + ': ';
    if (p.status !== 'ABERTA') col.erro(det_('PARCELA_JA_PAGA', 'parcela_id', quem + 'já está paga; só a parcela em aberto se divide.'));
    if (alvo.fin.retida_pelo_comprador === true || retidasDoRecebimento_(tx, alvo.fin, p).length) col.erro(det_('PARCELA_RETIDA', 'parcela_id', quem + 'tem dedução descontada pelo comprador no mesmo vencimento (encontro de contas): não se divide.'));
    else if (!tituloLivre_(tx, alvo.fin, alvo.ev)) col.erro(det_('TITULO_EM_PARTES_IGUAIS', 'parcela_id', quem + EM_PARTES_IGUAIS));
    var lista = Array.isArray(d.parcelas) ? d.parcelas : [];
    // Em N parcelas iguais (a folha "Dividir" da tela): os vencimentos vêm do servidor (financeiro.vencimentos; o aparelho não
    // soma dias), e o valor de cada uma, da divisão igual (FinancialService.resolverParcelas).
    if (!lista.length && !vazio_(d.quantas)) lista = FinancialService.vencimentos({ primeiro: d.primeiro, quantas: d.quantas, intervalo: vazio_(d.intervalo) ? 'MES' : d.intervalo }).datas.map(function (dt) { return { data_vencimento: dt, forma_pagamento: nulo_(d.forma_pagamento) }; });
    lista.forEach(function (x, i) { if (x && typeof x === 'object' && !vazio_(x.forma_pagamento)) conferirForma_(tx, col, x.forma_pagamento, 'Parcela ' + (i + 1) + ': '); });
    var novas = FinancialService.resolverParcelas(p.valor, lista, col, { campo: 'parcelas', rotulo: 'a parcela', pagamento: 'será dividida' });
    if (novas && novas.length === 1 && novas[0].data_vencimento === p.data_vencimento) col.erro(det_('VALOR_IGUAL', 'parcelas', quem + 'a parcela nova é igual à de hoje (o mesmo valor e o mesmo vencimento): mude o vencimento ou divida em mais de uma.'));
    var outras = tx.repo.por('PARCELAS', 'financial_id', p.financial_id).length;
    if (novas && outras - 1 + novas.length > FinancialService.MAX_PARCELAS) col.erro(det_('PARCELAS_DEMAIS', 'parcelas', 'Um lançamento aceita até ' + FinancialService.MAX_PARCELAS + ' parcelas.'));
    if (col.temErros() || !novas) return { erros: col.erros };
    AuditService.alteracao(tx, 'PARCELAS', p.parcela_id, { status: 'CANCELADA' }, d.justificativa);
    var ids = [p.parcela_id];
    var criadas = novas.map(function (n) {
      var id = tx.novoId();
      AuditService.criacao(tx, 'PARCELAS', id, { financial_id: p.financial_id, parcela_num: p.parcela_num, data_vencimento: n.data_vencimento, valor: n.valor, status: 'ABERTA', forma_pagamento: nulo_(n.forma_pagamento) || nulo_(p.forma_pagamento), parcela_origem_id: p.parcela_id, documento: nulo_(n.documento) || nulo_(p.documento) }, d.justificativa);
      ids.push(id);
      return { parcela_id: id, data_vencimento: n.data_vencimento, valor: n.valor };
    });
    return {
      avisos: [],
      resumo: { acao: 'desdobrar', parcelas: ids },
      impactos: { acao: 'desdobrar', parcela_id: p.parcela_id, lancamento: nomeDoLancamento_(tx, alvo.fin), valor: p.valor, data_vencimento: p.data_vencimento, novas: criadas },
      derivados: { eventos: [alvo.fin.event_id] },
      resposta: function (t) { return respostaParcelas_(t, ids); },
    };
  }

  function comandoBaixar(pedido) {
    return comando_('parcela.baixar', pedido, tratadorBaixar_, function (tx, op) { return respostaParcelas_(tx, (op.resumo || {}).parcelas); });
  }
  function comandoDesfazerBaixa(pedido) {
    return comando_('parcela.desfazerBaixa', pedido, tratadorDesfazer_, function (tx, op) { return respostaParcelas_(tx, (op.resumo || {}).parcelas); });
  }
  function comandoDesdobrar(pedido) {
    return comando_('parcela.desdobrar', pedido, tratadorDesdobrar_, function (tx, op) { return respostaParcelas_(tx, (op.resumo || {}).parcelas); });
  }
  var COMANDOS = { baixar: comandoBaixar, desfazerBaixa: comandoDesfazerBaixa, desdobrar: comandoDesdobrar };
  /** A prévia (rota extra `parcela.simular`): pedido.acao = baixar | desfazerBaixa | desdobrar; o mesmo tratador, sem gravar. */
  function simular(ctx, pedido) {
    var p = pedido || {};
    if (!COMANDOS[p.acao]) throw Validation.erro('VALIDATION', 'Escolha o que simular: baixar, desfazer a baixa ou dividir a parcela.', [det_('VALOR_FORA_DA_LISTA', 'acao', 'Ação desconhecida.')]);
    var c = COMANDOS[p.acao]({ dados: p.dados, avisosAceitos: p.avisosAceitos, idempotencyKey: 'simulacao' });
    c.modo = 'SIMULAR';
    return UnitOfWork.run(ctx, c);
  }
  function baixar(ctx, pedido) { return UnitOfWork.run(ctx, comandoBaixar(pedido)); }
  function desfazerBaixa(ctx, pedido) { return UnitOfWork.run(ctx, comandoDesfazerBaixa(pedido)); }
  function desdobrar(ctx, pedido) { return UnitOfWork.run(ctx, comandoDesdobrar(pedido)); }

  // ------------------------------------------------------------------ períodos ----
  function fimDoMes_(d) {
    return Utils.somaDias(Utils.somaMeses(d.slice(0, 7) + '-01', 1), -1);
  }
  /** O dia da semana (0 = segunda … 6 = domingo) de uma data yyyy-MM-dd. */
  function diaDaSemana_(d) {
    var w = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))).getUTCDay();
    return (w + 6) % 7;
  }
  function inicioDaSemana_(d) { return Utils.somaDias(d, -diaDaSemana_(d)); }
  function rotuloPeriodo_(agrupar, ini, fim) {
    if (agrupar === 'DIA') return br_(ini);
    if (agrupar === 'MES') return MESES[Number(ini.slice(5, 7)) - 1] + '/' + ini.slice(0, 4);
    return br_(ini).slice(0, 5) + ' a ' + br_(fim).slice(0, 5);
  }
  /** Os períodos de `de` a `ate` (inclusivos), cortados nas pontas: [{inicio, fim, rotulo}]. */
  function periodos(de, ate, agrupar) {
    var out = [];
    var ini = de;
    for (var guarda = 0; ini <= ate && guarda <= MAX_PERIODOS; guarda++) {
      var fim = agrupar === 'DIA' ? ini : agrupar === 'SEMANA' ? Utils.somaDias(inicioDaSemana_(ini), 6) : fimDoMes_(ini);
      if (fim > ate) fim = ate;
      out.push({ inicio: ini, fim: fim, rotulo: rotuloPeriodo_(agrupar, ini, fim) });
      ini = Utils.somaDias(fim, 1);
    }
    return out;
  }
  /** O período padrão em volta de D: 12 meses (5 antes, 6 depois), 13 semanas (4 antes, 8 depois) ou 30 dias (6 antes). */
  function padrao_(D, agrupar) {
    if (agrupar === 'DIA') return { de: Utils.somaDias(D, -6), ate: Utils.somaDias(D, 23) };
    if (agrupar === 'SEMANA') { var s = inicioDaSemana_(D); return { de: Utils.somaDias(s, -28), ate: Utils.somaDias(s, 62) }; }
    var m0 = D.slice(0, 7) + '-01';
    return { de: mesDeslocado_(m0, -5), ate: fimDoMes_(mesDeslocado_(m0, 6)) };
  }
  /** O primeiro dia do mês `n` meses depois (ou antes, com n negativo) do mês de `m0` (yyyy-MM-01). */
  function mesDeslocado_(m0, n) {
    var mo = Number(m0.slice(5, 7)) - 1 + n;
    var y = Number(m0.slice(0, 4)) + Math.floor(mo / 12);
    mo = ((mo % 12) + 12) % 12;
    return String(y) + '-' + (mo < 9 ? '0' : '') + String(mo + 1) + '-01';
  }

  // ------------------------------------------------------------------ fluxo de caixa ----
  /** O saldo inicial informado pelo dono (a observação): {valor (centavos), data (o começo do dia)} ou null. */
  function saldoInicial_(params) {
    var v = params.caixa_saldo_inicial;
    var d = params.caixa_saldo_inicial_data;
    if (typeof v !== 'number' || !isFinite(v) || vazio_(d) || !Utils.dataValida(d)) return null;
    return { valor: Math.round(v * 100), data: d };
  }
  /**
   * Os movimentos em D: o realizado (cada parcela paga até D, pelo valor pago e na data do pagamento) e o previsto (cada
   * parcela em aberto em D, pelo nominal e no vencimento). {pagos: [{data, valor, tipo}], abertos: [{data, valor, tipo}]}.
   */
  function movimentosEm_(tx, D) {
    var pagos = [];
    var abertos = [];
    lancamentosAte_(tx, D).forEach(function (fin) {
      parcelasEm(tx, fin, D).forEach(function (x) {
        if (x.paga) pagos.push({ data: x.p.data_pagamento, valor: x.p.valor_pago || 0, tipo: fin.tipo });
        else abertos.push({ data: x.p.data_vencimento, valor: x.p.valor || 0, tipo: fin.tipo });
      });
    });
    return { pagos: pagos, abertos: abertos };
  }
  function somar_(lista, de, ate) {
    var o = { entradas: 0, saidas: 0, liquido: 0 };
    lista.forEach(function (x) {
      if ((de !== null && x.data < de) || (ate !== null && x.data > ate)) return;
      if (x.tipo === 'RECEITA') o.entradas += x.valor; else o.saidas += x.valor;
    });
    o.liquido = o.entradas - o.saidas;
    return o;
  }
  /**
   * O fluxo de caixa em D (07, seção 2.1): de cada período, o realizado (os pagamentos até D) e o previsto (as parcelas em
   * aberto em D que vencem no período, a partir de D; as vencidas antes de D ficam à parte, em "vencidos"), e o saldo no fim
   * do período — o realizado até o fim dele (no passado) ou o de D mais o previsto até o fim dele (no futuro), a partir do saldo
   * inicial informado. dados: {data (D; padrão hoje), de, ate, agrupar (DIA|SEMANA|MES; padrão MES)}.
   */
  function fluxo(tx, dados) {
    var o = dados || {};
    var D = vazio_(o.data) ? tx.hoje : o.data;
    if (typeof D !== 'string' || !Utils.dataValida(D)) throw validacao_('Informe a data de referência como uma data válida (aaaa-mm-dd).', 'data');
    if (!vazio_(tx.hoje) && D > tx.hoje) throw validacao_('O fluxo de caixa é pedido até hoje: escolha hoje ou uma data passada (o previsto já mostra o que vem depois).', 'data', 'DATA_FUTURA');
    var agrupar = vazio_(o.agrupar) ? 'MES' : o.agrupar;
    if (AGRUPAMENTOS.indexOf(agrupar) < 0) throw validacao_('Agrupe por dia, semana ou mês.', 'agrupar', 'VALOR_FORA_DA_LISTA');
    var pd = padrao_(D, agrupar);
    var de = vazio_(o.de) ? pd.de : o.de;
    var ate = vazio_(o.ate) ? pd.ate : o.ate;
    ['de', 'ate'].forEach(function (k) { var v = k === 'de' ? de : ate; if (typeof v !== 'string' || !Utils.dataValida(v)) throw validacao_('Informe "' + (k === 'de' ? 'de' : 'até') + '" como uma data válida (aaaa-mm-dd).', k); });
    if (de > ate) throw validacao_('O início do período (' + br_(de) + ') é depois do fim (' + br_(ate) + ').', 'de', 'PERIODO_INVERTIDO');
    var lista = periodos(de, ate, agrupar);
    if (lista.length > MAX_PERIODOS) throw validacao_('Período longo demais para o agrupamento: até ' + MAX_PERIODOS + ' linhas. Agrupe por semana ou por mês.', 'ate', 'VALOR_FORA_DA_FAIXA');
    var params = Config.parametros(tx.repo);
    var mv = movimentosEm_(tx, D);
    var si = saldoInicial_(params);
    // A observação do saldo é um fato da data dela: numa data D anterior a ela, não existe (nem o valor, nem a data).
    if (si && Utils.somaDias(si.data, -1) > D) si = null;
    var vespera = si ? Utils.somaDias(si.data, -1) : null;
    function saldoRealizado(d) {
      if (!si || d < vespera) return null;
      return si.valor + somar_(mv.pagos, si.data, d).liquido;
    }
    var saldoD = saldoRealizado(D);
    var previstos = mv.abertos.filter(function (x) { return x.data >= D; });
    var vencidos = somar_(mv.abertos.filter(function (x) { return x.data < D; }), null, null);
    var periodosOut = lista.map(function (pp) {
      var realizado = somar_(mv.pagos, pp.inicio, pp.fim < D ? pp.fim : D);
      if (pp.inicio > D) realizado = { entradas: 0, saidas: 0, liquido: 0 };
      var previsto = somar_(previstos, pp.inicio, pp.fim);
      var saldoFim = pp.fim < D ? saldoRealizado(pp.fim) : saldoD === null ? null : saldoD + somar_(previstos, D, pp.fim).liquido;
      return {
        inicio: pp.inicio, fim: pp.fim, rotulo: pp.rotulo, situacao: pp.fim < D ? 'PASSADO' : pp.inicio > D ? 'FUTURO' : 'ATUAL',
        realizado: realizado, previsto: previsto, liquido: realizado.liquido + previsto.liquido, saldo_fim: saldoFim,
      };
    });
    var semSaldo = si ? null : 'Sem o saldo de caixa inicial informado até esta data (o valor e a data, nas configurações), o fluxo mostra o movimento, sem o saldo.';
    return {
      data: D, de: de, ate: ate, agrupar: agrupar,
      saldo_inicial: si,
      // O movimento lançado com data anterior à do saldo informado: muda com o pagamento retroativo; o saldo observado, nunca.
      movimento_antes_do_saldo: si ? somar_(mv.pagos, null, vespera).liquido : null,
      saldo: saldoD === null ? { valor: null, motivo: 'DADOS_INSUFICIENTES', mensagem: semSaldo } : { valor: saldoD, motivo: null, mensagem: null },
      realizado: somar_(mv.pagos, de, ate < D ? ate : D),
      previsto: somar_(previstos, de, ate),
      vencidos: { a_receber: vencidos.entradas, a_pagar: vencidos.saidas },
      periodos: periodosOut,
    };
  }
  /** Consulta `financeiro.fluxoCaixa` (rota canônica; 08, seção 3, "Financeiro: fluxo e resultado"). */
  function consultaFluxo(dados) {
    var o = dados || {};
    return { rota: 'financeiro.fluxoCaixa', dados: o, reads: leituras(), acessoCru: true, tratador: function (tx) { return fluxo(tx, o); } };
  }
  function fluxoCaixa(ctx, dados) {
    return UnitOfWork.read(ctx, consultaFluxo(dados));
  }

  // ------------------------------------------------------------------ títulos ----
  /**
   * Os títulos a pagar e a receber em D (rota extra `financeiro.titulos`; 08, seção 3, "Financeiro: parcelas"): as parcelas em
   * aberto em D (todas, as vencidas antes de D ou as que vencem de D em diante) ou as pagas no período (`PAGOS`), com o
   * lançamento, o parceiro, os dias de atraso em D, o encontro de contas da venda (as deduções retidas e o depósito esperado)
   * e, só quando D é hoje, o que dá para fazer (baixar, desfazer, dividir). dados: {data (padrão hoje), situacao (ABERTOS |
   * VENCIDOS | A_VENCER | PAGOS; padrão ABERTOS), tipo (RECEITA | DESPESA), de, ate (o vencimento, ou o pagamento em PAGOS),
   * partner_id, busca}.
   */
  function titulos(tx, dados) {
    var o = dados || {};
    var D = vazio_(o.data) ? tx.hoje : o.data;
    if (typeof D !== 'string' || !Utils.dataValida(D)) throw validacao_('Informe a data de referência como uma data válida (aaaa-mm-dd).', 'data');
    if (!vazio_(tx.hoje) && D > tx.hoje) throw validacao_('Os títulos são pedidos até hoje: escolha hoje ou uma data passada.', 'data', 'DATA_FUTURA');
    var situacao = vazio_(o.situacao) ? 'ABERTOS' : o.situacao;
    if (SITUACOES_TITULOS.indexOf(situacao) < 0) throw validacao_('Escolha entre em aberto, vencidos, a vencer e pagos.', 'situacao', 'VALOR_FORA_DA_LISTA');
    if (!vazio_(o.tipo) && o.tipo !== 'RECEITA' && o.tipo !== 'DESPESA') throw validacao_('Escolha a receber ou a pagar.', 'tipo', 'VALOR_FORA_DA_LISTA');
    ['de', 'ate'].forEach(function (k) { if (!vazio_(o[k]) && (typeof o[k] !== 'string' || !Utils.dataValida(o[k]))) throw validacao_('Informe "' + (k === 'de' ? 'de' : 'até') + '" como uma data válida (aaaa-mm-dd).', k); });
    if (!vazio_(o.de) && !vazio_(o.ate) && o.de > o.ate) throw validacao_('O início (' + br_(o.de) + ') é depois do fim (' + br_(o.ate) + ').', 'de', 'PERIODO_INVERTIDO');
    var hoje = D === tx.hoje;
    var busca = vazio_(o.busca) ? null : Utils.normalizarTexto(String(o.busca));
    var itens = [];
    var totais = { a_receber: 0, a_pagar: 0, vencido_receber: 0, vencido_pagar: 0, recebido: 0, pago: 0 };
    lancamentosAte_(tx, D).forEach(function (fin) {
      if (!vazio_(o.tipo) && fin.tipo !== o.tipo) return;
      if (!vazio_(o.partner_id) && fin.partner_id !== o.partner_id) return;
      var conta = tx.repo.porId('PLANO_CONTAS', fin.conta_id) || {};
      var ev = tx.repo.porId('EVENTOS', fin.event_id) || {};
      var nome = nomeDoLancamento_(tx, fin);
      if (busca !== null) {
        var texto = [nome, fin.documento || '', conta.nome || ''].join(' ');
        if (Utils.normalizarTexto(texto).indexOf(busca) < 0) return;
      }
      var parceiro = vazio_(fin.partner_id) ? null : (tx.repo.porId('PARCEIROS', fin.partner_id) || {}).nome || null;
      var todas = parcelasEm(tx, fin, D);
      todas.forEach(function (x) {
        var p = x.p;
        var vencida = !x.paga && p.data_vencimento < D;
        var receita = fin.tipo === 'RECEITA';
        if (x.paga) { if (receita) totais.recebido += p.valor_pago || 0; else totais.pago += p.valor_pago || 0; }
        else { if (receita) totais.a_receber += p.valor; else totais.a_pagar += p.valor; if (vencida) { if (receita) totais.vencido_receber += p.valor; else totais.vencido_pagar += p.valor; } }
        var quer = situacao === 'PAGOS' ? x.paga : !x.paga && (situacao === 'ABERTOS' || (situacao === 'VENCIDOS' ? vencida : !vencida));
        if (!quer) return;
        var ref = situacao === 'PAGOS' ? p.data_pagamento : p.data_vencimento;
        if ((!vazio_(o.de) && ref < o.de) || (!vazio_(o.ate) && ref > o.ate)) return;
        var retidas = retidasDoRecebimento_(tx, fin, p).filter(function (r) { return parcelasEm(tx, r.fin, D).some(function (y) { return y.p.parcela_id === r.p.parcela_id; }); });
        var retido = retidas.reduce(function (s, r) { return s + r.p.valor; }, 0);
        var item = {
          parcela_id: p.parcela_id, financial_id: fin.financial_id, event_id: fin.event_id, event_type: ev.event_type || null, lancamento: nome,
          conta_nome: conta.nome || null, natureza: fin.natureza, tipo: fin.tipo, parceiro: parceiro, partner_id: nulo_(fin.partner_id),
          parcela_num: p.parcela_num, parcelas_do_lancamento: todas.length, data_vencimento: p.data_vencimento, valor: p.valor,
          situacao: x.paga ? (receita ? 'RECEBIDA' : 'PAGA') : vencida ? 'VENCIDA' : p.data_vencimento === D ? 'VENCE_HOJE' : 'A_VENCER',
          dias_atraso: vencida ? Utils.diffDias(p.data_vencimento, D) : 0,
          data_pagamento: x.paga ? p.data_pagamento : null, valor_pago: x.paga ? p.valor_pago : null, juros_multa: x.paga ? nulo_(p.juros_multa) : null,
          // A forma da parcela em aberto em D não vem: a baixa posterior a regrava (a forma do pagamento é a da parcela paga).
          desconto: x.paga ? nulo_(p.desconto) : null, forma_pagamento: x.paga ? nulo_(p.forma_pagamento) : null, documento: nulo_(p.documento),
          retida_pelo_comprador: fin.retida_pelo_comprador === true,
          deducoes_retidas: retido || null, deposito_esperado: retido ? p.valor - retido : null,
        };
        if (hoje) {
          var retida = fin.retida_pelo_comprador === true;
          var livre = tituloLivre_(tx, fin, ev);
          item.acoes = {
            baixar: !x.paga && !retida, desfazer: x.paga && !retida, dividir: !x.paga && !retida && !retidas.length && livre, parcial: !x.paga && !retida && !retidas.length && livre,
            motivo: retida ? 'Descontada pelo comprador: é quitada junto com o recebimento da venda.' : null,
          };
        }
        itens.push(item);
      });
    });
    itens.sort(function (a, b) {
      var x = situacao === 'PAGOS' ? b.data_pagamento : a.data_vencimento;
      var y = situacao === 'PAGOS' ? a.data_pagamento : b.data_vencimento;
      return x < y ? -1 : x > y ? 1 : a.lancamento < b.lancamento ? -1 : a.lancamento > b.lancamento ? 1 : a.parcela_num - b.parcela_num || (a.parcela_id < b.parcela_id ? -1 : 1);
    });
    var soma = function (tipo) { return itens.filter(function (i) { return i.tipo === tipo; }).reduce(function (s, i) { return s + (situacao === 'PAGOS' ? i.valor_pago || 0 : i.valor); }, 0); };
    return { data: D, hoje: hoje, situacao: situacao, totais: totais, total: itens.length, soma_receitas: soma('RECEITA'), soma_despesas: soma('DESPESA'), itens: itens };
  }
  /** Consulta `financeiro.titulos` (rota extra; CONTRATOS, seção 56). */
  function consultaTitulos(dados) {
    var o = dados || {};
    return { rota: 'financeiro.titulos', dados: o, reads: leituras(), acessoCru: true, tratador: function (tx) { return titulos(tx, o); } };
  }
  function listarTitulos(ctx, dados) {
    return UnitOfWork.read(ctx, consultaTitulos(dados));
  }

  return {
    AGRUPAMENTOS: AGRUPAMENTOS,
    leituras: leituras,
    parcelasEm: parcelasEm,
    periodos: periodos,
    comandoBaixar: comandoBaixar,
    comandoDesfazerBaixa: comandoDesfazerBaixa,
    comandoDesdobrar: comandoDesdobrar,
    baixar: baixar,
    desfazerBaixa: desfazerBaixa,
    desdobrar: desdobrar,
    simular: simular,
    fluxo: fluxo,
    consultaFluxo: consultaFluxo,
    fluxoCaixa: fluxoCaixa,
    titulos: titulos,
    consultaTitulos: consultaTitulos,
    listarTitulos: listarTitulos,
  };
})();
