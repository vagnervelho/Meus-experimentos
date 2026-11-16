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

## 15/11/2026 — Fase 2, etapa INTERFACE DE PASTOS, IMPORTAÇÃO E ANEXOS (E2.8 a E2.10 na tela)

- Pastos: a lista ganhou a "Posição em [data]" (do marco zero a hoje): numa data passada, `pasto.listar` com a data
  (novo parâmetro, a mesma regra do painel: replay das linhas que valem hoje; antes do marco zero, os nulos com o motivo;
  data futura ou inválida recusada) devolve todos os pastos naquele dia. Cartões com cabeças, UA, UA/ha, ocupação e a
  marca "acima da capacidade". A data escolhida vale também para o painel (memória da tela, nunca na rota). Indicador sem
  valor aparece como "Sem dado" e o motivo em palavras: sem área, sem capacidade informada (nunca deduzida da área),
  nenhum animal com peso, pasto vazio, data anterior ao marco zero; o painel sugere informar área e capacidade.
- Importação: o título acompanha o tipo; "Como o sistema entendeu" mostra cada campo do modelo do tipo em palavras e as
  linhas do mesmo lançamento (`importacao.linhas` passou a devolver `lancamento`, pela chave de agrupamento da
  validação). "Deixar de fora" em linha válida (a pendência `ignorar_linhas` da Fase 1, que o servidor aceitava e a tela
  não oferecia): marca o lançamento inteiro, resume as linhas escolhidas e leva à confirmação parcial com os números
  certos (`TelaImportacao.planoConfirmacao`). Reconciliação com o marco zero em tabela (o que diz a fotografia, o que diz
  o histórico, o que fazer, o registro que explica, com links), no relatório final e, sem gravar, na lista de importações.
- Anexos no formulário de evento (08, seção 4.3): "Documentos e fotos" depois das observações, em todo tipo menos o
  estorno; nota fiscal na compra e na venda, GTA na transferência como tipo sugerido (também no detalhe). Os arquivos ficam
  na memória do formulário e vão por `anexo.adicionar` ao lançamento gravado, um por um, com a chave de cada arquivo; a
  tela de resultado mostra o estado de cada envio e "Tentar de novo" sem duplicar.
- Testes novos: `tests/telas.pastos-importacao.test.js` e `tests/ui/pastos-importacao.test.js` (a 1280 e a 360 px).
- Verificado em Node (`npm test`: 508 testes, 508 aprovados, 0 falhas) e no navegador com o backend real (`npm run
  ui:check`: 65 testes, 65 aprovados, 0 falhas; página montada com 427 KB de 450 KB). Nada validado na conta do dono.

## 15/11/2026 — Fase 2, etapa ACEITAÇÃO (nível 2 e jornada)

- `runAcceptanceTests` (plano ACEITACAO) ganhou os cenários da Fase 2, pela `Api` na base de teste temporária, retomáveis
  e no relatório JSON: CT-01, CT-02, CT-03, CT-04, CT-07, CT-08, CT-13 (na compra), CT-14, CT-17 e CT-18 (compra com
  identificação e transferência, mais a variante da Fase 1). Cada cenário usa os seus pastos e parceiros (contagem por pasto
  exata na base compartilhada), as datas do 09 contadas do marco zero, e termina com a verificação de integridade sem erro
  (projeção = reconstrução e invariantes do financeiro). O CT-12 passou a conferir a reconciliação (transferência histórica
  que diverge da fotografia e brinco sem animal, sem bloquear). Ficam `NAO_SE_APLICA`, com o motivo, só o resultado gerencial
  (CT-03, Fase 4), o rateio por evento RATEIO (CT-13 c a f, Fase 4) e a pesagem (CT-10 passo 3, Fase 3).
- Base de demonstração completa (09, seções 7 e 8): 240 em D0, 255 nascidos vivos (gêmeos e natimortos), 70 comprados, 240
  vendidos (por cabeça, kg vivo, arroba de carcaça e arroba de peso vivo estimada), 15 mortes, 5 descartes, 1 baixa na
  contagem, transferências, campanhas de identificação e uma troca de brinco, correções e estornos → 304 ativos. Semente
  fixa, só por comandos, sem nenhuma recusa (o gerador simula o rebanho dia a dia); um passo por comando com chave
  `seed:<n>` (retomável; reexecutar não grava de novo); conferência final pelo inventário, pelas saídas no cadastro e pela
  integridade. O relatório lista o que da seção 7 chega nas fases 3 e 4.
- `tests/jornada.fase2.test.js`: um ano de manejo só pela `api()`, a partir do rebanho importado, com o inventário em 11
  datas contra um modelo independente, a pagar e a receber, ficha, trilha e integridade; projeção = reconstrução e
  invariantes depois de cada comando.
- `tests/regras.fase2.test.js`: o mapa RN → teste verificável (toda RN de 05 na Fase 2 com os testes que a exercitam, no
  mapa da Fase 1 ou nas fases seguintes com o motivo; cada teste citado existe) e os testes das RN 006, 037, 049, 065, 071,
  075 e 094 (importação de nascimentos).
- Correções que os testes novos acharam: valor zero, negativo ou com fração de centavo dava até três erros iguais no mesmo
  campo (catálogo, lançamento e parcela), em português quebrado ("O valor de a compra"); agora um erro só, e o lançamento não
  segue para parcelas e rateio (`FinancialService.planejar`). Sem parcela, "Informe como a compra será paga". O desconto da
  venda não é mais acusado quando o bruto já foi recusado. O erro de campo de um animal já cadastrado (peso da venda,
  carcaça, campos da transferência, da saída, da identificação...) passou a trazer `animal_id` e brinco, e a carcaça recusada
  não leva mais o erro do "rendimento de 0%" no cabeçalho (`EventService`).
- Guia de implantação: os cenários das Fases 1 e 2 e a base de demonstração em várias execuções.
- Testes novos: `tests/jornada.fase2.test.js` e `tests/regras.fase2.test.js`; ampliados `tests/acceptance.test.js` (cenários da
  Fase 2, projeção = reconstrução na base de teste, conta errada do servidor que derruba os cenários, demonstração completa
  e retomável) e `tests/integrity.fase2.test.js` (integridade sobre a demonstração de 304 ativos).
- Verificado em Node (`npm test`: 518 testes, 518 aprovados, 0 falhas, cerca de 7,8 minutos neste ambiente) e no navegador
  com o backend real (`npm run ui:check`: 65 testes, 65 aprovados, 0 falhas; página montada com 427 KB de 450 KB). Os
  cenários de nível 2 e a base de demonstração rodaram aqui sobre os fakes do harness; na conta do dono continuam
  pendentes. Nada validado na conta do dono.

## 15/11/2026 — Fase 2, conserto da revisão independente (rodada 1)

Cada achado confirmado virou primeiro um teste que falhava (`tests/revisao1.motor.test.js`,
`tests/revisao1.financeiro.test.js`, `tests/ui/revisao1.test.js`, conferidos contra o código de antes do conserto) e
depois o conserto da causa.

- Motor: correção de cadastro ou de brinco depois do marco zero não transforma mais o animal do histórico em ANULADO
  (só linha de inventário decide as ordens 2 e 3 de 03a, 4.3.4); registro anterior ao marco zero se confere com a
  chegada declarada (`Timeline.chegadaDeclarada`), não com a volta mais recente, no comando, na integridade e no
  desfazer da importação, e a chegada declarada se corrige depois de uma volta; o número de partos conta da primeira
  entrada; corrigir só o texto ou o valor de uma volta ou de uma recompra não esbarra mais na morte ou venda posterior
  (a linha do tempo final decide); corrigir só o motivo de uma retirada de brinco não "devolve" o número que foi para
  outro animal (e a retirada levada para depois disso é recusada); mãe de parto só de natimorto não deixa de ser fêmea
  (`SEXO_DA_MATRIZ`, `PARTO_DA_MATRIZ`).
- Importação: uma importação em curso por vez (`IMPORTACAO_EM_CURSO`); gêmeos de linha idêntica em NASCIMENTOS não são
  mais "linha repetida"; o desfazer fica bloqueado enquanto valer a correção de um evento importado; a reconciliação
  ordena o histórico pela ordem canônica; os motivos do bloqueio citam o lançamento em palavras.
- Financeiro: o bloco H da ficha soma numa base só (a passagem atual); `EVENTOS.total_value` de todo tipo é conferido
  contra os lançamentos; o estorno bloqueado por valor alocado aponta o evento dono, uma vez só, sem mandar refazer um
  rateio que não existe; frete e outros custos da compra, custo da morte e receita do descarte em uma ou mais parcelas
  mensais (`parcelas_qtd`); a visão geral lê o valor de compras e vendas pelas alocações.
- Contrato: `conflito = {event_id, tipo (sempre o event_type), subtipo, data, nome}` e `EventCatalog.nomeEvento`; o
  catálogo serializado leva `nome` por tipo e subtipo; `evento.obter` devolve `papeis` e `totais_venda`; o estorno simulado
  traz `corrige` quando o alvo é uma correção.
- Interface: "Registrar" com rascunho ENVIANDO pergunta ao servidor antes de apagar; o resultado de uma correção não
  oferece "Desfazer" e a revisão do estorno de um substituto avisa que o original não volta; o botão diz "Estornar a
  transferência de 2 animais"; o seletor com data retroativa usa a posição na data e remarca os escolhidos quando a data
  muda; o link do conflito diz "Abrir a marcação para descarte de 01/05/2026"; a trilha de auditoria fala em palavras
  (campo, parâmetro e valores pelo nome); subtipos e avisos aceitos pelos rótulos certos; o detalhe da venda e a correção
  da compra não calculam nada no aparelho.
- Testes atualizados ao contrato novo, sem afrouxar: `conflito.tipo` passa a ser o tipo e o subtipo vem à parte
  (`identificacao.test.js`, `validation.test.js`); os textos de tela "Abrir a transferência…", "Estornar a entrada de 2
  animais", "Será desfeito: O rebanho inicial…" e "Abrir a compra de 15/03/2025" (`tests/ui`); a consulta da posição na
  data quando a data muda (`tests/ui/movimentos.test.js`).
