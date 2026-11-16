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
 * - Registro único dos tipos (seção "registro dos tipos de evento"): cada tipo de evento declara o seu gerador (proposta,
 *   montagem dos dados, o que a correção muda, a especificação pelas linhas gravadas) e o seu oráculo de efeito com
 *   `registrarTipo`, e cada tipo de importação o seu arquivo com `registrarImportador`; o resto do motor só consulta os
 *   registros. Um tipo novo (Fases 3 e 4) entra acrescentando a entrada, e tests/fase2.fuzz.test.js confere que todo tipo
 *   ativo do catálogo tem a sua.
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
const AVISOS = ['POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'BRINCO_PARECIDO', 'IDADE_REPRODUTIVA', 'INTERVALO_PARTO_CURTO', 'VALOR_DIVERGENTE', 'RATEIO_SEM_PESO', 'CARENCIA_ATIVA', 'CATEGORIAS_SEM_COBERTURA', 'PESO_IMPLAUSIVEL', 'ESTOQUE_INSUFICIENTE', 'PRODUTO_VENCIDO'];
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
    // Vazio na montagem: o pasto que o gerador desativa e reativa no meio da sequência.
    D: ok('pasto.salvar', { campos: { property_id: prop, nome: 'Pasto D', area_hectares: 2, posse: 'PROPRIO' } }).pasture_id,
  };
  sis.nomePasto = { [sis.pastos.A]: 'Pasto A', [sis.pastos.B]: 'Pasto B', [sis.pastos.C]: 'Pasto C', [sis.pastos.D]: 'Pasto D' };
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
  // Sanidade e insumos (Fase 3, E3.2 e E3.3): a vacina e o antibiótico com estoque controlado, o vermífugo sem; o protocolo
  // da vacina a cada 180 dias. Criados depois do rebanho de base, para os identificadores dele (que as regressões fixas
  // citam crus) não mudarem.
  const produto = (campos) => ok('produto.salvar', { campos }).product_id;
  sis.produtos = {
    vacina: produto({ nome: 'Vacina F', categoria: 'VACINA', unidade: 'dose', fator_conversao: 50, custo_unitario: 1.85, controla_estoque: true }),
    vermifugo: produto({ nome: 'Vermífugo F', categoria: 'VERMIFUGO', unidade: 'mL', custo_unitario: 0.035, controla_estoque: false }),
    antibiotico: produto({ nome: 'Antibiótico F', categoria: 'MEDICAMENTO', unidade: 'mL', custo_unitario: 0.5, controla_estoque: true }),
  };
  sis.protocolo = ok('protocolo.salvar', { campos: { nome: 'Vacina F semestral', tipo_procedimento: 'VACINA', product_id: sis.produtos.vacina, sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180 } }).protocol_id;
  // Nomes estáveis do que a montagem cria, para a sequência gravada ficar legível e repetível.
  const nomear0 = (id, nome) => { sis.sim.set(id, nome); sis.uuid.set(nome, id); };
  Object.keys(sis.pastos).forEach((k) => nomear0(sis.pastos[k], '@p:' + k));
  Object.keys(sis.parceiros).forEach((k) => nomear0(sis.parceiros[k], '@f:' + k));
  nomear0(sis.externo, '@x');
  nomear0(sis.prop, '@r:base');
  nomear0(sis.custeio, '@conta');
  Object.keys(sis.produtos).forEach((k) => nomear0(sis.produtos[k], '@v:' + k));
  nomear0(sis.protocolo, '@q:vacina');
  sis.categorias.forEach((c) => nomear0(c.id, '@c:' + c.codigo));
  tabelas(sis).LISTAS.forEach((x) => nomear0(x.lista_id, '@l:' + x.lista + ':' + x.codigo));
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
  if (typeof v === 'string' && /^@(\d+\.[aeipcflrnms]\d+|[bpfcrvq]:\w+|l:\w+:\w+|x|conta)$/.test(v)) { if (!sis.uuid.has(v)) { faltou.push(v); return v; } return sis.uuid.get(v); }
  if (Array.isArray(v)) return v.map((x) => resolver(sis, x, faltou));
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach((k) => { o[k] = resolver(sis, v[k], faltou); }); return o; }
  return v;
}
/** Dá nome aos registros que o passo k criou (animais, eventos, importações), na ordem das linhas. */
function nomear(sis, k, antes, depois) {
  // Passada 3: também os cadastros criados no meio (pasto, categoria, parceiro, item de lista).
  [['ANIMAIS', 'animal_id', 'a'], ['EVENTOS', 'event_id', 'e'], ['IMPORTACOES', 'import_id', 'i'], ['PASTOS', 'pasture_id', 'p'], ['CATEGORIAS', 'category_id', 'c'], ['PARCEIROS', 'partner_id', 'f'], ['LISTAS', 'lista_id', 'l'], ['PROPRIEDADES', 'property_id', 'r'], ['ANEXOS', 'anexo_id', 'n'], ['FINANCEIRO', 'financial_id', 'm'], ['ESTACOES_MONTA', 'estacao_id', 's']].forEach(([aba, pk, l]) => {
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
  // Cadastro desativado (03a, seções 2.1 e 5): pasto INATIVO só sem animal no rebanho dentro dele; categoria desativada
  // só sem animal reclassificado à mão nela. Vale por qualquer caminho (estorno, correção, desfazer da importação).
  const pastoInativo = new Set(S.t.PASTOS.filter((p) => p.status !== 'ATIVO').map((p) => p.pasture_id));
  const catInativa = new Set(S.t.CATEGORIAS.filter((c) => c.ativo === false).map((c) => c.category_id));
  S.animais.forEach((a) => {
    // Passada 3: a propriedade atual é a do pasto em que o animal está (os pastos novos podem ser de outra propriedade).
    const pst = a.situacao_cadastral === 'ATIVO' && a.pasto_atual_id ? S.t.PASTOS.find((p) => p.pasture_id === a.pasto_atual_id) : null;
    if (pst && a.propriedade_atual_id !== pst.property_id) out.push(falha('REPLAY:PROPRIEDADE', a.codigo_interno + ' está no ' + pst.nome + ', da propriedade ' + pst.property_id + ', mas a propriedade atual gravada é ' + a.propriedade_atual_id));
    if (a.situacao_cadastral !== 'ATIVO' && a.propriedade_atual_id) out.push(falha('REPLAY:PROPRIEDADE', a.codigo_interno + ' (' + a.situacao_cadastral + ') com propriedade atual ' + a.propriedade_atual_id));
    if (a.situacao_cadastral === 'ATIVO' && pastoInativo.has(a.pasto_atual_id)) out.push(falha('REPLAY:PASTO_INATIVO', a.codigo_interno + ' está no rebanho dentro do pasto desativado ' + (sis.nomePasto[a.pasto_atual_id] || a.pasto_atual_id)));
    if (a.situacao_cadastral !== 'ANULADO' && a.situacao_cadastral !== 'PENDENTE' && a.categoria_modo === 'MANUAL' && catInativa.has(a.categoria_manual_id)) out.push(falha('REPLAY:CATEGORIA_INATIVA', a.codigo_interno + ' (' + a.situacao_cadastral + ') ficou na categoria desativada ' + a.categoria_manual_id));
  });
  // Brinco lançado errado: o número corrigido é o que estava em uso na posição do lançamento, em qualquer caminho
  // (registro, correção dele, correção ou estorno das identificações em volta).
  S.t.AJUSTES.forEach((z) => {
    if (z.tipo_ajuste !== 'IDENTIFICACAO_INCORRETA' || !S.vig.get(z.event_id)) return;
    const E = S.ev.get(z.event_id);
    const naPosicao = codigoNaPosicao(S, z.animal_id, { data: E.event_date, raiz: S.raiz(E), seq: E.event_seq }, z.event_id);
    if (norm(z.valor_anterior) !== norm(naPosicao)) out.push(falha('REPLAY:BRINCO_CORRIGIDO', (S.animais.get(z.animal_id) || {}).codigo_interno + ': o brinco lançado errado de ' + E.event_date + ' corrige ' + z.valor_anterior + ', mas o brinco em uso nessa posição é ' + naPosicao));
  });
  // Peso atual (03a, 4.3.3): a última pesagem vigente do animal (data, posição na cadeia, sequência), de qualquer método;
  // sem pesagem, vazio. Replay pelas linhas cruas de PESAGENS (Fase 3).
  const pesagensPor = new Map();
  S.t.PESAGENS.forEach((p) => { if (S.vig.get(p.event_id)) (pesagensPor.get(p.animal_id) || pesagensPor.set(p.animal_id, []).get(p.animal_id)).push(p); });
  S.animais.forEach((a, id) => {
    if (a.situacao_cadastral === 'ANULADO' || a.situacao_cadastral === 'PENDENTE' || a.situacao_cadastral === 'EXTERNO') return;
    const ps = (pesagensPor.get(id) || []).map((p) => ({ p, data: p.data_pesagem, raiz: S.raiz(S.ev.get(p.event_id)), seq: S.ev.get(p.event_id).event_seq }));
    const u = ps.length ? ultimo(ps) : null;
    const esperado = u ? [u.p.peso_kg, u.p.data_pesagem] : [null, null];
    if ((a.peso_atual === undefined ? null : a.peso_atual) !== esperado[0] || (a.data_ultima_pesagem || null) !== esperado[1]) out.push(falha('REPLAY:PESO_ATUAL', a.codigo_interno + ': peso atual gravado ' + JSON.stringify([a.peso_atual, a.data_ultima_pesagem]) + ', replay ' + JSON.stringify(esperado)));
  });
  // Reprodução e manejo (Fase 3, E3.4 e E3.5), pelas linhas cruas: a situação reprodutiva da fêmea com algum fato que a
  // decide é a do último (data, posição na cadeia, sequência) — exposição e cobertura EXPOSTA, inseminação INSEMINADA,
  // diagnóstico positivo PRENHA, negativo, parto e aborto VAZIA; o duvidoso e a desmama não decidem. O macho com castração
  // vigente é castrado e não é reprodutor.
  const fatoRepro = { EXPOSICAO: 'EXPOSTA', COBERTURA: 'EXPOSTA', INSEMINACAO: 'INSEMINADA', PARTO: 'VAZIA', ABORTO: 'VAZIA' };
  const reproPor = new Map();
  (S.t.REPRODUCAO || []).forEach((r) => {
    if (!S.vig.get(r.event_id)) return;
    const st = r.tipo_evento === 'DIAGNOSTICO_GESTACAO' ? (r.resultado === 'POSITIVO' ? 'PRENHA' : r.resultado === 'NEGATIVO' ? 'VAZIA' : null) : fatoRepro[r.tipo_evento] || null;
    if (!st) return;
    const E = S.ev.get(r.event_id);
    (reproPor.get(r.animal_id) || reproPor.set(r.animal_id, []).get(r.animal_id)).push({ st, data: r.data, raiz: S.raiz(E), seq: E.event_seq });
  });
  // E3.6: a situação declarada na entrada que criou o animal (a linha vigente com os atributos, a última pela posição na
  // cadeia e pela sequência) vale como o fato da data dela: os fatos de antes (o histórico importado) não a desfazem.
  const criacaoDe = new Map();
  S.t.EVENTO_ANIMAIS.forEach((l) => {
    if (!l.atributos_iniciais_json || !S.vig.get(l.event_id)) return;
    const E = S.ev.get(l.event_id);
    const c = criacaoDe.get(l.animal_id);
    if (!c || S.raiz(E) > c.raiz || (S.raiz(E) === c.raiz && E.event_seq > c.seq)) criacaoDe.set(l.animal_id, { raiz: S.raiz(E), seq: E.event_seq, data: E.event_date, sit: (l.atributos_iniciais_json || {}).situacao_reprodutiva || null });
  });
  S.animais.forEach((a, id) => {
    if (a.situacao_cadastral === 'ANULADO' || a.situacao_cadastral === 'PENDENTE' || a.situacao_cadastral === 'EXTERNO') return;
    const cr = criacaoDe.get(id);
    const fatos = (reproPor.get(id) || []).filter((x) => !cr || !cr.sit || x.data >= cr.data);
    if (a.sexo === 'F' && fatos && fatos.length && a.situacao_reprodutiva !== ultimo(fatos).st) out.push(falha('REPLAY:SITUACAO_REPRODUTIVA', a.codigo_interno + ': gravada ' + a.situacao_reprodutiva + ', replay ' + ultimo(fatos).st + ' (' + fatos.length + ' fatos)'));
    if (a.sexo === 'M' && S.linhasDe(id).some((l) => l.tipo === 'CASTRACAO') && (a.castrado !== true || a.reprodutor !== false)) out.push(falha('REPLAY:CASTRADO', a.codigo_interno + ' com castração vigente está castrado ' + a.castrado + ', reprodutor ' + a.reprodutor));
  });
  // Estoque (Fase 3, E3.2): o saldo do produto com estoque controlado = Σ dos movimentos vigentes (entrada +, saída −, acerto
  // com o sinal), pelas linhas cruas de MOVIMENTOS_ESTOQUE; sem controle, vazio.
  (S.t.PRODUTOS || []).forEach((p) => {
    const movs = (S.t.MOVIMENTOS_ESTOQUE || []).filter((mv) => mv.product_id === p.product_id && S.vig.get(mv.event_id));
    const esperado = p.controla_estoque === true ? movs.reduce((t, mv) => t + Math.round(mv.quantidade * 10000) * (mv.tipo === 'SAIDA' ? -1 : 1), 0) / 10000 : null;
    if ((p.estoque_atual === undefined || p.estoque_atual === '' ? null : p.estoque_atual) !== esperado) out.push(falha('REPLAY:ESTOQUE', p.nome + ': saldo gravado ' + p.estoque_atual + ', replay ' + esperado + ' (' + movs.length + ' movimentos, controle ' + p.controla_estoque + ')'));
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
  // Cadastros desativados e reativados no meio da sequência.
  // Passada 3: também criados e editados (todo campo pedido gravado; o novo é a única linha nova da aba).
  const CADASTRO = { 'propriedade.salvar': ['PROPRIEDADES', 'property_id'], 'pasto.salvar': ['PASTOS', 'pasture_id'], 'parceiro.salvar': ['PARCEIROS', 'partner_id'], 'categoria.salvar': ['CATEGORIAS', 'category_id'], 'lista.salvar': ['LISTAS', 'lista_id'], 'animal.cadastrarExterno': ['ANIMAIS', 'animal_id'], 'produto.salvar': ['PRODUTOS', 'product_id'], 'protocolo.salvar': ['PROTOCOLOS_SANITARIOS', 'protocol_id'], 'estacao.salvar': ['ESTACOES_MONTA', 'estacao_id'] }[cmd.rota];
  if (CADASTRO) {
    const [aba, pk] = CADASTRO;
    const lista = cmd.rota === 'lista.salvar' ? { [pk]: d.lista_id, campos: Object.fromEntries(['rotulo', 'ativo'].filter((c) => d[c] !== undefined).map((c) => [c, d[c]])) } : null;
    const itens = Array.isArray(d.categorias) ? d.categorias : [lista || { [pk]: d[pk], campos: d.campos || {} }];
    const velhos = new Set(A.t[aba].map((x) => x[pk]));
    const novas = S.t[aba].filter((x) => !velhos.has(x[pk]));
    const valor = (v) => (Array.isArray(v) ? v.slice().sort().join(',') : norm(v));
    const gravado = (v) => (Array.isArray(v) ? v.slice().sort().join(',') : typeof v === 'string' && v.indexOf(',') >= 0 && v === v.toUpperCase() ? v.split(',').map((x) => x.trim()).sort().join(',') : norm(v));
    itens.forEach((it) => {
      const r = it[pk] ? S.t[aba].find((x) => x[pk] === it[pk]) : novas.length === 1 ? novas[0] : null;
      if (!r) { erro(aba + ': ' + (it[pk] ? 'registro sumiu' : novas.length + ' linhas novas para um cadastro novo')); return; }
      Object.keys(it.campos || {}).forEach((c) => { if (gravado(r[c]) !== valor(it.campos[c])) erro(aba + ' ' + c + ' gravado ' + JSON.stringify(r[c]) + ', pedido ' + JSON.stringify(it.campos[c])); });
      if (cmd.rota === 'animal.cadastrarExterno' && r.situacao_cadastral !== 'EXTERNO') erro('touro de referência gravado ' + r.situacao_cadastral);
    });
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
  if (cmd.rota === 'anexo.adicionar' || cmd.rota === 'anexo.remover') {
    const id = cmd.rota === 'anexo.remover' ? d.anexo_id : resp && resp.anexo_id;
    const x = S.t.ANEXOS.find((y) => y.anexo_id === id);
    if (!x) { erro('anexo ' + id + ' não gravado'); return out; }
    if (x.status !== (cmd.rota === 'anexo.remover' ? 'REMOVIDO' : 'ATIVO')) erro('anexo ' + x.status + ' depois de ' + cmd.rota);
    if (cmd.rota === 'anexo.adicionar') {
      const ev = d.entidade === 'EVENTOS' ? d.entity_id : d.entidade === 'FINANCEIRO' ? (S.t.FINANCEIRO.find((f) => f.financial_id === d.entity_id) || {}).event_id : null;
      if (d.entidade !== 'ANIMAIS' && x.event_id !== ev) erro('anexo ligado ao evento ' + x.event_id + ', pedido ' + ev);
      if (d.entidade !== 'ANIMAIS' && !S.vig.get(ev)) erro('anexo aceito em evento que não vale');
      if (d.definir_como_foto && (S.animais.get(d.entity_id) || {}).foto_anexo_id !== id) erro('a foto não virou a foto principal do animal');
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
  // O efeito de cada tipo é da entrada dele no registro (registrarTipo, mais abaixo).
  const T = TIPOS.get(chaveDosDados(d));
  if (!T) { erro('tipo sem oráculo de efeito no registro do teste aleatório: ' + chaveDosDados(d)); return out; }
  T.efeito({ sis, cmd, d, resp, A, S, E, eid, pre, lsE, linhaDe, efeitoEsperado: efeito, ehUltima, novosDe, conferirNovo, erro });
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
  // Passada 4: o brinco com letra ou hífen (o parâmetro brinco_somente_numerico muda no meio).
  if (x < 0.26) return sorteio(rnd, ['A', 'B-', 'V']) + (1 + Math.floor(rnd() * 30));
  return String(1 + Math.floor(rnd() * 120));
}
const MOVEIS = (S) => Array.from(S.animais.values()).filter((a) => a.situacao_cadastral !== 'EXTERNO').map((a) => a.animal_id);
// Passada 3: os cadastros criados no meio da sequência (pasto, categoria, parceiro, touro de referência) entram nas escolhas.
const PASTOS_DE = (S) => S.t.PASTOS.map((p) => p.pasture_id);
const EXTERNOS = (S) => Array.from(S.animais.values()).filter((a) => a.situacao_cadastral === 'EXTERNO').map((a) => a.animal_id);
const CATEGORIAS_DE = (S) => S.t.CATEGORIAS.map((c) => ({ id: c.category_id, sexo: c.sexo_aplicavel, codigo: c.codigo }));
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
  if (n.raca) a.raca = n.raca;
  if (n.nasc) { a.data_nascimento = n.nasc; a.data_nascimento_confianca = 'ESTIMADA'; } else if (n.idade !== undefined) a.idade_meses = n.idade;
  if (n.sexo === 'M') { a.castrado = !!n.castrado; a.reprodutor = !n.castrado && !!n.reprodutor; }
  if (n.mae && !compra) { a.mae_id = n.mae; a.mae_confianca = 'CONFIRMADA'; }
  if (n.pai && !compra) { a.pai_id = n.pai; a.pai_confianca = 'ESTIMADA'; }
  if (n.sexo === 'F' && n.prenha) { a.situacao_reprodutiva = 'PRENHA'; a.data_prevista_parto = n.prenha; }
  if (inicial) {
    if (n.entrada) { a.data_entrada = n.entrada; a.data_entrada_confianca = 'ESTIMADA'; }
    if (n.peso) { a.peso = n.peso; a.metodo_pesagem = 'BALANCA'; }
    if (n.abertura) a.valor_abertura = n.abertura;
    if (n.partos) a.partos_previos = n.partos;
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
  const n = { sexo, pasto: sorteio(rnd, PASTOS_DE(S)), brinco: brinco(rnd, S) };
  if (rnd() < 0.15) n.raca = sorteio(rnd, ['NELORE', 'NELORE', 'ANGUS', 'CRUZADO']);
  const x = rnd();
  if (x < 0.6) n.nasc = rnd() < 0.15 ? sorteio(rnd, [data, somaDias(data, 1), somaDias(data, -1)]) : somaDias(data, -30 - Math.floor(rnd() * 3000));
  else if (x < 0.85) n.idade = Math.floor(rnd() * 120);
  if (sexo === 'M') { n.castrado = rnd() < 0.5; n.reprodutor = !n.castrado && rnd() < 0.4; }
  const femeas = MOVEIS(S).filter((id) => fem(S, id));
  const machos = MOVEIS(S).filter((id) => !fem(S, id)).concat(EXTERNOS(S));
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

// ------------------------------------------------------------------ registro dos tipos de evento ----
/**
 * O registro único dos tipos de evento do teste aleatório (o subtipo do ajuste conta como tipo). Cada entrada traz o
 * gerador e o oráculo do efeito do tipo; o resto do motor (o sorteio do "registrar", a correção, a correção para outro
 * tipo, a correção pelas linhas gravadas, a memória dos animais criados e o oráculo de cada passo) só consulta o registro.
 * Um tipo novo entra com `registrarTipo`, sem mexer no resto. A ordem de registro é a do sorteio: mudá-la muda as
 * sequências das sementes fixas. Campos da entrada:
 *  - peso(S): o peso do tipo no sorteio do "registrar";
 *  - propor(c) → especificação | null, com c = {sis, S, rnd, D (a data sorteada), P (os pastos)}; `dataAntiga`: D (e a
 *    data da correção) pode ser anterior ao marco zero;
 *  - montar(sis, spec) → os dados de evento.registrar e evento.corrigir (a propriedade escolhida, spec.prop, entra depois);
 *  - animais(spec) → os animais da especificação (a correção escolhe a data por eles); `mudaData` (padrão true);
 *  - mutarAnimais(c), mutarValores(c), mutarOutro(c): o que a correção muda, com c = {sis, S, rnd, s, P} (s muda no lugar);
 *  - criados(spec, proximo): o animal_id que o lançamento criou em cada item novo (a correção reaproveita o animal);
 *  - doGravado(c, e) → a especificação pelas linhas gravadas do evento e (o importado e o rebanho de base não têm a do
 *    gerador), com c = {sis, S, rnd, ls, idents, brincoDe, data, ids};
 *  - efeito(c): o oráculo do efeito do registro ou da correção aceitos (o contexto `c` está em oraculoEfeito).
 */
const TIPOS = new Map();
function registrarTipo(nome, def) {
  ['peso', 'propor', 'montar', 'animais', 'efeito'].forEach((k) => { if (typeof def[k] !== 'function') throw new Error('o tipo ' + nome + ' do teste aleatório está sem ' + k); });
  if (TIPOS.has(nome)) throw new Error('o tipo ' + nome + ' foi registrado duas vezes no teste aleatório');
  TIPOS.set(nome, Object.assign({ mudaData: true }, def));
}
function tipoDoRegistro(nome) {
  const T = TIPOS.get(nome);
  if (!T) throw new Error('tipo sem entrada no registro do teste aleatório: ' + nome);
  return T;
}
/** A chave do registro pelos dados do pedido (no ajuste, o subtipo) e pelo evento gravado. */
const chaveDosDados = (d) => (d.tipo === 'AJUSTE_INVENTARIO' ? d.subtipo : d.tipo);
const tipoDoSpec = (e) => (e.event_type === 'AJUSTE_INVENTARIO' ? e.event_subtype : e.event_type);

/** Uma proposta de registro de um tipo (especificação); null quando não há como montar. */
function propor(sis, S, rnd, tipo) {
  const T = tipoDoRegistro(tipo);
  const P = PASTOS_DE(S);
  const D = dataPara(S, rnd, [], { antiga: !!T.dataAntiga });
  return T.propor({ sis, S, rnd, D, P }) || null;
}
/** Monta os dados de cada tipo a partir de uma especificação (a correção muda a especificação e monta de novo). */
function montarDados(sis, spec) {
  const d = tipoDoRegistro(spec.tipo).montar(sis, spec);
  // Passada 3: a propriedade do lançamento escolhida (outra, desativada), em vez da padrão.
  if (spec.prop) d.campos.property_id = spec.prop;
  return d;
}
const linhasDosIds = (s) => s.ids.map((animal_id) => ({ animal_id }));
const SAIDA_DO_REBANHO = ['VENDIDO', 'DESCARTADO', 'BAIXADO_AJUSTE', 'HISTORICO'];

// --- o que a correção muda, por forma da especificação (as entradas do registro escolhem) ---
/** Tira um dos animais (com mais de um) ou põe um que está no rebanho no fim do dia. */
function mutarIds(c) {
  const { s, S, rnd } = c;
  if (s.ids.length > 1 && rnd() < 0.6) s.ids.splice(Math.floor(rnd() * s.ids.length), 1);
  else { const mais = MOVEIS(S).filter((id) => s.ids.indexOf(id) < 0 && presenca(S, id, s.data).fim); if (mais.length) s.ids.push(sorteio(rnd, mais)); }
}
/** Tira um animal novo (com mais de um) ou, quando `acrescenta`, põe outro (o animal da compra que sai fica anulado). */
function mutarNovos(c, acrescenta) {
  const { s, S, rnd, sis } = c;
  if (s.novos.length > 1 && rnd() < 0.6) s.novos.splice(Math.floor(rnd() * s.novos.length), 1);
  else if (acrescenta) s.novos.push(novoSpecAnimal(sis, S, rnd, s.data, s.tipo === 'ENTRADA_INICIAL'));
}
/** Um atributo de um animal novo (sexo, nascimento, mãe, brinco, chegada, pasto). */
function mutarNovoAnimal(c) {
  const { s, S, rnd, P } = c;
  if (!s.novos || !s.novos.length) return;
  const n = sorteio(rnd, s.novos);
  const campo = sorteio(rnd, ['sexo', 'nasc', 'mae', 'brinco', 'entrada', 'pasto']);
  if (campo === 'sexo') { n.sexo = n.sexo === 'M' ? 'F' : 'M'; if (n.sexo === 'M') { n.castrado = false; n.reprodutor = false; } }
  if (campo === 'nasc') n.nasc = somaDias(s.data, rnd() < 0.3 ? 1 : -1 - Math.floor(rnd() * 3000));
  if (campo === 'mae') n.mae = sorteio(rnd, MOVEIS(S));
  if (campo === 'brinco') n.brinco = brinco(rnd, S);
  if (campo === 'entrada') n.entrada = somaDias(s.data, -1 - Math.floor(rnd() * 4000));
  if (campo === 'pasto') n.pasto = sorteio(rnd, P);
}
/** Outro negócio; mantida a modalidade, vão junto os campos dela (passada 3: o lote mantido sem o critério e o valor dava NaN). */
function mutarNegocio(c) {
  const { s, rnd } = c;
  s.neg = Object.assign(negocio(rnd, (s.ids || []).length + (s.novos || []).length + (s.voltas || []).length, s.tipo === 'VENDA'), rnd() < 0.5 ? Object.fromEntries(['mod', 'preco', 'criterio', 'lote', 'rend'].filter((k) => s.neg[k] !== undefined).map((k) => [k, s.neg[k]])) : {});
}
/** Passada 4: os outros itens dos ajustes de um animal por item (tira um, ou põe outro animal). */
function mutarMais(c) {
  const { s, S, rnd } = c;
  if (s.mais && s.mais.length && rnd() < 0.5) s.mais.splice(Math.floor(rnd() * s.mais.length), 1);
  else if (s.id) {
    const outro = sorteio(rnd, MOVEIS(S).filter((id) => id !== s.id));
    if (outro) (s.mais = s.mais || []).push({ id: outro, cat: s.cat, brinco: brinco(rnd, S) || '97', destino: s.destino, origem: null });
  }
}
/** Os itens novos recebem os animais que o lançamento criou, na ordem dos itens. */
function criadosNovos(spec, proximo) { (spec.novos || []).forEach((x) => { if (!x.id) x.id = proximo(); }); }

// --- oráculos que mais de um tipo usa ---
/** O animal que sai: a linha com o efeito −1 e, sem lançamento posterior, fora do rebanho com a situação e a data de saída. */
function efeitoSaida(c) {
  const { d, S, E, erro, linhaDe, efeitoEsperado, pre, ehUltima } = c;
  (d.animais || []).forEach((x) => {
    const l = linhaDe(x.animal_id);
    if (!l || l.efeito_inventario !== efeitoEsperado(-1)) { erro('linha de saída errada: ' + JSON.stringify(l)); return; }
    if (pre) return;
    const a = S.animais.get(x.animal_id);
    if (ehUltima(x.animal_id) && (a.situacao_cadastral !== SAIDA[d.tipo] || a.data_saida !== E.event_date)) erro(a.codigo_interno + ' saiu (' + d.tipo + ') e está ' + a.situacao_cadastral + ' desde ' + a.data_saida);
    if (presenca(S, x.animal_id, E.event_date).fim) erro(a.codigo_interno + ' saiu e continua no rebanho no fim do dia ' + E.event_date);
  });
}
/** Morte, descarte e baixa na contagem: uma linha de BAIXAS por animal e o lançamento pedido (custo ou receita), ou nenhum. */
function efeitoBaixa(c) {
  const { d, S, eid, erro } = c;
  efeitoSaida(c);
  const bx = S.t.BAIXAS.filter((b) => b.event_id === eid);
  if (bx.length !== (d.animais || []).length) erro(bx.length + ' baixas para ' + d.animais.length + ' animais');
  const fins = S.t.FINANCEIRO.filter((f) => f.event_id === eid);
  const v = d.campos.custo_valor || d.campos.receita_valor || 0;
  if (JSON.stringify(fins.map((f) => f.valor)) !== JSON.stringify(v ? [v] : [])) erro('lançamento da saída ' + JSON.stringify(fins.map((f) => f.valor)) + ', pedido ' + v);
}
/** Rebanho inicial e outra entrada: as linhas +1, os animais novos como pedidos e a volta no rebanho. */
function efeitoEntrada(c) {
  const { d, S, erro, lsE, linhaDe, ehUltima, novosDe, conferirNovo } = c;
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
}
/** A entrada gravada (o rebanho de base da montagem e a entrada da importação de ANIMAIS), com os animais que ela criou como estão hoje. */
function entradaDoGravado(c, e) {
  const { S, ls, brincoDe, data, ids } = c;
  const t = e.event_type;
  const novos = [];
  const voltas = [];
  ids.forEach((id) => {
    const a = S.animais.get(id) || {};
    const l = ls.find((x) => x.animal_id === id);
    if (a.evento_origem_id !== e.event_id) { voltas.push({ id, pasto: l.pasto_destino_id || null }); return; }
    const n = { id, sexo: a.sexo, pasto: l.pasto_destino_id || null, brinco: brincoDe(id), origem: a.origem || 'DESCONHECIDA' };
    if (a.data_nascimento) n.nasc = a.data_nascimento;
    if (a.sexo === 'M') { n.castrado = a.castrado === true; n.reprodutor = a.reprodutor === true; }
    if (a.mae_id) n.mae = a.mae_id;
    if (a.pai_id) n.pai = a.pai_id;
    if (a.raca) n.raca = a.raca;
    if (t === 'ENTRADA_INICIAL') { if (a.data_entrada && a.data_entrada < data) n.entrada = a.data_entrada; if (a.partos_previos) n.partos = a.partos_previos; }
    if (a.sexo === 'F' && a.situacao_reprodutiva === 'PRENHA' && a.data_prevista_parto) n.prenha = a.data_prevista_parto;
    novos.push(n);
  });
  if (t === 'ENTRADA_INICIAL') return voltas.length || !novos.length ? null : { tipo: t, data, novos };
  if (voltas.length > 1) return null;
  if (voltas.length) return { tipo: t, data, volta: voltas[0].id, pasto: voltas[0].pasto, novos };
  return novos.length ? { tipo: t, data, novos } : null;
}
/** Saída de animais no rebanho no fim do dia (venda, morte, descarte, baixa na contagem). */
function proporSaida(c, tipo) {
  const { S, rnd, D, P } = c;
  const ids = animaisPara(S, rnd, D, tipo === 'VENDA' ? 3 : 2, (id, p) => p.fim);
  if (!ids.length) return null;
  const data = rnd() < 0.4 ? dataPara(S, rnd, ids) : D;
  const spec = { tipo, data, ids };
  if (tipo === 'VENDA') { spec.neg = negocio(rnd, ids.length, true); if (rnd() < 0.2) spec.origem = sorteio(rnd, P); if (rnd() < 0.2 && S.t.PARCEIROS.length) spec.parceiro = sorteio(rnd, S.t.PARCEIROS).partner_id; }
  // Passada 3: a causa, o motivo e o destino variam (os itens da lista são desativados no meio).
  if (tipo === 'MORTE' && rnd() < 0.4) spec.causa = sorteio(rnd, ['RAIO', 'ACIDENTE', 'PICADA_COBRA']);
  if (tipo === 'DESCARTE' && rnd() < 0.4) { spec.causa = sorteio(rnd, ['FALHA_REPRODUTIVA', 'IDADE']); spec.destinoDescarte = sorteio(rnd, ['DOACAO', 'CONSUMO_PROPRIO']); }
  else if (tipo !== 'DIVERGENCIA_CONTAGEM' && rnd() < 0.4) { spec.valor = sorteio(rnd, [1, 2, 25000]); if (rnd() < 0.3) spec.vezes = 3; }
  return spec;
}
/** Morte e descarte, com o custo ou a receita opcional. */
function montarBaixa(sis, s) {
  const campos = { event_date: s.data };
  if (s.tipo === 'MORTE') { campos.causa = s.causa || 'DOENCA'; if (s.valor) { campos.custo_valor = s.valor; campos.custo_conta_id = sis.custeio; if (s.vezes) campos.custo_parcelas_qtd = s.vezes; } }
  else { campos.destino = s.destinoDescarte || 'CONSUMO_PROPRIO'; campos.motivo = s.causa || 'IDADE'; if (s.valor) { campos.receita_valor = s.valor; if (s.vezes) campos.receita_parcelas_qtd = s.vezes; } }
  return { tipo: s.tipo, campos, animais: linhasDosIds(s) };
}
/** O valor do custo ou da receita da morte e do descarte (às vezes nenhum). */
function mutarValorDaBaixa(c) { c.s.valor = c.rnd() < 0.3 ? 0 : sorteio(c.rnd, [1, 7777]); }
/** Os ajustes de um animal por item: o primeiro e, passada 4, às vezes outros no mesmo lançamento (o mesmo animal duas vezes). */
const itensAjuste = (s, f) => [f(s)].concat((s.mais || []).map(f));
const animaisDoAjuste = (s) => [s.id];
const ESCOPO_AJUSTE = { mutarOutro: mutarMais };

// --- as entradas, na ordem do sorteio ---
registrarTipo('ENTRADA_INICIAL', {
  peso: (S) => (S.linhas.length < 10 ? 20 : 3),
  mudaData: false,
  propor: (c) => {
    const { sis, S, rnd, D } = c;
    const data = rnd() < 0.9 ? S.marco || D0 : D;
    return { tipo: 'ENTRADA_INICIAL', data, novos: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => novoSpecAnimal(sis, S, rnd, data, true)) };
  },
  montar: (sis, s) => ({ tipo: s.tipo, campos: { event_date: s.data }, animais: s.novos.map((n) => novoAnimal(n, true)) }),
  animais: () => [],
  mutarAnimais: (c) => mutarNovos(c, true),
  mutarValores: mutarNovoAnimal,
  criados: criadosNovos,
  doGravado: entradaDoGravado,
  efeito: efeitoEntrada,
});
registrarTipo('OUTRA_ENTRADA', {
  peso: () => 4,
  propor: (c) => {
    const { sis, S, rnd, D, P } = c;
    if (rnd() < 0.5) {
      const fora = MOVEIS(S).filter((id) => SAIDA_DO_REBANHO.indexOf(S.animais.get(id).situacao_cadastral) >= 0);
      const id = rnd() < 0.8 && fora.length ? sorteio(rnd, fora) : sorteio(rnd, MOVEIS(S));
      if (!id) return null;
      const data = dataPara(S, rnd, [id]);
      // A volta com um animal novo no mesmo lançamento, às vezes.
      return { tipo: 'OUTRA_ENTRADA', data, volta: id, pasto: sorteio(rnd, P), novos: rnd() < 0.2 ? [novoSpecAnimal(sis, S, rnd, data, false)] : [] };
    }
    return { tipo: 'OUTRA_ENTRADA', data: D, novos: Array.from({ length: rnd() < 0.3 ? 2 + Math.floor(rnd() * 2) : 1 }, () => novoSpecAnimal(sis, S, rnd, D, false)) };
  },
  montar: (sis, s) => {
    if (s.volta) return { tipo: 'OUTRA_ENTRADA', campos: { event_date: s.data, description: 'Apareceu na divisa' }, animais: [{ animal_id: s.volta, pasto_destino_id: s.pasto }].concat((s.novos || []).map((n) => novoAnimal(n, false))) };
    return { tipo: s.tipo, campos: { event_date: s.data, description: 'Doação do vizinho' }, animais: s.novos.map((n) => novoAnimal(n, false)) };
  },
  animais: (s) => (s.volta ? [s.volta] : []),
  mutarAnimais: (c) => mutarNovos(c, false),
  mutarValores: mutarNovoAnimal,
  criados: criadosNovos,
  doGravado: entradaDoGravado,
  efeito: efeitoEntrada,
});
registrarTipo('COMPRA', {
  peso: () => 9,
  propor: (c) => {
    const { sis, S, rnd, D, P } = c;
    const fora = MOVEIS(S).filter((id) => SAIDA_DO_REBANHO.indexOf(S.animais.get(id).situacao_cadastral) >= 0);
    const voltas = rnd() < 0.25 && fora.length ? alguns(rnd, rnd() < 0.85 ? fora : MOVEIS(S), 2) : [];
    const data = voltas.length ? dataPara(S, rnd, voltas) : D;
    const novos = Array.from({ length: voltas.length && rnd() < 0.5 ? 0 : 1 + Math.floor(rnd() * 3) }, () => novoSpecAnimal(sis, S, rnd, data, false));
    novos.forEach((n) => { if (rnd() < 0.3) n.brinco_origem = 'V' + Math.floor(rnd() * 20); });
    if (!novos.length && !voltas.length) return null;
    const spec = { tipo: 'COMPRA', data, pasto: sorteio(rnd, P), novos, voltas, neg: negocio(rnd, novos.length + voltas.length, false) };
    // Passada 3: o fornecedor cadastrado no meio, desativado ou de outro tipo.
    if (rnd() < 0.2 && S.t.PARCEIROS.length) spec.parceiro = sorteio(rnd, S.t.PARCEIROS).partner_id;
    return spec;
  },
  montar: (sis, s) => {
    const P = sis.parceiros;
    const itens = s.novos.map((n) => Object.assign(novoAnimal(n, false, true), n.brinco_origem ? { brinco_origem: n.brinco_origem } : {})).concat(s.voltas.map((id) => ({ animal_id: id })));
    const g = s.neg;
    itens.forEach((it, i) => Object.assign(it, itemNegocio(g, i)));
    const valor = Math.max(1, contaNegocio(g, itens.length) + (g.desvio || 0));
    const campos = { event_date: s.data, partner_id: s.parceiro || P.fornecedor, valor_animais: valor, pasto_destino_id: s.pasto };
    cabecalhoNegocio(g, campos);
    const custos = [];
    if (g.frete) custos.push({ tipo: 'FRETE', valor: g.frete, partner_id: P.transportador });
    if (g.outros) custos.push(Object.assign({ tipo: 'OUTRO', valor: g.outros, partner_id: P.corretor }, g.vezes ? { parcelas_qtd: g.vezes } : {}));
    return { tipo: s.tipo, campos, animais: itens, parcelas: parcelas(valor, g.parcelas, s.data), custos };
  },
  animais: (s) => s.voltas || [],
  mutarAnimais: (c) => mutarNovos(c, true),
  mutarValores: mutarNegocio,
  criados: criadosNovos,
  doGravado: (c, e) => {
    const { S, rnd, ls, brincoDe, data, ids } = c;
    const compra = S.t.COMPRAS.find((x) => x.event_id === e.event_id);
    if (!compra) return null;
    const novos = [];
    const voltas = [];
    ids.forEach((id) => {
      const a = S.animais.get(id) || {};
      const l = ls.find((x) => x.animal_id === id);
      if (a.evento_origem_id === e.event_id) novos.push({ id, sexo: a.sexo, pasto: l.pasto_destino_id || null, brinco: brincoDe(id), nasc: a.data_nascimento || undefined, castrado: a.castrado === true, reprodutor: a.reprodutor === true });
      else voltas.push(id);
    });
    const g = negocio(rnd, ids.length, false);
    Object.assign(g, { mod: 'LOTE', criterio: 'CABECAS', lote: compra.valor_animais });
    ['desvio', 'frete', 'outros', 'vezes'].forEach((x) => delete g[x]);
    return { tipo: 'COMPRA', data, pasto: ls[0].pasto_destino_id || null, novos, voltas, neg: g };
  },
  efeito: (c) => {
    const { d, S, eid, erro, lsE, linhaDe, efeitoEsperado, pre, ehUltima, novosDe, conferirNovo } = c;
    const compras = S.t.COMPRAS.filter((x) => x.event_id === eid);
    const custos = (d.custos || []).reduce((s, x) => s + x.valor, 0);
    if (compras.length !== 1 || compras[0].valor_animais !== d.campos.valor_animais) erro('COMPRAS ' + JSON.stringify(compras.map((x) => x.valor_animais)));
    const fins = S.t.FINANCEIRO.filter((f) => f.event_id === eid);
    if (fins.reduce((s, f) => s + f.valor, 0) !== d.campos.valor_animais + custos) erro('lançamentos da compra somam ' + fins.reduce((s, f) => s + f.valor, 0));
    if (lsE.length !== d.animais.length || lsE.some((l) => l.efeito_inventario !== efeitoEsperado(1))) erro('linhas da compra ' + JSON.stringify(lsE.map((l) => l.efeito_inventario)));
    d.animais.forEach((x) => {
      if (!x.animal_id) return;
      if (!linhaDe(x.animal_id)) erro('o animal ' + x.animal_id + ' não está na compra');
    });
    const ns = novosDe();
    const itensNovos = d.animais.filter((x) => !x.animal_id);
    if (ns.length !== itensNovos.length) erro(ns.length + ' animais novos, pedidos ' + itensNovos.length);
    ns.forEach((l, i) => conferirNovo(l, itensNovos[i] || {}, d.campos.pasto_destino_id, pre ? null : 'COMPRADO'));
    if (!pre) d.animais.forEach((x) => { if (x.animal_id && ehUltima(x.animal_id) && S.animais.get(x.animal_id).situacao_cadastral !== 'ATIVO') erro('voltou pela compra e está ' + S.animais.get(x.animal_id).situacao_cadastral); });
  },
});
registrarTipo('VENDA', {
  peso: () => 9,
  propor: (c) => proporSaida(c, 'VENDA'),
  montar: (sis, s) => {
    const P = sis.parceiros;
    const g = s.neg;
    const n = s.ids.length;
    // Com o valor de cada animal, os valores somam a receita (bruto − desconto).
    const porValor = g.mod === 'VALOR' || (g.mod === 'LOTE' && g.criterio === 'VALOR_INDIVIDUAL');
    const bruto = Math.max(1, contaNegocio(g, n) + (porValor ? g.desconto || 0 : g.desvio || 0));
    const campos = { event_date: s.data, partner_id: s.parceiro || P.comprador, finalidade: g.finalidade || 'RECRIA_ENGORDA', valor_bruto: bruto };
    cabecalhoNegocio(g, campos);
    if (g.desconto) campos.desconto_comercial = g.desconto;
    if (s.origem) campos.pasto_origem_id = s.origem;
    if (g.loteKg) campos.peso_vivo_total_kg = g.loteKg;
    const animais = s.ids.map((id, i) => { const it = Object.assign({ animal_id: id }, itemNegocio(g, i)); if (g.loteKg) delete it.peso; return it; });
    const receita = bruto - (g.desconto || 0);
    const deducoes = (g.deducoes || []).map((x) => Object.assign({ tipo: x.tipo, valor: x.valor }, x.retida ? { retida_pelo_comprador: true } : { partner_id: P.corretor }));
    return { tipo: s.tipo, campos, animais, parcelas: parcelas(Math.max(1, receita), g.parcelas, s.data), deducoes };
  },
  animais: (s) => s.ids,
  mutarAnimais: mutarIds,
  mutarValores: mutarNegocio,
  mutarOutro: (c) => { c.s.origem = c.rnd() < 0.2 ? null : sorteio(c.rnd, c.P); },
  doGravado: (c, e) => {
    const { S, rnd, data, ids } = c;
    const v = S.t.VENDAS.find((x) => x.event_id === e.event_id);
    if (!v) return null;
    const g = negocio(rnd, ids.length, true);
    Object.assign(g, { mod: 'LOTE', criterio: 'CABECAS', lote: v.valor_bruto, finalidade: v.finalidade || 'RECRIA_ENGORDA' });
    ['desvio', 'desconto', 'deducoes', 'loteKg'].forEach((x) => delete g[x]);
    return { tipo: 'VENDA', data, ids, neg: g };
  },
  efeito: (c) => {
    const { d, S, eid, erro } = c;
    efeitoSaida(c);
    const fins = S.t.FINANCEIRO.filter((f) => f.event_id === eid);
    const v = S.t.VENDAS.filter((x) => x.event_id === eid);
    const receita = d.campos.valor_bruto - (d.campos.desconto_comercial || 0);
    if (v.length !== 1 || v[0].valor_bruto !== d.campos.valor_bruto) erro('VENDAS ' + JSON.stringify(v.map((x) => x.valor_bruto)));
    if (!fins.length || fins[0].natureza !== 'RECEITA_VENDA_ANIMAIS' || fins[0].valor !== receita) erro('receita ' + JSON.stringify(fins.map((f) => [f.natureza, f.valor])) + ', esperado ' + receita);
    const ded = fins.filter((f) => f.natureza === 'DESPESA_VENDA').map((f) => f.valor).sort((a, b) => a - b);
    const ped = (d.deducoes || []).map((x) => x.valor).sort((a, b) => a - b);
    if (JSON.stringify(ded) !== JSON.stringify(ped)) erro('deduções ' + JSON.stringify(ded) + ', pedidas ' + JSON.stringify(ped));
  },
});
registrarTipo('TRANSFERENCIA', {
  peso: () => 9,
  propor: (c) => {
    const { S, rnd, D, P } = c;
    const origem = sorteio(rnd, P);
    const ids = animaisPara(S, rnd, D, 3, (id, p) => p.fim && p.pasto === origem);
    if (!ids.length) return null;
    const data = rnd() < 0.4 ? dataPara(S, rnd, ids) : D;
    return { tipo: 'TRANSFERENCIA', data, origem, destino: rnd() < 0.92 ? sorteio(rnd, P.filter((p) => p !== origem)) : origem, ids };
  },
  montar: (sis, s) => ({ tipo: s.tipo, campos: { event_date: s.data, pasto_origem_id: s.origem, pasto_destino_id: s.destino }, animais: linhasDosIds(s) }),
  animais: (s) => s.ids,
  mutarAnimais: mutarIds,
  mutarValores: (c) => { if (c.s.destino) c.s.destino = sorteio(c.rnd, c.P); },
  mutarOutro: (c) => { c.s.origem = c.rnd() < 0.2 ? null : sorteio(c.rnd, c.P); },
  doGravado: (c) => ({ tipo: 'TRANSFERENCIA', data: c.data, origem: c.ls[0].pasto_origem_id || null, destino: c.ls[0].pasto_destino_id || null, ids: c.ids }),
  efeito: (c) => {
    const { d, S, erro, linhaDe, pre, ehUltima } = c;
    (d.animais || []).forEach((x) => {
      const l = linhaDe(x.animal_id);
      if (!l || l.efeito_inventario !== 0 || (!pre && (l.pasto_origem_id !== d.campos.pasto_origem_id || l.pasto_destino_id !== d.campos.pasto_destino_id))) { erro('linha da transferência errada: ' + JSON.stringify(l)); return; }
      if (!pre && ehUltima(x.animal_id) && S.animais.get(x.animal_id).pasto_atual_id !== d.campos.pasto_destino_id) erro('transferido e o pasto atual é ' + S.animais.get(x.animal_id).pasto_atual_id);
    });
  },
});
registrarTipo('MORTE', {
  peso: () => 5,
  propor: (c) => proporSaida(c, 'MORTE'),
  montar: montarBaixa,
  animais: (s) => s.ids,
  mutarAnimais: mutarIds,
  mutarValores: mutarValorDaBaixa,
  doGravado: (c) => ({ tipo: 'MORTE', data: c.data, ids: c.ids }),
  efeito: efeitoBaixa,
});
registrarTipo('DESCARTE', {
  peso: () => 3,
  propor: (c) => proporSaida(c, 'DESCARTE'),
  montar: montarBaixa,
  animais: (s) => s.ids,
  mutarAnimais: mutarIds,
  mutarValores: mutarValorDaBaixa,
  efeito: efeitoBaixa,
});
registrarTipo('NASCIMENTO', {
  peso: () => 9,
  dataAntiga: true,
  propor: (c) => {
    const { S, rnd, D, P } = c;
    const maes = animaisPara(S, rnd, D, 1, (id, p) => p.dia && fem(S, id));
    if (!maes.length) return null;
    const data = rnd() < 0.5 ? dataPara(S, rnd, maes, { antiga: true }) : D;
    const crias = [{ situacao: rnd() < 0.85 ? 'VIVO' : 'NATIMORTO', sexo: rnd() < 0.5 ? 'F' : 'M', brinco: brinco(rnd, S), peso: rnd() < 0.3 ? 30 : null }];
    if (rnd() < 0.3) crias.push(rnd() < 0.5 ? { situacao: 'NATIMORTO' } : { situacao: 'VIVO', sexo: 'M', brinco: brinco(rnd, S) });
    const machos = MOVEIS(S).filter((id) => !fem(S, id)).concat(EXTERNOS(S));
    const spec = { tipo: 'NASCIMENTO', data, mae: maes[0], crias, pai: rnd() < 0.4 ? sorteio(rnd, rnd() < 0.85 ? machos : MOVEIS(S)) : null, pasto: rnd() < 0.3 ? sorteio(rnd, P) : null };
    if (rnd() < 0.2) spec.tipoParto = sorteio(rnd, ['NORMAL', 'ASSISTIDO', 'DISTOCICO']);
    return spec;
  },
  montar: (sis, s) => {
    const campos = { event_date: s.data };
    if (s.pasto) campos.pasto_destino_id = s.pasto;
    if (s.pai) { campos.pai_id = s.pai; campos.pai_confianca = 'ESTIMADA'; }
    if (s.tipoParto) campos.tipo_parto = s.tipoParto;
    else if (s.crias.length > 1) campos.tipo_parto = 'ASSISTIDO';
    return {
      tipo: s.tipo, campos, animais: [{ animal_id: s.mae }],
      crias: s.crias.map((c) => (c.situacao === 'VIVO' ? Object.assign({ situacao_nascimento: 'VIVO', sexo: c.sexo }, c.brinco ? { brinco: c.brinco } : {}, c.id ? { animal_id: c.id } : {}, c.peso ? { peso: c.peso, metodo_pesagem: 'BALANCA' } : {}) : { situacao_nascimento: 'NATIMORTO' })),
    };
  },
  animais: (s) => [s.mae],
  // A cria que vira natimorta, ou uma cria a mais (até 4).
  mutarAnimais: (c) => {
    const { s, S, rnd } = c;
    const vivas = s.crias.filter((x) => x.situacao === 'VIVO');
    if (vivas.length && rnd() < 0.5) sorteio(rnd, vivas).situacao = 'NATIMORTO';
    else if (s.crias.length < 4) s.crias.push({ situacao: 'VIVO', sexo: rnd() < 0.5 ? 'F' : 'M', brinco: brinco(rnd, S) });
  },
  mutarValores: (c) => { c.s.pai = c.rnd() < 0.5 ? null : sorteio(c.rnd, MOVEIS(c.S).concat(EXTERNOS(c.S))); },
  criados: (spec, proximo) => (spec.crias || []).forEach((x) => { if (x.situacao !== 'VIVO') delete x.id; else if (!x.id) x.id = proximo(); }),
  doGravado: (c, e) => {
    const { S, ls, brincoDe, data } = c;
    const mae = (ls.find((l) => l.papel === 'MATRIZ') || {}).animal_id;
    if (!mae) return null;
    const rep = S.t.REPRODUCAO.find((x) => x.event_id === e.event_id && x.tipo_evento === 'PARTO') || {};
    const crias = ls.filter((l) => l.papel === 'CRIA').map((l) => ({ situacao: 'VIVO', sexo: (S.animais.get(l.animal_id) || {}).sexo, brinco: brincoDe(l.animal_id), id: l.animal_id }));
    for (let i = 0; i < (rep.qtd_natimortos || 0); i++) crias.push({ situacao: 'NATIMORTO' });
    if (!crias.length) return null;
    return { tipo: 'NASCIMENTO', data, mae, crias, pai: rep.touro_id || null, pasto: (ls.find((l) => l.papel === 'CRIA') || {}).pasto_destino_id || null };
  },
  efeito: (c) => {
    const { d, S, E, eid, erro, lsE, linhaDe, efeitoEsperado, pre } = c;
    const mae = d.animais[0].animal_id;
    const lm = linhaDe(mae);
    if (!lm || lm.papel !== 'MATRIZ' || lm.efeito_inventario !== 0) erro('linha da matriz ' + JSON.stringify(lm));
    const vivas = (d.crias || []).filter((x) => x.situacao_nascimento === 'VIVO');
    const crias = lsE.filter((l) => l.papel === 'CRIA');
    if (crias.length !== vivas.length || crias.some((l) => l.efeito_inventario !== efeitoEsperado(1))) erro(crias.length + ' crias para ' + vivas.length + ' vivas');
    crias.forEach((l) => {
      const a = S.animais.get(l.animal_id);
      if (a.mae_id !== mae || a.data_nascimento !== E.event_date || a.origem !== 'NASCIDO') erro(a.codigo_interno + ': mãe ' + a.mae_id + ', nascimento ' + a.data_nascimento + ', origem ' + a.origem);
      if (!pre && !S.linhasDe(l.animal_id).some((x) => x.ev !== eid) && a.situacao_cadastral !== 'ATIVO') erro('cria ' + a.codigo_interno + ' nasceu e está ' + a.situacao_cadastral);
      if (pre && !S.linhasDe(l.animal_id).some((x) => !DE_FATO(x)) && ['HISTORICO', 'VENDIDO', 'MORTO'].indexOf(a.situacao_cadastral) < 0) erro('cria do parto antigo ' + a.codigo_interno + ' está ' + a.situacao_cadastral);
    });
    const rep = S.t.REPRODUCAO.filter((x) => x.event_id === eid && x.tipo_evento === 'PARTO');
    const nati = (d.crias || []).length - vivas.length;
    if (rep.length !== 1 || rep[0].animal_id !== mae || rep[0].qtd_nascidos_vivos !== vivas.length || rep[0].qtd_natimortos !== nati || (rep[0].touro_id || null) !== (d.campos.pai_id || null)) erro('PARTO ' + JSON.stringify(rep.map((x) => [x.qtd_nascidos_vivos, x.qtd_natimortos, x.touro_id])));
  },
});
registrarTipo('IDENTIFICACAO', {
  peso: () => 6,
  propor: (c) => {
    const { S, rnd, D } = c;
    const sub = sorteio(rnd, ['PRIMEIRA_IDENTIFICACAO', 'SUBSTITUICAO', 'SUBSTITUICAO', 'REMOCAO']);
    // A primeira identificação procura, quase sempre, animais ainda sem brinco (a válida); às vezes qualquer um (a recusa).
    const semBrinco = sub === 'PRIMEIRA_IDENTIFICACAO' && rnd() < 0.7;
    const ids = animaisPara(S, rnd, D, 2, (id, p) => p.dia && (!semBrinco || !(S.animais.get(id) || {}).brinco));
    if (!ids.length) return null;
    const data = rnd() < 0.4 ? dataPara(S, rnd, ids) : D;
    const spec = { tipo: 'IDENTIFICACAO', sub, data, tipoIdent: rnd() < 0.9 ? 'BRINCO' : sorteio(rnd, ['RFID', 'TATUAGEM', 'BRINCO_ORIGEM']), itens: ids.map((id) => ({ id, codigo: brinco(rnd, S) || String(80 + Math.floor(rnd() * 20)) })) };
    if (rnd() < 0.3) spec.motivoIdent = sorteio(rnd, ['DANIFICADO', 'RENUMERACAO']);
    return spec;
  },
  montar: (sis, s) => ({
    tipo: s.tipo, subtipo: s.sub, campos: { event_date: s.data, tipo_identificacao: s.tipoIdent || 'BRINCO' },
    animais: s.itens.map((x) => { const it = { animal_id: x.id }; if (s.sub !== 'REMOCAO') it.codigo = x.codigo; if (s.sub !== 'PRIMEIRA_IDENTIFICACAO') it.motivo = s.motivoIdent || 'PERDA'; return it; }),
  }),
  animais: (s) => s.itens.map((i) => i.id),
  mutarValores: (c) => c.s.itens.forEach((i) => { i.codigo = brinco(c.rnd, c.S) || '77'; }),
  mutarOutro: (c) => { c.s.sub = sorteio(c.rnd, ['PRIMEIRA_IDENTIFICACAO', 'SUBSTITUICAO', 'REMOCAO'].filter((v) => v !== c.s.sub)); },
  doGravado: (c, e) => {
    if (!c.idents.length) return null;
    return { tipo: 'IDENTIFICACAO', sub: e.event_subtype, data: c.data, tipoIdent: c.idents[0].tipo, itens: c.idents.map((y) => ({ id: y.animal_id, codigo: y.codigo })) };
  },
  efeito: (c) => {
    const { d, S, eid, erro } = c;
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
  },
});
registrarTipo('MARCACAO', {
  peso: () => 4,
  propor: (c) => {
    const { S, rnd, D } = c;
    const ids = animaisPara(S, rnd, D, 2, (id, p) => p.dia);
    if (!ids.length) return null;
    const sub = sorteio(rnd, ['DESCARTE', 'NAO_LOCALIZADO']);
    const marcado = (S.animais.get(ids[0]) || {})[sub === 'DESCARTE' ? 'marcado_descarte' : 'nao_localizado'] === true;
    const acao = rnd() < 0.8 ? (marcado ? 'DESMARCAR' : 'MARCAR') : (marcado ? 'MARCAR' : 'DESMARCAR');
    return { tipo: 'MARCACAO', sub, acao, data: rnd() < 0.4 ? dataPara(S, rnd, ids) : D, ids, motivo: sub === 'DESCARTE' && acao === 'MARCAR' && rnd() < 0.5 ? 'IDADE' : null };
  },
  montar: (sis, s) => {
    const campos = { event_date: s.data, acao: s.acao };
    if (s.motivo) campos.motivo_descarte = s.motivo;
    return { tipo: s.tipo, subtipo: s.sub, campos, animais: linhasDosIds(s) };
  },
  animais: (s) => s.ids,
  mutarAnimais: mutarIds,
  mutarValores: (c) => { if (c.s.acao) c.s.acao = c.s.acao === 'MARCAR' ? 'DESMARCAR' : 'MARCAR'; },
  mutarOutro: (c) => { c.s.sub = c.s.sub === 'DESCARTE' ? 'NAO_LOCALIZADO' : 'DESCARTE'; c.s.motivo = null; },
  efeito: (c) => {
    const { d, S, eid, erro } = c;
    d.animais.forEach((x) => {
      const ms = S.linhasDe(x.animal_id).filter((l) => l.tipo === 'MARCACAO' && l.sub === d.subtipo);
      const u = ultimo(ms);
      const a = S.animais.get(x.animal_id);
      const campo = d.subtipo === 'DESCARTE' ? 'marcado_descarte' : 'nao_localizado';
      if (u && u.ev === eid && a[campo] !== (d.campos.acao === 'MARCAR')) erro(a.codigo_interno + ': ' + campo + ' = ' + a[campo] + ' depois de ' + d.campos.acao);
    });
  },
});
registrarTipo('CORRECAO_CADASTRO', {
  peso: () => 4,
  propor: (c) => {
    const { sis, S, rnd, D } = c;
    // Às vezes dois animais, ou dois campos do mesmo animal, no mesmo lançamento.
    const ids = animaisPara(S, rnd, D, rnd() < 0.25 ? 2 : 1, () => true);
    if (!ids.length) return null;
    const itens = ids.map((id) => correcaoAleatoria(sis, S, rnd, id));
    if (rnd() < 0.2) itens.push(correcaoAleatoria(sis, S, rnd, ids[0]));
    return { tipo: 'CORRECAO_CADASTRO', data: rnd() < 0.5 ? dataPara(S, rnd, ids) : D, itens };
  },
  montar: (sis, s) => {
    const animais = [];
    s.itens.forEach((x) => {
      animais.push({ animal_id: x.id, campo: x.campo, valor_novo: x.valor });
      Object.keys(x.junto || {}).forEach((k) => animais.push({ animal_id: x.id, campo: k, valor_novo: x.junto[k] }));
    });
    return { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: s.data, justificativa: 'Conferido na ficha' }, animais };
  },
  animais: (s) => s.itens.map((i) => i.id),
  mutarValores: (c) => { c.s.itens = [correcaoAleatoria(c.sis, c.S, c.rnd, c.s.itens[0].id)]; },
  efeito: (c) => conferirCorrecoes(c.S, c.eid, c.erro),
});
registrarTipo('IDENTIFICACAO_INCORRETA', Object.assign({
  peso: () => 2,
  propor: (c) => {
    const { S, rnd, D } = c;
    const ids = animaisPara(S, rnd, D, 1, (id, p) => p.dia);
    if (!ids.length) return null;
    const um = (id) => ({ id, brinco: brinco(rnd, S) || '99' });
    return Object.assign({ tipo: 'IDENTIFICACAO_INCORRETA', data: rnd() < 0.5 ? dataPara(S, rnd, ids) : D }, um(ids[0]), maisAjustes(S, rnd, D, ids[0], (id, p) => p.dia, um));
  },
  montar: (sis, s) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'IDENTIFICACAO_INCORRETA', campos: { event_date: s.data, justificativa: 'Brinco digitado errado' }, animais: itensAjuste(s, (x) => ({ animal_id: x.id, brinco: x.brinco })) }),
  animais: animaisDoAjuste,
  mutarValores: (c) => { c.s.brinco = brinco(c.rnd, c.S) || '98'; },
  efeito: (c) => {
    const { d, S, E, eid, erro } = c;
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
  },
}, ESCOPO_AJUSTE));
registrarTipo('CORRECAO_LOCALIZACAO', Object.assign({
  peso: () => 3,
  propor: (c) => {
    const { S, rnd, D, P } = c;
    const ids = animaisPara(S, rnd, D, 1, (id, p) => p.fim);
    if (!ids.length) return null;
    const data = rnd() < 0.4 ? dataPara(S, rnd, ids) : D;
    const um = (id) => { const onde = presenca(S, id, data).pasto; return { id, destino: rnd() < 0.9 ? sorteio(rnd, P.filter((p) => p !== onde)) : onde, origem: rnd() < 0.2 ? sorteio(rnd, P) : null }; };
    return Object.assign({ tipo: 'CORRECAO_LOCALIZACAO', data }, um(ids[0]), maisAjustes(S, rnd, D, ids[0], (id, p) => p.fim, um));
  },
  montar: (sis, s) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_LOCALIZACAO', campos: { event_date: s.data, justificativa: 'Achado em outro pasto' }, animais: itensAjuste(s, (x) => Object.assign({ animal_id: x.id, pasto_destino_id: x.destino }, x.origem ? { pasto_origem_id: x.origem } : {})) }),
  animais: animaisDoAjuste,
  mutarValores: (c) => { if (c.s.destino) c.s.destino = sorteio(c.rnd, c.P); },
  efeito: (c) => {
    const { d, S, erro, linhaDe, ehUltima } = c;
    d.animais.forEach((x) => {
      const l = linhaDe(x.animal_id);
      if (!l || l.pasto_destino_id !== x.pasto_destino_id) { erro('linha da correção de localização ' + JSON.stringify(l)); return; }
      if (ehUltima(x.animal_id) && S.animais.get(x.animal_id).pasto_atual_id !== x.pasto_destino_id) erro('pasto atual ' + S.animais.get(x.animal_id).pasto_atual_id + ' depois da correção para ' + x.pasto_destino_id);
    });
  },
}, ESCOPO_AJUSTE));
registrarTipo('RECLASSIFICACAO', Object.assign({
  peso: () => 3,
  propor: (c) => {
    const { S, rnd, D } = c;
    const ids = animaisPara(S, rnd, D, 1, (id, p) => p.dia);
    if (!ids.length) return null;
    const um = (id) => {
      const sexo = (S.animais.get(id) || {}).sexo;
      const cats = CATEGORIAS_DE(S).filter((x) => rnd() < 0.85 ? x.sexo === sexo || x.sexo === 'AMBOS' : true);
      return { id, cat: rnd() < 0.2 ? null : (sorteio(rnd, cats) || {}).id || null };
    };
    return Object.assign({ tipo: 'RECLASSIFICACAO', data: rnd() < 0.4 ? dataPara(S, rnd, ids) : D }, um(ids[0]), maisAjustes(S, rnd, D, ids[0], (id, p) => p.dia, um));
  },
  montar: (sis, s) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'RECLASSIFICACAO', campos: { event_date: s.data, justificativa: 'Categoria conferida no curral' }, animais: itensAjuste(s, (x) => ({ animal_id: x.id, categoria_manual_id: x.cat })) }),
  animais: animaisDoAjuste,
  mutarValores: (c) => { c.s.cat = c.rnd() < 0.3 ? null : sorteio(c.rnd, CATEGORIAS_DE(c.S)).id; },
  efeito: (c) => {
    const { d, S, eid, erro } = c;
    d.animais.forEach((x) => {
      const rs = S.t.AJUSTES.filter((z) => z.animal_id === x.animal_id && z.tipo_ajuste === 'RECLASSIFICACAO' && S.vig.get(z.event_id)).map((z) => ({ z, data: S.ev.get(z.event_id).event_date, raiz: S.raiz(S.ev.get(z.event_id)), seq: S.ev.get(z.event_id).event_seq }));
      const u = ultimo(rs);
      const a = S.animais.get(x.animal_id);
      if (u && u.z.event_id === eid && (norm(a.categoria_manual_id) !== norm(x.categoria_manual_id) || a.categoria_modo !== (x.categoria_manual_id ? 'MANUAL' : 'AUTO'))) erro(a.codigo_interno + ': categoria ' + a.categoria_modo + ' ' + a.categoria_manual_id + ', pedida ' + x.categoria_manual_id);
    });
  },
}, ESCOPO_AJUSTE));
registrarTipo('DIVERGENCIA_CONTAGEM', {
  peso: () => 3,
  propor: (c) => proporSaida(c, 'DIVERGENCIA_CONTAGEM'),
  montar: (sis, s) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'DIVERGENCIA_CONTAGEM', campos: { event_date: s.data, justificativa: 'Faltou na contagem do curral' }, animais: linhasDosIds(s) }),
  animais: (s) => s.ids,
  mutarAnimais: mutarIds,
  efeito: efeitoBaixa,
});
/** Passada 4: outros itens no mesmo ajuste (outro animal, às vezes o mesmo com outro valor); {} quando não. */
function maisAjustes(S, rnd, D, primeiro, filtro, um) {
  if (rnd() >= 0.25) return {};
  const outros = animaisPara(S, rnd, D, 2, filtro).filter((id) => id !== primeiro);
  const ids = rnd() < 0.15 ? [primeiro] : outros;
  return ids.length ? { mais: ids.map(um) } : {};
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
    const op = todos.filter((x) => x !== id).concat(filhos, [id, ''], EXTERNOS(S));
    return { id, campo, valor: sorteio(rnd, op) || '' };
  }
  if (campo === 'data_entrada') return { id, campo, valor: sorteio(rnd, [somaDias(D0, -1 - Math.floor(rnd() * 900)), a.data_nascimento ? somaDias(a.data_nascimento, -1) : '', somaDias(D0, 5), ''].filter((x) => x !== undefined)) };
  if (campo === 'castrado') return { id, campo, valor: a.castrado ? 'N' : 'S' };
  if (campo === 'origem') return { id, campo, valor: sorteio(rnd, ['NASCIDO', 'COMPRADO', 'DESCONHECIDA']) };
  return { id, campo, valor: sorteio(rnd, ['CONFIRMADA', 'ESTIMADA', 'DESCONHECIDA']) };
}
/**
 * Muda a especificação de um lançamento gravado para a correção: a data, os animais, os valores, o pasto do lançamento,
 * o parceiro do negócio, a propriedade ou outra coisa do tipo (o que cada uma muda é da entrada do registro).
 */
