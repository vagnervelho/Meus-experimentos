# Contratos entre módulos (Fase 1)

Interfaces que cada etapa entrega para as seguintes. Uma seção curta por módulo: funções públicas, parâmetros,
retorno e erros. Quem acrescenta um módulo acrescenta a seção dele aqui. O desenho está em `docs/fase-0/`; este
arquivo descreve o que **existe no código**.

Estado: etapas BASE (E1.1 e parte da E1.2) — `Schema`, `Utils`, `Validation`, harness e estrutura —, PERSISTÊNCIA
(E1.3 e E1.4) — `Database`, `Repository`, `UnitOfWork` e `AuditService` (parte 1) — e MOTOR DE EVENTOS (E1.6) —
`EventCatalog`, `Timeline` e `EventService` — e SERVIÇOS DE CADASTRO E CONSULTA (E1.7 e E1.8) — `Config`, `AnimalService`,
`PastureService` e `InventoryService` (seção 15) — e OPERAÇÃO DO SISTEMA (E1.10 e E1.11, backend) — `FileService`,
`Maintenance`, `AuditService` (parte 2) e `ImportService` (seções 11, 16 a 18).

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
| `CENTAVOS_MAX` | `999999999999999`: maior valor em centavos (em módulo) que vai à planilha e volta exato (15 dígitos). Acima disso a `Validation` recusa DINHEIRO (`VALOR_FORA_DA_FAIXA`) e o codec também |
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
| `files` | `FileStore` (Drive: pastas, banco, backups, anexos, exportações; seção 16) | `FileService.porta()` |
| `session` | Sessão do pedido (dono, e-mail ativo) | `Api` (etapa posterior); `null` até lá |
| `usuario` | E-mail de quem executa; obrigatório em `UnitOfWork.run` (vai para `OPERACOES.usuario`, `created_by`, `AUDITORIA.usuario`) | `Api` |
| `fuso` | Fuso IANA de "hoje" | `CONFIGURACOES.fuso` (Api); padrão `Session.getScriptTimeZone()` |
| `projecoes` | Porta do projetor: `{reads: [abas], reconstruir(tx, escopo)}` (seção 10.4); `null` = a fase C só refaz `EVENTOS.status` e a auditoria | `Timeline.porta()` (seção 13) — a `Api` deve sempre passá-la |
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

`ambiente({primitiva, order, projecoes, gas, nome})` (`projecoes` aceita também `(G) => porta`, ex.: `G.Timeline.porta`) cria a planilha-banco com as 34 abas pela própria porta de
E/S e devolve `{gas, G, banco, ctx(), run(cmd), tentarRun(cmd), read(q), status(chave), recoverAll(), marcador(),
versao(), tabela(aba), lido(abas), vigentes()}`. Comandos de exemplo: `cmdEvento({chave, animais, avisos, erros,
modo, ...})` e `cmdPasto(G, {chave, dados})`; `projetorDeTeste()` cumpre a porta de projeções (animal com entrada
vigente → ATIVO; sem → ANULADO). `rodarInstrumentado(amb, cmd, {antes: k | depois: k, chegam, antesDe(k, rotulo)})`
numera as chamadas de escrita do contexto (`io.anexar`, `io.atualizar`, `io.flush`, `props.gravar`, `props.remover`,
`lock.soltar`) e mata a execução na k-ésima — é assim que os testes percorrem todas as fronteiras de 06, seção 5.
`cmdPasto` devolve no duplicado a mesma forma da resposta original (edição `{pasture_id, campos}`; criação
`{pasture_id, existe}`).

`tests/unitofwork.adversarial.test.js` é o ataque ao protocolo: varre a morte DEPOIS de cada escrita de serviço
(`gas.falhas.matarNaEscrita(n, {incluiAtual: true, chegam})`) e de cada chamada de porta, com nenhuma, todas, cada
prefixo e subconjuntos aleatórios das pendentes; e confere, sobre o estado DURÁVEL, `conferirInvariantes` (marcador
removido, nenhuma órfã, operação terminada com `finished_at` e, se FALHOU, `erro`; uma confirmada por chave; chaves
primárias únicas; `EVENTOS.status` = predicado; projeção de ANIMAIS = reconstrução; nenhuma filha vigente órfã;
cadastro só de operação confirmada, com o último valor auditado). Comando novo que a etapa seguinte criar (e um
projetor real) deve entrar em `CENARIOS` desse arquivo — o cenário `motor` (OUTRA_ENTRADA real pelo `EventService`, com
`Timeline.porta()` e `Timeline.conferir` no desfecho) é o modelo; `cen.ambiente` dá as opções do `ambiente`.

`tests/apoio-eventos.js`: `ambienteEventos({primitiva, order, marcoZero, config, categorias})` = banco semeado
(propriedade, 5 pastos `PASTOS.A/B/C/INATIVO/PEQUENO` — o último com capacidade de 2 cabeças —, CONFIGURACOES com
`data_marco_zero = 2026-01-01`, LISTAS, PLANO_CONTAS, CATEGORIAS) e o projetor real. `m.run(acao, dados, {chave, avisos})`,
`m.tentar(...)` e `m.simular(...)` conferem, depois de CADA comando, que a projeção gravada = `Timeline.conferir` vazio.
Construtores: `bicho(extra)`, `entradaInicial(animais, campos)`, `outraEntrada(data, animais, campos)`,
`ajuste(subtipo, data, animais, campos)`; `sementes(G, opcoes)` dá as linhas de semente.


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
DEC4 e DINHEIRO em reais). `codificar` recusa com `INTERNAL` objeto `Date`, tipo errado, centavos não inteiros e
centavos acima de `Utils.CENTAVOS_MAX` (não voltariam exatos). `decodificar` **nunca lança** por causa de uma célula:
dinheiro grande demais, inteiro com casas decimais e data/data e hora nativa que não cabe no calendário
(`0001-01-01` a `9999-12-31`) são `ERRO`; `COERCIDA` só com valor válido do tipo. `deTexto` aceita a notação
científica que `paraTexto` produz para números a partir de 1e21.
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
`reversed_by_event_id`, projeções e `finished_at` na mesma gravação; `flush`; `aplicada_em`; `flush`) → `DATA_VERSION++` → remove o
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
se a recuperação também falhou, `erro.recuperacao`; aí o marcador fica e a chamada seguinte recupera). Se a
recuperação falhou depois de o commit poder ter chegado (exceção na fase B ou C), a mensagem NÃO diz que nada
mudou: diz que a gravação pode já valer e manda conferir antes de lançar de novo (reenviar o mesmo formulário é
seguro). A tela não deve oferecer "lançar de novo" com chave nova nesse caso: consulta `operacao.status`.

### 10.2 Consultas, estado da operação e manutenção

