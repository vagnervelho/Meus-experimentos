# 13 — Revisão adversarial do desenho

## Em resumo

- Antes de redigir os documentos da Fase 0, o desenho-base (v1) foi atacado por sete revisores independentes, cada um com uma lente. Eles devolveram **110 achados: 5 bloqueantes, 39 altos, 56 médios e 10 baixos**.
- Nenhuma API inventada foi encontrada. Os cinco bloqueantes eram defeitos reais de desenho e mudaram a arquitetura: estorno, financeiro, importação histórica e reprodução.
- Dos 110 achados, 94 foram adotados como propostos, 14 foram adotados com ajuste, 1 virou pergunta ao dono, já respondida, e 1 não foi adotado (a alternativa escolhida está explicada).
- O que a revisão não pôde fechar — comportamentos de plataforma sem fonte legível nesta sessão — virou item do spike técnico da Fase 1 (SP-01 a SP-10).

**Documentos relacionados:** `11-riscos-e-premissas.md` (riscos e premissas que saíram daqui), `12-fatos-de-plataforma.md` (fatos e fontes), `10-plano-de-implementacao.md` (spike).

## 1. Método

Cada revisor leu a especificação inteira e o desenho-base, sem ver o trabalho dos outros, com a instrução de devolver só achados com cenário concreto de falha (ou requisito violado) e recomendação específica. O arquiteto leu os 110 achados e decidiu um a um.

| Lente | O que atacou | Bloq. | Alta | Média | Baixa | Total |
|---|---|---:|---:|---:|---:|---:|
| Plataforma (P) | Existência de cada API citada, cotas, limites do Sheets, coerção de tipos, escopos, iframe | 0 | 4 | 6 | 2 | 12 |
| Integridade (INT) | Protocolo de gravação ponto a ponto, concorrência, linha do tempo, idempotência | 1 | 5 | 8 | 0 | 14 |
| Modelo de dados (MD) | Campo a campo contra a §4, solidez relacional, adequação ao Sheets | 1 | 6 | 6 | 1 | 14 |
| Zootecnia (PEC) | Categorias, reprodução, pesagem, comercialização, sanidade, identificação | 1 | 6 | 6 | 1 | 14 |
| Finanças (FIN) | Três visões de resultado, rateio, compra e venda, patrimônio, indicadores | 1 | 7 | 6 | 0 | 14 |
| Cobertura (COB) | Cada requisito da especificação (§1 a §23) contra o desenho | 1 | 7 | 17 | 5 | 30 |
| UX e front-end (UX) | Viabilidade da SPA no iframe, fluxo de registro, celular, estados e erros | 0 | 4 | 7 | 1 | 12 |
| **Total** | | **5** | **39** | **56** | **10** | **110** |

Limite do método: os revisores não tiveram acesso à documentação oficial do Google (bloqueada pelo proxy da sessão). Assinaturas de métodos foram conferidas nos tipos `@types/google-apps-script` e nos discovery docs; comportamentos (coerção de tipos, liberação de lock, escopos) ficaram como "não verificado" e foram para o spike.

## 2. Os cinco bloqueantes

### 2.1 Estorno revertia o efeito duas vezes (INT-01 e MD-01)

**Defeito na v1.** O catálogo dava ao evento ESTORNO um efeito "inverso do original", e ao mesmo tempo o original passava a `ESTORNADO` e saía da soma do inventário. Cenário: transferência de 10 animais do pasto A para o B, depois estornada. Pela primeira regra, o estorno grava B→A; pela segunda, a transferência original deixa de contar. No replay, os animais "voltam" para A duas vezes e a cadeia de localização quebra. No estoque o erro era explícito: movimento inverso mais saída original tornada inerte. Além disso, o estorno alterava várias células (status do novo, status do original, lançamentos), o que contradizia o commit em uma célula.

