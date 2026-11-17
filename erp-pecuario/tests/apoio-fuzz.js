'use strict';
/**
 * Motor do teste aleatório de todos os comandos das Fases 1 a 3 (tests/fase2.fuzz.test.js, fase2.fuzz.regressoes.test.js
 * e fase3.fuzz.regressoes.test.js). Não é arquivo de teste.
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
/** O dia (yyyy-MM-dd) de um instante ISO no fuso da fazenda do harness (America/Porto_Velho, UTC−4, sem horário de verão). */
const diaNoFuso = (ts) => new Date(Date.parse(ts) - 4 * 3600000).toISOString().slice(0, 10);
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
  const sis = { gas, G, o, n: 0, sim: new Map(), uuid: new Map(), specs: new Map(), imps: new Map(), passosFeitos: 0, chavesGravadas: new Map() };
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
  // Revisão da Fase 3 (achado 4): as contas em que o consumo de insumo cai; o serviço pago no ato nelas, com o produto do
  // cadastro com custo, entraria em dobro no resultado (a recusa CUSTO_EM_DOBRO).
  sis.contasInsumo = new Set(t.PLANO_CONTAS.filter((c) => ['VACINAS', 'MEDICAMENTOS', 'ALIMENTACAO', 'TRATAMENTOS'].indexOf(c.codigo) >= 0).map((c) => c.conta_id));
  sis.contaVacinas = t.PLANO_CONTAS.find((c) => c.codigo === 'VACINAS').conta_id;
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
  // Fuzz das Fases 1 a 3, passada 2: a vermifugação de campanha (maio e agosto), cadastrada no marco zero (o relógio no
  // passado só para este pedido): a campanha perdida continua devida até abrir a janela da seguinte, e o modelo da agenda
  // confere as duas situações em toda semente.
  const hoje = gas.clock.now;
  gas.clock.now = Date.parse(D0 + 'T14:00:00Z');
  try { sis.campanha = ok('protocolo.salvar', { campos: { nome: 'Vermífugo F de campanha', tipo_procedimento: 'VERMIFUGO', product_id: sis.produtos.vermifugo, sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'CAMPANHA_MESES', meses_campanha: [5, 8] } }).protocol_id; } finally { gas.clock.now = hoje; }
  // Nomes estáveis do que a montagem cria, para a sequência gravada ficar legível e repetível.
  const nomear0 = (id, nome) => { sis.sim.set(id, nome); sis.uuid.set(nome, id); };
  Object.keys(sis.pastos).forEach((k) => nomear0(sis.pastos[k], '@p:' + k));
  Object.keys(sis.parceiros).forEach((k) => nomear0(sis.parceiros[k], '@f:' + k));
  nomear0(sis.externo, '@x');
  nomear0(sis.prop, '@r:base');
  nomear0(sis.custeio, '@conta');
  Object.keys(sis.produtos).forEach((k) => nomear0(sis.produtos[k], '@v:' + k));
  nomear0(sis.protocolo, '@q:vacina');
  nomear0(sis.campanha, '@q:campanha');
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
  // Revisão da Fase 3 (achado 4): CUSTO_EM_DOBRO só com o produto do cadastro e o pago no ato numa conta de insumo.
  if ((e.details || []).some((d) => d && d.codigo === 'CUSTO_EM_DOBRO')) {
    const cp = (cmd.dados && cmd.dados.campos) || {};
    if (!cp.produto_id || !sis.contasInsumo.has(cp.custo_conta_id)) out.push(falha('RECUSA:CUSTO_EM_DOBRO', 'custo em dobro acusado sem o produto do cadastro ou fora de conta de insumo: ' + JSON.stringify(cp).slice(0, 600)));
    else contar('pago no ato em conta de insumo com consumo: recusado');
  }
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
  // Fuzz das Fases 1 a 3, passada 2: a cria ao pé (03a, 4.3.3; DL-06), pelas linhas cruas: a fêmea tem cria ao pé quando um
  // filho dela (mae_id) está no rebanho, sem desmama vigente, e nasceu na fazenda ou entrou mais novo que a idade de desmama
  // (meses completos na data do lançamento que o criou). Pega o projetor que esquece a mãe (a venda da cria, a desmama, a
  // mãe trocada, o parto estornado) por qualquer caminho.
  const desmamaMeses = paramNum(S, 'idade_desmama_padrao_meses', 8);
  const desmamados = new Set(S.t.EVENTO_ANIMAIS.filter((l) => l.papel === 'SUJEITO' && S.vig.get(l.event_id) && (S.ev.get(l.event_id) || {}).event_type === 'DESMAMA').map((l) => l.animal_id));
  const comCria = new Set();
  S.animais.forEach((c, id) => {
    if (!c.mae_id || c.situacao_cadastral !== 'ATIVO' || desmamados.has(id)) return;
    const origem = S.ev.get(c.evento_origem_id);
    if (!origem) return;
    if (origem.event_type === 'NASCIMENTO' || (c.data_nascimento && mesesDe(c.data_nascimento, origem.event_date) < desmamaMeses)) comCria.add(c.mae_id);
  });
  contar('cria ao pé conferida', comCria.size);
  S.animais.forEach((a, id) => {
    if (a.sexo !== 'F' || ['EXTERNO', 'ANULADO', 'PENDENTE'].indexOf(a.situacao_cadastral) >= 0) return;
    if ((a.cria_ao_pe === true) !== comCria.has(id)) out.push(falha('REPLAY:CRIA_AO_PE', a.codigo_interno + ' (' + a.situacao_cadastral + '): cria ao pé gravada ' + a.cria_ao_pe + ', replay ' + comCria.has(id)));
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
    // E3.6: o importador de manejo confere o fato de cada linha importada (o registro que a linha diz ter gerado).
    const I = IMPORTADORES.get(i.tipo);
    if (cmd.rota === 'importacao.concluir' && I && I.efeito) {
      (S.t.IMPORTACAO_LINHAS || []).filter((l) => l.import_id === id && l.status === 'IMPORTADA').forEach((l) => I.efeito({ S, i, l, v: l.dados_originais_json || {}, erro: (m) => erro('linha ' + l.linha_num + ': ' + m) }));
    }
    // Conserto pela garantia, etapa 2: a linha importada foi para o animal que o resolvedor único acha pelo mesmo texto e data.
    if (cmd.rota === 'importacao.concluir') oraculoResolucaoImportacao(sis, S, i, erro);
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
/**
 * Fuzz das Fases 1 a 3, passada 2: o negócio sem os erros de propósito (por cabeça, uma parcela, sem desconto nem dedução),
 * para a venda das interações chegar ao que ela quer provocar (a carência, a cria ao pé) em vez de parar na conta.
 */
function negocioLimpo(rnd, n) {
  const g = negocio(rnd, n, true);
  Object.assign(g, { mod: 'CABECA', preco: sorteio(rnd, [180000, 250000]), parcelas: { n: 1, modo: rnd() < 0.5 ? 'vazias' : 'explicitas' }, finalidade: rnd() < 0.3 ? 'ABATE' : null });
  ['desvio', 'desconto', 'deducoes', 'loteKg'].forEach((x) => delete g[x]);
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
    // Rodada 2 da revisão da Fase 3 (achados 13 e 21): o GMD da resposta do registro (o que o modo curral mostra) = o do
    // intervalo do modelo que termina nesta pesagem (a última individual do dia contra a individual do dia anterior, com a
    // estimada ou a média do lote no meio fora), ou vazio com o porquê.
    const res = c.resp && c.resp.pesagem;
    if (res && Array.isArray(res.animais)) {
      res.animais.forEach((x) => {
        const r = rows.find((y) => y.animal_id === x.animal_id);
        if (!r) return;
        const v = intervalosModelo(S, x.animal_id).filter((y) => y.b.weight_id === r.weight_id)[0];
        const esperado = v ? v.gmd : null;
        contar('GMD da resposta conferido');
        if ((typeof x.gmd_kg_dia === 'number' ? x.gmd_kg_dia : null) !== esperado) erro('GMD da resposta ' + x.gmd_kg_dia + ', o da ficha pelo modelo ' + esperado);
        if (x.gmd_kg_dia === null && !x.gmd_explicacao) erro('GMD da resposta vazio sem o porquê');
        // Rodada 3 (achados 8 e 25): o intervalo do GMD vai junto (de, peso, ganho e dias do MESMO intervalo do modelo), e o
        // GMD é o ganho ÷ os dias dele — nunca o ganho e os dias contra outra pesagem.
        const iv = x.gmd_intervalo || null;
        const ivModelo = v ? { de: v.a.data_pesagem, peso_de_kg: v.a.peso_kg, ganho_kg: v.ganho, dias: v.nd } : null;
        if (JSON.stringify(iv) !== JSON.stringify(ivModelo)) erro('intervalo do GMD da resposta ' + JSON.stringify(iv) + ', o do modelo ' + JSON.stringify(ivModelo));
        else if (iv && typeof x.gmd_kg_dia === 'number' && Math.abs(x.gmd_kg_dia - iv.ganho_kg / iv.dias) > 0.0006) erro('GMD da resposta ' + x.gmd_kg_dia + ' não é o ganho ÷ os dias do intervalo dele ' + JSON.stringify(iv));
        if (iv && x.anterior && iv.de !== x.anterior.data) contar('GMD da resposta com intervalo antes da pesagem anterior');
      });
    }
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
  // Fuzz das Fases 1 a 3: com vários protocolos, quase sempre um do mesmo procedimento (às vezes outro: a recusa).
  if (s.sub === 'VACINACAO' ? rnd() < 0.5 : rnd() < (s.sub === 'VERMIFUGACAO' || s.sub === 'MEDICACAO' ? 0.25 : 0.03)) {
    const mesmos = S.t.PROTOCOLOS_SANITARIOS.filter((p) => p.tipo_procedimento === PROCEDIMENTO_DO_SUB[s.sub]);
    s.protocolo = sorteio(rnd, mesmos.length && rnd() < 0.9 ? mesmos : S.t.PROTOCOLOS_SANITARIOS).protocol_id;
  }
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
    // O frasco pago no ato na conta Vacinas (o de 333,33 e o de 99,99 em duas vezes): com o produto do cadastro com custo, a
    // recusa CUSTO_EM_DOBRO (o consumo já é o custo dele); sem produto do cadastro ou sem custo, aceito.
    if (s.custo) { campos.custo_valor = s.custo.valor; campos.custo_conta_id = s.custo.valor === 33333 || (s.custo.valor === 9999 && s.custo.vezes === 2) ? sis.contaVacinas : sis.custeio; if (s.custo.vezes) campos.custo_parcelas_qtd = s.custo.vezes; }
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
    // Rodada 3 da revisão da Fase 3 (achado 1): sem os dias informados, a carência padrão do produto do cadastro (05, seção
    // 4.8), como o formulário propõe; o 0 informado é "sem carência".
    // Revisão final da Fase 3 (achados 2 e 17): na correção com o mesmo produto, as cópias do cadastro feitas no lançamento
    // (a carência proposta, o nome e o fabricante) são as do original, não as do cadastro de agora.
    const orig = prod ? sanidadeCongelada(c, prod.product_id) : null;
    if (orig) contar('correção da aplicação com as cópias congeladas do produto');
    const diasCar = typeof cp.periodo_carencia_dias === 'number' ? cp.periodo_carencia_dias : d.subtipo === 'DOENCA' ? null
      : orig ? (typeof orig.periodo_carencia_dias === 'number' ? orig.periodo_carencia_dias : null)
      : prod && typeof prod.carencia_padrao_dias === 'number' ? prod.carencia_padrao_dias : null;
    if (typeof cp.periodo_carencia_dias !== 'number' && diasCar !== null && !orig) contar('carência pelo padrão do produto');
    const nomeEsperado = prod ? (orig && orig.nome_produto ? orig.nome_produto : prod.nome) : cp.nome_produto || null;
    const fabInf = typeof cp.fabricante === 'string' && cp.fabricante.trim() ? cp.fabricante.trim() : null;
    const fabEsperado = fabInf || (orig ? orig.fabricante || null : prod ? prod.fabricante || null : null);
    const fim = typeof diasCar === 'number' && diasCar > 0 ? somaDias(cp.event_date, diasCar) : null;
    // A próxima pelo protocolo: na correção com o mesmo protocolo, o intervalo do original (payload); senão o de agora.
    const intervaloOriginal = prot ? intervaloCongelado(c, prot.protocol_id) : null;
    const intervalo = intervaloOriginal !== null ? intervaloOriginal : prot && typeof prot.intervalo_dias === 'number' ? prot.intervalo_dias : null;
    if (intervaloOriginal !== null && !cp.data_proxima_aplicacao) contar('correção da aplicação pelo intervalo congelado do protocolo');
    const proxima = cp.data_proxima_aplicacao || (prot && prot.recorrencia_tipo === 'INTERVALO_DIAS' && intervalo !== null ? somaDias(cp.event_date, intervalo) : null);
    const unidade = prod ? prod.unidade : cp.unidade_dose || null;
    d.animais.forEach((x) => {
      const r = rows.find((y) => y.animal_id === x.animal_id);
      const l = linhaDe(x.animal_id);
      if (!l || l.efeito_inventario !== 0 || l.papel !== 'SUJEITO') erro('linha da aplicação ' + JSON.stringify(l));
      if (!r) { erro('sem o registro de sanidade do animal ' + x.animal_id); return; }
      const esperado = [PROCEDIMENTO_DO_SUB[d.subtipo], cp.event_date, cp.produto_id || null, nomeEsperado, fabEsperado, cp.protocol_id || null, fim, proxima];
      const gravado = [r.tipo_procedimento, r.data_aplicacao, r.produto_id || null, r.nome_produto || null, r.fabricante || null, r.protocol_id || null, r.data_fim_carencia || null, r.data_proxima_aplicacao || null];
      if (JSON.stringify(gravado) !== JSON.stringify(esperado)) erro('registro de sanidade gravado ' + JSON.stringify(gravado) + ', esperado ' + JSON.stringify(esperado));
      // A dose: a do animal, senão a do lançamento (por cabeça) ou a calculada pelo peso atual (por peso: positiva); total e
      // sem produto, vazia.
      const dose = typeof x.dose === 'number' ? x.dose : cp.modo_dose === 'POR_CABECA' ? cp.dose_referencia : cp.modo_dose === 'POR_PESO' ? undefined : null;
      if (dose === undefined ? !(typeof r.dose === 'number' && r.dose > 0) : (r.dose === undefined ? null : r.dose) !== dose) erro('dose gravada ' + r.dose + ', esperada ' + dose + ' (' + cp.modo_dose + ')');
      // Fuzz das Fases 1 a 3: a dose por kg exata = round4(dose por kg × o peso vigente na data: a última pesagem vigente
      // até a data, pela data e pela posição na cadeia). Com peso de referência em alguma categoria, só a pesagem dentro da
      // validade decide aqui (a vencida e a falta dela vão para o peso de referência da categoria na data).
      // Revisão da Fase 3, rodada 2 (achados 1 e 4): na correção com o mesmo produto, o modo por peso, a mesma dose por kg e
      // a mesma data, a dose gravada do animal no original (o fato confirmado naquele dia), não a do peso de agora.
      const congeladaDose = dose === undefined ? doseCongelada(c, x.animal_id, cp, prod) : null;
      if (congeladaDose !== null) {
        contar('correção da aplicação por peso pela dose congelada');
        if (r.dose !== congeladaDose) erro('dose por kg na correção ' + r.dose + ', esperada a do original ' + congeladaDose);
      } else if (dose === undefined) {
        const u = pesagemNaData(S, x.animal_id, cp.event_date);
        const refCat = S.t.CATEGORIAS.some((c) => typeof c.peso_referencia_kg === 'number');
        if (!u && !refCat) erro('dose por kg aceita sem peso nenhum do animal ' + x.animal_id);
        else if (u && (!refCat || diasEntre(u.data_pesagem, cp.event_date) <= paramNum(S, 'peso_validade_dias', 180))) {
          const kg = Math.round(Number((cp.dose_referencia * u.peso_kg * 10000).toFixed(6))) / 10000;
          contar('dose por kg conferida');
          if (r.dose !== kg) erro('dose por kg gravada ' + r.dose + ', esperada ' + kg + ' (' + cp.dose_referencia + ' × ' + u.peso_kg + ' kg da pesagem de ' + u.data_pesagem + ')');
        }
      }
      if (typeof r.dose === 'number' && r.unidade_dose !== unidade) erro('unidade da dose ' + r.unidade_dose + ', esperada ' + unidade);
    });
    // O consumo (03b, seção 6; PR-11): um movimento de saída do produto do cadastro (a quantidade informada, senão a soma
    // das doses), com estoque controlado ou não; o custo pelo consumo (quantidade × custo unitário de agora) rateado aos
    // tratados, sem parcela; o serviço pago no ato, com as parcelas pedidas; o custo de cada animal = as alocações.
    const doses = rows.map((r) => r.dose);
    // E3.6: a aplicação anterior ao marco zero (o histórico importado e a correção dele) não baixa estoque nem vira consumo,
    // e o serviço pago no ato nasce sem caixa (sem parcela).
    const hist = (S.ev.get(eid) || {}).pre_marco_zero === true;
    const q = prod && cp.modo_dose && !hist ? (typeof cp.quantidade_consumida_total === 'number' ? cp.quantidade_consumida_total : cp.modo_dose !== 'TOTAL' && doses.every((v) => typeof v === 'number') ? somaQtd(doses) : null) : null;
    const movs = S.t.MOVIMENTOS_ESTOQUE.filter((mv) => mv.event_id === eid);
    if (q === null ? movs.length : movs.length !== 1 || movs[0].tipo !== 'SAIDA' || movs[0].quantidade !== q || movs[0].product_id !== prod.product_id || movs[0].data !== cp.event_date) erro('movimentos ' + JSON.stringify(movs.map((mv) => [mv.tipo, mv.quantidade, mv.data])) + ', esperada a saída de ' + q);
    const fins = S.t.FINANCEIRO.filter((f) => f.event_id === eid);
    // Revisão da Fase 3 (achados 3 e 6): na correção com o mesmo produto, o custo unitário da saída do original e a conta do
    // consumo dele (o fato não é reprecificado pelo cadastro de agora); senão, o custo e a categoria de agora.
    const congelado = prod ? consumoCongelado(c, prod.product_id) : null;
    if (congelado && q !== null) contar('correção da aplicação pelo custo congelado');
    const cu = congelado ? congelado.custo : prod && typeof prod.custo_unitario === 'number' && prod.custo_unitario > 0 ? prod.custo_unitario : null;
    const contaEsperada = congelado && congelado.conta ? congelado.conta : prod ? CONTA_DA_CATEGORIA[prod.categoria] : null;
    const vc = q !== null && cu ? centavosDe(q * cu) : 0;
    const consumo = fins.filter((f) => f.product_id);
    const servico = fins.filter((f) => !f.product_id);
    const conta = (f) => (S.t.PLANO_CONTAS.find((p) => p.conta_id === f.conta_id) || {}).codigo;
    if (vc > 0 ? consumo.length !== 1 || consumo[0].valor !== vc || consumo[0].product_id !== prod.product_id || consumo[0].quantidade !== q || conta(consumo[0]) !== contaEsperada : consumo.length) erro('consumo ' + JSON.stringify(consumo.map((f) => [f.valor, f.quantidade, conta(f)])) + ', esperado ' + vc + ' (' + q + ' × ' + cu + ')');
    // O produto do cadastro com custo pago também no ato numa conta de insumo entraria duas vezes no resultado (07, seção 5;
    // 13, FIN-04): aceito assim, é defeito (achado 4).
    if (vc > 0 && servico.length && c.sis.contasInsumo.has(servico[0].conta_id)) erro('o produto do cadastro com custo foi pago também no ato numa conta de insumo (' + conta(servico[0]) + '): o custo entrou em dobro');
    else if (servico.length && c.sis.contasInsumo.has(servico[0].conta_id)) contar('pago no ato em conta de insumo sem consumo com custo: aceito');
    // O movimento de saída também leva o custo congelado (03a, MOVIMENTOS_ESTOQUE.custo_unitario).
    if (q !== null && movs.length === 1 && (movs[0].custo_unitario || null) !== cu) erro('custo unitário da saída ' + movs[0].custo_unitario + ', esperado ' + cu);
    consumo.forEach((f) => { if (S.t.PARCELAS.some((p) => p.financial_id === f.financial_id)) erro('o consumo do produto tem parcela'); });
    if (cp.custo_valor ? servico.length !== 1 || servico[0].valor !== cp.custo_valor || S.t.PARCELAS.filter((p) => p.financial_id === servico[0].financial_id).length !== (hist ? 0 : cp.custo_parcelas_qtd || 1) : servico.length) erro('serviço pago no ato ' + JSON.stringify(servico.map((f) => f.valor)) + ', pedido ' + cp.custo_valor + (hist ? ' (histórico: sem parcela)' : ''));
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
      // Por peso com mais de um animal: proporcional à dose de cada um (cada parte a menos de 1 centavo da conta exata).
      if (porPeso && rows.every((r) => typeof r.dose === 'number')) {
        const soma = rows.reduce((t, r) => t + r.dose, 0);
        alocs.filter((a) => a.financial_id === f.financial_id).forEach((a) => {
          const r = rows.find((y) => y.animal_id === a.animal_id);
          if (!r || Math.abs(a.valor_alocado - f.valor * r.dose / soma) >= 1) erro('rateio pela dose: ' + a.valor_alocado + ' para a dose ' + (r && r.dose) + ' de ' + soma + ' (valor ' + f.valor + ')');
        });
      }
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
  // Fuzz das Fases 1 a 3, passada 2: a correção pelas linhas gravadas também no estoque (o lançamento sem linha de animal):
  // o movimento, a compra de insumo e as parcelas dela.
  doGravado: (c, e) => {
    const { S, data } = c;
    const pj = e.payload_json || {};
    const f = S.t.FINANCEIRO.filter((x) => x.event_id === e.event_id)[0];
    const m = S.t.MOVIMENTOS_ESTOQUE.filter((x) => x.event_id === e.event_id)[0];
    const prod = (f && f.product_id) || (m && m.product_id) || pj.product_id;
    if (!prod) return null;
    const s = { tipo: 'ESTOQUE', sub: e.event_subtype, data, prod, emb: null, qtd: null, valor: null, vezes: null, parceiro: null, motivo: null, contado: null, lote: (m && m.lote) || pj.lote || null, validade: null };
    if (s.lote) s.validade = (m && m.validade) || pj.validade || null;
    if (!s.validade) s.lote = null;
    if (s.sub === 'ENTRADA') {
      if (!f) return null;
      const n = S.t.PARCELAS.filter((x) => x.financial_id === f.financial_id).length;
      Object.assign(s, { qtd: f.quantidade, valor: f.valor, vezes: n > 1 ? n : null, parceiro: f.partner_id || null });
    } else {
      s.motivo = pj.motivo_ajuste || 'PERDA';
      if (s.motivo === 'CONTAGEM') s.contado = typeof pj.saldo_contado === 'number' ? pj.saldo_contado : 0;
      else s.qtd = m ? Math.abs(m.quantidade) : typeof pj.quantidade === 'number' ? pj.quantidade : 1;
    }
    return s;
  },
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
      // Revisão da Fase 3 (achado 7): na correção da entrada do mesmo produto, a quantidade por embalagem do original (o
      // payload dele) e o movimento como o original gravou — o cadastro mudado depois não muda a compra.
      const congelado = entradaCongelada(c, prod.product_id);
      const fator = congelado && congelado.fator !== null ? congelado.fator : prod.fator_conversao;
      const comMovimento = congelado ? congelado.movimento : prod.controla_estoque === true;
      if (congelado) contar('correção da entrada pelo que o original gravou');
      const q = typeof cp.quantidade === 'number' ? cp.quantidade : somaQtd([cp.qtd_apresentacao * fator]);
      const f = fins[0];
      const conta = f && (S.t.PLANO_CONTAS.find((p) => p.conta_id === f.conta_id) || {}).codigo;
      if (fins.length !== 1 || f.valor !== cp.valor || f.product_id !== prod.product_id || f.quantidade !== q || conta !== 'COMPRA_INSUMOS') erro('compra ' + JSON.stringify(fins.map((x) => [x.valor, x.quantidade, x.product_id])) + ', pedida ' + JSON.stringify([cp.valor, q]));
      else if (S.t.PARCELAS.filter((p) => p.financial_id === f.financial_id).length !== (cp.parcelas_qtd || 1)) erro('parcelas da compra de insumo');
      const cu = Math.round(Number((cp.valor / 100 / q).toFixed(10)) * 10000) / 10000;
      if (comMovimento ? movs.length !== 1 || movs[0].tipo !== 'ENTRADA' || movs[0].quantidade !== q || Math.abs(movs[0].custo_unitario - cu) > 0.00011 : movs.length) erro('movimentos da entrada ' + JSON.stringify(movs.map((mv) => [mv.tipo, mv.quantidade, mv.custo_unitario])) + ', esperado ' + (comMovimento ? q : 'nenhum'));
      if (E.total_value !== cp.valor) erro('valor do evento ' + E.total_value + ', pedido ' + cp.valor);
      return;
    }
    // O acerto: sem lançamento; a contagem lança a diferença para o saldo na data (sem este evento), a perda e o
    // vencimento tiram a quantidade.
    if (fins.length) erro('acerto de estoque com lançamento financeiro');
    let esperado;
    if (cp.motivo_ajuste === 'CONTAGEM') {
      // Rodada 3 da revisão da Fase 3 (achado 16): no mesmo dia, só os movimentos antes da contagem na ordem do dia (a
      // posição na cadeia de substituição e o event_seq: a correção da contagem fica no lugar do original).
      const antesNoDia = (mv) => { const x = S.ev.get(mv.event_id); return x && (S.raiz(x) < S.raiz(E) || (S.raiz(x) === S.raiz(E) && x.event_seq < E.event_seq)); };
      const antes = S.t.MOVIMENTOS_ESTOQUE.filter((mv) => mv.product_id === prod.product_id && mv.event_id !== eid && S.vig.get(mv.event_id) && (mv.data < cp.event_date || (mv.data === cp.event_date && antesNoDia(mv))));
      if (S.t.MOVIMENTOS_ESTOQUE.some((mv) => mv.product_id === prod.product_id && mv.event_id !== eid && S.vig.get(mv.event_id) && mv.data === cp.event_date && !antesNoDia(mv))) contar('contagem corrigida com movimento do mesmo dia gravado depois dela');
      esperado = somaQtd([cp.saldo_contado, -somaQtd(antes.map((mv) => (mv.tipo === 'SAIDA' ? -mv.quantidade : mv.quantidade)))]);
    } else esperado = -cp.quantidade;
    if (movs.length !== 1 || movs[0].tipo !== 'AJUSTE' || movs[0].quantidade !== esperado || movs[0].data !== cp.event_date) erro('movimento do acerto ' + JSON.stringify(movs.map((mv) => [mv.tipo, mv.quantidade])) + ', esperado ' + esperado);
  },
});
/** O original de uma correção no retrato de antes (A), ou null fora da correção. */
function originalDaCorrecao(c) {
  return c.cmd && c.cmd.rota === 'evento.corrigir' && c.d.event_id ? c.A.ev.get(c.d.event_id) || null : null;
}
/**
 * Na correção de uma entrada de estoque do mesmo produto: {fator (o do payload do original, ou null), movimento (o original
 * tinha a entrada)}; null fora disso (o cadastro de agora decide).
 */
function entradaCongelada(c, productId) {
  const o = originalDaCorrecao(c);
  if (!o || o.event_type !== 'ESTOQUE' || o.event_subtype !== 'ENTRADA') return null;
  if (!c.A.t.FINANCEIRO.some((f) => f.event_id === o.event_id && f.product_id === productId)) return null;
  const pj = o.payload_json || {};
  return { fator: typeof pj.fator_conversao === 'number' ? pj.fator_conversao : null, movimento: c.A.t.MOVIMENTOS_ESTOQUE.some((m) => m.event_id === o.event_id && m.tipo === 'ENTRADA' && m.product_id === productId) };
}
/**
 * Na correção de uma aplicação com o mesmo produto (achados 3 e 6): {custo (o custo unitário da saída do original, ou null),
 * conta (o código da conta do consumo do original, ou null)}; null sem a saída do original (o cadastro de agora decide).
 */
function consumoCongelado(c, productId) {
  const o = originalDaCorrecao(c);
  if (!o) return null;
  const mov = c.A.t.MOVIMENTOS_ESTOQUE.filter((m) => m.event_id === o.event_id && m.tipo === 'SAIDA' && m.product_id === productId)[0];
  if (!mov) return null;
  const f = c.A.t.FINANCEIRO.filter((x) => x.event_id === o.event_id && x.product_id === productId)[0];
  return { custo: typeof mov.custo_unitario === 'number' && mov.custo_unitario > 0 ? mov.custo_unitario : null, conta: f ? (c.A.t.PLANO_CONTAS.find((p) => p.conta_id === f.conta_id) || {}).codigo || null : null };
}
/**
 * Na correção da aplicação por peso com o mesmo produto (ou o mesmo nome livre), a mesma dose por kg e a mesma data
 * (rodada 2, achados 1 e 4): a dose gravada do animal no original; null fora disso (refeita pelo peso na data).
 */
