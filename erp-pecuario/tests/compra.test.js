'use strict';
/**
 * COMPRA (E2.3) com o financeiro completo do próprio evento (P11): CT-03 completo, CT-13 na parte da compra, o exemplo
 * de 03b, seção 15.1, linha a linha, as modalidades × base de peso (07, seção 4; 03b, seções 4.3 e 4.4), a volta ao
 * rebanho por compra, o estorno (lançamentos cancelados pela vigência; CONFLICT com o evento que depende) e a correção
 * com os mesmos animal_id (CT-18 da Fase 2: compra com a transferência). Também os lançamentos opcionais da MORTE
 * (custos, CUSTEIO) e do DESCARTE (receita simples), a ficha (bloco H), os totais a pagar e a receber e as rotas pela
 * api(). Depois de CADA comando o apoio confere projeção = reconstrução e as invariantes de 03b, seção 14.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./apoio-cadastros');
const S = require('./apoio-sistema');

const { js, PASTOS, bicho, entradaInicial, codigos } = C;

function ambiente(opcoes) {
  const c = C.ambienteCadastros(opcoes);
  const parceiro = (nome, tipos, extra) => c.run('Config.comandoSalvarParceiro', { campos: Object.assign({ nome, tipos }, extra || {}) }).dados.partner_id;
  return { c, m: c.m, G: c.G, parceiro };
}
function garrote(brinco, extra) {
  return Object.assign({ brinco, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 }, extra || {});
}
function compra(data, fornecedor, pasto, animais, campos, extra) {
  return Object.assign({ tipo: 'COMPRA', campos: Object.assign({ event_date: data, partner_id: fornecedor, pasto_destino_id: pasto }, campos || {}), animais }, extra || {});
}
function falha(m, acao, dados, op) {
  const r = m.tentar(acao, dados, op);
  assert.equal(r.ok, false, 'o comando deveria ter sido recusado');
  return r.erro;
}
const ficha = (c, id) => c.ler(c.G.AnimalService.consultaFicha({ animal_id: id }));
const doEvento = (m, aba, eventId) => m.tabela(aba).filter((r) => r.event_id === eventId);
const titulos = (c, data) => c.lerCom(['FINANCEIRO', 'PARCELAS'], (tx, G) => G.FinancialService.titulos(tx.repo, data || null));
/** Edição à mão de uma célula (fake do harness), para provar que a conferência das invariantes pega a adulteração. */
function editar(m, aba, idReg, coluna, valor) {
  const banco = m.amb.banco;
  const mat = m.gas.planilhas.matriz(banco, aba);
  const cab = mat[0];
  const ip = cab.indexOf(m.G.Schema.pk(aba));
  const linha = mat.findIndex((l, i) => i > 0 && l[ip] === idReg) + 1;
  assert.ok(linha > 1 && cab.indexOf(coluna) >= 0, aba + '.' + coluna);
  // Na célula, dinheiro é em reais com 2 casas (o codec converte para centavos na leitura).
  const celula = typeof valor === 'number' && m.G.Schema.coluna(aba, coluna).tipo === 'DINHEIRO' ? valor / 100 : valor;
  m.gas.planilhas.gravar(banco, aba, linha, cab.indexOf(coluna) + 1, [[celula]]);
}

/** CT-03: 20 garrotes por cabeça, frete do transportador, duas parcelas. */
function ct03(a) {
  const animais = [];
  for (let i = 1; i <= 20; i++) animais.push(garrote('03' + String(i).padStart(2, '0'), { peso: 240 }));
  return compra('2026-02-05', a.f1, PASTOS.B, animais, { modalidade: 'CABECA', preco_unitario: 250000, valor_animais: 5000000 }, {
    parcelas: [{ data_vencimento: '2026-03-07', valor: 2500000, forma_pagamento: 'BOLETO' }, { data_vencimento: '2026-04-06', valor: 2500000, forma_pagamento: 'BOLETO' }],
    custos: [{ tipo: 'FRETE', valor: 120000, partner_id: a.t1, data_vencimento: '2026-02-10', forma_pagamento: 'PIX' }],
  });
}

// ------------------------------------------------------------------ CT-03 ----
test('CT-03: parcelas que não somam → VALIDATION; a compra grava 20 animais, 2 lançamentos, 3 parcelas e 40 alocações (100%); custo 2.560,00; a pagar 51.200,00', () => {
  const amb = ambiente();
  const { c, m } = amb;
  amb.f1 = amb.parceiro('Fornecedor F1', 'FORNECEDOR');
  amb.t1 = amb.parceiro('Transportes T1', 'TRANSPORTADOR');
  const dados = ct03(amb);
  // Passo 1: parcelas de 25.000,00 e 24.000,00 para R$ 50.000,00.
  const errado = js(dados);
  errado.parcelas[1].valor = 2400000;
  const n0 = m.contagem();
  const e = falha(m, 'registrar', errado, { chave: 'ct03' });
  assert.equal(e.code, 'VALIDATION');
  assert.deepEqual(codigos(e), ['PARCELAS_NAO_SOMAM']);
  assert.match(e.details[0].mensagem, /As parcelas somam R\$ 49\.000,00 e a compra vale R\$ 50\.000,00/);
  assert.deepEqual(m.contagem(), n0, 'nada gravado');
  // Passo 2: a compra certa, com a mesma chave (o erro não consumiu a chave).
  const r = m.run('registrar', dados, { chave: 'ct03' });
  const ev = r.dados.event_id;
  assert.deepEqual([r.dados.event_type, r.dados.total_value, r.dados.animais.length], ['COMPRA', 5120000, 20]);
  const animais = m.tabela('ANIMAIS').filter((a) => r.dados.animais.some((x) => x.animal_id === a.animal_id));
  assert.equal(animais.length, 20);
  for (const a of animais) {
    assert.deepEqual([a.situacao_cadastral, a.origem, a.pasto_atual_id, a.custo_aquisicao, a.custo_aquisicao_origem, a.peso_atual, a.data_entrada], ['ATIVO', 'COMPRADO', PASTOS.B, 256000, 'NEGOCIADO', 240, '2026-02-05']);
  }
  assert.equal(doEvento(m, 'IDENTIFICACOES', ev).length, 20);
  const pes = doEvento(m, 'PESAGENS', ev);
  assert.deepEqual([pes.length, pes.every((p) => p.tipo === 'COMPRA' && p.metodo === 'BALANCA' && p.peso_kg === 240 && p.data_pesagem === '2026-02-05')], [20, true]);
  const cp = doEvento(m, 'COMPRAS', ev);
  assert.equal(cp.length, 1);
  assert.deepEqual([cp[0].qtd_animais, cp[0].valor_animais, cp[0].frete, cp[0].valor_total, cp[0].criterio_rateio, cp[0].unidade_preco], [20, 5000000, 120000, 5120000, 'CABECAS', 'CABECA']);
  assert.equal(m.evento(ev).partner_id, amb.f1);
  const fin = doEvento(m, 'FINANCEIRO', ev);
  assert.deepEqual(fin.map((f) => [f.natureza, f.valor, f.status, f.status_pagamento, f.partner_id]), [['AQUISICAO_ANIMAIS', 5000000, 'ATIVO', 'ABERTO', amb.f1], ['AQUISICAO_ANIMAIS', 120000, 'ATIVO', 'ABERTO', amb.t1]]);
  const parcelas = m.tabela('PARCELAS').filter((p) => fin.some((f) => f.financial_id === p.financial_id));
  assert.deepEqual(parcelas.map((p) => [p.valor, p.status, p.data_vencimento]), [[2500000, 'ABERTA', '2026-03-07'], [2500000, 'ABERTA', '2026-04-06'], [120000, 'ABERTA', '2026-02-10']]);
  const alocs = m.tabela('ALOCACOES_FINANCEIRAS').filter((x) => fin.some((f) => f.financial_id === x.financial_id));
  assert.equal(alocs.length, 40);
  assert.deepEqual([...new Set(alocs.filter((x) => x.financial_id === fin[0].financial_id).map((x) => x.valor_alocado))], [250000]);
  assert.deepEqual([...new Set(alocs.filter((x) => x.financial_id === fin[1].financial_id).map((x) => x.valor_alocado))], [6000]);
  const rats = doEvento(m, 'RATEIOS', ev);
  assert.deepEqual(rats.map((x) => [x.criterio, x.escopo_tipo, x.escopo_ref, x.base_total, x.total_alocado, x.data_base]), [['CABECAS', 'EVENTO', ev, 20, 5000000, '2026-02-05'], ['CABECAS', 'EVENTO', ev, 20, 120000, '2026-02-05']]);
  // O valor individual de cada animal é a alocação do lançamento principal (03b, seção 4.5).
  assert.ok(doEvento(m, 'EVENTO_ANIMAIS', ev).every((l) => l.valor_individual === 250000 && l.efeito_inventario === 1));
  // A pagar 51.200,00; nada a receber; resultado gerencial de fevereiro (Fase 4) não é conferido aqui.
  assert.deepEqual(js(titulos(c, '2026-02-28')), { data: '2026-02-28', a_pagar: 5120000, a_receber: 0, vencido_pagar: 120000, vencido_receber: 0, parcelas_abertas: 3 });
  assert.equal(titulos(c, '2026-02-04').a_pagar, 0, 'antes da compra nada a pagar');
  // Inventário: Pasto 2 com 0 em 04/02 e 20 em 05/02.
  assert.equal((m.inventario('2026-02-04').porPasto || {})[PASTOS.B] || 0, 0);
  assert.equal(m.inventario('2026-02-05').porPasto[PASTOS.B], 20);
  assert.deepEqual(m.invariantes(), []);
  // Reenvio com a mesma chave: duplicado, nada novo.
  const d = m.run('registrar', dados, { chave: 'ct03' });
  assert.deepEqual([d.duplicado, d.dados.event_id, d.dados.total_value], [true, ev, 5120000]);
});

