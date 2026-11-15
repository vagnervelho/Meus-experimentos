# Registro de alterações

Cada entrada diz o que mudou, por quê e o que foi verificado. "Verificado em Node" significa testes executados neste
repositório; "a verificar na conta do dono" significa que só o roteiro de diagnóstico no ambiente Google pode confirmar.

## 14/11/2026 — Fase 0 aprovada

- O dono aprovou o desenho técnico e autorizou a execução das fases seguintes com autonomia total.
- Resposta à premissa PR-12: não há gado de terceiros nem parceria; às vezes o gado fica em pasto arrendado. O modelo
  ganhou `PASTOS.posse`, `PASTOS.arrendador_id` e a conta "Arrendamento de pasto" (DV-20).
- O desenho-base passou a ser versionado em `docs/fase-0/00-desenho-base.md`, com as decisões posteriores à revisão
  (seção 16) e as decisões de execução autônoma para os itens do spike (seção 17).

## 14/11/2026 — Início da Fase 1 (Fundação)

- Decisões tomadas sem o spike na conta do dono (detalhe na seção 17 do desenho-base): três primitivas de E/S atrás de uma
  porta única, com escolha automática pelo corpus de tipos no `setup()`; gráficos em SVG próprio, sem CDN; rascunho em
  `localStorage` com alternativa no servidor.

## 14/11/2026 — Fase 1, etapa PERSISTÊNCIA (E1.3 e E1.4)

- `Database`: porta de E/S com as três primitivas (`SHEETS_TYPED`, `SHEETS_RAW`, `SPREADSHEET_APP`), codec único por
  tipo de coluna com relato de células coercidas, corpus de ida e volta com escolha automática da primitiva
  (`escolherPrimitiva`) e as portas reais Lock, Clock, IdGen, Hash e Props.
- `Repository`: predicado de vigência numa função só, vigentes por regra de aba, leitura memoizada das abas
  declaradas, índices em memória, contadores e plano de escrita; acesso cru só pela fachada de leitura crua.
- `UnitOfWork`: comando em três fases com commit numa célula, idempotência por OPERACOES, recuperação reentrante e
  `recoverAll`, leitura otimista validada, estado da operação, exceção tratada durante a gravação, ERROS_LOG fora do
  journal, modo SIMULAR e recusa de comandos de negócio com importação em curso.
- `AuditService` (parte 1): linhas de AUDITORIA como registro de refazer e trilha só de operações confirmadas.
- Verificado em Node: todas as quedas de 06, seções 5.1 e 5.2 (morte antes de cada escrita, nas três primitivas, com
  subconjuntos de escritas pendentes), reentrância da recuperação, intercalações de 06, seção 7, e a tabela de
  idempotência de 06, seção 8. A verificar na conta do dono: corpus, atomicidade e lock reais (SP-01, SP-03).

## 14/11/2026 — Fase 1, ataque à persistência

- `tests/unitofwork.adversarial.test.js`: morte depois de cada escrita (de serviço e de porta) com todas as combinações
  relevantes de escritas pendentes, recuperação morta e repetida, intercalações em cada ponto de troca, dois bancos,
  exceção tratável e resposta perdida em cada escrita, estado da operação com a original viva ou morta, banco
  restaurado no meio de uma operação, corpus e células hostis nas três primitivas.
- Defeitos corrigidos: operação terminada sem `finished_at` ou FALHOU sem `erro` (ordem das escritas); mensagem
  "nada foi alterado" com a operação já confirmada; estado da operação que perdia a trilha de ERROS_LOG; leitura que
  servia estado parcial com órfã sem marcador; texto de AUDITORIA de número ≥ 1e21 que travava a recuperação para
  sempre; leitura de célula hostil (dinheiro enorme, data fora do calendário) que derrubava a aba inteira ou passava
  como "coercida"; dinheiro acima de 15 dígitos aceito sem voltar exato.

## 14/11/2026 — Fase 1, motor de eventos (E1.6)

- `EventCatalog`: os 21 tipos com fase; definições completas de ENTRADA_INICIAL, OUTRA_ENTRADA, AJUSTE_INVENTARIO
  (correção de cadastro, identificação incorreta, correção de localização) e ESTORNO; módulos por fase; serialização
  para o cliente; validação de campos pelo catálogo.
