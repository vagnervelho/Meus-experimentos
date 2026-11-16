'use strict';
/**
 * PESAGEM (Fase 3, E3.1; 04, seção 4.5; 03b, seções 5 e 16.11; 05, seção 2.7, RN-049 a RN-053), por caminho: registro
 * individual, coletivo e por lote; a faixa do peso e o aviso de variação brusca; o retroativo, o mesmo dia, a correção, a
 * correção do substituto, o estorno com e sem dependente, o estorno da correção, a importação e o desfazer; a verificação
 * de integridade de PESAGENS (data = evento, animal no rebanho na data, faixa, a cópia na linha do animal, o lote) e a
 * trava única que a usa; o peso atual como projeção e a lotação pelo peso medido mais recente com a validade.
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
  assert.equal(r.error.code, code, (onde || '') + ': ' + JSON.stringify(r.error).slice(0, 500));
  return r.error;
}
const det = (e) => e.details.map((d) => [d.codigo, d.campo || null]);
function pes(data, itens, campos) {
  return { tipo: 'PESAGEM', campos: Object.assign({ event_date: data, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, campos || {}), animais: itens };
}
/** Rebanho inicial (D0 = 01/01/2026, no Pasto A): os brincos pedidos, machos castrados de 2024. */
function rebanho(s, brincos, extra) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(brincos.map((b) => S.bicho(Object.assign({ brinco: b, sexo: 'M', castrado: true, data_nascimento: '2024-05-01', data_nascimento_confianca: 'CONFIRMADA' }, extra || {})))), 'rebanho-' + brincos.join('-')), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}
const pesagensDe = (s, id) => s.tabela('PESAGENS').filter((p) => p.animal_id === id);
const animal = (s, id) => s.tabela('ANIMAIS').find((a) => a.animal_id === id);
const evento = (s, id) => s.tabela('EVENTOS').find((e) => e.event_id === id);
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}

test('registro individual e coletivo: uma linha de PESAGENS por animal (momento, método, data do evento), a linha do animal com efeito 0 e o peso copiado, o peso atual como projeção, o jejum no evento e a resposta com o ganho contra a anterior', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['0501', '0502', '0503']);
  const r1 = ok(api(s, 'evento.registrar', pes('2026-03-10', [{ animal_id: ids['0501'], peso: 300.0 }, { animal_id: ids['0502'], peso: 312.5, observacoes: 'manco da pata traseira' }]), 'p1'));
  assert.deepEqual([r1.event_type, r1.pesagem.n, r1.pesagem.total_kg, r1.pesagem.media_kg], ['PESAGEM', 2, 612.5, 306.3]);
  assert.deepEqual(r1.pesagem.animais.map((x) => x.anterior), [null, null], 'a primeira pesagem não tem anterior');
  const linhas = s.tabela('PESAGENS').filter((p) => p.event_id === r1.event_id);
  assert.deepEqual(linhas.map((p) => [p.animal_id, p.data_pesagem, p.peso_kg, p.metodo, p.tipo, p.observacoes]).sort(), [
    [ids['0501'], '2026-03-10', 300, 'BALANCA', 'ROTINA', null], [ids['0502'], '2026-03-10', 312.5, 'BALANCA', 'ROTINA', 'manco da pata traseira']].sort());
  const ea = s.tabela('EVENTO_ANIMAIS').filter((l) => l.event_id === r1.event_id);
  assert.deepEqual(ea.map((l) => [l.papel, l.efeito_inventario, l.peso, l.pasto_origem_id, l.pasto_destino_id]).sort(), [['SUJEITO', 0, 300, null, null], ['SUJEITO', 0, 312.5, null, null]].sort());
  assert.equal(evento(s, r1.event_id).event_subtype, null, 'sem subtipo (03b, seção 2.4)');
  assert.deepEqual([animal(s, ids['0501']).peso_atual, animal(s, ids['0501']).data_ultima_pesagem, animal(s, ids['0503']).peso_atual], [300, '2026-03-10', null]);
  // Segunda pesagem com jejum e o momento "saída": a resposta compara com a anterior (91 dias, 0,800 kg/dia, 24,27%).
  const r2 = ok(api(s, 'evento.registrar', pes('2026-06-09', [{ animal_id: ids['0501'], peso: 372.8 }], { jejum: true, tipo_pesagem: 'VENDA' }), 'p2'));
  assert.deepEqual(r2.pesagem.animais[0], { animal_id: ids['0501'], peso_kg: 372.8, anterior: { data: '2026-03-10', peso_kg: 300 }, ganho_kg: 72.8, dias: 91, gmd_kg_dia: 0.8, variacao_pct: 24.27 });
  assert.deepEqual(evento(s, r2.event_id).payload_json, { jejum: true });
  assert.equal(pesagensDe(s, ids['0501']).find((p) => p.event_id === r2.event_id).tipo, 'VENDA');
  assert.deepEqual([animal(s, ids['0501']).peso_atual, animal(s, ids['0501']).data_ultima_pesagem], [372.8, '2026-06-09']);
  assert.equal(pesagensDe(s, ids['0501']).length, 2, 'a nova pesagem não substitui a anterior (RN-051)');
  // A prévia (SIMULAR) é o mesmo tratador: sem gravar, com o resumo da pesagem.
  const antes = s.tabela('PESAGENS').length;
  const sim = ok(api(s, 'evento.simular', { acao: 'registrar', dados: pes('2026-07-01', [{ animal_id: ids['0503'], peso: 350 }, { animal_id: ids['0502'], peso: 360 }]) }));
  assert.deepEqual([sim.simulacao, sim.impactos.pesagem.n, sim.impactos.pesagem.media_kg, sim.linhas.PESAGENS], [true, 2, 355, 2]);
  assert.equal(s.tabela('PESAGENS').length, antes, 'a prévia não grava');
  semErro(s, 'registro');
});

