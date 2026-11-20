'use strict';
/**
 * DESMAMA, CASTRACAO e OCORRENCIA (Fase 3, E3.5; 03b, seções 2.5, 2.6, 3.4, 7.2 e 16.14; 04, seção 4.5; 03a, DL-06), por
 * caminho: registro, retroativo, mesmo dia, correção, correção do substituto, estorno com e sem dependente, estorno da
 * correção, importação e desfazer; a despesa paga no ato (CUSTEIO rateado por cabeça); a verificação de integridade e a
 * trava única.
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
const payload = (ev) => (typeof ev.payload_json === 'string' ? JSON.parse(ev.payload_json) : ev.payload_json);
const conta = (s, codigo) => s.tabela('PLANO_CONTAS').find((c) => c.codigo === codigo);
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}
const desmama = (data, animais, campos) => ({ tipo: 'DESMAMA', campos: Object.assign({ event_date: data }, campos || {}), animais: animais.map((a) => (typeof a === 'string' ? { animal_id: a } : a)) });
const castracao = (data, ids, campos) => ({ tipo: 'CASTRACAO', campos: Object.assign({ event_date: data }, campos || {}), animais: ids.map((animal_id) => ({ animal_id })) });
const ocorrencia = (data, ids, campos) => ({ tipo: 'OCORRENCIA', campos: Object.assign({ event_date: data, tipo_ocorrencia: 'LESAO', description: 'Cortou a pata na cerca' }, campos || {}), animais: ids.map((animal_id) => ({ animal_id })) });

/**
 * Rebanho do marco zero (01/01/2026, Pasto A): as vacas 100 e 101, o touro 900, o garrote inteiro 901, o 902 castrado de
 * origem, o bezerro 300 (entrou com 3 meses: cria pela regra DL-06) e a novilha 301 (12 meses: não é cria). Partos: a 100
 * tem gêmeos (50 e 51) em 01/02/2026; a 101, a 52 em 10/02/2026.
 */
