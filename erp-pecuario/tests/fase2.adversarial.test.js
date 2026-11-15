'use strict';
/**
 * Ataque ao motor de eventos e ao financeiro da Fase 2 (NASCIMENTO, TRANSFERENCIA, MORTE, DESCARTE, COMPRA, VENDA,
 * IDENTIFICACAO, MARCACAO, AJUSTES, estorno e substituição, FinancialService).
 *
 * Três oráculos escritos aqui, sem usar Timeline nem FinancialService:
 * - um MODELO de referência do rebanho (linha do tempo por animal pela regra de 05, seção 4.3; sequências de
 *   identificação e de marcação; rateio pelo maior resto de 05, seção 4.5) que prevê, para cada comando, se ele é
 *   aceito, recusado por VALIDATION ou por CONFLICT — e, no CONFLICT, QUAIS eventos impedem;
 * - um REPLAY independente das linhas cruas da planilha (vigência pela regra P3 sobre OPERACOES e EVENTOS) que dá o
 *   inventário em cada data, por pasto, e a situação de cada animal;
 * - as invariantes de 03b, seção 14, conferidas de novo sobre as linhas cruas.
 * Depois de CADA comando (aceito ou recusado): projeção = reconstrução (o apoio roda Timeline.conferir e
 * FinancialService.conferir), modelo = replay = sistema no inventário de várias datas, a ficha de cada animal
 * (situação, pasto, saída, brinco, marcações, custo de aquisição) = modelo, alocações = maior resto do modelo, e o
 * comando recusado não deixou linha nenhuma.
 *
 * Sequências aleatórias com semente fixa de comandos válidos e inválidos (retroativos, mesmo dia, estorno e correção de
 * qualquer tipo, em cadeia) e casos dirigidos: mesmo dia com as classes 0, 1 e 2, substituição em cadeia, estorno de
 * compra com venda posterior, gêmeos com natimorto, centavos patológicos, arroba e carcaça com arredondamento,
 * parcelas que diferem de 1 centavo e reenvio com a mesma chave.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./apoio-cadastros');
const A = require('./apoio-persistencia');

const { js, PASTOS, bicho, entradaInicial, codigos } = C;
const D0 = '2026-01-01';
const HOJE = '2026-11-13';
const DIAS = 316; // de D0 a HOJE
const AVISOS = ['POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'BRINCO_PARECIDO', 'IDADE_REPRODUTIVA', 'INTERVALO_PARTO_CURTO', 'VALOR_DIVERGENTE', 'RATEIO_SEM_PESO'];
const USO = [PASTOS.A, PASTOS.B, PASTOS.C];
const SITUACAO_SAIDA = { VENDA: 'VENDIDO', MORTE: 'MORTO', DESCARTE: 'DESCARTADO', AJUSTE_INVENTARIO: 'BAIXADO_AJUSTE' };

function somaDias(d, n) {
  const t = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const soma = (lista, f) => lista.reduce((s, x) => s + (typeof f === 'function' ? f(x) : x[f] || 0), 0);
function agrupar(lista, campo) {
  const g = new Map();
  lista.forEach((x) => { const k = x[campo]; if (!g.has(k)) g.set(k, []); g.get(k).push(x); });
  return g;
}

function ambiente(opcoes) {
  const c = C.ambienteCadastros(opcoes);
  const m = c.m;
  const parceiro = (nome, tipos) => c.run('Config.comandoSalvarParceiro', { campos: { nome, tipos } }).dados.partner_id;
  const P = { fornecedor: parceiro('Fornecedor F1', 'FORNECEDOR'), comprador: parceiro('Frigorífico C1', 'COMPRADOR'), transportador: parceiro('Transportes T1', 'TRANSPORTADOR') };
  const custeio = m.linhas.PLANO_CONTAS.find((x) => x.codigo === 'SERVICOS_VETERINARIOS').conta_id;
  return { c, m, G: c.G, P, custeio };
}

// ------------------------------------------------------------------ oráculo 1: o que está gravado, lido cru ----
const ABAS_CRU = ['OPERACOES', 'EVENTOS', 'EVENTO_ANIMAIS', 'ANIMAIS', 'IDENTIFICACOES', 'FINANCEIRO', 'PARCELAS', 'RATEIOS', 'ALOCACOES_FINANCEIRAS', 'COMPRAS', 'VENDAS', 'PLANO_CONTAS', 'REPRODUCAO', 'BAIXAS', 'PESAGENS'];
function cru(m) {
  const l = m.amb.lido(ABAS_CRU);
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

// ------------------------------------------------------------------ oráculo 2: o modelo de referência ----
/** Maior resto em inteiros (05, seção 4.5): bases inteiras; empate → maior base → menor código. Map(animal → centavos). */
function maiorResto(V, itens) {
  const B = soma(itens, 'base');
  if (!B) return new Map(itens.map((x) => [x.animal, 0]));
  const q = itens.map((x) => ({ x, q: Math.floor(V * x.base / B), r: (V * x.base) % B }));
  let sobra = V - soma(q, 'q');
  q.slice().sort((a, b) => b.r - a.r || b.x.base - a.x.base || cmp(a.x.codigo, b.x.codigo)).forEach((y) => { if (sobra > 0) { y.q++; sobra--; } });
  return new Map(q.map((y) => [y.x.animal, y.q]));
}
function dividir(total, n) {
  const q = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => q + (i < total - q * n ? 1 : 0));
}
function criarModelo() {
  return { eventos: [], porId: new Map(), animais: new Map(), seq: 0, brinco: 100, stats: {} };
}
function vigentes(M, excl) {
  return M.eventos.filter((e) => e.vigente && !(excl && excl.has(e.id)));
}
function linhasDe(M, animal, excl, novo) {
  const out = [];
  const de = (e, id) => e.linhas.forEach((l) => { if (l.animal === animal) out.push(Object.assign({ ev: id, tipo: e.tipo, data: e.data, seq: e.seq, raiz: e.raiz }, l)); });
  vigentes(M, excl).forEach((e) => de(e, e.id));
  if (novo) de(novo, 'NOVO');
  return out;
}
function identsDe(M, animal, excl, novo) {
  const out = [];
  const de = (e, id) => e.idents.forEach((x) => { if (x.animal === animal) out.push(Object.assign({ ev: id, data: e.data, seq: e.seq, raiz: e.raiz }, x)); });
  vigentes(M, excl).forEach((e) => de(e, e.id));
  if (novo) de(novo, 'NOVO');
  return out.sort((a, b) => cmp(a.data, b.data) || a.raiz - b.raiz || a.seq - b.seq);
}
function marcasDe(M, animal, excl, novo) {
  const out = [];
  const de = (e, id) => { if (e.marca) e.linhas.forEach((l) => { if (l.animal === animal) out.push({ ev: id, data: e.data, seq: e.seq, raiz: e.raiz, sub: e.marca.sub, marcar: e.marca.marcar }); }); };
  vigentes(M, excl).forEach((e) => de(e, e.id));
  if (novo) de(novo, 'NOVO');
  return out.sort((a, b) => cmp(a.data, b.data) || a.raiz - b.raiz || a.seq - b.seq);
}
/** Linha do tempo de UM animal pela regra de 05, seção 4.3 (sem Timeline): [{cod, ev}]. */
function problemasDaLinha(ls, nasc) {
  const probs = [];
  let dentro = false;
  let pasto = null;
  let morte = null;
  const per = [];
  ordenar(ls.filter((l) => !l.fato)).forEach((l) => {
    if (morte !== null && (l.data > morte || l.efeito === 1)) { probs.push({ cod: 'APOS_MORTE', ev: l.ev }); return; }
    if (l.efeito === 1) {
      if (dentro) { probs.push({ cod: 'ENTRADA_JA_DENTRO', ev: l.ev }); return; }
      dentro = true; pasto = l.destino; per.push({ ini: l.data, fim: null }); return;
    }
    if (!dentro) { probs.push({ cod: 'FORA_DO_REBANHO', ev: l.ev }); return; }
    if (l.origem && l.origem !== pasto) probs.push({ cod: 'ORIGEM_DIVERGENTE', ev: l.ev });
    if (l.efeito === 0) { pasto = l.destino; return; }
    dentro = false; pasto = null; per[per.length - 1].fim = l.data;
    if (l.tipo === 'MORTE') morte = l.data;
  });
  ls.filter((l) => l.fato).forEach((l) => {
    if (morte !== null && l.data > morte) { probs.push({ cod: 'APOS_MORTE', ev: l.ev }); return; }
    if (!per.some((p) => l.data >= p.ini && (p.fim === null || l.data <= p.fim))) probs.push({ cod: 'FORA_DA_PERMANENCIA', ev: l.ev });
  });
  if (nasc) ls.forEach((l) => { if (l.data < nasc) probs.push({ cod: 'ANTES_DO_NASCIMENTO', ev: l.ev }); });
  return probs;
}
function problemasDoAnimal(M, animal, excl, novo) {
  const a = M.animais.get(animal);
  const probs = problemasDaLinha(linhasDe(M, animal, excl, novo), a ? a.nascProposto || a.nasc : null);
  let aberto = null;
  identsDe(M, animal, excl, novo).forEach((x) => {
    if (x.kind === 'ABRE') { aberto = x.codigo; return; }
    if (x.kind === 'PRIMEIRA') { if (aberto) probs.push({ cod: 'IDENTIFICACAO_JA_EXISTE', ev: x.ev }); aberto = x.codigo; return; }
    if (x.kind === 'SUBST') { if (!aberto) probs.push({ cod: 'SEM_IDENTIFICACAO', ev: x.ev }); aberto = x.codigo; return; }
    if (!aberto) probs.push({ cod: 'SEM_IDENTIFICACAO', ev: x.ev });
    else if (aberto !== x.codigo) probs.push({ cod: 'REMOCAO_DE_OUTRO_CODIGO', ev: x.ev });
    aberto = null;
  });
  const marcado = {};
  marcasDe(M, animal, excl, novo).forEach((x) => {
    if (x.marcar === !!marcado[x.sub]) probs.push({ cod: x.marcar ? 'JA_MARCADO' : 'NAO_MARCADO', ev: x.ev });
    marcado[x.sub] = x.marcar;
  });
  return probs;
}
/** Onde o animal está no dia D depois das entradas e dos movimentos de D (a origem de uma saída lançada em D). */
function antesDaSaida(ls, D) {
  let s = 0;
  let p = null;
  ordenar(ls.filter((l) => !l.fato && (l.data < D || (l.data === D && classe(l) < 2)))).forEach((l) => { s += l.efeito; if (l.destino) p = l.destino; if (l.efeito === -1) p = null; });
  return s >= 1 ? { presente: true, pasto: p } : { presente: false, pasto: null };
}
function presenteNoDia(ls, D) {
  const per = [];
  ordenar(ls.filter((l) => !l.fato)).forEach((l) => { if (l.efeito === 1) per.push({ ini: l.data, fim: null }); else if (l.efeito === -1 && per.length) per[per.length - 1].fim = l.data; });
  return per.some((p) => D >= p.ini && (p.fim === null || D <= p.fim));
}
function estadoAtual(M, id, excl) {
  if (!M.animais.has(id)) return { situacao: 'ANULADO' };
  return situacaoDe(linhasDe(M, id, excl));
}
/** Código em uso antes da posição de um evento novo (data D, depois de tudo o que já está nesse dia). */
function brincoAntes(M, id, D, excl) {
  let aberto = null;
  identsDe(M, id, excl).forEach((x) => { if (x.data <= D) aberto = x.kind === 'REMOCAO' ? null : x.codigo; });
  return aberto;
}