- `Timeline`: ordem canônica com o substituto na posição do original; validador único (evento novo, retroativo,
  estorno, substituição, integridade); fatos independentes; marco zero; projetor de ANIMAIS, IDENTIFICACOES.data_fim e
  FINANCEIRO (porta `ctx.projecoes`); `conferir` (projeção × reconstrução); inventário e pasto em data.
- `EventService`: registrar, corrigir (mesmos `animal_id`), estornar, simular, listar, obter; unicidade de brinco com
  normalização e a exceção do brinco corrigido; genealogia (sexo, datas, ciclo, RN-012); avisos com aceite e política;
  guarda de duplicidade; valor de abertura sem parcela com rateio e alocações; classificação e cobertura de categorias.
- Verificado em Node: exemplos (i) a (v) de 04, seção 5.2; CT-09, CT-10 e CT-18 da Fase 1; projeção = reconstrução
  depois de cada comando de todos os testes; o comando real entrou na varredura de quedas (três primitivas), que
  achou e fez corrigir dois defeitos do projetor (linha órfã da fase A virando EXTERNO; linha filha sem o evento).

## 14/11/2026 — Fase 1, operação do sistema (E1.10 e E1.11, backend)

- `FileService`: porta de arquivos sobre o Drive v3 (pastas `ERP Pecuário`, `Backups`, `Exportações`, `Anexos` e
  `Testes` reencontradas ou recriadas; planilha nova, cópia, lixeira, listagem filtrada e paginada; bytes por
  `alt=media`; texto em UTF-8/Latin-1/Windows-1252; sonda do escopo `drive.file`) e os comandos `anexo.adicionar`,
  `anexo.remover`, `anexo.obter` (data URL) e a promoção de anexo temporário.
- `Maintenance`: `setup()` idempotente com os 11 passos de 06, seção 4 (backup cru antes; forma de gravação escolhida
  pelo corpus numa planilha temporária; sementes por chave natural; SCHEMA_META; gatilhos; proteção de aviso;
  integridade); backup sob demanda e diário (banco parado: lock e recuperação antes da cópia); retenção 30 diários +
  12 mensais; restauração por comando com `recoverAll`; rotina diária (backup → exportações → anexos temporários e
  órfãos) e verificação semanal.
- `AuditService` (parte 2): verificação de integridade com 20 checagens, severidade e reparo oferecido (reconstruir,
  auditado); `auditoria.listar` paginado.
- `ImportService`: importação de ANIMAIS (criar com o original guardado e o hash; CSV e linhas coladas; mapeamento com
  confiança e padrões explícitos; validação em blocos com duplicidades no arquivo e na base e genealogia em duas
  passadas; pré-visualização; confirmação TOTAL ou PARCIAL_APROVADO registrada; lotes de chave determinística com
  ENTRADA_INICIAL pelas regras do formulário; conclusão com backup antes; desfazer; relatório final).
- `EventService`: `planejarEntradaImportada` (o mesmo planejamento da ENTRADA_INICIAL dentro do lote de importação,
  aceitando como mãe ou pai os animais ainda pendentes de lotes anteriores).
- Verificado em Node: CT-11 (setup repetido, desativação preservada, esquema da fase seguinte), escolha da primitiva
  com falha simulada, CT-12 nas partes da Fase 1 (erros, duplicatas, TOTAL recusado, PARCIAL aprovado, queda após o
  lote 1, recusa de outros lançamentos, retomar, concluir, desfazer), queda em cada fronteira do lote e da conclusão,
  ensaio completo de restauração, cada checagem de integridade disparada por adulteração à mão. A verificar na conta do
  dono: sonda real do Drive (SP-02), corpus real (SP-01), gatilhos reais (SP-09).

## 14/11/2026 — Fase 1, etapa API E PONTOS DE ENTRADA (E1.5 e parte da E1.12)