| Função | Contrato |
|---|---|
| `read(ctx, {rota, reads, tratador(tx), acessoCru?}) → {dados, dataVersion}` | Leitura otimista validada: marcador e versão → abas → marcador e versão; mudou → repete (até 3; depois `LOCKED`). Com marcador: `tentar(5 s)` → recupera e segue, ou `LOCKED`. Nunca serve dados com marcador presente, nem com operação órfã visível em OPERACOES sem marcador (backup restaurado, Script Properties apagadas): trata como marcador. A restauração deve, ainda assim, gravar o marcador do banco novo antes de trocá-lo e rodar `recoverAll`. Não grava dado de negócio |
| `status(ctx, chave) → {situacao, op_id, comando, resumo, erro, started_at, finished_at}` | `situacao` ∈ CONFIRMADA, EM_ANDAMENTO, FALHOU, INEXISTENTE. Com marcador ou operação pendente, tenta o lock sem esperar: ocupado → EM_ANDAMENTO (ou CONFIRMADA, se a da chave já está completa); livre → recupera (gravando em ERROS_LOG a trilha que a recuperação anotou) e responde o estado final. Nunca FALHOU enquanto a original está viva. Chave vazia → `VALIDATION` |
| `recoverAll(ctx) → {recuperou, marcador, falharam: [op_id], refeitas: [op_id], dataVersion}` | Recuperação sobre OPERACOES inteira, com reconstrução de TODAS as projeções, mesmo sem marcador (restauração de backup, verificação semanal). `LOCKED` |
| `exclusivo(ctx, {rota, reads, acessoCru, tratador}) → {dados, dataVersion}` | Gatilhos e manutenção: espera o lock (25 s), recupera e roda o tratador com o banco parado; não é recusado com importação em curso. O que precisar gravar em dado de negócio vai por `run` |
| `versao(ctx)`, `chaveVersao(banco)`, `chaveMarcador(banco)` | `DATA_VERSION:<banco>` e `PENDING_OP:<banco>` |
| `anotarErro(ctx, {contexto, codigo, mensagem, erro?, op_id?})`, `descarregarErros(ctx) → {gravados, descartados, motivo}` | ERROS_LOG fora do journal: linhas completas, sem operação, sem versão. `run` (no fim), `read` e `SIMULAR` descarregam sozinhos; com o lock de outra execução, descarta (motivo `LOCKED`) |

### 10.3 Recuperação (`06`, seção 6)

