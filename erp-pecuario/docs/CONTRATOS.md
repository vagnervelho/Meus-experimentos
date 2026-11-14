# Contratos entre módulos (Fase 1)

Interfaces que cada etapa entrega para as seguintes. Uma seção curta por módulo: funções públicas, parâmetros,
retorno e erros. Quem acrescenta um módulo acrescenta a seção dele aqui. O desenho está em `docs/fase-0/`; este
arquivo descreve o que **existe no código**.

Estado: etapa BASE (E1.1 e parte da E1.2) — `Schema`, `Utils`, `Validation`, harness de testes e estrutura do projeto.

## 1. Regras que valem para todo arquivo de `src/`

Conferidas por `tests/static.test.js`; arquivo novo entra nas regras sem mexer no teste.

- Um arquivo `src/X.js` = um namespace `var X = (function () { ... return { ... }; })();`, com o nome do arquivo.
  Nada é executado na carga e nenhum arquivo cita outro em tempo de carga (só dentro de função): o teste carrega
  `src/` em ordem alfabética, na inversa e cada arquivo sozinho.
- Função de topo só em `Code.js`: as públicas `doGet`, `api`, `setup`, `runAcceptanceTests`, `runDiagnostics`,
  `verifyIntegrity`, `trgManutencaoDiaria`, `trgIntegridadeSemanal`; qualquer auxiliar de topo termina em `_`.
- Globais do Apps Script (`SpreadsheetApp`, `Sheets`, `Drive`, `LockService`, `PropertiesService`, `Session`,
  `ScriptApp`, `HtmlService`, `Utilities`, `UrlFetchApp`, `CacheService`) só em `Code`, `Api`, `Config`,
  `Database`, `FileService` e `Maintenance`. Os demais recebem portas (seção 5).
- Proibidos em qualquer arquivo: `DriveApp`, `SpreadsheetApp.create` e todo `.copy(` que não seja
  `Drive.Files.copy` (regra do escopo `drive.file`).
- Relógio: `new Date()` sem argumento e `Date.now()` só em `Database.js` (porta `Clock`). Construir data a partir
  de valor (`new Date(ms)`) é livre.
- Sem `import`/`export`/`require`; sem `TODO`/`FIXME`/`XXX`.
- Forma dos dados na LÓGICA (P6): ID, TEXTO, DATA (`yyyy-MM-dd`), TS (ISO-8601 UTC com milissegundos e `Z`) e
  ENUM são texto; INT, DEC1 e DEC4 são número; **DINHEIRO é inteiro em centavos**; BOOL é booleano; JSON é objeto
  ou lista. Vazio canônico = `null` (aceitos também `undefined` e `''`). A forma de CÉLULA (reais com 2 casas,
  `S`/`N`, JSON em texto) é assunto só do codec do `Database`.

## 2. `Schema` (gerado)

`src/Schema.js` é **gerado** por `npm run gen:schema` (`scripts/gen-schema.js`) a partir de
`03a-dicionario-cadastros-suporte.md` e `03b-dicionario-eventos-financeiro.md`, e conferido contra a seção 3 do
desenho-base. Não se edita à mão: muda-se o dicionário e gera-se de novo (`npm run gen:schema -- --check` só
confere). O teste falha se o arquivo gravado divergir do que o gerador produz.