function mutar(sis, S, rnd, spec) {
  const s = js(spec);
  const T = tipoDoRegistro(s.tipo);
  const P = PASTOS_DE(S);
  const c = { sis, S, rnd, s, P };
  const x = rnd();
  const ids = T.animais(s);
  if (x < 0.3 && T.mudaData) s.data = dataPara(S, rnd, ids, { antiga: !!T.dataAntiga });
  else if (x < 0.5) { if (T.mutarAnimais) T.mutarAnimais(c); }
  else if (x < 0.7) { if (T.mutarValores) T.mutarValores(c); }
  else if (x < 0.8 && s.pasto) s.pasto = sorteio(rnd, P);
  else if (x < 0.93) {
    // Passada 4: o que a correção ainda não mudava: o parceiro do negócio, a propriedade do lançamento e o que é de cada
    // tipo (o subtipo da identificação e da marcação, a origem da venda e da transferência, os outros itens dos ajustes).
    const y = rnd();
    if (s.neg && y < 0.35 && S.t.PARCEIROS.length) s.parceiro = sorteio(rnd, S.t.PARCEIROS).partner_id;
    else if (y < 0.5 && S.t.PROPRIEDADES.length) s.prop = sorteio(rnd, S.t.PROPRIEDADES).property_id;
    else if (T.mutarOutro) T.mutarOutro(c);
  }
  return s;
}
/** Passada 4: a correção composta (data, animais e valores mudados juntos), além da de uma mudança só. */
function mutarVarias(sis, S, rnd, spec) {
  let s = mutar(sis, S, rnd, spec);
  if (rnd() < 0.35) { s = mutar(sis, S, rnd, s); if (rnd() < 0.4) s = mutar(sis, S, rnd, s); }
  return s;
}

