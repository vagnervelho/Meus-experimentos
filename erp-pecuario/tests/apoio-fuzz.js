'use strict';
/**
 * Motor do teste aleatório de todos os comandos da Fase 2 (tests/fase2.fuzz.test.js e fase2.fuzz.regressoes.test.js).
 * Não é arquivo de teste.
 *
 * - Sistema montado pela função pública api() (como a tela chama), sobre o setup() do editor.
 * - Gerador: a cada passo, um comando VÁLIDO ou INVÁLIDO entre todos os da Fase 2 (registrar os 10 tipos ativos e
 *   subtipos, corrigir — inclusive o substituto de um substituto —, estornar, correção de cadastro pelo animal.editar,
 *   reuso de brinco ligado e desligado, importação dos 5 tipos de evento e de ANIMAIS com validar, importar, concluir e
 *   desfazer, e o marco zero), escolhido pelo estado lido cru da planilha, com datas e animais que provocam os casos
 *   raros (mesmo dia, véspera do nascimento, depois da morte, número de brinco reaproveitado).
 * - Oráculo depois de CADA passo: aceito → verificação de integridade sem ERRO, projeção = reconstrução, invariantes do
 *   financeiro (as do sistema e as reescritas sobre as linhas cruas), um replay independente da linha do tempo de cada
 *   animal (situação, pasto, saída, continuidade) e o efeito que o pedido manda (animal vendido fora do rebanho, brinco
 *   trocado, categoria escolhida...); recusado → nada mudou (data_version e linhas) e a recusa tem código e mensagem em
 *   português, e a chave continua livre.
 * - Gravação simbólica dos comandos (os identificadores viram "@passo.aN" / "@passo.eN" / "@passo.iN"), para repetir uma
 *   parte da sequência num sistema novo, e encolhimento automático (ddmin) até a sequência mínima que ainda falha com a
 *   mesma assinatura.
 */
const assert = require('node:assert/strict');
const { createGas } = require('./harness');
const O = require('./apoio-oraculos');

const D0 = '2026-01-01';
const HOJE = '2026-11-13';
const USUARIO = 'dono@gmail.com';
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
const AVISOS = ['POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'BRINCO_PARECIDO', 'IDADE_REPRODUTIVA', 'INTERVALO_PARTO_CURTO', 'VALOR_DIVERGENTE', 'RATEIO_SEM_PESO', 'CARENCIA_ATIVA', 'CATEGORIAS_SEM_COBERTURA'];
const RECUSAS = ['VALIDATION', 'CONFLICT', 'NEEDS_CONFIRMATION', 'NOT_FOUND', 'CONFIG', 'IDEMPOTENCY_MISMATCH'];
const SAIDA = { VENDA: 'VENDIDO', MORTE: 'MORTO', DESCARTE: 'DESCARTADO', AJUSTE_INVENTARIO: 'BAIXADO_AJUSTE' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const js = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function somaDias(d, n) {
  const t = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
const br = (d) => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
function reais(c) {
  const r = Math.floor(c / 100);
  const s = String(r).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return s + ',' + String(c % 100).padStart(2, '0');
}
const dec = (x) => String(x).replace('.', ',');
function dividir(total, n) {
  const q = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => q + (i < total - q * n ? 1 : 0));
}

// ------------------------------------------------------------------ aleatório ----
/** Gerador com semente (mulberry32): sementes vizinhas dão sequências independentes. */
function aleatorio(semente) {
  let a = (semente * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sorteio = (rnd, l) => (l.length ? l[Math.floor(rnd() * l.length)] : null);
function alguns(rnd, lista, max) {
  const c = lista.slice();
  const out = [];
  const n = Math.min(c.length, 1 + Math.floor(rnd() * max));
  for (let i = 0; i < n; i++) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]);
  return out;
}
function pesado(rnd, pesos) {
  const total = pesos.reduce((s, p) => s + p[1], 0);
  let x = rnd() * total;
  for (const p of pesos) { x -= p[1]; if (x < 0) return p[0]; }
  return pesos[pesos.length - 1][0];
}

// ------------------------------------------------------------------ o sistema pela api() ----
function montar(opcoes) {
  const o = Object.assign({ ordem: 'alpha', reuso: false, vazio: false }, opcoes || {});
  const gas = createGas({ order: o.ordem });
  const G = gas.G;
  gas.exec(() => G.setup());
  const sis = { gas, G, o, n: 0, sim: new Map(), uuid: new Map(), specs: new Map(), imps: new Map(), passosFeitos: 0 };
  sis.props = () => Object.fromEntries(gas.props.script._data);
  sis.banco = () => sis.props().SPREADSHEET_ID;
  sis.versao = () => Number(sis.props()['DATA_VERSION:' + sis.banco()] || 0);
  sis.api = (rota, dados, extra) => js(gas.exec(() => G.api(Object.assign({ rota, dados: dados || {} }, extra || {}))));
  const ok = (rota, dados, extra) => {
    const r = sis.api(rota, dados, Object.assign({ idempotencyKey: 'base-' + (++sis.n), avisosAceitos: AVISOS }, extra || {}));
    if (!r.ok) throw new Error('montagem: ' + rota + ' ' + JSON.stringify(r.error));
    return r.data;
  };
  const prop = ok('propriedade.salvar', { campos: { nome: 'Fazenda do Teste', area_total_ha: 200 } }).property_id;
  sis.prop = prop;
  sis.pastos = {
    A: ok('pasto.salvar', { campos: { property_id: prop, nome: 'Pasto A', area_hectares: 5, capacidade_estimada_ua_ha: 1.5, capacidade_estimada_cabecas: 6, posse: 'PROPRIO' } }).pasture_id,
    B: ok('pasto.salvar', { campos: { property_id: prop, nome: 'Pasto B', identificacao: 'P-B', area_hectares: 30, posse: 'PROPRIO' } }).pasture_id,
    C: ok('pasto.salvar', { campos: { property_id: prop, nome: 'Pasto C', posse: 'PROPRIO' } }).pasture_id,
  };
  sis.nomePasto = { [sis.pastos.A]: 'Pasto A', [sis.pastos.B]: 'Pasto B', [sis.pastos.C]: 'Pasto C' };
  const parceiro = (nome, tipos) => ok('parceiro.salvar', { campos: { nome, tipos } }).partner_id;
  sis.parceiros = { fornecedor: parceiro('Fazenda Vizinha', ['FORNECEDOR']), comprador: parceiro('Frigorífico Boi Bom', ['COMPRADOR']), transportador: parceiro('Transportes Rondon', ['TRANSPORTADOR']), corretor: parceiro('Corretor Antônio', ['OUTRO']) };
  const valores = { propriedade_padrao_id: prop, importacao_lote_linhas: '2', brinco_permite_reuso: o.reuso ? 'S' : 'N' };
  if (!o.vazio) valores.data_marco_zero = D0;
  ok('config.salvar', { valores });
  sis.externo = ok('animal.cadastrarExterno', { campos: { nome: 'Touro do sêmen', sexo: 'M', data_nascimento: '2017-05-01', data_nascimento_confianca: 'ESTIMADA' } }).animal_id;
  const t = tabelas(sis);
  sis.categorias = t.CATEGORIAS.map((c) => ({ id: c.category_id, sexo: c.sexo_aplicavel, codigo: c.codigo }));
  sis.custeio = t.PLANO_CONTAS.find((c) => c.codigo === 'SERVICOS_VETERINARIOS').conta_id;
  if (!o.vazio) {
    const P = sis.pastos;
    const f = (brinco, nasc, pasto, extra) => Object.assign({ brinco, sexo: 'F', origem: 'DESCONHECIDA', data_nascimento: nasc, data_nascimento_confianca: 'ESTIMADA', pasto_destino_id: pasto }, extra || {});
    const m = (brinco, nasc, pasto, extra) => Object.assign(f(brinco, nasc, pasto), { sexo: 'M', castrado: false, reprodutor: false }, extra || {});
    ok('evento.registrar', {
      tipo: 'ENTRADA_INICIAL', campos: { event_date: D0 }, animais: [
        f('1', '2019-03-10', P.A, { ref: 'v1', partos_previos: 2, data_entrada: '2019-05-01', data_entrada_confianca: 'ESTIMADA' }),
        f('2', '2020-07-01', P.A, { ref: 'v2', peso: 420, metodo_pesagem: 'BALANCA' }),
        f('3', '2021-02-15', P.B, { situacao_reprodutiva: 'PRENHA', data_prevista_parto: '2026-03-01' }),
        m('4', '2018-01-01', P.B, { ref: 't1', reprodutor: true }),
        f('5', '2024-08-01', P.B, { mae_ref: 'v1', mae_confianca: 'CONFIRMADA' }),
        m('6', '2024-02-01', P.C, { castrado: true, valor_abertura: 300000 }),
        m('7', '2024-03-01', P.C, { castrado: true }),
        m('8', '2025-10-20', P.A, { mae_ref: 'v2', mae_confianca: 'CONFIRMADA', pai_ref: 't1', pai_confianca: 'ESTIMADA' }),
      ],
    });
  }
  // Nomes estáveis do que a montagem cria, para a sequência gravada ficar legível e repetível.
  const nomear0 = (id, nome) => { sis.sim.set(id, nome); sis.uuid.set(nome, id); };
  Object.keys(sis.pastos).forEach((k) => nomear0(sis.pastos[k], '@p:' + k));
  Object.keys(sis.parceiros).forEach((k) => nomear0(sis.parceiros[k], '@f:' + k));
  nomear0(sis.externo, '@x');
  nomear0(sis.custeio, '@conta');
  sis.categorias.forEach((c) => nomear0(c.id, '@c:' + c.codigo));
  tabelas(sis).ANIMAIS.forEach((a) => { if (a.brinco && a.situacao_cadastral !== 'EXTERNO') nomear0(a.animal_id, '@b:' + a.brinco); });
  return sis;
}

function tabelas(sis) {
  const G = sis.G;
  return js(sis.gas.exec(() => {
    const l = G.Database.abrir(sis.banco(), { primitiva: sis.props().IO_PRIMITIVE }).ler(G.Schema.nomesTabelas());
    const o = {};
    Object.keys(l).forEach((k) => { o[k] = l[k].registros; });
    return o;
  }));
}
function contagens(t) {
  const o = {};
  Object.keys(t).forEach((k) => { if (k !== 'ERROS_LOG') o[k] = t[k].length; });
  return o;
}

// ------------------------------------------------------------------ o estado lido cru (replay independente) ----
const classe = (l) => (l.efeito === 1 ? 0 : l.efeito === -1 ? 2 : 1);
const ordenar = (ls) => ls.slice().sort((a, b) => cmp(a.data, b.data) || classe(a) - classe(b) || a.raiz - b.raiz || a.seq - b.seq);
const DE_FATO = (l) => l.efeito === 0 && !l.destino;

function estado(t) {
  const op = new Map(t.OPERACOES.map((o) => [o.op_id, o.status]));
  const imp = new Map(t.IMPORTACOES.map((i) => [i.import_id, i]));
  const ev = new Map(t.EVENTOS.map((e) => [e.event_id, e]));
  const conf = (e) => op.get(e.op_id) === 'CONFIRMADA';
  const anuladoPor = new Map();
  t.EVENTOS.forEach((e) => { if (e.reversal_of_event_id && conf(e)) anuladoPor.set(e.reversal_of_event_id, e.event_id); });
  const vig = new Map();
  t.EVENTOS.forEach((e) => vig.set(e.event_id, conf(e) && e.event_type !== 'ESTORNO' && !anuladoPor.has(e.event_id) && (!e.import_id || (imp.get(e.import_id) || {}).status === 'IMPORTADO')));
  const raizes = new Map();
  const raiz = (e) => {
    if (raizes.has(e.event_id)) return raizes.get(e.event_id);
    let a = e;
    for (let g = 0; g < 1000 && a.reversal_of_event_id && a.event_type !== 'ESTORNO'; g++) {
      const b = ev.get(a.reversal_of_event_id);
      if (!b || b.event_type !== a.event_type) break;
      a = b;
    }
    raizes.set(e.event_id, a.event_seq);
    return a.event_seq;
  };
  const linhas = [];
  t.EVENTO_ANIMAIS.forEach((l) => {
    if (!vig.get(l.event_id)) return;
    const e = ev.get(l.event_id);
    linhas.push({ animal: l.animal_id, ev: e.event_id, tipo: e.event_type, sub: e.event_subtype || null, data: e.event_date, seq: e.event_seq, raiz: raiz(e), efeito: l.efeito_inventario, origem: l.pasto_origem_id || null, destino: l.pasto_destino_id || null, papel: l.papel, pre: e.pre_marco_zero === true });
  });
  const porAnimal = O.agrupar(linhas, 'animal');
  const config = new Map(t.CONFIGURACOES.map((c) => [c.chave, c.valor]));
  const S = {
    t, op, imp, ev, vig, anuladoPor, raiz, linhas, porAnimal, config,
    animais: new Map(t.ANIMAIS.map((a) => [a.animal_id, a])),
    marco: config.get('data_marco_zero') || null,
    reuso: config.get('brinco_permite_reuso') === 'S',
    versao: null,
  };
  S.linhasDe = (id) => ordenar((porAnimal.get(id) || []).filter((l) => !l.pre));
  S.situacao = (id) => situacaoDe(S.linhasDe(id));
  S.emCurso = t.IMPORTACOES.filter((i) => i.status === 'IMPORTANDO');
  return S;
}
function situacaoDe(ls) {
  if (!ls.length) return { situacao: 'ANULADO', pasto: null, saida: null, entrada: null };
  let s = 0;
  let p = null;
  let ult = null;
  let entrada = null;
  ls.forEach((l) => { if (DE_FATO(l)) return; s += l.efeito; if (l.destino) p = l.destino; if (l.efeito === -1) { p = null; ult = l; } if (l.efeito === 1) entrada = l; });
  if (s >= 1) return { situacao: 'ATIVO', pasto: p, saida: null, entrada };
  return { situacao: ult ? SAIDA[ult.tipo] : 'ANULADO', pasto: null, saida: ult ? ult.data : null, entrada };
}
/** Onde o animal está: ao fim do dia D (movimento e saída) e em algum momento do dia (fato, limites inclusivos). */
function presenca(S, id, D) {
  const ls = S.linhasDe(id).filter((l) => !DE_FATO(l));
  let s = 0;
  let p = null;
  let antes = null;
  ls.forEach((l) => {
    if (l.data > D) return;
    if (l.data === D && l.efeito === -1 && antes === null) antes = { dentro: s >= 1, pasto: p };
    s += l.efeito; if (l.destino) p = l.destino; if (l.efeito === -1) p = null;
  });
  const per = [];
  ls.forEach((l) => { if (l.efeito === 1) per.push({ ini: l.data, fim: null }); else if (l.efeito === -1 && per.length) per[per.length - 1].fim = l.data; });
  const dia = per.some((x) => D >= x.ini && (x.fim === null || D <= x.fim));
  return { fim: s >= 1, pasto: s >= 1 ? p : null, dia, pastoDia: antes ? antes.pasto : s >= 1 ? p : null };
}

// ------------------------------------------------------------------ símbolos (para repetir parte da sequência) ----
function simbolizar(sis, v) {
  if (typeof v === 'string') return sis.sim.has(v) ? sis.sim.get(v) : v;
  if (Array.isArray(v)) return v.map((x) => simbolizar(sis, x));
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach((k) => { o[k] = simbolizar(sis, v[k]); }); return o; }
  return v;
}
/** Resolve os símbolos; símbolo sem dono (o passo que o criou ficou fora) → null. */
function resolver(sis, v, faltou) {
  if (typeof v === 'string' && /^@(\d+\.[aei]\d+|[bpfc]:\w+|x|conta)$/.test(v)) { if (!sis.uuid.has(v)) { faltou.push(v); return v; } return sis.uuid.get(v); }
  if (Array.isArray(v)) return v.map((x) => resolver(sis, x, faltou));
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach((k) => { o[k] = resolver(sis, v[k], faltou); }); return o; }
  return v;
}
/** Dá nome aos registros que o passo k criou (animais, eventos, importações), na ordem das linhas. */
function nomear(sis, k, antes, depois) {
  [['ANIMAIS', 'animal_id', 'a'], ['EVENTOS', 'event_id', 'e'], ['IMPORTACOES', 'import_id', 'i']].forEach(([aba, pk, l]) => {
    const velhos = new Set(antes[aba].map((x) => x[pk]));
    let n = 0;
    depois[aba].forEach((x) => {
      if (velhos.has(x[pk]) || sis.sim.has(x[pk])) return;
      const nome = '@' + k + '.' + l + (n++);
      sis.sim.set(x[pk], nome);
      sis.uuid.set(nome, x[pk]);
    });
  });
}

