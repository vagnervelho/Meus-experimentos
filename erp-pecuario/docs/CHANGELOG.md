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
