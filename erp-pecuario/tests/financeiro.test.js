'use strict';
/**
 * FinancialService (puro): divisão de parcelas (03b, seção 11), rateio pelo maior resto com desempate determinístico
 * (07, seção 3.2; 03b, seção 13.3; CT-13 a–d com entrada embaralhada e 1.000 sorteios), a conta da negociação por
 * modalidade × base de peso (07, seção 4; 03b, seções 4.3 e 4.4), o lançamento montado no plano (natureza aceita,
 * sem caixa, invariantes 4, 13 e 14 como recusa de programação), a situação de pagamento (03b, seção 10.4) e o tipo
 * dos custos acessórios pela ordem. Regras e falhas, não só o caminho feliz.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');

const G = createGas({ order: 'reverse' }).G;
const F = G.FinancialService;
const js = (v) => JSON.parse(JSON.stringify(v));
const erroCom = (code) => (e) => e && e.code === code;

function aleatorio(semente) {
  let s = semente >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function coletor() {
  return G.Validation.coletor();
}

test('parcelas iguais: o quociente para todas e os centavos que sobram para as primeiras (9.400,00 em 3; 9.039,05 em 2); entrada inválida → INTERNAL', () => {
  assert.deepEqual(js(F.dividirParcelas(940000, 3)), [313334, 313333, 313333]);
  assert.deepEqual(js(F.dividirParcelas(903905, 2)), [451953, 451952]);
  assert.deepEqual(js(F.dividirParcelas(2, 3)), [1, 1, 0], 'a divisão em si aceita parcela zero; quem a recusa é resolverParcelas');
  for (const [t, n] of [[0, 1], [100, 0], [10.5, 2], [100, 1.5], [-1, 2]]) assert.throws(() => F.dividirParcelas(t, n), erroCom('INTERNAL'), t + '/' + n);
  for (let i = 0; i < 200; i++) {
    const total = 1 + Math.floor(aleatorio(i)() * 1e9);
    const n = 1 + (i % 12);
    const p = F.dividirParcelas(total, n);
    assert.equal(p.reduce((s, x) => s + x, 0), total);
    assert.ok(Math.max(...p) - Math.min(...p) <= 1);
  }
});

test('títulos de um lançamento: vencimento obrigatório e válido, valor positivo, soma = valor; vazios dividem o que falta; nenhum espaço para os vazios → PARCELAS_NAO_SOMAM', () => {
  const o = { campo: 'parcelas', rotulo: 'a compra' };
  let col = coletor();
  assert.deepEqual(js(F.resolverParcelas(100000, [{ data_vencimento: '2026-04-01', valor: 40000, forma_pagamento: 'PIX' }, { data_vencimento: '2026-05-01' }, { data_vencimento: '2026-06-01' }], col, o)).map((p) => [p.parcela_num, p.valor, p.forma_pagamento]),
    [[1, 40000, 'PIX'], [2, 30000, null], [3, 30000, null]]);
  assert.equal(col.erros.length, 0);
  const casos = [
    [[], 'SEM_PARCELAS'],
    [[{ valor: 100000 }], 'CAMPO_OBRIGATORIO'],
    [[{ data_vencimento: '2026-02-30', valor: 100000 }], 'FORMATO_INVALIDO'],
    [[{ data_vencimento: '2026-04-01', valor: 0 }], 'VALOR_FORA_DA_FAIXA'],
    [[{ data_vencimento: '2026-04-01', valor: 10.5 }], 'VALOR_FORA_DA_FAIXA'],
    [[{ data_vencimento: '2026-04-01', valor: 60000 }, { data_vencimento: '2026-05-01', valor: 30000 }], 'PARCELAS_NAO_SOMAM'],
    [[{ data_vencimento: '2026-04-01', valor: 100000 }, { data_vencimento: '2026-05-01' }], 'PARCELAS_NAO_SOMAM'],
    [Array.from({ length: F.MAX_PARCELAS + 1 }, () => ({ data_vencimento: '2026-04-01' })), 'PARCELAS_DEMAIS'],
  ];
  for (const [lista, codigo] of casos) {
    col = coletor();
    assert.equal(F.resolverParcelas(100000, lista, col, o), null, codigo);
    assert.deepEqual(js(col.erros.map((e) => e.codigo)), [codigo], JSON.stringify(lista).slice(0, 80));
    assert.ok(col.erros[0].mensagem.length > 15);
  }
});

test('CT-13 (a a d): rateio pelo maior resto em centavos — 100,00 ÷ 3 cabeças, 1.500,00 por peso vivo, 900,00 por dias, base zero; desempate maior resto → maior base → menor código', () => {
  const it = (bases) => bases.map((b, i) => ({ animal_id: 'a' + i, chave: 'A-00010' + (i + 1), base: b }));
  const valores = (r) => r.itens.map((x) => x.valor);
  const a = F.ratear(10000, 'CABECAS', it([1, 1, 1]));
  assert.deepEqual([js(valores(a)), a.baseTotal, a.totalAlocado, a.criterio], [[3334, 3333, 3333], 3, 10000, 'CABECAS']);
  const b = F.ratear(150000, 'PESO_VIVO', it([200, 250, 310]));
  assert.deepEqual([js(valores(b)), b.baseTotal], [[39474, 49342, 61184], 760]);
  const c = F.ratear(90000, 'DIAS_PERMANENCIA', it([31, 16, 10]));
  assert.deepEqual([js(valores(c)), c.baseTotal], [[48947, 25263, 15790], 57]);
  const d = F.ratear(90000, 'DIAS_PERMANENCIA', it([0, 0]));
  assert.deepEqual([js(valores(d)), d.baseTotal, d.totalAlocado], [[0, 0], 0, 0], 'base zero: nada alocado');
  // Desempate de 03b, 15.1: restos iguais (3.085) → maior base (212,5 kg) leva o centavo.
  assert.deepEqual(js(valores(F.ratear(903905, 'PESO_VIVO', it([212.5, 198, 206.5])))), [311313, 290070, 302522]);
  // Um animal só vira DIRETO, com a base igual ao valor do lançamento (invariante 13).
  const so = F.ratear(36000, 'PESO_VIVO', it([212.5]));
  assert.deepEqual([so.criterio, so.itens[0].base, so.itens[0].valor], ['DIRETO', 360, 36000]);
  // A ordem de entrada não muda quem recebe o quê.
  const rnd = aleatorio(13);
  const base = it([200, 250, 310, 310, 1, 77.5]);
  const ref = Object.fromEntries(F.ratear(150001, 'PESO_VIVO', base).itens.map((x) => [x.chave, x.valor]));
  for (let k = 0; k < 20; k++) {
    const emb = base.slice().sort(() => rnd() - 0.5);
    assert.deepEqual(Object.fromEntries(F.ratear(150001, 'PESO_VIVO', emb).itens.map((x) => [x.chave, x.valor])), ref);
  }
  // 1.000 sorteios com semente fixa: a soma fecha sempre ao centavo e ninguém fica com mais de 1 centavo acima da quota.
  const r = aleatorio(2027);
  for (let i = 0; i < 1000; i++) {
    const n = 1 + Math.floor(r() * 30);
    const bases = Array.from({ length: n }, () => Math.round((0.1 + r() * 900) * 10) / 10);
    const total = Math.floor(r() * 1e8);
    const out = F.ratear(total, 'PESO_VIVO', it(bases));
    assert.equal(out.itens.reduce((s, x) => s + x.valor, 0), total, 'sorteio ' + i);
    const soma = bases.reduce((s, x) => s + x, 0);
    if (n > 1) out.itens.forEach((x, j) => assert.ok(Math.abs(x.valor - total * bases[j] / soma) < 1 + 1e-6));
  }
  assert.throws(() => F.ratear(100, 'CABECAS', [{ animal_id: 'x', chave: 'A', base: 1 }, { animal_id: 'y', chave: 'A', base: 1 }]), erroCom('VALIDATION'), 'chave repetida');
});

test('negociação por modalidade × base de peso (03b, 4.4 e 07, 4.3): conferência, arrobas, critério e bases; o valor informado prevalece', () => {
  const an = (pesos, extra) => pesos.map((p, i) => Object.assign({ chave: 'A' + i, peso: p }, extra ? extra(i) : {}));
  // 2: KG_VIVO, 617,0 kg × 14,65 = 9.039,05.
  let n = F.negociacao({ modalidade: 'KG_VIVO', preco_unitario: 1465, valor: 903905, animais: an([212.5, 198, 206.5]) });
  assert.deepEqual([n.base_peso, n.peso_vivo_total, n.conferencia, n.desvio_pct, n.criterio, js(n.bases), n.unidade_preco, n.erros.length, n.avisos.length], ['VIVO', 617, 903905, 0, 'PESO_VIVO', [212.5, 198, 206.5], 'KG_VIVO', 0, 0]);
  // 3: ARROBA VIVO, 3.300 kg × 50% ÷ 15 = 110 @ × 290,00 = 31.900,00, só o peso do lote: por cabeça, com aviso.
  n = F.negociacao({ modalidade: 'ARROBA', base_peso: 'VIVO', rendimento_carcaca_pct: 50, rendimento_tipo: 'NEGOCIADO', preco_unitario: 29000, peso_total_kg: 3300, valor: 3190000, animais: an(Array(10).fill(undefined)) });
  assert.deepEqual(js([n.arrobas, n.conferencia, n.criterio, n.avisos.map((x) => x.codigo), n.rendimento_tipo]), [110, 3190000, 'CABECAS', ['RATEIO_SEM_PESO'], 'NEGOCIADO']);
  // (c) de 07: dividir o peso vivo por 15 daria 320 @ e R$ 96.000,00 — a base explícita dá 160 @ e R$ 48.000,00.
  n = F.negociacao({ modalidade: 'ARROBA', base_peso: 'VIVO', rendimento_carcaca_pct: 50, rendimento_tipo: 'NEGOCIADO', preco_unitario: 30000, peso_total_kg: 4800, valor: 4815000, animais: an(Array(20).fill(undefined)) });
  assert.deepEqual(js([n.arrobas, n.conferencia, n.desvio_pct, n.avisos.map((x) => x.codigo)]), [160, 4800000, 0.31, ['RATEIO_SEM_PESO']]);
  // Tolerância (03b, 4.3): 9.000,00 contra 9.039,05 = 0,43% (sem aviso); 8.900,00 = 1,54% (aviso); tolerância de 2% cala.
  const kg = (valor, tol) => F.negociacao({ modalidade: 'KG_VIVO', preco_unitario: 1465, valor, tolerancia_pct: tol, animais: an([212.5, 198, 206.5]) });
  assert.deepEqual(js([kg(900000).desvio_pct, kg(900000).avisos.length, kg(890000).desvio_pct, kg(890000).avisos.map((x) => x.codigo), kg(890000, 2).avisos.length]), [0.43, 0, 1.54, ['VALOR_DIVERGENTE'], 0]);
  // Arroba de carcaça (CT-14 a, na compra): 555,0 kg ÷ 15 = 37 @ × 320,00 = 11.840,00; rendimento apurado 52,4%.
  n = F.negociacao({ modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 32000, valor: 1184000, animais: [{ chave: 'A1', peso: 540, peso_carcaca_kg: 285 }, { chave: 'A2', peso: 520, peso_carcaca_kg: 270 }] });
  assert.deepEqual([n.arrobas, n.conferencia, n.rendimento_pct, n.rendimento_tipo, n.peso_carcaca_total, n.criterio, js(n.bases)], [37, 1184000, 52.4, 'APURADO', 555, 'PESO_CARCACA', [285, 270]]);
  // Por cabeça: preço único → CABECAS; valor por animal → VALOR_INDIVIDUAL (base em R$); um animal → DIRETO.
  n = F.negociacao({ modalidade: 'CABECA', preco_unitario: 300000, valor: 6000000, animais: an(Array(20).fill(undefined)) });
  assert.deepEqual([n.conferencia, n.criterio, n.unidade_preco], [6000000, 'CABECAS', 'CABECA']);
  n = F.negociacao({ modalidade: 'CABECA', valor: 900000, animais: [{ chave: 'A1', valor_individual: 300000 }, { chave: 'A2', valor_individual: 310000 }, { chave: 'A3', valor_individual: 290000 }] });
  assert.deepEqual([n.conferencia, n.criterio, js(n.bases), n.unidade_preco], [900000, 'VALOR_INDIVIDUAL', [3000, 3100, 2900], null]);
  n = F.negociacao({ modalidade: 'LOTE', criterio_rateio: 'PESO_VIVO', valor: 2000000, animais: an([300]) });
  assert.deepEqual([n.criterio, js(n.bases), n.conferencia], ['DIRETO', [20000], null], 'um animal: DIRETO; lote não tem conferência');
});

test('negociação recusa o que não fecha: modalidade, base, rendimento, preço, valores incompletos ou que não somam, pesos, carcaça maior que o vivo, critério do lote', () => {
  const cod = (spec) => js(F.negociacao(spec).erros.map((e) => e.codigo).sort());
  const dois = [{ chave: 'A1', peso: 300 }, { chave: 'A2', peso: 310 }];
  assert.deepEqual(cod({ valor: 1, animais: dois }), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(cod({ modalidade: 'KG_VIVO', base_peso: 'CARCACA', preco_unitario: 100, valor: 61000, animais: dois }), ['BASE_PESO_INVALIDA']);
  assert.deepEqual(cod({ modalidade: 'CABECA', base_peso: 'VIVO', preco_unitario: 100, valor: 200, animais: dois }), ['CAMPO_NAO_SE_APLICA']);
  assert.deepEqual(cod({ modalidade: 'ARROBA', base_peso: 'VIVO', rendimento_carcaca_pct: 120, rendimento_tipo: 'ESTIMADO', preco_unitario: 100, valor: 100, animais: dois }), ['VALOR_FORA_DA_FAIXA']);
  assert.deepEqual(cod({ modalidade: 'ARROBA', base_peso: 'CARCACA', rendimento_carcaca_pct: 50, preco_unitario: 100, valor: 100, animais: [{ chave: 'A', peso: 300, peso_carcaca_kg: 150 }, { chave: 'B', peso: 300, peso_carcaca_kg: 160 }] }), ['CAMPO_NAO_SE_APLICA']);
  assert.deepEqual(cod({ modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 100, valor: 100, animais: [{ chave: 'A', peso: 300, peso_carcaca_kg: 300 }, { chave: 'B', peso: 300, peso_carcaca_kg: 160 }] }), ['CARCACA_MAIOR_QUE_VIVO']);
  assert.deepEqual(cod({ modalidade: 'ARROBA', base_peso: 'VIVO', rendimento_carcaca_pct: 50, rendimento_tipo: 'NEGOCIADO', preco_unitario: 100, valor: 100, animais: [{ chave: 'A' }, { chave: 'B' }] }), ['PESO_OBRIGATORIO']);
  assert.deepEqual(cod({ modalidade: 'KG_VIVO', preco_unitario: 100, valor: 100, animais: [{ chave: 'A', peso: 300 }, { chave: 'B' }] }), ['PESO_INCOMPLETO', 'PESO_OBRIGATORIO'], 'peso de um só, sem total');
  assert.deepEqual(cod({ modalidade: 'KG_VIVO', preco_unitario: -5, valor: 100, animais: dois }), ['VALOR_FORA_DA_FAIXA']);
  assert.deepEqual(cod({ modalidade: 'LOTE', criterio_rateio: 'DIAS_PERMANENCIA', valor: 100, animais: dois }), ['CAMPO_OBRIGATORIO'], 'dias de permanência não cabe em compra (03b, 4.5)');
  assert.deepEqual(cod({ modalidade: 'LOTE', criterio_rateio: 'VALOR_INDIVIDUAL', valor: 100, animais: [{ chave: 'A', valor_individual: 100 }, { chave: 'B' }] }), ['VALORES_INCOMPLETOS', 'VALORES_INCOMPLETOS']);
  assert.deepEqual(cod({ modalidade: 'LOTE', criterio_rateio: 'MANUAL', valor: 100, animais: [{ chave: 'A', base_manual: 1 }, { chave: 'B' }] }), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(cod({ modalidade: 'CABECA', preco_unitario: 100, valor: 200, animais: [{ chave: 'A', base_manual: 1 }, { chave: 'B' }] }), ['CAMPO_NAO_SE_APLICA']);
  assert.deepEqual(cod({ modalidade: 'KG_VIVO', preco_unitario: 100, valor: 61000, animais: [{ chave: 'A', peso: 300, valor_individual: 5 }, { chave: 'B', peso: 310 }] }), ['CAMPO_NAO_SE_APLICA'], 'valor por animal só por cabeça ou lote pelo valor');
  // Erro de animal traz o índice (o EventService liga ao "quem" da linha).
  const e = F.negociacao({ modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 100, valor: 100, animais: [{ chave: 'A', peso: 300, peso_carcaca_kg: 160 }, { chave: 'B', peso: 300, peso_carcaca_kg: 310 }] }).erros;
  assert.deepEqual(js(e).map((x) => [x.codigo, x.indice]), [['CARCACA_MAIOR_QUE_VIVO', 1]]);
});

test('lançamento no plano: linhas de FINANCEIRO, PARCELAS, RATEIOS e ALOCACOES; natureza recusada; conta inativa; sem caixa; recusas de programação (invariantes 4 e 14)', () => {
  let n = 0;
  const tx = { novoId: () => 'id-' + (++n), usuario: 'dono@gmail.com' };
  const conta = { conta_id: 'c1', codigo: 'COMPRA_ANIMAIS', nome: 'Compra de animais', natureza: 'AQUISICAO_ANIMAIS', tipo: 'DESPESA', grupo: 'CUSTO_DIRETO', ativo: true };
  const ev = { event_id: 'ev-1', event_date: '2027-03-10', property_id: 'prop-1' };
  const rateio = { criterio: 'PESO_VIVO', cemPorCento: true, itens: [{ animal_id: 'a1', chave: 'A-000431', base: 212.5 }, { animal_id: 'a2', chave: 'A-000432', base: 198 }, { animal_id: 'a3', chave: 'A-000433', base: 206.5 }] };
  const spec = { evento: ev, conta, naturezas: ['AQUISICAO_ANIMAIS'], valor: 903905, descricao: 'Compra de 3 animais', partner_id: 'forn-1', documento: '000789', quantidade: 3,
    parcelas: [{ data_vencimento: '2027-04-09', forma_pagamento: 'BOLETO' }, { data_vencimento: '2027-05-09', forma_pagamento: 'BOLETO' }], rateio };
  let col = coletor();
  const pl = js(F.planejar(tx, spec, col));
  assert.equal(col.erros.length, 0);
  assert.deepEqual(Object.keys(pl.linhas).map((k) => [k, pl.linhas[k].length]), [['FINANCEIRO', 1], ['PARCELAS', 2], ['RATEIOS', 1], ['ALOCACOES_FINANCEIRAS', 3]]);
  const f = pl.linhas.FINANCEIRO[0];
  assert.deepEqual([f.natureza, f.tipo, f.categoria, f.data_competencia, f.valor, f.property_id, f.retida_pelo_comprador, f.animal_id], ['AQUISICAO_ANIMAIS', 'DESPESA', 'CUSTO_DIRETO', '2027-03-10', 903905, 'prop-1', false, undefined]);
  assert.deepEqual(pl.linhas.PARCELAS.map((p) => [p.parcela_num, p.valor, p.status]), [[1, 451953, 'ABERTA'], [2, 451952, 'ABERTA']]);
  assert.deepEqual([pl.linhas.RATEIOS[0].escopo_tipo, pl.linhas.RATEIOS[0].escopo_ref, pl.linhas.RATEIOS[0].base_total, pl.linhas.RATEIOS[0].total_alocado], ['EVENTO', 'ev-1', 617, 903905]);
  // Natureza fora da aceita, conta inativa, valor zero e base zero: erros no coletor, nada planejado.
  const casos = [
    [{ conta: Object.assign({}, conta, { natureza: 'CUSTEIO' }) }, 'CONTA_INVALIDA'],
    [{ conta: Object.assign({}, conta, { ativo: false }) }, 'CONTA_INATIVA'],
    [{ valor: 0, parcelas: [{ data_vencimento: '2027-04-09' }] }, 'VALOR_FORA_DA_FAIXA'],
    [{ rateio: Object.assign({}, rateio, { itens: [{ animal_id: 'a1', chave: 'A', base: 0 }, { animal_id: 'a2', chave: 'B', base: 1 }] }) }, 'BASE_INVALIDA'],
    [{ rateio: Object.assign({}, rateio, { criterio: 'MANUAL' }) }, 'CAMPO_OBRIGATORIO'],
  ];
  for (const [mudanca, codigo] of casos) {
    col = coletor();
    assert.equal(F.planejar(tx, Object.assign({}, spec, mudanca), col), null, codigo);
    assert.ok(js(col.erros.map((e) => e.codigo)).includes(codigo), codigo + ': ' + JSON.stringify(col.erros));
  }
  // Sem caixa (abertura, consumo): sem parcela; parcela nesse lançamento é erro de programação.
  col = coletor();
  const sc = js(F.planejar(tx, Object.assign({}, spec, { semCaixa: true, parcelas: null }), col));
  assert.deepEqual([sc.linhas.PARCELAS.length, sc.linhas.ALOCACOES_FINANCEIRAS.length], [0, 3]);
  assert.throws(() => F.planejar(tx, Object.assign({}, spec, { semCaixa: true }), coletor()), erroCom('INTERNAL'));
  assert.throws(() => F.planejar(tx, Object.assign({}, spec, { conta: Object.assign({}, conta, { natureza: 'ESTOQUE_INSUMOS' }), naturezas: null }), coletor()), erroCom('INTERNAL'), 'insumo não é rateado');
  assert.throws(() => F.planejar(tx, Object.assign({}, spec, { conta: null }), coletor()), erroCom('INTERNAL'));
  // Período bloqueado.
  assert.equal(F.avisoPeriodo({ fin_bloqueio_ate: '2027-03-31' }, '2027-04-01', 'A compra'), null);
  assert.equal(F.avisoPeriodo({ fin_bloqueio_ate: null }, '2027-03-10', 'A compra'), null);
  assert.equal(F.avisoPeriodo({ fin_bloqueio_ate: '2027-03-31' }, '2027-03-10', 'A compra').codigo, 'PERIODO_BLOQUEADO');
});

test('situação de pagamento (03b, 10.4) e tipo dos custos acessórios pelo registro do evento (payload_json.custos), nunca pela ordem das linhas', () => {
  const sp = (parcelas, ativo) => js(F.situacaoPagamento(parcelas, ativo));
  assert.deepEqual(sp([], true), { status_pagamento: 'SEM_CAIXA', data_pagamento: null });
  assert.deepEqual(sp([], false), { status_pagamento: 'SEM_CAIXA', data_pagamento: null }, 'sem parcela, vigente ou não');
  assert.deepEqual(sp([{ status: 'ABERTA' }], false), { status_pagamento: 'CANCELADO', data_pagamento: null });
  assert.deepEqual(sp([{ status: 'ABERTA' }, { status: 'ABERTA' }], true).status_pagamento, 'ABERTO');
  assert.deepEqual(sp([{ status: 'LIQUIDADA', data_pagamento: '2027-04-14' }, { status: 'ABERTA' }], true).status_pagamento, 'PARCIAL');
  assert.deepEqual(sp([{ status: 'LIQUIDADA', data_pagamento: '2027-04-14' }, { status: 'LIQUIDADA', data_pagamento: '2027-05-10' }, { status: 'CANCELADA' }], true), { status_pagamento: 'LIQUIDADO', data_pagamento: '2027-05-10' });
  const l = (ids) => ids.map((financial_id) => ({ financial_id, valor: 100 }));
  const p = (tipos) => ({ custos: Object.keys(tipos).map((financial_id) => ({ financial_id, tipo: tipos[financial_id] })) });
  assert.deepEqual(js(F.tiposDosCustos(p({ f1: 'FRETE' }), l(['f1']))), { f1: 'FRETE' });
  // A ordem das linhas não conta: o outro custo antes do frete continua sendo outro custo.
  assert.deepEqual(js(F.tiposDosCustos(p({ f1: 'FRETE', f2: 'FRETE', f3: 'OUTRO' }), l(['f3', 'f1', 'f2']))), { f3: 'OUTRO', f1: 'FRETE', f2: 'FRETE' });
  assert.deepEqual(js(F.tiposDosCustos(p({ f9: 'OUTRO' }), l(['f9']))), { f9: 'OUTRO' });
  assert.equal(F.tiposDosCustos(p({ f1: 'FRETE' }), l(['f1', 'f2'])), null, 'lançamento acessório fora do registro do evento: não confere');
  assert.equal(F.tiposDosCustos(null, l(['f1'])), null, 'sem o registro, nenhum tipo é inventado');
});

test('venda (03b, 4.2 e 4.3; 07, 4.2): totais com retenção, conta de cada dedução pelo tipo e a negociação com romaneio total, bruto conferido e base pela pesagem anterior', () => {
  // Totais do exemplo 4 de 03b, 4.4: frete retido e retenção; depósito esperado 103.728,96.
  assert.deepEqual(js(F.totaisVenda({ valor_bruto: 10713600, desconto_comercial: 0, deducoes: [{ tipo: 'FRETE', valor: 180000, retida: true }, { tipo: 'FUNRURAL', valor: 160704, retida: true }, { tipo: 'COMISSAO', valor: 5000 }] })),
    { valor_bruto: 10713600, desconto_comercial: 0, receita: 10713600, frete: 180000, comissao: 5000, outras_deducoes: 160704, deducoes: 345704, retidas: 340704, resultado_negociacao: 10367896, deposito_esperado: 10372896 });
  assert.deepEqual(js(F.totaisVenda({ valor_bruto: 600000, desconto_comercial: 20000 })).receita, 580000, 'receita = bruto − desconto comercial');
  assert.deepEqual(['FRETE', 'COMISSAO', 'FUNRURAL', 'SENAR', 'OUTRA'].map(F.contaDeducao), ['FRETE_VENDA', 'COMISSAO_VENDA', 'TAXAS_RETENCOES_VENDA', 'TAXAS_RETENCOES_VENDA', 'TAXAS_RETENCOES_VENDA']);
  const base = { modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 32000, carcacaTotal: true, arroba_kg: 15, tolerancia_pct: 1 };
  // Só o total do romaneio e o peso vivo do lote: rendimento apurado; sem peso de ninguém, divisão por cabeça com aviso.
  const t = F.negociacao(Object.assign({}, base, { peso_total_kg: 9540, peso_carcaca_total_kg: 5022, valor: 10713600, animais: [{ chave: 'a' }, { chave: 'b' }] }));
  assert.deepEqual(js([t.erros, t.peso_carcaca_total, t.rendimento_pct, t.rendimento_tipo, t.arrobas, t.conferencia, t.criterio, t.avisos.map((a) => a.codigo)]), [[], 5022, 52.6, 'APURADO', 334.8, 10713600, 'CABECAS', ['RATEIO_SEM_PESO']]);
  // Com a última pesagem de cada um: peso vivo estimado, escalado para o lote.
  const e = F.negociacao(Object.assign({}, base, { modalidade: 'KG_VIVO', base_peso: null, preco_unitario: 1000, peso_total_kg: 1000, valor: 1000000, animais: [{ chave: 'a' }, { chave: 'b' }], pesagens: [300, 500] }));
  assert.deepEqual(js([e.erros, e.criterio, e.estimado, e.bases]), [[], 'PESO_VIVO', true, [375, 625]]);
  assert.equal(F.negociacao(Object.assign({}, base, { modalidade: 'KG_VIVO', base_peso: null, preco_unitario: 1000, peso_total_kg: 1000, valor: 1000000, animais: [{ chave: 'a' }, { chave: 'b' }], pesagens: [300, null] })).criterio, 'CABECAS', 'falta a pesagem de um: por cabeça');
  // A conta pelo preço é conferida contra o bruto; os valores por animal somam a receita distribuída.
  const d = F.negociacao({ modalidade: 'CABECA', preco_unitario: 300000, valor: 580000, valor_conferencia: 612000, campo_valor: 'valor_bruto', tolerancia_pct: 1, animais: [{ chave: 'a' }, { chave: 'b' }] });
  assert.deepEqual(js([d.conferencia, d.desvio_pct, d.avisos.map((a) => [a.codigo, a.campo])]), [600000, 2, [['VALOR_DIVERGENTE', 'valor_bruto']]]);
  const vi = F.negociacao({ modalidade: 'CABECA', valor: 580000, valor_conferencia: 600000, rotulo_valor: 'a receita da venda', animais: [{ chave: 'a', valor_individual: 300000 }, { chave: 'b', valor_individual: 300000 }] });
  assert.deepEqual(js(vi.erros.map((x) => x.codigo)), ['VALOR_INDIVIDUAL_NAO_SOMA']);
  assert.match(vi.erros[0].mensagem, /difere da receita da venda \(R\$ 5\.800,00\)/);
  // Falhas da carcaça na venda: parte dos animais; total diferente da soma; total fora da arroba de carcaça.
  const carc = (animais, extra) => js(F.negociacao(Object.assign({}, base, { valor: 1184000, animais }, extra || {})).erros.map((x) => x.codigo));
  assert.deepEqual(carc([{ chave: 'a', peso_carcaca_kg: 285 }, { chave: 'b' }]), ['PESO_INCOMPLETO']);
  assert.deepEqual(carc([{ chave: 'a', peso_carcaca_kg: 285 }, { chave: 'b', peso_carcaca_kg: 270 }], { peso_carcaca_total_kg: 556 }), ['PESO_TOTAL_DIVERGENTE']);
  assert.deepEqual(carc([{ chave: 'a' }, { chave: 'b' }]), ['PESO_OBRIGATORIO']);
  assert.deepEqual(js(F.negociacao({ modalidade: 'LOTE', criterio_rateio: 'CABECAS', valor: 100, carcacaTotal: true, peso_carcaca_total_kg: 10, animais: [{ chave: 'a' }, { chave: 'b' }] }).erros.map((x) => x.codigo)), ['CAMPO_NAO_SE_APLICA']);
  // Na compra (sem carcacaTotal) nada disso muda: o total do romaneio não é aceito e a carcaça é de cada animal.
  assert.deepEqual(js(F.negociacao(Object.assign({}, base, { carcacaTotal: undefined, peso_carcaca_total_kg: 555, valor: 1184000, animais: [{ chave: 'a' }, { chave: 'b' }] })).erros.map((x) => x.codigo)), ['PESO_OBRIGATORIO']);
});