- `Api`: guarda de dono (com `ALLOW_EMPTY_ACTIVE_USER` e o reconhecimento de gatilho por `triggerUid`), roteador das 51
  rotas canônicas (as de fase futura respondem `NOT_FOUND` dizendo a fase), contexto por ambiente (produção, TESTE ou DEMO,
  nunca por ID vindo do cliente) com o fuso da planilha-banco, envelope copiado por JSON, carga inicial condicional pela
  versão dos dados, estado da operação, rascunho nas propriedades do usuário (SP-06) e includes por lista branca.
- `Code`: as oito funções públicas, cada uma começando pela guarda de dono.
- `TestRunner`: `runAcceptanceTests` (base de teste temporária pela Drive API, cenários da Fase 1 pela Api, retomável,
  relatório em JSON, isolamento da base real conferido), base de demonstração (304 ativos só por comandos, `TEST_PLAN =
  DEMO`), `runDiagnostics` (itens do spike, sem dado sensível) e a página de concorrência (CT-10, passo 6).
- `Maintenance`: setup e contexto por ambiente; a forma de gravação de um banco de teste fica em `IO_PRIMITIVE:<banco>`.
  `Database`: funções de diagnóstico (coerção Geral no formato do fixture, atomicidade do `batchUpdate`, fuso do V8).
- Verificado em Node: `tests/api.test.js`, `tests/acceptance.test.js` (os mesmos cenários do nível 2) e o teste estático
  ampliado. A verificar na conta do dono: `runDiagnostics`, `runAcceptanceTests` e a página de concorrência.

## 15/11/2026 — Fase 1, etapa INTERFACE — TELAS (E1.9 parte 2, E1.8 e E1.10 na tela)

- Telas: Visão geral (`dashboard.obter` e `alerta.listar`, com "dados de dd/mm hh:mm"), Rebanho (10 colunas da §5,
  busca, filtros, ordenação, paginação, seleção múltipla, CSV; "Como entrou?"; ficha A a J com linha do tempo, árvore
  genealógica, edição num formulário só e fotos/documentos), Pastos (lista, cadastro com posse e arrendador, painel),
  Eventos (histórico, detalhe, estorno e correção com simulação), Configurações (parâmetros, listas, categorias com
  cobertura, propriedades, parceiros, sistema e auditoria) e o assistente de importação de 5 telas.
- Servidor: rotas extras `importacao.modelo` e `sistema.diagnostico`; `Config.listar` traz os códigos de aviso.
- Componentes: correção de evento no `Registro`, `Cadastro` (envio com aceite de avisos), `Exportar` (CSV com
  saneamento), abas e indicadores; rota literal vale antes de rota com parâmetro; "+ Novo" parceiro pede o tipo.
- Verificado em Node (`npm test`) e em navegador com o backend do harness (`npm run ui:check`). A abertura dos
  arquivos baixados dentro do quadro do HtmlService no celular é item do spike (SP-07), a verificar na conta do dono.

## 15/11/2026 — Fase 1, REVISÃO ADVERSARIAL

- Jornada de ponta a ponta só pela `api()` (`tests/jornada.fase1.test.js`) e regras RN da Fase 1 sem teste próprio
  (`tests/regras.fase1.test.js`, com o mapa RN → teste).
- Backups: passam a levar `erp_ambiente`; a lista, a retenção, o último backup e o alerta BACKUP_ATRASADO enxergam os
  backups dos bancos anteriores do mesmo ambiente (antes, depois de uma restauração a lista ficava vazia e o alerta
  acendia); restaurar exige o motivo (a tela já exigia) e recusa backup de outra base (teste ou demonstração).
- Integridade: toda verificação completa atualiza `INTEGRIDADE:<banco>` (antes, só a semanal: depois de um reparo o
  alerta INTEGRIDADE_COM_ERRO ficava até uma semana aceso).
- Importação: progenitor sem brinco (animal de referência, ex.: touro de sêmen) é achado pelo nome ou pelo código
  interno, como pede a saída "cadastrar como animal de referência" do RN-094.
- Categorias: idade máxima < 1 mês e prioridade negativa são recusadas no servidor, como na tela. Formulários de pasto,
  propriedade e categoria recusam 0 onde o servidor exige "maior que 0" (`min_exclusivo`).
