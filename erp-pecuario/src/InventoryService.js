/**
 * InventoryService — posição do rebanho hoje e na data D (desenho-base 4.3: inventário em D = Σ efeito das linhas
 * vigentes até D, a partir do marco zero), resumo da tela "Visão geral" e alertas da Fase 1 (desenho-base,
 * seção 6; RN-005, RN-098, RN-107).
 *
 * Contrato P9: dado ausente nunca vira zero. Antes do marco zero (ou sem ele) os números voltam `null` com o
 * `motivo` (ANTERIOR_AO_MARCO_ZERO, DADOS_INSUFICIENTES). Puro: lê pelo leitor do AnimalService.
 */
var InventoryService = (function () {
  /** Alertas da Fase 1 (lista fechada do desenho-base, seção 6, no recorte desta fase). */
  var ALERTAS = ['ATIVO_SEM_PASTO', 'SEM_BRINCO', 'SEM_CATEGORIA', 'BACKUP_ATRASADO', 'INTEGRIDADE_COM_ERRO', 'IMPORTACAO_INCOMPLETA'];
  var DIA_MS = 86400000;

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function arred_(v, casas) {
    return v === null ? null : Utils.arredondar(v, casas);
  }
  function indicador_(valor, motivo, n, extra) {
    var o = { valor: valor, motivo: valor === null ? motivo || 'DADOS_INSUFICIENTES' : null, n: n };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  function leituras() {
    return AnimalService.leituras();
  }
  function conferirData_(L, data) {
    var d = vazio_(data) ? L.hoje : data;
    if (!Utils.dataValida(d)) throw Validation.erro('VALIDATION', 'Informe uma data válida (aaaa-mm-dd).', [Validation.detalhe({ codigo: 'FORMATO_INVALIDO', campo: 'data', mensagem: 'Data inválida.' })]);
    if (d > L.hoje) throw Validation.erro('VALIDATION', 'A data ' + Timeline.dataBr(d) + ' ainda não chegou: a posição do rebanho é de hoje ou de um dia passado.', [Validation.detalhe({ codigo: 'DATA_FUTURA', campo: 'data', mensagem: 'Data futura.' })]);
    return d;
  }

  // ------------------------------------------------------------------ presença e composição ----
  /**
   * Animais no rebanho ao fim do dia D, pela linha do tempo (replay das linhas vigentes): {motivo, itens:
   * [{animal, pasture_id}]}. Sem marco zero → DADOS_INSUFICIENTES; D antes dele → ANTERIOR_AO_MARCO_ZERO (itens null).
   */
  function presentes(L, data) {
    if (vazio_(L.marcoZero)) return { motivo: 'DADOS_INSUFICIENTES', itens: null };
    if (data < L.marcoZero) return { motivo: 'ANTERIOR_AO_MARCO_ZERO', itens: null };
    var porAnimal = Utils.agruparPor(L.f.todasAsLinhas(), 'animal_id');
    var itens = [];
    Object.keys(porAnimal).forEach(function (id) {
      var p = Timeline.pastoEm(porAnimal[id], data, L.marcoZero);
      if (!p.presente) return;
      var a = L.repo.porId('ANIMAIS', id);
      if (a) itens.push({ animal: a, pasture_id: p.pasture_id });
    });
    return { motivo: null, itens: Utils.ordenarPor(itens, function (x) { return x.animal.codigo_interno; }) };
  }
  /**
   * Composição de um grupo de animais em D: cabeças, machos, fêmeas, categorias (calculadas em D), peso vivo total e
   * UA com o peso vigente (desenho-base, seção 6). UA = Σ peso vigente ÷ `ua_peso_kg`; a parte estimada vem
   * separada em "sem pesagem" e "pesagem vencida"; cabeça sem peso nenhum fica fora da UA e é contada. Grupo vazio
   * → zeros reais; grupo com cabeças mas nenhuma com peso → null (DADOS_INSUFICIENTES).
   * opcoes: {animais: true} inclui a lista por animal.
   */
  function compor(L, itens, data, opcoes) {
    var o = opcoes || {};
    var r = { cabecas: itens.length, machos: 0, femeas: 0, por_categoria: [], sem_categoria: 0 };
    var cats = {};
    var partes = { pesada: { cabecas: 0, peso_kg: 0 }, pesagem_vencida: { cabecas: 0, peso_kg: 0 }, sem_pesagem: { cabecas: 0, peso_kg: 0 } };
    var semPeso = 0;
    var lista = [];
    itens.forEach(function (x) {
      var a = x.animal;
      if (a.sexo === 'M') r.machos++;
      else if (a.sexo === 'F') r.femeas++;
      var cat = AnimalService.categoriaEm(L, a, data);
      if (cat) {
        var c = cats[cat.category_id] = cats[cat.category_id] || { category_id: cat.category_id, codigo: cat.codigo, nome: cat.nome, cabecas: 0 };
        c.cabecas++;
      } else r.sem_categoria++;
      var pv = AnimalService.pesoVigente(L, a, data, cat);
      if (pv.situacao === 'PESADO') { partes.pesada.cabecas++; partes.pesada.peso_kg += pv.kg; }
      else if (pv.situacao === 'PESAGEM_VENCIDA') { partes.pesagem_vencida.cabecas++; partes.pesagem_vencida.peso_kg += pv.kg; }
      else if (pv.situacao === 'SEM_PESAGEM') { partes.sem_pesagem.cabecas++; partes.sem_pesagem.peso_kg += pv.kg; }
      else semPeso++;
      if (o.animais) {
        lista.push({
          animal_id: a.animal_id, codigo_interno: a.codigo_interno, brinco: a.brinco || null, sexo: a.sexo || null, idade_meses: AnimalService.idadeEm(a, data),
          categoria_id: cat ? cat.category_id : null, pasture_id: x.pasture_id, peso: pv,
        });
      }
    });
    r.por_categoria = Utils.ordenarPor(Object.keys(cats).map(function (k) { return cats[k]; }), function (c) {
      var def = L.categoriaPorId[c.category_id];
      return def && typeof def.prioridade === 'number' ? def.prioridade : 0;
    });
    var comPeso = r.cabecas - semPeso;
    var total = partes.pesada.peso_kg + partes.pesagem_vencida.peso_kg + partes.sem_pesagem.peso_kg;
    var estimadas = partes.pesagem_vencida.cabecas + partes.sem_pesagem.cabecas;
    var uaKg = L.params.ua_peso_kg;
    var valorPeso = r.cabecas === 0 ? 0 : comPeso === 0 ? null : arred_(total, 1);
    r.peso_vivo_total = indicador_(valorPeso, 'DADOS_INSUFICIENTES', comPeso, { estimado: estimadas > 0, unidade: 'kg' });
    var ua = valorPeso === null ? null : typeof uaKg === 'number' && uaKg > 0 ? arred_(total / uaKg, 2) : null;
    Object.keys(partes).forEach(function (k) {
      partes[k].peso_kg = arred_(partes[k].peso_kg, 1);
      partes[k].ua = typeof uaKg === 'number' && uaKg > 0 ? arred_(partes[k].peso_kg / uaKg, 2) : null;
    });
    var rotulo = null;
    if (estimadas > 0) {
      var trechos = [];
      if (partes.sem_pesagem.cabecas) trechos.push(partes.sem_pesagem.cabecas + ' cabeça(s) sem pesagem, pelo peso de referência da categoria');
      if (partes.pesagem_vencida.cabecas) trechos.push(partes.pesagem_vencida.cabecas + ' com pesagem vencida (mais de ' + L.params.peso_validade_dias + ' dias)');
      rotulo = 'UA estimada em parte: ' + trechos.join(' e ') + '.';
    }
    if (semPeso > 0) rotulo = (rotulo ? rotulo + ' ' : '') + semPeso + ' cabeça(s) sem peso ficaram fora da UA.';
    r.ua = indicador_(ua, valorPeso === null ? 'DADOS_INSUFICIENTES' : 'SEM_VALOR_DE_REFERENCIA', comPeso, {
      estimado: estimadas > 0, ua_peso_kg: typeof uaKg === 'number' ? uaKg : null, partes: partes, sem_peso: semPeso, rotulo: rotulo,
    });
    if (o.animais) r.animais = lista;
    return r;
  }

  // ------------------------------------------------------------------ posição e visão geral ----
  function porPasto_(L, itens) {
    var g = {};
    var sem = 0;
    itens.forEach(function (x) {
      if (vazio_(x.pasture_id)) { sem++; return; }
      g[x.pasture_id] = (g[x.pasture_id] || 0) + 1;
    });
    var lista = Object.keys(g).map(function (id) {
      var p = L.f.pasto(id);
      return { pasture_id: id, nome: p ? p.nome : null, cabecas: g[id] };
    });
    return { lista: Utils.ordenarPor(lista, ['nome', 'pasture_id']), sem: sem };
  }
  /**
   * Posição do rebanho ao fim do dia D (padrão hoje): {data, marco_zero, motivo, cabecas, por_sexo: {M, F},
   * por_pasto: [{pasture_id, nome, cabecas}], sem_pasto, por_categoria: [{category_id, codigo, nome, cabecas}],
   * sem_categoria, peso_vivo_total, ua}. Antes do marco zero: tudo null, com o motivo.
   */
  function posicao(L, data) {
    var pr = presentes(L, data);
    var base = { data: data, marco_zero: L.marcoZero || null, motivo: pr.motivo };
    if (pr.motivo) {
      ['cabecas', 'por_sexo', 'por_pasto', 'sem_pasto', 'por_categoria', 'sem_categoria'].forEach(function (k) { base[k] = null; });
      base.peso_vivo_total = indicador_(null, pr.motivo, 0);
      base.ua = indicador_(null, pr.motivo, 0);
      return base;
    }
    var c = compor(L, pr.itens, data);
    var pp = porPasto_(L, pr.itens);
    base.cabecas = c.cabecas;
    base.por_sexo = { M: c.machos, F: c.femeas };
    base.por_pasto = pp.lista;
    base.sem_pasto = pp.sem;
    base.por_categoria = c.por_categoria;
    base.sem_categoria = c.sem_categoria;
    base.peso_vivo_total = c.peso_vivo_total;
    base.ua = c.ua;
    return base;
  }
  /**
   * Consulta `inventario.posicao`. dados: {data?} → `posicao`; {data?, animal_id} → onde o animal estava ao fim do
   * dia ({presente, pasture_id, motivo}, como Timeline.pastoEm). Data futura ou inválida → VALIDATION.
   */
  function consultaPosicao(dados) {
    var d = dados || {};
    return {
      rota: 'inventario.posicao', dados: d, reads: leituras(),
      tratador: function (tx) {
        var L = AnimalService.leitor(tx);
        var data = conferirData_(L, d.data);
        if (!vazio_(d.animal_id)) {
          if (!tx.repo.porId('ANIMAIS', d.animal_id)) throw Validation.erro('NOT_FOUND', 'Animal não encontrado.');
          var p = Timeline.pastoEm(L.f.linhas(d.animal_id), data, L.marcoZero);
          return { data: data, animal_id: d.animal_id, presente: p.presente, pasture_id: p.pasture_id, motivo: p.motivo };
        }
        return posicao(L, data);
      },
    };
  }
  /**
   * Consulta da tela "Visão geral" na Fase 1 (rota `dashboard.obter`): a posição de hoje e as pendências do
   * cadastro. {geradoEm, data, ...posicao, pendencias: {sem_pasto, sem_brinco, sem_categoria}}.
   */
  function consultaVisaoGeral() {
    return {
      rota: 'dashboard.obter', reads: leituras().concat(['FINANCEIRO', 'PARCELAS']),
      tratador: function (tx) {
        var L = AnimalService.leitor(tx);
        var out = posicao(L, L.hoje);
        var pend = pendenciasCadastro_(L);
        out.geradoEm = tx.agora;
        out.pendencias = { sem_pasto: pend.ATIVO_SEM_PASTO.length, sem_brinco: pend.SEM_BRINCO.length, sem_categoria: pend.SEM_CATEGORIA.length };
        out.titulos = FinancialService.titulos(tx.repo, L.hoje);
        return out;
      },
    };
  }

  // ------------------------------------------------------------------ alertas ----
  function pendenciasCadastro_(L) {
    var out = { ATIVO_SEM_PASTO: [], SEM_BRINCO: [], SEM_CATEGORIA: [] };
    L.animais.forEach(function (a) {
      if (a.situacao_cadastral !== 'ATIVO') return;
      if (vazio_(a.pasto_atual_id)) out.ATIVO_SEM_PASTO.push(a.animal_id);
      if (vazio_(a.brinco)) out.SEM_BRINCO.push(a.animal_id);
      if (!AnimalService.categoriaEm(L, a, L.hoje)) out.SEM_CATEGORIA.push(a.animal_id);
    });
    return out;
  }
  function alerta_(codigo, nivel, mensagem, ids, entidade) {
    return { codigo: codigo, nivel: nivel, mensagem: mensagem, n: ids.length, ids: ids, entidade: entidade };
  }
  function naoAvaliado_(codigo, mensagem) {
    return { codigo: codigo, motivo: 'DADOS_INSUFICIENTES', mensagem: mensagem };
  }
  /**
   * Alertas da Fase 1 (`alerta.listar`). `estado` vem de quem chama (Maintenance/Api), fora da planilha:
   * {backup: {ultimo_em: instante ISO | null}, integridade: {verificado_em, erros} | null}. Parte ausente do
   * estado não é presumida: o alerta vai para `nao_avaliados` com o motivo (P9).
   * Devolve {data, geradoEm, alertas: [{codigo, nivel (AVISO | ERRO), mensagem, n, ids, entidade}], nao_avaliados}.
   */
  function alertas(L, estado) {
    var e = estado || {};
    var lista = [];
    var nao = [];
    var pend = pendenciasCadastro_(L);
    if (pend.ATIVO_SEM_PASTO.length) lista.push(alerta_('ATIVO_SEM_PASTO', 'AVISO', pend.ATIVO_SEM_PASTO.length + ' animal(is) no rebanho sem pasto informado.', pend.ATIVO_SEM_PASTO, 'ANIMAIS'));
    if (pend.SEM_BRINCO.length) lista.push(alerta_('SEM_BRINCO', 'AVISO', pend.SEM_BRINCO.length + ' animal(is) no rebanho sem brinco.', pend.SEM_BRINCO, 'ANIMAIS'));
    if (pend.SEM_CATEGORIA.length) lista.push(alerta_('SEM_CATEGORIA', 'AVISO', pend.SEM_CATEGORIA.length + ' animal(is) que nenhuma categoria cobre. Confira as categorias nas configurações.', pend.SEM_CATEGORIA, 'ANIMAIS'));
    var limite = L.params.alerta_backup_atrasado_dias;
    if (e.backup === undefined) nao.push(naoAvaliado_('BACKUP_ATRASADO', 'A situação do backup não foi informada.'));
    else {
      var ultimo = e.backup && !vazio_(e.backup.ultimo_em) ? e.backup.ultimo_em : null;
      if (ultimo !== null && !Utils.instanteValido(ultimo)) throw Validation.erro('INTERNAL', 'Instante de backup inválido: ' + ultimo + '.');
      if (ultimo === null) lista.push(alerta_('BACKUP_ATRASADO', 'ERRO', 'Ainda não há nenhuma cópia de segurança da base. Faça um backup agora.', [], 'SISTEMA'));
      else {
        var dias = Math.floor((Date.parse(L.tx.agora) - Date.parse(ultimo)) / DIA_MS);
        if (typeof limite === 'number' && dias > limite) lista.push(alerta_('BACKUP_ATRASADO', 'ERRO', 'O último backup foi há ' + dias + ' dias (o limite é ' + limite + '). Faça um backup agora.', [], 'SISTEMA'));
      }
    }
    if (e.integridade === undefined) nao.push(naoAvaliado_('INTEGRIDADE_COM_ERRO', 'O resultado da verificação de integridade não foi informado.'));
    else if (e.integridade === null) nao.push(naoAvaliado_('INTEGRIDADE_COM_ERRO', 'A verificação de integridade ainda não foi feita.'));
    else if (typeof e.integridade.erros === 'number' && e.integridade.erros > 0) {
      lista.push(alerta_('INTEGRIDADE_COM_ERRO', 'ERRO', 'A última verificação de integridade' + (vazio_(e.integridade.verificado_em) ? '' : ' (' + Timeline.dataBr(String(e.integridade.verificado_em).slice(0, 10)) + ')') + ' encontrou ' + e.integridade.erros + ' problema(s). Abra o relatório em Configurações › Sistema.', [], 'SISTEMA'));
    }
    var importando = L.repo.vigentes('IMPORTACOES').filter(function (i) { return i.status === 'IMPORTANDO'; });
    if (importando.length) {
      lista.push(alerta_('IMPORTACAO_INCOMPLETA', 'ERRO', 'Importação incompleta' + (importando.length > 1 ? ' (' + importando.length + ')' : '') + ': ' + importando.map(function (i) { return i.arquivo_nome || i.tipo; }).join(', ') + '. Retome ou desfaça antes de lançar outros dados.', importando.map(function (i) { return i.import_id; }), 'IMPORTACOES'));
    }
    return { data: L.hoje, geradoEm: L.tx.agora, alertas: lista, nao_avaliados: nao };
  }
  /** Consulta `alerta.listar`: `estado` como em `alertas`. */
  function consultaAlertas(estado) {
    return {
      rota: 'alerta.listar', reads: Utils.unicos(leituras().concat(['IMPORTACOES'])),
      tratador: function (tx) { return alertas(AnimalService.leitor(tx), estado); },
    };
  }

  /**
   * Consulta `inventario.elegiveis` (08, seção 7): os animais que podem entrar num lançamento do tipo na data D,
   * resolvidos pela linha do tempo (o store do aparelho só sabe a posição de hoje). dados: {tipo, data?, pasture_id?}.
   * Vale para os tipos cujo filtro de elegíveis pede animal no rebanho (ATIVO): elegível = no rebanho ao fim do dia D,
   * no pasto pedido nessa data e com o sexo que o tipo exige (`filtro_elegiveis.sexo`). Devolve {data, tipo,
   * pasture_id, motivo, n, itens: [{animal_id, codigo_interno, brinco, sexo, pasture_id}]}; antes do marco zero (ou
   * sem ele) n e itens voltam null com o motivo. VALIDATION: tipo indisponível ou sem elegíveis por presença, data
   * inválida ou futura; NOT_FOUND: pasto inexistente.
   */
  function consultaElegiveis(dados) {
    var d = dados || {};
    return {
      rota: 'inventario.elegiveis', dados: d, reads: leituras(),
      tratador: function (tx) {
        var tipo = d.tipo;
        var def = !vazio_(tipo) && EventCatalog.existe(tipo) && EventCatalog.ativo(tipo, d.subtipo || null) ? EventCatalog.tipo(tipo) : null;
        var filtro = def ? def.filtro_elegiveis : null;
        if (!def || !filtro || filtro.situacao !== 'ATIVO') {
          throw Validation.erro('VALIDATION', 'Escolha um tipo de lançamento de animais que estão no rebanho (transferência, nascimento, venda, morte, descarte).', [Validation.detalhe({ codigo: 'TIPO_SEM_ELEGIVEIS', campo: 'tipo', mensagem: 'Tipo sem lista de elegíveis por data.' })]);
        }
        var L = AnimalService.leitor(tx);
        var data = conferirData_(L, d.data);
        if (!vazio_(d.pasture_id) && !L.f.pasto(d.pasture_id)) throw Validation.erro('NOT_FOUND', 'Pasto não encontrado. Atualize a tela e tente de novo.');
        var pres = presentes(L, data);
        var base = { data: data, tipo: tipo, pasture_id: vazio_(d.pasture_id) ? null : d.pasture_id, motivo: pres.motivo, n: null, itens: null };
        if (pres.motivo) return base;
        base.itens = pres.itens.filter(function (x) {
          if (!vazio_(d.pasture_id) && x.pasture_id !== d.pasture_id) return false;
          return !filtro.sexo || x.animal.sexo === filtro.sexo;
        }).map(function (x) {
          return { animal_id: x.animal.animal_id, codigo_interno: x.animal.codigo_interno, brinco: vazio_(x.animal.brinco) ? null : x.animal.brinco, sexo: x.animal.sexo, pasture_id: x.pasture_id };
        });
        base.n = base.itens.length;
        return base;
      },
    };
  }

  function posicaoEm(ctx, dados) { return UnitOfWork.read(ctx, consultaPosicao(dados)); }
  function elegiveis(ctx, dados) { return UnitOfWork.read(ctx, consultaElegiveis(dados)); }
  function visaoGeral(ctx) { return UnitOfWork.read(ctx, consultaVisaoGeral()); }
  function listarAlertas(ctx, estado) { return UnitOfWork.read(ctx, consultaAlertas(estado)); }

  return {
    ALERTAS: ALERTAS,
    leituras: leituras,
    presentes: presentes,
    compor: compor,
    posicao: posicao,
    alertas: alertas,
    consultaPosicao: consultaPosicao,
    consultaVisaoGeral: consultaVisaoGeral,
    consultaAlertas: consultaAlertas,
    consultaElegiveis: consultaElegiveis,
    posicaoEm: posicaoEm,
    elegiveis: elegiveis,
    visaoGeral: visaoGeral,
    listarAlertas: listarAlertas,
  };
})();
