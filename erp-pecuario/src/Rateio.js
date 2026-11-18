/**
 * Rateio — a base de cada animal num rateio de custo compartilhado (Fase 4, E4.3; 07, seção 3; 03b, seções 12 e 13; 05,
 * seções 4.5 e 4.6). Puro: lê pelo leitor das consultas de animal (AnimalService.leitor) e devolve dados simples. É a MESMA
 * conta no evento RATEIO (registro, simulação, correção), na verificação de integridade (o alerta BASE_RATEIO: a base
 * recalculada hoje × a gravada) e no detalhe do lançamento ("rateio desatualizado"): uma regra, um lugar.
 *
 * Critério × escopo (o universo de animais):
 *  - EVENTO (os animais do evento de negócio a que o lançamento se refere: o `ref_event_id` ou o evento que o criou): CABECAS
 *    (1), PESO_VIVO (o peso do animal no evento), PESO_CARCACA (a carcaça no evento), VALOR_INDIVIDUAL (o valor do animal no
 *    evento; quem não tem valor fica fora, como no saldo de abertura) e MANUAL (o valor digitado de cada animal do evento);
 *  - REBANHO, PASTO (o pasto) e CATEGORIA (a categoria): CABECAS e PESO_VIVO pelos animais no rebanho (no pasto, na categoria)
 *    no fim do dia da data-base; DIAS_PERMANENCIA pelos dias de cada animal no escopo dentro do período (Timeline.diasPermanencia:
 *    [entrada, saída), o dia da entrada conta e o da saída não);
 *  - LISTA (os animais escolhidos): CABECAS e PESO_VIVO (cada um no rebanho na data-base), DIAS_PERMANENCIA (cada um com dias
 *    no rebanho no período) e MANUAL (o valor digitado de cada um, no rebanho na data-base).
 * PESO_VIVO fora do escopo EVENTO é o peso vigente na data-base pela regra da Fase 3 (AnimalService.pesoVigente: a última
 * pesagem até a data dentro da validade; vencida ou sem pesagem, o peso de referência da categoria, estimado): o estimado só
 * entra com o aceite do aviso RATEIO_SEM_PESO (RN-073), e o animal sem peso nenhum bloqueia.
 */
