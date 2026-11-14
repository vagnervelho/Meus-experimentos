# Contratos entre módulos (Fase 1)

Interfaces que cada etapa entrega para as seguintes. Uma seção curta por módulo: funções públicas, parâmetros,
retorno e erros. Quem acrescenta um módulo acrescenta a seção dele aqui. O desenho está em `docs/fase-0/`; este
arquivo descreve o que **existe no código**.

Estado: etapas BASE (E1.1 e parte da E1.2) — `Schema`, `Utils`, `Validation`, harness e estrutura — e PERSISTÊNCIA
(E1.3 e E1.4) — `Database`, `Repository`, `UnitOfWork` e `AuditService` (parte 1).

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

## 5. Portas e contexto de execução

O domínio puro nunca chama o Apps Script: recebe um **contexto** por execução, com portas. Em produção, a `Api`
monta o contexto com `Database.contexto(opcoes)`; nos testes, o mesmo objeto é montado sobre os fakes do harness
(`tests/apoio-persistencia.js`). Um contexto vale para UMA execução do Apps Script (não se guarda entre execuções).

| Campo | Contrato | Implementação real |
|---|---|---|
| `banco` | Id da planilha-banco. Sufixo das chaves `DATA_VERSION:<banco>` e `PENDING_OP:<banco>` | `SPREADSHEET_ID`, ou `TEST_`/`DEMO_SPREADSHEET_ID` com `ambiente` (Api) |
| `io` | Porta de E/S da planilha (seção 8) | `Database.abrir(banco, {primitiva})` |
| `lock` | `tentar(ms) → booleano` (espera até `ms`); `soltar()`; `tem() → booleano` | `LockService.getScriptLock()`: `tryLock`, `releaseLock`, `hasLock` |
| `clock` | `agoraMs() → number`; `agora() → instante ISO-8601 UTC`. "Hoje" = `Utils.hoje(clock.agora(), fuso)` | Único lugar com `new Date()` sem argumento |
| `idGen` | `uuid() → UUID minúsculo de 36 caracteres` | `Utilities.getUuid()` |
| `hash` | `sha256Hex(texto) → 64 caracteres hexadecimais minúsculos` (UTF-8) | `Utilities.computeDigest(SHA_256, texto, UTF_8)` + `Utils.bytesParaHex` |
| `props` | `ler() → {chave: texto}` (UM `getProperties()` por chamada: o retrato de um ponto de leitura); `gravar(chave, valor)`; `remover(chave)` | `PropertiesService.getScriptProperties()` |
| `files` | `FileStore` (Drive: backups, anexos, exportações) | `FileService` (etapa posterior); `null` até lá |
| `session` | Sessão do pedido (dono, e-mail ativo) | `Api` (etapa posterior); `null` até lá |
| `usuario` | E-mail de quem executa; obrigatório em `UnitOfWork.run` (vai para `OPERACOES.usuario`, `created_by`, `AUDITORIA.usuario`) | `Api` |
| `fuso` | Fuso IANA de "hoje" | `CONFIGURACOES.fuso` (Api); padrão `Session.getScriptTimeZone()` |
| `projecoes` | Porta do projetor: `{reads: [abas], reconstruir(tx, escopo)}` (seção 10.4); `null` = a fase C só refaz `EVENTOS.status` e a auditoria | `Timeline` (etapa seguinte) |
| `errosPendentes` | Fila de registros de ERROS_LOG da execução (`UnitOfWork.anotarErro`) | — |

O tratador de comando ou consulta recebe da `UnitOfWork` o objeto **`tx`**:

| Campo | Conteúdo |
|---|---|
| `repo` | Fachada pública do `Repository`: só linhas VIGENTES das abas declaradas em `reads` (seção 9) |
| `cru` | Fachada de leitura crua (inclui linhas inertes) — só com `acessoCru: true` (recuperação, integridade) e na porta de projeções; senão `null` |
| `plano` | Plano de escrita (`Repository.plano()`): `anexar(tabela, registro)`, `auditar(mudanca)` |
| `rota`, `dados`, `avisosAceitos` | Do pedido |
| `usuario`, `agora`, `hoje` | Quem, o instante da unidade (ISO) e a data de hoje no fuso |
| `opId` | Id da operação que será aberta (comando) |
| `novoId()` | UUID novo (chave de registro criado no plano) |
| `simulacao` | `true` no modo `SIMULAR` |
| `dataVersion` | Versão dos dados lida pela unidade |
| `ctx` | O contexto (para `ctx.io.normalizarValor` e afins) |