function base() {
  const s = S.sistema();
  s.gas.clock.now = Date.parse('2026-09-15T15:00:00.000Z');
  const r = ok(api(s, 'evento.registrar', S.entradaInicial([
    S.bicho({ brinco: '100', data_nascimento: '2021-03-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 2 }),
    S.bicho({ brinco: '101', data_nascimento: '2021-05-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }),
    S.bicho({ brinco: '900', sexo: 'M', reprodutor: true, data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '901', sexo: 'M', data_nascimento: '2025-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '902', sexo: 'M', castrado: true, data_nascimento: '2024-01-01', data_nascimento_confianca: 'ESTIMADA' }),
    S.bicho({ brinco: '300', sexo: 'M', data_nascimento: '2025-10-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '301', data_nascimento: '2025-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 0 }),
  ]), 'rebanho'), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  const p1 = ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-02-01', pai_id: ids['900'], pai_confianca: 'CONFIRMADA' }, animais: [{ animal_id: ids['100'] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: '50' }, { situacao_nascimento: 'VIVO', sexo: 'F', brinco: '51' }] }, 'p1'));
  const p2 = ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-02-10' }, animais: [{ animal_id: ids['101'] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '52' }] }, 'p2'));
  [p1, p2].forEach((p) => p.animais.forEach((a) => { if (a.brinco) ids[a.brinco] = a.animal_id; }));
  return { s, ids, partos: [p1, p2] };
}

test('desmama (03b, 3.4 e 16.14): os bezerros com o peso e o pasto de destino — linha SUJEITO (efeito 0) com o movimento, a pesagem DESMAMA, a linha MATRIZ e o registro DESMAMA uma vez por mãe (gêmeos); a mãe perde a cria ao pé; a cria pela idade de entrada (DL-06); não é cria, já desmamado, antes de nascer; o resumo do servidor', () => {
  const { s, ids } = base();
  const dados = desmama('2026-09-01', [{ animal_id: ids['50'], peso: 210.5 }, { animal_id: ids['51'], peso: 200 }, ids['52'], ids['300']], { pasto_destino_id: PASTOS.B, metodo_pesagem: 'BALANCA' });
  const sim = ok(api(s, 'evento.simular', { acao: 'registrar', dados }));
  assert.deepEqual([sim.impactos.manejo.bezerros, sim.impactos.manejo.maes, sim.impactos.manejo.movidos, sim.impactos.manejo.pesados, sim.impactos.manejo.peso_medio_kg], [4, 2, 4, 2, 205.3]);
  assert.deepEqual(sim.impactos.manejo.animais.map((a) => [a.brinco, a.peso_kg, a.idade_meses]), [['50', 210.5, 7], ['51', 200, 7], ['52', null, 6], ['300', null, 11]]);
  const r = ok(api(s, 'evento.registrar', dados, 'dz'));
  const linhas = tab(s, 'EVENTO_ANIMAIS', { event_id: r.event_id });
  const por = (id) => linhas.filter((l) => l.animal_id === id).map((l) => [l.papel, l.efeito_inventario, l.pasto_origem_id || null, l.pasto_destino_id || null, l.peso || null]);
  assert.deepEqual(por(ids['50']), [['SUJEITO', 0, PASTOS.A, PASTOS.B, 210.5]]);
  assert.deepEqual(por(ids['52']), [['SUJEITO', 0, PASTOS.A, PASTOS.B, null]]);
  assert.deepEqual(por(ids['100']), [['MATRIZ', 0, null, null, null]], 'uma linha da mãe dos gêmeos');
  assert.deepEqual(por(ids['101']), [['MATRIZ', 0, null, null, null]]);
  assert.equal(linhas.length, 6, 'o 300 (sem mãe conhecida) não tem linha de mãe');
  assert.deepEqual(tab(s, 'REPRODUCAO', { event_id: r.event_id }).map((x) => [x.animal_id, x.tipo_evento, x.data]).sort(), [[ids['100'], 'DESMAMA', '2026-09-01'], [ids['101'], 'DESMAMA', '2026-09-01']].sort());
  assert.deepEqual(tab(s, 'PESAGENS', { event_id: r.event_id }).map((p) => [p.animal_id, p.peso_kg, p.tipo, p.metodo, p.data_pesagem]).sort(), [[ids['50'], 210.5, 'DESMAMA', 'BALANCA', '2026-09-01'], [ids['51'], 200, 'DESMAMA', 'BALANCA', '2026-09-01']].sort());
  assert.deepEqual([animal(s, ids['50']).pasto_atual_id, animal(s, ids['50']).peso_atual, animal(s, ids['300']).pasto_atual_id], [PASTOS.B, 210.5, PASTOS.B]);
  assert.deepEqual([animal(s, ids['100']).cria_ao_pe, animal(s, ids['101']).cria_ao_pe], [false, false]);
  // Recusas: não é cria (a novilha de 12 meses na entrada, a vaca), já desmamado (o mesmo dia ou outro), antes de nascer.
  let e = recusa(api(s, 'evento.registrar', desmama('2026-09-02', [ids['301'], ids['100']]), 'x1'), 'VALIDATION');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.brinco]), [['NAO_E_CRIA', '301'], ['NAO_E_CRIA', '100']]);
  assert.match(e.details[0].mensagem, /entrou no rebanho com idade igual ou acima da desmama de referência \(8 meses\)/);
  e = recusa(api(s, 'evento.registrar', desmama('2026-09-01', [ids['50']]), 'x2'), 'VALIDATION');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.mensagem]), [['JA_DESMAMADO', '50: já foi desmamado em 01/09/2026. Para mudar a data, corrija aquela desmama.']]);
  const nasc = ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-09-10' }, animais: [{ animal_id: ids['100'] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '53' }] }, 'p3', ['INTERVALO_PARTO_CURTO']));
  const n53 = nasc.animais.find((a) => a.brinco === '53').animal_id;
  e = recusa(api(s, 'evento.registrar', desmama('2026-09-05', [n53]), 'x3'), 'VALIDATION');
  assert.deepEqual(cods(e), ['FORA_DA_PERMANENCIA', 'ANTES_DO_NASCIMENTO']);
  assert.equal(animal(s, ids['100']).cria_ao_pe, true, 'a cria nova está ao pé');
  // O pasto de destino igual ao atual não move (o bezerro continua no A); pasto desativado não recebe. O pasto informado fica
  // gravado na linha, com origem = destino (CONTRATOS, seção 54, achado 4: a linha do tempo confere a origem, e o fato que o
  // tiraria dele naquele dia é recusado).
  const d53 = ok(api(s, 'evento.registrar', desmama('2026-09-12', [n53], { pasto_destino_id: PASTOS.A }), 'd53'));
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: d53.event_id, animal_id: n53 }).map((l) => [l.pasto_origem_id || null, l.pasto_destino_id || null]), [[PASTOS.A, PASTOS.A]]);
  assert.equal(animal(s, n53).pasto_atual_id, PASTOS.A, 'o bezerro não mudou de pasto');
  semErro(s, 'desmama');
});

