'use strict';
/**
 * Revisão da Fase 3 (conserto), achados do motor, do custo e da integridade, cada um por caminho: o custo congelado da
 * aplicação na correção (o custo unitário, a conta e a próxima aplicação pelo protocolo como estavam), a entrada de estoque
 * corrigida com a quantidade por embalagem congelada e o movimento pelo que o original gravou, o produto do cadastro pago no
 * ato (o mesmo dinheiro duas vezes no resultado), a cópia do peso das pesagens de entrada, compra, venda e parto conferida
 * pela integridade, a quarentena da fonte quebrada no saldo do insumo e a duração da gestação mudada depois do diagnóstico.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js, PASTOS } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

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
const cods = (e) => e.details.map((d) => d.codigo);
function san(subtipo, data, ids, campos) {
  return { tipo: 'SANIDADE', subtipo, campos: Object.assign({ event_date: data }, campos || {}), animais: ids.map((x) => (typeof x === 'string' ? { animal_id: x } : x)) };
}
function estoque(subtipo, data, campos) {
  return { tipo: 'ESTOQUE', subtipo, campos: Object.assign({ event_date: data }, campos || {}) };
}
function rebanho(s, brincos, extra) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(brincos.map((b) => S.bicho(Object.assign({ brinco: b, sexo: 'F', data_nascimento: '2023-08-01', data_nascimento_confianca: 'CONFIRMADA' }, extra || {})))), 'rebanho-' + brincos.join('-')), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}
function produto(s, campos) {
  return ok(api(s, 'produto.salvar', { campos: Object.assign({ nome: 'Vacina X', categoria: 'VACINA', unidade: 'dose', controla_estoque: true }, campos || {}) }), 'produto');
}
const tab = (s, aba, filtro) => s.tabela(aba).filter((r) => Object.keys(filtro || {}).every((k) => r[k] === filtro[k]));
const vigentes = (s, aba, filtro) => {
  const evs = Object.fromEntries(s.tabela('EVENTOS').map((e) => [e.event_id, e]));
  return tab(s, aba, filtro).filter((r) => { const e = evs[r.event_id]; return !e || e.status === 'CONFIRMADO'; });
};
const conta = (s, id) => s.tabela('PLANO_CONTAS').find((c) => c.conta_id === id).codigo;
const saldo = (s, pid) => s.tabela('PRODUTOS').find((p) => p.product_id === pid).estoque_atual;
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}
/** O efeito de uma aplicação: o consumo (valor, conta, quantidade), a saída (quantidade, custo) e cada animal (custo, próxima). */
function efeito(s, eid) {
  return {
    fin: tab(s, 'FINANCEIRO', { event_id: eid }).map((f) => [f.valor, conta(s, f.conta_id), f.quantidade || null, f.status_pagamento]),
    mov: tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: eid }).map((m) => [m.tipo, m.quantidade, m.custo_unitario]),
    san: tab(s, 'SANIDADE', { event_id: eid }).map((x) => [x.custo, x.data_proxima_aplicacao]).sort(),
  };
}