function doseCongelada(c, animalId, cp, prod) {
  const o = originalDaCorrecao(c);
  if (!o || o.event_type !== 'SANIDADE' || o.event_date !== cp.event_date) return null;
  const pj = o.payload_json || {};
  if (pj.modo_dose !== 'POR_PESO' || pj.dose_referencia !== cp.dose_referencia) return null;
  const r = c.A.t.SANIDADE.filter((x) => x.event_id === o.event_id && x.animal_id === animalId)[0];
  if (!r || typeof r.dose !== 'number') return null;
  const nt = (v) => String(v || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
  const mesmo = prod ? r.produto_id === prod.product_id : !r.produto_id && nt(r.nome_produto) === nt(cp.nome_produto);
  return mesmo ? r.dose : null;
}
/** Na correção, a linha de SANIDADE do original que usou o mesmo produto do cadastro; senão null. */
function sanidadeCongelada(c, productId) {
  const o = originalDaCorrecao(c);
  if (!o || o.event_type !== 'SANIDADE') return null;
  return c.A.t.SANIDADE.filter((r) => r.event_id === o.event_id && r.produto_id === productId)[0] || null;
}
/** Na correção com o mesmo protocolo, o intervalo que propôs a próxima aplicação do original (o payload dele); senão null. */
function intervaloCongelado(c, protocolId) {
  const o = originalDaCorrecao(c);
  if (!o || typeof (o.payload_json || {}).intervalo_protocolo_dias !== 'number') return null;
  const r0 = c.A.t.SANIDADE.filter((r) => r.event_id === o.event_id)[0];
  return r0 && r0.protocol_id === protocolId ? o.payload_json.intervalo_protocolo_dias : null;
}
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
  // E3.6: a despesa do manejo anterior ao marco zero (histórico importado e a correção dele) nasce sem caixa, sem parcela.
  const hist = E.pre_marco_zero === true;
  if (S.t.PARCELAS.filter((p) => p.financial_id === f.financial_id).length !== (hist ? 0 : cp.custo_parcelas_qtd || 1)) erro('parcelas da despesa' + (hist ? ' (histórico: sem parcela)' : ''));
  if (hist && f.status_pagamento !== 'SEM_CAIXA') erro('despesa histórica com efeito de caixa: ' + f.status_pagamento);
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

// --- Importadores de manejo (Fase 3, E3.6): pesagens, sanidade, reprodução e ocorrências sobre os animais do momento, às
// vezes com a data antiga (antes do marco zero: histórico), o brinco de outro animal, a linha repetida e o valor fora do
// lugar. O oráculo da conclusão confere o fato que cada linha IMPORTADA diz ter gerado (entity_id_gerado).
const deBr = (t) => (/^\d{2}\/\d{2}\/\d{4}$/.test(t || '') ? t.slice(6, 10) + '-' + t.slice(3, 5) + '-' + t.slice(0, 2) : null);
const numBr = (t) => (t === undefined || t === null || t === '' ? null : Number(String(t).replace(/\./g, '').replace(',', '.')));
const linhaEvento = (S, l) => S.t.EVENTOS.find((e) => e.event_id === l.event_id_gerado) || null;
/** A linha importada é histórica quando a data do lançamento dela é anterior ao marco zero. */
function conferirHistorico(S, l, e, data, erro) {
  if (!e) { erro('sem o evento gerado'); return; }
  if (data && e.event_date !== data) erro('evento de ' + e.event_date + ', a linha diz ' + data);
  if ((e.pre_marco_zero === true) !== (e.event_date < (S.marco || D0))) erro('pre_marco_zero ' + e.pre_marco_zero + ' em ' + e.event_date);
}
registrarImportador('PESAGENS', {
  arquivo: (c) => {
    const { S, rnd, b, data, qual } = c;
    const linhas = ['grupo;data;brinco;peso'];
    const n = 1 + Math.floor(rnd() * 3);
    const d0 = data();
    for (let i = 0; i < n; i++) {
      const id = qual();
      if (!id) break;
      const d = rnd() < 0.7 ? d0 : data();
      linhas.push([rnd() < 0.2 ? 'P' + (1 + Math.floor(rnd() * 2)) : '', br(d), rnd() < 0.05 ? '9' + b(id) : b(id), dec(pesoPara(S, rnd, id, d))].join(';'));
    }
    if (rnd() < 0.1 && linhas.length > 1) linhas.push(linhas[linhas.length - 1]);
    return { texto: linhas.join('\n'), mapa: { colunas: { grupo: 'grupo', data: 'data', brinco: 'brinco', peso: 'peso' }, confiancas: {}, padroes: { momento: sorteio(rnd, ['ROTINA', 'ROTINA', 'ENTRADA']), metodo: sorteio(rnd, ['BALANCA', 'FITA']) } } };
  },
  efeito: (c) => {
    const { S, l, v, erro } = c;
    const p = S.t.PESAGENS.find((x) => x.weight_id === l.entity_id_gerado);
    if (!p) { erro('sem a pesagem gerada'); return; }
    if (p.event_id !== l.event_id_gerado || p.data_pesagem !== deBr(v.data) || p.peso_kg !== numBr(v.peso)) erro('pesagem gravada ' + JSON.stringify([p.data_pesagem, p.peso_kg]) + ', a linha diz ' + JSON.stringify([v.data, v.peso]));
    const nb = (x) => (/^\d+$/.test(String(x)) ? String(Number(x)) : String(x).toUpperCase());
    if (v.brinco && !S.t.IDENTIFICACOES.some((x) => x.animal_id === p.animal_id && x.tipo === 'BRINCO' && nb(x.codigo) === nb(v.brinco))) erro('a pesagem foi para um animal que nunca teve o brinco ' + v.brinco);
    conferirHistorico(S, l, linhaEvento(S, l), deBr(v.data), erro);
  },
});
registrarImportador('SANIDADE', {
  arquivo: (c) => {
    const { sis, S, rnd, b, data, qual } = c;
    // Fuzz das Fases 1 a 3: também a carência (que pode cobrir uma venda gravada: o aviso CARENCIA_ATIVA no bloco), a
    // próxima aplicação e a dose por kg (pelo peso de cada animal na data).
    const linhas = ['data;procedimento;produto;nome;modo;dose;unidade;diagnostico;carencia;proxima;brinco'];
    const nomeDe = (id) => (S.t.PRODUTOS.find((x) => x.product_id === id) || {}).nome || '';
    const d = data();
    const x = rnd();
    const cab = x < 0.4 ? ['vacinação', nomeDe(sis.produtos.vacina), '', 'por cabeça', '1', '']
      : x < 0.55 ? ['vermifugação', rnd() < 0.5 ? nomeDe(sis.produtos.vermifugo) : '', 'Ivermectina 1%', 'por cabeça', '5', 'mL']
        : x < 0.65 ? ['vermifugação', nomeDe(sis.produtos.vermifugo), '', 'por kg', '0,02', '']
          : x < 0.78 ? ['doença', '', '', '', '', '']
            : x < 0.9 ? ['medicação', nomeDe(sis.produtos.antibiotico), '', 'total', '', '']
              : ['vacinação', 'Vacina Inexistente', '', 'por cabeça', '1', ''];
    if (cab[0] === 'vermifugação' && cab[1]) cab[2] = '';
    const carencia = cab[0] !== 'doença' && rnd() < 0.4 ? String(sorteio(rnd, [30, 60, 120])) : '';
    const proxima = cab[0] !== 'doença' && rnd() < 0.2 ? br(somaDias(d, sorteio(rnd, [30, 180]))) : '';
    const ids = alguns(rnd, c.ativos.length ? c.ativos : c.comBrinco, 3);
    ids.forEach((id) => linhas.push([br(d)].concat(cab.slice(0, 6), [cab[0] === 'doença' ? 'Tristeza parasitária' : '', carencia, proxima, b(id)]).join(';')));
    if (!ids.length) { const id = qual(); if (!id) return null; linhas.push([br(d)].concat(cab.slice(0, 6), ['', carencia, proxima, b(id)]).join(';')); }
    if (rnd() < 0.1 && linhas.length > 1) linhas.push(linhas[linhas.length - 1]);
    return { texto: linhas.join('\n'), mapa: { colunas: { data: 'data', procedimento: 'procedimento', produto: 'produto', nome: 'nome_produto', modo: 'modo_dose', dose: 'dose_lancamento', unidade: 'unidade', diagnostico: 'diagnostico', carencia: 'carencia', proxima: 'proxima', brinco: 'brinco' }, confiancas: {}, padroes: {} } };
  },
  efeito: (c) => {
    const { S, l, v, erro } = c;
    const h = S.t.SANIDADE.find((x) => x.health_id === l.entity_id_gerado);
    if (!h) { erro('sem a aplicação gerada'); return; }
    const proc = { 'vacinação': 'VACINA', 'vermifugação': 'VERMIFUGO', 'doença': 'DOENCA', 'medicação': 'MEDICAMENTO' }[v.procedimento];
    if (h.event_id !== l.event_id_gerado || h.data_aplicacao !== deBr(v.data) || h.tipo_procedimento !== proc) erro('aplicação gravada ' + JSON.stringify([h.data_aplicacao, h.tipo_procedimento]) + ', a linha diz ' + JSON.stringify([v.data, v.procedimento]));
    if ((h.nome_produto || '') !== (v.produto || v.nome || '')) erro('produto gravado ' + h.nome_produto + ', a linha diz ' + (v.produto || v.nome));
    // Rodada 3 (achado 1): sem a coluna da carência, a carência padrão do produto do cadastro (o mesmo caminho do formulário).
    const prodCad = v.produto && h.produto_id ? S.t.PRODUTOS.find((p) => p.product_id === h.produto_id) : null;
    const car = v.carencia !== undefined && v.carencia !== null && v.carencia !== '' ? Number(v.carencia) : prodCad && typeof prodCad.carencia_padrao_dias === 'number' && proc !== 'DOENCA' ? prodCad.carencia_padrao_dias : null;
    if ((v.carencia === undefined || v.carencia === null || v.carencia === '') && car !== null) contar('carência importada pelo padrão do produto');
    if ((typeof h.periodo_carencia_dias === 'number' ? h.periodo_carencia_dias : null) !== car || (h.data_fim_carencia || null) !== (car ? somaDias(deBr(v.data), car) : null)) erro('carência gravada ' + JSON.stringify([h.periodo_carencia_dias, h.data_fim_carencia]) + ', a linha diz ' + v.carencia);
    if (v.proxima && h.data_proxima_aplicacao !== deBr(v.proxima)) erro('próxima gravada ' + h.data_proxima_aplicacao + ', a linha diz ' + v.proxima);
    const e = linhaEvento(S, l);
    conferirHistorico(S, l, e, deBr(v.data), erro);
    // Antes do marco zero, nem saída de estoque nem consumo; depois, a saída do produto do cadastro.
    const movs = S.t.MOVIMENTOS_ESTOQUE.filter((m) => m.event_id === l.event_id_gerado);
    if (e && e.pre_marco_zero === true && (movs.length || S.t.FINANCEIRO.some((f) => f.event_id === e.event_id && f.product_id))) erro('aplicação histórica com estoque ou consumo');
    if (e && e.pre_marco_zero !== true && h.produto_id && movs.length !== 1) erro(movs.length + ' saídas de estoque na aplicação com produto do cadastro');
  },
});
registrarImportador('REPRODUCAO', {
  arquivo: (c) => {
    const { S, rnd, b, data } = c;
    const linhas = ['data;registro;estacao;touro;brinco;resultado'];
    const femeas = c.comBrinco.filter((id) => fem(S, id));
    const machos = c.comBrinco.filter((id) => !fem(S, id));
    const d = data();
    const est = rnd() < 0.4 ? ((sorteio(rnd, S.t.ESTACOES_MONTA || []) || {}).nome || '') : '';
    const reg = sorteio(rnd, ['exposição', 'diagnóstico', 'diagnóstico', 'inseminação', 'cobertura', 'aborto']);
    const touro = reg === 'inseminação' ? (rnd() < 0.8 ? 'Touro do sêmen' : 'Touro Fantasma') : reg === 'cobertura' && machos.length ? b(sorteio(rnd, machos)) : '';
    const ids = alguns(rnd, rnd() < 0.9 && femeas.length ? femeas : c.comBrinco, 3);
    if (!ids.length) return null;
    ids.forEach((id) => linhas.push([br(d), reg, est, touro, b(id), reg === 'diagnóstico' ? sorteio(rnd, ['positivo', 'vazia', 'duvidoso']) : ''].join(';')));
    if (reg === 'exposição' && machos.length && rnd() < 0.6) linhas.push([br(d), reg, est, '', b(sorteio(rnd, machos)), ''].join(';'));
    if (rnd() < 0.1) linhas.push(linhas[linhas.length - 1]);
    return { texto: linhas.join('\n'), mapa: { colunas: { data: 'data', registro: 'registro', estacao: 'estacao', touro: 'touro', brinco: 'brinco', resultado: 'resultado' }, confiancas: {}, padroes: {} } };
  },
  efeito: (c) => {
    const { S, l, v, erro } = c;
    const sub = { 'exposição': 'EXPOSICAO', 'diagnóstico': 'DIAGNOSTICO_GESTACAO', 'inseminação': 'INSEMINACAO', cobertura: 'COBERTURA', aborto: 'ABORTO' }[v.registro];
    const e = linhaEvento(S, l);
    conferirHistorico(S, l, e, deBr(v.data), erro);
    if (e && e.event_subtype !== sub) erro('registro ' + e.event_subtype + ', a linha diz ' + v.registro);
    const r = (S.t.REPRODUCAO || []).find((x) => x.reproduction_id === l.entity_id_gerado);
    if (!r) {
      // O touro da exposição: a linha dele no evento, com o papel TOURO.
      const ea = S.t.EVENTO_ANIMAIS.find((x) => x.event_animal_id === l.entity_id_gerado);
      if (!ea || ea.papel !== 'TOURO' || sub !== 'EXPOSICAO') erro('sem o registro reprodutivo gerado (' + JSON.stringify(ea) + ')');
      return;
    }
    if (r.event_id !== l.event_id_gerado || r.tipo_evento !== sub || r.data !== deBr(v.data)) erro('registro gravado ' + JSON.stringify([r.tipo_evento, r.data]));
    const res = { positivo: 'POSITIVO', vazia: 'NEGATIVO', duvidoso: 'INCONCLUSIVO' }[v.resultado] || null;
    if ((r.resultado || null) !== (sub === 'DIAGNOSTICO_GESTACAO' ? res : null)) erro('resultado gravado ' + r.resultado + ', a linha diz ' + v.resultado);
  },
});
registrarImportador('OCORRENCIAS', {
  arquivo: (c) => {
    const { rnd, b, data, qual } = c;
    const linhas = ['data;tipo;descricao;brinco'];
    const d = data();
    const tipo = sorteio(rnd, ['Observação geral', 'Lesão ou ferimento', 'Descorna', 'Briga']);
    const desc = sorteio(rnd, ['Fugiram para o vizinho', 'Corte no arame', 'Descorna do lote']);
    for (let i = 0; i < 1 + Math.floor(rnd() * 3); i++) { const id = qual(); if (id) linhas.push([br(rnd() < 0.8 ? d : data()), tipo, desc, b(id)].join(';')); }
    if (rnd() < 0.1 && linhas.length > 1) linhas.push(linhas[linhas.length - 1]);
    return { texto: linhas.join('\n'), mapa: { colunas: { data: 'data', tipo: 'tipo_ocorrencia', descricao: 'descricao', brinco: 'brinco' }, confiancas: {}, padroes: {} } };
  },
  efeito: (c) => {
    const { S, l, v, erro } = c;
    const ea = S.t.EVENTO_ANIMAIS.find((x) => x.event_animal_id === l.entity_id_gerado);
    const e = linhaEvento(S, l);
    if (!ea || ea.event_id !== l.event_id_gerado || ea.papel !== 'SUJEITO' || ea.efeito_inventario !== 0) erro('linha do animal gravada ' + JSON.stringify(ea));
    conferirHistorico(S, l, e, deBr(v.data), erro);
    const tipo = { 'Observação geral': 'OBSERVACAO', 'Lesão ou ferimento': 'LESAO', Descorna: 'DESCORNA' }[v.tipo];
    if (e && ((e.payload_json || {}).tipo_ocorrencia !== tipo || e.description !== v.descricao)) erro('ocorrência gravada ' + JSON.stringify([(e.payload_json || {}).tipo_ocorrencia, e.description]));
  },
});

// ------------------------------------------------------------------ fuzz das Fases 1 a 3, passada 1 ----
// O gerador ampliado da Fase 3: o modo curral e o tronco em blocos com a chave própria, as interações da Fase 3 com a
// Fase 2 montadas de propósito (o sorteio comum quase não chega a elas), o estoque ligado e desligado alternando e os
// protocolos criados e mudados no meio. Os oráculos novos (mais abaixo): a dose por kg exata, o aviso de estoque e o de
// carência pela transição (em todo caminho), a agenda sanitária por um modelo independente e os indicadores reprodutivos.
/**
 * Quantas vezes cada oráculo novo desta passada conferiu algo de verdade (o reenvio duplicado do bloco, a conferência da
 * chave, a transição do estoque e da carência, a pendência da agenda, a dose por kg): as sementes fixas exigem cada um.
 */
const COBERTURA = {};
const contar = (k, n) => { COBERTURA[k] = (COBERTURA[k] || 0) + (n === undefined ? 1 : n); };
/** O animal existe de fato (nem anulado nem pendente): os candidatos das interações e dos blocos (às vezes não, a recusa). */
const existe = (S, id) => ['ANULADO', 'PENDENTE'].indexOf((S.animais.get(id) || {}).situacao_cadastral) < 0;
const vigentesDe = (S, aba) => (S.t[aba] || []).filter((r) => S.vig.get(r.event_id));
/** O último dia de carência de um registro de SANIDADE (o gravado ou aplicação + período inteiro positivo), ou null. */
const fimCarenciaDe = (r) => (r.data_fim_carencia ? r.data_fim_carencia : typeof r.periodo_carencia_dias === 'number' && r.periodo_carencia_dias > 0 && Math.floor(r.periodo_carencia_dias) === r.periodo_carencia_dias ? somaDias(r.data_aplicacao, r.periodo_carencia_dias) : null);
const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const ateHoje = (d) => (d > HOJE ? HOJE : d);
/** Parâmetro numérico de CONFIGURACOES (o padrão quando vazio). */
function paramNum(S, chave, padrao) {
  const v = S.config.get(chave);
  return v === undefined || v === null || v === '' || !isFinite(Number(v)) ? padrao : Number(v);
}
/** A última pesagem vigente do animal até a data (data, posição na cadeia, sequência), ou null. */
function pesagemNaData(S, id, data) {
  const ps = (S.t.PESAGENS || []).filter((p) => p.animal_id === id && S.vig.get(p.event_id) && p.data_pesagem <= data && typeof p.peso_kg === 'number').map((p) => { const e = S.ev.get(p.event_id); return { p, data: p.data_pesagem, raiz: S.raiz(e), seq: e.event_seq }; });
  return ps.length ? ultimo(ps).p : null;
}
/** O último registro reprodutivo vigente da fêmea que passa no filtro (data, posição na cadeia, sequência), ou null. */
function ultimoReg(S, id, f) {
  const l = vigentesDe(S, 'REPRODUCAO').filter((r) => r.animal_id === id && f(r)).map((r) => { const e = S.ev.get(r.event_id); return { r, data: r.data, raiz: S.raiz(e), seq: e.event_seq }; });
  return l.length ? ultimo(l).r : null;
}

/**
 * O modo curral (Weights, 08, seção 5) e o diagnóstico no tronco (Reproduction): a fila enviada em blocos, cada um com a
 * chave própria guardada no rascunho antes do envio (`lida:<passo>:<n>`); entre um bloco e outro, outros comandos entram
 * (o animal vendido, a pesagem corrigida). O que o cliente faz e o servidor aguenta: o bloco sem sinal (a chave existe e o
 * pedido não chegou: a conferência antes do reenvio dá INEXISTENTE, e o envio depois é um comando novo), a resposta perdida
 * (o reenvio com a mesma chave é duplicado e responde o mesmo evento), o aviso do servidor aceito na linha ("Está certo":
 * o mesmo bloco, a mesma chave, com o aceite), o peso substituído (o animal de um bloco anterior de novo, no mesmo dia) e o
 * "terminar" (a conferência da chave). A expectativa de cada conferência e de cada reenvio vem do que o sistema gravou
 * (`sis.chavesGravadas`, em executar), e vale também na sequência encolhida.
 */
function iniciarLida(sis, S, rnd, k) {
  const tronco = rnd() < 0.35;
  const data = rnd() < 0.6 ? HOJE : ateHoje(dataPara(S, rnd, []));
  const lida = { tipo: tronco ? 'tronco' : 'curral', k0: k, data, n: 0, blocos: [], vistos: [] };
  if (tronco) {
    const ests = (S.t.ESTACOES_MONTA || []).filter((e) => e.data_inicio <= data);
    lida.estacao = ests.length && rnd() < 0.7 ? sorteio(rnd, ests).estacao_id : null;
    lida.metodo = rnd() < 0.8 ? sorteio(rnd, ['PALPACAO', 'ULTRASSOM']) : null;
  } else {
    lida.metodo = sorteio(rnd, ['BALANCA', 'BALANCA', 'FITA']);
    lida.momento = sorteio(rnd, ['ROTINA', 'ROTINA', 'DESMAMA', 'ENTRADA']);
    lida.jejum = rnd() < 0.15;
    lida.pasto = sorteio(rnd, PASTOS_DE(S));
  }
  sis.lida = lida;
  return lida;
}
/** O próximo bloco da fila (1 a 3 animais do lote; às vezes um que já passou: o peso substituído, o diagnóstico refeito). */
function blocoDaLida(sis, S, rnd, lida) {
  const vistos = new Set(lida.vistos);
  const filtro = lida.tipo === 'tronco' ? (id, p) => p.dia && fem(S, id) : (id, p) => p.dia && (p.pastoDia === lida.pasto || rnd() < 0.2);
  let ids = animaisPara(S, rnd, lida.data, 3, filtro).filter((id) => !vistos.has(id) && (existe(S, id) || rnd() < 0.1));
  if (lida.vistos.length && rnd() < 0.15) ids.push(sorteio(rnd, lida.vistos));
  ids = ids.filter((x, i, a) => a.indexOf(x) === i);
  if (!ids.length) return null;
  // Às vezes o mesmo animal duas vezes no bloco (o cliente substitui na fila; o servidor recusa o repetido).
  if (rnd() < 0.04) ids.push(ids[0]);
  let spec;
  if (lida.tipo === 'tronco') {
    // As teclas do tronco: p (positiva), p90 (positiva com 90 dias), v (vazia), d (duvidosa).
    const itens = ids.map((id) => {
      const t = sorteio(rnd, ['p', 'p', 'p90', 'v', 'v', 'd']);
      return { id, resultado: t === 'v' ? 'NEGATIVO' : t === 'd' ? 'INCONCLUSIVO' : 'POSITIVO', idade: t === 'p90' ? 90 : null, prevista: null };
    });
    spec = { tipo: 'REPRODUCAO', sub: 'DIAGNOSTICO_GESTACAO', data: lida.data, itens, estacao: lida.estacao, metodo: lida.metodo, custo: null, touros: [], touro: null, semen: null, fim: null };
  } else {
    spec = { tipo: 'PESAGEM', data: lida.data, momento: lida.momento, metodo: lida.metodo, jejum: lida.jejum, itens: itensPesagem(S, rnd, ids, lida.data), lote: null };
  }
  const b = { n: ++lida.n, chave: 'lida:' + lida.k0 + ':' + lida.n, spec };
  lida.blocos.push(b);
  ids.forEach((id) => lida.vistos.push(id));
  return b;
}
function cmdDoBloco(sis, base, lida, b, rotulo) {
  // O cliente manda o bloco sem aceite; o aviso do servidor fica na linha e "Está certo" reenvia com o aceite (aceitar).
  return Object.assign(base, { rota: 'evento.registrar', dados: montarDados(sis, b.spec), spec: b.spec, chaveFixa: b.chave, avisos: [], simular: false, rotulo: lida.tipo + ': ' + rotulo });
}
function gerarLida(sis, S, rnd, k, base) {
  let lida = sis.lida;
  if (!lida) {
    lida = iniciarLida(sis, S, rnd, k);
    const b = blocoDaLida(sis, S, rnd, lida);
    if (!b) { sis.lida = null; return null; }
    return cmdDoBloco(sis, base, lida, b, 'primeiro bloco');
  }
  const status = (b, rotulo) => Object.assign(base, { rota: 'operacao.status', dados: { chave: b.chave }, avisos: [], simular: false, rotulo: lida.tipo + ': ' + rotulo });
  const x = rnd();
  if (x < 0.42) { const b = blocoDaLida(sis, S, rnd, lida); if (b) return cmdDoBloco(sis, base, lida, b, 'bloco'); }
  else if (x < 0.52) {
    // Sem sinal: o bloco montado e a chave guardada, mas o pedido não chega; antes de reenviar, o cliente confere a chave.
    const b = blocoDaLida(sis, S, rnd, lida);
    if (b) return status(b, 'conferência do bloco sem sinal');
  } else if (x < 0.74 && lida.blocos.length) {
    const b = sorteio(rnd, lida.blocos);
    return cmdDoBloco(sis, base, lida, b, 'reenvio de um bloco');
  } else if (x < 0.86 && lida.blocos.length) return status(sorteio(rnd, lida.blocos), 'conferência de um bloco');
  // Terminar: a conferência do último bloco e o fim da fila.
  sis.lida = null;
  const u = lida.blocos[lida.blocos.length - 1];
  return u ? status(u, 'terminar') : null;
}

/**
 * As interações da Fase 3 com a Fase 2, montadas de propósito: a venda dentro da carência (para abate e para recria) e a
 * aplicação retroativa cuja carência cobre uma venda gravada; a pesagem, a aplicação e a ocorrência de quem já saiu; a
 * venda ou a morte levadas para antes de uma pesagem; o diagnóstico da fêmea que saiu e a saída levada para antes do
 * registro reprodutivo; o parto da prenhe (na previsão e dentro da gestação), o parto corrigido (ou estornado) depois do
 * diagnóstico e o aborto; o estorno e a correção para menos da compra de insumo já consumido; a desmama das crias; a
 * castração do touro do lote; a dose por kg com e sem pesagem; a reprodução dentro e fora da estação de monta.
 */
function gerarInteracao(sis, S, rnd, k, base) {
  const P = PASTOS_DE(S);
  // Passada 2: a interação cujo preparo foi gravado tende a voltar (a cadeia preparo → interação fecha mais vezes).
  const pendente = sis.interacaoPendente && rnd() < 0.7 ? sis.interacaoPendente : null;
  const qual = pendente || pesado(rnd, [['vendaCarencia', 4], ['sanidadeSobreVenda', 2.5], ['importacaoNaCarencia', 1.5], ['pesagemDeQuemSaiu', 2], ['saidaAntesDaPesagem', 1.5], ['diagnosticoDeQuemSaiu', 2], ['saidaAntesDoRegistro', 1.5], ['partoDaPrenhe', 2.5], ['partoCorrigido', 2], ['aborto', 1.5], ['estornoInsumoConsumido', 2], ['entradaInsumoMenor', 1], ['desmamaDasCrias', 1.5], ['castracaoDoTouro', 1.2], ['dosePorKg', 2.5], ['reproducaoNaEstacao', 3],
    // Fuzz das Fases 1 a 3, passada 2: as interações novas (a venda e a aplicação corrigidas para a carência, o consumo acima
    // do estoque, o acerto retroativo, o parto da não prenhe, o registro da mãe em volta do parto, a cria ao pé e a desmama
    // com a venda, a pesagem levada para fora da permanência, a importação de manejo de quem saiu, a estação com registros
    // mudada no cadastro).
    ['vendaParaCarencia', 2.5], ['aplicacaoAcimaDoEstoque', 1.5], ['acertoRetroativo', 1], ['partoDaVazia', 1.2], ['depoisDoParto', 1.5], ['desmamaEVenda', 1.5], ['pesagemForaDaPermanencia', 1.2], ['importacaoDeQuemSaiu', 1.2], ['estacaoMudada', 1.2],
    // Rodada 3 da revisão da Fase 3 (achado 16): o movimento do mesmo dia gravado depois de uma contagem.
    ['movimentoDepoisDaContagem', 1.2], ['carenciaDoCadastro', 1.2]]);
  let c = interacaoDe(sis, S, rnd, k, base, P, qual);
  if (c) { contar('interação ' + qual); sis.interacaoPendente = null; } else {
    // Passada 2: sem como montar (na passada 1, perto de 70% das sorteadas), o gerador monta o que falta para ela.
    c = preparoDe(sis, S, rnd, k, base, P, qual);
    contar('interação ' + qual + (c ? ' (preparo)' : ' (sem como montar)'));
    sis.interacaoPendente = c ? qual : null;
  }
  return c;
}
/**
 * Fuzz das Fases 1 a 3, passada 2: o preparo da interação que ainda não tem como ser montada: a estação de monta, a compra
 * de insumo com estoque controlado e o consumo dela, o diagnóstico positivo e a exposição, o parto, a pesagem, a saída de
 * quem tem pesagem ou registro reprodutivo, a aplicação com carência. A próxima vez que a mesma interação for sorteada, ela
 * encontra o que precisa.
 */
function preparoDe(sis, S, rnd, k, base, P, qual) {
  if (!S.marco) return null;
  const marco = S.marco;
  const em = (l) => l.indexOf(qual) >= 0;
  const registrar = (spec, rotulo) => (spec ? Object.assign(base, { rota: 'evento.registrar', dados: montarDados(sis, spec), spec, rotulo: 'interação: preparo, ' + rotulo }) : null);
  const naFaixa = (d) => (d < marco ? marco : ateHoje(d));
  const adulta = (D) => (id) => fem(S, id) && existe(S, id) && presenca(S, id, D).dia && ((S.animais.get(id) || {}).data_nascimento || '9999-12-31') <= somaDias(D, -760);
  const adultas = (D, max) => animaisPara(S, rnd, D, max, (id) => adulta(D)(id)).filter(adulta(D));
  const saida = (id, desde, rotulo) => {
    const tipo = sorteio(rnd, ['VENDA', 'VENDA', 'MORTE', 'DESCARTE']);
    const spec = { tipo, data: ateHoje(sorteio(rnd, [desde, somaDias(desde, 1), somaDias(desde, 40)])), ids: [id] };
    if (tipo === 'VENDA') spec.neg = negocioLimpo(rnd, 1);
    return registrar(spec, rotulo + ' (' + tipo.toLowerCase() + ')');
  };
  const parto = (rotulo) => {
    const D = naFaixa(sorteio(rnd, [somaDias(HOJE, -250), somaDias(HOJE, -100), HOJE]));
    const maes = adultas(D, 1);
    if (!maes.length) return null;
    const s = tipoDoRegistro('NASCIMENTO').propor({ sis, S, rnd, D, P });
    if (!s) return null;
    Object.assign(s, { mae: maes[0], data: D });
    s.crias.forEach((c) => { if (c.situacao !== 'VIVO') Object.assign(c, { situacao: 'VIVO', sexo: rnd() < 0.5 ? 'F' : 'M', brinco: null, peso: null }); else if (rnd() < 0.6) c.brinco = null; });
    return registrar(s, rotulo);
  };
  // A estação existe, mas sem registro nela: a reprodução na estação (a exposição, quando o diagnóstico não tem expostas).
  if (qual === 'estacaoMudada' && (S.t.ESTACOES_MONTA || []).length) return interacaoDe(sis, S, rnd, k, base, P, 'reproducaoNaEstacao');
  if (em(['reproducaoNaEstacao', 'estacaoMudada'])) {
    const ini = naFaixa(sorteio(rnd, [somaDias(HOJE, -60), somaDias(HOJE, -150), somaDias(HOJE, -280), somaDias(marco, 20)]));
    return Object.assign(base, { rota: 'estacao.salvar', dados: { campos: { nome: 'Estação P' + k, data_inicio: ini, data_fim: somaDias(ini, sorteio(rnd, [60, 90, 120])), tipo: sorteio(rnd, ['MONTA_NATURAL', 'IA', 'MISTA']) } }, rotulo: 'interação: preparo, estação de monta' });
  }
  if (qual === 'carenciaDoCadastro') {
    // A carência padrão no cadastro de um produto ativo (a aplicação sem os dias informados passa a usá-la).
    const p = sorteio(rnd, S.t.PRODUTOS.filter((x) => x.ativo !== false));
    if (!p) return null;
    return Object.assign(base, { rota: 'produto.salvar', dados: { product_id: p.product_id, campos: { carencia_padrao_dias: sorteio(rnd, [21, 35, 60]) }, justificativa: 'Carência da bula' }, rotulo: 'interação: preparo, carência no cadastro' });
  }
  if (qual === 'movimentoDepoisDaContagem' && rnd() < 0.6) {
    // A contagem do armário num dia em que já há movimento do produto (ou hoje): a interação lança depois, no mesmo dia.
    const movs = vigentesDe(S, 'MOVIMENTOS_ESTOQUE').filter((m) => S.t.PRODUTOS.some((p) => p.product_id === m.product_id && p.controla_estoque === true && p.ativo !== false));
    const m = sorteio(rnd, movs);
    if (m) {
      const s = { tipo: 'ESTOQUE', sub: 'AJUSTE', data: ateHoje(sorteio(rnd, [m.data, HOJE])), prod: m.product_id };
      preencherEstoque(S, rnd, s);
      Object.assign(s, { motivo: 'CONTAGEM', contado: sorteio(rnd, [0, 3, 40]), qtd: null });
      return registrar(s, 'contagem do armário');
    }
  }
  if (em(['estornoInsumoConsumido', 'entradaInsumoMenor', 'aplicacaoAcimaDoEstoque', 'acertoRetroativo', 'movimentoDepoisDaContagem'])) {
    const prods = S.t.PRODUTOS.filter((p) => p.controla_estoque === true && p.ativo !== false);
    const entradas = vigentesDe(S, 'MOVIMENTOS_ESTOQUE').filter((m) => m.tipo === 'ENTRADA' && prods.some((p) => p.product_id === m.product_id));
    if (entradas.length && rnd() < 0.6) {
      // O consumo do insumo comprado: a aplicação com o produto, no dia da entrada ou depois.
      const m = sorteio(rnd, entradas);
      const p = prods.find((x) => x.product_id === m.product_id);
      const D = ateHoje(sorteio(rnd, [m.data, somaDias(m.data, 10), HOJE]));
      const ids = animaisPara(S, rnd, D, 3, (id, pr) => pr.dia).filter((id) => existe(S, id));
      if (!ids.length) return null;
      const s = propostaSanidade(sis, S, rnd, p.categoria === 'VACINA' ? 'VACINACAO' : p.categoria === 'VERMIFUGO' ? 'VERMIFUGACAO' : 'MEDICACAO', D, ids);
      Object.assign(s, { prod: p.product_id, nome: null, unidade: null, modo: 'POR_CABECA', doseRef: sorteio(rnd, [2, 5, 10]), qtd: null, protocolo: null, lote: null, validade: null });
      s.itens.forEach((i) => { i.dose = null; });
      return registrar(s, 'consumo do insumo comprado');
    }
    const p = sorteio(rnd, prods);
    if (!p) return null;
    const s = { tipo: 'ESTOQUE', sub: 'ENTRADA', data: naFaixa(sorteio(rnd, [somaDias(marco, 5), somaDias(HOJE, -120), somaDias(HOJE, -30)])), prod: p.product_id };
    preencherEstoque(S, rnd, s);
    Object.assign(s, { emb: null, qtd: sorteio(rnd, [5, 20, 60]) });
    return registrar(s, 'compra de insumo');
  }
  if (em(['partoCorrigido', 'depoisDoParto']) && rnd() < 0.6) {
    const c = interacaoDe(sis, S, rnd, k, base, P, 'partoDaPrenhe');
    if (c) return c;
    return parto('parto');
  }
  if (em(['desmamaDasCrias', 'desmamaEVenda'])) return parto('parto para a desmama');
  if (em(['partoDaPrenhe', 'partoCorrigido', 'aborto', 'depoisDoParto', 'partoDaVazia'])) {
    const D = naFaixa(sorteio(rnd, [somaDias(HOJE, -30), somaDias(HOJE, -120), somaDias(HOJE, -250)]));
    const ids = adultas(D, 3);
    if (!ids.length) return null;
    if (em(['aborto', 'partoDaVazia'])) {
      const sub = sorteio(rnd, ['EXPOSICAO', 'INSEMINACAO', 'COBERTURA']);
      const s = { tipo: 'REPRODUCAO', sub, data: D, itens: ids.map((id) => ({ id })), estacao: null, custo: null };
      preencherReproducao(S, rnd, s);
      return registrar(s, 'exposição da fêmea (' + sub.toLowerCase() + ')');
    }
    const s = { tipo: 'REPRODUCAO', sub: 'DIAGNOSTICO_GESTACAO', data: D, itens: ids.map((id) => ({ id, resultado: 'POSITIVO', idade: sorteio(rnd, [60, 120, 200]), prevista: null })), estacao: null, metodo: 'PALPACAO', custo: null, touros: [], touro: null, semen: null, fim: null };
    return registrar(s, 'diagnóstico positivo');
  }
  if (em(['diagnosticoDeQuemSaiu', 'saidaAntesDoRegistro'])) {
    const r = sorteio(rnd, vigentesDe(S, 'REPRODUCAO').filter((x) => x.data >= marco && presenca(S, x.animal_id, HOJE).fim));
    if (!r) return preparoDe(sis, S, rnd, k, base, P, 'partoDaPrenhe');
    return saida(r.animal_id, r.data, 'saída da fêmea com registro reprodutivo');
  }
  if (em(['saidaAntesDaPesagem', 'pesagemDeQuemSaiu', 'pesagemForaDaPermanencia', 'importacaoDeQuemSaiu'])) {
    const p = sorteio(rnd, vigentesDe(S, 'PESAGENS').filter((x) => x.data_pesagem >= marco && presenca(S, x.animal_id, HOJE).fim));
    if (!p) return preparoDe(sis, S, rnd, k, base, P, 'dosePorKg');
    return saida(p.animal_id, p.data_pesagem, 'saída de quem tem pesagem');
  }
  if (qual === 'dosePorKg') {
    const D = naFaixa(sorteio(rnd, [HOJE, somaDias(HOJE, -60), somaDias(HOJE, -200)]));
    const ids = animaisPara(S, rnd, D, 3, (id, p) => p.dia).filter((id) => existe(S, id));
    if (!ids.length) return null;
    return registrar({ tipo: 'PESAGEM', data: D, momento: 'ROTINA', metodo: 'BALANCA', jejum: false, itens: itensPesagem(S, rnd, ids, D), lote: null }, 'pesagem');
  }
  // A venda do animal tratado depois do fim da carência (que a correção leva depois para dentro dela).
  if (qual === 'vendaParaCarencia' && rnd() < 0.6) {
    const r = sorteio(rnd, vigentesDe(S, 'SANIDADE').filter((x) => x.data_aplicacao >= marco && x.tipo_procedimento !== 'DOENCA' && presenca(S, x.animal_id, HOJE).fim && existe(S, x.animal_id)));
    if (r) {
      const fim = fimCarenciaDe(r) || somaDias(r.data_aplicacao, 20);
      const spec = { tipo: 'VENDA', data: ateHoje(somaDias(fim, sorteio(rnd, [1, 10, 40]))), ids: [r.animal_id], neg: negocioLimpo(rnd, 1) };
      return registrar(spec, 'venda do animal tratado, depois da carência');
    }
  }
  // A aplicação com carência (a venda na carência e a importação dela partem daqui).
  if (em(['importacaoNaCarencia', 'vendaParaCarencia', 'sanidadeSobreVenda'])) return interacaoDe(sis, S, rnd, k, base, P, 'vendaCarencia');
  return null;
}
function interacaoDe(sis, S, rnd, k, base, P, qual) {
  const registrar = (spec, rotulo) => (spec ? Object.assign(base, { rota: 'evento.registrar', dados: montarDados(sis, spec), spec, rotulo: 'interação: ' + rotulo }) : null);
  const corrigir = (eid, spec, rotulo) => (spec ? Object.assign(base, { rota: 'evento.corrigir', dados: Object.assign(montarDados(sis, spec), { event_id: eid, justificativa: 'Corrigindo o lançamento' }), spec, rotulo: 'interação: ' + rotulo }) : null);
  const specDe = (e) => (sis.specs.has(e.event_id) ? js(sis.specs.get(e.event_id).spec) : specDoGravado(sis, S, rnd, e));
  const animaisDoEvento = (eid) => S.t.EVENTO_ANIMAIS.filter((l) => l.event_id === eid).map((l) => l.animal_id);
  if (qual === 'vendaCarencia') {
    const x = sorteio(rnd, vigentesDe(S, 'SANIDADE').map((r) => ({ r, fim: fimCarenciaDe(r) })).filter((y) => y.fim && y.r.data_aplicacao >= (S.marco || D0)));
    if (!x || rnd() < 0.25) {
      // Ainda sem aplicação com carência (ou às vezes outra): a aplicação com carência, que a venda seguinte encontra.
      const D = ateHoje(somaDias(HOJE, -Math.floor(rnd() * 90)));
      const ids = animaisPara(S, rnd, D, 2, (id, p) => p.fim).filter((id) => existe(S, id));
      if (!ids.length) return null;
      const s = propostaSanidade(sis, S, rnd, sorteio(rnd, ['VERMIFUGACAO', 'MEDICACAO']), D, ids);
      Object.assign(s, { carencia: sorteio(rnd, [30, 45, 60]), protocolo: null, custo: null });
      return registrar(s, 'aplicação com carência');
    }
    const meio = somaDias(x.r.data_aplicacao, Math.floor(diasEntre(x.r.data_aplicacao, x.fim) / 2));
    const D = ateHoje(sorteio(rnd, [x.r.data_aplicacao, meio, x.fim, x.fim, somaDias(x.fim, 1)]));
    // Passada 2: quase sempre o negócio sem erro de propósito (para a venda chegar à carência).
    const spec = { tipo: 'VENDA', data: D, ids: [x.r.animal_id], neg: rnd() < 0.75 ? negocioLimpo(rnd, 1) : negocio(rnd, 1, true) };
    spec.neg.finalidade = rnd() < 0.5 ? 'ABATE' : null;
    return registrar(spec, 'venda na carência' + (spec.neg.finalidade ? ' (abate)' : ''));
  }
  if (qual === 'sanidadeSobreVenda') {
    const l = sorteio(rnd, S.linhas.filter((y) => y.tipo === 'VENDA' && !y.pre));
    if (!l) return null;
    const ent = S.linhasDe(l.animal).filter((y) => y.efeito === 1 && y.data <= l.data).pop();
    const ini = ent ? ent.data : S.marco || D0;
    const dApl = sorteio(rnd, [l.data, diasEntre(ini, l.data) <= 120 ? ini : l.data, somaDias(l.data, -Math.min(Math.max(0, diasEntre(ini, l.data)), 1 + Math.floor(rnd() * 60)))]);
    const s = propostaSanidade(sis, S, rnd, sorteio(rnd, ['VERMIFUGACAO', 'MEDICACAO', 'VACINACAO']), dApl, [l.animal]);
    s.carencia = Math.max(0, diasEntre(dApl, l.data) + sorteio(rnd, [0, 0, 1, 15, -1]));
    return registrar(s, 'aplicação retroativa sobre a venda');
  }
  if (qual === 'importacaoNaCarencia') {
    // O mesmo encontro pela importação: a venda importada de um animal em carência, ou a aplicação importada com carência
    // sobre a venda gravada (o aviso CARENCIA_ATIVA no bloco, com a política na venda para abate).
    const b = (id) => (S.animais.get(id) || {}).brinco;
    if (rnd() < 0.5) {
      const x = sorteio(rnd, vigentesDe(S, 'SANIDADE').map((r) => ({ r, fim: fimCarenciaDe(r) })).filter((y) => y.fim && b(y.r.animal_id) && y.r.data_aplicacao >= (S.marco || D0)));
      if (!x) return null;
      const D = ateHoje(sorteio(rnd, [x.r.data_aplicacao, x.fim, somaDias(x.fim, 1)]));
      const texto = ['grupo;data;comprador;finalidade;modalidade;preco;bruto;brinco;parcelas', ['V1', br(D), 'Frigorífico Boi Bom', rnd() < 0.5 ? 'abate' : 'recria e engorda', 'cabeça', '2.500,00', '2.500,00', b(x.r.animal_id), ''].join(';')].join('\n');
      return Object.assign(base, { rota: 'importacao.criar', dados: { tipo: 'VENDAS', arquivo_nome: 'vendas-carencia-' + k + '.csv', texto, formato: FORMATO }, mapa: { colunas: { grupo: 'grupo', data: 'data', comprador: 'comprador', finalidade: 'finalidade', modalidade: 'modalidade', preco: 'preco', bruto: 'valor_bruto', brinco: 'brinco', parcelas: 'parcelas' }, confiancas: {}, padroes: {} }, rotulo: 'interação: importar a venda de um animal em carência' });
    }
    const l = sorteio(rnd, S.linhas.filter((y) => y.tipo === 'VENDA' && !y.pre && b(y.animal)));
    if (!l) return null;
    const dApl = somaDias(l.data, -sorteio(rnd, [0, 5, 20]));
    const texto = ['data;procedimento;produto;nome;modo;dose;unidade;diagnostico;carencia;proxima;brinco', [br(dApl), 'vermifugação', 'Vermífugo F', '', 'por cabeça', '5', '', '', String(diasEntre(dApl, l.data) + sorteio(rnd, [0, 10, -1])), '', b(l.animal)].join(';')].join('\n');
    return Object.assign(base, { rota: 'importacao.criar', dados: { tipo: 'SANIDADE', arquivo_nome: 'sanidade-venda-' + k + '.csv', texto, formato: FORMATO }, mapa: { colunas: { data: 'data', procedimento: 'procedimento', produto: 'produto', nome: 'nome_produto', modo: 'modo_dose', dose: 'dose_lancamento', unidade: 'unidade', diagnostico: 'diagnostico', carencia: 'carencia', proxima: 'proxima', brinco: 'brinco' }, confiancas: {}, padroes: {} }, rotulo: 'interação: importar a aplicação com carência sobre a venda' });
  }
  if (qual === 'pesagemDeQuemSaiu') {
    const id = sorteio(rnd, MOVEIS(S).filter((x) => { const a = S.animais.get(x); return a.data_saida && SAIDA_DO_REBANHO.indexOf(a.situacao_cadastral) >= 0; }));
    if (!id) return null;
    const sai = S.animais.get(id).data_saida;
    const D = ateHoje(sorteio(rnd, [sai, somaDias(sai, 1), somaDias(sai, 20), somaDias(sai, -1)]));
    const y = rnd();
    if (y < 0.6) return registrar({ tipo: 'PESAGEM', data: D, momento: 'ROTINA', metodo: 'BALANCA', jejum: false, itens: itensPesagem(S, rnd, [id], D), lote: null }, 'pesagem de quem saiu');
    if (y < 0.85) return registrar(propostaSanidade(sis, S, rnd, 'VERMIFUGACAO', D, [id]), 'aplicação em quem saiu');
    return registrar({ tipo: 'OCORRENCIA', data: D, ids: [id], oc: 'OBSERVACAO', desc: 'Visto no curral', custo: null }, 'ocorrência de quem saiu');
  }
  if (qual === 'saidaAntesDaPesagem' || qual === 'saidaAntesDoRegistro') {
    // A venda, a morte ou o descarte levados para antes de um fato do animal (pesagem, ou registro reprodutivo).
    const cand = [];
    S.t.EVENTOS.filter((e) => S.vig.get(e.event_id) && ['VENDA', 'MORTE', 'DESCARTE'].indexOf(e.event_type) >= 0).forEach((e) => {
      const ids = animaisDoEvento(e.event_id);
      const depoisDoMarco = (d) => !S.marco || d > S.marco;
      if (qual === 'saidaAntesDaPesagem') vigentesDe(S, 'PESAGENS').filter((p) => ids.indexOf(p.animal_id) >= 0 && p.data_pesagem <= e.event_date && depoisDoMarco(p.data_pesagem)).forEach((p) => cand.push({ e, data: p.data_pesagem }));
      else vigentesDe(S, 'REPRODUCAO').filter((r) => ids.indexOf(r.animal_id) >= 0 && r.data <= e.event_date && depoisDoMarco(r.data)).forEach((r) => cand.push({ e, data: r.data }));
    });
    const x = sorteio(rnd, cand);
    const spec = x && specDe(x.e);
    if (!spec) return null;
    spec.data = sorteio(rnd, [somaDias(x.data, -1), x.data]);
    return corrigir(x.e.event_id, spec, x.e.event_type.toLowerCase() + (qual === 'saidaAntesDaPesagem' ? ' levada para antes da pesagem' : ' levada para antes do registro reprodutivo'));
  }
  if (qual === 'diagnosticoDeQuemSaiu') {
    const id = sorteio(rnd, MOVEIS(S).filter((x) => fem(S, x) && S.animais.get(x).data_saida && S.animais.get(x).situacao_cadastral !== 'ATIVO'));
    if (!id) return null;
    const sai = S.animais.get(id).data_saida;
    const s = { tipo: 'REPRODUCAO', sub: sorteio(rnd, ['DIAGNOSTICO_GESTACAO', 'DIAGNOSTICO_GESTACAO', 'ABORTO']), data: ateHoje(sorteio(rnd, [sai, somaDias(sai, 1), somaDias(sai, -20), somaDias(sai, 40)])), itens: [{ id }], estacao: null, custo: null };
    preencherReproducao(S, rnd, s);
    return registrar(s, 'diagnóstico de fêmea que saiu');
  }
  if (qual === 'partoDaPrenhe') {
    const id = sorteio(rnd, MOVEIS(S).filter((x) => existe(S, x) && fem(S, x) && S.animais.get(x).situacao_reprodutiva === 'PRENHA'));
    if (!id) return null;
    const dg = ultimoReg(S, id, (r) => r.tipo_evento === 'DIAGNOSTICO_GESTACAO' && r.resultado === 'POSITIVO');
    const gest = paramNum(S, 'dias_gestacao', 290);
    const prev = dg ? dg.data_prevista_parto || somaDias(dg.data, gest - (typeof dg.idade_gestacional_dias === 'number' ? dg.idade_gestacional_dias : 140)) : S.animais.get(id).data_prevista_parto || HOJE;
    const D = ateHoje(sorteio(rnd, dg ? [prev, somaDias(prev, -15), somaDias(dg.data, 10), somaDias(dg.data, -3), dg.data] : [prev, HOJE]));
    const s = tipoDoRegistro('NASCIMENTO').propor({ sis, S, rnd, D, P });
    if (!s) return null;
    Object.assign(s, { mae: id, data: D });
    s.crias.forEach((c) => { if (rnd() < 0.6) c.brinco = null; });
    return registrar(s, 'parto da prenhe');
  }
  if (qual === 'partoCorrigido') {
    const partos = S.t.EVENTOS.filter((e) => S.vig.get(e.event_id) && e.event_type === 'NASCIMENTO');
    const maeDe = (e) => (S.t.EVENTO_ANIMAIS.find((l) => l.event_id === e.event_id && l.papel === 'MATRIZ') || {}).animal_id;
    const comDg = partos.filter((e) => vigentesDe(S, 'REPRODUCAO').some((r) => r.animal_id === maeDe(e) && r.tipo_evento === 'DIAGNOSTICO_GESTACAO'));
    const e = sorteio(rnd, comDg.length && rnd() < 0.85 ? comDg : partos);
    if (!e) return null;
    const y = rnd();
    if (y < 0.15) return Object.assign(base, { rota: 'evento.estornar', dados: { event_id: e.event_id, justificativa: 'Lançado errado' }, rotulo: 'interação: estorno do parto depois do diagnóstico' });
    const spec = specDe(e);
    if (!spec) return null;
    const dgs = vigentesDe(S, 'REPRODUCAO').filter((r) => r.animal_id === spec.mae && r.tipo_evento === 'DIAGNOSTICO_GESTACAO');
    if (y < 0.75 && dgs.length) { const dg = sorteio(rnd, dgs); spec.data = ateHoje(sorteio(rnd, [somaDias(dg.data, -1), dg.data, somaDias(dg.data, 1), somaDias(dg.data, -60), somaDias(dg.data, 150)])); }
    else { const outra = sorteio(rnd, MOVEIS(S).filter((x) => fem(S, x) && x !== spec.mae && presenca(S, x, spec.data).dia)); if (outra) spec.mae = outra; else spec.data = ateHoje(somaDias(spec.data, 30)); }
    return corrigir(e.event_id, spec, 'parto corrigido depois do diagnóstico');
  }
  if (qual === 'aborto') {
    const id = sorteio(rnd, MOVEIS(S).filter((x) => existe(S, x) && fem(S, x) && ['PRENHA', 'INSEMINADA', 'EXPOSTA'].indexOf(S.animais.get(x).situacao_reprodutiva) >= 0));
    if (!id) return null;
    const u = ultimoReg(S, id, () => true);
    const s = { tipo: 'REPRODUCAO', sub: 'ABORTO', data: ateHoje(u ? sorteio(rnd, [somaDias(u.data, 1), somaDias(u.data, 40), u.data, somaDias(u.data, -1)]) : HOJE), itens: [{ id }], estacao: null, custo: null };
    preencherReproducao(S, rnd, s);
    return registrar(s, 'aborto');
  }
  if (qual === 'estornoInsumoConsumido' || qual === 'entradaInsumoMenor') {
    const saidas = vigentesDe(S, 'MOVIMENTOS_ESTOQUE').filter((m) => m.tipo === 'SAIDA');
    const estoques = S.t.EVENTOS.filter((e) => S.vig.get(e.event_id) && e.event_type === 'ESTOQUE' && e.event_subtype === 'ENTRADA');
    const consumidas = estoques.filter((e) => S.t.MOVIMENTOS_ESTOQUE.some((m) => m.event_id === e.event_id && saidas.some((s) => s.product_id === m.product_id)));
    const e = sorteio(rnd, consumidas.length ? consumidas : estoques);
    if (!e) return null;
    if (qual === 'estornoInsumoConsumido' || !sis.specs.has(e.event_id)) return Object.assign(base, { rota: 'evento.estornar', dados: { event_id: e.event_id, justificativa: 'Compra lançada errado' }, rotulo: 'interação: estorno da compra de insumo já consumido' });
    const spec = js(sis.specs.get(e.event_id).spec);
    spec.emb = null;
    spec.qtd = sorteio(rnd, [1, 2.5]);
    if (rnd() < 0.4) spec.data = ateHoje(somaDias(spec.data, 60));
    return corrigir(e.event_id, spec, 'compra de insumo corrigida para menos');
  }
  if (qual === 'desmamaDasCrias') {
    const crias = MOVEIS(S).filter((x) => { const a = S.animais.get(x); return a.situacao_cadastral === 'ATIVO' && a.origem === 'NASCIDO' && a.data_nascimento && !S.linhasDe(x).some((l) => l.tipo === 'DESMAMA'); });
    const ids = alguns(rnd, crias, 3);
    if (!ids.length) return null;
    const nasc = ids.map((x) => S.animais.get(x).data_nascimento).sort().pop();
    const D = ateHoje(sorteio(rnd, [somaDias(nasc, 210), somaDias(nasc, 120), HOJE, somaDias(nasc, 240)]));
    return registrar({ tipo: 'DESMAMA', data: D, itens: ids.map((x) => ({ id: x, peso: rnd() < 0.6 ? sorteio(rnd, [150, 182.5, 210]) : null })), pasto: rnd() < 0.6 ? sorteio(rnd, P) : null, metodo: null }, 'desmama das crias');
  }
  if (qual === 'castracaoDoTouro') {
    const l = sorteio(rnd, S.linhas.filter((y) => y.papel === 'TOURO'));
    const id = l ? l.animal : sorteio(rnd, MOVEIS(S).filter((x) => existe(S, x) && !fem(S, x) && S.animais.get(x).castrado !== true));
    if (!id) return null;
    const D = ateHoje(l ? sorteio(rnd, [l.data, somaDias(l.data, -1), somaDias(l.data, 1)]) : HOJE);
    return registrar({ tipo: 'CASTRACAO', data: D, ids: [id], metodo: 'Burdizzo', custo: null }, 'castração do touro');
  }
  if (qual === 'dosePorKg') {
    const pes = vigentesDe(S, 'PESAGENS');
    const p = sorteio(rnd, pes.filter((q) => !S.marco || q.data_pesagem >= S.marco));
    if (!p) return null;
    const D = ateHoje(sorteio(rnd, [p.data_pesagem, somaDias(p.data_pesagem, 1), somaDias(p.data_pesagem, 200), somaDias(p.data_pesagem, -1)]));
    const mais = animaisPara(S, rnd, D, 2, (id, pr) => pr.dia && pes.some((q) => q.animal_id === id && q.data_pesagem <= D)).filter((id) => id !== p.animal_id && existe(S, id));
    const s = propostaSanidade(sis, S, rnd, sorteio(rnd, ['VERMIFUGACAO', 'MEDICACAO']), D, [p.animal_id].concat(rnd() < 0.6 ? mais : []));
    Object.assign(s, { prod: s.sub === 'VERMIFUGACAO' ? sis.produtos.vermifugo : sis.produtos.antibiotico, nome: null, unidade: null, modo: 'POR_PESO', doseRef: sorteio(rnd, [0.02, 0.01, 0.025, 0.0333]), qtd: null, protocolo: null });
    s.itens.forEach((x) => { x.dose = null; });
    if (rnd() < 0.15) s.itens[0].dose = 7.5;
    return registrar(s, 'dose por kg');
  }
  // ---- Fuzz das Fases 1 a 3, passada 2: as interações novas ----
  const marco = S.marco || D0;
  if (qual === 'vendaParaCarencia') {
    // A venda gravada levada, por correção, para dentro da carência de uma aplicação do animal; ou a aplicação corrigida com a
    // carência que passa a cobrir a venda gravada (o aviso CARENCIA_ATIVA, e a política na venda para abate, na correção).
    const pares = [];
    S.t.EVENTOS.filter((e) => S.vig.get(e.event_id) && e.event_type === 'VENDA' && e.pre_marco_zero !== true).forEach((e) => {
      animaisDoEvento(e.event_id).forEach((id) => vigentesDe(S, 'SANIDADE').filter((r) => r.animal_id === id && r.data_aplicacao >= marco && r.tipo_procedimento !== 'DOENCA').forEach((r) => pares.push({ e, r })));
    });
    const x = sorteio(rnd, pares);
    if (!x) return null;
    const fim = fimCarenciaDe(x.r);
    if (fim && rnd() < 0.5) {
      const spec = specDe(x.e);
      if (!spec) return null;
      spec.data = ateHoje(sorteio(rnd, [x.r.data_aplicacao, fim, somaDias(fim, 1), somaDias(x.r.data_aplicacao, Math.floor(diasEntre(x.r.data_aplicacao, fim) / 2))]));
      if (spec.neg && rnd() < 0.4) spec.neg.finalidade = 'ABATE';
      return corrigir(x.e.event_id, spec, 'venda levada para dentro da carência');
    }
    if (x.r.data_aplicacao > x.e.event_date) return null;
    const spec = specDe(S.ev.get(x.r.event_id));
    if (!spec || spec.tipo !== 'SANIDADE') return null;
    spec.carencia = Math.max(1, diasEntre(x.r.data_aplicacao, x.e.event_date) + sorteio(rnd, [0, 0, 1, 20, -1]));
    return corrigir(x.r.event_id, spec, 'aplicação corrigida com a carência sobre a venda');
  }
  if (qual === 'aplicacaoAcimaDoEstoque') {
    // O consumo acima do saldo do produto com estoque controlado, no registro ou na correção que aumenta a quantidade.
    const p = sorteio(rnd, S.t.PRODUTOS.filter((x) => x.controla_estoque === true && x.ativo !== false));
    if (!p) return null;
    const saldo = typeof p.estoque_atual === 'number' ? p.estoque_atual : 0;
    const qtd = Math.max(0.5, Math.round((Math.max(0, saldo) + sorteio(rnd, [0.5, 10, 0, 100])) * 100) / 100);
    const apls = vigentesDe(S, 'SANIDADE').filter((r) => r.produto_id === p.product_id && sis.specs.has(r.event_id));
    if (apls.length && rnd() < 0.4) {
      const r = sorteio(rnd, apls);
      const spec = js(sis.specs.get(r.event_id).spec);
      if (spec.tipo !== 'SANIDADE' || spec.sub === 'DOENCA') return null;
      Object.assign(spec, { prod: p.product_id, nome: null, unidade: null, modo: 'TOTAL', doseRef: null, qtd });
      spec.itens.forEach((i) => { i.dose = null; });
      return corrigir(r.event_id, spec, 'aplicação corrigida acima do estoque');
    }
    const datas = vigentesDe(S, 'MOVIMENTOS_ESTOQUE').filter((m) => m.product_id === p.product_id).map((m) => m.data).sort();
    const D = ateHoje(sorteio(rnd, datas.length ? [HOJE, datas[0], somaDias(datas[0], -1), datas[datas.length - 1]] : [HOJE]));
    const ids = animaisPara(S, rnd, D, 2, (id, pr) => pr.dia).filter((id) => existe(S, id));
    if (!ids.length) return null;
    const s = propostaSanidade(sis, S, rnd, p.categoria === 'VACINA' ? 'VACINACAO' : p.categoria === 'VERMIFUGO' ? 'VERMIFUGACAO' : 'MEDICACAO', D, ids);
    Object.assign(s, { prod: p.product_id, nome: null, unidade: null, modo: 'TOTAL', doseRef: null, qtd, protocolo: null, lote: null, validade: null });
    s.itens.forEach((i) => { i.dose = null; });
    return registrar(s, 'aplicação acima do estoque');
  }
  if (qual === 'carenciaDoCadastro') {
    // Rodada 3 da revisão da Fase 3 (achado 1): a aplicação com produto do cadastro que tem carência padrão, sem os dias
    // informados (às vezes o 0, "sem carência"), registrada ou importada: o efeito confere a carência gravada.
    const p = sorteio(rnd, S.t.PRODUTOS.filter((x) => x.ativo !== false && typeof x.carencia_padrao_dias === 'number' && x.carencia_padrao_dias > 0));
    if (!p) return null;
    const D = ateHoje(sorteio(rnd, [HOJE, somaDias(HOJE, -20), somaDias(HOJE, -90)]));
    const ids = animaisPara(S, rnd, D, 2, (id, pr) => pr.dia).filter((id) => existe(S, id));
    if (!ids.length || D < (S.marco || HOJE)) return null;
    const s = propostaSanidade(sis, S, rnd, p.categoria === 'VACINA' ? 'VACINACAO' : p.categoria === 'VERMIFUGO' ? 'VERMIFUGACAO' : 'MEDICACAO', D, ids);
    Object.assign(s, { prod: p.product_id, nome: null, unidade: null, modo: 'POR_CABECA', doseRef: 1, qtd: null, protocolo: null, carencia: rnd() < 0.15 ? 0 : null });
    s.itens.forEach((i) => { i.dose = null; });
    return registrar(s, 'aplicação sem os dias de carência, com a carência do cadastro');
  }
  if (qual === 'movimentoDepoisDaContagem') {
    // Rodada 3 da revisão da Fase 3 (achado 16): o movimento do mesmo dia gravado depois de uma contagem (a vacinação da
    // tarde, a perda, a compra que chegou) fica depois dela na ordem do dia (11: a ordem de registro) e é aceito; o efeito e o
    // replay conferem o saldo.
    const conts = vigentesDe(S, 'MOVIMENTOS_ESTOQUE').filter((m) => m.tipo === 'AJUSTE' && ((S.ev.get(m.event_id) || {}).payload_json || {}).motivo_ajuste === 'CONTAGEM');
    const m = sorteio(rnd, conts);
    const p = m && S.t.PRODUTOS.find((x) => x.product_id === m.product_id && x.ativo !== false && x.controla_estoque === true);
    if (!p) return null;
    const x = rnd();
    if (x < 0.45) {
      const ids = animaisPara(S, rnd, m.data, 2, (id, pr) => pr.dia).filter((id) => existe(S, id));
      if (!ids.length) return null;
      const s = propostaSanidade(sis, S, rnd, p.categoria === 'VACINA' ? 'VACINACAO' : p.categoria === 'VERMIFUGO' ? 'VERMIFUGACAO' : 'MEDICACAO', m.data, ids);
      Object.assign(s, { prod: p.product_id, nome: null, unidade: null, modo: 'POR_CABECA', doseRef: 1, qtd: null, protocolo: null, lote: null, validade: null });
      s.itens.forEach((i) => { i.dose = null; });
      return registrar(s, 'aplicação no dia da contagem, depois dela');
    }
    const s = { tipo: 'ESTOQUE', sub: x < 0.75 ? 'AJUSTE' : 'ENTRADA', data: m.data, prod: p.product_id };
    preencherEstoque(S, rnd, s);
    if (s.sub === 'AJUSTE') Object.assign(s, { motivo: 'PERDA', contado: null, qtd: sorteio(rnd, [1, 2]) });
    else Object.assign(s, { emb: null, qtd: sorteio(rnd, [5, 20]) });
    return registrar(s, (s.sub === 'AJUSTE' ? 'perda' : 'compra') + ' no dia da contagem, depois dela');
  }
  if (qual === 'acertoRetroativo') {
    // O acerto de estoque (contagem ou perda) datado antes de saídas já gravadas: o saldo dos dias seguintes muda com ele.
    const p = sorteio(rnd, S.t.PRODUTOS.filter((x) => x.controla_estoque === true && x.ativo !== false));
    const m = p && sorteio(rnd, vigentesDe(S, 'MOVIMENTOS_ESTOQUE').filter((y) => y.product_id === p.product_id));
    if (!m) return null;
    const s = { tipo: 'ESTOQUE', sub: 'AJUSTE', data: ateHoje(sorteio(rnd, [m.data, somaDias(m.data, -1), somaDias(m.data, 1)])), prod: p.product_id };
    preencherEstoque(S, rnd, s);
    if (rnd() < 0.6) Object.assign(s, { motivo: 'CONTAGEM', contado: sorteio(rnd, [0, 1, 5]), qtd: null });
    else Object.assign(s, { motivo: sorteio(rnd, ['PERDA', 'VENCIMENTO']), contado: null, qtd: sorteio(rnd, [5, 50]) });
    return registrar(s, 'acerto de estoque antes de saídas gravadas');
  }
  if (qual === 'partoDaVazia') {
    // O parto da fêmea que não está prenhe (vazia pelo diagnóstico, exposta, inseminada), antes e depois do último registro.
    const id = sorteio(rnd, MOVEIS(S).filter((x) => existe(S, x) && fem(S, x) && ['VAZIA', 'EXPOSTA', 'INSEMINADA'].indexOf(S.animais.get(x).situacao_reprodutiva) >= 0 && presenca(S, x, HOJE).fim));
    if (!id) return null;
    const u = ultimoReg(S, id, () => true);
    const D = ateHoje(u ? sorteio(rnd, [somaDias(u.data, 1), somaDias(u.data, 280), u.data, somaDias(u.data, -1), somaDias(u.data, 30)]) : HOJE);
    const s = tipoDoRegistro('NASCIMENTO').propor({ sis, S, rnd, D, P });
    if (!s) return null;
    Object.assign(s, { mae: id, data: D });
    s.crias.forEach((c) => { if (rnd() < 0.6) c.brinco = null; });
    return registrar(s, 'parto da fêmea que não estava prenhe');
  }
  if (qual === 'depoisDoParto') {
    // O diagnóstico, o aborto, a exposição ou a inseminação da mãe em volta do parto (o registro novo, ou o registro dela
    // levado por correção para perto do parto): a gestação que o parto encerrou (PARTO_NA_GESTACAO) e a situação depois.
    const e = sorteio(rnd, S.t.EVENTOS.filter((x) => S.vig.get(x.event_id) && x.event_type === 'NASCIMENTO' && x.pre_marco_zero !== true));
    const mae = e && (S.t.EVENTO_ANIMAIS.find((l) => l.event_id === e.event_id && l.papel === 'MATRIZ') || {}).animal_id;
    if (!mae) return null;
    const D = ateHoje(sorteio(rnd, [somaDias(e.event_date, -1), e.event_date, somaDias(e.event_date, 1), somaDias(e.event_date, 20), somaDias(e.event_date, -60)]));
    const regs = vigentesDe(S, 'REPRODUCAO').filter((r) => r.animal_id === mae && sis.specs.has(r.event_id) && r.tipo_evento !== 'DESMAMA');
    if (regs.length && rnd() < 0.4) {
      const r = sorteio(rnd, regs);
      const spec = js(sis.specs.get(r.event_id).spec);
      if (spec.tipo !== 'REPRODUCAO') return null;
      spec.data = D;
      return corrigir(r.event_id, spec, 'registro reprodutivo levado para perto do parto');
    }
    const sub = sorteio(rnd, ['DIAGNOSTICO_GESTACAO', 'DIAGNOSTICO_GESTACAO', 'ABORTO', 'EXPOSICAO', 'INSEMINACAO']);
    const s = { tipo: 'REPRODUCAO', sub, data: D, itens: [{ id: mae }], estacao: null, custo: null };
    preencherReproducao(S, rnd, s);
    if (sub === 'DIAGNOSTICO_GESTACAO' && rnd() < 0.6) Object.assign(s.itens[0], { resultado: 'POSITIVO', idade: sorteio(rnd, [30, 120, 250]), prevista: null });
    return registrar(s, 'registro da mãe em volta do parto (' + sub.toLowerCase() + ')');
  }
  if (qual === 'desmamaEVenda') {
    // A cria ao pé e a desmama com as saídas: a venda (ou a morte) da mãe com a cria ao pé, a saída da cria desmamada, a
    // desmama corrigida para depois da saída da cria e o estorno da desmama da cria que já saiu.
    const y = rnd();
    if (y < 0.35) {
      const id = sorteio(rnd, MOVEIS(S).filter((x) => existe(S, x) && fem(S, x) && S.animais.get(x).cria_ao_pe === true && presenca(S, x, HOJE).fim));
      if (!id) return null;
      const filhos = MOVEIS(S).filter((c) => S.animais.get(c).mae_id === id && S.animais.get(c).data_nascimento && presenca(S, c, HOJE).fim);
      const nasc = filhos.map((c) => S.animais.get(c).data_nascimento).sort().pop() || HOJE;
      const tipo = sorteio(rnd, ['VENDA', 'VENDA', 'MORTE']);
      const spec = { tipo, data: ateHoje(sorteio(rnd, [nasc, somaDias(nasc, 30), HOJE])), ids: [id].concat(tipo === 'VENDA' && rnd() < 0.4 ? filhos.slice(0, 1) : []) };
      if (tipo === 'VENDA') spec.neg = negocioLimpo(rnd, spec.ids.length);
      return registrar(spec, (tipo === 'VENDA' ? 'venda' : 'morte') + ' da mãe com a cria ao pé');
    }
    const e = sorteio(rnd, S.t.EVENTOS.filter((x) => S.vig.get(x.event_id) && x.event_type === 'DESMAMA'));
    if (!e) return null;
    const crias = S.t.EVENTO_ANIMAIS.filter((l) => l.event_id === e.event_id && l.papel === 'SUJEITO').map((l) => l.animal_id);
    const saiu = crias.filter((x) => S.animais.get(x).data_saida && SAIDA_DO_REBANHO.indexOf(S.animais.get(x).situacao_cadastral) >= 0);
    if (saiu.length && y < 0.55) return Object.assign(base, { rota: 'evento.estornar', dados: { event_id: e.event_id, justificativa: 'Desmama lançada errado' }, rotulo: 'interação: estorno da desmama da cria que saiu' });
    if (saiu.length && y < 0.75) {
      const spec = specDe(e);
      if (!spec) return null;
      const sai = S.animais.get(saiu[0]).data_saida;
      spec.data = ateHoje(sorteio(rnd, [sai, somaDias(sai, 1)]));
      return corrigir(e.event_id, spec, 'desmama corrigida para depois da saída da cria');
    }
    const id = sorteio(rnd, crias.filter((x) => presenca(S, x, HOJE).fim));
    if (!id) return null;
    const spec = { tipo: sorteio(rnd, ['VENDA', 'VENDA', 'MORTE']), data: ateHoje(sorteio(rnd, [e.event_date, somaDias(e.event_date, 1), somaDias(e.event_date, -1), HOJE])), ids: [id] };
    if (spec.tipo === 'VENDA') spec.neg = negocioLimpo(rnd, 1);
    return registrar(spec, 'saída da cria desmamada');
  }
  if (qual === 'pesagemForaDaPermanencia') {
    // A pesagem gravada levada, por correção, para o dia da saída do animal, para depois dela ou para antes da entrada.
    const p = sorteio(rnd, vigentesDe(S, 'PESAGENS').filter((x) => sis.specs.has(x.event_id) && (S.ev.get(x.event_id) || {}).event_type === 'PESAGEM'));
    if (!p) return null;
    const a = S.animais.get(p.animal_id) || {};
    const ent = S.linhasDe(p.animal_id).filter((l) => l.efeito === 1).map((l) => l.data);
    const opcoes = (a.data_saida ? [a.data_saida, somaDias(a.data_saida, 1), somaDias(a.data_saida, 15)] : []).concat(ent.length ? [somaDias(ent[0], -1), ent[0]] : []);
    if (!opcoes.length) return null;
    const spec = js(sis.specs.get(p.event_id).spec);
    spec.data = ateHoje(sorteio(rnd, opcoes));
    return corrigir(p.event_id, spec, 'pesagem levada para fora da permanência');
  }
  if (qual === 'importacaoDeQuemSaiu') {
    // A importação de manejo de quem já saiu (no dia da saída, depois, na véspera): o brinco é o que estava no animal na data.
    const id = sorteio(rnd, MOVEIS(S).filter((x) => { const a = S.animais.get(x); return a.brinco && a.data_saida && SAIDA_DO_REBANHO.indexOf(a.situacao_cadastral) >= 0; }));
    if (!id) return null;
    const a = S.animais.get(id);
    const d = ateHoje(sorteio(rnd, [a.data_saida, somaDias(a.data_saida, 1), somaDias(a.data_saida, 10), somaDias(a.data_saida, -1)]));
    const tipo = fem(S, id) && rnd() < 0.35 ? 'REPRODUCAO' : sorteio(rnd, ['PESAGENS', 'OCORRENCIAS', 'SANIDADE']);
    const arq = {
      PESAGENS: [['grupo;data;brinco;peso', ['', br(d), a.brinco, dec(pesoPara(S, rnd, id, d))].join(';')], { grupo: 'grupo', data: 'data', brinco: 'brinco', peso: 'peso' }, { momento: 'ROTINA', metodo: 'BALANCA' }],
      OCORRENCIAS: [['data;tipo;descricao;brinco', [br(d), 'Observação geral', 'Visto no curral', a.brinco].join(';')], { data: 'data', tipo: 'tipo_ocorrencia', descricao: 'descricao', brinco: 'brinco' }, {}],
      SANIDADE: [['data;procedimento;produto;nome;modo;dose;unidade;diagnostico;carencia;proxima;brinco', [br(d), 'vermifugação', '', 'Ivermectina 1%', 'por cabeça', '5', 'mL', '', '', '', a.brinco].join(';')], { data: 'data', procedimento: 'procedimento', produto: 'produto', nome: 'nome_produto', modo: 'modo_dose', dose: 'dose_lancamento', unidade: 'unidade', diagnostico: 'diagnostico', carencia: 'carencia', proxima: 'proxima', brinco: 'brinco' }, {}],
      REPRODUCAO: [['data;registro;estacao;touro;brinco;resultado', [br(d), 'diagnóstico', '', '', a.brinco, sorteio(rnd, ['positivo', 'vazia'])].join(';')], { data: 'data', registro: 'registro', estacao: 'estacao', touro: 'touro', brinco: 'brinco', resultado: 'resultado' }, {}],
    }[tipo];
    return Object.assign(base, { rota: 'importacao.criar', dados: { tipo, arquivo_nome: tipo.toLowerCase() + '-quem-saiu-' + k + '.csv', texto: arq[0].join('\n'), formato: FORMATO }, mapa: { colunas: arq[1], confiancas: {}, padroes: arq[2] }, rotulo: 'interação: importar o manejo de quem saiu (' + tipo + ')' });
  }
  if (qual === 'estacaoMudada') {
    // A estação com registros: as datas mudadas no cadastro (os registros ficam com a estação deles) e a correção de um
    // registro dela fora das datas novas (a estação que o original usava vale na correção).
    const r = sorteio(rnd, vigentesDe(S, 'REPRODUCAO').filter((x) => x.estacao_id));
    const est = r && (S.t.ESTACOES_MONTA || []).find((e) => e.estacao_id === r.estacao_id);
    if (!est) return null;
    if (rnd() < 0.5) {
      const ini = somaDias(r.data, sorteio(rnd, [1, 30, -400]));
      const campos = rnd() < 0.6 ? { data_inicio: ini, data_fim: somaDias(ini, 90) } : { data_fim: somaDias(est.data_inicio, sorteio(rnd, [0, 10])) };
      return Object.assign(base, { rota: 'estacao.salvar', dados: { estacao_id: est.estacao_id, campos, justificativa: 'Datas da estação revistas' }, rotulo: 'interação: datas da estação mudadas com registros' });
    }
    const spec = specDe(S.ev.get(r.event_id));
    if (!spec || spec.tipo !== 'REPRODUCAO') return null;
    if (rnd() < 0.6) spec.data = ateHoje(sorteio(rnd, [somaDias(est.data_fim, 1), somaDias(est.data_inicio, -1), spec.data]));
    else spec.custo = { valor: 1234, vezes: null };
    return corrigir(r.event_id, spec, 'registro da estação corrigido fora das datas dela');
  }
  // A reprodução dentro (e na borda) da estação de monta; o diagnóstico das expostas nela.
  const est = sorteio(rnd, S.t.ESTACOES_MONTA || []);
  if (!est) return null;
  let sub = sorteio(rnd, ['EXPOSICAO', 'EXPOSICAO', 'COBERTURA', 'INSEMINACAO', 'DIAGNOSTICO_GESTACAO', 'DIAGNOSTICO_GESTACAO']);
  let D;
  let ids = [];
  if (sub === 'DIAGNOSTICO_GESTACAO') {
    D = ateHoje(somaDias(est.data_inicio, sorteio(rnd, [30, 60, 120, 200, -1])));
    const expostas = vigentesDe(S, 'REPRODUCAO').filter((r) => r.estacao_id === est.estacao_id && r.tipo_evento !== 'DIAGNOSTICO_GESTACAO').map((r) => r.animal_id);
    ids = alguns(rnd, expostas.filter((x, i, a) => a.indexOf(x) === i && presenca(S, x, D).dia), 4);
    // Passada 2: sem exposta para diagnosticar, a exposição na estação (o diagnóstico vem depois).
    if (!ids.length) sub = 'EXPOSICAO';
  }
  if (sub !== 'DIAGNOSTICO_GESTACAO') {
    const dur = Math.max(0, diasEntre(est.data_inicio, est.data_fim));
    D = ateHoje(somaDias(est.data_inicio, sorteio(rnd, [0, Math.floor(dur / 2), dur, dur + 1])));
    ids = femeasDoDia(S, rnd, D, 4);
  }
  if (!ids.length) return null;
  const s = { tipo: 'REPRODUCAO', sub, data: D, itens: ids.map((x) => ({ id: x })), estacao: est.estacao_id, custo: null };
  preencherReproducao(S, rnd, s);
  return registrar(s, 'reprodução na estação (' + sub.toLowerCase() + ')');
}

// ------------------------------------------------------------------ oráculos novos da passada 1 (Fases 1 a 3) ----
/**
 * A conferência da chave do bloco (Cliente.verificar → `operacao.status`): consulta, nada gravado; a situação é a do que
 * este sistema gravou com a chave (CONFIRMADA com o mesmo evento, ou INEXISTENTE).
 */
function executarStatus(sis, cmd, antesT, A, dv0, opcoes) {
  const falhas = [];
  const chave = (cmd.dados || {}).chave;
  let r;
  try { r = sis.api('operacao.status', { chave }); } catch (e) { return { falhas: [falha('EXCECAO', String(e && e.stack || e).slice(0, 1500))], r: null }; }
  const depoisT = tabelas(sis);
  const S = estado(depoisT);
  if (!r.ok) falhas.push(falha('STATUS', 'a conferência da chave foi recusada: ' + JSON.stringify(r.error).slice(0, 400)));
  else {
    const gravado = sis.chavesGravadas.get(chave);
    const esperado = gravado ? 'CONFIRMADA' : 'INEXISTENTE';
    contar('chave conferida ' + esperado);
    if (r.data.situacao !== esperado) falhas.push(falha('STATUS', 'a chave ' + chave + ' está ' + r.data.situacao + ', esperado ' + esperado));
    else if (gravado && (r.data.resumo || {}).event_id !== gravado) falhas.push(falha('STATUS', 'a chave ' + chave + ' aponta o evento ' + (r.data.resumo || {}).event_id + ', gravado ' + gravado));
  }
  if (sis.versao() !== dv0 || JSON.stringify(contagens(depoisT)) !== JSON.stringify(contagens(antesT))) falhas.push(falha('STATUS', 'a conferência da chave gravou'));
  if (!(opcoes || {}).semGlobal) falhas.push(...oraculoGlobal(sis, S, []));
  return { falhas, r, depoisT, S };
}

/** Vigente, ou de uma importação ainda em curso (o bloco importado grava antes da conclusão: o aviso é pedido nele). */
function vigenciaComImportacao(S) {
  const imp = (S.t.IMPORTACOES || []).filter((i) => i.status === 'IMPORTANDO').map((i) => i.import_id);
  return (eid) => {
    if (S.vig.get(eid)) return true;
    const e = S.ev.get(eid);
    return !!e && !!e.import_id && imp.indexOf(e.import_id) >= 0 && S.op.get(e.op_id) === 'CONFIRMADA' && e.event_type !== 'ESTORNO' && !S.anuladoPor.has(eid);
  };
}
/** O menor saldo ao fim de cada dia com movimento (03a, 4.7; RN-057), em décimos de milésimo: {saldo, data}. */
function menorSaldoDe(movs) {
  const porDia = new Map();
  movs.forEach((m) => porDia.set(m.data, (porDia.get(m.data) || 0) + Math.round(m.quantidade * 10000) * (m.tipo === 'SAIDA' ? -1 : 1)));
  let corrente = 0;
  let menor = { saldo: 0, data: null };
  Array.from(porDia.keys()).sort().forEach((d) => { corrente += porDia.get(d); if (corrente < menor.saldo) menor = { saldo: corrente, data: d }; });
  return menor;
}
/** As vendas em carência: venda vigente × aplicação vigente do animal cuja carência cobre a data da venda (RN-072). */
function paresCarencia(S, vale) {
  const out = new Map();
  const sans = (S.t.SANIDADE || []).filter((r) => vale(r.event_id));
  (S.t.VENDAS || []).forEach((v) => {
    if (!vale(v.event_id)) return;
    const E = S.ev.get(v.event_id);
    if (!E || E.pre_marco_zero === true) return;
    S.t.EVENTO_ANIMAIS.filter((l) => l.event_id === v.event_id).forEach((l) => {
      sans.forEach((r) => {
        const fim = fimCarenciaDe(r);
        if (r.animal_id !== l.animal_id || !fim || r.data_aplicacao > E.event_date || fim < E.event_date) return;
        out.set(v.event_id + '|' + l.animal_id + '|' + r.health_id, { abate: v.finalidade === 'ABATE', animal: l.animal_id, venda: E.event_date, fim });
      });
    });
  });
  return out;
}
/**
 * Os avisos que dependem do estado de antes e de depois valem em todo caminho (registro, correção, estorno, bloco
 * importado, desfazer): o estoque controlado que fica abaixo de zero em alguma data, mais baixo que antes
 * (ESTOQUE_INSUFICIENTE, RN-057, com a política), e a venda que passa a estar dentro da carência de uma aplicação
 * (CARENCIA_ATIVA, RN-072: na venda para abate, a política; nas demais, sempre o aviso). O comando aceito que cria a
 * situação passou pela confirmação (o pedido de NEEDS_CONFIRMATION, ou o aceite gravado no lançamento ou na operação) ou,
 * com BLOQUEIA, não podia ser aceito.
 */
function oraculoAvisosDeTransicao(cmd, A, S, pedidos) {
  if (!/^(evento\.(registrar|corrigir|estornar)|importacao\.(importarBloco|desfazer))$/.test(cmd.rota)) return [];
  const pol = politicaDe(A);
  const aceitos = new Set(pedidos);
  S.t.EVENTOS.forEach((e) => { if (!A.ev.has(e.event_id)) ((e.payload_json || {}).avisos_aceitos || []).forEach((a) => aceitos.add(a.codigo)); });
  const opsA = new Set(A.t.OPERACOES.map((o) => o.op_id));
  S.t.OPERACOES.forEach((o) => { if (!opsA.has(o.op_id)) (((o.resumo_json || {}).avisos_aceitos) || []).forEach((a) => aceitos.add(a.codigo)); });
  const out = [];
  const valeA = vigenciaComImportacao(A);
  const valeS = vigenciaComImportacao(S);
  // Estoque (o controle como estava antes do comando: ligar e desligar é cadastro, não passa por aqui).
  const polE = pol.ESTOQUE_INSUFICIENTE || 'AVISA';
  (A.t.PRODUTOS || []).forEach((p) => {
    if (p.controla_estoque !== true) return;
    const a = menorSaldoDe(A.t.MOVIMENTOS_ESTOQUE.filter((m) => m.product_id === p.product_id && valeA(m.event_id)));
    const d = menorSaldoDe(S.t.MOVIMENTOS_ESTOQUE.filter((m) => m.product_id === p.product_id && valeS(m.event_id)));
    if (!(d.saldo < 0 && d.saldo < a.saldo)) return;
    contar('estoque abaixo de zero pelo comando');
    const q = p.nome + ' ficou em ' + d.saldo / 10000 + ' em ' + d.data + ' (antes, o menor saldo era ' + a.saldo / 10000 + ')';
    if (polE === 'BLOQUEIA') out.push(falha('AVISO:ESTOQUE_BLOQUEIA', cmd.rota + ' aceito com a política BLOQUEIA: ' + q));
    else if (polE === 'AVISA' && !aceitos.has('ESTOQUE_INSUFICIENTE')) out.push(falha('AVISO:ESTOQUE_SEM_AVISO', cmd.rota + ' aceito sem o aviso ESTOQUE_INSUFICIENTE: ' + q));
  });
  // Carência × venda.
  const antes = paresCarencia(A, valeA);
  const polC = pol.CARENCIA_ATIVA || 'AVISA';
  paresCarencia(S, valeS).forEach((x, chave) => {
    if (antes.has(chave)) return;
    contar('venda que entrou na carência');
    const q = (S.animais.get(x.animal) || {}).codigo_interno + ' vendido em ' + x.venda + (x.abate ? ' para abate' : '') + ', em carência até ' + x.fim;
    if (x.abate && polC === 'BLOQUEIA') out.push(falha('AVISO:CARENCIA_BLOQUEIA', cmd.rota + ' aceito com a política BLOQUEIA da carência: ' + q));
    else if ((!x.abate || polC === 'AVISA') && !aceitos.has('CARENCIA_ATIVA')) out.push(falha('AVISO:CARENCIA_SEM_AVISO', cmd.rota + ' aceito sem o aviso CARENCIA_ATIVA: ' + q));
  });
  return out;
}

/** Meses completos de idade (o nascido em 31/01 completa 1 mês em 01/03). */
function mesesDe(nasc, d) {
  const [y1, m1, d1] = nasc.split('-').map(Number);
  const [y2, m2, d2] = d.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}
/** O primeiro dia em que o animal tem `m` meses completos. */
function completaMesesEm(nasc, m) {
  let d = somaDias(nasc, Math.max(0, m * 28 - 3));
  while (mesesDe(nasc, d) < m) d = somaDias(d, 1);
  return d;
}
/**
 * A agenda sanitária em D (05, RN-058 e RN-059; 03a, 4.9; 03b, seção 6) por um modelo escrito aqui, sobre as linhas cruas:
 * os animais no rebanho ao fim de D; por protocolo ativo de recorrência por intervalo ou de aplicação única, sem categoria
 * (as de campanha e as por categoria ficam de fora do modelo), a elegibilidade (sexo, faixa de idade) e o vencimento (a
 * próxima gravada na última aplicação do protocolo — a última pela data e pela posição na cadeia —, senão a última +
 * intervalo; nunca aplicado: o dia em que ficou elegível; aplicação única: ao completar a idade máxima, a mínima ou a
 * entrada; devendo, vencida até a aplicação); sem protocolo, a próxima informada na última aplicação do produto; e a
 * carência de cada animal (o maior fim, ≥ D, das aplicações até D).
 */
function modeloAgenda(S, D, cats) {
  const ant = paramNum(S, 'agenda_antecedencia_dias', 15);
  const protos = (S.t.PROTOCOLOS_SANITARIOS || []).filter((p) => p.ativo !== false);
  // Passada 2: também a campanha (os meses do ano; a perdida devida até abrir a janela da seguinte).
  // Revisão final da Fase 3 (achado 1): também os protocolos restritos a uma categoria, com a categoria de cada animal em D e
  // desde quando ele está nela (`cats`, categoriasNaData: a categoria vem do sistema; o trecho, andando dia a dia para trás).
  const modelados = new Set(protos.filter((p) => (!p.category_id || cats) && ['INTERVALO_DIAS', 'UNICA', 'CAMPANHA_MESES'].indexOf(p.recorrencia_tipo) >= 0).map((p) => p.protocol_id));
  const sans = vigentesDe(S, 'SANIDADE').map((r) => { const e = S.ev.get(r.event_id); return { r, data: r.data_aplicacao, raiz: S.raiz(e), seq: e.event_seq }; });
  const pend = [];
  const car = [];
  const situacao = (venc, cumprida, ante) => (cumprida || !venc ? 'EM_DIA' : D > venc ? 'VENCIDA' : diasEntre(D, venc) <= ante ? 'PROXIMA' : 'EM_DIA');
  S.animais.forEach((a, id) => {
    if (a.situacao_cadastral === 'EXTERNO' || !presenca(S, id, D).fim) return;
    const desde = (S.linhasDe(id).filter((l) => l.efeito === 1 && l.data <= D).pop() || {}).data || null;
    const apls = sans.filter((x) => x.r.animal_id === id && x.data <= D);
    protos.forEach((p) => {
      if (!modelados.has(p.protocol_id)) return;
      // Rodada 2 da revisão da Fase 3 (achado 10): numa data passada, só o protocolo que já valia nela (o cadastro ou a
      // primeira aplicação com ele, se antes). O INTERVALO_DIAS nunca aplicado segue vencendo desde que o animal ficou
      // elegível (03a, seção 4.9).
      const primeira = sans.filter((x) => x.r.protocol_id === p.protocol_id).map((x) => x.data).sort()[0] || null;
      // Rodada 3 (achados 21 e 23): o dia do cadastro no fuso da fazenda, não o dia UTC do created_at.
      const inicio = [p.created_at ? diaNoFuso(p.created_at) : null, primeira].filter(Boolean).sort()[0] || null;
      if (inicio && inicio > D) return;
      if (p.sexo_aplicavel !== 'AMBOS' && p.sexo_aplicavel !== a.sexo) return;
      // A categoria em D (05, seção 4.7) e o dia em que o animal entrou nela, que conta como o dia em que se tornou elegível.
      let naCat = null;
      if (p.category_id) {
        const c = cats.get(id);
        if (!c || c.cat !== p.category_id) return;
        naCat = c.desde;
        contar('agenda: protocolo por categoria conferido');
        if (naCat && desde && naCat > desde) contar('agenda: animal que entrou na categoria depois de entrar no rebanho');
      }
      const min = typeof p.idade_min_meses === 'number' ? p.idade_min_meses : null;
      const max = typeof p.idade_max_meses === 'number' ? p.idade_max_meses : null;
      const nasc = a.data_nascimento || null;
      let devendo = false;
      if (min !== null || max !== null) {
        if (!nasc || nasc > D) return;
        const idade = mesesDe(nasc, D);
        if (min !== null && idade < min) return;
        if (max !== null && idade >= max) {
          if (p.recorrencia_tipo !== 'UNICA') return;
          const comeco = [min !== null ? completaMesesEm(nasc, min) : nasc, desde, inicio, naCat].filter(Boolean).sort().pop();
          if (!(comeco && comeco < completaMesesEm(nasc, max))) return;
          devendo = true;
        }
      }
      const doProt = apls.filter((x) => x.r.protocol_id === p.protocol_id);
      let venc;
      let cumprida;
      if (p.recorrencia_tipo === 'UNICA') {
        venc = max !== null && nasc ? completaMesesEm(nasc, max) : min !== null && nasc ? [completaMesesEm(nasc, min), naCat].filter(Boolean).sort().pop() : [desde, naCat].filter(Boolean).sort().pop() || D;
        cumprida = doProt.length > 0;
      } else if (p.recorrencia_tipo === 'CAMPANHA_MESES') {
        // A campanha de cada mês vence no último dia dele e é cumprida pela aplicação entre o primeiro dia − tolerância e o
        // último + tolerância; a última campanha vencida desde que o animal ficou elegível (e desde o cadastro do protocolo),
        // não cumprida, continua devida até abrir a janela da seguinte; depois, vale a seguinte.
        const meses = (Array.isArray(p.meses_campanha) ? p.meses_campanha : []).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
        if (!meses.length) { venc = null; cumprida = true; } else {
          const tol = typeof p.tolerancia_dias === 'number' ? p.tolerancia_dias : paramNum(S, 'agenda_tolerancia_dias', 7);
          const ano = Number(D.slice(0, 4));
          const dois = (n) => (n < 10 ? '0' : '') + n;
          const camps = [];
          [ano - 1, ano, ano + 1].forEach((y) => meses.forEach((m) => camps.push({ ini: y + '-' + dois(m) + '-01', fim: somaDias(m === 12 ? (y + 1) + '-01-01' : y + '-' + dois(m + 1) + '-01', -1) })));
          camps.sort((a, b) => cmp(a.fim, b.fim));
          const cumpre = (c) => doProt.some((x) => x.data >= somaDias(c.ini, -tol) && x.data <= somaDias(c.fim, tol));
          const elegivel = [desde, min !== null && nasc ? completaMesesEm(nasc, min) : null, naCat].filter(Boolean).sort().pop() || desde || D;
          const de = [elegivel, inicio].filter(Boolean).sort().pop();
          const passada = camps.filter((c) => c.fim < D && (!de || c.fim >= de)).pop() || null;
          const proxima = camps.filter((c) => c.fim >= D)[0];
          if (passada && !cumpre(passada) && D < somaDias(proxima.ini, -tol)) { venc = passada.fim; cumprida = false; } else { venc = proxima.fim; cumprida = cumpre(proxima); }
          contar('campanha da agenda conferida');
        }
      } else if (!doProt.length) {
        venc = [desde, min !== null && nasc ? completaMesesEm(nasc, min) : null, naCat].filter(Boolean).sort().pop() || desde || D;
        cumprida = false;
      } else {
        const u = ultimo(doProt).r;
        venc = u.data_proxima_aplicacao || (typeof p.intervalo_dias === 'number' ? somaDias(u.data_aplicacao, p.intervalo_dias) : null);
        cumprida = venc === null;
      }
      const sit = devendo && !cumprida ? 'VENCIDA' : situacao(venc, cumprida, typeof p.antecedencia_alerta_dias === 'number' ? p.antecedencia_alerta_dias : ant);
      if (sit !== 'EM_DIA') pend.push([id, p.protocol_id, p.product_id || '', venc, sit].join('|'));
    });
    // Sem protocolo: a próxima dose da última aplicação de cada produto do cadastro — a última de qualquer lançamento do
    // produto, com ou sem protocolo (revisão da Fase 3: a aplicação com protocolo cumpre a pendência sem protocolo).
    const porProduto = new Map();
    apls.forEach((x) => { if (x.r.produto_id) (porProduto.get(x.r.produto_id) || porProduto.set(x.r.produto_id, []).get(x.r.produto_id)).push(x); });
    porProduto.forEach((l, pid) => {
      const u = ultimo(l).r;
      if (u.protocol_id) contar('pendência sem protocolo cumprida por aplicação com protocolo');
      if (u.protocol_id || !u.data_proxima_aplicacao) return;
      const sit = situacao(u.data_proxima_aplicacao, false, ant);
      if (sit !== 'EM_DIA') pend.push([id, '', pid, u.data_proxima_aplicacao, sit].join('|'));
    });
    let fim = null;
    apls.forEach((x) => { const f = fimCarenciaDe(x.r); if (f && f >= D && (!fim || f > fim)) fim = f; });
    if (fim) car.push(id + '|' + fim);
  });
  return { modelados, pend: pend.sort(), car: car.sort() };
}
/**
 * O ganho médio diário de cada animal (03b, seção 5; RN-052; o indicador zootécnico da pesagem), por um modelo escrito
 * aqui: as pesagens vigentes individuais (balança; fita só com `gmd_aceita_fita`), uma por dia (a de depois na posição),
 * em ordem; entre duas consecutivas, ganho com uma casa, dias e GMD = ganho ÷ dias com três casas, só com as duas na
 * mesma permanência no rebanho e com o intervalo mínimo (`gmd_intervalo_min_dias`), senão vazio. Os intervalos de
 * `peso.desempenho` (curvas) dos animais do comando e dos mais pesados = o modelo.
 */
/** As pesagens individuais vigentes do animal (balança; fita só com `gmd_aceita_fita`). */
function pesagensIndividuais(S, id) {
  const fita = S.config.get('gmd_aceita_fita') === 'S' || S.config.get('gmd_aceita_fita') === true;
  return (S.t.PESAGENS || []).filter((p) => p.animal_id === id && S.vig.get(p.event_id) && typeof p.peso_kg === 'number' && (p.metodo === 'BALANCA' || (fita && p.metodo === 'FITA')));
}
/**
 * O modelo dos intervalos de GMD do animal: as individuais, a última de cada dia (pela data e pela posição na cadeia), e
 * entre duas consecutivas {a, b (as pesagens), ganho, nd, gmd} — o GMD só na mesma permanência e com o intervalo mínimo.
 */
function intervalosModelo(S, id) {
  const min = paramNum(S, 'gmd_intervalo_min_dias', 28);
  const r1 = (x, c) => { const f = Math.pow(10, c); const v = Math.round(Number((Math.abs(x) * f).toFixed(6))) / f; return x < 0 && v !== 0 ? -v : v; };
  // Permanências pelas linhas do rebanho (as de antes do marco zero ficam fora).
  const per = [];
  S.linhasDe(id).filter((l) => !DE_FATO(l)).forEach((l) => { if (l.efeito === 1) per.push({ ini: l.data, fim: null }); else if (l.efeito === -1 && per.length) per[per.length - 1].fim = l.data; });
  const perDe = (d) => per.findIndex((x) => d >= x.ini && (x.fim === null || d <= x.fim));
  const serie = pesagensIndividuais(S, id).map((p) => { const e = S.ev.get(p.event_id); return { p, data: p.data_pesagem, raiz: S.raiz(e), seq: e.event_seq }; })
    .sort((a, b) => cmp(a.data, b.data) || a.raiz - b.raiz || a.seq - b.seq || cmp(a.p.weight_id, b.p.weight_id));
  const dias = [];
  serie.forEach((x) => { if (dias.length && dias[dias.length - 1].data === x.data) dias[dias.length - 1] = x; else dias.push(x); });
  const out = [];
  for (let j = 1; j < dias.length; j++) {
    const a = dias[j - 1];
    const b = dias[j];
    const nd = diasEntre(a.data, b.data);
    const ganho = r1(b.p.peso_kg - a.p.peso_kg, 1);
    const conta = perDe(a.data) >= 0 && perDe(a.data) === perDe(b.data);
    out.push({ a: a.p, b: b.p, ganho, nd, gmd: conta && nd >= min ? r1(ganho / nd, 3) : null });
  }
  return out;
}
function oraculoGmd(sis, S, focos) {
  const ind = (id) => pesagensIndividuais(S, id);
  const cands = Array.from(S.animais.keys()).filter((id) => existe(S, id) && (S.animais.get(id) || {}).situacao_cadastral !== 'EXTERNO' && ind(id).length >= 2);
  const ids = focos.filter((id) => cands.indexOf(id) >= 0).concat(cands.slice().sort((a, b) => ind(b).length - ind(a).length || cmp(S.animais.get(a).codigo_interno, S.animais.get(b).codigo_interno))).filter((x, i, a) => a.indexOf(x) === i).slice(0, 3);
  if (!ids.length) return [];
  const r = sis.api('peso.desempenho', { animais: ids });
  if (!r.ok) return [falha('GMD:FALHOU', JSON.stringify(r.error).slice(0, 400))];
  const out = [];
  ids.forEach((id, i) => {
    const modelo = intervalosModelo(S, id).map((v) => [v.a.data_pesagem, v.b.data_pesagem, v.a.peso_kg, v.b.peso_kg, v.ganho, v.nd, v.gmd].join('|'));
    contar('intervalos de GMD conferidos', modelo.length);
    const c = (r.data.curvas || [])[i] || {};
    const sist = (c.intervalos || []).map((v) => [v.de, v.ate, v.peso_de_kg, v.peso_ate_kg, v.ganho_kg, v.dias, v.gmd_kg_dia].join('|'));
    if (JSON.stringify(sist) !== JSON.stringify(modelo)) out.push(falha('GMD', (S.animais.get(id) || {}).codigo_interno + ': intervalos do sistema ' + JSON.stringify(sist.filter((x) => modelo.indexOf(x) < 0).slice(0, 3)) + ', do modelo ' + JSON.stringify(modelo.filter((x) => sist.indexOf(x) < 0).slice(0, 3)) + ' (de|até|peso de|peso até|ganho|dias|GMD)'));
  });
  return out;
}
/** A agenda do sistema (`sanidade.agenda`) = o modelo, nas pendências dos protocolos modelados, nas sem protocolo e na carência. */
/**
 * Revisão final da Fase 3 (achado 1): para os protocolos restritos a uma categoria, a categoria de cada animal em D (a do
 * sistema: a classificação tem os próprios testes) e desde quando ele está nela sem interrupção — andando dia a dia para trás
 * a partir de D até a véspera ter outra categoria ou até a entrada no rebanho (força bruta, sem os dias candidatos do sistema).
 * Map id → {cat, desde}; null sem protocolo por categoria.
 */
function categoriasNaData(sis, S, D) {
  const porCat = (S.t.PROTOCOLOS_SANITARIOS || []).filter((p) => p.ativo !== false && p.category_id);
  if (!porCat.length) return null;
  const alvos = new Set(porCat.map((p) => p.category_id));
  const pedidos = [];
  S.animais.forEach((a, id) => {
    if (a.situacao_cadastral === 'EXTERNO' || !presenca(S, id, D).fim) return;
    if (!porCat.some((p) => p.sexo_aplicavel === 'AMBOS' || p.sexo_aplicavel === a.sexo)) return;
    pedidos.push({ id, piso: (S.linhasDe(id).filter((l) => l.efeito === 1 && l.data <= D).pop() || {}).data || null });
  });
  const { G, gas } = sis;
  const res = js(gas.exec(() => G.UnitOfWork.read(G.Api.contexto({ usuario: USUARIO }), {
    rota: 'teste.categorias', reads: G.AnimalService.leituras(), acessoCru: true,
    tratador: (tx) => {
      const L = G.AnimalService.leitor(tx);
      const chave = (a, d) => { const c = G.AnimalService.categoriaEm(L, a, d); return c ? c.category_id : null; };
      const out = {};
      pedidos.forEach((x) => {
        const a = tx.repo.porId('ANIMAIS', x.id);
        if (!a) return;
        const cat = chave(a, D);
        let desde = D;
        if (alvos.has(cat)) while (!(x.piso && desde <= x.piso) && chave(a, somaDias(desde, -1)) === cat) desde = somaDias(desde, -1);
        out[x.id] = { cat, desde };
      });
      return out;
    },
  }).dados));
  return new Map(Object.keys(res).map((k) => [k, res[k]]));
}
function oraculoAgenda(sis, S, D) {
  if (!S.marco || D < S.marco || D > HOJE) return [];
  const r = sis.api('sanidade.agenda', { data: D });
  if (!r.ok) return [falha('AGENDA:FALHOU', D + ': ' + JSON.stringify(r.error).slice(0, 400))];
  const m = modeloAgenda(S, D, categoriasNaData(sis, S, D));
  const out = [];
  const pend = r.data.pendencias.filter((p) => !p.protocol_id || m.modelados.has(p.protocol_id)).map((p) => [p.animal_id, p.protocol_id || '', p.protocol_id ? (S.t.PROTOCOLOS_SANITARIOS.find((x) => x.protocol_id === p.protocol_id) || {}).product_id || '' : p.produto_id || '', p.vencimento, p.situacao].join('|')).sort();
  const dif = (a, b) => a.filter((x) => b.indexOf(x) < 0).slice(0, 3);
  if (JSON.stringify(pend) !== JSON.stringify(m.pend)) out.push(falha('AGENDA:PENDENCIAS', 'agenda em ' + D + ': o sistema tem ' + JSON.stringify(dif(pend, m.pend)) + ' e o modelo ' + JSON.stringify(dif(m.pend, pend)) + ' (animal|protocolo|produto|vencimento|situação)'));
  contar('pendências da agenda conferidas', m.pend.length);
  contar('carências da agenda conferidas', m.car.length);
  const car = r.data.carencia.map((c) => c.animal_id + '|' + c.fim).sort();
  if (JSON.stringify(car) !== JSON.stringify(m.car)) out.push(falha('AGENDA:CARENCIA', 'carência em ' + D + ': o sistema tem ' + JSON.stringify(dif(car, m.car)) + ' e o modelo ' + JSON.stringify(dif(m.car, car))));
  if (r.data.resumo.em_carencia !== car.length || r.data.resumo.vencidas + r.data.resumo.proximas !== r.data.pendencias.length) out.push(falha('AGENDA:RESUMO', 'resumo da agenda ' + JSON.stringify(r.data.resumo) + ' × ' + r.data.pendencias.length + ' pendências e ' + car.length + ' em carência'));
  // Rodada 3 da revisão da Fase 3 (achado 6): as próximas doses da ficha (as vencidas e próximas) são as pendências do animal na
  // agenda de hoje, com o mesmo vencimento (a mesma entrada no rebanho). Até dois animais com pendência e um sem.
  if (D === HOJE) {
    const comPend = Array.from(new Set(r.data.pendencias.map((p) => p.animal_id))).slice(0, 2);
    const semPend = Array.from(S.animais.keys()).filter((id) => comPend.indexOf(id) < 0 && (S.animais.get(id) || {}).situacao_cadastral === 'ATIVO').slice(0, 1);
    comPend.concat(semPend).forEach((id) => {
      const f = sis.api('animal.ficha', { animal_id: id });
      if (!f.ok) { out.push(falha('AGENDA:FICHA', 'ficha de ' + id + ': ' + JSON.stringify(f.error).slice(0, 300))); return; }
      const naFicha = ((f.data.sanitario || {}).proximas || []).filter((p) => p.situacao !== 'EM_DIA').map((p) => [p.protocol_id || '', p.produto_id || '', p.vencimento, p.situacao].join('|')).sort();
      const naAgenda = r.data.pendencias.filter((p) => p.animal_id === id).map((p) => [p.protocol_id || '', p.produto_id || '', p.vencimento, p.situacao].join('|')).sort();
      contar('ficha × agenda conferida');
      if (JSON.stringify(naFicha) !== JSON.stringify(naAgenda)) out.push(falha('AGENDA:FICHA', ((S.animais.get(id) || {}).codigo_interno || id) + ': próximas doses da ficha ' + JSON.stringify(naFicha) + ', pendências na agenda ' + JSON.stringify(naAgenda)));
    });
  }
  return out;
}
/**
 * Os indicadores reprodutivos (07, seção 8.3) de cada estação, hoje: as expostas = as fêmeas com exposição, cobertura ou
 * inseminação vigente da estação (contadas aqui); prenhas ≤ diagnosticadas ≤ expostas, paridas ≤ expostas; cada taxa com
 * denominador zero ou abaixo do mínimo vazia com DADOS_INSUFICIENTES (nunca zero), senão = numerador ÷ denominador com uma
 * casa; as categorias somam as expostas. E as consultas de manejo respondem (`peso.desempenho`, `reproducao.matrizes`
 * com a situação reprodutiva de cada fêmea igual à projeção).
 */
function oraculoManejo(sis, S, focos) {
  const out = [];
  out.push(...oraculoGmd(sis, S, focos || []));
  const minimo = paramNum(S, 'indicador_n_minimo', 5);
  const pct = (n, d) => Math.round(Number((n / d * 100 * 10).toFixed(6))) / 10;
  const ests = (S.t.ESTACOES_MONTA || []).slice(-3);
  ests.concat([null]).forEach((est) => {
    const r = sis.api('reproducao.indicadores', est ? { estacao_id: est.estacao_id } : {});
    if (!r.ok) { out.push(falha('INDICADORES:FALHOU', JSON.stringify(r.error).slice(0, 400))); return; }
    if (!est) return;
    const g = (r.data.estacao || {}).geral;
    if (!g) { out.push(falha('INDICADORES', 'sem os indicadores da estação ' + est.nome)); return; }
    const expostas = new Set(vigentesDe(S, 'REPRODUCAO').filter((x) => x.estacao_id === est.estacao_id && ['EXPOSICAO', 'COBERTURA', 'INSEMINACAO'].indexOf(x.tipo_evento) >= 0).map((x) => x.animal_id));
    const q = est.nome + ': ';
    contar('estação com indicadores conferidos');
    if (g.expostas !== expostas.size) out.push(falha('INDICADORES', q + g.expostas + ' expostas no sistema, ' + expostas.size + ' contadas'));
    if (!(g.prenhas <= g.diagnosticadas && g.diagnosticadas <= g.expostas && g.paridas <= g.expostas)) out.push(falha('INDICADORES', q + 'contagens incoerentes ' + JSON.stringify([g.expostas, g.diagnosticadas, g.prenhas, g.paridas])));
    ['prenhez', 'prenhez_entre_diagnosticadas', 'paricao', 'natalidade', 'perda_gestacional', 'desmama', 'mortalidade_ate_desmama'].forEach((k) => {
      const t = g[k];
      if (!t) { out.push(falha('INDICADORES', q + 'sem a taxa ' + k)); return; }
      if (!t.denominador || t.denominador < minimo) { if (t.valor !== null || t.motivo !== 'DADOS_INSUFICIENTES') out.push(falha('INDICADORES', q + k + ' com denominador ' + t.denominador + ' deu ' + t.valor + ' (' + t.motivo + ')')); return; }
      if (t.valor !== pct(t.numerador, t.denominador) || t.motivo) out.push(falha('INDICADORES', q + k + ' = ' + t.valor + ' para ' + t.numerador + '/' + t.denominador));
      if (k !== 'natalidade' && k !== 'desmama' && t.numerador > t.denominador) out.push(falha('INDICADORES', q + k + ' com numerador ' + t.numerador + ' > denominador ' + t.denominador));
    });
    const somaCat = (r.data.estacao.por_categoria || []).reduce((s, c) => s + ((c.indicadores || c).expostas || 0), 0);
    if ((r.data.estacao.por_categoria || []).length && somaCat !== g.expostas) out.push(falha('INDICADORES', q + 'as categorias somam ' + somaCat + ' expostas, o geral ' + g.expostas));
  });
  const pd = sis.api('peso.desempenho', {});
  if (!pd.ok) out.push(falha('DESEMPENHO:FALHOU', JSON.stringify(pd.error).slice(0, 400)));
  else {
    // Rodada 3 (achado 14): cada pasto do desempenho tem rótulo único (o nome repetido em outra propriedade leva a propriedade).
    const rots = pd.data.por_pasto.map((x) => x.rotulo);
    if (new Set(rots).size !== rots.length) out.push(falha('DESEMPENHO:ROTULO', 'pastos com o mesmo rótulo no desempenho: ' + JSON.stringify(rots)));
  }
  // Rodada 3 (achado 9): numa data passada, a posição do curral descreve o animal pelo último peso até a data (o do modelo).
  const Dp = somaDias(HOJE, -100);
  if (S.marco && Dp >= S.marco) {
    const el = sis.api('inventario.elegiveis', { tipo: 'PESAGEM', data: Dp });
    if (!el.ok) out.push(falha('ELEGIVEIS:FALHOU', JSON.stringify(el.error).slice(0, 400)));
    else (el.data.itens || []).slice(0, 4).forEach((x) => {
      const ps = vigentesDe(S, 'PESAGENS').filter((p) => p.animal_id === x.animal_id && p.data_pesagem <= Dp && typeof p.peso_kg === 'number').map((p) => { const e = S.ev.get(p.event_id); return { kg: p.peso_kg, data: p.data_pesagem, raiz: S.raiz(e), seq: e.event_seq }; })
        .sort((a, b) => cmp(a.data, b.data) || a.raiz - b.raiz || a.seq - b.seq);
      const u = ps.length ? ps[ps.length - 1] : null;
      contar('último peso na data conferido');
      if ((x.ultimo_peso ? [x.ultimo_peso.kg, x.ultimo_peso.data] : null) + '' !== (u ? [u.kg, u.data] : null) + '') out.push(falha('ELEGIVEIS:PESO', ((S.animais.get(x.animal_id) || {}).codigo_interno || x.animal_id) + ' em ' + Dp + ': último peso ' + JSON.stringify(x.ultimo_peso) + ', o do modelo ' + JSON.stringify(u)));
    });
  }
  if (S.marco) {
    const mz = sis.api('reproducao.matrizes', {});
    if (!mz.ok) out.push(falha('MATRIZES:FALHOU', JSON.stringify(mz.error).slice(0, 400)));
    else mz.data.itens.forEach((x, i) => {
      const a = S.animais.get(x.animal_id) || {};
      // Rodada 3 (achado 7): os partos da lista de Fêmeas = os da ficha (a mesma conta: partos_previos e os registrados antes
      // da entrada descrevem o mesmo passado). Até três fêmeas por passo.
      if (i < 3) {
        const f = sis.api('animal.ficha', { animal_id: x.animal_id });
        if (f.ok && f.data.reprodutivo && f.data.reprodutivo.n_partos !== x.partos) out.push(falha('MATRIZES:PARTOS', (a.codigo_interno || x.animal_id) + ': ' + x.partos + ' partos na lista, ' + f.data.reprodutivo.n_partos + ' na ficha'));
        else contar('partos da lista × ficha conferidos');
      }
      if (a.sexo !== 'F' || !presenca(S, x.animal_id, HOJE).fim) out.push(falha('MATRIZES', (a.codigo_interno || x.animal_id) + ' na lista das fêmeas sem ser fêmea do rebanho hoje'));
      else if ((x.situacao_reprodutiva || null) !== (a.situacao_reprodutiva || null)) out.push(falha('MATRIZES', a.codigo_interno + ': situação ' + x.situacao_reprodutiva + ' na lista, ' + a.situacao_reprodutiva + ' na projeção'));
    });
    // Rodada 2 da revisão da Fase 3 (achados 6 e 11): a cria ao pé de cada fêmea hoje e numa data passada, pelo modelo das
    // linhas cruas só com os fatos até a data (a cria no rebanho no fim do dia, sem desmama vigente até ele, nascida na
    // fazenda ou que entrou mais nova que a idade de desmama), e o resumo é a contagem delas. Pega o "não" de toda data
    // diferente de hoje.
    const desmamaMeses = paramNum(S, 'idade_desmama_padrao_meses', 8);
    [HOJE, somaDias(HOJE, -150)].forEach((D) => {
      if (D < S.marco) return;
      const r = D === HOJE && mz.ok ? mz : sis.api('reproducao.matrizes', { data: D });
      if (!r.ok) { out.push(falha('MATRIZES:FALHOU', D + ': ' + JSON.stringify(r.error).slice(0, 400))); return; }
      const des = new Set(S.t.EVENTO_ANIMAIS.filter((l) => l.papel === 'SUJEITO' && S.vig.get(l.event_id) && (S.ev.get(l.event_id) || {}).event_type === 'DESMAMA' && S.ev.get(l.event_id).event_date <= D).map((l) => l.animal_id));
      const com = new Set();
      S.animais.forEach((c, id) => {
        if (!c.mae_id || ['EXTERNO', 'ANULADO', 'PENDENTE'].indexOf(c.situacao_cadastral) >= 0 || des.has(id) || !presenca(S, id, D).fim) return;
        const origem = S.ev.get(c.evento_origem_id);
        if (origem && (origem.event_type === 'NASCIMENTO' || (c.data_nascimento && mesesDe(c.data_nascimento, origem.event_date) < desmamaMeses))) com.add(c.mae_id);
      });
      let n = 0;
      r.data.itens.forEach((x) => {
        if (com.has(x.animal_id)) n++;
        if ((x.cria_ao_pe === true) !== com.has(x.animal_id)) out.push(falha('MATRIZES:CRIA_AO_PE', ((S.animais.get(x.animal_id) || {}).codigo_interno || x.animal_id) + ' em ' + D + ': cria ao pé ' + x.cria_ao_pe + ' na lista, ' + com.has(x.animal_id) + ' pelas linhas'));
      });
      contar('cria ao pé na data conferida', n);
      if (r.data.resumo.cria_ao_pe !== n) out.push(falha('MATRIZES:CRIA_AO_PE', D + ': resumo com ' + r.data.resumo.cria_ao_pe + ' com cria ao pé, a lista tem ' + n));
    });
  }
  return out;
}

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
  // Passada 2: depois do preparo (o cadastro mudado), a correção sem mudança vem logo.
  if (sis.tardiaPendente && rnd() < 0.6) { sis.tardiaPendente = false; const c = gerarAcao(sis, S, rnd, k, 'correcaoTardia', base); if (c) return c; }
  // Fuzz das Fases 1 a 3, passada 1: a fila do curral ou do tronco em curso tende a continuar (outros comandos no meio).
  if (sis.lida && rnd() < 0.5) { const c = gerarLida(sis, S, rnd, k, base); if (c) return c; }
  const acao = pesado(rnd, [
    ['registrar', 55], ['corrigir', 14], ['estornar', 11], ['editar', 5], ['reuso', 2], ['zeros', 0.6], ['marco', 1],
    ['importar', 4], ['desfazer', 1.5], ['reenvio', 1.5], ['versao', 1.5], ['cadastro', 5], ['outraChave', 1], ['lote', 0.5], ['faixas', 0.3],
    ['estornoImediato', 4], ['anexo', 2.5],
    // Passada 4: os parâmetros que mudam regra e projeção, o período financeiro fechado, a política de avisos e a versão
    // esperada atual (o caminho que deve passar).
    ['parametro', 1.5], ['bloqueio', 2], ['politica', 1.2], ['versaoAtual', 1.5],
    // Fuzz das Fases 1 a 3, passada 1: o curral e o tronco em blocos, as interações da Fase 3 com a Fase 2 e o controle de
    // estoque ligado e desligado.
    ['lida', 2.5], ['interacao', 8], ['estoqueLiga', 1],
    // Fuzz das Fases 1 a 3, passada 2: mais interações (agora com o preparo do que falta para elas) e a correção sem mudança
    // de um lançamento de manejo, mais tarde.
    ['interacao', 6], ['correcaoTardia', 3.5],
  ]);
  return gerarAcao(sis, S, rnd, k, acao, base);
}
/** Um comando da ação escolhida (null quando não há como montar). */
function gerarAcao(sis, S, rnd, k, acao, base) {
  if (acao === 'lida') return gerarLida(sis, S, rnd, k, base);
  if (acao === 'interacao') return gerarInteracao(sis, S, rnd, k, base);
  // O controle de estoque ligado e desligado alternando (o saldo é projeção: refeito pelos movimentos a cada troca).
  if (acao === 'estoqueLiga') {
    // Passada 2: também os produtos criados no meio da sequência.
    const p = sorteio(rnd, rnd() < 0.7 ? S.t.PRODUTOS.filter((x) => Object.values(sis.produtos).indexOf(x.product_id) >= 0) : S.t.PRODUTOS);
    if (!p) return null;
    const liga = p.controla_estoque !== true;
    return Object.assign(base, { rota: 'produto.salvar', dados: { product_id: p.product_id, campos: { controla_estoque: liga }, justificativa: 'Controle de estoque revisto' }, rotulo: 'estoque ' + (liga ? 'ligado' : 'desligado') });
  }
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
  // Fuzz das Fases 1 a 3, passada 2: a correção sem mudança de um lançamento de manejo (a especificação dele, como foi
  // aceita), muito depois do registro, com outros comandos gravados no meio (cadastros desativados, estação com outras
  // datas, parâmetros, animais que saíram, outros fatos do animal).
  if (acao === 'correcaoTardia') {
    const cands = S.t.EVENTOS.filter((e) => S.vig.get(e.event_id) && MANEJO.indexOf(e.event_type) >= 0 && sis.specs.has(e.event_id) && !(sis.snap && sis.snap.eid === e.event_id));
    if (!cands.length) return null;
    // De preferência o lançamento cujo cadastro mudou depois: o produto ou o protocolo desativado, a estação com outras
    // datas (o registro ficou fora dela), o pasto de destino desativado. Sem nenhum, às vezes o gerador desativa o produto
    // ou o protocolo de uma aplicação (o preparo).
    const mudou = cands.filter((e) => cadastroMudou(S, e));
    if (mudou.length) contar('correção tardia com o cadastro mudado');
    if (!mudou.length && !sis.tardiaAlvo && rnd() < 0.5) {
      // O preparo; a correção sem mudança vem logo depois (sis.tardiaPendente).
      sis.tardiaPendente = true;
      const r = sorteio(rnd, S.t.SANIDADE.filter((x) => (x.produto_id || x.protocol_id) && cands.some((e) => e.event_id === x.event_id)));
      const g = sorteio(rnd, (S.t.REPRODUCAO || []).filter((x) => x.estacao_id && cands.some((e) => e.event_id === x.event_id)));
      if (g && (!r || rnd() < 0.3)) return Object.assign(base, { rota: 'estacao.salvar', dados: { estacao_id: g.estacao_id, campos: { data_inicio: somaDias(g.data, 1), data_fim: somaDias(g.data, 91) }, justificativa: 'Datas da estação revistas' }, rotulo: 'estação mudada depois do registro' });
      // Revisão da Fase 3 (achados 3, 6 e 7): o custo, a categoria (a conta do consumo) e o intervalo do protocolo revistos
      // depois do uso, e o fator e o controle de estoque do produto de uma entrada; a correção sem mudança que vem logo é a
      // do lançamento preparado (sis.tardiaAlvo), e oraculoEfeitoCongelado confere que o fato não foi reprecificado.
      const preparado = (rota, dados, rotulo, eid) => { sis.tardiaAlvo = eid; return Object.assign(base, { rota, dados, rotulo }); };
      // Rodada 2 (achados 1 e 4): a pesagem do animal no dia da aplicação por peso, lançada depois dela (o caderno que
      // chegou): a correção sem mudança que vem logo não refaz a dose pelo peso novo.
      const porPeso = sorteio(rnd, S.t.SANIDADE.filter((x) => typeof x.dose === 'number' && cands.some((e) => e.event_id === x.event_id && e.pre_marco_zero !== true && (e.payload_json || {}).modo_dose === 'POR_PESO')));
      if (porPeso && rnd() < 0.4) {
        const spec = { tipo: 'PESAGEM', data: porPeso.data_aplicacao, momento: 'ROTINA', metodo: 'BALANCA', jejum: false, itens: [{ id: porPeso.animal_id, peso: 777 }], lote: null };
        return Object.assign(preparado('evento.registrar', montarDados(sis, spec), 'pesagem lançada depois da aplicação por peso', porPeso.event_id), { spec, aceitar: true, avisos: AVISOS });
      }
      if (r && r.protocol_id && rnd() < 0.3) {
        const pr = S.t.PROTOCOLOS_SANITARIOS.find((x) => x.protocol_id === r.protocol_id) || {};
        if (pr.recorrencia_tipo === 'INTERVALO_DIAS' && pr.ativo !== false) return preparado('protocolo.salvar', { protocol_id: r.protocol_id, campos: { intervalo_dias: (typeof pr.intervalo_dias === 'number' ? pr.intervalo_dias : 180) + 45 }, justificativa: 'Intervalo do protocolo revisto' }, 'intervalo do protocolo revisto depois do uso', r.event_id);
        // Revisão final da Fase 3 (achado 11): nos demais, o procedimento do protocolo trocado depois do uso (o cadastro recusa:
        // PROTOCOLO_EM_USO, oraculoProcedimentoProtocolo); a correção sem mudança vem logo depois.
        const outro = ['VACINA', 'VERMIFUGO', 'MEDICAMENTO', 'EXAME'].filter((v) => v !== pr.tipo_procedimento)[0];
        return preparado('protocolo.salvar', { protocol_id: r.protocol_id, campos: { tipo_procedimento: outro }, justificativa: 'Procedimento do protocolo revisto' }, 'procedimento do protocolo trocado depois do uso', r.event_id);
      }
      if (r && r.produto_id && rnd() < 0.5) {
        const pd = S.t.PRODUTOS.find((x) => x.product_id === r.produto_id) || {};
        // Revisão final da Fase 3 (achados 2 e 17): também a carência padrão, o nome e o fabricante do cadastro mudados depois
        // (cópias congeladas na aplicação: oraculoEfeito confere a correção pelo original).
        const y = rnd();
        const campos = y < 0.4 ? { custo_unitario: pd.custo_unitario === 2.5 ? 1.85 : 2.5 } : y < 0.55 ? { categoria: pd.categoria === 'MEDICAMENTO' ? 'VACINA' : 'MEDICAMENTO' }
          : y < 0.75 ? { carencia_padrao_dias: pd.carencia_padrao_dias === 45 ? 10 : 45 } : y < 0.88 ? { nome: /revisto/.test(pd.nome || '') ? String(pd.nome).replace(/ \(revisto\)$/, '') : pd.nome + ' (revisto)' } : { fabricante: pd.fabricante === 'Lab Revisto' ? 'Lab Outro' : 'Lab Revisto' };
        return preparado('produto.salvar', { product_id: r.produto_id, campos, justificativa: 'Cadastro do produto revisto' }, 'produto revisto depois do uso', r.event_id);
      }
      if (r && r.protocol_id && (!r.produto_id || rnd() < 0.4)) return Object.assign(base, { rota: 'protocolo.salvar', dados: { protocol_id: r.protocol_id, campos: { ativo: false }, justificativa: 'Protocolo encerrado' }, rotulo: 'protocolo desativado depois do uso' });
      if (r && r.produto_id) return Object.assign(base, { rota: 'produto.salvar', dados: { product_id: r.produto_id, campos: { ativo: false }, justificativa: 'Produto fora de linha' }, rotulo: 'produto desativado depois do uso' });
      const ent = !r && !g && sorteio(rnd, S.t.FINANCEIRO.filter((f) => f.product_id && cands.some((e) => e.event_id === f.event_id && e.event_type === 'ESTOQUE' && e.event_subtype === 'ENTRADA')));
      if (ent) {
        const pd = S.t.PRODUTOS.find((x) => x.product_id === ent.product_id) || {};
        const campos = rnd() < 0.5 ? { fator_conversao: pd.fator_conversao === 25 ? 50 : 25 } : { controla_estoque: pd.controla_estoque !== true };
        return preparado('produto.salvar', { product_id: ent.product_id, campos, justificativa: 'Cadastro do produto revisto' }, 'produto da entrada revisto depois da compra', ent.event_id);
      }
      sis.tardiaPendente = false;
    }
    const sorteado = sorteio(rnd, mudou.length && rnd() < 0.7 ? mudou : cands);
    const alvo = (sis.tardiaAlvo && cands.find((e) => e.event_id === sis.tardiaAlvo)) || sorteado;
    sis.tardiaAlvo = null;
    const dados = Object.assign(montarDados(sis, js(sis.specs.get(alvo.event_id).spec)), { event_id: alvo.event_id, justificativa: 'Conferido de novo' });
    return Object.assign(base, { rota: 'evento.corrigir', dados, aceitar: true, semJustAviso: false, correcaoTardia: true, rotulo: 'correção sem mudança, mais tarde, de ' + alvo.event_type + (alvo.event_subtype ? '/' + alvo.event_subtype : '') });
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
      // Fuzz das Fases 1 a 3, passada 2: os parâmetros da Fase 3 que os oráculos leem (a validade do peso na dose por kg, o
      // intervalo mínimo e a fita no GMD, o n mínimo e a cobertura do diagnóstico nos indicadores, a antecedência e a
      // tolerância da agenda, o alerta de parto).
      ['peso_validade_dias', ['30', '180', '400']], ['gmd_intervalo_min_dias', ['1', '28', '60']], ['gmd_aceita_fita', ['S', 'N']], ['indicador_n_minimo', ['1', '2', '5']],
      ['prenhez_cobertura_dg_min_pct', ['0', '90', '100']], ['agenda_antecedencia_dias', ['0', '15', '45']], ['agenda_tolerancia_dias', ['0', '7', '20']], ['alerta_parto_previsto_dias', ['0', '30']],
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
    const qual = pesado(rnd, [['pasto', 3], ['parceiro', 1.5], ['categoria', 1.5], ['pastoNovo', 0.8], ['pastoEditar', 0.6], ['parceiroNovo', 0.5], ['parceiroTipos', 0.4], ['categoriaNova', 0.7], ['categoriaEditar', 1.2], ['lista', 1.5], ['externo', 0.6], ['propriedadeNova', 0.5], ['propriedadeStatus', 0.5], ['propriedadePadrao', 0.3], ['produto', 0.8], ['protocolo', 0.7], ['estacao', 0.7], ['estacaoEditar', 0.3], ['protocoloNovo', 0.8], ['produtoNovo', 0.6]]);
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
    // Passada 2: também o início, o nome (às vezes o de outra: a recusa), o tipo e a propriedade.
    const x = rnd();
    const outras = (S.t.ESTACOES_MONTA || []).filter((y) => y.estacao_id !== e.estacao_id);
    const campos = x < 0.4 ? { data_fim: somaDias(e.data_fim, sorteio(rnd, [15, -15, 45])) } : x < 0.65 ? { data_inicio: somaDias(e.data_inicio, sorteio(rnd, [-30, 10, 60])) }
      : x < 0.8 ? { nome: outras.length && rnd() < 0.3 ? sorteio(rnd, outras).nome.toUpperCase() : e.nome + ' (revista)' } : x < 0.92 ? { tipo: sorteio(rnd, ['MONTA_NATURAL', 'IA', 'MISTA'].filter((v) => v !== e.tipo)) } : { property_id: sorteio(rnd, S.t.PROPRIEDADES).property_id };
    return com('estacao.salvar', { estacao_id: e.estacao_id, campos, justificativa: 'Datas revistas' }, 'estação editada');
  }
  // Fuzz das Fases 1 a 3, passada 2: o produto novo (as cinco categorias: a conta do consumo é a da categoria; a unidade, o
  // fator da embalagem, o custo, o controle de estoque e os padrões que a tela sugere), às vezes com o nome de outro ativo.
  if (qual === 'produtoNovo') {
    const cat = sorteio(rnd, ['VACINA', 'VERMIFUGO', 'MEDICAMENTO', 'SUPLEMENTO', 'OUTRO']);
    const nomes = S.t.PRODUTOS.filter((p) => p.ativo !== false).map((p) => p.nome);
    const campos = { nome: rnd() < 0.08 && nomes.length ? sorteio(rnd, nomes).toLowerCase() : 'Produto ' + k, categoria: cat, unidade: sorteio(rnd, cat === 'SUPLEMENTO' ? ['kg', 'g'] : ['mL', 'dose', 'g']), controla_estoque: rnd() < 0.5 };
    if (rnd() < 0.7) campos.custo_unitario = sorteio(rnd, [0.12, 1.5, 0.0075, 3]);
    if (rnd() < 0.5) campos.fator_conversao = sorteio(rnd, [10, 25, 500]);
    if (rnd() < 0.3) campos.carencia_padrao_dias = sorteio(rnd, [0, 21, 35]);
    if (rnd() < 0.3) campos.dose_padrao_por_cabeca = sorteio(rnd, [1, 2, 5]);
    if (rnd() < 0.2) campos.estoque_minimo = sorteio(rnd, [5, 50]);
    return com('produto.salvar', { campos }, 'produto novo');
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
    if (rnd() < 0.2) campos.peso_referencia_kg = sorteio(rnd, [180, 380]);
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
    else if (x < 0.88) campos.prioridade = sorteio(rnd, [1, 35, 200 + k]);
    // Passada 2: o peso de referência (a dose por kg sem pesagem válida usa o da categoria do animal na data).
    else if (x < 0.95) campos.peso_referencia_kg = sorteio(rnd, [150, 300, 420]);
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
    // Revisão da Fase 3: também a categoria (a conta do consumo) e a quantidade por embalagem — a correção sem mudança, mais
    // tarde, guarda o custo, a conta e o fator congelados (oraculoCorrecaoTardia).
    const campos = x < 0.35 ? { controla_estoque: p.controla_estoque !== true } : x < 0.55 ? { custo_unitario: sorteio(rnd, [0, 0.035, 1.85, 2.5]) } : x < 0.63 ? { categoria: sorteio(rnd, ['VACINA', 'VERMIFUGO', 'MEDICAMENTO', 'OUTRO']) } : x < 0.7 ? { fator_conversao: sorteio(rnd, [10, 25, 50]) } : x < 0.86 ? { ativo: p.ativo === false } : { unidade: p.unidade === 'mL' ? 'dose' : 'mL' };
    return com('produto.salvar', { product_id: p.product_id, campos, justificativa: 'Cadastro do produto revisto' }, 'produto ' + Object.keys(campos)[0]);
  }
  if (qual === 'protocolo') {
    const p = sorteio(rnd, S.t.PROTOCOLOS_SANITARIOS);
    if (!p) return null;
    // Fuzz das Fases 1 a 3: também a recorrência trocada (o campo da outra apagado), o sexo e a faixa de idade.
    const x = rnd();
    const campos = x < 0.25 ? { intervalo_dias: sorteio(rnd, [90, 180, 365]) } : x < 0.47 ? { ativo: p.ativo === false } : x < 0.6 ? (p.recorrencia_tipo === 'INTERVALO_DIAS' ? { recorrencia_tipo: 'UNICA' } : { recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: sorteio(rnd, [60, 180]) }) : x < 0.72 ? { sexo_aplicavel: sorteio(rnd, ['AMBOS', 'F', 'M'].filter((v) => v !== p.sexo_aplicavel)) } : x < 0.82 ? { idade_min_meses: sorteio(rnd, [0, 4, 12]) }
      // Passada 2: a campanha (outros meses; a recorrência trocada para campanha) e a tolerância.
      : x < 0.92 ? (p.recorrencia_tipo === 'CAMPANHA_MESES' ? { meses_campanha: alguns(rnd, [1, 4, 6, 10, 11], 2).sort((a, b) => a - b) } : { recorrencia_tipo: 'CAMPANHA_MESES', meses_campanha: [sorteio(rnd, [5, 11, 10])] })
      // Revisão final da Fase 3 (achado 11): o procedimento trocado (o do protocolo usado é recusado: oraculoProcedimentoProtocolo).
      : x < 0.95 ? { tipo_procedimento: ['VACINA', 'VERMIFUGO', 'MEDICAMENTO', 'EXAME'].filter((v) => v !== p.tipo_procedimento)[Math.floor((x - 0.92) * 100) % 3] } : { tolerancia_dias: sorteio(rnd, [0, 5, 30]) };
    return com('protocolo.salvar', { protocol_id: p.protocol_id, campos, justificativa: 'Protocolo revisto' }, 'protocolo ' + Object.keys(campos)[0]);
  }
  // Fuzz das Fases 1 a 3: o protocolo novo (intervalo, aplicação única ou campanha; sexo, faixa de idade, às vezes a
  // categoria e a antecedência própria; às vezes a faixa invertida: a recusa).
  if (qual === 'protocoloNovo') {
    const proc = sorteio(rnd, ['VACINA', 'VACINA', 'VERMIFUGO', 'MEDICAMENTO', 'EXAME']);
    const rec = pesado(rnd, [['INTERVALO_DIAS', 6], ['UNICA', 3], ['CAMPANHA_MESES', 3]]);
    const campos = { nome: 'Protocolo ' + k, tipo_procedimento: proc, sexo_aplicavel: sorteio(rnd, ['AMBOS', 'AMBOS', 'F', 'M']), recorrencia_tipo: rec };
    const prod = { VACINA: sis.produtos.vacina, VERMIFUGO: sis.produtos.vermifugo, MEDICAMENTO: sis.produtos.antibiotico }[proc];
    if (prod && rnd() < 0.7) campos.product_id = prod;
    if (rec === 'INTERVALO_DIAS') campos.intervalo_dias = sorteio(rnd, [30, 90, 180, 365]);
    if (rec === 'CAMPANHA_MESES') campos.meses_campanha = alguns(rnd, [3, 5, 11, 12], 2).sort((a, b) => a - b);
    if (rnd() < 0.4) campos.idade_min_meses = sorteio(rnd, [0, 3, 8, 24]);
    if (rnd() < 0.3) campos.idade_max_meses = sorteio(rnd, [12, 30, 2]);
    // Revisão final da Fase 3 (achado 1): de preferência as categorias em que o animal entra depois de entrar no rebanho (pela
    // idade ou pelo parto), onde o vencimento conta do dia em que ele entrou nela (o mesmo número de sorteios de antes).
    if (rnd() < 0.1) { const passagem = S.t.CATEGORIAS.filter((c) => ['VACA', 'GARROTE', 'NOVILHA_12_24', 'NOVILHO', 'NOVILHA_24_MAIS', 'BOI'].indexOf(c.codigo) >= 0); campos.category_id = sorteio(rnd, passagem.length ? passagem : S.t.CATEGORIAS).category_id; }
    if (rnd() < 0.3) campos.antecedencia_alerta_dias = sorteio(rnd, [0, 7, 30]);
    // Passada 2: a tolerância própria da campanha (a janela de cumprimento), que o modelo da agenda agora confere.
    if (rec === 'CAMPANHA_MESES' && rnd() < 0.4) campos.tolerancia_dias = sorteio(rnd, [0, 3, 15]);
    // Passada 2: às vezes o protocolo cadastrado meses atrás (o relógio do pedido no passado; o cadastro guarda quando foi
    // criado): a campanha perdida que continua devida e a aplicação única devida por quem passou da idade máxima dependem disso.
    const c = com('protocolo.salvar', { campos }, 'protocolo novo');
    if (rnd() < 0.5) { c.relogio = ateHoje(somaDias(S.marco || D0, sorteio(rnd, [0, 40, 120, 200]))); c.rotulo = 'protocolo novo, cadastrado em ' + c.relogio; }
    return c;
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
  // Passada 2: o estoque não tem linha de animal (os demais tipos sem linha não têm como ser remontados).
  if (!ls.length && e.event_type !== 'ESTOQUE') return null;
  const idents = S.t.IDENTIFICACOES.filter((y) => y.event_id === e.event_id);
  const brincoDe = (id) => (idents.find((y) => y.animal_id === id && y.tipo === 'BRINCO') || {}).codigo || null;
  const ids = ls.map((l) => l.animal_id).filter((id, i, a) => a.indexOf(id) === i);
  return T.doGravado({ sis, S, rnd, ls, idents, brincoDe, data: e.event_date, ids }, e) || null;
}

// ------------------------------------------------------------------ viagem no tempo ----
/**
 * Oráculo de viagem no tempo (conserto da Fase 3 pela garantia, etapa 1; docs/CONTRATOS.md, seção 46).
 *
 * Propriedade: a resposta de toda consulta numa data D do passado é função só (1) dos FATOS ATÉ D — os eventos com data até D
 * (com a situação de cada um: vigente, estornado, de importação em curso), a correção de cadastro e a do brinco lançado errado
 * em qualquer data (valem para todo o histórico: 04, seção 4.4; desenho-base 16.2), o vínculo de mãe das crias nascidas até D
 * (a fêmea "parida em D" conta a cria cadastrada nascida até D: 05, seção 4.9) e os atributos de cadastro do animal (nome,
 * raça) — e (2) dos CADASTROS E PARÂMETROS QUE O DESENHO MANDA LER COMO ESTÃO HOJE: as regras e os nomes de CATEGORIAS
 * (desenho-base 4.3: "com as regras atuais de CATEGORIAS"), os pastos (área, capacidade, situação, nomes), os protocolos que
 * já valiam em D (RN-058: o cadastrado depois de D não conta; as regras dos que valiam são as de hoje, 03a, seção 4.9), as
 * estações de monta (03a, seção 4.10), o plano de contas e os nomes dos produtos, e os parâmetros zootécnicos lidos na
 * consulta (03a, seção 4.12: "por isso o painel mostra o parâmetro em uso"). Exceções documentadas (CONTRATOS, seção 46),
 * fora da comparação: o `brinco_hoje` dos elegíveis (o número de hoje, por desenho), os títulos, as pendências de cadastro e o
 * `geradoEm` da visão geral (de hoje), as `curvas` do desempenho (a curva da vida do animal pedido, com o ponto de hoje da
 * projeção; a bateria não pede curva) e, na ficha, as listas (eventos, crias, genealogia, anexos, financeiro, touro).
 *
 * Como confere: num passo sorteado (`cmd.tempo`, num gerador à parte, gravado na sequência para a repetição e o encolhimento),
 * guarda a bateria de consultas em D por UNIDADE — a consulta inteira, ou a linha de um animal numa lista — com a impressão
 * digital do que ela pode ler pelas regras acima (a do rebanho inteiro ou a do animal: os fatos dele, das crias e os
 * atributos). Depois de cada passo que gravou, refaz as consultas e compara as unidades cuja impressão não mudou ou voltou à
 * do retrato: um fato com data depois de D (de qualquer tipo, estorno e correção inclusive) e um cadastro que não vale para
 * o passado (o custo, a categoria ou o controle do produto, o protocolo cadastrado depois de D, os parâmetros que só valem
 * para os comandos, o parceiro, a lista, o touro de referência) não mudam nada; um fato retroativo muda só as unidades que
 * ele alcança (a linha de cada outro animal fica igual) e volta ao retrato quando é desfeito. No próprio passo do retrato:
 * a mesma bateria com o relógio adiantado (a data de hoje não entra em nenhuma resposta pedida numa data D), em D = hoje a
 * bateria sem a data (o caminho padrão = o caminho com a data), e a lista de pastos em D com todo pasto que tinha animal em
 * D (o desativado depois continua no histórico: 02, política `escrita`). A ficha do animal que saiu do rebanho entra com a
 * data da saída (os cálculos dela são dessa data: idade, categoria, aptidão, carência, cria ao pé).
 */
const SUB_RETRO = ['CORRECAO_CADASTRO', 'IDENTIFICACAO_INCORRETA'];
const ehRetro = (e) => !!e && e.event_type === 'AJUSTE_INVENTARIO' && SUB_RETRO.indexOf(e.event_subtype) >= 0;
const SAIDAS_DO_REBANHO_T = ['VENDIDO', 'MORTO', 'DESCARTADO', 'BAIXADO_AJUSTE'];
/** Parâmetros lidos pelas consultas numa data (03a, seção 4.12), por grupo de consulta. Os demais só valem para os comandos. */
const P_INV = ['data_marco_zero', 'fuso', 'ua_peso_kg', 'peso_validade_dias'];
const P_GMD = ['gmd_intervalo_min_dias', 'gmd_aceita_fita', 'indicador_n_minimo', 'gmd_referencia_janela_dias', 'projecao_peso_horizonte_dias', 'gmd_plausivel_min_kg_dia', 'gmd_plausivel_max_kg_dia', 'peso_nascer_padrao_kg_macho', 'peso_nascer_padrao_kg_femea'];
const P_AGENDA = ['data_marco_zero', 'fuso', 'agenda_antecedencia_dias', 'agenda_tolerancia_dias'];
const P_REPRO = ['data_marco_zero', 'fuso', 'dias_gestacao', 'parto_tolerancia_dias', 'indicador_n_minimo', 'prenhez_cobertura_dg_min_pct', 'idade_min_reprodutiva_meses', 'idade_desmama_padrao_meses', 'alerta_parto_previsto_dias', 'alerta_prenhez_vencida_dias'];
/** Os cadastros que cada grupo de consulta lê como estão hoje (por desenho). */
const CADASTROS_TEMPO = {
  pos: ['cat', 'pasto', P_INV], posA: ['cat', 'pasto', P_INV], pastos: ['cat', 'pasto', P_INV], pasto: ['cat', 'pasto', P_INV], painel: ['cat', 'pasto', P_INV], perm: ['pasto', P_INV], dash: ['cat', 'pasto', P_INV],
  eleg: ['cat', P_INV],
  desemp: ['cat', 'pasto', P_INV.concat(P_GMD)],
  agenda: ['prot', 'prod', 'cat', 'contas', P_AGENDA],
  ind: ['est', 'cat', P_REPRO], mat: ['est', P_REPRO], matE: ['est', P_REPRO],
  eventos: [],
  ficha: ['cat', 'pasto', 'est', 'protTodos', 'listas', 'contas', P_INV.concat(P_GMD, P_AGENDA, P_REPRO)],
};
/** Índices do estado para as impressões digitais (uma vez por estado). */
function indiceTempo(S) {
  if (S._tempo) return S._tempo;
  const evsPor = new Map();
  S.t.EVENTO_ANIMAIS.forEach((l) => {
    if (!S.vig.get(l.event_id)) return;
    const e = S.ev.get(l.event_id);
    if (!e || e.event_type === 'ESTORNO') return;
    (evsPor.get(l.animal_id) || evsPor.set(l.animal_id, []).get(l.animal_id)).push({ id: e.event_id, data: e.event_date, retro: ehRetro(e), criacao: !!l.atributos_iniciais_json });
  });
  const filhos = new Map();
  S.animais.forEach((a, id) => { if (a.mae_id && ['ANULADO', 'PENDENTE'].indexOf(a.situacao_cadastral) < 0) (filhos.get(a.mae_id) || filhos.set(a.mae_id, []).get(a.mae_id)).push(id); });
  S._tempo = { evsPor, filhos, memo: new Map() };
  return S._tempo;
}
function lembrarTempo(S, k, f) {
  const m = indiceTempo(S).memo;
  if (!m.has(k)) m.set(k, f());
  return m.get(k);
}
const evsAte = (lista, D) => (lista || []).filter((x) => x.data <= D || x.retro || x.criacao).map((x) => x.id).sort();
/**
 * Os fatos do rebanho inteiro até D: cada evento com data até D (ou de correção que vale para todo o histórico) com a situação
 * dele (o estornado e o da importação em curso continuam na lista de eventos), e o vínculo de mãe das crias nascidas até D.
 */
function digitalFatos(S, D) {
  return lembrarTempo(S, 'G|' + D, () => {
    const evs = [];
    S.t.EVENTOS.forEach((e) => {
      if (e.event_type === 'ESTORNO' || !(e.event_date <= D || ehRetro(e))) return;
      evs.push(e.event_id + ':' + (S.vig.get(e.event_id) ? 'V' : [S.op.get(e.op_id) || '?', e.import_id ? (S.imp.get(e.import_id) || {}).status || '?' : '-', S.anuladoPor.has(e.event_id) ? 'A' : '-'].join('/')));
    });
    const maes = [];
    S.animais.forEach((a, id) => {
      if (!a.mae_id || ['ANULADO', 'PENDENTE'].indexOf(a.situacao_cadastral) >= 0 || (a.data_nascimento && a.data_nascimento > D)) return;
      maes.push(id + '>' + a.mae_id + '@' + (a.data_nascimento || ''));
    });
    return evs.sort().join(',') + '|' + maes.sort().join(',');
  });
}
/** Os fatos de UM animal até D: os eventos dele, os das crias nascidas até D (parida e cria ao pé em D) e os atributos. */
function digitalAnimal(S, id, D) {
  return lembrarTempo(S, 'A|' + id + '|' + D, () => {
    const ix = indiceTempo(S);
    const a = S.animais.get(id) || {};
    const crias = (ix.filhos.get(id) || []).map((c) => {
      const ca = S.animais.get(c) || {};
      if (ca.data_nascimento && ca.data_nascimento > D) return null;
      return c + '@' + (ca.data_nascimento || '') + ':' + evsAte(ix.evsPor.get(c), D).join('+');
    }).filter(Boolean).sort();
    const fixo = ['EXTERNO', 'ANULADO', 'PENDENTE'].indexOf(a.situacao_cadastral) >= 0 ? a.situacao_cadastral : '';
    return [evsAte(ix.evsPor.get(id), D).join(','), crias.join(','), [a.sexo, a.data_nascimento, a.mae_id, a.pai_id, a.nome, a.raca, fixo].map((v) => (v === undefined || v === null ? '' : v)).join('/')].join('|');
  });
}
/** Desde quando o protocolo vale (05, RN-058): o dia do cadastro no fuso da fazenda ou, se antes, a primeira aplicação vigente. */
function protocolosEm(S, D) {
  const primeira = {};
  vigentesDe(S, 'SANIDADE').forEach((r) => { if (r.protocol_id && (!primeira[r.protocol_id] || r.data_aplicacao < primeira[r.protocol_id])) primeira[r.protocol_id] = r.data_aplicacao; });
  return (S.t.PROTOCOLOS_SANITARIOS || []).map((p) => {
    const ini = [p.created_at ? diaNoFuso(p.created_at) : null, primeira[p.protocol_id] || null].filter(Boolean).sort()[0] || null;
    return ini && ini > D ? null : semCarimbo(p);
  }).filter(Boolean);
}
function semCarimbo(r) {
  const o = {};
  Object.keys(r).sort().forEach((c) => { if (c !== 'created_at' && c !== 'updated_at') o[c] = r[c]; });
  return o;
}
/**
 * Os cadastros e parâmetros que o grupo lê como estão hoje (CADASTROS_TEMPO). `semAtivoCat`: as categorias sem a marca de
 * ativa (a desativação de uma categoria muda a classificação automática, regra de hoje, mas não a reclassificação manual
 * daquela data: 02, política `escrita`).
 */
function digitalCadastros(S, grupo, D, semAtivoCat) {
  return lembrarTempo(S, 'C|' + grupo + '|' + D + (semAtivoCat ? '|sa' : ''), () => (CADASTROS_TEMPO[grupo] || []).map((p) => {
    if (Array.isArray(p)) return p.map((c) => c + '=' + norm(S.config.get(c))).join(',');
    if (p === 'cat') return JSON.stringify(S.t.CATEGORIAS.map((c) => (semAtivoCat ? sem(semCarimbo(c), ['ativo']) : semCarimbo(c))));
    if (p === 'pasto') return JSON.stringify([S.t.PASTOS.map(semCarimbo), S.t.PROPRIEDADES.map((r) => [r.property_id, r.nome]), S.t.PARCEIROS.map((r) => [r.partner_id, r.nome])]);
    if (p === 'prot') return JSON.stringify(protocolosEm(S, D));
    if (p === 'protTodos') return JSON.stringify((S.t.PROTOCOLOS_SANITARIOS || []).map((r) => [r.protocol_id, r.nome]));
    if (p === 'prod') return JSON.stringify((S.t.PRODUTOS || []).map((r) => [r.product_id, r.nome]));
    if (p === 'contas') return JSON.stringify(S.t.PLANO_CONTAS.map((r) => [r.conta_id, r.codigo, r.nome, r.classe_custo_animal, r.natureza, r.tipo]));
    if (p === 'est') return JSON.stringify((S.t.ESTACOES_MONTA || []).map(semCarimbo));
    if (p === 'listas') return JSON.stringify(S.t.LISTAS.map((r) => [r.lista_id, r.codigo, r.rotulo, r.ativo]));
    throw new Error('cadastro desconhecido no oráculo do tempo: ' + p);
  }).join('#'));
}
/**
 * A impressão digital de uma unidade da bateria: os fatos (do rebanho ou do animal) até a data dela e os cadastros do grupo.
 * Na ficha, também a data de referência dela (a do animal hoje: a volta ao rebanho muda a ficha para a de hoje, por desenho).
 */
function digitalUnidade(S, u, semAtivoCat) {
  const ref = u.grupo === 'ficha' ? '#' + ((S.animais.get(u.animal) || {}).situacao_cadastral || '') + '@' + ((S.animais.get(u.animal) || {}).data_saida || '') : '';
  return (u.animal ? digitalAnimal(S, u.animal, u.D) : digitalFatos(S, u.D)) + '#' + digitalCadastros(S, u.grupo, u.D, semAtivoCat) + ref;
}
const escolher = (o, campos) => { const x = {}; campos.forEach((c) => { x[c] = o && o[c] !== undefined ? o[c] : null; }); return x; };
const sem = (o, campos) => { if (!o || typeof o !== 'object') return o; const x = Object.assign({}, o); campos.forEach((c) => { delete x[c]; }); return x; };
/**
 * As consultas numa data D, em unidades {grupo, chave, animal, D, valor}. T: {D, animais, amostra, pastos, estacoes,
 * categoria, fichas}. opcoes: {semData: o caminho padrão (sem a data: hoje), grupos: Set (só estes grupos)}.
 */
function bateriaTempo(sis, T, opcoes) {
  const o = opcoes || {};
  const D = T.D;
  const quer = (g) => !o.grupos || o.grupos.has(g);
  const dd = (campo, x) => (o.semData ? x : Object.assign({ [campo]: D }, x));
  const out = [];
  const internos = [];
  const add = (grupo, chave, valor, animal, Dx) => out.push({ grupo, chave, animal: animal || null, D: Dx || D, valor: valor === undefined ? null : valor });
  const chamar = (rota, dados) => {
    const r = sis.api(rota, dados);
    if (r.ok) return r.data;
    if (r.error && r.error.code === 'INTERNAL') internos.push(rota + ' ' + JSON.stringify(dados) + ': ' + r.error.message);
    return { recusa: r.error.code, detalhes: (r.error.details || []).map((x) => x.codigo) };
  };
  const porAnimal = (grupo, prefixo, itens, ids) => {
    const m = new Map();
    (itens || []).forEach((x) => { (m.get(x.animal_id) || m.set(x.animal_id, []).get(x.animal_id)).push(x); });
    (ids || T.animais).forEach((id) => add(grupo, prefixo + '|' + id, m.has(id) ? m.get(id) : null, id));
  };
  // 1. A posição do rebanho em D (inteira, com os filtros de sexo, pasto e categoria) e a de cada animal da amostra.
  if (quer('pos')) {
    add('pos', 'pos', chamar('inventario.posicao', dd('data', {})));
    add('pos', 'pos:F', chamar('inventario.posicao', dd('data', { sexo: 'F' })));
    T.pastos.slice(0, 2).forEach((p) => add('pos', 'pos:P:' + p, chamar('inventario.posicao', dd('data', { pasture_id: p }))));
    if (T.categoria) add('pos', 'pos:C', chamar('inventario.posicao', dd('data', { category_id: T.categoria })));
  }
  if (quer('posA')) T.amostra.forEach((id) => add('posA', 'posA|' + id, chamar('inventario.posicao', dd('data', { animal_id: id })), id));
  // 2. Os elegíveis em D (a conferência do curral e do tronco com data passada): no fim do dia, no dia e as fêmeas.
  if (quer('eleg')) {
    ['TRANSFERENCIA', 'PESAGEM', 'NASCIMENTO'].forEach((tipo) => {
      const r = chamar('inventario.elegiveis', dd('data', { tipo }));
      const itens = r && Array.isArray(r.itens) ? r.itens.map((x) => sem(x, ['brinco_hoje'])) : null;
      add('eleg', 'eleg:' + tipo, r && r.recusa ? r : sem(r, ['itens']));
      porAnimal('eleg', 'eleg:' + tipo, itens);
    });
  }
  // 3. Os pastos em D: todos os cartões (com os inativos), a lista padrão e o painel de cada pasto com os animais e os dias de
  // permanência dos 60 dias até D.
  if (quer('pasto') || quer('pastos')) {
    const todos = chamar('pasto.listar', dd('data', { incluir_inativos: true }));
    if (Array.isArray(todos)) todos.forEach((c) => add('pasto', 'pasto:' + c.pasture_id, c));
    else add('pasto', 'pasto:*', todos);
    const ativos = chamar('pasto.listar', dd('data', {}));
    add('pastos', 'pastos', Array.isArray(ativos) ? ativos.map((c) => [c.pasture_id, c.status, c.cabecas]) : ativos);
    out.estrutura = { todos, ativos };
  }
  if (quer('painel') || quer('perm')) {
    T.pastos.forEach((p) => {
      const r = chamar('pasto.painel', Object.assign(dd('data', { pasture_id: p }), { periodo_inicio: somaDias(D, -60), periodo_fim: D }));
      if (!r || r.recusa) { add('painel', 'painel:' + p, r); return; }
      add('painel', 'painel:' + p, sem(r, ['animais', 'permanencia']));
      porAnimal('painel', 'painel:' + p, r.animais);
      const perm = r.permanencia || {};
      add('perm', 'perm:' + p, sem(perm, ['itens']));
      porAnimal('perm', 'perm:' + p, perm.itens);
    });
  }
  // 4. A agenda sanitária em D: o resumo, a cobertura dos protocolos e os custos do período; as pendências e a carência de cada animal.
  if (quer('agenda')) {
    const r = chamar('sanidade.agenda', dd('data', {}));
    add('agenda', 'agenda', r && r.recusa ? r : sem(r, ['pendencias', 'carencia']));
    porAnimal('agenda', 'agenda:p', r && r.pendencias);
    porAnimal('agenda', 'agenda:c', r && r.carencia);
  }
  // 5. Os indicadores reprodutivos em D (a estação padrão, cada estação, o ano) e a lista de fêmeas (também a de uma estação).
  if (quer('ind')) {
    add('ind', 'ind', chamar('reproducao.indicadores', dd('data', {})));
    T.estacoes.forEach((e) => add('ind', 'ind:' + e, chamar('reproducao.indicadores', dd('data', { estacao_id: e }))));
    add('ind', 'ind:ano', chamar('reproducao.indicadores', dd('data', { ano: D.slice(0, 4) })));
  }
  if (quer('mat')) {
    const r = chamar('reproducao.matrizes', dd('data', {}));
    add('mat', 'mat', r && r.recusa ? r : sem(r, ['itens']));
    porAnimal('mat', 'mat', r && r.itens);
  }
  if (quer('matE') && T.estacoes.length) {
    const r = chamar('reproducao.matrizes', dd('data', { estacao_id: T.estacoes[0] }));
    porAnimal('matE', 'matE', r && r.itens ? r.itens.map((x) => ({ animal_id: x.animal_id })) : null);
  }
  // 6. O desempenho até D (desde o marco zero e nos 120 dias até D): os grupos e a linha de cada animal.
  if (quer('desemp')) {
    const variantes = [['desemp', {}], ['desemp120', { de: somaDias(D, -120) }]];
    // Com os filtros de pasto e de categoria (o pasto e a categoria na data de cada pesagem e no fim do período).
    if (T.pastos.length) variantes.push(['desempP', { pasture_id: T.pastos[0] }]);
    if (T.categoria) variantes.push(['desempC', { category_id: T.categoria }]);
    variantes.forEach(([nome, x]) => {
      const r = chamar('peso.desempenho', dd('ate', x));
      add('desemp', nome, r && r.recusa ? r : sem(r, ['animais', 'curvas']));
      porAnimal('desemp', nome, r && r.animais);
    });
  }
  // 7. A visão geral com o período terminando em D, inteira e com o filtro de pasto (os títulos e as pendências de cadastro
  // são de hoje, por desenho).
  if (quer('dash')) {
    [['dash', {}]].concat(T.pastos.length ? [['dashP', { pasture_id: T.pastos[0] }]] : []).forEach(([nome, x]) => {
      const r = chamar('dashboard.obter', dd('data_fim', x));
      const v = r && r.recusa ? r : sem(r, ['titulos', 'pendencias', 'geradoEm']);
      if (v && v.etiquetas) v.etiquetas = sem(v.etiquetas, ['titulos']);
      add('dash', nome, v);
    });
  }
  // 8. Os lançamentos até D (com a situação de cada um).
  if (quer('eventos')) add('eventos', 'eventos', chamar('evento.listar', dd('ate', { por_pagina: 500 })));
  // 9. A ficha de quem saiu do rebanho: os cálculos dela são da data da saída (as listas de hoje ficam fora: as crias, os
  // eventos, a genealogia, os anexos, o financeiro, o touro dos registros das fêmeas).
  if (quer('ficha')) {
    Object.keys(T.fichas).forEach((id) => {
      const f = chamar('animal.ficha', { animal_id: id });
      const v = !f || f.recusa ? f : {
        geral: escolher(f.geral, ['brinco', 'idade_meses', 'categoria', 'data_referencia', 'sem_categoria', 'situacao_cadastral', 'data_saida', 'peso_atual', 'data_ultima_pesagem', 'situacao_reprodutiva', 'cria_ao_pe', 'marcado_descarte', 'castrado', 'reprodutor', 'partos_previos', 'peso_vigente', 'data_entrada', 'origem', 'sexo', 'data_nascimento']),
        pastos: f.pastos, peso: f.peso,
        sanitario: escolher(f.sanitario, ['itens', 'carencia', 'proximas', 'custo_total']),
        reprodutivo: Object.assign(sem(f.reprodutivo, ['bezerros', 'como_touro']), { partos: ((f.reprodutivo || {}).partos || []).map((p) => sem(p, ['crias'])) }),
      };
      add('ficha', 'ficha|' + id, v, id, T.fichas[id]);
    });
  }
  out.internos = internos;
  return out;
}
/** O primeiro caminho em que dois valores (JSON) diferem: {caminho, antes, depois} ou null. */
function primeiraDiferenca(a, b, caminho) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const ks = Array.from(new Set(Object.keys(a).concat(Object.keys(b))));
    for (const key of ks) { const d = primeiraDiferenca(a[key], b[key], caminho + '.' + key); if (d) return d; }
  }
  return { caminho, antes: a, depois: b };
}
const curto = (v) => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 260 ? s.slice(0, 260) + '…' : s; };
/** As unidades de duas baterias do mesmo estado (com o relógio adiantado, sem a data) têm de ser iguais. */
function mesmaBateria(rotulo, T, base, outra) {
  const out = [];
  const m = new Map(outra.map((u) => [u.chave, u]));
  base.forEach((u) => {
    const x = m.get(u.chave);
    const d = primeiraDiferenca(u.valor, x ? x.valor : undefined, u.chave);
    if (d && out.length < 3) out.push(falha('TEMPO:' + rotulo + ':' + u.grupo, rotulo === 'RELOGIO' ? 'a consulta em ' + T.D + ' mudou com o relógio adiantado ' + T.avanco + ' dia(s) (a data de hoje entrou na resposta): ' + d.caminho + ' ' + curto(d.antes) + ' → ' + curto(d.depois) : 'em ' + T.D + ' (hoje), a consulta sem a data respondeu diferente da consulta com a data: ' + d.caminho + ' ' + curto(d.antes) + ' (com a data) → ' + curto(d.depois) + ' (sem a data)'));
  });
  return out;
}
/** A lista de pastos em D traz todo pasto que tinha animal em D, ativo ou não (02, política `escrita`: o histórico continua). */
function estruturaTempo(T, bat) {
  const e = bat.estrutura;
  if (!e || !Array.isArray(e.todos) || !Array.isArray(e.ativos)) return [];
  const lista = new Set(e.ativos.map((c) => c.pasture_id));
  return e.todos.filter((c) => c.cabecas > 0 && !lista.has(c.pasture_id)).slice(0, 1).map((c) => falha('TEMPO:PASTO_SUMIU', 'em ' + T.D + ', o ' + c.nome + ' (' + c.status + ') tinha ' + c.cabecas + ' cabeça(s), mas não aparece na lista de pastos dessa data'));
}
/**
 * A ficha (a visão de hoje, com os cálculos na data de referência) e as consultas numa data dizem o mesmo do animal: em
 * D = hoje, a do animal no rebanho (categoria, idade, peso vigente, situação, cria ao pé e aptidão, carência) = a posição, a
 * lista de fêmeas e a agenda de hoje; a do animal que saiu, o brinco e a categoria do dia da saída = os elegíveis daquele dia.
 */
