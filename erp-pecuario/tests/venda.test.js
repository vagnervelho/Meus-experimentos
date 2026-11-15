'use strict';
/**
 * VENDA (E2.4) com o financeiro completo do próprio evento (P11): CT-04 e CT-14 com os números de 09, os exemplos de
 * 07, seção 4.3 (bruto, deduções, líquido, depósito esperado, preços médios e o equivalente em arrobas), os exemplos 4
 * e 5 de 03b, seção 4.4, o resultado por animal do caso de 07, seção 2.2 (bloco H da ficha), a carência (RN-072; 05,
 * seção 4.8: SANIDADE gravada pelo harness, pois o evento chega na Fase 3), as validações por animal (fora do rebanho,
 * saída posterior, pasto divergente, repetido), o estorno (o animal volta na posição certa da linha do tempo;
 * lançamentos cancelados pela vigência) e a correção, inclusive com evento posterior dependente e retroativa, e as
 * rotas pela api(). Depois de CADA comando o apoio confere projeção = reconstrução e as invariantes de 03b, seção 14.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./apoio-cadastros');
const S = require('./apoio-sistema');

const { js, PASTOS, PROP, bicho, entradaInicial, codigos } = C;

function ambiente(opcoes) {
  const c = C.ambienteCadastros(opcoes);
  const parceiro = (nome, tipos, extra) => c.run('Config.comandoSalvarParceiro', { campos: Object.assign({ nome, tipos }, extra || {}) }).dados.partner_id;
  return { c, m: c.m, G: c.G, parceiro };
}
function boi(brinco, extra) {
  return bicho(Object.assign({ brinco, sexo: 'M', castrado: true, reprodutor: false, data_nascimento: '2023-06-01', data_nascimento_confianca: 'ESTIMADA' }, extra || {}));
}
/** Animais no marco zero (Pasto A por padrão); devolve {brinco: animal_id}. */
function rebanho(m, animais) {
  const r = m.run('registrar', entradaInicial(animais));
  const ids = {};
  r.dados.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}
function venda(data, comprador, animais, campos, extra) {
  return Object.assign({ tipo: 'VENDA', campos: Object.assign({ event_date: data, partner_id: comprador, finalidade: 'RECRIA_ENGORDA' }, campos || {}), animais }, extra || {});
}
function falha(m, acao, dados, op) {
  const r = m.tentar(acao, dados, op);
  assert.equal(r.ok, false, 'o comando deveria ter sido recusado');
  return r.erro;
}
const ficha = (c, id) => c.ler(c.G.AnimalService.consultaFicha({ animal_id: id }));
const doEvento = (m, aba, eventId) => m.tabela(aba).filter((r) => r.event_id === eventId);
const parcelasDe = (m, fin) => m.tabela('PARCELAS').filter((p) => p.financial_id === fin.financial_id);
const alocDe = (m, fin) => m.tabela('ALOCACOES_FINANCEIRAS').filter((x) => x.financial_id === fin.financial_id);
const titulos = (c, data) => c.lerCom(['FINANCEIRO', 'PARCELAS'], (tx, G) => G.FinancialService.titulos(tx.repo, data || null));
function editar(m, aba, idReg, coluna, valor) {
  const banco = m.amb.banco;
  const mat = m.gas.planilhas.matriz(banco, aba);
  const cab = mat[0];
  const ip = cab.indexOf(m.G.Schema.pk(aba));
  const linha = mat.findIndex((l, i) => i > 0 && l[ip] === idReg) + 1;
  assert.ok(linha > 1 && cab.indexOf(coluna) >= 0, aba + '.' + coluna);
  const celula = typeof valor === 'number' && m.G.Schema.coluna(aba, coluna).tipo === 'DINHEIRO' ? valor / 100 : valor;
  m.gas.planilhas.gravar(banco, aba, linha, cab.indexOf(coluna) + 1, [[celula]]);
}
/**
 * Aplicação sanitária gravada pelo harness (o evento SANIDADE chega na Fase 3): operação CONFIRMADA, evento
 * vigente com a linha do animal (fato, efeito 0) e a linha de SANIDADE com o período de carência.
 */
let nSanidade = 0;
function sanidade(m, animalId, data, dias, extra) {
  const G = m.G;
  const k = ++nSanidade;
  const ev = C.id(0xe000 + k);
  const op = C.id(0xd000 + k);
  const agora = '2026-11-13T14:00:00.000Z';
  const linhas = {
    OPERACOES: [{ op_id: op, idempotency_key: 'sanidade-' + k, payload_hash: 'f'.repeat(64), comando: 'teste.sanidade', status: 'CONFIRMADA', aplicada_em: agora, resumo_json: { event_id: ev }, usuario: 'dono@gmail.com', started_at: agora, finished_at: agora }],
    EVENTOS: [{ event_id: ev, op_id: op, event_seq: 5000 + k, event_type: 'SANIDADE', event_subtype: 'VERMIFUGACAO', event_date: data, registration_date: data, property_id: PROP, status: 'CONFIRMADO', created_by: 'dono@gmail.com', source: 'SISTEMA', confiabilidade: 'CONFIRMADA', pre_marco_zero: false, idempotency_key: 'sanidade-' + k, created_at: agora, confirmed_at: agora }],
    EVENTO_ANIMAIS: [{ event_animal_id: C.id(0xc000 + k), event_id: ev, animal_id: animalId, papel: 'SUJEITO', efeito_inventario: 0 }],
    SANIDADE: [Object.assign({ health_id: C.id(0xb000 + k), animal_id: animalId, event_id: ev, tipo_procedimento: 'VERMIFUGO', nome_produto: 'Ivermectina 1%', dose: 5, unidade_dose: 'mL', motivo: 'Verminose', data_aplicacao: data, periodo_carencia_dias: dias }, extra || {})],
  };
  m.gas.exec(() => G.Database.abrir(m.amb.banco, { primitiva: m.amb.primitiva }).anexar(linhas));
  return ev;
}

// ------------------------------------------------------------------ HealthService (05, seção 4.8) ----
test('carência (RN-072, 05 seção 4.8): fim = aplicação + dias; em carência até o último dia inclusive; aplicação depois da data não conta', () => {
  const G = C.ambienteEventos().G;
  const H = G.HealthService;
  assert.equal(H.fimCarencia({ data_aplicacao: '2026-11-01', periodo_carencia_dias: 35 }), '2026-12-06', 'vermífugo em 01/11 com 35 dias → até 06/12');
  assert.equal(H.fimCarencia({ data_aplicacao: '2026-11-01', periodo_carencia_dias: 35, data_fim_carencia: '2026-12-10' }), '2026-12-10', 'vale a data gravada');
  assert.equal(H.fimCarencia({ data_aplicacao: '2026-11-01', periodo_carencia_dias: 0 }), null, 'sem período, sem carência');
  assert.equal(H.fimCarencia({ data_aplicacao: '2026-11-01' }), null);
  assert.equal(H.fimCarencia({ periodo_carencia_dias: 10 }), null, 'sem aplicação, sem carência');
  const regs = [
    { health_id: 'h1', data_aplicacao: '2026-11-01', periodo_carencia_dias: 35, nome_produto: 'Ivermectina' },
    { health_id: 'h2', data_aplicacao: '2026-10-01', periodo_carencia_dias: 10 },
    { health_id: 'h3', data_aplicacao: '2026-11-20', periodo_carencia_dias: 60 },
  ];
  assert.deepEqual(js(H.carenciaEm(regs, '2026-11-13')), { fim: '2026-12-06', health_id: 'h1', event_id: null, nome_produto: 'Ivermectina', data_aplicacao: '2026-11-01', tipo_procedimento: null });
  assert.equal(H.carenciaEm(regs.slice(0, 2), '2026-12-06').fim, '2026-12-06', 'o último dia ainda está em carência');
  assert.equal(H.carenciaEm(regs.slice(0, 2), '2026-12-07'), null, 'livre no dia seguinte');
  assert.equal(H.carenciaEm(regs, '2026-11-19').health_id, 'h1', 'a aplicação de 20/11 não vale para uma venda de 19/11');
  assert.equal(H.carenciaEm(regs, '2026-11-20').health_id, 'h3', 'a de maior fim governa');
  assert.equal(H.carenciaEm([], '2026-11-13'), null);
  assert.throws(() => H.carenciaEm(regs, '13/11/2026'), (e) => e.code === 'INTERNAL');
});