test('achados 3 e 6: corrigir a aplicação depois de mudar o cadastro não reprecifica o fato — o custo unitário da saída, a conta do consumo e a próxima aplicação pelo protocolo ficam como estavam (correção, correção do substituto, estorno da correção); trocar a quantidade usa o custo congelado; trocar o produto usa o do produto novo', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['101', '102']);
  const p = produto(s, { custo_unitario: 3, controla_estoque: false });
  const prot = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Aftosa semestral', tipo_procedimento: 'VACINA', product_id: p.product_id, sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180 } }), 'protocolo');
  const campos = { produto_id: p.product_id, protocol_id: prot.protocol_id, modo_dose: 'POR_CABECA', dose_referencia: 1, veterinario: 'Dr. A' };
  const animais = [ids['101'], ids['102']];
  const r = ok(api(s, 'evento.registrar', san('VACINACAO', '2026-03-10', animais, campos)), 'vacina');
  const antes = efeito(s, r.event_id);
  assert.deepEqual(antes, { fin: [[600, 'VACINAS', 2, 'SEM_CAIXA']], mov: [['SAIDA', 2, 3]], san: [[300, '2026-09-06'], [300, '2026-09-06']] });
  // O cadastro muda depois: custo de uma compra nova, a categoria do produto e o intervalo do protocolo.
  ok(api(s, 'produto.salvar', { product_id: p.product_id, campos: { custo_unitario: 5, categoria: 'MEDICAMENTO' }, justificativa: 'compra nova' }), 'custo novo');
  ok(api(s, 'protocolo.salvar', { protocol_id: prot.protocol_id, campos: { intervalo_dias: 365 }, justificativa: 'anual' }), 'intervalo novo');
  // A simulação e a gravação da correção só do veterinário mostram o mesmo efeito do original.
  const pedido = (eid, extra) => Object.assign({ event_id: eid, justificativa: 'nome do veterinário' }, san('VACINACAO', '2026-03-10', animais, Object.assign({}, campos, { veterinario: 'Dr. B' }, extra || {})));
  const sim = ok(api(s, 'evento.simular', { acao: 'corrigir', dados: pedido(r.event_id) }), 'simulação');
  assert.deepEqual([sim.impactos.sanidade.consumo, sim.impactos.sanidade.proxima_aplicacao], [{ custo_unitario: 3, valor: 600 }, '2026-09-06']);
  const c1 = ok(api(s, 'evento.corrigir', pedido(r.event_id)), 'correção');
  assert.deepEqual(efeito(s, c1.event_id), antes, 'correção: o mesmo custo, a mesma conta e a mesma próxima');
  // A correção do substituto também.
  const c2 = ok(api(s, 'evento.corrigir', pedido(c1.event_id, { veterinario: 'Dr. C' })), 'correção do substituto');
  assert.deepEqual(efeito(s, c2.event_id), antes, 'correção do substituto');
  // Mudar a quantidade: o custo unitário congelado vezes a quantidade nova.
  const c3 = ok(api(s, 'evento.corrigir', pedido(c2.event_id, { dose_referencia: 2 })), 'correção da dose');
  assert.deepEqual(efeito(s, c3.event_id).fin, [[1200, 'VACINAS', 4, 'SEM_CAIXA']]);
  assert.deepEqual(efeito(s, c3.event_id).mov, [['SAIDA', 4, 3]]);
  // A próxima informada continua valendo quando digitada.
  const c4 = ok(api(s, 'evento.corrigir', pedido(c3.event_id, { data_proxima_aplicacao: '2026-10-01' })), 'próxima informada');
  assert.deepEqual(efeito(s, c4.event_id).san.map((x) => x[1]), ['2026-10-01', '2026-10-01']);
  // Trocar o produto: o custo e a conta são os do produto novo, de hoje.
  const q = produto(s, { nome: 'Vacina Y', custo_unitario: 2, controla_estoque: false });
  const c5 = ok(api(s, 'evento.corrigir', pedido(c4.event_id, { produto_id: q.product_id, protocol_id: null })), 'troca de produto');
  assert.deepEqual(efeito(s, c5.event_id).fin, [[400, 'VACINAS', 2, 'SEM_CAIXA']]);
  assert.deepEqual(efeito(s, c5.event_id).mov, [['SAIDA', 2, 2]]);
  semErro(s, 'custo congelado');
  // O estorno da correção some com a aplicação por inteiro (o original não volta): nada de consumo vigente.
  ok(api(s, 'evento.estornar', { event_id: c5.event_id, justificativa: 'lançada errada' }), 'estorno da correção');
  assert.deepEqual(vigentes(s, 'FINANCEIRO').filter((f) => f.product_id).map((f) => f.status), []);
  semErro(s, 'estorno da correção');
});