| Membro | Conteúdo |
|---|---|
| `Schema.VERSAO` | Inteiro: versão do esquema (`SCHEMA_META.versao`). Hoje `1`; sobe no gerador quando o dicionário mudar |
| `Schema.SEMENTES_VERSAO` | Texto: versão do conjunto de sementes (`SCHEMA_META.sementes_versao`). Hoje `'1'` |
| `Schema.TIPOS` | `['ID','TEXTO','DATA','TS','INT','DEC1','DEC4','DINHEIRO','BOOL','ENUM','JSON']` |
| `Schema.MARCAS` | `['IMUTAVEL','PROJECAO','CTL','CAD']` |
| `Schema.TABELAS` | `{ABA: {nome, grupo, pk, colunas: [coluna...]}}`; `grupo` = `CADASTROS`, `EVENTOS`, `FINANCEIRO` ou `SUPORTE` |
| `Schema.ENUMS` | `{NOME: [valores]}` — 58 enums fechados; `EFEITO_INVENTARIO` é numérico (`[1, 0, -1]`) |
| `Schema.ENUMS_DEPENDENTES` | `{'EVENTOS.event_subtype': {por: 'event_type', valores: {SANIDADE: [...], ...}}, 'REPRODUCAO.metodo': {por: 'tipo_evento', valores: {...}}}` |
| `Schema.VOCABULARIOS` | Vocabulários que não são coluna: `CODIGO_ERRO`, `MOTIVO_INDICADOR_NULO`, `POLITICA_AVISO`, `SITUACAO_OPERACAO`, `UNIDADE_PESO_EXIBICAO` |
| `Schema.LISTAS_SEMENTE` | `{LISTA: [{codigo, rotulo, ordem, reservado?}]}` — 11 listas, 69 itens; `reservado: true` só em `FINALIDADE_NEGOCIO.ABATE` e `TIPO_DEDUCAO_VENDA.FRETE`/`COMISSAO` |
| `Schema.SEMENTES.CONFIGURACOES` | 45 × `{chave, grupo, tipo, padrao, descricao, formato?}`; `padrao` é o texto da célula (`'450'`, `'-1.0'`, `'S'`, `'[12,24,36]'`, `''` = não informado); `formato: 'DATA'` nas chaves de data |
| `Schema.SEMENTES.CATEGORIAS` | 9 × registro na forma da lógica, sem `category_id` |
| `Schema.SEMENTES.PLANO_CONTAS` | 29 × registro na forma da lógica, sem `conta_id` (`sistema` e `ativo` booleanos) |

Coluna (objeto congelado, sempre com todos os campos):

```js
{ nome, tipo, obrig: 'S' | 'N' | 'COND', marca, indice,        // indice = posição física, a partir de 0
  auto,            // true: preenchida pelo servidor, nunca enviada pelo cliente
  condicao,        // texto do dicionário quando obrig = 'COND' (ex.: 'COMPRA, VENDA'); senão null
  pk,              // true só na primeira coluna
  enum, valores,   // nome do enum; `valores` = recorte da coluna quando ela aceita só parte do enum
  multi,           // true: vários códigos do enum separados por vírgula (PARCEIROS.tipos)
  fk,              // {tabela, coluna} ou null
  lista,           // nome da lista aberta (LISTAS) ou null
  travaAposUso,    // true: [cad] que fica imutável depois do primeiro lançamento (PLANO_CONTAS)
  min, minExclusivo, max, maxExclusivo }   // faixa do dicionário ("> 0", "≥ 1", "0 < x < 100"); DINHEIRO em reais
```

Funções (puras; os objetos devolvidos são os próprios do Schema, congelados):

| Função | Devolve | Erro |
|---|---|---|
| `nomesTabelas()` | Cópia da lista das 34 abas, na ordem do desenho-base | — |
| `temTabela(nome)`, `temColuna(tabela, coluna)` | Booleano | — |
| `tabela(nome)` | Definição da aba | `Error` se a aba não existe (erro de programação) |
| `colunas(nome)` | Cópia dos NOMES das colunas, na ordem física (linha de cabeçalho) | idem |
| `coluna(tabela, coluna)` | Definição da coluna | `Error` se não existe |
| `pk(tabela)` | Nome da coluna de chave | idem |
| `enumValores(nome)` | Valores do enum | `Error` se não existe |
| `valoresDaColuna(tabela, coluna, registro?)` | Valores aceitos: recorte da coluna, conjunto do enum dependente (olhando `registro`) ou o enum inteiro; `null` se a coluna não tem enum | idem |

## 3. `Utils` (puro)

Entrada malformada lança `AppError` (seção 4): `INTERNAL` quando é erro de quem chamou, `VALIDATION` quando o
dado vem do usuário, `CONFIG` no fuso. `Utils` só cita `Validation` para lançar erro.