/**
 * Previsão do desfecho (VALIDATION, CONFLICT com os eventos que impedem, ou OK) de uma proposta:
 * {novo: evento do modelo (ou null no estorno), excl: Set de eventos anulados pelo comando, tocados: animais já
 * cadastrados a revalidar, removidosCriados: animais criados pelo anulado que deixam de existir, pre: erros de entrada}.
 */
function prever(M, p) {
  if (p.pre && p.pre.length) return { cat: 'VALIDATION', por: p.pre };
  const own = [];
  const outros = new Set();
  Array.from(new Set(p.tocados)).forEach((id) => problemasDoAnimal(M, id, p.excl, p.novo).forEach((x) => { if (x.ev === 'NOVO') own.push(x.cod); else outros.add(x.ev); }));
  (p.removidosCriados || []).forEach((id) => vigentes(M, p.excl).forEach((e) => { if (e.linhas.some((l) => l.animal === id)) outros.add(e.id); }));
  if (own.length) return { cat: 'VALIDATION', por: own };
  if (outros.size) return { cat: 'CONFLICT', outros };
  return { cat: 'OK' };
}
function novoEvento(M, tipo, data, extra) {
  return Object.assign({ id: null, tipo, sub: null, data, seq: M.seq + 1, raiz: M.seq + 1, vigente: true, linhas: [], idents: [], marca: null, criados: [], fin: [], dados: null }, extra || {});
}
/** Grava no modelo o evento aceito (com os ids que o sistema devolveu). */
function aceitar(M, p, resp) {
  M.seq++;
  if (p.estorno) {
    p.alvo.vigente = false;
    const est = novoEvento(M, 'ESTORNO', HOJE, { id: resp.event_id, vigente: false, seq: M.seq, raiz: M.seq });
    M.eventos.push(est);
    M.porId.set(est.id, est);
    return est;
  }
  const e = p.novo;
  e.id = resp.event_id;
  e.seq = M.seq;
  if (!p.substitui) e.raiz = M.seq;
  else p.substitui.vigente = false;
  // Animais novos: o id vem da resposta, pelo brinco (cada animal novo do ataque tem brinco próprio).
  const porBrinco = new Map(resp.animais.filter((a) => a.brinco).map((a) => [a.brinco, a]));
  (p.novos || []).forEach((n) => {
    const a = porBrinco.get(n.brinco);
    assert.ok(a, 'o animal novo ' + n.brinco + ' voltou na resposta');
    M.animais.set(a.animal_id, { id: a.animal_id, codigo: a.codigo_interno, sexo: n.sexo, nasc: n.nasc || null, brinco0: n.brinco });
    const troca = (x) => { if (x.animal === n.ref) x.animal = a.animal_id; };
    e.linhas.forEach(troca);
    e.idents.forEach(troca);
    e.criados = e.criados.map((x) => (x === n.ref ? a.animal_id : x));
    n.id = a.animal_id;
  });
  if (e.fin.length) e.finEsperado = e.calcularFin(M);
  M.eventos.push(e);
  M.porId.set(e.id, e);
  return e;
}

