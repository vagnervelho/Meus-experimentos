-- Gerado por scripts/export-sql.js a partir de src/Schema.js e src/Repository.js.
-- Não edite à mão: a fonte da verdade é o código. Projeto de exemplo: meu-projeto.

-- ddl/messages
CREATE TABLE IF NOT EXISTS `meu-projeto.inbox_intelligence.messages__g1` (
  message_id STRING,
  thread_id STRING,
  rfc822_message_id STRING,
  history_id STRING,
  internal_ts TIMESTAMP,
  received_date DATE,
  direction STRING,
  fetch_format STRING,
  from_email STRING,
  from_name STRING,
  from_domain STRING,
  reply_to_email STRING,
  to_emails ARRAY<STRING>,
  cc_emails ARRAY<STRING>,
  recipient_count INT64,
  user_in_to BOOL,
  user_in_cc BOOL,
  subject STRING,
  snippet STRING,
  body_excerpt STRING,
  body_chars INT64,
  body_truncated BOOL,
  has_html BOOL,
  is_forwarded BOOL,
  is_reply BOOL,
  is_bulk BOOL,
  is_automated BOOL,
  has_list_unsubscribe BOOL,
  list_id STRING,
  unsubscribe_url STRING,
  auth_pass BOOL,
  auth_fail BOOL,
  links_json STRING,
  attachments_json STRING,
  attachment_count INT64,
  content_hash STRING,
  search_meta STRING,
  search_body STRING,
  size_estimate INT64,
  parse_status STRING,
  parser_version STRING,
  run_id STRING,
  version_ts TIMESTAMP
)
CLUSTER BY message_id
OPTIONS (description = 'Conteúdo imutável de cada mensagem (trechos literais com retenção).', labels = [('app', 'inbox_intel')]);

-- ddl/message_state
CREATE TABLE IF NOT EXISTS `meu-projeto.inbox_intelligence.message_state__g1` (
  message_id STRING,
  thread_id STRING,
  label_ids ARRAY<STRING>,
  gmail_category STRING,
  is_unread BOOL,
  is_starred BOOL,
  is_important BOOL,
  in_inbox BOOL,
  gmail_state STRING,
  source STRING,
  run_id STRING,
  version_ts TIMESTAMP
)
CLUSTER BY message_id
OPTIONS (description = 'Snapshot completo do estado no Gmail (labels, lido, estrela, lixeira); uma linha por mudança.', labels = [('app', 'inbox_intel')]);

-- ddl/analyses
CREATE TABLE IF NOT EXISTS `meu-projeto.inbox_intelligence.analyses__g1` (
  analysis_id STRING,
  message_id STRING,
  thread_id STRING,
  received_date DATE,
  method STRING,
  provider STRING,
  model STRING,
  classifier_version STRING,
  config_version STRING,
  prompt_version STRING,
  send_policy STRING,
  primary_category STRING,
  secondary_categories ARRAY<STRING>,
  topics ARRAY<STRING>,
  summary STRING,
  summary_kind STRING,
  key_facts_json STRING,
  whats_new STRING,
  relevance INT64,
  importance INT64,
  urgency INT64,
  action_required BOOL,
  actions_json STRING,
  deadline_date DATE,
  deadline_certainty STRING,
  deadline_evidence STRING,
  entities_json STRING,
  opportunity_json STRING,
  opportunity_key STRING,
  evidence_json STRING,
  evidence_total INT64,
  evidence_verified INT64,
  confidence FLOAT64,
  reason STRING,
  is_newsletter BOOL,
  is_marketing BOOL,
  is_probable_spam BOOL,
  sensitive BOOL,
  ai_eligible BOOL,
  injection_suspected BOOL,
  ai_status STRING,
  ai_attempts INT64,
  ai_error STRING,
  features_json STRING,
  redactions_json STRING,
  input_tokens INT64,
  output_tokens INT64,
  cost_usd FLOAT64,
  latency_ms INT64,
  search_text STRING,
  run_id STRING,
  version_ts TIMESTAMP
)
CLUSTER BY message_id
OPTIONS (description = 'Análise por método (RULES/AI) e versão do classificador. Evidências literais isoladas em evidence_json.', labels = [('app', 'inbox_intel')]);

-- ddl/scores
CREATE TABLE IF NOT EXISTS `meu-projeto.inbox_intelligence.scores__g1` (
  message_id STRING,
  analysis_id STRING,
  received_date DATE,
  score FLOAT64,
  level STRING,
  critical_eligible BOOL,
  info_score FLOAT64,
  relevance FLOAT64,
  urgency FLOAT64,
  action FLOAT64,
  deadline_date DATE,
  components_json STRING,
  reason STRING,
  source STRING,
  run_id STRING,
  version_ts TIMESTAMP
)
CLUSTER BY message_id
OPTIONS (description = 'Prioridade vigente e eixos (relevância, urgência, ação). Teto de críticas aplicado na leitura.', labels = [('app', 'inbox_intel')]);

-- ddl/feedback
CREATE TABLE IF NOT EXISTS `meu-projeto.inbox_intelligence.feedback__g1` (
  feedback_id STRING,
  target_type STRING,
  target_id STRING,
  message_id STRING,
  feedback_type STRING,
  payload_json STRING,
  source STRING,
  created_at TIMESTAMP,
  version_ts TIMESTAMP
)
CLUSTER BY target_id
OPTIONS (description = 'Eventos de feedback do usuário (append-only, trilha de auditoria; nunca expurgados).', labels = [('app', 'inbox_intel')]);

-- ddl/runs
CREATE TABLE IF NOT EXISTS `meu-projeto.inbox_intelligence.runs__g1` (
  run_id STRING,
  kind STRING,
  trigger_source STRING,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  status STRING,
  duration_ms INT64,
  stages_json STRING,
  counts_json STRING,
  gmail_units INT64,
  bq_bytes_processed INT64,
  bq_bytes_written INT64,
  ai_requests INT64,
  ai_input_tokens INT64,
  ai_output_tokens INT64,
  ai_cost_usd FLOAT64,
  errors_json STRING,
  checkpoint_json STRING,
  app_version STRING,
  classifier_version STRING,
  version_ts TIMESTAMP
)
CLUSTER BY run_id
OPTIONS (description = 'Execuções do pipeline e da manutenção, com métricas e códigos de erro (sem conteúdo).', labels = [('app', 'inbox_intel')]);

-- ddl/briefings
CREATE TABLE IF NOT EXISTS `meu-projeto.inbox_intelligence.briefings__g1` (
  briefing_id STRING,
  period STRING,
  period_start DATE,
  period_end DATE,
  method STRING,
  provider STRING,
  model STRING,
  content_hash STRING,
  content_json STRING,
  stats_json STRING,
  run_id STRING,
  version_ts TIMESTAMP
)
CLUSTER BY period
OPTIONS (description = 'Briefings do Radar (persistidos; regravados só quando o conteúdo muda).', labels = [('app', 'inbox_intel')]);
