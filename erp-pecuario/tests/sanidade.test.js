'use strict';
/**
 * SANIDADE (Fase 3, E3.3; 04, seção 4.5; 03b, seções 6, 15.2 e 16.4; 05, seção 2.8, RN-054 a RN-059 e RN-072; 07,
 * seções 5 e 8.4), por caminho: registro individual e coletivo nos seis subtipos, com produto do cadastro ou em texto
 * livre; a dose por cabeça, por peso (o peso atual com a regra de validade) e só pelo total; o consumo e o custo no
 * momento da aplicação (o lançamento CUSTEIO sem parcela rateado aos animais tratados, o serviço pago no ato com
 * parcelas); o retroativo, o mesmo dia, a correção, a correção do substituto, o estorno com e sem dependente, o estorno da
 * correção, a importação e o desfazer; a carência na venda, inclusive o abate antes do fim dela pelo registro real e pela
 * aplicação retroativa; a verificação de integridade (COPIAS e PROJECAO) e a trava única que a usa. 03b, seção 15.2,
 * refeito linha a linha, centavo a centavo, e o CT-06 de 09 inteiro.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js, PASTOS } = S;

function api(s, rota, dados, chave, avisos, extra) {
  return js(s.gas.exec(() => s.G.api(Object.assign({ rota, dados: dados || {}, idempotencyKey: chave, avisosAceitos: avisos || [] }, extra || {}))));
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
const cods = (e) => e.details.map((d) => d.codigo);
function san(subtipo, data, ids, campos) {
  return { tipo: 'SANIDADE', subtipo, campos: Object.assign({ event_date: data }, campos || {}), animais: ids.map((x) => (typeof x === 'string' ? { animal_id: x } : x)) };
}
function estoque(subtipo, data, campos) {
  return { tipo: 'ESTOQUE', subtipo, campos: Object.assign({ event_date: data }, campos || {}) };
}
/** Rebanho inicial (D0 = 01/01/2026, Pasto A) com os brincos pedidos: bezerras de 2025, salvo o extra. */
function rebanho(s, brincos, extra) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(brincos.map((b) => S.bicho(Object.assign({ brinco: b, sexo: 'F', data_nascimento: '2025-08-01', data_nascimento_confianca: 'CONFIRMADA' }, extra || {})))), 'rebanho-' + brincos.join('-')), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}
function produto(s, campos, chave) {
  return ok(api(s, 'produto.salvar', { campos: Object.assign({ nome: 'Vacina X', categoria: 'VACINA', unidade: 'dose', controla_estoque: true }, campos || {}) }, chave || 'prod-' + Math.random()), 'produto');
}
const tab = (s, aba, filtro) => s.tabela(aba).filter((r) => Object.keys(filtro || {}).every((k) => r[k] === filtro[k]));
const prod = (s, id) => s.tabela('PRODUTOS').find((p) => p.product_id === id);
const conta = (s, codigo) => s.tabela('PLANO_CONTAS').find((c) => c.codigo === codigo);
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}
const contar = (s) => Object.fromEntries(s.G.Schema.nomesTabelas().map((t) => [t, s.tabela(t).length]));

