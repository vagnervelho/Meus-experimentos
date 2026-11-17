/**
 * Correcao — o ponto único da correção de um evento (CONTRATOS, seção 50; 03b, seção 4: o substituto ocupa o lugar do
 * original; desenho-base 16.1). Puro: lê o evento vigente pelas linhas gravadas e decide, para todo tratador do motor, o que
 * a correção mantém do original.
 *
 * - `entrada(L, ev)`: a entrada SEM MUDANÇA do evento vigente — os dados que, mandados a evento.corrigir como estão, gravam
 *   os mesmos fatos (a prévia da correção na tela e o oráculo do teste aleatório). O que o servidor propôs quando o campo veio
 *   vazio fica vazio, para acompanhar a correção das entradas de que depende (§20, regra 8; 03b, seção 10.2); o que foi
 *   digitado vem como foi gravado. Nada aqui lê o cadastro de hoje.
 * - `montar(entrada, mudanca)`: o evento corrigido a partir do vigente e da mudança (só os campos que mudam).
 * - `contexto(repo, original)` e `congelado(c, chave, novo)`: o valor que a correção mantém do original. Cada valor que o
 *   registro copiou do cadastro (cópia congelada) ou calculou do estado daquele dia (derivado) está em CONGELADOS, com as
 *   entradas de que depende: enquanto nenhuma delas muda, a correção grava o valor do original — nunca o do cadastro de
 *   hoje; quando uma muda, o tratador refaz o valor (com o cadastro do original, quando a entidade é a mesma). As regras de
 *   cadastro que só o cadastro de hoje quebraria (o item desativado depois, a faixa de um parâmetro mudado) também passam
 *   por aqui. A tabela é o contrato que o oráculo confere (tests/apoio-fuzz.js, oraculoCorrecao).
 */