test('pesagem por lote: o peso total e as cabeças vão para o evento; cada animal fica com a média (1 casa, MEDIA_LOTE); cabeças diferentes da lista, peso de animal no lote e média fora da faixa são recusados', () => {
  const s = S.sistema();
  const brincos = Array.from({ length: 18 }, (_, i) => String(600 + i));
  const ids = rebanho(s, brincos);
  const lista = brincos.map((b) => ({ animal_id: ids[b] }));
  const r = ok(api(s, 'evento.registrar', pes('2026-05-03', lista, { peso_total_lote_kg: 7432.0, qtd_cabecas_lote: 18 }), 'lote'));
  const linhas = s.tabela('PESAGENS').filter((p) => p.event_id === r.event_id);
  assert.equal(linhas.length, 18);
  assert.ok(linhas.every((p) => p.peso_kg === 412.9 && p.metodo === 'MEDIA_LOTE'), '7.432,0 ÷ 18 = 412,888… → 412,9 em cada (03b, seção 5)');
  assert.deepEqual(evento(s, r.event_id).payload_json, { peso_total_lote_kg: 7432, qtd_cabecas_lote: 18 });
  assert.deepEqual([r.pesagem.lote, r.pesagem.total_kg], [{ total_kg: 7432, cabecas: 18 }, 7432.2], 'a soma das linhas difere do total em décimos');
  const e1 = recusa(api(s, 'evento.registrar', pes('2026-05-04', lista.slice(0, 17), { peso_total_lote_kg: 7000, qtd_cabecas_lote: 18 }), 'lote-qtd'), 'VALIDATION');
  assert.deepEqual(det(e1), [['QTD_DIVERGENTE', 'qtd_cabecas_lote']]);
  assert.match(e1.details[0].mensagem, /A lista tem 17 animais, mas "Cabeças na balança" diz 18/);
  const e2 = recusa(api(s, 'evento.registrar', pes('2026-05-04', [{ animal_id: ids['600'], peso: 400 }].concat(lista.slice(1, 3)), { peso_total_lote_kg: 1200, qtd_cabecas_lote: 3 }), 'lote-peso'), 'VALIDATION');
  assert.deepEqual(det(e2), [['CAMPO_NAO_SE_APLICA', 'peso']]);
  const e3 = recusa(api(s, 'evento.registrar', pes('2026-05-04', lista.slice(0, 2), { peso_total_lote_kg: 5000, qtd_cabecas_lote: 2 }), 'lote-faixa'), 'VALIDATION');
  assert.deepEqual(det(e3), [['VALOR_FORA_DA_FAIXA', 'peso_total_lote_kg']]);
  const e4 = recusa(api(s, 'evento.registrar', pes('2026-05-04', lista.slice(0, 2), { peso_total_lote_kg: 800 }), 'lote-sem-qtd'), 'VALIDATION');
  assert.deepEqual(det(e4), [['CAMPO_OBRIGATORIO', 'qtd_cabecas_lote']]);
  semErro(s, 'lote');
});

test('faixa e formato (RN-049): peso 0, acima de 2.000 kg, com duas casas ou vazio na individual são recusados; o momento e o método só da lista (sem nascimento nem média de lote no cabeçalho); 2.000,0 kg passa', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['0701']);
  const um = (peso, campos) => pes('2026-04-01', [{ animal_id: ids['0701'], peso }], campos);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', um(0), 'z'), 'VALIDATION')), [['VALOR_FORA_DA_FAIXA', 'peso']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', um(2000.1), 'max'), 'VALIDATION')), [['VALOR_FORA_DA_FAIXA', 'peso']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', um(300.25), 'casas'), 'VALIDATION')), [['FORMATO_INVALIDO', 'peso']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', um(null), 'vazio'), 'VALIDATION')), [['CAMPO_OBRIGATORIO', 'peso']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', um(300, { tipo_pesagem: 'NASCIMENTO' }), 'nasc'), 'VALIDATION')), [['VALOR_FORA_DA_LISTA', 'tipo_pesagem']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', um(300, { metodo_pesagem: 'MEDIA_LOTE' }), 'media'), 'VALIDATION')), [['VALOR_FORA_DA_LISTA', 'metodo_pesagem']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', um(300, { tipo_pesagem: null }), 'sem-momento'), 'VALIDATION')), [['CAMPO_OBRIGATORIO', 'tipo_pesagem']]);
  assert.equal(s.tabela('PESAGENS').length, 0, 'nada gravado');
  ok(api(s, 'evento.registrar', um(2000.0), 'limite'));
  assert.equal(animal(s, ids['0701']).peso_atual, 2000);
});

