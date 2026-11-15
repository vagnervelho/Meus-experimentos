'use strict';
/**
 * Oráculos independentes para os ataques (fase2.adversarial e unitofwork.adversarial), escritos sem usar Timeline nem
 * FinancialService: as linhas cruas da planilha, a vigência (P3) reescrita sobre OPERACOES e EVENTOS, o replay da
 * linha do tempo (ordem canônica do desenho-base 4.3 e 16.1) com o inventário em cada data e a situação de cada animal,
 * as invariantes de 03b, seção 14, sobre as linhas cruas, e o rateio pelo maior resto (05, seção 4.5). Não é arquivo
 * de teste.
 */
const assert = require('node:assert/strict');

const SITUACAO_SAIDA = { VENDA: 'VENDIDO', MORTE: 'MORTO', DESCARTE: 'DESCARTADO', AJUSTE_INVENTARIO: 'BAIXADO_AJUSTE' };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const soma = (lista, f) => lista.reduce((s, x) => s + (typeof f === 'function' ? f(x) : x[f] || 0), 0);
function agrupar(lista, campo) {
  const g = new Map();
  lista.forEach((x) => { const k = x[campo]; if (!g.has(k)) g.set(k, []); g.get(k).push(x); });
  return g;
}

// ------------------------------------------------------------------ oráculo 1: o que está gravado, lido cru ----
const ABAS_CRU = ['OPERACOES', 'EVENTOS', 'EVENTO_ANIMAIS', 'ANIMAIS', 'IDENTIFICACOES', 'FINANCEIRO', 'PARCELAS', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'COMPRAS', 'VENDAS', 'PLANO_CONTAS', 'REPRODUCAO', 'BAIXAS', 'PESAGENS'];
/** Linhas cruas (estado durável) das abas de evento e do financeiro; aceita o motor (apoio-eventos) ou o ambiente. */
function cru(m) {
  const l = (m.amb || m).lido(ABAS_CRU);
  const o = {};
  ABAS_CRU.forEach((a) => { o[a] = l[a].registros; });
  return o;
}
/** Vigência (P3) escrita de novo: operação CONFIRMADA, não é ESTORNO e ninguém confirmado a anula. */
function vigencia(r) {
  const op = new Map(r.OPERACOES.map((o) => [o.op_id, o]));
  const confirmado = (e) => !!op.get(e.op_id) && op.get(e.op_id).status === 'CONFIRMADA';
  const anuladoPor = new Map();
  r.EVENTOS.forEach((e) => { if (e.reversal_of_event_id && confirmado(e)) anuladoPor.set(e.reversal_of_event_id, e.event_id); });
  const vig = new Map();
  r.EVENTOS.forEach((e) => {
    assert.equal(e.import_id || null, null, 'nenhum evento importado neste ataque');
    vig.set(e.event_id, confirmado(e) && e.event_type !== 'ESTORNO' && !anuladoPor.has(e.event_id));
  });
  return { vig, anuladoPor, porId: new Map(r.EVENTOS.map((e) => [e.event_id, e])) };
}
function classe(l) {
  return l.efeito === 1 ? 0 : l.efeito === -1 ? 2 : 1;
}
/** Ordem canônica (desenho-base 4.3 e 16.1): data, classe, posição do primeiro da cadeia de substituição, sequência. */
function ordenar(ls) {
  return ls.slice().sort((a, b) => cmp(a.data, b.data) || classe(a) - classe(b) || a.raiz - b.raiz || a.seq - b.seq);
}
/** Linhas vigentes de EVENTO_ANIMAIS com o cabeçalho do evento, na forma do replay. */
function replayCru(r) {
  const V = vigencia(r);
  const raiz = (e) => {
    let a = e;
    for (let g = 0; g < 1000 && a.reversal_of_event_id && a.event_type !== 'ESTORNO'; g++) {
      const b = V.porId.get(a.reversal_of_event_id);
      if (!b || b.event_type !== a.event_type) break;
      a = b;
    }
    return a.event_seq;
  };
  const linhas = r.EVENTO_ANIMAIS.filter((l) => V.vig.get(l.event_id)).map((l) => {
    const e = V.porId.get(l.event_id);
    return { animal: l.animal_id, ev: e.event_id, tipo: e.event_type, data: e.event_date, seq: e.event_seq, raiz: raiz(e), efeito: l.efeito_inventario, origem: l.pasto_origem_id || null, destino: l.pasto_destino_id || null, pre: e.pre_marco_zero === true };
  });
  return { V, linhas, porAnimal: agrupar(linhas, 'animal') };
}
/** Inventário ao fim do dia D, por replay (sem Timeline): total = Σ efeitos; pasto = destino do último movimento. */
function inventarioDe(linhas, D) {
  let total = 0;
  const g = new Map();
  linhas.forEach((l) => {
    if (l.pre || l.data > D) return;
    total += l.efeito;
    if (!g.has(l.animal)) g.set(l.animal, []);
    g.get(l.animal).push(l);
  });
  const porPasto = {};
  let semPasto = 0;
  g.forEach((ls) => {
    let s = 0;
    let p = null;
    ordenar(ls).forEach((l) => { s += l.efeito; if (l.destino) p = l.destino; if (l.efeito === -1) p = null; });
    if (s >= 1) { if (p) porPasto[p] = (porPasto[p] || 0) + 1; else semPasto++; }
  });
  return { total, porPasto, semPasto };
}
/** Situação, pasto e saída ao fim de tudo, pelas linhas vigentes de um animal. */
function situacaoDe(ls) {
  const v = (ls || []).filter((l) => !l.pre);
  if (!v.length) return { situacao: 'ANULADO', pasto: null, saida: null, entrada: null };
  let s = 0;
  let p = null;
  let ult = null;
  let entrada = null;
  ordenar(v).forEach((l) => { s += l.efeito; if (l.destino) p = l.destino; if (l.efeito === -1) { p = null; ult = l; } if (l.efeito === 1) entrada = l; });
  if (s >= 1) return { situacao: 'ATIVO', pasto: p, saida: null, entrada };
  return { situacao: ult ? SITUACAO_SAIDA[ult.tipo] : 'ANULADO', pasto: null, saida: ult ? ult.data : null, entrada };
}