test('03b, seção 15.2, linha a linha: vacinação coletiva de 4 bezerros com 5 doses do estoque — R$ 9,25 de consumo sem parcela, 2,32 + 2,31 + 2,31 + 2,31 pelo maior resto, 17 linhas em 8 abas, o saldo cai 5 doses; com o veterinário pago no ato, 22,32 por animal; o estorno não grava linha inversa', () => {
  const s = S.sistema();
  s.gas.clock.now = Date.parse('2027-05-20T15:00:00.000Z');
  const ids = rebanho(s, ['101', '102', '103', '104']);
  const bez = ['101', '102', '103', '104'].map((b) => ids[b]);
  const p = produto(s, { nome: 'Vacina X', fabricante: 'Lab Boi', custo_unitario: 1.85, carencia_padrao_dias: 21 }, 'prod-7');
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2027-05-01', { product_id: p.product_id, quantidade: 50, valor: 9250 }), 'entrada-50'));
  assert.equal(prod(s, p.product_id).estoque_atual, 50);
  const antes = contar(s);
  const campos = { produto_id: p.product_id, lote: 'L2291', validade: '2028-02-28', modo_dose: 'POR_CABECA', dose_referencia: 1, quantidade_consumida_total: 5, via_aplicacao: 'SUBCUTANEA', periodo_carencia_dias: 21, data_proxima_aplicacao: '2027-11-10', responsible: 'José (vaqueiro)' };
  // A prévia (SIMULAR) é o mesmo tratador: o servidor faz as contas que a revisão mostra.
  const sim = ok(api(s, 'evento.simular', { acao: 'registrar', dados: san('VACINACAO', '2027-05-10', bez, campos) }));
  assert.deepEqual([sim.impactos.sanidade.quantidade, sim.impactos.sanidade.consumo, sim.impactos.sanidade.estoque, sim.impactos.sanidade.fim_carencia, sim.impactos.total_value],
    [5, { custo_unitario: 1.85, valor: 925 }, { antes: 50, depois: 45 }, '2027-05-31', 925]);
  assert.deepEqual(sim.impactos.sanidade.animais.map((a) => a.custo), [232, 231, 231, 231], 'o centavo que sobra vai para o menor código interno');
  const r = ok(api(s, 'evento.registrar', san('VACINACAO', '2027-05-10', bez, campos), 'ev-2'));
  const depois = contar(s);
  const novas = Object.fromEntries(Object.keys(depois).filter((t) => depois[t] !== antes[t]).map((t) => [t, depois[t] - antes[t]]));
  assert.deepEqual(novas, { OPERACOES: 1, EVENTOS: 1, EVENTO_ANIMAIS: 4, SANIDADE: 4, MOVIMENTOS_ESTOQUE: 1, FINANCEIRO: 1, RATEIOS: 1, ALOCACOES_FINANCEIRAS: 4 }, '17 linhas em 8 abas (nenhuma em PARCELAS)');
  // EVENTOS.
  const ev = s.tabela('EVENTOS').find((e) => e.event_id === r.event_id);
  assert.deepEqual([ev.event_type, ev.event_subtype, ev.event_date, ev.registration_date, ev.property_id, ev.total_value, ev.responsible, ev.source, ev.confiabilidade, ev.pre_marco_zero],
    ['SANIDADE', 'VACINACAO', '2027-05-10', '2027-05-20', S.PROP, 925, 'José (vaqueiro)', 'APP', 'CONFIRMADA', false]);
  assert.deepEqual(ev.payload_json, { modo_dose: 'POR_CABECA', dose_referencia: 1, quantidade_consumida_total: 5 });
  assert.deepEqual([ev.description, ev.partner_id, ev.notes, ev.reversal_of_event_id, ev.import_id].map((v) => v || null), [null, null, null, null, null]);
  // EVENTO_ANIMAIS: SUJEITO, efeito 0, nada mais (vacinar não move nem pesa).
  tab(s, 'EVENTO_ANIMAIS', { event_id: r.event_id }).forEach((l) => assert.deepEqual([l.papel, l.efeito_inventario, l.pasto_origem_id, l.pasto_destino_id, l.peso, l.valor_individual].map((v) => (v === '' ? null : v)), ['SUJEITO', 0, null, null, null, null]));
  // SANIDADE: as quatro linhas.
  const linhas = bez.map((id) => tab(s, 'SANIDADE', { event_id: r.event_id, animal_id: id })[0]);
  assert.deepEqual(linhas.map((x) => [x.dose, x.unidade_dose, x.periodo_carencia_dias, x.data_fim_carencia, x.custo]), [[1, 'dose', 21, '2027-05-31', 232], [1, 'dose', 21, '2027-05-31', 231], [1, 'dose', 21, '2027-05-31', 231], [1, 'dose', 21, '2027-05-31', 231]]);
  linhas.forEach((x) => {
    assert.deepEqual([x.tipo_procedimento, x.produto_id, x.nome_produto, x.fabricante, x.lote, x.validade, x.via_aplicacao, x.data_aplicacao, x.data_proxima_aplicacao], ['VACINA', p.product_id, 'Vacina X', 'Lab Boi', 'L2291', '2028-02-28', 'SUBCUTANEA', '2027-05-10', '2027-11-10']);
    assert.deepEqual([x.protocol_id, x.motivo, x.diagnostico, x.resultado_exame, x.veterinario, x.observacoes].map((v) => v || null), [null, null, null, null, null, null]);
  });
  // MOVIMENTOS_ESTOQUE: uma SAIDA de 5 com o custo congelado.
  assert.deepEqual(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: r.event_id }).map((m) => [m.product_id, m.data, m.tipo, m.quantidade, m.custo_unitario, m.lote, m.validade]), [[p.product_id, '2027-05-10', 'SAIDA', 5, 1.85, 'L2291', '2028-02-28']]);
  // FINANCEIRO: o consumo, sem parcela.
  const fin = tab(s, 'FINANCEIRO', { event_id: r.event_id });
  assert.equal(fin.length, 1);
  const f = fin[0];
  assert.deepEqual([f.conta_id, f.natureza, f.tipo, f.categoria, f.descricao, f.data_competencia, f.valor, f.quantidade, f.product_id, f.property_id, f.retida_pelo_comprador, f.status, f.status_pagamento],
    [conta(s, 'VACINAS').conta_id, 'CUSTEIO', 'DESPESA', 'CUSTO_DIRETO', 'Consumo de vacina: 5 doses', '2027-05-10', 925, 5, p.product_id, S.PROP, false, 'ATIVO', 'SEM_CAIXA']);
  assert.deepEqual([f.ref_event_id, f.competencia_inicio, f.competencia_fim, f.animal_id, f.pasture_id, f.categoria_animal_id, f.partner_id, f.documento, f.observacoes, f.cancelado_em, f.cancelado_por_event_id, f.data_pagamento].map((v) => v || null), Array(12).fill(null), 'animal_id vazio: quatro alocações');
  assert.equal(tab(s, 'PARCELAS', { financial_id: f.financial_id }).length, 0, 'é o que faz o lançamento ser SEM_CAIXA');
  const rat = tab(s, 'RATEIOS', { financial_id: f.financial_id });
  assert.deepEqual(rat.map((x) => [x.event_id, x.criterio, x.escopo_tipo, x.escopo_ref, x.data_base, x.base_total, x.total_alocado]), [[r.event_id, 'CABECAS', 'EVENTO', r.event_id, '2027-05-10', 4, 925]]);
  assert.deepEqual(bez.map((id) => tab(s, 'ALOCACOES_FINANCEIRAS', { rateio_id: rat[0].rateio_id, animal_id: id })[0]).map((a) => [a.financial_id, a.base_valor, a.valor_alocado]), [[f.financial_id, 1, 232], [f.financial_id, 1, 231], [f.financial_id, 1, 231], [f.financial_id, 1, 231]]);
  // Passo 3: as somas fecham; o saldo caiu 5 doses na fase C.
  assert.equal(prod(s, p.product_id).estoque_atual, 45);
  semErro(s, '15.2');
  // Observação 2: o veterinário cobra R$ 80,00 pelo serviço → segundo lançamento com parcela; 22,32 + 22,31 × 3; total 89,25.
  const vet = ok(api(s, 'evento.corrigir', Object.assign(san('VACINACAO', '2027-05-10', bez, Object.assign({}, campos, { custo_valor: 8000, custo_conta_id: conta(s, 'SERVICOS_VETERINARIOS').conta_id, custo_vencimento: '2027-06-10' })), { event_id: r.event_id, justificativa: 'Faltou o serviço do veterinário' }), 'corr-vet'));
  assert.deepEqual(bez.map((id) => tab(s, 'SANIDADE', { event_id: vet.event_id, animal_id: id })[0].custo), [2232, 2231, 2231, 2231]);
  assert.equal(s.tabela('EVENTOS').find((e) => e.event_id === vet.event_id).total_value, 8925);
  const fins2 = tab(s, 'FINANCEIRO', { event_id: vet.event_id });
  assert.deepEqual(fins2.map((x) => [x.valor, x.status_pagamento, tab(s, 'PARCELAS', { financial_id: x.financial_id }).map((pp) => [pp.data_vencimento, pp.valor])]).sort(), [[8000, 'ABERTO', [['2027-06-10', 8000]]], [925, 'SEM_CAIXA', []]].sort());
  assert.equal(prod(s, p.product_id).estoque_atual, 45, 'a correção não baixa o estoque duas vezes');
  semErro(s, 'serviço pago no ato');
  // Observação 3: estornar não grava linha inversa: os lançamentos ficam CANCELADOS, o saldo volta a 50 por recálculo e
  // o custo acumulado dos bezerros perde os valores.
  const movs = s.tabela('MOVIMENTOS_ESTOQUE').length;
  ok(api(s, 'evento.estornar', { event_id: vet.event_id, justificativa: 'Vacinação não aconteceu' }, 'est-vet'));
  assert.equal(s.tabela('MOVIMENTOS_ESTOQUE').length, movs, 'nenhum movimento inverso');
  assert.equal(prod(s, p.product_id).estoque_atual, 50);
  assert.ok(tab(s, 'FINANCEIRO', { event_id: vet.event_id }).every((x) => x.status === 'CANCELADO'));
  const ficha = ok(api(s, 'animal.ficha', { animal_id: bez[0] }));
  assert.deepEqual([ficha.sanitario.itens.length, ficha.sanitario.custo_total], [0, null], 'nenhum registro vigente, nenhum custo');
  semErro(s, 'estorno');
});