// ------------------------------------------------------------------ 03b, seção 15.1 ----
test('03b, 15.1 linha a linha: compra de 3 garrotes por kg vivo, frete rateado e 2 parcelas — 28 linhas em 11 abas, iguais às do documento', () => {
  const amb = ambiente({ marcoZero: '2027-01-01' });
  const { m, c } = amb;
  const gas = m.gas;
  gas.clock.now = Date.parse('2027-03-10T18:00:00.000Z');
  const forn = amb.parceiro('Fornecedor forn-1', 'FORNECEDOR');
  const transp = amb.parceiro('Transportador transp-1', 'TRANSPORTADOR');
  gas.clock.now = Date.parse('2027-03-10T18:42:07.000Z');
  const g = (b, peso) => garrote(b, { raca: 'NELORE', peso, metodo_pesagem: 'BALANCA' });
  const dados = compra('2027-03-10', forn, PASTOS.B, [g('0431', 212.5), g('0432', 198.0), g('0433', 206.5)],
    { finalidade: 'RECRIA_ENGORDA', modalidade: 'KG_VIVO', preco_unitario: 1465, valor_animais: 903905, gta_numero: '0012345', nota_fiscal: '000789' },
    { parcelas: [{ data_vencimento: '2027-04-09', forma_pagamento: 'BOLETO' }, { data_vencimento: '2027-05-09', forma_pagamento: 'BOLETO' }],
      custos: [{ tipo: 'FRETE', valor: 36000, partner_id: transp, data_vencimento: '2027-03-15', forma_pagamento: 'PIX' }] });
  // A simulação mostra a mesma conta que será gravada (28 linhas em 11 abas, com a de OPERACOES).
  const sim = m.simular('registrar', dados).valor.dados;
  assert.deepEqual(js(sim.linhas), { EVENTOS: 1, ANIMAIS: 3, EVENTO_ANIMAIS: 3, IDENTIFICACOES: 3, PESAGENS: 3, COMPRAS: 1, FINANCEIRO: 2, PARCELAS: 3, RATEIOS: 2, ALOCACOES_FINANCEIRAS: 6 });
  assert.equal(Object.values(sim.linhas).reduce((s, n) => s + n, 0) + 1, 28);
  assert.deepEqual([sim.impactos.compra.conferencia, sim.impactos.compra.desvio_pct, sim.impactos.compra.criterio, sim.impactos.compra.peso_vivo_total], [903905, 0, 'PESO_VIVO', 617]);
  assert.deepEqual(sim.impactos.financeiro.por_animal.map((x) => [x.brinco, x.valor]), [['0431', 323712], ['0432', 301623], ['0433', 314570]]);
  const r = m.run('registrar', dados);
  const ev = r.dados.event_id;
  const id = {};
  r.dados.animais.forEach((x) => { id[x.brinco] = x.animal_id; });
  const prop = C.PROP;
  // EVENTOS, 1 linha.
  const e = m.evento(ev);
  assert.deepEqual([e.event_type, e.event_subtype, e.event_date, e.registration_date, e.property_id, e.partner_id, e.status, e.total_value, e.created_by, e.source, e.confiabilidade, e.pre_marco_zero, e.created_at],
    ['COMPRA', null, '2027-03-10', '2027-03-10', prop, forn, 'CONFIRMADO', 939905, 'dono@gmail.com', 'APP', 'CONFIRMADA', false, '2027-03-10T18:42:07.000Z']);
  assert.ok(e.confirmed_at && e.op_id && e.idempotency_key && typeof e.event_seq === 'number');
  for (const k of ['description', 'responsible', 'notes', 'payload_json', 'reversal_of_event_id', 'reversed_by_event_id', 'import_id']) assert.equal(e[k], null, 'EVENTOS.' + k + ' vazia');
  // COMPRAS, 1 linha.
  const cp = doEvento(m, 'COMPRAS', ev)[0];
  assert.deepEqual([cp.finalidade, cp.modalidade, cp.base_peso, cp.qtd_animais, cp.peso_total_kg, cp.preco_unitario, cp.unidade_preco, cp.valor_animais, cp.frete, cp.outros_custos, cp.valor_total, cp.criterio_rateio, cp.gta_numero, cp.nota_fiscal],
    ['RECRIA_ENGORDA', 'KG_VIVO', 'VIVO', 3, 617, 1465, 'KG_VIVO', 903905, 36000, 0, 939905, 'PESO_VIVO', '0012345', '000789']);
  for (const k of ['rendimento_carcaca_pct', 'rendimento_tipo', 'observacoes']) assert.equal(cp[k], null, 'COMPRAS.' + k + ' vazia');
  // EVENTO_ANIMAIS, 3 linhas.
  const ea = doEvento(m, 'EVENTO_ANIMAIS', ev);
  const at = { sexo: 'M', data_nascimento: '2026-01-10', data_nascimento_confianca: 'ESTIMADA', raca: 'NELORE', castrado: 'N', reprodutor: 'N', origem: 'COMPRADO' };
  assert.deepEqual(ea.map((l) => [l.animal_id, l.papel, l.efeito_inventario, l.pasto_destino_id, l.peso, l.valor_individual, l.atributos_iniciais_json]),
    [[id['0431'], 'SUJEITO', 1, PASTOS.B, 212.5, 311313, at], [id['0432'], 'SUJEITO', 1, PASTOS.B, 198, 290070, at], [id['0433'], 'SUJEITO', 1, PASTOS.B, 206.5, 302522, at]]);
  for (const l of ea) for (const k of ['pasto_origem_id', 'peso_carcaca_kg', 'preco_unitario', 'motivo_saida', 'observacoes']) assert.equal(l[k], null, 'EVENTO_ANIMAIS.' + k);
  // PESAGENS, 3 linhas.
  assert.deepEqual(doEvento(m, 'PESAGENS', ev).map((p) => [p.animal_id, p.data_pesagem, p.peso_kg, p.metodo, p.tipo]),
    [[id['0431'], '2027-03-10', 212.5, 'BALANCA', 'COMPRA'], [id['0432'], '2027-03-10', 198, 'BALANCA', 'COMPRA'], [id['0433'], '2027-03-10', 206.5, 'BALANCA', 'COMPRA']]);
  // FINANCEIRO, 2 linhas.
  const contas = Object.fromEntries(m.linhas.PLANO_CONTAS.map((x) => [x.codigo, x.conta_id]));
  const fin = doEvento(m, 'FINANCEIRO', ev);
  assert.deepEqual(fin.map((f) => [f.conta_id, f.natureza, f.tipo, f.categoria, f.descricao, f.data_competencia, f.valor, f.quantidade, f.partner_id, f.documento, f.status, f.status_pagamento, f.property_id, f.retida_pelo_comprador]), [
    [contas.COMPRA_ANIMAIS, 'AQUISICAO_ANIMAIS', 'DESPESA', 'CUSTO_DIRETO', 'Compra de 3 animais', '2027-03-10', 903905, 3, forn, '000789', 'ATIVO', 'ABERTO', prop, false],
    [contas.FRETE_DESPESAS_COMPRA, 'AQUISICAO_ANIMAIS', 'DESPESA', 'CUSTO_DIRETO', 'Frete da compra de 10/03/2027', '2027-03-10', 36000, null, transp, null, 'ATIVO', 'ABERTO', prop, false],
  ]);
  for (const f of fin) for (const k of ['ref_event_id', 'competencia_inicio', 'competencia_fim', 'product_id', 'animal_id', 'pasture_id', 'categoria_animal_id', 'observacoes', 'cancelado_em', 'cancelado_por_event_id', 'data_pagamento']) assert.equal(f[k], null, 'FINANCEIRO.' + k);
  // PARCELAS, 3 linhas (903.905 ÷ 2: o centavo que sobra vai para a primeira).
  const parc = m.tabela('PARCELAS');
  assert.deepEqual(parc.map((p) => [p.financial_id, p.parcela_num, p.data_vencimento, p.valor, p.forma_pagamento, p.status]), [
    [fin[0].financial_id, 1, '2027-04-09', 451953, 'BOLETO', 'ABERTA'], [fin[0].financial_id, 2, '2027-05-09', 451952, 'BOLETO', 'ABERTA'], [fin[1].financial_id, 1, '2027-03-15', 36000, 'PIX', 'ABERTA'],
  ]);
  for (const p of parc) for (const k of ['data_pagamento', 'valor_pago', 'juros_multa', 'desconto', 'parcela_origem_id', 'documento']) assert.equal(p[k], null, 'PARCELAS.' + k);
  // RATEIOS, 2 linhas.
  const rats = doEvento(m, 'RATEIOS', ev);
  assert.deepEqual(rats.map((x) => [x.financial_id, x.criterio, x.escopo_tipo, x.escopo_ref, x.data_base, x.base_total, x.total_alocado, x.created_by]), [
    [fin[0].financial_id, 'PESO_VIVO', 'EVENTO', ev, '2027-03-10', 617, 903905, 'dono@gmail.com'], [fin[1].financial_id, 'PESO_VIVO', 'EVENTO', ev, '2027-03-10', 617, 36000, 'dono@gmail.com'],
  ]);
  for (const x of rats) for (const k of ['periodo_inicio', 'periodo_fim', 'justificativa']) assert.equal(x[k], null, 'RATEIOS.' + k);
  // ALOCACOES_FINANCEIRAS, 6 linhas (desempate de fin-1 pela maior base: 212,5 kg contra 206,5 kg).
  assert.deepEqual(m.tabela('ALOCACOES_FINANCEIRAS').map((x) => [x.rateio_id, x.financial_id, x.animal_id, x.base_valor, x.valor_alocado]), [
    [rats[0].rateio_id, fin[0].financial_id, id['0431'], 212.5, 311313], [rats[0].rateio_id, fin[0].financial_id, id['0432'], 198, 290070], [rats[0].rateio_id, fin[0].financial_id, id['0433'], 206.5, 302522],
    [rats[1].rateio_id, fin[1].financial_id, id['0431'], 212.5, 12399], [rats[1].rateio_id, fin[1].financial_id, id['0432'], 198, 11553], [rats[1].rateio_id, fin[1].financial_id, id['0433'], 206.5, 12048],
  ]);
  // ANIMAIS (fase C) e IDENTIFICACOES.
  assert.deepEqual(['0431', '0432', '0433'].map((b) => { const a = m.animal(id[b]); return [a.situacao_cadastral, a.pasto_atual_id, a.peso_atual, a.custo_aquisicao, a.custo_aquisicao_origem]; }),
    [['ATIVO', PASTOS.B, 212.5, 323712, 'NEGOCIADO'], ['ATIVO', PASTOS.B, 198, 301623, 'NEGOCIADO'], ['ATIVO', PASTOS.B, 206.5, 314570, 'NEGOCIADO']]);
  assert.deepEqual(doEvento(m, 'IDENTIFICACOES', ev).map((x) => [x.tipo, x.codigo]), [['BRINCO', '0431'], ['BRINCO', '0432'], ['BRINCO', '0433']]);
  // As somas fecham (passo 4) e a ficha mostra o custo pelas alocações.
  assert.equal(['0431', '0432', '0433'].reduce((s, b) => s + m.animal(id[b]).custo_aquisicao, 0), 939905);
  const h = ficha(c, id['0431']).financeiro;
  assert.deepEqual([h.entregue, h.custo_aquisicao, h.custo_aquisicao_origem, h.lancamentos.length, h.lancamentos.map((x) => x.valor_alocado).sort()], [true, 323712, 'NEGOCIADO', 2, [12399, 311313]]);
  assert.deepEqual([h.lancamentos[0].criterio, h.lancamentos[0].base_valor, h.lancamentos[0].base_total], ['PESO_VIVO', 212.5, 617]);
  assert.equal(titulos(c, '2027-03-31').a_pagar, 939905);
});

