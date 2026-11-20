'use strict';
/**
 * Harness de testes: carrega src/*.js num contexto `vm` isolado, com fakes FIÉIS (no que importa) das APIs do
 * Google Apps Script. Adaptado de inbox-intelligence/tests/harness.js. O contrato de cada fake e o que nele é
 * hipótese (a conferir pelo diagnóstico na conta real) estão em docs/CONTRATOS.md, seção "Harness de testes".
 *
 * O que existe aqui para o teste FALHAR quando o código erra:
 *  - Planilha em memória com duas fachadas (SpreadsheetApp e serviço avançado Sheets) e coerção de célula
 *    "Geral" (tests/fakes/planilha.js).
 *  - Execuções simuladas: escritas por SpreadsheetApp ficam pendentes até flush() ou o fim normal da execução;
 *    o teste mata a execução e escolhe qual subconjunto das pendentes chega; falha injetável na N-ésima escrita.
 *  - Lock com intercalação: outra execução segura o lock; ganchos trocam de execução entre dois passos.
 *  - Drive v3 com árvore de pastas e escopo drive.file (tests/fakes/drive.js); UrlFetchApp para alt=media e export.
 *  - Properties com os limites reais (9 KB por valor, 500 KB no total); relógio falso; IDs determinísticos.
 */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { criarMundoPlanilhas, coagirEntrada, tzOffsetMinutes } = require('./fakes/planilha');
const { criarDrive } = require('./fakes/drive');

const SRC_DIR = path.join(__dirname, '..', 'src');
const ORDENS = ['alpha', 'reverse'];
/** 13/11/2026, 10:00 em America/Porto_Velho (convenção de 09-plano-de-testes.md, seção 2). */
const RELOGIO_PADRAO = Date.UTC(2026, 10, 13, 14, 0, 0);
const FUSO_PADRAO = 'America/Porto_Velho';
const TOKEN = 'ya29.test-token';
const OUTRA_EXECUCAO = { nome: 'outra execução (simulada)' };

// ---------------------------------------------------------------- bytes ----
function toSignedBytes(buf) {
  const out = new Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] > 127 ? buf[i] - 256 : buf[i];
  return out;
}
function fromBytes(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (typeof bytes === 'string') return Buffer.from(bytes, 'utf8');
  return Buffer.from(Array.from(bytes, (b) => (b < 0 ? b + 256 : b)));
}
function decodeCharset(buf, charset) {
  const cs = String(charset || 'UTF-8').toLowerCase();
  try {
    return new TextDecoder(cs === 'latin1' ? 'iso-8859-1' : cs).decode(buf);
  } catch (e) {
    throw new Error('Charset não suportado: ' + charset);
  }
}

// ---------------------------------------------------------------- blob -----
function makeBlob(data, contentType, name) {
  let buf = fromBytes(data == null ? '' : data);
  let ct = contentType || null;
  let nm = name || null;
  const blob = {
    getBytes: () => toSignedBytes(buf),
    getDataAsString: (charset) => decodeCharset(buf, charset || 'UTF-8'),
    setDataFromString: (s, charset) => { buf = Buffer.from(String(s), charset && charset.toLowerCase() !== 'utf-8' ? 'latin1' : 'utf8'); return blob; },
    getContentType: () => ct,
    setContentType: (c) => { ct = c; return blob; },
    getName: () => nm,
    setName: (n) => { nm = n; return blob; },
    getAs: () => blob,
    copyBlob: () => makeBlob(Buffer.from(buf), ct, nm),
    isGoogleType: () => false,
  };
  return blob;
}

