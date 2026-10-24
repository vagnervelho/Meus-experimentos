/*
 * Mock de google.script.run para o harness de interface (só testes).
 * - API encadeável: withSuccessHandler / withFailureHandler / withUserObject e chamada apiX(req).
 * - Respostas assíncronas a partir de window.__FIXTURES, sempre clonadas (como a serialização real).
 * - Registra chamadas em window.__calls e argumentos inválidos (Date, função, nó DOM) em window.__violations.
 * - Variantes por query string: ?variant=empty|error|nosetup|noai|transport|bootfail ; ?delay=ms
 * - window.__mockFailNext = 'apiX' faz a próxima chamada desse endpoint devolver ok:false.
 */
(function () {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var variant = qs.get('variant') || 'default';
  var delay = Number(qs.get('delay') || 40);
  var handlers = window.__FIXTURES.build(variant);
  var codes = window.__FIXTURES.ERROR_CODES;
  window.__calls = [];
  window.__violations = [];
  window.__variant = variant;

  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function checkArg(v, path) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return null;
    if (typeof v === 'number') return isFinite(v) ? null : path + ': número inválido';
    if (typeof v === 'undefined') return null;
    if (typeof v === 'function') return path + ': função';
    if (v instanceof Date) return path + ': Date não é aceito por google.script.run';
    if (typeof Node !== 'undefined' && v instanceof Node) return path + ': nó DOM';
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) { var e = checkArg(v[i], path + '[' + i + ']'); if (e) return e; } return null; }
    if (typeof v === 'object') {
      var proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return path + ': objeto não simples';
      var ks = Object.keys(v);
      for (var k = 0; k < ks.length; k++) { var e2 = checkArg(v[ks[k]], path + '.' + ks[k]); if (e2) return e2; }
      return null;
    }
    return path + ': tipo não suportado';
  }

  function runner(success, failure, userObj) {
    var base = {
      withSuccessHandler: function (fn) { return runner(fn, failure, userObj); },
      withFailureHandler: function (fn) { return runner(success, fn, userObj); },
      withUserObject: function (o) { return runner(success, failure, o); }
    };
    return new Proxy(base, {
      get: function (t, name) {
        if (name in t) return t[name];
        if (typeof name !== 'string' || !/^api[A-Z]/.test(name)) return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments);
          var req = args[0];
          var bad = args.length > 1 ? 'mais de um argumento' : checkArg(req, 'req');
          window.__calls.push({ name: name, req: bad ? String(bad) : clone(req), at: Date.now() });
          setTimeout(function () {
            if (bad) { window.__violations.push({ name: name, error: bad }); if (failure) failure(new Error('Invalid argument: ' + bad), userObj); return; }
            var fail = window.__mockFailNext === name;
            if (fail) window.__mockFailNext = '';
            var transport = (variant === 'transport' && name !== 'apiBootstrap');
            if (transport) { if (failure) failure(new Error('NetworkError: Connection failure due to HTTP 0'), userObj); return; }
            var env;
            if (fail || (variant === 'error' && name !== 'apiBootstrap') || (variant === 'bootfail' && name === 'apiBootstrap')) {
              var code = variant === 'bootfail' ? 'AUTH' : codes[name] || 'INTERNAL';
              env = { ok: false, error: { code: code, message: 'Falha simulada (' + code + ') <img src=x onerror="window.__xss=3;alert(10)">' } };
            } else if (!handlers[name]) {
              if (failure) failure(new Error('Script function not found: ' + name), userObj);
              return;
            } else {
              try { env = { ok: true, data: handlers[name](clone(req) || {}), meta: { generatedAt: new Date().toISOString(), cached: false } }; }
              catch (e) { env = { ok: false, error: { code: e.code || 'INTERNAL', message: e.message || 'erro' } }; }
            }
            if (success) success(clone(env), userObj);
          }, delay);
        };
      }
    });
  }
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = runner(null, null, undefined);
})();
