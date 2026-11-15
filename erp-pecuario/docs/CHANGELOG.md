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

## 15/11/2026 — Fase 2, etapa FINANCEIRO DO EVENTO E COMPRA (E2.3)

- `FinancialService` (novo, puro): lançamento completo no plano do evento (FINANCEIRO, PARCELAS, RATEIOS e
  ALOCACOES_FINANCEIRAS), parcelas que somam o valor (valor vazio = divisão igual do que falta), rateio pelo maior resto
  com os critérios do dicionário (DIRETO com um animal), a conta da negociação por modalidade × base de peso
  (conferência com tolerância, arrobas, rendimento apurado, critério e bases), a conferência das 20 invariantes de 03b,
  seção 14 (exportada para a etapa de integridade), os totais a pagar e a receber e o bloco H da ficha.
- COMPRA no motor (`EventCatalog`, `EventService`): fornecedor, finalidade, modalidade, base de peso, rendimento, preço,
  peso do lote, valor da nota, critério (só no lote), pasto do lote; grade de animais novos (brinco da fazenda e do
  vendedor, sexo, raça, nascimento ou idade, peso, carcaça, valor individual, peso no rateio manual) ou que voltam ao
  rebanho; parcelas do valor dos animais e frete e outros custos, um lançamento por item com parceiro e vencimento
  próprios, todos 100% rateados; COMPRAS, PESAGENS (COMPRA), IDENTIFICACOES (BRINCO e BRINCO_ORIGEM); custo de
  aquisição só pelas alocações. Estorno com CONFLICT se um animal comprado tem evento posterior; correção com os mesmos
  animal_id; lançamentos do original cancelados pela vigência (parcelas não regravadas, desenho-base 16.11).
- MORTE e DESCARTE: custos associados (conta de custeio escolhida) e receita simples (outras receitas operacionais), com
  um título e rateio por cabeça, estorno e correção.
- Parceiros: inativo é recusado como contraparte nova de evento (aceito na correção do evento que já o usava).
  Plano de contas no bootstrap; `ref:PLANO_CONTAS` com `naturezas` no catálogo. Visão geral com os títulos a pagar e a
  receber. `AuditService` (BASE_RATEIO): DIRETO confere a base pelo valor do lançamento.
- Telas: formulário da compra (grade, parcelas, frete), revisão pelo servidor com a negociação e o valor por animal,
  correção e detalhe da compra (negociação, lançamentos, títulos e rateio), custo e receita na morte e no descarte,
  aba Financeiro da ficha (custo de aquisição e lançamentos do animal).
- Base de demonstração: as 8 entradas ao longo dos três anos passam a ser compras (valor por animal, frete e duas
  parcelas). Correção de compra entra como modelo na varredura de quedas (`tests/unitofwork.adversarial.test.js`).
- Verificado em Node (`npm test`: 379 testes, 379 aprovados) e no navegador com o backend real (`npm run ui:check`: 40
  testes, 40 aprovados): CT-03 completo, CT-13 na parte da compra, o exemplo de 03b, seção 15.1, linha a linha, as
  invariantes de 03b, seção 14, depois de cada comando de todos os testes do motor. A varredura de quedas com a correção
  de compra levou o `npm test` a cerca de 3 minutos. Nada validado na conta do dono.

## 15/11/2026 — Fase 2, etapa VENDA (E2.4)

- VENDA no motor (`EventCatalog`, `EventService`), com o financeiro do próprio evento (P11): comprador, finalidade,
  pasto de onde o lote sai (opcional, conferido animal a animal), modalidade × base de peso (cabeça, kg vivo, arroba de
  peso vivo com rendimento negociado ou estimado — padrão `rendimento_carcaca_padrao_pct` —, arroba de carcaça pelo
  romaneio de cada animal ou só pelo total, lote fechado), valor bruto da nota (a conta pelo preço é conferência),
  desconto comercial, parcelas do recebimento e deduções (frete, comissão, taxas e retenções; uma despesa de venda por
  item, na conta do tipo, com parceiro e título próprios; a retida pelo comprador nasce com `retida_pelo_comprador` = S e
  vence num recebimento da venda, para o encontro de contas da Fase 4). Receita e deduções 100% rateadas pelo mesmo
  critério; sem o peso de cada animal, a última pesagem escalada para o lote (estimada, registrada no rateio) ou por
  cabeça, com aviso. Saída (−1) com a origem pela linha do tempo, VENDIDO com o histórico preservado, PESAGENS (VENDA) só
  com peso vivo individual, carcaça nunca vira pesagem, VENDAS com os totais, `payload_json.deducoes` com o tipo.
- Carência (RN-072): `HealthService` (novo, puro) calcula o fim da carência das aplicações de SANIDADE; a venda avisa por
  animal (CARENCIA_ATIVA) e, na finalidade ABATE, segue a política (padrão: bloqueia); nas demais é sempre aviso.
- Estorno e correção da venda: o animal volta à posição certa da linha do tempo; recompra posterior, correção de data para
  depois dela ou tirar da venda um animal recomprado → CONFLICT com o evento; lançamentos cancelados pela vigência.
  A origem de saída que o servidor tira da linha do tempo não vira erro próprio (o problema mostrado é o registro que a
  quebrou). `FinancialService`: contas das deduções, totais da venda, negociação com romaneio total, bruto como conferência
  e base estimada; invariantes 15 e 16 da venda completas (por conta, valor do evento, quantidade).
- Aceitação de nível 2: o CT-09 roda inteiro (venda de animal vendido, transferência de animal morto, compra de animal
  vendido antes e depois da saída). Varredura de quedas com a venda do CT-04 como modelo (9 abas). Base de demonstração:
  venda de 6 garrotes por kg vivo, com comissão, ao comprador `seed:comprador` (308 ativos).
- Telas: formulário da venda (atalho "Vender" da ficha), revisão pelo servidor com bruto, deduções, resultado da negociação,
  depósito esperado, preços médios e arrobas sempre com a base; correção pelo detalhe (os animais baixados são carregados
  antes; os do original não aparecem como inelegíveis); detalhe com a seção "Venda"; a diferença da correção ignora campo
  oculto e formata o dinheiro.
- Verificado em Node (`npm test`) e no navegador com o backend real (`npm run ui:check`): CT-04 e CT-14 com os números de
  09, os exemplos de 07, seção 4.3, e os exemplos 4 e 5 de 03b, seção 4.4, o resultado por animal do caso de 07, seção 2.2,
  e as invariantes de 03b, seção 14, depois de cada comando. Nada validado na conta do dono.
