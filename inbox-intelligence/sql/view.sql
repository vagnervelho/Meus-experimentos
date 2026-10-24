-- Gerado por scripts/export-sql.js a partir de src/Schema.js e src/Repository.js.
-- Não edite à mão: a fonte da verdade é o código. Projeto de exemplo: meu-projeto.

-- view/v_messages
CREATE OR REPLACE VIEW `meu-projeto.inbox_intelligence.v_messages`
AS
SELECT * FROM `meu-projeto.inbox_intelligence.messages__g1` WHERE TRUE
QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1;

-- view/v_state
CREATE OR REPLACE VIEW `meu-projeto.inbox_intelligence.v_state`
AS
SELECT * FROM `meu-projeto.inbox_intelligence.message_state__g1` WHERE TRUE
QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1;

-- view/v_analysis
CREATE OR REPLACE VIEW `meu-projeto.inbox_intelligence.v_analysis`
AS
SELECT * FROM `meu-projeto.inbox_intelligence.analyses__g1` WHERE TRUE
QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY IF(method = 'AI', 1, 0) DESC, version_ts DESC) = 1;

-- view/v_scores
CREATE OR REPLACE VIEW `meu-projeto.inbox_intelligence.v_scores`
AS
SELECT * FROM `meu-projeto.inbox_intelligence.scores__g1` WHERE TRUE
QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1;

-- view/v_user_state
CREATE OR REPLACE VIEW `meu-projeto.inbox_intelligence.v_user_state`
AS
WITH f AS (
  SELECT target_type, target_id, message_id, feedback_type, payload_json, version_ts,
    CASE WHEN feedback_type IN ('RESOLVED', 'SAVED', 'DISMISSED', 'REOPEN') THEN 'status'
         WHEN feedback_type IN ('RELEVANT', 'IRRELEVANT', 'SHOULD_BE_HIGHER') THEN 'relevance'
         WHEN feedback_type = 'MISCLASSIFIED' THEN 'category' END AS dim
  FROM `meu-projeto.inbox_intelligence.feedback__g1`
), last AS (
  SELECT * FROM f WHERE dim IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY target_type, target_id, dim ORDER BY version_ts DESC) = 1
)
SELECT target_type, target_id, ANY_VALUE(message_id) AS message_id,
  MAX(IF(dim = 'status', IF(feedback_type = 'REOPEN', '', feedback_type), NULL)) AS status,
  MAX(IF(dim = 'relevance', feedback_type, NULL)) AS relevance,
  MAX(IF(dim = 'category', JSON_VALUE(payload_json, '$.correctCategory'), NULL)) AS correct_category,
  MAX(version_ts) AS updated_at
FROM last
GROUP BY target_type, target_id;

