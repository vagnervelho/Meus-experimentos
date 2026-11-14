# 12 — Fatos de plataforma: de onde vem cada afirmação

## Em resumo

- **Nenhuma API citada no desenho é inventada** (§20, regra 5): as assinaturas foram conferidas nos tipos `@types/google-apps-script` 2.0.15 e nos discovery docs.
- **43 fatos, verificados em 13/11/2026**: 19 lidos na fonte (V) e 24 por fonte secundária (NV); destes, 13 sem fonte utilizável (SF).
- **As decisões centrais apoiam-se em V**: gravação tipada e atômica pela Sheets API, `drive.file` pela Drive API v3, manifesto `USER_DEPLOYING` + `MYSELF`.
- **O que é SF não vira código antes do spike**: cada pergunta tem item SP, critério e contingência (seção 4).
- developers.google.com ficou bloqueado: cotas, sandbox do iframe e comportamento de `getValues`/`setValues` estão como NV. Nada aqui foi executado em conta Google.

**Documentos relacionados:** `01-arquitetura.md`, `06-persistencia-e-integridade.md`, `08-ux-ui.md`, `09-plano-de-testes.md`, `10-plano-de-implementacao.md` (spike SP-01 a SP-10), `11-riscos-e-premissas.md`, `13-revisao-adversarial.md` (achados P-01 a P-12).

## 1. Como ler

- **C·V**: confirmado e lido na fonte; pode sustentar decisão.
- **C·NV**: confirmado só por snippet ou fonte secundária; premissa a reconfirmar no spike ou no primeiro deploy.
- **X·NV**: corrige um número que o desenho citava; planeja-se com o valor mais conservador.
- **SF**: sem fonte utilizável (relatos ausentes ou conflitantes); só teste real resolve (seção 4).
- **Data da verificação: 13/11/2026.** Cotas e limites mudam sem aviso.
- **Não pôde ser lido:** developers.google.com e support.google.com (bloqueados pelo proxy; espelhos não foram usados); tanaikech.github.io, justin.poehnelt.com e workspaceupdates.googleblog.com (fora dos domínios permitidos; só snippet).
- **Consequência:** a existência de um método é V (tipos); o comportamento descrito só na referência oficial é NV. Fato misto (assinatura V, comportamento NV) leva o código mais fraco.
- Na coluna "Uso", o número é o arquivo da Fase 0 (01 = `01-arquitetura.md`).

Fontes (coluna "Fonte"):

| Sigla | Fonte |
|---|---|
| T | `@types/google-apps-script` 2.0.15 (`.d.ts` por serviço; `apis/sheets_v4`, `apis/drive_v3`) |
| DS | Discovery da Sheets API v4, rev. 20261111: https://www.googleapis.com/discovery/v1/apis/sheets/v4/rest |
| DD | Discovery da Drive API v3, rev. 20261109: https://www.googleapis.com/discovery/v1/apis/drive/v3/rest |
| DA | Discovery da Apps Script API v1, rev. 20261106: https://www.googleapis.com/discovery/v1/apis/script/v1/rest |
| Q | Rastreador `lsb11/apps-script-quotas` (`data/quotas.json`, checkedAt 2026-09-28): raspagem da página oficial |
| RD | `googleworkspace/redriveapp` (README e `ReDriveApp.gs`; não é produto oficial) |
| AM | `googleworkspace/apps-script-samples` (`advanced/sheets.gs`, `advanced/drive.gs`) |
| BM | Benchmarks de tanaikech (gists de 2018 e 04/2022) |
| PF-n | Linha n de `inbox-intelligence/docs/PESQUISA_FONTES.md` (24/10/2026) |
| SN | Snippet de busca de página bloqueada ou site de terceiro |

## 2. Tabela de fatos

### 2.1 Planilha, cotas e gravação