// ------------------------------------------------------------------ oráculos ----
const PORTUGUES = /[a-záàâãéêíóôõúç]{3,}/i;
const INGLES = /\b(undefined|NaN|null|TypeError|ReferenceError|Cannot read|is not a function|is not defined|\[object Object\])\b/;
function falha(assinatura, mensagem) {
  return { assinatura, mensagem };
}
/** Recusa: código conhecido, mensagem em português (e em cada detalhe), nada gravado, chave livre. */
function oraculoRecusa(sis, cmd, r, antes, depois, dv0, dv1, chave) {
  const out = [];
  const e = r.error || {};
  if (RECUSAS.indexOf(e.code) < 0) out.push(falha('RECUSA:' + (e.code || 'SEM_CODIGO'), 'recusa com código inesperado: ' + JSON.stringify(e).slice(0, 1500)));
  if (typeof e.message !== 'string' || e.message.length < 10 || !PORTUGUES.test(e.message) || INGLES.test(e.message)) out.push(falha('RECUSA:MENSAGEM', 'mensagem da recusa fora do padrão: ' + JSON.stringify(e.message)));
  (e.details || []).forEach((d) => {
    if (!d || typeof d.codigo !== 'string' || !d.codigo) out.push(falha('RECUSA:DETALHE', 'detalhe sem código: ' + JSON.stringify(d)));
    else if (typeof d.mensagem !== 'string' || !PORTUGUES.test(d.mensagem) || INGLES.test(d.mensagem)) out.push(falha('RECUSA:MENSAGEM', 'detalhe ' + d.codigo + ' com mensagem fora do padrão: ' + JSON.stringify(d.mensagem)));
  });
  if (dv1 !== dv0) out.push(falha('RECUSA:MUDOU', 'a recusa ' + e.code + ' mudou a data_version de ' + dv0 + ' para ' + dv1));
  const c0 = contagens(antes.t);
  const c1 = contagens(depois.t);
  const mudou = Object.keys(c1).filter((k) => c0[k] !== c1[k]);
  if (mudou.length) out.push(falha('RECUSA:MUDOU', 'a recusa ' + e.code + ' gravou linhas em ' + mudou.join(', ')));
  if (e.code !== 'IDEMPOTENCY_MISMATCH' && chave) {
    const st = sis.api('operacao.status', { chave });
    if (!st.ok || st.data.situacao !== 'INEXISTENTE') out.push(falha('RECUSA:CHAVE', 'a recusa consumiu a chave: ' + JSON.stringify(st.data || st.error)));
  }
  return out;
}

/** Conferências globais do estado, depois de qualquer passo. */
function oraculoGlobal(sis, S, datas) {
  const out = [];
  const { G, gas } = sis;
  const integ = sis.api('sistema.integridade', {});
  if (!integ.ok) out.push(falha('INTEGRIDADE:FALHOU', JSON.stringify(integ.error).slice(0, 800)));
  else if (!integ.data.ok) {
    integ.data.checagens.filter((c) => c.situacao === 'ERRO').forEach((c) => {
      const achados = integ.data.achados.filter((a) => a.checagem === c.codigo && a.severidade === 'ERRO').slice(0, 4).map((a) => a.tabela + ' ' + a.id + ': ' + a.mensagem);
      out.push(falha('INTEGRIDADE:' + c.codigo, c.codigo + ' — ' + achados.join(' | ')));
    });
  }
  const conf = js(gas.exec(() => G.UnitOfWork.read(G.Api.contexto({ usuario: USUARIO }), {
    rota: 'teste.projecoes', reads: G.FinancialService.leituras(), acessoCru: true, tratador: (tx) => ({ proj: G.Timeline.conferir(tx), fin: G.FinancialService.conferir(tx) }),
  }).dados));
  if (conf.proj.length) out.push(falha('PROJECAO', 'projeção gravada ≠ reconstrução: ' + JSON.stringify(conf.proj.slice(0, 3)).slice(0, 800)));
  if (conf.fin.length) out.push(falha('FINANCEIRO', 'invariantes do financeiro: ' + JSON.stringify(conf.fin.slice(0, 3)).slice(0, 800)));
  const cruas = O.invariantesCruas(Object.assign({}, S.t));
  if (cruas.length) out.push(falha('FINANCEIRO_CRU', 'invariantes de 03b, 14, nas linhas cruas: ' + cruas.slice(0, 4).join(' | ')));
  // Replay independente: cada animal, pela ordem canônica, sem Timeline.
  S.animais.forEach((a, id) => {
    if (a.situacao_cadastral === 'EXTERNO') { if (S.porAnimal.has(id) && S.porAnimal.get(id).length) out.push(falha('REPLAY:EXTERNO', 'animal de referência ' + a.codigo_interno + ' com linha de evento')); return; }
    const todas = S.porAnimal.get(id) || [];
    const ls = S.linhasDe(id);
    if (!ls.some((l) => !DE_FATO(l))) {
      // Sem entrada no rebanho: o histórico anterior ao marco zero decide (HISTORICO ou a saída antiga); sem ele, anulado.
      const ok = todas.some((l) => l.pre) ? ['HISTORICO', 'VENDIDO', 'MORTO', 'DESCARTADO'] : ['ANULADO', 'PENDENTE'];
      if (ok.indexOf(a.situacao_cadastral) < 0) out.push(falha('REPLAY:SITUACAO', a.codigo_interno + ' está ' + a.situacao_cadastral + ' sem linha no rebanho (esperado ' + ok.join('/') + ')'));
      return;
    }
    const st = situacaoDe(ls);
    if (a.situacao_cadastral !== st.situacao || (a.pasto_atual_id || null) !== st.pasto || (a.data_saida || null) !== st.saida) {
      out.push(falha('REPLAY:SITUACAO', a.codigo_interno + ': gravado ' + JSON.stringify([a.situacao_cadastral, a.pasto_atual_id, a.data_saida]) + ', replay ' + JSON.stringify([st.situacao, st.pasto, st.saida])));
    }
    // Continuidade: entradas e saídas alternam, a origem de cada movimento é o pasto de antes, nada depois da morte.
    let dentro = false;
    let pasto = null;
    let morte = null;
    const per = [];
    ls.filter((l) => !DE_FATO(l)).forEach((l) => {
      const q = a.codigo_interno + ' ' + l.tipo + ' de ' + l.data;
      if (morte !== null) { out.push(falha('REPLAY:LINHA', q + ' depois da morte em ' + morte)); return; }
      if (l.efeito === 1) {
        if (dentro) out.push(falha('REPLAY:LINHA', q + ': entrada com o animal já no rebanho'));
        dentro = true; pasto = l.destino; per.push({ ini: l.data, fim: null }); return;
      }
      if (!dentro) { out.push(falha('REPLAY:LINHA', q + ': o animal não estava no rebanho')); return; }
      if (l.origem && l.origem !== pasto) out.push(falha('REPLAY:ORIGEM', q + ': origem ' + l.origem + ', mas estava em ' + pasto));
      if (l.efeito === 0) { pasto = l.destino; return; }
      dentro = false; pasto = null; per[per.length - 1].fim = l.data;
      if (l.tipo === 'MORTE') morte = l.data;
    });
    ls.filter((l) => DE_FATO(l) && l.tipo !== 'AJUSTE_INVENTARIO').forEach((l) => {
      if (!per.some((x) => l.data >= x.ini && (x.fim === null || l.data <= x.fim))) out.push(falha('REPLAY:FATO', a.codigo_interno + ' ' + l.tipo + ' de ' + l.data + ' fora da permanência'));
    });
  });
  // Brinco lançado errado: o número corrigido é o que estava em uso na posição do lançamento, em qualquer caminho
  // (registro, correção dele, correção ou estorno das identificações em volta).
  S.t.AJUSTES.forEach((z) => {
    if (z.tipo_ajuste !== 'IDENTIFICACAO_INCORRETA' || !S.vig.get(z.event_id)) return;
    const E = S.ev.get(z.event_id);
    const naPosicao = codigoNaPosicao(S, z.animal_id, { data: E.event_date, raiz: S.raiz(E), seq: E.event_seq }, z.event_id);
    if (norm(z.valor_anterior) !== norm(naPosicao)) out.push(falha('REPLAY:BRINCO_CORRIGIDO', (S.animais.get(z.animal_id) || {}).codigo_interno + ': o brinco lançado errado de ' + E.event_date + ' corrige ' + z.valor_anterior + ', mas o brinco em uso nessa posição é ' + naPosicao));
  });
  // Inventário: o sistema (inventario.posicao) = o replay, em hoje e em datas do passo.
  (datas || []).concat([HOJE]).forEach((D) => {
    if (!S.marco || D < S.marco || D > HOJE) return;
    let total = 0;
    S.animais.forEach((a, id) => { if (a.situacao_cadastral !== 'EXTERNO' && presenca(S, id, D).fim) total++; });
    const r = sis.api('inventario.posicao', { data: D });
    if (!r.ok) out.push(falha('INVENTARIO:FALHOU', D + ': ' + JSON.stringify(r.error).slice(0, 400)));
    else if (r.data.cabecas !== total) out.push(falha('INVENTARIO', 'inventário em ' + D + ': sistema ' + r.data.cabecas + ', replay ' + total));
  });
  // Elegíveis numa data do passo: a transferência pelo fim do dia (com o pasto), o parto pela presença no dia (RN-017).
  (datas || []).slice(0, 1).forEach((D) => {
    if (!S.marco || D < S.marco || D > HOJE) return;
    const esperado = { TRANSFERENCIA: [], NASCIMENTO: [] };
    S.animais.forEach((a, id) => {
      if (a.situacao_cadastral === 'EXTERNO') return;
      const p = presenca(S, id, D);
      if (p.fim) esperado.TRANSFERENCIA.push(id + '@' + p.pasto);
      if (p.dia && a.sexo === 'F') esperado.NASCIMENTO.push(id);
    });
    Object.keys(esperado).forEach((tipo) => {
      const r = sis.api('inventario.elegiveis', { tipo, data: D });
      if (!r.ok) { out.push(falha('ELEGIVEIS:FALHOU', tipo + ' ' + D + ': ' + JSON.stringify(r.error).slice(0, 400))); return; }
      const obtido = (r.data.itens || []).map((x) => (tipo === 'TRANSFERENCIA' ? x.animal_id + '@' + x.pasture_id : x.animal_id)).sort();
      if (JSON.stringify(obtido) !== JSON.stringify(esperado[tipo].sort())) out.push(falha('ELEGIVEIS', 'elegíveis à ' + tipo + ' em ' + D + ': sistema ' + obtido.length + ', replay ' + esperado[tipo].length + ' (' + JSON.stringify(obtido.filter((x) => esperado[tipo].indexOf(x) < 0).concat(['×'], esperado[tipo].filter((x) => obtido.indexOf(x) < 0))).slice(0, 400) + ')'));
    });
  });
  return out;
}

