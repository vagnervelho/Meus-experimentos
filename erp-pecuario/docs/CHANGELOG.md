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

## 16/11/2026 — Fase 3, etapas E3.4 e E3.5 (reprodução, desmama, castração e ocorrência)

- **Estação de monta.** `estacao.salvar` deixou de ser rota futura (`ReproductionService`): nome único na propriedade,
  início, fim (no início ou depois), tipo MONTA_NATURAL, IA ou MISTA; a edição é auditada e mudar as datas não mexe nos
  registros já lançados (cada registro fica com a estação dele).
- **REPRODUCAO, por um tratador só.** Exposição do lote (as fêmeas e os touros na mesma lista; linha TOURO para cada touro;
  o touro único gravado em cada fêmea, nenhum com dois), cobertura (o touro do rebanho com a linha TOURO, o de fora sem),
  inseminação (o touro do sêmen, a partida, o tipo), diagnóstico em lote (positivo, negativo, duvidoso; a idade da gestação
  e a previsão informada só no positivo) e aborto; a estação conferida contra a data no lançamento novo; o macho fora da
  exposição recusado (RN-060); a fêmea jovem com aviso (RN-061); a despesa paga no ato em todos os subtipos.
- **Situação reprodutiva e previsão de parto.** A situação é o último fato (o duvidoso e a desmama não decidem), coerente
  com os partos da Fase 2. A previsão nos quatro níveis de 03b, seção 7.3 (informada; inseminação ou cobertura + 290;
  diagnóstico + 290 − idade; a janela da exposição), sempre rotulada como estimativa; alertas PARTO_PREVISTO e
  PRENHEZ_VENCIDA.
- **DESMAMA, CASTRACAO e OCORRENCIA.** A desmama da cria (nascida na fazenda ou que entrou abaixo da idade de desmama, DL-06),
  com o peso (a pesagem DESMAMA) e o pasto de destino (o movimento), a linha MATRIZ e o registro DESMAMA uma vez por mãe; a
  castração do macho inteiro (castrado e não mais reprodutor); a ocorrência com o tipo da lista e a descrição. As três com a
  despesa paga no ato (CUSTEIO rateado por cabeça).
- **Regras de manejo e trava.** Touro castrado, castração de fêmea ou repetida, desmama repetida e parto dentro da gestação
  de um diagnóstico positivo, numa função só (`ReproductionService.problemasDoAnimal`), conferidas antes e depois de todo
  comando (o problema do próprio lançamento é `VALIDATION`; o que ele quebra num lançamento gravado, `CONFLICT` com ele),
  pela verificação de integridade (`AuditService.conferirReproducao_`: colunas do registro coerentes com o tipo, cabeçalho
  igual entre as fêmeas, touro do lote, detalhe obrigatório) e pela trava; o registro reprodutivo só de fêmea também na
  GENEALOGIA.
- **Indicadores (07, seção 8.3).** `reproducao.indicadores`: por estação e por categoria, com numerador, denominador, n e
  "parcial" — prenhez (entre as diagnosticadas com a cobertura do diagnóstico abaixo de 90%), parição, natalidade, perda
  gestacional, desmama, mortalidade até a desmama (com o corte da idade padrão), IEP e idade ao primeiro parto; a forma
  anual sem estação (PR-07); denominador zero ou abaixo do mínimo → `null` com DADOS_INSUFICIENTES. Decisão desta etapa para
  quem saiu no meio da estação: antes de um diagnóstico conclusivo, fora do denominador da prenhez; antes do fim da janela sem
  desfecho, fora do da parição, da natalidade, da desmama e da perda; a vazia descartada continua. O exemplo de 07 (80
  expostas) e o de 09, RN-066 (40 expostas), conferidos número a número.
- **Telas.** `Reproduction.html` sob demanda (49 KB de 150 KB): fêmeas com a situação, a previsão, os alertas e os botões de
  registro para as escolhidas (no celular, o cartão sem link colado à marca de seleção); diagnóstico no tronco a 360 px no
  modelo do modo curral (brinco e resultado com Enter, `p90`, blocos de 20 com chave própria, rascunho no aparelho, sem
  sinal sem duplicar); indicadores; estações pela folha. A ficha ganhou o bloco G inteiro (o do macho mostra os lançamentos
  como touro e a castração). A rota extra `reproducao.matrizes` alimenta a lista. A página inicial ficou em 441 KB de 450 KB.
- **Aceitação.** Cenário REPRODUCAO no `runAcceptanceTests` (RN-060, RN-061, RN-064 e RN-066 de 09, seção 4.1, mais a
  desmama, a castração e a ocorrência); a base de demonstração ganhou as três estações de monta (exposição das fêmeas aptas
  com os touros e o diagnóstico 150 dias depois, sem aviso) e saiu delas de `fora_desta_fase`.
- **Teste aleatório.** Entradas REPRODUCAO (cinco subtipos), DESMAMA, CASTRACAO e OCORRENCIA no registro único, com o
  oráculo do efeito de cada uma (registro, linhas, touro, pesagem da desmama, mães, despesa rateada); o cadastro e a edição
  da estação no meio da sequência; os replays globais `REPLAY:SITUACAO_REPRODUTIVA` e `REPLAY:CASTRADO`. Com os tipos novos
  no sorteio, nenhuma das 17 sementes fixas aceitava uma exposição nem um diagnóstico de doença: entraram as sementes 8 e 1.
- **Testes que mudaram com o comportamento** (sem afrouxar): o bloco G entregue (`animals`, `nascimento`, `tests/ui/movimentos`),
  os tipos e módulos ativos (`events`, `api`, `telas.sobdemanda`, `tests/ui/interface`, `tests/ui/sobdemanda`; a rota de módulo
  não entregue passou a ser a do Financeiro), os tipos novos no estorno e na correção de todo tipo ativo (`estorno`), a lista
  de cenários e a base de demonstração (`acceptance`). Novos: `tests/reproducao.test.js` (8),
  `tests/reproducao.indicadores.test.js` (5), `tests/manejo.test.js` (4) e `tests/ui/reproducao.test.js` (2).
- `docs/CONTRATOS.md`: estado, seções 19 e 24, e a nova seção 40.
- Execuções desta etapa, verificadas em Node e no Playwright deste repositório:
  - `npm test` (execução completa final): 756 testes, 756 aprovados e 0 falhas (689 s); na primeira execução completa da etapa, 756 testes, 751 aprovados e 5 falhas (as expectativas antigas do bloco G parcial, os tipos novos sem entrada no teste aleatório e a rota extra ainda sem contrato), corrigidas como descrito acima;
  - `npm run ui:check` com 111 testes, 111 aprovados e 0 falhas (261 s), página inicial com 441 KB de 450 KB, a importação com 47 KB, as pesagens com 41 KB, a sanidade com 23 KB e a reprodução com 49 KB de 150 KB;
  - teste aleatório: as 19 sementes fixas × 60 passos: 631 comandos aceitos, 437 recusados, 0 falhas; 60 sementes novas
    × 60 passos (1 a 60), sem falha, para achar as sementes que cobrem os subtipos; 120 sementes novas × 60 passos (730000 a 730119): 3.850 comandos aceitos,
    2.701 recusados, 0 falhas;
  - a verificar na conta do dono: a tela de reprodução e o tronco no iframe do HtmlService e o tempo real do Sheets com as
    estações da base de demonstração.

## 16/11/2026 — Fase 3, etapa E3.7 (gráficos)

- **Kit de gráficos em SVG próprio (SP-08), em `Components`.** O desenho pede os gráficos em `Components` (01, seção 6.2), e
  a lista de includes do desenho não tem arquivo próprio para eles: o kit ficou lá, na página inicial, sem biblioteca nem
  CDN. `UI.grafico` desenha linha, barras (horizontais, uma série ou agrupadas, com o zero no meio para valor negativo) e
  barras empilhadas (o total do servidor na ponta); `UI.curvaPeso` passou para o mesmo quadro. Todo gráfico tem `<title>` e
  `<desc>` ligados por `aria-labelledby`, os eixos com a unidade ("Peso (kg)", "Ganho médio diário (kg/dia)", "Taxa (%)",
  "Custo (R$)", "Cabeças"), a escala "redonda" (`UI.escalaGrafico`), a dica e o `data-valor` em cada marca, a tabela
  equivalente ("Ver tabela") com o mesmo texto do rótulo e o estado vazio (`data-vazio`, ícone e texto) quando não há o que
  desenhar. Barras: o nome curto (mês, pasto de nome curto) à esquerda da barra, o longo em cima dela; contagem e centavos
  com o eixo sem fração ("0,5 cabeça" não existe). O desenho tem a largura útil da área (o texto de 12 px sai com 12 px a 360 px; antes, a 360 px, o SVG de 600
  unidades encolhia o texto para cerca de 6 px) e é refeito quando a tela muda de tamanho. Pizza e rosca não entraram: o
  desenho só pede linha e barras.
- **Consertos que o kit trouxe:** a amostra da legenda saía na cor do texto (as classes das séries só pintavam `fill` e
  `stroke`): agora a cor é a da série; 8 cores de série (eram 4), todas com contraste de 4,5:1 com o branco; o ícone do
  estado vazio dentro de um gráfico não é mais esticado (`.grafico-area svg`).
- **Servidor (`peso.desempenho`).** `evolucao`: o G5 de 07, seção 9 (a média das pesagens individuais de cada mês, com o n;
  o mês abaixo do mínimo fica null com o porquê; estimativa visual, média do lote e projeção nunca entram; pasto e categoria
  pela data da pesagem). `por_pasto[].por_categoria` e `sem_categoria`: as cabeças de cada categoria em cada pasto no fim do
  período (o gráfico do rebanho por categoria). Nada é gravado: é leitura.
- **Telas.** Pesagens (desempenho): peso médio de cada mês (linha), GMD por pasto, por categoria e de cada pesagem de lote
  (barras) e rebanho por categoria em cada pasto (empilhadas). Reprodução (indicadores): as taxas da estação e as quatro
  taxas por categoria (barras; "(parcial)" no nome; o "—" com o motivo e o n). Sanidade (agenda): cobertura por protocolo
  (barras) e custo sanitário por conta (empilhadas: atribuído aos animais e sem animal). Ficha: a curva com eixos, título e
  descrição. Início: os cinco gráficos com o eixo "Cabeças". Nenhum gráfico refaz conta: os números são os do servidor.
- **Testes.** Novos: `tests/graficos.test.js` (6: G5 número a número, as categorias de cada pasto, a escala, as regras
  estáticas — todo SVG pelo kit, title e desc, tabela equivalente, título e unidade em cada chamada, nenhuma conta nos
  gráficos das telas da Fase 3 — e o contraste das cores) e `tests/ui/graficos.test.js` (8: a 360 e a 1280 px, com a
  captura de cada tela, o componente, a ficha, o desempenho, os indicadores reprodutivos e a agenda sanitária: o SVG existe,
  tem título e descrição, os números do desenho são os da tabela e os do servidor, texto legível a 360 px, sem rolagem
  horizontal, e o redesenho quando a tela muda). Nenhum teste anterior mudou.
- `docs/CONTRATOS.md`: estado, seções 22, 37 e 38, e a nova seção 41.
- Execuções desta etapa, verificadas em Node e no Playwright deste repositório:
  - `npm test` (execução completa final): 778 testes, 778 aprovados e 0 falhas (851 s); na execução completa anterior, 776
    testes, 773 aprovados e 3 falhas, todas da etapa paralela dos importadores (o registro do teste aleatório sem os tipos
    importáveis novos, as recusas de `import.test.js` e o `importacao.modelo` de `telas.test.js`), que ela corrigiu; na
    primeira execução, antes desta etapa, 756 testes e 1 falha passageira (um arquivo de `src/` lido enquanto era gravado);
  - `npm run ui:check` com 122 testes, 122 aprovados e 0 falhas (295 s), página inicial com 447 KB de 450 KB (eram 441 KB:
    o kit de gráficos), as pesagens com 44 KB, a sanidade com 24 KB e a reprodução com 50 KB de 150 KB;
  - teste aleatório: nenhum tipo de evento novo nesta etapa (a mudança do servidor é só leitura); 100 sementes novas × 60
    passos (770000 a 770099): 3.131 comandos aceitos, 2.294 recusados, 0 falhas;
  - a verificar na conta do dono: os gráficos no iframe do HtmlService, no celular e no computador.

## 16/11/2026 — Fase 3, etapa E3.6 (importadores de manejo)

- **Quatro importadores novos no mesmo assistente.** PESAGENS, SANIDADE, REPRODUCAO e OCORRENCIAS entraram no
  `ImportService` com as mesmas 5 telas, os mesmos 10 passos, as mesmas chaves, a mesma reconciliação e o mesmo desfazer
  das importações da Fase 2: cada lançamento é planejado pelo tratador único do tipo (`planejarEventoImportado`) num
  ensaio em memória, com a trava de integridade no ensaio, nos blocos, na conclusão e no desfazer. Agora os dez tipos do
  enum `TIPO_IMPORTACAO` são importáveis.
- **Modelos de planilha.** Pesagens (data, momento, método, jejum, pesagem por lote com o peso total e as cabeças, peso de
  cada animal); sanidade (procedimento, produto do cadastro pelo nome ou nome sem cadastro, protocolo, lote, validade, modo
  e dose, quantidade do frasco, via, motivo, diagnóstico, carência, próxima, veterinário; dose e resultado do exame por
  animal); reprodução (registro, estação pelo nome, touro pelo brinco na data, pelo código ou pelo nome do animal de
  referência, sêmen, método, retirada; resultado, idade da gestação e previsão por fêmea; na exposição, os touros do lote
  nas linhas); ocorrências (tipo da lista e descrição). Leituras novas: produto, protocolo e estação pelo nome (o ativo vale
  sobre o desativado de mesmo nome; dois iguais ficam ambíguos), com a mensagem que diz onde cadastrar.
- **Agrupamento.** Sem o número do lançamento, a chave natural mais os campos opcionais do lançamento (`agrupamento.opcionais`
  no modelo): a mesma data, momento e método fazem uma pesagem coletiva; a mesma data, procedimento e produto, uma
  aplicação; a mesma data, registro, estação e touro, um lançamento reprodutivo; a mesma data, tipo e descrição, uma
  ocorrência com vários animais.
- **O animal pelo brinco na data** (lição da Fase 2): o dono do número em uso na data de cada lançamento, ou o código
  interno; testado com o brinco que trocou de animal no meio do ano.
- **Linhas idênticas e duplicidade (decisão desta etapa).** A linha repetida que identifica o animal fica DUPLICADA. O fato
  já gravado na base fica DUPLICADA (`EVENTO_JA_REGISTRADO`): a pesagem do animal na mesma data com o mesmo peso (de
  qualquer lançamento), a aplicação do mesmo procedimento com o mesmo produto, o mesmo registro reprodutivo, a ocorrência
  do mesmo tipo. Duas pesagens legítimas do mesmo animal no mesmo dia são dois lançamentos (números diferentes na coluna
  "Nº da pesagem"), e a segunda pede a confirmação de `POSSIVEL_DUPLICIDADE`, como no formulário; o mesmo animal duas vezes
  no mesmo lançamento é recusado com a dica da coluna. No manejo, a linha duplicada pela base sai do lançamento e as outras
  entram (cada linha é um fato); nas compras e vendas o lançamento continua entrando só inteiro.
- **Histórico anterior ao marco zero** (04, seção 6: pesagens, vacinações e a reprodução antigas contam para a curva, o
  histórico sanitário e a reprodução): os quatro tipos entraram em `EventService.HISTORICO_IMPORTADO`. No tratador único,
  valendo também para a correção do registro histórico: a aplicação antiga não baixa o estoque nem gera consumo (o estoque
  e o custo do insumo começam no marco zero), e a despesa paga no ato do manejo antigo nasce sem caixa, como a compra e a
  morte históricas. A verificação de integridade e a trava conferem isso (`conferirInsumos_`: `HISTORICO_ESTOQUE`,
  `HISTORICO_CONSUMO`). A pesagem antiga entra na curva e no peso atual e fica fora do GMD, com a explicação "Pesagem
  anterior ao marco zero…" (`WeightService`). A situação reprodutiva declarada na entrada passou a valer como o fato da
  data da entrada (`Timeline`): o diagnóstico de 2025 importado não desfaz a vaca declarada vazia no marco zero; sem
  situação declarada, o histórico decide (o replay do teste aleatório segue a mesma regra).
- **Registro gerado por linha** (03a, seção 5.5): a pesagem, a aplicação ou o registro reprodutivo; na ocorrência e no touro
  da exposição, a linha do animal no evento.
- **Desfazer.** As conferências do estorno, como nas importações da Fase 2; a correção de fora de um lançamento importado
  bloqueia até ser estornada. O desfazer da importação de ANIMAIS com manejo importado depois manda desfazer antes a
  importação que o trouxe (com o nome do arquivo).
- **Tela.** `Import.html`: os dez tipos em palavras; as opções lidas e os valores para todas as linhas em palavras (momento,
  método, procedimento e registro pelo rótulo do subtipo, modo da dose, resultado), o produto, o protocolo e a estação pelo
  nome; o texto das obrigatórias diz como o animal é achado e que o histórico da sanidade não mexe no estoque; o relatório
  final do manejo sem as pendências de animais criados e com o atalho para o módulo (pesagens, aplicações, fêmeas,
  lançamentos).
- **Testes que mudaram com o comportamento** (sem afrouxar): `import.eventos` e `import` (o tipo "de outra fase" deixou de
  existir: as pesagens são importáveis; o tipo desconhecido continua recusado), `telas` (os dez tipos do modelo), o replay
  da situação reprodutiva do teste aleatório (a regra da situação declarada). Novos: `tests/import.manejo.test.js`,
  `tests/ui/importacao-manejo.test.js`, a varredura de quedas do bloco de PESAGENS e de SANIDADE nas três primitivas
  (`unitofwork.adversarial`), os quatro importadores no teste aleatório com o oráculo do fato de cada linha importada e as
  sementes fixas 31 e 56 (com os tipos novos no sorteio, nenhuma das anteriores aceitava uma medicação nem uma primeira
  identificação).
- `docs/CONTRATOS.md`: estado, seções 18.2, 38, 39 e 40 e a nova seção 42; `README.md` e `docs/GUIA_DE_IMPLANTACAO.md`
  (os módulos de importação).
- **O que o teste aleatório achou nesta etapa:** na leva com o peso dos importadores de manejo aumentado (só no roteiro da
  leva), a semente 361048 corrigiu pelo formulário uma ocorrência histórica importada pondo a despesa paga no ato: o sistema
  gravou a despesa sem caixa (a regra nova do histórico), e o oráculo do efeito ainda esperava as parcelas. O oráculo da
  despesa do manejo e o do serviço pago na sanidade passaram a seguir a regra (o histórico sem parcela e SEM_CAIXA; a
  aplicação histórica sem saída nem consumo), e o caminho ganhou um teste fixo em `tests/import.manejo.test.js`.