- Verificado em Node (`npm test`: 538 testes, 538 aprovados, 0 falhas, cerca de 7 minutos neste ambiente) e no navegador
  com o backend real (`npm run ui:check`: 71 testes, 71 aprovados, 0 falhas; página montada com 433 KB de 450 KB). Nada
  validado na conta do dono.

## 15/11/2026 — Fase 2, conserto da revisão independente (rodada 2)

- Motor: o estorno e a correção conferem também a mãe e o pai que a anulação devolve (progenitor anulado, mãe macho, pai
  fêmea, nascido depois do filho, ciclo: `REFERENCIA_GENEALOGICA`, CONFLICT com a correção que impede); o brinco devolvido
  não esbarra no de um animal que o próprio comando anula; o desfazer de uma importação de eventos concluída faz as mesmas
  conferências sobre os animais que ela só tocou (`EventService.conferirRestauracao`): dois animais não ficam mais com o
  mesmo brinco. Fatos do mesmo dia (peso atual, situação reprodutiva, partos, correções de cadastro, base estimada da
  venda) seguem a posição do substituto na cadeia (desenho-base 16.1): corrigir só um valor não troca mais o peso nem a
  situação reprodutiva. Correção de cadastro de cria nascida na fazenda não muda mais mãe, nascimento, origem nem o pai do
  parto (`NAO_SE_APLICA`: corrija o parto). Retroativo que deixa a origem de uma saída posterior errada continua em
  CONFLICT (03b: origem imutável; 04, 5.2 ii), agora com o caminho que funciona (estornar, lançar, registrar de novo). O
  aviso de possível duplicidade usa o nome do lançamento ("Já existe a transferência de 01/04/2026 com este animal") e
  `conflito` com tipo, subtipo e nome. A regra de data antes do marco zero passou ao catálogo (`aceita_historico`).
- Integridade: checagem nova `GENEALOGIA` (26 checagens); `COPIAS` confere o tipo da linha de detalhe com o tipo e o
  subtipo do evento (BAIXAS, AJUSTES, REPRODUCAO); `PARTOS` confere também o cadastro reconstruído da cria.
- Financeiro: a revisão do estorno separa receita e deduções (`cancelados.receitas`/`despesas`; `total` só numa natureza);
  a correção aceita o item de lista desativado que o original já usava (desativado novo é recusado pelo nome);
  `desconto_comercial` aceita 0,00. Importação: frete, outros custos, desconto e deduções 0,00 = "não houve"; VENDAS
  ganhou a marca "descontado pelo comprador" por dedução (coluna ou valor para todas as linhas), gravada como no
  formulário (retida, comprador como parceiro, título no recebimento); TRANSFERENCIAS só fica DUPLICADA com a mesma origem
  e o mesmo destino.
- Interface: `Registro.abrir` trata as próprias falhas (sem conexão, rascunho no servidor ilegível): todo atalho avisa em
  vez de não fazer nada; a nota da correção diz o que acontece com o animal tirado pelo tipo de linha; a nota de data
  antes do marco zero segue o catálogo; o aviso de duplicidade ganhou o link para o lançamento existente; o pasto vazio
  oferece "Transferir para cá" e a folha "Como o animal entrou?" com o pasto escolhido (nunca o rebanho inicial direto);
  o parto histórico diz que a cria fica no histórico; o detalhe de um lançamento cancelado mostra títulos e rateio "sem
  efeito".
- Testes novos: `tests/revisao2.motor.test.js`, `tests/revisao2.financeiro.test.js`, `tests/ui/revisao2.test.js` e casos
  em `tests/telas.fase2.test.js`; atualizados ao contrato novo, sem afrouxar: a contagem de checagens em
  `tests/integrity.fase2.test.js` (25 → 26, com GENEALOGIA no contrato), a mensagem de possível duplicidade em
  `tests/events.test.js` ("Já existe a entrada de…", com o `conflito` conferido) e `cancelados` com receita e despesa em
  `tests/telas.fase2.test.js`.
- Verificado em Node (`npm test`: 555 testes, 555 aprovados, 0 falhas, cerca de 7 minutos neste ambiente) e no navegador
  com o backend real (`npm run ui:check`: 77 testes, 77 aprovados, 0 falhas; página montada com 437 KB de 450 KB). Nada
  validado na conta do dono.

## 15/11/2026 — Fase 2, DOCUMENTAÇÃO DE ENTREGA (E2.1 a E2.11 e §20)

Nenhuma linha de código mudou nesta etapa: só documentos, conferidos contra o código.

- `docs/RELATORIO_FASE2.md` (novo), com a estrutura e a regra de honestidade do relatório da Fase 1: entregas E2.1 a E2.11
  com arquivos, testes e estado; contagens reais de `npm test` e `npm run ui:check`, por arquivo (cada um rodado
  sozinho); cenários da Fase 2 por nível; o que só o dono pode executar (inclusive validar as fórmulas de compra e venda
  com um caso real, confirmar a PR-09 e rodar `runAcceptanceTests` com os cenários da Fase 2); decisões; limitações; a
  revisão adversarial (ataque interno e as duas rodadas independentes, por lente e gravidade, com o que foi corrigido,
  refutado em parte e adiado).
- `docs/GUIA_DE_IMPLANTACAO.md`: título das Fases 1 e 2; seção 11.1, atualização para a Fase 2 (backup antes, enviar o
  código de novo, `setup` — o esquema não mudou nesta fase, então ele só confere, faz backup e roda as 26 conferências —,
  `runAcceptanceTests`, o que conferir no app, validar as contas com um caso real, PR-09, publicar, e como voltar atrás:
  código e dados juntos, restaurando pelo sistema o backup do passo 1 antes de enviar o código antigo); 34 arquivos (23
  `.gs`); a tabela de arquivos com o `HealthService` e as dependências de hoje (tiradas do código); importação do
  histórico na seção 8.
- `README.md`: estado das Fases 1 e 2, o que a Fase 2 acrescenta, contagens e documentos.
- `docs/CONTRATOS.md`: estado com as rodadas de revisão; conferido por amostra contra o código (superfície pública de
  cada módulo e as 63 rotas de `Api.rotas()`: 51 canônicas e 12 extras, todas documentadas); acrescentados os membros
  públicos que não estavam citados: `EventCatalog.subtipos`, `Timeline.dataBr`, `FinancialService.MODALIDADES`,
  `CRITERIOS_LOTE` e `SEM_RATEIO`, as formas `x(ctx, dados)` do `InventoryService` e `ImportService.TIPOS_EVENTO`.
  Nenhum contrato mudou.
- Documentos da Fase 0 (permitido nesta etapa), onde a implementação contrariou ou estendeu o texto:
  - `10-plano-de-implementacao.md`: seção 8 com uma linha por entrega E2.1 a E2.11 e o estado real, e uma linha aberta
    para a validação na conta do dono; seção 4, os arquivos que a fase também tocou (`HealthService` antecipado da Fase 3).
  - `11-riscos-e-premissas.md`: R-02, R-12, R-13, R-24, R-25, R-27 e R-30 com o que a Fase 2 fez; risco novo R-31
    (orçamento da página: 437 KB de 450 KB); limitações do MVP (consequências de evento sem hora, títulos sempre em aberto
    antes da baixa, um critério de rateio por evento, histórico só pela importação); PR-09 entregue sem modalidade
    sugerida, confirmação pendente.
  - `03a-dicionario-cadastros-suporte.md`: 4.3.4, só linha de inventário decide as ordens 2 e 3 (por quê: lida ao pé da
    letra, a tabela levava a ANULADO o animal do histórico com uma correção de cadastro depois do marco zero; achado
    ALTA da revisão 1) e o animal EXTERNO não entra pela compra (estornar a compra o deixaria ANULADO); 5.1, o anexo
    enviado depois do registro leva o `event_id` e a entidade FINANCEIRO é aceita (o anexo de evento é filho dele). O
    `Schema` não muda: `npm run gen:schema -- --check` confere.
  - `03b-dicionario-eventos-financeiro.md`: 2.6, chave `motivo_ajuste` na baixa por divergência (a justificativa
    obrigatória não tinha onde ficar: esse subtipo não grava AJUSTES); 14, invariantes 10 (100% alocado também na
    abertura, no custo da morte e na receita do descarte) e 16 (`EVENTOS.total_value` em todo tipo) estendidas como o
    código confere.
  - `04-motor-de-eventos.md`, seção 6: a chegada declarada, o histórico só pela importação (fora o parto) com o
    financeiro sem caixa, o custo de aquisição pelas alocações da permanência atual (a compra histórica não vira custo do
    animal do marco zero; fica para a Fase 4) e a reconciliação sem tabela de decisão (o relatório não bloqueia; a ação
    é pelos próprios lançamentos).
  - `06-persistencia-e-integridade.md`, seção 9: as checagens da Fase 2 (saída com evento posterior, partos, genealogia,
    brinco ativo nas identificações, demais invariantes do financeiro) e o 100% alocado estendido.
  - `08-ux-ui.md`, 4.2: Nascimento no grupo Reprodução, como o `EventCatalog` ficou.
  - `09-plano-de-testes.md`, seção 5: a varredura de quedas como foi executada (todos os subconjuntos até 5 escritas e 24
    sorteados nos pontos de buffer cheio), com o critério original de 1.024 e 500 como meta fora da suíte.
  - `fase-0/README.md`: a contagem de riscos (31).
- Verificado em Node (`npm test`: 555 testes, 555 aprovados, 0 falhas, cerca de 8 minutos; cada arquivo rodado sozinho
  dá a mesma soma) e no navegador com o backend real (`npm run ui:check`: 77 testes, 77 aprovados, 0 falhas; página
  montada com 437 KB de 450 KB); `npm run gen:schema -- --check` confere depois das mudanças em `03a` e `03b`. Nada
  validado na conta do dono.

## 15/11/2026 — Fase 2, conserto da revisão independente (rodada 3)

