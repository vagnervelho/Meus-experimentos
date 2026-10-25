# Inbox Intelligence — Plano Técnico

> **Versão 3** — 24/10/2026. Infraestrutura em **nuvem Google gratuita, custo adicional zero**.
> Projeto pessoal, sem vínculo com infraestrutura corporativa.
> Fatos de plataforma pesquisados em fontes oficiais. A seção 17 lista o que **não** pôde ser verificado daqui e precisa ser confirmado no primeiro deploy.

---

## 0. Resumo executivo

| | |
|---|---|
| **O que é** | Central de inteligência pessoal sobre o Gmail. Lê a caixa em modo **somente leitura**, classifica, resume, extrai prazos, tarefas e oportunidades, prioriza de forma explicável e apresenta tudo num Web App responsivo. |
| **Onde roda** | Na sua conta Google: **Apps Script** (backend, agendamentos, Web App) + **BigQuery Sandbox** (banco, sem cartão). IA opcional por **Claude API** (créditos do Max) ou **Gemini API free tier**. |
| **Custo** | **R$ 0/mês.** Nenhum componente exige cartão. Uso estimado: < 10% de qualquer limite gratuito (seção 13). |
| **Somente leitura** | Escopo `gmail.readonly`. **Nunca** `GmailApp` (que exige `mail.google.com`, acesso total). Nenhum envio, exclusão, arquivamento ou rótulo. Um teste estático garante isso. |
| **Funciona sem IA** | Um motor de regras determinístico em pt-BR classifica e extrai prazos, valores, ações e oportunidades. A IA enriquece (resumo, fatos, entidades), mas não é pré-requisito. |
| **Entrega desta fase** | Fase 1 completa, ponta a ponta (seção 14). |

### O que você já paga e como entra

| Assinatura | Uso | Detalhe |
|---|---|---|
| **Claude Max** (5x/20x) | ✅ **Melhor IA a custo zero** | Inclui **US$ 100–200/mês de créditos de API**, sem cartão; as requisições param quando o crédito acaba, sem cobrança. Os termos comerciais **proíbem treino** com os dados. Basta gerar uma API key no Console e salvar em *Propriedades do script*. |
| **Claude Pro** | Só desenvolvimento | O Pro **não** inclui créditos de API. Usar a assinatura (OAuth/`claude -p`) a partir de um servidor é **vedado** pelos termos. |
| **Google AI Pro** | Opcional, não usado por padrão | Inclui US$ 10/mês de crédito Google Cloud, mas exige cartão + conta de faturamento (+ depósito mínimo de US$ 5 na Gemini API), e a elegibilidade no Brasil não está confirmada. **Não entra** no caminho de custo zero. |
| **Google One** | Não necessário | — |

### Decisões que mudaram em relação ao prompt original

1. **BigQuery Sandbox**:
   - **sem DML** (INSERT/UPDATE/MERGE), tabelas e views **expiram em 60 dias** e há **cota vitalícia de 10 GiB**;
   - o desenho é append-only via *load jobs* (gratuitos), com views de "versão vigente" e renovação de tabelas por geração (seção 6);
   - funciona igual se um dia você habilitar o faturamento.
2. **Sem `GmailApp`**: só a Gmail API (serviço avançado + REST paralelo).
3. **IA com política de envio**:
   - o **free tier do Gemini** usa o conteúdo para treino, pode ter revisão humana e os termos dizem *"Do not submit sensitive, confidential, or personal information to the Unpaid Services"*. Com Gemini free, só conteúdo de massa vai para a IA (newsletters, alertas, notícias), nunca correspondência pessoal;
   - com **Claude API** (termos comerciais, sem treino), vai tudo exceto categorias sensíveis, com PII redigida.
4. **Vertex AI descartado**: exige faturamento e o escopo amplo `cloud-platform`.

---

## 1. Premissas

- Conta `gmail.com`, ~50 e-mails/dia, histórico inicial de 90 dias (≈ 4.500 mensagens).
- pt-BR, formatos brasileiros, fuso do manifesto (`America/Porto_Velho` para o dono; padrão `America/Sao_Paulo`).
- Mantidos do prompt original: Apps Script + BigQuery, nada de Sheets como banco, incremental, sem IA a cada abertura, sem ações destrutivas, Web App não público.

## 2. Investigação do ambiente (Fase Zero)

| Item | Achado | Consequência |
|---|---|---|
| Repositório | Coleção de notebooks Python de estudo. Nada de Apps Script, BigQuery ou e-mail. | Projeto novo e isolado em `inbox-intelligence/`. Nada existente é alterado. |
| Ambiente desta sessão | MicroVM na nuvem da Anthropic (Ubuntu 24.04, 4 vCPU, 15 GB, sem GPU). **Não é o seu computador.** | Desenvolvo e testo aqui. Você faz o deploy pelo navegador (ou com `clasp`, opcional). |
| Credenciais Google | Nenhuma: `gcloud` sem conta e conector BigQuery indisponível. O conector Gmail da sessão só expõe ferramentas de escrita, por isso **não foi usado**. | Não há como testar contra o seu Gmail/BigQuery reais daqui. A integração real é validada no primeiro deploy (checklist na seção 16). |
| Rede | `developers.google.com`, `ai.google.dev` e `docs.cloud.google.com` estão bloqueados pelo proxy desta sessão. | Fatos confirmados por *discovery documents* oficiais (Gmail v1, BigQuery v2, Gemini v1beta), páginas de preço e termos acessíveis, e snippets de busca. Cada fato está marcado com a confiança e o que ficou pendente (seção 17). |
| Ferramentas locais | Node 22, Python 3.13, Playwright + Chromium, `@types/google-apps-script`, `sqlglot` (parser SQL, dialeto BigQuery). | Validação em quatro camadas: (1) testes unitários/integração com mocks fiéis das APIs do Apps Script; (2) typecheck contra os tipos oficiais; (3) parse de todo o SQL no dialeto BigQuery; (4) testes visuais e de acessibilidade da UI. |

## 3. Custos e limites (fatos)

