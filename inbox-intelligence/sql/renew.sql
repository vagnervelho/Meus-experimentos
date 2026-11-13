-- Gerado por scripts/export-sql.js a partir de src/Schema.js e src/Repository.js.
-- Não edite à mão: a fonte da verdade é o código. Projeto de exemplo: meu-projeto.

-- renew/messages
CREATE OR REPLACE TABLE `meu-projeto.inbox_intelligence.messages__g2`
CLUSTER BY message_id
OPTIONS (description = 'Conteúdo imutável de cada mensagem (trechos literais com retenção).', labels = [('app', 'inbox_intel')])
AS
SELECT * REPLACE (
    IF(t.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY), NULL, t.body_excerpt) AS body_excerpt,
    IF(t.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY), NULL, t.snippet) AS snippet,
    IF(t.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY), NULL, t.search_body) AS search_body,
    IF(t.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY), NULL, t.links_json) AS links_json
  )
FROM `meu-projeto.inbox_intelligence.messages__g1` AS t
WHERE t.received_date >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 12 MONTH)
  AND NOT EXISTS (SELECT 1 FROM `meu-projeto.inbox_intelligence.message_state__g1` d WHERE d.message_id = t.message_id AND d.gmail_state = 'DELETED')
QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1;

-- renew/message_state
CREATE OR REPLACE TABLE `meu-projeto.inbox_intelligence.message_state__g2`
CLUSTER BY message_id
OPTIONS (description = 'Snapshot completo do estado no Gmail (labels, lido, estrela, lixeira); uma linha por mudança.', labels = [('app', 'inbox_intel')])
AS
SELECT *
FROM `meu-projeto.inbox_intelligence.message_state__g1` AS t
WHERE DATE(t.version_ts, 'America/Sao_Paulo') >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 12 MONTH)
QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1;

-- renew/analyses
CREATE OR REPLACE TABLE `meu-projeto.inbox_intelligence.analyses__g2`
CLUSTER BY message_id
OPTIONS (description = 'Análise por método (RULES/AI) e versão do classificador. Evidências literais isoladas em evidence_json.', labels = [('app', 'inbox_intel')])
AS
SELECT * REPLACE (
    IF(t.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY), NULL, t.evidence_json) AS evidence_json,
    IF(t.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY), NULL, t.deadline_evidence) AS deadline_evidence,
    IF(t.received_date < DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY) AND t.summary_kind = 'EXTRACTIVE', NULL, t.summary) AS summary
  )
FROM `meu-projeto.inbox_intelligence.analyses__g1` AS t
WHERE t.received_date >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 12 MONTH)
  AND NOT EXISTS (SELECT 1 FROM `meu-projeto.inbox_intelligence.message_state__g1` d WHERE d.message_id = t.message_id AND d.gmail_state = 'DELETED')
QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id, method ORDER BY version_ts DESC) = 1;

-- renew/scores
CREATE OR REPLACE TABLE `meu-projeto.inbox_intelligence.scores__g2`
CLUSTER BY message_id
OPTIONS (description = 'Prioridade vigente e eixos (relevância, urgência, ação). Teto de críticas aplicado na leitura.', labels = [('app', 'inbox_intel')])
AS
SELECT *
FROM `meu-projeto.inbox_intelligence.scores__g1` AS t
WHERE t.received_date >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 12 MONTH)
  AND NOT EXISTS (SELECT 1 FROM `meu-projeto.inbox_intelligence.message_state__g1` d WHERE d.message_id = t.message_id AND d.gmail_state = 'DELETED')
QUALIFY ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version_ts DESC) = 1;

-- renew/feedback
CREATE OR REPLACE TABLE `meu-projeto.inbox_intelligence.feedback__g2`
CLUSTER BY target_id
OPTIONS (description = 'Eventos de feedback do usuário (append-only, trilha de auditoria; nunca expurgados).', labels = [('app', 'inbox_intel')])
AS
SELECT *
FROM `meu-projeto.inbox_intelligence.feedback__g1` AS t
WHERE TRUE
QUALIFY ROW_NUMBER() OVER (PARTITION BY feedback_id ORDER BY version_ts DESC) = 1;

-- renew/runs
CREATE OR REPLACE TABLE `meu-projeto.inbox_intelligence.runs__g2`
CLUSTER BY run_id
OPTIONS (description = 'Execuções do pipeline e da manutenção, com métricas e códigos de erro (sem conteúdo).', labels = [('app', 'inbox_intel')])
AS
SELECT *
FROM `meu-projeto.inbox_intelligence.runs__g1` AS t
WHERE t.version_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
QUALIFY ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY version_ts DESC) = 1;

-- renew/briefings
CREATE OR REPLACE TABLE `meu-projeto.inbox_intelligence.briefings__g2`
CLUSTER BY period
OPTIONS (description = 'Briefings do Radar (persistidos; regravados só quando o conteúdo muda).', labels = [('app', 'inbox_intel')])
AS
SELECT *
FROM `meu-projeto.inbox_intelligence.briefings__g1` AS t
WHERE t.version_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 60 DAY)
QUALIFY ROW_NUMBER() OVER (PARTITION BY briefing_id ORDER BY version_ts DESC) = 1;