/** Invariantes de 03b, seção 14, sobre as linhas cruas (sem FinancialService): [texto] — vazio = fecha ao centavo. */
function invariantesCruas(r) {
  const out = [];
  const R = replayCru(r);
  const V = R.V;
  const conta = new Map(r.PLANO_CONTAS.map((c) => [c.conta_id, c]));
  const parcelas = agrupar(r.PARCELAS, 'financial_id');
  const rateios = agrupar(r.RATEIOS, 'financial_id');
  const alocs = agrupar(r.ALOCACOES_FINANCEIRAS, 'rateio_id');
  const finsDoEvento = agrupar(r.FINANCEIRO, 'event_id');
  const linhasDoEvento = agrupar(r.EVENTO_ANIMAIS, 'event_id');
  const r4 = (x) => Math.round(x * 10000);
  const rateioVigente = new Map();
  r.FINANCEIRO.forEach((f) => {
    const id = f.financial_id;
    const ev = V.porId.get(f.event_id);
    const vale = V.vig.get(f.event_id) === true;
    const c = conta.get(f.conta_id);
    if (!(f.valor > 0)) out.push('1: valor não positivo em ' + id);
    if (!c || c.natureza !== f.natureza || c.tipo !== f.tipo || c.grupo !== f.categoria) out.push('2: natureza/tipo/grupo ≠ conta em ' + id);
    if (!vale) {
      // 20: lançamento de evento anulado fica CANCELADO, apontando quem o anulou, sem animal direto.
      if (f.status !== 'CANCELADO' || f.status_pagamento !== 'CANCELADO' || f.cancelado_por_event_id !== (V.anuladoPor.get(f.event_id) || null) || f.animal_id) out.push('20: lançamento de evento anulado não está CANCELADO por quem o anulou: ' + id);
      return;
    }
    const ps = (parcelas.get(id) || []).filter((p) => p.status !== 'CANCELADA');
    if (ps.length && soma(ps, 'valor') !== f.valor) out.push('3: Σ parcelas ' + soma(ps, 'valor') + ' ≠ valor ' + f.valor + ' em ' + id);
    if (!ps.length !== (f.status_pagamento === 'SEM_CAIXA')) out.push('4: parcela × SEM_CAIXA em ' + id);
    ps.forEach((p) => { if (p.status === 'ABERTA' && (p.data_pagamento || p.valor_pago !== null || p.juros_multa !== null || p.desconto !== null)) out.push('5: parcela ABERTA com pagamento ' + p.parcela_id); });
    if (ps.length && ps.every((p) => p.status === 'ABERTA') && f.status_pagamento !== 'ABERTO') out.push('6: status_pagamento ' + f.status_pagamento + ' com parcelas abertas em ' + id);
    if (f.status !== 'ATIVO' || f.cancelado_por_event_id) out.push('20: lançamento vigente não está ATIVO: ' + id);
    // 7: o rateio vigente é o do evento vigente de maior event_seq.
    const rs = (rateios.get(id) || []).filter((x) => V.vig.get(x.event_id)).sort((a, b) => V.porId.get(b.event_id).event_seq - V.porId.get(a.event_id).event_seq);
    const rv = rs[0] || null;
    rateioVigente.set(id, rv);
    const negocio = ev.event_type === 'COMPRA' || ev.event_type === 'VENDA';
    if (!rv) {
      if (f.animal_id) out.push('12: animal direto sem rateio em ' + id);
      if (negocio) out.push('10: lançamento de ' + ev.event_type + ' sem rateio: ' + id);
      return;
    }
    const al = alocs.get(rv.rateio_id) || [];
    if (soma(al, 'valor_alocado') !== rv.total_alocado) out.push('8: Σ alocado ' + soma(al, 'valor_alocado') + ' ≠ total_alocado ' + rv.total_alocado + ' em ' + id);
    if (r4(soma(al, 'base_valor')) !== r4(rv.base_total)) out.push('8: Σ bases ≠ base_total em ' + id);
    if (rv.total_alocado > f.valor) out.push('9: alocado acima do valor em ' + id);
    if (negocio && rv.total_alocado !== f.valor) out.push('10: ' + ev.event_type + ' não 100% alocada em ' + id);
    if (new Set(al.map((a) => a.animal_id)).size !== al.length || al.some((a) => a.financial_id !== id)) out.push('11: alocação repetida ou de outro lançamento em ' + id);
    const direto = rv.criterio === 'DIRETO' && al.length === 1 && al[0].valor_alocado === f.valor;
    if (!!f.animal_id !== direto || (f.animal_id && f.animal_id !== al[0].animal_id)) out.push('12: FINANCEIRO.animal_id × alocação direta em ' + id);
    if (al.length === 1 && rv.criterio !== 'DIRETO') out.push('13: um animal sem DIRETO em ' + id);
    if (['ESTOQUE_INSUMOS', 'NAO_OPERACIONAL'].includes(f.natureza)) out.push('14: rateio de ' + f.natureza + ' em ' + id);
    al.forEach((a) => { if (!(a.valor_alocado >= 0) || !Number.isInteger(a.valor_alocado)) out.push('8: alocação não inteira em ' + a.alloc_id); });
  });
  const alocDe = (fin) => { const rv = rateioVigente.get(fin.financial_id); return rv ? soma(alocs.get(rv.rateio_id) || [], 'valor_alocado') : 0; };
  r.COMPRAS.filter((x) => V.vig.get(x.event_id)).forEach((x) => {
    const ev = V.porId.get(x.event_id);
    const fs = finsDoEvento.get(x.event_id) || [];
    const ea = linhasDoEvento.get(x.event_id) || [];
    if (soma(fs, 'valor') !== x.valor_total || x.valor_animais + x.frete + x.outros_custos !== x.valor_total || ev.total_value !== x.valor_total) out.push('16: COMPRAS.valor_total × lançamentos em ' + x.event_id);
    if (soma(ea, 'valor_individual') !== x.valor_animais || !fs.length || fs[0].valor !== x.valor_animais || alocDe(fs[0]) !== x.valor_animais) out.push('15: valor_individual × valor_animais × alocado em ' + x.event_id);
    if (x.qtd_animais !== ea.filter((l) => l.efeito_inventario === 1).length) out.push('qtd_animais da compra em ' + x.event_id);
  });
  r.VENDAS.filter((x) => V.vig.get(x.event_id)).forEach((x) => {
    const ev = V.porId.get(x.event_id);
    const fs = finsDoEvento.get(x.event_id) || [];
    const ea = linhasDoEvento.get(x.event_id) || [];
    const receita = x.valor_bruto - x.desconto_comercial;
    const desp = fs.filter((f) => f.natureza === 'DESPESA_VENDA');
    if (soma(ea, 'valor_individual') !== receita || !fs.length || fs[0].natureza !== 'RECEITA_VENDA_ANIMAIS' || fs[0].valor !== receita || alocDe(fs[0]) !== receita) out.push('15: receita × valor_individual × alocado em ' + x.event_id);
    if (soma(desp, 'valor') !== x.frete + x.comissao + x.outras_deducoes || fs.length !== desp.length + 1) out.push('16: deduções × DESPESA_VENDA em ' + x.event_id);
    if (ev.total_value !== x.valor_bruto || x.qtd_animais !== ea.filter((l) => l.efeito_inventario === -1).length) out.push('total_value/qtd da venda em ' + x.event_id);
  });
  // 18: custo de aquisição = Σ alocações vigentes AQUISICAO_ANIMAIS do período de permanência mais recente.
  const aquis = new Map();
  r.FINANCEIRO.forEach((f) => {
    if (!V.vig.get(f.event_id) || f.natureza !== 'AQUISICAO_ANIMAIS') return;
    const rv = rateioVigente.get(f.financial_id);
    (rv ? alocs.get(rv.rateio_id) || [] : []).forEach((a) => {
      if (!aquis.has(a.animal_id)) aquis.set(a.animal_id, []);
      aquis.get(a.animal_id).push({ valor: a.valor_alocado, data: f.data_competencia });
    });
  });
  r.ANIMAIS.forEach((a) => {
    const st = situacaoDe(R.porAnimal.get(a.animal_id));
    if (st.situacao === 'ANULADO' || !st.entrada) return;
    const doPeriodo = (aquis.get(a.animal_id) || []).filter((x) => x.data >= st.entrada.data);
    const esperado = doPeriodo.length ? soma(doPeriodo, 'valor') : st.entrada.tipo === 'NASCIMENTO' ? 0 : null;
    if ((a.custo_aquisicao === undefined ? null : a.custo_aquisicao) !== esperado) out.push('18: custo_aquisicao de ' + a.codigo_interno + ' = ' + a.custo_aquisicao + ', esperado ' + esperado);
  });
  return out;
}

/** Maior resto em inteiros (05, seção 4.5): bases inteiras; empate → maior base → menor código. Map(animal → centavos). */
function maiorResto(V, itens) {
  const B = soma(itens, 'base');
  if (!B) return new Map(itens.map((x) => [x.animal, 0]));
  const q = itens.map((x) => ({ x, q: Math.floor(V * x.base / B), r: (V * x.base) % B }));
  let sobra = V - soma(q, 'q');
  q.slice().sort((a, b) => b.r - a.r || b.x.base - a.x.base || cmp(a.x.codigo, b.x.codigo)).forEach((y) => { if (sobra > 0) { y.q++; sobra--; } });
  return new Map(q.map((y) => [y.x.animal, y.q]));
}
module.exports = { ABAS_CRU, SITUACAO_SAIDA, cmp, soma, agrupar, cru, vigencia, classe, ordenar, replayCru, inventarioDe, situacaoDe, invariantesCruas, maiorResto };