function cruzarFicha(sis, T, bat) {
  const out = [];
  const de = new Map(bat.map((u) => [u.chave, u.valor]));
  const ruim = (id, oque, ficha, data) => { if (out.length < 2) out.push(falha('TEMPO:FICHA_X_DATA', 'ficha de ' + id + ' × consulta em ' + T.D + ': ' + oque + ' na ficha ' + curto(ficha) + ', na consulta numa data ' + curto(data))); };
  if (T.D === HOJE) {
    T.amostra.forEach((id) => {
      const p = de.get('posA|' + id);
      if (!p || p.recusa || !p.presente) return;
      const f = sis.api('animal.ficha', { animal_id: id });
      if (!f.ok) return;
      const g = f.data.geral || {};
      contar('viagem no tempo: ficha de hoje × consultas da data');
      if (((g.categoria || {}).category_id || null) !== ((p.categoria || {}).category_id || null)) ruim(id, 'a categoria', g.categoria, p.categoria);
      if ((g.idade_meses === undefined ? null : g.idade_meses) !== p.idade_meses) ruim(id, 'a idade', g.idade_meses, p.idade_meses);
      if (JSON.stringify(g.peso_vigente) !== JSON.stringify(p.peso)) ruim(id, 'o peso vigente', g.peso_vigente, p.peso);
      const m = (de.get('mat|' + id) || [])[0];
      const rp = f.data.reprodutivo || {};
      if (m && (m.cria_ao_pe !== (rp.cria_ao_pe === true) || m.situacao_reprodutiva !== rp.situacao_reprodutiva || m.apta !== rp.apta)) ruim(id, 'a situação, a cria ao pé ou a aptidão', escolher(rp, ['situacao_reprodutiva', 'cria_ao_pe', 'apta']), escolher(m, ['situacao_reprodutiva', 'cria_ao_pe', 'apta']));
      const c = (de.get('agenda:c|' + id) || [])[0];
      const cf = (f.data.sanitario || {}).carencia;
      if (((c && c.fim) || null) !== ((cf && cf.fim) || null)) ruim(id, 'o fim da carência', cf, c);
    });
  }
  Object.keys(T.fichas).forEach((id) => {
    const f = de.get('ficha|' + id);
    if (!f || f.recusa) return;
    const e = sis.api('inventario.elegiveis', { tipo: 'PESAGEM', data: T.fichas[id] });
    if (!e.ok || !Array.isArray(e.data.itens)) return;
    const x = e.data.itens.find((i) => i.animal_id === id);
    if (!x) return;
    contar('viagem no tempo: ficha de quem saiu × elegíveis do dia da saída');
    if ((f.geral.brinco || null) !== (x.brinco || null)) ruim(id, 'o brinco no dia da saída (' + T.fichas[id] + ')', f.geral.brinco, x.brinco);
    if (((f.geral.categoria || {}).nome || null) !== (x.categoria || null)) ruim(id, 'a categoria no dia da saída (' + T.fichas[id] + ')', f.geral.categoria, x.categoria);
  });
  return out;
}
/** O retrato em D depois do passo k: a bateria, a impressão de cada unidade, o relógio adiantado e o caminho padrão. */
function retratoTempo(sis, S, k, pedido) {
  const D = pedido.D;
  const vivos = Array.from(S.animais.values()).filter((a) => a.situacao_cadastral !== 'EXTERNO').sort((a, b) => cmp(a.codigo_interno || '', b.codigo_interno || ''));
  const nEv = (id) => (indiceTempo(S).evsPor.get(id) || []).length;
  const T = {
    D, k0: k, avanco: pedido.avanco,
    animais: vivos.map((a) => a.animal_id),
    amostra: vivos.slice().sort((a, b) => nEv(b.animal_id) - nEv(a.animal_id) || cmp(a.codigo_interno || '', b.codigo_interno || '')).slice(0, 8).map((a) => a.animal_id),
    pastos: S.t.PASTOS.map((p) => p.pasture_id).sort(),
    estacoes: (S.t.ESTACOES_MONTA || []).map((x) => x.estacao_id).sort().slice(0, 3),
    categoria: (S.t.CATEGORIAS.filter((c) => c.ativo !== false).sort((a, b) => (a.prioridade || 0) - (b.prioridade || 0))[0] || {}).category_id || null,
    fichas: {},
  };
  vivos.filter((a) => SAIDAS_DO_REBANHO_T.indexOf(a.situacao_cadastral) >= 0 && a.data_saida).slice(0, 4).forEach((a) => { T.fichas[a.animal_id] = a.data_saida; });
  const bat = bateriaTempo(sis, T);
  const out = bat.internos.slice(0, 1).map((x) => falha('TEMPO:INTERNO', x));
  T.base = new Map(bat.map((u) => [u.chave, { grupo: u.grupo, animal: u.animal, D: u.D, fp: digitalUnidade(S, u), fpSemAtivoCat: u.grupo === 'posA' ? digitalUnidade(S, u, true) : null, valor: u.valor }]));
  sis.tempo = T;
  contar('viagem no tempo: retratos');
  // O relógio adiantado: a resposta pedida numa data D não depende de que dia é hoje.
  const agora = sis.gas.clock.now;
  sis.gas.clock.now = agora + pedido.avanco * 86400000;
  let adiantada;
  try { adiantada = bateriaTempo(sis, T); } finally { sis.gas.clock.now = agora; }
  out.push(...mesmaBateria('RELOGIO', T, bat, adiantada));
  contar('viagem no tempo: unidades com o relógio adiantado', bat.length);
  // Em D = hoje, o caminho padrão (sem a data) é o mesmo que o caminho com a data.
  if (D === HOJE) { out.push(...mesmaBateria('PADRAO', T, bat, bateriaTempo(sis, T, { semData: true }))); contar('viagem no tempo: caminho padrão conferido'); }
  out.push(...estruturaTempo(T, bat));
  out.push(...cruzarFicha(sis, T, bat));
  return out;
}
/**
 * A categoria desativada depois de D (só a marca de ativa mudou): a reclassificação manual que valia em D continua valendo
 * nela (02, política `escrita`: o alvo desativado mais tarde continua válido no histórico); a automática segue a regra de
 * hoje (desenho-base 4.3) e fica fora.
 */