- Falhas tratadas que eram silenciosas (pastas do Drive ilegíveis, conferência de posições) vão para o log.

## 15/11/2026 — Fase 1, DOCUMENTAÇÃO DE ENTREGA (E1.12 e §20)

- `README.md` do projeto (o que é, estado, testes, implantação em resumo), `docs/GUIA_DE_IMPLANTACAO.md` (projeto Apps
  Script, envio por `npm run gas:push` ou cópia manual, os 31 arquivos um a um com conteúdo, dependências e onde
  inserir, `setup`, `runDiagnostics` com o que fazer em cada resultado, contingência do escopo do Drive, escolha
  automática da forma de gravação, `runAcceptanceTests` e página de concorrência, URL `/dev` e `/exec`, marco zero e
  importação, backup e restauração, o que nunca fazer na planilha) e `docs/RELATORIO_FASE1.md` (entregas E1.0 a E1.12
  com estado pela regra de honestidade, contagens reais dos testes, pendências na conta do dono, decisões, limitações).
- Checklist do plano (`10-plano-de-implementacao.md`, seção 8): E1.1 a E1.12 marcadas; E1.0 fica aberta até o dono
  rodar o diagnóstico. A Fase 1 não está fechada: diagnóstico e aceitação na conta do dono estão pendentes.
- `TestRunner`: dois textos do diagnóstico corrigidos — SP-05 não manda mais "rodar com linhas maiores" (a função do
  editor mede sempre 10 mil linhas) e SP-03 não atribui à página de concorrência a medida da liberação do lock na morte
  da execução.
- Verificado em Node: `npm test` (327 testes, 327 aprovados, 0 falhas) e `npm run ui:check` (29 testes de navegador,
  29 aprovados, 0 falhas). A verificar na conta do dono: tudo o que está na seção 3 do relatório.

## 15/11/2026 — Fase 2, etapa MOVIMENTOS E SAÍDAS (E2.1, E2.2 e E2.5)

- `EventCatalog.FASE_ATUAL = 2`. Entram no motor NASCIMENTO, TRANSFERENCIA, MORTE e DESCARTE, com campos, validação,
  efeitos, estorno, correção e testes. COMPRA, VENDA, IDENTIFICACAO, MARCACAO e os subtipos RECLASSIFICACAO e
  DIVERGENCIA_CONTAGEM continuam sem campos e, por isso, inativos (subtipo passou a exigir `campos_animal` para valer:
  antes bastava a fase, e o FASE_ATUAL = 2 teria ligado dois subtipos sem campos).
- NASCIMENTO: parto simples, gemelar e natimorto (crias como grupo repetível), peso ao nascer em PESAGENS, cria sem
  brinco, pai opcional (touro do rebanho ou externo), REPRODUCAO PARTO sempre, pasto da mãe no dia por padrão, raça da
  mãe por padrão; avisos IDADE_REPRODUTIVA e INTERVALO_PARTO_CURTO uma vez por parto; parto antes do marco zero como
  registro histórico (efeito 0, cria HISTORICO). Novo `ReproductionService` (partos, número de partos, histórico, bloco G).
- TRANSFERENCIA coletiva, tudo ou nada, com origem conferida pela linha do tempo na data, destino ativo e diferente,
  aviso de lotação e GTA opcional no payload. MORTE e DESCARTE com BAIXAS (causa e diagnóstico; motivo e destino),
  origem da saída tirada da linha do tempo (`Timeline.pastoAntesDaSaida`), MORTO terminal.
- `inventario.elegiveis` deixa de ser rota de fase futura: posição na data pela linha do tempo, usada pelo "Todos do
  pasto" do seletor quando a data do lançamento não é hoje.
- Ficha: bloco D com o evento que abriu e fechou cada período e os dias em cada pasto; bloco G com a parte de partos.
- Telas: formulários, revisão, resultado, correção e detalhe dos quatro tipos; atalhos "Registrar parto" e "Descartar".
- Base de demonstração: transferências no lugar das correções de localização, 12 partos, 1 morte e 1 descarte (314 ativos).
- Verificado em Node (`npm test`) e no navegador com o backend real (`npm run ui:check`); nada validado na conta do dono.