Com o lock e relendo tudo: INICIADA → FALHOU (`erro` e `finished_at` gravados e descarregados ANTES do status: uma
linha FALHOU nunca fica sem motivo); CONFIRMADA sem `aplicada_em` → fase C refeita (`finished_at` junto dos
derivados, antes de `aplicada_em`: operação aplicada sempre tem `finished_at`); com marcador (ou
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
| `alteracao(tx, aba, id, campos, justificativa?) → n` | Compara com o registro vigente e põe no plano uma mudança por campo que REALMENTE muda (marca `[ctl]` → CONTROLE; senão ALTERAR). Registro inexistente → `NOT_FOUND`. 6º argumento `{externo: true}`: sexo e nascimento do cadastro de referência de um animal EXTERNO (`ATRIBUTOS_EXTERNO`), aceitos só se o registro está EXTERNO (senão `INTERNAL`) |
| `criacao(tx, aba, id, campos, justificativa?) → n` | CRIAR, uma mudança por campo preenchido; a chave nasce no plano e fica em `entity_id`; a linha do cadastro é anexada só na fase C, se a chave ainda não existir |
| `refazer(repo, io, op, linhasDaOperacao) → {atualizar, criar, semAlvo}` | O que a fase C aplica (idempotente; `updated_at`/`created_at` = `op.started_at`). Usado pela UnitOfWork |
| `listar(tx, {entidade, entity_id, op_id, acao, de, ate}?) → [linhas]` | Trilha só de operações CONFIRMADAS, da mais recente para a mais antiga (cópias). A consulta declara `AuditService.LEITURAS` |
| `linhaErro(ctx, {contexto, codigo, mensagem, erro, op_id}) → linha de ERROS_LOG` | Mensagem até 2.000 caracteres; pilha resumida (6 linhas) quando há `erro` |
| `consultaListar(filtros)` / `listarAuditoria(ctx, filtros)` | Rota `auditoria.listar`: os filtros de `listar` + `pagina`, `por_pagina` (padrão 50, teto 500) → `{total, pagina, por_pagina, itens}` |

**Parte 2 — verificação de integridade (06, seção 9).** `verificarIntegridade(ctx) → {dados: relatório, dataVersion}`
(rota `sistema.integridade`; fim do setup; gatilho semanal): lê os cabeçalhos e a localidade pela porta e entra por
`UnitOfWork.exclusivo` (lock e recuperação ANTES de conferir) com acesso cru a todas as abas existentes. Com aba
ausente, só a estrutura é conferida (as demais checagens ficam `NAO_EXECUTADA`). Relatório: `{gerado_em, banco,
data_version, ok (nenhum ERRO), erros, alertas, reparavel, abas_ausentes, checagens: [{codigo, rotulo, severidade,
situacao (OK|ERRO|ALERTA|NAO_EXECUTADA), achados, correcao, reparo}], achados: [{checagem, severidade, tabela, id,
linha, campo, mensagem, reparo}] (até 300), truncado}`. Checagens (`AuditService.CHECAGENS`): `PK`, `BRINCO`, `FK`
(linhas vigentes; alvo inexistente ou animal ANULADO; ANEXOS pela entidade; ERROS_LOG só alerta), `ENTRADA_ABERTA`
(ATIVO ⇔ soma dos efeitos = 1), `LINHA_DO_TEMPO`, `PROJECAO` e `STATUS_EVENTOS` (reparo `RECONSTRUIR`), `INVENTARIO`
(total e por pasto, hoje), `ALOCACOES` (soma = total do rateio, ≤ lançamento, 100% em COMPRA, VENDA e ENTRADA_INICIAL),
`PARCELAS`, `ALOCACAO_DIRETA` (reparo), `BASE_RATEIO` (alerta; VALOR_INDIVIDUAL e DIRETO de escopo EVENTO), `COPIAS`
(data de PESAGENS, REPRODUCAO e IDENTIFICACOES = data do evento), `CELULAS` (COERCIDA = alerta; ERRO = erro),
`OPERACOES_ORFAS`, `FILHAS_SEM_PAI` (alerta: linha cujo evento, operação, importação, rateio ou lançamento não existe),
`CABECALHOS` (aba ou coluna ausente e coluna de SCHEMA_META sumida = erro; coluna do dono = alerta), `FUSO_LOCALE`,
`CONTADORES` (`event_seq` e `codigo_interno` repetidos), `PENDENCIAS` (alerta: ativo sem pasto, sem brinco ou sem
categoria). `repararIntegridade(ctx, justificativa?) → {recuperacao, integridade}`: o reparo oferecido —
`UnitOfWork.recoverAll` (status dos eventos e todas as projeções), AUDITORIA `MANUTENCAO` e nova verificação. Erros:
LOCKED, CONFIG.

## 12. `EventCatalog` (puro, só dados)

Definição declarativa dos eventos (04, seção 7). Os 21 tipos estão no catálogo com `fase`; só os da fase corrente
(`FASE_ATUAL = 1`) têm campos e passam pelo motor: ENTRADA_INICIAL, OUTRA_ENTRADA, AJUSTE_INVENTARIO (subtipos
CORRECAO_CADASTRO, IDENTIFICACAO_INCORRETA, CORRECAO_LOCALIZACAO; RECLASSIFICACAO e DIVERGENCIA_CONTAGEM são da fase 2)
e ESTORNO. Vocabulário fechado de 04 mais três atributos de campo: `opcoes` (enum fechado), `lista` (lista aberta de
LISTAS) e `casas` (decimais). No tipo, os campos de cabeçalho ficam em `campos` e os por animal em `campos_animal`
(ou em `subtipos[S].campos_animal`).

| Função | Contrato |
|---|---|
| `nomes()`, `existe(tipo)` | Os 21 tipos |
| `tipo(nome)` | Resumo + definição (`rotulo, grupo_ui, ordem, fase, frequente, selecao_animais, filtro_elegiveis, modo_entrada, revisao, critico, reads, campos, campos_animal, componentes, grupos_repetiveis, subtipos`). Tipo inexistente → `INTERNAL` |
| `ativo(tipo, subtipo?, fase?)` | Entregue na fase (padrão: a corrente) e com campos; tipo com subtipos exige subtipo ativo |
| `tiposAtivos(fase?)`, `modulosAtivos(fase?)` | Listas por fase. Módulos: os 10 itens do menu (§15) + IMPORTACAO (`menu: false`), cada um com `fase` |
| `camposEvento(tipo)`, `camposAnimal(tipo, subtipo?)`, `leituras(tipo)` | Definições e abas que o comando lê |
| `serializar(fase?)` | `{fase, modulos, tipos}` só dados (vai ao cliente no bootstrap), só tipos e subtipos ativos |
| `validarCampos(definicoes, valores, {listas}?)` | Formato, obrigatório, `obrigatorio_se`, `visivel_se` (preenchido e não visível → `CAMPO_NAO_SE_APLICA`; `false` passa), lista, faixa (`dinheiro` em centavos, `min`/`max` em reais) e chave desconhecida não vazia (`CAMPO_DESCONHECIDO`). Devolve `[{codigo, campo, mensagem}]` |
| `CAMPOS_CORRIGIVEIS`, `PESO_MAX_KG` (2000), `TIPOS_CAMPO` | Constantes |

## 13. `Timeline` (puro: linha do tempo, projetor, inventário)

Linha = linha vigente de EVENTO_ANIMAIS + cabeçalho do evento:
`{event_id, animal_id, papel, efeito, pasto_origem_id, pasto_destino_id, atributos, valor_individual, event_type,
event_subtype, event_date, event_seq, ordem_seq, pre_marco_zero, property_id, confiabilidade, payload}`
(`Timeline.linha(registroEA, evento, ordemSeq)`). `ordem_seq` = `event_seq` do primeiro evento da cadeia de
substituição (desenho-base 16.1).

| Função | Contrato |
|---|---|
| `LEITURAS` | Abas do projetor (= `porta().reads`) |
| `parametros(repo)` | = `Config.parametros(repo)` (seção 15.1): CONFIGURACOES tipadas; chave ausente = semente; célula vazia = `null`; inválido → `CONFIG` |
| `ordenar(linhas)`, `classe(l)`, `papelNaLinha(l)` | Ordem `(event_date, classe 0/1/2, ordem_seq, event_seq)`; papel ENTRADA, SAIDA, MOVIMENTO (efeito 0 com destino), FATO (exige presença, limites inclusivos) ou NEUTRO (CORRECAO_CADASTRO e IDENTIFICACAO_INCORRETA: valem para todo o histórico) |
| `validar(linhas, {nascimento, dataEntrada})` | Linha do tempo de UM animal já com a mudança: `{problemas, periodos, pasto, dentro, morte}`. Códigos: `ENTRADA_JA_DENTRO`, `FORA_DO_REBANHO`, `ORIGEM_DIVERGENTE` (com `pasto_esperado`/`pasto_informado`), `FORA_DA_PERMANENCIA`, `APOS_MORTE`, `ANTES_DO_NASCIMENTO`, `ANTES_DA_ENTRADA`. Linhas `pre_marco_zero` ficam fora do replay e só são conferidas contra nascimento e chegada declarada |
| `problemasNovos(antes, depois)` | O que a mudança quebrou (por `codigo` + `event_id`). Regra do serviço: problema em linha do comando → VALIDATION; em evento gravado → CONFLICT |
| `descrever(problema, nomePasto?)` | Frase para o pecuarista, sem o "quem" |
| `fonte(tx, {excluir, parametros})` | Acesso indexado às linhas da unidade (usa `tx.cru` quando há); `excluir` = eventos tratados como anulados (validação de estorno e de substituição) |
| `projetarAnimal(fonte, id)` → `{campos, meta}`; `projetar(fonte, ids \| null)` | A ÚNICA rotina que calcula as projeções de ANIMAIS (03a, 4.3.3 e 4.3.4); `projetar` inclui as mães alcançadas e `cria_ao_pe` |
| `porta()` / `reconstruir(tx, escopo)` | Porta `ctx.projecoes`. Escopo `{animais, eventos}` (o `derivados` do EventService) ou `{tudo: true}`. Grava ANIMAIS (+ `updated_at` quando algo muda), `IDENTIFICACOES.data_fim` e FINANCEIRO (`status`, `cancelado_em` = `created_at` do anulador, `cancelado_por_event_id`, `status_pagamento`, `data_pagamento`, `animal_id` da alocação DIRETA) |
| `conferir(tx)` | Projeção gravada × reconstrução total (precisa de `tx.cru`): `[{tabela, id, campo, gravado, calculado}]`, vazio = coincidem. Base da integridade (E1.11) |
| `inventario(linhas, D, marcoZero)` | `{data, total, porPasto: {pasture_id: n}, semPasto, motivo}`; D < marco zero → nulos com `ANTERIOR_AO_MARCO_ZERO`; sem marco zero → `DADOS_INSUFICIENTES` |
| `pastoEm(linhasDoAnimal, D, marcoZero)` | `{presente, pasture_id, motivo}` ao fim do dia D |
| `consultaInventario({data, animal_id?})` | Consulta pronta para `UnitOfWork.read` (rota `inventario.posicao`) |

Regras do projetor que valem como contrato: atributo = criação (`atributos_iniciais_json`, booleanos `S`/`N`) + correção
CORRECAO_CADASTRO vigente de maior `event_seq`; ANULADO/PENDENTE conservam os atributos declarados na linha de criação
mais recente (inertes) e zeram o resto; ANIMAIS sem nenhuma linha em EVENTO_ANIMAIS é EXTERNO, salvo se a linha gravada
está PENDENTE ou ANULADO (queda na fase A) — então ANULADO; estoque (`PRODUTOS.estoque_atual`) ainda não é projetado
(só a Fase 3 grava MOVIMENTOS_ESTOQUE).

## 14. `EventService` (puro: comandos e consultas do motor)

Pedido de comando: `{idempotencyKey, dados, avisosAceitos: [códigos], dataVersionEsperada?}`. Dinheiro em centavos
inteiros; datas `yyyy-MM-dd`. Erros: VALIDATION (detalhes por animal e campo), CONFLICT (detalhe com
`conflito: {event_id, tipo, data}`), NEEDS_CONFIRMATION (avisos sem aceite; nada gravado; chave livre), NOT_FOUND,
CONFIG (sem marco zero; conta SALDO_ABERTURA_REBANHO ausente), além dos da UnitOfWork.

| Função | Contrato |
|---|---|
| `comando(acao, pedido)` | Comando para `UnitOfWork.run` (`acessoCru: true`: o motor lê eventos anulados para a posição do substituto e para o histórico). `acao` ∈ `registrar` (rota `evento.registrar`), `corrigir` (`evento.corrigir`), `estornar` (`evento.estornar`) |
| `registrar/corrigir/estornar(ctx, pedido)` | `UnitOfWork.run(ctx, comando(...))` → `{dados: resposta, duplicado, opId, dataVersion}` |
| `simular(ctx, {acao, dados, avisosAceitos})` | Mesmo tratador em modo SIMULAR → `{dados: {simulacao, impactos, avisos, linhas}}`; erro de validação e bloqueio (CONFLICT) são lançados como no commit |
| `consultaListar(filtros)` / `listar(ctx, filtros)` | `{total, pagina, por_pagina, itens: [evento]}`; filtros `{tipo, de, ate, animal_id, vigentes, pagina, por_pagina}`; inclui anulados e estornos; não inclui operações que falharam |
| `consultaObter({event_id})` / `obter(ctx, dados)` | `{evento, linhas (com codigo_interno e brinco), detalhes: {IDENTIFICACOES, PESAGENS, REPRODUCAO, AJUSTES, FINANCEIRO, RATEIOS, ALOCACOES_FINANCEIRAS}, anula}`; NOT_FOUND |
| `planejarEntradaImportada(tx, {campos, animais}, {importacao: {import_id}, conhecidos, rotulos})` | O MESMO planejamento da ENTRADA_INICIAL (todas as regras do formulário) dentro do tratador de outro comando: o evento nasce com `import_id` e `source = IMPORTACAO`; `conhecidos` = `{animal_id: {sexo, data_nascimento, mae_id, pai_id, nome}}` de animais ainda pendentes da mesma importação, aceitos como mãe ou pai; `rotulos[i]` substitui o "quem" das mensagens (ex.: `Linha 12`). Devolve o resultado do tratador (`{erros}` ou `{avisos, resumo, derivados, ...}`); exige `leiturasEntrada()` e acesso cru |
| `leiturasEntrada()` | Abas que esse planejamento lê |
| `classificarCategoria(perfil, data, categorias)` | Perfil `{sexo, data_nascimento, castrado, reprodutor, parida, categoria_modo, categoria_manual_id}` (valores em D) → `{category_id, codigo, nome, manual}` ou `null` |
| `coberturaCategorias(categorias)` | `{completa, testes, lacunas: [{perfil, rotulo, idade_de, idade_ate}]}` (05, seção 4.9); base do aviso CATEGORIAS_SEM_COBERTURA em `categoria.salvar` |

`dados` de registrar/corrigir: `{tipo, subtipo?, campos: {event_date, property_id, description, responsible, notes,
justificativa (AJUSTE)}, animais: [item], event_id (corrigir), justificativa (corrigir), justificativa_aviso (com
PERIODO_BLOQUEADO)}`. Item por tipo:
- ENTRADA_INICIAL / OUTRA_ENTRADA (novo): campos de `EventCatalog.camposAnimal`: `brinco, nome, sexo, raca,
  data_nascimento | idade_meses, data_nascimento_confianca, mae_id | mae_ref, mae_confianca, pai_id | pai_ref,
  pai_confianca, ref, origem, castrado, reprodutor (macho), partos_previos, situacao_reprodutiva, data_prevista_parto
  (fêmea), pasto_destino_id, outras_identificacoes [{tipo, codigo}], observacoes`; só na ENTRADA_INICIAL: `data_entrada,
  data_entrada_confianca, peso, metodo_pesagem, valor_abertura` (centavos). `ref`/`mae_ref`/`pai_ref` ligam animais do
  mesmo lançamento. Na correção de evento criador, o item leva o `animal_id` criado pelo original (reaproveitado);
  animal do original que fica fora do substituto é anulado (com as regras do estorno).
- OUTRA_ENTRADA de animal existente (volta ao rebanho): `{animal_id, brinco?, pasto_destino_id, observacoes?}`; só
  VENDIDO, DESCARTADO, BAIXADO_AJUSTE ou HISTORICO.
- AJUSTE_INVENTARIO: CORRECAO_CADASTRO `{animal_id, campo, valor_novo}` (um item por campo; texto canônico, `''` =
  desconhecido; apagar mãe, pai ou nascimento apaga a confiança); IDENTIFICACAO_INCORRETA `{animal_id, brinco}`;
  CORRECAO_LOCALIZACAO `{animal_id, pasto_destino_id, pasto_origem_id?}` (a origem é a da linha do tempo na data).
- ESTORNO (`estornar`): `{event_id, justificativa}`.

Resposta (e reenvio duplicado): `{acao, event_id, event_type, event_subtype, event_date, status, total_value,
substitui, estorna, animais: [{animal_id, codigo_interno, brinco, sexo, situacao_cadastral, pasto_atual_id}]}`
(no estorno, os animais do evento estornado). `derivados` = `{animais, eventos}`. `payload_json`: `justificativa`
(corrigir/estornar), `valor_abertura_origem` (`INFORMADO`), `avisos_aceitos: [{codigo, n, justificativa?}]`.
Códigos de aviso emitidos: POSSIVEL_DUPLICIDADE, BRINCO_PARECIDO, IDADE_REPRODUTIVA, LOTACAO_ACIMA_DA_CAPACIDADE (em
cabeças), PERIODO_BLOQUEADO; política por código em `avisos_politica` (ausente = AVISA).

## 15. Serviços de cadastro e consulta (E1.7 e E1.8): `Config`, `AnimalService`, `PastureService`, `InventoryService`

Puros (só portas). Padrão comum: cada comando tem `comandoX(pedido)` (objeto para `UnitOfWork.run`) e `x(ctx, pedido)`
(= `UnitOfWork.run`); cada consulta tem `consultaX(dados)` (para `UnitOfWork.read`) e `x(ctx, dados)`. `pedido =
{idempotencyKey, dados, avisosAceitos, dataVersionEsperada}`. A resposta do comando fica em `dados` do resultado da
UnitOfWork; o reenvio com a mesma chave devolve a mesma forma (`reconstruir`). Erros: `VALIDATION` (detalhes por campo,
com os códigos citados abaixo), `NEEDS_CONFIRMATION` (avisos sem aceite), `NOT_FOUND` (registro que não existe mais),
`CONFLICT`, `CONFIG`, além dos da UnitOfWork. Indicador numérico (P9): `{valor, motivo, n, ...}`, com `motivo` ∈
`MOTIVO_INDICADOR_NULO` quando `valor` é `null`; zero só quando é zero de verdade (pasto vazio).
Testes: `tests/apoio-cadastros.js` — `ambienteCadastros(opcoes de apoio-eventos)` com `run/tentar('Modulo.comandoX',
dados, {chave, avisos})` (confere a projeção depois de cada comando), `ler(consulta)`, `lerCom(reads, tratador)`, `auditoria(filtro)`.

### 15.1 `Config` (parâmetros e cadastros de configuração)

| Membro | Contrato |
|---|---|
| `parametros(repo)` | `{chave: valor}` tipado das 45 chaves (NUMERO → número, BOOL → booleano, JSON → objeto, data validada). Chave ausente na aba (ou `repo` nulo/sem a aba) = padrão do código (Schema); célula vazia = `null`; célula inválida → `CONFIG`. `Timeline.parametros` delega aqui |
| `valor(repo, chave)` | Um parâmetro tipado; chave desconhecida → `INTERNAL` |
| `listar(repo)` | Tela de configurações, sem lançar: `{itens: [{chave, grupo, tipo, formato, descricao, padrao, texto, valor, origem: PLANILHA\|PADRAO, erro, faixa}], desconhecidas: [chave]}` |
| `normalizar(chave, bruto)` | `{texto (célula), valor (tipado)}` ou `{erro: {codigo, mensagem}}`: tipo, faixa (`FAIXAS`), datas, `faixas_etarias_meses` (inteiros crescentes), `avisos_politica` (códigos de `CODIGOS_AVISO` → BLOQUEIA/AVISA/IGNORA). Vazio só em chave sem padrão |
| `planejarParametro(tx, chave, valor, justificativa?)` | Para outro comando: normaliza e põe no plano (altera a linha ou cria a que falta). `CONFIGURACOES` nas `reads`. Inválido → `VALIDATION` |
| `aplicarPolitica(params, avisos, coletor)` | `avisos_politica`: BLOQUEIA vira erro no coletor; IGNORA some; devolve os que ficam (AVISA) |
| `cadastros(repo)` / `LEITURAS_CADASTROS` | Para `sistema.bootstrap`: `{configuracoes (= listar), listas, categorias (por prioridade), cobertura, parceiros}` |
| `comandoSalvar` — `config.salvar` | `dados: {valores: {chave: valor}, justificativa?}` (várias chaves, uma operação). Códigos: `CHAVE_DESCONHECIDA`, `TIPO_INVALIDO`, `FORMATO_INVALIDO` (inclusive fuso IANA), `VALOR_FORA_DA_FAIXA`, `VALOR_FORA_DA_LISTA`, `CAMPO_OBRIGATORIO`, `NAO_ENCONTRADO`/`PROPRIEDADE_INATIVA` (propriedade padrão), `DATA_FUTURA` (marco zero), `FAIXA_INVALIDA` (GMD mín ≥ máx). Marco zero com entrada/saída vigente → `CONFLICT` `MARCO_ZERO_EM_USO` (RN-101). Mudar `idade_desmama_padrao_meses` ou `data_marco_zero` reconstrói todas as projeções na fase C. Resposta `{chaves, itens}` |
| `comandoSalvarLista` — `lista.salvar` | `dados: {lista_id?, lista, codigo?, rotulo, ordem?, ativo?, justificativa?}`. Código MAIÚSCULAS ASCII (derivado do rótulo se vazio), único na lista; ordem padrão = última + 10. Edição só de rótulo, ordem, ativo. Códigos: `CODIGO_REPETIDO`, `CAMPO_IMUTAVEL`, `CODIGO_RESERVADO`, `FORMATO_INVALIDO`. Resposta: o item |
| `comandoSalvarCategoria` — `categoria.salvar` | `dados: {categorias: [{category_id?, campos}]}` ou `{category_id?, campos}`. Aviso `CATEGORIAS_SEM_COBERTURA` (lacunas na mensagem; política por código). Erros: `CAMPO_IMUTAVEL` (código), `CODIGO_REPETIDO`, `FAIXA_INVALIDA`, `CONDICAO_INCOMPATIVEL`, `PRIORIDADE_REPETIDA` (entre ativas), `CATEGORIA_EM_USO` (reclassificação manual vigente), `CAMPO_OBRIGATORIO`, `CAMPO_DESCONHECIDO`. Resposta `{categorias, cobertura}` |
| `comandoSalvarParceiro` — `parceiro.salvar` | `dados: {partner_id?, campos: {nome, tipos (lista ou "A,B"), documento, telefone, endereco, observacoes, ativo}}`. Documento repetido → aviso `POSSIVEL_DUPLICIDADE`. Resposta: o parceiro |

### 15.2 `AnimalService` (lista, ficha, edição, externo; idade, categoria e peso na leitura)

| Membro | Contrato |
|---|---|
| `leituras()`, `leitor(tx)` | Abas do leitor e o leitor da consulta: `L = {tx, repo, f (Timeline.fonte), params, marcoZero, hoje, categorias, categoriaPorId, animais (vigentes), filhosMae, filhosPai}` |
| `idadeEm(a, data)` | Meses completos; `null` sem nascimento ou antes dele |
| `perfilEm(L, a, data)` / `categoriaEm(L, a, data)` | Perfil em D (castração posterior não conta; parida = partos prévios, PARTO até D ou cria nascida até D; reclassificação vigente em D) → `EventService.classificarCategoria` → `{category_id, codigo, nome, manual}` ou `null` |
| `pesoVigente(L, a, data, categoria)` | `{kg, situacao: PESADO\|PESAGEM_VENCIDA\|SEM_PESAGEM\|SEM_PESO, estimado, data_pesagem, metodo, referencia_kg}` (desenho-base, seção 6) |
| `linhaLeve(L, a)`, `COLUNAS_LEVE` | Linha do store. Idade/categoria na data de referência (hoje; baixado: data da saída); `categoria_id` null no EXTERNO; `peso_vencido` só em ATIVO |
| `consultaCargaInicial()` / `cargaInicial(ctx)` | ATIVOS + EXTERNOS em colunas: `{data, n, colunas, valores: {coluna: [..]}}` (ordem de `codigo_interno`) |
| `consultaListar({situacoes?})` — `animal.listar` | Mesmo formato; padrão = baixados (VENDIDO, MORTO, DESCARTADO, BAIXADO_AJUSTE, HISTORICO); PENDENTE/ANULADO → `VALIDATION` |
| `consultaFicha({animal_id, geracoes?})` — `animal.ficha` | `{animal_id, data, geral (A), genealogia (B), localizacao (C), pastos (D: períodos [início, fim) com dias), peso (E), sanitario (F), reprodutivo (G), financeiro (H), eventos (I: linha do tempo com status, vigente, anulado_por, ajustes), anexos (J: ANEXOS ativos do animal)}`; todo bloco traz `entregue`; E, F, G e H voltam `{entregue: false, modulo, fase, mensagem, itens: []}`. Genealogia: `{sem_genealogia, mae, pai, arvore (nós {..., confianca, confirmado, geracao, disponivel, tem_ancestrais, mae, pai}), filhos [{..., papel MAE\|PAI, confianca}]}`; `geracoes` 1–6 (padrão 3). `NOT_FOUND`; `VALIDATION` |
| `comandoEditar` — `animal.editar` | Um formulário só. `dados: {animal_id, campos, justificativa?, justificativa_aviso?}`; só o que muda é gravado. `nome, raca, observacoes, foto_anexo_id` → AUDITORIA; campos de `EventCatalog.CAMPOS_CORRIGIVEIS` → evento AJUSTE_INVENTARIO/CORRECAO_CADASTRO datado de hoje, com todas as regras do motor (justificativa obrigatória: `CAMPO_OBRIGATORIO`), NA MESMA operação da auditoria. EXTERNO: sexo e nascimento por AUDITORIA (`AuditService.alteracao(..., {externo: true})`), demais sensíveis `CAMPO_NAO_SE_APLICA`. `brinco`, pasto, situação, colunas calculadas → `CAMPO_NAO_EDITAVEL` (mensagem com o caminho certo); `ANEXO_INVALIDO`; `CAMPO_DESCONHECIDO`. Resposta `{animal_id, event_id, correcoes, cadastro, animal (linha leve)}`; nada muda → `semAlteracao` |
| `comandoCadastrarExterno` — `animal.cadastrarExterno` | `dados: {campos: {nome*, sexo*, raca, data_nascimento, data_nascimento_confianca, observacoes}}`; nome repetido entre externos → aviso `POSSIVEL_DUPLICIDADE`; linha de ANIMAIS nasce na fase C (AUDITORIA CRIAR), situação EXTERNO. Resposta `{animal_id, animal}` |

### 15.3 `PastureService` (propriedades, pastos, painel)

| Membro | Contrato |
|---|---|
| `comandoSalvarPropriedade` — `propriedade.salvar` | `dados: {property_id?, campos: {nome, descricao, localizacao, area_total_ha, status}}`. `NOME_REPETIDO`; INATIVO → `PROPRIEDADE_COM_PASTOS` / `PROPRIEDADE_PADRAO`. A primeira vira `propriedade_padrao_id` se ele estiver vazio. Resposta: a propriedade |
| `comandoSalvarPasto` — `pasto.salvar` | `dados: {pasture_id?, campos: {property_id (criação), nome, identificacao, area_hectares, tipo_capim, capacidade_estimada_ua_ha, capacidade_estimada_cabecas, posse (PROPRIO), arrendador_id, observacoes, status}}`. `ARRENDADOR_SEM_ARRENDAMENTO`, `NAO_ENCONTRADO`, `PROPRIEDADE_INATIVA`, `NOME_REPETIDO` (ativos da propriedade), `CAMPO_IMUTAVEL` (propriedade), `PASTO_COM_ANIMAIS`. Resposta: o pasto |
| `consultaPainel({pasture_id, data?})` — `pasto.painel` | Cabeçalho do pasto + `{data, motivo, cabecas, machos, femeas, por_categoria, sem_categoria, peso_vivo_total, ua: {valor, motivo, n, estimado, ua_peso_kg, partes: {pesada, pesagem_vencida, sem_pesagem: {cabecas, peso_kg, ua}}, sem_peso, rotulo}, ua_ha, capacidade, ocupacao_pct: {valor, motivo, n, base: UA_HA\|CABECAS, estimado}, animais, parametros}`. Data = fim do dia D (≥ marco zero; antes → nulos com `ANTERIOR_AO_MARCO_ZERO`); futura → `VALIDATION`; `NOT_FOUND` |
| `consultaListar({property_id?, incluir_inativos?})` — `pasto.listar` | Cartões de hoje (o painel sem `animais`), por nome |
| `lotacao(pasto, composicao)` | Pura: UA/ha (`SEM_VALOR_DE_REFERENCIA` sem área), ocupação por UA/ha ou por cabeças; sem capacidade → `null` |

### 15.4 `InventoryService` (posição, visão geral, alertas)

| Membro | Contrato |
|---|---|
| `presentes(L, data)` | `{motivo, itens: [{animal, pasture_id}]}` pelo replay até o fim de D; sem marco zero `DADOS_INSUFICIENTES`, antes dele `ANTERIOR_AO_MARCO_ZERO` (itens `null`) |
| `compor(L, itens, data, {animais}?)` | `{cabecas, machos, femeas, por_categoria (por prioridade), sem_categoria, peso_vivo_total, ua, animais?}` |
| `consultaPosicao({data?, animal_id?})` — `inventario.posicao` | `{data, marco_zero, motivo, cabecas, por_sexo: {M, F}, por_pasto: [{pasture_id, nome, cabecas}], sem_pasto, por_categoria, sem_categoria, peso_vivo_total, ua}`; com `animal_id`: `{data, animal_id, presente, pasture_id, motivo}`. Futura/inválida → `VALIDATION`; animal inexistente → `NOT_FOUND` |
| `consultaVisaoGeral()` — `dashboard.obter` (Fase 1) | Posição de hoje + `geradoEm` + `pendencias: {sem_pasto, sem_brinco, sem_categoria}` |
| `consultaAlertas(estado)` — `alerta.listar` | `estado = {backup: {ultimo_em: ISO\|null}, integridade: {verificado_em, erros}\|null}` vem de quem chama (Maintenance/Api; fora da planilha). Devolve `{data, geradoEm, alertas: [{codigo, nivel AVISO\|ERRO, mensagem, n, ids, entidade}], nao_avaliados: [{codigo, motivo, mensagem}]}`; códigos `ALERTAS`: ATIVO_SEM_PASTO, SEM_BRINCO, SEM_CATEGORIA, BACKUP_ATRASADO (`alerta_backup_atrasado_dias`; nenhum backup = alerta), INTEGRIDADE_COM_ERRO, IMPORTACAO_INCOMPLETA (IMPORTACOES `IMPORTANDO`). Parte do `estado` ausente vai para `nao_avaliados` |

## 16. `FileService` (plataforma: Drive v3 e UrlFetchApp)

**Porta `FileService.porta() → files`** (a `ctx.files`). Todo arquivo nasce pelo Drive v3 (`Drive.Files.create`,
`copy`, `update`); bytes só pela rota REST `alt=media` (UrlFetchApp com `ScriptApp.getOAuthToken()`). `pasta` ∈ `raiz`
(ERP Pecuário), `backups`, `exportacoes`, `anexos`, `testes`.

| Membro | Contrato |
|---|---|
| `garantirPastas() → {raiz, backups, exportacoes, anexos, testes, criadas: [nomes]}` | Reencontra pelo ID de `DRIVE_FOLDERS`, depois pelo nome na pasta-mãe; senão cria. Regrava `DRIVE_FOLDERS` só se mudou. Falha do Drive → `CONFIG` com a instrução do escopo `drive` |
| `pastas()` | Os IDs (garante na primeira chamada da execução) |
| `obter(id) → File \| null` | Metadados (`id, name, mimeType, createdTime, modifiedTime, appProperties, size, trashed, parents`); 404 → `null` |
| `criarPlanilha(nome, pasta, appProperties) → id` | Planilha nova pelo Drive (nunca `SpreadsheetApp.create`) |
| `copiar(id, {nome, pasta, appProperties, descricao}) → {id, name, createdTime, appProperties}` | Cópia pelo Drive |
| `lixeira(id) → booleano` | `trashed = true`; inexistente → `false` |
| `listar(pasta, {appProperties: {k: v}, criadoAntesDe, mimeType}?)` | Fora da lixeira, todas as páginas, por `createdTime`: `[{id, name, mimeType, createdTime, modifiedTime, appProperties, size}]` |
| `guardarArquivo({nome, mimeType, base64 \| texto, pasta, appProperties}) → {id, tamanho}` | Base64 vazio ou ilegível → `VALIDATION` |
| `guardarAnexo({nome, mimeType, base64, miniaturaBase64, appProperties}) → {drive_file_id, thumb_drive_file_id, tamanho_bytes}` | Na pasta Anexos; acima de `TAMANHO_MAX_ANEXO` (5 MB) o arquivo vai para a lixeira e `VALIDATION` |
| `lerBytes(id) → {base64, mimeType, tamanho}` | 404 (inclusive arquivo que o app não criou) → `NOT_FOUND`; outro código → `INTERNAL` com `causa` |
| `textoDeBase64(base64, codificacao) → texto` | UTF-8, ISO-8859-1 (LATIN1), WINDOWS-1252, US-ASCII; tira o BOM; outra → `VALIDATION` |
| `sondar() → {ok, passos: [{passo, ok, erro}]}` | SP-02: criar, copiar, ler, listar e lixeira na pasta Testes |

**Anexos (rotas `anexo.*`; ANEXOS: TEMPORARIO → ATIVO → REMOVIDO).** O arquivo vai ao Drive ANTES do comando; a linha
nasce na fase C (`AuditService.criacao`). Arquivo cujo comando não vale vai para a lixeira (só quando
`UnitOfWork.status` diz FALHOU ou INEXISTENTE; na dúvida, a limpeza diária decide pela planilha). appProperties dos
arquivos: `erp_tipo = ANEXO`, `erp_banco`, `erp_entidade`, `erp_entity_id`. `LEITURAS_ANEXO` = ANEXOS, ANIMAIS,
EVENTOS, IMPORTACOES.

| Função | Contrato |
|---|---|
| `adicionarAnexo(ctx, {idempotencyKey, dados: {entidade (ANIMAIS\|EVENTOS\|IMPORTACOES), entity_id, tipo, descricao, nome_arquivo, mime_type, conteudo_base64, miniatura_base64, temporario, definir_como_foto}})` | `{dados: anexo, duplicado, opId, dataVersion}`. Envio malformado → `VALIDATION` antes de subir; dono inexistente ou anulado → `NOT_FOUND`; reenvio de chave confirmada não sobe de novo. `definir_como_foto` (só FOTO de animal) grava `ANIMAIS.foto_anexo_id` (auditado) |
| `promover(tx, [anexo_id]) → n` | Dentro do tratador do comando dono (ANEXOS nas `reads`): TEMPORARIO → ATIVO. Inexistente ou REMOVIDO → `VALIDATION` |
| `removerAnexo(ctx, {idempotencyKey, dados: {anexo_id, justificativa}})` | REMOVIDO (a linha fica); tira a foto da ficha se era ela; arquivo e miniatura vão para a lixeira depois do commit. Já removido → `VALIDATION` `JA_REMOVIDO` |
| `obterAnexo(ctx, {anexo_id, miniatura})` | `{dados: {anexo, miniatura, data_url}, dataVersion}`; removido ou inexistente → `NOT_FOUND` |
| `anexoPublico(linha)` | `{anexo_id, entidade, entity_id, event_id, nome_arquivo, mime_type, tamanho_bytes, tipo, descricao, status, tem_miniatura, created_by, created_at}` |

## 17. `Maintenance` (plataforma: setup, backup, restauração, rotinas agendadas)

Script Properties: `SPREADSHEET_ID`, `OWNER_EMAIL`, `DRIVE_FOLDERS`, `IO_PRIMITIVE` (forma de gravação escolhida),
`IO_PRIMITIVE_RELATORIO` (resumo do corpus), `DATA_VERSION:<id>`, `PENDING_OP:<id>`, `INTEGRIDADE:<id>` (resumo da
última verificação semanal `{gerado_em, ok, erros, alertas}`). Backup = arquivo na pasta Backups com appProperties
`erp_tipo = BACKUP`, `erp_banco`, `erp_data` (yyyy-MM-dd no fuso), `erp_motivo`, `erp_instante`. A guarda
`assertOwner_` das funções públicas é do Code.js; os handlers dos gatilhos montam o contexto com `contexto()`.

| Função | Contrato |
|---|---|
| `contexto({banco, usuario, fuso}?)` | Contexto de produção: banco de `SPREADSHEET_ID`, primitiva de `IO_PRIMITIVE`, `FileService.porta()`, `Timeline.porta()`. Sem banco → `CONFIG` |
| `setup({usuario, fuso, tabelas})` | 06, seção 4, idempotente: dono (`OWNER_EMAIL` na primeira vez; outro → `DENIED`) → lock (`LOCKED`) → pastas e sonda do Drive (`CONFIG` com a contingência) → backup cru do banco existente (SETUP; banco registrado sumido → `CONFIG`, nunca cria outro) → corpus numa planilha temporária na pasta Testes, que vai para a lixeira (nenhuma passa → `CONFIG`, banco intocado) → banco pelo Drive → abas na dimensão exata (a aba padrão vazia do banco novo sai) → colunas ao final → sementes por chave natural num comando (`anexaSemPai`, AUDITORIA `MANUTENCAO`) → fuso de `CONFIGURACOES.fuso` e locale `pt_BR` → SCHEMA_META (colunas do sistema na ordem real; `versao` sobe quando cresce) → contadores → gatilhos → proteção "somente aviso" → integridade. `tabelas` = definições que substituem as do Schema (migração; teste do esquema da fase seguinte). Devolve `{banco, banco_criado, pastas, drive, backup, primitiva: {primitiva, resultados: [{primitiva, ok, divergencias, erro}]}, abas: {criadas, colunas_acrescentadas, removidas}, sementes: {CONFIGURACOES, LISTAS, PLANO_CONTAS, CATEGORIAS}, fuso, schema_meta: {criadas, atualizadas}, contadores: {proximo_event_seq, proximo_codigo_interno}, gatilhos, protecoes, integridade}` |
| `backup(ctx, {motivo})` | `MOTIVOS_BACKUP`: DIARIO, SOB_DEMANDA (padrão), SETUP, IMPORTACAO, RESTAURACAO. `UnitOfWork.exclusivo` (lock, recuperação, flush) e cópia pelo Drive; o DIARIO aplica a retenção. `{backup: {id, nome, data, instante, motivo}, retencao}`. Falha da cópia → `CONFIG` com instrução |
| `listarBackups(ctx, {todos}?)` | Deste banco (ou todos), do mais novo: `[{id, nome, data, instante, motivo, banco}]` |
| `aplicarRetencao(ctx) → {mantidos, removidos: [nome]}` | Os `backup_retencao_diarios` DIARIO mais recentes; dos mais antigos, o último de cada mês nos `backup_retencao_mensais` meses mais recentes; os demais motivos ficam o mesmo número de dias; o resto vai para a lixeira |
| `restaurar(ctx, {dados: {backup_id, justificativa}})` | 06, seção 10: cópia do backup pelo Drive (pasta raiz, `erp_tipo = BANCO`); `DATA_VERSION` do novo = maior das duas + 1; marcador do novo ANTES de trocar a propriedade do banco em uso (`SPREADSHEET_ID`, ou `TEST_`/`DEMO_` quando é a do contexto); `recoverAll`; AUDITORIA `MANUTENCAO` no novo; integridade. O anterior fica no Drive. `{banco_anterior, banco, backup, recuperacao, dataVersion, integridade}`. Erros: `NOT_FOUND` (não é backup), `LOCKED`, `CONFIG` |
| `limparExportacoes(ctx) → {removidas}` | Exportações com mais de `EXPORTACAO_VALIDADE_DIAS` (7) |
| `limparAnexos(ctx) → {temporarios, orfaos, arquivos_removidos}` | TEMPORARIO com mais de 24 h → REMOVIDO (comando auditado) e lixeira; arquivo deste banco na pasta Anexos sem linha em ANEXOS e com mais de 24 h → lixeira; arquivo de anexo REMOVIDO ainda fora da lixeira → lixeira |
| `manutencaoDiaria(ctx)` | Corpo de `trgManutencaoDiaria`: backup DIARIO com retenção → exportações → anexos. Etapa que falha não impede as seguintes; vai para ERROS_LOG (`MANUTENCAO_<ETAPA>`) e no fim lança `INTERNAL` com `erro.relatorio`. Sem falha: `{backup, retencao, exportacoes, anexos, falhas: []}` |
| `integridadeSemanal(ctx)` | Corpo de `trgIntegridadeSemanal`: o relatório; resumo em `INTEGRIDADE:<banco>`; com erro, ERROS_LOG `INTEGRIDADE_COM_ERRO` |
| `garantirGatilhos(fuso) → {criados, removidos, total}` | Por nome da função: `trgManutencaoDiaria` diário às 3 h e `trgIntegridadeSemanal` aos domingos às 5 h, no fuso; cria o que falta, apaga duplicata |
| `estado(ctx)` | Tela de sistema: `{banco, primitiva, data_version, backups, ultimo_backup, integridade, gatilhos, alertas_estado}`; `alertas_estado` = `{backup: {ultimo_em}, integridade: {verificado_em, erros} \| null}`, o parâmetro de `InventoryService.consultaAlertas` |

## 18. `ImportService` (puro: importação de ANIMAIS)

Rotas `importacao.*` (com `permiteDuranteImportacao`, salvo `criar`); enquanto uma importação está IMPORTANDO, a
UnitOfWork recusa os demais comandos de negócio (`CONFLICT`). Cada lote é UMA operação de chave
`chaveBloco(import_id, n)` = `imp:<import_id>:<n>` (conclusão `:concluir`, desfazer `:desfazer`), com UMA ENTRADA_INICIAL
planejada por `EventService.planejarEntradaImportada`: os eventos só valem com IMPORTADO; até lá os animais ficam
PENDENTE (com os atributos declarados). Tamanho do bloco de validação e de importação = `importacao_lote_linhas`
(1 a 1000), fixado na confirmação em `relatorio_json.lote_linhas`.

`mapeamento` (gravado em `mapeamento_json`): `{colunas: {cabeçalho: campo}, confiancas: {data_nascimento, data_entrada,
mae, pai}, padroes: {castrado, reprodutor, origem, pasto (pasture_id), metodo_pesagem}}` — o padrão é escolha explícita
do dono; sem ele, vazio = desconhecido. Campos (`CAMPOS`): `brinco, nome, sexo, raca, data_nascimento, idade_meses,
data_nascimento_confianca, mae, mae_confianca, pai, pai_confianca, origem, castrado, reprodutor, partos_previos,
situacao_reprodutiva, data_prevista_parto, pasto, data_entrada, data_entrada_confianca, peso, metodo_pesagem,
valor_abertura, brinco_origem, rfid, sisbov, tatuagem, observacoes` (`mae`/`pai` = brinco do progenitor no arquivo ou no
rebanho; `pasto` = nome ou identificação; raça por código ou rótulo de LISTAS). Obrigatório mapear `sexo` e `pasto` (ou
o padrão) e dar a confiança de nascimento, chegada, mãe e pai quando mapeados sem coluna de confiança. `formato`:
`{delimitador (',' ';' TAB '|'), codificacao, formato_data (dd/MM/yyyy, yyyy-MM-dd, MM/dd/yyyy, dd-MM-yyyy, dd.MM.yyyy;
ISO sempre aceito), decimal (',' ou '.')}`.

| Função | Contrato |
|---|---|
| `criar(ctx, {idempotencyKey, avisosAceitos, dados: {tipo: 'ANIMAIS', arquivo_nome, conteudo_base64 \| texto, formato}})` | Lê o arquivo (`VALIDATION`: vazio, só cabeçalho, coluna repetida, aspas abertas, mais de 20.000 linhas, formato), guarda o original no Drive e em ANEXOS (DOCUMENTO, ATIVO) e cria IMPORTACOES RASCUNHO com `arquivo_hash` (SHA-256 do texto). Mesmo arquivo já enviado → aviso `POSSIVEL_DUPLICIDADE`. Outro tipo → `VALIDATION` `TIPO_INDISPONIVEL`. `{dados: {import_id, status, cabecalho, amostra, total_linhas, sugestao}}` |
| `previaArquivo(ctx, {import_id})` | O mesmo, relido do Drive (retomar o assistente), + `mapeamento` gravado |
| `validarBloco(ctx, {idempotencyKey, dados: {import_id, bloco, mapeamento}})` | Relê e valida o arquivo INTEIRO (duplicidade no arquivo e na base, mãe e pai em duas passadas, ciclos, confiança, regras do catálogo e do marco zero) e grava só as linhas do bloco (anexa ou atualiza por `linha_num`). O bloco 1 recomeça e grava o mapeamento; os seguintes exigem o mesmo mapeamento e o anterior validado (`CONFLICT`). Linha: VALIDA, ERRO ou DUPLICADA com `erros_json` `[{codigo, campo, mensagem}]`. Última linha → VALIDADO. Sem marco zero → `CONFIG`. Devolve o estado (`obter`) |
| `importarBloco(ctx, {avisosAceitos, dados: {import_id, bloco, modo, aprovacao: {importar, ignorar}, ignorar_linhas, property_id, justificativa_aviso}})` | Bloco 1 = confirmação: revalida (resultado diferente do gravado → `CONFLICT` "valide de novo"); `TOTAL` só sem linha reprovada (`IMPORTACAO_TOTAL_RECUSADA`); `PARCIAL_APROVADO` exige `aprovacao` igual aos números de agora (`APROVACAO_DIVERGENTE`) e fica em AUDITORIA (justificativa com quem aprovou); `ignorar_linhas` → IGNORADA (não pode ser progenitor de linha que entra: `PROGENITOR_IGNORADO`). Ordem de importação: progenitor do arquivo antes do filho, depois a linha. Blocos em ordem (`CONFLICT`); bloco já gravado por outra chave → sem alteração. Linhas → IMPORTADA com `entity_id_gerado`/`event_id_gerado`. Avisos do motor (ex.: `IDADE_REPRODUTIVA`) → `NEEDS_CONFIRMATION` |
| `concluir(ctx, {dados: {import_id}})` | Exige todos os lotes (`CONFLICT`); backup IMPORTACAO ANTES; IMPORTADO (commit do arquivo inteiro), `finished_at`, reconstrução total das projeções. Devolve o relatório final |
| `desfazer(ctx, {dados: {import_id, justificativa}})` | Qualquer estado menos CANCELADO → CANCELADO (nada se apaga; reconstrução total se havia eventos). IMPORTADO com lançamento, filho ou anexo posterior sobre os animais → `CONFLICT` com os detalhes (`conflito.event_id`) |
| `consultaObter({import_id})` / `obter(ctx, dados)` | `{importacao, contadores: {total, conferidas, validas, erro, duplicadas, ignoradas, importadas, por_codigo}, blocos: {tamanho, total, importados, proximo}, validacao: {conferidas, completa}, pode: {validar, importar, concluir, desfazer}}` |
| `consultaLinhas({import_id, status, pagina, por_pagina})` | Pré-visualização: `{total, pagina, por_pagina, itens: [{linha_num, status, erros, dados_originais, interpretado, entity_id_gerado, event_id_gerado}]}` |
| `consultaRelatorio({import_id})` | Relatório final: o estado + `aprovacao {modo, por, em, texto}`, `criados {animais, eventos, ativos}`, `reprovadas [{linha_num, status, erros, dados_originais}]`, `ignoradas`, `pendencias {sem_brinco, sem_nascimento}` |
| `consultaListar()` | `{itens, em_curso}` (a importação IMPORTANDO, para a faixa "importação incompleta") |
| Puras: `lerCsv(texto, delim)`, `interpretarArquivo(texto, delim) → {cabecalho, linhas: [{linha_num, valores}]}`, `sugerirMapeamento(cabecalho)`, `conferirMapeamento(m, cabecalho, pastosPorId)`, `validarLinhas(linhas, map, formato, contexto)` | `linha_num` conta o cabeçalho como 1 e as linhas em branco (é a linha da planilha do dono); célula além do cabeçalho fica em `#coluna_extra_N` e reprova a linha |

Códigos de linha — DUPLICADA: `BRINCO_JA_CADASTRADO`, `BRINCO_REPETIDO_NO_ARQUIVO`; ERRO: `MAE_NAO_ENCONTRADA`,
`PAI_NAO_ENCONTRADO`, `MAE_COM_ERRO`, `PAI_COM_ERRO`, `SEXO_DO_PROGENITOR`, `NASCIMENTO_DO_PROGENITOR`,
`PROPRIO_PROGENITOR`, `CICLO_GENEALOGICO`, `DATA_INVALIDA`, `FORMATO_INVALIDO`, `TIPO_INVALIDO`, `VALOR_FORA_DA_LISTA`,
`PASTO_NAO_ENCONTRADO`, `PASTO_INATIVO`, `COLUNAS_A_MAIS`, `CONFLITO_DE_CAMPOS`, `NASCIMENTO_DEPOIS_DA_ENTRADA`,
`ENTRADA_DEPOIS_DO_MARCO_ZERO`, `ENTRADA_ANTES_DO_NASCIMENTO`, `PREVISAO_PASSADA`, `CASTRADO_REPRODUTOR`,
`BRINCO_NAO_NUMERICO` e os do catálogo (`CAMPO_OBRIGATORIO`, `CAMPO_NAO_SE_APLICA`, ...).

### 18.1 Apoio aos testes de sistema (`tests/apoio-sistema.js`)

`sistema({order, semCadastro, config})`: o banco nasce pelo `Maintenance.setup`; sem `semCadastro`, um comando auditado
cria a propriedade `PROP`, os pastos `PASTOS.A` e `PASTOS.B` (identificação `P-B`) e grava `data_marco_zero =
2026-01-01`, `propriedade_padrao_id` e o que vier em `config`. Helpers: `ctx()` (portas reais, com `files`), `exec(fn)`,
`tentar(fn)`, `read(q)`, `tabela(aba, banco?)`, `evento(acao, dados, chave)`, `integridade()`, `conferirProjecoes()`,
`editar(aba, id, coluna, valorCru)` e `apagarLinha(aba, id)` (edição à mão no fake); `situacoes(relatorio)`.
