-- Gerado por scripts/export-sql.js a partir de src/Schema.js e src/Repository.js.
-- Não edite à mão: a fonte da verdade é o código. Projeto de exemplo: meu-projeto.

-- query/existing_ids
SELECT DISTINCT message_id FROM `meu-projeto.inbox_intelligence.messages__g1` WHERE message_id IN UNNEST(@ids);

-- query/existing_ai
SELECT message_id, analysis_id, provider, model, primary_category, secondary_categories, topics, summary, key_facts_json, whats_new,
  relevance, importance, urgency, action_required, actions_json, deadline_date, deadline_certainty, deadline_evidence,
  entities_json, opportunity_json, evidence_json, confidence, reason, injection_suspected, evidence_total, evidence_verified
FROM `meu-projeto.inbox_intelligence.analyses__g1` WHERE method = 'AI' AND message_id IN UNNEST(@ids)
QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1;

-- query/pending_ai
SELECT i.message_id, i.thread_id, i.internal_ts, i.received_date, i.direction, i.from_email, i.from_name, i.from_domain,
  i.subject, i.user_in_to, i.is_bulk, i.is_automated, i.has_list_unsubscribe, i.list_id, i.gmail_category, i.auth_fail, i.auth_pass,
  i.content_hash, i.label_ids, i.body_excerpt, i.analysis_id, i.model_category, i.secondary_categories, i.topics, i.summary,
  i.key_facts_json, i.action_required, i.actions_json, i.deadline_date, i.deadline_certainty, i.deadline_evidence, i.entities_json,
  i.opportunity_json, i.evidence_json, i.evidence_total, i.evidence_verified, i.confidence, i.reason, i.is_newsletter, i.is_marketing,
  i.is_probable_spam, i.sensitive, i.ai_eligible, i.ai_status, i.ai_attempts, i.ai_error, i.injection_suspected, i.features_json,
  i.score, i.correct_category, i.user_relevance
FROM `meu-projeto.inbox_intelligence.v_inbox` i
WHERE i.method = 'RULES' AND i.direction = 'INBOUND'
  AND (COALESCE(i.ai_status, 'PENDING') IN ('PENDING', 'FAILED') OR (i.ai_status = 'BLOCKED' AND COALESCE(i.ai_error, '') != @policy))
  AND COALESCE(i.ai_attempts, 0) < @max_attempts
  AND COALESCE(i.ai_eligible, TRUE)
  AND NOT COALESCE(i.auth_fail, FALSE)
  AND NOT COALESCE(SAFE_CAST(JSON_VALUE(i.features_json, '$.untrusted') AS BOOL), FALSE)
  AND i.received_date >= @since
  AND i.body_excerpt IS NOT NULL
  AND (@policy = 'FULL'
    OR (@policy = 'REDACTED' AND NOT COALESCE(i.sensitive, FALSE))
    OR (@policy = 'BROADCAST' AND NOT COALESCE(i.sensitive, FALSE) AND COALESCE(i.is_automated, FALSE)
        AND (COALESCE(i.has_list_unsubscribe, FALSE) OR i.list_id IS NOT NULL) AND COALESCE(i.gmail_category, '') != 'PERSONAL'))
ORDER BY i.score DESC, i.internal_ts DESC
LIMIT @limit;

-- query/thread_context
SELECT thread_id, message_id, summary, method, from_domain, is_automated, is_bulk, has_list_unsubscribe, list_id, gmail_category,
  sensitive, ai_eligible, is_probable_spam, auth_fail, direction, primary_category,
  COALESCE(SAFE_CAST(JSON_VALUE(features_json, '$.untrusted') AS BOOL), FALSE) AS untrusted
FROM `meu-projeto.inbox_intelligence.v_inbox`
WHERE thread_id IN UNNEST(@thread_ids) AND message_id NOT IN UNNEST(@exclude_ids) AND summary IS NOT NULL AND direction = 'INBOUND'
QUALIFY ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY internal_ts DESC) = 1;

