# Contratos entre módulos (desenvolvimento)

Documento interno de engenharia. Define as assinaturas e os formatos de dados que cada módulo de `src/` expõe e consome.
Qualquer mudança aqui precisa ser refletida nos testes.

## Convenções gerais

- **Apps Script V8**, arquivos `.js` em `src/` (o `clasp` envia como `.gs`). Cada arquivo declara **um** namespace: `var Nome = (function () { ... return {...}; })();`.
- **Nunca** referenciar outro namespace em tempo de carga (só dentro de funções). Um teste carrega os arquivos em ordem inversa.
- Funções de topo (fora de namespace) são **somente**: `doGet`, `include`, `api*` (endpoints do cliente), `runPipeline`, `runMaintenance` (triggers), `setup`, `setupTriggers`, `uninstallTriggers`, `runBackfillNow`, `diagnose`. Todas passam por `Auth.assertOwner_()` (exceto triggers, que validam `Session.getEffectiveUser()` vs. dono).
- Sintaxe permitida: ES2019 (sem `?.`, sem `??`, sem `import/export`, sem classes privadas `#x`).
- Datas trafegam como **ISO 8601 string** (timestamps) ou **YYYY-MM-DD** (datas civis no fuso do app: o `timeZone` do manifesto, via `Util.tz()`). Nunca `Date` em retornos para o cliente.
- Textos de interface e justificativas em **pt-BR**.
- Logs: `Monitoring.log(level, event, fieldsSemPII)`. Nunca registrar assunto, corpo, e-mails ou nomes.
- Erros para o cliente: `{ok:false, error:{code, message}}` com mensagem sanitizada (`Util.sanitizeError`).

## Util / Config

Ver `src/Util.js` e `src/Config.js` (já implementados). Pontos de uso:

- `Config.get()` → configuração efetiva (ver `DEFAULTS`).
- `Config.taxonomy()` → `[{id, label, prior, urgencyTrust, noise, sensitive, aiEligible, subcategories, keywords:{strong,weak}, negative, senderDomains, senderPatterns, gmailCategories}]`.
- `Config.secret('projectId'|'anthropicKey'|'geminiKey'|'geminiTier'|'ownerEmail'|'allowEmptyActiveUser'|'bqLocation')`.
- `Config.CLASSIFIER_VERSION`, `Config.PARSER_VERSION`, `Config.configVersion()`.

## MessageParser

`MessageParser.parse(apiMessage, ctx) → ParsedMessage`

- `apiMessage`: objeto da Gmail API `users.messages.get(format=full)` (REST JSON). `body.data` pode vir como string base64url (REST) ou como array de bytes (serviço avançado); os dois devem ser aceitos.
- `ctx`: `{ ownerEmail: string, excerptChars: number, maxDecodedBodyChars: number }`.

```js
ParsedMessage = {
  message_id, thread_id, rfc822_message_id, history_id,          // strings
  internal_ts,                    // ISO (de internalDate ms)
  received_date,                  // YYYY-MM-DD (fuso do app; a view v_messages recalcula de internal_ts)
  direction,                      // 'INBOUND' | 'OUTBOUND' (label SENT ou from == dono)
  from_email, from_name, from_domain, reply_to_email,
  to_emails: [], cc_emails: [],   // e-mails minúsculos
  recipient_count,                // to + cc
  user_in_to, user_in_cc,         // dono aparece em To / Cc
  subject, snippet,
  body_text,                      // texto limpo COMPLETO (só em memória; não persistir)
  body_excerpt,                   // body_text truncado a excerptChars
  body_chars, body_truncated, has_html,
  quoted_removed, signature_removed, footer_removed,
  is_forwarded, is_reply,
  links: [{url, text}],           // ≤ 15, só http(s), sem rastreadores/descadastro
  unsubscribe_url,                // http(s) de List-Unsubscribe ou link do rodapé; '' se não houver
  has_list_unsubscribe, list_id, precedence_bulk,
  is_bulk,                        // sinal de envio em massa (headers + padrões)
  is_automated,                   // noreply/no-reply/notifications/mailer-daemon etc.
  auth_pass, auth_fail,           // de Authentication-Results (spf/dkim/dmarc); null se ausente
  attachments: [{filename, mime_type, size}], attachment_count,
  label_ids: [], gmail_category,  // 'PERSONAL'|'SOCIAL'|'PROMOTIONS'|'UPDATES'|'FORUMS'|''
  is_unread, is_starred, is_important, in_inbox, is_trash, is_spam, is_sent,
  content_hash,                   // sha256(normalizeText(subject + body_text)) 16 chars
  search_text,                    // normalizeText(subject + from_name + from_email + snippet + body_excerpt), ≤ 8000
  size_estimate,
  parser_version
}
```