| Componente | Limites relevantes | Fonte / confiança |
|---|---|---|
| Apps Script (consumer) | 6 min/execução; **90 min/dia de triggers** (compartilhados entre os seus projetos); 20.000 UrlFetch/dia; 20 triggers/script; Properties 9 KB/valor e 500 KB/store; Cache 100 KB/chave e 6 h | Página oficial de quotas (via snippet + rastreador comunitário diário) — média/alta |
| Gmail API (projetos criados após 01/05/2026) | **6.000 unidades/usuário/min**; `messages.get` full = **60 un.**; `history.list` = 2; `messages.list` = 5; histórico normalmente válido por ≥ 1 semana (404 → resync completo) | Discovery doc oficial (alta) + página de quota via snippet (média) |
| BigQuery Sandbox | 1 TiB de query/mês; **10 GiB de storage vitalício (não devolvido ao apagar)**; **sem DML, sem streaming, sem scheduled queries**; tabelas e views expiram em 60 dias; expiração só pode ser estendida até criação + 60 d; *load jobs* gratuitos e permitidos; mínimo de 10 MB faturados por tabela referenciada | Página do sandbox via snippet (alta) + evidência de pipelines em produção (média) |
| Claude API | `claude-opus-5-5`: US$ 4 / US$ 20 por 1M tokens (entrada/saída); `claude-haiku-5-5`: US$ 0,10 / US$ 0,50. Header `anthropic-version: 2026-10-21`; `temperature`/`top_p`/`top_k` agora retornam 400; saída estruturada via `output_config.format` | Referência oficial da API (alta) |
| Gemini API free tier | `gemini-3.5-flash-lite` (GA): ~15 RPM / ~500 RPD (medição de terceiros — **confirmar no AI Studio**); reset à meia-noite do Pacífico; *"used to improve our products"* | Média/baixa para os números |

**Custo estimado da IA no seu volume** (~1.050 e-mails elegíveis/mês com Claude; entrada ~1.000 tokens e saída ~400 tokens por e-mail, incluindo raciocínio em esforço `low`):

| Modelo | Por e-mail | Mês regime | Backfill (30 dias de IA) | Coberto por |
|---|---|---|---|---|
| `claude-opus-5-5` (padrão) | ≈ US$ 0,012 | ≈ US$ 13 | ≈ US$ 13 | Créditos Max (≥ US$ 100/mês) |
| `claude-haiku-5-5` (opção) | ≈ US$ 0,0003 | ≈ US$ 0,32 | ≈ US$ 0,32 | Créditos Max |
| `gemini-3.5-flash-lite` free | US$ 0 | US$ 0 | US$ 0 | Free tier (só conteúdo de massa) |

Há um teto de custo configurável (padrão **US$ 30/mês e US$ 3/dia**) e circuit breaker. O app nunca ultrapassa o teto que você definir.

## 4. Arquitetura

```
 Gmail (fonte da verdade)
   ▲ gmail.readonly
   │
 Apps Script ── trigger horário: runPipeline() ─────────────────────────────────────────┐
   │  1. Lock + orçamento de tempo (≤ 4,5 min) + heartbeat                              │
   │  2. Sync incremental: history.list desde historyId (404 → resync por janela)       │
   │  3. Backfill por janelas de 7 dias até 90 dias, com checkpoint em Properties       │
   │  4. Dedup contra o BigQuery (IDs já ingeridos) → "duplicidades evitadas"           │
   │  5. messages.get em paralelo (UrlFetchApp.fetchAll, limitador de unidades/min)     │
   │  6. Parser: MIME, charset, HTML→texto, citações/assinaturas/rodapés, links         │
   │  7. Regras pt-BR: categorias, prazos, valores, ações, oportunidades, ruído         │
   │  8. IA (fila priorizada, política de envio, PII redigida, lotes, schema,           │
   │     verificação de fidelidade, circuit breaker, teto de custo)                     │
   │  9. Ranking explicável (determinístico)                                            │
   │ 10. Load jobs NDJSON paralelos → BigQuery (append-only, idempotente)               │
   │ 11. Briefing do Radar (persistido) + métricas da execução                          │
   │                                                                                    │
   ├─ trigger diário: runMaintenance() — reescore de prazos, renovação de tabelas       │
   │   (geração), views, retenção, saúde, cota vitalícia                                │
   │                                                                                    │
   └─ Web App (HtmlService · executeAs=USER_DEPLOYING · access=MYSELF)                  │
        google.script.run → api*() → SQL parametrizado, paginado, cacheado ────────────┘
                 │                                │
                 ▼                                ▼
        BigQuery Sandbox                  Claude API  ou  Gemini API
        dataset inbox_intelligence        (só o que a política de envio permite)
```

### 4.1 Princípios

- **Gmail é a fonte da verdade.** Tudo no BigQuery pode ser reconstruído relendo o Gmail pelo `message_id`, que é estável. Isso é essencial dado o sandbox, onde as tabelas expiram.
- **Regras sempre, IA quando possível.** Toda mensagem recebe classificação determinística. A IA só enriquece e nunca bloqueia o pipeline.
- **Append-only + "versão vigente".** Reexecuções nunca duplicam resultados: as views escolhem a última versão por chave.
- **Leitura barata.** Uma consulta consolidada por tela, cacheada no `CacheService` e invalidada por execução do pipeline. Abrir o painel não chama IA nem lê o Gmail.

### 4.2 Módulos (Apps Script V8)

Convenção de segurança: todo helper interno fica dentro de um namespace (`var Modulo = (function(){…})()`). Só os endpoints `api*`, `doGet`, handlers de trigger e `setup*` ficam no topo, e todos verificam autorização. Nenhum módulo referencia outro em tempo de carga; um teste carrega os arquivos em ordem inversa para provar isso.

