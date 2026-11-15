# Relatório da Fase 1 — Fundação

Data: 15/11/2026. Versão do app: 0.1.0. Plano: `docs/fase-0/10-plano-de-implementacao.md`, seção 4 (entregas E1.0 a
E1.12) e seção 8 (checklist).

## Em resumo

- **O código da Fase 1 está completo no repositório** (`erp-pecuario/src/`: 20 arquivos `.js`, 10 `.html` e o
  manifesto) e passou em todos os testes que rodam aqui: **`npm test` com 327 testes, 327 aprovados, 0 falhas** e
  **`npm run ui:check` com 29 testes de navegador, 29 aprovados, 0 falhas**.
- **Nada foi implantado nem executado na conta Google do dono.** Esta sessão não tem acesso a ela. O diagnóstico do
  spike (`runDiagnostics`), os testes de aceitação (`runAcceptanceTests`) e a página de concorrência estão
  **PENDENTES NA CONTA DO DONO**. Pela regra de honestidade (abaixo), **a Fase 1 não está fechada** até esses
  resultados chegarem: o código está entregue, a validação no ambiente real não.
- Como implantar e executar: `docs/GUIA_DE_IMPLANTACAO.md`.

## Regra de honestidade (09-plano-de-testes.md, seção 1)

Cada item deste relatório tem um de quatro estados:

| Estado | Significado |
|---|---|
| `EXECUTADO AQUI` | Rodou neste repositório; o comando e as contagens estão copiados da saída real |
| `EXECUTADO PELO DONO` | Rodou na conta do dono, com o arquivo de resultado. **Nenhum item está neste estado ainda** |
| `PENDENTE NA CONTA DO DONO` | Só pode ser executado na conta Google do dono; o roteiro está pronto |
| `NÃO SE APLICA` | Não se aplica a esta fase, com o motivo |

O nível 3 (Playwright) é `EXECUTADO AQUI` porque o navegador rodou neste ambiente. Ele roda contra um mock de
`google.script.run` ligado ao backend real do harness, não dentro do quadro (iframe) do HtmlService.

## 1. Entregas

