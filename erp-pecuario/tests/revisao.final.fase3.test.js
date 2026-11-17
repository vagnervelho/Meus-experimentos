'use strict';
/**
 * Revisão final da Fase 3 (conserto), achados do servidor: a agenda do protocolo restrito a uma categoria conta do dia em
 * que o animal entrou nela; a correção de uma aplicação mantém as cópias congeladas do cadastro (carência, nome e
 * fabricante) e o protocolo que o original cumpria; o cadastro não troca o procedimento de um protocolo já cumprido; os
 * indicadores anuais recusam o ano que ainda não começou na data; o vazio do GMD por categoria e por pasto traz o porquê
 * verdadeiro; o bezerro descartado não é "vendido ao pé"; e o histórico de antes do marco zero cita o animal pelo número que
 * ele tinha no marco zero. Cada teste falha com o `src/` de antes desta etapa (commit 11b744a).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js, PASTOS } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
const TODOS = ['PESO_IMPLAUSIVEL', 'POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'ESTOQUE_INSUFICIENTE', 'PRODUTO_VENCIDO', 'CARENCIA_ATIVA', 'IDADE_REPRODUTIVA', 'CATEGORIAS_SEM_COBERTURA'];

function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave || 'k-' + Math.random(), avisosAceitos: avisos || [] })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + String(JSON.stringify(r.error)).slice(0, 1500));
  return r.data;
}
const hoje = (s, iso) => { s.gas.clock.now = Date.parse(iso + 'T15:00:00.000Z'); };
function rebanho(s, bichos) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(bichos)), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}
const tab = (s, aba, filtro) => s.tabela(aba).filter((r) => Object.keys(filtro || {}).every((k) => r[k] === filtro[k]));

test('achado 1: a agenda do protocolo restrito a uma categoria vence no dia em que o animal entrou nela — A CADA N DIAS nunca aplicado (o bezerro que vira garrote) e CAMPANHA (a novilha que vira vaca depois da campanha); a ficha e o alerta da Início seguem a agenda', () => {
  const s = S.sistema();
  hoje(s, '2026-01-02');
  const cats = s.tabela('CATEGORIAS');
  const GAR = cats.find((c) => c.codigo === 'GARROTE').category_id;
  const VACA = cats.find((c) => c.codigo === 'VACA').category_id;
  ok(api(s, 'protocolo.salvar', { campos: { nome: 'Vermífugo dos garrotes', tipo_procedimento: 'VERMIFUGO', sexo_aplicavel: 'M', category_id: GAR, recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 120, antecedencia_alerta_dias: 15 } }), 'garrotes');
  const pc = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Vacina das vacas (maio)', tipo_procedimento: 'VACINA', sexo_aplicavel: 'F', category_id: VACA, recorrencia_tipo: 'CAMPANHA_MESES', meses_campanha: [5], tolerancia_dias: 7, antecedencia_alerta_dias: 15 } }), 'campanha');
  const pi = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Vermífugo das vacas', tipo_procedimento: 'VERMIFUGO', sexo_aplicavel: 'F', category_id: VACA, recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180, antecedencia_alerta_dias: 15 } }), 'vacas');
  ok(api(s, 'protocolo.salvar', { campos: { nome: 'Marcação das vacas', tipo_procedimento: 'VACINA', sexo_aplicavel: 'F', category_id: VACA, recorrencia_tipo: 'UNICA' } }), 'única');
  hoje(s, '2026-11-17');
  const id = rebanho(s, [
    S.bicho({ brinco: 'B1', sexo: 'M', data_nascimento: '2025-10-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: 'V1', sexo: 'F', data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 2 }),
    S.bicho({ brinco: 'N1', sexo: 'F', data_nascimento: '2023-10-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 0 }),
  ]);
  ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-05-10', nome_produto: 'Vacina X', modo_dose: 'POR_CABECA', dose_referencia: 1, unidade_dose: 'dose', protocol_id: pc.protocol_id }, animais: [{ animal_id: id.V1 }] }, null, TODOS), 'vacina V1');
  ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: { event_date: '2026-06-01', nome_produto: 'Verm Y', modo_dose: 'POR_CABECA', dose_referencia: 10, unidade_dose: 'mL', protocol_id: pi.protocol_id }, animais: [{ animal_id: id.V1 }] }, null, TODOS), 'vermífugo V1');
  ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-06-15' }, animais: [{ animal_id: id.N1 }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] }, null, TODOS), 'parto N1');
  semErro(s, 'base');
  const cat = (b, D) => ok(api(s, 'inventario.posicao', { animal_id: id[b], data: D })).categoria.codigo;
  assert.deepEqual([cat('B1', '2026-09-30'), cat('B1', '2026-10-01'), cat('N1', '2026-06-14'), cat('N1', '2026-06-15')], ['BEZERRO', 'GARROTE', 'NOVILHA_24_MAIS', 'VACA']);
  const pend = (b, D) => ok(api(s, 'sanidade.agenda', { data: D })).pendencias.filter((p) => p.animal_id === id[b]).map((p) => [p.nome, p.situacao, p.vencimento, p.dias]).sort();
  // O garrote nunca vermifugado vence no dia em que virou garrote (não na entrada no rebanho, quando era bezerro).
  assert.deepEqual(pend('B1', '2026-09-30'), []);
  assert.deepEqual(pend('B1', '2026-10-01'), [['Vermífugo dos garrotes', 'PROXIMA', '2026-10-01', 0]]);
  assert.deepEqual(ok(api(s, 'sanidade.agenda', { data: '2026-10-01' })).pendencias.filter((p) => p.nome === 'Vermífugo dos garrotes' && p.situacao === 'VENCIDA'), []);
  // A novilha que vira vaca no parto: o vermífugo e a marcação única vencem no dia do parto; a campanha de maio passou antes de
  // ela ser vaca (não é devida; a próxima é a de maio de 2027).
  assert.deepEqual(pend('N1', '2026-06-15'), [['Marcação das vacas', 'PROXIMA', '2026-06-15', 0], ['Vermífugo das vacas', 'PROXIMA', '2026-06-15', 0]]);
  assert.deepEqual(pend('N1', '2026-07-01'), [['Marcação das vacas', 'VENCIDA', '2026-06-15', 16], ['Vermífugo das vacas', 'VENCIDA', '2026-06-15', 16]]);
  // A ficha de hoje e o alerta da Início usam a mesma agenda.
  const ficha = ok(api(s, 'animal.ficha', { animal_id: id.N1 })).sanitario.proximas.filter((p) => p.situacao !== 'EM_DIA').map((p) => [p.nome, p.situacao, p.vencimento]).sort();
  assert.deepEqual(ficha, pend('N1', '2026-11-17').map((p) => [p[0], p[1], p[2]]));
  assert.ok(ficha.every((p) => p[2] >= '2026-06-15'), 'nada vencido antes de ela ser vaca: ' + JSON.stringify(ficha));
  // A vaca de sempre continua vencendo desde a entrada no rebanho (sem regressão).
  assert.deepEqual(pend('V1', '2026-03-01').filter((p) => p[0] === 'Marcação das vacas'), [['Marcação das vacas', 'VENCIDA', '2026-01-01', 59]]);
});

test('achado 2: a correção de uma aplicação gravada sem carência não ganha a carência padrão de hoje do produto (a correção do veterinário é aceita mesmo com a venda para abate dentro da carência nova); pela API, o vazio mantém os 21 dias do original quando o cadastro mudou para 60', () => {
  const cenario = (comVenda) => {
    const s = S.sistema();
    hoje(s, '2026-01-05');
    const id = rebanho(s, [S.bicho({ brinco: '100', sexo: 'M', castrado: true, data_nascimento: '2023-01-01', data_nascimento_confianca: 'CONFIRMADA' }), S.bicho({ brinco: '101', sexo: 'M', castrado: true, data_nascimento: '2023-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
    hoje(s, '2026-04-01');
    const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Vermífugo Y', categoria: 'VERMIFUGO', unidade: 'mL' } }), 'produto');
    const campos = { event_date: '2026-03-01', produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 5, veterinario: 'Dr. A' };
    const v = ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos, animais: [{ animal_id: id['100'] }] }, null, TODOS), 'aplicação');
    assert.deepEqual(tab(s, 'SANIDADE', { event_id: v.event_id }).map((r) => [r.periodo_carencia_dias, r.data_fim_carencia]), [[null, null]]);
    if (comVenda) {
      const comprador = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } }), 'comprador').partner_id;
      ok(api(s, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-03-20', partner_id: comprador, finalidade: 'ABATE', valor_bruto: 300000, modalidade: 'CABECA', preco_unitario: 300000 }, animais: [{ animal_id: id['100'] }], parcelas: [{ data_vencimento: '2026-04-20', valor: 300000 }], deducoes: [] }, null, TODOS), 'venda');
    }
    ok(api(s, 'produto.salvar', { product_id: p.product_id, campos: { carencia_padrao_dias: 30 }, justificativa: 'Carência da bula' }), 'carência no cadastro');
    const r = ok(api(s, 'evento.corrigir', { event_id: v.event_id, justificativa: 'Nome do veterinário', tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: Object.assign({}, campos, { veterinario: 'Dr. B' }), animais: [{ animal_id: id['100'] }] }, null, ['PESO_IMPLAUSIVEL']), 'correção');
    assert.deepEqual(tab(s, 'SANIDADE', { event_id: r.event_id }).map((x) => [x.periodo_carencia_dias, x.data_fim_carencia, x.veterinario]), [[null, null, 'Dr. B']]);
    assert.deepEqual(ok(api(s, 'sanidade.agenda', { data: '2026-03-10' })).carencia, []);
    // Uma aplicação nova do produto recebe a carência de hoje (o cadastro vale para a frente).
    const nova = ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: Object.assign({}, campos, { event_date: '2026-03-31' }), animais: [{ animal_id: id['101'] }] }, null, TODOS), 'nova');
    assert.deepEqual(tab(s, 'SANIDADE', { event_id: nova.event_id }).map((x) => x.periodo_carencia_dias), [30]);
    semErro(s, 'carência');
  };
  cenario(false);
  cenario(true);
  // 21 dias no original, 60 no cadastro de hoje: a correção sem o campo mantém 21; com outro produto, a padrão do outro.
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const id = rebanho(s, [S.bicho({ brinco: '100', sexo: 'M', castrado: true, data_nascimento: '2023-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-04-01');
  const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Ivermectina', categoria: 'VERMIFUGO', unidade: 'mL', carencia_padrao_dias: 21 } }), 'produto');
  const outro = ok(api(s, 'produto.salvar', { campos: { nome: 'Doramectina', categoria: 'VERMIFUGO', unidade: 'mL', carencia_padrao_dias: 35 } }), 'outro');
  const campos = { event_date: '2026-03-01', produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 5 };
  const v = ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos, animais: [{ animal_id: id['100'] }] }, null, TODOS), 'aplicação');
  ok(api(s, 'produto.salvar', { product_id: p.product_id, campos: { carencia_padrao_dias: 60 }, justificativa: 'Bula nova' }), '60 dias');
  const r = ok(api(s, 'evento.corrigir', { event_id: v.event_id, justificativa: 'Lote', tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: Object.assign({}, campos, { lote: 'L9' }), animais: [{ animal_id: id['100'] }] }, null, TODOS), 'correção do lote');
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: r.event_id }).map((x) => [x.periodo_carencia_dias, x.data_fim_carencia]), [[21, '2026-03-22']]);
  const r2 = ok(api(s, 'evento.corrigir', { event_id: r.event_id, justificativa: 'Outro produto', tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: Object.assign({}, campos, { produto_id: outro.product_id }), animais: [{ animal_id: id['100'] }] }, null, TODOS), 'outro produto');
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: r2.event_id }).map((x) => x.periodo_carencia_dias), [35]);
  semErro(s, 'carência 21');
});

test('achado 17: o nome e o fabricante do produto, cópias congeladas do cadastro, não mudam na correção de outro campo da aplicação depois de o cadastro mudar', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const id = rebanho(s, [S.bicho({ brinco: '100', sexo: 'M', castrado: true, data_nascimento: '2023-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-04-01');
  const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Aftosa Lab A', categoria: 'VACINA', unidade: 'dose', carencia_padrao_dias: 0 } }), 'produto');
  const campos = { event_date: '2026-03-01', produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1, periodo_carencia_dias: 0, veterinario: 'Dr. A' };
  const v = ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos, animais: [{ animal_id: id['100'] }] }, null, TODOS), 'aplicação');
  ok(api(s, 'produto.salvar', { product_id: p.product_id, campos: { nome: 'Aftosa Lab B (novo fornecedor)' }, justificativa: 'trocou o fornecedor' }), 'renomeia');
  const r = ok(api(s, 'evento.corrigir', { event_id: v.event_id, justificativa: 'veterinário', tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: Object.assign({}, campos, { veterinario: 'Dr. B' }), animais: [{ animal_id: id['100'] }] }, null, TODOS), 'correção');
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: r.event_id }).map((x) => x.nome_produto), ['Aftosa Lab A']);
  // O formulário que manda o nome gravado (o de antes) junto com o produto também é aceito, e o nome continua o congelado.
  const r1 = ok(api(s, 'evento.corrigir', { event_id: r.event_id, justificativa: 'lote', tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: Object.assign({}, campos, { nome_produto: 'Aftosa Lab A', lote: 'L1' }), animais: [{ animal_id: id['100'] }] }, null, TODOS), 'correção com o nome');
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: r1.event_id }).map((x) => x.nome_produto), ['Aftosa Lab A']);
  const p2 = ok(api(s, 'produto.salvar', { campos: { nome: 'Vermífugo Z', categoria: 'VERMIFUGO', unidade: 'mL', carencia_padrao_dias: 0 } }), 'produto 2');
  const c2 = { event_date: '2026-03-05', produto_id: p2.product_id, modo_dose: 'POR_CABECA', dose_referencia: 5, periodo_carencia_dias: 0, veterinario: 'Dr. A' };
  const v2 = ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: c2, animais: [{ animal_id: id['100'] }] }, null, TODOS), 'aplicação 2');
  ok(api(s, 'produto.salvar', { product_id: p2.product_id, campos: { fabricante: 'Lab Novo' }, justificativa: 'completa' }), 'fabricante');
  const r2 = ok(api(s, 'evento.corrigir', { event_id: v2.event_id, justificativa: 'veterinário', tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: Object.assign({}, c2, { veterinario: 'Dr. B' }), animais: [{ animal_id: id['100'] }] }, null, TODOS), 'correção 2');
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: r2.event_id }).map((x) => x.fabricante), [null]);
  // A aplicação nova copia o cadastro de hoje.
  const n = ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: Object.assign({}, c2, { event_date: '2026-03-20' }), animais: [{ animal_id: id['100'] }] }, null, TODOS), 'nova');
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: n.event_id }).map((x) => x.fabricante), ['Lab Novo']);
  semErro(s, 'cópias');
});

test('achado 11: o procedimento de um protocolo já cumprido não muda no cadastro (PROTOCOLO_EM_USO), e numa base em que mudou a correção sem mudança da aplicação antiga que o cumpria continua aceita', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const id = rebanho(s, [S.bicho({ brinco: '100', sexo: 'M', castrado: true, data_nascimento: '2023-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-04-01');
  const pr = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Controle de verminose', tipo_procedimento: 'VERMIFUGO', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 90 } }), 'protocolo');
  const livre = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Sem uso', tipo_procedimento: 'VERMIFUGO', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'UNICA' } }), 'sem uso');
  const campos = { event_date: '2026-03-01', protocol_id: pr.protocol_id, nome_produto: 'Ivermectina', modo_dose: 'POR_CABECA', dose_referencia: 5, unidade_dose: 'mL', periodo_carencia_dias: 0, veterinario: 'Dr. A' };
  const v = ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos, animais: [{ animal_id: id['100'] }] }, null, TODOS), 'aplicação');
  const m = api(s, 'protocolo.salvar', { protocol_id: pr.protocol_id, campos: { tipo_procedimento: 'MEDICAMENTO' }, justificativa: 'reclassificado' });
  assert.equal(m.ok, false);
  assert.deepEqual(m.error.details.map((d) => d.codigo), ['PROTOCOLO_EM_USO']);
  // O protocolo nunca cumprido muda de procedimento livremente.
  ok(api(s, 'protocolo.salvar', { protocol_id: livre.protocol_id, campos: { tipo_procedimento: 'MEDICAMENTO' }, justificativa: 'era outro' }), 'sem uso muda');
  // Base anterior à regra: o procedimento já tinha sido trocado. A correção do veterinário da aplicação que o cumpria passa.
  s.editar('PROTOCOLOS_SANITARIOS', pr.protocol_id, 'tipo_procedimento', 'MEDICAMENTO');
  const r = ok(api(s, 'evento.corrigir', { event_id: v.event_id, justificativa: 'veterinário', tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: Object.assign({}, campos, { veterinario: 'Dr. B' }), animais: [{ animal_id: id['100'] }] }, null, TODOS), 'correção');
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: r.event_id }).map((x) => [x.protocol_id, x.veterinario]), [[pr.protocol_id, 'Dr. B']]);
  // Um lançamento novo de vermífugo com esse protocolo continua recusado (o cadastro de hoje vale para a frente).
  const n = api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: Object.assign({}, campos, { event_date: '2026-03-20' }), animais: [{ animal_id: id['100'] }] }, null, TODOS);
  assert.equal(n.ok, false);
  assert.ok(n.error.details.some((d) => d.codigo === 'PROTOCOLO_DE_OUTRO_PROCEDIMENTO'));
});

test('achado 8: os indicadores anuais recusam o ano que ainda não começou na data (hoje ou a data pedida), com DATA_FUTURA', () => {
  const s = S.sistema();
  hoje(s, '2026-11-17');
  const id = rebanho(s, ['V1', 'V2', 'V3', 'V4', 'V5'].map((b) => S.bicho({ brinco: b, sexo: 'F', data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }))
    .concat(['N1', 'N2', 'N3'].map((b) => S.bicho({ brinco: b, sexo: 'F', data_nascimento: '2024-12-15', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 0 }))));
  ['V1', 'V2'].forEach((b, i) => ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-0' + (5 + i) + '-10' }, animais: [{ animal_id: id[b] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] }, null, TODOS), 'parto ' + b));
  const a = ok(api(s, 'reproducao.indicadores', { ano: '2026' })).anual;
  assert.deepEqual([a.matrizes_no_inicio, a.partos, a.natalidade_anual.valor], [5, 2, 40]);
  [[{ ano: '2027' }, '17/11/2026'], [{ ano: '2027', data: '2026-03-01' }, '01/03/2026']].forEach(([d, br]) => {
    const r = api(s, 'reproducao.indicadores', d);
    assert.equal(r.ok, false, JSON.stringify(d));
    assert.equal(r.error.code, 'VALIDATION');
    assert.deepEqual(r.error.details.map((x) => [x.codigo, x.campo]), [['DATA_FUTURA', 'ano']]);
    assert.match(r.error.message, new RegExp('2027 ainda não começou em ' + br));
  });
  // Um ano passado em D continua respondendo.
  assert.equal(ok(api(s, 'reproducao.indicadores', { ano: '2026', data: '2026-03-01' })).anual.fim, '2026-03-01');
});

test('achado 9: no desempenho por categoria (e por pasto), o vazio do GMD diz o porquê verdadeiro — o ganho conta na categoria do início de cada intervalo — e nunca "nenhum animal com duas pesagens" quando todos têm', () => {
  const s = S.sistema();
  hoje(s, '2026-11-17');
  const br = ['1', '2', '3', '4', '5'];
  const id = rebanho(s, br.map((b) => S.bicho({ brinco: b, sexo: 'M', data_nascimento: '2025-08-01', data_nascimento_confianca: 'CONFIRMADA' })));
  const pesar = (data, base) => ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: data, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: br.map((b, i) => ({ animal_id: id[b], peso: base + i })) }, null, TODOS), 'pesagem ' + data);
  pesar('2026-03-01', 150);
  pesar('2026-06-01', 210);
  ok(api(s, 'evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-07-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: br.map((b) => ({ animal_id: id[b] })) }, null, TODOS), 'transferência');
  const d = ok(api(s, 'peso.desempenho', { de: '2026-01-01', ate: '2026-09-30' }));
  const linhas = d.por_categoria.map((c) => [c.nome, c.cabecas, c.gmd.valor, c.gmd.n]);
  assert.deepEqual(linhas, [['Bezerro', 0, 0.652, 5], ['Garrote', 5, null, 0]]);
  const gar = d.por_categoria.find((c) => c.nome === 'Garrote').gmd.explicacao;
  assert.doesNotMatch(gar, /duas pesagens individuais no período/);
  assert.match(gar, /categoria do animal no início/);
  // O pasto para onde foram depois da última pesagem: o porquê do pasto.
  const pB = d.por_pasto.find((p) => p.pasture_id === PASTOS.B);
  assert.deepEqual([pB.cabecas, pB.gmd.valor, pB.gmd.n], [5, null, 0]);
  assert.match(pB.gmd.explicacao, /pastos em que o animal ficou entre elas/);
  const fB = ok(api(s, 'peso.desempenho', { de: '2026-01-01', ate: '2026-09-30', pasture_id: PASTOS.B })).geral.gmd;
  assert.match(fB.explicacao, /neste pasto/);
  // Sem nenhum intervalo com o mínimo de dias, o geral diz isso (não "duas pesagens").
  const s2 = S.sistema();
  hoje(s2, '2026-11-17');
  const id2 = rebanho(s2, [S.bicho({ brinco: '9', sexo: 'M', data_nascimento: '2024-08-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  ['2026-03-01', '2026-03-11'].forEach((dt, i) => ok(api(s2, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: dt, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id2['9'], peso: 300 + i }] }, null, TODOS), 'p ' + dt));
  assert.match(ok(api(s2, 'peso.desempenho', {})).geral.gmd.explicacao, /ao menos 28 dias entre a primeira e a última/);
});

test('achado 10: nos indicadores da estação, o bezerro descartado (sacrifício) antes da desmama não é "vendido ao pé": conta à parte como descartado, e o morto continua na mortalidade', () => {
  const s = S.sistema();
  hoje(s, '2026-11-17');
  const vacas = ['V1', 'V2', 'V3', 'V4', 'V5'];
  const id = rebanho(s, vacas.map((b) => S.bicho({ brinco: b, sexo: 'F', data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }))
    .concat([S.bicho({ brinco: 'T1', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA' })]));
  const est = ok(api(s, 'estacao.salvar', { campos: { nome: 'E1', data_inicio: '2026-01-10', data_fim: '2026-03-31', tipo: 'MONTA_NATURAL' } }), 'estação');
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-01-10', estacao_id: est.estacao_id }, animais: vacas.map((b) => ({ animal_id: id[b] })).concat([{ animal_id: id.T1 }]) }, null, TODOS), 'exposição');
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-05-15', estacao_id: est.estacao_id }, animais: vacas.map((b) => ({ animal_id: id[b], resultado: 'POSITIVO', idade_gestacional_dias: 120 })) }, null, TODOS), 'diagnóstico');
  vacas.forEach((b, i) => ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-10-' + (20 + i) }, animais: [{ animal_id: id[b] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M' }] }, null, TODOS), 'parto ' + b));
  const cria = (b) => s.tabela('ANIMAIS').find((a) => a.mae_id === id[b]).animal_id;
  ok(api(s, 'evento.registrar', { tipo: 'DESCARTE', campos: { event_date: '2026-11-10', destino: 'SACRIFICIO', motivo: 'DEFEITO' }, animais: [{ animal_id: cria('V1') }] }, null, TODOS), 'descarte');
  ok(api(s, 'evento.registrar', { tipo: 'MORTE', campos: { event_date: '2026-11-11', causa: 'DOENCA' }, animais: [{ animal_id: cria('V2') }] }, null, TODOS), 'morte');
  semErro(s, 'estação');
  const g = ok(api(s, 'reproducao.indicadores', { estacao_id: est.estacao_id })).estacao.geral;
  assert.deepEqual([g.nascidos_vivos, g.mortos_antes_da_desmama, g.vendidos_ao_pe, g.descartados_ao_pe], [5, 1, 0, 1]);
  assert.deepEqual([g.mortalidade_ate_desmama.numerador, g.mortalidade_ate_desmama.denominador], [1, 5]);
});

test('achado 16: o histórico de antes do marco zero cita o animal pelo número que ele tinha no marco zero — o desempenho, a descrição do resolvedor e os elegíveis dão o mesmo brinco que o resolvedor acha', () => {
  const s = S.sistema();
  hoje(s, '2026-11-17');
  const id = rebanho(s, ['100', '101'].map((b) => S.bicho({ brinco: b, sexo: 'M', castrado: true, data_nascimento: '2024-03-01', data_nascimento_confianca: 'CONFIRMADA', data_entrada: '2024-06-01', data_entrada_confianca: 'CONFIRMADA' })));
  const MAPA = { colunas: { 'Nº da pesagem': 'grupo', 'Data da pesagem': 'data', Brinco: 'brinco', 'Peso (kg)': 'peso' }, confiancas: {}, padroes: { momento: 'ROTINA', metodo: 'BALANCA' } };
  const csv = ['Nº da pesagem;Data da pesagem;Brinco;Peso (kg)', ';01/07/2025;100;200', ';15/09/2025;100;250', ';20/11/2025;100;280'].join('\n');
  const c = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'criar', dados: { tipo: 'PESAGENS', arquivo_nome: 'p.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
  for (let b = 1; b < 20; b++) {
    const e = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'v' + b, dados: { import_id: c.import_id, bloco: b, mapeamento: MAPA } })).dados;
    if (e.importacao.status === 'VALIDADO') break;
  }
  let r = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: c.import_id, bloco: 1, modo: 'TOTAL' } }));
  for (let b = 2; r.ok && r.valor.dados.blocos.proximo !== null; b++) r = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: c.import_id, bloco: b } }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } }));
  // Hoje o 100 tem outro brinco: a data passada continua no número do marco zero.
  ok(api(s, 'evento.registrar', { tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-06-01', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: id['100'], codigo: '777', motivo: 'PERDA' }] }, null, TODOS), 'troca');
  semErro(s, 'histórico');
  const d = ok(api(s, 'peso.desempenho', { de: '2025-06-01', ate: '2025-12-31' }));
  assert.deepEqual(d.animais.map((a) => [a.animal_id === id['100'], a.brinco]), [[true, '100']]);
  const res = ok(api(s, 'animal.resolver', { textos: ['100'], data: '2025-09-15' }));
  const t = res.textos[0];
  assert.deepEqual([t.situacao, t.como, t.animal_id, t.brinco, res.animais[id['100']].brinco], ['ACHADO', 'HISTORICO', id['100'], '100', '100']);
  // A descrição do mesmo animal, no mesmo dia, por outro caminho (o leitor do servidor).
  const desc = s.read({ rota: 't', reads: s.G.AnimalService.leituras(), acessoCru: true, tratador: (tx) => { const L = s.G.AnimalService.leitor(tx); return s.G.Identificacao.descrever(L, tx.repo.porId('ANIMAIS', id['100']), '2025-09-15', null); } });
  assert.equal(desc.brinco, '100');
  // Depois do marco zero, o número do dia (sem regressão): 100 até 31/05, 777 desde 01/06.
  assert.deepEqual(['2026-05-31', '2026-06-01'].map((D) => ok(api(s, 'animal.resolver', { ids: [id['100']], data: D })).animais[id['100']].brinco), ['100', '777']);
});
