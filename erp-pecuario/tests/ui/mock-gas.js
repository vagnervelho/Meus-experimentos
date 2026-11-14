/*
 * Mock de google.script.run para os testes de interface (nível 3). Injetado no <head> da página montada pelo doGet
 * real, antes dos scripts do app. Toda chamada vai ao BACKEND REAL dentro do harness (window.__erpServidor, exposto
 * pelo Playwright: uma execução do Apps Script por chamada, como no servidor). Controles em window.__gas:
 *  - atrasoMs: atraso da resposta (padrão 20 ms);
 *  - perder: n — as próximas n chamadas chegam ao servidor (e gravam), mas a resposta se perde (sem resposta);
 *  - falharTransporte: n — as próximas n chamadas falham no transporte, SEM chegar ao servidor;
 *  - pedidos: o que a página enviou; violacoes: argumentos que o google.script.run real recusaria (Date, função...).
 * Com window.__ERP_TESTE.historico !== false, emula google.script.history e google.script.url sobre o histórico da
 * própria página (o real espelha na URL da janela de cima). Não é arquivo de teste.
 */
(function () {
  'use strict';
  var cfg = window.__ERP_TESTE || {};
  var ctl = window.__gas = { atrasoMs: 20, perder: 0, falharTransporte: 0, pedidos: [], violacoes: [] };

  function simples(v, caminho) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'undefined') return null;
    if (typeof v === 'number') return isFinite(v) ? null : caminho + ': número inválido';
    if (typeof v === 'function') return caminho + ': função';
    if (Object.prototype.toString.call(v) === '[object Date]') return caminho + ': Date não é aceito por google.script.run';
    if (typeof Node !== 'undefined' && v instanceof Node) return caminho + ': nó DOM';
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) { var e = simples(v[i], caminho + '[' + i + ']'); if (e) return e; } return null; }
    if (typeof v === 'object') {
      var proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return caminho + ': objeto que não é simples';
      var ks = Object.keys(v);
      for (var k = 0; k < ks.length; k++) { var e2 = simples(v[ks[k]], caminho + '.' + ks[k]); if (e2) return e2; }
      return null;
    }
    return caminho + ': tipo não suportado';
  }
  function chamar(nome, args, ok, falha) {
    if (nome !== 'api') { setTimeout(function () { if (falha) falha(new Error('Script function not found: ' + nome)); }, 0); return; }
    var pedido = args[0];
    var ruim = args.length !== 1 ? 'mais de um argumento' : simples(pedido, 'pedido');
    if (ruim) { ctl.violacoes.push(ruim); setTimeout(function () { if (falha) falha(new Error('Invalid argument: ' + ruim)); }, 0); return; }
    ctl.pedidos.push(JSON.parse(JSON.stringify(pedido)));
    if (ctl.falharTransporte > 0) {
      ctl.falharTransporte -= 1;
      setTimeout(function () { if (falha) falha(new Error('NetworkError: Connection failure due to HTTP 0')); }, ctl.atrasoMs);
      return;
    }
    var perder = ctl.perder > 0;
    if (perder) ctl.perder -= 1;
    window.__erpServidor(JSON.stringify(pedido)).then(function (json) {
      if (perder) return;
      setTimeout(function () { if (ok) ok(JSON.parse(json)); }, ctl.atrasoMs);
    }, function (e) {
      setTimeout(function () { if (falha) falha(e); }, 0);
    });
  }
  function runner(ok, falha) {
    var base = {
      withSuccessHandler: function (f) { return runner(f, falha); },
      withFailureHandler: function (f) { return runner(ok, f); },
      withUserObject: function () { return runner(ok, falha); },
    };
    return new Proxy(base, {
      get: function (alvo, nome) {
        if (nome in alvo) return alvo[nome];
        if (typeof nome !== 'string') return undefined;
        return function () { chamar(nome, Array.prototype.slice.call(arguments), ok, falha); };
      },
    });
  }
  window.google = { script: { run: runner(null, null) } };
  if (cfg.historico !== false) {
    var tratador = null;
    var loc = function () { return { hash: location.hash.replace(/^#/, ''), parameter: {}, parameters: {} }; };
    window.google.script.history = {
      push: function (estado, params, hash) { history.pushState({ s: estado }, '', '#' + (hash || '')); },
      replace: function (estado, params, hash) { history.replaceState({ s: estado }, '', '#' + (hash || '')); },
      setChangeHandler: function (f) { tratador = f; },
    };
    window.addEventListener('popstate', function (e) { if (tratador) tratador({ state: e.state && e.state.s, location: loc() }); });
    window.google.script.url = { getLocation: function (cb) { setTimeout(function () { cb(loc()); }, 0); } };
  }
})();