// ------------------------------------------------------------ Utilities ----
function makeUtilities(clock, ids) {
  const DigestAlgorithm = { MD5: 'md5', SHA_1: 'sha1', SHA_256: 'sha256', SHA_384: 'sha384', SHA_512: 'sha512' };
  const MacAlgorithm = { HMAC_SHA_256: 'sha256', HMAC_SHA_512: 'sha512', HMAC_MD5: 'md5', HMAC_SHA_1: 'sha1' };
  const Charset = { UTF_8: 'UTF-8', US_ASCII: 'US-ASCII' };
  return {
    DigestAlgorithm,
    MacAlgorithm,
    Charset,
    base64Encode: (data) => fromBytes(data).toString('base64'),
    base64EncodeWebSafe: (data) => fromBytes(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64Decode: (s) => toSignedBytes(Buffer.from(String(s), 'base64')),
    base64DecodeWebSafe: (s) => toSignedBytes(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: (data, contentType, name) => makeBlob(data, contentType, name),
    computeDigest: (algorithm, value) => {
      const h = crypto.createHash(algorithm);
      h.update(typeof value === 'string' ? Buffer.from(value, 'utf8') : fromBytes(value));
      return toSignedBytes(h.digest());
    },
    computeHmacSha256Signature: (value, key) => {
      const h = crypto.createHmac('sha256', key);
      h.update(value);
      return toSignedBytes(h.digest());
    },
    getUuid: () => ids.proximo(),
    sleep: (ms) => { clock.sleeps.push(ms); if (clock.fake) clock.now += ms; },
    formatDate: (date, timeZone, pattern) => formatDateLikeJava(date, timeZone, pattern),
    jsonStringify: (o) => JSON.stringify(o),
    jsonParse: (s) => JSON.parse(s),
  };
}

/** Subconjunto do SimpleDateFormat usado por Utilities.formatDate. */
function formatDateLikeJava(date, timeZone, pattern) {
  const d = new Date(date.getTime ? date.getTime() : date);
  const parts = {};
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hourCycle: 'h23',
  });
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  const offsetMin = tzOffsetMinutes(d, timeZone);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const XXX = sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
  const Z = XXX.replace(':', '');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  const dowMap = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const tokens = {
    yyyy: parts.year, yy: parts.year.slice(2), MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute,
    ss: parts.second, SSS: ms, XXX, Z, u: String(dowMap[parts.weekday]), EEE: parts.weekday,
  };
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "'") {
      const j = pattern.indexOf("'", i + 1);
      out += pattern.slice(i + 1, j === -1 ? undefined : j);
      i = j === -1 ? pattern.length : j + 1;
      continue;
    }
    const tok = ['yyyy', 'SSS', 'XXX', 'EEE', 'yy', 'MM', 'dd', 'HH', 'mm', 'ss', 'Z', 'u'].find((t) => pattern.startsWith(t, i));
    if (tok) { out += tokens[tok]; i += tok.length; } else { out += pattern[i]; i += 1; }
  }
  return out;
}

// ------------------------------------------------------- Properties -------
/** Store com os limites reais: 9 KB por valor e 500 KB no total. Gravação é imediata (não passa pelo buffer). */
function makePropertyStore(name, amb) {
  const data = new Map();
  const MAX_VALUE = 9 * 1024;
  const MAX_TOTAL = 500 * 1024;
  function total() { let t = 0; for (const [k, v] of data) t += k.length + v.length; return t; }
  function gravar(k, v) {
    const s = String(v);
    if (Buffer.byteLength(s, 'utf8') > MAX_VALUE) throw amb.erro('Argument too large: value (' + name + ':' + k + ')');
    const antes = data.has(String(k)) ? data.get(String(k)) : undefined;
    data.set(String(k), s);
    if (total() > MAX_TOTAL) {
      if (antes === undefined) data.delete(String(k)); else data.set(String(k), antes);
      throw amb.erro('You have exceeded the property storage quota.');
    }
  }
  const store = {
    getProperty: (k) => { const v = data.has(k) ? data.get(k) : null; amb.emitir('props.lido', { store: name, chave: k }); return v; },
    getProperties: () => { const o = amb.paraContexto(Object.fromEntries(data)); amb.emitir('props.lido', { store: name, chave: null }); return o; },
    getKeys: () => amb.paraContexto(Array.from(data.keys())),
    setProperty: (k, v) => { amb.emitir('props.gravar', { store: name, chave: k }); gravar(k, v); return store; },
    setProperties: (obj, deleteAllOthers) => {
      amb.emitir('props.gravar', { store: name, chave: null });
      if (deleteAllOthers) data.clear();
      for (const k of Object.keys(obj)) gravar(k, obj[k]);
      return store;
    },
    deleteProperty: (k) => { amb.emitir('props.gravar', { store: name, chave: k }); data.delete(k); return store; },
    deleteAllProperties: () => { amb.emitir('props.gravar', { store: name, chave: null }); data.clear(); return store; },
  };
  amb.servico(store);
  store._data = data;
  return store;
}