// ------------------------------------------------------------------ registro dos tipos de importação ----
// --- PESAGEM (Fase 3, E3.1): individual, coletiva e por lote; o peso perto do último conhecido (e às vezes longe, que
// pede o aceite de PESO_IMPLAUSIVEL), às vezes fora da faixa ou com as cabeças do lote erradas (recusas).
function pesoPara(S, rnd, id, data) {
  if (rnd() < 0.04) return sorteio(rnd, [0, 2000.5, 300.25]);
  const ps = S.t.PESAGENS.filter((p) => p.animal_id === id && S.vig.get(p.event_id) && p.data_pesagem <= data).sort((a, b) => cmp(a.data_pesagem, b.data_pesagem));
  const base = ps.length ? ps[ps.length - 1].peso_kg : 250 + Math.floor(rnd() * 150);
  if (rnd() < 0.1) return Math.round((60 + rnd() * 600) * 10) / 10;
  return Math.max(0.1, Math.round((base + (rnd() - 0.3) * 20) * 10) / 10);
}
function itensPesagem(S, rnd, ids, data) { return ids.map((id) => ({ id, peso: pesoPara(S, rnd, id, data) })); }
registrarTipo('PESAGEM', {
  peso: () => 6,
  propor: (c) => {
    const { S, rnd, D } = c;
    const ids = animaisPara(S, rnd, D, 4, (id, p) => p.dia);
    if (!ids.length) return null;
    const data = rnd() < 0.4 ? dataPara(S, rnd, ids) : D;
    const spec = { tipo: 'PESAGEM', data, momento: sorteio(rnd, ['ROTINA', 'ROTINA', 'ENTRADA', 'DESMAMA', 'VENDA']), metodo: sorteio(rnd, ['BALANCA', 'BALANCA', 'FITA', 'ESTIMATIVA_VISUAL']), jejum: rnd() < 0.2, itens: itensPesagem(S, rnd, ids, data), lote: null };
    if (rnd() < 0.15) spec.lote = { total: Math.round(ids.length * (200 + rnd() * 250) * 10) / 10, qtd: rnd() < 0.9 ? ids.length : ids.length + 1 };
    return spec;
  },
  montar: (sis, s) => {
    const campos = { event_date: s.data, tipo_pesagem: s.momento, metodo_pesagem: s.metodo };
    if (s.jejum) campos.jejum = true;
    if (s.lote) { campos.peso_total_lote_kg = s.lote.total; campos.qtd_cabecas_lote = s.lote.qtd; }
    return { tipo: 'PESAGEM', campos, animais: s.itens.map((x) => (s.lote ? { animal_id: x.id } : { animal_id: x.id, peso: x.peso })) };
  },
  animais: (s) => s.itens.map((x) => x.id),
  // Tira um animal (com mais de um) ou põe outro presente no dia.
  mutarAnimais: (c) => {
    const { s, S, rnd } = c;
    if (s.itens.length > 1 && rnd() < 0.5) s.itens.splice(Math.floor(rnd() * s.itens.length), 1);
    else { const mais = MOVEIS(S).filter((id) => !s.itens.some((x) => x.id === id) && presenca(S, id, s.data).dia); if (mais.length) s.itens.push({ id: sorteio(rnd, mais), peso: 300 }); }
    if (s.lote) s.lote.qtd = s.itens.length;
  },
  mutarValores: (c) => {
    const { s, S, rnd } = c;
    if (s.lote) s.lote.total = Math.round(s.itens.length * (200 + rnd() * 250) * 10) / 10;
    else s.itens.forEach((x) => { x.peso = pesoPara(S, rnd, x.id, s.data); });
  },
  mutarOutro: (c) => {
    const { s, rnd } = c;
    const r = rnd();
    if (r < 0.4) s.lote = s.lote ? null : { total: Math.round(s.itens.length * 300 * 10) / 10, qtd: s.itens.length };
    else if (r < 0.7) s.momento = sorteio(rnd, ['ROTINA', 'ENTRADA', 'DESMAMA', 'VENDA'].filter((m) => m !== s.momento));
    else s.jejum = !s.jejum;
    if (!s.lote) s.itens.forEach((x) => { if (typeof x.peso !== 'number') x.peso = 300; });
  },
  doGravado: (c, e) => {
    const rows = c.S.t.PESAGENS.filter((p) => p.event_id === e.event_id);
    if (!rows.length) return null;
    const pj = e.payload_json || {};
    const lote = typeof pj.peso_total_lote_kg === 'number' ? { total: pj.peso_total_lote_kg, qtd: pj.qtd_cabecas_lote } : null;
    return { tipo: 'PESAGEM', data: c.data, momento: rows[0].tipo, metodo: lote ? 'BALANCA' : rows[0].metodo, jejum: pj.jejum === true, lote, itens: rows.map((r) => ({ id: r.animal_id, peso: r.peso_kg })) };
  },
  efeito: (c) => {
    const { d, S, eid, erro, linhaDe } = c;
    const rows = S.t.PESAGENS.filter((p) => p.event_id === eid);
    if (rows.length !== d.animais.length) erro(rows.length + ' pesagens para ' + d.animais.length + ' animais');
    const lote = typeof d.campos.peso_total_lote_kg === 'number';
    const media = lote ? Math.round(d.campos.peso_total_lote_kg / d.campos.qtd_cabecas_lote * 10) / 10 : null;
    const pj = S.ev.get(eid).payload_json || {};
    if (lote && (pj.peso_total_lote_kg !== d.campos.peso_total_lote_kg || pj.qtd_cabecas_lote !== d.animais.length)) erro('lote no evento ' + JSON.stringify(pj));
    if (!lote && (pj.peso_total_lote_kg !== undefined || pj.qtd_cabecas_lote !== undefined)) erro('chaves de lote numa pesagem individual ' + JSON.stringify(pj));
    if ((pj.jejum === true) !== (d.campos.jejum === true)) erro('jejum gravado ' + pj.jejum + ', pedido ' + d.campos.jejum);
    d.animais.forEach((x) => {
      const r = rows.find((y) => y.animal_id === x.animal_id);
      const kg = lote ? media : x.peso;
      if (!r || r.peso_kg !== kg || r.data_pesagem !== d.campos.event_date || r.tipo !== d.campos.tipo_pesagem || r.metodo !== (lote ? 'MEDIA_LOTE' : d.campos.metodo_pesagem)) erro('pesagem gravada ' + JSON.stringify(r) + ', pedida ' + JSON.stringify([kg, d.campos.event_date, d.campos.tipo_pesagem]));
      const l = linhaDe(x.animal_id);
      if (!l || l.efeito_inventario !== 0 || l.peso !== kg || l.papel !== 'SUJEITO') erro('linha da pesagem ' + JSON.stringify(l));
    });
  },
});