Funções puras auxiliares exportadas (testáveis): `htmlToText(html)`, `stripQuotes(text) → {text, removed}`, `stripSignature(text) → {text, removed}`, `stripFooter(text) → {text, removed}`, `parseAddressList(header) → [{name, email}]`, `extractLinks(html, text) → [{url,text}]`, `decodeBody(data, charset)`, `isTrackingUrl(url)`.

## Extractors (puras)

- `findDates(text, refYmd) → [{date, time, index, raw, absolute}]`. Reconhece: `dd/mm/aaaa`, `dd/mm/aa`, `dd/mm` (ano inferido: próxima ocorrência ≥ ref − 7 dias), `dd.mm.aaaa`, ISO `aaaa-mm-dd`, `25 de outubro [de 2026]`, `25 out`, `October 25[, 2026]`, `Oct 25`, `25th October`, `hoje`, `amanhã`, `depois de amanhã`, `(até|na|nesta|próxima) segunda…domingo`, `fim do mês`, `fim de semana`, `em N dias`, `today`, `tomorrow`, `by Friday`, `end of (the) week/month`, `EOD`. Hora opcional `às 14h`, `14:30`, `2pm`. `absolute` = data explícita (não relativa).
- `findDeadlines(text, refYmd) → [{date, time, certainty: 'EXPLICIT'|'INFERRED', kind: 'DEADLINE'|'EVENT', evidence, index}]`. Datas com palavra de prazo próxima (até 40 caracteres antes: prazo, até, vence, vencimento, data limite, expira, encerra, inscrições até, deadline, due, by, until, no later than, válido até, responder até) → `DEADLINE`. Datas de agenda (reunião, evento, consulta, voo, check-in, às Xh) → `EVENT`. `EXPLICIT` = palavra de prazo + data absoluta; datas relativas ou palavra fraca → `INFERRED`. Datas no passado distante (< ref − 30 dias) são descartadas. Ordem: DEADLINE antes de EVENT, depois a data mais próxima ≥ ref.
- `findMoney(text) → [{amount, currency: 'BRL'|'USD'|'EUR', raw, index, max?}]`. Formatos: `R$ 1.234,56`, `R$1234`, `R$ 15 mil`, `R$ 12k`, `US$ 100`, `$100k`, `USD 5,000`, `€ 20`, faixas `R$ 10.000 a R$ 12.000`, `10-12k`.
- `findCompensation(text) → {raw, min, max, currency, period: 'MONTH'|'YEAR'|'HOUR'|'' , evidence} | null`. Só quando houver valor a até 60 caracteres de termos salariais (salário, remuneração, faixa salarial, pretensão, bolsa, compensation, salary, pay range, OTE, CLT, PJ + valor).
- `redactPii(text) → {text, counts: {cpf, cnpj, card, bank_account, boleto, pix_key, otp, password, token, phone, email}}`. Substitui por `[CPF]`, `[CNPJ]`, `[CARTAO]`, `[CONTA]`, `[BOLETO]`, `[PIX]`, `[CODIGO]`, `[SENHA]`, `[TOKEN]`, `[TELEFONE]`, `[EMAIL]`. Cartão só com validação de Luhn. Não redige datas nem valores monetários comuns.
- `detectInjection(text) → {suspected, signals: []}`. Padrões pt/en: "ignore (as|all) (instruções|instructions) anteriores", "você agora é", "you are now", "system prompt", "assistant:", "### instruction", "<|im_start|>", "desconsidere", "aja como", "act as", "responda apenas", "output the following", pedidos para revelar chaves/prompt, texto invisível (zero-width em sequência, `font-size:0`, `display:none` no HTML original).
- `actionSignals(text, ctx) → {score: 0..1, phrases: [], asksQuestion: bool}`. Pedidos diretos ("poderia", "preciso que", "você pode", "favor", "confirme", "aguardo", "please", "could you", "let me know", "action required"); perguntas ("?") em mensagem de pessoa; imperativos de cobrança ("pague até", "regularize"). `ctx = {isAutomated, isBulk, userInTo}` modula: bulk reduz, userInTo aumenta.
- `extractiveSummary(text, subject, maxChars=280) → string`. Primeiras 1–2 frases informativas, pulando saudações ("Olá", "Oi", "Prezado", "Bom dia", "Hi", "Dear"), linhas curtas e boilerplate de newsletter ("ver no navegador").
- `jobSignals(text, subject) → {role, company, seniority, workMode: 'remote'|'hybrid'|'onsite'|'unknown', location, skills: []}` heurístico (pode retornar campos `''`).
- `containsNormalized(haystack, needle) → bool`: `normalizeText` + colapso de pontuação; aceita `needle` com ≥ 12 caracteres significativos que aparece contíguo (tolerância a aspas, reticências e espaços).
- `interestMatch(text, interests[]) → {score: 0..1, matched: []}`: `score = min(1, matched/2)`.