### 5.1 Como um serviço de domínio escreve um comando e uma consulta

```js
// Comando SEM evento (cadastro [cad]): o tratador só valida e põe mudanças no plano; quem grava é a UnitOfWork.
function salvarPasto_(ctx, pedido) {
  return UnitOfWork.run(ctx, {
    rota: 'pasto.salvar', idempotencyKey: pedido.idempotencyKey, dados: pedido.dados,
    avisosAceitos: pedido.avisosAceitos, reads: ['PASTOS', 'PROPRIEDADES'],
    tratador: function (tx) {
      var d = tx.dados;
      var erros = Validation.validarRegistro('PASTOS', d.campos, { parcial: true });
      if (d.campos.property_id && !tx.repo.porId('PROPRIEDADES', d.campos.property_id)) erros.push(Validation.detalhe({ codigo: 'NAO_ENCONTRADO', campo: 'property_id', mensagem: 'Propriedade não encontrada.' }));
      if (erros.length) return { erros: erros };                       // VALIDATION, nada gravado
      var id = d.pasture_id || tx.novoId();
      if (d.pasture_id) AuditService.alteracao(tx, 'PASTOS', id, d.campos, d.justificativa); // ALTERAR/CONTROLE
      else AuditService.criacao(tx, 'PASTOS', id, d.campos);                                 // CRIAR (linha nasce na fase C)
      return {
        resumo: { pasture_id: id },                                    // OPERACOES.resumo_json (só cabeçalho)
        resposta: function (t) { return Utils.clonar(t.repo.porId('PASTOS', id)); },       // lida DEPOIS da fase C
      };
    },
    reconstruir: function (tx, op) { return Utils.clonar(tx.repo.porId('PASTOS', op.resumo.pasture_id)); }, // duplicado
  });
}

// Comando de EVENTO: linhas inertes na fase A (EVENTOS + filhas); a fase C projeta pelo escopo `derivados`.
tratador: function (tx) {
  var eventId = tx.novoId();
  tx.plano.anexar('EVENTOS', { event_id: eventId, event_seq: tx.repo.contador('EVENTOS', 'event_seq'),
    event_type: 'OUTRA_ENTRADA', event_date: d.data, registration_date: tx.hoje, property_id: d.property_id,
    source: 'APP', pre_marco_zero: false });                          // op_id, status, chave, created_* são carimbados
  tx.plano.anexar('EVENTO_ANIMAIS', { event_animal_id: tx.novoId(), event_id: eventId, animal_id: animalId,
    papel: 'SUJEITO', efeito_inventario: 1 });
  return { avisos: avisos, resumo: { event_id: eventId, event_type: 'OUTRA_ENTRADA', animais: 1 },
           derivados: { animais: [animalId] }, resposta: function (t) { return { event_id: eventId }; } };
}

// Consulta: sem lock, leitura otimista validada; só vigentes.
UnitOfWork.read(ctx, { rota: 'pasto.listar', reads: ['PASTOS'], tratador: function (tx) {
  return tx.repo.vigentes('PASTOS').map(Utils.clonar);
} });
```

Regras do tratador: lê só as abas de `reads` (outra aba → `INTERNAL`); não altera registro do `repo` (clone antes
de devolver); não grava nada direto; não abre outra unidade (`run`, `read`, `status`, `recoverAll`, `exclusivo`
dentro de tratador → `INTERNAL`); não lê relógio nem gera id fora de `tx.agora`/`tx.novoId()`. O mesmo tratador
serve ao modo `SIMULAR` (prévia = gravação).

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

### 6.6 Apoio aos testes de persistência (`tests/apoio-persistencia.js`)

