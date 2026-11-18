'use strict';
/**
 * Motor de eventos (EventCatalog + EventService + Timeline integrados à UnitOfWork, com o projetor real). Depois de
 * CADA comando, o apoio confere que a projeção gravada é a reconstrução pelos eventos vigentes.
 * Cobre: catálogo; ENTRADA_INICIAL (valor de abertura, pesagem e prenhez); CT-09 (brinco duplicado, mãe inválida,
 * ciclo); CT-10 (reenvio, idempotência, concorrência, guarda semântica); CT-18 (substituição com os mesmos
 * animal_id e correção de localização posterior); exemplos (i) a (iv) de 04, seção 5.2; estorno com e sem
 * dependentes; evento de 300 animais com 1 inválido; avisos aceitos e não aceitos; consultas; categorias.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');
const E = require('./apoio-eventos');

const { js, D0, PASTOS, bicho, entradaInicial, outraEntrada, ajuste, codigos } = E;

function idsDe(r) {
  return r.dados.animais.map((a) => a.animal_id);
}
function falha(m, acao, dados, op) {
  const r = m.tentar(acao, dados, op);
  assert.equal(r.ok, false, 'o comando deveria ter sido recusado');
  return r.erro;
}

// ------------------------------------------------------------------ catálogo ----
test('catálogo: 21 tipos; na Fase 4 (etapa BASE), os mesmos da Fase 3 (o lançamento financeiro e o rateio ainda sem campos); na Fase 3 (E3.1 a E3.5), os da Fase 2 — entradas, nascimento, compra, venda, transferência, morte, descarte, identificação, marcação, os cinco ajustes e estorno — mais a pesagem, a sanidade, a reprodução, a desmama, a castração, a ocorrência e o estoque; módulos por fase; serialização é só dado', () => {
  const G = createGas({ order: 'alpha' }).G;
  const C = G.EventCatalog;
  assert.equal(C.nomes().length, 21);
  assert.equal(C.FASE_ATUAL, 4);
  assert.deepEqual(js(C.tiposAtivos()), js(C.tiposAtivos(3)), 'a etapa BASE da Fase 4 não muda os tipos: os da Fase 4 entram com os campos deles');
  // Os tipos da Fase 3 ficam inativos até terem campos: a pesagem (E3.1), a sanidade e o estoque (E3.2 e E3.3), a reprodução,
  // a desmama, a castração e a ocorrência (E3.4 e E3.5) já têm.
  assert.deepEqual(js(C.tiposAtivos()), ['ENTRADA_INICIAL', 'OUTRA_ENTRADA', 'NASCIMENTO', 'COMPRA', 'VENDA', 'TRANSFERENCIA', 'MORTE', 'DESCARTE', 'PESAGEM', 'SANIDADE', 'REPRODUCAO', 'DESMAMA', 'CASTRACAO', 'IDENTIFICACAO', 'MARCACAO', 'AJUSTE_INVENTARIO', 'OCORRENCIA', 'ESTOQUE', 'ESTORNO']);
  assert.deepEqual(js(C.tiposAtivos(2)), ['ENTRADA_INICIAL', 'OUTRA_ENTRADA', 'NASCIMENTO', 'COMPRA', 'VENDA', 'TRANSFERENCIA', 'MORTE', 'DESCARTE', 'IDENTIFICACAO', 'MARCACAO', 'AJUSTE_INVENTARIO', 'ESTORNO'], 'a Fase 2 continua a mesma');
  assert.deepEqual([C.ativo('PESAGEM', null, 3), C.ativo('PESAGEM', null, 2), C.tipo('PESAGEM').modo_entrada, C.tipo('PESAGEM').revisao], [true, false, 'CURRAL', 'LOCAL'], 'a pesagem chega na Fase 3, com o modo curral e a revisão no aparelho');
  for (const t of ['REPRODUCAO', 'DESMAMA', 'CASTRACAO', 'OCORRENCIA']) assert.deepEqual([C.ativo(t, null, 3), C.ativo(t, null, 2)], [true, false], t + ' chega na Fase 3 (E3.4 e E3.5)');
  assert.deepEqual(js(C.subtipos('REPRODUCAO').filter((x) => C.ativo('REPRODUCAO', x))), ['EXPOSICAO', 'COBERTURA', 'INSEMINACAO', 'DIAGNOSTICO_GESTACAO', 'ABORTO']);
  assert.deepEqual([C.tipo('REPRODUCAO').filtro_elegiveis, C.tipo('CASTRACAO').filtro_elegiveis, C.tipo('DESMAMA').modo_entrada].map(js), [{ situacao: 'ATIVO' }, { situacao: 'ATIVO', sexo: 'M' }, 'CURRAL'], 'a exposição leva fêmeas e touros; a castração, só machos; a desmama tem modo curral');
  assert.deepEqual(js(C.camposAnimal('REPRODUCAO', 'DIAGNOSTICO_GESTACAO').map((c) => c.id)), ['animal_id', 'resultado', 'idade_gestacional_dias', 'data_prevista_parto', 'observacoes'], 'o diagnóstico em lote: o resultado de cada fêmea');
  assert.deepEqual([C.ativo('SANIDADE', null, 2), C.ativo('ESTOQUE', null, 2), C.tipo('SANIDADE').revisao, C.tipo('ESTOQUE').selecao_animais], [false, false, 'SERVIDOR', 'NENHUM'], 'sanidade e estoque chegam na Fase 3; a revisão da sanidade é a do servidor (custo e estoque); o estoque não tem animais');
  assert.deepEqual(js(C.subtipos('SANIDADE').filter((x) => C.ativo('SANIDADE', x))), ['VACINACAO', 'VERMIFUGACAO', 'MEDICACAO', 'TRATAMENTO', 'EXAME', 'DOENCA']);
  assert.deepEqual(js(C.subtipos('ESTOQUE').filter((x) => C.ativo('ESTOQUE', x))), ['ENTRADA', 'AJUSTE'], 'o subtipo do tipo sem animais fica pronto pelos campos de cabeçalho');
  assert.equal(C.camposEvento('SANIDADE', 'DOENCA').some((c) => c.id === 'produto_id' || c.id === 'modo_dose'), false, 'o registro de doença não aplica produto');
  assert.deepEqual(js(C.tiposAtivos(1)), ['ENTRADA_INICIAL', 'OUTRA_ENTRADA', 'AJUSTE_INVENTARIO', 'ESTORNO'], 'a Fase 1 continua a mesma');
  for (const t of ['LANCAMENTO_FINANCEIRO', 'RATEIO']) assert.equal(C.ativo(t), false, t + ' ainda não entregue: inativo');
  assert.deepEqual([C.ativo('AJUSTE_INVENTARIO', 'CORRECAO_LOCALIZACAO'), C.ativo('AJUSTE_INVENTARIO', 'RECLASSIFICACAO'), C.ativo('AJUSTE_INVENTARIO', 'DIVERGENCIA_CONTAGEM'), C.ativo('AJUSTE_INVENTARIO', 'RECLASSIFICACAO', 1), C.ativo('VENDA'), C.ativo('VENDA', null, 2), C.ativo('VENDA', null, 1)], [true, true, true, false, true, true, false]);
  assert.deepEqual([C.ativo('IDENTIFICACAO', 'REMOCAO'), C.ativo('IDENTIFICACAO', 'REMOCAO', 1), C.ativo('MARCACAO', 'NAO_LOCALIZADO'), C.ativo('MARCACAO', 'OUTRO')], [true, false, true, false]);
  assert.deepEqual(js(C.camposEvento('MARCACAO', 'DESCARTE').map((c) => c.id)), ['event_date', 'acao', 'property_id', 'responsible', 'notes', 'motivo_descarte'], 'campo de cabeçalho do subtipo');
  assert.deepEqual(js(C.camposEvento('MARCACAO', 'NAO_LOCALIZADO').map((c) => c.id)), ['event_date', 'acao', 'property_id', 'responsible', 'notes']);
  assert.deepEqual(js(C.modulosAtivos().map((x) => x.id)), ['DASHBOARD', 'REBANHO', 'PASTOS', 'EVENTOS', 'PESAGENS', 'SANIDADE', 'REPRODUCAO', 'FINANCEIRO', 'CONFIGURACOES', 'IMPORTACAO']);
  assert.deepEqual(js(C.modulosAtivos(3).map((x) => x.id)), ['DASHBOARD', 'REBANHO', 'PASTOS', 'EVENTOS', 'PESAGENS', 'SANIDADE', 'REPRODUCAO', 'CONFIGURACOES', 'IMPORTACAO'], 'a Fase 3 continua com os mesmos módulos');
  assert.deepEqual(js(C.modulosAtivos(2).map((x) => x.id)), ['DASHBOARD', 'REBANHO', 'PASTOS', 'EVENTOS', 'CONFIGURACOES', 'IMPORTACAO'], 'a Fase 2 continua com os mesmos módulos');
  // O menu chega aos 10 itens da §15 na Fase 5, cada um quando a tela dele é entregue: módulo da fase sem a tela
  // (Financeiro e Relatórios, até as fases deles) não fica ativo, como o tipo sem campos.
  const menu = C.modulos().filter((x) => x.menu);
  assert.deepEqual(js(menu.map((x) => x.id)), ['DASHBOARD', 'REBANHO', 'PASTOS', 'EVENTOS', 'PESAGENS', 'SANIDADE', 'REPRODUCAO', 'FINANCEIRO', 'RELATORIOS', 'CONFIGURACOES']);
  assert.ok(menu.every((x) => x.fase <= 5), 'os 10 itens chegam até a Fase 5');
  assert.deepEqual(js(C.modulosAtivos(5).map((x) => x.id)), js(C.modulosAtivos().map((x) => x.id)), 'sem a tela, o módulo da fase não fica ativo');
  assert.deepEqual(js(C.modulo('PESAGENS')), { id: 'PESAGENS', rotulo: 'Pesagens', ordem: 5, fase: 3, menu: true, tela: 'Weights', sob_demanda: true, rotas: ['pesagens'] });
  assert.deepEqual(js(C.modulo('SANIDADE')), { id: 'SANIDADE', rotulo: 'Sanidade', ordem: 6, fase: 3, menu: true, tela: 'Health', sob_demanda: true, rotas: ['sanidade'] }, 'Sanidade entregue na E3.3, sob demanda');
  assert.deepEqual(js(C.modulo('REPRODUCAO')), { id: 'REPRODUCAO', rotulo: 'Reprodução', ordem: 7, fase: 3, menu: true, tela: 'Reproduction', sob_demanda: true, rotas: ['reproducao'] }, 'Reprodução entregue na E3.4 e E3.5, sob demanda');
  assert.deepEqual(js(C.modulo('FINANCEIRO')), { id: 'FINANCEIRO', rotulo: 'Financeiro', ordem: 8, fase: 4, menu: true, tela: 'Financial', sob_demanda: true, rotas: ['financeiro'] }, 'Financeiro entregue na etapa BASE da Fase 4, sob demanda');
  assert.deepEqual(js(C.modulo('RELATORIOS')), { id: 'RELATORIOS', rotulo: 'Relatórios', ordem: 9, fase: 5, menu: true }, 'Relatórios ainda sem tela');
  assert.equal(C.modulo('XPTO'), null);
  assert.deepEqual(js(C.modulosAtivos().filter((x) => x.sob_demanda).map((x) => [x.id, x.tela, x.rotas])), [['EVENTOS', 'Events', ['eventos', 'evento']], ['PESAGENS', 'Weights', ['pesagens']], ['SANIDADE', 'Health', ['sanidade']], ['REPRODUCAO', 'Reproduction', ['reproducao']], ['FINANCEIRO', 'Financial', ['financeiro']], ['CONFIGURACOES', 'Settings', ['config']], ['IMPORTACAO', 'Import', ['importar']]], 'as pesagens, a sanidade, a reprodução, o financeiro e a importação são carregados sob demanda; desde a Fase 4, também os eventos e as configurações (folga na página inicial)');
  const s = C.serializar();
  const copia = JSON.parse(JSON.stringify(s));
  assert.deepEqual(js(s), copia, 'ida e volta por JSON sem perda (nada de função ou Date)');
  assert.deepEqual(Object.keys(copia.tipos.find((t) => t.tipo === 'AJUSTE_INVENTARIO').subtipos), ['CORRECAO_CADASTRO', 'IDENTIFICACAO_INCORRETA', 'CORRECAO_LOCALIZACAO', 'RECLASSIFICACAO', 'DIVERGENCIA_CONTAGEM']);
  assert.deepEqual(Object.keys(copia.tipos.find((t) => t.tipo === 'IDENTIFICACAO').subtipos), ['PRIMEIRA_IDENTIFICACAO', 'SUBSTITUICAO', 'REMOCAO']);
  assert.deepEqual(Object.keys(copia.tipos.find((t) => t.tipo === 'MARCACAO').subtipos), ['DESCARTE', 'NAO_LOCALIZADO']);
  assert.deepEqual(Object.keys(C.serializar(1).tipos.find((t) => t.tipo === 'AJUSTE_INVENTARIO').subtipos), ['CORRECAO_CADASTRO', 'IDENTIFICACAO_INCORRETA', 'CORRECAO_LOCALIZACAO'], 'os subtipos da Fase 2 não aparecem na Fase 1');
  for (const t of copia.tipos) {
    for (const k of ['rotulo', 'grupo_ui', 'ordem', 'selecao_animais', 'modo_entrada', 'revisao', 'critico', 'reads', 'fase']) assert.ok(k in t, t.tipo + ' sem ' + k);
    const campos = t.campos.concat(t.campos_animal || []).concat(...Object.values(t.subtipos || {}).map((x) => (x.campos || []).concat(x.campos_animal || []))).concat(...Object.values(t.grupos_repetiveis || {}));
    for (const c of campos) {
      assert.ok(C.TIPOS_CAMPO.indexOf(c.tipo) >= 0 || /^ref:[A-Z_]+$/.test(c.tipo), t.tipo + '.' + c.id + ': tipo renderizável');
      if (/^ref:/.test(c.tipo)) assert.ok(G.Schema.temTabela(c.tipo.slice(4)), 'referência a aba existente: ' + c.tipo);
      if (c.naturezas) for (const n of c.naturezas) assert.ok(G.Schema.enumValores('NATUREZA_CONTA').includes(n), c.id + ': natureza de conta conhecida');
      assert.ok(['EVENTO', 'POR_ANIMAL'].includes(c.escopo) && typeof c.rotulo === 'string' && c.rotulo.length > 0);
      if (c.tipo === 'lista') assert.ok(c.opcoes || G.Schema.LISTAS_SEMENTE[c.lista], c.id + ': lista com opções ou lista aberta conhecida');
    }
    for (const r of t.reads) assert.ok(G.Schema.temTabela(r));
  }
});

test('catálogo: validação de campos — obrigatório, obrigatório se, visível se, tipo, faixa, lista e campo desconhecido', () => {
  const G = createGas({ order: 'reverse' }).G;
  const defs = G.EventCatalog.camposAnimal('ENTRADA_INICIAL');
  const v = (x) => js(G.EventCatalog.validarCampos(defs, x, { listas: { RACA: ['NELORE'] } })).map((d) => d.campo + ':' + d.codigo).sort();
  assert.deepEqual(v({ sexo: 'F', origem: 'NASCIDO', pasto_destino_id: 'p' }), []);
  assert.deepEqual(v({ origem: 'NASCIDO' }), ['pasto_destino_id:CAMPO_OBRIGATORIO', 'sexo:CAMPO_OBRIGATORIO']);
  assert.deepEqual(v({ sexo: 'M', origem: 'NASCIDO', pasto_destino_id: 'p' }), ['castrado:CAMPO_OBRIGATORIO', 'reprodutor:CAMPO_OBRIGATORIO']);
  assert.deepEqual(v({ sexo: 'F', origem: 'NASCIDO', pasto_destino_id: 'p', castrado: true, castrado2: 1 }), ['castrado2:CAMPO_DESCONHECIDO', 'castrado:CAMPO_NAO_SE_APLICA']);
  assert.deepEqual(v({ sexo: 'F', origem: 'NASCIDO', pasto_destino_id: 'p', castrado: false }), [], 'falso em campo invisível não é erro');
  assert.deepEqual(v({ sexo: 'X', origem: 'NASCIDO', pasto_destino_id: 'p', raca: 'ANGUS', peso: 2000.5, valor_abertura: 10.5, data_nascimento: '2026-02-30' }).sort(),
    ['data_nascimento:FORMATO_INVALIDO', 'data_nascimento_confianca:CAMPO_OBRIGATORIO', 'metodo_pesagem:CAMPO_OBRIGATORIO', 'peso:VALOR_FORA_DA_FAIXA', 'raca:VALOR_FORA_DA_LISTA', 'sexo:VALOR_FORA_DA_LISTA', 'valor_abertura:TIPO_INVALIDO'].sort());
  assert.deepEqual(v({ sexo: 'F', origem: 'NASCIDO', pasto_destino_id: 'p', peso: 300.25, metodo_pesagem: 'BALANCA' }), ['peso:FORMATO_INVALIDO']);
});

// ------------------------------------------------------------------ ENTRADA_INICIAL ----
test('ENTRADA_INICIAL: projeções, pesagem de entrada, prenhez estimada, cria ao pé e valor de abertura sem parcela', () => {
  const m = E.ambienteEventos();
  const r = m.run('registrar', entradaInicial([
    bicho({ brinco: ' 0231 ', ref: 'vaca', data_nascimento: '2020-05-10', data_nascimento_confianca: 'ESTIMADA', raca: 'NELORE', partos_previos: 2, situacao_reprodutiva: 'PRENHA', data_prevista_parto: '2026-03-01', peso: 420.5, metodo_pesagem: 'BALANCA', valor_abertura: 300000, data_entrada: '2021-01-10', data_entrada_confianca: 'ESTIMADA' }),
    bicho({ brinco: '12', sexo: 'M', data_nascimento: '2025-09-01', data_nascimento_confianca: 'CONFIRMADA', mae_ref: 'vaca', mae_confianca: 'CONFIRMADA', valor_abertura: 120001, nome: 'Pintado', origem: 'NASCIDO' }),
    bicho({ sexo: 'M', idade_meses: 30, castrado: true, pasto_destino_id: PASTOS.B, outras_identificacoes: [{ tipo: 'SISBOV', codigo: 'BR123' }] }),
  ], { notes: 'Contagem de janeiro' }));
  assert.equal(r.duplicado, false);
  const [vaca, bezerro, boi] = idsDe(r).map(m.animal);
  assert.deepEqual([vaca.codigo_interno, vaca.brinco, vaca.brinco_norm, vaca.situacao_cadastral, vaca.pasto_atual_id, vaca.propriedade_atual_id], ['A-000001', '0231', '231', 'ATIVO', PASTOS.A, E.PROP]);
  assert.deepEqual([vaca.situacao_reprodutiva, vaca.cria_ao_pe, vaca.partos_previos, vaca.peso_atual, vaca.data_ultima_pesagem, vaca.raca], ['PRENHA', true, 2, 420.5, D0, 'NELORE']);
  assert.deepEqual([vaca.data_entrada, vaca.data_entrada_confianca, vaca.custo_aquisicao, vaca.custo_aquisicao_origem, vaca.data_ultimo_movimento], ['2021-01-10', 'ESTIMADA', 300000, 'ABERTURA_INFORMADA', D0]);
  assert.deepEqual([bezerro.mae_id, bezerro.mae_confianca, bezerro.castrado, bezerro.reprodutor, bezerro.origem, bezerro.nome, bezerro.cria_ao_pe, bezerro.situacao_reprodutiva], [vaca.animal_id, 'CONFIRMADA', false, false, 'NASCIDO', 'Pintado', null, null]);
  assert.deepEqual([boi.data_nascimento, boi.data_nascimento_confianca, boi.brinco, boi.castrado, boi.custo_aquisicao, boi.custo_aquisicao_origem, boi.data_entrada_confianca], ['2023-07-01', 'ESTIMADA', null, true, null, 'DESCONHECIDO', 'DESCONHECIDA']);
  const ev = m.evento(r.dados.event_id);
  assert.deepEqual([ev.status, ev.event_date, ev.registration_date, ev.source, ev.created_by, ev.pre_marco_zero, ev.total_value, ev.confiabilidade], ['CONFIRMADO', D0, E.HOJE, 'APP', 'dono@gmail.com', false, 420001, 'CONFIRMADA']);
  assert.deepEqual(js(ev.payload_json), { valor_abertura_origem: 'INFORMADO' });
  const fin = m.tabela('FINANCEIRO');
  assert.deepEqual(fin.map((f) => [f.natureza, f.valor, f.quantidade, f.data_competencia, f.status, f.status_pagamento, f.animal_id]), [['AQUISICAO_ANIMAIS', 420001, 2, D0, 'ATIVO', 'SEM_CAIXA', null]]);
  assert.equal(m.tabela('PARCELAS').length, 0, 'saldo de abertura não é caixa: sem parcela');
  const rat = m.tabela('RATEIOS');
  assert.deepEqual(rat.map((x) => [x.criterio, x.escopo_tipo, x.escopo_ref, x.total_alocado, x.base_total]), [['VALOR_INDIVIDUAL', 'EVENTO', r.dados.event_id, 420001, 4200.01]]);
  assert.deepEqual(m.tabela('ALOCACOES_FINANCEIRAS').map((a) => [a.animal_id, a.valor_alocado]).sort(), [[vaca.animal_id, 300000], [bezerro.animal_id, 120001]].sort());
  assert.deepEqual(m.tabela('PESAGENS').map((p) => [p.animal_id, p.peso_kg, p.metodo, p.tipo, p.data_pesagem]), [[vaca.animal_id, 420.5, 'BALANCA', 'ENTRADA', D0]]);
  assert.deepEqual(m.tabela('REPRODUCAO').map((x) => [x.animal_id, x.tipo_evento, x.resultado, x.metodo, x.data_prevista_parto]), [[vaca.animal_id, 'DIAGNOSTICO_GESTACAO', 'POSITIVO', 'INFORMADO', '2026-03-01']]);
  assert.deepEqual(m.tabela('IDENTIFICACOES').map((x) => [x.tipo, x.codigo, x.codigo_norm]).sort(), [['BRINCO', '0231', '231'], ['BRINCO', '12', '12'], ['SISBOV', 'BR123', 'BR123']].sort());
  const at = js(m.tabela('EVENTO_ANIMAIS').find((l) => l.animal_id === bezerro.animal_id).atributos_iniciais_json);
  assert.deepEqual(at, { sexo: 'M', origem: 'NASCIDO', data_nascimento: '2025-09-01', data_nascimento_confianca: 'CONFIRMADA', castrado: 'N', reprodutor: 'N', mae_confianca: 'CONFIRMADA', mae_id: vaca.animal_id });
  // Um animal só com valor de abertura: rateio DIRETO e FINANCEIRO.animal_id preenchido pela projeção.
  const um = m.run('registrar', entradaInicial([bicho({ brinco: '77', valor_abertura: 50000 })]));
  const f2 = m.tabela('FINANCEIRO').find((f) => f.event_id === um.dados.event_id);
  assert.deepEqual([m.tabela('RATEIOS').find((x) => x.financial_id === f2.financial_id).criterio, f2.animal_id], ['DIRETO', idsDe(um)[0]]);
});

test('ENTRADA_INICIAL: só na data do marco zero; sem marco zero é CONFIG; OUTRA_ENTRADA não aceita data futura nem anterior ao marco zero', () => {
  const m = E.ambienteEventos();
  assert.deepEqual(codigos(falha(m, 'registrar', entradaInicial([bicho()], { event_date: '2026-02-01' }))), ['FORA_DO_MARCO_ZERO']);
  assert.deepEqual(codigos(falha(m, 'registrar', outraEntrada('2026-12-01', [bicho()]))), ['DATA_FUTURA']);
  assert.deepEqual(codigos(falha(m, 'registrar', outraEntrada('2025-12-31', [bicho()]))), ['ANTES_DO_MARCO_ZERO']);
  assert.deepEqual(codigos(falha(m, 'registrar', outraEntrada('2026-03-01', [bicho()], { description: '' }))), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(codigos(falha(m, 'registrar', outraEntrada('2026-03-01', [bicho({ pasto_destino_id: PASTOS.INATIVO })]))), ['PASTO_INATIVO']);
  assert.deepEqual(codigos(falha(m, 'registrar', outraEntrada('2026-03-01', [bicho({ pasto_destino_id: E.id(0xdead) })]))), ['NAO_ENCONTRADO']);
  assert.deepEqual(codigos(falha(m, 'registrar', { tipo: 'LANCAMENTO_FINANCEIRO', campos: {}, animais: [{}] })), ['TIPO_INDISPONIVEL']);
  assert.deepEqual(falha(m, 'registrar', { tipo: 'REPRODUCAO', campos: {}, animais: [{}] }).details.map((d) => [d.codigo, d.campo]), [['CAMPO_OBRIGATORIO', 'subtipo']], 'a reprodução exige o subtipo');
  assert.deepEqual(codigos(falha(m, 'registrar', { tipo: 'IDENTIFICACAO', subtipo: 'OUTRO', campos: {}, animais: [{}] })), ['TIPO_INDISPONIVEL']);
  const semSub = falha(m, 'registrar', { tipo: 'IDENTIFICACAO', campos: {}, animais: [{}] });
  assert.deepEqual(semSub.details.map((d) => [d.codigo, d.campo]), [['CAMPO_OBRIGATORIO', 'subtipo']], 'tipo com subtipos exige o subtipo');
  assert.deepEqual(codigos(falha(m, 'registrar', outraEntrada('2026-03-01', []))), ['SEM_ANIMAIS']);
  const e = falha(m, 'registrar', outraEntrada('2026-03-01', [bicho({ sexo: 'M', castrado: true, reprodutor: true, data_nascimento: '2026-04-01', data_nascimento_confianca: 'CONFIRMADA' })]));
  assert.deepEqual(codigos(e).sort(), ['CASTRADO_REPRODUTOR', 'NASCIMENTO_DEPOIS_DA_ENTRADA']);
  assert.match(e.details[0].mensagem, /^Animal 1 da lista \(A-\d{6}\): /);
  assert.equal(m.contagem().EVENTOS, 0, 'nada gravado');
  const sem = E.ambienteEventos({ marcoZero: null });
  assert.equal(falha(sem, 'registrar', entradaInicial([bicho()])).code, 'CONFIG');
});

// ------------------------------------------------------------------ CT-09 ----
test('CT-09: brinco duplicado (com outro animal, no mesmo lançamento, zeros à esquerda) e BRINCO_PARECIDO com zeros significativos', () => {
  const m = E.ambienteEventos();
  m.run('registrar', entradaInicial([bicho({ brinco: '0412' })]));
  const e = falha(m, 'registrar', outraEntrada('2026-02-01', [bicho({ brinco: '412' }), bicho({ brinco: 'br 7' }), bicho({ brinco: 'BR7' })]));
  assert.equal(e.code, 'VALIDATION');
  assert.deepEqual(codigos(e), ['BRINCO_DUPLICADO', 'BRINCO_REPETIDO']);
  assert.match(e.details[0].mensagem, /^Brinco 412: o brinco 412 já é do animal A-000001\. Escolha outro número\.$/);
  assert.equal(e.details[0].brinco, '412');
  // Com zeros à esquerda significativos, 0412 e 412 convivem, com aviso.
  const n = E.ambienteEventos({ config: { brinco_ignora_zeros_esquerda: 'N' } });
  n.run('registrar', entradaInicial([bicho({ brinco: '0412' })]));
  const aviso = falha(n, 'registrar', outraEntrada('2026-02-01', [bicho({ brinco: '412' })]));
  assert.deepEqual([aviso.code, codigos(aviso)], ['NEEDS_CONFIRMATION', ['BRINCO_PARECIDO']]);
  assert.equal(n.run('registrar', outraEntrada('2026-02-01', [bicho({ brinco: '412' })]), { avisos: ['BRINCO_PARECIDO'] }).duplicado, false);
  assert.deepEqual(codigos(falha(n, 'registrar', outraEntrada('2026-02-02', [bicho({ brinco: '0412' })]))), ['BRINCO_DUPLICADO']);
  const num = E.ambienteEventos({ config: { brinco_somente_numerico: 'S' } });
  assert.deepEqual(codigos(falha(num, 'registrar', entradaInicial([bicho({ brinco: 'A-12' })]))), ['BRINCO_NAO_NUMERICO']);
});

test('CT-09: mãe inválida (macho, nascida depois do filho, inexistente, a si mesma) e ciclo genealógico', () => {
  const m = E.ambienteEventos();
  const base = m.run('registrar', entradaInicial([
    bicho({ brinco: '0102', data_nascimento: '2015-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    bicho({ brinco: '500', sexo: 'M', data_nascimento: '2016-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    bicho({ brinco: '900', data_nascimento: '2025-08-20', data_nascimento_confianca: 'CONFIRMADA' }),
  ]));
  const [v0102, touro, nova] = idsDe(base);
  const mae = (mae_id, extra) => bicho(Object.assign({ data_nascimento: '2024-09-12', data_nascimento_confianca: 'CONFIRMADA', mae_id, mae_confianca: 'CONFIRMADA' }, extra || {}));
  const e1 = falha(m, 'registrar', outraEntrada('2026-02-01', [mae(touro, { brinco: '1' }), mae(nova, { brinco: '2' }), mae(E.id(0xbeef), { brinco: '3' }), bicho({ brinco: '4', pai_id: v0102, pai_confianca: 'ESTIMADA' }), mae(v0102, { brinco: '5', mae_confianca: '' })]));
  assert.deepEqual(codigos(e1).sort(), ['CAMPO_OBRIGATORIO', 'NAO_ENCONTRADO', 'NASCIMENTO_DO_PROGENITOR', 'SEXO_DO_PROGENITOR', 'SEXO_DO_PROGENITOR'], 'todos os erros juntos, um por animal');
  assert.deepEqual(e1.details.map((d) => d.brinco).sort(), ['1', '2', '3', '4', '5']);
  assert.ok(e1.details.some((d) => /^Brinco 2: a mãe 900 nasceu em 20\/08\/2025, não antes do animal \(12\/09\/2024\)/.test(d.mensagem)));
  // Ciclo: 0102 é mãe de 0310, que é mãe de 0457; propor 0457 como mãe de 0102 é recusado com o caminho.
  const f1 = m.run('registrar', outraEntrada('2026-02-01', [mae(v0102, { brinco: '0310', data_nascimento: '2018-01-01' })]));
  const f2 = m.run('registrar', outraEntrada('2026-02-02', [mae(idsDe(f1)[0], { brinco: '0457', data_nascimento: '2021-01-01' })]));
  const v0457 = idsDe(f2)[0];
  const ciclo = falha(m, 'registrar', ajuste('CORRECAO_CADASTRO', '2026-03-01', [{ animal_id: v0102, campo: 'mae_id', valor_novo: v0457 }, { animal_id: v0102, campo: 'mae_confianca', valor_novo: 'ESTIMADA' }]));
  assert.ok(ciclo.details.some((d) => d.codigo === 'NASCIMENTO_DO_PROGENITOR'), 'a mãe proposta nasceu depois');
  m.run('registrar', ajuste('CORRECAO_CADASTRO', '2026-03-01', [{ animal_id: v0102, campo: 'data_nascimento', valor_novo: '' }]));
  assert.deepEqual([m.animal(v0102).data_nascimento, m.animal(v0102).data_nascimento_confianca], [null, null], 'apagar a data apaga a confiança');
  const c2 = falha(m, 'registrar', ajuste('CORRECAO_CADASTRO', '2026-03-02', [{ animal_id: v0102, campo: 'mae_id', valor_novo: v0457 }, { animal_id: v0102, campo: 'mae_confianca', valor_novo: 'ESTIMADA' }]));
  assert.deepEqual(codigos(c2), ['CICLO_GENEALOGICO']);
  assert.equal(c2.details[0].mensagem, '0102: 0457 não pode ser mãe de 0102: 0102 já é ancestral de 0457 (0102 → 0310 → 0457).');
  assert.deepEqual(codigos(falha(m, 'registrar', ajuste('CORRECAO_CADASTRO', '2026-03-02', [{ animal_id: v0102, campo: 'mae_id', valor_novo: v0102 }, { animal_id: v0102, campo: 'mae_confianca', valor_novo: 'ESTIMADA' }]))), ['PROPRIO_PROGENITOR']);
  // RN-012: a mãe de 0310 não pode virar macho.
  assert.deepEqual(codigos(falha(m, 'registrar', ajuste('CORRECAO_CADASTRO', '2026-03-02', [{ animal_id: v0102, campo: 'sexo', valor_novo: 'M' }]))), ['SEXO_DO_PROGENITOR']);
  // Mãe e filho no mesmo lançamento, por referência; referência desconhecida é erro.
  assert.deepEqual(codigos(falha(m, 'registrar', outraEntrada('2026-03-03', [bicho({ brinco: '61', mae_ref: 'x', mae_confianca: 'CONFIRMADA' })]))), ['REFERENCIA_DESCONHECIDA']);
});

// ------------------------------------------------------------------ tudo ou nada ----
test('evento coletivo de 300 animais com 1 inválido não grava nada; corrigido, grava os 300 numa operação', () => {
  const m = E.ambienteEventos();
  const animais = [];
  for (let i = 0; i < 300; i++) animais.push(bicho({ brinco: String(5000 + i), pasto_destino_id: i % 2 ? PASTOS.A : PASTOS.B }));
  animais[157] = bicho({ brinco: '5157', pasto_destino_id: PASTOS.INATIVO });
  const antes = m.contagem();
  const e = falha(m, 'registrar', entradaInicial(animais));
  assert.deepEqual([e.code, e.details.length, e.details[0].codigo, e.details[0].brinco], ['VALIDATION', 1, 'PASTO_INATIVO', '5157']);
  assert.deepEqual(m.contagem(), antes, 'nenhuma linha em nenhuma aba, nem operação');
  animais[157] = bicho({ brinco: '5157' });
  const r = m.run('registrar', entradaInicial(animais));
  assert.equal(r.dados.animais.length, 300);
  const c = m.contagem();
  assert.deepEqual([c.EVENTOS, c.EVENTO_ANIMAIS, c.ANIMAIS, c.IDENTIFICACOES, c.OPERACOES], [1, 300, 300, 300, 1]);
  assert.equal(new Set(m.tabela('ANIMAIS').map((a) => a.codigo_interno)).size, 300);
  assert.equal(m.inventario('2026-01-01').total, 300);
});

// ------------------------------------------------------------------ CT-10 ----
test('CT-10: reenvio com a mesma chave devolve o original sem gravar; conteúdo diferente é IDEMPOTENCY_MISMATCH; lock ocupado é LOCKED', () => {
  const m = E.ambienteEventos();
  const dados = outraEntrada('2026-03-01', [bicho({ brinco: '31' }), bicho({ brinco: '32' })]);
  const um = m.run('registrar', dados, { chave: 'form-1' });
  const escritas = m.gas.falhas.escritas();
  const dois = m.run('registrar', dados, { chave: 'form-1' });
  assert.deepEqual([dois.duplicado, dois.opId, dois.dados], [true, um.opId, um.dados]);
  assert.equal(m.gas.falhas.escritas(), escritas, 'o duplicado não grava nada');
  assert.equal(falha(m, 'registrar', outraEntrada('2026-03-02', [bicho({ brinco: '33' })]), { chave: 'form-1' }).code, 'IDEMPOTENCY_MISMATCH');
  m.gas.lock.segurarPorOutra();
  const ocupado = falha(m, 'registrar', outraEntrada('2026-03-02', [bicho({ brinco: '34' })]), { chave: 'form-2' });
  assert.equal(ocupado.code, 'LOCKED');
  m.gas.lock.soltarOutra();
  assert.equal(m.run('registrar', outraEntrada('2026-03-02', [bicho({ brinco: '34' })]), { chave: 'form-2' }).duplicado, false, 'LOCKED não consome a chave');
  assert.equal(m.contagem().EVENTOS, 2);
});

test('CT-10: concorrência — outro comando que roda entre a leitura e o lock não colide em event_seq nem em codigo_interno', () => {
  const m = E.ambienteEventos();
  let segunda = null;
  m.gas.ganchos.em('lock.tentar', () => {
    segunda = m.gas.tentar(() => js(m.G.UnitOfWork.run(m.amb.ctx(), m.comando('registrar', outraEntrada('2026-03-01', [bicho({ brinco: '41' })]), { chave: 'b' }))));
  });
  const primeira = m.run('registrar', outraEntrada('2026-03-01', [bicho({ brinco: '42' })]), { chave: 'a' });
  assert.equal(segunda.ok, true, 'a outra execução gravou primeiro');
  assert.equal(primeira.duplicado, false);
  const evs = m.tabela('EVENTOS');
  assert.deepEqual(evs.map((e) => e.event_seq).sort(), [1, 2]);
  assert.deepEqual(m.tabela('ANIMAIS').map((a) => a.codigo_interno).sort(), ['A-000001', 'A-000002']);
});

test('CT-10: guarda semântica — redigitar a mesma entrada (outra chave) pede confirmação; aceito, grava com o aceite no payload', () => {
  const m = E.ambienteEventos();
  const bezerros = () => [0, 1, 2, 3, 4].map(() => bicho({ sexo: 'M', data_nascimento: '2026-02-10', data_nascimento_confianca: 'CONFIRMADA', origem: 'NASCIDO' }));
  m.run('registrar', outraEntrada('2026-03-01', bezerros()), { chave: 'x1' });
  const e = falha(m, 'registrar', outraEntrada('2026-03-01', bezerros()), { chave: 'x2' });
  assert.deepEqual([e.code, codigos(e)], ['NEEDS_CONFIRMATION', ['POSSIVEL_DUPLICIDADE']]);
  assert.match(e.details[0].mensagem, /^Já existe a entrada de 01\/03\/2026 com 5 destes 5 animais\. Gravar mesmo assim\?$/);
  assert.deepEqual([e.details[0].conflito.tipo, e.details[0].conflito.subtipo, e.details[0].conflito.nome], ['OUTRA_ENTRADA', null, 'a entrada']);
  assert.equal(m.contagem().EVENTOS, 1, 'aviso não aceito: nada gravado');
  const r = m.run('registrar', outraEntrada('2026-03-01', bezerros()), { chave: 'x2', avisos: ['POSSIVEL_DUPLICIDADE'] });
  assert.deepEqual(js(m.evento(r.dados.event_id).payload_json), { avisos_aceitos: [{ codigo: 'POSSIVEL_DUPLICIDADE', n: 1 }] });
  // Data diferente não é duplicidade; correção de localização dos mesmos animais na mesma data é.
  m.run('registrar', outraEntrada('2026-03-02', bezerros()), { chave: 'x3' });
  const ids = m.tabela('ANIMAIS').slice(0, 5).map((a) => a.animal_id);
  m.run('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-04-01', ids.map((x) => ({ animal_id: x, pasto_destino_id: PASTOS.B }))));
  assert.deepEqual(codigos(falha(m, 'registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-04-01', ids.map((x) => ({ animal_id: x, pasto_destino_id: PASTOS.C }))))), ['POSSIVEL_DUPLICIDADE']);
});

// ------------------------------------------------------------------ avisos ----
test('avisos: não aceito → NEEDS_CONFIRMATION sem gravar; aceito → gravado em payload_json; política BLOQUEIA e IGNORA', () => {
  const novilha = (extra) => [bicho({ brinco: '7', ref: 'mae', data_nascimento: '2024-06-01', data_nascimento_confianca: 'CONFIRMADA' }),
    bicho(Object.assign({ brinco: '8', data_nascimento: '2025-08-01', data_nascimento_confianca: 'CONFIRMADA', mae_ref: 'mae', mae_confianca: 'ESTIMADA' }, extra || {}))];
  const m = E.ambienteEventos();
  const e = falha(m, 'registrar', entradaInicial(novilha()));
  assert.deepEqual([e.code, codigos(e)], ['NEEDS_CONFIRMATION', ['IDADE_REPRODUTIVA']]);
  assert.match(e.details[0].mensagem, /a mãe 7 tinha 14 meses no nascimento, abaixo da idade reprodutiva mínima \(24 meses\)/);
  assert.equal(m.contagem().OPERACOES, 0);
  const r = m.run('registrar', entradaInicial(novilha()), { avisos: ['IDADE_REPRODUTIVA'] });
  assert.deepEqual(js(m.evento(r.dados.event_id).payload_json), { avisos_aceitos: [{ codigo: 'IDADE_REPRODUTIVA', n: 1 }] });
  const b = E.ambienteEventos({ config: { avisos_politica: '{"IDADE_REPRODUTIVA":"BLOQUEIA"}' } });
  const eb = falha(b, 'registrar', entradaInicial(novilha()), { avisos: ['IDADE_REPRODUTIVA'] });
  assert.deepEqual([eb.code, codigos(eb)], ['VALIDATION', ['IDADE_REPRODUTIVA']]);
  const i = E.ambienteEventos({ config: { avisos_politica: '{"IDADE_REPRODUTIVA":"IGNORA"}' } });
  const ri = i.run('registrar', entradaInicial(novilha()));
  assert.equal(i.evento(ri.dados.event_id).payload_json, null);
  // Lotação acima da capacidade em cabeças e período financeiro fechado (com justificativa obrigatória).
  const l = E.ambienteEventos({ config: { fin_bloqueio_ate: '2026-06-30' } });
  const tres = [1, 2, 3].map((k) => bicho({ brinco: 'P' + k, pasto_destino_id: PASTOS.PEQUENO, valor_abertura: 10000 }));
  assert.deepEqual(codigos(falha(l, 'registrar', entradaInicial(tres))).sort(), ['LOTACAO_ACIMA_DA_CAPACIDADE', 'PERIODO_BLOQUEADO']);
  assert.deepEqual(codigos(falha(l, 'registrar', entradaInicial(tres), { avisos: ['LOTACAO_ACIMA_DA_CAPACIDADE', 'PERIODO_BLOQUEADO'] })), ['CAMPO_OBRIGATORIO']);
  const dados = Object.assign(entradaInicial(tres), { justificativa_aviso: 'Abertura conferida com o contador' });
  const rl = l.run('registrar', dados, { avisos: ['LOTACAO_ACIMA_DA_CAPACIDADE', 'PERIODO_BLOQUEADO'] });
  assert.deepEqual(js(l.evento(rl.dados.event_id).payload_json.avisos_aceitos), [{ codigo: 'LOTACAO_ACIMA_DA_CAPACIDADE', n: 1 }, { codigo: 'PERIODO_BLOQUEADO', n: 1, justificativa: 'Abertura conferida com o contador' }]);
});

// ------------------------------------------------------------------ exemplos (i) e (ii) adaptados ----
test('(i) adaptado: correção de localização com data passada que quebra a cadeia → CONFLICT apontando o registro posterior', () => {
  const m = E.ambienteEventos();
  const id = idsDe(m.run('registrar', entradaInicial([bicho({ brinco: '0457' })])))[0];
  const ac = m.run('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-03-10', [{ animal_id: id, pasto_destino_id: PASTOS.C }]));
  const e = falha(m, 'registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-03-01', [{ animal_id: id, pasto_destino_id: PASTOS.B }]));
  assert.equal(e.code, 'CONFLICT');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.conflito.event_id, d.conflito.data]), [['ORIGEM_DIVERGENTE', ac.dados.event_id, '2026-03-10']]);
  assert.match(e.message, /^0457: a correção de localização de 10\/03\/2026 parte do pasto Pasto A, mas nessa data o animal estaria no pasto Pasto B\./);
  // Origem informada diferente da registrada na data, e destino igual à origem: VALIDATION.
  assert.deepEqual(codigos(falha(m, 'registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-04-01', [{ animal_id: id, pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }]))), ['ORIGEM_DIVERGENTE']);
  assert.deepEqual(codigos(falha(m, 'registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-04-01', [{ animal_id: id, pasto_destino_id: PASTOS.C }]))), ['VALOR_IGUAL']);
  // Saída do impasse: estornar a de 10/03, lançar a de 01/03 (A → B) e relançar a de 10/03, que agora parte de B.
  m.run('estornar', { event_id: ac.dados.event_id, justificativa: 'Faltou a correção de 01/03' });
  m.run('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-03-01', [{ animal_id: id, pasto_destino_id: PASTOS.B }]));
  m.run('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-03-10', [{ animal_id: id, pasto_destino_id: PASTOS.C }]));
  assert.deepEqual([m.pastoEm(id, '2026-03-05').pasture_id, m.animal(id).pasto_atual_id], [PASTOS.B, PASTOS.C]);
  assert.deepEqual(m.tabela('AJUSTES').slice(-1).map((a) => [a.valor_anterior, a.valor_novo]), [[PASTOS.B, PASTOS.C]], 'origem gravada = pasto registrado na data');
});

test('(ii) adaptado: entrada e correção no mesmo dia valem na ordem entrada → demais; corrigir a entrada para outro pasto quebra a correção', () => {
  const m = E.ambienteEventos();
  const ent = m.run('registrar', outraEntrada('2026-06-20', [bicho({ brinco: '88' })]));
  const id = idsDe(ent)[0];
  m.run('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-06-20', [{ animal_id: id, pasto_destino_id: PASTOS.B }]));
  assert.deepEqual([m.animal(id).pasto_atual_id, m.pastoEm(id, '2026-06-20').pasture_id], [PASTOS.B, PASTOS.B]);
  const e = falha(m, 'corrigir', Object.assign(outraEntrada('2026-06-20', [bicho({ brinco: '88', animal_id: id, pasto_destino_id: PASTOS.C })]), { event_id: ent.dados.event_id, justificativa: 'Pasto errado' }));
  assert.deepEqual([e.code, codigos(e)], ['CONFLICT', ['ORIGEM_DIVERGENTE']]);
});

// ------------------------------------------------------------------ CT-18 e (iv) ----
test('CT-18 e (iv): substituição da ENTRADA_INICIAL com os mesmos animal_id e uma correção de localização posterior', () => {
  const m = E.ambienteEventos();
  const orig = m.run('registrar', entradaInicial([
    bicho({ brinco: '1', valor_abertura: 300000, raca: 'NELORE' }), bicho({ brinco: '2', valor_abertura: 300000 }), bicho({ brinco: '3', valor_abertura: 300000 }),
  ]));
  const ids = idsDe(orig);
  const loc = m.run('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-04-01', [{ animal_id: ids[1], pasto_destino_id: PASTOS.B }]));
  const codigosAntes = m.tabela('ANIMAIS').map((a) => [a.animal_id, a.codigo_interno]);
  const novo = (k, extra) => bicho(Object.assign({ animal_id: ids[k], brinco: String(k + 1), valor_abertura: 310000 }, extra || {}));
  const sim = m.simular('corrigir', Object.assign(entradaInicial([novo(0, { raca: 'GUZERA' }), novo(1), novo(2, { brinco: '30', sexo: 'M' })]), { event_id: orig.dados.event_id, justificativa: 'Valor de abertura errado' }));
  assert.equal(sim.ok, true, JSON.stringify(sim.erro));
  assert.deepEqual([sim.valor.dados.simulacao, sim.valor.dados.impactos.animais, sim.valor.dados.impactos.novos, sim.valor.dados.impactos.substitui], [true, 3, 0, orig.dados.event_id]);
  assert.equal(m.contagem().EVENTOS, 2, 'a simulação não grava');
  const sub = m.run('corrigir', Object.assign(entradaInicial([novo(0, { raca: 'GUZERA' }), novo(1), novo(2, { brinco: '30', sexo: 'M', castrado: false, reprodutor: true })]), { event_id: orig.dados.event_id, justificativa: 'Valor de abertura errado' }));
  assert.deepEqual(idsDe(sub).sort(), ids.slice().sort(), 'mesmos animal_id');
  assert.deepEqual(m.tabela('ANIMAIS').map((a) => [a.animal_id, a.codigo_interno]), codigosAntes, 'nenhum animal novo');
  const evO = m.evento(orig.dados.event_id);
  const evS = m.evento(sub.dados.event_id);
  assert.deepEqual([evO.status, evO.reversed_by_event_id, evS.status, evS.reversal_of_event_id, evS.event_type], ['ESTORNADO', sub.dados.event_id, 'CONFIRMADO', orig.dados.event_id, 'ENTRADA_INICIAL']);
  assert.deepEqual(js(evS.payload_json), { justificativa: 'Valor de abertura errado', valor_abertura_origem: 'INFORMADO' });
  assert.equal(m.evento(loc.dados.event_id).status, 'CONFIRMADO', 'a correção posterior continua valendo');
  assert.deepEqual([m.animal(ids[1]).pasto_atual_id, m.animal(ids[0]).raca, m.animal(ids[2]).sexo, m.animal(ids[2]).brinco, m.animal(ids[2]).reprodutor], [PASTOS.B, 'GUZERA', 'M', '30', true]);
  assert.deepEqual(ids.map((x) => m.animal(x).custo_aquisicao), [310000, 310000, 310000]);
  const fins = m.tabela('FINANCEIRO');
  assert.deepEqual(fins.map((f) => [f.event_id, f.status, f.cancelado_por_event_id, f.valor]), [[orig.dados.event_id, 'CANCELADO', sub.dados.event_id, 900000], [sub.dados.event_id, 'ATIVO', null, 930000]]);
  assert.ok(fins[0].cancelado_em, 'instante do cancelamento');
  assert.ok(m.tabela('AUDITORIA').some((a) => a.entidade === 'ANIMAIS' && a.campo === 'raca' && a.valor_novo === 'GUZERA'), 'raça [cad] alterada com auditoria');
  // O brinco antigo (3) foi liberado; o de 2 continua do animal 2.
  assert.equal(m.run('registrar', outraEntrada('2026-05-01', [bicho({ brinco: '3' })])).duplicado, false);
  // Posição: o substituto ocupa a do original; corrigir de novo (cadeia) mudando o pasto do animal 2 quebra a correção de 01/04.
  const e = falha(m, 'corrigir', Object.assign(entradaInicial([novo(0), novo(1, { pasto_destino_id: PASTOS.C }), novo(2, { brinco: '30', sexo: 'M' })]), { event_id: sub.dados.event_id, justificativa: 'Pasto' }));
  assert.deepEqual([e.code, e.details.map((d) => d.conflito && d.conflito.event_id)], ['CONFLICT', [loc.dados.event_id]]);
  // Regras do substituto: mesmo tipo; original já anulado; justificativa.
  assert.deepEqual(codigos(falha(m, 'corrigir', Object.assign(outraEntrada('2026-02-01', [bicho()]), { event_id: sub.dados.event_id, justificativa: 'x' }))), ['TIPO_DIFERENTE']);
  assert.deepEqual(codigos(falha(m, 'corrigir', Object.assign(entradaInicial([novo(0)]), { event_id: orig.dados.event_id, justificativa: 'x' }))), ['JA_ANULADO']);
  assert.ok(codigos(falha(m, 'corrigir', Object.assign(entradaInicial([novo(0), novo(1), novo(2, { brinco: '30', sexo: 'M' })]), { event_id: sub.dados.event_id }))).includes('CAMPO_OBRIGATORIO'));
});

test('substituição que tira um animal criado: ele é anulado (se não tiver dependentes) e o brinco fica livre', () => {
  const m = E.ambienteEventos();
  const orig = m.run('registrar', entradaInicial([bicho({ brinco: '10' }), bicho({ brinco: '11' }), bicho({ brinco: '12', ref: 'm' }), bicho({ brinco: '13', mae_ref: 'm', mae_confianca: 'CONFIRMADA' })]));
  const [a, b, c, d] = idsDe(orig);
  m.run('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-02-01', [{ animal_id: b, pasto_destino_id: PASTOS.B }]));
  const sem = (lista) => Object.assign(entradaInicial(lista), { event_id: orig.dados.event_id, justificativa: 'Animal contado duas vezes' });
  const keep = (x, br) => bicho({ animal_id: x, brinco: br });
  const e = falha(m, 'corrigir', sem([keep(a, '10'), keep(d, '13')]));
  assert.deepEqual([e.code, codigos(e).sort()], ['CONFLICT', ['EVENTO_DEPENDENTE', 'REFERENCIA_GENEALOGICA']]);
  const r = m.run('corrigir', sem([keep(a, '10'), keep(b, '11'), keep(c, '12')]));
  assert.deepEqual([m.animal(d).situacao_cadastral, m.animal(d).brinco, r.dados.animais.length], ['ANULADO', null, 3]);
  assert.equal(m.run('registrar', outraEntrada('2026-03-01', [bicho({ brinco: '13' })])).duplicado, false, 'brinco do anulado liberado');
});

// ------------------------------------------------------------------ estorno ----
test('estorno de entrada sem dependentes: animais ANULADOS, fora das listas, brinco liberado; ESTORNO não se estorna nem se repete', () => {
  const m = E.ambienteEventos();
  const r = m.run('registrar', outraEntrada('2026-03-01', [bicho({ brinco: '0412' }), bicho({ brinco: '99' })]));
  const ids = idsDe(r);
  const sim = m.simular('estornar', { event_id: r.dados.event_id, justificativa: 'Lançado no lugar errado' });
  assert.deepEqual([sim.valor.dados.impactos.estorna, sim.valor.dados.impactos.anulados], [r.dados.event_id, 2]);
  const est = m.run('estornar', { event_id: r.dados.event_id, justificativa: 'Lançado no lugar errado' });
  const evE = m.evento(est.dados.event_id);
  assert.deepEqual([evE.event_type, evE.event_date, evE.reversal_of_event_id, evE.status, evE.property_id, js(evE.payload_json)], ['ESTORNO', E.HOJE, r.dados.event_id, 'CONFIRMADO', E.PROP, { justificativa: 'Lançado no lugar errado' }]);
  assert.equal(m.evento(r.dados.event_id).status, 'ESTORNADO');
  assert.deepEqual(ids.map((x) => [m.animal(x).situacao_cadastral, m.animal(x).brinco, m.animal(x).pasto_atual_id, m.animal(x).evento_origem_id]), [['ANULADO', null, null, null], ['ANULADO', null, null, null]]);
  assert.deepEqual(est.dados.animais.map((a) => a.situacao_cadastral), ['ANULADO', 'ANULADO']);
  assert.equal(m.contagem().EVENTO_ANIMAIS, 2, 'ESTORNO não grava linha filha; nada é apagado');
  assert.equal(m.run('registrar', outraEntrada('2026-03-02', [bicho({ brinco: '412' })])).duplicado, false, 'brinco liberado');
  assert.deepEqual(codigos(falha(m, 'estornar', { event_id: est.dados.event_id, justificativa: 'x' })), ['ESTORNO_NAO_SE_ESTORNA']);
  assert.deepEqual(codigos(falha(m, 'estornar', { event_id: r.dados.event_id, justificativa: 'x' })), ['JA_ANULADO']);
  assert.deepEqual(codigos(falha(m, 'estornar', { event_id: r.dados.event_id })).sort(), ['CAMPO_OBRIGATORIO', 'JA_ANULADO']);
  assert.equal(falha(m, 'estornar', { event_id: E.id(0x12345), justificativa: 'x' }).code, 'NOT_FOUND');
});

test('estorno de entrada com dependentes: bloqueado listando os eventos e as referências; estornados os dependentes, passa', () => {
  const m = E.ambienteEventos();
  const r = m.run('registrar', entradaInicial([bicho({ brinco: '1', ref: 'v', valor_abertura: 100000 }), bicho({ brinco: '2' })]));
  const [vaca, outro] = idsDe(r);
  const filho = m.run('registrar', outraEntrada('2026-02-01', [bicho({ brinco: '3', mae_id: vaca, mae_confianca: 'ESTIMADA' })]));
  const loc = m.run('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-03-01', [{ animal_id: outro, pasto_destino_id: PASTOS.C }]));
  const e = falha(m, 'estornar', { event_id: r.dados.event_id, justificativa: 'Errado' });
  assert.equal(e.code, 'CONFLICT');
  assert.match(e.message, /^Não dá para estornar: 2 registros dependem deste evento\.$/);
  assert.deepEqual(e.details.map((d) => [d.codigo, d.brinco, d.conflito.event_id]).sort(), [['EVENTO_DEPENDENTE', '2', loc.dados.event_id], ['REFERENCIA_GENEALOGICA', '1', filho.dados.event_id]].sort());
  // Estorno da correção (não criadora): o pasto volta; estorno da correção anterior quando há posterior dependente → CONFLICT.
  const loc2 = m.run('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-04-01', [{ animal_id: outro, pasto_destino_id: PASTOS.B }]));
  assert.deepEqual(codigos(falha(m, 'estornar', { event_id: loc.dados.event_id, justificativa: 'x' })), ['ORIGEM_DIVERGENTE']);
  m.run('estornar', { event_id: loc2.dados.event_id, justificativa: 'x' });
  m.run('estornar', { event_id: loc.dados.event_id, justificativa: 'x' });
  assert.equal(m.animal(outro).pasto_atual_id, PASTOS.A);
  m.run('estornar', { event_id: filho.dados.event_id, justificativa: 'x' });
  m.run('estornar', { event_id: r.dados.event_id, justificativa: 'Agora sem dependentes' });
  assert.deepEqual([m.animal(vaca).situacao_cadastral, m.animal(outro).situacao_cadastral, m.animal(vaca).custo_aquisicao], ['ANULADO', 'ANULADO', null]);
  assert.deepEqual(m.tabela('FINANCEIRO').map((f) => [f.status, f.status_pagamento]), [['CANCELADO', 'SEM_CAIXA']]);
  assert.equal(m.inventario('2026-06-01').total, 0);
});

// ------------------------------------------------------------------ ajustes ----
test('correção de cadastro: valor anterior é o da tela, valor igual é recusado, sexo e castração coerentes; brinco lançado errado não bloqueia o reuso', () => {
  const m = E.ambienteEventos();
  const r = m.run('registrar', entradaInicial([bicho({ brinco: '0412', sexo: 'M' }), bicho({ brinco: '500' })]));
  const [x, y] = idsDe(r);
  assert.deepEqual(codigos(falha(m, 'registrar', ajuste('CORRECAO_CADASTRO', '2026-05-01', [{ animal_id: x, campo: 'sexo', valor_novo: 'M' }]))), ['VALOR_IGUAL']);
  assert.deepEqual(codigos(falha(m, 'registrar', ajuste('CORRECAO_CADASTRO', '2026-05-01', [{ animal_id: y, campo: 'castrado', valor_novo: 'S' }]))), ['NAO_SE_APLICA']);
  assert.deepEqual(codigos(falha(m, 'registrar', ajuste('CORRECAO_CADASTRO', '2026-05-01', [{ animal_id: x, campo: 'sexo', valor_novo: 'M' }], { justificativa: '' }))).sort(), ['CAMPO_OBRIGATORIO', 'VALOR_IGUAL']);
  m.run('registrar', ajuste('CORRECAO_CADASTRO', '2026-05-01', [{ animal_id: x, campo: 'castrado', valor_novo: 'S' }, { animal_id: x, campo: 'data_nascimento', valor_novo: '2024-01-01' }, { animal_id: x, campo: 'data_nascimento_confianca', valor_novo: 'ESTIMADA' }]));
  assert.deepEqual([m.animal(x).castrado, m.animal(x).data_nascimento], [true, '2024-01-01']);
  assert.deepEqual(m.tabela('AJUSTES').map((a) => [a.campo, a.valor_anterior, a.valor_novo, a.tipo_ajuste, a.justificativa]), [['castrado', 'N', 'S', 'CORRECAO_CADASTRO', 'Conferência no curral'], ['data_nascimento', null, '2024-01-01', 'CORRECAO_CADASTRO', 'Conferência no curral'], ['data_nascimento_confianca', null, 'ESTIMADA', 'CORRECAO_CADASTRO', 'Conferência no curral']]);
  assert.equal(m.tabela('EVENTO_ANIMAIS').filter((l) => l.animal_id === x).length, 2, 'uma linha por animal no evento de correção');
  assert.deepEqual(codigos(falha(m, 'registrar', ajuste('CORRECAO_CADASTRO', '2026-05-02', [{ animal_id: x, campo: 'data_nascimento', valor_novo: '2026-02-01' }]))), ['ANTES_DO_NASCIMENTO'], 'nascimento depois da entrada já gravada');
  // Identificação incorreta: 0412 era do outro animal; o número fica livre para quem o usa de fato.
  m.run('registrar', ajuste('IDENTIFICACAO_INCORRETA', '2026-06-01', [{ animal_id: x, brinco: '0421' }]));
  assert.deepEqual(codigos(falha(m, 'registrar', ajuste('IDENTIFICACAO_INCORRETA', '2026-06-01', [{ animal_id: y, brinco: '0421' }]))), ['BRINCO_DUPLICADO']);
  m.run('registrar', ajuste('IDENTIFICACAO_INCORRETA', '2026-06-02', [{ animal_id: y, brinco: '0412' }]));
  assert.deepEqual([m.animal(x).brinco, m.animal(y).brinco], ['0421', '0412'], 'reuso bloqueado por padrão, mas o código corrigido não conta (desenho-base 16.2)');
});

// ------------------------------------------------------------------ consultas ----
test('consultas: listar mostra vigentes e anulados (mais recentes primeiro, com filtros e páginas); obter traz linhas e detalhes', () => {
  const m = E.ambienteEventos();
  const r1 = m.run('registrar', entradaInicial([bicho({ brinco: '1', valor_abertura: 1000 })]));
  const r2 = m.run('registrar', outraEntrada('2026-02-01', [bicho({ brinco: '2' })]));
  const est = m.run('estornar', { event_id: r2.dados.event_id, justificativa: 'x' });
  falha(m, 'registrar', outraEntrada('2026-02-01', [bicho({ brinco: '1' })]));
  const l = m.listar();
  assert.deepEqual(l.itens.map((e) => [e.event_type, e.status, e.vigente]), [['ESTORNO', 'CONFIRMADO', false], ['OUTRA_ENTRADA', 'ESTORNADO', false], ['ENTRADA_INICIAL', 'CONFIRMADO', true]]);
  assert.equal(l.itens[1].anulado_por, est.dados.event_id);
  assert.deepEqual(m.listar({ vigentes: true }).itens.map((e) => e.event_id), [r1.dados.event_id]);
  assert.deepEqual(m.listar({ tipo: 'OUTRA_ENTRADA' }).total, 1);
  assert.deepEqual(m.listar({ por_pagina: 2, pagina: 2 }).itens.map((e) => e.event_id), [r1.dados.event_id]);
  assert.deepEqual(m.listar({ animal_id: idsDe(r1)[0] }).itens.map((e) => e.event_id), [r1.dados.event_id]);
  const o = m.obter(r1.dados.event_id);
  assert.deepEqual([o.evento.status, o.linhas.length, o.linhas[0].brinco, o.detalhes.IDENTIFICACOES.length, o.detalhes.FINANCEIRO.length, o.detalhes.ALOCACOES_FINANCEIRAS.length, o.anula], ['CONFIRMADO', 1, '1', 1, 1, 1, null]);
  assert.equal(m.obter(est.dados.event_id).anula.event_id, r2.dados.event_id);
  assert.throws(() => m.obter(E.id(0x999)), (e) => e.code === 'NOT_FOUND');
});

// ------------------------------------------------------------------ categorias ----
test('categorias: classificação pura (manual, idade, condição) e cobertura total das sementes; desativar uma abre as lacunas', () => {
  const m = E.ambienteEventos({ order: 'reverse' });
  const S = m.G.EventService;
  const cats = m.categorias;
  const c = (perfil, data) => { const r = S.classificarCategoria(perfil, data, cats); return r ? r.codigo : null; };
  assert.equal(c({ sexo: 'M', data_nascimento: '2025-03-20', castrado: false, reprodutor: false }, '2026-11-13'), 'GARROTE');
  assert.equal(c({ sexo: 'F', data_nascimento: '2024-05-10', parida: false }, '2026-11-13'), 'NOVILHA_24_MAIS');
  assert.equal(c({ sexo: 'F', data_nascimento: '2024-05-10', parida: true }, '2026-11-13'), 'VACA');
  assert.equal(c({ sexo: 'M', data_nascimento: '2020-01-01', castrado: false, reprodutor: true }, '2026-11-13'), 'TOURO');
  assert.equal(c({ sexo: 'M', data_nascimento: '2026-10-01', castrado: false, reprodutor: false }, '2026-11-13'), 'BEZERRO');
  assert.equal(c({ sexo: 'M', data_nascimento: null, castrado: false, reprodutor: false }, '2026-11-13'), null, 'sem nascimento só casa categoria sem idade');
  assert.equal(c({ sexo: 'F', categoria_modo: 'MANUAL', categoria_manual_id: cats.find((x) => x.codigo === 'VACA').category_id, data_nascimento: '2026-01-01' }, '2026-11-13'), 'VACA');
  const cob = js(S.coberturaCategorias(cats));
  assert.deepEqual([cob.completa, cob.testes, cob.lacunas], [true, 20, []]);
  const sem = cats.map((x) => (x.codigo === 'NOVILHA_24_MAIS' ? Object.assign({}, x, { ativo: false }) : x));
  assert.deepEqual(js(S.coberturaCategorias(sem).lacunas), [
    { perfil: 'FEMEA_NAO_PARIDA', rotulo: 'fêmea não parida', idade_de: 24, idade_ate: 36 },
    { perfil: 'FEMEA_NAO_PARIDA', rotulo: 'fêmea não parida', idade_de: 36, idade_ate: null },
  ]);
});

test('outra entrada de animal já cadastrado: só volta quem está fora; estorno pela simulação lista o bloqueio; estornar o brinco corrigido devolve o anterior', () => {
  const m = E.ambienteEventos();
  const r = m.run('registrar', entradaInicial([bicho({ brinco: '0412' }), bicho({ brinco: '15' })]));
  const [x, y] = idsDe(r);
  assert.deepEqual(codigos(falha(m, 'registrar', outraEntrada('2026-03-01', [{ animal_id: x, pasto_destino_id: PASTOS.B }]))), ['JA_NO_REBANHO']);
  assert.deepEqual(codigos(falha(m, 'registrar', outraEntrada('2026-03-01', [{ animal_id: x, pasto_destino_id: PASTOS.B, sexo: 'M' }]))).sort(), ['CAMPO_NAO_SE_APLICA', 'JA_NO_REBANHO']);
  assert.deepEqual(codigos(falha(m, 'registrar', outraEntrada('2026-03-01', [{ animal_id: E.id(0x777), pasto_destino_id: PASTOS.B }]))), ['NAO_ENCONTRADO']);
  assert.deepEqual(codigos(falha(m, 'registrar', entradaInicial([{ animal_id: x, pasto_destino_id: PASTOS.B }]))), ['SO_ANIMAIS_NOVOS']);
  assert.deepEqual(codigos(falha(m, 'registrar', { tipo: 'ESTORNO', campos: {}, animais: [] })), ['TIPO_INVALIDO']);
  const loc = m.run('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-04-01', [{ animal_id: y, pasto_destino_id: PASTOS.B }]));
  const sim = m.simular('estornar', { event_id: r.dados.event_id, justificativa: 'x' });
  assert.deepEqual([sim.ok, sim.erro.code, sim.erro.details.map((d) => d.conflito.event_id)], [false, 'CONFLICT', [loc.dados.event_id]]);
  const corr = m.run('registrar', ajuste('IDENTIFICACAO_INCORRETA', '2026-05-01', [{ animal_id: x, brinco: '0421' }]));
  assert.deepEqual(codigos(falha(m, 'registrar', ajuste('IDENTIFICACAO_INCORRETA', '2026-05-01', [{ animal_id: x, brinco: '421' }]))), ['VALOR_IGUAL']);
  m.run('estornar', { event_id: corr.dados.event_id, justificativa: 'O brinco estava certo' });
  assert.deepEqual([m.animal(x).brinco, m.tabela('IDENTIFICACOES').filter((i) => i.animal_id === x && i.codigo === '0412')[0].data_fim], ['0412', null]);
});
