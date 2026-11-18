'use strict';
/**
 * Conciliacao (puro): as três visões e a identidade que as liga (07-financeiro-e-indicadores.md, seções 1.1, 2.1 e 2.2;
 * desenho-base 16.14; CT-19). O caso numérico do 07, seção 2.2, mês a mês e nas três datas da conciliação; o arrendamento
 * anual da 1.1 (competência por período, maior resto por mês, despesa antecipada em 31/03); a parte até o dia D; a regra de
 * tempo (o fato depois de D não muda D); o que a identidade acusa (aquisição sem rateio inteiro, parcelas que não somam,
 * pagamento antes do lançamento, alocação a animal que não estava no rebanho); e um sorteio de 400 bases coerentes em que
 * a identidade fecha em todo fim de mês, com a soma dos meses igual à do período.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');

const G = createGas({ order: 'reverse' }).G;
const C = G.Conciliacao;
const js = (v) => JSON.parse(JSON.stringify(v));
const erroCom = (code) => (e) => e && e.code === code;

function aleatorio(semente) {
  let s = semente >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
/** Um lançamento dos fatos (a forma que `Conciliacao.fatos` devolve). */
function lanc(id, natureza, tipo, valor, data, extra) {
  return Object.assign({ financial_id: id, event_id: 'ev-' + id, ancora: 'ev-' + id, natureza, tipo, valor, data, inicio: null, fim: null, consumo: false, abertura: false, parcelas: [], alocacoes: [] }, extra || {});
}
const aberta = (valor) => ({ valor, status: 'ABERTA', data_pagamento: null, valor_pago: 0, juros_multa: 0, desconto: 0 });
const paga = (valor, data, juros, desconto) => ({ valor, status: 'LIQUIDADA', data_pagamento: data, valor_pago: valor + (juros || 0) - (desconto || 0), juros_multa: juros || 0, desconto: desconto || 0 });

/**
 * O caso do 07, seção 2.2: três garrotes comprados em 10/03/2027, a vacina em estoque e a aplicação, o arrendamento do
 * Pasto 2 (R$ 600,00 de 01/06 a 30/06, pago em 05/06), a morte de A3 em 16/06, a contabilidade, e a venda de A1 e A2 em
 * 20/11 com a retenção do frigorífico, recebida em 20/12.
 */
function caso22() {
  const C1 = 'ev-compra';
  const perm = (saida) => [{ entrada: { event_id: C1, data: '2027-03-10' }, saida }];
  return {
    marco_zero: '2027-01-01',
    lancamentos: [
      lanc('F1', 'AQUISICAO_ANIMAIS', 'DESPESA', 900000, '2027-03-10', { event_id: C1, ancora: C1, parcelas: [paga(450000, '2027-04-09'), paga(450000, '2027-05-24', 4500)], alocacoes: [{ animal_id: 'A1', valor: 300000 }, { animal_id: 'A2', valor: 310000 }, { animal_id: 'A3', valor: 290000 }] }),
      lanc('F2', 'AQUISICAO_ANIMAIS', 'DESPESA', 10000, '2027-03-10', { event_id: C1, ancora: C1, parcelas: [paga(10000, '2027-03-10')], alocacoes: [{ animal_id: 'A1', valor: 3334 }, { animal_id: 'A2', valor: 3333 }, { animal_id: 'A3', valor: 3333 }] }),
      lanc('F3', 'ESTOQUE_INSUMOS', 'DESPESA', 3000, '2027-04-02', { parcelas: [paga(3000, '2027-04-02')] }),
      lanc('F4', 'CUSTEIO', 'DESPESA', 900, '2027-04-05', { consumo: true, alocacoes: [{ animal_id: 'A1', valor: 300 }, { animal_id: 'A2', valor: 300 }, { animal_id: 'A3', valor: 300 }] }),
      lanc('F5', 'CUSTEIO', 'DESPESA', 60000, '2027-06-01', { inicio: '2027-06-01', fim: '2027-06-30', parcelas: [paga(60000, '2027-06-05')], alocacoes: [{ animal_id: 'A1', valor: 27692 }, { animal_id: 'A2', valor: 18462 }, { animal_id: 'A3', valor: 13846 }] }),
      lanc('F6', 'CUSTEIO', 'DESPESA', 20000, '2027-06-30', { parcelas: [paga(20000, '2027-06-30')] }),
      lanc('F7', 'RECEITA_VENDA_ANIMAIS', 'RECEITA', 1184000, '2027-11-20', { parcelas: [paga(1184000, '2027-12-20')], alocacoes: [{ animal_id: 'A1', valor: 608000 }, { animal_id: 'A2', valor: 576000 }] }),
      lanc('F8', 'DESPESA_VENDA', 'DESPESA', 17760, '2027-11-20', { parcelas: [paga(17760, '2027-12-20')], alocacoes: [{ animal_id: 'A1', valor: 9120 }, { animal_id: 'A2', valor: 8640 }] }),
    ],
    permanencias: {
      A1: perm({ event_id: 'ev-venda', data: '2027-11-20', linha: 'vendidos_descartados' }),
      A2: perm({ event_id: 'ev-venda', data: '2027-11-20', linha: 'vendidos_descartados' }),
      A3: perm({ event_id: 'ev-morte', data: '2027-06-16', linha: 'mortes' }),
    },
  };
}