`ambiente({primitiva, order, projecoes, gas, nome})` cria a planilha-banco com as 34 abas pela própria porta de
E/S e devolve `{gas, G, banco, ctx(), run(cmd), tentarRun(cmd), read(q), status(chave), recoverAll(), marcador(),
versao(), tabela(aba), lido(abas), vigentes()}`. Comandos de exemplo: `cmdEvento({chave, animais, avisos, erros,
modo, ...})` e `cmdPasto(G, {chave, dados})`; `projetorDeTeste()` cumpre a porta de projeções (animal com entrada
vigente → ATIVO; sem → ANULADO). `rodarInstrumentado(amb, cmd, {antes: k | depois: k, chegam, antesDe(k, rotulo)})`
numera as chamadas de escrita do contexto (`io.anexar`, `io.atualizar`, `io.flush`, `props.gravar`, `props.remover`,
`lock.soltar`) e mata a execução na k-ésima — é assim que os testes percorrem todas as fronteiras de 06, seção 5.


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

## 8. `Database` (adaptador `SheetsAdapter`, codec e portas reais)

Únicos pontos com serviço do Google na persistência. Três primitivas atrás da mesma porta, nunca misturadas no mesmo
comando (`Database.PRIMITIVAS`, em ordem de preferência): `SHEETS_TYPED` (Sheets API: `Values.batchGet` +
`Spreadsheets.batchUpdate` com `appendCells`/`updateCells` tipados — uma requisição por `anexar`/`atualizar`),
`SHEETS_RAW` (Sheets API: `appendDimension` + `Values.batchUpdate` `RAW` — duas requisições, sem atomicidade) e
`SPREADSHEET_APP` (`insertRowsAfter` → `setNumberFormats` no bloco exato → `setValues`, por aba; buffer até
`flush`). Nenhuma presume atomicidade: o protocolo de três fases vale para as três.

**`Database.abrir(banco, {primitiva, tabelas}?) → io`** (`primitiva` padrão `SHEETS_TYPED`; `tabelas` = definições
extras na forma do Schema `{nome, pk, colunas: [{nome, tipo}]}`, para corpus e diagnóstico). `CONFIG` se o banco é
vazio ou a primitiva é desconhecida. Nada é lido na abertura.

| Membro de `io` | Contrato |
|---|---|
| `banco`, `primitiva`, `definicao(aba)` | Identificação; definição da aba (Schema ou extra) |
| `ler(abas) → {ABA: {cabecalho, registros, linhas, ultimaLinha, alertas}}` | Várias abas numa requisição (Sheets API). `registros` na forma da lógica, uma propriedade por coluna da definição (falta = `null`); `linhas[i]` = número da linha de `registros[i]`; linha em branco é pulada; linha sem chave é ignorada com alerta. Mapeamento por NOME de cabeçalho (coluna do dono é preservada e ignorada) |
| `anexar({ABA: [registro]}) → {ABA: primeira linha gravada}` | Linhas novas ao fim. `null` quando a posição não é conhecida (aba não lida antes por esta porta, em `SHEETS_TYPED`); quem precisa da posição confere com `conferirPosicoes` |
| `atualizar([{tabela, linha, campos}]) → nº de células` | Por índice de linha (≥ 2); células vizinhas viram blocos retangulares |
| `conferirPosicoes([{tabela, linha, id}]) → booleano` | Uma leitura: a chave de cada linha é o `id` esperado. `false` ⇒ reler as abas |
| `criarTabelas(abas) → [criadas]` | Cria só as que faltam, na dimensão exata (cabeçalho congelado + 1 linha livre; colunas exatas) |
| `acrescentarColunas(abas) → {ABA: [acrescentadas]}` | Colunas da definição que faltam, AO FINAL do cabeçalho real; nunca remove, renomeia ou reordena |
| `lerCabecalhos(abas) → {ABA: [nomes] ou null}` | `null` = aba inexistente (setup e integridade) |
| `meta()`, `fuso()`, `definirPropriedades({fuso, locale})` | Abas e grade; fuso da planilha; fixa fuso e locale |
| `flush()` | Descarrega o buffer (`SpreadsheetApp.flush`; nada a fazer na Sheets API) |
| `esquecer()` | Descarta cabeçalhos e posições memorizados (obrigatório depois de escrita que falhou ou de outra execução) |
| `normalizar(aba, registro)`, `normalizarValor(aba, coluna, valor)` | O valor como voltaria da planilha (`decodificar(codificar(v))`) |
| `paraTexto(aba, coluna, valor)`, `deTexto(aba, coluna, texto)` | Texto de AUDITORIA no formato de célula do tipo (dinheiro `'20300.00'`, BOOL `'S'`) e volta exata |