23 achados (8 de gravidade alta; o da descrição e do vencimento propostos na prévia da correção veio em duas lentes),
todos reproduzidos por um teste que falhava antes do conserto e corrigidos; nenhum refutado nem adiado. Testes novos:
`tests/revisao3.motor.test.js`, `tests/revisao3.financeiro.test.js`, `tests/revisao3.interface.test.js` e
`tests/ui/revisao3.test.js`.

- Motor: o pai do parto só de natimorto passa pela mesma conferência da cria viva (existe, não anulado, macho, nascido
  antes do parto); corrigir ou estornar o sexo ou o nascimento de quem é touro de um registro reprodutivo é recusado
  (RN-012, RN-060). O estorno e a correção conferem os registros anteriores ao marco zero com o nascimento e a chegada que
  voltam, a correção de quem criou o animal usa a chegada do conjunto final, e o nascimento corrigido do filho fica depois
  do da mãe e do pai (VALIDATION no comando, CONFLICT no estorno). Um número de brinco fica em um animal por vez: a
  primeira identificação retroativa, a troca ou a retirada levada para depois e a entrada com o número que outro usava no
  período dão CONFLICT com o registro do outro animal (`conferirPeriodosDeBrinco_`); o brinco de criação igual ao do
  original não é proposta nova na correção. Conflitos de genealogia e de touro com o tipo, a data e o nome do lançamento,
  uma vez por lançamento.
- Importação: o brinco é resolvido pela identificação em uso na data do evento; desfazer uma importação concluída com
  outra em curso é recusado (`IMPORTACAO_EM_CURSO`); o desfazer confere o touro dos partos e o valor alocado por outro
  lançamento; o rebanho inicial importado não recebe o número que outro animal usava no marco zero; a reconciliação usa a
  correção de localização e a baixa na contagem datadas do marco zero.
- Integridade: evento vigente sem o detalhe que o tipo grava (COMPRAS, VENDAS, BAIXAS, AJUSTES, IDENTIFICACOES) é acusado;
  GENEALOGIA confere o touro dos registros reprodutivos; IDENTIFICACOES_ATIVAS acusa o número em dois animais ao mesmo
  tempo; a dedução retida precisa vencer num recebimento da venda; BASE_RATEIO recalcula também peso vivo, carcaça e
  cabeças. Continuam 26 checagens.
- Interface e financeiro: a prévia da correção não fixa como digitado o que o servidor propôs (descrição, vencimento à
  vista, parceiro e vencimento da dedução retida, parcela única) e trata o critério DIRETO de um animal só; o item de lista,
  o parceiro, a conta e a categoria desativados depois de usados aparecem pelo nome com "— desativado" e são aceitos pelo
  formulário; o rascunho no servidor vai em partes (até 96 KB) e a falha do envio adiado aparece (faixa e aviso de saída
  verdadeiro); a confirmação do desfazer da importação diz o que acontece pelo tipo; a Visão geral não chama de "não
  concluído" o rascunho enviado sem resposta e pergunta ao servidor antes de descartá-lo.
- Testes atualizados ao contrato novo, sem afrouxar: o parto citado uma vez como `PARTO_DA_MATRIZ` em
  `tests/estorno.test.js`; o número em dois animais ao mesmo tempo agora acusado em `tests/integrity.fase2.test.js`; o
  rascunho grande guardado em partes em `tests/api.test.js` (o limite passou de 8 KB a 96 KB); o vencimento à vista que
  a prévia já deixa vazio em `tests/ui/venda.test.js`.
- Verificado em Node (`npm test`: 587 testes, 587 aprovados, 0 falhas, cerca de 8 minutos neste ambiente) e no navegador
  com o backend real (`npm run ui:check`: 81 testes, 81 aprovados, 0 falhas; página montada com 443 KB de 450 KB). Os 35
  testes novos de achado falham no código anterior à rodada (o 36º, "a importação em curso ainda pode ser desfeita", é a
  guarda do que precisa continuar valendo). Nada validado na conta do dono.

## 15/11/2026 — Fase 2, conserto da revisão independente (rodada 4)

29 achados (6 de gravidade alta; os de brinco no estorno vieram em duas lentes e foram tratados uma vez), todos
reproduzidos por um teste que falhava antes do conserto e corrigidos; nenhum refutado nem adiado. Testes novos:
`tests/revisao4.motor.test.js`, `tests/revisao4.financeiro.test.js`, `tests/revisao4.interface.test.js` e
`tests/ui/revisao4.test.js`.

- Motor (conjunto final em todo caminho): a conferência dos períodos de uso do brinco vale também no estorno, na correção
  que tira a linha de brinco do original e no desfazer da importação (CONFLICT `BRINCO_DUPLICADO` com o registro do outro
  animal); a chegada declarada não fica antes do nascimento na correção de quem criou o animal (com as correções vigentes)
  nem no que volta com o estorno ou o desfazer (`ENTRADA_ANTES_DO_NASCIMENTO`); a mãe e o pai do conjunto final valem na
  correção de quem criou o filho; a mãe de parto só de natimorto nasce antes do parto (registro, correção e estorno); a
  categoria manual que continua valendo serve ao sexo final (`CATEGORIA_INCOMPATIVEL` com a reclassificação); o parto não
  passa a informar um pai diferente do que uma correção de cadastro pôs na cria (`PAI_DA_CRIA`); pasto, propriedade e
  categoria desativados depois do uso valem na correção; o conflito de genealogia aponta a correção que criou o vínculo.
- Integridade e reconciliação: COPIAS confere a fonte de cada evento vigente (linhas dos animais com o papel e o efeito do
  tipo, pasto do movimento, `pre_marco_zero` pela data, detalhe só de animal com linha) e o achado continua depois do
  reparo; LINHA_DO_TEMPO acusa a chegada antes do nascimento e a categoria manual de outro sexo; BASE_RATEIO refaz a base
  estimada da venda. A reconciliação não quebra com a mãe de parto antigo baixada no marco zero, aceita a outra entrada
  datada do marco zero como decisão do dono e dá em FORA_DA_FOTOGRAFIA só os caminhos que funcionam. Continuam 26
  checagens.
- Financeiro: o animal que só existe no histórico tem o custo da compra histórica e o resultado na ficha
  (`Timeline.entradaDoCusto`, a mesma fronteira no projetor, na ficha e na invariante 18); o tipo de cada custo da compra
  sai da ordem do `financial_id` (os fretes recebem os menores), não da ordem física das linhas: classificar a aba não muda
  nada; a prévia do lote de um animal com carcaça e a do registro histórico se corrigem pela tela.
- Interface: prévia do parto sem fixar o pasto e a raça propostos (`evento.obter.propostas`); revisão da correção sem
  "anulados" falsos (`impactos.voltam`) nem "Animais" repetido, com os documentos do original (`impactos.anexos_nomes`) e o
  custo ou a receita de cada animal pelo nome; subtipo só para leitura na correção; linha do tempo da ficha pelo nome e na
  ordem canônica, como a lista de eventos; seletor com data passada pelo sexo; pasto desativado sem ações impossíveis;
  ajudas e contrato do rascunho (96 KB em partes) corrigidos.
- Testes atualizados ao contrato novo, sem afrouxar: em `tests/financeiro.test.js`, `tiposDosCustos` agora pela ordem do
  identificador, com o caso das linhas embaralhadas; em `tests/ui/telas.test.js`, a linha do tempo da ficha mostra a data
  corrigida em dd/mm/aaaa (antes a asserção reproduzia o código cru que o achado 17 apontou) e não mostra mais o código cru.
- Verificado em Node (`npm test`: 619 testes, 619 aprovados, 0 falhas, cerca de 7 minutos neste ambiente) e no navegador
  com o backend real (`npm run ui:check`: 85 testes, 85 aprovados, 0 falhas; página montada com 446 KB de 450 KB). Dos 36
  testes novos, 35 falham no código anterior à rodada (o 36º, "sem falso positivo" na conferência das linhas dos eventos, é
  a guarda do que precisa continuar valendo). Nada validado na conta do dono.

## 15/11/2026 — Fase 2, relatório com as rodadas 3 e 4 da revisão

Nenhuma linha de código mudou nesta etapa: só documentos.

- `docs/RELATORIO_FASE2.md`, seção 6: as rodadas 3 (23 achados, 22 distintos) e 4 (29 achados, 28 distintos), por lente
  e gravidade, com a decisão de cada achado (corrigido, refutado em parte com o motivo, resíduo adiado) e, na rodada 3,
  qual conserto a rodada 4 achou incompleto; o balanço das quatro rodadas (94 achados, 91 distintos, 25 correções
  incompletas); e a seção 6.7, que diz que a última rodada **não** terminou sem achado alto ou médio. Ela teve 6 altos,
  todos correções incompletas, e 14 médios. A seção recomenda uma revisão curta desses consertos antes da Fase 3.
- O mesmo relatório, números e textos: contagens refeitas (`npm test` com 619 testes, 619 aprovados, 0 falhas, em 423,9 s;
  `npm run ui:check` com 85 testes, 85 aprovados, 0 falhas, em 223,7 s; página montada com 446 KB de 450 KB), com os 14
  arquivos novos ou alterados desde a entrega rodados sozinhos. A soma por arquivo confere com o total. Também mudaram as
  decisões (itens 2, 4, 6, 7, 8, 9, 11, 12 e 14), as limitações (itens 5, 6, 7, 9, 11, 12 e 13, e os novos 15 e 16)
  e as entregas, com os testes das rodadas. Em "O que só o dono pode executar" entraram a verificação de integridade
  logo depois de atualizar o código (bases antigas podem passar a dar ERRO) e a ratificação das duas decisões da
  rodada 4 (custo do animal só do histórico; tipo de cada custo da compra).
- Classificação feita nesta etapa, diferente do registro da rodada 3 ("nenhum refutado nem adiado"). O achado da dedução
  retida conta como refutado em parte, porque a regra "parceiro = comprador" não entrou na integridade, com o motivo. O
  do rascunho no servidor conta como resíduo adiado, porque acima de 96 KB ele continua recusado.