// --- SANIDADE e ESTOQUE (Fase 3, E3.2 e E3.3) ---
// A aplicação individual e coletiva dos seis subtipos: o produto do cadastro (a vacina e o antibiótico com estoque
// controlado, o vermífugo sem), o produto sem cadastro (nome livre, às vezes com dose) e a doença sem produto; a dose por
// cabeça, por peso (pelo peso atual de cada animal) e só o total do frasco; às vezes a dose de um animal, a quantidade
// informada, a carência, a próxima aplicação, o protocolo da vacina (às vezes noutro procedimento: a recusa), o lote
// vencido (PRODUTO_VENCIDO), o serviço pago no ato em parcelas e o campo obrigatório faltando. A entrada de estoque (por
// embalagens, na unidade ou as duas que não batem; à vista ou em parcelas) e o acerto (contagem, perda, vencimento; o
// produto sem controle de estoque é a recusa).
const PROCEDIMENTO_DO_SUB = { VACINACAO: 'VACINA', VERMIFUGACAO: 'VERMIFUGO', MEDICACAO: 'MEDICAMENTO', TRATAMENTO: 'TRATAMENTO', EXAME: 'EXAME', DOENCA: 'DOENCA' };
const PRODUTO_DO_SUB = { VACINACAO: 'vacina', VERMIFUGACAO: 'vermifugo', MEDICACAO: 'antibiotico', TRATAMENTO: 'antibiotico' };
const CONTA_DA_CATEGORIA = { VACINA: 'VACINAS', VERMIFUGO: 'MEDICAMENTOS', MEDICAMENTO: 'MEDICAMENTOS', SUPLEMENTO: 'ALIMENTACAO', OUTRO: 'TRATAMENTOS' };
/** Centavos de um valor em reais (o arredondamento do sistema: meio para cima, lido com 6 casas). */
const centavosDe = (reais) => Math.round(Number((reais * 100).toFixed(6)));
/** Soma exata de quantidades de até 4 casas. */
const somaQtd = (l) => l.reduce((t, q) => t + Math.round(q * 10000), 0) / 10000;
/** O que é do subtipo: o produto (ou o nome livre), a dose, o motivo e o diagnóstico (a correção que troca o subtipo refaz). */
function preencherSanidade(sis, S, rnd, s) {
  Object.assign(s, { prod: null, nome: null, modo: null, doseRef: null, qtd: null, unidade: null, motivo: null, diag: null });
  s.itens.forEach((x) => { x.dose = null; });
  if (s.sub === 'TRATAMENTO' && rnd() < 0.95) s.motivo = sorteio(rnd, ['Pneumonia', 'Diarreia']);
  if (s.sub === 'MEDICACAO' && rnd() < 0.5) s.motivo = 'Febre';
  if ((s.sub === 'EXAME' || s.sub === 'DOENCA') && rnd() < 0.96) s.diag = s.sub === 'EXAME' ? 'Brucelose' : 'Tristeza parasitária';
  if (s.sub === 'DOENCA') return;
  const k = PRODUTO_DO_SUB[s.sub];
  const x = rnd();
  if (k && x < 0.75) s.prod = sis.produtos[k];
  else if (x < 0.85) s.prod = (sorteio(rnd, S.t.PRODUTOS) || {}).product_id || null;
  else if (s.sub === 'EXAME' || s.sub === 'TRATAMENTO' ? rnd() < 0.5 : rnd() < 0.05) return; // sem produto (obrigatório na vacinação, na vermifugação e na medicação: a recusa)
  else s.nome = sorteio(rnd, ['Tuberculina', 'Anti-inflamatório', 'Iodo 10%']);
  if (s.nome && rnd() < 0.6) return;
  const y = rnd();
  s.modo = y < 0.03 ? null : y < 0.55 ? 'POR_CABECA' : y < 0.8 ? 'POR_PESO' : 'TOTAL';
  if (s.nome && s.modo === 'POR_PESO') s.modo = 'POR_CABECA';
  if (s.modo === 'POR_CABECA') s.doseRef = sorteio(rnd, [1, 2, 5, 3.5]);
  if (s.modo === 'POR_PESO') s.doseRef = sorteio(rnd, [0.02, 0.01, 0.025]);
  if (s.modo === 'TOTAL' || (s.modo && rnd() < 0.15)) s.qtd = sorteio(rnd, [10, 12.5, 50, 0.75]);
  if (s.nome && s.modo && rnd() < 0.9) s.unidade = 'mL';
  if (s.modo && s.modo !== 'TOTAL' && rnd() < 0.15) sorteio(rnd, s.itens).dose = sorteio(rnd, [7.5, 1, 0.5]);
  if (s.modo === 'TOTAL' && rnd() < 0.03) sorteio(rnd, s.itens).dose = 2; // dose de um animal no modo total: a recusa
}
function propostaSanidade(sis, S, rnd, sub, data, ids) {
  const s = { tipo: 'SANIDADE', sub, data, itens: ids.map((id) => ({ id, dose: null, resultado: null })), protocolo: null, carencia: null, proxima: null, lote: null, validade: null, custo: null };
  preencherSanidade(sis, S, rnd, s);
  if (s.sub === 'VACINACAO' ? rnd() < 0.5 : rnd() < 0.03) s.protocolo = sorteio(rnd, S.t.PROTOCOLOS_SANITARIOS).protocol_id;
  if (rnd() < 0.4) s.carencia = sorteio(rnd, [0, 30, 45, 120]);
  if (rnd() < 0.25) s.proxima = somaDias(data, sorteio(rnd, [30, 180, 180, 0]));
  if (rnd() < 0.3) { s.lote = 'L' + Math.floor(rnd() * 90 + 10); s.validade = somaDias(data, sorteio(rnd, [365, 30, -10])); }
  if (rnd() < 0.2) s.custo = { valor: sorteio(rnd, [1, 2, 15000, 33333]), vezes: rnd() < 0.3 ? 3 : null };
  if (s.sub === 'EXAME') s.itens.forEach((x) => { if (rnd() < 0.3) x.resultado = 'Negativo'; });
  return s;
}
registrarTipo('SANIDADE', {
  peso: () => 10,
  propor: (c) => {
    const { sis, S, rnd, D } = c;
    const ids = animaisPara(S, rnd, D, rnd() < 0.5 ? 1 : 4, (id, p) => p.dia);
    if (!ids.length) return null;
    const data = rnd() < 0.4 ? dataPara(S, rnd, ids) : D;
    return propostaSanidade(sis, S, rnd, sorteio(rnd, ['VACINACAO', 'VACINACAO', 'VERMIFUGACAO', 'VERMIFUGACAO', 'VERMIFUGACAO', 'MEDICACAO', 'TRATAMENTO', 'EXAME', 'DOENCA']), data, ids);
  },
  montar: (sis, s) => {
    const campos = { event_date: s.data };
    if (s.sub !== 'DOENCA') {
      if (s.prod) campos.produto_id = s.prod;
      else if (s.nome) campos.nome_produto = s.nome;
      if (s.modo) campos.modo_dose = s.modo;
      if (s.doseRef !== null) campos.dose_referencia = s.doseRef;
      if (s.qtd !== null) campos.quantidade_consumida_total = s.qtd;
      if (s.unidade) campos.unidade_dose = s.unidade;
      if (s.protocolo) campos.protocol_id = s.protocolo;
      if (s.carencia !== null) campos.periodo_carencia_dias = s.carencia;
      if (s.proxima) campos.data_proxima_aplicacao = s.proxima;
      if (s.lote) { campos.lote = s.lote; campos.validade = s.validade; }
    }
    if (s.motivo && (s.sub === 'TRATAMENTO' || s.sub === 'MEDICACAO')) campos.motivo = s.motivo;
    if (s.diag && (s.sub === 'EXAME' || s.sub === 'DOENCA')) campos.diagnostico = s.diag;
    if (s.custo) { campos.custo_valor = s.custo.valor; campos.custo_conta_id = sis.custeio; if (s.custo.vezes) campos.custo_parcelas_qtd = s.custo.vezes; }
    return {
      tipo: 'SANIDADE', subtipo: s.sub, campos,
      animais: s.itens.map((x) => {
        const it = { animal_id: x.id };
        if (x.dose !== null && s.sub !== 'DOENCA') it.dose = x.dose;
        if (x.resultado && s.sub === 'EXAME') it.resultado_exame = x.resultado;
        return it;
      }),
    };
  },
  animais: (s) => s.itens.map((x) => x.id),
  // Tira um animal (com mais de um) ou põe outro presente no dia.
  mutarAnimais: (c) => {
    const { s, S, rnd } = c;
    if (s.itens.length > 1 && rnd() < 0.5) s.itens.splice(Math.floor(rnd() * s.itens.length), 1);
    else { const mais = MOVEIS(S).filter((id) => !s.itens.some((x) => x.id === id) && presenca(S, id, s.data).dia); if (mais.length) s.itens.push({ id: sorteio(rnd, mais), dose: null, resultado: null }); }
  },
  // A dose, a quantidade do frasco, a carência ou o serviço pago no ato.
  mutarValores: (c) => {
    const { s, rnd } = c;
    const x = rnd();
    if (x < 0.3 && s.modo && s.modo !== 'TOTAL') s.doseRef = sorteio(rnd, s.modo === 'POR_PESO' ? [0.01, 0.03] : [1, 4, 2.5]);
    else if (x < 0.45 && s.modo) s.qtd = s.qtd === null || s.modo === 'TOTAL' ? sorteio(rnd, [8, 20.25]) : null;
    else if (x < 0.7) s.carencia = sorteio(rnd, [null, 0, 21, 60]);
    else s.custo = rnd() < 0.3 ? null : { valor: sorteio(rnd, [1, 9999, 15000]), vezes: rnd() < 0.3 ? 2 : null };
  },
  // O subtipo (refeito o que é dele), o produto, o modo da dose, o protocolo ou a próxima aplicação.
  mutarOutro: (c) => {
    const { sis, S, s, rnd } = c;
    const x = rnd();
    if (x < 0.3) { s.sub = sorteio(rnd, Object.keys(PROCEDIMENTO_DO_SUB).filter((v) => v !== s.sub)); preencherSanidade(sis, S, rnd, s); }
    else if (x < 0.5 && s.sub !== 'DOENCA') { s.prod = sorteio(rnd, S.t.PRODUTOS).product_id; s.nome = null; s.unidade = null; if (!s.modo) { s.modo = 'POR_CABECA'; s.doseRef = 1; } }
    else if (x < 0.7 && s.prod) { s.modo = sorteio(rnd, ['POR_CABECA', 'POR_PESO', 'TOTAL'].filter((m) => m !== s.modo)); s.doseRef = s.modo === 'POR_PESO' ? 0.02 : s.modo === 'POR_CABECA' ? 2 : null; s.qtd = s.modo === 'TOTAL' ? 15 : null; s.itens.forEach((i) => { i.dose = null; }); }
    else if (x < 0.85) s.protocolo = s.protocolo ? null : sorteio(rnd, S.t.PROTOCOLOS_SANITARIOS).protocol_id;
    else s.proxima = s.proxima ? null : somaDias(s.data, 90);
  },
  doGravado: (c, e) => {
    const { S, data } = c;
    const rows = S.t.SANIDADE.filter((r) => r.event_id === e.event_id);
    if (!rows.length) return null;
    const pj = e.payload_json || {};
    const r0 = rows[0];
    const servico = S.t.FINANCEIRO.filter((f) => f.event_id === e.event_id && !f.product_id)[0];
    const parcelas = servico ? S.t.PARCELAS.filter((p) => p.financial_id === servico.financial_id).length : 0;
    const modo = r0.produto_id || r0.nome_produto ? pj.modo_dose || null : null;
    const doseRef = typeof pj.dose_referencia === 'number' ? pj.dose_referencia : null;
    return {
      tipo: 'SANIDADE', sub: e.event_subtype, data, prod: r0.produto_id || null, nome: r0.produto_id ? null : r0.nome_produto || null, modo, doseRef,
      qtd: modo === 'TOTAL' && typeof pj.quantidade_consumida_total === 'number' ? pj.quantidade_consumida_total : null,
      unidade: !r0.produto_id && modo ? rows.map((r) => r.unidade_dose).filter(Boolean)[0] || 'mL' : null,
      motivo: r0.motivo || null, diag: r0.diagnostico || null, protocolo: r0.protocol_id || null,
      carencia: typeof r0.periodo_carencia_dias === 'number' ? r0.periodo_carencia_dias : null, proxima: r0.data_proxima_aplicacao || null,
      lote: r0.lote || null, validade: r0.lote ? r0.validade || null : null,
      custo: servico ? { valor: servico.valor, vezes: parcelas > 1 ? parcelas : null } : null,
      itens: rows.map((r) => ({ id: r.animal_id, dose: modo === 'POR_CABECA' && typeof r.dose === 'number' && r.dose !== doseRef ? r.dose : null, resultado: r.resultado_exame || null })),
    };
  },
  efeito: (c) => {
    const { d, S, E, eid, erro, linhaDe } = c;
    const cp = d.campos;
    const rows = S.t.SANIDADE.filter((r) => r.event_id === eid);
    if (rows.length !== d.animais.length) erro(rows.length + ' registros de sanidade para ' + d.animais.length + ' animais');
    const prod = cp.produto_id ? S.t.PRODUTOS.find((p) => p.product_id === cp.produto_id) : null;
    const prot = cp.protocol_id ? S.t.PROTOCOLOS_SANITARIOS.find((p) => p.protocol_id === cp.protocol_id) : null;
    const fim = typeof cp.periodo_carencia_dias === 'number' && cp.periodo_carencia_dias > 0 ? somaDias(cp.event_date, cp.periodo_carencia_dias) : null;
    const proxima = cp.data_proxima_aplicacao || (prot && prot.recorrencia_tipo === 'INTERVALO_DIAS' && typeof prot.intervalo_dias === 'number' ? somaDias(cp.event_date, prot.intervalo_dias) : null);
    const unidade = prod ? prod.unidade : cp.unidade_dose || null;
    d.animais.forEach((x) => {
      const r = rows.find((y) => y.animal_id === x.animal_id);
      const l = linhaDe(x.animal_id);
      if (!l || l.efeito_inventario !== 0 || l.papel !== 'SUJEITO') erro('linha da aplicação ' + JSON.stringify(l));
      if (!r) { erro('sem o registro de sanidade do animal ' + x.animal_id); return; }
      const esperado = [PROCEDIMENTO_DO_SUB[d.subtipo], cp.event_date, cp.produto_id || null, prod ? prod.nome : cp.nome_produto || null, cp.protocol_id || null, fim, proxima];
      const gravado = [r.tipo_procedimento, r.data_aplicacao, r.produto_id || null, r.nome_produto || null, r.protocol_id || null, r.data_fim_carencia || null, r.data_proxima_aplicacao || null];
      if (JSON.stringify(gravado) !== JSON.stringify(esperado)) erro('registro de sanidade gravado ' + JSON.stringify(gravado) + ', esperado ' + JSON.stringify(esperado));
      // A dose: a do animal, senão a do lançamento (por cabeça) ou a calculada pelo peso atual (por peso: positiva); total e
      // sem produto, vazia.
      const dose = typeof x.dose === 'number' ? x.dose : cp.modo_dose === 'POR_CABECA' ? cp.dose_referencia : cp.modo_dose === 'POR_PESO' ? undefined : null;
      if (dose === undefined ? !(typeof r.dose === 'number' && r.dose > 0) : (r.dose === undefined ? null : r.dose) !== dose) erro('dose gravada ' + r.dose + ', esperada ' + dose + ' (' + cp.modo_dose + ')');
      if (typeof r.dose === 'number' && r.unidade_dose !== unidade) erro('unidade da dose ' + r.unidade_dose + ', esperada ' + unidade);
    });
    // O consumo (03b, seção 6; PR-11): um movimento de saída do produto do cadastro (a quantidade informada, senão a soma
    // das doses), com estoque controlado ou não; o custo pelo consumo (quantidade × custo unitário de agora) rateado aos
    // tratados, sem parcela; o serviço pago no ato, com as parcelas pedidas; o custo de cada animal = as alocações.
    const doses = rows.map((r) => r.dose);
    const q = prod && cp.modo_dose ? (typeof cp.quantidade_consumida_total === 'number' ? cp.quantidade_consumida_total : cp.modo_dose !== 'TOTAL' && doses.every((v) => typeof v === 'number') ? somaQtd(doses) : null) : null;
    const movs = S.t.MOVIMENTOS_ESTOQUE.filter((mv) => mv.event_id === eid);
    if (q === null ? movs.length : movs.length !== 1 || movs[0].tipo !== 'SAIDA' || movs[0].quantidade !== q || movs[0].product_id !== prod.product_id || movs[0].data !== cp.event_date) erro('movimentos ' + JSON.stringify(movs.map((mv) => [mv.tipo, mv.quantidade, mv.data])) + ', esperada a saída de ' + q);
    const fins = S.t.FINANCEIRO.filter((f) => f.event_id === eid);
    const cu = prod && typeof prod.custo_unitario === 'number' && prod.custo_unitario > 0 ? prod.custo_unitario : null;
    const vc = q !== null && cu ? centavosDe(q * cu) : 0;
    const consumo = fins.filter((f) => f.product_id);
    const servico = fins.filter((f) => !f.product_id);
    const conta = (f) => (S.t.PLANO_CONTAS.find((p) => p.conta_id === f.conta_id) || {}).codigo;
    if (vc > 0 ? consumo.length !== 1 || consumo[0].valor !== vc || consumo[0].product_id !== prod.product_id || consumo[0].quantidade !== q || conta(consumo[0]) !== CONTA_DA_CATEGORIA[prod.categoria] : consumo.length) erro('consumo ' + JSON.stringify(consumo.map((f) => [f.valor, f.quantidade, conta(f)])) + ', esperado ' + vc + ' (' + q + ' × ' + cu + ')');
    consumo.forEach((f) => { if (S.t.PARCELAS.some((p) => p.financial_id === f.financial_id)) erro('o consumo do produto tem parcela'); });
    if (cp.custo_valor ? servico.length !== 1 || servico[0].valor !== cp.custo_valor || S.t.PARCELAS.filter((p) => p.financial_id === servico[0].financial_id).length !== (cp.custo_parcelas_qtd || 1) : servico.length) erro('serviço pago no ato ' + JSON.stringify(servico.map((f) => f.valor)) + ', pedido ' + cp.custo_valor);
    const alocs = S.t.ALOCACOES_FINANCEIRAS.filter((a) => fins.some((f) => f.financial_id === a.financial_id));
    rows.forEach((r) => {
      const v = fins.length ? alocs.filter((a) => a.animal_id === r.animal_id).reduce((t, a) => t + a.valor_alocado, 0) : null;
      if ((r.custo === undefined ? null : r.custo) !== v) erro('custo do animal ' + r.animal_id + ' gravado ' + r.custo + ', alocado ' + v);
    });
    // No rateio por cabeça, as partes diferem em no máximo um centavo.
    consumo.concat(servico).forEach((f) => {
      const partes = alocs.filter((a) => a.financial_id === f.financial_id).map((a) => a.valor_alocado);
      const porPeso = f.product_id && cp.modo_dose === 'POR_PESO' && rows.length > 1;
      if (!porPeso && partes.length && Math.max.apply(null, partes) - Math.min.apply(null, partes) > 1) erro('rateio por cabeça desigual ' + JSON.stringify(partes));
    });
    const total = fins.reduce((t, f) => t + f.valor, 0);
    if (fins.length && E.total_value !== total) erro('valor do evento ' + E.total_value + ', lançamentos ' + total);
  },
});
registrarTipo('ESTOQUE', {
  peso: () => 3,
  propor: (c) => {
    const { sis, S, rnd, D } = c;
    const prod = rnd() < 0.7 ? sis.produtos[sorteio(rnd, ['vacina', 'antibiotico'])] : (sorteio(rnd, S.t.PRODUTOS) || {}).product_id;
    if (!prod) return null;
    const s = { tipo: 'ESTOQUE', sub: rnd() < 0.6 ? 'ENTRADA' : 'AJUSTE', data: D, prod };
    preencherEstoque(S, rnd, s);
    return s;
  },
  montar: (sis, s) => {
    const campos = { event_date: s.data, product_id: s.prod };
    if (s.sub === 'ENTRADA') {
      if (s.emb !== null) campos.qtd_apresentacao = s.emb;
      if (s.qtd !== null) campos.quantidade = s.qtd;
      campos.valor = s.valor;
      if (s.parceiro) campos.partner_id = s.parceiro;
      if (s.vezes) campos.parcelas_qtd = s.vezes;
    } else {
      campos.motivo_ajuste = s.motivo;
      if (s.motivo === 'CONTAGEM') campos.saldo_contado = s.contado;
      else campos.quantidade = s.qtd;
    }
    if (s.lote) { campos.lote = s.lote; campos.validade = s.validade; }
    return { tipo: 'ESTOQUE', subtipo: s.sub, campos, animais: [] };
  },
  animais: () => [],
  mutarValores: (c) => preencherEstoque(c.S, c.rnd, c.s),
  mutarOutro: (c) => {
    const { S, s, rnd } = c;
    if (rnd() < 0.5) s.prod = sorteio(rnd, S.t.PRODUTOS).product_id;
    else { s.sub = s.sub === 'ENTRADA' ? 'AJUSTE' : 'ENTRADA'; preencherEstoque(S, rnd, s); }
  },
  efeito: (c) => {
    const { d, S, E, eid, erro, lsE } = c;
    const cp = d.campos;
    const prod = S.t.PRODUTOS.find((p) => p.product_id === cp.product_id);
    if (lsE.length) erro('o evento de estoque tem linhas de animal');
    const movs = S.t.MOVIMENTOS_ESTOQUE.filter((mv) => mv.event_id === eid);
    const fins = S.t.FINANCEIRO.filter((f) => f.event_id === eid);
    if (d.subtipo === 'ENTRADA') {
      // Compra de insumo (16.9): sempre o lançamento de compra de insumos, com as parcelas; a entrada só com o controle.
      const q = typeof cp.quantidade === 'number' ? cp.quantidade : somaQtd([cp.qtd_apresentacao * prod.fator_conversao]);
      const f = fins[0];
      const conta = f && (S.t.PLANO_CONTAS.find((p) => p.conta_id === f.conta_id) || {}).codigo;
      if (fins.length !== 1 || f.valor !== cp.valor || f.product_id !== prod.product_id || f.quantidade !== q || conta !== 'COMPRA_INSUMOS') erro('compra ' + JSON.stringify(fins.map((x) => [x.valor, x.quantidade, x.product_id])) + ', pedida ' + JSON.stringify([cp.valor, q]));
      else if (S.t.PARCELAS.filter((p) => p.financial_id === f.financial_id).length !== (cp.parcelas_qtd || 1)) erro('parcelas da compra de insumo');
      const cu = Math.round(Number((cp.valor / 100 / q).toFixed(10)) * 10000) / 10000;
      if (prod.controla_estoque === true ? movs.length !== 1 || movs[0].tipo !== 'ENTRADA' || movs[0].quantidade !== q || Math.abs(movs[0].custo_unitario - cu) > 0.00011 : movs.length) erro('movimentos da entrada ' + JSON.stringify(movs.map((mv) => [mv.tipo, mv.quantidade, mv.custo_unitario])) + ', esperado ' + (prod.controla_estoque === true ? q : 'nenhum'));
      if (E.total_value !== cp.valor) erro('valor do evento ' + E.total_value + ', pedido ' + cp.valor);
      return;
    }
    // O acerto: sem lançamento; a contagem lança a diferença para o saldo na data (sem este evento), a perda e o
    // vencimento tiram a quantidade.
    if (fins.length) erro('acerto de estoque com lançamento financeiro');
    let esperado;
    if (cp.motivo_ajuste === 'CONTAGEM') {
      const antes = S.t.MOVIMENTOS_ESTOQUE.filter((mv) => mv.product_id === prod.product_id && mv.event_id !== eid && S.vig.get(mv.event_id) && mv.data <= cp.event_date);
      esperado = somaQtd([cp.saldo_contado, -somaQtd(antes.map((mv) => (mv.tipo === 'SAIDA' ? -mv.quantidade : mv.quantidade)))]);
    } else esperado = -cp.quantidade;
    if (movs.length !== 1 || movs[0].tipo !== 'AJUSTE' || movs[0].quantidade !== esperado || movs[0].data !== cp.event_date) erro('movimento do acerto ' + JSON.stringify(movs.map((mv) => [mv.tipo, mv.quantidade])) + ', esperado ' + esperado);
  },
});
/** A entrada (embalagens, quantidade, valor, parcelas) ou o acerto (contagem, perda, vencimento) de estoque. */
function preencherEstoque(S, rnd, s) {
  Object.assign(s, { emb: null, qtd: null, valor: null, vezes: null, parceiro: null, motivo: null, contado: null, lote: null, validade: null });
  if (s.sub === 'ENTRADA') {
    if (rnd() < 0.5) s.emb = sorteio(rnd, [1, 2, 0.5]);
    if (s.emb === null || rnd() < 0.12) s.qtd = sorteio(rnd, [50, 100, 250.5, 12]);
    s.valor = sorteio(rnd, [1, 9250, 18500, 123456]);
    if (rnd() < 0.3) s.vezes = sorteio(rnd, [2, 3]);
    if (rnd() < 0.3 && S.t.PARCEIROS.length) s.parceiro = sorteio(rnd, S.t.PARCEIROS).partner_id;
  } else {
    s.motivo = sorteio(rnd, ['CONTAGEM', 'CONTAGEM', 'PERDA', 'VENCIMENTO']);
    if (s.motivo === 'CONTAGEM') s.contado = sorteio(rnd, [0, 10, 25.5, 100]);
    else s.qtd = sorteio(rnd, [1, 2.5, 10]);
  }
  if (rnd() < 0.25) { s.lote = 'E' + Math.floor(rnd() * 90 + 10); s.validade = somaDias(s.data, sorteio(rnd, [400, 60])); }
}

