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

// ------------------------------------------------------------------ Fase 4, E4.5: o demonstrativo e a ponte (CONTRATOS, seção 58) ----
/** O caso 2.2 com a conta e o grupo de cada lançamento (o que `fatos` lê do plano de contas e da cópia gravada). */
function caso22ComContas() {
  const fx = caso22();
  const conta = { F1: ['COMPRA_ANIMAIS', 'CUSTO_DIRETO'], F2: ['FRETE_DESPESAS_COMPRA', 'CUSTO_DIRETO'], F3: ['COMPRA_INSUMOS', 'CUSTO_DIRETO'], F4: ['VACINAS', 'CUSTO_DIRETO'], F5: ['ARRENDAMENTO_PASTO', 'CUSTO_OPERACIONAL'], F6: ['CONTABILIDADE', 'DESPESA_ADMINISTRATIVA'], F7: ['VENDA_ANIMAIS', 'RECEITA'], F8: ['TAXAS_RETENCOES_VENDA', 'CUSTO_DIRETO'] };
  const ordem = { COMPRA_ANIMAIS: 210, FRETE_DESPESAS_COMPRA: 220, COMPRA_INSUMOS: 330, VACINAS: 250, ARRENDAMENTO_PASTO: 415, CONTABILIDADE: 510, VENDA_ANIMAIS: 110, TAXAS_RETENCOES_VENDA: 320 };
  fx.contas = {};
  fx.lancamentos.forEach((l) => {
    const [cod, grupo] = conta[l.financial_id];
    l.conta_id = 'c-' + cod;
    l.grupo = grupo;
    l.descricao = 'Lançamento ' + l.financial_id;
    fx.contas[l.conta_id] = { conta_id: l.conta_id, codigo: cod, nome: cod.toLowerCase(), ordem: ordem[cod] };
  });
  // F6 (contabilidade) sem rateio: o custeio que não chega a nenhum animal.
  fx.lancamentos.find((l) => l.financial_id === 'F6').alocacoes = [];
  return fx;
}

test('E4.5, a ponte (07, 2.1, linha a linha): a identidade aplicada às variações — o resultado do mês = caixa + Δ a receber − Δ a pagar + Δ rebanho + Δ insumos + Δ despesa antecipada − Δ abertura − Δ não operacional; termo que não é inteiro → INTERNAL', () => {
  const fx = caso22();
  const p = js(C.ponte(C.termosEm(fx, '2027-05-31'), C.termosEm(fx, '2027-06-30')));
  assert.deepEqual(p, { resultado: -373333, caixa: -80000, a_receber: 0, a_pagar: 0, custo_rebanho_ativo: -293333, insumos_estoque: 0, despesa_antecipada: 0, saldo_abertura: 0, nao_operacional: 0, direita: -373333, diferenca: 0, fecha: true },
    'junho: o caixa do arrendamento e da contabilidade (−800,00) e a saída de A3 do rebanho ativo (−2.933,33)');
  const nov = js(C.ponte(C.termosEm(fx, '2027-10-31'), C.termosEm(fx, '2027-11-30')));
  assert.deepEqual([nov.resultado, nov.caixa, nov.a_receber, nov.a_pagar, nov.custo_rebanho_ativo, nov.fecha], [549573, 0, 1184000, 17760, -616667, true], 'novembro: nada no caixa; a receber a venda, a pagar a taxa retida, e A1 e A2 saem do rebanho');
  const abr = js(C.ponte(C.termosEm(fx, '2027-03-31'), C.termosEm(fx, '2027-04-30')));
  assert.deepEqual([abr.resultado, abr.caixa, abr.a_pagar, abr.insumos_estoque, abr.fecha], [-900, -453000, -450000, 2100, true], 'abril: a 1ª parcela sai do a pagar; o frasco entra no estoque e 3 doses saem');
  assert.throws(() => C.ponte({ resultado_acumulado: 0.5 }, { resultado_acumulado: 1 }), erroCom('INTERNAL'));
  const torto = js(C.ponte({ resultado_acumulado: 0, caixa_acumulado: 0, a_receber: 0, a_pagar: 0, custo_rebanho_ativo: 0, insumos_estoque: 0, despesa_antecipada: 0, saldo_abertura: 0, nao_operacional: 0 }, { resultado_acumulado: -100, caixa_acumulado: -50, a_receber: 0, a_pagar: 0, custo_rebanho_ativo: 0, insumos_estoque: 0, despesa_antecipada: 0, saldo_abertura: 0, nao_operacional: 0 }));
  assert.deepEqual([torto.fecha, torto.diferenca], [false, -50], 'o que não fecha é acusado com a diferença');
});