// ------------------------------------------------------------------ propostas (comando + previsão) ----
function sujeitos(M, ids, excl, pre) {
  if (new Set(ids).size !== ids.length) pre.push('ANIMAL_REPETIDO');
  ids.forEach((id) => { if (estadoAtual(M, id, excl).situacao === 'ANULADO') pre.push('NAO_ENCONTRADO'); });
}
function propTransferencia(M, data, origem, destino, ids, substitui) {
  const excl = new Set(substitui ? [substitui.id] : []);
  const pre = [];
  sujeitos(M, ids, excl, pre);
  if (origem === destino) pre.push('DESTINO_IGUAL_ORIGEM');
  const novo = novoEvento(M, 'TRANSFERENCIA', data, { raiz: substitui ? substitui.raiz : M.seq + 1 });
  ids.forEach((id) => novo.linhas.push({ animal: id, efeito: 0, origem, destino }));
  novo.dados = { tipo: 'TRANSFERENCIA', campos: { event_date: data, pasto_origem_id: origem, pasto_destino_id: destino }, animais: ids.map((animal_id) => ({ animal_id })) };
  const tocados = ids.concat(substitui ? substitui.linhas.map((l) => l.animal) : []);
  return { novo, excl, pre, tocados, substitui, acao: substitui ? 'corrigir' : 'registrar' };
}
/** Saídas sem negociação (MORTE, DESCARTE, DIVERGENCIA_CONTAGEM), com o lançamento opcional da morte ou do descarte. */
function propSaida(M, amb, tipo, data, ids, opcoes, substitui) {
  const o = opcoes || {};
  const excl = new Set(substitui ? [substitui.id] : []);
  const pre = [];
  sujeitos(M, ids, excl, pre);
  const novo = novoEvento(M, tipo === 'DIVERGENCIA_CONTAGEM' ? 'AJUSTE_INVENTARIO' : tipo, data, { sub: tipo === 'DIVERGENCIA_CONTAGEM' ? 'DIVERGENCIA_CONTAGEM' : null, raiz: substitui ? substitui.raiz : M.seq + 1 });
  ids.forEach((id) => novo.linhas.push({ animal: id, efeito: -1, origem: antesDaSaida(linhasDe(M, id, excl), data).pasto, destino: null }));
  const campos = { event_date: data };
  if (tipo === 'MORTE') { campos.causa = 'DOENCA'; if (o.valor) { campos.custo_valor = o.valor; campos.custo_conta_id = amb.custeio; } }
  if (tipo === 'DESCARTE') { campos.destino = 'CONSUMO_PROPRIO'; campos.motivo = 'IDADE'; if (o.valor) campos.receita_valor = o.valor; }
  if (tipo === 'DIVERGENCIA_CONTAGEM') campos.justificativa = 'Faltou na contagem do curral';
  novo.dados = tipo === 'DIVERGENCIA_CONTAGEM' ? { tipo: 'AJUSTE_INVENTARIO', subtipo: 'DIVERGENCIA_CONTAGEM', campos, animais: ids.map((animal_id) => ({ animal_id })) } : { tipo, campos, animais: ids.map((animal_id) => ({ animal_id })) };
  if (o.valor && tipo !== 'DIVERGENCIA_CONTAGEM') {
    novo.fin = [o.valor];
    novo.calcularFin = (Mx) => [{ natureza: tipo === 'MORTE' ? 'CUSTEIO' : 'OUTRA_RECEITA', valor: o.valor, criterio: ids.length === 1 ? 'DIRETO' : 'CABECAS', alocs: maiorResto(o.valor, ids.map((id) => ({ animal: id, codigo: Mx.animais.get(id).codigo, base: 1 }))) }];
  }
  return { novo, excl, pre, tocados: ids.concat(substitui ? substitui.linhas.map((l) => l.animal) : []), substitui, acao: substitui ? 'corrigir' : 'registrar', opcoes: o };
}
/** Parcelas de um valor: 'vazias' (divisão igual), 'explicitas' (já divididas) ou 'erro' (somam 1 centavo a mais ou a menos). */
function parcelasDe(valor, n, modo, data, rnd) {
  const venc = (i) => somaDias(data, 30 * (i + 1));
  if (modo === 'vazias') return { lista: Array.from({ length: n }, (_, i) => ({ data_vencimento: venc(i) })), erro: valor < n, valores: valor < n ? null : dividir(valor, n) };
  const vs = valor >= n ? dividir(valor, n) : [valor];
  if (modo === 'erro') vs[vs.length - 1] += rnd() < 0.5 ? 1 : -1;
  const erro = modo === 'erro' || vs.some((v) => v <= 0);
  return { lista: vs.map((v, i) => ({ data_vencimento: venc(i), valor: v })), erro, valores: erro ? null : vs };
}
/**
 * COMPRA de animais novos ou de um animal que volta. negocio: {modalidade: CABECA | VALOR | KG, preco, frete,
 * parcelas: {n, modo}, valor (opcional: o valor da nota; padrão = a conta)}.
 */