/** Último registro (data, posição na cadeia, sequência) de uma lista. */
const ultimo = (ls, f) => ls.slice().sort(f || ((a, b) => cmp(a.data, b.data) || a.raiz - b.raiz || a.seq - b.seq)).pop();
const norm = (v) => (v === undefined || v === null || v === '' ? null : v === true ? 'S' : v === false ? 'N' : String(v));
/** O efeito que o pedido manda, conferido no estado de depois. */
function oraculoEfeito(sis, cmd, resp, A, S) {
  const out = [];
  const d = cmd.dados || {};
  const erro = (m) => out.push(falha('EFEITO:' + (d.tipo || cmd.rota) + (d.subtipo ? '/' + d.subtipo : ''), m));
  if (cmd.rota === 'config.salvar') {
    Object.keys(d.valores || {}).forEach((k) => { if (norm(S.config.get(k)) !== norm(d.valores[k])) erro(k + ' gravado ' + S.config.get(k) + ', pedido ' + d.valores[k]); });
    return out;
  }
  if (cmd.rota.indexOf('importacao.') === 0) {
    const id = cmd.rota === 'importacao.criar' ? resp.import_id : d.import_id;
    const i = S.imp.get(id);
    if (!i) { erro('importação ' + id + ' não gravada'); return out; }
    const esperado = { 'importacao.criar': ['RASCUNHO'], 'importacao.validarBloco': ['RASCUNHO', 'VALIDADO'], 'importacao.importarBloco': ['IMPORTANDO'], 'importacao.concluir': ['IMPORTADO'], 'importacao.desfazer': ['CANCELADO'] }[cmd.rota];
    if (esperado.indexOf(i.status) < 0) erro('importação ' + i.status + ' depois de ' + cmd.rota);
    const evs = S.t.EVENTOS.filter((e) => e.import_id === id);
    if (cmd.rota === 'importacao.concluir') evs.forEach((e) => { if (!S.vig.get(e.event_id) && !S.anuladoPor.has(e.event_id)) erro('evento importado ' + e.event_type + ' de ' + e.event_date + ' não vale depois de concluir'); });
    if (cmd.rota === 'importacao.desfazer') {
      evs.forEach((e) => { if (S.vig.get(e.event_id)) erro('evento importado ainda vale depois de desfazer'); });
      const criados = new Set(S.t.EVENTO_ANIMAIS.filter((l) => evs.some((e) => e.event_id === l.event_id) && !A.animais.has(l.animal_id)).map((l) => l.animal_id));
      criados.forEach((x) => { const a = S.animais.get(x); if (a && a.situacao_cadastral !== 'ANULADO') erro('animal criado pela importação desfeita está ' + a.situacao_cadastral); });
    }
    return out;
  }
  if (cmd.rota === 'evento.estornar') {
    const alvo = d.event_id;
    if (S.vig.get(alvo)) erro('o evento estornado continua valendo');
    const est = S.t.EVENTOS.find((e) => e.event_type === 'ESTORNO' && e.reversal_of_event_id === alvo && S.op.get(e.op_id) === 'CONFIRMADA');
    if (!est) erro('sem o ESTORNO confirmado');
    else if (est.event_date !== HOJE) erro('ESTORNO datado de ' + est.event_date);
    A.animais.forEach((a, id) => { if (a.evento_origem_id === alvo && S.animais.get(id).situacao_cadastral !== 'ANULADO' && !S.linhasDe(id).length) erro(a.codigo_interno + ' criado pelo estornado está ' + S.animais.get(id).situacao_cadastral); });
    return out;
  }
  const eid = resp && resp.event_id;
  if (cmd.rota === 'animal.editar') {
    const a = S.animais.get(d.animal_id);
    Object.keys(d.campos || {}).forEach((c) => {
      if (c === 'nome' && norm(a.nome) !== norm(d.campos.nome)) erro('nome gravado ' + a.nome + ', pedido ' + d.campos.nome);
    });
    if (eid) conferirCorrecoes(S, eid, erro);
    return out;
  }
  if (!eid) { erro('resposta sem event_id: ' + JSON.stringify(resp).slice(0, 300)); return out; }
  // A resposta traz os animais já com as projeções gravadas (o valor definitivo vem do servidor, P5).
  (resp.animais || []).forEach((x) => {
    const a = S.animais.get(x.animal_id);
    if (!a) { erro('a resposta cita um animal que não existe'); return; }
    if (x.situacao_cadastral !== a.situacao_cadastral || (x.pasto_atual_id || null) !== (a.pasto_atual_id || null) || norm(x.brinco) !== norm(a.brinco) || x.sexo !== a.sexo) erro('resposta × gravado em ' + a.codigo_interno + ': ' + JSON.stringify([x.situacao_cadastral, x.pasto_atual_id, x.brinco, x.sexo]) + ' × ' + JSON.stringify([a.situacao_cadastral, a.pasto_atual_id, a.brinco, a.sexo]));
  });
  const E = S.ev.get(eid);
  if (!E) { erro('evento ' + eid + ' não gravado'); return out; }
  if (!S.vig.get(eid)) erro('evento gravado não vale');
  if (E.event_type !== d.tipo || (E.event_subtype || null) !== (d.subtipo || null)) erro('tipo gravado ' + E.event_type + '/' + E.event_subtype);
  if (E.event_date !== (d.tipo === 'ENTRADA_INICIAL' ? S.marco : d.campos.event_date)) erro('data gravada ' + E.event_date);
  if (cmd.rota === 'evento.corrigir') {
    if (E.reversal_of_event_id !== d.event_id) erro('o substituto não aponta o original');
    if (S.vig.get(d.event_id)) erro('o original continua valendo');
  }
  const pre = E.pre_marco_zero === true;
  if (pre !== (E.event_date < S.marco)) erro('pre_marco_zero ' + pre + ' em ' + E.event_date);
  const lsE = S.t.EVENTO_ANIMAIS.filter((l) => l.event_id === eid);
  const linhaDe = (id) => lsE.find((l) => l.animal_id === id);
  const efeito = (x) => (pre ? 0 : x);
  const ultimaMov = (id) => ultimo(S.linhasDe(id).filter((l) => !DE_FATO(l)), (a, b) => cmp(a.data, b.data) || classe(a) - classe(b) || a.raiz - b.raiz || a.seq - b.seq);
  const ehUltima = (id) => { const u = ultimaMov(id); return !!u && u.ev === eid; };
  const novosDe = () => lsE.filter((l) => !A.animais.has(l.animal_id) || A.animais.get(l.animal_id).situacao_cadastral === 'PENDENTE');
  const conferirNovo = (l, it, pastoLote, origem) => {
    const a = S.animais.get(l.animal_id);
    if (!a) { erro('animal novo sem cadastro'); return; }
    if (it.sexo && a.sexo !== it.sexo) erro(a.codigo_interno + ': sexo ' + a.sexo + ', pedido ' + it.sexo);
    if (origem && a.origem !== origem) erro(a.codigo_interno + ': origem ' + a.origem + ', esperado ' + origem);
    const temOutra = S.linhasDe(l.animal_id).some((x) => x.ev !== eid);
    if (!temOutra && !pre) {
      const pasto = it.pasto_destino_id || pastoLote;
      if (pasto && a.pasto_atual_id !== pasto) erro(a.codigo_interno + ': pasto ' + a.pasto_atual_id + ', pedido ' + pasto);
      if (a.situacao_cadastral !== 'ATIVO') erro(a.codigo_interno + ' entrou e está ' + a.situacao_cadastral);
    }
    const idents = S.t.IDENTIFICACOES.filter((x) => x.animal_id === l.animal_id && x.tipo === 'BRINCO' && S.vig.get(x.event_id));
    if (it.brinco && !pre && idents.length === 1 && idents[0].event_id === eid && norm(a.brinco) !== norm(it.brinco)) erro(a.codigo_interno + ': brinco ' + a.brinco + ', pedido ' + it.brinco);
    if (it.data_nascimento && a.data_nascimento !== it.data_nascimento && !S.t.AJUSTES.some((x) => x.animal_id === l.animal_id && x.campo === 'data_nascimento' && S.vig.get(x.event_id))) erro(a.codigo_interno + ': nascimento ' + a.data_nascimento + ', pedido ' + it.data_nascimento);
  };
  const tipo = d.tipo;
  if (tipo === 'TRANSFERENCIA') {
    (d.animais || []).forEach((x) => {
      const l = linhaDe(x.animal_id);
      if (!l || l.efeito_inventario !== 0 || (!pre && (l.pasto_origem_id !== d.campos.pasto_origem_id || l.pasto_destino_id !== d.campos.pasto_destino_id))) { erro('linha da transferência errada: ' + JSON.stringify(l)); return; }
      if (!pre && ehUltima(x.animal_id) && S.animais.get(x.animal_id).pasto_atual_id !== d.campos.pasto_destino_id) erro('transferido e o pasto atual é ' + S.animais.get(x.animal_id).pasto_atual_id);
    });
  } else if (tipo === 'VENDA' || tipo === 'MORTE' || tipo === 'DESCARTE' || (tipo === 'AJUSTE_INVENTARIO' && d.subtipo === 'DIVERGENCIA_CONTAGEM')) {
    (d.animais || []).forEach((x) => {
      const l = linhaDe(x.animal_id);
      if (!l || l.efeito_inventario !== efeito(-1)) { erro('linha de saída errada: ' + JSON.stringify(l)); return; }
      if (pre) return;
      const a = S.animais.get(x.animal_id);
      if (ehUltima(x.animal_id) && (a.situacao_cadastral !== SAIDA[tipo] || a.data_saida !== E.event_date)) erro(a.codigo_interno + ' saiu (' + tipo + ') e está ' + a.situacao_cadastral + ' desde ' + a.data_saida);
      if (presenca(S, x.animal_id, E.event_date).fim) erro(a.codigo_interno + ' saiu e continua no rebanho no fim do dia ' + E.event_date);
    });
    if (tipo !== 'VENDA') {
      const bx = S.t.BAIXAS.filter((b) => b.event_id === eid);
      if (bx.length !== (d.animais || []).length) erro(bx.length + ' baixas para ' + d.animais.length + ' animais');
    }
    const fins = S.t.FINANCEIRO.filter((f) => f.event_id === eid);
    if (tipo === 'VENDA') {
      const v = S.t.VENDAS.filter((x) => x.event_id === eid);
      const receita = d.campos.valor_bruto - (d.campos.desconto_comercial || 0);
      if (v.length !== 1 || v[0].valor_bruto !== d.campos.valor_bruto) erro('VENDAS ' + JSON.stringify(v.map((x) => x.valor_bruto)));
      if (!fins.length || fins[0].natureza !== 'RECEITA_VENDA_ANIMAIS' || fins[0].valor !== receita) erro('receita ' + JSON.stringify(fins.map((f) => [f.natureza, f.valor])) + ', esperado ' + receita);
      const ded = fins.filter((f) => f.natureza === 'DESPESA_VENDA').map((f) => f.valor).sort((a, b) => a - b);
      const ped = (d.deducoes || []).map((x) => x.valor).sort((a, b) => a - b);
      if (JSON.stringify(ded) !== JSON.stringify(ped)) erro('deduções ' + JSON.stringify(ded) + ', pedidas ' + JSON.stringify(ped));
    } else {
      const v = d.campos.custo_valor || d.campos.receita_valor || 0;
      if (JSON.stringify(fins.map((f) => f.valor)) !== JSON.stringify(v ? [v] : [])) erro('lançamento da saída ' + JSON.stringify(fins.map((f) => f.valor)) + ', pedido ' + v);
    }
  } else if (tipo === 'COMPRA') {
    const c = S.t.COMPRAS.filter((x) => x.event_id === eid);
    const custos = (d.custos || []).reduce((s, x) => s + x.valor, 0);
    if (c.length !== 1 || c[0].valor_animais !== d.campos.valor_animais) erro('COMPRAS ' + JSON.stringify(c.map((x) => x.valor_animais)));
    const fins = S.t.FINANCEIRO.filter((f) => f.event_id === eid);
    if (fins.reduce((s, f) => s + f.valor, 0) !== d.campos.valor_animais + custos) erro('lançamentos da compra somam ' + fins.reduce((s, f) => s + f.valor, 0));
    if (lsE.length !== d.animais.length || lsE.some((l) => l.efeito_inventario !== efeito(1))) erro('linhas da compra ' + JSON.stringify(lsE.map((l) => l.efeito_inventario)));
    d.animais.forEach((x) => {
      if (!x.animal_id) return;
      const l = linhaDe(x.animal_id);
      if (!l) erro('o animal ' + x.animal_id + ' não está na compra');
    });
    const ns = novosDe();
    if (ns.length !== d.animais.filter((x) => !x.animal_id).length) erro(ns.length + ' animais novos, pedidos ' + d.animais.filter((x) => !x.animal_id).length);
    const itensNovos = d.animais.filter((x) => !x.animal_id);
    ns.forEach((l, i) => conferirNovo(l, itensNovos[i] || {}, d.campos.pasto_destino_id, pre ? null : 'COMPRADO'));
    if (!pre) d.animais.forEach((x) => { if (x.animal_id && ehUltima(x.animal_id) && S.animais.get(x.animal_id).situacao_cadastral !== 'ATIVO') erro('voltou pela compra e está ' + S.animais.get(x.animal_id).situacao_cadastral); });
  } else if (tipo === 'ENTRADA_INICIAL' || tipo === 'OUTRA_ENTRADA') {
    if (lsE.length !== d.animais.length || lsE.some((l) => l.efeito_inventario !== 1)) erro('linhas da entrada ' + JSON.stringify(lsE.map((l) => l.efeito_inventario)));
    const itensNovos = d.animais.filter((x) => !x.animal_id);
    const ns = novosDe();
    if (ns.length !== itensNovos.length) erro(ns.length + ' animais novos, pedidos ' + itensNovos.length);
    ns.forEach((l, i) => conferirNovo(l, itensNovos[i] || {}, null, null));
    d.animais.forEach((x) => {
      if (!x.animal_id) return;
      const a = S.animais.get(x.animal_id);
      if (!linhaDe(x.animal_id)) erro('o animal ' + x.animal_id + ' não está na entrada');
      else if (ehUltima(x.animal_id) && (a.situacao_cadastral !== 'ATIVO' || (x.pasto_destino_id && a.pasto_atual_id !== x.pasto_destino_id))) erro(a.codigo_interno + ' entrou e está ' + a.situacao_cadastral + ' em ' + a.pasto_atual_id);
    });
  } else if (tipo === 'NASCIMENTO') {
    const mae = d.animais[0].animal_id;
    const lm = linhaDe(mae);
    if (!lm || lm.papel !== 'MATRIZ' || lm.efeito_inventario !== 0) erro('linha da matriz ' + JSON.stringify(lm));
    const vivas = (d.crias || []).filter((c) => c.situacao_nascimento === 'VIVO');
    const crias = lsE.filter((l) => l.papel === 'CRIA');
    if (crias.length !== vivas.length || crias.some((l) => l.efeito_inventario !== efeito(1))) erro(crias.length + ' crias para ' + vivas.length + ' vivas');
    crias.forEach((l) => {
      const a = S.animais.get(l.animal_id);
      if (a.mae_id !== mae || a.data_nascimento !== E.event_date || a.origem !== 'NASCIDO') erro(a.codigo_interno + ': mãe ' + a.mae_id + ', nascimento ' + a.data_nascimento + ', origem ' + a.origem);
      if (!pre && !S.linhasDe(l.animal_id).some((x) => x.ev !== eid) && a.situacao_cadastral !== 'ATIVO') erro('cria ' + a.codigo_interno + ' nasceu e está ' + a.situacao_cadastral);
      if (pre && !S.linhasDe(l.animal_id).some((x) => !DE_FATO(x)) && ['HISTORICO', 'VENDIDO', 'MORTO'].indexOf(a.situacao_cadastral) < 0) erro('cria do parto antigo ' + a.codigo_interno + ' está ' + a.situacao_cadastral);
    });
    const rep = S.t.REPRODUCAO.filter((x) => x.event_id === eid && x.tipo_evento === 'PARTO');
    const nati = (d.crias || []).length - vivas.length;
    if (rep.length !== 1 || rep[0].animal_id !== mae || rep[0].qtd_nascidos_vivos !== vivas.length || rep[0].qtd_natimortos !== nati || (rep[0].touro_id || null) !== (d.campos.pai_id || null)) erro('PARTO ' + JSON.stringify(rep.map((x) => [x.qtd_nascidos_vivos, x.qtd_natimortos, x.touro_id])));
  } else if (tipo === 'IDENTIFICACAO') {
    const ids = S.t.IDENTIFICACOES.filter((x) => x.event_id === eid);
    if (ids.length !== d.animais.length) erro(ids.length + ' identificações para ' + d.animais.length + ' animais');
    d.animais.forEach((x) => {
      const linha = ids.find((y) => y.animal_id === x.animal_id);
      if (!linha) { erro('sem identificação do animal'); return; }
      if (d.subtipo !== 'REMOCAO' && linha.codigo !== x.codigo) erro('código gravado ' + linha.codigo + ', pedido ' + x.codigo);
      if (d.campos.tipo_identificacao !== 'BRINCO') return;
      const todas = S.t.IDENTIFICACOES.filter((y) => y.animal_id === x.animal_id && y.tipo === 'BRINCO' && S.vig.get(y.event_id)).map((y) => ({ y, data: y.data_inicio, raiz: S.raiz(S.ev.get(y.event_id)), seq: S.ev.get(y.event_id).event_seq }));
      const u = ultimo(todas);
      const corrigido = S.t.AJUSTES.some((z) => z.animal_id === x.animal_id && z.tipo_ajuste === 'IDENTIFICACAO_INCORRETA' && S.vig.get(z.event_id));
      const a = S.animais.get(x.animal_id);
      if (u && u.y.event_id === eid && !corrigido && a.situacao_cadastral !== 'ANULADO') {
        const esperado = d.subtipo === 'REMOCAO' ? null : x.codigo;
        if (norm(a.brinco) !== norm(esperado)) erro(a.codigo_interno + ': brinco ' + a.brinco + ', esperado ' + esperado);
      }
    });
  } else if (tipo === 'MARCACAO') {
    d.animais.forEach((x) => {
      const ms = S.linhasDe(x.animal_id).filter((l) => l.tipo === 'MARCACAO' && l.sub === d.subtipo);
      const u = ultimo(ms);
      const a = S.animais.get(x.animal_id);
      const campo = d.subtipo === 'DESCARTE' ? 'marcado_descarte' : 'nao_localizado';
      if (u && u.ev === eid && a[campo] !== (d.campos.acao === 'MARCAR')) erro(a.codigo_interno + ': ' + campo + ' = ' + a[campo] + ' depois de ' + d.campos.acao);
    });
  } else if (tipo === 'AJUSTE_INVENTARIO') {
    if (d.subtipo === 'CORRECAO_CADASTRO') conferirCorrecoes(S, eid, erro);
    if (d.subtipo === 'RECLASSIFICACAO') {
      d.animais.forEach((x) => {
        const rs = S.t.AJUSTES.filter((z) => z.animal_id === x.animal_id && z.tipo_ajuste === 'RECLASSIFICACAO' && S.vig.get(z.event_id)).map((z) => ({ z, data: S.ev.get(z.event_id).event_date, raiz: S.raiz(S.ev.get(z.event_id)), seq: S.ev.get(z.event_id).event_seq }));
        const u = ultimo(rs);
        const a = S.animais.get(x.animal_id);
        if (u && u.z.event_id === eid && (norm(a.categoria_manual_id) !== norm(x.categoria_manual_id) || a.categoria_modo !== (x.categoria_manual_id ? 'MANUAL' : 'AUTO'))) erro(a.codigo_interno + ': categoria ' + a.categoria_modo + ' ' + a.categoria_manual_id + ', pedida ' + x.categoria_manual_id);
      });
    }
    if (d.subtipo === 'IDENTIFICACAO_INCORRETA') {
      d.animais.forEach((x) => {
        const a = S.animais.get(x.animal_id);
        // O número corrigido é o que estava em uso na posição do lançamento (o substituto no lugar do original).
        const aj = S.t.AJUSTES.find((z) => z.event_id === eid && z.animal_id === x.animal_id && z.tipo_ajuste === 'IDENTIFICACAO_INCORRETA');
        const naPosicao = codigoNaPosicao(S, x.animal_id, { data: E.event_date, raiz: S.raiz(E), seq: E.event_seq }, eid);
        if (!aj || norm(aj.valor_anterior) !== norm(naPosicao)) erro(a.codigo_interno + ': corrigiu o brinco ' + (aj && aj.valor_anterior) + ', mas na posição do lançamento o brinco em uso era ' + naPosicao);
        const depois = S.t.IDENTIFICACOES.some((y) => y.animal_id === x.animal_id && y.tipo === 'BRINCO' && S.vig.get(y.event_id) && y.event_id !== eid && (y.data_inicio > E.event_date || (y.data_inicio === E.event_date && (S.raiz(S.ev.get(y.event_id)) > S.raiz(E) || (S.raiz(S.ev.get(y.event_id)) === S.raiz(E) && S.ev.get(y.event_id).event_seq > E.event_seq)))));
        const outra = S.t.AJUSTES.some((z) => z.animal_id === x.animal_id && z.tipo_ajuste === 'IDENTIFICACAO_INCORRETA' && S.vig.get(z.event_id) && z.event_id !== eid);
        if (!depois && !outra && a.situacao_cadastral !== 'ANULADO' && norm(a.brinco) !== norm(x.brinco)) erro(a.codigo_interno + ': brinco ' + a.brinco + ', corrigido para ' + x.brinco);
      });
    }
    if (d.subtipo === 'CORRECAO_LOCALIZACAO') {
      d.animais.forEach((x) => {
        const l = linhaDe(x.animal_id);
        if (!l || l.pasto_destino_id !== x.pasto_destino_id) { erro('linha da correção de localização ' + JSON.stringify(l)); return; }
        if (ehUltima(x.animal_id) && S.animais.get(x.animal_id).pasto_atual_id !== x.pasto_destino_id) erro('pasto atual ' + S.animais.get(x.animal_id).pasto_atual_id + ' depois da correção para ' + x.pasto_destino_id);
      });
    }
  }
  return out;
}
/** Brinco em uso logo antes de uma posição (data, cadeia, sequência), pelas linhas cruas de IDENTIFICACOES. */
function codigoNaPosicao(S, animal, pos, exceto) {
  let aberto = null;
  S.t.IDENTIFICACOES.filter((y) => y.animal_id === animal && y.tipo === 'BRINCO' && y.event_id !== exceto && S.vig.get(y.event_id))
    .map((y) => { const e = S.ev.get(y.event_id); return { y, e, data: y.data_inicio, raiz: S.raiz(e), seq: e.event_seq }; })
    .filter((x) => x.data < pos.data || (x.data === pos.data && (x.raiz < pos.raiz || (x.raiz === pos.raiz && x.seq < pos.seq))))
    .sort((a, b) => cmp(a.data, b.data) || a.raiz - b.raiz || a.seq - b.seq)
    .forEach((x) => { aberto = x.e.event_type === 'IDENTIFICACAO' && x.e.event_subtype === 'REMOCAO' ? null : x.y.codigo; });
  return aberto;
}
const CAMPOS_CONFERIDOS = ['sexo', 'data_nascimento', 'mae_id', 'pai_id', 'origem'];
/** Correção de cadastro: a última de cada campo (na ordem de registro, com o substituto no lugar do original) vale. */
function conferirCorrecoes(S, eid, erro) {
  S.t.AJUSTES.filter((z) => z.event_id === eid && z.tipo_ajuste === 'CORRECAO_CADASTRO').forEach((z) => {
    if (CAMPOS_CONFERIDOS.indexOf(z.campo) < 0) return;
    const todas = S.t.AJUSTES.filter((y) => y.animal_id === z.animal_id && y.campo === z.campo && y.tipo_ajuste === 'CORRECAO_CADASTRO' && S.vig.get(y.event_id)).map((y) => ({ y, raiz: S.raiz(S.ev.get(y.event_id)), seq: S.ev.get(y.event_id).event_seq }));
    const u = ultimo(todas, (a, b) => a.raiz - b.raiz || a.seq - b.seq);
    const a = S.animais.get(z.animal_id);
    if (u && u.y.event_id === eid && a.situacao_cadastral !== 'ANULADO' && norm(a[z.campo]) !== norm(z.valor_novo)) erro(a.codigo_interno + ': ' + z.campo + ' = ' + a[z.campo] + ' depois da correção para ' + z.valor_novo);
  });
}

