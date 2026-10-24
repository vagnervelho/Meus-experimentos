/**
 * Fonte única do esquema BigQuery.
 *
 * - Tabelas físicas por GERAÇÃO GLOBAL (`nome__gN`, um único ponteiro para todas):
 *   no Sandbox tabelas e views expiram 60 dias após a criação e a expiração não
 *   pode ser estendida além disso, então a renovação cria a geração N+1 (CTAS) e
 *   a N é removida só na manutenção seguinte (1 dia de rollback).
 * - Append-only (o Sandbox não aceita DML); as views escolhem a versão vigente.
 * - Colunas todas NULLABLE/REPEATED para que o CTAS preserve o esquema.
 * - Retenção: trechos literais (corpo, snippet, links, evidências, resumo
 *   extrativo) são mascarados nas views após N dias e removidos na renovação.
 */
var Schema = (function () {
  var GEN_KEY = 'BQ_GENERATION';
  var DROP_KEY = 'BQ_DROP_PENDING';
  var TZ_SQL = "'America/Sao_Paulo'";

  var TABLES = [
    {
      name: 'messages', clusterBy: ['message_id'],
      description: 'Conteúdo imutável de cada mensagem (trechos literais com retenção).',
      columns: [
        ['message_id', 'STRING'], ['thread_id', 'STRING'], ['rfc822_message_id', 'STRING'], ['history_id', 'STRING'],
        ['internal_ts', 'TIMESTAMP'], ['received_date', 'DATE'], ['direction', 'STRING'], ['fetch_format', 'STRING'],
        ['from_email', 'STRING'], ['from_name', 'STRING'], ['from_domain', 'STRING'], ['reply_to_email', 'STRING'],
        ['to_emails', 'ARRAY<STRING>'], ['cc_emails', 'ARRAY<STRING>'], ['recipient_count', 'INT64'],
        ['user_in_to', 'BOOL'], ['user_in_cc', 'BOOL'],
        ['subject', 'STRING'], ['snippet', 'STRING'], ['body_excerpt', 'STRING'], ['body_chars', 'INT64'],
        ['body_truncated', 'BOOL'], ['has_html', 'BOOL'], ['is_forwarded', 'BOOL'], ['is_reply', 'BOOL'],
        ['is_bulk', 'BOOL'], ['is_automated', 'BOOL'], ['has_list_unsubscribe', 'BOOL'], ['list_id', 'STRING'],
        ['unsubscribe_url', 'STRING'], ['auth_pass', 'BOOL'], ['auth_fail', 'BOOL'],
        ['links_json', 'STRING'], ['attachments_json', 'STRING'], ['attachment_count', 'INT64'],
        ['content_hash', 'STRING'], ['search_meta', 'STRING'], ['search_body', 'STRING'], ['size_estimate', 'INT64'],
        ['parse_status', 'STRING'], ['parser_version', 'STRING'], ['run_id', 'STRING'], ['version_ts', 'TIMESTAMP'],
      ],
    },
    {
      name: 'message_state', clusterBy: ['message_id'],
      description: 'Snapshot completo do estado no Gmail (labels, lido, estrela, lixeira); uma linha por mudança.',
      columns: [
        ['message_id', 'STRING'], ['thread_id', 'STRING'], ['label_ids', 'ARRAY<STRING>'], ['gmail_category', 'STRING'],
        ['is_unread', 'BOOL'], ['is_starred', 'BOOL'], ['is_important', 'BOOL'], ['in_inbox', 'BOOL'],
        ['gmail_state', 'STRING'], ['source', 'STRING'], ['run_id', 'STRING'], ['version_ts', 'TIMESTAMP'],
      ],
    },
    {
      name: 'analyses', clusterBy: ['message_id'],
      description: 'Análise por método (RULES/AI) e versão do classificador. Evidências literais isoladas em evidence_json.',
      columns: [
        ['analysis_id', 'STRING'], ['message_id', 'STRING'], ['thread_id', 'STRING'], ['received_date', 'DATE'],
        ['method', 'STRING'], ['provider', 'STRING'], ['model', 'STRING'], ['classifier_version', 'STRING'],
        ['config_version', 'STRING'], ['prompt_version', 'STRING'], ['send_policy', 'STRING'],
        ['primary_category', 'STRING'], ['secondary_categories', 'ARRAY<STRING>'], ['topics', 'ARRAY<STRING>'],
        ['summary', 'STRING'], ['summary_kind', 'STRING'], ['key_facts_json', 'STRING'], ['whats_new', 'STRING'],
        ['relevance', 'INT64'], ['importance', 'INT64'], ['urgency', 'INT64'],
        ['action_required', 'BOOL'], ['actions_json', 'STRING'],
        ['deadline_date', 'DATE'], ['deadline_certainty', 'STRING'], ['deadline_evidence', 'STRING'],
        ['entities_json', 'STRING'], ['opportunity_json', 'STRING'], ['opportunity_key', 'STRING'],
        ['evidence_json', 'STRING'], ['evidence_total', 'INT64'], ['evidence_verified', 'INT64'],
        ['confidence', 'FLOAT64'], ['reason', 'STRING'],
        ['is_newsletter', 'BOOL'], ['is_marketing', 'BOOL'], ['is_probable_spam', 'BOOL'],
        ['sensitive', 'BOOL'], ['ai_eligible', 'BOOL'], ['injection_suspected', 'BOOL'],
        ['ai_status', 'STRING'], ['ai_attempts', 'INT64'], ['ai_error', 'STRING'],
        ['features_json', 'STRING'], ['redactions_json', 'STRING'],
        ['input_tokens', 'INT64'], ['output_tokens', 'INT64'], ['cost_usd', 'FLOAT64'], ['latency_ms', 'INT64'],
        ['search_text', 'STRING'], ['run_id', 'STRING'], ['version_ts', 'TIMESTAMP'],
      ],
    },
    {
      name: 'scores', clusterBy: ['message_id'],
      description: 'Prioridade vigente e eixos (relevância, urgência, ação). Teto de críticas aplicado na leitura.',
      columns: [
        ['message_id', 'STRING'], ['analysis_id', 'STRING'], ['received_date', 'DATE'],
        ['score', 'FLOAT64'], ['level', 'STRING'], ['critical_eligible', 'BOOL'], ['info_score', 'FLOAT64'],
        ['relevance', 'FLOAT64'], ['urgency', 'FLOAT64'], ['action', 'FLOAT64'],
        ['deadline_date', 'DATE'], ['components_json', 'STRING'], ['reason', 'STRING'], ['source', 'STRING'],
        ['run_id', 'STRING'], ['version_ts', 'TIMESTAMP'],
      ],
    },
    {
      name: 'feedback', clusterBy: ['target_id'],
      description: 'Eventos de feedback do usuário (append-only, trilha de auditoria; nunca expurgados).',
      columns: [
        ['feedback_id', 'STRING'], ['target_type', 'STRING'], ['target_id', 'STRING'], ['message_id', 'STRING'],
        ['feedback_type', 'STRING'], ['payload_json', 'STRING'], ['source', 'STRING'], ['created_at', 'TIMESTAMP'], ['version_ts', 'TIMESTAMP'],
      ],
    },
    {
      name: 'runs', clusterBy: ['run_id'],
      description: 'Execuções do pipeline e da manutenção, com métricas e códigos de erro (sem conteúdo).',
      columns: [
        ['run_id', 'STRING'], ['kind', 'STRING'], ['trigger_source', 'STRING'], ['started_at', 'TIMESTAMP'], ['finished_at', 'TIMESTAMP'],
        ['status', 'STRING'], ['duration_ms', 'INT64'], ['stages_json', 'STRING'], ['counts_json', 'STRING'],
        ['gmail_units', 'INT64'], ['bq_bytes_processed', 'INT64'], ['bq_bytes_written', 'INT64'],
        ['ai_requests', 'INT64'], ['ai_input_tokens', 'INT64'], ['ai_output_tokens', 'INT64'], ['ai_cost_usd', 'FLOAT64'],
        ['errors_json', 'STRING'], ['checkpoint_json', 'STRING'], ['app_version', 'STRING'], ['classifier_version', 'STRING'],
        ['version_ts', 'TIMESTAMP'],
      ],
    },
    {
      name: 'briefings', clusterBy: ['period'],
      description: 'Briefings do Radar (persistidos; regravados só quando o conteúdo muda).',
      columns: [
        ['briefing_id', 'STRING'], ['period', 'STRING'], ['period_start', 'DATE'], ['period_end', 'DATE'],
        ['method', 'STRING'], ['provider', 'STRING'], ['model', 'STRING'], ['content_hash', 'STRING'], ['content_json', 'STRING'], ['stats_json', 'STRING'],
        ['run_id', 'STRING'], ['version_ts', 'TIMESTAMP'],
      ],
    },
  ];

  // --------------------------------------------------------- gerações ----
  function generation() {
    return Number(PropertiesService.getScriptProperties().getProperty(GEN_KEY) || 1);
  }

  function setGeneration(n) {
    PropertiesService.getScriptProperties().setProperty(GEN_KEY, String(n));
  }

  function pendingDrop() {
    var v = PropertiesService.getScriptProperties().getProperty(DROP_KEY);
    return v ? Number(v) : 0;
  }

  function setPendingDrop(n) {
    var p = PropertiesService.getScriptProperties();
    if (n) p.setProperty(DROP_KEY, String(n));
    else p.deleteProperty(DROP_KEY);
  }

  /** Nome físico (ex.: messages__g3). */
  function physical(name, gen) {
    return name + '__g' + (gen || generation());
  }

  function names() {
    return TABLES.map(function (t) {
      return t.name;
    });
  }

  function table(name) {
    for (var i = 0; i < TABLES.length; i++) if (TABLES[i].name === name) return TABLES[i];
    throw new Error('Tabela desconhecida: ' + name);
  }

  function columnTypes(name) {
    var out = {};
    table(name).columns.forEach(function (c) {
      out[c[0]] = c[1];
    });
    return out;
  }

  // ---------------------------------------------------- validação de linha ----
  /**
   * Normaliza uma linha para o load NDJSON: remove campos desconhecidos, converte
   * tipos e garante arrays em colunas REPEATED. Retorna {row, errors}.
   */
  function coerceRow(name, row) {
    var types = columnTypes(name);
    var out = {};
    var errors = [];
    Object.keys(types).forEach(function (col) {
      var t = types[col];
      var v = row[col];
      if (t === 'ARRAY<STRING>') {
        out[col] = Array.isArray(v) ? v.filter(function (x) { return x !== null && x !== undefined; }).map(String) : [];
        return;
      }
      if (v === undefined || v === null || (v === '' && t !== 'STRING')) {
        out[col] = null;
        return;
      }
      if (t === 'INT64') {
        var n = Math.round(Number(v));
        if (isNaN(n)) errors.push(col);
        out[col] = isNaN(n) ? null : n;
      } else if (t === 'FLOAT64') {
        var f = Number(v);
        if (isNaN(f)) errors.push(col);
        out[col] = isNaN(f) ? null : f;
      } else if (t === 'BOOL') {
        out[col] = v === true || v === 'true';
      } else if (t === 'DATE') {
        if (!Util.isValidYmd(v)) errors.push(col);
        out[col] = Util.isValidYmd(v) ? v : null;
      } else if (t === 'TIMESTAMP') {
        var iso = Util.toIso(typeof v === 'number' ? v : Date.parse(v));
        if (!iso) errors.push(col);
        out[col] = iso;
      } else {
        out[col] = typeof v === 'string' ? v : JSON.stringify(v);
      }
    });
    return { row: out, errors: errors };
  }

  // -------------------------------------------------------------- DDL ----
  function optionsSql_(t) {
    return "OPTIONS (description = '" + t.description.replace(/'/g, "\\'") + "', labels = [('app', 'inbox_intel')])";
  }

  function createTableSql(name, gen) {
    var t = table(name);
    var cols = t.columns.map(function (c) {
      return '  ' + c[0] + ' ' + c[1];
    }).join(',\n');
    return 'CREATE TABLE IF NOT EXISTS ' + BigQueryClient.tableRef(physical(name, gen)) + ' (\n' + cols + '\n)\n' +
      'CLUSTER BY ' + t.clusterBy.join(', ') + '\n' + optionsSql_(t);
  }

  function daysAgo_(days) {
    return 'DATE_SUB(CURRENT_DATE(' + TZ_SQL + '), INTERVAL ' + Number(days) + ' DAY)';
  }

  /**
   * CTAS da renovação para a geração `toGen`: versão vigente por chave,
   * horizonte físico, retenção dos trechos literais e remoção dos dados de
   * mensagens excluídas no Gmail.
   * @param {{retentionDays: number, horizonMonths: number, runsDays: number, briefingsDays: number}} o
   */
  function renewSql(name, fromGen, toGen, o) {
    var t = table(name);
    var src = BigQueryClient.tableRef(physical(name, fromGen));
    var state = BigQueryClient.tableRef(physical('message_state', fromGen));
    var horizon = 'DATE_SUB(CURRENT_DATE(' + TZ_SQL + '), INTERVAL ' + Number(o.horizonMonths) + ' MONTH)';
    var old = 't.received_date < ' + daysAgo_(o.retentionDays);
    var deleted = 'NOT EXISTS (SELECT 1 FROM ' + state + " d WHERE d.message_id = t.message_id AND d.gmail_state = 'DELETED')";
    var select = 'SELECT *';
    var where = 'WHERE TRUE';
    var partition = 'message_id';
    if (name === 'messages') {
      select = 'SELECT * REPLACE (\n' +
        ['body_excerpt', 'snippet', 'search_body', 'links_json'].map(function (c) {
          return '    IF(' + old + ', NULL, t.' + c + ') AS ' + c;
        }).join(',\n') + '\n  )';
      where = 'WHERE t.received_date >= ' + horizon + '\n  AND ' + deleted;
    } else if (name === 'analyses') {
      select = 'SELECT * REPLACE (\n' +
        '    IF(' + old + ', NULL, t.evidence_json) AS evidence_json,\n' +
        '    IF(' + old + ', NULL, t.deadline_evidence) AS deadline_evidence,\n' +
        "    IF(" + old + " AND t.summary_kind = 'EXTRACTIVE', NULL, t.summary) AS summary\n  )";
      where = 'WHERE t.received_date >= ' + horizon + '\n  AND ' + deleted;
      partition = 'message_id, method';
    } else if (name === 'scores') {
      where = 'WHERE t.received_date >= ' + horizon + '\n  AND ' + deleted;
    } else if (name === 'message_state') {
      where = 'WHERE DATE(t.version_ts, ' + TZ_SQL + ') >= ' + horizon;
    } else if (name === 'feedback') {
      partition = 'feedback_id';
    } else if (name === 'runs') {
      where = 'WHERE t.version_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ' + Number(o.runsDays) + ' DAY)';
      partition = 'run_id';
    } else if (name === 'briefings') {
      where = 'WHERE t.version_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ' + Number(o.briefingsDays) + ' DAY)';
      partition = 'briefing_id';
    }
    return 'CREATE OR REPLACE TABLE ' + BigQueryClient.tableRef(physical(name, toGen)) + '\n' +
      'CLUSTER BY ' + t.clusterBy.join(', ') + '\n' + optionsSql_(t) + '\nAS\n' +
      select + '\nFROM ' + src + ' AS t\n' + where + '\n' +
      'QUALIFY ROW_NUMBER() OVER (PARTITION BY ' + partition + ' ORDER BY version_ts DESC) = 1';
  }

  function dropTableSql(name, gen) {
    return 'DROP TABLE IF EXISTS ' + BigQueryClient.tableRef(physical(name, gen));
  }

  // ------------------------------------------------------------ views ----
  function viewRef_(short) {
    return BigQueryClient.tableRef('v_' + short);
  }

  /**
   * Definições das views para a geração `gen`.
   * @param {{retentionDays: number, criticalCap: number, criticalRecencyDays: number, openDaysWithoutDeadline: number, overdueAutoResolveDays: number}} o
   */
  function viewDefinitions(gen, o) {
    var g = gen || generation();
    function T(n) {
      return BigQueryClient.tableRef(physical(n, g));
    }
    var oldMsg = 'm.received_date < ' + daysAgo_(o.retentionDays);
    var defs = {};

    defs.messages = 'SELECT * FROM ' + T('messages') + ' WHERE TRUE\n' +
      'QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1';

    defs.state = 'SELECT * FROM ' + T('message_state') + ' WHERE TRUE\n' +
      'QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1';

    // A análise de IA prevalece sobre a de regras; dentro do método, a mais recente.
    defs.analysis = 'SELECT * FROM ' + T('analyses') + ' WHERE TRUE\n' +
      "QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY IF(method = 'AI', 1, 0) DESC, version_ts DESC) = 1";

    defs.scores = 'SELECT * FROM ' + T('scores') + ' WHERE TRUE\n' +
      'QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1';

    // Estado do usuário por alvo: último evento de status, de relevância e de categoria.
    // status NULL = sem feedback; '' = reaberto explicitamente (prevalece sobre a auto-resolução).
    defs.user_state = 'WITH f AS (\n' +
      '  SELECT target_type, target_id, message_id, feedback_type, payload_json, version_ts,\n' +
      "    CASE WHEN feedback_type IN ('RESOLVED', 'SAVED', 'DISMISSED', 'REOPEN') THEN 'status'\n" +
      "         WHEN feedback_type IN ('RELEVANT', 'IRRELEVANT', 'SHOULD_BE_HIGHER', 'LEVEL_OK') THEN 'relevance'\n" +
      "         WHEN feedback_type = 'MISCLASSIFIED' THEN 'category' END AS dim\n" +
      '  FROM ' + T('feedback') + '\n' +
      '), last AS (\n' +
      '  SELECT * FROM f WHERE dim IS NOT NULL\n' +
      '  QUALIFY ROW_NUMBER() OVER (PARTITION BY target_type, target_id, dim ORDER BY version_ts DESC) = 1\n' +
      ')\n' +
      'SELECT target_type, target_id, ANY_VALUE(message_id) AS message_id,\n' +
      "  MAX(IF(dim = 'status', IF(feedback_type = 'REOPEN', '', feedback_type), NULL)) AS status,\n" +
      "  MAX(IF(dim = 'relevance', feedback_type, NULL)) AS relevance,\n" +
      "  MAX(IF(dim = 'category', JSON_VALUE(payload_json, '$.correctCategory'), NULL)) AS correct_category,\n" +
      '  MAX(version_ts) AS updated_at\n' +
      'FROM last\nGROUP BY target_type, target_id';

    var ret = function (col) {
      return 'IF(' + oldMsg + ', NULL, ' + col + ')';
    };
    var cap = Number(o.criticalCap);
    var rank = 'ROW_NUMBER() OVER (PARTITION BY critical_candidate ORDER BY score DESC, message_id)';
    defs.inbox = 'WITH base AS (\n' +
      'SELECT\n' +
      '  m.message_id, m.thread_id, m.rfc822_message_id, m.internal_ts, m.received_date, m.direction,\n' +
      '  m.from_email, m.from_name, m.from_domain, m.to_emails, m.cc_emails, m.user_in_to, m.user_in_cc,\n' +
      '  m.subject, ' + ret('m.snippet') + ' AS snippet, ' + ret('m.body_excerpt') + ' AS body_excerpt,\n' +
      '  ' + ret('m.search_body') + ' AS search_body, ' + ret('m.links_json') + ' AS links_json,\n' +
      '  m.search_meta, m.body_chars, m.is_bulk, m.is_automated, m.has_list_unsubscribe, m.unsubscribe_url, m.list_id,\n' +
      '  m.attachments_json, m.attachment_count, m.auth_pass, m.auth_fail, m.content_hash, m.parse_status,\n' +
      '  ' + oldMsg + ' AS retention_expired,\n' +
      '  COALESCE(s.is_unread, FALSE) AS is_unread, COALESCE(s.is_starred, FALSE) AS is_starred,\n' +
      '  COALESCE(s.is_important, FALSE) AS is_important, COALESCE(s.in_inbox, TRUE) AS in_inbox,\n' +
      "  COALESCE(s.gmail_state, 'ACTIVE') AS gmail_state, s.gmail_category, s.label_ids,\n" +
      '  a.analysis_id, a.method, a.provider, a.model, COALESCE(u.correct_category, a.primary_category) AS primary_category,\n' +
      '  a.primary_category AS model_category, a.secondary_categories, a.topics,\n' +
      "  IF(" + oldMsg + " AND a.summary_kind = 'EXTRACTIVE', NULL, a.summary) AS summary, a.summary_kind,\n" +
      '  a.key_facts_json, a.whats_new, a.relevance AS ai_relevance, a.importance AS ai_importance, a.urgency AS ai_urgency,\n' +
      '  a.action_required, a.actions_json, a.deadline_certainty, ' + ret('a.deadline_evidence') + ' AS deadline_evidence,\n' +
      '  a.entities_json, a.opportunity_json, a.opportunity_key, ' + ret('a.evidence_json') + ' AS evidence_json,\n' +
      '  a.evidence_total, a.evidence_verified, a.confidence, a.reason, a.is_newsletter, a.is_marketing, a.is_probable_spam,\n' +
      '  a.sensitive, a.injection_suspected, a.ai_eligible, a.ai_status, a.ai_attempts, a.ai_error, a.features_json,\n' +
      '  a.search_text AS analysis_search, a.version_ts AS analyzed_at,\n' +
      '  sc.score, sc.level, sc.critical_eligible, sc.info_score, sc.relevance AS relevance_axis, sc.urgency AS urgency_axis,\n' +
      '  sc.action AS action_axis, COALESCE(sc.deadline_date, a.deadline_date) AS deadline_date, sc.components_json,\n' +
      "  COALESCE(u.status, '') AS user_status, COALESCE(u.relevance, '') AS user_relevance, u.correct_category\n" +
      'FROM ' + viewRef_('messages') + ' m\n' +
      'LEFT JOIN ' + viewRef_('state') + ' s ON s.message_id = m.message_id\n' +
      'LEFT JOIN ' + viewRef_('analysis') + ' a ON a.message_id = m.message_id\n' +
      'LEFT JOIN ' + viewRef_('scores') + ' sc ON sc.message_id = m.message_id\n' +
      'LEFT JOIN ' + viewRef_('user_state') + " u ON u.target_type = 'MESSAGE' AND u.target_id = m.message_id\n" +
      "WHERE COALESCE(s.gmail_state, 'ACTIVE') NOT IN ('DELETED', 'SPAM', 'TRASHED')\n" +
      '), flagged AS (\n' +
      "  SELECT *, COALESCE(level = 'CRITICAL' AND in_inbox AND user_status NOT IN ('RESOLVED', 'DISMISSED') AND user_relevance != 'IRRELEVANT'\n" +
      '    AND (received_date >= ' + daysAgo_(o.criticalRecencyDays) + ' OR deadline_date >= CURRENT_DATE(' + TZ_SQL + ')), FALSE) AS critical_candidate\n' +
      '  FROM base\n' +
      ')\n' +
      'SELECT *,\n' +
      "  CASE WHEN critical_candidate AND " + rank + ' <= ' + cap + " THEN 'CRITICAL'\n" +
      "       WHEN level = 'CRITICAL' THEN 'HIGH' ELSE level END AS display_level,\n" +
      "  COALESCE(level = 'CRITICAL' AND NOT (critical_candidate AND " + rank + ' <= ' + cap + '), FALSE) AS critical_overflow\n' +
      'FROM flagged';

    // Tarefas: última mensagem recebida com ações em cada thread; auto-resolução reabrível.
    var actId = "COALESCE(JSON_VALUE(a.act, '$.id'), CONCAT(a.message_id, ':', CAST(a.off AS STRING)))";
    var due = "SAFE_CAST(NULLIF(JSON_VALUE(a.act, '$.due_date'), '') AS DATE)";
    defs.actions = 'WITH acts AS (\n' +
      '  SELECT i.message_id, i.thread_id, i.internal_ts, i.received_date, i.subject, i.from_name, i.from_email, i.method,\n' +
      '    i.in_inbox, i.user_status, i.display_level, i.score, act, off\n' +
      '  FROM ' + viewRef_('inbox') + ' i\n' +
      "  CROSS JOIN UNNEST(JSON_QUERY_ARRAY(COALESCE(i.actions_json, '[]'))) AS act WITH OFFSET off\n" +
      // Golpe, spam ou falha de autenticação nunca viram tarefa, nem mensagens sem ação vigente.
      "  WHERE i.direction = 'INBOUND' AND COALESCE(i.action_required, FALSE)\n" +
      '    AND NOT COALESCE(i.is_probable_spam, FALSE) AND NOT COALESCE(i.auth_fail, FALSE)\n' +
      '  QUALIFY DENSE_RANK() OVER (PARTITION BY i.thread_id ORDER BY i.internal_ts DESC, i.message_id) = 1\n' +
      '), replies AS (\n' +
      '  SELECT thread_id, MAX(internal_ts) AS last_sent FROM ' + viewRef_('messages') + " WHERE direction = 'OUTBOUND' GROUP BY thread_id\n" +
      ')\n' +
      'SELECT\n' +
      '  ' + actId + ' AS action_id,\n' +
      '  a.message_id, a.thread_id, a.internal_ts, a.received_date, a.subject, a.from_name, a.from_email, a.method,\n' +
      "  JSON_VALUE(a.act, '$.description') AS description,\n" +
      "  JSON_VALUE(a.act, '$.owner') AS owner,\n" +
      '  ' + due + ' AS due_date,\n' +
      "  JSON_VALUE(a.act, '$.due_certainty') AS due_certainty,\n" +
      '  a.display_level AS priority_level, a.score,\n' +
      '  CASE\n' +
      "    WHEN ua.status IN ('RESOLVED', 'DISMISSED') THEN ua.status\n" +
      "    WHEN ua.status = '' THEN 'OPEN'\n" +
      "    WHEN a.user_status IN ('RESOLVED', 'DISMISSED') THEN a.user_status\n" +
      "    WHEN r.last_sent > a.internal_ts THEN 'AUTO_REPLIED'\n" +
      "    WHEN NOT a.in_inbox THEN 'AUTO_ARCHIVED'\n" +
      '    WHEN ' + due + ' < ' + daysAgo_(o.overdueAutoResolveDays) + " THEN 'AUTO_EXPIRED'\n" +
      '    WHEN ' + due + ' IS NULL AND a.received_date < ' + daysAgo_(o.openDaysWithoutDeadline) + " THEN 'AUTO_STALE'\n" +
      "    ELSE 'OPEN' END AS status\n" +
      'FROM acts a\n' +
      'LEFT JOIN replies r ON r.thread_id = a.thread_id\n' +
      'LEFT JOIN ' + viewRef_('user_state') + " ua ON ua.target_type = 'ACTION' AND ua.target_id = " + actId;

    // Oportunidades: deduplicadas só quando empresa e cargo foram extraídos.
    defs.opportunities = 'WITH o AS (\n' +
      "  SELECT IF(opportunity_key IS NULL OR opportunity_key = '', CONCAT('msg:', message_id), opportunity_key) AS opp_key,\n" +
      '    message_id, received_date, internal_ts, from_email, opportunity_json, score\n' +
      '  FROM ' + viewRef_('inbox') + "\n  WHERE opportunity_json IS NOT NULL AND opportunity_json NOT IN ('', 'null') AND direction = 'INBOUND'\n" +
      ')\n' +
      'SELECT o.opp_key,\n' +
      '  ARRAY_AGG(o.opportunity_json ORDER BY o.internal_ts DESC LIMIT 1)[OFFSET(0)] AS latest_json,\n' +
      '  MIN(o.received_date) AS first_seen, MAX(o.received_date) AS last_seen, COUNT(*) AS mentions,\n' +
      '  ARRAY_AGG(o.message_id ORDER BY o.internal_ts DESC LIMIT 20) AS message_ids,\n' +
      '  ARRAY_AGG(DISTINCT o.from_email IGNORE NULLS LIMIT 10) AS sources,\n' +
      '  MAX(o.score) AS best_score,\n' +
      '  ANY_VALUE(u.status) AS user_status\n' +
      'FROM o\n' +
      'LEFT JOIN ' + viewRef_('user_state') + " u ON u.target_type = 'OPPORTUNITY' AND u.target_id = o.opp_key\n" +
      'GROUP BY o.opp_key';

    defs.runs = 'SELECT * FROM ' + T('runs') + ' WHERE TRUE\n' +
      'QUALIFY ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY version_ts DESC) = 1';

    defs.briefings = 'SELECT * FROM ' + T('briefings') + ' WHERE TRUE\n' +
      'QUALIFY ROW_NUMBER() OVER (PARTITION BY briefing_id ORDER BY version_ts DESC) = 1';

    return defs;
  }

  /** Ordem de criação (dependências primeiro). */
  var VIEW_ORDER = ['messages', 'state', 'analysis', 'scores', 'user_state', 'inbox', 'actions', 'opportunities', 'runs', 'briefings'];

  function viewOptions() {
    var cfg = Config.get();
    return {
      retentionDays: cfg.storage.excerptRetentionDays,
      criticalCap: cfg.scoring.criticalDailyCap,
      criticalRecencyDays: cfg.scoring.criticalRecencyDays,
      openDaysWithoutDeadline: cfg.tasks.openDaysWithoutDeadline,
      overdueAutoResolveDays: cfg.tasks.overdueAutoResolveDays,
    };
  }

  function renewOptions() {
    var s = Config.get().storage;
    return { retentionDays: s.excerptRetentionDays, horizonMonths: s.horizonMonths, runsDays: s.runsRetentionDays, briefingsDays: s.briefingsRetentionDays };
  }

  function viewSql(short, gen, opts) {
    return 'CREATE OR REPLACE VIEW ' + viewRef_(short) + '\nAS\n' + viewDefinitions(gen, opts || viewOptions())[short];
  }

  function dropViewSql(short) {
    return 'DROP VIEW IF EXISTS ' + viewRef_(short);
  }

  function allViewStatements(gen, opts) {
    var o = opts || viewOptions();
    return VIEW_ORDER.map(function (v) {
      return { name: 'v_' + v, short: v, sql: viewSql(v, gen, o) };
    });
  }

  return {
    TABLES: TABLES,
    VIEW_ORDER: VIEW_ORDER,
    generation: generation,
    setGeneration: setGeneration,
    pendingDrop: pendingDrop,
    setPendingDrop: setPendingDrop,
    physical: physical,
    names: names,
    table: table,
    columnTypes: columnTypes,
    coerceRow: coerceRow,
    createTableSql: createTableSql,
    renewSql: renewSql,
    dropTableSql: dropTableSql,
    viewDefinitions: viewDefinitions,
    viewOptions: viewOptions,
    renewOptions: renewOptions,
    viewSql: viewSql,
    dropViewSql: dropViewSql,
    allViewStatements: allViewStatements,
  };
})();