| Nº/tema | Fato | Verif. | Fonte | Uso |
|---|---|---|---|---|
| F-01 Limites | Teto de células por planilha subiu de 10 para 20 milhões em 10/09/2026 (conta células vazias da grade) | X·NV | SN (blog Workspace Updates) | 06: volumetria planejada com 10 milhões |
| F-02 Limites | 18.278 colunas; 50.000 caracteres por célula | C·NV | SN (support.google.com, ablebits) | 02, 03a, 03b: JSON ≤ 40.000 caracteres, validado antes da escrita |
| F-03 Limites | Máximo de abas: sem número oficial (terceiros citam 200 ou só o teto de células) | SF | SN | 02: 34 abas |
| F-04 Cotas | Conta pessoal: 6 min por execução; 90 min/dia de gatilhos; 30 execuções simultâneas e 20 gatilhos por usuário; Properties 9 KB por valor e 500 KB por store; 250 planilhas criadas/dia; 200 versões por script | C·NV | Q | 01: contexto; 06: importação em lotes; 10: `/dev` sem publicar |
| F-05 Cotas | CacheService: 100 KB por chave; expiração máxima de 6 h, apenas sugerida | C·NV | PF-32; T | 01: MVP sem CacheService |
| F-06 Lock | `LockService.getScriptLock()`; `waitLock(ms)` lança ao expirar; `tryLock(ms)` devolve boolean; `releaseLock()`; `hasLock()` | C·V | T | 04: `waitLock` ≤ 25 s; 06: recuperação com `tryLock` |
| F-07 Lock | `hasLock()` só informa sobre a própria execução; a única sonda do lock alheio é `tryLock`, que adquire. A referência manda `flush()` antes de `releaseLock()` | C·NV | SN; T | 06: leitura otimista; `flush()` ao fim de cada fase |
| F-08 Lock | Liberação do lock quando a execução morre por timeout e teto do argumento de espera: sem fonte | SF | PF-33; SN | 06: recuperação; SP-03 |
| F-09 SpreadsheetApp | Existem `flush`, `openById`, `getValues`, `setValues`, `getDisplayValues`, `setNumberFormats`, `insertRowsAfter`, `deleteRows`, `protect` com `setWarningOnly`, `setSpreadsheetTimeZone`, `setSpreadsheetLocale` | C·V | T | 06: primitiva alternativa, `setup()`, proteção de aviso |
| F-10 SpreadsheetApp | `deleteRows` até sobrar só o cabeçalho: sem fonte. `AddSheetRequest` com `gridProperties` já cria a aba na dimensão certa (V) | SF | T; DS | 06: abas na dimensão exata; SP-10 |
| F-11 Sheets API | `spreadsheets.batchUpdate` grava valores tipados (`stringValue`, `numberValue`, `boolValue`); `stringValue` nunca é interpretado. `valueInputOption=RAW` grava sem interpretar | C·V | DS | 06: primitiva preferida |
| F-12 Sheets API | `spreadsheets.batchUpdate` é atômico (request inválido: nada é aplicado); `AppendCellsRequest` insere linhas se preciso; `values.append` detecta "tabela" em vez de anexar por posição | C·V | DS; AM | 06: comando simples em uma requisição; `values.append` fora |
| F-13 Sheets API | A saída omite linhas e colunas vazias finais; na entrada, `null` é ignorado e vazio é `''` | C·V | DS | 06: vazio canônico `''`; a leitura completa as bordas |
| F-14 Sheets API | Cotas: 300 leituras e 300 escritas por minuto por projeto, 60 por usuário; um batch conta 1; payload recomendado ≤ 2 MB | C·NV | SN | 06: uma requisição por comando |
| F-15 Sheets API | Os métodos usados aceitam o escopo `spreadsheets` | C·V | DS | 01: nenhum escopo novo |
| F-16 Coerção | `setValues` em célula "Geral" age como digitação (`USER_ENTERED`): `=` vira fórmula, `0012` vira 12, `2026-11-13` vira data | C·NV | DS (modo: V); relatos | 01: contrato de tipos; 09: fake emula a coerção |
| F-17 Coerção | `setValues` em célula `@`: relatos conflitantes; sem fonte para `=` inicial, para herança do formato em linha nova e para formato fora da grade | SF | SN | 06: primitiva alternativa; SP-01, SP-10 |
| F-18 Coerção | `getValues()` devolve o tipo da célula (`Date` no fuso da planilha); `getDisplayValues()` devolve texto; `UNFORMATTED_VALUE` + `SERIAL_NUMBER` devolve data como número | C·NV | T; DS | 06: leitura normalizada; importação guarda o texto exibido |

### 2.2 Interface, chamadas e publicação