var Correcao = (function () {
  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function nulo_(v) {
    return vazio_(v) ? null : v;
  }
  function br_(d) {
    return Timeline.dataBr(d);
  }
  function limpo_(o) {
    Object.keys(o).forEach(function (k) { if (vazio_(o[k]) || (Array.isArray(o[k]) && !o[k].length)) delete o[k]; });
    return o;
  }
  function agrupar_(lista) {
    var m = {};
    (lista || []).forEach(function (x) { (m[x.animal_id] = m[x.animal_id] || []).push(x); });
    return m;
  }
  function parcelasOrdem_(lista) {
    return lista.slice().sort(function (a, b) { return (a.parcela_num || 0) - (b.parcela_num || 0); });
  }
  /** O valor que o servidor propôs (igual à proposta) não é do usuário: vazio na entrada. */
  function proposto_(valor, proposta) {
    return valor === proposta ? null : valor;
  }
  function bool_(v) {
    return v === 'S' || v === true ? true : v === 'N' || v === false ? false : null;
  }

  // ------------------------------------------------------------------ as cópias congeladas e os derivados ----
  /**
   * O contrato da correção (CONTRATOS, seção 50, tabela B): cada valor gravado que NÃO é entrada do usuário e que a correção
   * mantém do original enquanto as entradas de que ele depende não mudam. natureza: COPIA (copiado do cadastro no registro),
   * DERIVADO (calculado do estado daquele dia) ou REGRA (a regra de cadastro que o original já cumpria). `mesmo(c, novo)`: as
   * entradas de que o valor depende são as do original; `valor(c, novo)`: o valor do original ({v} ou null).
   */
  var CONGELADOS = {
    // Todo tipo: a propriedade que o lançamento recebeu da configuração quando veio vazia.
    'EVENTO.propriedade': {
      tipo: 'todos', natureza: 'COPIA', de: 'CONFIGURACOES.propriedade_padrao_id (a propriedade vazia na entrada)', depende: 'a propriedade informada', grava: 'EVENTOS.property_id',
      valor: function (c) { return vazio_(c.original.property_id) ? null : { v: c.original.property_id }; },
    },
    // SANIDADE: as cópias do produto do cadastro (03b: nome_produto e periodo_carencia_dias, cópias congeladas; 03a,
    // MOVIMENTOS_ESTOQUE.custo_unitario: congelado no movimento) e do protocolo.
    'SANIDADE.nome_produto': {
      tipo: 'SANIDADE', natureza: 'COPIA', de: 'PRODUTOS.nome', depende: 'produto_id', grava: 'SANIDADE.nome_produto',
      valor: function (c, n) { var r = sanidadeDoProduto_(c, n.produto_id); return r && !vazio_(r.nome_produto) ? { v: r.nome_produto } : null; },
    },
    'SANIDADE.fabricante': {
      tipo: 'SANIDADE', natureza: 'COPIA', de: 'PRODUTOS.fabricante (vazio na entrada)', depende: 'produto_id', grava: 'SANIDADE.fabricante',
      valor: function (c, n) { var r = sanidadeDoProduto_(c, n.produto_id); return r ? { v: nulo_(r.fabricante) } : null; },
    },
    'SANIDADE.periodo_carencia_dias': {
      tipo: 'SANIDADE', natureza: 'COPIA', de: 'PRODUTOS.carencia_padrao_dias (vazio na entrada)', depende: 'produto_id', grava: 'SANIDADE.periodo_carencia_dias',
      valor: function (c, n) { var r = sanidadeDoProduto_(c, n.produto_id); return r ? { v: typeof r.periodo_carencia_dias === 'number' ? r.periodo_carencia_dias : null } : null; },
    },
    'SANIDADE.custo_unitario': {
      tipo: 'SANIDADE', natureza: 'COPIA', de: 'PRODUTOS.custo_unitario', depende: 'produto_id', grava: 'MOVIMENTOS_ESTOQUE.custo_unitario (saída)',
      valor: function (c, n) {
        var mov = linhas_(c, 'MOVIMENTOS_ESTOQUE').filter(function (x) { return x.tipo === 'SAIDA' && x.product_id === n.produto_id; })[0];
        return mov ? { v: typeof mov.custo_unitario === 'number' && mov.custo_unitario > 0 ? mov.custo_unitario : null } : null;
      },
    },
    'SANIDADE.conta_consumo': {
      tipo: 'SANIDADE', natureza: 'COPIA', de: 'PRODUTOS.categoria (a conta do consumo)', depende: 'produto_id', grava: 'FINANCEIRO.conta_id (consumo)',
      valor: function (c, n) { var f = consumoDoProduto_(c, n.produto_id); return f ? { v: f.conta_id } : null; },
    },
    'SANIDADE.rotulo_consumo': {
      tipo: 'SANIDADE', natureza: 'COPIA', de: 'PRODUTOS.categoria (o nome dela na descrição do consumo)', depende: 'produto_id', grava: 'FINANCEIRO.descricao (consumo)',
      valor: function (c, n) {
        var f = consumoDoProduto_(c, n.produto_id);
        var m = f && /^Consumo de (.+): /.exec(f.descricao || '');
        return m ? { v: m[1] } : null;
      },
    },
    'SANIDADE.recorrencia_protocolo': {
      tipo: 'SANIDADE', natureza: 'COPIA', de: 'PROTOCOLOS_SANITARIOS.recorrencia_tipo e intervalo_dias (a próxima proposta)', depende: 'protocol_id', grava: 'payload_json.intervalo_protocolo_dias e recorrencia_protocolo; SANIDADE.data_proxima_aplicacao',
      valor: function (c, n) {
        if (!protocoloDoOriginal_(c, n.protocol_id)) return null;
        if (typeof c.pj.intervalo_protocolo_dias === 'number') return { v: { recorrencia: 'INTERVALO_DIAS', intervalo: c.pj.intervalo_protocolo_dias } };
        // Sem intervalo congelado: o original registrou que o protocolo não propunha a próxima (recorrência de outro tipo).
        return typeof c.pj.recorrencia_protocolo === 'string' ? { v: { recorrencia: c.pj.recorrencia_protocolo, intervalo: null } } : null;
      },
    },
    'SANIDADE.procedimento_protocolo': {
      tipo: 'SANIDADE', natureza: 'REGRA', de: 'PROTOCOLOS_SANITARIOS.tipo_procedimento (PROTOCOLO_DE_OUTRO_PROCEDIMENTO)', depende: 'protocol_id, subtipo', grava: 'SANIDADE.protocol_id',
      valor: function (c, n) { return linhas_(c, 'SANIDADE').some(function (r) { return r.protocol_id === n.protocol_id && r.tipo_procedimento === n.procedimento; }) ? { v: true } : null; },
    },
    'SANIDADE.dose_por_peso': {
      tipo: 'SANIDADE', natureza: 'DERIVADO', de: 'dose por kg × o peso do animal na data (pesagem ou referência da categoria)', depende: 'produto_id ou nome_produto, modo_dose, dose_referencia, event_date, o animal', grava: 'SANIDADE.dose; MOVIMENTOS_ESTOQUE.quantidade; rateio do consumo',
      valor: function (c, n) {
        var o = c.original;
        if (o.event_type !== 'SANIDADE' || o.event_date !== n.data || c.pj.modo_dose !== 'POR_PESO' || c.pj.dose_referencia !== n.dose_referencia) return null;
        var r = linhas_(c, 'SANIDADE').filter(function (x) { return x.animal_id === n.animal_id; })[0];
        if (!r || typeof r.dose !== 'number') return null;
        var mesmo = n.produto_id ? r.produto_id === n.produto_id : vazio_(r.produto_id) && Utils.normalizarTexto(r.nome_produto || '') === Utils.normalizarTexto(n.nome_produto || '');
        return mesmo ? { v: r.dose } : null;
      },
    },
    // ESTOQUE: a entrada do mesmo produto (o payload congela o fator e o movimento; a descrição, o nome do produto).
    'ESTOQUE.fator_conversao': {
      tipo: 'ESTOQUE', natureza: 'COPIA', de: 'PRODUTOS.fator_conversao', depende: 'product_id', grava: 'payload_json.fator_conversao; FINANCEIRO.quantidade',
      valor: function (c, n) { return entradaDoProduto_(c, n.product_id) && typeof c.pj.fator_conversao === 'number' ? { v: c.pj.fator_conversao } : null; },
    },
    'ESTOQUE.com_movimento': {
      tipo: 'ESTOQUE', natureza: 'COPIA', de: 'PRODUTOS.controla_estoque', depende: 'product_id', grava: 'payload_json.com_movimento; MOVIMENTOS_ESTOQUE (entrada)',
      valor: function (c, n) {
        if (!entradaDoProduto_(c, n.product_id)) return null;
        // A entrada gravada antes do campo `com_movimento` é julgada pela existência do movimento.
        return { v: typeof c.pj.com_movimento === 'boolean' ? c.pj.com_movimento : linhas_(c, 'MOVIMENTOS_ESTOQUE').some(function (x) { return x.tipo === 'ENTRADA' && x.product_id === n.product_id; }) };
      },
    },
    'ESTOQUE.nome_produto': {
      tipo: 'ESTOQUE', natureza: 'COPIA', de: 'PRODUTOS.nome (na descrição da compra do insumo)', depende: 'product_id', grava: 'FINANCEIRO.descricao (compra do insumo)',
      valor: function (c, n) {
        var f = entradaDoProduto_(c, n.product_id);
        var m = f && /^Compra de (.+): [^:]+$/.exec(f.descricao || '');
        return m ? { v: m[1] } : null;
      },
    },
    // O brinco que o original dava ao animal (a primeira identificação, a troca, a criação, o brinco lançado errado): as regras
    // do número novo que só o parâmetro de hoje quebraria não o recusam na correção.
    'IDENTIFICACAO.brinco': {
      tipo: 'IDENTIFICACAO', natureza: 'REGRA', de: 'CONFIGURACOES.brinco_somente_numerico e brinco_permite_reuso (as regras do número novo)', depende: 'o animal, o número', grava: 'IDENTIFICACOES (BRINCO)',
      valor: function (c, n) {
        var k = typeof n.chave === 'function' ? n.chave : function (x) { return Utils.normalizarBrinco(x); };
        return !vazio_(n.codigo) && linhas_(c, 'IDENTIFICACOES').some(function (r) { return r.tipo === 'BRINCO' && r.animal_id === n.animal_id && k(r.codigo) === k(n.codigo); }) ? { v: true } : null;
      },
    },
    // REPRODUCAO e DESMAMA: o parâmetro mudado depois não recusa o fato que o original já tinha.
    'REPRODUCAO.idade_gestacional': {
      tipo: 'REPRODUCAO', natureza: 'REGRA', de: 'CONFIGURACOES.dias_gestacao (a faixa da idade da gestação)', depende: 'o animal, idade_gestacional_dias', grava: 'REPRODUCAO.idade_gestacional_dias',
      valor: function (c, n) { return linhas_(c, 'REPRODUCAO').some(function (x) { return x.animal_id === n.animal_id && x.idade_gestacional_dias === n.idade; }) ? { v: true } : null; },
    },
    'DESMAMA.cria': {
      tipo: 'DESMAMA', natureza: 'REGRA', de: 'CONFIGURACOES.idade_desmama_padrao_meses (quem é cria ao pé, DL-06)', depende: 'o animal', grava: 'EVENTO_ANIMAIS (SUJEITO)',
      valor: function (c, n) { return c.original.event_type === 'DESMAMA' && linhas_(c, 'EVENTO_ANIMAIS').some(function (l) { return l.animal_id === n.animal_id && (vazio_(l.papel) || l.papel === 'SUJEITO'); }) ? { v: true } : null; },
    },
    // NASCIMENTO: o pasto e a raça que o parto tirou da mãe quando vieram vazios (o estado da mãe naquele dia).
    'NASCIMENTO.pasto_crias': {
      tipo: 'NASCIMENTO', natureza: 'DERIVADO', de: 'o pasto da mãe no dia do parto (pasto vazio na entrada)', depende: 'a mãe, event_date', grava: 'EVENTO_ANIMAIS.pasto_destino_id (CRIA)',
      valor: function (c, n) {
        if (c.original.event_type !== 'NASCIMENTO' || c.original.event_date !== n.data || maeDoParto_(c) !== n.mae_id) return null;
        var cria = linhas_(c, 'EVENTO_ANIMAIS').filter(function (l) { return l.papel === 'CRIA'; })[0];
        return cria ? { v: nulo_(cria.pasto_destino_id) } : null;
      },
    },
    'NASCIMENTO.raca_cria': {
      tipo: 'NASCIMENTO', natureza: 'DERIVADO', de: 'a raça da mãe (raça vazia na entrada)', depende: 'a mãe, a cria', grava: 'atributos_iniciais_json.raca; ANIMAIS.raca (CRIA)',
      valor: function (c, n) {
        if (c.original.event_type !== 'NASCIMENTO' || maeDoParto_(c) !== n.mae_id) return null;
        var cria = linhas_(c, 'EVENTO_ANIMAIS').filter(function (l) { return l.papel === 'CRIA' && l.animal_id === n.animal_id; })[0];
        return cria ? { v: nulo_((cria.atributos_iniciais_json || {}).raca) } : null;
      },
    },
    // AJUSTE_INVENTARIO: o valor de antes que o ajuste gravou (o cadastro do animal antes dele; na reclassificação, a categoria
    // manual que valia logo antes da posição) e a regra VALOR_IGUAL (o ajuste que o estado de hoje torna sem efeito continua
    // sendo o fato gravado). Com outra data, a posição é outra: refeito pelo estado, como no registro.
    'AJUSTE.valor_anterior': {
      tipo: 'AJUSTE_INVENTARIO', natureza: 'DERIVADO', de: 'o cadastro do animal antes do ajuste (VALOR_IGUAL quando é o valor novo)', depende: 'o animal, o campo, o valor novo, event_date', grava: 'AJUSTES.valor_anterior',
      valor: function (c, n) {
        if (c.original.event_type !== 'AJUSTE_INVENTARIO' || c.original.event_date !== n.data) return null;
        var a = linhas_(c, 'AJUSTES').filter(function (x) { return x.animal_id === n.animal_id && x.campo === n.campo && nulo_(x.valor_novo) === nulo_(n.valor_novo); })[0];
        return a ? { v: nulo_(a.valor_anterior) } : null;
      },
    },
    // VENDA: as bases estimadas do rateio (a última pesagem de cada animal até a data) e o nome do tipo da dedução.
    'VENDA.bases_estimadas': {
      tipo: 'VENDA', natureza: 'DERIVADO', de: 'a última pesagem de cada animal até a data (sem o peso de cada um)', depende: 'os animais, event_date, modalidade, pesos e carcaças informados, peso vivo total', grava: 'RATEIOS e ALOCACOES_FINANCEIRAS; EVENTO_ANIMAIS.valor_individual',
      valor: function (c, n) {
        if (c.original.event_type !== 'VENDA' || c.original.event_date !== n.data) return null;
        var vd = linhas_(c, 'VENDAS')[0];
        if (!vd || vd.modalidade !== n.modalidade || vd.peso_vivo_total_kg !== n.peso_vivo_total_kg) return null;
        var receita = linhas_(c, 'FINANCEIRO').filter(function (f) { return f.conta_id === n.conta_receita; })[0];
        var rat = receita ? c.repo.por('RATEIOS', 'financial_id', receita.financial_id)[0] : null;
        if (!rat || rat.criterio !== 'PESO_VIVO' || !/^Base estimada:/.test(rat.justificativa || '')) return null;
        var bases = {};
        c.repo.por('ALOCACOES_FINANCEIRAS', 'rateio_id', rat.rateio_id).forEach(function (a) { bases[a.animal_id] = a.base_valor; });
        var ids = n.animais;
        if (ids.length !== Object.keys(bases).length || ids.some(function (id) { return typeof bases[id] !== 'number'; })) return null;
        return { v: ids.map(function (id) { return bases[id]; }) };
      },
    },
    'VENDA.rotulo_deducao': {
      tipo: 'VENDA', natureza: 'COPIA', de: 'LISTAS (TIPO_DEDUCAO_VENDA).rotulo (na descrição proposta da dedução)', depende: 'o tipo da dedução', grava: 'FINANCEIRO.descricao (dedução)',
      valor: function (c, n) {
        var sufixo = ' da venda de ' + br_(c.original.event_date);
        var achado = null;
        (c.pj.deducoes || []).forEach(function (x) {
          if (achado || x.tipo !== n.tipo) return;
          var f = linhas_(c, 'FINANCEIRO').filter(function (y) { return y.financial_id === x.financial_id; })[0];
          var d = f ? String(f.descricao || '') : '';
          if (d.length > sufixo.length && d.slice(-sufixo.length) === sufixo) achado = { v: d.slice(0, d.length - sufixo.length) };
        });
        return achado;
      },
    },
  };
  /**
   * O que a correção precisa do evento vigente (o original): as linhas dele por tabela e o payload. null fora da correção.
   * `repo`: o repositório do comando (por, porId, carregada).
   */
  function contexto(repo, original) {
    if (!original) return null;
    return { repo: repo, original: original, pj: original.payload_json || {}, memo: {} };
  }
  function linhas_(c, tabela) {
    if (!(tabela in c.memo)) c.memo[tabela] = c.repo.carregada(tabela) ? c.repo.por(tabela, 'event_id', c.original.event_id) : [];
    return c.memo[tabela];
  }
  function sanidadeDoProduto_(c, productId) {
    if (vazio_(productId)) return null;
    return linhas_(c, 'SANIDADE').filter(function (r) { return r.produto_id === productId; })[0] || null;
  }
  function consumoDoProduto_(c, productId) {
    if (vazio_(productId)) return null;
    return linhas_(c, 'FINANCEIRO').filter(function (f) { return f.product_id === productId; })[0] || null;
  }
  function protocoloDoOriginal_(c, protocolId) {
    return !vazio_(protocolId) && linhas_(c, 'SANIDADE').some(function (r) { return r.protocol_id === protocolId; });
  }
  function entradaDoProduto_(c, productId) {
    var o = c.original;
    if (vazio_(productId) || o.event_type !== 'ESTOQUE' || o.event_subtype !== 'ENTRADA') return null;
    return linhas_(c, 'FINANCEIRO').filter(function (f) { return f.product_id === productId; })[0] || null;
  }
  function maeDoParto_(c) {
    var l = linhas_(c, 'EVENTO_ANIMAIS').filter(function (x) { return x.papel === 'MATRIZ'; })[0];
    return l ? l.animal_id : null;
  }
  /**
   * O valor que a correção mantém do original para `chave` (CONGELADOS), dado o que o novo lançamento tem nas entradas de
   * que ele depende (`novo`): {v} quando as entradas são as do original e ele tem o valor; null fora da correção, com uma
   * entrada mudada ou sem o valor no original (o tratador calcula como no registro).
   */
  function congelado(c, chave, novo) {
    var def = CONGELADOS[chave];
    if (!def) throw Validation.erro('INTERNAL', 'Valor congelado desconhecido na correção: ' + chave + '.');
    if (!c) return null;
    return def.valor(c, novo || {}) || null;
  }
  /** A tabela dos valores congelados (o contrato da seção 50), sem as funções. */
  function tabela() {
    return Object.keys(CONGELADOS).map(function (k) { var d = CONGELADOS[k]; return { chave: k, tipo: d.tipo, natureza: d.natureza, de: d.de, depende: d.depende, grava: d.grava }; });
  }

  // ------------------------------------------------------------------ a entrada sem mudança ----
  var TABELAS_DETALHE = ['IDENTIFICACOES', 'PESAGENS', 'REPRODUCAO', 'BAIXAS', 'AJUSTES', 'SANIDADE', 'MOVIMENTOS_ESTOQUE', 'COMPRAS', 'VENDAS', 'FINANCEIRO', 'RATEIOS'];
  /** As linhas de um evento (L: {por(tabela, coluna, valor), porId(tabela, id)}), como evento.obter as lê. */
  function detalhes_(L, ev) {
    var det = {};
    TABELAS_DETALHE.forEach(function (t) { det[t] = L.por(t, 'event_id', ev.event_id); });
    det.PARCELAS = [];
    det.FINANCEIRO.forEach(function (f) { det.PARCELAS = det.PARCELAS.concat(L.por('PARCELAS', 'financial_id', f.financial_id)); });
    det.ALOCACOES_FINANCEIRAS = [];
    det.RATEIOS.forEach(function (r) { det.ALOCACOES_FINANCEIRAS = det.ALOCACOES_FINANCEIRAS.concat(L.por('ALOCACOES_FINANCEIRAS', 'rateio_id', r.rateio_id)); });
    return det;
  }
  function contaCodigo_(L, f) {
    var c = f ? L.porId('PLANO_CONTAS', f.conta_id) : null;
    return c ? c.codigo : null;
  }
  /** Só os campos do cabeçalho que o tipo e o subtipo têm, com valor. */
  function camposDoTipo_(tipo, sub, origem) {
    var campos = {};
    EventCatalog.camposEvento(tipo, sub).forEach(function (d) { if (!vazio_(origem[d.id])) campos[d.id] = origem[d.id]; });
    return campos;
  }
  /** Morte e descarte: o lançamento opcional (custo ou receita), sem a descrição e o vencimento propostos. */
  function lancamentoDaSaida_(det, origem, tipo, ev) {
    var f = det.FINANCEIRO[0];
    if (!f) return;
    var p = tipo === 'MORTE' ? 'custo_' : 'receita_';
    var ts = parcelasOrdem_(det.PARCELAS.filter(function (x) { return x.financial_id === f.financial_id; }));
    var t = ts[0] || {};
    origem[p + 'valor'] = f.valor;
    if (tipo === 'MORTE') origem.custo_conta_id = f.conta_id;
    origem[p + 'partner_id'] = f.partner_id;
    origem[p + 'vencimento'] = proposto_(t.data_vencimento, ev.event_date);
    origem[p + 'forma_pagamento'] = t.forma_pagamento;
    origem[p + 'parcelas_qtd'] = ts.length > 1 ? ts.length : null;
    origem[p + 'documento'] = f.documento;
    origem[p + 'descricao'] = proposto_(f.descricao, (tipo === 'MORTE' ? 'Custos da morte de ' : 'Receita do descarte de ') + br_(ev.event_date));
  }
  /** A despesa paga no ato de um manejo ou da sanidade: o lançamento sem produto, como foi digitado. */
  function despesa_(det, origem, ev, proposta) {
    var f = det.FINANCEIRO.filter(function (x) { return vazio_(x.product_id); })[0];
    if (!f) return;
    var ts = parcelasOrdem_(det.PARCELAS.filter(function (x) { return x.financial_id === f.financial_id; }));
    var t = ts[0] || {};
    origem.custo_valor = f.valor; origem.custo_conta_id = f.conta_id; origem.custo_partner_id = f.partner_id;
    origem.custo_vencimento = proposto_(t.data_vencimento, ev.event_date); origem.custo_forma_pagamento = t.forma_pagamento;
    origem.custo_parcelas_qtd = ts.length > 1 ? ts.length : null; origem.custo_documento = f.documento;
    origem.custo_descricao = proposta.test(f.descricao || '') ? null : f.descricao;
  }
  function valorPorAnimal_(cab) {
    return cab.criterio_rateio === 'VALOR_INDIVIDUAL' || (cab.criterio_rateio === 'DIRETO' && cab.modalidade === 'CABECA' && (cab.preco_unitario === null || cab.preco_unitario === undefined));
  }
  /** No lote, o critério que aceita o que a linha gravou (com um animal o gravado é DIRETO, que não é opção do lançamento). */
  function criterioDaEntrada_(modalidade, criterio, linhasEv) {
    if (modalidade !== 'LOTE') return null;
    if (criterio !== 'DIRETO') return criterio;
    var l = linhasEv[0] || {};
    return !vazio_(l.peso_carcaca_kg) ? 'PESO_CARCACA' : 'CABECAS';
  }
  function linhasDoNegocio_(ev, linhas, efeito) {
    var hist = ev.pre_marco_zero === true;
    return linhas.filter(function (l) { return Number(l.efeito_inventario) === (hist ? 0 : efeito); });
  }
  function entradaCompra_(L, ev, det, linhas, origem, out) {
    var linhasEv = linhasDoNegocio_(ev, linhas, 1);
    var cp = det.COMPRAS[0] || {};
    var fins = det.FINANCEIRO;
    var principal = fins.filter(function (f) { return contaCodigo_(L, f) === 'COMPRA_ANIMAIS'; })[0] || fins[0] || {};
    var custos = fins.filter(function (f) { return f !== principal; });
    var tipos = FinancialService.tiposDosCustos(custos, cp.frete || 0) || [];
    var parcelasDe = function (id) { return det.PARCELAS.filter(function (x) { return x.financial_id === id; }); };
    var rat = det.RATEIOS.filter(function (r) { return r.financial_id === principal.financial_id; })[0] || {};
    var bases = {};
    det.ALOCACOES_FINANCEIRAS.forEach(function (a) { if (a.rateio_id === rat.rateio_id) bases[a.animal_id] = a.base_valor; });
    var idents = agrupar_(det.IDENTIFICACOES);
    var pesos = agrupar_(det.PESAGENS);
    var pastoLote = linhasEv.length ? nulo_(linhasEv[0].pasto_destino_id) : null;
    var todosPesados = linhasEv.length && linhasEv.every(function (l) { return typeof l.peso === 'number'; });
    origem.partner_id = ev.partner_id || principal.partner_id; origem.finalidade = cp.finalidade; origem.modalidade = cp.modalidade;
    origem.base_peso = cp.modalidade === 'ARROBA' ? cp.base_peso : null;
    if (cp.rendimento_tipo === 'NEGOCIADO' || cp.rendimento_tipo === 'ESTIMADO') { origem.rendimento_carcaca_pct = cp.rendimento_carcaca_pct; origem.rendimento_tipo = cp.rendimento_tipo; }
    origem.preco_unitario = cp.preco_unitario; origem.peso_total_kg = todosPesados ? null : cp.peso_total_kg;
    origem.valor_animais = cp.valor_animais; origem.criterio_rateio = criterioDaEntrada_(cp.modalidade, cp.criterio_rateio, linhasEv);
    origem.justificativa_rateio = cp.criterio_rateio === 'MANUAL' ? rat.justificativa : null;
    origem.pasto_destino_id = pastoLote; origem.gta_numero = cp.gta_numero; origem.nota_fiscal = cp.nota_fiscal; origem.condicoes = cp.observacoes;
    var comValor = valorPorAnimal_(cp);
    out.animais = linhasEv.map(function (l) {
      var at = l.atributos_iniciais_json;
      var ids = idents[l.animal_id] || [];
      var cod = function (t) { var x = ids.filter(function (i) { return i.tipo === t; })[0]; return x ? x.codigo : null; };
      var ps = (pesos[l.animal_id] || [])[0];
      var v = {
        animal_id: l.animal_id, brinco: cod('BRINCO'), brinco_origem: cod('BRINCO_ORIGEM'), pasto_destino_id: l.pasto_destino_id !== pastoLote ? l.pasto_destino_id : null,
        peso: l.peso, metodo_pesagem: ps ? ps.metodo : null, peso_carcaca_kg: l.peso_carcaca_kg, valor_individual: comValor ? l.valor_individual : null,
        base_manual: cp.criterio_rateio === 'MANUAL' && typeof bases[l.animal_id] === 'number' ? bases[l.animal_id] : null, observacoes: l.observacoes,
      };
      if (at) {
        var a = L.porId('ANIMAIS', l.animal_id);
        out.criados.push(l.animal_id);
        Object.assign(v, {
          nome: a ? a.nome : null, sexo: at.sexo, raca: at.raca, data_nascimento: at.data_nascimento, data_nascimento_confianca: at.data_nascimento_confianca,
          castrado: bool_(at.castrado), reprodutor: bool_(at.reprodutor), partos_previos: at.partos_previos, situacao_reprodutiva: at.situacao_reprodutiva, data_prevista_parto: at.data_prevista_parto,
          outras_identificacoes: ids.filter(function (x) { return x.tipo !== 'BRINCO' && x.tipo !== 'BRINCO_ORIGEM'; }).map(function (x) { return { tipo: x.tipo, codigo: x.codigo }; }),
        });
      }
      return limpo_(v);
    });
    // Parcela única = o pagamento inteiro: o valor fica vazio, para acompanhar o valor dos animais corrigido.
    out.parcelas = parcelasOrdem_(parcelasDe(principal.financial_id)).map(function (x, k, todas) { return limpo_({ data_vencimento: x.data_vencimento, valor: todas.length === 1 ? null : x.valor, forma_pagamento: x.forma_pagamento, documento: x.documento }); });
    // Os fretes antes dos outros custos (a ordem em que o registro os grava).
    out.custos = custos.map(function (f, k) { return { f: f, tipo: tipos[k] === 'OUTRO' ? 'OUTRO' : 'FRETE' }; }).sort(function (a, b) { return ((a.tipo === 'OUTRO') - (b.tipo === 'OUTRO')) || (a.f.financial_id < b.f.financial_id ? -1 : 1); }).map(function (x) {
      var ts = parcelasOrdem_(parcelasDe(x.f.financial_id));
      var t = ts[0] || {};
      var proposta = (x.tipo === 'FRETE' ? 'Frete' : 'Outros custos') + ' da compra de ' + br_(ev.event_date);
      return limpo_({ tipo: x.tipo, valor: x.f.valor, partner_id: x.f.partner_id, data_vencimento: proposto_(t.data_vencimento, ev.event_date), parcelas_qtd: ts.length > 1 ? ts.length : null, forma_pagamento: t.forma_pagamento, documento: x.f.documento, descricao: proposto_(x.f.descricao, proposta) });
    });
  }
  function entradaVenda_(L, ev, det, linhas, origem, out) {
    var linhasEv = linhasDoNegocio_(ev, linhas, -1);
    var vd = det.VENDAS[0] || {};
    var fins = det.FINANCEIRO;
    var receita = fins.filter(function (f) { return contaCodigo_(L, f) === 'VENDA_ANIMAIS'; })[0] || fins[0] || {};
    var tipoDe = {};
    ((ev.payload_json || {}).deducoes || []).forEach(function (x) { tipoDe[x.financial_id] = x.tipo; });
    var parcelasDe = function (id) { return det.PARCELAS.filter(function (x) { return x.financial_id === id; }); };
    var rat = det.RATEIOS.filter(function (r) { return r.financial_id === receita.financial_id; })[0] || {};
    var bases = {};
    det.ALOCACOES_FINANCEIRAS.forEach(function (a) { if (a.rateio_id === rat.rateio_id) bases[a.animal_id] = a.base_valor; });
    var pesos = agrupar_(det.PESAGENS);
    var todosPesados = linhasEv.length && linhasEv.every(function (l) { return typeof l.peso === 'number'; });
    var todasCarcacas = linhasEv.length && linhasEv.every(function (l) { return typeof l.peso_carcaca_kg === 'number'; });
    origem.partner_id = ev.partner_id || receita.partner_id; origem.finalidade = vd.finalidade; origem.modalidade = vd.modalidade;
    origem.base_peso = vd.modalidade === 'ARROBA' ? vd.base_peso : null;
    if (vd.rendimento_tipo === 'NEGOCIADO' || vd.rendimento_tipo === 'ESTIMADO') { origem.rendimento_carcaca_pct = vd.rendimento_carcaca_pct; origem.rendimento_tipo = vd.rendimento_tipo; }
    origem.preco_unitario = vd.preco_unitario;
    origem.peso_vivo_total_kg = todosPesados ? null : vd.peso_vivo_total_kg;
    origem.peso_carcaca_total_kg = vd.base_peso === 'CARCACA' && !todasCarcacas ? vd.peso_carcaca_total_kg : null;
    origem.valor_bruto = vd.valor_bruto; origem.desconto_comercial = vd.desconto_comercial ? vd.desconto_comercial : null;
    origem.criterio_rateio = criterioDaEntrada_(vd.modalidade, vd.criterio_rateio, linhasEv);
    origem.justificativa_rateio = vd.criterio_rateio === 'MANUAL' ? rat.justificativa : null;
    origem.gta_numero = vd.gta_numero; origem.nota_fiscal = vd.nota_fiscal; origem.condicoes = vd.observacoes;
    // O pasto de origem fica vazio quando é o da linha do tempo (o servidor o tira dela).
    var comValor = valorPorAnimal_(vd);
    out.animais = linhasEv.map(function (l) {
      var ps = (pesos[l.animal_id] || [])[0];
      return limpo_({ animal_id: l.animal_id, peso: l.peso, metodo_pesagem: ps && ps.metodo !== 'BALANCA' ? ps.metodo : null, peso_carcaca_kg: l.peso_carcaca_kg,
        valor_individual: comValor ? l.valor_individual : null, base_manual: vd.criterio_rateio === 'MANUAL' && typeof bases[l.animal_id] === 'number' ? bases[l.animal_id] : null,
        motivo_saida: l.motivo_saida, observacoes: l.observacoes });
    });
    var recebimentos = parcelasOrdem_(parcelasDe(receita.financial_id));
    out.parcelas = recebimentos.map(function (x, k, todas) { return limpo_({ data_vencimento: x.data_vencimento, valor: todas.length === 1 ? null : x.valor, forma_pagamento: x.forma_pagamento, documento: x.documento }); });
    out.deducoes = fins.filter(function (f) { return f !== receita; }).map(function (f) {
      var t = parcelasDe(f.financial_id)[0] || {};
      var tipo = tipoDe[f.financial_id] || 'OUTRA';
      var retida = f.retida_pelo_comprador === true || f.retida_pelo_comprador === 'S';
      // O que o servidor propôs não é do usuário: a descrição (o nome do tipo da dedução gravado nela, CONGELADOS), o parceiro
      // da retida (o comprador) e o vencimento (o primeiro recebimento na retida; a data da venda na outra).
      var vencPadrao = retida ? (recebimentos[0] || {}).data_vencimento : ev.event_date;
      var sufixo = ' da venda de ' + br_(ev.event_date);
      var d = String(f.descricao || '');
      var proposta = d.length > sufixo.length && d.slice(-sufixo.length) === sufixo;
      return limpo_({ tipo: tipo, valor: f.valor, retida_pelo_comprador: retida, partner_id: retida ? proposto_(f.partner_id, ev.partner_id) : f.partner_id,
        data_vencimento: proposto_(t.data_vencimento, vencPadrao), forma_pagamento: t.forma_pagamento, documento: f.documento, descricao: proposta ? null : f.descricao });
    });
  }
  function entradaMovimento_(L, ev, det, linhas, origem, out, propostas) {
    var tipo = ev.event_type;
    var payload = ev.payload_json || {};
    if (tipo === 'TRANSFERENCIA') {
      var l0 = linhas[0] || {};
      origem.pasto_origem_id = l0.pasto_origem_id; origem.pasto_destino_id = l0.pasto_destino_id; origem.gta_numero = payload.gta_numero;
      out.animais = linhas.map(function (l) { return { animal_id: l.animal_id }; });
    } else if (tipo === 'MORTE' || tipo === 'DESCARTE') {
      var b0 = det.BAIXAS[0] || {};
      origem.causa = b0.causa; origem.diagnostico = b0.diagnostico; origem.destino = b0.destino; origem.motivo = b0.motivo;
      lancamentoDaSaida_(det, origem, tipo, ev);
      out.animais = linhas.map(function (l) { return limpo_({ animal_id: l.animal_id, observacoes: l.observacoes }); });
    } else {
      var rep = det.REPRODUCAO[0] || {};
      var pesos = agrupar_(det.PESAGENS);
      var idents = agrupar_(det.IDENTIFICACOES);
      var crias = linhas.filter(function (l) { return l.papel === 'CRIA'; });
      var at0 = (crias[0] && crias[0].atributos_iniciais_json) || {};
      // O pasto e a raça que o servidor tira da mãe quando o campo vem vazio (`propostas`: os da mãe, como evento.obter os
      // calcula) ficam vazios, para acompanhar a mãe e a data corrigidas; vazios, a correção mantém os do original enquanto a
      // mãe e a data não mudam (CONGELADOS). Os digitados diferentes vêm como foram gravados.
      var pr = propostas || {};
      origem.pasto_destino_id = crias[0] ? proposto_(nulo_(crias[0].pasto_destino_id), nulo_(pr.pasto_destino_id)) : null;
      // A certeza do pai está nas crias vivas; no parto só de natimorto, no evento (payload `pai_confianca`).
      origem.pai_id = rep.touro_id || at0.pai_id; origem.pai_confianca = at0.pai_confianca || payload.pai_confianca; origem.tipo_parto = rep.tipo_parto;
      out.animais = linhas.filter(function (l) { return l.papel === 'MATRIZ'; }).map(function (l) { return { animal_id: l.animal_id }; });
      out.crias = crias.map(function (l) {
        var at = l.atributos_iniciais_json || {};
        var a = L.porId('ANIMAIS', l.animal_id);
        var br = (idents[l.animal_id] || []).filter(function (x) { return x.tipo === 'BRINCO'; })[0];
        var ps = (pesos[l.animal_id] || [])[0];
        out.criados.push(l.animal_id);
        return limpo_({ animal_id: l.animal_id, situacao_nascimento: 'VIVO', sexo: at.sexo, brinco: br ? br.codigo : null, nome: a ? a.nome : null, raca: proposto_(nulo_(at.raca), nulo_(pr.raca)), peso: l.peso, metodo_pesagem: ps ? ps.metodo : null, observacoes: l.observacoes });
      });
      for (var k = 0; k < (rep.qtd_natimortos || 0); k++) out.crias.push({ situacao_nascimento: 'NATIMORTO' });
    }
  }
  /** O valor gravado em AJUSTES (texto canônico) como a entrada o leva, pelo tipo do campo corrigível. */
  function valorDoAjuste_(campo, v) {
    if (vazio_(v)) return '';
    var sub = EventCatalog.tipo('AJUSTE_INVENTARIO').subtipos.CORRECAO_CADASTRO;
    var t = ((sub && sub.campos_corrigiveis) || {})[campo] || {};
    return t.tipo === 'bool' ? (v === 'S' ? 'S' : 'N') : String(v);
  }
  function entradaManejo_(L, ev, det, linhas, origem, out) {
    var sub = ev.event_subtype;
    var payload = ev.payload_json || {};
    var idents = agrupar_(det.IDENTIFICACOES);
    var ajustes = agrupar_(det.AJUSTES);
    if (ev.event_type === 'IDENTIFICACAO') {
      origem.tipo_identificacao = (det.IDENTIFICACOES[0] || {}).tipo;
      out.animais = linhas.map(function (l) { var x = (idents[l.animal_id] || [])[0] || {}; return limpo_({ animal_id: l.animal_id, codigo: sub === 'REMOCAO' ? null : x.codigo, motivo: x.motivo, observacoes: l.observacoes }); });
    } else if (ev.event_type === 'MARCACAO') {
      origem.acao = payload.acao; origem.motivo_descarte = payload.motivo_descarte;
      out.animais = linhas.map(function (l) { return limpo_({ animal_id: l.animal_id, observacoes: l.observacoes }); });
    } else {
      var a0 = det.AJUSTES[0] || {};
      origem.justificativa = a0.justificativa || payload.motivo_ajuste || (sub === 'DIVERGENCIA_CONTAGEM' && !(linhas[0] || {}).observacoes ? (det.BAIXAS[0] || {}).observacoes : null);
      if (sub === 'CORRECAO_CADASTRO') out.animais = det.AJUSTES.map(function (x) { return { animal_id: x.animal_id, campo: x.campo, valor_novo: valorDoAjuste_(x.campo, x.valor_novo) }; });
      else out.animais = linhas.map(function (l) {
        var aj = (ajustes[l.animal_id] || [])[0] || {};
        if (sub === 'IDENTIFICACAO_INCORRETA') return limpo_({ animal_id: l.animal_id, brinco: aj.valor_novo || ((idents[l.animal_id] || [])[0] || {}).codigo });
        if (sub === 'CORRECAO_LOCALIZACAO') return limpo_({ animal_id: l.animal_id, pasto_destino_id: l.pasto_destino_id });
        if (sub === 'RECLASSIFICACAO') return limpo_({ animal_id: l.animal_id, categoria_manual_id: aj.valor_novo });
        return limpo_({ animal_id: l.animal_id, observacoes: l.observacoes });
      });
    }
  }
  function entradaPesagem_(L, ev, det, linhas, origem, out) {
    var payload = ev.payload_json || {};
    var pes = agrupar_(det.PESAGENS);
    var p0 = det.PESAGENS[0] || {};
    var lote = typeof payload.peso_total_lote_kg === 'number';
    origem.tipo_pesagem = p0.tipo;
    origem.metodo_pesagem = lote ? 'BALANCA' : p0.metodo;
    origem.jejum = payload.jejum === true ? true : null;
    if (lote) { origem.peso_total_lote_kg = payload.peso_total_lote_kg; origem.qtd_cabecas_lote = payload.qtd_cabecas_lote; }
    out.animais = linhas.map(function (l) {
      var x = (pes[l.animal_id] || [])[0] || {};
      return limpo_({ animal_id: l.animal_id, peso: lote ? null : x.peso_kg, observacoes: x.observacoes || l.observacoes });
    });
  }
  function entradaSanidade_(L, ev, det, linhas, origem, out) {
    var payload = ev.payload_json || {};
    var regs = det.SANIDADE;
    var r0 = regs[0] || {};
    var porAnimal = agrupar_(regs);
    origem.protocol_id = r0.protocol_id; origem.produto_id = r0.produto_id; origem.nome_produto = r0.produto_id ? null : r0.nome_produto;
    // O fabricante do produto do cadastro é cópia congelada (CONGELADOS): vazio, a correção mantém o do original; o nome livre
    // leva o fabricante digitado.
    origem.fabricante = r0.produto_id ? null : r0.fabricante;
    origem.lote = r0.lote; origem.validade = r0.validade; origem.via_aplicacao = r0.via_aplicacao; origem.motivo = r0.motivo; origem.diagnostico = r0.diagnostico;
    origem.veterinario = r0.veterinario;
    origem.modo_dose = payload.modo_dose; origem.dose_referencia = payload.dose_referencia;
    var doses = regs.map(function (r) { return r.dose; });
    var soma = doses.length && doses.every(function (d) { return typeof d === 'number'; }) ? doses.reduce(function (t, d) { return t + Math.round(d * 10000); }, 0) / 10000 : null;
    if (typeof payload.quantidade_consumida_total === 'number' && (payload.modo_dose === 'TOTAL' || payload.quantidade_consumida_total !== soma)) origem.quantidade_consumida_total = payload.quantidade_consumida_total;
    if (!r0.produto_id) origem.unidade_dose = regs.map(function (r) { return r.unidade_dose; }).filter(Boolean)[0] || null;
    // A carência vem como foi gravada (a do produto do cadastro, digitada ou a padrão daquele dia, e a do nome livre).
    origem.periodo_carencia_dias = r0.periodo_carencia_dias;
    // A próxima proposta pelo intervalo congelado no lançamento fica vazia (a correção da data a refaz por ele).
    var iv = payload.intervalo_protocolo_dias;
    origem.data_proxima_aplicacao = typeof iv === 'number' && Utils.dataValida(ev.event_date) ? proposto_(r0.data_proxima_aplicacao, Utils.somaDias(ev.event_date, iv)) : r0.data_proxima_aplicacao;
    despesa_(det, origem, ev, /: serviço ou produto pago no ato$/);
    out.animais = linhas.map(function (l) {
      var x = (porAnimal[l.animal_id] || [])[0] || {};
      var dose = payload.modo_dose === 'POR_CABECA' && typeof x.dose === 'number' && x.dose !== payload.dose_referencia ? x.dose : null;
      return limpo_({ animal_id: l.animal_id, dose: dose, resultado_exame: x.resultado_exame, observacoes: x.observacoes || l.observacoes });
    });
  }
  function entradaEstoque_(L, ev, det, linhas, origem, out) {
    var payload = ev.payload_json || {};
    var mv = det.MOVIMENTOS_ESTOQUE[0] || {};
    var f = det.FINANCEIRO[0];
    origem.product_id = mv.product_id || (f && f.product_id);
    origem.lote = mv.lote; origem.validade = mv.validade;
    if (ev.event_subtype === 'ENTRADA') {
      origem.qtd_apresentacao = payload.qtd_apresentacao;
      origem.quantidade = typeof payload.qtd_apresentacao === 'number' ? null : f ? f.quantidade : mv.quantidade;
      if (f) {
        var ts = parcelasOrdem_(det.PARCELAS.filter(function (x) { return x.financial_id === f.financial_id; }));
        var t = ts[0] || {};
        origem.valor = f.valor; origem.partner_id = f.partner_id; origem.documento = f.documento;
        origem.vencimento = proposto_(t.data_vencimento, ev.event_date); origem.forma_pagamento = t.forma_pagamento;
        origem.parcelas_qtd = ts.length > 1 ? ts.length : null;
      }
    } else {
      origem.motivo_ajuste = payload.motivo_ajuste;
      origem.saldo_contado = payload.saldo_contado;
      origem.quantidade = payload.motivo_ajuste === 'CONTAGEM' || typeof mv.quantidade !== 'number' ? null : -mv.quantidade;
    }
    out.animais = [];
  }
  function entradaReproducao_(L, ev, det, linhas, origem, out) {
    var sub = ev.event_subtype;
    var payload = ev.payload_json || {};
    var regs = {};
    det.REPRODUCAO.forEach(function (r) { regs[r.animal_id] = r; });
    var proposta = /: despesa$/;
    despesa_(det, origem, ev, proposta);
    if (ev.event_type === 'REPRODUCAO') {
      var r0 = det.REPRODUCAO[0] || {};
      origem.estacao_id = r0.estacao_id; origem.metodo = r0.metodo; origem.semen_identificacao = r0.semen_identificacao; origem.data_fim = r0.data_fim;
      if (sub === 'COBERTURA' || sub === 'INSEMINACAO') origem.touro_id = r0.touro_id;
      out.animais = linhas.filter(function (l) { return !(l.papel === 'TOURO' && sub !== 'EXPOSICAO'); }).map(function (l) {
        var r = regs[l.animal_id] || {};
        return limpo_({ animal_id: l.animal_id, resultado: r.resultado, idade_gestacional_dias: r.idade_gestacional_dias, data_prevista_parto: r.data_prevista_parto, observacoes: l.observacoes });
      });
    } else if (ev.event_type === 'DESMAMA') {
      var sujeitos = linhas.filter(function (l) { return vazio_(l.papel) || l.papel === 'SUJEITO'; });
      var destinos = sujeitos.map(function (l) { return l.pasto_destino_id; }).filter(Boolean);
      origem.pasto_destino_id = destinos.length ? destinos[0] : null;
      origem.metodo_pesagem = (det.PESAGENS[0] || {}).metodo || null;
      out.animais = sujeitos.map(function (l) { return limpo_({ animal_id: l.animal_id, peso: l.peso, observacoes: l.observacoes }); });
    } else {
      if (ev.event_type === 'CASTRACAO') origem.metodo = payload.metodo;
      if (ev.event_type === 'OCORRENCIA') origem.tipo_ocorrencia = payload.tipo_ocorrencia;
      out.animais = linhas.map(function (l) { return limpo_({ animal_id: l.animal_id, observacoes: l.observacoes }); });
    }
  }
  function entradaEntrada_(L, ev, det, linhas, origem, out) {
    var idents = agrupar_(det.IDENTIFICACOES);
    var pesos = agrupar_(det.PESAGENS);
    out.animais = linhas.filter(function (l) { return Number(l.efeito_inventario) === 1; }).map(function (l) {
      var at = l.atributos_iniciais_json;
      var ids = idents[l.animal_id] || [];
      var brinco = ids.filter(function (x) { return x.tipo === 'BRINCO'; })[0];
      if (!at) return limpo_({ animal_id: l.animal_id, brinco: brinco ? brinco.codigo : null, pasto_destino_id: l.pasto_destino_id, observacoes: l.observacoes });
      var a = L.porId('ANIMAIS', l.animal_id);
      out.criados.push(l.animal_id);
      var v = {
        animal_id: l.animal_id, brinco: brinco ? brinco.codigo : null, nome: a ? a.nome : null, sexo: at.sexo, raca: at.raca, data_nascimento: at.data_nascimento,
        data_nascimento_confianca: at.data_nascimento_confianca, mae_id: at.mae_id, mae_confianca: at.mae_confianca, pai_id: at.pai_id, pai_confianca: at.pai_confianca,
        origem: at.origem, castrado: bool_(at.castrado), reprodutor: bool_(at.reprodutor), partos_previos: at.partos_previos, situacao_reprodutiva: at.situacao_reprodutiva,
        data_prevista_parto: at.data_prevista_parto, pasto_destino_id: l.pasto_destino_id, observacoes: l.observacoes,
        outras_identificacoes: ids.filter(function (x) { return x.tipo !== 'BRINCO'; }).map(function (x) { return { tipo: x.tipo, codigo: x.codigo }; }),
      };
      if (ev.event_type === 'ENTRADA_INICIAL') {
        var ps = (pesos[l.animal_id] || [])[0];
        v.data_entrada = at.data_entrada; v.data_entrada_confianca = at.data_entrada_confianca;
        v.peso = l.peso; v.metodo_pesagem = ps ? ps.metodo : null; v.valor_abertura = l.valor_individual;
      }
      return limpo_(v);
    });
  }
  /**
   * A entrada sem mudança do evento `ev` (os dados de evento.corrigir, sem `event_id` e `justificativa`): {tipo, subtipo,
   * campos, animais, e os grupos do tipo (parcelas, custos, deducoes, crias)} e, à parte, `criados` (os animais que o
   * evento criou: na correção eles são reaproveitados com todos os atributos; os demais itens são os animais do lançamento).
   * L: {por(tabela, coluna, valor), porId(tabela, id)} — o leitor das linhas gravadas. `propostas` (só no parto): o pasto e a
   * raça que o servidor proporia pela mãe (EventService, evento.obter).
   */
  function entrada(L, ev, propostas) {
    var tipo = ev.event_type;
    var sub = nulo_(ev.event_subtype);
    var det = detalhes_(L, ev);
    var linhas = L.por('EVENTO_ANIMAIS', 'event_id', ev.event_id);
    var origem = { event_date: ev.event_date, property_id: ev.property_id, description: ev.description, responsible: ev.responsible, notes: ev.notes };
    var out = { tipo: tipo, animais: [], criados: [] };
    if (sub) out.subtipo = sub;
    if (tipo === 'COMPRA') entradaCompra_(L, ev, det, linhas, origem, out);
    else if (tipo === 'VENDA') entradaVenda_(L, ev, det, linhas, origem, out);
    else if (['NASCIMENTO', 'TRANSFERENCIA', 'MORTE', 'DESCARTE'].indexOf(tipo) >= 0) entradaMovimento_(L, ev, det, linhas, origem, out, propostas);
    else if (['IDENTIFICACAO', 'MARCACAO', 'AJUSTE_INVENTARIO'].indexOf(tipo) >= 0) entradaManejo_(L, ev, det, linhas, origem, out);
    else if (tipo === 'PESAGEM') entradaPesagem_(L, ev, det, linhas, origem, out);
    else if (tipo === 'SANIDADE') entradaSanidade_(L, ev, det, linhas, origem, out);
    else if (tipo === 'ESTOQUE') entradaEstoque_(L, ev, det, linhas, origem, out);
    else if (['REPRODUCAO', 'DESMAMA', 'CASTRACAO', 'OCORRENCIA'].indexOf(tipo) >= 0) entradaReproducao_(L, ev, det, linhas, origem, out);
    else entradaEntrada_(L, ev, det, linhas, origem, out);
    out.campos = camposDoTipo_(tipo, sub, origem);
    return out;
  }

  // ------------------------------------------------------------------ o evento corrigido pela mudança ----
  var GRUPOS = ['parcelas', 'custos', 'deducoes', 'crias'];
  /**
   * O evento corrigido a partir da entrada sem mudança do vigente e da mudança: {campos: {campo: valor (null apaga)},
   * animais: [{animal_id, ...campos do animal (null apaga)} | {animal_id, remover: true} | item novo sem animal_id na lista],
   * e os grupos inteiros que mudam (parcelas, custos, deducoes, crias)}. O que a mudança não cita fica como no vigente.
   */
  function montar(base, mudanca) {
    var d = Utils.clonar(base);
    var mu = mudanca || {};
    delete d.criados;
    Object.keys(mu.campos || {}).forEach(function (k) { if (vazio_(mu.campos[k])) delete d.campos[k]; else d.campos[k] = mu.campos[k]; });
    (Array.isArray(mu.animais) ? mu.animais : []).forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      var i = vazio_(x.animal_id) ? -1 : d.animais.map(function (a) { return a.animal_id; }).indexOf(x.animal_id);
      if (x.remover === true) { if (i >= 0) d.animais.splice(i, 1); return; }
      var alvo = i >= 0 ? d.animais[i] : (d.animais[d.animais.length] = {});
      Object.keys(x).forEach(function (k) { if (k === 'remover') return; if (vazio_(x[k])) delete alvo[k]; else alvo[k] = x[k]; });
    });
    GRUPOS.forEach(function (g) { if (Array.isArray(mu[g])) d[g] = Utils.clonar(mu[g]); });
    return d;
  }

  return {
    CONGELADOS: CONGELADOS,
    contexto: contexto,
    congelado: congelado,
    tabela: tabela,
    entrada: entrada,
    montar: montar,
  };
})();