// ---------------------------------------------------------- UrlFetch ------
function makeHttpResponse(r) {
  const bytes = r.bytes ? Buffer.from(r.bytes) : Buffer.from(r.body == null ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body), 'utf8');
  const headers = Object.assign({ 'Content-Type': 'application/json' }, r.headers || {});
  return {
    getResponseCode: () => r.code || 200,
    getContentText: (charset) => decodeCharset(bytes, charset || 'UTF-8'),
    getHeaders: () => headers,
    getAllHeaders: () => headers,
    getBlob: () => makeBlob(bytes, headers['Content-Type']),
    getContent: () => toSignedBytes(bytes),
  };
}
function makeUrlFetch(http, amb) {
  function one(req) {
    const r = typeof req === 'string' ? { url: req } : req;
    const norm = {
      url: r.url,
      method: String(r.method || 'get').toLowerCase(),
      headers: r.headers || {},
      payload: r.payload,
      contentType: r.contentType,
      muteHttpExceptions: !!r.muteHttpExceptions,
    };
    http.calls.push(norm);
    let res = null;
    for (const h of http.rotas) { res = h(norm); if (res) break; }
    if (!res && http.handler) res = http.handler(norm);
    if (!res) throw amb.erro('fake UrlFetchApp: nenhum handler HTTP registrado para ' + norm.url);
    if (res.throw) throw amb.erro(res.throw);
    const resp = makeHttpResponse(res);
    if (!norm.muteHttpExceptions && resp.getResponseCode() >= 400) {
      throw amb.erro('Request failed for ' + norm.url.split('?')[0] + ' returned code ' + resp.getResponseCode() + '. Truncated server response: ' + resp.getContentText().slice(0, 200));
    }
    return resp;
  }
  return amb.servico({
    fetch: (url, params) => one(Object.assign({ url }, params || {})),
    fetchAll: (requests) => { http.fetchAllBatches.push(requests.length); return requests.map(one); },
    getRequest: (url, params) => Object.assign({ url }, params || {}),
  });
}

// ------------------------------------------------------- ScriptApp --------
function makeScriptApp(triggers, amb) {
  let seq = 0;
  function builder(handler) {
    const spec = { handler, type: 'CLOCK' };
    const tb = {
      everyMinutes: (n) => { spec.everyMinutes = n; return tb; },
      everyHours: (n) => { spec.everyHours = n; return tb; },
      everyDays: (n) => { spec.everyDays = n; return tb; },
      everyWeeks: (n) => { spec.everyWeeks = n; return tb; },
      onWeekDay: (d) => { spec.weekDay = d; return tb; },
      atHour: (h) => { spec.atHour = h; return tb; },
      nearMinute: (m) => { spec.nearMinute = m; return tb; },
      inTimezone: (tz) => { spec.timezone = tz; return tb; },
      after: (ms) => { spec.after = ms; return tb; },
      create: () => {
        // Cota "consumer": 20 gatilhos por usuário por script.
        if (triggers.length >= 20) throw amb.erro('This script has too many triggers. Triggers must be deleted from the script before more can be added.');
        const id = 'trigger-' + ++seq;
        const t = { getHandlerFunction: () => handler, getUniqueId: () => id, getEventType: () => 'CLOCK', getTriggerSource: () => 'CLOCK', _spec: spec };
        triggers.push(t);
        return t;
      },
    };
    return { timeBased: () => tb };
  }
  return amb.servico({
    getOAuthToken: () => TOKEN,
    getProjectTriggers: () => triggers.slice(),
    newTrigger: (handler) => builder(handler),
    deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
    getScriptId: () => 'TEST_SCRIPT_ID',
    AuthMode: { FULL: 'FULL', NONE: 'NONE', LIMITED: 'LIMITED' },
    EventType: { CLOCK: 'CLOCK' },
    TriggerSource: { CLOCK: 'CLOCK' },
    WeekDay: { MONDAY: 'MONDAY', TUESDAY: 'TUESDAY', WEDNESDAY: 'WEDNESDAY', THURSDAY: 'THURSDAY', FRIDAY: 'FRIDAY', SATURDAY: 'SATURDAY', SUNDAY: 'SUNDAY' },
  });
}