-- query/known_contacts
SELECT DISTINCT LOWER(e) AS email
FROM `meu-projeto.inbox_intelligence.v_messages` m, UNNEST(ARRAY_CONCAT(m.to_emails, m.cc_emails)) AS e
WHERE m.direction = 'OUTBOUND' AND m.received_date >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 365 DAY)
LIMIT 3000;

-- query/sender_affinity
SELECT LOWER(m.from_email) AS email,
  SUM(CASE WHEN u.relevance IN ('RELEVANT', 'SHOULD_BE_HIGHER') OR u.status = 'SAVED' THEN 1 WHEN u.relevance = 'IRRELEVANT' THEN -1 ELSE 0 END) AS net,
  COUNT(*) AS n
FROM `meu-projeto.inbox_intelligence.v_user_state` u JOIN `meu-projeto.inbox_intelligence.v_messages` m ON u.target_type = 'MESSAGE' AND u.target_id = m.message_id
GROUP BY email
LIMIT 2000;

-- query/priority_suggestions
SELECT LOWER(e) AS email, COUNT(*) AS n
FROM `meu-projeto.inbox_intelligence.v_messages` m, UNNEST(m.to_emails) AS e
WHERE m.direction = 'OUTBOUND' AND m.received_date >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 90 DAY)
GROUP BY email ORDER BY n DESC LIMIT 15;

-- query/rescore_candidates
SELECT message_id, analysis_id, received_date, features_json, level, score, user_status, user_relevance, correct_category,
  deadline_date, method
FROM `meu-projeto.inbox_intelligence.v_inbox`
WHERE direction = 'INBOUND' AND features_json IS NOT NULL
  AND (deadline_date BETWEEN DATE_SUB(@today, INTERVAL 4 DAY) AND DATE_ADD(@today, INTERVAL 14 DAY)
       OR message_id IN UNNEST(@extra_ids))
LIMIT 1000;

-- query/duplicate_hashes
SELECT DISTINCT content_hash FROM `meu-projeto.inbox_intelligence.messages__g1`
WHERE content_hash IN UNNEST(@hashes) AND message_id NOT IN UNNEST(@exclude_ids)
  AND received_date >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY);

-- query/ids_in_window
SELECT message_id FROM `meu-projeto.inbox_intelligence.v_inbox` WHERE received_date BETWEEN @start AND @end LIMIT 5000;