- `docs/CHANGELOG.md`, rodada 3: eram 8 achados de gravidade alta, não 7.
- `docs/CONTRATOS.md`: o estado ganhou a frase da rodada 4. O arquivo foi conferido por amostra contra o código nas funções
  que as rodadas 3 e 4 mudaram, sem divergência: `Timeline.entradaDoCusto` e `ultimaPesagem`;
  `FinancialService.tiposDosCustos`, `basesEstimadas` e `planejar` com o `financial_id`; `evento.obter.propostas`;
  `impactos.voltam` e `impactos.anexos_nomes`; o rascunho em partes do `Api`; o desfazer com `IMPORTACAO_EM_CURSO`;
  `Campos.opcoesDe`, `Registro.descartarVerificando` e `TelaImportacao.consequenciaDesfazer`; os cadastros desativados
  do original na correção.
- `docs/fase-0/10-plano-de-implementacao.md`, seção 8: as rodadas 3 e 4 não mudaram nenhum estado de entrega. E2.1 a
  E2.11 continuam entregues, com 26 checagens, e a validação na conta do dono continua aberta. O arquivo não mudou.
- Ficaram com números antigos, fora desta etapa: `README.md` (555 e 77 testes, 437 KB) e
  `docs/fase-0/11-riscos-e-premissas.md` (R-12 com duas rodadas e 42 achados; R-31 com 437 KB).

## 15/11/2026 — Trava única de integridade antes de gravar

- Por quê: nas quatro rodadas de revisão da Fase 2, quase metade dos achados eram correções incompletas. O defeito
  consertado no registro voltava pela correção, pelo estorno, pela importação, pelo desfazer ou pela correção de
  cadastro, porque cada caminho tinha a sua lista de conferências. As conferências de cada caminho continuam, e agora todos
  passam também por uma conferência final do estado que deixariam gravado.
- `AuditService`: as checagens de domínio da verificação de integridade viraram uma função só, sobre um retrato e um escopo
  opcional (BRINCO, IDENTIFICACOES_ATIVAS, FK, ENTRADA_ABERTA, LINHA_DO_TEMPO, BAIXADO_SEM_POSTERIOR, PARTOS, GENEALOGIA,
  PROJECAO, ALOCACOES, PARCELAS, FINANCEIRO, ALOCACAO_DIRETA, CUSTO_AQUISICAO, COPIAS). A verificação de integridade usa a
  mesma função, sobre tudo; o relatório não mudou de forma. GENEALOGIA passou a conferir também a fêmea de cada registro
  reprodutivo que não é parto (diagnóstico de gestação), que precisa ser fêmea e ter nascido antes dele. Ganhou ainda
  `sementesDaTrava`, `travar` e `leiturasTrava` (CONTRATOS, seções 10.5 e 11).
- `UnitOfWork`: entre o tratador e a fase A de todo comando, também no SIMULAR, monta o retrato DEPOIS. O retrato é o estado
  lido, mais o plano como se a operação estivesse confirmada, mais a auditoria refeita, mais as projeções pelo mesmo
  projetor. A trava confere esse retrato no escopo afetado e com os vizinhos, e confere o de ANTES quando há erro. Achado
  de ERRO novo recusa com `VALIDATION`/`CONFLICT` e `INTEGRIDADE_<CHECAGEM>`; nada é gravado e a chave fica livre. A fase C
  grava as projeções do retrato.
- `Repository`: `bifurcar()` (o retrato em memória, com cópia na escrita) e `alterar` que refaz só a memória da aba alterada,
  salvo quando o campo decide a vigência de outras abas. `FinancialService.conferir(tx, escopo)`.
- Caminhos sem conferência própria que a trava agora fecha, com teste:
  - a correção do sexo ou do nascimento do touro externo de um parto só de natimorto;
  - a correção de cadastro da fêmea que entrou prenhe;
  - a troca do sexo de uma categoria escolhida à mão;
  - ligar "ignorar zeros à esquerda" com 012 e 12 em dois animais;
  - mudar o marco zero depois de um histórico importado.
- Recusas da trava nos testes que já existiam: uma só causa, real. O comando de exemplo dos testes de persistência gravava
  um evento que apontava para uma propriedade inexistente (ERRO de chave estrangeira). O banco desses testes passou a ter a
  propriedade (`tests/apoio-persistencia.js`, opção `propriedade`). Nenhuma expectativa de teste mudou. Nenhuma recusa foi
  falso positivo.
- Desempenho (`npm run trava:medir`, base de demonstração, 391 comandos, mediana de três execuções alternadas): sem a trava
  42,9 ms por comando, com a trava 49,8 ms (+16 %).
- Verificado em Node: `tests/trava.integridade.test.js` (16 testes); `npm test` completo com 635 testes, 635 aprovados e
  0 falhas (523 s); `npm run ui:check` com 85 testes, 85 aprovados e 0 falhas (223 s), página montada com 446 KB de 450 KB.

## 15/11/2026 — Teste aleatório de todos os comandos da Fase 2 (etapa 2, passada 1)

- Por quê: a trava única fecha o estado que cada caminho deixa gravado; faltava provar, comando a comando e por todos os
  caminhos, que nenhum deixa o banco errado, sem depender da lista de casos de cada um.
- `tests/fase2.fuzz.test.js` e `tests/apoio-fuzz.js`: teste aleatório baseado em modelo pela `api()`. O gerador escolhe a cada
  passo um comando válido ou inválido entre todos os da Fase 2 (os 10 tipos ativos e os subtipos, corrigir, estornar,
  `animal.editar`, reuso de brinco e zeros à esquerda, marco zero, importação de ANIMAIS e dos 5 tipos de evento com validar,
  importar, concluir e desfazer, reenvio e versão velha). Depois de cada passo: integridade sem erro, projeção =
  reconstrução, financeiro (do sistema e nas linhas cruas), replay independente da linha do tempo, inventário e elegíveis,
  e o efeito pedido; a recusa não grava nada e fala português. Em falha, a sequência mínima encolhida e repetível (símbolos
  no lugar dos identificadores). `npm test` roda 16 sementes fixas; `FUZZ_SEMENTES`/`FUZZ_INICIO` rodam sementes novas
  (CONTRATOS, seção 36).
- Defeito achado e consertado na causa: o "brinco lançado errado" (AJUSTE_INVENTARIO/IDENTIFICACAO_INCORRETA) corrigido
  para antes de uma troca de brinco do mesmo dia ficava gravado trocando o número da troca, e esse número continuava no
  animal. O registro passou a conferir a posição (`ANTES_DA_IDENTIFICACAO`); os outros caminhos (troca levada para antes,
  identificação registrada ou estornada em volta, brinco de criação corrigido) ficaram fechados pela verificação de
  integridade (LINHA_DO_TEMPO: todo brinco lançado errado troca o número em uso na posição dele) e, com ela, pela trava.
  Os dois casos estão em `tests/fase2.fuzz.regressoes.test.js` e falham no código de antes.
- Modelo do teste corrigido (não o sistema): `tests/apoio-oraculos.js` passou a aceitar eventos importados (vigência com
  IMPORTADO), o lançamento sem parcela de evento anulado SEM_CAIXA (03b, 10.4), a importação desfeita sem anulador (02, 5.1)
  e a quantidade de animais do registro anterior ao marco zero. Nenhuma expectativa de teste antigo mudou.
- Sementes rodadas nesta passada, com o oráculo completo: 1.700 sementes novas em levas (1.500 de 60 passos e 200 de 120),
  além de cerca de 740 durante a montagem do oráculo. A leva final, depois dos consertos, foi de 400 sementes novas (20000 a
  20399) × 60 passos: 13.162 comandos aceitos, 9.663 recusados, 0 falhas.
- Verificado em Node: `tests/fase2.fuzz.test.js` (16 sementes fixas, cerca de 28 s) e `tests/fase2.fuzz.regressoes.test.js`
  (2 casos); `npm test` completo com 638 testes, 638 aprovados e 0 falhas (531 s); `npm run ui:check` com 85 testes, 85
  aprovados e 0 falhas (220 s), página montada com 446 KB de 450 KB.

## 15/11/2026 — Teste aleatório de todos os comandos da Fase 2 (etapa 2, passada 2: gerador ampliado)

- Por quê: a passada 1 ficou limpa; o gerador precisava gerar o que ainda não gerava. Lacunas achadas na leitura de
  `tests/apoio-fuzz.js`: cadastro desativado no meio (pasto, parceiro, categoria); correção de evento importado (sem a
  especificação do gerador); correção para outro tipo; a mesma chave com outro conteúdo; versão velha fora do registro de
  transferência; correção de cadastro e `animal.editar` com vários campos ou animais; compra com mais de uma volta; outra
  entrada com vários animais e a volta com um novo junto; linha repetida no arquivo importado; sequências mais longas.
  Tudo isso entrou (`tests/apoio-fuzz.js`: Pasto D vazio na montagem, `gerarAcao`, `specDoGravado`, `outraChave`), com o
  oráculo de cadastro desativado (nenhum animal no rebanho em pasto desativado, nenhum em categoria desativada escolhida à
  mão) e o efeito de `pasto.salvar`, `parceiro.salvar` e `categoria.salvar` (CONTRATOS, seção 36).
- Defeito achado e consertado na causa, por todos os caminhos: o animal voltava ao rebanho dentro de um pasto desativado
  (semente 61101: o estorno da morte de um animal do pasto depois desativado; o mesmo pelo estorno da transferência, da
  venda, do descarte, da baixa, pela correção e pelo desfazer da importação) e a correção que muda a ordem das
  reclassificações devolvia o animal a uma categoria desativada (o estorno já recusava com `CATEGORIA_INATIVA`; a correção
  não). As duas regras entraram na checagem LINHA_DO_TEMPO do `AuditService` (um achado por animal, com o lançamento que
  o pôs lá e o "Reative…"), e a trava única fecha qualquer caminho (`CONFLICT` `INTEGRIDADE_LINHA_DO_TEMPO`). Três casos
  novos em `tests/fase2.fuzz.regressoes.test.js` (falham no código de antes) e um de adulteração em
  `tests/integrity.fase2.test.js`.