| Função | Contrato |
|---|---|
| `vazio(v)` | `true` para `null`, `undefined` e `''` (zero e `false` não são vazios) |
| `dataValida(s)` | Data de calendário real em `yyyy-MM-dd` |
| `diffDias(de, ate)` | Dias de `de` até `ate` (negativo se `ate` é anterior) |
| `somaDias(data, n)` | Data `n` dias depois (`n` inteiro, pode ser negativo) |
| `compararDatas(a, b)` | `-1`, `0` ou `1` |
| `idadeMeses(nascimento, naData)` | Meses completos (regra de `03a`, seção 4.5); negativo se `naData` é anterior |
| `hoje(instante, fuso)` | `yyyy-MM-dd` do instante (ISO ou ms) no fuso IANA; fuso inválido → `CONFIG`. O instante vem da porta `Clock` |
| `instanteValido(s)`, `instanteIso(ms)` | Formato `2026-11-14T01:30:00.000Z` |
| `dentroDoIntervalo(data, inicio, fim)` | Limites inclusivos; limite vazio = aberto |
| `diasNoIntervalo(inicio, fim)` | Dias contando os dois limites |
| `intersecaoIntervalos(iA, fA, iB, fB)` | `{inicio, fim, dias}` (`dias = null` se aberta) ou `null` se não se tocam |
| `arredondar(valor, casas)` | Meio para cima sobre o decimal informado (387,45 → 387,5) |
| `casasDecimais(valor)` | Casas realmente usadas, ignorando ruído binário |
| `reaisParaCentavos(reais)`, `centavosParaReais(centavos)` | Conversão do codec; vazio → `null` |
| `formatarReais(centavos)` | `'R$ 1.234,56'` para mensagens |
| `ratear(totalCentavos, itens)` | Ver abaixo |
| `aparar(texto)` | Sem espaços nas pontas; vazio → `''` |
| `normalizarBrinco(texto, manterZeros?)` | Forma canônica (`03a`, DL-04): `' 0012 '` → `'12'`; `'br 07'` → `'BR07'`; com `manterZeros`, `'0012'` |
| `normalizarTexto(texto)` | Chave de busca: sem acento, minúsculas, um espaço |
| `jsonCanonico(valor)` | Chaves ordenadas em todos os níveis, sem espaços, vazios omitidos, listas na ordem; `Date`, `NaN` e função → `VALIDATION` |
| `payloadHash(rota, dados, hash)` | SHA-256 hexadecimal de `jsonCanonico({rota, dados})`; `hash` é a porta de hash |
| `bytesParaHex(bytes)` | Bytes com sinal (`Utilities.computeDigest`) → hexadecimal; serve à implementação da porta de hash |
| `indexarPor(lista, campo)` | `{chave: item}`; chave repetida fica com o primeiro; `campo` é nome ou função |
| `agruparPor(lista, campo)`, `somar(lista, campo)`, `maximo(lista, campo)` | `maximo` devolve `null` em lista vazia (base do "máximo + 1") |
| `ordenarPor(lista, criterios)` | Cópia ordenada e estável; critério = nome, função ou `{campo, desc: true}`; vazio vai para o fim |
| `unicos(lista)`, `emBlocos(lista, tamanho)`, `clonar(valor)` | — |

**`ratear(totalCentavos, itens)`** — maior resto em inteiros exatos (`03b`, seção 13.3).
`itens = [{chave, base}]`, com `base ≥ 0` e até 4 casas. Devolve
`{itens: [{chave, base, valor}], baseTotal, totalAlocado}`, com `itens` na ordem recebida e `valor` em centavos.
Sobra: maior resto; empate, maior base; persistindo, menor `chave` em ordem de texto — passe o `codigo_interno`
como chave. O resultado não depende da ordem de entrada. Base total zero: ninguém recebe e `totalAlocado = 0`.
`VALIDATION` para chave repetida, base negativa ou com mais de 4 casas, total não inteiro ou negativo, e soma das
bases acima de ~4,5 × 10¹¹ (nunca arredonda em silêncio).

## 4. `Validation` (puro)