**Correção na v2.** Um modelo só, o de anulação: o ESTORNO não tem efeito próprio nem linhas filhas; ele anula o original, que sai do replay. "Vigente" passou a ser um predicado único (operação confirmada, não é estorno, não foi anulado, importação concluída). `EVENTOS.status = ESTORNADO` virou cache derivado, gravado depois do commit. "Corrigir evento" deixou de ser dois eventos e virou um evento substituto, que anula e substitui no mesmo commit.

### 2.2 Lançamento financeiro e parcela na mesma linha (FIN-01)

**Defeito na v1.** FINANCEIRO tinha "uma linha por parcela" e era, ao mesmo tempo, o alvo dos rateios. Cenário: compra de R$ 60.000,00 em 3 parcelas. As alocações por animal apontavam para a parcela, então o custo de aquisição de cada animal ficava dividido em três rateios, e a regra "soma das alocações = valor do lançamento" não fechava com "custo de aquisição = valor individual + frete". Também não havia onde registrar valor efetivamente pago, juros, desconto ou baixa parcial.

**Correção na v2.** Dois níveis: FINANCEIRO é o fato econômico (conta, competência, valor, vínculos; único alvo de rateio) e PARCELAS é o título (vencimento, valor nominal, valor pago, juros, desconto, status). Lançamento sem parcela passou a existir como fato sem efeito de caixa (consumo de insumo, saldo de abertura do rebanho).

### 2.3 Importação histórica colidia com a linha do tempo (COB-01)

**Defeito na v1.** O validador exigia "animal no rebanho na data" e continuidade de pasto. Cenário: rebanho implantado em 01/12/2026 e importação de uma pesagem de 10/03/2025. Se a entrada inicial for datada da implantação, a pesagem é rejeitada (animal ainda não existia); se for datada do passado, todas as transferências antigas teriam de ser importadas e fechar a cadeia, o que raramente é possível. Faltava ainda a rotina de reconciliação exigida pela §14.

**Correção na v2.** Marco zero (D0, `data_marco_zero`): a entrada inicial é a fotografia do rebanho em D0; a linha do tempo é validada de D0 em diante; o que é anterior entra como registro informativo (`pre_marco_zero`), fora do replay, validado só contra nascimento e data de entrada informada. Consultas anteriores a D0 devolvem "sem dado" com motivo explícito, e a reconciliação é um relatório de divergências com decisão registrada.

### 2.4 Reprodução sem o fato "exposição à monta" (PEC-01)

**Defeito na v1.** O modelo só conhecia cobertura individual datada. Cenário: touro solto com 80 vacas de novembro a janeiro, sem data de cobertura por vaca (manejo dominante nesse porte). O conjunto "expostas" — denominador da taxa de prenhez e da natalidade no próprio desenho — não tinha origem nos dados, e a previsão de parto não tinha de onde sair. A §9 exige denominadores documentados.

**Correção na v2.** Tabela ESTACOES_MONTA e evento coletivo de EXPOSICAO (matrizes, touros, estação, entrada e retirada). "Exposta na estação" tem definição única, e a previsão de parto tem três níveis (data de IA ou cobertura; diagnóstico com idade gestacional; janela da exposição), sempre rotulada como estimativa.

## 3. Achados de severidade alta

Decisão: **A** = adotado como proposto; **AA** = adotado com ajuste (a diferença está descrita); **N** = não adotado.