// ------------------------------------------------------------------ gerador ----
const INTERESSANTES = (S, ids) => {
  const out = [];
  (ids || []).forEach((id) => {
    const a = S.animais.get(id);
    if (!a) return;
    if (a.data_nascimento) { out.push(a.data_nascimento, somaDias(a.data_nascimento, -1), somaDias(a.data_nascimento, 1)); }
    (S.porAnimal.get(id) || []).forEach((l) => { out.push(l.data); if (l.efeito === -1) out.push(somaDias(l.data, 1)); });
    if (a.data_saida) out.push(a.data_saida, somaDias(a.data_saida, 1));
  });
  return out;
};
function dataPara(S, rnd, ids, opcoes) {
  const o = opcoes || {};
  const marco = S.marco || D0;
  const x = rnd();
  const inter = INTERESSANTES(S, ids).filter((d) => d >= marco || o.antiga);
  if (x < 0.35 && inter.length) return sorteio(rnd, inter);
  if (x < 0.42) return marco;
  if (x < 0.47) return HOJE;
  if (x < 0.49) return somaDias(HOJE, 1);
  if (x < (o.antiga ? 0.62 : 0.52)) return somaDias(marco, -1 - Math.floor(rnd() * 600));
  const dias = Math.round((Date.parse(HOJE) - Date.parse(marco)) / 86400000);
  return somaDias(marco, Math.floor(rnd() * (dias + 1)));
}
function brinco(rnd, S) {
  const x = rnd();
  if (x < 0.06) return null;
  // Números repetidos de propósito: o reaproveitamento (ligado e desligado), o zero à esquerda, o do vizinho.
  const usados = Array.from(S.animais.values()).map((a) => a.brinco).filter(Boolean);
  if (x < 0.18 && usados.length) return sorteio(rnd, usados);
  if (x < 0.22 && usados.length) return '0' + sorteio(rnd, usados);
  return String(1 + Math.floor(rnd() * 120));
}
const MOVEIS = (S) => Array.from(S.animais.values()).filter((a) => a.situacao_cadastral !== 'EXTERNO').map((a) => a.animal_id);
function animaisPara(S, rnd, D, max, filtro) {
  const todos = MOVEIS(S);
  const x = rnd();
  let base;
  // Foco: os animais dos últimos comandos aceitos, para encadear correções e estornos sobre o mesmo animal.
  const foco = (S.foco || []).filter((id) => todos.indexOf(id) >= 0 && filtro(id, presenca(S, id, D)));
  if (foco.length && rnd() < 0.35) base = foco;
  else if (x < 0.85) base = todos.filter((id) => filtro(id, presenca(S, id, D)));
  else if (x < 0.97) base = todos;
  else {
    const externos = Array.from(S.animais.values()).filter((a) => a.situacao_cadastral === 'EXTERNO').map((a) => a.animal_id);
    base = todos.concat([sorteio(rnd, externos.concat(['00000000-0000-4000-8000-00000000ffff']))]);
  }
  if (!base.length) base = todos;
  return base.length ? alguns(rnd, base, max) : [];
}
const fem = (S, id) => (S.animais.get(id) || {}).sexo === 'F';