// ------------------------------------------------------------------ CT-04 ----
test('CT-04: venda por kg vivo de 0401–0405 — inventário, VENDIDO com o histórico, VENDAS, 5 saídas, 5 PESAGENS, receita 22.760,00 rateada por peso vivo e comissão de 455,20', () => {
  const amb = ambiente();
  const { c, m } = amb;
  const c1 = amb.parceiro('Comprador C1', 'COMPRADOR');
  const brincos = ['0401', '0402', '0403', '0404', '0405'];
  const ids = rebanho(m, brincos.map((b) => boi(b)));
  const pesos = [450, 462, 438, 471, 455];
  const dados = venda('2026-08-20', c1, brincos.map((b, i) => ({ animal_id: ids[b], peso: pesos[i] })), { modalidade: 'KG_VIVO', preco_unitario: 1000, valor_bruto: 2276000 },
    { parcelas: [{ data_vencimento: '2026-09-19', forma_pagamento: 'TRANSFERENCIA' }], deducoes: [{ tipo: 'COMISSAO', valor: 45520 }] });
  const sim = m.simular('registrar', dados).valor.dados;
  assert.deepEqual(js(sim.linhas), { EVENTOS: 1, EVENTO_ANIMAIS: 5, PESAGENS: 5, VENDAS: 1, FINANCEIRO: 2, PARCELAS: 2, RATEIOS: 2, ALOCACOES_FINANCEIRAS: 10 }, '9 abas com OPERACOES');
  const v = sim.impactos.venda;
  assert.deepEqual([v.valor_bruto, v.receita, v.comissao, v.deducoes, v.resultado_negociacao, v.deposito_esperado, v.criterio, v.peso_vivo_total, v.conferencia, v.desvio_pct],
    [2276000, 2276000, 45520, 45520, 2230480, 2276000, 'PESO_VIVO', 2276, 2276000, 0]);
  const r = m.run('registrar', dados, { chave: 'ct04' });
  const ev = r.dados.event_id;
  assert.deepEqual([r.dados.event_type, r.dados.total_value, r.dados.animais.map((a) => a.situacao_cadastral)], ['VENDA', 2276000, ['VENDIDO', 'VENDIDO', 'VENDIDO', 'VENDIDO', 'VENDIDO']]);
  // Inventário: Pasto 1 com 5 em 19/08 e 0 em 20/08; ANIMAIS VENDIDO, saída em 20/08, sem pasto.
  assert.equal(m.inventario('2026-08-19').porPasto[PASTOS.A], 5);
  assert.equal((m.inventario('2026-08-20').porPasto || {})[PASTOS.A] || 0, 0);
  for (const b of brincos) {
    const a = m.animal(ids[b]);
    assert.deepEqual([a.situacao_cadastral, a.data_saida, a.pasto_atual_id, a.propriedade_atual_id, a.brinco], ['VENDIDO', '2026-08-20', null, null, b]);
  }
  // Tabelas: VENDAS 1; EVENTO_ANIMAIS 5 linhas −1 (origem pela linha do tempo); PESAGENS 5 (VENDA); partner_id = C1.
  const vd = doEvento(m, 'VENDAS', ev);
  assert.equal(vd.length, 1);
  assert.deepEqual([vd[0].finalidade, vd[0].modalidade, vd[0].base_peso, vd[0].qtd_animais, vd[0].peso_vivo_total_kg, vd[0].preco_unitario, vd[0].unidade_preco, vd[0].valor_bruto, vd[0].desconto_comercial, vd[0].frete, vd[0].comissao, vd[0].outras_deducoes, vd[0].criterio_rateio],
    ['RECRIA_ENGORDA', 'KG_VIVO', 'VIVO', 5, 2276, 1000, 'KG_VIVO', 2276000, 0, 0, 45520, 0, 'PESO_VIVO']);
  const ea = doEvento(m, 'EVENTO_ANIMAIS', ev);
  assert.deepEqual(ea.map((l) => [l.efeito_inventario, l.pasto_origem_id, l.pasto_destino_id, l.peso, l.valor_individual]),
    [[-1, PASTOS.A, null, 450, 450000], [-1, PASTOS.A, null, 462, 462000], [-1, PASTOS.A, null, 438, 438000], [-1, PASTOS.A, null, 471, 471000], [-1, PASTOS.A, null, 455, 455000]]);
  const pes = doEvento(m, 'PESAGENS', ev);
  assert.deepEqual(pes.map((p) => [p.tipo, p.metodo, p.peso_kg, p.data_pesagem]), pesos.map((p) => ['VENDA', 'BALANCA', p, '2026-08-20']));
  assert.equal(m.animal(ids['0401']).peso_atual, 450, 'o peso da venda é o último do animal');
  assert.equal(m.evento(ev).partner_id, c1);
  // Receita de 22.760,00 com parcela aberta para 19/09, alocada pelo peso; comissão de 455,20 (87,60 a 94,20 por animal).
  const [rec, com] = doEvento(m, 'FINANCEIRO', ev);
  assert.deepEqual([rec.natureza, rec.tipo, rec.valor, rec.quantidade, rec.partner_id, rec.status_pagamento, rec.retida_pelo_comprador], ['RECEITA_VENDA_ANIMAIS', 'RECEITA', 2276000, 5, c1, 'ABERTO', false]);
  assert.deepEqual(parcelasDe(m, rec).map((p) => [p.parcela_num, p.data_vencimento, p.valor, p.status, p.forma_pagamento]), [[1, '2026-09-19', 2276000, 'ABERTA', 'TRANSFERENCIA']]);
  assert.deepEqual(alocDe(m, rec).map((x) => x.valor_alocado), [450000, 462000, 438000, 471000, 455000]);
  assert.deepEqual([com.natureza, com.valor, com.retida_pelo_comprador, com.data_competencia], ['DESPESA_VENDA', 45520, false, '2026-08-20']);
  assert.deepEqual(alocDe(m, com).map((x) => x.valor_alocado), [9000, 9240, 8760, 9420, 9100]);
  assert.deepEqual(parcelasDe(m, com).map((p) => [p.data_vencimento, p.valor]), [['2026-08-20', 45520]], 'comissão sem vencimento = à vista');
  assert.deepEqual(m.evento(ev).payload_json, { deducoes: [{ financial_id: com.financial_id, tipo: 'COMISSAO' }] });
  assert.deepEqual(doEvento(m, 'RATEIOS', ev).map((x) => [x.criterio, x.escopo_tipo, x.base_total, x.total_alocado]), [['PESO_VIVO', 'EVENTO', 2276, 2276000], ['PESO_VIVO', 'EVENTO', 2276, 45520]]);
  // Resultado da negociação: 22.304,80; a receber 22.760,00 e a pagar 455,20.
  assert.equal(rec.valor - com.valor, 2230480);
  assert.deepEqual([titulos(c, '2026-08-31').a_receber, titulos(c, '2026-08-31').a_pagar], [2276000, 45520]);
  // Histórico: a ficha de 0401 mantém a entrada e os registros anteriores; o período no pasto fecha na venda.
  const f = ficha(c, ids['0401']);
  assert.deepEqual(f.eventos.itens.map((x) => [x.event_type, x.vigente]), [['ENTRADA_INICIAL', true], ['VENDA', true]]);
  assert.deepEqual([f.geral.situacao_cadastral, f.geral.data_saida, f.localizacao.pasture_id], ['VENDIDO', '2026-08-20', null]);
  const per = f.pastos.periodos;
  assert.deepEqual([per.length, per[0].pasture_id, per[0].inicio, per[0].fim, per[0].saida.event_type], [1, PASTOS.A, C.D0, '2026-08-20', 'VENDA']);
  assert.deepEqual([f.financeiro.receitas, f.financeiro.despesas_venda, f.financeiro.resultado.valor, f.financeiro.resultado.motivo], [450000, 9000, null, 'DADOS_INSUFICIENTES'], 'sem valor de abertura não há resultado');
  // Reenvio com a mesma chave: duplicado, nada novo. Com chave nova, a linha do tempo recusa (os animais já saíram).
  const n0 = m.contagem();
  const d = m.run('registrar', dados, { chave: 'ct04' });
  assert.deepEqual([d.duplicado, d.dados.event_id, d.dados.total_value], [true, ev, 2276000]);
  const e = falha(m, 'registrar', dados, { chave: 'ct04-de-novo' });
  assert.deepEqual([e.code, [...new Set(codigos(e))], e.details.length], ['VALIDATION', ['FORA_DO_REBANHO'], 5]);
  assert.deepEqual(m.contagem(), n0);
});

// ------------------------------------------------------------------ CT-14 e 07, seção 4.3 ----
test('CT-14 (a) e 07 4.3 (a): frigorífico por arroba de carcaça — 37,00 @, bruto 11.840,00 por PESO_CARCACA, retenção de 177,60, depósito 11.662,40, rendimento 52,4 apurado, pesagens só do peso vivo', () => {
  const amb = ambiente();
  const { c, m, G } = amb;
  const frig = amb.parceiro('Frigorífico Rondônia', 'COMPRADOR');
  const ids = rebanho(m, [boi('A1'), boi('A2')]);
  const dados = venda('2026-11-10', frig, [{ animal_id: ids.A1, peso: 540, peso_carcaca_kg: 285 }, { animal_id: ids.A2, peso: 520, peso_carcaca_kg: 270 }],
    { finalidade: 'ABATE', modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 32000, valor_bruto: 1184000, nota_fiscal: 'NF-555' },
    { parcelas: [{ data_vencimento: '2026-12-10' }], deducoes: [{ tipo: 'FUNRURAL', valor: 17760, retida_pelo_comprador: true }] });
  const v = m.simular('registrar', dados).valor.dados.impactos.venda;
  assert.deepEqual([v.arrobas, v.arroba_base, v.conferencia, v.receita, v.outras_deducoes, v.retidas, v.resultado_negociacao, v.deposito_esperado], [37, 'CARCACA', 1184000, 1184000, 17760, 17760, 1166240, 1166240]);
  assert.deepEqual([v.rendimento_pct, v.rendimento_tipo, v.peso_vivo_total, v.peso_carcaca_total, v.preco_medio_cabeca, v.preco_medio_kg, v.preco_medio_arroba, v.equivalente_arroba], [52.4, 'APURADO', 1060, 555, 592000, 1117, 32000, null],
    'R$ 5.920,00 por cabeça, R$ 11,17 por kg vivo, R$ 320,00 por @ de carcaça');
  const r = m.run('registrar', dados);
  const ev = r.dados.event_id;
  const vd = doEvento(m, 'VENDAS', ev)[0];
  assert.deepEqual([vd.base_peso, vd.rendimento_carcaca_pct, vd.rendimento_tipo, vd.peso_vivo_total_kg, vd.peso_carcaca_total_kg, vd.unidade_preco, vd.criterio_rateio, vd.outras_deducoes, vd.frete, vd.comissao],
    ['CARCACA', 52.4, 'APURADO', 1060, 555, 'ARROBA', 'PESO_CARCACA', 17760, 0, 0]);
  const [rec, ret] = doEvento(m, 'FINANCEIRO', ev);
  assert.deepEqual(alocDe(m, rec).map((x) => [x.base_valor, x.valor_alocado]), [[285, 608000], [270, 576000]], 'F7: 6.080,00 e 5.760,00 (07, 2.2)');
  assert.deepEqual(alocDe(m, ret).map((x) => x.valor_alocado), [9120, 8640], 'F8: 91,20 e 86,40');
  assert.deepEqual([ret.natureza, ret.retida_pelo_comprador, ret.partner_id, ret.descricao], ['DESPESA_VENDA', true, frig, 'Contribuição previdenciária rural retida da venda de 10/11/2026'], 'a retida é do comprador');
  assert.deepEqual(parcelasDe(m, ret).map((p) => [p.data_vencimento, p.valor, p.status]), [['2026-12-10', 17760, 'ABERTA']], 'o título da retenção vence no recebimento: o encontro de contas da Fase 4 liquida os dois');
  assert.deepEqual(js(G.Schema.SEMENTES.PLANO_CONTAS.filter((x) => x.natureza === 'DESPESA_VENDA').map((x) => x.codigo)), ['FRETE_VENDA', 'COMISSAO_VENDA', 'TAXAS_RETENCOES_VENDA']);
  assert.equal(m.tabela('PLANO_CONTAS').find((x) => x.conta_id === ret.conta_id).codigo, 'TAXAS_RETENCOES_VENDA');
  // Peso vivo e carcaça não se confundem: 2 PESAGENS (VENDA) com 540 e 520 kg; a carcaça fica só na linha da venda.
  assert.deepEqual(doEvento(m, 'PESAGENS', ev).map((p) => [p.tipo, p.peso_kg]), [['VENDA', 540], ['VENDA', 520]]);
  assert.deepEqual(doEvento(m, 'EVENTO_ANIMAIS', ev).map((l) => [l.peso, l.peso_carcaca_kg, l.valor_individual]), [[540, 285, 608000], [520, 270, 576000]]);
  // Rateado por peso vivo, A1 receberia 6.031,70 em vez dos 6.080,00 do romaneio (07, 4.3 a): por isso o critério é a carcaça.
  const pv = G.FinancialService.ratear(1184000, 'PESO_VIVO', [{ animal_id: 'a1', chave: 'A-1', base: 540 }, { animal_id: 'a2', chave: 'A-2', base: 520 }]);
  assert.equal(pv.itens[0].valor, 603170);
  assert.deepEqual([titulos(c, '2026-11-30').a_receber, titulos(c, '2026-11-30').a_pagar], [1184000, 17760], 'a receber 11.840,00 e a pagar 177,60 em 30/11 (07, 2.2)');
});