test('variação brusca (RN-050): contra a pesagem anterior e, no retroativo, contra a seguinte, fora de −1,0 a 2,0 kg/dia → PESO_IMPLAUSIVEL por animal, sem gravar; aceito, grava com o aceite no evento; a política IGNORA dispensa e BLOQUEIA recusa', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['0801', '0802']);
  ok(api(s, 'evento.registrar', pes('2026-09-03', [{ animal_id: ids['0801'], peso: 441.0 }, { animal_id: ids['0802'], peso: 400.0 }]), 'base'));
  // 45,0 kg em 13/11 contra 441,0 kg em 03/09 (71 dias): −5,58 kg/dia (08, seção 5).
  const e = recusa(api(s, 'evento.registrar', pes('2026-11-13', [{ animal_id: ids['0801'], peso: 45.0 }, { animal_id: ids['0802'], peso: 430.0 }]), 'brusca'), 'NEEDS_CONFIRMATION');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.animal_id]), [['PESO_IMPLAUSIVEL', ids['0801']]], 'só o animal com a variação fora da faixa');
  assert.equal(e.details[0].mensagem, '0801: 45,0 kg em 13/11/2026 contra 441,0 kg em 03/09/2026 (71 dias) dá -5,58 kg por dia, fora da faixa esperada (de -1,0 a 2,0 kg por dia). Confira a digitação.');
  assert.equal(e.details[0].conflito.tipo, 'PESAGEM', 'aponta a pesagem de comparação');
  assert.equal(s.tabela('PESAGENS').length, 2, 'nada gravado sem o aceite');
  const r = ok(api(s, 'evento.registrar', pes('2026-11-13', [{ animal_id: ids['0801'], peso: 45.0 }, { animal_id: ids['0802'], peso: 430.0 }]), 'brusca', ['PESO_IMPLAUSIVEL']));
  assert.deepEqual(evento(s, r.event_id).payload_json.avisos_aceitos, [{ codigo: 'PESO_IMPLAUSIVEL', n: 1 }]);
  // Retroativo: 300,0 kg em 01/09 não destoa da anterior (não há) mas destoa da seguinte (400,0 em 03/09: 50 kg/dia).
  const e2 = recusa(api(s, 'evento.registrar', pes('2026-09-01', [{ animal_id: ids['0802'], peso: 300.0 }]), 'retro-brusca'), 'NEEDS_CONFIRMATION');
  assert.match(e2.details[0].mensagem, /contra a pesagem seguinte, 400,0 kg em 03\/09\/2026 \(2 dias\) dá 50,00 kg por dia/);
  // Política: IGNORA grava sem pedir; BLOQUEIA recusa com o código do aviso.
  ok(api(s, 'config.salvar', { valores: { avisos_politica: JSON.stringify({ PESO_IMPLAUSIVEL: 'IGNORA' }) } }, 'pol-ignora'));
  ok(api(s, 'evento.registrar', pes('2026-09-01', [{ animal_id: ids['0802'], peso: 300.0 }]), 'retro-ignora'));
  ok(api(s, 'config.salvar', { valores: { avisos_politica: JSON.stringify({ PESO_IMPLAUSIVEL: 'BLOQUEIA' }) } }, 'pol-bloqueia'));
  const b = recusa(api(s, 'evento.registrar', pes('2026-08-01', [{ animal_id: ids['0802'], peso: 100.0 }]), 'retro-bloqueia'), 'VALIDATION');
  assert.equal(b.details[0].codigo, 'PESO_IMPLAUSIVEL');
  semErro(s, 'variação brusca');
});