-- query/radar
WITH base AS (
  SELECT message_id, thread_id, rfc822_message_id, subject, from_name, from_email, from_domain, internal_ts, received_date,
    primary_category, secondary_categories, summary, summary_kind, method, display_level, critical_overflow, score, info_score,
    relevance_axis, urgency_axis, action_axis, components_json, action_required, deadline_date, deadline_certainty,
    is_unread, is_starred, confidence, user_status, user_relevance, injection_suspected, auth_fail, is_probable_spam, topics,
    is_newsletter, is_marketing, is_bulk, opportunity_json, in_inbox
  FROM `meu-projeto.inbox_intelligence.v_inbox`
  WHERE direction = 'INBOUND' AND received_date BETWEEN @prev_start AND @end
), cur AS (
  SELECT message_id, thread_id, rfc822_message_id, subject, from_name, from_email, from_domain, internal_ts, received_date,
    primary_category, secondary_categories, summary, summary_kind, method, display_level, critical_overflow, score, info_score,
    relevance_axis, urgency_axis, action_axis, components_json, action_required, deadline_date, deadline_certainty,
    is_unread, is_starred, confidence, user_status, user_relevance, injection_suspected, auth_fail, is_probable_spam, topics,
    is_newsletter, is_marketing, is_bulk, opportunity_json, in_inbox
  FROM base WHERE received_date >= @start
), prev AS (
  SELECT primary_category, display_level, action_required FROM base WHERE received_date < @start
    AND (@period != 'today' OR internal_ts <= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR))
)
SELECT
  (SELECT AS STRUCT COUNT(*) AS received,
     COUNTIF(display_level IN ('CRITICAL', 'HIGH')) AS attention,
     COUNTIF(COALESCE(action_required, FALSE)) AS actions,
     COUNTIF(opportunity_json IS NOT NULL AND opportunity_json NOT IN ('', 'null')) AS opportunities,
     COUNTIF(COALESCE(is_newsletter, FALSE)) AS newsletters,
     COUNTIF(primary_category IN ('marketing', 'spam') OR COALESCE(is_marketing, FALSE) OR COALESCE(is_probable_spam, FALSE)) AS noise,
     COUNTIF(display_level = 'LOW' AND is_unread) AS triaged_unread,
     COUNTIF(method = 'RULES') AS rules_only
   FROM cur) AS kpis,
  (SELECT AS STRUCT COUNT(*) AS received, COUNTIF(display_level IN ('CRITICAL', 'HIGH')) AS attention, COUNTIF(COALESCE(action_required, FALSE)) AS actions FROM prev) AS kpis_prev,
  ARRAY(SELECT AS STRUCT message_id, thread_id, rfc822_message_id, subject, from_name, from_email, from_domain, internal_ts, received_date,
      primary_category, secondary_categories, summary, summary_kind, method, display_level, critical_overflow, score,
      relevance_axis, urgency_axis, action_axis, components_json, action_required, deadline_date, deadline_certainty,
      is_unread, is_starred, confidence, user_status, user_relevance, injection_suspected, auth_fail
    FROM `meu-projeto.inbox_intelligence.v_inbox` WHERE direction = 'INBOUND' AND received_date >= DATE_SUB(@end, INTERVAL 60 DAY)
      AND (received_date BETWEEN @start AND @end OR deadline_date BETWEEN DATE_SUB(@end, INTERVAL 3 DAY) AND DATE_ADD(@end, INTERVAL 3 DAY) OR display_level = 'CRITICAL')
      AND display_level IN ('CRITICAL', 'HIGH') AND user_status NOT IN ('RESOLVED', 'DISMISSED') AND user_relevance != 'IRRELEVANT'
      AND (COALESCE(action_required, FALSE) OR COALESCE(urgency_axis, 0) >= @min_urgency) AND in_inbox
    ORDER BY IF(display_level = 'CRITICAL', 0, 1), score DESC LIMIT 12) AS attention,
  ARRAY(SELECT AS STRUCT message_id, thread_id, rfc822_message_id, subject, from_name, from_email, from_domain, internal_ts, received_date,
      primary_category, secondary_categories, summary, summary_kind, method, display_level, critical_overflow, score, info_score,
      relevance_axis, urgency_axis, action_axis, components_json, action_required, deadline_date, deadline_certainty,
      is_unread, is_starred, confidence, user_status, user_relevance, injection_suspected, auth_fail
    FROM cur WHERE (COALESCE(is_newsletter, FALSE) OR primary_category IN ('noticias', 'economia', 'tecnologia', 'negocios'))
      AND NOT COALESCE(is_marketing, FALSE) AND user_relevance != 'IRRELEVANT'
    ORDER BY info_score DESC LIMIT 8) AS news,
  ARRAY(SELECT AS STRUCT topic, COUNT(*) AS n FROM cur, UNNEST(topics) AS topic GROUP BY topic ORDER BY n DESC LIMIT 8) AS topics,
  ARRAY(SELECT AS STRUCT primary_category AS category, COUNT(*) AS n FROM cur GROUP BY category ORDER BY n DESC) AS by_category,
  ARRAY(SELECT AS STRUCT primary_category AS category, COUNT(*) AS n FROM prev GROUP BY category) AS by_category_prev,
  ARRAY(SELECT AS STRUCT action_id, message_id, thread_id, description, owner, due_date, due_certainty, status, subject, from_name, from_email,
      priority_level, received_date, method
    FROM `meu-projeto.inbox_intelligence.v_actions` WHERE status = 'OPEN' ORDER BY due_date IS NULL, due_date, score DESC LIMIT 10) AS tasks,
  ARRAY(SELECT AS STRUCT opp_key, latest_json, first_seen, last_seen, mentions, message_ids, best_score, user_status
    FROM `meu-projeto.inbox_intelligence.v_opportunities` WHERE last_seen >= DATE_SUB(@end, INTERVAL 30 DAY) AND COALESCE(user_status, '') != 'DISMISSED'
    ORDER BY best_score DESC LIMIT 6) AS opportunities,
  (SELECT COUNT(*) FROM `meu-projeto.inbox_intelligence.v_inbox` WHERE direction = 'INBOUND' AND internal_ts > @since_ts AND display_level IN ('CRITICAL', 'HIGH')) AS since_last_visit,
  (SELECT AS STRUCT content_json, method, provider, version_ts FROM `meu-projeto.inbox_intelligence.v_briefings` WHERE period = @period AND period_end = @end ORDER BY version_ts DESC LIMIT 1) AS briefing;