// --- REPRODUCAO, DESMAMA, CASTRACAO e OCORRENCIA (Fase 3, E3.4 e E3.5) ---
// A reprodução nos cinco subtipos: a exposição do lote (fêmeas e touros na mesma lista; às vezes dois touros, às vezes
// nenhum; a retirada às vezes antes do início: a recusa), a cobertura (touro do rebanho, de fora ou nenhum), a inseminação
// (o touro do sêmen, a partida), o diagnóstico em lote (positivo, negativo, duvidoso, sem resultado: a recusa; a idade da
// gestação e a previsão informada, às vezes fora do positivo ou acima da gestação: a recusa) e o aborto; a estação de monta
// (criada e editada no meio) ou nenhuma; o macho no lugar da fêmea; a despesa paga no ato. A desmama dos bezerros (às vezes
// de quem não é cria) com peso e pasto de destino; a castração (às vezes de fêmea ou de castrado: a recusa); a ocorrência.
const METODO_REPRO = { COBERTURA: ['MONTA_NATURAL', 'MONTA_CONTROLADA'], INSEMINACAO: ['IA', 'IATF'], DIAGNOSTICO_GESTACAO: ['PALPACAO', 'ULTRASSOM', 'OBSERVACAO', 'INFORMADO'] };
const TIPOS_OCORRENCIA = ['OBSERVACAO', 'LESAO', 'OBSERVACAO', 'XYZ'];
const custoManejo = (rnd) => (rnd() < 0.15 ? { valor: sorteio(rnd, [1, 2, 4500, 33333]), vezes: rnd() < 0.3 ? 2 : null } : null);
function camposDoCusto(sis, campos, custo) {
  if (!custo) return;
  campos.custo_valor = custo.valor;
  campos.custo_conta_id = sis.custeio;
  if (custo.vezes) campos.custo_parcelas_qtd = custo.vezes;
}
function custoDoGravado(S, e) {
  const f = S.t.FINANCEIRO.filter((x) => x.event_id === e.event_id)[0];
  if (!f) return null;
  const n = S.t.PARCELAS.filter((p) => p.financial_id === f.financial_id).length;
  return { valor: f.valor, vezes: n > 1 ? n : null };
}
/** A despesa paga no ato (CUSTEIO na conta escolhida, as parcelas, rateada por cabeça entre `ids`; o valor do evento). */
function efeitoDespesa(c, ids) {
  const { d, S, E, eid, erro } = c;
  const cp = d.campos;
  const fins = S.t.FINANCEIRO.filter((f) => f.event_id === eid);
  if (!cp.custo_valor) { if (fins.length) erro('lançamento financeiro sem despesa pedida'); return; }
  const f = fins[0];
  if (fins.length !== 1 || f.valor !== cp.custo_valor || f.natureza !== 'CUSTEIO' || f.conta_id !== cp.custo_conta_id) { erro('despesa ' + JSON.stringify(fins.map((x) => [x.valor, x.natureza])) + ', pedida ' + cp.custo_valor); return; }
  if (S.t.PARCELAS.filter((p) => p.financial_id === f.financial_id).length !== (cp.custo_parcelas_qtd || 1)) erro('parcelas da despesa');
  const alocs = S.t.ALOCACOES_FINANCEIRAS.filter((a) => a.financial_id === f.financial_id);
  const partes = alocs.map((a) => a.valor_alocado);
  if (alocs.length !== ids.length || ids.some((id) => !alocs.some((a) => a.animal_id === id)) || partes.reduce((t, v) => t + v, 0) !== cp.custo_valor) erro('rateio da despesa ' + JSON.stringify(alocs.map((a) => [a.animal_id, a.valor_alocado])) + ' entre ' + ids.length);
  else if (Math.max.apply(null, partes) - Math.min.apply(null, partes) > 1) erro('rateio por cabeça desigual ' + JSON.stringify(partes));
  if (E.total_value !== cp.custo_valor) erro('valor do evento ' + E.total_value + ', despesa ' + cp.custo_valor);
}
/** O que é do subtipo da reprodução: os touros do lote, o touro, o sêmen, o método, a retirada e os resultados. */
function preencherReproducao(S, rnd, s) {
  Object.assign(s, { touros: [], touro: null, semen: null, metodo: null, fim: null });
  const machos = MOVEIS(S).filter((id) => (S.animais.get(id) || {}).sexo === 'M' && presenca(S, id, s.data).dia);
  if (s.sub === 'EXPOSICAO') {
    const x = rnd();
    s.touros = x < 0.6 ? alguns(rnd, machos, 1) : x < 0.75 ? alguns(rnd, machos, 2) : [];
    if (rnd() < 0.5) s.fim = somaDias(s.data, sorteio(rnd, [30, 60, 90, 0, -3]));
  }
  if (s.sub === 'COBERTURA') { const x = rnd(); s.touro = x < 0.6 ? sorteio(rnd, machos) : x < 0.85 ? sorteio(rnd, EXTERNOS(S)) : null; }
  if (s.sub === 'INSEMINACAO') {
    s.touro = rnd() < 0.6 ? sorteio(rnd, EXTERNOS(S).concat(machos)) : null;
    if (rnd() < 0.6) s.semen = sorteio(rnd, ['Partida 12', 'Palheta A-7']);
  }
  if (METODO_REPRO[s.sub] && rnd() < 0.7) s.metodo = sorteio(rnd, METODO_REPRO[s.sub]);
  s.itens.forEach((x) => {
    Object.assign(x, { resultado: null, idade: null, prevista: null });
    if (s.sub === 'DIAGNOSTICO_GESTACAO') {
      x.resultado = rnd() < 0.03 ? null : sorteio(rnd, ['POSITIVO', 'POSITIVO', 'NEGATIVO', 'INCONCLUSIVO']);
      if (x.resultado === 'POSITIVO' ? rnd() < 0.6 : rnd() < 0.02) x.idade = sorteio(rnd, [30, 60, 120, 200, 45, 400]);
      if (x.resultado === 'POSITIVO' && rnd() < 0.2) x.prevista = somaDias(s.data, sorteio(rnd, [150, 200, 0]));
    }
    if (s.sub === 'ABORTO' && rnd() < 0.5) x.idade = sorteio(rnd, [60, 150]);
  });
}
const femeasDoDia = (S, rnd, D, max) => animaisPara(S, rnd, D, max, (id, p) => p.dia && fem(S, id));
registrarTipo('REPRODUCAO', {
  peso: () => 6,
  propor: (c) => {
    const { S, rnd, D } = c;
    const ids = femeasDoDia(S, rnd, D, rnd() < 0.5 ? 1 : 4);
    if (!ids.length) return null;
    const data = rnd() < 0.4 ? dataPara(S, rnd, ids) : D;
    const sub = sorteio(rnd, ['EXPOSICAO', 'EXPOSICAO', 'COBERTURA', 'INSEMINACAO', 'DIAGNOSTICO_GESTACAO', 'DIAGNOSTICO_GESTACAO', 'ABORTO']);
    const ests = (S.t.ESTACOES_MONTA || []).map((e) => e.estacao_id);
    const s = { tipo: 'REPRODUCAO', sub, data, itens: ids.map((id) => ({ id })), estacao: sub !== 'ABORTO' && ests.length && rnd() < 0.5 ? sorteio(rnd, ests) : null, custo: custoManejo(rnd) };
    preencherReproducao(S, rnd, s);
    return s;
  },
  montar: (sis, s) => {
    const campos = { event_date: s.data };
    if (s.estacao && s.sub !== 'ABORTO') campos.estacao_id = s.estacao;
    if (s.sub === 'EXPOSICAO' && s.fim) campos.data_fim = s.fim;
    if ((s.sub === 'COBERTURA' || s.sub === 'INSEMINACAO') && s.touro) campos.touro_id = s.touro;
    if (s.sub === 'INSEMINACAO' && s.semen) campos.semen_identificacao = s.semen;
    if (METODO_REPRO[s.sub] && s.metodo) campos.metodo = s.metodo;
    camposDoCusto(sis, campos, s.custo);
    const animais = s.itens.map((x) => {
      const it = { animal_id: x.id };
      if (s.sub === 'DIAGNOSTICO_GESTACAO') {
        if (x.resultado) it.resultado = x.resultado;
        if (x.idade !== null && x.idade !== undefined) it.idade_gestacional_dias = x.idade;
        if (x.prevista) it.data_prevista_parto = x.prevista;
      }
      if (s.sub === 'ABORTO' && x.idade !== null && x.idade !== undefined) it.idade_gestacional_dias = x.idade;
      return it;
    });
    return { tipo: 'REPRODUCAO', subtipo: s.sub, campos, animais: animais.concat(s.sub === 'EXPOSICAO' ? (s.touros || []).map((animal_id) => ({ animal_id })) : []) };
  },
  animais: (s) => s.itens.map((x) => x.id).concat(s.touros || []),
  // Tira uma fêmea (com mais de uma) ou põe outra presente no dia.
  mutarAnimais: (c) => {
    const { s, S, rnd } = c;
    if (s.itens.length > 1 && rnd() < 0.5) s.itens.splice(Math.floor(rnd() * s.itens.length), 1);
    else { const mais = MOVEIS(S).filter((id) => fem(S, id) && !s.itens.some((x) => x.id === id) && presenca(S, id, s.data).dia); if (mais.length) s.itens.push({ id: sorteio(rnd, mais), resultado: s.sub === 'DIAGNOSTICO_GESTACAO' ? 'NEGATIVO' : null, idade: null, prevista: null }); }
  },
  // Os resultados e as idades (refeito o que é do subtipo), a retirada ou a despesa.
  mutarValores: (c) => {
    const { s, S, rnd } = c;
    if (rnd() < 0.6) preencherReproducao(S, rnd, s);
    else s.custo = rnd() < 0.4 ? null : { valor: sorteio(rnd, [1, 9999]), vezes: null };
  },
  // O subtipo (refeito o que é dele) ou a estação.
  mutarOutro: (c) => {
    const { s, S, rnd } = c;
    if (rnd() < 0.5) { s.sub = sorteio(rnd, ['EXPOSICAO', 'COBERTURA', 'INSEMINACAO', 'DIAGNOSTICO_GESTACAO', 'ABORTO'].filter((v) => v !== s.sub)); preencherReproducao(S, rnd, s); }
    else s.estacao = s.estacao ? null : (sorteio(rnd, S.t.ESTACOES_MONTA || []) || {}).estacao_id || null;
  },
  doGravado: (c, e) => {
    const { S, data } = c;
    const rows = S.t.REPRODUCAO.filter((r) => r.event_id === e.event_id);
    if (!rows.length) return null;
    const r0 = rows[0];
    const sub = e.event_subtype;
    const touros = S.t.EVENTO_ANIMAIS.filter((l) => l.event_id === e.event_id && l.papel === 'TOURO').map((l) => l.animal_id);
    return {
      tipo: 'REPRODUCAO', sub, data, estacao: r0.estacao_id || null, fim: r0.data_fim || null, metodo: r0.metodo || null, semen: r0.semen_identificacao || null,
      touro: sub === 'COBERTURA' || sub === 'INSEMINACAO' ? r0.touro_id || null : null, touros: sub === 'EXPOSICAO' ? touros : [], custo: custoDoGravado(S, e),
      itens: rows.map((r) => ({ id: r.animal_id, resultado: r.resultado || null, idade: typeof r.idade_gestacional_dias === 'number' ? r.idade_gestacional_dias : null, prevista: r.data_prevista_parto || null })),
    };
  },
  efeito: (c) => {
    const { d, S, eid, erro, linhaDe, lsE } = c;
    const cp = d.campos;
    const sub = d.subtipo;
    const rows = S.t.REPRODUCAO.filter((r) => r.event_id === eid);
    const femeas = d.animais.filter((x) => fem(S, x.animal_id));
    const machos = d.animais.filter((x) => !fem(S, x.animal_id));
    if (sub !== 'EXPOSICAO' && machos.length) erro('reprodução aceita com macho na lista de ' + sub);
    if (rows.length !== femeas.length) erro(rows.length + ' registros de reprodução para ' + femeas.length + ' fêmeas');
    const touro = sub === 'EXPOSICAO' ? (machos.length === 1 ? machos[0].animal_id : null) : cp.touro_id || null;
    femeas.forEach((x) => {
      const r = rows.find((y) => y.animal_id === x.animal_id);
      const l = linhaDe(x.animal_id);
      if (!l || l.efeito_inventario !== 0 || (l.papel || 'SUJEITO') !== 'SUJEITO') erro('linha da fêmea ' + JSON.stringify(l));
      if (!r) { erro('sem o registro de reprodução da fêmea ' + x.animal_id); return; }
      const positivo = sub === 'DIAGNOSTICO_GESTACAO' && x.resultado === 'POSITIVO';
      const esperado = [sub, cp.event_date, cp.estacao_id || null, touro, sub === 'EXPOSICAO' ? cp.data_fim || null : null, METODO_REPRO[sub] ? cp.metodo || null : null, sub === 'INSEMINACAO' ? cp.semen_identificacao || null : null,
        sub === 'DIAGNOSTICO_GESTACAO' ? x.resultado || null : null, (sub === 'ABORTO' || positivo) && typeof x.idade_gestacional_dias === 'number' ? x.idade_gestacional_dias : null, positivo ? x.data_prevista_parto || null : null];
      const gravado = [r.tipo_evento, r.data, r.estacao_id || null, r.touro_id || null, r.data_fim || null, r.metodo || null, r.semen_identificacao || null, r.resultado || null, typeof r.idade_gestacional_dias === 'number' ? r.idade_gestacional_dias : null, r.data_prevista_parto || null];
      if (JSON.stringify(gravado) !== JSON.stringify(esperado)) erro('registro de reprodução gravado ' + JSON.stringify(gravado) + ', esperado ' + JSON.stringify(esperado));
    });
    machos.forEach((x) => { const l = linhaDe(x.animal_id); if (!l || l.papel !== 'TOURO' || l.efeito_inventario !== 0) erro('linha do touro do lote ' + JSON.stringify(l)); });
    // O touro da cobertura do rebanho tem a linha TOURO; o de fora e o do sêmen, nenhuma.
    let extra = 0;
    if (sub === 'COBERTURA' || sub === 'INSEMINACAO') {
      const t = cp.touro_id ? S.animais.get(cp.touro_id) : null;
      const l = cp.touro_id ? linhaDe(cp.touro_id) : null;
      const deveTer = sub === 'COBERTURA' && !!t && t.situacao_cadastral !== 'EXTERNO';
      if (deveTer) extra = 1;
      if (deveTer !== !!(l && l.papel === 'TOURO' && l.efeito_inventario === 0)) erro('linha do touro ' + JSON.stringify(l) + ' (' + (t ? t.situacao_cadastral : 'sem touro') + ')');
    }
    if (lsE.length !== femeas.length + machos.length + extra) erro(lsE.length + ' linhas no evento');
    efeitoDespesa(c, femeas.map((x) => x.animal_id));
  },
});
registrarTipo('DESMAMA', {
  peso: () => 3,
  propor: (c) => {
    const { S, rnd, D } = c;
    // Os mais novos do rebanho (às vezes um adulto: a recusa).
    const jovem = (id) => { const a = S.animais.get(id) || {}; return !!a.data_nascimento && a.data_nascimento > somaDias(D, -400); };
    const ids = animaisPara(S, rnd, D, rnd() < 0.6 ? 1 : 3, (id, p) => p.dia && (jovem(id) || rnd() < 0.05));
    if (!ids.length) return null;
    const data = rnd() < 0.3 ? dataPara(S, rnd, ids) : D;
    return { tipo: 'DESMAMA', data, itens: ids.map((id) => ({ id, peso: rnd() < 0.5 ? sorteio(rnd, [150, 182.5, 210]) : null })), pasto: rnd() < 0.5 ? sorteio(rnd, PASTOS_DE(S)) : null, metodo: rnd() < 0.3 ? sorteio(rnd, ['FITA', 'ESTIMATIVA_VISUAL']) : null };
  },
  montar: (sis, s) => {
    const campos = { event_date: s.data };
    if (s.pasto) campos.pasto_destino_id = s.pasto;
    if (s.metodo) campos.metodo_pesagem = s.metodo;
    return { tipo: 'DESMAMA', campos, animais: s.itens.map((x) => (x.peso !== null ? { animal_id: x.id, peso: x.peso } : { animal_id: x.id })) };
  },
  animais: (s) => s.itens.map((x) => x.id),
  mutarAnimais: (c) => {
    const { s, S, rnd } = c;
    if (s.itens.length > 1 && rnd() < 0.5) s.itens.splice(Math.floor(rnd() * s.itens.length), 1);
    else { const mais = MOVEIS(S).filter((id) => !s.itens.some((x) => x.id === id) && presenca(S, id, s.data).dia && ((S.animais.get(id) || {}).data_nascimento || '') > somaDias(s.data, -400)); if (mais.length) s.itens.push({ id: sorteio(rnd, mais), peso: null }); }
  },
  mutarValores: (c) => { c.s.itens.forEach((x) => { x.peso = c.rnd() < 0.5 ? sorteio(c.rnd, [160, 199.5]) : null; }); },
  mutarOutro: (c) => { const { s, S, rnd } = c; s.pasto = s.pasto && rnd() < 0.5 ? null : sorteio(rnd, PASTOS_DE(S)); },
  doGravado: (c, e) => {
    const { S, data } = c;
    const ls = S.t.EVENTO_ANIMAIS.filter((l) => l.event_id === e.event_id && l.papel === 'SUJEITO');
    if (!ls.length) return null;
    const pes = S.t.PESAGENS.filter((p) => p.event_id === e.event_id);
    return { tipo: 'DESMAMA', data, pasto: (ls.find((l) => l.pasto_destino_id) || {}).pasto_destino_id || null, metodo: pes.length ? pes[0].metodo : null, itens: ls.map((l) => ({ id: l.animal_id, peso: typeof l.peso === 'number' ? l.peso : null })) };
  },
  efeito: (c) => {
    const { d, S, eid, erro, linhaDe, lsE } = c;
    const cp = d.campos;
    const pes = S.t.PESAGENS.filter((p) => p.event_id === eid);
    const maes = new Set();
    d.animais.forEach((x) => {
      const l = linhaDe(x.animal_id);
      if (!l || l.efeito_inventario !== 0 || (l.papel || 'SUJEITO') !== 'SUJEITO') { erro('linha do bezerro ' + JSON.stringify(l)); return; }
      if (l.pasto_destino_id && l.pasto_destino_id !== cp.pasto_destino_id) erro('o bezerro foi para ' + l.pasto_destino_id + ', pedido ' + cp.pasto_destino_id);
      if (!!l.pasto_destino_id !== !!l.pasto_origem_id) erro('movimento da desmama sem origem ou sem destino ' + JSON.stringify([l.pasto_origem_id, l.pasto_destino_id]));
      if (l.pasto_destino_id && l.pasto_origem_id === l.pasto_destino_id) erro('movimento da desmama para o mesmo pasto');
      const p = pes.filter((y) => y.animal_id === x.animal_id);
      const kg = typeof x.peso === 'number' ? x.peso : null;
      if ((l.peso === undefined || l.peso === '' ? null : l.peso) !== kg) erro('peso na linha ' + l.peso + ', pedido ' + kg);
      if (kg === null ? p.length : p.length !== 1 || p[0].peso_kg !== kg || p[0].tipo !== 'DESMAMA' || p[0].data_pesagem !== cp.event_date || p[0].metodo !== (cp.metodo_pesagem || 'BALANCA')) erro('pesagem da desmama ' + JSON.stringify(p.map((y) => [y.peso_kg, y.tipo, y.metodo])) + ', pedido ' + kg);
      const a = S.animais.get(x.animal_id) || {};
      if (a.mae_id) maes.add(a.mae_id);
    });
    // As mães: a linha MATRIZ e o registro DESMAMA uma vez por mãe (só as do rebanho na data).
    const matrizes = lsE.filter((l) => l.papel === 'MATRIZ');
    const regs = S.t.REPRODUCAO.filter((r) => r.event_id === eid);
    matrizes.forEach((l) => {
      if (!maes.has(l.animal_id) || l.efeito_inventario !== 0) erro('linha MATRIZ de quem não é mãe dos bezerros: ' + l.animal_id);
      if (regs.filter((r) => r.animal_id === l.animal_id && r.tipo_evento === 'DESMAMA' && r.data === cp.event_date).length !== 1) erro('a mãe ' + l.animal_id + ' sem o registro DESMAMA');
    });
    if (regs.length !== matrizes.length || new Set(matrizes.map((l) => l.animal_id)).size !== matrizes.length) erro(regs.length + ' registros DESMAMA para ' + matrizes.length + ' linhas de mãe');
    if (lsE.length !== d.animais.length + matrizes.length) erro(lsE.length + ' linhas no evento');
    if (S.t.FINANCEIRO.some((f) => f.event_id === eid)) erro('desmama com lançamento financeiro');
  },
});
registrarTipo('CASTRACAO', {
  peso: () => 3,
  propor: (c) => {
    const { S, rnd, D } = c;
    const ids = animaisPara(S, rnd, D, rnd() < 0.7 ? 1 : 3, (id, p) => p.dia && ((S.animais.get(id) || {}).sexo === 'M' || rnd() < 0.05));
    if (!ids.length) return null;
    return { tipo: 'CASTRACAO', data: rnd() < 0.4 ? dataPara(S, rnd, ids) : D, ids, metodo: rnd() < 0.5 ? sorteio(rnd, ['Cirúrgica', 'Burdizzo', ' Elástico ']) : null, custo: custoManejo(rnd) };
  },
  montar: (sis, s) => {
    const campos = { event_date: s.data };
    if (s.metodo) campos.metodo = s.metodo;
    camposDoCusto(sis, campos, s.custo);
    return { tipo: 'CASTRACAO', campos, animais: linhasDosIds(s) };
  },
  animais: (s) => s.ids,
  mutarAnimais: mutarIds,
  mutarValores: (c) => { c.s.custo = c.s.custo && c.rnd() < 0.5 ? null : { valor: sorteio(c.rnd, [3, 12000]), vezes: null }; },
  mutarOutro: (c) => { c.s.metodo = c.s.metodo ? null : 'Burdizzo'; },
  doGravado: (c, e) => {
    const ls = c.S.t.EVENTO_ANIMAIS.filter((l) => l.event_id === e.event_id);
    if (!ls.length) return null;
    return { tipo: 'CASTRACAO', data: c.data, ids: ls.map((l) => l.animal_id), metodo: (e.payload_json || {}).metodo || null, custo: custoDoGravado(c.S, e) };
  },
  efeito: (c) => {
    const { d, S, E, erro, linhaDe, lsE } = c;
    const cp = d.campos;
    d.animais.forEach((x) => {
      const l = linhaDe(x.animal_id);
      if (!l || l.efeito_inventario !== 0 || (l.papel || 'SUJEITO') !== 'SUJEITO') erro('linha da castração ' + JSON.stringify(l));
      const a = S.animais.get(x.animal_id) || {};
      if (a.sexo !== 'M') erro('castração aceita de quem não é macho');
      if (a.castrado !== true || a.reprodutor !== false) erro(a.codigo_interno + ' castrado ' + a.castrado + ', reprodutor ' + a.reprodutor + ' depois da castração');
    });
    if (lsE.length !== d.animais.length) erro(lsE.length + ' linhas no evento');
    const metodo = typeof cp.metodo === 'string' && cp.metodo.trim() ? cp.metodo.trim() : null;
    if (((E.payload_json || {}).metodo || null) !== metodo) erro('método gravado ' + (E.payload_json || {}).metodo + ', pedido ' + metodo);
    efeitoDespesa(c, d.animais.map((x) => x.animal_id));
  },
});
registrarTipo('OCORRENCIA', {
  peso: () => 2,
  propor: (c) => {
    const { S, rnd, D } = c;
    const ids = animaisPara(S, rnd, D, rnd() < 0.7 ? 1 : 3, (id, p) => p.dia);
    if (!ids.length) return null;
    return { tipo: 'OCORRENCIA', data: rnd() < 0.4 ? dataPara(S, rnd, ids) : D, ids, oc: sorteio(rnd, TIPOS_OCORRENCIA), desc: rnd() < 0.04 ? '' : sorteio(rnd, ['Mancando', 'Cortou a pata na cerca']), custo: custoManejo(rnd) };
  },
  montar: (sis, s) => {
    const campos = { event_date: s.data, tipo_ocorrencia: s.oc, description: s.desc };
    camposDoCusto(sis, campos, s.custo);
    return { tipo: 'OCORRENCIA', campos, animais: linhasDosIds(s) };
  },
  animais: (s) => s.ids,
  mutarAnimais: mutarIds,
  mutarValores: (c) => { c.s.custo = c.s.custo && c.rnd() < 0.5 ? null : { valor: sorteio(c.rnd, [5, 800]), vezes: null }; },
  mutarOutro: (c) => { if (c.rnd() < 0.5) c.s.oc = sorteio(c.rnd, ['OBSERVACAO', 'LESAO'].filter((v) => v !== c.s.oc)); else c.s.desc = 'Ferida no casco'; },
  doGravado: (c, e) => {
    const ls = c.S.t.EVENTO_ANIMAIS.filter((l) => l.event_id === e.event_id);
    if (!ls.length) return null;
    return { tipo: 'OCORRENCIA', data: c.data, ids: ls.map((l) => l.animal_id), oc: (e.payload_json || {}).tipo_ocorrencia || 'OBSERVACAO', desc: e.description || 'Ocorrência', custo: custoDoGravado(c.S, e) };
  },
  efeito: (c) => {
    const { d, E, erro, linhaDe, lsE } = c;
    const cp = d.campos;
    d.animais.forEach((x) => { const l = linhaDe(x.animal_id); if (!l || l.efeito_inventario !== 0 || (l.papel || 'SUJEITO') !== 'SUJEITO' || l.pasto_destino_id) erro('linha da ocorrência ' + JSON.stringify(l)); });
    if (lsE.length !== d.animais.length) erro(lsE.length + ' linhas no evento');
    if (((E.payload_json || {}).tipo_ocorrencia || null) !== cp.tipo_ocorrencia || E.description !== cp.description) erro('ocorrência gravada ' + JSON.stringify([(E.payload_json || {}).tipo_ocorrencia, E.description]) + ', pedida ' + JSON.stringify([cp.tipo_ocorrencia, cp.description]));
    efeitoDespesa(c, d.animais.map((x) => x.animal_id));
  },
});