test('retroativo e fato independente (RN-017, 04 seção 5.2 ii): antes de uma pesagem gravada vale e não muda o peso atual; antes da entrada e depois da saída é recusado; no dia da venda vale; a venda retroativa antes de uma pesagem é CONFLICT com ela', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['0901', '0902']);
  ok(api(s, 'evento.registrar', pes('2026-05-01', [{ animal_id: ids['0901'], peso: 350 }]), 'maio'));
  const retro = ok(api(s, 'evento.registrar', pes('2026-03-01', [{ animal_id: ids['0901'], peso: 320 }]), 'marco'));
  assert.deepEqual([animal(s, ids['0901']).peso_atual, animal(s, ids['0901']).data_ultima_pesagem], [350, '2026-05-01'], 'o retroativo não é o peso atual');
  assert.deepEqual(retro.pesagem.animais[0].anterior, null, 'contra a pesagem anterior a ele: nenhuma');
  const antes = recusa(api(s, 'evento.registrar', pes('2025-12-31', [{ animal_id: ids['0901'], peso: 300 }]), 'antes-d0'), 'VALIDATION');
  assert.deepEqual(det(antes), [['ANTES_DO_MARCO_ZERO', 'event_date']]);
  // Venda do 0902 em 20/06: a pesagem do dia vale (o dia da saída conta); a do dia seguinte não.
  const comp = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Comprador', tipos: ['COMPRADOR'] } }, 'comp')).partner_id;
  const venda = (data, id) => ({ tipo: 'VENDA', campos: { event_date: data, partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: id }], parcelas: [{ data_vencimento: data }] });
  ok(api(s, 'evento.registrar', venda('2026-06-20', ids['0902']), 'venda'));
  ok(api(s, 'evento.registrar', pes('2026-06-20', [{ animal_id: ids['0902'], peso: 470 }]), 'dia-venda'));
  const depois = recusa(api(s, 'evento.registrar', pes('2026-06-21', [{ animal_id: ids['0902'], peso: 471 }]), 'dia-seguinte'), 'VALIDATION');
  assert.deepEqual(depois.details.map((d) => [d.codigo, d.animal_id]), [['FORA_DA_PERMANENCIA', ids['0902']]]);
  assert.equal(animal(s, ids['0902']).peso_atual, null, 'o vendido fica sem peso atual (fora do rebanho)');
  // Venda retroativa do 0901 em 01/04, antes da pesagem de 01/05: CONFLICT com a pesagem.
  const c = recusa(api(s, 'evento.registrar', venda('2026-04-01', ids['0901']), 'venda-retro'), 'CONFLICT');
  const maio = s.tabela('PESAGENS').find((p) => p.animal_id === ids['0901'] && p.data_pesagem === '2026-05-01');
  assert.deepEqual(c.details.map((d) => [d.codigo, d.conflito.event_id, d.conflito.tipo]), [['FORA_DA_PERMANENCIA', maio.event_id, 'PESAGEM']]);
  semErro(s, 'retroativo');
});

test('mesmo dia: a segunda pesagem do animal no dia pede confirmação (POSSIVEL_DUPLICIDADE, também a de outro lançamento, como a compra); aceita, o peso do dia é o da posição de depois, e a correção da primeira não muda a ordem', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['1001', '1002', '1003']);
  const p1 = ok(api(s, 'evento.registrar', pes('2026-04-10', [{ animal_id: ids['1001'], peso: 300 }]), 'm1'));
  // O mesmo animal sozinho: a guarda do lançamento inteiro (100% em comum).
  const d1 = recusa(api(s, 'evento.registrar', pes('2026-04-10', [{ animal_id: ids['1001'], peso: 305 }]), 'm2'), 'NEEDS_CONFIRMATION');
  assert.deepEqual(d1.details.map((d) => [d.codigo, d.animal_id]), [['POSSIVEL_DUPLICIDADE', null]]);
  // Num bloco com outros animais (curral em blocos): o aviso é do animal já pesado no dia.
  const d2 = recusa(api(s, 'evento.registrar', pes('2026-04-10', [{ animal_id: ids['1001'], peso: 305 }, { animal_id: ids['1002'], peso: 310 }, { animal_id: ids['1003'], peso: 320 }]), 'm3'), 'NEEDS_CONFIRMATION');
  assert.deepEqual(d2.details.map((d) => [d.codigo, d.animal_id]), [['POSSIVEL_DUPLICIDADE', ids['1001']]]);
  assert.equal(d2.details[0].mensagem, '1001 já tem pesagem em 10/04/2026 (300,0 kg, de outra pesagem). Gravar mesmo assim?');
  const p2 = ok(api(s, 'evento.registrar', pes('2026-04-10', [{ animal_id: ids['1001'], peso: 305 }, { animal_id: ids['1002'], peso: 310 }, { animal_id: ids['1003'], peso: 320 }]), 'm3', ['POSSIVEL_DUPLICIDADE']));
  assert.equal(animal(s, ids['1001']).peso_atual, 305, 'no mesmo dia vale a pesagem de depois');
  assert.equal(p2.pesagem.animais.find((x) => x.animal_id === ids['1001']).dias, 0, 'contra a do mesmo dia: 0 dias, sem GMD');
  // Corrigir a primeira (300 → 302): o substituto fica na posição dela; o peso do dia continua o da segunda.
  ok(api(s, 'evento.corrigir', Object.assign(pes('2026-04-10', [{ animal_id: ids['1001'], peso: 302 }]), { event_id: p1.event_id, justificativa: 'Leitura errada' }), 'm1-corr', ['POSSIVEL_DUPLICIDADE']));
  assert.equal(animal(s, ids['1001']).peso_atual, 305, 'a correção não muda a ordem do dia (desenho-base 16.1)');
  // Pesagem no dia da entrada por compra (com peso na compra): o aviso cita a compra.
  const forn = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Fornecedor', tipos: ['FORNECEDOR'] } }, 'forn')).partner_id;
  const comp = ok(api(s, 'evento.registrar', { tipo: 'COMPRA', campos: { event_date: '2026-05-05', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 250000, valor_animais: 250000 }, animais: [{ brinco: '1004', sexo: 'M', castrado: true, reprodutor: false, idade_meses: 14, peso: 280 }], parcelas: [{ data_vencimento: '2026-05-05' }] }, 'compra'));
  const novo = comp.animais[0].animal_id;
  const d3 = recusa(api(s, 'evento.registrar', pes('2026-05-05', [{ animal_id: novo, peso: 281 }, { animal_id: ids['1002'], peso: 330 }]), 'dia-compra'), 'NEEDS_CONFIRMATION');
  assert.match(d3.details.find((d) => d.animal_id === novo).mensagem, /1004 já tem pesagem em 05\/05\/2026 \(280,0 kg, da compra\)/);
  semErro(s, 'mesmo dia');
});