// ------------------------------------------------------------------ CT-13 (compra) e exemplos de 03b, 4.4 ----
test('CT-13 na compra: R$ 100,00 por cabeça entre 3 (o centavo para o menor código) e R$ 1.500,00 por peso vivo (200, 250, 310 kg)', () => {
  const amb = ambiente();
  const { m } = amb;
  const f = amb.parceiro('Vizinho', 'FORNECEDOR');
  const a = m.run('registrar', compra('2026-03-01', f, PASTOS.A, [garrote('1001'), garrote('1002'), garrote('1003')], { modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 900000 },
    { parcelas: [{ data_vencimento: '2026-04-01' }], custos: [{ tipo: 'FRETE', valor: 10000 }] }));
  const codigo = Object.fromEntries(a.dados.animais.map((x) => [x.brinco, x.codigo_interno]));
  const frete = doEvento(m, 'FINANCEIRO', a.dados.event_id)[1];
  const alocA = m.tabela('ALOCACOES_FINANCEIRAS').filter((x) => x.financial_id === frete.financial_id).map((x) => [m.animal(x.animal_id).codigo_interno, x.valor_alocado]).sort();
  assert.deepEqual(alocA, [[codigo['1001'], 3334], [codigo['1002'], 3333], [codigo['1003'], 3333]]);
  assert.ok(codigo['1001'] < codigo['1002'], 'o primeiro recebe o centavo: menor código interno');
  const rat = m.tabela('RATEIOS').find((x) => x.financial_id === frete.financial_id);
  assert.deepEqual([rat.criterio, rat.base_total, rat.total_alocado], ['CABECAS', 3, 10000]);
  // (b) PESO_VIVO pelas mesmas bases do valor dos animais (kg vivo): 394,74; 493,42; 611,84.
  const b = m.run('registrar', compra('2026-03-02', f, PASTOS.A, [garrote('2001', { peso: 200 }), garrote('2002', { peso: 250 }), garrote('2003', { peso: 310 })],
    { modalidade: 'KG_VIVO', preco_unitario: 1200, valor_animais: 912000 }, { parcelas: [{ data_vencimento: '2026-04-01' }], custos: [{ tipo: 'FRETE', valor: 150000 }] }));
  const freteB = doEvento(m, 'FINANCEIRO', b.dados.event_id)[1];
  const porBrinco = (fid) => Object.fromEntries(m.tabela('ALOCACOES_FINANCEIRAS').filter((x) => x.financial_id === fid).map((x) => [m.animal(x.animal_id).brinco, x.valor_alocado]));
  assert.deepEqual(porBrinco(freteB.financial_id), { 2001: 39474, 2002: 49342, 2003: 61184 });
  const ratB = m.tabela('RATEIOS').find((x) => x.financial_id === freteB.financial_id);
  assert.deepEqual([ratB.criterio, ratB.base_total, ratB.total_alocado], ['PESO_VIVO', 760, 150000]);
  // Simulação e commit dão o mesmo centavo ao mesmo animal (desempate determinístico).
  assert.deepEqual(m.invariantes(), []);
});