test('E4.5, o demonstrativo do 07, 2.2: receitas e despesas por natureza e por conta, o custo de aquisição de quem saiu em três linhas, o custeio por grupo e por conta, juros; o caixa ao lado, o custeio não alocado, os estoques no custo e a ponte de cada mês', () => {
  const fx = caso22ComContas();
  const d = js(C.demonstrativo(fx, '2027-01-01', '2027-12-31', { detalhe: true }));
  assert.equal(d.fecha, true, d.problemas.join('\n'));
  assert.deepEqual(d.colunas.map((c) => c.rotulo), ['jan/2027', 'fev/2027', 'mar/2027', 'abr/2027', 'mai/2027', 'jun/2027', 'jul/2027', 'ago/2027', 'set/2027', 'out/2027', 'nov/2027', 'dez/2027']);
  assert.deepEqual(d.resultado.valores, [0, 0, 0, -900, -4500, -373333, 0, 0, 0, 0, 549573, 0], 'CT-19: março 0,00, junho −3.733,33, novembro +5.495,73');
  assert.equal(d.resultado.total, 170840);
  const sec = Object.fromEntries(d.secoes.map((s) => [s.chave, s]));
  assert.deepEqual([sec.RV.total, sec.OR.total, sec.DV.total, sec.CA.total, sec.CT.total, sec.J.total, sec.DB.total], [1184000, 0, 17760, 910000, 80900, 4500, 0]);
  assert.deepEqual(sec.CA.linhas.map((l) => [l.chave, l.total]), [['vendidos_descartados', 616667], ['mortes', 293333], ['baixas_ajuste', 0]]);
  assert.deepEqual(sec.CA.linhas[1].animais.map((a) => [a.animal_id, a.data_saida, a.valor]).sort(), [['A3', '2027-06-16', 290000], ['A3', '2027-06-16', 3333]]);
  assert.deepEqual(sec.CT.grupos.map((g) => [g.grupo, g.total, g.contas.map((c) => [c.codigo, c.total])]), [['CUSTO_DIRETO', 900, [['VACINAS', 900]]], ['CUSTO_OPERACIONAL', 60000, [['ARRENDAMENTO_PASTO', 60000]]], ['DESPESA_ADMINISTRATIVA', 20000, [['CONTABILIDADE', 20000]]]]);
  assert.deepEqual(sec.DV.contas.map((c) => [c.codigo, c.total, c.lancamentos.map((l) => l.financial_id)]), [['TAXAS_RETENCOES_VENDA', 17760, ['F8']]]);
  assert.deepEqual(d.caixa.colunas.map((c) => c.liquido), [0, 0, -10000, -453000, -454500, -80000, 0, 0, 0, 0, 0, 1166240]);
  assert.equal(d.caixa.periodo.liquido, 168740);
  assert.deepEqual([d.custeio_nao_alocado.total, d.custeio_nao_alocado.valores[5]], [20000, 20000], 'a contabilidade de junho, sem rateio');
  assert.equal(C.custeioNaoAlocado(fx, '2027-01-01', '2027-12-31'), 20000);
  assert.deepEqual(d.fora_do_resultado.map((x) => [x.chave, x.total]), [['AQUISICAO', 910000], ['INSUMOS', 3000], ['NAO_OPERACIONAL', 0]], 'a compra de animais e de insumos fica fora do resultado (RN-083)');
  assert.deepEqual(d.estoques.periodo, { rebanho: { inicio: 0, entradas: 910000, saidas: 910000, fim: 0 }, insumos: { inicio: 0, entradas: 3000, saidas: 900, fim: 2100 } }, 'os estoques no custo: o rebanho entra pela compra e sai pela venda e pela morte; sobram 7 doses');
  assert.deepEqual(d.estoques.colunas[5].rebanho, { inicio: 910000, entradas: 0, saidas: 293333, fim: 616667 });
  assert.ok(d.ponte.colunas.every((p, k) => p.fecha && p.resultado === d.resultado.valores[k]), 'a ponte fecha em todo mês');
  assert.deepEqual([d.ponte.periodo.resultado, d.ponte.periodo.caixa, d.ponte.periodo.insumos_estoque, d.ponte.periodo.fecha], [170840, 168740, 2100, true]);
  assert.deepEqual([d.identidade.resultado_acumulado, d.identidade.fecha], [170840, true]);
  // Um mês só e um período que começa no meio do mês: as colunas cortadas nas pontas, a soma igual à do período.
  const jun = js(C.demonstrativo(fx, '2027-06-10', '2027-06-30'));
  assert.deepEqual([jun.colunas.length, jun.colunas[0].inicio, jun.resultado.total], [1, '2027-06-10', js(C.resultado(fx, '2027-06-10', '2027-06-30')).total]);
  assert.throws(() => C.demonstrativo(fx, '2027-13-01', '2027-12-31'), erroCom('VALIDATION'));
});

