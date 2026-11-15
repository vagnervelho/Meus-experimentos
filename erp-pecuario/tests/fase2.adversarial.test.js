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
const O = require('./apoio-oraculos');

const { js, PASTOS, bicho, entradaInicial, codigos } = C;
const D0 = '2026-01-01';
const HOJE = '2026-11-13';
const DIAS = 316; // de D0 a HOJE
const AVISOS = ['POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'BRINCO_PARECIDO', 'IDADE_REPRODUTIVA', 'INTERVALO_PARTO_CURTO', 'VALOR_DIVERGENTE', 'RATEIO_SEM_PESO'];
const USO = [PASTOS.A, PASTOS.B, PASTOS.C];
const { ABAS_CRU, cmp, soma, agrupar, cru, classe, ordenar, replayCru, inventarioDe, situacaoDe, invariantesCruas, maiorResto } = O;

function somaDias(d, n) {
  const t = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function ambiente(opcoes) {
  const c = C.ambienteCadastros(opcoes);
  const m = c.m;
  const parceiro = (nome, tipos) => c.run('Config.comandoSalvarParceiro', { campos: { nome, tipos } }).dados.partner_id;
  const P = { fornecedor: parceiro('Fornecedor F1', 'FORNECEDOR'), comprador: parceiro('Frigorífico C1', 'COMPRADOR'), transportador: parceiro('Transportes T1', 'TRANSPORTADOR') };
  const custeio = m.linhas.PLANO_CONTAS.find((x) => x.codigo === 'SERVICOS_VETERINARIOS').conta_id;
  return { c, m, G: c.G, P, custeio };
}

// ------------------------------------------------------------------ oráculo 2: o modelo de referência ----
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
/**
 * Onde o animal está na POSIÇÃO de uma linha de movimento do dia D (desenho-base 16.1): depois das entradas de D e dos
 * movimentos de D que vêm antes dela na ordem canônica (raiz, sequência); as saídas de D vêm depois.
 */
function pastoNaPosicao(M, id, D, raiz, seq, excl) {
  const antes = linhasDe(M, id, excl).filter((l) => !l.fato && (l.data < D || (l.data === D && (classe(l) === 0 || (classe(l) === 1 && (l.raiz < raiz || (l.raiz === raiz && l.seq < seq)))))));
  let s2 = 0;
  let p = null;
  ordenar(antes).forEach((l) => { s2 += l.efeito; if (l.destino) p = l.destino; if (l.efeito === -1) p = null; });
  return s2 >= 1 ? { presente: true, pasto: p } : { presente: false, pasto: null };
}
/** AJUSTE_INVENTARIO/CORRECAO_LOCALIZACAO: o animal estava em outro pasto; a origem é a da linha do tempo na posição. */
function propLocalizacao(M, data, id, destino, origemInformada, substitui) {
  const excl = new Set(substitui ? [substitui.id] : []);
  const pre = [];
  sujeitos(M, [id], excl, pre);
  const novo = novoEvento(M, 'AJUSTE_INVENTARIO', data, { sub: 'CORRECAO_LOCALIZACAO', raiz: substitui ? substitui.raiz : M.seq + 1 });
  const onde = pastoNaPosicao(M, id, data, novo.raiz, novo.seq, excl);
  if (!pre.length) {
    if (!onde.presente) pre.push('FORA_DO_REBANHO');
    else if (origemInformada && origemInformada !== onde.pasto) pre.push('ORIGEM_DIVERGENTE');
    else if (destino === onde.pasto) pre.push('VALOR_IGUAL');
  }
  novo.linhas.push({ animal: id, efeito: 0, origem: onde.pasto, destino });
  novo.dados = { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_LOCALIZACAO', campos: { event_date: data, justificativa: 'Achado em outro pasto na conferência' }, animais: [Object.assign({ animal_id: id, pasto_destino_id: destino }, origemInformada ? { pasto_origem_id: origemInformada } : {})] };
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

/**
 * As outras consultas que reproduzem a linha do tempo (painel de cada pasto em várias datas, cartões dos pastos e
 * visão geral de hoje, carga inicial dos animais) dizem o mesmo que o replay cru.
 */
function conferirConsultas(amb, M, msg) {
  const { m, G } = amb;
  const R = replayCru(cru(m));
  const datas = [D0, HOJE];
  for (let k = 30; k < DIAS; k += 45) datas.push(somaDias(D0, k));
  M.eventos.slice(-4).forEach((e) => { if (e.data >= D0) datas.push(e.data); });
  Array.from(new Set(datas)).forEach((D) => {
    const rep = inventarioDe(R.linhas, D);
    USO.forEach((p) => assert.equal(m.ler(G.PastureService.consultaPainel({ pasture_id: p, data: D })).cabecas, rep.porPasto[p] || 0, msg + ': painel do pasto em ' + D));
  });
  const hoje = inventarioDe(R.linhas, HOJE);
  m.ler(G.PastureService.consultaListar({})).forEach((c2) => assert.equal(c2.cabecas, hoje.porPasto[c2.pasture_id] || 0, msg + ': cartão do pasto ' + c2.nome));
  assert.equal(m.ler(G.InventoryService.consultaVisaoGeral()).cabecas, hoje.total, msg + ': visão geral');
  const carga = m.ler(G.AnimalService.consultaCargaInicial());
  const ativos = [];
  M.animais.forEach((a, id) => { if (situacaoDe(linhasDe(M, id)).situacao === 'ATIVO') ativos.push(id); });
  const daCarga = carga.valores.animal_id.filter((id, i) => carga.valores.situacao_cadastral[i] === 'ATIVO');
  assert.deepEqual(daCarga.sort(), ativos.sort(), msg + ': carga inicial (ativos)');
  daCarga.forEach((id) => {
    const i = carga.valores.animal_id.indexOf(id);
    assert.equal(carga.valores.pasto_atual_id[i], situacaoDe(linhasDe(M, id)).pasto, msg + ': pasto na carga inicial');
  });
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
    if (rnd() < 0.4) {
      const id = sorteio(rnd, ids);
      const onde = antesDaSaida(linhasDe(M, id), D).pasto;
      return propLocalizacao(M, D, id, sorteio(rnd, USO.filter((p) => p !== onde)), rnd() < 0.3 ? sorteio(rnd, USO) : null);
    }
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
  if (alvo.tipo === 'AJUSTE_INVENTARIO' && alvo.sub === 'CORRECAO_LOCALIZACAO') {
    const it = d.animais[0];
    return propLocalizacao(M, D, it.animal_id, rnd() < 0.5 ? it.pasto_destino_id : sorteio(rnd, USO), rnd() < 0.3 ? sorteio(rnd, USO) : null, alvo);
  }
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
  conferirConsultas(amb, M, 'semente ' + semente + ', fim');
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

// ------------------------------------------------------------------ casos dirigidos ----
/** Roda a proposta pelo oráculo do modelo, confere o desfecho que o caso espera e o estado inteiro depois. */
function passo(amb, M, p, esperado, rotulo) {
  const ex = executar(amb, M, p, rotulo);
  assert.equal(ex.prev.cat, esperado, rotulo + ': o modelo concorda com o caso');
  depoisDoComando(M, p, !!ex.ev);
  const data = p.novo ? p.novo.data : p.alvo.data;
  conferirTudo(amb, M, rotulo, [data, somaDias(data, -1)]);
  return ex;
}
function preparar() {
  const amb = ambiente();
  const M = criarModelo();
  const ids = rebanhoInicial(amb, M);
  return { amb, M, ids, m: amb.m, G: amb.G };
}
const CABECA = (preco, parcelas) => ({ modalidade: 'CABECA', preco, parcelas: parcelas || { n: 1, modo: 'vazias' } });
const novosAnimais = (M, n, sexo) => Array.from({ length: n }, () => ({ brinco: 'R' + (++M.brinco), sexo: sexo || 'M' }));
const elegiveis = (amb, tipo, data, pasto) => amb.m.ler(amb.G.InventoryService.consultaElegiveis({ tipo, data, pasture_id: pasto || null })).itens.map((x) => x.animal_id);

test('fato no dia da saída (RN-017): a vaca que morre no parto tem o parto aceito no dia da morte e aparece entre os elegíveis ao parto nessa data; o vendido no dia pode ser identificado e marcado nesse dia — e os elegíveis dizem o mesmo; movimento e saída continuam pelo fim do dia', () => {
  const { amb, M, ids } = preparar();
  const vaca = ids.I10; // Pasto A
  const D = '2026-06-10';
  passo(amb, M, propSaida(M, amb, 'MORTE', D, [vaca], {}), 'OK', 'morte da vaca no parto');
  assert.ok(elegiveis(amb, 'NASCIMENTO', D).includes(vaca), 'a vaca que morreu no dia do parto é elegível ao parto desse dia');
  assert.ok(!elegiveis(amb, 'NASCIMENTO', somaDias(D, 1)).includes(vaca), 'no dia seguinte, não');
  assert.ok(!elegiveis(amb, 'TRANSFERENCIA', D).includes(vaca) && !elegiveis(amb, 'MORTE', D).includes(vaca), 'transferência e morte: quem saiu no dia já não é elegível');
  const parto = passo(amb, M, propNascimento(M, D, vaca, [{ situacao: 'VIVO', sexo: 'F', brinco: 'R900' }], null), 'OK', 'parto no dia da morte');
  const cria = M.animais.get(parto.ev.criados[0]);
  assert.equal(amb.m.animal(cria.id).pasto_atual_id, PASTOS.A, 'a cria nasce no pasto em que a mãe estava antes de morrer');
  // O vendido no dia: identificação e marcação nesse dia são aceitas e os elegíveis (no pasto do dia) o mostram.
  const boi = ids.I16; // Pasto A
  passo(amb, M, propVenda(M, amb, D, [boi], CABECA(300000), null), 'OK', 'venda do boi');
  assert.ok(elegiveis(amb, 'IDENTIFICACAO', D, PASTOS.A).includes(boi) && elegiveis(amb, 'MARCACAO', D).includes(boi), 'o vendido no dia é elegível à identificação e à marcação desse dia');
  assert.ok(!elegiveis(amb, 'VENDA', D, PASTOS.A).includes(boi), 'mas não a outra venda');
  passo(amb, M, propIdentificacao(M, 'SUBSTITUICAO', D, boi, 'R901'), 'OK', 'troca de brinco no dia da venda');
  passo(amb, M, propMarcacao(M, 'DESCARTE', true, D, boi), 'OK', 'marcação no dia da venda');
  passo(amb, M, propIdentificacao(M, 'REMOCAO', somaDias(D, 1), boi, null), 'VALIDATION', 'retirada no dia seguinte');
});

test('mesmo dia com as classes 0, 1 e 2: compra, transferência, parto, venda e morte no mesmo dia; o que entra depois na ordem canônica quebra quem já estava gravado (CONFLICT) e venda com recompra no mesmo dia não cabe', () => {
  const { amb, M, ids } = preparar();
  const D = '2026-05-10';
  const [n1] = novosAnimais(M, 1);
  const c = passo(amb, M, propCompra(M, amb, D, PASTOS.A, [n1], [], CABECA(250000), null), 'OK', 'compra (classe 0)');
  const boi = ids.I16; // Pasto A
  const t = passo(amb, M, propTransferencia(M, D, PASTOS.A, PASTOS.B, [n1.id, boi]), 'OK', 'transferência A → B no dia (classe 1)');
  const v = passo(amb, M, propVenda(M, amb, D, [n1.id], CABECA(260000), null), 'OK', 'venda no dia (classe 2), da origem B');
  assert.equal(amb.m.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === v.ev.id).pasto_origem_id, PASTOS.B, 'a origem da venda é o pasto depois da transferência do dia');
  const vaca = ids.I10;
  passo(amb, M, propNascimento(M, D, vaca, [{ situacao: 'VIVO', sexo: 'M', brinco: 'R910' }, { situacao: 'NATIMORTO' }], null), 'OK', 'parto no dia');
  const mt = passo(amb, M, propSaida(M, amb, 'MORTE', D, [vaca], {}), 'OK', 'morte da vaca no dia, depois do parto');
  // Inventário do dia: o novilho entrou e saiu; o boi está em B; a vaca saiu; a cria entrou em A.
  const inv = amb.m.inventario(D);
  const antes = amb.m.inventario(somaDias(D, -1));
  assert.deepEqual([inv.total - antes.total, inv.porPasto[PASTOS.B] - (antes.porPasto[PASTOS.B] || 0)], [0, 1], 'entra a cria, sai a vaca; o novilho entra e sai no mesmo dia');
  // Transferência da vaca no dia, lançada depois da morte: classe 1, antes da saída → a morte perde a origem → CONFLICT com ela.
  const tx = passo(amb, M, propTransferencia(M, D, PASTOS.A, PASTOS.C, [vaca]), 'CONFLICT', 'transferência da morta no mesmo dia');
  assert.deepEqual(Array.from(tx.prev.outros), [mt.ev.id]);
  // Recompra no dia da venda: a entrada vem antes da saída no mesmo dia (sem hora) → ENTRADA_JA_DENTRO na própria linha.
  const rc = passo(amb, M, propCompra(M, amb, D, PASTOS.A, [], [n1.id], CABECA(260000), null), 'VALIDATION', 'recompra no dia da venda');
  assert.deepEqual(codigos(rc.r.erro), ['ENTRADA_JA_DENTRO']);
  const rc2 = passo(amb, M, propCompra(M, amb, somaDias(D, 1), PASTOS.A, [], [n1.id], CABECA(260000), null), 'OK', 'recompra no dia seguinte');
  // Estornos na ordem errada: cada um diz qual evento impede.
  assert.deepEqual(Array.from(passo(amb, M, propEstorno(M, t.ev), 'CONFLICT', 'estorno da transferência com a venda de B').prev.outros), [v.ev.id]);
  const ec = passo(amb, M, propEstorno(M, c.ev), 'CONFLICT', 'estorno da compra com transferência e venda');
  assert.deepEqual(Array.from(ec.prev.outros).sort(), [t.ev.id, v.ev.id, rc2.ev.id].sort(), 'a transferência, a venda e a recompra dependem da compra');
  passo(amb, M, propEstorno(M, v.ev), 'CONFLICT', 'estorno da venda com a recompra posterior');
});

test('substituição em cadeia: duas transferências do mesmo animal no mesmo dia; a correção da primeira fica no lugar dela (antes da segunda, desenho-base 16.1) em toda a cadeia; estornar o último da cadeia não ressuscita os anteriores; compra corrigida duas vezes cancela cada lançamento por quem o substituiu', () => {
  const { amb, M, ids } = preparar();
  const x = ids.I16; // Pasto A
  const D = '2026-04-20';
  const t1 = passo(amb, M, propTransferencia(M, D, PASTOS.A, PASTOS.B, [x]), 'OK', 'T1 A → B');
  const t2 = passo(amb, M, propTransferencia(M, D, PASTOS.B, PASTOS.C, [x]), 'OK', 'T2 B → C no mesmo dia');
  // Corrigir T1 para A → C: no lugar de T1, deixa T2 partindo de B sem o animal lá → CONFLICT com T2.
  assert.deepEqual(Array.from(passo(amb, M, propTransferencia(M, D, PASTOS.A, PASTOS.C, [x], t1.ev), 'CONFLICT', 'T1 corrigida para A → C').prev.outros), [t2.ev.id]);
  const t1b = passo(amb, M, propTransferencia(M, somaDias(D, -5), PASTOS.A, PASTOS.B, [x], t1.ev), 'OK', 'T1 corrigida para 5 dias antes');
  const t1c = passo(amb, M, propTransferencia(M, D, PASTOS.A, PASTOS.B, [x], t1b.ev), 'OK', 'T1 corrigida de novo para o dia D');
  assert.equal(t1c.ev.raiz, t1.ev.raiz, 'a cadeia guarda a posição do primeiro');
  assert.deepEqual(Array.from(passo(amb, M, propEstorno(M, t1c.ev), 'CONFLICT', 'estorno do fim da cadeia com T2 dependente').prev.outros), [t2.ev.id]);
  passo(amb, M, propEstorno(M, t2.ev), 'OK', 'estorno de T2');
  passo(amb, M, propEstorno(M, t1c.ev), 'OK', 'estorno do fim da cadeia');
  assert.equal(amb.m.animal(x).pasto_atual_id, PASTOS.A, 'sem ressurreição: nenhuma das versões de T1 vale');
  passo(amb, M, propEstorno(M, t1b.ev), 'VALIDATION', 'estornar um elo do meio');
  // Compra corrigida duas vezes (valor e frete), com os mesmos animal_id.
  const nv = novosAnimais(M, 3);
  const c1 = passo(amb, M, propCompra(M, amb, '2026-03-01', PASTOS.C, nv, [], Object.assign(CABECA(100000), { frete: 3000 }), null), 'OK', 'C1');
  const mesmos = () => nv.map((n) => ({ brinco: n.brinco, sexo: n.sexo, id: n.id }));
  const c2 = passo(amb, M, propCompra(M, amb, '2026-03-01', PASTOS.C, mesmos(), [], Object.assign(CABECA(110000), { frete: 3000 }), null, c1.ev), 'OK', 'C2 corrige o preço');
  const c3 = passo(amb, M, propCompra(M, amb, '2026-03-01', PASTOS.C, mesmos(), [], Object.assign(CABECA(110000), { frete: 1 }), null, c2.ev), 'OK', 'C3 corrige o frete para 1 centavo');
  assert.deepEqual(nv.map((n) => amb.m.animal(n.id).custo_aquisicao), [330000 / 3 + 1, 330000 / 3, 330000 / 3], 'custo = 1.100,00 + o centavo do frete para o menor código');
  const por = (ev) => amb.m.tabela('FINANCEIRO').filter((f) => f.event_id === ev.id).map((f) => [f.status, f.cancelado_por_event_id]);
  assert.deepEqual([por(c1.ev), por(c2.ev), por(c3.ev)], [[['CANCELADO', c2.ev.id], ['CANCELADO', c2.ev.id]], [['CANCELADO', c3.ev.id], ['CANCELADO', c3.ev.id]], [['ATIVO', null], ['ATIVO', null]]]);
  const e3 = passo(amb, M, propEstorno(M, c3.ev), 'OK', 'estorno de C3');
  assert.deepEqual(nv.map((n) => amb.m.animal(n.id).situacao_cadastral), ['ANULADO', 'ANULADO', 'ANULADO']);
  assert.deepEqual(por(c3.ev), [['CANCELADO', e3.ev.id], ['CANCELADO', e3.ev.id]]);
});

test('estorno de compra com venda posterior: CONFLICT com a venda; a correção de valor passa (não é estrutural) e muda o custo dos vendidos; tirar da compra um animal vendido é CONFLICT, tirar o que ficou o anula; depois da venda estornada a compra se estorna', () => {
  const { amb, M } = preparar();
  const nv = novosAnimais(M, 3);
  const c = passo(amb, M, propCompra(M, amb, '2026-02-10', PASTOS.B, nv, [], CABECA(200000, { n: 2, modo: 'vazias' }), null), 'OK', 'compra de 3');
  const v = passo(amb, M, propVenda(M, amb, '2026-08-01', [nv[0].id, nv[1].id], CABECA(310000, { n: 1, modo: 'explicitas' }), null), 'OK', 'venda de 2');
  assert.deepEqual(Array.from(passo(amb, M, propEstorno(M, c.ev), 'CONFLICT', 'estorno da compra').prev.outros), [v.ev.id]);
  const mesmos = (lista) => lista.map((n) => ({ brinco: n.brinco, sexo: n.sexo, id: n.id }));
  const c2 = passo(amb, M, propCompra(M, amb, '2026-02-10', PASTOS.B, mesmos(nv), [], CABECA(210000, { n: 3, modo: 'vazias' }), null, c.ev), 'OK', 'correção do preço');
  assert.deepEqual(nv.map((n) => amb.m.animal(n.id).custo_aquisicao), [210000, 210000, 210000], 'o custo dos vendidos acompanha a correção');
  assert.deepEqual(Array.from(passo(amb, M, propCompra(M, amb, '2026-02-10', PASTOS.B, mesmos(nv.slice(1)), [], CABECA(210000), null, c2.ev), 'CONFLICT', 'tirar da compra um vendido').prev.outros), [v.ev.id]);
  const c3 = passo(amb, M, propCompra(M, amb, '2026-02-10', PASTOS.B, mesmos(nv.slice(0, 2)), [], CABECA(210000), null, c2.ev), 'OK', 'tirar da compra o que ficou');
  assert.equal(amb.m.animal(nv[2].id).situacao_cadastral, 'ANULADO');
  passo(amb, M, propCompra(M, amb, '2026-09-01', PASTOS.B, mesmos(nv.slice(0, 2)), [], CABECA(210000), null, c3.ev), 'CONFLICT', 'a compra corrigida para depois da venda');
  passo(amb, M, propEstorno(M, v.ev), 'OK', 'estorno da venda');
  passo(amb, M, propEstorno(M, c3.ev), 'OK', 'estorno da compra');
  assert.deepEqual(amb.m.tabela('FINANCEIRO').filter((f) => f.status === 'ATIVO').length, 0, 'nenhum lançamento vale');
});

test('gêmeos com um natimorto: o parto grava 1 vivo e 1 natimorto; a correção faz nascer o segundo; a cria que morreu não pode virar natimorta nem o parto ser estornado; estornada a morte, o parto se estorna e a mãe volta ao que era', () => {
  const { amb, M, ids, m } = preparar();
  const vaca = ids.I11; // Pasto B
  const antes = m.animal(vaca);
  const crias = [{ situacao: 'VIVO', sexo: 'F', brinco: 'R920' }, { situacao: 'NATIMORTO' }];
  const p1 = passo(amb, M, propNascimento(M, '2026-07-01', vaca, crias, null), 'OK', 'parto de gêmeos, um natimorto');
  const rep = m.tabela('REPRODUCAO').find((r) => r.event_id === p1.ev.id);
  assert.deepEqual([rep.tipo_evento, rep.qtd_nascidos_vivos, rep.qtd_natimortos], ['PARTO', 1, 1]);
  assert.deepEqual([m.animal(vaca).cria_ao_pe, m.animal(vaca).situacao_reprodutiva], [true, 'VAZIA']);
  const segunda = { situacao: 'VIVO', sexo: 'M', brinco: 'R921' };
  const p2 = passo(amb, M, propNascimento(M, '2026-07-01', vaca, [Object.assign({}, p1.ev.crias[0]), segunda], null, p1.ev), 'OK', 'correção: o segundo nasceu vivo');
  const [f1, f2] = p2.ev.crias.map((x) => x.id);
  assert.equal(f1, p1.ev.crias[0].id, 'a cria viva do original é a mesma');
  assert.equal(m.tabela('REPRODUCAO').find((r) => r.event_id === p2.ev.id).qtd_nascidos_vivos, 2);
  const morte = passo(amb, M, propSaida(M, amb, 'MORTE', '2026-07-03', [f2], {}), 'OK', 'morte do segundo');
  assert.deepEqual(Array.from(passo(amb, M, propNascimento(M, '2026-07-01', vaca, [Object.assign({}, p2.ev.crias[0]), { situacao: 'NATIMORTO' }], null, p2.ev), 'CONFLICT', 'a cria que morreu vira natimorta').prev.outros), [morte.ev.id]);
  assert.deepEqual(Array.from(passo(amb, M, propEstorno(M, p2.ev), 'CONFLICT', 'estorno do parto com a morte da cria').prev.outros), [morte.ev.id]);
  passo(amb, M, propEstorno(M, morte.ev), 'OK', 'estorno da morte');
  passo(amb, M, propEstorno(M, p2.ev), 'OK', 'estorno do parto');
  assert.deepEqual([f1, f2].map((id) => m.animal(id).situacao_cadastral), ['ANULADO', 'ANULADO']);
  assert.deepEqual([m.animal(vaca).cria_ao_pe, m.animal(vaca).situacao_reprodutiva, m.animal(vaca).partos_previos], [antes.cria_ao_pe, antes.situacao_reprodutiva, antes.partos_previos], 'a mãe volta ao que era');
  assert.equal(m.tabela('REPRODUCAO').filter((r) => r.animal_id === vaca).length, 2, 'nada se apaga: as linhas dos dois partos ficam, anuladas');
});

test('correção de localização: a origem é a da linha do tempo na POSIÇÃO do lançamento (desenho-base 16.1) — corrigir a correção mantém o lugar dela antes de uma transferência posterior do mesmo dia; no dia da venda, o problema é da venda (CONFLICT), não "fora do rebanho"', () => {
  const { amb, M, ids } = preparar();
  const x = ids.I10; // Pasto A
  const D = '2026-04-10';
  const cl = passo(amb, M, propLocalizacao(M, D, x, PASTOS.B, null), 'OK', 'correção de localização A → B');
  const t = passo(amb, M, propTransferencia(M, D, PASTOS.B, PASTOS.C, [x]), 'OK', 'transferência B → C no mesmo dia, depois');
  const k1 = passo(amb, M, propLocalizacao(M, D, x, PASTOS.B, null, cl.ev), 'OK', 'corrigir a correção sem mudar nada (só a justificativa)');
  const k2 = passo(amb, M, propLocalizacao(M, D, x, PASTOS.B, PASTOS.A, k1.ev), 'OK', 'corrigir informando a origem certa (A)');
  assert.equal(amb.m.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === k2.ev.id).pasto_origem_id, PASTOS.A, 'a origem gravada é a da posição, não a do fim do dia');
  passo(amb, M, propLocalizacao(M, D, x, PASTOS.B, PASTOS.C, k2.ev), 'VALIDATION', 'origem informada errada');
  assert.deepEqual(Array.from(passo(amb, M, propLocalizacao(M, D, x, PASTOS.C, null, k2.ev), 'CONFLICT', 'corrigir o destino para C quebra a transferência B → C').prev.outros), [t.ev.id]);
  assert.equal(amb.m.animal(x).pasto_atual_id, PASTOS.C);
  // No dia da venda: a correção de localização vem antes da saída e deixa a venda sem origem → CONFLICT com a venda.
  const boi = ids.I16; // Pasto A
  const v = passo(amb, M, propVenda(M, amb, '2026-05-01', [boi], CABECA(300000), null), 'OK', 'venda do boi');
  assert.deepEqual(Array.from(passo(amb, M, propLocalizacao(M, '2026-05-01', boi, PASTOS.B, null), 'CONFLICT', 'correção de localização no dia da venda').prev.outros), [v.ev.id]);
  passo(amb, M, propLocalizacao(M, '2026-05-02', boi, PASTOS.B, null), 'VALIDATION', 'no dia seguinte à venda, fora do rebanho');
  conferirConsultas(amb, M, 'correção de localização');
});

/** Ambiente sem o modelo, para negociações que o modelo não cobre (arroba, lote, peso só do lote): 3 bois no marco zero. */
function direto() {
  const amb = ambiente();
  const m = amb.m;
  const r = m.run('registrar', entradaInicial(['B1', 'B2', 'B3'].map((b) => bicho({ brinco: b, sexo: 'M', castrado: true, reprodutor: false, data_nascimento: '2023-01-01', data_nascimento_confianca: 'ESTIMADA' }))));
  const ok = (rr, msg) => { assert.equal(rr.ok, true, msg + ': ' + (rr.erro && rr.erro.message + ' ' + JSON.stringify(rr.erro.details))); return rr.valor; };
  const invariantes = (msg) => assert.deepEqual(invariantesCruas(cru(m)), [], msg + ': invariantes de 03b, seção 14 (cruas)');
  return { amb, m, ids: r.dados.animais.map((a) => a.animal_id), ok, invariantes };
}
const garrote = (brinco, extra) => Object.assign({ brinco, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 }, extra || {});

test('rateio com centavos patológicos: 1 centavo para 3 animais e frete de 2 centavos pelo maior resto (o centavo para o menor código); receita de 1 centavo; base zero e base com casas demais dão UM erro, no campo do animal; peso faltando num animal é recusado; peso só do lote usa a pesagem anterior escalada', () => {
  const { amb, M, m } = preparar();
  const nv = novosAnimais(M, 3);
  const um = { modalidade: 'CABECA', preco: 1, valor: 1, frete: 2, parcelas: { n: 1, modo: 'vazias' } };
  passo(amb, M, propCompra(M, amb, '2026-02-01', PASTOS.A, nv, [], um, null), 'OK', 'compra de 1 centavo com frete de 2');
  const cods = nv.map((n) => M.animais.get(n.id).codigo);
  assert.deepEqual(cods.slice().sort(), cods, 'os códigos crescem na ordem do lançamento');
  assert.deepEqual(nv.map((n) => [m.animal(n.id).custo_aquisicao, m.tabela('EVENTO_ANIMAIS').find((l) => l.animal_id === n.id).valor_individual]), [[2, 1], [1, 0], [0, 0]]);
  passo(amb, M, propCompra(M, amb, '2026-02-02', PASTOS.A, novosAnimais(M, 1), [], { modalidade: 'CABECA', preco: 2, parcelas: { n: 3, modo: 'vazias' } }, null), 'VALIDATION', '2 centavos em 3 parcelas sem valor');
  // Venda dos três por 2 centavos, com 1 de desconto: receita de 1 centavo; o comprador retém 1 (depósito zero) mas não 2.
  const ids = nv.map((n) => n.id);
  const v2 = { modalidade: 'CABECA', preco: 1, bruto: 2, desconto: 1, parcelas: { n: 1, modo: 'vazias' }, deducoes: [{ tipo: 'FUNRURAL', valor: 2, retida: true }] };
  const rr = passo(amb, M, propVenda(M, amb, '2026-03-01', ids, v2, null), 'VALIDATION', 'retenção maior que o recebimento');
  assert.deepEqual(codigos(rr.r.erro), ['RETENCAO_MAIOR_QUE_RECEBIMENTO']);
  const v = passo(amb, M, propVenda(M, amb, '2026-03-01', ids, Object.assign({}, v2, { deducoes: [{ tipo: 'FUNRURAL', valor: 1, retida: true }, { tipo: 'COMISSAO', valor: 2 }] }), null), 'OK', 'venda de 1 centavo de receita');
  const venda = m.tabela('VENDAS').find((x) => x.event_id === v.ev.id);
  assert.deepEqual([venda.valor_bruto, venda.desconto_comercial, venda.comissao, venda.outras_deducoes, venda.qtd_animais], [2, 1, 2, 1, 3]);
  // Base zero e base com casas demais: um erro só, no campo do animal (não no valor do lançamento).
  const d = direto();
  const F = d.amb.P.fornecedor;
  const lote = (bases, valor) => ({ tipo: 'COMPRA', campos: { event_date: '2026-02-03', partner_id: F, pasto_destino_id: PASTOS.A, modalidade: 'LOTE', criterio_rateio: 'MANUAL', justificativa_rateio: 'acordo com o vendedor', valor_animais: valor || 100000 }, animais: bases.map((b, i) => garrote('L' + i, { base_manual: b })), parcelas: [{ data_vencimento: '2026-03-03' }] });
  for (const [bases, codigo] of [[[0, 1], 'VALOR_FORA_DA_FAIXA'], [[-1, 1], 'VALOR_FORA_DA_FAIXA'], [[0.00005, 1], 'FORMATO_INVALIDO']]) {
    const e = d.m.tentar('registrar', lote(bases), { avisos: AVISOS }).erro;
    assert.deepEqual([e.code, e.details.map((x) => [x.codigo, x.campo, x.brinco])], ['VALIDATION', [[codigo, 'base_manual', 'L0']]], 'base ' + bases[0] + ': um erro só, no animal');
    assert.ok(!/0\.0/.test(e.details[0].mensagem) && !/casa decimal\./.test(e.details[0].mensagem), 'mensagem em português: ' + e.details[0].mensagem);
  }
  const fino = d.ok(d.m.tentar('registrar', lote([0.0001, 99.9999], 1), { avisos: AVISOS }), 'manual de 1 centavo com bases de 4 casas');
  d.invariantes('manual de 1 centavo');
  assert.deepEqual(d.m.tabela('ALOCACOES_FINANCEIRAS').filter((x) => fino.dados.animais.some((a) => a.animal_id === x.animal_id)).map((x) => [x.base_valor, x.valor_alocado]), [[0.0001, 0], [99.9999, 1]]);
  // Peso faltando num animal: recusado (todos ou nenhum; sem os de todos, falta o total); só o peso do lote: a pesagem anterior de cada um, escalada.
  const pesos = [200.3, 250.1, 299.9];
  const comp = d.ok(d.m.tentar('registrar', { tipo: 'COMPRA', campos: { event_date: '2026-02-04', partner_id: F, pasto_destino_id: PASTOS.B, modalidade: 'KG_VIVO', preco_unitario: 1000, valor_animais: 750300 }, animais: pesos.map((p, i) => garrote('K' + i, { peso: p })), parcelas: [{ data_vencimento: '2026-03-04' }] }, { avisos: AVISOS }), 'compra por kg');
  const bois = comp.dados.animais.map((a) => a.animal_id);
  const venda2 = (animais, campos) => ({ tipo: 'VENDA', campos: Object.assign({ event_date: '2026-06-01', partner_id: d.amb.P.comprador, finalidade: 'RECRIA_ENGORDA', modalidade: 'KG_VIVO', preco_unitario: 1100, valor_bruto: 880000 }, campos || {}), animais, parcelas: [{ data_vencimento: '2026-07-01' }] });
  const inc = d.m.tentar('registrar', venda2([{ animal_id: bois[0], peso: 300 }, { animal_id: bois[1], peso: 250 }, { animal_id: bois[2] }]), { avisos: AVISOS }).erro;
  assert.deepEqual([inc.code, codigos(inc)], ['VALIDATION', ['PESO_INCOMPLETO', 'PESO_OBRIGATORIO']], 'peso de um só faltando');
  const semAceite = d.m.tentar('registrar', venda2(bois.map((animal_id) => ({ animal_id })), { peso_vivo_total_kg: 800 }), { avisos: [], chave: 'k-lote' });
  assert.deepEqual([semAceite.erro.code, codigos(semAceite.erro)], ['NEEDS_CONFIRMATION', ['RATEIO_SEM_PESO']]);
  const est = d.ok(d.m.tentar('registrar', venda2(bois.map((animal_id) => ({ animal_id })), { peso_vivo_total_kg: 800 }), { avisos: ['RATEIO_SEM_PESO'], chave: 'k-lote' }), 'com o aceite, a mesma chave');
  d.invariantes('venda com base estimada');
  const rat = d.m.tabela('RATEIOS').find((x) => x.event_id === est.dados.event_id && x.criterio === 'PESO_VIVO');
  assert.match(rat.justificativa, /^Base estimada: última pesagem de cada animal até 01\/06\/2026, ajustada ao peso vivo do lote \(800 kg\)\.$/);
  const somaP = pesos.reduce((a, b) => a + b, 0);
  const bases4 = pesos.map((p) => Math.round(p * 800 / somaP * 10000) / 10000);
  const alocs = d.m.tabela('ALOCACOES_FINANCEIRAS').filter((x) => x.rateio_id === rat.rateio_id);
  assert.deepEqual(alocs.map((x) => x.base_valor), bases4, 'base = pesagem × peso do lote ÷ Σ pesagens, com 4 casas');
  const esperado = maiorResto(880000, bois.map((id, i) => ({ animal: id, codigo: comp.dados.animais[i].codigo_interno, base: Math.round(bases4[i] * 10000) })));
  assert.deepEqual(alocs.map((x) => x.valor_alocado), bois.map((id) => esperado.get(id)), 'maior resto sobre as bases estimadas');
  assert.equal(d.m.tabela('PESAGENS').filter((x) => x.event_id === est.dados.event_id).length, 0, 'peso só do lote não vira pesagem');
});

test('arroba e carcaça com arredondamento: romaneio de 820,3 kg dá 54,69 @ e rendimento apurado de 52,1%; a conferência no limite da tolerância (1%) não avisa e 1 centavo acima avisa sem dizer "1% acima de 1%"; rendimento que arredonda para 100% ou 0% não é chamado de carcaça maior que o vivo; arroba de peso vivo a 50% (07, 4.3 c)', () => {
  const d = direto();
  const { m } = d;
  const venda = (bruto, animais, extra) => Object.assign({ tipo: 'VENDA', campos: { event_date: '2026-08-01', partner_id: d.amb.P.comprador, finalidade: 'ABATE', modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 32000, valor_bruto: bruto }, animais, parcelas: [{ data_vencimento: '2026-08-31' }] }, extra || {});
  const vivos = [540, 520, 515.5];
  const carcacas = [282.3, 271.1, 266.9];
  const lote = d.ids.map((id, i) => ({ animal_id: id, peso: vivos[i], peso_carcaca_kg: carcacas[i] }));
  const conf = Math.round(8203 * 32000 / 150);
  assert.equal(conf, 1749973);
  const noLimite = m.simular('registrar', venda(conf + Math.floor(conf / 100), lote));
  const v = noLimite.valor.dados.impactos.venda;
  assert.deepEqual([noLimite.valor.dados.avisos.length, v.arrobas, v.rendimento_pct, v.arroba_base, v.conferencia, v.peso_carcaca_total, v.peso_vivo_total], [0, 54.69, 52.1, 'CARCACA', conf, 820.3, 1575.5]);
  const acima = m.tentar('registrar', venda(conf + Math.floor(conf / 100) + 1, lote), { avisos: [] }).erro;
  assert.equal(acima.code, 'NEEDS_CONFIRMATION');
  assert.match(acima.details[0].mensagem, /difere em mais de 1% da conta pela negociação \(R\$ 17\.499,73\), acima da tolerância de 1%/);
  const r = d.ok(m.tentar('registrar', venda(conf, lote), { avisos: AVISOS }), 'venda pelo romaneio');
  d.invariantes('venda por arroba de carcaça');
  const vd = m.tabela('VENDAS').find((x) => x.event_id === r.dados.event_id);
  assert.deepEqual([vd.rendimento_carcaca_pct, vd.rendimento_tipo, vd.peso_carcaca_total_kg, vd.criterio_rateio], [52.1, 'APURADO', 820.3, 'PESO_CARCACA']);
  const fin = m.tabela('FINANCEIRO').find((x) => x.event_id === r.dados.event_id);
  const al = m.tabela('ALOCACOES_FINANCEIRAS').filter((x) => x.financial_id === fin.financial_id);
  const esperado = maiorResto(conf, d.ids.map((id, i) => ({ animal: id, codigo: 'A-00000' + (i + 1), base: Math.round(carcacas[i] * 10) })));
  assert.deepEqual(al.map((x) => x.valor_alocado), d.ids.map((id) => esperado.get(id)), 'receita pela carcaça de cada um, maior resto');
  assert.equal(m.tabela('PESAGENS').filter((x) => x.event_id === r.dados.event_id).map((x) => x.peso_kg).join(), vivos.join(), 'o peso vivo vira pesagem; a carcaça nunca');
  // Rendimento que arredonda para 100% ou para 0%: recusado, mas sem dizer que a carcaça passou do vivo.
  const d2 = direto();
  for (const [vivo, carc, txt] of [[1000, 999.6, '99,96%'], [1999.9, 0.5, '0,03%'], [500, 500, null]]) {
    const e = d2.m.tentar('registrar', venda(1000000, [{ animal_id: d2.ids[0], peso: vivo, peso_carcaca_kg: carc }]), { avisos: AVISOS }).erro;
    assert.equal(e.code, 'VALIDATION');
    if (txt) assert.ok(e.details.some((x) => x.mensagem.includes('rendimento de carcaça calculado (' + txt)) && !e.details.some((x) => /passar do peso vivo total/.test(x.mensagem)), txt + ': ' + JSON.stringify(e.details));
    else assert.deepEqual(codigos(e), ['CARCACA_MAIOR_QUE_VIVO', 'VALOR_FORA_DA_FAIXA'], 'carcaça igual ao vivo');
  }
  // Compra por arroba de peso vivo a 50% negociado (07, 4.3 c): 4.800,0 kg → 160 @ × R$ 300,00 = R$ 48.000,00; a nota de 48.150,00 vale (0,31%).
  const c = d2.ok(d2.m.tentar('registrar', { tipo: 'COMPRA', campos: { event_date: '2026-03-01', partner_id: d2.amb.P.fornecedor, pasto_destino_id: PASTOS.C, modalidade: 'ARROBA', base_peso: 'VIVO', rendimento_carcaca_pct: 50, rendimento_tipo: 'NEGOCIADO', preco_unitario: 30000, valor_animais: 4815000 }, animais: Array.from({ length: 20 }, (_, i) => garrote('G' + i, { peso: 240 })), parcelas: [{ data_vencimento: '2026-04-01' }] }, { avisos: [] }), 'compra por arroba viva');
  d2.invariantes('compra por arroba viva');
  const cp = d2.m.tabela('COMPRAS').find((x) => x.event_id === c.dados.event_id);
  assert.deepEqual([cp.rendimento_carcaca_pct, cp.rendimento_tipo, cp.peso_total_kg, cp.valor_animais, cp.criterio_rateio], [50, 'NEGOCIADO', 4800, 4815000, 'PESO_VIVO']);
  assert.deepEqual(d2.m.tabela('ANIMAIS').filter((a) => c.dados.animais.some((x) => x.animal_id === a.animal_id)).map((a) => a.custo_aquisicao).reduce((s2, x) => s2 + x, 0), 4815000, 'o custo do lote = a nota');
});

test('parcelas que diferem de 1 centavo: a soma 1 centavo acima ou abaixo é recusada; valor explícito com parcelas vazias divide o resto (sobra para as primeiras vazias); retida igual ao recebimento do dia passa (depósito zero), 1 centavo acima não; retida fora de um vencimento da venda é recusada', () => {
  const d = direto();
  const { m } = d;
  const F = d.amb.P.fornecedor;
  const compra = (parcelas, b) => ({ tipo: 'COMPRA', campos: { event_date: '2026-02-10', partner_id: F, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 10000, valor_animais: 10000 }, animais: [garrote(b)], parcelas });
  const p = (v, mes) => Object.assign({ data_vencimento: '2026-0' + mes + '-10' }, v === null ? {} : { valor: v });
  for (const lista of [[p(3333, 3), p(3333, 4), p(3333, 5)], [p(3334, 3), p(3333, 4), p(3334, 5)], [p(10001, 3)], [p(9999, 3)], [p(10000, 3), p(null, 4)]]) {
    const e = m.tentar('registrar', compra(lista, 'P1'), { avisos: AVISOS }).erro;
    assert.deepEqual([e.code, codigos(e)], ['VALIDATION', ['PARCELAS_NAO_SOMAM']], JSON.stringify(lista.map((x) => x.valor)));
  }
  const r = d.ok(m.tentar('registrar', compra([p(3333, 3), p(null, 4), p(null, 5)], 'P2'), { avisos: AVISOS }), 'explícita e vazias');
  const fin = m.tabela('FINANCEIRO').find((x) => x.event_id === r.dados.event_id);
  assert.deepEqual(m.tabela('PARCELAS').filter((x) => x.financial_id === fin.financial_id).map((x) => x.valor), [3333, 3334, 3333]);
  d.invariantes('parcelas');
  const vendaDe = (deducoes, parcelas) => ({ tipo: 'VENDA', campos: { event_date: '2026-05-01', partner_id: d.amb.P.comprador, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: d.ids[0] }], parcelas: parcelas || [p(100000, 6), p(200000, 7)], deducoes });
  const ret = (valor, venc) => Object.assign({ tipo: 'FUNRURAL', valor, retida_pelo_comprador: true }, venc ? { data_vencimento: venc } : {});
  assert.deepEqual(codigos(m.tentar('registrar', vendaDe([ret(100001)]), { avisos: AVISOS }).erro), ['RETENCAO_MAIOR_QUE_RECEBIMENTO']);
  assert.deepEqual(codigos(m.tentar('registrar', vendaDe([ret(1000, '2026-06-11')]), { avisos: AVISOS }).erro), ['RETIDA_FORA_DO_RECEBIMENTO']);
  assert.deepEqual(codigos(m.tentar('registrar', vendaDe([ret(100000), ret(1, '2026-06-10')]), { avisos: AVISOS }).erro), ['RETENCAO_MAIOR_QUE_RECEBIMENTO'], 'duas retenções no mesmo dia somam');
  const v = d.ok(m.tentar('registrar', vendaDe([ret(100000), ret(200000, '2026-07-10')]), { avisos: AVISOS }), 'retidas iguais aos recebimentos');
  d.invariantes('venda com retenção total');
  const sim = m.simular('registrar', vendaDe([ret(100000), ret(200000, '2026-07-10')]));
  assert.deepEqual([sim.ok, sim.erro.code, codigos(sim.erro)], [false, 'VALIDATION', ['FORA_DO_REBANHO']], 'a mesma venda já não cabe: o animal foi vendido');
  assert.equal(m.tabela('VENDAS').find((x) => x.event_id === v.dados.event_id).outras_deducoes, 300000, 'resultado da negociação zero, depósito zero: aceito');
});

test('reenvio com a mesma chave: mesmo conteúdo (chaves em outra ordem, vazio a mais, sem o aceite) → duplicado com a mesma resposta e nada gravado; conteúdo diferente, outra rota ou outra ação → IDEMPOTENCY_MISMATCH; aviso sem aceite e VALIDATION não consomem a chave', () => {
  const d = direto();
  const { m } = d;
  const vendaDe = (bruto, extra) => Object.assign({ tipo: 'VENDA', campos: { event_date: '2026-05-01', partner_id: d.amb.P.comprador, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: bruto }, animais: [{ animal_id: d.ids[0] }, { animal_id: d.ids[1] }], parcelas: [{ data_vencimento: '2026-06-01' }] }, extra || {});
  // Aviso sem aceite: nada gravado, a chave fica livre; o reenvio com o aceite grava uma vez.
  const antes = contagens(cru(m));
  const sem = m.tentar('registrar', vendaDe(610000), { avisos: [], chave: 'K1' });
  assert.deepEqual([sem.erro.code, codigos(sem.erro)], ['NEEDS_CONFIRMATION', ['VALOR_DIVERGENTE']]);
  assert.deepEqual(contagens(cru(m)), antes, 'nada gravado sem o aceite');
  const um = d.ok(m.tentar('registrar', vendaDe(610000), { avisos: ['VALOR_DIVERGENTE'], chave: 'K1' }), 'com o aceite');
  const depois = contagens(cru(m));
  // Mesmo conteúdo em outra forma: chaves em outra ordem e um campo vazio a mais (o hash é do JSON canônico).
  const d0 = vendaDe(610000);
  const reordenado = { parcelas: d0.parcelas, animais: d0.animais, campos: Object.assign({ notes: null, description: '' }, Object.keys(d0.campos).reverse().reduce((o, k) => { o[k] = d0.campos[k]; return o; }, {})), tipo: d0.tipo };
  for (const [dados, avisos] of [[d0, []], [reordenado, ['VALOR_DIVERGENTE']], [reordenado, []]]) {
    const dup = d.ok(m.tentar('registrar', dados, { avisos, chave: 'K1' }), 'reenvio');
    assert.deepEqual([dup.duplicado, dup.dados, dup.opId], [true, um.dados, um.opId], 'duplicado com a mesma resposta');
  }
  assert.deepEqual(contagens(cru(m)), depois, 'o duplicado não grava nada');
  // Conteúdo diferente, outra ação (estornar, corrigir) com a mesma chave: IDEMPOTENCY_MISMATCH, nada gravado.
  for (const [acao, dados] of [['registrar', vendaDe(610001)], ['registrar', Object.assign(vendaDe(610000), { deducoes: [{ tipo: 'COMISSAO', valor: 1 }] })], ['estornar', { event_id: um.dados.event_id, justificativa: 'errado' }], ['corrigir', Object.assign(vendaDe(610000), { event_id: um.dados.event_id, justificativa: 'errado' })]]) {
    const e = m.tentar(acao, dados, { avisos: AVISOS, chave: 'K1' }).erro;
    assert.equal(e && e.code, 'IDEMPOTENCY_MISMATCH', acao);
  }
  assert.deepEqual(contagens(cru(m)), depois, 'o IDEMPOTENCY_MISMATCH não grava nada');
  // VALIDATION não consome a chave: o comando certo com a mesma chave grava.
  const ruim = m.tentar('estornar', { event_id: um.dados.event_id }, { chave: 'K2' }).erro;
  assert.equal(ruim.code, 'VALIDATION', 'estorno sem justificativa');
  const est = d.ok(m.tentar('estornar', { event_id: um.dados.event_id, justificativa: 'comprador desistiu' }, { chave: 'K2' }), 'estorno com a chave da tentativa recusada');
  assert.equal(est.duplicado, false);
  // Depois do estorno, o reenvio da venda original com a sua chave continua duplicado (não grava a venda de novo).
  const dup = d.ok(m.tentar('registrar', d0, { avisos: [], chave: 'K1' }), 'reenvio depois do estorno');
  assert.deepEqual([dup.duplicado, dup.dados.event_id, dup.dados.status], [true, um.dados.event_id, 'ESTORNADO']);
  assert.deepEqual(m.tabela('ANIMAIS').filter((a) => d.ids.slice(0, 2).includes(a.animal_id)).map((a) => a.situacao_cadastral), ['ATIVO', 'ATIVO']);
  d.invariantes('depois do reenvio');
});

