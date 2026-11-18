'use strict';
/**
 * Fase 4, E4.1 e E4.2 (CONTRATOS, seção 56): o lançamento avulso, o plano de contas, a baixa (inteira, parcial, em lote, com
 * juros e desconto, o encontro de contas da venda), o desfazer, o desdobramento, o transporte da baixa na correção (RN-046), o
 * CT-15 inteiro, o fluxo de caixa previsto e realizado numa data (com o saldo inicial informado como observação) e os títulos
 * a pagar e a receber — por todo caminho (registro, retroativo, mesmo dia, simulação, correção, correção do substituto,
 * estorno com e sem parcela paga, estorno da correção), pela api(), com a integridade, a projeção e a identidade das três
 * visões conferidas depois de cada comando.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const TODOS = ['POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'VALOR_DIVERGENTE', 'RATEIO_SEM_PESO', 'CARENCIA_ATIVA'];

function montar() {
  const s = S.sistema();
  hoje(s, '2026-03-20');
  s.api = (rota, dados, av, extra) => S.js(s.gas.exec(() => s.G.api(Object.assign({ rota, dados: dados || {}, idempotencyKey: 'k-' + Math.random(), avisosAceitos: av || TODOS }, extra || {}))));
  s.ok = (rota, dados, av) => { const r = s.api(rota, dados, av); assert.equal(r.ok, true, rota + ': ' + String(JSON.stringify(r.error)).slice(0, 1200)); semErro(s, rota); return r.data; };
  s.falha = (rota, dados, av) => { const v = s.versao(); const r = s.api(rota, dados, av); assert.equal(r.ok, false, rota + ' deveria ser recusado'); assert.equal(s.versao(), v, 'a recusa não grava nada'); return r.error; };
  s.versao = () => Number(s.props()['DATA_VERSION:' + s.banco()] || 0);
  s.conta = (cod) => s.tabela('PLANO_CONTAS').find((x) => x.codigo === cod).conta_id;
  s.parcelas = (fid) => s.tabela('PARCELAS').filter((p) => p.financial_id === fid);
  s.finDo = (eid) => s.tabela('FINANCEIRO').filter((f) => f.event_id === eid);
  return s;
}
function hoje(s, d) { s.gas.clock.now = Date.parse(d + 'T15:00:00.000Z'); }
function semErro(s, onde) {
  const rel = s.integridade();
  assert.deepEqual(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3), [], 'integridade sem erro: ' + onde);
  s.conferirProjecoes(onde);
}
const codigos = (e) => (e.details || []).map((d) => d.codigo);
function avulso(s, campos, parcelas) {
  return { tipo: 'LANCAMENTO_FINANCEIRO', campos: Object.assign({ event_date: '2026-03-01', conta_id: s.conta('COMBUSTIVEL'), valor: 90000 }, campos || {}), parcelas: parcelas || [{ data_vencimento: '2026-03-15' }] };
}

// ------------------------------------------------------------------ o lançamento avulso ----
test('avulso: despesa com parcelas, a receita já recebida no ato, o arrendamento com pasto e período, o vínculo à categoria e ao registro; retroativo e no mesmo dia', () => {
  const s = montar();
  const r1 = s.ok('evento.registrar', avulso(s, { descricao: 'Diesel', quantidade: 150 }, [{ data_vencimento: '2026-03-15' }, { data_vencimento: '2026-04-15' }, { data_vencimento: '2026-05-15' }]));
  const f1 = s.finDo(r1.event_id)[0];
  assert.deepEqual([f1.natureza, f1.tipo, f1.valor, f1.data_competencia, f1.quantidade, f1.status_pagamento, f1.descricao], ['CUSTEIO', 'DESPESA', 90000, '2026-03-01', 150, 'ABERTO', 'Diesel']);
  assert.deepEqual(s.parcelas(f1.financial_id).map((p) => [p.valor, p.status]), [[30000, 'ABERTA'], [30000, 'ABERTA'], [30000, 'ABERTA']]);
  assert.equal(s.tabela('EVENTOS').find((e) => e.event_id === r1.event_id).total_value, 90000);
  // A receita recebida no ato: a parcela nasce paga, pelo nominal (03b, seção 11, "Estado inicial").
  const r2 = s.ok('evento.registrar', avulso(s, { event_date: '2026-03-01', conta_id: s.conta('RECEITAS_EXTRAORDINARIAS'), valor: 150000, descricao: 'Venda da carroça' }, [{ data_vencimento: '2026-03-01', pago_em: '2026-03-02', forma_pagamento: 'PIX' }]));
  const p2 = s.parcelas(s.finDo(r2.event_id)[0].financial_id)[0];
  assert.deepEqual([p2.status, p2.data_pagamento, p2.valor_pago, p2.juros_multa, p2.desconto, s.finDo(r2.event_id)[0].status_pagamento], ['LIQUIDADA', '2026-03-02', 150000, null, null, 'LIQUIDADO']);
  // O arrendamento: pasto e período obrigatórios; o resultado de cada mês recebe a parte dos dias (07, seção 1.1).
  const sem = s.falha('evento.registrar', avulso(s, { conta_id: s.conta('ARRENDAMENTO_PASTO'), valor: 60000 }));
  assert.deepEqual(codigos(sem).sort(), ['CAMPO_OBRIGATORIO', 'CAMPO_OBRIGATORIO']);
  const r3 = s.ok('evento.registrar', avulso(s, { event_date: '2026-02-01', conta_id: s.conta('ARRENDAMENTO_PASTO'), valor: 60000, pasture_id: S.PASTOS.B, competencia_inicio: '2026-02-01', competencia_fim: '2026-04-30', categoria_animal_id: s.tabela('CATEGORIAS')[0].category_id, ref_event_id: r1.event_id }, [{ data_vencimento: '2026-02-05' }]));
  const f3 = s.finDo(r3.event_id)[0];
  assert.deepEqual([f3.pasture_id, f3.competencia_inicio, f3.competencia_fim, f3.ref_event_id], [S.PASTOS.B, '2026-02-01', '2026-04-30', r1.event_id]);
  const conc = s.ok('financeiro.conciliacao', { ate: '2026-03-20' });
  assert.equal(conc.fecha, true);
  const mes = (m) => conc.meses.find((x) => x.mes === m).resultado.custeio;
  // 600,00 em 89 dias: fevereiro 28, março 31, abril 30 (maior resto; o empate vai para o mais antigo).
  assert.equal(mes('2026-02'), 18876);
  // Retroativo (antes do que já está gravado) e no mesmo dia: entram nos números das datas que alcançam.
  s.ok('evento.registrar', avulso(s, { event_date: '2026-01-10', conta_id: s.conta('ENERGIA'), valor: 12345 }, [{ data_vencimento: '2026-01-20', pago_em: '2026-01-20' }]));
  s.ok('evento.registrar', avulso(s, { event_date: '2026-03-01', conta_id: s.conta('ENERGIA'), valor: 100 }, [{ data_vencimento: '2026-03-01' }]));
  const c2 = s.ok('financeiro.conciliacao', { ate: '2026-01-31' });
  assert.equal(c2.periodo.caixa.liquido, -12345);
});

test('avulso: as naturezas que nascem nos próprios eventos, o período fora de custeio e outra receita ou antes da data, e o pagamento antes da competência ou no futuro são recusados com o caminho', () => {
  const s = montar();
  const nat = (cod) => s.falha('evento.registrar', avulso(s, { conta_id: s.conta(cod) }));
  assert.match(nat('COMPRA_ANIMAIS').message, /Comprar animais/);
  assert.match(nat('VENDA_ANIMAIS').message, /Vender animais/);
  assert.match(nat('FRETE_VENDA').message, /dedução/);
  assert.match(nat('COMPRA_INSUMOS').message, /entrada de estoque/);
  assert.match(nat('SALDO_ABERTURA_REBANHO').message, /Comprar animais/);
  assert.deepEqual(codigos(s.falha('evento.registrar', avulso(s, { conta_id: s.conta('APORTES'), competencia_inicio: '2026-03-01', competencia_fim: '2026-03-31' }))), ['CAMPO_NAO_SE_APLICA']);
  assert.deepEqual(codigos(s.falha('evento.registrar', avulso(s, { competencia_inicio: '2026-02-01', competencia_fim: '2026-03-31' }))), ['PERIODO_ANTES_DA_DATA']);
  assert.deepEqual(codigos(s.falha('evento.registrar', avulso(s, { competencia_inicio: '2026-03-10', competencia_fim: '2026-03-02' }))), ['PERIODO_INVERTIDO']);
  assert.deepEqual(codigos(s.falha('evento.registrar', avulso(s, {}, [{ data_vencimento: '2026-03-01', pago_em: '2026-02-28' }]))), ['PAGAMENTO_ANTES_DA_COMPETENCIA']);
  assert.deepEqual(codigos(s.falha('evento.registrar', avulso(s, {}, [{ data_vencimento: '2026-03-01', pago_em: '2026-03-21' }]))), ['DATA_FUTURA']);
  assert.deepEqual(codigos(s.falha('evento.registrar', avulso(s, {}, []))), ['SEM_PARCELAS']);
  assert.deepEqual(codigos(s.falha('evento.registrar', avulso(s, {}, [{ data_vencimento: '2026-03-01', valor: 1 }]))), ['PARCELAS_NAO_SOMAM']);
  assert.deepEqual(codigos(s.falha('evento.registrar', Object.assign(avulso(s), { animais: [{ animal_id: 'x' }] }))), ['CAMPO_NAO_SE_APLICA']);
  // A simulação usa o mesmo tratador: as mesmas recusas e os mesmos impactos, sem gravar.
  const sim = s.ok('evento.simular', { acao: 'registrar', dados: avulso(s, { valor: 1000 }, [{ data_vencimento: '2026-03-01' }, { data_vencimento: '2026-04-01' }]) });
  assert.deepEqual(sim.impactos.financeiro.lancamentos[0].parcelas.map((p) => p.valor), [500, 500]);
  assert.equal(s.tabela('FINANCEIRO').length, 0);
});

test('avulso: correção sem mudança grava os mesmos fatos (também com a conta, o pasto e a categoria desativados depois); a parcela paga vai junto (RN-046); mudar o valor dela é recusado; estorno, estorno da correção e o substituto do substituto', () => {
  const s = montar();
  const cat = s.tabela('CATEGORIAS')[0].category_id;
  const r = s.ok('evento.registrar', avulso(s, { conta_id: s.conta('MANUTENCAO_PASTOS'), pasture_id: S.PASTOS.A, categoria_animal_id: cat, descricao: 'Cerca' }, [{ data_vencimento: '2026-03-05', valor: 40000, pago_em: '2026-03-05' }, { data_vencimento: '2026-04-05', valor: 50000 }]));
  s.ok('conta.salvar', { conta_id: s.conta('MANUTENCAO_PASTOS'), campos: { ativo: false, nome: 'Cercas e pastos' } });
  const fatos = (eid) => s.finDo(eid).map((f) => [f.conta_id, f.valor, f.pasture_id, f.categoria_animal_id, f.descricao, f.data_competencia]).concat(s.parcelas(s.finDo(eid)[0].financial_id).map((p) => [p.parcela_num, p.data_vencimento, p.valor, p.status, p.data_pagamento || null, p.valor_pago || null]));
  const antes = fatos(r.event_id);
  const c1 = s.ok('evento.corrigir', { event_id: r.event_id, justificativa: 'Só a anotação', mudanca: { campos: { notes: 'conferido' } } });
  assert.deepEqual(fatos(c1.event_id), antes, 'a correção sem mudança grava os mesmos fatos, com a baixa transportada');
  const novaConta = s.conta('OUTROS_GASTOS');
  assert.deepEqual(codigos(s.falha('evento.registrar', avulso(s, { conta_id: s.conta('MANUTENCAO_PASTOS') }))), ['CONTA_INATIVA']);
  // Mudar o valor da parcela paga: recusado (desfaça a baixa antes); mudar a conta e a outra parcela: aceito, com a baixa.
  const e = s.falha('evento.corrigir', { event_id: c1.event_id, justificativa: 'Valor', mudanca: { parcelas: [{ data_vencimento: '2026-03-05', valor: 45000 }, { data_vencimento: '2026-04-05', valor: 45000 }] } });
  assert.equal(e.code, 'CONFLICT');
  assert.deepEqual(codigos(e), ['PARCELA_LIQUIDADA']);
  const c2 = s.ok('evento.corrigir', { event_id: c1.event_id, justificativa: 'Conta', mudanca: { campos: { conta_id: novaConta }, parcelas: [{ data_vencimento: '2026-03-05', valor: 40000 }, { data_vencimento: '2026-05-05', valor: 50000 }] } });
  assert.deepEqual(s.parcelas(s.finDo(c2.event_id)[0].financial_id).map((p) => [p.data_vencimento, p.status, p.data_pagamento || null]), [['2026-03-05', 'LIQUIDADA', '2026-03-05'], ['2026-05-05', 'ABERTA', null]]);
  // Levar a data para depois do pagamento: recusado (a baixa ficaria antes da competência).
  assert.deepEqual(codigos(s.falha('evento.corrigir', { event_id: c2.event_id, justificativa: 'Data', mudanca: { campos: { event_date: '2026-03-10' } } })), ['PAGAMENTO_ANTES_DA_COMPETENCIA']);
  // Estorno com parcela paga: CONFLICT; desfeita a baixa, o estorno da correção vale.
  assert.deepEqual(codigos(s.falha('evento.estornar', { event_id: c2.event_id, justificativa: 'Errado' })), ['PARCELA_LIQUIDADA']);
  const paga = s.parcelas(s.finDo(c2.event_id)[0].financial_id).find((p) => p.status === 'LIQUIDADA');
  s.ok('parcela.desfazerBaixa', { parcela_id: paga.parcela_id, justificativa: 'Lançada em duplicidade' });
  s.ok('evento.estornar', { event_id: c2.event_id, justificativa: 'Errado' });
  assert.equal(s.tabela('FINANCEIRO').filter((f) => f.status === 'ATIVO').length, 0);
});

test('avulso: a correção com o mesmo pedido, com duas parcelas iguais (o mesmo valor e vencimento) e só uma paga no ato, casa a baixa com a parcela paga do pedido e grava os mesmos fatos', () => {
  const s = montar();
  const pedido = avulso(s, { event_date: '2026-03-03', valor: 45000 }, [{ data_vencimento: '2026-06-01' }, { data_vencimento: '2026-03-03', pago_em: '2026-03-10' }, { data_vencimento: '2026-06-01', pago_em: '2026-03-03' }]);
  const r = s.ok('evento.registrar', pedido);
  const fatos = (eid) => s.parcelas(s.finDo(eid)[0].financial_id).map((p) => [p.data_vencimento, p.valor, p.status, p.data_pagamento || null]).sort();
  const antes = fatos(r.event_id);
  assert.deepEqual(antes, [['2026-03-03', 15000, 'LIQUIDADA', '2026-03-10'], ['2026-06-01', 15000, 'ABERTA', null], ['2026-06-01', 15000, 'LIQUIDADA', '2026-03-03']]);
  const c = s.ok('evento.corrigir', Object.assign({}, pedido, { event_id: r.event_id, justificativa: 'Conferido de novo' }));
  assert.deepEqual(fatos(c.event_id), antes);
});

test('avulso: duas parcelas iguais, a segunda paga em PIX e a primeira em aberto sem forma; a correção sem mudança pela entrada do servidor leva a baixa para a parcela com a mesma forma e grava os mesmos fatos', () => {
  const s = montar();
  const r = s.ok('evento.registrar', avulso(s, { event_date: '2026-03-03', valor: 30000 }, [{ data_vencimento: '2026-06-01' }, { data_vencimento: '2026-06-01' }]));
  const fatos = (eid) => s.parcelas(s.finDo(eid)[0].financial_id).map((p) => [p.data_vencimento, p.valor, p.status, p.forma_pagamento || null, p.data_pagamento || null]).sort();
  const [, p2] = s.parcelas(s.finDo(r.event_id)[0].financial_id).sort((a, b) => a.parcela_num - b.parcela_num);
  s.ok('parcela.baixar', { parcela_id: p2.parcela_id, data_pagamento: '2026-03-10', forma_pagamento: 'PIX' });
  const antes = fatos(r.event_id);
  assert.deepEqual(antes, [['2026-06-01', 15000, 'ABERTA', null, null], ['2026-06-01', 15000, 'LIQUIDADA', 'PIX', '2026-03-10']]);
  const c = s.ok('evento.corrigir', { event_id: r.event_id, justificativa: 'Só a anotação', mudanca: { campos: { notes: 'conferido' } } });
  assert.deepEqual(fatos(c.event_id), antes);
});

// ------------------------------------------------------------------ plano de contas ----
test('plano de contas: criar com a natureza (código pelo nome, tipo, grupo e classe que ela só permite de um jeito), renomear, reordenar, desativar e reativar; combinação, código e classificação depois do primeiro lançamento conferidos; conta do sistema não se desativa', () => {
  const s = montar();
  const n = s.ok('conta.salvar', { campos: { nome: 'Aluguel de máquinas', natureza: 'CUSTEIO', grupo: 'CUSTO_OPERACIONAL', classe_custo_animal: 'OUTROS' } }).conta;
  assert.deepEqual([n.codigo, n.tipo, n.sistema, n.ativo], ['ALUGUEL_DE_MAQUINAS', 'DESPESA', false, true]);
  const nop = s.ok('conta.salvar', { campos: { nome: 'Amortização', codigo: 'AMORTIZACAO', natureza: 'NAO_OPERACIONAL', tipo: 'DESPESA' } }).conta;
  assert.deepEqual([nop.grupo, nop.classe_custo_animal], ['NAO_OPERACIONAL', 'NAO_SE_APLICA']);
  assert.deepEqual(codigos(s.falha('conta.salvar', { campos: { nome: 'X', natureza: 'CUSTEIO', grupo: 'RECEITA', classe_custo_animal: 'OUTROS' } })), ['COMBINACAO_INVALIDA']);
  assert.deepEqual(codigos(s.falha('conta.salvar', { campos: { nome: 'Outra', codigo: 'AMORTIZACAO', natureza: 'NAO_OPERACIONAL', tipo: 'DESPESA' } })), ['CODIGO_REPETIDO']);
  assert.deepEqual(codigos(s.falha('conta.salvar', { conta_id: n.conta_id, campos: { codigo: 'OUTRO' } })), ['CAMPO_IMUTAVEL']);
  assert.deepEqual(codigos(s.falha('conta.salvar', { conta_id: s.conta('VENDA_ANIMAIS'), campos: { ativo: false } })), ['CONTA_DO_SISTEMA']);
  // Antes do primeiro lançamento, a classificação muda; depois, não.
  s.ok('conta.salvar', { conta_id: n.conta_id, campos: { classe_custo_animal: 'ALIMENTACAO', ordem: 412 } });
  s.ok('evento.registrar', avulso(s, { conta_id: n.conta_id }));
  assert.deepEqual(codigos(s.falha('conta.salvar', { conta_id: n.conta_id, campos: { classe_custo_animal: 'OUTROS' } })), ['CONTA_EM_USO']);
  s.ok('conta.salvar', { conta_id: n.conta_id, campos: { nome: 'Locação de máquinas', ativo: false } });
  s.ok('conta.salvar', { conta_id: n.conta_id, campos: { ativo: true } });
  assert.deepEqual(['nome', 'ordem', 'ativo'].map((k) => s.tabela('PLANO_CONTAS').find((c) => c.conta_id === n.conta_id)[k]), ['Locação de máquinas', 412, true]);
});

// ------------------------------------------------------------------ baixa ----
test('baixa (RN-081): inteira com juros e desconto, o valor pago conferido, a parcela já paga, a data futura e a anterior à competência recusadas; em parte (desdobramento); em lote; desfazer; dividir; e o aviso do período fechado com a justificativa', () => {
  const s = montar();
  const r = s.ok('evento.registrar', avulso(s, { descricao: 'Ração' }, [{ data_vencimento: '2026-03-15' }, { data_vencimento: '2026-04-15' }, { data_vencimento: '2026-05-15' }]));
  const fid = s.finDo(r.event_id)[0].financial_id;
  const [p1, p2, p3] = s.parcelas(fid);
  const sim = s.ok('parcela.simular', { acao: 'baixar', dados: { parcela_id: p1.parcela_id, data_pagamento: '2026-03-16', juros_multa: 450, desconto: 100 } });
  assert.deepEqual([sim.simulacao, sim.impactos.itens[0].valor_pago, sim.impactos.saidas], [true, 30350, 30350]);
  assert.deepEqual(codigos(s.falha('parcela.baixar', { parcela_id: p1.parcela_id, data_pagamento: '2026-03-16', juros_multa: 450, valor_pago: 30000 })), ['VALOR_PAGO_DIVERGENTE']);
  assert.deepEqual(codigos(s.falha('parcela.baixar', { parcela_id: p1.parcela_id, data_pagamento: '2026-03-21' })), ['DATA_FUTURA']);
  assert.deepEqual(codigos(s.falha('parcela.baixar', { parcela_id: p1.parcela_id, data_pagamento: '2026-02-28' })), ['PAGAMENTO_ANTES_DA_COMPETENCIA']);
  assert.deepEqual(codigos(s.falha('parcela.baixar', { parcela_id: p1.parcela_id, data_pagamento: '2026-03-16', desconto: 30000 })), ['VALOR_FORA_DA_FAIXA']);
  s.ok('parcela.baixar', { parcela_id: p1.parcela_id, data_pagamento: '2026-03-16', juros_multa: 450, desconto: 100, forma_pagamento: 'PIX' });
  let x = s.parcelas(fid).find((p) => p.parcela_id === p1.parcela_id);
  assert.deepEqual([x.status, x.data_pagamento, x.valor_pago, x.juros_multa, x.desconto, x.forma_pagamento], ['LIQUIDADA', '2026-03-16', 30350, 450, 100, 'PIX']);
  assert.equal(s.finDo(r.event_id)[0].status_pagamento, 'PARCIAL');
  assert.deepEqual(codigos(s.falha('parcela.baixar', { parcela_id: p1.parcela_id, data_pagamento: '2026-03-16' })), ['PARCELA_JA_PAGA']);
  // Em parte: a parcela vira CANCELADA e nascem a paga e a que resta, com o mesmo vencimento (03b, seção 11).
  s.ok('parcela.baixar', { parcela_id: p2.parcela_id, data_pagamento: '2026-03-18', valor: 10000 });
  const filhas = s.parcelas(fid).filter((p) => p.parcela_origem_id === p2.parcela_id);
  assert.deepEqual(filhas.map((p) => [p.parcela_num, p.data_vencimento, p.valor, p.status]), [[2, '2026-04-15', 10000, 'LIQUIDADA'], [2, '2026-04-15', 20000, 'ABERTA']]);
  assert.equal(s.parcelas(fid).find((p) => p.parcela_id === p2.parcela_id).status, 'CANCELADA');
  // Dividir a que resta em duas (desdobramento): somam o mesmo.
  const resta = filhas.find((p) => p.status === 'ABERTA');
  assert.deepEqual(codigos(s.falha('parcela.desdobrar', { parcela_id: resta.parcela_id, parcelas: [{ data_vencimento: '2026-04-15' }], justificativa: 'x' })), ['VALOR_IGUAL']);
  assert.deepEqual(codigos(s.falha('parcela.desdobrar', { parcela_id: resta.parcela_id, parcelas: [{ data_vencimento: '2026-05-01', valor: 1 }, { data_vencimento: '2026-06-01', valor: 1 }], justificativa: 'x' })), ['PARCELAS_NAO_SOMAM']);
  s.ok('parcela.desdobrar', { parcela_id: resta.parcela_id, parcelas: [{ data_vencimento: '2026-05-01' }, { data_vencimento: '2026-06-01' }], justificativa: 'Renegociado com o fornecedor' });
  assert.deepEqual(s.parcelas(fid).filter((p) => p.parcela_origem_id === resta.parcela_id).map((p) => [p.data_vencimento, p.valor]), [['2026-05-01', 10000], ['2026-06-01', 10000]]);
  // Em lote: a mesma data para várias parcelas, cada uma com o seu valor; nada grava se uma for recusada.
  const abertas = s.parcelas(fid).filter((p) => p.status === 'ABERTA');
  assert.deepEqual(codigos(s.falha('parcela.baixar', { data_pagamento: '2026-03-19', itens: [{ parcela_id: abertas[0].parcela_id }, { parcela_id: p1.parcela_id }] })), ['PARCELA_JA_PAGA']);
  const lote = s.ok('parcela.baixar', { data_pagamento: '2026-03-19', forma_pagamento: 'DINHEIRO', itens: abertas.map((p) => ({ parcela_id: p.parcela_id })) });
  assert.equal(lote.parcelas.length, 3);
  assert.equal(s.finDo(r.event_id)[0].status_pagamento, 'LIQUIDADO');
  // Desfazer: a parcela volta a ficar em aberto, sem os dados da baixa; sem a justificativa, recusado.
  assert.deepEqual(codigos(s.falha('parcela.desfazerBaixa', { parcela_id: p3.parcela_id })), ['CAMPO_OBRIGATORIO']);
  s.ok('parcela.desfazerBaixa', { parcela_id: p3.parcela_id, justificativa: 'Cheque devolvido' });
  x = s.parcelas(fid).find((p) => p.parcela_id === p3.parcela_id);
  assert.deepEqual([x.status, x.data_pagamento, x.valor_pago, x.juros_multa, x.desconto], ['ABERTA', null, null, null, null]);
  // O período fechado (RN-082): a baixa até fin_bloqueio_ate pede o aviso; com ele aceito, a justificativa.
  s.ok('config.salvar', { valores: { fin_bloqueio_ate: '2026-03-17' } });
  const e1 = s.falha('parcela.baixar', { parcela_id: p3.parcela_id, data_pagamento: '2026-03-17' }, []);
  assert.deepEqual([e1.code, codigos(e1)], ['NEEDS_CONFIRMATION', ['PERIODO_BLOQUEADO']]);
  assert.deepEqual(codigos(s.falha('parcela.baixar', { parcela_id: p3.parcela_id, data_pagamento: '2026-03-17' }, ['PERIODO_BLOQUEADO'])), ['CAMPO_OBRIGATORIO']);
  s.ok('parcela.baixar', { parcela_id: p3.parcela_id, data_pagamento: '2026-03-17', justificativa: 'Pago no caixa e lançado depois' }, ['PERIODO_BLOQUEADO']);
  // Desfazer a baixa de dentro do período fechado também pede o aviso.
  assert.equal(s.falha('parcela.desfazerBaixa', { parcela_id: p1.parcela_id, justificativa: 'x' }, []).code, 'NEEDS_CONFIRMATION');
  s.ok('parcela.desfazerBaixa', { parcela_id: p1.parcela_id, justificativa: 'Juros indevidos' }, ['PERIODO_BLOQUEADO']);
  // A baixa depois do período fechado não pede nada.
  s.ok('parcela.baixar', { parcela_id: p1.parcela_id, data_pagamento: '2026-03-20' }, []);
});

test('a correção do evento depois da baixa em parte e do desdobramento: a entrada do servidor traz só as parcelas que valem e a correção sem mudança grava os mesmos títulos, com a baixa; o título em parcelas iguais (o frete da compra) só se baixa inteiro e não se divide', () => {
  const s = montar();
  hoje(s, '2026-06-20');
  const f = s.ok('parceiro.salvar', { campos: { nome: 'Fornecedor', tipos: ['FORNECEDOR'] } }).partner_id;
  const tr = s.ok('parceiro.salvar', { campos: { nome: 'Frete Rápido', tipos: ['TRANSPORTADOR'] } }).partner_id;
  const garrote = (b) => ({ brinco: b, sexo: 'M', data_nascimento: '2024-06-01', data_nascimento_confianca: 'ESTIMADA', castrado: true, reprodutor: false });
  const r = s.ok('evento.registrar', {
    tipo: 'COMPRA', campos: { event_date: '2026-06-13', partner_id: f, pasto_destino_id: S.PASTOS.A, modalidade: 'CABECA', preco_unitario: 100000, valor_animais: 200000 },
    animais: [garrote('1'), garrote('2')], parcelas: [{ data_vencimento: '2026-06-14' }, { data_vencimento: '2026-07-14' }, { data_vencimento: '2026-08-14' }],
    custos: [{ tipo: 'FRETE', valor: 6000, partner_id: tr, parcelas_qtd: 2 }],
  });
  let atual = r.event_id;
  const principal = () => s.finDo(atual).find((x) => x.valor === 200000);
  const ps = s.parcelas(principal().financial_id).sort((a, b) => a.parcela_num - b.parcela_num);
  s.ok('parcela.baixar', { parcela_id: ps[1].parcela_id, data_pagamento: '2026-06-15', valor: 10000 });
  const resta = s.parcelas(principal().financial_id).find((p) => p.parcela_origem_id === ps[1].parcela_id && p.status === 'ABERTA');
  s.ok('parcela.desdobrar', { parcela_id: resta.parcela_id, parcelas: [{ data_vencimento: '2026-07-14' }, { data_vencimento: '2026-09-14' }], justificativa: 'Renegociado' });
  const entrada = s.ok('evento.obter', { event_id: r.event_id }).correcao;
  // Na ordem do número da parcela; as que nasceram da mesma têm o número dela (o vencimento e o valor desempatam).
  assert.deepEqual(entrada.parcelas.map((p) => [p.data_vencimento, p.valor]), [['2026-06-14', 66667], ['2026-07-14', 28334], ['2026-07-14', 10000], ['2026-09-14', 28333], ['2026-08-14', 66666]]);
  const titulos = (fid) => s.parcelas(fid).filter((p) => p.status !== 'CANCELADA').map((p) => [p.data_vencimento, p.valor, p.status, p.data_pagamento || null]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : b[1] - a[1]));
  const antes = titulos(principal().financial_id);
  assert.equal(antes.reduce((t, p) => t + p[1], 0), 200000);
  assert.equal(entrada.parcelas.reduce((t, p) => t + p.valor, 0), 200000, 'a entrada não traz a parcela dividida (CANCELADA)');
  const c = s.ok('evento.corrigir', { event_id: r.event_id, justificativa: 'Só a anotação', mudanca: { campos: { notes: 'conferido' } } });
  atual = c.event_id;
  assert.deepEqual(titulos(principal().financial_id), antes, 'os mesmos títulos, com a baixa transportada');
  // O frete (2 parcelas iguais de mês em mês): a baixa é inteira; em parte ou dividida, recusada com o caminho.
  const frete = s.finDo(c.event_id).find((x) => x.valor === 6000);
  const [q1] = s.parcelas(frete.financial_id).sort((a, b) => a.parcela_num - b.parcela_num);
  assert.deepEqual(codigos(s.falha('parcela.baixar', { parcela_id: q1.parcela_id, data_pagamento: '2026-06-16', valor: 1000 })), ['TITULO_EM_PARTES_IGUAIS']);
  assert.deepEqual(codigos(s.falha('parcela.desdobrar', { parcela_id: q1.parcela_id, quantas: 2, primeiro: '2026-07-01', justificativa: 'x' })), ['TITULO_EM_PARTES_IGUAIS']);
  const it = s.ok('financeiro.titulos', { situacao: 'ABERTOS' }).itens.find((x) => x.parcela_id === q1.parcela_id);
  assert.deepEqual([it.acoes.baixar, it.acoes.parcial, it.acoes.dividir], [true, false, false]);
  assert.deepEqual([s.ok('financeiro.lancamento', { financial_id: frete.financial_id }).parcelas_livres, s.ok('financeiro.lancamento', { financial_id: principal().financial_id }).parcelas_livres], [false, true]);
  s.ok('parcela.baixar', { parcela_id: q1.parcela_id, data_pagamento: '2026-06-16' });
  atual = s.ok('evento.corrigir', { event_id: c.event_id, justificativa: 'De novo', mudanca: { campos: { notes: 'conferido de novo' } } }).event_id;
  assert.deepEqual(titulos(principal().financial_id), antes);
  assert.equal(s.parcelas(s.finDo(atual).find((x) => x.valor === 6000).financial_id).filter((p) => p.status === 'LIQUIDADA').length, 1, 'a baixa do frete também vai junto');
});

test('título em parcelas iguais (o frete da compra): a forma da baixa fica só na parcela paga; desfeita a baixa, a parcela volta com a forma prevista das outras em aberto; a correção sem mudança grava as mesmas parcelas antes e depois', () => {
  const s = montar();
  hoje(s, '2026-06-20');
  const f = s.ok('parceiro.salvar', { campos: { nome: 'Fornecedor', tipos: ['FORNECEDOR'] } }).partner_id;
  const tr = s.ok('parceiro.salvar', { campos: { nome: 'Frete Rápido', tipos: ['TRANSPORTADOR'] } }).partner_id;
  const r = s.ok('evento.registrar', {
    tipo: 'COMPRA', campos: { event_date: '2026-06-01', partner_id: f, pasto_destino_id: S.PASTOS.A, modalidade: 'CABECA', preco_unitario: 100000, valor_animais: 100000 },
    animais: [{ brinco: '7', sexo: 'M', data_nascimento: '2024-06-01', data_nascimento_confianca: 'ESTIMADA', castrado: true, reprodutor: false }],
    parcelas: [{ data_vencimento: '2026-07-01' }], custos: [{ tipo: 'FRETE', valor: 6000, partner_id: tr, parcelas_qtd: 3 }],
  });
  let atual = r.event_id;
  const frete = () => s.finDo(atual).find((x) => x.valor === 6000);
  const fatos = () => s.parcelas(frete().financial_id).filter((p) => p.status !== 'CANCELADA').sort((a, b) => a.parcela_num - b.parcela_num).map((p) => [p.parcela_num, p.status, p.forma_pagamento || null, p.data_pagamento || null]);
  const corrigir = (nota) => { atual = s.ok('evento.corrigir', { event_id: atual, justificativa: 'Conferido', mudanca: { campos: { notes: nota } } }).event_id; };
  const [q1] = s.parcelas(frete().financial_id).sort((a, b) => a.parcela_num - b.parcela_num);
  s.ok('parcela.baixar', { parcela_id: q1.parcela_id, data_pagamento: '2026-06-10', forma_pagamento: 'DINHEIRO' });
  const pago = fatos();
  assert.deepEqual(pago, [[1, 'LIQUIDADA', 'DINHEIRO', '2026-06-10'], [2, 'ABERTA', null, null], [3, 'ABERTA', null, null]]);
  corrigir('um');
  assert.deepEqual(fatos(), pago, 'a forma da baixa não passa para as parcelas em aberto');
  const paga = s.parcelas(frete().financial_id).find((p) => p.status === 'LIQUIDADA');
  s.ok('parcela.desfazerBaixa', { parcela_id: paga.parcela_id, justificativa: 'Pago errado' });
  assert.deepEqual(fatos(), [[1, 'ABERTA', null, null], [2, 'ABERTA', null, null], [3, 'ABERTA', null, null]], 'a parcela volta com a forma prevista das outras');
  const aberto = fatos();
  corrigir('dois');
  assert.deepEqual(fatos(), aberto);
});

test('encontro de contas da venda: a baixa do recebimento quita junto a dedução descontada pelo comprador (o depósito esperado); a retida não se baixa nem se desfaz sozinha, e o recebimento com ela não se baixa em parte nem se divide', () => {
  const s = montar();
  hoje(s, '2026-01-10');
  const ent = s.ok('evento.registrar', S.entradaInicial([S.bicho({ brinco: '1' }), S.bicho({ brinco: '2' })]));
  hoje(s, '2026-03-20');
  const frig = s.ok('parceiro.salvar', { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } }).partner_id;
  const v = s.ok('evento.registrar', {
    tipo: 'VENDA', campos: { event_date: '2026-03-10', partner_id: frig, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 100000, valor_bruto: 200000 },
    animais: ent.animais.map((a) => ({ animal_id: a.animal_id })), parcelas: [{ data_vencimento: '2026-03-15' }], deducoes: [{ tipo: 'FUNRURAL', valor: 3000, retida_pelo_comprador: true }],
  });
  const fins = s.finDo(v.event_id);
  const rec = fins.find((f) => f.natureza === 'RECEITA_VENDA_ANIMAIS');
  const ded = fins.find((f) => f.retida_pelo_comprador === true);
  const pr = s.parcelas(rec.financial_id)[0];
  const pd = s.parcelas(ded.financial_id)[0];
  const tit = s.ok('financeiro.titulos', { tipo: 'RECEITA' }).itens[0];
  assert.deepEqual([tit.valor, tit.deducoes_retidas, tit.deposito_esperado, tit.acoes.parcial, tit.acoes.dividir], [200000, 3000, 197000, false, false]);
  assert.deepEqual(codigos(s.falha('parcela.baixar', { parcela_id: pd.parcela_id, data_pagamento: '2026-03-15' })), ['PARCELA_RETIDA']);
  assert.deepEqual(codigos(s.falha('parcela.baixar', { parcela_id: pr.parcela_id, data_pagamento: '2026-03-15', valor: 100000 })), ['BAIXA_PARCIAL_COM_RETENCAO']);
  assert.deepEqual(codigos(s.falha('parcela.desdobrar', { parcela_id: pr.parcela_id, parcelas: [{ data_vencimento: '2026-03-20' }], justificativa: 'x' })), ['PARCELA_RETIDA']);
  const b = s.ok('parcela.simular', { acao: 'baixar', dados: { parcela_id: pr.parcela_id, data_pagamento: '2026-03-15' } });
  assert.deepEqual([b.impactos.itens[0].deposito, b.impactos.liquido], [197000, 197000]);
  s.ok('parcela.baixar', { parcela_id: pr.parcela_id, data_pagamento: '2026-03-15', forma_pagamento: 'TRANSFERENCIA' });
  const q = s.parcelas(ded.financial_id)[0];
  assert.deepEqual([q.status, q.data_pagamento, q.valor_pago, q.forma_pagamento], ['LIQUIDADA', '2026-03-15', 3000, 'TRANSFERENCIA']);
  assert.equal(s.ok('financeiro.fluxoCaixa', { agrupar: 'MES' }).realizado.liquido, 197000, 'o caixa recebe o depósito, já líquido da retenção');
  assert.deepEqual(codigos(s.falha('parcela.desfazerBaixa', { parcela_id: pd.parcela_id, justificativa: 'x' })), ['PARCELA_RETIDA']);
  s.ok('parcela.desfazerBaixa', { parcela_id: pr.parcela_id, justificativa: 'Depósito estornado pelo banco' });
  assert.equal(s.parcelas(ded.financial_id)[0].status, 'ABERTA', 'a retida volta junto');
  // A correção da venda sem mudança mantém o recebimento e a dedução pagos (o transporte das duas baixas).
  s.ok('parcela.baixar', { parcela_id: pr.parcela_id, data_pagamento: '2026-03-16' });
  const c = s.ok('evento.corrigir', { event_id: v.event_id, justificativa: 'Nota', mudanca: { campos: { nota_fiscal: '123' } } });
  assert.deepEqual(s.finDo(c.event_id).map((f) => [f.natureza, s.parcelas(f.financial_id)[0].status, s.parcelas(f.financial_id)[0].data_pagamento]).sort(), [['DESPESA_VENDA', 'LIQUIDADA', '2026-03-16'], ['RECEITA_VENDA_ANIMAIS', 'LIQUIDADA', '2026-03-16']]);
});

// ------------------------------------------------------------------ CT-15 ----
test('CT-15 (09, seção 3; RN-042, RN-046, RN-081): compra em 2 parcelas e frete de 30,00; baixa com juros e valor pago errado recusada; baixa da 1ª; estorno recusado; correção do frete para 300,00 transporta a baixa e o custo vai de 3.010,00 a 3.100,00; a 1ª em 5.000,00 recusada; desfeita a baixa, o estorno vale', () => {
  const s = montar();
  hoje(s, '2026-04-20');
  const f = s.ok('parceiro.salvar', { campos: { nome: 'Fornecedor', tipos: ['FORNECEDOR'] } }).partner_id;
  const tr = s.ok('parceiro.salvar', { campos: { nome: 'Frete Rápido', tipos: ['TRANSPORTADOR'] } }).partner_id;
  const garrote = (b) => ({ brinco: b, sexo: 'M', data_nascimento: '2024-06-01', data_nascimento_confianca: 'ESTIMADA', castrado: true, reprodutor: false });
  const dados = {
    tipo: 'COMPRA', campos: { event_date: '2026-02-05', partner_id: f, pasto_destino_id: S.PASTOS.A, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 900000 },
    animais: [garrote('0801'), garrote('0802'), garrote('0803')],
    parcelas: [{ data_vencimento: '2026-03-05', valor: 450000 }, { data_vencimento: '2026-04-05', valor: 450000 }], custos: [{ tipo: 'FRETE', valor: 3000, partner_id: tr }],
  };
  const r = s.ok('evento.registrar', dados);
  const ids = r.animais.map((a) => a.animal_id);
  const principal = s.finDo(r.event_id).find((x) => x.valor === 900000);
  const [p1, p2] = s.parcelas(principal.financial_id).sort((a, b) => a.parcela_num - b.parcela_num);
  // (1) juros de 45,00 com valor pago de 4.500,00: VALIDATION (exige 4.545,00).
  const e1 = s.falha('parcela.baixar', { parcela_id: p2.parcela_id, data_pagamento: '2026-04-06', juros_multa: 4500, valor_pago: 450000 });
  assert.equal(e1.code, 'VALIDATION');
  assert.match(e1.message, /4\.545,00/);
  // (2) a 1ª parcela: LIQUIDADA.
  s.ok('parcela.baixar', { parcela_id: p1.parcela_id, data_pagamento: '2026-03-05' });
  // (3) estorno: CONFLICT.
  const e3 = s.falha('evento.estornar', { event_id: r.event_id, justificativa: 'Errado' });
  assert.equal(e3.code, 'CONFLICT');
  // (4) correção com o frete de 300,00: aceita, a baixa é transportada, o custo vai de 3.010,00 a 3.100,00.
  const custo = () => ids.map((id) => s.tabela('ANIMAIS').find((a) => a.animal_id === id).custo_aquisicao);
  assert.deepEqual(custo(), [301000, 301000, 301000]);
  const animais = ids.map((id, i) => Object.assign(garrote(['0801', '0802', '0803'][i]), { animal_id: id }));
  const c = s.ok('evento.corrigir', Object.assign({}, dados, { event_id: r.event_id, justificativa: 'Frete errado', animais, custos: [{ tipo: 'FRETE', valor: 30000, partner_id: tr }] }));
  assert.deepEqual(custo(), [310000, 310000, 310000]);
  const novo = s.finDo(c.event_id).find((x) => x.valor === 900000);
  assert.deepEqual(s.parcelas(novo.financial_id).sort((a, b) => a.parcela_num - b.parcela_num).map((p) => [p.valor, p.status, p.data_pagamento || null]), [[450000, 'LIQUIDADA', '2026-03-05'], [450000, 'ABERTA', null]]);
  assert.equal(s.parcelas(s.finDo(c.event_id).find((x) => x.valor === 30000).financial_id)[0].status, 'ABERTA', 'a parcela do frete, agora de 300,00, nasce aberta');
  // (5) a 1ª parcela em 5.000,00: CONFLICT.
  const e5 = s.falha('evento.corrigir', Object.assign({}, dados, { event_id: c.event_id, justificativa: 'Parcela', animais, custos: [{ tipo: 'FRETE', valor: 30000, partner_id: tr }], parcelas: [{ data_vencimento: '2026-03-05', valor: 500000 }, { data_vencimento: '2026-04-05', valor: 400000 }] }));
  assert.deepEqual([e5.code, codigos(e5)], ['CONFLICT', ['PARCELA_LIQUIDADA']]);
  // (6) desfazer a baixa e estornar: aceito.
  s.ok('parcela.desfazerBaixa', { parcela_id: s.parcelas(novo.financial_id).find((p) => p.status === 'LIQUIDADA').parcela_id, justificativa: 'Para estornar a compra' });
  s.ok('evento.estornar', { event_id: c.event_id, justificativa: 'Compra desfeita' });
  assert.ok(ids.every((id) => s.tabela('ANIMAIS').find((a) => a.animal_id === id).situacao_cadastral === 'ANULADO'));
});

// ------------------------------------------------------------------ fluxo de caixa e títulos ----
test('fluxo de caixa (07, seção 2.1): realizado e previsto por mês, semana e dia; o saldo a partir do saldo inicial informado (antes dele, sem saldo; o pagamento lançado depois com data anterior muda o movimento anterior, nunca o saldo observado); os vencidos à parte', () => {
  const s = montar();
  s.ok('evento.registrar', avulso(s, { valor: 90000 }, [{ data_vencimento: '2026-03-05', pago_em: '2026-03-05' }, { data_vencimento: '2026-03-12' }, { data_vencimento: '2026-04-10' }]));
  s.ok('evento.registrar', avulso(s, { event_date: '2026-03-02', conta_id: s.conta('OUTRAS_RECEITAS_OPERACIONAIS'), valor: 50000 }, [{ data_vencimento: '2026-03-25' }]));
  const m = s.ok('financeiro.fluxoCaixa', { agrupar: 'MES', de: '2026-03-01', ate: '2026-04-30' });
  assert.deepEqual(m.periodos.map((p) => [p.rotulo, p.situacao, p.realizado.liquido, p.previsto.entradas, p.previsto.saidas]), [['mar/2026', 'ATUAL', -30000, 50000, 0], ['abr/2026', 'FUTURO', 0, 0, 30000]]);
  assert.deepEqual([m.vencidos.a_pagar, m.vencidos.a_receber], [30000, 0]);
  assert.deepEqual([m.saldo.valor, m.saldo.motivo], [null, 'DADOS_INSUFICIENTES']);
  const sem = s.ok('financeiro.fluxoCaixa', { agrupar: 'SEMANA', de: '2026-03-02', ate: '2026-03-29' });
  assert.deepEqual(sem.periodos.map((p) => [p.rotulo, p.realizado.liquido]), [['02/03 a 08/03', -30000], ['09/03 a 15/03', 0], ['16/03 a 22/03', 0], ['23/03 a 29/03', 0]]);
  // O saldo inicial: R$ 1.000,00 no começo de 04/03.
  s.ok('config.salvar', { valores: { caixa_saldo_inicial: '1000', caixa_saldo_inicial_data: '2026-03-04' } });
  const dia = s.ok('financeiro.fluxoCaixa', { agrupar: 'DIA', de: '2026-03-02', ate: '2026-03-06' });
  assert.deepEqual(dia.periodos.map((p) => [p.rotulo, p.saldo_fim]), [['02/03/2026', null], ['03/03/2026', 100000], ['04/03/2026', 100000], ['05/03/2026', 70000], ['06/03/2026', 70000]]);
  // O pagamento lançado agora com data anterior à do saldo (02/03): o saldo de 04/03 em diante não muda; muda o movimento anterior.
  s.ok('evento.registrar', avulso(s, { event_date: '2026-03-02', conta_id: s.conta('ENERGIA'), valor: 5000 }, [{ data_vencimento: '2026-03-02', pago_em: '2026-03-02' }]));
  const dia2 = s.ok('financeiro.fluxoCaixa', { agrupar: 'DIA', de: '2026-03-02', ate: '2026-03-06' });
  assert.deepEqual(dia2.periodos.map((p) => p.saldo_fim), dia.periodos.map((p) => p.saldo_fim));
  assert.deepEqual([dia.movimento_antes_do_saldo, dia2.movimento_antes_do_saldo], [0, -5000]);
  // A projeção: o saldo de hoje mais o previsto até o fim de cada período.
  const proj = s.ok('financeiro.fluxoCaixa', { agrupar: 'MES', de: '2026-03-01', ate: '2026-04-30' });
  assert.deepEqual(proj.periodos.map((p) => p.saldo_fim), [70000 + 50000, 70000 + 50000 - 30000]);
  // Recusas: data futura, agrupamento desconhecido, período invertido.
  assert.deepEqual(codigos(s.falha('financeiro.fluxoCaixa', { data: '2026-03-21' })), ['DATA_FUTURA']);
  assert.deepEqual(codigos(s.falha('financeiro.fluxoCaixa', { agrupar: 'ANO' })), ['VALOR_FORA_DA_LISTA']);
  assert.deepEqual(codigos(s.falha('financeiro.fluxoCaixa', { de: '2026-04-01', ate: '2026-03-01' })), ['PERIODO_INVERTIDO']);
});

test('regra de tempo do fluxo e dos títulos: numa data passada, só os fatos até ela — a baixa e o desdobramento posteriores não mudam a resposta; a baixa retroativa muda só o que alcança; em D = hoje, sem a data = com a data', () => {
  const s = montar();
  hoje(s, '2026-03-10');
  const r = s.ok('evento.registrar', avulso(s, { valor: 60000 }, [{ data_vencimento: '2026-03-15' }, { data_vencimento: '2026-04-15' }]));
  const [p1, p2] = s.parcelas(s.finDo(r.event_id)[0].financial_id);
  const D = '2026-03-10';
  const pedir = () => [s.ok('financeiro.fluxoCaixa', { data: D, agrupar: 'SEMANA', de: '2026-03-02', ate: '2026-04-26' }), s.ok('financeiro.titulos', { data: D })];
  const antes = pedir();
  assert.deepEqual(s.ok('financeiro.fluxoCaixa', { agrupar: 'SEMANA', de: '2026-03-02', ate: '2026-04-26' }), antes[0], 'em D = hoje, sem a data = com a data');
  hoje(s, '2026-03-20');
  s.ok('parcela.desdobrar', { parcela_id: p2.parcela_id, parcelas: [{ data_vencimento: '2026-05-15' }, { data_vencimento: '2026-06-15' }], justificativa: 'Renegociado' });
  s.ok('parcela.baixar', { parcela_id: p1.parcela_id, data_pagamento: '2026-03-16' });
  const depois = pedir();
  assert.deepEqual(depois[0], antes[0], 'o fluxo em 10/03 não muda com o desdobramento e a baixa posteriores');
  assert.deepEqual(depois[1].itens.map((i) => [i.parcela_id, i.situacao, i.valor]), antes[1].itens.map((i) => [i.parcela_id, i.situacao, i.valor]));
  // Hoje, o desdobramento vale: as duas parcelas novas no lugar da original.
  assert.deepEqual(s.ok('financeiro.titulos', {}).itens.map((i) => [i.data_vencimento, i.valor]), [['2026-05-15', 15000], ['2026-06-15', 15000]]);
  // A baixa retroativa (com data antes de D) alcança D: o realizado de D passa a tê-la.
  s.ok('parcela.desfazerBaixa', { parcela_id: p1.parcela_id, justificativa: 'Data errada' });
  s.ok('parcela.baixar', { parcela_id: p1.parcela_id, data_pagamento: '2026-03-08' });
  const retro = s.ok('financeiro.fluxoCaixa', { data: D, agrupar: 'SEMANA', de: '2026-03-02', ate: '2026-04-26' });
  assert.equal(retro.realizado.saidas, 30000);
  assert.equal(s.ok('financeiro.titulos', { data: D }).itens.length, 1);
});

test('rotas da Fase 4: as de E4.1 e E4.2 respondem (e, desde a E4.4 e a E4.5, o resultado e os custos); o preço de referência continua de fase futura', () => {
  const s = montar();
  assert.equal(s.api('financeiro.resultado', {}).ok, true);
  assert.equal(s.api('financeiro.custosAnimal', {}).ok, true);
  assert.equal(s.api('financeiro.custosAnimal', { visao: 'PASTOS' }).ok, true);
  ['preco.salvar'].forEach((rota) => {
    const r = s.api(rota, {});
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'NOT_FOUND', rota);
  });
  assert.equal(s.api('financeiro.titulos', {}).ok, true);
  assert.equal(s.api('financeiro.fluxoCaixa', {}).ok, true);
  assert.equal(s.api('parcela.baixar', { parcela_id: 'nao-existe', data_pagamento: '2026-03-01' }).error.code, 'NOT_FOUND');
  assert.equal(s.api('parcela.simular', { acao: 'pagar' }).error.code, 'VALIDATION');
});

// ------------------------------------------------------------------ integridade ----
test('verificação de integridade (e a trava) conferem o que o avulso, a baixa, o desdobramento e o encontro gravam: a parcela paga antes da competência, a dedução retida quitada sozinha, as parcelas do desdobramento que não somam', () => {
  const s = montar();
  const r = s.ok('evento.registrar', avulso(s, { valor: 60000 }, [{ data_vencimento: '2026-03-15' }, { data_vencimento: '2026-04-15' }]));
  const [p1, p2] = s.parcelas(s.finDo(r.event_id)[0].financial_id);
  s.ok('parcela.baixar', { parcela_id: p1.parcela_id, data_pagamento: '2026-03-15' });
  s.ok('parcela.baixar', { parcela_id: p2.parcela_id, data_pagamento: '2026-03-16', valor: 10000 });
  const achados = (cod) => s.integridade().achados.filter((a) => a.checagem === cod).map((a) => a.mensagem);
  s.editar('PARCELAS', p1.parcela_id, 'data_pagamento', '2026-02-20');
  assert.ok(achados('PARCELAS').some((m) => /antes da competência/.test(m)), JSON.stringify(achados('PARCELAS')));
  s.editar('PARCELAS', p1.parcela_id, 'data_pagamento', '2026-03-15');
  const filha = s.parcelas(s.finDo(r.event_id)[0].financial_id).find((p) => p.parcela_origem_id === p2.parcela_id && p.status === 'ABERTA');
  s.editar('PARCELAS', filha.parcela_id, 'valor', 199.99);
  assert.ok(achados('PARCELAS').some((m) => /somam/.test(m)), JSON.stringify(achados('PARCELAS')));
  // Com a fonte mexida, o comando que a piora é recusado pela trava (o problema antigo não bloqueia o que não o piora).
  const outro = s.api('evento.registrar', avulso(s, { valor: 1000 }, [{ data_vencimento: '2026-03-01' }]));
  assert.equal(outro.ok, true, JSON.stringify(outro.error));
  s.editar('PARCELAS', filha.parcela_id, 'valor', 200);
  assert.deepEqual(achados('PARCELAS'), []);
  // O frete da compra (parcelas iguais) dividido à mão na planilha: a parcela 2 "nasceu" da 1, cancelada, com o mesmo valor.
  const tr = s.ok('parceiro.salvar', { campos: { nome: 'Frete', tipos: ['TRANSPORTADOR'] } }).partner_id;
  const f = s.ok('parceiro.salvar', { campos: { nome: 'Fornecedor', tipos: ['FORNECEDOR'] } }).partner_id;
  const c = s.ok('evento.registrar', { tipo: 'COMPRA', campos: { event_date: '2026-03-02', partner_id: f, pasto_destino_id: S.PASTOS.A, modalidade: 'CABECA', preco_unitario: 100000, valor_animais: 100000 },
    animais: [{ brinco: '77', sexo: 'M', data_nascimento: '2024-06-01', data_nascimento_confianca: 'ESTIMADA', castrado: true, reprodutor: false }], parcelas: [{ data_vencimento: '2026-04-02' }], custos: [{ tipo: 'FRETE', valor: 6000, partner_id: tr, parcelas_qtd: 2 }] });
  const [q1, q2] = s.parcelas(s.finDo(c.event_id).find((x) => x.valor === 6000).financial_id).sort((a, b) => a.parcela_num - b.parcela_num);
  s.editar('PARCELAS', q1.parcela_id, 'status', 'CANCELADA');
  s.editar('PARCELAS', q2.parcela_id, 'parcela_origem_id', q1.parcela_id);
  s.editar('PARCELAS', q2.parcela_id, 'parcela_num', 1);
  // (a soma também acusa: a parcela cancelada à mão saiu do lançamento sem as que a substituiriam)
  assert.equal(achados('PARCELAS').filter((m) => /é em parcelas iguais .* tem parcela dividida/.test(m)).length, 1, JSON.stringify(achados('PARCELAS')));
});