function propCompra(M, amb, data, pasto, novos, voltas, negocio, rnd, substitui) {
  const excl = new Set(substitui ? [substitui.id] : []);
  const pre = [];
  const novo = novoEvento(M, 'COMPRA', data, { raiz: substitui ? substitui.raiz : M.seq + 1 });
  const itens = [];
  novos.forEach((n) => {
    n.ref = n.ref || 'novo:' + n.brinco;
    const ref = n.id || n.ref;
    novo.linhas.push({ animal: ref, efeito: 1, origem: null, destino: pasto });
    novo.idents.push({ animal: ref, kind: 'ABRE', codigo: n.brinco });
    novo.criados.push(ref);
    const it = { brinco: n.brinco, sexo: n.sexo, idade_meses: 36 };
    if (n.sexo === 'M') { it.castrado = false; it.reprodutor = false; }
    if (n.id) it.animal_id = n.id;
    itens.push({ ref, it, n });
  });
  voltas.forEach((id) => {
    const st = estadoAtual(M, id, excl).situacao;
    if (st === 'ANULADO' || st === 'ATIVO' || st === 'MORTO') pre.push('VOLTA_' + st);
    novo.linhas.push({ animal: id, efeito: 1, origem: null, destino: pasto });
    itens.push({ ref: id, it: { animal_id: id }, volta: true });
  });
  if (new Set(voltas).size !== voltas.length) pre.push('ANIMAL_REPETIDO');
  const n = itens.length;
  const g = negocio;
  itens.forEach((x, i) => { if (g.modalidade === 'KG') x.it.peso = g.pesos[i]; if (g.modalidade === 'VALOR') x.it.valor_individual = g.valores[i]; });
  const conta = g.modalidade === 'CABECA' ? n * g.preco : g.modalidade === 'VALOR' ? soma(g.valores, (v) => v) : Math.round(soma(g.pesos, (p) => Math.round(p * 10)) * g.preco / 10);
  const valor = g.valor !== undefined ? g.valor : conta;
  const campos = { event_date: data, partner_id: amb.P.fornecedor, modalidade: g.modalidade === 'KG' ? 'KG_VIVO' : 'CABECA', valor_animais: valor, pasto_destino_id: pasto };
  if (g.modalidade !== 'VALOR') campos.preco_unitario = g.preco;
  const parc = parcelasDe(valor, g.parcelas.n, g.parcelas.modo, data, rnd);
  if (parc.erro) pre.push('PARCELAS_NAO_SOMAM');
  novo.dados = { tipo: 'COMPRA', campos, animais: itens.map((x) => x.it), parcelas: parc.lista, custos: g.frete ? [{ tipo: 'FRETE', valor: g.frete, partner_id: amb.P.transportador }] : [] };
  novo.fin = [valor].concat(g.frete ? [g.frete] : []);
  novo.calcularFin = (Mx) => {
    const ids = itens.map((x) => (x.n ? x.n.id : x.ref));
    const criterio = n === 1 ? 'DIRETO' : g.modalidade === 'CABECA' ? 'CABECAS' : g.modalidade === 'VALOR' ? 'VALOR_INDIVIDUAL' : 'PESO_VIVO';
    const bases = ids.map((id, i) => ({ animal: id, codigo: Mx.animais.get(id).codigo, base: criterio === 'DIRETO' || criterio === 'CABECAS' ? 1 : criterio === 'VALOR_INDIVIDUAL' ? g.valores[i] : Math.round(g.pesos[i] * 10) }));
    return novo.fin.map((v) => ({ natureza: 'AQUISICAO_ANIMAIS', valor: v, criterio, alocs: maiorResto(v, bases) }));
  };
  const removidosCriados = substitui ? substitui.criados.filter((id) => !novos.some((x) => x.id === id)) : [];
  const tocados = voltas.concat(novos.filter((x) => x.id).map((x) => x.id)).concat(substitui ? substitui.linhas.map((l) => l.animal).filter((id) => !removidosCriados.includes(id)) : []);
  return { novo, excl, pre, tocados, removidosCriados, substitui, novos: novos.filter((x) => !x.id), acao: substitui ? 'corrigir' : 'registrar', negocio: g };
}
/** VENDA. negocio: {modalidade: CABECA | KG, preco, pesos, desconto, deducoes: [{tipo, valor, retida}], parcelas: {n, modo}, origem}. */
function propVenda(M, amb, data, ids, negocio, rnd, substitui) {
  const excl = new Set(substitui ? [substitui.id] : []);
  const pre = [];
  sujeitos(M, ids, excl, pre);
  const g = negocio;
  const novo = novoEvento(M, 'VENDA', data, { raiz: substitui ? substitui.raiz : M.seq + 1 });
  ids.forEach((id) => novo.linhas.push({ animal: id, efeito: -1, origem: g.origem || antesDaSaida(linhasDe(M, id, excl), data).pasto, destino: null }));
  const n = ids.length;
  const bruto = g.bruto !== undefined ? g.bruto : g.modalidade === 'CABECA' ? n * g.preco : Math.round(soma(g.pesos, (p) => Math.round(p * 10)) * g.preco / 10);
  const desconto = g.desconto || 0;
  const receita = bruto - desconto;
  if (desconto >= bruto) pre.push('DESCONTO');
  const campos = { event_date: data, partner_id: amb.P.comprador, finalidade: 'RECRIA_ENGORDA', modalidade: g.modalidade === 'KG' ? 'KG_VIVO' : 'CABECA', preco_unitario: g.preco, valor_bruto: bruto };
  if (desconto) campos.desconto_comercial = desconto;
  if (g.origem) campos.pasto_origem_id = g.origem;
  const parc = receita > 0 ? parcelasDe(receita, g.parcelas.n, g.parcelas.modo, data, rnd) : { lista: [{ data_vencimento: somaDias(data, 30) }], erro: true };
  if (parc.erro) pre.push('PARCELAS_NAO_SOMAM');
  const deducoes = (g.deducoes || []).map((x) => Object.assign({ tipo: x.tipo, valor: x.valor }, x.retida ? { retida_pelo_comprador: true } : {}));
  const retido = soma((g.deducoes || []).filter((x) => x.retida), 'valor');
  if (parc.valores && retido > parc.valores[0]) pre.push('RETENCAO_MAIOR_QUE_RECEBIMENTO');
  novo.dados = { tipo: 'VENDA', campos, animais: ids.map((id, i) => Object.assign({ animal_id: id }, g.modalidade === 'KG' ? { peso: g.pesos[i] } : {})), parcelas: parc.lista, deducoes };
  novo.fin = [receita].concat(deducoes.map((x) => x.valor));
  novo.calcularFin = (Mx) => {
    const criterio = n === 1 ? 'DIRETO' : g.modalidade === 'CABECA' ? 'CABECAS' : 'PESO_VIVO';
    const bases = ids.map((id, i) => ({ animal: id, codigo: Mx.animais.get(id).codigo, base: criterio === 'PESO_VIVO' ? Math.round(g.pesos[i] * 10) : 1 }));
    return novo.fin.map((v, i) => ({ natureza: i === 0 ? 'RECEITA_VENDA_ANIMAIS' : 'DESPESA_VENDA', valor: v, criterio, alocs: maiorResto(v, bases) }));
  };
  return { novo, excl, pre, tocados: ids.concat(substitui ? substitui.linhas.map((l) => l.animal) : []), substitui, acao: substitui ? 'corrigir' : 'registrar', negocio: g };
}
/** NASCIMENTO: crias [{situacao: VIVO | NATIMORTO, sexo, brinco, id (na correção)}]; pasto vazio = o da mãe no dia. */
function propNascimento(M, data, matriz, crias, pasto, substitui) {
  const excl = new Set(substitui ? [substitui.id] : []);
  const pre = [];
  sujeitos(M, [matriz], excl, pre);
  const mae = M.animais.get(matriz);
  if (mae && mae.sexo !== 'F') pre.push('MATRIZ_NAO_FEMEA');
  const novo = novoEvento(M, 'NASCIMENTO', data, { raiz: substitui ? substitui.raiz : M.seq + 1 });
  novo.linhas.push({ animal: matriz, efeito: 0, origem: null, destino: null, fato: true });
  const ondeMae = antesDaSaida(linhasDe(M, matriz, excl), data);
  const destino = pasto || (ondeMae.presente ? ondeMae.pasto : null);
  const novos = [];
  crias.forEach((x) => {
    if (x.situacao !== 'VIVO') return;
    x.ref = x.ref || 'novo:' + x.brinco;
    const ref = x.id || x.ref;
    novo.linhas.push({ animal: ref, efeito: 1, origem: null, destino });
    novo.idents.push({ animal: ref, kind: 'ABRE', codigo: x.brinco });
    novo.criados.push(ref);
    if (!x.id) novos.push({ brinco: x.brinco, sexo: x.sexo, nasc: data, ref: x.ref });
  });
  novo.dados = {
    tipo: 'NASCIMENTO', campos: Object.assign({ event_date: data }, pasto ? { pasto_destino_id: pasto } : {}), animais: [{ animal_id: matriz }],
    crias: crias.map((x) => (x.situacao === 'VIVO' ? Object.assign({ situacao_nascimento: 'VIVO', sexo: x.sexo, brinco: x.brinco }, x.id ? { animal_id: x.id } : {}) : { situacao_nascimento: 'NATIMORTO' })),
  };
  novo.crias = crias;
  // A cria que já existia e agora nasce em outra data: o nascimento dela muda junto (a linha dela é conferida).
  crias.forEach((x) => { if (x.id && M.animais.has(x.id)) M.animais.get(x.id).nascProposto = data; });
  const removidosCriados = substitui ? substitui.criados.filter((id) => !crias.some((x) => x.situacao === 'VIVO' && x.id === id)) : [];
  const tocados = [matriz].concat(crias.filter((x) => x.id && x.situacao === 'VIVO').map((x) => x.id)).concat(substitui ? substitui.linhas.map((l) => l.animal).filter((id) => !removidosCriados.includes(id)) : []);
  return { novo, excl, pre, tocados, removidosCriados, substitui, novos, acao: substitui ? 'corrigir' : 'registrar' };
}
/** IDENTIFICACAO de brinco: PRIMEIRA_IDENTIFICACAO e SUBSTITUICAO com código novo; REMOCAO tira o código em uso na data. */
function propIdentificacao(M, sub, data, id, codigo, substitui) {
  const excl = new Set(substitui ? [substitui.id] : []);
  const pre = [];
  sujeitos(M, [id], excl, pre);
  const novo = novoEvento(M, 'IDENTIFICACAO', data, { sub, raiz: substitui ? substitui.raiz : M.seq + 1 });
  novo.linhas.push({ animal: id, efeito: 0, origem: null, destino: null, fato: true });
  let cod = codigo;
  if (sub === 'REMOCAO') {
    cod = brincoAntes(M, id, data, excl);
    if (!cod) pre.push('SEM_IDENTIFICACAO');
  } else if (brincoAntes(M, id, data, excl) === codigo) pre.push('VALOR_IGUAL');
  novo.idents.push({ animal: id, kind: sub === 'PRIMEIRA_IDENTIFICACAO' ? 'PRIMEIRA' : sub === 'SUBSTITUICAO' ? 'SUBST' : 'REMOCAO', codigo: cod });
  const item = { animal_id: id };
  if (sub !== 'REMOCAO') item.codigo = codigo;
  if (sub !== 'PRIMEIRA_IDENTIFICACAO') item.motivo = 'PERDA';
  novo.dados = { tipo: 'IDENTIFICACAO', subtipo: sub, campos: { event_date: data, tipo_identificacao: 'BRINCO' }, animais: [item] };
  return { novo, excl, pre, tocados: [id].concat(substitui ? substitui.linhas.map((l) => l.animal) : []), substitui, acao: substitui ? 'corrigir' : 'registrar' };
}
function propMarcacao(M, sub, marcar, data, id, substitui) {
  const excl = new Set(substitui ? [substitui.id] : []);
  const pre = [];
  sujeitos(M, [id], excl, pre);
  const novo = novoEvento(M, 'MARCACAO', data, { sub, marca: { sub, marcar }, raiz: substitui ? substitui.raiz : M.seq + 1 });
  novo.linhas.push({ animal: id, efeito: 0, origem: null, destino: null, fato: true });
  novo.dados = { tipo: 'MARCACAO', subtipo: sub, campos: { event_date: data, acao: marcar ? 'MARCAR' : 'DESMARCAR' }, animais: [{ animal_id: id }] };
  return { novo, excl, pre, tocados: [id].concat(substitui ? substitui.linhas.map((l) => l.animal) : []), substitui, acao: substitui ? 'corrigir' : 'registrar' };
}
/** OUTRA_ENTRADA de animal que já existe (volta ao rebanho). */
function propVolta(M, data, id, pasto) {
  const pre = [];
  const st = estadoAtual(M, id, new Set()).situacao;
  if (st === 'ANULADO' || st === 'ATIVO' || st === 'MORTO') pre.push('VOLTA_' + st);
  const novo = novoEvento(M, 'OUTRA_ENTRADA', data);
  novo.linhas.push({ animal: id, efeito: 1, origem: null, destino: pasto });
  novo.dados = { tipo: 'OUTRA_ENTRADA', campos: { event_date: data, description: 'Apareceu na divisa' }, animais: [{ animal_id: id, pasto_destino_id: pasto }] };
  return { novo, excl: new Set(), pre, tocados: [id], acao: 'registrar' };
}
function propEstorno(M, alvo) {
  const pre = [];
  if (alvo.tipo === 'ESTORNO') pre.push('ESTORNO_NAO_SE_ESTORNA');
  else if (!alvo.vigente) pre.push('JA_ANULADO');
  const excl = new Set([alvo.id]);
  const animais = Array.from(new Set(alvo.linhas.map((l) => l.animal)));
  return {
    estorno: true, alvo, excl, pre, acao: 'estornar', novo: null,
    tocados: animais.filter((id) => !alvo.criados.includes(id)), removidosCriados: alvo.criados.slice(),
    dados: { event_id: alvo.id, justificativa: 'Lançado errado' },
  };
}

