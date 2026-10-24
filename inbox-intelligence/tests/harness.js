'use strict';
/**
 * Harness de testes: carrega os arquivos de src/*.js num contexto `vm` isolado,
 * com mocks fiéis (no que importa) das APIs do Google Apps Script.
 *
 * Princípios:
 *  - Os mocks impõem os mesmos limites do Apps Script (9 KB por propriedade,
 *    100 KB por chave de cache, 250 caracteres por chave de cache) para que bugs
 *    de tamanho apareçam nos testes, não em produção.
 *  - Nenhuma API de envio/alteração de e-mail existe no contexto (GmailApp,
 *    MailApp): qualquer referência a elas quebra o teste.
 *  - BigQuery não é emulado em SQL; as chamadas são registradas e respondidas
 *    por handlers registrados pelo teste (por rótulo `query_name`).
 */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SRC_DIR = path.join(__dirname, '..', 'src');

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
    _buffer: () => buf,
  };
  return blob;
}

// ------------------------------------------------------------ Utilities ----
function makeUtilities(clock) {
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
    computeDigest: (algorithm, value, charset) => {
      const h = crypto.createHash(algorithm);
      h.update(typeof value === 'string' ? Buffer.from(value, 'utf8') : fromBytes(value));
      return toSignedBytes(h.digest());
    },
    computeHmacSignature: (algorithm, value, key) => {
      const h = crypto.createHmac(algorithm, typeof key === 'string' ? Buffer.from(key, 'utf8') : fromBytes(key));
      h.update(typeof value === 'string' ? Buffer.from(value, 'utf8') : fromBytes(value));
      return toSignedBytes(h.digest());
    },
    computeHmacSha256Signature: (value, key) => {
      const h = crypto.createHmac('sha256', key);
      h.update(value);
      return toSignedBytes(h.digest());
    },
    getUuid: () => crypto.randomUUID(),
    sleep: (ms) => { clock.sleeps.push(ms); if (clock.fake) clock.now += ms; },
    formatDate: (date, timeZone, pattern) => formatDateLikeJava(date, timeZone, pattern),
    jsonStringify: (o) => JSON.stringify(o),
    jsonParse: (s) => JSON.parse(s),
    parseCsv: (s) => String(s).split(/\r?\n/).filter(Boolean).map((l) => l.split(',')),
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
function tzOffsetMinutes(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  const name = fmt.formatToParts(date).find((p) => p.type === 'timeZoneName').value; // GMT-03:00
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  const v = parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10);
  return m[1] === '-' ? -v : v;
}

// ------------------------------------------------------- Properties -------
function makePropertyStore(name) {
  const data = new Map();
  const MAX_VALUE = 9 * 1024;
  const MAX_TOTAL = 500 * 1024;
  function total() { let t = 0; for (const [k, v] of data) t += k.length + v.length; return t; }
  const store = {
    getProperty: (k) => (data.has(k) ? data.get(k) : null),
    setProperty: (k, v) => {
      const s = String(v);
      if (Buffer.byteLength(s, 'utf8') > MAX_VALUE) throw new Error('Argument too large: value (' + name + ':' + k + ')');
      data.set(String(k), s);
      if (total() > MAX_TOTAL) throw new Error('You have exceeded the property storage quota.');
      return store;
    },
    setProperties: (obj, deleteAllOthers) => {
      if (deleteAllOthers) data.clear();
      for (const k of Object.keys(obj)) store.setProperty(k, obj[k]);
      return store;
    },
    getProperties: () => Object.fromEntries(data),
    getKeys: () => Array.from(data.keys()),
    deleteProperty: (k) => { data.delete(k); return store; },
    deleteAllProperties: () => { data.clear(); return store; },
    _data: data,
  };
  return store;
}