-- view/v_inbox
CREATE OR REPLACE VIEW `meu-projeto.inbox_intelligence.v_inbox`
AS
WITH base AS (
SELECT
  m.message_id, m.thread_id, m.rfc822_message_id, m.internal_ts, m.received_date, m.direction,
  m.from_email, m.from_name, m.from_domain, m.to_emails, m.cc_emails, m.user_in_to, m.user_in_cc,
  m.subject, IF(m.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY), NULL, m.snippet) AS snippet, IF(m.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY), NULL, m.body_excerpt) AS body_excerpt,
  IF(m.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY), NULL, m.search_body) AS search_body, IF(m.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY), NULL, m.links_json) AS links_json,
  m.search_meta, m.body_chars, m.is_bulk, m.is_automated, m.has_list_unsubscribe, m.unsubscribe_url, m.list_id,
  m.attachments_json, m.attachment_count, m.auth_pass, m.auth_fail, m.content_hash, m.parse_status,
  m.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY) AS retention_expired,
  COALESCE(s.is_unread, FALSE) AS is_unread, COALESCE(s.is_starred, FALSE) AS is_starred,
  COALESCE(s.is_important, FALSE) AS is_important, COALESCE(s.in_inbox, TRUE) AS in_inbox,
  COALESCE(s.gmail_state, 'ACTIVE') AS gmail_state, s.gmail_category, s.label_ids,
  a.analysis_id, a.method, a.provider, a.model, COALESCE(u.correct_category, a.primary_category) AS primary_category,
  a.primary_category AS model_category, a.secondary_categories, a.topics,
  IF(m.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY) AND a.summary_kind = 'EXTRACTIVE', NULL, a.summary) AS summary, a.summary_kind,
  a.key_facts_json, a.whats_new, a.relevance AS ai_relevance, a.importance AS ai_importance, a.urgency AS ai_urgency,
  a.action_required, a.actions_json, a.deadline_certainty, IF(m.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY), NULL, a.deadline_evidence) AS deadline_evidence,
  a.entities_json, a.opportunity_json, a.opportunity_key, IF(m.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY), NULL, a.evidence_json) AS evidence_json,
  a.evidence_total, a.evidence_verified, a.confidence, a.reason, a.is_newsletter, a.is_marketing, a.is_probable_spam,
  a.sensitive, a.injection_suspected, a.ai_eligible, a.ai_status, a.ai_attempts, a.ai_error, a.features_json,
  a.search_text AS analysis_search, a.version_ts AS analyzed_at,
  sc.score, sc.level, sc.critical_eligible, sc.info_score, sc.relevance AS relevance_axis, sc.urgency AS urgency_axis,
  sc.action AS action_axis, COALESCE(sc.deadline_date, a.deadline_date) AS deadline_date, sc.components_json,
  COALESCE(u.status, '') AS user_status, COALESCE(u.relevance, '') AS user_relevance, u.correct_category
FROM `meu-projeto.inbox_intelligence.v_messages` m
LEFT JOIN `meu-projeto.inbox_intelligence.v_state` s ON s.message_id = m.message_id
LEFT JOIN `meu-projeto.inbox_intelligence.v_analysis` a ON a.message_id = m.message_id
LEFT JOIN `meu-projeto.inbox_intelligence.v_scores` sc ON sc.message_id = m.message_id
LEFT JOIN `meu-projeto.inbox_intelligence.v_user_state` u ON u.target_type = 'MESSAGE' AND u.target_id = m.message_id
WHERE COALESCE(s.gmail_state, 'ACTIVE') NOT IN ('DELETED', 'SPAM', 'TRASHED')
), flagged AS (
  SELECT *, COALESCE(level = 'CRITICAL' AND in_inbox AND user_status NOT IN ('RESOLVED', 'DISMISSED') AND user_relevance != 'IRRELEVANT'
    AND (received_date >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 7 DAY) OR deadline_date >= CURRENT_DATE('America/Sao_Paulo')), FALSE) AS critical_candidate
  FROM base
)
SELECT *,
  CASE WHEN critical_candidate AND ROW_NUMBER() OVER (PARTITION BY critical_candidate ORDER BY score DESC, message_id) <= 3 THEN 'CRITICAL'
       WHEN level = 'CRITICAL' THEN 'HIGH' ELSE level END AS display_level,
  COALESCE(level = 'CRITICAL' AND NOT (critical_candidate AND ROW_NUMBER() OVER (PARTITION BY critical_candidate ORDER BY score DESC, message_id) <= 3), FALSE) AS critical_overflow
FROM flagged;