test('03b, 4.4: um exemplo por modalidade de compra — cabeça com frete (R$ 3.075,00), arroba de peso vivo negociada, arroba de carcaça (rendimento apurado), lote manual', () => {
  const amb = ambiente();
  const { m } = amb;
  const f = amb.parceiro('Leilão', 'FORNECEDOR');
  const vinte = (p, extra) => Array.from({ length: 20 }, (_, i) => garrote(p + String(i + 1).padStart(2, '0'), extra));
  // 1: 20 garrotes a R$ 3.000,00, frete de R$ 1.500,00 → custo de aquisição R$ 3.075,00 por cabeça.
  const r1 = m.run('registrar', compra('2026-03-01', f, PASTOS.A, vinte('41'), { modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 6000000 }, { parcelas: [{ data_vencimento: '2026-04-01' }], custos: [{ tipo: 'FRETE', valor: 150000 }] }));
  assert.ok(r1.dados.animais.every((a) => m.animal(a.animal_id).custo_aquisicao === 307500));
  assert.equal(doEvento(m, 'COMPRAS', r1.dados.event_id)[0].valor_total, 6150000);
  // 3: 10 novilhas, 3.300,0 kg vivos, 50% NEGOCIADO, R$ 290,00/@ → 110 @, R$ 31.900,00, sem peso individual: por cabeça (com aviso).
  const novilhas = Array.from({ length: 10 }, (_, i) => ({ brinco: '42' + String(i + 1).padStart(2, '0'), sexo: 'F', idade_meses: 20 }));
  const d3 = compra('2026-03-02', f, PASTOS.A, novilhas, { modalidade: 'ARROBA', base_peso: 'VIVO', rendimento_carcaca_pct: 50, rendimento_tipo: 'NEGOCIADO', preco_unitario: 29000, peso_total_kg: 3300, valor_animais: 3190000 }, { parcelas: [{ data_vencimento: '2026-04-01' }] });
  const sem = falha(m, 'registrar', d3);
  assert.deepEqual([sem.code, codigos(sem)], ['NEEDS_CONFIRMATION', ['RATEIO_SEM_PESO']]);
  const r3 = m.run('registrar', d3, { avisos: ['RATEIO_SEM_PESO'] });
  const c3 = doEvento(m, 'COMPRAS', r3.dados.event_id)[0];
  assert.deepEqual([c3.rendimento_carcaca_pct, c3.rendimento_tipo, c3.peso_total_kg, c3.criterio_rateio, c3.unidade_preco], [50, 'NEGOCIADO', 3300, 'CABECAS', 'ARROBA']);
  assert.ok(r3.dados.animais.every((a) => m.animal(a.animal_id).custo_aquisicao === 319000));
  assert.equal(doEvento(m, 'PESAGENS', r3.dados.event_id).length, 0, 'só o peso do lote: nenhuma pesagem');
  assert.deepEqual(m.evento(r3.dados.event_id).payload_json, { avisos_aceitos: [{ codigo: 'RATEIO_SEM_PESO', n: 1 }] });
  // (c) de 07, 4.3: 20 garrotes, 4.800,0 kg, 50%, R$ 300,00/@ = R$ 48.000,00; nota de R$ 48.150,00 (0,31%): vale a nota, sem aviso.
  const sim = m.simular('registrar', compra('2026-03-03', f, PASTOS.A, vinte('43'), { modalidade: 'ARROBA', base_peso: 'VIVO', rendimento_carcaca_pct: 50, rendimento_tipo: 'NEGOCIADO', preco_unitario: 30000, peso_total_kg: 4800, valor_animais: 4815000 }, { parcelas: [{ data_vencimento: '2026-04-01' }] }), { avisos: ['RATEIO_SEM_PESO'] });
  assert.deepEqual([sim.valor.dados.impactos.compra.conferencia, sim.valor.dados.impactos.compra.arrobas, sim.valor.dados.impactos.compra.desvio_pct], [4800000, 160, 0.31]);
  assert.deepEqual(sim.valor.dados.avisos.map((x) => x.codigo), ['RATEIO_SEM_PESO']);
  // Arroba de carcaça com romaneio por animal: rendimento APURADO = carcaça ÷ vivo; rateio pela carcaça; carcaça nunca vira pesagem.
  const touros = [garrote('4401', { peso: 540, peso_carcaca_kg: 285 }), garrote('4402', { peso: 520, peso_carcaca_kg: 270 })];
  const r4 = m.run('registrar', compra('2026-03-04', f, PASTOS.A, touros, { modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 32000, valor_animais: 1184000 }, { parcelas: [{ data_vencimento: '2026-04-01' }] }));
  const c4 = doEvento(m, 'COMPRAS', r4.dados.event_id)[0];
  assert.deepEqual([c4.rendimento_carcaca_pct, c4.rendimento_tipo, c4.peso_total_kg, c4.criterio_rateio], [52.4, 'APURADO', 1060, 'PESO_CARCACA']);
  assert.deepEqual(doEvento(m, 'EVENTO_ANIMAIS', r4.dados.event_id).map((l) => [l.peso, l.peso_carcaca_kg, l.valor_individual]), [[540, 285, 608000], [520, 270, 576000]]);
  assert.deepEqual(doEvento(m, 'PESAGENS', r4.dados.event_id).map((p) => p.peso_kg), [540, 520]);
  // Lote fechado com divisão manual (pesos relativos 60 e 40) e justificativa no rateio.
  const r5 = m.run('registrar', compra('2026-03-05', f, PASTOS.A, [garrote('4501', { base_manual: 60 }), garrote('4502', { base_manual: 40 })],
    { modalidade: 'LOTE', criterio_rateio: 'MANUAL', justificativa_rateio: 'O touro vale mais que o garrote', valor_animais: 1000000 }, { parcelas: [{ data_vencimento: '2026-04-01' }] }));
  const rat5 = doEvento(m, 'RATEIOS', r5.dados.event_id)[0];
  assert.deepEqual([rat5.criterio, rat5.base_total, rat5.justificativa], ['MANUAL', 100, 'O touro vale mais que o garrote']);
  assert.deepEqual(r5.dados.animais.map((a) => m.animal(a.animal_id).custo_aquisicao), [600000, 400000]);
  // Um animal só: DIRETO, com o animal no lançamento (alocação direta).
  const r6 = m.run('registrar', compra('2026-03-06', f, PASTOS.A, [garrote('4601', { reprodutor: true, idade_meses: 40 })], { modalidade: 'CABECA', preco_unitario: 1200000, valor_animais: 1200000 }, { parcelas: [{ data_vencimento: '2026-04-01' }], custos: [{ tipo: 'OUTRO', valor: 5000, descricao: 'Taxa da GTA' }] }));
  const fin6 = doEvento(m, 'FINANCEIRO', r6.dados.event_id);
  const id6 = r6.dados.animais[0].animal_id;
  assert.deepEqual(fin6.map((x) => [x.descricao, x.animal_id]), [['Compra de 1 animal', id6], ['Taxa da GTA', id6]]);
  assert.deepEqual(doEvento(m, 'RATEIOS', r6.dados.event_id).map((x) => [x.criterio, x.base_total]), [['DIRETO', 12000], ['DIRETO', 50]]);
  assert.deepEqual([doEvento(m, 'COMPRAS', r6.dados.event_id)[0].frete, doEvento(m, 'COMPRAS', r6.dados.event_id)[0].outros_custos, m.animal(id6).custo_aquisicao], [0, 5000, 1205000]);
  assert.deepEqual(m.invariantes(), []);
});

test('regras da negociação (RN-067, RN-068, 03b 4.3): base de peso, rendimento, preço, valores por animal, conferência com tolerância e aviso VALOR_DIVERGENTE aceito', () => {
  const amb = ambiente();
  const { m } = amb;
  const f = amb.parceiro('Vendedor', 'FORNECEDOR');
  const par = { parcelas: [{ data_vencimento: '2026-04-01' }] };
  const dois = [garrote('5001', { peso: 300 }), garrote('5002', { peso: 310 })];
  const erro = (campos, animais) => codigos(falha(m, 'registrar', compra('2026-03-01', f, PASTOS.A, animais || dois, campos, par)));
  assert.deepEqual(erro({ modalidade: 'ARROBA', preco_unitario: 30000, valor_animais: 100000 }), ['CAMPO_OBRIGATORIO'], 'RN-067: arroba sem base de peso');
  assert.deepEqual(erro({ modalidade: 'ARROBA', base_peso: 'VIVO', preco_unitario: 30000, valor_animais: 100000 }).sort(), ['CAMPO_OBRIGATORIO', 'CAMPO_OBRIGATORIO'], 'base VIVO sem rendimento e sem o tipo');
  assert.deepEqual(erro({ modalidade: 'ARROBA', base_peso: 'VIVO', rendimento_carcaca_pct: 50, rendimento_tipo: 'APURADO', preco_unitario: 30000, valor_animais: 100000 }), ['VALOR_FORA_DA_LISTA'], 'rendimento apurado só na carcaça');
  assert.deepEqual(erro({ modalidade: 'KG_VIVO', valor_animais: 100000 }), ['CAMPO_OBRIGATORIO'], 'kg vivo sem preço');
  assert.deepEqual(erro({ modalidade: 'CABECA', valor_animais: 100000 }), ['CAMPO_OBRIGATORIO'], 'por cabeça sem preço e sem valor por animal');
  assert.deepEqual(erro({ modalidade: 'CABECA', preco_unitario: 50000, valor_animais: 100000 }, [garrote('5001', { valor_individual: 50000 }), garrote('5002', { valor_individual: 50000 })]), ['CONFLITO_DE_CAMPOS']);
  assert.deepEqual(erro({ modalidade: 'CABECA', valor_animais: 100000 }, [garrote('5001', { valor_individual: 60000 }), garrote('5002', { valor_individual: 50000 })]), ['VALOR_INDIVIDUAL_NAO_SOMA']);
  assert.deepEqual(erro({ modalidade: 'CABECA', valor_animais: 100000 }, [garrote('5001', { valor_individual: 100000 }), garrote('5002')]), ['VALORES_INCOMPLETOS']);
  assert.deepEqual(erro({ modalidade: 'KG_VIVO', preco_unitario: 1500, valor_animais: 915000, peso_total_kg: 600 }), ['PESO_TOTAL_DIVERGENTE']);
  assert.deepEqual(erro({ modalidade: 'KG_VIVO', preco_unitario: 1500, valor_animais: 915000 }, [garrote('5001', { peso: 300, peso_carcaca_kg: 150 }), garrote('5002', { peso: 310 })]), ['CAMPO_NAO_SE_APLICA'], 'carcaça só na arroba de carcaça');
  assert.deepEqual(erro({ modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 30000, valor_animais: 100000 }), ['PESO_OBRIGATORIO'], 'arroba de carcaça sem o romaneio de cada animal');
  assert.deepEqual(erro({ modalidade: 'LOTE', valor_animais: 100000 }), ['CAMPO_OBRIGATORIO'], 'lote sem critério');
  assert.deepEqual(erro({ modalidade: 'LOTE', criterio_rateio: 'PESO_VIVO', valor_animais: 100000 }, [garrote('5001', { peso: 300 }), garrote('5002')]), ['PESO_OBRIGATORIO']);
  assert.deepEqual(erro({ modalidade: 'LOTE', criterio_rateio: 'MANUAL', valor_animais: 100000 }, [garrote('5001', { base_manual: 1 }), garrote('5002', { base_manual: 1 })]), ['CAMPO_OBRIGATORIO'], 'manual sem justificativa');
  assert.deepEqual(erro({ modalidade: 'LOTE', preco_unitario: 100, criterio_rateio: 'CABECAS', valor_animais: 100000 }), ['CAMPO_NAO_SE_APLICA']);
  // Conferência: 610,0 kg × R$ 15,00 = R$ 9.150,00; nota de R$ 9.000,00 = 1,64% → aviso; aceito, vale a nota.
  const d = compra('2026-03-01', f, PASTOS.A, dois, { modalidade: 'KG_VIVO', preco_unitario: 1500, valor_animais: 900000 }, par);
  const av = falha(m, 'registrar', d);
  assert.deepEqual([av.code, codigos(av)], ['NEEDS_CONFIRMATION', ['VALOR_DIVERGENTE']]);
  assert.match(av.details[0].mensagem, /O valor informado \(R\$ 9\.000,00\) difere em 1,64% da conta pela negociação \(R\$ 9\.150,00\)/);
  const r = m.run('registrar', d, { avisos: ['VALOR_DIVERGENTE'] });
  assert.equal(doEvento(m, 'COMPRAS', r.dados.event_id)[0].valor_animais, 900000, 'vale o valor informado');
  assert.deepEqual(m.evento(r.dados.event_id).payload_json.avisos_aceitos, [{ codigo: 'VALOR_DIVERGENTE', n: 1 }]);
  // Dentro da tolerância (1%): nota de R$ 9.100,00 contra R$ 9.150,00 (0,55%) não avisa.
  assert.equal(m.simular('registrar', compra('2026-03-02', f, PASTOS.A, [garrote('5101', { peso: 300 }), garrote('5102', { peso: 310 })], { modalidade: 'KG_VIVO', preco_unitario: 1500, valor_animais: 910000 }, par)).valor.dados.avisos.length, 0);
});