test('CT-14 (b) e (c): arroba de peso vivo com rendimento estimado de 52% — 36,40 @, bruto 11.284,00 por peso vivo; ARROBA sem base de peso → VALIDATION', () => {
  const amb = ambiente();
  const { m } = amb;
  const frig = amb.parceiro('Frigorífico', 'COMPRADOR');
  const ids = rebanho(m, [boi('B1'), boi('B2')]);
  const base = { finalidade: 'ABATE', modalidade: 'ARROBA', preco_unitario: 31000, valor_bruto: 1128400 };
  const animais = [{ animal_id: ids.B1, peso: 540 }, { animal_id: ids.B2, peso: 510 }];
  const par = { parcelas: [{ data_vencimento: '2026-12-10' }] };
  // (c) sem base de peso.
  const e = falha(m, 'registrar', venda('2026-11-10', frig, animais, base, par));
  assert.deepEqual([e.code, codigos(e)], ['VALIDATION', ['CAMPO_OBRIGATORIO']]);
  assert.equal(e.details[0].campo, 'base_peso');
  // Base VIVO sem o tipo do rendimento: o catálogo pede.
  assert.deepEqual(codigos(falha(m, 'registrar', venda('2026-11-10', frig, animais, Object.assign({ base_peso: 'VIVO', rendimento_carcaca_pct: 52 }, base), par))), ['CAMPO_OBRIGATORIO']);
  // (b) rendimento estimado.
  const dados = venda('2026-11-10', frig, animais, Object.assign({ base_peso: 'VIVO', rendimento_carcaca_pct: 52, rendimento_tipo: 'ESTIMADO' }, base), par);
  const v = m.simular('registrar', dados).valor.dados.impactos.venda;
  assert.deepEqual([v.arrobas, v.arroba_base, v.conferencia, v.desvio_pct, v.criterio, v.preco_medio_arroba], [36.4, 'ESTIMADA', 1128400, 0, 'PESO_VIVO', 31000], '1.050,0 × 0,52 ÷ 15 = 36,40 @ "estimadas"');
  const r = m.run('registrar', dados);
  const ev = r.dados.event_id;
  const vd = doEvento(m, 'VENDAS', ev)[0];
  assert.deepEqual([vd.base_peso, vd.rendimento_carcaca_pct, vd.rendimento_tipo, vd.peso_vivo_total_kg, vd.peso_carcaca_total_kg, vd.criterio_rateio], ['VIVO', 52, 'ESTIMADO', 1050, null, 'PESO_VIVO'], 'carcaça estimada não é gravada');
  assert.deepEqual(alocDe(m, doEvento(m, 'FINANCEIRO', ev)[0]).map((x) => x.valor_alocado), [580320, 548080], '5.803,20 e 5.480,80');
  assert.deepEqual(doEvento(m, 'PESAGENS', ev).map((p) => [p.tipo, p.peso_kg]), [['VENDA', 540], ['VENDA', 510]]);
});

test('07 4.3 (b): reposição por kg vivo só com o peso do lote — 10 bezerros, 2.150,0 kg a R$ 12,50: bruto 26.875,00; comissão não retida; equivalente de 71,67 @ estimadas a 50% (R$ 375,00); base pela última pesagem escalada', () => {
  const amb = ambiente();
  const { m } = amb;
  const comp = amb.parceiro('Recriador vizinho', 'COMPRADOR');
  const corretor = amb.parceiro('Corretor', 'OUTRO');
  const pesosEntrada = [190, 195, 200, 205, 210, 215, 220, 225, 230, 235];
  const brincos = pesosEntrada.map((_, i) => 'BZ' + i);
  const ids = rebanho(m, brincos.map((b, i) => bicho({ brinco: b, sexo: i % 2 ? 'F' : 'M', castrado: false, reprodutor: false, data_nascimento: '2025-08-01', data_nascimento_confianca: 'ESTIMADA', peso: pesosEntrada[i], metodo_pesagem: 'BALANCA' })));
  const dados = venda('2026-07-01', comp, brincos.map((b) => ({ animal_id: ids[b] })), { modalidade: 'KG_VIVO', preco_unitario: 1250, peso_vivo_total_kg: 2150, valor_bruto: 2687500 },
    { parcelas: [{ data_vencimento: '2026-07-01', forma_pagamento: 'PIX' }], deducoes: [{ tipo: 'COMISSAO', valor: 50000, partner_id: corretor, data_vencimento: '2026-07-10' }] });
  // Sem o peso de cada animal: aviso RATEIO_SEM_PESO (a divisão usa a última pesagem, estimada).
  const av = falha(m, 'registrar', dados);
  assert.deepEqual([av.code, codigos(av)], ['NEEDS_CONFIRMATION', ['RATEIO_SEM_PESO']]);
  assert.match(av.details[0].mensagem, /última pesagem de cada um, ajustada ao peso do lote \(estimado\)/);
  const v = m.simular('registrar', dados, { avisos: ['RATEIO_SEM_PESO'] }).valor.dados.impactos.venda;
  assert.deepEqual([v.receita, v.preco_medio_cabeca, v.resultado_negociacao, v.deposito_esperado, v.base_estimada], [2687500, 268750, 2637500, 2687500, true]);
  assert.deepEqual(js(v.equivalente_arroba), { rendimento_pct: 50, arrobas: 71.67, preco_arroba: 37500, base: 'ESTIMADA' });
  const r = m.run('registrar', dados, { avisos: ['RATEIO_SEM_PESO'] });
  const ev = r.dados.event_id;
  assert.equal(doEvento(m, 'PESAGENS', ev).length, 0, 'só o peso do lote: nenhuma pesagem de venda');
  assert.ok(doEvento(m, 'EVENTO_ANIMAIS', ev).every((l) => l.peso === null));
  const [rec, com] = doEvento(m, 'FINANCEIRO', ev);
  const rat = doEvento(m, 'RATEIOS', ev);
  assert.deepEqual([rat[0].criterio, rat[0].base_total], ['PESO_VIVO', 2150]);
  assert.match(rat[0].justificativa, /^Base estimada: última pesagem de cada animal até 01\/07\/2026, ajustada ao peso vivo do lote \(2150 kg\)\.$/);
  const bases = alocDe(m, rec).map((x) => x.base_valor);
  assert.deepEqual(bases, pesosEntrada.map((p) => Math.round(p * 2150 / 2125 * 10000) / 10000));
  assert.equal(alocDe(m, rec).reduce((s, x) => s + x.valor_alocado, 0), 2687500);
  assert.deepEqual([com.retida_pelo_comprador, com.partner_id, parcelasDe(m, com)[0].data_vencimento], [false, corretor, '2026-07-10'], 'comissão paga à parte, ao corretor');
  assert.deepEqual(m.evento(ev).payload_json.avisos_aceitos, [{ codigo: 'RATEIO_SEM_PESO', n: 1 }]);
});