| Arquivo | Responsabilidade |
|---|---|
| `appsscript.json` | Escopos explícitos mínimos, serviços avançados, Web App `MYSELF`, `urlFetchWhitelist` |
| `Code.js` | `doGet`, `include`, endpoints `api*` (guarda de dono, validação de entrada, erros sanitizados) |
| `Config.js` | Padrões (taxonomia, palavras-chave, pesos, limites), overrides fatiados em Properties, validação, versão (hash) |
| `Util.js` | Fuso BR, hashing, retry/backoff/jitter, orçamento de tempo, normalização, sanitização |
| `GmailClient.js` | Perfil, histórico, listagem, `messages.get` paralelo com limitador de unidades |
| `MessageParser.js` | API → registro normalizado (headers, MIME, charset, HTML→texto, limpeza, links, anexos, sinais) |
| `Extractors.js` | Funções puras pt-BR/en: prazos, datas, valores, remuneração, PII, prompt injection, frases de ação |
| `RulesClassifier.js` | Taxonomia × sinais → categorias, flags, ação, oportunidade, elegibilidade para IA |
| `AiClient.js` | Provedores Claude (Messages API) e Gemini (generateContent): lotes, schema, uso/custo, quotas, circuit breaker |
| `AiSchema.js` | Validação do JSON, checagens de fidelidade, merge IA + regras |
| `Scoring.js` | Componentes, pesos, níveis, teto diário de críticas, justificativas |
| `BigQueryClient.js` | Query parametrizada (`maximumBytesBilled`, polling, paginação), load NDJSON paralelo, DDL, contabilidade de bytes |
| `Repository.js` | Persistência e consultas de domínio (catálogo nomeado de SQL, validado pelo parser) |
| `Schema.js` | DDL das tabelas e views (fonte única, gerada para `sql/` como documentação) |
| `Pipeline.js` | Orquestração, checkpoints, heartbeat, métricas |
| `DashboardService.js` | Radar, Caixa, Tarefas, Carreira, Remetentes, Sistema; briefing |
| `SearchService.js` | Busca textual (sem acento) + filtros estruturados |
| `Triggers.js` | `setup()`, triggers, manutenção, renovação de tabelas |
| `Monitoring.js` | Log estruturado sanitizado, contadores diários, saúde |
| `index.html`, `styles.html`, `client.html` | SPA: estrutura, design system e lógica de interface |

## 5. Ingestão e sincronização

1. **Primeira execução:** `getProfile()` → `historyId` base; cursor de backfill `{fim: agora, janela: 7d, piso: agora − 90d, pageToken}` em Properties.
2. **Incremental (sempre primeiro):** `history.list(startHistoryId, historyTypes=[messageAdded, messageDeleted, labelAdded, labelRemoved], maxResults=500)`.
   - O `historyId` só avança depois da persistência bem-sucedida.
   - **404** → resync por janela (`messages.list q="after:<epoch do último sync − 1 dia>"`) e novo `historyId`.
3. **Backfill (tempo restante):** `messages.list q="after:<a> before:<b> -in:chats"` paginado, do mais recente ao mais antigo.
4. **Dedup antes de buscar:** consulta parametrizada `message_id IN UNNEST(@ids)`. Os IDs já presentes viram métrica de **duplicidades evitadas**.
5. **Busca paralela:** `fetchAll` em lotes de 15–20 (`format=full` + `fields` mínimo), com limitador de **4.800 un./min** (80% da quota).
   - 429/403-rateLimit/5xx → backoff exponencial com jitter (1 s, 2 s, 4 s), até 3 tentativas.
   - 404 → `UNAVAILABLE`.
6. **Estados:**
   - `messageDeleted` → `gmail_state=DELETED`, com expurgo do trecho na próxima renovação e ocultação imediata nas views;
   - `TRASH` → `TRASHED`;
   - mudanças de label viram linhas pequenas em `message_state`, sem reescrever o conteúdo.
7. **Robustez:**
   - orçamento de tempo: para com < 60 s restantes e marca `PARTIAL`, nunca `SUCCESS`;
   - `LockService` contra sobreposição de execuções;
   - heartbeat detecta execução morta, registrada como `ABORTED`;
   - load jobs são aguardados até `DONE` antes de avançar o checkpoint.
8. **Mensagens enviadas** (`SENT`): só metadados (destinatários), sem corpo e sem IA. Alimentam o sinal "contato conhecido" do ranking.

**Parsing e minimização (decisão documentada):**
- **O que se guarda:** `body_excerpt` = texto limpo, sem citações, assinaturas e rodapés, com **≤ 4.000 caracteres**. Os demais campos são metadados.
- **Retenção:** o trecho fica visível por **30 dias** (configurável). Depois disso as views o ocultam imediatamente, e a remoção física acontece na próxima renovação de tabela (≤ 45 dias).
- **O que nunca se guarda:** o corpo integral e o conteúdo de anexos (só nome, tipo e tamanho).
- **Charset:** decodificação UTF-8 com fallback para o charset declarado quando aparecem caracteres inválidos. É robusta aos dois comportamentos relatados da API.
- **Links:** só `http(s)`; sem rastreadores, pixels nem descadastro; máximo de 15. O link de descadastro fica separado e só é usado como **sugestão**.
- **Abrir no Gmail:** `https://mail.google.com/mail/u/{n}/#all/{message_id}`, com `{n}` configurável, e alternativa por busca `rfc822msgid:` (funciona em "clique a frio").

## 6. Dados (BigQuery Sandbox)

### 6.1 Estratégia de escrita

- **Load jobs** NDJSON (`BigQuery.Jobs.insert` com blob), `WRITE_APPEND`, disparados em paralelo e aguardados. São gratuitos, permitidos no sandbox e sem *streaming buffer*.
- **Imutável separado de mutável:** conteúdo da mensagem (1 linha por mensagem) ≠ estado do Gmail (linhas pequenas a cada mudança) ≠ análise (1 linha por versão do classificador) ≠ score (linha pequena a cada reescore). Isso minimiza bytes gravados, importante pela cota vitalícia de 10 GiB.
- **Views de versão vigente:** `QUALIFY ROW_NUMBER() OVER (PARTITION BY chave ORDER BY version_ts DESC) = 1`.
- **Renovação por geração:** as tabelas físicas se chamam `<tabela>__g<N>`.
  - Na manutenção diária, uma tabela com ≥ 45 dias é reescrita (CTAS) numa geração nova, só com as versões vigentes e já aplicando a retenção.
  - Em seguida: conferência da contagem → troca da geração em Properties → recriação das views → `DROP` da antiga.
  - Tudo sob lock, de forma idempotente e retomável.
  - As views são recriadas diariamente (não ocupam armazenamento).
- **Cota vitalícia:** cada load ou CTAS soma `outputBytes` num contador. A tela Sistema mostra "X MB de 10 GiB". Um limite configurável (padrão 8 GiB) para a gravação de trechos e gera alerta.
- **Sem particionamento** (≈ 100 MB/ano; no sandbox, partições também expiram). Clustering por chave.

### 6.2 Tabelas

