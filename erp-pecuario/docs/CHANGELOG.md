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
- Verificado em Node (`npm test`: 399 testes, 399 aprovados) e no navegador com o backend real (`npm run ui:check`: 43
  testes, 43 aprovados): CT-04 e CT-14 com os números de 09, os exemplos de 07, seção 4.3, e os exemplos 4 e 5 de 03b,
  seção 4.4, o resultado por animal do caso de 07, seção 2.2, e as invariantes de 03b, seção 14, depois de cada comando.
  A varredura de quedas com a venda levou o `npm test` a cerca de 4,6 minutos neste ambiente. Nada validado na conta do
  dono.

## 15/11/2026 — Fase 2, etapa IDENTIFICAÇÃO, MARCAÇÃO, AJUSTES E ESTORNO GERAL (E2.6 e E2.7, backend)

- IDENTIFICACAO no motor (`EventCatalog`, `EventService`, `Timeline`): primeira identificação, troca (com motivo) e
  retirada (com motivo), coletivas, de brinco, chip, SISBOV, tatuagem ou outra (o brinco do vendedor só sai). Fato
  independente (o dia da saída conta). Cada animal ganha uma linha de IDENTIFICACOES; a projeção fecha o código anterior em
  `data_fim`; a linha da retirada guarda o código tirado e o motivo e fecha a si mesma. A ordem das identificações é
  conferida por tipo (`Timeline.validarIdentificacoes`): primeira só sem código em uso, troca e retirada só com. O bloqueio
  de reuso de brinco aposentado (RN-004), que já existia, ficou alcançável e testado, com a exceção do brinco lançado
  errado (desenho-base 16.2) e a troca de números entre dois animais no mesmo lançamento (recusada com o reuso desligado).
- MARCACAO: marcar e desmarcar "para descarte" (motivo no payload) e "não localizado"; não mexe no inventário; marcar o
  marcado e desmarcar o desmarcado são recusados (`Timeline.validarMarcacoes`); alerta NAO_LOCALIZADO em `alerta.listar`.
- AJUSTE_INVENTARIO: RECLASSIFICACAO (categoria manual ativa e do sexo do animal, ou volta à automática; AJUSTES com o
  valor que valia antes) — a regra CATEGORIA_EM_USO de `categoria.salvar` ficou testável e testada — e DIVERGENCIA_CONTAGEM
  (baixa com BAIXAS, sem AJUSTES; BAIXADO_AJUSTE fora do inventário e dos elegíveis, mas dono do brinco; reaparecimento =
  estorno; reentrada por outra entrada ou compra).
- Estorno e correção de qualquer evento (E2.7): o mecanismo é o mesmo para todos os tipos e subtipos ativos, provado por um
  caso de cada; estorno e correção revalidam também as sequências de identificação e de marcação e o que a anulação
  devolve ao animal (brinco que hoje é de outro, sexo ou nascimento que não cabem com os filhos — RN-012 —, categoria
  manual desativada): CONFLICT com o evento que impede. Tipo com subtipos exige o subtipo. Identificações e
  reclassificações seguem a posição na cadeia de substituição (desenho-base 16.1).
- Consultas: `evento.listar` com filtro de subtipo e, no histórico do animal, os estornos dos eventos dele; rótulo do
  subtipo na lista e no detalhe. `auditoria.listar` passou a ser a trilha completa (EVENTOS + AJUSTES + AUDITORIA, 03a,
  seção 5.2), com filtros por entidade, registro, período (data na fazenda ou instante) e operação; a tela de auditoria
  usa a chave nova de cada item. A verificação de integridade confere a ordem das identificações e das marcações.
- Cenários: CT-07, CT-08, CT-09 completo pela `api()` (o brinco do vendido, a identificação do morto) e na aceitação de
  nível 2, CT-17 (b) com a identificação e CT-18 da Fase 2 (compra com a identificação e a transferência). Varredura de
  quedas com o estorno de transferência como comando-modelo (09, seção 8).
