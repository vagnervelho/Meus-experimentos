/**
 * Custos — o custo por animal e por pasto e o resultado por animal (Fase 4, E4.4; 07-financeiro-e-indicadores.md, seções 2.1
 * "Visão 3", 6 e 10, relatórios 14 e 15; 08-ux-ui.md, seção 3, "Financeiro: custos", e o bloco H da ficha). Puro: lê os fatos
 * das três visões (`Conciliacao.fatos`: os lançamentos, o rateio que vale em cada data, as passagens de cada animal) e soma em
 * centavos inteiros; nenhum valor por animal vem de outro lugar que não as alocações (ALOCACOES_FINANCEIRAS, a fonte única).
 *
 * Regra de tempo (o número pedido numa data D): conta só o lançamento com competência até D, pelo rateio que valia em D (o
 * re-rateio de depois não muda D), e a passagem do animal em D (a aberta em D ou a última que se fechou até D). A passagem de cada
 * alocação é a regra única de `Conciliacao.passagemNaLista` (o evento de negócio do lançamento abre ou fecha a passagem; senão, a
 * data de referência do rateio). Os cadastros lidos como estão hoje: o nome e a ordem das contas (a classe do custo não muda
 * depois do primeiro lançamento), o nome, a posse, o arrendador e a área do pasto (03a, 4.2: sem vigência), a categoria e o
 * parâmetro `arroba_kg`.
 *
 * Por animal (07, seção 6): custo de aquisição (AQUISICAO; o nascido custa 0,00; sem valor de abertura, desconhecido — nunca
 * zero), custos sanitários (SANITARIO), de alimentação (ALIMENTACAO: inclui a manutenção e o arrendamento de pasto) e adicionais
 * (REPRODUCAO e OUTROS), custo acumulado, custo diário (custeio ÷ dias no rebanho), receita, despesas de venda, resultado
 * realizado (só com a saída: receita − despesas de venda − aquisição − custeio; o morto, −custo acumulado) e a margem por arroba
 * (resultado ÷ arrobas do animal na venda; sem o peso da venda, null).
 * Por pasto (relatório 15): os lançamentos de custeio com o pasto (a parte da competência no período), por conta, o que foi
 * alocado aos animais e o que não foi, os animais-dia no pasto (07, 3.3), o R$/ha e o R$/animal-dia, e os totais por posse
 * (próprio × arrendado).
 */