| Tabela | Chave | Conteúdo |
|---|---|---|
| `messages` | `message_id` | Imutável: thread, Message-ID, `internal_ts`, direção, remetente (e-mail/nome/domínio), destinatários, assunto, snippet, `body_excerpt`, tamanho, links, anexos (metadados), flags de conteúdo (newsletter, encaminhada, resposta, autenticação, list-id), `content_hash`, `search_text` normalizado, versão do parser |
| `message_state` | `message_id` | Mutável: labels, lido, estrela, inbox, importante (Gmail), categoria Gmail, `gmail_state` |
| `analyses` | `message_id` + `analysis_id` | Documento de análise: método (RULES/AI), provedor/modelo, versão do classificador, categorias, tópicos, resumo, fatos com evidência, novidade, relevância/importância/urgência, ação, **ações extraídas**, prazo (data, certeza, evidência), entidades, **oportunidade**, evidências verificadas, confiança, motivo, injection, componentes estáticos do score, tokens/custo/latência |
| `scores` | `message_id` | Prioridade vigente: score, nível, componentes e justificativas. Gravada na análise e no reescore diário de itens com prazo |
| `feedback` | `feedback_id` | Eventos do usuário: relevante, irrelevante, resolvida, salva, classificação incorreta (+ categoria correta), reabrir. Alvo: mensagem, ação ou oportunidade |
| `runs` | `run_id` | Execuções: status, gatilho, durações por etapa, contadores, unidades Gmail, bytes BigQuery, tokens e custo de IA, erros sanitizados |
| `briefings` | `briefing_id` | Briefing do período, com conteúdo estruturado e referências às mensagens |

Views: `v_messages`, `v_state`, `v_analysis`, `v_scores`, `v_inbox` (junção + estado do usuário + máscara de retenção), `v_actions` (ações explodidas do JSON, com status via feedback), `v_opportunities` (deduplicadas por `opportunity_key` = empresa + cargo normalizados), `v_senders`, `v_runs`.

## 7. Classificação

### 7.1 Taxonomia (configurável, multi-rótulo)

`carreira` · `networking` · `noticias` · `economia` · `tecnologia` · `negocios` · `financas` · `trabalho` · `tarefas` · `agenda` · `compras` · `contas` · `newsletters` · `marketing` · `spam` · `outros`, com subcategorias. Newsletter é um **formato**: uma newsletter de IA fica com `tecnologia` como principal e `newsletters` como secundária.

### 7.2 Regras (sempre)

- **Score por categoria:** `s_c = Σ peso(termo)·(2 no assunto | 1 no corpo, com teto) + domínio/remetente + label Gmail + headers − termos negativos`, sobre texto normalizado (sem acentos, limite de palavra).
- **Escolha:** a principal é `argmax` se acima do limiar; as secundárias são as que têm ≥ 50% do máximo.
- **Confiança:** cresce com a margem para a segunda categoria e com a quantidade de evidência.
- **Extratores pt-BR/en:**
  - prazos absolutos e relativos com certeza **EXPLÍCITA/INFERIDA** (palavra de prazo + data absoluta = explícito);
  - valores e remuneração (só perto de termos salariais);
  - frases de pedido/ação e direcionamento (você em "Para" vs. lista/cópia);
  - sinais de vaga (cargo, senioridade, modalidade).
- **Resumo sem IA:** extrativo (primeiras frases informativas após saudação).

### 7.3 IA (opcional)

- **Provedor detectado pela chave:** `ANTHROPIC_API_KEY` → Claude; senão `GEMINI_API_KEY` → Gemini; senão só regras.
- **Política de envio:**

| Nível | O que vai para a IA | Padrão para |
|---|---|---|
| `OFF` | nada | sem chave |
| `BROADCAST` | só conteúdo de massa (newsletters, alertas de plataformas, notícias, `List-Unsubscribe`) | **Gemini free** |
| `REDACTED` | tudo exceto categorias sensíveis (`contas`, `financas`), com PII redigida | **Claude** |
| `FULL` | tudo, com PII redigida | escolha explícita |

- **Redação de PII antes do envio:** CPF/CNPJ, cartões (Luhn), agência/conta, linha digitável, chaves Pix aleatórias, OTP e códigos de verificação, senhas, tokens/chaves, telefones.
- **Lotes e fila:**
  - lotes de até 5 mensagens/requisição, delimitadas por *nonce*; mensagens com suspeita de injection vão sozinhas;
  - fila priorizada (score de regras, recência);
  - backfill de IA limitado aos últimos 30 dias (configurável); o resto fica só com regras.
- **Saída estruturada:** Claude via `output_config.format` (`json_schema`); Gemini via `responseJsonSchema`.
- **Validação local completa:** tipos, enums, faixas e tamanhos (o schema da API não aceita `minimum`/`maxLength`, então a validação é feita aqui).
- **Fidelidade:**
  - evidências precisam existir no texto **da própria mensagem**;
  - prazo "explícito" precisa ter a data reconhecível no texto, senão vira "inferido";
  - remuneração só é aceita com números presentes no texto;
  - links só da lista extraída.
- **Falhas:**
  - JSON inválido → 1 tentativa de reparo → fallback para regras (`RULES_ONLY`);
  - circuit breaker em 3 falhas seguidas ou quota esgotada;
  - tetos de custo por dia e por mês.

## 8. Segurança e privacidade

- **Acesso:** `executeAs: USER_DEPLOYING` + `access: MYSELF`. Defesa em profundidade: cada `api*` compara o usuário ativo com o dono registrado no `setup()`. E-mail vazio = negado, com escape documentado.
- **Escopos:**
  - `gmail.readonly`, `bigquery`, `script.external_request`, `script.scriptapp`, `userinfo.email`;
  - `urlFetchWhitelist` restrito a `gmail.googleapis.com`, `api.anthropic.com` e `generativelanguage.googleapis.com`.
- **Interface:**
  - o HTML dos e-mails nunca é renderizado; todo texto entra via `textContent`/escape central;
  - links só `http(s)` com `rel="noopener noreferrer"`;
  - sem `eval`/`innerHTML` com dado externo (teste estático).
- **Prompt injection:**
  - o conteúdo é dado não confiável, delimitado por *nonce*;
  - o system prompt proíbe seguir instruções do e-mail;
  - a saída fica restrita a um schema, sem ferramentas;
  - um detector heurístico aplica o selo `injection_suspected` (a mensagem vai sozinha e a confiança é reduzida);
  - a UI nunca transforma texto da IA em link ou ação.