test('achado 7: corrigir a entrada de estoque só na nota não muda a quantidade (a quantidade por embalagem congelada) nem apaga a entrada do saldo quando o controle foi desligado e religado depois; a correção do substituto e o estorno da correção mantêm o saldo', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['101', '102']);
  const p = produto(s, { custo_unitario: 3, fator_conversao: 50, apresentacao: 'frasco de 50 doses' });
  const pid = p.product_id;
  const ent = ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { product_id: pid, qtd_apresentacao: 2, valor: 30000, documento: 'NF 1' })), 'entrada');
  assert.equal(saldo(s, pid), 100);
  ok(api(s, 'produto.salvar', { product_id: pid, campos: { fator_conversao: 25, apresentacao: 'frasco de 25 doses' }, justificativa: 'embalagem nova' }), 'fator novo');
  const corr = (eid, extra) => Object.assign({ event_id: eid, justificativa: 'número da nota' }, estoque('ENTRADA', '2026-03-01', Object.assign({ product_id: pid, qtd_apresentacao: 2, valor: 30000, documento: 'NF 2' }, extra || {})));
  const c1 = ok(api(s, 'evento.corrigir', corr(ent.event_id)), 'corrige a nota');
  assert.equal(saldo(s, pid), 100, 'a quantidade comprada não muda');
  assert.deepEqual(vigentes(s, 'FINANCEIRO', { event_id: c1.event_id }).map((f) => f.quantidade), [100]);
  assert.deepEqual(s.tabela('EVENTOS').find((e) => e.event_id === c1.event_id).payload_json, { qtd_apresentacao: 2, fator_conversao: 50, justificativa: 'número da nota' });
  ok(api(s, 'evento.registrar', san('VACINACAO', '2026-03-10', [ids['101'], ids['102']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 1 })), 'vacina');
  assert.equal(saldo(s, pid), 98);
  ok(api(s, 'produto.salvar', { product_id: pid, campos: { controla_estoque: false }, justificativa: 'desliga' }), 'desliga');
  const c2 = ok(api(s, 'evento.corrigir', corr(c1.event_id, { documento: 'NF 3' })), 'correção do substituto com o controle desligado');
  assert.deepEqual(vigentes(s, 'MOVIMENTOS_ESTOQUE', { event_id: c2.event_id }).map((m) => [m.tipo, m.quantidade]), [['ENTRADA', 100]], 'o original tinha a entrada: o substituto também');
  ok(api(s, 'produto.salvar', { product_id: pid, campos: { controla_estoque: true }, justificativa: 'religa' }), 'religa');
  assert.equal(saldo(s, pid), 98, 'religado, o saldo tem a entrada');
  // Embalagens mudadas na correção: a quantidade por embalagem da compra (a do original).
  const c3 = ok(api(s, 'evento.corrigir', corr(c2.event_id, { qtd_apresentacao: 4 })), 'embalagens mudadas');
  assert.deepEqual(vigentes(s, 'FINANCEIRO', { event_id: c3.event_id }).map((f) => f.quantidade), [200], '4 × 50 do original');
  assert.equal(saldo(s, pid), 198);
  semErro(s, 'entrada corrigida');
  // O estorno da correção some com a entrada (o original não volta): o saldo fica só com a saída, com o aviso aceito.
  const e = recusa(api(s, 'evento.estornar', { event_id: c3.event_id, justificativa: 'nota errada' }), 'NEEDS_CONFIRMATION', 'estorno da correção');
  assert.deepEqual(cods(e), ['ESTOQUE_INSUFICIENTE']);
  ok(api(s, 'evento.estornar', { event_id: c3.event_id, justificativa: 'nota errada' }, null, ['ESTOQUE_INSUFICIENTE']), 'estorno aceito');
  assert.equal(saldo(s, pid), -2);
  semErro(s, 'estorno da correção');
});