test('CT-06 (09): vacinação de 30 animais com "Vacina X" a R$ 3,00 e 100 doses no estoque — dose 0 recusada; 30 linhas a R$ 3,00, 1 saída de 30 (100 → 70), 1 CUSTEIO de R$ 90,00 sem parcela, caixa inalterado; próxima em 02/10/2026; a agenda em 20/09 (próximas) e em 13/11 (vencidas)', () => {
  const s = S.sistema();
  const brincos = Array.from({ length: 30 }, (_, i) => String(601 + i).padStart(4, '0'));
  const ids = rebanho(s, brincos);
  const lista = brincos.map((b) => ids[b]);
  const v = produto(s, { nome: 'Vacina X', custo_unitario: 3 }, 'vacina-x');
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { product_id: v.product_id, quantidade: 100, valor: 30000, partner_id: null }), 'entrada-100'));
  const prot = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Vacina X semestral', tipo_procedimento: 'VACINA', product_id: v.product_id, sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180 } }, 'prot-180'));
  const parcelas0 = s.tabela('PARCELAS').length;
  const campos = (dose) => ({ produto_id: v.product_id, protocol_id: prot.protocol_id, modo_dose: 'POR_CABECA', dose_referencia: dose, quantidade_consumida_total: 30 });
  // Passo 1: dose 0 → VALIDATION (RN-055).
  const e0 = recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-04-05', lista, campos(0)), 'dose-0'), 'VALIDATION');
  assert.deepEqual(det(e0), [['VALOR_FORA_DA_FAIXA', 'dose_referencia']]);
  // Passo 2.
  const r = ok(api(s, 'evento.registrar', san('VACINACAO', '2026-04-05', lista, campos(1)), 'ct06'));
  const linhas = tab(s, 'SANIDADE', { event_id: r.event_id });
  assert.deepEqual([linhas.length, new Set(linhas.map((x) => x.event_id)).size, linhas.every((x) => x.custo === 300 && x.protocol_id === prot.protocol_id)], [30, 1, true]);
  assert.deepEqual(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: r.event_id }).map((m) => [m.tipo, m.quantidade]), [['SAIDA', 30]]);
  assert.equal(prod(s, v.product_id).estoque_atual, 70);
  const fin = tab(s, 'FINANCEIRO', { event_id: r.event_id });
  assert.deepEqual(fin.map((f) => [f.natureza, f.valor, f.status_pagamento]), [['CUSTEIO', 9000, 'SEM_CAIXA']]);
  const rat = tab(s, 'RATEIOS', { financial_id: fin[0].financial_id })[0];
  const al = tab(s, 'ALOCACOES_FINANCEIRAS', { rateio_id: rat.rateio_id });
  assert.deepEqual([al.length, al.every((a) => a.valor_alocado === 300)], [30, true]);
  assert.equal(s.tabela('PARCELAS').length, parcelas0, 'caixa inalterado: nenhuma parcela nova');
  assert.ok(linhas.every((x) => x.data_proxima_aplicacao === '2026-10-02'), '05/04 + 180 dias = 02/10/2026 nas 30 linhas (pelo protocolo)');
  semErro(s, 'CT-06');
  // Passo 3: a agenda com o relógio em 20/09 (próximas: antecedência de 15 dias) e em 13/11/2026 (vencidas).
  s.gas.clock.now = Date.parse('2026-09-20T15:00:00.000Z');
  const a1 = ok(api(s, 'sanidade.agenda', {}));
  assert.deepEqual([a1.data, a1.resumo.proximas, a1.resumo.vencidas, a1.pendencias.every((x) => x.situacao === 'PROXIMA' && x.vencimento === '2026-10-02' && x.protocol_id === prot.protocol_id)], ['2026-09-20', 30, 0, true]);
  assert.deepEqual(a1.protocolos.map((x) => [x.nome, x.elegiveis, x.em_dia, x.cobertura.valor, x.aplicacoes, x.animais_atendidos]), [['Vacina X semestral', 30, 30, 100, 1, 30]]);
  s.gas.clock.now = Date.parse('2026-11-13T15:00:00.000Z');
  const a2 = ok(api(s, 'sanidade.agenda', {}));
  assert.deepEqual([a2.resumo.proximas, a2.resumo.vencidas, a2.resumo.animais_pendentes, a2.pendencias[0].dias], [0, 30, 30, 42]);
  assert.deepEqual(a2.protocolos.map((x) => [x.em_dia, x.cobertura.valor]), [[0, 0]], 'vencidas não estão em dia');
  const alertas = ok(api(s, 'alerta.listar', {})).alertas.map((x) => [x.codigo, x.n]);
  assert.ok(alertas.some((x) => x[0] === 'SANITARIO_VENCIDO' && x[1] === 30), JSON.stringify(alertas));
});