// ------------------------------------------------------ HtmlService -------
function makeHtmlService(ctxRef) {
  function output(content) {
    const o = {
      _content: content, _title: '', _meta: [], _xfo: null,
      setTitle: (t) => { o._title = t; return o; },
      getTitle: () => o._title,
      addMetaTag: (n, c) => { o._meta.push([n, c]); return o; },
      setXFrameOptionsMode: (m) => { o._xfo = m; return o; },
      setFaviconUrl: () => o,
      setSandboxMode: () => o,
      getContent: () => o._content,
      append: (s) => { o._content += s; return o; },
    };
    return o;
  }
  function readHtml(name) {
    const p = path.join(SRC_DIR, name.endsWith('.html') ? name : name + '.html');
    return fs.readFileSync(p, 'utf8');
  }
  function evaluateTemplate(src, data) {
    // Suporte mínimo a scriptlets de impressão: <?!= expr ?> (sem escape) e <?= expr ?> (escapado).
    return src.replace(/<\?(!?=)([\s\S]*?)\?>/g, (_, kind, expr) => {
      const fn = vm.runInContext('(function(__d){ with(__d){ return (' + expr.trim().replace(/;\s*$/, '') + '); } })', ctxRef.ctx);
      const v = fn(data);
      const s = v == null ? '' : String(v);
      return kind === '!=' ? s : s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    });
  }
  return {
    createHtmlOutputFromFile: (name) => output(readHtml(name)),
    createHtmlOutput: (s) => output(s || ''),
    createTemplateFromFile: (name) => {
      const tpl = { _src: readHtml(name) };
      tpl.evaluate = () => output(evaluateTemplate(tpl._src, tpl));
      return tpl;
    },
    XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
    SandboxMode: { IFRAME: 'IFRAME' },
  };
}

// --------------------------------------------------------- contexto -------
/**
 * Cria um contexto Apps Script com os módulos de src/ carregados.
 * @param {object} [opts]
 * @param {string} [opts.email]        e-mail do dono (usuário ativo e efetivo); padrão dono@gmail.com
 * @param {'alpha'|'reverse'} [opts.order]  ordem de carga dos arquivos de src/ (padrão alfabética)
 * @param {string[]} [opts.files]      carrega só estes arquivos de src/
 * @param {number|false} [opts.fakeClock]  instante inicial do relógio falso em ms (padrão 13/11/2026 10:00 em Porto Velho); false = relógio real
 * @param {object} [opts.planilha]     {locale, fuso, nomeAbaPadrao, herdaFormato} das planilhas novas (padrões de propósito DIFERENTES dos do app: en_US, Etc/GMT)
 * @param {boolean} [opts.uuidAleatorio]  Utilities.getUuid() aleatório em vez de sequencial
 */