| ID | Problema | Decisão | Onde ficou |
|---|---|---|---|
| P-01 | Gravação dependia de três comportamentos de coerção de tipos sem fonte | A | Primitiva tipada preferida, corpus de ida e volta, saneamento só na exportação (`06`, SP-01) |
| P-02 | Marcador e versão em Script Properties vazavam entre bancos; "lock livre" não tem API | A | Chaves por planilha; verdade em OPERACOES; `tryLock` e releitura (`06`) |
| P-03 | `drive.file` só vale para arquivo criado pela Drive API | A | Todo arquivo nasce pela Drive API; lint proíbe `DriveApp`; restauração por comando (`01`) |
| P-04 | Colunas JSON podiam passar de 50.000 caracteres no meio do commit | A | Teto de 40.000 validado antes de gravar; nenhuma coleção por animal em célula (`03a`) |
| INT-02 | Projeções eram gravadas antes do commit | A | Três fases: anexa, confirma, aplica derivados (`06`) |
| INT-03 | Protocolo assumia um comando = um evento; importação gera N | A | Lotes com N eventos por operação; commit do arquivo por `IMPORTACOES.status` (`06`) |
| INT-04 | Corrigir evento que cria animal trocava o `animal_id` | A | Substituto reaproveita os `animal_id`; situação ANULADO (`04`) |
| INT-05 | Atributos alterados por evento não eram projeção | A | Atributos sensíveis como projeção; valores de criação em `atributos_iniciais_json` (`03a`, `03b`) |
| INT-06 | Detector de operação morta decidia com dados velhos | A | Recuperação reentrante, com releitura sob lock (`06`) |
| MD-02 | Sem data de implantação nem regra para a entrada inicial | AA | Marco zero combinado com COB-01; custo de abertura por lançamento sem parcela, em vez de exceção em `valor_individual` |
| MD-03 | Animal de evento anulado não tinha estado | AA | Situação ANULADO; animal EXTERNO por comando sem evento, em vez de um evento de cadastro externo |
| MD-04 | Projeções sem estado inicial (parida, castrado, prenhez) | A | `partos_previos`, `castrado`, situação reprodutiva inicial na entrada (`03a`) |
| MD-05 | Custo sanitário em quatro lugares; estoque sem entrada | AA | Custo no consumo por lançamento sem parcela (FIN-04); estoque opcional por produto, com evento ESTOQUE |
| MD-06 | Parcela misturada com lançamento; alocações inchadas | A | PARCELAS; alocações enxutas, critério em RATEIOS (`03b`) |
| MD-07 | Uma operação = um evento; idempotência em dois lugares | AA | `EVENTOS.op_id`; a célula de commit passou a ser `OPERACOES.status` (uma célula para N eventos), em vez de confirmar um bloco de status |
| PEC-02 | Categorias-semente classificavam errado na implantação | A | Atributos `reprodutor` e `partos_previos`; sementes revistas; cobertura total validada (`07`) |
| PEC-03 | Brincagem de rotina virava "ajuste de inventário" | A | Evento IDENTIFICACAO; BRINCO_ORIGEM sem unicidade (`04`) |
| PEC-04 | Situação reprodutiva em um eixo só | A | Duas projeções (`situacao_reprodutiva`, `cria_ao_pe`) e marca de descarte por evento MARCACAO |
| PEC-05 | Natimorto com dois caminhos; parto sem contar | A | Um parto = um evento = uma linha, com nascidos vivos e natimortos (`04`) |
| PEC-06 | Venda para frigorífico sem carcaça nem preço por animal | A | `peso_carcaca_kg` e `preco_unitario` por animal; `rendimento_tipo` (`03b`, `07`) |
| PEC-07 | Indicadores reprodutivos sem definição ou denominador | A | Dicionário de indicadores por estação (`07`) |
| FIN-02 | Três visões com dupla contagem e lacunas | A | Fórmulas por natureza; teste de conciliação (`07`) |
| FIN-03 | Seis lugares com dinheiro por animal, sem dono | A | Alocações como única fonte de leitura; demais são cópia ou base (`02`, `07`) |
| FIN-04 | Compra e consumo de insumo contados duas vezes | A | Insumo vira custo no consumo; natureza ESTOQUE_INSUMOS (`07`); premissa PR-11 |
| FIN-05 | Uma conta "Transporte" para três naturezas | A | Uma natureza por conta; sementes explícitas; natureza NAO_OPERACIONAL (`07`) |
| FIN-06 | Rebanho inicial e nascidos sem custo de aquisição | A | Valor de abertura opcional; `custo_aquisicao_origem`; resultado "parcial" quando falta (`07`) |
| FIN-07 | Correção financeira sem caminho com parcela paga | AA | Sem evento de retificação próprio: o evento substituto cobre, transportando as baixas; `fin_bloqueio_ate` adotado |
| FIN-08 | Invariante de rateio contraditória; quatro vocabulários de critério | AA | Enum único; invariantes revistas; re-rateio como evento RATEIO, em vez de marcar o anterior como substituído |
| COB-02 | Fase 1 recebia dados sem meio de corrigir | A | Ajustes e estorno de entradas na Fase 1 (`10`) |
| COB-03 | Financeiro de compra e venda sem fase | A | Princípio P11: evento grava fatos completos na fase em que nasce |
| COB-04 | Importação inteira na Fase 1, eventos nas Fases 2 e 3 | A | Importadores fatiados por fase (`10`) |
| COB-05 | Importação sem granularidade nem retomada | AA | Lotes retomáveis; commit do arquivo inteiro em uma célula; granularidade por lote |
| COB-06 | Correção de evento criador | A | Substituição no lugar, validada uma vez (`04`); situação ANULADO |
| COB-07 | Compra só criava animal novo; origem real apagada | AA | Origem como fato cadastral; reentrada de animal vendido suportada na máquina de estados, em vez de ficar fora do MVP |
| COB-08 | Estoque e custo de produtos ambíguos | AA | Custo reconhecido no consumo, não na compra (FIN-04) |
| UX-01 | Formulário e chave só em memória | A | Rascunho persistente; `operacao.status` (`08`) |
| UX-02 | Pesagem coletiva sem digitação sequencial | A | Modo curral (`08`) |
| UX-03 | Protocolo sem aviso com aceite | A | `NEEDS_CONFIRMATION` e `avisos_politica` (`01`) |
| UX-04 | Catálogo de eventos sem poder expressivo | A | Esquema fechado do EventCatalog (`04`) |