- **Segredos e logs:**
  - chaves em Script Properties, nunca devolvidas ao cliente (só "configurada: sim/não");
  - logs só com IDs, contagens e códigos; erros sanitizados.
- **Somente leitura:**
  - nenhum código chama envio, rascunho, rótulo, lixeira ou exclusão no Gmail (teste estático);
  - limpeza de dados derivados só por ação explícita, com confirmação digitada.

## 9. Ranking explicável

| Componente | Peso | Cálculo (cada um ∈ [0, 1]) |
|---|---|---|
| Importância *I* | 0,28 | Com IA: `0,7·(imp−1)/4 + 0,3·prior(cat)`; sem IA: `prior(cat)` ajustado por sinais |
| Urgência *U* | 0,18 | Com prazo: `f(d)·certeza·confiança_urgência(cat)`, onde `f(0)=1`, `f(d)=e^(−d/3)` (d ≥ 1), vencido ≤ 3 d = 0,7, vencido > 3 d = 0,1. Certeza: explícita 1,0 / inferida 0,6. Confiança de urgência: marketing 0,1, newsletters 0,2, notícias 0,3, demais 1,0 |
| Ação *A* | 0,18 | Exige ação: `0,6 + 0,4·direto` (você em "Para", e não em lista ou cópia) |
| Oportunidade *O* | 0,12 | Vaga/negócio: `0,6 + 0,4·aderência` (alerta em massa: `0,3 + 0,4·aderência`) |
| Remetente *S* | 0,10 | Prioritário 1,0 · contato conhecido 0,8 · pessoa desconhecida 0,4 · automático 0,15 · ± 0,2 × afinidade do feedback |
| Novidade *N* | 0,04 | 1,0 · newsletter recorrente 0,6 · conteúdo repetido (hash em 30 dias) 0,3 |
| Interesse *T* | 0,10 | Aderência aos temas de interesse configurados |

`score = (Σ wᵢ·Xᵢ) × (0,6 + 0,4·confiabilidade) × ruído(cat)`, com ruído: marketing 0,4 · spam 0,1 · newsletters 0,85 · demais 1,0.

**Níveis:**
- **Crítica:** ≥ 0,72 **e** um gatilho — (A ≥ 0,6 e U ≥ 0,5), ou (O ≥ 0,8 e S ≥ 0,8), ou (remetente prioritário e A > 0). Exige também categoria fora de ruído e confiança ≥ 0,6, com **teto de 3 por dia** (o excedente é rebaixado com justificativa).
- **Alta:** ≥ 0,55.
- **Média:** ≥ 0,35.
- **Baixa:** abaixo de 0,35.

| Caso (viram testes) | I | U | A | O | S | N | T | Score | Nível |
|---|---|---|---|---|---|---|---|---|---|
| Promoção "só até amanhã" | 0,21 | 0,07 | 0 | 0 | 0,15 | 1 | 0 | 0,05 | Baixa |
| Recrutador com vaga aderente pedindo retorno | 0,74 | 0,30 | 1 | 0,8 | 0,4 | 1 | 0,5 | 0,67 | Alta |
| Boleto vencendo hoje (prazo explícito) | 0,71 | 1 | 1 | 0 | 0,15 | 1 | 0 | 0,61 | Alta |
| Pedido de remetente prioritário para hoje | 0,91 | 1 | 1 | 0 | 1 | 1 | 0 | 0,75 | Crítica |

O Radar tem um ranking separado para "Principais novidades": `info = 0,5·T + 0,3·I + 0,2·N`. Assim, informação relevante não disputa a fila de "atenção". Urgência ≠ importância ≠ informação.

## 10. Experiência (Fase 1)

Barra lateral no desktop e barra inferior no celular:

1. **Radar** (home):
   - briefing executivo (Hoje / 7 dias / 30 dias) e "desde sua última visita";
   - KPIs com comparação com o período anterior;
   - **Exige atenção** (com o score explicado), **Prazos e tarefas**, **Oportunidades**, **Novidades**, temas em alta;
   - status da sincronização;
   - **tempo estimado economizado** (rotulado como estimativa, com fórmula visível).
2. **Caixa:** lista paginada com filtros combináveis (categoria, prioridade, ação, prazo, lido, período, remetente, texto) e ordenação. Visão resumida/detalhada. Painel de detalhe com resumo, fatos, evidências, componentes do score, ações, links seguros e "abrir no Gmail". Feedback.
3. **Tarefas:** ações extraídas, com prazo explícito ou inferido, origem e status (resolver ou reabrir).
4. **Carreira:** oportunidades deduplicadas (empresa, cargo, senioridade, local, modalidade, remuneração **só se informada**, próxima ação, prazo, mensagens relacionadas).
5. **Remetentes:** volume, categorias, relevância média, tendência e potencial de ruído, com sugestões de filtro ou descadastro (**nunca automáticas**).
6. **Busca:** texto sem acento + filtros, com resultados mostrando assunto, remetente, data e link.
7. **Sistema:** saúde, execuções, fila, quotas (Gmail, Apps Script, BigQuery vitalício, IA), triggers, expiração de tabelas e configurações.

Design system:
- tokens CSS (cores semânticas discretas, tipografia, espaçamento 4/8), tema claro/escuro;
- skeleton, vazio, erro e toast;
- foco visível, ARIA, atalhos (`/` busca, `j`/`k` lista, `Esc` fecha);
- contraste AA;
- dados de demonstração existem **apenas** no harness de testes visuais, rotulados como DEMO.

## 11. Monitoramento

`runs` + `v_runs` + tela Sistema:
- última sincronização bem-sucedida e atraso;
- descobertas, processadas, pendentes;
- falhas e retries;
- sem IA;
- latência por etapa;
- unidades Gmail/min;
- bytes BigQuery (consulta e cota vitalícia);
- tokens e custo (por lote e por mil e-mails);
- duplicidades evitadas;
- triggers;
- circuit breaker;
- dias até a expiração das tabelas.

## 12. Qualidade

- **Testes unitários/integração** (Node `node:test` + harness): parser, extratores, regras, schema/fidelidade, ranking (incluindo os casos da seção 9), SQL (parse BigQuery + parametrização), pipeline (idempotência, retomada, 404 de histórico, retries, lock, orçamento), segurança (somente leitura, escape, auth, ordem de carga).
- **Avaliação do classificador:** conjunto **sintético e rotulado, explicitamente identificado como sintético**, com e-mails brasileiros representativos. Mede precisão/recall por categoria, acurácia de ação/prazo, falsos positivos de urgência e distribuição de níveis. **Os resultados são reportados como medidos sobre dados sintéticos.**
- **Em produção:** `classificação incorreta` e `irrelevante` alimentam a view de qualidade (precisão@k das críticas e altas segundo o seu feedback).