test('dose por peso (03a, seção 4.6): 0,02 mL/kg × o peso atual de cada animal pela regra de validade — pesado, pesagem vencida (o de referência da categoria, estimado) e sem peso nenhum (recusado); o consumo é rateado pela dose (MANUAL), 8 mL × R$ 0,035 = R$ 0,28', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['201', '202', '203'], { sexo: 'M', castrado: true, data_nascimento: '2024-01-01' });
  const verm = produto(s, { nome: 'Vermífugo Y', categoria: 'VERMIFUGO', unidade: 'mL', fator_conversao: 500, custo_unitario: 0.035, dose_padrao_por_kg: 0.02, controla_estoque: false }, 'verm');
  const pes = (data, itens) => ({ tipo: 'PESAGEM', campos: { event_date: data, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: itens });
  ok(api(s, 'evento.registrar', pes('2026-10-01', [{ animal_id: ids['201'], peso: 400 }]), 'p1'));
  ok(api(s, 'evento.registrar', pes('2026-01-10', [{ animal_id: ids['202'], peso: 250 }]), 'p2'));
  const base = { produto_id: verm.product_id, modo_dose: 'POR_PESO', dose_referencia: 0.02 };
  // Sem pesagem e sem peso de referência da categoria (o Boi da semente não tem): a dose precisa ser informada.
  const sem = recusa(api(s, 'evento.registrar', san('VERMIFUGACAO', '2026-11-10', [ids['201'], ids['203']], base), 'sem-peso'), 'VALIDATION');
  assert.deepEqual([det(sem), sem.details[0].animal_id], [[['SEM_PESO', 'dose']], ids['203']]);
  const sim = ok(api(s, 'evento.simular', { acao: 'registrar', dados: san('VERMIFUGACAO', '2026-11-10', [ids['201'], ids['202'], { animal_id: ids['203'], dose: 7 }], base) }));
  assert.deepEqual(sim.impactos.sanidade.animais.map((a) => [a.dose, a.peso_kg, a.peso_situacao, a.peso_estimado]), [[8, 400, 'PESADO', false], [5, 250, 'PESAGEM_VENCIDA', true], [7, null, null, null]], 'a pesagem de 10/01 passou dos 180 dias: o maior entre o último peso e o de referência, estimado');
  const r = ok(api(s, 'evento.registrar', san('VERMIFUGACAO', '2026-11-10', [ids['201'], ids['202'], { animal_id: ids['203'], dose: 7 }], base), 'verm-peso'));
  const linhas = tab(s, 'SANIDADE', { event_id: r.event_id });
  assert.deepEqual([ids['201'], ids['202'], ids['203']].map((id) => linhas.find((x) => x.animal_id === id).dose), [8, 5, 7]);
  const ev = s.tabela('EVENTOS').find((e) => e.event_id === r.event_id);
  // Segunda convergência, rodada 1 (achados 2 e 3): o payload guarda de quem a dose foi digitada (o 203), para a correção a levar
  // como foi gravada e refazer pelo peso só as propostas.
  assert.deepEqual(ev.payload_json, { modo_dose: 'POR_PESO', dose_referencia: 0.02, quantidade_consumida_total: 20, doses_informadas: [ids['203']] }, 'vazia = a soma das doses');
  const f = tab(s, 'FINANCEIRO', { event_id: r.event_id })[0];
  assert.deepEqual([f.valor, f.conta_id, f.descricao], [70, conta(s, 'MEDICAMENTOS').conta_id, 'Consumo de vermífugo: 20 mL'], '20 mL × R$ 0,035 = R$ 0,70; vermífugo vai para Medicamentos');
  const rat = tab(s, 'RATEIOS', { financial_id: f.financial_id })[0];
  assert.deepEqual([rat.criterio, rat.base_total, rat.justificativa], ['MANUAL', 20, 'Proporcional à dose de cada animal (dose por kg de peso vivo).']);
  assert.deepEqual([ids['201'], ids['202'], ids['203']].map((id) => tab(s, 'ALOCACOES_FINANCEIRAS', { rateio_id: rat.rateio_id, animal_id: id })[0].valor_alocado), [28, 17, 25], '8 mL = R$ 0,28 (o exemplo de 03a); 17,5 e 24,5 empatam no resto e o centavo vai para a maior base (7 mL)');
  assert.deepEqual(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: r.event_id }).map((m) => [m.tipo, m.quantidade]), [['SAIDA', 20]], 'a saída é gravada também sem controle de estoque (03a, seção 4.6)');
  assert.equal(prod(s, verm.product_id).estoque_atual, null, 'sem controle, sem saldo');
  semErro(s, 'por peso');
});