test('07, 2.2: caixa e resultado mês a mês, ao centavo (o frete pago é custo de aquisição; a vacina vira custo na aplicação; os juros entram no mês do pagamento; a morte leva o custo de A3 em junho; a venda, o de A1 e A2 em novembro)', () => {
  const fx = caso22();
  const mes = (m) => ({ caixa: C.caixa(fx, m + '-01', G.Utils.somaDias(G.Utils.somaMeses(m + '-01', 1), -1)).liquido, resultado: C.resultado(fx, m + '-01', G.Utils.somaDias(G.Utils.somaMeses(m + '-01', 1), -1)).total });
  assert.deepEqual(mes('2027-03'), { caixa: -10000, resultado: 0 });
  assert.deepEqual(mes('2027-04'), { caixa: -453000, resultado: -900 });
  assert.deepEqual(mes('2027-05'), { caixa: -454500, resultado: -4500 });
  assert.deepEqual(mes('2027-06'), { caixa: -80000, resultado: -373333 });
  assert.deepEqual(mes('2027-11'), { caixa: 0, resultado: 549573 });
  assert.deepEqual(mes('2027-12'), { caixa: 1166240, resultado: 0 });
  const jun = js(C.resultado(fx, '2027-06-01', '2027-06-30'));
  assert.deepEqual([jun.custeio, jun.custo_aquisicao.mortes, jun.custo_aquisicao.vendidos_descartados], [80000, 293333, 0], 'junho: custeio de 800,00 e o custo de aquisição de A3 na linha das mortes');
  const nov = js(C.resultado(fx, '2027-11-01', '2027-11-30'));
  assert.deepEqual([nov.receita_venda, nov.despesas_venda, nov.custo_aquisicao.vendidos_descartados, nov.total], [1184000, 17760, 616667, 549573]);
  const ano = js(C.resultado(fx, null, '2027-12-31'));
  assert.equal(ano.total, 170840, 'resultado acumulado = 11.840,00 − 177,60 − 6.166,67 − 2.933,33 − 809,00 − 45,00 = 1.708,40');
  assert.deepEqual([ano.juros, ano.descontos, ano.custeio], [4500, 0, 80900]);
  assert.equal(C.caixa(fx, null, '2027-12-31').liquido, 168740, 'caixa acumulado de 1.687,40');
});