| Entrega | O que foi entregue | Arquivos | Testes que cobrem | Estado |
|---|---|---|---|---|
| E1.0 Spike técnico e relatório | Decisão para cada item SP-01 a SP-10 sem depender de comportamento não verificado (desenho-base, seção 17), com a verificação real embutida: `runDiagnostics` (SP-01 a SP-10 e fuso do runtime; relatório JSON sem dado sensível na pasta Testes) e o diagnóstico rápido da tela de sistema (`sistema.diagnostico`) | `TestRunner`, `Database` (funções de diagnóstico), `FileService.sondar`, `Api.diagnosticoSessao` | `acceptance.test.js` (diagnóstico no fake: itens, formato do fixture de coerção, temporárias na lixeira, sem dado sensível) | Instrumento `EXECUTADO AQUI` (no fake). Execução, relatório do spike e atualização de `12-fatos-de-plataforma.md`: `PENDENTE NA CONTA DO DONO` |
| E1.1 Estrutura do projeto e testes | Manifesto (V8, cinco escopos, Sheets v4 e Drive v3, `MYSELF` + `USER_DEPLOYING`); harness `vm` com fakes fiéis (planilha com coerção Geral, buffer e morte da execução, lock com intercalação, Properties, Drive `drive.file`, UrlFetch); lint de camadas e de superfície pública; `gas:push`, `gen:schema`, `ui:check` | `src/appsscript.json`, `tests/harness.js`, `tests/fakes/`, `tests/static.test.js`, `scripts/` | `harness.test.js`, `static.test.js` | `EXECUTADO AQUI` |
| E1.2 Esquema e `setup()` | `Schema` gerado dos dicionários 03a/03b (34 abas, tipos, enums, sementes); `setup()` idempotente nos 11 passos de 06, seção 4 (backup antes, forma de gravação pelo corpus, abas na dimensão exata, colunas ao final, sementes por chave natural, fuso e `pt_BR`, SCHEMA_META, contadores, gatilhos, proteção de aviso, integridade) | `Schema`, `Maintenance`, `Config`, `Code` | `schema.test.js`, `setup.test.js` (CT-11) | `EXECUTADO AQUI`; CT-11 com serviços reais: `PENDENTE NA CONTA DO DONO` |
| E1.3 Persistência | Porta de E/S com três formas de gravação (`SHEETS_TYPED`, `SHEETS_RAW`, `SPREADSHEET_APP`), codec único por tipo de coluna com relato de célula coercida, corpus de ida e volta, portas reais (lock, relógio, ids, hash, propriedades); repositório com vigência, índices, contadores e plano de escrita | `Database`, `Repository`, `Utils`, `Validation` | `database.test.js`, `repository.test.js`, `utils.test.js`, `validation.test.js` | `EXECUTADO AQUI`; corpus e atomicidade reais (SP-01): `PENDENTE NA CONTA DO DONO` |
| E1.4 UnitOfWork | Três fases com commit numa célula, journal em OPERACOES, idempotência por chave e hash, recuperação reentrante e `recoverAll`, leitura otimista validada, estado da operação, exceção tratada durante a gravação, modo SIMULAR, recusa de comandos com importação em curso; auditoria como registro de refazer | `UnitOfWork`, `AuditService` (parte 1) | `unitofwork.test.js` (todas as quedas de 06, seções 5.1 e 5.2), `unitofwork.adversarial.test.js` (morte depois de cada escrita, intercalações, dois bancos, resposta perdida) | `EXECUTADO AQUI`; lock e buffer reais (SP-03): `PENDENTE NA CONTA DO DONO` |
| E1.5 API | Guarda de dono (com `ALLOW_EMPTY_ACTIVE_USER` e gatilho por `triggerUid`), roteador das 51 rotas canônicas mais as extras documentadas, envelope copiado por JSON, avisos com aceite, estado da operação, carga inicial condicional pela versão dos dados, ambientes PRODUCAO/TESTE/DEMO, rascunho no servidor | `Api`, `Code` | `api.test.js` | `EXECUTADO AQUI`; e-mail ativo real (SP-04): `PENDENTE NA CONTA DO DONO` |
| E1.6 Motor de eventos | Catálogo dos 21 tipos (completos os da Fase 1: ENTRADA_INICIAL, OUTRA_ENTRADA, AJUSTE_INVENTARIO com CORRECAO_CADASTRO, IDENTIFICACAO_INCORRETA e CORRECAO_LOCALIZACAO, ESTORNO); pipeline; validador único da linha do tempo; marco zero; projetor; estorno e substituição (mesmos `animal_id`); brinco único; genealogia; avisos; guarda de duplicidade; valor de abertura | `EventCatalog`, `EventService`, `Timeline` | `events.test.js` (CT-09, CT-10, CT-18), `timeline.test.js`, `regras.fase1.test.js` | `EXECUTADO AQUI` |
| E1.7 Cadastros | Propriedades, pastos próprios e arrendados (posse, arrendador) com painel básico, categorias com teste de cobertura, listas, parâmetros tipados | `Config`, `PastureService`, `InventoryService` | `config.test.js`, `pastures.test.js`, `inventory.test.js` | `EXECUTADO AQUI` |
| E1.8 Animais | Lista com os filtros da §5 e CSV, ficha (blocos A a J), árvore genealógica, edição com auditoria (campo sensível vira ajuste), animal externo, fotos e documentos | `AnimalService`, `FileService`, `Animals.html` | `animals.test.js`, `files.test.js`, `ui/telas.test.js` | `EXECUTADO AQUI`; abertura do CSV e das fotos no celular (SP-07): `PENDENTE NA CONTA DO DONO` |
| E1.9 Interface base | SPA sem biblioteca externa: cliente da API (novas tentativas com a mesma chave, verificação do estado depois de 45 s sem resposta), store com carga condicional, roteador, rascunhos (aparelho ou servidor), componentes, formulário do catálogo, seletor de animais, registrar evento, Início com números reais, Pastos, Eventos, Configurações | `Index`, `Styles`, `JavaScript`, `Components`, `Dashboard`, `Pastures`, `Events`, `Settings` | `interface.test.js`, `telas.test.js`, `ui/interface.test.js`, `ui/telas.test.js` | `EXECUTADO AQUI` (Node e Chromium); iframe real, `localStorage` e histórico no celular (SP-06): `PENDENTE NA CONTA DO DONO` |
| E1.10 Importação de animais | Os 10 passos da §14: original guardado com hash, CSV ou colagem, mapeamento com confiança e padrões explícitos, validação em blocos com duplicidades no arquivo e na base e genealogia em duas passadas, pré-visualização, TOTAL ou PARCIAL_APROVADO registrado, lotes de chave determinística, conclusão com backup antes, desfazer, relatório; assistente de 5 telas | `ImportService`, `Import.html` | `import.test.js` (CT-12 da Fase 1, queda em cada fronteira), `ui/telas.test.js` | `EXECUTADO AQUI` |
| E1.11 Backup e integridade | Backup diário e sob demanda (banco parado), retenção 30 + 12, restauração por comando com `recoverAll`, rotina diária e semanal, 20 checagens de integridade com reparo auditado, tela de sistema | `Maintenance`, `AuditService` (parte 2), `FileService`, `Settings.html` | `maintenance.test.js` (ensaio completo de restauração), `integrity.test.js` (cada checagem disparada por adulteração), `files.test.js` | `EXECUTADO AQUI`; Drive e gatilhos reais (SP-02, SP-09) e o ensaio na conta: `PENDENTE NA CONTA DO DONO` |
| E1.12 Aceitação, guia e relatório | `runAcceptanceTests` (base de teste temporária pela Drive API, cenários pela Api, retomável, relatório JSON, isolamento conferido), base de demonstração (304 ativos só por comandos), página de concorrência, jornada de ponta a ponta, guia de implantação, este relatório, README | `TestRunner`, `README.md`, `docs/GUIA_DE_IMPLANTACAO.md`, `docs/RELATORIO_FASE1.md` | `acceptance.test.js`, `jornada.fase1.test.js` | `EXECUTADO AQUI` (os mesmos cenários no fake); na conta: `PENDENTE NA CONTA DO DONO` |