-- view/v_actions
CREATE OR REPLACE VIEW `meu-projeto.inbox_intelligence.v_actions`
AS
WITH acts AS (
  SELECT i.message_id, i.thread_id, i.internal_ts, i.received_date, i.subject, i.from_name, i.from_email, i.method,
    i.in_inbox, i.user_status, i.display_level, i.score, act, off
  FROM `meu-projeto.inbox_intelligence.v_inbox` i
  CROSS JOIN UNNEST(JSON_QUERY_ARRAY(COALESCE(i.actions_json, '[]'))) AS act WITH OFFSET off
  WHERE i.direction = 'INBOUND' AND COALESCE(i.action_required, FALSE)
    AND NOT COALESCE(i.is_probable_spam, FALSE) AND NOT COALESCE(i.auth_fail, FALSE)
  QUALIFY DENSE_RANK() OVER (PARTITION BY i.thread_id ORDER BY i.internal_ts DESC, i.message_id) = 1
), replies AS (
  SELECT thread_id, MAX(internal_ts) AS last_sent FROM `meu-projeto.inbox_intelligence.v_messages` WHERE direction = 'OUTBOUND' GROUP BY thread_id
)
SELECT
  COALESCE(JSON_VALUE(a.act, '$.id'), CONCAT(a.message_id, ':', CAST(a.off AS STRING))) AS action_id,
  a.message_id, a.thread_id, a.internal_ts, a.received_date, a.subject, a.from_name, a.from_email, a.method,
  JSON_VALUE(a.act, '$.description') AS description,
  JSON_VALUE(a.act, '$.owner') AS owner,
  SAFE_CAST(NULLIF(JSON_VALUE(a.act, '$.due_date'), '') AS DATE) AS due_date,
  JSON_VALUE(a.act, '$.due_certainty') AS due_certainty,
  a.display_level AS priority_level, a.score,
  CASE
    WHEN ua.status IN ('RESOLVED', 'DISMISSED') THEN ua.status
    WHEN ua.status = '' THEN 'OPEN'
    WHEN a.user_status IN ('RESOLVED', 'DISMISSED') THEN a.user_status
    WHEN r.last_sent > a.internal_ts THEN 'AUTO_REPLIED'
    WHEN NOT a.in_inbox THEN 'AUTO_ARCHIVED'
    WHEN SAFE_CAST(NULLIF(JSON_VALUE(a.act, '$.due_date'), '') AS DATE) < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 3 DAY) THEN 'AUTO_EXPIRED'
    WHEN SAFE_CAST(NULLIF(JSON_VALUE(a.act, '$.due_date'), '') AS DATE) IS NULL AND a.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 14 DAY) THEN 'AUTO_STALE'
    ELSE 'OPEN' END AS status
FROM acts a
LEFT JOIN replies r ON r.thread_id = a.thread_id
LEFT JOIN `meu-projeto.inbox_intelligence.v_user_state` ua ON ua.target_type = 'ACTION' AND ua.target_id = COALESCE(JSON_VALUE(a.act, '$.id'), CONCAT(a.message_id, ':', CAST(a.off AS STRING)));

-- view/v_opportunities
CREATE OR REPLACE VIEW `meu-projeto.inbox_intelligence.v_opportunities`
AS
WITH o AS (
  SELECT IF(opportunity_key IS NULL OR opportunity_key = '', CONCAT('msg:', message_id), opportunity_key) AS opp_key,
    message_id, received_date, internal_ts, from_email, opportunity_json, score
  FROM `meu-projeto.inbox_intelligence.v_inbox`
  WHERE opportunity_json IS NOT NULL AND opportunity_json NOT IN ('', 'null') AND direction = 'INBOUND'
)
SELECT o.opp_key,
  ARRAY_AGG(o.opportunity_json ORDER BY o.internal_ts DESC LIMIT 1)[OFFSET(0)] AS latest_json,
  MIN(o.received_date) AS first_seen, MAX(o.received_date) AS last_seen, COUNT(*) AS mentions,
  ARRAY_AGG(o.message_id ORDER BY o.internal_ts DESC LIMIT 20) AS message_ids,
  ARRAY_AGG(DISTINCT o.from_email IGNORE NULLS LIMIT 10) AS sources,
  MAX(o.score) AS best_score,
  ANY_VALUE(u.status) AS user_status
FROM o
LEFT JOIN `meu-projeto.inbox_intelligence.v_user_state` u ON u.target_type = 'OPPORTUNITY' AND u.target_id = o.opp_key
GROUP BY o.opp_key;

-- view/v_runs
CREATE OR REPLACE VIEW `meu-projeto.inbox_intelligence.v_runs`
AS
SELECT * FROM `meu-projeto.inbox_intelligence.runs__g1` WHERE TRUE
QUALIFY ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY version_ts DESC) = 1;

-- view/v_briefings
CREATE OR REPLACE VIEW `meu-projeto.inbox_intelligence.v_briefings`
AS
SELECT * FROM `meu-projeto.inbox_intelligence.briefings__g1` WHERE TRUE
QUALIFY ROW_NUMBER() OVER (PARTITION BY briefing_id ORDER BY version_ts DESC) = 1;