- Verificado em Node (`npm test`: 439 testes, 439 aprovados, cerca de 5 minutos neste ambiente) e no navegador com o
  backend real (`npm run ui:check`: 43 testes, 43 aprovados; o seletor de tipos ganhou o grupo Manejo). Os formulários
  próprios de identificação e marcação (o campo de cabeçalho do subtipo, o modo curral) e a tela de auditoria com a trilha
  completa ficam para a etapa de telas. Nada validado na conta do dono.

## 15/11/2026 — Fase 2, etapa ATAQUE AO MOTOR E AO FINANCEIRO

Etapa adversária sobre o que as anteriores escreveram (nascimento, transferência, morte, descarte, compra, venda,
identificação, marcação, ajustes, estorno e substituição, `FinancialService`). Três oráculos escritos à parte, sem usar
`Timeline` nem `FinancialService` (`tests/apoio-oraculos.js` e o modelo de `tests/fase2.adversarial.test.js`): um modelo de
referência do rebanho que prevê, para cada comando, aceito, VALIDATION ou CONFLICT e QUAIS eventos impedem; um replay das
linhas cruas da planilha (vigência P3 reescrita) que dá o inventário em cada data, por pasto, e a situação de cada animal;
e as invariantes de 03b, seção 14, conferidas de novo sobre as linhas cruas. Defeitos achados e corrigidos, cada um com o
teste que falhava antes:

- `inventario.elegiveis` (InventoryService): para parto, identificação e marcação (fatos), o animal que saiu do rebanho no
  dia D não era elegível em D, embora o servidor aceite o fato no dia da saída (RN-017; a vaca que morre no parto, o brinco
  do vendido). Agora fato = no rebanho em algum momento de D, no pasto de antes das saídas do dia (`presentesNoDia`);
  movimento e saída continuam pelo fim do dia.
- Correção de uma correção de localização (EventService): a origem vinha do fim do dia, não da posição do lançamento; o
  substituto, que fica no lugar do original (desenho-base 16.1), antes de uma transferência posterior do mesmo dia, era
  recusado com uma mensagem sem sentido ("parte do pasto C, mas estaria no A"), mesmo sem mudar nada. Agora a origem é a da
  posição (`pastoNaPosicao_`); no dia de uma venda, a correção de localização dá CONFLICT com a venda, não "fora do rebanho".
- Consultas que reproduzem a linha do tempo sem acesso cru (`inventario.posicao`, `inventario.elegiveis`,
  `dashboard.obter`, `alerta.listar`, `pasto.painel`, `pasto.listar`, `animal.listar` e a carga inicial do
  `sistema.bootstrap`): o evento anulado não aparece e a cadeia de substituição parava no substituto, que caía no fim do
  dia — com duas movimentações do mesmo animal no mesmo dia e a primeira corrigida, o painel e a posição mostravam o pasto
  errado. Todas declaram `acessoCru`; `Timeline.fonte` sem acesso cru lança `INTERNAL` ao achar um substituto, em vez de
  errar em silêncio.
- Mensagens ao pecuarista (EventCatalog, FinancialService, EventService): números do servidor com ponto decimal ("a
  partir de 0.0001", "999.6 kg") e "aceita no máximo 4 casa decimal" — agora no formato brasileiro (`Utils.formatarNumero`,
  novo) e no plural; base zero ou com casas demais num rateio manual dava dois erros (um no campo errado, o valor da
  compra); agora um erro, no campo do animal; rendimento de carcaça que arredonda para 100% ou 0% era chamado de "carcaça
  maior que o vivo" (falso); `VALOR_DIVERGENTE` no limite dizia "difere em 1%, acima da tolerância de 1%" — agora "mais de 1%".