- Execuções desta etapa, verificadas em Node e no Playwright deste repositório:
  - `npm test` (execução completa final): 778 testes, 778 aprovados e 0 falhas (786 s); na primeira execução completa
    depois do código, 777 testes, 777 aprovados e 0 falhas; antes de começar, 756 testes, 756 aprovados;
  - `npm run ui:check`: 122 testes, 122 aprovados e 0 falhas; página inicial montada com 447 KB de 450 KB; sob demanda,
    Import com 48 KB de 150 KB;
  - teste aleatório: as 21 sementes fixas × 60 passos: 699 comandos aceitos, 479 recusados, 0 falhas; 120 sementes novas
    × 60 passos (360000 a 360119): 3.854 aceitos, 2.650 recusados, 0 falhas; 120 sementes novas × 80 passos com os
    importadores de manejo mais frequentes (361000 a 361059 e 362000 a 362059): 5.176 aceitos, 3.561 recusados, 1 falha (a
    do oráculo, acima; a semente refeita depois do conserto passa), e 141 linhas de manejo importadas conferidas pelo
    oráculo da conclusão (pesagens 38, sanidade 15, reprodução 39, ocorrências 49);
  - varredura de quedas do bloco de PESAGENS e de SANIDADE nas três primitivas: 6 testes, 6 aprovados;
  - a verificar na conta do dono: a importação de planilhas grandes de pesagens (milhares de linhas) no tempo real do
    Sheets e a tela de importação no iframe do HtmlService.

## 16/11/2026 — Fase 3, etapa ACEITAÇÃO (nível 2, demonstração, jornada e mapa RN)

- **`runAcceptanceTests` com os cenários da Fase 3**, pela `Api` na base de teste temporária, retomáveis e no relatório JSON:
  CT-05 e CT-06 (já entregues nas etapas E3.1 e E3.3), SANIDADE ampliado (a carência de RN-072 também na `sanidade.agenda`
  — no dia, no último dia e livre no seguinte —, o aceite da carência gravado com a venda para recria e o exemplo de 05,
  seção 4.7, com a bezerra nascida no cenário: fora antes dos 3 meses, elegível e em dia aos 3, próxima com o vencimento aos 8
  meses, cumprida depois da aplicação), o cenário novo ESTOQUE (o exemplo de 03a, seção 4.7: entrada por embalagem, compra
  de insumo no caixa e sem rateio, consumo de R$ 54,00 sem caixa rateado a R$ 1,80 por animal, perda, contagem e o estorno
  da aplicação que devolve as doses; saldo = soma dos movimentos vigentes) e REPRODUCAO com os desfechos da estação (aborto,
  morte de cria e desmama: desmama 75,0%, mortalidade até a desmama 3,2%, perda gestacional 3,1% parcial, sem mudar as taxas
  de RN-066). Todos terminam em `sistema.integridade` sem erro.
- **Base de demonstração completa da Fase 3** (semente fixa, só por comandos, nenhuma recusa nem aviso aceito; 410
  comandos, 304 ativos): os partos saem das três estações de monta (a fêmea exposta emprenha no plano e pare na janela da
  estação, com intervalo mínimo entre partos; o diagnóstico 150 dias depois é positivo para a que emprenhou); a desmama é o
  evento DESMAMA com o pasto de destino e o peso de cada bezerro (16 lançamentos, 270 bezerros), no lugar das transferências
  do dia da desmama; castração dos garrotes inteiros do marco zero com a visita paga à veterinária e rateada, e dos machos
  desmamados que ficam na recria (41 animais); 5 ocorrências do curral; as vermifugações pelo protocolo novo da recria (8 a
  30 meses, 120 dias) e as vacinações pelo semestral; 21 pesagens coletivas com 1.237 pesos. As vendas de vacas e novilhas
  do terceiro ano saíram em duas levas (D0+780 e D0+900; D0+800 e D0+950), e o gerador recusa o plano que cortaria um parto
  de estação encerrada (viraria perda gestacional sem ter havido perda). A conferência final passou a ler do servidor e conferir com a faixa do plano o GMD do
  rebanho (0,3 a 0,8 kg/dia), a prenhez de cada estação (70% a 98%), as taxas das estações encerradas e a cobertura dos
  protocolos (pelo menos 80%), e põe esses números no relatório (`demonstracao.manejo`): na conta do dono, a própria
  execução mostra se o manejo da demonstração saiu plausível. Na execução desta etapa: GMD 0,437 kg/dia (n 400); estações
  com prenhez de 93,6%, 92,2% e 90,0% (a terceira, parcial); cobertura de 91,1% (vacina) e 89,6% (vermifugação).
- **`tests/jornada.fase3.test.js`**: um ano de manejo só pela `api()` (insumos, protocolos, estações, pesagens, sanidade,
  estoque, reprodução, desmama, castração, ocorrências, carência na venda, pesagem importada, correções e estornos), com o
  inventário por pasto em várias datas, o peso e o GMD de cada animal da recria, os indicadores da estação, a agenda, o
  estoque e o custo sanitário conferidos contra um modelo independente; projeção = reconstrução e invariantes depois de cada
  comando; integridade sem erro no fim.
- **`tests/regras.fase3.test.js`**: o mapa RN → teste verificável de 05, seções 2.7 a 2.9 (RN-049 a RN-066) e do algoritmo
  4.7 — cada teste citado existe; as RN que o mapa da Fase 2 deixou para a Fase 3 têm lugar; cada caso da Fase 3 de 09, seção
  4.1, tem o passo no cenário do `TestRunner` e o teste do nível 1 — e os testes das RN sem caso próprio: RN-051 em todo
  caminho (PESAGENS só cresce), RN-053 (projeção, média calculada e carcaça nunca viram pesagem), RN-058 pelos quatro
  critérios da elegibilidade e RN-065 com a situação vinda dos registros da Fase 3.
- **Conserto num teste**: a conferência das aplicações da demonstração filtrava SANIDADE por uma coluna que não existe
  (`procedimento`; a coluna é `tipo_procedimento`): a checagem das vacinações passava sem conferir nada e a das
  vermifugações falhava. Agora confere as duas, com a contagem mínima de cada uma. `tests/acceptance.test.js` também
  confere que os números de `demonstracao.manejo` são os das rotas e que um GMD fora da faixa (a conta do servidor errada)
  derruba a conferência da demonstração, que a execução seguinte refaz. `tests/regras.fase2.test.js`: o nome do teste de
  aceitação citado no mapa (Fases 1 a 3).
- `docs/CONTRATOS.md`: estado e seção 21 (cenários da Fase 3, composição da demonstração, `demonstracao.manejo`, testes);
  notas nas seções 39 e 40. `docs/GUIA_DE_IMPLANTACAO.md`, seção 6: os cenários da Fase 3 e a demonstração com o manejo.
- Nenhum tipo de evento novo nem mudança no motor nesta etapa (só `TestRunner` e testes).
- Execuções desta etapa, verificadas em Node e no Playwright deste repositório:
  - `npm test` (execução completa final): 784 testes, 784 aprovados e 0 falhas (650 s); na primeira execução desta
    retomada, 784 testes, 783 aprovados e 1 falha (a da coluna, acima);
  - `npm run ui:check`: 122 testes, 122 aprovados e 0 falhas (272 s); página inicial montada com 447 KB de 450 KB; sob
    demanda, Import 48 KB, Weights 44 KB, Health 24 KB e Reproduction 50 KB de 150 KB;
  - teste aleatório: 120 sementes novas × 60 passos (880000 a 880119): 3.892 comandos aceitos, 2.620 recusados, 0 falhas;
  - a verificar na conta do dono: os cenários da Fase 3 e a base de demonstração (cerca de 410 lançamentos, em várias
    execuções) com o tempo real do Sheets.

## 16/11/2026 — Fuzz das Fases 1 a 3, passada 1 (gerador da Fase 3 e oráculos novos)

- **Lacunas do gerador** (leitura de `tests/apoio-fuzz.js`): os tipos da Fase 3 tinham entrada, mas o modo curral e o
  tronco em blocos com reenvio nunca eram mandados; a dose por kg só era conferida como positiva; o controle de estoque
  quase nunca alternava; havia um protocolo só e a agenda não era consultada; a estação de monta quase sempre recusava a
  data; o parto nunca era da prenhe nem corrigido depois do diagnóstico; as interações com a Fase 2 (venda na carência,
  aplicação retroativa sobre a venda, pesagem e diagnóstico de quem saiu, estorno da compra de insumo já consumido) só
  por acaso; o arquivo de sanidade sem carência, próxima e dose por kg; nenhum oráculo para a agenda, o GMD, os
  indicadores e as consultas de manejo.
- **Gerador ampliado**: o curral e o tronco (`gerarLida`: blocos com a chave própria `lida:<passo>:<n>`, bloco sem sinal,
  reenvio com a mesma chave, conferência por `operacao.status`, aviso aceito na linha, peso substituído, animal repetido
  no bloco, "terminar"); as interações (`gerarInteracao`: venda na carência para abate e para recria, também importada;
  aplicação retroativa e importada com carência sobre a venda; pesagem, aplicação, ocorrência, diagnóstico e aborto de
  quem saiu; saída corrigida para antes da pesagem ou do registro reprodutivo; parto da prenhe, parto corrigido ou
  estornado depois do diagnóstico, aborto; estorno e correção para menos da compra de insumo consumido; desmama das
  crias; castração do touro do lote; dose por kg; reprodução dentro e na borda da estação); o estoque ligado e desligado
  (`estoqueLiga`); o protocolo novo (intervalo, aplicação única, campanha, faixa de idade, sexo) e editado na recorrência;
  a aplicação com o protocolo do mesmo procedimento; o arquivo de sanidade com carência, próxima e dose por kg.
- **Oráculos novos**: a chave do bloco (reenvio gravado = duplicado com o mesmo evento; `operacao.status` CONFIRMADA ou
  INEXISTENTE, pelo que o sistema gravou); a dose por kg exata pelo peso vigente na data e o rateio do consumo pela dose;
  os avisos de transição em todo caminho (`oraculoAvisosDeTransicao`: estoque controlado abaixo de zero e mais baixo que
  antes → ESTOQUE_INSUFICIENTE com a política; venda que passa a estar na carência → CARENCIA_ATIVA, com a política na
  venda para abate; também no bloco importado e no desfazer); a agenda sanitária e o GMD por modelos independentes; os
  indicadores reprodutivos de cada estação (expostas contadas, taxas nunca zero sem denominador) e as consultas de
  manejo; `COBERTURA` conta o que cada oráculo novo conferiu, e as sementes fixas exigem cada um (a semente 262 entrou).
- **Medidas** (mutações numa cópia do projeto): sem o aviso de estoque e com a dose em duas casas, 20 de 32 sementes
  falham; sem a carência contra a venda gravada, 1 de 40; com a idade mínima do protocolo contada errado, 2 de 24.
- **Achados**: nenhum defeito do sistema. No modelo do teste, um (semente 7106): no período fechado, o pedido aceito de
  volta sem a justificativa do aviso para antes da trava, e a simulação chega à trava; o oráculo da simulação passou a
  aceitar esse par. Caso em `tests/fase3.fuzz.regressoes.test.js` (novo).
- `docs/CONTRATOS.md`: estado e seção 36 (passada 1 das Fases 1 a 3). Nenhuma linha de `src/` mudou nesta etapa.
- **Retomada** (o contêiner reiniciou com a passada quase pronta; o gerador e `src/` ficaram como estavam): conferido, pela
  leitura de `tests/apoio-fuzz.js` e pelas contagens da leva final, que cada item da lista é mandado e aceito ao menos uma
  vez (cada tipo e subtipo; curral e tronco em blocos, com reenvio e conferência da chave; dose por kg; estoque ligado e
  desligado; protocolo e agenda; estação com diagnóstico, parto e aborto; desmama; castração; importadores de manejo e
  desfazer; venda na carência, pesagem de quem saiu, diagnóstico da fêmea que saiu, parto corrigido depois do
  diagnóstico, estorno da compra de insumo consumido), salvo a venda levada para a véspera da pesagem ou do parto, que a
  regra recusa (FORA_DA_PERMANENCIA). As 24 recusas da trava em 160 sementes da leva são todas de regras que ela guarda por
  desenho (castração repetida, registro reprodutivo de quem passaria a macho, pasto desativado, mãe de cria desmamada).
- Execuções desta passada, verificadas em Node e no Playwright deste repositório:
  - teste aleatório, `FUZZ_PASSOS=100`: 1.640 sementes novas na passada, sem falha do sistema (1.240 antes da retomada,
    das quais a leva 950000 a 950499 com 27.297 aceitos, 17.064 recusados e 0 falhas); a leva nova final, depois da
    retomada: 400 sementes (970000 a 970399), 22.618 comandos aceitos, 13.390 recusados, 0 falhas;
  - `npm test`: 785 testes, 785 aprovados e 0 falhas (607 s); as 22 sementes fixas de 60 passos: 706 aceitos, 451
    recusados, 0 falhas;
  - `npm run ui:check`: 122 testes, 122 aprovados e 0 falhas (264 s); página inicial montada com 447 KB de 450 KB; sob
    demanda, Import 48 KB, Weights 44 KB, Health 24 KB e Reproduction 50 KB de 150 KB.

## 17/11/2026 — Fuzz das Fases 1 a 3, passada 2 (preparo das interações, interações novas e oráculos novos)

- **Lacunas do gerador** (leitura de `tests/apoio-fuzz.js` e contagens de 30 sementes com o gerador da passada 1): cerca
  de 70% das interações sorteadas voltavam vazias (a reprodução na estação foi aceita 1 vez em 30 sementes, a venda na
  carência nenhuma); a venda e a aplicação corrigidas para a carência, o consumo acima do estoque, o acerto retroativo, o
  parto da não prenhe, a mãe em volta do parto, a cria ao pé e a desmama com a venda, a pesagem fora da permanência, a
  importação de manejo de quem saiu e a estação com registros mudada no cadastro nunca eram montadas; o produto nunca era
  criado; os parâmetros da Fase 3 nunca mudavam; a categoria não tinha peso de referência; a estação só mudava o fim; o
  estoque não era corrigido pelas linhas gravadas; a campanha ficava fora do modelo da agenda e todo protocolo nascia
  "hoje" (relógio fixo); a cria ao pé não tinha replay; nenhuma correção era conferida tempo depois do registro.
- **Gerador ampliado** (`tests/apoio-fuzz.js`): o preparo de cada interação (`preparoDe`, com a interação pendente que
  volta logo) e o negócio sem erro de propósito nas vendas delas (`negocioLimpo`); nove interações novas; o produto novo
  nas cinco categorias; a categoria com peso de referência; a estação editada no início, no nome, no tipo e na
  propriedade; o protocolo de campanha mais frequente, com tolerância e meses editados; oito parâmetros da Fase 3 no meio;
  o relógio do pedido (`relogio`: a vermifugação de campanha `@q:campanha` da montagem cadastrada no marco zero e metade
  dos protocolos novos num dia do passado); `doGravado` do ESTOQUE (`specDoGravado` aceita o lançamento sem linha de
  animal); a ação `correcaoTardia`.
- **Oráculos novos**: a campanha no modelo da agenda (a perdida devida até abrir a janela da seguinte); `REPLAY:CRIA_AO_PE`
  pelas linhas cruas; a correção sem mudança, mais tarde, de um lançamento de manejo (de preferência com o cadastro que ele
  usa mudado depois) é aceita, salvo as recusas que o que mudou no meio explica por desenho. As sementes fixas exigem as
  quatro contagens novas (`tests/fase2.fuzz.test.js`; as 22 sementes cumprem sem mudar a lista).
- **Medidas** (mutações numa cópia do projeto): a campanha perdida esquecida, 30 de 30 sementes falham; a cria ao pé que
  não sai com a desmama, 6 de 30 (a integridade não vê); o cadastro do original deixando de valer na correção, 6 de 30.
- **Achados**: nenhum defeito do sistema. No modelo do teste, dois, da correção tardia: a mesma chave com outro conteúdo
  copiava a marca dela (semente 1210049) e o acerto de estoque do produto com o controle desligado depois é recusado por
  `PRODUTO_SEM_ESTOQUE`, como manda o desenho (semente 1320022). Casos em `tests/fase3.fuzz.regressoes.test.js`.
- Execuções: 1.600 sementes novas × 100 passos; a leva final com o gerador final, depois dos consertos do modelo, 500
  sementes (1400000 a 1400499): 29.681 aceitos, 16.499 recusados, 0 falhas; mais 160 contadas (1500000 a 1500159), 0 falhas.
- `docs/CONTRATOS.md`: estado e seção 36 (passada 2 das Fases 1 a 3). Nenhuma linha de `src/` mudou nesta etapa.
- Verificado no fim: `npm test`, 787 testes, 787 aprovados e 0 falhas (671 s), com as 22 sementes fixas de 60 passos (747
  aceitos, 435 recusados, 0 falhas); `npm run ui:check`, 122 testes, 122 aprovados e 0 falhas (267 s), página inicial com
  447 KB de 450 KB; sob demanda, Import 48 KB, Weights 44 KB, Health 24 KB e Reproduction 50 KB de 150 KB.

## 17/11/2026 — Fase 3, conserto da revisão (29 achados: 14 altos, 10 médios e 5 baixos)

Cada achado tem teste por caminho, que falha com o `src/` de antes do conserto e passa agora (conferido rodando os testes
novos sobre uma cópia com o `src/` anterior). Os testes ficam em `tests/revisao.fase3.motor.test.js`,
`tests/revisao.fase3.regras.test.js`, `tests/revisao.fase3.zootecnia.test.js` e `tests/ui/revisao.fase3.test.js`. Todos os
29 foram corrigidos; os achados 3 e 6 são o mesmo defeito, visto por duas lentes. Contratos em `docs/CONTRATOS.md`, seção 43.

- **Fato congelado na correção** (achados 3, 6 e 7; `EventService`, no tratador único, o que vale para a correção, a correção
  do substituto, a simulação e o estorno da correção): a aplicação corrigida com o mesmo produto usa o custo unitário da
  saída do original e a conta do consumo dele. A próxima aplicação proposta pelo protocolo usa o intervalo gravado no payload
  (`intervalo_protocolo_dias`), conferido pela verificação. A entrada de estoque corrigida usa o fator do payload do original
  e grava o movimento se o original o tinha.
- **Custo em dobro** (achado 4): o produto do cadastro com custo pago também no ato numa conta de insumo é recusado
  (`CUSTO_EM_DOBRO`) no registro, na simulação e na correção, e a ajuda do campo diz o caminho.
- **Integridade e trava** (achados 8, 13 e 14): a cópia do peso das pesagens de entrada, compra, venda e parto entra na
  verificação (COPIAS, sem reparo). O saldo do insumo entra na quarentena da fonte quebrada: o comando que movimenta o produto
  é recusado, e a conclusão e o desfazer da importação seguem sem regravar o saldo. A faixa da idade da gestação pelo
  parâmetro sai da verificação e fica só no motor; a correção que mantém a idade do original é aceita.