| Nº/tema | Fato | Verif. | Fonte | Uso |
|---|---|---|---|---|
| F-19 HtmlService | `createTemplateFromFile(nome).evaluate()`; `setTitle`; `addMetaTag('viewport', …)`; `createHtmlOutputFromFile(nome).getContent()` | C·V | T | 08: `Index` + includes |
| F-20 Iframe | Só modo IFRAME; sandbox com `allow-downloads` e `allow-popups`, sem `allow-top-navigation`; links com `target` `_blank` ou `_top`; recursos externos só por HTTPS. Download de Blob em iOS: sem fonte | C·NV | PF-36; SN | 01: Chart.js por CDN; exportação por link `_blank` |
| F-21 Iframe | `google.script.history` e `google.script.url` são APIs de cliente fora dos tipos; "sem service worker no iframe" é limitação prática, sem fonte direta | SF | — | 08: roteador por hash; PWA só fora do iframe |
| F-22 script.run | Aceita primitivos, objetos e arrays de primitivos; `Date`, função ou elemento DOM derrubam a chamada. Função terminada em `_` não é chamável pelo cliente nem aparece no menu Executar | C·NV | PF-34, PF-35 | 01: sem `Date` no envelope; superfície pública fechada |
| F-23 script.run | Payload máximo: sem limite oficial; relatos citam ~50 MB; base64 acrescenta ~33% | SF | SN | 08: fotos e importação; SP-06 |
| F-24 Web App | `executeAs`: `USER_ACCESSING` ou `USER_DEPLOYING`; `access`: `MYSELF`, `DOMAIN`, `ANYONE`, `ANYONE_ANONYMOUS` | C·V | DA | 01: `USER_DEPLOYING` + `MYSELF` |
| F-25 Session | `getActiveUser().getEmail()` nesse modo pode vir vazio; há ressalva para o próprio desenvolvedor e relatos divergentes. `getEffectiveUser()` é sempre quem implantou | SF | PF-39, PF-58; SN | 01: `assertOwner_()` com flag; SP-04 |
| F-26 Web App | Com várias contas logadas a URL pode ganhar `/u/1/` e falhar com "unable to open the file" | SF | SN (issuetracker 167692852) | 01: perfil só com a conta dona; SP-04 |
| F-27 Web App | Apps Script API: `projects.versions` não tem exclusão; existe `scripts.run` | C·V | DA | 01: `/dev` no desenvolvimento; front-end externo futuro |

### 2.3 Drive, exportação, gatilhos, desempenho e anexos

| Nº/tema | Fato | Verif. | Fonte | Uso |
|---|---|---|---|---|
| F-28 Escopos | Drive v3: `files.create`, `copy`, `update`, `get`, `list` e `export` aceitam `drive.file`; `emptyTrash` exige `drive` | C·V | DD | 01: escopos de menor privilégio |
| F-29 Escopos | `SpreadsheetApp.create` e `openById` exigem `spreadsheets`; escopo de `Spreadsheet.copy`: sem fonte | C·NV | SN | 01: `spreadsheets` mantido; backup sem `Spreadsheet.copy` |
| F-30 Escopos | `DriveApp` força o escopo `drive` completo | C·V | RD | 01: `DriveApp.*` proibido por lint |
| F-31 Drive | O serviço avançado Drive funciona com `drive.file` em arquivo criado pelo projeto; arquivo alheio devolve "File not Found"; o ReDriveApp só testou a v2 | C·V | RD | 01: todo arquivo nasce pela Drive API; SP-02 |
| F-32 Drive | Planilha criada por `SpreadsheetApp.create` conta como "do app" para `drive.file`? Sem fonte | SF | — | 01: banco criado por `Drive.Files.create` |
| F-33 Drive | Upload com MIME de planilha Google converte o XLSX; `Drive.Files.create(resource, blob, args)` e `Drive.Files.copy(resource, fileId, args)` | C·V | DD; T; AM | 01: importação XLSX; 06: backup |
| F-34 Drive | `files.copy` sem `parents` herda a pasta do original; `thumbnailLink` tem curta duração, CORS e exige credencial | C·V | DD | 06: backup com `parents`; 08: fotos pelo backend |
| F-35 Exportação | `Drive.Files.export()` do serviço avançado tem defeito relatado; contorno: `UrlFetchApp` em `/drive/v3/files/{id}/export?mimeType=…` com Bearer de `ScriptApp.getOAuthToken()` | C·V | RD (linhas 428–446); T | 01: XLSX e PDF; escopo `script.external_request` |
| F-36 Exportação | `files.export` limita o conteúdo a 10 MB | C·V | DD | 01: teto de 10 MB |
| F-37 Exportação | URL `docs.google.com/…/export`: não documentada; relatos de 401 e de exigência de escopo de Drive | SF | SN | Não usada |
| F-38 Exportação | HTML para PDF por `getAs('application/pdf')`: o método existe (V); fidelidade de CSS limitada, segundo relatos | SF | T; SN | 01: alternativa de PDF; SP-07 |
| F-39 Gatilhos | `newTrigger(fn).timeBased()` com `everyDays`, `everyWeeks`, `atHour`, `onWeekDay`, `inTimezone`; `getProjectTriggers()`, `getHandlerFunction()`, `deleteTrigger(t)`. `atHour` dispara em minuto aleatório (NV) | C·V | T; PF-40 | 06: `ensureTriggers_`; gatilho diário único |
| F-40 Gatilhos | Gatilho chamando função terminada em `_`: sem fonte | SF | SN | 01: handlers públicos com guarda; SP-09 |
| F-41 Desempenho | 10 colunas × 1 milhão de linhas (04/2022): leitura em 85 s por `getValues` e 45 s pela Sheets API; `setValues` não terminou em 6 min, Sheets API 220 s | C·V | BM | 06: orçamento p95 e `reads[]`; SP-05 |
| F-42 Desempenho | Custo por chamada do PropertiesService: sem números; `getProperties()` traz todas as chaves de uma vez (V) | SF | T | 01: um `getProperties()` por execução; SP-05 |
| F-43 Anexos | Com `drive.file`, os bytes vêm por `GET /drive/v3/files/{id}?alt=media` com Bearer e `Utilities.base64Encode`; `UrlFetchApp.fetchAll` busca em lote; `DriveApp.getThumbnail` exigiria `drive` | C·V | T; DD; RD | 08: miniatura e imagem como data URL; 03a: `thumb_drive_file_id` |