test('correção (substituto) e correção do substituto: o mesmo tratador; as linhas novas valem e as do original não; tirar e pôr animal; data fora da permanência é recusada; o estorno da correção não traz o original de volta', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['1101', '1102', '1103']);
  ok(api(s, 'evento.registrar', pes('2026-02-01', [{ animal_id: ids['1101'], peso: 280 }]), 'antes'));
  const orig = ok(api(s, 'evento.registrar', pes('2026-04-01', [{ animal_id: ids['1101'], peso: 310 }, { animal_id: ids['1102'], peso: 300 }]), 'orig'));
  // Corrigir: o peso do 1101, tirar o 1102 e pôr o 1103 (o lançamento não tem dependentes).
  const c1 = ok(api(s, 'evento.corrigir', Object.assign(pes('2026-04-01', [{ animal_id: ids['1101'], peso: 315 }, { animal_id: ids['1103'], peso: 290 }]), { event_id: orig.event_id, justificativa: 'Balança descalibrada' }), 'c1'));
  assert.equal(c1.substitui, orig.event_id);
  assert.equal(evento(s, orig.event_id).status, 'ESTORNADO');
  const vale = (id) => pesagensDe(s, id).filter((p) => evento(s, p.event_id).status === 'CONFIRMADO').map((p) => [p.data_pesagem, p.peso_kg]).sort();
  assert.deepEqual([vale(ids['1101']), vale(ids['1102']), vale(ids['1103'])], [[['2026-02-01', 280], ['2026-04-01', 315]], [], [['2026-04-01', 290]]]);
  assert.deepEqual([animal(s, ids['1101']).peso_atual, animal(s, ids['1102']).peso_atual, animal(s, ids['1103']).peso_atual], [315, null, 290]);
  assert.equal(c1.pesagem.animais.find((x) => x.animal_id === ids['1101']).anterior.peso_kg, 280, 'a resposta compara com a de antes, sem o original');
  // Corrigir o substituto: mudar a data para depois e o momento.
  const c2 = ok(api(s, 'evento.corrigir', Object.assign(pes('2026-04-05', [{ animal_id: ids['1101'], peso: 316 }, { animal_id: ids['1103'], peso: 291 }], { tipo_pesagem: 'ENTRADA' }), { event_id: c1.event_id, justificativa: 'Data e momento' }), 'c2'));
  assert.deepEqual(s.tabela('PESAGENS').filter((p) => p.event_id === c2.event_id).map((p) => [p.data_pesagem, p.tipo]), [['2026-04-05', 'ENTRADA'], ['2026-04-05', 'ENTRADA']]);
  // Correção para antes do marco zero ou de outro tipo: recusadas pelo mesmo tratador.
  assert.equal(recusa(api(s, 'evento.corrigir', Object.assign(pes('2025-12-20', [{ animal_id: ids['1101'], peso: 316 }]), { event_id: c2.event_id, justificativa: 'x' }), 'c3'), 'VALIDATION').details[0].codigo, 'ANTES_DO_MARCO_ZERO');
  // Estorno da correção: nada daquela pesagem vale (o original não volta; 03b, seção 2.7).
  ok(api(s, 'evento.estornar', { event_id: c2.event_id, justificativa: 'Pesagem lançada no lote errado' }, 'est-c2'));
  assert.deepEqual([vale(ids['1101']), vale(ids['1103'])], [[['2026-02-01', 280]], []]);
  assert.deepEqual([animal(s, ids['1101']).peso_atual, animal(s, ids['1101']).data_ultima_pesagem, animal(s, ids['1103']).peso_atual], [280, '2026-02-01', null]);
  assert.equal(evento(s, orig.event_id).status, 'ESTORNADO');
  semErro(s, 'correção');
});