- **Indicadores na data** (achados 1, 2 e 9; `Timeline.reproducaoEm`): a situação e a marca de descarte na data D, pela
  regra da projeção, servem a projeção, a lista de fêmeas e os indicadores. Os indicadores da estação usam só os fatos até
  D. A natalidade anual não passa de 100% por uma marcação posterior.
- **GMD do curral** (achado 5): a resposta do registro traz o GMD pela conta da ficha, ou vazio com o porquê. A linha do
  curral mostra só o ganho e os dias no intervalo curto.
- **Agenda** (achado 10): a aplicação com protocolo cumpre a pendência sem protocolo do mesmo produto.
- **Curral e tronco** (achados 11, 12, 17 e 22): a recusa fica na linha (ERRO, motivo, "Corrigir" e "Tirar") ou na área de
  status. O bloco é criado na hora de sair, e nenhuma linha fica presa num bloco que não saiu. O tronco não diz que
  "substitui" a fêmea já gravada. O curral com data passada usa a posição do servidor (`inventario.elegiveis`).
- **Motor, médios e baixos** (achados 15, 16, 17, 23, 24, 25, 26 e 29): a lista "Animais" do desempenho segue o filtro.
  Ligar o controle de estoque com saldo negativo pede confirmação e manda acertar pela contagem, e o aviso de estoque não
  manda lançar de novo a compra já paga. Há aviso `POSSIVEL_DUPLICIDADE` por animal na reprodução, na sanidade e na
  ocorrência, com a chave da importação. A venda histórica não confere carência, nas duas ordens de importação. A resposta
  do `animal.editar` traz a carência, e a falta da aba é erro (INTERNAL). A mãe trocada com desmama vigente recebe o caminho
  da solução. O lote de pesagem não é duplicado pela pesagem individual, e o lote em parte fica com `LOTE_EM_PARTE`. O GMD
  do período explica por que nenhum intervalo conta.
- **Telas, médios e baixos** (achados 18 a 21, 27 e 28): o gráfico do ganho de lote tem um item por lançamento, e o das
  taxas, um item por categoria, com "(parcial)" no valor. A lista de aplicações mostra o produto ou o diagnóstico vindos do
  servidor. O rascunho do tronco aparece no Início. A ficha com versão nova oferece "Recarregar a página". O total de
  expostas ou inseminadas e a cobertura do diagnóstico vêm do servidor.
- **Teste aleatório** (`tests/apoio-fuzz.js`): na correção, o oráculo do efeito da SANIDADE e do ESTOQUE espera o custo,
  a conta, o intervalo do protocolo, o fator e o movimento do original, e a saída com o custo congelado. O oráculo
  `oraculoEfeitoCongelado` confere a correção tardia sem mudança. O preparo dela agora revê o custo ou a categoria do produto,
  o intervalo do protocolo, ou o fator e o controle de estoque do produto de uma entrada, e a correção que vem logo é a do
  lançamento preparado (`sis.tardiaAlvo`). O gerador de cadastro muda também a categoria e o fator. A agenda segue o modelo
  novo sem protocolo. O frasco pago no ato vai à conta Vacinas (os de 333,33 e de 99,99 em duas vezes), com o oráculo do
  aceite (nunca em dobro) e o da recusa (`CUSTO_EM_DOBRO` só com o produto do cadastro numa conta de insumo). As 22 sementes
  fixas continuam cumprindo todas as contagens exigidas.
- **Medidas** (mutações numa cópia do projeto, 40 sementes de 100 passos, 1820000 a 1820039): sem o custo e a entrada
  congelados na correção, 6 de 40 sementes falham (1 de 40 antes do preparo novo); sem a recusa do custo em dobro, 2 de 40.
- **Achados do teste aleatório**: nenhum defeito do sistema. No modelo, um: o oráculo do efeito da entrada esperava o
  controle de estoque de agora na correção (semente 1800003), e foi corrigido para o desenho do achado 7.
- Execuções do teste aleatório: 20 sementes de prova (1800000 a 1800019), com a falha do modelo acima; 300 sementes novas ×
  100 passos com o gerador intermediário (1810000 a 1810299): 17.936 aceitos, 9.739 recusados, 0 falhas; e a leva final,
  com o gerador final, 300 sementes novas × 100 passos (1830000 a 1830299): 17.874 aceitos, 9.877 recusados, 0 falhas.
- Testes anteriores ajustados ao contrato novo, sem enfraquecer: `tests/estoque.test.js` (ligar o controle com saldo
  negativo pede a confirmação), `tests/pesagem.test.js` (a resposta traz `gmd_motivo` e `gmd_explicacao`),
  `tests/reproducao.test.js` (o resumo traz `expostas_ou_inseminadas`) e `tests/ui/graficos.test.js` (a taxa parcial leva
  "(parcial)" junto do valor do servidor, e o teste exige que o cenário tenha uma).
- Verificado no fim: `npm test`, 809 testes, 809 aprovados e 0 falhas (638 s), com as 22 sementes fixas de 60 passos (741
  aceitos, 439 recusados, 0 falhas); `npm run ui:check`, 135 testes, 135 aprovados e 0 falhas (271 s), página inicial com
  448 KB de 450 KB; sob demanda, Import 48 KB, Weights 48 KB, Health 24 KB e Reproduction 52 KB de 150 KB.

## 17/11/2026 — Fase 3, DOCUMENTAÇÃO DE ENTREGA (E3.1 a E3.7 e §20)

Só documentos, conferidos contra o código, e dois comentários de código desatualizados (nenhum comportamento mudou): o
título da lista de cenários em `src/TestRunner.js` ("Fases 1 e 2" → "Fases 1 a 3") e o número de comandos da base de
demonstração no cabeçalho de `scripts/medir-trava.js` (391 → 430, o que `npm run trava:medir` contou nesta etapa: média de 121,3 ms por comando no Node, 29% na trava).

- `docs/RELATORIO_FASE3.md` (novo), com a estrutura e a regra de honestidade do relatório da Fase 2: entregas E3.1 a E3.7
  e as transversais (telas sob demanda, aceitação, trava e teste aleatório), com arquivos, testes e estado; contagens reais
  de `npm test` e `npm run ui:check`, por arquivo (os novos e alterados rodados sozinhos; todos conferidos pelo
  registrador); o tamanho da página inicial e de cada tela sob demanda; os cenários da Fase 3 por nível; o que só o dono
  pode executar (PR-06, PR-07, PR-10, PR-11, produtos e protocolos com o veterinário, o modo curral no curral, as telas sob
  demanda no app real, `runAcceptanceTests` com os 23 cenários); decisões; limitações; o teste aleatório (5.100 sementes
  novas na fase, por etapa, 0 falhas do sistema e 5 do modelo do teste) e a revisão independente (29 achados por lente e
  gravidade, todos corrigidos, e o balanço: convergência não demonstrada); o veredito no modelo de 09, seção 10.
- `docs/GUIA_DE_IMPLANTACAO.md`: título das Fases 1 a 3; 38 arquivos (24 `.gs`, 13 `.html`); as tabelas da seção 3 com o
  `WeightService`, as telas `Weights`, `Health` e `Reproduction` (carregadas sob demanda), o `Index` sem a importação e as
  dependências de hoje (tiradas do código); a seção 11.2, atualização para a Fase 3 (backup, enviar o código, `setup` — o
  esquema não muda, e a verificação passa a conferir a cópia do peso das pesagens antigas —, aceitação, o que conferir no
  app, as quatro premissas, como voltar atrás) e o roteiro do modo curral e do diagnóstico no tronco.
- `README.md`: estado das Fases 1 a 3, o que a Fase 3 acrescenta, estrutura e as contagens da última execução.
- `docs/CONTRATOS.md`: conferido por amostra contra o código (a superfície pública de cada namespace e as 65 rotas de
  `Api.rotas()`: 51 canônicas e 14 extras, todas citadas); acrescentadas as funções públicas que não estavam citadas
  (`WeightService.gmdLote` e `origemDaPesagem`; cinco do `HealthService`; oito do `ReproductionService`; os `salvar…(ctx,
  pedido)` de lista, categoria, parceiro e propriedade). Nenhum contrato mudou.
- Documentos da Fase 0 (permitido nesta etapa), onde a implementação contrariou ou estendeu o texto:
  - `00-desenho-base.md`, seção 8, e `08-ux-ui.md` (resumo, seções 5 e 6): o modo curral sai em blocos de até 20 animais,
    cada um um evento com chave própria, e não num evento único ao final (decisão da E3.1: o que já foi pesado não se perde
    quando o sinal cai no meio); entregue para a pesagem e, no mesmo padrão, para o diagnóstico no tronco; a sanidade no
    formulário comum com a revisão pelo servidor; a desmama e a identificação no formulário comum; o que não entrou dentro
    do curral ("Todos do pasto" em grade e "Colar brinco;peso"); as idas ao servidor da pesagem e da vacinação.
  - `01-arquitetura.md`, seção 6.2: a página inicial e as telas sob demanda (risco R-31), com os dois orçamentos; o modo
    curral e o tronco em `Weights` e `Reproduction`, não em `Components`.
  - `10-plano-de-implementacao.md`: seção 4, os arquivos que a Fase 3 também tocou; seção 8, uma linha por entrega E3.1 a
    E3.7 com o estado real e uma linha aberta para a validação na conta do dono; a nota do E2.6 (o modo curral da
    identificação não chegou com a pesagem).
  - `11-riscos-e-premissas.md`: R-08 (gráficos SVG próprios, sem CDN), R-14 (indicadores sem valor com o motivo, n,
    parcial, estimativas rotuladas), R-23 (rascunho e blocos com chave no curral e no tronco), R-24 (o que a Fase 3 fez e
    o modo curral que faltou), R-30 (a identificação), R-31 (as telas sob demanda adotadas: 448 KB de 450 KB na página
    inicial, a contingência NV); PR-06, PR-07, PR-10 e PR-11 entregues com o padrão, confirmação pendente; a tabela de
    decisões.
- Verificado no fim desta etapa: `npm test`, 809 testes, 809 aprovados e 0 falhas (598 s), com as 22 sementes fixas de 60 passos (741 aceitos, 439 recusados, 0 falhas); `npm run ui:check`, 135 testes, 135 aprovados e 0 falhas (268 s), página inicial com 448 KB de
  450 KB (sobram 2.511 bytes); sob demanda, Import 48 KB, Weights 48 KB, Health 24 KB e Reproduction 52 KB de 150 KB. Os 32
  arquivos de teste novos ou alterados na Fase 3, mais `static` e `revisao4.interface`, rodados sozinhos (375 testes, 0
  falhas), e os 9 de navegador novos ou alterados (67 testes, 0 falhas); a contagem dos 98 arquivos conferida pelo
  registrador. No começo da etapa, antes de qualquer mudança, as duas suítes tinham dado o mesmo (809 e 135, 0 falhas).
  Nada validado na conta do dono.

## 17/11/2026 — Fase 3, conserto da revisão (rodada 2: 25 achados, 8 altos, 15 médios e 2 baixos)

Cada achado tem teste por caminho que falha com o `src/` de antes da rodada (conferido rodando os testes novos sobre uma cópia
do commit `e056bf6`: os 14 de Node e os 10 de navegador falham lá) e passa agora. Os testes ficam em
`tests/revisao2.fase3.motor.test.js`, `tests/revisao2.fase3.zootecnia.test.js` e `tests/ui/revisao2.fase3.test.js`. Os 25
foram corrigidos; seis grupos são o mesmo defeito visto por mais de uma lente (1 e 4; 2 e 5; 6 e 11; 13 e 21; 15 e 23; 7, 16
e 22): 18 distintos.
Contratos em `docs/CONTRATOS.md`, seção 44.

- **Dose por peso congelada na correção** (achados 1 e 4; `EventService.doseDoOriginal_`): corrigir outro campo da aplicação por
  peso (o veterinário, o lote) mantém a dose gravada de cada animal, a saída, o custo e o saldo, mesmo com a pesagem lançada
  depois ou o peso de referência e a validade do peso mudados; mudar a dose por kg, a data ou o produto refaz pelo peso na data.
  A revisão diz "a dose gravada no original".
- **Contagem do estoque** (achados 2 e 5): o acerto pela contagem vale como o saldo do fim do dia contado. O movimento que mudaria
  esse saldo (a aplicação esquecida, a entrada retroativa, a perda ou a contagem anteriores, o estorno e a correção da
  quantidade) é recusado com `CONTAGEM_POSTERIOR` e o caminho (estornar a contagem, lançar, contar de novo), também na importação;
  a verificação confere o saldo contado (COPIAS sem "dado mexido à mão"), e a trava recusa o desfazer da importação que o mudaria.
- **Quantidade do frasco em parte** (achado 3): na importação de sanidade com a quantidade que saiu do frasco e uma linha já
  lançada, as outras ficam com `QUANTIDADE_EM_PARTE`.
- **Entrada de estoque apagada à mão** (achado 8): a entrada congela `com_movimento` no payload; sem o movimento previsto, a
  verificação acusa a fonte quebrada (sem reparo), o produto entra na quarentena e o aviso não fala mais em "compra lançada
  antes de ligar o controle".
- **Na data** (achados 6, 11, 7, 16 e 22): `reproducao.matrizes` diz quem tinha cria ao pé na data (`Timeline.criaAoPeEm`); o
  `inventario.elegiveis` devolve o brinco em uso na data (`Timeline.brincoEm`) e o de hoje. O curral e o tronco com data passada
  acham o animal pelo brinco daquele dia na posição do servidor (o tronco passou a consultá-la), nunca entregam o número livre no
  dia à dona de hoje, e "Corrigir o brinco" confere pela mesma posição.
- **Agenda numa data passada** (achado 10): só os protocolos que já valiam (o cadastro, ou a primeira aplicação com ele se antes).
  O vencimento segue o de 03a, seção 4.9 (o nunca aplicado deve desde que ficou elegível, também no dia do cadastro). A tela diz
  que os protocolos são os ativos hoje.
- **Peso** (achados 12, 13, 21, 19 e 20): a estimativa visual fica estimada no peso médio e na UA (parte própria, rotulada) e na
  ficha; o GMD da resposta do registro é o do intervalo da ficha (a média do lote no meio e a segunda pesagem do dia não o
  escondem), com o porquê verdadeiro quando vazio; as pesagens e o ganho de lote do desempenho seguem os filtros; a linha gravada
  do curral rotula o ganho "contra peso estimado".
- **Desmama** (achado 14): a correção da desmama legítima é aceita depois de mudar a idade de desmama de referência.
- **Produto sem custo** (achado 9): a revisão da entrada e a da aplicação dizem que o que foi pago nunca vira custo e mandam
  preencher o custo no cadastro (a regra de 03a, seção 4.6, e do desenho-base 16.9 fica).
- **Curral e tronco** (achados 15, 23, 17, 25, 18): "Desfazer o último" num bloco com aviso devolve as outras linhas à fila, e a
  mensagem diz o que aconteceu; "Está certo" sem bloco devolve a linha à fila; o aviso geral do lançamento é um "Está certo" só;
  o animal sem brinco é achado pelo código interno e por "Pesar este"; a Início traz em segundo plano as telas do curral e do
  tronco, que abrem depois sem sinal, e avisa quando não vieram.
- **Reprodução** (achado 24): a tabela dos indicadores por categoria rotula "(parcial)".
- **Aceitação** (`TestRunner`): o cenário ESTOQUE estorna a contagem antes da vacinação anterior a ela (com a recusa primeiro), e o
  SANIDADE lança a primeira aplicação do protocolo de brucelose em D0+41, para a agenda das datas passadas contar com ele.
- **Teste aleatório** (`tests/apoio-fuzz.js`): oráculos novos da dose por peso congelada (na correção e na correção tardia, com o
  preparo "pesagem lançada depois da aplicação por peso"), da cria ao pé de cada fêmea hoje e numa data passada, do GMD da
  resposta do registro (pelo `intervalosModelo`) e da agenda com o protocolo que já valia.
- Testes anteriores ajustados ao contrato novo, sem enfraquecer: `tests/estoque.test.js` e `tests/revisao.fase3.motor.test.js` (o
  payload da entrada traz `com_movimento`), `tests/pesagem.test.js` (a anterior traz `metodo` e `estimado`),
  `tests/pastures.test.js` (a parte `estimativa_visual` da UA), `tests/regras.fase3.test.js` (os protocolos do RN-058 cadastrados
  antes das datas consultadas), `tests/ui/sobdemanda.test.js` (a Início traz as telas do curral e do tronco).
- Antes de terminar, a regra do achado 10 foi reconferida contra 03a, seção 4.9, e contra o teste de tela da agenda
  (`tests/ui/sanidade.test.js`, "os 4 animais nunca vacinados: atrasados desde que ficaram elegíveis"): o vencimento do
  INTERVALO_DIAS nunca aplicado ficou o do animal (o dia em que ficou elegível), sem a data do cadastro do protocolo; o conserto
  do achado é só não contar, numa data passada, o protocolo que ainda não valia nela. `tests/sanidade.agenda.test.js` voltou ao
  original.
- Teste aleatório, 300 sementes novas de 100 passos no código final (1960000 a 1960299): 17.839 comandos aceitos, 9.884 recusados
  e 0 falhas (três levas de 100, 736 a 739 s cada). A leva anterior (1950000 a 1950299, antes da reconferência da agenda) também
  deu 0 falhas (17.277 aceitos, 9.999 recusados).
- Verificado no fim: `npm test`, 823 testes, 823 aprovados e 0 falhas (908 s, com o teste aleatório rodando ao lado), com as 22
  sementes fixas de 60 passos (743 aceitos, 438 recusados, 0 falhas); `npm run ui:check`, 145 testes, 145 aprovados e 0 falhas
  (286 s), página inicial com 448 KB de 450 KB; sob demanda, Import 48 KB, Weights 52 KB, Health 25 KB e Reproduction 58 KB de
  150 KB. Os 14 testes Node novos (`tests/revisao2.fase3.motor.test.js` e `tests/revisao2.fase3.zootecnia.test.js`) e os 10 de
  tela (`tests/ui/revisao2.fase3.test.js`) falham no código anterior (e056bf6) e passam agora.

## 17/11/2026 — Fase 3, conserto da revisão (rodada 3: 25 achados, 5 altos, 14 médios e 6 baixos)

Cada achado tem teste por caminho que falha com o `src/` de antes da rodada (conferido rodando os testes novos sobre uma cópia
do commit `f2cb5fb`: os 14 de Node e os 13 de navegador falham lá) e passa agora. Os testes ficam em
`tests/revisao3.fase3.motor.test.js`, `tests/revisao3.fase3.zootecnia.test.js` e `tests/ui/revisao3.fase3.test.js`. Os 25
foram corrigidos; nenhum refutado nem adiado. Três pares são o mesmo defeito visto por duas lentes (8 e 25; 11 e 18; 21 e 23).
Contratos em `docs/CONTRATOS.md`, seção 45.