**Erro de aplicação.** `Validation.erro(code, message, details?)` cria um `AppError` (`throw Validation.erro(...)`);
`Validation.AppError` é o construtor. `code` ∈ `Validation.CODIGOS` (`VALIDATION`, `CONFLICT`,
`NEEDS_CONFIRMATION`, `IDEMPOTENCY_MISMATCH`, `LOCKED`, `DENIED`, `NOT_FOUND`, `CONFIG`, `INTERNAL`); código fora
da lista lança `Error`. `message` é escrita para o pecuarista. `details` é normalizado por `Validation.detalhe(d)`
para a forma de `01-arquitetura.md`, seção 3.3, com `null` no que não se aplica:

```js
{ codigo, animal_id, brinco, campo, mensagem, conflito: { event_id, tipo, data } | null }
```

| Função | Contrato |
|---|---|
| `ehAppError(e)` | Reconhece pelo `name` e pelo `code` (funciona entre arquivos) |
| `serializarErro(e)` | `{code, message, details}` para o envelope; exceção comum vira `INTERNAL` com texto genérico, sem vazar o detalhe |
| `validarValor(coluna, valor, opcoes?)` | Valor NÃO vazio contra a definição da coluna: `null` ou `{codigo, mensagem}` |
| `validarRegistro(tabela, registro, opcoes?)` | Lista de detalhes (vazia = certo), um por campo com problema |
| `exigirRegistro(tabela, registro, opcoes?)` | Como a anterior, mas lança `VALIDATION` com os detalhes |
| `validarTeto(texto, tetoCelula?)` | `null` ou `{codigo: 'TEXTO_LONGO_DEMAIS', mensagem}` |
| `coletor()` | `{erros, avisos, erro(d), aviso(d), temErros(), lancarSeErros(mensagem?)}` |

Opções de `validarRegistro`: `parcial` (só os campos presentes — edição `[cad]`); `semProjecoes` (não exige
coluna `*` obrigatória — linha anexada na fase A); `tetoCelula` (padrão `Validation.TETO_CELULA` = 40.000; passe
`json_celula_max_caracteres`); `listas` (`{LISTA: [códigos vigentes]}` para conferir coluna de lista aberta);
`animal_id` e `brinco` (copiados para cada detalhe).

O que `validarRegistro` confere: campo desconhecido; obrigatório (`obrig = 'S'`) vazio; tipo e formato; enum
(com recorte, dependência e multivalor); faixa do dicionário; teto de caracteres de TEXTO e de JSON serializado.
O que NÃO confere (é regra do evento ou do serviço): obrigatoriedade `COND`, existência de FK, unicidade, linha
do tempo. Códigos de detalhe (`Validation.DETALHE`): `CAMPO_OBRIGATORIO`, `CAMPO_DESCONHECIDO`, `TIPO_INVALIDO`,
`FORMATO_INVALIDO`, `VALOR_FORA_DA_LISTA`, `VALOR_FORA_DA_FAIXA`, `TEXTO_LONGO_DEMAIS`.

## 5. Portas do contexto de execução

O domínio puro recebe portas; nunca chama o Apps Script. As três abaixo já são consumidas ou oferecidas pelo
harness (`gas.portas()`); a implementação real é do `Database`/`Api`. Portas novas (repositório, lock, arquivos)
são documentadas aqui por quem as criar.

| Porta | Contrato | Implementação real prevista |
|---|---|---|
| `hash` | `sha256Hex(texto) → 64 caracteres hexadecimais minúsculos` (UTF-8) | `Utils.bytesParaHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8))` |
| `clock` | `agoraMs() → number`; `agora() → instante ISO-8601 UTC`. "Hoje" = `Utils.hoje(clock.agora(), fuso)` | Único lugar com `new Date()` sem argumento |
| `idGen` | `uuid() → UUID minúsculo de 36 caracteres` | `Utilities.getUuid()` |

## 6. Harness de testes (`tests/harness.js`)

`node --test tests/*.test.js`. Todo teste que toca serviço do Apps Script usa `createGas`:

```js
const { createGas, ORDENS } = require('./harness');
const gas = createGas({ order: 'alpha' });   // opções: email, order ('alpha' | 'reverse'), files, fakeClock, planilha, uuidAleatorio
const G = gas.G;                               // o contexto: G.Utils, G.Schema, G.SpreadsheetApp, G.Sheets, G.Drive...
const id = gas.planilhas.criar('Banco');       // planilha do app, criada pelo fake do Drive
const valor = gas.exec(() => G.api({ rota: 'x', dados: {} }));   // UMA execução do Apps Script
```

Padrões de propósito diferentes dos do app, para o teste acusar o que o `setup()` esquecer: planilha nova nasce
`en_US`, fuso `Etc/GMT`, com uma aba `Página1` de 1000 × 26. Relógio falso em 13/11/2026 10:00 de Porto Velho
(`2026-11-13T14:00:00.000Z`); `Utilities.sleep` e a espera do lock avançam o relógio. `Utilities.getUuid()` é
sequencial (`00000000-0000-4000-8000-000000000001`...). `CacheService` e `DriveApp` não existem no contexto.
Objetos que o harness devolve ao código são do próprio contexto (`instanceof Date` funciona); nos `assert` do
teste, compare com `JSON.parse(JSON.stringify(x))`.

### 6.1 Execuções, buffer e morte

| API | O que faz |
|---|---|
| `gas.exec(fn, {seLancar}?)` | Roda `fn` como uma execução. Fim normal: descarrega as escritas pendentes e solta o lock. Relança a exceção de `fn`. Na morte, lança erro com `execucaoMorta: true`, `pendentes` e `chegaram` |
| `gas.tentar(fn, {seLancar}?)` | Igual, mas nunca lança: `{ok, valor, erro, morta, pendentes, chegaram}`. Use dentro de ganchos |
| `gas.matar({chegam}?)` | Mata a execução corrente (dentro de `exec`/`tentar`). `chegam`: `'nenhuma'` (padrão), `'todas'`, número (prefixo), lista de índices, lista de booleanos ou função `(pendentes) → lista` |
| `gas.pendentes()` | Escritas de `SpreadsheetApp` ainda não descarregadas: `[{ss, aba, tipo, intervalo, numero}]` |
| `gas.fimDaExecucao()` | Encerra a execução "ambiente": o que o teste faz direto, fora de `exec`, também é uma execução, que termina (descarrega e solta o lock) aqui ou quando o próximo `exec`/`tentar` começa |
| `gas.falhas.falharNaEscrita(n, {aba, tipo, mensagem}?)` | A n-ésima escrita (contada a partir da chamada, entre as que casam com o filtro) lança erro TRATÁVEL e não é aplicada |
| `gas.falhas.matarNaEscrita(n, {aba, tipo, chegam, incluiAtual}?)` | A n-ésima escrita mata a execução; com `incluiAtual` ela é feita antes (API: gravada, resposta perdida) |
| `gas.falhas.limpar()`, `gas.falhas.escritas()` | Remove regras pendentes; total de escritas até agora |
| `gas.ganchos.em(evento, fn, {vezes}?)` | Eventos: `lock.tentar`, `lock.obtido`, `lock.liberado`, `flush`, `escrita`, `props.lido`, `props.gravar`. Uma vez por padrão. Dentro de `fn` pode-se rodar outra execução, segurar o lock ou matar |

`tipo` de escrita: `valores`, `formato`, `linhas`, `colunas`, `aba`, `propriedades` (SpreadsheetApp) e `api`
(cada chamada de `Sheets.Spreadsheets.batchUpdate` ou `Values.batchUpdate` conta uma escrita).

Regras do modelo:
- Escrita por `SpreadsheetApp` fica pendente até `SpreadsheetApp.flush()` ou o fim normal da execução; a própria
  execução enxerga o que escreveu. Escrita e leitura pelo serviço `Sheets` são imediatas e **não enxergam** o
  buffer pendente. `Drive.Files.copy` copia só o que já é durável. Properties gravam na hora e sobrevivem à morte.
- Depois de `matar`, todo serviço lança de novo, mesmo que o código capture a exceção: `catch` e `finally` não
  conseguem gravar nada.