function categoriaDesativada(sis, A, S) {
  const antes = new Map(A.t.CATEGORIAS.map((c) => [c.category_id, c]));
  const desativadas = S.t.CATEGORIAS.filter((c) => { const b = antes.get(c.category_id); return b && b.ativo !== false && c.ativo === false; });
  if (!desativadas.length) return [];
  const outras = S.t.CATEGORIAS.some((c) => { const b = antes.get(c.category_id); return !b || JSON.stringify(sem(semCarimbo(b), ['ativo'])) !== JSON.stringify(sem(semCarimbo(c), ['ativo'])); });
  if (outras) return [];
  const T = sis.tempo;
  const out = [];
  const ids = new Set(desativadas.map((c) => c.category_id));
  T.base.forEach((b) => {
    if (b.grupo !== 'posA' || !b.valor || !b.valor.categoria || b.valor.categoria.manual !== true || !ids.has(b.valor.categoria.category_id)) return;
    if (digitalUnidade(S, b, true) !== b.fpSemAtivoCat) return;
    const r = sis.api('inventario.posicao', { data: b.D, animal_id: b.animal });
    contar('viagem no tempo: categoria manual da data depois de desativada');
    const c = r.ok ? r.data.categoria : null;
    if (!c || c.category_id !== b.valor.categoria.category_id || c.manual !== true) out.push(falha('TEMPO:CATEGORIA_DESATIVADA', 'em ' + b.D + ', ' + b.animal + ' estava reclassificado à mão em ' + b.valor.categoria.nome + '; desativada a categoria depois, a posição daquela data diz ' + curto(c)));
  });
  return out;
}
/** O que o passo mudou, em relação a D: fatos depois de D, fatos até D (retroativos) e cadastros. */
function naturezaDoPasso(A, S, D) {
  let depois = 0;
  let ate = 0;
  S.t.EVENTOS.forEach((e) => {
    if ((A.vig.get(e.event_id) || false) === (S.vig.get(e.event_id) || false)) return;
    if (e.event_type === 'ESTORNO') return;
    if (e.event_date <= D || ehRetro(e)) ate++; else depois++;
  });
  return { depois, ate };
}
/** Depois de um passo que gravou: as unidades com a impressão do retrato têm a mesma resposta. */
function compararTempo(sis, A, S, cmd) {
  const T = sis.tempo;
  const comparaveis = [];
  T.base.forEach((b, chave) => { if (digitalUnidade(S, b) === b.fp) comparaveis.push(chave); });
  if (!comparaveis.length) return [];
  const grupos = new Set(comparaveis.map((c) => T.base.get(c).grupo));
  if (grupos.has('pasto')) grupos.add('pastos');
  const bat = bateriaTempo(sis, T, { grupos });
  const m = new Map(bat.map((u) => [u.chave, u]));
  const out = bat.internos.slice(0, 1).map((x) => falha('TEMPO:INTERNO', x));
  const nat = naturezaDoPasso(A, S, T.D);
  let comparadas = 0;
  comparaveis.forEach((chave) => {
    const b = T.base.get(chave);
    const u = m.get(chave);
    if (!u) return;
    comparadas++;
    const d = primeiraDiferenca(b.valor, u.valor, chave);
    if (d && out.length < 3) {
      const porque = nat.ate ? nat.ate + ' fato(s) até ' + b.D + ' noutros animais' : nat.depois ? nat.depois + ' fato(s) depois de ' + b.D : 'só cadastro (' + (cmd.rotulo || cmd.rota) + ')';
      out.push(falha('TEMPO:' + b.grupo, 'a consulta em ' + b.D + ' (retrato do passo ' + T.k0 + ') mudou com ' + (cmd.rotulo || cmd.rota) + ' [' + porque + ']: ' + d.caminho + ' ' + curto(d.antes) + ' → ' + curto(d.depois)));
    }
  });
  contar('viagem no tempo: unidades comparadas', comparadas);
  if (comparadas) {
    if (nat.depois && !nat.ate) contar('viagem no tempo: comparação depois de fato posterior a D');
    if (!nat.depois && !nat.ate) contar('viagem no tempo: comparação depois de cadastro');
    if (nat.ate) contar('viagem no tempo: comparação depois de fato retroativo noutros animais');
    if (/^evento\.(corrigir|estornar)$/.test(cmd.rota) && nat.depois && !nat.ate) contar('viagem no tempo: comparação depois de estorno ou correção posterior a D');
  }
  return out;
}
/**
 * O ponto único (Timeline.retratoEm: o projetor do estado de hoje sobre os fatos até D) em D = hoje é a projeção gravada, em
 * todo campo projetado de todo animal: o retrato de uma data passada e o estado de hoje saem da mesma conta.
 */