test('achado 4: o produto do cadastro com custo unitário pago no ato numa conta de insumo é recusado (o consumo já é o custo dele), no registro, na simulação e na correção; o serviço do veterinário, o produto sem custo e o nome livre continuam; a ajuda do campo diz o caminho', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['101', '102', '103', '104']);
  const p = produto(s, { custo_unitario: 1.8, controla_estoque: false });
  const contas = Object.fromEntries(s.tabela('PLANO_CONTAS').map((c) => [c.codigo, c.conta_id]));
  const animais = [ids['101'], ids['102'], ids['103'], ids['104']];
  const base = { produto_id: p.product_id, modo_dose: 'TOTAL', quantidade_consumida_total: 50, custo_valor: 9000 };
  const e1 = recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-03-10', animais, Object.assign({}, base, { custo_conta_id: contas.VACINAS }))), 'VALIDATION', 'conta de vacinas');
  assert.deepEqual(cods(e1), ['CUSTO_EM_DOBRO']);
  assert.equal(e1.details[0].campo, 'custo_conta_id');
  assert.match(e1.details[0].mensagem, /Vacina X.*já entra no custo pelo consumo.*entrada no estoque/);
  const sim = recusa(api(s, 'evento.simular', { acao: 'registrar', dados: san('VACINACAO', '2026-03-10', animais, Object.assign({}, base, { custo_conta_id: contas.MEDICAMENTOS })) }), 'VALIDATION', 'simulação');
  assert.deepEqual(cods(sim), ['CUSTO_EM_DOBRO']);
  assert.equal(tab(s, 'FINANCEIRO').length, 0, 'nada gravado');
  // O serviço do veterinário (outra conta) continua: os dois lançamentos são dinheiros diferentes.
  const r = ok(api(s, 'evento.registrar', san('VACINACAO', '2026-03-10', animais, Object.assign({}, base, { custo_conta_id: contas.SERVICOS_VETERINARIOS, custo_valor: 4000 }))), 'serviço');
  assert.deepEqual(tab(s, 'FINANCEIRO', { event_id: r.event_id }).map((f) => [f.valor, conta(s, f.conta_id)]).sort(), [[4000, 'SERVICOS_VETERINARIOS'], [9000, 'VACINAS']]);
  // A correção que passa o serviço para a conta de vacinas também é recusada.
  const ec = recusa(api(s, 'evento.corrigir', Object.assign({ event_id: r.event_id, justificativa: 'conta' }, san('VACINACAO', '2026-03-10', animais, Object.assign({}, base, { custo_conta_id: contas.VACINAS })))), 'VALIDATION', 'correção');
  assert.deepEqual(cods(ec), ['CUSTO_EM_DOBRO']);
  // Produto sem custo unitário (não gera consumo) e nome livre: o pago no ato é o único custo (07, seção 5, caso 3).
  const semCusto = produto(s, { nome: 'Vacina Z', controla_estoque: false });
  ok(api(s, 'evento.registrar', san('VACINACAO', '2026-04-10', animais, { produto_id: semCusto.product_id, modo_dose: 'TOTAL', quantidade_consumida_total: 50, custo_valor: 9000, custo_conta_id: contas.VACINAS })), 'sem custo unitário');
  ok(api(s, 'evento.registrar', san('VACINACAO', '2026-05-10', animais, { nome_produto: 'Vacina da loja', modo_dose: 'POR_CABECA', dose_referencia: 1, unidade_dose: 'dose', custo_valor: 9000, custo_conta_id: contas.VACINAS })), 'nome livre');
  // A ajuda do campo no catálogo não manda mais lançar ali o produto do cadastro.
  const cat = js(s.gas.exec(() => s.G.EventCatalog.camposEvento('SANIDADE', 'VACINACAO')));
  const ajuda = cat.find((c) => c.id === 'custo_valor').ajuda;
  assert.doesNotMatch(ajuda, /produto comprado na hora e não lançado no estoque/);
  assert.match(ajuda, /entrada no estoque/);
  semErro(s, 'pago no ato');
});