test('07, 2.2: a conciliação em 30/06, 30/11 e 31/12 fecha com os termos da tabela (os R$ 21,00 que separam caixa e resultado no fim do ano são as 7 doses em estoque)', () => {
  const fx = caso22();
  const termos = (d) => { const t = js(C.termosEm(fx, d)); delete t.data; return t; };
  assert.deepEqual(termos('2027-06-30'), {
    resultado_acumulado: -378733, caixa_acumulado: -997500, a_receber: 0, a_pagar: 0, custo_rebanho_ativo: 616667, insumos_estoque: 2100,
    despesa_antecipada: 0, saldo_abertura: 0, nao_operacional: 0, sem_permanencia: 0, direita: -378733, diferenca: 0, fecha: true,
  });
  const nov = termos('2027-11-30');
  assert.deepEqual([nov.caixa_acumulado, nov.a_receber, nov.a_pagar, nov.custo_rebanho_ativo, nov.insumos_estoque, nov.resultado_acumulado, nov.fecha], [-997500, 1184000, 17760, 0, 2100, 170840, true]);
  const dez = termos('2027-12-31');
  assert.deepEqual([dez.caixa_acumulado, dez.a_receber, dez.a_pagar, dez.custo_rebanho_ativo, dez.insumos_estoque, dez.resultado_acumulado, dez.fecha], [168740, 0, 0, 0, 2100, 170840, true]);
  const c = js(C.conferir(fx, '2027-12-31'));
  assert.equal(c.fecha, true, c.problemas.join('\n'));
  assert.deepEqual(c.meses.map((m) => m.mes), ['2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12']);
  assert.deepEqual(c.meses.map((m) => m.resultado.total), [0, -900, -4500, -373333, 0, 0, 0, 0, 549573, 0]);
  assert.deepEqual(c.meses.map((m) => m.caixa.liquido), [-10000, -453000, -454500, -80000, 0, 0, 0, 0, 0, 1166240]);
  assert.ok(c.meses.every((m) => m.termos.fecha), 'a identidade fecha no fim de cada mês');
});

test('07, 1.1: arrendamento anual de R$ 24.000,00 — março R$ 2.038,36 pelo maior resto (mês a mês somaria 24.000,02); em 31/03 resultado −5.917,81 = caixa −24.000,00 + despesa antecipada 18.082,19', () => {
  const m = js(C.porMes(2400000, '2027-01-01', '2027-12-31'));
  assert.equal(m.length, 12);
  assert.equal(m.reduce((s, x) => s + x.valor, 0), 2400000);
  assert.deepEqual(m.slice(0, 3).map((x) => [x.mes, x.dias, x.valor]), [['2027-01', 31, 203836], ['2027-02', 28, 184109], ['2027-03', 31, 203836]]);
  assert.equal(m[11].valor, 203835, 'o sexto centavo vai para os meses de 31 dias mais antigos; dezembro, o mais novo, fica sem');
  assert.equal(m.map((x) => Math.round(2400000 * x.dias / 365)).reduce((s, v) => s + v, 0), 2400002, 'o arredondamento mês a mês criaria 2 centavos');
  const fx = { marco_zero: '2027-01-01', permanencias: {}, lancamentos: [lanc('AR', 'CUSTEIO', 'DESPESA', 2400000, '2027-01-01', { inicio: '2027-01-01', fim: '2027-12-31', parcelas: [paga(2400000, '2027-01-05')] })] };
  const t = js(C.termosEm(fx, '2027-03-31'));
  assert.deepEqual([t.resultado_acumulado, t.caixa_acumulado, t.despesa_antecipada, t.fecha], [-591781, -2400000, 1808219, true]);
  // Antes do pagamento: o título está a pagar e a competência de janeiro já conta.
  const jan = js(C.termosEm(fx, '2027-01-04'));
  assert.deepEqual([jan.caixa_acumulado, jan.a_pagar, jan.fecha], [0, 2400000, true]);
  assert.equal(C.conferir(fx, '2027-12-31').fecha, true);
});

test('a parte até o dia D: soma dos meses no fim de cada mês, dias dentro do mês sem criar nem perder centavo, e sem período o valor inteiro a partir da competência', () => {
  const l = lanc('X', 'CUSTEIO', 'DESPESA', 100001, '2027-01-15', { inicio: '2027-01-15', fim: '2027-04-10' });
  const meses = js(C.porMes(l.valor, l.inicio, l.fim));
  let acum = 0;
  meses.forEach((m) => { acum += m.valor; assert.equal(C.competenciaAte(l, m.fim), acum, 'fim de ' + m.mes); });
  assert.equal(C.competenciaAte(l, '2027-01-14'), 0);
  assert.equal(C.competenciaAte(l, '2027-04-10'), 100001);
  assert.equal(C.competenciaAte(l, '2030-01-01'), 100001);
  let antes = 0;
  for (let d = '2027-01-15'; d <= '2027-04-10'; d = G.Utils.somaDias(d, 1)) {
    const v = C.competenciaAte(l, d);
    assert.ok(v >= antes && v - antes <= 1200, 'cresce dia a dia, sem salto: ' + d);
    antes = v;
  }
  const p = lanc('P', 'CUSTEIO', 'DESPESA', 777, '2027-02-03');
  assert.deepEqual([C.competenciaAte(p, '2027-02-02'), C.competenciaAte(p, '2027-02-03')], [0, 777]);
  assert.throws(() => C.porMes(10.5, '2027-01-01', '2027-01-31'), erroCom('INTERNAL'));
  assert.throws(() => C.porMes(100, '2027-02-01', '2027-01-31'), erroCom('INTERNAL'));
});