Testes novos: `tests/fase2.adversarial.test.js` (sequências aleatórias com três sementes fixas e casos dirigidos: fato no dia
da saída, mesmo dia com as classes 0, 1 e 2, substituição em cadeia, estorno de compra com venda posterior, gêmeos com
natimorto, correção de localização, centavos patológicos, arroba e carcaça com arredondamento, parcelas que diferem de 1
centavo, reenvio com a mesma chave); em `tests/unitofwork.adversarial.test.js`, os oráculos independentes no desfecho dos
três comandos-modelo da Fase 2 e os subconjuntos densos das pendentes antes de cada flush (SpreadsheetApp); em
`tests/utils.test.js`, `formatarNumero`.
- Verificado em Node (`npm test`: 452 testes, 452 aprovados, cerca de 6 minutos neste ambiente; o arquivo novo leva cerca de
  40 s) e no navegador com o backend real (`npm run ui:check`: 43 testes, 43 aprovados). Fora da suíte, a mesma geração
  aleatória rodou com mais 26 sementes de 220 passos sem divergência entre modelo e sistema. Nada validado na conta do dono.

## 15/11/2026 — Fase 2, etapa ANEXOS DE EVENTO (E2.9)

- Anexos de evento (FileService, `anexo.*`): nota fiscal, GTA, laudo (DOCUMENTO, rótulo "Documento ou laudo") e foto de
  qualquer evento que vale, ligados ao `event_id` (03a, seção 5.1); nova entidade FINANCEIRO para o arquivo de um
  lançamento financeiro do evento (boleto do frete, romaneio na receita, recibo da comissão), com o `event_id` do evento
  que o criou. A linha é filha do evento (vale enquanto ele vale) e, com o evento estornado ou corrigido, continua
  consultável como histórico (`vigente = false` em `anexo.obter` e `evento.obter`); o evento anulado não recebe nem perde
  arquivo (`JA_ANULADO`); o ESTORNO não recebe (`ESTORNO_SEM_ANEXO`). Linha inerte de gravação que falhou não aparece.
- `evento.obter` devolve `anexos` (do evento e dos lançamentos dele, com `financial_id`).
- Correção de evento (EventService): os anexos ativos do original passam ao substituto na mesma operação (linhas filhas
  dele, mesmo arquivo do Drive); o de lançamento vai para o lançamento correspondente pelo papel (frete → frete, comissão
  → comissão, outros custos → outros custos) ou, sem par, para o evento; a simulação mostra quantos (`impactos.anexos`).
- Remoção (`anexo.remover`): justificativa obrigatória no servidor (antes só na tela); o arquivo só vai para a lixeira se
  nenhuma outra linha consultável o usa (o histórico do evento corrigido). A limpeza diária (Maintenance) também ignora a
  linha inerte de uma gravação que não confirmou ao decidir se um arquivo ainda está em uso.
- Tipos de arquivo: o servidor passa a aceitar só imagem (JPEG, PNG, WEBP, GIF) e PDF em anexo de animal, evento e
  lançamento (antes, qualquer tipo com formato válido), e FOTO só imagem (`TIPO_ARQUIVO_INVALIDO`); o aparelho recusa outro
  tipo antes de enviar. Limite de 5 MB como antes.
- Interface: componente `Anexos` (Components) usado pela ficha do animal (bloco J, sem mudança de comportamento) e pela
  nova seção "Documentos e fotos" do detalhe do evento (anexar ao lançamento todo ou a um lançamento financeiro, abrir,
  remover com justificativa; no anulado, só o histórico); cada lançamento financeiro mostra os seus arquivos.

Testes novos: `tests/anexos.test.js` (compra, venda, transferência, morte; estorno com e sem dependente; correção de compra,
venda e morte, retroativa e em cadeia; limites e tipos; queda na fase A da correção; rotas pela `api()`) e
`tests/ui/anexos.test.js` (detalhe da compra a 360 px).
- Verificado em Node (`npm test`: 475 testes, 475 aprovados, com os da etapa de inventário que corria em paralelo) e no
  navegador com o backend real (`npm run ui:check`: 48 testes, 48 aprovados). Nada validado na conta do dono nem no Drive
  real (o fake do Drive reproduz as hipóteses de `CONTRATOS.md`, seção 6.5).

## 15/11/2026 — Fase 2, etapa INVENTÁRIO HISTÓRICO E LOTAÇÃO (E2.8)