// ------------------------------------------------------------ Cache -------
function makeCache(clock) {
  const data = new Map();
  const now = () => (clock.fake ? clock.now : Date.now());
  function check(k, v) {
    if (String(k).length > 250) throw new Error('Cache key too long');
    if (v != null && Buffer.byteLength(String(v), 'utf8') > 100 * 1024) throw new Error('Argument too large: value');
  }
  const cache = {
    get: (k) => { const e = data.get(k); if (!e) return null; if (e.exp < now()) { data.delete(k); return null; } return e.v; },
    put: (k, v, ttl) => { check(k, v); const t = Math.min(ttl == null ? 600 : ttl, 21600); data.set(k, { v: String(v), exp: now() + t * 1000 }); },
    getAll: (keys) => { const o = {}; for (const k of keys) { const v = cache.get(k); if (v != null) o[k] = v; } return o; },
    putAll: (obj, ttl) => { for (const k of Object.keys(obj)) cache.put(k, obj[k], ttl); },
    remove: (k) => { data.delete(k); },
    removeAll: (keys) => { for (const k of keys) data.delete(k); },
    _data: data,
  };
  return cache;
}

// ------------------------------------------------------------- Lock -------
function makeLock(state) {
  return {
    tryLock: (ms) => { state.attempts.push(ms); if (state.heldByOther) return false; state.held = true; return true; },
    waitLock: (ms) => { state.attempts.push(ms); if (state.heldByOther) throw new Error('Lock timeout: another process was holding the lock for too long.'); state.held = true; },
    releaseLock: () => { state.held = false; },
    hasLock: () => state.held,
  };
}

// ---------------------------------------------------------- UrlFetch ------
function makeHttpResponse(r) {
  const body = r.body == null ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  const headers = Object.assign({ 'Content-Type': 'application/json' }, r.headers || {});
  return {
    getResponseCode: () => r.code || 200,
    getContentText: () => body,
    getHeaders: () => headers,
    getAllHeaders: () => headers,
    getBlob: () => makeBlob(body, headers['Content-Type']),
    getContent: () => toSignedBytes(Buffer.from(body, 'utf8')),
  };
}
function makeUrlFetch(http) {
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
    if (!http.handler) throw new Error('Nenhum handler HTTP registrado para ' + norm.url);
    const res = http.handler(norm);
    if (res && res.throw) throw new Error(res.throw);
    const resp = makeHttpResponse(res || { code: 404, body: '' });
    if (!norm.muteHttpExceptions && resp.getResponseCode() >= 400) {
      throw new Error('Request failed for ' + norm.url + ' returned code ' + resp.getResponseCode());
    }
    return resp;
  }
  return {
    fetch: (url, params) => one(Object.assign({ url }, params || {})),
    fetchAll: (requests) => { http.fetchAllBatches.push(requests.length); return requests.map(one); },
    getRequest: (url, params) => Object.assign({ url }, params || {}),
  };
}

// ---------------------------------------------------- Gmail (avançado) ----
function apiError(code, message) {
  const e = new Error('GoogleJsonResponseException: API call failed with error: ' + message);
  e.details = { code, message };
  return e;
}
function makeGmailAdvanced(gmail) {
  return {
    Users: {
      getProfile: (userId) => { gmail.calls.push({ m: 'getProfile' }); return { emailAddress: gmail.email, historyId: String(gmail.historyId), messagesTotal: gmail.messages.size }; },
      History: {
        list: (userId, opts) => {
          gmail.calls.push({ m: 'history.list', opts });
          if (gmail.failHistory) throw apiError(gmail.failHistory, gmail.failHistory === 404 ? 'Requested entity was not found.' : 'Backend Error');
          const start = Number(opts.startHistoryId);
          const recs = gmail.history.filter((h) => Number(h.id) > start);
          const max = opts.maxResults || 100;
          const offset = opts.pageToken ? Number(opts.pageToken) : 0;
          const page = recs.slice(offset, offset + max);
          const res = { historyId: String(gmail.historyId) };
          if (page.length) res.history = page;
          if (offset + max < recs.length) res.nextPageToken = String(offset + max);
          return res;
        },
      },
      Messages: {
        list: (userId, opts) => {
          gmail.calls.push({ m: 'messages.list', opts });
          let all = Array.from(gmail.messages.values());
          all = all.filter((m) => !(m.labelIds || []).includes('SPAM') && !(m.labelIds || []).includes('TRASH'));
          const q = (opts && opts.q) || '';
          const after = /after:(\d+)/.exec(q);
          const before = /before:(\d+)/.exec(q);
          if (after) all = all.filter((m) => Number(m.internalDate) / 1000 >= Number(after[1]));
          if (before) all = all.filter((m) => Number(m.internalDate) / 1000 < Number(before[1]));
          all.sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
          const max = (opts && opts.maxResults) || 100;
          const offset = opts && opts.pageToken ? Number(opts.pageToken) : 0;
          const page = all.slice(offset, offset + max).map((m) => ({ id: m.id, threadId: m.threadId }));
          const res = { resultSizeEstimate: all.length };
          if (page.length) res.messages = page;
          if (offset + max < all.length) res.nextPageToken = String(offset + max);
          return res;
        },
        get: (userId, id) => {
          gmail.calls.push({ m: 'messages.get', id });
          const m = gmail.messages.get(id);
          if (!m) throw apiError(404, 'Requested entity was not found.');
          return JSON.parse(JSON.stringify(m));
        },
      },
      Labels: { list: () => ({ labels: [] }) },
    },
  };
}

