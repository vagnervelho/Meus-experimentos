# Inbox Intelligence

Central de inteligência pessoal sobre o seu Gmail. Lê a caixa em **modo somente leitura**, classifica, resume, extrai prazos, tarefas e oportunidades, e prioriza de forma **explicável**. Tudo aparece num Web App privado e responsivo, em pt-BR.

- **Custo adicional: R$ 0.** Usa Google Apps Script e BigQuery Sandbox (sem cartão). A IA é opcional: créditos mensais de API do Claude Max ou o tier gratuito do Gemini.
- **Somente leitura.** Escopo `gmail.readonly`. Nada é enviado, arquivado, marcado, excluído ou descadastrado. Um teste estático bloqueia qualquer chamada de escrita.
- **Funciona sem IA.** Um motor de regras em pt-BR faz classificação, prazos, valores, ações, oportunidades e ranking. Com IA ligada, ganha resumos, fatos e entidades.
- **Privado.** O Web App é publicado como "Somente eu", e o servidor confere o dono em toda chamada. Nada vai para a IA sem o seu consentimento explícito, e o que vai sai com dados pessoais redigidos.

> Documentação técnica: [`docs/PLANO_TECNICO.md`](docs/PLANO_TECNICO.md) (arquitetura e decisões), [`docs/CONTRATOS.md`](docs/CONTRATOS.md) (contratos entre módulos e da interface), [`docs/PESQUISA_FONTES.md`](docs/PESQUISA_FONTES.md) (fatos de plataforma com fontes), [`docs/RELATORIO_FASE1.md`](docs/RELATORIO_FASE1.md) (o que foi entregue e testado), [`sql/`](sql/) (SQL gerado, para leitura).

---

## Telas

| Tela | O que mostra |
|---|---|
| **Radar** | Briefing do período (Hoje, 7 ou 30 dias), KPIs com comparação ao período anterior, o que exige atenção, prazos, oportunidades, notícias, temas e o que chegou desde a última visita |
| **Caixa inteligente** | Lista com filtros (categoria, nível, ação, prazo, não lidas, período, remetente, status) e ordenação. Feedback com um clique |
| **Detalhe** | Resumo, fatos com evidência, ações, prazo (explícito ou inferido), oportunidade e "por que essa prioridade?" (componentes do score). Links para abrir no Gmail |
| **Radar de carreira** | Oportunidades consolidadas por empresa e cargo, com aderência ao seu perfil e motivos |
| **Notícias** | Conteúdo informativo ordenado por relevância para os seus interesses |
| **Tarefas** | Ações extraídas, com status automáticos (respondida, arquivada, prazo vencido) |
| **Remetentes** | Volume, variação, % de prioridade alta e de não lidas, e sugestões (filtrar, descadastrar, priorizar). Só sugestões: nada é feito automaticamente |
| **Busca** | Busca na memória (metadados, trechos retidos e análises), com `de:`, `categoria:` e `"frase exata"` |
| **Sistema** | Saúde das execuções, cotas, tabelas do BigQuery e prazo de expiração, qualidade por categoria e concordância regras × IA |
| **Configurações** | Perfil (interesses, cargos-alvo, remetentes prioritários), IA e privacidade (prévia do que seria enviado e consentimento), limites |

## Como funciona

```
Gmail (somente leitura)
   │  histórico incremental (history.list) + backfill/resync por janelas de data
   ▼
Apps Script — gatilho de hora em hora, ≤ 4,5 min por execução, sob lock
   ├─ MessageParser   MIME → texto limpo (sem citações, assinatura, rodapé); só em memória
   ├─ RulesClassifier 19 categorias, prazos, valores, ações, vagas; tudo determinístico
   ├─ AiClient        opcional: política de envio + consentimento + redação de PII + lotes por confiança
   ├─ Scoring         score explicável (7 componentes × peso × confiabilidade × ruído) e 3 eixos
   └─ Repository      load jobs NDJSON (append-only) → BigQuery Sandbox
                          ▲ views de "versão vigente" (última versão por chave)
Web App (HtmlService) ────┘  consultas parametrizadas + cache versionado de 5 min
```

- **Append-only.** O Sandbox não aceita DML. Cada mudança (estado no Gmail, nova análise, score, feedback) é uma nova linha, e as views escolhem a versão vigente. A mensagem só é gravada **depois** das análises e scores confirmados. Se uma execução cair no meio, a seguinte completa sem duplicar nem perder.
- **Renovação automática.** No Sandbox, tabelas e views expiram em 60 dias. A manutenção diária recria a geração de tabelas aos 45 dias (aplicando retenção e horizonte de 12 meses) e recria as views antes de expirarem. Se algo ficar a menos de 10 dias de expirar, a execução falha de propósito e o Apps Script manda e-mail de falha para você.
- **Retenção.** Trechos do corpo ficam 30 dias (configurável) e já são gravados com PII redigida. O corpo completo nunca é persistido. Depois disso, ficam metadados e análises.

## Instalação (≈ 15 min, tudo pelo navegador)

> Faça com a conta Google pessoal cuja caixa será analisada. Nada aqui usa infraestrutura corporativa.

