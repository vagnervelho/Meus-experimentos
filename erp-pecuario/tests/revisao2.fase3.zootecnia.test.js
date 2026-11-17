'use strict';
/**
 * Revisão da Fase 3, rodada 2 (conserto), achados de zootecnia e de regras: a cria ao pé das fêmeas numa data passada (pela
 * regra da projeção, só com os fatos até a data), a agenda sanitária numa data passada só com os protocolos que já existiam,
 * a estimativa visual marcada como estimada no peso médio e na UA, o GMD da resposta do registro igual ao da ficha, a
 * correção da desmama legítima depois de mudar a idade de desmama, o produto do cadastro sem custo unitário e as pesagens de
 * lote da tela de desempenho dentro do filtro.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js, PASTOS } = S;

function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave || 'k-' + Math.random(), avisosAceitos: avisos || [] })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + String(JSON.stringify(r.error)).slice(0, 1500));
  return r.data;
}
function recusa(r, code, onde) {
  assert.equal(r.ok, false, (onde || '') + ': esperava ' + code);
  assert.equal(r.error.code, code, (onde || '') + ': ' + JSON.stringify(r.error).slice(0, 900));
  return r.error;
}
const hoje = (s, iso) => { s.gas.clock.now = Date.parse(iso + 'T15:00:00.000Z'); };
function rebanho(s, bichos) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(bichos)), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}
const tab = (s, aba) => s.tabela(aba);
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}
const vaca = (brinco, extra) => S.bicho(Object.assign({ brinco, data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }, extra || {}));
const pesar = (s, data, itens, campos) => api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: Object.assign({ event_date: data, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, campos || {}), animais: itens }, null, ['PESO_IMPLAUSIVEL', 'POSSIVEL_DUPLICIDADE']);

test('achados 6 e 11: a lista de fêmeas numa data passada diz quem tinha cria ao pé naquela data (a regra da projeção, só com os fatos até ela) e conta o resumo; hoje, o mesmo que a projeção', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const id = rebanho(s, [vaca('100'), vaca('101')]);
  const parto = (mae, data) => ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: data }, animais: [{ animal_id: id[mae] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: 'C' + mae }] }), 'parto ' + mae).animais;
  parto('100', '2026-02-01');
  parto('101', '2026-03-01');
  const cria100 = s.tabela('ANIMAIS').find((a) => a.brinco === 'C100').animal_id;
  ok(api(s, 'evento.registrar', { tipo: 'DESMAMA', campos: { event_date: '2026-10-01' }, animais: [{ animal_id: cria100, peso: 180 }] }), 'desmama');
  const matrizes = (data) => ok(api(s, 'reproducao.matrizes', { data }));
  const aoPe = (r) => Object.fromEntries(r.itens.map((x) => [x.brinco, x.cria_ao_pe]));
  const maio = matrizes('2026-05-01');
  assert.deepEqual([aoPe(maio), maio.resumo.cria_ao_pe], [{ 100: true, 101: true }, 2], 'em 01/05 as duas tinham cria ao pé');
  const out = matrizes('2026-10-15');
  assert.deepEqual([aoPe(out), out.resumo.cria_ao_pe], [{ 100: false, 101: true }, 1], 'depois da desmama da cria da 100');
  const jan = matrizes('2026-01-15');
  assert.deepEqual([aoPe(jan), jan.resumo.cria_ao_pe], [{ 100: false, 101: false }, 0], 'antes dos partos');
  const h = matrizes('2026-11-15');
  const proj = Object.fromEntries(s.tabela('ANIMAIS').filter((a) => a.brinco === '100' || a.brinco === '101').map((a) => [a.brinco, a.cria_ao_pe]));
  assert.deepEqual(aoPe(h), proj, 'hoje: o mesmo que a projeção');
  assert.equal(h.resumo.cria_ao_pe, 1);
  semErro(s, 'cria ao pé');
});

test('achados 7, 16 e 22 (servidor): inventario.elegiveis numa data passada devolve o brinco em uso NAQUELA data (e o de hoje à parte) — o número trocado e reaproveitado depois é de outro animal no dia; a pesagem daquele dia vai para o animal certo', () => {
  const s = S.sistema({ config: { brinco_permite_reuso: 'S' } });
  hoje(s, '2026-11-13');
  const id = rebanho(s, [vaca('0457'), vaca('0391')]);
  const A = id['0457'];
  const B = id['0391'];
  const ident = (data, itens) => ok(api(s, 'evento.registrar', { tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: data, tipo_identificacao: 'BRINCO' }, animais: itens }), 'troca ' + data);
  ident('2026-11-11', [{ animal_id: A, codigo: '1457', motivo: 'PERDA' }]);
  ident('2026-11-12', [{ animal_id: B, codigo: '0457', motivo: 'RENUMERACAO' }]);
  const el = (data) => Object.fromEntries(ok(api(s, 'inventario.elegiveis', { tipo: 'PESAGEM', data })).itens.map((x) => [x.animal_id === A ? 'A' : 'B', [x.brinco, x.brinco_hoje]]));
  assert.deepEqual(el('2026-11-10'), { A: ['0457', '1457'], B: ['0391', '0457'] }, 'em 10/11, o 0457 é da vaca A');
  assert.deepEqual(el('2026-11-11'), { A: ['1457', '1457'], B: ['0391', '0457'] });
  assert.deepEqual(el('2026-11-13'), { A: ['1457', '1457'], B: ['0457', '0457'] }, 'hoje, o brinco de hoje');
  const rep = Object.fromEntries(ok(api(s, 'inventario.elegiveis', { tipo: 'REPRODUCAO', data: '2026-11-10' })).itens.map((x) => [x.animal_id === A ? 'A' : 'B', x.brinco]));
  assert.deepEqual(rep, { A: '0457', B: '0391' }, 'o tronco usa a mesma posição');
  semErro(s, 'brinco na data');
});

test('achados 13 e 21: o GMD da resposta do registro (o modo curral) é o do intervalo da ficha que termina nesta pesagem — a média do lote no meio não esconde o GMD contra a balança anterior; a segunda pesagem do dia (a que a ficha usa) tem o GMD; a primeira do dia diz o porquê verdadeiro', () => {
  const s = S.sistema();
  hoje(s, '2026-11-13');
  const boi = (b) => S.bicho({ brinco: b, sexo: 'M', castrado: true, data_nascimento: '2024-05-01', data_nascimento_confianca: 'CONFIRMADA' });
  const r = rebanho(s, [boi('1'), boi('2'), boi('3')]);
  ok(pesar(s, '2026-03-01', [{ animal_id: r['1'], peso: 300 }, { animal_id: r['3'], peso: 300 }]));
  ok(pesar(s, '2026-04-01', [{ animal_id: r['1'] }, { animal_id: r['2'] }], { peso_total_lote_kg: 660, qtd_cabecas_lote: 2 }), 'lote');
  const a1 = ok(pesar(s, '2026-05-01', [{ animal_id: r['1'], peso: 360 }])).pesagem.animais[0];
  const ficha1 = ok(api(s, 'animal.ficha', { animal_id: r['1'] })).peso;
  const ult = ficha1.intervalos[ficha1.intervalos.length - 1];
  assert.equal(typeof ult.gmd_kg_dia, 'number');
  assert.deepEqual([a1.gmd_kg_dia, a1.gmd_explicacao], [ult.gmd_kg_dia, null], 'o GMD do intervalo 01/03 → 01/05 da ficha');
  assert.deepEqual([a1.ganho_kg, a1.dias, a1.anterior.estimado], [30, 30, true], 'o ganho e os dias contra a anterior (a média do lote), marcada como estimada');
  // Duas pesagens no mesmo dia: a ficha usa a última do dia.
  const p1 = ok(pesar(s, '2026-05-01', [{ animal_id: r['3'], peso: 358 }])).pesagem.animais[0];
  const p2 = ok(pesar(s, '2026-05-01', [{ animal_id: r['3'], peso: 360 }])).pesagem.animais[0];
  const ficha3 = ok(api(s, 'animal.ficha', { animal_id: r['3'] })).peso;
  const u3 = ficha3.intervalos[ficha3.intervalos.length - 1];
  assert.deepEqual([p2.gmd_kg_dia, p2.gmd_explicacao], [u3.gmd_kg_dia, null], 'a segunda do dia tem o GMD da ficha');
  assert.equal(typeof p2.gmd_kg_dia, 'number');
  // A primeira do dia, relida agora (o reenvio devolve o resultado de hoje): vazia, com o porquê verdadeiro.
  const rel = s.exec((ctx) => s.G.UnitOfWork.read(ctx, { rota: 't', reads: s.G.Timeline.porta().reads.concat(['CONFIGURACOES', 'PESAGENS']), acessoCru: true, tratador: (tx) => s.G.WeightService.resultadoDoEvento(tx, tab(s, 'PESAGENS').find((x) => x.peso_kg === 358).event_id) })).dados.animais[0];
  assert.equal(rel.gmd_kg_dia, null);
  assert.match(rel.gmd_explicacao, /outra pesagem no mesmo dia, depois desta/);
  assert.equal(typeof p1.gmd_kg_dia, 'number', 'na hora em que foi a única do dia, a primeira tinha o GMD');
  // Só estimadas antes: o porquê diz que as anteriores são estimadas (e não "a primeira").
  const e = ok(pesar(s, '2026-06-01', [{ animal_id: r['2'], peso: 340 }])).pesagem.animais[0];
  assert.equal(e.gmd_kg_dia, null);
  assert.match(e.gmd_explicacao, /As pesagens anteriores são estimadas/);
  semErro(s, 'gmd do curral');
});
