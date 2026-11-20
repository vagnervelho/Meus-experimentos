/**
 * Identificacao — o resolvedor único do animal numa data (conserto da Fase 3 pela garantia, etapa 2; CONTRATOS, seção 47).
 *
 * Duas perguntas, uma resposta só para todos os caminhos (o curral, o tronco, o seletor e a busca das telas, a importação e
 * a conferência do animal):
 *  1. (texto digitado, data D) → o animal único ou a recusa explicada (`indice` + `resolver`). A regra, em ordem:
 *     (a) o número de brinco EM USO em D, pelos períodos da regra única do brinco numa data (Timeline.periodosDeBrinco: o
 *         número corrigido por IDENTIFICACAO_INCORRETA vale desde o início do errado; o reaproveitado é de quem o tinha em
 *         D), comparado sem os zeros à esquerda quando `brinco_ignora_zeros_esquerda` = S (o exato desempata);
 *     (b) sem dono do número em D, o código interno: escrito inteiro (A-000004) identifica o animal; os atalhos (000004,
 *         A000004, A-4) só valem para o animal SEM brinco em D — o do animal com brinco é recusado com o brinco dele;
 *     (c) o número usado só DEPOIS de D: no histórico de antes do marco zero (o número que o animal já tinha no marco
 *         zero), o animal que o recebeu primeiro; depois do marco zero, recusa (ninguém o tinha em D);
 *     (d) o número que já tinha saído de uso em D: recusa, com de quem saiu e quando (e de quem é hoje);
 *     (e) o número lançado por engano e corrigido (nunca esteve na orelha: desenho-base 16.2): recusa, com o número certo;
 *     (f) o nome de um animal de referência (EXTERNO), exato: o touro de fora citado pelo nome;
 *     (g) nada disso: não encontrado.
 *  2. (animal, data D) → o brinco, o pasto, a categoria, a situação, a presença e o último peso válidos em D (`descrever`,
 *     `estadoEm`): a mesma descrição da posição numa data (`inventario.elegiveis`) e da conferência do curral e do tronco.
 *
 * O cliente nunca resolve brinco: pergunta ao servidor (rota `animal.resolver`); sem sinal, a linha fica pendente para o
 * servidor resolver. Puro: lê pela fonte da linha do tempo (Timeline.fonte) e pelo leitor do AnimalService.
 */