- Modelo do teste corrigido (não o sistema): a mesma chave com outro conteúdo precisa mudar um campo que o comando leva (a
  importação monta os dados dela e ignora a justificativa; as chaves de `importarBloco`, `concluir` e `desfazer` vêm do
  `import_id`): 13 sementes de 62000 a 62159 acusavam o duplicado legítimo. `reproduzir` pula o reenvio cujo comando
  original ficou fora (o encolhimento chegava a outra falha com a mesma assinatura). Nenhuma expectativa de teste antigo
  mudou.
- Sementes rodadas nesta passada: 806 sementes novas. Com o gerador da passada 1, 100 sementes (60000 a 60099) × 120
  passos, 0 falhas. Com o gerador ampliado, 386 na triagem (61000 a 61005, 61100 a 61107, 62000 a 62159, 63000 a 63199 com
  100 passos e 64000 a 64011 com 120). A leva final, depois dos consertos, foi de 320 sementes novas (65000 a 65319) × 100
  passos: 16.604 comandos aceitos, 14.198 recusados, 0 falhas.
- Verificado em Node: `npm test` completo com 642 testes, 642 aprovados e 0 falhas (529 s); `npm run ui:check` com 85
  testes, 85 aprovados e 0 falhas (224 s), página montada com 446 KB de 450 KB. Na primeira execução do `ui:check`, um
  tempo esgotado em `tests/ui/movimentos.test.js` ("transferência com data passada", espera de 30 s pela conferência da
  posição na data); sozinho passou duas vezes e a execução completa seguinte passou inteira.

## 15/11/2026 — Teste aleatório de todos os comandos da Fase 2 (etapa 2, passada 3: gerador ampliado e oráculos metamórficos)

- Por quê: a passada 2 ficou limpa; o gerador ainda não gerava. Lacunas achadas na leitura de `tests/apoio-fuzz.js`:
  cadastros só desativados, nunca criados ou editados (pasto, parceiro, categoria com outro sexo, faixa, condição ou
  prioridade, item de lista, touro de referência, propriedade), e os comandos só usavam os da montagem; a entrada gravada
  sem especificação do gerador (o rebanho de base e a entrada da importação de ANIMAIS) nunca era corrigida; anexos
  (E2.9) fora do teste; reenvio e mesma chave só do último comando; a causa, o motivo, o destino, o tipo de parto e a raça
  fixos; o tamanho do lote da importação e as faixas etárias fixos; a importação de ANIMAIS sem pai, chegada e raça, e a
  de NASCIMENTOS sem pai; uma propriedade só. E o oráculo não via recusa indevida.
- Tudo isso entrou (`gerarCadastro`, `specDoGravado` com ENTRADA_INICIAL e OUTRA_ENTRADA, ação `anexo`, `antigo()` no
  reenvio, `lote`, `faixas`), com o efeito de cada cadastro e anexo, a propriedade atual = a do pasto, e três oráculos
  metamórficos: o estorno logo depois do registro devolve cada animal ao que era; a correção logo depois com a mesma
  especificação não muda nenhum animal; desfazer a importação logo depois de concluí-la devolve tudo (CONTRATOS, seção 36).
  As rotas `importacao.*` não levam `dataVersionEsperada` e ficaram fora da versão velha.
- Nenhum defeito do sistema. Três do modelo do teste, consertados na causa: o reenvio refazia a especificação memorizada
  sem os animais criados (sementes 73261 e 73364: a correção idêntica saía sem `animal_id`); a mesma chave do anexo com
  outra justificativa, campo que o `anexo.adicionar` não leva (sementes 74134, 74280, 74292, 74322, 74343, 74370 e 74406:
  o sistema tratava, certo, como o mesmo pedido); a correção que mantinha a modalidade LOTE ou ARROBA de peso vivo sem o
  critério, o lote ou o rendimento mandava `valor_animais` NaN (sementes 75247 e 75341). Dois casos novos em
  `tests/fase2.fuzz.regressoes.test.js`. Nenhuma expectativa de teste antigo mudou.
- Sementes rodadas nesta passada: 2.085 sementes novas (70000 a 77039, em levas de 100 a 150 passos). Triagem: 320 × 100
  com o gerador ampliado (71000 a 71319), 320 × 150 com as propriedades (72100 a 72419), 320 × 120 com os oráculos
  metamórficos (73100 a 73419), 320 × 120 com os anexos (74100 a 74419) e 320 × 120 (75100 a 75419). A leva final, depois
  dos consertos, foi de 440 sementes novas × 120 passos (76000 a 76399 e, pelo `FUZZ_SEMENTES`, 77000 a 77039): 27.203
  comandos aceitos, 21.573 recusados, 0 falhas.
- Verificado em Node: `tests/fase2.fuzz.test.js` (16 sementes fixas, 484 aceitos e 374 recusados) e
  `tests/fase2.fuzz.regressoes.test.js` (7 casos); `npm test` completo com 644 testes, 644 aprovados e 0 falhas (543 s);
  `npm run ui:check` com 85 testes, 85 aprovados e 0 falhas (221 s).

## 16/11/2026 — Teste aleatório de todos os comandos da Fase 2 (etapa 2, passada 4: período fechado, política de avisos e correção composta)

- Por quê: a passada 3 ficou limpa; o gerador ainda não gerava. Lacunas achadas na leitura de `tests/apoio-fuzz.js`: o
  período financeiro fechado (`fin_bloqueio_ate`) nunca ligado; a política de avisos (`avisos_politica`) nunca mudada; os
  parâmetros de regra e de projeção fixos (idade da desmama, idade reprodutiva, gestação, tolerância do parto, arroba,
  rendimento, tolerância da conferência, brinco só de números); nenhum brinco com letra ou hífen; a correção mudava uma
  coisa só, e nunca o parceiro, a propriedade, o subtipo da identificação e da marcação, a origem da venda e da
  transferência; reclassificação, brinco lançado errado e correção de localização sempre com um animal (nunca vários, nem
  o mesmo duas vezes); `dataVersionEsperada` só velha, nunca a atual; arquivo de compras com uma compra por cabeça, sem
  frete nem parcelas, e de vendas com uma venda; o mesmo arquivo nunca enviado de novo.
- Tudo isso entrou (ações `parametro`, `bloqueio`, `politica`, `versaoAtual`; `maisAjustes`, `mutarVarias`; compras e
  vendas importadas com mais de um grupo, kg, frete e parcelas; "importar o mesmo arquivo de novo"), com três oráculos que
  valem para todo caminho: o período fechado (`oraculoPeriodo`: quem cria ou cancela lançamento do período passou pelo
  aviso, foi recusado pela política ou a política o ignora; o aviso só aparece quando há lançamento do período; o pedido
  sem a justificativa é recusado), a política de avisos (`oraculoPolitica`, `oraculoPoliticaGravada`) e a versão atual
  (CONTRATOS, seção 36).
- Dois defeitos do sistema, consertados na causa, para todo caminho, na UnitOfWork (CONTRATOS, seção 10.5, item 6):
  (1) o desfazer da importação cancelava os lançamentos de compras e vendas importadas dentro do período fechado sem o
  aviso `PERIODO_BLOQUEADO` nem a justificativa (RN-082; sementes 82004, 82019, 82084, 82087, 82094, 82095, 82189, 82261,
  82270 e 83005). Agora o retrato de antes e o de depois da trava dão o aviso a qualquer comando que crie ou cancele
  lançamento do período (`AuditService.avisosDaTrava`), salvo quando o tratador já o pediu; aceito, exige
  `justificativa_aviso`, que fica em `OPERACOES.resumo_json.avisos_aceitos`. (2) O aviso `POSSIVEL_DUPLICIDADE` do arquivo
  de importação enviado de novo não seguia a política de avisos (cada caminho aplicava a sua; a importação não). Agora a
  UnitOfWork aplica a política a todo aviso de todo tratador (`AuditService.politicaDosAvisos`; a carência fica como a
  venda a deixa). A tela da importação mostra o "Vi e confirmo" e a justificativa do período no desfazer e no bloco
  (`src/Import.html`; `tests/ui/importacao-periodo.test.js`, novo). `ImportService.desfazer` leva `justificativa_aviso` e
  os avisos aceitos.
- Um terceiro defeito do sistema, achado na primeira leva final (semente 85086, por isso a leva foi refeita): no mesmo
  "brinco lançado errado", o brinco 2 passa a 7 e o 7 (digitado errado) passa a B-4; o registro aceitava, a correção
  idêntica recusava com `BRINCO_APOSENTADO` (no substituto, o 7 aparecia encerrado pela projeção gravada do original, e a
  correção do original, que o tirava, ficava de fora). `EventService.reusoDeBrinco_` passa a contar como corrigidos os
  números que as correções de brinco do próprio lançamento tiram, como o registro já fazia.
- Quatro defeitos do modelo do teste (não do sistema): o lançamento do bloco importado nasce sem status e o oráculo do
  período só contava o ATIVO (semente 81101); a simulação responde pela primeira chamada e o pedido sem a justificativa é
  recusado na segunda (sementes 82012, 82022, 82030, 82082, 82085); os oráculos metamórficos iam às vezes sem a
  justificativa (sementes 82099, 82101, 82202, 82265); o comando pede a confirmação antes da trava e a simulação, sem
  confirmar, chega à recusa da trava (semente 84252). Seis casos novos em `tests/fase2.fuzz.regressoes.test.js` (os três
  do sistema falham no código de antes). Nenhuma expectativa de teste antigo mudou.
- Sementes rodadas nesta passada (todas novas, de 80000 em diante): com o gerador da passada 3, 100 × 150 passos (80000 a
  80099), 0 falhas. Com o gerador ampliado, 28 sementes de exploração × 150 (81000 a 81005, 81100 a 81111, 83000 a 83009);
  a triagem de 320 × 150 (82000 a 82319), interrompida depois de 18 falhas, todas nas classes acima; 320 × 150 depois dos
  primeiros consertos (84000 a 84319: 1 falha, do modelo); a primeira leva final, 400 × 150 (85000 a 85399: 31.783
  aceitos, 24.416 recusados, 1 falha, a semente 85086). A leva final, depois do último conserto, foi de 400 sementes novas
  × 150 passos (86000 a 86399): 31.540 comandos aceitos, 24.479 recusados, 0 falhas.