### 1. Projeto do BigQuery Sandbox (sem cartão)

1. Abra o console do Google Cloud e crie um projeto, por exemplo `inbox-intel-pessoal`. **Não** associe conta de faturamento.
2. Abra o **BigQuery** nesse projeto. O console indica "Sandbox" quando não há faturamento.
3. Em **APIs e serviços**, confirme que a **BigQuery API** está ativada.
4. Anote o **ID do projeto**: ele vai em `GCP_PROJECT_ID`.

### 2. Projeto do Apps Script

Escolha uma das duas opções:

- **Com `clasp`** (recomendado, sincroniza todos os arquivos e o manifesto):
  ```bash
  npm install -g @google/clasp
  clasp login
  clasp create --type standalone --title "Inbox Intelligence" --rootDir src
  # ou copie .clasp.json.example para .clasp.json e preencha o scriptId
  clasp push
  ```
- **Manual:** crie um projeto em script.google.com. Em *Configurações do projeto*, marque "Mostrar arquivo de manifesto appsscript.json". Cole o conteúdo de `src/appsscript.json`. Depois crie um arquivo de script para cada `src/*.js`, com o mesmo nome, e um arquivo HTML para cada `src/*.html` (`index`, `styles`, `client`).

Mantenha o projeto do Apps Script no **projeto Cloud padrão** (não troque para o projeto do Sandbox). O BigQuery é acessado pelo ID informado nas propriedades.

### 3. Propriedades do script

Em *Configurações do projeto → Propriedades do script*:

| Propriedade | Obrigatória | Valor |
|---|---|---|
| `GCP_PROJECT_ID` | sim | ID do projeto do Sandbox |
| `BQ_LOCATION` | não | `US` (padrão) ou `southamerica-east1`. Escolha antes do `setup()`: não dá para mudar depois sem recriar o dataset |
| `ANTHROPIC_API_KEY` | não | Chave da API do Claude (veja "IA" abaixo) |
| `GEMINI_API_KEY` | não | Chave do Google AI Studio (alternativa gratuita) |

`OWNER_EMAIL` é preenchida automaticamente pelo `setup()`. Chaves nunca ficam no código e não aparecem na interface: ela só mostra "configurado / não configurado".

### 4. `setup()`

No editor, selecione a função `setup` e clique em **Executar**. Na primeira vez, o Google pede autorização. Como o app é seu e não verificado, use *Avançado → Acessar Inbox Intelligence*. Escopos pedidos:

- `gmail.readonly`: ler mensagens e rótulos (sem escrita)
- `bigquery`: gravar e consultar o seu dataset
- `script.external_request`: chamar a IA (somente `api.anthropic.com` e `generativelanguage.googleapis.com`, por lista branca no manifesto)
- `script.scriptapp`: criar os gatilhos de hora em hora e diário
- `userinfo.email`: identificar o dono

O `setup()` é idempotente: cria o dataset, as 7 tabelas, as 10 views e os 2 gatilhos. Pode ser executado de novo sem efeito colateral.

### 5. Publicar o Web App

*Implantar → Nova implantação → Tipo: App da Web*:

- **Executar como:** Eu
- **Quem pode acessar:** **Somente eu** (nunca "Qualquer pessoa")

Abra a URL `/exec`. A primeira sincronização roda no próximo gatilho (até 1 h). Para não esperar, use **Sincronizar agora**: agenda uma execução em cerca de 1 minuto. O backfill de 90 dias termina em algumas execuções e respeita o orçamento diário de 60 min de gatilhos (o limite do Google é 90 min/dia, somando todos os seus projetos).

### 6. Checklist do primeiro deploy

- [ ] `setup()` terminou e o log mostra `"ok":true`
- [ ] Em *Acionadores*, há exatamente `runPipeline` (de hora em hora) e `runMaintenance` (diário)
- [ ] Depois de uma execução, a tela **Sistema** mostra status `SUCCESS` e o backfill avançando
- [ ] Um e-mail recebido aparece no Radar em até 1 h, e "Abrir no Gmail" abre a mensagem certa (se você usa várias contas no navegador, ajuste o índice `u/N` em Configurações)
- [ ] Rode `diagnose()` no editor e guarde o relatório (sem segredos nem conteúdo)

## IA (opcional) e privacidade

Por padrão, a IA fica **desligada até você consentir**. Em *Configurações → IA e privacidade* você vê a **prévia exata** do que seria enviado: quantas mensagens, quantas bloqueadas e por quê, e uma amostra do texto já redigido. Só depois disso você confirma a política.

| Política | O que vai para a IA |
|---|---|
| `OFF` | Nada |
| `BROADCAST` | Só conteúdo de massa: remetente automático **e** lista (List-Unsubscribe/List-Id), fora da aba Principal, sem notificadores de mensagens privadas e sem nada sensível. É a única opção com Gemini gratuito, cujos termos pedem para não enviar dados pessoais |
| `REDACTED` | Tudo, exceto categorias e domínios sensíveis (saúde, finanças, contas, segurança de conta, governo/jurídico), sempre com PII redigida |
| `FULL` | Tudo, inclusive sensíveis, ainda com PII redigida. Escolha consciente |