/** Monta os dados de cada tipo a partir de uma especificação (a correção muda a especificação e monta de novo). */
function montarDados(sis, spec) {
  const s = spec;
  const P = sis.parceiros;
  if (s.tipo === 'TRANSFERENCIA') return { tipo: s.tipo, campos: { event_date: s.data, pasto_origem_id: s.origem, pasto_destino_id: s.destino }, animais: s.ids.map((animal_id) => ({ animal_id })) };
  if (s.tipo === 'MORTE' || s.tipo === 'DESCARTE') {
    const campos = { event_date: s.data };
    if (s.tipo === 'MORTE') { campos.causa = 'DOENCA'; if (s.valor) { campos.custo_valor = s.valor; campos.custo_conta_id = sis.custeio; if (s.vezes) campos.custo_parcelas_qtd = s.vezes; } }
    else { campos.destino = 'CONSUMO_PROPRIO'; campos.motivo = 'IDADE'; if (s.valor) { campos.receita_valor = s.valor; if (s.vezes) campos.receita_parcelas_qtd = s.vezes; } }
    return { tipo: s.tipo, campos, animais: s.ids.map((animal_id) => ({ animal_id })) };
  }
  if (s.tipo === 'DIVERGENCIA_CONTAGEM') return { tipo: 'AJUSTE_INVENTARIO', subtipo: 'DIVERGENCIA_CONTAGEM', campos: { event_date: s.data, justificativa: 'Faltou na contagem do curral' }, animais: s.ids.map((animal_id) => ({ animal_id })) };
  if (s.tipo === 'CORRECAO_LOCALIZACAO') return { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_LOCALIZACAO', campos: { event_date: s.data, justificativa: 'Achado em outro pasto' }, animais: [Object.assign({ animal_id: s.id, pasto_destino_id: s.destino }, s.origem ? { pasto_origem_id: s.origem } : {})] };
  if (s.tipo === 'RECLASSIFICACAO') return { tipo: 'AJUSTE_INVENTARIO', subtipo: 'RECLASSIFICACAO', campos: { event_date: s.data, justificativa: 'Categoria conferida no curral' }, animais: [{ animal_id: s.id, categoria_manual_id: s.cat }] };
  if (s.tipo === 'IDENTIFICACAO_INCORRETA') return { tipo: 'AJUSTE_INVENTARIO', subtipo: 'IDENTIFICACAO_INCORRETA', campos: { event_date: s.data, justificativa: 'Brinco digitado errado' }, animais: [{ animal_id: s.id, brinco: s.brinco }] };
  if (s.tipo === 'CORRECAO_CADASTRO') {
    const animais = [];
    s.itens.forEach((x) => {
      animais.push({ animal_id: x.id, campo: x.campo, valor_novo: x.valor });
      Object.keys(x.junto || {}).forEach((c) => animais.push({ animal_id: x.id, campo: c, valor_novo: x.junto[c] }));
    });
    return { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: s.data, justificativa: 'Conferido na ficha' }, animais };
  }
  if (s.tipo === 'IDENTIFICACAO') {
    return {
      tipo: s.tipo, subtipo: s.sub, campos: { event_date: s.data, tipo_identificacao: s.tipoIdent || 'BRINCO' },
      animais: s.itens.map((x) => { const it = { animal_id: x.id }; if (s.sub !== 'REMOCAO') it.codigo = x.codigo; if (s.sub !== 'PRIMEIRA_IDENTIFICACAO') it.motivo = 'PERDA'; return it; }),
    };
  }
  if (s.tipo === 'MARCACAO') {
    const campos = { event_date: s.data, acao: s.acao };
    if (s.motivo) campos.motivo_descarte = s.motivo;
    return { tipo: s.tipo, subtipo: s.sub, campos, animais: s.ids.map((animal_id) => ({ animal_id })) };
  }
  if (s.tipo === 'NASCIMENTO') {
    const campos = { event_date: s.data };
    if (s.pasto) campos.pasto_destino_id = s.pasto;
    if (s.pai) { campos.pai_id = s.pai; campos.pai_confianca = 'ESTIMADA'; }
    if (s.crias.length > 1) campos.tipo_parto = 'ASSISTIDO';
    return {
      tipo: s.tipo, campos, animais: [{ animal_id: s.mae }],
      crias: s.crias.map((c) => (c.situacao === 'VIVO' ? Object.assign({ situacao_nascimento: 'VIVO', sexo: c.sexo }, c.brinco ? { brinco: c.brinco } : {}, c.id ? { animal_id: c.id } : {}, c.peso ? { peso: c.peso, metodo_pesagem: 'BALANCA' } : {}) : { situacao_nascimento: 'NATIMORTO' })),
    };
  }
  if (s.tipo === 'ENTRADA_INICIAL' || s.tipo === 'OUTRA_ENTRADA') {
    if (s.volta) return { tipo: 'OUTRA_ENTRADA', campos: { event_date: s.data, description: 'Apareceu na divisa' }, animais: [{ animal_id: s.volta, pasto_destino_id: s.pasto }] };
    const campos = { event_date: s.data };
    if (s.tipo === 'OUTRA_ENTRADA') campos.description = 'Doação do vizinho';
    return { tipo: s.tipo, campos, animais: s.novos.map((n) => novoAnimal(n, s.tipo === 'ENTRADA_INICIAL')) };
  }
  if (s.tipo === 'COMPRA') {
    const itens = s.novos.map((n) => Object.assign(novoAnimal(n, false, true), n.brinco_origem ? { brinco_origem: n.brinco_origem } : {})).concat(s.voltas.map((id) => ({ animal_id: id })));
    const g = s.neg;
    const n = itens.length;
    itens.forEach((it, i) => Object.assign(it, itemNegocio(g, i)));
    const valor = Math.max(1, contaNegocio(g, n) + (g.desvio || 0));
    const campos = { event_date: s.data, partner_id: P.fornecedor, valor_animais: valor, pasto_destino_id: s.pasto };
    cabecalhoNegocio(g, campos);
    const custos = [];
    if (g.frete) custos.push({ tipo: 'FRETE', valor: g.frete, partner_id: P.transportador });
    if (g.outros) custos.push(Object.assign({ tipo: 'OUTRO', valor: g.outros, partner_id: P.corretor }, g.vezes ? { parcelas_qtd: g.vezes } : {}));
    return { tipo: s.tipo, campos, animais: itens, parcelas: parcelas(valor, g.parcelas, s.data), custos };
  }
  if (s.tipo === 'VENDA') {
    const g = s.neg;
    const n = s.ids.length;
    // Com o valor de cada animal, os valores somam a receita (bruto − desconto).
    const porValor = g.mod === 'VALOR' || (g.mod === 'LOTE' && g.criterio === 'VALOR_INDIVIDUAL');
    const bruto = Math.max(1, contaNegocio(g, n) + (porValor ? g.desconto || 0 : g.desvio || 0));
    const campos = { event_date: s.data, partner_id: P.comprador, finalidade: g.finalidade || 'RECRIA_ENGORDA', valor_bruto: bruto };
    cabecalhoNegocio(g, campos);
    if (g.desconto) campos.desconto_comercial = g.desconto;
    if (s.origem) campos.pasto_origem_id = s.origem;
    if (g.loteKg) campos.peso_vivo_total_kg = g.loteKg;
    const animais = s.ids.map((id, i) => { const it = Object.assign({ animal_id: id }, itemNegocio(g, i)); if (g.loteKg) delete it.peso; return it; });
    const receita = bruto - (g.desconto || 0);
    const deducoes = (g.deducoes || []).map((x) => Object.assign({ tipo: x.tipo, valor: x.valor }, x.retida ? { retida_pelo_comprador: true } : { partner_id: P.corretor }));
    return { tipo: s.tipo, campos, animais, parcelas: parcelas(Math.max(1, receita), g.parcelas, s.data), deducoes };
  }
  throw new Error('tipo sem montagem: ' + s.tipo);
}
/** A conta do negócio pela modalidade (conferência; no lote, o valor da nota, ou a soma pelo valor de cada animal). */
function contaNegocio(g, n) {
  const somar = (l, f) => l.slice(0, n).reduce((a, b) => a + f(b), 0);
  const kg10 = somar(g.pesos, (p) => Math.round(p * 10));
  if (g.mod === 'CABECA') return n * g.preco;
  if (g.mod === 'VALOR') return somar(g.valores, (v) => v);
  if (g.mod === 'KG_VIVO') return Math.round(kg10 * g.preco / 10);
  if (g.mod === 'ARROBA') return Math.round(somar(g.carcacas, (p) => Math.round(p * 10)) * g.preco / 150);
  if (g.mod === 'ARROBA_VIVO') return Math.round(kg10 * g.rend / 100 * g.preco / 150);
  return g.criterio === 'VALOR_INDIVIDUAL' ? somar(g.valores, (v) => v) : g.lote;
}
function itemNegocio(g, i) {
  const it = {};
  const lote = (c) => g.mod === 'LOTE' && g.criterio === c;
  if (g.mod === 'KG_VIVO' || g.mod === 'ARROBA_VIVO' || lote('PESO_VIVO')) it.peso = g.pesos[i];
  if (g.mod === 'VALOR' || lote('VALOR_INDIVIDUAL')) it.valor_individual = g.valores[i];
  if (g.mod === 'ARROBA' || lote('PESO_CARCACA')) it.peso_carcaca_kg = g.carcacas[i];
  if (lote('MANUAL')) it.base_manual = g.manual[i];
  return it;
}
function cabecalhoNegocio(g, campos) {
  campos.modalidade = g.mod === 'VALOR' ? 'CABECA' : g.mod === 'ARROBA_VIVO' ? 'ARROBA' : g.mod;
  if (g.mod !== 'VALOR' && g.mod !== 'LOTE') campos.preco_unitario = g.preco;
  if (g.mod === 'ARROBA') campos.base_peso = 'CARCACA';
  if (g.mod === 'ARROBA_VIVO') { campos.base_peso = 'VIVO'; campos.rendimento_carcaca_pct = g.rend; campos.rendimento_tipo = 'NEGOCIADO'; }
  if (g.mod === 'LOTE') { campos.criterio_rateio = g.criterio; if (g.criterio === 'MANUAL') campos.justificativa_rateio = 'Combinado na negociação'; }
}
function novoAnimal(n, inicial, compra) {
  const a = { sexo: n.sexo, pasto_destino_id: n.pasto };
  if (!compra) a.origem = n.origem || 'DESCONHECIDA';
  if (n.brinco) a.brinco = n.brinco;
  if (n.id) a.animal_id = n.id;
  if (n.nasc) { a.data_nascimento = n.nasc; a.data_nascimento_confianca = 'ESTIMADA'; } else if (n.idade !== undefined) a.idade_meses = n.idade;
  if (n.sexo === 'M') { a.castrado = !!n.castrado; a.reprodutor = !n.castrado && !!n.reprodutor; }
  if (n.mae && !compra) { a.mae_id = n.mae; a.mae_confianca = 'CONFIRMADA'; }
  if (n.pai && !compra) { a.pai_id = n.pai; a.pai_confianca = 'ESTIMADA'; }
  if (n.sexo === 'F' && n.prenha) { a.situacao_reprodutiva = 'PRENHA'; a.data_prevista_parto = n.prenha; }
  if (inicial) {
    if (n.entrada) { a.data_entrada = n.entrada; a.data_entrada_confianca = 'ESTIMADA'; }
    if (n.peso) { a.peso = n.peso; a.metodo_pesagem = 'BALANCA'; }
    if (n.abertura) a.valor_abertura = n.abertura;
  }
  if (n.rfid) a.outras_identificacoes = [{ tipo: 'RFID', codigo: n.rfid }];
  return a;
}
function parcelas(valor, p, data) {
  const venc = (i) => somaDias(data, 30 * (i + 1));
  if (p.modo === 'vazias') return Array.from({ length: p.n }, (_, i) => ({ data_vencimento: venc(i) }));
  const vs = valor >= p.n ? dividir(valor, p.n) : [valor];
  if (p.modo === 'erro') vs[vs.length - 1] += 1;
  if (p.modo === 'nenhuma') return [];
  return vs.map((v, i) => ({ data_vencimento: venc(i), valor: v }));
}
function novoSpecAnimal(sis, S, rnd, data, inicial) {
  const sexo = rnd() < 0.55 ? 'F' : 'M';
  const n = { sexo, pasto: sorteio(rnd, Object.values(sis.pastos)), brinco: brinco(rnd, S) };
  const x = rnd();
  if (x < 0.6) n.nasc = rnd() < 0.15 ? sorteio(rnd, [data, somaDias(data, 1), somaDias(data, -1)]) : somaDias(data, -30 - Math.floor(rnd() * 3000));
  else if (x < 0.85) n.idade = Math.floor(rnd() * 120);
  if (sexo === 'M') { n.castrado = rnd() < 0.5; n.reprodutor = !n.castrado && rnd() < 0.4; }
  const femeas = MOVEIS(S).filter((id) => fem(S, id));
  const machos = MOVEIS(S).filter((id) => !fem(S, id)).concat(sis.externo ? [sis.externo] : []);
  if (rnd() < 0.25) n.mae = sorteio(rnd, rnd() < 0.85 ? femeas : MOVEIS(S));
  if (rnd() < 0.2) n.pai = sorteio(rnd, rnd() < 0.85 ? machos : MOVEIS(S));
  if (sexo === 'F' && rnd() < 0.15) n.prenha = somaDias(data, 20 + Math.floor(rnd() * 200));
  if (inicial) {
    if (rnd() < 0.3) n.entrada = n.nasc && rnd() < 0.2 ? somaDias(n.nasc, -10) : somaDias(data, -1 - Math.floor(rnd() * 900));
    if (rnd() < 0.3) n.peso = 50 + Math.floor(rnd() * 5000) / 10;
    if (rnd() < 0.3) n.abertura = sorteio(rnd, [1, 2, 150000, 333333]);
  }
  if (rnd() < 0.1) n.rfid = '9820000' + Math.floor(rnd() * 1000);
  return n;
}
function negocio(rnd, n, venda) {
  const x = rnd();
  const pr = { n: 1 + Math.floor(rnd() * 3), modo: pesado(rnd, [['vazias', 4], ['explicitas', 4], ['erro', 1], ['nenhuma', 0.5]]) };
  const g = { parcelas: pr, pesos: Array.from({ length: n + 3 }, () => 150 + Math.floor(rnd() * 4000) / 10), carcacas: Array.from({ length: n + 3 }, () => 120 + Math.floor(rnd() * 2000) / 10), valores: Array.from({ length: n + 3 }, () => sorteio(rnd, [1, 2, 99999, 250000 + Math.floor(rnd() * 100) * 1000])) };
  g.manual = Array.from({ length: n + 3 }, () => sorteio(rnd, [0.0001, 1, 2.5, 33.3333]));
  if (x < 0.32) Object.assign(g, { mod: 'CABECA', preco: sorteio(rnd, [1, 333333, 250000, 199999]) });
  else if (x < 0.56) Object.assign(g, { mod: 'KG_VIVO', preco: 900 + Math.floor(rnd() * 600) });
  else if (x < 0.68) Object.assign(g, { mod: 'ARROBA', preco: 28000 + Math.floor(rnd() * 5000) });
  else if (x < 0.76) Object.assign(g, { mod: 'ARROBA_VIVO', preco: 28000 + Math.floor(rnd() * 5000), rend: 48 + Math.floor(rnd() * 80) / 10 });
  else if (x < 0.9) Object.assign(g, { mod: 'LOTE', criterio: sorteio(rnd, ['CABECAS', 'PESO_VIVO', 'PESO_CARCACA', 'VALOR_INDIVIDUAL', 'MANUAL']), lote: sorteio(rnd, [1, 2, 100000 + Math.floor(rnd() * 5000000)]) });
  else Object.assign(g, { mod: 'VALOR' });
  if (rnd() < 0.15) g.desvio = sorteio(rnd, [1, -1, 5000, -5000]);
  if (venda) {
    if (rnd() < 0.15) g.desconto = sorteio(rnd, [1, 5000, 5000, 99999999]);
    if (rnd() < 0.5) g.deducoes = [{ tipo: sorteio(rnd, ['COMISSAO', 'FRETE', 'TAXA_FRIGORIFICO']), valor: sorteio(rnd, [1, 2, 4500]) }].concat(rnd() < 0.5 ? [{ tipo: 'FUNRURAL', valor: sorteio(rnd, [1, 1500, 1500, 99999999]), retida: true }] : []);
    if (g.mod === 'KG_VIVO' && rnd() < 0.2) g.loteKg = Math.round(g.pesos.slice(0, n).reduce((a, b) => a + b, 0) * 10) / 10;
    if (rnd() < 0.15) g.finalidade = 'ABATE';
  } else {
    if (rnd() < 0.4) g.frete = sorteio(rnd, [1, 2, 12345]);
    if (rnd() < 0.2) { g.outros = sorteio(rnd, [3, 7777]); if (rnd() < 0.5) g.vezes = 2; }
  }
  return g;
}