## 13. Capacidade (50 e-mails/dia)

| Recurso | Carga inicial (4.500) | Regime | Limite | Folga |
|---|---|---|---|---|
| Gmail API | 270 mil un. → ~56 min de API a 4.800 un./min → ~13 execuções | ~3 mil un./dia | 6.000 un./min | ok |
| Triggers | ~60 min no 1º dia (backfill também pode ser manual) | 24 × ~45 s ≈ 18 min/dia | 90 min/dia | 5× |
| UrlFetch | ~4.700 | ~200/dia | 20.000/dia | 100× |
| BigQuery storage vitalício | ~45 MB | ~16 MB/mês + renovações ≈ 0,75 GB/ano | 10 GiB | > 10 anos |
| BigQuery query | — | ~80 GB/mês | 1 TiB/mês | 12× |
| Gemini free (se usado) | backfill só de massa, ~150 lotes | ~5–8 req/dia | ~500 RPD (a confirmar) | > 50× |
| Claude (Max) | ≈ US$ 13 (Opus) | ≈ US$ 13/mês | créditos ≥ US$ 100 e teto do app US$ 30 | ok |

## 14. Entrega

| Fase | Conteúdo | Status |
|---|---|---|
| **1 — Fundação** | Setup seguro, ingestão incremental + backfill, parser, regras, IA (Claude/Gemini) com política, ranking, BigQuery (DDL, views, loads, renovação, cota), Radar, Caixa + detalhe + feedback, Tarefas, Carreira (básico), Remetentes (básico), Busca textual, Sistema, triggers, monitoramento, testes, avaliação e documentação | **Esta entrega** |
| 2 — Inteligência | Perguntas em linguagem natural com respostas fundamentadas e citações; agrupamento de notícias por evento e comparação de fontes; pesos aprendidos com o feedback; digest semanal | Próxima |
| 3 — Avançado | Linha do tempo de assuntos, sinais fracos, follow-ups esquecidos (via mensagens enviadas), monitoramento de empresas e pessoas, alertas, worker de IA local opcional no computador novo | Futura |

Itens que o esquema já suporta mas que **não** estão implementados aparecem no README como "estrutura preparada", nunca como funcionalidade.

## 15. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Renovação de tabelas falhar por > 15 dias (sandbox) | Alto | Renovação aos 45 dias (15 de folga), alerta vermelho no Sistema, rebuild a partir do Gmail; o feedback é o único dado não reconstruível |
| Cota vitalícia do sandbox | Médio | Minimização (separação imutável/mutável, trecho ≤ 4.000), contador de bytes, limite que interrompe a gravação de trechos; upgrade para faturamento (US$ 0 no free tier) documentado |
| Termos do Gemini free vs. e-mails pessoais | Médio | Política `BROADCAST` por padrão, redação de PII, `OFF` disponível; Claude (Max) como caminho recomendado |
| Quota Gemini free menor que a medida | Baixo | Orçamento diário configurável, 429 → circuito aberto até o reset, regras como fallback |
| Quota nova da Gmail API | Baixo | Limitador de unidades, backfill fatiado |
| 90 min/dia de triggers compartilhados com outros projetos seus | Médio | Execuções curtas em regime, duração monitorada, frequência configurável, backfill manual possível |
| `getActiveUser()` vazio | Médio | Mensagem clara + escape documentado |
| Deep link do Gmail mudar | Baixo | Dois formatos de link |
| CTAS no sandbox não renovar a expiração | Médio | A renovação usa **tabela nova** (geração `__gN`), que tem criação nova por definição, e confere a expiração após criar |

## 16. Seu passo a passo (~20 min, só navegador)

1. Criar um projeto Google Cloud **sem faturamento** e abrir o BigQuery (o sandbox é ativado automaticamente).
2. IA (opcional):
   - se você é **Max**, gere uma API key em `platform.claude.com` na organização vinculada aos créditos mensais;
   - se não, gere uma chave Gemini no AI Studio num projeto sem faturamento (só conteúdo de massa).
3. Criar o projeto Apps Script (colar arquivos ou `clasp push`), preencher `GCP_PROJECT_ID` e a chave de IA em *Propriedades do script* e executar `setup()` uma vez, autorizando.
4. Implantar o Web App (*Executar como: eu* · *Quem pode acessar: somente eu*).
5. Seguir o checklist do primeiro deploy no README.

## 17. Pendências de verificação (não confirmáveis daqui)

| Item | Como o código se protege |
|---|---|
| Números exatos do free tier Gemini | Orçamento configurável e 429 → circuito aberto |
| Se `CREATE OR REPLACE` renova a expiração no sandbox | Usamos tabela nova por geração e conferimos a expiração |
| Charset do `body.data` | Decodificação robusta aos dois comportamentos |
| Deep link `#all/<id>` em clique a frio | Link alternativo `rfc822msgid` |
| `getActiveUser()` em Web App `MYSELF` | Comportamento esperado é retornar o e-mail do dono; escape documentado |
| Se o sandbox aceita dataset em `southamerica-east1` | Padrão `US`, configurável |
| Unidades reais da Gmail API para o projeto *default* do Apps Script | O limitador assume a quota nova (mais restritiva) |

---

## 18. Revisão adversarial do plano (4 lentes) — achados e decisões

Quatro revisores independentes (plataforma, dados, segurança, produto) foram instruídos a **refutar** o plano. Resultado: 1 bloqueador e ~30 achados maiores. Abaixo, o que muda. Onde houver conflito com as seções anteriores, **esta seção prevalece**.

### 18.1 Dados e robustez

