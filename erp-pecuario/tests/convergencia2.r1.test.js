'use strict';
/**
 * Segunda convergência da Fase 3, rodada 1 da revisão: os achados do servidor. Cada teste reproduz um achado pelo cenário
 * mínimo, falha com o `src/` de antes do conserto (commit 67ac9de) e passa agora; o conserto está na causa (o ponto único da
 * correção, a regra única do indicador, a validação única do comando), e o oráculo do teste aleatório que deixou o defeito
 * passar foi estendido (CONTRATOS, seção 53).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js } = S;
const TODOS = ['PESO_IMPLAUSIVEL', 'POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'ESTOQUE_INSUFICIENTE', 'PRODUTO_VENCIDO', 'CARENCIA_ATIVA', 'IDADE_REPRODUTIVA', 'CATEGORIAS_SEM_COBERTURA', 'RATEIO_SEM_PESO', 'VALOR_DIVERGENTE', 'INTERVALO_PARTO_CURTO', 'BRINCO_PARECIDO'];

let n = 0;
function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave || 'c2r1-' + (++n), avisosAceitos: avisos || TODOS })));
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
  return { ids, event_id: r.event_id };
}
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}
const tab = (s, aba, filtro) => s.tabela(aba).filter((r) => Object.keys(filtro || {}).every((k) => r[k] === filtro[k]));
const machos = (q, base) => Array.from({ length: q }, (_, i) => S.bicho({ brinco: String((base || 100) + i), sexo: 'M', castrado: true, data_nascimento: '2023-01-01', data_nascimento_confianca: 'CONFIRMADA' }));

// ------------------------------------------------------------------ ALTA ----

test('achado 1: o diagnóstico sem estação é da exposição mais recente da fêmea antes dele — não conta como o último diagnóstico de toda estação cuja faixa o cobre (a estação anterior não ganha prenhez nem perda gestacional falsas)', () => {
  const s = S.sistema();
  hoje(s, '2026-01-02');
  const vacas = Array.from({ length: 5 }, (_, i) => S.bicho({ brinco: 'V' + i, sexo: 'F', data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }));
  const touro = S.bicho({ brinco: 'T1', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA' });
  const { ids } = rebanho(s, vacas.concat([touro]));
  const V = Object.keys(ids).filter((b) => b[0] === 'V').map((b) => ids[b]);
  const est = (nome, ini, fim) => ok(api(s, 'estacao.salvar', { campos: { nome, data_inicio: ini, data_fim: fim, property_id: S.PROP, tipo: 'MONTA_NATURAL' } }), nome).estacao_id;
  const E1 = est('Estação águas 2026', '2026-01-01', '2026-03-31');
  const E2 = est('Estação seca 2026', '2026-07-01', '2026-09-30');
  const expo = (data, fim, e) => ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: data, data_fim: fim, estacao_id: e }, animais: V.map((id) => ({ animal_id: id })).concat([{ animal_id: ids.T1 }]) }), 'exposição ' + data);
  const dg = (data, res, e) => ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: Object.assign({ event_date: data, metodo: 'PALPACAO' }, e ? { estacao_id: e } : {}), animais: V.map((id) => ({ animal_id: id, resultado: res })) }), 'diagnóstico ' + data);
  hoje(s, '2026-11-18');
  expo('2026-01-05', '2026-03-31', E1);
  dg('2026-05-10', 'NEGATIVO', E1);
  expo('2026-07-01', '2026-09-30', E2);
  dg('2026-11-15', 'POSITIVO', null); // o tronco no padrão "Sem estação"
  const ind = (e) => ok(api(s, 'reproducao.indicadores', { estacao_id: e }), 'indicadores').estacao.geral;
  const e1 = ind(E1);
  assert.deepEqual([e1.expostas, e1.diagnosticadas, e1.prenhas, e1.prenhez.valor], [5, 5, 0, 0], 'a 1ª estação: o diagnóstico dela deu todas vazias');
  const e2 = ind(E2);
  assert.deepEqual([e2.expostas, e2.diagnosticadas, e2.prenhas, e2.prenhez.valor], [5, 5, 5, 100]);
  // Mais tarde as vacas parem da 2ª estação: a 1ª não tem perda gestacional (nenhuma prenha nela).
  hoje(s, '2027-05-20');
  V.forEach((id, i) => ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2027-05-0' + (i + 1) }, animais: [{ animal_id: id }], crias: [{ situacao_nascimento: 'VIVO', sexo: i % 2 ? 'M' : 'F', brinco: 'C' + i }] }), 'parto ' + i));
  const e1b = ind(E1);
  assert.equal(e1b.prenhas, 0);
  assert.deepEqual([e1b.perda_gestacional.numerador, e1b.perda_gestacional.denominador, e1b.perda_gestacional.valor, e1b.perda_gestacional.motivo], [0, 0, null, 'DADOS_INSUFICIENTES']);
  const e2b = ind(E2);
  assert.deepEqual([e2b.prenhas, e2b.paridas, e2b.perda_gestacional.numerador], [5, 5, 0]);
  semErro(s, 'estações');
});

/** A vermifugação por peso com a dose de um animal digitada (o 101) e a do outro pelo peso (o 100, 300 kg). */
function vermifugacaoPorPeso(semPeso101) {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, machos(2));
  hoje(s, '2026-04-01');
  if (semPeso101) s.tabela('CATEGORIAS').forEach((c) => { if (typeof c.peso_referencia_kg === 'number') ok(api(s, 'categoria.salvar', { category_id: c.category_id, campos: { peso_referencia_kg: null }, justificativa: 'Sem referência' }), 'categoria'); });
  const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Ivermectina', categoria: 'VERMIFUGO', unidade: 'mL', controla_estoque: true, custo_unitario: 0.5 } }), 'produto');
  ok(api(s, 'evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-02-01', product_id: p.product_id, quantidade: 500, valor: 25000 } }), 'entrada');
  ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-03-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids['100'], peso: 300 }].concat(semPeso101 ? [] : [{ animal_id: ids['101'], peso: 400 }]) }), 'pesagem');
  const dose101 = semPeso101 ? 7 : 10;
  const v = ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: { event_date: '2026-03-10', produto_id: p.product_id, modo_dose: 'POR_PESO', dose_referencia: 0.02 }, animais: [{ animal_id: ids['100'] }, { animal_id: ids['101'], dose: dose101 }] }), 'aplicação');
  const ver = (eid) => ({
    doses: tab(s, 'SANIDADE', { event_id: eid }).map((x) => [x.animal_id === ids['100'] ? '100' : '101', x.dose]).sort(),
    saida: tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: eid }).map((m) => [m.tipo, m.quantidade]),
    consumo: tab(s, 'FINANCEIRO', { event_id: eid }).map((f) => [f.descricao, f.valor]),
  });
  return { s, ids, v, ver, dose101 };
}

