'use strict';
/** Validation: AppError, validadores por tipo de coluna, registro contra a aba, teto de célula e coletor. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');

const gas = createGas();
const { Validation: V, Schema: S } = gas.G;
const plano = (v) => JSON.parse(JSON.stringify(v));
const ID = '3f2b8c1e-7a4d-4e9b-9c55-0d6a1f2e8b47';
const ID2 = '00000000-0000-4000-8000-0000000000aa';
const TS = '2026-11-13T14:00:00.000Z';
const codigos = (detalhes) => plano(detalhes).map((d) => d.campo + ':' + d.codigo).sort();
const prob = (tabela, coluna, valor, opcoes) => { const p = V.validarValor(S.coluna(tabela, coluna), valor, opcoes); return p ? p.codigo : null; };

// ------------------------------------------------------------------ AppError ----
test('AppError: código, mensagem e details[] no formato de 01 seção 3.3', () => {
  const e = V.erro('VALIDATION', '1 de 80 animais com problema', [{ codigo: 'DATA_ANTERIOR_AO_NASCIMENTO', brinco: '0612', campo: 'event_date', mensagem: 'x', conflito: { tipo: 'NASCIMENTO', data: '2026-11-11' } }]);
  assert.equal(e.name, 'AppError');
  assert.equal(e.code, 'VALIDATION');
  assert.equal(e.message, '1 de 80 animais com problema');
  assert.deepEqual(plano(e.details), [{ codigo: 'DATA_ANTERIOR_AO_NASCIMENTO', animal_id: null, brinco: '0612', campo: 'event_date', mensagem: 'x', conflito: { event_id: null, tipo: 'NASCIMENTO', subtipo: null, data: '2026-11-11', nome: null } }]);
  assert.equal(typeof e.stack, 'string');
  assert.equal(gas.run('(function (e) { return e instanceof Error && e instanceof Validation.AppError; })')(e), true);
  assert.equal(gas.run('(function () { try { throw Validation.erro("LOCKED", "ocupado"); } catch (e) { return e.code + ":" + e.message + ":" + e.details.length; } })')(), 'LOCKED:ocupado:0');
  assert.equal(V.AppError('CONFIG', 'sem new').code, 'CONFIG', 'funciona com e sem new');
  assert.deepEqual(plano(V.erro('NOT_FOUND', 'x', null).details), []);
  assert.deepEqual(plano(V.detalhe({ campo: 'nome' })), { codigo: null, animal_id: null, brinco: null, campo: 'nome', mensagem: null, conflito: null });
  assert.deepEqual(plano(V.detalhe(null)), { codigo: null, animal_id: null, brinco: null, campo: null, mensagem: null, conflito: null });
});

test('AppError: os nove códigos da API e nenhum outro', () => {
  assert.deepEqual(plano(V.CODIGOS).sort(), plano(S.VOCABULARIOS.CODIGO_ERRO).sort());
  for (const c of ['VALIDATION', 'CONFLICT', 'NEEDS_CONFIRMATION', 'IDEMPOTENCY_MISMATCH', 'LOCKED', 'DENIED', 'NOT_FOUND', 'CONFIG', 'INTERNAL']) assert.equal(V.erro(c, 'm').code, c);
  assert.throws(() => V.erro('ERRO_QUALQUER', 'm'), /código desconhecido/);
  assert.throws(() => V.erro(undefined, 'm'), /código desconhecido/);
});

test('AppError: reconhecimento e serialização para o envelope (exceção comum não vaza detalhe)', () => {
  const e = V.erro('CONFLICT', 'Os dados mudaram.', [{ campo: 'x' }]);
  assert.equal(V.ehAppError(e), true);
  assert.equal(V.ehAppError(new Error('x')), false);
  assert.equal(V.ehAppError({ name: 'AppError', code: 'INVENTADO' }), false);
  assert.equal(V.ehAppError(null), false);
  assert.deepEqual(plano(V.serializarErro(e)), { code: 'CONFLICT', message: 'Os dados mudaram.', details: [{ codigo: null, animal_id: null, brinco: null, campo: 'x', mensagem: null, conflito: null }] });
  const interno = plano(V.serializarErro(new TypeError("Cannot read properties of undefined (reading 'animal_id')")));
  assert.equal(interno.code, 'INTERNAL');
  assert.deepEqual(interno.details, []);
  assert.ok(!/undefined|animal_id|TypeError/.test(interno.message), 'texto genérico');
  assert.equal(plano(V.serializarErro('texto solto')).code, 'INTERNAL');
});

// ------------------------------------------------------------------ por tipo ----
test('validador por tipo: ID, TEXTO, DATA e TS', () => {
  assert.equal(prob('PASTOS', 'pasture_id', ID), null);
  assert.equal(prob('PASTOS', 'pasture_id', ID.toUpperCase()), 'FORMATO_INVALIDO', 'UUID em minúsculas');
  assert.equal(prob('PASTOS', 'pasture_id', 'abc'), 'FORMATO_INVALIDO');
  assert.equal(prob('PASTOS', 'pasture_id', 12), 'TIPO_INVALIDO');
  assert.equal(prob('PASTOS', 'nome', 'Maternidade'), null);
  assert.equal(prob('PASTOS', 'nome', '=10 arrobas acima do lote'), null, 'texto nunca é interpretado');
  assert.equal(prob('PASTOS', 'nome', 12), 'TIPO_INVALIDO');
  assert.equal(prob('ANIMAIS', 'brinco', '0012'), null);
  assert.equal(prob('EVENTOS', 'event_date', '2026-11-13'), null);
  assert.equal(prob('EVENTOS', 'event_date', '2026-02-30'), 'FORMATO_INVALIDO');
  assert.equal(prob('EVENTOS', 'event_date', '13/11/2026'), 'FORMATO_INVALIDO');
  assert.equal(prob('EVENTOS', 'event_date', gas.run('new Date(0)')), 'TIPO_INVALIDO', 'Date nunca é aceito');
  assert.equal(prob('EVENTOS', 'created_at', TS), null);
  assert.equal(prob('EVENTOS', 'created_at', '2026-11-13T14:00:00Z'), 'FORMATO_INVALIDO', 'milissegundos obrigatórios');
  assert.equal(prob('EVENTOS', 'created_at', '2026-11-13'), 'FORMATO_INVALIDO');
  assert.equal(prob('EVENTOS', 'created_at', 1794578400000), 'TIPO_INVALIDO');
});

test('validador por tipo: INT, DEC1, DEC4 e faixas do dicionário', () => {
  assert.equal(prob('EVENTOS', 'event_seq', 1), null);
  assert.equal(prob('EVENTOS', 'event_seq', 0), 'VALOR_FORA_DA_FAIXA', '≥ 1');
  assert.equal(prob('EVENTOS', 'event_seq', 1.5), 'FORMATO_INVALIDO');
  assert.equal(prob('EVENTOS', 'event_seq', '1'), 'TIPO_INVALIDO');
  assert.equal(prob('EVENTOS', 'event_seq', NaN), 'TIPO_INVALIDO');
  assert.equal(prob('PASTOS', 'capacidade_estimada_cabecas', 0), 'VALOR_FORA_DA_FAIXA', '> 0');
  assert.equal(prob('ANIMAIS', 'partos_previos', 0), null, '≥ 0');
  assert.equal(prob('ANIMAIS', 'partos_previos', -1), 'VALOR_FORA_DA_FAIXA');
  assert.equal(prob('PESAGENS', 'peso_kg', 387.5), null);
  assert.equal(prob('PESAGENS', 'peso_kg', 387), null);
  assert.equal(prob('PESAGENS', 'peso_kg', 387.46), 'FORMATO_INVALIDO', 'peso tem 1 casa');
  assert.equal(prob('PESAGENS', 'peso_kg', 0), 'VALOR_FORA_DA_FAIXA');
  assert.equal(prob('PESAGENS', 'peso_kg', -10), 'VALOR_FORA_DA_FAIXA');
  assert.equal(prob('PESAGENS', 'peso_kg', '387,5'), 'TIPO_INVALIDO');
  assert.equal(prob('PASTOS', 'area_hectares', 37.45), null);
  assert.equal(prob('PRODUTOS', 'dose_padrao_por_kg', 0.02), null);
  assert.equal(prob('PRODUTOS', 'dose_padrao_por_kg', 0.00002), 'FORMATO_INVALIDO', 'até 4 casas');
  assert.equal(prob('PRODUTOS', 'custo_unitario', 0.035), null, 'taxa unitária não é dinheiro');
  assert.equal(prob('COMPRAS', 'rendimento_carcaca_pct', 52.5), null);
  assert.equal(prob('COMPRAS', 'rendimento_carcaca_pct', 100), 'VALOR_FORA_DA_FAIXA', '0 < x < 100');
  assert.equal(prob('COMPRAS', 'rendimento_carcaca_pct', 0), 'VALOR_FORA_DA_FAIXA');
  assert.equal(prob('RATEIOS', 'base_total', 0), null, '≥ 0');
  assert.equal(prob('ALOCACOES_FINANCEIRAS', 'base_valor', 0), 'VALOR_FORA_DA_FAIXA', '> 0');
});

test('validador por tipo: DINHEIRO em centavos inteiros, BOOL booleano', () => {
  assert.equal(prob('PARCELAS', 'valor', 123456), null);
  assert.equal(prob('PARCELAS', 'valor', 1234.56), 'FORMATO_INVALIDO', 'reais com vírgula não são centavos');
  assert.equal(prob('PARCELAS', 'valor', 0), 'VALOR_FORA_DA_FAIXA', '> 0');
  assert.equal(prob('PARCELAS', 'valor', '100'), 'TIPO_INVALIDO');
  assert.equal(prob('PARCELAS', 'juros_multa', 0), null, '≥ 0');
  assert.equal(prob('PARCELAS', 'juros_multa', -1), 'VALOR_FORA_DA_FAIXA');
  assert.equal(prob('ANIMAIS', 'custo_aquisicao', 0), null, 'zero de verdade é aceito (nascido na fazenda)');
  assert.match(V.validarValor(S.coluna('PARCELAS', 'valor'), 0).mensagem, /reais maior que 0/);
  assert.equal(prob('CATEGORIAS', 'ativo', true), null);
  assert.equal(prob('CATEGORIAS', 'ativo', false), null);
  assert.equal(prob('CATEGORIAS', 'ativo', 'S'), 'TIPO_INVALIDO', 'S/N é forma de célula, não de lógica');
  assert.equal(prob('CATEGORIAS', 'ativo', 1), 'TIPO_INVALIDO');
});

test('validador por tipo: ENUM, recorte por coluna, multivalorado, INT restrito e lista aberta', () => {
  assert.equal(prob('ANIMAIS', 'sexo', 'F'), null);
  assert.equal(prob('ANIMAIS', 'sexo', 'f'), 'VALOR_FORA_DA_LISTA');
  assert.equal(prob('ANIMAIS', 'sexo', 'X'), 'VALOR_FORA_DA_LISTA');
  assert.equal(prob('ANIMAIS', 'sexo', 1), 'TIPO_INVALIDO');
  assert.equal(prob('CONFIGURACOES', 'grupo', 'pecuaria'), null, 'enum em minúsculas');
  assert.equal(prob('PARCEIROS', 'tipos', 'FORNECEDOR,COMPRADOR'), null);
  assert.equal(prob('PARCEIROS', 'tipos', 'FORNECEDOR'), null);
  assert.equal(prob('PARCEIROS', 'tipos', 'FORNECEDOR, COMPRADOR'), 'VALOR_FORA_DA_LISTA', 'sem espaços');
  assert.equal(prob('PARCEIROS', 'tipos', 'FORNECEDOR,VIZINHO'), 'VALOR_FORA_DA_LISTA');
  assert.equal(prob('PARCEIROS', 'tipos', 'FORNECEDOR,FORNECEDOR'), 'FORMATO_INVALIDO');
  assert.equal(prob('EVENTO_ANIMAIS', 'efeito_inventario', -1), null);
  assert.equal(prob('EVENTO_ANIMAIS', 'efeito_inventario', 2), 'VALOR_FORA_DA_LISTA');
  assert.equal(prob('EVENTO_ANIMAIS', 'efeito_inventario', '1'), 'TIPO_INVALIDO');
  // Lista aberta: só confere quando quem chama informa os códigos vigentes.
  assert.equal(prob('ANIMAIS', 'raca', 'NELORE_PO'), null);
  assert.equal(prob('ANIMAIS', 'raca', 'NELORE_PO', { listas: { RACA: ['NELORE', 'ANGUS'] } }), 'VALOR_FORA_DA_LISTA');
  assert.equal(prob('ANIMAIS', 'raca', 'ANGUS', { listas: { RACA: ['NELORE', 'ANGUS'] } }), null);
});

test('validador por tipo: JSON e o teto de 40.000 caracteres (também para texto)', () => {
  const col = S.coluna('EVENTOS', 'payload_json');
  assert.equal(V.TETO_CELULA, 40000);
  assert.equal(V.validarValor(col, { avisos_aceitos: [{ codigo: 'CARENCIA_ATIVA', n: 2 }] }), null);
  assert.equal(V.validarValor(col, [12, 24, 36]), null);
  assert.equal(V.validarValor(col, '{"a":1}').codigo, 'TIPO_INVALIDO', 'na lógica o JSON é objeto, não texto');
  assert.equal(V.validarValor(col, { d: gas.run('new Date(0)') }).codigo, 'TIPO_INVALIDO');
  assert.match(V.validarValor(col, { a: [{ b: NaN }] }).mensagem, /payload_json\.a\[0\]\.b/);
  assert.equal(V.validarValor(col, { f: () => 1 }).codigo, 'TIPO_INVALIDO');
  // {"t":"..."} tem 8 caracteres além do texto.
  assert.equal(V.validarValor(col, { t: 'x'.repeat(40000 - 8) }), null, 'exatamente 40.000');
  const estouro = V.validarValor(col, { t: 'x'.repeat(40000 - 7) });
  assert.equal(estouro.codigo, 'TEXTO_LONGO_DEMAIS');
  assert.match(estouro.mensagem, /40001 caracteres \(o limite é 40000\)/);
  assert.equal(V.validarValor(col, { t: 'x'.repeat(200) }, { tetoCelula: 100 }).codigo, 'TEXTO_LONGO_DEMAIS', 'teto configurável');
  assert.equal(prob('ANIMAIS', 'observacoes', 'x'.repeat(40000)), null);
  assert.equal(prob('ANIMAIS', 'observacoes', 'x'.repeat(40001)), 'TEXTO_LONGO_DEMAIS');
  assert.equal(V.validarTeto('x'.repeat(40000)), null);
  assert.equal(V.validarTeto('x'.repeat(40001)).codigo, 'TEXTO_LONGO_DEMAIS');
  assert.equal(V.validarTeto(null), null);
  assert.equal(V.validarTeto('abcdef', 5).codigo, 'TEXTO_LONGO_DEMAIS');
  // Compra de 250 animais com a lista dentro de um JSON estoura o teto (exemplo do dicionário).
  const lista = { animais: Array.from({ length: 250 }, (_, i) => ({ animal_id: ID, brinco: String(i).padStart(4, '0'), peso: 387.5, valor: 3075, observacoes: 'x'.repeat(120) })) };
  assert.equal(V.validarValor(col, lista).codigo, 'TEXTO_LONGO_DEMAIS');
});

// ------------------------------------------------------------------ registro ----
const propriedade = () => ({ property_id: ID, nome: 'Fazenda Boa Vista', descricao: null, localizacao: 'Ariquemes/RO', area_total_ha: 812.5, status: 'ATIVO', created_at: TS, updated_at: TS });

test('registro: válido passa; obrigatório vazio, tipo errado e campo desconhecido são apontados por campo', () => {
  assert.deepEqual(plano(V.validarRegistro('PROPRIEDADES', propriedade())), []);
  const ruim = Object.assign(propriedade(), { nome: '', status: 'ABERTA', area_total_ha: -1, created_at: undefined, apelido: 'x' });
  const d = V.validarRegistro('PROPRIEDADES', ruim);
  assert.deepEqual(codigos(d), ['apelido:CAMPO_DESCONHECIDO', 'area_total_ha:VALOR_FORA_DA_FAIXA', 'created_at:CAMPO_OBRIGATORIO', 'nome:CAMPO_OBRIGATORIO', 'status:VALOR_FORA_DA_LISTA']);
  plano(d).forEach((x) => assert.deepEqual(Object.keys(x), ['codigo', 'animal_id', 'brinco', 'campo', 'mensagem', 'conflito'], 'forma de 01 seção 3.3'));
  assert.ok(plano(d).every((x) => typeof x.mensagem === 'string' && x.mensagem.length > 0));
  // Campo opcional pode faltar, vir null ou vir ''.
  const semOpcionais = propriedade();
  delete semOpcionais.descricao;
  semOpcionais.localizacao = '';
  assert.deepEqual(plano(V.validarRegistro('PROPRIEDADES', semOpcionais)), []);
  assert.throws(() => V.validarRegistro('NAO_EXISTE', {}), /aba desconhecida/);
  assert.throws(() => V.validarRegistro('PROPRIEDADES', null), /registro de PROPRIEDADES inválido/);
  assert.throws(() => V.validarRegistro('PROPRIEDADES', []), /registro de PROPRIEDADES inválido/);
});

test('registro: exigirRegistro lança VALIDATION com os detalhes; identificação do animal vai em cada detalhe', () => {
  assert.equal(V.exigirRegistro('PROPRIEDADES', propriedade()), undefined);
  assert.throws(() => V.exigirRegistro('PROPRIEDADES', Object.assign(propriedade(), { nome: null })), (e) => {
    assert.equal(e.code, 'VALIDATION');
    assert.equal(e.message, 'Há 1 campo com problema.');
    assert.deepEqual(codigos(e.details), ['nome:CAMPO_OBRIGATORIO']);
    return true;
  });
  const pesagem = { weight_id: ID, animal_id: ID2, event_id: ID, data_pesagem: '2026-11-13', peso_kg: 2100.55, metodo: 'OLHO', tipo: 'ROTINA' };
  const d = plano(V.validarRegistro('PESAGENS', pesagem, { animal_id: ID2, brinco: '0612' }));
  assert.deepEqual(d.map((x) => [x.campo, x.codigo, x.animal_id, x.brinco]), [['peso_kg', 'FORMATO_INVALIDO', ID2, '0612'], ['metodo', 'VALOR_FORA_DA_LISTA', ID2, '0612']]);
  assert.throws(() => V.exigirRegistro('PESAGENS', pesagem), (e) => e.code === 'VALIDATION' && e.message === 'Há 2 campos com problema.');
});

test('registro: edição parcial valida só o que veio; fase A não exige projeção', () => {
  assert.deepEqual(plano(V.validarRegistro('PASTOS', { nome: 'Recria 2', area_hectares: 37.45 }, { parcial: true })), []);
  assert.deepEqual(codigos(V.validarRegistro('PASTOS', { nome: '', posse: 'EMPRESTADO' }, { parcial: true })), ['nome:CAMPO_OBRIGATORIO', 'posse:VALOR_FORA_DA_LISTA']);
  assert.ok(V.validarRegistro('PASTOS', { nome: 'Recria 2' }).length > 3, 'sem parcial, faltam os obrigatórios');
  // Linha de ANIMAIS anexada na fase A: identidade + situação PENDENTE; as demais projeções ficam vazias.
  const faseA = { animal_id: ID, codigo_interno: 'A-000123', situacao_cadastral: 'PENDENTE', categoria_modo: 'AUTO', created_at: TS, updated_at: TS };
  assert.deepEqual(plano(V.validarRegistro('ANIMAIS', faseA, { semProjecoes: true })), []);
  assert.deepEqual(codigos(V.validarRegistro('ANIMAIS', { animal_id: ID, created_at: TS, updated_at: TS }, { semProjecoes: true })), ['codigo_interno:CAMPO_OBRIGATORIO']);
  assert.deepEqual(codigos(V.validarRegistro('ANIMAIS', faseA)), ['marcado_descarte:CAMPO_OBRIGATORIO', 'nao_localizado:CAMPO_OBRIGATORIO', 'sexo:CAMPO_OBRIGATORIO'], 'linha vigente exige as projeções obrigatórias');
  // Projeção preenchida continua sendo validada no tipo.
  assert.deepEqual(codigos(V.validarRegistro('ANIMAIS', Object.assign({}, faseA, { sexo: 'MACHO' }), { semProjecoes: true })), ['sexo:VALOR_FORA_DA_LISTA']);
});

test('registro: enum dependente (subtipo × tipo de evento) e obrigatoriedade condicional fica para a regra do evento', () => {
  const evento = (extra) => Object.assign({
    event_id: ID, op_id: ID2, event_seq: 7, event_type: 'SANIDADE', event_subtype: 'VACINACAO', event_date: '2026-11-13', registration_date: '2026-11-13',
    property_id: ID, status: 'PENDENTE', created_by: 'dono@gmail.com', source: 'APP', pre_marco_zero: false, idempotency_key: 'k-1', created_at: TS,
  }, extra);
  assert.deepEqual(plano(V.validarRegistro('EVENTOS', evento())), []);
  assert.deepEqual(codigos(V.validarRegistro('EVENTOS', evento({ event_subtype: 'COBERTURA' }))), ['event_subtype:VALOR_FORA_DA_LISTA'], 'COBERTURA é subtipo de REPRODUCAO');
  assert.deepEqual(codigos(V.validarRegistro('EVENTOS', evento({ event_type: 'COMPRA', event_subtype: 'VACINACAO' }))), ['event_subtype:VALOR_FORA_DA_LISTA'], 'COMPRA não tem subtipo');
  assert.deepEqual(plano(V.validarRegistro('EVENTOS', evento({ event_type: 'COMPRA', event_subtype: null }))), [], 'partner_id é "S: COMPRA, VENDA": não é exigido aqui');
  assert.deepEqual(codigos(V.validarRegistro('EVENTOS', evento({ event_type: 'VOO', event_subtype: null }))), ['event_type:VALOR_FORA_DA_LISTA']);
  assert.deepEqual(codigos(V.validarRegistro('EVENTOS', evento({ pre_marco_zero: 'N', total_value: 60000.5, payload_json: '{}' }))), ['payload_json:TIPO_INVALIDO', 'pre_marco_zero:TIPO_INVALIDO', 'total_value:FORMATO_INVALIDO']);
  // Recorte por coluna: a compra não rateia por dias de permanência.
  const compra = { purchase_id: ID, event_id: ID, modalidade: 'CABECA', qtd_animais: 20, valor_animais: 6000000, frete: 150000, outros_custos: 0, valor_total: 6150000, criterio_rateio: 'DIAS_PERMANENCIA' };
  assert.deepEqual(codigos(V.validarRegistro('COMPRAS', compra)), ['criterio_rateio:VALOR_FORA_DA_LISTA']);
  assert.deepEqual(plano(V.validarRegistro('COMPRAS', Object.assign({}, compra, { criterio_rateio: 'VALOR_INDIVIDUAL' }))), []);
});

test('as sementes do Schema passam pela validação da própria aba', () => {
  const p = gas.portas();
  S.SEMENTES.CATEGORIAS.forEach((c) => assert.deepEqual(plano(V.validarRegistro('CATEGORIAS', Object.assign({ category_id: p.idGen.uuid() }, c))), [], c.codigo));
  S.SEMENTES.PLANO_CONTAS.forEach((c) => assert.deepEqual(plano(V.validarRegistro('PLANO_CONTAS', Object.assign({ conta_id: p.idGen.uuid() }, c))), [], c.codigo));
  S.SEMENTES.CONFIGURACOES.forEach((c) => {
    const linha = { chave: c.chave, valor: c.padrao, tipo: c.tipo, grupo: c.grupo, descricao: c.descricao, updated_at: p.clock.agora() };
    assert.deepEqual(plano(V.validarRegistro('CONFIGURACOES', linha)), [], c.chave);
  });
  Object.keys(S.LISTAS_SEMENTE).forEach((lista) => S.LISTAS_SEMENTE[lista].forEach((i) => {
    const linha = { lista_id: p.idGen.uuid(), lista, codigo: i.codigo, rotulo: i.rotulo, ordem: i.ordem, ativo: true };
    assert.deepEqual(plano(V.validarRegistro('LISTAS', linha)), [], lista + '.' + i.codigo);
  }));
  S.nomesTabelas().forEach((n) => {
    const linha = { tabela: n, versao: S.VERSAO, colunas_json: plano(S.colunas(n)), sementes_versao: S.SEMENTES_VERSAO, updated_at: p.clock.agora() };
    assert.deepEqual(plano(V.validarRegistro('SCHEMA_META', linha)), [], n);
  });
});

test('coletor: junta erros e avisos; erro em qualquer item rejeita tudo', () => {
  const c = V.coletor();
  assert.equal(c.temErros(), false);
  assert.equal(c.lancarSeErros(), undefined);
  c.aviso({ codigo: 'PESO_IMPLAUSIVEL', brinco: '0412', campo: 'peso', mensagem: 'Ganho de 3,1 kg/dia desde 01/10/2026.' });
  assert.equal(c.temErros(), false, 'aviso não é erro');
  c.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'event_date', mensagem: 'Campo obrigatório.' });
  c.erro({ codigo: 'X', animal_id: ID, brinco: '0612', mensagem: 'y', conflito: { event_id: ID2, tipo: 'VENDA', data: '2026-10-02' } });
  assert.equal(c.erros.length, 2);
  assert.equal(c.avisos.length, 1);
  assert.deepEqual(plano(c.avisos[0]), { codigo: 'PESO_IMPLAUSIVEL', animal_id: null, brinco: '0412', campo: 'peso', mensagem: 'Ganho de 3,1 kg/dia desde 01/10/2026.', conflito: null });
  assert.throws(() => c.lancarSeErros('2 de 80 animais com problema'), (e) => e.code === 'VALIDATION' && e.message === '2 de 80 animais com problema' && e.details.length === 2 && e.details[1].conflito.tipo === 'VENDA');
  assert.throws(() => c.lancarSeErros(), (e) => e.message === 'Há 2 problemas a corrigir.');
});