/** Uma proposta de registro de um tipo (especificação); null quando não há como montar. */
function propor(sis, S, rnd, tipo) {
  const P = Object.values(sis.pastos);
  const D = dataPara(S, rnd, [], { antiga: tipo === 'NASCIMENTO' });
  if (tipo === 'ENTRADA_INICIAL') {
    const data = rnd() < 0.9 ? S.marco || D0 : D;
    return { tipo, data, novos: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => novoSpecAnimal(sis, S, rnd, data, true)) };
  }
  if (tipo === 'OUTRA_ENTRADA') {
    if (rnd() < 0.5) {
      const fora = MOVEIS(S).filter((id) => ['VENDIDO', 'DESCARTADO', 'BAIXADO_AJUSTE', 'HISTORICO'].indexOf(S.animais.get(id).situacao_cadastral) >= 0);
      const id = rnd() < 0.8 && fora.length ? sorteio(rnd, fora) : sorteio(rnd, MOVEIS(S));
      if (!id) return null;
      return { tipo, data: dataPara(S, rnd, [id]), volta: id, pasto: sorteio(rnd, P) };
    }
    return { tipo, data: D, novos: [novoSpecAnimal(sis, S, rnd, D, false)] };
  }
  if (tipo === 'COMPRA') {
    const fora = MOVEIS(S).filter((id) => ['VENDIDO', 'DESCARTADO', 'BAIXADO_AJUSTE', 'HISTORICO'].indexOf(S.animais.get(id).situacao_cadastral) >= 0);
    const voltas = rnd() < 0.25 && fora.length ? [sorteio(rnd, rnd() < 0.85 ? fora : MOVEIS(S))] : [];
    const data = voltas.length ? dataPara(S, rnd, voltas) : D;
    const novos = Array.from({ length: voltas.length && rnd() < 0.5 ? 0 : 1 + Math.floor(rnd() * 3) }, () => novoSpecAnimal(sis, S, rnd, data, false));
    novos.forEach((n) => { if (rnd() < 0.3) n.brinco_origem = 'V' + Math.floor(rnd() * 20); });
    if (!novos.length && !voltas.length) return null;
    return { tipo, data, pasto: sorteio(rnd, P), novos, voltas, neg: negocio(rnd, novos.length + voltas.length, false) };
  }
  if (tipo === 'NASCIMENTO') {
    const maes = animaisPara(S, rnd, D, 1, (id, p) => p.dia && fem(S, id));
    if (!maes.length) return null;
    const data = rnd() < 0.5 ? dataPara(S, rnd, maes, { antiga: true }) : D;
    const crias = [{ situacao: rnd() < 0.85 ? 'VIVO' : 'NATIMORTO', sexo: rnd() < 0.5 ? 'F' : 'M', brinco: brinco(rnd, S), peso: rnd() < 0.3 ? 30 : null }];
    if (rnd() < 0.3) crias.push(rnd() < 0.5 ? { situacao: 'NATIMORTO' } : { situacao: 'VIVO', sexo: 'M', brinco: brinco(rnd, S) });
    const machos = MOVEIS(S).filter((id) => !fem(S, id)).concat(sis.externo ? [sis.externo] : []);
    return { tipo, data, mae: maes[0], crias, pai: rnd() < 0.4 ? sorteio(rnd, rnd() < 0.85 ? machos : MOVEIS(S)) : null, pasto: rnd() < 0.3 ? sorteio(rnd, P) : null };
  }
  if (tipo === 'TRANSFERENCIA') {
    const origem = sorteio(rnd, P);
    const ids = animaisPara(S, rnd, D, 3, (id, p) => p.fim && p.pasto === origem);
    if (!ids.length) return null;
    const data = rnd() < 0.4 ? dataPara(S, rnd, ids) : D;
    return { tipo, data, origem, destino: rnd() < 0.92 ? sorteio(rnd, P.filter((p) => p !== origem)) : origem, ids };
  }
  if (tipo === 'VENDA' || tipo === 'MORTE' || tipo === 'DESCARTE' || tipo === 'DIVERGENCIA_CONTAGEM') {
    const ids = animaisPara(S, rnd, D, tipo === 'VENDA' ? 3 : 2, (id, p) => p.fim);
    if (!ids.length) return null;
    const data = rnd() < 0.4 ? dataPara(S, rnd, ids) : D;
    const spec = { tipo, data, ids };
    if (tipo === 'VENDA') { spec.neg = negocio(rnd, ids.length, true); if (rnd() < 0.2) spec.origem = sorteio(rnd, P); }
    else if (tipo !== 'DIVERGENCIA_CONTAGEM' && rnd() < 0.4) { spec.valor = sorteio(rnd, [1, 2, 25000]); if (rnd() < 0.3) spec.vezes = 3; }
    return spec;
  }
  if (tipo === 'IDENTIFICACAO') {
    const ids = animaisPara(S, rnd, D, 2, (id, p) => p.dia);
    if (!ids.length) return null;
    const sub = sorteio(rnd, ['PRIMEIRA_IDENTIFICACAO', 'SUBSTITUICAO', 'SUBSTITUICAO', 'REMOCAO']);
    const data = rnd() < 0.4 ? dataPara(S, rnd, ids) : D;
    return { tipo, sub, data, tipoIdent: rnd() < 0.9 ? 'BRINCO' : sorteio(rnd, ['RFID', 'TATUAGEM', 'BRINCO_ORIGEM']), itens: ids.map((id) => ({ id, codigo: brinco(rnd, S) || String(80 + Math.floor(rnd() * 20)) })) };
  }
  if (tipo === 'MARCACAO') {
    const ids = animaisPara(S, rnd, D, 2, (id, p) => p.dia);
    if (!ids.length) return null;
    const sub = sorteio(rnd, ['DESCARTE', 'NAO_LOCALIZADO']);
    const marcado = (S.animais.get(ids[0]) || {})[sub === 'DESCARTE' ? 'marcado_descarte' : 'nao_localizado'] === true;
    const acao = rnd() < 0.8 ? (marcado ? 'DESMARCAR' : 'MARCAR') : (marcado ? 'MARCAR' : 'DESMARCAR');
    return { tipo, sub, acao, data: rnd() < 0.4 ? dataPara(S, rnd, ids) : D, ids, motivo: sub === 'DESCARTE' && acao === 'MARCAR' && rnd() < 0.5 ? 'IDADE' : null };
  }
  if (tipo === 'CORRECAO_LOCALIZACAO') {
    const ids = animaisPara(S, rnd, D, 1, (id, p) => p.fim);
    if (!ids.length) return null;
    const data = rnd() < 0.4 ? dataPara(S, rnd, ids) : D;
    const onde = presenca(S, ids[0], data).pasto;
    return { tipo, data, id: ids[0], destino: rnd() < 0.9 ? sorteio(rnd, P.filter((p) => p !== onde)) : onde, origem: rnd() < 0.2 ? sorteio(rnd, P) : null };
  }
  if (tipo === 'RECLASSIFICACAO') {
    const ids = animaisPara(S, rnd, D, 1, (id, p) => p.dia);
    if (!ids.length) return null;
    const sexo = (S.animais.get(ids[0]) || {}).sexo;
    const cats = sis.categorias.filter((c) => rnd() < 0.85 ? c.sexo === sexo || c.sexo === 'AMBOS' : true);
    return { tipo, data: rnd() < 0.4 ? dataPara(S, rnd, ids) : D, id: ids[0], cat: rnd() < 0.2 ? null : (sorteio(rnd, cats) || {}).id || null };
  }
  if (tipo === 'IDENTIFICACAO_INCORRETA') {
    const ids = animaisPara(S, rnd, D, 1, (id, p) => p.dia);
    if (!ids.length) return null;
    return { tipo, data: rnd() < 0.5 ? dataPara(S, rnd, ids) : D, id: ids[0], brinco: brinco(rnd, S) || '99' };
  }
  if (tipo === 'CORRECAO_CADASTRO') {
    const ids = animaisPara(S, rnd, D, 1, () => true);
    if (!ids.length) return null;
    return { tipo, data: rnd() < 0.5 ? dataPara(S, rnd, ids) : D, itens: [correcaoAleatoria(sis, S, rnd, ids[0])] };
  }
  return null;
}
/** Uma correção de cadastro escolhida para provocar: sexo de mãe ou touro, nascimento depois do filho ou na véspera do primeiro registro, mãe macho, ciclo. */
function correcaoAleatoria(sis, S, rnd, id) {
  const c = correcaoSo(sis, S, rnd, id);
  // A confiança vai junto com a data, a mãe e o pai (o formulário pede as duas); às vezes falta, de propósito.
  const conf = { data_nascimento: 'data_nascimento_confianca', data_entrada: 'data_entrada_confianca', mae_id: 'mae_confianca', pai_id: 'pai_confianca' }[c.campo];
  if (conf && c.valor && rnd() < 0.9) c.junto = { [conf]: c.campo === 'mae_id' || c.campo === 'pai_id' ? 'CONFIRMADA' : 'ESTIMADA' };
  if (c.campo === 'castrado' && c.valor === 'S' && rnd() < 0.9) c.junto = { reprodutor: 'N' };
  return c;
}
function correcaoSo(sis, S, rnd, id) {
  const a = S.animais.get(id) || {};
  const campo = pesado(rnd, [['sexo', 3], ['data_nascimento', 4], ['mae_id', 3], ['pai_id', 2], ['data_entrada', 2], ['castrado', 1], ['origem', 1], ['data_nascimento_confianca', 0.5]]);
  const todos = MOVEIS(S);
  if (campo === 'sexo') return { id, campo, valor: a.sexo === 'M' ? 'F' : 'M' };
  if (campo === 'data_nascimento') {
    const filhos = todos.filter((x) => (S.animais.get(x).mae_id === id || S.animais.get(x).pai_id === id) && S.animais.get(x).data_nascimento).map((x) => S.animais.get(x).data_nascimento);
    const ls = S.linhasDe(id);
    const op = [somaDias(D0, -400 - Math.floor(rnd() * 2000)), '', somaDias(HOJE, 1)].concat(filhos.map((f) => somaDias(f, rnd() < 0.5 ? 0 : 1)), ls.length ? [ls[0].data, somaDias(ls[0].data, 1)] : []);
    return { id, campo, valor: sorteio(rnd, op) };
  }
  if (campo === 'mae_id' || campo === 'pai_id') {
    const filhos = todos.filter((x) => S.animais.get(x).mae_id === id || S.animais.get(x).pai_id === id);
    const op = todos.filter((x) => x !== id).concat(filhos, [id, '', sis.externo]);
    return { id, campo, valor: sorteio(rnd, op) || '' };
  }
  if (campo === 'data_entrada') return { id, campo, valor: sorteio(rnd, [somaDias(D0, -1 - Math.floor(rnd() * 900)), a.data_nascimento ? somaDias(a.data_nascimento, -1) : '', somaDias(D0, 5), ''].filter((x) => x !== undefined)) };
  if (campo === 'castrado') return { id, campo, valor: a.castrado ? 'N' : 'S' };
  if (campo === 'origem') return { id, campo, valor: sorteio(rnd, ['NASCIDO', 'COMPRADO', 'DESCONHECIDA']) };
  return { id, campo, valor: sorteio(rnd, ['CONFIRMADA', 'ESTIMADA', 'DESCONHECIDA']) };
}
/** Muda a especificação de um lançamento gravado para a correção. */
function mutar(sis, S, rnd, spec) {
  const s = js(spec);
  const P = Object.values(sis.pastos);
  const x = rnd();
  const ids = s.ids || (s.id ? [s.id] : s.itens ? s.itens.map((i) => i.id) : s.mae ? [s.mae] : s.voltas || []);
  if (x < 0.3 && s.tipo !== 'ENTRADA_INICIAL') s.data = dataPara(S, rnd, ids, { antiga: s.tipo === 'NASCIMENTO' });
  else if (x < 0.5) {
    // Tirar ou pôr animal (a cria que vira natimorta, o animal da compra que sai e fica anulado).
    if (s.ids && s.ids.length > 1 && rnd() < 0.6) s.ids.splice(Math.floor(rnd() * s.ids.length), 1);
    else if (s.ids) { const mais = MOVEIS(S).filter((id) => s.ids.indexOf(id) < 0 && presenca(S, id, s.data).fim); if (mais.length) s.ids.push(sorteio(rnd, mais)); }
    else if (s.novos && s.novos.length > 1 && rnd() < 0.6) s.novos.splice(Math.floor(rnd() * s.novos.length), 1);
    else if (s.novos && s.tipo !== 'OUTRA_ENTRADA') s.novos.push(novoSpecAnimal(sis, S, rnd, s.data, s.tipo === 'ENTRADA_INICIAL'));
    else if (s.crias) {
      const vivas = s.crias.filter((c) => c.situacao === 'VIVO');
      if (vivas.length && rnd() < 0.5) sorteio(rnd, vivas).situacao = 'NATIMORTO';
      else if (s.crias.length < 4) s.crias.push({ situacao: 'VIVO', sexo: rnd() < 0.5 ? 'F' : 'M', brinco: brinco(rnd, S) });
    }
  } else if (x < 0.7) {
    // Valores e atributos (campos não estruturais, e o que o animal criado é).
    if (s.neg) s.neg = Object.assign(negocio(rnd, (s.ids || []).length + (s.novos || []).length + (s.voltas || []).length, s.tipo === 'VENDA'), rnd() < 0.5 ? { mod: s.neg.mod, preco: s.neg.preco } : {});
    else if (s.novos && s.novos.length) {
      const n = sorteio(rnd, s.novos);
      const c = sorteio(rnd, ['sexo', 'nasc', 'mae', 'brinco', 'entrada', 'pasto']);
      if (c === 'sexo') { n.sexo = n.sexo === 'M' ? 'F' : 'M'; if (n.sexo === 'M') { n.castrado = false; n.reprodutor = false; } }
      if (c === 'nasc') n.nasc = somaDias(s.data, rnd() < 0.3 ? 1 : -1 - Math.floor(rnd() * 3000));
      if (c === 'mae') n.mae = sorteio(rnd, MOVEIS(S));
      if (c === 'brinco') n.brinco = brinco(rnd, S);
      if (c === 'entrada') n.entrada = somaDias(s.data, -1 - Math.floor(rnd() * 4000));
      if (c === 'pasto') n.pasto = sorteio(rnd, P);
    } else if (s.crias) { s.pai = rnd() < 0.5 ? null : sorteio(rnd, MOVEIS(S).concat([sis.externo])); }
    else if (s.itens && s.tipo === 'CORRECAO_CADASTRO') s.itens = [correcaoAleatoria(sis, S, rnd, s.itens[0].id)];
    else if (s.itens) s.itens.forEach((i) => { i.codigo = brinco(rnd, S) || '77'; });
    else if (s.tipo === 'RECLASSIFICACAO') s.cat = rnd() < 0.3 ? null : sorteio(rnd, sis.categorias).id;
    else if (s.tipo === 'IDENTIFICACAO_INCORRETA') s.brinco = brinco(rnd, S) || '98';
    else if (s.destino) s.destino = sorteio(rnd, P);
    else if (s.valor !== undefined || s.tipo === 'MORTE' || s.tipo === 'DESCARTE') s.valor = rnd() < 0.3 ? 0 : sorteio(rnd, [1, 7777]);
    else if (s.acao) s.acao = s.acao === 'MARCAR' ? 'DESMARCAR' : 'MARCAR';
  } else if (x < 0.8 && s.pasto) s.pasto = sorteio(rnd, P);
  return s;
}