var Custos = (function () {
  var CLASSES = ['SANITARIO', 'ALIMENTACAO', 'REPRODUCAO', 'OUTROS'];
  var CAMPO_CLASSE = { SANITARIO: 'sanitario', ALIMENTACAO: 'alimentacao', REPRODUCAO: 'reproducao', OUTROS: 'outros' };
  var VISOES = ['ANIMAIS', 'PASTOS'];
  var SITUACOES = ['TODOS', 'NO_REBANHO', 'SAIRAM'];
  var SEXOS = ['M', 'F'];
  var SITUACAO_DA_SAIDA = { VENDA: 'VENDIDO', MORTE: 'MORTO', DESCARTE: 'DESCARTADO' };
  var NATUREZAS_DO_ANIMAL = ['RECEITA_VENDA_ANIMAIS', 'OUTRA_RECEITA', 'AQUISICAO_ANIMAIS', 'CUSTEIO', 'DESPESA_VENDA'];
  var POSSES = ['PROPRIO', 'ARRENDADO'];

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function nulo_(v) {
    return vazio_(v) ? null : v;
  }
  function erro_(mensagem, campo, codigo) {
    return Validation.erro('VALIDATION', mensagem, [{ codigo: codigo || 'FORMATO_INVALIDO', campo: campo, mensagem: mensagem }]);
  }
  /** Divisão arredondada ao inteiro mais próximo, a metade para longe do zero (o custo diário, a margem, o R$/ha). */
  function razao_(num, den) {
    var q = num / den;
    return q < 0 ? -Math.round(-q) : Math.round(q);
  }
  function br_(d) {
    return Timeline.dataBr(d);
  }

  // ------------------------------------------------------------------ passagens e alocações ----
  /** As passagens do animal: as do marco zero em diante; sem nenhuma, a passagem histórica (o animal que só existe no histórico). */
  function passagens(fx, id) {
    return fx.permanencias[id] || (fx.historicas || {})[id] || [];
  }
  /** A passagem do animal em D: a última que começou até D (a aberta em D ou a última que se fechou até D); null antes da entrada. */
  function passagemEm(fx, id, D) {
    var achada = null;
    passagens(fx, id).forEach(function (p) { if (p.entrada.data <= D) achada = p; });
    return achada;
  }
  /** A passagem está fechada em D (a saída é até D). */
  function fechada_(p, D) {
    return !!p.saida && p.saida.data <= D;
  }
  /**
   * As alocações de cada animal em D: dos lançamentos com competência até D (os do histórico também: são do animal que só existe
   * nele), pelo rateio que vale em D, cada uma com a passagem a que pertence. {animal_id: [{l, r, a, passagem}]}.
   */
  function alocacoesEm(fx, D, so) {
    var out = {};
    fx.lancamentos.concat(fx.historico || []).forEach(function (l) {
      if (l.data > D || NATUREZAS_DO_ANIMAL.indexOf(l.natureza) < 0) return;
      var r = Conciliacao.rateioEm(l, D);
      if (!r) return;
      r.alocacoes.forEach(function (a) {
        if (so && !so[a.animal_id]) return;
        (out[a.animal_id] = out[a.animal_id] || []).push({ l: l, r: r, a: a, passagem: Conciliacao.passagemNaLista(passagens(fx, a.animal_id), l, r) });
      });
    });
    return out;
  }
  /** Quem é o custo de aquisição da passagem: a origem pela entrada (a mesma regra da projeção, Timeline.custo_). */
  function origemAquisicao_(p, itens) {
    var t = p.entrada.tipo;
    if (t === 'COMPRA') return 'NEGOCIADO';
    if (t === 'NASCIMENTO') return 'NAO_SE_APLICA';
    if (t === 'ENTRADA_INICIAL' && itens.some(function (x) { return x.l.natureza === 'AQUISICAO_ANIMAIS' && x.l.ancora === p.entrada.event_id; })) return p.entrada.abertura_estimada ? 'ABERTURA_ESTIMADA' : 'ABERTURA_INFORMADA';
    return 'DESCONHECIDO';
  }
  /** Os dias no rebanho da passagem até D: [entrada, saída) com a saída até D; aberta, o dia D conta. */
  function diasDaPassagem(p, D) {
    if (fechada_(p, D)) return Utils.diffDias(p.entrada.data, p.saida.data);
    return p.entrada.data > D ? 0 : Utils.diffDias(p.entrada.data, D) + 1;
  }
  /**
   * As contas de uma passagem em D (07, seção 6), sobre os itens (as alocações dela). `venda`: {arrobas, estimado, base} do animal
   * na venda que fechou a passagem (ou null). Devolve {aquisicao (null: desconhecido), aquisicao_origem, sanitario, alimentacao,
   * reproducao, outros, adicionais, custeio, custo_acumulado, receitas, despesas_venda, por_natureza, dias, fechada, custo_diario:
   * {valor, motivo}, resultado: {valor, motivo, mensagem?}, margem_arroba: {valor, arrobas, estimado, base, motivo}}.
   */
  function contas(p, itens, D, venda) {
    var o = { sanitario: 0, alimentacao: 0, reproducao: 0, outros: 0, custeio: 0, receitas: 0, despesas_venda: 0 };
    var por = { RECEITA_VENDA_ANIMAIS: 0, OUTRA_RECEITA: 0, AQUISICAO_ANIMAIS: 0, CUSTEIO: 0, DESPESA_VENDA: 0 };
    var temAquisicao = false;
    itens.forEach(function (x) {
      var v = x.a.valor || 0;
      por[x.l.natureza] += v;
      if (x.l.natureza === 'AQUISICAO_ANIMAIS') temAquisicao = true;
      if (x.l.natureza === 'CUSTEIO') { o.custeio += v; o[CAMPO_CLASSE[x.l.classe] || 'outros'] += v; }
      if (x.l.natureza === 'RECEITA_VENDA_ANIMAIS' || x.l.natureza === 'OUTRA_RECEITA') o.receitas += v;
      if (x.l.natureza === 'DESPESA_VENDA') o.despesas_venda += v;
    });
    var aquisicao = temAquisicao ? por.AQUISICAO_ANIMAIS : p.entrada.tipo === 'NASCIMENTO' ? 0 : null;
    var fechada = fechada_(p, D);
    var dias = diasDaPassagem(p, D);
    var acumulado = aquisicao === null ? null : aquisicao + o.custeio;
    var resultado;
    if (!fechada) resultado = { valor: null, motivo: 'DADOS_INSUFICIENTES', mensagem: 'O resultado só existe depois que o animal sai do rebanho.' };
    else if (acumulado === null) resultado = { valor: null, motivo: 'DADOS_INSUFICIENTES', mensagem: 'Sem custo de aquisição conhecido, o resultado não é calculado.' };
    else resultado = { valor: o.receitas - o.despesas_venda - acumulado, motivo: null };
    var margem = { valor: null, arrobas: null, estimado: false, base: null, motivo: null };
    if (venda && venda.arrobas > 0) { margem.arrobas = Math.round(venda.arrobas * 100) / 100; margem.estimado = venda.estimado === true; margem.base = venda.base; }
    if (resultado.valor === null) margem.motivo = 'DADOS_INSUFICIENTES';
    else if (!margem.arrobas) margem.motivo = 'SEM_VALOR_DE_REFERENCIA';
    else margem.valor = razao_(resultado.valor, venda.arrobas);
    return {
      aquisicao: aquisicao, aquisicao_origem: origemAquisicao_(p, itens), sanitario: o.sanitario, alimentacao: o.alimentacao, reproducao: o.reproducao,
      outros: o.outros, adicionais: o.reproducao + o.outros, custeio: o.custeio, custo_acumulado: acumulado, receitas: o.receitas, despesas_venda: o.despesas_venda,
      por_natureza: por, dias: dias, fechada: fechada,
      custo_diario: dias > 0 ? { valor: razao_(o.custeio, dias), motivo: null } : { valor: null, motivo: 'DADOS_INSUFICIENTES' },
      resultado: resultado, margem_arroba: margem,
    };
  }
  /**
   * As arrobas do animal na venda que fechou a passagem (07, seção 6: a margem por arroba): pelo peso de carcaça da linha dele
   * (apurado) ou pelo peso vivo da linha × o rendimento da venda (estimado, salvo o rendimento apurado); sem peso na linha, null.
   * {arrobas, estimado, base: CARCACA | VIVO}. `arrobaKg`: o parâmetro (padrão 15).
   */
  function arrobasNaVenda(repo, p, arrobaKg) {
    if (!p || !p.saida || p.saida.tipo !== 'VENDA' || vazio_(p.saida.event_animal_id)) return null;
    var kg = typeof arrobaKg === 'number' && arrobaKg > 0 ? arrobaKg : 15;
    var linha = repo.porId('EVENTO_ANIMAIS', p.saida.event_animal_id);
    if (!linha) return null;
    if (typeof linha.peso_carcaca_kg === 'number' && linha.peso_carcaca_kg > 0) return { arrobas: linha.peso_carcaca_kg / kg, estimado: false, base: 'CARCACA' };
    var v = repo.carregada('VENDAS') ? repo.por('VENDAS', 'event_id', p.saida.event_id)[0] : null;
    if (typeof linha.peso === 'number' && linha.peso > 0 && v && typeof v.rendimento_carcaca_pct === 'number' && v.rendimento_carcaca_pct > 0) {
      return { arrobas: linha.peso * v.rendimento_carcaca_pct / 100 / kg, estimado: v.rendimento_tipo !== 'APURADO', base: 'VIVO' };
    }
    return null;
  }
  /** Uma alocação do animal na lista (o critério de cada valor; 08, seção 3, bloco H). */
  function itemAlocacao_(fx, x, atual) {
    var c = (fx.contas || {})[x.l.conta_id] || {};
    return {
      passagem_atual: atual, financial_id: x.l.financial_id, event_id: x.l.event_id, event_type: x.l.event_type, event_date: x.l.event_date,
      data_competencia: x.l.data, conta_codigo: c.codigo || null, conta_nome: c.nome || null, natureza: x.l.natureza, tipo: x.l.tipo,
      classe_custo_animal: x.l.classe, descricao: x.l.descricao, valor_lancamento: x.l.valor, valor_alocado: x.a.valor, criterio: x.r.criterio || null,
      base_valor: x.a.base === undefined ? null : x.a.base, base_total: x.r.base_total === undefined ? null : x.r.base_total, partner_id: x.l.partner_id || null,
      rateio_event_id: x.r.event_id || null, rateio_data: x.r.data || null, pre_marco_zero: x.l.pre_marco_zero === true,
    };
  }
  /**
   * O custo do animal em D: a passagem em D, as contas dela e todas as alocações do animal até D (as de passagens anteriores ficam
   * na lista, fora das contas: `passagem_atual` false). {passagem, contas, lancamentos, anteriores, venda} — `passagem` null antes
   * da entrada.
   */
  function doAnimal(fx, id, D, venda, alocs) {
    var todas = (alocs || alocacoesEm(fx, D, mapaDe_([id])))[id] || [];
    var p = passagemEm(fx, id, D);
    var itens = todas.filter(function (x) { return x.passagem === p && p !== null; });
    var lista = todas.map(function (x) { return itemAlocacao_(fx, x, p !== null && x.passagem === p); });
    lista = Utils.ordenarPor(lista, [{ campo: 'event_date', desc: true }, 'conta_codigo', 'financial_id']);
    return { passagem: p, contas: p ? contas(p, itens, D, venda) : null, lancamentos: lista, anteriores: lista.filter(function (x) { return !x.passagem_atual; }).length };
  }
  function mapaDe_(ids) {
    var m = {};
    (ids || []).forEach(function (id) { m[id] = true; });
    return m;
  }

  // ------------------------------------------------------------------ bloco H da ficha ----
  /**
   * Bloco H da ficha (§11.2; 08, seção 16): o custo do animal hoje, pela mesma conta da rota `financeiro.custosAnimal` (a passagem
   * atual pela fazenda, ou a última), e todas as alocações dele com o critério de cada valor. Mantém os campos de antes (Fase 2:
   * custo_aquisicao, custo_aquisicao_origem, desde, lancamentos_anteriores, por_natureza, custeio, custo_acumulado, receitas,
   * despesas_venda, resultado, lancamentos) e acrescenta as classes do custo (sanitário, alimentação, adicionais), os dias, o custo
   * diário, a margem por arroba e a saída. `L`: o leitor do AnimalService (o hoje e o parâmetro da arroba).
   */
  function blocoFicha(tx, L, animal) {
    var a = animal || {};
    var fx = Conciliacao.fatos(tx, { animais: [a.animal_id] });
    var D = L.hoje;
    var p = passagemEm(fx, a.animal_id, D);
    var venda = arrobasNaVenda(tx.repo, p, (L.params || {}).arroba_kg);
    var r = doAnimal(fx, a.animal_id, D, venda);
    var c = r.contas;
    var vazio = { RECEITA_VENDA_ANIMAIS: 0, OUTRA_RECEITA: 0, AQUISICAO_ANIMAIS: 0, CUSTEIO: 0, DESPESA_VENDA: 0 };
    return {
      entregue: true, animal_id: a.animal_id || null, data: D,
      custo_aquisicao: c ? c.aquisicao : null, custo_aquisicao_origem: c ? c.aquisicao_origem : null,
      desde: p ? p.entrada.data : null, lancamentos_anteriores: r.anteriores,
      por_natureza: c ? c.por_natureza : vazio, custeio: c ? c.custeio : 0, custo_acumulado: c ? c.custo_acumulado : null,
      receitas: c ? c.receitas : 0, despesas_venda: c ? c.despesas_venda : 0,
      resultado: c ? c.resultado : { valor: null, motivo: 'DADOS_INSUFICIENTES', mensagem: a.situacao_cadastral === 'EXTERNO' ? 'Animal de fora do rebanho (referência): não tem custo nem resultado.' : 'O animal ainda não entrou no rebanho.' },
      classes: c ? { sanitario: c.sanitario, alimentacao: c.alimentacao, reproducao: c.reproducao, outros: c.outros, adicionais: c.adicionais } : { sanitario: 0, alimentacao: 0, reproducao: 0, outros: 0, adicionais: 0 },
      dias: c ? c.dias : null, custo_diario: c ? c.custo_diario : { valor: null, motivo: 'DADOS_INSUFICIENTES' },
      margem_arroba: c ? c.margem_arroba : { valor: null, arrobas: null, estimado: false, base: null, motivo: 'DADOS_INSUFICIENTES' },
      saida: p && p.saida ? { data: p.saida.data, tipo: p.saida.tipo, event_id: p.saida.event_id } : null,
      historica: !!(p && p.historica),
      lancamentos: r.lancamentos,
    };
  }

  // ------------------------------------------------------------------ custo por animal (lista) ----
  /** A situação da passagem em D: NO_REBANHO (aberta) ou a da saída (VENDIDO, MORTO, DESCARTADO, BAIXADO_AJUSTE). */
  function situacaoDaPassagem_(p, D) {
    if (!fechada_(p, D)) return 'NO_REBANHO';
    return SITUACAO_DA_SAIDA[p.saida.tipo] || 'BAIXADO_AJUSTE';
  }
  /**
   * Uma linha da lista: o animal na data de referência da passagem (D, aberta; o dia da saída, fechada) — o brinco, a categoria e
   * o pasto daquele dia — e as contas da passagem em D.
   */
  function linhaAnimal_(tx, L, fx, a, p, D, alocs) {
    var aberta = !fechada_(p, D);
    var ref = aberta ? D : p.saida.data;
    var linhas = L.f.linhas(a.animal_id);
    var pasto = aberta ? Timeline.situacaoEm(linhas, D, L.marcoZero).pasture_id : Timeline.pastoAntesDaSaida(linhas, ref, L.marcoZero).pasture_id;
    var cat = AnimalService.categoriaEm(L, a, ref);
    var pst = L.f.pasto(pasto);
    var venda = arrobasNaVenda(tx.repo, p, L.params.arroba_kg);
    var itens = (alocs[a.animal_id] || []).filter(function (x) { return x.passagem === p; });
    var c = contas(p, itens, D, venda);
    return {
      // A chave da linha é o animal e o dia da entrada (estável na correção do evento de entrada, que troca o identificador dele).
      chave: a.animal_id + '|' + p.entrada.data, animal_id: a.animal_id, codigo_interno: a.codigo_interno || null, brinco: Timeline.brincoEm(L.f, a.animal_id, ref),
      sexo: nulo_(a.sexo), categoria: cat ? { category_id: cat.category_id, nome: cat.nome } : null, pasture_id: nulo_(pasto), pasto_nome: pst ? pst.nome : null,
      property_id: pst ? pst.property_id : null, situacao: situacaoDaPassagem_(p, D), data_referencia: ref,
      entrada: { data: p.entrada.data, tipo: p.entrada.tipo }, saida: aberta ? null : { data: p.saida.data, tipo: p.saida.tipo },
      dias: c.dias, aquisicao: c.aquisicao, aquisicao_origem: c.aquisicao_origem, sanitario: c.sanitario, alimentacao: c.alimentacao, reproducao: c.reproducao,
      outros: c.outros, adicionais: c.adicionais, custeio: c.custeio, custo_acumulado: c.custo_acumulado, custo_diario: c.custo_diario, receitas: c.receitas,
      despesas_venda: c.despesas_venda, resultado: c.resultado, margem_arroba: c.margem_arroba,
    };
  }
  /** As datas do pedido: D (`data`, padrão hoje; não futura) e o início do período (`de`, padrão 1º de janeiro do ano de D). */
  function datas_(o, hoje) {
    var D = vazio_(o.data) ? hoje : o.data;
    if (typeof D !== 'string' || !Utils.dataValida(D)) throw erro_('Informe a data como uma data válida (aaaa-mm-dd).', 'data');
    if (!vazio_(hoje) && D > hoje) throw erro_('O custo é pedido até hoje: escolha hoje ou uma data passada.', 'data', 'DATA_FUTURA');
    var de = vazio_(o.de) ? D.slice(0, 4) + '-01-01' : o.de;
    if (typeof de !== 'string' || !Utils.dataValida(de)) throw erro_('Informe o início do período como uma data válida (aaaa-mm-dd).', 'de');
    if (de > D) throw erro_('O início do período (' + br_(de) + ') é depois da data (' + br_(D) + ').', 'de', 'PERIODO_INVERTIDO');
    return { D: D, de: de };
  }
  /** Os filtros da lista (07, seção 10, relatório 14: Pr, Pa, S, C): inexistente → NOT_FOUND; fora da lista → VALOR_FORA_DA_LISTA. */
  function filtros_(L, o) {
    var f = {};
    if (!vazio_(o.situacao)) {
      if (SITUACOES.indexOf(o.situacao) < 0) throw erro_('Escolha: todos, os do rebanho ou os que saíram no período.', 'situacao', 'VALOR_FORA_DA_LISTA');
      f.situacao = o.situacao;
    } else f.situacao = 'TODOS';
    if (!vazio_(o.sexo)) {
      if (SEXOS.indexOf(o.sexo) < 0) throw erro_('Escolha o sexo: macho ou fêmea.', 'sexo', 'VALOR_FORA_DA_LISTA');
      f.sexo = o.sexo;
    }
    if (!vazio_(o.pasture_id)) {
      if (!L.f.pasto(o.pasture_id)) throw Validation.erro('NOT_FOUND', 'Pasto não encontrado. Atualize a tela e tente de novo.');
      f.pasture_id = o.pasture_id;
    }
    if (!vazio_(o.property_id)) {
      if (!L.repo.porId('PROPRIEDADES', o.property_id)) throw Validation.erro('NOT_FOUND', 'Propriedade não encontrada. Atualize a tela e tente de novo.');
      f.property_id = o.property_id;
    }
    if (!vazio_(o.category_id)) {
      if (!L.categoriaPorId[o.category_id]) throw Validation.erro('NOT_FOUND', 'Categoria não encontrada. Atualize a tela e tente de novo.');
      f.category_id = o.category_id;
    }
    f.busca = vazio_(o.busca) ? null : Utils.normalizarTexto(String(o.busca));
    return f;
  }
  function casa_(f, x) {
    if (f.situacao === 'NO_REBANHO' && x.situacao !== 'NO_REBANHO') return false;
    if (f.situacao === 'SAIRAM' && x.situacao === 'NO_REBANHO') return false;
    if (f.sexo && x.sexo !== f.sexo) return false;
    if (f.pasture_id && x.pasture_id !== f.pasture_id) return false;
    if (f.property_id && x.property_id !== f.property_id) return false;
    if (f.category_id && (!x.categoria || x.categoria.category_id !== f.category_id)) return false;
    if (f.busca !== null && Utils.normalizarTexto([x.brinco || '', x.codigo_interno || ''].join(' ')).indexOf(f.busca) < 0) return false;
    return true;
  }
  var COLUNAS_TOTAIS = ['aquisicao', 'sanitario', 'alimentacao', 'reproducao', 'outros', 'adicionais', 'custeio', 'custo_acumulado', 'receitas', 'despesas_venda'];
  /**
   * O custo por animal em D (07, seção 10, relatório 14): cada passagem aberta em D e cada uma que se fechou no período [de, D]
   * (o animal que saiu e voltou tem uma linha por passagem), com os filtros; os totais de cada coluna (o custo acumulado e o
   * resultado só das linhas que os têm), quantos saíram sem custo de aquisição (o resultado "parcial", 07, seção 6) e o custeio do
   * período que não foi alocado a nenhum animal. Do marco zero em diante (o histórico anterior fica fora: 04, seção 6).
   */
  function listaAnimais(tx, L, fx, D, de, f) {
    var mz = L.marcoZero;
    if (vazio_(mz)) return { motivo: 'DADOS_INSUFICIENTES', mensagem: 'Sem o marco zero, o sistema ainda não tem as contas do rebanho.', itens: [], totais: null };
    if (D < mz) return { motivo: 'ANTERIOR_AO_MARCO_ZERO', mensagem: 'A data é anterior ao marco zero (' + br_(mz) + ').', itens: [], totais: null };
    var deEf = de < mz ? mz : de;
    var alocs = alocacoesEm(fx, D);
    var itens = [];
    Object.keys(fx.permanencias).sort().forEach(function (id) {
      var a = tx.repo.porId('ANIMAIS', id);
      if (!a) return;
      fx.permanencias[id].forEach(function (p) {
        if (p.entrada.data > D) return;
        if (fechada_(p, D) && p.saida.data < deEf) return;
        var x = linhaAnimal_(tx, L, fx, a, p, D, alocs);
        if (casa_(f, x)) itens.push(x);
      });
    });
    itens = Utils.ordenarPor(itens, [function (x) { return x.codigo_interno || ''; }, function (x) { return x.entrada.data; }]);
    var totais = { animais: itens.length, no_rebanho: 0, sairam: 0, resultado: 0, com_resultado: 0, parciais: 0, dias: 0 };
    COLUNAS_TOTAIS.forEach(function (k) { totais[k] = 0; });
    itens.forEach(function (x) {
      COLUNAS_TOTAIS.forEach(function (k) { if (typeof x[k] === 'number') totais[k] += x[k]; });
      totais.dias += x.dias;
      if (x.situacao === 'NO_REBANHO') totais.no_rebanho++; else totais.sairam++;
      if (x.resultado.valor !== null) { totais.resultado += x.resultado.valor; totais.com_resultado++; }
      else if (x.situacao !== 'NO_REBANHO') totais.parciais++;
    });
    totais.sem_custo_aquisicao = itens.filter(function (x) { return x.aquisicao === null; }).length;
    return {
      motivo: null, de: deEf, antes_do_marco_zero: de < mz, itens: itens, totais: totais,
      custeio_nao_alocado: { de: deEf, ate: D, valor: Conciliacao.custeioNaoAlocado(fx, deEf, D) },
      parcial: totais.parciais ? { cabecas: totais.parciais, mensagem: 'Parcial: ' + totais.parciais + (totais.parciais === 1 ? ' cabeça saiu' : ' cabeças saíram') + ' sem custo de aquisição conhecido (o resultado delas não entra na soma).' } : null,
    };
  }

  // ------------------------------------------------------------------ custo por pasto ----
  /**
   * O custo por pasto no período [de, ate] (07, seção 10, relatório 15): os lançamentos de custeio com o pasto, pela parte da
   * competência no período (a 1.1), por conta; o que foi alocado aos animais (pelo rateio que vale em `ate`) e o que não foi, na
   * mesma proporção da competência; os animais-dia no pasto no período (07, 3.3: [entrada, saída), o dia da entrada conta, o da
   * saída não); o R$/ha (pela área do cadastro) e o R$/animal-dia; os totais por posse (próprio × arrendado) e o custeio do
   * período sem pasto. Lista os pastos com custo ou animal no período e os ativos.
   */
  function listaPastos(tx, L, fx, de, ate) {
    var mz = L.marcoZero;
    if (vazio_(mz)) return { motivo: 'DADOS_INSUFICIENTES', mensagem: 'Sem o marco zero, o sistema ainda não tem as contas do rebanho.', pastos: [], por_posse: null };
    if (ate < mz) return { motivo: 'ANTERIOR_AO_MARCO_ZERO', mensagem: 'O período termina antes do marco zero (' + br_(mz) + ').', pastos: [], por_posse: null };
    var deEf = de < mz ? mz : de;
    var dp = Timeline.diasPermanencia(L.f.todasAsLinhas(), { inicio: deEf, fim: ate }, { tipo: 'REBANHO' }, { marcoZero: mz });
    var diasDoPasto = {};
    (dp.por_pasto || []).forEach(function (x) { if (x.pasture_id) diasDoPasto[x.pasture_id] = x.dias; });
    var porPasto = {};
    var semPasto = 0;
    var contasCad = fx.contas || {};
    fx.lancamentos.forEach(function (l) {
      if (l.natureza !== 'CUSTEIO' || l.data > ate) return;
      var parte = Conciliacao.competenciaEntre(l, deEf, ate);
      if (!parte) return;
      if (!l.pasture_id) { semPasto += parte; return; }
      var alocado = Conciliacao.alocacoesEm(l, ate).reduce(function (s, a) { return s + a.valor; }, 0);
      var na = Conciliacao.competenciaEntre({ valor: l.valor - alocado, data: l.data, inicio: l.inicio, fim: l.fim }, deEf, ate);
      var g = porPasto[l.pasture_id] = porPasto[l.pasture_id] || { custo: 0, alocado: 0, nao_alocado: 0, contas: {}, lancamentos: [] };
      g.custo += parte;
      g.nao_alocado += na;
      g.alocado += parte - na;
      var c = contasCad[l.conta_id] || {};
      var k = l.conta_id || '-';
      var gc = g.contas[k] = g.contas[k] || { conta_id: l.conta_id || null, codigo: c.codigo || null, nome: c.nome || null, ordem: typeof c.ordem === 'number' ? c.ordem : 0, valor: 0 };
      gc.valor += parte;
      var r = Conciliacao.rateioEm(l, ate);
      g.lancamentos.push({
        financial_id: l.financial_id, event_id: l.event_id, descricao: l.descricao, conta_nome: c.nome || null, data_competencia: l.data, competencia_inicio: l.inicio,
        competencia_fim: l.fim, valor_lancamento: l.valor, valor_periodo: parte, alocado_periodo: parte - na, nao_alocado_periodo: na,
        alocado_lancamento: alocado, criterio: r ? r.criterio : null, rateio_data: r ? r.data : null,
      });
    });
    var pastos = [];
    tx.repo.vigentes('PASTOS').forEach(function (p) {
      var g = porPasto[p.pasture_id];
      var dias = diasDoPasto[p.pasture_id] || 0;
      if (!g && !dias && p.status !== 'ATIVO') return;
      g = g || { custo: 0, alocado: 0, nao_alocado: 0, contas: {}, lancamentos: [] };
      var arr = vazio_(p.arrendador_id) ? null : tx.repo.porId('PARCEIROS', p.arrendador_id);
      var area = typeof p.area_hectares === 'number' && p.area_hectares > 0 ? p.area_hectares : null;
      pastos.push({
        pasture_id: p.pasture_id, nome: p.nome, identificacao: nulo_(p.identificacao), property_id: p.property_id, status: p.status, posse: p.posse || 'PROPRIO',
        arrendador_id: nulo_(p.arrendador_id), arrendador_nome: arr ? arr.nome : null, area_hectares: area,
        custo: g.custo, alocado: g.alocado, nao_alocado: g.nao_alocado, animais_dia: dias,
        custo_ha: area === null ? { valor: null, motivo: 'DADOS_INSUFICIENTES', mensagem: 'Sem a área do pasto no cadastro.' } : { valor: razao_(g.custo, area), motivo: null },
        custo_animal_dia: dias > 0 ? { valor: razao_(g.custo, dias), motivo: null } : { valor: null, motivo: 'DADOS_INSUFICIENTES', mensagem: 'Nenhum animal no pasto no período.' },
        contas: Object.keys(g.contas).map(function (k) { return g.contas[k]; }).sort(function (a, b) { return (a.ordem - b.ordem) || ((a.codigo || '') < (b.codigo || '') ? -1 : 1); }),
        lancamentos: Utils.ordenarPor(g.lancamentos, [{ campo: 'data_competencia', desc: true }, 'financial_id']),
      });
    });
    pastos = Utils.ordenarPor(pastos, [function (x) { return x.posse === 'ARRENDADO' ? 1 : 0; }, function (x) { return Utils.normalizarTexto(x.nome || ''); }, 'pasture_id']);
    var porPosse = {};
    POSSES.forEach(function (k) { porPosse[k] = { posse: k, pastos: 0, custo: 0, alocado: 0, nao_alocado: 0, animais_dia: 0 }; });
    var total = { pastos: 0, custo: 0, alocado: 0, nao_alocado: 0, animais_dia: 0 };
    pastos.forEach(function (x) {
      var t = porPosse[x.posse] || (porPosse[x.posse] = { posse: x.posse, pastos: 0, custo: 0, alocado: 0, nao_alocado: 0, animais_dia: 0 });
      [t, total].forEach(function (s) { s.pastos++; s.custo += x.custo; s.alocado += x.alocado; s.nao_alocado += x.nao_alocado; s.animais_dia += x.animais_dia; });
    });
    Object.keys(porPosse).forEach(function (k) { var t = porPosse[k]; t.custo_animal_dia = t.animais_dia > 0 ? razao_(t.custo, t.animais_dia) : null; });
    total.custo_animal_dia = total.animais_dia > 0 ? razao_(total.custo, total.animais_dia) : null;
    return {
      motivo: null, de: deEf, ate: ate, antes_do_marco_zero: de < mz, pastos: pastos, por_posse: POSSES.map(function (k) { return porPosse[k]; }), total: total,
      custeio_sem_pasto: semPasto, animais_dia_total: dp.base_total || 0,
    };
  }

  // ------------------------------------------------------------------ consulta ----
  function leituras() {
    return Utils.unicos(Conciliacao.leituras().concat(AnimalService.leituras(), ['PROPRIEDADES', 'PARCEIROS', 'VENDAS', 'PLANO_CONTAS']));
  }
  /**
   * Consulta `financeiro.custosAnimal` (rota canônica; 08, seções 3 e 16: "Financeiro: custos", o custo por animal e o agregado
   * por pasto). dados: {visao? (ANIMAIS — padrão — | PASTOS), animal_id? (o custo de um animal em D, com as alocações e o
   * critério de cada uma), data? (D; padrão hoje), de? (o início do período: quem saiu nele e o custo do pasto; padrão 1º de
   * janeiro do ano de D), situacao? (TODOS, NO_REBANHO, SAIRAM), sexo?, pasture_id?, property_id?, category_id? (o pasto e a
   * categoria do animal em D; de quem saiu, os do dia da saída), busca? (brinco ou código)}. Data inválida → FORMATO_INVALIDO;
   * futura → DATA_FUTURA; `de` depois de D → PERIODO_INVERTIDO; visão, situação ou sexo fora da lista → VALOR_FORA_DA_LISTA;
   * animal, pasto, propriedade ou categoria inexistente → NOT_FOUND.
   */
  function consulta(dados) {
    var o = dados || {};
    return {
      rota: 'financeiro.custosAnimal', dados: o, reads: leituras(), acessoCru: true,
      tratador: function (tx) {
        var visao = vazio_(o.visao) ? 'ANIMAIS' : o.visao;
        if (VISOES.indexOf(visao) < 0) throw erro_('Escolha a visão: por animal ou por pasto.', 'visao', 'VALOR_FORA_DA_LISTA');
        var L = AnimalService.leitor(tx);
        var dt = datas_(o, tx.hoje);
        if (!vazio_(o.animal_id)) {
          var a = tx.repo.porId('ANIMAIS', o.animal_id);
          if (!a || a.situacao_cadastral === 'EXTERNO') throw Validation.erro('NOT_FOUND', 'Animal não encontrado. Atualize a tela e tente de novo.');
          var fa = Conciliacao.fatos(tx, { animais: [a.animal_id] });
          var p = passagemEm(fa, a.animal_id, dt.D);
          var r = doAnimal(fa, a.animal_id, dt.D, arrobasNaVenda(tx.repo, p, L.params.arroba_kg));
          var linha = null;
          if (p) linha = linhaAnimal_(tx, L, fa, a, p, dt.D, alocacoesEm(fa, dt.D, mapaDe_([a.animal_id])));
          return {
            visao: 'ANIMAL', data: dt.D, animal_id: a.animal_id, codigo_interno: a.codigo_interno || null, historica: !!(p && p.historica),
            animal: linha, motivo: p ? null : 'DADOS_INSUFICIENTES', mensagem: p ? null : 'O animal ainda não tinha entrado no rebanho nessa data.',
            lancamentos: r.lancamentos, anteriores: r.anteriores,
          };
        }
        var fx = Conciliacao.fatos(tx);
        if (visao === 'PASTOS') {
          var lp = listaPastos(tx, L, fx, dt.de, dt.D);
          lp.visao = 'PASTOS';
          lp.data = dt.D;
          return lp;
        }
        var la = listaAnimais(tx, L, fx, dt.D, dt.de, filtros_(L, o));
        la.visao = 'ANIMAIS';
        la.data = dt.D;
        if (vazio_(la.de)) la.de = dt.de;
        return la;
      },
    };
  }
  function custosAnimal(ctx, dados) {
    return UnitOfWork.read(ctx, consulta(dados));
  }

  return {
    CLASSES: CLASSES,
    VISOES: VISOES,
    SITUACOES: SITUACOES,
    passagens: passagens,
    passagemEm: passagemEm,
    alocacoesEm: alocacoesEm,
    diasDaPassagem: diasDaPassagem,
    contas: contas,
    arrobasNaVenda: arrobasNaVenda,
    doAnimal: doAnimal,
    blocoFicha: blocoFicha,
    listaAnimais: listaAnimais,
    listaPastos: listaPastos,
    leituras: leituras,
    consulta: consulta,
    custosAnimal: custosAnimal,
  };
})();