test('achados 2 e 3: a dose de um animal digitada na aplicação por peso vem na entrada da correção (evento.obter) e fica na correção só da data ou só da dose por kg — a saída do frasco e o custo não mudam sem aviso', () => {
  const { s, ids, v, ver } = vermifugacaoPorPeso(false);
  assert.deepEqual(ver(v.event_id), { doses: [['100', 6], ['101', 10]], saida: [['SAIDA', 16]], consumo: [['Consumo de vermífugo: 16 mL', 800]] });
  const o = ok(api(s, 'evento.obter', { event_id: v.event_id }), 'obter');
  assert.deepEqual(o.correcao.animais.map((x) => [x.animal_id === ids['100'] ? '100' : '101', x.dose === undefined ? null : x.dose]).sort(), [['100', null], ['101', 10]], 'a dose digitada vem como foi gravada; a do peso vem vazia (a correção da data a refaz)');
  // Só a data: o 100 refeito pelo peso na data nova (o mesmo peso), o 101 com a dose digitada.
  const r = ok(api(s, 'evento.corrigir', { event_id: v.event_id, justificativa: 'Data certa', mudanca: { campos: { event_date: '2026-03-11' } } }), 'a data');
  assert.deepEqual(ver(r.event_id), { doses: [['100', 6], ['101', 10]], saida: [['SAIDA', 16]], consumo: [['Consumo de vermífugo: 16 mL', 800]] });
  // Só a dose por kg: o 100 refeito (0,03 × 300 = 9), o 101 continua com a digitada.
  const r2 = ok(api(s, 'evento.corrigir', { event_id: r.event_id, justificativa: 'Dose certa', mudanca: { campos: { dose_referencia: 0.03 } } }), 'a dose por kg');
  assert.deepEqual(ver(r2.event_id).doses, [['100', 9], ['101', 10]]);
  // A correção sem mudança pela entrada do servidor grava os mesmos fatos.
  const o2 = ok(api(s, 'evento.obter', { event_id: r2.event_id }), 'obter 2');
  const r3 = ok(api(s, 'evento.corrigir', Object.assign({}, o2.correcao, { criados: undefined, event_id: r2.event_id, justificativa: 'Conferido' })), 'sem mudança');
  assert.deepEqual(ver(r3.event_id), ver(r2.event_id));
  semErro(s, 'dose digitada');
});

