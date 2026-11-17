/**
 * Timeline — linha do tempo por animal (04, seção 5; desenho-base 4.3 e 16.1), marco zero (04, seção 6), projetor
 * de ANIMAIS (03a, seção 4.3.3) e inventário em data. Puro: lê por `tx.repo` (vigentes) e `tx.cru` (inclusive
 * inertes) e escreve só no plano (`tx.plano.atualizar`), pela porta de projeções da UnitOfWork.
 *
 * Linha do tempo = linhas vigentes de EVENTO_ANIMAIS do animal, com o cabeçalho do evento. Ordem canônica:
 * (event_date, classe, posição), classe 0 = entrada (+1), 1 = movimento e demais, 2 = saída (−1); a posição é o
 * event_seq do primeiro evento da cadeia de substituição (o substituto ocupa a posição do original).
 */
var Timeline = (function () {
  var LEITURAS = ['ANIMAIS', 'EVENTO_ANIMAIS', 'EVENTOS', 'IDENTIFICACOES', 'PESAGENS', 'REPRODUCAO', 'AJUSTES',
    'FINANCEIRO', 'PARCELAS', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'PASTOS', 'CONFIGURACOES'];
  /** Linhas de efeito 0 sem pasto que não exigem presença no rebanho: a correção vale para todo o histórico. */
  var SEM_PRESENCA = { AJUSTE_INVENTARIO: ['CORRECAO_CADASTRO', 'IDENTIFICACAO_INCORRETA'] };
  var SAIDA_SITUACAO = { VENDA: 'VENDIDO', MORTE: 'MORTO', DESCARTE: 'DESCARTADO', AJUSTE_INVENTARIO: 'BAIXADO_AJUSTE' };
  var REPRO_SITUACAO = { EXPOSICAO: 'EXPOSTA', COBERTURA: 'EXPOSTA', INSEMINACAO: 'INSEMINADA', PARTO: 'VAZIA', ABORTO: 'VAZIA' };
  var CAMPOS_ATRIBUTO = ['sexo', 'data_nascimento', 'data_nascimento_confianca', 'mae_id', 'mae_confianca', 'pai_id',
    'pai_confianca', 'origem', 'partos_previos'];
  var NOME_EVENTO = {
    ENTRADA_INICIAL: 'a entrada no rebanho inicial', OUTRA_ENTRADA: 'a entrada', NASCIMENTO: 'o nascimento', COMPRA: 'a compra',
    VENDA: 'a venda', TRANSFERENCIA: 'a transferência', MORTE: 'a morte', DESCARTE: 'o descarte', PESAGEM: 'a pesagem',
    SANIDADE: 'o manejo sanitário', REPRODUCAO: 'o registro reprodutivo', DESMAMA: 'a desmama', CASTRACAO: 'a castração',
    IDENTIFICACAO: 'a identificação', MARCACAO: 'a marcação', AJUSTE_INVENTARIO: 'a correção', OCORRENCIA: 'a ocorrência',
  };
  /** Nome do evento pelo subtipo, quando ele diz mais que o tipo. */
  var NOME_SUBTIPO = {
    CORRECAO_LOCALIZACAO: 'a correção de localização', DIVERGENCIA_CONTAGEM: 'a baixa na contagem', RECLASSIFICACAO: 'a reclassificação',
    SUBSTITUICAO: 'a troca de identificação', REMOCAO: 'a retirada de identificação',
  };
  var NOME_IDENTIFICACAO = { BRINCO: 'brinco', BRINCO_ORIGEM: 'brinco de origem', RFID: 'chip (RFID)', SISBOV: 'SISBOV', TATUAGEM: 'tatuagem', OUTRO: 'identificação' };
  var NOME_MARCA = { DESCARTE: 'para descarte', NAO_LOCALIZADO: 'como não localizado' };

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function nulo_(v) {
    return vazio_(v) ? null : v;
  }
  function dataBr(d) {
    return vazio_(d) ? '' : String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4);
  }
  function conjunto_(lista) {
    var s = Object.create(null);
    (lista || []).forEach(function (x) { s[x] = true; });
    return s;
  }
  function comparar_(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  // ------------------------------------------------------------------ parâmetros ----
  /** CONFIGURACOES tipadas, com a semente quando a chave não existe (célula vazia = não informado): ver Config.parametros. */
  function parametros(repo) {
    return Config.parametros(repo);
  }

  // ------------------------------------------------------------------ linhas e ordem ----
  function classe(linha) {
    return linha.efeito === 1 ? 0 : linha.efeito === -1 ? 2 : 1;
  }
  /** ENTRADA, SAIDA, MOVIMENTO (efeito 0 com destino), FATO (exige presença) ou NEUTRO (correção sem data de presença). */
  function papelNaLinha(linha) {
    if (linha.efeito === 1) return 'ENTRADA';
    if (linha.efeito === -1) return 'SAIDA';
    if (!vazio_(linha.pasto_destino_id)) return 'MOVIMENTO';
    var sem = SEM_PRESENCA[linha.event_type];
    return sem && sem.indexOf(linha.event_subtype) >= 0 ? 'NEUTRO' : 'FATO';
  }
  /** Cópia ordenada pela ordem canônica (event_date, classe, posição na cadeia, event_seq). */
  function ordenar(linhas) {
    return (linhas || []).slice().sort(function (a, b) {
      return comparar_(a.event_date, b.event_date) || (classe(a) - classe(b)) || ((a.ordem_seq || 0) - (b.ordem_seq || 0)) ||
        ((a.event_seq || 0) - (b.event_seq || 0)) || comparar_(String(a.event_id), String(b.event_id));
    });
  }
  /** Linha de EVENTO_ANIMAIS + cabeçalho do evento, na forma que o validador e o projetor usam. */
  function linha(registro, evento, ordemSeq) {
    return {
      event_animal_id: registro.event_animal_id, event_id: registro.event_id, animal_id: registro.animal_id,
      papel: registro.papel, efeito: registro.efeito_inventario, pasto_origem_id: nulo_(registro.pasto_origem_id),
      pasto_destino_id: nulo_(registro.pasto_destino_id), atributos: registro.atributos_iniciais_json || null,
      valor_individual: nulo_(registro.valor_individual), event_type: evento.event_type, event_subtype: nulo_(evento.event_subtype),
      event_date: evento.event_date, event_seq: evento.event_seq, ordem_seq: ordemSeq === undefined || ordemSeq === null ? evento.event_seq : ordemSeq,
      pre_marco_zero: evento.pre_marco_zero === true, property_id: evento.property_id, confiabilidade: nulo_(evento.confiabilidade),
      payload: evento.payload_json || null,
    };
  }

  // ------------------------------------------------------------------ validador ----
  function problema_(l, codigo, extra) {
    var p = { codigo: codigo, event_id: l.event_id, event_type: l.event_type, event_subtype: l.event_subtype, event_date: l.event_date, papel: l.papel || null };
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    return p;
  }
  /**
   * Valida a linha do tempo de UM animal, já com a alteração proposta (04, seção 5.1). opcoes: {nascimento,
   * dataEntrada (declarada, para registros anteriores ao marco zero)}. Devolve {problemas, periodos, pasto,
   * dentro, morte}; cada problema: {codigo, event_id, event_type, event_subtype, event_date, pasto_esperado?,
   * pasto_informado?}. Códigos: ENTRADA_JA_DENTRO, FORA_DO_REBANHO, ORIGEM_DIVERGENTE, FORA_DA_PERMANENCIA,
   * APOS_MORTE, ANTES_DO_NASCIMENTO, ANTES_DA_ENTRADA. Depois de uma linha inválida a passada continua com o
   * melhor estado possível (movimento com origem errada leva o animal ao destino), para listar só o que quebrou.
   */
  function validar(linhas, opcoes) {
    var o = opcoes || {};
    var probs = [];
    var dentro = false;
    var pasto = null;
    var morte = null;
    var periodos = [];
    var aberto = null;
    var todas = linhas || [];
    ordenar(todas.filter(function (l) { return !l.pre_marco_zero; })).forEach(function (l) {
      var papel = papelNaLinha(l);
      if (papel === 'FATO' || papel === 'NEUTRO') return;
      if (morte !== null && (l.event_date > morte || papel === 'ENTRADA')) { probs.push(problema_(l, 'APOS_MORTE', { morte: morte })); return; }
      if (papel === 'ENTRADA') {
        if (dentro) { probs.push(problema_(l, 'ENTRADA_JA_DENTRO')); return; }
        dentro = true;
        pasto = l.pasto_destino_id;
        aberto = { inicio: l.event_date, fim: null };
        periodos.push(aberto);
        return;
      }
      if (!dentro) { probs.push(problema_(l, 'FORA_DO_REBANHO')); return; }
      if (!vazio_(l.pasto_origem_id) && l.pasto_origem_id !== pasto) {
        probs.push(problema_(l, 'ORIGEM_DIVERGENTE', { pasto_esperado: pasto, pasto_informado: l.pasto_origem_id }));
      }
      if (papel === 'MOVIMENTO') { pasto = l.pasto_destino_id; return; }
      dentro = false;
      pasto = null;
      aberto.fim = l.event_date;
      if (l.event_type === 'MORTE') morte = l.event_date;
    });
    todas.forEach(function (l) {
      if (l.pre_marco_zero || papelNaLinha(l) !== 'FATO') return;
      if (morte !== null && l.event_date > morte) { probs.push(problema_(l, 'APOS_MORTE', { morte: morte })); return; }
      var cabe = periodos.some(function (p) { return l.event_date >= p.inicio && (p.fim === null || l.event_date <= p.fim); });
      if (!cabe) probs.push(problema_(l, 'FORA_DA_PERMANENCIA'));
    });
    todas.forEach(function (l) {
      if (!vazio_(o.nascimento) && l.event_date < o.nascimento) probs.push(problema_(l, 'ANTES_DO_NASCIMENTO', { nascimento: o.nascimento }));
      else if (l.pre_marco_zero && !vazio_(o.dataEntrada) && l.event_date < o.dataEntrada) probs.push(problema_(l, 'ANTES_DA_ENTRADA', { entrada: o.dataEntrada }));
    });
    return { problemas: probs, periodos: periodos, pasto: pasto, dentro: dentro, morte: morte };
  }
  function ordemDoFato_(a, b) {
    return comparar_(a.data, b.data) || ((a.ordem_seq || 0) - (b.ordem_seq || 0)) || ((a.event_seq || 0) - (b.event_seq || 0)) || comparar_(String(a.id), String(b.id));
  }
  /**
   * Sequência das identificações de UM animal (03a, seção 4.4), por tipo, na ordem (data_inicio, posição na cadeia,
   * event_seq): a primeira identificação exige o tipo sem código em uso; a troca e a retirada exigem um em uso, e a
   * retirada tira exatamente o código em uso. Linhas das entradas, da compra e da correção de brinco abrem o código
   * sem conferência (substituem o anterior). rows: [{ident_id, event_id, tipo, codigo, codigo_norm, data_inicio,
   * event_type, event_subtype, event_seq, ordem_seq}]. Devolve [{codigo (IDENTIFICACAO_JA_EXISTE | SEM_IDENTIFICACAO |
   * REMOCAO_DE_OUTRO_CODIGO), event_id, event_type, event_subtype, event_date, tipo, codigo_ident, aberto}].
   */
  function validarIdentificacoes(rows) {
    var probs = [];
    var porTipo = Object.create(null);
    (rows || []).forEach(function (r) { (porTipo[r.tipo] = porTipo[r.tipo] || []).push(r); });
    Object.keys(porTipo).forEach(function (tipo) {
      var aberto = null;
      porTipo[tipo].map(function (r) { return { r: r, data: r.data_inicio, ordem_seq: r.ordem_seq, event_seq: r.event_seq, id: r.ident_id }; }).sort(ordemDoFato_).forEach(function (x) {
        var r = x.r;
        var p = function (codigo) {
          probs.push({ codigo: codigo, event_id: r.event_id, event_type: r.event_type, event_subtype: r.event_subtype, event_date: r.data_inicio, tipo: tipo, codigo_ident: r.codigo, aberto: aberto ? { codigo: aberto.codigo, data_inicio: aberto.data_inicio, event_id: aberto.event_id } : null, papel: null });
        };
        if (r.event_type !== 'IDENTIFICACAO') { aberto = r; return; }
        if (r.event_subtype === 'PRIMEIRA_IDENTIFICACAO') { if (aberto) p('IDENTIFICACAO_JA_EXISTE'); aberto = r; return; }
        if (r.event_subtype === 'SUBSTITUICAO') { if (!aberto) p('SEM_IDENTIFICACAO'); aberto = r; return; }
        if (!aberto) p('SEM_IDENTIFICACAO');
        else if (aberto.codigo_norm !== r.codigo_norm) p('REMOCAO_DE_OUTRO_CODIGO');
        aberto = null;
      });
    });
    return probs;
  }
  /**
   * Sequência das marcações de UM animal (03a, 4.3.3), por subtipo, na ordem canônica: marcar exige o animal
   * desmarcado; desmarcar, marcado. linhas: linhas da linha do tempo de eventos MARCACAO (com `payload.acao`).
   * Devolve [{codigo (JA_MARCADO | NAO_MARCADO), event_id, event_type, event_subtype, event_date, papel}].
   */
  function validarMarcacoes(linhas) {
    var probs = [];
    var marcado = Object.create(null);
    (linhas || []).filter(function (l) { return l.event_type === 'MARCACAO'; })
      .map(function (l) { return { l: l, data: l.event_date, ordem_seq: l.ordem_seq, event_seq: l.event_seq, id: l.event_id }; }).sort(ordemDoFato_).forEach(function (x) {
        var l = x.l;
        var marcar = !!l.payload && l.payload.acao === 'MARCAR';
        if (marcar === !!marcado[l.event_subtype]) probs.push(problema_(l, marcar ? 'JA_MARCADO' : 'NAO_MARCADO'));
        marcado[l.event_subtype] = marcar;
      });
    return probs;
  }
  /** Problemas de `depois` que não existiam em `antes` (o que a alteração proposta quebrou). */
  function problemasNovos(antes, depois) {
    var visto = conjunto_((antes || []).map(function (p) { return p.codigo + '|' + p.event_id; }));
    return (depois || []).filter(function (p) { return !visto[p.codigo + '|' + p.event_id]; });
  }
  /** Frase do problema, sem o "quem" (o serviço põe o brinco na frente). `nomePasto(id)` resolve o nome. */
  function descrever(p, nomePasto) {
    var np = nomePasto || function (id) { return id; };
    var nome = NOME_SUBTIPO[p.event_subtype] || (p.event_type === 'NASCIMENTO' && p.papel === 'MATRIZ' ? 'o parto' : NOME_EVENTO[p.event_type] || 'o registro');
    var oque = nome + ' de ' + dataBr(p.event_date);
    var ident = NOME_IDENTIFICACAO[p.tipo] || 'identificação';
    switch (p.codigo) {
      case 'IDENTIFICACAO_JA_EXISTE': return oque + ' põe o primeiro ' + ident + ', mas nessa data o animal já tinha o ' + ident + ' ' + p.aberto.codigo + ' (desde ' + dataBr(p.aberto.data_inicio) + '). Para trocar, use a troca de identificação.';
      case 'SEM_IDENTIFICACAO': return oque + ' não cabe: nessa data o animal não tinha ' + ident + '.';
      case 'REMOCAO_DE_OUTRO_CODIGO': return oque + ' tira o ' + ident + ' ' + p.codigo_ident + ', mas nessa data o animal estaria com o ' + p.aberto.codigo + '.';
      case 'JA_MARCADO': return oque + ' marca o animal ' + (NOME_MARCA[p.event_subtype] || '') + ', mas nessa data ele já estava marcado.';
      case 'NAO_MARCADO': return oque + ' desmarca o animal, mas nessa data ele não estava marcado ' + (NOME_MARCA[p.event_subtype] || '') + '.';
      case 'ENTRADA_JA_DENTRO': return oque + ' não cabe: nessa data o animal já estava no rebanho.';
      case 'FORA_DO_REBANHO': return oque + ' não cabe: nessa data o animal não estava no rebanho.';
      case 'FORA_DA_PERMANENCIA': return oque + ' cai fora do período em que o animal esteve no rebanho.';
      case 'ORIGEM_DIVERGENTE': return oque + ' parte do pasto ' + np(p.pasto_informado) + ', mas nessa data o animal estaria no pasto ' + np(p.pasto_esperado) + '.';
      case 'APOS_MORTE': return 'o animal morreu em ' + dataBr(p.morte) + ' e não aceita ' + oque + '.';
      case 'ANTES_DO_NASCIMENTO': return oque + ' é anterior ao nascimento (' + dataBr(p.nascimento) + ').';
      case 'ANTES_DA_ENTRADA': return oque + ' é anterior à chegada do animal na fazenda (' + dataBr(p.entrada) + ').';
      default: return oque + ' não é compatível com o histórico do animal.';
    }
  }

  // ------------------------------------------------------------------ fonte de dados ----
  /**
   * Acesso indexado às linhas de uma unidade (tx.repo e, se houver, tx.cru), com `excluir` = eventos tratados
   * como não vigentes (validação de estorno e de substituição). Tudo memoizado por fonte.
   */
  function fonte(tx, opcoes) {
    var o = opcoes || {};
    var repo = tx.repo;
    var cru = tx.cru || null;
    var excl = conjunto_(o.excluir);
    var params = o.parametros || parametros(repo);
    var memo = Object.create(null);
    function lembrar(k, fn) {
      if (!(k in memo)) memo[k] = fn();
      return memo[k];
    }
    function evento(id) {
      if (vazio_(id)) return null;
      return cru ? cru.cruPorId('EVENTOS', id) : repo.porId('EVENTOS', id);
    }
    function vale(id) {
      return !vazio_(id) && !excl[id] && repo.eventoVigente(id);
    }
    function statusEvento(id) {
      if (excl[id]) return 'ESTORNADO';
      if (cru) {
        var a = cru.avaliar(id);
        return a ? a.status : 'FALHOU'; // linha filha cujo evento não chegou à planilha (queda na fase A)
      }
      return repo.eventoVigente(id) ? 'CONFIRMADO' : null;
    }
    function ordemSeq(id) {
      return lembrar('o' + id, function () {
        var atual = evento(id);
        if (!atual) return null;
        for (var guarda = 0; guarda < 10000; guarda++) {
          if (vazio_(atual.reversal_of_event_id) || atual.event_type === 'ESTORNO') break;
          var alvo = evento(atual.reversal_of_event_id);
          // Sem acesso cru o evento anulado não aparece e a cadeia pararia no substituto, que cairia no fim do dia:
          // a ordem do dia ficaria errada em silêncio. Quem reproduz a linha do tempo declara `acessoCru`.
          if (!alvo && !cru) throw Validation.erro('INTERNAL', 'A consulta precisa de acesso cru para achar a posição de um evento corrigido na ordem do dia (desenho-base 16.1).');
          if (!alvo || alvo.event_type !== atual.event_type) break;
          atual = alvo;
        }
        return atual.event_seq;
      });
    }
    function enriquecer(r) {
      var ev = evento(r.event_id);
      return ev ? linha(r, ev, ordemSeq(r.event_id)) : null;
    }
    function filhasVigentes(tabela, campo, valor) {
      return repo.por(tabela, campo, valor).filter(function (r) { return !excl[r.event_id]; });
    }
    var f = {
      parametros: params,
      marcoZero: params.data_marco_zero,
      excluidos: excl,
      evento: evento,
      vale: vale,
      statusEvento: statusEvento,
      ordemSeq: ordemSeq,
      linhas: function (animalId) {
        return lembrar('l' + animalId, function () {
          return filhasVigentes('EVENTO_ANIMAIS', 'animal_id', animalId).map(enriquecer).filter(Boolean);
        });
      },
      linhasCru: function (animalId) {
        return cru ? cru.cruPor('EVENTO_ANIMAIS', 'animal_id', animalId) : repo.por('EVENTO_ANIMAIS', 'animal_id', animalId);
      },
      linhasDoEvento: function (eventId) {
        return cru ? cru.cruPor('EVENTO_ANIMAIS', 'event_id', eventId) : repo.por('EVENTO_ANIMAIS', 'event_id', eventId);
      },
      todasAsLinhas: function () {
        return repo.vigentes('EVENTO_ANIMAIS').filter(function (r) { return !excl[r.event_id]; }).map(enriquecer).filter(Boolean);
      },
      ajustes: function (animalId) { return filhasVigentes('AJUSTES', 'animal_id', animalId); },
      identificacoes: function (animalId) { return filhasVigentes('IDENTIFICACOES', 'animal_id', animalId); },
      pesagens: function (animalId) { return filhasVigentes('PESAGENS', 'animal_id', animalId); },
      reproducao: function (animalId) { return filhasVigentes('REPRODUCAO', 'animal_id', animalId); },
      /** Alocações vigentes de lançamentos AQUISICAO_ANIMAIS do animal: [{valor, data_competencia, event_id}]. */
      aquisicoes: function (animalId) {
        if (!repo.carregada('ALOCACOES_FINANCEIRAS')) return [];
        var out = [];
        repo.por('ALOCACOES_FINANCEIRAS', 'animal_id', animalId).forEach(function (a) {
          var fin = repo.porId('FINANCEIRO', a.financial_id);
          var rat = repo.porId('RATEIOS', a.rateio_id);
          if (!fin || !rat || excl[fin.event_id] || excl[rat.event_id] || fin.natureza !== 'AQUISICAO_ANIMAIS') return;
          out.push({ valor: a.valor_alocado || 0, data_competencia: fin.data_competencia, event_id: rat.event_id });
        });
        return out;
      },
      animal: function (id) { return cru ? cru.cruPorId('ANIMAIS', id) : repo.porId('ANIMAIS', id); },
      animais: function () { return cru ? cru.cru('ANIMAIS') : repo.vigentes('ANIMAIS'); },
      pasto: function (id) { return vazio_(id) ? null : repo.porId('PASTOS', id); },
    };
    return f;
  }

  // ------------------------------------------------------------------ projetor ----
  function deTexto_(campo, texto) {
    if (vazio_(texto)) return null;
    if (campo === 'castrado' || campo === 'reprodutor') return texto === 'S' || texto === true;
    if (campo === 'partos_previos') return Number(texto);
    return texto;
  }
  function boolJson_(v) {
    if (v === undefined || v === null || v === '') return null;
    return v === true || v === 'S';
  }
  function ultimoPor_(lista, chave) {
    var melhor = null;
    (lista || []).forEach(function (x) {
      if (!melhor || chave(x, melhor) >= 0) melhor = x;
    });
    return melhor;
  }
  /**
   * Projeção de UM animal (03a, seção 4.3.3), sem `cria_ao_pe` (depende das crias: `projetar` completa).
   * Devolve {campos, meta}; meta: {situacao, entrada (linha), criacao (linha), evento_criacao}.
   */
  function projetarAnimal(f, id) {
    var animal = f.animal(id);
    var p = f.parametros;
    var vig = f.linhas(id);
    var cruas = f.linhasCru(id);
    // Sem linha nenhuma: cadastro de referência (EXTERNO), salvo a linha anexada na fase A de uma operação que caiu
    // antes de as linhas de EVENTO_ANIMAIS chegarem (nasce PENDENTE e fica ANULADO; nunca vira EXTERNO).
    var gravada = animal ? animal.situacao_cadastral : null;
    if (!cruas.length && !vig.length && gravada !== 'PENDENTE' && gravada !== 'ANULADO') {
      return { campos: { situacao_cadastral: 'EXTERNO', pasto_atual_id: null, propriedade_atual_id: null, evento_origem_id: null }, meta: { situacao: 'EXTERNO' } };
    }
    var replay = ordenar(vig.filter(function (l) { return !l.pre_marco_zero; }));
    var pre = vig.filter(function (l) { return l.pre_marco_zero; });
    var soma = 0;
    var ultimaSaida = null;
    var entrada = null;
    var pastoAtual = null;
    var ultimoMov = null;
    replay.forEach(function (l) {
      soma += l.efeito || 0;
      if (l.efeito === -1) ultimaSaida = l;
      if (l.efeito === 1) entrada = l;
      if (!vazio_(l.pasto_destino_id)) pastoAtual = l.pasto_destino_id;
      if (l.efeito === -1) pastoAtual = null;
      if (l.efeito !== 0 || !vazio_(l.pasto_destino_id)) ultimoMov = ultimoMov === null || l.event_date > ultimoMov ? l.event_date : ultimoMov;
    });
    var situacao;
    var saidaHist = null;
    // Ordem 2 e 3 da tabela de 03a, 4.3.4: só linha de inventário (efeito ≠ 0 ou com pasto) decide. Fato NEUTRO depois
    // do marco zero (correção de cadastro, troca de brinco lançado errado) não tira o animal do histórico (ordem 4).
    var deInventario = replay.some(function (l) { return (l.efeito || 0) !== 0 || !vazio_(l.pasto_destino_id); });
    if (!vig.length) {
      situacao = cruas.some(function (l) { return f.statusEvento(l.event_id) === 'PENDENTE'; }) ? 'PENDENTE' : 'ANULADO';
    } else if (deInventario || !pre.length) {
      if (soma >= 1) situacao = 'ATIVO';
      else if (ultimaSaida) situacao = SAIDA_SITUACAO[ultimaSaida.event_type] || 'ANULADO';
      else situacao = 'ANULADO';
    } else {
      saidaHist = ultimoPor_(pre.filter(function (l) { return l.event_type === 'VENDA' || l.event_type === 'MORTE'; }), function (a, b) { return comparar_(a.event_date, b.event_date) || (a.ordem_seq - b.ordem_seq) || (a.event_seq - b.event_seq); });
      situacao = saidaHist ? SAIDA_SITUACAO[saidaHist.event_type] : 'HISTORICO';
    }
    var fora = situacao === 'ANULADO' || situacao === 'PENDENTE';
    // Linha que criou o animal: a vigente com atributos; anulado/pendente conserva os dados declarados (a mais recente).
    var criacao = ultimoPor_(vig.filter(function (l) { return !!l.atributos; }), function (a, b) { return a.ordem_seq - b.ordem_seq || a.event_seq - b.event_seq; });
    if (!criacao && fora) {
      var cr = ultimoPor_(cruas.filter(function (r) { return !!r.atributos_iniciais_json; }), function (a, b) {
        var ea = f.evento(a.event_id);
        var eb = f.evento(b.event_id);
        return ((ea && ea.event_seq) || 0) - ((eb && eb.event_seq) || 0);
      });
      var evc = cr ? f.evento(cr.event_id) : null;
      criacao = cr && evc ? linha(cr, evc, evc.event_seq) : null;
    }
    var at = (criacao && criacao.atributos) || {};
    var base = {};
    CAMPOS_ATRIBUTO.forEach(function (c) { base[c] = nulo_(at[c]); });
    base.castrado = boolJson_(at.castrado);
    base.reprodutor = boolJson_(at.reprodutor);
    base.data_entrada = nulo_(at.data_entrada);
    base.data_entrada_confianca = nulo_(at.data_entrada_confianca);
    var ajustes = f.ajustes(id).map(function (a) { var ev = f.evento(a.event_id); return { a: a, seq: ev ? ev.event_seq : 0, ord: ev ? f.ordemSeq(a.event_id) : 0, data: ev ? ev.event_date : '' }; });
    if (!fora) {
      // Na ordem de registro, com o substituto no lugar do original (desenho-base 16.1: corrigir não muda a ordem).
      ajustes.filter(function (x) { return x.a.tipo_ajuste === 'CORRECAO_CADASTRO'; }).sort(function (x, y) { return x.ord - y.ord || x.seq - y.seq; }).forEach(function (x) {
        if (Object.prototype.hasOwnProperty.call(base, x.a.campo)) base[x.a.campo] = deTexto_(x.a.campo, x.a.valor_novo);
      });
    }
    var sexo = base.sexo;
    var macho = sexo === 'M';
    var femea = sexo === 'F';
    var castracao = !fora && vig.some(function (l) { return l.event_type === 'CASTRACAO'; });
    var castrado = macho ? base.castrado === true || castracao : null;
    // Reclassificação: a última por (data, posição na cadeia de substituição, event_seq) — o substituto fica no lugar do original.
    var reclass = ultimoPor_(fora ? [] : ajustes.filter(function (x) { return x.a.tipo_ajuste === 'RECLASSIFICACAO'; }), function (x, y) { return comparar_(x.data, y.data) || x.ord - y.ord || x.seq - y.seq; });
    var campos = {
      sexo: sexo,
      data_nascimento: base.data_nascimento,
      data_nascimento_confianca: base.data_nascimento_confianca,
      mae_id: base.mae_id, mae_confianca: base.mae_confianca,
      pai_id: base.pai_id, pai_confianca: base.pai_confianca,
      origem: base.origem,
      evento_origem_id: !fora && criacao ? criacao.event_id : null,
      castrado: castrado,
      reprodutor: macho ? (castrado ? false : base.reprodutor === true) : null,
      // Fêmea nascida no sistema não tem parto anterior (03a, 4.3.5): 0, não "desconhecido".
      partos_previos: femea ? (base.partos_previos !== null ? Number(base.partos_previos) : criacao && criacao.event_type === 'NASCIMENTO' ? 0 : null) : null,
      pasto_atual_id: situacao === 'ATIVO' ? pastoAtual : null,
      propriedade_atual_id: null,
      categoria_modo: reclass && !vazio_(reclass.a.valor_novo) ? 'MANUAL' : 'AUTO',
      categoria_manual_id: reclass && !vazio_(reclass.a.valor_novo) ? reclass.a.valor_novo : null,
      situacao_reprodutiva: null,
      marcado_descarte: marcacao_(fora ? [] : vig, 'DESCARTE'),
      nao_localizado: marcacao_(fora ? [] : vig, 'NAO_LOCALIZADO'),
      situacao_cadastral: situacao,
      data_entrada: null, data_entrada_confianca: null,
      data_saida: null,
      peso_atual: null, data_ultima_pesagem: null,
      data_ultimo_movimento: fora ? null : ultimoMov,
      custo_aquisicao: null, custo_aquisicao_origem: null,
      brinco: null, brinco_norm: null,
    };
    if (situacao === 'ATIVO') {
      var pst = f.pasto(pastoAtual);
      campos.propriedade_atual_id = pst ? pst.property_id : entrada ? entrada.property_id : null;
    }
    if (!fora && entrada) {
      if (entrada.event_type === 'ENTRADA_INICIAL') {
        campos.data_entrada = base.data_entrada;
        campos.data_entrada_confianca = base.data_entrada === null && base.data_entrada_confianca === null ? 'DESCONHECIDA' : base.data_entrada_confianca;
      } else {
        campos.data_entrada = entrada.event_date;
        campos.data_entrada_confianca = entrada.confiabilidade || 'DESCONHECIDA';
      }
    }
    if (situacao === 'VENDIDO' || situacao === 'MORTO' || situacao === 'DESCARTADO' || situacao === 'BAIXADO_AJUSTE') {
      campos.data_saida = ultimaSaida ? ultimaSaida.event_date : saidaHist ? saidaHist.event_date : null;
    }
    if (!fora) {
      // Pesagens do mesmo dia: (data, posição na cadeia de substituição, event_seq) — o substituto fica no lugar do original.
      var pes = ultimoPor_(f.pesagens(id).map(function (x) { var ev = f.evento(x.event_id); return { x: x, seq: ev ? ev.event_seq : 0, ord: ev ? f.ordemSeq(x.event_id) : 0 }; }), function (a, b) { return comparar_(a.x.data_pesagem, b.x.data_pesagem) || a.ord - b.ord || a.seq - b.seq; });
      if (pes) { campos.peso_atual = pes.x.peso_kg; campos.data_ultima_pesagem = pes.x.data_pesagem; }
      var brinco = codigoEmUso_(linhasDeIdentificacao_(f, id).BRINCO);
      if (brinco) { campos.brinco = brinco.codigo; campos.brinco_norm = brinco.codigo_norm; }
      custo_(f, id, entradaDoCusto(vig), campos);
    }
    if (femea) campos.situacao_reprodutiva = situacaoReprodutiva_(f, id, fora, at, criacao);
    return { campos: campos, meta: { situacao: situacao, entrada: entrada, entradaCusto: fora ? null : entradaDoCusto(vig), criacao: criacao, chegada: chegada_(criacao, base) } };
  }
  /**
   * A entrada que abre o período de permanência do custo de aquisição (03a, ANIMAIS.custo_aquisicao: "do período de
   * permanência atual ou do último", DL-08): a entrada vigente mais recente desde o marco zero; o animal que só existe no
   * histórico (comprado, ou nascido, e vendido antes do marco zero) não tem nenhuma, e o último período dele é o
   * histórico: a compra, a outra entrada ou o nascimento anterior ao marco zero mais recente. O animal do marco zero tem
   * a entrada dele, e a compra histórica de antes dela fica fora do custo (04, seção 6). `linhas` = vigentes do animal.
   */
  function entradaDoCusto(linhas) {
    var ent = null;
    ordenar((linhas || []).filter(function (l) { return !l.pre_marco_zero; })).forEach(function (l) { if (l.efeito === 1) ent = l; });
    if (ent) return ent;
    if ((linhas || []).some(function (l) { return !l.pre_marco_zero && ((l.efeito || 0) !== 0 || !vazio_(l.pasto_destino_id)); })) return null;
    var hist = ordenar((linhas || []).filter(function (l) {
      return l.pre_marco_zero && (((l.event_type === 'COMPRA' || l.event_type === 'OUTRA_ENTRADA') && (l.papel || 'SUJEITO') === 'SUJEITO') || (l.event_type === 'NASCIMENTO' && l.papel === 'CRIA'));
    }));
    return hist.length ? hist[hist.length - 1] : null;
  }
  /**
   * Chegada declarada na fazenda (04, seção 6: os registros anteriores ao marco zero são validados contra ela, não
   * contra a volta mais recente): no rebanho inicial, a `data_entrada` informada com as correções vigentes; no animal
   * criado por compra ou outra entrada (mesmo antiga), a data desse lançamento; nascido na fazenda, nenhuma.
   */
  function chegada_(criacao, base) {
    if (!criacao) return { data: null, confianca: null };
    if (criacao.event_type === 'ENTRADA_INICIAL') return { data: base.data_entrada, confianca: base.data_entrada_confianca };
    if (criacao.event_type === 'COMPRA' || criacao.event_type === 'OUTRA_ENTRADA') return { data: criacao.event_date, confianca: criacao.confiabilidade || null };
    return { data: null, confianca: null };
  }
  /** {data, confianca} da chegada declarada do animal na fonte f (ver chegada_). */
  function chegadaDeclarada(f, id) {
    return projetarAnimal(f, id).meta.chegada || { data: null, confianca: null };
  }
  /**
   * A situação reprodutiva e a marca de descarte do animal NA DATA D (07, seção 8.3: "contagem em D"): a mesma regra da
   * projeção, só com os fatos até D — o último registro reprodutivo, com a situação declarada na entrada valendo como o fato
   * da data dela (a projeção, a lista de fêmeas e os indicadores usam esta função; um fato gravado depois de D não muda o
   * número de D) e a última marcação de descarte vigente até D. {situacao_reprodutiva, marcado_descarte}.
   */
  function reproducaoEm(f, id, data) {
    var vig = f.linhas(id);
    var criacao = ultimoPor_(vig.filter(function (l) { return !!l.atributos; }), function (a, b) { return a.ordem_seq - b.ordem_seq || a.event_seq - b.event_seq; });
    var at = (criacao && criacao.atributos) || {};
    var animal = f.animal(id);
    return {
      situacao_reprodutiva: animal && animal.sexo !== 'F' ? null : situacaoReprodutiva_(f, id, false, at, criacao, data),
      marcado_descarte: marcacao_(vig.filter(function (l) { return l.event_date <= data; }), 'DESCARTE'),
    };
  }
  function marcacao_(vig, subtipo) {
    var ultima = ultimoPor_(vig.filter(function (l) { return l.event_type === 'MARCACAO' && l.event_subtype === subtipo; }), function (a, b) { return comparar_(a.event_date, b.event_date) || a.ordem_seq - b.ordem_seq; });
    return !!ultima && !!ultima.payload && ultima.payload.acao === 'MARCAR';
  }
  function situacaoReprodutiva_(f, id, fora, at, criacao, ate) {
    // A situação declarada na entrada (rebanho inicial, compra, outra entrada) vale como o fato da data da entrada: o
    // registro de antes dela (o histórico reprodutivo importado de antes do marco zero, E3.6) fica na ficha e nos
    // indicadores, mas não desfaz o que foi declarado depois dele. Com `ate` (a data D), só os fatos até D; a declarada vale
    // a partir da data da entrada.
    var desde = !vazio_(at.situacao_reprodutiva) && criacao ? criacao.event_date : null;
    if (ate && desde && desde > ate) desde = null;
    var declarada = vazio_(at.situacao_reprodutiva) || (ate && criacao && criacao.event_date > ate) ? null : at.situacao_reprodutiva;
    var fatos = fora ? [] : f.reproducao(id).filter(function (r) { return !ate || r.data <= ate; }).map(function (r) {
      var ev = f.evento(r.event_id);
      var s = r.tipo_evento === 'DIAGNOSTICO_GESTACAO' ? (r.resultado === 'POSITIVO' ? 'PRENHA' : r.resultado === 'NEGATIVO' ? 'VAZIA' : null) : REPRO_SITUACAO[r.tipo_evento] || null;
      return { s: s, data: r.data, seq: ev ? ev.event_seq : 0, ord: ev ? f.ordemSeq(r.event_id) : 0 };
    }).filter(function (x) { return x.s !== null && (desde === null || x.data >= desde); });
    var ultimo = ultimoPor_(fatos, function (a, b) { return comparar_(a.data, b.data) || a.ord - b.ord || a.seq - b.seq; });
    if (ultimo) return ultimo.s;
    if (declarada) return declarada;
    return criacao && criacao.event_type === 'NASCIMENTO' ? 'NAO_APTA' : 'SEM_INFORMACAO';
  }
  function custo_(f, id, entrada, campos) {
    if (!entrada) return;
    var alocs = f.aquisicoes(id).filter(function (a) { return a.data_competencia >= entrada.event_date; });
    var tem = alocs.length > 0;
    campos.custo_aquisicao = tem ? alocs.reduce(function (s, a) { return s + a.valor; }, 0) : entrada.event_type === 'NASCIMENTO' ? 0 : null;
    var t = entrada.event_type;
    if (t === 'COMPRA') campos.custo_aquisicao_origem = 'NEGOCIADO';
    else if (t === 'NASCIMENTO') campos.custo_aquisicao_origem = 'NAO_SE_APLICA';
    else if (t === 'ENTRADA_INICIAL' && alocs.some(function (a) { return a.event_id === entrada.event_id; })) {
      campos.custo_aquisicao_origem = entrada.payload && entrada.payload.valor_abertura_origem === 'TABELA_PRECOS' ? 'ABERTURA_ESTIMADA' : 'ABERTURA_INFORMADA';
    } else campos.custo_aquisicao_origem = 'DESCONHECIDO';
  }
  /**
   * Última pesagem individual (não MEDIA_LOTE) do animal até a data, na fonte f, por (data, posição na cadeia de
   * substituição, event_seq): a base estimada do rateio da venda só com o peso do lote (03b, seção 4.3), que a venda grava
   * e a verificação de integridade refaz. {peso_kg, data, seq, ord} ou null.
   */
  function ultimaPesagem(f, animalId, data) {
    var melhor = null;
    f.pesagens(animalId).forEach(function (p) {
      if (p.data_pesagem > data || p.metodo === 'MEDIA_LOTE' || typeof p.peso_kg !== 'number') return;
      var ev = f.evento(p.event_id);
      var x = { peso_kg: p.peso_kg, data: p.data_pesagem, seq: ev ? ev.event_seq : 0, ord: ev ? f.ordemSeq(p.event_id) : 0 };
      if (!melhor || x.data > melhor.data || (x.data === melhor.data && (x.ord > melhor.ord || (x.ord === melhor.ord && x.seq > melhor.seq)))) melhor = x;
    });
    return melhor;
  }
  /** Linha de IDENTIFICACOES com o cabeçalho do evento que a gravou (forma de `validarIdentificacoes`). */
  function linhaIdentificacao(r, evento, ordemSeq) {
    var ev = evento || {};
    return {
      ident_id: r.ident_id, event_id: r.event_id, animal_id: r.animal_id, tipo: r.tipo, codigo: r.codigo, codigo_norm: r.codigo_norm,
      data_inicio: r.data_inicio, motivo: nulo_(r.motivo), event_type: ev.event_type || null, event_subtype: nulo_(ev.event_subtype),
      event_seq: ev.event_seq || 0, ordem_seq: ordemSeq === undefined || ordemSeq === null ? ev.event_seq || 0 : ordemSeq,
      remocao: ev.event_type === 'IDENTIFICACAO' && ev.event_subtype === 'REMOCAO',
    };
  }
  /** IDENTIFICACOES vigentes do animal (com o cabeçalho do evento), na ordem (data_inicio, posição na cadeia, event_seq). */
  function identificacoes(f, id) {
    return f.identificacoes(id).map(function (r) { return linhaIdentificacao(r, f.evento(r.event_id), f.ordemSeq(r.event_id)); })
      .map(function (x) { return { x: x, data: x.data_inicio, ordem_seq: x.ordem_seq, event_seq: x.event_seq, id: x.ident_id }; }).sort(ordemDoFato_).map(function (o) { return o.x; });
  }
  /**
   * IDENTIFICACOES vigentes do animal por tipo, na ordem de `identificacoes`. A linha de uma retirada (IDENTIFICACAO/
   * REMOCAO) guarda o código tirado e o motivo: fecha o código em uso e fecha a si mesma (data_fim = data_inicio).
   */
  function linhasDeIdentificacao_(f, id) {
    var por = {};
    identificacoes(f, id).forEach(function (x) {
      (por[x.tipo] = por[x.tipo] || []).push(x);
    });
    return por;
  }
  /**
   * O brinco em uso no fim do dia D (a regra da projeção, só com as identificações até D): o código, ou null (sem brinco
   * naquele dia, ou retirado). Sem nenhuma identificação de brinco gravada, o brinco do cadastro. Serve à posição de uma data
   * passada (o curral e o tronco acham o animal pelo número daquele dia: 08, seção 5, item 5) e ao retrato em D (`retratoEm`).
   */
  function brincoEm(f, id, data) {
    var b = brincoNaData_(f, id, data);
    return b ? b.codigo : null;
  }
  /**
   * A sequência dos números de brinco do animal pela regra única do brinco numa data (a de `brincoEm`, da posição numa data e
   * da importação de fatos de uma data passada): o número lançado por engano e corrigido por AJUSTE_INVENTARIO/
   * IDENTIFICACAO_INCORRETA nunca esteve na orelha (desenho-base 16.2) — o número certo vale desde o início do período do
   * errado, não da data da correção. A correção toma o lugar da linha que corrige na sequência (com a data de início dela);
   * duas correções seguidas recuam juntas. [{codigo, codigo_norm, data_inicio, remocao}], na ordem.
   */
  function sequenciaDeBrinco_(f, id) {
    return cadeiaDeBrinco_(f, id).seq;
  }
  /**
   * A cadeia da regra única: {seq (a de `sequenciaDeBrinco_`), errados: [{codigo, codigo_norm, inicio, i}]} — cada número
   * lançado por engano e corrigido, com o início do período que teria e a posição `i`, na sequência, do número que o corrigiu.
   */
  function cadeiaDeBrinco_(f, id) {
    var seq = [];
    var errados = [];
    (linhasDeIdentificacao_(f, id).BRINCO || []).forEach(function (x) {
      var anterior = seq.length ? seq[seq.length - 1] : null;
      if (x.event_type === 'AJUSTE_INVENTARIO' && x.event_subtype === 'IDENTIFICACAO_INCORRETA' && anterior && !anterior.remocao) {
        errados.push({ codigo: anterior.codigo, codigo_norm: anterior.codigo_norm, inicio: anterior.data_inicio, i: seq.length - 1 });
        seq[seq.length - 1] = { codigo: x.codigo, codigo_norm: x.codigo_norm, data_inicio: anterior.data_inicio, remocao: false };
        return;
      }
      seq.push({ codigo: x.codigo, codigo_norm: x.codigo_norm, data_inicio: x.data_inicio, remocao: x.remocao });
    });
    return { seq: seq, errados: errados };
  }
  /**
   * Os números de brinco lançados por engano no animal e corrigidos por AJUSTE_INVENTARIO/IDENTIFICACAO_INCORRETA (nunca
   * estiveram na orelha: desenho-base 16.2), com o número que vale no lugar de cada um (o último da correção em cadeia):
   * [{codigo, codigo_norm, inicio, corrigido_para}]. Serve à recusa explicada do resolvedor único (`Identificacao`).
   */
  function brincosLancadosErrado(f, id) {
    var c = cadeiaDeBrinco_(f, id);
    return c.errados.map(function (x) { return { codigo: x.codigo, codigo_norm: nulo_(x.codigo_norm), inicio: x.inicio, corrigido_para: c.seq[x.i].codigo }; });
  }
  /** {codigo, codigo_norm} do brinco em uso no fim do dia D, ou null (a regra de `brincoEm`). */
  function brincoNaData_(f, id, data) {
    var seq = sequenciaDeBrinco_(f, id);
    if (!seq.length) { var a = f.animal(id); return a && !vazio_(a.brinco) ? { codigo: a.brinco, codigo_norm: nulo_(a.brinco_norm) } : null; }
    var u = codigoEmUso_(seq.filter(function (x) { return x.data_inicio <= data; }));
    return u ? { codigo: u.codigo, codigo_norm: nulo_(u.codigo_norm) } : null;
  }
  /**
   * Os períodos de uso dos números de brinco do animal pela mesma regra (`sequenciaDeBrinco_`; o número errado corrigido não
   * tem período): [{codigo, codigo_norm, inicio, fim}], com o fim exclusivo (o início do seguinte ou a retirada; null = em
   * uso). O dono de um número numa data passada sai daqui na importação, e é o mesmo animal que a posição daquela data dá ao
   * número (inventario.elegiveis, o curral; CONTRATOS, seção 46).
   */
  function periodosDeBrinco(f, id) {
    var seq = sequenciaDeBrinco_(f, id);
    var out = [];
    seq.forEach(function (x, i) {
      if (x.remocao) return;
      var prox = i + 1 < seq.length ? seq[i + 1] : null;
      out.push({ codigo: x.codigo, codigo_norm: nulo_(x.codigo_norm), inicio: x.data_inicio, fim: prox ? prox.data_inicio : null });
    });
    return out;
  }
  /** A linha de correção que vale para todo o histórico (04, seção 4.4; desenho-base 16.2): cadastro e brinco lançado errado. */
  function semPresenca_(l) {
    return (SEM_PRESENCA[l.event_type] || []).indexOf(l.event_subtype) >= 0;
  }
  /**
   * A fonte restrita aos fatos até o fim do dia D (desenho-base 4.3: "na data D" = estado ao fim do dia D): as linhas, as
   * pesagens, os registros reprodutivos, as identificações, as reclassificações e as alocações de aquisição com data até D.
   * A correção de cadastro e a do brinco lançado errado valem para todo o histórico e ficam em qualquer data. O resto (os
   * eventos, a ordem do dia, os cadastros, os parâmetros) é o da fonte. Memorizada por fonte e data.
   */
  function fonteAte(f, data) {
    // Sempre sobre a fonte inteira (restringir uma fonte já restrita a outra data perderia fatos), que pode herdar os métodos
    // de outra (a fonte do lançamento em análise no motor).
    var base = f.base_ || f;
    if (!Object.prototype.hasOwnProperty.call(base, 'ates_')) base.ates_ = Object.create(null);
    if (base.ates_[data]) return base.ates_[data];
    var memo = Object.create(null);
    var lembrar = function (k, fn) { if (!(k in memo)) memo[k] = fn(); return memo[k]; };
    var ate = function (l) { return l.event_date <= data || semPresenca_(l); };
    var g = Object.create(base);
    g.base_ = base;
    g.ate = data;
    g.linhas = function (id) { return lembrar('l' + id, function () { return base.linhas(id).filter(ate); }); };
    g.todasAsLinhas = function () { return lembrar('t', function () { return base.todasAsLinhas().filter(ate); }); };
    g.pesagens = function (id) { return base.pesagens(id).filter(function (p) { return p.data_pesagem <= data; }); };
    g.reproducao = function (id) { return base.reproducao(id).filter(function (r) { return r.data <= data; }); };
    g.identificacoes = function (id) { return base.identificacoes(id).filter(function (r) { return r.data_inicio <= data; }); };
    g.ajustes = function (id) {
      return base.ajustes(id).filter(function (x) {
        if (x.tipo_ajuste === 'CORRECAO_CADASTRO' || x.tipo_ajuste === 'IDENTIFICACAO_INCORRETA') return true;
        var ev = base.evento(x.event_id);
        return !!ev && ev.event_date <= data;
      });
    };
    g.aquisicoes = function (id) { return base.aquisicoes(id).filter(function (x) { return x.data_competencia <= data; }); };
    base.ates_[data] = g;
    return g;
  }
  /**
   * O animal como estava no fim do dia D: a projeção de ANIMAIS pelo MESMO projetor do estado de hoje (`projetarAnimal`)
   * sobre os fatos até D (`fonteAte`), com o brinco em uso em D (`brincoEm`: o número corrigido por IDENTIFICACAO_INCORRETA
   * desde o início do errado, desenho-base 16.2) e a cria ao pé em D (`criaAoPeEm`). Os atributos de criação e as correções
   * de cadastro valem para todo o histórico; o resto (situação, pasto, saída, peso, situação reprodutiva, marcas, castração,
   * reclassificação) é o daquele dia. Em D = hoje é a projeção gravada (nenhum fato tem data depois de hoje; a verificação
   * do teste aleatório confere). É o ponto único das consultas numa data (CONTRATOS, seção 46): uma lista ou conta em D
   * descreve o animal por aqui, nunca pela projeção de hoje. null quando o animal ainda não tinha linha até D (nem no
   * histórico anterior ao marco zero). `filhos` = os animal_id das crias (mae_id), para a cria ao pé.
   */
  function retratoEm(f, id, data, filhos) {
    var base = f.base_ || f;
    var a = base.animal(id);
    if (!a) return null;
    if (a.situacao_cadastral === 'EXTERNO') return a;
    var g = fonteAte(base, data);
    if (!g.linhas(id).some(function (l) { return !semPresenca_(l); })) return null;
    var p = projetarAnimal(g, id).campos;
    var r = {};
    Object.keys(a).forEach(function (k) { r[k] = a[k]; });
    Object.keys(p).forEach(function (k) { r[k] = p[k]; });
    // O custo de aquisição não é um dado da data (03a, DL-08: o da permanência atual ou da última) e depende das abas do
    // financeiro, que as consultas numa data não leem: o retrato não o traz.
    delete r.custo_aquisicao;
    delete r.custo_aquisicao_origem;
    var b = brincoNaData_(base, id, data);
    r.brinco = b ? b.codigo : null;
    r.brinco_norm = b ? b.codigo_norm : null;
    r.cria_ao_pe = r.sexo === 'F' && r.situacao_cadastral !== 'EXTERNO' ? criaAoPeEm(base, filhos || [], data) : null;
    return r;
  }
  /** Código em uso de um tipo ao fim da sequência (ou vazio, depois de uma retirada). */
  function codigoEmUso_(lista) {
    var ultima = lista && lista.length ? lista[lista.length - 1] : null;
    return ultima && !ultima.remocao ? ultima : null;
  }
  /**
   * Projeções completas de um conjunto de animais (com as mães que a mudança alcança e `cria_ao_pe`).
   * `ids` = null → todos. Devolve {animal_id: {campos, meta}}.
   */
  function projetar(f, ids) {
    var todos = f.animais();
    var alvo = ids === null || ids === undefined ? todos.map(function (a) { return a.animal_id; }) : Utils.unicos(ids);
    var proj = Object.create(null);
    function fazer(id) {
      if (proj[id] || !f.animal(id)) return;
      proj[id] = projetarAnimal(f, id);
    }
    alvo.forEach(fazer);
    // Mães alcançadas (a antiga, gravada, e a nova, projetada): a cria ao pé delas muda com a cria.
    Object.keys(proj).forEach(function (id) {
      var a = f.animal(id);
      [a && a.mae_id, proj[id].campos.mae_id].forEach(function (m) { if (!vazio_(m)) fazer(m); });
    });
    var filhos = Object.create(null);
    todos.forEach(function (a) {
      var pj = proj[a.animal_id];
      var mae = pj && pj.meta.situacao !== 'EXTERNO' ? pj.campos.mae_id : a.mae_id;
      if (!vazio_(mae)) (filhos[mae] = filhos[mae] || []).push(a.animal_id);
    });
    var desmama = f.parametros.idade_desmama_padrao_meses;
    Object.keys(proj).forEach(function (id) {
      var c = proj[id].campos;
      if (c.sexo !== 'F' || c.situacao_cadastral === 'EXTERNO') { if (c.situacao_cadastral !== 'EXTERNO') c.cria_ao_pe = null; return; }
      c.cria_ao_pe = (filhos[id] || []).some(function (fid) { return criaAoPe_(f, fid, proj[fid], desmama); });
    });
    return proj;
  }
  /**
   * A cria ao pé da mãe numa data D (a regra da projeção, só com os fatos até D): alguma das crias `filhos` presente no
   * rebanho em D, sem desmama até D, nascida na fazenda ou que entrou com a idade abaixo da desmama de referência. Serve a
   * `reproducao.matrizes` em qualquer data (em D = hoje, o mesmo que a projeção `cria_ao_pe`).
   */
  function criaAoPeEm(f, filhos, data) {
    var desmama = f.parametros.idade_desmama_padrao_meses;
    return (filhos || []).some(function (fid) { return criaAoPe_(f, fid, null, desmama, data); });
  }
  function criaAoPe_(f, id, projetada, desmama, data) {
    var c = projetada ? projetada.campos : f.animal(id);
    if (!c) return false;
    if (vazio_(data) ? c.situacao_cadastral !== 'ATIVO' : c.situacao_cadastral === 'EXTERNO' || !situacaoEm(f.linhas(id), data, f.marcoZero).presente) return false;
    var vig = f.linhas(id);
    if (vig.some(function (l) { return l.event_type === 'DESMAMA' && l.papel === 'SUJEITO' && (vazio_(data) || l.event_date <= data); })) return false;
    var ev = f.evento(c.evento_origem_id);
    if (!ev) return false;
    if (ev.event_type === 'NASCIMENTO') return true;
    if (vazio_(c.data_nascimento) || desmama === null || desmama === undefined) return false;
    return Utils.idadeMeses(c.data_nascimento, ev.event_date) < desmama;
  }
  function iguais_(a, b) {
    return JSON.stringify(vazio_(a) ? null : a) === JSON.stringify(vazio_(b) ? null : b);
  }
  function emitir_(tx, f, tabela, id, campos) {
    var atual = tabela === 'ANIMAIS' ? f.animal(id) : tx.cru ? tx.cru.cruPorId(tabela, id) : null;
    var muda = !atual || Object.keys(campos).some(function (k) { return !iguais_(atual[k], campos[k]); });
    if (!muda) return;
    var c = {};
    Object.keys(campos).forEach(function (k) { c[k] = campos[k]; });
    if (Schema.temColuna(tabela, 'updated_at') && tx.agora) c.updated_at = tx.agora;
    tx.plano.atualizar(tabela, id, c);
  }
  /** Projeções de FINANCEIRO (03b, seção 10.4): status, cancelamento, status de pagamento e animal da alocação direta. */
  function projetarLancamento_(tx, r) {
    if (!tx.cru) return null;
    var a = tx.cru.avaliar(r.event_id);
    if (!a || (a.status !== 'CONFIRMADO' && a.status !== 'ESTORNADO' && a.status !== 'CANCELADO')) return null;
    var ativo = a.status === 'CONFIRMADO';
    var anulador = a.anulador_id ? tx.cru.cruPorId('EVENTOS', a.anulador_id) : null;
    var sp = FinancialService.situacaoPagamento(tx.cru.cruPor('PARCELAS', 'financial_id', r.financial_id), ativo);
    var animal = null;
    if (ativo) {
      var rat = tx.repo.por('RATEIOS', 'financial_id', r.financial_id)[0];
      var alocs = rat ? tx.repo.por('ALOCACOES_FINANCEIRAS', 'rateio_id', rat.rateio_id) : [];
      if (rat && rat.criterio === 'DIRETO' && alocs.length === 1) animal = alocs[0].animal_id;
    }
    return {
      status: ativo ? 'ATIVO' : 'CANCELADO',
      cancelado_em: ativo ? null : anulador ? anulador.created_at : null,
      cancelado_por_event_id: ativo ? null : a.anulador_id,
      status_pagamento: sp.status_pagamento, data_pagamento: sp.data_pagamento, animal_id: animal,
    };
  }
  /**
   * Projeção `PRODUTOS.estoque_atual*` (03a, seções 4.6 e 4.7): Σ dos movimentos vigentes do produto com o estoque
   * controlado (ENTRADA +, SAIDA −, AJUSTE com o sinal), vazio sem controle (HealthService.estoqueAtual: a mesma regra da
   * verificação). Só com as abas de insumos lidas (a porta as declara).
   */
  function projetarProdutos_(tx, f, e) {
    if (!tx.repo.carregada('PRODUTOS') || !tx.repo.carregada('MOVIMENTOS_ESTOQUE')) return;
    var ids = e.tudo ? (tx.cru ? tx.cru.cru('PRODUTOS') : tx.repo.vigentes('PRODUTOS')).map(function (p) { return p.product_id; }) : e.produtos || [];
    Utils.unicos(ids).forEach(function (id) {
      var p = tx.cru ? tx.cru.cruPorId('PRODUTOS', id) : tx.repo.porId('PRODUTOS', id);
      if (!p) return;
      emitir_(tx, f, 'PRODUTOS', id, { estoque_atual: HealthService.estoqueAtual(p, tx.repo.por('MOVIMENTOS_ESTOQUE', 'product_id', id)) });
    });
  }
  /**
   * Porta de projeções (CONTRATOS, seção 10.4): escopo {animais, eventos, produtos} ou {tudo: true}. Projeta ANIMAIS (com
   * as mães alcançadas), IDENTIFICACOES.data_fim dos animais, FINANCEIRO dos eventos e o saldo dos produtos. Só põe no
   * plano o que difere.
   */
  function reconstruir(tx, escopo) {
    var e = escopo || {};
    var f = fonte(tx);
    var proj = projetar(f, e.tudo ? null : e.animais || []);
    Object.keys(proj).forEach(function (id) {
      emitir_(tx, f, 'ANIMAIS', id, proj[id].campos);
      var por = linhasDeIdentificacao_(f, id);
      Object.keys(por).forEach(function (t) {
        por[t].forEach(function (r, i) {
          var fim = r.remocao ? r.data_inicio : i + 1 < por[t].length ? por[t][i + 1].data_inicio : null;
          emitir_(tx, f, 'IDENTIFICACOES', r.ident_id, { data_fim: fim });
        });
      });
    });
    projetarProdutos_(tx, f, e);
    if (!tx.cru || !tx.repo.carregada('FINANCEIRO')) return;
    var lancs = e.tudo ? tx.cru.cru('FINANCEIRO') : [];
    if (!e.tudo) (e.eventos || []).forEach(function (id) { lancs = lancs.concat(tx.cru.cruPor('FINANCEIRO', 'event_id', id)); });
    lancs.forEach(function (r) {
      var c = projetarLancamento_(tx, r);
      if (c) emitir_(tx, f, 'FINANCEIRO', r.financial_id, c);
    });
  }
  /** Abas do saldo de insumos (`PRODUTOS.estoque_atual*`), lidas pela porta além das da linha do tempo. */
  var LEITURAS_INSUMOS = ['PRODUTOS', 'MOVIMENTOS_ESTOQUE'];
  function porta() {
    return { reads: LEITURAS.concat(LEITURAS_INSUMOS), reconstruir: reconstruir };
  }
  /**
   * Projeção gravada × reconstrução pelos eventos vigentes, sobre tudo (integridade e testes). Precisa de tx.cru.
   * Devolve [{tabela, id, campo, gravado, calculado}] (vazio = coincidem). `updated_at` não entra.
   */
  function conferir(tx) {
    var plano = Repository.plano();
    reconstruir({ repo: tx.repo, cru: tx.cru, plano: plano, agora: null, ctx: tx.ctx }, { tudo: true });
    var out = [];
    plano.atualizacoes().forEach(function (u) {
      var reg = tx.cru.cruPorId(u.tabela, u.id) || {};
      Object.keys(u.campos).forEach(function (c) {
        if (!iguais_(reg[c], u.campos[c])) out.push({ tabela: u.tabela, id: u.id, campo: c, gravado: nulo_(reg[c]), calculado: nulo_(u.campos[c]) });
      });
    });
    return out;
  }

  // ------------------------------------------------------------------ inventário em data ----
  function porAnimal_(linhas) {
    var g = Object.create(null);
    (linhas || []).forEach(function (l) { (g[l.animal_id] = g[l.animal_id] || []).push(l); });
    return g;
  }
  /** Estado do animal ao fim do dia D pelas linhas dadas: {presente, pasture_id}. */
  function estadoEm_(linhas, data) {
    var soma = 0;
    var pasto = null;
    ordenar(linhas.filter(function (l) { return !l.pre_marco_zero && l.event_date <= data; })).forEach(function (l) {
      soma += l.efeito || 0;
      if (!vazio_(l.pasto_destino_id)) pasto = l.pasto_destino_id;
      if (l.efeito === -1) pasto = null;
    });
    return { presente: soma >= 1, pasture_id: soma >= 1 ? pasto : null };
  }
  /** Situações possíveis de um animal na data D, depois de ter entrado no rebanho (a ordem dos contadores). */
  var SITUACOES_NA_DATA = ['ATIVO', 'VENDIDO', 'MORTO', 'DESCARTADO', 'BAIXADO_AJUSTE'];
  function refLinha_(l) {
    return l ? { event_id: l.event_id, event_type: l.event_type, event_subtype: l.event_subtype, event_date: l.event_date } : null;
  }
  /**
   * Estadas do animal pelos movimentos vigentes a partir do marco zero (a mesma regra do bloco D da ficha e dos dias
   * de permanência; 07, seção 3.3): [{pasture_id, inicio, fim, entrada, saida}], convenção [início, fim) — o dia da
   * entrada conta, o da saída não; `fim` null = em andamento. Abre na entrada (+1) e em todo movimento para outro
   * pasto; fecha no movimento seguinte e na saída (−1). Movimento para o mesmo pasto não abre estada nova; fatos e
   * correções sem pasto não mexem nas estadas. `entrada`/`saida`: {event_id, event_type, event_subtype, event_date}.
   */
  function estadas(linhasDoAnimal) {
    var out = [];
    var atual = null;
    function fechar(l) {
      if (!atual) return;
      atual.fim = l.event_date;
      atual.saida = refLinha_(l);
      atual = null;
    }
    ordenar((linhasDoAnimal || []).filter(function (l) { return !l.pre_marco_zero; })).forEach(function (l) {
      if (l.efeito === -1) { fechar(l); return; }
      var destino = nulo_(l.pasto_destino_id);
      if (l.efeito !== 1 && destino === null) return;
      if (atual && l.efeito !== 1 && atual.pasture_id === destino) return;
      fechar(l);
      atual = { pasture_id: destino, inicio: l.event_date, fim: null, entrada: refLinha_(l), saida: null };
      out.push(atual);
    });
    return out;
  }
  /**
   * Situação do animal ao fim do dia D, pela linha do tempo (04, seção 5): {presente, pasture_id, situacao,
   * no_rebanho_desde, no_pasto_desde, entrada, saida, motivo}. `situacao`: ATIVO (no rebanho); VENDIDO, MORTO,
   * DESCARTADO ou BAIXADO_AJUSTE (pela última saída até D); AINDA_NAO_ENTROU (nenhuma linha até D). `no_rebanho_desde`
   * = data da entrada vigente; `no_pasto_desde` = início da estada no pasto em que está; `entrada`/`saida` = a última
   * entrada e a última saída até D. Sem marco zero → DADOS_INSUFICIENTES; D antes dele → ANTERIOR_AO_MARCO_ZERO
   * (tudo null): antes do marco zero não há inventário.
   */
  function situacaoEm(linhasDoAnimal, data, marcoZero) {
    var vazioPor = function (motivo) {
      return { presente: null, pasture_id: null, situacao: null, no_rebanho_desde: null, no_pasto_desde: null, entrada: null, saida: null, motivo: motivo };
    };
    if (vazio_(marcoZero)) return vazioPor('DADOS_INSUFICIENTES');
    if (data < marcoZero) return vazioPor('ANTERIOR_AO_MARCO_ZERO');
    var ate = ordenar((linhasDoAnimal || []).filter(function (l) { return !l.pre_marco_zero && l.event_date <= data; }));
    var e = estadoEm_(ate, data);
    var entrada = null;
    var saida = null;
    ate.forEach(function (l) {
      if (l.efeito === 1) entrada = l;
      if (l.efeito === -1) saida = l;
    });
    var est = estadas(ate);
    var ultima = est.length ? est[est.length - 1] : null;
    var situacao = e.presente ? 'ATIVO' : saida ? SAIDA_SITUACAO[saida.event_type] || 'BAIXADO_AJUSTE' : 'AINDA_NAO_ENTROU';
    return {
      presente: e.presente, pasture_id: e.pasture_id, situacao: situacao,
      no_rebanho_desde: e.presente && entrada ? entrada.event_date : null,
      no_pasto_desde: e.presente && ultima && ultima.fim === null ? ultima.inicio : null,
      entrada: refLinha_(entrada), saida: e.presente ? null : refLinha_(saida), motivo: null,
    };
  }
  /**
   * Animais no rebanho ao fim do dia D: {motivo, itens: [{animal_id, pasture_id, no_rebanho_desde, no_pasto_desde,
   * entrada}]} (ordem de animal_id; `entrada` = a entrada vigente, {event_id, event_type, event_subtype, event_date}).
   * Sem marco zero / D antes dele: itens null com o motivo.
   */
  function presentesEm(linhas, data, marcoZero) {
    if (vazio_(marcoZero)) return { motivo: 'DADOS_INSUFICIENTES', itens: null };
    if (data < marcoZero) return { motivo: 'ANTERIOR_AO_MARCO_ZERO', itens: null };
    var g = porAnimal_(linhas);
    var itens = [];
    Object.keys(g).sort().forEach(function (id) {
      var s = situacaoEm(g[id], data, marcoZero);
      if (s.presente) itens.push({ animal_id: id, pasture_id: s.pasture_id, no_rebanho_desde: s.no_rebanho_desde, no_pasto_desde: s.no_pasto_desde, entrada: s.entrada });
    });
    return { motivo: null, itens: itens };
  }
  /**
   * Inventário ao fim do dia D (≥ marco zero; 04, seção 5.2 (v)): total = Σ efeito_inventario das linhas vigentes até
   * D; por pasto = destino do último movimento até D; por situação = a de cada animal que já tinha entrado até D
   * (ATIVO, VENDIDO, MORTO, DESCARTADO, BAIXADO_AJUSTE: `porSituacao.ATIVO` = total quando a linha do tempo é válida).
   * A composição por sexo e por categoria em D precisa das categorias e fica no InventoryService (`posicao`), sobre
   * os presentes desta mesma regra (`presentesEm`). D anterior ao marco zero (ou sem marco zero) → valores nulos com
   * motivo. Devolve {data, total, porPasto: {pasture_id: n}, semPasto, porSituacao: {situação: n}, motivo}.
   */
  function inventario(linhas, data, marcoZero) {
    var nulos = function (motivo) {
      return { data: data, total: null, porPasto: null, semPasto: null, porSituacao: null, motivo: motivo };
    };
    if (vazio_(marcoZero)) return nulos('DADOS_INSUFICIENTES');
    if (data < marcoZero) return nulos('ANTERIOR_AO_MARCO_ZERO');
    var total = 0;
    (linhas || []).forEach(function (l) { if (!l.pre_marco_zero && l.event_date <= data) total += l.efeito || 0; });
    var porPasto = {};
    var semPasto = 0;
    var porSituacao = {};
    SITUACOES_NA_DATA.forEach(function (s) { porSituacao[s] = 0; });
    var g = porAnimal_(linhas);
    Object.keys(g).forEach(function (id) {
      var s = situacaoEm(g[id], data, marcoZero);
      if (s.situacao in porSituacao) porSituacao[s.situacao]++;
      if (!s.presente) return;
      if (vazio_(s.pasture_id)) semPasto++;
      else porPasto[s.pasture_id] = (porPasto[s.pasture_id] || 0) + 1;
    });
    return { data: data, total: total, porPasto: porPasto, semPasto: semPasto, porSituacao: porSituacao, motivo: null };
  }

  // ------------------------------------------------------------------ dias de permanência ----
  var ESCOPOS_PERMANENCIA = ['REBANHO', 'PASTO', 'LISTA', 'CATEGORIA'];
  /** Chave de `por_pasto` de um item para os dias sem pasto informado (nunca colide com um pasture_id, que é UUID). */
  var SEM_PASTO = 'SEM_PASTO';
  function erroPeriodo_(codigo, campo, mensagem) {
    return Validation.erro('VALIDATION', mensagem, [Validation.detalhe({ codigo: codigo, campo: campo, mensagem: mensagem })]);
  }
  /** Dias de [inicio, fim) (fim null = sem fim) dentro de [de, ate] inclusivos: máx(0, mín(fim, ate + 1) − máx(inicio, de)). */
  function diasDentro_(inicio, fim, de, ate) {
    var a = inicio > de ? inicio : de;
    var depois = Utils.somaDias(ate, 1);
    var b = fim === null || fim > depois ? depois : fim;
    return a < b ? Utils.diffDias(a, b) : 0;
  }
  /**
   * Dias de permanência num período (05, seção 4.6; 07, seção 3.3) — a base do rateio DIAS_PERMANENCIA. Por animal,
   * as estadas no escopo pelos movimentos vigentes, na convenção [entrada no escopo, saída do escopo): o dia da
   * entrada conta, o da saída não (nenhum dia cai em dois pastos; Σ dias nos pastos = dias no rebanho);
   * dias = Σ máx(0, mín(saída, fim + 1 dia) − máx(entrada, início)); base total = Σ dias. Animal já baixado recebe os
   * dias em que esteve presente. Antes do marco zero não há linha do tempo: o período começa nele.
   * - linhas: linhas da linha do tempo (Timeline.linha) de quaisquer animais (as do marco zero em diante contam).
   * - periodo: {inicio, fim} (yyyy-MM-dd, inclusivos, início ≤ fim).
   * - escopo: {tipo: REBANHO | PASTO (ref = pasture_id) | LISTA (ref = [animal_id]) | CATEGORIA (ref = category_id)}.
   * - opcoes: {marcoZero, categoriaEm(animal_id, data) → category_id | null} (CATEGORIA: a categoria muda com a idade,
   *   a castração, o parto; conta dia a dia).
   * Devolve {inicio, fim, inicio_efetivo, parcial, escopo: {tipo, ref}, motivo, base_total, n, por_pasto:
   * [{pasture_id, dias, animais}], itens: [{animal_id, dias, por_pasto: {pasture_id | SEM_PASTO: dias}, intervalos: [{inicio, fim,
   * dias, pasture_id}]}]} — só animais com dias > 0, em ordem de animal_id; intervalos recortados ao período, com os
   * dois limites inclusivos. Sem marco zero (DADOS_INSUFICIENTES) ou período todo antes dele (ANTERIOR_AO_MARCO_ZERO):
   * base_total, n e itens null. Erros: VALIDATION (datas, período invertido, escopo), INTERNAL (CATEGORIA sem categoriaEm).
   */
  function diasPermanencia(linhas, periodo, escopo, opcoes) {
    var o = opcoes || {};
    var p = periodo || {};
    var e = escopo || {};
    if (!Utils.dataValida(p.inicio)) throw erroPeriodo_('FORMATO_INVALIDO', 'periodo_inicio', 'Informe o início do período (aaaa-mm-dd).');
    if (!Utils.dataValida(p.fim)) throw erroPeriodo_('FORMATO_INVALIDO', 'periodo_fim', 'Informe o fim do período (aaaa-mm-dd).');
    if (p.inicio > p.fim) throw erroPeriodo_('FAIXA_INVALIDA', 'periodo_fim', 'O fim do período (' + dataBr(p.fim) + ') é anterior ao início (' + dataBr(p.inicio) + ').');
    if (ESCOPOS_PERMANENCIA.indexOf(e.tipo) < 0) throw erroPeriodo_('VALOR_FORA_DA_LISTA', 'escopo', 'Escolha o escopo dos dias de permanência: rebanho, pasto, lista de animais ou categoria.');
    if (e.tipo !== 'REBANHO' && (vazio_(e.ref) || (e.tipo === 'LISTA' && !Array.isArray(e.ref)))) {
      throw erroPeriodo_('CAMPO_OBRIGATORIO', 'escopo', e.tipo === 'PASTO' ? 'Escolha o pasto.' : e.tipo === 'LISTA' ? 'Escolha os animais.' : 'Escolha a categoria.');
    }
    if (e.tipo === 'CATEGORIA' && typeof o.categoriaEm !== 'function') throw Validation.erro('INTERNAL', 'Dias de permanência por categoria precisam da função que dá a categoria do animal no dia.');
    var out = {
      inicio: p.inicio, fim: p.fim, inicio_efetivo: p.inicio, parcial: false, escopo: { tipo: e.tipo, ref: e.tipo === 'REBANHO' ? null : e.ref },
      motivo: null, base_total: null, n: null, por_pasto: null, itens: null,
    };
    if (vazio_(o.marcoZero)) { out.motivo = 'DADOS_INSUFICIENTES'; return out; }
    if (p.fim < o.marcoZero) { out.motivo = 'ANTERIOR_AO_MARCO_ZERO'; return out; }
    if (p.inicio < o.marcoZero) { out.inicio_efetivo = o.marcoZero; out.parcial = true; }
    var de = out.inicio_efetivo;
    var lista = e.tipo === 'LISTA' ? conjunto_(e.ref) : null;
    var g = porAnimal_(linhas);
    var itens = [];
    var porPasto = {};
    Object.keys(g).sort().forEach(function (id) {
      if (lista && !lista[id]) return;
      var intervalos = [];
      estadas(g[id]).forEach(function (s) {
        if (e.tipo === 'PASTO' && s.pasture_id !== e.ref) return;
        var dias = diasDentro_(s.inicio, s.fim, de, p.fim);
        if (!dias) return;
        var ini = s.inicio > de ? s.inicio : de;
        var fimIncl = Utils.somaDias(ini, dias - 1);
        if (e.tipo !== 'CATEGORIA') { intervalos.push({ inicio: ini, fim: fimIncl, dias: dias, pasture_id: s.pasture_id }); return; }
        // Por categoria: os dias da estada em que o animal era da categoria, em trechos contínuos.
        var trecho = null;
        for (var k = 0; k < dias; k++) {
          var dia = Utils.somaDias(ini, k);
          if (o.categoriaEm(id, dia) === e.ref) {
            if (trecho && Utils.somaDias(trecho.fim, 1) === dia) { trecho.fim = dia; trecho.dias++; }
            else { trecho = { inicio: dia, fim: dia, dias: 1, pasture_id: s.pasture_id }; intervalos.push(trecho); }
          } else trecho = null;
        }
      });
      var total = intervalos.reduce(function (t, x) { return t + x.dias; }, 0);
      if (!total) return;
      var pp = {};
      intervalos.forEach(function (x) {
        var k = x.pasture_id === null ? SEM_PASTO : x.pasture_id;
        pp[k] = (pp[k] || 0) + x.dias;
      });
      Object.keys(pp).forEach(function (k) {
        var t = porPasto[k] = porPasto[k] || { pasture_id: k === SEM_PASTO ? null : k, dias: 0, animais: 0 };
        t.dias += pp[k];
        t.animais++;
      });
      itens.push({ animal_id: id, dias: total, por_pasto: pp, intervalos: intervalos });
    });
    out.itens = itens;
    out.n = itens.length;
    out.base_total = itens.reduce(function (t, x) { return t + x.dias; }, 0);
    out.por_pasto = Object.keys(porPasto).sort().map(function (k) { return porPasto[k]; });
    return out;
  }
  /**
   * Onde o animal estava no dia D antes das saídas desse dia (entradas e movimentos de D já aplicados): é a origem
   * de uma saída lançada em D e o pasto padrão das crias de um parto em D. {presente, pasture_id, motivo}.
   */
  function pastoAntesDaSaida(linhasDoAnimal, data, marcoZero) {
    if (vazio_(marcoZero)) return { presente: null, pasture_id: null, motivo: 'DADOS_INSUFICIENTES' };
    if (data < marcoZero) return { presente: null, pasture_id: null, motivo: 'ANTERIOR_AO_MARCO_ZERO' };
    var antes = (linhasDoAnimal || []).filter(function (l) { return l.event_date < data || (l.event_date === data && classe(l) < 2); });
    var e = estadoEm_(antes, data);
    return { presente: e.presente, pasture_id: e.pasture_id, motivo: null };
  }
  /** Pasto do animal ao fim do dia D: {presente, pasture_id, motivo}. */
  function pastoEm(linhasDoAnimal, data, marcoZero) {
    if (vazio_(marcoZero)) return { presente: null, pasture_id: null, motivo: 'DADOS_INSUFICIENTES' };
    if (data < marcoZero) return { presente: null, pasture_id: null, motivo: 'ANTERIOR_AO_MARCO_ZERO' };
    var e = estadoEm_(linhasDoAnimal || [], data);
    return { presente: e.presente, pasture_id: e.pasture_id, motivo: null };
  }
  /** Consulta pronta para UnitOfWork.read: {rota, reads, tratador}. dados: {data, animal_id?}. */
  function consultaInventario(dados) {
    var d = dados || {};
    return {
      rota: 'inventario.posicao', dados: d, reads: LEITURAS.slice(), acessoCru: true,
      tratador: function (tx) {
        if (!Utils.dataValida(d.data)) throw Validation.erro('VALIDATION', 'Informe uma data válida para a posição do rebanho.');
        var f = fonte(tx);
        if (!vazio_(d.animal_id)) return pastoEm(f.linhas(d.animal_id), d.data, f.marcoZero);
        return inventario(f.todasAsLinhas(), d.data, f.marcoZero);
      },
    };
  }

  return {
    LEITURAS: LEITURAS,
    NOME_IDENTIFICACAO: NOME_IDENTIFICACAO,
    dataBr: dataBr,
    parametros: parametros,
    classe: classe,
    papelNaLinha: papelNaLinha,
    ordenar: ordenar,
    linha: linha,
    validar: validar,
    problemasNovos: problemasNovos,
    validarIdentificacoes: validarIdentificacoes,
    validarMarcacoes: validarMarcacoes,
    linhaIdentificacao: linhaIdentificacao,
    identificacoes: identificacoes,
    descrever: descrever,
    fonte: fonte,
    projetarAnimal: projetarAnimal,
    reproducaoEm: reproducaoEm,
    criaAoPeEm: criaAoPeEm,
    brincoEm: brincoEm,
    periodosDeBrinco: periodosDeBrinco,
    brincosLancadosErrado: brincosLancadosErrado,
    fonteAte: fonteAte,
    retratoEm: retratoEm,
    chegadaDeclarada: chegadaDeclarada,
    entradaDoCusto: entradaDoCusto,
    ultimaPesagem: ultimaPesagem,
    projetar: projetar,
    reconstruir: reconstruir,
    porta: porta,
    conferir: conferir,
    SITUACOES_NA_DATA: SITUACOES_NA_DATA,
    SEM_PASTO: SEM_PASTO,
    inventario: inventario,
    estadas: estadas,
    situacaoEm: situacaoEm,
    presentesEm: presentesEm,
    diasPermanencia: diasPermanencia,
    pastoEm: pastoEm,
    pastoAntesDaSaida: pastoAntesDaSaida,
    consultaInventario: consultaInventario,
  };
})();
