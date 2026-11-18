'use strict';
/**
 * Agenda sanitária e protocolos (Fase 3, E3.2 e E3.3; 03a, seção 4.9, DL-16; 05, seções 2.8 e 4.7, RN-058 e RN-059; 07,
 * seção 8.4; 09, seção 4.1, casos 058, 059 e 072): `protocolo.salvar` e as regras dele, a elegibilidade (sexo, idade em
 * meses completos com a máxima exclusiva, categoria), o vencimento de cada recorrência com os exemplos de 03a e 05 antes,
 * dentro e depois do prazo, a pendência por produto sem protocolo, a cobertura e os custos do período, a carência na
 * agenda e os alertas. Nenhum protocolo vem de fábrica: o sistema registra e alerta, não prescreve.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js } = S;

function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave, avisosAceitos: avisos || [] })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + JSON.stringify(r.error));
  return r.data;
}
function recusa(r, code, onde) {
  assert.equal(r.ok, false, (onde || '') + ': esperava ' + code);
  assert.equal(r.error.code, code, (onde || '') + ': ' + JSON.stringify(r.error).slice(0, 600));
  return r.error;
}
const det = (e) => e.details.map((d) => [d.codigo, d.campo || null]);
const relogio = (s, data) => { s.gas.clock.now = Date.parse(data + 'T15:00:00.000Z'); };
function protocolo(s, campos, chave) {
  return ok(api(s, 'protocolo.salvar', { campos: Object.assign({ tipo_procedimento: 'VACINA', sexo_aplicavel: 'AMBOS' }, campos) }, chave || 'pr-' + Math.random()), 'protocolo');
}
function vacina(s, data, ids, campos, chave, avisos) {
  return ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: Object.assign({ event_date: data, nome_produto: 'Vacina', modo_dose: 'POR_CABECA', dose_referencia: 1, unidade_dose: 'dose' }, campos || {}), animais: ids.map((animal_id) => ({ animal_id })) }, chave || 'v-' + Math.random(), avisos), 'vacina');
}
const agenda = (s, dados) => ok(api(s, 'sanidade.agenda', dados || {}));
const situacoes = (a, id) => a.pendencias.filter((p) => !id || p.animal_id === id).map((p) => [p.situacao, p.vencimento]);

test('protocolo.salvar (03a, seção 4.9): nome, procedimento (sem doença), sexo e recorrência obrigatórios; intervalo e meses conforme a recorrência; idade máxima > mínima; produto e categoria existentes; nenhum de fábrica; o bootstrap leva os cadastros', () => {
  const s = S.sistema();
  assert.deepEqual(ok(api(s, 'sistema.bootstrap', {})).protocolos, [], 'nenhum protocolo vem de fábrica');
  assert.deepEqual(det(recusa(api(s, 'protocolo.salvar', { campos: {} }, 'p0'), 'VALIDATION')).sort(), [['CAMPO_OBRIGATORIO', 'nome'], ['CAMPO_OBRIGATORIO', 'recorrencia_tipo'], ['CAMPO_OBRIGATORIO', 'sexo_aplicavel'], ['CAMPO_OBRIGATORIO', 'tipo_procedimento']]);
  assert.deepEqual(det(recusa(api(s, 'protocolo.salvar', { campos: { nome: 'X', tipo_procedimento: 'DOENCA', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'UNICA' } }, 'p1'), 'VALIDATION')), [['VALOR_FORA_DA_LISTA', 'tipo_procedimento']]);
  assert.deepEqual(det(recusa(api(s, 'protocolo.salvar', { campos: { nome: 'X', tipo_procedimento: 'VACINA', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS' } }, 'p2'), 'VALIDATION')), [['CAMPO_OBRIGATORIO', 'intervalo_dias']]);
  assert.deepEqual(det(recusa(api(s, 'protocolo.salvar', { campos: { nome: 'X', tipo_procedimento: 'VACINA', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'CAMPANHA_MESES', meses_campanha: [5, 13] } }, 'p3'), 'VALIDATION')), [['FORMATO_INVALIDO', 'meses_campanha']]);
  assert.deepEqual(det(recusa(api(s, 'protocolo.salvar', { campos: { nome: 'X', tipo_procedimento: 'VACINA', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'UNICA', intervalo_dias: 30 } }, 'p4'), 'VALIDATION')), [['CAMPO_NAO_SE_APLICA', 'intervalo_dias']]);
  assert.deepEqual(det(recusa(api(s, 'protocolo.salvar', { campos: { nome: 'X', tipo_procedimento: 'VACINA', sexo_aplicavel: 'F', recorrencia_tipo: 'UNICA', idade_min_meses: 8, idade_max_meses: 3 } }, 'p5'), 'VALIDATION')), [['FAIXA_INVALIDA', 'idade_max_meses']]);
  assert.deepEqual(det(recusa(api(s, 'protocolo.salvar', { campos: { nome: 'X', tipo_procedimento: 'VACINA', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'UNICA', product_id: S.id(0x77), category_id: S.id(0x78) } }, 'p6'), 'VALIDATION')).sort(), [['NAO_ENCONTRADO', 'category_id'], ['NAO_ENCONTRADO', 'product_id']]);
  const c = protocolo(s, { nome: 'Campanha', recorrencia_tipo: 'CAMPANHA_MESES', meses_campanha: '11, 5' }, 'c');
  assert.deepEqual([c.meses_campanha, c.ativo], [[5, 11], true], 'os meses em ordem; ativo ao cadastrar');
  // Mudar a recorrência limpa o campo da outra.
  const c2 = ok(api(s, 'protocolo.salvar', { protocol_id: c.protocol_id, campos: { recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 90 } }, 'c2'));
  assert.deepEqual([c2.recorrencia_tipo, c2.intervalo_dias, c2.meses_campanha], ['INTERVALO_DIAS', 90, null]);
  assert.deepEqual(det(recusa(api(s, 'protocolo.salvar', { campos: { nome: 'campanha ', tipo_procedimento: 'VACINA', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'UNICA' } }, 'p7'), 'VALIDATION')), [['NOME_REPETIDO', 'nome']]);
  const boot = ok(api(s, 'sistema.bootstrap', {}));
  assert.deepEqual(boot.protocolos.map((p) => p.nome), ['Campanha']);
});

test('INTERVALO_DIAS (03a, 4.9): aplicação em 10/05/2027 com 180 dias e antecedência de 15 → vence 06/11/2027; em dia antes de 22/10, próxima de 22/10 a 06/11, vencida de 07/11; nunca aplicado, vencido desde que ficou elegível; a próxima informada vale sobre o intervalo', () => {
  const s = S.sistema();
  relogio(s, '2027-05-12');
  const ids = ok(api(s, 'evento.registrar', S.entradaInicial(['11', '12', '13'].map((b) => S.bicho({ brinco: b, data_nascimento: '2024-01-01', data_nascimento_confianca: 'CONFIRMADA' }))), 'reb')).animais.map((a) => a.animal_id);
  const p = protocolo(s, { nome: 'Semestral', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180, antecedencia_alerta_dias: 15 }, 'p');
  vacina(s, '2027-05-10', [ids[0]], { protocol_id: p.protocol_id }, 'v1');
  vacina(s, '2027-05-10', [ids[1]], { protocol_id: p.protocol_id, data_proxima_aplicacao: '2027-08-01' }, 'v2');
  const venc = (data) => { relogio(s, data); return agenda(s); };
  assert.deepEqual(situacoes(venc('2027-10-21'), ids[0]), [], 'em dia: não é pendência');
  assert.deepEqual(situacoes(venc('2027-10-22'), ids[0]), [['PROXIMA', '2027-11-06']]);
  assert.deepEqual(situacoes(venc('2027-11-06'), ids[0]), [['PROXIMA', '2027-11-06']]);
  const a = venc('2027-11-07');
  assert.deepEqual(situacoes(a, ids[0]), [['VENCIDA', '2027-11-06']]);
  assert.deepEqual(situacoes(a, ids[1]), [['VENCIDA', '2027-08-01']], 'a próxima informada vale sobre o intervalo');
  // Segunda convergência, rodada 1 (achado 8): elegível quando, ao mesmo tempo, está no rebanho e o protocolo está ativo (05,
  // seção 4.7) — o protocolo vale desde a primeira aplicação com ele (10/05/2027, antes do cadastro), não desde a entrada.
  assert.deepEqual(situacoes(a, ids[2]), [['VENCIDA', '2027-05-10']], 'nunca aplicado: vencido desde que ficou elegível (o mais tarde entre a entrada no rebanho e o início do protocolo)');
  assert.deepEqual(a.protocolos.map((x) => [x.elegiveis, x.em_dia, x.cobertura.valor]), [[3, 0, 0]]);
  // A aplicação posterior da mesma chave cumpre: o ciclo recomeça.
  vacina(s, '2027-11-07', [ids[0]], { protocol_id: p.protocol_id }, 'v3');
  const b = agenda(s);
  assert.deepEqual(situacoes(b, ids[0]), [], 'cumprida');
  assert.deepEqual(b.protocolos.map((x) => [x.elegiveis, x.em_dia, x.cobertura.valor, x.cobertura.n]), [[3, 1, 33.3, 3]], '1 de 3 em dia = 33,3%');
  // Desativado, o protocolo sai da agenda (o histórico fica).
  ok(api(s, 'protocolo.salvar', { protocol_id: p.protocol_id, campos: { ativo: false } }, 'des'));
  assert.deepEqual([agenda(s).pendencias.length, agenda(s).protocolos.length], [0, 0]);
});

test('CAMPANHA_MESES (03a, 4.9): meses 5 e 11 com tolerância de 7 dias → a campanha de maio de 2027 vence em 31/05 e é cumprida por aplicação de 24/04 a 07/06; a de antes do prazo não conta; vencida até a aplicação, depois a de novembro', () => {
  const s = S.sistema();
  relogio(s, '2027-04-01');
  const ids = ok(api(s, 'evento.registrar', S.entradaInicial(['21', '22', '23'].map((b) => S.bicho({ brinco: b, data_nascimento: '2024-01-01', data_nascimento_confianca: 'CONFIRMADA' }))), 'reb')).animais.map((a) => a.animal_id);
  const p = protocolo(s, { nome: 'Aftosa', recorrencia_tipo: 'CAMPANHA_MESES', meses_campanha: [5, 11], tolerancia_dias: 7 }, 'p');
  relogio(s, '2027-05-20');
  assert.deepEqual(situacoes(agenda(s), ids[0]), [['PROXIMA', '2027-05-31']], 'dentro da antecedência de 15 dias (padrão)');
  vacina(s, '2027-04-23', [ids[0]], { protocol_id: p.protocol_id }, 'antes');
  vacina(s, '2027-04-24', [ids[1]], { protocol_id: p.protocol_id }, 'no-limite');
  relogio(s, '2027-06-10');
  const a = agenda(s);
  assert.deepEqual(situacoes(a, ids[0]), [['VENCIDA', '2027-05-31']], 'a de 23/04 é antes da tolerância: não cumpre');
  assert.deepEqual(situacoes(a, ids[1]), [], '24/04 = 01/05 − 7 dias: cumpre');
  vacina(s, '2027-06-07', [ids[2]], { protocol_id: p.protocol_id }, 'fim');
  assert.deepEqual(situacoes(agenda(s), ids[2]), [], '07/06 = 31/05 + 7: cumpre');
  relogio(s, '2027-10-23');
  assert.deepEqual(situacoes(agenda(s), ids[0]), [['VENCIDA', '2027-05-31']], 'a de maio continua devida até abrir a janela de novembro (01/11 − 7 dias = 25/10)');
  relogio(s, '2027-11-20');
  assert.deepEqual(situacoes(agenda(s), ids[0]), [['PROXIMA', '2027-11-30']], 'aberta a janela de novembro, vale ela (a de maio não se cumpre mais)');
  vacina(s, '2027-11-20', [ids[0]], { protocol_id: p.protocol_id }, 'nov');
  assert.deepEqual(situacoes(agenda(s), ids[0]), [], 'aplicada em novembro: cumprida');
});

test('UNICA (05, seção 4.7): fêmeas de 3 a 8 meses — a bezerra nascida em 10/02/2027 fica elegível em 10/05/2027 e a pendência vence em 10/10/2027; o macho não é elegível; depois dos 8 meses continua devendo até a aplicação; aplicada, cumprida para sempre', () => {
  const s = S.sistema();
  relogio(s, '2027-02-15');
  const mae = ok(api(s, 'evento.registrar', S.entradaInicial([S.bicho({ brinco: '31', data_nascimento: '2022-01-01', data_nascimento_confianca: 'CONFIRMADA' }), S.bicho({ brinco: '32', data_nascimento: '2022-01-01', data_nascimento_confianca: 'CONFIRMADA' })]), 'reb')).animais;
  const parto = (mid, sexo, chave) => ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2027-02-10' }, animais: [{ animal_id: mid }], crias: [{ situacao_nascimento: 'VIVO', sexo }] }, chave)).animais.find((a) => a.animal_id !== mid).animal_id;
  const bezerra = parto(mae[0].animal_id, 'F', 'p1');
  const bezerro = parto(mae[1].animal_id, 'M', 'p2');
  const p = protocolo(s, { nome: 'Brucelose', sexo_aplicavel: 'F', idade_min_meses: 3, idade_max_meses: 8, recorrencia_tipo: 'UNICA', antecedencia_alerta_dias: 15 }, 'pr');
  relogio(s, '2027-05-09');
  assert.deepEqual(situacoes(agenda(s), bezerra), [], 'antes dos 3 meses: não elegível');
  relogio(s, '2027-05-10');
  let a = agenda(s);
  assert.deepEqual(situacoes(a, bezerra), [], 'elegível, mas o vencimento (10/10) está longe');
  assert.deepEqual(a.protocolos.map((x) => [x.elegiveis, x.em_dia]), [[1, 0]], 'só a bezerra: o macho e as vacas (fora da idade) não contam');
  relogio(s, '2027-09-25');
  assert.deepEqual(situacoes(agenda(s), bezerra), [['PROXIMA', '2027-10-10']]);
  relogio(s, '2027-10-11');
  a = agenda(s);
  assert.deepEqual(situacoes(a, bezerra), [['VENCIDA', '2027-10-10']], 'com 8 meses saiu da faixa, mas continua devendo a aplicação');
  assert.deepEqual(situacoes(a, bezerro), []);
  vacina(s, '2027-10-11', [bezerra], { protocol_id: p.protocol_id }, 'b19');
  relogio(s, '2028-10-11');
  assert.deepEqual(situacoes(agenda(s), bezerra), [], 'aplicação única: cumprida');
});

test('pendência por produto sem protocolo (03b, seção 6), carência ativa e custos do período na agenda (07, seção 8.4), alertas (RN-059) e as datas: antes do marco zero sem lista, futura recusada', () => {
  const s = S.sistema();
  const ids = ok(api(s, 'evento.registrar', S.entradaInicial(['41', '42'].map((b) => S.bicho({ brinco: b }))), 'reb')).animais.map((a) => a.animal_id);
  const prod = ok(api(s, 'produto.salvar', { campos: { nome: 'Vermífugo K', categoria: 'VERMIFUGO', unidade: 'mL', custo_unitario: 0.5 } }, 'pk'));
  ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: { event_date: '2026-10-01', produto_id: prod.product_id, modo_dose: 'POR_CABECA', dose_referencia: 10, periodo_carencia_dias: 60, data_proxima_aplicacao: '2026-11-20' }, animais: ids.map((animal_id) => ({ animal_id })) }, 'vk'));
  ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'TRATAMENTO', campos: { event_date: '2026-10-05', motivo: 'Curativo', custo_valor: 5000, custo_conta_id: s.tabela('PLANO_CONTAS').find((c) => c.codigo === 'SERVICOS_VETERINARIOS').conta_id }, animais: [{ animal_id: ids[0] }] }, 'tr'));
  const a = agenda(s, { periodo_inicio: '2026-10-01', periodo_fim: '2026-11-13' });
  assert.deepEqual(a.pendencias.map((p) => [p.situacao, p.vencimento, p.nome, p.protocol_id, p.produto_id]), [['PROXIMA', '2026-11-20', 'Vermífugo K', null, prod.product_id], ['PROXIMA', '2026-11-20', 'Vermífugo K', null, prod.product_id]]);
  assert.deepEqual(a.carencia.map((c) => [c.fim, c.nome_produto]), [['2026-11-30', 'Vermífugo K'], ['2026-11-30', 'Vermífugo K']]);
  assert.deepEqual([a.resumo.em_carencia, a.custos.total, a.custos.alocado, a.custos.nao_alocado], [2, 1000 + 5000, 6000, 0], 'consumo de 20 mL a R$ 0,50 (Medicamentos) + o serviço (Serviços veterinários), os dois de classe sanitária');
  assert.deepEqual(a.custos.por_conta.map((c) => [c.codigo, c.total]), [['MEDICAMENTOS', 1000], ['SERVICOS_VETERINARIOS', 5000]]);
  const al = ok(api(s, 'alerta.listar', {})).alertas.map((x) => [x.codigo, x.n]);
  assert.ok(al.some((x) => x[0] === 'SANITARIO_PROXIMO' && x[1] === 2) && al.some((x) => x[0] === 'EM_CARENCIA' && x[1] === 2), JSON.stringify(al));
  // Antes (13/11): próxima; no dia seguinte ao vencimento (21/11): vencida; carência até 30/11 e livre depois (09, caso 072).
  relogio(s, '2026-11-21');
  assert.deepEqual(agenda(s).pendencias.map((p) => p.situacao), ['VENCIDA', 'VENCIDA']);
  relogio(s, '2026-12-01');
  assert.deepEqual(agenda(s).carencia, []);
  // Datas: futura recusada; antes do marco zero, sem lista e com o motivo.
  assert.deepEqual(det(recusa(api(s, 'sanidade.agenda', { data: '2027-01-01' }), 'VALIDATION')), [['DATA_FUTURA', 'data']]);
  const antes = agenda(s, { data: '2025-12-01' });
  assert.deepEqual([antes.motivo, antes.pendencias], ['ANTERIOR_AO_MARCO_ZERO', []]);
  assert.deepEqual(det(recusa(api(s, 'sanidade.agenda', { periodo_inicio: '2026-12-01', periodo_fim: '2026-11-01' }), 'VALIDATION')), [['FAIXA_INVALIDA', 'periodo_inicio']]);
});