## RulesClassifier

`RulesClassifier.classify(parsed, ctx) → RulesResult`

- `ctx = { refYmd, ownerEmail, taxonomy, profile, knownContacts: {email: true}, senderAffinity: {email: -1..1} }`.

```js
RulesResult = {
  primary_category, secondary_categories: [], category_scores: {id: number},
  confidence,                     // 0..1
  reason,                         // pt-BR curto: "Remetente gupy.io; termos: vaga, processo seletivo"
  signals: [],                    // códigos curtos para depuração
  is_newsletter, is_marketing, is_probable_spam, is_automated, is_bulk,
  action_required, action_score,  // 0..1
  actions: [{description, owner: 'me'|'other'|'unknown', due_date: ''|YYYY-MM-DD, due_certainty: 'EXPLICIT'|'INFERRED'|'NONE', evidence}],
  deadline: {date, time, certainty, kind, evidence} | null,
  opportunity: Opportunity | null,
  summary,                        // extrativo
  key_facts: [{fact, evidence}],  // prazos, valores, remuneração, eventos encontrados
  topics: [],                     // interesses casados
  interest_score,                 // 0..1
  entities: [{name, type}],       // remetente (org pelo domínio), empresa da vaga
  sensitive,                      // categoria principal ou secundária sensível
  ai_eligible,                    // pela categoria (marketing/spam com confiança ≥ 0,6 → false)
  injection: {suspected, signals}
}

Opportunity = {
  type: 'job'|'business'|'networking'|'investment'|'event',
  title, company, role, seniority, location,
  work_mode: 'remote'|'hybrid'|'onsite'|'unknown',
  compensation: '' | texto literal do e-mail,
  requirements: [], stage, next_step, deadline: ''|YYYY-MM-DD,
  source: 'recruiter'|'job_board'|'referral'|'network'|'other',
  is_mass: bool,                  // alerta de plataforma (não 1:1)
  fit: 0..1, fit_reasons: [],
  evidence
}
```

`RulesClassifier.opportunityKey(op) → string` = `normalize(company) + '|' + normalize(role)` (sem acentos, sem pontuação, sem palavras genéricas como "vaga", "oportunidade", "para", "de"); vazio se faltar empresa ou cargo.

## AiSchema

- `AiSchema.outputSchema(categoryIds) → JSON Schema` do lote `{items: [Item]}`. Compatível com Claude `output_config.format.json_schema` (todo objeto com `additionalProperties:false` e todos os campos em `required`; sem minimum/maxLength) **e** com Gemini `responseJsonSchema`. Strings vazias `''` representam ausência.
- `AiSchema.validateItem(item, input, categoryIds) → {ok, value: AiAnalysis|null, errors: [], fidelity: {evidence_total, evidence_verified, downgraded: [], dropped: []}}`. `input = {ref, text (o texto enviado), subject, links: [], refYmd}`. Regras: enums válidos; inteiros 1–5; confiança 0–1; truncamentos (summary ≤ 400, reason ≤ 200, listas ≤ limites); `evidence`/`key_facts.evidence`/`actions.evidence` verificadas com `Extractors.containsNormalized(input.text + subject, ev)` (não encontradas → removidas e contadas); `deadline.certainty == EXPLICIT` só se a data (dd/mm, dd de mês ou ISO) aparecer no texto, senão `INFERRED`; datas inválidas → `''`; `opportunity.compensation` só se contiver dígitos presentes no texto, senão `''`; `opportunity.type == 'none'` → `null`.
- `AiSchema.merge(rules, ai) → MergedAnalysis` com a IA prevalecendo em resumo, categorias, importância e entidades, e as regras em: prazo explícito encontrado (se a IA não achou), `is_newsletter`, `is_bulk`, `ai_eligible`, `sensitive`, `injection` (OR).

```js
AiAnalysis = {
  ref, primary_category, secondary_categories: [], topics: [], summary, key_facts: [{fact, evidence}], whats_new,
  relevance, importance, urgency,  // inteiros 1..5
  action_required, actions: [...], deadline: {date, certainty, evidence} | null,
  entities: [{name, type: 'person'|'company'|'organization'|'product'|'place'|'other'}],
  opportunity: Opportunity | null, confidence, reason, evidence: [], injection_suspected
}
```

## AiClient