-- query/inbox_list
WITH r AS (
  SELECT message_id, thread_id, rfc822_message_id, subject, from_name, from_email, from_domain, internal_ts, received_date,
    primary_category, secondary_categories, summary, summary_kind, method, display_level, critical_overflow, score,
    relevance_axis, urgency_axis, action_axis, action_required, deadline_date, deadline_certainty, is_unread, is_starred,
    confidence, user_status, user_relevance, injection_suspected, auth_fail, is_bulk,
    (SELECT COALESCE(SUM(IF(STRPOS(IFNULL(search_meta, ''), t) > 0, 3, 0) + IF(STRPOS(IFNULL(analysis_search, ''), t) > 0, 2, 0)
       + IF(STRPOS(IFNULL(search_body, ''), t) > 0, 1, 0)), 0) FROM UNNEST(@terms) AS t) AS match_score
  FROM `meu-projeto.inbox_intelligence.v_inbox`
  WHERE direction = 'INBOUND' AND received_date >= @since
    AND (ARRAY_LENGTH(@categories) = 0 OR primary_category IN UNNEST(@categories)
         OR EXISTS (SELECT 1 FROM UNNEST(secondary_categories) AS c WHERE c IN UNNEST(@categories)))
    AND (ARRAY_LENGTH(@levels) = 0 OR display_level IN UNNEST(@levels))
    AND (@action = '' OR (@action = 'yes' AND COALESCE(action_required, FALSE)) OR (@action = 'no' AND NOT COALESCE(action_required, FALSE)))
    AND (@deadline = '' OR (@deadline = 'yes' AND deadline_date IS NOT NULL) OR (@deadline = 'no' AND deadline_date IS NULL))
    AND (@unread = '' OR (@unread = 'yes' AND is_unread) OR (@unread = 'no' AND NOT is_unread))
    AND (@sender = '' OR STRPOS(LOWER(IFNULL(from_email, '')), @sender) > 0
         OR STRPOS(REGEXP_REPLACE(NORMALIZE(LOWER(IFNULL(from_name, '')), NFD), r'\pM', ''), @sender) > 0)
    AND (@status = '' OR (@status = 'OPEN' AND user_status NOT IN ('RESOLVED', 'DISMISSED')) OR user_status = @status)
    AND (ARRAY_LENGTH(@terms) = 0 OR (SELECT LOGICAL_AND(STRPOS(CONCAT(IFNULL(search_meta, ''), ' ', IFNULL(search_body, ''), ' ', IFNULL(analysis_search, '')), t) > 0) FROM UNNEST(@terms) AS t))
)
SELECT message_id, thread_id, rfc822_message_id, subject, from_name, from_email, from_domain, internal_ts, received_date,
  primary_category, secondary_categories, summary, summary_kind, method, display_level, critical_overflow, score,
  relevance_axis, urgency_axis, action_axis, action_required, deadline_date, deadline_certainty, is_unread, is_starred,
  confidence, user_status, user_relevance, injection_suspected, auth_fail, is_bulk, match_score