test('achados 2 e 3 (sem peso): o animal sem pesagem nem peso de referência com a dose digitada não recusa a correção da data nem a da dose por kg com SEM_PESO', () => {
  const { s, v, ver } = vermifugacaoPorPeso(true);
  assert.deepEqual(ver(v.event_id).doses, [['100', 6], ['101', 7]]);
  const r = ok(api(s, 'evento.corrigir', { event_id: v.event_id, justificativa: 'Data certa', mudanca: { campos: { event_date: '2026-03-11' } } }), 'a data');
  assert.deepEqual(ver(r.event_id).doses, [['100', 6], ['101', 7]]);
  const r2 = ok(api(s, 'evento.corrigir', { event_id: r.event_id, justificativa: 'Dose certa', mudanca: { campos: { dose_referencia: 0.01 } } }), 'a dose por kg');
  assert.deepEqual(ver(r2.event_id).doses, [['100', 3], ['101', 7]]);
  const r3 = ok(api(s, 'evento.corrigir', { event_id: r2.event_id, justificativa: 'Veterinário', mudanca: { campos: { veterinario: 'Dr. Paulo' } } }), 'o veterinário');
  assert.deepEqual(ver(r3.event_id).doses, [['100', 3], ['101', 7]]);
  semErro(s, 'sem peso');
});

test('achado 4: lote e validade na entrada de insumo de um produto sem controle de estoque são recusados (CAMPO_NAO_SE_APLICA), não aceitos e descartados em silêncio; com o controle, ficam no movimento', () => {
  const s = S.sistema();
  hoje(s, '2026-04-01');
  const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Vacina Z', categoria: 'VACINA', unidade: 'dose', controla_estoque: false, custo_unitario: 2 } }), 'produto');
  const dados = { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-03-10', product_id: p.product_id, quantidade: 50, valor: 10000, lote: 'L-777', validade: '2027-01-31' } };
  const r = api(s, 'evento.registrar', dados);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'VALIDATION');
  const det = r.error.details.map((d) => [d.codigo, d.campo]).sort();
  assert.deepEqual(det, [['CAMPO_NAO_SE_APLICA', 'lote'], ['CAMPO_NAO_SE_APLICA', 'validade']]);
  assert.match(r.error.details[0].mensagem, /não controla o estoque/);
  // A revisão (simular) diz o mesmo antes de gravar.
  const sim = api(s, 'evento.simular', { acao: 'registrar', dados });
  assert.equal(sim.ok, false);
  assert.deepEqual(sim.error.details.map((d) => d.codigo).sort(), ['CAMPO_NAO_SE_APLICA', 'CAMPO_NAO_SE_APLICA']);
  // Sem o lote e a validade, aceita.
  ok(api(s, 'evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-03-10', product_id: p.product_id, quantidade: 50, valor: 10000 } }), 'sem lote');
  // Com o controle de estoque, o lote e a validade ficam no movimento e na entrada da correção.
  const q = ok(api(s, 'produto.salvar', { campos: { nome: 'Vacina Y', categoria: 'VACINA', unidade: 'dose', controla_estoque: true, custo_unitario: 2 } }), 'produto 2');
  const e = ok(api(s, 'evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-03-10', product_id: q.product_id, quantidade: 50, valor: 10000, lote: 'L-778', validade: '2027-01-31' } }), 'com controle');
  assert.deepEqual(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: e.event_id }).map((m) => [m.lote, m.validade]), [['L-778', '2027-01-31']]);
  const o = ok(api(s, 'evento.obter', { event_id: e.event_id }), 'obter');
  assert.deepEqual([o.correcao.campos.lote, o.correcao.campos.validade], ['L-778', '2027-01-31']);
  // Desligado o controle depois, a correção sem mudança da entrada que teve o movimento continua aceita (com_movimento congelado).
  ok(api(s, 'produto.salvar', { product_id: q.product_id, campos: { controla_estoque: false }, justificativa: 'Sem controle' }), 'desliga');
  const c = ok(api(s, 'evento.corrigir', Object.assign({}, o.correcao, { criados: undefined, event_id: e.event_id, justificativa: 'Conferido' })), 'correção sem mudança');
  assert.deepEqual(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: c.event_id }).map((m) => [m.lote, m.validade]), [['L-778', '2027-01-31']]);
  semErro(s, 'lote');
});