Erros da porta: `CONFIG` para aba ou coluna ausente ("execute a configuração inicial") e banco não configurado;
`INTERNAL` para valor de tipo errado, coluna fora da definição e linha inválida. Erro de serviço sobe como veio.

**Codec** (`codificar(coluna, valor) → célula`; `decodificar(coluna, célula, fusoFn) → {valor, alerta}`): forma de
célula de `03a` / `06`, seção 3 (texto para ID, TEXTO, ENUM, DATA, TS, BOOL `S`/`N` e JSON; número para INT, DEC1,
DEC4 e DINHEIRO em reais). `codificar` recusa com `INTERNAL` objeto `Date`, tipo errado e centavos não inteiros.
`alerta = {nivel, codigo, mensagem}`, com `nivel` `COERCIDA` (convertida sem perda: vira ERROS_LOG) ou `ERRO`
(integridade; o valor devolvido é o melhor possível ou `null`). Códigos: `TEXTO_VIROU_NUMERO`,
`TEXTO_VIROU_BOOLEANO`, `TEXTO_VIROU_DATA`, `DATA_INVALIDA`, `DATA_NATIVA`, `INSTANTE_INVALIDO`, `INSTANTE_NATIVO`,
`NUMERO_INVALIDO`, `NUMERO_COMO_TEXTO`, `BOOLEANO_NATIVO`, `BOOLEANO_INVALIDO`, `JSON_INVALIDO`; na leitura de aba,
também `LINHA_SEM_PK` e `COLUNA_AUSENTE`, com `{tabela, linha, coluna}`. Data nativa é lida no fuso da planilha
(objeto `Date` pelo SpreadsheetApp; número serial pela Sheets API).

**Corpus** (`06`, seção 2): `Database.CORPUS` (os 14 valores do desenho + formatos que o sistema grava);
`corpus(banco, primitiva, {aba}?)` grava (anexa e reescreve uma coluna), descarrega e relê com uma porta nova:
`{primitiva, aba, ok, casos, divergencias: [{id, coluna, esperado, lido, tipoLido}], alertas}`;
`escolherPrimitiva(banco) → {primitiva | null, resultados}` roda na ordem de preferência e para na primeira com
`ok` (falha de serviço vira `{primitiva, ok: false, erro}`). O `setup` roda numa planilha temporária e grava o
resultado. Também: `conferirCorpus`, `corpusDefinicao(aba)`, `corpusRegistros()`.

**Portas reais:** `lock()`, `clock()`, `idGen()`, `hash()`, `props()` (seção 5) e `contexto({banco, primitiva,
usuario, fuso, files, session, projecoes})`.

## 9. `Repository` (puro)

`Repository.abrir(ctx) → repositório INTERNO` de uma unidade (só a `UnitOfWork` o abre). Leitura memoizada:
`carregar(abas)` lê, numa chamada a `io.ler`, as abas pedidas e as de que a vigência delas depende
(`Repository.dependencias(abas)`, ex.: `ALOCACOES_FINANCEIRAS` → `RATEIOS`, `FINANCEIRO`, `EVENTOS`, `OPERACOES`,
`IMPORTACOES`); aba já lida não volta. Registros na forma da lógica: **não os altere**.

**Vigência (P3), numa função só:** `Repository.avaliarEvento(evento, fontes) → {status, vigente, anulador_id}`, com
`status` na ordem de `02`, seção 5.3 (FALHOU, PENDENTE, CANCELADO, PENDENTE de importação, ESTORNADO, CONFIRMADO) e
`vigente = status CONFIRMADO e event_type ≠ ESTORNO`. Regra por aba (`Repository.regra(aba)`):