FROM r
ORDER BY
  CASE WHEN @sort = 'match' THEN match_score END DESC,
  CASE WHEN @sort = 'priority' THEN CASE display_level WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END END DESC,
  CASE WHEN @sort = 'priority' THEN score END DESC,
  CASE WHEN @sort = 'relevance' THEN relevance_axis END DESC,
  CASE WHEN @sort = 'urgency' THEN urgency_axis END DESC,
  CASE WHEN @sort = 'deadline' THEN IFNULL(deadline_date, DATE '9999-12-31') END ASC,
  internal_ts DESC
LIMIT @limit;

-- query/message_detail
SELECT i.message_id, i.thread_id, i.rfc822_message_id, i.internal_ts, i.received_date, i.direction, i.from_email, i.from_name,
  i.from_domain, i.to_emails, i.cc_emails, i.user_in_to, i.subject, i.snippet, i.body_excerpt, i.links_json, i.attachments_json,
  i.attachment_count, i.unsubscribe_url, i.has_list_unsubscribe, i.auth_pass, i.auth_fail, i.is_bulk, i.is_automated, i.retention_expired,
  i.is_unread, i.is_starred, i.in_inbox, i.gmail_state, i.method, i.provider, i.model, i.primary_category, i.model_category,
  i.secondary_categories, i.topics, i.summary, i.summary_kind, i.key_facts_json, i.whats_new, i.action_required, i.actions_json,
  i.deadline_date, i.deadline_certainty, i.deadline_evidence, i.entities_json, i.opportunity_json, i.evidence_json, i.evidence_total,
  i.evidence_verified, i.confidence, i.reason, i.is_newsletter, i.is_marketing, i.is_probable_spam, i.sensitive, i.injection_suspected,
  i.ai_status, i.display_level, i.critical_overflow, i.score, i.relevance_axis, i.urgency_axis, i.action_axis, i.components_json,
  i.user_status, i.user_relevance, i.correct_category, i.parse_status, i.opportunity_key,
  ARRAY(SELECT AS STRUCT h.method, h.provider, h.model, h.version_ts FROM `meu-projeto.inbox_intelligence.analyses__g1` h WHERE h.message_id = @id ORDER BY h.version_ts DESC LIMIT 10) AS history
FROM `meu-projeto.inbox_intelligence.v_inbox` i WHERE i.message_id = @id;

-- query/actions_for_message
SELECT action_id, status FROM `meu-projeto.inbox_intelligence.v_actions` WHERE message_id = @id;

-- query/news
SELECT message_id, thread_id, rfc822_message_id, subject, from_name, from_email, from_domain, internal_ts, received_date,
  primary_category, secondary_categories, summary, summary_kind, method, display_level, critical_overflow, score, info_score,
  relevance_axis, urgency_axis, action_axis, components_json, action_required, deadline_date, deadline_certainty, is_unread,
  is_starred, confidence, user_status, user_relevance, injection_suspected, auth_fail, topics
FROM `meu-projeto.inbox_intelligence.v_inbox`
WHERE direction = 'INBOUND' AND received_date >= @since
  AND (COALESCE(is_newsletter, FALSE) OR primary_category IN ('noticias', 'economia', 'tecnologia', 'negocios', 'newsletters'))
  AND NOT COALESCE(is_marketing, FALSE) AND NOT COALESCE(is_probable_spam, FALSE) AND user_relevance != 'IRRELEVANT'
ORDER BY info_score DESC, internal_ts DESC
LIMIT 60;

-- query/tasks
SELECT action_id, message_id, thread_id, description, owner, due_date, due_certainty, status, subject, from_name, from_email,
  priority_level, received_date, method
FROM `meu-projeto.inbox_intelligence.v_actions`
WHERE (@status = 'ALL' OR (@status = 'OPEN' AND status = 'OPEN') OR (@status = 'DONE' AND status != 'OPEN'))
  AND received_date >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 90 DAY)
ORDER BY status != 'OPEN', due_date IS NULL, due_date, score DESC
LIMIT 300;