test('achado 8: a integridade confere a cópia do peso das pesagens de entrada, compra, venda e parto (COPIAS, sem reparo): o peso mexido à mão e a pesagem apagada com o peso na linha do animal são acusados; a trava recusa lançar para o animal', () => {
  const s = S.sistema();
  const r = ok(api(s, 'evento.registrar', S.entradaInicial([
    S.bicho({ brinco: '1', sexo: 'M', castrado: true, data_nascimento: '2025-01-01', data_nascimento_confianca: 'CONFIRMADA', peso: 300, metodo_pesagem: 'BALANCA' }),
    S.bicho({ brinco: '2', sexo: 'M', castrado: true, data_nascimento: '2025-01-01', data_nascimento_confianca: 'CONFIRMADA', peso: 310, metodo_pesagem: 'BALANCA' }),
  ])), 'rebanho');
  const [a1, a2] = r.animais.map((a) => a.animal_id);
  semErro(s, 'antes');
  const p1 = tab(s, 'PESAGENS', { animal_id: a1 })[0];
  s.editar('PESAGENS', p1.weight_id, 'peso_kg', 30);
  let rel = s.integridade();
  const copia = rel.achados.filter((a) => a.checagem === 'COPIAS');
  assert.equal(copia.length, 1, JSON.stringify(rel.achados));
  assert.match(copia[0].mensagem, /a pesagem tem 30 kg, mas a linha do animal no lançamento diz 300 kg/);
  assert.deepEqual([rel.reparavel, typeof rel.reparo_impedido], [false, 'string']);
  // A trava recusa lançar para o animal da pesagem mexida (a fonte quebrada).
  const e = recusa(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-03-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: a1, peso: 320 }] }, null, ['PESO_IMPLAUSIVEL']), 'CONFLICT', 'pesagem do animal mexido');
  assert.ok(cods(e).indexOf('INTEGRIDADE_COPIAS') >= 0);
  s.editar('PESAGENS', p1.weight_id, 'peso_kg', 300);
  // A pesagem apagada com o peso na linha do animal.
  const p2 = tab(s, 'PESAGENS', { animal_id: a2 })[0];
  s.apagarLinha('PESAGENS', p2.weight_id);
  rel = s.integridade();
  assert.ok(rel.achados.some((a) => a.checagem === 'COPIAS' && /tem o peso de 310 kg, mas o lançamento não tem a pesagem dele/.test(a.mensagem)), JSON.stringify(rel.achados));
});

test('achado 8 (compra, venda e parto): a pesagem copiada de cada um desses lançamentos é conferida pelo peso da linha do animal', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['500'], { data_nascimento: '2020-01-01', situacao_reprodutiva: 'PRENHA' });
  const parc = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Fazenda Vizinha', tipos: ['FORNECEDOR', 'COMPRADOR'] } }), 'parceiro').partner_id;
  const cmp = ok(api(s, 'evento.registrar', { tipo: 'COMPRA', campos: { event_date: '2026-02-01', partner_id: parc, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 300000 }, parcelas: [{ data_vencimento: '2026-02-01' }], animais: [{ brinco: '600', sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14, peso: 250 }] }), 'compra');
  const boi = cmp.animais[0].animal_id;
  const nas = ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-03-01' }, animais: [{ animal_id: ids['500'] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '700', peso: 32, metodo_pesagem: 'BALANCA' }] }), 'parto');
  const vd = ok(api(s, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-04-01', partner_id: parc, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 400000, valor_bruto: 400000 }, animais: [{ animal_id: boi, peso: 280 }], parcelas: [{ data_vencimento: '2026-04-01' }] }), 'venda');
  semErro(s, 'antes');
  [[cmp.event_id, 9], [nas.event_id, 3], [vd.event_id, 8]].forEach(([eid, kg]) => {
    const p = tab(s, 'PESAGENS', { event_id: eid })[0];
    assert.ok(p, 'pesagem de ' + eid);
    const antes = p.peso_kg;
    s.editar('PESAGENS', p.weight_id, 'peso_kg', kg);
    const rel = s.integridade();
    assert.ok(rel.achados.some((a) => a.checagem === 'COPIAS' && a.id === p.weight_id), eid + ': ' + JSON.stringify(rel.achados.map((a) => a.mensagem)));
    assert.equal(rel.reparavel, false);
    s.editar('PESAGENS', p.weight_id, 'peso_kg', antes);
  });
  semErro(s, 'depois');
});