// ------------------------------------------------------------------ execução e conferência ----
function contagens(r) {
  const o = {};
  ABAS_CRU.forEach((a) => { o[a] = r[a].length; });
  return o;
}
/** Desfecho de um comando (ou da simulação) × previsão do modelo; no CONFLICT, os mesmos eventos que impedem. */
function conferirDesfecho(M, prev, r, quem) {
  if (prev.cat === 'OK') { assert.equal(r.ok, true, quem); return; }
  assert.equal(r.ok, false, quem);
  assert.equal(r.erro.code, prev.cat, quem);
  if (prev.cat === 'CONFLICT') {
    const vistos = new Set(r.erro.details.map((d) => d.conflito && d.conflito.event_id).filter(Boolean));
    assert.deepEqual(Array.from(vistos).sort(), Array.from(prev.outros).sort(), quem + ': os eventos que impedem');
  }
}
function dadosDe(p) {
  return p.estorno ? p.dados : Object.assign({}, p.novo.dados, p.substitui ? { event_id: p.substitui.id, justificativa: 'Corrigindo o lançamento' } : {});
}
/**
 * Roda a proposta: primeiro a simulação (o MESMO tratador: mesmo desfecho e os mesmos lançamentos que a gravação),
 * depois o comando; confere o desfecho previsto e, aceito, grava no modelo, confere a resposta e, às vezes, reenvia
 * com a mesma chave (duplicado idêntico, nada gravado) ou com outro conteúdo (IDEMPOTENCY_MISMATCH). op: {chave, rnd}.
 */
function executar(amb, M, p, msg, op) {
  const o = op || {};
  const prev = prever(M, p);
  const antes = contagens(cru(amb.m));
  const dados = dadosDe(p);
  const tipo = p.estorno ? 'ESTORNO' : p.novo.tipo + (p.substitui ? '/corrigir' : '');
  const descr = (r) => (r.ok ? 'OK' : r.erro.code + ' ' + r.erro.message + ' ' + JSON.stringify(r.erro.details.map((d) => [d.codigo, d.conflito && d.conflito.tipo, d.conflito && d.conflito.data])));
  const quem0 = msg + ' [' + tipo + ' ' + (p.novo ? p.novo.data : p.alvo.data) + '] previsto ' + prev.cat + (prev.por ? ' (' + prev.por.join(',') + ')' : '') +
    (prev.outros ? ' com ' + Array.from(prev.outros).map((id) => (M.porId.get(id) || {}).tipo + '@' + (M.porId.get(id) || {}).data).join(',') : '');
  const sim = amb.m.simular(p.acao, dados, { avisos: AVISOS });
  conferirDesfecho(M, prev, sim, quem0 + '; simulação: ' + descr(sim));
  const r = amb.m.tentar(p.acao, dados, { avisos: AVISOS, chave: o.chave });
  const quem = quem0 + '; sistema: ' + descr(r);
  conferirDesfecho(M, prev, r, quem);
  const st = (M.stats[tipo] = M.stats[tipo] || { OK: 0, VALIDATION: 0, CONFLICT: 0 });
  st[prev.cat]++;
  if (prev.cat !== 'OK') {
    assert.deepEqual(contagens(cru(amb.m)), antes, quem + ': o comando recusado não gravou nada');
    return { r, prev, ev: null };
  }
  const ev = aceitar(M, p, r.valor.dados);
  // A simulação mostrou os mesmos lançamentos que a gravação fez (P5: o valor definitivo vem do servidor).
  const fin = sim.valor.dados.impactos.financeiro;
  if (ev.finEsperado && ev.finEsperado.length) {
    assert.deepEqual(fin.lancamentos.map((l) => [l.natureza, l.valor]), ev.finEsperado.map((f) => [f.natureza, f.valor]), quem + ': lançamentos da simulação');
    const porAnimal = {};
    ev.finEsperado.forEach((f, i) => f.alocs.forEach((v, k) => { if (i === 0 || ev.tipo === 'COMPRA') porAnimal[k] = (porAnimal[k] || 0) + v; }));
    const simulado = {};
    fin.por_animal.forEach((x) => { simulado[x.animal_id] = x.valor; });
    if (ev.tipo !== 'COMPRA' || !p.novos || !p.novos.length) assert.deepEqual(simulado, porAnimal, quem + ': valor por animal da simulação');
  } else assert.ok(!fin, quem + ': sem lançamento na simulação');
  // A resposta traz os animais já com as projeções do modelo.
  r.valor.dados.animais.forEach((a) => {
    const st2 = situacaoDe(linhasDe(M, a.animal_id));
    assert.deepEqual([a.situacao_cadastral, a.pasto_atual_id], [st2.situacao, st2.pasto], quem + ': resposta, animal ' + a.codigo_interno);
  });
  const rnd = o.rnd;
  if (rnd && o.chave) {
    const x = rnd();
    if (x < 0.15) {
      const depois = contagens(cru(amb.m));
      const dup = amb.m.tentar(p.acao, dados, { avisos: [], chave: o.chave });
      assert.equal(dup.ok, true, quem + ': reenvio com a mesma chave');
      assert.deepEqual([dup.valor.duplicado, dup.valor.dados, dup.valor.opId], [true, r.valor.dados, r.valor.opId], quem + ': reenvio = duplicado com a mesma resposta');
      assert.deepEqual(contagens(cru(amb.m)), depois, quem + ': o duplicado não gravou nada');
    } else if (x < 0.25) {
      const depois = contagens(cru(amb.m));
      const outro = Object.assign({}, dados, p.estorno ? { justificativa: 'Outro motivo' } : { campos: Object.assign({}, dados.campos, { notes: 'Conteúdo mudado com a mesma chave' }) });
      const mm = amb.m.tentar(p.acao, outro, { avisos: AVISOS, chave: o.chave });
      assert.equal(mm.ok ? 'OK' : mm.erro.code, 'IDEMPOTENCY_MISMATCH', quem + ': mesma chave, conteúdo diferente');
      assert.deepEqual(contagens(cru(amb.m)), depois, quem + ': o IDEMPOTENCY_MISMATCH não gravou nada');
    }
  }
  return { r, prev, ev };
}

/**
 * Elegíveis pelo modelo: num fato (parto, identificação, marcação) vale o animal presente em algum momento do dia D
 * (o dia da saída conta, RN-017) e o pasto em que ele estava antes das saídas do dia; num movimento ou numa saída, o
 * animal no rebanho ao fim de D, no pasto de então.
 */