test('modo total, texto livre e os subtipos: no total a dose fica vazia e a quantidade é obrigatória; produto sem cadastro não baixa estoque nem lança custo; doença sem produto; tratamento com motivo; exame com resultado por animal; regras do cabeçalho', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['301', '302']);
  const a = [ids['301'], ids['302']];
  const med = produto(s, { nome: 'Antibiótico Z', categoria: 'MEDICAMENTO', unidade: 'mL', custo_unitario: 0.5, controla_estoque: false }, 'med');
  // Total: dose por animal não se aplica; sem a quantidade, recusado.
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', san('MEDICACAO', '2026-05-01', a, { produto_id: med.product_id, modo_dose: 'TOTAL' }), 't1'), 'VALIDATION')), [['CAMPO_OBRIGATORIO', 'quantidade_consumida_total']]);
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', san('MEDICACAO', '2026-05-01', [{ animal_id: a[0], dose: 3 }], { produto_id: med.product_id, modo_dose: 'TOTAL', quantidade_consumida_total: 6 }), 't2'), 'VALIDATION')), ['CAMPO_NAO_SE_APLICA']);
  const t = ok(api(s, 'evento.registrar', san('MEDICACAO', '2026-05-01', a, { produto_id: med.product_id, modo_dose: 'TOTAL', quantidade_consumida_total: 9, motivo: 'Pneumonia' }), 't3'));
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: t.event_id }).map((x) => [x.dose, x.unidade_dose, x.motivo]), [[null, null, 'Pneumonia'], [null, null, 'Pneumonia']]);
  assert.deepEqual(tab(s, 'FINANCEIRO', { event_id: t.event_id }).map((f) => f.valor), [450]);
  // Texto livre: registrado, sem movimento nem consumo; a unidade é obrigatória com dose; quantidade não se aplica.
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-05-02', a, { nome_produto: 'Aftosa', modo_dose: 'POR_CABECA', dose_referencia: 5 }), 'l1'), 'VALIDATION')), ['CAMPO_OBRIGATORIO', 'CAMPO_OBRIGATORIO']);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-05-02', a, { nome_produto: 'Aftosa', modo_dose: 'POR_CABECA', dose_referencia: 5, unidade_dose: 'mL', quantidade_consumida_total: 10 }), 'l2'), 'VALIDATION')), [['CAMPO_NAO_SE_APLICA', 'quantidade_consumida_total']]);
  const l = ok(api(s, 'evento.registrar', san('VACINACAO', '2026-05-02', a, { nome_produto: 'Aftosa', modo_dose: 'POR_CABECA', dose_referencia: 5, unidade_dose: 'mL' }), 'l3'));
  assert.deepEqual([tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: l.event_id }).length, tab(s, 'FINANCEIRO', { event_id: l.event_id }).length, s.tabela('EVENTOS').find((e) => e.event_id === l.event_id).total_value || null], [0, 0, null]);
  // Vacina sem produto nenhum; produto do cadastro com outro nome no texto; produto inexistente; desativado.
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-05-02', a, {}), 'v0'), 'VALIDATION')), [['CAMPO_OBRIGATORIO', 'produto_id']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', san('MEDICACAO', '2026-05-02', a, { produto_id: med.product_id, nome_produto: 'Outro', modo_dose: 'TOTAL', quantidade_consumida_total: 2 }), 'v1'), 'VALIDATION')), [['CAMPO_NAO_SE_APLICA', 'nome_produto']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', san('MEDICACAO', '2026-05-02', a, { produto_id: S.id(0xbeef), modo_dose: 'TOTAL', quantidade_consumida_total: 2 }), 'v2'), 'VALIDATION')), [['NAO_ENCONTRADO', 'produto_id']]);
  ok(api(s, 'produto.salvar', { product_id: med.product_id, campos: { ativo: false } }, 'desativa'));
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', san('MEDICACAO', '2026-05-03', a, { produto_id: med.product_id, modo_dose: 'TOTAL', quantidade_consumida_total: 2 }), 'v3'), 'VALIDATION')), [['PRODUTO_INATIVO', 'produto_id']]);
  // Doença: sem produto (o campo nem existe no subtipo), com diagnóstico obrigatório.
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', san('DOENCA', '2026-05-04', a, {}), 'd0'), 'VALIDATION')), [['CAMPO_OBRIGATORIO', 'diagnostico']]);
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', san('DOENCA', '2026-05-04', a, { diagnostico: 'Tristeza', produto_id: med.product_id }), 'd1'), 'VALIDATION')), ['CAMPO_DESCONHECIDO']);
  const d = ok(api(s, 'evento.registrar', san('DOENCA', '2026-05-04', a, { diagnostico: 'Tristeza parasitária' }), 'd2'));
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: d.event_id }).map((x) => [x.tipo_procedimento, x.diagnostico, x.produto_id || null, x.dose]), [['DOENCA', 'Tristeza parasitária', null, null], ['DOENCA', 'Tristeza parasitária', null, null]]);
  // Tratamento: motivo obrigatório; exame: resultado por animal.
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', san('TRATAMENTO', '2026-05-05', a, {}), 'tr0'), 'VALIDATION')), [['CAMPO_OBRIGATORIO', 'motivo']]);
  ok(api(s, 'evento.registrar', san('TRATAMENTO', '2026-05-05', a, { motivo: 'Casqueamento' }), 'tr1'));
  const ex = ok(api(s, 'evento.registrar', san('EXAME', '2026-05-06', [{ animal_id: a[0], resultado_exame: 'Negativo' }, { animal_id: a[1], resultado_exame: 'Positivo' }], { diagnostico: 'Brucelose' }), 'ex'));
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: ex.event_id }).map((x) => [x.tipo_procedimento, x.resultado_exame]).sort(), [['EXAME', 'Negativo'], ['EXAME', 'Positivo']]);
  // Próxima aplicação antes ou no dia; carência negativa.
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', san('TRATAMENTO', '2026-05-05', a, { motivo: 'x', data_proxima_aplicacao: '2026-05-05' }), 'px'), 'VALIDATION')), [['DATA_INVALIDA', 'data_proxima_aplicacao']]);
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', san('TRATAMENTO', '2026-05-05', a, { motivo: 'x', periodo_carencia_dias: -1 }), 'cx'), 'VALIDATION')), [['VALOR_FORA_DA_FAIXA', 'periodo_carencia_dias']]);
  semErro(s, 'subtipos');
});

