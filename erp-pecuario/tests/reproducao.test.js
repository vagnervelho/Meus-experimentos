'use strict';
/**
 * REPRODUCAO e ESTACOES_MONTA (Fase 3, E3.4; 03a, seção 4.10; 03b, seções 7, 16.5 e 16.14; 04, seção 3.3; 05, seção 2.9,
 * RN-060 a RN-066; PR-07), por caminho: a estação de monta (cadastro), a exposição (o lote de fêmeas com os touros, a campo,
 * com ou sem estação), a cobertura, a inseminação (sêmen e inseminador), o diagnóstico de gestação em lote (positivo,
 * negativo, duvidoso, idade gestacional e previsão informada) e o aborto; a situação reprodutiva projetada coerente com os
 * partos da Fase 2 e a previsão de parto nos quatro níveis de 03b, seção 7.3; o registro, o retroativo, o mesmo dia, a
 * correção, a correção do substituto, o estorno com e sem dependente, o estorno da correção, a importação e o desfazer; a
 * verificação de integridade (COPIAS, GENEALOGIA, LINHA_DO_TEMPO) e a trava única que a usa em todo caminho. Os
 * indicadores de 07, seção 8.3, número a número, estão em reproducao.indicadores.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js, PASTOS } = S;

function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave, avisosAceitos: avisos || [] })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + JSON.stringify(r.error));
  return r.data;
}
function recusa(r, code, onde) {
  assert.equal(r.ok, false, (onde || '') + ': esperava ' + code);
  assert.equal(r.error.code, code, (onde || '') + ': ' + JSON.stringify(r.error).slice(0, 700));
  return r.error;
}
const cods = (e) => e.details.map((d) => d.codigo);
const tab = (s, aba, filtro) => s.tabela(aba).filter((r) => Object.keys(filtro || {}).every((k) => r[k] === filtro[k]));
const animal = (s, id) => s.tabela('ANIMAIS').find((a) => a.animal_id === id);
function repro(subtipo, data, animais, campos) {
  return { tipo: 'REPRODUCAO', subtipo, campos: Object.assign({ event_date: data }, campos || {}), animais: animais.map((a) => (typeof a === 'string' ? { animal_id: a } : a)) };
}
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}
/** Rebanho do marco zero (01/01/2026, Pasto A): vacas de 2021, novilhas de 2024, o touro 900 e o garrote 901. */
function rebanho(s, extra) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial([
    S.bicho({ brinco: '100', data_nascimento: '2021-03-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 2 }),
    S.bicho({ brinco: '101', data_nascimento: '2021-05-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }),
    S.bicho({ brinco: '102', data_nascimento: '2024-08-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 0 }),
    S.bicho({ brinco: '900', sexo: 'M', reprodutor: true, data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '901', sexo: 'M', data_nascimento: '2025-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
  ].concat(extra || [])), 'rebanho'), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}
function estacao(s, campos, chave) {
  return ok(api(s, 'estacao.salvar', { campos: Object.assign({ nome: 'Estação 25/26', data_inicio: '2026-01-10', data_fim: '2026-03-31', tipo: 'MONTA_NATURAL' }, campos || {}) }, chave || 'est-' + Math.random()), 'estação');
}

test('estação de monta (03a, seção 4.10; estacao.salvar): cadastro com a propriedade padrão, nome único na propriedade, fim no início ou depois, tipo fechado; a edição é auditada; o bootstrap leva as estações; mudar as datas não mexe nos registros já lançados', () => {
  const s = S.sistema();
  s.gas.clock.now = Date.parse('2026-06-01T15:00:00.000Z');
  const e = estacao(s, {}, 'e1');
  assert.deepEqual([e.nome, e.property_id, e.data_inicio, e.data_fim, e.tipo], ['Estação 25/26', S.PROP, '2026-01-10', '2026-03-31', 'MONTA_NATURAL']);
  assert.deepEqual(cods(recusa(api(s, 'estacao.salvar', { campos: { nome: 'estação 25/26', data_inicio: '2026-01-01', data_fim: '2026-02-01', tipo: 'IA' } }, 'e2'), 'VALIDATION')), ['NOME_REPETIDO'], 'nome único na propriedade (sem diferença de maiúsculas)');
  assert.deepEqual(cods(recusa(api(s, 'estacao.salvar', { campos: { nome: 'X', data_inicio: '2026-03-01', data_fim: '2026-02-01', tipo: 'IA' } }, 'e3'), 'VALIDATION')), ['FAIXA_INVALIDA']);
  assert.deepEqual(cods(recusa(api(s, 'estacao.salvar', { campos: { nome: 'Y', data_inicio: '2026-03-01', data_fim: '2026-04-01', tipo: 'BALEIA' } }, 'e4'), 'VALIDATION')), ['VALOR_FORA_DA_LISTA']);
  assert.deepEqual(cods(recusa(api(s, 'estacao.salvar', { campos: { data_inicio: '2026-03-01' } }, 'e5'), 'VALIDATION')).sort(), ['CAMPO_OBRIGATORIO', 'CAMPO_OBRIGATORIO', 'CAMPO_OBRIGATORIO'], 'nome, fim e tipo');
  assert.deepEqual(cods(recusa(api(s, 'estacao.salvar', { campos: { nome: 'Z', data_inicio: '2026-03-01', data_fim: '2026-04-01', tipo: 'IA', cor: 'azul' } }, 'e6'), 'VALIDATION')), ['CAMPO_DESCONHECIDO']);
  const ids = rebanho(s);
  ok(api(s, 'evento.registrar', repro('EXPOSICAO', '2026-01-15', [ids['100'], ids['900']], { estacao_id: e.estacao_id }), 'x1'));
  const ed = ok(api(s, 'estacao.salvar', { estacao_id: e.estacao_id, campos: { data_inicio: '2026-02-01', observacoes: 'Repasse em março' }, justificativa: 'Datas acertadas' }, 'e7'));
  assert.deepEqual([ed.data_inicio, ed.observacoes], ['2026-02-01', 'Repasse em março']);
  assert.deepEqual(tab(s, 'REPRODUCAO', { estacao_id: e.estacao_id }).map((r) => [r.tipo_evento, r.data]), [['EXPOSICAO', '2026-01-15']], 'o registro fica com a estação dele, mesmo fora das datas novas');
  assert.ok(tab(s, 'AUDITORIA', { entidade: 'ESTACOES_MONTA', entity_id: e.estacao_id }).some((a) => a.campo === 'data_inicio' && a.valor_novo === '2026-02-01' && a.justificativa === 'Datas acertadas'));
  const b = ok(api(s, 'sistema.bootstrap', {}));
  assert.deepEqual(b.estacoes.map((x) => x.nome), ['Estação 25/26']);
  assert.equal(recusa(api(s, 'estacao.salvar', { estacao_id: S.id(0xdead), campos: { nome: 'W' } }, 'e8'), 'NOT_FOUND').code, 'NOT_FOUND');
  semErro(s, 'estações');
});

test('exposição (PR-07, 03b 7.2): o lote de fêmeas com os touros da lista — uma linha REPRODUCAO EXPOSICAO por fêmea, uma linha TOURO por touro (efeito 0), o touro único no registro (com dois, nenhum), a retirada e a estação; a situação passa a EXPOSTA e a previsão é a janela da exposição (nível 3)', () => {
  const s = S.sistema();
  s.gas.clock.now = Date.parse('2026-06-01T15:00:00.000Z');
  const e = estacao(s, {}, 'e1');
  const ids = rebanho(s, [S.bicho({ brinco: '902', sexo: 'M', reprodutor: true, data_nascimento: '2020-02-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  const sim = ok(api(s, 'evento.simular', { acao: 'registrar', dados: repro('EXPOSICAO', '2026-01-15', [ids['100'], ids['101'], ids['900']], { estacao_id: e.estacao_id, data_fim: '2026-03-15' }) }));
  assert.deepEqual(js(sim.impactos.manejo), { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', femeas: 2, touros: [{ animal_id: ids['900'], nome: '900' }], touro: null, estacao: { estacao_id: e.estacao_id, nome: 'Estação 25/26' }, data_fim: '2026-03-15', metodo: null, semen: null, resultados: null });
  const r = ok(api(s, 'evento.registrar', repro('EXPOSICAO', '2026-01-15', [ids['100'], ids['101'], ids['900']], { estacao_id: e.estacao_id, data_fim: '2026-03-15' }), 'x1'));
  const linhas = tab(s, 'EVENTO_ANIMAIS', { event_id: r.event_id });
  assert.deepEqual(linhas.map((l) => [l.animal_id, l.papel, l.efeito_inventario]).sort(), [[ids['100'], 'SUJEITO', 0], [ids['101'], 'SUJEITO', 0], [ids['900'], 'TOURO', 0]].sort());
  const regs = tab(s, 'REPRODUCAO', { event_id: r.event_id });
  assert.deepEqual(regs.map((x) => [x.animal_id, x.tipo_evento, x.data, x.data_fim, x.estacao_id, x.touro_id, x.resultado || null]).sort(),
    [[ids['100'], 'EXPOSICAO', '2026-01-15', '2026-03-15', e.estacao_id, ids['900'], null], [ids['101'], 'EXPOSICAO', '2026-01-15', '2026-03-15', e.estacao_id, ids['900'], null]].sort());
  assert.deepEqual([animal(s, ids['100']).situacao_reprodutiva, animal(s, ids['101']).situacao_reprodutiva], ['EXPOSTA', 'EXPOSTA']);
  const prev = r.reproducao.animais.find((a) => a.animal_id === ids['100']).previsao_parto;
  // Segunda convergência, rodada 1 (achado 15): a janela da exposição com a margem do CONTRATOS, seção 40 (± 20 dias).
  assert.deepEqual([prev.nivel, prev.data, prev.inicio, prev.fim, prev.rotulo], [3, null, '2026-10-12', '2027-01-19', 'Estimativa'], 'janela: 15/01 + 290 − 20 a 15/03 + 290 + 20');
  // Dois touros no lote: o registro fica sem touro (os dois estão nas linhas TOURO); sem retirada, a janela vai até o fim da estação.
  const r2 = ok(api(s, 'evento.registrar', repro('EXPOSICAO', '2026-01-20', [ids['102'], ids['900'], ids['902']], { estacao_id: e.estacao_id }), 'x2', ['IDADE_REPRODUTIVA']), 'dois touros');
  assert.deepEqual(tab(s, 'REPRODUCAO', { event_id: r2.event_id }).map((x) => [x.touro_id || null, x.data_fim || null]), [[null, null]]);
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: r2.event_id, papel: 'TOURO' }).length, 2);
  assert.deepEqual(r2.reproducao.animais.find((a) => a.animal_id === ids['102']).previsao_parto.fim, '2027-02-04', 'fim da estação (31/03) + 290 + 20');
  // Só touros: precisa de fêmea. Sem estação (touro o ano todo): aceito.
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', repro('EXPOSICAO', '2026-02-01', [ids['900']]), 'x3'), 'VALIDATION')), ['SEM_FEMEAS']);
  ok(api(s, 'evento.registrar', repro('EXPOSICAO', '2026-04-15', [ids['101']]), 'x4'), 'sem estação');
  semErro(s, 'exposições');
});

test('cobertura e inseminação (03b, 7.2 e 16.14; RN-060): o touro do rebanho na cobertura tem a linha TOURO e precisa estar no rebanho; o touro de fora (cadastro de referência) não tem linha; na inseminação, o touro do sêmen, a partida e o inseminador; o touro fêmea, nascido depois ou castrado é recusado; a fêmea jovem pede confirmação (RN-061); a data fora da estação é recusada', () => {
  const s = S.sistema();
  s.gas.clock.now = Date.parse('2026-06-01T15:00:00.000Z');
  const e = estacao(s, {}, 'e1');
  const ids = rebanho(s, [S.bicho({ brinco: '903', sexo: 'M', castrado: true, data_nascimento: '2020-02-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  const ext = ok(api(s, 'animal.cadastrarExterno', { campos: { nome: 'Touro Sêmen Nelore', sexo: 'M', data_nascimento: '2018-01-01', data_nascimento_confianca: 'ESTIMADA' } }, 'ext'), 'externo').animal;
  const cob = ok(api(s, 'evento.registrar', repro('COBERTURA', '2026-02-01', [ids['100']], { touro_id: ids['900'], metodo: 'MONTA_CONTROLADA', estacao_id: e.estacao_id }), 'c1'));
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: cob.event_id }).map((l) => [l.animal_id, l.papel]).sort(), [[ids['100'], 'SUJEITO'], [ids['900'], 'TOURO']].sort());
  assert.deepEqual(tab(s, 'REPRODUCAO', { event_id: cob.event_id }).map((x) => [x.touro_id, x.metodo]), [[ids['900'], 'MONTA_CONTROLADA']]);
  assert.equal(animal(s, ids['100']).situacao_reprodutiva, 'EXPOSTA');
  assert.deepEqual(cob.reproducao.animais.find((a) => a.animal_id === ids['100']).previsao_parto.data, '2026-11-18', 'cobertura + 290 dias (nível 1)');
  const ia = ok(api(s, 'evento.registrar', repro('INSEMINACAO', '2026-02-05', [ids['101']], { touro_id: ext.animal_id, semen_identificacao: 'Partida 17-B', metodo: 'IATF', responsible: 'Inseminador João', estacao_id: e.estacao_id }), 'i1'));
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: ia.event_id }).map((l) => l.papel), ['SUJEITO'], 'touro do sêmen de fora: sem linha');
  assert.deepEqual(tab(s, 'REPRODUCAO', { event_id: ia.event_id }).map((x) => [x.touro_id, x.semen_identificacao, x.metodo]), [[ext.animal_id, 'Partida 17-B', 'IATF']]);
  assert.equal(s.tabela('EVENTOS').find((x) => x.event_id === ia.event_id).responsible, 'Inseminador João');
  assert.equal(animal(s, ids['101']).situacao_reprodutiva, 'INSEMINADA');
  // RN-060: o touro é macho, nasceu antes e não é castrado; o sujeito é fêmea (09, 4.1: macho como sujeito de diagnóstico).
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', repro('COBERTURA', '2026-02-02', [ids['101']], { touro_id: ids['100'] }), 'c2'), 'VALIDATION')), ['SEXO_DO_PROGENITOR']);
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', repro('COBERTURA', '2026-02-02', [ids['101']], { touro_id: ids['903'] }), 'c3'), 'VALIDATION')), ['TOURO_CASTRADO']);
  const dg = recusa(api(s, 'evento.registrar', repro('DIAGNOSTICO_GESTACAO', '2026-05-01', [{ animal_id: ids['900'], resultado: 'POSITIVO' }]), 'd-macho'), 'VALIDATION');
  assert.deepEqual(dg.details.map((d) => [d.codigo, d.animal_id, d.campo]), [['NAO_E_FEMEA', ids['900'], 'animal_id']]);
  assert.match(dg.message, /o registro reprodutivo é de uma fêmea/);
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', repro('INSEMINACAO', '2026-02-02', [ids['900']]), 'i-macho'), 'VALIDATION')), ['NAO_E_FEMEA']);
  // RN-061: fêmea abaixo da idade reprodutiva (a novilha de 2024 tem 18 meses em 02/2026): confirmação.
  const jovem = recusa(api(s, 'evento.registrar', repro('COBERTURA', '2026-02-10', [ids['102']], { touro_id: ids['900'], estacao_id: e.estacao_id }), 'c4'), 'NEEDS_CONFIRMATION');
  assert.deepEqual(cods(jovem), ['IDADE_REPRODUTIVA']);
  assert.match(jovem.details[0].mensagem, /102 tinha 18 meses em 10\/02\/2026, abaixo da idade reprodutiva mínima \(24 meses\)/);
  ok(api(s, 'evento.registrar', repro('COBERTURA', '2026-02-10', [ids['102']], { touro_id: ids['900'], estacao_id: e.estacao_id }), 'c4', ['IDADE_REPRODUTIVA']), 'aceito');
  // A data fora da estação; o diagnóstico só precisa ser depois do início.
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', repro('COBERTURA', '2026-04-10', [ids['101']], { touro_id: ids['900'], estacao_id: e.estacao_id }), 'c5'), 'VALIDATION')), ['FORA_DA_ESTACAO']);
  ok(api(s, 'evento.registrar', repro('DIAGNOSTICO_GESTACAO', '2026-05-10', [{ animal_id: ids['100'], resultado: 'NEGATIVO' }], { estacao_id: e.estacao_id }), 'd1'));
  // O touro do rebanho precisa estar no rebanho na data (a linha TOURO é um fato): o que saiu antes é recusado pela linha do tempo.
  ok(api(s, 'evento.registrar', { tipo: 'MORTE', campos: { event_date: '2026-04-20', causa: 'RAIO' }, animais: [{ animal_id: ids['901'] }] }, 'm901'));
  const morto = recusa(api(s, 'evento.registrar', repro('COBERTURA', '2026-05-01', [ids['101']], { touro_id: ids['901'] }), 'c6'), 'VALIDATION');
  assert.deepEqual(morto.details.map((d) => [d.codigo, d.animal_id]), [['APOS_MORTE', ids['901']]]);
  semErro(s, 'cobertura e inseminação');
});

test('diagnóstico de gestação em lote (03b, 7.1 a 7.3): o resultado de cada fêmea (positivo, negativo, duvidoso), a idade da gestação e a previsão informada; a situação projetada (PRENHA, VAZIA; o duvidoso não muda); a previsão nos quatro níveis — informada (0), inseminação + 290 (1), diagnóstico − idade (2), exposição (3); campos fora do resultado recusados', () => {
  const s = S.sistema();
  s.gas.clock.now = Date.parse('2027-02-01T15:00:00.000Z');
  const ids = rebanho(s, [S.bicho({ brinco: '103', data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 3 }), S.bicho({ brinco: '104', data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 3 })]);
  // 03b, seção 7.3: inseminação em 10/11/2026 → 27/08/2027; diagnóstico positivo em 15/01/2027 com 60 dias → 02/09/2027.
  ok(api(s, 'evento.registrar', repro('INSEMINACAO', '2026-11-10', [ids['100']], { metodo: 'IA' }), 'i1'));
  ok(api(s, 'evento.registrar', repro('EXPOSICAO', '2026-10-01', [ids['103'], ids['104'], ids['101'], ids['900']], { data_fim: '2026-12-31' }), 'x1'));
  const dados = repro('DIAGNOSTICO_GESTACAO', '2027-01-15', [
    { animal_id: ids['100'], resultado: 'POSITIVO', idade_gestacional_dias: 66 },
    { animal_id: ids['101'], resultado: 'POSITIVO', idade_gestacional_dias: 60 },
    { animal_id: ids['103'], resultado: 'POSITIVO', data_prevista_parto: '2027-09-20' },
    { animal_id: ids['104'], resultado: 'NEGATIVO', observacoes: 'repassar' },
  ], { metodo: 'ULTRASSOM', responsible: 'Dra. Ana' });
  const sim = ok(api(s, 'evento.simular', { acao: 'registrar', dados }));
  assert.deepEqual(js(sim.impactos.manejo.resultados), { POSITIVO: 3, NEGATIVO: 1, INCONCLUSIVO: 0 });
  const r = ok(api(s, 'evento.registrar', dados, 'd1'));
  const regs = Object.fromEntries(tab(s, 'REPRODUCAO', { event_id: r.event_id }).map((x) => [x.animal_id, [x.resultado, x.idade_gestacional_dias || null, x.data_prevista_parto || null, x.metodo, x.observacoes || null]]));
  assert.deepEqual(regs, { [ids['100']]: ['POSITIVO', 66, null, 'ULTRASSOM', null], [ids['101']]: ['POSITIVO', 60, null, 'ULTRASSOM', null], [ids['103']]: ['POSITIVO', null, '2027-09-20', 'ULTRASSOM', null], [ids['104']]: ['NEGATIVO', null, null, 'ULTRASSOM', 'repassar'] });
  assert.deepEqual([ids['100'], ids['101'], ids['103'], ids['104']].map((id) => animal(s, id).situacao_reprodutiva), ['PRENHA', 'PRENHA', 'PRENHA', 'VAZIA']);
  const prev = Object.fromEntries(r.reproducao.animais.map((a) => [a.animal_id, a.previsao_parto && [a.previsao_parto.nivel, a.previsao_parto.data, a.previsao_parto.inicio, a.previsao_parto.fim]]));
  assert.deepEqual(prev[ids['100']], [1, '2027-08-27', '2027-08-07', '2027-09-16'], 'nível 1: a inseminação + 290 dias (± 20)');
  assert.deepEqual(prev[ids['101']], [2, '2027-09-02', '2027-08-13', '2027-09-22'], 'nível 2: 15/01/2027 + (290 − 60)');
  assert.deepEqual(prev[ids['103']], [0, '2027-09-20', '2027-08-31', '2027-10-10'], 'nível 0: a informada');
  assert.equal(prev[ids['104']], null, 'vazia: sem previsão');
  // Duvidoso não muda a situação; a previsão da exposição (nível 3) continua.
  const antes102 = animal(s, ids['102']).situacao_reprodutiva;
  ok(api(s, 'evento.registrar', repro('DIAGNOSTICO_GESTACAO', '2027-01-20', [{ animal_id: ids['102'], resultado: 'INCONCLUSIVO' }]), 'd2', ['IDADE_REPRODUTIVA']));
  assert.equal(animal(s, ids['102']).situacao_reprodutiva, antes102);
  ok(api(s, 'evento.registrar', repro('DIAGNOSTICO_GESTACAO', '2027-01-21', [{ animal_id: ids['104'], resultado: 'INCONCLUSIVO' }]), 'd2b'));
  assert.equal(animal(s, ids['104']).situacao_reprodutiva, 'VAZIA', 'o duvidoso depois do negativo: continua vazia');
  // Formato: resultado obrigatório; idade e previsão só no positivo; idade até a duração da gestação; previsão depois do diagnóstico.
  const e = recusa(api(s, 'evento.registrar', repro('DIAGNOSTICO_GESTACAO', '2027-01-25', [
    { animal_id: ids['100'] }, { animal_id: ids['101'], resultado: 'NEGATIVO', idade_gestacional_dias: 30 },
    { animal_id: ids['103'], resultado: 'POSITIVO', idade_gestacional_dias: 300 }, { animal_id: ids['104'], resultado: 'POSITIVO', data_prevista_parto: '2027-01-25' },
  ]), 'd3'), 'VALIDATION');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.campo, d.brinco]), [['CAMPO_OBRIGATORIO', 'resultado', '100'], ['CAMPO_NAO_SE_APLICA', 'idade_gestacional_dias', '101'], ['VALOR_FORA_DA_FAIXA', 'idade_gestacional_dias', '103'], ['DATA_INVALIDA', 'data_prevista_parto', '104']]);
  // A fêmea parida volta a VAZIA com cria ao pé (Fase 2: o NASCIMENTO grava REPRODUCAO PARTO); o aborto também vai a VAZIA.
  ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2027-01-30' }, animais: [{ animal_id: ids['104'] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] }, 'p1'), 'parto');
  assert.deepEqual([animal(s, ids['104']).situacao_reprodutiva, animal(s, ids['104']).cria_ao_pe], ['VAZIA', true]);
  ok(api(s, 'evento.registrar', repro('ABORTO', '2027-01-31', [{ animal_id: ids['101'], idade_gestacional_dias: 75 }]), 'a1'));
  assert.equal(animal(s, ids['101']).situacao_reprodutiva, 'VAZIA');
  assert.deepEqual(tab(s, 'REPRODUCAO', { animal_id: ids['101'], tipo_evento: 'ABORTO' }).map((x) => x.idade_gestacional_dias), [75]);
  semErro(s, 'diagnóstico');
});

test('caminhos (lição da Fase 2): retroativo (o diagnóstico antigo não muda a situação de hoje), mesmo dia (POSSIVEL_DUPLICIDADE), correção (o resultado muda a situação), correção do substituto, estorno da correção, estorno sem dependente; estorno da entrada da fêmea e do touro com registro posterior → CONFLICT; parto dentro da gestação de um diagnóstico (pelos dois lados); castração retroativa do touro de uma cobertura → CONFLICT', () => {
  const s = S.sistema();
  s.gas.clock.now = Date.parse('2026-12-01T15:00:00.000Z');
  const ids = rebanho(s);
  const out = ok(api(s, 'evento.registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-02-01', description: 'Doação' }, animais: [S.bicho({ brinco: '200', data_nascimento: '2021-01-01', data_nascimento_confianca: 'ESTIMADA' }), S.bicho({ brinco: '950', sexo: 'M', reprodutor: true, data_nascimento: '2021-01-01', data_nascimento_confianca: 'ESTIMADA' })] }, 'oe'));
  const n200 = out.animais.find((a) => a.brinco === '200').animal_id;
  const n950 = out.animais.find((a) => a.brinco === '950').animal_id;
  const cob = ok(api(s, 'evento.registrar', repro('COBERTURA', '2026-03-01', [n200], { touro_id: n950 }), 'c1'));
  const dg = ok(api(s, 'evento.registrar', repro('DIAGNOSTICO_GESTACAO', '2026-05-01', [{ animal_id: n200, resultado: 'POSITIVO', idade_gestacional_dias: 61 }]), 'd1'));
  assert.equal(animal(s, n200).situacao_reprodutiva, 'PRENHA');
  // Retroativo: um diagnóstico negativo antes do positivo não muda a situação de hoje (o último fato vale).
  ok(api(s, 'evento.registrar', repro('DIAGNOSTICO_GESTACAO', '2026-04-01', [{ animal_id: n200, resultado: 'NEGATIVO' }]), 'd0'));
  assert.equal(animal(s, n200).situacao_reprodutiva, 'PRENHA');
  // Mesmo dia, mesma fêmea: possível duplicidade.
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', repro('DIAGNOSTICO_GESTACAO', '2026-05-01', [{ animal_id: n200, resultado: 'POSITIVO' }]), 'd1b'), 'NEEDS_CONFIRMATION')), ['POSSIVEL_DUPLICIDADE']);
  // Correção: o positivo vira negativo (VAZIA); correção do substituto: volta a positivo; estorno da correção: o original não volta.
  const k1 = ok(api(s, 'evento.corrigir', Object.assign(repro('DIAGNOSTICO_GESTACAO', '2026-05-01', [{ animal_id: n200, resultado: 'NEGATIVO' }]), { event_id: dg.event_id, justificativa: 'Palpação errada' }), 'k1'));
  assert.equal(animal(s, n200).situacao_reprodutiva, 'VAZIA');
  const k2 = ok(api(s, 'evento.corrigir', Object.assign(repro('DIAGNOSTICO_GESTACAO', '2026-05-02', [{ animal_id: n200, resultado: 'POSITIVO', idade_gestacional_dias: 62 }]), { event_id: k1.event_id, justificativa: 'Ultrassom confirmou' }), 'k2'));
  assert.equal(animal(s, n200).situacao_reprodutiva, 'PRENHA');
  ok(api(s, 'evento.estornar', { event_id: k2.event_id, justificativa: 'Não houve diagnóstico' }, 'e-k2'));
  assert.equal(animal(s, n200).situacao_reprodutiva, 'VAZIA', 'sem o positivo, vale o negativo de 01/04');
  // Estorno com dependente: a entrada da fêmea e a do touro (a linha TOURO da cobertura é um fato dele).
  let e = recusa(api(s, 'evento.estornar', { event_id: out.event_id, justificativa: 'x' }, 'e-oe'), 'CONFLICT');
  assert.ok(e.details.some((d) => d.codigo === 'EVENTO_DEPENDENTE' && d.conflito.event_id === cob.event_id), JSON.stringify(e.details));
  // Parto dentro da gestação de um diagnóstico: o diagnóstico novo é recusado; o parto retroativo que cai nela, CONFLICT com o diagnóstico.
  const dg2 = ok(api(s, 'evento.registrar', repro('DIAGNOSTICO_GESTACAO', '2026-07-01', [{ animal_id: n200, resultado: 'POSITIVO', idade_gestacional_dias: 100 }]), 'd2'));
  e = recusa(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-04-15' }, animais: [{ animal_id: n200 }], crias: [{ situacao_nascimento: 'NATIMORTO' }] }, 'p-retro'), 'CONFLICT');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.conflito.event_id]), [['PARTO_NA_GESTACAO', dg2.event_id]]);
  assert.match(e.details[0].mensagem, /o diagnóstico positivo de 01\/07\/2026, com 100 dias de gestação, põe a concepção em 23\/03\/2026, mas a fêmea pariu em 15\/04\/2026/);
  ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-03-10' }, animais: [{ animal_id: n200 }], crias: [{ situacao_nascimento: 'NATIMORTO' }] }, 'p-antes'), 'antes da concepção: aceito');
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', repro('DIAGNOSTICO_GESTACAO', '2026-07-02', [{ animal_id: n200, resultado: 'POSITIVO', idade_gestacional_dias: 120 }]), 'd3'), 'VALIDATION')), ['PARTO_NA_GESTACAO']);
  // Castração retroativa do touro antes da cobertura → CONFLICT com a cobertura; depois dela, aceita.
  e = recusa(api(s, 'evento.registrar', { tipo: 'CASTRACAO', campos: { event_date: '2026-02-15' }, animais: [{ animal_id: n950 }] }, 'cx'), 'CONFLICT');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.conflito.event_id]), [['TOURO_CASTRADO', cob.event_id]]);
  ok(api(s, 'evento.registrar', { tipo: 'CASTRACAO', campos: { event_date: '2026-03-02' }, animais: [{ animal_id: n950 }] }, 'cx2'), 'depois da cobertura');
  // A correção que leva a cobertura para depois da castração: CONFLICT com... a própria correção (VALIDATION).
  assert.deepEqual(cods(recusa(api(s, 'evento.corrigir', Object.assign(repro('COBERTURA', '2026-03-05', [n200], { touro_id: n950 }), { event_id: cob.event_id, justificativa: 'data' }), 'kc'), 'VALIDATION')), ['TOURO_CASTRADO']);
  // Estorno sem dependente.
  ok(api(s, 'evento.estornar', { event_id: dg2.event_id, justificativa: 'repetido' }, 'e-d2'));
  semErro(s, 'caminhos');
});