test('estorno sem dependente devolve o peso anterior; estorno ou correção da entrada que deixaria a pesagem fora da permanência é CONFLICT com a pesagem; estornada a pesagem, a entrada sai', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['1201']);
  const forn = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Fornecedor', tipos: ['FORNECEDOR'] } }, 'forn')).partner_id;
  const compra = (data, peso) => ({ tipo: 'COMPRA', campos: { event_date: data, partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 250000, valor_animais: 250000 }, animais: [{ brinco: '1202', sexo: 'M', castrado: true, reprodutor: false, idade_meses: 14, peso }], parcelas: [{ data_vencimento: data }] });
  const c = ok(api(s, 'evento.registrar', compra('2026-02-10', 250), 'compra'));
  const novo = c.animais[0].animal_id;
  const p1 = ok(api(s, 'evento.registrar', pes('2026-03-20', [{ animal_id: novo, peso: 270 }, { animal_id: ids['1201'], peso: 300 }]), 'p1'));
  const p2 = ok(api(s, 'evento.registrar', pes('2026-05-20', [{ animal_id: ids['1201'], peso: 330 }]), 'p2'));
  // Estorno sem dependente: o peso atual volta ao anterior.
  ok(api(s, 'evento.estornar', { event_id: p2.event_id, justificativa: 'Duplicada' }, 'est-p2'));
  assert.deepEqual([animal(s, ids['1201']).peso_atual, animal(s, ids['1201']).data_ultima_pesagem], [300, '2026-03-20']);
  // A compra tem a pesagem de 20/03 como dependente: estornar, ou corrigir a data para depois dela, é CONFLICT.
  const e = recusa(api(s, 'evento.estornar', { event_id: c.event_id, justificativa: 'Errada' }, 'est-compra'), 'CONFLICT');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.conflito.event_id, d.conflito.tipo]), [['FORA_DA_PERMANENCIA', p1.event_id, 'PESAGEM']]);
  const corr = Object.assign(compra('2026-04-01', 250), { event_id: c.event_id, justificativa: 'Data errada' });
  corr.animais[0].animal_id = novo;
  const e2 = recusa(api(s, 'evento.corrigir', corr, 'corr-compra'), 'CONFLICT');
  assert.ok(e2.details.some((d) => d.conflito && d.conflito.event_id === p1.event_id), 'a pesagem impede a nova data');
  // Corrigir a pesagem tirando o animal comprado libera o estorno da compra (o animal fica anulado).
  const p1c = ok(api(s, 'evento.corrigir', Object.assign(pes('2026-03-20', [{ animal_id: ids['1201'], peso: 300 }]), { event_id: p1.event_id, justificativa: 'Tirar o comprado' }), 'p1c'));
  ok(api(s, 'evento.estornar', { event_id: c.event_id, justificativa: 'Compra lançada por engano' }, 'est-compra-2'));
  assert.equal(animal(s, novo).situacao_cadastral, 'ANULADO');
  assert.equal(p1c.substitui, p1.event_id);
  // Estorno da entrada inicial com a pesagem: CONFLICT; o rebanho inicial depende só da pesagem.
  const ent = s.tabela('EVENTOS').find((x) => x.event_type === 'ENTRADA_INICIAL');
  const e3 = recusa(api(s, 'evento.estornar', { event_id: ent.event_id, justificativa: 'x' }, 'est-ent'), 'CONFLICT');
  assert.ok(e3.details.every((d) => d.conflito.tipo === 'PESAGEM'), JSON.stringify(e3.details));
  semErro(s, 'estorno');
});

test('importação e desfazer: a pesagem de um animal importado impede desfazer a importação (CONFLICT com ela); estornada a pesagem, o desfazer passa', () => {
  const s = S.sistema({ config: { importacao_lote_linhas: '5' } });
  const { G } = s;
  const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
  const csv = 'Brinco;Sexo;Nasc.;Pasto\n1301;F;01/01/2022;Pasto A\n1302;M;01/01/2024;Pasto B';
  const c = s.exec((ctx) => G.ImportService.criar(ctx, { idempotencyKey: 'imp-criar', dados: { tipo: 'ANIMAIS', arquivo_nome: 'rebanho.csv', conteudo_base64: Buffer.from(csv, 'utf8').toString('base64'), formato: FORMATO } })).dados;
  const mapa = { colunas: { Brinco: 'brinco', Sexo: 'sexo', 'Nasc.': 'data_nascimento', Pasto: 'pasto' }, confiancas: { data_nascimento: 'ESTIMADA' }, padroes: { castrado: true, reprodutor: false } };
  let est;
  for (let b = 1; b < 10 && (!est || est.importacao.status !== 'VALIDADO'); b++) est = s.exec((ctx) => G.ImportService.validarBloco(ctx, { idempotencyKey: 'imp-val-' + b, dados: { import_id: c.import_id, bloco: b, mapeamento: mapa } })).dados;
  s.exec((ctx) => G.ImportService.importarBloco(ctx, { dados: { import_id: c.import_id, bloco: 1, modo: 'TOTAL' } }));
  s.exec((ctx) => G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } }));
  const a = s.tabela('ANIMAIS').find((x) => x.brinco === '1302');
  const p = ok(api(s, 'evento.registrar', pes('2026-03-01', [{ animal_id: a.animal_id, peso: 250 }]), 'p-imp'));
  let r = s.tentar((ctx) => G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id, justificativa: 'Arquivo errado' } }));
  assert.equal(r.erro.code, 'CONFLICT');
  assert.deepEqual(r.erro.details.map((d) => [d.conflito.event_id, d.conflito.tipo]), [[p.event_id, 'PESAGEM']]);
  ok(api(s, 'evento.estornar', { event_id: p.event_id, justificativa: 'Animal do arquivo errado' }, 'est-p-imp'));
  r = s.tentar((ctx) => G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id, justificativa: 'Arquivo errado' } }));
  assert.equal(r.ok, true, JSON.stringify(r.erro));
  assert.equal(animal(s, a.animal_id).situacao_cadastral, 'ANULADO');
  semErro(s, 'importação desfeita');
});