| Regra | Abas | Linha vale se |
|---|---|---|
| `EVENTO` | EVENTOS | o predicado |
| `FILHA` | toda aba com `event_id` (EVENTO_ANIMAIS, detalhes, IDENTIFICACOES, MOVIMENTOS_ESTOQUE, ANEXOS, FINANCEIRO) | `event_id` vazio, ou o evento é vigente |
| `PARCELA` | PARCELAS | o lançamento vale e `status ≠ CANCELADA` |
| `RATEIO` | RATEIOS | o lançamento vale, o evento é vigente e é o de maior `event_seq` do `financial_id` |
| `ALOCACAO` | ALOCACOES_FINANCEIRAS | o rateio vale |
| `OPERACAO` | AUDITORIA | `OPERACOES.status = CONFIRMADA` |
| `ANIMAL` | ANIMAIS | `situacao_cadastral` não é PENDENTE nem ANULADO (projeção) |
| `SEMPRE` | cadastros, LISTAS, CONFIGURACOES, OPERACOES, IMPORTACOES, ERROS_LOG... | sempre |

| Fachada | Métodos |
|---|---|
| Pública (`tx.repo`) | `vigentes(aba)`; `porId(aba, id)`; `por(aba, campos, valor)` (índice múltiplo; `campos` nome ou lista, `valor` valor ou lista; devolve cópia da lista); `unico(aba, campos, valor)`; `agrupados(aba, campos)` (mapa inteiro; chave composta unida por `'\u0000'`); `eventoVigente(id)`; `contador(aba, campo, extrair?)` (máximo + 1 sobre TODAS as linhas, inclusive inertes; cada chamada reserva um número); `carregada(aba)` |
| Crua (`tx.cru`) | a pública + `cru(aba)`, `cruPorId`, `cruPor`, `linhaDe(aba, id)`, `avaliar(eventId)`, `operacoesOrfas()`, `celulaCoercida(aba, linha, coluna)`, `alertas()`, `cabecalho(aba)` — nenhum método que altere a memória |
| Interna (UnitOfWork) | a crua + `carregar`, `carregadas`, `resolver(atualizacoes)` (por chave → por linha, só o que muda; célula coercida é regravada), `incluir(aba, registros, primeiraLinha)`, `alterar(aba, id, campos)`, `publico()`, `leituraCrua()` |

Índices (`02`, seção 8) são montados sob demanda, uma vez por unidade, com uma passada sobre as linhas vigentes (ou
cruas, no acesso cru); chave vazia não indexa. Aba não declarada → `INTERNAL`.

**Plano de escrita** `Repository.plano()`: `anexar(aba, registro)` (fase A), `auditar(mudanca)` (vira AUDITORIA na
fase A e é aplicada na C), `atualizar(aba, id, campos)` (só a porta de projeções, na fase C); `linhas()`,
`mudancas()`, `atualizacoes()`, `contagem()`, `vazio()`. Aba inexistente → `Error`; registro inválido → `INTERNAL`.

## 10. `UnitOfWork` (puro, só portas)

### 10.1 `UnitOfWork.run(ctx, comando)`

`comando = {rota, idempotencyKey, dados, avisosAceitos?, dataVersionEsperada?, modo?: 'EXECUTAR' | 'SIMULAR',
reads, tratador(tx) → resultado, reconstruir?(tx, operacao) → dados, acessoCru?, anexaSemPai?: [abas],
permiteDuranteImportacao?}`. `resultado = {erros?, avisos?, resumo?, derivados?, resposta?, impactos?}`:
`erros`/`avisos` são detalhes (`Validation.detalhe`); `resumo` vai para `OPERACOES.resumo_json` (só cabeçalho);
`derivados` é o escopo entregue a `ctx.projecoes.reconstruir` na fase C (`null`/ausente = nenhuma projeção);
`resposta` é valor ou `função(tx)` avaliada DEPOIS da fase C; `impactos` é a prévia do `SIMULAR`.