test('integridade e trava (a mesma função): colunas do registro fora do tipo, cabeçalho diferente entre as fêmeas, touro do lote trocado, registro da fêmea apagado, castrado de origem com cobertura posterior (correção de cadastro) — acusados pela verificação; a trava recusa a correção de cadastro que deixaria o touro castrado e o lançamento que toca a fonte adulterada', () => {
  const s = S.sistema();
  s.gas.clock.now = Date.parse('2026-06-01T15:00:00.000Z');
  const ids = rebanho(s);
  const x = ok(api(s, 'evento.registrar', repro('EXPOSICAO', '2026-02-01', [ids['100'], ids['101'], ids['900']]), 'x1'));
  const dg = ok(api(s, 'evento.registrar', repro('DIAGNOSTICO_GESTACAO', '2026-05-01', [{ animal_id: ids['100'], resultado: 'POSITIVO', idade_gestacional_dias: 80 }, { animal_id: ids['101'], resultado: 'NEGATIVO' }]), 'd1'));
  semErro(s, 'antes');
  const r100 = tab(s, 'REPRODUCAO', { event_id: dg.event_id, animal_id: ids['100'] })[0];
  const r101 = tab(s, 'REPRODUCAO', { event_id: dg.event_id, animal_id: ids['101'] })[0];
  const x100 = tab(s, 'REPRODUCAO', { event_id: x.event_id, animal_id: ids['100'] })[0];
  const casos = [
    [r101.reproduction_id, 'idade_gestacional_dias', 30, /o registro tem idade da gestação, que só existe no diagnóstico positivo e no aborto/],
    [r100.reproduction_id, 'resultado', '', /o diagnóstico está sem o resultado/],
    [r100.reproduction_id, 'metodo', 'ULTRASSOM', /o cabeçalho do registro .* difere do das outras fêmeas do lançamento/],
    [x100.reproduction_id, 'touro_id', ids['901'], /o touro do registro não é o touro do lote/],
    [x100.reproduction_id, 'data_fim', '2026-01-15', /a retirada dos touros \(15\/01\/2026\) é anterior ao início da exposição/],
    [r100.reproduction_id, 'data_prevista_parto', '2026-04-01', /a previsão de parto informada \(01\/04\/2026\) não é depois do diagnóstico/],
  ];
  for (const [idReg, col, valor, msg] of casos) {
    const bruto = s.tabela('REPRODUCAO').find((r) => r.reproduction_id === idReg)[col];
    s.editar('REPRODUCAO', idReg, col, valor);
    const rel = s.integridade();
    assert.ok(rel.achados.some((a) => a.checagem === 'COPIAS' && msg.test(a.mensagem)), col + ': ' + JSON.stringify(rel.achados.slice(0, 3).map((a) => a.mensagem)));
    assert.equal(rel.reparavel, false);
    s.editar('REPRODUCAO', idReg, col, bruto === null || bruto === undefined ? '' : bruto);
  }
  semErro(s, 'desfeito');
  // O registro de uma fêmea apagado à mão: detalhe obrigatório.
  s.apagarLinha('REPRODUCAO', r101.reproduction_id);
  let rel = s.integridade();
  assert.ok(rel.achados.some((a) => a.checagem === 'COPIAS' && /está sem a linha de REPRODUCAO que o lançamento grava/.test(a.mensagem)), JSON.stringify(rel.achados.slice(0, 3)));
  // A trava recusa lançar para a fêmea cuja fonte está quebrada (a reconstrução partiria dela).
  const pes = { tipo: 'PESAGEM', campos: { event_date: '2026-05-10', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids['101'], peso: 400 }] };
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', pes, 'p-trava'), 'CONFLICT')), ['INTEGRIDADE_COPIAS']);
  // De volta (a planilha restaurada): a correção de cadastro que tornaria o touro castrado de origem é recusada — já pelo
  // motor, com o código da regra (o castrado de origem depois do comando conta a correção do próprio comando: CONTRATOS,
  // seção 50); antes, só a trava a pegava (INTEGRIDADE_LINHA_DO_TEMPO), com a mesma mensagem.
  const s2 = S.sistema();
  s2.gas.clock.now = Date.parse('2026-06-01T15:00:00.000Z');
  const i2 = rebanho(s2, [S.bicho({ brinco: '904', sexo: 'M', data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  ok(api(s2, 'evento.registrar', repro('COBERTURA', '2026-02-01', [i2['100']], { touro_id: i2['904'] }), 'c1'));
  const t = recusa(api(s2, 'evento.registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-05-01', justificativa: 'Era castrado' }, animais: [{ animal_id: i2['904'], campo: 'castrado', valor_novo: 'S' }] }, 'cc'), 'CONFLICT');
  assert.deepEqual(cods(t), ['TOURO_CASTRADO']);
  assert.match(t.details[0].mensagem, /é o touro da cobertura de 01\/02\/2026, mas é castrado pelo cadastro/);
  // E a correção do sexo da fêmea do diagnóstico (GENEALOGIA: o registro reprodutivo é de uma fêmea).
  const g = recusa(api(s2, 'evento.registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-05-01', justificativa: 'Sexo errado' }, animais: [{ animal_id: i2['100'], campo: 'sexo', valor_novo: 'M' }] }, 'cs'), 'CONFLICT');
  assert.ok(cods(g).includes('INTEGRIDADE_GENEALOGIA'), JSON.stringify(cods(g)));
  semErro(s2, 'trava');
});

