/**
 * HealthService — sanidade e insumos (03a, seções 4.6, 4.7 e 4.9; 03b, seções 6 e 15.2; 05, seções 2.8 e 4.7 a 4.8;
 * 07, seções 5 e 8.4). Puro: lê pela unidade (`tx.repo`, `tx.cru`) e pelo leitor do AnimalService, nunca pelo relógio
 * nem pela planilha. O sistema registra e alerta; não prescreve (§10): nenhum protocolo vem de fábrica, a dose e a
 * carência são as que o veterinário e o dono decidem.
 *
 * Aqui ficam as regras que o motor de eventos, a verificação de integridade, a agenda e a ficha usam por igual (uma regra,
 * um lugar): o valor do consumo, o custo unitário da entrada, o saldo do estoque por data, a carência, o vencimento de
 * cada protocolo e a elegibilidade (RN-058); e os cadastros `produto.salvar` e `protocolo.salvar`, a consulta
 * `sanidade.agenda` e o bloco F da ficha.
 */
var HealthService = (function () {
  /** Subtipo do evento SANIDADE → SANIDADE.tipo_procedimento (03a, SUBTIPO_EVENTO; 03b, seção 2.4). */
  var PROCEDIMENTO = Object.freeze({ VACINACAO: 'VACINA', VERMIFUGACAO: 'VERMIFUGO', MEDICACAO: 'MEDICAMENTO', TRATAMENTO: 'TRATAMENTO', EXAME: 'EXAME', DOENCA: 'DOENCA' });
  /** Os subtipos que aplicam produto: o nome do produto é obrigatório (03b, seção 6). */
  var COM_PRODUTO_OBRIGATORIO = Object.freeze(['VACINACAO', 'VERMIFUGACAO', 'MEDICACAO']);
  /** Conta do consumo pela categoria do produto (03a, seção 4.13, DL-12; 07, seção 5). */
  var CONTA_DA_CATEGORIA = Object.freeze({ VACINA: 'VACINAS', VERMIFUGO: 'MEDICAMENTOS', MEDICAMENTO: 'MEDICAMENTOS', SUPLEMENTO: 'ALIMENTACAO', OUTRO: 'TRATAMENTOS' });
  var NOME_CATEGORIA = Object.freeze({ VACINA: 'vacina', VERMIFUGO: 'vermífugo', MEDICAMENTO: 'medicamento', SUPLEMENTO: 'suplemento', OUTRO: 'insumo' });
  var MODOS_DOSE = Object.freeze(['POR_CABECA', 'POR_PESO', 'TOTAL']);
  /** Por que se acerta o estoque (ESTOQUE/AJUSTE): pela contagem (saldo contado), por perda ou quebra, por vencimento. */
  var MOTIVOS_AJUSTE = Object.freeze(['CONTAGEM', 'PERDA', 'VENCIMENTO']);
  var SITUACOES_AGENDA = Object.freeze(['VENCIDA', 'PROXIMA']);
  var LEITURAS_CADASTRO = Object.freeze(['PRODUTOS', 'PROTOCOLOS_SANITARIOS', 'MOVIMENTOS_ESTOQUE', 'SANIDADE', 'CATEGORIAS']);

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function nulo_(v) {
    return vazio_(v) ? null : v;
  }
  function br_(d) {
    return vazio_(d) ? '' : d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
  }
  function num_(v) {
    return typeof v === 'number' && isFinite(v);
  }
  function det_(codigo, campo, mensagem) {
    return Validation.detalhe({ codigo: codigo, campo: campo, mensagem: mensagem });
  }

  // ------------------------------------------------------------------ carência (RN-072) ----
  /**
   * Último dia de carência de uma aplicação (05, seção 4.8): `data_fim_carencia` gravada ou, sem ela, `data_aplicacao`
   * + `periodo_carencia_dias`. Sem aplicação válida ou sem período positivo → null (não há carência).
   * Vermífugo em 01/11/2026 com 35 dias → carência até 06/12/2026.
   */
  function fimCarencia(registro) {
    var r = registro || {};
    if (!vazio_(r.data_fim_carencia) && Utils.dataValida(r.data_fim_carencia)) return r.data_fim_carencia;
    return fimPeloPeriodo(r.data_aplicacao, r.periodo_carencia_dias);
  }
  /** `data_aplicacao` + `periodo_carencia_dias` (inteiro > 0), a conta que a aplicação grava e a integridade refaz; senão null. */
  function fimPeloPeriodo(dataAplicacao, dias) {
    if (vazio_(dataAplicacao) || !Utils.dataValida(dataAplicacao)) return null;
    if (!num_(dias) || Math.floor(dias) !== dias || dias <= 0) return null;
    return Utils.somaDias(dataAplicacao, dias);
  }
  /**
   * Carência vigente na data D (fim do dia): entre as aplicações até D, a de maior fim de carência, se o fim é ≥ D
   * (em carência se D ≤ C; 05, seção 4.8). registros = linhas de SANIDADE de UM animal. Devolve {fim, health_id,
   * event_id, nome_produto, data_aplicacao, tipo_procedimento} ou null (livre). Data inválida → INTERNAL.
   */
  function carenciaEm(registros, data) {
    if (vazio_(data) || !Utils.dataValida(data)) throw Validation.erro('INTERNAL', 'carenciaEm precisa de uma data válida.');
    var melhor = null;
    (registros || []).forEach(function (r) {
      if (!r || vazio_(r.data_aplicacao) || r.data_aplicacao > data) return;
      var fim = fimCarencia(r);
      if (fim === null || fim < data) return;
      if (!melhor || fim > melhor.fim || (fim === melhor.fim && r.data_aplicacao > melhor.data_aplicacao)) {
        melhor = { fim: fim, health_id: r.health_id || null, event_id: r.event_id || null, nome_produto: vazio_(r.nome_produto) ? null : r.nome_produto, data_aplicacao: r.data_aplicacao, tipo_procedimento: r.tipo_procedimento || null };
      }
    });
    return melhor;
  }

  // ------------------------------------------------------------------ consumo e estoque ----
  /**
   * Valor do consumo de uma aplicação (03b, seção 15.2; 07, seção 5): quantidade consumida × custo unitário congelado,
   * em centavos inteiros, meio para cima. 5 doses × R$ 1,85 = 925 centavos; 8 mL × R$ 0,035 = 28. Sem custo (vazio ou 0)
   * → 0 (o consumo não gera lançamento).
   */
  function valorConsumo(quantidade, custoUnitario) {
    if (!num_(quantidade) || !num_(custoUnitario) || quantidade <= 0 || custoUnitario <= 0) return 0;
    return Utils.arredondar(quantidade * custoUnitario * 100, 0);
  }
  /** Custo unitário (R$ por unidade de dose, 4 casas) de uma entrada de estoque: valor da compra ÷ quantidade. */
  function custoUnitarioEntrada(valorCentavos, quantidade) {
    if (!num_(valorCentavos) || !num_(quantidade) || quantidade <= 0) return null;
    return Utils.arredondar(valorCentavos / 100 / quantidade, 4);
  }
  /** Variação do saldo de um movimento (03a, seção 4.7; DL-15): ENTRADA +, SAIDA −, AJUSTE com o próprio sinal. */
  function variacao(mov) {
    var q = num_(mov && mov.quantidade) ? mov.quantidade : 0;
    if (mov.tipo === 'SAIDA') return -q;
    return q;
  }
  /** Soma exata em décimos de milésimo (as quantidades têm até 4 casas). */
  function somaQtd_(lista) {
    var t = 0;
    lista.forEach(function (m) { t += Math.round(variacao(m) * 10000); });
    return t / 10000;
  }
  /** Saldo pelos movimentos até a data (inclusive); sem data, todos (`PRODUTOS.estoque_atual*` = Σ dos vigentes). */
  function saldo(movimentos, ate) {
    return somaQtd_((movimentos || []).filter(function (m) { return vazio_(ate) || m.data <= ate; }));
  }
  /**
   * O menor saldo ao longo do tempo (fim de cada dia em que há movimento; no mesmo dia, as entradas antes das saídas) e
   * a data em que ele acontece: {saldo, data} — {0, null} sem movimento. A regra do aviso ESTOQUE_INSUFICIENTE (RN-057).
   */
  function menorSaldo(movimentos) {
    var porDia = {};
    (movimentos || []).forEach(function (m) { (porDia[m.data] = porDia[m.data] || []).push(m); });
    var dias = Object.keys(porDia).sort();
    var corrente = 0;
    var menor = { saldo: 0, data: null };
    dias.forEach(function (d) {
      corrente += Math.round(somaQtd_(porDia[d]) * 10000);
      if (corrente / 10000 < menor.saldo) menor = { saldo: corrente / 10000, data: d };
    });
    return menor;
  }
  /**
   * As contagens vigentes do produto (ESTOQUE/AJUSTE pela contagem; 03a, MOVIMENTOS_ESTOQUE, AJUSTE: "correção do saldo pela
   * contagem", o saldo no fim do dia contado é o contado): [{event_id, data, saldo_contado, quantidade}], sem as de `excluidos`.
   */
  function contagensDoProduto(repo, productId, excluidos) {
    if (!repo.carregada('MOVIMENTOS_ESTOQUE') || !repo.carregada('EVENTOS')) return [];
    return movimentosDoProduto(repo, productId, excluidos).filter(function (m) { return m.tipo === 'AJUSTE'; }).map(function (m) {
      var ev = repo.porId('EVENTOS', m.event_id);
      var pj = (ev && ev.payload_json) || {};
      return pj.motivo_ajuste === 'CONTAGEM' && typeof pj.saldo_contado === 'number' ? { event_id: m.event_id, data: m.data, saldo_contado: pj.saldo_contado, quantidade: m.quantidade } : null;
    }).filter(Boolean).sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });
  }
  /**
   * A primeira contagem cujo saldo no fim do dia contado muda entre os movimentos de antes e os de depois de um comando (o
   * movimento retroativo, a correção que muda a quantidade, o estorno, a contagem anterior a ela); null sem nenhuma. O acerto
   * gravou a diferença para o saldo daquele dia: o movimento que muda esse saldo depois desfaria o que foi contado (RN-057).
   */
  function contagemAfetada(contagens, antes, depois) {
    return (contagens || []).filter(function (c) { return saldo(antes, c.data) !== saldo(depois, c.data); })[0] || null;
  }
  /** Projeção `PRODUTOS.estoque_atual*` (03a, seção 4.6): Σ movimentos vigentes com `controla_estoque = S`; vazio sem controle. */
  function estoqueAtual(produto, movimentos) {
    if (!produto || produto.controla_estoque !== true) return null;
    return saldo(movimentos, null);
  }
  /** A quantidade com a unidade, para as mensagens: "5 doses", "1 dose", "8 mL". */
  function quantidadeTexto(q, unidade) {
    var u = vazio_(unidade) ? '' : String(unidade);
    var plural = u === 'dose' && q !== 1 && q !== -1 ? 'doses' : u;
    return Utils.formatarNumero(q) + (plural ? ' ' + plural : '');
  }
  /** "Consumo de vacina: 5 doses" (03b, seção 15.2). */
  function descricaoConsumo(produto, q) {
    return 'Consumo de ' + (NOME_CATEGORIA[produto.categoria] || 'insumo') + ': ' + quantidadeTexto(q, produto.unidade);
  }

  // ------------------------------------------------------------------ protocolos e agenda (RN-058, RN-059) ----
  /** Primeiro dia em que o animal tem `meses` completos (Utils.idadeMeses; o nascido em 31/01 completa 1 mês em 01/03). */
  function completaMeses_(nascimento, meses) {
    var d = Utils.somaMeses(nascimento, meses);
    for (var i = 0; i < 4 && Utils.idadeMeses(nascimento, d) < meses; i++) d = Utils.somaDias(d, 1);
    return d;
  }
  function ultimoDiaDoMes_(ano, mes) {
    var prox = mes === 12 ? String(ano + 1) + '-01-01' : String(ano) + '-' + (mes + 1 < 10 ? '0' : '') + (mes + 1) + '-01';
    return Utils.somaDias(prox, -1);
  }
  function primeiroDiaDoMes_(ano, mes) {
    return String(ano) + '-' + (mes < 10 ? '0' : '') + mes + '-01';
  }
  function antecedencia_(protocolo, params) {
    return protocolo && num_(protocolo.antecedencia_alerta_dias) ? protocolo.antecedencia_alerta_dias : num_(params.agenda_antecedencia_dias) ? params.agenda_antecedencia_dias : 15;
  }
  function tolerancia_(protocolo, params) {
    return protocolo && num_(protocolo.tolerancia_dias) ? protocolo.tolerancia_dias : num_(params.agenda_tolerancia_dias) ? params.agenda_tolerancia_dias : 7;
  }
  function inicioProtocolo_(p) {
    return typeof p.created_at === 'string' && p.created_at.length >= 10 ? p.created_at.slice(0, 10) : null;
  }
  /**
   * O animal é elegível ao protocolo na data D (05, seção 4.7)? perfil: {sexo, data_nascimento, category_id (categoria
   * em D), no_rebanho_desde}. Sexo AMBOS ou igual; idade em meses completos em [mínima, máxima) — com faixa, o nascimento
   * precisa ser conhecido —; a categoria do protocolo, quando há, é a do animal em D. Quem já passou da idade máxima de um
   * protocolo de aplicação única continua devendo a aplicação se esteve dentro da faixa, no rebanho, depois que o protocolo
   * foi cadastrado (`devendo`): a pendência fica vencida até a aplicação. Devolve {elegivel, devendo}.
   */
  function elegibilidade(protocolo, perfil, data) {
    var p = protocolo;
    var a = perfil || {};
    var nao = { elegivel: false, devendo: false };
    if (!p || p.ativo === false) return nao;
    if (p.sexo_aplicavel !== 'AMBOS' && p.sexo_aplicavel !== a.sexo) return nao;
    if (!vazio_(p.category_id) && p.category_id !== a.category_id) return nao;
    var min = num_(p.idade_min_meses) ? p.idade_min_meses : null;
    var max = num_(p.idade_max_meses) ? p.idade_max_meses : null;
    if (min === null && max === null) return { elegivel: true, devendo: false };
    if (vazio_(a.data_nascimento) || !Utils.dataValida(a.data_nascimento) || a.data_nascimento > data) return nao;
    var idade = Utils.idadeMeses(a.data_nascimento, data);
    if (min !== null && idade < min) return nao;
    if (max === null || idade < max) return { elegivel: true, devendo: false };
    if (p.recorrencia_tipo !== 'UNICA') return nao;
    var fimFaixa = completaMeses_(a.data_nascimento, max);
    var comeco = [min !== null ? completaMeses_(a.data_nascimento, min) : a.data_nascimento, a.no_rebanho_desde, inicioProtocolo_(p)].filter(Boolean).sort().pop();
    return comeco && comeco < fimFaixa ? { elegivel: true, devendo: true } : nao;
  }
  /**
   * Vencimento do protocolo para um animal elegível em D (03a, seção 4.9, DL-16) e se as aplicações o cumprem.
   * aplicacoes = linhas vigentes de SANIDADE do animal com este protocol_id e data ≤ D, em ordem de data. Devolve
   * {vencimento, cumprida, ultima: {data, event_id} | null}:
   *  - UNICA: o dia em que completa a idade máxima; sem máxima, a mínima; sem faixa, a entrada no rebanho; cumprida por
   *    qualquer aplicação do protocolo;
   *  - INTERVALO_DIAS: `data_proxima_aplicacao` da última aplicação, se informada; senão a data dela + `intervalo_dias`;
   *    nunca aplicado: o dia em que ficou elegível (a entrada no rebanho ou o dia em que completa a idade mínima);
   *  - CAMPANHA_MESES: o último dia do mês da campanha; cumprida por aplicação entre o primeiro dia do mês − tolerância e
   *    o último + tolerância. A campanha perdida (já vencida) vale até abrir a janela da seguinte; depois, a seguinte.
   */
  function vencimento(protocolo, perfil, aplicacoes, data, params) {
    var p = protocolo;
    var a = perfil || {};
    var apl = (aplicacoes || []).slice().sort(function (x, y) { return x.data_aplicacao < y.data_aplicacao ? -1 : x.data_aplicacao > y.data_aplicacao ? 1 : 0; });
    var ultima = apl.length ? { data: apl[apl.length - 1].data_aplicacao, event_id: apl[apl.length - 1].event_id } : null;
    var min = num_(p.idade_min_meses) ? p.idade_min_meses : null;
    var max = num_(p.idade_max_meses) ? p.idade_max_meses : null;
    var nasc = Utils.dataValida(a.data_nascimento) ? a.data_nascimento : null;
    var elegivelDesde = [a.no_rebanho_desde, min !== null && nasc ? completaMeses_(nasc, min) : null].filter(Boolean).sort().pop() || a.no_rebanho_desde || data;
    if (p.recorrencia_tipo === 'UNICA') {
      var v = max !== null && nasc ? completaMeses_(nasc, max) : min !== null && nasc ? completaMeses_(nasc, min) : (a.no_rebanho_desde || data);
      return { vencimento: v, cumprida: apl.length > 0, ultima: ultima };
    }
    if (p.recorrencia_tipo === 'INTERVALO_DIAS') {
      if (!ultima) return { vencimento: elegivelDesde, cumprida: false, ultima: null };
      var u = apl[apl.length - 1];
      var prox = !vazio_(u.data_proxima_aplicacao) ? u.data_proxima_aplicacao : num_(p.intervalo_dias) ? Utils.somaDias(u.data_aplicacao, p.intervalo_dias) : null;
      // A próxima dose é sempre uma pendência (em dia, próxima ou vencida pela data); sem como contar a próxima, nenhuma.
      return { vencimento: prox, cumprida: prox === null, ultima: ultima };
    }
    // CAMPANHA_MESES
    var meses = Array.isArray(p.meses_campanha) ? p.meses_campanha.filter(function (m) { return num_(m) && m >= 1 && m <= 12; }) : [];
    if (!meses.length) return { vencimento: null, cumprida: true, ultima: ultima };
    var tol = tolerancia_(p, params);
    var ano = Number(data.slice(0, 4));
    var campanhas = [];
    [ano - 1, ano, ano + 1].forEach(function (y) { meses.forEach(function (m) { campanhas.push({ inicio: primeiroDiaDoMes_(y, m), fim: ultimoDiaDoMes_(y, m) }); }); });
    campanhas.sort(function (x, y) { return x.fim < y.fim ? -1 : x.fim > y.fim ? 1 : 0; });
    var cumpre = function (c) {
      var de = Utils.somaDias(c.inicio, -tol);
      var ate = Utils.somaDias(c.fim, tol);
      return apl.some(function (x) { return x.data_aplicacao >= de && x.data_aplicacao <= ate; });
    };
    var desde = [elegivelDesde, inicioProtocolo_(p)].filter(Boolean).sort().pop();
    var passada = campanhas.filter(function (c) { return c.fim < data && (!desde || c.fim >= desde); }).pop() || null;
    var proxima = campanhas.filter(function (c) { return c.fim >= data; })[0];
    // A campanha perdida continua devida até abrir a janela da seguinte (o primeiro dia do mês dela − tolerância); daí em
    // diante vale a seguinte (a perdida não se cumpre mais).
    if (passada && !cumpre(passada) && data < Utils.somaDias(proxima.inicio, -tol)) return { vencimento: passada.fim, cumprida: false, ultima: ultima, campanha: passada };
    return { vencimento: proxima.fim, cumprida: cumpre(proxima), ultima: ultima, campanha: proxima };
  }
  /** Situação da pendência em D: VENCIDA (passou do vencimento), PROXIMA (dentro da antecedência) ou EM_DIA. */
  function situacao(venc, data, antecedencia) {
    if (!venc || venc.cumprida || vazio_(venc.vencimento)) return 'EM_DIA';
    if (data > venc.vencimento) return 'VENCIDA';
    if (Utils.diffDias(data, venc.vencimento) <= antecedencia) return 'PROXIMA';
    return 'EM_DIA';
  }

  // ------------------------------------------------------------------ leitura ----
  /** Aplicações vigentes de SANIDADE do animal (linhas da aba), sem os eventos que a fonte exclui. */
  function aplicacoesDoAnimal(repo, id, f) {
    if (!repo.carregada('SANIDADE')) return [];
    return repo.por('SANIDADE', 'animal_id', id).filter(function (r) { return !(f && f.excluidos && f.excluidos[r.event_id]); });
  }
  /**
   * A compra do produto lançada sem o movimento de entrada (o controle estava desligado; desenho-base 16.9): o saldo
   * controlado não a vê. O aviso de estoque insuficiente manda então acertar pela contagem, não lançar a entrada de novo.
   */
  function compraSemMovimento(repo, productId) {
    if (!repo.carregada('FINANCEIRO') || !repo.carregada('MOVIMENTOS_ESTOQUE')) return false;
    return repo.por('FINANCEIRO', 'product_id', productId).some(function (f) {
      if (f.natureza !== 'ESTOQUE_INSUMOS' || vazio_(f.event_id)) return false;
      // O payload da entrada congela se ela tem o movimento (`com_movimento`): a que tinha e não tem mais é fonte quebrada
      // (a verificação acusa), não a compra de antes de ligar o controle. Sem o campo (entrada anterior a ele), pela linha.
      var ev = repo.carregada('EVENTOS') ? repo.porId('EVENTOS', f.event_id) : null;
      var pj = (ev && ev.payload_json) || {};
      if (typeof pj.com_movimento === 'boolean') return pj.com_movimento === false;
      return !repo.por('MOVIMENTOS_ESTOQUE', 'event_id', f.event_id).some(function (m) { return m.tipo === 'ENTRADA' && m.product_id === productId; });
    });
  }
  /** Movimentos vigentes do produto (sem os eventos excluídos): as linhas de MOVIMENTOS_ESTOQUE. */
  function movimentosDoProduto(repo, productId, excluidos) {
    if (!repo.carregada('MOVIMENTOS_ESTOQUE')) return [];
    return repo.por('MOVIMENTOS_ESTOQUE', 'product_id', productId).filter(function (m) { return !(excluidos && excluidos[m.event_id]); });
  }
  /** Custo sanitário do animal no evento: soma das alocações vigentes dos rateios dos lançamentos do evento (a fonte única). */
  function custoAlocado_(repo, eventId, animalId) {
    if (!repo.carregada('FINANCEIRO') || !repo.carregada('RATEIOS') || !repo.carregada('ALOCACOES_FINANCEIRAS')) return null;
    var total = null;
    repo.por('FINANCEIRO', 'event_id', eventId).forEach(function (fin) {
      repo.por('RATEIOS', 'financial_id', fin.financial_id).forEach(function (r) {
        repo.por('ALOCACOES_FINANCEIRAS', 'rateio_id', r.rateio_id).forEach(function (al) { if (al.animal_id === animalId) total = (total || 0) + (al.valor_alocado || 0); });
      });
    });
    return total;
  }

  /**
   * Pendências de um animal na data D: por protocolo ativo de que ele é elegível (situação VENCIDA ou PROXIMA) e, sem
   * protocolo, por produto do cadastro cuja última aplicação informou a próxima dose (03b, seção 6: chave (animal,
   * protocolo) ou (animal, produto), cumprida por aplicação posterior da mesma chave). perfil: {sexo, data_nascimento,
   * category_id, no_rebanho_desde}. Devolve {pendencias: [...], elegivel: {protocol_id: {em_dia}}}.
   */
  function pendenciasDoAnimal(contexto, animalId, perfil, data) {
    var c = contexto;
    var aplicacoes = c.aplicacoes(animalId).filter(function (r) { return r.data_aplicacao <= data; });
    var out = { pendencias: [], elegivel: {} };
    c.protocolos.forEach(function (p) {
      var el = elegibilidade(p, perfil, data);
      if (!el.elegivel) return;
      var doProt = aplicacoes.filter(function (r) { return r.protocol_id === p.protocol_id; });
      var v = vencimento(p, perfil, doProt, data, c.params);
      var sit = el.devendo && !v.cumprida ? 'VENCIDA' : situacao(v, data, antecedencia_(p, c.params));
      out.elegivel[p.protocol_id] = { em_dia: doProt.length > 0 && sit !== 'VENCIDA' };
      if (SITUACOES_AGENDA.indexOf(sit) < 0) return;
      out.pendencias.push({
        animal_id: animalId, protocol_id: p.protocol_id, produto_id: nulo_(p.product_id), nome: p.nome, tipo_procedimento: p.tipo_procedimento,
        vencimento: v.vencimento, situacao: sit, dias: Utils.diffDias(v.vencimento, data), ultima_aplicacao: v.ultima,
      });
    });
    // Sem protocolo: a próxima dose informada na última aplicação do produto do cadastro (CONTRATOS, seção 39). A última
    // aplicação do produto é a de qualquer lançamento, com ou sem protocolo (RN-058: a aplicação posterior da mesma chave
    // cumpre a pendência); a pendência sem protocolo só vale quando essa última também é sem protocolo.
    var porProduto = {};
    aplicacoes.forEach(function (r) {
      if (vazio_(r.produto_id)) return;
      var u = porProduto[r.produto_id];
      if (!u || r.data_aplicacao > u.data_aplicacao || (r.data_aplicacao === u.data_aplicacao && c.seq(r.event_id) > c.seq(u.event_id))) porProduto[r.produto_id] = r;
    });
    Object.keys(porProduto).forEach(function (pid) {
      var u = porProduto[pid];
      if (!vazio_(u.protocol_id) || vazio_(u.data_proxima_aplicacao)) return;
      var v = { vencimento: u.data_proxima_aplicacao, cumprida: false };
      var sit = situacao(v, data, antecedencia_(null, c.params));
      if (SITUACOES_AGENDA.indexOf(sit) < 0) return;
      var prod = c.produto(pid);
      out.pendencias.push({
        animal_id: animalId, protocol_id: null, produto_id: pid, nome: prod ? prod.nome : u.nome_produto, tipo_procedimento: u.tipo_procedimento,
        vencimento: v.vencimento, situacao: sit, dias: Utils.diffDias(v.vencimento, data), ultima_aplicacao: { data: u.data_aplicacao, event_id: u.event_id },
      });
    });
    return out;
  }
  /** Contexto de leitura da sanidade sobre o leitor do AnimalService: protocolos ativos, produtos, aplicações por animal. */
  function contexto(L) {
    var repo = L.repo;
    var protocolos = repo.carregada('PROTOCOLOS_SANITARIOS') ? Utils.ordenarPor(repo.vigentes('PROTOCOLOS_SANITARIOS').filter(function (p) { return p.ativo !== false; }), ['nome', 'protocol_id']) : [];
    return {
      L: L, params: L.params, protocolos: protocolos,
      produto: function (id) { return vazio_(id) || !repo.carregada('PRODUTOS') ? null : repo.porId('PRODUTOS', id); },
      aplicacoes: function (id) { return aplicacoesDoAnimal(repo, id, L.f); },
      seq: function (eventId) { var ev = L.f.evento(eventId); return ev ? (L.f.ordemSeq(eventId) || 0) * 1e6 + (ev.event_seq || 0) : 0; },
    };
  }
  /** Perfil do animal na data para a elegibilidade: sexo, nascimento, categoria em D e a entrada no rebanho. */
  function perfilEm_(L, a, data, desde) {
    var cat = AnimalService.categoriaEm(L, a, data);
    return { sexo: a.sexo, data_nascimento: nulo_(a.data_nascimento), category_id: cat ? cat.category_id : null, no_rebanho_desde: desde || nulo_(a.data_entrada) };
  }
  /**
   * A agenda em D (05, RN-058 e RN-059; 07, seção 8.4; 08, seção 3): animais no rebanho em D com pendência vencida ou
   * próxima, a carência ativa, por protocolo a cobertura (elegíveis com aplicação em dia ÷ elegíveis; null sem elegíveis),
   * as aplicações e os animais atendidos no período, e o custo sanitário do período (contas de classe SANITARIO, alocado ×
   * não alocado). Tudo calculado aqui; a tela só mostra.
   */
  function agendaEm(L, data, periodo) {
    var c = contexto(L);
    var pres = InventoryService.presentes(L, data);
    var out = {
      data: data, motivo: pres.motivo, periodo: periodo,
      parametros: { antecedencia_dias: antecedencia_(null, L.params), tolerancia_dias: tolerancia_(null, L.params) },
      resumo: { vencidas: 0, proximas: 0, animais_pendentes: 0, em_carencia: 0 },
      pendencias: [], carencia: [], protocolos: [], custos: null,
    };
    if (pres.motivo) return out;
    var porProt = {};
    c.protocolos.forEach(function (p) { porProt[p.protocol_id] = { elegiveis: 0, em_dia: 0 }; });
    var pendentes = {};
    pres.itens.forEach(function (x) {
      var a = x.animal;
      var r = pendenciasDoAnimal(c, a.animal_id, perfilEm_(L, a, data, x.no_rebanho_desde), data);
      Object.keys(r.elegivel).forEach(function (pid) { porProt[pid].elegiveis += 1; if (r.elegivel[pid].em_dia) porProt[pid].em_dia += 1; });
      r.pendencias.forEach(function (p) {
        p.codigo_interno = a.codigo_interno;
        p.brinco = nulo_(a.brinco);
        p.pasture_id = nulo_(x.pasture_id);
        out.pendencias.push(p);
        pendentes[a.animal_id] = true;
        if (p.situacao === 'VENCIDA') out.resumo.vencidas += 1; else out.resumo.proximas += 1;
      });
      var car = carenciaEm(c.aplicacoes(a.animal_id), data);
      if (car) out.carencia.push({ animal_id: a.animal_id, codigo_interno: a.codigo_interno, brinco: nulo_(a.brinco), pasture_id: nulo_(x.pasture_id), fim: car.fim, nome_produto: car.nome_produto, data_aplicacao: car.data_aplicacao, event_id: car.event_id });
    });
    out.pendencias.sort(function (p, q) { return (p.situacao === q.situacao ? 0 : p.situacao === 'VENCIDA' ? -1 : 1) || (p.vencimento < q.vencimento ? -1 : p.vencimento > q.vencimento ? 1 : 0) || (p.codigo_interno < q.codigo_interno ? -1 : 1); });
    out.carencia.sort(function (p, q) { return p.fim < q.fim ? 1 : p.fim > q.fim ? -1 : p.codigo_interno < q.codigo_interno ? -1 : 1; });
    out.resumo.animais_pendentes = Object.keys(pendentes).length;
    out.resumo.em_carencia = out.carencia.length;
    // Por protocolo: cobertura em D e o que foi feito no período.
    var apsPeriodo = L.repo.carregada('SANIDADE') ? L.repo.vigentes('SANIDADE').filter(function (r) { return periodo && r.data_aplicacao >= periodo.inicio && r.data_aplicacao <= periodo.fim; }) : [];
    out.protocolos = c.protocolos.map(function (p) {
      var st = porProt[p.protocol_id];
      var doProt = apsPeriodo.filter(function (r) { return r.protocol_id === p.protocol_id; });
      return {
        protocol_id: p.protocol_id, nome: p.nome, tipo_procedimento: p.tipo_procedimento, recorrencia_tipo: p.recorrencia_tipo,
        elegiveis: st.elegiveis, em_dia: st.em_dia,
        cobertura: st.elegiveis ? { valor: Utils.arredondar(st.em_dia / st.elegiveis * 100, 1), motivo: null, n: st.elegiveis } : { valor: null, motivo: 'DADOS_INSUFICIENTES', n: 0 },
        aplicacoes: Utils.unicos(doProt.map(function (r) { return r.event_id; })).length,
        animais_atendidos: Utils.unicos(doProt.map(function (r) { return r.animal_id; })).length,
      };
    });
    out.custos = periodo ? custoSanitario(L.repo, periodo) : null;
    return out;
  }
  /**
   * Custo sanitário do período (07, seção 8.4): lançamentos vigentes de contas de classe SANITARIO com competência no
   * período, o alocado aos animais e o não alocado, por conta. {inicio, fim, total, alocado, nao_alocado, por_conta}.
   */
  function custoSanitario(repo, periodo) {
    var out = { inicio: periodo.inicio, fim: periodo.fim, total: 0, alocado: 0, nao_alocado: 0, por_conta: [] };
    if (!repo.carregada('FINANCEIRO') || !repo.carregada('PLANO_CONTAS')) return out;
    var porConta = {};
    repo.vigentes('FINANCEIRO').forEach(function (fin) {
      if (fin.data_competencia < periodo.inicio || fin.data_competencia > periodo.fim) return;
      var conta = repo.porId('PLANO_CONTAS', fin.conta_id);
      if (!conta || conta.classe_custo_animal !== 'SANITARIO') return;
      var alocado = 0;
      repo.por('RATEIOS', 'financial_id', fin.financial_id).forEach(function (r) { repo.por('ALOCACOES_FINANCEIRAS', 'rateio_id', r.rateio_id).forEach(function (a) { alocado += a.valor_alocado || 0; }); });
      var k = conta.conta_id;
      if (!porConta[k]) porConta[k] = { conta_id: k, codigo: conta.codigo, nome: conta.nome, total: 0, alocado: 0 };
      porConta[k].total += fin.valor;
      porConta[k].alocado += alocado;
      out.total += fin.valor;
      out.alocado += alocado;
    });
    out.nao_alocado = out.total - out.alocado;
    out.por_conta = Utils.ordenarPor(Object.keys(porConta).map(function (k) { porConta[k].nao_alocado = porConta[k].total - porConta[k].alocado; return porConta[k]; }), 'nome');
    return out;
  }
  function leiturasAgenda() {
    return Utils.unicos(AnimalService.leituras().concat(LEITURAS_CADASTRO, ['FINANCEIRO', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'PLANO_CONTAS']));
  }
  function dataDaConsulta_(L, v, campo) {
    if (vazio_(v)) return L.hoje;
    if (typeof v !== 'string' || !Utils.dataValida(v)) throw Validation.erro('VALIDATION', 'A data informada não é válida.', [det_('FORMATO_INVALIDO', campo, 'Use uma data válida (dd/mm/aaaa).')]);
    if (v > L.hoje) throw Validation.erro('VALIDATION', 'A agenda é calculada até hoje: escolha hoje ou uma data passada.', [det_('DATA_FUTURA', campo, 'A data ' + br_(v) + ' ainda não chegou.')]);
    return v;
  }
  /**
   * Consulta `sanidade.agenda` (08, seção 3): dados {data?, periodo_inicio?, periodo_fim?}. Data padrão hoje (não
   * futura); período padrão: do primeiro dia do mês, 11 meses antes do da data, até a data. Antes do marco zero (ou sem
   * ele), as listas voltam vazias com o motivo.
   */
  function consultaAgenda(dados) {
    var d = dados || {};
    return {
      rota: 'sanidade.agenda', dados: d, reads: leiturasAgenda(), acessoCru: true,
      tratador: function (tx) {
        var L = AnimalService.leitor(tx);
        var data = dataDaConsulta_(L, d.data, 'data');
        var fim = vazio_(d.periodo_fim) ? data : dataDaConsulta_(L, d.periodo_fim, 'periodo_fim');
        var inicio;
        if (vazio_(d.periodo_inicio)) {
          var ano = Number(fim.slice(0, 4));
          var mes = Number(fim.slice(5, 7)) - 11;
          while (mes < 1) { mes += 12; ano -= 1; }
          inicio = primeiroDiaDoMes_(ano, mes);
        } else inicio = dataDaConsulta_(L, d.periodo_inicio, 'periodo_inicio');
        if (inicio > fim) throw Validation.erro('VALIDATION', 'O início do período fica depois do fim.', [det_('FAIXA_INVALIDA', 'periodo_inicio', 'O início do período precisa ser antes do fim.')]);
        return agendaEm(L, data, { inicio: inicio, fim: fim });
      },
    };
  }
  function agenda(ctx, dados) {
    return UnitOfWork.read(ctx, consultaAgenda(dados));
  }

  // ------------------------------------------------------------------ ficha (bloco F) ----
  /**
   * Bloco F da ficha (08, seção 3): todos os registros sanitários do animal (do mais recente ao mais antigo), com o custo
   * que coube a ele pelas alocações vigentes (nunca a cópia `SANIDADE.custo`: 03b, seção 6), a carência hoje e as
   * próximas doses (as pendências dele na agenda de hoje, quando está no rebanho).
   */
  function blocoFicha(L, a) {
    var c = contexto(L);
    var regs = c.aplicacoes(a.animal_id);
    var protNome = function (id) { var p = vazio_(id) || !L.repo.carregada('PROTOCOLOS_SANITARIOS') ? null : L.repo.porId('PROTOCOLOS_SANITARIOS', id); return p ? p.nome : null; };
    var itens = regs.map(function (r) {
      var ev = L.f.evento(r.event_id);
      return {
        event_id: r.event_id, event_subtype: ev ? nulo_(ev.event_subtype) : null, data: r.data_aplicacao, tipo_procedimento: r.tipo_procedimento,
        nome_produto: nulo_(r.nome_produto), produto_id: nulo_(r.produto_id), protocol_id: nulo_(r.protocol_id), protocolo_nome: protNome(r.protocol_id),
        dose: nulo_(r.dose), unidade_dose: nulo_(r.unidade_dose), via_aplicacao: nulo_(r.via_aplicacao), lote: nulo_(r.lote), validade: nulo_(r.validade),
        motivo: nulo_(r.motivo), diagnostico: nulo_(r.diagnostico), resultado_exame: nulo_(r.resultado_exame),
        data_proxima_aplicacao: nulo_(r.data_proxima_aplicacao), periodo_carencia_dias: nulo_(r.periodo_carencia_dias), data_fim_carencia: fimCarencia(r),
        custo: custoAlocado_(L.repo, r.event_id, a.animal_id), veterinario: nulo_(r.veterinario), observacoes: nulo_(r.observacoes), seq: c.seq(r.event_id),
      };
    });
    itens.sort(function (x, y) { return (x.data < y.data ? 1 : x.data > y.data ? -1 : 0) || (y.seq - x.seq); });
    itens.forEach(function (x) { delete x.seq; });
    var car = regs.length ? carenciaEm(regs, L.hoje) : null;
    var proximas = [];
    if (a.situacao_cadastral === 'ATIVO') {
      var desde = nulo_(a.data_entrada);
      proximas = pendenciasDoAnimal(c, a.animal_id, perfilEm_(L, a, L.hoje, desde), L.hoje).pendencias;
      // Também a próxima dose ainda longe (EM_DIA): o que a última aplicação de cada chave prevê.
      itens.forEach(function (x) {
        if (vazio_(x.data_proxima_aplicacao) || x.data_proxima_aplicacao < L.hoje) return;
        var ja = proximas.some(function (p) { return (x.protocol_id && p.protocol_id === x.protocol_id) || (!x.protocol_id && p.produto_id === x.produto_id && !p.protocol_id); });
        var maisNova = itens.filter(function (y) { return x.protocol_id ? y.protocol_id === x.protocol_id : (!y.protocol_id && y.produto_id === x.produto_id && y.nome_produto === x.nome_produto); })[0] === x;
        if (!ja && maisNova) proximas.push({ animal_id: a.animal_id, protocol_id: x.protocol_id, produto_id: x.produto_id, nome: x.protocolo_nome || x.nome_produto, tipo_procedimento: x.tipo_procedimento, vencimento: x.data_proxima_aplicacao, situacao: 'EM_DIA', dias: Utils.diffDias(x.data_proxima_aplicacao, L.hoje), ultima_aplicacao: { data: x.data, event_id: x.event_id } });
      });
    }
    proximas.sort(function (p, q) { return p.vencimento < q.vencimento ? -1 : p.vencimento > q.vencimento ? 1 : 0; });
    var custo = itens.reduce(function (t, x) { return x.custo === null ? t : (t || 0) + x.custo; }, null);
    return { entregue: true, animal_id: a.animal_id, itens: itens, carencia: car, proximas: proximas, custo_total: custo };
  }
  /** Carência do animal hoje (para a lista leve: o selo "em carência até" na venda e no rebanho). */
  function carenciaHoje(L, a) {
    // Sem a aba lida, a carência seria "nenhuma" em silêncio e o aparelho apagaria o selo: é erro de programação.
    if (!L.repo.carregada('SANIDADE')) throw Validation.erro('INTERNAL', 'A consulta do animal precisa ler a sanidade para dizer a carência (AnimalService.leituras).');
    if (a.situacao_cadastral !== 'ATIVO') return null;
    var car = carenciaEm(aplicacoesDoAnimal(L.repo, a.animal_id, L.f), L.hoje);
    return car ? car.fim : null;
  }

  // ------------------------------------------------------------------ cadastros (produto.salvar, protocolo.salvar) ----
  var CAMPOS_PRODUTO = ['nome', 'categoria', 'fabricante', 'unidade', 'apresentacao', 'fator_conversao', 'custo_unitario', 'dose_padrao_por_cabeca',
    'dose_padrao_por_kg', 'carencia_padrao_dias', 'controla_estoque', 'estoque_minimo', 'validade', 'lote', 'observacoes', 'ativo'];
  var CAMPOS_PROTOCOLO = ['nome', 'descricao', 'tipo_procedimento', 'product_id', 'sexo_aplicavel', 'idade_min_meses', 'idade_max_meses', 'category_id',
    'recorrencia_tipo', 'intervalo_dias', 'meses_campanha', 'antecedencia_alerta_dias', 'tolerancia_dias', 'ativo', 'observacoes'];
  function chaveNome_(t) {
    return Utils.normalizarTexto(String(t || ''));
  }
  function camposDe_(col, d, permitidos, entidade) {
    var campos = {};
    var brutos = d.campos && typeof d.campos === 'object' && !Array.isArray(d.campos) ? d.campos : {};
    Object.keys(brutos).forEach(function (c) {
      if (permitidos.indexOf(c) < 0) {
        col.erro(det_(Schema.temColuna(entidade, c) ? 'CAMPO_NAO_EDITAVEL' : 'CAMPO_DESCONHECIDO', c, Schema.temColuna(entidade, c) ? 'O campo "' + c + '" é calculado pelo sistema e não se altera por aqui.' : 'O campo "' + c + '" não existe neste cadastro.'));
        return;
      }
      var v = brutos[c];
      v = typeof v === 'string' ? Utils.aparar(v) : v;
      campos[c] = vazio_(v) ? null : v;
    });
    return campos;
  }
  function validar_(col, tabela, campos) {
    var presentes = {};
    Object.keys(campos).forEach(function (c) { if (campos[c] !== null) presentes[c] = campos[c]; });
    Validation.validarRegistro(tabela, presentes, { parcial: true }).forEach(function (x) { col.erro(x); });
  }
  /** O produto já foi usado (aplicação ou movimento de estoque vigente): a unidade não muda mais (dose, estoque e custo falam a mesma língua). */
  function produtoEmUso_(repo, id) {
    return (repo.carregada('MOVIMENTOS_ESTOQUE') && repo.por('MOVIMENTOS_ESTOQUE', 'product_id', id).length > 0) || (repo.carregada('SANIDADE') && repo.por('SANIDADE', 'produto_id', id).length > 0);
  }
  /**
   * Comando `produto.salvar` (03a, seções 4.6 e 6.4): dados {product_id?, campos: {...}, justificativa?}. Nome, categoria
   * e unidade obrigatórios; nome único entre os ativos; `controla_estoque` padrão N (PR-10) e `ativo` padrão S na criação.
   * A unidade não muda depois que o produto foi usado (PRODUTO_EM_USO). `estoque_atual*` é projeção dos movimentos: o
   * comando manda refazê-la (ligar ou desligar o controle mostra ou apaga o saldo).
   */
  function comandoSalvarProduto(pedido) {
    var p = pedido || {};
    return {
      rota: 'produto.salvar', idempotencyKey: p.idempotencyKey, dados: p.dados, avisosAceitos: p.avisosAceitos || [],
      dataVersionEsperada: p.dataVersionEsperada, reads: ['PRODUTOS', 'MOVIMENTOS_ESTOQUE', 'SANIDADE', 'EVENTOS'],
      tratador: function (tx) {
        var d = tx.dados || {};
        var col = Validation.coletor();
        var atual = vazio_(d.product_id) ? null : tx.repo.porId('PRODUTOS', d.product_id);
        if (!vazio_(d.product_id) && !atual) throw Validation.erro('NOT_FOUND', 'O produto não existe mais. Atualize a tela e tente de novo.');
        var campos = camposDe_(col, d, CAMPOS_PRODUTO, 'PRODUTOS');
        var id = atual ? atual.product_id : tx.novoId();
        if (!atual) {
          if (campos.controla_estoque === undefined || campos.controla_estoque === null) campos.controla_estoque = false;
          if (campos.ativo === undefined || campos.ativo === null) campos.ativo = true;
        }
        var final = Utils.clonar(atual || {});
        Object.keys(campos).forEach(function (c) { final[c] = campos[c]; });
        if (vazio_(final.nome)) col.erro(det_('CAMPO_OBRIGATORIO', 'nome', 'Informe o nome do produto.'));
        if (vazio_(final.categoria)) col.erro(det_('CAMPO_OBRIGATORIO', 'categoria', 'Escolha a categoria do produto (vacina, vermífugo, medicamento, suplemento ou outro).'));
        if (vazio_(final.unidade)) col.erro(det_('CAMPO_OBRIGATORIO', 'unidade', 'Informe a unidade de dose (mL, dose, g): a mesma em que se aplica, se dá baixa e se informa o custo.'));
        if (campos.controla_estoque === null) col.erro(det_('CAMPO_OBRIGATORIO', 'controla_estoque', 'Diga se o estoque do produto é controlado.'));
        if (campos.ativo === null) col.erro(det_('CAMPO_OBRIGATORIO', 'ativo', 'Diga se o produto está ativo.'));
        validar_(col, 'PRODUTOS', campos);
        if (atual && campos.unidade !== undefined && campos.unidade !== atual.unidade && produtoEmUso_(tx.repo, id)) {
          col.erro(det_('PRODUTO_EM_USO', 'unidade', 'O produto ' + atual.nome + ' já foi usado em aplicações ou no estoque com a unidade "' + atual.unidade + '": a unidade não muda mais. Cadastre outro produto para a outra unidade.'));
        }
        if (final.ativo !== false && !vazio_(final.nome)) {
          var igual = tx.repo.vigentes('PRODUTOS').filter(function (x) { return x.product_id !== id && x.ativo !== false && chaveNome_(x.nome) === chaveNome_(final.nome); })[0];
          if (igual) col.erro(det_('NOME_REPETIDO', 'nome', 'Já existe um produto ativo chamado "' + igual.nome + '".'));
        }
        if (col.temErros()) return { erros: col.erros };
        // Ligar o controle de estoque depois das aplicações: o saldo é Σ dos movimentos, e as saídas já gravadas (a aplicação
        // gera a saída com ou sem controle; PR-11) entram nele, mas as compras lançadas sem o controle não têm movimento
        // (desenho-base 16.9). O saldo começaria negativo: pede confirmação e diz o caminho (o acerto pela contagem), nunca
        // "lance a entrada" — a compra já foi paga e lançada.
        var avisos = [];
        if (atual && campos.controla_estoque === true && atual.controla_estoque !== true) {
          var inicial = saldo(movimentosDoProduto(tx.repo, id, null), null);
          if (inicial < 0) {
            avisos.push(det_('ESTOQUE_INSUFICIENTE', 'controla_estoque', atual.nome + ': ao ligar o controle, o saldo começa em ' + quantidadeTexto(inicial, atual.unidade) +
              ' (as aplicações já gravadas baixam o estoque, e as compras lançadas sem o controle não entram nele). Depois de gravar, acerte o estoque pela contagem (Produtos, "Acertar"). Ligar mesmo assim?'));
            avisos = Config.aplicarPolitica(Config.parametros(tx.repo), avisos, col);
            if (col.temErros()) return { erros: col.erros };
          }
        }
        if (atual) AuditService.alteracao(tx, 'PRODUTOS', id, campos, d.justificativa);
        else {
          // O saldo nasce com o cadastro (zero com controle, vazio sem): a projeção dos movimentos dá o mesmo.
          campos.estoque_atual = campos.controla_estoque === true ? 0 : null;
          AuditService.criacao(tx, 'PRODUTOS', id, campos, d.justificativa);
        }
        return { avisos: avisos, resumo: { product_id: id }, derivados: { produtos: [id] }, resposta: function (t) { return produtoPublico(t.repo, t.repo.porId('PRODUTOS', id)); } };
      },
      reconstruir: function (tx, op) { return produtoPublico(tx.repo, tx.repo.porId('PRODUTOS', op.resumo.product_id)); },
    };
  }
  function salvarProduto(ctx, pedido) {
    return UnitOfWork.run(ctx, comandoSalvarProduto(pedido));
  }
  /** O produto para a tela: o cadastro com o saldo (projeção) e se está abaixo do mínimo. */
  function produtoPublico(repo, prod) {
    if (!prod) return null;
    var o = Utils.clonar(prod);
    o.abaixo_do_minimo = prod.controla_estoque === true && num_(prod.estoque_atual) && num_(prod.estoque_minimo) ? prod.estoque_atual < prod.estoque_minimo : false;
    return o;
  }
  function mesesCampanha_(col, v) {
    if (v === undefined) return undefined;
    if (v === null) return null;
    var lista = typeof v === 'string' ? v.split(/[,;\s]+/).filter(Boolean).map(Number) : v;
    if (!Array.isArray(lista) || !lista.length || lista.some(function (m) { return !num_(m) || Math.floor(m) !== m || m < 1 || m > 12; })) {
      col.erro(det_('FORMATO_INVALIDO', 'meses_campanha', 'Os meses da campanha são números de 1 a 12 (ex.: 5 e 11 para maio e novembro).'));
      return null;
    }
    return Utils.unicos(lista).sort(function (a, b) { return a - b; });
  }
  /**
   * Comando `protocolo.salvar` (03a, seção 4.9): dados {protocol_id?, campos, justificativa?}. Nome único entre os ativos,
   * procedimento (sem doença), sexo e recorrência obrigatórios; INTERVALO_DIAS exige o intervalo, CAMPANHA_MESES os meses (1
   * a 12), e o que não é da recorrência escolhida não se aplica; idade máxima > mínima; produto e categoria existentes e
   * ativos (o que já estava no protocolo continua aceito). Nenhum protocolo vem de fábrica: o dono cadastra o que o
   * veterinário e o órgão de defesa orientam. `ativo` padrão S na criação.
   */
  function comandoSalvarProtocolo(pedido) {
    var p = pedido || {};
    return {
      rota: 'protocolo.salvar', idempotencyKey: p.idempotencyKey, dados: p.dados, avisosAceitos: p.avisosAceitos || [],
      dataVersionEsperada: p.dataVersionEsperada, reads: ['PROTOCOLOS_SANITARIOS', 'PRODUTOS', 'CATEGORIAS'],
      tratador: function (tx) {
        var d = tx.dados || {};
        var col = Validation.coletor();
        var atual = vazio_(d.protocol_id) ? null : tx.repo.porId('PROTOCOLOS_SANITARIOS', d.protocol_id);
        if (!vazio_(d.protocol_id) && !atual) throw Validation.erro('NOT_FOUND', 'O protocolo não existe mais. Atualize a tela e tente de novo.');
        var campos = camposDe_(col, d, CAMPOS_PROTOCOLO, 'PROTOCOLOS_SANITARIOS');
        var meses = mesesCampanha_(col, campos.meses_campanha);
        if (meses !== undefined) campos.meses_campanha = meses;
        var id = atual ? atual.protocol_id : tx.novoId();
        if (!atual && (campos.ativo === undefined || campos.ativo === null)) campos.ativo = true;
        var final = Utils.clonar(atual || {});
        Object.keys(campos).forEach(function (c) { final[c] = campos[c]; });
        if (vazio_(final.nome)) col.erro(det_('CAMPO_OBRIGATORIO', 'nome', 'Informe o nome do protocolo.'));
        if (vazio_(final.tipo_procedimento)) col.erro(det_('CAMPO_OBRIGATORIO', 'tipo_procedimento', 'Escolha o procedimento que cumpre o protocolo.'));
        if (vazio_(final.sexo_aplicavel)) col.erro(det_('CAMPO_OBRIGATORIO', 'sexo_aplicavel', 'Escolha para que sexo vale o protocolo (ou os dois).'));
        if (vazio_(final.recorrencia_tipo)) col.erro(det_('CAMPO_OBRIGATORIO', 'recorrencia_tipo', 'Escolha como o protocolo se repete.'));
        if (campos.ativo === null) col.erro(det_('CAMPO_OBRIGATORIO', 'ativo', 'Diga se o protocolo está ativo.'));
        validar_(col, 'PROTOCOLOS_SANITARIOS', campos);
        var rec = final.recorrencia_tipo;
        if (rec === 'INTERVALO_DIAS' && !num_(final.intervalo_dias)) col.erro(det_('CAMPO_OBRIGATORIO', 'intervalo_dias', 'Informe de quantos em quantos dias o protocolo se repete.'));
        if (rec === 'CAMPANHA_MESES' && (!Array.isArray(final.meses_campanha) || !final.meses_campanha.length) && !col.erros.some(function (e) { return e.campo === 'meses_campanha'; })) col.erro(det_('CAMPO_OBRIGATORIO', 'meses_campanha', 'Informe os meses da campanha (ex.: 5 e 11).'));
        if (rec && rec !== 'INTERVALO_DIAS' && !vazio_(final.intervalo_dias)) {
          if (campos.intervalo_dias === undefined) { campos.intervalo_dias = null; final.intervalo_dias = null; } else col.erro(det_('CAMPO_NAO_SE_APLICA', 'intervalo_dias', 'O intervalo em dias só vale para o protocolo que se repete a cada N dias.'));
        }
        if (rec && rec !== 'CAMPANHA_MESES' && !vazio_(final.meses_campanha)) {
          if (campos.meses_campanha === undefined) { campos.meses_campanha = null; final.meses_campanha = null; } else col.erro(det_('CAMPO_NAO_SE_APLICA', 'meses_campanha', 'Os meses só valem para o protocolo de campanha.'));
        }
        if (num_(final.idade_min_meses) && num_(final.idade_max_meses) && final.idade_max_meses <= final.idade_min_meses) col.erro(det_('FAIXA_INVALIDA', 'idade_max_meses', 'A idade máxima precisa ser maior que a mínima (a máxima não conta: de 3 a 8 meses vale até o dia antes de completar 8).'));
        if (!vazio_(campos.product_id)) {
          var prod = tx.repo.porId('PRODUTOS', campos.product_id);
          if (!prod) col.erro(det_('NAO_ENCONTRADO', 'product_id', 'O produto escolhido não está no cadastro.'));
          else if (prod.ativo === false && !(atual && atual.product_id === prod.product_id)) col.erro(det_('PRODUTO_INATIVO', 'product_id', 'O produto ' + prod.nome + ' está desativado.'));
        }
        if (!vazio_(campos.category_id)) {
          var cat = tx.repo.porId('CATEGORIAS', campos.category_id);
          if (!cat) col.erro(det_('NAO_ENCONTRADO', 'category_id', 'A categoria escolhida não existe.'));
          else if (cat.ativo === false && !(atual && atual.category_id === cat.category_id)) col.erro(det_('CATEGORIA_INATIVA', 'category_id', 'A categoria ' + cat.nome + ' está desativada.'));
        }
        if (final.ativo !== false && !vazio_(final.nome)) {
          var igual = tx.repo.vigentes('PROTOCOLOS_SANITARIOS').filter(function (x) { return x.protocol_id !== id && x.ativo !== false && chaveNome_(x.nome) === chaveNome_(final.nome); })[0];
          if (igual) col.erro(det_('NOME_REPETIDO', 'nome', 'Já existe um protocolo ativo chamado "' + igual.nome + '".'));
        }
        if (col.temErros()) return { erros: col.erros };
        if (atual) AuditService.alteracao(tx, 'PROTOCOLOS_SANITARIOS', id, campos, d.justificativa);
        else AuditService.criacao(tx, 'PROTOCOLOS_SANITARIOS', id, campos, d.justificativa);
        return { resumo: { protocol_id: id }, resposta: function (t) { return Utils.clonar(t.repo.porId('PROTOCOLOS_SANITARIOS', id)); } };
      },
      reconstruir: function (tx, op) { return Utils.clonar(tx.repo.porId('PROTOCOLOS_SANITARIOS', op.resumo.protocol_id)); },
    };
  }
  function salvarProtocolo(ctx, pedido) {
    return UnitOfWork.run(ctx, comandoSalvarProtocolo(pedido));
  }
  /** Para o bootstrap (08, seção 16: os cadastros pequenos que alimentam os formulários): produtos com o saldo e protocolos. */
  function cadastros(repo) {
    return {
      produtos: repo.carregada('PRODUTOS') ? Utils.ordenarPor(repo.vigentes('PRODUTOS'), ['nome', 'product_id']).map(function (p) { return produtoPublico(repo, p); }) : [],
      protocolos: repo.carregada('PROTOCOLOS_SANITARIOS') ? Utils.ordenarPor(repo.vigentes('PROTOCOLOS_SANITARIOS'), ['nome', 'protocol_id']).map(Utils.clonar) : [],
    };
  }

  return {
    PROCEDIMENTO: PROCEDIMENTO,
    COM_PRODUTO_OBRIGATORIO: COM_PRODUTO_OBRIGATORIO,
    CONTA_DA_CATEGORIA: CONTA_DA_CATEGORIA,
    MODOS_DOSE: MODOS_DOSE,
    MOTIVOS_AJUSTE: MOTIVOS_AJUSTE,
    LEITURAS_CADASTRO: LEITURAS_CADASTRO,
    fimCarencia: fimCarencia,
    fimPeloPeriodo: fimPeloPeriodo,
    carenciaEm: carenciaEm,
    carenciaHoje: carenciaHoje,
    valorConsumo: valorConsumo,
    custoUnitarioEntrada: custoUnitarioEntrada,
    variacao: variacao,
    saldo: saldo,
    menorSaldo: menorSaldo,
    estoqueAtual: estoqueAtual,
    quantidadeTexto: quantidadeTexto,
    descricaoConsumo: descricaoConsumo,
    elegibilidade: elegibilidade,
    vencimento: vencimento,
    situacao: situacao,
    aplicacoesDoAnimal: aplicacoesDoAnimal,
    movimentosDoProduto: movimentosDoProduto,
    contagensDoProduto: contagensDoProduto,
    contagemAfetada: contagemAfetada,
    compraSemMovimento: compraSemMovimento,
    contexto: contexto,
    pendenciasDoAnimal: pendenciasDoAnimal,
    agendaEm: agendaEm,
    custoSanitario: custoSanitario,
    leiturasAgenda: leiturasAgenda,
    consultaAgenda: consultaAgenda,
    agenda: agenda,
    blocoFicha: blocoFicha,
    comandoSalvarProduto: comandoSalvarProduto,
    salvarProduto: salvarProduto,
    produtoPublico: produtoPublico,
    comandoSalvarProtocolo: comandoSalvarProtocolo,
    salvarProtocolo: salvarProtocolo,
    cadastros: cadastros,
  };
})();