/** CSV de importação de um tipo, montado com os brincos de hoje (às vezes de propósito errado). */
function arquivoImportacao(sis, S, rnd, tipo) {
  const P = sis.nomePasto;
  const pastoNome = () => sorteio(rnd, Object.values(P));
  const ativos = MOVEIS(S).filter((id) => S.animais.get(id).situacao_cadastral === 'ATIVO' && S.animais.get(id).brinco);
  const comBrinco = MOVEIS(S).filter((id) => S.animais.get(id).brinco);
  const b = (id) => S.animais.get(id).brinco;
  const data = () => { const d = dataPara(S, rnd, [], { antiga: true }); return d > HOJE ? HOJE : d; };
  const qual = () => (rnd() < 0.85 && ativos.length ? sorteio(rnd, ativos) : sorteio(rnd, comBrinco));
  if (tipo === 'ANIMAIS') {
    const linhas = ['brinco;sexo;nascimento;pasto;mae;castrado;reprodutor'];
    const n = 1 + Math.floor(rnd() * 3);
    const noArquivo = [];
    for (let i = 0; i < n; i++) {
      const sexo = rnd() < 0.5 ? 'F' : 'M';
      const bb = brinco(rnd, S) || String(100 + i);
      const nasc = rnd() < 0.8 ? br(somaDias(S.marco || D0, -100 - Math.floor(rnd() * 2000))) : '';
      const maes = MOVEIS(S).filter((id) => fem(S, id) && S.animais.get(id).brinco).map(b).concat(noArquivo);
      const mae = rnd() < 0.3 ? sorteio(rnd, maes) || '' : '';
      linhas.push([bb, sexo, nasc, pastoNome(), mae, sexo === 'M' ? (rnd() < 0.5 ? 'S' : 'N') : '', sexo === 'M' ? 'N' : ''].join(';'));
      if (sexo === 'F') noArquivo.push(bb);
    }
    return { texto: linhas.join('\n'), mapa: { colunas: { brinco: 'brinco', sexo: 'sexo', nascimento: 'data_nascimento', pasto: 'pasto', mae: 'mae', castrado: 'castrado', reprodutor: 'reprodutor' }, confiancas: { data_nascimento: 'ESTIMADA', mae: 'CONFIRMADA' }, padroes: {} } };
  }
  if (tipo === 'TRANSFERENCIAS') {
    const linhas = ['data;origem;destino;brinco'];
    for (let i = 0; i < 1 + Math.floor(rnd() * 3); i++) {
      const id = qual();
      if (!id) break;
      const d = data();
      const onde = presenca(S, id, d).pasto;
      const origem = onde && rnd() < 0.8 ? P[onde] : pastoNome();
      linhas.push([br(d), origem, sorteio(rnd, Object.values(P).filter((x) => x !== origem)), b(id)].join(';'));
    }
    return { texto: linhas.join('\n'), mapa: { colunas: { data: 'data', origem: 'pasto_origem', destino: 'pasto_destino', brinco: 'brinco' }, confiancas: {}, padroes: {} } };
  }
  if (tipo === 'MORTES') {
    const linhas = ['data;causa;brinco'];
    for (let i = 0; i < 1 + Math.floor(rnd() * 2); i++) { const id = qual(); if (id) linhas.push([br(data()), sorteio(rnd, ['doença', 'raio', 'picada de cobra']), b(id)].join(';')); }
    return { texto: linhas.join('\n'), mapa: { colunas: { data: 'data', causa: 'causa', brinco: 'brinco' }, confiancas: {}, padroes: {} } };
  }
  if (tipo === 'NASCIMENTOS') {
    const linhas = ['data;mae;situacao;sexo;cria'];
    const maes = MOVEIS(S).filter((id) => fem(S, id) && S.animais.get(id).brinco);
    const mae = sorteio(rnd, rnd() < 0.9 && maes.length ? maes : comBrinco);
    if (!mae) return null;
    const d = br(data());
    for (let i = 0; i < 1 + (rnd() < 0.3 ? 1 : 0); i++) {
      const vivo = rnd() < 0.85;
      linhas.push([d, b(mae), vivo ? 'vivo' : 'natimorto', vivo ? (rnd() < 0.5 ? 'M' : 'F') : '', vivo ? brinco(rnd, S) || '' : ''].join(';'));
    }
    return { texto: linhas.join('\n'), mapa: { colunas: { data: 'data', mae: 'mae', situacao: 'situacao', sexo: 'sexo', cria: 'brinco' }, confiancas: {}, padroes: {} } };
  }
  if (tipo === 'COMPRAS') {
    const linhas = ['grupo;data;fornecedor;modalidade;valor;preco;brinco;sexo;pasto'];
    const n = 1 + Math.floor(rnd() * 2);
    const preco = sorteio(rnd, [200000, 1, 333333]);
    const d = br(data());
    for (let i = 0; i < n; i++) {
      const volta = rnd() < 0.25 && comBrinco.length ? b(sorteio(rnd, comBrinco)) : null;
      linhas.push([i === 0 ? 'C1' : 'C1', i === 0 ? d : '', i === 0 ? 'Fazenda Vizinha' : '', i === 0 ? 'cabeça' : '', i === 0 ? reais(preco * n) : '', i === 0 ? reais(preco) : '', volta || brinco(rnd, S) || String(200 + i), rnd() < 0.5 ? 'M' : 'F', pastoNome()].join(';'));
    }
    return { texto: linhas.join('\n'), mapa: { colunas: { grupo: 'grupo', data: 'data', fornecedor: 'fornecedor', modalidade: 'modalidade', valor: 'valor_animais', preco: 'preco', brinco: 'brinco', sexo: 'sexo', pasto: 'pasto' }, confiancas: {}, padroes: { castrado: false, reprodutor: false } } };
  }
  if (tipo === 'VENDAS') {
    const linhas = ['grupo;data;comprador;finalidade;modalidade;preco;bruto;brinco'];
    const ids = alguns(rnd, ativos.length ? ativos : comBrinco, 2);
    if (!ids.length) return null;
    const preco = sorteio(rnd, [250000, 1]);
    const d = br(data());
    ids.forEach((id, i) => linhas.push([i === 0 ? 'V1' : 'V1', i === 0 ? d : '', i === 0 ? 'Frigorífico Boi Bom' : '', i === 0 ? sorteio(rnd, ['abate', 'recria e engorda']) : '', i === 0 ? 'cabeça' : '', i === 0 ? reais(preco) : '', i === 0 ? reais(preco * ids.length) : '', b(id)].join(';')));
    return { texto: linhas.join('\n'), mapa: { colunas: { grupo: 'grupo', data: 'data', comprador: 'comprador', finalidade: 'finalidade', modalidade: 'modalidade', preco: 'preco', bruto: 'valor_bruto', brinco: 'brinco' }, confiancas: {}, padroes: {} } };
  }
  return null;
}

/**
 * O próximo comando (concreto): {rota, dados, avisos, aceitar, simular, dvVelha, chaveDe, spec, rotulo}. A importação
 * em curso tende a continuar (validar, importar, concluir); às vezes outro comando entra no meio.
 */
function gerar(sis, S, rnd, k) {
  const em = S.t.IMPORTACOES.filter((i) => ['RASCUNHO', 'VALIDADO', 'IMPORTANDO'].indexOf(i.status) >= 0);
  const base = { avisos: rnd() < 0.5 ? AVISOS : [], aceitar: rnd() < 0.9, simular: rnd() < 0.25 };
  if (!S.marco && rnd() < 0.5) return Object.assign(base, { rota: 'config.salvar', dados: { valores: { data_marco_zero: sorteio(rnd, [D0, somaDias(D0, -31), somaDias(HOJE, 3)]) } }, rotulo: 'marco zero' });
  if (em.length && rnd() < 0.6) {
    const imp = sorteio(rnd, em);
    const memo = sis.imps.get(imp.import_id);
    const o = sis.api('importacao.obter', { import_id: imp.import_id });
    if (memo && o.ok) {
      const est = o.data;
      if (rnd() < 0.08) return Object.assign(base, { rota: 'importacao.desfazer', dados: { import_id: imp.import_id, justificativa: 'Arquivo errado' }, rotulo: 'desfazer em curso' });
      if (imp.status === 'RASCUNHO') {
        const bloco = (memo.validado || 0) + 1 + (rnd() < 0.05 ? 1 : 0);
        return Object.assign(base, { rota: 'importacao.validarBloco', dados: { import_id: imp.import_id, bloco, mapeamento: memo.mapa }, rotulo: 'validar ' + bloco });
      }
      if (imp.status === 'VALIDADO') {
        const c = est.contadores;
        if (!c.validas && rnd() < 0.9) return Object.assign(base, { rota: 'importacao.desfazer', dados: { import_id: imp.import_id, justificativa: 'Nada a importar' }, rotulo: 'desfazer sem linha válida' });
        if (rnd() < 0.25 || memo.revalidar) return Object.assign(base, { rota: 'importacao.validarBloco', dados: { import_id: imp.import_id, bloco: 1, mapeamento: memo.mapa }, rotulo: 'validar de novo' });
        const fora = c.erro + c.duplicadas;
        const dados = { import_id: imp.import_id, bloco: 1, modo: fora && rnd() < 0.9 ? 'PARCIAL_APROVADO' : 'TOTAL' };
        if (dados.modo === 'PARCIAL_APROVADO') dados.aprovacao = { importar: c.validas, ignorar: fora + (rnd() < 0.05 ? 1 : 0) };
        return Object.assign(base, { rota: 'importacao.importarBloco', dados, rotulo: 'importar 1' });
      }
      if (est.blocos.proximo !== null && rnd() < 0.9) return Object.assign(base, { rota: 'importacao.importarBloco', dados: { import_id: imp.import_id, bloco: est.blocos.proximo }, rotulo: 'importar ' + est.blocos.proximo });
      return Object.assign(base, { rota: 'importacao.concluir', dados: { import_id: imp.import_id }, rotulo: 'concluir' });
    }
  }
  const acao = pesado(rnd, [
    ['registrar', 55], ['corrigir', 14], ['estornar', 11], ['editar', 5], ['reuso', 2], ['zeros', 0.6], ['marco', 1],
    ['importar', 4], ['desfazer', 1.5], ['reenvio', 1.5], ['versao', 1],
  ]);
  if (acao === 'registrar') {
    const tipo = pesado(rnd, [
      ['ENTRADA_INICIAL', S.linhas.length < 10 ? 20 : 3], ['OUTRA_ENTRADA', 4], ['COMPRA', 9], ['VENDA', 9], ['TRANSFERENCIA', 9], ['MORTE', 5], ['DESCARTE', 3],
      ['NASCIMENTO', 9], ['IDENTIFICACAO', 6], ['MARCACAO', 4], ['CORRECAO_CADASTRO', 4], ['IDENTIFICACAO_INCORRETA', 2], ['CORRECAO_LOCALIZACAO', 3],
      ['RECLASSIFICACAO', 3], ['DIVERGENCIA_CONTAGEM', 3],
    ]);
    const spec = propor(sis, S, rnd, tipo);
    if (!spec) return null;
    return Object.assign(base, { rota: 'evento.registrar', dados: montarDados(sis, spec), spec, rotulo: tipo });
  }
  if (acao === 'corrigir' || acao === 'estornar') {
    const evs = S.t.EVENTOS.filter((e) => S.op.get(e.op_id) === 'CONFIRMADA');
    const vig = evs.filter((e) => S.vig.get(e.event_id));
    const recentes = vig.slice(-4);
    let alvo = rnd() < 0.4 && recentes.length ? sorteio(rnd, recentes) : rnd() < 0.9 ? sorteio(rnd, vig) : sorteio(rnd, evs);
    if (acao === 'corrigir') {
      const comSpec = (rnd() < 0.9 ? vig : evs).filter((e) => sis.specs.has(e.event_id));
      alvo = rnd() < 0.4 ? sorteio(rnd, comSpec.slice(-3)) : sorteio(rnd, comSpec);
      if (!alvo) return null;
      const memo = sis.specs.get(alvo.event_id);
      const spec = rnd() < 0.15 ? js(memo.spec) : mutar(sis, S, rnd, memo.spec);
      const dados = Object.assign(montarDados(sis, spec), { event_id: alvo.event_id, justificativa: 'Corrigindo o lançamento' });
      return Object.assign(base, { rota: 'evento.corrigir', dados, spec, rotulo: 'corrigir ' + alvo.event_type + (alvo.reversal_of_event_id ? ' (substituto)' : '') });
    }
    if (!alvo) return null;
    return Object.assign(base, { rota: 'evento.estornar', dados: { event_id: alvo.event_id, justificativa: 'Lançado errado' }, rotulo: 'estornar ' + alvo.event_type });
  }
  if (acao === 'editar') {
    const id = sorteio(rnd, MOVEIS(S).concat(sis.externo ? [sis.externo] : []));
    if (!id) return null;
    const c = correcaoAleatoria(sis, S, rnd, id);
    const campos = Object.assign({ [c.campo]: c.valor }, c.junto || {});
    if (rnd() < 0.3) campos.nome = sorteio(rnd, ['Mimosa', 'Estrela', 'Valente']);
    return Object.assign(base, { rota: 'animal.editar', dados: Object.assign({ animal_id: id, campos }, rnd() < 0.95 ? { justificativa: 'Conferido na ficha' } : {}), rotulo: 'editar ' + c.campo });
  }
  if (acao === 'reuso') return Object.assign(base, { rota: 'config.salvar', dados: { valores: { brinco_permite_reuso: S.reuso ? 'N' : 'S' } }, rotulo: 'reuso' });
  if (acao === 'zeros') return Object.assign(base, { rota: 'config.salvar', dados: { valores: { brinco_ignora_zeros_esquerda: S.config.get('brinco_ignora_zeros_esquerda') === 'S' ? 'N' : 'S' } }, rotulo: 'zeros' });
  if (acao === 'marco') return Object.assign(base, { rota: 'config.salvar', dados: { valores: { data_marco_zero: sorteio(rnd, [D0, somaDias(D0, -31), somaDias(D0, 14), somaDias(HOJE, 3)]) } }, rotulo: 'marco zero' });
  if (acao === 'importar') {
    const tipo = sorteio(rnd, ['ANIMAIS', 'ANIMAIS', 'TRANSFERENCIAS', 'MORTES', 'NASCIMENTOS', 'COMPRAS', 'VENDAS']);
    const arq = arquivoImportacao(sis, S, rnd, tipo);
    if (!arq) return null;
    return Object.assign(base, { rota: 'importacao.criar', dados: { tipo, arquivo_nome: tipo.toLowerCase() + '-' + k + '.csv', texto: arq.texto, formato: FORMATO }, mapa: arq.mapa, rotulo: 'importar ' + tipo });
  }
  if (acao === 'desfazer') {
    const imp = sorteio(rnd, S.t.IMPORTACOES.filter((i) => i.status !== 'CANCELADO'));
    if (!imp) return null;
    return Object.assign(base, { rota: 'importacao.desfazer', dados: { import_id: imp.import_id, justificativa: 'Arquivo errado' }, rotulo: 'desfazer ' + imp.status });
  }
  if (acao === 'reenvio') {
    const ult = sis.ultimoAceito;
    if (!ult) return null;
    return Object.assign({}, ult.cmd, { chaveDe: ult.k, reenvio: true, simular: false, rotulo: 'reenvio do passo ' + ult.k });
  }
  if (acao === 'versao') {
    const spec = propor(sis, S, rnd, 'TRANSFERENCIA');
    if (!spec) return null;
    return Object.assign(base, { rota: 'evento.registrar', dados: montarDados(sis, spec), spec, dvVelha: true, rotulo: 'versão velha' });
  }
  return null;
}