test('cabeçalho, parceiros e parcelas: fornecedor obrigatório, inexistente ou inativo; pasto inativo; vencimento; divisão igual automática; conta do sistema ausente → CONFIG', () => {
  const amb = ambiente();
  const { c, m } = amb;
  const f = amb.parceiro('Fornecedor', 'FORNECEDOR');
  const inativo = amb.parceiro('Antigo', 'FORNECEDOR');
  c.run('Config.comandoSalvarParceiro', { partner_id: inativo, campos: { ativo: false } });
  const um = [garrote('6001')];
  const base = { modalidade: 'CABECA', preco_unitario: 100000, valor_animais: 100000 };
  const err = (fornecedor, pasto, campos, extra) => codigos(falha(m, 'registrar', compra('2026-03-01', fornecedor, pasto, um, Object.assign({}, base, campos), extra || { parcelas: [{ data_vencimento: '2026-04-01' }] })));
  assert.deepEqual(err(null, PASTOS.A), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(err(C.id(0x999), PASTOS.A), ['NAO_ENCONTRADO']);
  assert.deepEqual(err(inativo, PASTOS.A), ['PARCEIRO_INATIVO']);
  assert.deepEqual(err(f, PASTOS.INATIVO), ['PASTO_INATIVO']);
  assert.deepEqual(err(f, PASTOS.A, {}, { parcelas: [] }), ['SEM_PARCELAS']);
  assert.deepEqual(err(f, PASTOS.A, {}, { parcelas: [{ valor: 100000 }] }), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(err(f, PASTOS.A, {}, { parcelas: [{ data_vencimento: '2026-04-01', valor: 0 }] }), ['VALOR_FORA_DA_FAIXA']);
  assert.deepEqual(err(f, PASTOS.A, {}, { parcelas: [{ data_vencimento: '2026-04-01', forma_pagamento: 'ESCAMBO' }] }), ['VALOR_FORA_DA_LISTA']);
  assert.deepEqual(err(f, PASTOS.A, {}, { parcelas: [{ data_vencimento: '2026-04-01' }], custos: [{ tipo: 'FRETE' }] }), ['CAMPO_OBRIGATORIO'], 'custo sem valor');
  assert.deepEqual(err(f, PASTOS.A, {}, { parcelas: [{ data_vencimento: '2026-04-01' }], custos: [{ tipo: 'FRETE', valor: 100, partner_id: inativo }] }), ['PARCEIRO_INATIVO']);
  assert.deepEqual(err(f, PASTOS.A, { event_date: '2025-12-20' }), ['ANTES_DO_MARCO_ZERO']);
  // R$ 1.000,00 em 3 parcelas sem valor: 333,34 + 333,33 + 333,33; frete sem vencimento = à vista na data da compra.
  const r = m.run('registrar', compra('2026-03-01', f, PASTOS.A, um, base, { parcelas: [{ data_vencimento: '2026-04-01' }, { data_vencimento: '2026-05-01' }, { data_vencimento: '2026-06-01' }], custos: [{ tipo: 'FRETE', valor: 2000 }] }));
  const fins = doEvento(m, 'FINANCEIRO', r.dados.event_id);
  assert.deepEqual(m.tabela('PARCELAS').filter((p) => p.financial_id === fins[0].financial_id).map((p) => p.valor), [33334, 33333, 33333]);
  assert.deepEqual(m.tabela('PARCELAS').filter((p) => p.financial_id === fins[1].financial_id).map((p) => p.data_vencimento), ['2026-03-01']);
  // Parte informada e parte dividida: R$ 400,00 + o resto em duas.
  const r2 = m.run('registrar', compra('2026-03-02', f, PASTOS.A, [garrote('6002')], base, { parcelas: [{ data_vencimento: '2026-04-01', valor: 40000 }, { data_vencimento: '2026-05-01' }, { data_vencimento: '2026-06-01' }] }));
  assert.deepEqual(m.tabela('PARCELAS').filter((p) => p.financial_id === doEvento(m, 'FINANCEIRO', r2.dados.event_id)[0].financial_id).map((p) => p.valor), [40000, 30000, 30000]);
  // Conta do sistema desativada à mão: o setup é que repõe (CONFIG, nada gravado).
  const conta = m.linhas.PLANO_CONTAS.find((x) => x.codigo === 'FRETE_DESPESAS_COMPRA');
  editar(m, 'PLANO_CONTAS', conta.conta_id, 'ativo', 'N');
  const cfg = falha(m, 'registrar', compra('2026-03-03', f, PASTOS.A, [garrote('6003')], base, { parcelas: [{ data_vencimento: '2026-04-01' }], custos: [{ tipo: 'FRETE', valor: 100 }] }));
  assert.equal(cfg.code, 'CONFIG');
});

// ------------------------------------------------------------------ volta ao rebanho por compra ----
test('compra de animal que já foi da fazenda: descartado volta ATIVO com o custo só da compra nova; morto, ativo e de referência são recusados', () => {
  const amb = ambiente();
  const { c, m, G } = amb;
  const f = amb.parceiro('Vizinho', 'FORNECEDOR,COMPRADOR');
  const ini = m.run('registrar', entradaInicial([bicho({ brinco: '0700', sexo: 'F', data_nascimento: '2022-01-01', data_nascimento_confianca: 'ESTIMADA', valor_abertura: 200000 }), bicho({ brinco: '0701' }), bicho({ brinco: '0702' })]));
  const [v, mo, at] = ini.dados.animais.map((x) => x.animal_id);
  m.run('registrar', { tipo: 'DESCARTE', campos: { event_date: '2026-02-01', destino: 'PERMUTA', motivo: 'IDADE' }, animais: [{ animal_id: v }] });
  m.run('registrar', { tipo: 'MORTE', campos: { event_date: '2026-02-01', causa: 'DOENCA' }, animais: [{ animal_id: mo }] });
  assert.equal(m.animal(v).custo_aquisicao, 200000, 'custo da abertura enquanto estava no rebanho');
  const ext = c.run('AnimalService.comandoCadastrarExterno', { campos: { nome: 'Touro do sêmen', sexo: 'M' } }).dados.animal_id;
  const base = { modalidade: 'CABECA', preco_unitario: 150000, valor_animais: 150000 };
  const par = { parcelas: [{ data_vencimento: '2026-04-01' }] };
  assert.deepEqual(codigos(falha(m, 'registrar', compra('2026-03-01', f, PASTOS.B, [{ animal_id: mo }], base, par))), ['ANIMAL_MORTO']);
  assert.deepEqual(codigos(falha(m, 'registrar', compra('2026-03-01', f, PASTOS.B, [{ animal_id: at }], base, par))), ['JA_NO_REBANHO']);
  assert.deepEqual(codigos(falha(m, 'registrar', compra('2026-03-01', f, PASTOS.B, [{ animal_id: ext }], base, par))), ['ANIMAL_EXTERNO']);
  assert.deepEqual(codigos(falha(m, 'registrar', compra('2026-03-01', f, PASTOS.B, [{ animal_id: v, sexo: 'M' }], base, par))), ['CAMPO_NAO_SE_APLICA'], 'na volta não se muda o cadastro');
  const r = m.run('registrar', compra('2026-03-01', f, PASTOS.B, [{ animal_id: v, peso: 410, brinco_origem: 'V-77' }], base, par));
  const a = m.animal(v);
  assert.deepEqual([a.situacao_cadastral, a.pasto_atual_id, a.custo_aquisicao, a.custo_aquisicao_origem, a.data_entrada, a.peso_atual, a.brinco, a.sexo], ['ATIVO', PASTOS.B, 150000, 'NEGOCIADO', '2026-03-01', 410, '0700', 'F']);
  assert.deepEqual(doEvento(m, 'IDENTIFICACOES', r.dados.event_id).map((x) => [x.tipo, x.codigo]), [['BRINCO_ORIGEM', 'V-77']]);
  assert.equal(doEvento(m, 'EVENTO_ANIMAIS', r.dados.event_id)[0].atributos_iniciais_json, null, 'o animal não é criado de novo');
  // A ficha mostra os dois lançamentos do animal (abertura e compra), e o custo de aquisição é só o do período atual.
  const h = ficha(c, v).financeiro;
  assert.deepEqual([h.custo_aquisicao, h.lancamentos.map((x) => x.valor_alocado).sort()], [150000, [150000, 200000]]);
  // O estorno da compra devolve o animal a DESCARTADO, com o custo do período anterior.
  m.run('estornar', { event_id: r.dados.event_id, justificativa: 'Lançada por engano' });
  assert.deepEqual([m.animal(v).situacao_cadastral, m.animal(v).custo_aquisicao], ['DESCARTADO', 200000]);
  assert.ok(G);
});

// ------------------------------------------------------------------ estorno ----
test('estorno de compra: animais anulados, lançamentos cancelados pela vigência (parcelas não são regravadas), nada a pagar; com transferência posterior → CONFLICT com o evento', () => {
  const amb = ambiente();
  const { c, m } = amb;
  const f = amb.parceiro('Fornecedor', 'FORNECEDOR');
  const dados = compra('2026-02-05', f, PASTOS.A, [garrote('0801'), garrote('0802'), garrote('0803')], { modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 900000 },
    { parcelas: [{ data_vencimento: '2026-03-05', valor: 450000 }, { data_vencimento: '2026-04-05', valor: 450000 }], custos: [{ tipo: 'FRETE', valor: 3000 }] });
  const r = m.run('registrar', dados);
  const ids = r.dados.animais.map((x) => x.animal_id);
  const t = m.run('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: ids[2] }] });
  const e = falha(m, 'estornar', { event_id: r.dados.event_id, justificativa: 'teste' });
  assert.equal(e.code, 'CONFLICT');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.animal_id, d.conflito.event_id, d.conflito.tipo, d.conflito.data]), [['EVENTO_DEPENDENTE', ids[2], t.dados.event_id, 'TRANSFERENCIA', '2026-03-01']]);
  assert.match(e.message, /0803: tem a transferência de 01\/03\/2026, que depende desta entrada/);
  // Estorna a transferência; agora a compra sai.
  m.run('estornar', { event_id: t.dados.event_id, justificativa: 'errada' });
  const parcelasAntes = m.tabela('PARCELAS');
  const est = m.run('estornar', { event_id: r.dados.event_id, justificativa: 'Compra desfeita' });
  assert.ok(ids.every((id) => m.animal(id).situacao_cadastral === 'ANULADO' && m.animal(id).custo_aquisicao === null));
  const fins = doEvento(m, 'FINANCEIRO', r.dados.event_id);
  assert.deepEqual(fins.map((x) => [x.status, x.status_pagamento, x.cancelado_por_event_id]), [['CANCELADO', 'CANCELADO', est.dados.event_id], ['CANCELADO', 'CANCELADO', est.dados.event_id]]);
  assert.ok(fins.every((x) => x.cancelado_em === m.evento(est.dados.event_id).created_at));
  assert.deepEqual(m.tabela('PARCELAS'), parcelasAntes, 'as parcelas de lançamento cancelado não são regravadas (desenho-base 16.11)');
  assert.equal(titulos(c).a_pagar, 0, 'nada a pagar: o lançamento deixou de valer');
  assert.equal(m.evento(r.dados.event_id).status, 'ESTORNADO');
  // O brinco do animal anulado fica livre.
  m.run('registrar', compra('2026-02-06', f, PASTOS.A, [garrote('0801')], { modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 300000 }, { parcelas: [{ data_vencimento: '2026-03-05' }] }));
  // Estorno com parcela paga (a baixa chega na Fase 4): recusado — simulado com a parcela liquidada à mão.
  const r2 = m.run('registrar', compra('2026-02-07', f, PASTOS.A, [garrote('0901')], { modalidade: 'CABECA', preco_unitario: 100000, valor_animais: 100000 }, { parcelas: [{ data_vencimento: '2026-03-05' }] }));
  const p = m.tabela('PARCELAS').find((x) => x.financial_id === doEvento(m, 'FINANCEIRO', r2.dados.event_id)[0].financial_id);
  editar(m, 'PARCELAS', p.parcela_id, 'status', 'LIQUIDADA');
  const liq = m.amb.tentarRun(m.comando('estornar', { event_id: r2.dados.event_id, justificativa: 'x' }));
  assert.equal(liq.ok, false);
  assert.equal(liq.erro.code, 'CONFLICT');
  assert.deepEqual(js(liq.erro.details).map((d) => d.codigo), ['PARCELA_LIQUIDADA']);
});