test('a identidade acusa o que não fecha: aquisição sem rateio inteiro, parcelas que não somam o lançamento, pagamento antes da competência e alocação a animal que não estava no rebanho', () => {
  const perm = { A: [{ entrada: { event_id: 'ev-c', data: '2027-02-01' }, saida: null }] };
  const base = (alocado) => ({ marco_zero: '2027-01-01', permanencias: perm, lancamentos: [lanc('C', 'AQUISICAO_ANIMAIS', 'DESPESA', 50000, '2027-02-01', { event_id: 'ev-c', ancora: 'ev-c', parcelas: [aberta(50000)], alocacoes: [{ animal_id: 'A', valor: alocado }] })] });
  assert.equal(C.termosEm(base(50000), '2027-02-28').fecha, true);
  const parcial = js(C.termosEm(base(40000), '2027-02-28'));
  assert.deepEqual([parcial.fecha, parcial.diferenca], [false, 10000], 'os 100,00 não rateados ficam fora do custo do rebanho e do resultado');
  const soma = base(50000);
  soma.lancamentos[0].parcelas = [aberta(30000)];
  assert.equal(js(C.termosEm(soma, '2027-02-28')).diferenca, -20000, 'parcelas que somam menos que o lançamento');
  const antes = { marco_zero: '2027-01-01', permanencias: {}, lancamentos: [lanc('S', 'CUSTEIO', 'DESPESA', 5000, '2027-03-10', { parcelas: [paga(5000, '2027-03-01')] })] };
  const t = js(C.termosEm(antes, '2027-03-05'));
  assert.deepEqual([t.fecha, t.diferenca], [false, 5000], 'pago em 01/03 um lançamento de competência 10/03: o caixa sai antes de o fato existir');
  assert.equal(C.termosEm(antes, '2027-03-10').fecha, true);
  const fora = base(50000);
  fora.permanencias = { A: [{ entrada: { event_id: 'ev-outra', data: '2027-05-01' }, saida: null }] };
  const tf = js(C.termosEm(fora, '2027-02-28'));
  assert.deepEqual([tf.fecha, tf.sem_permanencia], [false, 50000]);
  const c = js(C.conferir(fora, '2027-03-31'));
  assert.equal(c.fecha, false);
  assert.ok(c.problemas.some((p) => /não estava no rebanho/.test(p)), c.problemas.join('\n'));
  assert.throws(() => C.identidade({ resultado_acumulado: 1.5 }), erroCom('INTERNAL'));
  assert.throws(() => C.conferir(base(50000), '31/03/2027'), erroCom('VALIDATION'));
  assert.deepEqual(js(C.identidade({ resultado_acumulado: -378733, caixa_acumulado: -997500, a_receber: 0, a_pagar: 0, custo_rebanho_ativo: 616667, insumos_estoque: 2100, despesa_antecipada: 0, saldo_abertura: 0, nao_operacional: 0 })), { esquerda: -378733, direita: -378733, diferenca: 0, fecha: true });
});