test('achado 13: a saída de estoque apagada à mão põe o saldo do produto em quarentena — o lançamento comum que movimenta o produto é recusado (registro e importação), o saldo gravado não é regravado a partir da fonte quebrada', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['101', '102', '103']);
  const p = produto(s, { nome: 'Vacina P', custo_unitario: 1 });
  const pid = p.product_id;
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-02-01', { product_id: pid, quantidade: 100, valor: 10000 })), 'entrada');
  const v = ok(api(s, 'evento.registrar', san('VACINACAO', '2026-03-10', [ids['101'], ids['102']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 5 })), 'vacina');
  assert.equal(saldo(s, pid), 90);
  s.apagarLinha('MOVIMENTOS_ESTOQUE', tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: v.event_id })[0].mov_id);
  let rel = s.integridade();
  assert.ok(rel.achados.some((a) => a.checagem === 'COPIAS'));
  assert.equal(rel.reparavel, false);
  // A entrada comum do mesmo produto regravaria o saldo a partir da saída apagada: recusada.
  const e = recusa(api(s, 'evento.registrar', estoque('ENTRADA', '2026-04-01', { product_id: pid, quantidade: 5, valor: 500 })), 'CONFLICT', 'entrada comum');
  assert.ok(cods(e).indexOf('INTEGRIDADE_COPIAS') >= 0, JSON.stringify(e.details));
  assert.match(e.message + ' ' + e.details.map((d) => d.mensagem).join(' '), /Restaure o backup|mexidos à mão/);
  // A aplicação do produto noutro animal também.
  recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-04-10', [ids['103']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 1 })), 'CONFLICT', 'aplicação');
  assert.equal(saldo(s, pid), 90, 'o saldo gravado não muda');
  rel = s.integridade();
  assert.ok(rel.achados.some((a) => a.checagem === 'PROJECAO' && a.tabela === 'PRODUTOS'), 'o saldo continua acusado');
  // A importação de uma aplicação do produto: a linha fica com o motivo da trava, nada entra.
  const csv = ['Data;Procedimento;Produto do cadastro;Como foi a dose;Dose do lançamento (por cabeça ou por kg);Brinco', '15/04/2026;vacinação;Vacina P;por cabeça;1;103'].join('\n');
  const c = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'criar-san', dados: { tipo: 'SANIDADE', arquivo_nome: 's.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
  const mapa = { colunas: c.sugestao, confiancas: {}, padroes: {} };
  let est;
  for (let b = 1; b < 10; b++) {
    est = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + b, dados: { import_id: c.import_id, bloco: b, mapeamento: mapa } })).dados;
    if (est.importacao.status === 'VALIDADO') break;
  }
  const linhas = s.read(s.G.ImportService.consultaLinhas({ import_id: c.import_id, por_pagina: 50 })).itens;
  assert.equal(linhas[0].status, 'ERRO', JSON.stringify(linhas));
  assert.ok(JSON.stringify(linhas[0].erros).indexOf('INTEGRIDADE_COPIAS') >= 0, JSON.stringify(linhas[0].erros));
  assert.equal(saldo(s, pid), 90);
});

/** Importa (cria, valida, grava o bloco) uma aplicação da Vacina P no animal 103; conclui só se pedido. */
function importarAplicacao(s, concluir) {
  const csv = ['Data;Procedimento;Produto do cadastro;Como foi a dose;Dose do lançamento (por cabeça ou por kg);Brinco', '15/03/2026;vacinação;Vacina P;por cabeça;1;103'].join('\n');
  const c = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'criar-imp', dados: { tipo: 'SANIDADE', arquivo_nome: 's.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
  const mapa = { colunas: c.sugestao, confiancas: {}, padroes: {} };
  for (let b = 1; b < 10; b++) {
    const est = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-imp-' + b, dados: { import_id: c.import_id, bloco: b, mapeamento: mapa } })).dados;
    if (est.importacao.status === 'VALIDADO') break;
  }
  const ib = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: c.import_id, bloco: 1, modo: 'TOTAL' } }));
  assert.ok(ib.ok, JSON.stringify(ib.erro));
  if (concluir) s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } }));
  return c.import_id;
}