test('compra retroativa e correção de data: lançada depois de outros eventos com data passada; mudar a data para depois da transferência → CONFLICT; para antes → aceita', () => {
  const amb = ambiente();
  const { m } = amb;
  const f = amb.parceiro('Fornecedor', 'FORNECEDOR');
  const ini = m.run('registrar', entradaInicial([bicho({ brinco: '0100' })]));
  m.run('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-06-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: ini.dados.animais[0].animal_id }] });
  // Retroativa: a compra de 10/03 é lançada depois da transferência de junho de outro animal.
  const base = { modalidade: 'CABECA', preco_unitario: 200000, valor_animais: 400000 };
  const dados = compra('2026-03-10', f, PASTOS.A, [garrote('1101'), garrote('1102')], base, { parcelas: [{ data_vencimento: '2026-04-10' }] });
  const r = m.run('registrar', dados);
  const ids = r.dados.animais.map((x) => x.animal_id);
  const t = m.run('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-04-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.C }, animais: [{ animal_id: ids[0] }] });
  const animaisCorr = ids.map((id, i) => Object.assign(garrote('110' + (i + 1)), { animal_id: id }));
  const corr = (data) => ({ tipo: 'COMPRA', event_id: r.dados.event_id, justificativa: 'Data errada', campos: Object.assign({}, dados.campos, { event_date: data }), animais: animaisCorr, parcelas: dados.parcelas });
  const e = falha(m, 'corrigir', corr('2026-04-15'));
  assert.equal(e.code, 'CONFLICT');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.conflito.event_id, d.conflito.tipo]), [['FORA_DO_REBANHO', t.dados.event_id, 'TRANSFERENCIA']]);
  const ok = m.run('corrigir', corr('2026-03-01'));
  assert.deepEqual(ids.map((id) => [m.animal(id).data_entrada, m.animal(id).evento_origem_id]), [['2026-03-01', ok.dados.event_id], ['2026-03-01', ok.dados.event_id]]);
  assert.equal(doEvento(m, 'FINANCEIRO', ok.dados.event_id)[0].data_competencia, '2026-03-01');
  assert.deepEqual(m.invariantes(), []);
});