- `AiClient.status() → {provider: 'anthropic'|'gemini'|'none', model, policy, tier, circuitOpenUntil, budget: {costTodayUsd, costMonthUsd, requestsToday, limits}}`.
- `AiClient.effectivePolicy() → 'OFF'|'BROADCAST'|'REDACTED'|'FULL'`. `auto` → anthropic: `REDACTED`; gemini com `GEMINI_TIER != 'paid'`: `BROADCAST`; gemini pago: `REDACTED`; none: `OFF`.
- `AiClient.allowedByPolicy(parsedOrRow, rules, policy) → {allowed, reason}`. BROADCAST: só `is_bulk` ou `has_list_unsubscribe` ou categoria em {newsletters, noticias, economia, tecnologia, negocios} com remetente automático, e nunca `sensitive`. REDACTED: tudo, menos `sensitive` e `ai_eligible == false`. FULL: tudo, menos `ai_eligible == false`. Mensagens `OUTBOUND` nunca vão.
- `AiClient.analyzeBatch(inputs, opts) → {results: [{ref, ok, analysis, error, fidelity}], usage: {input_tokens, output_tokens, cost_usd, latency_ms, requests}, provider, model}`. `inputs = [{ref, subject, from_name, from_domain, received_date, text (já redigido e truncado), links, thread_context: ''}]`. Faz lotes de até `ai.batchSize`, respeitando `maxBatchInputChars`. Mensagens com `injection_suspected` vão sozinhas. Usa `UrlFetchApp.fetchAll` para paralelizar lotes. Nunca lança por erro de modelo: devolve `ok:false` por item.
- `AiClient.generateBriefing(payload) → {ok, briefing}` (seção Briefing).
- Orçamento: contadores diários e mensais em Script Properties (`AI_USAGE_<yyyy-mm-dd>`, `AI_USAGE_M_<yyyy-mm>`). Ultrapassou → não chama e devolve erro `BUDGET`.
- Circuit breaker: `AI_CIRCUIT_UNTIL` (ISO). 3 falhas consecutivas de transporte/5xx/429 → abre por `circuitCooldownMinutes`. 429 de quota diária (Gemini `RESOURCE_EXHAUSTED` com quota diária) → abre até a meia-noite do Pacífico.
- Claude (HTTP puro, sem SDK, porque o Apps Script não tem SDK oficial): `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2026-10-21`, `content-type: application/json`. Body `{model, max_tokens, system: [{type:'text', text, cache_control:{type:'ephemeral'}}], messages:[{role:'user', content}], output_config:{effort, format:{type:'json_schema', schema}}}`. **Não** enviar `temperature`/`top_p`/`top_k` (400 nessa versão da API). Ler `content[].type=='text'`, `stop_reason` (`refusal`/`max_tokens` → erro do lote) e `usage.input_tokens`/`output_tokens`/`cache_read_input_tokens`.
- Gemini: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, header `x-goog-api-key`. Body `{systemInstruction:{parts:[{text}]}, contents:[{role:'user', parts:[{text}]}], generationConfig:{responseMimeType:'application/json', responseJsonSchema: schema, maxOutputTokens, thinkingConfig:{thinkingLevel}}}`. Ler `candidates[0].content.parts[].text`, `finishReason`, `usageMetadata.promptTokenCount`/`candidatesTokenCount`/`thoughtsTokenCount`.

## Scoring

- `Scoring.features(parsed, merged, ctx) → Features` com `ctx = {profile, knownContacts, senderAffinity, cfg}`.

```js
Features = {
  category, isNoise, confidence,
  importance,            // 0..1
  deadline: {date, certainty} | null,
  urgencyNoDeadline,     // 0..1 (IA ou pistas) × noDeadlineUrgencyFactor
  urgencyTrust,          // da categoria
  action,                // 0..1
  opportunity,           // 0..1
  sender, senderKind,    // 0..1, 'priority'|'knownContact'|'human'|'automated'
  isPrioritySender,
  novelty, interest, reliability,  // 0..1
  noise                  // multiplicador da categoria
}
```

- `Scoring.compute(features, cfg, todayYmd) → {score, level: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW', components: [{key, label, value, weight, contribution, why}], gate: {critical: bool, reasons: []}, info_score, urgency}`. Pura e determinística. As justificativas `why` vêm em pt-BR ("Prazo explícito em 2 dias", "Remetente prioritário").
- `Scoring.applyDailyCap(items, cap, alreadyCriticalByDay) → items` rebaixa as críticas excedentes de um mesmo `received_date` para `HIGH` (as de maior score ficam), com componente `cap` e justificativa "Limite diário de críticas atingido".
- `Scoring.readingSeconds(bodyChars, wpm)` e `Scoring.timeSavedSeconds(rows, cfg)`: estimativa documentada na interface.

## BigQueryClient