## 2. Resultados dos testes executados aqui

Ambiente: Node 22.23.4 (Linux), Playwright 1.63.0 com Chromium. Execução de 15/11/2026, depois da última alteração de
código desta fase.

### 2.1 Nível 1 — `npm test` (`node --test tests/*.test.js`)

Saída: `# tests 327 · # pass 327 · # fail 0 · # cancelled 0 · # skipped 0 · # todo 0` (duração TOTAL_NPM_TEST).
Contagem por arquivo (cada arquivo rodado sozinho com `node --test <arquivo>`):

| Arquivo | Testes | Aprovados | Falhas | O que cobre |
|---|---:|---:|---:|---|
CONTAGEM_POR_ARQUIVO

### 2.2 Nível 3 — `npm run ui:check`

Parte estática: `ui:check — 10 arquivo(s) .html conferidos (e a página montada pelo doGet), sem recurso externo e
dentro do orçamento.` Parte Playwright: `# tests 29 · # pass 29 · # fail 0 · # cancelled 0 · # skipped 0 · # todo 0`
(duração TOTAL_UI_CHECK).

| Arquivo | Testes | Aprovados | Falhas | O que cobre |
|---|---:|---:|---:|---|
CONTAGEM_UI

### 2.3 Cenários da Fase 1 por nível

