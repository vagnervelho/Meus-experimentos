'use strict';
/**
 * Segunda convergência da Fase 3, rodada 2 da revisão: os achados do servidor. Cada teste reproduz um achado pelo cenário
 * mínimo, falha com o `src/` de antes do conserto (commit 5e69ebf) e passa agora; o conserto está na causa (a regra única do
 * dono do registro reprodutivo, a verificação da cópia × fonte na mesma linha do lançamento, a marca do digitado lida pelo ponto
 * único da correção), e o oráculo do teste aleatório que deixou o defeito passar foi estendido (CONTRATOS, seção 54).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js } = S;
const TODOS = ['PESO_IMPLAUSIVEL', 'POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'ESTOQUE_INSUFICIENTE', 'PRODUTO_VENCIDO', 'CARENCIA_ATIVA', 'IDADE_REPRODUTIVA', 'CATEGORIAS_SEM_COBERTURA', 'RATEIO_SEM_PESO', 'VALOR_DIVERGENTE', 'INTERVALO_PARTO_CURTO', 'BRINCO_PARECIDO'];

let n = 0;
function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave || 'c2r2-' + (++n), avisosAceitos: avisos || TODOS })));
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
const erros = (s) => s.integridade().achados.filter((a) => a.severidade === 'ERRO');
const tab = (s, aba, filtro) => s.tabela(aba).filter((r) => Object.keys(filtro || {}).every((k) => r[k] === filtro[k]));
const reg = (s, d, onde) => ok(api(s, 'evento.registrar', d), onde);
const corrigirSemMudanca = (s, eid) => {
  const o = ok(api(s, 'evento.obter', { event_id: eid }), 'obter');
  return api(s, 'evento.corrigir', Object.assign({}, o.correcao, { criados: undefined, event_id: eid, justificativa: 'Conferido' }));
};
const machos = (q, base) => Array.from({ length: q }, (_, i) => S.bicho({ brinco: String((base || 100) + i), sexo: 'M', castrado: true, data_nascimento: '2023-01-01', data_nascimento_confianca: 'CONFIRMADA' }));
const vaca = (b, extra) => S.bicho(Object.assign({ brinco: b, sexo: 'F', data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }, extra || {}));

// ------------------------------------------------------------------ ALTA ----

test('achado 1: o aborto é do dono da prenhez que ele encerra (a regra do parto e do diagnóstico sem estação), não da faixa de datas — o aborto da prenhez da estação anterior não vira o desfecho da fêmea na estação seguinte, e a exposição em curso continua na previsão de parto', () => {
  const s = S.sistema();
  hoje(s, '2026-01-02');
  const { ids } = rebanho(s, ['V0', 'W1', 'W2', 'W3', 'W4', 'W5', 'X1', 'X2', 'X3', 'X4'].map((b) => vaca(b)).concat([S.bicho({ brinco: 'T1', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA' })]));
  const est = (nome, ini, fim) => ok(api(s, 'estacao.salvar', { campos: { nome, data_inicio: ini, data_fim: fim, property_id: S.PROP, tipo: 'MONTA_NATURAL' } }), nome).estacao_id;
  const E1 = est('Estação águas 2026', '2026-01-01', '2026-03-31');
  const E2 = est('Estação seca 2026', '2026-07-01', '2026-09-30');
  hoje(s, '2027-09-01');
  const lote1 = ['V0', 'X1', 'X2', 'X3', 'X4'];
  const lote2 = ['V0', 'W1', 'W2', 'W3', 'W4', 'W5'];
  reg(s, { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-01-05', data_fim: '2026-03-31', estacao_id: E1 }, animais: lote1.map((b) => ({ animal_id: ids[b] })).concat([{ animal_id: ids.T1 }]) }, 'expo E1');
  reg(s, { tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-05-10', metodo: 'PALPACAO', estacao_id: E1 }, animais: lote1.map((b) => ({ animal_id: ids[b], resultado: 'POSITIVO' })) }, 'dg E1');
  reg(s, { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-07-01', data_fim: '2026-09-30', estacao_id: E2 }, animais: lote2.map((b) => ({ animal_id: ids[b] })).concat([{ animal_id: ids.T1 }]) }, 'expo E2');
  // V0 perde a prenhez da estação 1 em julho, já no lote da estação 2 (o aborto não tem estação).
  const ab = reg(s, { tipo: 'REPRODUCAO', subtipo: 'ABORTO', campos: { event_date: '2026-07-15' }, animais: [{ animal_id: ids.V0 }] }, 'aborto V0');
  reg(s, { tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-11-15', metodo: 'PALPACAO', estacao_id: E2 }, animais: lote2.map((b) => ({ animal_id: ids[b], resultado: 'POSITIVO' })) }, 'dg E2');
  ['X1', 'X2', 'X3', 'X4'].forEach((b, i) => reg(s, { tipo: 'NASCIMENTO', campos: { event_date: '2026-10-2' + i }, animais: [{ animal_id: ids[b] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: 'C' + b }] }, 'parto ' + b));
  // Na estação 2, a V0 está prenhe (de novo) e a previsão é a da exposição de 01/07 contada do aborto: não "sem data".
  const mz = ok(api(s, 'reproducao.matrizes', { data: '2027-02-01' }), 'matrizes');
  const v0 = mz.itens.find((x) => x.animal_id === ids.V0);
  assert.equal(v0.situacao_reprodutiva, 'PRENHA');
  assert.deepEqual([v0.previsao_parto.nivel, v0.previsao_parto.inicio, v0.previsao_parto.fim, v0.previsao_parto.base.data], [3, '2027-04-11', '2027-08-06', '2026-07-01'], 'a exposição em curso no aborto continua, a partir dele');
  const comprador = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Fazenda Vizinha', tipos: ['COMPRADOR'] } }), 'parceiro').partner_id;
  reg(s, { tipo: 'VENDA', campos: { event_date: '2027-03-01', partner_id: comprador, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 500000, valor_bruto: 500000 }, animais: [{ animal_id: ids.V0 }], parcelas: [{ data_vencimento: '2027-03-01', valor: 500000 }], deducoes: [] }, 'venda V0');
  ['W1', 'W2', 'W3', 'W4', 'W5'].forEach((b, i) => reg(s, { tipo: 'NASCIMENTO', campos: { event_date: '2027-05-1' + i }, animais: [{ animal_id: ids[b] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: 'C' + b }] }, 'parto ' + b));
  const ind = (e) => ok(api(s, 'reproducao.indicadores', { estacao_id: e, data: '2027-09-01' }), 'indicadores').estacao.geral;
  const r = (g) => [g.sairam_sem_desfecho, g.abortos, g.paricao.numerador, g.paricao.denominador, g.perda_gestacional.numerador, g.perda_gestacional.denominador];
  assert.deepEqual(r(ind(E2)), [1, 0, 5, 5, 0, 5], 'a estação 2: a V0 saiu prenhe sem desfecho (sai da parição e da perda)');
  assert.deepEqual(r(ind(E1)), [0, 1, 4, 5, 1, 5], 'a estação 1: o aborto é dela');
  // Contraprova: sem o aborto, a estação 2 é a mesma.
  ok(api(s, 'evento.estornar', { event_id: ab.event_id, justificativa: 'Contraprova' }), 'estorno');
  assert.deepEqual(r(ind(E2)), [1, 0, 5, 5, 0, 5]);
  semErro(s, 'aborto');
});

/** Vermifugação por peso de três bois pesados (300, 400 e 500 kg), 0,02 mL/kg, com o consumo rateado pela dose. */
function vermifugacaoTres() {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, machos(3));
  hoje(s, '2026-04-01');
  const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Ivermectina', categoria: 'VERMIFUGO', unidade: 'mL', controla_estoque: true, custo_unitario: 0.5 } }), 'produto');
  reg(s, { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-02-01', product_id: p.product_id, quantidade: 500, valor: 25000 } }, 'entrada');
  reg(s, { tipo: 'PESAGEM', campos: { event_date: '2026-03-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [0, 1, 2].map((i) => ({ animal_id: ids[String(100 + i)], peso: 300 + 100 * i })) }, 'pesagem');
  const v = reg(s, { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: { event_date: '2026-03-10', produto_id: p.product_id, modo_dose: 'POR_PESO', dose_referencia: 0.02 }, animais: [0, 1, 2].map((i) => ({ animal_id: ids[String(100 + i)] })) }, 'aplicação');
  return { s, ids, p, v };
}

test('achados 2 e 6: a dose mexida à mão numa aplicação por peso é fonte quebrada — a verificação acusa a soma das doses ≠ a saída do frasco e a base do rateio do consumo ≠ a dose, e a correção (sem mudança ou só da anotação) é recusada em vez de espalhar a dose adulterada no custo', () => {
  const { s, v } = vermifugacaoTres();
  const san = tab(s, 'SANIDADE', { event_id: v.event_id });
  assert.deepEqual(san.map((x) => [x.dose, x.custo]), [[6, 300], [8, 400], [10, 500]]);
  semErro(s, 'antes');
  s.editar('SANIDADE', san[0].health_id, 'dose', 60);
  const achados = erros(s);
  assert.ok(achados.some((a) => a.checagem === 'COPIAS' && a.tabela === 'EVENTOS' && /a soma das doses dos animais \(78\) não é a quantidade que saiu do frasco \(24\)/.test(a.mensagem)), 'a soma das doses × a saída: ' + JSON.stringify(achados));
  assert.ok(achados.some((a) => a.checagem === 'COPIAS' && a.tabela === 'ALOCACOES_FINANCEIRAS' && /a base do rateio do consumo \(6\) não é a dose do animal na aplicação \(60\)/.test(a.mensagem)), 'a base do rateio × a dose: ' + JSON.stringify(achados));
  const antes = js(s.tabela('ALOCACOES_FINANCEIRAS'));
  const c1 = corrigirSemMudanca(s, v.event_id);
  assert.equal(c1.ok, false, 'a correção sem mudança refaria o custo pela dose adulterada');
  assert.match(c1.error.message, /mexidos à mão/);
  const c2 = api(s, 'evento.corrigir', { event_id: v.event_id, justificativa: 'Só a anotação', mudanca: { campos: { notes: 'Conferido' } } });
  assert.equal(c2.ok, false, 'nem a correção só da anotação');
  assert.deepEqual(js(s.tabela('ALOCACOES_FINANCEIRAS')), antes, 'nada mudou');
});

test('achado 6 (cópias do cabeçalho): o lote, o fabricante, a via e o veterinário diferentes numa linha da aplicação, o lote da saída ≠ o da aplicação e o rateio do consumo que não segue o modo da dose são acusados (antes, calados)', () => {
  const { s, v } = vermifugacaoTres();
  const san = tab(s, 'SANIDADE', { event_id: v.event_id });
  const base = s.gas.estado.salvar();
  const casos = [['SANIDADE', san[1].health_id, 'lote', 'L-X'], ['SANIDADE', san[1].health_id, 'fabricante', 'Outro'], ['SANIDADE', san[2].health_id, 'via_aplicacao', 'ORAL'],
    ['SANIDADE', san[2].health_id, 'veterinario', 'Dr. X'], ['MOVIMENTOS_ESTOQUE', tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: v.event_id })[0].mov_id, 'lote', 'L-Y']];
  casos.forEach(([aba, id, col, val]) => {
    s.gas.estado.restaurar(base);
    s.editar(aba, id, col, val);
    const ach = erros(s);
    assert.ok(ach.some((a) => a.checagem === 'COPIAS' && a.tabela === aba && a.id === id && a.campo === col), aba + '.' + col + ': ' + JSON.stringify(ach));
  });
  s.gas.estado.restaurar(base);
  const e = tab(s, 'EVENTOS', { event_id: v.event_id })[0];
  s.editar('EVENTOS', e.event_id, 'payload_json', JSON.stringify(Object.assign({}, e.payload_json, { modo_dose: 'POR_CABECA' })));
  assert.ok(erros(s).some((a) => a.tabela === 'RATEIOS' && a.campo === 'criterio' && /rateado pela dose de cada animal/.test(a.mensagem)), 'o rateio pela dose com o modo por cabeça');
});

test('achado 3: o método é do lançamento na pesagem e na desmama — o método mexido à mão numa linha é acusado (só a linha diferente da maioria), e a correção sem mudança é recusada em vez de espalhá-lo a todas as linhas e apagar o GMD', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, machos(5));
  hoje(s, '2026-06-01');
  reg(s, { tipo: 'PESAGEM', campos: { event_date: '2026-02-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [0, 1, 2, 3, 4].map((i) => ({ animal_id: ids[String(100 + i)], peso: 300 })) }, 'p1');
  const p2 = reg(s, { tipo: 'PESAGEM', campos: { event_date: '2026-04-02', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [0, 1, 2, 3, 4].map((i) => ({ animal_id: ids[String(100 + i)], peso: 330 })) }, 'p2');
  const linhas = tab(s, 'PESAGENS', { event_id: p2.event_id });
  s.editar('PESAGENS', linhas[0].weight_id, 'metodo', 'ESTIMATIVA_VISUAL');
  const ach = erros(s).filter((a) => a.campo === 'metodo' && /o método é do lançamento/.test(a.mensagem));
  assert.deepEqual(ach.map((a) => a.id), [linhas[0].weight_id], 'só a linha mexida');
  const c = corrigirSemMudanca(s, p2.event_id);
  assert.equal(c.ok, false);
  assert.deepEqual(tab(s, 'PESAGENS', { event_id: p2.event_id }).map((x) => x.metodo).sort(), ['BALANCA', 'BALANCA', 'BALANCA', 'BALANCA', 'ESTIMATIVA_VISUAL']);
  // A desmama: o mesmo.
  const s2 = S.sistema();
  hoje(s2, '2026-01-02');
  const r2 = rebanho(s2, [vaca('V1'), vaca('V2')]);
  hoje(s2, '2026-09-01');
  const crias = ['V1', 'V2'].map((b) => reg(s2, { tipo: 'NASCIMENTO', campos: { event_date: '2026-01-10' }, animais: [{ animal_id: r2.ids[b] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: 'C' + b }] }, 'parto').animais.find((a) => a.brinco === 'C' + b).animal_id);
  const d = reg(s2, { tipo: 'DESMAMA', campos: { event_date: '2026-08-10', metodo_pesagem: 'BALANCA' }, animais: crias.map((id) => ({ animal_id: id, peso: 180 })) }, 'desmama');
  s2.editar('PESAGENS', tab(s2, 'PESAGENS', { event_id: d.event_id })[0].weight_id, 'metodo', 'ESTIMATIVA_VISUAL');
  assert.ok(erros(s2).some((a) => a.campo === 'metodo' && /o método é do lançamento/.test(a.mensagem)), 'a desmama também');
  assert.equal(corrigirSemMudanca(s2, d.event_id).ok, false);
});

test('achado 4: o pasto de destino da desmama fica gravado também quando o bezerro já está nele (origem = destino) — o estorno da transferência que o pôs lá é recusado com o conflito, e as duas entradas sem mudança (o pedido aceito e a do servidor) gravam os mesmos fatos', () => {
  const s = S.sistema();
  hoje(s, '2026-01-02');
  const C = ok(api(s, 'pasto.salvar', { campos: { property_id: S.PROP, nome: 'Pasto C', posse: 'PROPRIO', status: 'ATIVO' } }), 'pasto C');
  const pastoC = C.pasture_id || (C.pasto || {}).pasture_id;
  const { ids } = rebanho(s, [vaca('V0')]);
  hoje(s, '2026-09-01');
  const cria = reg(s, { tipo: 'NASCIMENTO', campos: { event_date: '2026-01-10' }, animais: [{ animal_id: ids.V0 }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: 'C0' }] }, 'parto').animais.find((a) => a.brinco === 'C0').animal_id;
  const t = reg(s, { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-04-29', pasto_origem_id: S.PASTOS.A, pasto_destino_id: pastoC }, animais: [{ animal_id: cria }] }, 'transferência');
  const pedido = { tipo: 'DESMAMA', campos: { event_date: '2026-06-27', pasto_destino_id: pastoC, metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: cria, peso: 150 }] };
  const d = reg(s, pedido, 'desmama');
  const l = tab(s, 'EVENTO_ANIMAIS', { event_id: d.event_id, animal_id: cria })[0];
  assert.deepEqual([l.pasto_origem_id, l.pasto_destino_id], [pastoC, pastoC], 'o pasto informado gravado (sem estada nova)');
  const e = api(s, 'evento.estornar', { event_id: t.event_id, justificativa: 'Lançada errada' });
  assert.equal(e.ok, false, 'o estorno mudaria em silêncio o efeito da desmama');
  assert.equal(e.error.code, 'CONFLICT');
  assert.deepEqual(e.error.details.map((x) => [x.codigo, x.conflito && x.conflito.event_id]), [['ORIGEM_DIVERGENTE', d.event_id]]);
  const o = ok(api(s, 'evento.obter', { event_id: d.event_id }), 'obter');
  assert.equal(o.correcao.campos.pasto_destino_id, pastoC, 'a entrada do servidor leva o pasto informado');
  const c1 = ok(api(s, 'evento.corrigir', Object.assign({ event_id: d.event_id, justificativa: 'Reenvio' }, pedido)), 'pelo pedido');
  const c2 = ok(corrigirSemMudanca(s, c1.event_id), 'pela entrada do servidor');
  const linhaDe = (eid) => tab(s, 'EVENTO_ANIMAIS', { event_id: eid, animal_id: cria }).map((x) => [x.pasto_origem_id, x.pasto_destino_id]);
  assert.deepEqual(linhaDe(c1.event_id), [[pastoC, pastoC]]);
  assert.deepEqual(linhaDe(c2.event_id), [[pastoC, pastoC]]);
  semErro(s, 'desmama');
});

test('achado 5: a correção do lançamento que criou o animal não desfaz a raça corrigida na ficha (rebanho inicial, compra e parto): a raça vai para o cadastro só quando a correção a muda', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const r = rebanho(s, [vaca('200', { raca: 'NELORE' })]);
  const id = r.ids['200'];
  hoje(s, '2026-04-01');
  const cria = reg(s, { tipo: 'NASCIMENTO', campos: { event_date: '2026-03-01' }, animais: [{ animal_id: id }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '900' }] }, 'parto');
  const idCria = cria.animais.find((a) => a.brinco === '900').animal_id;
  ok(api(s, 'animal.editar', { animal_id: id, campos: { raca: 'ANGUS' } }), 'ficha da vaca');
  ok(api(s, 'animal.editar', { animal_id: idCria, campos: { raca: 'ANGUS' } }), 'ficha da cria');
  ok(api(s, 'evento.corrigir', { event_id: r.event_id, justificativa: 'Anotação', mudanca: { campos: { notes: 'Conferido' } } }), 'rebanho inicial');
  ok(corrigirSemMudanca(s, cria.event_id), 'parto sem mudança');
  assert.deepEqual([tab(s, 'ANIMAIS', { animal_id: id })[0].raca, tab(s, 'ANIMAIS', { animal_id: idCria })[0].raca], ['ANGUS', 'ANGUS']);
  // A correção que muda a raça do lançamento a leva ao cadastro.
  const novo = tab(s, 'EVENTOS', { reversal_of_event_id: r.event_id })[0].event_id;
  ok(api(s, 'evento.corrigir', { event_id: novo, justificativa: 'A raça', mudanca: { animais: [{ animal_id: id, raca: 'CRUZADO' }] } }), 'a raça');
  assert.equal(tab(s, 'ANIMAIS', { animal_id: id })[0].raca, 'CRUZADO');
  semErro(s, 'raça');
});

test('achado 9: a venda que o servidor dividiu por cabeça (um animal sem pesagem até a data) continua por cabeça na correção depois de uma pesagem retroativa — sem mudança e só da anotação', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, machos(2));
  hoje(s, '2026-05-01');
  reg(s, { tipo: 'PESAGEM', campos: { event_date: '2026-03-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids['100'], peso: 300 }] }, 'pesagem do 100');
  const comprador = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } }), 'parceiro').partner_id;
  const v = reg(s, { tipo: 'VENDA', campos: { event_date: '2026-04-01', partner_id: comprador, finalidade: 'ABATE', modalidade: 'KG_VIVO', preco_unitario: 1000, peso_vivo_total_kg: 450, valor_bruto: 450000 }, animais: [{ animal_id: ids['100'] }, { animal_id: ids['101'] }], parcelas: [{ data_vencimento: '2026-04-01', valor: 450000 }], deducoes: [] }, 'venda');
  const vi = (eid) => tab(s, 'EVENTO_ANIMAIS', { event_id: eid }).map((l) => l.valor_individual);
  assert.deepEqual(vi(v.event_id), [225000, 225000]);
  reg(s, { tipo: 'PESAGEM', campos: { event_date: '2026-03-15', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids['101'], peso: 100 }] }, 'pesagem retroativa do 101');
  const c1 = ok(corrigirSemMudanca(s, v.event_id), 'sem mudança');
  assert.deepEqual(vi(c1.event_id), [225000, 225000], 'continua por cabeça');
  const c2 = ok(api(s, 'evento.corrigir', { event_id: c1.event_id, justificativa: 'Anotação', mudanca: { campos: { notes: 'Conferido' } } }), 'anotação');
  assert.deepEqual(vi(c2.event_id), [225000, 225000]);
  semErro(s, 'venda');
});