## 4. Achados médios e baixos

| ID | Tema | Decisão |
|---|---|---|
| P-05 | `batchUpdate` atômico pode reduzir o protocolo a uma requisição | A (decide o spike, SP-01) |
| P-06 | Exportação XLSX/PDF e download no iframe | A |
| P-07 | Normalização na leitura; fuso e locale da planilha | A |
| P-08 | Desempenho, volumetria, cache | A (MVP sem CacheService; leituras declaradas por evento) |
| P-09 | Superfície pública e gatilhos | A (sem gatilho mensal: os snapshots saíram) |
| P-10 | Importação de XLSX e CSV | A |
| P-11 | Publicação: versões, várias contas, `doPost` | A |
| P-12 | Fotos: miniatura e leitura pela Drive API | A |
| INT-07 | Eventos no mesmo dia | A |
| INT-08 | Leitura durante gravação | A |
| INT-09 | Idempotência: autoridade e hash do conteúdo | A |
| INT-10 | Comandos sem evento | A |
| INT-11 | Registros que escapavam da regra de vigência | AA (estoque mantido como opcional, com evento ESTOQUE) |
| INT-12 | Máquina de estados incompleta | A |
| INT-13 | Marcador e versão globais ao projeto | A |
| INT-14 | Derivados persistidos (categoria, snapshots) | A |
| MD-08 | Tipos de coluna e limite de célula | A |
| MD-09 | Plano de contas e vínculos | AA (natureza pertence à conta e é copiada no lançamento) |
| MD-10 | Redundâncias sem fonte declarada | A |
| MD-11 | Enums incoerentes | A |
| MD-12 | Monta natural, estação, parto | AA (EXPOSICAO e ESTACOES_MONTA, da PEC-01) |
| MD-13 | Quantidade de abas, índices | AA (EVENTO_ANIMAIS mantém linha para todo animal de todo evento, conferida na integridade) |
| MD-14 | Divergências não registradas | A |
| PEC-08 | Pesagem e desempenho | A |
| PEC-09 | Lotação com peso vencido | A |
| PEC-10 | Deduções, finalidade, carência | A |
| PEC-11 | Sanidade coletiva: dose e consumo | A |
| PEC-12 | Descarte, consumo próprio, não localizado | A (evento de contagem fica para depois) |
| PEC-13 | Manejos no mesmo dia | A |
| PEC-14 | Gado de terceiros e pasto alugado | Virou a premissa PR-12, respondida em 14/11/2026: sem gado de terceiros; pasto arrendado incorporado (DV-20) |
| FIN-09 | Arroba e fórmulas de preço | A |
| FIN-10 | Descontos, retenções, recebimento | A |
| FIN-11 | Vínculo a período e a evento | A |
| FIN-12 | Regras de valoração do patrimônio | A |
| FIN-13 | Snapshot mensal por animal | **N** (ver seção 5) |
| FIN-14 | Indicadores do dashboard e relatórios 14 a 17 | A |
| COB-09 | Backup e integridade na Fase 1 | A |
| COB-10 | Identificação como evento de rotina | A |
| COB-11 | Nascimento e natimorto | A |
| COB-12 | Venda com peso só do lote | A |
| COB-13 | Descarte × venda | A |
| COB-14 | Indicadores reprodutivos | AA (definições da PEC-07) |
| COB-15 | Agenda sanitária | A |
| COB-16 | Lista fechada de alertas | A |
| COB-17 | Indicadores do dashboard | A |
| COB-18 | Níveis de confiabilidade | A |
| COB-19 | Menu × fases | A |
| COB-20 | Itens sem fase | A |
| COB-21 | Semeadura por chave natural | A |
| COB-22 | Contadores e estado por planilha | A |
| COB-23 | Anexos | A |
| COB-24 | Testes adicionais e concorrência real | A |
| COB-25 | Entregáveis 7, 11 e 12 no desenho | A |
| COB-26 | Patrimônio sem tabela de snapshot | A |
| COB-27 | Lote sem entidade no MVP | A |
| COB-28 | GMD por pasto | A |
| COB-29 | Progenitor externo | A |
| COB-30 | Unidade de peso | A |
| UX-05 | Store, bootstrap, data retroativa | A |
| UX-06 | Estados e erros | A |
| UX-07 | Simulação só onde compensa | A |
| UX-08 | Entrada por contexto; cadastro embutido | A |
| UX-09 | Celular e legibilidade | A |
| UX-10 | Dashboard: filtros × indicadores | A |
| UX-11 | Relatórios, exportação, importação | A |
| UX-12 | Dependência de CDN | A (decide o spike, SP-08) |