| # | Achado | Decisão |
|---|---|---|
| D1 (bloqueador) | Loads independentes + dedup em `messages` criam buracos permanentes se o load de `analyses` falhar. | `messages` é o **marcador de commit**: primeiro `analyses`, `scores` e `message_state` (DONE **sem** `errorResult`), depois `messages`. Órfãos em `analyses` são inofensivos. `jobId` determinístico por execução, tabela e lote: o retry recebe 409 e acompanha o job existente. Linhas validadas contra o `Schema` antes do load. Antes de chamar a IA, reutiliza-se a análise de IA que já existir. |
| D2 | Feedback do Web App × renovação de geração pode perder o único dado não reconstruível. | **Fila de saída nas Properties** (`FB_<uuid>`, uma chave por evento, gravação atômica). A UI responde na hora e o pipeline descarrega sob lock, apagando a chave só após o DONE. Espelho compacto do estado do usuário nas Properties. |
| D3 | A cota vitalícia cresce de forma quadrática sem horizonte físico. | Horizonte na renovação: `messages`/`analyses`/`scores`/`state` 12 meses (configurável); `runs` 90 dias; `briefings` 60 dias; `feedback` sempre. Reserva: gravações não essenciais param quando o restante for menor que 3× o tamanho vivo. Saída a custo zero documentada: migrar para um novo projeto sandbox. |
| D4 | Renovação por tabela, com DROP imediato, é frágil. | **Geração global** (todas as tabelas renovam juntas, um só ponteiro, descobrível por `Tables.list`). Conferência de contagem e chaves distintas. **DROP da geração antiga só na manutenção seguinte** (1 dia de rollback). Renovação adiada se houver load pendente. |
| D5 | Views também expiram em 60 dias. | Após recriar, ler `expirationTime`; se faltarem menos de 30 dias, DROP + CREATE. A manutenção **lança erro** quando a menor expiração estiver a menos de 10 dias: o e-mail nativo de falha de trigger do Apps Script avisa você, sem escopo novo. |
| D6 | `labelAdded/Removed` trazem deltas, não o estado. | `message_state` só grava **snapshots completos**: `messages.get format=minimal` dos IDs alterados já conhecidos (limite por execução). IDs desconhecidos são ignorados, porque o backfill traz o estado atual. |
| D7 | 404 do histórico: ordem e exclusões no intervalo. | `getProfile()` primeiro, com o novo historyId guardado como pendente. Depois a janela é listada com o mesmo filtro de elegibilidade. Os ausentes recebem `get minimal` (404 → DELETED). Só então o historyId é gravado. O checkpoint avança por página processada. |
| D8 | Rascunhos, chats e spam entram pelo histórico. | Regra única `GmailClient.eligibility()`: DRAFT/CHAT descartados; SPAM/TRASH só estado (sem corpo, sem IA, fora do Radar); SENT só metadados. |
| D9 | Retenção vazava por `snippet`, citações, links e busca. | Conjunto retido = `body_excerpt`, `snippet`, `search_body`, `links_json` e todas as evidências literais (`evidence_json`, `deadline_evidence`). Fica mascarado nas views após N dias e é removido na renovação. Mensagens com mais de N dias já são ingeridas **sem** trecho. Mensagens excluídas no Gmail perdem todas as linhas derivadas. `maxTimeTravelHours=48`. Janela física real documentada: até ~75 dias + 2 dias de time travel. |
| D10 | O sqlglot só valida sintaxe. | `selfTest()`: dryRun gratuito de todo o catálogo de SQL + consulta de fumaça, no setup e sob demanda na tela Sistema. |

### 18.2 Plataforma

| # | Achado | Decisão |
|---|---|---|
| P1 | A IA dentro dos triggers estoura os 90 min/dia (compartilhados entre os seus projetos). | Contador de runtime em janela móvel de 24 h. Ao chegar a 60 min, backfill (Gmail e IA) suspenso, mantendo só o incremental. IA em paralelo (`fetchAll`, até 3). Lote adaptativo (Opus: 2 por requisição). Timeout estimado e lançado no teto de custo. `runBackfillNow()` manual no editor para acelerar o dia 1. |
| P2 | REST paralelo no Gmail não ganha vazão (a quota é o gargalo). | ✅ Já aplicado: serviço avançado sequencial + limitador; `gmail.googleapis.com` saiu da whitelist. |
| P3 | Whitelist sem `api.anthropic.com`. | ✅ Corrigido. Teste estático compara os hosts do código com o manifesto. 401/403/"not allowed" viram **erro de configuração** visível, não falha transitória. |
| P4 | Formato `full` para mensagens antigas desperdiça quota e cota vitalícia. | Mensagens mais antigas que max(retenção, janela de IA) vão por `format=metadata` (20 un.). |
| P5 | Guarda de usuário ativo em triggers pode bloquear tudo em silêncio. | Triggers comparam `getEffectiveUser()` com o dono e registram um run `DENIED` visível. A guarda de usuário ativo fica só no Web App. |

### 18.3 Segurança e privacidade