test('protocolo e avisos: protocolo de outro procedimento ou desativado recusado; a próxima vem do protocolo a cada N dias; lote vencido pede confirmação (PRODUTO_VENCIDO, RN-056); consumo acima do saldo pede confirmação (ESTOQUE_INSUFICIENTE, RN-057) e bloqueia com a política', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['401', '402']);
  const a = [ids['401'], ids['402']];
  const v = produto(s, { nome: 'Vacina A', custo_unitario: 2 }, 'va');
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-02-01', { product_id: v.product_id, quantidade: 1, valor: 200 }), 'ent-1'));
  const verm = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Vermífugo anual', tipo_procedimento: 'VERMIFUGO', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 365 } }, 'pv'));
  const vac = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Vacina semestral', tipo_procedimento: 'VACINA', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180 } }, 'pva'));
  const base = { produto_id: v.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 };
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-03-01', a, Object.assign({ protocol_id: verm.protocol_id }, base)), 'po'), 'VALIDATION')), [['PROTOCOLO_DE_OUTRO_PROCEDIMENTO', 'protocol_id']]);
  // Lote vencido e estoque insuficiente (2 doses para 1 no estoque): os dois avisos, aceitos.
  const vencido = Object.assign({ protocol_id: vac.protocol_id, lote: 'L1', validade: '2026-02-28' }, base);
  const av = recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-03-01', a, vencido), 'av'), 'NEEDS_CONFIRMATION');
  assert.deepEqual(cods(av).sort(), ['ESTOQUE_INSUFICIENTE', 'PRODUTO_VENCIDO']);
  assert.match(av.details.find((x) => x.codigo === 'ESTOQUE_INSUFICIENTE').mensagem, /^Vacina A: o estoque ficaria em -1 dose em 01\/03\/2026/);
  assert.match(av.details.find((x) => x.codigo === 'PRODUTO_VENCIDO').mensagem, /O lote L1 de Vacina A venceu em 28\/02\/2026, antes da aplicação \(01\/03\/2026\)/);
  const r = ok(api(s, 'evento.registrar', san('VACINACAO', '2026-03-01', a, vencido), 'av', ['ESTOQUE_INSUFICIENTE', 'PRODUTO_VENCIDO']));
  assert.deepEqual(s.tabela('EVENTOS').find((e) => e.event_id === r.event_id).payload_json.avisos_aceitos, [{ codigo: 'ESTOQUE_INSUFICIENTE', n: 1 }, { codigo: 'PRODUTO_VENCIDO', n: 1 }]);
  assert.ok(tab(s, 'SANIDADE', { event_id: r.event_id }).every((x) => x.data_proxima_aplicacao === '2026-08-28'), '01/03 + 180 dias');
  assert.equal(prod(s, v.product_id).estoque_atual, -1, 'o saldo negativo aceito fica visível');
  // Política BLOQUEIA para o estoque: vira erro com o mesmo código.
  ok(api(s, 'config.salvar', { valores: { avisos_politica: { ESTOQUE_INSUFICIENTE: 'BLOQUEIA' } } }, 'pol'));
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-04-01', a, base), 'bl'), 'VALIDATION')), ['ESTOQUE_INSUFICIENTE']);
  // Protocolo desativado: a aplicação nova não o cita; a correção do original que o citava continua aceita.
  ok(api(s, 'protocolo.salvar', { protocol_id: vac.protocol_id, campos: { ativo: false } }, 'des'));
  ok(api(s, 'config.salvar', { valores: { avisos_politica: {} } }, 'pol2'));
  assert.deepEqual(det(recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-04-01', a, Object.assign({ protocol_id: vac.protocol_id }, base)), 'pi', ['ESTOQUE_INSUFICIENTE']), 'VALIDATION')), [['PROTOCOLO_INATIVO', 'protocol_id']]);
  ok(api(s, 'evento.corrigir', Object.assign(san('VACINACAO', '2026-03-01', a, Object.assign({}, vencido, { lote: 'L2', validade: '2027-01-01' })), { event_id: r.event_id, justificativa: 'Lote certo' }), 'corr', ['ESTOQUE_INSUFICIENTE']));
  semErro(s, 'avisos');
});

test('caminhos: retroativo antes da entrada do estoque, mesmo dia (outro produto não é duplicidade; o mesmo produto é), correção que muda a dose e o produto (o saldo dos dois), correção do substituto, estorno da correção, estorno sem dependente; o estorno da entrada do animal com aplicação posterior → CONFLICT com ela', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['501', '502', '503']);
  const a = [ids['501'], ids['502']];
  const v1 = produto(s, { nome: 'Vacina 1', custo_unitario: 1 }, 'v1');
  const v2 = produto(s, { nome: 'Vacina 2', custo_unitario: 2 }, 'v2');
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { product_id: v1.product_id, quantidade: 10, valor: 1000 }), 'e1'));
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-03-01', { product_id: v2.product_id, quantidade: 10, valor: 2000 }), 'e2'));
  // Retroativo: aplicação em 15/02, antes da entrada de 01/03: o saldo fica negativo naquela data → aviso.
  const retro = recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-02-15', a, { produto_id: v1.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 }), 'retro'), 'NEEDS_CONFIRMATION');
  assert.match(retro.details[0].mensagem, /o estoque ficaria em -2 doses em 15\/02\/2026/);
  const r1 = ok(api(s, 'evento.registrar', san('VACINACAO', '2026-04-01', a, { produto_id: v1.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 }), 'r1'));
  // Mesmo dia: outra vacina não é duplicidade; a mesma é (POSSIVEL_DUPLICIDADE com o lançamento).
  ok(api(s, 'evento.registrar', san('VACINACAO', '2026-04-01', a, { produto_id: v2.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 }), 'r2'));
  const dup = recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-04-01', a, { produto_id: v1.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 }), 'dup'), 'NEEDS_CONFIRMATION');
  assert.deepEqual([cods(dup), dup.details[0].conflito.event_id], [['POSSIVEL_DUPLICIDADE'], r1.event_id]);
  assert.deepEqual([prod(s, v1.product_id).estoque_atual, prod(s, v2.product_id).estoque_atual], [8, 8]);
  // Correção: dose 2 e o produto 2 → o saldo de v1 volta a 10 e o de v2 cai 4 (8 → 4).
  // (No mesmo dia já há a vacina 2 nesses animais: o substituto pede a confirmação de duplicidade.)
  const k1 = ok(api(s, 'evento.corrigir', Object.assign(san('VACINACAO', '2026-04-01', a, { produto_id: v2.product_id, modo_dose: 'POR_CABECA', dose_referencia: 2 }), { event_id: r1.event_id, justificativa: 'Era a vacina 2' }), 'k1', ['POSSIVEL_DUPLICIDADE']));
  assert.deepEqual([prod(s, v1.product_id).estoque_atual, prod(s, v2.product_id).estoque_atual], [10, 4]);
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: k1.event_id }).map((x) => [x.produto_id, x.dose, x.custo]), [[v2.product_id, 2, 400], [v2.product_id, 2, 400]]);
  assert.deepEqual(k1.produtos.map((p) => [p.nome, p.estoque_atual]).sort(), [['Vacina 1', 10], ['Vacina 2', 4]], 'a resposta traz o saldo de cada produto movimentado');
  // Correção do substituto (mais um animal), estorno da correção (some por inteiro; o original não volta).
  const k2 = ok(api(s, 'evento.corrigir', Object.assign(san('VACINACAO', '2026-04-01', [ids['501'], ids['502'], ids['503']], { produto_id: v2.product_id, modo_dose: 'POR_CABECA', dose_referencia: 2 }), { event_id: k1.event_id, justificativa: 'Faltou o 503' }), 'k2', ['POSSIVEL_DUPLICIDADE']));
  assert.equal(prod(s, v2.product_id).estoque_atual, 2);
  const simE = ok(api(s, 'evento.simular', { acao: 'estornar', dados: { event_id: k2.event_id, justificativa: 'x' } }));
  assert.equal(simE.impactos.corrige.event_id, k1.event_id);
  ok(api(s, 'evento.estornar', { event_id: k2.event_id, justificativa: 'Não houve' }, 'est-k2'));
  assert.deepEqual([prod(s, v1.product_id).estoque_atual, prod(s, v2.product_id).estoque_atual], [10, 8]);
  assert.equal(s.tabela('EVENTOS').find((e) => e.event_id === r1.event_id).status, 'ESTORNADO', 'o original não volta');
  // A aplicação é um fato: o estorno do rebanho inicial (que criou os animais) é CONFLICT com ela.
  const ent = s.tabela('EVENTOS').find((x) => x.event_type === 'ENTRADA_INICIAL');
  const c = recusa(api(s, 'evento.estornar', { event_id: ent.event_id, justificativa: 'x' }, 'est-ent'), 'CONFLICT');
  assert.ok(c.details.some((x) => x.conflito && x.conflito.tipo === 'SANIDADE'), JSON.stringify(c.details.map((x) => x.conflito)));
  // Fora da permanência: aplicação depois da venda ou antes da entrada.
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', san('TRATAMENTO', '2025-12-20', a, { motivo: 'x' }), 'antes'), 'VALIDATION')), ['ANTES_DO_MARCO_ZERO']);
  semErro(s, 'caminhos');
});