test('03b 4.4, exemplos 4 e 5: 18 bois ao frigorífico só com o romaneio total (5.022,0 kg; rendimento 52,6 apurado; depósito 103.728,96) e 8 novilhas em lote fechado por cabeça (2.500,00 cada)', () => {
  const amb = ambiente();
  const { m } = amb;
  const frig = amb.parceiro('Frigorífico', 'COMPRADOR');
  const transp = amb.parceiro('Transportadora', 'TRANSPORTADOR');
  const bois = [];
  for (let i = 1; i <= 18; i++) bois.push(boi('BO' + String(i).padStart(2, '0')));
  const novilhas = [];
  for (let i = 1; i <= 8; i++) novilhas.push(bicho({ brinco: 'NV' + i, data_nascimento: '2024-09-01', data_nascimento_confianca: 'ESTIMADA', pasto_destino_id: PASTOS.B }));
  const ids = rebanho(m, bois.concat(novilhas));
  const dados = venda('2026-10-01', frig, bois.map((b) => ({ animal_id: ids[b.brinco] })),
    { finalidade: 'ABATE', modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 32000, peso_vivo_total_kg: 9540, peso_carcaca_total_kg: 5022, valor_bruto: 10713600 },
    { parcelas: [{ data_vencimento: '2026-10-31' }], deducoes: [{ tipo: 'FRETE', valor: 180000, retida_pelo_comprador: true, partner_id: transp }, { tipo: 'FUNRURAL', valor: 160704, retida_pelo_comprador: true }] });
  const v = m.simular('registrar', dados, { avisos: ['RATEIO_SEM_PESO'] }).valor.dados.impactos.venda;
  assert.deepEqual([v.arrobas, v.conferencia, v.rendimento_pct, v.frete, v.outras_deducoes, v.deposito_esperado, v.preco_medio_cabeca, v.preco_medio_kg, v.criterio],
    [334.8, 10713600, 52.6, 180000, 160704, 10372896, 595200, 1123, 'CABECAS'], '5.022 ÷ 15 = 334,80 @; R$ 5.952,00 por cabeça; R$ 11,23 por kg vivo');
  const r = m.run('registrar', dados, { avisos: ['RATEIO_SEM_PESO'] });
  const vd = doEvento(m, 'VENDAS', r.dados.event_id)[0];
  assert.deepEqual([vd.peso_vivo_total_kg, vd.peso_carcaca_total_kg, vd.rendimento_carcaca_pct, vd.rendimento_tipo, vd.frete, vd.outras_deducoes, vd.criterio_rateio], [9540, 5022, 52.6, 'APURADO', 180000, 160704, 'CABECAS']);
  assert.ok(doEvento(m, 'EVENTO_ANIMAIS', r.dados.event_id).every((l) => l.valor_individual === 595200 && l.peso_carcaca_kg === null));
  assert.deepEqual(m.evento(r.dados.event_id).payload_json.deducoes.map((x) => x.tipo), ['FRETE', 'FUNRURAL']);
  const fins = doEvento(m, 'FINANCEIRO', r.dados.event_id);
  assert.deepEqual(fins.map((f) => [m.tabela('PLANO_CONTAS').find((x) => x.conta_id === f.conta_id).codigo, f.valor, f.partner_id]),
    [['VENDA_ANIMAIS', 10713600, frig], ['FRETE_VENDA', 180000, transp], ['TAXAS_RETENCOES_VENDA', 160704, frig]]);
  // Exemplo 5: lote fechado de R$ 20.000,00 dividido por cabeça.
  const lote = venda('2026-10-01', frig, novilhas.map((n) => ({ animal_id: ids[n.brinco] })), { finalidade: 'REPRODUCAO', modalidade: 'LOTE', valor_bruto: 2000000, criterio_rateio: 'CABECAS' }, { parcelas: [{ data_vencimento: '2026-11-01' }] });
  const l = m.run('registrar', lote);
  const lv = doEvento(m, 'VENDAS', l.dados.event_id)[0];
  assert.deepEqual([lv.modalidade, lv.preco_unitario, lv.unidade_preco, lv.base_peso, lv.criterio_rateio, lv.qtd_animais], ['LOTE', null, null, null, 'CABECAS', 8]);
  assert.ok(doEvento(m, 'EVENTO_ANIMAIS', l.dados.event_id).every((x) => x.valor_individual === 250000 && x.pasto_origem_id === PASTOS.B));
});