- `BigQueryClient.query(sql, params, opts) → {rows: [object], totalBytesProcessed, cacheHit, jobId}`. `params`: objeto `{nome: valor}`, com tipos inferidos (string → STRING; inteiro → INT64; não inteiro → FLOAT64; boolean → BOOL; `{type:'DATE', value}`; array de strings → `ARRAY<STRING>`; array de inteiros → `ARRAY<INT64>`). Sempre `useLegacySql:false`, `parameterMode:'NAMED'`, `maximumBytesBilled`, `labels:{app:'inbox_intel', query_name}`, `location`, `timeoutMs`. Faz polling de `getQueryResults` até `jobComplete` e pagina até `opts.maxRows`. Converte células conforme o schema (INT64/FLOAT64 → number, BOOL → boolean, TIMESTAMP → ISO string, REPEATED → array, RECORD → objeto, JSON → string).
- `BigQueryClient.loadNdjson(tableId, rows, opts) → jobRef` (assíncrono) e `BigQueryClient.waitJobs(jobRefs, budget) → [{ok, error, outputBytes, outputRows}]`. Para cada load, soma `outputBytes` ao contador vitalício `BQ_BYTES_WRITTEN`.
- `BigQueryClient.ddl(sql) → result` (query sem parâmetros; sem cache).
- `BigQueryClient.tableInfo(tableId) → {exists, creationTime, expirationTime, numBytes, numRows}`.
- Erros: `BigQueryError {code, reason, message}` com `Util.sanitizeError`.

## Schema

- `Schema.tables()` → `[{name, columns: [{name, type, mode}], clusterBy: [], description}]` para `messages`, `message_state`, `analyses`, `scores`, `feedback`, `runs`, `briefings`.
- `Schema.createTableSql(name, gen)`, `Schema.viewSql(viewName, gens)`, `Schema.allViews()`.
- Nomes físicos: `<dataset>.<tabela>__g<N>`; views: `<dataset>.v_<nome>`. A geração vigente fica em Script Properties `BQ_GENERATIONS` (JSON `{messages: 1, ...}`).

## Repository

Todas as consultas ficam num catálogo `Repository.QUERIES = {nome: sqlTemplate}`, onde `${ds}` é substituído pelo dataset com crases. Um teste exporta todas e passa pelo parser BigQuery. Parâmetros são **sempre** `@nome`; nunca há concatenação de entrada do usuário.

- Escrita: `saveIngest({messages, states, analyses, scores}) → {ok, jobs}`, `saveAnalyses({analyses, scores})`, `saveStates(states)`, `saveRun(run)`, `saveFeedback(event)`, `saveBriefing(b)`.
- Leitura (pipeline): `existingMessageIds(ids) → {id: true}`, `pendingAi({limit, sinceYmd, minAnalyzedBefore}) → [row]`, `threadContext(threadIds) → {thread_id: summary}`, `knownContacts() → {email: true}`, `senderAffinity() → {email: number}`, `rescoreCandidates(todayYmd) → [row]`, `criticalCountsByDay(days[]) → {ymd: n}`.
- Leitura (UI): `radar(period)`, `inboxPage(filters, sort, page, pageSize)`, `messageDetail(id)`, `tasks(status)`, `opportunities(status)`, `senders(period)`, `search(terms, filters, page)`, `systemStatus()`.

## Payloads da interface (google.script.run)

Todos retornam `{ok: true, data, meta: {generatedAt, cached: bool, demo: false}}` ou `{ok: false, error: {code, message}}`.