test('verificação de integridade de PESAGENS (COPIAS, LINHA_DO_TEMPO): data ≠ evento, momento de outro tipo, peso fora da faixa, cópia na linha do animal, linha sem animal no lançamento, linha apagada, média do lote mexida e linha MEDIA_LOTE sem lote; fato fora da permanência', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['1401', '1402', '1403', '1404', '1405']);
  const ind = ok(api(s, 'evento.registrar', pes('2026-03-01', [{ animal_id: ids['1401'], peso: 300 }, { animal_id: ids['1402'], peso: 310 }]), 'ind'));
  const lote = ok(api(s, 'evento.registrar', pes('2026-03-02', ['1403', '1404', '1405'].map((b) => ({ animal_id: ids[b] })), { peso_total_lote_kg: 960, qtd_cabecas_lote: 3 }), 'lote'));
  semErro(s, 'antes de mexer');
  const linhaDe = (ev, id) => s.tabela('PESAGENS').find((p) => p.event_id === ev && p.animal_id === id);
  const achados = () => s.integridade().achados.filter((x) => x.severidade === 'ERRO').map((x) => [x.checagem, x.campo]);
  const restaurar = [];
  const mexer = (aba, idReg, col, valor) => {
    const atual = s.tabela(aba).find((x) => x[s.G.Schema.pk(aba)] === idReg)[col];
    restaurar.push([aba, idReg, col, atual]);
    s.editar(aba, idReg, col, valor);
  };
  const desfazer = () => { while (restaurar.length) { const [aba, idReg, col, v] = restaurar.pop(); s.editar(aba, idReg, col, v === null ? '' : v); } };
  const w1 = linhaDe(ind.event_id, ids['1401']);
  mexer('PESAGENS', w1.weight_id, 'data_pesagem', '2026-03-05');
  assert.deepEqual(achados(), [['COPIAS', 'data_pesagem']]);
  desfazer();
  mexer('PESAGENS', w1.weight_id, 'tipo', 'NASCIMENTO');
  assert.deepEqual(achados(), [['COPIAS', 'tipo'], ['COPIAS', 'tipo']], 'momento fora da lista da pesagem e diferente das outras linhas');
  desfazer();
  mexer('PESAGENS', w1.weight_id, 'peso_kg', 2500);
  assert.deepEqual(achados(), [['COPIAS', 'peso_kg'], ['COPIAS', 'peso_kg'], ['PROJECAO', 'peso_atual']], 'fora da faixa, diferente da linha do animal, e a projeção');
  desfazer();
  const ea = s.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === ind.event_id && l.animal_id === ids['1402']);
  mexer('EVENTO_ANIMAIS', ea.event_animal_id, 'peso', 311);
  assert.deepEqual(achados(), [['COPIAS', 'peso_kg']]);
  desfazer();
  mexer('PESAGENS', w1.weight_id, 'animal_id', ids['1405']);
  const a2 = achados();
  assert.ok(a2.some((x) => x[0] === 'COPIAS' && x[1] === 'animal_id'), 'linha de animal sem linha no lançamento: ' + JSON.stringify(a2));
  assert.ok(a2.some((x) => x[0] === 'COPIAS' && x[1] === 'PESAGENS'), 'e o animal do lançamento sem a pesagem: ' + JSON.stringify(a2));
  desfazer();
  const l3 = linhaDe(lote.event_id, ids['1403']);
  mexer('PESAGENS', l3.weight_id, 'peso_kg', 330);
  assert.deepEqual(achados(), [['COPIAS', 'peso_kg'], ['COPIAS', 'peso_kg'], ['PROJECAO', 'peso_atual']], 'a média do lote (320,0) e a cópia');
  desfazer();
  mexer('PESAGENS', linhaDe(ind.event_id, ids['1402']).weight_id, 'metodo', 'MEDIA_LOTE');
  assert.deepEqual(achados(), [['COPIAS', 'metodo']]);
  desfazer();
  mexer('EVENTOS', lote.event_id, 'payload_json', JSON.stringify({ peso_total_lote_kg: 960, qtd_cabecas_lote: 4 }));
  assert.ok(achados().some((x) => x[0] === 'COPIAS' && x[1] === 'payload_json'), 'cabeças do lote ≠ animais do lançamento');
  desfazer();
  // A linha apagada à mão: o detalhe que o tipo grava falta (fonte quebrada; o reparo não é oferecido).
  s.apagarLinha('PESAGENS', w1.weight_id);
  const rel = s.integridade();
  assert.ok(rel.achados.some((x) => x.checagem === 'COPIAS' && /está sem a linha de PESAGENS/.test(x.mensagem)), JSON.stringify(rel.achados.slice(0, 3)));
  assert.equal(rel.reparavel, false);
  // A trava: lançar para o animal da fonte quebrada é recusado (CONFLICT INTEGRIDADE_COPIAS), nada gravado.
  const n0 = s.tabela('PESAGENS').length;
  const t = recusa(api(s, 'evento.registrar', pes('2026-04-01', [{ animal_id: ids['1401'], peso: 320 }]), 'trava'), 'CONFLICT');
  assert.ok(t.details.some((d) => d.codigo === 'INTEGRIDADE_COPIAS'), JSON.stringify(t.details).slice(0, 400));
  assert.equal(s.tabela('PESAGENS').length, n0);
});