| Cenário (09-plano-de-testes.md) | Nível 1 (Node) | Nível 2 (conta do dono) |
|---|---|---|
| CT-09 Integridade: brinco duplicado, mãe inválida | `EXECUTADO AQUI` (`events.test.js`, `regras.fase1.test.js`, `acceptance.test.js`); passos de VENDA, TRANSFERENCIA, MORTE e COMPRA: `NÃO SE APLICA` (Fase 2) | `PENDENTE NA CONTA DO DONO` |
| CT-10 Reenvio e concorrência (OUTRA_ENTRADA no lugar da PESAGEM) | `EXECUTADO AQUI` (`events.test.js`, `unitofwork*.test.js`, `acceptance.test.js`); passo 3 (PESAGEM): `NÃO SE APLICA` (Fase 3) | `PENDENTE NA CONTA DO DONO`, inclusive a página de concorrência (passo 6) |
| CT-11 `setup()` repetido e esquema da fase seguinte | `EXECUTADO AQUI` (`setup.test.js`, `acceptance.test.js`) | `PENDENTE NA CONTA DO DONO` |
| CT-12 Importação: erros, duplicatas, total recusado, parcial aprovado, queda no meio, desfazer | `EXECUTADO AQUI` (`import.test.js`, `acceptance.test.js`, `jornada.fase1.test.js`, `ui/telas.test.js`); reconciliação com o histórico: `NÃO SE APLICA` (Fase 2) | `PENDENTE NA CONTA DO DONO` |
| CT-18 Substituição de entrada com os mesmos `animal_id` | `EXECUTADO AQUI` (`events.test.js`, `acceptance.test.js`) | `PENDENTE NA CONTA DO DONO` |
| CT-20 Corpus de tipos e edição manual | `EXECUTADO AQUI` (`database.test.js`, `harness.test.js`, `integrity.test.js`, `acceptance.test.js`) | `PENDENTE NA CONTA DO DONO` (corpus real também no SP-01) |
| Quedas do protocolo (06, seções 5.1 a 5.3) | `EXECUTADO AQUI` (`unitofwork.test.js`, `unitofwork.adversarial.test.js`, `import.test.js`) | `NÃO SE APLICA`: não há como matar a execução real num ponto exato (09, seção 1) |
| Ensaio de restauração de backup | `EXECUTADO AQUI` (`maintenance.test.js`, `jornada.fase1.test.js`, `acceptance.test.js`) | `PENDENTE NA CONTA DO DONO` (cenário RESTAURACAO) |
| Isolamento da base real durante a aceitação | `EXECUTADO AQUI` (`acceptance.test.js`) | `PENDENTE NA CONTA DO DONO` (cenário ISOLAMENTO) |
| CT-01 a CT-08, CT-13 a CT-17, CT-19 | `NÃO SE APLICA`: eventos das Fases 2 a 5 (o rateio com centavos do CT-13 já tem teste de `Utils` e a exportação CSV do CT-16 já tem teste de tela) | `NÃO SE APLICA` |

## 3. O que só o dono pode executar (PENDENTE)

Nada abaixo foi executado. O roteiro está em `docs/GUIA_DE_IMPLANTACAO.md`.

| Item | Como | Evidência a devolver | Estado |
|---|---|---|---|
| Implantar (criar projeto, enviar os 31 arquivos, publicar) | Guia, seções 1 a 3 | — | `PENDENTE NA CONTA DO DONO` |
| `setup()` na base real | Guia, seção 4 | Linha `setup: {...}` do registro | `PENDENTE NA CONTA DO DONO` |
| SP-01 Forma de gravação: corpus, coerção Geral, atomicidade | `runDiagnostics` | Arquivo `ERP Pecuário — diagnóstico <instante>.json` | `PENDENTE NA CONTA DO DONO` |
| SP-02 `drive.file` com Drive v3 | `runDiagnostics` (e o próprio `setup`) | O mesmo arquivo | `PENDENTE NA CONTA DO DONO` |
| SP-03 Lock: obter e soltar; disputa entre execuções | `runDiagnostics` + página de concorrência | O arquivo + captura da página | `PENDENTE NA CONTA DO DONO` |
| SP-04 E-mail do usuário ativo | `runDiagnostics` + abrir o app | O arquivo | `PENDENTE NA CONTA DO DONO` |
| SP-05 Desempenho (10 mil linhas) e custo das propriedades | `runDiagnostics` | O arquivo | `PENDENTE NA CONTA DO DONO` |
| SP-06 Rascunho e histórico no celular | Usar o app no celular (guia, seção 7) | Relato | `PENDENTE NA CONTA DO DONO` |
| SP-07 Abrir o CSV exportado no celular | Rebanho → Exportar no celular | Relato | `PENDENTE NA CONTA DO DONO` (XLSX e PDF: Fase 5) |
| SP-08 Gráficos | — | — | `NÃO SE APLICA`: gráficos SVG próprios, sem CDN |
| SP-09 Gatilhos | `runDiagnostics` + tela Acionadores | O arquivo | `PENDENTE NA CONTA DO DONO` |
| SP-10 Formato em linhas novas | — | — | `NÃO SE APLICA`, salvo se o `setup` escolher `SPREADSHEET_APP` (aí o corpus do SP-01 confere) |
| Fuso do runtime V8 × `Utilities.formatDate` | `runDiagnostics` (item RUNTIME) | O arquivo | `PENDENTE NA CONTA DO DONO` |
| Testes de aceitação (PREPARO, CT-09, CT-10, CT-12, CT-18, RESTAURACAO, CT-20, CT-11, ISOLAMENTO) | `runAcceptanceTests` até `completo: true` | Arquivo `ERP Pecuário — relatório de aceitação <instante>.json` | `PENDENTE NA CONTA DO DONO` |
| Página de concorrência (CT-10, passo 6) | URL `/dev` + `?pagina=concorrencia` | Captura do resultado | `PENDENTE NA CONTA DO DONO` |
| Marco zero (PR-03) e importação do rebanho real | Guia, seção 8 | Relatório final da importação | `PENDENTE NA CONTA DO DONO` |