test('achado 13 (conclusão e desfazer da importação): o que só alcança o saldo do insumo pela reconstrução segue, mas não regrava o saldo a partir da saída apagada à mão — o saldo fica como estava e a verificação continua acusando', () => {
  // O desfazer: a importação concluída de uma aplicação do produto; depois a saída de outra aplicação apagada à mão.
  let s = S.sistema();
  let ids = rebanho(s, ['101', '102', '103']);
  let pid = produto(s, { nome: 'Vacina P', custo_unitario: 1 }).product_id;
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-02-01', { product_id: pid, quantidade: 100, valor: 10000 })), 'entrada');
  const imp = importarAplicacao(s, true);
  assert.equal(saldo(s, pid), 99);
  let v = ok(api(s, 'evento.registrar', san('VACINACAO', '2026-04-10', [ids['101'], ids['102']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 5 })), 'vacina');
  assert.equal(saldo(s, pid), 89);
  s.apagarLinha('MOVIMENTOS_ESTOQUE', tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: v.event_id })[0].mov_id);
  const d = s.tentar((ctx) => s.G.ImportService.desfazer(ctx, { avisosAceitos: [], dados: { import_id: imp, justificativa: 'Arquivo errado' } }));
  assert.ok(d.ok, JSON.stringify(d.erro));
  assert.equal(saldo(s, pid), 89, 'a reconstrução daria 100 a partir da saída apagada: o saldo fica em quarentena');
  assert.ok(s.integridade().achados.some((a) => a.checagem === 'PROJECAO' && a.tabela === 'PRODUTOS'), 'o saldo continua acusado');
  // A conclusão: a aplicação lançada antes, a importação gravada em bloco, a saída apagada à mão e então a conclusão.
  s = S.sistema();
  ids = rebanho(s, ['101', '102', '103']);
  pid = produto(s, { nome: 'Vacina P', custo_unitario: 1 }).product_id;
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-02-01', { product_id: pid, quantidade: 100, valor: 10000 })), 'entrada');
  v = ok(api(s, 'evento.registrar', san('VACINACAO', '2026-04-10', [ids['101'], ids['102']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 5 })), 'vacina');
  const imp2 = importarAplicacao(s, false);
  assert.equal(saldo(s, pid), 90);
  s.apagarLinha('MOVIMENTOS_ESTOQUE', tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: v.event_id })[0].mov_id);
  const c = s.tentar((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: imp2 } }));
  assert.ok(c.ok, JSON.stringify(c.erro));
  assert.equal(saldo(s, pid), 90, 'a reconstrução daria 99 a partir da saída apagada: o saldo fica em quarentena');
  assert.ok(s.integridade().achados.some((a) => a.checagem === 'PROJECAO' && a.tabela === 'PRODUTOS'));
});

test('achado 14: mudar a duração da gestação depois do diagnóstico não transforma o registro legítimo em fonte quebrada — a verificação fica limpa, a pesagem e a morte da vaca passam; a correção que mantém a idade do original é aceita; o diagnóstico novo acima do parâmetro é recusado pelo motor', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['101', '102'], { data_nascimento: '2020-01-01' });
  const est = ok(api(s, 'estacao.salvar', { campos: { nome: 'E26', data_inicio: '2026-01-10', data_fim: '2026-04-10', tipo: 'MONTA_NATURAL' } }), 'estação');
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-01-10', estacao_id: est.estacao_id }, animais: [{ animal_id: ids['101'] }, { animal_id: ids['102'] }] }), 'exposição');
  const dg = ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-09-10', estacao_id: est.estacao_id }, animais: [{ animal_id: ids['101'], resultado: 'POSITIVO', idade_gestacional_dias: 200 }] }), 'diagnóstico');
  ok(api(s, 'config.salvar', { valores: { dias_gestacao: 185 }, justificativa: 'raça' }), 'dias de gestação');
  semErro(s, 'o diagnóstico antigo não é fonte quebrada');
  ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-10-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids['101'], peso: 450 }] }), 'pesagem');
  // A correção que só muda o responsável mantém a idade do original.
  ok(api(s, 'evento.corrigir', { event_id: dg.event_id, justificativa: 'responsável', tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-09-10', estacao_id: est.estacao_id, metodo: 'ULTRASSOM' }, animais: [{ animal_id: ids['101'], resultado: 'POSITIVO', idade_gestacional_dias: 200 }] }), 'correção');
  // O diagnóstico novo acima do parâmetro: a regra do motor, com a mensagem dele.
  const e = recusa(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-09-11', estacao_id: est.estacao_id }, animais: [{ animal_id: ids['102'], resultado: 'POSITIVO', idade_gestacional_dias: 200 }] }), 'VALIDATION', 'novo acima');
  assert.deepEqual(cods(e), ['VALOR_FORA_DA_FAIXA']);
  ok(api(s, 'evento.registrar', { tipo: 'MORTE', campos: { event_date: '2026-10-05', causa: 'DOENCA' }, animais: [{ animal_id: ids['101'] }] }), 'morte');
  semErro(s, 'depois');
});
