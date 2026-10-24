/**
 * Cliente BigQuery sobre o serviço avançado do Apps Script.
 *
 * - Consultas sempre parametrizadas (parameterMode NAMED), GoogleSQL,
 *   com maximumBytesBilled, rótulos e polling até jobComplete.
 * - Escrita apenas por load jobs NDJSON (gratuitos e permitidos no Sandbox,
 *   que não aceita DML nem streaming). Os jobs são disparados em paralelo e
 *   aguardados; o jobId é determinístico para que um retry seja idempotente.
 * - Cada byte gravado soma no contador vitalício (o Sandbox tem 10 GiB de
 *   armazenamento vitalício que não volta ao apagar dados).
 */
var BigQueryClient = (function () {
  var LIFETIME_KEY = 'BQ_BYTES_WRITTEN';
  var MONTH_QUERY_PREFIX = 'BQ_QUERY_BYTES_';

  function projectId_() {
    var p = Config.projectId();
    if (!p) throw configError_('GCP_PROJECT_ID não configurado nas Propriedades do script.');
    return p;
  }

  function configError_(msg) {
    var e = Util.appError('CONFIG', msg);
    return e;
  }

  /** Referência SQL do dataset (`projeto.dataset`). */
  function datasetRef() {
    return '`' + projectId_() + '.' + Config.datasetId() + '`';
  }

  /** Referência SQL de uma tabela ou view (`projeto.dataset.nome`). */
  function tableRef(name) {
    return '`' + projectId_() + '.' + Config.datasetId() + '.' + name + '`';
  }

  function labelValue_(s) {
    var v = String(s || 'unnamed').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 63);
    return /^[a-z]/.test(v) ? v : 'q_' + v.slice(0, 61);
  }

  // ------------------------------------------------------- parâmetros ----
  /**
   * Converte um valor JS em QueryParameter.
   * Tipos explícitos: {type: 'DATE'|'TIMESTAMP'|'STRING'|'INT64'|'FLOAT64'|'BOOL', value}
   * ou {type: 'ARRAY', arrayType: 'STRING'|'INT64', values: []}.
   */
  function toParam_(name, value) {
    var p = { name: name, parameterType: {}, parameterValue: {} };
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && value.type) {
      if (value.type === 'ARRAY') {
        p.parameterType = { type: 'ARRAY', arrayType: { type: value.arrayType || 'STRING' } };
        p.parameterValue = { arrayValues: (value.values || []).map(function (v) { return { value: String(v) }; }) };
      } else {
        p.parameterType = { type: value.type };
        p.parameterValue = value.value === null || value.value === undefined ? {} : { value: String(value.value) };
      }
      return p;
    }
    if (Array.isArray(value)) {
      var allInt = value.length > 0 && value.every(function (v) { return typeof v === 'number' && Math.floor(v) === v; });
      p.parameterType = { type: 'ARRAY', arrayType: { type: allInt ? 'INT64' : 'STRING' } };
      p.parameterValue = { arrayValues: value.map(function (v) { return { value: String(v) }; }) };
      return p;
    }
    if (typeof value === 'boolean') {
      p.parameterType = { type: 'BOOL' };
      p.parameterValue = { value: value ? 'true' : 'false' };
    } else if (typeof value === 'number') {
      p.parameterType = { type: Math.floor(value) === value ? 'INT64' : 'FLOAT64' };
      p.parameterValue = { value: String(value) };
    } else if (value === null || value === undefined) {
      throw new Error('Parâmetro @' + name + ' nulo precisa de tipo explícito.');
    } else {
      p.parameterType = { type: 'STRING' };
      p.parameterValue = { value: String(value) };
    }
    return p;
  }

  // -------------------------------------------------------- conversão ----
  function convertValue_(field, cell) {
    var v = cell === null || cell === undefined ? null : cell.v === undefined ? cell : cell.v;
    if (v === null || v === undefined) return field.mode === 'REPEATED' ? [] : null;
    if (field.mode === 'REPEATED') {
      var single = { name: field.name, type: field.type, fields: field.fields, mode: 'NULLABLE' };
      return (v || []).map(function (item) {
        return convertValue_(single, item);
      });
    }
    switch (field.type) {
      case 'INTEGER':
      case 'INT64':
      case 'FLOAT':
      case 'FLOAT64':
      case 'NUMERIC':
      case 'BIGNUMERIC':
        return Number(v);
      case 'BOOLEAN':
      case 'BOOL':
        return v === true || v === 'true';
      case 'TIMESTAMP':
        return timestampToIso_(v);
      case 'RECORD':
      case 'STRUCT':
        return convertRow_(field.fields || [], v);
      default:
        return String(v);
    }
  }

  /** TIMESTAMP chega como microssegundos (useInt64Timestamp) ou segundos em ponto flutuante. */
  function timestampToIso_(v) {
    var s = String(v);
    var ms = /[.eE]/.test(s) || s.length < 15 ? parseFloat(s) * 1000 : Number(s) / 1000;
    return new Date(Math.round(ms)).toISOString();
  }

  function convertRow_(fields, row) {
    var out = {};
    var cells = (row && row.f) || [];
    for (var i = 0; i < fields.length; i++) out[fields[i].name] = convertValue_(fields[i], cells[i]);
    return out;
  }

  function convertRows_(schema, rows) {
    var fields = (schema && schema.fields) || [];
    return (rows || []).map(function (r) {
      return convertRow_(fields, r);
    });
  }

  // ---------------------------------------------------------- consulta ----
  /**
   * Executa uma consulta parametrizada e devolve as linhas já convertidas.
   * @param {string} sql
   * @param {Object=} params
   * @param {{name?: string, maxRows?: number, timeoutMs?: number, useCache?: boolean, budgetMs?: number}=} opts
   */
  function query(sql, params, opts) {
    var o = opts || {};
    var cfg = Config.get();
    var projectId = projectId_();
    var location = Config.bqLocation();
    var maxRows = o.maxRows === undefined ? 5000 : o.maxRows;
    var request = {
      query: sql,
      useLegacySql: false,
      parameterMode: 'NAMED',
      queryParameters: Object.keys(params || {}).map(function (k) {
        return toParam_(k, params[k]);
      }),
      maximumBytesBilled: String(cfg.storage.maxBytesBilledPerQuery),
      labels: { app: 'inbox_intel', query_name: labelValue_(o.name) },
      location: location,
      timeoutMs: o.timeoutMs || 20000,
      useQueryCache: o.useCache !== false,
      maxResults: Math.max(1, Math.min(maxRows || 1, 10000)),
      formatOptions: { useInt64Timestamp: true },
    };
    var started = Util.now();
    var resp = Util.retry(function () {
      return BigQuery.Jobs.query(request, projectId);
    }, { maxAttempts: 3, baseMs: 1000 });
    var jobId = resp.jobReference && resp.jobReference.jobId;
    var deadline = started + (o.budgetMs || 120000);
    var wait = 500;
    while (!resp.jobComplete) {
      if (!jobId) throw new Error('Consulta sem jobReference e incompleta.');
      if (Util.now() + wait > deadline) throw new Error('Tempo esgotado aguardando a consulta ' + (o.name || ''));
      Utilities.sleep(wait);
      wait = Math.min(wait * 2, 4000);
      resp = BigQuery.Jobs.getQueryResults(projectId, jobId, { location: location, timeoutMs: 10000, maxResults: request.maxResults, 'formatOptions.useInt64Timestamp': true });
    }
    var rows = convertRows_(resp.schema, resp.rows);
    var pageToken = resp.pageToken;
    while (pageToken && jobId && rows.length < maxRows) {
      var page = BigQuery.Jobs.getQueryResults(projectId, jobId, { location: location, pageToken: pageToken, maxResults: request.maxResults, 'formatOptions.useInt64Timestamp': true });
      rows = rows.concat(convertRows_(page.schema || resp.schema, page.rows));
      pageToken = page.pageToken;
    }
    if (rows.length > maxRows) rows = rows.slice(0, maxRows);
    var bytes = Number(resp.totalBytesBilled || resp.totalBytesProcessed || 0);
    addMonthlyQueryBytes_(bytes);
    return {
      rows: rows,
      totalBytesProcessed: Number(resp.totalBytesProcessed || 0),
      totalBytesBilled: bytes,
      cacheHit: !!resp.cacheHit,
      jobId: jobId || '',
      numDmlAffectedRows: resp.numDmlAffectedRows ? Number(resp.numDmlAffectedRows) : 0,
      durationMs: Util.now() - started,
    };
  }

  /** DDL (CREATE/DROP/CTAS). Sem cache e sem parâmetros de usuário. */
  function ddl(sql, name) {
    return query(sql, {}, { name: name || 'ddl', maxRows: 1, useCache: false, timeoutMs: 30000, budgetMs: 180000 });
  }

  // ------------------------------------------------------------- loads ----
  /**
   * Dispara um load job NDJSON (WRITE_APPEND) sem aguardar.
   * @param {string} tableId tabela física (ex.: messages__g1)
   * @param {Object[]} rows linhas já no formato da tabela
   * @param {{jobKey?: string}=} opts jobKey estável torna o retry idempotente
   * @return {{jobId: string, location: string, tableId: string, rows: number, bytes: number}|null}
   */
  function loadNdjson(tableId, rows, opts) {
    if (!rows || !rows.length) return null;
    var o = opts || {};
    var projectId = projectId_();
    var location = Config.bqLocation();
    var ndjson = rows.map(function (r) {
      return JSON.stringify(r);
    }).join('\n');
    var jobId = 'ii_load_' + labelValue_(tableId) + '_' + (o.jobKey ? Util.shortHash(o.jobKey + ':' + ndjson.length, 20) : Util.uuid().replace(/-/g, ''));
    var job = {
      jobReference: { projectId: projectId, jobId: jobId, location: location },
      configuration: {
        load: {
          destinationTable: { projectId: projectId, datasetId: Config.datasetId(), tableId: tableId },
          sourceFormat: 'NEWLINE_DELIMITED_JSON',
          writeDisposition: 'WRITE_APPEND',
          createDisposition: 'CREATE_NEVER',
          ignoreUnknownValues: false,
          maxBadRecords: 0,
        },
        labels: { app: 'inbox_intel', load_table: labelValue_(tableId) },
      },
    };
    Util.retry(function () {
      try {
        var blob = Utilities.newBlob(ndjson, 'application/octet-stream');
        return BigQuery.Jobs.insert(job, projectId, blob);
      } catch (e) {
        // 409: o job já existe (retry após falha de rede) — seguimos para o polling.
        if (Util.errorCode(e) === 409 || /already exists/i.test(String(e.message))) return null;
        throw e;
      }
    }, { maxAttempts: 3, baseMs: 1500 });
    return { jobId: jobId, location: location, tableId: tableId, rows: rows.length, bytes: ndjson.length };
  }

  /**
   * Aguarda load jobs até DONE. Nunca lança: devolve o resultado de cada job.
   * @param {Array<{jobId: string, location: string, tableId: string}|null>} refs
   * @param {{remainingMs: function(): number}=} budget
   */
  function waitJobs(refs, budget) {
    var projectId = projectId_();
    var pending = (refs || []).filter(Boolean).map(function (r) {
      return { ref: r, done: false, result: null };
    });
    var maxWait = budget ? Math.max(20000, Math.min(150000, budget.remainingMs() - 15000)) : 150000;
    var deadline = Util.now() + maxWait;
    var wait = 700;
    while (true) {
      pending.forEach(function (p) {
        if (p.done) return;
        try {
          var j = BigQuery.Jobs.get(projectId, p.ref.jobId, { location: p.ref.location });
          if (j && j.status && j.status.state === 'DONE') {
            p.done = true;
            var err = j.status.errorResult;
            var stats = (j.statistics && j.statistics.load) || {};
            p.result = {
              tableId: p.ref.tableId,
              jobId: p.ref.jobId,
              ok: !err,
              error: err ? Util.sanitizeError(err.message || err.reason || 'load falhou') : '',
              outputRows: Number(stats.outputRows || (err ? 0 : /** @type {any} */ (p.ref).rows) || 0),
              outputBytes: Number(stats.outputBytes || (err ? 0 : /** @type {any} */ (p.ref).bytes) || 0),
            };
            if (!err) addLifetimeBytes(p.result.outputBytes);
          }
        } catch (e) {
          if (!Util.isTransientError(e)) {
            p.done = true;
            p.result = { tableId: p.ref.tableId, jobId: p.ref.jobId, ok: false, error: Util.sanitizeError(e), outputRows: 0, outputBytes: 0 };
          }
        }
      });
      if (pending.every(function (p) { return p.done; })) break;
      if (Util.now() + wait > deadline) break;
      Utilities.sleep(wait);
      wait = Math.min(wait * 1.6, 4000);
    }
    return pending.map(function (p) {
      return p.result || { tableId: p.ref.tableId, jobId: p.ref.jobId, ok: false, error: 'tempo esgotado aguardando o load', outputRows: 0, outputBytes: 0, timeout: true };
    });
  }

  // ---------------------------------------------------------- metadados ----
  function tableInfo(tableId) {
    try {
      var t = BigQuery.Tables.get(projectId_(), Config.datasetId(), tableId);
      return {
        exists: true,
        creationTime: Number(t.creationTime || 0),
        expirationTime: t.expirationTime ? Number(t.expirationTime) : null,
        numBytes: Number(t.numBytes || 0),
        numRows: Number(t.numRows || 0),
        type: t.type || 'TABLE',
      };
    } catch (e) {
      if (Util.errorCode(e) === 404 || /not found/i.test(String(e.message))) return { exists: false };
      throw e;
    }
  }

  function deleteTable(tableId) {
    try {
      BigQuery.Tables.remove(projectId_(), Config.datasetId(), tableId);
      return true;
    } catch (e) {
      if (Util.errorCode(e) === 404 || /not found/i.test(String(e.message))) return false;
      throw e;
    }
  }

  /** Cria o dataset se não existir (no Sandbox ele herda a expiração padrão de 60 dias). */
  function ensureDataset() {
    var projectId = projectId_();
    var datasetId = Config.datasetId();
    try {
      BigQuery.Datasets.get(projectId, datasetId);
      return { created: false };
    } catch (e) {
      if (!(Util.errorCode(e) === 404 || /not found/i.test(String(e.message)))) throw e;
      /** @type {any} */
      var resource = {
        datasetReference: { projectId: projectId, datasetId: datasetId },
        location: Config.bqLocation(),
        description: 'Inbox Intelligence — dados derivados do Gmail (somente leitura). Reconstruível a partir do Gmail.',
        labels: { app: 'inbox_intel' },
        // Mínimo permitido: menos armazenamento de time travel contando no limite do Sandbox.
        maxTimeTravelHours: '48',
      };
      BigQuery.Datasets.insert(resource, projectId);
      return { created: true };
    }
  }

  // ----------------------------------------------------------- contadores ----
  function addLifetimeBytes(n) {
    if (!n) return;
    var p = PropertiesService.getScriptProperties();
    var cur = Number(p.getProperty(LIFETIME_KEY) || 0);
    p.setProperty(LIFETIME_KEY, String(cur + Number(n)));
  }

  function lifetimeBytes() {
    return Number(PropertiesService.getScriptProperties().getProperty(LIFETIME_KEY) || 0);
  }

  function addMonthlyQueryBytes_(n) {
    if (!n) return;
    var key = MONTH_QUERY_PREFIX + Util.ymd().slice(0, 7);
    var p = PropertiesService.getScriptProperties();
    p.setProperty(key, String(Number(p.getProperty(key) || 0) + n));
  }

  function monthlyQueryBytes() {
    return Number(PropertiesService.getScriptProperties().getProperty(MONTH_QUERY_PREFIX + Util.ymd().slice(0, 7)) || 0);
  }

  return {
    datasetRef: datasetRef,
    tableRef: tableRef,
    query: query,
    ddl: ddl,
    loadNdjson: loadNdjson,
    waitJobs: waitJobs,
    tableInfo: tableInfo,
    deleteTable: deleteTable,
    ensureDataset: ensureDataset,
    addLifetimeBytes: addLifetimeBytes,
    lifetimeBytes: lifetimeBytes,
    monthlyQueryBytes: monthlyQueryBytes,
    _toParam: toParam_,
    _convertRows: convertRows_,
  };
})();