function oraculoRetratoDeHoje(sis, S) {
  const { G, gas } = sis;
  const retratos = js(gas.exec(() => G.UnitOfWork.read(G.Api.contexto({ usuario: USUARIO }), {
    rota: 'teste.retratos', reads: G.AnimalService.leituras(), acessoCru: true,
    tratador: (tx) => {
      const f = G.Timeline.fonte(tx);
      const filhos = {};
      const vivos = tx.repo.vigentes('ANIMAIS');
      vivos.forEach((a) => { if (a.mae_id) (filhos[a.mae_id] = filhos[a.mae_id] || []).push(a.animal_id); });
      const out = {};
      vivos.forEach((a) => { if (a.situacao_cadastral !== 'EXTERNO') out[a.animal_id] = G.Timeline.retratoEm(f, a.animal_id, tx.hoje, filhos[a.animal_id] || []); });
      return out;
    },
  }).dados));
  const out = [];
  // O custo de aquisição fica fora do retrato (o da permanência atual, 03a DL-08; as consultas numa data não leem o financeiro).
  const campos = PROJETADOS.filter((c) => c !== 'custo_aquisicao' && c !== 'custo_aquisicao_origem');
  Object.keys(retratos).forEach((id) => {
    const a = S.animais.get(id) || {};
    const r = retratos[id] || {};
    const dif = campos.filter((c) => norm(r[c]) !== norm(a[c]));
    if (dif.length && out.length < 2) out.push(falha('TEMPO:RETRATO_DE_HOJE', a.codigo_interno + ': o retrato de hoje (Timeline.retratoEm) difere da projeção gravada: ' + dif.map((c) => c + ' ' + JSON.stringify(a[c]) + ' (gravada) × ' + JSON.stringify(r[c]) + ' (retrato)').join('; ')));
  });
  contar('viagem no tempo: retratos de hoje conferidos com a projeção', Object.keys(retratos).length);
  return out;
}
// ------------------------------------------------------------------ resolvedor único (conserto pela garantia, etapa 2) ----
/**
 * Os caminhos que acham o animal por um texto numa data pela rota (CONTRATOS, seção 47): o curral (pesagem), o tronco
 * (diagnóstico, só fêmeas) e o seletor de um formulário de movimento. A busca do topo e a da curva são o mesmo pedido sem tipo.
 */