test('07 2.2, resultado por animal (bloco H da ficha): compra por cabeça com frete, morte de A3 e venda por arroba de carcaça — receita, despesas de venda e resultado = receita − despesas − aquisição − custeio', () => {
  const amb = ambiente();
  const { c, m } = amb;
  const forn = amb.parceiro('Fornecedor', 'FORNECEDOR');
  const frig = amb.parceiro('Frigorífico', 'COMPRADOR');
  const g = (b) => ({ brinco: b, sexo: 'M', castrado: true, reprodutor: false, idade_meses: 20 });
  const cp = m.run('registrar', { tipo: 'COMPRA', campos: { event_date: '2026-03-10', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', valor_animais: 900000 },
    animais: [Object.assign(g('A1'), { valor_individual: 300000 }), Object.assign(g('A2'), { valor_individual: 310000 }), Object.assign(g('A3'), { valor_individual: 290000 })],
    parcelas: [{ data_vencimento: '2026-04-09', valor: 450000 }, { data_vencimento: '2026-05-09', valor: 450000 }], custos: [{ tipo: 'FRETE', valor: 10000 }] });
  const id = {};
  cp.dados.animais.forEach((a) => { id[a.brinco] = a.animal_id; });
  // O frete segue o critério do evento (VALOR_INDIVIDUAL; 03b, 4.5): o rateio por cabeça do documento (33,34 / 33,33 /
  // 33,33) é um evento RATEIO, da Fase 4. A aquisição total é a mesma (9.100,00).
  assert.deepEqual(['A1', 'A2', 'A3'].map((b) => m.animal(id[b]).custo_aquisicao), [303333, 313445, 293222]);
  m.run('registrar', { tipo: 'MORTE', campos: { event_date: '2026-06-16', causa: 'DOENCA' }, animais: [{ animal_id: id.A3 }] });
  m.run('registrar', venda('2026-11-10', frig, [{ animal_id: id.A1, peso: 540, peso_carcaca_kg: 285 }, { animal_id: id.A2, peso: 520, peso_carcaca_kg: 270 }],
    { finalidade: 'ABATE', modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 32000, valor_bruto: 1184000 },
    { parcelas: [{ data_vencimento: '2026-12-10' }], deducoes: [{ tipo: 'TAXA_FRIGORIFICO', valor: 17760, retida_pelo_comprador: true }] }));
  const h = (b) => ficha(c, id[b]).financeiro;
  const a1 = h('A1');
  const a2 = h('A2');
  const a3 = h('A3');
  // Sem SANIDADE e arrendamento (Fases 3 e 4) não há custeio alocado: resultado do documento + o custeio dele.
  // Receita (F7) e despesas de venda (F8) por animal são as do documento: 6.080,00 − 91,20 e 5.760,00 − 86,40.
  assert.deepEqual([a1.custo_aquisicao, a1.receitas, a1.despesas_venda, a1.custeio, a1.resultado.valor], [303333, 608000, 9120, 0, 608000 - 9120 - 303333]);
  assert.deepEqual([a2.custo_aquisicao, a2.receitas, a2.despesas_venda, a2.resultado.valor], [313445, 576000, 8640, 576000 - 8640 - 313445]);
  assert.deepEqual([a3.receitas, a3.resultado.valor], [0, -293222], 'A3 morto: −(aquisição)');
  assert.deepEqual(a1.lancamentos.map((x) => [x.event_type, x.natureza, x.valor_alocado]).sort(),
    [['COMPRA', 'AQUISICAO_ANIMAIS', 300000], ['COMPRA', 'AQUISICAO_ANIMAIS', 3333], ['VENDA', 'DESPESA_VENDA', 9120], ['VENDA', 'RECEITA_VENDA_ANIMAIS', 608000]]);
  // A soma dos resultados é a do documento (1.953,40) mais o custeio alocado de lá (609,00), que só existe nas Fases 3 e 4.
  assert.equal(a1.resultado.valor + a2.resultado.valor + a3.resultado.valor, 195340 + 60900);
});

// ------------------------------------------------------------------ carência (RN-072; 05, 4.8) ----
test('carência na venda (RN-072): vermífugo em 01/11 com 35 dias — abate em 13/11 e em 06/12 bloqueado, em 07/12 livre; recria avisa e grava o aceite; a política vale só no abate', () => {
  const amb = ambiente();
  const { c, m } = amb;
  m.gas.clock.now = Date.parse('2026-12-10T15:00:00.000Z');
  const frig = amb.parceiro('Frigorífico', 'COMPRADOR');
  const ids = rebanho(m, [boi('C1'), boi('C2'), boi('C3'), boi('C4')]);
  sanidade(m, ids.C1, '2026-11-01', 35);
  sanidade(m, ids.C2, '2026-11-01', 35, { data_fim_carencia: '2026-12-06', nome_produto: null });
  sanidade(m, ids.C3, '2026-11-20', 60, { nome_produto: 'Antibiótico' });
  const v = (data, finalidade, brincos) => venda(data, frig, brincos.map((b) => ({ animal_id: ids[b] })), { finalidade, modalidade: 'CABECA', preco_unitario: 500000, valor_bruto: 500000 * brincos.length }, { parcelas: [{ data_vencimento: data }] });
  // Abate com carência: política padrão BLOQUEIA → VALIDATION, um detalhe por animal, com o fim da carência.
  const e = falha(m, 'registrar', v('2026-11-13', 'ABATE', ['C1', 'C2', 'C4']));
  assert.deepEqual([e.code, codigos(e), e.details.map((d) => d.animal_id)], ['VALIDATION', ['CARENCIA_ATIVA', 'CARENCIA_ATIVA'], [ids.C1, ids.C2]]);
  assert.match(e.details[0].mensagem, /^C1: está em carência sanitária até 06\/12\/2026 \(Ivermectina 1%, aplicado em 01\/11\/2026\)\. Para o abate, a carência precisa ter terminado\.$/);
  assert.match(e.details[1].mensagem, /até 06\/12\/2026 \(aplicação de 01\/11\/2026\)/);
  assert.deepEqual(codigos(falha(m, 'registrar', v('2026-12-06', 'ABATE', ['C1']))), ['CARENCIA_ATIVA'], 'o último dia ainda é carência');
  assert.deepEqual(codigos(falha(m, 'registrar', v('2026-11-19', 'ABATE', ['C1', 'C3']))), ['CARENCIA_ATIVA'], 'a aplicação de 20/11 não vale para a venda de 19/11');
  const sim = m.simular('registrar', v('2026-12-07', 'ABATE', ['C1'])).valor.dados;
  assert.deepEqual(sim.avisos, [], 'em 07/12 está livre');
  // Recria: sempre aviso com aceite; aceito, fica no payload com quantos animais cobria.
  const rec = v('2026-11-13', 'RECRIA_ENGORDA', ['C1', 'C2']);
  const av = falha(m, 'registrar', rec);
  assert.deepEqual([av.code, codigos(av)], ['NEEDS_CONFIRMATION', ['CARENCIA_ATIVA', 'CARENCIA_ATIVA']]);
  assert.match(av.details[0].mensagem, /Confirme que o comprador sabe da carência\.$/);
  const r = m.run('registrar', rec, { avisos: ['CARENCIA_ATIVA'] });
  assert.deepEqual(m.evento(r.dados.event_id).payload_json.avisos_aceitos, [{ codigo: 'CARENCIA_ATIVA', n: 2 }]);
  m.run('estornar', { event_id: r.dados.event_id, justificativa: 'Teste da política' });
  // Política AVISA: o abate também pede só o aceite. BLOQUEIA não alcança a recria; IGNORA tira o aviso só do abate.
  const politica = (p) => c.run('Config.comandoSalvar', { valores: { avisos_politica: { CARENCIA_ATIVA: p } } });
  politica('AVISA');
  assert.deepEqual([falha(m, 'registrar', v('2026-11-13', 'ABATE', ['C1'])).code], ['NEEDS_CONFIRMATION']);
  politica('BLOQUEIA');
  assert.deepEqual([falha(m, 'registrar', v('2026-11-13', 'REPRODUCAO', ['C1'])).code], ['NEEDS_CONFIRMATION'], 'fora do abate é sempre aviso');
  politica('IGNORA');
  assert.deepEqual(m.simular('registrar', v('2026-11-13', 'ABATE', ['C1'])).valor.dados.avisos, []);
  assert.deepEqual(codigos(falha(m, 'registrar', v('2026-11-13', 'OUTRA', ['C1']))), ['CARENCIA_ATIVA'], 'fora do abate a política não se aplica');
});

// ------------------------------------------------------------------ validações por animal ----
test('validações por animal: fora do rebanho na data, já vendido, saída posterior (CONFLICT com o evento), pasto divergente, repetido, de referência, inexistente; depois da venda nada se move', () => {
  const amb = ambiente();
  const { c, m } = amb;
  const comp = amb.parceiro('Comprador', 'COMPRADOR');
  const ids = rebanho(m, [boi('V1'), boi('V2'), boi('V3', { pasto_destino_id: PASTOS.B })]);
  const tarde = m.run('registrar', C.outraEntrada('2026-03-01', [boi('V4')])).dados.animais[0].animal_id;
  const ext = c.run('AnimalService.comandoCadastrarExterno', { campos: { nome: 'Touro de sêmen', sexo: 'M' } }).dados.animal_id;
  const base = { modalidade: 'CABECA', preco_unitario: 300000 };
  const v = (data, animais, campos) => venda(data, comp, animais, Object.assign({ valor_bruto: 300000 * animais.length }, base, campos || {}), { parcelas: [{ data_vencimento: data }] });
  // Fora do rebanho na data: antes da entrada.
  const antes = falha(m, 'registrar', v('2026-02-01', [{ animal_id: tarde }]));
  assert.deepEqual([antes.code, codigos(antes), antes.details[0].animal_id], ['VALIDATION', ['FORA_DO_REBANHO'], tarde]);
  // Repetido, de referência e inexistente.
  assert.deepEqual(codigos(falha(m, 'registrar', v('2026-04-01', [{ animal_id: ids.V1 }, { animal_id: ids.V1 }]))), ['ANIMAL_REPETIDO']);
  assert.deepEqual(codigos(falha(m, 'registrar', v('2026-04-01', [{ animal_id: ext }]))), ['ANIMAL_EXTERNO']);
  assert.deepEqual(codigos(falha(m, 'registrar', v('2026-04-01', [{ animal_id: C.id(0x9999) }]))), ['NAO_ENCONTRADO']);
  // Pasto divergente: o cabeçalho diz Pasto A, mas o V3 estava no B.
  const div = falha(m, 'registrar', v('2026-04-01', [{ animal_id: ids.V1 }, { animal_id: ids.V3 }], { pasto_origem_id: PASTOS.A }));
  assert.deepEqual([div.code, codigos(div), div.details[0].animal_id], ['VALIDATION', ['ORIGEM_DIVERGENTE'], ids.V3]);
  assert.match(div.details[0].mensagem, /^V3: /);
  // Saída posterior: o V2 morreu em 01/07; vender em 01/06 (retroativa) quebra a morte → CONFLICT com o evento.
  const morte = m.run('registrar', { tipo: 'MORTE', campos: { event_date: '2026-07-01', causa: 'DOENCA' }, animais: [{ animal_id: ids.V2 }] });
  const post = falha(m, 'registrar', v('2026-06-01', [{ animal_id: ids.V2 }]));
  assert.equal(post.code, 'CONFLICT');
  assert.deepEqual(post.details.map((d) => [d.animal_id, d.conflito.event_id, d.conflito.tipo, d.conflito.data]), [[ids.V2, morte.dados.event_id, 'MORTE', '2026-07-01']]);
  // Vendido não vende de novo; depois da venda o animal não se move nem morre.
  m.run('registrar', v('2026-05-01', [{ animal_id: ids.V1 }]));
  assert.deepEqual(codigos(falha(m, 'registrar', v('2026-06-01', [{ animal_id: ids.V1 }]))), ['FORA_DO_REBANHO']);
  assert.deepEqual(codigos(falha(m, 'registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-05-02', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: ids.V1 }] })), ['FORA_DO_REBANHO']);
  assert.deepEqual(codigos(falha(m, 'registrar', { tipo: 'MORTE', campos: { event_date: '2026-05-02', causa: 'DOENCA' }, animais: [{ animal_id: ids.V1 }] })), ['FORA_DO_REBANHO']);
  // No dia da venda, uma transferência lançada depois entra antes da saída e quebra a origem da venda (04, 5.2 ii).
  const vendaV1 = m.tabela('EVENTOS').find((e) => e.event_type === 'VENDA');
  const mesmoDia = falha(m, 'registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-05-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: ids.V1 }] });
  assert.equal(mesmoDia.code, 'CONFLICT');
  assert.deepEqual(mesmoDia.details.map((d) => [d.codigo, d.conflito.event_id, d.conflito.tipo]), [['ORIGEM_DIVERGENTE', vendaV1.event_id, 'VENDA']]);
  // Os elegíveis à venda numa data são os do rebanho naquela data, filtráveis pelo pasto.
  const el = m.ler(m.G.InventoryService.consultaElegiveis({ tipo: 'VENDA', data: '2026-04-15', pasture_id: PASTOS.A }));
  assert.deepEqual(el.itens.map((x) => x.animal_id).sort(), [ids.V1, ids.V2, tarde].sort());
});