## 5. Onde o arquiteto escolheu outro caminho

| Tema | Proposta do revisor | O que o desenho fez | Por quê |
|---|---|---|---|
| Série patrimonial (FIN-13) | Snapshot mensal com uma linha por animal | Nenhuma tabela de snapshot: patrimônio em D = inventário em D por replay × preço vigente em D | Dois outros revisores (COB-26, INT-14) mostraram que o snapshot fica errado com evento retroativo e exige regra de regeneração. Como TABELA_PRECOS tem vigência, o cálculo na leitura é reproduzível e dispensa a tabela e o gatilho mensal. Custo aceito: meses sem preço cadastrado aparecem como "sem valor de referência" |
| Célula de commit (MD-07, INT-10) | Confirmar um bloco de status de eventos; `OPERACOES.status` só para comandos sem evento | `OPERACOES.status` é a célula de commit de qualquer comando | Um mecanismo só para evento único, vários eventos e comando sem evento; a recuperação tem uma regra em vez de duas |
| Correção financeira (FIN-07) | Evento próprio de retificação financeira | Evento substituto do mesmo tipo, transportando as baixas | Um caminho de correção em vez de dois; nessa escala, regravar as linhas de uma compra de 20 animais é barato |
| Estoque de insumos (MD-05, INT-11) | Eliminar o razão de estoque | Estoque opcional por produto, desligado por padrão, com evento de entrada e ajuste | A §4.10 lista estoque atual e mínimo e o cenário 6 da §18 pede consumo; a regra de custo no consumo já exige o movimento de saída |
| Reentrada de animal (COB-07) | Declarar recompra fora do MVP | Máquina de estados admite reentrada | A §6.2 pede "cadastrar ou associar"; o validador já trata pares de entrada e saída, e a permanência por períodos é necessária para o rateio por dias |
| Gado de terceiros (PEC-14) | Criar `proprietario_id` agora | Perguntar ao dono (PR-12) antes de criar a coluna | Resposta: não há gado de terceiros nem parceria, então a coluna não existe. Há pasto arrendado, que entrou no modelo por `PASTOS.posse`, `PASTOS.arrendador_id` e uma conta de arrendamento |
| Entidade LOTES (desenho v1) | Manter com regras de continuidade | Retirada do MVP | Dois revisores (MD-13, COB-27) mostraram que criava uma segunda cadeia na linha do tempo sem requisito que a pagasse; a §22 trata comparação entre lotes como futuro |