- `apiBootstrap()` → `{user: {email}, app: {version, timeZone}, ai: {provider, model, policy}, setup: {ok, missing: []}, lastSync: {at, status}, settingsSummary}`
- `apiGetRadar({period: 'today'|'7d'|'30d'})` → `{period: {start, end, label}, briefing: {headline, bullets: [{text, refs: [message_id]}], method: 'AI'|'RULES', generatedAt}, kpis: {received, receivedPrev, attention, attentionPrev, actions, opportunities, newsletters, noisePct, timeSavedMin}, attention: [Item], deadlines: [Task], opportunities: [Opp], news: [Item], topics: [{topic, count, delta}], sinceLastVisit: {count, since}, sync: {lastSuccessAt, status, pending, aiPending}}`
- `Item = {id, threadId, subject, from: {name, email, domain}, date, category, categoryLabel, secondary: [], summary, priority: {score, level, top: [{label, why}]}, action: bool, deadline: {date, certainty} | null, unread, starred, confidence, gmailUrl, gmailSearchUrl, userStatus: ''|'RESOLVED'|'SAVED'|'IRRELEVANT'|'RELEVANT', method: 'AI'|'RULES', injection: bool}`
- `apiListMessages({filters: {categories: [], levels: [], action: bool|null, hasDeadline: bool|null, unread: bool|null, period: '7d', from: '', q: '', status: ''}, sort: 'priority'|'date'|'deadline', page: 1, pageSize: 30})` → `{items: [Item], total, page, pageSize}`
- `apiGetMessage({id})` → `Item + {to: [], cc: [], excerpt: ''|null (retido), excerptHidden: bool, facts: [{fact, evidence}], whatsNew, entities: [], topics: [], evidence: [], reason, components: [{key, label, value, weight, contribution, why}], actions: [Task], opportunity: Opp|null, links: [{url, text}], attachments: [{filename, mime_type, size}], fidelity: {total, verified}, history: [{method, model, at}]}`
- `Task = {id, messageId, description, owner, dueDate, dueCertainty, priorityLevel, status: 'OPEN'|'DONE'|'DISMISSED', createdAt, source: 'AI'|'RULES', subject, from}`
- `Opp = {key, title, company, role, seniority, location, workMode, compensation, stage, nextStep, deadline, fit, fitReasons: [], firstSeen, lastSeen, mentions, messageIds: [], sources: [], status: 'OPEN'|'SAVED'|'DISMISSED'}`
- `apiSubmitFeedback({targetType: 'MESSAGE'|'ACTION'|'OPPORTUNITY', targetId, type: 'RELEVANT'|'IRRELEVANT'|'RESOLVED'|'SAVED'|'MISCLASSIFIED'|'REOPEN'|'DISMISSED', payload: {correctCategory?}})` → `{saved: true}`
- `apiListTasks({status: 'OPEN'|'DONE'|'ALL'})` → `{items: [Task]}`
- `apiListOpportunities({status})` → `{items: [Opp]}`
- `apiGetSenders({period: '30d'|'90d'})` → `{items: [{email, name, domain, count, countPrev, categories: [{id, n}], avgScore, highShare, unreadShare, noiseScore, suggestion: ''|'FILTER'|'UNSUBSCRIBE', unsubscribeUrl}]}`
- `apiSearch({q, filters, page})` → `{items: [Item], total, terms: []}`
- `apiGetSystemStatus()` → `{runs: [{runId, startedAt, finishedAt, status, trigger, counts, durationMs, errors: []}], health: {lastSuccessAt, lagMinutes, errorRate24h, avgDurationMs}, pending: {ingestedNoAi, failed}, quotas: {gmailUnitsLastRun, urlFetchToday, triggerMinutesToday, bqBytesWrittenLifetime, bqLifetimeLimit, bqQueryBytesMonth}, ai: AiClient.status(), triggers: [{handler, type}], tables: [{name, generation, ageDays, expiresInDays, rows}], backfill: {done, cursorDate, floorDate}}`
- `apiGetSettings()` → `{config: {...editável}, secrets: {projectId: bool, anthropicKey: bool, geminiKey: bool}}`
- `apiSaveSettings({patch})` → `{saved, errors: []}`
- `apiRunSyncNow()` → `{scheduled: true}` (trigger único em ~1 min; nunca roda o pipeline dentro da chamada do Web App)
- `apiMarkVisit()` → `{previousVisitAt}`

## Payloads v2 (vigente — substitui os itens equivalentes acima)

Envelope de **todas** as chamadas `google.script.run.apiX(req)`:
`{ok: true, data, meta: {generatedAt: ISO, cached: bool}}` ou `{ok: false, error: {code, message}}` (`code` ∈ CONFIG, AUTH, DENIED, VALIDATION, QUOTA, RATE, TIMEOUT, UPSTREAM, QUERY_FAILED, NOT_FOUND, INTERNAL).

```js
Item = {
  id, threadId, subject, from: {name, email, domain}, date /* ISO */, receivedDate /* YYYY-MM-DD */,
  category, categoryLabel, secondary: [{id, label}], summary, summaryKind: 'ABSTRACTIVE'|'EXTRACTIVE'|'',
  priority: {score /* 0..1 */, level: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW', top: [{label, why}],
             axes: {relevance, urgency, action} /* 0..1 */, overflow: bool /* crítica rebaixada pelo teto diário */},
  action: bool, deadline: {date, certainty: 'EXPLICIT'|'INFERRED'} | null,
  unread, starred, confidence /* 0..1 */, gmailUrl, gmailSearchUrl,
  userStatus: ''|'RESOLVED'|'SAVED'|'DISMISSED', userRelevance: ''|'RELEVANT'|'IRRELEVANT'|'SHOULD_BE_HIGHER',
  method: 'AI'|'RULES', injection: bool, authFail: bool
}
Task = {id, messageId, threadId, description, owner: 'me'|'other'|'unknown', dueDate: ''|YYYY-MM-DD, dueCertainty, priorityLevel,
        status: 'OPEN'|'RESOLVED'|'DISMISSED'|'AUTO_REPLIED'|'AUTO_ARCHIVED'|'AUTO_EXPIRED'|'AUTO_STALE', statusLabel,
        subject, from: {name, email}, receivedDate, method, gmailUrl}
Opp  = {key, type, title, company, role, seniority, location, workMode, compensation, stage, nextStep, deadline, fit /* 0..1 */,
        fitReasons: [], isMass: bool, firstSeen, lastSeen, mentions, messageIds: [], sources: [], status: ''|'SAVED'|'DISMISSED', gmailUrl}
```