test('E4.5, 400 bases sorteadas: o demonstrativo fecha com a visão 2 (a soma das colunas é o resultado do período), a ponte fecha em toda coluna e no período, e o custeio não alocado é o mesmo pelos dois caminhos', () => {
  const NAT = [['RECEITA_VENDA_ANIMAIS', 'RECEITA'], ['OUTRA_RECEITA', 'RECEITA'], ['DESPESA_VENDA', 'DESPESA'], ['CUSTEIO', 'DESPESA'], ['ESTOQUE_INSUMOS', 'DESPESA'], ['NAO_OPERACIONAL', 'RECEITA'], ['NAO_OPERACIONAL', 'DESPESA'], ['AQUISICAO_ANIMAIS', 'DESPESA']];
  const GR = ['CUSTO_DIRETO', 'CUSTO_OPERACIONAL', 'DESPESA_ADMINISTRATIVA'];
  const dia = (rnd, de, n) => G.Utils.somaDias(de, Math.floor(rnd() * n));
  for (let s = 1; s <= 400; s++) {
    const rnd = aleatorio(77000 + s);
    const fx = { marco_zero: '2027-01-01', lancamentos: [], permanencias: {}, contas: {} };
    ['A', 'B', 'C'].forEach((a) => {
      const ent = dia(rnd, '2027-01-01', 90);
      const sai = rnd() < 0.6 ? dia(rnd, ent, 200) : null;
      fx.permanencias[a] = [{ entrada: { event_id: 'ev-' + a, data: ent }, saida: sai ? { event_id: 'ev-s' + a, data: sai, linha: ['vendidos_descartados', 'mortes', 'baixas_ajuste'][Math.floor(rnd() * 3)] } : null }];
    });
    for (let i = 0; i < 4 + Math.floor(rnd() * 10); i++) {
      const [nat, tipo] = NAT[Math.floor(rnd() * NAT.length)];
      const valor = 1 + Math.floor(rnd() * 500000);
      let data = dia(rnd, '2027-01-01', 360);
      const extra = { conta_id: 'c' + (i % 4), grupo: GR[Math.floor(rnd() * 3)] };
      if (nat === 'AQUISICAO_ANIMAIS') {
        const a = ['A', 'B', 'C'][Math.floor(rnd() * 3)];
        data = fx.permanencias[a][0].entrada.data;
        extra.ancora = 'ev-' + a;
        extra.alocacoes = [{ animal_id: a, valor }];
      }
      if (nat === 'CUSTEIO') extra.alocacoes = rnd() < 0.5 ? [{ animal_id: 'A', valor: Math.floor(valor * rnd()) }] : [];
      if ((nat === 'CUSTEIO' || nat === 'OUTRA_RECEITA') && rnd() < 0.4) { extra.inicio = data; extra.fim = dia(rnd, data, 400); }
      extra.parcelas = [rnd() < 0.5 ? aberta(valor) : paga(valor, dia(rnd, data, 100), rnd() < 0.3 ? Math.floor(rnd() * 900) : 0, 0)];
      fx.lancamentos.push(lanc('L' + i, nat, tipo, valor, data, extra));
    }
    const de = dia(rnd, '2027-01-01', 200);
    const ate = dia(rnd, de, 300);
    const d = js(C.demonstrativo(fx, de, ate));
    assert.equal(d.fecha, true, 'semente ' + s + ': ' + d.problemas.join(' | '));
    assert.equal(d.resultado.total, js(C.resultado(fx, de, ate)).total, 'semente ' + s + ': o demonstrativo e a visão 2');
    assert.equal(d.resultado.valores.reduce((a, b) => a + b, 0), d.resultado.total);
    assert.equal(d.custeio_nao_alocado.total, C.custeioNaoAlocado(fx, de, ate), 'semente ' + s);
    assert.equal(d.caixa.periodo.liquido, C.caixa(fx, de, ate).liquido);
    const somaContas = d.secoes.filter((x) => x.contas).reduce((t, x) => t + x.contas.reduce((u, c) => u + c.total, 0), 0) + d.secoes.find((x) => x.chave === 'CT').grupos.reduce((t, g) => t + g.total, 0);
    const somaSecoes = d.secoes.filter((x) => ['RV', 'OR', 'DV', 'CT'].indexOf(x.chave) >= 0).reduce((t, x) => t + x.total, 0);
    assert.equal(somaContas, somaSecoes, 'semente ' + s + ': as contas somam a seção');
  }
});
