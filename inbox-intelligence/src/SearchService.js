/**
 * Busca/memória: consulta normalizada (sem acento, minúsculas) sobre metadados,
 * trechos ainda retidos e o texto das análises (resumos, fatos, entidades).
 * Operadores: de:remetente, categoria:id-ou-rótulo, "frase exata".
 * Os termos viram parâmetros @terms (nunca SQL concatenado).
 */
var SearchService = (function () {
  var STOP = ['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'para', 'por',
    'com', 'que', 'se', 'ou', 'ao', 'the', 'and', 'of', 'to', 'in', 'for', 'on', 'or'];
  var MAX_TERMS = 8;
  var HORIZON_DAYS = 400;

  function resolveCategory_(s) {
    var n = Util.normalizeText(s);
    var hit = '';
    Config.taxonomy().forEach(function (c) {
      if (!hit && (c.id === n || Util.normalizeText(c.label) === n || Util.normalizeText(c.label).indexOf(n) === 0)) hit = c.id;
    });
    return hit;
  }

  /** Interpreta a consulta do usuário. Pura e testável. */
  function parseQuery(q) {
    var s = String(q || '').slice(0, 300);
    var out = { terms: [], sender: '', categories: [] };
    s = s.replace(/"([^"]{2,80})"/g, function (_, phrase) {
      var n = Util.normalizeText(phrase);
      if (n) out.terms.push(n);
      return ' ';
    });
    s.split(/\s+/).forEach(function (tok) {
      if (!tok) return;
      var m = /^(de|from):(.+)$/i.exec(tok);
      if (m) {
        out.sender = Util.normalizeText(m[2]).replace(/[^a-z0-9@._+-]/g, '').slice(0, 80);
        return;
      }
      m = /^(categoria|cat|category):(.+)$/i.exec(tok);
      if (m) {
        var id = resolveCategory_(m[2]);
        if (id && out.categories.indexOf(id) < 0) out.categories.push(id);
        return;
      }
      var n = Util.normalizeText(tok).replace(/[^a-z0-9@._$%-]/g, '');
      n = n.replace(/^[._-]+|[._-]+$/g, '');
      if (n.length >= 2 && STOP.indexOf(n) < 0) out.terms.push(n.slice(0, 40));
    });
    out.terms = Util.uniq(out.terms).slice(0, MAX_TERMS);
    return out;
  }

  function search(req) {
    var r = req || {};
    var parsed = parseQuery(r.q);
    var page = Math.max(1, Math.min(10, Math.floor(Number(r.page) || 1)));
    var pageSize = 30;
    if (!parsed.terms.length && !parsed.sender && !parsed.categories.length) return { items: [], terms: [], hasMore: false, page: 1 };
    var params = {
      since: Repository.date(Util.addDays(Util.todayYmd(), -HORIZON_DAYS)),
      categories: parsed.categories, levels: [], action: '', deadline: '', unread: '', sender: parsed.sender, status: '',
      terms: parsed.terms, sort: parsed.terms.length ? 'match' : 'date', limit: page * pageSize + 1,
    };
    var res = Repository.cached('search', params, 300, function () {
      return Repository.query('inbox_list', params, { maxRows: params.limit }).rows;
    });
    var offset = (page - 1) * pageSize;
    return {
      _cached: res.cached,
      items: res.rows.slice(offset, offset + pageSize).map(DashboardService.toItem),
      terms: parsed.terms.concat(parsed.sender ? ['de:' + parsed.sender] : [], parsed.categories.map(function (c) { return 'categoria:' + c; })),
      hasMore: res.rows.length > offset + pageSize,
      page: page,
    };
  }

  return {
    parseQuery: parseQuery,
    search: search,
  };
})();