| Endpoint | Requisição | `data` |
|---|---|---|
| `apiBootstrap()` | — | `{user: {email}, app: {version, timeZone: IANA do manifesto (padrão America/Sao_Paulo)}, ai: AiInfo, setup: {ok, missing: [string]}, lastSync: {at, status} \| null, categories: [{id, label}], ui: {pageSize, defaultPeriod}, previousVisitAt: ISO\|''}` |
| `apiGetRadar(req)` | `{period: 'today'\|'7d'\|'30d'}` | `{period: {start, end, label}, briefing: {headline, bullets: [{text, refs: [id]}], method: 'AI'\|'RULES', generatedAt}, kpis: {received, receivedPrev, attention, attentionPrev, actions, actionsPrev, opportunities, newsletters, noisePct, rulesOnly, triage: {count, minMinutes, maxMinutes, formula}}, attention: [Item], tasks: [Task], opportunities: [Opp], news: [Item], topics: [{topic, count}], categories: [{id, label, count, countPrev}], sinceLastVisit: {count, since}, sync: SyncInfo}` |
| `apiListMessages(req)` | `{filters: {categories: [], levels: [], action: ''\|'yes'\|'no', deadline: ''\|'yes'\|'no', unread: ''\|'yes'\|'no', period: '7d'\|'30d'\|'90d'\|'365d', sender: '', status: ''\|'OPEN'\|'RESOLVED'\|'SAVED'\|'DISMISSED'}, sort: 'priority'\|'date'\|'deadline'\|'relevance'\|'urgency', page: 1, pageSize: 30}` | `{items: [Item], page, pageSize, hasMore}` |
| `apiGetMessage(req)` | `{id}` | `Item & {to: [], cc: [], excerpt: string\|null, excerptHidden: bool /* retenção expirou */, facts: [{fact}], whatsNew, entities: [{name, type}], topics: [], evidence: {facts: [], actions: [], classification: [], opportunity}, reason, components: [{key, label, value, weight, contribution, why}], actions: [Task], opportunity: Opp\|null, links: [{url, text}], attachments: [{filename, mime_type, size}], fidelity: {total, verified}, unsubscribeUrl, history: [{method, provider, model, at}], parseStatus}` |
| `apiSubmitFeedback(req)` | `{targetType: 'MESSAGE'\|'ACTION'\|'OPPORTUNITY', targetId, messageId?, type: 'RELEVANT'\|'IRRELEVANT'\|'SHOULD_BE_HIGHER'\|'RESOLVED'\|'SAVED'\|'DISMISSED'\|'REOPEN'\|'MISCLASSIFIED', payload: {correctCategory?}}` | `{saved: true, pending: n /* aplicado na próxima sincronização */}` |
| `apiListTasks(req)` | `{status: 'OPEN'\|'DONE'\|'ALL'}` | `{items: [Task]}` |
| `apiListOpportunities(req)` | `{status: 'OPEN'\|'SAVED'\|'DISMISSED'\|'ALL'}` | `{items: [Opp]}` |
| `apiGetNews(req)` | `{period: '7d'\|'30d'}` | `{items: [Item], topics: [{topic, count}]}` |
| `apiGetSenders(req)` | `{period: '30d'\|'90d'}` | `{items: [{email, name, domain, count, countPrev, categories: [{id, label, n}], avgScore, highShare, unreadShare, massShare, noiseScore, suggestion: ''\|'FILTER'\|'UNSUBSCRIBE'\|'PRIORITY', suggestionWhy, unsubscribeUrl, allAuthPass}]}` |
| `apiSearch(req)` | `{q, page: 1}` (operadores: `de:x`, `categoria:x`, `"frase exata"`) | `{items: [Item], terms: [], hasMore, page}` |
| `apiGetSystemStatus()` | — | `{runs: [{runId, kind, trigger, startedAt, finishedAt, status, durationMs, counts: {} /* inclui duplicates_avoided, ingested, to_fetch... */, stagesMs: {etapa: ms}, errors: [{code, module}], aiCostUsd, aiRequests, gmailUnits}], health: {lastSuccessAt, lagMinutes, fails24h, runs24h, avgMs, aiCost30d, aiRequests30d}, pending: {total, aiDone, aiPending, aiFailed, quarantined, unclassified, criticalToday, highShare7d, oldest, newest}, aiQuality: {analyzed30d, costUsd30d, costPer1000Usd, avgLatencyMs, evidenceVerifiedRate} | null, quality: [{category, label, n, irrelevant, corrected, shouldBeHigher}], agreement: {n, agree, rate}, quotas: {triggerMinutes24h, triggerBudgetMin, bqBytesWrittenLifetime, bqLifetimeLimit, bqQueryBytesMonth, aiUsage: {today: {cost, req}, month: {cost, req}}}, ai: AiInfo, triggers: [{handler, type}], tables: [{name, physical, generation, ageDays, expiresInDays, rows, bytes}], sync: SyncInfo}` |
| `apiGetSettings()` | — | `{config: {profile, ai: {provider, sendPolicy, maxCostUsdPerDay, maxCostUsdPerMonth, maxRequestsPerRun, backfillDays}, scoring: {criticalDailyCap}, storage: {excerptRetentionDays}, gmail: {accountIndex, backfillDays}, ui: {pageSize, defaultPeriod}}, secrets: {projectId, anthropicKey, geminiKey}, categories: [{id, label}], prioritySuggestions: [{email, n}]}` |
| `apiSaveSettings(req)` | `{patch}` (mesmas chaves de `config`) | `{saved: bool, errors: [string]}` |
| `apiSetAiConsent(req)` | `{policy: 'OFF'\|'BROADCAST'\|'REDACTED'\|'FULL', accept: bool}` | `AiInfo` |
| `apiAiDryRun(req)` | `{policy}` | `{policy, provider, total, allowed, blocked: {motivo: n}, byCategory: {id: n}, sample: {subject, from, text, redactions: {}} \| null}` |
| `apiRunSyncNow()` | — | `{scheduled: bool, at: ISO, reason: ''}` |
| `apiMarkVisit()` | — | `{previousVisitAt: ISO\|''}` |
| `apiGetQualitySample()` | — | `{items: [Item]}` (amostra cega de Média/Baixa para avaliação) |