// ------------------------------------------------------------------ correção (CT-18, Fase 2) ----
test('CT-18 na Fase 2 (04, 5.2 iv): corrigir a compra (brinco 0802 → 0812 e frete de 30,00 para 300,00) mantém os animal_id; a transferência segue; lançamentos antigos cancelados; tirar o 0803 → CONFLICT', () => {
  const amb = ambiente();
  const { c, m } = amb;
  const f = amb.parceiro('Fornecedor', 'FORNECEDOR');
  const tr = amb.parceiro('Frete Rápido', 'TRANSPORTADOR');
  const dados = compra('2026-02-05', f, PASTOS.A, [garrote('0801'), garrote('0802'), garrote('0803')], { modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 900000 },
    { parcelas: [{ data_vencimento: '2026-03-05', valor: 450000 }, { data_vencimento: '2026-04-05', valor: 450000 }], custos: [{ tipo: 'FRETE', valor: 3000, partner_id: tr }] });
  const r = m.run('registrar', dados);
  const ids = r.dados.animais.map((x) => x.animal_id);
  const codigosInt = ids.map((id) => m.animal(id).codigo_interno);
  assert.ok(ids.every((id) => m.animal(id).custo_aquisicao === 301000), 'R$ 3.000,00 + R$ 30,00 ÷ 3');
  const t = m.run('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: ids.map((animal_id) => ({ animal_id })) });
  const finsAntes = doEvento(m, 'FINANCEIRO', r.dados.event_id);
  const ops0 = m.tabela('OPERACOES').length;
  const animais = ids.map((id, i) => Object.assign(garrote(['0801', '0812', '0803'][i]), { animal_id: id }));
  const corrigida = { tipo: 'COMPRA', event_id: r.dados.event_id, justificativa: 'Brinco e frete digitados errado', campos: dados.campos, animais, parcelas: dados.parcelas, custos: [{ tipo: 'FRETE', valor: 30000, partner_id: tr }] };
  const sim = m.simular('corrigir', corrigida).valor.dados;
  assert.deepEqual([sim.impactos.substitui, sim.impactos.novos, sim.impactos.compra.valor_total], [r.dados.event_id, 0, 930000]);
  const k = m.run('corrigir', corrigida);
  assert.equal(m.tabela('OPERACOES').length, ops0 + 1, 'um só commit');
  assert.equal(m.evento(r.dados.event_id).status, 'ESTORNADO');
  assert.equal(m.evento(r.dados.event_id).reversed_by_event_id, k.dados.event_id);
  assert.deepEqual(ids.map((id) => [m.animal(id).codigo_interno, m.animal(id).evento_origem_id, m.animal(id).situacao_cadastral, m.animal(id).pasto_atual_id]),
    codigosInt.map((ci) => [ci, k.dados.event_id, 'ATIVO', PASTOS.B]), 'mesmas linhas, mesmos animal_id e códigos; a transferência segue valendo');
  assert.equal(m.tabela('ANIMAIS').length, 3);
  assert.equal(m.animal(ids[1]).brinco, '0812');
  assert.equal(m.evento(t.dados.event_id).status, 'CONFIRMADO');
  assert.ok(ids.every((id) => m.animal(id).custo_aquisicao === 310000), 'de R$ 3.010,00 para R$ 3.100,00 por animal');
  assert.ok(finsAntes.every((x) => m.tabela('FINANCEIRO').find((y) => y.financial_id === x.financial_id).status === 'CANCELADO'));
  assert.deepEqual(doEvento(m, 'FINANCEIRO', k.dados.event_id).map((x) => [x.valor, x.status]), [[900000, 'ATIVO'], [30000, 'ATIVO']]);
  assert.equal(titulos(c).a_pagar, 930000);
  // Unicidade no estado final: trocar os brincos 0801 e 0803 entre si vale; pôr num deles o brinco de outro animal, não.
  const outro = m.run('registrar', compra('2026-02-06', f, PASTOS.A, [garrote('0999')], { modalidade: 'CABECA', preco_unitario: 100000, valor_animais: 100000 }, { parcelas: [{ data_vencimento: '2026-03-05' }] }));
  assert.ok(outro.dados.event_id);
  const dup = falha(m, 'corrigir', Object.assign({}, corrigida, { event_id: k.dados.event_id, animais: ids.map((id, i) => Object.assign(garrote(['0999', '0812', '0803'][i]), { animal_id: id })) }));
  assert.deepEqual(codigos(dup), ['BRINCO_DUPLICADO']);
  const troca = m.run('corrigir', Object.assign({}, corrigida, { event_id: k.dados.event_id, animais: ids.map((id, i) => Object.assign(garrote(['0803', '0812', '0801'][i]), { animal_id: id })) }));
  assert.deepEqual(ids.map((id) => m.animal(id).brinco), ['0803', '0812', '0801']);
  // (2) Retirar o 0801 (antes 0803), que tem a transferência: CONFLICT citando a transferência.
  const sem = falha(m, 'corrigir', Object.assign({}, corrigida, { event_id: troca.dados.event_id, animais: ids.slice(0, 2).map((id, i) => Object.assign(garrote(['0803', '0812'][i]), { animal_id: id })), campos: Object.assign({}, dados.campos, { valor_animais: 600000, preco_unitario: 300000 }), parcelas: [{ data_vencimento: '2026-03-05' }] }));
  assert.equal(sem.code, 'CONFLICT');
  assert.deepEqual(sem.details.map((d) => [d.codigo, d.animal_id, d.conflito.event_id]), [['EVENTO_DEPENDENTE', ids[2], t.dados.event_id]]);
  // Correção de outro tipo e de evento já corrigido: recusadas.
  assert.deepEqual(codigos(falha(m, 'corrigir', Object.assign({}, corrigida, { event_id: r.dados.event_id }))), ['JA_ANULADO']);
  assert.deepEqual(codigos(falha(m, 'corrigir', { tipo: 'MORTE', event_id: troca.dados.event_id, justificativa: 'x', campos: { event_date: '2026-03-01', causa: 'DOENCA' }, animais: [{ animal_id: ids[0] }] })), ['TIPO_DIFERENTE']);
});

// ------------------------------------------------------------------ morte e descarte com financeiro ----
test('MORTE com custos associados (CUSTEIO na conta escolhida, rateio por cabeça) e DESCARTE com receita simples (OUTRA_RECEITA): estorno e correção', () => {
  const amb = ambiente();
  const { c, m } = amb;
  const vet = amb.parceiro('Dra. Ana', 'VETERINARIO');
  const ini = m.run('registrar', entradaInicial([bicho({ brinco: '0301' }), bicho({ brinco: '0302' }), bicho({ brinco: '0303' })]));
  const [a1, a2, a3] = ini.dados.animais.map((x) => x.animal_id);
  const contas = Object.fromEntries(m.linhas.PLANO_CONTAS.map((x) => [x.codigo, x.conta_id]));
  const morte = (ids, campos) => ({ tipo: 'MORTE', campos: Object.assign({ event_date: '2026-03-01', causa: 'DOENCA' }, campos || {}), animais: ids.map((animal_id) => ({ animal_id })) });
  assert.deepEqual(codigos(falha(m, 'registrar', morte([a1], { custo_valor: 30000 }))), ['CAMPO_OBRIGATORIO'], 'custo sem a conta');
  assert.deepEqual(codigos(falha(m, 'registrar', morte([a1], { custo_valor: 30000, custo_conta_id: contas.COMPRA_ANIMAIS }))), ['CONTA_INVALIDA'], 'só conta de custeio');
  assert.deepEqual(codigos(falha(m, 'registrar', morte([a1], { custo_conta_id: contas.TRATAMENTOS }))), ['CAMPO_NAO_SE_APLICA'], 'conta sem valor');
  const r = m.run('registrar', morte([a1, a2], { custo_valor: 30001, custo_conta_id: contas.SERVICOS_VETERINARIOS, custo_partner_id: vet, custo_vencimento: '2026-03-10', custo_forma_pagamento: 'PIX' }));
  const fin = doEvento(m, 'FINANCEIRO', r.dados.event_id);
  assert.deepEqual(fin.map((x) => [x.natureza, x.valor, x.partner_id, x.descricao, x.status_pagamento]), [['CUSTEIO', 30001, vet, 'Custos da morte de 01/03/2026', 'ABERTO']]);
  assert.deepEqual(m.tabela('ALOCACOES_FINANCEIRAS').filter((x) => x.financial_id === fin[0].financial_id).map((x) => x.valor_alocado), [15001, 15000]);
  assert.equal(m.evento(r.dados.event_id).total_value, 30001);
  assert.deepEqual([m.animal(a1).situacao_cadastral, m.animal(a1).custo_aquisicao], ['MORTO', null], 'custeio não é custo de aquisição');
  const h = ficha(c, a1).financeiro;
  assert.deepEqual([h.custeio, h.lancamentos.length, h.resultado.valor, h.resultado.motivo], [15001, 1, null, 'DADOS_INSUFICIENTES']);
  assert.equal(titulos(c).a_pagar, 30001);
  // Correção: o valor muda (lançamento novo, o antigo cancelado); os animais e a data continuam.
  const k = m.run('corrigir', Object.assign(morte([a1, a2], { custo_valor: 40000, custo_conta_id: contas.SERVICOS_VETERINARIOS, custo_partner_id: vet }), { event_id: r.dados.event_id, justificativa: 'Valor da nota' }));
  assert.equal(fin.every((x) => m.tabela('FINANCEIRO').find((y) => y.financial_id === x.financial_id).status === 'CANCELADO'), true);
  assert.deepEqual(doEvento(m, 'FINANCEIRO', k.dados.event_id).map((x) => x.valor), [40000]);
  assert.equal(titulos(c).a_pagar, 40000);
  // Estorno: os animais voltam e o custo sai.
  m.run('estornar', { event_id: k.dados.event_id, justificativa: 'Não morreram' });
  assert.deepEqual([m.animal(a1).situacao_cadastral, titulos(c).a_pagar], ['ATIVO', 0]);
  // DESCARTE de um animal com receita (permuta valorada): DIRETO, a receber.
  const d = m.run('registrar', { tipo: 'DESCARTE', campos: { event_date: '2026-03-05', destino: 'PERMUTA', motivo: 'IDADE', receita_valor: 120000, receita_partner_id: vet }, animais: [{ animal_id: a3 }] });
  const fd = doEvento(m, 'FINANCEIRO', d.dados.event_id);
  assert.deepEqual(fd.map((x) => [x.natureza, x.tipo, x.valor, x.animal_id, x.descricao]), [['OUTRA_RECEITA', 'RECEITA', 120000, a3, 'Receita do descarte de 05/03/2026']]);
  assert.deepEqual([m.evento(d.dados.event_id).partner_id, m.evento(d.dados.event_id).total_value], [vet, 120000]);
  assert.deepEqual([titulos(c).a_receber, titulos(c).a_pagar], [120000, 0]);
  assert.deepEqual(m.tabela('PARCELAS').filter((p) => p.financial_id === fd[0].financial_id).map((p) => [p.data_vencimento, p.valor]), [['2026-03-05', 120000]], 'vencimento vazio = à vista');
  const hd = ficha(c, a3).financeiro;
  assert.deepEqual([hd.receitas, hd.resultado.valor], [120000, null], 'sem custo de aquisição conhecido, o resultado não é calculado');
  const kd = m.run('corrigir', { tipo: 'DESCARTE', event_id: d.dados.event_id, justificativa: 'Sem receita', campos: { event_date: '2026-03-05', destino: 'DOACAO', motivo: 'IDADE' }, animais: [{ animal_id: a3 }] });
  assert.deepEqual([doEvento(m, 'FINANCEIRO', kd.dados.event_id).length, titulos(c).a_receber, m.evento(kd.dados.event_id).total_value], [0, 0, null]);
  m.run('estornar', { event_id: kd.dados.event_id, justificativa: 'Não saiu' });
  assert.equal(m.animal(a3).situacao_cadastral, 'ATIVO');
});

// ------------------------------------------------------------------ invariantes ----
test('invariantes de 03b, seção 14: a conferência (reutilizada pela integridade) pega cada adulteração feita à mão e volta a zero quando se desfaz', () => {
  const amb = ambiente();
  const { m } = amb;
  const f = amb.parceiro('Fornecedor', 'FORNECEDOR');
  const r = m.run('registrar', compra('2026-02-05', f, PASTOS.A, [garrote('1201', { peso: 200 }), garrote('1202', { peso: 210 })], { modalidade: 'KG_VIVO', preco_unitario: 1000, valor_animais: 410000 },
    { parcelas: [{ data_vencimento: '2026-03-05' }, { data_vencimento: '2026-04-05' }], custos: [{ tipo: 'FRETE', valor: 8000 }] }));
  const ev = r.dados.event_id;
  const [fin, frete] = doEvento(m, 'FINANCEIRO', ev);
  const parc = m.tabela('PARCELAS').filter((p) => p.financial_id === fin.financial_id);
  const aloc = m.tabela('ALOCACOES_FINANCEIRAS').filter((x) => x.financial_id === fin.financial_id);
  const rat = doEvento(m, 'RATEIOS', ev)[0];
  const cp = doEvento(m, 'COMPRAS', ev)[0];
  const animal = m.animal(r.dados.animais[0].animal_id);
  const casos = [
    ['PARCELAS', parc[0].parcela_id, 'valor', 200000, 205000, [3]],
    ['ALOCACOES_FINANCEIRAS', aloc[0].alloc_id, 'valor_alocado', 200001, aloc[0].valor_alocado, [8, 15, 18]],
    ['RATEIOS', rat.rateio_id, 'base_total', 999, rat.base_total, [8]],
    ['FINANCEIRO', fin.financial_id, 'natureza', 'CUSTEIO', 'AQUISICAO_ANIMAIS', [2, 18]],
    ['FINANCEIRO', fin.financial_id, 'status_pagamento', 'LIQUIDADO', 'ABERTO', [6]],
    ['FINANCEIRO', frete.financial_id, 'animal_id', animal.animal_id, '', [12]],
    ['RATEIOS', rat.rateio_id, 'criterio', 'DIRETO', 'PESO_VIVO', [13]],
    ['COMPRAS', cp.purchase_id, 'valor_total', 999999, 418000, [16]],
    ['COMPRAS', cp.purchase_id, 'frete', 7000, 8000, [16]],
    ['EVENTOS', ev, 'total_value', 1, 418000, [16]],
    ['ANIMAIS', animal.animal_id, 'custo_aquisicao', 1, animal.custo_aquisicao, [18]],
    ['PARCELAS', parc[1].parcela_id, 'juros_multa', 10, '', [5]],
  ];
  for (const [aba, idReg, col, ruim, bom, esperado] of casos) {
    editar(m, aba, idReg, col, ruim);
    const achados = m.invariantes();
    assert.deepEqual([...new Set(achados.map((a) => a.invariante))].sort((x, y) => x - y), esperado, aba + '.' + col + ': ' + JSON.stringify(achados));
    assert.ok(achados.every((a) => typeof a.mensagem === 'string' && a.mensagem.length > 10));
    editar(m, aba, idReg, col, bom);
    assert.deepEqual(m.invariantes(), [], aba + '.' + col + ' desfeito');
  }
  // 19 e 20: lançamento estornado com parcela paga; o predicado tira as filhas do lançamento cancelado.
  m.run('estornar', { event_id: ev, justificativa: 'teste' });
  editar(m, 'PARCELAS', parc[0].parcela_id, 'status', 'LIQUIDADA');
  assert.deepEqual([...new Set(m.invariantes().map((a) => a.invariante))], [19]);
});

// ------------------------------------------------------------------ rotas ----
test('rotas pela api(): parceiro.salvar, evento.simular e evento.registrar de compra, evento.obter com COMPRAS e PARCELAS, animal.ficha (bloco H), dashboard.obter com os títulos', () => {
  const s = S.sistema();
  const chamar = (p) => JSON.parse(JSON.stringify(s.gas.exec(() => s.G.api(p))));
  const f = chamar({ rota: 'parceiro.salvar', idempotencyKey: 'p1', dados: { campos: { nome: 'Fazenda Vizinha', tipos: ['FORNECEDOR'], telefone: '+55 69 99999-0000' } } });
  assert.equal(f.ok, true, JSON.stringify(f.error));
  const fornecedor = f.data.partner_id;
  const dados = compra('2026-02-05', fornecedor, S.PASTOS.B, [garrote('7001', { peso: 250 }), garrote('7002', { peso: 260 })], { modalidade: 'KG_VIVO', preco_unitario: 1500, valor_animais: 765000 },
    { parcelas: [{ data_vencimento: '2026-03-05', forma_pagamento: 'BOLETO' }], custos: [{ tipo: 'FRETE', valor: 10000 }] });
  const sim = chamar({ rota: 'evento.simular', dados: { acao: 'registrar', dados } });
  assert.equal(sim.ok, true, JSON.stringify(sim.error));
  assert.deepEqual([sim.data.impactos.compra.valor_total, sim.data.impactos.financeiro.lancamentos.length, sim.data.impactos.financeiro.a_pagar], [775000, 2, 775000]);
  const reg = chamar({ rota: 'evento.registrar', idempotencyKey: 'compra-api', dados, dataVersionEsperada: sim.meta.dataVersion });
  assert.equal(reg.ok, true, JSON.stringify(reg.error));
  const ob = chamar({ rota: 'evento.obter', dados: { event_id: reg.data.event_id } });
  assert.deepEqual([ob.data.evento.partner_id, ob.data.detalhes.COMPRAS.length, ob.data.detalhes.FINANCEIRO.length, ob.data.detalhes.PARCELAS.length, ob.data.detalhes.ALOCACOES_FINANCEIRAS.length], [fornecedor, 1, 2, 2, 4]);
  const fi = chamar({ rota: 'animal.ficha', dados: { animal_id: reg.data.animais[0].animal_id } });
  assert.deepEqual([fi.data.financeiro.entregue, fi.data.financeiro.custo_aquisicao, fi.data.financeiro.lancamentos.length], [true, 375000 + 4902, 2]);
  const dash = chamar({ rota: 'dashboard.obter', dados: {} });
  assert.deepEqual([dash.data.titulos.a_pagar, dash.data.titulos.a_receber], [775000, 0]);
  const boot = chamar({ rota: 'sistema.bootstrap', dados: {} });
  assert.ok(boot.data.catalogo.tipos.some((t) => t.tipo === 'COMPRA') && boot.data.contas.length === 29 && boot.data.parceiros.length === 1);
  // A integridade completa continua limpa com compra, parcelas e alocações.
  const integ = chamar({ rota: 'sistema.integridade', dados: {} });
  assert.equal(integ.data.ok, true, JSON.stringify(integ.data.achados));
  assert.equal(integ.data.alertas, 0, JSON.stringify(integ.data.achados));
  // A verificação de integridade pode rodar a conferência das invariantes sobre o mesmo banco.
  const inv = s.read({ rota: 'teste.invariantes', reads: s.G.FinancialService.leituras(), acessoCru: true, tratador: (tx) => s.G.FinancialService.conferir(tx) });
  assert.deepEqual(inv, []);
});

test('período financeiro fechado (RN-082): compra, correção e estorno com competência até fin_bloqueio_ate pedem um aviso só, com justificativa', () => {
  const amb = ambiente({ config: { fin_bloqueio_ate: '2026-03-31' } });
  const { m } = amb;
  const f = amb.parceiro('Fornecedor', 'FORNECEDOR');
  const dados = compra('2026-03-10', f, PASTOS.A, [garrote('1301'), garrote('1302')], { modalidade: 'CABECA', preco_unitario: 100000, valor_animais: 200000 },
    { parcelas: [{ data_vencimento: '2026-04-10' }], custos: [{ tipo: 'FRETE', valor: 1000 }] });
  const av = falha(m, 'registrar', dados);
  assert.deepEqual([av.code, codigos(av)], ['NEEDS_CONFIRMATION', ['PERIODO_BLOQUEADO']], 'um aviso só, embora haja dois lançamentos');
  const semJust = falha(m, 'registrar', dados, { avisos: ['PERIODO_BLOQUEADO'] });
  assert.deepEqual(codigos(semJust), ['CAMPO_OBRIGATORIO']);
  const r = m.run('registrar', Object.assign({}, dados, { justificativa_aviso: 'Nota que chegou atrasada' }), { avisos: ['PERIODO_BLOQUEADO'] });
  assert.deepEqual(m.evento(r.dados.event_id).payload_json.avisos_aceitos, [{ codigo: 'PERIODO_BLOQUEADO', n: 1, justificativa: 'Nota que chegou atrasada' }]);
  // Corrigir para depois do período ainda cancela lançamentos do período fechado: aviso.
  const corr = { tipo: 'COMPRA', event_id: r.dados.event_id, justificativa: 'Data', campos: Object.assign({}, dados.campos, { event_date: '2026-04-02' }),
    animais: r.dados.animais.map((a, i) => Object.assign(garrote('130' + (i + 1)), { animal_id: a.animal_id })), parcelas: dados.parcelas, custos: dados.custos };
  assert.deepEqual(codigos(falha(m, 'corrigir', corr)), ['PERIODO_BLOQUEADO']);
  const k = m.run('corrigir', Object.assign({}, corr, { justificativa_aviso: 'Data certa é abril' }), { avisos: ['PERIODO_BLOQUEADO'] });
  // O estorno da correção (abril) não mexe no período fechado: sem aviso.
  assert.ok(m.run('estornar', { event_id: k.dados.event_id, justificativa: 'Desfeita' }).dados.event_id);
});