Com esses arquivos, o próximo passo é: comparar `coercao_geral` com `tests/fixtures/coercao.json` e corrigir o fake se
divergir; registrar o resultado de cada SP em `docs/` e em `12-fatos-de-plataforma.md`; marcar E1.0 no checklist; e
só então dar a Fase 1 por fechada.

## 4. Decisões tomadas durante a implementação

Além das decisões do desenho (seções 16 e 17 do desenho-base), registradas em `docs/CONTRATOS.md`, no código e no
`docs/CHANGELOG.md`:

1. **Forma de gravação.** As três formas ficam atrás da mesma porta e nunca se misturam num comando. O `setup()` roda
   o corpus numa planilha temporária e adota a primeira que passa (`IO_PRIMITIVE`, resumo em
   `IO_PRIMITIVE_RELATORIO`); se nenhuma passar, para sem tocar a planilha-banco. Nenhuma forma presume atomicidade.
   Bases de teste e de demonstração guardam a sua forma em `IO_PRIMITIVE:<banco>`, sem mexer na de produção.
2. **Ambientes.** O pedido leva `ambiente` (PRODUCAO, TESTE, DEMO); o banco vem sempre das Script Properties
   (`SPREADSHEET_ID`, `TEST_SPREADSHEET_ID`, `DEMO_SPREADSHEET_ID`), nunca de um ID enviado pela tela. A página abre
   outra base por `?ambiente=TESTE|DEMO`, com a faixa "BASE DE TESTE".
3. **Escopo do Drive.** `drive.file`, com todo arquivo criado pelo Drive v3; o `setup()` sonda cada operação e devolve
   `CONFIG` com a instrução. O `gas:push` aceita a contingência `drive` no lugar de `drive.file` (nunca as duas).
4. **Rotas.** As 51 canônicas; as de fase futura respondem `NOT_FOUND` dizendo a fase. Rotas extras, todas
   documentadas em `CONTRATOS.md` (o teste estático exige): `importacao.obter`, `previa`, `linhas`, `relatorio`,
   `listar`, `modelo`; `sistema.diagnostico`; `rascunho.salvar`, `obter`, `remover`.
5. **Rascunho (SP-06).** `localStorage` quando responde; senão, nas propriedades do usuário, fora da planilha, com
   limites de 8 KB por rascunho, 40 guardados e validade de 30 dias.
6. **Gráficos e exportação.** SVG próprio com tabela equivalente (SP-08); CSV gerado no aparelho, com BOM, `;` e
   saneamento contra fórmula (SP-07).
7. **Importação.** Cada lote é uma operação de chave determinística `imp:<import_id>:<n>`; a validação de cada bloco
   relê e valida o arquivo inteiro (duplicidade e genealogia não dependem do bloco); o tamanho do bloco fica fixado na
   confirmação; progenitor sem brinco é achado pelo código interno ou pelo nome de um animal externo de referência
   (RN-094).
8. **Backups com linhagem.** Cada backup leva `erp_ambiente`; lista, retenção, último backup e o alerta
   BACKUP_ATRASADO enxergam também os backups dos bancos anteriores do mesmo ambiente (antes, depois de uma
   restauração a lista ficava vazia). Restaurar exige motivo e recusa backup de outra base.
9. **Integridade.** Toda verificação completa atualiza `INTEGRIDADE:<banco>` (semanal, sob demanda, fim do setup,
   restauração, reparo), para o alerta apagar logo depois de um reparo.