test('importação e desfazer: o registro reprodutivo de uma fêmea importada impede desfazer a importação (CONFLICT com ele); estornado, o desfazer passa', () => {
  const s = S.sistema({ config: { importacao_lote_linhas: '5' } });
  s.gas.clock.now = Date.parse('2026-06-01T15:00:00.000Z');
  const { G } = s;
  const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
  const csv = 'Brinco;Sexo;Nasc.;Pasto\n1301;F;01/01/2021;Pasto A\n1302;F;01/01/2021;Pasto B';
  const c = s.exec((ctx) => G.ImportService.criar(ctx, { idempotencyKey: 'imp-criar', dados: { tipo: 'ANIMAIS', arquivo_nome: 'rebanho.csv', conteudo_base64: Buffer.from(csv, 'utf8').toString('base64'), formato: FORMATO } })).dados;
  const mapa = { colunas: { Brinco: 'brinco', Sexo: 'sexo', 'Nasc.': 'data_nascimento', Pasto: 'pasto' }, confiancas: { data_nascimento: 'ESTIMADA' }, padroes: {} };
  let est;
  for (let b = 1; b < 10 && (!est || est.importacao.status !== 'VALIDADO'); b++) est = s.exec((ctx) => G.ImportService.validarBloco(ctx, { idempotencyKey: 'imp-val-' + b, dados: { import_id: c.import_id, bloco: b, mapeamento: mapa } })).dados;
  s.exec((ctx) => G.ImportService.importarBloco(ctx, { dados: { import_id: c.import_id, bloco: 1, modo: 'TOTAL' } }));
  s.exec((ctx) => G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } }));
  const a = s.tabela('ANIMAIS').find((x) => x.brinco === '1302');
  const dg = ok(api(s, 'evento.registrar', repro('DIAGNOSTICO_GESTACAO', '2026-03-01', [{ animal_id: a.animal_id, resultado: 'POSITIVO' }]), 'd-imp'));
  let r = s.tentar((ctx) => G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id, justificativa: 'Arquivo errado' } }));
  assert.equal(r.erro.code, 'CONFLICT');
  assert.deepEqual(r.erro.details.map((d) => [d.conflito.event_id, d.conflito.tipo]), [[dg.event_id, 'REPRODUCAO']]);
  ok(api(s, 'evento.estornar', { event_id: dg.event_id, justificativa: 'Fêmea do arquivo errado' }, 'est-d-imp'));
  r = s.tentar((ctx) => G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id, justificativa: 'Arquivo errado' } }));
  assert.equal(r.ok, true, JSON.stringify(r.erro));
  semErro(s, 'importação desfeita');
});