Proteções sempre ativas, em qualquer política:

- Redação antes do envio e antes de gravar trechos: CPF, CNPJ, RG, CNH, cartão (validação de Luhn), conta bancária, boleto, chave Pix, códigos e senhas, tokens (inclusive em links), telefone, e-mail, endereço, CEP, data de nascimento, IP e placa. No envio à IA, o seu nome também vira `[VOCE]`.
- Mensagens com falha de autenticação, spam, lixeira e enviadas por você nunca vão para a IA.
- Defesas contra prompt injection: o conteúdo vai delimitado por nonce aleatório e marcado como dado não confiável. Mensagens pessoais e suspeitas vão sozinhas, nunca em lote. A IA não consegue rebaixar uma pessoa para spam/marketing sem concordância das regras. Evidências citadas pela IA são conferidas literalmente no texto, e as que não batem são descartadas. Prazo "explícito" exige a data escrita no texto. Valores de remuneração precisam aparecer no e-mail.
- Teto de custo (padrão US$ 3/dia e US$ 30/mês), limite de requisições por execução e circuit breaker.

**Qual chave usar:**

- **Claude Max (5x/20x):** o plano inclui créditos mensais de API (US$ 100 ou US$ 200) que não exigem cartão. Quando o crédito acaba, as chamadas param, sem cobrança. Gere uma chave no Claude Console, na organização vinculada aos créditos. O modelo padrão é `claude-opus-5-5` com esforço `low` (≈ US$ 13/mês no volume de ~50 e-mails/dia). Para gastar quase nada, `claude-haiku-5-5` é opção.
- **Claude Pro:** não inclui créditos de API. Uma chave seria cobrada à parte. Para custo zero, deixe a IA desligada ou use Gemini.
- **Gemini (AI Studio, gratuito):** só com `BROADCAST`. Os limites diários do tier gratuito variam e devem ser conferidos no AI Studio.

## Custos e limites (uso estimado no seu volume)

| Recurso | Limite gratuito | Uso estimado |
|---|---|---|
| Gatilhos do Apps Script | 90 min/dia (somando todos os seus projetos) | Orçamento interno de 60 min/dia; regime ≈ 10–20 min/dia |
| Gmail API | 6.000 unidades/min | Limitador interno de 4.800/min; metadados para mensagens antigas |
| BigQuery Sandbox, consultas | 1 TiB/mês | < 10 GB/mês (contador na tela Sistema) |
| BigQuery Sandbox, armazenamento | 10 GiB vitalício (não volta ao apagar) | Algumas centenas de MB/ano (contador e alerta a partir de 80%) |
| IA | conforme a chave | Teto configurável; padrão US$ 30/mês |

## Operação

- **Gatilhos:** `runPipeline` de hora em hora e `runMaintenance` diário, às 6 h. Gerencie com `setupTriggers()` e `uninstallTriggers()`.
- **Reprocessar o histórico:** `runBackfillNow()` reinicia o backfill (sem apagar nada; mensagens já gravadas são ignoradas).
- **Feedback** (relevante, irrelevante, categoria errada, resolvida…) é salvo na hora e aplicado ao ranking na próxima sincronização. Também ajusta a afinidade com o remetente.
- **Desinstalar:** execute `uninstallTriggers()`, remova a implantação e, se quiser, apague o dataset `inbox_intelligence` no BigQuery e as Propriedades do script. O Gmail nunca foi alterado.

## Desenvolvimento

Requer Node 18+ (testado no 22) e, para validar o SQL, Python 3 com `sqlglot`.

```bash
npm install
npm test             # unitários e de integração (mocks fiéis do Apps Script, Gmail e BigQuery)
npm run typecheck    # tsc --checkJs contra @types/google-apps-script
npm run sql:check    # todo o SQL: sintaxe BigQuery + resolução de TODAS as colunas (sqlglot)
npm run ui:check     # interface no Chromium (Playwright): telas, 390px/1366px, claro/escuro, axe, XSS
npm run eval         # avaliação offline do classificador e do ranking (dataset sintético rotulado)
npm run check        # build + typecheck + testes + SQL
```

Convenções: um namespace por arquivo, sem dependência em tempo de carga (um teste carrega os arquivos nas duas ordens) e ES2019. Funções de topo só em `Code.js`, também garantido por teste.

## Limitações conhecidas

- **Validação real pendente:** daqui não há acesso ao seu Gmail nem ao BigQuery. Toda a integração foi testada contra mocks fiéis das APIs, typecheck e validação de SQL. O primeiro deploy (checklist acima) é a validação real.
- **Corpos grandes:** partes de texto que a Gmail API entrega só como anexo (`attachmentId`) não são baixadas.
- **Regras:** classificação por regras tem limites (veja `eval/report.md`). Assinaturas sem `-- ` e citações intercaladas podem ficar no texto.
- **Busca:** é por termos normalizados (sem acento), não semântica.
- **Relógio:** datas relativas ("sexta", "amanhã") são resolvidas a partir da data de recebimento, no fuso de São Paulo.