/**
 * O registro único dos arquivos de importação do teste aleatório: cada tipo de importação declara o arquivo que o gerador
 * monta (`arquivo(c)` → {texto, mapa} | null, com c = {sis, S, rnd, P (nome de cada pasto), pastoNome(), ativos, comBrinco,
 * b(id) (o brinco), data(), qual()}) e `vezes` (o peso no sorteio). As etapas seguintes só acrescentam entradas; a ordem de
 * registro é a do sorteio. O oráculo da importação é o do estado (rotas importacao.*, em oraculoEfeito) e o de cada
 * evento que ela grava (o global).
 */
const IMPORTADORES = new Map();
function registrarImportador(tipo, def) {
  if (typeof def.arquivo !== 'function') throw new Error('a importação ' + tipo + ' do teste aleatório está sem arquivo');
  if (IMPORTADORES.has(tipo)) throw new Error('a importação ' + tipo + ' foi registrada duas vezes no teste aleatório');
  IMPORTADORES.set(tipo, Object.assign({ vezes: 1 }, def));
}
/** A lista do sorteio do tipo de importação (cada tipo repetido `vezes`). */
const sorteioDeImportacao = () => Array.from(IMPORTADORES).reduce((l, [tipo, d]) => l.concat(Array.from({ length: d.vezes }, () => tipo)), []);
/** CSV de importação de um tipo, montado com os brincos de hoje (às vezes de propósito errado). */
function arquivoImportacao(sis, S, rnd, tipo) {
  const I = IMPORTADORES.get(tipo);
  if (!I) return null;
  const P = Object.fromEntries(S.t.PASTOS.map((p) => [p.pasture_id, p.nome]));
  const ativos = MOVEIS(S).filter((id) => S.animais.get(id).situacao_cadastral === 'ATIVO' && S.animais.get(id).brinco);
  const comBrinco = MOVEIS(S).filter((id) => S.animais.get(id).brinco);
  const c = {
    sis, S, rnd, P, ativos, comBrinco,
    pastoNome: () => sorteio(rnd, Object.values(P)),
    b: (id) => S.animais.get(id).brinco,
    data: () => { const d = dataPara(S, rnd, [], { antiga: true }); return d > HOJE ? HOJE : d; },
    qual: () => (rnd() < 0.85 && ativos.length ? sorteio(rnd, ativos) : sorteio(rnd, comBrinco)),
  };
  return I.arquivo(c);
}
registrarImportador('ANIMAIS', {
  vezes: 2,
  arquivo: (c) => {
    const { S, rnd, b, pastoNome } = c;
    const linhas = ['brinco;sexo;nascimento;pasto;mae;castrado;reprodutor;pai;chegada;raca'];
    const pais = MOVEIS(S).filter((id) => !fem(S, id) && S.animais.get(id).brinco).map(b).concat(EXTERNOS(S).map((id) => S.animais.get(id).nome));
    const n = 1 + Math.floor(rnd() * 3);
    const noArquivo = [];
    for (let i = 0; i < n; i++) {
      const sexo = rnd() < 0.5 ? 'F' : 'M';
      const bb = brinco(rnd, S) || String(100 + i);
      const nasc = rnd() < 0.8 ? br(somaDias(S.marco || D0, -100 - Math.floor(rnd() * 2000))) : '';
      const maes = MOVEIS(S).filter((id) => fem(S, id) && S.animais.get(id).brinco).map(b).concat(noArquivo);
      const mae = rnd() < 0.3 ? sorteio(rnd, maes) || '' : '';
      const pai = rnd() < 0.25 ? sorteio(rnd, pais) || '' : '';
      const chegada = nasc && rnd() < 0.25 ? br(somaDias(S.marco || D0, -1 - Math.floor(rnd() * 90))) : '';
      linhas.push([bb, sexo, nasc, pastoNome(), mae, sexo === 'M' ? (rnd() < 0.5 ? 'S' : 'N') : '', sexo === 'M' ? 'N' : '', pai, chegada, rnd() < 0.2 ? 'Nelore' : ''].join(';'));
      if (sexo === 'F') noArquivo.push(bb);
    }
    return { texto: linhas.join('\n'), mapa: { colunas: { brinco: 'brinco', sexo: 'sexo', nascimento: 'data_nascimento', pasto: 'pasto', mae: 'mae', castrado: 'castrado', reprodutor: 'reprodutor', pai: 'pai', chegada: 'data_entrada', raca: 'raca' }, confiancas: { data_nascimento: 'ESTIMADA', mae: 'CONFIRMADA', pai: 'ESTIMADA', data_entrada: 'ESTIMADA' }, padroes: {} } };
  },
});
registrarImportador('TRANSFERENCIAS', {
  arquivo: (c) => {
    const { S, rnd, P, b, pastoNome, data, qual } = c;
    const linhas = ['data;origem;destino;brinco'];
    for (let i = 0; i < 1 + Math.floor(rnd() * 3); i++) {
      const id = qual();
      if (!id) break;
      const d = data();
      const onde = presenca(S, id, d).pasto;
      const origem = onde && rnd() < 0.8 ? P[onde] : pastoNome();
      linhas.push([br(d), origem, sorteio(rnd, Object.values(P).filter((x) => x !== origem)), b(id)].join(';'));
    }
    if (rnd() < 0.1 && linhas.length > 1) linhas.push(linhas[linhas.length - 1]);
    return { texto: linhas.join('\n'), mapa: { colunas: { data: 'data', origem: 'pasto_origem', destino: 'pasto_destino', brinco: 'brinco' }, confiancas: {}, padroes: {} } };
  },
});
registrarImportador('MORTES', {
  arquivo: (c) => {
    const { rnd, b, data, qual } = c;
    const linhas = ['data;causa;brinco'];
    for (let i = 0; i < 1 + Math.floor(rnd() * 2); i++) { const id = qual(); if (id) linhas.push([br(data()), sorteio(rnd, ['doença', 'raio', 'picada de cobra']), b(id)].join(';')); }
    if (rnd() < 0.1 && linhas.length > 1) linhas.push(linhas[linhas.length - 1]);
    return { texto: linhas.join('\n'), mapa: { colunas: { data: 'data', causa: 'causa', brinco: 'brinco' }, confiancas: {}, padroes: {} } };
  },
});
registrarImportador('NASCIMENTOS', {
  arquivo: (c) => {
    const { S, rnd, b, comBrinco, data } = c;
    const linhas = ['data;mae;situacao;sexo;cria;pai'];
    const pais = MOVEIS(S).filter((id) => !fem(S, id) && S.animais.get(id).brinco).map(b).concat(EXTERNOS(S).map((id) => S.animais.get(id).nome));
    const pai = rnd() < 0.3 ? sorteio(rnd, pais) || '' : '';
    const maes = MOVEIS(S).filter((id) => fem(S, id) && S.animais.get(id).brinco);
    const mae = sorteio(rnd, rnd() < 0.9 && maes.length ? maes : comBrinco);
    if (!mae) return null;
    const d = br(data());
    for (let i = 0; i < 1 + (rnd() < 0.3 ? 1 : 0); i++) {
      const vivo = rnd() < 0.85;
      linhas.push([d, b(mae), vivo ? 'vivo' : 'natimorto', vivo ? (rnd() < 0.5 ? 'M' : 'F') : '', vivo ? brinco(rnd, S) || '' : '', pai].join(';'));
    }
    return { texto: linhas.join('\n'), mapa: { colunas: { data: 'data', mae: 'mae', situacao: 'situacao', sexo: 'sexo', cria: 'brinco', pai: 'pai' }, confiancas: { pai: 'ESTIMADA' }, padroes: {} } };
  },
});
registrarImportador('COMPRAS', {
  // Passada 4: mais de uma compra no arquivo, o preço por kg com o peso de cada animal, o frete e as parcelas.
  arquivo: (c) => {
    const { S, rnd, b, comBrinco, pastoNome, data } = c;
    const linhas = ['grupo;data;fornecedor;modalidade;valor;preco;brinco;sexo;pasto;peso;frete;parcelas;vencimento'];
    const grupos = rnd() < 0.3 ? 2 : 1;
    for (let gI = 0; gI < grupos; gI++) {
      const n = 1 + Math.floor(rnd() * 2);
      const kg = rnd() < 0.3;
      const preco = kg ? 900 + Math.floor(rnd() * 600) : sorteio(rnd, [200000, 1, 333333]);
      const pesos = Array.from({ length: n }, () => 150 + Math.floor(rnd() * 4000) / 10);
      const valor = kg ? Math.round(pesos.reduce((a, p) => a + Math.round(p * 10), 0) * preco / 10) : preco * n;
      const dd = data();
      const d = br(dd);
      const frete = rnd() < 0.3 ? reais(sorteio(rnd, [1, 12345, 0])) : '';
      const nParc = rnd() < 0.3 ? String(1 + Math.floor(rnd() * 3)) : '';
      const venc = nParc && rnd() < 0.8 ? br(somaDias(dd, 30)) : '';
      for (let i = 0; i < n; i++) {
        const volta = rnd() < 0.25 && comBrinco.length ? b(sorteio(rnd, comBrinco)) : null;
        const p0 = i === 0;
        linhas.push(['C' + (gI + 1), p0 ? d : '', p0 ? 'Fazenda Vizinha' : '', p0 ? (kg ? 'kg' : 'cabeça') : '', p0 ? reais(valor) : '', p0 ? reais(preco) : '', volta || brinco(rnd, S) || String(200 + 10 * gI + i), rnd() < 0.5 ? 'M' : 'F', pastoNome(), kg || rnd() < 0.2 ? dec(pesos[i]) : '', p0 ? frete : '', p0 ? nParc : '', p0 ? venc : ''].join(';'));
      }
    }
    return { texto: linhas.join('\n'), mapa: { colunas: { grupo: 'grupo', data: 'data', fornecedor: 'fornecedor', modalidade: 'modalidade', valor: 'valor_animais', preco: 'preco', brinco: 'brinco', sexo: 'sexo', pasto: 'pasto', peso: 'peso', frete: 'frete', parcelas: 'parcelas', vencimento: 'vencimento' }, confiancas: {}, padroes: { castrado: false, reprodutor: false } } };
  },
});
registrarImportador('VENDAS', {
  // Passada 4: mais de uma venda no arquivo (às vezes o mesmo animal nas duas) e as parcelas.
  arquivo: (c) => {
    const { rnd, b, ativos, comBrinco, data } = c;
    const linhas = ['grupo;data;comprador;finalidade;modalidade;preco;bruto;brinco;parcelas'];
    const todos = alguns(rnd, ativos.length ? ativos : comBrinco, 4);
    if (!todos.length) return null;
    const grupos = todos.length > 1 && rnd() < 0.3 ? [todos.slice(0, 1), todos.slice(1)] : [todos.slice(0, 2)];
    if (grupos.length > 1 && rnd() < 0.15) grupos[1].push(todos[0]);
    grupos.forEach((ids, gI) => {
      const preco = sorteio(rnd, [250000, 1]);
      const d = br(data());
      const nParc = rnd() < 0.3 ? String(1 + Math.floor(rnd() * 3)) : '';
      ids.forEach((id, i) => linhas.push(['V' + (gI + 1), i === 0 ? d : '', i === 0 ? 'Frigorífico Boi Bom' : '', i === 0 ? sorteio(rnd, ['abate', 'recria e engorda']) : '', i === 0 ? 'cabeça' : '', i === 0 ? reais(preco) : '', i === 0 ? reais(preco * ids.length) : '', b(id), i === 0 ? nParc : ''].join(';')));
    });
    return { texto: linhas.join('\n'), mapa: { colunas: { grupo: 'grupo', data: 'data', comprador: 'comprador', finalidade: 'finalidade', modalidade: 'modalidade', preco: 'preco', bruto: 'valor_bruto', brinco: 'brinco', parcelas: 'parcelas' }, confiancas: {}, padroes: {} } };
  },
});

/**
 * O próximo comando (concreto): {rota, dados, avisos, aceitar, simular, dvVelha, chaveDe, spec, rotulo}. A importação
 * em curso tende a continuar (validar, importar, concluir); às vezes outro comando entra no meio.
 */