**Leitura de F-41 para o orçamento do SP-05** (extrapolação linear, não medição). Custo = tempo ÷ células lidas: 85 s ÷ 10 milhões = 8,5 s por milhão com `getValues`; 45 s ÷ 10 milhões = 4,5 s pela Sheets API. EVENTO_ANIMAIS tem 14 colunas: 10 mil linhas = 140 mil células ≈ 1,2 s; 100 mil linhas = 1,4 milhão ≈ 11,9 s (6,3 s pela Sheets API). Uma única aba consumiria 11,9 dos 15 s do orçamento; daí `reads[]` por comando e o arquivamento em 60 mil linhas (840 mil células ≈ 7,1 s).

## 3. O que mudou desde a pesquisa do projeto irmão (24/10/2026)

| Item | Antes | Em 13/11/2026 | Efeito no desenho |
|---|---|---|---|
| Discovery da Apps Script API | rev. 20261011 | rev. 20261106; `WebAppConfig` inalterado | Nenhum |
| Tipos `@types/google-apps-script` | 2.0.13 | 2.0.15 | Nenhum |
| Rastreador de cotas | checkedAt 2026-09-28 | Mesma coleta e valores; entram 250 planilhas criadas/dia e 200 versões por script | Limita planilhas temporárias e publicações |
| Limite de células | 10 milhões (desenho v1) | 20 milhões desde 10/09/2026 (NV) | Planejamento mantém 10 milhões |
| Fontes dos temas do ERP | — | Discovery de Sheets v4 e Drive v3, ReDriveApp, amostras oficiais, benchmarks | Sustentam primitiva tipada, atomicidade e `drive.file` |
| E-mail em `USER_DEPLOYING` + `MYSELF` | Em aberto (PF-58) | Continua sem fonte | SP-04 |

Reaproveitados sem releitura (seguem NV): PF-32 a PF-36, PF-39 e PF-40.

## 4. Sem fonte: só teste real resolve