test('ficha da matriz (bloco G inteiro), fêmeas (reproducao.matrizes) e alertas: situação, cria ao pé, parida, previsão, partos, bezerros, perdas, registros; o macho mostra os registros como touro e a castração; parto previsto e prenhez vencida no alerta.listar', () => {
  const s = S.sistema();
  s.gas.clock.now = Date.parse('2026-12-20T15:00:00.000Z');
  const ids = rebanho(s);
  const e = estacao(s, {}, 'e1');
  ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-02-01' }, animais: [{ animal_id: ids['100'] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: '300' }] }, 'p1'));
  ok(api(s, 'evento.registrar', repro('EXPOSICAO', '2026-02-15', [ids['100'], ids['101'], ids['900']], { estacao_id: e.estacao_id }), 'x1'));
  ok(api(s, 'evento.registrar', repro('DIAGNOSTICO_GESTACAO', '2026-05-01', [{ animal_id: ids['100'], resultado: 'POSITIVO', idade_gestacional_dias: 50 }, { animal_id: ids['101'], resultado: 'POSITIVO', idade_gestacional_dias: 70 }], { estacao_id: e.estacao_id }), 'd1'));
  ok(api(s, 'evento.registrar', repro('ABORTO', '2026-06-01', [{ animal_id: ids['101'], idade_gestacional_dias: 100 }]), 'a1'));
  ok(api(s, 'evento.registrar', repro('DIAGNOSTICO_GESTACAO', '2026-09-01', [{ animal_id: ids['101'], resultado: 'POSITIVO', idade_gestacional_dias: 40 }]), 'd2'));
  const f = ok(api(s, 'animal.ficha', { animal_id: ids['100'] })).reprodutivo;
  assert.deepEqual([f.entregue, f.parcial, f.aplica, f.situacao_reprodutiva, f.cria_ao_pe, f.parida, f.n_partos, f.partos_registrados, f.exposicoes, f.diagnosticos, f.abortos],
    [true, false, true, 'PRENHA', true, true, 3, 1, 1, 1, 0]);
  assert.deepEqual(js(f.bezerros), { nascidos_vivos: 1, natimortos: 0, desmamados: 0 });
  assert.deepEqual([f.previsao_parto.nivel, f.previsao_parto.data], [2, '2026-12-27'], '01/05/2026 + (290 − 50)');
  assert.deepEqual(f.registros.map((r) => [r.tipo_evento, r.data, r.resultado || null, r.estacao_nome]), [['DIAGNOSTICO_GESTACAO', '2026-05-01', 'POSITIVO', 'Estação 25/26'], ['EXPOSICAO', '2026-02-15', null, 'Estação 25/26']]);
  const f101 = ok(api(s, 'animal.ficha', { animal_id: ids['101'] })).reprodutivo;
  assert.deepEqual([f101.abortos, js(f101.perdas_gestacionais), f101.previsao_parto.data], [1, { abortos: 1, natimortos: 0, total: 1 }, '2027-05-09'], 'depois do aborto, o diagnóstico novo: 01/09/2026 + 250');
  const f900 = ok(api(s, 'animal.ficha', { animal_id: ids['900'] })).reprodutivo;
  assert.deepEqual([f900.aplica, f900.como_touro.map((x) => [x.tipo_evento, x.data, x.femeas]), f900.castracao], [false, [['EXPOSICAO', '2026-02-15', 2]], null], 'um item por lançamento');
  // reproducao.matrizes: a lista com a situação e a previsão; filtro pela estação e pela situação.
  const m = ok(api(s, 'reproducao.matrizes', {}));
  assert.deepEqual(m.itens.map((x) => [x.brinco, x.situacao_reprodutiva, x.cria_ao_pe, x.partos]), [['100', 'PRENHA', true, 3], ['101', 'PRENHA', false, 1], ['102', 'SEM_INFORMACAO', false, 0]], 'a novilha de 2024 (28 meses, apta, sem registro) entra sem informação; o touro, não');
  // `expostas_ou_inseminadas`: o total do cartão vem do servidor (revisão da Fase 3, achado 28); aqui nenhuma está exposta.
  assert.deepEqual(js(m.resumo), { por_situacao: { PRENHA: 2, SEM_INFORMACAO: 1 }, cria_ao_pe: 1, sem_historico: 1, total: 3, expostas_ou_inseminadas: 0 });
  assert.deepEqual(ok(api(s, 'reproducao.matrizes', { estacao_id: e.estacao_id, situacao: 'PRENHA' })).itens.length, 2);
  // Alertas: a 100 com parto previsto em 27/12/2026 (até 30 dias); depois, com a previsão vencida há mais de 15 dias.
  assert.deepEqual(m.alertas.map((x) => [x.codigo, x.brinco, x.data_prevista]), [['PARTO_PREVISTO', '100', '2026-12-27']]);
  const al = ok(api(s, 'alerta.listar', {}));
  assert.ok(al.alertas.some((x) => x.codigo === 'PARTO_PREVISTO' && /1 parto\(s\) previsto\(s\)/.test(x.mensagem)), JSON.stringify(al.alertas.map((x) => x.codigo)));
  s.gas.clock.now = Date.parse('2027-02-15T15:00:00.000Z');
  const al2 = ok(api(s, 'alerta.listar', {}));
  assert.ok(al2.alertas.some((x) => x.codigo === 'PRENHEZ_VENCIDA'), JSON.stringify(al2.alertas.map((x) => x.codigo)));
  semErro(s, 'ficha');
});