- `Timeline`: situação do animal na data (`situacaoEm`: ATIVO, VENDIDO, MORTO, DESCARTADO, BAIXADO_AJUSTE ou "ainda não
  entrou", com o pasto e o "desde quando"), estadas por pasto (`estadas`, a regra única do bloco D da ficha, do "desde
  quando" e dos dias de permanência), presentes em D (`presentesEm`), inventário com a contagem por situação e os dias de
  permanência num período por rebanho, pasto, lista ou categoria (`diasPermanencia`, 05, seção 4.6: a base do rateio
  DIAS_PERMANENCIA da Fase 4), conferidos com os exemplos dos documentos (base 57 e 65, com o rateio pelo maior resto).
- `inventario.posicao`: filtros de propriedade, pasto, sexo e categoria (por sexo, por pasto e por categoria ignoram o
  próprio filtro, com etiqueta), peso médio e situação na data; com `animal_id`, a situação, o pasto, o "desde quando", a
  categoria, a idade e o peso vigente do animal naquele dia.
- `pasto.painel`: peso médio, "acima da capacidade" em UA/ha e em cabeças, o "desde quando" de cada animal e, com um
  período, os dias de permanência de cada animal no pasto.
- `dashboard.obter`: período (padrão dos últimos 12 meses; Df antes do marco zero devolve null com o motivo), filtros, a
  posição em Df, o movimento do período (nascimentos, compras e vendas com valor, mortes, descartes, baixas na contagem),
  a receita de vendas por competência (com filtro de animal, só a parte alocada) e as séries mensais (evolução do
  rebanho, nascimentos e mortes, compras e vendas).
- Aviso LOTACAO_ACIMA_DA_CAPACIDADE também em UA/ha (RN-027), com a UA das consultas e o peso do próprio lançamento; um
  aviso por pasto. Os testes de pastos que montavam um pasto acima da capacidade em UA/ha passaram a aceitar o aviso.
- Interface: Início com o período, o peso médio, o movimento e os gráficos mensais; painel do pasto com o peso médio, a
  coluna "No pasto desde" e os dias de permanência num período.

Testes novos: `tests/lotacao.test.js` e `tests/ui/lotacao.test.js`.

## 15/11/2026 — Fase 2, etapa VERIFICAÇÃO DE INTEGRIDADE COMPLETA (E2.11)

- `AuditService`: 25 checagens (eram 20). Novas: `BAIXADO_SEM_POSTERIOR` (evento vigente depois da saída do rebanho, até a
  volta; depois da morte, qualquer um; também o detalhe de identificação, pesagem ou reprodução que cita o animal fora do
  rebanho), `PARTOS` (NASCIMENTO × REPRODUCAO PARTO × crias: uma mãe fêmea nascida antes do parto, um registro de parto
  na mãe com a data e os nascidos vivos certos, cada cria com a mãe, o pai, a data e a origem do parto; parto fora de um
  nascimento), `IDENTIFICACOES_ATIVAS` (nenhum brinco ativo repetido nas identificações), `FINANCEIRO` e `CUSTO_AQUISICAO`
  (reparo: reconstruir).
- As invariantes de 03b, seção 14, vêm agora da conferência do próprio `FinancialService.conferir` (a integridade não
  reescreve a regra): cada invariante na sua checagem (`ALOCACOES`, `PARCELAS`, `FINANCEIRO`, `ALOCACAO_DIRETA`,
  `CUSTO_AQUISICAO`), sem contar duas vezes a divergência que a reconstrução também vê.
- `FinancialService`: o 100% alocado vale também no custo da morte e na receita do descarte (o rateio CABECAS que o
  próprio evento grava; 03b, seção 10.3); a soma das parcelas ignora a parcela CANCELADA (desenho-base 16.11); mensagens
  das invariantes 3, 8 e 10 na linguagem do pecuarista (o evento pelo nome e data, os valores alocados).
- O relatório traz `duracao_ms` (leitura, recuperação e conferência); a tela de sistema mostra o tempo da verificação.
- A reconstrução cobre cada campo de projeção do esquema (teste que adultera um por um), menos `PRODUTOS.estoque_atual`
  (Fase 3) e `EVENTOS.confirmed_at` (instante da fase C).
- Tempo medido no fake, base de demonstração (317 animais, 34 eventos, 367 linhas de EVENTO_ANIMAIS, 380 alocações):
  cerca de 55 ms por verificação completa pela `api()` (só CPU do Node; a leitura real das abas no Sheets fica para o
  diagnóstico na conta do dono).

Testes novos: `tests/integrity.fase2.test.js`.
- Verificado em Node (`npm test`: 498 testes, 498 aprovados, com os da etapa de importadores que corria em paralelo) e no
  navegador (`npm run ui:check`: 48 testes, 48 aprovados).
  Nada validado na conta do dono: o tempo real da verificação no Sheets aparece em `duracao_ms` na tela de sistema.

## 15/11/2026 — Fase 2, etapa IMPORTADORES DE EVENTOS HISTÓRICOS (E2.10)

- `ImportService`: importação de COMPRAS, VENDAS, TRANSFERENCIAS, NASCIMENTOS e MORTES nos 10 passos da §14, com modelo
  de colunas por tipo (`importacao.modelo` com `tipo`), mapeamento com obrigatórios e valores padrão, agrupamento das
  linhas num evento (número do lançamento explícito; sem ele, a chave natural do tipo), referência ao animal pelo brinco
  ou pelo código interno, ordem cronológica e lotes de eventos inteiros com a chave `imp:<import_id>:<n>`. Cada evento
  passa pelo planejamento do formulário (`EventService.planejarEventoImportado`; RN-090) num ensaio em memória em que os
  eventos anteriores do arquivo (e os lotes já gravados) valem: a validação e cada lote enxergam as dependências (a
  segunda transferência parte do destino da primeira) sem gravar nada fora do plano. Duplicidade no arquivo e na base,
  `DEPENDE_DE_LINHA_IGNORADA` ao deixar de fora um lançamento de que outro depende, desfazer bloqueado por registro de
  fora que dependa dos eventos importados.
- Relatório de reconciliação (RN-095; 04, seção 6): posição no marco zero recalculada pelo histórico × declarada na
  fotografia, divergências por animal (saída antiga de animal que está no marco zero, pasto diferente, animal do histórico
  fora do marco zero) e por pasto, brincos citados em evento sem animal, cada um com a explicação e o que fazer; no
  relatório final de toda importação e na rota extra `importacao.reconciliacao`. Não bloqueia nada.
- `EventService`: data anterior ao marco zero em COMPRA, VENDA, TRANSFERENCIA e MORTE entra pela importação (e na correção
  de um registro já histórico) como registro informativo: `pre_marco_zero`, efeito 0, sem lotação, financeiro do próprio
  evento sem caixa (sem parcela: o pagamento é anterior ao controle; parcela informada → `PARCELA_ANTES_DO_MARCO_ZERO`).
  No formulário, como antes, só o parto aceita data antiga. `FinancialService`: a quantidade de animais da compra e da
  venda histórica confere com as linhas de efeito 0.
- Interface: a importação escolhe o tipo, baixa o modelo dele, mapeia as colunas do tipo (confianças e valores padrão do
  modelo) e o relatório final mostra a reconciliação.
- Testes: `tests/import.eventos.test.js` (os cinco tipos, histórico, financeiro, lotes, estorno e correção com dependente e
  retroativo, desfazer, reconciliação, recusas, rotas; integridade limpa e projeção = reconstrução depois de cada comando);
  `tests/unitofwork.adversarial.test.js` ganhou a varredura de quedas do lote de importação (animais e compras) nas três
  primitivas, com o invariante (2) aceitando o animal PENDENTE do lote confirmado; `tests/ui/importacao.test.js` (importação
  de transferências na tela, a 1280 e a 360 px, com a reconciliação no relatório final).


## 15/11/2026 — Fase 2, etapa INTERFACE DOS EVENTOS (E2.1 a E2.7 na tela)

- Registrar evento, para todo tipo e subtipo ativo do catálogo: o subtipo é o primeiro campo, com a pergunta do tipo ("O que
  fazer", "Marcar como", "O que corrigir"); os campos de cabeçalho do subtipo (o motivo do descarte na marcação) passaram a
  ser desenhados e enviados (antes ficavam de fora e o motivo nunca chegava ao servidor); o brinco do vendedor só aparece na
  retirada; a baixa por divergência é operação crítica (subtipo `critico: true` no catálogo: botão de perigo e tela de
  resultado); verbos e resultados próprios da identificação, da marcação, da reclassificação e da baixa.
- Grade de animais novos (compra e entradas): "Preencher em série" (N animais com brincos em sequência e os dados do lote) e
  "Colar da planilha" (Brinco · Sexo · Idade ou nascimento · Peso · Valor, com os problemas pelo número da linha). Parcelas:
  "Dividir em parcelas" (N vencimentos, todo mês ou a cada 30, 15 ou 7 dias) com o valor em branco — o servidor divide e a
  revisão mostra.
- Revisão: o valor de cada animal calculado pelo servidor ("Ver os animais"), o que muda em cada animal nos tipos com subtipo
  e, no estorno, o financeiro que deixa de valer (`impactos.cancelados`, novo na simulação do estorno). Problema de
  CONFLICT traz o link para o lançamento que impede.
- Detalhe e histórico: "Corrigir" para todo tipo e subtipo (identificação, marcação e os cinco ajustes passaram a ter o
  pré-preenchimento da correção; a correção de cadastro compara um item por campo), seções de marcação, identificação
  (retirada), correções com os valores em palavras, motivo do ajuste, a baixa por divergência e, em cada lançamento
  financeiro, as alocações por animal. Tela de auditoria com a trilha completa: filtros por o que mudou (inclui
  lançamentos) e o que foi feito, período pela data na fazenda, o lançamento com link e o motivo.
- Ficha: atalhos à vista (Transferir, Vender, Registrar morte, Registrar parto) e "Mais registros" (descarte, pôr, trocar e
  tirar brinco, marcar e desmarcar descarte e não localizado, mudar a categoria, não encontrado na contagem, corrigir brinco
  e pasto). Painel do pasto: "Vender daqui", como o "Transferir daqui".
- Defeito corrigido no motor: a baixa por divergência de contagem com observação do animal perdia a justificativa do
  lançamento (não há linha de AJUSTES nesse subtipo); agora fica em `payload_json.motivo_ajuste` e aparece na trilha.
- Página: o doGet entrega cada include compactado (`Api.compactar`: sem recuo, linhas vazias e linhas só de comentário). Com
  as telas desta etapa o fonte passou de 470 KB; a página montada ficou em cerca de 411 KB (antes, 441 KB). O `ui:check`
  mede o orçamento no que vai ao aparelho e continua procurando recurso externo no fonte inteiro; `tests/interface.test.js`
  confere que os includes não têm o que a compactação quebraria (template literal, linha que continua).
- Testes novos: `tests/telas.fase2.test.js` e `tests/ui/eventos.fase2.test.js` (CT-03 e CT-04 inteiros pela tela, a 1280 e a
  360 px, colar da planilha, estorno com dependente e auditoria, manejo pela ficha com as correções); apoio
  `tests/apoio-telas.js` (cliente e Store mínimo, antes dentro de `tests/telas.test.js`).
- Verificado em Node (`npm test`: 504 testes, 504 aprovados, 0 falhas, cerca de 6,4 minutos neste ambiente) e no navegador
  com o backend real (`npm run ui:check`: 59 testes, 59 aprovados, 0 falhas; página montada com 411 KB de 450 KB). O modo
  curral (identificação no brete) chega com a pesagem, na Fase 3 (E3.1); nesta fase a identificação usa o seletor e o
  cartão de cada animal. Nada validado na conta do dono.