function elegiveisDoModelo(M, D) {
  const fim = [];
  const fato = [];
  const pasto = USO[0];
  M.animais.forEach((a, id) => {
    const ls = linhasDe(M, id);
    const st = inventarioDe(ls, D);
    const p = Object.keys(st.porPasto)[0] || null;
    if (st.total >= 1) fim.push({ id, pasto: p });
    if (presenteNoDia(ls, D)) fato.push({ id, pasto: antesDaSaida(ls, D).pasto, sexo: a.sexo });
  });
  return [
    { tipo: 'TRANSFERENCIA', ids: fim.map((x) => x.id) },
    { tipo: 'VENDA', pasto, ids: fim.filter((x) => x.pasto === pasto).map((x) => x.id) },
    { tipo: 'MORTE', ids: fim.map((x) => x.id) },
    { tipo: 'NASCIMENTO', ids: fato.filter((x) => x.sexo === 'F').map((x) => x.id) },
    { tipo: 'IDENTIFICACAO', pasto, ids: fato.filter((x) => x.pasto === pasto).map((x) => x.id) },
    { tipo: 'MARCACAO', ids: fato.map((x) => x.id) },
  ];
}
/** Modelo = replay cru = sistema: inventário em várias datas, ficha de cada animal, alocações e invariantes. */
function conferirTudo(amb, M, msg, datasSistema) {
  const { m, G } = amb;
  const r = cru(m);
  const R = replayCru(r);
  const doModelo = [];
  vigentes(M).forEach((e) => e.linhas.forEach((l) => doModelo.push(Object.assign({ ev: e.id, tipo: e.tipo, data: e.data, seq: e.seq, raiz: e.raiz }, l))));
  const datas = new Set([D0, HOJE, somaDias(D0, 1)]);
  M.eventos.forEach((e) => { if (e.data >= D0) { datas.add(e.data); if (e.data > D0) datas.add(somaDias(e.data, -1)); } });
  datas.forEach((D) => {
    assert.deepEqual(inventarioDe(R.linhas, D), inventarioDe(doModelo, D), msg + ': inventário em ' + D + ' (replay cru × modelo)');
  });
  // O sistema (Timeline.inventario) nas datas pedidas, numa leitura só.
  const amostra = Array.from(new Set([D0, HOJE].concat(datasSistema || [])));
  const sis = m.ler({ rota: 'teste.inventario', reads: G.Timeline.LEITURAS, acessoCru: true, tratador: (tx) => {
    const f = G.Timeline.fonte(tx);
    const todas = f.todasAsLinhas();
    return amostra.map((D) => G.Timeline.inventario(todas, D, D0));
  } });
  amostra.forEach((D, i) => {
    const x = sis[i];
    if (D < D0) { assert.deepEqual([x.total, x.motivo], [null, 'ANTERIOR_AO_MARCO_ZERO'], msg + ': antes do marco zero não há inventário'); return; }
    assert.deepEqual({ total: x.total, porPasto: x.porPasto, semPasto: x.semPasto }, inventarioDe(R.linhas, D), msg + ': inventário do sistema em ' + D);
  });
  // A posição do rebanho (InventoryService) e os elegíveis de cada tipo na data, pela mesma linha do tempo.
  if (datasSistema && datasSistema.length && datasSistema[datasSistema.length - 1] >= D0) {
    const D = datasSistema[datasSistema.length - 1];
    const pos = m.ler(G.InventoryService.consultaPosicao({ data: D }));
    const rep = inventarioDe(R.linhas, D);
    const porPasto = {};
    pos.por_pasto.forEach((x) => { if (x.cabecas) porPasto[x.pasture_id] = x.cabecas; });
    assert.deepEqual([pos.cabecas, porPasto, pos.sem_pasto], [rep.total, rep.porPasto, rep.semPasto], msg + ': inventario.posicao em ' + D);
    elegiveisDoModelo(M, D).forEach((q) => {
      const x = m.ler(G.InventoryService.consultaElegiveis({ tipo: q.tipo, data: D, pasture_id: q.pasto || null }));
      assert.deepEqual(x.itens.map((i) => i.animal_id).sort(), q.ids.sort(), msg + ': inventario.elegiveis de ' + q.tipo + (q.pasto ? ' no pasto' : '') + ' em ' + D);
    });
  }
  // Ficha de cada animal: modelo e replay.
  const linhaAnimal = new Map(r.ANIMAIS.map((a) => [a.animal_id, a]));
  M.animais.forEach((a, id) => {
    const g = linhaAnimal.get(id);
    assert.ok(g, msg + ': o animal ' + a.codigo + ' existe na planilha');
    const st = situacaoDe(linhasDe(M, id));
    const rp = situacaoDe(R.porAnimal.get(id));
    assert.deepEqual([rp.situacao, rp.pasto, rp.saida], [st.situacao, st.pasto, st.saida], msg + ': replay cru × modelo de ' + a.codigo);
    const fora = st.situacao === 'ANULADO';
    const ids = identsDe(M, id);
    const ult = ids.length ? ids[ids.length - 1] : null;
    const brinco = fora || !ult || ult.kind === 'REMOCAO' ? null : ult.codigo;
    const ms = marcasDe(M, id);
    const marca = (sub) => { const x = ms.filter((y) => y.sub === sub).pop(); return !fora && !!x && x.marcar; };
    let custo = null;
    if (!fora && st.entrada) {
      const e = M.porId.get(st.entrada.ev);
      if (e.tipo === 'NASCIMENTO') custo = 0;
      else if (e.tipo === 'COMPRA') custo = soma(e.finEsperado, (f) => f.alocs.get(id) || 0);
    }
    assert.deepEqual(
      [g.situacao_cadastral, g.pasto_atual_id || null, g.data_saida || null, g.brinco || null, g.marcado_descarte === true, g.nao_localizado === true, g.custo_aquisicao === undefined ? null : g.custo_aquisicao],
      [st.situacao, st.pasto, st.saida, brinco, marca('DESCARTE'), marca('NAO_LOCALIZADO'), custo],
      msg + ': ficha de ' + a.codigo + ' (situação, pasto, saída, brinco, descarte, não localizado, custo)');
  });
  // Lançamentos e alocações = maior resto do modelo, nos eventos vigentes.
  const fins = agrupar(r.FINANCEIRO, 'event_id');
  const rats = agrupar(r.RATEIOS, 'financial_id');
  const alocs = agrupar(r.ALOCACOES_FINANCEIRAS, 'rateio_id');
  const eaDe = agrupar(r.EVENTO_ANIMAIS, 'event_id');
  vigentes(M).forEach((e) => {
    const fs = fins.get(e.id) || [];
    const esperado = e.finEsperado || [];
    assert.deepEqual(fs.map((f) => [f.natureza, f.valor]), esperado.map((f) => [f.natureza, f.valor]), msg + ': lançamentos de ' + e.tipo + '@' + e.data);
    fs.forEach((f, i) => {
      const rv = (rats.get(f.financial_id) || []).filter((x) => R.V.vig.get(x.event_id)).pop();
      const al = rv ? alocs.get(rv.rateio_id) || [] : [];
      const obtido = {};
      al.forEach((x) => { obtido[x.animal_id] = x.valor_alocado; });
      const quer = {};
      esperado[i].alocs.forEach((v, k) => { quer[k] = v; });
      assert.deepEqual([rv && rv.criterio, obtido], [esperado[i].criterio, quer], msg + ': rateio pelo maior resto de ' + e.tipo + '@' + e.data + ' lançamento ' + (i + 1));
    });
    if ((e.tipo === 'COMPRA' || e.tipo === 'VENDA') && esperado.length) {
      (eaDe.get(e.id) || []).forEach((l) => assert.equal(l.valor_individual, esperado[0].alocs.get(l.animal_id), msg + ': valor_individual = alocação do lançamento principal'));
    }
  });
  assert.deepEqual(invariantesCruas(r), [], msg + ': invariantes de 03b, seção 14 (conferidas sobre as linhas cruas)');
}

// ------------------------------------------------------------------ rebanho inicial ----
/** Rebanho do marco zero: 6 vacas e 4 bois em A, B e C, todos com brinco. Devolve {M, ids: {brinco: id}}. */
function rebanhoInicial(amb, M) {
  const animais = [];
  for (let i = 0; i < 10; i++) {
    const vaca = i < 6;
    animais.push(bicho(Object.assign({ brinco: 'I' + (10 + i), sexo: vaca ? 'F' : 'M', data_nascimento: vaca ? '2021-03-01' : '2023-05-01', data_nascimento_confianca: 'ESTIMADA', pasto_destino_id: USO[i % 3] }, vaca ? {} : { castrado: true, reprodutor: false })));
  }
  const r = amb.m.run('registrar', entradaInicial(animais));
  M.seq++;
  const e = novoEvento(M, 'ENTRADA_INICIAL', D0, { id: r.dados.event_id, seq: M.seq, raiz: M.seq });
  const ids = {};
  r.dados.animais.forEach((a, i) => {
    const b = a.brinco;
    const k = Number(b.slice(1)) - 10;
    M.animais.set(a.animal_id, { id: a.animal_id, codigo: a.codigo_interno, sexo: k < 6 ? 'F' : 'M', nasc: k < 6 ? '2021-03-01' : '2023-05-01', brinco0: b, inicial: true });
    e.linhas.push({ animal: a.animal_id, efeito: 1, origem: null, destino: USO[k % 3] });
    e.idents.push({ animal: a.animal_id, kind: 'ABRE', codigo: b });
    e.criados.push(a.animal_id);
    ids[b] = a.animal_id;
    assert.equal(i >= 0, true);
  });
  e.finEsperado = [];
  M.eventos.push(e);
  M.porId.set(e.id, e);
  return ids;
}