-- query/opportunities
SELECT opp_key, latest_json, first_seen, last_seen, mentions, message_ids, sources, best_score, user_status
FROM `meu-projeto.inbox_intelligence.v_opportunities`
WHERE (@status = 'ALL' OR (@status = 'OPEN' AND COALESCE(user_status, '') != 'DISMISSED') OR COALESCE(user_status, '') = @status)
ORDER BY last_seen DESC, best_score DESC
LIMIT 200;

-- query/senders
WITH win AS (
  SELECT LOWER(from_email) AS email, from_name, from_domain, received_date, primary_category, score, display_level, is_unread,
    has_list_unsubscribe, unsubscribe_url, auth_pass, is_probable_spam, is_marketing, is_newsletter
  FROM `meu-projeto.inbox_intelligence.v_inbox` WHERE direction = 'INBOUND' AND received_date >= @prev_start
)
SELECT email, ANY_VALUE(from_name) AS name, ANY_VALUE(from_domain) AS domain,
  COUNTIF(received_date >= @start) AS n, COUNTIF(received_date < @start) AS n_prev,
  AVG(IF(received_date >= @start, score, NULL)) AS avg_score,
  SAFE_DIVIDE(COUNTIF(received_date >= @start AND display_level IN ('CRITICAL', 'HIGH')), COUNTIF(received_date >= @start)) AS high_share,
  SAFE_DIVIDE(COUNTIF(received_date >= @start AND is_unread), COUNTIF(received_date >= @start)) AS unread_share,
  SAFE_DIVIDE(COUNTIF(received_date >= @start AND (COALESCE(is_marketing, FALSE) OR COALESCE(is_newsletter, FALSE) OR primary_category IN ('marketing', 'newsletters'))), COUNTIF(received_date >= @start)) AS mass_share,
  LOGICAL_OR(COALESCE(has_list_unsubscribe, FALSE)) AS has_unsub, LOGICAL_AND(COALESCE(auth_pass, FALSE)) AS all_auth_pass,
  LOGICAL_OR(COALESCE(is_probable_spam, FALSE)) AS any_spam, MAX(unsubscribe_url) AS unsubscribe_url,
  ARRAY_AGG(IF(received_date >= @start, primary_category, NULL) IGNORE NULLS LIMIT 200) AS cats
FROM win
GROUP BY email
HAVING n > 0
ORDER BY n DESC
LIMIT 100;