test('saldo de abertura, não operacional, receita com período e juros e desconto na receita: cada termo entra com o sinal da fórmula', () => {
  const perm = { A: [{ entrada: { event_id: 'ev-ab', data: '2027-01-01' }, saida: { event_id: 'ev-m', data: '2027-04-10', linha: 'mortes' } }] };
  const fx = {
    marco_zero: '2027-01-01', permanencias: perm, lancamentos: [
      lanc('AB', 'AQUISICAO_ANIMAIS', 'DESPESA', 380000, '2027-01-01', { event_id: 'ev-ab', ancora: 'ev-ab', abertura: true, alocacoes: [{ animal_id: 'A', valor: 380000 }] }),
      lanc('AP', 'NAO_OPERACIONAL', 'RECEITA', 1000000, '2027-01-10', { parcelas: [paga(1000000, '2027-01-10')] }),
      lanc('RT', 'NAO_OPERACIONAL', 'DESPESA', 250000, '2027-02-10', { parcelas: [paga(250000, '2027-02-15', 1000)] }),
      lanc('OR', 'OUTRA_RECEITA', 'RECEITA', 120000, '2027-01-01', { inicio: '2027-01-01', fim: '2027-12-31', parcelas: [paga(120000, '2027-01-03', 500, 2000)] }),
    ],
  };
  const c = js(C.conferir(fx, '2027-12-31'));
  assert.equal(c.fecha, true, c.problemas.join('\n'));
  const abr = c.meses.find((m) => m.mes === '2027-04');
  assert.equal(abr.resultado.custo_aquisicao.mortes, 380000, 'a morte leva o custo de abertura para o resultado (linha das mortes)');
  const t = js(C.termosEm(fx, '2027-01-31'));
  assert.deepEqual([t.saldo_abertura, t.nao_operacional, t.custo_rebanho_ativo, t.fecha], [380000, 1000000, 380000, true]);
  assert.ok(t.despesa_antecipada < 0, 'receita antecipada: a parte da competência depois de D reduz o termo');
  const r = js(C.resultado(fx, '2027-01-01', '2027-01-31'));
  assert.deepEqual([r.juros, r.descontos], [-500, -2000], 'na receita, juros recebidos aumentam o resultado e desconto concedido reduz');
  const fev = js(C.resultado(fx, '2027-02-01', '2027-02-28'));
  assert.equal(fev.juros, 1000, 'juros pagos na retirada (não operacional) entram no resultado do mês do pagamento');
});

test('regra de tempo: o fato depois de D não muda os termos de D; o retroativo muda só o que alcança; sem fato financeiro, nada a conferir', () => {
  const fx = caso22();
  const datas = ['2027-03-09', '2027-03-10', '2027-04-30', '2027-06-16', '2027-06-30', '2027-11-19', '2027-11-20', '2027-12-31'];
  const antes = datas.map((d) => js(C.termosEm(fx, d)));
  const depois = caso22();
  depois.lancamentos.push(lanc('TARDE', 'CUSTEIO', 'DESPESA', 12345, '2028-01-15', { parcelas: [paga(12345, '2028-01-20')] }));
  depois.lancamentos[2].parcelas[0] = paga(3000, '2027-04-02');
  assert.deepEqual(datas.map((d) => js(C.termosEm(depois, d))), antes, 'um lançamento de 2028 não muda nenhuma data de 2027');
  const retro = caso22();
  retro.lancamentos.push(lanc('RETRO', 'CUSTEIO', 'DESPESA', 5000, '2027-05-02', { parcelas: [aberta(5000)] }));
  datas.forEach((d, i) => {
    const t = js(C.termosEm(retro, d));
    if (d < '2027-05-02') assert.deepEqual(t, antes[i], 'antes do retroativo: ' + d);
    else { assert.equal(t.resultado_acumulado, antes[i].resultado_acumulado - 5000, d); assert.equal(t.a_pagar, antes[i].a_pagar + 5000, d); assert.equal(t.fecha, true, d); }
  });
  const vazio = js(C.conferir({ marco_zero: '2027-01-01', lancamentos: [], permanencias: {} }, '2027-12-31'));
  assert.deepEqual([vazio.meses.length, vazio.fecha, vazio.periodo.termos.fecha, vazio.inicio], [0, true, true, null]);
});

/**
 * Sorteio de bases coerentes (as invariantes de 03b, seção 14: parcelas somam o lançamento, aquisição 100% alocada a animais
 * no rebanho na competência, consumo sem parcela, pagamento na competência ou depois): a identidade fecha em todo fim de mês e
 * no período, o caixa e o resultado dos meses somam os do período, e o fato acrescentado depois de D não muda D.
 */