test('achado 10: as cópias congeladas leem a marca do digitado — apagar na correção a dose, o pasto, a raça ou a carência digitados os refaz como no registro (pelo peso, pela mãe, pelo produto); o fabricante digitado vem na entrada', () => {
  // (a) A dose digitada do 101 (10; pelo peso seria 8).
  const { s, ids, p } = vermifugacaoTres();
  const v = reg(s, { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: { event_date: '2026-03-12', produto_id: p.product_id, modo_dose: 'POR_PESO', dose_referencia: 0.02 }, animais: [{ animal_id: ids['100'] }, { animal_id: ids['101'], dose: 10 }] }, 'aplicação com a dose digitada');
  const c = ok(api(s, 'evento.corrigir', { event_id: v.event_id, justificativa: 'Pelo peso', mudanca: { animais: [{ animal_id: ids['101'], dose: null }] } }), 'apagar a dose');
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: c.event_id }).map((x) => x.dose), [6, 8], 'a dose apagada é a do peso');
  assert.deepEqual(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: c.event_id }).map((x) => x.quantidade), [14]);
  // (b) O parto com o pasto B e a raça ANGUS digitados (a mãe no A, NELORE).
  const s2 = S.sistema();
  hoje(s2, '2026-01-05');
  const r2 = rebanho(s2, [vaca('V1', { raca: 'NELORE' })]);
  hoje(s2, '2026-04-01');
  const parto = reg(s2, { tipo: 'NASCIMENTO', campos: { event_date: '2026-03-01', pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: r2.ids.V1 }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '900', raca: 'ANGUS' }] }, 'parto');
  const cria = parto.animais.find((a) => a.brinco === '900').animal_id;
  const p1 = ok(api(s2, 'evento.corrigir', { event_id: parto.event_id, justificativa: 'O pasto da mãe', mudanca: { campos: { pasto_destino_id: null } } }), 'apagar o pasto');
  assert.equal(tab(s2, 'EVENTO_ANIMAIS', { event_id: p1.event_id, animal_id: cria })[0].pasto_destino_id, S.PASTOS.A, 'o pasto apagado é o da mãe');
  const o = ok(api(s2, 'evento.obter', { event_id: p1.event_id }), 'obter');
  const crias = o.correcao.crias.map((x) => (x.raca === 'ANGUS' ? Object.assign({}, x, { raca: null }) : x));
  const p2 = ok(api(s2, 'evento.corrigir', { event_id: p1.event_id, justificativa: 'A raça da mãe', mudanca: { crias } }), 'apagar a raça');
  assert.equal(tab(s2, 'EVENTO_ANIMAIS', { event_id: p2.event_id, animal_id: cria })[0].atributos_iniciais_json.raca, 'NELORE', 'a raça apagada é a da mãe');
  // (c) A carência de 10 dias e o fabricante digitados (o produto tem 30 dias).
  const s3 = S.sistema();
  hoje(s3, '2026-01-05');
  const r3 = rebanho(s3, machos(1));
  hoje(s3, '2026-04-10');
  const vac = ok(api(s3, 'produto.salvar', { campos: { nome: 'Vacina X', categoria: 'VACINA', unidade: 'dose', controla_estoque: false, carencia_padrao_dias: 30 } }), 'produto');
  const a = reg(s3, { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-04-01', produto_id: vac.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1, periodo_carencia_dias: 10, fabricante: 'Lab X' }, animais: [{ animal_id: r3.ids['100'] }] }, 'vacina');
  const ent = ok(api(s3, 'evento.obter', { event_id: a.event_id }), 'obter').correcao.campos;
  assert.deepEqual([ent.periodo_carencia_dias, ent.fabricante], [10, 'Lab X'], 'os digitados vêm na entrada');
  const a2 = ok(api(s3, 'evento.corrigir', { event_id: a.event_id, justificativa: 'A carência do produto', mudanca: { campos: { periodo_carencia_dias: null } } }), 'apagar a carência');
  const r0 = tab(s3, 'SANIDADE', { event_id: a2.event_id })[0];
  assert.deepEqual([r0.periodo_carencia_dias, r0.data_fim_carencia, r0.fabricante], [30, '2026-05-01', 'Lab X']);
  // A carência copiada do produto vem vazia na entrada e acompanha o produto da correção.
  const a3 = reg(s3, { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-04-02', produto_id: vac.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 }, animais: [{ animal_id: r3.ids['100'] }] }, 'vacina pelo padrão');
  assert.equal(ok(api(s3, 'evento.obter', { event_id: a3.event_id }), 'obter').correcao.campos.periodo_carencia_dias, undefined, 'a copiada vem vazia');
  const outra = ok(api(s3, 'produto.salvar', { campos: { nome: 'Vacina Y', categoria: 'VACINA', unidade: 'dose', controla_estoque: false, carencia_padrao_dias: 60 } }), 'outro produto');
  const a4 = ok(api(s3, 'evento.corrigir', { event_id: a3.event_id, justificativa: 'Outro produto', mudanca: { campos: { produto_id: outra.product_id } } }), 'outro produto');
  assert.equal(tab(s3, 'SANIDADE', { event_id: a4.event_id })[0].periodo_carencia_dias, 60, 'a padrão do produto novo');
  semErro(s, 'dose'); semErro(s2, 'parto'); semErro(s3, 'carência');
});

// ------------------------------------------------------------------ MÉDIA e BAIXA ----

test('achado 11: o pasto informado da desmama dos bezerros que já estavam nele e o do parto só de natimorto vêm na entrada da correção — a correção da data da desmama e a do natimorto que vira cria viva não põem o animal em outro pasto', () => {
  const s = S.sistema();
  hoje(s, '2026-01-02');
  const { ids } = rebanho(s, [vaca('200'), vaca('201')]);
  hoje(s, '2026-09-01');
  const cria = reg(s, { tipo: 'NASCIMENTO', campos: { event_date: '2026-01-10' }, animais: [{ animal_id: ids['200'] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: '900' }] }, 'parto').animais.find((a) => a.brinco === '900').animal_id;
  reg(s, { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-07-15', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: ids['200'] }, { animal_id: cria }] }, 'transferência');
  const d = reg(s, { tipo: 'DESMAMA', campos: { event_date: '2026-08-01', pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: cria }] }, 'desmama');
  assert.equal(ok(api(s, 'evento.obter', { event_id: d.event_id }), 'obter').correcao.campos.pasto_destino_id, S.PASTOS.B);
  const c = api(s, 'evento.corrigir', { event_id: d.event_id, justificativa: 'A data', mudanca: { campos: { event_date: '2026-07-10' } } });
  assert.equal(c.ok, false, 'em 10/07 o bezerro ia do A para o B: a transferência de 15/07 a partir do A seria conflito');
  assert.equal(c.error.code, 'CONFLICT');
  // O parto só de natimorto com o pasto B (a mãe no A).
  const nat = reg(s, { tipo: 'NASCIMENTO', campos: { event_date: '2026-02-01', pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: ids['201'] }], crias: [{ situacao_nascimento: 'NATIMORTO' }] }, 'natimorto');
  const ent = ok(api(s, 'evento.obter', { event_id: nat.event_id }), 'obter').correcao;
  assert.equal(ent.campos.pasto_destino_id, S.PASTOS.B, 'o pasto digitado vem na entrada');
  const v = ok(api(s, 'evento.corrigir', { event_id: nat.event_id, justificativa: 'Nasceu viva', mudanca: { crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '901' }] } }), 'viva');
  assert.equal(tab(s, 'EVENTO_ANIMAIS', { event_id: v.event_id, papel: 'CRIA' })[0].pasto_destino_id, S.PASTOS.B, 'a cria vai para o pasto digitado');
  semErro(s, 'pastos informados');
});