const CAMINHOS_RESOLVER = [['curral', { tipo: 'PESAGEM' }], ['tronco', { tipo: 'REPRODUCAO', sexo: 'F' }], ['seletor', { tipo: 'TRANSFERENCIA' }], ['busca', {}]];
/**
 * Os textos difíceis do rebanho do modelo: todo número de brinco que já foi gravado (o reaproveitado, o trocado, o lançado
 * errado), com e sem o zero à esquerda, o código interno inteiro e o atalho dele, o nome dos animais de referência e um
 * número que nunca existiu. Até 160.
 */
function textosDificeis(S, extra) {
  const t = new Set(extra || []);
  (S.t.IDENTIFICACOES || []).filter((x) => x.tipo === 'BRINCO' && x.codigo).forEach((x) => {
    const c = String(x.codigo);
    t.add(c);
    if (/^\d+$/.test(c)) { t.add('0' + c); t.add(String(Number(c))); }
  });
  Array.from(S.animais.values()).forEach((a) => {
    if (a.codigo_interno) { t.add(a.codigo_interno); t.add(a.codigo_interno.slice(2)); }
    if (a.situacao_cadastral === 'EXTERNO' && a.nome) t.add(a.nome);
  });
  t.add('9999999');
  return Array.from(t).filter(Boolean).slice(0, 160);
}
const CAMPOS_CONFERENCIA = ['brinco', 'brinco_hoje', 'pasture_id', 'categoria', 'ultimo_peso', 'codigo_interno', 'sexo'];
/**
 * O oráculo "todos os caminhos dão o mesmo animal para o mesmo texto e data", numa data D: (1) o curral, o tronco, o seletor e
 * a busca dão a mesma resposta a cada texto (o mesmo animal, ou a mesma recusa com a mesma explicação; RESOLVER:CAMINHOS);
 * (2) a posição da data (inventario.elegiveis, a conferência e o "Pesar este") dá a cada número do dia o mesmo animal que o
 * resolvedor, e o descreve do mesmo jeito (RESOLVER:POSICAO, RESOLVER:CONFERENCIA); (3) o achado pelo número e no rebanho
 * em D está na posição de D com esse número.
 */