test('400 bases sorteadas e coerentes: a identidade fecha ao centavo em todo fim de mês e no período inteiro', () => {
  const NAT = [['RECEITA_VENDA_ANIMAIS', 'RECEITA'], ['OUTRA_RECEITA', 'RECEITA'], ['DESPESA_VENDA', 'DESPESA'], ['CUSTEIO', 'DESPESA'], ['ESTOQUE_INSUMOS', 'DESPESA'], ['NAO_OPERACIONAL', 'RECEITA'], ['NAO_OPERACIONAL', 'DESPESA'], ['AQUISICAO_ANIMAIS', 'DESPESA']];
  const dia = (rnd, de, n) => G.Utils.somaDias(de, Math.floor(rnd() * n));
  for (let s = 1; s <= 400; s++) {
    const rnd = aleatorio(9000 + s);
    const fx = { marco_zero: '2027-01-01', lancamentos: [], permanencias: {} };
    const animais = ['A', 'B', 'C', 'D'];
    animais.forEach((a) => {
      const lista = [];
      let d = dia(rnd, '2027-01-01', 60);
      for (let k = 0; k < 3 && d < '2027-12-31'; k++) {
        const ent = { event_id: 'ev-' + a + k, data: d };
        const sai = rnd() < 0.6 ? dia(rnd, d, 120) : null;
        lista.push({ entrada: ent, saida: sai ? { event_id: 'ev-s' + a + k, data: sai, linha: ['vendidos_descartados', 'mortes', 'baixas_ajuste'][Math.floor(rnd() * 3)] } : null });
        if (!sai) break;
        d = dia(rnd, sai, 40);
      }
      fx.permanencias[a] = lista;
    });
    const n = 3 + Math.floor(rnd() * 12);
    for (let i = 0; i < n; i++) {
      const [nat, tipo] = NAT[Math.floor(rnd() * NAT.length)];
      const valor = 1 + Math.floor(rnd() * 900000);
      let data = dia(rnd, '2027-01-01', 360);
      const extra = {};
      if (nat === 'AQUISICAO_ANIMAIS') {
        const a = animais[Math.floor(rnd() * animais.length)];
        const p = fx.permanencias[a][Math.floor(rnd() * fx.permanencias[a].length)];
        data = p.entrada.data;
        extra.ancora = p.entrada.event_id;
        extra.alocacoes = [{ animal_id: a, valor }];
        extra.abertura = rnd() < 0.2;
      }
      if ((nat === 'CUSTEIO' || nat === 'OUTRA_RECEITA') && rnd() < 0.4) { extra.inicio = data; extra.fim = dia(rnd, data, 400); }
      const consumo = nat === 'CUSTEIO' && !extra.inicio && rnd() < 0.3;
      extra.consumo = consumo;
      if (!consumo && !extra.abertura) {
        const k = 1 + Math.floor(rnd() * 3);
        const partes = G.FinancialService.dividirParcelas(valor, valor >= k ? k : 1);
        extra.parcelas = partes.filter((v) => v > 0).map((v) => (rnd() < 0.5 ? aberta(v) : paga(v, dia(rnd, data, 200), rnd() < 0.3 ? Math.floor(rnd() * 900) : 0, rnd() < 0.2 ? Math.min(v - 1, Math.floor(rnd() * 900)) : 0)));
      }
      fx.lancamentos.push(lanc('L' + i, nat, tipo, valor, data, extra));
    }
    const c = js(C.conferir(fx, '2028-03-31'));
    assert.equal(c.fecha, true, 'semente ' + s + ': ' + c.problemas.join(' | '));
    const D = dia(rnd, '2027-01-01', 400);
    const t0 = js(C.termosEm(fx, D));
    fx.lancamentos.push(lanc('DEPOIS', 'CUSTEIO', 'DESPESA', 4321, G.Utils.somaDias(D, 1), { parcelas: [paga(4321, G.Utils.somaDias(D, 3))] }));
    assert.deepEqual(js(C.termosEm(fx, D)), t0, 'semente ' + s + ': o fato do dia seguinte mudou ' + D);
  }
});