test('achado 12: na correção de cadastro que apagou o pai, a certeza apagada junto não vem na entrada como dado digitado, e tirá-la pela mudança é recusado com o porquê (antes: aceito sem efeito)', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, [S.bicho({ brinco: '100', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA' }), S.bicho({ brinco: '300', sexo: 'M', castrado: true, data_nascimento: '2024-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-04-01');
  const cad = (animais, onde) => reg(s, { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-03-01', justificativa: 'Conferido' }, animais }, onde);
  cad([{ animal_id: ids['300'], campo: 'pai_id', valor_novo: ids['100'] }, { animal_id: ids['300'], campo: 'pai_confianca', valor_novo: 'ESTIMADA' }], 'o pai');
  hoje(s, '2026-04-02');
  const r = reg(s, { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-04-02', justificativa: 'Sem pai' }, animais: [{ animal_id: ids['300'], campo: 'pai_id', valor_novo: '' }] }, 'apagar o pai');
  assert.deepEqual(tab(s, 'AJUSTES', { event_id: r.event_id }).map((a) => a.campo).sort(), ['pai_confianca', 'pai_id'], 'a certeza apagada junto');
  const ent = ok(api(s, 'evento.obter', { event_id: r.event_id }), 'obter').correcao.animais;
  assert.deepEqual(ent.map((x) => x.campo), ['pai_id'], 'só o dado digitado');
  const t = api(s, 'evento.corrigir', { event_id: r.event_id, justificativa: 'Tirar a certeza', mudanca: { animais: [{ animal_id: ids['300'], campo: 'pai_confianca', remover: true }] } });
  assert.equal(t.ok, false, 'a mudança não faria nada');
  assert.deepEqual(t.error.details.map((d) => d.codigo), ['MUDANCA_SEM_ITEM']);
  assert.match(t.error.details[0].mensagem, /certeza do pai sai junto com o pai/);
  ok(corrigirSemMudanca(s, r.event_id), 'a correção sem mudança continua aceita');
  semErro(s, 'certeza');
});

test('achado 13: a correção que digita a próxima aplicação mantém o intervalo congelado do protocolo; a seguinte, que volta à proposta, usa o do original e não o de hoje', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, machos(1));
  hoje(s, '2026-04-01');
  const vac = ok(api(s, 'produto.salvar', { campos: { nome: 'Aftosa', categoria: 'VACINA', unidade: 'dose', controla_estoque: false } }), 'produto');
  const prot = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Aftosa 90 dias', tipo_procedimento: 'VACINA', product_id: vac.product_id, sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 90 } }), 'protocolo');
  const a = reg(s, { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-03-01', produto_id: vac.product_id, protocol_id: prot.protocol_id, modo_dose: 'POR_CABECA', dose_referencia: 1 }, animais: [{ animal_id: ids['100'] }] }, 'vacina');
  const prox = (eid) => tab(s, 'SANIDADE', { event_id: eid })[0].data_proxima_aplicacao;
  assert.equal(prox(a.event_id), '2026-05-30');
  ok(api(s, 'protocolo.salvar', { protocol_id: prot.protocol_id, campos: { intervalo_dias: 30 }, justificativa: 'Novo calendário' }), 'intervalo de hoje');
  const c1 = ok(api(s, 'evento.corrigir', { event_id: a.event_id, justificativa: 'A data marcada', mudanca: { campos: { data_proxima_aplicacao: '2026-06-15' } } }), 'digitada');
  assert.equal(prox(c1.event_id), '2026-06-15');
  const c2 = ok(api(s, 'evento.corrigir', { event_id: c1.event_id, justificativa: 'Volta à proposta', mudanca: { campos: { data_proxima_aplicacao: null } } }), 'proposta');
  assert.equal(prox(c2.event_id), '2026-05-30', '01/03 + 90 (o intervalo do original)');
  semErro(s, 'intervalo');
});

test('achado 17: a correção de cadastro que deixa o pai e apaga só a certeza é recusada em português do pecuarista, com o conselho que leva à solução (sem o nome da coluna)', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, [S.bicho({ brinco: '100', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA' }), S.bicho({ brinco: '300', sexo: 'M', castrado: true, data_nascimento: '2024-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-04-01');
  reg(s, { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-03-01', justificativa: 'Conferido' }, animais: [{ animal_id: ids['300'], campo: 'pai_id', valor_novo: ids['100'] }, { animal_id: ids['300'], campo: 'pai_confianca', valor_novo: 'ESTIMADA' }] }, 'o pai');
  const r = api(s, 'evento.registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-03-20', justificativa: 'Sem certeza' }, animais: [{ animal_id: ids['300'], campo: 'pai_confianca', valor_novo: '' }] });
  assert.equal(r.ok, false);
  const m = r.error.details.map((d) => d.mensagem).join(' | ');
  assert.doesNotMatch(m, /pai_confianca|pai_id/, 'sem o nome da coluna: ' + m);
  assert.match(m, /o pai não fica sem a certeza: diga se ele é confirmado ou estimado, ou apague também o pai/);
  const r2 = api(s, 'evento.registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-03-20', justificativa: 'Certeza sem mãe' }, animais: [{ animal_id: ids['300'], campo: 'mae_confianca', valor_novo: 'CONFIRMADA' }] });
  assert.equal(r2.ok, false);
  assert.match(r2.error.details.map((d) => d.mensagem).join(' | '), /a certeza da mãe precisa da mãe: informe a mãe ou deixe a certeza em branco/);
});