test('achado 7: na correção de cadastro com dois dados do mesmo animal, a mudança acha o item pelo animal E pelo campo — tirar a linha da certeza tira só ela; mudar a certeza muda só ela', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, [S.bicho({ brinco: '391', sexo: 'F', data_nascimento: '2022-01-01', data_nascimento_confianca: 'ESTIMADA', raca: 'NELORE' })]);
  hoje(s, '2026-06-01');
  const cad = ok(api(s, 'evento.registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-03-01', justificativa: 'Conferido no caderno' },
    animais: [{ animal_id: ids['391'], campo: 'data_nascimento', valor_novo: '2022-06-10' }, { animal_id: ids['391'], campo: 'data_nascimento_confianca', valor_novo: 'CONFIRMADA' }] }), 'cadastro');
  const aj = (eid) => tab(s, 'AJUSTES', { event_id: eid }).map((a) => [a.campo, a.valor_anterior, a.valor_novo]).sort();
  const animal = () => { const a = s.tabela('ANIMAIS').find((x) => x.animal_id === ids['391']); return [a.data_nascimento, a.data_nascimento_confianca]; };
  // Repetir a certeza como está (a mudança cita o campo) grava os mesmos fatos.
  const r0 = ok(api(s, 'evento.corrigir', { event_id: cad.event_id, justificativa: 'Conferido', mudanca: { animais: [{ animal_id: ids['391'], campo: 'data_nascimento_confianca', valor_novo: 'CONFIRMADA' }] } }), 'a certeza como está');
  assert.deepEqual(aj(r0.event_id), aj(cad.event_id));
  // Mudar só o nascimento: a certeza fica.
  const r1 = ok(api(s, 'evento.corrigir', { event_id: r0.event_id, justificativa: 'O nascimento era 15/06', mudanca: { animais: [{ animal_id: ids['391'], campo: 'data_nascimento', valor_novo: '2022-06-15' }] } }), 'só o nascimento');
  assert.deepEqual(aj(r1.event_id), [['data_nascimento', '2022-01-01', '2022-06-15'], ['data_nascimento_confianca', 'ESTIMADA', 'CONFIRMADA']]);
  assert.deepEqual(animal(), ['2022-06-15', 'CONFIRMADA']);
  // Tirar a linha do nascimento: fica só a da certeza (o animal volta ao nascimento de antes, com a certeza confirmada).
  const r2 = ok(api(s, 'evento.corrigir', { event_id: r1.event_id, justificativa: 'Só a certeza foi conferida', mudanca: { animais: [{ animal_id: ids['391'], campo: 'data_nascimento', remover: true }] } }), 'tirar o nascimento');
  assert.deepEqual(aj(r2.event_id), [['data_nascimento_confianca', 'ESTIMADA', 'CONFIRMADA']]);
  assert.deepEqual(animal(), ['2022-01-01', 'CONFIRMADA']);
  semErro(s, 'cadastro por campo');
  // Variante: partos e nascimento; mudar só o nascimento não sobrescreve os partos (antes: CAMPO_REPETIDO).
  const cad2 = ok(api(s, 'evento.registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-04-01', justificativa: 'Conferido' },
    animais: [{ animal_id: ids['391'], campo: 'partos_previos', valor_novo: '2' }, { animal_id: ids['391'], campo: 'data_nascimento', valor_novo: '2022-06-10' }] }), 'cadastro 2');
  const r3 = ok(api(s, 'evento.corrigir', { event_id: cad2.event_id, justificativa: 'O nascimento era 20/06', mudanca: { animais: [{ animal_id: ids['391'], campo: 'data_nascimento', valor_novo: '2022-06-20' }] } }), 'só o nascimento 2');
  assert.deepEqual(aj(r3.event_id).map((x) => [x[0], x[2]]), [['data_nascimento', '2022-06-20'], ['partos_previos', '2']]);
  // A mudança sem o campo, com dois itens do mesmo animal, é ambígua: recusada dizendo o porquê.
  const r4 = api(s, 'evento.corrigir', { event_id: r3.event_id, justificativa: 'x', mudanca: { animais: [{ animal_id: ids['391'], valor_novo: '3' }] } });
  assert.equal(r4.ok, false);
  assert.equal(r4.error.code, 'VALIDATION');
  assert.equal(r4.error.details[0].codigo, 'MUDANCA_AMBIGUA');
  semErro(s, 'cadastro por campo 2');
});