var Identificacao = (function () {
  /** Os atalhos do código interno: A-4, A000004 e 000004 (zero à esquerda e ao menos seis algarismos). */
  var RE_ATALHO = /^(?:A-(\d{1,5})|A?(0\d{5,}))$/;
  var RE_CANONICO = /^A-\d{6,}$/;
  var MAX_TEXTOS = 500;
  var MOVIMENTO_OU_SAIDA = ['TRANSFERENCIA', 'VENDA', 'MORTE', 'DESCARTE'];

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function br_(d) {
    return Timeline.dataBr(d);
  }
  function unicosPorAnimal_(lista) {
    var v = {};
    return lista.filter(function (p) { if (v[p.animal.animal_id]) return false; v[p.animal.animal_id] = true; return true; });
  }

  // ------------------------------------------------------------------ índice ----
  /**
   * Índice do resolvedor sobre uma fonte da linha do tempo: os períodos de cada número de brinco (pela regra única), os
   * números lançados por engano, os códigos internos e os nomes dos animais de referência. `animais`: os registros de
   * ANIMAIS a considerar; opcoes: {semZeros (brinco_ignora_zeros_esquerda), marcoZero, pendentes (o ensaio da importação
   * conta os animais criados pelas linhas anteriores do arquivo)}. ANULADO nunca entra; PENDENTE só com `pendentes`.
   */
  function indice(f, animais, opcoes) {
    var o = opcoes || {};
    var idx = { semZeros: o.semZeros !== false, marcoZero: vazio_(o.marcoZero) ? null : o.marcoZero, periodos: {}, errados: {}, codigos: {}, porNumero: {}, externos: {}, porId: {} };
    (animais || []).forEach(function (a) {
      if (!a || a.situacao_cadastral === 'ANULADO' || (a.situacao_cadastral === 'PENDENTE' && !o.pendentes)) return;
      var id = a.animal_id;
      idx.porId[id] = a;
      if (!vazio_(a.codigo_interno)) {
        var cod = String(a.codigo_interno).toUpperCase();
        idx.codigos[cod] = a;
        var n = /(\d+)$/.exec(cod);
        if (n) (idx.porNumero[Number(n[1])] = idx.porNumero[Number(n[1])] || []).push(a);
      }
      if (a.situacao_cadastral === 'EXTERNO' && !vazio_(a.nome)) {
        var nome = Utils.normalizarTexto(a.nome);
        (idx.externos[nome] = idx.externos[nome] || []).push(a);
      }
      var ps = f ? Timeline.periodosDeBrinco(f, id) : [];
      // Sem nenhuma identificação de brinco gravada, o brinco do cadastro vale em qualquer data (a regra de Timeline.brincoEm).
      if (!ps.length && !vazio_(a.brinco) && (!f || !temIdentificacaoDeBrinco_(f, id))) ps = [{ codigo: a.brinco, inicio: null, fim: null }];
      ps.forEach(function (p) {
        var k = chave_(idx, p.codigo);
        (idx.periodos[k] = idx.periodos[k] || []).push({ animal: a, codigo: String(p.codigo), exata: Utils.normalizarBrinco(String(p.codigo), true), inicio: p.inicio, fim: p.fim });
      });
      (f ? Timeline.brincosLancadosErrado(f, id) : []).forEach(function (x) {
        var k = chave_(idx, x.codigo);
        (idx.errados[k] = idx.errados[k] || []).push({ animal: a, codigo: String(x.codigo), corrigido_para: x.corrigido_para, inicio: x.inicio });
      });
    });
    return idx;
  }
  function temIdentificacaoDeBrinco_(f, id) {
    return f.identificacoes(id).some(function (r) { return r.tipo === 'BRINCO'; });
  }
  function chave_(idx, codigo) {
    return Utils.normalizarBrinco(String(codigo), !idx.semZeros);
  }
  /** O índice da base lida por uma consulta (o leitor do AnimalService). */
  function indiceDoLeitor(L) {
    if (L.memo && L.memo.identificacao) return L.memo.identificacao;
    var idx = indice(L.f, L.animais, { semZeros: L.params.brinco_ignora_zeros_esquerda !== false, marcoZero: L.marcoZero });
    if (L.memo) L.memo.identificacao = idx;
    return idx;
  }

  // ------------------------------------------------------------------ texto → animal ----
  function emUso_(p, data) {
    return (p.inicio === null || p.inicio <= data) && (p.fim === null || data < p.fim);
  }
  /** O dono do número que o animal tinha HOJE (para dizer "hoje ele é de…"): o período aberto. */
  function donoAberto_(ps) {
    var abertos = unicosPorAnimal_(ps.filter(function (p) { return p.fim === null; }));
    return abertos.length === 1 ? abertos[0].animal : null;
  }
  /**
   * O código interno no texto: {animal} (o código inteiro; o atalho do animal sem brinco em D), {recusa} (o atalho do animal
   * com brinco em D) ou null (o texto não é código, ou nenhum animal tem esse código).
   */
  function porCodigo_(idx, f, t, data) {
    if (RE_CANONICO.test(t) && idx.codigos[t]) return { animal: idx.codigos[t] };
    var m = RE_ATALHO.exec(t);
    if (!m) return null;
    var lista = idx.porNumero[Number(m[1] || m[2])] || [];
    if (lista.length !== 1) return null;
    var a = lista[0];
    var b = brincoDe_(f, a, data);
    if (!b) return { animal: a };
    return { recusa: { codigo: 'CODIGO_DE_ANIMAL_COM_BRINCO', animal: a, brinco: b } };
  }
  function brincoDe_(f, a, data) {
    if (a.situacao_cadastral === 'EXTERNO' || !f) return vazio_(a.brinco) ? null : a.brinco;
    return Timeline.brincoEm(f, a.animal_id, data);
  }
  function rotuloEm_(f, a, data) {
    var b = brincoDe_(f, a, data);
    return b ? String(b) : a.codigo_interno;
  }
  function rotuloHoje_(a) {
    return vazio_(a.brinco) ? a.codigo_interno : String(a.brinco);
  }
  /**
   * Texto digitado → {situacao: ACHADO | VARIOS | RECUSADO, codigo, animal (ACHADO), candidatos (VARIOS), como (BRINCO |
   * SEM_ZEROS | CODIGO | HISTORICO | NOME), brinco (o número achado), mensagem (a recusa e a escolha, em português), e os
   * dados da recusa (animal, desde, ate, corrigido_para, brinco, dono_hoje)}. `f`: a fonte do índice (o brinco em D dos
   * animais que a recusa cita). Nunca olha o brinco de hoje para achar o animal de uma data passada.
   */
  function resolver(idx, f, texto, data) {
    var bruto = Utils.aparar(texto);
    if (vazio_(bruto)) return recusa_('VAZIO', 'Digite o brinco.');
    var t = Utils.normalizarBrinco(bruto, true);
    var exata = t;
    var ps = idx.periodos[chave_(idx, bruto)] || [];
    var emD = unicosPorAnimal_(ps.filter(function (p) { return emUso_(p, data); }));
    if (emD.length > 1) {
      var exatos = emD.filter(function (p) { return p.exata === exata; });
      if (exatos.length === 1) emD = exatos;
    }
    if (emD.length === 1) return { situacao: 'ACHADO', codigo: null, animal: emD[0].animal, como: emD[0].exata === exata ? 'BRINCO' : 'SEM_ZEROS', brinco: emD[0].codigo, mensagem: null };
    if (emD.length > 1) return { situacao: 'VARIOS', codigo: 'VARIOS', como: 'BRINCO', candidatos: emD.map(function (p) { return p.animal; }), mensagem: 'Mais de um animal com "' + bruto + '" em ' + br_(data) + ': escolha.' };
    var cod = porCodigo_(idx, f, t, data);
    if (cod && cod.animal) return { situacao: 'ACHADO', codigo: null, animal: cod.animal, como: 'CODIGO', brinco: null, mensagem: null };
    if (cod && cod.recusa) {
      var r0 = recusa_(cod.recusa.codigo, bruto + ' é o código interno de um animal com brinco (' + cod.recusa.brinco + '): digite o brinco dele.');
      r0.animal = cod.recusa.animal; r0.brinco = cod.recusa.brinco;
      return r0;
    }
    var hoje = donoAberto_(ps);
    var deHoje = function () {
      if (!hoje) return '';
      var naquele = rotuloEm_(f, hoje, data);
      return ' (hoje ele é de ' + rotuloHoje_(hoje) + ', que naquele dia tinha ' + (brincoDe_(f, hoje, data) ? 'o ' + naquele : 'só o código ' + hoje.codigo_interno) + ')';
    };
    if (ps.length) {
      // Um período sem início (o brinco do cadastro sem identificação gravada) vale desde sempre: nada fica antes dele.
      var primeiro = ps.some(function (p) { return p.inicio === null; }) ? null : ps.reduce(function (m, p) { return !m || p.inicio < m.inicio ? p : m; }, null);
      if (primeiro && data < primeiro.inicio) {
        // O histórico de antes do marco zero cita o animal pelo número que ele tinha no marco zero (05, seção 4.1).
        if (idx.marcoZero && primeiro.inicio <= idx.marcoZero) {
          var antes = unicosPorAnimal_(ps.filter(function (p) { return p.inicio === primeiro.inicio; }));
          if (antes.length === 1) return { situacao: 'ACHADO', codigo: null, animal: antes[0].animal, como: 'HISTORICO', brinco: antes[0].codigo, mensagem: null };
          return { situacao: 'VARIOS', codigo: 'VARIOS', como: 'HISTORICO', candidatos: antes.map(function (p) { return p.animal; }), mensagem: 'Mais de um animal com "' + bruto + '" no marco zero: escolha.' };
        }
        var r1 = recusa_('ANTES_DO_USO', bruto + ': em ' + br_(data) + ' nenhum animal do rebanho tinha este brinco' + (hoje ? deHoje() : ' (ele só passou a ser usado em ' + br_(primeiro.inicio) + ')') + '.');
        r1.animal = primeiro.animal; r1.desde = primeiro.inicio; r1.dono_hoje = hoje;
        return r1;
      }
      var ultimo = ps.filter(function (p) { return p.fim !== null && p.fim <= data; }).reduce(function (m, p) { return !m || p.fim > m.fim ? p : m; }, null);
      var saiu = ultimo ? ' (saiu do animal ' + ultimo.animal.codigo_interno + ' em ' + br_(ultimo.fim) + ')' : '';
      var r2 = recusa_('SEM_USO', bruto + ': em ' + br_(data) + ' nenhum animal do rebanho tinha este brinco' + (hoje ? deHoje() : saiu) + '.');
      r2.animal = ultimo ? ultimo.animal : null; r2.ate = ultimo ? ultimo.fim : null; r2.dono_hoje = hoje;
      return r2;
    }
    var errados = unicosPorAnimal_(idx.errados[chave_(idx, bruto)] || []);
    if (errados.length) {
      var e = errados[0];
      var r3 = recusa_('LANCADO_ERRADO', bruto + ' foi lançado por engano no animal ' + e.animal.codigo_interno + ' e corrigido para ' + e.corrigido_para + ': esse número nunca esteve na orelha. Digite ' + e.corrigido_para + '.');
      r3.animal = e.animal; r3.corrigido_para = e.corrigido_para;
      return r3;
    }
    var ext = idx.externos[Utils.normalizarTexto(bruto)] || [];
    if (ext.length === 1) return { situacao: 'ACHADO', codigo: null, animal: ext[0], como: 'NOME', brinco: null, mensagem: null };
    if (ext.length > 1) return { situacao: 'VARIOS', codigo: 'VARIOS', como: 'NOME', candidatos: ext, mensagem: 'Há mais de um animal de referência chamado "' + bruto + '": escolha.' };
    return recusa_('NAO_ENCONTRADO', bruto + ': não encontrado.');
  }
  function recusa_(codigo, mensagem) {
    return { situacao: 'RECUSADO', codigo: codigo, mensagem: mensagem };
  }

  // ------------------------------------------------------------------ animal → estado em D ----
  /**
   * O animal descrito em D (a conferência do curral e do tronco, as linhas da posição numa data): o brinco em uso em D e o
   * de hoje, o sexo, o pasto (o dado pela presença), a categoria em D e a última pesagem até D (qualquer método, rotulada).
   * Desenho-base 4.3: o dado de hoje não vale para a data passada.
   */
  function descrever(L, a, data, pastureId) {
    var r = AnimalService.retratoEm(L, a, data);
    var brinco = a.situacao_cadastral === 'EXTERNO' ? a.brinco : r ? r.brinco : Timeline.brincoEm(L.f, a.animal_id, data);
    var cat = r && a.situacao_cadastral !== 'EXTERNO' ? AnimalService.categoriaEm(L, a, data) : null;
    var pv = AnimalService.pesoVigente(L, a, data, null);
    return {
      animal_id: a.animal_id, codigo_interno: a.codigo_interno, brinco: vazio_(brinco) ? null : brinco, brinco_hoje: vazio_(a.brinco) ? null : a.brinco, sexo: a.sexo,
      pasture_id: vazio_(pastureId) ? null : pastureId, categoria: cat ? cat.nome : null,
      ultimo_peso: pv.data_pesagem ? { kg: pv.kg, data: pv.data_pesagem, estimado: pv.metodo === 'ESTIMATIVA_VISUAL' } : null,
    };
  }
  /** Presença em D pela regra do tipo (InventoryService: ao fim do dia nos movimentos e saídas; em algum momento do dia nos demais). */
  function presenca_(L, data, tipo) {
    var fim = MOVIMENTO_OU_SAIDA.indexOf(tipo) >= 0;
    var k = 'id|pres|' + (fim ? 'F' : 'D') + '|' + data;
    if (L.memo && k in L.memo) return L.memo[k];
    var p = fim ? InventoryService.presentes(L, data) : InventoryService.presentesNoDia(L, data);
    var porId = null;
    if (!p.motivo) { porId = {}; p.itens.forEach(function (x) { porId[x.registro.animal_id] = x; }); }
    var out = { motivo: p.motivo || null, porId: porId };
    if (L.memo) L.memo[k] = out;
    return out;
  }
  /**
   * O estado do animal em D para a conferência: `descrever` + a situação em D (null antes de ele entrar) e a de hoje, a
   * presença em D (null sem posição: antes do marco zero ou sem ele, com o motivo) e, quando ele não serve ao lançamento,
   * `inelegivel` (o porquê, em português). opcoes: {tipo (a regra da presença), sexo (o do lançamento: o diagnóstico é de fêmea)}.
   */
  function estadoEm(L, a, data, opcoes) {
    var o = opcoes || {};
    var pres = a.situacao_cadastral === 'EXTERNO' ? { motivo: null, porId: {} } : presenca_(L, data, o.tipo);
    var item = pres.porId ? pres.porId[a.animal_id] : null;
    var d = descrever(L, a, data, item ? item.pasture_id : null);
    var r = a.situacao_cadastral === 'EXTERNO' ? a : AnimalService.retratoEm(L, a, data);
    d.situacao = r ? r.situacao_cadastral : null;
    d.situacao_hoje = a.situacao_cadastral;
    d.presente = pres.motivo ? null : !!item;
    d.motivo_posicao = pres.motivo;
    d.inelegivel = null;
    if (a.situacao_cadastral === 'EXTERNO') d.inelegivel = 'é animal de referência (de fora do rebanho)';
    else if (d.presente === false) d.inelegivel = data === L.hoje ? 'não está no rebanho' : 'não estava no rebanho em ' + br_(data);
    else if (!vazio_(o.sexo) && a.sexo !== o.sexo) d.inelegivel = o.sexo === 'F' ? 'não é fêmea' : 'não é macho';
    return d;
  }
  /** As crias da fêmea sem brinco em D e já nascidas (ou chegadas) em D: o "crias da <brinco da mãe>" do seletor. */
  function criasSemBrinco_(L, a, data) {
    if (a.sexo !== 'F') return [];
    return (L.filhosMae[a.animal_id] || []).filter(function (c) {
      if (c.situacao_cadastral === 'ANULADO' || c.situacao_cadastral === 'PENDENTE') return false;
      var r = AnimalService.retratoEm(L, c, data);
      return !!r && vazio_(r.brinco);
    }).map(function (c) { return c.animal_id; });
  }

  // ------------------------------------------------------------------ rota ----
  /**
   * animal.resolver (consulta): {data?, tipo?, subtipo?, sexo?, textos?: [texto], ids?: [animal_id]} → {data, motivo,
   * textos: [{texto, situacao, codigo, animal_id, candidatos, como, brinco, crias, mensagem}], animais: {id: estado}}.
   * Os textos passam pelo resolvedor único na data; cada animal citado (o achado, os candidatos, o da recusa, as crias) e os
   * `ids` pedidos voltam descritos em D (`estadoEm`).
   */
  function consultaResolver(dados) {
    var d = dados || {};
    return {
      rota: 'animal.resolver', dados: d, reads: AnimalService.leituras(), acessoCru: true,
      tratador: function (tx) {
        var L = AnimalService.leitor(tx);
        var data = vazio_(d.data) ? L.hoje : d.data;
        if (!Utils.dataValida(data)) throw Validation.erro('VALIDATION', 'Informe uma data válida (aaaa-mm-dd).', [Validation.detalhe({ codigo: 'FORMATO_INVALIDO', campo: 'data', mensagem: 'Data inválida.' })]);
        if (data > L.hoje) throw Validation.erro('VALIDATION', 'A data ' + br_(data) + ' ainda não chegou: o animal é achado pelo brinco de hoje ou de um dia passado.', [Validation.detalhe({ codigo: 'DATA_FUTURA', campo: 'data', mensagem: 'Data futura.' })]);
        var textos = Array.isArray(d.textos) ? d.textos : [];
        var ids = Array.isArray(d.ids) ? d.ids : [];
        if (textos.length + ids.length > MAX_TEXTOS) throw Validation.erro('VALIDATION', 'Mande no máximo ' + MAX_TEXTOS + ' brincos por vez.', [Validation.detalhe({ codigo: 'LIMITE_EXCEDIDO', campo: 'textos', mensagem: 'Brincos demais.' })]);
        var tipo = vazio_(d.tipo) ? null : String(d.tipo);
        var sexo = d.sexo === 'F' || d.sexo === 'M' ? d.sexo : null;
        if (!sexo && tipo && EventCatalog.existe(tipo)) { var fe = EventCatalog.tipo(tipo).filtro_elegiveis; if (fe && fe.sexo) sexo = fe.sexo; }
        var idx = indiceDoLeitor(L);
        var animais = {};
        var citar = function (a) { if (a && !animais[a.animal_id]) animais[a.animal_id] = estadoEm(L, a, data, { tipo: tipo, sexo: sexo }); return a ? a.animal_id : null; };
        var saida = textos.map(function (t) {
          var texto = vazio_(t) ? '' : String(t).slice(0, 60);
          var r = resolver(idx, L.f, texto, data);
          var x = { texto: texto, situacao: r.situacao, codigo: r.codigo, animal_id: null, candidatos: null, como: r.como || null, brinco: r.brinco || null, crias: null, mensagem: r.mensagem };
          if (r.situacao === 'ACHADO') {
            x.animal_id = citar(r.animal);
            var crias = criasSemBrinco_(L, r.animal, data);
            if (crias.length) { x.crias = crias; crias.forEach(function (id) { citar(L.repo.porId('ANIMAIS', id)); }); }
          } else if (r.situacao === 'VARIOS') x.candidatos = r.candidatos.map(citar);
          else if (r.animal) x.animal_id = citar(r.animal);
          return x;
        });
        ids.forEach(function (id) { var a = vazio_(id) ? null : idx.porId[id]; if (a) citar(a); });
        var pres = presenca_(L, data, tipo);
        return { data: data, tipo: tipo, motivo: pres.motivo, textos: saida, animais: animais };
      },
    };
  }
  function resolverRota(ctx, dados) { return UnitOfWork.read(ctx, consultaResolver(dados)); }

  return {
    indice: indice,
    indiceDoLeitor: indiceDoLeitor,
    resolver: resolver,
    descrever: descrever,
    estadoEm: estadoEm,
    consultaResolver: consultaResolver,
    resolverRota: resolverRota,
  };
})();