- **Carência padrão do produto** (achado 1; `EventService.cabecalhoSanidade_`): sem os dias informados, a aplicação com produto do
  cadastro usa `carencia_padrao_dias` — no formulário, na API, na correção e na importação sem a coluna da carência; o 0 é "sem
  carência". A venda para abate dentro dela volta a ser bloqueada (`CARENCIA_ATIVA`).
- **Curral e tronco** (achados 2, 3, 4, 5, 9, 8/25, 22): "Mudar data, método ou pasto/estação" some assim que um bloco sai (é
  refeito a cada desenho); cada bloco guarda o cabeçalho de quando foi criado e reenvia sempre o mesmo conteúdo; a recusa que não é
  falta de sinal (IDEMPOTENCY_MISMATCH, DENIED, NOT_FOUND, INTERNAL) vira pendência com o motivo e a mensagem do servidor, sem
  travar a fila. Com data passada e sem a posição do servidor (sem sinal), o brinco não é resolvido pela posição de hoje: a linha
  fica pendente, "Tentar de novo" traz a posição e confere as que esperavam; com a data sem posição por motivo do servidor (antes do
  marco zero), o servidor decide. O botão "Prenhe" grava prenhe. O código interno acha só o animal sem brinco na data (escrito
  inteiro). A conferência com data passada descreve o animal naquele dia (`inventario.elegiveis` traz a categoria e o último peso
  até a data). A linha gravada escreve o GMD com o intervalo dele (`resultadoDoEvento.gmd_intervalo`) e o porquê do GMD vazio
  sempre que há anterior.
- **Na data e mesma conta** (achados 6, 7, 11/18, 20): as próximas doses da ficha usam a entrada no rebanho da linha do tempo (a
  da agenda); os partos da lista de Fêmeas são os da ficha (`contarPartos`); `Timeline.brincoEm` trata o número corrigido por
  IDENTIFICACAO_INCORRETA como vigente desde o início do errado; a fêmea apta com NAO_APTA gravado aparece como "Sem histórico
  reprodutivo" (e o filtro "Não apta" não a traz).
- **Integridade e recusas** (achados 10, 12): a checagem da desmama lê a mãe pela reconstrução (a projeção mexida à mão é PROJECAO,
  reparável); a morte ou venda retroativa da mãe posta na desmama diz o caminho que funciona (estornar a desmama, gravar, desmamar
  de novo).
- **Estoque e custo** (achados 16, 17, 19): a contagem vale na posição dela dentro do dia (a ordem de registro; o substituto no lugar
  do original) — o movimento do mesmo dia gravado depois dela é aceito; o mesmo na correção da contagem, no estorno, na importação
  e na verificação. A revisão da correção diz o que o servidor grava: a entrada sem movimento continua fora do saldo
  (`fora_do_estoque`), e a aplicação gravada sem custo mantém o custo daquele dia (`consumo.porque_sem_custo`).
- **Telas de indicadores e desempenho** (achados 13, 14, 15): a lista da estação diz "(parcial)" na natalidade, na desmama e na
  mortalidade até a desmama, com o motivo do servidor; pastos com o mesmo nome em propriedades diferentes têm rótulo único
  (`por_pasto[].rotulo`) e não se fundem no gráfico; "Comparar a curva" acha a vaca pelo brinco inteiro mesmo com bezerro sem
  brinco.
- **Fuso e textos** (achados 21/23, 24): o dia do cadastro do protocolo e o da mensagem de arquivo repetido na importação são os do
  fuso da fazenda; o aviso de lotação diz de onde vem a parte estimada da UA (`ua.rotulo`).
- **Teste aleatório** (`tests/apoio-fuzz.js`): oráculos novos da carência padrão do produto (no efeito da SANIDADE e na
  importação), da contagem pela posição no dia, do intervalo do GMD da resposta da pesagem (GMD = ganho ÷ dias do mesmo
  intervalo do modelo), das próximas doses da ficha iguais às pendências da agenda, dos partos da lista de Fêmeas iguais aos da
  ficha, do rótulo único dos pastos no desempenho, do último peso na data em `inventario.elegiveis` e do dia do cadastro do
  protocolo no fuso da fazenda; as interações novas "movimento do mesmo dia depois da contagem" e "aplicação sem os dias de
  carência, com a carência do cadastro" (com o preparo de cada uma); as sementes fixas passam a 23 (entrou a 29: com as
  interações novas no sorteio, nenhuma das 22 chegava à correção tardia com o cadastro mudado) e exigem também que a ficha ×
  agenda, os partos, o último peso na data e o GMD da resposta confiram algo; `FUZZ_COBERTURA=1` imprime a cobertura dos
  oráculos.