// ------------------------------------------------------------------ MEDIA ----

test('achado 8: o protocolo cadastrado hoje (a cada N dias ou de dose única) não deixa o animal nunca aplicado vencido desde a entrada no rebanho: vence no dia em que o protocolo passou a valer', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, [S.bicho({ brinco: '100', sexo: 'M', castrado: true, data_nascimento: '2024-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-11-18');
  const P = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Vermífugo semestral', tipo_procedimento: 'VERMIFUGO', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180 } }), 'p1').protocol_id;
  const P2 = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Dose única adultos', tipo_procedimento: 'VACINA', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'UNICA' } }), 'p2').protocol_id;
  const P3 = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Dose única a partir de 12 meses', tipo_procedimento: 'VACINA', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'UNICA', idade_min_meses: 12 } }), 'p3').protocol_id;
  assert.equal(ok(api(s, 'sanidade.agenda', { data: '2026-11-17' }), 'agenda 17/11').pendencias.length, 0);
  const ag = ok(api(s, 'sanidade.agenda', { data: '2026-11-18' }), 'agenda 18/11');
  const linha = (pid) => ag.pendencias.filter((p) => p.protocol_id === pid).map((p) => [p.vencimento, p.situacao, p.dias])[0];
  assert.deepEqual([linha(P), linha(P2), linha(P3)].map((x) => x && x.slice(0, 2)), [['2026-11-18', 'PROXIMA'], ['2026-11-18', 'PROXIMA'], ['2026-11-18', 'PROXIMA']], 'vence hoje, no dia em que o protocolo passou a valer');
  // A ficha mostra o mesmo.
  const f = ok(api(s, 'animal.ficha', { animal_id: ids['100'] }), 'ficha');
  assert.deepEqual(f.sanitario.proximas.filter((p) => p.situacao !== 'EM_DIA').map((p) => p.vencimento).sort(), ['2026-11-18', '2026-11-18', '2026-11-18']);
  // Dias depois, vencida desde o dia do cadastro do protocolo (não desde a entrada no rebanho).
  hoje(s, '2026-11-25');
  const ag2 = ok(api(s, 'sanidade.agenda', {}), 'agenda 25/11');
  assert.deepEqual(ag2.pendencias.filter((p) => p.protocol_id === P).map((p) => [p.vencimento, p.situacao]), [['2026-11-18', 'VENCIDA']]);
});

test('achado 9: a entrada da correção do parto lê das linhas gravadas se o pasto e a raça das crias foram digitados ou tirados da mãe, nunca do estado de hoje dela', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const racas = s.tabela('LISTAS').filter((l) => l.lista === 'RACA' && l.ativo !== false).map((l) => l.codigo);
  const outra = (r) => racas.filter((x) => x !== r)[0];
  const R1 = 'NELORE';
  const R2 = outra(R1);
  const R3 = racas.filter((x) => x !== R1 && x !== R2)[0];
  const { ids } = rebanho(s, [
    S.bicho({ brinco: 'V1', sexo: 'F', raca: R1, data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }),
    S.bicho({ brinco: 'V2', sexo: 'F', raca: R3, data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }),
  ]);
  hoje(s, '2026-06-01');
  const p = ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-03-10' }, animais: [{ animal_id: ids.V1 }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: 'C1' }] }), 'parto');
  const cria = (eid) => tab(s, 'EVENTO_ANIMAIS', { event_id: eid, papel: 'CRIA' })[0];
  assert.equal(cria(p.event_id).pasto_destino_id, S.PASTOS.A);
  // A mãe ia para o B antes do parto (transferência retroativa lançada depois) e a raça dela é corrigida.
  ok(api(s, 'evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: ids.V1 }] }), 'transferência da mãe');
  ok(api(s, 'animal.editar', { animal_id: ids.V1, campos: { raca: R2 }, justificativa: 'Raça conferida' }), 'raça da mãe');
  const o = ok(api(s, 'evento.obter', { event_id: p.event_id }), 'obter');
  assert.equal(o.correcao.campos.pasto_destino_id, undefined, 'o pasto que o servidor tirou da mãe vem vazio');
  assert.equal(o.correcao.crias[0].raca, undefined, 'a raça que o servidor tirou da mãe vem vazia');
  // A correção só da data: a cria segue a mãe na data nova (o B).
  const r = ok(api(s, 'evento.corrigir', { event_id: p.event_id, justificativa: 'Data certa', mudanca: { campos: { event_date: '2026-03-11' } } }), 'a data');
  assert.equal(cria(r.event_id).pasto_destino_id, S.PASTOS.B);
  // A correção que troca a mãe para a V2: a raça da cria segue a da mãe nova.
  const r2 = ok(api(s, 'evento.corrigir', { event_id: r.event_id, justificativa: 'A mãe é a V2', mudanca: { animais: [{ animal_id: ids.V1, remover: true }, { animal_id: ids.V2 }] } }), 'a mãe');
  assert.equal(cria(r2.event_id).atributos_iniciais_json.raca, R3);
  semErro(s, 'parto derivado');
  // O outro sentido: o pasto e a raça digitados iguais aos de hoje da mãe continuam digitados.
  const p2 = ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-04-10', pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: ids.V1 }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: 'C2', raca: R2 }] }), 'parto 2');
  const o2 = ok(api(s, 'evento.obter', { event_id: p2.event_id }), 'obter 2');
  assert.equal(o2.correcao.campos.pasto_destino_id, S.PASTOS.B);
  assert.equal(o2.correcao.crias[0].raca, R2);
  const r3 = ok(api(s, 'evento.corrigir', { event_id: p2.event_id, justificativa: 'A mãe é a V2', mudanca: { animais: [{ animal_id: ids.V1, remover: true }, { animal_id: ids.V2 }] } }), 'a mãe 2');
  assert.deepEqual([cria(r3.event_id).pasto_destino_id, cria(r3.event_id).atributos_iniciais_json.raca], [S.PASTOS.B, R2], 'o digitado não segue a mãe nova');
  semErro(s, 'parto digitado');
});

test('achado 10: a estação de monta do original dispensa FORA_DA_ESTACAO só com a mesma data — a correção que leva o registro para fora do período da estação é recusada como o registro novo', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, [
    S.bicho({ brinco: '300', sexo: 'F', data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '900', sexo: 'M', reprodutor: true, data_nascimento: '2018-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
  ]);
  hoje(s, '2026-06-01');
  const e = ok(api(s, 'estacao.salvar', { campos: { nome: 'Estação 25/26', data_inicio: '2026-01-10', data_fim: '2026-03-31', tipo: 'MONTA_NATURAL' } }), 'estação');
  const x = ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-03-10', estacao_id: e.estacao_id }, animais: [{ animal_id: ids['300'] }, { animal_id: ids['900'] }] }), 'exposição');
  const r = api(s, 'evento.corrigir', { event_id: x.event_id, justificativa: 'Data certa', mudanca: { campos: { event_date: '2026-04-20' } } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.error.details.map((d) => d.codigo), ['FORA_DA_ESTACAO']);
  // Mudadas as datas da estação depois, a correção sem mudança (a mesma data) continua aceita: o registro já era dela.
  ok(api(s, 'estacao.salvar', { estacao_id: e.estacao_id, campos: { data_inicio: '2026-03-15' }, justificativa: 'Início adiado' }), 'datas da estação');
  const o = ok(api(s, 'evento.obter', { event_id: x.event_id }), 'obter');
  ok(api(s, 'evento.corrigir', Object.assign({}, o.correcao, { criados: undefined, event_id: x.event_id, justificativa: 'Conferido' })), 'sem mudança');
  semErro(s, 'estação');
});

test('achado 11: a compra do insumo sem controle de estoque conta como uso do produto — a unidade não muda depois dela (PRODUTO_EM_USO), e a correção não reescreve a descrição com outra unidade', () => {
  const s = S.sistema();
  hoje(s, '2026-04-01');
  const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Sal mineral', categoria: 'SUPLEMENTO', unidade: 'kg', controla_estoque: false, custo_unitario: 2 } }), 'produto');
  const e = ok(api(s, 'evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-03-10', product_id: p.product_id, quantidade: 500, valor: 100000 } }), 'compra');
  assert.equal(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: e.event_id }).length, 0);
  const u = api(s, 'produto.salvar', { product_id: p.product_id, campos: { unidade: 'saco 25 kg' }, justificativa: 'Por saco' });
  assert.equal(u.ok, false);
  assert.deepEqual(u.error.details.map((d) => [d.codigo, d.campo]), [['PRODUTO_EM_USO', 'unidade']]);
  assert.match(u.error.details[0].mensagem, /em compras/);
  const r = ok(api(s, 'evento.corrigir', { event_id: e.event_id, justificativa: 'Conferido', mudanca: { campos: { notes: 'Nota conferida' } } }), 'a anotação');
  assert.deepEqual(tab(s, 'FINANCEIRO', { event_id: r.event_id }).map((f) => f.descricao), ['Compra de Sal mineral: 500 kg']);
  semErro(s, 'unidade');
});