function createGas(opts) {
  const o = opts || {};
  const clock = { fake: o.fakeClock !== false, now: typeof o.fakeClock === 'number' ? o.fakeClock : RELOGIO_PADRAO, sleeps: [] };
  const email = o.email || 'dono@gmail.com';
  const http = { calls: [], fetchAllBatches: [], handler: null, rotas: [] };
  const triggers = [];
  const logs = [];
  const session = { activeEmail: email, effectiveEmail: email, timeZone: FUSO_PADRAO };
  const ctxRef = {};
  const agora = () => (clock.fake ? clock.now : Date.now());
  const ids = {
    n: 0,
    proximo: () => {
      if (o.uuidAleatorio) return crypto.randomUUID();
      ids.n += 1;
      return '00000000-0000-4000-8000-' + ids.n.toString(16).padStart(12, '0');
    },
  };

  // ------------------------------------------------------- execuções ----
  let seqExec = 0;
  function novaExecucao(ambiente) {
    return { id: ++seqExec, ambiente: !!ambiente, pendentes: [], morta: null, erroMorte: null, matarDepois: null, terminou: false };
  }
  let atual = novaExecucao(true);
  const ganchos = {};
  const regras = [];
  let escritas = 0;
  const locks = {
    script: { dono: null, liberaEm: null, tentativas: [], aquisicoes: 0, liberacoes: 0 },
    user: { dono: null, liberaEm: null, tentativas: [], aquisicoes: 0, liberacoes: 0 },
  };
  const sandbox = {};
  const ctx = vm.createContext(sandbox);
  ctxRef.ctx = ctx;
  const ctxErro = vm.runInContext('(function (m) { return new Error(m); })', ctx);

  function emitir(evento, info) {
    const lista = ganchos[evento];
    if (!lista || !lista.length) return;
    for (const g of lista.slice()) {
      if (g.ativo || lista.indexOf(g) < 0) continue;
      g.vezes -= 1;
      if (g.vezes <= 0) lista.splice(lista.indexOf(g), 1);
      g.ativo = true;
      try { g.fn(info || {}); } finally { g.ativo = false; }
    }
  }
  function vivo() {
    if (atual.morta) throw atual.erroMorte;
  }
  /** Mata a execução corrente: daqui em diante todo serviço do Apps Script lança, e nada mais é gravado. */
  function matar(opcoes) {
    const m = opcoes || {};
    if (atual.ambiente) throw new Error('harness: matar() só vale dentro de gas.exec() ou gas.tentar()');
    if (!atual.morta) {
      atual.morta = { chegam: m.chegam === undefined ? 'nenhuma' : m.chegam };
      atual.erroMorte = ctxErro('Exceeded maximum execution time');
      atual.erroMorte.execucaoMorta = true;
    }
    throw atual.erroMorte;
  }
  function casa(regra, info) {
    if (regra.aba && info.aba !== regra.aba && !(info.abas && info.abas.indexOf(regra.aba) >= 0)) return false;
    if (regra.tipo && info.tipo !== regra.tipo) return false;
    return true;
  }
  const amb = {
    opcoes: o.planilha,
    exec: () => atual,
    vivo,
    erro: (msg) => ctxErro(msg),
    agora,
    token: () => TOKEN,
    bytesDe: (blob) => fromBytes(blob.getBytes()),
    emitir,
    /** Embrulha (no próprio objeto) cada método do serviço para recusar chamadas de execução morta. */
    servico: (obj) => {
      Object.keys(obj).forEach((k) => {
        const f = obj[k];
        if (typeof f === 'function') obj[k] = function () { vivo(); return f.apply(this, arguments); };
      });
      return obj;
    },
    paraContexto: null,
    antesDeEscrever: (info) => {
      vivo();
      escritas += 1;
      info.numero = escritas;
      emitir('escrita', info);
      for (const regra of regras.slice()) {
        if (!casa(regra, info)) continue;
        regra.restante -= 1;
        if (regra.restante > 0) continue;
        regras.splice(regras.indexOf(regra), 1);
        if (regra.acao === 'erro') throw ctxErro(regra.mensagem || 'Service Spreadsheets failed while accessing document with id ' + info.ss + '.');
        if (regra.incluiAtual) atual.matarDepois = regra; else matar({ chegam: regra.chegam });
      }
    },
    depoisDeEscrever: () => {
      if (!atual.matarDepois) return;
      const regra = atual.matarDepois;
      atual.matarDepois = null;
      matar({ chegam: regra.chegam });
    },
  };
  amb.paraContexto = vm.runInContext(
    '(function conv(v, ehData) {' +
    "  if (v === null || typeof v !== 'object') return v;" +
    '  if (ehData(v)) return new Date(v.getTime());' +
    '  if (Array.isArray(v)) { var a = []; for (var i = 0; i < v.length; i++) a.push(conv(v[i], ehData)); return a; }' +
    '  var o = {}; for (var k in v) { if (Object.prototype.hasOwnProperty.call(v, k) && v[k] !== undefined) o[k] = conv(v[k], ehData); } return o;' +
    '})', ctx);
  const paraContextoCru = amb.paraContexto;
  amb.paraContexto = (v) => paraContextoCru(v, (x) => Object.prototype.toString.call(x) === '[object Date]');

  const mundo = criarMundoPlanilhas(amb);
  const drive = criarDrive(amb, mundo);
  http.rotas.push(drive.rest);
  const props = { script: makePropertyStore('script', amb), user: makePropertyStore('user', amb), document: makePropertyStore('document', amb) };

  // ------------------------------------------------------- lock ----
  function fazerLock(estado) {
    const tentar = (ms, lanca) => {
      if (typeof ms !== 'number') throw ctxErro("The parameters don't match the method signature for LockService.Lock." + (lanca ? 'waitLock' : 'tryLock') + '.');
      emitir('lock.tentar', { ms });
      estado.tentativas.push(ms);
      if (estado.dono === atual) return true;
      if (estado.dono === OUTRA_EXECUCAO && estado.liberaEm !== null && estado.liberaEm <= agora() + ms) {
        if (clock.fake) clock.now = Math.max(clock.now, estado.liberaEm);
        estado.dono = null;
        estado.liberaEm = null;
      }
      if (estado.dono === null) {
        estado.dono = atual;
        estado.aquisicoes += 1;
        emitir('lock.obtido', {});
        return true;
      }
      if (clock.fake) clock.now += ms;
      if (lanca) throw ctxErro('Lock timeout: another process was holding the lock for too long.');
      return false;
    };
    return amb.servico({
      tryLock: (ms) => tentar(ms, false),
      waitLock: (ms) => { tentar(ms, true); },
      releaseLock: () => {
        if (estado.dono !== atual) return;
        estado.dono = null;
        estado.liberacoes += 1;
        emitir('lock.liberado', {});
      },
      hasLock: () => estado.dono === atual,
    });
  }
  function soltarLocks(exec) {
    Object.keys(locks).forEach((k) => {
      if (locks[k].dono === exec) { locks[k].dono = null; locks[k].liberacoes += 1; }
    });
  }

  // ------------------------------------------------------- fim de execução ----
  function indicesQueChegam(chegam, infos) {
    const todos = infos.map((_, i) => i);
    if (chegam === 'todas') return todos;
    if (chegam === 'nenhuma' || chegam === undefined || chegam === null) return [];
    if (typeof chegam === 'number') return todos.slice(0, chegam);
    const lista = typeof chegam === 'function' ? chegam(infos.slice()) : chegam;
    if (!Array.isArray(lista)) throw new Error('harness: "chegam" espera "todas", "nenhuma", um número (prefixo), uma lista de índices ou uma função');
    const idx = lista.every((x) => typeof x === 'boolean') ? todos.filter((i) => lista[i]) : lista.slice();
    return Array.from(new Set(idx)).filter((i) => i >= 0 && i < infos.length).sort((a, b) => a - b);
  }
  function encerrar(exec, politica) {
    const infos = exec.pendentes.map((p) => p.info);
    let chegaram;
    if (exec.morta || politica !== 'todas') {
      chegaram = indicesQueChegam(exec.morta ? exec.morta.chegam : politica, infos);
      mundo.resolverMorte(exec, chegaram);
    } else {
      chegaram = infos.map((_, i) => i);
      mundo.descarregar(exec);
    }
    soltarLocks(exec);
    exec.terminou = true;
    return { pendentes: infos, chegaram };
  }
  /**
   * Roda `fn` como UMA execução do Apps Script e nunca lança: devolve {ok, valor, erro, morta, pendentes, chegaram}.
   * Fim normal: descarrega as escritas pendentes e solta o lock. Exceção não tratada: por padrão as pendentes
   * chegam todas (hipótese); `seLancar` escolhe outro subconjunto. Morte: chega o subconjunto pedido em matar().
   * Pode ser chamada de dentro de um gancho: é outra execução, que não enxerga as pendentes da que foi suspensa.
   * Chamada pelo teste, fora de outra execução, encerra antes a execução "ambiente" (o que o teste fez direto).
   */
  function tentar(fn, opcoes) {
    const op = opcoes || {};
    let pai = atual;
    // Código do teste fora de exec é uma execução que TERMINA quando a próxima começa (descarrega e solta o lock).
    if (pai.ambiente) { encerrar(pai, 'todas'); pai = novaExecucao(true); } else mundo.suspender(pai);
    const exec = novaExecucao(false);
    atual = exec;
    let ok = true;
    let valor;
    let erro;
    try { valor = fn(); } catch (x) { ok = false; erro = x; }
    let fim;
    try {
      fim = encerrar(exec, ok || op.seLancar === undefined ? 'todas' : op.seLancar);
    } finally {
      atual = pai;
      if (!pai.ambiente) mundo.retomar(pai);
    }
    if (exec.morta) return { ok: false, valor: undefined, erro: exec.erroMorte, morta: true, pendentes: fim.pendentes, chegaram: fim.chegaram };
    return { ok, valor, erro, morta: false, pendentes: fim.pendentes, chegaram: fim.chegaram };
  }
  /** Como tentar(), mas devolve o valor de `fn`, relança a exceção dela e lança {execucaoMorta: true} na morte. */
  function exec(fn, opcoes) {
    const r = tentar(fn, opcoes);
    if (r.morta) {
      const e = new Error('harness: a execução foi morta (simulação de queda); chegaram ' + r.chegaram.length + ' de ' + r.pendentes.length + ' escritas pendentes');
      e.execucaoMorta = true;
      e.pendentes = r.pendentes;
      e.chegaram = r.chegaram;
      throw e;
    }
    if (!r.ok) throw r.erro;
    return r.valor;
  }
  /** Encerra a execução "ambiente" (código do teste fora de exec): descarrega, solta o lock e começa outra. */
  function fimDaExecucao() {
    if (!atual.ambiente) throw new Error('harness: fimDaExecucao() só vale fora de gas.exec()');
    encerrar(atual, 'todas');
    atual = novaExecucao(true);
  }

  // ------------------------------------------------------- globais do contexto ----
  Object.assign(sandbox, {
    console: {
      log: (...a) => logs.push(['log', a]), info: (...a) => logs.push(['info', a]), warn: (...a) => logs.push(['warn', a]),
      error: (...a) => logs.push(['error', a]), time: () => {}, timeEnd: () => {},
    },
    Logger: { log: (...a) => { logs.push(['Logger', a]); }, getLog: () => '', clear: () => {} },
    Utilities: amb.servico(makeUtilities(clock, ids)),
    PropertiesService: { getScriptProperties: () => props.script, getUserProperties: () => props.user, getDocumentProperties: () => props.document },
    // Script autônomo: não há documento, logo getDocumentLock() devolve null.
    LockService: { getScriptLock: () => fazerLock(locks.script), getUserLock: () => fazerLock(locks.user), getDocumentLock: () => null },
    Session: amb.servico({
      getActiveUser: () => ({ getEmail: () => session.activeEmail }),
      getEffectiveUser: () => ({ getEmail: () => session.effectiveEmail }),
      getScriptTimeZone: () => session.timeZone,
      getTemporaryActiveUserKey: () => 'tmp-key',
    }),
    UrlFetchApp: makeUrlFetch(http, amb),
    ScriptApp: makeScriptApp(triggers, amb),
    HtmlService: makeHtmlService(ctxRef),
    SpreadsheetApp: mundo.SpreadsheetApp,
    Sheets: mundo.Sheets,
    Drive: drive.Drive,
  });

  // Relógio controlável: new Date() e Date.now() dentro do contexto seguem o relógio falso.
  if (clock.fake) {
    vm.runInContext(
      '(function(clock){ var RealDate = Date; var Fake = function(){ if (arguments.length === 0) return new RealDate(clock.now); var a = Array.prototype.slice.call(arguments); return new (Function.prototype.bind.apply(RealDate, [null].concat(a)))(); };' +
        'Fake.prototype = RealDate.prototype; Fake.now = function(){ return clock.now; }; Fake.UTC = RealDate.UTC; Fake.parse = RealDate.parse; Date = Fake; })',
      ctx
    )(clock);
  }

  let files = o.files || fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).sort();
  if (o.order === 'reverse') files = files.slice().reverse();
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }

  const sha256Hex = (texto) => crypto.createHash('sha256').update(String(texto), 'utf8').digest('hex');
  return {
    ctx,
    G: ctx, // atalho: G.Utils, G.Schema...
    files,
    clock, http, logs, props, session, triggers,
    /** Executa código JS dentro do contexto. */
    run: (code) => vm.runInContext(code, ctx),
    exec,
    tentar,
    matar,
    fimDaExecucao,
    /** Escritas por SpreadsheetApp ainda não descarregadas da execução corrente: [{ss, aba, tipo, intervalo, numero}]. */
    pendentes: () => atual.pendentes.map((p) => Object.assign({}, p.info)),
    ganchos: {
      /**
       * Chama `fn(info)` quando o evento ocorrer (uma vez; `vezes` para mais). Eventos: 'lock.tentar' (antes de
       * decidir), 'lock.obtido', 'lock.liberado', 'flush' (antes de descarregar), 'escrita' (antes de cada escrita),
       * 'props.lido' (depois de ler), 'props.gravar' (antes de gravar). Dentro de `fn` o teste pode rodar outra
       * execução (gas.tentar), segurar o lock ou matar a execução corrente (gas.matar). Devolve o cancelamento.
       */
      em: (evento, fn, opcoes) => {
        const g = { fn, vezes: (opcoes && opcoes.vezes) || 1, ativo: false };
        (ganchos[evento] = ganchos[evento] || []).push(g);
        return () => { const i = ganchos[evento].indexOf(g); if (i >= 0) ganchos[evento].splice(i, 1); };
      },
      limpar: () => { Object.keys(ganchos).forEach((k) => { ganchos[k] = []; }); },
    },
    falhas: {
      /** A n-ésima escrita (contada a partir de agora; filtros {aba, tipo}) lança erro TRATÁVEL e não é aplicada. */
      falharNaEscrita: (n, opcoes) => { regras.push(Object.assign({}, opcoes || {}, { acao: 'erro', restante: n })); },
      /**
       * A n-ésima escrita mata a execução. `chegam`: quais pendentes chegam ('nenhuma', 'todas', número = prefixo,
       * lista de índices ou função). `incluiAtual`: a própria n-ésima escrita é feita antes da morte (entra nas
       * pendentes, se for de SpreadsheetApp; fica gravada e a resposta se perde, se for da API).
       */
      matarNaEscrita: (n, opcoes) => { regras.push(Object.assign({ chegam: 'nenhuma' }, opcoes || {}, { acao: 'morte', restante: n })); },
      limpar: () => { regras.length = 0; },
      /** Total de escritas (SpreadsheetApp + API) feitas até agora neste contexto. */
      escritas: () => escritas,
    },
    lock: {
      /** Outra execução (simulada) segura o lock de script. `liberaEmMs`: solta sozinha depois desse tempo de relógio. */
      segurarPorOutra: (opcoes) => {
        const s = opcoes || {};
        if (locks.script.dono && locks.script.dono !== OUTRA_EXECUCAO) throw new Error('harness: o lock já está com uma execução deste teste');
        locks.script.dono = OUTRA_EXECUCAO;
        locks.script.liberaEm = typeof s.liberaEmMs === 'number' ? agora() + s.liberaEmMs : null;
      },
      soltarOutra: () => { if (locks.script.dono === OUTRA_EXECUCAO) { locks.script.dono = null; locks.script.liberaEm = null; } },
      /** null (livre), 'outra' (execução simulada) ou o número da execução do teste que o segura. */
      dono: () => (locks.script.dono === null ? null : locks.script.dono === OUTRA_EXECUCAO ? 'outra' : locks.script.dono.id),
      estatisticas: () => ({ tentativas: locks.script.tentativas.slice(), aquisicoes: locks.script.aquisicoes, liberacoes: locks.script.liberacoes }),
    },
    /** Planilhas em memória: leitura do estado, preparação de cenário e edição manual (ver tests/fakes/planilha.js). */
    planilhas: Object.assign({}, mundo.apoio, {
      /** Cria uma planilha do app (pelo fake do Drive, como o setup faz) e devolve o id. */
      criar: (nome, pais) => drive.Drive.Files.create({ name: nome || 'Planilha de teste', mimeType: drive.apoio.MIME_PLANILHA, parents: pais }).id,
    }),
    drive: drive.apoio,
    /**
     * O estado que dura entre execuções (planilhas, Drive, propriedades, o contador dos ids e o relógio), para um teste
     * fazer comandos de ensaio e voltar ao estado de antes (o oráculo da correção do teste aleatório, CONTRATOS, seção 50).
     * Só fora de gas.exec(): a fotografia não leva escrita pendente.
     */
    estado: {
      salvar: () => ({
        mundo: mundo.apoio.fotografar(), drive: drive.apoio.fotografar(), ids: ids.n, relogio: clock.now,
        props: Object.fromEntries(Object.keys(props).map((k) => [k, Array.from(props[k]._data)])),
      }),
      restaurar: (f) => {
        mundo.apoio.restaurar(f.mundo);
        drive.apoio.restaurar(f.drive);
        Object.keys(props).forEach((k) => { props[k]._data.clear(); f.props[k].forEach(([c, v]) => props[k]._data.set(c, v)); });
        ids.n = f.ids;
        clock.now = f.relogio;
      },
    },
    /** Portas falsas para testar domínio puro sem adaptador: {hash, clock, idGen} (contrato em docs/CONTRATOS.md). */
    portas: () => ({
      hash: { sha256Hex },
      clock: { agoraMs: () => agora(), agora: () => new Date(agora()).toISOString() },
      idGen: { uuid: () => ids.proximo() },
    }),
  };
}

/** Lista os arquivos .js de src/ (ordem alfabética). */
function arquivosFonte() {
  return fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).sort();
}

module.exports = { createGas, ORDENS, SRC_DIR, RELOGIO_PADRAO, FUSO_PADRAO, formatDateLikeJava, coagirEntrada, arquivosFonte, makeBlob };