| # | Achado | Decisão |
|---|---|---|
| S1 | `BROADCAST` era uma disjunção permissiva. Gemini free virava BROADCAST só de salvar a chave. | **IA desligada até consentimento explícito** na tela Sistema: provedor, o que sai, retenção, treino, revisão humana, mais um **dry-run** com contagens e amostra redigida. BROADCAST passa a ser **conjunção**: remetente automático **e** List-Unsubscribe/List-Id **e** não é lista de discussão **e** não é aba Principal **e** não é notificador de mensagens privadas (LinkedIn, Instagram, Facebook, WhatsApp, Slack, GitHub…) **e** não é sensível. |
| S2 | Briefing e `thread_context` escapavam da política. | **Porta única de saída** para a IA: só itens aprovados por `allowedByPolicy` e já redigidos. O briefing padrão é **determinístico** (template); o briefing por IA usa só itens aprovados, e os demais entram como contagens. `thread_context` só usa mensagens que também passam pela política. |
| S3 | `GEMINI_TIER=paid` permitiria enviar correspondência pessoal ao free tier por engano. | Removido. No Gemini, o máximo é BROADCAST. |
| S4 | Sensibilidade estreita demais. | Novas categorias `saude`, `seguranca_conta` (nunca vai à IA) e `governo_juridico`. Sensibilidade = OU de categorias principal/secundárias + denylist de domínios + termos no assunto. |
| S5 | Assunto, nome e links iam sem redação. | Redação de assunto, nome, texto e evidências. **Links não são enviados à IA.** Nome e e-mail do dono viram `[VOCE]`. Novos padrões: CEP, RG, CNH, nascimento, IP, placa, tokens em URL. |
| S6 | Contaminação entre mensagens de um lote. | Lotes só dentro da mesma classe de confiança (massa com massa); correspondência pessoal vai **sozinha**. Exatamente 1 item por ref; senão, reprocesso individual. `ai_attempts` ≤ 2 e depois só regras. A IA não rebaixa remetente humano para spam/marketing sem concordância das regras. |
| S7 | Phishing reembalado como confiável. | Para spam, `auth_fail` ou categoria spam: links **não clicáveis**, nível máximo Média e selo "Falha de autenticação". Host real em destaque, com alerta quando o texto do link parece outro domínio. Descadastro sugerido só via header List-Unsubscribe com DKIM ok e nunca para spam. Rótulo "Resumo gerado por IA". |
| S8 | Entrada patológica (ReDoS) podia travar o pipeline em loop. | Marcador "em processamento" antes do parse; se a execução anterior abortou com ele, a mensagem vai para **quarentena** (só metadados). `try/catch` por mensagem. HTML truncado antes de qualquer regex. Fixtures patológicas com limite de tempo. |
| S9 | Preheader oculto disparava falso "injection". | Elementos ocultos e caracteres invisíveis são **removidos** do texto. Injection só por padrões de instrução. |
| S10 | Mensagens de erro (ex.: `JSON.parse`) vazam conteúdo nos logs. | Erros persistidos e logados = **enum fechado** `{code, module, http}`. Nunca `e.message` de parse ou de provedor. |
| S11 | Funções de topo chamáveis pelo cliente. | `setup()` idempotente e não destrutivo (nunca sobrescreve o dono nem apaga tabelas), retornando só booleanos. Operações destrutivas só via `api*` com confirmação digitada. Pedido de sync pelo cliente = trigger único em ~1 min. Teste estático com allowlist de nomes de topo. |
| S12 | Recursos externos e templates no Web App. | Zero scripts/estilos externos (tudo inline, fontes do sistema, ícones SVG inline). `doGet` ignora parâmetros. Testes estáticos proíbem `<script src`, `ALLOWALL`, `innerHTML` com dados e `<?!=` fora de `include()`. |
| S13 | Termos da Anthropic para dados de terceiros. | Risco aceito e documentado (uso pessoal, sem fins econômicos; LGPD art. 4º, I). Consentimento + dry-run antes do backfill de IA. Recomendação de um workspace no Console com limite de gasto igual ao teto do app. |

### 18.4 Produto e ranking

| # | Achado | Decisão |
|---|---|---|
| R1 | Tarefas inundadas pelo backfill. | **Auto-resolução** (reabrível) quando há resposta sua na mesma thread depois da mensagem, quando ela sai da INBOX, é excluída ou o prazo venceu há mais de 3 dias. Sem prazo: aberta por no máximo 14 dias. Uma tarefa por thread (última mensagem recebida). Ações só de remetentes não-massa ou de categorias transacionais. Datas relativas ancoradas em `internal_ts` (São Paulo). |
| R2 | No modo só-regras, a crítica ficava inalcançável e o boleto do dia caía em Média. | `I_regras` ganha bônus: prazo explícito em contas/agenda/tarefas +0,15; IMPORTANT +0,10; STARRED +0,15; Principal + humano +0,05; Promoções −0,10. (Esclarecimento: o multiplicador `0,6+0,4·x` usa a **confiabilidade de autenticação**, não a confiança da categoria.) Sugestão de remetentes prioritários a partir dos mais respondidos. |
| R3 | Teto diário de críticas aplicado na escrita e dependente da ordem. | O score grava só a **elegibilidade**. O teto é aplicado **na leitura** (dia de exibição, top-3 por score entre abertas recentes); o excedente aparece como "Alta (crítica excedente)". Idempotente. |
| R4 | Critério 7 (relevância × urgência × ação) não era verificável. | Três eixos explícitos e exibidos como selos em cada item, com filtro e ordenação: **Relevância** (interesse + relevância da IA + afinidade), **Urgência** (prazo ou sinais, com teto sem prazo), **Ação**. "Exige atenção" = aberta ∧ nível ≥ Alta ∧ (ação ∨ urgência ≥ 0,4). |
| R5 | Briefing indefinido e fora da política. | Template determinístico por padrão; IA opcional, restrita (S2), com referências validadas. |
| R6 | "Tempo economizado" era precisão falsa. | Trocado por **"e-mails triados sem abrir"** (Baixa/ruído que continuam não lidos) × 5–15 s por triagem, mostrado como faixa e com a fórmula. |
| R7 | O feedback não fechava o ciclo. | Feedback gera um **novo score** da mensagem: `classificação incorreta` substitui a categoria e `irrelevante` leva a Baixa. `action_id` = hash(mensagem + descrição + prazo). Resolver a mensagem resolve as ações dela. Precedência: usuário > IA > regras. |
| R8 | Avaliação circular e sem falsos negativos. | O conjunto sintético é reportado como **teste de regressão**, com n e IC 95%, e não como acurácia. Em produção: amostra cega semanal de itens Baixa/Média ("deveria estar mais alto?"), botão "deveria ser mais alta", metas de distribuição (0–3 críticas/dia, ≤ 10% Alta) e concordância regras × IA como proxy. |
| R9 | Custo e latência da IA subestimados. | Projeção recalculada com o uso real medido nos primeiros e-mails. Banner "IA pausada por teto até dd/mm". Opus 5.5 continua padrão (qualidade), com lote adaptativo; Haiku 5.5 documentado como opção ~40× mais barata e mais rápida. |

### 18.5 Tabela de capacidade revisada

| Recurso | Dia 1 (backfill) | Regime | Limite |
|---|---|---|---|
| Runtime de triggers | limitado a 60 min/dia pelo app; backfill completo em ~2–3 dias, ou em horas com `runBackfillNow()` manual | ~20–25 min/dia | 90 min/dia |
| Gmail | ~1.500 × 60 + ~3.000 × 20 = 150 mil un. → ~32 min de API | ~3 mil un./dia | 6.000/min |
| Claude Opus (Max) | backfill de 30 dias ≈ US$ 15–20 | ≈ US$ 15–20/mês (medido no 1º deploy) | teto do app US$ 30/mês e créditos ≥ US$ 100 |
| BigQuery storage vitalício | ~35 MB | ~1 GB/ano com horizonte de 12 meses | 10 GiB → ~10 anos |
| BigQuery query | — | ~130–200 GB/mês (mínimos de 10 MB por tabela) | 1 TiB/mês |