10. **Aceitação.** Cenário que usa peça de fase futura roda o que existe e marca o resto `NAO_SE_APLICA` com o motivo
    (CT-10 usa OUTRA_ENTRADA no lugar da PESAGEM). Pausa perto de 4 minutos com cursor em Script Properties e continua
    na chamada seguinte. A base de demonstração é gerada pelos próprios comandos, com semente fixa e chaves `seed:<n>`
    (reexecutar não grava de novo).
11. **Categorias e formulários.** Idade máxima menor que 1 mês e prioridade negativa são recusadas no servidor;
    os formulários recusam 0 onde o servidor exige "maior que 0" (`min_exclusivo`).
12. **Navegação.** Rotas levam só identificadores opacos; o roteador usa `google.script.history` quando existe e cai
    para o endereço do quadro ou só para a memória; rota literal tem preferência sobre rota com parâmetro.
13. **Erros silenciosos.** Falhas tratadas que antes eram silenciosas (pastas do Drive ilegíveis, conferência de
    posições) vão para o log.
14. **Nesta etapa (documentação).** Dois textos do diagnóstico foram corrigidos em `src/TestRunner.js` por orientarem
    errado: o SP-05 sugeria "rodar com linhas maiores", o que a função `runDiagnostics` do editor não aceita (a massa é
    sempre 10 mil linhas); o SP-03 dizia que a página de concorrência confere a liberação do lock quando a execução
    morre, o que ela não faz (confere a disputa entre execuções paralelas).

## 5. Limitações conhecidas

1. **Nada foi validado no ambiente real.** Os fakes reproduzem hipóteses (`CONTRATOS.md`, seção 6.5): coerção da célula
   Geral (fixture), atomicidade do `Spreadsheets.batchUpdate` e não atomicidade do `Values.batchUpdate`, herança de
   formato em linha nova, perda de qualquer subconjunto de escritas na morte da execução, lock reentrante liberado ao
   fim da execução, `appProperties` levadas pela cópia do Drive, `Intl` com fuso no V8. Se o diagnóstico divergir,
   corrige-se o fake e o código, com registro no CHANGELOG.
2. **SP-05 parcial.** Pelo editor, `runDiagnostics` mede só 10 mil linhas em EVENTO_ANIMAIS; 50 mil, 100 mil e 300 mil
   linhas e a abertura a frio em 3G não têm medida automática nesta versão.
3. **SP-03 parcial.** A liberação do lock quando uma execução morre por tempo não é medida (o protocolo presume o pior
   caso para as escritas, mas não há experimento sobre o lock).
4. **Nível 3 fora do iframe real.** Os testes de navegador usam um mock de `google.script.run` numa origem própria; não
   provam `localStorage` no quadro do HtmlService, `google.script.history` nem download no celular (SP-06, SP-07).
5. **`ui:check` depende de Playwright e Chromium instalados no ambiente**, que não estão nas dependências declaradas do
   `package.json`.
6. **Contingência do Drive é manual.** Exige trocar o escopo no manifesto e autorizar de novo; nesse estado o teste do
   manifesto em `npm test` falha de propósito até a contingência ser registrada no repositório.
7. **Restauração pelo histórico de versões do Sheets** não avisa os aparelhos nem refaz as situações: o guia manda, em
   seguida, fazer um backup e restaurá-lo pelo sistema.
8. **Escopo da Fase 1.** Só entradas (rebanho inicial e outras entradas), ajustes de cadastro, identificação e
   localização, e estorno ou correção de entradas. Nascimento, compra, venda, transferência, morte, descarte,
   reclassificação, divergência de contagem, pesagem, sanidade, reprodução, financeiro, XLSX/PDF e relatórios chegam
   nas Fases 2 a 5; as rotas respondem dizendo a fase e o menu não mostra o que não existe.
9. **Limitações do MVP** de `11-riscos-e-premissas.md`, seção 3: só online, um usuário, eventos com data e sem hora,
   alguns segundos por gravação, lote não é entidade, sem integração com balança ou leitor.
10. **Premissas ainda abertas para o dono:** data do marco zero (PR-03) e forma de implantação (PR-16; os dois caminhos
    estão no guia).