test('carência pelo registro real (RN-072): abate antes do fim da carência bloqueado; aplicação retroativa cuja carência cobre um abate já gravado é recusada (política BLOQUEIA); sobre a recria, só aviso; a lista leve traz o fim da carência de hoje e a ficha, os registros e as próximas doses', () => {
  const s = S.sistema();
  s.gas.clock.now = Date.parse('2026-12-10T15:00:00.000Z');
  const ids = rebanho(s, ['601', '602', '603'], { sexo: 'M', castrado: true, data_nascimento: '2023-01-01' });
  const frig = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Frigorífico', tipos: 'COMPRADOR' } }, 'frig')).partner_id;
  const venda = (data, fin, id) => ({ tipo: 'VENDA', campos: { event_date: data, partner_id: frig, finalidade: fin, modalidade: 'CABECA', preco_unitario: 400000, valor_bruto: 400000 }, animais: [{ animal_id: id }], parcelas: [{ data_vencimento: data }] });
  const verm = san('VERMIFUGACAO', '2026-11-01', [ids['601']], { nome_produto: 'Ivermectina 1%', modo_dose: 'POR_CABECA', dose_referencia: 5, unidade_dose: 'mL', periodo_carencia_dias: 35, data_proxima_aplicacao: '2027-05-01' });
  ok(api(s, 'evento.registrar', verm, 'verm'));
  // Abate em 06/12 (último dia da carência): bloqueado; em 07/12: livre.
  const bl = recusa(api(s, 'evento.registrar', venda('2026-12-06', 'ABATE', ids['601']), 'v-bl'), 'VALIDATION');
  assert.deepEqual(cods(bl), ['CARENCIA_ATIVA']);
  assert.match(bl.details[0].mensagem, /^601: está em carência sanitária até 06\/12\/2026 \(Ivermectina 1%, aplicado em 01\/11\/2026\)/);
  ok(api(s, 'evento.registrar', venda('2026-12-07', 'ABATE', ids['601']), 'v-ok'));
  // Abate do 602 em 20/11; depois, um tratamento retroativo de 10/11 com 21 dias de carência (até 01/12) → recusado.
  ok(api(s, 'evento.registrar', venda('2026-11-20', 'ABATE', ids['602']), 'v602'));
  const retro = recusa(api(s, 'evento.registrar', san('MEDICACAO', '2026-11-10', [ids['602']], { nome_produto: 'Oxitetraciclina', modo_dose: 'POR_CABECA', dose_referencia: 10, unidade_dose: 'mL', periodo_carencia_dias: 21 }), 'retro'), 'VALIDATION');
  assert.deepEqual([cods(retro), retro.details[0].conflito.tipo], [['CARENCIA_ATIVA'], 'VENDA']);
  assert.match(retro.details[0].mensagem, /^602: foi vendido para abate em 20\/11\/2026, dentro da carência desta aplicação \(até 01\/12\/2026\)/);
  ok(api(s, 'evento.registrar', san('MEDICACAO', '2026-11-10', [ids['602']], { nome_produto: 'Oxitetraciclina', modo_dose: 'POR_CABECA', dose_referencia: 10, unidade_dose: 'mL', periodo_carencia_dias: 5 }), 'retro-5'), 'carência que termina antes da venda passa');
  // Recria: aviso com aceite (a política não se aplica fora do abate).
  ok(api(s, 'evento.registrar', venda('2026-11-25', 'RECRIA_ENGORDA', ids['603']), 'v603'));
  const rec = recusa(api(s, 'evento.registrar', san('MEDICACAO', '2026-11-15', [ids['603']], { nome_produto: 'Oxitetraciclina', modo_dose: 'POR_CABECA', dose_referencia: 10, unidade_dose: 'mL', periodo_carencia_dias: 21 }), 'rec'), 'NEEDS_CONFIRMATION');
  assert.match(rec.details[0].mensagem, /Confirme que o comprador soube da carência\.$/);
  ok(api(s, 'evento.registrar', san('MEDICACAO', '2026-11-15', [ids['603']], { nome_produto: 'Oxitetraciclina', modo_dose: 'POR_CABECA', dose_referencia: 10, unidade_dose: 'mL', periodo_carencia_dias: 21 }), 'rec', ['CARENCIA_ATIVA']));
  // A lista leve (bootstrap) e a ficha.
  const s2 = S.sistema();
  const i2 = rebanho(s2, ['701']);
  ok(api(s2, 'evento.registrar', san('VERMIFUGACAO', '2026-11-01', [i2['701']], { nome_produto: 'Ivermectina 1%', modo_dose: 'POR_CABECA', dose_referencia: 5, unidade_dose: 'mL', periodo_carencia_dias: 35, data_proxima_aplicacao: '2027-05-01' }), 'v'));
  const boot = ok(api(s2, 'sistema.bootstrap', {}));
  const col = boot.animais.colunas.indexOf('carencia_ate');
  assert.ok(col >= 0);
  assert.deepEqual(boot.animais.valores.carencia_ate, ['2026-12-06']);
  const f = ok(api(s2, 'animal.ficha', { animal_id: i2['701'] })).sanitario;
  assert.deepEqual([f.entregue, f.itens.length, f.itens[0].nome_produto, f.itens[0].data_fim_carencia, f.carencia.fim, f.proximas.map((p) => [p.vencimento, p.situacao])], [true, 1, 'Ivermectina 1%', '2026-12-06', '2026-12-06', [['2027-05-01', 'EM_DIA']]]);
  semErro(s, 'carência');
});