| Pergunta em aberto | Fatos | Spike | Critério de aprovação | Se reprovar |
|---|---|---|---|---|
| `setValues` em célula `@` preserva `=1+1`, `0012`, `1E5` e datas? A atomicidade do `batchUpdate` vale pelo serviço avançado? | F-17; F-12 (V só em documento) | SP-01 | Os 14 valores do corpus voltam idênticos; request inválido no meio: nada aplicado | Corpus: grava-se só pela Sheets API (F-11). Atomicidade: três fases completas em todo comando |
| Linha nova herda `@`? `deleteRows` deixa a aba só com o cabeçalho? | F-10, F-17 | SP-10 (só com `SpreadsheetApp`) | Linhas novas mantêm formato de texto | Formato aplicado a cada bloco: `insertRowsAfter`, `setNumberFormats`, `setValues` |
| O lock é liberado quando a execução morre por timeout? O que sobra das escritas sem `flush()`? | F-08 | SP-03 | `tryLock` volta a ter sucesso; o estado encontrado é um dos previstos | Recuperação ajustada ao observado |
| `drive.file` funciona com o serviço avançado Drive v3? A planilha criada por `Drive.Files.create` abre com `openById`? | F-31; `openById` nesse caso não tem fato no material | SP-02 | create, copy, export, `alt=media`, list e update `trashed` só com `drive.file` | Drive v2 ou REST por `UrlFetchApp`; por fim, escopo `drive` com nova autorização |
| O dono recebe o próprio e-mail? O link abre com várias contas logadas? | F-25, F-26 | SP-04 | E-mail preenchido para o dono | Flag de contingência do `assertOwner_()`; perfil só com a conta dona |
| Tempo real de leitura e gravação; custo de `getProperties()`; abertura a frio | F-41, F-42 | SP-05 | p95 ≤ 5 s com 10 mil linhas em EVENTO_ANIMAIS e ≤ 15 s com 100 mil | Leitura por bloco de colunas; arquivamento antecipado |
| Payload de `google.script.run`; `localStorage` no iframe (Chrome Android, Safari iOS); `google.script.history` | F-21, F-23; `localStorage` não tem fato no material | SP-06 | Rascunho sobrevive a recarga e a fechamento do navegador | Rascunho no servidor; navegação com estado em memória |
| XLSX e PDF por `files.export` abrem no celular? HTML para PDF fica legível? | F-20, F-35, F-38 | SP-07 | O arquivo abre a partir do link | CSV sempre; PDF por conversão de HTML |
| Chart.js por CDN com SRI carrega no iframe? | Sem fato no material (F-20 só cobre HTTPS) | SP-08 | Carrega e desenha no celular e no desktop | Gráficos SVG próprios |
| O gatilho chama o handler? Os cinco escopos do manifesto bastam para criar gatilhos? | F-40; escopo de `ScriptApp.newTrigger` não tem fato no material | SP-09 | Dispara uma vez; repetir o `setup()` não duplica | Ajustar o registro de gatilhos; incluir o escopo que o erro indicar |

Sem item de spike, porque o desenho não depende da resposta: F-03 (34 abas), F-32 (nenhum arquivo nasce por `SpreadsheetApp.create`), F-37 (URL não usada) e o service worker de F-21 (PWA é futuro).

## 5. Decisões que dependem de fato NV

| Decisão (documento) | Fato | Risco se o fato for falso | Plano B |
|---|---|---|---|
| JSON ≤ 40.000 caracteres por célula (02, 03a, 03b) | F-02 | Limite real menor: a escrita falha no meio do commit | Baixar `json_celula_max_caracteres` |
| Lotes de importação e gatilhos dentro de 6 min e 90 min/dia (06, 10) | F-04 | Cota menor: lote ou gatilho é interrompido | Reduzir `importacao_lote_linhas`; a recuperação conclui ou anula a operação órfã |
| Recuperação e leitura otimista com `tryLock`; `flush()` antes de soltar (06) | F-07, F-08 | Lock preso após a morte da execução: LOCKED até expirar | A verdade está em OPERACOES; o SP-03 define a espera |
| Primitiva alternativa por `SpreadsheetApp` com `@` (06) | F-16, F-17 | Brinco `0012` gravado como 12, sem volta | Primitiva preferida é a Sheets API tipada (F-11, V) |
| Leitura normalizada pelo tipo declarado, com alerta de célula coercida (06) | F-18 | Data coercida não chega como `Date`: o alerta não dispara | `Values.batchGet` com `UNFORMATTED_VALUE`: data chega como número (V) |
| Sem `Date` no envelope; só sete funções sem `_` (01) | F-22 | `_` não oculta a função: o cliente chamaria rotinas internas sem guarda | `access = MYSELF` já limita a quem implantou (F-24, V) |
| `assertOwner_()` não presume e-mail (01) | F-25 | E-mail vazio: o dono seria barrado com DENIED | Flag de contingência; `MYSELF` segue barrando terceiros |
| Chart.js por CDN; exportação entregue por link `_blank` (01, 08) | F-20 | Gráfico não carrega ou arquivo não abre no celular | Tabela equivalente e SVG próprio; CSV montado no cliente |
| Escopo `spreadsheets` para `openById` (01) | F-29 | `setup()` falha por permissão | Escopo `drive` completo, com nova autorização |