- Execução aninhada (`gas.tentar` dentro de um gancho) é OUTRA execução: não vê as pendentes da primeira, que
  fica suspensa e depois reaplica as suas por cima.

### 6.2 Lock

`LockService.getScriptLock()`: `tryLock(ms)`, `waitLock(ms)`, `releaseLock()`, `hasLock()`. O dono é a execução
(reentrante). O lock cai ao fim da execução — normal, com exceção ou por morte. `getDocumentLock()` devolve `null`.

| API | O que faz |
|---|---|
| `gas.lock.segurarPorOutra({liberaEmMs}?)` | Outra execução (simulada) segura o lock; com `liberaEmMs`, solta sozinha depois desse tempo de relógio |
| `gas.lock.soltarOutra()`, `gas.lock.dono()` | `dono()` → `null`, `'outra'` ou o número da execução |
| `gas.lock.estatisticas()` | `{tentativas: [ms...], aquisicoes, liberacoes}` |

Intercalação "entre ler o marcador e obter o lock": `gas.ganchos.em('lock.tentar', () => gas.tentar(outraExecucao))`.

### 6.3 Planilha (`gas.planilhas`)

`criar(nome, pais?)`, `ids()`, `existe(id)`, `abas(id)`, `propriedades(id)` (`{nome, fuso, locale}`),
`dimensoes(id, aba)`, `matriz(id, aba)` (valores internos como a execução os vê), `matrizDuravel(id, aba)` (só o
que já é durável), `formatos(id, aba)`, `objetos(id, aba)` (linha 1 como cabeçalho), `gravar(id, aba, linha,
coluna, matriz, formato?)` (direto no estado durável, sem coerção), `digitar(id, aba, linha, coluna, texto)` (o
dono edita à mão: vale a coerção do formato da célula), `tornarInacessivel(id)`.
Valor interno: `''`, texto, número, booleano, `{data: serial}` (dias desde 30/12/1899) ou `{formula, valor}`.

Fachadas emuladas. `SpreadsheetApp`: `openById`, `flush`, `getActiveSpreadsheet` (`null`). Spreadsheet: `getId`,
`getName`, `rename`, `getSheets`, `getSheetByName`, `insertSheet`, `deleteSheet`, `get/setSpreadsheetTimeZone`,
`get/setSpreadsheetLocale`. Sheet: `getName`, `setName`, `getSheetId`, `getLastRow`, `getLastColumn`,
`getMaxRows`, `getMaxColumns`, `getRange` (números ou A1), `getDataRange`, `insertRowsAfter`, `insertRowsBefore`,
`insertColumnsAfter`, `deleteRows`, `deleteColumns`, `appendRow`, `setFrozenRows`, `protect().setWarningOnly`,
`getProtections`. Range: `getValues`, `getValue`, `getDisplayValues`, `getFormulas`, `getNumberFormats`,
`setValues`, `setValue`, `setNumberFormats`, `setNumberFormat`, `clearContent`.
`Sheets`: `Spreadsheets.get`; `Spreadsheets.batchUpdate` com `addSheet`, `appendCells`, `updateCells`,
`appendDimension`, `deleteDimension`, `updateSheetProperties`, `updateSpreadsheetProperties`;
`Spreadsheets.Values.batchGet`, `get` (`valueRenderOption` `UNFORMATTED_VALUE`, `FORMATTED_VALUE`, `FORMULA`) e
`batchUpdate` (`valueInputOption` `RAW` ou `USER_ENTERED`). Pedido ou método fora dessa lista lança erro.

### 6.4 Drive e UrlFetchApp (`gas.drive`, `gas.http`)