/** Handler HTTP padrão que serve a Gmail REST API a partir do mailbox fake. */
function gmailRestHandler(gmail) {
  return function (req) {
    const m = /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/([^/?]+)/.exec(req.url);
    if (!m) return null;
    gmail.restCalls.push(req.url);
    const id = decodeURIComponent(m[1]);
    if (gmail.restFailures && gmail.restFailures[id]) {
      const f = gmail.restFailures[id];
      if (f.remaining > 0) { f.remaining--; return { code: f.code, body: { error: { code: f.code, message: 'simulated' } } }; }
    }
    const msg = gmail.messages.get(id);
    if (!msg) return { code: 404, body: { error: { code: 404, message: 'Requested entity was not found.' } } };
    return { code: 200, body: msg };
  };
}

// ------------------------------------------------- BigQuery (avançado) ----
function makeBigQueryAdvanced(bq) {
  function respond(kind, request) {
    const name = (request.labels && request.labels.query_name) || (request.configuration && request.configuration.labels && request.configuration.labels.query_name) || 'unnamed';
    const h = bq.handlers[name] || bq.defaultHandler;
    const res = h ? h(request, name) : null;
    return { name, res };
  }
  return {
    Jobs: {
      query: (request, projectId) => {
        bq.queries.push({ projectId, request });
        if (bq.failNext) { const f = bq.failNext; bq.failNext = null; throw apiError(f.code || 500, f.message || 'Backend error'); }
        const { name, res } = respond('query', request);
        const r = res || {};
        const rows = r.rows || [];
        const fields = r.fields || (rows[0] ? Object.keys(rows[0]).map((n) => ({ name: n, type: 'STRING' })) : []);
        return {
          kind: 'bigquery#queryResponse',
          jobComplete: r.jobComplete !== false,
          jobReference: { projectId, jobId: 'job_' + name + '_' + bq.queries.length, location: 'US' },
          totalBytesProcessed: String(r.bytes || 0),
          totalBytesBilled: String(r.bytes || 0),
          numDmlAffectedRows: r.affected != null ? String(r.affected) : undefined,
          schema: { fields },
          totalRows: String(rows.length),
          rows: rows.map((row) => ({ f: fields.map((f) => ({ v: encodeField(f, row[f.name]) })) })),
        };
      },
      getQueryResults: (projectId, jobId) => {
        bq.queries.push({ projectId, getQueryResults: jobId });
        return { jobComplete: true, rows: [], schema: { fields: [] }, totalRows: '0' };
      },
      insert: (job, projectId, blob) => {
        const load = job.configuration && job.configuration.load;
        const text = blob ? blob.getDataAsString() : '';
        const rows = text ? text.split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
        const jobId = (job.jobReference && job.jobReference.jobId) || 'load_' + (bq.jobs.length + 1);
        if (bq.jobsById[jobId]) { const e = apiError(409, 'Already Exists: Job ' + jobId); throw e; }
        if (load && bq.failLoad) { const f = bq.failLoad; bq.failLoad = null; throw apiError(f.code || 500, f.message || 'load failed'); }
        const rec = { projectId, job, rows, jobId, bytes: Buffer.byteLength(text, 'utf8') };
        bq.jobs.push(rec);
        bq.jobsById[jobId] = rec;
        let errorResult = null;
        if (load) {
          const t = load.destinationTable.tableId;
          const bad = bq.loadErrors[t];
          if (bad) { errorResult = { reason: 'invalid', message: bad }; }
          else bq.tables[t] = (bq.tables[t] || []).concat(rows);
        }
        rec.status = errorResult ? { state: 'DONE', errorResult } : { state: 'DONE' };
        return { jobReference: { projectId, jobId, location: 'US' }, status: { state: 'RUNNING' }, statistics: {} };
      },
      get: (projectId, jobId) => {
        const rec = bq.jobsById[jobId];
        if (!rec) return { jobReference: { projectId, jobId }, status: { state: 'DONE' }, statistics: { query: { totalBytesBilled: '0' } } };
        return { jobReference: { projectId, jobId }, status: rec.status, statistics: { load: { outputRows: String(rec.rows.length), outputBytes: String(rec.bytes) } } };
      },
    },
    Datasets: {
      get: (projectId, datasetId) => { if (!bq.datasets[datasetId]) throw apiError(404, 'Not found: Dataset'); return bq.datasets[datasetId]; },
      insert: (ds, projectId) => { bq.datasets[ds.datasetReference.datasetId] = ds; return ds; },
    },
    Tables: {
      get: (projectId, datasetId, tableId) => { if (!bq.tableMeta[tableId]) throw apiError(404, 'Not found: Table'); return bq.tableMeta[tableId]; },
      patch: (resource, projectId, datasetId, tableId) => { bq.tableMeta[tableId] = Object.assign(bq.tableMeta[tableId] || {}, resource); bq.patches.push({ tableId, resource }); return bq.tableMeta[tableId]; },
      insert: (resource, projectId, datasetId) => { bq.tableMeta[resource.tableReference.tableId] = resource; return resource; },
      list: () => ({ tables: Object.keys(bq.tableMeta).map((t) => ({ tableReference: { tableId: t } })) }),
      remove: (projectId, datasetId, tableId) => { if (!bq.tableMeta[tableId]) throw apiError(404, 'Not found: Table'); delete bq.tableMeta[tableId]; bq.removed.push(tableId); },
    },
  };
}
/** Codifica um valor no formato de célula da API do BigQuery, respeitando RECORD e REPEATED. */
function encodeField(field, v) {
  if (v == null) return field.mode === 'REPEATED' ? [] : null;
  if (field.mode === 'REPEATED') {
    const single = Object.assign({}, field, { mode: 'NULLABLE' });
    return (Array.isArray(v) ? v : [v]).map((x) => ({ v: encodeField(single, x) }));
  }
  if ((field.type === 'RECORD' || field.type === 'STRUCT') && Array.isArray(field.fields)) {
    return { f: field.fields.map((sf) => ({ v: encodeField(sf, v[sf.name]) })) };
  }
  return encodeCell(v);
}
function encodeCell(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map((x) => ({ v: encodeCell(x) }));
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ------------------------------------------------------- ScriptApp --------
function makeScriptApp(triggers) {
  let seq = 0;
  function builder(handler) {
    const spec = { handler, type: 'CLOCK' };
    const tb = {
      everyMinutes: (n) => { spec.everyMinutes = n; return tb; },
      everyHours: (n) => { spec.everyHours = n; return tb; },
      everyDays: (n) => { spec.everyDays = n; return tb; },
      atHour: (h) => { spec.atHour = h; return tb; },
      nearMinute: (m) => { spec.nearMinute = m; return tb; },
      inTimezone: (tz) => { spec.timezone = tz; return tb; },
      after: (ms) => { spec.after = ms; return tb; },
      create: () => {
        const id = 'trigger-' + ++seq;
        const t = { getHandlerFunction: () => handler, getUniqueId: () => id, getEventType: () => 'CLOCK', getTriggerSource: () => 'CLOCK', _spec: spec };
        triggers.push(t);
        return t;
      },
    };
    return { timeBased: () => tb };
  }
  return {
    getOAuthToken: () => 'ya29.test-token',
    getProjectTriggers: () => triggers.slice(),
    newTrigger: (handler) => builder(handler),
    deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
    getScriptId: () => 'TEST_SCRIPT_ID',
    AuthMode: { FULL: 'FULL', NONE: 'NONE', LIMITED: 'LIMITED' },
    EventType: { CLOCK: 'CLOCK' },
    TriggerSource: { CLOCK: 'CLOCK' },
  };
}

// ------------------------------------------------------ HtmlService -------
function makeHtmlService(ctxRef) {
  function output(content) {
    const o = {
      _content: content, _title: '', _meta: [], _xfo: null,
      setTitle: (t) => { o._title = t; return o; },
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
      const fn = vm.runInContext('(function(__d){ with(__d){ return (' + expr + '); } })', ctxRef.ctx);
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
 * @param {{email?: string, order?: 'alpha'|'reverse', files?: string[], fakeClock?: number}} [opts]
 */
function createGas(opts) {
  const o = opts || {};
  const clock = { fake: o.fakeClock != null, now: o.fakeClock || 0, sleeps: [] };
  const email = o.email || 'dono@gmail.com';
  const http = { calls: [], fetchAllBatches: [], handler: null };
  const gmail = { email, historyId: 1000, messages: new Map(), history: [], calls: [], restCalls: [], failHistory: null, restFailures: {} };
  const bq = { queries: [], jobs: [], jobsById: {}, tables: {}, handlers: {}, defaultHandler: null, datasets: {}, tableMeta: {}, patches: [], removed: [], loadErrors: {}, failNext: null, failLoad: null };
  const lockState = { held: false, heldByOther: false, attempts: [] };
  const triggers = [];
  const logs = [];
  const props = { script: makePropertyStore('script'), user: makePropertyStore('user'), document: makePropertyStore('document') };
  const caches = { script: makeCache(clock), user: makeCache(clock), document: makeCache(clock) };
  const session = { activeEmail: email, effectiveEmail: email, timeZone: 'America/Sao_Paulo' };
  const ctxRef = {};

  const sandbox = {
    console: {
      log: (...a) => logs.push(['log', a]), info: (...a) => logs.push(['info', a]), warn: (...a) => logs.push(['warn', a]),
      error: (...a) => logs.push(['error', a]), time: () => {}, timeEnd: () => {},
    },
    Logger: { log: (...a) => { logs.push(['Logger', a]); }, getLog: () => '', clear: () => {} },
    Utilities: makeUtilities(clock),
    PropertiesService: { getScriptProperties: () => props.script, getUserProperties: () => props.user, getDocumentProperties: () => props.document },
    CacheService: { getScriptCache: () => caches.script, getUserCache: () => caches.user, getDocumentCache: () => caches.document },
    LockService: { getScriptLock: () => makeLock(lockState), getUserLock: () => makeLock(lockState), getDocumentLock: () => makeLock(lockState) },
    Session: {
      getActiveUser: () => ({ getEmail: () => session.activeEmail }),
      getEffectiveUser: () => ({ getEmail: () => session.effectiveEmail }),
      getScriptTimeZone: () => session.timeZone,
      getTemporaryActiveUserKey: () => 'tmp-key',
    },
    UrlFetchApp: makeUrlFetch(http),
    Gmail: makeGmailAdvanced(gmail),
    BigQuery: makeBigQueryAdvanced(bq),
    ScriptApp: makeScriptApp(triggers),
    HtmlService: makeHtmlService(ctxRef),
    ContentService: { createTextOutput: (s) => ({ _c: s, setMimeType: function () { return this; }, getContent: () => s }), MimeType: { JSON: 'JSON', TEXT: 'TEXT' } },
  };
  const ctx = vm.createContext(sandbox);
  ctxRef.ctx = ctx;

  // Relógio controlável: Date.now() dentro do contexto pode ser fixado.
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

  return {
    ctx,
    G: ctx, // atalho: G.Pipeline, G.Util...
    clock, http, gmail, bq, lockState, triggers, logs, props, caches, session,
    /** Executa código JS dentro do contexto (útil para acessar `let/const` de topo). */
    run: (code) => vm.runInContext(code, ctx),
    useGmailRest: () => {
      const prev = http.handler;
      const g = gmailRestHandler(gmail);
      http.handler = (req) => g(req) || (prev ? prev(req) : null);
    },
  };
}

// ------------------------------------------------ fixtures de e-mail ------
function b64url(s) {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/**
 * Monta uma mensagem no formato da Gmail API (format=full) a partir de uma
 * especificação simples. Somente para testes — dados sintéticos.
 */
function makeGmailMessage(spec) {
  const id = spec.id || crypto.randomBytes(8).toString('hex');
  const headers = [
    { name: 'From', value: spec.from || 'Remetente <remetente@exemplo.com.br>' },
    { name: 'To', value: spec.to || 'Dono <dono@gmail.com>' },
    { name: 'Subject', value: spec.subject || '(sem assunto)' },
    { name: 'Date', value: spec.dateHeader || new Date(spec.date || Date.UTC(2026, 9, 20, 13, 0)).toUTCString() },
    { name: 'Message-ID', value: spec.messageIdHeader || '<' + id + '@mail.exemplo.com.br>' },
  ];
  if (spec.cc) headers.push({ name: 'Cc', value: spec.cc });
  for (const [k, v] of Object.entries(spec.headers || {})) headers.push({ name: k, value: v });
  const parts = [];
  if (spec.text != null) parts.push({ partId: '0', mimeType: 'text/plain', filename: '', headers: [{ name: 'Content-Type', value: 'text/plain; charset=' + (spec.charset || 'UTF-8') }], body: { size: Buffer.byteLength(spec.text), data: b64url(spec.text) } });
  if (spec.html != null) parts.push({ partId: '1', mimeType: 'text/html', filename: '', headers: [{ name: 'Content-Type', value: 'text/html; charset=UTF-8' }], body: { size: Buffer.byteLength(spec.html), data: b64url(spec.html) } });
  for (const a of spec.attachments || []) parts.push({ partId: String(parts.length), mimeType: a.mimeType || 'application/pdf', filename: a.filename, headers: [], body: { size: a.size || 1000, attachmentId: 'att-' + a.filename } });
  let payload;
  if (parts.length === 1 && !(spec.attachments || []).length) {
    payload = Object.assign({}, parts[0], { headers: headers.concat(parts[0].headers) });
  } else {
    const alt = (spec.text != null && spec.html != null)
      ? [{ partId: '0', mimeType: 'multipart/alternative', filename: '', headers: [], body: { size: 0 }, parts: parts.filter((p) => p.mimeType.startsWith('text/')) }]
      : parts.filter((p) => p.mimeType.startsWith('text/'));
    payload = { partId: '', mimeType: (spec.attachments || []).length ? 'multipart/mixed' : 'multipart/alternative', filename: '', headers, body: { size: 0 }, parts: alt.concat(parts.filter((p) => !p.mimeType.startsWith('text/'))) };
  }
  const internalDate = String(spec.date || Date.UTC(2026, 9, 20, 13, 0));
  return {
    id,
    threadId: spec.threadId || id,
    labelIds: spec.labels || ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL'],
    snippet: (spec.text || spec.html || '').replace(/<[^>]+>/g, ' ').slice(0, 120),
    historyId: String(spec.historyId || 1000),
    internalDate,
    sizeEstimate: (spec.text || '').length + (spec.html || '').length + 500,
    payload,
  };
}

/** Adiciona mensagem ao mailbox fake e registra no histórico (messageAdded). */
function addToMailbox(gas, spec) {
  const msg = makeGmailMessage(spec);
  gas.gmail.historyId += 1;
  msg.historyId = String(gas.gmail.historyId);
  gas.gmail.messages.set(msg.id, msg);
  gas.gmail.history.push({ id: String(gas.gmail.historyId), messagesAdded: [{ message: { id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds } }] });
  return msg;
}

module.exports = { createGas, makeGmailMessage, addToMailbox, b64url, formatDateLikeJava, SRC_DIR };