// ------------------------------------------------------------------ execução de um passo ----
const chaveDo = (k) => 'fz-' + k;
/**
 * Executa um comando concreto (passo k) e roda os oráculos. Devolve {falhas, r}.
 */
function executar(sis, k, cmd, antesT, opcoes) {
  const o = opcoes || {};
  const A = estado(antesT);
  const dv0 = sis.versao();
  const falhas = [];
  const chave = cmd.chaveDe !== undefined ? chaveDo(cmd.chaveDe) : chaveDo(k);
  const extra = { idempotencyKey: chave, avisosAceitos: cmd.avisos || [] };
  if (cmd.dvVelha) extra.dataVersionEsperada = dv0 - 1;
  let sim = null;
  if (cmd.simular && !cmd.dvVelha && /^evento\.(registrar|corrigir|estornar)$/.test(cmd.rota)) {
    sim = sis.api('evento.simular', { acao: cmd.rota.split('.')[1], dados: cmd.dados }, { avisosAceitos: cmd.avisos || [] });
  }
  let r;
  try {
    r = sis.api(cmd.rota, cmd.dados, extra);
  } catch (e) {
    return { falhas: [falha('EXCECAO', String(e && e.stack || e).slice(0, 1500))], r: null };
  }
  let depoisT = tabelas(sis);
  let conferida = false;
  if (!r.ok && r.error && r.error.code === 'NEEDS_CONFIRMATION') {
    falhas.push(...oraculoRecusa(sis, cmd, r, A, estado(depoisT), dv0, sis.versao(), chave));
    conferida = true;
    if (cmd.aceitar) {
      conferida = false;
      const codigos = Array.from(new Set((r.error.details || []).map((d) => d.codigo)));
      const dados = codigos.indexOf('PERIODO_BLOQUEADO') >= 0 ? Object.assign({}, cmd.dados, { justificativa_aviso: 'Conferido com o pecuarista' }) : cmd.dados;
      r = sis.api(cmd.rota, dados, Object.assign({}, extra, { avisosAceitos: (cmd.avisos || []).concat(codigos) }));
      depoisT = tabelas(sis);
      if (!r.ok && r.error.code === 'NEEDS_CONFIRMATION') falhas.push(falha('AVISO:REPETIDO', 'aceitos os avisos, o comando pediu confirmação de novo: ' + JSON.stringify(r.error.details.map((d) => d.codigo))));
    }
  }
  const S = estado(depoisT);
  const dv1 = sis.versao();
  if (!r.ok) {
    if (!conferida) falhas.push(...oraculoRecusa(sis, cmd, r, A, S, dv0, dv1, chave));
    if (cmd.dvVelha && r.error.code !== 'CONFLICT') falhas.push(falha('VERSAO', 'com a versão velha, ' + r.error.code + ' ' + r.error.message));
  } else {
    if (cmd.dvVelha) falhas.push(falha('VERSAO', 'aceito com dataVersionEsperada velha'));
    if (cmd.reenvio) {
      if (!r.meta.duplicado) falhas.push(falha('REENVIO', 'o reenvio com a mesma chave não foi tratado como duplicado'));
      if (dv1 !== dv0 || JSON.stringify(contagens(depoisT)) !== JSON.stringify(contagens(antesT))) falhas.push(falha('REENVIO', 'o reenvio duplicado gravou'));
    } else if (r.meta && r.meta.duplicado) falhas.push(falha('REENVIO', 'comando novo tratado como duplicado'));
    else if (!r.meta || !r.meta.semAlteracao) falhas.push(...oraculoEfeito(sis, cmd, r.data, A, S));
  }
  // A simulação é consulta: corre com a importação em curso, que só recusa o comando (desenho-base 16.8).
  if (sim && !(r.ok === false && r.error.code === 'CONFLICT' && A.emCurso.length)) {
    const real = r.ok ? 'OK' : r.error.code;
    const simulado = sim.ok ? (sim.data.avisos && sim.data.avisos.length && !(cmd.avisos || []).length ? 'AVISOS' : 'OK') : sim.error.code;
    const compativel = simulado === real || (simulado === 'AVISOS' && (real === 'NEEDS_CONFIRMATION' || real === 'OK')) || (simulado === 'OK' && real === 'NEEDS_CONFIRMATION') || real === 'IDEMPOTENCY_MISMATCH';
    if (!compativel) falhas.push(falha('SIMULACAO', 'simulação ' + simulado + ' ' + JSON.stringify(sim.error || '').slice(0, 400) + ' × comando ' + real + ' ' + JSON.stringify(r.error || '').slice(0, 400)));
  }
  const datas = [];
  const d = cmd.dados || {};
  if (d.campos && d.campos.event_date) datas.push(d.campos.event_date, somaDias(d.campos.event_date, -1));
  if (!o.semGlobal) falhas.push(...oraculoGlobal(sis, S, datas));
  return { falhas, r, depoisT, S };
}

/** Atualiza a memória do gerador depois de um passo aceito (especificação do lançamento, importação, último aceito). */
function memorizar(sis, k, cmd, r, A, S) {
  // "Valide de novo": a confirmação recusou porque o resultado da validação mudou.
  if (r && !r.ok && cmd.rota === 'importacao.importarBloco' && r.error.code === 'CONFLICT' && sis.imps.has(cmd.dados.import_id)) sis.imps.get(cmd.dados.import_id).revalidar = true;
  if (!r || !r.ok) return;
  // Sem alteração não há operação nem chave gravada: o reenvio dele seria um comando novo.
  if (!cmd.reenvio && !(r.meta && r.meta.semAlteracao)) sis.ultimoAceito = { k, cmd };
  if (r.data && Array.isArray(r.data.animais)) sis.foco = r.data.animais.map((a) => a.animal_id).concat(sis.foco || []).slice(0, 4);
  if (cmd.rota === 'importacao.criar') sis.imps.set(r.data.import_id, { mapa: cmd.mapa, validado: 0 });
  if (cmd.rota === 'importacao.validarBloco') { const m = sis.imps.get(cmd.dados.import_id); if (m) { m.validado = cmd.dados.bloco; m.revalidar = false; } }
  if (cmd.spec && r.data && r.data.event_id && /^evento\.(registrar|corrigir)$/.test(cmd.rota)) {
    // Os animais que o lançamento criou vão com o mesmo animal_id na correção: o item novo recebe o animal criado, na
    // ordem do código interno (a ordem de criação, que é a dos itens).
    const eid = r.data.event_id;
    const ls = S.t.EVENTO_ANIMAIS.filter((l) => l.event_id === eid);
    const novos = ls.map((l) => l.animal_id).filter((id, i, a) => a.indexOf(id) === i && !A.animais.has(id)).sort((a, b) => cmp((S.animais.get(a) || {}).codigo_interno || '', (S.animais.get(b) || {}).codigo_interno || ''));
    const spec = js(cmd.spec);
    let n = 0;
    (spec.novos || []).forEach((x) => { if (!x.id) x.id = novos[n++] || null; });
    (spec.crias || []).forEach((c) => { if (c.situacao !== 'VIVO') delete c.id; else if (!c.id) c.id = novos[n++] || null; });
    sis.specs.set(eid, { spec });
  }
}

// ------------------------------------------------------------------ sequências, repetição e encolhimento ----
function opcoesDaSemente(semente) {
  const rnd = aleatorio(semente ^ 0x5bd1e995);
  return { ordem: rnd() < 0.5 ? 'alpha' : 'reverse', reuso: rnd() < 0.5, vazio: rnd() < 0.12 };
}
/** Roda uma semente: gera e executa `passos` comandos. {semente, opcoes, comandos (simbólicos), falha, k, stats}. */
function rodar(semente, passos) {
  const opcoes = opcoesDaSemente(semente);
  const sis = montar(opcoes);
  const rnd = aleatorio(semente);
  const log = [];
  const stats = { aceitos: 0, recusados: 0, porRotulo: {} };
  let t = tabelas(sis);
  const inicial = oraculoGlobal(sis, estado(t), []);
  if (inicial.length) return { semente, opcoes, comandos: [], falha: inicial[0], falhas: inicial, k: -1, stats };
  for (let k = 0; k < passos; k++) {
    const S = estado(t);
    S.foco = sis.foco;
    const cmd = gerar(sis, S, rnd, k);
    if (!cmd) continue;
    log.push(Object.assign({ k }, gravavel(sis, cmd)));
    const ex = executar(sis, k, cmd, t);
    const rot = cmd.rotulo || cmd.rota;
    stats.porRotulo[rot] = stats.porRotulo[rot] || { ok: 0, recusa: {} };
    if (ex.r && ex.r.ok) { stats.aceitos++; stats.porRotulo[rot].ok++; } else if (ex.r) {
      stats.recusados++;
      const det = (ex.r.error.details || [])[0];
      if (process.env.FUZZ_LOG_TRAVA && det && /^INTEGRIDADE_/.test(det.codigo)) console.log('TRAVA semente ' + semente + ' passo ' + k + ' ' + rot + ' ' + ex.r.error.code + ' ' + det.codigo + ': ' + det.mensagem);
      const c = ex.r.error.code + (det ? ':' + det.codigo : '');
      stats.porRotulo[rot].recusa[c] = (stats.porRotulo[rot].recusa[c] || 0) + 1;
    }
    if (ex.falhas.length) return { semente, opcoes, comandos: log, falha: ex.falhas[0], falhas: ex.falhas, k, stats };
    nomear(sis, k, t, ex.depoisT);
    memorizar(sis, k, cmd, ex.r, estado(t), ex.S);
    t = ex.depoisT;
  }
  return { semente, opcoes, comandos: log, falha: null, stats };
}
function gravavel(sis, cmd) {
  const o = { rota: cmd.rota, dados: simbolizar(sis, cmd.dados), avisos: cmd.avisos, aceitar: cmd.aceitar };
  if (cmd.simular) o.simular = true;
  if (cmd.dvVelha) o.dvVelha = true;
  if (cmd.chaveDe !== undefined) { o.chaveDe = cmd.chaveDe; o.reenvio = true; }
  if (cmd.rotulo) o.rotulo = cmd.rotulo;
  return o;
}
/**
 * Repete uma sequência simbólica num sistema novo; devolve a primeira falha ({assinatura, mensagem, k}) ou null.
 * Comando cujo símbolo ficou sem dono (o passo que o criava saiu) é pulado.
 */
function reproduzir(opcoes, comandos, sisFora) {
  const sis = montar(opcoes);
  if (sisFora) { sisFora.sis = sis; sisFora.resultados = {}; }
  let t = tabelas(sis);
  const inicial = oraculoGlobal(sis, estado(t), []);
  if (inicial.length) return Object.assign({ k: -1 }, inicial[0]);
  for (const c of comandos) {
    const faltou = [];
    const dados = resolver(sis, c.dados, faltou);
    if (faltou.length) continue;
    const cmd = Object.assign({}, c, { dados });
    const ex = executar(sis, c.k, cmd, t);
    if (sisFora && ex.r) sisFora.resultados[c.k] = ex.r.ok ? 'OK' : ex.r.error.code + ':' + (ex.r.error.details || []).map((d) => d.codigo).join(',');
    if (ex.falhas.length) return Object.assign({ k: c.k }, ex.falhas[0]);
    nomear(sis, c.k, t, ex.depoisT);
    t = ex.depoisT;
  }
  return null;
}
/** ddmin: a menor sequência (de comandos inteiros) que ainda falha com a mesma assinatura. */
function encolher(opcoes, comandos, assinatura, limite) {
  let atual = comandos.slice();
  const falhaIgual = (l) => { const f = reproduzir(opcoes, l); return !!f && f.assinatura === assinatura; };
  let n = 2;
  let tentativas = 0;
  const max = limite || 400;
  // A falha acontece no último comando: os posteriores já não existem.
  while (atual.length >= 2 && tentativas < max) {
    const tam = Math.ceil(atual.length / n);
    let reduziu = false;
    for (let i = 0; i < n && tentativas < max; i++) {
      const sem = atual.slice(0, i * tam).concat(atual.slice((i + 1) * tam));
      if (!sem.length) continue;
      tentativas++;
      if (falhaIgual(sem)) { atual = sem; n = Math.max(n - 1, 2); reduziu = true; break; }
    }
    if (!reduziu) {
      if (n >= atual.length) break;
      n = Math.min(atual.length, n * 2);
    }
  }
  return { comandos: atual, tentativas };
}
function relatorio(r, minimo) {
  return 'FUZZ: semente ' + r.semente + ' (opções ' + JSON.stringify(r.opcoes) + ') falhou no passo ' + r.k + ' [' + r.falha.assinatura + ']: ' + r.falha.mensagem +
    '\nSequência mínima (' + minimo.length + ' comandos):\n' + JSON.stringify({ opcoes: r.opcoes, assinatura: r.falha.assinatura, comandos: minimo }, null, 1);
}

module.exports = { D0, HOJE, AVISOS, aleatorio, montar, tabelas, estado, presenca, oraculoGlobal, oraculoEfeito, oraculoRecusa, gerar, executar, rodar, reproduzir, encolher, relatorio, opcoesDaSemente };