- Testes anteriores ajustados ao contrato novo, sem enfraquecer: `tests/pesagem.test.js` (a resposta traz `gmd_intervalo`) e
  `tests/pastures.test.js` (o aviso de lotação diz "UA estimada em parte: 1 cabeça(s) sem pesagem, pelo peso de referência da
  categoria", o rótulo da composição).
- Teste aleatório, 300 sementes novas de 100 passos no gerador final (2050000 a 2050299, três levas de 100 em paralelo, 712 a
  759 s cada): 17.190 comandos aceitos, 10.199 recusados e 0 falhas; nelas, 22 aplicações com a carência do cadastro, 26
  interações da carência e 13 do movimento depois da contagem (2 contagens corrigidas com movimento do mesmo dia gravado depois),
  1.749 GMD de resposta conferidos (6 com o intervalo antes da pesagem anterior), 40.903 conferências ficha × agenda, 34.481 de
  partos e 52.478 de último peso na data. Antes, 300 sementes (2040000 a 2040299) com o gerador intermediário (a edição de produto
  também mudava a carência; voltou ao original para as sementes fixas manterem a cobertura): 17.587 aceitos, 10.013 recusados, 0
  falhas; e duas levas de prova (2030000 a 2030011 e 2031000 a 2031015, 100 passos): 0 falhas.
- Durante a rodada, um processo de salvamento automático fora desta sessão gravou commits intermediários ("salva revisão em
  andamento"); esta etapa não fez commit nem push.
- Verificado no fim: `npm test`, 837 testes, 837 aprovados e 0 falhas (826 s), com as 23 sementes fixas de 60 passos (826
  aceitos, 443 recusados, 0 falhas); `npm run ui:check`, 158 testes, 158 aprovados e 0 falhas (309 s), página inicial com 448 KB
  de 450 KB; sob demanda, Import 48 KB, Weights 55 KB, Health 25 KB e Reproduction 62 KB de 150 KB. No começo da etapa, antes de qualquer mudança (cópia do commit `f2cb5fb`): `npm test`,
  823 testes, 823 aprovados e 0 falhas (698 s).

## 17/11/2026 — Fase 3, relatório com as rodadas 2 e 3 da revisão

Nenhuma linha de código mudou nesta etapa: só documentos.

- `docs/RELATORIO_FASE3.md`, seção 6: as rodadas 2 (25 achados, 18 distintos; 8 altos, 15 médios e 2 baixos) e 3 (25
  achados, 22 distintos; 5 altos, 14 médios e 6 baixos), por lente e gravidade, com a decisão de cada achado (todos
  corrigidos; nenhum refutado nem adiado) e, para as rodadas 1 e 2, quais consertos a rodada seguinte achou incompletos
  (5 de 28 e 10 de 18); o teste aleatório das duas rodadas (1.228 sementes novas, 0 falhas; 6.328 na fase); e o balanço
  (seção 6.5, nova): a última rodada **não** terminou sem achado alto (5 altos, quatro deles no curral e no tronco), os
  consertos dela não foram revisados, 40% e 52% dos achados das rodadas 2 e 3 eram conserto incompleto ou regressão da
  rodada anterior, e a convergência não está demonstrada. O que continua em aberto está listado lá.
- O mesmo relatório, outras seções: o resumo; as entregas (os testes das rodadas 2 e 3 em cada uma); os números da seção 2;
  o que só o dono pode executar (os casos novos do modo curral e a ratificação das decisões das rodadas 2 e 3); as decisões
  (item 6, porque o servidor passou a preencher a carência padrão do produto; item 14, as 23 sementes fixas; e o novo item
  15, as decisões das rodadas 2 e 3); as limitações (itens 3, 6, 9, 10, 11 e 13, e o novo 15); o veredito.
- Execuções desta etapa, sobre o código da rodada 3 (`src/` do commit `d81c6fd`, testes do `a2828b5`):
  - `npm test` com 837 testes, 837 aprovados e 0 falhas (771,8 s), com as 23 sementes fixas de 60 passos (826 aceitos, 443
    recusados, 0 falhas);
  - `npm run ui:check` com 158 testes, 158 aprovados e 0 falhas (303,1 s); a página inicial com 459.213 bytes (448 KB) de
    460.800, sobrando 1.587 bytes (2.511 na entrega); sob demanda, Import 48 KB, Weights 55 KB, Health 25 KB e Reproduction
    62 KB, de 150 KB cada;
  - rodados sozinhos, todos aprovados com a contagem da tabela: os 37 arquivos do Node novos ou alterados na Fase 3, mais
    `static` e `revisao4.interface`, que leem o `CONTRATOS.md` (410 testes, depois da frase nova do `CONTRATOS.md`), e os 11
    de navegador (90 testes);
  - a contagem dos 104 arquivos de teste (79 do Node e 25 de navegador) conferida sem rodar os corpos (um registrador no
    lugar de `node:test`): 837 e 158;
  - os testes novos das rodadas sobre o `src/` de antes de cada uma: os 14 de Node e os 10 de navegador da rodada 2 falham
    com o `src/` do commit `e056bf6`, e os 14 de Node e os 13 de navegador da rodada 3, com o do `f2cb5fb` (por asserção ou
    pela espera de um elemento que a tela de então não tinha), como as rodadas tinham registrado;
  - `npm run trava:medir -- --vezes 3`: 430 comandos, média de 147,8 ms por comando (p50 141,4; p95 324,2), 18,9 s de
    63,6 s na trava; na entrega, com a mesma base, 121,3 ms.
- `docs/CONTRATOS.md`: o estado ganhou a frase da rodada 3. O arquivo foi conferido por amostra contra o código nas funções
  e campos das seções 44 e 45, sem divergência: `EventService.doseDoOriginal_`, `contagemPosterior_`, `cabecalhoSanidade_`
  com `carencia_padrao_dias`, `itemDesmama_` com `jaDesmamadaNoOriginal`; `HealthService.contagensDoProduto`, `saldoNaPosicao`,
  `contagemAfetada(contagens, antes, depois, ordem)`, `compraSemMovimento` e o `inicio_vigencia` com `Utils.hoje(created_at,
  fuso)` (também no `ImportService`); `AuditService.ordemDoEvento_`, `ENTRADA_SEM_MOVIMENTO` e `ENTRADA_ALHEIA`;
  `Timeline.criaAoPeEm(f, filhos, data)` e `brincoEm(f, id, data)`; `inventario.elegiveis` com `brinco_hoje`, `categoria` e
  `ultimo_peso: {kg, data, estimado}`; `ReproductionService.contarPartos`; `QUANTIDADE_EM_PARTE`; `impactos` com
  `dose_do_original`, `produto_sem_custo`, `fora_do_estoque` e `porque_sem_custo`; `gmd_intervalo`; a parte
  `estimativa_visual` da UA; nas telas, `[data-gmd-explicacao]`, `[data-aceitar-geral]`, `[data-pre-carga]`,
  `[data-posicao-tentar]`, `[data-tronco-posicao]`, `data-conferencia="SEM_POSICAO"`, `prenheDoCampo` e `pctParcial`; as 23
  sementes fixas (com a 29) e `FUZZ_COBERTURA`.
- `docs/CHANGELOG.md`, rodada 2: "seis são o mesmo defeito visto por duas lentes" passou a "seis grupos são o mesmo defeito
  visto por mais de uma lente (...): 18 distintos" (o grupo 7, 16 e 22 tem três lentes).
- `docs/fase-0/10-plano-de-implementacao.md`, seção 8: as rodadas 2 e 3 não mudaram nenhum estado de entrega (E3.1 a E3.7
  continuam entregues, e a validação da Fase 3 na conta do dono continua aberta). O arquivo não mudou.
- Ficaram com números antigos, fora desta etapa: `README.md` (809 e 135 testes; Weights 48 KB, Health 24 KB, Reproduction
  52 KB) e `docs/fase-0/11-riscos-e-premissas.md`, R-31 (Weights 48, Health 24, Reproduction 52 KB e "sobram cerca de 2,5 KB").
- Durante a etapa, o salvamento automático de fora dela gravou parte destes documentos (commit `c17c627`, 10:10, só
  documentos); esta etapa não fez commit nem push.

## 17/11/2026 — Fase 3, conserto pela garantia, etapa 1: viagem no tempo (o estado em D)

Por quê: as três rodadas de revisão da Fase 3 (29, 25 e 25 achados; 14, 8 e 5 altos) repetiram duas classes de defeito, consertadas
caso a caso. Esta etapa trata a primeira — número ou estado pedido numa data passada calculado com o dado de hoje — por uma
propriedade conferida em todos os caminhos de consulta com data, um ponto único de leitura do estado em D e um oráculo no teste
aleatório (`docs/CONTRATOS.md`, seção 46). A segunda classe (os estados do curral e do tronco) fica para a etapa seguinte.

- Inventário (seção 46): as 29 rotas CONSULTA — as que recebem data (`inventario.posicao`, `inventario.elegiveis`,
  `pasto.listar`, `pasto.painel`, `sanidade.agenda`, `reproducao.indicadores`, `reproducao.matrizes`, `peso.desempenho`,
  `dashboard.obter`, `evento.listar`), a ficha (a data de referência: hoje no rebanho, a da saída para quem saiu), as que são de
  hoje por desenho (`animal.listar`, `evento.obter`, `alerta.listar`) e as que só mostram registros —, a importação (a data da
  linha e o marco zero) e os cálculos do servidor com data; para cada uma, o que é "em D" e o que o desenho manda ler como está
  hoje, com a fonte no desenho (desenho-base 4.3 e 16.2; 02, política `escrita`; 03a, seções 4.9, 4.10, 4.12 e DL-08; 05,
  RN-058 e seção 4.9; 07, seção 8.1).
- Propriedade: a resposta numa data D é função só dos fatos até D (com as correções que valem para todo o histórico) e dos
  cadastros que o desenho manda ler como estão hoje; um fato depois de D (também estorno e correção) e um cadastro que não vale
  para o passado não a mudam; um fato retroativo muda só o que alcança; ela não depende da data de hoje; e em D = hoje o caminho
  sem data é o mesmo que o caminho com a data.
- Ponto único: `Timeline.fonteAte(f, data)` (a fonte restrita aos fatos até D), `Timeline.retratoEm(f, id, data, filhos)` (o
  MESMO projetor do estado de hoje sobre os fatos até D, com o brinco e a cria ao pé de D), `Timeline.periodosDeBrinco(f, id)` (os
  períodos de cada número pela sequência de `brincoEm`, com a regra 16.2) e `AnimalService.retratoEm(L, a, data)` (memorizado;
  em D = hoje, a projeção gravada). `InventoryService.presentes`/`presentesNoDia` entregam `animal` (o retrato, calculado na
  primeira leitura) e `registro` (a projeção de hoje); as contas de cabeças, categoria e peso leem `registro` e não pagam o
  retrato.
- Consertos (cada um com teste em `tests/tempo.regressoes.test.js` que falha com o `src/` de antes, commit `d72e518`):
  o brinco de hoje nas listas de uma data passada (painel e dias de permanência do pasto, agenda, fêmeas, linhas do desempenho);
  a situação e o pasto de hoje nas linhas do desempenho de um período passado; a estação padrão dos indicadores e a lista de
  fêmeas da estação contando registros depois de D; o pasto desativado depois que sumia da lista de pastos da data em que tinha
  animal; a ficha de quem saiu com a carência pelo relógio e a cria ao pé de hoje (agora as da data da saída); e a importação
  (manejo, eventos e a mãe e o pai do rebanho inicial) achando o dono do número pelos períodos gravados de IDENTIFICACOES, sem a
  regra 16.2 (agora `Timeline.periodosDeBrinco`, o mesmo animal que a posição daquela data; a validação da importação de ANIMAIS
  passou a ler EVENTOS com acesso cru). O arquivo de regressão tem 16 testes (8 cenários pela api e 8 sequências mínimas do teste
  aleatório): com o `src/` de antes, 14 falham; os 2 do modelo do teste (a volta ao rebanho e o estorno imediato com a política
  do estoque, abaixo) passam nos dois.
- Oráculo de viagem no tempo (`tests/apoio-fuzz.js`, `oraculoTempo`; seção 36): num passo sorteado por um gerador à parte (as
  sequências das sementes não mudaram: as 23 sementes fixas dão os mesmos 826 aceitos e 443 recusados), o retrato de uma bateria
  de consultas em D, por unidade (a consulta ou a linha de um animal) com a impressão digital do que ela pode ler; depois de cada
  passo que grava, a comparação das unidades com a impressão inalterada; no passo do retrato, o relógio adiantado (1, 31, 200 ou
  400 dias), o caminho padrão em D = hoje, a lista de pastos da data e a ficha cruzada com as consultas da data; e, a cada passo
  que grava, o retrato de hoje = a projeção em todo campo projetado. As exceções por desenho estão no oráculo e na seção 46. As
  sementes fixas exigem os onze contadores principais do oráculo (`FUZZ_COBERTURA=1`); nelas, 109 retratos, 23.425 unidades com o
  relógio adiantado, 97.205 unidades comparadas e 6.449 retratos de hoje conferidos com a projeção.
- Leva de busca (3110000 a 3110039, 40 sementes × 100 passos, com o código de antes dos consertos): 1.797 aceitos, 997 recusados
  e 15 falhas — 13 do código em 6 classes (o brinco de hoje no painel, 3; as fêmeas da estação, 2; a situação e o pasto de hoje no
  desempenho, 5; a carência da ficha pelo relógio, 1; o pasto que sumia, 1; a cria ao pé da ficha, 1) e 2 do modelo do teste (a
  volta ao rebanho leva a ficha para hoje, por desenho: refutadas, e o oráculo passou a pôr a situação e a saída de hoje na
  impressão da ficha). As 15 sequências, as mínimas e as inteiras, se repetem sem falha com o código final (7 delas fixas no
  arquivo de regressão). Depois dos consertos, com o código de então: 3120000 a 3120079 (80 × 100): 4.590 aceitos, 2.738
  recusados, 0 falhas.
- Custo: o retrato só é calculado para o animal que a consulta mostra numa data passada (`itemPresente_`); a visão geral (com a
  série mensal), a posição e os cartões dos pastos não calculam nenhum. Na base de demonstração (304 cabeças), numa data de
  2025: os elegíveis calculam 294 retratos, a lista de fêmeas 138, o desempenho 360 e a agenda 18.
- Uma leva de 1.000 sementes começada às 11:14 com o código intermediário (3200000 a 3200999) abortou aos 40 minutos nas
  quatro partes, com INTERNAL na montagem do sistema de uma semente: uma edição em curso de `InventoryService` (a contagem por
  categoria lendo `registro`, que o item montado pelo aviso de lotação do motor não tem; a versão final lê `semData_`) entrou
  nas sementes que começaram naquele minuto (o teste aleatório lê o `src/` a cada semente). Nenhuma falha foi registrada nas
  sementes que ela rodou, mas o resumo só sai no fim: a leva foi descartada e refeita inteira com o código final congelado
  (abaixo).
- Leva de 1.000 sementes com o código final congelado (o `src/` de 11:55, sem mudança desde então; 3400000 a 3400999, 100 passos,
  4 processos, 65 minutos): 58.341 aceitos, 33.470 recusados e 1 falha. Na viagem no tempo: 7.254 retratos, 1.646.617 unidades
  conferidas com o relógio adiantado, 1.038 caminhos padrão em D = hoje, 7.008.184 unidades comparadas (depois de fato posterior
  a D, 14.241 vezes; de estorno ou correção posterior a D, 6.480; de cadastro, 14.847; de fato retroativo noutros animais,
  18.447), 5.493 fichas de hoje e 7.037 fichas de quem saiu cruzadas com as consultas da data e 418.487 retratos de hoje
  conferidos com a projeção — nenhuma falha do tempo. A falha (semente 3400390, `ESTORNO_IMEDIATO:RECUSADO`) é do modelo do teste
  e fora da viagem no tempo: o consumo acima do estoque aceito com a política AVISA, a política de ESTOQUE_INSUFICIENTE mudada
  para BLOQUEIA, a entrada do produto registrada e estornada logo em seguida; sem a entrada, o estoque volta a -10 mL em 13/11,
  mais baixo que agora, e o servidor recusa o estorno como o desenho manda (RN-057 com a política; `docs/CONTRATOS.md`, seção 39).
  Refutada como defeito do sistema: o oráculo do estorno imediato passou a aceitar essa recusa quando o modelo a confirma
  (`estornoBloqueadoPeloEstoque`; seções 36 e 46), e a sequência mínima (4 passos) entrou no arquivo de regressão, com a recusa
  fixada (`VALIDATION:ESTOQUE_INSUFICIENTE`).
- Leva nova limpa, com o código final e o oráculo corrigido (3500000 a 3500199, 200 sementes × 100 passos): 11.985 aceitos,
  6.531 recusados, 0 falhas; na viagem no tempo, 1.470 retratos, 335.270 unidades com o relógio adiantado, 1.454.080 unidades
  comparadas e 89.258 retratos de hoje conferidos com a projeção.
- Verificado no fim, com o código final: `npm test`, 853 testes, 853 aprovados e 0 falhas (873,7 s), com as 23 sementes fixas de
  60 passos (826 aceitos, 443 recusados, 0 falhas, e os onze contadores do oráculo do tempo); `npm run ui:check`, 158 testes,
  158 aprovados e 0 falhas (302,9 s), a página inicial com 448 KB de 450 KB e, sob demanda, Import 48 KB, Weights 55 KB,
  Health 25 KB e Reproduction 62 KB de 150 KB (nenhuma tela mudou nesta etapa). Antes da etapa: 837 e 158.
- `docs/CONTRATOS.md`: o estado ganhou a frase desta etapa; seção 46 nova (a propriedade, o ponto único, o inventário das rotas
  e dos cálculos com data, as exceções por desenho, os consertos e o oráculo); os contratos de `pasto.listar`,
  `inventario.elegiveis`, `reproducao.indicadores`, da validação das importações (o dono do brinco na data) e do oráculo do
  estorno imediato (seção 36) dizem o que mudou. `docs/fase-0/` não mudou.
- Durante a etapa, o salvamento automático de fora dela gravou estados intermediários (commits `9194f61`, `7336a70`, `da538ec`,
  `a9e05b6`, `e4a7e11` e `8dc5c35`, "salva convergência em andamento"); esta etapa não fez commit nem push.

## 17/11/2026 — Fase 3, conserto pela garantia, etapa 2: resolvedor único da posição na data

Por quê: os achados "conserto incompleto dos achados 7, 16 e 22" voltaram nas três rodadas de revisão — o brinco, o pasto, a
categoria e o último peso de um animal numa data passada resolvidos de jeitos diferentes no curral, no tronco, no seletor, na
importação e na conferência (a consulta que falhava sem sinal, o número lançado errado, o código interno parecido com brinco, o
reuso). Esta etapa troca o caso a caso por UM resolvedor no servidor e faz todos os caminhos usarem só ele
(`docs/CONTRATOS.md`, seção 47).

- `src/Identificacao.js` (novo, puro): `indice` (os períodos de cada número pela regra única de `Timeline.periodosDeBrinco`,
  os números lançados errado, os códigos internos e os nomes dos animais de referência), `resolver` (texto e data → ACHADO,
  VARIOS ou RECUSADO com o porquê: o número em uso em D; o código interno inteiro, ou o atalho só do animal sem brinco em D; o
  histórico de antes do marco zero pelo número do marco zero; ANTES_DO_USO, SEM_USO, LANCADO_ERRADO, CODIGO_DE_ANIMAL_COM_BRINCO,
  NAO_ENCONTRADO), `descrever` e `estadoEm` (animal e data → brinco, pasto, categoria, situação, presença, último peso e o
  porquê de não servir) e a rota `animal.resolver` (CONSULTA). `Timeline.brincosLancadosErrado` (da mesma cadeia da regra única).
- `inventario.elegiveis` monta cada item por `Identificacao.descrever` (a mesma descrição da conferência do curral e do tronco).
- `ImportService`: o rebanho inicial (a mãe e o pai no marco zero), os importadores de eventos e de manejo e a conferência do fato
  já gravado acham o animal pelo resolvedor único (antes, `donoDoBrinco_`/`acharAnimal_`/`referencia_`/`progenitorNaBase_`, com
  regras próprias). Na compra, a coluna do brinco é o número do animal comprado: o texto lido como código ou nome é um brinco novo.
- Cliente: `Store.resolverBrinco` e os índices por brinco do aparelho saíram; `Store.resolver` (a rota, guardada por versão dos
  dados, data e tipo), `Store.buscar` (o texto pelo servidor; o nome pela lista do aparelho só quando o servidor responde "não
  encontrado") e `Store.doEstado`. O curral e o tronco perguntam ao servidor no Enter do brinco e o lançamento espera a resposta;
  sem resposta, a linha fica pendente (`SEM_POSICAO`) e vai ao servidor no "Tentar de novo", no botão novo "Conferir os brincos
  pendentes no servidor" e na próxima conferência respondida — nunca pela lista de hoje. "Corrigir o brinco" também. O seletor
  (busca e "Colar lista"), a busca do topo, o campo de animal dos formulários (na data do lançamento) e o "Comparar a curva" usam o
  mesmo pedido. Decisão: o desenho (08, seção 5) resolvia o brinco "no store, sem ida"; esta etapa manda o contrário (seção 47).
- Testes novos: `tests/resolvedor.unico.test.js` (2 testes: 19 casos difíceis × curral, tronco e seletor pela rota, a
  conferência pela posição da data com a mesma descrição e a importação de verdade; e a rota), `tests/ui/resolvedor.test.js`
  (2 testes: a mesma tabela no curral, no tronco e no seletor da tela) e o apoio comum `tests/apoio-resolvedor.js`. Com o `src/`
  de antes (`8dc5c35`), a importação divergia do resolvedor em 5 dos 19 casos (a pesagem do 1457 de 10/11 na vaca que só o recebeu
  em 11/11; a vaca pelo código inteiro e a cria sem brinco pelo código, não achadas; a cria achada pelo 0901 antes de nascer).
- Testes de tela ajustados ao pedido ao servidor (nenhum enfraquecido): `A.enter` (o Enter que espera a resposta) no curral e no
  tronco; os dois "sem sinal" da rodada 3 cortam também a conferência do brinco (`falharTransporte = 2`); os dois "achado 12"
  conferem o 20º brinco com sinal antes de o sinal cair; o "Colar lista" espera a resposta.
- Oráculo novo do teste aleatório (`tests/apoio-fuzz.js`; seção 36): `oraculoResolucao` no passo sorteado da viagem no tempo, em D
  e hoje (os textos difíceis do modelo pelos quatro caminhos da rota — `RESOLVER:CAMINHOS` —, cada número da posição da data no
  animal do resolvedor e com a mesma descrição — `RESOLVER:POSICAO`, `RESOLVER:CONFERENCIA`) e `oraculoResolucaoImportacao` ao
  concluir uma importação (`RESOLVER:IMPORTACAO`). As sementes fixas exigem os quatro contadores novos; as sequências não mudaram.
- Leva nova com o oráculo (3600000 a 3600199, 200 sementes × 100 passos, 4 processos): 11.651 aceitos, 6.731 recusados, 0
  falhas; o resolvedor conferido em 121.556 textos pelos quatro caminhos, 14.716 números da posição, 15.332 animais descritos
  igual na posição e 93 linhas importadas no animal do resolvedor (1.476 retratos da viagem no tempo). Nas 23 sementes fixas de
  60 passos (826 aceitos, 443 recusados, 0 falhas, as mesmas sequências de antes): 8.735 textos, 1.346 números da posição, 1.420
  animais descritos e 6 linhas importadas.
- Verificado no fim, com o código final: `npm test`, 855 testes, 855 aprovados e 0 falhas (814,9 s); `npm run ui:check`, 160
  testes, 160 aprovados e 0 falhas (311,3 s), a página inicial com 460.759 bytes de 460.800 (450 KB; sobram 41 bytes: o
  resolvedor do aparelho saiu, a pergunta ao servidor entrou) e, sob demanda, Import 48 KB, Weights 54 KB, Health 25 KB e
  Reproduction 61 KB de 150 KB. Antes da etapa: 853 e 158.
- `docs/CONTRATOS.md`: o estado ganhou a frase desta etapa; seção 47 nova (a regra, o índice, o animal em D, a rota, a tabela dos
  caminhos, a decisão da ida ao servidor, os testes e o oráculo); a tabela da seção 46 diz que a importação acha o animal pelo
  resolvedor e traz a linha de `animal.resolver`. `docs/fase-0/` não mudou.
- Durante a etapa, o salvamento automático de fora dela gravou um estado intermediário (commit `390a790`, "salva etapa de
  posição em andamento"); esta etapa não fez commit nem push.

## 17/11/2026 — Fase 3, conserto pela garantia, etapa 3: fuzz de interface do curral e do tronco

Por quê: o cliente do curral e do tronco (a tela de lote com fila no aparelho, blocos idempotentes e rede caindo) teve achado alto
nas três rodadas de revisão, consertado caso a caso. Esta etapa troca o caso a caso por um teste aleatório da tela de verdade
contra um modelo, com as garantias da fila de lote escritas e conferidas a cada ação (`docs/CONTRATOS.md`, seção 48).

- `tests/ui/curral.fuzz.test.js` (novo): Playwright contra o mock de `google.script.run` ligado ao backend real; gerador com semente
  de ações do usuário no curral e no tronco (brinco válido, sem zeros, trocado, de outro pasto, de quem saiu, inválido, código
  interno; peso e resultado pelo teclado e pelo botão, válidos e inválidos; o lote depressa com o bloco de 20; desfazer, tirar,
  corrigir, "Está certo", enviar, mudar data, método, pasto ou estação, terminar, recarregar, sair e voltar, o tempo passar,
  outro usuário gravando) intercaladas com falhas de rede decididas no Node (resposta perdida depois de gravar, pedido perdido
  antes de chegar, transporte antes e depois de gravar, resposta e pedido segurados e soltos fora de ordem, servidor ocupado,
  falha interna); modelo do que deve estar gravado e na fila; oráculo a cada ação (tela = aparelho = rascunho; as linhas digitadas,
  com o valor e o animal do texto na data da sessão; nada gravado duas vezes, nada gravado que a tela diga não gravado; a mensagem
  de cada recusa na tela; nada preso depois de o tempo passar) e no fim (banco = modelo, integridade sem erro, projeção =
  reconstrução, nada no console). Nada depende do tempo real (o teste anda o relógio da página). `tests/ui/apoio-curral.js`
  (novo): o rebanho, a rede e a leitura da tela. `tests/ui/apoio.js`: `abrir(s, {servidor})`; `tests/ui/mock-gas.js`: as respostas
  `{"__mock":"perdida"}` e `{"__mock":"transporte"}` vindas do Node.
- Defeitos achados e consertados pela causa (`Weights.html` e `Reproduction.html`), cada um com regressão em
  `tests/ui/curral.fuzz.regressoes.test.js` (7 testes; todos falham com o `src/` de antes da etapa, commit `ee1b2cd`, e passam
  com o de agora):
  1. "Mudar data" com linhas na fila mantinha o animal resolvido na data antiga (curral e tronco; achado na primeira semente): com
     o 0457 trocado em 11/11 e reaproveitado em 12/11, a pesagem de 04/11 ia para a vaca B. Agora cada linha guarda o texto
     digitado e a data em que foi resolvida; mudar a data confere de novo, no servidor e na data nova, toda linha não gravada
     (`sessaoMudou`), e nenhuma linha resolvida em outra data entra num bloco (`naFila`). Mudar a sessão também desfaz os blocos com
     aviso (levavam o cabeçalho de antes).
  2. A falha interna do servidor no reenvio de um bloco que uma tentativa anterior já tinha gravado virava "recusada": a chave era
     solta e a linha, corrigida, saía com outra chave e gravava duas vezes. Agora só VALIDATION, NEEDS_CONFIRMATION e CONFLICT
     (que provam que a chave não foi gravada) soltam o bloco; IDEMPOTENCY_MISMATCH (a chave está gravada) deixa só "Tirar"; as
     demais deixam o bloco sem confirmação, com a chave e a mensagem do servidor (`[data-recusa-incerta]`). Decisão: muda a regra
     da seção 45 (soltar em toda recusa que não fosse falta de sinal).
  3. O "Está certo" dado enquanto outro bloco estava no ar deixava as linhas na fila com o "Enviar" desligado (o envio em curso
     tinha a lista de blocos de antes, e a conta do botão não via o bloco com o aviso aceito). Agora o envio escolhe o próximo
     bloco pronto a cada volta, e o botão conta esse bloco.
  4. Sair e voltar com o envio no ar: a resposta não redesenhava a tela nova, e a volta conferia o mesmo bloco por outro caminho
     ao mesmo tempo (achado na leitura do código para o modelo). Agora o envio redesenha a tela aberta (`telaAtual`), e a
     conferência na volta espera o envio no ar (um envio de cada vez).
  5. Tronco: a recusa do servidor à conferência de um bloco (`operacao.status`) ia ao console como erro e não aparecia; agora fica
     na tela com a mensagem (curral e tronco).
  6. A linha pendente barrada por outra linha do mesmo animal ficava pendente para sempre, dizendo "tire um dos dois" depois de a
     outra sair; agora continua esperando e entra na fila quando a outra é tirada.
- Testes de tela ajustados à decisão 2 (nenhum enfraquecido): o "achado 2" do curral (`tests/ui/revisao3.fase3.test.js`) exige a
  mensagem nova e a ausência de "Corrigir o peso" na linha da chave já gravada; o do tronco exige a falha interna com a mensagem
  do servidor, sem "Sem sinal", sem "Tirar" nem "Corrigir" na linha e o reenvio com a mesma chave gravando uma vez.
- Erros do modelo do teste, refutados como defeito do sistema (o oráculo corrigido): a resposta que chega depois do prazo de 45 s
  não é ouvida pelo aparelho (a recusa dela não precisa aparecer); as linhas na fila de um bloco com aviso esperam a decisão do
  aviso; o bloco cheio de 20 sai sozinho (a linha nova pode já estar saindo); a pendência resolvida durante a ação conta como
  linha já existente; a recusa geral (a data antes do marco zero) se resolve mudando a data; e o tempo real (a nova tentativa do
  servidor ocupado e o prazo de 45 s corriam sozinhos e mudavam a sequência entre execuções) passou a ser andado pelo teste.
- Levas durante a etapa: as primeiras (sementes 1 a 16, 1 a 60, 100 a 147, 200 a 259 e 300 a 419, de 40 ações) acharam os defeitos
  1, 2, 3 e 6 acima e os erros do modelo; 500 a 619 e 700 a 819 (40 ações) saíram limpas; 900 a 935 (100 ações) achou o tempo real
  correndo sozinho no teste (7 falhas em duas rodadas, todas do teste: refutadas e corrigidas).
- Leva final, com o código final (`src/` e testes congelados): sementes 1000 a 1149, 150 × 40 ações, 6 processos: 150 aprovadas, 0
  falhas; 7.237 conferências do oráculo (1.883 com o tempo passado, sem nada preso), 3.221 linhas gravadas, 3.790 lançamentos na
  fila, 667 substituições, 236 "Pesar de novo", 229 lotes depressa, 424 envios, 297 recargas, 215 saídas e voltas, 94 mudanças de
  sessão, 274 "Terminar"; recusas do servidor conferidas na tela: 375 avisos, 106 validações e 38 falhas internas; falhas de rede:
  120 respostas perdidas depois de gravar, 63 pedidos perdidos antes, 104 transportes antes e 65 depois de gravar, 72 respostas e
  58 pedidos segurados, 48 servidor ocupado e 83 falhas internas. Sementes 2000 a 2035, 36 × 100 ações: 36 aprovadas, 0 falhas;
  3.968 conferências, 1.190 linhas gravadas.
- Verificado no fim, com o código final: `npm test`, 855 testes, 855 aprovados e 0 falhas (797,1 s; nenhum teste de Node mudou);
  `npm run ui:check` rodado duas vezes seguidas: 173 testes, 173 aprovados e 0 falhas nas duas (399,4 s e 396,2 s), com as 6
  sementes fixas de 40 ações e as 7 regressões; a página inicial com 460.759 bytes de 460.800 (não mudou) e, sob demanda, Import
  48 KB, Weights 56 KB, Health 25 KB e Reproduction 63 KB de 150 KB. Antes da etapa: 855 e 160.
- `docs/CONTRATOS.md`: o estado ganhou a frase desta etapa; seção 48 nova (as garantias da fila de lote e como o código as
  garante, a regra das recusas e a decisão, o redesenho, o teste, o apoio, as regressões e o que o teste não cobre); a seção 38
  diz que a recusa que não prova nada deixa o bloco com a chave, e a 45 aponta a mudança. `docs/fase-0/` não mudou.
- Durante a etapa, o salvamento automático de fora dela gravou estados intermediários (commits `eefe77a`, `c80f3eb`, `a3af10e`,
  `c560bb0` e `63c3ddd`); esta etapa não fez commit nem push.

## 17/11/2026 — Fase 3, conserto da revisão final (17 achados: 7 altos, 9 médios e 1 baixo)

Por quê: a revisão final da Fase 3 achou de novo as duas classes que as rodadas anteriores repetiam — número ou estado numa data
passada calculado com o dado de hoje, e o curral e o tronco com estados inconsistentes — e mais o fato congelado na correção que
ainda copiava o cadastro de hoje. Cada achado foi reproduzido por teste que falha com o `src/` de antes (commit `11b744a`) e
consertado pela causa, apoiado no estado em D (seção 46), no resolvedor único (seção 47) e no teste aleatório da tela (seção 48),
estendidos onde o defeito escapou deles (`docs/CONTRATOS.md`, seção 49). Nenhum achado refutado nem adiado.

- Data passada: a agenda do protocolo restrito a uma categoria vence no dia em que o animal entrou na categoria
  (`AnimalService.naCategoriaDesde`; A CADA N DIAS nunca aplicado, CAMPANHA, ÚNICA; a ficha e o alerta da Início seguem a agenda);
  o histórico de antes do marco zero cita o animal pelo número do marco zero (`Timeline.brincoNaData_`: o desempenho, a descrição
  e os elegíveis iguais ao resolvedor); as mensagens do servidor citam o brinco da data do lançamento (`nomeNaData_`); os
  indicadores anuais recusam o ano que ainda não começou na data (`DATA_FUTURA`); a agenda da tela usa o brinco da data que o
  servidor manda; a lista de pastos de uma data mostra o pasto desativado depois que tinha animal nela; a prévia da correção da
  aplicação reconhece a próxima proposta pelo intervalo congelado no payload.
- Fato congelado na correção: com o mesmo produto, a carência (vazio = a do original, nunca a padrão de hoje), o nome e o
  fabricante do original; o protocolo que o original cumpria continua aceito na correção sem mudança. Decisão: `protocolo.salvar`
  recusa trocar o procedimento de um protocolo já cumprido (`PROTOCOLO_EM_USO`).
- Números com o porquê verdadeiro: o vazio do GMD por categoria e por pasto explica que o ganho conta na categoria do início do
  intervalo (ou nos pastos pelos dias), e a tela diz de onde vêm as cabeças e o ganho; o bezerro descartado antes da desmama conta
  à parte (`descartados_ao_pe`), nunca como vendido ao pé.
- Curral e tronco, garantia nova "o bloco que saiu é intocável no aparelho": `desfazerBloco` recusa o bloco que saiu; toda ação
  confere a linha na hora do clique (o "Substituir o peso" refaz a pergunta se a anterior saiu ou foi gravada enquanto ela estava
  na tela); a tela mostra o bloco saindo antes de guardar a chave no rascunho do servidor; "Mudar data" recusa mudar a sessão com
  bloco que saiu. A conferência do brinco vale só na data em que o servidor deu o animal (a linha carimba essa data; mudar a sessão
  zera a conferência). As pendentes vão na mesma pergunta da conferência e são resolvidas antes da decisão do repetido (o
  resultado não depende da ordem das respostas; o tronco avisa a substituição); a pendente do animal que já tem pesagem gravada
  pede "Está certo" ou "Tirar" sem barrar o envio das outras. A linha cita o brinco da data, e "Corrigir o resultado" confere o
  texto digitado.
- Testes novos: `tests/revisao.final.fase3.test.js` (8 testes) e `tests/ui/revisao.final.fase3.test.js` (13 testes); todos
  falham com o `src/` de `11b744a` e passam agora. A regressão 6 de `tests/ui/curral.fuzz.regressoes.test.js` (instável: dependia
  da ordem das respostas) passou para a sequência determinística das duas pendentes resolvidas juntas, com a mesma garantia.
- Teste aleatório do motor (`tests/apoio-fuzz.js`): o modelo da agenda cobre os protocolos por categoria (a categoria do sistema e o
  trecho nela por força bruta, dia a dia); o efeito da correção da aplicação espera as cópias do original (e confere o fabricante);
  a correção tardia só aceita CARENCIA_ATIVA quando a carência do próprio original cobria a venda; o preparo muda também a carência
  padrão, o nome, o fabricante e o procedimento do protocolo; `oraculoProcedimentoProtocolo` novo. As 23 sementes fixas dão as
  mesmas sequências de antes.
- Teste aleatório da tela (`tests/ui/curral.fuzz.test.js`): o oráculo confere a garantia nova a cada ação; ações novas (as respostas
  chegam com a pergunta do repetido na tela; o brinco conferido sem lançar antes de mudar a sessão); 25% das sementes sem
  `localStorage`, com o rascunho no servidor segurado enquanto o bloco sai (`apoio-curral`: classe de rota `rascunho`).
- Leva do teste aleatório do motor com o código final (sementes 3800000 a 3800299, 300 × 100 passos, 3 processos): 17.747
  aceitos, 9.872 recusados, 0 falhas; a agenda conferida com protocolo por categoria 171 vezes (147 com o animal que entrou na
  categoria depois de entrar no rebanho), 329 correções de aplicação conferidas pelas cópias do original, 395 correções sem
  mudança mais tarde aceitas, 230.015 pendências da agenda e 2.097.389 unidades da viagem no tempo comparadas. O procedimento do
  protocolo trocado foi sorteado 1 vez, num protocolo sem aplicação (aceito); a troca no protocolo cumprido e a correção tardia
  barrada pela carência do próprio original não apareceram na leva — ficam cobertas pelos testes determinísticos (achados 11 e 2).
  Antes, uma leva de busca com o código intermediário (3700000 a 3700039, 40 × 100) deu 2.274 aceitos, 1.406 recusados e 0 falhas.
  As 23 sementes fixas de 60 passos dão as mesmas sequências de antes (826 aceitos, 443 recusados, 0 falhas).
- Leva do teste aleatório da tela (sementes 3000 a 3049, 50 × 40 ações): 49 aprovadas e 1 falha do modelo do teste, refutada como
  defeito do sistema — a semente 3040 (sem `localStorage`) segurou a gravação do rascunho no servidor além do prazo, e o aparelho
  registrou a falha no console ("[ERP] rascunho no servidor: O servidor demorou demais…", avisada na faixa), como deve; o oráculo
  passou a aceitar esse registro nesse modo, e a semente 3040 passa. Nas 49: 2.434 conferências, 2.688 blocos que saíram
  conferidos intocados, 1.119 linhas gravadas, 15 sementes sem `localStorage` (19 rascunhos segurados), 161 substituições, 142
  "Pesar de novo", 7 brincos conferidos antes de mudar a sessão; a decisão refeita no meio não apareceu na leva (fica no teste do
  achado 3). As 6 sementes fixas passam.
- Verificado no fim, com o código final: `npm test`, 863 testes, 863 aprovados e 0 falhas (908,6 s), com as 23 sementes fixas de 60
  passos (826 aceitos, 443 recusados, 0 falhas); `npm run ui:check`, 186 testes, 186 aprovados e 0 falhas (438,6 s), a página
  inicial com 460.755 bytes de 460.800 (450 KB) e, sob demanda, Import 48 KB, Weights 59 KB, Health 25 KB e Reproduction 65 KB de
  150 KB. Antes da etapa: 855 e 173.
- `docs/CONTRATOS.md`: o estado ganhou a frase desta etapa; seção 49 nova (os consertos por classe, a decisão do procedimento do
  protocolo em uso, a garantia nova da fila de lote, a decisão da regressão 6, os testes e os oráculos estendidos); a seção 48 diz
  que o rascunho no servidor passou a ser coberto. `docs/fase-0/` não mudou.
- Durante a etapa, o salvamento automático de fora dela gravou estados intermediários (commits "salva convergência em andamento
  (conserto da revisão final)"); esta etapa não fez commit nem push.

## 17/11/2026 — Fase 3, relatório da convergência

Por quê: a convergência da Fase 3 (as três etapas pela garantia e o conserto da revisão final) precisava entrar no relatório
da fase, com os números de uma execução feita agora e um balanço honesto: a revisão final terminou sem achado alto? Não
terminou (7 altos). Esta etapa não mudou código.

- `docs/RELATORIO_FASE3.md`: seção 6.6 nova, "Convergência da Fase 3". Ela traz:
  - por que: as três rodadas sem queda e as duas classes de defeito;
  - o oráculo de viagem no tempo: as consultas cobertas, as exceções por desenho, as levas e os 10 defeitos;
  - o resolvedor único: a regra, a decisão que contraria 08, seção 5, e os 5 defeitos;
  - o teste aleatório da tela do curral e do tronco: as ações, as falhas de rede, as garantias, as levas e os 9 defeitos;
  - a revisão final: os 17 achados por lente e gravidade, as decisões e por onde cada um passou pelas garantias;
  - o balanço: a revisão final não terminou sem achado alto (7 altos, 4 no curral e no tronco; 8 dos 17 eram conserto
    incompleto ou regressão, 6 deles das próprias etapas da convergência), e a convergência não está demonstrada.
- Também no relatório, todos os números atualizados: o resumo; as entregas, com a linha da convergência; a seção 2, com a
  execução desta etapa e a contagem por arquivo (82 de Node, 29 de navegador); os cenários por nível; o que fica com o dono
  (as decisões da convergência a ratificar, uma delas contra o desenho); a decisão 16; as limitações 1, 3, 10, 11, 13, 15 e 16
  (nova); a tabela do teste aleatório; e o veredito. A seção 6.5 passou a ser o balanço das três rodadas antes da
  convergência.
- Executado nesta etapa, com o código final (`src/` de `bfbdca6`, testes de `d0033b6`):
  - `npm test`: 863 testes, 863 aprovados e 0 falhas (825,4 s), com as 23 sementes fixas (826 aceitos, 443 recusados, 0
    falhas);
  - `npm run ui:check`: 186 testes, 186 aprovados e 0 falhas (433,9 s). A página inicial tem 460.755 bytes de 460.800 (sobram
    45); sob demanda, Import tem 49.608 bytes, Weights 60.822, Health 25.149 e Reproduction 66.937;
  - depois da mudança no `CONTRATOS.md`, `static` e `revisao4.interface` de novo: 26 de 26;
  - a contagem por arquivo pelo registrador (o `node:test` trocado por um contador de `test()`): os 82 arquivos de Node somam
    863, e os 29 de navegador, 186.
- `npm run trava:medir -- --vezes 3`, sem outro processo: 430 comandos, média de 167,8 ms (p50 152,9; p95 358,2), 21,3 s de
  72,2 s na trava (29%). Na etapa das rodadas 2 e 3, a média era 147,8 ms. As três execuções variaram de 149,9 a 169,6 ms.
- Conferido de novo nesta etapa, com os testes de hoje sobre o `src/` de antes de cada etapa:
  - revisão final (`11b744a`): os 8 testes de Node falham por asserção; os 13 de navegador falham, 10 por asserção e 3 pela
    espera de um estado que a tela de então não tinha;
  - viagem no tempo (`d72e518`): os 16 falham. Os 7 cenários de comportamento falham por asserção. O do retrato e as 8
    sequências falham porque o oráculo de hoje usa `Timeline.retratoEm`, que lá não existia; o registro da etapa contava 14,
    com as duas sequências do modelo do teste passando nos dois códigos;
  - resolvedor (`8dc5c35`): os 2 falham, porque não havia a rota;
  - tela do curral (`ee1b2cd`): as 7 regressões falham, 5 por asserção ou espera e 2 do tronco porque `TelaReproducao.sessao()`,
    que o teste lê, ainda não existia.
- Leva de confirmação do motor, com o código final (3900000 a 3900099, 100 sementes × 100 passos, 2 processos): 5.878
  aceitos, 3.290 recusados e 0 falhas. Na viagem no tempo, 741 retratos, 714.564 unidades comparadas, 167.939 com o relógio
  adiantado e 44.905 retratos de hoje conferidos; no resolvedor, 59.497 textos pelos quatro caminhos; a agenda com protocolo
  por categoria, 84 vezes; 96 correções de aplicação conferidas pelas cópias do original. A troca do procedimento de um
  protocolo cumprido e a correção tardia barrada pela carência do original não apareceram de novo.
- Leva de confirmação da tela do curral e do tronco, com o código final (4000 a 4029, 30 sementes × 40 ações, 1 processo):
  30 aprovadas e 0 falhas; 7 sementes sem `localStorage` (8 rascunhos segurados), 1.426 conferências do oráculo, 1.662 blocos
  que saíram conferidos intocados e 607 linhas gravadas.
- `docs/CONTRATOS.md`: a frase do estado desta etapa. Na seção 46, as rotas CONSULTA passam a ser 30 (com `animal.resolver`), e
  `importacao.linhas` entrou na lista das que só mostram registros. Na seção 47, o caminho da rota no código
  (`Identificacao.resolverRota` e `consultaResolver`, que eram exportadas e não estavam citadas). Sem mudança de contrato.
  `docs/fase-0/` não mudou.
- Ficaram de fora desta etapa: o `README.md` ("Última execução" com 809 e 135 testes, "38 arquivos") e o
  `docs/GUIA_DE_IMPLANTACAO.md` continuam com números antigos.
- Durante a etapa, o salvamento automático de fora dela gravou estados intermediários: o commit `752e06c`, com a entrada
  anterior deste arquivo (o conserto da revisão final), e o `b23e823`, com o `CONTRATOS.md` desta etapa. O `src/` e os testes
  não mudaram desde o `d0033b6`. Esta etapa não fez commit nem push.

## 17/11/2026 — Fase 3, conserto pela garantia: a correção e o fato congelado

- O contrato (CONTRATOS, seção 50): por tipo, o que é informado pelo usuário, o que o servidor deriva (e de quê) e o que o
  registro copia do cadastro (tabela A); o que a correção mantém do original enquanto as entradas de que depende não mudam
  (tabela B, `Correcao.CONGELADOS`: 22 valores — 12 cópias, 6 derivados e 4 regras); as garantias b1 a b4 e as regras de
  desenho que valem também para a correção sem mudança.
- `src/Correcao.js` (novo): o ponto único da correção. `entrada(L, ev, propostas)` monta, só das linhas gravadas, a entrada sem
  mudança do evento que vale (o que o servidor propôs vem vazio; o digitado, como foi gravado); `montar(entrada, mudanca)`
  monta o evento corrigido; `contexto`/`congelado` dão o valor do original a todo tratador do motor. As leituras próprias do
  original no `EventService` saíram.
- API: `evento.obter` devolve `correcao` (a entrada sem mudança) e `propostas`; `evento.corrigir` aceita `dados.mudanca` (só o
  que muda), pelo mesmo caminho de validação e efeito do formulário inteiro.
- Tela: a prévia da correção (`TelaEventos.previaCorrecao`) só formata a entrada do servidor pelo tipo do campo — não calcula
  número nem data (a soma do intervalo da próxima aplicação saiu); a prévia própria da reprodução saiu. Página inicial montada:
  de 460.759 para 435.471 bytes (orçamento 460.800).
- Oráculo da correção no teste aleatório (`tests/apoio-fuzz.js`, `oraculoCorrecao`): num passo sorteado à parte, com o estado
  guardado e devolvido (`gas.estado.salvar`/`restaurar` nos fakes), muda de 1 a 4 cadastros e corrige sem mudança até 4 eventos
  de tipos diferentes pelas entradas do servidor e do gerador (b1), compara a bateria da viagem no tempo em hoje e na data do
  evento e a lista dos lançamentos (b4), e corrige um campo só pela mudança (b2; com a data, b3). As sementes fixas exigem
  cobertura do oráculo.
- Defeitos achados e consertados pela causa, cada um com um teste em `tests/correcao.regressoes.test.js` que falha com o `src/`
  de antes da etapa (`b8c513b`) e passa agora:
  - ALTA: a aplicação refazia a conta e a descrição do consumo pela categoria de hoje do produto; o protocolo que deixou de ser
    "a cada N dias" apagava a próxima aplicação proposta; o parto refazia o pasto das crias pela linha do tempo de hoje da mãe
    (e era recusado quando a cria já tinha saído); a venda sem o peso de cada animal refazia a divisão estimada pela pesagem
    retroativa lançada depois;
  - MEDIA: a raça da cria pela raça de hoje da mãe; a correção de cadastro recusada (VALOR_IGUAL) pelo estado de hoje; a prévia
    da correção montada no cliente; o parto só de natimorto sem a certeza do pai gravada (e com o pasto da mãe conferido); a
    correção de cadastro para "não castrado" seguida de castração (CASTRACAO_REPETIDA: o castrado de origem depois do comando
    não contava o próprio comando); a identificação recusada pela regra do número de hoje (reuso, só números); a certeza
    apagada junto com o nascimento perdida; o acerto de brinco lançado errado recusado depois de uma troca posterior; o touro
    de um lote com vários touros que virava fêmea pela correção de cadastro (agora a linha de touro é de um macho, na
    verificação e na trava); a propriedade padrão de hoje no lançamento sem propriedade; a mãe que o bezerro só ganhou depois
    entrando na desmama; a correção de cadastro do nascimento recusada pela certeza que uma correção posterior apagou, e as
    regras entre campos (castrado, reprodutor, partos, a chegada) conferidas com o sexo ou o nascimento que uma correção
    posterior mudou;
  - BAIXA: o nome de hoje do produto na compra do insumo; o nome de hoje do tipo na dedução da venda; o pasto informado que
    nenhum animal recebe (o do lote da compra, o do parto só de natimorto, o da desmama do bezerro que já estava nele)
    conferido como se recebesse animais.
- `tests/correcao.contrato.test.js` (novo): a correção que muda a entrada de que um valor congelado depende — a data refaz o
  valor de antes da reclassificação na posição nova; outro produto copia o cadastro de hoje do produto novo e mantém a carência
  informada —, e a tabela B do contrato é a do código (`Correcao.tabela()`: as 22 chaves, com a mesma natureza).
- `tests/reproducao.test.js`: a correção de cadastro que tornaria castrado o touro de uma cobertura é recusada já pelo motor,
  com o código da regra (`TOURO_CASTRADO`), e não só pela trava (`INTEGRIDADE_LINHA_DO_TEMPO`), com a mesma mensagem — efeito
  do castrado de origem que conta o próprio comando.
- Testes existentes ajustados ao contrato novo, sem afrouxar o que conferem: `tests/fase2.adversarial.test.js` (o modelo
  independente: na correção do parto com a mesma mãe e a mesma data, o pasto vazio das crias é o do original, como a tabela B
  manda); `tests/fase3.fuzz.regressoes.test.js` (a correção do rebanho que declara castrado o macho já castrado por uma
  castração lançada é recusada já pelo motor, CONFLICT `CASTRACAO_REPETIDA`, antes de pedir a justificativa do período fechado
  — a mesma resposta da simulação); `tests/revisao1.financeiro.test.js` (a tela lê `o.correcao`, com o tipo de cada dedução
  vindo do servidor, em vez de remontar pelos papéis; a conferência ganhou a do tipo das deduções na entrada).
- `tests/ui/pastos-importacao.test.js`: a leitura das linhas validadas e do relatório espera o servidor responder
  (`esperarServidor`); sob carga, a seção ainda dizia "Buscando as linhas…" e o teste falhava por tempo, não por defeito.
- Mudanças de contrato além do ponto único: o payload do parto só de natimorto grava `pai_confianca`; o da aplicação com
  protocolo, `recorrencia_protocolo`; a verificação de integridade acusa a linha de touro de um animal que não é macho
  (GENEALOGIA `TOURO_LINHA`; a trava recusa a correção de cadastro que a criaria); o pasto informado (o do lote da compra, o do
  parto, o da desmama) só é conferido como desativado quando recebe animal; o parto sem cria viva não pede nem confere o pasto
  da mãe; `ReproductionService.castradoDeOrigem(f, id, plano)` conta o que o comando grava.
- Leva de busca do oráculo (610000 a 610999, 1.000 sementes × 100 passos, 4 processos): 59.078 aceitos, 32.921 recusados e 8
  falhas, todas triadas e consertadas (os defeitos 11 a 18 da seção 50.8; o 19 veio da primeira leva de confirmação); 37.255
  correções sem mudança aceitas (22.074 pela entrada do servidor, 15.181 pela do gerador), 170 recusas documentadas, 1.665.515
  consultas comparadas, 19.484 correções de um campo (5.296 da data). Antes dela, as sementes fixas acharam o parto só de
  natimorto.
- Primeira leva de confirmação (a partir de 611000): parada na semente 611819 (o par do nascimento e da certeza), depois de 284
  sementes; consertada pela causa, com a regressão, e pela mesma causa as regras entre campos da correção de cadastro. Segunda
  leva de confirmação (a partir de 612000): parada na semente 612769 (o pasto informado do parto só de natimorto), depois de
  108 sementes; consertada pela causa, com a regressão, e pela mesma causa o pasto da desmama.
- Leva nova, limpa, com o código final (613000 a 613999, 1.000 sementes × 100 passos, 4 processos): 58.266 aceitos, 33.396
  recusados e 0 falhas; 36.975 correções sem mudança aceitas (21.907 pela entrada do servidor, 15.068 pela do gerador), 116
  recusas documentadas, 1.709.406 consultas comparadas, 19.320 correções de um campo (5.178 da data).
- Verificado em Node, depois da leva limpa e com estes documentos: `npm test` com 887 testes, 887 passando (84 arquivos; o
  teste aleatório das sementes fixas: 23 sementes × 60 passos, 831 aceitos, 440 recusados, 0 falhas); `npm run ui:check` verde:
  a conferência estática (13 arquivos .html, sem recurso externo; página inicial montada com 435.471 bytes de 460.800; sob
  demanda Import 48 KB, Weights 59 KB, Health 25 KB e Reproduction 62 KB, de 150 KB cada) e 186 testes de navegador, 186
  passando.
- Durante a etapa, o salvamento automático de fora dela gravou estados intermediários (os commits `1aae96d`, `db29996`,
  `71ace1f`, `406cdb0`, `0df68a8`, `b25e4d4`, `9caac72` e `f74267a`, este com a seção 50.10 do `CONTRATOS.md`). Esta etapa não
  fez commit nem push; `docs/fase-0/` não mudou.

## 18/11/2026 — Fase 3, segunda convergência, etapa 2: curral e tronco sem estado escondido, e nenhum cálculo no aparelho

- **O cliente não calcula** (CONTRATOS, seção 51): `tests/cliente.naocalcula.test.js` (novo), com o leitor
  `tests/apoio-naocalcula.js` (novo), lê os `<script>` de todo `src/*.html` e acusa a aritmética de data (somar dias, diferença de
  datas, `Date.parse`/`new Date`/`getDate` e afins, o dia em milissegundos, o ano tirado do texto da data) e a conta com número de
  domínio pelo nome (GMD, ganho, carência, UA, idade, dias, centavos, valor, total, peso, dose, custo, quantidade e outros). O que
  pode ficar é uma lista de 11 entradas, cada uma com o porquê (formatação do instante, do peso e do dinheiro; leitura da data
  digitada; o desvio do relógio para o do servidor; o carimbo do rascunho e da cópia local; a ordenação da tabela; o desenho dos
  gráficos); o teste falha com conta fora da lista e com entrada da lista sem uso, e tem um autoteste do leitor.
- O que virou dado do servidor: os vencimentos do "Dividir em parcelas" (rota nova `financeiro.vencimentos`,
  `FinancialService.vencimentos`: MES, D30, D15, D7, de 1 a 120 parcelas, recusa com o campo); `Fmt.diasEntre` saiu (sem uso);
  "Dados de …" nos arquivos exportados e na faixa sem conexão formatam o instante pelo `Fmt.instante(ms)`, sem `new Date` na tela.
  A prévia da correção da sanidade e a agenda já vinham do servidor (seções 50 e 49); o teste confere que nenhuma tela de domínio
  tem conta. `tests/telas.fase2.test.js`: os vencimentos conferidos pela rota (inclusive D15 e as recusas), não mais pela função
  do aparelho.
- **Curral e tronco sem estado escondido** (CONTRATOS, seção 52), dois defeitos do modo sem localStorage (o rascunho no servidor,
  SP-06), consertados pela causa, cada um com a regressão em `tests/ui/curral.fuzz.regressoes.test.js` que falha com o `src/` de
  antes da etapa (`8b6b4c3`):
  - ALTA: o bloco saía sem a chave guardada quando o rascunho no servidor falhava (só a faixa avisava); se a página fosse embora,
    a linha voltava sem a chave e saía com outra — gravada duas vezes. Agora o bloco que ainda não saiu só sai com a chave
    guardada: senão volta à fila com a chave e o porquê (`[data-nao-guardado]`), e o envio para. O que já saiu antes sai de novo
    com a chave dele (regressão 7, curral e tronco);
  - MEDIA: a falha do rascunho adiado não aparecia no curral nem no tronco (só o formulário de registro ouvia) e o rascunho não ia
    de novo sem outra mudança na tela. Agora `App` põe a faixa em qualquer tela (`Rascunhos.aoFalhar`) e a tira quando o servidor
    confirma (`Rascunhos.aoGuardar`, novo), e `Rascunhos` tenta de novo sozinho 5 s depois da falha (regressão 8, curral e tronco).
- **O teste aleatório do curral e do tronco** (`tests/ui/curral.fuzz.test.js`, `tests/ui/apoio-curral.js`) gera agora: o modo do
  rascunho fixo por `FUZZ_MODO=semLS|comLS`; sem localStorage, o rascunho no servidor que falha (transporte, falha interna,
  ocupado, resposta perdida, pedido perdido, segurado) e a página que vai embora de repente (`rede.rascunhoBloqueado`); as datas
  das trocas do 0457 mais sorteadas; o brinco repetido de uma linha em qualquer estado (`repetir`: na fila, no ar, sem
  confirmação, gravada, com aviso, recusada, pendente); o brinco conferido e não lançado antes de "Mudar", com a resposta chegando
  na sessão nova e o brinco lançado de novo; a queda de sinal em várias conferências (`semSinal`). O oráculo confere também: nenhuma
  linha de bloco no ar ou gravado oferece "Corrigir o brinco" (além das outras ações) nem muda de animal ou de valor; o bloco que
  volta sem resposta só quando nada com a chave dele saiu, e com o porquê na tela; a linha, a mensagem do servidor e a conferência
  com o brinco, a categoria e o pasto do servidor NA DATA da sessão (`animal.resolver` com `ids`, fora da rede da página); "Corrigir
  o resultado" com o texto digitado; o aviso "o novo resultado substituiu o anterior" e "Substituir pelo peso novo" em todo caminho
  que substitui; a pendente com resposta do servidor resolvida (ou barrada por outra linha do mesmo animal); sem localStorage, o
  rascunho do servidor igual à tela antes de recarregar, sair e terminar, a faixa quando o rascunho falhou e a página recarregada
  igual ao rascunho do servidor. O modelo foi acertado onde estava errado (a conferência pergunta junto as pendentes; a chave e a
  recusa que chegam enquanto o rascunho assenta antes de "Terminar"), sem afrouxar o oráculo.
- Levas, com o código final: 152 sementes × 40 ações sem localStorage, 152 × 40 com localStorage, 32 × 100 sem e 32 × 100 com
  (4 processos): 368 sementes, 0 falhas, 7.216 linhas gravadas e 21.609 verificações do oráculo (os números por garantia estão na
  seção 52.7 do CONTRATOS). As levas de busca antes dela (160 sementes × 40) só acharam erros do modelo do teste.
- Verificado em Node, com o código final e estes documentos: `npm test` com 890 testes, 890 passando (85 arquivos; o teste
  aleatório das sementes fixas: 23 sementes × 60 passos, 831 aceitos, 440 recusados, 0 falhas); `npm run ui:check` verde duas
  vezes seguidas: a conferência estática (13 arquivos .html, sem recurso externo; página inicial montada com 435.895 bytes de
  460.800; sob demanda Import 48 KB, Weights 60 KB, Health 25 KB e Reproduction 63 KB, de 150 KB cada) e 190 testes de navegador,
  190 passando, nas duas vezes.
- Durante a etapa, o salvamento automático de fora dela gravou estados intermediários (os commits `8b6b4c3`, no reinício do
  contêiner, e `c250a07` e seguintes). Esta etapa não fez commit nem push; `docs/fase-0/` não mudou.

## 18/11/2026 — Fase 3, segunda convergência, conserto da rodada 1 da revisão

- A revisão depois da primeira convergência achou 17 problemas (7 altos), de duas classes: o fato congelado na correção e
  estados do curral, do tronco e do rascunho que o teste aleatório da interface não gerava. Cada um tem um teste que falha com o
  `src/` de antes (commit `67ac9de`) e passa agora — `tests/convergencia2.r1.test.js` (novo, 12 testes: os achados do servidor)
  e `tests/ui/convergencia2.r1.test.js` (novo, 11 testes de navegador: os da interface) —, o conserto pela causa e o oráculo que
  deixou passar, estendido (CONTRATOS, seção 53, com a tabela dos achados).
- ALTA: o diagnóstico sem estação (o padrão do tronco) é da exposição mais recente da fêmea antes dele, como o parto — não conta
  mais para a estação anterior (prenhez e perda gestacional falsas); a dose de um animal digitada na aplicação por peso fica no
  payload (`doses_informadas`) e vem na entrada da correção — a correção da data ou da dose por kg não a refaz pelo peso nem é
  recusada por SEM_PESO; o lote e a validade na entrada de insumo sem controle de estoque são recusados (CAMPO_NAO_SE_APLICA), não
  descartados; sem localStorage, o rascunho no servidor vale pela versão (o pedido atrasado não apaga a chave do bloco gravado; o
  removido fica como marca); o formulário de registro só envia com a chave guardada (a regra 52.1 em todo caminho); a mudança da
  correção de cadastro acha o item pelo animal e pelo campo (`MUDANCA_AMBIGUA` sem o campo).
- MEDIA: a agenda vence o nunca aplicado no dia em que o protocolo passou a valer; a entrada da correção do parto lê do payload se
  o pasto e a raça das crias foram digitados (`pasto_crias_informado`, `racas_informadas`) — `propostas` saiu do `evento.obter`; a
  estação do original vale só com a mesma data (`REPRODUCAO.estacao` na tabela B: 23 chaves, 5 REGRA); a compra do insumo conta
  como uso do produto (`PRODUTO_EM_USO`); "Corrigir o brinco" passa pela regra do repetido (`darAnimal`, a mesma da pendente
  conferida); a pendente sem sinal se lê "pendente: a conferir no servidor", com o porquê, e o toque em "Conferir os brincos
  pendentes no servidor" sem resposta avisa; o índice dos rascunhos que falhou sozinho vai de novo.
- BAIXA: a previsão de parto só pela exposição tem a margem (a janela dos indicadores); o comando que tira o movimento de um dia
  contado (o desfazer da importação, a correção para outro produto ou para o nome livre) é recusado pelo motor com
  CONTAGEM_POSTERIOR e o caminho do comando; o contador do tronco conta as fêmeas achadas.
- Achado pelo teste aleatório do curral estendido (semente 70005), a mesma causa do "Corrigir o brinco" por outro caminho: a linha
  que voltava de um bloco desfeito e a de "Pesar de novo" do mesmo animal saíam no mesmo bloco (ANIMAL_REPETIDO). Consertado no
  ponto em que o bloco nasce (`uidsDoBloco`, curral e tronco: um animal por lançamento), com a regressão.
- Achado pela leva do teste aleatório do curral (semente 80028), a mesma causa do botão das pendentes por outro caminho: com a
  resposta do servidor perdida, o toque em "Conferir os brincos pendentes no servidor" ficava sem resposta na tela até o prazo do
  aparelho (45 s), e o toque repetido pedia de novo. Agora o botão diz "Conferindo os brincos pendentes no servidor…", travado,
  até a resposta ou o prazo (curral e tronco), com a regressão (achado 13, a resposta perdida).
- Achado pela leva do teste aleatório de domínio (sementes 720208, 720241 e 720043), uma lacuna do oráculo de tempo, não do
  sistema: com o achado 8, o vencimento do nunca aplicado depende do início do protocolo, que a aplicação retroativa (ou o estorno
  dela) noutro animal move — por desenho (05, RN-058). A impressão digital do protocolo (`protocolosEm`) passou a levar o início
  de vigência, e a leva foi refeita do começo com o oráculo estendido.
- Oráculos estendidos: no teste aleatório de domínio (`tests/apoio-fuzz.js`), a correção da dose por kg, a dose digitada por peso
  e o pasto das crias na correção da data, a mudança de um dado (e tirar um dado) da correção de cadastro com dois dados do mesmo
  animal, a agenda desde o início do protocolo e o lote da entrada de estoque; no do curral e do tronco
  (`tests/ui/curral.fuzz.test.js`, `tests/ui/apoio-curral.js`), o rascunho que chega atrasado ao servidor (`segurarAntes`), a falha
  só do índice (a falha mira rota e chave), "Corrigir o brinco" com o brinco de outra linha, nenhum bloco com o animal repetido, o
  rótulo da pendente, o contador do tronco, a resposta do botão das pendentes, e nada preso depois de o servidor voltar.
- Testes existentes ajustados ao contrato novo, sem afrouxar o que conferem: `tests/reproducao.test.js` (a janela do nível 3 com
  a margem da seção 40), `tests/sanidade.agenda.test.js` e `tests/revisao.final.fase3.test.js` (o nunca aplicado vence no início
  do protocolo), `tests/sanidade.test.js` (o payload com `doses_informadas`), `tests/correcao.contrato.test.js` (a tabela B com
  23 chaves, 5 REGRA), `tests/ui/sanidade.test.js` (o protocolo da agenda cadastrado antes das doses atrasadas) e o cenário de
  aceitação da sanidade (`src/TestRunner.js`, passo 058-059: o protocolo de dose única praticado desde a primeira aplicação, no
  S1, e a pendência do S3 vencida desde então, com a data conferida). Na retomada depois do reinício do contêiner, o `npm test`
  completo achou mais três testes do contrato de antes, ajustados sem afrouxar o que conferem: `tests/revisao2.fase3.motor.test.js`
  (o desfazer da importação que mudaria o saldo de uma contagem posterior é recusado já pelo motor — CONFLICT CONTAGEM_POSTERIOR,
  a contagem no conflito e "desfaça a importação e conte de novo" — e não só pela trava; achado 16),
  `tests/revisao2.fase3.zootecnia.test.js` e `tests/revisao3.fase3.zootecnia.test.js` (o nunca aplicado vence no dia em que o
  protocolo passou a valer: o cadastro, ou a primeira aplicação com ele, se antes; a ficha continua igual à agenda; achado 8).
- Retomada depois do reinício do contêiner (cerca de 04:40 UTC): o que estava em disco foi salvo nos commits `c1387fc` e `198bb8f`;
  cada achado foi conferido de novo — os 12 testes de `tests/convergencia2.r1.test.js` e os 11 de `tests/ui/convergencia2.r1.test.js`
  falham todos com o `src/` de antes (`67ac9de`), cada um pelo motivo do achado, e passam com o de agora; os roteiros da revisão
  (os do servidor) dão o resultado certo. As levas, que o reinício matou, foram rodadas de novo do começo.
- Achado pela leva do teste aleatório de domínio (semente 7600019), uma lacuna do oráculo estendido nesta etapa, não do sistema: a
  correção da dose por kg de uma medicação de 18/09 (0,01 → 0,03 mL/kg) mudaria o saldo do frasco num dia contado (13/11) e foi
  recusada com CONFLICT CONTAGEM_POSTERIOR, como o desenho manda (CONTRATOS, seções 44 e 50.5); o oráculo só aceitava a recusa
  VALIDATION. Agora aceita e conta essa recusa (`soContagemPosterior`), e a leva foi refeita do começo com o oráculo acertado.
- Teste aleatório do curral e do tronco, com o código final (40 ações por semente, 2 processos): 50 sementes sem localStorage
  (91000 a 91049) e 50 com localStorage (92000 a 92049), 100 aprovadas e 0 falhas; 4.722 verificações do oráculo e 1.603 linhas
  gravadas; sem localStorage, 23 rascunhos que chegaram atrasados ao servidor, 12 falhas só do índice, 5 blocos que não saíram por
  falta da chave guardada e 589 conferências de "nada preso depois de o servidor voltar"; 71 "Corrigir o brinco" (22 barrados por
  outra linha do mesmo animal, 16 com o aviso de pesar de novo), 757 rótulos de pendente sem sinal e 1.982 contadores do tronco
  conferidos (os números por modo estão na seção 53.5 do CONTRATOS).
- Teste aleatório de domínio, com o código final e o oráculo acertado (7600000 a 7600299, 300 sementes × 100 passos, 4
  processos): 17.395 aceitos, 9.949 recusados e 0 falhas; 11.342 correções sem mudança aceitas (6.714 pela entrada do servidor e
  4.628 pela do gerador), 4.343 mudanças de um campo (1.588 da data), 508.977 consultas comparadas depois da correção, 96.831
  vencimentos da agenda no início do protocolo e 2.031.536 unidades da viagem no tempo.
- Verificado em Node, com o código final: `npm test` com 902 testes, 902 passando (86 arquivos; 696,3 s; o teste aleatório das
  sementes fixas: 23 sementes × 60 passos, 831 aceitos, 440 recusados, 0 falhas); `npm run ui:check` verde: a conferência
  estática (13 arquivos .html, sem recurso externo; página inicial montada com 437.393 bytes de 460.800; sob demanda Import 48 KB,
  Weights 62 KB, Health 25 KB e Reproduction 64 KB, de 150 KB cada) e 201 testes de navegador, 201 passando (475,2 s).
- `docs/CONTRATOS.md`: o estado ganhou a frase da segunda convergência; seção 53 com a tabela dos achados, as regras novas, os
  oráculos estendidos (também a recusa da dose por kg pela contagem posterior), as decisões e as levas (53.5).
- Durante a etapa, o salvamento automático de fora dela gravou estados intermediários (os commits `c1387fc`, `198bb8f`, no
  reinício do contêiner, e `53fdbad`). Esta etapa não fez commit nem push; `docs/fase-0/` não mudou.

## 18/11/2026 — Fase 3, segunda convergência, conserto da rodada 2 da revisão

- A revisão depois da rodada 1 achou 17 problemas (10 altos, 6 médios e 1 baixo), das mesmas duas classes: o fato congelado na correção (o valor que o
  original copiou, derivou ou recebeu digitado, refeito pelo estado de hoje ou pela entrada errada) e estados do curral e do
  tronco que o teste aleatório da interface não gerava. Cada um tem um teste que falha com o `src/` de antes (commit `5e69ebf`) e
  passa agora — `tests/convergencia2.r2.test.js` (novo, 12 testes: os achados do servidor) e `tests/ui/convergencia2.r2.test.js`
  (novo, 11 testes de navegador: os da interface e os 3 do teste aleatório estendido) —, o conserto pela causa e o oráculo que
  deixou passar, estendido (CONTRATOS, seção 54, com a tabela dos achados).
- ALTA: o aborto é do dono da prenhez que ele encerra (a regra do parto e do diagnóstico sem estação), e a exposição em curso no
  parto ou no aborto continua na previsão; a verificação confere a cópia na mesma linha do lançamento — o cabeçalho da aplicação
  (lote, fabricante, via, veterinário e os demais), a dose × a base do rateio do consumo, a soma das doses × a saída do frasco, o
  lote da saída, o rateio × o modo e o método da pesagem e da desmama — e a trava recusa a correção do lançamento cuja fonte que ela
  lê foi mexida à mão; o pasto de destino da desmama fica gravado também com o bezerro já nele (o estorno da transferência que o
  pôs lá é conflito, não muda a desmama em silêncio); a correção do lançamento que criou o animal não desfaz a raça corrigida na
  ficha; trocar o produto (ou o protocolo) na aplicação troca o que veio do anterior, e a carência fica com o servidor; a estação
  do diagnóstico vem do filtro da lista de Fêmeas, nunca da data de hoje; a venda dividida por cabeça continua por cabeça na
  correção; os valores congelados leem a marca do digitado (apagar a dose, o pasto, a raça ou a carência digitados os refaz como
  no registro).
- MEDIA: o pasto do parto só de natimorto fica no payload e vem na entrada da correção; a certeza apagada junto com o dado fica fora
  da entrada da correção de cadastro, e tirar o que o lançamento não tem é recusado (`MUDANCA_SEM_ITEM`); o intervalo do protocolo
  continua congelado com a próxima aplicação digitada (`proxima_informada`); sem localStorage, "Terminar" só termina com o rascunho
  do servidor apagado (a faixa da falha só de remoção diz que é a remoção); a recusa do servidor ao resolvedor (a data futura) não
  é falta de sinal no curral e no tronco; a pendente barrada por outra linha do mesmo animal se lê "barrada" e pede para tirar uma
  das duas.
- BAIXA: as mensagens do par do dado e da certeza na correção de cadastro em português do pecuarista, com o conselho certo.
- Payload novo (marcas do digitado): `quantidade_informada`, `carencia_informada`, `fabricante_informado`, `proxima_informada` (com
  o intervalo do protocolo sempre que ele é "a cada N dias") e `pasto_destino_id` no parto sem cria viva. Indicadores da estação:
  `abortos` (as fêmeas com o desfecho do aborto).
- Oráculos estendidos: no teste aleatório de domínio (`tests/apoio-fuzz.js`), a soma das estações conta cada parto, aborto e
  diagnóstico uma vez só (`INDICADORES:DONO`), a ficha corrige também a raça (pelo mesmo sorteio do nome: a sequência das sementes
  fixas não mudou — 831 aceitos e 440 recusados, como antes), o efeito da desmama exige o pasto informado gravado, o da sanidade
  lê as marcas da carência e do fabricante, e a correção da data mantém a próxima digitada; no do curral e do tronco
  (`tests/ui/curral.fuzz.test.js`), o "Terminar" com a remoção do rascunho que falha, o rascunho do servidor depois do "Terminar"
  e o rótulo da pendente barrada (o oráculo de antes exigia "a conferir no servidor" também dela); e a rede do teste passou a
  gerar a recusa do servidor à conferência do brinco (nenhuma ação a gerava), com o oráculo do lançamento, das pendentes, do
  "Corrigir o brinco" e do rótulo. Com ele, dois defeitos a mais: o "Corrigir o brinco" do curral dizia "sem resposta, corrija com
  sinal" diante da recusa (o achado 15 num caminho que o conserto não tinha coberto) e, sem localStorage, o envio que não saía por
  falta da chave guardada (só o índice do rascunho falhou) voltava à fila na tela sem ser guardado de novo — o servidor ficava com o
  bloco "saindo" (defeito da etapa 2, achado pela semente fixa 14 com a sequência nova); e a linha que não entrava na data antiga
  (a fêmea morta), recusada na conferência da data nova, se lia "não entra" (a marca velha ficava; semente 95022). Os três
  consertados, com teste que falha sem o conserto.
- Testes existentes ajustados ao contrato novo, sem afrouxar o que conferem: `tests/sanidade.test.js` (o payload com as marcas
  `quantidade_informada` e `carencia_informada`), `tests/pesagem.test.js` (a linha "média do lote" sem o lote também é o método
  diferente do das outras linhas: dois achados), `tests/correcao.regressoes.test.js` (a carência copiada do produto vem em branco na
  entrada; a desmama do bezerro que já estava no pasto informado grava o pasto com origem = destino), `tests/manejo.test.js` (a
  mesma desmama: a linha com origem = destino, e o bezerro continua no pasto),
  `tests/ui/sanidade.test.js` (a aplicação dos pendentes deixa a carência em branco; a revisão mostra a do produto) e
  `tests/ui/reproducao.test.js` (sem o filtro da estação, o diagnóstico abre sem estação).
- Levas com o código final: teste aleatório de domínio, 300 sementes novas × 100 passos (7700000 a 7700299): 18.273 aceitos,
  9.577 recusados, 0 falhas (11.574 correções sem mudança e 4.401 mudanças de um campo conferidas; 206 conferências de
  `INDICADORES:DONO`; 2.299.599 unidades da viagem no tempo; 185.786 textos do resolvedor). Teste aleatório do curral e do
  tronco, 40 ações: 50 sementes sem localStorage (95000 a 95049) e 50 com (96000 a 96049), 0 falhas (36 recusas do servidor à
  conferência geradas; 225 rótulos de recusada e 186 de barrada conferidos; 82 "Terminar" sem localStorage com o rascunho do
  servidor apagado e 33 com a remoção sem confirmação, avisada). `npm test`: 914 testes, 0 falhas. `npm run ui:check`: 212
  testes, 0 falhas; a página inicial com 428 KB de 450 KB.

## 18/11/2026 — Fase 3, relatório da segunda convergência

Por quê: a segunda convergência teve duas etapas pela garantia e duas rodadas de revisão. A correção e o fato congelado estão na
seção 50, o curral e o tronco sem estado escondido e o cliente que não calcula nas seções 51 e 52, e as duas rodadas nas seções 53
e 54. Isso precisava entrar no relatório da fase com os números de uma execução feita agora e com um balanço honesto. A última
rodada terminou sem achado alto? Não terminou: teve 10 altos. Esta etapa não mudou código.

- `docs/RELATORIO_FASE3.md`: subseção nova 6.6.7, "Segunda convergência", dentro de "Convergência da Fase 3". Ela traz:
  - por que: os 17 achados da revisão final (7 altos) e as duas classes que continuaram;
  - o oráculo da correção e do fato congelado: as tabelas A e B (23 valores), o ponto único, as garantias b1 a b4, o oráculo, as
    levas e os 21 defeitos, com a origem de cada um;
  - o curral e o tronco sem estado escondido e o cliente que não calcula: o gerador e o oráculo ampliados, as regras novas, as
    levas e os 3 defeitos. Os dois do curral saíram da leitura do código, e não de uma semente;
  - as duas rodadas: 17 achados (7 altos) e 17 (10 altos), por lente e gravidade, as decisões, os defeitos que o teste aleatório
    estendido achou e por onde cada achado passou pelas garantias;
  - o balanço, com a curva de achados por rodada (29, 25, 25, 17, 17 e 17; altos 14, 8, 5, 7, 7 e 10) e a classificação das
    duas rodadas. A última rodada não terminou sem achado alto; o curral e o tronco tiveram, pela primeira vez, uma rodada sem
    alto; o fato congelado na correção não caiu; os 17 consertos da rodada 2 não foram revisados. A convergência não está
    demonstrada.
- Também no relatório, todos os números foram atualizados:
  - o resumo e as entregas, com a linha da segunda convergência;
  - a seção 2, com a execução desta etapa e a contagem por arquivo (87 de Node, 31 de navegador);
  - os cenários por nível (a correção de um fato passado; o cliente não calcula);
  - o que fica com o dono (40 arquivos; a verificação nova das cópias; as decisões a ratificar);
  - a decisão 17 nova, e as 6 a 9 com o que ela mudou;
  - as limitações 3, 6, 9, 10, 11, 12, 13 e 15;
  - a tabela do teste aleatório e o veredito.
- Executado nesta etapa, com o código final (`src/` de `c4721eb`, testes de `b9a2072`):
  - `npm test`: 914 testes, 914 aprovados e 0 falhas (903,0 s), com as 23 sementes fixas (831 aceitos, 440 recusados, 0
    falhas);
  - `npm run ui:check`: 212 testes, 212 aprovados e 0 falhas (527,5 s). A página inicial tem 438.227 bytes de 460.800 (sobram
    22.573); sob demanda, Import tem 49.584 bytes, Weights 65.924, Health 25.078 e Reproduction 68.215;
  - depois da mudança no `CONTRATOS.md`, `static`, `revisao4.interface` e `correcao.contrato` de novo: 29 de 29;
  - a contagem por arquivo pelo registrador: os 87 arquivos de Node somam 914, e os 31 de navegador, 212.
- `npm run trava:medir -- --vezes 3`, sem outro processo: 430 comandos, média de 176,4 ms (p50 172,8; p95 382,6), 23,7 s de
  75,9 s na trava (31%). No relatório da primeira convergência, a média era 167,8 ms (21,3 s de 72,2 s na trava). As três
  execuções variaram de 174,3 a 188,9 ms.
- Conferido de novo nesta etapa, com os testes de hoje sobre o `src/` de antes de cada etapa:
  - correção (`b8c513b`): os 21 de `correcao.regressoes` falham, 20 por asserção e 1 porque `evento.obter` ainda não trazia a
    entrada da correção;
  - rodada 1 (`67ac9de`): os 12 de `convergencia2.r1` falham por asserção;
  - rodada 2 (`5e69ebf`): os 12 de `convergencia2.r2` falham por asserção.
- Levas de confirmação com o código final, nesta etapa:
  - teste aleatório de domínio, 7800000 a 7800099 (100 sementes × 100 passos, 2 processos): 5.925 aceitos, 3.253 recusados e
    0 falhas. Foram 3.866 correções sem mudança aceitas (2.280 pela entrada do servidor e 1.586 pela do gerador; 6 recusas
    documentadas), 1.514 mudanças de um campo (492 da data) e 175.403 consultas comparadas. Também houve 74 conferências de
    `INDICADORES:DONO`, 720.445 unidades da viagem no tempo e 59.415 textos do resolvedor;
  - teste aleatório do curral e do tronco, 40 ações: 15 sementes sem localStorage (98000 a 98014) e 15 com ele (99000 a
    99014), 30 aprovadas e 0 falhas. Foram 1.476 verificações do oráculo, 684 linhas gravadas e 1.438 blocos conferidos
    intocados. Sem localStorage: 97 rascunhos do servidor conferidos com a tela, 17 páginas que foram embora de repente e 24
    "Terminar" com o rascunho apagado.
- `docs/CONTRATOS.md`:
  - a frase do estado desta etapa;
  - na seção 54, o número de altos da rodada 2 era 7 e passou a 10, com 6 médios e 1 baixo; os achados 2 e 6 são o mesmo
    defeito;
  - na seção 46, as rotas CONSULTA passam a ser 31, com `financeiro.vencimentos`, que não lê fato e fica fora da tabela.

  Sem mudança de contrato. `docs/fase-0/` não mudou.
- Neste arquivo, a entrada do conserto da rodada 2 dizia "17 problemas (7 altos)", e o certo é 10 altos, 6 médios e 1 baixo.
- Ficaram de fora desta etapa: o `README.md` ("Última execução" com 809 e 135 testes, "38 arquivos") e o
  `docs/GUIA_DE_IMPLANTACAO.md` (38 arquivos) continuam com números antigos. Esta etapa não fez commit nem push.

## 18/11/2026 — Fase 4, etapa BASE: folga na página inicial, tela Financeiro e a conciliação das três visões

Por quê: a Fase 4 começa. Antes das telas e dos comandos financeiros (E4.1 a E4.7), a etapa abre a fase sem quebrar as
anteriores, dá folga à página inicial (428 KB de 450 KB depois das convergências da Fase 3), liga o esqueleto da tela Financeiro aos
lançamentos que já existem desde a Fase 2 e põe a identidade das três visões (07, seção 2.1) como função pura conferida depois de
cada comando, de cada passo do teste aleatório e na base de demonstração. Contrato na seção 55 de `docs/CONTRATOS.md`.

- `EventCatalog.FASE_ATUAL = 4`. Os tipos da Fase 4 (lançamento financeiro, rateio) seguem inativos até terem campos; os das fases
  anteriores não mudam (`tiposAtivos()` = `tiposAtivos(3)`). O módulo Financeiro entra no menu com a tela `Financial`, sob demanda.
  As rotas da Fase 4 sem tratador continuam `NOT_FOUND` com a fase.
- Folga na página inicial: `Events` (lista, detalhe, prévia da correção e estorno) e `Settings` (Configurações) saíram do `Index` e
  vêm sob demanda (módulos EVENTOS, `rotas: ['eventos', 'evento']`, e CONFIGURACOES, `rotas: ['config']`; `Api.TELAS_SOB_DEMANDA`),
  pelo mesmo mecanismo da seção 37. A página inicial caiu de 428 KB para 363 KB (meta ≤ 380 KB, conferida em
  `tests/telas.sobdemanda.test.js`). O registro de evento (o botão global) continua na página inicial: a rota `evento/novo` é do
  `Components` e ganha da raiz `evento` do módulo. Para o usuário, só o carregamento curto na primeira vez.
- Tela `Financial.html` (sob demanda): a lista dos lançamentos com os filtros (competência, tipo, natureza, conta, parceiro, pasto,
  situação, pagamento, busca), os totais e as páginas do servidor, e o detalhe de cada um (parcelas com a situação de hoje e os dias
  de atraso, o rateio e o valor de cada animal, o que ficou sem alocar, o evento que o criou e o que o anulou, os documentos). Nenhum
  número calculado no aparelho.
- Rotas novas (consultas, seção 55): `financeiro.lancamentos`, `financeiro.lancamento` (`FinancialService.consultaLancamentos`,
  `consultaLancamento`) e `financeiro.conciliacao` (`Conciliacao.consulta`).
- `src/Conciliacao.js` (novo, puro): `fatos(tx)` lê uma vez as linhas vigentes; `caixa` (visão 1), `resultado` (visão 2, com o custo
  de aquisição de quem saiu em três linhas e a competência por período pelo maior resto por mês e por dia), `posicao` (a receber, a
  pagar, custo do rebanho ativo, insumos, despesa antecipada líquida de receita antecipada, saldo de abertura, não operacional),
  `identidade(t)` (a aritmética da 2.1), `termosEm` e `conferir` (a identidade no fim de cada mês e no período, e os meses somando o
  período). Regra de tempo: só o lançamento com competência até D, a parcela paga até D e a saída até D; o histórico anterior ao
  marco zero fica fora das três visões.
- Testes: `tests/conciliacao.test.js` (o caso do 07, seção 2.2, mês a mês e nas três datas da conciliação; o arrendamento anual da
  1.1; a parte até o dia; o que a identidade acusa; a regra de tempo; 400 bases sorteadas), `tests/financeiro.lancamentos.test.js`
  (as três rotas por todo caminho que grava lançamento — rebanho inicial com abertura, compra importada e a histórica, venda com
  retenção, morte com custo e o estorno, entrada de estoque e consumo, correção sem mudança, desfazer da importação — e a regra de
  tempo pela rota), `tests/ui/fase4.base.test.js` (Playwright: Eventos e Configurações sob demanda, falha de rede e volta;
  Financeiro a 1280 e 360 px). A identidade passou a ser conferida também depois de cada comando dos testes que usam
  `tests/apoio-sistema.js` e `tests/apoio-eventos.js` (conferida por mutação: tirar o consumo dos insumos derruba os testes de
  estoque) e na base de demonstração (`tests/acceptance.test.js`: três anos, todo fim de mês fecha). Testes ajustados ao que mudou de
  propósito, sem enfraquecer: a fase e os módulos (`events`, `api`, `telas.sobdemanda`, `interface`, `ui/interface`,
  `ui/sobdemanda`: o Financeiro no menu; Relatórios como o módulo ainda não entregue; as Configurações pedidas sob demanda).
- Teste aleatório (`tests/apoio-fuzz.js`): `oraculoConciliacao` depois de todo passo que grava (a identidade em todo fim de mês e no
  período, a soma dos meses, e os termos de hoje contra um modelo das linhas cruas, com o custo do rebanho ativo = a soma da projeção
  `custo_aquisicao`); a viagem no tempo ganhou os grupos `conc` e `lanc`; o oráculo da correção, a conciliação na bateria b4.
  As sementes fixas passam a exigir que o oráculo novo confira de verdade (custo do rebanho ativo, saldo de abertura, insumos e custo
  de aquisição de quem saiu). Leva nova com o código final: 200 sementes × 100 passos (8100000 a 8100199), 11.927 aceitos, 6.654
  recusados, 0 falhas; a conciliação conferida em 11.043 passos (102.437 fins de mês). Por mutação (a saída do dia D fora do rebanho
  ativo), a semente 8100003 falha no passo 53 com `CONCILIACAO:IDENTIDADE`.
- Ficou para as próximas etapas (seção 55, "Premissas"): a baixa não antes da competência (E4.2), o avulso de aquisição rateado 100% e
  o período só em custeio e outra receita (E4.1), o rateio vigente em D (E4.3). `docs/fase-0/` não mudou (o 01, seção 6.2, ainda diz
  que Events e Settings ficam na página inicial; atualizar na entrega da fase). Esta etapa não fez commit nem push.