`AiInfo = {provider: 'anthropic'|'gemini'|'none', model, policy /* efetiva */, requestedPolicy, allowedPolicies: [], consent: {given, policy, provider, at} | null, circuitOpenUntil: ISO|'', budget: {today: {cost, req}, month: {cost, req}, limits: {costDay, costMonth}}}`
`SyncInfo = {lastSuccessAt: ISO|'', lastStatus, backfill: {done, cursorDate, floorDate} | null, windows: n, quarantined: n}`

## Adendo de qualidade e segurança (vigente)

- **MessageParser:** `direction = 'OUTBOUND'` **somente** com label `SENT` (um From forjado do dono chega como INBOUND). Novos campos só de memória: `hidden_text` (≤ 2000 chars do HTML oculto — `display:none`, `font-size:0` etc. — para detectar instruções escondidas; nunca persistido) e `is_discussion_list` (Google Groups e similares: conversa humana, não newsletter).
- **Extractors:** `findDeadlines` pode devolver `kind: 'VALIDITY'` (validade de promoção, link, código ou SLA de terceiro), que **nunca** é prazo do dono; `detectInjection(text, opts)` ignora padrões citados entre aspas; `redactPii` cobre também RG, CNH, nascimento, endereço, CEP, IP, placa, códigos de verificação em qualquer ordem e tokens em parâmetros de URL.
- **RulesClassifier:** devolve também `untrusted` (bool), `spoof_signals` (`AUTH_FAIL`, `BRAND_DOMAIN_MISMATCH`, `DISPLAY_NAME_IMPERSONATION`, `REPLY_TO_MISMATCH`, `FREEMAIL_EXECUTIVE`…) e `severity` (0..1). Mensagem não confiável não tem ações nem prazo.
- **AiSchema.merge:** suspeita de injection limita a confiança a 0,5 e descarta importância/urgência/relevância da IA; ação da IA só vale fora de envio em massa ou em categoria transacional; repassa `untrusted`/`spoof_signals`/`severity`.
- **Scoring:** `untrusted` ou injection limitam nível **e** score a Média; "irrelevante" limita o score a Baixa; `severity` soma bônus de importância.
- **AiClient.allowedByPolicy:** categorias com `aiEligible: false` (ex.: segurança da conta) bloqueiam em **todas** as políticas, inclusive FULL e quando secundárias; mensagens `untrusted` e listas de discussão nunca saem.
- **Feedback:** novo tipo `LEVEL_OK` ("está ok" na amostra cega; não altera score; é o denominador da taxa de falso negativo). `apiGetSystemStatus` devolve `blindReview: {judged, shouldBeHigher, rate}`.
- **Repository:** resumo, fatos, ações, oportunidade e evidências são gravados com PII redigida (o corpo completo nunca é persistido).