Sequência (`06`, seção 5; desenho-base 4.2 e 16.4): `lock.tentar(25 s)` (senão `LOCKED`) → recuperação
preventiva → idempotência por `OPERACOES` (mesma chave CONFIRMADA: mesmo `payload_hash` → `duplicado: true` com a
resposta de `reconstruir`; hash diferente → `IDEMPOTENCY_MISMATCH`) → importação em curso (`CONFLICT`, salvo
`permiteDuranteImportacao`) → `dataVersionEsperada` (`CONFLICT`) → tratador → avisos não aceitos
(`NEEDS_CONFIRMATION`, nada gravado, chave não consumida) → plano validado contra o esquema → **fase A**
(`props` marcador, `anexar` OPERACOES INICIADA + EVENTOS + filhas + AUDITORIA, `flush`) → **fase B**
(`OPERACOES.status = CONFIRMADA`, `flush`) → **fase C** (refaz a auditoria, `EVENTOS.status`/`confirmed_at`/
`reversed_by_event_id`, projeções; `flush`; `aplicada_em`/`finished_at`; `flush`) → `DATA_VERSION++` → remove o
marcador → grava ERROS_LOG pendente → solta o lock.

Carimbos da UnitOfWork: EVENTOS `op_id`, `status = PENDENTE`, `idempotency_key`, `reversed_by_event_id`,
`confirmed_at` vazios, `created_by` = usuário se vazio; ANIMAIS `situacao_cadastral = PENDENTE`; `created_at` e
`updated_at` = `tx.agora` se vazios. Recusas de programação (`INTERNAL`): tratador que anexa em OPERACOES,
AUDITORIA ou ERROS_LOG; que anexa aba `SEMPRE` (cadastro nasce por `AuditService.criacao`) sem `anexaSemPai`; que
usa `plano.atualizar`; contexto sem porta ou sem usuário; unidade aninhada. Comando sem chave → `VALIDATION`.

Devolve `{dados, duplicado, opId, dataVersion}` (+ `semAlteracao: true` com plano vazio: nada gravado, sem
operação; + `recuperada: true` quando uma exceção depois do commit foi resolvida pela recuperação). `SIMULAR`
devolve `{dados: {simulacao: true, impactos, avisos, linhas: {ABA: n}}, dataVersion}`: mesmo tratador e mesmo
plano, por leitura validada, sem lock de escrita e sem gravar; erro de validação é lançado como no comando.

**Exceção tratada depois do início da fase A:** a UnitOfWork, ainda com o lock, aplica a recuperação à própria
operação relendo a planilha: CONFIRMADA → fase C refeita e sucesso (`recuperada`); INICIADA ou ausente → FALHOU
(motivo em `OPERACOES.erro`) e `INTERNAL` "nada foi alterado" (retentável com a mesma chave; `erro.causa` e,
se a recuperação também falhou, `erro.recuperacao`; aí o marcador fica e a chamada seguinte recupera).

### 10.2 Consultas, estado da operação e manutenção

| Função | Contrato |
|---|---|
| `read(ctx, {rota, reads, tratador(tx), acessoCru?}) → {dados, dataVersion}` | Leitura otimista validada: marcador e versão → abas → marcador e versão; mudou → repete (até 3; depois `LOCKED`). Com marcador: `tentar(5 s)` → recupera e segue, ou `LOCKED`. Nunca serve dados com marcador presente. Não grava dado de negócio |
| `status(ctx, chave) → {situacao, op_id, comando, resumo, erro, started_at, finished_at}` | `situacao` ∈ CONFIRMADA, EM_ANDAMENTO, FALHOU, INEXISTENTE. Com marcador ou operação pendente, tenta o lock sem esperar: ocupado → EM_ANDAMENTO (ou CONFIRMADA, se a da chave já está completa); livre → recupera e responde o estado final. Chave vazia → `VALIDATION` |
| `recoverAll(ctx) → {recuperou, marcador, falharam: [op_id], refeitas: [op_id], dataVersion}` | Recuperação sobre OPERACOES inteira, com reconstrução de TODAS as projeções, mesmo sem marcador (restauração de backup, verificação semanal). `LOCKED` |
| `exclusivo(ctx, {rota, reads, acessoCru, tratador}) → {dados, dataVersion}` | Gatilhos e manutenção: espera o lock (25 s), recupera e roda o tratador com o banco parado; não é recusado com importação em curso. O que precisar gravar em dado de negócio vai por `run` |
| `versao(ctx)`, `chaveVersao(banco)`, `chaveMarcador(banco)` | `DATA_VERSION:<banco>` e `PENDING_OP:<banco>` |
| `anotarErro(ctx, {contexto, codigo, mensagem, erro?, op_id?})`, `descarregarErros(ctx) → {gravados, descartados, motivo}` | ERROS_LOG fora do journal: linhas completas, sem operação, sem versão. `run` (no fim), `read` e `SIMULAR` descarregam sozinhos; com o lock de outra execução, descarta (motivo `LOCKED`) |

