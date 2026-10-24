/**
 * Persistência e consultas de domínio sobre o BigQuery.
 *
 * - Catálogo nomeado de SQL (QUERIES), sempre parametrizado (@nome). Tokens
 *   {{v:nome}} e {{t:nome}} são resolvidos para views e tabelas físicas da
 *   geração vigente. Um teste exporta o catálogo e o valida no dialeto BigQuery.
 * - Escrita append-only por load jobs, com `messages` como MARCADOR DE COMMIT:
 *   análises, scores e estado são gravados (e confirmados) antes; só então a
 *   mensagem entra. O dedup lê `messages`, então falhas parciais são refeitas.
 * - Feedback do Web App vai para uma fila de saída nas Properties (gravação
 *   atômica, sem lock); o pipeline descarrega sob lock.
 */
var Repository = (function () {
  var FB_PREFIX = 'FB_';
  var FB_MIRROR_PREFIX = 'FBM_';
  var DATA_VERSION_KEY = 'DATA_VERSION';
  var TZ = "'America/Sao_Paulo'";

  // -------------------------------------------------------------- catálogo ----
  var QUERIES = {
    existing_ids:
      'SELECT DISTINCT message_id FROM {{t:messages}} WHERE message_id IN UNNEST(@ids)',

    existing_ai:
      'SELECT message_id, analysis_id, provider, model, primary_category, secondary_categories, topics, summary, key_facts_json, whats_new,\n' +
      '  relevance, importance, urgency, action_required, actions_json, deadline_date, deadline_certainty, deadline_evidence,\n' +
      '  entities_json, opportunity_json, evidence_json, confidence, reason, injection_suspected, evidence_total, evidence_verified\n' +
      "FROM {{t:analyses}} WHERE method = 'AI' AND message_id IN UNNEST(@ids)\n" +
      'QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1',

    pending_ai:
      'SELECT i.message_id, i.thread_id, i.internal_ts, i.received_date, i.direction, i.from_email, i.from_name, i.from_domain,\n' +
      '  i.subject, i.user_in_to, i.is_bulk, i.is_automated, i.has_list_unsubscribe, i.list_id, i.gmail_category, i.auth_fail, i.auth_pass,\n' +
      '  i.content_hash, i.label_ids, i.body_excerpt, i.analysis_id, i.model_category, i.secondary_categories, i.topics, i.summary,\n' +
      '  i.key_facts_json, i.action_required, i.actions_json, i.deadline_date, i.deadline_certainty, i.deadline_evidence, i.entities_json,\n' +
      '  i.opportunity_json, i.evidence_json, i.evidence_total, i.evidence_verified, i.confidence, i.reason, i.is_newsletter, i.is_marketing,\n' +
      '  i.is_probable_spam, i.sensitive, i.ai_eligible, i.ai_status, i.ai_attempts, i.ai_error, i.injection_suspected, i.features_json,\n' +
      '  i.score, i.correct_category, i.user_relevance\n' +
      'FROM {{v:inbox}} i\n' +
      "WHERE i.method = 'RULES' AND i.direction = 'INBOUND'\n" +
      "  AND (COALESCE(i.ai_status, 'PENDING') IN ('PENDING', 'FAILED') OR (i.ai_status = 'BLOCKED' AND COALESCE(i.ai_error, '') != @policy))\n" +
      '  AND COALESCE(i.ai_attempts, 0) < @max_attempts\n' +
      '  AND COALESCE(i.ai_eligible, TRUE)\n' +
      '  AND NOT COALESCE(i.auth_fail, FALSE)\n' +
      '  AND i.received_date >= @since\n' +
      '  AND i.body_excerpt IS NOT NULL\n' +
      "  AND (@policy = 'FULL'\n" +
      "    OR (@policy = 'REDACTED' AND NOT COALESCE(i.sensitive, FALSE))\n" +
      "    OR (@policy = 'BROADCAST' AND NOT COALESCE(i.sensitive, FALSE) AND COALESCE(i.is_automated, FALSE)\n" +
      "        AND (COALESCE(i.has_list_unsubscribe, FALSE) OR i.list_id IS NOT NULL) AND COALESCE(i.gmail_category, '') != 'PERSONAL'))\n" +
      'ORDER BY i.score DESC, i.internal_ts DESC\n' +
      'LIMIT @limit',

    thread_context:
      'SELECT thread_id, message_id, summary, method, from_domain, is_automated, is_bulk, has_list_unsubscribe, list_id, gmail_category,\n' +
      '  sensitive, ai_eligible, is_probable_spam, auth_fail, direction, primary_category\n' +
      'FROM {{v:inbox}}\n' +
      "WHERE thread_id IN UNNEST(@thread_ids) AND message_id NOT IN UNNEST(@exclude_ids) AND summary IS NOT NULL AND direction = 'INBOUND'\n" +
      'QUALIFY ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY internal_ts DESC) = 1',

    known_contacts:
      'SELECT DISTINCT LOWER(e) AS email\n' +
      'FROM {{v:messages}} m, UNNEST(ARRAY_CONCAT(m.to_emails, m.cc_emails)) AS e\n' +
      "WHERE m.direction = 'OUTBOUND' AND m.received_date >= DATE_SUB(CURRENT_DATE(" + TZ + '), INTERVAL 365 DAY)\n' +
      'LIMIT 3000',

    sender_affinity:
      'SELECT LOWER(m.from_email) AS email,\n' +
      "  SUM(CASE WHEN u.relevance IN ('RELEVANT', 'SHOULD_BE_HIGHER') OR u.status = 'SAVED' THEN 1 WHEN u.relevance = 'IRRELEVANT' THEN -1 ELSE 0 END) AS net,\n" +
      '  COUNT(*) AS n\n' +
      "FROM {{v:user_state}} u JOIN {{v:messages}} m ON u.target_type = 'MESSAGE' AND u.target_id = m.message_id\n" +
      'GROUP BY email\nLIMIT 2000',

    priority_suggestions:
      'SELECT LOWER(e) AS email, COUNT(*) AS n\n' +
      'FROM {{v:messages}} m, UNNEST(m.to_emails) AS e\n' +
      "WHERE m.direction = 'OUTBOUND' AND m.received_date >= DATE_SUB(CURRENT_DATE(" + TZ + '), INTERVAL 90 DAY)\n' +
      'GROUP BY email ORDER BY n DESC LIMIT 15',

    rescore_candidates:
      'SELECT message_id, analysis_id, received_date, features_json, level, score, user_status, user_relevance, correct_category,\n' +
      '  deadline_date, method\n' +
      'FROM {{v:inbox}}\n' +
      "WHERE direction = 'INBOUND' AND features_json IS NOT NULL\n" +
      '  AND (deadline_date BETWEEN DATE_SUB(@today, INTERVAL 4 DAY) AND DATE_ADD(@today, INTERVAL 14 DAY)\n' +
      '       OR message_id IN UNNEST(@extra_ids))\n' +
      'LIMIT 1000',

    duplicate_hashes:
      'SELECT DISTINCT content_hash FROM {{t:messages}}\n' +
      'WHERE content_hash IN UNNEST(@hashes) AND message_id NOT IN UNNEST(@exclude_ids)\n' +
      '  AND received_date >= DATE_SUB(CURRENT_DATE(' + TZ + '), INTERVAL 30 DAY)',

    ids_in_window:
      'SELECT message_id FROM {{v:inbox}} WHERE received_date BETWEEN @start AND @end LIMIT 5000',

    radar:
      'WITH base AS (\n' +
      '  SELECT message_id, thread_id, rfc822_message_id, subject, from_name, from_email, from_domain, internal_ts, received_date,\n' +
      '    primary_category, secondary_categories, summary, summary_kind, method, display_level, critical_overflow, score, info_score,\n' +
      '    relevance_axis, urgency_axis, action_axis, components_json, action_required, deadline_date, deadline_certainty,\n' +
      '    is_unread, is_starred, confidence, user_status, user_relevance, injection_suspected, auth_fail, is_probable_spam, topics,\n' +
      '    is_newsletter, is_marketing, is_bulk, opportunity_json, in_inbox\n' +
      '  FROM {{v:inbox}}\n' +
      "  WHERE direction = 'INBOUND' AND received_date BETWEEN @prev_start AND @end\n" +
      '), cur AS (\n' +
      '  SELECT message_id, thread_id, rfc822_message_id, subject, from_name, from_email, from_domain, internal_ts, received_date,\n' +
      '    primary_category, secondary_categories, summary, summary_kind, method, display_level, critical_overflow, score, info_score,\n' +
      '    relevance_axis, urgency_axis, action_axis, components_json, action_required, deadline_date, deadline_certainty,\n' +
      '    is_unread, is_starred, confidence, user_status, user_relevance, injection_suspected, auth_fail, is_probable_spam, topics,\n' +
      '    is_newsletter, is_marketing, is_bulk, opportunity_json, in_inbox\n' +
      '  FROM base WHERE received_date >= @start\n' +
      '), prev AS (\n' +
      '  SELECT primary_category, display_level, action_required FROM base WHERE received_date < @start\n' +
      ')\n' +
      'SELECT\n' +
      '  (SELECT AS STRUCT COUNT(*) AS received,\n' +
      "     COUNTIF(display_level IN ('CRITICAL', 'HIGH')) AS attention,\n" +
      '     COUNTIF(COALESCE(action_required, FALSE)) AS actions,\n' +
      "     COUNTIF(opportunity_json IS NOT NULL AND opportunity_json NOT IN ('', 'null')) AS opportunities,\n" +
      '     COUNTIF(COALESCE(is_newsletter, FALSE)) AS newsletters,\n' +
      "     COUNTIF(primary_category IN ('marketing', 'spam') OR COALESCE(is_marketing, FALSE) OR COALESCE(is_probable_spam, FALSE)) AS noise,\n" +
      "     COUNTIF(display_level = 'LOW' AND is_unread) AS triaged_unread,\n" +
      "     COUNTIF(method = 'RULES') AS rules_only\n" +
      '   FROM cur) AS kpis,\n' +
      "  (SELECT AS STRUCT COUNT(*) AS received, COUNTIF(display_level IN ('CRITICAL', 'HIGH')) AS attention, COUNTIF(COALESCE(action_required, FALSE)) AS actions FROM prev) AS kpis_prev,\n" +
      '  ARRAY(SELECT AS STRUCT message_id, thread_id, rfc822_message_id, subject, from_name, from_email, from_domain, internal_ts,\n' +
      '      primary_category, secondary_categories, summary, summary_kind, method, display_level, critical_overflow, score,\n' +
      '      relevance_axis, urgency_axis, action_axis, components_json, action_required, deadline_date, deadline_certainty,\n' +
      '      is_unread, is_starred, confidence, user_status, injection_suspected, auth_fail\n' +
      "    FROM cur WHERE display_level IN ('CRITICAL', 'HIGH') AND user_status NOT IN ('RESOLVED', 'DISMISSED') AND user_relevance != 'IRRELEVANT'\n" +
      '      AND (COALESCE(action_required, FALSE) OR COALESCE(urgency_axis, 0) >= @min_urgency) AND in_inbox\n' +
      "    ORDER BY IF(display_level = 'CRITICAL', 0, 1), score DESC LIMIT 12) AS attention,\n" +
      '  ARRAY(SELECT AS STRUCT message_id, thread_id, rfc822_message_id, subject, from_name, from_email, from_domain, internal_ts,\n' +
      '      primary_category, secondary_categories, summary, summary_kind, method, display_level, score, info_score, relevance_axis,\n' +
      '      is_unread, confidence, injection_suspected, auth_fail\n' +
      "    FROM cur WHERE (COALESCE(is_newsletter, FALSE) OR primary_category IN ('noticias', 'economia', 'tecnologia', 'negocios'))\n" +
      "      AND NOT COALESCE(is_marketing, FALSE) AND user_relevance != 'IRRELEVANT'\n" +
      '    ORDER BY info_score DESC LIMIT 8) AS news,\n' +
      '  ARRAY(SELECT AS STRUCT topic, COUNT(*) AS n FROM cur, UNNEST(topics) AS topic GROUP BY topic ORDER BY n DESC LIMIT 8) AS topics,\n' +
      '  ARRAY(SELECT AS STRUCT primary_category AS category, COUNT(*) AS n FROM cur GROUP BY category ORDER BY n DESC) AS by_category,\n' +
      '  ARRAY(SELECT AS STRUCT primary_category AS category, COUNT(*) AS n FROM prev GROUP BY category) AS by_category_prev,\n' +
      '  ARRAY(SELECT AS STRUCT action_id, message_id, description, owner, due_date, due_certainty, status, subject, from_name, priority_level\n' +
      "    FROM {{v:actions}} WHERE status = 'OPEN' ORDER BY due_date IS NULL, due_date, score DESC LIMIT 10) AS tasks,\n" +
      '  ARRAY(SELECT AS STRUCT opp_key, latest_json, first_seen, last_seen, mentions, message_ids, best_score, user_status\n' +
      "    FROM {{v:opportunities}} WHERE last_seen >= DATE_SUB(@end, INTERVAL 30 DAY) AND COALESCE(user_status, '') != 'DISMISSED'\n" +
      '    ORDER BY best_score DESC LIMIT 6) AS opportunities,\n' +
      "  (SELECT COUNT(*) FROM {{v:inbox}} WHERE direction = 'INBOUND' AND internal_ts > @since_ts AND display_level IN ('CRITICAL', 'HIGH')) AS since_last_visit,\n" +
      '  (SELECT AS STRUCT content_json, method, provider, version_ts FROM {{v:briefings}} WHERE period = @period AND period_end = @end ORDER BY version_ts DESC LIMIT 1) AS briefing',

    inbox_list:
      'WITH r AS (\n' +
      '  SELECT message_id, thread_id, rfc822_message_id, subject, from_name, from_email, from_domain, internal_ts, received_date,\n' +
      '    primary_category, secondary_categories, summary, summary_kind, method, display_level, critical_overflow, score,\n' +
      '    relevance_axis, urgency_axis, action_axis, action_required, deadline_date, deadline_certainty, is_unread, is_starred,\n' +
      '    confidence, user_status, user_relevance, injection_suspected, auth_fail, is_bulk,\n' +
      "    (SELECT COALESCE(SUM(IF(STRPOS(IFNULL(search_meta, ''), t) > 0, 3, 0) + IF(STRPOS(IFNULL(analysis_search, ''), t) > 0, 2, 0)\n" +
      "       + IF(STRPOS(IFNULL(search_body, ''), t) > 0, 1, 0)), 0) FROM UNNEST(@terms) AS t) AS match_score\n" +
      '  FROM {{v:inbox}}\n' +
      "  WHERE direction = 'INBOUND' AND received_date >= @since\n" +
      '    AND (ARRAY_LENGTH(@categories) = 0 OR primary_category IN UNNEST(@categories)\n' +
      '         OR EXISTS (SELECT 1 FROM UNNEST(secondary_categories) AS c WHERE c IN UNNEST(@categories)))\n' +
      '    AND (ARRAY_LENGTH(@levels) = 0 OR display_level IN UNNEST(@levels))\n' +
      "    AND (@action = '' OR (@action = 'yes' AND COALESCE(action_required, FALSE)) OR (@action = 'no' AND NOT COALESCE(action_required, FALSE)))\n" +
      "    AND (@deadline = '' OR (@deadline = 'yes' AND deadline_date IS NOT NULL) OR (@deadline = 'no' AND deadline_date IS NULL))\n" +
      "    AND (@unread = '' OR (@unread = 'yes' AND is_unread) OR (@unread = 'no' AND NOT is_unread))\n" +
      "    AND (@sender = '' OR STRPOS(LOWER(IFNULL(from_email, '')), @sender) > 0\n" +
      "         OR STRPOS(REGEXP_REPLACE(NORMALIZE(LOWER(IFNULL(from_name, '')), NFD), r'\\pM', ''), @sender) > 0)\n" +
      "    AND (@status = '' OR (@status = 'OPEN' AND user_status NOT IN ('RESOLVED', 'DISMISSED')) OR user_status = @status)\n" +
      '    AND (ARRAY_LENGTH(@terms) = 0 OR (SELECT LOGICAL_AND(STRPOS(CONCAT(IFNULL(search_meta, \'\'), \' \', IFNULL(search_body, \'\'), \' \', IFNULL(analysis_search, \'\')), t) > 0) FROM UNNEST(@terms) AS t))\n' +
      ')\n' +
      'SELECT message_id, thread_id, rfc822_message_id, subject, from_name, from_email, from_domain, internal_ts, received_date,\n' +
      '  primary_category, secondary_categories, summary, summary_kind, method, display_level, critical_overflow, score,\n' +
      '  relevance_axis, urgency_axis, action_axis, action_required, deadline_date, deadline_certainty, is_unread, is_starred,\n' +
      '  confidence, user_status, user_relevance, injection_suspected, auth_fail, is_bulk, match_score\n' +
      'FROM r\n' +
      'ORDER BY\n' +
      "  CASE WHEN @sort = 'match' THEN match_score END DESC,\n" +
      "  CASE WHEN @sort = 'priority' THEN score END DESC,\n" +
      "  CASE WHEN @sort = 'relevance' THEN relevance_axis END DESC,\n" +
      "  CASE WHEN @sort = 'urgency' THEN urgency_axis END DESC,\n" +
      "  CASE WHEN @sort = 'deadline' THEN IFNULL(deadline_date, DATE '9999-12-31') END ASC,\n" +
      '  internal_ts DESC\n' +
      'LIMIT @limit',

    message_detail:
      'SELECT i.message_id, i.thread_id, i.rfc822_message_id, i.internal_ts, i.received_date, i.direction, i.from_email, i.from_name,\n' +
      '  i.from_domain, i.to_emails, i.cc_emails, i.user_in_to, i.subject, i.snippet, i.body_excerpt, i.links_json, i.attachments_json,\n' +
      '  i.attachment_count, i.unsubscribe_url, i.has_list_unsubscribe, i.auth_pass, i.auth_fail, i.is_bulk, i.is_automated, i.retention_expired,\n' +
      '  i.is_unread, i.is_starred, i.in_inbox, i.gmail_state, i.method, i.provider, i.model, i.primary_category, i.model_category,\n' +
      '  i.secondary_categories, i.topics, i.summary, i.summary_kind, i.key_facts_json, i.whats_new, i.action_required, i.actions_json,\n' +
      '  i.deadline_date, i.deadline_certainty, i.deadline_evidence, i.entities_json, i.opportunity_json, i.evidence_json, i.evidence_total,\n' +
      '  i.evidence_verified, i.confidence, i.reason, i.is_newsletter, i.is_marketing, i.is_probable_spam, i.sensitive, i.injection_suspected,\n' +
      '  i.ai_status, i.display_level, i.critical_overflow, i.score, i.relevance_axis, i.urgency_axis, i.action_axis, i.components_json,\n' +
          '  i.user_status, i.user_relevance, i.correct_category, i.parse_status, i.opportunity_key,\n' +
      '  ARRAY(SELECT AS STRUCT h.method, h.provider, h.model, h.version_ts FROM {{t:analyses}} h WHERE h.message_id = @id ORDER BY h.version_ts DESC LIMIT 10) AS history\n' +
      'FROM {{v:inbox}} i WHERE i.message_id = @id',

    actions_for_message:
      'SELECT action_id, status FROM {{v:actions}} WHERE message_id = @id',

    news:
      'SELECT message_id, thread_id, rfc822_message_id, subject, from_name, from_email, from_domain, internal_ts, received_date,\n' +
      '  primary_category, secondary_categories, summary, summary_kind, method, display_level, critical_overflow, score, info_score,\n' +
      '  relevance_axis, urgency_axis, action_axis, components_json, action_required, deadline_date, deadline_certainty, is_unread,\n' +
      '  is_starred, confidence, user_status, user_relevance, injection_suspected, auth_fail, topics\n' +
      'FROM {{v:inbox}}\n' +
      "WHERE direction = 'INBOUND' AND received_date >= @since\n" +
      "  AND (COALESCE(is_newsletter, FALSE) OR primary_category IN ('noticias', 'economia', 'tecnologia', 'negocios', 'newsletters'))\n" +
      "  AND NOT COALESCE(is_marketing, FALSE) AND NOT COALESCE(is_probable_spam, FALSE) AND user_relevance != 'IRRELEVANT'\n" +
      'ORDER BY info_score DESC, internal_ts DESC\n' +
      'LIMIT 60',

    tasks:
      'SELECT action_id, message_id, thread_id, description, owner, due_date, due_certainty, status, subject, from_name, from_email,\n' +
      '  priority_level, received_date, method\n' +
      'FROM {{v:actions}}\n' +
      "WHERE (@status = 'ALL' OR (@status = 'OPEN' AND status = 'OPEN') OR (@status = 'DONE' AND status != 'OPEN'))\n" +
      '  AND received_date >= DATE_SUB(CURRENT_DATE(' + TZ + '), INTERVAL 90 DAY)\n' +
      "ORDER BY status != 'OPEN', due_date IS NULL, due_date, score DESC\n" +
      'LIMIT 300',

    opportunities:
      'SELECT opp_key, latest_json, first_seen, last_seen, mentions, message_ids, sources, best_score, user_status\n' +
      'FROM {{v:opportunities}}\n' +
      "WHERE (@status = 'ALL' OR (@status = 'OPEN' AND COALESCE(user_status, '') != 'DISMISSED') OR COALESCE(user_status, '') = @status)\n" +
      'ORDER BY last_seen DESC, best_score DESC\n' +
      'LIMIT 200',

    senders:
      'WITH win AS (\n' +
      '  SELECT LOWER(from_email) AS email, from_name, from_domain, received_date, primary_category, score, display_level, is_unread,\n' +
      '    has_list_unsubscribe, unsubscribe_url, auth_pass, is_probable_spam, is_marketing, is_newsletter\n' +
      "  FROM {{v:inbox}} WHERE direction = 'INBOUND' AND received_date >= @prev_start\n" +
      ')\n' +
      'SELECT email, ANY_VALUE(from_name) AS name, ANY_VALUE(from_domain) AS domain,\n' +
      '  COUNTIF(received_date >= @start) AS n, COUNTIF(received_date < @start) AS n_prev,\n' +
      '  AVG(IF(received_date >= @start, score, NULL)) AS avg_score,\n' +
      "  SAFE_DIVIDE(COUNTIF(received_date >= @start AND display_level IN ('CRITICAL', 'HIGH')), COUNTIF(received_date >= @start)) AS high_share,\n" +
      '  SAFE_DIVIDE(COUNTIF(received_date >= @start AND is_unread), COUNTIF(received_date >= @start)) AS unread_share,\n' +
      "  SAFE_DIVIDE(COUNTIF(received_date >= @start AND (COALESCE(is_marketing, FALSE) OR COALESCE(is_newsletter, FALSE) OR primary_category IN ('marketing', 'newsletters'))), COUNTIF(received_date >= @start)) AS mass_share,\n" +
      '  LOGICAL_OR(COALESCE(has_list_unsubscribe, FALSE)) AS has_unsub, LOGICAL_AND(COALESCE(auth_pass, FALSE)) AS all_auth_pass,\n' +
      '  LOGICAL_OR(COALESCE(is_probable_spam, FALSE)) AS any_spam, MAX(unsubscribe_url) AS unsubscribe_url,\n' +
      '  ARRAY_AGG(IF(received_date >= @start, primary_category, NULL) IGNORE NULLS LIMIT 200) AS cats\n' +
      'FROM win\n' +
      'GROUP BY email\n' +
      'HAVING n > 0\n' +
      'ORDER BY n DESC\n' +
      'LIMIT 100',

    system_status:
      'SELECT\n' +
      '  ARRAY(SELECT AS STRUCT run_id, kind, trigger_source, started_at, finished_at, status, duration_ms, counts_json, errors_json,\n' +
      '      ai_cost_usd, ai_requests, gmail_units\n' +
      '    FROM {{v:runs}} ORDER BY started_at DESC LIMIT 25) AS runs,\n' +
      "  (SELECT AS STRUCT MAX(IF(status = 'SUCCESS' AND kind = 'PIPELINE', finished_at, NULL)) AS last_success,\n" +
      "     COUNTIF(status IN ('FAILED', 'ABORTED') AND started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)) AS fails_24h,\n" +
      '     COUNTIF(started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)) AS runs_24h,\n' +
      '     AVG(IF(started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR), duration_ms, NULL)) AS avg_ms,\n' +
      '     SUM(IF(started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY), ai_cost_usd, 0)) AS ai_cost_30d,\n' +
      '     SUM(IF(started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY), ai_requests, 0)) AS ai_requests_30d\n' +
      '   FROM {{v:runs}}) AS health,\n' +
      "  (SELECT AS STRUCT COUNT(*) AS total, COUNTIF(method = 'AI') AS ai_done,\n" +
      "     COUNTIF(method = 'RULES' AND COALESCE(ai_status, '') IN ('PENDING', 'FAILED')) AS ai_pending,\n" +
      "     COUNTIF(ai_status = 'FAILED') AS ai_failed, COUNTIF(parse_status = 'QUARANTINED') AS quarantined,\n" +
      "     COUNTIF(display_level = 'CRITICAL' AND received_date = CURRENT_DATE(" + TZ + ')) AS critical_today,\n' +
      "     SAFE_DIVIDE(COUNTIF(display_level IN ('CRITICAL', 'HIGH') AND received_date >= DATE_SUB(CURRENT_DATE(" + TZ + '), INTERVAL 7 DAY)),\n' +
      '       COUNTIF(received_date >= DATE_SUB(CURRENT_DATE(' + TZ + '), INTERVAL 7 DAY))) AS high_share_7d,\n' +
      '     MIN(received_date) AS oldest, MAX(received_date) AS newest\n' +
      "   FROM {{v:inbox}} WHERE direction = 'INBOUND') AS pending,\n" +
      "  ARRAY(SELECT AS STRUCT primary_category AS category, COUNT(*) AS n, COUNTIF(user_relevance = 'IRRELEVANT') AS irrelevant,\n" +
      "      COUNTIF(correct_category IS NOT NULL) AS corrected, COUNTIF(user_relevance = 'SHOULD_BE_HIGHER') AS should_be_higher\n" +
      "    FROM {{v:inbox}} WHERE direction = 'INBOUND' AND received_date >= DATE_SUB(CURRENT_DATE(" + TZ + '), INTERVAL 90 DAY)\n' +
      '    GROUP BY category ORDER BY n DESC) AS quality,\n' +
      '  (SELECT AS STRUCT COUNT(*) AS n, COUNTIF(r.primary_category = a.primary_category) AS agree\n' +
      "   FROM (SELECT message_id, primary_category FROM {{t:analyses}} WHERE method = 'RULES'\n" +
      '         QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1) r\n' +
      "   JOIN (SELECT message_id, primary_category FROM {{t:analyses}} WHERE method = 'AI'\n" +
      '         QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1) a\n' +
      '   ON a.message_id = r.message_id) AS agreement',

    blind_sample:
      'SELECT message_id, subject, from_name, summary, summary_kind, display_level, primary_category, internal_ts\n' +
      'FROM {{v:inbox}}\n' +
      "WHERE direction = 'INBOUND' AND display_level IN ('LOW', 'MEDIUM') AND user_relevance = ''\n" +
      '  AND received_date >= DATE_SUB(CURRENT_DATE(' + TZ + '), INTERVAL 7 DAY)\n' +
      'ORDER BY FARM_FINGERPRINT(CONCAT(message_id, @seed))\n' +
      'LIMIT 10',

    briefing_input:
      'SELECT message_id, thread_id, subject, from_domain, from_name, primary_category, summary, summary_kind, display_level, deadline_date,\n' +
      '  action_required, method, is_automated, is_bulk, has_list_unsubscribe, list_id, gmail_category, sensitive, ai_eligible,\n' +
      '  is_probable_spam, auth_fail, direction, info_score, score, opportunity_json\n' +
      'FROM {{v:inbox}}\n' +
      "WHERE direction = 'INBOUND' AND received_date BETWEEN @start AND @end AND user_status NOT IN ('RESOLVED', 'DISMISSED')\n" +
      'ORDER BY score DESC\n' +
      'LIMIT 40',

    dry_run_rows:
      'SELECT i.message_id, i.subject, i.from_name, i.from_domain, i.received_date, i.direction, i.is_automated, i.is_bulk,\n' +
      '  i.has_list_unsubscribe, i.list_id, i.gmail_category, i.auth_fail, i.user_in_to, i.primary_category, i.sensitive, i.ai_eligible,\n' +
      '  i.is_probable_spam, i.injection_suspected, i.body_excerpt\n' +
      'FROM {{v:inbox}} i\n' +
      "WHERE i.direction = 'INBOUND' AND i.received_date >= DATE_SUB(CURRENT_DATE(" + TZ + '), INTERVAL 30 DAY)\n' +
      'ORDER BY i.internal_ts DESC\n' +
      'LIMIT 500',
  };

  /** Resolve tokens {{v:nome}} / {{t:nome}} para referências da geração vigente. */
  function render(sql, gen) {
    return String(sql).replace(/\{\{([vt]):([a-z_]+)\}\}/g, function (_, kind, name) {
      return kind === 'v' ? BigQueryClient.tableRef('v_' + name) : BigQueryClient.tableRef(Schema.physical(name, gen));
    });
  }

  function run_(name, params, opts) {
    if (!QUERIES[name]) throw new Error('Consulta desconhecida: ' + name);
    return BigQueryClient.query(render(QUERIES[name]), params || {}, Object.assign({ name: name }, opts || {}));
  }

  function date_(ymd) {
    return { type: 'DATE', value: ymd };
  }

  // ----------------------------------------------------- versão dos dados ----
  function dataVersion() {
    return Number(PropertiesService.getScriptProperties().getProperty(DATA_VERSION_KEY) || 0);
  }

  function bumpDataVersion() {
    PropertiesService.getScriptProperties().setProperty(DATA_VERSION_KEY, String(dataVersion() + 1));
  }

  /** Consulta com cache versionado: qualquer escrita confirmada invalida tudo sem apagar chaves. */
  function cached(name, params, ttlSec, fn) {
    var key = 'q' + dataVersion() + ':' + name + ':' + Util.shortHash(JSON.stringify(params || {}), 12);
    var hit = Util.cacheGetJson(key);
    if (hit) return { rows: hit, cached: true };
    var rows = fn();
    Util.cachePutJson(key, rows, ttlSec || 600);
    return { rows: rows, cached: false };
  }

  // --------------------------------------------------- linhas (escrita) ----
  function redact_(s) {
    return s ? Extractors.redactPii(String(s)).text : s;
  }

  /**
   * Linha de `messages`. Retenção já na ingestão: mensagens mais antigas que a
   * janela de retenção (ou buscadas só com metadados) não gravam trechos.
   * Trechos gravados são redigidos (PII).
   */
  function messageRow(p, meta) {
    var cfg = Config.get();
    var age = Util.daysBetween(p.received_date, Util.todayYmd());
    var outbound = p.direction === 'OUTBOUND';
    var keepBody = !meta.metadataOnly && !meta.quarantined && !outbound && meta.allowExcerpts !== false &&
      age <= cfg.storage.excerptRetentionDays && cfg.storage.excerptChars > 0;
    var keepSnippet = !outbound && !meta.quarantined && age <= cfg.storage.excerptRetentionDays;
    // Redige o texto completo (em memória) e só então trunca: nada fica cortado ao meio.
    var excerpt = keepBody ? Util.truncate(redact_(String(p.body_text || p.body_excerpt || '').slice(0, cfg.storage.excerptChars * 2)), cfg.storage.excerptChars) : null;
    var snippet = keepSnippet ? redact_(p.snippet) : null;
    var subject = redact_(p.subject || '');
    return {
      message_id: p.message_id, thread_id: p.thread_id, rfc822_message_id: p.rfc822_message_id, history_id: p.history_id,
      internal_ts: p.internal_ts, received_date: p.received_date, direction: p.direction, fetch_format: meta.metadataOnly ? 'metadata' : 'full',
      from_email: p.from_email, from_name: p.from_name, from_domain: p.from_domain, reply_to_email: p.reply_to_email,
      to_emails: p.to_emails || [], cc_emails: p.cc_emails || [], recipient_count: p.recipient_count, user_in_to: p.user_in_to, user_in_cc: p.user_in_cc,
      subject: subject, snippet: snippet, body_excerpt: excerpt, body_chars: p.body_chars, body_truncated: p.body_truncated, has_html: p.has_html,
      is_forwarded: p.is_forwarded, is_reply: p.is_reply, is_bulk: p.is_bulk, is_automated: p.is_automated,
      has_list_unsubscribe: p.has_list_unsubscribe, list_id: p.list_id || null, unsubscribe_url: p.unsubscribe_url || null,
      auth_pass: p.auth_pass, auth_fail: p.auth_fail,
      links_json: keepBody ? JSON.stringify(p.links || []) : null,
      attachments_json: JSON.stringify(p.attachments || []), attachment_count: p.attachment_count || 0,
      content_hash: p.content_hash,
      search_meta: Util.normalizeText([subject, p.from_name, p.from_email].join(' ')).slice(0, 1000),
      search_body: keepBody || keepSnippet ? Util.normalizeText([snippet || '', excerpt || ''].join(' ')).slice(0, 8000) : null,
      size_estimate: p.size_estimate, parse_status: meta.quarantined ? 'QUARANTINED' : 'OK', parser_version: p.parser_version || Config.PARSER_VERSION,
      run_id: meta.runId, version_ts: meta.versionTs,
    };
  }

  /** Estado do Gmail a partir dos labels (snapshot completo). */
  function stateFromLabels(labelIds, gone) {
    var labels = labelIds || [];
    function has(l) {
      return labels.indexOf(l) >= 0;
    }
    var cat = '';
    ['PERSONAL', 'SOCIAL', 'PROMOTIONS', 'UPDATES', 'FORUMS'].forEach(function (c) {
      if (has('CATEGORY_' + c)) cat = c;
    });
    return {
      label_ids: labels,
      gmail_category: cat,
      is_unread: has('UNREAD'),
      is_starred: has('STARRED'),
      is_important: has('IMPORTANT'),
      in_inbox: has('INBOX'),
      gmail_state: gone ? gone : has('SPAM') ? 'SPAM' : has('TRASH') ? 'TRASHED' : 'ACTIVE',
    };
  }

  function stateRow(messageId, threadId, labelIds, meta) {
    var s = stateFromLabels(labelIds, meta.gone);
    return Object.assign({ message_id: messageId, thread_id: threadId, source: meta.source || 'INGEST', run_id: meta.runId, version_ts: meta.versionTs }, s);
  }

  function actionId(messageId, a) {
    return Util.shortHash(messageId + '|' + Util.normalizeText(a.description || '') + '|' + (a.due_date || ''), 16);
  }

  /**
   * Linha de `analyses`. Citações literais ficam isoladas em evidence_json
   * (retidas); fatos, ações e oportunidade são gravados sem elas.
   */
  function analysisRow(msg, merged, meta) {
    var facts = (merged.key_facts || []).slice(0, 6);
    var actions = (merged.actions || []).slice(0, 5).map(function (a) {
      return { id: actionId(msg.message_id, a), description: a.description, owner: a.owner || 'unknown', due_date: a.due_date || '', due_certainty: a.due_certainty || 'NONE' };
    });
    var op = merged.opportunity || null;
    var opStored = null;
    if (op) {
      opStored = {};
      Object.keys(op).forEach(function (k) {
        if (k !== 'evidence') opStored[k] = op[k];
      });
    }
    var evidence = {
      facts: facts.map(function (f) { return f.evidence || ''; }),
      actions: (merged.actions || []).slice(0, 5).map(function (a) { return a.evidence || ''; }),
      classification: merged.evidence || [],
      opportunity: op && op.evidence ? op.evidence : '',
    };
    var isAi = merged.method === 'AI';
    var entities = merged.entities || [];
    var searchText = Util.normalizeText([
      isAi ? merged.summary : '',
      facts.map(function (f) { return f.fact; }).join(' '),
      (merged.topics || []).join(' '),
      entities.map(function (e) { return e.name; }).join(' '),
      op ? [op.title, op.company, op.role].join(' ') : '',
    ].join(' ')).slice(0, 4000);
    var versionTs = meta.versionTs;
    return {
      analysis_id: Util.shortHash(msg.message_id + '|' + merged.method + '|' + Config.CLASSIFIER_VERSION + '|' + versionTs, 20),
      message_id: msg.message_id, thread_id: msg.thread_id, received_date: msg.received_date,
      method: merged.method, provider: meta.provider || 'rules', model: meta.model || '', classifier_version: Config.CLASSIFIER_VERSION,
      config_version: Config.configVersion(), prompt_version: isAi ? AiSchema.PROMPT_VERSION : '', send_policy: meta.policy || 'OFF',
      primary_category: merged.primary_category, secondary_categories: merged.secondary_categories || [], topics: merged.topics || [],
      summary: merged.summary || '', summary_kind: isAi ? 'ABSTRACTIVE' : 'EXTRACTIVE',
      key_facts_json: JSON.stringify(facts.map(function (f) { return { fact: f.fact }; })), whats_new: merged.whats_new || '',
      relevance: merged.relevance || null, importance: merged.importance || null, urgency: merged.urgency || null,
      action_required: !!merged.action_required, actions_json: JSON.stringify(actions),
      deadline_date: merged.deadline ? merged.deadline.date : null, deadline_certainty: merged.deadline ? merged.deadline.certainty : null,
      deadline_evidence: merged.deadline ? redact_(merged.deadline.evidence || '') : null,
      entities_json: JSON.stringify(entities), opportunity_json: opStored ? JSON.stringify(opStored) : null,
      opportunity_key: op ? RulesClassifier.opportunityKey(op) : '',
      evidence_json: meta.evidenceJson || JSON.stringify(evidence),
      evidence_total: meta.fidelity ? meta.fidelity.evidence_total : null, evidence_verified: meta.fidelity ? meta.fidelity.evidence_verified : null,
      confidence: merged.confidence, reason: merged.reason || '',
      is_newsletter: !!merged.is_newsletter, is_marketing: !!merged.is_marketing, is_probable_spam: !!merged.is_probable_spam,
      sensitive: !!merged.sensitive, ai_eligible: merged.ai_eligible !== false,
      injection_suspected: !!(merged.injection && merged.injection.suspected) || !!merged.injection_suspected,
      ai_status: meta.aiStatus || (isAi ? 'DONE' : 'PENDING'), ai_attempts: meta.aiAttempts || 0, ai_error: meta.aiError || '',
      features_json: JSON.stringify(meta.features || {}), redactions_json: JSON.stringify(meta.redactions || {}),
      input_tokens: meta.usage ? meta.usage.input_tokens : null, output_tokens: meta.usage ? meta.usage.output_tokens : null,
      cost_usd: meta.usage ? meta.usage.cost_usd : null, latency_ms: meta.usage ? meta.usage.latency_ms : null,
      search_text: searchText, run_id: meta.runId, version_ts: versionTs,
    };
  }

  function scoreRow(msg, analysisId, result, meta) {
    return {
      message_id: msg.message_id, analysis_id: analysisId, received_date: msg.received_date,
      score: result.score, level: result.level, critical_eligible: !!result.gate.critical, info_score: result.info_score,
      relevance: result.axes.relevance, urgency: result.axes.urgency, action: result.axes.action,
      deadline_date: meta.deadlineDate || null, components_json: JSON.stringify(result.components),
      reason: Scoring.topReasons(result).map(function (r) { return r.why; }).join(' · '),
      source: meta.source || 'ANALYSIS', run_id: meta.runId, version_ts: meta.versionTs,
    };
  }

  // -------------------------------------------------------------- escrita ----
  /** Normaliza linhas e dispara o load (sem aguardar). */
  function load_(table, rows, jobKey, counters) {
    if (!rows || !rows.length) return null;
    var coerced = rows.map(function (r) {
      var c = Schema.coerceRow(table, r);
      if (c.errors.length && counters) counters.validation = (counters.validation || 0) + c.errors.length;
      return c.row;
    });
    return BigQueryClient.loadNdjson(Schema.physical(table), coerced, { jobKey: jobKey });
  }

  /**
   * Commit em duas fases: (1) analyses + scores + message_state, aguardados e
   * confirmados sem erro; (2) messages (marcador de commit).
   * @return {{ok: boolean, phase: string, results: Object[], counters: Object}}
   */
  function commitIngest(batch, runId, budget) {
    var counters = {};
    var first = [
      load_('analyses', batch.analyses, runId + ':analyses:' + (batch.key || ''), counters),
      load_('scores', batch.scores, runId + ':scores:' + (batch.key || ''), counters),
      load_('message_state', batch.states, runId + ':state:' + (batch.key || ''), counters),
    ];
    var r1 = BigQueryClient.waitJobs(first, budget);
    if (r1.some(function (r) { return !r.ok; })) return { ok: false, phase: 'derived', results: r1, counters: counters };
    var r2 = BigQueryClient.waitJobs([load_('messages', batch.messages, runId + ':messages:' + (batch.key || ''), counters)], budget);
    var ok = r2.every(function (r) { return r.ok; });
    if (ok) bumpDataVersion();
    return { ok: ok, phase: ok ? 'committed' : 'messages', results: r1.concat(r2), counters: counters };
  }

  /** Append simples (scores de reescore, estado, runs, briefings). */
  function append(table, rows, jobKey, budget) {
    if (!rows || !rows.length) return { ok: true, results: [] };
    var res = BigQueryClient.waitJobs([load_(table, rows, jobKey)], budget);
    var ok = res.every(function (r) { return r.ok; });
    if (ok && table !== 'runs') bumpDataVersion();
    return { ok: ok, results: res };
  }

  // ------------------------------------------------- fila de feedback ----
  var FEEDBACK_TYPES = ['RELEVANT', 'IRRELEVANT', 'RESOLVED', 'SAVED', 'MISCLASSIFIED', 'REOPEN', 'DISMISSED', 'SHOULD_BE_HIGHER'];
  var TARGET_TYPES = ['MESSAGE', 'ACTION', 'OPPORTUNITY'];

  /** Enfileira um evento (gravação atômica nas Properties; sem lock nem BigQuery). */
  function queueFeedback(ev) {
    if (TARGET_TYPES.indexOf(ev.targetType) < 0 || FEEDBACK_TYPES.indexOf(ev.type) < 0) throw new Error('Feedback inválido.');
    if (!/^[A-Za-z0-9:_|.@-]{1,200}$/.test(String(ev.targetId || ''))) throw new Error('Alvo inválido.');
    var payload = {};
    if (ev.type === 'MISCLASSIFIED') {
      var cat = ev.payload && ev.payload.correctCategory;
      if (Config.categoryIds().indexOf(cat) < 0) throw new Error('Categoria inválida.');
      payload.correctCategory = cat;
    }
    var now = Util.nowIso();
    var row = {
      feedback_id: Util.uuid(), target_type: ev.targetType, target_id: String(ev.targetId),
      message_id: ev.messageId && /^[0-9a-f]{6,40}$/i.test(ev.messageId) ? ev.messageId : (ev.targetType === 'MESSAGE' ? String(ev.targetId) : ''),
      feedback_type: ev.type, payload_json: JSON.stringify(payload), source: 'UI', created_at: now, version_ts: now,
    };
    PropertiesService.getScriptProperties().setProperty(FB_PREFIX + Util.now() + '_' + Util.nonce().slice(0, 6), JSON.stringify(row));
    updateMirror_(row);
    return row;
  }

  function pendingFeedback() {
    var p = PropertiesService.getScriptProperties();
    var all = p.getProperties();
    return Object.keys(all).filter(function (k) {
      return k.indexOf(FB_PREFIX) === 0;
    }).sort().map(function (k) {
      return { key: k, row: Util.safeJsonParse(all[k], null) };
    }).filter(function (x) {
      return x.row;
    });
  }

  /** Descarrega a fila no BigQuery (sob o lock do pipeline). Só apaga após DONE sem erro. */
  function flushFeedback(runId, budget) {
    var pending = pendingFeedback();
    if (!pending.length) return { flushed: 0, rows: [] };
    var res = append('feedback', pending.map(function (x) { return x.row; }), runId + ':feedback', budget);
    if (!res.ok) return { flushed: 0, error: 'LOAD_FAILED', rows: [] };
    var p = PropertiesService.getScriptProperties();
    pending.forEach(function (x) {
      p.deleteProperty(x.key);
    });
    return { flushed: pending.length, rows: pending.map(function (x) { return x.row; }) };
  }

  /** Espelho compacto do último estado por alvo (recuperação caso o BigQuery expire). */
  function updateMirror_(row) {
    var p = PropertiesService.getScriptProperties();
    var n = Number(p.getProperty(FB_MIRROR_PREFIX + 'N') || 0);
    var s = '';
    for (var i = 0; i < n; i++) s += p.getProperty(FB_MIRROR_PREFIX + i) || '';
    var map = Util.safeJsonParse(s, {}) || {};
    var k = row.target_type.charAt(0) + ':' + row.target_id;
    map[k] = [row.feedback_type, JSON.parse(row.payload_json || '{}').correctCategory || '', row.created_at.slice(0, 10)];
    var keys = Object.keys(map);
    if (keys.length > 1500) keys.slice(0, keys.length - 1500).forEach(function (old) { delete map[old]; });
    var parts = Util.chunkString(JSON.stringify(map), 8000);
    /** @type {Object<string, string>} */
    var out = {};
    parts.forEach(function (part, idx) {
      out[FB_MIRROR_PREFIX + idx] = part;
    });
    out[FB_MIRROR_PREFIX + 'N'] = String(parts.length);
    p.setProperties(out);
    for (var j = parts.length; j < n; j++) p.deleteProperty(FB_MIRROR_PREFIX + j);
  }

  function feedbackMirror() {
    var p = PropertiesService.getScriptProperties();
    var n = Number(p.getProperty(FB_MIRROR_PREFIX + 'N') || 0);
    var s = '';
    for (var i = 0; i < n; i++) s += p.getProperty(FB_MIRROR_PREFIX + i) || '';
    return Util.safeJsonParse(s, {}) || {};
  }

  // ------------------------------------------------------------ leitura ----
  function existingMessageIds(ids) {
    var out = {};
    if (!ids.length) return out;
    Util.chunk(ids, 1000).forEach(function (part) {
      run_('existing_ids', { ids: part }).rows.forEach(function (r) {
        out[r.message_id] = true;
      });
    });
    return out;
  }

  function existingAiAnalyses(ids) {
    var out = {};
    if (!ids.length) return out;
    run_('existing_ai', { ids: ids }).rows.forEach(function (r) {
      out[r.message_id] = r;
    });
    return out;
  }

  function pendingAi(limit, sinceYmd, policy) {
    return run_('pending_ai', {
      limit: limit, since: date_(sinceYmd), policy: policy, max_attempts: Config.get().ai.maxAttempts,
    }, { maxRows: limit }).rows;
  }

  function threadContext(threadIds, excludeIds) {
    var out = {};
    if (!threadIds.length) return out;
    run_('thread_context', { thread_ids: threadIds, exclude_ids: excludeIds.length ? excludeIds : ['-'] }).rows.forEach(function (r) {
      out[r.thread_id] = r;
    });
    return out;
  }

  function knownContacts() {
    var c = Util.cacheGetJson('known_contacts');
    if (c) return c;
    var out = {};
    run_('known_contacts').rows.forEach(function (r) {
      out[r.email] = true;
    });
    Util.cachePutJson('known_contacts', out, 6 * 3600);
    return out;
  }

  function senderAffinity() {
    var c = Util.cacheGetJson('sender_affinity_v' + dataVersion());
    if (c) return c;
    var out = {};
    run_('sender_affinity').rows.forEach(function (r) {
      out[r.email] = Util.round(Number(r.net) / (Number(r.n) + 2), 3);
    });
    Util.cachePutJson('sender_affinity_v' + dataVersion(), out, 6 * 3600);
    return out;
  }

  function prioritySuggestions() {
    return run_('priority_suggestions').rows;
  }

  function rescoreCandidates(todayYmd, extraIds) {
    return run_('rescore_candidates', { today: date_(todayYmd), extra_ids: extraIds && extraIds.length ? extraIds : ['-'] }, { maxRows: 1000 }).rows;
  }

  function duplicateHashes(hashes, excludeIds) {
    var out = {};
    if (!hashes.length) return out;
    run_('duplicate_hashes', { hashes: hashes, exclude_ids: excludeIds.length ? excludeIds : ['-'] }).rows.forEach(function (r) {
      out[r.content_hash] = true;
    });
    return out;
  }

  function idsInWindow(startYmd, endYmd) {
    return run_('ids_in_window', { start: date_(startYmd), end: date_(endYmd) }, { maxRows: 5000 }).rows.map(function (r) {
      return r.message_id;
    });
  }

  function query(name, params, opts) {
    return run_(name, params, opts);
  }

  return {
    QUERIES: QUERIES,
    FEEDBACK_TYPES: FEEDBACK_TYPES,
    TARGET_TYPES: TARGET_TYPES,
    render: render,
    query: query,
    cached: cached,
    dataVersion: dataVersion,
    bumpDataVersion: bumpDataVersion,
    messageRow: messageRow,
    stateFromLabels: stateFromLabels,
    stateRow: stateRow,
    actionId: actionId,
    analysisRow: analysisRow,
    scoreRow: scoreRow,
    commitIngest: commitIngest,
    append: append,
    queueFeedback: queueFeedback,
    pendingFeedback: pendingFeedback,
    flushFeedback: flushFeedback,
    feedbackMirror: feedbackMirror,
    existingMessageIds: existingMessageIds,
    existingAiAnalyses: existingAiAnalyses,
    pendingAi: pendingAi,
    threadContext: threadContext,
    knownContacts: knownContacts,
    senderAffinity: senderAffinity,
    prioritySuggestions: prioritySuggestions,
    rescoreCandidates: rescoreCandidates,
    duplicateHashes: duplicateHashes,
    idsInWindow: idsInWindow,
    date: date_,
  };
})();