// ------------------------------------------------------------------ gerador aleatório ----
function sorteio(rnd, lista) {
  return lista[Math.floor(rnd() * lista.length)];
}
function dataAleatoria(rnd) {
  return somaDias(D0, Math.floor(rnd() * (DIAS + 1)));
}
function animaisNoDia(M, D, pasto, comoFato) {
  const out = [];
  M.animais.forEach((a, id) => {
    const ls = linhasDe(M, id);
    if (comoFato ? presenteNoDia(ls, D) : antesDaSaida(ls, D).presente && (!pasto || antesDaSaida(ls, D).pasto === pasto)) out.push(id);
  });
  return out;
}
function alguns(rnd, lista, max) {
  const c = lista.slice();
  const out = [];
  const n = Math.min(c.length, 1 + Math.floor(rnd() * max));
  for (let i = 0; i < n; i++) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]);
  return out;
}
function negocioCompra(rnd, n) {
  const x = rnd();
  const parcelas = { n: 1 + Math.floor(rnd() * 3), modo: sorteio(rnd, ['vazias', 'vazias', 'explicitas', 'explicitas', 'erro']) };
  const frete = rnd() < 0.4 ? sorteio(rnd, [1, 2, 3, 12345, 99999]) : 0;
  if (x < 0.15) return { modalidade: 'CABECA', preco: 1, valor: sorteio(rnd, [1, 2]), parcelas, frete }; // centavos patológicos
  if (x < 0.5) return { modalidade: 'CABECA', preco: 150000 + Math.floor(rnd() * 100) * 1000, parcelas, frete };
  if (x < 0.75) return { modalidade: 'VALOR', valores: Array.from({ length: n }, () => 100000 + Math.floor(rnd() * 900000)), parcelas, frete };
  return { modalidade: 'KG', preco: 1000 + Math.floor(rnd() * 500), pesos: Array.from({ length: n }, () => 200 + Math.floor(rnd() * 3000) / 10), parcelas, frete };
}
function negocioVenda(rnd, n) {
  const parcelas = { n: 1 + Math.floor(rnd() * 2), modo: sorteio(rnd, ['vazias', 'explicitas', 'explicitas', 'erro']) };
  const g = rnd() < 0.5 ? { modalidade: 'CABECA', preco: sorteio(rnd, [1, 333333, 250000]), parcelas } : { modalidade: 'KG', preco: 900 + Math.floor(rnd() * 600), pesos: Array.from({ length: n }, () => 300 + Math.floor(rnd() * 2500) / 10), parcelas };
  if (rnd() < 0.2) g.desconto = sorteio(rnd, [1, 5000]);
  if (rnd() < 0.4) g.deducoes = [{ tipo: 'COMISSAO', valor: sorteio(rnd, [1, 2, 4500]) }].concat(rnd() < 0.5 ? [{ tipo: 'FUNRURAL', valor: sorteio(rnd, [1, 1500]), retida: true }] : []);
  return g;
}
/** Uma proposta aleatória, quase sempre plausível pelo modelo, às vezes de propósito inválida. */
function gerar(M, amb, rnd) {
  const D = dataAleatoria(rnd);
  const todos = Array.from(M.animais.keys());
  const plausivel = rnd() < 0.75;
  const x = rnd();
  const brinco = () => 'R' + (++M.brinco);
  if (x < 0.16) {
    const origem = sorteio(rnd, USO);
    const ids = plausivel ? animaisNoDia(M, D, origem) : todos;
    if (!ids.length) return null;
    return propTransferencia(M, D, origem, plausivel ? sorteio(rnd, USO.filter((p) => p !== origem)) : sorteio(rnd, USO), alguns(rnd, ids, 3));
  }
  if (x < 0.35) {
    const venda = x < 0.27;
    const tipo = venda ? 'VENDA' : sorteio(rnd, ['MORTE', 'DESCARTE', 'DIVERGENCIA_CONTAGEM']);
    let ids;
    let Ds = D;
    if (plausivel && rnd() < 0.5) {
      // Saída depois de tudo o que o animal já tem: a que costuma ser aceita.
      ids = alguns(rnd, todos.filter((id) => estadoAtual(M, id).situacao === 'ATIVO'), venda ? 3 : 2);
      if (!ids.length) return null;
      const ultima = ids.map((id) => linhasDe(M, id).reduce((u, l) => (l.data > u ? l.data : u), D0)).reduce((u, d) => (d > u ? d : u), D0);
      const folga = Math.round((Date.parse(HOJE) - Date.parse(ultima)) / 86400000);
      Ds = somaDias(ultima, Math.floor(rnd() * (folga + 1)));
    } else ids = alguns(rnd, plausivel ? animaisNoDia(M, D) : todos, venda ? 3 : 2);
    if (!ids.length) return null;
    if (venda) {
      const g = negocioVenda(rnd, ids.length);
      if (!plausivel && rnd() < 0.5) g.origem = sorteio(rnd, USO);
      return propVenda(M, amb, Ds, ids, g, rnd);
    }
    return propSaida(M, amb, tipo, Ds, ids, { valor: tipo !== 'DIVERGENCIA_CONTAGEM' && rnd() < 0.4 ? sorteio(rnd, [1, 2, 25000]) : 0 });
  }
  if (x < 0.45) {
    const n = 1 + Math.floor(rnd() * 3);
    const novos = Array.from({ length: n }, () => ({ brinco: brinco(), sexo: rnd() < 0.5 ? 'F' : 'M' }));
    return propCompra(M, amb, D, sorteio(rnd, USO), novos, [], negocioCompra(rnd, n), rnd);
  }
  if (x < 0.5) {
    const fora = todos.filter((id) => ['VENDIDO', 'DESCARTADO', 'BAIXADO_AJUSTE'].includes(estadoAtual(M, id).situacao));
    const id = plausivel && fora.length ? sorteio(rnd, fora) : sorteio(rnd, todos);
    if (rnd() < 0.5) return propVolta(M, D, id, sorteio(rnd, USO));
    return propCompra(M, amb, D, sorteio(rnd, USO), [], [id], negocioCompra(rnd, 1), rnd);
  }
  if (x < 0.58) {
    const maes = todos.filter((id) => M.animais.get(id).inicial || M.animais.get(id).maeElegivel);
    const vivas = plausivel ? maes.filter((id) => M.animais.get(id).sexo === 'F' && presenteNoDia(linhasDe(M, id), D)) : maes;
    if (!vivas.length) return null;
    const crias = [{ situacao: 'VIVO', sexo: rnd() < 0.5 ? 'F' : 'M', brinco: brinco() }];
    if (rnd() < 0.35) crias.push(rnd() < 0.5 ? { situacao: 'NATIMORTO' } : { situacao: 'VIVO', sexo: 'M', brinco: brinco() });
    return propNascimento(M, D, sorteio(rnd, vivas), crias, rnd() < 0.3 ? sorteio(rnd, USO) : null);
  }
  if (x < 0.65) {
    const ids = plausivel ? animaisNoDia(M, D, null, true) : todos;
    if (!ids.length) return null;
    const id = sorteio(rnd, ids);
    const sub = sorteio(rnd, ['PRIMEIRA_IDENTIFICACAO', 'SUBSTITUICAO', 'SUBSTITUICAO', 'REMOCAO']);
    return propIdentificacao(M, sub, D, id, sub === 'REMOCAO' ? null : brinco());
  }
  if (x < 0.7) {
    const ids = plausivel ? animaisNoDia(M, D, null, true) : todos;
    if (!ids.length) return null;
    return propMarcacao(M, sorteio(rnd, ['DESCARTE', 'NAO_LOCALIZADO']), rnd() < 0.6, D, sorteio(rnd, ids));
  }
  const evs = M.eventos.filter((e) => e.tipo !== 'ENTRADA_INICIAL' || rnd() < 0.1);
  if (!evs.length) return null;
  if (x < 0.84) {
    const alvo = plausivel ? sorteio(rnd, evs.filter((e) => e.vigente).concat(evs.filter((e) => e.vigente))) || sorteio(rnd, evs) : sorteio(rnd, evs);
    return propEstorno(M, alvo);
  }
  return gerarCorrecao(M, amb, rnd, evs.filter((e) => e.vigente));
}
function gerarCorrecao(M, amb, rnd, evs) {
  const alvo = sorteio(rnd, evs.filter((e) => ['TRANSFERENCIA', 'VENDA', 'COMPRA', 'MORTE', 'DESCARTE', 'NASCIMENTO', 'IDENTIFICACAO', 'MARCACAO', 'AJUSTE_INVENTARIO'].includes(e.tipo) && !e.dados.animais.some((a) => a.animal_id && !M.animais.has(a.animal_id))));
  if (!alvo) return null;
  const D = rnd() < 0.5 ? alvo.data : dataAleatoria(rnd);
  const d = alvo.dados;
  if (alvo.tipo === 'TRANSFERENCIA') {
    const ids = d.animais.map((a) => a.animal_id);
    const origem = d.campos.pasto_origem_id;
    const destino = sorteio(rnd, USO.filter((p) => p !== origem));
    return propTransferencia(M, D, origem, destino, rnd() < 0.3 && ids.length > 1 ? ids.slice(1) : ids, alvo);
  }
  if (alvo.tipo === 'IDENTIFICACAO') {
    const it = d.animais[0];
    return propIdentificacao(M, alvo.sub, D, it.animal_id, alvo.sub === 'REMOCAO' ? null : rnd() < 0.5 ? it.codigo : 'R' + (++M.brinco), alvo);
  }
  if (alvo.tipo === 'MARCACAO') return propMarcacao(M, alvo.sub, alvo.marca.marcar, D, d.animais[0].animal_id, alvo);
  if (alvo.tipo === 'AJUSTE_INVENTARIO') return propSaida(M, amb, 'DIVERGENCIA_CONTAGEM', D, d.animais.map((a) => a.animal_id), {}, alvo);
  if (alvo.tipo === 'MORTE' || alvo.tipo === 'DESCARTE') {
    return propSaida(M, amb, alvo.tipo, D, d.animais.map((a) => a.animal_id), { valor: rnd() < 0.5 ? sorteio(rnd, [1, 7777]) : 0 }, alvo);
  }
  if (alvo.tipo === 'VENDA') {
    let ids = d.animais.map((a) => a.animal_id);
    if (ids.length > 1 && rnd() < 0.4) ids = ids.slice(0, ids.length - 1);
    return propVenda(M, amb, D, ids, negocioVenda(rnd, ids.length), rnd, alvo);
  }
  if (alvo.tipo === 'COMPRA') {
    const novos = alvo.dados.animais.filter((a) => !a.animal_id || alvo.criados.includes(a.animal_id)).map((a) => ({ brinco: a.brinco, sexo: a.sexo, id: a.animal_id || null }));
    const criados = alvo.criados.slice();
    const comId = novos.map((n, i) => Object.assign(n, { id: n.id || criados[i] }));
    const voltas = alvo.dados.animais.filter((a) => a.animal_id && !alvo.criados.includes(a.animal_id)).map((a) => a.animal_id);
    let ficam = comId;
    if (comId.length > 1 && rnd() < 0.4) ficam = comId.slice(1);
    return propCompra(M, amb, D, sorteio(rnd, USO), ficam, voltas, negocioCompra(rnd, ficam.length + voltas.length), rnd, alvo);
  }
  // NASCIMENTO: a cria viva vira natimorta, ou entra mais uma.
  const crias = alvo.crias.map((x) => Object.assign({}, x));
  const vivas = crias.filter((x) => x.situacao === 'VIVO');
  if (rnd() < 0.5 && vivas.length) { const v = sorteio(rnd, vivas); v.situacao = 'NATIMORTO'; } else if (crias.length < 3) crias.push({ situacao: 'VIVO', sexo: 'F', brinco: 'R' + (++M.brinco) });
  return propNascimento(M, D, alvo.dados.animais[0].animal_id, crias, null, alvo);
}
/** As crias vivas guardam o id para a correção; o nascimento proposto que não vingou é descartado. */
function depoisDoComando(M, p, ok) {
  M.animais.forEach((a) => { if (ok && a.nascProposto) a.nasc = a.nascProposto; delete a.nascProposto; });
  if (!ok || !p.novo || p.novo.tipo !== 'NASCIMENTO') return;
  p.novo.crias.forEach((x) => { if (x.situacao === 'VIVO' && !x.id) { const n = p.novos.find((y) => y.brinco === x.brinco); if (n) x.id = n.id; } });
}