- Verificado em Node: `tests/fase2.fuzz.test.js` (16 sementes fixas, 428 aceitos e 383 recusados) e
  `tests/fase2.fuzz.regressoes.test.js` (13 casos); `npm test` completo com 650 testes, 650 aprovados e 0 falhas (734 s,
  junto da leva final); `npm run ui:check` com 88 testes, 88 aprovados e 0 falhas (226 s), página montada com 448 KB de
  450 KB.

## 16/11/2026 — Revisão final da Fase 2 (rodada 5): conserto pelas garantias de todo caminho

17 achados (4 altos, 8 médios, 5 baixos), todos CORRIGIDOS, cada um com teste que falhava no código de antes
(`tests/revisao5.motor.test.js`, `tests/revisao5.financeiro.test.js`, `tests/revisao5.interface.test.js` e
`tests/ui/revisao5.test.js`: 27 testes, 23 no Node e 4 no navegador; rodados sobre a cópia do código de antes, os 27
falharam). Em vez de uma conferência nova por caminho, as garantias ficaram na trava e na verificação:
- **Fonte quebrada à mão** (achados 2 e 6): COPIAS, FILHAS_SEM_PAI e os achados novos do financeiro (lançamento com efeito
  de caixa sem parcela, parcela CANCELADA sem desdobramento, dedução retida sem recebimento) marcam a fonte da
  reconstrução como quebrada. A verificação não oferece o reparo (`reparo_impedido`), `repararIntegridade` recusa, a
  trava recusa o comando que lançaria para o que a fonte cita e põe em quarentena o que só a reconstrução alcança (a vaca
  morta sem a linha da morte continua morta; a dívida apagada não vira "sem caixa").
- **Trava no ensaio da importação** (achado 5): cada evento da validação e do bloco passa pela trava; o que só ela recusa
  vira motivo da linha. A conclusão recusada diz que só o desfazer resolve. Conferências próprias novas: pasto das crias
  que vem da mãe desativado (`PASTO_INATIVO`) e fêmea prenhe nascida no dia da entrada (`PRENHA_SEM_IDADE`, também na
  validação de ANIMAIS).
- **Cria em dobro** (achado 3): GENEALOGIA acusa a cria de parto e o filho sem parto da mesma mãe com o mesmo nascimento;
  o motor recusa o parto de quem já está no cadastro (`CRIA_JA_NO_CADASTRO`), pede confirmação quando o candidato não tem
  mãe informada e a reconciliação aponta o animal da fotografia (`mesmo_animal`) em vez de "Outra entrada".
- **Uma regra, todos os caminhos**: a duplicidade de linha na importação só com identificação (achado 1: garrotes sem
  brinco de COMPRAS); a mãe e o pai de ANIMAIS pelo brinco no marco zero (achado 4); o reuso desligado no período que o
  estorno devolve (achado 10); a conversão BLOQUEIA → erro numa função só, `Validation.bloqueado` (achado 8); a
  reativação de pasto exige a propriedade ativa e LINHA_DO_TEMPO acusa a propriedade desativada (achado 17); os anexos
  passam ao substituto pelo parceiro e pelo valor, com `impactos.anexos_soltos` (achado 12).
- **Mensagens**: a categoria manual × sexo manda estornar ou corrigir a reclassificação (achado 11); as frases da trava no
  condicional, o touro de fora pelo nome e o conselho do brinco corrigido para qualquer identificação (achado 16); os
  rótulos dos campos na correção de cadastro (achado 15); a coluna da planilha no lugar de "Dedução k"/"Custo k" (achado
  14); "Custo de aquisição por animal" na revisão da compra (achado 13); "Não dá para gravar" e o link "Abrir …" em toda
  recusa fora do formulário de evento, por `UI.estadoErro(e, {detalhes})` (achado 7); o erro de cada dado no cartão dele
  e a contagem por animal na correção de cadastro (achado 9).
- Expectativas de testes antigos ajustadas porque reproduziam o comportamento que os achados apontam como errado:
  `tests/integrity.test.js` (o relatório ganhou `reparo_impedido`), `tests/revisao4.motor.test.js` (os dois casos do
  achado 3 da rodada 4 rodavam o reparo sobre a fonte quebrada; agora conferem que ele é recusado e a vaca continua
  morta), `tests/trava.integridade.test.js` (quatro frases no presente — "não é macho pelo cadastro" — viraram o
  condicional, e a da categoria escolhida à mão deixou de mandar "voltar à categoria automática", que não resolve), `tests/venda.test.js` (a carência bloqueada ganhou a frase de quem bloqueia), `tests/ui/compra.test.js` e
  `tests/ui/eventos.fase2.test.js` ("Valor por animal" → "Custo de aquisição por animal (com frete e outros custos)").
- Teste aleatório: 200 sementes novas × 60 passos (93000 a 93199, depois dos consertos): 6.374 comandos aceitos, 4.620
  recusados, 0 falhas. Trava na base de demonstração (1 execução de cada, `npm run trava:medir`): 19.108 ms nos 391
  comandos (2.184 ms na trava) contra 18.637 ms (1.754 ms) no código de antes desta etapa.
- Verificado em Node: `npm test` com 673 testes, 673 aprovados e 0 falhas (535 s); `npm run ui:check` com 92 testes, 92
  aprovados e 0 falhas (227 s), página montada com 449 KB de 450 KB.

## 16/11/2026 — Fase 2, relatório da convergência

Nenhuma linha de código mudou nesta etapa: só documentos.
- `docs/RELATORIO_FASE2.md`, seção 6.8 (nova), "Convergência":
  - por que as quatro rodadas não convergiam (23, 19, 23, 29 achados; 0 %, 5 %, 35 % e 55 % de correções incompletas);
  - a trava única: o que confere, onde roda, o custo medido e o que ela não garante;
  - o teste aleatório: as sementes e os passos de cada passada, os 8 defeitos do sistema e os 14 do modelo, e as
    levas finais;
  - a revisão final (rodada 5): 17 achados por lente e gravidade, com a decisão de cada um;
  - o balanço das cinco rodadas, que diz que a convergência **não** está demonstrada.
- O mesmo relatório, outras seções: o resumo, as entregas, os números da seção 2, o que só o dono pode executar (a
  ratificação das decisões da convergência, o custo da trava no Sheets, o desfazer com o período fechado), as decisões
  (itens 12, 14 e o novo 15) e as limitações (itens 11, 12, 13, 15 e 16, e os novos 17 a 22).
- Execuções desta etapa, sobre o código final:
  - `npm test` com 673 testes, 673 aprovados e 0 falhas (508 s);
  - `npm run ui:check` com 92 testes, 92 aprovados e 0 falhas (224 s), página montada com 449 KB de 450 KB;
  - rodados sozinhos, todos aprovados com a contagem da tabela: os 11 arquivos do Node novos ou alterados, mais os 2
    que leem o `CONTRATOS.md`, e os 4 de navegador;
  - a contagem dos 74 arquivos de teste conferida sem rodar os corpos (um registrador no lugar de `node:test`);
  - teste aleatório com 200 sementes novas × 150 passos (96000 a 96199): 15.581 comandos aceitos, 12.441 recusados,
    0 falhas;
  - `npm run trava:medir`, mediana de 3 pares alternados com a cópia do commit `0cb6b07`, de antes da trava: 17.168 →
    20.779 ms nos 391 comandos (+21 %; 43,9 → 53,1 ms por comando; 2.340 ms dentro da trava).
- `docs/CONTRATOS.md`, conferido por amostra contra o código (trava: `CHECAGENS_DOMINIO`, `conferirDominio_`,
  `sementesDaTrava`, `travar`, `avisosDaTrava`, `politicaDosAvisos`, `propriosDoLote`, `Repository.bifurcar`,
  `UnitOfWork.retratoDepois_`, `ImportService.travarNoEnsaio_`, `Validation.bloqueado`, as mensagens da recusa e os três
  parâmetros que conferem o banco inteiro; teste aleatório: as funções e os oráculos de `tests/apoio-fuzz.js`, as variáveis
  `FUZZ_*`, as 16 sementes fixas de 60 passos, os 13 casos de regressão e as probabilidades do gerador). Três
  imprecisões foram corrigidas no texto, sem mudança de contrato:
  - FILHAS_SEM_PAI é alerta e fica fora da trava; só impede o reparo na verificação (seções 10.5 e 11);
  - `reparo_impedido` conta qualquer achado da fonte quebrada junto de um ERRO com reparo, e não só "achado de ERRO";
  - a quarentena refaz o retrato até 3 vezes, e a volta que pede mais quarentena não confere os achados novos.
  A seção 10.5 ganhou a medida de custo desta etapa.
- `CHANGELOG`: uma entrada por etapa da convergência (a trava, as passadas 1 a 4 e a revisão final), conferidas contra
  o registro de cada etapa.
- `docs/fase-0/10-plano-de-implementacao.md`, seção 8: a convergência não mudou nenhum estado de entrega (E2.1 a E2.11
  continuam entregues, a verificação continua com 26 checagens e a validação na conta do dono continua aberta). O
  arquivo não mudou.
- Continuam com números antigos, fora desta etapa: `README.md` (555 e 77 testes, 437 KB) e
  `docs/fase-0/11-riscos-e-premissas.md` (R-12 e R-31).

## 16/11/2026 — Fase 3, etapa BASE

- **Fase 3 aberta.** `EventCatalog.FASE_ATUAL = 3`. Os tipos da Fase 3 (PESAGEM, SANIDADE, REPRODUCAO, DESMAMA,
  CASTRACAO, OCORRENCIA, ESTOQUE) continuam inativos até terem campos: `tiposAtivos()` = `tiposAtivos(2)`, e o catálogo que
  vai ao cliente diz `fase: 3`. Como o tipo só fica ativo com campos, o **módulo só fica ativo com a tela entregue**: cada
  módulo do catálogo declara `tela` (o arquivo HTML) quando ela existe, e `modulosAtivos` traz só os da fase com tela.
  Pesagens, Sanidade e Reprodução são da Fase 3, mas ainda sem tela: fora do menu, do bootstrap e da rota da tela.
  `EventCatalog.modulos()` e `modulo(id)` dão os dados de qualquer módulo (a ficha deixou de usar `modulosAtivos(99)`).
  Testes da Fase 1 e 2 atualizados à fase nova sem enfraquecer: `tests/events.test.js` (`FASE_ATUAL` 3, os mesmos tipos da
  Fase 2, os tipos da Fase 3 inativos, os 10 itens do menu no catálogo até a Fase 5, cada um ativo só com a tela) e
  `tests/api.test.js` (`catalogo.fase` 3; os módulos do bootstrap continuam os 6 entregues).