function gerar(sis, S, rnd, k) {
  const em = S.t.IMPORTACOES.filter((i) => ['RASCUNHO', 'VALIDADO', 'IMPORTANDO'].indexOf(i.status) >= 0);
  const base = { avisos: rnd() < 0.5 ? AVISOS : [], aceitar: rnd() < 0.9, simular: rnd() < 0.25, semJustAviso: rnd() < 0.08 };
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
  if (sis.snapImp && rnd() < 0.3) {
    const imp = S.t.IMPORTACOES.find((i) => i.import_id === sis.snapImp.import_id);
    if (imp && imp.status === 'IMPORTADO') return Object.assign(base, { rota: 'importacao.desfazer', dados: { import_id: imp.import_id, justificativa: 'Arquivo errado' }, aceitar: true, semJustAviso: false, desfazerImediato: true, rotulo: 'desfazer logo depois de importar' });
  }
  if (sis.snap && sis.snap.dv === sis.versao() && rnd() < 0.18) { const c = gerarAcao(sis, S, rnd, k, rnd() < 0.65 ? 'estornoImediato' : 'correcaoIdentica', base); if (c) return c; }
  const acao = pesado(rnd, [
    ['registrar', 55], ['corrigir', 14], ['estornar', 11], ['editar', 5], ['reuso', 2], ['zeros', 0.6], ['marco', 1],
    ['importar', 4], ['desfazer', 1.5], ['reenvio', 1.5], ['versao', 1.5], ['cadastro', 5], ['outraChave', 1], ['lote', 0.5], ['faixas', 0.3],
    ['estornoImediato', 4], ['anexo', 2.5],
    // Passada 4: os parâmetros que mudam regra e projeção, o período financeiro fechado, a política de avisos e a versão
    // esperada atual (o caminho que deve passar).
    ['parametro', 1.5], ['bloqueio', 2], ['politica', 1.2], ['versaoAtual', 1.5],
  ]);
  return gerarAcao(sis, S, rnd, k, acao, base);
}
/** Um comando da ação escolhida (null quando não há como montar). */
function gerarAcao(sis, S, rnd, k, acao, base) {
  if (acao === 'registrar') {
    // O peso de cada tipo é da entrada dele no registro, na ordem de registro.
    const tipo = pesado(rnd, Array.from(TIPOS, ([nome, T]) => [nome, T.peso(S)]));
    const spec = propor(sis, S, rnd, tipo);
    if (!spec) return null;
    if (S.t.PROPRIEDADES.length > 1 && rnd() < 0.2) spec.prop = sorteio(rnd, S.t.PROPRIEDADES).property_id;
    return Object.assign(base, { rota: 'evento.registrar', dados: montarDados(sis, spec), spec, rotulo: tipo });
  }
  if (acao === 'corrigir' || acao === 'estornar') {
    const evs = S.t.EVENTOS.filter((e) => S.op.get(e.op_id) === 'CONFIRMADA');
    const vig = evs.filter((e) => S.vig.get(e.event_id));
    const recentes = vig.slice(-4);
    let alvo = rnd() < 0.4 && recentes.length ? sorteio(rnd, recentes) : rnd() < 0.9 ? sorteio(rnd, vig) : sorteio(rnd, evs);
    if (acao === 'corrigir') {
      // A correção montada pelas linhas gravadas (o evento importado não tem a especificação do gerador).
      if (rnd() < 0.3) {
        const daLista = (rnd() < 0.9 ? vig : evs).filter((e) => !!(TIPOS.get(e.event_type) || {}).doGravado);
        const semSpec = daLista.filter((e) => !sis.specs.has(e.event_id));
        const alvo2 = sorteio(rnd, semSpec.length && rnd() < 0.7 ? semSpec : daLista);
        const spec0 = alvo2 && specDoGravado(sis, S, rnd, alvo2);
        if (spec0) {
          const spec = rnd() < 0.3 ? spec0 : mutarVarias(sis, S, rnd, spec0);
          const dados = Object.assign(montarDados(sis, spec), { event_id: alvo2.event_id, justificativa: 'Corrigindo o lançamento' });
          return Object.assign(base, { rota: 'evento.corrigir', dados, spec, rotulo: 'corrigir ' + alvo2.event_type + (alvo2.import_id ? ' (importado)' : ' (pelas linhas)') });
        }
      }
      // O substituto de outro tipo ou subtipo (TIPO_DIFERENTE).
      if (rnd() < 0.04) {
        const alvo3 = sorteio(rnd, vig);
        const outro = alvo3 && sorteio(rnd, Array.from(TIPOS.keys()).filter((t) => t !== tipoDoSpec(alvo3)));
        const spec = outro && propor(sis, S, rnd, outro);
        if (!spec) return null;
        const dados = Object.assign(montarDados(sis, spec), { event_id: alvo3.event_id, justificativa: 'Corrigindo o lançamento' });
        return Object.assign(base, { rota: 'evento.corrigir', dados, spec, rotulo: 'corrigir para outro tipo' });
      }
      const comSpec = (rnd() < 0.9 ? vig : evs).filter((e) => sis.specs.has(e.event_id));
      alvo = rnd() < 0.4 ? sorteio(rnd, comSpec.slice(-3)) : sorteio(rnd, comSpec);
      if (!alvo) return null;
      const memo = sis.specs.get(alvo.event_id);
      const spec = rnd() < 0.15 ? js(memo.spec) : mutarVarias(sis, S, rnd, memo.spec);
      const dados = Object.assign(montarDados(sis, spec), { event_id: alvo.event_id, justificativa: 'Corrigindo o lançamento' });
      return Object.assign(base, { rota: 'evento.corrigir', dados, spec, rotulo: 'corrigir ' + alvo.event_type + (alvo.reversal_of_event_id ? ' (substituto)' : '') });
    }
    if (!alvo) return null;
    return Object.assign(base, { rota: 'evento.estornar', dados: { event_id: alvo.event_id, justificativa: 'Lançado errado' }, rotulo: 'estornar ' + alvo.event_type });
  }
  if (acao === 'editar') {
    const id = sorteio(rnd, MOVEIS(S).concat(EXTERNOS(S)));
    if (!id) return null;
    const c = correcaoAleatoria(sis, S, rnd, id);
    const campos = Object.assign({ [c.campo]: c.valor }, c.junto || {});
    // Dois campos na mesma edição (o sexo e o nascimento, a mãe e o pai).
    if (rnd() < 0.25) { const c2 = correcaoAleatoria(sis, S, rnd, id); Object.assign(campos, { [c2.campo]: c2.valor }, c2.junto || {}); }
    if (rnd() < 0.3) campos.nome = sorteio(rnd, ['Mimosa', 'Estrela', 'Valente']);
    return Object.assign(base, { rota: 'animal.editar', dados: Object.assign({ animal_id: id, campos }, rnd() < 0.95 ? { justificativa: 'Conferido na ficha' } : {}), rotulo: 'editar ' + c.campo });
  }
  // Passada 3: o estorno logo depois do registro (nada gravado entre os dois) devolve cada animal que já existia ao que era.
  if (acao === 'estornoImediato') {
    const snap = sis.snap;
    if (!snap || snap.dv !== sis.versao()) return null;
    return Object.assign(base, { rota: 'evento.estornar', dados: { event_id: snap.eid, justificativa: 'Lançado errado' }, aceitar: true, semJustAviso: false, estornoImediato: true, rotulo: 'estorno imediato de ' + snap.tipo });
  }
  // Passada 3: a correção logo depois do registro com a mesma especificação (os mesmos animais criados) não muda nenhum
  // animal: o substituto fica na posição do original.
  if (acao === 'correcaoIdentica') {
    const snap = sis.snap;
    if (!snap || snap.dv !== sis.versao() || !sis.specs.has(snap.eid)) return null;
    const dados = Object.assign(montarDados(sis, js(sis.specs.get(snap.eid).spec)), { event_id: snap.eid, justificativa: 'Conferido de novo' });
    return Object.assign(base, { rota: 'evento.corrigir', dados, aceitar: true, semJustAviso: false, correcaoIdentica: true, rotulo: 'correção idêntica de ' + snap.tipo });
  }
  // Passada 3: anexos (E2.9) no evento, no lançamento e no animal, e a remoção; o evento anexado é depois corrigido,
  // estornado ou desfeito pela importação como qualquer outro.
  if (acao === 'anexo') {
    const B64 = (t) => Buffer.from(t).toString('base64');
    const ativos = S.t.ANEXOS.filter((x) => x.status === 'ATIVO');
    if (ativos.length && rnd() < 0.25) {
      const x = sorteio(rnd, rnd() < 0.9 ? ativos : S.t.ANEXOS);
      return Object.assign(base, { rota: 'anexo.remover', dados: Object.assign({ anexo_id: x.anexo_id }, rnd() < 0.95 ? { justificativa: 'Documento errado' } : {}), rotulo: 'anexo removido' });
    }
    const y = rnd();
    const doc = { tipo: sorteio(rnd, ['DOCUMENTO', 'NOTA_FISCAL', 'GTA']), nome_arquivo: 'doc-' + k + '.pdf', mime_type: 'application/pdf', conteudo_base64: B64('%PDF-1.4 doc ' + k) };
    if (y < 0.55) {
      const evs = S.t.EVENTOS.filter((e) => S.op.get(e.op_id) === 'CONFIRMADA');
      const e = sorteio(rnd, rnd() < 0.85 ? evs.filter((x) => S.vig.get(x.event_id)) : evs);
      if (!e) return null;
      return Object.assign(base, { rota: 'anexo.adicionar', dados: Object.assign({ entidade: 'EVENTOS', entity_id: e.event_id }, doc), rotulo: 'anexo no evento ' + e.event_type });
    }
    if (y < 0.8) {
      const f = sorteio(rnd, S.t.FINANCEIRO);
      if (!f) return null;
      return Object.assign(base, { rota: 'anexo.adicionar', dados: Object.assign({ entidade: 'FINANCEIRO', entity_id: f.financial_id }, doc), rotulo: 'anexo no lançamento' });
    }
    const id = sorteio(rnd, MOVEIS(S));
    if (!id) return null;
    return Object.assign(base, { rota: 'anexo.adicionar', dados: { entidade: 'ANIMAIS', entity_id: id, tipo: 'FOTO', nome_arquivo: 'foto-' + k + '.jpg', mime_type: 'image/jpeg', conteudo_base64: B64('jpeg ' + k), miniatura_base64: B64('mini'), definir_como_foto: rnd() < 0.4 }, rotulo: 'foto do animal' });
  }
  if (acao === 'reuso') return Object.assign(base, { rota: 'config.salvar', dados: { valores: { brinco_permite_reuso: S.reuso ? 'N' : 'S' } }, rotulo: 'reuso' });
  if (acao === 'zeros') return Object.assign(base, { rota: 'config.salvar', dados: { valores: { brinco_ignora_zeros_esquerda: S.config.get('brinco_ignora_zeros_esquerda') === 'S' ? 'N' : 'S' } }, rotulo: 'zeros' });
  if (acao === 'lote') return Object.assign(base, { rota: 'config.salvar', dados: { valores: { importacao_lote_linhas: sorteio(rnd, ['1', '2', '3']) } }, rotulo: 'lote da importação' });
  if (acao === 'faixas') return Object.assign(base, { rota: 'config.salvar', dados: { valores: { faixas_etarias_meses: sorteio(rnd, ['[12,24,36]', '[6,18,30]', '[24,12]']) } }, rotulo: 'faixas etárias' });
  if (acao === 'marco') return Object.assign(base, { rota: 'config.salvar', dados: { valores: { data_marco_zero: sorteio(rnd, [D0, somaDias(D0, -31), somaDias(D0, 14), somaDias(HOJE, 3)]) } }, rotulo: 'marco zero' });
  // Passada 4: parâmetros de regra e de projeção (a idade da desmama refaz a cria ao pé; a gestação, a idade reprodutiva e
  // a tolerância do parto mudam os avisos; a arroba, o rendimento e a tolerância da conferência mudam a conta do negócio;
  // o brinco só de números recusa o brinco com letra).
  if (acao === 'parametro') {
    const [chave, op] = sorteio(rnd, [
      ['idade_desmama_padrao_meses', ['3', '8', '12', '30']], ['idade_min_reprodutiva_meses', ['12', '24', '40']], ['dias_gestacao', ['270', '290', '300']],
      ['parto_tolerancia_dias', ['0', '20', '60']], ['arroba_kg', ['15', '15', '14.5']], ['rendimento_carcaca_padrao_pct', ['50', '52']],
      ['fin_tolerancia_conferencia_pct', ['0', '1', '5']], ['brinco_somente_numerico', ['S', 'N', 'N']],
    ]);
    return Object.assign(base, { rota: 'config.salvar', dados: { valores: { [chave]: sorteio(rnd, op) } }, rotulo: 'parâmetro ' + chave });
  }
  // Passada 4: o período financeiro fechado (RN-082) numa data dos lançamentos gravados, no marco, hoje, ou aberto de novo.
  if (acao === 'bloqueio') {
    const datas = S.t.FINANCEIRO.map((f) => f.data_competencia).filter(Boolean);
    const x = rnd();
    const ate = x < 0.25 ? '' : x < 0.7 && datas.length ? somaDias(sorteio(rnd, datas), sorteio(rnd, [0, 0, 1, -1])) : sorteio(rnd, [S.marco || D0, HOJE, somaDias(HOJE, -60), somaDias(D0, -10)]);
    return Object.assign(base, { rota: 'config.salvar', dados: { valores: { fin_bloqueio_ate: ate } }, rotulo: 'período fechado' + (ate ? '' : ' aberto') });
  }
  // Passada 4: a política de avisos (BLOQUEIA, AVISA, IGNORA) por código, no meio da sequência.
  if (acao === 'politica') {
    const pol = {};
    alguns(rnd, POLITICAVEIS, 4).forEach((c) => { pol[c] = sorteio(rnd, ['BLOQUEIA', 'AVISA', 'IGNORA', 'IGNORA']); });
    if (rnd() < 0.5) pol.CARENCIA_ATIVA = 'BLOQUEIA';
    const texto = '{' + Object.keys(pol).sort().map((c) => JSON.stringify(c) + ':' + JSON.stringify(pol[c])).join(',') + '}';
    return Object.assign(base, { rota: 'config.salvar', dados: { valores: { avisos_politica: rnd() < 0.15 ? '{"CARENCIA_ATIVA":"BLOQUEIA"}' : texto } }, rotulo: 'política de avisos' });
  }
  if (acao === 'versaoAtual') {
    const sub = pesado(rnd, [['registrar', 3], ['corrigir', 1], ['estornar', 1], ['editar', 0.5], ['cadastro', 0.6], ['anexo', 0.3]]);
    const c = gerarAcao(sis, S, rnd, k, sub, base);
    if (!c || /^importacao\./.test(c.rota)) return null;
    return Object.assign(c, { dvAtual: true, rotulo: 'versão atual: ' + (c.rotulo || c.rota) });
  }
  if (acao === 'importar') {
    // Passada 4: o mesmo arquivo enviado de novo, com outra chave (o aviso POSSIVEL_DUPLICIDADE, sob a política).
    const enviados = (sis.aceitos || []).filter((x) => x.cmd.rota === 'importacao.criar');
    if (enviados.length && rnd() < 0.15) {
      const ant = sorteio(rnd, enviados).cmd;
      return Object.assign(base, { rota: 'importacao.criar', dados: Object.assign({}, ant.dados, { arquivo_nome: 'de-novo-' + k + '-' + ant.dados.arquivo_nome }), mapa: ant.mapa, rotulo: 'importar o mesmo arquivo de novo' });
    }
    const tipo = sorteio(rnd, sorteioDeImportacao());
    const arq = arquivoImportacao(sis, S, rnd, tipo);
    if (!arq) return null;
    return Object.assign(base, { rota: 'importacao.criar', dados: { tipo, arquivo_nome: tipo.toLowerCase() + '-' + k + '.csv', texto: arq.texto, formato: FORMATO }, mapa: arq.mapa, rotulo: 'importar ' + tipo });
  }
  if (acao === 'desfazer') {
    const vivas = S.t.IMPORTACOES.filter((i) => i.status !== 'CANCELADO');
    // Passada 3: de preferência a que tem evento corrigido ou estornado (a cadeia de substituição é dela).
    const mexidas = vivas.filter((i) => S.t.EVENTOS.some((e) => e.import_id === i.import_id && S.anuladoPor.has(e.event_id)));
    const imp = sorteio(rnd, mexidas.length && rnd() < 0.6 ? mexidas : vivas);
    if (!imp) return null;
    return Object.assign(base, { rota: 'importacao.desfazer', dados: { import_id: imp.import_id, justificativa: 'Arquivo errado' }, rotulo: 'desfazer ' + imp.status });
  }
  // Passada 3: o reenvio e a mesma chave com outro conteúdo também de um comando antigo (o estado já mudou depois dele).
  const antigo = () => (rnd() < 0.5 || !(sis.aceitos || []).length ? sis.ultimoAceito : sorteio(rnd, sis.aceitos));
  if (acao === 'reenvio') {
    const ult = antigo();
    if (!ult) return null;
    return Object.assign({}, ult.cmd, { chaveDe: ult.k, reenvio: true, simular: false, rotulo: 'reenvio do passo ' + ult.k });
  }
  if (acao === 'versao') {
    // Qualquer comando com a dataVersionEsperada de antes do último gravado.
    const sub = pesado(rnd, [['registrar', 3], ['corrigir', 1], ['estornar', 1], ['editar', 0.5], ['cadastro', 0.8], ['marco', 0.2], ['reuso', 0.2]]);
    const c = gerarAcao(sis, S, rnd, k, sub, base);
    if (!c) return null;
    return Object.assign(c, { dvVelha: true, simular: false, rotulo: 'versão velha: ' + (c.rotulo || c.rota) });
  }
  if (acao === 'cadastro') {
    // Desativar e reativar no meio: o pasto (sobretudo o D, vazio na montagem), o parceiro e a categoria.
    const qual = pesado(rnd, [['pasto', 3], ['parceiro', 1.5], ['categoria', 1.5], ['pastoNovo', 0.8], ['pastoEditar', 0.6], ['parceiroNovo', 0.5], ['parceiroTipos', 0.4], ['categoriaNova', 0.7], ['categoriaEditar', 1.2], ['lista', 1.5], ['externo', 0.6], ['propriedadeNova', 0.5], ['propriedadeStatus', 0.5], ['propriedadePadrao', 0.3], ['produto', 0.8], ['protocolo', 0.5], ['estacao', 0.7], ['estacaoEditar', 0.3]]);
    const extra = gerarCadastro(sis, S, rnd, k, qual, base);
    if (extra !== undefined) return extra;
    if (qual === 'pasto') {
      const p = sorteio(rnd, rnd() < 0.6 ? S.t.PASTOS.filter((x) => x.pasture_id === sis.pastos.D) : S.t.PASTOS);
      const status = p.status === 'ATIVO' ? (rnd() < 0.9 ? 'INATIVO' : 'ATIVO') : 'ATIVO';
      return Object.assign(base, { rota: 'pasto.salvar', dados: { pasture_id: p.pasture_id, campos: { status }, justificativa: 'Pasto em reforma' }, rotulo: 'pasto ' + status });
    }
    if (qual === 'parceiro') {
      const p = sorteio(rnd, S.t.PARCEIROS);
      if (!p) return null;
      const ativo = p.ativo === false;
      return Object.assign(base, { rota: 'parceiro.salvar', dados: { partner_id: p.partner_id, campos: { ativo }, justificativa: 'Parceiro conferido' }, rotulo: 'parceiro ' + (ativo ? 'reativado' : 'desativado') });
    }
    const usadas = Array.from(S.animais.values()).filter((a) => a.categoria_modo === 'MANUAL').map((a) => a.categoria_manual_id);
    const cats = S.t.CATEGORIAS.filter((c) => rnd() < 0.5 || usadas.indexOf(c.category_id) >= 0 || c.ativo === false);
    const c = sorteio(rnd, cats.length ? cats : S.t.CATEGORIAS);
    if (!c) return null;
    const ativo = c.ativo === false;
    return Object.assign(base, { rota: 'categoria.salvar', dados: { category_id: c.category_id, campos: { ativo }, justificativa: 'Categoria revista' }, rotulo: 'categoria ' + (ativo ? 'reativada' : 'desativada') });
  }
  if (acao === 'outraChave') {
    // A mesma chave de um comando gravado com outro conteúdo: IDEMPOTENCY_MISMATCH, nada gravado.
    const ult = antigo();
    if (!ult) return null;
    // O conteúdo muda num campo que o comando leva (a importação monta os dados dela e ignora o resto; as chaves de
    // importarBloco, concluir e desfazer vêm do import_id e do bloco, não do cliente).
    const dados = js(ult.cmd.dados);
    const rota = ult.cmd.rota;
    const outro = 'Outro conteúdo com a mesma chave';
    if (rota === 'evento.registrar' || rota === 'evento.corrigir') dados.campos.notes = outro;
    else if (rota === 'importacao.criar') dados.arquivo_nome = 'outro-' + dados.arquivo_nome;
    else if (rota === 'importacao.validarBloco') dados.mapeamento = Object.assign({}, dados.mapeamento, { confiancas: Object.assign({}, dados.mapeamento.confiancas, { data_nascimento: 'DESCONHECIDA', mae: 'ESTIMADA' }) });
    else if (rota === 'importacao.importarBloco' && dados.bloco === 1) dados.ignorar_linhas = [1];
    else if (rota === 'importacao.importarBloco' || rota === 'importacao.concluir') return null;
    // O anexo leva os metadados e o resumo do arquivo, não a justificativa (FileService.adicionarAnexo): muda a descrição.
    else if (rota === 'anexo.adicionar') dados.descricao = outro;
    else if (rota === 'lista.salvar' || rota === 'animal.cadastrarExterno' || (rota === 'pasto.salvar' && !dados.pasture_id) || (rota === 'parceiro.salvar' && !dados.partner_id)) { if (dados.campos) dados.campos.observacoes = outro; else dados.rotulo = outro; }
    else dados.justificativa = outro;
    return Object.assign({}, ult.cmd, { dados, chaveDe: ult.k, outraChave: true, reenvio: false, simular: false, dvVelha: false, rotulo: 'mesma chave, outro conteúdo' });
  }
  return null;
}

/** Itens de lista que os comandos do gerador usam (desativados e reativados no meio, passada 3). */
const LISTAS_USADAS = [['CAUSA_MORTE', 'DOENCA'], ['CAUSA_MORTE', 'RAIO'], ['MOTIVO_DESCARTE', 'IDADE'], ['DESTINO_DESCARTE', 'CONSUMO_PROPRIO'], ['DESTINO_DESCARTE', 'DOACAO'], ['TIPO_PARTO', 'ASSISTIDO'], ['TIPO_PARTO', 'NORMAL'], ['TIPO_DEDUCAO_VENDA', 'TAXA_FRIGORIFICO'], ['TIPO_DEDUCAO_VENDA', 'FUNRURAL'], ['TIPO_DEDUCAO_VENDA', 'FRETE'], ['MOTIVO_IDENTIFICACAO', 'PERDA'], ['MOTIVO_IDENTIFICACAO', 'DANIFICADO'], ['FINALIDADE_NEGOCIO', 'RECRIA_ENGORDA'], ['RACA', 'NELORE']];
/** Passada 4: os avisos que a política muda (05, seção 1; Config.CODIGOS_AVISO, sem os da Fase 3). */
const POLITICAVEIS = ['POSSIVEL_DUPLICIDADE', 'BRINCO_PARECIDO', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'IDADE_REPRODUTIVA', 'PERIODO_BLOQUEADO', 'VALOR_DIVERGENTE', 'RATEIO_SEM_PESO', 'INTERVALO_PARTO_CURTO', 'CATEGORIAS_SEM_COBERTURA', 'CARENCIA_ATIVA', 'ESTOQUE_INSUFICIENTE', 'PRODUTO_VENCIDO'];
const CONDICOES = ['NENHUMA', 'CASTRADO', 'INTEIRO', 'REPRODUTOR', 'NAO_REPRODUTOR', 'PARIDA', 'NAO_PARIDA'];
/**
 * Passada 3: cadastros criados e editados no meio (não só desativados): pasto novo e com outra área ou capacidade,
 * parceiro novo e com outros tipos, categoria nova e com outro sexo, faixa, condição ou prioridade (também a troca de
 * prioridade de duas numa operação), item de lista desativado, reativado, renomeado ou criado, e o touro de referência
 * novo. undefined = a escolha não é daqui.
 */
function gerarCadastro(sis, S, rnd, k, qual, base) {
  const com = (rota, dados, rotulo) => Object.assign(base, { rota, dados, rotulo });
  // Fase 3, E3.4: a estação de monta criada (às vezes com o nome repetido ou o fim antes do início: a recusa) e editada.
  if (qual === 'estacao') {
    const nomes = (S.t.ESTACOES_MONTA || []).map((e) => e.nome);
    const ini = somaDias(S.marco || D0, Math.floor(rnd() * 330) - 30);
    return com('estacao.salvar', { campos: { nome: rnd() < 0.1 && nomes.length ? sorteio(rnd, nomes) : 'Estação ' + k, data_inicio: ini, data_fim: somaDias(ini, sorteio(rnd, [60, 90, 120, 200, -5])), tipo: sorteio(rnd, ['MONTA_NATURAL', 'IA', 'MISTA']) } }, 'estação nova');
  }
  if (qual === 'estacaoEditar') {
    const e = sorteio(rnd, S.t.ESTACOES_MONTA || []);
    if (!e) return null;
    return com('estacao.salvar', { estacao_id: e.estacao_id, campos: { data_fim: somaDias(e.data_fim, sorteio(rnd, [15, -15, 45])) }, justificativa: 'Datas revistas' }, 'estação editada');
  }
  if (qual === 'pastoNovo') {
    const nomes = S.t.PASTOS.map((p) => p.nome);
    const campos = { property_id: rnd() < 0.5 ? sis.prop : sorteio(rnd, S.t.PROPRIEDADES).property_id, nome: rnd() < 0.1 && nomes.length ? sorteio(rnd, nomes) : 'Pasto N' + k, posse: 'PROPRIO' };
    if (rnd() < 0.6) campos.area_hectares = sorteio(rnd, [1, 3.5, 40]);
    if (rnd() < 0.4) campos.capacidade_estimada_cabecas = sorteio(rnd, [1, 2, 10]);
    return com('pasto.salvar', { campos }, 'pasto novo');
  }
  if (qual === 'pastoEditar') {
    const p = sorteio(rnd, S.t.PASTOS);
    const campos = {};
    if (rnd() < 0.6) campos.area_hectares = sorteio(rnd, [0.5, 5, 30]);
    if (rnd() < 0.6 || !Object.keys(campos).length) campos.capacidade_estimada_cabecas = sorteio(rnd, [1, 3, 50]);
    return com('pasto.salvar', { pasture_id: p.pasture_id, campos, justificativa: 'Área medida de novo' }, 'pasto editado');
  }
  const TIPOS_P = ['FORNECEDOR', 'COMPRADOR', 'TRANSPORTADOR', 'OUTRO'];
  if (qual === 'parceiroNovo') {
    const nomes = S.t.PARCEIROS.map((p) => p.nome);
    return com('parceiro.salvar', { campos: { nome: rnd() < 0.1 && nomes.length ? sorteio(rnd, nomes) : 'Parceiro ' + k, tipos: alguns(rnd, TIPOS_P, 2) } }, 'parceiro novo');
  }
  if (qual === 'parceiroTipos') {
    const p = sorteio(rnd, S.t.PARCEIROS);
    if (!p) return null;
    return com('parceiro.salvar', { partner_id: p.partner_id, campos: { tipos: alguns(rnd, TIPOS_P, 2) }, justificativa: 'Parceiro conferido' }, 'parceiro com outros tipos');
  }
  if (qual === 'categoriaNova') {
    const sexo = sorteio(rnd, ['M', 'F', 'AMBOS']);
    const campos = { nome: 'Categoria ' + k, sexo_aplicavel: sexo, condicao: sorteio(rnd, CONDICOES), prioridade: sorteio(rnd, [5, 15, 25, 10, 100 + k]), ativo: true };
    if (rnd() < 0.5) campos.idade_minima_meses = sorteio(rnd, [0, 6, 18]);
    if (rnd() < 0.5) campos.idade_maxima_meses = sorteio(rnd, [12, 30, 4]);
    return com('categoria.salvar', { campos, justificativa: 'Categoria nova' }, 'categoria nova');
  }
  if (qual === 'categoriaEditar') {
    const usadas = Array.from(S.animais.values()).filter((a) => a.categoria_modo === 'MANUAL').map((a) => a.categoria_manual_id);
    const cats = S.t.CATEGORIAS;
    const c = sorteio(rnd, rnd() < 0.5 && usadas.length ? cats.filter((x) => usadas.indexOf(x.category_id) >= 0) : cats);
    if (!c) return null;
    const x = rnd();
    if (x < 0.2) {
      // Duas prioridades trocadas na mesma operação (não passa por um estado com prioridade repetida).
      const d = sorteio(rnd, cats.filter((y) => y.category_id !== c.category_id));
      if (!d) return null;
      return com('categoria.salvar', { categorias: [{ category_id: c.category_id, campos: { prioridade: d.prioridade } }, { category_id: d.category_id, campos: { prioridade: c.prioridade } }], justificativa: 'Ordem revista' }, 'categorias trocadas');
    }
    const campos = {};
    if (x < 0.45) campos.sexo_aplicavel = sorteio(rnd, ['M', 'F', 'AMBOS'].filter((v) => v !== c.sexo_aplicavel));
    else if (x < 0.65) { campos.idade_minima_meses = sorteio(rnd, [0, 3, 12]); campos.idade_maxima_meses = sorteio(rnd, [10, 20, 48]); }
    else if (x < 0.8) campos.condicao = sorteio(rnd, CONDICOES.filter((v) => v !== c.condicao));
    else if (x < 0.9) campos.prioridade = sorteio(rnd, [1, 35, 200 + k]);
    else campos.nome = c.nome + ' (revista)';
    return com('categoria.salvar', { category_id: c.category_id, campos, justificativa: 'Categoria revista' }, 'categoria editada');
  }
  if (qual === 'lista') {
    const usados = S.t.LISTAS.filter((x) => LISTAS_USADAS.some((u) => u[0] === x.lista && u[1] === x.codigo));
    const x = rnd();
    if (x < 0.12) return com('lista.salvar', { lista: sorteio(rnd, ['CAUSA_MORTE', 'MOTIVO_DESCARTE', 'RACA']), rotulo: sorteio(rnd, ['Brucelose', 'Raio', 'Outra causa ' + k]) }, 'item de lista novo');
    const it = sorteio(rnd, usados.length && rnd() < 0.85 ? usados : S.t.LISTAS);
    if (!it) return null;
    if (x < 0.2) return com('lista.salvar', { lista_id: it.lista_id, rotulo: it.rotulo + ' (revisto)', justificativa: 'Nome revisto' }, 'item de lista renomeado');
    return com('lista.salvar', { lista_id: it.lista_id, ativo: it.ativo === false, justificativa: 'Lista revista' }, 'item de lista ' + (it.ativo === false ? 'reativado' : 'desativado'));
  }
  // Outra propriedade (os pastos novos vão para ela; 00, seção 9: a estrutura de várias propriedades), desativada e
  // reativada, e a propriedade padrão trocada.
  if (qual === 'propriedadeNova') return com('propriedade.salvar', { campos: { nome: 'Fazenda ' + k, area_total_ha: sorteio(rnd, [50, 300]) } }, 'propriedade nova');
  if (qual === 'propriedadeStatus') {
    const p = sorteio(rnd, S.t.PROPRIEDADES);
    const status = p.status === 'ATIVO' ? 'INATIVO' : 'ATIVO';
    return com('propriedade.salvar', { property_id: p.property_id, campos: { status }, justificativa: 'Propriedade revista' }, 'propriedade ' + status);
  }
  if (qual === 'propriedadePadrao') return com('config.salvar', { valores: { propriedade_padrao_id: sorteio(rnd, S.t.PROPRIEDADES).property_id } }, 'propriedade padrão');
  // Fase 3 (E3.2): o produto do cadastro ligando e desligando o controle de estoque (o saldo é projeção), com outro custo
  // (o consumo seguinte usa o novo; o gravado fica congelado), desativado e reativado; a unidade trocada (recusada depois
  // do uso). O protocolo com outro intervalo, desativado e reativado.
  if (qual === 'produto') {
    const p = sorteio(rnd, S.t.PRODUTOS);
    if (!p) return null;
    const x = rnd();
    const campos = x < 0.4 ? { controla_estoque: p.controla_estoque !== true } : x < 0.65 ? { custo_unitario: sorteio(rnd, [0, 0.035, 1.85, 2.5]) } : x < 0.85 ? { ativo: p.ativo === false } : { unidade: p.unidade === 'mL' ? 'dose' : 'mL' };
    return com('produto.salvar', { product_id: p.product_id, campos, justificativa: 'Cadastro do produto revisto' }, 'produto ' + Object.keys(campos)[0]);
  }
  if (qual === 'protocolo') {
    const p = sorteio(rnd, S.t.PROTOCOLOS_SANITARIOS);
    if (!p) return null;
    const campos = rnd() < 0.5 ? { intervalo_dias: sorteio(rnd, [90, 180, 365]) } : { ativo: p.ativo === false };
    return com('protocolo.salvar', { protocol_id: p.protocol_id, campos, justificativa: 'Protocolo revisto' }, 'protocolo ' + Object.keys(campos)[0]);
  }
  if (qual === 'externo') {
    const campos = { nome: sorteio(rnd, ['Touro do sêmen', 'Touro Nelore Elite', 'Reprodutor do vizinho ' + k]), sexo: rnd() < 0.9 ? 'M' : 'F' };
    if (rnd() < 0.5) { campos.data_nascimento = somaDias(D0, -400 - Math.floor(rnd() * 3000)); campos.data_nascimento_confianca = 'ESTIMADA'; }
    return com('animal.cadastrarExterno', { campos }, 'touro de referência novo');
  }
  return undefined;
}