### 10.3 Recuperação (`06`, seção 6)

Com o lock e relendo tudo: INICIADA → FALHOU; CONFIRMADA sem `aplicada_em` → fase C refeita; com marcador (ou
`recoverAll`) reconstrói o cache de `EVENTOS.status` e TODAS as projeções (animal PENDENTE de operação que falhou
vira ANULADO pelo projetor); grava a trilha (ERROS_LOG sempre; AUDITORIA `RECUPERACAO` com o `op_id` quando refez a
fase C) antes de `aplicada_em`; `flush`; versão; remove o marcador. Sem marcador mas com órfã, põe um marcador
antes de trabalhar. Reentrante: morrer em qualquer ponto e recuperar de novo dá o mesmo estado. Códigos em
ERROS_LOG: `OPERACAO_INTERROMPIDA`, `FASE_C_REFEITA`, `MARCADOR_SEM_OPERACAO`, `AUDITORIA_SEM_ALVO`, e
`CELULA_COERCIDA` (leitura).

### 10.4 Porta de projeções (`ctx.projecoes`)

`{reads: [abas que o projetor lê], reconstruir(tx, escopo)}`. `escopo` = `derivados` do tratador (caminho normal)
ou `{tudo: true}` (recuperação). O projetor lê por `tx.repo` (vigentes) e `tx.cru` (inclusive PENDENTE) e põe
`tx.plano.atualizar(aba, id, campos)` para cada projeção; a UnitOfWork grava só o que difere do que está na
planilha. Tem de ser função determinística das linhas vigentes (pode rodar quantas vezes for preciso).

## 11. `AuditService` (parte 1, puro)

| Função | Contrato |
|---|---|
| `linhas(ctx, {op_id, usuario, timestamp}, mudancas) → [linha de AUDITORIA]` | `mudanca = {entidade, entity_id, acao, campo, valor_anterior, valor_novo, justificativa}` com valores na forma da LÓGICA; viram texto no formato de célula do tipo. `ALTERAR` só em coluna `[cad]`, `CONTROLE` só em `[ctl]`, `CRIAR` em qualquer uma; a chave nunca muda; `RECUPERACAO`/`MANUTENCAO` sem campo (`valor_novo` = descrição; entidade `SISTEMA` sem registro). Fora disso → `INTERNAL` |
| `alteracao(tx, aba, id, campos, justificativa?) → n` | Compara com o registro vigente e põe no plano uma mudança por campo que REALMENTE muda (marca `[ctl]` → CONTROLE; senão ALTERAR). Registro inexistente → `NOT_FOUND` |
| `criacao(tx, aba, id, campos, justificativa?) → n` | CRIAR, uma mudança por campo preenchido; a chave nasce no plano e fica em `entity_id`; a linha do cadastro é anexada só na fase C, se a chave ainda não existir |
| `refazer(repo, io, op, linhasDaOperacao) → {atualizar, criar, semAlvo}` | O que a fase C aplica (idempotente; `updated_at`/`created_at` = `op.started_at`). Usado pela UnitOfWork |
| `listar(tx, {entidade, entity_id, op_id, acao, de, ate}?) → [linhas]` | Trilha só de operações CONFIRMADAS, da mais recente para a mais antiga (cópias). A consulta declara `AuditService.LEITURAS` |
| `linhaErro(ctx, {contexto, codigo, mensagem, erro, op_id}) → linha de ERROS_LOG` | Mensagem até 2.000 caracteres; pilha resumida (6 linhas) quando há `erro` |