`Drive.Files.create(resource, mediaData?, optionalArgs?)`, `copy(resource, fileId, optionalArgs?)`,
`update(resource, fileId, mediaData?, optionalArgs?)` (`addParents`, `removeParents`), `get(fileId, {fields} |
{alt: 'media'})`, `list({q, orderBy, pageSize, pageToken, fields})`, `export(fileId, mimeType)` (devolve `void`,
como nos tipos), `remove(fileId)`. Campos padrão da resposta: `kind`, `id`, `name`, `mimeType`; os demais só com
`fields`. Cláusulas de `q` emuladas: `'<id>' in parents`, `name =`/`!=`/`contains`, `mimeType =`/`!=`,
`trashed =`, `appProperties has { key='k' and value='v' }`, `createdTime`/`modifiedTime` com `<`, `<=`, `>`, `>=`,
ligadas por `and`; outra cláusula lança erro.
REST por `UrlFetchApp` (exige `Authorization: Bearer <ScriptApp.getOAuthToken()>`):
`GET https://www.googleapis.com/drive/v3/files/{id}?alt=media` e `GET .../files/{id}/export?mimeType=...`
(`text/csv`, XLSX, `application/pdf`; acima de 10 MB responde 403). Outros hosts: `gas.http.handler = (req) => ({code, body})`.
Apoio: `gas.drive.arvore()`, `arquivo(id)`, `conteudo(id)`, `chamadas`, `plantarExterno({name, mimeType,
conteudo})` (arquivo que o app não criou: invisível sob `drive.file`, inclusive para `SpreadsheetApp.openById`),
`definirTamanhoExportado(id, bytes)`, `definirDatas(id, {createdTime, modifiedTime})`, `MIME_PASTA`,
`MIME_PLANILHA`, `MIME_XLSX`.

### 6.5 O que no fake é hipótese

Nada disto foi conferido na conta real; o `runDiagnostics` precisa medir e, onde divergir, corrige-se o fake.

| Comportamento emulado | Onde conferir |
|---|---|
| Coerção de célula "Geral" por `setValues` (tabela em `tests/fixtures/coercao.json`); texto preservado com formato `@` aplicado antes, inclusive o iniciado por `=`; número gravado em célula `@` vira texto | SP-01: o diagnóstico grava o corpus e devolve um JSON no MESMO formato do fixture (`{locale, casos: [{entrada, geral: {tipo, valor}}]}`) |
| `Spreadsheets.batchUpdate` atômico; `Values.batchUpdate` NÃO atômico entre intervalos | SP-01 |
| Gravar além da grade por `setValues` lança erro (não cresce sozinho); linha inserida herda o formato da linha de cima (`planilha: {herdaFormato: false}` inverte) | SP-10 |
| Escritas pendentes: chegam todas no fim normal e na exceção não tratada; na morte, qualquer subconjunto | SP-03 |
| Lock por execução, reentrante, liberado ao fim da execução | SP-03 |
| `Drive.Files.copy` leva as `appProperties` do original; planilha criada pelo Drive nasce com locale e fuso que não são os do app | SP-02 |
| `Intl.DateTimeFormat` com `timeZone` existe no runtime V8 (usado por `Utils.hoje`) | Diagnóstico: comparar `Utils.hoje` com `Utilities.formatDate` |

## 7. Scripts e estrutura

| Comando | O que faz |
|---|---|
| `npm test` | `node --test tests/*.test.js` |
| `npm run gen:schema` | Regenera `src/Schema.js`; `-- --check` só confere e sai com 1 se estiver desatualizado |
| `npm run ui:check` | Confere `src/*.html`: nenhum recurso externo e página ≤ 450 KB (`conferirPaginas` é reutilizável pela etapa das telas) |
| `npm run gas:push` | Envia `src/` com o clasp (versão fixa por `npx`) e publica; `-- --no-deploy` só envia. Recusa manifesto que não seja o do projeto |

`src/appsscript.json`: fuso `America/Porto_Velho`, V8, Web App `USER_DEPLOYING` + `MYSELF`, cinco escopos
(`spreadsheets`, `drive.file`, `script.scriptapp`, `userinfo.email`, `script.external_request`), serviços avançados
`Sheets` v4 e `Drive` v3, `urlFetchWhitelist` só com `https://www.googleapis.com/`. Mudar o manifesto exige mudar
`tests/static.test.js` e `scripts/push-gas.js` juntos (a contingência do escopo `drive` completo já é aceita pelo
`gas:push`, no lugar de `drive.file`).
