/**
 * ReproductionService — reprodução do rebanho (Fase 2: partos; Fase 3, E3.4 e E3.5: estação de monta, exposição,
 * cobertura, inseminação, diagnóstico, aborto, desmama e castração; 03a, seção 4.10; 03b, seção 7; 04, seção 3.3; 05,
 * seção 2.9; 07, seção 8.3). O sistema registra o que o veterinário e o dono decidem: nada aqui prescreve.
 *
 * Puro: recebe a fonte da linha do tempo (`Timeline.fonte`) ou o leitor do AnimalService; só o cadastro da estação grava,
 * pela UnitOfWork. Um parto é um evento NASCIMENTO com UMA linha REPRODUCAO (PARTO), mesmo gemelar e mesmo com zero
 * nascidos vivos (DV-15). A situação reprodutiva é projeção (Timeline), nunca pré-condição (RN-065); a previsão de parto e os
 * indicadores são calculados na leitura e nunca viram fato (P1, P10).
 */
var ReproductionService = (function () {
  var SUBTIPOS = ['EXPOSICAO', 'COBERTURA', 'INSEMINACAO', 'DIAGNOSTICO_GESTACAO', 'ABORTO'];
  /** Fatos que expõem a fêmea numa estação (07, seção 8.3: "exposta em E"). */
  var EXPOEM = ['EXPOSICAO', 'COBERTURA', 'INSEMINACAO'];
  var TIPOS_ESTACAO = ['MONTA_NATURAL', 'IA', 'MISTA'];
  var CAMPOS_ESTACAO = ['property_id', 'nome', 'data_inicio', 'data_fim', 'tipo', 'observacoes'];
  var LEITURAS_ESTACAO = ['ESTACOES_MONTA', 'PROPRIEDADES', 'REPRODUCAO'];
  var SAIDAS = ['VENDA', 'MORTE', 'DESCARTE', 'AJUSTE_INVENTARIO'];
  var NOME_SITUACAO = { NAO_APTA: 'Não apta (jovem)', SEM_INFORMACAO: 'Sem informação', VAZIA: 'Vazia', EXPOSTA: 'Exposta ao touro', INSEMINADA: 'Inseminada', PRENHA: 'Prenhe' };
  var NOME_FATO = { EXPOSICAO: 'exposição ao touro', COBERTURA: 'cobertura', INSEMINACAO: 'inseminação', DIAGNOSTICO_GESTACAO: 'diagnóstico de gestação', PARTO: 'parto', ABORTO: 'aborto', DESMAMA: 'desmama da cria' };

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function nulo_(v) {
    return vazio_(v) ? null : v;
  }
  function br_(d) {
    return Timeline.dataBr(d);
  }
  function cmp_(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function pct_(num, den) {
    return Utils.arredondar(num / den * 100, 1);
  }
  function det_(codigo, campo, mensagem) {
    return Validation.detalhe({ codigo: codigo, campo: campo, mensagem: mensagem });
  }

  // ------------------------------------------------------------------ partos (Fase 2) ----
  /**
   * Partos vigentes da matriz, do mais antigo ao mais recente (data, posição na cadeia de substituição, event_seq). f = Timeline.fonte (respeita os
   * eventos excluídos da fonte: validação de estorno e de substituição). Cada item: {reproduction_id, event_id,
   * event_seq, ordem_seq, data, nascidos_vivos, natimortos, tipo_parto, pai_id, pre_marco_zero}.
   */
  function partos(f, matrizId) {
    var out = [];
    f.reproducao(matrizId).forEach(function (r) {
      if (r.tipo_evento !== 'PARTO') return;
      var ev = f.evento(r.event_id);
      out.push({
        reproduction_id: r.reproduction_id, event_id: r.event_id, event_seq: ev ? ev.event_seq : 0, ordem_seq: ev ? f.ordemSeq(r.event_id) || 0 : 0, data: r.data,
        nascidos_vivos: typeof r.qtd_nascidos_vivos === 'number' ? r.qtd_nascidos_vivos : 0,
        natimortos: typeof r.qtd_natimortos === 'number' ? r.qtd_natimortos : 0,
        tipo_parto: nulo_(r.tipo_parto), pai_id: nulo_(r.touro_id), pre_marco_zero: !!(ev && ev.pre_marco_zero === true),
      });
    });
    return out.sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : (a.ordem_seq - b.ordem_seq) || (a.event_seq - b.event_seq); });
  }

  /**
   * Número de partos da matriz. `partos_previos` é o que se declarou na entrada sobre os partos ANTERIORES a ela;
   * partos registrados antes da entrada descrevem o mesmo passado, por isso vale o maior dos dois; os registrados
   * da entrada em diante somam. dataEntrada = data da primeira entrada vigente no sistema (marco zero no rebanho inicial).
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
  /**
   * Aviso de evento reprodutivo de fêmea jovem (RN-061): menos de `idade_min_reprodutiva_meses` meses completos na data.
   * Devolve a frase (sem o "quem") ou null.
   */
  function avisoIdade(params, femea, data) {
    var minimo = params.idade_min_reprodutiva_meses;
    if (!femea || vazio_(femea.data_nascimento) || typeof minimo !== 'number' || !Utils.dataValida(data) || femea.data_nascimento >= data) return null;
    var idade = Utils.idadeMeses(femea.data_nascimento, data);
    return idade < minimo ? 'tinha ' + idade + (idade === 1 ? ' mês' : ' meses') + ' em ' + br_(data) + ', abaixo da idade reprodutiva mínima (' + minimo + ' meses).' : null;
  }

  /**
   * Data da PRIMEIRA entrada vigente do animal no sistema (a partir do marco zero), ou null: `partos_previos` fala dos
   * partos anteriores à entrada no sistema (03a, 4.3.1); uma volta ao rebanho não transforma os partos registrados
   * no sistema em "anteriores".
   */
  function dataDaEntrada_(f, animalId) {
    var entradas = Timeline.ordenar(f.linhas(animalId).filter(function (l) { return l.efeito === 1 && !l.pre_marco_zero; }));
    return entradas.length ? entradas[0].event_date : null;
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

  // ------------------------------------------------------------------ registros e regras por animal ----
  /**
   * Registros reprodutivos vigentes da fêmea, na ordem (data, posição na cadeia de substituição, event_seq; desenho-base
   * 16.1): cada um é a linha de REPRODUCAO + {ord, seq, event_type, event_subtype, pre_marco_zero, estacao}.
   */
  function registros(f, id) {
    return f.reproducao(id).map(function (r) {
      var ev = f.evento(r.event_id);
      var o = Utils.clonar(r);
      o.ord = ev ? f.ordemSeq(r.event_id) || 0 : 0;
      o.seq = ev ? ev.event_seq : 0;
      o.event_type = ev ? ev.event_type : null;
      o.event_subtype = ev ? nulo_(ev.event_subtype) : null;
      o.pre_marco_zero = !!(ev && ev.pre_marco_zero === true);
      return o;
    }).sort(ordemRegistro_);
  }
  function ordemRegistro_(a, b) {
    return cmp_(a.data, b.data) || ((a.ord || 0) - (b.ord || 0)) || ((a.seq || 0) - (b.seq || 0)) || cmp_(String(a.reproduction_id), String(b.reproduction_id));
  }
  /**
   * "Castrado de origem": o atributo da criação com a última correção de cadastro vigente (sem a castração por evento):
   * o macho que já entrou castrado, ou foi corrigido para castrado.
   */
  function castradoDeOrigem(f, id) {
    var criacao = null;
    f.linhas(id).forEach(function (l) {
      if (l.atributos && (!criacao || l.ordem_seq > criacao.ordem_seq || (l.ordem_seq === criacao.ordem_seq && l.event_seq > criacao.event_seq))) criacao = l;
    });
    var v = criacao ? criacao.atributos.castrado : null;
    var ultima = null;
    f.ajustes(id).forEach(function (x) {
      if (x.tipo_ajuste !== 'CORRECAO_CADASTRO' || x.campo !== 'castrado') return;
      var ev = f.evento(x.event_id);
      var pos = { ord: ev ? f.ordemSeq(x.event_id) || 0 : 0, seq: ev ? ev.event_seq : 0 };
      if (!ultima || pos.ord > ultima.ord || (pos.ord === ultima.ord && pos.seq >= ultima.seq)) ultima = { ord: pos.ord, seq: pos.seq, valor: x.valor_novo };
    });
    if (ultima) v = ultima.valor;
    return v === true || v === 'S';
  }
  /** Linhas de castração vigentes do animal (eventos CASTRACAO), na ordem canônica. */
  function castracoes(linhas) {
    return Timeline.ordenar((linhas || []).filter(function (l) { return l.event_type === 'CASTRACAO'; }));
  }
  /** O macho estava castrado na data: castrado de origem, ou castração vigente até a data (inclusive). */
  function castradoEm(f, id, data) {
    if (castradoDeOrigem(f, id)) return true;
    return castracoes(f.linhas(id)).some(function (l) { return l.event_date <= data; });
  }
  /**
   * Cria (03a, DL-06; a regra da `cria_ao_pe` da mãe): nascida na fazenda por NASCIMENTO, ou que entrou no sistema com
   * menos de `idade_desmama_padrao_meses`. `a` = a projeção do animal (evento_origem_id, data_nascimento).
   */
  function ehCria(f, a, params) {
    if (!a) return false;
    var ev = f.evento(a.evento_origem_id);
    if (!ev) return false;
    if (ev.event_type === 'NASCIMENTO') return true;
    var desmama = params.idade_desmama_padrao_meses;
    if (vazio_(a.data_nascimento) || typeof desmama !== 'number' || a.data_nascimento > ev.event_date) return false;
    return Utils.idadeMeses(a.data_nascimento, ev.event_date) < desmama;
  }
  function problema_(codigo, l, mensagem, extra) {
    var p = { codigo: codigo, event_id: l.event_id, event_type: l.event_type, event_subtype: nulo_(l.event_subtype), event_date: l.event_date || l.data, mensagem: mensagem };
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    return p;
  }
  /**
   * Regras de manejo de UM animal, sobre o conjunto final (a mesma função no motor — antes e depois do comando — e na
   * verificação de integridade e na trava, seção 11): o = {linhas (Timeline.linha, vigentes), regs (registros, em ordem),
   * sexo, castradoOrigem}. Devolve [{codigo, event_id, event_type, event_subtype, event_date, mensagem}] (sem o "quem"):
   *  - CASTRACAO_DE_FEMEA: castração de quem não é macho;
   *  - CASTRACAO_REPETIDA: castração de quem já era castrado (de origem ou por castração anterior);
   *  - TOURO_CASTRADO: o macho é touro de uma exposição ou cobertura (linha TOURO) na data da castração ou depois;
   *  - DESMAMA_REPETIDA: a cria desmamada mais de uma vez;
   *  - PARTO_NA_GESTACAO: um parto entre a concepção que um diagnóstico positivo com a idade da gestação estima (data −
   *    idade) e o próprio diagnóstico (o problema é do diagnóstico: a gestação diagnosticada já estava em curso no parto).
   */
  function problemasDoAnimal(o) {
    var out = [];
    var linhas = o.linhas || [];
    var cast = castracoes(linhas);
    cast.forEach(function (l, i) {
      if (o.sexo !== 'M') { out.push(problema_('CASTRACAO_DE_FEMEA', l, 'a castração de ' + br_(l.event_date) + ' é de um animal que não é macho pelo cadastro.')); return; }
      if (i > 0 || o.castradoOrigem) out.push(problema_('CASTRACAO_REPETIDA', l, 'a castração de ' + br_(l.event_date) + ' é de um animal que já era castrado' + (i > 0 ? ' (castração de ' + br_(cast[0].event_date) + ')' : ' pelo cadastro') + '.'));
    });
    var desdeCastrado = o.sexo === 'M' ? (o.castradoOrigem ? '' : cast.length ? cast[0].event_date : null) : null;
    if (desdeCastrado !== null) {
      linhas.forEach(function (l) {
        if (l.papel !== 'TOURO' || l.event_date < desdeCastrado) return;
        out.push(problema_('TOURO_CASTRADO', l, 'é o touro d' + (l.event_subtype === 'COBERTURA' ? 'a cobertura' : 'a exposição') + ' de ' + br_(l.event_date) + ', mas ' + (desdeCastrado ? 'foi castrado em ' + br_(desdeCastrado) : 'é castrado pelo cadastro') + '.'));
      });
    }
    var desmamas = Timeline.ordenar(linhas.filter(function (l) { return l.event_type === 'DESMAMA' && l.papel === 'SUJEITO'; }));
    desmamas.slice(1).forEach(function (l) {
      out.push(problema_('DESMAMA_REPETIDA', l, 'a desmama de ' + br_(l.event_date) + ' é de uma cria já desmamada em ' + br_(desmamas[0].event_date) + '.'));
    });
    var regs = o.regs || [];
    regs.forEach(function (dg) {
      if (dg.tipo_evento !== 'DIAGNOSTICO_GESTACAO' || dg.resultado !== 'POSITIVO' || typeof dg.idade_gestacional_dias !== 'number') return;
      var concepcao = Utils.somaDias(dg.data, -dg.idade_gestacional_dias);
      regs.forEach(function (p) {
        if (p.tipo_evento !== 'PARTO' || p.data <= concepcao || ordemRegistro_(p, dg) >= 0) return;
        out.push(problema_('PARTO_NA_GESTACAO', { event_id: dg.event_id, event_type: dg.event_type, event_subtype: dg.event_subtype, data: dg.data },
          'o diagnóstico positivo de ' + br_(dg.data) + ', com ' + dg.idade_gestacional_dias + ' dias de gestação, põe a concepção em ' + br_(concepcao) + ', mas a fêmea pariu em ' + br_(p.data) + ', dentro dessa gestação.', { parto_event_id: p.event_id }));
      });
    });
    return out;
  }
  /** Os problemas que a mudança criou (por código + evento), na forma de Timeline.problemasNovos. */
  function problemasNovos(antes, depois) {
    var vistos = {};
    (antes || []).forEach(function (p) { vistos[p.codigo + '|' + p.event_id + '|' + (p.parto_event_id || '')] = true; });
    return (depois || []).filter(function (p) { return !vistos[p.codigo + '|' + p.event_id + '|' + (p.parto_event_id || '')]; });
  }
  /** As regras de manejo de um animal pela fonte (verificação de integridade e trava). */
  function problemasNaFonte(f, id, sexo) {
    return problemasDoAnimal({ linhas: f.linhas(id), regs: registros(f, id), sexo: sexo, castradoOrigem: castradoDeOrigem(f, id) });
  }

  // ------------------------------------------------------------------ situação e previsão ----
  /**
   * Previsão de parto (03b, seção 7.3), sempre estimativa salvo a informada, sobre o ciclo atual (os registros depois do
   * último parto ou aborto): nível 0 = `data_prevista_parto` informada no diagnóstico positivo (ou na prenhez declarada na
   * entrada); 1 = inseminação ou cobertura + `dias_gestacao`; 2 = diagnóstico positivo com a idade da gestação: data +
   * (`dias_gestacao` − idade); 3 = só exposição: janela de início + dias a fim + dias. Um diagnóstico negativo encerra as
   * tentativas anteriores. Devolve {nivel, data, inicio, fim, base: {tipo, data, event_id}, prenhe, rotulo} ou null.
   * `inicio`/`fim`: a janela (prevista ± `parto_tolerancia_dias`; no nível 3, a da exposição; fim null = em aberto).
   */
  function previsaoParto(regs, params, estacoes) {
    var dias = params.dias_gestacao;
    if (typeof dias !== 'number') return null;
    var tol = typeof params.parto_tolerancia_dias === 'number' ? params.parto_tolerancia_dias : 0;
    var ciclo = [];
    (regs || []).forEach(function (r) {
      if (r.tipo_evento === 'PARTO' || r.tipo_evento === 'ABORTO') { ciclo = []; return; }
      ciclo.push(r);
    });
    var expo = null;
    var ia = null;
    var dg = null;
    ciclo.forEach(function (r) {
      if (r.tipo_evento === 'EXPOSICAO') {
        var est = r.estacao_id && estacoes ? estacoes[r.estacao_id] : null;
        expo = { r: r, inicio: r.data, fim: nulo_(r.data_fim) || (est ? est.data_fim : null) };
      } else if (r.tipo_evento === 'COBERTURA' || r.tipo_evento === 'INSEMINACAO') {
        ia = r;
      } else if (r.tipo_evento === 'DIAGNOSTICO_GESTACAO') {
        if (r.resultado === 'POSITIVO') dg = r;
        else if (r.resultado === 'NEGATIVO') { expo = null; ia = null; dg = null; }
      }
    });
    var janela = function (d) { return { inicio: Utils.somaDias(d, -tol), fim: Utils.somaDias(d, tol) }; };
    var base = function (r) { return { tipo: r.tipo_evento, data: r.data, event_id: r.event_id }; };
    var prenhe = !!dg;
    if (dg && !vazio_(dg.data_prevista_parto)) { var j0 = janela(dg.data_prevista_parto); return { nivel: 0, data: dg.data_prevista_parto, inicio: j0.inicio, fim: j0.fim, base: base(dg), prenhe: prenhe, rotulo: 'Informada' }; }
    if (ia && (!dg || ia.data <= dg.data)) { var d1 = Utils.somaDias(ia.data, dias); var j1 = janela(d1); return { nivel: 1, data: d1, inicio: j1.inicio, fim: j1.fim, base: base(ia), prenhe: prenhe, rotulo: 'Estimativa' }; }
    if (dg && typeof dg.idade_gestacional_dias === 'number') { var d2 = Utils.somaDias(dg.data, dias - dg.idade_gestacional_dias); var j2 = janela(d2); return { nivel: 2, data: d2, inicio: j2.inicio, fim: j2.fim, base: base(dg), prenhe: prenhe, rotulo: 'Estimativa' }; }
    if (expo) return { nivel: 3, data: null, inicio: Utils.somaDias(expo.inicio, dias), fim: expo.fim ? Utils.somaDias(expo.fim, dias) : null, base: base(expo.r), prenhe: prenhe, rotulo: 'Estimativa' };
    if (dg) return { nivel: null, data: null, inicio: null, fim: null, base: base(dg), prenhe: true, rotulo: 'Sem data: diagnóstico positivo sem a idade da gestação nem cobertura registrada' };
    return null;
  }
  /** Fêmea apta (03a, 4.3.3, DL-05): idade ≥ `idade_min_reprodutiva_meses` na data, ou algum parto. */
  function apta_(a, params, data, nPartos) {
    if (nPartos > 0) return true;
    var minimo = params.idade_min_reprodutiva_meses;
    if (vazio_(a.data_nascimento) || typeof minimo !== 'number') return false;
    return Utils.idadeMeses(a.data_nascimento, data) >= minimo;
  }
  function mapaEstacoes_(repo) {
    var out = {};
    if (repo.carregada('ESTACOES_MONTA')) repo.vigentes('ESTACOES_MONTA').forEach(function (e) { out[e.estacao_id] = e; });
    return out;
  }

  // ------------------------------------------------------------------ ficha da matriz (bloco G) ----
  /**
   * Bloco G da ficha (08, seção 3; 07, seção 8.3): situação reprodutiva e cria ao pé, a previsão de parto, o histórico de
   * partos, os bezerros (nascidos vivos, natimortos, desmamados), as exposições, coberturas, inseminações, diagnósticos e
   * abortos, as perdas gestacionais (abortos e natimortos), o intervalo entre partos e a idade ao primeiro parto. Macho: os
   * registros em que ele é o touro e a castração. L = AnimalService.leitor (ou só a fonte, nas chamadas antigas).
   */
  function blocoFicha(L, a) {
    var f = L && L.f ? L.f : L;
    var params = L && L.params ? L.params : f.parametros;
    var hoje = L && L.hoje ? L.hoje : null;
    var estacoes = L && L.repo ? mapaEstacoes_(L.repo) : {};
    var femea = a.sexo === 'F';
    var out = { entregue: true, parcial: false, aplica: femea, situacao_reprodutiva: femea ? nulo_(a.situacao_reprodutiva) : null, cria_ao_pe: femea ? a.cria_ao_pe === true : null };
    if (!femea) {
      out.mensagem = 'Partos e diagnósticos só se registram em fêmeas.';
      out.partos = [];
      // Um item por lançamento (a exposição de um lote é um lançamento só), com o número de fêmeas.
      var comoTouro = [];
      var porEvento = {};
      if (L && L.repo && L.repo.carregada('REPRODUCAO')) {
        L.repo.por('REPRODUCAO', 'touro_id', a.animal_id).forEach(function (r) {
          if (f.excluidos && f.excluidos[r.event_id]) return;
          if (!porEvento[r.event_id]) {
            porEvento[r.event_id] = { event_id: r.event_id, data: r.data, tipo_evento: r.tipo_evento, femeas: 0, estacao_id: nulo_(r.estacao_id) };
            comoTouro.push(porEvento[r.event_id]);
          }
          porEvento[r.event_id].femeas++;
        });
      }
      f.linhas(a.animal_id).forEach(function (l) {
        if (l.papel === 'TOURO' && !porEvento[l.event_id]) {
          porEvento[l.event_id] = { event_id: l.event_id, data: l.event_date, tipo_evento: l.event_subtype, femeas: 0, estacao_id: null };
          comoTouro.push(porEvento[l.event_id]);
        }
      });
      out.como_touro = comoTouro.sort(function (x, y) { return cmp_(y.data, x.data); });
      var cs = castracoes(f.linhas(a.animal_id));
      out.castracao = cs.length ? { event_id: cs[0].event_id, data: cs[0].event_date, metodo: cs[0].payload ? nulo_(cs[0].payload.metodo) : null } : null;
      return out;
    }
    var h = historico(f, a);
    Object.keys(h).forEach(function (k) { out[k] = h[k]; });
    var regs = registros(f, a.animal_id);
    out.registros = regs.filter(function (r) { return r.tipo_evento !== 'PARTO'; }).map(function (r) {
      return {
        event_id: r.event_id, event_type: r.event_type, tipo_evento: r.tipo_evento, data: r.data, data_fim: nulo_(r.data_fim), estacao_id: nulo_(r.estacao_id),
        estacao_nome: r.estacao_id && estacoes[r.estacao_id] ? estacoes[r.estacao_id].nome : null, touro_id: nulo_(r.touro_id), semen_identificacao: nulo_(r.semen_identificacao),
        metodo: nulo_(r.metodo), resultado: nulo_(r.resultado), idade_gestacional_dias: typeof r.idade_gestacional_dias === 'number' ? r.idade_gestacional_dias : null,
        data_prevista_parto: nulo_(r.data_prevista_parto), observacoes: nulo_(r.observacoes), pre_marco_zero: r.pre_marco_zero,
      };
    }).reverse();
    var conta = function (t) { return regs.filter(function (r) { return r.tipo_evento === t; }).length; };
    out.exposicoes = conta('EXPOSICAO');
    out.coberturas = conta('COBERTURA');
    out.inseminacoes = conta('INSEMINACAO');
    out.diagnosticos = conta('DIAGNOSTICO_GESTACAO');
    out.abortos = conta('ABORTO');
    out.perdas_gestacionais = { abortos: out.abortos, natimortos: h.natimortos, total: out.abortos + h.natimortos };
    var crias = [];
    h.partos.forEach(function (p) { p.crias.forEach(function (c) { crias.push(c.animal_id); }); });
    out.bezerros = { nascidos_vivos: h.crias_nascidas_vivas, natimortos: h.natimortos, desmamados: crias.filter(function (id) { return f.linhas(id).some(function (l) { return l.event_type === 'DESMAMA' && l.papel === 'SUJEITO'; }); }).length };
    out.previsao_parto = ['PRENHA', 'INSEMINADA', 'EXPOSTA'].indexOf(a.situacao_reprodutiva) >= 0 ? previsaoParto(regs, params, estacoes) : null;
    out.parida = (typeof a.partos_previos === 'number' && a.partos_previos > 0) || h.partos_registrados > 0;
    out.apta = hoje ? apta_(a, params, hoje, h.n_partos) : null;
    out.sem_historico = out.apta === true && regs.length === 0 && !(typeof a.partos_previos === 'number' && a.partos_previos > 0);
    // O primeiro parto registrado é o primeiro da vida só quando a fêmea não tinha partos antes de entrar (declarado 0, ou
    // nascida na fazenda, que o projetor grava com 0).
    var primeiroDaVida = h.partos.length && a.partos_previos === 0 ? h.partos[0] : null;
    out.idade_primeiro_parto_meses = primeiroDaVida && !vazio_(a.data_nascimento) && a.data_nascimento < primeiroDaVida.data
      ? { valor: Utils.idadeMeses(a.data_nascimento, primeiroDaVida.data), motivo: null, n: 1 }
      : { valor: null, motivo: 'DADOS_INSUFICIENTES', n: 0 };
    return out;
  }

  // ------------------------------------------------------------------ estação de monta (cadastro) ----
  function camposEstacao_(col, d) {
    var bruto = d.campos;
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) { col.erro(det_('FORMATO_INVALIDO', 'campos', 'Os dados da estação vieram em formato inesperado. Atualize a tela e tente de novo.')); return {}; }
    var out = {};
    Object.keys(bruto).forEach(function (k) {
      if (CAMPOS_ESTACAO.indexOf(k) < 0) { col.erro(det_('CAMPO_DESCONHECIDO', k, 'O campo "' + k + '" não existe na estação de monta.')); return; }
      var v = bruto[k];
      out[k] = typeof v === 'string' ? (vazio_(Utils.aparar(v)) ? null : Utils.aparar(v)) : v === undefined ? null : v;
    });
    return out;
  }
  /**
   * `estacao.salvar` (03a, seção 4.10): {estacao_id?, campos: {property_id, nome, data_inicio, data_fim, tipo, observacoes},
   * justificativa?}. Propriedade existente e ativa (a da estação gravada continua aceita), nome único na propriedade, fim
   * no dia do início ou depois, tipo MONTA_NATURAL, IA ou MISTA. Mudar as datas não mexe nos registros reprodutivos: os
   * indicadores usam o vínculo `estacao_id` gravado em cada fato.
   */
  function comandoSalvarEstacao(pedido) {
    var p = pedido || {};
    return {
      rota: 'estacao.salvar', idempotencyKey: p.idempotencyKey, dados: p.dados, avisosAceitos: p.avisosAceitos || [],
      dataVersionEsperada: p.dataVersionEsperada, reads: LEITURAS_ESTACAO.concat(['CONFIGURACOES']),
      tratador: function (tx) {
        var d = tx.dados || {};
        var col = Validation.coletor();
        var atual = vazio_(d.estacao_id) ? null : tx.repo.porId('ESTACOES_MONTA', d.estacao_id);
        if (!vazio_(d.estacao_id) && !atual) throw Validation.erro('NOT_FOUND', 'A estação de monta não existe mais. Atualize a tela e tente de novo.');
        var campos = camposEstacao_(col, d);
        if (!atual && vazio_(campos.property_id)) {
          var padrao = Config.parametros(tx.repo).propriedade_padrao_id;
          if (!vazio_(padrao)) campos.property_id = padrao;
        }
        var final = Utils.clonar(atual || {});
        Object.keys(campos).forEach(function (c) { final[c] = campos[c]; });
        if (vazio_(final.nome)) col.erro(det_('CAMPO_OBRIGATORIO', 'nome', 'Dê um nome à estação (ex.: Estação 2026/2027).'));
        if (vazio_(final.property_id)) col.erro(det_('CAMPO_OBRIGATORIO', 'property_id', 'Escolha a propriedade da estação.'));
        if (vazio_(final.data_inicio)) col.erro(det_('CAMPO_OBRIGATORIO', 'data_inicio', 'Informe o início da estação.'));
        if (vazio_(final.data_fim)) col.erro(det_('CAMPO_OBRIGATORIO', 'data_fim', 'Informe o fim da estação.'));
        if (vazio_(final.tipo)) col.erro(det_('CAMPO_OBRIGATORIO', 'tipo', 'Escolha o tipo da estação: monta natural, inseminação ou mista.'));
        Validation.validarRegistro('ESTACOES_MONTA', campos, { parcial: true, semProjecoes: true }).forEach(function (x) {
          if (!col.erros.some(function (e) { return e.campo === x.campo; })) col.erro(x);
        });
        if (Utils.dataValida(final.data_inicio) && Utils.dataValida(final.data_fim) && final.data_fim < final.data_inicio) col.erro(det_('FAIXA_INVALIDA', 'data_fim', 'O fim da estação precisa ser no dia do início ou depois.'));
        if (!vazio_(campos.property_id)) {
          var prop = tx.repo.porId('PROPRIEDADES', campos.property_id);
          if (!prop) col.erro(det_('NAO_ENCONTRADO', 'property_id', 'A propriedade escolhida não existe.'));
          else if (prop.status !== 'ATIVO' && !(atual && atual.property_id === prop.property_id)) col.erro(det_('PROPRIEDADE_INATIVA', 'property_id', 'A propriedade ' + prop.nome + ' está desativada.'));
        }
        var id = atual ? atual.estacao_id : tx.novoId();
        if (!vazio_(final.nome) && !vazio_(final.property_id)) {
          var chave = Utils.normalizarTexto(final.nome);
          var igual = tx.repo.vigentes('ESTACOES_MONTA').filter(function (x) { return x.estacao_id !== id && x.property_id === final.property_id && Utils.normalizarTexto(x.nome) === chave; })[0];
          if (igual) col.erro(det_('NOME_REPETIDO', 'nome', 'Já existe a estação "' + igual.nome + '" nesta propriedade.'));
        }
        if (col.temErros()) return { erros: col.erros };
        if (atual) AuditService.alteracao(tx, 'ESTACOES_MONTA', id, campos, d.justificativa);
        else AuditService.criacao(tx, 'ESTACOES_MONTA', id, campos, d.justificativa);
        return { resumo: { estacao_id: id }, resposta: function (t) { return Utils.clonar(t.repo.porId('ESTACOES_MONTA', id)); } };
      },
      reconstruir: function (tx, op) { return Utils.clonar(tx.repo.porId('ESTACOES_MONTA', op.resumo.estacao_id)); },
    };
  }
  function salvarEstacao(ctx, pedido) {
    return UnitOfWork.run(ctx, comandoSalvarEstacao(pedido));
  }
  /** Para o bootstrap: as estações de monta, da mais recente para a mais antiga. */
  function cadastros(repo) {
    var lista = repo.carregada('ESTACOES_MONTA') ? repo.vigentes('ESTACOES_MONTA').map(Utils.clonar) : [];
    return { estacoes: lista.sort(function (a, b) { return cmp_(b.data_inicio, a.data_inicio) || cmp_(a.nome, b.nome); }) };
  }

  // ------------------------------------------------------------------ fêmeas e indicadores ----
  /** Saídas vigentes do animal (venda, morte, descarte, baixa na contagem), na ordem: [{data, tipo}]. */
  function saidas_(f, id) {
    return Timeline.ordenar(f.linhas(id).filter(function (l) { return l.efeito === -1 && !l.pre_marco_zero && SAIDAS.indexOf(l.event_type) >= 0; }))
      .map(function (l) { return { data: l.event_date, tipo: l.event_type === 'AJUSTE_INVENTARIO' ? 'DIVERGENCIA_CONTAGEM' : l.event_type, event_id: l.event_id }; });
  }
  function desmamada_(f, id) {
    return f.linhas(id).some(function (l) { return l.event_type === 'DESMAMA' && l.papel === 'SUJEITO'; });
  }
  /**
   * As fêmeas de um período reprodutivo: as expostas na estação E (07, seção 8.3: com exposição, cobertura ou inseminação
   * vinculada a E), cada uma com {animal_id, inicio, fim (da exposição), janela: [início + dias − tolerância, fim + dias +
   * tolerância], ultimo_dg, parto (o atribuído a E), aborto, saida}. O parto pertence à exposição mais recente da matriz
   * cuja janela o contém (de qualquer estação, ou sem estação).
   */
  function expostasDaEstacao_(L, est) {
    var f = L.f;
    var p = L.params;
    var dias = p.dias_gestacao;
    var tol = typeof p.parto_tolerancia_dias === 'number' ? p.parto_tolerancia_dias : 0;
    var estacoes = mapaEstacoes_(L.repo);
    var porFemea = {};
    L.repo.por('REPRODUCAO', 'estacao_id', est.estacao_id).forEach(function (r) {
      if (EXPOEM.indexOf(r.tipo_evento) < 0 || (f.excluidos && f.excluidos[r.event_id])) return;
      if (!f.vale(r.event_id)) return;
      porFemea[r.animal_id] = true;
    });
    var fimExposicao = function (r) {
      if (r.tipo_evento !== 'EXPOSICAO') return r.data;
      if (!vazio_(r.data_fim)) return r.data_fim;
      var e = r.estacao_id ? estacoes[r.estacao_id] : null;
      return e ? e.data_fim : r.data;
    };
    return Object.keys(porFemea).map(function (id) {
      var regs = registros(f, id);
      var expostos = regs.filter(function (r) { return EXPOEM.indexOf(r.tipo_evento) >= 0; });
      var deE = expostos.filter(function (r) { return r.estacao_id === est.estacao_id; });
      var inicio = deE[0].data;
      var fim = deE.reduce(function (m, r) { var x = fimExposicao(r); return x > m ? x : m; }, inicio);
      var janela = { inicio: Utils.somaDias(inicio, dias - tol), fim: Utils.somaDias(fim, dias + tol) };
      // Parto atribuído: para cada parto depois do início, a exposição mais recente (de qualquer estação) cuja janela o contém.
      var parto = null;
      regs.forEach(function (r) {
        if (parto || r.tipo_evento !== 'PARTO' || r.data < inicio) return;
        var dono = null;
        expostos.forEach(function (x) {
          var ini = Utils.somaDias(x.data, dias - tol);
          var fi = Utils.somaDias(fimExposicao(x), dias + tol);
          if (r.data >= ini && r.data <= fi && (!dono || ordemRegistro_(x, dono) > 0)) dono = x;
        });
        if (dono && dono.estacao_id === est.estacao_id) parto = r;
      });
      var dgs = regs.filter(function (r) {
        if (r.tipo_evento !== 'DIAGNOSTICO_GESTACAO' || r.resultado === 'INCONCLUSIVO') return false;
        if (r.estacao_id) return r.estacao_id === est.estacao_id;
        return r.data >= inicio && r.data <= Utils.somaDias(fim, dias);
      });
      var aborto = regs.filter(function (r) { return r.tipo_evento === 'ABORTO' && r.data >= inicio && r.data <= janela.fim; })[0] || null;
      var saida = saidas_(f, id).filter(function (s) { return s.data >= inicio; })[0] || null;
      return { animal_id: id, inicio: inicio, fim: fim, janela: janela, ultimo_dg: dgs.length ? dgs[dgs.length - 1] : null, parto: parto, aborto: aborto, saida: saida };
    });
  }
  /** Indicador com numerador e denominador (07, seção 8.3): denominador abaixo de `indicador_n_minimo` (ou zero) → null. */
  function taxa_(num, den, minimo, extra) {
    var o = { valor: null, motivo: null, numerador: num, denominador: den, n: den };
    if (!den || den < minimo) o.motivo = 'DADOS_INSUFICIENTES';
    else o.valor = pct_(num, den);
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  /**
   * Os indicadores de uma estação sobre um conjunto de fêmeas expostas (todas, ou as de uma categoria), na data D (07,
   * seção 8.3). Tratamento de quem saiu no meio da estação (decisão desta etapa, documentada em CONTRATOS): a fêmea que
   * saiu do rebanho antes de um diagnóstico conclusivo da estação sai do denominador da prenhez; a que saiu antes do fim da
   * janela de parto sem desfecho (parto, aborto ou diagnóstico negativo) sai do denominador da parição, da natalidade e da
   * desmama; a prenha que saiu assim sai também do da perda gestacional. A vazia que foi descartada continua contando.
   */
  function calcular_(L, femeas, data, minimo) {
    var f = L.f;
    var p = L.params;
    var semDg = femeas.filter(function (x) { return !x.ultimo_dg && x.saida && x.saida.data <= data; });
    var baseDg = femeas.filter(function (x) { return semDg.indexOf(x) < 0; });
    var diag = baseDg.filter(function (x) { return x.ultimo_dg && x.ultimo_dg.data <= data; });
    var prenhas = baseDg.filter(function (x) { return x.ultimo_dg && x.ultimo_dg.data <= data && x.ultimo_dg.resultado === 'POSITIVO'; });
    var cobMin = typeof p.prenhez_cobertura_dg_min_pct === 'number' ? p.prenhez_cobertura_dg_min_pct : 90;
    var cobertura = taxa_(diag.length, baseDg.length, 1);
    var entreDiag = cobertura.valor !== null && cobertura.valor < cobMin;
    var prenhez = entreDiag ? taxa_(prenhas.length, diag.length, minimo, { rotulo: 'Prenhez entre diagnosticadas' }) : taxa_(prenhas.length, baseDg.length, minimo, { rotulo: 'Taxa de prenhez' });
    var desfecho = function (x) {
      if (x.parto && x.parto.data <= data) return 'PARTO';
      if (x.aborto && x.aborto.data <= data) return 'ABORTO';
      if (x.ultimo_dg && x.ultimo_dg.data <= data && x.ultimo_dg.resultado === 'NEGATIVO') return 'VAZIA';
      return null;
    };
    var semDesfecho = femeas.filter(function (x) { return !desfecho(x) && x.saida && x.saida.data <= data && x.saida.data <= x.janela.fim; });
    var base = femeas.filter(function (x) { return semDesfecho.indexOf(x) < 0; });
    var paridas = base.filter(function (x) { return desfecho(x) === 'PARTO'; });
    var abertas = base.filter(function (x) { return !desfecho(x) && x.janela.fim >= data; });
    var prenhaAberta = abertas.some(function (x) { return x.ultimo_dg && x.ultimo_dg.data <= data && x.ultimo_dg.resultado === 'POSITIVO'; });
    var vivos = 0;
    var crias = [];
    paridas.forEach(function (x) {
      vivos += typeof x.parto.qtd_nascidos_vivos === 'number' ? x.parto.qtd_nascidos_vivos : 0;
      f.linhasDoEvento(x.parto.event_id).forEach(function (l) { if (l.papel === 'CRIA' && f.vale(l.event_id)) crias.push(l.animal_id); });
    });
    var desmamadas = crias.filter(function (id) { return f.linhas(id).some(function (l) { return l.event_type === 'DESMAMA' && l.papel === 'SUJEITO' && l.event_date <= data; }); });
    var aoPe = crias.filter(function (id) {
      if (desmamadas.indexOf(id) >= 0) return false;
      var s = Timeline.situacaoEm(f.linhas(id), data, L.marcoZero);
      return s.presente;
    });
    var mortas = [];
    var vendidasAoPe = [];
    crias.forEach(function (id) {
      if (desmamadas.indexOf(id) >= 0) return;
      var s = saidas_(f, id).filter(function (x) { return x.data <= data; })[0];
      if (!s) return;
      if (s.tipo === 'MORTE' || s.tipo === 'DIVERGENCIA_CONTAGEM') mortas.push(id);
      else vendidasAoPe.push(id);
    });
    var prenhasPerda = prenhas.filter(function (x) { return !(x.saida && x.saida.data <= data && x.saida.data <= x.janela.fim && !desfecho(x)); });
    var perdas = prenhasPerda.filter(function (x) {
      if (x.parto && x.parto.data <= data) return false;
      if (x.aborto && x.aborto.data <= data && x.aborto.data >= x.ultimo_dg.data) return true;
      return x.janela.fim < data;
    });
    var perdaAberta = prenhasPerda.some(function (x) { return !(x.parto && x.parto.data <= data) && !(x.aborto && x.aborto.data <= data) && x.janela.fim >= data; });
    var parcialParto = prenhaAberta ? 'parcial' : null;
    // IEP: os intervalos entre partos consecutivos da matriz que terminam num parto atribuído à estação.
    var intervalos = [];
    var idades = [];
    paridas.forEach(function (x) {
      var ps = partos(f, x.animal_id);
      var i = ps.map(function (q) { return q.event_id; }).indexOf(x.parto.event_id);
      if (i > 0) intervalos.push(Utils.diffDias(ps[i - 1].data, ps[i].data));
      var a = f.animal(x.animal_id) || {};
      if (i === 0 && a.partos_previos === 0 && !vazio_(a.data_nascimento) && a.data_nascimento < x.parto.data) idades.push(Utils.idadeMeses(a.data_nascimento, x.parto.data));
    });
    var media = function (l, casas) { return l.length ? Utils.arredondar(l.reduce(function (s, v) { return s + v; }, 0) / l.length, casas) : null; };
    var mediaInd = function (l, casas) { var v = l.length >= minimo ? media(l, casas) : null; return { valor: v, motivo: v === null ? 'DADOS_INSUFICIENTES' : null, n: l.length }; };
    return {
      expostas: femeas.length,
      sairam_sem_diagnostico: semDg.length,
      sairam_sem_desfecho: semDesfecho.length,
      diagnosticadas: diag.length,
      prenhas: prenhas.length,
      paridas: paridas.length,
      nascidos_vivos: vivos,
      desmamados: desmamadas.length,
      crias_ao_pe: aoPe.length,
      mortos_antes_da_desmama: mortas.length,
      vendidos_ao_pe: vendidasAoPe.length,
      cobertura_dg: cobertura,
      prenhez: prenhez,
      paricao: taxa_(paridas.length, base.length, minimo, { rotulo: 'Taxa de parição', parcial: parcialParto }),
      natalidade: taxa_(vivos, base.length, minimo, { rotulo: 'Natalidade', parcial: parcialParto }),
      perda_gestacional: taxa_(perdas.length, prenhasPerda.length, minimo, { rotulo: 'Perda gestacional', parcial: perdaAberta ? 'parcial' : null }),
      desmama: taxa_(desmamadas.length, base.length, minimo, { rotulo: 'Taxa de desmama', parcial: aoPe.length || prenhaAberta ? 'parcial' : null }),
      mortalidade_ate_desmama: taxa_(mortas.length, crias.length, minimo, { rotulo: 'Mortalidade até a desmama', parcial: aoPe.length ? 'parcial' : null }),
      iep_dias: mediaInd(intervalos, 0),
      idade_primeiro_parto_meses: mediaInd(idades, 1),
    };
  }
  /** Matrizes ativas na data (07, seção 8.3): fêmeas no rebanho, aptas e sem marca de descarte; prenhas e sem informação. */
  function matrizesEm_(L, data) {
    var f = L.f;
    var p = L.params;
    var lista = [];
    L.animais.forEach(function (a) {
      if (a.sexo !== 'F' || a.situacao_cadastral === 'EXTERNO' || a.situacao_cadastral === 'ANULADO' || a.situacao_cadastral === 'PENDENTE') return;
      var s = Timeline.situacaoEm(f.linhas(a.animal_id), data, L.marcoZero);
      if (!s.presente) return;
      var ps = partos(f, a.animal_id).filter(function (x) { return x.data <= data; });
      var nP = (typeof a.partos_previos === 'number' ? a.partos_previos : 0) + ps.length;
      if (!apta_(a, p, data, nP) || a.marcado_descarte === true) return;
      var regs = registros(f, a.animal_id).filter(function (r) { return r.data <= data; });
      lista.push({ a: a, regs: regs, partos: nP });
    });
    return lista;
  }
  function situacaoNaData_(x) {
    var s = null;
    x.regs.forEach(function (r) {
      if (r.tipo_evento === 'DIAGNOSTICO_GESTACAO') s = r.resultado === 'POSITIVO' ? 'PRENHA' : r.resultado === 'NEGATIVO' ? 'VAZIA' : s;
      else if (r.tipo_evento === 'EXPOSICAO' || r.tipo_evento === 'COBERTURA') s = 'EXPOSTA';
      else if (r.tipo_evento === 'INSEMINACAO') s = 'INSEMINADA';
      else if (r.tipo_evento === 'PARTO' || r.tipo_evento === 'ABORTO') s = 'VAZIA';
    });
    return s;
  }
  function indicadoresDaEstacao_(L, est, data) {
    var minimo = typeof L.params.indicador_n_minimo === 'number' ? L.params.indicador_n_minimo : 5;
    var femeas = expostasDaEstacao_(L, est);
    var geral = calcular_(L, femeas, data, minimo);
    var porCat = {};
    femeas.forEach(function (x) {
      var a = L.f.animal(x.animal_id);
      var c = a ? AnimalService.categoriaEm(L, a, x.inicio) : null;
      var k = c ? c.category_id : 'SEM_CATEGORIA';
      (porCat[k] = porCat[k] || { category_id: c ? c.category_id : null, nome: c ? c.nome : 'Sem categoria', femeas: [] }).femeas.push(x);
    });
    var categorias = Object.keys(porCat).map(function (k) {
      var g = porCat[k];
      var r = calcular_(L, g.femeas, data, minimo);
      r.category_id = g.category_id;
      r.nome = g.nome;
      return r;
    }).sort(function (a, b) { return cmp_(a.nome, b.nome); });
    return { estacao: Utils.clonar(est), geral: geral, por_categoria: categorias };
  }
  /** Sem estação (PR-07: touro o ano todo): natalidade anual = nascidos vivos no ano ÷ matrizes ativas no início do ano. */
  function indicadoresAnuais_(L, ano, data) {
    var minimo = typeof L.params.indicador_n_minimo === 'number' ? L.params.indicador_n_minimo : 5;
    var inicio = ano + '-01-01';
    var fim = ano + '-12-31' < data ? ano + '-12-31' : data;
    var base = inicio < L.marcoZero ? null : matrizesEm_(L, inicio);
    var vivos = 0;
    var nPartos = 0;
    var intervalos = [];
    var idades = [];
    L.animais.forEach(function (a) {
      if (a.sexo !== 'F') return;
      var ps = partos(L.f, a.animal_id);
      ps.forEach(function (q, i) {
        if (q.data < inicio || q.data > fim || q.pre_marco_zero) return;
        nPartos++;
        vivos += q.nascidos_vivos;
        if (i > 0) intervalos.push(Utils.diffDias(ps[i - 1].data, q.data));
        if (i === 0 && a.partos_previos === 0 && !vazio_(a.data_nascimento) && a.data_nascimento < q.data) idades.push(Utils.idadeMeses(a.data_nascimento, q.data));
      });
    });
    var media = function (l, casas) { var v = l.length >= minimo ? Utils.arredondar(l.reduce(function (s, x) { return s + x; }, 0) / l.length, casas) : null; return { valor: v, motivo: v === null ? 'DADOS_INSUFICIENTES' : null, n: l.length }; };
    var nat = base === null ? { valor: null, motivo: 'ANTERIOR_AO_MARCO_ZERO', numerador: vivos, denominador: null, n: null, rotulo: 'Natalidade anual' } : taxa_(vivos, base.length, minimo, { rotulo: 'Natalidade anual', parcial: fim < ano + '-12-31' ? 'parcial' : null });
    return { ano: ano, inicio: inicio, fim: fim, matrizes_no_inicio: base ? base.length : null, partos: nPartos, nascidos_vivos: vivos, natalidade_anual: nat, iep_dias: media(intervalos, 0), idade_primeiro_parto_meses: media(idades, 1) };
  }
  /**
   * `reproducao.indicadores` (07, seção 8.3): {estacao_id?, ano?, data? (≤ hoje; padrão hoje)}. Devolve {data, parametros,
   * matrizes: {ativas, prenhas, sem_informacao, sem_historico}, estacoes: [{estacao_id, nome, data_inicio, data_fim}],
   * estacao: {estacao, geral, por_categoria} | null, anual: {...} | null}. Sem estação pedida: a mais recente com fêmeas
   * expostas; sem nenhuma estação cadastrada: a forma anual do ano da data (ou do `ano` pedido).
   */
  function consultaIndicadores(dados) {
    var d = dados || {};
    return {
      rota: 'reproducao.indicadores', dados: d, reads: leituras(), acessoCru: true,
      tratador: function (tx) {
        var L = AnimalService.leitor(tx);
        var data = vazio_(d.data) ? L.hoje : d.data;
        if (!Utils.dataValida(data)) throw Validation.erro('VALIDATION', 'A data precisa estar no formato dia/mês/ano.', [det_('FORMATO_INVALIDO', 'data', 'Data inválida.')]);
        if (data > L.hoje) throw Validation.erro('VALIDATION', 'A data ainda não chegou.', [det_('DATA_FUTURA', 'data', 'A data ainda não chegou.')]);
        var estacoes = Utils.ordenarPor(tx.repo.vigentes('ESTACOES_MONTA').map(Utils.clonar), ['data_inicio']).reverse();
        var est = null;
        if (!vazio_(d.estacao_id)) {
          est = tx.repo.porId('ESTACOES_MONTA', d.estacao_id);
          if (!est) throw Validation.erro('NOT_FOUND', 'A estação de monta não existe mais. Atualize a tela e tente de novo.');
        } else if (vazio_(d.ano)) {
          est = estacoes.filter(function (e) { return e.data_inicio <= data && tx.repo.por('REPRODUCAO', 'estacao_id', e.estacao_id).length; })[0] || null;
        }
        var ano = !vazio_(d.ano) ? d.ano : data.slice(0, 4);
        if (!vazio_(d.ano) && !/^\d{4}$/.test(String(d.ano))) throw Validation.erro('VALIDATION', 'O ano precisa ter quatro algarismos.', [det_('FORMATO_INVALIDO', 'ano', 'Ano inválido.')]);
        var minimo = typeof L.params.indicador_n_minimo === 'number' ? L.params.indicador_n_minimo : 5;
        var matrizes = vazio_(L.marcoZero) || data < L.marcoZero ? null : matrizesEm_(L, data);
        var prenhas = matrizes ? matrizes.filter(function (x) { return situacaoNaData_(x) === 'PRENHA'; }).length : null;
        var semInfo = matrizes ? matrizes.filter(function (x) { return situacaoNaData_(x) === null; }).length : null;
        var semHist = matrizes ? matrizes.filter(function (x) { return !x.regs.length && x.partos === 0; }).length : null;
        return {
          data: data,
          parametros: { dias_gestacao: L.params.dias_gestacao, parto_tolerancia_dias: L.params.parto_tolerancia_dias, indicador_n_minimo: minimo, prenhez_cobertura_dg_min_pct: L.params.prenhez_cobertura_dg_min_pct, idade_min_reprodutiva_meses: L.params.idade_min_reprodutiva_meses },
          matrizes: matrizes ? { ativas: matrizes.length, prenhas: prenhas, sem_informacao: semInfo, sem_historico: semHist, motivo: null } : { ativas: null, prenhas: null, sem_informacao: null, sem_historico: null, motivo: vazio_(L.marcoZero) ? 'DADOS_INSUFICIENTES' : 'ANTERIOR_AO_MARCO_ZERO' },
          estacoes: estacoes.map(function (e) { return { estacao_id: e.estacao_id, nome: e.nome, data_inicio: e.data_inicio, data_fim: e.data_fim, tipo: e.tipo, property_id: e.property_id }; }),
          estacao: est ? indicadoresDaEstacao_(L, est, data) : null,
          anual: est ? null : indicadoresAnuais_(L, String(ano), data),
        };
      },
    };
  }
  /**
   * `reproducao.matrizes`: as fêmeas no rebanho na data (padrão hoje) com a situação reprodutiva (a projeção, com o rótulo
   * do sistema), a cria ao pé, o número de partos, o último fato, a previsão de parto (estimativa) e se está apta, mais as
   * listas de parto previsto e de prenhez com a previsão vencida (alertas). Filtros: `estacao_id` (só as expostas nela),
   * `pasture_id`, `situacao`. {data, itens: [...], resumo: {por_situacao, cria_ao_pe, sem_historico}}.
   */
  function consultaMatrizes(dados) {
    var d = dados || {};
    return {
      rota: 'reproducao.matrizes', dados: d, reads: leituras(), acessoCru: true,
      tratador: function (tx) {
        var L = AnimalService.leitor(tx);
        var data = vazio_(d.data) ? L.hoje : d.data;
        if (!Utils.dataValida(data) || data > L.hoje) throw Validation.erro('VALIDATION', 'Escolha uma data até hoje.', [det_('FORMATO_INVALIDO', 'data', 'Data inválida.')]);
        if (!vazio_(d.estacao_id) && !tx.repo.porId('ESTACOES_MONTA', d.estacao_id)) throw Validation.erro('NOT_FOUND', 'A estação de monta não existe mais. Atualize a tela e tente de novo.');
        var naEstacao = null;
        if (!vazio_(d.estacao_id)) {
          naEstacao = {};
          tx.repo.por('REPRODUCAO', 'estacao_id', d.estacao_id).forEach(function (r) { if (EXPOEM.indexOf(r.tipo_evento) >= 0 && L.f.vale(r.event_id)) naEstacao[r.animal_id] = true; });
        }
        var itens = matrizes_(L, data, d).filter(function (x) { return !naEstacao || naEstacao[x.animal_id]; });
        var resumo = { por_situacao: {}, cria_ao_pe: 0, sem_historico: 0, total: itens.length };
        itens.forEach(function (x) {
          resumo.por_situacao[x.situacao_reprodutiva || 'SEM_INFORMACAO'] = (resumo.por_situacao[x.situacao_reprodutiva || 'SEM_INFORMACAO'] || 0) + 1;
          if (x.cria_ao_pe) resumo.cria_ao_pe++;
          if (x.sem_historico) resumo.sem_historico++;
        });
        return { data: data, itens: itens, resumo: resumo, alertas: alertasDe_(L, itens, data) };
      },
    };
  }
  /** As fêmeas do rebanho na data, com a situação e a previsão (todas as aptas ou com algum registro reprodutivo). */
  function matrizes_(L, data, filtros) {
    var f = L.f;
    var p = L.params;
    var est = mapaEstacoes_(L.repo);
    var o = filtros || {};
    var out = [];
    L.animais.forEach(function (a) {
      if (a.sexo !== 'F') return;
      var s = Timeline.situacaoEm(f.linhas(a.animal_id), data, L.marcoZero);
      if (!s.presente) return;
      if (!vazio_(o.pasture_id) && s.pasture_id !== o.pasture_id) return;
      var regs = registros(f, a.animal_id).filter(function (r) { return r.data <= data; });
      var ps = regs.filter(function (r) { return r.tipo_evento === 'PARTO'; });
      var nPartos = (typeof a.partos_previos === 'number' ? a.partos_previos : 0) + ps.length;
      var apta = apta_(a, p, data, nPartos);
      if (!apta && !regs.length) return;
      var sit = data === L.hoje ? nulo_(a.situacao_reprodutiva) : situacaoNaData_({ regs: regs }) || nulo_(a.situacao_reprodutiva);
      if (!vazio_(o.situacao) && sit !== o.situacao) return;
      var ultimo = regs.length ? regs[regs.length - 1] : null;
      var prev = ['PRENHA', 'INSEMINADA', 'EXPOSTA'].indexOf(sit) >= 0 ? previsaoParto(regs, p, est) : null;
      out.push({
        animal_id: a.animal_id, codigo_interno: a.codigo_interno, brinco: nulo_(a.brinco), nome: nulo_(a.nome), pasture_id: s.pasture_id || null,
        idade_meses: vazio_(a.data_nascimento) ? null : Utils.idadeMeses(a.data_nascimento, data), apta: apta,
        situacao_reprodutiva: sit, cria_ao_pe: a.cria_ao_pe === true && data === L.hoje, partos: nPartos, marcado_descarte: a.marcado_descarte === true,
        ultimo: ultimo ? { tipo_evento: ultimo.tipo_evento, data: ultimo.data, resultado: nulo_(ultimo.resultado), event_id: ultimo.event_id } : null,
        previsao_parto: prev, sem_historico: apta && !regs.length && !(typeof a.partos_previos === 'number' && a.partos_previos > 0),
      });
    });
    return out.sort(function (x, y) { return cmp_(x.brinco || x.codigo_interno || '', y.brinco || y.codigo_interno || ''); });
  }
  /**
   * Alertas da reprodução (desenho-base, seção 6: "parto previsto; prenhez com previsão vencida"): a prenha com o parto
   * previsto até `alerta_parto_previsto_dias` à frente (PARTO_PREVISTO) e a prenha cuja previsão passou há mais de
   * `alerta_prenhez_vencida_dias` sem parto nem aborto (PRENHEZ_VENCIDA). Itens: [{codigo, animal_id, brinco, data_prevista}].
   */
  function alertasDe_(L, itens, data) {
    var p = L.params;
    var frente = typeof p.alerta_parto_previsto_dias === 'number' ? p.alerta_parto_previsto_dias : 30;
    var vencida = typeof p.alerta_prenhez_vencida_dias === 'number' ? p.alerta_prenhez_vencida_dias : 15;
    var out = [];
    itens.forEach(function (x) {
      var pv = x.previsao_parto;
      if (x.situacao_reprodutiva !== 'PRENHA' || !pv) return;
      var ref = pv.data || pv.fim;
      if (!ref) return;
      if (pv.data && pv.data >= data && Utils.diffDias(data, pv.data) <= frente) out.push({ codigo: 'PARTO_PREVISTO', animal_id: x.animal_id, codigo_interno: x.codigo_interno, brinco: x.brinco, data_prevista: pv.data, nivel: pv.nivel });
      else if (ref < data && Utils.diffDias(ref, data) > vencida) out.push({ codigo: 'PRENHEZ_VENCIDA', animal_id: x.animal_id, codigo_interno: x.codigo_interno, brinco: x.brinco, data_prevista: ref, nivel: pv.nivel });
    });
    return out;
  }
  /** Os alertas de hoje (InventoryService): {PARTO_PREVISTO: n, PRENHEZ_VENCIDA: n, itens}. */
  function alertasHoje(L) {
    var itens = alertasDe_(L, matrizes_(L, L.hoje, {}), L.hoje);
    return { PARTO_PREVISTO: itens.filter(function (x) { return x.codigo === 'PARTO_PREVISTO'; }).length, PRENHEZ_VENCIDA: itens.filter(function (x) { return x.codigo === 'PRENHEZ_VENCIDA'; }).length, itens: itens };
  }
  function leituras() {
    return Utils.unicos(AnimalService.leituras().concat(['ESTACOES_MONTA', 'REPRODUCAO', 'CATEGORIAS']));
  }
  function indicadores(ctx, dados) {
    return UnitOfWork.read(ctx, consultaIndicadores(dados));
  }
  function matrizes(ctx, dados) {
    return UnitOfWork.read(ctx, consultaMatrizes(dados));
  }

  /**
   * O resultado de um lançamento de reprodução, desmama ou castração (a tela de resultado e a loja do cliente só mostram):
   * cada animal com a situação reprodutiva, a cria ao pé, a categoria de hoje e a previsão de parto, depois da fase C.
   */
  function resultadoDoEvento(tx, eventId) {
    var L = AnimalService.leitor(tx);
    var est = mapaEstacoes_(tx.repo);
    var ids = Utils.unicos((tx.cru ? tx.cru.cruPor('EVENTO_ANIMAIS', 'event_id', eventId) : tx.repo.por('EVENTO_ANIMAIS', 'event_id', eventId)).map(function (l) { return l.animal_id; }));
    return {
      animais: ids.map(function (id) {
        var a = tx.repo.porId('ANIMAIS', id);
        if (!a) return null;
        var cat = a.situacao_cadastral === 'ATIVO' ? AnimalService.categoriaEm(L, a, L.hoje) : null;
        var prev = a.sexo === 'F' && ['PRENHA', 'INSEMINADA', 'EXPOSTA'].indexOf(a.situacao_reprodutiva) >= 0 ? previsaoParto(registros(L.f, id), L.params, est) : null;
        return { animal_id: id, codigo_interno: a.codigo_interno, brinco: nulo_(a.brinco), sexo: a.sexo, situacao_reprodutiva: nulo_(a.situacao_reprodutiva), cria_ao_pe: a.cria_ao_pe === true, castrado: a.castrado === true, categoria: cat ? { category_id: cat.category_id, nome: cat.nome } : null, previsao_parto: prev };
      }).filter(Boolean),
    };
  }

  return {
    SUBTIPOS: SUBTIPOS,
    EXPOEM: EXPOEM,
    TIPOS_ESTACAO: TIPOS_ESTACAO,
    NOME_SITUACAO: NOME_SITUACAO,
    NOME_FATO: NOME_FATO,
    partos: partos,
    contarPartos: contarPartos,
    avisosParto: avisosParto,
    avisoIdade: avisoIdade,
    historico: historico,
    registros: registros,
    castradoDeOrigem: castradoDeOrigem,
    castracoes: castracoes,
    castradoEm: castradoEm,
    ehCria: ehCria,
    problemasDoAnimal: problemasDoAnimal,
    problemasNovos: problemasNovos,
    problemasNaFonte: problemasNaFonte,
    previsaoParto: previsaoParto,
    blocoFicha: blocoFicha,
    comandoSalvarEstacao: comandoSalvarEstacao,
    salvarEstacao: salvarEstacao,
    cadastros: cadastros,
    leituras: leituras,
    consultaIndicadores: consultaIndicadores,
    consultaMatrizes: consultaMatrizes,
    indicadores: indicadores,
    matrizes: matrizes,
    alertasHoje: alertasHoje,
    resultadoDoEvento: resultadoDoEvento,
  };
})();