// ------------------------------------------------------------------ BAIXA ----

test('achado 15: a previsão de parto só pela exposição (nível 3) é a janela com a margem — a mesma dos indicadores — e o alerta de prenhez vencida conta a partir do fim dela', () => {
  const s = S.sistema();
  hoje(s, '2026-01-02');
  const { ids } = rebanho(s, [S.bicho({ brinco: 'V0', sexo: 'F', data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }), S.bicho({ brinco: 'T1', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-11-18');
  const E = ok(api(s, 'estacao.salvar', { campos: { nome: 'E', data_inicio: '2026-01-01', data_fim: '2026-03-31', property_id: S.PROP, tipo: 'MONTA_NATURAL' } }), 'estação').estacao_id;
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-01-05', data_fim: '2026-03-31', estacao_id: E }, animais: [{ animal_id: ids.V0 }, { animal_id: ids.T1 }] }), 'exposição');
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-05-10', metodo: 'PALPACAO', estacao_id: E }, animais: [{ animal_id: ids.V0, resultado: 'POSITIVO' }] }), 'diagnóstico');
  const pv = ok(api(s, 'reproducao.matrizes', {}), 'matrizes').itens.find((x) => x.animal_id === ids.V0).previsao_parto;
  assert.deepEqual([pv.nivel, pv.inicio, pv.fim], [3, '2026-10-02', '2027-02-04'], '05/01 + 290 − 20 a 31/03 + 290 + 20');
  // Até o fim da janela + os dias do alerta, nada vencido (a janela ainda está aberta nos indicadores).
  hoje(s, '2027-02-10');
  const alertas = (d) => ok(api(s, 'reproducao.matrizes', {}), 'matrizes ' + d).alertas || [];
  assert.equal(alertas('10/02').filter((a) => a.codigo === 'PRENHEZ_VENCIDA').length, 0);
  hoje(s, '2027-02-25');
  assert.deepEqual(alertas('25/02').filter((a) => a.codigo === 'PRENHEZ_VENCIDA').map((a) => a.data_prevista), ['2027-02-04']);
});

test('achado 16: o comando que TIRA o movimento de um dia contado (desfazer a importação da sanidade, a correção da aplicação para outro produto ou para o nome livre) é recusado pelo motor com CONTAGEM_POSTERIOR e o caminho certo', () => {
  const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, machos(3));
  hoje(s, '2026-04-01');
  const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Vacina X', categoria: 'VACINA', unidade: 'dose', controla_estoque: true, custo_unitario: 1.85 } }), 'produto');
  const p2 = ok(api(s, 'produto.salvar', { campos: { nome: 'Vacina Y', categoria: 'VACINA', unidade: 'dose', controla_estoque: true, custo_unitario: 2 } }), 'produto 2');
  ok(api(s, 'evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-02-01', product_id: p.product_id, quantidade: 50, valor: 9250 } }), 'entrada');
  ok(api(s, 'evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-02-01', product_id: p2.product_id, quantidade: 50, valor: 10000 } }), 'entrada 2');
  const CAB = 'Data;Procedimento;Produto do cadastro;Como foi a dose;Dose do lançamento (por cabeça ou por kg);Brinco';
  const MAPA = { colunas: { Data: 'data', Procedimento: 'procedimento', 'Produto do cadastro': 'produto', 'Como foi a dose': 'modo_dose', 'Dose do lançamento (por cabeça ou por kg)': 'dose_lancamento', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
  const csv = [CAB, '10/03/2026;vacinação;Vacina X;por cabeça;1;100', '10/03/2026;vacinação;Vacina X;por cabeça;1;101'].join('\n');
  const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
  const imp = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'c2r1-imp', dados: { tipo: 'SANIDADE', arquivo_nome: 'sanidade.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
  for (let b = 1; b < 20; b++) {
    const est = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'c2r1-val-' + b, dados: { import_id: imp.import_id, bloco: b, mapeamento: MAPA } })).dados;
    if (est.importacao.status === 'VALIDADO') break;
  }
  let r = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: TODOS, dados: { import_id: imp.import_id, bloco: 1, modo: 'TOTAL' } }));
  assert.equal(r.ok, true, JSON.stringify(r.erro));
  for (let b = 2; r.valor.dados.blocos.proximo !== null; b++) r = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: TODOS, dados: { import_id: imp.import_id, bloco: b } }));
  s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: imp.import_id } }));
  const v = ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-03-12', produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 }, animais: [{ animal_id: ids['102'] }] }), 'aplicação');
  ok(api(s, 'evento.registrar', { tipo: 'ESTOQUE', subtipo: 'AJUSTE', campos: { event_date: '2026-03-20', product_id: p.product_id, motivo_ajuste: 'CONTAGEM', saldo_contado: 45 } }), 'contagem');
  // Desfazer a importação: o motor recusa com a contagem e o caminho (não a trava, com "grave o lançamento").
  const d = s.tentar((ctx) => s.G.ImportService.desfazer(ctx, { avisosAceitos: TODOS, dados: { import_id: imp.import_id, justificativa: 'Arquivo errado' } }));
  assert.equal(d.ok, false);
  assert.equal(d.erro.code, 'CONFLICT');
  assert.deepEqual(d.erro.details.map((x) => x.codigo), ['CONTAGEM_POSTERIOR']);
  assert.match(d.erro.details[0].mensagem, /desfazer a importação o mudaria .*Estorne antes a contagem de 20\/03\/2026, desfaça a importação e conte de novo/);
  // A correção da aplicação para outro produto e para o nome livre: o produto que sai também.
  [{ produto_id: p2.product_id }, { produto_id: null, nome_produto: 'Vacina genérica', unidade_dose: 'dose' }].forEach((campos, i) => {
    const c = api(s, 'evento.corrigir', { event_id: v.event_id, justificativa: 'Foi outro produto', mudanca: { campos } });
    assert.equal(c.ok, false, 'variante ' + i);
    assert.equal(c.error.code, 'CONFLICT');
    assert.deepEqual(c.error.details.map((x) => x.codigo), ['CONTAGEM_POSTERIOR'], 'variante ' + i + ': ' + JSON.stringify(c.error.details));
    assert.match(c.error.details[0].mensagem, /^Vacina X: a contagem do estoque de 20\/03\/2026/);
  });
  // O estorno da aplicação diz o caminho do estorno.
  const est = api(s, 'evento.estornar', { event_id: v.event_id, justificativa: 'Não houve' });
  assert.equal(est.ok, false);
  assert.match(est.error.details[0].mensagem, /este estorno o mudaria .*estorne o lançamento e conte de novo/);
  semErro(s, 'contagem');
});