-- query/system_status
SELECT
  ARRAY(SELECT AS STRUCT run_id, kind, trigger_source, started_at, finished_at, status, duration_ms, counts_json, errors_json, stages_json,
      ai_cost_usd, ai_requests, gmail_units
    FROM `meu-projeto.inbox_intelligence.v_runs` ORDER BY started_at DESC LIMIT 25) AS runs,
  (SELECT AS STRUCT MAX(IF(status = 'SUCCESS' AND kind = 'PIPELINE', finished_at, NULL)) AS last_success,
     COUNTIF(status IN ('FAILED', 'ABORTED') AND started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)) AS fails_24h,
     COUNTIF(started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)) AS runs_24h,
     AVG(IF(started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR), duration_ms, NULL)) AS avg_ms,
     SUM(IF(started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY), ai_cost_usd, 0)) AS ai_cost_30d,
     SUM(IF(started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY), ai_requests, 0)) AS ai_requests_30d
   FROM `meu-projeto.inbox_intelligence.v_runs`) AS health,
  (SELECT AS STRUCT COUNT(*) AS total, COUNTIF(method = 'AI') AS ai_done,
     COUNTIF(method = 'RULES' AND COALESCE(ai_status, '') IN ('PENDING', 'FAILED')) AS ai_pending,
     COUNTIF(ai_status = 'FAILED') AS ai_failed, COUNTIF(parse_status = 'QUARANTINED') AS quarantined, COUNTIF(analysis_id IS NULL) AS unclassified,
     COUNTIF(display_level = 'CRITICAL' AND received_date = CURRENT_DATE('America/Sao_Paulo')) AS critical_today,
     SAFE_DIVIDE(COUNTIF(display_level IN ('CRITICAL', 'HIGH') AND received_date >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 7 DAY)),
       COUNTIF(received_date >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 7 DAY))) AS high_share_7d,
     MIN(received_date) AS oldest, MAX(received_date) AS newest
   FROM `meu-projeto.inbox_intelligence.v_inbox` WHERE direction = 'INBOUND') AS pending,
  ARRAY(SELECT AS STRUCT primary_category AS category, COUNT(*) AS n, COUNTIF(user_relevance = 'IRRELEVANT') AS irrelevant,
      COUNTIF(correct_category IS NOT NULL) AS corrected, COUNTIF(user_relevance = 'SHOULD_BE_HIGHER') AS should_be_higher,
      COUNTIF(user_relevance = 'LEVEL_OK') AS level_ok
    FROM `meu-projeto.inbox_intelligence.v_inbox` WHERE direction = 'INBOUND' AND received_date >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 90 DAY)
    GROUP BY category ORDER BY n DESC) AS quality,
  (SELECT AS STRUCT COUNT(*) AS n, COUNTIF(r.primary_category = a.primary_category) AS agree
   FROM (SELECT message_id, primary_category FROM `meu-projeto.inbox_intelligence.analyses__g1` WHERE method = 'RULES'
         QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1) r
   JOIN (SELECT message_id, primary_category FROM `meu-projeto.inbox_intelligence.analyses__g1` WHERE method = 'AI'
         QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1) a
   ON a.message_id = r.message_id) AS agreement,
  (SELECT AS STRUCT COUNT(*) AS n, SUM(cost_usd) AS cost, AVG(latency_ms) AS latency_ms, SUM(evidence_total) AS ev_total, SUM(evidence_verified) AS ev_verified
   FROM `meu-projeto.inbox_intelligence.analyses__g1` WHERE method = 'AI' AND version_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)) AS ai_quality;

-- query/blind_sample
SELECT message_id, subject, from_name, summary, summary_kind, display_level, primary_category, internal_ts
FROM `meu-projeto.inbox_intelligence.v_inbox`
WHERE direction = 'INBOUND' AND display_level IN ('LOW', 'MEDIUM') AND user_relevance = ''
  AND received_date >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 7 DAY)
ORDER BY FARM_FINGERPRINT(CONCAT(message_id, @seed))
LIMIT 10;

-- query/briefing_input
SELECT message_id, thread_id, subject, from_domain, from_name, primary_category, summary, summary_kind, display_level, deadline_date,
  action_required, method, is_automated, is_bulk, has_list_unsubscribe, list_id, gmail_category, sensitive, ai_eligible,
  is_probable_spam, auth_fail, direction, info_score, score, opportunity_json, injection_suspected,
  COALESCE(SAFE_CAST(JSON_VALUE(features_json, '$.untrusted') AS BOOL), FALSE) AS untrusted
FROM `meu-projeto.inbox_intelligence.v_inbox`
WHERE direction = 'INBOUND' AND received_date BETWEEN @start AND @end AND user_status NOT IN ('RESOLVED', 'DISMISSED')
ORDER BY score DESC
LIMIT 40;

-- query/dry_run_rows
SELECT i.message_id, i.subject, i.from_name, i.from_domain, i.received_date, i.direction, i.is_automated, i.is_bulk,
  i.has_list_unsubscribe, i.list_id, i.gmail_category, i.auth_fail, i.user_in_to, i.primary_category, i.sensitive, i.ai_eligible,
  i.is_probable_spam, i.injection_suspected, i.body_excerpt,
  COALESCE(SAFE_CAST(JSON_VALUE(i.features_json, '$.untrusted') AS BOOL), FALSE) AS untrusted
FROM `meu-projeto.inbox_intelligence.v_inbox` i
WHERE i.direction = 'INBOUND' AND i.received_date >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY)
ORDER BY i.internal_ts DESC
LIMIT 500;