test('importação e desfazer: a aplicação num animal importado impede desfazer a importação (CONFLICT com ela); estornada a aplicação, o desfazer passa e o saldo do produto volta', () => {
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
  const v = produto(s, { nome: 'Vacina I', custo_unitario: 1 }, 'vi');
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-02-01', { product_id: v.product_id, quantidade: 10, valor: 1000 }), 'ent'));
  const p = ok(api(s, 'evento.registrar', san('VACINACAO', '2026-03-01', [a.animal_id], { produto_id: v.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 }), 'v-imp'));
  let r = s.tentar((ctx) => G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id, justificativa: 'Arquivo errado' } }));
  assert.equal(r.erro.code, 'CONFLICT');
  assert.deepEqual(r.erro.details.map((d) => [d.conflito.event_id, d.conflito.tipo]), [[p.event_id, 'SANIDADE']]);
  ok(api(s, 'evento.estornar', { event_id: p.event_id, justificativa: 'Animal do arquivo errado' }, 'est-v-imp'));
  r = s.tentar((ctx) => G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id, justificativa: 'Arquivo errado' } }));
  assert.equal(r.ok, true, JSON.stringify(r.erro));
  assert.equal(prod(s, v.product_id).estoque_atual, 10);
  semErro(s, 'importação desfeita');
});

test('verificação de integridade (COPIAS, PROJECAO e FINANCEIRO): fim da carência, dose sem modo, unidade trocada, custo copiado, saída de estoque e consumo mexidos à mão são acusados; o saldo mexido é reparável; a trava recusa lançar para o animal da aplicação adulterada', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['801', '802', '803']);
  const v = produto(s, { nome: 'Vacina T', custo_unitario: 2 }, 'vt');
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-02-01', { product_id: v.product_id, quantidade: 10, valor: 2000 }), 'ent'));
  const r = ok(api(s, 'evento.registrar', san('VACINACAO', '2026-03-01', [ids['801'], ids['802']], { produto_id: v.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1, periodo_carencia_dias: 10 }), 'vac'));
  semErro(s, 'antes');
  const linha = tab(s, 'SANIDADE', { event_id: r.event_id, animal_id: ids['801'] })[0];
  const mov = tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: r.event_id })[0];
  const fin = tab(s, 'FINANCEIRO', { event_id: r.event_id })[0];
  const casos = [
    ['SANIDADE', linha.health_id, 'data_fim_carencia', '2026-03-20', 'COPIAS', /o fim da carência gravado \(20\/03\/2026\) não é a aplicação mais os dias de carência \(11\/03\/2026\)/],
    ['SANIDADE', linha.health_id, 'unidade_dose', 'mL', 'COPIAS', /a dose está em "mL", mas o produto Vacina T é controlado em "dose"/],
    ['SANIDADE', linha.health_id, 'custo', 9.99, 'COPIAS', /o custo copiado na aplicação \(R\$ 9,99\) difere do que coube ao animal no lançamento \(R\$ 2,00\)/],
    ['SANIDADE', linha.health_id, 'tipo_procedimento', 'VERMIFUGO', 'COPIAS', /SANIDADE: o tipo VERMIFUGO não corresponde/],
    ['MOVIMENTOS_ESTOQUE', mov.mov_id, 'quantidade', 7, 'COPIAS', /a saída do estoque não confere com o consumo do lançamento/],
    ['FINANCEIRO', fin.financial_id, 'valor', 9, 'COPIAS', /não confere com o lançamento de consumo do evento/],
  ];
  for (const [aba, idReg, col, valor, checagem, msg] of casos) {
    const bruto = s.tabela(aba).find((x) => x[s.G.Schema.pk(aba)] === idReg)[col];
    s.editar(aba, idReg, col, valor);
    const rel = s.integridade();
    assert.ok(rel.achados.some((x) => x.checagem === checagem && msg.test(x.mensagem)), aba + '.' + col + ': ' + JSON.stringify(rel.achados.slice(0, 4)));
    assert.equal(rel.reparavel, false, 'fonte quebrada: o reparo não é oferecido');
    s.editar(aba, idReg, col, typeof bruto === 'number' && s.G.Schema.coluna(aba, col).tipo === 'DINHEIRO' ? bruto / 100 : bruto);
  }
  semErro(s, 'desfeito');
  // O saldo gravado mexido: PROJECAO com reparo (a reconstrução refaz 8).
  s.editar('PRODUTOS', v.product_id, 'estoque_atual', 99);
  let rel = s.integridade();
  assert.ok(rel.achados.some((x) => x.checagem === 'PROJECAO' && x.tabela === 'PRODUTOS' && /estoque_atual gravado 99, calculado 8/.test(x.mensagem)), JSON.stringify(rel.achados));
  s.exec((ctx) => s.G.AuditService.repararIntegridade(ctx, 'Saldo mexido'));
  assert.equal(prod(s, v.product_id).estoque_atual, 8);
  // A trava (a mesma função) recusa lançar para o animal cuja aplicação foi adulterada: a reconstrução partiria dela.
  s.editar('SANIDADE', linha.health_id, 'data_fim_carencia', '2026-03-20');
  const pes = { tipo: 'PESAGEM', campos: { event_date: '2026-04-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids['801'], peso: 200 }] };
  const tr = recusa(api(s, 'evento.registrar', pes, 'p-trava'), 'CONFLICT');
  assert.deepEqual(cods(tr), ['INTEGRIDADE_COPIAS']);
  assert.match(tr.message, /dados apagados ou mexidos à mão/);
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', Object.assign({}, pes, { animais: [{ animal_id: ids['802'], peso: 200 }] }), 'p-802'), 'CONFLICT')), ['INTEGRIDADE_COPIAS'], 'o outro animal da mesma aplicação também (a fonte é o lançamento)');
  ok(api(s, 'evento.registrar', Object.assign({}, pes, { animais: [{ animal_id: ids['803'], peso: 200 }] }), 'p-outro'), 'o animal de fora da aplicação não é alcançado');
});