test('desmama por caminho: retroativo antes de uma transferência (CONFLICT), correção (peso, pasto e data), correção do substituto, estorno da correção (o bezerro volta, a mãe volta a ter cria ao pé, a pesagem sai), estorno do parto com a desmama dependente (CONFLICT), estorno sem dependente; integridade e trava', () => {
  const { s, ids, partos } = base();
  // Retroativo: o 52 foi transferido de A para B em 01/08; uma desmama em 01/07 que o leva para B quebraria a origem da transferência.
  const tr = ok(api(s, 'evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-08-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: ids['52'] }, { animal_id: ids['101'] }] }, 'tr'));
  const e = recusa(api(s, 'evento.registrar', desmama('2026-07-01', [ids['52']], { pasto_destino_id: PASTOS.B }), 'retro'), 'CONFLICT');
  assert.ok(e.details.some((d) => d.conflito && d.conflito.event_id === tr.event_id), JSON.stringify(e.details));
  ok(api(s, 'evento.registrar', desmama('2026-07-01', [ids['52']]), 'retro-ok'), 'sem mudar de pasto, o retroativo passa');
  // Registro, correção e substituto.
  const r = ok(api(s, 'evento.registrar', desmama('2026-09-01', [{ animal_id: ids['50'], peso: 210 }], { pasto_destino_id: PASTOS.B }), 'dz'));
  const k1 = ok(api(s, 'evento.corrigir', Object.assign(desmama('2026-08-30', [{ animal_id: ids['50'], peso: 212 }, { animal_id: ids['51'], peso: 190 }], { pasto_destino_id: PASTOS.B }), { event_id: r.event_id, justificativa: 'Faltou a irmã' }), 'k1'));
  assert.deepEqual(tab(s, 'PESAGENS', { event_id: k1.event_id }).map((p) => [p.animal_id, p.peso_kg, p.data_pesagem]).sort(), [[ids['50'], 212, '2026-08-30'], [ids['51'], 190, '2026-08-30']].sort());
  assert.equal(tab(s, 'PESAGENS', { event_id: r.event_id }).length, 1, 'a pesagem do original fica gravada, fora da vigência');
  assert.deepEqual([animal(s, ids['50']).peso_atual, animal(s, ids['51']).pasto_atual_id, animal(s, ids['100']).cria_ao_pe], [212, PASTOS.B, false]);
  const k2 = ok(api(s, 'evento.corrigir', Object.assign(desmama('2026-08-30', [{ animal_id: ids['50'], peso: 212 }]), { event_id: k1.event_id, justificativa: 'A irmã ficou com a mãe' }), 'k2'));
  assert.deepEqual([animal(s, ids['50']).pasto_atual_id, animal(s, ids['51']).pasto_atual_id, animal(s, ids['100']).cria_ao_pe], [PASTOS.A, PASTOS.A, true], 'sem pasto de destino: ninguém sai do A; a 51 volta a ser cria ao pé');
  ok(api(s, 'evento.estornar', { event_id: k2.event_id, justificativa: 'Não houve desmama' }, 'e-k2'));
  assert.deepEqual([animal(s, ids['50']).peso_atual, animal(s, ids['100']).cria_ao_pe, tab(s, 'EVENTOS', { event_id: r.event_id })[0].status], [null, true, 'ESTORNADO'], 'o original não volta: a cadeia toda fica estornada');
  // Estorno do parto com a desmama dependente; sem dependente, passa.
  const d51 = ok(api(s, 'evento.registrar', desmama('2026-09-02', [ids['51']]), 'd51'));
  const c = recusa(api(s, 'evento.estornar', { event_id: partos[0].event_id, justificativa: 'x' }, 'e-p1'), 'CONFLICT');
  assert.ok(c.details.some((d) => d.conflito && d.conflito.event_id === d51.event_id), JSON.stringify(c.details));
  ok(api(s, 'evento.estornar', { event_id: d51.event_id, justificativa: 'repetida' }, 'e-d51'));
  semErro(s, 'caminhos');
  // Integridade: o registro DESMAMA da mãe apagado à mão; o peso da linha diferente da pesagem.
  const d2 = ok(api(s, 'evento.registrar', desmama('2026-09-03', [{ animal_id: ids['50'], peso: 220 }]), 'd2'));
  const reg = tab(s, 'REPRODUCAO', { event_id: d2.event_id })[0];
  s.apagarLinha('REPRODUCAO', reg.reproduction_id);
  const rel = s.integridade();
  assert.ok(rel.achados.some((a) => a.checagem === 'COPIAS' && /REPRODUCAO/.test(a.mensagem)), JSON.stringify(rel.achados.slice(0, 3).map((a) => a.mensagem)));
  ok(api(s, 'evento.registrar', ocorrencia('2026-09-10', [ids['100']]), 'oc-mae'), 'a ocorrência não regrava nada da mãe: passa');
  const pes = { tipo: 'PESAGEM', campos: { event_date: '2026-09-10', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids['100'], peso: 480 }] };
  const t = recusa(api(s, 'evento.registrar', pes, 'trava'), 'CONFLICT');
  assert.deepEqual(cods(t), ['INTEGRIDADE_COPIAS'], 'a pesagem regravaria a mãe cuja fonte está quebrada: a trava recusa');
});

test('castração (04, 4.5): macho inteiro do rebanho; o touro castrado deixa de ser reprodutor; a despesa no ato vira CUSTEIO rateado por cabeça; fêmea, castrado de origem e castração repetida recusados; correção, substituto, estorno da correção (volta a ser touro), estorno da entrada com castração dependente', () => {
  const { s, ids } = base();
  const vet = conta(s, 'SERVICOS_VETERINARIOS').conta_id;
  const r = ok(api(s, 'evento.registrar', castracao('2026-03-01', [ids['900'], ids['901']], { metodo: 'Cirúrgica', custo_valor: 10001, custo_conta_id: vet }), 'c1'));
  assert.deepEqual([ids['900'], ids['901']].map((id) => [animal(s, id).castrado, animal(s, id).reprodutor]), [[true, false], [true, false]]);
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: r.event_id }).map((l) => [l.papel, l.efeito_inventario]), [['SUJEITO', 0], ['SUJEITO', 0]]);
  const ev = tab(s, 'EVENTOS', { event_id: r.event_id })[0];
  assert.deepEqual([payload(ev).metodo, ev.total_value], ['Cirúrgica', 10001]);
  const fin = tab(s, 'FINANCEIRO', { event_id: r.event_id });
  assert.deepEqual(fin.map((f) => [f.conta_id, f.natureza, f.valor, f.descricao, f.data_competencia]), [[vet, 'CUSTEIO', 10001, 'Castração de 01/03/2026: despesa', '2026-03-01']]);
  const rat = tab(s, 'RATEIOS', { financial_id: fin[0].financial_id })[0];
  assert.deepEqual([ids['900'], ids['901']].map((id) => tab(s, 'ALOCACOES_FINANCEIRAS', { rateio_id: rat.rateio_id, animal_id: id })[0].valor_alocado), [5001, 5000]);
  assert.deepEqual(tab(s, 'PARCELAS', { financial_id: fin[0].financial_id }).map((p) => [p.data_vencimento, p.valor]), [['2026-03-01', 10001]]);
  // A ficha mostra a castração no bloco G do macho.
  assert.deepEqual(ok(api(s, 'animal.ficha', { animal_id: ids['900'] })).reprodutivo.castracao, { event_id: r.event_id, data: '2026-03-01', metodo: 'Cirúrgica' });
  // Recusas.
  const e = recusa(api(s, 'evento.registrar', castracao('2026-04-01', [ids['100'], ids['902'], ids['901']]), 'c2'), 'VALIDATION');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.brinco]), [['NAO_E_MACHO', '100'], ['JA_CASTRADO', '902'], ['JA_CASTRADO', '901']]);
  assert.match(e.details[2].mensagem, /já foi castrado em 01\/03\/2026/);
  // Mesmo dia: a mesma castração de novo é castração repetida (VALIDATION), não duplicidade a confirmar.
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', castracao('2026-03-01', [ids['901']]), 'c3'), 'VALIDATION')), ['JA_CASTRADO']);
  // Correção (só o 901, outra data), substituto (de volta os dois), estorno da correção: o 900 volta a ser touro reprodutor.
  const k1 = ok(api(s, 'evento.corrigir', Object.assign(castracao('2026-03-05', [ids['901']]), { event_id: r.event_id, justificativa: 'O touro não foi castrado' }), 'k1'));
  assert.deepEqual([animal(s, ids['900']).castrado, animal(s, ids['900']).reprodutor, animal(s, ids['901']).castrado], [false, true, true]);
  assert.ok(tab(s, 'FINANCEIRO', { event_id: r.event_id }).every((f) => f.status === 'CANCELADO'), 'a despesa do original é cancelada');
  assert.equal(tab(s, 'FINANCEIRO', { event_id: k1.event_id }).length, 0, 'a correção sem despesa');
  const k2 = ok(api(s, 'evento.corrigir', Object.assign(castracao('2026-03-05', [ids['901'], ids['900']]), { event_id: k1.event_id, justificativa: 'Eram os dois' }), 'k2'));
  assert.equal(animal(s, ids['900']).castrado, true);
  ok(api(s, 'evento.estornar', { event_id: k2.event_id, justificativa: 'Não houve castração' }, 'e-k2'));
  assert.deepEqual([animal(s, ids['900']).castrado, animal(s, ids['900']).reprodutor, animal(s, ids['901']).castrado], [false, true, false]);
  // Estorno com dependente: o macho que entrou depois e foi castrado.
  const oe = ok(api(s, 'evento.registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-05-01', description: 'Doação' }, animais: [S.bicho({ brinco: '905', sexo: 'M', data_nascimento: '2025-05-01', data_nascimento_confianca: 'ESTIMADA' })] }, 'oe'));
  const n905 = oe.animais[0].animal_id;
  const c905 = ok(api(s, 'evento.registrar', castracao('2026-05-10', [n905]), 'c905'));
  const d = recusa(api(s, 'evento.estornar', { event_id: oe.event_id, justificativa: 'x' }, 'e-oe'), 'CONFLICT');
  assert.ok(d.details.some((x) => x.codigo === 'EVENTO_DEPENDENTE' && x.conflito.event_id === c905.event_id), JSON.stringify(d.details));
  // Retroativo antes da entrada: fora da permanência.
  assert.equal(recusa(api(s, 'evento.registrar', castracao('2026-04-20', [n905]), 'c-antes'), 'VALIDATION').details.length, 1);
  semErro(s, 'castração');
  // Integridade: a linha de castração adulterada para uma fêmea (o animal_id trocado) → acusada; a trava recusa tocá-la.
  const l = tab(s, 'EVENTO_ANIMAIS', { event_id: c905.event_id })[0];
  s.editar('EVENTO_ANIMAIS', l[s.G.Schema.pk('EVENTO_ANIMAIS')], 'animal_id', ids['301']);
  const rel = s.integridade();
  assert.equal(rel.ok, false);
  assert.ok(rel.achados.some((a) => /castração/.test(a.mensagem) && /não é macho/.test(a.mensagem)), JSON.stringify(rel.achados.slice(0, 4).map((a) => a.mensagem)));
});

