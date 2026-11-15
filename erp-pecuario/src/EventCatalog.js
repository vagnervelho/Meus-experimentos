/**
 * EventCatalog — definição declarativa dos eventos (04, seção 7; desenho-base 4.1). Puro: só dados e funções sobre
 * eles. Serve à validação no servidor (EventService) e ao formulário na tela (serializar). Os 21 tipos estão aqui com
 * a fase em que chegam; só os da fase corrente têm campos e passam pelo motor.
 *
 * Vocabulário (fechado). Tipo: rotulo, grupo_ui, ordem, frequente, selecao_animais, filtro_elegiveis, modo_entrada,
 * revisao, critico, reads, fase, campos, campos_animal, componentes, grupos_repetiveis, subtipos. Campo: id, rotulo,
 * tipo, obrigatorio, visivel_se, obrigatorio_se, default, escopo, unidade, min, max, casas, ajuda, opcoes (enum
 * fechado), lista (lista aberta de LISTAS) e naturezas (ref:PLANO_CONTAS: naturezas de conta aceitas). Condição de
 * visivel_se / obrigatorio_se: {campo, valores} ou {campo, preenchido: true}.
 */
var EventCatalog = (function () {
  var FASE_ATUAL = 2;
  var TIPOS_CAMPO = ['texto', 'inteiro', 'decimal', 'dinheiro', 'data', 'lista', 'bool', 'anexo'];
  var PESO_MAX_KG = 2000;

  /** Os 10 itens do menu (§15) e a importação, com a fase em que cada um é entregue (08, seção 2). */
  var MODULOS = [
    { id: 'DASHBOARD', rotulo: 'Visão geral', ordem: 1, fase: 1, menu: true },
    { id: 'REBANHO', rotulo: 'Rebanho', ordem: 2, fase: 1, menu: true },
    { id: 'PASTOS', rotulo: 'Pastos', ordem: 3, fase: 1, menu: true },
    { id: 'EVENTOS', rotulo: 'Eventos', ordem: 4, fase: 1, menu: true },
    { id: 'PESAGENS', rotulo: 'Pesagens', ordem: 5, fase: 3, menu: true },
    { id: 'SANIDADE', rotulo: 'Sanidade', ordem: 6, fase: 3, menu: true },
    { id: 'REPRODUCAO', rotulo: 'Reprodução', ordem: 7, fase: 3, menu: true },
    { id: 'FINANCEIRO', rotulo: 'Financeiro', ordem: 8, fase: 4, menu: true },
    { id: 'RELATORIOS', rotulo: 'Relatórios', ordem: 9, fase: 5, menu: true },
    { id: 'CONFIGURACOES', rotulo: 'Configurações', ordem: 10, fase: 1, menu: true },
    { id: 'IMPORTACAO', rotulo: 'Importação', ordem: 11, fase: 1, menu: false },
  ];

  /** Os 21 tipos (desenho-base 4.1), com fase. `subtipos` só onde há subtipo; cada subtipo tem a sua fase. */
  var RESUMO = {
    ENTRADA_INICIAL: { rotulo: 'Rebanho inicial (marco zero)', grupo_ui: 'Movimentação', ordem: 10, fase: 1 },
    OUTRA_ENTRADA: { rotulo: 'Outra entrada (doação, permuta, achado)', grupo_ui: 'Movimentação', ordem: 20, fase: 1 },
    NASCIMENTO: { rotulo: 'Nascimento', grupo_ui: 'Reprodução', ordem: 30, fase: 2 },
    COMPRA: { rotulo: 'Comprar animais', grupo_ui: 'Movimentação', ordem: 40, fase: 2 },
    VENDA: { rotulo: 'Vender animais', grupo_ui: 'Movimentação', ordem: 50, fase: 2 },
    TRANSFERENCIA: { rotulo: 'Transferir de pasto', grupo_ui: 'Movimentação', ordem: 60, fase: 2 },
    MORTE: { rotulo: 'Morte', grupo_ui: 'Movimentação', ordem: 70, fase: 2 },
    DESCARTE: { rotulo: 'Descarte (consumo, doação, sacrifício)', grupo_ui: 'Movimentação', ordem: 80, fase: 2 },
    PESAGEM: { rotulo: 'Pesagem', grupo_ui: 'Manejo', ordem: 90, fase: 3 },
    SANIDADE: { rotulo: 'Sanidade (vacina, vermífugo, tratamento)', grupo_ui: 'Manejo', ordem: 100, fase: 3 },
    REPRODUCAO: { rotulo: 'Reprodução (monta, inseminação, diagnóstico)', grupo_ui: 'Reprodução', ordem: 110, fase: 3 },
    DESMAMA: { rotulo: 'Desmama', grupo_ui: 'Reprodução', ordem: 120, fase: 3 },
    CASTRACAO: { rotulo: 'Castração', grupo_ui: 'Manejo', ordem: 130, fase: 3 },
    IDENTIFICACAO: { rotulo: 'Identificação (brinco)', grupo_ui: 'Manejo', ordem: 140, fase: 2 },
    MARCACAO: { rotulo: 'Marcar para descarte ou não localizado', grupo_ui: 'Manejo', ordem: 150, fase: 2 },
    AJUSTE_INVENTARIO: { rotulo: 'Corrigir dados do animal', grupo_ui: 'Correções', ordem: 160, fase: 1 },
    OCORRENCIA: { rotulo: 'Ocorrência', grupo_ui: 'Manejo', ordem: 170, fase: 3 },
    LANCAMENTO_FINANCEIRO: { rotulo: 'Lançamento financeiro', grupo_ui: 'Financeiro', ordem: 180, fase: 4 },
    RATEIO: { rotulo: 'Ratear custo entre animais', grupo_ui: 'Financeiro', ordem: 190, fase: 4 },
    ESTOQUE: { rotulo: 'Estoque de insumos', grupo_ui: 'Financeiro', ordem: 200, fase: 3 },
    ESTORNO: { rotulo: 'Estornar evento', grupo_ui: 'Correções', ordem: 210, fase: 1 },
  };

  // ------------------------------------------------------------------ campos ----
  var CONFIANCAS = ['CONFIRMADA', 'ESTIMADA', 'DESCONHECIDA'];
  function quando_(campo, valores) {
    return valores === true ? { campo: campo, preenchido: true } : { campo: campo, valores: valores };
  }
  function c_(id, rotulo, tipo, extra) {
    var o = { id: id, rotulo: rotulo, tipo: tipo, obrigatorio: false, escopo: 'EVENTO' };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  function a_(id, rotulo, tipo, extra) {
    var o = c_(id, rotulo, tipo, extra);
    o.escopo = 'POR_ANIMAL';
    return o;
  }
  /** Campos por animal de uma entrada que cria animal (03b, seção 3.5). `inicial`: os exclusivos da ENTRADA_INICIAL. */
  function camposNovoAnimal_(inicial) {
    var l = [
      a_('brinco', 'Brinco', 'texto', { ajuda: 'Opcional. Zeros à esquerda não diferenciam números (0012 = 12).' }),
      a_('nome', 'Nome ou apelido', 'texto'),
      a_('sexo', 'Sexo', 'lista', { obrigatorio: true, opcoes: ['M', 'F'] }),
      a_('raca', 'Raça', 'lista', { lista: 'RACA' }),
      a_('data_nascimento', 'Nascimento', 'data'),
      a_('idade_meses', 'Idade (meses)', 'inteiro', { min: 0, max: 360, ajuda: 'Use quando não souber a data: o sistema estima o nascimento.' }),
      a_('data_nascimento_confianca', 'Nascimento é', 'lista', { opcoes: CONFIANCAS, obrigatorio_se: quando_('data_nascimento', true) }),
      a_('mae_id', 'Mãe', 'ref:ANIMAIS'),
      a_('mae_ref', 'Mãe (deste lançamento)', 'texto', { ajuda: 'Referência de outro animal deste mesmo lançamento.' }),
      a_('mae_confianca', 'Mãe é', 'lista', { opcoes: ['CONFIRMADA', 'ESTIMADA'] }),
      a_('pai_id', 'Pai', 'ref:ANIMAIS'),
      a_('pai_ref', 'Pai (deste lançamento)', 'texto'),
      a_('pai_confianca', 'Pai é', 'lista', { opcoes: ['CONFIRMADA', 'ESTIMADA'] }),
      a_('ref', 'Referência no lançamento', 'texto', { ajuda: 'Identifica este animal para ser mãe ou pai de outro do mesmo lançamento.' }),
      a_('origem', 'Origem', 'lista', { obrigatorio: true, opcoes: ['NASCIDO', 'COMPRADO', 'DESCONHECIDA'] }),
      a_('castrado', 'Castrado', 'bool', { visivel_se: quando_('sexo', ['M']), obrigatorio_se: quando_('sexo', ['M']) }),
      a_('reprodutor', 'Reprodutor (touro)', 'bool', { visivel_se: quando_('sexo', ['M']), obrigatorio_se: quando_('sexo', ['M']) }),
      a_('partos_previos', 'Partos anteriores', 'inteiro', { min: 0, max: 30, visivel_se: quando_('sexo', ['F']) }),
      a_('situacao_reprodutiva', 'Situação reprodutiva', 'lista', { opcoes: ['VAZIA', 'EXPOSTA', 'INSEMINADA', 'PRENHA'], visivel_se: quando_('sexo', ['F']) }),
      a_('data_prevista_parto', 'Previsão de parto', 'data', { visivel_se: quando_('situacao_reprodutiva', ['PRENHA']) }),
      a_('pasto_destino_id', 'Pasto', 'ref:PASTOS', { obrigatorio: true }),
    ];
    if (inicial) {
      l.push(a_('data_entrada', 'Chegou na fazenda em', 'data', { ajuda: 'Data real ou estimada; pode ser anterior ao marco zero.' }));
      l.push(a_('data_entrada_confianca', 'Chegada é', 'lista', { opcoes: CONFIANCAS, obrigatorio_se: quando_('data_entrada', true) }));
      l.push(a_('peso', 'Peso vivo', 'decimal', { unidade: 'kg', min: 0.1, max: PESO_MAX_KG, casas: 1 }));
      l.push(a_('metodo_pesagem', 'Como foi pesado', 'lista', { opcoes: ['BALANCA', 'FITA', 'ESTIMATIVA_VISUAL'], visivel_se: quando_('peso', true), obrigatorio_se: quando_('peso', true) }));
      l.push(a_('valor_abertura', 'Valor de abertura', 'dinheiro', { min: 0.01, ajuda: 'Opcional. Custo de referência do animal no marco zero (não é caixa).' }));
    }
    l.push(a_('outras_identificacoes', 'Outras identificações', 'texto', { ajuda: 'Lista de {tipo, codigo}: brinco de origem, RFID, SISBOV, tatuagem.' }));
    l.push(a_('observacoes', 'Observações deste animal', 'texto'));
    return l;
  }

  var CAMPOS_CORRIGIVEIS = {
    sexo: { tipo: 'lista', opcoes: ['M', 'F'] },
    data_nascimento: { tipo: 'data' },
    data_nascimento_confianca: { tipo: 'lista', opcoes: CONFIANCAS },
    mae_id: { tipo: 'ref:ANIMAIS' },
    mae_confianca: { tipo: 'lista', opcoes: ['CONFIRMADA', 'ESTIMADA'] },
    pai_id: { tipo: 'ref:ANIMAIS' },
    pai_confianca: { tipo: 'lista', opcoes: ['CONFIRMADA', 'ESTIMADA'] },
    castrado: { tipo: 'bool' },
    reprodutor: { tipo: 'bool' },
    partos_previos: { tipo: 'inteiro', min: 0, max: 30 },
    origem: { tipo: 'lista', opcoes: ['NASCIDO', 'COMPRADO', 'DESCONHECIDA'] },
    data_entrada: { tipo: 'data' },
    data_entrada_confianca: { tipo: 'lista', opcoes: CONFIANCAS },
  };

  var LEITURAS_MOTOR = ['EVENTOS', 'EVENTO_ANIMAIS', 'ANIMAIS', 'IDENTIFICACOES', 'AJUSTES', 'PESAGENS', 'REPRODUCAO',
    'BAIXAS', 'PASTOS', 'PROPRIEDADES', 'CONFIGURACOES', 'LISTAS', 'CATEGORIAS'];
  var VIVO = quando_('situacao_nascimento', ['VIVO']);
  /** Campos de uma cria do parto (grupo repetível `crias`; 03b, seções 3.5 e 16.8). Natimorto não cria animal. */
  var CAMPOS_CRIA = [
    a_('situacao_nascimento', 'Nasceu', 'lista', { obrigatorio: true, opcoes: ['VIVO', 'NATIMORTO'], default: 'VIVO' }),
    a_('sexo', 'Sexo', 'lista', { opcoes: ['M', 'F'], visivel_se: VIVO, obrigatorio_se: VIVO }),
    a_('brinco', 'Brinco', 'texto', { visivel_se: VIVO, ajuda: 'Opcional: o brinco pode ser colocado depois.' }),
    a_('nome', 'Nome ou apelido', 'texto', { visivel_se: VIVO }),
    a_('raca', 'Raça', 'lista', { lista: 'RACA', visivel_se: VIVO, ajuda: 'Vazio = a raça da mãe.' }),
    a_('peso', 'Peso ao nascer', 'decimal', { unidade: 'kg', min: 0.1, max: PESO_MAX_KG, casas: 1, visivel_se: VIVO }),
    a_('metodo_pesagem', 'Como foi pesado', 'lista', { opcoes: ['BALANCA', 'FITA', 'ESTIMATIVA_VISUAL'], visivel_se: quando_('peso', true), obrigatorio_se: quando_('peso', true) }),
    a_('observacoes', 'Observações da cria', 'texto', { visivel_se: VIVO }),
  ];
  /**
   * Lançamento opcional de uma saída sem negociação (03b, seção 10.3): na MORTE, custos associados numa conta de
   * custeio escolhida (necropsia, tratamento final, remoção); no DESCARTE, a receita simples (OUTRAS_RECEITAS_
   * OPERACIONAIS). Um título só, com vencimento próprio (vazio = à vista, na data do evento); rateio por cabeça.
   */
  function camposLancamentoSaida_(tipo) {
    var p = tipo === 'MORTE' ? 'custo_' : 'receita_';
    var tem = quando_(p + 'valor', true);
    var l = [c_(p + 'valor', tipo === 'MORTE' ? 'Custos associados (opcional)' : 'Receita do descarte (opcional)', 'dinheiro', { min: 0.01,
      ajuda: tipo === 'MORTE' ? 'Necropsia, remoção, tratamento final: vira custo dos animais desta morte.' : 'Valor recebido na permuta ou na entrega, se houve. Venda é pelo "Vender animais".' })];
    if (tipo === 'MORTE') l.push(c_('custo_conta_id', 'Conta do custo', 'ref:PLANO_CONTAS', { naturezas: ['CUSTEIO'], visivel_se: tem, obrigatorio_se: tem }));
    l.push(c_(p + 'partner_id', tipo === 'MORTE' ? 'Pago a' : 'Recebido de', 'ref:PARCEIROS', { visivel_se: tem }));
    l.push(c_(p + 'vencimento', 'Vencimento', 'data', { visivel_se: tem, ajuda: 'Vazio = à vista, na data do evento.' }));
    l.push(c_(p + 'forma_pagamento', 'Forma de pagamento', 'lista', { lista: 'FORMA_PAGAMENTO', visivel_se: tem }));
    l.push(c_(p + 'documento', 'Recibo ou nota', 'texto', { visivel_se: tem }));
    l.push(c_(p + 'descricao', 'Descrição do lançamento', 'texto', { visivel_se: tem }));
    return l;
  }
  /** Campos de cabeçalho de uma saída sem negociação (MORTE, DESCARTE); BAIXAS guarda uma linha por animal. */
  function camposSaida_(tipo) {
    var l = [c_('event_date', tipo === 'MORTE' ? 'Data da morte' : 'Data do descarte', 'data', { obrigatorio: true, default: 'HOJE' })];
    if (tipo === 'MORTE') {
      l.push(c_('causa', 'Causa da morte', 'lista', { obrigatorio: true, lista: 'CAUSA_MORTE', ajuda: 'Sem causa conhecida, escolha "Causa desconhecida".' }));
      l.push(c_('diagnostico', 'Diagnóstico ou laudo', 'texto'));
    } else {
      l.push(c_('destino', 'O que foi feito do animal', 'lista', { obrigatorio: true, lista: 'DESTINO_DESCARTE', ajuda: 'Consumo próprio, doação, permuta ou sacrifício. Se houve venda, use "Vender animais".' }));
      l.push(c_('motivo', 'Por que foi descartado', 'lista', { obrigatorio: true, lista: 'MOTIVO_DESCARTE' }));
    }
    l = l.concat(camposLancamentoSaida_(tipo));
    l.push(c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }));
    l.push(c_('responsible', tipo === 'MORTE' ? 'Quem constatou' : 'Responsável', 'texto'));
    l.push(c_('notes', 'Observações', 'texto'));
    return l;
  }
  var LEITURAS_FINANCEIRO = ['FINANCEIRO', 'PARCELAS', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'PLANO_CONTAS', 'COMPRAS', 'PARCEIROS'];
  var METODOS_PESAGEM = ['BALANCA', 'FITA', 'ESTIMATIVA_VISUAL'];
  var MOD = function (valores) { return quando_('modalidade', valores); };
  /**
   * COMPRA (04, seção 4.2; 03b, seções 4.1 e 4.3 a 4.5; 16.9): cabeçalho da negociação (modalidade × base de peso,
   * preço, valor dos animais da nota, critério só no lote fechado), pasto de destino do lote, animais novos (ou que
   * voltam ao rebanho) com brinco da casa e de origem, peso e valor individual, as parcelas do valor dos animais e o
   * frete e os outros custos (um lançamento por item, com parceiro e vencimento próprios).
   */
  var CAMPOS_COMPRA = [
    c_('event_date', 'Data da compra', 'data', { obrigatorio: true, default: 'HOJE' }),
    c_('partner_id', 'Fornecedor (quem vendeu)', 'ref:PARCEIROS', { obrigatorio: true }),
    c_('finalidade', 'Para que foram comprados', 'lista', { lista: 'FINALIDADE_NEGOCIO' }),
    c_('modalidade', 'Como foi o preço', 'lista', { obrigatorio: true, opcoes: ['CABECA', 'KG_VIVO', 'ARROBA', 'LOTE'] }),
    c_('base_peso', 'Arroba de', 'lista', { opcoes: ['VIVO', 'CARCACA'], visivel_se: MOD(['ARROBA']), obrigatorio_se: MOD(['ARROBA']), ajuda: 'Vivo: peso de balança com rendimento combinado. Carcaça: romaneio do frigorífico.' }),
    c_('rendimento_carcaca_pct', 'Rendimento de carcaça', 'decimal', { unidade: '%', min: 0.1, max: 99.9, casas: 1, visivel_se: quando_('base_peso', ['VIVO']), obrigatorio_se: quando_('base_peso', ['VIVO']) }),
    c_('rendimento_tipo', 'O rendimento foi', 'lista', { opcoes: ['NEGOCIADO', 'ESTIMADO'], visivel_se: quando_('base_peso', ['VIVO']), obrigatorio_se: quando_('base_peso', ['VIVO']) }),
    c_('preco_unitario', 'Preço', 'dinheiro', { min: 0.01, visivel_se: MOD(['CABECA', 'KG_VIVO', 'ARROBA']), obrigatorio_se: MOD(['KG_VIVO', 'ARROBA']), ajuda: 'Por cabeça, por kg vivo ou por arroba, conforme a forma do preço. Por cabeça, deixe vazio se cada animal teve o seu valor.' }),
    c_('peso_total_kg', 'Peso vivo total do lote', 'decimal', { unidade: 'kg', min: 0.1, casas: 1, ajuda: 'Vazio = a soma dos pesos dos animais.' }),
    c_('valor_animais', 'Valor dos animais (nota)', 'dinheiro', { obrigatorio: true, min: 0.01, ajuda: 'Sem frete nem outros custos. Vale o valor da nota; a conta pelo preço é só conferência.' }),
    c_('criterio_rateio', 'Como dividir o valor entre os animais', 'lista', { opcoes: ['CABECAS', 'PESO_VIVO', 'PESO_CARCACA', 'VALOR_INDIVIDUAL', 'MANUAL'], visivel_se: MOD(['LOTE']), obrigatorio_se: MOD(['LOTE']) }),
    c_('justificativa_rateio', 'Por que essa divisão', 'texto', { visivel_se: quando_('criterio_rateio', ['MANUAL']), obrigatorio_se: quando_('criterio_rateio', ['MANUAL']) }),
    c_('pasto_destino_id', 'Pasto de destino', 'ref:PASTOS', { obrigatorio: true, ajuda: 'Onde o lote fica; cada animal pode ir para outro pasto.' }),
    c_('gta_numero', 'Número da GTA', 'texto'),
    c_('nota_fiscal', 'Número da nota fiscal', 'texto'),
    c_('condicoes', 'Condições da negociação', 'texto', { ajuda: 'Texto livre: entrega na fazenda, prazo combinado.' }),
    c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }),
    c_('responsible', 'Responsável', 'texto'),
    c_('notes', 'Observações', 'texto'),
  ];
  var CAMPOS_ANIMAL_COMPRA = [
    a_('animal_id', 'Animal já cadastrado (volta ao rebanho)', 'ref:ANIMAIS'),
    a_('brinco', 'Brinco da fazenda', 'texto', { ajuda: 'Opcional. Zeros à esquerda não diferenciam números (0012 = 12).' }),
    a_('brinco_origem', 'Brinco do vendedor', 'texto', { ajuda: 'Fica como identificação de origem, sem exigir que seja único.' }),
    a_('nome', 'Nome ou apelido', 'texto'),
    a_('sexo', 'Sexo', 'lista', { obrigatorio: true, opcoes: ['M', 'F'] }),
    a_('raca', 'Raça', 'lista', { lista: 'RACA' }),
    a_('data_nascimento', 'Nascimento', 'data'),
    a_('idade_meses', 'Idade (meses)', 'inteiro', { min: 0, max: 360, ajuda: 'Use quando não souber a data: o sistema estima o nascimento.' }),
    a_('data_nascimento_confianca', 'Nascimento é', 'lista', { opcoes: CONFIANCAS, obrigatorio_se: quando_('data_nascimento', true) }),
    a_('castrado', 'Castrado', 'bool', { visivel_se: quando_('sexo', ['M']), obrigatorio_se: quando_('sexo', ['M']) }),
    a_('reprodutor', 'Reprodutor (touro)', 'bool', { visivel_se: quando_('sexo', ['M']), obrigatorio_se: quando_('sexo', ['M']) }),
    a_('partos_previos', 'Partos anteriores', 'inteiro', { min: 0, max: 30, visivel_se: quando_('sexo', ['F']) }),
    a_('situacao_reprodutiva', 'Situação reprodutiva', 'lista', { opcoes: ['VAZIA', 'EXPOSTA', 'INSEMINADA', 'PRENHA'], visivel_se: quando_('sexo', ['F']) }),
    a_('data_prevista_parto', 'Previsão de parto', 'data', { visivel_se: quando_('situacao_reprodutiva', ['PRENHA']) }),
    a_('pasto_destino_id', 'Pasto (se não for o do lote)', 'ref:PASTOS'),
    a_('peso', 'Peso vivo na chegada', 'decimal', { unidade: 'kg', min: 0.1, max: PESO_MAX_KG, casas: 1 }),
    a_('metodo_pesagem', 'Como foi pesado', 'lista', { opcoes: METODOS_PESAGEM, visivel_se: quando_('peso', true), ajuda: 'Vazio = balança.' }),
    a_('peso_carcaca_kg', 'Peso de carcaça', 'decimal', { unidade: 'kg', min: 0.1, max: PESO_MAX_KG, casas: 1, ajuda: 'Só na arroba de carcaça ou no lote dividido por carcaça. Nunca vira pesagem.' }),
    a_('valor_individual', 'Valor deste animal', 'dinheiro', { min: 0.01, ajuda: 'Só quando cada animal teve o seu preço (por cabeça) ou no lote dividido pelo valor de cada um.' }),
    a_('base_manual', 'Peso na divisão manual', 'decimal', { min: 0.0001, casas: 4, ajuda: 'Só no lote com divisão manual: percentual ou proporção deste animal.' }),
    a_('outras_identificacoes', 'Outras identificações', 'texto', { ajuda: 'Lista de {tipo, codigo}: RFID, SISBOV, tatuagem.' }),
    a_('observacoes', 'Observações deste animal', 'texto'),
  ];
  /** Parcelas do valor dos animais (bloco_parcelas): vencimento e valor; valor vazio = divisão igual do que falta. */
  var CAMPOS_PARCELA = [
    a_('data_vencimento', 'Vencimento', 'data', { obrigatorio: true }),
    a_('valor', 'Valor', 'dinheiro', { min: 0.01, ajuda: 'Vazio = divide em partes iguais o que falta.' }),
    a_('forma_pagamento', 'Forma de pagamento', 'lista', { lista: 'FORMA_PAGAMENTO' }),
    a_('documento', 'Boleto, cheque ou duplicata', 'texto'),
  ];
  /** Frete e outros custos de aquisição: cada item é um lançamento próprio, com parceiro e um título com vencimento próprio. */
  var CAMPOS_CUSTO_COMPRA = [
    a_('tipo', 'Custo', 'lista', { obrigatorio: true, opcoes: ['FRETE', 'OUTRO'], default: 'FRETE' }),
    a_('valor', 'Valor', 'dinheiro', { obrigatorio: true, min: 0.01 }),
    a_('partner_id', 'Pago a', 'ref:PARCEIROS', { ajuda: 'O transportador, o corretor: quem recebe este valor.' }),
    a_('data_vencimento', 'Vencimento', 'data', { ajuda: 'Vazio = à vista, na data da compra.' }),
    a_('forma_pagamento', 'Forma de pagamento', 'lista', { lista: 'FORMA_PAGAMENTO' }),
    a_('documento', 'Recibo ou nota', 'texto'),
    a_('descricao', 'Descrição', 'texto', { ajuda: 'Ex.: comissão do corretor, taxa da GTA.' }),
  ];

  /** Definições completas dos tipos da Fase 1. */
  var DEFINICOES = {
    ENTRADA_INICIAL: {
      frequente: false, selecao_animais: 'NOVOS', filtro_elegiveis: null, modo_entrada: 'FORM', revisao: 'SERVIDOR', critico: true,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: [
        c_('event_date', 'Data do inventário inicial', 'data', { default: { de: 'CONFIGURACOES.data_marco_zero' }, ajuda: 'Sempre a data do marco zero.' }),
        c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }),
        c_('responsible', 'Responsável pela contagem', 'texto'),
        c_('notes', 'Observações', 'texto'),
      ],
      campos_animal: camposNovoAnimal_(true),
      componentes: ['grade_novos_animais'],
      grupos_repetiveis: {},
    },
    OUTRA_ENTRADA: {
      frequente: false, selecao_animais: 'NOVOS', filtro_elegiveis: { situacao: ['VENDIDO', 'DESCARTADO', 'BAIXADO_AJUSTE', 'HISTORICO'] },
      modo_entrada: 'FORM', revisao: 'LOCAL', critico: false,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: [
        c_('event_date', 'Data da entrada', 'data', { obrigatorio: true, default: 'HOJE' }),
        c_('description', 'Como entrou', 'texto', { obrigatorio: true, ajuda: 'Doação, permuta, animal encontrado, volta sem compra.' }),
        c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }),
        c_('responsible', 'Responsável', 'texto'),
        c_('notes', 'Observações', 'texto'),
      ],
      campos_animal: [a_('animal_id', 'Animal já cadastrado (volta ao rebanho)', 'ref:ANIMAIS')].concat(camposNovoAnimal_(false)),
      componentes: ['grade_novos_animais', 'seletor_animais'],
      grupos_repetiveis: {},
    },
    NASCIMENTO: {
      frequente: true, selecao_animais: 'UM', filtro_elegiveis: { situacao: 'ATIVO', sexo: 'F' }, modo_entrada: 'FORM', revisao: 'LOCAL', critico: false,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: [
        c_('event_date', 'Data do parto', 'data', { obrigatorio: true, default: 'HOJE' }),
        c_('pasto_destino_id', 'Pasto das crias', 'ref:PASTOS', { ajuda: 'Vazio = o pasto em que a mãe estava no dia do parto.' }),
        c_('pai_id', 'Pai (touro)', 'ref:ANIMAIS', { ajuda: 'Opcional. Deixe vazio se a vaca esteve com mais de um touro.' }),
        c_('pai_confianca', 'Pai é', 'lista', { opcoes: ['CONFIRMADA', 'ESTIMADA'], visivel_se: quando_('pai_id', true), obrigatorio_se: quando_('pai_id', true) }),
        c_('tipo_parto', 'Como foi o parto', 'lista', { lista: 'TIPO_PARTO' }),
        c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }),
        c_('responsible', 'Responsável', 'texto'),
        c_('notes', 'Observações', 'texto'),
      ],
      campos_animal: [],
      componentes: ['seletor_animais'],
      grupos_repetiveis: { crias: CAMPOS_CRIA },
    },
    COMPRA: {
      frequente: true, selecao_animais: 'NOVOS', filtro_elegiveis: { situacao: ['VENDIDO', 'DESCARTADO', 'BAIXADO_AJUSTE', 'HISTORICO'] },
      modo_entrada: 'FORM', revisao: 'SERVIDOR', critico: true,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: CAMPOS_COMPRA,
      campos_animal: CAMPOS_ANIMAL_COMPRA,
      componentes: ['grade_novos_animais', 'seletor_animais', 'bloco_negociacao', 'bloco_parcelas'],
      grupos_repetiveis: { parcelas: CAMPOS_PARCELA, custos: CAMPOS_CUSTO_COMPRA },
    },
    TRANSFERENCIA: {
      frequente: true, selecao_animais: 'VARIOS', filtro_elegiveis: { situacao: 'ATIVO', pasto: '$pasto_origem_id' }, modo_entrada: 'FORM', revisao: 'LOCAL', critico: false,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: [
        c_('event_date', 'Data', 'data', { obrigatorio: true, default: 'HOJE' }),
        c_('pasto_origem_id', 'Pasto de origem', 'ref:PASTOS', { obrigatorio: true }),
        c_('pasto_destino_id', 'Pasto de destino', 'ref:PASTOS', { obrigatorio: true }),
        c_('gta_numero', 'Número da GTA', 'texto', { ajuda: 'Opcional: quando o destino fica em outra propriedade.' }),
        c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }),
        c_('responsible', 'Responsável', 'texto'),
        c_('notes', 'Observações', 'texto'),
      ],
      campos_animal: [],
      componentes: ['seletor_animais'],
      grupos_repetiveis: {},
    },
    MORTE: {
      frequente: true, selecao_animais: 'VARIOS', filtro_elegiveis: { situacao: 'ATIVO' }, modo_entrada: 'FORM', revisao: 'LOCAL', critico: true,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: camposSaida_('MORTE'),
      campos_animal: [a_('observacoes', 'Observações deste animal', 'texto')],
      componentes: ['seletor_animais'],
      grupos_repetiveis: {},
    },
    DESCARTE: {
      frequente: false, selecao_animais: 'VARIOS', filtro_elegiveis: { situacao: 'ATIVO' }, modo_entrada: 'FORM', revisao: 'LOCAL', critico: true,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: camposSaida_('DESCARTE'),
      campos_animal: [a_('observacoes', 'Observações deste animal', 'texto')],
      componentes: ['seletor_animais'],
      grupos_repetiveis: {},
    },
    AJUSTE_INVENTARIO: {
      frequente: false, selecao_animais: 'VARIOS', filtro_elegiveis: { situacao: 'NAO_ANULADO' }, modo_entrada: 'FORM', revisao: 'LOCAL', critico: false,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: [
        c_('event_date', 'Data da correção', 'data', { obrigatorio: true, default: 'HOJE' }),
        c_('justificativa', 'Por que corrigir', 'texto', { obrigatorio: true }),
        c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }),
        c_('responsible', 'Responsável', 'texto'),
        c_('notes', 'Observações', 'texto'),
      ],
      componentes: ['seletor_animais'],
      grupos_repetiveis: {},
      subtipos: {
        CORRECAO_CADASTRO: {
          rotulo: 'Corrigir cadastro (sexo, nascimento, mãe, pai, castrado)', fase: 1,
          campos_animal: [
            a_('animal_id', 'Animal', 'ref:ANIMAIS', { obrigatorio: true }),
            a_('campo', 'O que corrigir', 'lista', { obrigatorio: true, opcoes: Object.keys(CAMPOS_CORRIGIVEIS) }),
            a_('valor_novo', 'Valor correto', 'texto', { ajuda: 'Vazio = desconhecido.' }),
          ],
          campos_corrigiveis: CAMPOS_CORRIGIVEIS,
        },
        IDENTIFICACAO_INCORRETA: {
          rotulo: 'Brinco lançado errado', fase: 1,
          campos_animal: [
            a_('animal_id', 'Animal', 'ref:ANIMAIS', { obrigatorio: true }),
            a_('brinco', 'Brinco correto', 'texto', { obrigatorio: true }),
          ],
        },
        CORRECAO_LOCALIZACAO: {
          rotulo: 'Animal estava em outro pasto', fase: 1,
          campos_animal: [
            a_('animal_id', 'Animal', 'ref:ANIMAIS', { obrigatorio: true }),
            a_('pasto_origem_id', 'Pasto registrado', 'ref:PASTOS', { ajuda: 'Conferido com o que o sistema registrava na data.' }),
            a_('pasto_destino_id', 'Pasto onde está de fato', 'ref:PASTOS', { obrigatorio: true }),
          ],
        },
        RECLASSIFICACAO: { rotulo: 'Mudar a categoria', fase: 2 },
        DIVERGENCIA_CONTAGEM: { rotulo: 'Animal não encontrado na contagem', fase: 2 },
      },
    },
    ESTORNO: {
      frequente: false, selecao_animais: 'NENHUM', filtro_elegiveis: null, modo_entrada: 'FORM', revisao: 'SERVIDOR', critico: true,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: [
        c_('event_id', 'Evento a estornar', 'ref:EVENTOS', { obrigatorio: true }),
        c_('justificativa', 'Motivo do estorno', 'texto', { obrigatorio: true }),
      ],
      componentes: [],
      grupos_repetiveis: {},
    },
  };

  // ------------------------------------------------------------------ consultas ----
  function erro_(mensagem) {
    return Validation.erro('INTERNAL', mensagem);
  }
  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function nomes() {
    return Object.keys(RESUMO);
  }
  function existe(tipo) {
    return Object.prototype.hasOwnProperty.call(RESUMO, tipo);
  }
  /** Definição do tipo (resumo + campos, quando há). Tipo fora do catálogo → INTERNAL (erro de programação). */
  function tipo(nome) {
    if (!existe(nome)) throw erro_('Tipo de evento desconhecido: ' + nome + '.');
    var r = RESUMO[nome];
    var d = DEFINICOES[nome] || {};
    var out = { tipo: nome };
    Object.keys(r).forEach(function (k) { out[k] = r[k]; });
    Object.keys(d).forEach(function (k) { out[k] = d[k]; });
    return out;
  }
  function subtipos(nome) {
    var d = DEFINICOES[nome];
    return d && d.subtipos ? Object.keys(d.subtipos) : [];
  }
  /** Subtipo entregue na fase e com campos (subtipo da fase sem campos ainda não passa pelo motor). */
  function subtipoPronto_(sub, f) {
    return !!sub && sub.fase <= f && Array.isArray(sub.campos_animal) && sub.campos_animal.length > 0;
  }
  /** Tipo (e subtipo) entregue na fase dada (padrão: a corrente) e com definição de campos. */
  function ativo(nome, subtipo, fase) {
    var f = fase === undefined || fase === null ? FASE_ATUAL : fase;
    if (!existe(nome) || RESUMO[nome].fase > f || !DEFINICOES[nome]) return false;
    var subs = DEFINICOES[nome].subtipos;
    if (!subs) return vazio_(subtipo);
    if (vazio_(subtipo)) return Object.keys(subs).some(function (s) { return subtipoPronto_(subs[s], f); });
    return subtipoPronto_(subs[subtipo], f);
  }
  function tiposAtivos(fase) {
    return nomes().filter(function (n) { return ativo(n, null, fase); });
  }
  function modulosAtivos(fase) {
    var f = fase === undefined || fase === null ? FASE_ATUAL : fase;
    return MODULOS.filter(function (m) { return m.fase <= f; }).map(function (m) { return Utils.clonar(m); });
  }
  /** Campos por animal do tipo/subtipo. */
  function camposAnimal(nome, subtipo) {
    var d = DEFINICOES[nome];
    if (!d) return [];
    if (d.subtipos) return (d.subtipos[subtipo] && d.subtipos[subtipo].campos_animal) || [];
    return d.campos_animal || [];
  }
  function camposEvento(nome) {
    return (DEFINICOES[nome] && DEFINICOES[nome].campos) || [];
  }
  /** Campos de um grupo repetível do tipo (ex.: as crias do NASCIMENTO); grupo inexistente → lista vazia. */
  function camposGrupo(nome, grupo) {
    var g = DEFINICOES[nome] && DEFINICOES[nome].grupos_repetiveis;
    return (g && g[grupo]) || [];
  }
  /** Abas que o comando do tipo lê. */
  function leituras(nome) {
    return (DEFINICOES[nome] && DEFINICOES[nome].reads) || LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO);
  }
  /** O catálogo dos tipos ativos, pronto para o cliente (cópia sem funções, só dados). */
  function serializar(fase) {
    var f = fase === undefined || fase === null ? FASE_ATUAL : fase;
    var tipos = tiposAtivos(f).map(function (n) {
      var t = Utils.clonar(tipo(n));
      if (t.subtipos) {
        var subs = {};
        Object.keys(t.subtipos).forEach(function (s) { if (subtipoPronto_(t.subtipos[s], f)) subs[s] = t.subtipos[s]; });
        t.subtipos = subs;
      }
      return t;
    });
    return { fase: f, modulos: modulosAtivos(f), tipos: Utils.ordenarPor(tipos, 'ordem') };
  }

  // ------------------------------------------------------------------ validação de campos ----
  function condicao_(cond, valores) {
    if (!cond) return true;
    var v = valores[cond.campo];
    if (cond.preenchido) return !vazio_(v) && v !== false;
    return (cond.valores || []).some(function (x) { return x === v; });
  }
  function det_(codigo, campo, mensagem) {
    return { codigo: codigo, campo: campo, mensagem: mensagem };
  }
  /**
   * Confere `valores` contra as definições de campo (só formato, obrigatoriedade, lista e faixa; existência de
   * referência e regras de negócio são do EventService). opcoes: {listas: {LISTA: [códigos ativos]}, rotuloQuem}.
   * Devolve detalhes {codigo, campo, mensagem}; chave sem definição → CAMPO_DESCONHECIDO.
   */
  function validarCampos(definicoes, valores, opcoes) {
    var o = opcoes || {};
    var v = valores || {};
    var out = [];
    var porId = {};
    definicoes.forEach(function (d) { porId[d.id] = d; });
    Object.keys(v).forEach(function (k) {
      if (!porId[k] && !vazio_(v[k])) out.push(det_('CAMPO_DESCONHECIDO', k, 'O campo "' + k + '" não existe neste lançamento.'));
    });
    definicoes.forEach(function (d) {
      var x = v[d.id];
      var visivel = condicao_(d.visivel_se, v);
      var obrig = d.obrigatorio || (d.obrigatorio_se && condicao_(d.obrigatorio_se, v));
      if (vazio_(x)) {
        if (obrig && visivel) out.push(det_('CAMPO_OBRIGATORIO', d.id, 'Preencha "' + d.rotulo + '".'));
        return;
      }
      if (!visivel) {
        if (x !== false) out.push(det_('CAMPO_NAO_SE_APLICA', d.id, '"' + d.rotulo + '" não se aplica a este animal.'));
        return;
      }
      var p = valorDoCampo_(d, x, o);
      if (p) out.push(det_(p.codigo, d.id, p.mensagem));
    });
    return out;
  }
  function valorDoCampo_(d, x, o) {
    var t = d.tipo;
    if (t === 'texto' || t.indexOf('ref:') === 0 || t === 'anexo') {
      if (d.id === 'outras_identificacoes') return Array.isArray(x) ? null : { codigo: 'TIPO_INVALIDO', mensagem: '"' + d.rotulo + '" precisa ser uma lista.' };
      if (typeof x !== 'string') return { codigo: 'TIPO_INVALIDO', mensagem: '"' + d.rotulo + '" precisa ser texto.' };
      return Validation.validarTeto(x);
    }
    if (t === 'bool') return typeof x === 'boolean' ? null : { codigo: 'TIPO_INVALIDO', mensagem: '"' + d.rotulo + '" precisa ser sim ou não.' };
    if (t === 'data') return typeof x === 'string' && Utils.dataValida(x) ? null : { codigo: 'FORMATO_INVALIDO', mensagem: '"' + d.rotulo + '" não é uma data válida.' };
    if (t === 'lista') {
      var ok = d.opcoes ? d.opcoes.indexOf(x) >= 0 : (o.listas && o.listas[d.lista] ? o.listas[d.lista].indexOf(x) >= 0 : typeof x === 'string');
      return ok ? null : { codigo: 'VALOR_FORA_DA_LISTA', mensagem: '"' + x + '" não é uma opção de "' + d.rotulo + '".' };
    }
    if (typeof x !== 'number' || !isFinite(x)) return { codigo: 'TIPO_INVALIDO', mensagem: '"' + d.rotulo + '" precisa ser um número.' };
    if ((t === 'inteiro' || t === 'dinheiro') && Math.floor(x) !== x) {
      return { codigo: 'TIPO_INVALIDO', mensagem: '"' + d.rotulo + '" precisa ser um número inteiro' + (t === 'dinheiro' ? ' de centavos.' : '.') };
    }
    if (t === 'decimal' && d.casas !== undefined && Utils.casasDecimais(x) > d.casas) {
      return { codigo: 'FORMATO_INVALIDO', mensagem: '"' + d.rotulo + '" aceita no máximo ' + d.casas + ' casa decimal.' };
    }
    var n = t === 'dinheiro' ? x / 100 : x;
    if ((d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max)) {
      var faixa = d.max !== undefined ? 'entre ' + d.min + ' e ' + d.max : 'a partir de ' + d.min;
      return { codigo: 'VALOR_FORA_DA_FAIXA', mensagem: '"' + d.rotulo + '" precisa estar ' + faixa + (d.unidade ? ' ' + d.unidade : '') + '.' };
    }
    return null;
  }

  return {
    FASE_ATUAL: FASE_ATUAL,
    TIPOS_CAMPO: TIPOS_CAMPO,
    PESO_MAX_KG: PESO_MAX_KG,
    CAMPOS_CORRIGIVEIS: CAMPOS_CORRIGIVEIS,
    nomes: nomes,
    existe: existe,
    tipo: tipo,
    subtipos: subtipos,
    ativo: ativo,
    tiposAtivos: tiposAtivos,
    modulosAtivos: modulosAtivos,
    camposEvento: camposEvento,
    camposAnimal: camposAnimal,
    camposGrupo: camposGrupo,
    leituras: leituras,
    serializar: serializar,
    validarCampos: validarCampos,
  };
})();