var Rateio = (function () {
  var CRITERIOS = ['CABECAS', 'PESO_VIVO', 'PESO_CARCACA', 'VALOR_INDIVIDUAL', 'DIAS_PERMANENCIA', 'MANUAL'];
  var ESCOPOS = ['EVENTO', 'REBANHO', 'PASTO', 'CATEGORIA', 'LISTA'];
  var CRITERIOS_DO_ESCOPO = Object.freeze({
    EVENTO: ['CABECAS', 'PESO_VIVO', 'PESO_CARCACA', 'VALOR_INDIVIDUAL', 'MANUAL'],
    REBANHO: ['CABECAS', 'PESO_VIVO', 'DIAS_PERMANENCIA'],
    PASTO: ['CABECAS', 'PESO_VIVO', 'DIAS_PERMANENCIA'],
    CATEGORIA: ['CABECAS', 'PESO_VIVO', 'DIAS_PERMANENCIA'],
    LISTA: ['CABECAS', 'PESO_VIVO', 'DIAS_PERMANENCIA', 'MANUAL'],
  });
  /** Critérios que tomam o rebanho numa data (a data-base) e os que medem um período. */
  var NA_DATA_BASE = ['CABECAS', 'PESO_VIVO', 'MANUAL'];
  var NOME_CRITERIO = {
    DIRETO: 'direto a um animal', VALOR_INDIVIDUAL: 'pelo valor de cada animal', CABECAS: 'por cabeça', PESO_VIVO: 'pelo peso vivo',
    PESO_CARCACA: 'pelo peso de carcaça', DIAS_PERMANENCIA: 'pelos dias de permanência', MANUAL: 'pelo valor digitado de cada animal',
  };
  /** Papéis de linha que formam o universo de um evento (o sujeito; a cria, a matriz e o touro não pagam o custo do evento). */
  var PAPEIS_DO_EVENTO = { SUJEITO: true };

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function br_(d) {
    return Timeline.dataBr(d);
  }
  function problema_(codigo, campo, mensagem, animalId) {
    return { codigo: codigo, campo: campo, animal_id: animalId || null, mensagem: mensagem };
  }
  function nome_(a) {
    if (!a) return 'animal';
    return !vazio_(a.brinco) ? a.brinco : a.codigo_interno;
  }
  /** Abas que a conta da base lê (as do leitor de animais e as do lançamento). */
  function leituras() {
    return Utils.unicos(AnimalService.leituras().concat(Timeline.LEITURAS, ['FINANCEIRO', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'PLANO_CONTAS']));
  }
  /** "por dias de permanência no pasto Retiro, de 01/06/2027 a 30/06/2027": o rateio na linguagem do pecuarista. */
  function descrever(spec, nomes) {
    var s = spec || {};
    var n = nomes || {};
    var crit = NOME_CRITERIO[s.criterio] || String(s.criterio || '').toLowerCase();
    var onde = s.escopo_tipo === 'EVENTO' ? ' entre os animais ' + (n.evento ? 'd' + n.evento : 'do evento')
      : s.escopo_tipo === 'PASTO' ? ' no pasto ' + (n.pasto || s.escopo_ref)
        : s.escopo_tipo === 'CATEGORIA' ? ' na categoria ' + (n.categoria || s.escopo_ref)
          : s.escopo_tipo === 'LISTA' ? ' entre os animais escolhidos' : ' no rebanho';
    var quando = s.criterio === 'DIAS_PERMANENCIA' && s.periodo_inicio ? ', de ' + br_(s.periodo_inicio) + ' a ' + br_(s.periodo_fim)
      : s.escopo_tipo !== 'EVENTO' && s.data_base ? ', em ' + br_(s.data_base) : '';
    return crit + onde + quando;
  }
  /**
   * O universo de um evento: os animais das linhas de sujeito (sem repetir), com a linha de cada um.
   */
  function linhasDoEvento_(L, eventId) {
    var vistos = {};
    var out = [];
    (L.tx.cru ? L.tx.cru.cruPor('EVENTO_ANIMAIS', 'event_id', eventId) : L.repo.por('EVENTO_ANIMAIS', 'event_id', eventId)).forEach(function (l) {
      if (!(vazio_(l.papel) || PAPEIS_DO_EVENTO[l.papel]) || vistos[l.animal_id]) return;
      vistos[l.animal_id] = true;
      out.push(l);
    });
    return out;
  }
  /** "no pasto Retiro", "na categoria Bezerro", "no rebanho": o escopo nas frases da base zero. */
  function onde_(L, s) {
    if (s.escopo_tipo === 'PASTO') { var p = L.f.pasto(s.escopo_ref); return 'no pasto ' + (p ? p.nome : s.escopo_ref); }
    if (s.escopo_tipo === 'CATEGORIA') { var c = L.categoriaPorId[s.escopo_ref]; return 'na categoria ' + (c ? c.nome : s.escopo_ref); }
    return 'no rebanho';
  }
  function animal_(L, id) {
    return L.repo.porId('ANIMAIS', id) || (L.tx.cru ? L.tx.cru.cruPorId('ANIMAIS', id) : null);
  }
  /**
   * A base de cada animal pelo critério e pelo escopo (o cabeçalho de 03b, 12.2). spec: {criterio, escopo_tipo, escopo_ref
   * (o evento, o pasto ou a categoria), animais: [{animal_id, valor (centavos, só MANUAL)}] (LISTA e MANUAL), periodo_inicio,
   * periodo_fim, data_base}. Devolve {itens: [{animal_id, chave (codigo_interno), base, estimado, quem}], motivo (base zero:
   * por que ninguém entrou), estimados: [{animal_id, quem, situacao}], parcial (o período começa antes do marco zero),
   * problemas: [{codigo, campo, animal_id, mensagem}]}. Nada é lançado: quem chama decide (o evento recusa com os problemas;
   * a verificação diz que o rateio não pode mais ser refeito).
   */
  function bases(L, spec) {
    var s = spec || {};
    var out = { itens: [], motivo: null, estimados: [], parcial: false, problemas: [] };
    var prob = function (codigo, campo, mensagem, id) { out.problemas.push(problema_(codigo, campo, mensagem, id)); };
    var item = function (a, base, estimado) { out.itens.push({ animal_id: a.animal_id, chave: a.codigo_interno || a.animal_id, base: base, estimado: !!estimado, quem: nome_(a) }); };
    var crit = s.criterio;
    if (s.escopo_tipo === 'EVENTO') {
      var linhas = linhasDoEvento_(L, s.escopo_ref);
      if (!linhas.length) { prob('ESCOPO_SEM_ANIMAIS', 'escopo_tipo', 'O lançamento não se refere a um registro com animais: escolha outro escopo (pasto, rebanho, categoria ou animais escolhidos).'); return out; }
      var manual = {};
      if (crit === 'MANUAL') {
        (s.animais || []).forEach(function (x) { manual[x.animal_id] = x; });
        Object.keys(manual).forEach(function (id) {
          if (!linhas.some(function (l) { return l.animal_id === id; })) prob('FORA_DO_ESCOPO', 'animais', nome_(animal_(L, id)) + ' não é um dos animais do registro a que o lançamento se refere.', id);
        });
      }
      linhas.forEach(function (l) {
        var a = animal_(L, l.animal_id) || { animal_id: l.animal_id, codigo_interno: l.animal_id };
        if (crit === 'CABECAS') item(a, 1);
        else if (crit === 'PESO_VIVO') {
          if (typeof l.peso === 'number' && l.peso > 0) item(a, l.peso);
          else prob('SEM_PESO', 'criterio', nome_(a) + ' não tem o peso no registro: divida por cabeça ou pelo valor.', a.animal_id);
        } else if (crit === 'PESO_CARCACA') {
          if (typeof l.peso_carcaca_kg === 'number' && l.peso_carcaca_kg > 0) item(a, l.peso_carcaca_kg);
          else prob('SEM_PESO', 'criterio', nome_(a) + ' não tem o peso de carcaça no registro: divida pelo peso vivo ou por cabeça.', a.animal_id);
        } else if (crit === 'VALOR_INDIVIDUAL') {
          if (typeof l.valor_individual === 'number' && l.valor_individual > 0) item(a, l.valor_individual / 100);
        } else if (crit === 'MANUAL') {
          var m = manual[a.animal_id];
          if (m) item(a, m.valor / 100);
        }
      });
      if (crit === 'VALOR_INDIVIDUAL' && !out.itens.length) prob('SEM_VALOR', 'criterio', 'Nenhum animal do registro tem valor próprio: divida por cabeça ou pelo peso.');
      return out;
    }
    if (crit === 'DIAS_PERMANENCIA') {
      var escopo = { tipo: s.escopo_tipo, ref: s.escopo_tipo === 'LISTA' ? (s.animais || []).map(function (x) { return x.animal_id; }) : s.escopo_ref };
      var opcoes = { marcoZero: L.marcoZero };
      if (s.escopo_tipo === 'CATEGORIA') {
        opcoes.categoriaEm = function (id, dia) {
          var a = animal_(L, id);
          var c = a ? AnimalService.categoriaEm(L, a, dia) : null;
          return c ? c.category_id : null;
        };
      }
      var dp = Timeline.diasPermanencia(L.f.todasAsLinhas(), { inicio: s.periodo_inicio, fim: s.periodo_fim }, escopo, opcoes);
      if (dp.motivo) { prob(dp.motivo === 'ANTERIOR_AO_MARCO_ZERO' ? 'ANTERIOR_AO_MARCO_ZERO' : 'DADOS_INSUFICIENTES', 'periodo_fim', dp.motivo === 'ANTERIOR_AO_MARCO_ZERO' ? 'O período é todo anterior ao marco zero: não há permanência registrada para medir.' : 'Defina o marco zero antes de ratear por dias de permanência.'); return out; }
      out.parcial = dp.parcial;
      var comDias = {};
      dp.itens.forEach(function (x) {
        var a = animal_(L, x.animal_id) || { animal_id: x.animal_id, codigo_interno: x.animal_id };
        comDias[x.animal_id] = true;
        item(a, x.dias);
      });
      if (s.escopo_tipo === 'LISTA') {
        escopo.ref.forEach(function (id) { if (!comDias[id]) prob('FORA_DO_ESCOPO', 'animais', nome_(animal_(L, id)) + ' não esteve no rebanho de ' + br_(s.periodo_inicio) + ' a ' + br_(s.periodo_fim) + ': tire-o da lista.', id); });
      }
      if (!out.itens.length && !out.problemas.length) out.motivo = 'nenhum animal ' + onde_(L, s) + ' de ' + br_(s.periodo_inicio) + ' a ' + br_(s.periodo_fim);
      return out;
    }
    // CABECAS, PESO_VIVO e MANUAL: o rebanho no fim do dia da data-base.
    var D = s.data_base;
    var pres = InventoryService.presentes(L, D);
    if (pres.motivo) { prob(pres.motivo === 'ANTERIOR_AO_MARCO_ZERO' ? 'ANTERIOR_AO_MARCO_ZERO' : 'DADOS_INSUFICIENTES', 'data_base', pres.motivo === 'ANTERIOR_AO_MARCO_ZERO' ? 'A data-base é anterior ao marco zero.' : 'Defina o marco zero antes de ratear.'); return out; }
    var porId = {};
    pres.itens.forEach(function (x) { porId[x.registro.animal_id] = x; });
    var candidatos = [];
    if (s.escopo_tipo === 'LISTA') {
      (s.animais || []).forEach(function (x) {
        var p = porId[x.animal_id];
        if (!p) { prob('FORA_DO_ESCOPO', 'animais', nome_(animal_(L, x.animal_id)) + ' não estava no rebanho em ' + br_(D) + ' (a data-base): tire-o da lista ou mude a data-base.', x.animal_id); return; }
        candidatos.push({ p: p, x: x });
      });
    } else {
      pres.itens.forEach(function (p) {
        if (s.escopo_tipo === 'PASTO' && p.pasture_id !== s.escopo_ref) return;
        if (s.escopo_tipo === 'CATEGORIA') {
          var c = AnimalService.categoriaEm(L, p.registro, D);
          if (!c || c.category_id !== s.escopo_ref) return;
        }
        candidatos.push({ p: p, x: null });
      });
    }
    candidatos.forEach(function (c) {
      var a = c.p.registro;
      if (crit === 'CABECAS') { item(a, 1); return; }
      if (crit === 'MANUAL') { item(a, c.x.valor / 100); return; }
      var cat = AnimalService.categoriaEm(L, a, D);
      var pv = AnimalService.pesoVigente(L, a, D, cat);
      if (typeof pv.kg !== 'number' || !(pv.kg > 0)) { prob('SEM_PESO', 'criterio', nome_(a) + ' não tem pesagem até ' + br_(D) + ' nem peso de referência na categoria: pese o animal ou divida por cabeça.', a.animal_id); return; }
      var kg = Utils.arredondar(pv.kg, 4);
      item(a, kg, pv.estimado);
      if (pv.estimado) out.estimados.push({ animal_id: a.animal_id, quem: nome_(a), situacao: pv.situacao });
    });
    if (!out.itens.length && !out.problemas.length) out.motivo = 'nenhum animal ' + onde_(L, s) + ' em ' + br_(D);
    return out;
  }
  /**
   * A base gravada × a recalculada hoje (03b, seção 12.3: "rateio desatualizado"; nunca recalcula em silêncio). `alocacoes`:
   * as linhas gravadas do rateio; `recalculo`: o resultado de `bases`. Devolve {desatualizado, refazivel, diferencas:
   * [{animal_id, gravada (base ou null), hoje (base ou null)}], problemas}. Refazível = a conta de hoje não tem problema (o
   * animal escolhido que saiu do escopo, o peso que sumiu).
   */
  function comparar(alocacoes, recalculo) {
    var gravada = {};
    (alocacoes || []).forEach(function (a) { gravada[a.animal_id] = a.base_valor; });
    var hoje = {};
    (recalculo.itens || []).forEach(function (x) { hoje[x.animal_id] = x.base; });
    var dif = [];
    Utils.unicos(Object.keys(gravada).concat(Object.keys(hoje))).sort().forEach(function (id) {
      var g = gravada[id] === undefined ? null : gravada[id];
      var h = hoje[id] === undefined ? null : hoje[id];
      if (g === null || h === null || Math.abs(g - h) > 1e-9) dif.push({ animal_id: id, gravada: g, hoje: h });
    });
    return { desatualizado: dif.length > 0 || (recalculo.problemas || []).length > 0, refazivel: !(recalculo.problemas || []).length, diferencas: dif, problemas: recalculo.problemas || [] };
  }

  /**
   * O pedido de um rateio gravado por um evento RATEIO, refeito das linhas (03b, seção 12.2): o critério pedido (o do payload
   * quando o rateio ficou com um animal só e virou DIRETO), o escopo, o período, a data-base e, nos animais escolhidos e no
   * valor digitado, os animais das alocações (com o valor de cada um no MANUAL). `cru`: a leitura crua (as linhas do rateio).
   */
  function specGravado(cru, r) {
    var ev = cru.cruPorId('EVENTOS', r.event_id) || {};
    var pj = ev.payload_json || {};
    var crit = vazio_(pj.criterio_pedido) ? r.criterio : pj.criterio_pedido;
    var allocs = cru.cruPor('ALOCACOES_FINANCEIRAS', 'rateio_id', r.rateio_id);
    var comLista = r.escopo_tipo === 'LISTA' || crit === 'MANUAL';
    return {
      criterio: crit, escopo_tipo: r.escopo_tipo, escopo_ref: vazio_(r.escopo_ref) ? null : r.escopo_ref,
      periodo_inicio: vazio_(r.periodo_inicio) ? null : r.periodo_inicio, periodo_fim: vazio_(r.periodo_fim) ? null : r.periodo_fim,
      data_base: vazio_(r.data_base) ? null : r.data_base,
      animais: comLista ? Utils.ordenarPor(allocs.map(function (a) { return { animal_id: a.animal_id, valor: crit === 'MANUAL' ? a.valor_alocado : null }; }), 'animal_id') : [],
    };
  }
  /**
   * O rateio gravado por um evento RATEIO × a base refeita hoje (o alerta BASE_RATEIO e o "rateio desatualizado" do detalhe do
   * lançamento): {desatualizado, refazivel, diferencas, problemas} (comparar).
   */
  function desatualizado(L, cru, r) {
    var gravadas = cru.cruPor('ALOCACOES_FINANCEIRAS', 'rateio_id', r.rateio_id);
    var hoje = bases(L, specGravado(cru, r));
    // Com um animal só, o rateio é DIRETO e a base gravada é o valor (invariante 13): continua o mesmo se hoje também é só ele.
    if (r.criterio === 'DIRETO' && gravadas.length === 1 && hoje.itens.length === 1 && hoje.itens[0].animal_id === gravadas[0].animal_id) hoje.itens[0].base = gravadas[0].base_valor;
    return comparar(gravadas, hoje);
  }

  return {
    specGravado: specGravado,
    desatualizado: desatualizado,
    CRITERIOS: CRITERIOS,
    ESCOPOS: ESCOPOS,
    CRITERIOS_DO_ESCOPO: CRITERIOS_DO_ESCOPO,
    NA_DATA_BASE: NA_DATA_BASE,
    NOME_CRITERIO: NOME_CRITERIO,
    leituras: leituras,
    descrever: descrever,
    bases: bases,
    comparar: comparar,
  };
})();