function sequencia(semente, passos, opcoes) {
  const amb = ambiente(opcoes);
  const M = criarModelo();
  rebanhoInicial(amb, M);
  conferirTudo(amb, M, 'rebanho inicial');
  const rnd = A.aleatorio(semente);
  let chave = null;
  let recusado = false;
  for (let k = 0; k < passos; k++) {
    const p = gerar(M, amb, rnd);
    if (!p) continue;
    const msg = 'semente ' + semente + ', passo ' + k;
    // A chave de um comando recusado não é consumida: o próximo comando a reaproveita.
    chave = recusado ? chave : 'k-' + semente + '-' + k;
    const ex = executar(amb, M, p, msg, { chave, rnd });
    recusado = !ex.ev;
    depoisDoComando(M, p, !!ex.ev);
    const data = p.novo ? p.novo.data : p.alvo.data;
    conferirTudo(amb, M, msg, [data, somaDias(data, -1), dataAleatoria(rnd)]);
  }
  return M;
}

// ------------------------------------------------------------------ sequências aleatórias ----
test('sequências aleatórias (semente fixa): cada comando aceito ou recusado como o modelo prevê (no CONFLICT, os mesmos eventos que impedem); depois de cada um, modelo = replay cru = sistema no inventário de várias datas, na ficha e nas alocações, e as invariantes de 03b, seção 14 fecham', () => {
  const total = {};
  for (const semente of [20261113, 7, 4242]) {
    const M = sequencia(semente, 140);
    Object.keys(M.stats).forEach((t) => {
      total[t] = total[t] || { OK: 0, VALIDATION: 0, CONFLICT: 0 };
      ['OK', 'VALIDATION', 'CONFLICT'].forEach((c) => { total[t][c] += M.stats[t][c]; });
    });
  }
  // O gerador exercitou cada tipo aceito e recusado, e conflitos de verdade (retroativos, estornos e correções com dependentes).
  ['TRANSFERENCIA', 'VENDA', 'MORTE', 'DESCARTE', 'AJUSTE_INVENTARIO', 'COMPRA', 'NASCIMENTO', 'IDENTIFICACAO', 'MARCACAO', 'OUTRA_ENTRADA', 'ESTORNO', 'TRANSFERENCIA/corrigir', 'VENDA/corrigir', 'COMPRA/corrigir', 'NASCIMENTO/corrigir'].forEach((t) => {
    assert.ok(total[t] && total[t].OK > 0, t + ' aceito ao menos uma vez: ' + JSON.stringify(total[t]));
  });
  const conflitos = Object.keys(total).reduce((s, t) => s + total[t].CONFLICT, 0);
  const recusas = Object.keys(total).reduce((s, t) => s + total[t].VALIDATION, 0);
  assert.ok(conflitos >= 20 && recusas >= 40, 'conflitos ' + conflitos + ', recusas ' + recusas + ': ' + JSON.stringify(total));
});

module.exports = { ambiente, criarModelo, rebanhoInicial, executar, conferirTudo, propTransferencia, propSaida, propCompra, propVenda, propNascimento, propIdentificacao, propMarcacao, propVolta, propEstorno, depoisDoComando, maiorResto, invariantesCruas, cru, D0, HOJE, AVISOS, js, codigos, PASTOS };