test('ocorrência (04, 4.5): o fato livre com o tipo da lista e a descrição; sem efeito no inventário; despesa opcional; mesmo dia e mesmo tipo pede confirmação (outro tipo, não); animal fora do rebanho na data recusado; correção e estorno; importação e desfazer com ocorrência dependente', () => {
  const { s, ids } = base();
  const r = ok(api(s, 'evento.registrar', ocorrencia('2026-09-01', [ids['50'], ids['51']], { custo_valor: 3000, custo_conta_id: conta(s, 'TRATAMENTOS').conta_id, custo_descricao: 'Curativo' }), 'o1'));
  const ev = tab(s, 'EVENTOS', { event_id: r.event_id })[0];
  assert.deepEqual([ev.event_type, ev.description, payload(ev).tipo_ocorrencia, ev.total_value], ['OCORRENCIA', 'Cortou a pata na cerca', 'LESAO', 3000]);
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: r.event_id }).map((l) => [l.papel, l.efeito_inventario]), [['SUJEITO', 0], ['SUJEITO', 0]]);
  assert.deepEqual(tab(s, 'FINANCEIRO', { event_id: r.event_id }).map((f) => [f.descricao, f.valor]), [['Curativo', 3000]]);
  // Mesmo dia, mesmo animal: mesmo tipo pede confirmação; outro tipo passa direto.
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', ocorrencia('2026-09-01', [ids['50']]), 'o2'), 'NEEDS_CONFIRMATION')), ['POSSIVEL_DUPLICIDADE']);
  ok(api(s, 'evento.registrar', ocorrencia('2026-09-01', [ids['50']]), 'o2', ['POSSIVEL_DUPLICIDADE']), 'confirmado');
  ok(api(s, 'evento.registrar', ocorrencia('2026-09-01', [ids['50']], { tipo_ocorrencia: 'OBSERVACAO', description: 'Mancando' }), 'o3'), 'outro tipo');
  // Formato: tipo e descrição obrigatórios; tipo fora da lista.
  const f = recusa(api(s, 'evento.registrar', ocorrencia('2026-09-02', [ids['50']], { tipo_ocorrencia: '', description: '' }), 'o4'), 'VALIDATION');
  assert.deepEqual(f.details.map((d) => [d.codigo, d.campo]).sort(), [['CAMPO_OBRIGATORIO', 'description'], ['CAMPO_OBRIGATORIO', 'tipo_ocorrencia']]);
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', ocorrencia('2026-09-02', [ids['50']], { tipo_ocorrencia: 'BALEIA' }), 'o5'), 'VALIDATION')), ['VALOR_FORA_DA_LISTA']);
  // Antes de nascer: fora da permanência.
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', ocorrencia('2026-01-20', [ids['50']]), 'o6'), 'VALIDATION')), ['FORA_DA_PERMANENCIA', 'ANTES_DO_NASCIMENTO']);
  // Correção e estorno.
  const corr = Object.assign(ocorrencia('2026-09-01', [ids['50']], { description: 'Cortou a pata traseira' }), { event_id: r.event_id, justificativa: 'Só o 50' });
  assert.deepEqual(cods(recusa(api(s, 'evento.corrigir', corr, 'k'), 'NEEDS_CONFIRMATION')), ['POSSIVEL_DUPLICIDADE'], 'a correção também cai no mesmo dia da outra lesão do 50');
  const k = ok(api(s, 'evento.corrigir', corr, 'k', ['POSSIVEL_DUPLICIDADE']));
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: k.event_id }).map((l) => l.animal_id), [ids['50']]);
  assert.ok(tab(s, 'FINANCEIRO', { event_id: r.event_id }).every((x) => x.status === 'CANCELADO'));
  ok(api(s, 'evento.estornar', { event_id: k.event_id, justificativa: 'Engano' }, 'e-k'));
  semErro(s, 'ocorrência');
  // Importação e desfazer: a ocorrência num animal importado impede desfazer; estornada, passa.
  const s2 = S.sistema({ config: { importacao_lote_linhas: '5' } });
  s2.gas.clock.now = Date.parse('2026-06-01T15:00:00.000Z');
  const { G } = s2;
  const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
  const csv = 'Brinco;Sexo;Nasc.;Pasto\n1401;F;01/12/2025;Pasto A\n1402;F;01/01/2021;Pasto B';
  const c = s2.exec((ctx) => G.ImportService.criar(ctx, { idempotencyKey: 'imp-criar', dados: { tipo: 'ANIMAIS', arquivo_nome: 'rebanho.csv', conteudo_base64: Buffer.from(csv, 'utf8').toString('base64'), formato: FORMATO } })).dados;
  const mapa = { colunas: { Brinco: 'brinco', Sexo: 'sexo', 'Nasc.': 'data_nascimento', Pasto: 'pasto' }, confiancas: { data_nascimento: 'ESTIMADA' }, padroes: {} };
  let est;
  for (let b = 1; b < 10 && (!est || est.importacao.status !== 'VALIDADO'); b++) est = s2.exec((ctx) => G.ImportService.validarBloco(ctx, { idempotencyKey: 'imp-val-' + b, dados: { import_id: c.import_id, bloco: b, mapeamento: mapa } })).dados;
  s2.exec((ctx) => G.ImportService.importarBloco(ctx, { dados: { import_id: c.import_id, bloco: 1, modo: 'TOTAL' } }));
  s2.exec((ctx) => G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } }));
  const bez = s2.tabela('ANIMAIS').find((x) => x.brinco === '1401').animal_id;
  const oc = ok(api(s2, 'evento.registrar', ocorrencia('2026-03-01', [bez]), 'oc-imp'));
  const dz = ok(api(s2, 'evento.registrar', desmama('2026-05-01', [bez]), 'dz-imp'), 'a bezerra importada com 1 mês na entrada é cria');
  let u = s2.tentar((ctx) => G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id, justificativa: 'Arquivo errado' } }));
  assert.equal(u.erro.code, 'CONFLICT');
  assert.deepEqual(u.erro.details.map((d) => d.conflito.event_id).sort(), [oc.event_id, dz.event_id].sort());
  ok(api(s2, 'evento.estornar', { event_id: oc.event_id, justificativa: 'x' }, 'e-oc'));
  ok(api(s2, 'evento.estornar', { event_id: dz.event_id, justificativa: 'x' }, 'e-dz'));
  u = s2.tentar((ctx) => G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id, justificativa: 'Arquivo errado' } }));
  assert.equal(u.ok, true, JSON.stringify(u.erro));
  semErro(s2, 'importação desfeita');
});