- **Telas sob demanda (risco R-31; 01, seção 6.2).** A página montada estava em 449 KB de 450 KB. As telas das Fases 3 a 5
  e a importação (tarefa de desktop, pouco usada na abertura) não entram mais na página inicial:
  - rota extra `sistema.tela` `{nome}` → `{nome, modulo, conteudo, bytes}` (`Api.tela`, `Api.TELAS_SOB_DEMANDA`): guarda de
    dono, só as telas da lista, só de módulo entregue (o da fase futura responde `NOT_FOUND` com a fase), o arquivo
    compactado como o doGet entrega os includes, sem abrir a planilha-banco;
  - no catálogo, o módulo sob demanda declara `sob_demanda: true` e `rotas` (as raízes de rota); a importação é a primeira;
  - no cliente, `Modulos` pede a tela quando a rota dela abre (uma vez; pedidos ao mesmo tempo viram um), mostra o esqueleto,
    injeta o `<script>` como nó (sem innerHTML), guarda em memória e abre a rota; falha de rede → "Não foi possível abrir
    Importação" com "Tentar de novo"; outra versão do app no servidor → a tela nova não entra na página antiga, e a tela pede
    para recarregar (`NOVA_VERSAO`); `Telas.existe` conta a rota do módulo sob demanda ainda não carregado;
  - `Index` sem a importação: a página inicial foi de 449 KB para 406 KB;
  - `npm run ui:check` mede a página inicial montada (≤ 450 KB, sem nenhuma tela sob demanda) e cada tela sob demanda como
    a rota a entrega (≤ 150 KB por módulo; Import, 47 KB), e acusa a tela sob demanda posta no Index;
  - contingência (NV, a verificar na conta do dono): se o iframe do HtmlService não rodar o `<script>` injetado, a tela
    volta ao Index e o módulo perde `sob_demanda`, sem outra mudança.
  Testes: `tests/telas.sobdemanda.test.js` (novo), `tests/interface.test.js` (sintaxe das telas sob demanda, nenhuma no
  Index), `tests/apoio-telas.js` (o cliente do vm carrega as telas sob demanda pela rota) e `tests/ui/sobdemanda.test.js`
  (novo: abrir pela aba de Configurações, uma vez só, ir e voltar, falha de rede a 360 px, endereço direto, menu, versão
  nova). Os testes de navegador da importação que já existiam passam pela carga sob demanda sem mudança.
- **Teste instável** ("transferência com data passada: Todos do pasto…", `tests/ui/movimentos.test.js`). Causa: a corrida
  era da tela. A mudança de data dispara `inventario.elegiveis` sem pasto; quando a resposta chegava depois do "Incluir
  todos", `Seletor.dataMudou` redesenhava o painel do modo, e o resultado ("Posição em 01/03/2026") e o pasto escolhido
  sumiam — a espera de 30 s esgotava. Conserto no `Seletor`: a posição na data é uma promessa por (tipo, data, versão),
  a resposta de uma data que já mudou é descartada, cada desenho do painel é uma vez (a resposta de "Incluir todos", da
  busca, da lista colada e dos filtros que chega depois de o painel mudar fica de fora) e `dataMudou` só redesenha o painel
  desenhado noutra data. O teste espera o estado (os dois pedidos registrados, todas as respostas entregues e o resultado
  na tela), nunca um tempo fixo, com a asserção de antes. Teste novo com a corrida forçada (`__gas.atrasar`: a resposta da
  data chega 1,5 s depois da do pasto), que falha no código de antes exatamente como o instável (espera de 30 s esgotada)
  e passa no novo. O mock conta os pedidos em curso (`__gas.emCurso`) e o apoio ganhou `esperarServidor(page)`. Os outros
  testes de navegador foram lidos à procura do mesmo padrão (consulta assíncrona disparada e asserção logo depois): os
  demais já esperam um estado que depende da resposta.
- **Teste aleatório pronto para crescer.** `tests/apoio-fuzz.js` reorganizado num registro único: cada tipo de evento
  declara gerador e oráculo do efeito em `registrarTipo` (proposta, montagem, o que a correção muda, a especificação pelas
  linhas gravadas, os animais criados e o efeito) e cada tipo de importação o seu arquivo em `registrarImportador`; o
  sorteio, a correção, a correção para outro tipo, a correção pelo gravado, a memória e o oráculo só consultam os
  registros. Nada se perdeu: 24 sementes × 60 passos deram a mesma sequência de comandos e os mesmos desfechos antes e
  depois (as 16 fixas e mais 8). `tests/fase2.fuzz.test.js` confere que todo tipo e subtipo ativo do catálogo tem entrada e
  é aceito ao menos uma vez nas sementes fixas, que nenhuma entrada é de tipo inativo e que todo tipo importável tem
  arquivo: o tipo que ficar ativo sem a sua entrada falha no `npm test`. `FUZZ_SEMENTES` e `FUZZ_INICIO` continuam valendo.
- `docs/CONTRATOS.md`: seções 12, 19, 22 e 36, e a nova seção 37 (telas sob demanda).
- Execuções desta etapa, verificadas em Node e no Playwright deste repositório:
  - antes de mudar o código, `npm test` com 673 testes, 673 aprovados e 0 falhas (518 s);
  - no fim, `npm test` com 680 testes, 680 aprovados e 0 falhas (534 s), e `npm run ui:check` com 97 testes, 97
    aprovados e 0 falhas (235 s), página inicial com 406 KB de 450 KB e a importação com 47 KB de 150 KB;
  - `npm run ui:check` três vezes seguidas, sem falha (97 de 97 em cada, cerca de 230 s cada), antes de a mensagem da tela
    desconhecida deixar de citar o nome do arquivo (a última mudança de código, coberta pela execução final acima);
  - teste aleatório com 120 sementes novas × 100 passos (310000 a 310119): 6.227 comandos aceitos, 4.850 recusados,
    0 falhas;
  - a injeção da tela sob demanda no iframe do HtmlService continua a verificar na conta do dono (NV).

## 16/11/2026 — Fase 3, etapa E3.1 (pesagem e modo curral)

- **PESAGEM no motor, por um tratador só.** O tipo PESAGEM e o módulo PESAGENS ficaram ativos (`EventCatalog`: momento
  da pesagem, método, jejum, peso total e cabeças do lote; por animal, o peso e as observações). Individual, coletiva e por
  lote passam pelo mesmo caminho do `EventService` em todo comando — registro, retroativo, mesmo dia, correção (também a
  do substituto), estorno, importação e desfazer —: uma linha de PESAGENS por animal com a data do evento e a linha do
  animal com efeito 0 (um fato, que precisa caber numa permanência do animal no rebanho). Por lote, cada animal fica com a
  média (1 casa, MEDIA_LOTE) e as cabeças precisam bater com a lista. Peso fora de 0,1 a 2.000 kg ou com duas casas é
  recusado (RN-049); variação diária contra a pesagem anterior — ou, no retroativo, contra a seguinte — fora de −1,0 a
  2,0 kg/dia pede confirmação (PESO_IMPLAUSIVEL, RN-050), e a pesagem do animal já pesado no dia por outro lançamento
  também (POSSIVEL_DUPLICIDADE). O peso atual e a data da última pesagem continuam projeção.
- **Integridade.** PESAGENS conferida pela trava e pela verificação (`AuditService.conferirDominio_`): a data = a do
  evento e dentro da permanência (LINHA_DO_TEMPO), o momento da lista e igual em todo o lançamento, uma por animal, o peso
  na faixa e igual ao da linha do animal, a média do lote = total ÷ cabeças (COPIAS).
- **Desempenho no servidor** (`WeightService`, novo, puro): ganho, dias, GMD (3 casas) e variação (2 casas) entre
  pesagens, só entre métodos individuais e dentro da mesma permanência; intervalo abaixo de 28 dias sem GMD
  (DADOS_INSUFICIENTES, nunca zero, RN-052); GMD do período, por pasto (pelos dias em cada um), por categoria (a do início
  do intervalo) e de lote; projeção a partir da última pesagem com o GMD de referência, rotulada "Estimativa" (P10); peso
  ao nascer de referência só como ponto estimado da curva. Rota `peso.desempenho` (antes futura). A lotação e o peso médio
  do pasto em data já usavam a pesagem mais recente até a data, com a validade, e ganharam teste.
- **Telas.** `Weights.html` sob demanda (41 KB de 150 KB): o desempenho (filtros, indicadores, por pasto e categoria, as
  pesagens com o GMD de lote ou o motivo, curvas de até 5 animais) e o modo curral (brinco no teclado numérico, Enter,
  peso, Enter; contador do pasto e os que faltam; não encontrado como pendência; repetido; desfazer o último; fila no
  rascunho do aparelho e do servidor; envio em blocos de 20 com a chave guardada antes de sair; sem sinal, o bloco espera;
  resposta perdida conferida pela chave; aviso do servidor aceito na linha). A ficha ganhou o bloco de peso com a curva em
  SVG próprio (`UI.curvaPeso`: medidos, estimados, ao nascer, projeção tracejada e a tabela equivalente). O formulário, a
  revisão, o resultado, a correção pelo detalhe e o detalhe do evento conhecem a pesagem; a visão geral lista a pesagem do
  curral em andamento. A página inicial foi a 421 KB de 450 KB.
- **Aceitação.** `runAcceptanceTests` com o CT-05 inteiro (91 dias, 72,8 kg, 0,800 kg/dia, 24,27%; o intervalo de 10
  dias sem GMD; peso 0 recusado; 7,00 kg/dia com aviso) e o passo 3 do CT-10 (pesagem repetida no dia), que deixou de ser
  NAO_SE_APLICA; CT-17 com a pesagem no dia da venda (vale) e no seguinte (recusada) e CT-18 com a pesagem dos comprados, que segue válida na correção da compra e está entre os lançamentos que impedem a retirada. A base de demonstração ganhou 22
  pesagens coletivas de rotina (1.392 animais pesados), sem aviso: 401 comandos.