function oraculoResolucao(sis, S, D) {
  const out = [];
  const marco = S.marco || D0;
  const datas = Array.from(new Set([D, HOJE]));
  const norm = (x) => { const v = String(x).trim().toUpperCase().replace(/\s+/g, ''); return /^\d+$/.test(v) ? String(Number(v)) : v; };
  datas.forEach((data) => {
    const pos = data >= marco ? sis.api('inventario.elegiveis', { tipo: 'PESAGEM', data }) : null;
    const itens = pos && pos.ok && pos.data.itens ? pos.data.itens : [];
    const textos = textosDificeis(S, itens.map((x) => x.brinco).filter(Boolean));
    const respostas = CAMINHOS_RESOLVER.map(([nome, op]) => [nome, sis.api('animal.resolver', Object.assign({ data, textos }, op))]);
    const ruim = respostas.find(([, r]) => !r.ok);
    if (ruim) { out.push(falha('RESOLVER:ROTA', ruim[0] + ' em ' + data + ': ' + JSON.stringify(ruim[1].error).slice(0, 600))); return; }
    const base = respostas[0][1].data;
    const chave = (x) => JSON.stringify([x.situacao, x.codigo, x.animal_id, x.como, x.candidatos, x.mensagem]);
    textos.forEach((t, i) => {
      const b = base.textos[i];
      respostas.slice(1).forEach(([nome, r]) => {
        const x = r.data.textos[i];
        if (chave(x) !== chave(b) && out.length < 3) out.push(falha('RESOLVER:CAMINHOS', '"' + t + '" em ' + data + ': curral ' + chave(b) + ' × ' + nome + ' ' + chave(x)));
      });
    });
    contar('resolvedor: textos conferidos em todos os caminhos', textos.length);
    const porTexto = new Map(textos.map((t, i) => [t, base.textos[i]]));
    // A posição da data: cada número do dia é do animal que o resolvedor acha, descrito do mesmo jeito.
    itens.forEach((it) => {
      if (it.brinco) {
        const x = porTexto.get(it.brinco);
        if (x && (x.situacao !== 'ACHADO' || x.animal_id !== it.animal_id) && out.length < 3) out.push(falha('RESOLVER:POSICAO', 'em ' + data + ' a posição dá o ' + it.brinco + ' a ' + it.codigo_interno + ', e o resolvedor ' + chave(x)));
        else if (x) contar('resolvedor: números da posição conferidos');
      }
      const e = base.animais[it.animal_id];
      if (!e) return;
      const dif = CAMPOS_CONFERENCIA.filter((c) => JSON.stringify(e[c]) !== JSON.stringify(it[c]));
      if ((dif.length || e.presente !== true) && out.length < 3) out.push(falha('RESOLVER:CONFERENCIA', it.codigo_interno + ' em ' + data + ': o resolvedor descreve ' + JSON.stringify(e) + ', a posição ' + JSON.stringify(it)));
      else contar('resolvedor: animais descritos igual na posição');
    });
    // O achado pelo número e no rebanho em D está na posição de D com esse número.
    if (pos && pos.ok && !pos.data.motivo) {
      const naPos = new Map(itens.map((x) => [x.animal_id, x]));
      textos.forEach((t) => {
        const x = porTexto.get(t);
        if (!x || x.situacao !== 'ACHADO' || (x.como !== 'BRINCO' && x.como !== 'SEM_ZEROS')) return;
        const e = base.animais[x.animal_id];
        if (!e || e.presente !== true) return;
        const it = naPos.get(x.animal_id);
        if ((!it || !it.brinco || norm(it.brinco) !== norm(t)) && out.length < 3) out.push(falha('RESOLVER:POSICAO', '"' + t + '" em ' + data + ' acha ' + x.animal_id + ' no rebanho, e a posição ' + (it ? 'dá a ele o ' + it.brinco : 'não o tem')));
      });
    }
  });
  return out;
}
/**
 * A importação de verdade: cada linha importada de um arquivo de manejo ou de saída foi para o animal que o resolvedor acha
 * pelo mesmo texto na data da linha (RESOLVER:IMPORTACAO). Roda ao concluir a importação.
 */
const IMPORTA_POR_BRINCO = ['PESAGENS', 'SANIDADE', 'REPRODUCAO', 'OCORRENCIAS', 'MORTES', 'TRANSFERENCIAS', 'VENDAS'];
function oraculoResolucaoImportacao(sis, S, i, erro) {
  if (IMPORTA_POR_BRINCO.indexOf(i.tipo) < 0) return;
  const linhas = (S.t.IMPORTACAO_LINHAS || []).filter((l) => l.import_id === i.import_id && l.status === 'IMPORTADA');
  const animalDe = (l) => {
    const id = l.entity_id_gerado;
    const x = (S.t.PESAGENS || []).find((y) => y.weight_id === id) || (S.t.SANIDADE || []).find((y) => y.health_id === id)
      || (S.t.REPRODUCAO || []).find((y) => y.reproduction_id === id) || S.t.EVENTO_ANIMAIS.find((y) => y.event_animal_id === id);
    return x ? x.animal_id : null;
  };
  const porData = new Map();
  linhas.forEach((l) => {
    const v = l.dados_originais_json || {};
    const data = deBr(v.data);
    const a = animalDe(l);
    if (!v.brinco || v.codigo || !data || !a) return;
    if (!porData.has(data)) porData.set(data, []);
    porData.get(data).push({ l, texto: String(v.brinco), a });
  });
  porData.forEach((ls, data) => {
    const r = sis.api('animal.resolver', { data, textos: ls.map((x) => x.texto) });
    if (!r.ok) { erro('o resolvedor recusou a data ' + data + ': ' + JSON.stringify(r.error).slice(0, 300)); return; }
    ls.forEach((x, k) => {
      const y = r.data.textos[k];
      if (y.situacao !== 'ACHADO' || y.animal_id !== x.a) erro('RESOLVER:IMPORTACAO linha ' + x.l.linha_num + ': o ' + x.texto + ' de ' + data + ' foi para ' + x.a + ', e o resolvedor ' + JSON.stringify([y.situacao, y.codigo, y.animal_id, y.mensagem]));
      else contar('resolvedor: linhas importadas no animal do resolvedor');
    });
  });
}
/** O oráculo inteiro, depois de um passo: compara o retrato em curso (se o passo gravou) e tira o retrato pedido. */
function oraculoTempo(sis, cmd, A, S, k, gravou) {
  const out = [];
  if (gravou) out.push(...oraculoRetratoDeHoje(sis, S));
  if (sis.tempo && gravou) out.push(...compararTempo(sis, A, S, cmd));
  if (sis.tempo && gravou && cmd.rota === 'categoria.salvar') out.push(...categoriaDesativada(sis, A, S));
  if (cmd.tempo) out.push(...retratoTempo(sis, S, k, cmd.tempo));
  // Conserto pela garantia, etapa 2 (CONTRATOS, seção 47): no mesmo passo sorteado, o resolvedor único em D e hoje.
  if (cmd.tempo) out.push(...oraculoResolucao(sis, S, cmd.tempo.D));
  return out;
}
/** O retrato pedido no passo k (gerador à parte: as sequências das sementes não mudam), ou null. */
function escolherTempo(sis, S, rt, k) {
  const x = rt();
  if (k < 2 || (sis.tempo ? x > 0.07 : x > 0.5)) return null;
  const marco = S.marco || D0;
  const datas = S.t.EVENTOS.filter((e) => S.vig.get(e.event_id) && e.event_type !== 'ESTORNO' && e.event_date >= marco && e.event_date <= HOJE).map((e) => e.event_date);
  const y = rt();
  let D;
  if (y < 0.45 && datas.length) D = somaDias(sorteio(rt, datas), sorteio(rt, [0, 0, -1, 1]));
  else if (y < 0.8) D = somaDias(marco, Math.floor(rt() * (diasEntre(marco, HOJE) + 1)));
  else if (y < 0.92) D = HOJE;
  else if (y < 0.96) D = marco;
  else D = somaDias(marco, -1 - Math.floor(rt() * 60));
  return { D: D > HOJE ? HOJE : D, avanco: sorteio(rt, [1, 31, 200, 400]) };
}

// ------------------------------------------------------------------ correção e fato congelado ----
/**
 * Oráculo da correção (conserto da Fase 3 pela garantia: a correção e o fato congelado; CONTRATOS, seção 50). Num passo
 * sorteado por um gerador à parte (`cmd.correcao`, gravado na sequência para a repetição e o encolhimento: as sequências das
 * sementes não mudam), sobre o estado do passo e voltando a ele no fim (gas.estado: o ensaio não deixa rastro), o oráculo
 * muda cadastros como o dono faria (o produto, o protocolo, os parâmetros, a política de avisos, o período fechado, a
 * categoria, o pasto, o parceiro, o item de lista, a estação e a propriedade) e então corrige eventos vigentes sorteados de
 * todos os tipos:
 *  (b1) SEM MUDANÇA (a entrada do próprio lançamento: a do gerador ou a remontada pelas linhas gravadas, e a que o servidor
 *       devolve para a correção em evento.obter): a correção é aceita, salvo as recusas documentadas (a política de avisos
 *       de hoje e o acerto de estoque sem o controle), e os fatos gravados do substituto são os do original, menos os
 *       metadados de versão e auditoria (META_CORRECAO); nenhum outro registro muda; os animais e os produtos ficam iguais;
 *  (b4) as consultas — a bateria da viagem no tempo em D = hoje e na data do evento, e a lista dos lançamentos que valem —
 *       depois da correção sem mudança são as de antes.
 */
const META_CORRECAO = {
  EVENTOS: ['event_id', 'op_id', 'event_seq', 'registration_date', 'status', 'created_by', 'source', 'idempotency_key', 'reversal_of_event_id', 'reversed_by_event_id', 'import_id', 'created_at', 'confirmed_at'],
  EVENTO_ANIMAIS: ['event_animal_id', 'event_id'],
  IDENTIFICACOES: ['ident_id', 'event_id', 'created_at'],
  PESAGENS: ['weight_id', 'event_id'],
  REPRODUCAO: ['reproduction_id', 'event_id'],
  BAIXAS: ['baixa_id', 'event_id'],
  AJUSTES: ['ajuste_id', 'event_id'],
  SANIDADE: ['health_id', 'event_id'],
  MOVIMENTOS_ESTOQUE: ['mov_id', 'event_id', 'created_at'],
  COMPRAS: ['purchase_id', 'event_id'],
  VENDAS: ['sale_id', 'event_id'],
  FINANCEIRO: ['financial_id', 'event_id', 'created_at', 'status', 'cancelado_em', 'cancelado_por_event_id'],
  PARCELAS: ['parcela_id', 'financial_id', 'created_at'],
  RATEIOS: ['rateio_id', 'event_id', 'financial_id', 'escopo_ref', 'created_by', 'created_at'],
  ALOCACOES_FINANCEIRAS: ['alloc_id', 'rateio_id', 'financial_id'],
  ANEXOS: ['anexo_id', 'entity_id', 'event_id'],
};
const TABELAS_DO_EVENTO = ['EVENTO_ANIMAIS', 'IDENTIFICACOES', 'PESAGENS', 'REPRODUCAO', 'BAIXAS', 'AJUSTES', 'SANIDADE', 'MOVIMENTOS_ESTOQUE', 'COMPRAS', 'VENDAS', 'ANEXOS'];
const porJson = (a, b) => cmp(JSON.stringify(a), JSON.stringify(b));
/** Um registro sem os metadados (as colunas em ordem; vazio = null). */
function semMeta(aba, r) {
  const o = {};
  Object.keys(r).sort().forEach((c) => { if ((META_CORRECAO[aba] || []).indexOf(c) < 0) o[c] = r[c] === undefined || r[c] === '' ? null : r[c]; });
  return o;
}
/** Troca no valor os identificadores do mapa pelo rótulo (os lançamentos do evento, citados no payload). */
function trocarIds(v, mapa) {
  if (typeof v === 'string') return mapa.has(v) ? mapa.get(v) : v;
  if (Array.isArray(v)) return v.map((x) => trocarIds(x, mapa));
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = trocarIds(v[k], mapa); }); return o; }
  return v;
}
/** Os identificadores das linhas de detalhe de um evento (o substituto grava outras): metadados nas respostas das consultas. */
const IDS_DE_LINHA = new Set(['weight_id', 'weight_de', 'weight_ate', 'health_id', 'reproduction_id', 'mov_id', 'financial_id', 'event_animal_id', 'ident_id', 'ajuste_id', 'baixa_id', 'parcela_id', 'rateio_id', 'alloc_id', 'anexo_id', 'purchase_id', 'sale_id', 'op_id']);
function semIdsDeLinha(v) {
  if (Array.isArray(v)) return v.map(semIdsDeLinha);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach((k) => { if (!IDS_DE_LINHA.has(k)) o[k] = semIdsDeLinha(v[k]); }); return o; }
  return v;
}
/**
 * Os fatos gravados de um evento, sem os metadados: o cabeçalho (o payload sem os avisos aceitos), as linhas de cada tabela
 * (em ordem canônica) e os lançamentos com as parcelas, o rateio e as alocações.
 */
function fatosDoEvento(S, eid) {
  const ev = S.ev.get(eid);
  const fins = S.t.FINANCEIRO.filter((f) => f.event_id === eid).map((f) => {
    const parcelas = S.t.PARCELAS.filter((p) => p.financial_id === f.financial_id).map((p) => semMeta('PARCELAS', p)).sort(porJson);
    const rateios = S.t.RATEIOS.filter((r) => r.financial_id === f.financial_id).map((r) => Object.assign(semMeta('RATEIOS', r), { alocacoes: S.t.ALOCACOES_FINANCEIRAS.filter((a) => a.rateio_id === r.rateio_id).map((a) => semMeta('ALOCACOES_FINANCEIRAS', a)).sort(porJson) }));
    return { id: f.financial_id, v: Object.assign(semMeta('FINANCEIRO', f), { parcelas, rateios }) };
  }).sort((a, b) => porJson(a.v, b.v));
  const mapa = new Map(fins.map((x, i) => [x.id, '@lancamento' + i]));
  const cab = semMeta('EVENTOS', ev);
  // No payload, os avisos aceitos e a justificativa da correção são da auditoria do comando, não do fato.
  const pj = sem(ev.payload_json || {}, ['avisos_aceitos', 'justificativa']);
  cab.payload_json = Object.keys(pj).length ? trocarIds(pj, mapa) : null;
  const out = { EVENTOS: cab, FINANCEIRO: fins.map((x) => x.v) };
  // Os anexos removidos ficam no original, como histórico: passam ao substituto só os que valem (FileService.anexosDoSubstituto).
  TABELAS_DO_EVENTO.forEach((aba) => { out[aba] = (S.t[aba] || []).filter((r) => r.event_id === eid && (aba !== 'ANEXOS' || r.status === 'ATIVO')).map((r) => trocarIds(semMeta(aba, r), mapa)).sort(porJson); });
  return out;
}
/** Os registros de todas as tabelas de eventos que não são do evento (nem dos lançamentos dele), pela chave. */
function outrosRegistros(S, eids) {
  const de = new Set(eids);
  const fins = new Set(S.t.FINANCEIRO.filter((f) => de.has(f.event_id)).map((f) => f.financial_id));
  const rats = new Set(S.t.RATEIOS.filter((r) => fins.has(r.financial_id)).map((r) => r.rateio_id));
  const out = new Map();
  const pk = { EVENTOS: 'event_id', EVENTO_ANIMAIS: 'event_animal_id', IDENTIFICACOES: 'ident_id', PESAGENS: 'weight_id', REPRODUCAO: 'reproduction_id', BAIXAS: 'baixa_id', AJUSTES: 'ajuste_id', SANIDADE: 'health_id', MOVIMENTOS_ESTOQUE: 'mov_id', COMPRAS: 'purchase_id', VENDAS: 'sale_id', FINANCEIRO: 'financial_id', PARCELAS: 'parcela_id', RATEIOS: 'rateio_id', ALOCACOES_FINANCEIRAS: 'alloc_id', ANEXOS: 'anexo_id' };
  Object.keys(pk).forEach((aba) => (S.t[aba] || []).forEach((r) => {
    if (de.has(r.event_id) || (aba === 'PARCELAS' && fins.has(r.financial_id)) || (aba === 'ALOCACOES_FINANCEIRAS' && rats.has(r.rateio_id))) return;
    out.set(aba + ':' + r[pk[aba]], JSON.stringify(r));
  }));
  return out;
}
/** Os animais e os produtos (todas as colunas menos o carimbo de atualização; a origem do animal no substituto = no original). */
function cadastrosProjetados(S, troca) {
  const out = new Map();
  S.t.ANIMAIS.forEach((a) => { const o = sem(a, ['updated_at']); if (troca && o.evento_origem_id === troca[1]) o.evento_origem_id = troca[0]; out.set('ANIMAIS:' + a.animal_id, JSON.stringify(o)); });
  (S.t.PRODUTOS || []).forEach((p) => out.set('PRODUTOS:' + p.product_id, JSON.stringify(sem(p, ['updated_at']))));
  return out;
}
function diferencasDeMapa(a, b) {
  const out = [];
  a.forEach((v, k) => { if (b.get(k) !== v) out.push({ k, antes: v, depois: b.has(k) ? b.get(k) : '(sumiu)' }); });
  b.forEach((v, k) => { if (!a.has(k)) out.push({ k, antes: '(não havia)', depois: v }); });
  return out;
}
/**
 * As entradas sem mudança de um evento: a que o servidor devolve para a correção (evento.obter: `correcao`, a prévia da tela)
 * e, quando há, a do gerador (o pedido como foi aceito no registro: o reenvio de um cliente da API).
 */
function entradasSemMudanca(sis, e) {
  const out = [];
  const r = sis.api('evento.obter', { event_id: e.event_id });
  if (r.ok && r.data.correcao) out.push({ origem: 'servidor', dados: sem(js(r.data.correcao), ['criados']) });
  else out.push({ origem: 'servidor', erro: r.ok ? 'evento.obter sem a entrada da correção' : r.error.code + ' ' + r.error.message });
  const memo = sis.specs.get(e.event_id);
  if (memo) { try { out.push({ origem: 'gerador', dados: montarDados(sis, js(memo.spec)) }); } catch (x) { /* a especificação não monta mais: fica a do servidor */ } }
  return out;
}
/** Corrige com a chave dada, aceitando os avisos (e escrevendo a justificativa do período fechado quando pedida). */
function corrigirAceitando(sis, dados, chave) {
  const extra = { idempotencyKey: chave, avisosAceitos: AVISOS };
  let r = sis.api('evento.corrigir', dados, extra);
  if (!r.ok && r.error && r.error.code === 'NEEDS_CONFIRMATION') {
    const codigos = Array.from(new Set((r.error.details || []).map((d) => d.codigo)));
    const d2 = codigos.indexOf('PERIODO_BLOQUEADO') >= 0 ? Object.assign({}, dados, { justificativa_aviso: 'Conferido com o pecuarista' }) : dados;
    r = sis.api('evento.corrigir', d2, Object.assign({}, extra, { avisosAceitos: extra.avisosAceitos.concat(codigos) }));
  }
  return r;
}
/**
 * As recusas que o desenho manda também para a correção sem mudança (documentadas na seção 50): o aviso que a política de
 * hoje bloqueia (`avisos_politica`: vale para todo comando; a carência na venda para abate segue a política) e o acerto de
 * estoque do produto que deixou de controlar o estoque (PRODUTO_SEM_ESTOQUE, decisão da seção 45).
 */
function recusaDocumentada(S, e, r) {
  if (!r.error || r.error.code !== 'VALIDATION') return false;
  const pol = politicaDe(S);
  const codigos = (r.error.details || []).map((d) => d.codigo);
  return codigos.length > 0 && codigos.every((c) => (pol[c] || (c === 'CARENCIA_ATIVA' ? 'BLOQUEIA' : 'AVISA')) === 'BLOQUEIA' || (c === 'PRODUTO_SEM_ESTOQUE' && e.event_type === 'ESTOQUE' && e.event_subtype === 'AJUSTE'));
}
/** As consultas da bateria da viagem no tempo em D (sem a lista dos lançamentos, conferida à parte pela lista dos que valem). */
const GRUPOS_B4 = new Set(['pos', 'posA', 'eleg', 'pasto', 'pastos', 'painel', 'perm', 'agenda', 'ind', 'mat', 'matE', 'desemp', 'dash', 'ficha']);
function bateriaCorrecao(sis, S, D) {
  const vivos = Array.from(S.animais.values()).filter((a) => a.situacao_cadastral !== 'EXTERNO').sort((a, b) => cmp(a.codigo_interno || '', b.codigo_interno || ''));
  const T = {
    D, animais: vivos.map((a) => a.animal_id), amostra: vivos.slice(0, 6).map((a) => a.animal_id), pastos: S.t.PASTOS.map((p) => p.pasture_id).sort(),
    estacoes: (S.t.ESTACOES_MONTA || []).map((x) => x.estacao_id).sort().slice(0, 2),
    categoria: (S.t.CATEGORIAS.filter((c) => c.ativo !== false).sort((a, b) => (a.prioridade || 0) - (b.prioridade || 0))[0] || {}).category_id || null, fichas: {},
  };
  vivos.filter((a) => SAIDAS_DO_REBANHO_T.indexOf(a.situacao_cadastral) >= 0 && a.data_saida).slice(0, 2).forEach((a) => { T.fichas[a.animal_id] = a.data_saida; });
  const bat = bateriaTempo(sis, T, { grupos: GRUPOS_B4 });
  const lista = sis.api('evento.listar', { por_pagina: 500, vigentes: true });
  const semVazio = (p) => (p && Object.keys(p).length ? p : null);
  const itens = lista.ok ? lista.data.itens.map((x) => sem(Object.assign({}, x, { payload: x.payload ? semVazio(sem(x.payload, ['avisos_aceitos', 'deducoes', 'justificativa'])) : null }), ['event_id', 'event_seq', 'registration_date', 'status', 'vigente', 'created_by', 'source', 'reversal_of_event_id', 'anulado_por', 'created_at'])) : lista.error;
  return bat.concat([{ grupo: 'eventos', chave: 'eventos', valor: itens }]);
}
/**
 * As mudanças de cadastro que o dono faz entre o registro e a correção (o que ela não pode refazer pelo cadastro de hoje):
 * do produto usado (nome, fabricante, carência padrão, custo, categoria, fator, controle de estoque, doses padrão, ativo), do
 * protocolo usado (intervalo, recorrência, nome, idade, ativo; o procedimento, recusado no protocolo cumprido), dos
 * parâmetros (gestação, desmama, arroba, rendimento, validade do peso, UA, brinco, idade reprodutiva, faixas do GMD,
 * tolerância), da política de avisos, do período fechado, da categoria (faixa, peso de referência, nome, ativa), do pasto, do
 * parceiro, do item de lista, da estação (as datas) e da propriedade.
 */
function cadastroDaCorrecao(sis, S, rnd) {
  const usados = (aba, campo) => Array.from(new Set((S.t[aba] || []).filter((r) => S.vig.get(r.event_id) && r[campo]).map((r) => r[campo])));
  const qual = pesado(rnd, [['produto', 5], ['protocolo', 2.5], ['parametro', 3], ['politica', 0.8], ['bloqueio', 0.8], ['categoria', 1.5], ['pasto', 1], ['parceiro', 1], ['lista', 1], ['estacao', 1], ['propriedade', 0.4]]);
  const c = (rota, dados, rotulo) => ({ rota, dados, rotulo });
  if (qual === 'produto') {
    const ids = usados('SANIDADE', 'produto_id').concat(usados('MOVIMENTOS_ESTOQUE', 'product_id'), usados('FINANCEIRO', 'product_id'));
    const p = (S.t.PRODUTOS || []).find((x) => x.product_id === sorteio(rnd, ids)) || sorteio(rnd, S.t.PRODUTOS || []);
    if (!p) return null;
    const campo = sorteio(rnd, ['nome', 'fabricante', 'carencia_padrao_dias', 'custo_unitario', 'custo_unitario', 'categoria', 'fator_conversao', 'controla_estoque', 'dose_padrao_por_kg', 'dose_padrao_por_cabeca', 'ativo']);
    const v = {
      nome: /\(revisto\)$/.test(p.nome || '') ? String(p.nome).replace(/ \(revisto\)$/, '') : p.nome + ' (revisto)', fabricante: p.fabricante === 'Lab Revisto' ? 'Lab Outro' : 'Lab Revisto',
      carencia_padrao_dias: p.carencia_padrao_dias === 45 ? 10 : 45, custo_unitario: sorteio(rnd, [0.035, 1.85, 2.5, 7.25].filter((x) => x !== p.custo_unitario)),
      categoria: sorteio(rnd, ['VACINA', 'VERMIFUGO', 'MEDICAMENTO', 'SUPLEMENTO', 'OUTRO'].filter((x) => x !== p.categoria)), fator_conversao: p.fator_conversao === 25 ? 50 : 25,
      controla_estoque: p.controla_estoque !== true, dose_padrao_por_kg: p.dose_padrao_por_kg === 0.02 ? 0.05 : 0.02, dose_padrao_por_cabeca: p.dose_padrao_por_cabeca === 5 ? 2 : 5, ativo: false,
    }[campo];
    return c('produto.salvar', { product_id: p.product_id, campos: { [campo]: v }, justificativa: 'Cadastro do produto revisto' }, 'produto ' + campo);
  }
  if (qual === 'protocolo') {
    const ids = usados('SANIDADE', 'protocol_id');
    const p = (S.t.PROTOCOLOS_SANITARIOS || []).find((x) => x.protocol_id === sorteio(rnd, ids)) || sorteio(rnd, S.t.PROTOCOLOS_SANITARIOS || []);
    if (!p) return null;
    const x = rnd();
    const campos = x < 0.3 ? { intervalo_dias: (typeof p.intervalo_dias === 'number' ? p.intervalo_dias : 180) + 45 } : x < 0.45 ? (p.recorrencia_tipo === 'INTERVALO_DIAS' ? { recorrencia_tipo: 'UNICA' } : { recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 90 })
      : x < 0.6 ? { nome: p.nome + ' (revisto)' } : x < 0.72 ? { idade_min_meses: sorteio(rnd, [0, 6, 18]) } : x < 0.88 ? { ativo: false } : { tipo_procedimento: ['VACINA', 'VERMIFUGO', 'MEDICAMENTO', 'EXAME'].filter((v) => v !== p.tipo_procedimento)[0] };
    return c('protocolo.salvar', { protocol_id: p.protocol_id, campos, justificativa: 'Protocolo revisto' }, 'protocolo ' + Object.keys(campos)[0]);
  }
  if (qual === 'parametro') {
    const [chave, op] = sorteio(rnd, [
      ['dias_gestacao', ['270', '290', '300']], ['idade_desmama_padrao_meses', ['3', '8', '12']], ['arroba_kg', ['14.5', '15.5']], ['rendimento_carcaca_padrao_pct', ['48', '55']],
      ['peso_validade_dias', ['30', '400']], ['ua_peso_kg', ['400', '500']], ['brinco_somente_numerico', ['S', 'N']], ['brinco_ignora_zeros_esquerda', ['S', 'N']], ['idade_min_reprodutiva_meses', ['12', '40']],
      ['gmd_plausivel_min_kg_dia', ['-0.5', '0.2']], ['gmd_plausivel_max_kg_dia', ['1', '3']], ['fin_tolerancia_conferencia_pct', ['0', '5']], ['parto_tolerancia_dias', ['0', '30']],
      ['peso_nascer_padrao_kg_macho', ['28', '35']], ['peso_nascer_padrao_kg_femea', ['26', '33']],
    ]);
    return c('config.salvar', { valores: { [chave]: sorteio(rnd, op) } }, 'parâmetro ' + chave);
  }
  if (qual === 'politica') {
    const pol = {};
    alguns(rnd, POLITICAVEIS, 3).forEach((x) => { pol[x] = sorteio(rnd, ['BLOQUEIA', 'AVISA', 'IGNORA']); });
    return c('config.salvar', { valores: { avisos_politica: '{' + Object.keys(pol).sort().map((x) => JSON.stringify(x) + ':' + JSON.stringify(pol[x])).join(',') + '}' } }, 'política de avisos');
  }
  if (qual === 'bloqueio') {
    const datas = S.t.FINANCEIRO.map((f) => f.data_competencia).filter(Boolean);
    return c('config.salvar', { valores: { fin_bloqueio_ate: datas.length && rnd() < 0.7 ? sorteio(rnd, datas) : HOJE } }, 'período fechado');
  }
  if (qual === 'categoria') {
    const cat = sorteio(rnd, S.t.CATEGORIAS);
    if (!cat) return null;
    const x = rnd();
    const campos = x < 0.3 ? { peso_referencia_kg: sorteio(rnd, [180, 320, 450]) } : x < 0.5 ? { nome: cat.nome + ' (revista)' } : x < 0.7 ? { ativo: false } : typeof cat.idade_minima_meses === 'number' ? { idade_minima_meses: cat.idade_minima_meses + 1 } : { descricao: 'Revista' };
    return c('categoria.salvar', { category_id: cat.category_id, campos, justificativa: 'Categoria revista' }, 'categoria ' + Object.keys(campos)[0]);
  }
  if (qual === 'pasto') {
    const ids = Array.from(new Set(S.t.EVENTO_ANIMAIS.filter((l) => S.vig.get(l.event_id)).map((l) => l.pasto_destino_id).filter(Boolean)));
    const p = S.t.PASTOS.find((x) => x.pasture_id === sorteio(rnd, ids)) || sorteio(rnd, S.t.PASTOS);
    return p ? c('pasto.salvar', { pasture_id: p.pasture_id, campos: { status: 'INATIVO' }, justificativa: 'Pasto em reforma' }, 'pasto desativado') : null;
  }
  if (qual === 'parceiro') {
    const p = sorteio(rnd, S.t.PARCEIROS);
    return p ? c('parceiro.salvar', { partner_id: p.partner_id, campos: { ativo: false }, justificativa: 'Parceiro conferido' }, 'parceiro desativado') : null;
  }
  if (qual === 'lista') {
    const usadosL = S.t.LISTAS.filter((l) => l.ativo !== false && LISTAS_USADAS.some(([lista, cod]) => l.lista === lista && l.codigo === cod));
    const it = sorteio(rnd, usadosL);
    return it ? c('lista.salvar', { lista_id: it.lista_id, ativo: false, justificativa: 'Lista revista' }, 'item de lista desativado') : null;
  }
  if (qual === 'estacao') {
    const e = sorteio(rnd, S.t.ESTACOES_MONTA || []);
    if (!e) return null;
    return c('estacao.salvar', { estacao_id: e.estacao_id, campos: { data_inicio: somaDias(e.data_inicio, 20), data_fim: somaDias(e.data_fim, -20) }, justificativa: 'Datas revistas' }, 'estação com outras datas');
  }
  const p = sorteio(rnd, S.t.PROPRIEDADES);
  return p ? c('propriedade.salvar', { property_id: p.property_id, campos: { status: 'INATIVO' }, justificativa: 'Propriedade revista' }, 'propriedade desativada') : null;
}
/** Grava as mudanças de cadastro (cada uma aceitando os avisos); devolve o que foi pedido e o desfecho. */
function mudarCadastros(sis, S, rnd, k) {
  const feitas = [];
  const n = 1 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const m = cadastroDaCorrecao(sis, S, rnd);
    if (!m) continue;
    const extra = { idempotencyKey: 'corr-cad-' + k + '-' + i, avisosAceitos: AVISOS };
    let r = sis.api(m.rota, m.dados, extra);
    if (!r.ok && r.error && r.error.code === 'NEEDS_CONFIRMATION') r = sis.api(m.rota, m.dados, Object.assign({}, extra, { avisosAceitos: AVISOS.concat((r.error.details || []).map((d) => d.codigo)) }));
    feitas.push(m.rotulo + (r.ok ? '' : ' (recusado: ' + ((r.error.details || [])[0] || {}).codigo + ')'));
  }
  return feitas;
}
/**
 * (b2, b3) A correção que muda UM campo (só a mudança, `dados.mudanca`: Correcao.montar sobre a entrada sem mudança do
 * vigente). O contrato que o oráculo confere (CONTRATOS, seção 50, tabela B):
 *  - a anotação do lançamento (`notes`) muda só EVENTOS.notes e, no estoque, a observação do movimento;
 *  - o responsável muda só EVENTOS.responsible e o responsável das baixas;
 *  - a observação de um animal muda só as observações dele (a linha do evento e o registro de detalhe do tipo);
 *  - a data muda os derivados da data, nunca as cópias congeladas do cadastro nem o que não depende dela (b3): na sanidade,
 *    o produto, o nome, o fabricante, a carência, a unidade, o lote, a via, o veterinário, a dose (salvo por peso), o custo
 *    unitário da saída, a conta e a descrição do consumo, e a próxima proposta pelo mesmo intervalo; na entrada de estoque,
 *    o fator, o movimento, a quantidade, o valor e a descrição; no parto, a raça das crias; na venda, o nome do tipo na
 *    descrição proposta de cada dedução; em todo tipo, os animais do lançamento e as observações deles.
 */
