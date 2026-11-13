/**
 * Utilidades puras e transversais: tempo no fuso do Brasil, hashing, texto,
 * retry com backoff, orçamento de tempo e sanitização de erros.
 *
 * Convenção do projeto: cada arquivo expõe um único namespace (`var X = ...`)
 * e só referencia outros namespaces dentro de funções (nunca em tempo de carga).
 */
var Util = (function () {
  // O fuso do app é o timeZone do manifesto (appsscript.json), que também rege os gatilhos.
  var DEFAULT_TZ = 'America/Sao_Paulo';
  // Nomes IANA (America/Porto_Velho, UTC, Etc/GMT+4): sem aspas, barras invertidas nem espaços, seguros no SQL.
  var TZ_RE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;
  var DAY_MS = 24 * 60 * 60 * 1000;

  // ------------------------------------------------------------ tempo ----
  function now() {
    return Date.now();
  }
  function nowIso() {
    return new Date(Util.now()).toISOString();
  }
  function toIso(ms) {
    if (ms === null || ms === undefined || ms === '') return null;
    var d = new Date(typeof ms === 'number' ? ms : Number(ms));
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  /** Fuso IANA do app (ex.: America/Porto_Velho), lido do manifesto; inválido ou ausente → DEFAULT_TZ. */
  function tz() {
    return memo('tz', function () {
      var z = '';
      try { z = String(Session.getScriptTimeZone() || ''); } catch (e) { z = ''; }
      if (TZ_RE.test(z)) return z;
      Monitoring.log('warn', 'tz_fallback', { manifest_tz: z.slice(0, 40), used: DEFAULT_TZ });
      return DEFAULT_TZ;
    });
  }
  /** Data civil (YYYY-MM-DD) no fuso do app. */
  function ymd(ms) {
    return Utilities.formatDate(new Date(ms === undefined ? Util.now() : ms), tz(), 'yyyy-MM-dd');
  }
  function todayYmd() {
    return ymd(Util.now());
  }
  /** Converte YYYY-MM-DD em número de dias desde a época (UTC, sem fuso). */
  function ymdToDayNumber(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return NaN;
    return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
  }
  /** Época (segundos) da meia-noite, no fuso do app, de uma data YYYY-MM-DD (para after:/before: do Gmail). */
  function ymdStartEpochSec(s) {
    var utcMidnight = ymdToDayNumber(s) * DAY_MS;
    var z = Utilities.formatDate(new Date(utcMidnight + 12 * 3600000), tz(), 'Z');
    var m = /^([+-])(\d{2})(\d{2})$/.exec(String(z));
    var offsetMin = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : -180;
    return Math.floor((utcMidnight - offsetMin * 60000) / 1000);
  }
  function dayNumberToYmd(n) {
    var d = new Date(n * DAY_MS);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  /** Diferença em dias civis: b − a. */
  function daysBetween(a, b) {
    return ymdToDayNumber(b) - ymdToDayNumber(a);
  }
  function addDays(s, n) {
    return dayNumberToYmd(ymdToDayNumber(s) + n);
  }
  /** Dia da semana ISO (1 = segunda … 7 = domingo) de uma data YYYY-MM-DD. */
  function isoWeekday(s) {
    var n = ymdToDayNumber(s);
    // 1970-01-01 foi quinta-feira (ISO 4).
    return ((((n + 3) % 7) + 7) % 7) + 1;
  }
  function isValidYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1) return false;
    return d <= daysInMonth(y, mo);
  }
  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }
  /** Formata YYYY-MM-DD como dd/mm/aaaa. */
  function formatBrDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }

  // ---------------------------------------------------------- hashing ----
  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
      out += (b < 16 ? '0' : '') + b.toString(16);
    }
    return out;
  }
  function sha256Hex(text) {
    return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8));
  }
  function shortHash(text, len) {
    return sha256Hex(text).slice(0, len || 16);
  }
  function uuid() {
    return Utilities.getUuid();
  }
  /** Nonce aleatório de 12 caracteres hex para delimitar conteúdo não confiável. */
  function nonce() {
    return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  }

  // ------------------------------------------------------------ texto ----
  function stripDiacritics(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  /** Minúsculas, sem acentos e com espaços colapsados — base de todo casamento de regras. */
  function normalizeText(s) {
    return stripDiacritics(String(s == null ? '' : s).toLowerCase()).replace(/\s+/g, ' ').trim();
  }
  function truncate(s, max) {
    var str = String(s == null ? '' : s);
    if (str.length <= max) return str;
    return str.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, '') + '…';
  }
  function collapseWhitespace(s) {
    return String(s == null ? '' : s).replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*\n\s*/g, '\n\n').trim();
  }
  function wordCount(s) {
    var m = String(s || '').match(/\S+/g);
    return m ? m.length : 0;
  }
  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function isHttpUrl(s) {
    return /^https?:\/\/[^\s<>"']+$/i.test(String(s || ''));
  }
  function emailDomain(email) {
    var m = /@([^@\s>]+)$/.exec(String(email || '').toLowerCase().trim());
    return m ? m[1] : '';
  }

  // ----------------------------------------------------------- coleções ----
  function uniq(arr) {
    var seen = {};
    var out = [];
    for (var i = 0; i < (arr || []).length; i++) {
      var k = typeof arr[i] === 'string' ? arr[i] : JSON.stringify(arr[i]);
      if (!seen[k]) {
        seen[k] = true;
        out.push(arr[i]);
      }
    }
    return out;
  }
  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }
  function chunkString(s, size) {
    var out = [];
    for (var i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
    return out;
  }
  function clamp(x, lo, hi) {
    var v = Number(x);
    if (isNaN(v)) return lo;
    return Math.min(hi, Math.max(lo, v));
  }
  function round(x, digits) {
    var f = Math.pow(10, digits === undefined ? 3 : digits);
    return Math.round(Number(x) * f) / f;
  }
  function safeJsonParse(s, fallback) {
    if (s === null || s === undefined || s === '') return fallback;
    try {
      return JSON.parse(s);
    } catch (e) {
      return fallback;
    }
  }
  function deepClone(o) {
    return o === undefined ? undefined : JSON.parse(JSON.stringify(o));
  }
  function isPlainObject(o) {
    return o !== null && typeof o === 'object' && !Array.isArray(o);
  }
  /** Merge profundo: objetos são mesclados; arrays e escalares substituem. */
  function deepMerge(base, over) {
    if (!isPlainObject(base) || !isPlainObject(over)) return deepClone(over === undefined ? base : over);
    var out = deepClone(base);
    Object.keys(over).forEach(function (k) {
      out[k] = isPlainObject(out[k]) && isPlainObject(over[k]) ? deepMerge(out[k], over[k]) : deepClone(over[k]);
    });
    return out;
  }

  // ------------------------------------------------- retry e orçamento ----
  /**
   * Executa `fn` com retry exponencial e jitter.
   * @param {function(number): *} fn recebe o número da tentativa (1..n)
   * @param {{maxAttempts?: number, baseMs?: number, maxMs?: number, shouldRetry?: function(*): boolean, budget?: *}} [opts]
   */
  function retry(fn, opts) {
    var o = opts || {};
    var max = o.maxAttempts || 3;
    var base = o.baseMs || 1000;
    var cap = o.maxMs || 16000;
    var lastErr;
    for (var attempt = 1; attempt <= max; attempt++) {
      try {
        return fn(attempt);
      } catch (e) {
        lastErr = e;
        var retryable = o.shouldRetry ? o.shouldRetry(e) : isTransientError(e);
        if (!retryable || attempt === max) throw e;
        var wait = backoffMs(attempt, base, cap);
        if (o.budget && o.budget.remainingMs() < wait + 1000) throw e;
        Utilities.sleep(wait);
      }
    }
    throw lastErr;
  }
  function backoffMs(attempt, base, cap) {
    var exp = Math.min(cap, base * Math.pow(2, attempt - 1));
    return Math.round(exp / 2 + Math.random() * (exp / 2));
  }
  /** Erros transitórios de serviços Google (rede, 429, 5xx, "try again"). */
  function isTransientError(e) {
    var code = errorCode(e);
    if (code === 429 || (code >= 500 && code < 600)) return true;
    var msg = String((e && e.message) || e || '');
    return /timed? ?out|temporar|try again|backend error|rate ?limit|service invoked too many times|internal error|unavailable/i.test(msg);
  }
  /** Extrai o código HTTP de erros de serviços avançados ou de respostas UrlFetch. */
  function errorCode(e) {
    if (!e) return 0;
    if (e.details && e.details.code) return Number(e.details.code);
    if (e.code && typeof e.code === 'number') return e.code;
    var m = /(?:code|status|returned code)\s*[:=]?\s*(\d{3})/i.exec(String(e.message || e));
    return m ? Number(m[1]) : 0;
  }
  /**
   * Orçamento de tempo de uma execução (o Apps Script mata em 6 min).
   * @param {number} maxMs
   */
  function createBudget(maxMs) {
    var start = Util.now();
    return {
      startedAt: start,
      maxMs: maxMs,
      elapsedMs: function () {
        return Util.now() - start;
      },
      remainingMs: function () {
        return maxMs - (Util.now() - start);
      },
      hasTime: function (needMs) {
        return maxMs - (Util.now() - start) > (needMs || 0);
      },
    };
  }

  // ----------------------------------------------------- sanitização ----
  // ------------------------------------------------ memo por execução ----
  // Cada execução do Apps Script começa com o módulo zerado; nos testes, os
  // pontos de entrada chamam resetMemo() para simular isso.
  var memo_ = {};
  /** Memoiza uma leitura cara (ex.: PropertiesService) durante a execução. */
  function memo(key, fn) {
    if (!Object.prototype.hasOwnProperty.call(memo_, key)) memo_[key] = fn();
    return memo_[key];
  }
  function forget(key) {
    delete memo_[key];
  }
  function resetMemo() {
    memo_ = {};
  }

  /**
   * Erro da aplicação com código do enum de Monitoring (CONFIG, AUTH, BUDGET...).
   * @param {string} code
   * @param {string} message
   * @return {any}
   */
  function appError(code, message) {
    /** @type {any} */
    var e = new Error(message);
    e.code = code;
    return e;
  }

  /**
   * Mensagem de erro curta e sem dados pessoais (e-mails, URLs, tokens, números longos),
   * segura para logs e para a interface.
   */
  function sanitizeError(e) {
    var msg = String((e && e.message) || e || 'erro desconhecido');
    msg = msg
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .replace(/https?:\/\/\S+/gi, '[url]')
      .replace(/(key|token|bearer|authorization)[=:\s]+\S+/gi, '$1=[redigido]')
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[id]')
      .replace(/\d{6,}/g, '[n]');
    return truncate(msg.replace(/\s+/g, ' ').trim(), 300);
  }

  /**
   * Orientação para o dono quando uma API do Google está desativada (por exemplo, serviço avançado
   * que não foi ativado no projeto Cloud padrão do script). Devolve '' se o erro não for desse tipo.
   */
  function apiDisabledHint(e) {
    var msg = String((e && e.message) || e || '');
    if (!/API has not been used in project|accessNotConfigured|SERVICE_DISABLED/i.test(msg)) return '';
    var m = msg.match(/\b(Gmail|BigQuery)\b/i);
    var svc = m ? (m[1].toLowerCase() === 'gmail' ? 'Gmail' : 'BigQuery') : 'Gmail ou BigQuery';
    return 'A API ' + svc + ' está desativada. No editor do Apps Script, abra Serviços, remova e adicione de novo o serviço ' + svc + ' e salve' +
      (svc === 'Gmail' ? '' : '; confira também se a BigQuery API está ativada no projeto do Sandbox (APIs e serviços)') +
      '. Espere alguns minutos e tente de novo.';
  }

  // ------------------------------------------------------------ cache ----
  var CACHE_CHUNK = 90000;
  /**
   * Cache JSON opcional e fatiado (CacheService aceita até 100 KB por chave).
   * Falhas de cache nunca derrubam a chamada: o cache é só otimização.
   */
  function cachePutJson(key, obj, ttlSec) {
    try {
      var c = CacheService.getScriptCache();
      var s = JSON.stringify(obj);
      var parts = chunkString(s, CACHE_CHUNK);
      if (parts.length > 9) return false;
      var map = {};
      map[key] = 'chunks:' + parts.length;
      for (var i = 0; i < parts.length; i++) map[key + '#' + i] = parts[i];
      c.putAll(map, Math.min(21600, ttlSec || 600));
      return true;
    } catch (e) {
      return false;
    }
  }
  function cacheGetJson(key) {
    try {
      var c = CacheService.getScriptCache();
      var head = c.get(key);
      if (!head || head.indexOf('chunks:') !== 0) return null;
      var n = Number(head.slice(7));
      var keys = [];
      for (var i = 0; i < n; i++) keys.push(key + '#' + i);
      var got = c.getAll(keys);
      var s = '';
      for (var j = 0; j < n; j++) {
        if (got[keys[j]] === undefined || got[keys[j]] === null) return null;
        s += got[keys[j]];
      }
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  return {
    tz: tz,
    cachePutJson: cachePutJson,
    cacheGetJson: cacheGetJson,
    DAY_MS: DAY_MS,
    now: now,
    nowIso: nowIso,
    toIso: toIso,
    ymd: ymd,
    todayYmd: todayYmd,
    ymdToDayNumber: ymdToDayNumber,
    ymdStartEpochSec: ymdStartEpochSec,
    dayNumberToYmd: dayNumberToYmd,
    daysBetween: daysBetween,
    addDays: addDays,
    isoWeekday: isoWeekday,
    isValidYmd: isValidYmd,
    daysInMonth: daysInMonth,
    pad2: pad2,
    formatBrDate: formatBrDate,
    sha256Hex: sha256Hex,
    shortHash: shortHash,
    uuid: uuid,
    nonce: nonce,
    stripDiacritics: stripDiacritics,
    normalizeText: normalizeText,
    truncate: truncate,
    collapseWhitespace: collapseWhitespace,
    wordCount: wordCount,
    escapeRegExp: escapeRegExp,
    isHttpUrl: isHttpUrl,
    emailDomain: emailDomain,
    uniq: uniq,
    chunk: chunk,
    chunkString: chunkString,
    clamp: clamp,
    round: round,
    safeJsonParse: safeJsonParse,
    deepClone: deepClone,
    deepMerge: deepMerge,
    isPlainObject: isPlainObject,
    retry: retry,
    backoffMs: backoffMs,
    isTransientError: isTransientError,
    errorCode: errorCode,
    createBudget: createBudget,
    sanitizeError: sanitizeError,
    apiDisabledHint: apiDisabledHint,
    appError: appError,
    memo: memo,
    forget: forget,
    resetMemo: resetMemo,
  };
})();