- **Teste aleatório.** Entrada PESAGEM no registro único (`tests/apoio-fuzz.js`), PESO_IMPLAUSIVEL na lista de avisos e o
  oráculo `REPLAY:PESO_ATUAL`. Com a PESAGEM no sorteio, a primeira identificação deixou de ser aceita nas 16 sementes
  fixas: o gerador da identificação sorteia o subtipo antes e a semente 57 entrou nas fixas (17).
- **A resposta dos outros tipos não mudou.** A primeira execução completa do `npm test` nesta etapa acusou 21 falhas: as
  varreduras de queda de `tests/unitofwork.adversarial.test.js` comparam a resposta inteira do reenvio, e a resposta de
  todo comando passara a levar `pesagem: null`. A chave `pesagem` agora só existe na resposta da PESAGEM; as outras duas
  falhas eram de comportamento novo (abaixo).
- **Testes que mudaram com o comportamento** (sem afrouxar): as listas de tipos e módulos ativos (`events`, `api`), os
  menus com Pesagens (`tests/ui/interface.test.js`, `tests/ui/sobdemanda.test.js`), o CT-10 fora do NAO_SE_APLICA e a
  ordem dos cenários (`acceptance`), o bloco de peso da ficha entregue, com o motivo de cada valor vazio
  (`tests/animals.test.js`), e o caso da PESAGEM no estorno e na correção de todo tipo ativo (`tests/estorno.test.js`,
  E2.7). Novos: `tests/pesagem.test.js` (12), `tests/pesagem.desempenho.test.js` (10) e
  `tests/ui/pesagem.test.js` (8, a 360 px, com a rede cortada e o reenvio).
- `docs/CONTRATOS.md`: seções 11, 12, 14, 15.2, 19, 21, 36 e 37, e a nova seção 38.
- Execuções desta etapa, verificadas em Node e no Playwright deste repositório:
  - `npm test` na primeira execução completa da etapa: 702 testes, 681 aprovados e 21 falhas (as da resposta acima e as
    duas de comportamento novo); depois do conserto, 703 testes, 703 aprovados e 0 falhas (582 s);
  - `npm run ui:check` com 105 testes, 105 aprovados e 0 falhas (240 s), página inicial com 421 KB de 450 KB, a
    importação com 47 KB e as pesagens com 41 KB de 150 KB;
  - teste aleatório com 120 sementes novas × 100 passos (330000 a 330119): 6.336 comandos aceitos, 4.733 recusados,
    0 falhas; depois do conserto da resposta, mais 120 sementes novas × 100 passos (340000 a 340119): 6.320 aceitos,
    4.727 recusados, 0 falhas;
  - a verificar na conta do dono: a tela sob demanda no iframe do HtmlService (NV, desde a etapa BASE), o teclado
    numérico e o rascunho no celular de verdade com sinal fraco, e o tempo real do Sheets com as pesagens da base de
    demonstração.

## 16/11/2026 — Fase 3, etapas E3.2 e E3.3 (insumos, protocolos e sanidade)

- **Cadastros.** `produto.salvar` e `protocolo.salvar` deixaram de ser rotas futuras (`HealthService`): produto com
  categoria, unidade de dose (que não muda depois do primeiro uso), embalagem, custo por unidade, doses e carência padrão,
  estoque controlado só quando pedido (PR-10, padrão N) e mínimo; protocolo com procedimento, sexo, faixa de idade,
  categoria e recorrência (uma vez, a cada N dias, campanha em meses do ano), antecedência e tolerância. O saldo
  (`PRODUTOS.estoque_atual`) é projeção dos movimentos vigentes, refeita pelo projetor e conferida pela trava.
- **ESTOQUE, por um tratador só.** Entrada (embalagens × quantidade por embalagem ou a quantidade na unidade; a compra é
  sempre um lançamento COMPRA_INSUMOS com parcelas, e o movimento de entrada só existe com o controle — decisão 16.9) e
  acerto (contagem pela diferença do saldo na data, perda, vencimento; só com o controle). Sem animais.
- **SANIDADE, por um tratador só.** Seis subtipos (vacinação, vermifugação, medicação, tratamento, exame, doença),
  individual e coletiva, com produto do cadastro, nome livre ou, na doença, sem produto. Dose por cabeça, por peso (pelo
  peso atual com a validade e o peso de referência da categoria) ou só o total do frasco; a dose de um animal pode diferir.
  O consumo e o custo nascem na aplicação (PR-11): a saída do estoque (a quantidade informada ou a soma das doses) e, com
  custo por unidade, um CUSTEIO sem parcela rateado aos tratados (por cabeça, ou pela dose de cada um na dose por peso),
  na conta da categoria do produto; o serviço pago no ato vira outro CUSTEIO com parcelas. Carência (fim = aplicação +
  dias) alimenta o RN-072 a partir da SANIDADE real, também quando a aplicação retroativa cobre uma venda para abate já
  gravada. Avisos: PRODUTO_VENCIDO, ESTOQUE_INSUFICIENTE (o menor saldo ao longo do tempo cai abaixo de zero; com a
  política BLOQUEIA, recusa — o estoque negativo é aviso ou bloqueio por parâmetro) e a duplicidade do mesmo produto no dia.
- **Agenda e alertas.** `sanidade.agenda`: as doses atrasadas e próximas por protocolo (e pela próxima informada sem
  protocolo), os animais em carência, a cobertura de cada protocolo e o custo sanitário do período; alertas
  SANITARIO_VENCIDO, SANITARIO_PROXIMO e EM_CARENCIA; `carencia_ate` na lista leve dos animais.
- **Integridade.** `AuditService.conferirInsumos_` (COPIAS, sem reparo): SANIDADE coerente com o payload, o produto, a
  carência e as alocações; a saída e o consumo iguais à quantidade; a entrada igual à compra; o acerto com um movimento;
  nenhum outro tipo com movimento ou lançamento com produto. A trava refaz e confere o saldo dos produtos que o comando
  toca.
- **Telas.** `Health.html` sob demanda (23 KB de 150 KB): agenda (com "Aplicar em N animais", que abre o lançamento com o
  protocolo, o produto, a dose, a carência e os animais pendentes), aplicações, produtos e estoque (cadastro pela folha,
  entrada e acerto) e protocolos. O Registro conhece os dois tipos (produto que sugere o padrão, revisão do servidor com a
  dose, o frasco, o estoque, o custo, a carência e a próxima); a ficha ganhou o bloco sanitário (F); o cartão da venda
  mostra a carência; o detalhe do evento e a correção (`previaSanidade_`, `previaEstoque_`) mostram e trazem o lançamento
  como foi digitado. A página inicial foi a 439 KB de 450 KB.
- **Aceitação.** CT-06 e o cenário SANIDADE (lote vencido e estoque insuficiente com aceite; carência na venda para abate
  dentro, no último dia e depois; protocolo de aplicação única) no `runAcceptanceTests`; a base de demonstração ganhou a
  vacina, o vermífugo e o protocolo semestral: 6 entradas de estoque, 6 vacinações e 9 vermifugações, sem aviso (422
  comandos, 3.154 aplicações), e saíram os manejos sanitários de `fora_desta_fase`.
- **Teste aleatório.** Entradas SANIDADE e ESTOQUE no registro único, os produtos e o protocolo na montagem (depois do
  rebanho de base, para não mudar os identificadores que as regressões fixas citam: a primeira montagem, com eles antes,
  fez falhar a regressão "estorno no período fechado de uma morte…", que cita crua a entrada do rebanho de base), os
  cadastros de produto e protocolo no meio da sequência, ESTOQUE_INSUFICIENTE e PRODUTO_VENCIDO nos avisos e na política e
  o oráculo global `REPLAY:ESTOQUE`. As 17 sementes fixas aceitam os seis subtipos e os dois do estoque.
- **Testes que mudaram com o comportamento** (sem afrouxar): listas de tipos e módulos ativos (`events`, `api`), o bloco
  sanitário entregue (`animals`), a SANIDADE real na venda em vez de linhas escritas à mão (`venda`), os dois tipos no
  estorno e na correção de todo tipo ativo (`estorno`), o saldo de estoque na projeção conferida (`integrity.fase2`), os
  cenários da aceitação, a Sanidade no menu e fora da página inicial (`telas.sobdemanda`, `tests/ui/interface.test.js`,
  `tests/ui/sobdemanda.test.js`; a rota de módulo não entregue passou a ser a da Reprodução). Novos: `tests/sanidade.test.js`
  (9), `tests/estoque.test.js` (6), `tests/sanidade.agenda.test.js` (5) e `tests/ui/sanidade.test.js` (4).
- `docs/CONTRATOS.md`: seções 1 (resumo), 11, 12, 14, 15.2, 19, 21, 22, 26, 28, 36 e 37, e a nova seção 39.
- Execuções desta etapa, verificadas em Node e no Playwright deste repositório:
  - `npm test` na primeira execução completa da etapa: 731 testes, 730 aprovados e 1 falha (a regressão do teste
    aleatório acima); depois de mover os produtos da montagem, 731 testes, 731 aprovados e 0 falhas (616 s);
  - `npm run ui:check` com 109 testes, 109 aprovados e 0 falhas (261 s), página inicial com 439 KB de 450 KB, a
    importação com 47 KB, as pesagens com 41 KB e a sanidade com 23 KB de 150 KB;
  - teste aleatório com 120 sementes novas × 100 passos (316000 a 316119): 6.404 comandos aceitos, 4.675 recusados,
    0 falhas; depois de mover os produtos para depois do rebanho de base, mais 120 sementes novas × 100 passos (317000 a
    317119): 6.470 aceitos, 4.640 recusados, 0 falhas;
  - a verificar na conta do dono: a tela de sanidade no iframe do HtmlService e o tempo real do Sheets com as 3.154
    aplicações da base de demonstração.