function mudancaDeUmCampo(S, e, ent, rnd) {
  const d = ent.dados;
  const op = [];
  op.push('notes', 'responsible');
  if ((d.animais || []).some((x) => x.animal_id) && ['TRANSFERENCIA', 'NASCIMENTO', 'IDENTIFICACAO', 'AJUSTE_INVENTARIO', 'ESTOQUE'].indexOf(e.event_type) < 0) op.push('obs');
  if (e.event_type !== 'ENTRADA_INICIAL' && e.pre_marco_zero !== true) op.push('data', 'data');
  const qual = sorteio(rnd, op);
  if (qual === 'notes') return { rotulo: 'a anotação', mudanca: { campos: { notes: 'Anotação corrigida' } }, pode: (aba, col) => (aba === 'EVENTOS' && col === 'notes') || (aba === 'MOVIMENTOS_ESTOQUE' && col === 'observacoes') };
  if (qual === 'responsible') return { rotulo: 'o responsável', mudanca: { campos: { responsible: 'Zé do curral' } }, pode: (aba, col) => (aba === 'EVENTOS' && col === 'responsible') || (aba === 'BAIXAS' && col === 'responsavel') };
  if (qual === 'obs') {
    const alvo = sorteio(rnd, d.animais.filter((x) => x.animal_id)).animal_id;
    return { rotulo: 'a observação de um animal', mudanca: { animais: [{ animal_id: alvo, observacoes: 'Observação corrigida' }] }, pode: (aba, col, r) => col === 'observacoes' && r && r.animal_id === alvo && ['EVENTO_ANIMAIS', 'SANIDADE', 'PESAGENS', 'BAIXAS', 'REPRODUCAO'].indexOf(aba) >= 0 };
  }
  const nova = somaDias(e.event_date, sorteio(rnd, [-1, 1, -7, -30]));
  if (nova > HOJE || nova < (S.marco || D0)) return null;
  return { rotulo: 'a data (' + e.event_date + ' → ' + nova + ')', data: nova, mudanca: { campos: { event_date: nova } } };
}
/** As cópias congeladas e o que não depende da data, que a correção da data não muda (b3). */
function congeladosNaData(S, e, a, b, nova, erro) {
  const pj = (S.ev.get(e.event_id) || {}).payload_json || {};
  const igual = (oque, x, y) => { if (JSON.stringify(x) !== JSON.stringify(y)) erro(oque + ' ' + curto(x) + ' → ' + curto(y)); };
  const chaveA = (ls) => ls.map((l) => l.animal_id + '/' + (l.papel || 'SUJEITO')).sort();
  igual('os animais do lançamento', chaveA(a.EVENTO_ANIMAIS), chaveA(b.EVENTO_ANIMAIS));
  igual('as observações dos animais', a.EVENTO_ANIMAIS.map((l) => [l.animal_id, l.observacoes]).sort(), b.EVENTO_ANIMAIS.map((l) => [l.animal_id, l.observacoes]).sort());
  if (e.event_type === 'SANIDADE') {
    const fixos = ['produto_id', 'protocol_id', 'tipo_procedimento', 'nome_produto', 'fabricante', 'periodo_carencia_dias', 'unidade_dose', 'lote', 'validade', 'via_aplicacao', 'motivo', 'diagnostico', 'resultado_exame', 'veterinario', 'observacoes'].concat(pj.modo_dose === 'POR_PESO' ? [] : ['dose']);
    const porA = (ls) => ls.map((r) => [r.animal_id].concat(fixos.map((c) => r[c]))).sort();
    igual('a aplicação (o que não depende da data)', porA(a.SANIDADE), porA(b.SANIDADE));
    const saida = (x) => x.MOVIMENTOS_ESTOQUE.filter((m) => m.tipo === 'SAIDA').map((m) => [m.product_id, m.custo_unitario].concat(pj.modo_dose === 'POR_PESO' ? [] : [m.quantidade, m.lote]));
    igual('a saída do frasco (o custo congelado)', saida(a), saida(b));
    const consumo = (x) => x.FINANCEIRO.filter((f) => f.product_id).map((f) => [f.conta_id, f.product_id].concat(pj.modo_dose === 'POR_PESO' ? [String(f.descricao || '').split(':')[0]] : [f.descricao, f.valor, f.quantidade]));
    igual('o consumo (a conta e a descrição congeladas)', consumo(a), consumo(b));
    if (typeof pj.intervalo_protocolo_dias === 'number') b.SANIDADE.forEach((r) => igual('a próxima pelo intervalo congelado', somaDias(nova, pj.intervalo_protocolo_dias), r.data_proxima_aplicacao));
  }
  if (e.event_type === 'ESTOQUE' && e.event_subtype === 'ENTRADA') {
    igual('o fator e o movimento congelados', [pj.fator_conversao, pj.com_movimento], [(b.EVENTOS.payload_json || {}).fator_conversao, (b.EVENTOS.payload_json || {}).com_movimento]);
    const fin = (x) => x.FINANCEIRO.map((f) => [f.conta_id, f.product_id, f.descricao, f.valor, f.quantidade]);
    igual('a compra do insumo', fin(a), fin(b));
    igual('o movimento de entrada', a.MOVIMENTOS_ESTOQUE.map((m) => [m.tipo, m.quantidade, m.custo_unitario]), b.MOVIMENTOS_ESTOQUE.map((m) => [m.tipo, m.quantidade, m.custo_unitario]));
  }
  if (e.event_type === 'NASCIMENTO') {
    const raca = (x) => x.EVENTO_ANIMAIS.filter((l) => l.papel === 'CRIA').map((l) => [l.animal_id, (l.atributos_iniciais_json || {}).raca || null]).sort();
    igual('a raça das crias', raca(a), raca(b));
  }
  if (e.event_type === 'VENDA') {
    const nomes = (x) => x.FINANCEIRO.map((f) => String(f.descricao || '').replace(/ da venda de \d\d\/\d\d\/\d{4}$/, '')).sort();
    igual('o nome do tipo nas descrições das deduções', nomes(a), nomes(b));
  }
}
/** O passo do oráculo da correção (gerador à parte: as sequências das sementes não mudam), ou null. */
function escolherCorrecao(S, rc, k) {
  const x = rc();
  if (k < 3 || x > 0.12) return null;
  return { semente: Math.floor(rc() * 1e9), b4: rc() < 0.4 };
}
const tipoEChave = (e) => e.event_type + (e.event_subtype ? '/' + e.event_subtype : '');
/** O oráculo inteiro num passo: os cadastros mudados, as correções sem mudança e o estado de volta ao do passo. */
function oraculoCorrecao(sis, S0, k, plano) {
  if (S0.emCurso.length) return [];
  const rnd = aleatorio(plano.semente);
  const foto0 = sis.gas.estado.salvar();
  const out = [];
  try {
    const mudancas = mudarCadastros(sis, S0, rnd, k);
    const t = tabelas(sis);
    const S = estado(t);
    const vig = S.t.EVENTOS.filter((e) => S.vig.get(e.event_id) && e.event_type !== 'ESTORNO');
    const porTipo = new Map();
    vig.forEach((e) => { const t2 = tipoEChave(e); if (!porTipo.has(t2)) porTipo.set(t2, []); porTipo.get(t2).push(e); });
    const tipos = Array.from(porTipo.keys()).sort();
    const alvos = alguns(rnd, tipos, 4).map((t2) => sorteio(rnd, porTipo.get(t2)));
    const foto1 = sis.gas.estado.salvar();
    const antesCad = cadastrosProjetados(S, null);
    let b4feito = !plano.b4;
    const casos = [];
    alvos.forEach((e) => entradasSemMudanca(sis, e).forEach((ent) => casos.push({ e, ent })));
    casos.forEach(({ e, ent }, i) => {
      if (ent.erro) { out.push(falha('CORRECAO:ENTRADA', 'o servidor não deu a entrada da correção de ' + tipoEChave(e) + ': ' + ent.erro)); return; }
      const contexto = 'a correção sem mudança (entrada ' + ent.origem + ') de ' + tipoEChave(e) + ' de ' + e.event_date + ' depois de: ' + (mudancas.join('; ') || 'nada') + ' — ';
      const datas = !b4feito ? [HOJE].concat(e.event_date >= (S.marco || D0) && e.event_date < HOJE ? [e.event_date] : []) : [];
      // As chaves em ordem (o mesmo trocarIds dos valores de depois, sem troca).
      const bat0 = datas.map((D) => bateriaCorrecao(sis, S, D).map((u) => Object.assign({}, u, { valor: semIdsDeLinha(u.valor) })));
      const dados = Object.assign(ent.dados, { event_id: e.event_id, justificativa: 'Conferido de novo' });
      const r = corrigirAceitando(sis, dados, 'corr-' + k + '-' + i);
      if (!r.ok) {
        if (r.error && r.error.code === 'INTERNAL') out.push(falha('CORRECAO:INTERNO', contexto + r.error.message));
        else if (!recusaDocumentada(S, e, r)) out.push(falha('CORRECAO:B1:RECUSA:' + tipoEChave(e), contexto + 'recusada: ' + r.error.code + ' ' + JSON.stringify((r.error.details || []).map((d) => d.codigo + ': ' + d.mensagem)).slice(0, 700)));
        else contar('correção: recusa documentada da correção sem mudança');
        sis.gas.estado.restaurar(foto1);
        return;
      }
      contar('correção: sem mudança aceita');
      contar('correção: sem mudança aceita (' + ent.origem + ')');
      const S2 = estado(tabelas(sis));
      const novo = r.data.event_id;
      const a = fatosDoEvento(S, e.event_id);
      const b = fatosDoEvento(S2, novo);
      Object.keys(a).forEach((aba) => {
        const d = primeiraDiferenca(a[aba], b[aba], aba);
        if (d) out.push(falha('CORRECAO:B1:' + tipoEChave(e) + ':' + aba, contexto + 'o fato gravado mudou: ' + d.caminho + ' ' + curto(d.antes) + ' → ' + curto(d.depois)));
      });
      const dOutros = diferencasDeMapa(outrosRegistros(S, [e.event_id]), outrosRegistros(S2, [e.event_id, novo]));
      dOutros.slice(0, 1).forEach((x) => out.push(falha('CORRECAO:B1:OUTROS', contexto + 'outro registro mudou: ' + x.k + ' ' + curto(x.antes) + ' → ' + curto(x.depois))));
      diferencasDeMapa(antesCad, cadastrosProjetados(S2, [e.event_id, novo])).slice(0, 1).forEach((x) => out.push(falha('CORRECAO:B1:PROJECAO', contexto + x.k + ' mudou: ' + curto(x.antes) + ' → ' + curto(x.depois))));
      if (datas.length) {
        b4feito = true;
        // Os identificadores do substituto nas respostas (o evento da entrada, da saída, da pesagem) são os do original.
        const troca = new Map([[novo, e.event_id]]);
        datas.forEach((D, j) => {
          const bat1 = bateriaCorrecao(sis, S2, D).map((u) => Object.assign({}, u, { valor: semIdsDeLinha(trocarIds(u.valor, troca)) }));
          const m1 = new Map(bat1.map((u) => [u.chave, u]));
          let n = 0;
          bat0[j].forEach((u) => {
            const x = m1.get(u.chave);
            const d = primeiraDiferenca(u.valor, x ? x.valor : undefined, u.chave);
            if (d && n++ < 2) out.push(falha('CORRECAO:B4:' + u.grupo, contexto + 'a consulta em ' + D + ' mudou: ' + d.caminho + ' ' + curto(d.antes) + ' → ' + curto(d.depois)));
          });
          contar('correção: consultas conferidas depois da correção sem mudança', bat0[j].length);
        });
      }
      sis.gas.estado.restaurar(foto1);
    });
    // (b2, b3) A mudança de um campo, nos mesmos eventos, pela entrada do servidor (Correcao.montar).
    casos.filter((x) => x.ent.origem === 'servidor' && !x.ent.erro).forEach(({ e, ent }, i) => {
      const mu = mudancaDeUmCampo(S, e, ent, rnd);
      if (!mu) return;
      const contexto = 'a correção de ' + mu.rotulo + ' de ' + tipoEChave(e) + ' de ' + e.event_date + ' depois de: ' + (mudancas.join('; ') || 'nada') + ' — ';
      const r = corrigirAceitando(sis, { event_id: e.event_id, justificativa: 'Um campo corrigido', mudanca: mu.mudanca }, 'corr1-' + k + '-' + i);
      if (!r.ok) {
        if (r.error && r.error.code === 'INTERNAL') out.push(falha('CORRECAO:INTERNO', contexto + r.error.message));
        // A data nova pode valer menos que a de antes (o animal ainda não estava, a contagem do estoque, o período fechado):
        // a recusa com o motivo é do desenho. As demais mudanças de um campo não têm por que ser recusadas.
        else if (!mu.data && !recusaDocumentada(S, e, r)) out.push(falha('CORRECAO:B2:RECUSA:' + tipoEChave(e), contexto + 'recusada: ' + r.error.code + ' ' + JSON.stringify((r.error.details || []).map((d) => d.codigo + ': ' + d.mensagem)).slice(0, 700)));
        sis.gas.estado.restaurar(foto1);
        return;
      }
      contar('correção: mudança de um campo aceita' + (mu.data ? ' (a data)' : ''));
      const S2 = estado(tabelas(sis));
      const a = fatosDoEvento(S, e.event_id);
      const b = fatosDoEvento(S2, r.data.event_id);
      if (mu.data) congeladosNaData(S, e, a, b, mu.data, (m) => out.push(falha('CORRECAO:B3:' + tipoEChave(e), contexto + 'mudou ' + m)));
      else {
        // Fora o campo e os derivados dele, nada muda (linha a linha, coluna a coluna).
        Object.keys(a).forEach((aba) => {
          const la = Array.isArray(a[aba]) ? a[aba] : [a[aba]];
          const lb = Array.isArray(b[aba]) ? b[aba] : [b[aba]];
          if (la.length !== lb.length) { out.push(falha('CORRECAO:B2:' + tipoEChave(e) + ':' + aba, contexto + aba + ' tinha ' + la.length + ' linha(s) e ficou com ' + lb.length)); return; }
          const limpa = (r0) => { const o = {}; Object.keys(r0 || {}).forEach((c) => { if (!mu.pode(aba, c, r0)) o[c] = r0[c]; }); return o; };
          const xa = la.map(limpa).sort(porJson);
          const xb = lb.map(limpa).sort(porJson);
          const dif = primeiraDiferenca(xa, xb, aba);
          if (dif) out.push(falha('CORRECAO:B2:' + tipoEChave(e) + ':' + aba, contexto + 'mudou o que não depende do campo: ' + dif.caminho + ' ' + curto(dif.antes) + ' → ' + curto(dif.depois)));
        });
      }
      sis.gas.estado.restaurar(foto1);
    });
  } catch (x) {
    out.push(falha('CORRECAO:EXCECAO', String(x && x.stack || x).slice(0, 1500)));
  } finally {
    sis.gas.estado.restaurar(foto0);
  }
  return out;
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
  // Fase 3 (modo curral e tronco): o bloco leva a chave própria, guardada no rascunho antes do envio (`chaveFixa`).
  const chave = cmd.chaveFixa || (cmd.chaveDe !== undefined ? chaveDo(cmd.chaveDe) : chaveDo(k));
  if (cmd.rota === 'operacao.status') return executarStatus(sis, cmd, antesT, A, dv0, opcoes);
  // O bloco reenviado com a chave de um bloco já gravado (a resposta perdida) é o mesmo pedido: duplicado, com a resposta
  // do original. A expectativa vem do que este sistema gravou (vale também na sequência encolhida).
  const jaGravada = !!cmd.chaveFixa && sis.chavesGravadas.has(chave) && !cmd.outraChave;
  const extra = { idempotencyKey: chave, avisosAceitos: cmd.avisos || [] };
  if (cmd.dvVelha) extra.dataVersionEsperada = dv0 - 1;
  if (cmd.dvAtual) extra.dataVersionEsperada = dv0;
  let pedidos = [];
  let sim = null;
  if (cmd.simular && !cmd.dvVelha && /^evento\.(registrar|corrigir|estornar)$/.test(cmd.rota)) {
    sim = sis.api('evento.simular', { acao: cmd.rota.split('.')[1], dados: cmd.dados }, { avisosAceitos: cmd.avisos || [] });
  }
  let r;
  // Passada 2: o pedido feito num dia do passado (o cadastro guarda quando foi criado); as consultas dos oráculos, hoje.
  const naHora = (f) => { if (!cmd.relogio) return f(); const agora = sis.gas.clock.now; sis.gas.clock.now = Date.parse(cmd.relogio + 'T14:00:00Z'); try { return f(); } finally { sis.gas.clock.now = agora; } };
  try {
    r = naHora(() => sis.api(cmd.rota, cmd.dados, extra));
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
      r = naHora(() => sis.api(cmd.rota, dados, Object.assign({}, extra, { avisosAceitos: (cmd.avisos || []).concat(codigos) })));
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
    else if (cmd.reenvio || jaGravada) {
      if (!r.meta.duplicado) falhas.push(falha('REENVIO', 'o reenvio com a mesma chave não foi tratado como duplicado'));
      if (dv1 !== dv0 || JSON.stringify(contagens(depoisT)) !== JSON.stringify(contagens(antesT))) falhas.push(falha('REENVIO', 'o reenvio duplicado gravou'));
      if (jaGravada) contar('bloco reenviado depois de gravado');
      if (jaGravada && r.data && r.data.event_id !== sis.chavesGravadas.get(chave)) falhas.push(falha('REENVIO', 'o bloco reenviado respondeu o evento ' + r.data.event_id + ', não o gravado com a chave (' + sis.chavesGravadas.get(chave) + ')'));
    } else if (r.meta && r.meta.duplicado) falhas.push(falha('REENVIO', 'comando novo tratado como duplicado'));
    else if (!r.meta || !r.meta.semAlteracao) {
      falhas.push(...oraculoEfeito(sis, cmd, r.data, A, S));
      falhas.push(...oraculoPeriodo(cmd, A, S, pedidos));
      falhas.push(...oraculoPoliticaGravada(A, S));
      falhas.push(...oraculoAvisosDeTransicao(cmd, A, S, pedidos));
    }
  }
  if (r.ok && cmd.chaveFixa && !jaGravada && !cmd.outraChave && !(r.meta && r.meta.duplicado) && r.data && r.data.event_id) sis.chavesGravadas.set(chave, r.data.event_id);
  if (cmd.estornoImediato) falhas.push(...oraculoEstornoImediato(sis, cmd, r, S, dv0));
  if (cmd.correcaoIdentica) falhas.push(...oraculoCorrecaoIdentica(sis, cmd, r, S, dv0));
  if (cmd.correcaoTardia) { if (r.ok && !cmd.outraChave && !cmd.reenvio) contar('correção tardia aceita'); falhas.push(...oraculoCorrecaoTardia(cmd, r, A)); falhas.push(...oraculoEfeitoCongelado(cmd, r, A, S)); }
  falhas.push(...oraculoProcedimentoProtocolo(cmd, r, A));
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
    // um pasto desativado). Sem o pedido de volta (aceitar = false), o desfecho depois da confirmação não é visto; nem com o
    // pedido de volta sem a justificativa do período fechado (semJustAviso), recusado antes da trava (fuzz das Fases 1 a 3).
    const depoisDaConfirmacao = real === 'NEEDS_CONFIRMATION' && (!cmd.aceitar || semJustificativa(cmd)) && (simulado === 'VALIDATION' || simulado === 'CONFLICT');
    const compativel = simulado === real || depoisDaConfirmacao || (simulado === 'AVISOS' && (real === 'NEEDS_CONFIRMATION' || real === 'OK')) || (simulado === 'OK' && real === 'NEEDS_CONFIRMATION') || real === 'IDEMPOTENCY_MISMATCH';
    if (!compativel) falhas.push(falha('SIMULACAO', 'simulação ' + simulado + ' ' + JSON.stringify(sim.error || '').slice(0, 400) + ' × comando ' + real + ' ' + JSON.stringify(r.error || '').slice(0, 400)));
  }
  const datas = [];
  const d = cmd.dados || {};
  if (d.campos && d.campos.event_date) datas.push(d.campos.event_date, somaDias(d.campos.event_date, -1));
  if (!o.semGlobal) falhas.push(...oraculoGlobal(sis, S, datas));
  // Fuzz das Fases 1 a 3: depois de todo comando que gravou, a agenda sanitária (hoje e na data do lançamento) = o modelo,
  // e os indicadores reprodutivos e as consultas de manejo coerentes.
  if (!o.semGlobal && gravou) {
    falhas.push(...oraculoAgenda(sis, S, HOJE));
    if (datas.length && datas[0] !== HOJE) falhas.push(...oraculoAgenda(sis, S, datas[0]));
    falhas.push(...oraculoManejo(sis, S, r.ok && r.data && Array.isArray(r.data.animais) ? r.data.animais.map((a) => a.animal_id) : []));
  }
  // Viagem no tempo (conserto da Fase 3 pela garantia, etapa 1): a comparação do retrato numa data D depois de cada passo que
  // gravou, e o retrato pedido neste passo.
  if (!o.semGlobal) falhas.push(...oraculoTempo(sis, cmd, A, S, k, gravou));
  // Conserto pela garantia, a correção e o fato congelado (CONTRATOS, seção 50): no passo sorteado, o ensaio das correções
  // sobre o estado deste passo, que volta a ele no fim.
  if (!o.semGlobal && cmd.correcao) falhas.push(...oraculoCorrecao(sis, S, k, cmd.correcao));
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
 * Estorno logo depois do registro, sem nada gravado entre os dois (passada 3): aceito (salvo a recusa da política do estoque,
 * `estornoBloqueadoPeloEstoque`), e cada animal que existia antes do registro volta a cada campo de projeção que tinha
 * (situação, pasto, propriedade, brinco, sexo, nascimento, mãe, pai, categoria, marcações, cria ao pé, chegada, saída,
 * custo, peso). Os que o registro criou ficam anulados.
 */
const PROJETADOS = ['brinco', 'brinco_norm', 'sexo', 'data_nascimento', 'data_nascimento_confianca', 'mae_id', 'mae_confianca', 'pai_id', 'pai_confianca', 'origem', 'evento_origem_id', 'castrado', 'reprodutor', 'partos_previos', 'propriedade_atual_id', 'pasto_atual_id', 'categoria_modo', 'categoria_manual_id', 'situacao_reprodutiva', 'cria_ao_pe', 'marcado_descarte', 'nao_localizado', 'situacao_cadastral', 'data_entrada', 'data_entrada_confianca', 'data_saida', 'peso_atual', 'data_ultima_pesagem', 'data_ultimo_movimento', 'custo_aquisicao', 'custo_aquisicao_origem'];
function oraculoEstornoImediato(sis, cmd, r, S, dv0) {
  const snap = sis.snap;
  if (!snap || snap.eid !== cmd.dados.event_id || snap.dv !== dv0) return [];
  if (!r.ok && estornoBloqueadoPeloEstoque(S, snap.eid, r)) { contar('estorno imediato recusado pela política do estoque'); return []; }
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
 * A única recusa esperada do estorno logo depois do registro (RN-057 com a política; CONTRATOS, seção 39): sem o
 * lançamento, o estoque controlado de um produto ficaria abaixo de zero, mais baixo que agora — o saldo de antes do registro
 * já era negativo (o consumo aceito com a política AVISA, que depois mudou) —, a política de ESTOQUE_INSUFICIENTE é
 * BLOQUEIA, e a recusa traz só esse aviso. Confere pelo modelo: os movimentos vigentes com e sem os do lançamento.
 */
function estornoBloqueadoPeloEstoque(S, eid, r) {
  if (!r.error || r.error.code !== 'VALIDATION') return false;
  const cods = (r.error.details || []).map((d) => d.codigo);
  if (!cods.length || cods.some((c) => c !== 'ESTOQUE_INSUFICIENTE')) return false;
  if ((politicaDe(S).ESTOQUE_INSUFICIENTE || 'AVISA') !== 'BLOQUEIA') return false;
  const vale = vigenciaComImportacao(S);
  return (S.t.PRODUTOS || []).some((p) => {
    if (p.controla_estoque !== true) return false;
    const movs = S.t.MOVIMENTOS_ESTOQUE.filter((m) => m.product_id === p.product_id && vale(m.event_id));
    const agora = menorSaldoDe(movs);
    const sem = menorSaldoDe(movs.filter((m) => m.event_id !== eid));
    return sem.saldo < 0 && sem.saldo < agora.saldo;
  });
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
/**
 * O cadastro que o lançamento usa mudou depois dele: o produto ou o protocolo desativado, a estação com outras datas (o
 * registro ficou fora dela), o pasto de destino desativado.
 */
function cadastroMudou(S, e) {
  const achar = (aba, pk, id) => (S.t[aba] || []).find((x) => x[pk] === id) || {};
  if ((S.t.SANIDADE || []).some((r) => r.event_id === e.event_id && ((r.produto_id && achar('PRODUTOS', 'product_id', r.produto_id).ativo === false) || (r.protocol_id && achar('PROTOCOLOS_SANITARIOS', 'protocol_id', r.protocol_id).ativo === false)))) return true;
  if ((S.t.REPRODUCAO || []).some((r) => {
    if (r.event_id !== e.event_id || !r.estacao_id) return false;
    const est = achar('ESTACOES_MONTA', 'estacao_id', r.estacao_id);
    return !!est.data_inicio && (r.data < est.data_inicio || (r.tipo_evento !== 'DIAGNOSTICO_GESTACAO' && r.data > est.data_fim));
  })) return true;
  return S.t.EVENTO_ANIMAIS.some((l) => l.event_id === e.event_id && l.pasto_destino_id && achar('PASTOS', 'pasture_id', l.pasto_destino_id).status !== 'ATIVO');
}
/** Os tipos de manejo da Fase 3 (a correção sem mudança, mais tarde, é deles). */
const MANEJO = ['PESAGEM', 'SANIDADE', 'ESTOQUE', 'REPRODUCAO', 'DESMAMA', 'CASTRACAO', 'OCORRENCIA'];
/**
 * Recusas que a correção sem mudança, mais tarde, pode receber por desenho: o que mudou no meio muda a conta (o acerto pela
 * contagem que passa a bater com o saldo, a dose por kg sem a pesagem estornada, a idade da gestação acima dos dias de
 * gestação mudados, a cria que entrou acima da idade de desmama mudada, o marco zero levado para depois, o acerto de
 * estoque do produto cujo controle foi desligado: o acerto só existe com o saldo controlado) e, pela política BLOQUEIA, os
 * avisos de agora.
 */
const RECUSAS_DA_CORRECAO_TARDIA = ['VALOR_IGUAL', 'SEM_PESO', 'VALOR_FORA_DA_FAIXA', 'NAO_E_CRIA', 'ANTES_DO_MARCO_ZERO', 'PRODUTO_SEM_ESTOQUE'];
/**
 * Fuzz das Fases 1 a 3, passada 2: o lançamento de manejo que vale, corrigido sem mudança nenhuma muito depois do registro,
 * é aceito (ou sem alteração): o que ele usava (o produto, o protocolo, a estação, o pasto, o parceiro, a categoria
 * desativados ou mudados depois) continua valendo na correção, e o problema antigo não o bloqueia (seção 10.5). Com a
 * importação em curso, todo comando é recusado (16.8).
 */
/**
 * Revisão final da Fase 3 (achado 11): o procedimento de um protocolo já cumprido por alguma aplicação não muda no cadastro
 * (PROTOCOLO_EM_USO): as aplicações contam na agenda pelo protocolo; o protocolo sem aplicação muda livremente.
 */
function oraculoProcedimentoProtocolo(cmd, r, A) {
  if (cmd.rota !== 'protocolo.salvar' || !cmd.dados || !cmd.dados.protocol_id || !cmd.dados.campos || cmd.dados.campos.tipo_procedimento === undefined || cmd.outraChave || cmd.reenvio) return [];
  const antes = (A.t.PROTOCOLOS_SANITARIOS || []).find((p) => p.protocol_id === cmd.dados.protocol_id);
  if (!antes || antes.tipo_procedimento === cmd.dados.campos.tipo_procedimento || A.emCurso.length) return [];
  const usado = (A.t.SANIDADE || []).some((x) => x.protocol_id === antes.protocol_id);
  const codigos = r.ok ? [] : (r.error.details || []).map((d) => d.codigo);
  contar(usado ? 'procedimento de protocolo usado recusado' : 'procedimento de protocolo sem uso trocado');
  if (usado && r.ok) return [falha('PROTOCOLO:PROCEDIMENTO', 'o procedimento do protocolo ' + antes.nome + ', já cumprido por aplicações, mudou para ' + cmd.dados.campos.tipo_procedimento)];
  if (usado && codigos.indexOf('PROTOCOLO_EM_USO') < 0) return [falha('PROTOCOLO:PROCEDIMENTO', 'a troca do procedimento do protocolo usado foi recusada sem PROTOCOLO_EM_USO: ' + JSON.stringify(codigos))];
  if (!usado && codigos.indexOf('PROTOCOLO_EM_USO') >= 0) return [falha('PROTOCOLO:PROCEDIMENTO', 'o protocolo sem aplicação foi recusado como em uso')];
  return [];
}
function oraculoCorrecaoTardia(cmd, r, A) {
  // O reenvio e a mesma chave com outro conteúdo copiam o comando (e a marca): o desfecho deles é outro oráculo.
  if (r.ok || A.emCurso.length || cmd.outraChave || cmd.reenvio) return [];
  const pol = politicaDe(A);
  const codigos = (r.error.details || []).map((d) => d.codigo);
  // Revisão final da Fase 3 (achado 2): a carência só barra a correção sem mudança quando a do próprio original (congelada) já
  // cobria uma venda para abate — nunca uma carência que a correção ganhasse pelo cadastro de hoje.
  const carenciaDoOriginal = () => {
    const ids = new Set(A.t.SANIDADE.filter((x) => x.event_id === cmd.dados.event_id).map((x) => x.health_id));
    let cobre = false;
    paresCarencia(A, vigenciaComImportacao(A)).forEach((x, k) => { if (x.abate && ids.has(k.split('|')[2])) cobre = true; });
    if (cobre) contar('correção tardia barrada pela carência do original');
    return cobre;
  };
  if (codigos.length && codigos.every((c) => RECUSAS_DA_CORRECAO_TARDIA.indexOf(c) >= 0 || (c !== 'CARENCIA_ATIVA' && pol[c] === 'BLOQUEIA') || (c === 'CARENCIA_ATIVA' && (pol[c] || 'BLOQUEIA') === 'BLOQUEIA' && carenciaDoOriginal()))) return [];
  return [falha('CORRECAO_TARDIA:RECUSADA', 'a correção sem mudança, mais tarde, de ' + cmd.dados.tipo + (cmd.dados.subtipo ? '/' + cmd.dados.subtipo : '') + ' foi recusada: ' + r.error.code + ' ' + r.error.message + ' ' + JSON.stringify((r.error.details || []).map((d) => d.codigo + ': ' + d.mensagem)).slice(0, 700))];
}
/**
 * Revisão da Fase 3: a correção sem mudança, depois de mudar o cadastro (o custo, a categoria, o fator do produto; o
 * intervalo do protocolo; o controle de estoque), tem o mesmo efeito do original — o fato não é reprecificado: na aplicação
 * com o mesmo produto, o custo unitário da saída, a conta do consumo e a próxima aplicação de cada animal; na entrada de
 * estoque do mesmo produto, a quantidade comprada e o movimento de entrada (o original tinha, o substituto tem).
 */
function oraculoEfeitoCongelado(cmd, r, A, S) {
  if (!r.ok || cmd.outraChave || cmd.reenvio || !r.data || !r.data.event_id || (r.meta && (r.meta.duplicado || r.meta.semAlteracao))) return [];
  const o = cmd.dados.event_id;
  const n = r.data.event_id;
  const de = (T, aba, eid) => (T.t[aba] || []).filter((x) => x.event_id === eid);
  const out = [];
  const tipo = cmd.dados.tipo;
  if (tipo === 'SANIDADE') {
    const so = de(A, 'MOVIMENTOS_ESTOQUE', o).filter((m) => m.tipo === 'SAIDA');
    const sn = de(S, 'MOVIMENTOS_ESTOQUE', n).filter((m) => m.tipo === 'SAIDA');
    if (so.length === 1 && sn.length === 1 && so[0].product_id === sn[0].product_id) {
      contar('correção tardia: custo da saída conferido');
      if ((so[0].custo_unitario || null) !== (sn[0].custo_unitario || null)) out.push(falha('CORRECAO_TARDIA:CUSTO', 'a correção sem mudança reprecificou a saída: custo unitário ' + so[0].custo_unitario + ' → ' + sn[0].custo_unitario));
      const fo = de(A, 'FINANCEIRO', o).filter((f) => f.product_id);
      const fn = de(S, 'FINANCEIRO', n).filter((f) => f.product_id);
      if (fo.length === 1 && fn.length === 1 && fo[0].conta_id !== fn[0].conta_id) out.push(falha('CORRECAO_TARDIA:CONTA', 'a correção sem mudança trocou a conta do consumo'));
    }
    // Rodada 2 (achados 1 e 4): a aplicação por peso corrigida sem mudança mantém a dose de cada animal e a saída, mesmo com
    // a pesagem lançada depois (o preparo) ou o peso de referência e a validade do peso mudados depois.
    const eo = A.ev.get(o) || {};
    if ((eo.payload_json || {}).modo_dose === 'POR_PESO') {
      contar('correção tardia: dose por peso conferida');
      const doseO = new Map(de(A, 'SANIDADE', o).map((x) => [x.animal_id, x.dose]));
      de(S, 'SANIDADE', n).forEach((x) => { if (doseO.has(x.animal_id) && doseO.get(x.animal_id) !== x.dose) out.push(falha('CORRECAO_TARDIA:DOSE', 'a correção sem mudança refez a dose por peso: ' + doseO.get(x.animal_id) + ' → ' + x.dose)); });
      if (so.length === 1 && sn.length === 1 && so[0].quantidade !== sn[0].quantidade) out.push(falha('CORRECAO_TARDIA:SAIDA', 'a correção sem mudança mudou a saída do frasco: ' + so[0].quantidade + ' → ' + sn[0].quantidade));
    }
    const po = new Map(de(A, 'SANIDADE', o).map((x) => [x.animal_id, x]));
    de(S, 'SANIDADE', n).forEach((x) => {
      const y = po.get(x.animal_id);
      if (!y || y.protocol_id !== x.protocol_id || y.data_aplicacao !== x.data_aplicacao) return;
      contar('correção tardia: próxima aplicação conferida');
      if ((y.data_proxima_aplicacao || null) !== (x.data_proxima_aplicacao || null)) out.push(falha('CORRECAO_TARDIA:PROXIMA', 'a correção sem mudança mudou a próxima aplicação: ' + y.data_proxima_aplicacao + ' → ' + x.data_proxima_aplicacao));
    });
  }
  if (tipo === 'ESTOQUE' && cmd.dados.subtipo === 'ENTRADA') {
    const fo = de(A, 'FINANCEIRO', o)[0];
    const fn = de(S, 'FINANCEIRO', n)[0];
    if (fo && fn && fo.product_id === fn.product_id) {
      contar('correção tardia: entrada de estoque conferida');
      if (fo.quantidade !== fn.quantidade) out.push(falha('CORRECAO_TARDIA:QUANTIDADE', 'a correção sem mudança mudou a quantidade comprada: ' + fo.quantidade + ' → ' + fn.quantidade));
      const mo = de(A, 'MOVIMENTOS_ESTOQUE', o).filter((m) => m.tipo === 'ENTRADA').length;
      const mn = de(S, 'MOVIMENTOS_ESTOQUE', n).filter((m) => m.tipo === 'ENTRADA').length;
      if (mo !== mn) out.push(falha('CORRECAO_TARDIA:MOVIMENTO', 'a correção sem mudança ' + (mo ? 'apagou' : 'criou') + ' o movimento de entrada'));
    }
  }
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
  if (!r || !r.ok || cmd.rota === 'operacao.status') return;
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
  // O retrato da viagem no tempo sai de um gerador à parte: as sequências de comandos de cada semente não mudam com ele.
  const rt = aleatorio((semente ^ 0x6c8e9cf5) >>> 0);
  // O ensaio da correção também sai de um gerador à parte (CONTRATOS, seção 50).
  const rc = aleatorio((semente ^ 0x2f6b3a1d) >>> 0);
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
    const tempo = escolherTempo(sis, S, rt, k);
    if (tempo) cmd.tempo = tempo;
    const correcao = escolherCorrecao(S, rc, k);
    if (correcao) cmd.correcao = correcao;
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
  if (cmd.correcaoTardia) o.correcaoTardia = true;
  if (cmd.relogio) o.relogio = cmd.relogio;
  if (cmd.tempo) o.tempo = cmd.tempo;
  if (cmd.correcao) o.correcao = cmd.correcao;
  // A especificação do lançamento (o ensaio da correção usa a entrada do gerador também na repetição e no encolhimento).
  if (cmd.spec) o.spec = simbolizar(sis, cmd.spec);
  if (cmd.desfazerImediato) o.desfazerImediato = true;
  if (cmd.chaveDe !== undefined) { o.chaveDe = cmd.chaveDe; if (cmd.outraChave) o.outraChave = true; else o.reenvio = true; }
  if (cmd.chaveFixa) o.chaveFixa = cmd.chaveFixa;
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
    if (c.spec) cmd.spec = resolver(sis, c.spec, []);
    const ex = executar(sis, c.k, cmd, t);
    if (sisFora && ex.r) sisFora.resultados[c.k] = ex.r.ok ? 'OK' : ex.r.error.code + ':' + (ex.r.error.details || []).map((d) => d.codigo).join(',');
    if (ex.falhas.length) return Object.assign({ k: c.k }, ex.falhas[0]);
    nomear(sis, c.k, t, ex.depoisT);
    if (ex.r) memorizar(sis, c.k, cmd, ex.r, estado(t), ex.S);
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
  TIPOS, IMPORTADORES, registrarTipo, registrarImportador, chaveDosDados, COBERTURA,
};