// ------------------------------------------------------------------ regras da negociação e do financeiro ----
test('regras da venda: comprador, finalidade, desconto, valores por animal que somam a receita, conferência (VALOR_DIVERGENTE), carcaça total × individual, parcelas e deduções retidas', () => {
  const amb = ambiente();
  const { c, m } = amb;
  const comp = amb.parceiro('Comprador', 'COMPRADOR');
  const inativo = amb.parceiro('Antigo', 'COMPRADOR');
  c.run('Config.comandoSalvarParceiro', { partner_id: inativo, campos: { ativo: false } });
  const ids = rebanho(m, [boi('R1'), boi('R2'), boi('R3')]);
  const A = (extra) => [Object.assign({ animal_id: ids.R1 }, (extra || [])[0]), Object.assign({ animal_id: ids.R2 }, (extra || [])[1])];
  const par = { parcelas: [{ data_vencimento: '2026-09-01' }] };
  const v = (campos, animais, extra) => venda('2026-08-01', comp, animais || A(), Object.assign({ modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 600000 }, campos || {}), Object.assign({}, par, extra || {}));
  // Cabeçalho.
  assert.deepEqual(codigos(falha(m, 'registrar', v({ partner_id: null }))), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(codigos(falha(m, 'registrar', v({ partner_id: C.id(0x7777) }))), ['NAO_ENCONTRADO']);
  assert.deepEqual(codigos(falha(m, 'registrar', v({ partner_id: inativo }))), ['PARCEIRO_INATIVO']);
  assert.deepEqual(codigos(falha(m, 'registrar', v({ finalidade: null }))), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(codigos(falha(m, 'registrar', v({ finalidade: 'PASSEIO' }))), ['VALOR_FORA_DA_LISTA']);
  assert.deepEqual(codigos(falha(m, 'registrar', v({ pasto_origem_id: C.id(0x8888) }))), ['NAO_ENCONTRADO']);
  assert.deepEqual(codigos(falha(m, 'registrar', v({ desconto_comercial: 600000 }))), ['VALOR_FORA_DA_FAIXA']);
  // Desconto comercial: a receita é bruto − desconto; os valores por animal somam a receita (03b, 4.5 e invariante 15).
  const semPreco = { preco_unitario: null, desconto_comercial: 20000 };
  const ns = falha(m, 'registrar', v(semPreco, A([{ valor_individual: 300000 }, { valor_individual: 300000 }])));
  assert.deepEqual(codigos(ns), ['VALOR_INDIVIDUAL_NAO_SOMA']);
  assert.match(ns.details[0].mensagem, /difere da receita da venda \(bruto menos desconto\) \(R\$ 5\.800,00\)/);
  const sim = m.simular('registrar', v(semPreco, A([{ valor_individual: 300000 }, { valor_individual: 280000 }]))).valor.dados;
  assert.deepEqual([sim.impactos.venda.receita, sim.impactos.venda.criterio, sim.impactos.venda.conferencia, sim.impactos.venda.desvio_pct, sim.avisos.length], [580000, 'VALOR_INDIVIDUAL', 600000, 0, 0]);
  // Conferência pelo preço: 2% acima → aviso VALOR_DIVERGENTE (vale o valor informado).
  const div = falha(m, 'registrar', v({ valor_bruto: 612000 }));
  assert.deepEqual([div.code, codigos(div)], ['NEEDS_CONFIRMATION', ['VALOR_DIVERGENTE']]);
  assert.match(div.details[0].mensagem, /O valor informado \(R\$ 6\.120,00\) difere em 2% da conta pela negociação \(R\$ 6\.000,00\)/);
  // Carcaça: só na arroba de carcaça; todas ou nenhuma (aí o total do romaneio); total diferente da soma.
  const arroba = { modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 32000, valor_bruto: 1184000 };
  assert.deepEqual(codigos(falha(m, 'registrar', v({ peso_carcaca_total_kg: 500 }))), ['CAMPO_NAO_SE_APLICA']);
  assert.deepEqual(codigos(falha(m, 'registrar', v(arroba, A([{ peso_carcaca_kg: 285 }, {}])))), ['PESO_INCOMPLETO']);
  assert.deepEqual(codigos(falha(m, 'registrar', v(arroba, A()))), ['PESO_OBRIGATORIO']);
  assert.deepEqual(codigos(falha(m, 'registrar', v(Object.assign({ peso_carcaca_total_kg: 560 }, arroba), A([{ peso_carcaca_kg: 285 }, { peso_carcaca_kg: 270 }])))), ['PESO_TOTAL_DIVERGENTE']);
  assert.deepEqual(codigos(falha(m, 'registrar', v(arroba, A([{ peso: 540, peso_carcaca_kg: 545 }, { peso: 520, peso_carcaca_kg: 270 }])))), ['CARCACA_MAIOR_QUE_VIVO']);
  // Só o total do romaneio e o peso vivo de cada um: a divisão é pelo peso vivo, com aviso.
  const pv = m.simular('registrar', v(Object.assign({ peso_carcaca_total_kg: 555 }, arroba), A([{ peso: 540 }, { peso: 520 }]))).valor.dados;
  assert.deepEqual([pv.impactos.venda.criterio, pv.impactos.venda.arrobas, pv.impactos.venda.rendimento_pct, sim.avisos.length, pv.avisos.map((a) => a.codigo)], ['PESO_VIVO', 37, 52.4, 0, ['RATEIO_SEM_PESO']]);
  // Peso de parte dos animais numa venda por peso.
  assert.deepEqual(codigos(falha(m, 'registrar', v({ modalidade: 'KG_VIVO', preco_unitario: 1000, valor_bruto: 1000000, peso_vivo_total_kg: 1000 }, A([{ peso: 500 }, {}])))), ['PESO_INCOMPLETO']);
  // Parcelas da receita.
  assert.deepEqual(codigos(falha(m, 'registrar', v({}, A(), { parcelas: [] }))), ['SEM_PARCELAS']);
  assert.match(falha(m, 'registrar', v({}, A(), { parcelas: [] })).details[0].mensagem, /Informe como a receita da venda será recebida/);
  assert.deepEqual(codigos(falha(m, 'registrar', v({}, A(), { parcelas: [{ data_vencimento: '2026-09-01', valor: 100000 }, { data_vencimento: '2026-10-01', valor: 100000 }] }))), ['PARCELAS_NAO_SOMAM']);
  // Deduções: tipo da lista; retida no vencimento de um recebimento; retida que passa do que o comprador paga no dia.
  const p2 = { parcelas: [{ data_vencimento: '2026-09-01', valor: 100000 }, { data_vencimento: '2026-10-01' }] };
  assert.deepEqual(codigos(falha(m, 'registrar', v({}, A(), { deducoes: [{ tipo: 'GORJETA', valor: 1000 }] }))), ['VALOR_FORA_DA_LISTA']);
  assert.deepEqual(codigos(falha(m, 'registrar', v({}, A(), { deducoes: [{ tipo: 'FRETE' }] }))), ['CAMPO_OBRIGATORIO']);
  const fora = falha(m, 'registrar', v({}, A(), Object.assign({ deducoes: [{ tipo: 'FUNRURAL', valor: 9000, retida_pelo_comprador: true, data_vencimento: '2026-09-15' }] }, p2)));
  assert.deepEqual(codigos(fora), ['RETIDA_FORA_DO_RECEBIMENTO']);
  assert.match(fora.details[0].mensagem, /^Dedução 1: .*\(01\/09\/2026, 01\/10\/2026\)/);
  assert.deepEqual(codigos(falha(m, 'registrar', v({}, A(), Object.assign({ deducoes: [{ tipo: 'FRETE', valor: 120000, retida_pelo_comprador: true }] }, p2)))), ['RETENCAO_MAIOR_QUE_RECEBIMENTO'], 'retida de 1.200,00 na parcela de 1.000,00');
  const ok = m.run('registrar', v({}, A(), Object.assign({ deducoes: [{ tipo: 'FRETE', valor: 9000, retida_pelo_comprador: true, data_vencimento: '2026-10-01' }, { tipo: 'COMISSAO', valor: 6000 }] }, p2)));
  const fins = doEvento(m, 'FINANCEIRO', ok.dados.event_id);
  assert.deepEqual(fins.map((f) => [f.natureza, f.valor, f.retida_pelo_comprador, parcelasDe(m, f).map((p) => [p.data_vencimento, p.valor])]),
    [['RECEITA_VENDA_ANIMAIS', 600000, false, [['2026-09-01', 100000], ['2026-10-01', 500000]]], ['DESPESA_VENDA', 9000, true, [['2026-10-01', 9000]]], ['DESPESA_VENDA', 6000, false, [['2026-08-01', 6000]]]]);
  const vd = doEvento(m, 'VENDAS', ok.dados.event_id)[0];
  assert.deepEqual([vd.frete, vd.comissao, vd.outras_deducoes, vd.criterio_rateio, vd.unidade_preco], [9000, 6000, 0, 'CABECAS', 'CABECA']);
  // Um animal só: DIRETO (invariante 13), receita e deduções inteiras nele.
  const um = m.run('registrar', venda('2026-08-02', comp, [{ animal_id: ids.R3, motivo_saida: 'BAIXO_DESEMPENHO' }], { modalidade: 'LOTE', valor_bruto: 250000, criterio_rateio: 'CABECAS' }, { parcelas: [{ data_vencimento: '2026-08-02' }], deducoes: [{ tipo: 'COMISSAO', valor: 5000 }] }));
  assert.deepEqual(doEvento(m, 'RATEIOS', um.dados.event_id).map((r) => [r.criterio, r.base_total, r.total_alocado]), [['DIRETO', 2500, 250000], ['DIRETO', 50, 5000]]);
  assert.deepEqual(doEvento(m, 'FINANCEIRO', um.dados.event_id).map((f) => f.animal_id), [ids.R3, ids.R3], 'lançamento com uma alocação direta leva o animal');
  assert.equal(doEvento(m, 'EVENTO_ANIMAIS', um.dados.event_id)[0].motivo_saida, 'BAIXO_DESEMPENHO', 'vendido como descarte');
  assert.deepEqual(m.invariantes(), []);
});

// ------------------------------------------------------------------ estorno ----
test('estorno de venda: os animais voltam ao rebanho na posição certa da linha do tempo; lançamentos cancelados pela vigência (parcelas não regravadas); com recompra posterior → CONFLICT; parcela paga → CONFLICT', () => {
  const amb = ambiente();
  const { c, m } = amb;
  const comp = amb.parceiro('Comprador', 'COMPRADOR');
  const ids = rebanho(m, [boi('E1'), boi('E2'), boi('E3')]);
  m.run('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-04-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: ids.E1 }] });
  const dados = venda('2026-05-01', comp, [{ animal_id: ids.E1, peso: 480 }, { animal_id: ids.E2, peso: 500 }], { modalidade: 'KG_VIVO', preco_unitario: 1000, valor_bruto: 980000 },
    { parcelas: [{ data_vencimento: '2026-06-01' }], deducoes: [{ tipo: 'FRETE', valor: 20000 }] });
  const r = m.run('registrar', dados);
  const ev = r.dados.event_id;
  assert.deepEqual(doEvento(m, 'EVENTO_ANIMAIS', ev).map((l) => l.pasto_origem_id), [PASTOS.B, PASTOS.A], 'cada um sai do pasto em que estava');
  // Venda retroativa de outro animal depois da transferência e da venda: aceita, inventário de abril recalculado.
  const r3 = m.run('registrar', venda('2026-03-01', comp, [{ animal_id: ids.E3 }], { modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, { parcelas: [{ data_vencimento: '2026-03-01' }] }));
  assert.deepEqual([m.inventario('2026-02-28').total, m.inventario('2026-03-01').total, m.inventario('2026-05-01').total], [3, 2, 0]);
  // Recompra do E2 em 01/06: o estorno da venda deixaria o E2 entrando duas vezes → CONFLICT com a compra.
  const forn = amb.parceiro('Fornecedor', 'FORNECEDOR');
  const recompra = m.run('registrar', { tipo: 'COMPRA', campos: { event_date: '2026-06-01', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 350000, valor_animais: 350000 }, animais: [{ animal_id: ids.E2 }], parcelas: [{ data_vencimento: '2026-06-01' }] });
  const e = falha(m, 'estornar', { event_id: ev, justificativa: 'Venda desfeita' });
  assert.equal(e.code, 'CONFLICT');
  assert.deepEqual(e.details.map((d) => [d.animal_id, d.codigo, d.conflito.event_id, d.conflito.tipo, d.conflito.data]), [[ids.E2, 'ENTRADA_JA_DENTRO', recompra.dados.event_id, 'COMPRA', '2026-06-01']]);
  assert.match(e.message, /^Não dá para estornar: E2: /);
  m.run('estornar', { event_id: recompra.dados.event_id, justificativa: 'Recompra não aconteceu' });
  // Agora sai: E1 volta ao Pasto B (a transferência de abril segue), E2 ao A; a saída some do histórico vigente.
  const parcelasAntes = m.tabela('PARCELAS');
  const est = m.run('estornar', { event_id: ev, justificativa: 'Venda desfeita' });
  assert.deepEqual([ids.E1, ids.E2].map((id) => [m.animal(id).situacao_cadastral, m.animal(id).pasto_atual_id, m.animal(id).data_saida, m.animal(id).data_ultimo_movimento]),
    [['ATIVO', PASTOS.B, null, '2026-04-01'], ['ATIVO', PASTOS.A, null, C.D0]]);
  assert.equal(m.animal(ids.E2).peso_atual, null, 'a pesagem da venda deixou de valer');
  assert.deepEqual([m.inventario('2026-05-01').porPasto[PASTOS.B], m.inventario('2026-05-01').porPasto[PASTOS.A]], [1, 1]);
  const fins = doEvento(m, 'FINANCEIRO', ev);
  assert.deepEqual(fins.map((f) => [f.status, f.status_pagamento, f.cancelado_por_event_id]), [['CANCELADO', 'CANCELADO', est.dados.event_id], ['CANCELADO', 'CANCELADO', est.dados.event_id]]);
  assert.deepEqual(m.tabela('PARCELAS'), parcelasAntes, 'parcelas de lançamento cancelado não são regravadas (desenho-base 16.11)');
  assert.deepEqual([titulos(c).a_receber, titulos(c).a_pagar], [300000, 0], 'só a venda do E3 continua a receber');
  assert.equal(m.evento(ev).status, 'ESTORNADO');
  assert.equal(ficha(c, ids.E2).eventos.itens.find((x) => x.event_id === ev).vigente, false, 'a venda estornada fica no histórico, marcada');
  // Parcela paga (a baixa chega na Fase 4; simulada à mão): estorno e correção recusados.
  const p = m.tabela('PARCELAS').find((x) => x.financial_id === doEvento(m, 'FINANCEIRO', r3.dados.event_id)[0].financial_id);
  editar(m, 'PARCELAS', p.parcela_id, 'status', 'LIQUIDADA');
  editar(m, 'PARCELAS', p.parcela_id, 'data_pagamento', '2026-03-01');
  editar(m, 'PARCELAS', p.parcela_id, 'valor_pago', 300000);
  editar(m, 'FINANCEIRO', p.financial_id, 'status_pagamento', 'LIQUIDADO');
  editar(m, 'FINANCEIRO', p.financial_id, 'data_pagamento', '2026-03-01');
  const liq = falha(m, 'estornar', { event_id: r3.dados.event_id, justificativa: 'x' });
  assert.deepEqual([liq.code, codigos(liq)], ['CONFLICT', ['PARCELA_LIQUIDADA']]);
  const corr = Object.assign(venda('2026-03-01', comp, [{ animal_id: ids.E3 }], { modalidade: 'CABECA', preco_unitario: 310000, valor_bruto: 310000 }, { parcelas: [{ data_vencimento: '2026-03-01' }] }), { event_id: r3.dados.event_id, justificativa: 'Preço' });
  assert.deepEqual(codigos(falha(m, 'corrigir', corr)), ['PARCELA_LIQUIDADA']);
});

// ------------------------------------------------------------------ correção ----
test('correção de venda: preço, deduções e parcelas trocados com os mesmos animais (lançamentos antigos cancelados); tirar um animal o devolve ao rebanho; mudar a data para depois da recompra → CONFLICT', () => {
  const amb = ambiente();
  const { c, m } = amb;
  const comp = amb.parceiro('Comprador', 'COMPRADOR');
  const brincos = ['K1', 'K2', 'K3'];
  const ids = rebanho(m, brincos.map((b) => boi(b)));
  const dados = venda('2026-08-20', comp, brincos.map((b, i) => ({ animal_id: ids[b], peso: [450, 462, 438][i] })), { modalidade: 'KG_VIVO', preco_unitario: 1000, valor_bruto: 1350000 },
    { parcelas: [{ data_vencimento: '2026-09-19' }], deducoes: [{ tipo: 'COMISSAO', valor: 27000 }] });
  const r = m.run('registrar', dados);
  const finsAntes = doEvento(m, 'FINANCEIRO', r.dados.event_id);
  // Preço de 10,00 para 10,50 por kg, comissão vira frete retido, duas parcelas: os mesmos 3 animais seguem VENDIDO.
  const corrigida = Object.assign({}, dados, { event_id: r.dados.event_id, justificativa: 'Preço e frete do romaneio',
    campos: Object.assign({}, dados.campos, { preco_unitario: 1050, valor_bruto: 1417500 }),
    parcelas: [{ data_vencimento: '2026-09-19' }, { data_vencimento: '2026-10-19' }], deducoes: [{ tipo: 'FRETE', valor: 30000, retida_pelo_comprador: true }] });
  const sim = m.simular('corrigir', corrigida).valor.dados.impactos;
  assert.deepEqual([sim.substitui, sim.venda.receita, sim.venda.deposito_esperado, sim.financeiro.lancamentos.length], [r.dados.event_id, 1417500, 1387500, 2]);
  const k = m.run('corrigir', corrigida);
  assert.equal(m.evento(r.dados.event_id).status, 'ESTORNADO');
  assert.ok(finsAntes.every((f) => m.tabela('FINANCEIRO').find((x) => x.financial_id === f.financial_id).status === 'CANCELADO'));
  const novos = doEvento(m, 'FINANCEIRO', k.dados.event_id);
  assert.deepEqual(novos.map((f) => [f.natureza, f.valor, f.retida_pelo_comprador, f.status]), [['RECEITA_VENDA_ANIMAIS', 1417500, false, 'ATIVO'], ['DESPESA_VENDA', 30000, true, 'ATIVO']]);
  assert.deepEqual(parcelasDe(m, novos[1]).map((p) => p.data_vencimento), ['2026-09-19'], 'a retida vence no primeiro recebimento');
  assert.deepEqual(m.evento(k.dados.event_id).payload_json, { deducoes: [{ financial_id: novos[1].financial_id, tipo: 'FRETE' }], justificativa: 'Preço e frete do romaneio' });
  assert.deepEqual(doEvento(m, 'EVENTO_ANIMAIS', k.dados.event_id).map((l) => l.valor_individual), [472500, 485100, 459900]);
  assert.ok(brincos.every((b) => m.animal(ids[b]).situacao_cadastral === 'VENDIDO'));
  assert.deepEqual([titulos(c).a_receber, titulos(c).a_pagar], [1417500, 30000]);
  assert.equal(doEvento(m, 'PESAGENS', k.dados.event_id).length, 3, 'as pesagens do original saem; as do substituto valem');
  // Tirar o K3 da venda: ele volta ao rebanho (no Pasto A, sem saída); a receita é dividida entre os outros dois.
  const sem = Object.assign({}, corrigida, { event_id: k.dados.event_id, animais: corrigida.animais.slice(0, 2), campos: Object.assign({}, corrigida.campos, { valor_bruto: 957600 }) });
  const k2 = m.run('corrigir', sem);
  assert.deepEqual([m.animal(ids.K3).situacao_cadastral, m.animal(ids.K3).pasto_atual_id, m.animal(ids.K3).data_saida], ['ATIVO', PASTOS.A, null]);
  assert.equal(doEvento(m, 'VENDAS', k2.dados.event_id)[0].qtd_animais, 2);
  // Recompra do K1 em 01/10: corrigir a venda para 15/10 deixaria a recompra com o K1 ainda no rebanho → CONFLICT.
  const forn = amb.parceiro('Fornecedor', 'FORNECEDOR');
  const recompra = m.run('registrar', { tipo: 'COMPRA', campos: { event_date: '2026-10-01', partner_id: forn, pasto_destino_id: PASTOS.B, modalidade: 'CABECA', preco_unitario: 500000, valor_animais: 500000 }, animais: [{ animal_id: ids.K1 }], parcelas: [{ data_vencimento: '2026-10-01' }] });
  const tarde = falha(m, 'corrigir', Object.assign({}, sem, { event_id: k2.dados.event_id, campos: Object.assign({}, sem.campos, { event_date: '2026-10-15' }), parcelas: [{ data_vencimento: '2026-10-19' }], deducoes: [] }));
  assert.equal(tarde.code, 'CONFLICT', JSON.stringify(tarde));
  assert.deepEqual(tarde.details.map((d) => [d.animal_id, d.conflito.event_id, d.conflito.tipo]), [[ids.K1, recompra.dados.event_id, 'COMPRA']]);
  // Tirar o K1 também quebra a recompra (ele nunca teria saído).
  const semK1 = falha(m, 'corrigir', Object.assign({}, sem, { event_id: k2.dados.event_id, animais: sem.animais.slice(1), campos: Object.assign({}, sem.campos, { valor_bruto: 485100 }) }));
  assert.deepEqual([semK1.code, semK1.details.map((d) => d.conflito.event_id)], ['CONFLICT', [recompra.dados.event_id]]);
  // Campos não estruturais (preço, comprador, condições) mudam mesmo com a recompra depois.
  const outro = amb.parceiro('Outro comprador', 'COMPRADOR');
  const k3 = m.run('corrigir', Object.assign({}, sem, { event_id: k2.dados.event_id, campos: Object.assign({}, sem.campos, { partner_id: outro, condicoes: 'Embarque na fazenda' }) }));
  assert.deepEqual([m.evento(k3.dados.event_id).partner_id, doEvento(m, 'VENDAS', k3.dados.event_id)[0].observacoes, m.animal(ids.K1).situacao_cadastral], [outro, 'Embarque na fazenda', 'ATIVO']);
  assert.deepEqual(codigos(falha(m, 'corrigir', Object.assign({}, sem, { event_id: k.dados.event_id }))), ['JA_ANULADO']);
});

// ------------------------------------------------------------------ invariantes e período ----
test('invariantes de 03b, seção 14, na venda: a conferência pega cada adulteração do cabeçalho comercial e dos valores por animal, e volta a zero quando se desfaz', () => {
  const amb = ambiente();
  const { m } = amb;
  const comp = amb.parceiro('Comprador', 'COMPRADOR');
  const ids = rebanho(m, [boi('I1'), boi('I2')]);
  const r = m.run('registrar', venda('2026-08-20', comp, [{ animal_id: ids.I1, peso: 400 }, { animal_id: ids.I2, peso: 500 }], { modalidade: 'KG_VIVO', preco_unitario: 1000, valor_bruto: 900000, desconto_comercial: 10000 },
    { parcelas: [{ data_vencimento: '2026-09-19' }], deducoes: [{ tipo: 'FRETE', valor: 9000 }, { tipo: 'SENAR', valor: 1780 }] }));
  const ev = r.dados.event_id;
  const vd = doEvento(m, 'VENDAS', ev)[0];
  const [rec] = doEvento(m, 'FINANCEIRO', ev);
  assert.equal(rec.valor, 890000, 'receita = bruto − desconto comercial');
  const ea = doEvento(m, 'EVENTO_ANIMAIS', ev);
  const casos = [
    ['VENDAS', vd.sale_id, 'frete', 9001, 9000, [16]],
    ['VENDAS', vd.sale_id, 'outras_deducoes', 0, 1780, [16]],
    ['VENDAS', vd.sale_id, 'desconto_comercial', 0, 10000, [15]],
    ['VENDAS', vd.sale_id, 'qtd_animais', 3, 2, [16]],
    ['EVENTOS', ev, 'total_value', 890000, 900000, [16]],
    ['EVENTO_ANIMAIS', ea[0].event_animal_id, 'valor_individual', 395000, ea[0].valor_individual, [15]],
    ['FINANCEIRO', rec.financial_id, 'retida_pelo_comprador', 'S', 'N', []],
  ];
  for (const [aba, idReg, col, ruim, bom, esperado] of casos) {
    editar(m, aba, idReg, col, ruim);
    const achados = m.invariantes();
    assert.deepEqual([...new Set(achados.map((a) => a.invariante))].sort((x, y) => x - y), esperado, aba + '.' + col + ': ' + JSON.stringify(achados));
    editar(m, aba, idReg, col, bom);
    assert.deepEqual(m.invariantes(), [], aba + '.' + col + ' desfeito');
  }
});

test('período financeiro fechado (RN-082): venda, correção e estorno com competência até fin_bloqueio_ate pedem um aviso só, com justificativa', () => {
  const amb = ambiente({ config: { fin_bloqueio_ate: '2026-03-31' } });
  const { m } = amb;
  const comp = amb.parceiro('Comprador', 'COMPRADOR');
  const ids = rebanho(m, [boi('P1'), boi('P2')]);
  const dados = venda('2026-03-10', comp, [{ animal_id: ids.P1 }, { animal_id: ids.P2 }], { modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 600000 },
    { parcelas: [{ data_vencimento: '2026-04-10' }], deducoes: [{ tipo: 'COMISSAO', valor: 6000 }] });
  const av = falha(m, 'registrar', dados);
  assert.deepEqual([av.code, codigos(av)], ['NEEDS_CONFIRMATION', ['PERIODO_BLOQUEADO']], 'um aviso só, embora haja dois lançamentos');
  const r = m.run('registrar', Object.assign({}, dados, { justificativa_aviso: 'Nota atrasada' }), { avisos: ['PERIODO_BLOQUEADO'] });
  assert.deepEqual(m.evento(r.dados.event_id).payload_json.avisos_aceitos, [{ codigo: 'PERIODO_BLOQUEADO', n: 1, justificativa: 'Nota atrasada' }]);
  assert.deepEqual(codigos(falha(m, 'estornar', { event_id: r.dados.event_id, justificativa: 'x' })), ['PERIODO_BLOQUEADO']);
  const est = m.run('estornar', { event_id: r.dados.event_id, justificativa: 'Desfeita', justificativa_aviso: 'Período reaberto pelo contador' }, { avisos: ['PERIODO_BLOQUEADO'] });
  assert.ok(est.dados.event_id);
});

// ------------------------------------------------------------------ rotas ----
test('rotas pela api(): inventario.elegiveis de VENDA, evento.simular, evento.registrar, evento.obter (VENDAS, deduções, parcelas), animal.ficha (bloco H), dashboard.obter, evento.corrigir e evento.estornar; integridade limpa', () => {
  const s = S.sistema();
  const chamar = (p) => JSON.parse(JSON.stringify(s.gas.exec(() => s.G.api(p))));
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data; };
  const comprador = ok(chamar({ rota: 'parceiro.salvar', idempotencyKey: 'p1', dados: { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } } })).partner_id;
  const ini = ok(chamar({ rota: 'evento.registrar', idempotencyKey: 'ini', dados: S.entradaInicial([S.bicho({ brinco: '9001', sexo: 'M', data_nascimento: '2023-05-01', data_nascimento_confianca: 'ESTIMADA' }), S.bicho({ brinco: '9002', sexo: 'M', data_nascimento: '2023-05-01', data_nascimento_confianca: 'ESTIMADA' }), S.bicho({ brinco: '9003', pasto_destino_id: S.PASTOS.B, data_nascimento: '2022-05-01', data_nascimento_confianca: 'ESTIMADA' })]) }));
  const id = {};
  ini.animais.forEach((a) => { id[a.brinco] = a.animal_id; });
  const el = ok(chamar({ rota: 'inventario.elegiveis', dados: { tipo: 'VENDA', data: '2026-06-01', pasture_id: S.PASTOS.A } }));
  assert.deepEqual(el.itens.map((x) => x.brinco).sort(), ['9001', '9002']);
  const dados = { tipo: 'VENDA', campos: { event_date: '2026-06-01', partner_id: comprador, finalidade: 'ABATE', pasto_origem_id: S.PASTOS.A, modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 32000, valor_bruto: 1184000 },
    animais: [{ animal_id: id['9001'], peso: 540, peso_carcaca_kg: 285 }, { animal_id: id['9002'], peso: 520, peso_carcaca_kg: 270 }],
    parcelas: [{ data_vencimento: '2026-07-01', forma_pagamento: 'TRANSFERENCIA' }], deducoes: [{ tipo: 'FUNRURAL', valor: 17760, retida_pelo_comprador: true }] };
  const sim = chamar({ rota: 'evento.simular', dados: { acao: 'registrar', dados } });
  const im = ok(sim).impactos;
  assert.deepEqual([im.venda.arrobas, im.venda.deposito_esperado, im.financeiro.a_receber, im.financeiro.a_pagar, im.financeiro.por_animal.map((x) => [x.valor, x.deducoes, x.liquido])],
    [37, 1166240, 1184000, 17760, [[608000, 9120, 598880], [576000, 8640, 567360]]]);
  const reg = ok(chamar({ rota: 'evento.registrar', idempotencyKey: 'venda-api', dados, dataVersionEsperada: sim.meta.dataVersion }));
  const ob = ok(chamar({ rota: 'evento.obter', dados: { event_id: reg.event_id } }));
  assert.deepEqual([ob.evento.partner_id, ob.evento.total_value, ob.detalhes.VENDAS.length, ob.detalhes.FINANCEIRO.length, ob.detalhes.PARCELAS.length, ob.detalhes.ALOCACOES_FINANCEIRAS.length, ob.detalhes.PESAGENS.length, ob.evento.payload.deducoes[0].tipo],
    [comprador, 1184000, 1, 2, 2, 4, 2, 'FUNRURAL']);
  const fi = ok(chamar({ rota: 'animal.ficha', dados: { animal_id: id['9001'] } }));
  assert.deepEqual([fi.geral.situacao_cadastral, fi.financeiro.receitas, fi.financeiro.despesas_venda, fi.financeiro.lancamentos.length], ['VENDIDO', 608000, 9120, 2]);
  const dash = ok(chamar({ rota: 'dashboard.obter', dados: {} }));
  assert.deepEqual([dash.titulos.a_receber, dash.titulos.a_pagar, dash.cabecas], [1184000, 17760, 1]);
  const boot = ok(chamar({ rota: 'sistema.bootstrap', dados: {} }));
  const tv = boot.catalogo.tipos.find((t) => t.tipo === 'VENDA');
  assert.deepEqual([tv.revisao, tv.selecao_animais, Object.keys(tv.grupos_repetiveis)], ['SERVIDOR', 'VARIOS', ['parcelas', 'deducoes']]);
  // Correção e estorno pela api(), com a revisão pelo servidor.
  const corr = Object.assign({}, dados, { event_id: reg.event_id, justificativa: 'Preço do romaneio', campos: Object.assign({}, dados.campos, { preco_unitario: 31000, valor_bruto: 1147000 }) });
  const simc = ok(chamar({ rota: 'evento.simular', dados: { acao: 'corrigir', dados: corr } }));
  assert.equal(simc.impactos.substitui, reg.event_id);
  const k = ok(chamar({ rota: 'evento.corrigir', idempotencyKey: 'venda-corr', dados: corr }));
  const est = ok(chamar({ rota: 'evento.estornar', idempotencyKey: 'venda-est', dados: { event_id: k.event_id, justificativa: 'Venda cancelada' } }));
  assert.deepEqual(est.animais.map((a) => a.situacao_cadastral), ['ATIVO', 'ATIVO']);
  // Erro de validação pela api(): o envelope traz o detalhe por animal.
  const err = chamar({ rota: 'evento.registrar', idempotencyKey: 'venda-err', dados: Object.assign({}, dados, { animais: [{ animal_id: id['9003'], peso: 500, peso_carcaca_kg: 260 }] }) });
  assert.deepEqual([err.ok, err.error.code, err.error.details.map((d) => [d.codigo, d.animal_id])], [false, 'VALIDATION', [['ORIGEM_DIVERGENTE', id['9003']]]]);
  const integ = ok(chamar({ rota: 'sistema.integridade', dados: {} }));
  assert.equal(integ.ok, true, JSON.stringify(integ.achados));
  assert.equal(integ.alertas, 0, JSON.stringify(integ.achados));
  s.conferirProjecoes('depois das rotas de venda');
});