test('a trava confere PESAGENS em todo caminho: uma linha de pesagem fora da permanência (data da pesagem mexida para depois da saída) é achada pela verificação; o comando que não a piora segue', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['1501', '1502']);
  const comp = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Comprador', tipos: ['COMPRADOR'] } }, 'comp')).partner_id;
  const p = ok(api(s, 'evento.registrar', pes('2026-03-01', [{ animal_id: ids['1501'], peso: 300 }]), 'p'));
  ok(api(s, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-04-01', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: ids['1501'] }], parcelas: [{ data_vencimento: '2026-04-01' }] }, 'venda'));
  // Edição à mão do evento da pesagem para depois da venda: LINHA_DO_TEMPO (fato fora da permanência) e as cópias.
  s.editar('EVENTOS', p.event_id, 'event_date', '2026-05-01');
  const rel = s.integridade();
  const cods = rel.achados.filter((x) => x.severidade === 'ERRO').map((x) => x.checagem);
  assert.ok(cods.includes('LINHA_DO_TEMPO') && cods.includes('COPIAS'), JSON.stringify(cods));
  // Um comando de outro animal não piora o problema antigo: segue.
  ok(api(s, 'evento.registrar', pes('2026-05-02', [{ animal_id: ids['1502'], peso: 320 }]), 'outro'));
});

test('lotação e peso médio do pasto em data pelo peso medido mais recente até a data, com a validade (07, seção 8.2; desenho-base, seção 6): pesagem depois da data não conta; vencida vira o peso de referência, estimado', () => {
  const s = S.sistema({ config: { peso_validade_dias: '60' } });
  const ids = rebanho(s, ['1601', '1602']);
  const cat = s.tabela('CATEGORIAS').find((c) => c.codigo === 'GARROTE');
  ok(api(s, 'categoria.salvar', { category_id: cat.category_id, campos: { peso_referencia_kg: 330 } }, 'ref'));
  ok(api(s, 'evento.registrar', pes('2026-03-01', [{ animal_id: ids['1601'], peso: 300 }, { animal_id: ids['1602'], peso: 360 }]), 'p1'));
  ok(api(s, 'evento.registrar', pes('2026-04-15', [{ animal_id: ids['1601'], peso: 340 }]), 'p2'));
  const painel = (data) => ok(api(s, 'pasto.painel', { pasture_id: PASTOS.A, data }));
  const p1 = painel('2026-04-01');
  assert.deepEqual([p1.peso_vivo_total.valor, p1.peso_medio.valor, p1.ua.valor, p1.peso_medio.estimado], [660, 330, 1.47, false], 'em 01/04: 300 + 360 (a de 15/04 ainda não)');
  const p2 = painel('2026-04-20');
  assert.deepEqual([p2.peso_vivo_total.valor, p2.peso_medio.valor], [700, 350], 'em 20/04: 340 + 360');
  // Em 20/05: a do 1602 (01/03) tem 80 dias, vencida (validade 60): o maior entre 360 e a referência 330 → 360, estimado.
  const p3 = painel('2026-05-20');
  assert.deepEqual([p3.peso_vivo_total.valor, p3.ua.partes.pesada.cabecas, p3.ua.partes.pesagem_vencida.cabecas, p3.peso_medio.estimado], [700, 1, 1, true]);
  // O mesmo peso médio na consulta de desempenho, por pasto, no fim do período.
  const d = ok(api(s, 'peso.desempenho', { ate: '2026-05-20' }));
  const pa = d.por_pasto.find((x) => x.pasture_id === PASTOS.A);
  assert.deepEqual([pa.cabecas, pa.peso_medio.valor, pa.peso_medio.pct_estimado], [2, 350, 50]);
});