## 6. O que a revisão confirmou como sólido

- **Plataforma:** todas as assinaturas citadas existem; o manifesto do Web App (`USER_DEPLOYING`, `MYSELF`) está correto; as cotas usadas conferem com a pesquisa anterior do projeto irmão.
- **Integridade:** lock único, validação integral antes de gravar e linhas filhas inertes até a confirmação são a base certa para eventos que só anexam linhas; o validador único de linha do tempo cobre evento novo, retroativo, estorno e auditoria.
- **Modelo de dados:** nenhum campo das §4.1 a §4.13 está ausente; o modelo responde às oito consultas obrigatórias.
- **Zootecnia:** histórico de identificadores, separação entre peso vivo e carcaça e confiança por data foram considerados adequados.
- **Finanças:** grupo × natureza, razão de alocações por animal, centavos com maior resto, custo de aquisição reconhecido na baixa e "não alocado" explícito.
- **Cobertura:** as 20 regras da §16 e os mecanismos de integridade da §2 estavam cobertos; as lacunas eram de decisão, não de detalhe.
- **UX:** o esqueleto técnico (template com includes, envelope, roteador, busca no cliente, chave de idempotência) é viável; o projeto irmão já usa cada peça.

## 7. O que ficou em aberto

| Ponto | Por que não foi fechado | Onde se resolve |
|---|---|---|
| Coerção de tipos na gravação e atomicidade do `batchUpdate` | Sem fonte legível; relatos conflitantes | SP-01 |
| `drive.file` para criar, copiar e exportar | Comportamento do escopo não confirmado | SP-02 |
| Liberação do lock quando a execução morre por timeout; destino do buffer não descarregado | Sem fonte | SP-03 |
| E-mail do usuário ativo no modo de publicação escolhido; várias contas no navegador | A documentação é ambígua para conta pessoal | SP-04 |
| Tempo real de leitura e gravação com tabelas grandes | Só medindo | SP-05 |
| `localStorage` dentro do iframe no celular; tamanho de payload | Depende do navegador | SP-06 |
| Abrir arquivo exportado no celular | Sem evidência | SP-07 |
| Biblioteca de gráficos por CDN dentro do iframe | Precisa de teste | SP-08 |
| Manejo reprodutivo, forma de venda, controle de estoque e demais premissas de negócio (a de gado de terceiros já foi respondida) | Só o dono sabe | PR-01 a PR-16 |

## 8. Segunda revisão

Os documentos da Fase 0, depois de redigidos, passam por uma segunda revisão (consistência entre documentos, exatidão do protocolo e conferência numérica dos exemplos financeiros). O resultado dessa segunda passada está registrado no `README.md` da pasta, na seção sobre o que foi e o que não foi verificado.