/** A especificação de um evento gravado, pelas linhas dele (a entrada do registro do tipo monta); null quando não há como. */
function specDoGravado(sis, S, rnd, e) {
  const T = TIPOS.get(e.event_type);
  if (!T || !T.doGravado) return null;
  const ls = S.t.EVENTO_ANIMAIS.filter((l) => l.event_id === e.event_id);
  if (!ls.length) return null;
  const idents = S.t.IDENTIFICACOES.filter((y) => y.event_id === e.event_id);
  const brincoDe = (id) => (idents.find((y) => y.animal_id === id && y.tipo === 'BRINCO') || {}).codigo || null;
  const ids = ls.map((l) => l.animal_id).filter((id, i, a) => a.indexOf(id) === i);
  return T.doGravado({ sis, S, rnd, ls, idents, brincoDe, data: e.event_date, ids }, e) || null;
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
  if (cmd.dvAtual) extra.dataVersionEsperada = dv0;
  let pedidos = [];
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
    pedidos = Array.from(new Set((r.error.details || []).map((d) => d.codigo)));
    falhas.push(...oraculoPolitica(A, pedidos));
    if (cmd.aceitar) {
      conferida = false;
      const codigos = pedidos;
      // Passada 4: às vezes sem a justificativa do período fechado (a recusa CAMPO_OBRIGATORIO é o esperado).
      const dados = codigos.indexOf('PERIODO_BLOQUEADO') >= 0 && !semJustificativa(cmd) ? Object.assign({}, cmd.dados, { justificativa_aviso: 'Conferido com o pecuarista' }) : cmd.dados;
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
    if (cmd.outraChave && r.error.code !== 'IDEMPOTENCY_MISMATCH') falhas.push(falha('REENVIO', 'a mesma chave com outro conteúdo foi recusada com ' + r.error.code + ', não IDEMPOTENCY_MISMATCH: ' + r.error.message));
    if (cmd.dvAtual && r.error.code === 'CONFLICT' && /mudaram desde que/.test(r.error.message)) falhas.push(falha('VERSAO:ATUAL', 'com a dataVersionEsperada atual (' + dv0 + '), o comando foi recusado como se os dados tivessem mudado'));
  } else {
    if (cmd.dvVelha) falhas.push(falha('VERSAO', 'aceito com dataVersionEsperada velha'));
    if (cmd.outraChave) falhas.push(falha('REENVIO', 'a mesma chave com outro conteúdo foi aceita' + (r.meta && r.meta.duplicado ? ' como duplicada' : '')));
    else if (cmd.reenvio) {
      if (!r.meta.duplicado) falhas.push(falha('REENVIO', 'o reenvio com a mesma chave não foi tratado como duplicado'));
      if (dv1 !== dv0 || JSON.stringify(contagens(depoisT)) !== JSON.stringify(contagens(antesT))) falhas.push(falha('REENVIO', 'o reenvio duplicado gravou'));
    } else if (r.meta && r.meta.duplicado) falhas.push(falha('REENVIO', 'comando novo tratado como duplicado'));
    else if (!r.meta || !r.meta.semAlteracao) {
      falhas.push(...oraculoEfeito(sis, cmd, r.data, A, S));
      falhas.push(...oraculoPeriodo(cmd, A, S, pedidos));
      falhas.push(...oraculoPoliticaGravada(A, S));
    }
  }
  if (cmd.estornoImediato) falhas.push(...oraculoEstornoImediato(sis, cmd, r, S, dv0));
  if (cmd.correcaoIdentica) falhas.push(...oraculoCorrecaoIdentica(sis, cmd, r, S, dv0));
  if (cmd.desfazerImediato) falhas.push(...oraculoDesfazerImediato(sis, cmd, r, S));
  // O retrato de antes do primeiro bloco de uma importação vale enquanto só os comandos dela forem gravados.
  const gravou = r.ok && !(r.meta && (r.meta.duplicado || r.meta.semAlteracao)) && dv1 !== dv0;
  if (gravou && sis.snapImp && (cmd.dados || {}).import_id !== sis.snapImp.import_id) sis.snapImp = null;
  if (gravou && cmd.rota === 'importacao.importarBloco' && cmd.dados.bloco === 1) sis.snapImp = { import_id: cmd.dados.import_id, animais: antesT.ANIMAIS };
  if (sis.snapImp && cmd.rota === 'importacao.desfazer' && cmd.dados.import_id === sis.snapImp.import_id && r.ok) sis.snapImp = null;
  if (r.ok && cmd.rota === 'evento.registrar' && !cmd.reenvio && !(r.meta && r.meta.duplicado) && r.data && r.data.event_id) sis.snap = { eid: r.data.event_id, dv: dv1, tipo: cmd.dados.tipo + (cmd.dados.subtipo ? '/' + cmd.dados.subtipo : ''), animais: antesT.ANIMAIS, depois: depoisT.ANIMAIS };
  // A simulação é consulta: corre com a importação em curso, que só recusa o comando (desenho-base 16.8).
  if (sim && !(r.ok === false && r.error.code === 'CONFLICT' && A.emCurso.length)) {
    // Sem a justificativa do período fechado, de propósito (passada 4), a recusa vem da segunda chamada; a simulação
    // responde pela primeira, que pediu a confirmação.
    const real = r.ok ? 'OK' : pedidos.indexOf('PERIODO_BLOQUEADO') >= 0 && semJustificativa(cmd) && r.error.code === 'VALIDATION' ? 'NEEDS_CONFIRMATION' : r.error.code;
    const simulado = sim.ok ? (sim.data.avisos && sim.data.avisos.length && !(cmd.avisos || []).length ? 'AVISOS' : 'OK') : sim.error.code;
    // O comando pede a confirmação dos avisos antes da trava; a simulação, que não confirma nada, vai até o fim e pode dar a
    // recusa que o comando daria depois de confirmado (passada 4: o estorno no período fechado de um animal que voltaria a
    // um pasto desativado). Sem o pedido de volta (aceitar = false), o desfecho depois da confirmação não é visto.
    const depoisDaConfirmacao = real === 'NEEDS_CONFIRMATION' && !cmd.aceitar && (simulado === 'VALIDATION' || simulado === 'CONFLICT');
    const compativel = simulado === real || depoisDaConfirmacao || (simulado === 'AVISOS' && (real === 'NEEDS_CONFIRMATION' || real === 'OK')) || (simulado === 'OK' && real === 'NEEDS_CONFIRMATION') || real === 'IDEMPOTENCY_MISMATCH';
    if (!compativel) falhas.push(falha('SIMULACAO', 'simulação ' + simulado + ' ' + JSON.stringify(sim.error || '').slice(0, 400) + ' × comando ' + real + ' ' + JSON.stringify(r.error || '').slice(0, 400)));
  }
  const datas = [];
  const d = cmd.dados || {};
  if (d.campos && d.campos.event_date) datas.push(d.campos.event_date, somaDias(d.campos.event_date, -1));
  if (!o.semGlobal) falhas.push(...oraculoGlobal(sis, S, datas));
  return { falhas, r, depoisT, S };
}

/** Passada 4: a política de avisos em vigor antes do comando ({código: BLOQUEIA|AVISA|IGNORA}). */
function politicaDe(S) {
  const t = S.config.get('avisos_politica');
  if (!t) return { CARENCIA_ATIVA: 'BLOQUEIA' };
  try { return JSON.parse(t); } catch (e) { return {}; }
}
const semJustificativa = (cmd) => !!cmd.semJustAviso && /^(evento\.(registrar|corrigir|estornar)|animal\.editar|importacao\.(importarBloco|desfazer))$/.test(cmd.rota);
/**
 * Passada 4: a política de avisos vale em todo caminho. Um aviso pedido (NEEDS_CONFIRMATION) tem a política AVISA: o de
 * IGNORA some, o de BLOQUEIA vira erro. A carência fica fora (a política dela vale só na venda para abate; 05, seção 4.8).
 */
function oraculoPolitica(A, pedidos) {
  const pol = politicaDe(A);
  return pedidos.filter((c) => c !== 'CARENCIA_ATIVA' && pol[c] && pol[c] !== 'AVISA').map((c) => falha('POLITICA:' + c, 'o comando pediu confirmação do aviso ' + c + ', que a política manda ' + (pol[c] === 'IGNORA' ? 'ignorar' : 'bloquear')));
}
/** O aviso aceito gravado no lançamento (EVENTOS.payload_json) também segue a política em vigor. */
function oraculoPoliticaGravada(A, S) {
  const pol = politicaDe(A);
  const out = [];
  S.t.EVENTOS.forEach((e) => {
    if (A.ev.has(e.event_id)) return;
    const p = typeof e.payload_json === 'string' ? (() => { try { return JSON.parse(e.payload_json); } catch (x) { return null; } })() : e.payload_json;
    ((p && p.avisos_aceitos) || []).forEach((a) => {
      if (a.codigo !== 'CARENCIA_ATIVA' && pol[a.codigo] && pol[a.codigo] !== 'AVISA') out.push(falha('POLITICA:GRAVADO', e.event_type + ' gravado com o aviso ' + a.codigo + ' aceito, que a política manda ' + pol[a.codigo]));
    });
  });
  return out;
}
/**
 * Passada 4: o período financeiro fechado (RN-082; desenho-base, seção 11.3) vale em todo caminho. O comando aceito que
 * cria lançamento (o do bloco importado ainda sem status) ou cancela um que valia, com competência até `fin_bloqueio_ate`, passou pela confirmação do
 * aviso PERIODO_BLOQUEADO (política AVISA) ou foi recusado (BLOQUEIA); com IGNORA, nada. E o aviso só é pedido quando o
 * comando mexe num lançamento do período.
 */
function oraculoPeriodo(cmd, A, S, pedidos) {
  const ate = A.config.get('fin_bloqueio_ate') || null;
  const pol = politicaDe(A).PERIODO_BLOQUEADO || 'AVISA';
  const antes = new Map(A.t.FINANCEIRO.map((f) => [f.financial_id, f]));
  const mexidos = [];
  S.t.FINANCEIRO.forEach((f) => {
    const a = antes.get(f.financial_id);
    // O lançamento do bloco importado nasce sem status (vale na conclusão), mas é criado ali: o aviso é pedido no bloco.
    const criou = !a && f.status !== 'CANCELADO';
    const cancelou = a && a.status === 'ATIVO' && f.status !== 'ATIVO';
    if ((criou || cancelou) && ate && f.data_competencia && f.data_competencia <= ate) mexidos.push((criou ? 'criou ' : 'cancelou ') + (f.descricao || f.natureza) + ' de ' + f.data_competencia);
  });
  const pediu = pedidos.indexOf('PERIODO_BLOQUEADO') >= 0;
  const out = [];
  if (mexidos.length && pol === 'BLOQUEIA') out.push(falha('PERIODO:BLOQUEIA', cmd.rota + ' aceito com a política BLOQUEIA no período fechado até ' + ate + ': ' + mexidos.slice(0, 3).join('; ')));
  if (mexidos.length && pol === 'AVISA' && !pediu) out.push(falha('PERIODO:SEM_AVISO', cmd.rota + ' mexeu no período fechado até ' + ate + ' sem pedir a confirmação PERIODO_BLOQUEADO: ' + mexidos.slice(0, 3).join('; ')));
  if (mexidos.length && pol === 'AVISA' && pediu && semJustificativa(cmd)) out.push(falha('PERIODO:SEM_JUSTIFICATIVA', cmd.rota + ' aceito no período fechado sem a justificativa do aviso'));
  if (!mexidos.length && pediu) out.push(falha('PERIODO:AVISO_A_TOA', cmd.rota + ' pediu a confirmação PERIODO_BLOQUEADO (até ' + ate + ') sem criar nem cancelar lançamento do período'));
  return out;
}

/**
 * Estorno logo depois do registro, sem nada gravado entre os dois (passada 3): aceito, e cada animal que existia antes do
 * registro volta a cada campo de projeção que tinha (situação, pasto, propriedade, brinco, sexo, nascimento, mãe, pai,
 * categoria, marcações, cria ao pé, chegada, saída, custo, peso). Os que o registro criou ficam anulados.
 */
const PROJETADOS = ['brinco', 'brinco_norm', 'sexo', 'data_nascimento', 'data_nascimento_confianca', 'mae_id', 'mae_confianca', 'pai_id', 'pai_confianca', 'origem', 'evento_origem_id', 'castrado', 'reprodutor', 'partos_previos', 'propriedade_atual_id', 'pasto_atual_id', 'categoria_modo', 'categoria_manual_id', 'situacao_reprodutiva', 'cria_ao_pe', 'marcado_descarte', 'nao_localizado', 'situacao_cadastral', 'data_entrada', 'data_entrada_confianca', 'data_saida', 'peso_atual', 'data_ultima_pesagem', 'data_ultimo_movimento', 'custo_aquisicao', 'custo_aquisicao_origem'];
function oraculoEstornoImediato(sis, cmd, r, S, dv0) {
  const snap = sis.snap;
  if (!snap || snap.eid !== cmd.dados.event_id || snap.dv !== dv0) return [];
  if (!r.ok) return [falha('ESTORNO_IMEDIATO:RECUSADO', 'o estorno logo depois do registro (' + snap.tipo + ') foi recusado: ' + r.error.code + ' ' + r.error.message + ' ' + JSON.stringify((r.error.details || []).map((d) => d.codigo + ': ' + d.mensagem)).slice(0, 600))];
  const out = [];
  const antes = new Map(snap.animais.map((a) => [a.animal_id, a]));
  S.animais.forEach((a, id) => {
    const b = antes.get(id);
    if (!b) { if (a.situacao_cadastral !== 'ANULADO') out.push(falha('ESTORNO_IMEDIATO:CRIADO', a.codigo_interno + ', criado pelo registro estornado (' + snap.tipo + '), está ' + a.situacao_cadastral)); return; }
    const dif = PROJETADOS.filter((c) => norm(a[c]) !== norm(b[c]));
    if (dif.length) out.push(falha('ESTORNO_IMEDIATO:' + dif[0], a.codigo_interno + ' não voltou ao que era antes do registro estornado (' + snap.tipo + '): ' + dif.map((c) => c + ' ' + JSON.stringify(b[c]) + ' → ' + JSON.stringify(a[c])).join('; ')));
  });
  return out;
}

/**
 * Desfazer a importação logo depois de importá-la (passada 3), sem nenhum outro comando gravado desde o primeiro bloco:
 * aceito, cada animal que já existia volta ao que era e os que ela criou ficam anulados (02, seção 5.1).
 */
function oraculoDesfazerImediato(sis, cmd, r, S) {
  const snap = sis.snapImp;
  if (!snap || snap.import_id !== cmd.dados.import_id) return [];
  if (!r.ok) return [falha('DESFAZER_IMEDIATO:RECUSADO', 'desfazer a importação logo depois de importá-la foi recusado: ' + r.error.code + ' ' + r.error.message + ' ' + JSON.stringify((r.error.details || []).map((d) => d.codigo + ': ' + d.mensagem)).slice(0, 600))];
  const out = [];
  const antes = new Map(snap.animais.map((a) => [a.animal_id, a]));
  S.animais.forEach((a, id) => {
    const b = antes.get(id);
    if (!b) { if (a.situacao_cadastral !== 'ANULADO') out.push(falha('DESFAZER_IMEDIATO:CRIADO', a.codigo_interno + ', criado pela importação desfeita, está ' + a.situacao_cadastral)); return; }
    const dif = PROJETADOS.filter((c) => norm(a[c]) !== norm(b[c]));
    if (dif.length) out.push(falha('DESFAZER_IMEDIATO:' + dif[0], a.codigo_interno + ' não voltou ao que era antes da importação desfeita: ' + dif.map((c) => c + ' ' + JSON.stringify(b[c]) + ' → ' + JSON.stringify(a[c])).join('; ')));
  });
  return out;
}
function oraculoCorrecaoIdentica(sis, cmd, r, S, dv0) {
  const snap = sis.snap;
  if (!snap || snap.eid !== cmd.dados.event_id || snap.dv !== dv0 || (r.ok && r.meta && r.meta.semAlteracao)) return [];
  // O mesmo pedido, sobre o mesmo estado (só o original no lugar dele), não tem por que ser recusado.
  if (!r.ok) return [falha('CORRECAO_IDENTICA:RECUSADA', 'a correção logo depois do registro, com a mesma especificação (' + snap.tipo + '), foi recusada: ' + r.error.code + ' ' + r.error.message + ' ' + JSON.stringify((r.error.details || []).map((d) => d.codigo + ': ' + d.mensagem)).slice(0, 600))];
  const out = [];
  const depois = new Map(snap.depois.map((a) => [a.animal_id, a]));
  S.animais.forEach((a, id) => {
    const b = depois.get(id);
    if (!b) { out.push(falha('CORRECAO_IDENTICA:CRIADO', 'a correção idêntica (' + snap.tipo + ') criou ' + a.codigo_interno + ' em vez de reaproveitar o animal')); return; }
    const dif = PROJETADOS.filter((c) => (c === 'evento_origem_id' ? (b[c] === snap.eid ? a[c] !== r.data.event_id : norm(a[c]) !== norm(b[c])) : norm(a[c]) !== norm(b[c])));
    if (dif.length) out.push(falha('CORRECAO_IDENTICA:' + dif[0], a.codigo_interno + ' mudou com a correção idêntica (' + snap.tipo + '): ' + dif.map((c) => c + ' ' + JSON.stringify(b[c]) + ' → ' + JSON.stringify(a[c])).join('; ')));
  });
  return out;
}

/** Atualiza a memória do gerador depois de um passo aceito (especificação do lançamento, importação, último aceito). */
function memorizar(sis, k, cmd, r, A, S) {
  // "Valide de novo": a confirmação recusou porque o resultado da validação mudou.
  if (r && !r.ok && cmd.rota === 'importacao.importarBloco' && r.error.code === 'CONFLICT' && sis.imps.has(cmd.dados.import_id)) sis.imps.get(cmd.dados.import_id).revalidar = true;
  if (!r || !r.ok) return;
  // Sem alteração não há operação nem chave gravada: o reenvio dele seria um comando novo.
  if (!cmd.reenvio && !(r.meta && r.meta.semAlteracao)) { sis.ultimoAceito = { k, cmd }; (sis.aceitos = sis.aceitos || []).push({ k, cmd }); }
  if (r.data && Array.isArray(r.data.animais)) sis.foco = r.data.animais.map((a) => a.animal_id).concat(sis.foco || []).slice(0, 4);
  if (cmd.rota === 'importacao.criar') sis.imps.set(r.data.import_id, { mapa: cmd.mapa, validado: 0 });
  if (cmd.rota === 'importacao.validarBloco') { const m = sis.imps.get(cmd.dados.import_id); if (m) { m.validado = cmd.dados.bloco; m.revalidar = false; } }
  // O reenvio (duplicado) não cria nada: refazer a especificação por ele apagaria os animais que o original criou
  // (passada 3: a correção seguinte criava animais novos em vez de reaproveitar os do lançamento).
  if (cmd.spec && !cmd.reenvio && !(r.meta && r.meta.duplicado) && r.data && r.data.event_id && /^evento\.(registrar|corrigir)$/.test(cmd.rota)) {
    // Os animais que o lançamento criou vão com o mesmo animal_id na correção: o item novo recebe o animal criado, na
    // ordem do código interno (a ordem de criação, que é a dos itens).
    const eid = r.data.event_id;
    const ls = S.t.EVENTO_ANIMAIS.filter((l) => l.event_id === eid);
    const novos = ls.map((l) => l.animal_id).filter((id, i, a) => a.indexOf(id) === i && !A.animais.has(id)).sort((a, b) => cmp((S.animais.get(a) || {}).codigo_interno || '', (S.animais.get(b) || {}).codigo_interno || ''));
    const spec = js(cmd.spec);
    let n = 0;
    const T = TIPOS.get(spec.tipo);
    if (T && T.criados) T.criados(spec, () => novos[n++] || null);
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
  const stats = { aceitos: 0, recusados: 0, porRotulo: {}, porEvento: {} };
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
    if (ex.r && ex.r.ok) { stats.aceitos++; stats.porRotulo[rot].ok++; contarEvento(stats, cmd, ex.r); } else if (ex.r) {
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
/** Registro ou correção aceitos (sem o reenvio duplicado), por tipo do registro e subtipo: a cobertura de cada entrada. */
function contarEvento(stats, cmd, r) {
  if (!/^evento\.(registrar|corrigir)$/.test(cmd.rota) || (r.meta && (r.meta.duplicado || r.meta.semAlteracao))) return;
  const d = cmd.dados || {};
  const k = chaveDosDados(d) + (d.subtipo && d.tipo !== 'AJUSTE_INVENTARIO' ? '/' + d.subtipo : '');
  stats.porEvento[k] = (stats.porEvento[k] || 0) + 1;
}
function gravavel(sis, cmd) {
  const o = { rota: cmd.rota, dados: simbolizar(sis, cmd.dados), avisos: cmd.avisos, aceitar: cmd.aceitar };
  if (cmd.simular) o.simular = true;
  if (cmd.dvVelha) o.dvVelha = true;
  if (cmd.dvAtual) o.dvAtual = true;
  if (cmd.semJustAviso) o.semJustAviso = true;
  if (cmd.estornoImediato) o.estornoImediato = true;
  if (cmd.correcaoIdentica) o.correcaoIdentica = true;
  if (cmd.desfazerImediato) o.desfazerImediato = true;
  if (cmd.chaveDe !== undefined) { o.chaveDe = cmd.chaveDe; if (cmd.outraChave) o.outraChave = true; else o.reenvio = true; }
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
  const feitos = new Set();
  for (const c of comandos) {
    const faltou = [];
    const dados = resolver(sis, c.dados, faltou);
    if (faltou.length) continue;
    // O reenvio (com o mesmo conteúdo ou outro) sem o comando que gravou a chave seria um comando novo: fica fora.
    if (c.chaveDe !== undefined && !feitos.has(c.chaveDe)) continue;
    feitos.add(c.k);
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

module.exports = {
  D0, HOJE, AVISOS, aleatorio, montar, tabelas, estado, presenca, oraculoGlobal, oraculoEfeito, oraculoRecusa, gerar, executar, rodar, reproduzir, encolher, relatorio, opcoesDaSemente,
  TIPOS, IMPORTADORES, registrarTipo, registrarImportador, chaveDosDados,
};
