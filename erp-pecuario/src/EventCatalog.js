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
  var FASE_ATUAL = 4;
  var TIPOS_CAMPO = ['texto', 'inteiro', 'decimal', 'dinheiro', 'data', 'lista', 'bool', 'anexo'];
  var PESO_MAX_KG = 2000;

  /**
   * Os 10 itens do menu (§15) e a importação, com a fase em que cada um é entregue (08, seção 2). Como o tipo de evento só
   * fica ativo com campos, o módulo só fica ativo com a tela entregue: `tela` é o arquivo HTML dela (o módulo sem `tela`
   * ainda não foi entregue, qualquer que seja a fase). `sob_demanda`: a tela não entra na página inicial e é pedida ao
   * servidor quando o menu abre o módulo (rota `sistema.tela`; 01, seção 6.2; risco R-31); `rotas` são as raízes de rota
   * dela (o primeiro trecho da rota), pelas quais o cliente sabe que módulo pedir. As telas das Fases 3 a 5 entram sob
   * demanda; a importação, tarefa de desktop pouco usada na abertura, também. Desde a etapa BASE da Fase 4 (folga na página
   * inicial; CONTRATOS, seção 55), também a lista e o detalhe dos eventos (com a correção e o estorno, que partem do detalhe)
   * e as Configurações: a rota `evento/novo` (o registro) continua na página inicial, registrada pelo Components, e ganha
   * da raiz `evento` do módulo (rota registrada vale antes da sob demanda).
   */
  var MODULOS = [
    { id: 'DASHBOARD', rotulo: 'Visão geral', ordem: 1, fase: 1, menu: true, tela: 'Dashboard' },
    { id: 'REBANHO', rotulo: 'Rebanho', ordem: 2, fase: 1, menu: true, tela: 'Animals' },
    { id: 'PASTOS', rotulo: 'Pastos', ordem: 3, fase: 1, menu: true, tela: 'Pastures' },
    { id: 'EVENTOS', rotulo: 'Eventos', ordem: 4, fase: 1, menu: true, tela: 'Events', sob_demanda: true, rotas: ['eventos', 'evento'] },
    { id: 'PESAGENS', rotulo: 'Pesagens', ordem: 5, fase: 3, menu: true, tela: 'Weights', sob_demanda: true, rotas: ['pesagens'] },
    { id: 'SANIDADE', rotulo: 'Sanidade', ordem: 6, fase: 3, menu: true, tela: 'Health', sob_demanda: true, rotas: ['sanidade'] },
    { id: 'REPRODUCAO', rotulo: 'Reprodução', ordem: 7, fase: 3, menu: true, tela: 'Reproduction', sob_demanda: true, rotas: ['reproducao'] },
    { id: 'FINANCEIRO', rotulo: 'Financeiro', ordem: 8, fase: 4, menu: true, tela: 'Financial', sob_demanda: true, rotas: ['financeiro'] },
    { id: 'RELATORIOS', rotulo: 'Relatórios', ordem: 9, fase: 5, menu: true },
    { id: 'CONFIGURACOES', rotulo: 'Configurações', ordem: 10, fase: 1, menu: true, tela: 'Settings', sob_demanda: true, rotas: ['config'] },
    { id: 'IMPORTACAO', rotulo: 'Importação', ordem: 11, fase: 1, menu: false, tela: 'Import', sob_demanda: true, rotas: ['importar'] },
  ];

  /** Os 21 tipos (desenho-base 4.1), com fase. `subtipos` só onde há subtipo; cada subtipo tem a sua fase. */
  /**
   * Resumo de cada tipo. `aceita_historico`: o formulário aceita data anterior ao marco zero como registro histórico
   * (04, seção 6; só o NASCIMENTO): o motor e a tela leem daqui, uma regra só (§20, regra 8).
   */
  var RESUMO = {
    ENTRADA_INICIAL: { rotulo: 'Rebanho inicial (marco zero)', grupo_ui: 'Movimentação', ordem: 10, fase: 1 },
    OUTRA_ENTRADA: { rotulo: 'Outra entrada (doação, permuta, achado)', grupo_ui: 'Movimentação', ordem: 20, fase: 1 },
    NASCIMENTO: { rotulo: 'Nascimento', grupo_ui: 'Reprodução', ordem: 30, fase: 2, aceita_historico: true },
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
  /**
   * O lançamento como substantivo, com artigo, para as frases da tela e das mensagens ("Abrir a compra de 01/03",
   * "Estornar a venda de 30 animais"): o rótulo do tipo é um verbo ("Comprar animais") e não serve no meio da frase.
   * Por subtipo quando ele diz mais que o tipo (chave TIPO.SUBTIPO).
   */
  var NOME_TIPO = {
    ENTRADA_INICIAL: 'o rebanho inicial', OUTRA_ENTRADA: 'a entrada', NASCIMENTO: 'o parto', COMPRA: 'a compra', VENDA: 'a venda',
    TRANSFERENCIA: 'a transferência', MORTE: 'a morte', DESCARTE: 'o descarte', PESAGEM: 'a pesagem', SANIDADE: 'o manejo sanitário',
    REPRODUCAO: 'o registro reprodutivo', DESMAMA: 'a desmama', CASTRACAO: 'a castração', IDENTIFICACAO: 'a identificação',
    MARCACAO: 'a marcação', AJUSTE_INVENTARIO: 'a correção de dados', OCORRENCIA: 'a ocorrência', LANCAMENTO_FINANCEIRO: 'o lançamento financeiro',
    RATEIO: 'o rateio de custo', ESTOQUE: 'o movimento de estoque', ESTORNO: 'o estorno',
  };
  var NOME_SUBTIPO = {
    'AJUSTE_INVENTARIO.CORRECAO_CADASTRO': 'a correção de cadastro', 'AJUSTE_INVENTARIO.IDENTIFICACAO_INCORRETA': 'a correção de brinco',
    'AJUSTE_INVENTARIO.CORRECAO_LOCALIZACAO': 'a correção de localização', 'AJUSTE_INVENTARIO.RECLASSIFICACAO': 'a reclassificação',
    'AJUSTE_INVENTARIO.DIVERGENCIA_CONTAGEM': 'a baixa na contagem', 'IDENTIFICACAO.PRIMEIRA_IDENTIFICACAO': 'a primeira identificação',
    'IDENTIFICACAO.SUBSTITUICAO': 'a troca de brinco', 'IDENTIFICACAO.REMOCAO': 'a retirada de brinco',
    'MARCACAO.DESCARTE': 'a marcação para descarte', 'MARCACAO.NAO_LOCALIZADO': 'a marcação de não localizado',
    'SANIDADE.VACINACAO': 'a vacinação', 'SANIDADE.VERMIFUGACAO': 'a vermifugação', 'SANIDADE.MEDICACAO': 'a medicação',
    'SANIDADE.TRATAMENTO': 'o tratamento', 'SANIDADE.EXAME': 'o exame', 'SANIDADE.DOENCA': 'o registro de doença',
    'ESTOQUE.ENTRADA': 'a entrada de insumo', 'ESTOQUE.AJUSTE': 'o acerto de estoque',
    'REPRODUCAO.EXPOSICAO': 'a exposição ao touro', 'REPRODUCAO.COBERTURA': 'a cobertura', 'REPRODUCAO.INSEMINACAO': 'a inseminação',
    'REPRODUCAO.DIAGNOSTICO_GESTACAO': 'o diagnóstico de gestação', 'REPRODUCAO.ABORTO': 'o aborto',
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
    l.push(a_('outras_identificacoes', 'Outras identificações', 'texto', { ajuda: 'Brinco do vendedor, chip (RFID), SISBOV ou tatuagem: escolha o tipo e digite o número.' }));
    l.push(a_('observacoes', 'Observações deste animal', 'texto'));
    return l;
  }

  /** Campos que a correção de cadastro aceita, com o rótulo da tela (o mesmo de "O que corrigir") para as mensagens. */
  var CAMPOS_CORRIGIVEIS = {
    sexo: { tipo: 'lista', opcoes: ['M', 'F'], rotulo: 'Sexo' },
    data_nascimento: { tipo: 'data', rotulo: 'Data de nascimento' },
    data_nascimento_confianca: { tipo: 'lista', opcoes: CONFIANCAS, rotulo: 'Certeza do nascimento' },
    mae_id: { tipo: 'ref:ANIMAIS', rotulo: 'Mãe' },
    mae_confianca: { tipo: 'lista', opcoes: ['CONFIRMADA', 'ESTIMADA'], rotulo: 'Certeza da mãe' },
    pai_id: { tipo: 'ref:ANIMAIS', rotulo: 'Pai' },
    pai_confianca: { tipo: 'lista', opcoes: ['CONFIRMADA', 'ESTIMADA'], rotulo: 'Certeza do pai' },
    castrado: { tipo: 'bool', rotulo: 'Castrado' },
    reprodutor: { tipo: 'bool', rotulo: 'Reprodutor (touro)' },
    partos_previos: { tipo: 'inteiro', min: 0, max: 30, rotulo: 'Partos anteriores' },
    origem: { tipo: 'lista', opcoes: ['NASCIDO', 'COMPRADO', 'DESCONHECIDA'], rotulo: 'Origem' },
    data_entrada: { tipo: 'data', rotulo: 'Chegada na fazenda' },
    data_entrada_confianca: { tipo: 'lista', opcoes: CONFIANCAS, rotulo: 'Certeza da chegada' },
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
   * OPERACIONAIS). Um título, com vencimento próprio (vazio = à vista, na data do evento), em uma ou mais parcelas
   * mensais; rateio por cabeça.
   */
  function camposLancamentoSaida_(tipo) {
    var p = tipo === 'MORTE' ? 'custo_' : 'receita_';
    var tem = quando_(p + 'valor', true);
    var l = [c_(p + 'valor', tipo === 'MORTE' ? 'Custos associados (opcional)' : 'Receita do descarte (opcional)', 'dinheiro', { min: 0.01,
      ajuda: tipo === 'MORTE' ? 'Necropsia, remoção, tratamento final: vira custo dos animais desta morte.' : 'Valor recebido na permuta ou na entrega, se houve. Venda é pelo "Vender animais".' })];
    if (tipo === 'MORTE') l.push(c_('custo_conta_id', 'Conta do custo', 'ref:PLANO_CONTAS', { naturezas: ['CUSTEIO'], visivel_se: tem, obrigatorio_se: tem }));
    l.push(c_(p + 'partner_id', tipo === 'MORTE' ? 'Pago a' : 'Recebido de', 'ref:PARCEIROS', { visivel_se: tem }));
    l.push(c_(p + 'vencimento', 'Vencimento', 'data', { visivel_se: tem, ajuda: 'Vazio = à vista, na data do evento. Em mais de uma vez, é o vencimento da primeira parcela.' }));
    l.push(c_(p + 'parcelas_qtd', 'Em quantas vezes', 'inteiro', { min: 1, max: 120, visivel_se: tem, ajuda: 'Vazio = uma vez. Com mais de uma, as parcelas vencem de mês em mês, em partes iguais.' }));
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
  var LEITURAS_FINANCEIRO = ['FINANCEIRO', 'PARCELAS', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'PLANO_CONTAS', 'COMPRAS', 'VENDAS', 'PARCEIROS'];
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
    a_('outras_identificacoes', 'Outras identificações', 'texto', { ajuda: 'Chip (RFID), SISBOV ou tatuagem: escolha o tipo e digite o número.' }),
    a_('observacoes', 'Observações deste animal', 'texto'),
  ];
  /** Parcelas do valor dos animais (bloco_parcelas): vencimento e valor; valor vazio = divisão igual do que falta. */
  var CAMPOS_PARCELA = [
    a_('data_vencimento', 'Vencimento', 'data', { obrigatorio: true }),
    a_('valor', 'Valor', 'dinheiro', { min: 0.01, ajuda: 'Vazio = divide em partes iguais o que falta.' }),
    a_('forma_pagamento', 'Forma de pagamento', 'lista', { lista: 'FORMA_PAGAMENTO' }),
    a_('documento', 'Boleto, cheque ou duplicata', 'texto'),
  ];
  /**
   * VENDA (04, seção 4.3; 03b, seções 4.2 a 4.5 e 16.10): comprador, finalidade (ABATE decide a carência), negociação
   * (modalidade × base de peso, preço, valor bruto da nota ou do romaneio, desconto comercial, critério só no lote
   * fechado), pasto de onde o lote sai (opcional: filtra os animais e confere a origem de cada um), animais do
   * rebanho com peso vivo, carcaça, valor e motivo de saída, as parcelas da receita e as deduções (um lançamento de
   * despesa de venda por item; retida pelo comprador = descontada no pagamento).
   */
  var CAMPOS_VENDA = [
    c_('event_date', 'Data da venda', 'data', { obrigatorio: true, default: 'HOJE' }),
    c_('partner_id', 'Comprador', 'ref:PARCEIROS', { obrigatorio: true }),
    c_('finalidade', 'Para que foram vendidos', 'lista', { obrigatorio: true, lista: 'FINALIDADE_NEGOCIO', ajuda: 'Abate: animal em carência sanitária não pode ser vendido.' }),
    c_('pasto_origem_id', 'Pasto de onde saem', 'ref:PASTOS', { ajuda: 'Opcional: mostra só os animais do pasto e confere que cada um estava nele na data.' }),
    c_('modalidade', 'Como foi o preço', 'lista', { obrigatorio: true, opcoes: ['CABECA', 'KG_VIVO', 'ARROBA', 'LOTE'] }),
    c_('base_peso', 'Arroba de', 'lista', { opcoes: ['VIVO', 'CARCACA'], visivel_se: MOD(['ARROBA']), obrigatorio_se: MOD(['ARROBA']), ajuda: 'Carcaça: romaneio do frigorífico. Vivo: peso de balança com rendimento combinado.' }),
    c_('rendimento_carcaca_pct', 'Rendimento de carcaça', 'decimal', { unidade: '%', min: 0.1, max: 99.9, casas: 1, default: { de: 'CONFIGURACOES.rendimento_carcaca_padrao_pct' }, visivel_se: quando_('base_peso', ['VIVO']), obrigatorio_se: quando_('base_peso', ['VIVO']) }),
    c_('rendimento_tipo', 'O rendimento foi', 'lista', { opcoes: ['NEGOCIADO', 'ESTIMADO'], visivel_se: quando_('base_peso', ['VIVO']), obrigatorio_se: quando_('base_peso', ['VIVO']) }),
    c_('preco_unitario', 'Preço', 'dinheiro', { min: 0.01, visivel_se: MOD(['CABECA', 'KG_VIVO', 'ARROBA']), obrigatorio_se: MOD(['KG_VIVO', 'ARROBA']), ajuda: 'Por cabeça, por kg vivo ou por arroba, conforme a forma do preço. Por cabeça, deixe vazio se cada animal teve o seu valor.' }),
    c_('peso_vivo_total_kg', 'Peso vivo total do lote', 'decimal', { unidade: 'kg', min: 0.1, casas: 1, ajuda: 'Vazio = a soma dos pesos dos animais.' }),
    c_('peso_carcaca_total_kg', 'Carcaça total (romaneio)', 'decimal', { unidade: 'kg', min: 0.1, casas: 1, visivel_se: quando_('base_peso', ['CARCACA']), ajuda: 'Vazio = a soma das carcaças dos animais.' }),
    c_('valor_bruto', 'Valor bruto da venda (nota ou romaneio)', 'dinheiro', { obrigatorio: true, min: 0.01, ajuda: 'Antes do desconto e das deduções. Vale o valor da nota; a conta pelo preço é só conferência.' }),
    c_('desconto_comercial', 'Desconto no preço', 'dinheiro', { min: 0, ajuda: 'Abatimento dado ao comprador; reduz a receita. Frete, comissão e impostos vão nas deduções.' }),
    c_('criterio_rateio', 'Como dividir o valor entre os animais', 'lista', { opcoes: ['CABECAS', 'PESO_VIVO', 'PESO_CARCACA', 'VALOR_INDIVIDUAL', 'MANUAL'], visivel_se: MOD(['LOTE']), obrigatorio_se: MOD(['LOTE']) }),
    c_('justificativa_rateio', 'Por que essa divisão', 'texto', { visivel_se: quando_('criterio_rateio', ['MANUAL']), obrigatorio_se: quando_('criterio_rateio', ['MANUAL']) }),
    c_('gta_numero', 'Número da GTA', 'texto'),
    c_('nota_fiscal', 'Número da nota fiscal', 'texto'),
    c_('condicoes', 'Condições da negociação', 'texto', { ajuda: 'Texto livre: embarque na fazenda, prazo combinado.' }),
    c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }),
    c_('responsible', 'Responsável', 'texto'),
    c_('notes', 'Observações', 'texto'),
  ];
  var CAMPOS_ANIMAL_VENDA = [
    a_('peso', 'Peso vivo na venda', 'decimal', { unidade: 'kg', min: 0.1, max: PESO_MAX_KG, casas: 1, ajuda: 'Vira a pesagem de venda do animal.' }),
    a_('metodo_pesagem', 'Como foi pesado', 'lista', { opcoes: METODOS_PESAGEM, visivel_se: quando_('peso', true), ajuda: 'Vazio = balança.' }),
    a_('peso_carcaca_kg', 'Peso de carcaça (romaneio)', 'decimal', { unidade: 'kg', min: 0.1, max: PESO_MAX_KG, casas: 1, ajuda: 'Só na arroba de carcaça ou no lote dividido por carcaça. Nunca vira pesagem.' }),
    a_('valor_individual', 'Valor deste animal', 'dinheiro', { min: 0.01, ajuda: 'Só quando cada animal teve o seu preço (por cabeça) ou no lote dividido pelo valor de cada um. A soma é a receita (bruto − desconto).' }),
    a_('base_manual', 'Peso na divisão manual', 'decimal', { min: 0.0001, casas: 4, ajuda: 'Só no lote com divisão manual: percentual ou proporção deste animal.' }),
    a_('motivo_saida', 'Vendido como descarte por', 'lista', { lista: 'MOTIVO_DESCARTE', ajuda: 'Opcional: marca o animal vendido como descarte.' }),
    a_('observacoes', 'Observações deste animal', 'texto'),
  ];
  /** Deduções da venda (frete, comissão, taxas e retenções): cada item é um lançamento de despesa de venda com um título. */
  var CAMPOS_DEDUCAO_VENDA = [
    a_('tipo', 'Dedução', 'lista', { obrigatorio: true, lista: 'TIPO_DEDUCAO_VENDA' }),
    a_('valor', 'Valor', 'dinheiro', { obrigatorio: true, min: 0.01, ajuda: 'O valor cobrado, sem alíquota calculada pelo sistema.' }),
    a_('retida_pelo_comprador', 'Descontada pelo comprador no pagamento', 'bool', { default: false, ajuda: 'Sim: o comprador deposita o valor já sem esta dedução (encontro de contas).' }),
    a_('partner_id', 'Pago a', 'ref:PARCEIROS', { ajuda: 'Transportador, corretor, órgão. Vazio na dedução retida = o comprador.' }),
    a_('data_vencimento', 'Vencimento', 'data', { ajuda: 'Vazio = à vista, na data da venda; retida = no recebimento da primeira parcela.' }),
    a_('forma_pagamento', 'Forma de pagamento', 'lista', { lista: 'FORMA_PAGAMENTO' }),
    a_('documento', 'Recibo ou nota', 'texto'),
    a_('descricao', 'Descrição', 'texto'),
  ];
  /**
   * IDENTIFICACAO (04, seção 4.4; 03a, seção 4.4): rotina de curral, coletiva. O tipo de identificação vale para o
   * lançamento inteiro (cada linha de IDENTIFICACOES leva o tipo); por animal, o código novo e o motivo. O brinco do
   * vendedor (BRINCO_ORIGEM) só nasce na compra: aqui ele só pode ser retirado.
   */
  var TIPOS_IDENTIFICACAO = ['BRINCO', 'RFID', 'SISBOV', 'TATUAGEM', 'OUTRO', 'BRINCO_ORIGEM'];
  var CAMPOS_IDENTIFICACAO = [
    c_('event_date', 'Data', 'data', { obrigatorio: true, default: 'HOJE' }),
    c_('tipo_identificacao', 'Identificação', 'lista', { obrigatorio: true, opcoes: TIPOS_IDENTIFICACAO, default: 'BRINCO', ajuda: 'Brinco da fazenda, chip, SISBOV, tatuagem ou outra. O brinco do vendedor só pode ser retirado.' }),
    c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }),
    c_('responsible', 'Responsável', 'texto'),
    c_('notes', 'Observações', 'texto'),
  ];
  function camposIdentificacao_(subtipo) {
    var l = [a_('animal_id', 'Animal', 'ref:ANIMAIS', { obrigatorio: true })];
    if (subtipo !== 'REMOCAO') l.push(a_('codigo', subtipo === 'SUBSTITUICAO' ? 'Número novo' : 'Número', 'texto', { obrigatorio: true, ajuda: 'No brinco, zeros à esquerda não diferenciam números (0012 = 12).' }));
    if (subtipo !== 'PRIMEIRA_IDENTIFICACAO') l.push(a_('motivo', subtipo === 'SUBSTITUICAO' ? 'Por que trocou' : 'Por que tirou', 'lista', { obrigatorio: true, lista: 'MOTIVO_IDENTIFICACAO' }));
    l.push(a_('observacoes', 'Observações deste animal', 'texto'));
    return l;
  }
  /**
   * MARCACAO (04, seção 4.4; 03b, seção 2.6): marca ou desmarca "para descarte" ou "não localizado". A ação vale para o
   * lançamento inteiro e vai no payload (`acao`), com o motivo do descarte quando é marcação para descarte.
   */
  var CAMPOS_MARCACAO = [
    c_('event_date', 'Data', 'data', { obrigatorio: true, default: 'HOJE' }),
    c_('acao', 'Marcar ou desmarcar', 'lista', { obrigatorio: true, opcoes: ['MARCAR', 'DESMARCAR'], default: 'MARCAR' }),
    c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }),
    c_('responsible', 'Responsável', 'texto'),
    c_('notes', 'Observações', 'texto'),
  ];
  var CAMPOS_ANIMAL_MARCACAO = [
    a_('animal_id', 'Animal', 'ref:ANIMAIS', { obrigatorio: true }),
    a_('observacoes', 'Observações deste animal', 'texto'),
  ];
  /** Frete e outros custos de aquisição: cada item é um lançamento próprio, com parceiro e um título com vencimento próprio. */
  var CAMPOS_CUSTO_COMPRA = [
    a_('tipo', 'Custo', 'lista', { obrigatorio: true, opcoes: ['FRETE', 'OUTRO'], default: 'FRETE' }),
    a_('valor', 'Valor', 'dinheiro', { obrigatorio: true, min: 0.01 }),
    a_('partner_id', 'Pago a', 'ref:PARCEIROS', { ajuda: 'O transportador, o corretor: quem recebe este valor.' }),
    a_('data_vencimento', 'Vencimento', 'data', { ajuda: 'Vazio = à vista, na data da compra. Em mais de uma vez, é o vencimento da primeira parcela.' }),
    a_('parcelas_qtd', 'Em quantas vezes', 'inteiro', { min: 1, max: 120, ajuda: 'Vazio = uma vez. Com mais de uma, as parcelas vencem de mês em mês, em partes iguais.' }),
    a_('forma_pagamento', 'Forma de pagamento', 'lista', { lista: 'FORMA_PAGAMENTO' }),
    a_('documento', 'Recibo ou nota', 'texto'),
    a_('descricao', 'Descrição', 'texto', { ajuda: 'Ex.: comissão do corretor, taxa da GTA.' }),
  ];

  /**
   * PESAGEM (04, seção 4.5; 03b, seções 5 e 16.11): individual, coletiva ou por lote. O cabeçalho traz o momento da
   * pesagem (PESAGENS.tipo: rotina, chegada à fazenda, desmama ou saída — o peso ao nascer é do parto), como foi pesado e
   * o jejum; por animal, o peso. Na pesagem por lote, o fato é o peso total na balança e o número de cabeças (payload);
   * cada animal fica com a média do lote (MEDIA_LOTE, estimada) e o peso de cada um fica vazio.
   */
  var MOMENTOS_PESAGEM = ['ROTINA', 'ENTRADA', 'DESMAMA', 'VENDA'];
  var CAMPOS_PESAGEM = [
    c_('event_date', 'Data da pesagem', 'data', { obrigatorio: true, default: 'HOJE' }),
    c_('tipo_pesagem', 'Momento da pesagem', 'lista', { obrigatorio: true, opcoes: MOMENTOS_PESAGEM, default: 'ROTINA', ajuda: 'Rotina, chegada à fazenda, desmama ou saída (embarque). O peso ao nascer vai no parto.' }),
    c_('metodo_pesagem', 'Como foi pesado', 'lista', { obrigatorio: true, opcoes: METODOS_PESAGEM, default: 'BALANCA', ajuda: 'Na pesagem por lote, cada animal fica com a média do lote, marcada como estimada.' }),
    c_('jejum', 'Pesado em jejum', 'bool', { default: false }),
    c_('peso_total_lote_kg', 'Peso total do lote (balança coletiva)', 'decimal', { unidade: 'kg', min: 0.1, casas: 1, ajuda: 'Só na pesagem por lote: deixe vazio o peso de cada animal; cada um fica com a média.' }),
    c_('qtd_cabecas_lote', 'Cabeças na balança', 'inteiro', { min: 1, max: 1000, visivel_se: quando_('peso_total_lote_kg', true), obrigatorio_se: quando_('peso_total_lote_kg', true) }),
    c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }),
    c_('responsible', 'Responsável', 'texto'),
    c_('notes', 'Observações', 'texto'),
  ];
  var CAMPOS_ANIMAL_PESAGEM = [
    a_('animal_id', 'Animal', 'ref:ANIMAIS', { obrigatorio: true }),
    a_('peso', 'Peso vivo', 'decimal', { unidade: 'kg', min: 0.1, max: PESO_MAX_KG, casas: 1, ajuda: 'Na pesagem por lote, deixe vazio.' }),
    a_('observacoes', 'Observações deste animal', 'texto'),
  ];

  /**
   * SANIDADE (04, seção 4.5; 03b, seções 6, 15.2, 16.4 e 16.12): vacinação, vermifugação, medicação, tratamento, exame e
   * registro de doença, individual ou coletiva. O cabeçalho traz o produto (do cadastro ou em texto livre), o lote, a
   * validade, o modo da dose (por cabeça, por kg de peso vivo — o servidor calcula pelo peso atual de cada animal — ou só
   * o total), a quantidade que saiu do frasco, a via, a carência, a próxima aplicação, o protocolo cumprido, o
   * veterinário e o serviço ou produto pago no ato (opcional); por animal, a dose quando difere e o resultado do exame. O
   * registro de doença não aplica produto. Cada subtipo tem a lista inteira de cabeçalho (o tipo não tem campos próprios).
   */
  var MODOS_DOSE = ['POR_CABECA', 'POR_PESO', 'TOTAL'];
  /**
   * A despesa paga no ato de um manejo (sanidade, reprodução, castração, ocorrência; 03b, seção 2.5): um lançamento
   * CUSTEIO com as parcelas, rateado por cabeça entre os animais do lançamento. `rotulo` e `ajuda`: o que ela é no tipo.
   */
  function camposCustoPago_(rotulo, ajuda) {
    var tem = quando_('custo_valor', true);
    return [
      c_('custo_valor', rotulo || 'Serviço ou produto pago no ato (opcional)', 'dinheiro', { min: 0.01, ajuda: ajuda || 'Veterinário, serviço ou produto sem cadastro comprado na hora: vira custo dos animais tratados, com o pagamento a seguir. O produto do cadastro já entra no custo pelo consumo: a compra dele vai pela entrada no estoque.' }),
      c_('custo_conta_id', 'Conta do custo', 'ref:PLANO_CONTAS', { naturezas: ['CUSTEIO'], visivel_se: tem, obrigatorio_se: tem }),
      c_('custo_partner_id', 'Pago a', 'ref:PARCEIROS', { visivel_se: tem }),
      c_('custo_vencimento', 'Vencimento', 'data', { visivel_se: tem, ajuda: 'Vazio = à vista, na data da aplicação. Em mais de uma vez, é o vencimento da primeira parcela.' }),
      c_('custo_parcelas_qtd', 'Em quantas vezes', 'inteiro', { min: 1, max: 120, visivel_se: tem, ajuda: 'Vazio = uma vez. Com mais de uma, as parcelas vencem de mês em mês, em partes iguais.' }),
      c_('custo_forma_pagamento', 'Forma de pagamento', 'lista', { lista: 'FORMA_PAGAMENTO', visivel_se: tem }),
      c_('custo_documento', 'Recibo ou nota', 'texto', { visivel_se: tem }),
      c_('custo_descricao', 'Descrição do lançamento', 'texto', { visivel_se: tem }),
    ];
  }
  function camposSanidade_(sub) {
    var rotuloData = sub === 'DOENCA' ? 'Data do diagnóstico' : sub === 'EXAME' ? 'Data do exame (coleta)' : 'Data da aplicação';
    var l = [c_('event_date', rotuloData, 'data', { obrigatorio: true, default: 'HOJE' })];
    if (sub !== 'DOENCA') {
      l.push(c_('protocol_id', 'Protocolo cumprido', 'ref:PROTOCOLOS_SANITARIOS', { ajuda: 'Opcional: o protocolo sanitário que esta aplicação cumpre. A agenda conta a próxima dose por ele.' }));
      l.push(c_('produto_id', 'Produto do cadastro', 'ref:PRODUTOS', { ajuda: 'Com produto do cadastro, a aplicação dá baixa no estoque e o consumo vira custo dos animais.' }));
      l.push(c_('nome_produto', 'Ou o nome do produto (sem cadastro)', 'texto', { ajuda: 'Só quando o produto não está no cadastro: fica registrado, sem baixa de estoque nem custo pelo consumo.' }));
      l.push(c_('fabricante', 'Fabricante', 'texto', { ajuda: 'Vazio = o do cadastro do produto.' }));
      l.push(c_('lote', 'Lote aplicado', 'texto'));
      l.push(c_('validade', 'Validade do lote', 'data'));
      l.push(c_('modo_dose', 'Como foi a dose', 'lista', { opcoes: MODOS_DOSE, ajuda: 'Por cabeça: a mesma dose para cada animal. Por peso: dose por kg de peso vivo, que o sistema calcula pelo peso atual de cada um. Total: só a quantidade que saiu do frasco.' }));
      l.push(c_('dose_referencia', 'Dose', 'decimal', { casas: 4, min: 0.0001, visivel_se: quando_('modo_dose', ['POR_CABECA', 'POR_PESO']), ajuda: 'Por cabeça: a dose de cada animal. Por peso: a dose por kg (ex.: 0,02 mL por kg).' }));
      l.push(c_('unidade_dose', 'Unidade da dose', 'texto', { ajuda: 'Só para produto sem cadastro (mL, dose, g). Com produto do cadastro, vale a unidade dele.' }));
      l.push(c_('quantidade_consumida_total', 'Quantidade que saiu do frasco', 'decimal', { casas: 4, min: 0.0001, obrigatorio_se: quando_('modo_dose', ['TOTAL']), ajuda: 'Com produto do cadastro: o que saiu do estoque, inclusive a sobra descartada. Vazio = a soma das doses.' }));
      l.push(c_('via_aplicacao', 'Via de aplicação', 'lista', { lista: 'VIA_APLICACAO' }));
    }
    if (sub === 'TRATAMENTO' || sub === 'MEDICACAO') l.push(c_('motivo', 'Por que foi tratado', 'texto', { obrigatorio: sub === 'TRATAMENTO' }));
    if (sub === 'EXAME' || sub === 'DOENCA') l.push(c_('diagnostico', sub === 'EXAME' ? 'Doença ou condição pesquisada' : 'Doença identificada ou suspeita', 'texto', { obrigatorio: true }));
    if (sub !== 'DOENCA') {
      l.push(c_('periodo_carencia_dias', 'Carência (dias)', 'inteiro', { min: 0, max: 3650, ajuda: 'Dias em que o animal não pode ser abatido. Em branco, vale a carência padrão do produto do cadastro (a revisão mostra os dias e o último dia); o sistema registra e alerta, não prescreve.' }));
      l.push(c_('data_proxima_aplicacao', 'Próxima aplicação', 'data', { ajuda: 'Vazio = pelo protocolo (a cada N dias), quando houver.' }));
    }
    l.push(c_('veterinario', 'Veterinário', 'texto'));
    l = l.concat(camposCustoPago_());
    l.push(c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }));
    l.push(c_('responsible', sub === 'DOENCA' || sub === 'EXAME' ? 'Responsável' : 'Quem aplicou', 'texto'));
    l.push(c_('notes', 'Observações', 'texto'));
    return l;
  }
  function camposAnimalSanidade_(sub) {
    var l = [a_('animal_id', 'Animal', 'ref:ANIMAIS', { obrigatorio: true })];
    if (sub !== 'DOENCA') l.push(a_('dose', 'Dose deste animal', 'decimal', { casas: 4, min: 0.0001, ajuda: 'Vazio = a dose do lançamento (por cabeça) ou a calculada pelo peso atual (por peso).' }));
    if (sub === 'EXAME') l.push(a_('resultado_exame', 'Resultado do exame', 'texto', { ajuda: 'O resultado que chega depois entra pela correção do lançamento, que preserva a data da coleta.' }));
    l.push(a_('observacoes', 'Observações deste animal', 'texto'));
    return l;
  }
  /**
   * ESTOQUE (04, seção 4.7; 03a, seções 4.6 e 4.7; 07, seção 5; desenho-base 16.9): entrada (compra de insumo do cadastro:
   * sempre um lançamento de compra de insumos, com parcelas, e o movimento de entrada só com o estoque controlado) e acerto
   * do saldo (contagem, perda ou vencimento; só com o estoque controlado). Sem animais.
   */
  var MOTIVOS_AJUSTE_ESTOQUE = ['CONTAGEM', 'PERDA', 'VENCIMENTO'];
  function camposEstoque_(sub) {
    var l;
    if (sub === 'ENTRADA') {
      l = [
        c_('event_date', 'Data da compra', 'data', { obrigatorio: true, default: 'HOJE' }),
        c_('product_id', 'Produto', 'ref:PRODUTOS', { obrigatorio: true }),
        c_('qtd_apresentacao', 'Embalagens compradas', 'decimal', { casas: 4, min: 0.0001, ajuda: 'Ex.: 2 frascos. O sistema converte pela quantidade por embalagem do cadastro.' }),
        c_('quantidade', 'Quantidade na unidade do produto', 'decimal', { casas: 4, min: 0.0001, ajuda: 'Doses, mL ou g. Vazio = embalagens × quantidade por embalagem.' }),
        c_('valor', 'Valor da compra', 'dinheiro', { obrigatorio: true, min: 0.01, ajuda: 'O que foi pago pelo insumo: sai do caixa e não é custo ainda; vira custo quando o insumo é aplicado.' }),
        c_('partner_id', 'Fornecedor', 'ref:PARCEIROS'),
        c_('lote', 'Lote', 'texto', { ajuda: 'Só no produto com o controle de estoque ligado: o lote fica no movimento do estoque.' }),
        c_('validade', 'Validade do lote', 'data', { ajuda: 'Só no produto com o controle de estoque ligado.' }),
        c_('documento', 'Nota fiscal', 'texto'),
        c_('vencimento', 'Vencimento', 'data', { ajuda: 'Vazio = à vista, na data da compra. Em mais de uma vez, é o vencimento da primeira parcela.' }),
        c_('parcelas_qtd', 'Em quantas vezes', 'inteiro', { min: 1, max: 120, ajuda: 'Vazio = uma vez. Com mais de uma, as parcelas vencem de mês em mês, em partes iguais.' }),
        c_('forma_pagamento', 'Forma de pagamento', 'lista', { lista: 'FORMA_PAGAMENTO' }),
      ];
    } else {
      l = [
        c_('event_date', 'Data do acerto', 'data', { obrigatorio: true, default: 'HOJE' }),
        c_('product_id', 'Produto', 'ref:PRODUTOS', { obrigatorio: true }),
        c_('motivo_ajuste', 'Por que acertar', 'lista', { obrigatorio: true, opcoes: MOTIVOS_AJUSTE_ESTOQUE }),
        c_('saldo_contado', 'Quanto há de fato (contagem)', 'decimal', { casas: 4, min: 0, visivel_se: quando_('motivo_ajuste', ['CONTAGEM']), obrigatorio_se: quando_('motivo_ajuste', ['CONTAGEM']), ajuda: 'O que foi contado na data, na unidade do produto. O sistema lança a diferença para o saldo dele.' }),
        c_('quantidade', 'Quanto se perdeu', 'decimal', { casas: 4, min: 0.0001, visivel_se: quando_('motivo_ajuste', ['PERDA', 'VENCIMENTO']), obrigatorio_se: quando_('motivo_ajuste', ['PERDA', 'VENCIMENTO']), ajuda: 'Na unidade do produto: sai do estoque.' }),
        c_('lote', 'Lote', 'texto'),
        c_('validade', 'Validade do lote', 'data'),
      ];
    }
    l.push(c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }));
    l.push(c_('responsible', 'Responsável', 'texto'));
    l.push(c_('notes', 'Observações', 'texto'));
    return l;
  }
  /**
   * REPRODUCAO (04, seção 4.5; 03b, seções 7, 16.5 e 16.14; 05, seção 2.9; PR-07): exposição (o lote de fêmeas posto com
   * os touros, a campo, com ou sem estação: os machos da lista são os touros), cobertura datada (com o touro), inseminação
   * (com o touro do sêmen, a partida e o inseminador), diagnóstico de gestação (o resultado de cada fêmea, no tronco) e
   * aborto. Cada fêmea tem uma linha REPRODUCAO; a situação reprodutiva é projeção, nunca pré-condição (RN-065). A
   * despesa (sêmen, veterinário, hormônios) é opcional.
   */
  var RESULTADOS_DIAGNOSTICO = ['POSITIVO', 'NEGATIVO', 'INCONCLUSIVO'];
  var METODOS_REPRODUCAO = { COBERTURA: ['MONTA_NATURAL', 'MONTA_CONTROLADA'], INSEMINACAO: ['IA', 'IATF'], DIAGNOSTICO_GESTACAO: ['PALPACAO', 'ULTRASSOM', 'OBSERVACAO', 'INFORMADO'] };
  var GESTACAO_MAX_DIAS = 330;
  function camposReproducao_(sub) {
    var rotuloData = { EXPOSICAO: 'Início da exposição (touro com as fêmeas)', COBERTURA: 'Data da cobertura', INSEMINACAO: 'Data da inseminação', DIAGNOSTICO_GESTACAO: 'Data do diagnóstico', ABORTO: 'Data do aborto (ou de quando foi notado)' }[sub];
    var l = [c_('event_date', rotuloData, 'data', { obrigatorio: true, default: 'HOJE' })];
    if (sub === 'EXPOSICAO') l.push(c_('data_fim', 'Retirada dos touros', 'data', { ajuda: 'Vazio = até o fim da estação de monta. Os touros do lote vão na lista de animais, junto com as fêmeas.' }));
    if (sub === 'COBERTURA' || sub === 'INSEMINACAO') {
      l.push(c_('touro_id', sub === 'INSEMINACAO' ? 'Touro do sêmen' : 'Touro', 'ref:ANIMAIS', { ajuda: sub === 'INSEMINACAO' ? 'O touro do sêmen: cadastre-o como animal de fora do rebanho, se não for da fazenda.' : 'O touro que cobriu: do rebanho, ou de fora (cadastro de referência).' }));
    }
    if (sub === 'INSEMINACAO') l.push(c_('semen_identificacao', 'Partida ou palheta do sêmen', 'texto'));
    if (METODOS_REPRODUCAO[sub]) l.push(c_('metodo', sub === 'DIAGNOSTICO_GESTACAO' ? 'Como foi o diagnóstico' : sub === 'INSEMINACAO' ? 'Tipo de inseminação' : 'Como foi a cobertura', 'lista', { opcoes: METODOS_REPRODUCAO[sub] }));
    if (sub !== 'ABORTO') l.push(c_('estacao_id', 'Estação de monta', 'ref:ESTACOES_MONTA', { ajuda: 'A estação a que o registro pertence: é ela que define as fêmeas expostas dos indicadores. Vazio = sem estação (touro o ano todo).' }));
    l = l.concat(camposCustoPago_('Despesa (opcional)', 'Sêmen, veterinário, hormônios: vira custo dos animais deste lançamento, com o pagamento a seguir.'));
    l.push(c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }));
    l.push(c_('responsible', sub === 'INSEMINACAO' ? 'Inseminador' : sub === 'DIAGNOSTICO_GESTACAO' ? 'Quem diagnosticou (veterinário)' : 'Responsável', 'texto'));
    l.push(c_('notes', 'Observações', 'texto'));
    return l;
  }
  function camposAnimalReproducao_(sub) {
    var l = [a_('animal_id', sub === 'EXPOSICAO' ? 'Animal (fêmea ou touro do lote)' : 'Fêmea', 'ref:ANIMAIS', { obrigatorio: true })];
    var positivo = quando_('resultado', ['POSITIVO']);
    if (sub === 'DIAGNOSTICO_GESTACAO') {
      l.push(a_('resultado', 'Resultado', 'lista', { obrigatorio: true, opcoes: RESULTADOS_DIAGNOSTICO, ajuda: 'Prenhe (positivo), vazia (negativo) ou duvidoso (inconclusivo: a situação não muda).' }));
      l.push(a_('idade_gestacional_dias', 'Idade da gestação (dias)', 'inteiro', { min: 1, max: GESTACAO_MAX_DIAS, visivel_se: positivo, ajuda: 'Opcional: com ela, a previsão de parto fica mais precisa.' }));
      l.push(a_('data_prevista_parto', 'Previsão de parto informada', 'data', { visivel_se: positivo, ajuda: 'Só se o veterinário informou a data. Vazio = o sistema calcula, como estimativa.' }));
    }
    if (sub === 'ABORTO') l.push(a_('idade_gestacional_dias', 'Idade da gestação perdida (dias)', 'inteiro', { min: 1, max: GESTACAO_MAX_DIAS }));
    l.push(a_('observacoes', 'Observações deste animal', 'texto'));
    return l;
  }
  /**
   * DESMAMA (04, seção 4.5; 03b, seções 3.4, 7.2 e 16.14): o fim da cria ao pé. Cada bezerro é o sujeito (efeito 0; com o
   * pasto de destino, a linha vale como movimento); a mãe, quando conhecida e no rebanho na data, tem a linha MATRIZ e o
   * registro DESMAMA; o peso à desmama, quando informado, é uma pesagem (tipo DESMAMA). A categoria do bezerro continua
   * automática, pelo cadastro de categorias (idade, sexo e condição).
   */
  var CAMPOS_DESMAMA = [
    c_('event_date', 'Data da desmama', 'data', { obrigatorio: true, default: 'HOJE' }),
    c_('pasto_destino_id', 'Pasto para onde vão os bezerros', 'ref:PASTOS', { ajuda: 'Vazio = os bezerros ficam no pasto em que estão.' }),
    c_('metodo_pesagem', 'Como foram pesados', 'lista', { opcoes: METODOS_PESAGEM, default: 'BALANCA', ajuda: 'Vale para os pesos informados abaixo.' }),
    c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }),
    c_('responsible', 'Responsável', 'texto'),
    c_('notes', 'Observações', 'texto'),
  ];
  var CAMPOS_ANIMAL_DESMAMA = [
    a_('animal_id', 'Bezerro (cria ao pé)', 'ref:ANIMAIS', { obrigatorio: true }),
    a_('peso', 'Peso à desmama', 'decimal', { unidade: 'kg', min: 0.1, max: PESO_MAX_KG, casas: 1, ajuda: 'Opcional: vira a pesagem da desmama.' }),
    a_('observacoes', 'Observações deste animal', 'texto'),
  ];
  /** CASTRACAO (04, seção 4.5; 03b, seção 2.6): machos inteiros; o método vai no payload; a categoria muda pelo cadastro. */
  var CAMPOS_CASTRACAO = [
    c_('event_date', 'Data da castração', 'data', { obrigatorio: true, default: 'HOJE' }),
    c_('metodo', 'Método', 'texto', { ajuda: 'Ex.: cirúrgica, burdizzo, elástico.' }),
  ].concat(camposCustoPago_('Despesa (opcional)', 'Veterinário, material: vira custo dos animais castrados, com o pagamento a seguir.'), [
    c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }),
    c_('responsible', 'Responsável', 'texto'),
    c_('notes', 'Observações', 'texto'),
  ]);
  /** OCORRENCIA (04, seção 4.5; 03b, seção 2.6): registro livre de um fato de manejo, com o tipo em lista aberta; sem efeito no inventário. */
  var CAMPOS_OCORRENCIA = [
    c_('event_date', 'Data', 'data', { obrigatorio: true, default: 'HOJE' }),
    c_('tipo_ocorrencia', 'Tipo de ocorrência', 'lista', { obrigatorio: true, lista: 'TIPO_OCORRENCIA' }),
    c_('description', 'O que aconteceu', 'texto', { obrigatorio: true }),
  ].concat(camposCustoPago_('Despesa (opcional)', 'O que foi pago por este manejo: vira custo dos animais do lançamento, com o pagamento a seguir.'), [
    c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }),
    c_('responsible', 'Responsável', 'texto'),
    c_('notes', 'Observações', 'texto'),
  ]);
  var CAMPOS_ANIMAL_SIMPLES = [
    a_('animal_id', 'Animal', 'ref:ANIMAIS', { obrigatorio: true }),
    a_('observacoes', 'Observações deste animal', 'texto'),
  ];

  /** Abas de insumos e sanidade que os comandos de sanidade, de estoque, de venda e de estorno leem. */
  var LEITURAS_INSUMOS = ['PRODUTOS', 'MOVIMENTOS_ESTOQUE', 'SANIDADE', 'PROTOCOLOS_SANITARIOS'];

  /**
   * LANCAMENTO_FINANCEIRO avulso (Fase 4, E4.1; 03b, seções 10.2, 10.3 e 16.6; 04, seção 4.9; 07, seções 1.1 e 1.3): receita
   * ou despesa fora de evento de animal — combustível, salário, energia, arrendamento de pasto, imposto, venda de um bem,
   * aporte, retirada, empréstimo. A data é a competência (o dia a que o fato pertence no resultado); o período, quando há, só
   * em custeio e outra receita, começando na competência ou depois dela; o pagamento vai nas parcelas (uma ou mais), que
   * nascem em aberto ou já pagas ("Já pago em", nunca antes da competência). Vínculos: parceiro, pasto (o custo do pasto:
   * conta inteiro para ele), categoria de animais, propriedade e o lançamento de negócio a que se refere. Nesta etapa não
   * há rateio entre animais: a compra de animais, a receita de venda, a despesa de venda e a compra de insumos nascem nos
   * próprios eventos (a natureza que exige 100% de rateio não é aceita aqui: CONTRATOS, seção 56).
   */
  var NATUREZAS_AVULSO = ['CUSTEIO', 'OUTRA_RECEITA', 'NAO_OPERACIONAL'];
  var CAMPOS_LANCAMENTO = [
    c_('event_date', 'Data (competência)', 'data', { obrigatorio: true, default: 'HOJE', ajuda: 'O dia a que a receita ou a despesa pertence no resultado. Quando foi ou será pago vai nas parcelas.' }),
    c_('conta_id', 'Conta', 'ref:PLANO_CONTAS', { obrigatorio: true, naturezas: NATUREZAS_AVULSO, ajuda: 'Compra e venda de animais, despesas de venda e compra de insumos são lançadas nos próprios registros (comprar, vender, entrada de estoque).' }),
    c_('valor', 'Valor', 'dinheiro', { obrigatorio: true, min: 0.01 }),
    c_('descricao', 'Descrição', 'texto', { ajuda: 'Ex.: diesel do trator, salário de março, conta de luz.' }),
    c_('partner_id', 'Parceiro (quem recebe ou quem paga)', 'ref:PARCEIROS'),
    c_('competencia_inicio', 'Período: de (opcional)', 'data', { ajuda: 'Despesa ou receita de um período (arrendamento, salário, seguro): o resultado de cada mês recebe a parte dos dias dele. Começa na data do lançamento ou depois.' }),
    c_('competencia_fim', 'Período: até', 'data', { visivel_se: quando_('competencia_inicio', true), obrigatorio_se: quando_('competencia_inicio', true) }),
    c_('quantidade', 'Quantidade (opcional)', 'decimal', { casas: 4, min: 0.0001, ajuda: 'Só para mostrar o preço por unidade: litros, horas, cabeças × meses do arrendamento.' }),
    c_('pasture_id', 'Pasto', 'ref:PASTOS', { ajuda: 'Custo de um pasto (arrendamento, cerca, adubo): conta inteiro para o pasto. Obrigatório no arrendamento de pasto.' }),
    c_('categoria_animal_id', 'Categoria de animais', 'ref:CATEGORIAS', { ajuda: 'Opcional: o gasto é de uma categoria (sal para os bezerros).' }),
    c_('ref_event_id', 'Refere-se ao registro', 'ref:EVENTOS', { ajuda: 'Opcional: o registro de negócio a que este lançamento se refere (só informa; não muda o registro).' }),
    c_('documento', 'Nota, recibo ou contrato', 'texto'),
    c_('property_id', 'Propriedade', 'ref:PROPRIEDADES', { default: { de: 'CONFIGURACOES.propriedade_padrao_id' } }),
    c_('responsible', 'Responsável', 'texto'),
    c_('notes', 'Observações', 'texto'),
  ];
  /** As parcelas do avulso: as do formulário de compra e venda mais "Já pago em" (a parcela nasce paga nessa data). */
  var CAMPOS_PARCELA_AVULSO = CAMPOS_PARCELA.concat([
    a_('pago_em', 'Já pago em', 'data', { ajuda: 'Só se já foi pago (ou recebido): a parcela nasce paga nessa data, pelo valor dela. Vazio = em aberto (a baixa vem depois, em "A pagar e a receber").' }),
  ]);

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
    VENDA: {
      frequente: true, selecao_animais: 'VARIOS', filtro_elegiveis: { situacao: 'ATIVO', pasto: '$pasto_origem_id' },
      modo_entrada: 'FORM', revisao: 'SERVIDOR', critico: true,
      // SANIDADE: a carência de cada animal na data (RN-072).
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO, LEITURAS_INSUMOS),
      campos: CAMPOS_VENDA,
      campos_animal: CAMPOS_ANIMAL_VENDA,
      componentes: ['seletor_animais', 'bloco_negociacao', 'bloco_parcelas'],
      grupos_repetiveis: { parcelas: CAMPOS_PARCELA, deducoes: CAMPOS_DEDUCAO_VENDA },
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
        RECLASSIFICACAO: {
          rotulo: 'Mudar a categoria', fase: 2,
          campos_animal: [
            a_('animal_id', 'Animal', 'ref:ANIMAIS', { obrigatorio: true }),
            a_('categoria_manual_id', 'Categoria', 'ref:CATEGORIAS', { ajuda: 'Vazio = volta à categoria automática (pela idade, sexo e condição).' }),
          ],
        },
        DIVERGENCIA_CONTAGEM: {
          rotulo: 'Animal não encontrado na contagem', fase: 2, critico: true,
          campos_animal: [
            a_('animal_id', 'Animal', 'ref:ANIMAIS', { obrigatorio: true }),
            a_('observacoes', 'Em que contagem faltou', 'texto', { ajuda: 'Vazio = o motivo do lançamento. Se o animal reaparecer, estorne esta baixa.' }),
          ],
        },
      },
    },
    IDENTIFICACAO: {
      frequente: false, selecao_animais: 'VARIOS', filtro_elegiveis: { situacao: 'ATIVO' }, modo_entrada: 'CURRAL', revisao: 'LOCAL', critico: false,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: CAMPOS_IDENTIFICACAO,
      componentes: ['seletor_animais'],
      grupos_repetiveis: {},
      subtipos: {
        PRIMEIRA_IDENTIFICACAO: { rotulo: 'Pôr o primeiro brinco (ou outra identificação)', fase: 2, campos_animal: camposIdentificacao_('PRIMEIRA_IDENTIFICACAO') },
        SUBSTITUICAO: { rotulo: 'Trocar o brinco (perdido, danificado, renumeração)', fase: 2, campos_animal: camposIdentificacao_('SUBSTITUICAO') },
        REMOCAO: { rotulo: 'Tirar o brinco sem pôr outro', fase: 2, campos_animal: camposIdentificacao_('REMOCAO') },
      },
    },
    MARCACAO: {
      frequente: false, selecao_animais: 'VARIOS', filtro_elegiveis: { situacao: 'ATIVO' }, modo_entrada: 'FORM', revisao: 'LOCAL', critico: false,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: CAMPOS_MARCACAO,
      componentes: ['seletor_animais'],
      grupos_repetiveis: {},
      subtipos: {
        DESCARTE: {
          rotulo: 'Para descarte', fase: 2,
          // Campo de cabeçalho só deste subtipo (camposEvento(tipo, subtipo)): o motivo, quando se marca.
          campos: [c_('motivo_descarte', 'Motivo do descarte', 'lista', { lista: 'MOTIVO_DESCARTE', visivel_se: quando_('acao', ['MARCAR']) })],
          campos_animal: CAMPOS_ANIMAL_MARCACAO,
        },
        NAO_LOCALIZADO: { rotulo: 'Não localizado', fase: 2, campos_animal: CAMPOS_ANIMAL_MARCACAO },
      },
    },
    PESAGEM: {
      frequente: true, selecao_animais: 'VARIOS', filtro_elegiveis: { situacao: 'ATIVO' }, modo_entrada: 'CURRAL', revisao: 'LOCAL', critico: false,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: CAMPOS_PESAGEM,
      campos_animal: CAMPOS_ANIMAL_PESAGEM,
      componentes: ['seletor_animais'],
      grupos_repetiveis: {},
    },
    SANIDADE: {
      frequente: true, selecao_animais: 'VARIOS', filtro_elegiveis: { situacao: 'ATIVO' }, modo_entrada: 'FORM', revisao: 'SERVIDOR', critico: false,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO, LEITURAS_INSUMOS),
      campos: [],
      componentes: ['seletor_animais'],
      grupos_repetiveis: {},
      subtipos: {
        VACINACAO: { rotulo: 'Vacinação', fase: 3, campos: camposSanidade_('VACINACAO'), campos_animal: camposAnimalSanidade_('VACINACAO') },
        VERMIFUGACAO: { rotulo: 'Vermifugação (controle de parasitas)', fase: 3, campos: camposSanidade_('VERMIFUGACAO'), campos_animal: camposAnimalSanidade_('VERMIFUGACAO') },
        MEDICACAO: { rotulo: 'Medicação (antibiótico, anti-inflamatório)', fase: 3, campos: camposSanidade_('MEDICACAO'), campos_animal: camposAnimalSanidade_('MEDICACAO') },
        TRATAMENTO: { rotulo: 'Tratamento (curativo, cirurgia, casqueamento)', fase: 3, campos: camposSanidade_('TRATAMENTO'), campos_animal: camposAnimalSanidade_('TRATAMENTO') },
        EXAME: { rotulo: 'Exame', fase: 3, campos: camposSanidade_('EXAME'), campos_animal: camposAnimalSanidade_('EXAME') },
        DOENCA: { rotulo: 'Registro de doença', fase: 3, campos: camposSanidade_('DOENCA'), campos_animal: camposAnimalSanidade_('DOENCA') },
      },
    },
    ESTOQUE: {
      frequente: false, selecao_animais: 'NENHUM', filtro_elegiveis: null, modo_entrada: 'FORM', revisao: 'SERVIDOR', critico: false,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO, LEITURAS_INSUMOS),
      campos: [],
      componentes: [],
      grupos_repetiveis: {},
      subtipos: {
        ENTRADA: { rotulo: 'Entrada de insumo (compra)', fase: 3, campos: camposEstoque_('ENTRADA') },
        AJUSTE: { rotulo: 'Acertar o estoque (contagem, perda, vencimento)', fase: 3, campos: camposEstoque_('AJUSTE') },
      },
    },
    REPRODUCAO: {
      frequente: true, selecao_animais: 'VARIOS', filtro_elegiveis: { situacao: 'ATIVO' }, modo_entrada: 'FORM', revisao: 'LOCAL', critico: false,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO, ['ESTACOES_MONTA']),
      campos: [],
      componentes: ['seletor_animais'],
      grupos_repetiveis: {},
      subtipos: {
        EXPOSICAO: { rotulo: 'Exposição ao touro (monta a campo ou estação)', fase: 3, campos: camposReproducao_('EXPOSICAO'), campos_animal: camposAnimalReproducao_('EXPOSICAO') },
        COBERTURA: { rotulo: 'Cobertura (data e touro conhecidos)', fase: 3, campos: camposReproducao_('COBERTURA'), campos_animal: camposAnimalReproducao_('COBERTURA') },
        INSEMINACAO: { rotulo: 'Inseminação artificial', fase: 3, campos: camposReproducao_('INSEMINACAO'), campos_animal: camposAnimalReproducao_('INSEMINACAO') },
        DIAGNOSTICO_GESTACAO: { rotulo: 'Diagnóstico de gestação', fase: 3, campos: camposReproducao_('DIAGNOSTICO_GESTACAO'), campos_animal: camposAnimalReproducao_('DIAGNOSTICO_GESTACAO') },
        ABORTO: { rotulo: 'Aborto (perda da gestação)', fase: 3, campos: camposReproducao_('ABORTO'), campos_animal: camposAnimalReproducao_('ABORTO') },
      },
    },
    DESMAMA: {
      frequente: false, selecao_animais: 'VARIOS', filtro_elegiveis: { situacao: 'ATIVO' }, modo_entrada: 'CURRAL', revisao: 'LOCAL', critico: false,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: CAMPOS_DESMAMA,
      campos_animal: CAMPOS_ANIMAL_DESMAMA,
      componentes: ['seletor_animais'],
      grupos_repetiveis: {},
    },
    CASTRACAO: {
      frequente: false, selecao_animais: 'VARIOS', filtro_elegiveis: { situacao: 'ATIVO', sexo: 'M' }, modo_entrada: 'FORM', revisao: 'LOCAL', critico: false,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: CAMPOS_CASTRACAO,
      campos_animal: CAMPOS_ANIMAL_SIMPLES,
      componentes: ['seletor_animais'],
      grupos_repetiveis: {},
    },
    OCORRENCIA: {
      frequente: false, selecao_animais: 'VARIOS', filtro_elegiveis: { situacao: 'ATIVO' }, modo_entrada: 'FORM', revisao: 'LOCAL', critico: false,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: CAMPOS_OCORRENCIA,
      campos_animal: CAMPOS_ANIMAL_SIMPLES,
      componentes: ['seletor_animais'],
      grupos_repetiveis: {},
    },
    LANCAMENTO_FINANCEIRO: {
      frequente: true, selecao_animais: 'NENHUM', filtro_elegiveis: null, modo_entrada: 'FORM', revisao: 'SERVIDOR', critico: false,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO),
      campos: CAMPOS_LANCAMENTO,
      componentes: ['bloco_parcelas'],
      grupos_repetiveis: { parcelas: CAMPOS_PARCELA_AVULSO },
    },
    ESTORNO: {
      frequente: false, selecao_animais: 'NENHUM', filtro_elegiveis: null, modo_entrada: 'FORM', revisao: 'SERVIDOR', critico: true,
      reads: LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO, LEITURAS_INSUMOS),
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
  /** O lançamento como substantivo com artigo ("a marcação para descarte"); tipo desconhecido → "o lançamento". */
  function nomeEvento(tipoEvento, subtipo) {
    if (!vazio_(subtipo) && NOME_SUBTIPO[tipoEvento + '.' + subtipo]) return NOME_SUBTIPO[tipoEvento + '.' + subtipo];
    return NOME_TIPO[tipoEvento] || 'o lançamento';
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
  function subtipoPronto_(sub, f, semAnimais) {
    if (!sub || sub.fase > f) return false;
    // O tipo sem animais (ESTOQUE) fica pronto com os campos de cabeçalho do subtipo; os demais, com os campos por animal.
    return semAnimais ? Array.isArray(sub.campos) && sub.campos.length > 0 : Array.isArray(sub.campos_animal) && sub.campos_animal.length > 0;
  }
  /** Tipo (e subtipo) entregue na fase dada (padrão: a corrente) e com definição de campos. */
  function ativo(nome, subtipo, fase) {
    var f = fase === undefined || fase === null ? FASE_ATUAL : fase;
    if (!existe(nome) || RESUMO[nome].fase > f || !DEFINICOES[nome]) return false;
    var subs = DEFINICOES[nome].subtipos;
    var semAnimais = DEFINICOES[nome].selecao_animais === 'NENHUM';
    if (!subs) return vazio_(subtipo);
    if (vazio_(subtipo)) return Object.keys(subs).some(function (s) { return subtipoPronto_(subs[s], f, semAnimais); });
    return subtipoPronto_(subs[subtipo], f, semAnimais);
  }
  function tiposAtivos(fase) {
    return nomes().filter(function (n) { return ativo(n, null, fase); });
  }
  /** Módulos entregues até a fase dada (padrão: a corrente): da fase e com a tela entregue (`tela`). */
  function modulosAtivos(fase) {
    var f = fase === undefined || fase === null ? FASE_ATUAL : fase;
    return MODULOS.filter(function (m) { return m.fase <= f && !!m.tela; }).map(function (m) { return Utils.clonar(m); });
  }
  /** Todos os módulos do desenho (os 10 do menu e a importação), entregues ou não, na ordem. */
  function modulos() {
    return MODULOS.map(function (m) { return Utils.clonar(m); });
  }
  /** Um módulo do desenho pelo id (entregue ou não), ou null: rótulo, ordem, fase, tela. */
  function modulo(id) {
    var m = MODULOS.filter(function (x) { return x.id === id; })[0];
    return m ? Utils.clonar(m) : null;
  }
  /** Campos por animal do tipo/subtipo. */
  function camposAnimal(nome, subtipo) {
    var d = DEFINICOES[nome];
    if (!d) return [];
    if (d.subtipos) return (d.subtipos[subtipo] && d.subtipos[subtipo].campos_animal) || [];
    return d.campos_animal || [];
  }
  /** Campos de cabeçalho do tipo; com subtipo, mais os do subtipo (`subtipos[S].campos`, ex.: o motivo do descarte da marcação). */
  function camposEvento(nome, subtipo) {
    var d = DEFINICOES[nome];
    var base = (d && d.campos) || [];
    var sub = d && d.subtipos && !vazio_(subtipo) ? d.subtipos[subtipo] : null;
    return sub && Array.isArray(sub.campos) ? base.concat(sub.campos) : base;
  }
  /** Campos de um grupo repetível do tipo (ex.: as crias do NASCIMENTO); grupo inexistente → lista vazia. */
  function camposGrupo(nome, grupo) {
    var g = DEFINICOES[nome] && DEFINICOES[nome].grupos_repetiveis;
    return (g && g[grupo]) || [];
  }
  /** Abas que o comando do tipo lê; sem tipo conhecido, as de todos os tipos (a correção que não diz o tipo). */
  function leituras(nome) {
    if (DEFINICOES[nome] && DEFINICOES[nome].reads) return DEFINICOES[nome].reads;
    var todas = LEITURAS_MOTOR.concat(LEITURAS_FINANCEIRO);
    Object.keys(DEFINICOES).forEach(function (t) { (DEFINICOES[t].reads || []).forEach(function (a) { if (todas.indexOf(a) < 0) todas.push(a); }); });
    return todas;
  }
  /** O catálogo dos tipos ativos, pronto para o cliente (cópia sem funções, só dados). */
  function serializar(fase) {
    var f = fase === undefined || fase === null ? FASE_ATUAL : fase;
    var tipos = tiposAtivos(f).map(function (n) {
      var t = Utils.clonar(tipo(n));
      t.nome = nomeEvento(n, null);
      if (t.subtipos) {
        var subs = {};
        Object.keys(t.subtipos).forEach(function (s) {
          if (!subtipoPronto_(t.subtipos[s], f, t.selecao_animais === 'NENHUM')) return;
          subs[s] = t.subtipos[s];
          subs[s].nome = nomeEvento(n, s);
        });
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
   * referência e regras de negócio são do EventService). opcoes: {listas: {LISTA: [códigos ativos]}, desativados: {LISTA: {código: rótulo}}, rotuloQuem}.
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
      if (ok) return null;
      // Item desativado: a mensagem diz o nome dele (o código é interno).
      var desativado = d.lista && o.desativados && o.desativados[d.lista] ? o.desativados[d.lista][x] : null;
      return { codigo: 'VALOR_FORA_DA_LISTA', mensagem: desativado ? '"' + desativado + '" foi desativado nas listas e não pode ser escolhido em "' + d.rotulo + '".' : '"' + x + '" não é uma opção de "' + d.rotulo + '".' };
    }
    if (typeof x !== 'number' || !isFinite(x)) return { codigo: 'TIPO_INVALIDO', mensagem: '"' + d.rotulo + '" precisa ser um número.' };
    if ((t === 'inteiro' || t === 'dinheiro') && Math.floor(x) !== x) {
      return { codigo: 'TIPO_INVALIDO', mensagem: '"' + d.rotulo + '" precisa ser um número inteiro' + (t === 'dinheiro' ? ' de centavos.' : '.') };
    }
    if (t === 'decimal' && d.casas !== undefined && Utils.casasDecimais(x) > d.casas) {
      return { codigo: 'FORMATO_INVALIDO', mensagem: '"' + d.rotulo + '" aceita ' + (d.casas === 0 ? 'só número inteiro.' : 'no máximo ' + d.casas + (d.casas === 1 ? ' casa decimal.' : ' casas decimais.')) };
    }
    var n = t === 'dinheiro' ? x / 100 : x;
    if ((d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max)) {
      var faixa = d.max !== undefined ? 'entre ' + limite_(d, d.min) + ' e ' + limite_(d, d.max) : 'a partir de ' + limite_(d, d.min);
      return { codigo: 'VALOR_FORA_DA_FAIXA', mensagem: '"' + d.rotulo + '" precisa estar ' + faixa + (d.unidade && t !== 'dinheiro' ? ' ' + d.unidade : '') + '.' };
    }
    return null;
  }
  /** Limite da faixa na mensagem, no formato brasileiro: dinheiro em reais (R$ 0,01), número com vírgula (0,1). */
  function limite_(d, v) {
    return d.tipo === 'dinheiro' ? Utils.formatarReais(Math.round(v * 100)) : Utils.formatarNumero(v);
  }

  return {
    FASE_ATUAL: FASE_ATUAL,
    TIPOS_CAMPO: TIPOS_CAMPO,
    TIPOS_IDENTIFICACAO: TIPOS_IDENTIFICACAO,
    MOMENTOS_PESAGEM: MOMENTOS_PESAGEM,
    MODOS_DOSE: MODOS_DOSE,
    MOTIVOS_AJUSTE_ESTOQUE: MOTIVOS_AJUSTE_ESTOQUE,
    NATUREZAS_AVULSO: NATUREZAS_AVULSO,
    RESULTADOS_DIAGNOSTICO: RESULTADOS_DIAGNOSTICO,
    METODOS_REPRODUCAO: METODOS_REPRODUCAO,
    LEITURAS_INSUMOS: LEITURAS_INSUMOS,
    PESO_MAX_KG: PESO_MAX_KG,
    CAMPOS_CORRIGIVEIS: CAMPOS_CORRIGIVEIS,
    nomes: nomes,
    nomeEvento: nomeEvento,
    existe: existe,
    tipo: tipo,
    subtipos: subtipos,
    ativo: ativo,
    tiposAtivos: tiposAtivos,
    modulosAtivos: modulosAtivos,
    modulos: modulos,
    modulo: modulo,
    camposEvento: camposEvento,
    camposAnimal: camposAnimal,
    camposGrupo: camposGrupo,
    leituras: leituras,
    serializar: serializar,
    validarCampos: validarCampos,
  };
})();
