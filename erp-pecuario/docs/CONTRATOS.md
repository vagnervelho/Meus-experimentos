# Contratos entre módulos (Fases 1 a 3)

Interfaces que cada etapa entrega para as seguintes. Uma seção curta por módulo: funções públicas, parâmetros,
retorno e erros. Quem acrescenta um módulo acrescenta a seção dele aqui. O desenho está em `docs/fase-0/`; este
arquivo descreve o que **existe no código**.

Estado: etapas BASE (E1.1 e parte da E1.2) — `Schema`, `Utils`, `Validation`, harness e estrutura —, PERSISTÊNCIA
(E1.3 e E1.4) — `Database`, `Repository`, `UnitOfWork` e `AuditService` (parte 1) — e MOTOR DE EVENTOS (E1.6) —
`EventCatalog`, `Timeline` e `EventService` — e SERVIÇOS DE CADASTRO E CONSULTA (E1.7 e E1.8) — `Config`, `AnimalService`,
`PastureService` e `InventoryService` (seção 15) — e OPERAÇÃO DO SISTEMA (E1.10 e E1.11, backend) — `FileService`,
`Maintenance`, `AuditService` (parte 2) e `ImportService` (seções 11, 16 a 18) — e API E PONTOS DE ENTRADA (E1.5 e parte
da E1.12) — `Api`, `Code` e `TestRunner` (seções 19 a 21) — e INTERFACE, NÚCLEO E COMPONENTES (E1.9, parte 1) — `Index`,
`Styles`, `JavaScript`, `Components` e `Dashboard` (seção 22) — e TELAS DA FASE 1 (E1.9 parte 2, E1.8 e E1.10 na tela) —
`Dashboard`, `Animals`, `Pastures`, `Events`, `Settings` e `Import` (seção 23). Fase 2, etapa MOVIMENTOS E SAÍDAS (E2.1, E2.2
e E2.5): NASCIMENTO, TRANSFERENCIA, MORTE e DESCARTE no motor (seções 12 a 14), `ReproductionService` (seção 24),
`inventario.elegiveis` (seção 15.4), ficha com os blocos D e G (parte de partos) e as telas (seção 25). Fase 2, etapa
FINANCEIRO DO EVENTO E COMPRA (E2.3): `FinancialService` (seção 26), COMPRA e os lançamentos opcionais da MORTE e do
DESCARTE no motor (seções 12 e 14), parceiros validados nos eventos, plano de contas no bootstrap (seção 15.1), ficha com
o bloco H (seção 15.2), títulos na visão geral (seção 15.4) e as telas (seção 27). Fase 2, etapa VENDA (E2.4): VENDA no
motor (seções 12 e 14) com o financeiro do próprio evento (`FinancialService`, seção 26: deduções, totais da venda,
carcaça do romaneio, base estimada), a carência na venda (`HealthService`, seção 28), o CT-09 inteiro na aceitação
(seção 21) e as telas (seção 29). Fase 2, etapa ATAQUE AO MOTOR E AO FINANCEIRO: o modelo de referência e os oráculos independentes (seções 6.6 e 31) e as
correções que eles acharam (elegíveis de fato no dia da saída, seção 15.4; origem da correção de localização na posição,
seção 14; consultas da linha do tempo com acesso cru, seção 13; mensagens com número brasileiro e um erro por causa na
negociação, seções 3 e 26). Fase 2, etapa IDENTIFICAÇÃO, MARCAÇÃO, AJUSTES E ESTORNO GERAL (E2.6 e E2.7, backend):
IDENTIFICACAO, MARCACAO e os subtipos RECLASSIFICACAO e DIVERGENCIA_CONTAGEM no motor (seções 12 a 14), as sequências de
identificação e de marcação e a retirada de brinco no projetor (seção 13), a trilha completa de `auditoria.listar` (seção
11), o alerta NAO_LOCALIZADO (seção 15.4) e o estorno e a correção de qualquer evento (seção 30). Fase 2, etapa ANEXOS DE
EVENTO (E2.9): anexos de evento e de lançamento financeiro de evento no `FileService` (seção 16), `evento.obter` com os
anexos e a correção que os passa ao substituto (seção 14), o componente `Anexos` e a seção "Documentos e fotos" do
detalhe do evento (seção 32). Fase 2, etapa INVENTÁRIO HISTÓRICO E LOTAÇÃO (E2.8): situação na data, estadas, presentes e
dias de permanência na `Timeline` (seção 13), o leitor com fonte própria e a categoria memorizada (seção 15.2), o painel do
pasto em data com o "desde quando", o peso médio e os dias de permanência (seção 15.3), a posição com filtros e situação
e a visão geral com o movimento do período (seção 15.4), o aviso de lotação também em UA/ha (seção 14) e as telas
(seção 33). Fase 2, etapa IMPORTADORES DE EVENTOS HISTÓRICOS (E2.10): COMPRAS, VENDAS,
TRANSFERENCIAS, NASCIMENTOS e MORTES no `ImportService` (seção 18.2: modelo por tipo, agrupamento, ensaio em memória com o
planejamento do formulário, lotes de eventos inteiros, desfazer, reconciliação e a rota `importacao.reconciliacao`), o
histórico anterior ao marco zero pela importação no motor (`planejarEventoImportado`, seção 14) e a tela de importação
por tipo (seção 23). Fase 2, etapa VERIFICAÇÃO DE INTEGRIDADE COMPLETA (E2.11): as checagens da Fase 2 no `AuditService` (saída com
evento posterior, partos, brinco ativo repetido, custo de aquisição e as invariantes do financeiro pela conferência do
`FinancialService`; seção 11) e o 100% alocado também na morte e no descarte (seção 26). Fase 2, etapa INTERFACE DOS
EVENTOS (E2.1 a E2.7 na tela): formulários de todos os tipos e subtipos ativos (campo de cabeçalho do subtipo, grade de
animais novos em série e colada de planilha, parcelas divididas em N, o valor de cada animal e o financeiro do estorno na
revisão, o conflito com o link do lançamento que impede), correção de todo tipo pelo detalhe, alocações no detalhe, atalhos
"Mais registros" da ficha e "Vender daqui" do pasto, a trilha completa na tela de auditoria (seção 34), a página compactada
no doGet (seção 19) e o motivo da baixa por divergência no evento (seção 14). Fase 2, etapa INTERFACE DE PASTOS, IMPORTAÇÃO
E ANEXOS (E2.8 a E2.10 na tela): `pasto.listar` com a data (seção 15.3) e a lista de pastos na "posição em [data]" com o
"Sem dado" e o motivo, as linhas de cada lançamento em `importacao.linhas` (seção 18), "Deixar de fora" (`ignorar_linhas`)
e a reconciliação em tabela no assistente de importação, e os documentos escolhidos no formulário de evento (seção 35). Fase 2,
etapa ACEITAÇÃO (nível 2 e jornada): os cenários da Fase 2 e a reconciliação do CT-12 em `runAcceptanceTests`, a base de
demonstração completa de 09, seção 7 (seção 21), a jornada e o mapa RN → teste (seção 21, testes), e as correções que eles
acharam: valor inválido com um erro só, em português, no lançamento (seção 26), e o erro de campo do animal já
cadastrado com `animal_id` e brinco, sem repetir no cabeçalho da negociação (seção 14). Fase 2, conserto da revisão
independente (rodadas 1 e 2): o contrato do conflito `{event_id, tipo, subtipo, data, nome}` e `EventCatalog.nomeEvento`
(seções 12 e 14), a chegada declarada (`Timeline.chegadaDeclarada`, seção 13), `EventService.conferirRestauracao` e a
genealogia devolvida pelo estorno (seção 14), a checagem GENEALOGIA (26 checagens, seção 11), `evento.obter` com `papeis`
e `totais_venda`, o estorno simulado com `corrige` e `cancelados` (receitas e despesas), as parcelas mensais dos custos
(`FinancialService.parcelasMensais`, seção 26) e uma importação em curso por vez (`IMPORTACAO_EM_CURSO`, seção 18).
Fase 2, conserto da revisão independente (rodada 3): o pai do parto conferido mesmo sem cria viva e o touro dos registros
reprodutivos no RN-012, no estorno, no desfazer da importação e na GENEALOGIA; o estorno e a correção conferindo os
registros antigos com o nascimento e a chegada que voltam; a chegada do conjunto final na correção de quem criou o animal;
o nascimento do filho conferido com os pais; um número de brinco em um animal por vez (`conferirPeriodosDeBrinco_`, com o
reuso ligado também); o conflito com o tipo e a data do lançamento, uma vez por lançamento (seção 14); o detalhe
obrigatório, a dedução retida e a base do rateio de todo critério na integridade (seção 11); o brinco pela identificação em
uso na data, o desfazer recusado com outra importação em curso e a reconciliação com as correções do marco zero (seção
18); o rascunho no servidor em partes e as falhas dele avisadas (seções 19 e 22); a prévia da correção sem os padrões do
servidor e com o item desativado do original (seções 22 e 34).
Fase 2, conserto da revisão independente (rodada 4): o conjunto final em todo caminho, com os períodos de brinco também no
estorno, na correção que tira a linha de brinco e no desfazer, a chegada que não fica antes do nascimento, a genealogia do
conjunto final, a categoria manual que serve ao sexo (`CATEGORIA_INCOMPATIVEL`), o pai do parto igual ao da cria
(`PAI_DA_CRIA`), o pasto, a propriedade e a categoria desativados do original na correção e o conflito que aponta a
correção que criou o vínculo; `evento.obter.propostas`, `impactos.voltam` e `impactos.anexos_nomes`; a ordem pela cadeia
de substituição na lista de eventos (seção 14); a fonte de cada evento em COPIAS, a chegada e a categoria em
LINHA_DO_TEMPO e a base estimada em BASE_RATEIO (seção 11); `Timeline.entradaDoCusto` e `ultimaPesagem` (seção 13);
`FinancialService.tiposDosCustos` pela ordem do `financial_id` e `basesEstimadas` (seção 26); a reconciliação com a outra
entrada do marco zero (seção 18); as telas da rodada (seção 34).
Fase 2, DOCUMENTAÇÃO DE ENTREGA: este arquivo conferido com o código por amostra (a superfície pública de cada módulo
contra as seções e as 63 rotas de `Api.rotas()`: 51 canônicas, 12 extras), sem mudança de contrato.
Etapa TRAVA ÚNICA DE INTEGRIDADE ANTES DE GRAVAR: as checagens de domínio da verificação de integridade numa função só,
com escopo (`AuditService`, seção 11), rodadas pela `UnitOfWork` sobre o retrato do que ficaria gravado, entre o tratador
e a fase A de todo comando, também no SIMULAR (seção 10.5); o retrato em memória com cópia na escrita e a memória refeita
só na aba alterada (`Repository.bifurcar`, seção 9); o financeiro conferido por escopo (`FinancialService.conferir(tx,
escopo)`, seção 26); a fêmea de cada registro reprodutivo que não é parto conferida na GENEALOGIA (seção 11); a medição
`npm run trava:medir` (seção 7).
Etapa TESTE ALEATÓRIO DE TODOS OS COMANDOS (passada 1): o motor do teste aleatório baseado em modelo, a gravação simbólica
da sequência e o encolhimento, as regressões fixas (seção 36); o brinco lançado errado conferido pela posição no registro
(seção 14) e, em todo caminho, pela verificação de integridade e pela trava (LINHA_DO_TEMPO, seções 10.5 e 11).
Fase 3, etapa BASE: `EventCatalog.FASE_ATUAL = 3`, com os tipos da Fase 2 até os da Fase 3 terem campos e o módulo ativo
só com a tela entregue (seção 12); as telas sob demanda — a rota `sistema.tela` (seção 19), o carregador `Modulos` no
cliente e a importação fora da página inicial (seções 22 e 37), o orçamento da página inicial e de cada módulo no
`ui:check` (seção 37) —; a corrida do seletor com data passada (seção 22) e o teste aleatório com o registro único dos tipos
(seção 36).
Fase 3, etapa E3.1 (PESAGEM E MODO CURRAL): o tipo PESAGEM e o módulo PESAGENS ativos no catálogo (seção 12), o tratador
único da pesagem individual, coletiva e por lote no `EventService` com os avisos POSSIVEL_DUPLICIDADE e PESO_IMPLAUSIVEL
(seção 14), `WeightService` (GMD, curva, projeção, desempenho; seção 38), a ficha com o bloco de peso (seção 15.2),
PESAGENS conferida pela trava e pela verificação de integridade (COPIAS, seção 11), a rota `peso.desempenho` (seção 19),
o CT-05 inteiro e o passo 3 do CT-10 na aceitação e as pesagens na base de demonstração (seção 21), a entrada PESAGEM do
teste aleatório (seção 36) e as telas — Pesagens sob demanda, com o desempenho e o modo curral, e a curva em SVG próprio
na ficha (seção 38).
Fase 3, etapas E3.2 e E3.3 (INSUMOS, PROTOCOLOS E SANIDADE): os tipos SANIDADE (seis subtipos) e ESTOQUE (entrada e acerto)
e o módulo SANIDADE ativos no catálogo (seção 12); os cadastros de produto e de protocolo, o estoque como projeção dos
movimentos, o consumo e o custo no momento da aplicação, a carência, a agenda e os alertas (`HealthService`, seção 39); o
tratador único dos dois tipos no `EventService` com os avisos ESTOQUE_INSUFICIENTE, PRODUTO_VENCIDO e CARENCIA_ATIVA
(seções 14 e 39); a conferência de SANIDADE, MOVIMENTOS_ESTOQUE e do lançamento com produto pela trava e pela verificação
(seção 11); as rotas `produto.salvar`, `protocolo.salvar` e `sanidade.agenda` (seção 19); o CT-06 e o cenário SANIDADE na
aceitação e as vacinações e vermifugações na base de demonstração (seção 21); as entradas SANIDADE e ESTOQUE do teste
aleatório (seção 36) e as telas — Sanidade sob demanda (agenda, aplicações, produtos e estoque, protocolos), o bloco F da
ficha, a carência no cartão da venda, a revisão, o detalhe e a correção dos dois tipos (seção 39).
Fase 3, etapas E3.4 e E3.5 (REPRODUÇÃO, DESMAMA, CASTRAÇÃO E OCORRÊNCIA): os tipos REPRODUCAO (cinco subtipos), DESMAMA,
CASTRACAO e OCORRENCIA e o módulo REPRODUCAO ativos no catálogo; o cadastro das estações de monta, a previsão de parto, os
indicadores de 07, seção 8.3, as fêmeas e os alertas (`ReproductionService`, seção 40); o tratador único dos quatro tipos no
`EventService` com as regras de manejo (touro castrado, castração repetida, desmama repetida, parto dentro da gestação de um
diagnóstico) conferidas antes e depois do comando, pela verificação e pela trava (seção 40); as rotas `estacao.salvar`,
`reproducao.indicadores` e a extra `reproducao.matrizes` (seção 19); o cenário REPRODUCAO na aceitação e as três estações
na base de demonstração (seção 21); as entradas dos quatro tipos, o cadastro da estação e o replay da situação reprodutiva
e da castração no teste aleatório (seção 36) e as telas — Reprodução sob demanda (fêmeas, diagnóstico no tronco,
indicadores, estações) e o bloco G inteiro da ficha (seção 40).
Fase 3, etapa E3.7 (GRÁFICOS): o kit de gráficos em SVG próprio de `Components` — linha, barras, barras empilhadas e a
curva de peso, com title e desc no SVG, eixos com a unidade, a tabela equivalente com os mesmos textos, o estado vazio e o
desenho na largura útil da tela — e os gráficos das telas da Fase 3 com os números do servidor; em `peso.desempenho`, a
evolução mensal do peso (G5 de 07, seção 9) e o rebanho por categoria em cada pasto (seção 41).
Fase 3, etapa E3.6 (IMPORTADORES DE MANEJO): PESAGENS, SANIDADE, REPRODUCAO e OCORRENCIAS no `ImportService` (seção 42: modelo
de cada tipo, leitura do produto, do protocolo e da estação pelo nome, o subtipo e o touro pela planilha, a linha DUPLICADA
que sai do lançamento de manejo, o registro gerado por linha); o histórico anterior ao marco zero dos quatro tipos no motor
(`HISTORICO_IMPORTADO`, seção 14: na sanidade, sem saída de estoque nem consumo, e a despesa paga no ato sem caixa), a
conferência dele na verificação (COPIAS, seção 11), a situação declarada na entrada que vale como o fato da data dela
(seção 40) e o GMD explicado da pesagem histórica (seção 38); a tela de importação com os tipos novos (seção 23) e as quedas,
o teste aleatório e o Playwright dos importadores (seção 42).
Fase 3, etapa ACEITAÇÃO: os cenários de nível 2 da Fase 3 em `runAcceptanceTests` — CT-05, CT-06, SANIDADE (agenda,
carência na agenda e na venda, o exemplo de 05, seção 4.7), ESTOQUE (o exemplo de 03a, seção 4.7) e REPRODUCAO (RN-060,
061, 064, 066 e os desfechos da estação) —, a base de demonstração com o manejo completo da Fase 3 conferido pelo servidor
no fim (`demonstracao.manejo`), a jornada de um ano da Fase 3 só pela `api()` e o mapa RN → teste da Fase 3 (seção 21).
Fuzz das Fases 1 a 3, passada 1: o gerador do teste aleatório com o curral e o tronco em blocos, as interações da Fase 3
com a Fase 2, o estoque ligado e desligado e os protocolos, e os oráculos novos (chave do bloco, dose por kg, avisos de
estoque e de carência pela transição, agenda, GMD e indicadores) (seção 36).
Fuzz das Fases 1 a 3, passada 2: o preparo das interações e as interações novas (venda e aplicação corrigidas para a
carência, consumo acima do estoque, acerto retroativo, parto da não prenhe, mãe em volta do parto, cria ao pé e desmama com
a venda, pesagem fora da permanência, importação de quem saiu, estação mudada), o produto novo, os parâmetros da Fase 3, o
relógio do pedido, o estoque pelas linhas gravadas, e os oráculos novos (campanha na agenda, cria ao pé, correção sem
mudança mais tarde) (seção 36).
Fase 3, CONSERTO DA REVISÃO: o fato congelado na correção (custo, conta e intervalo do protocolo da aplicação; fator e
movimento da entrada de estoque), o custo em dobro recusado, a duplicidade por animal, a cópia do peso e o saldo do insumo
na verificação e na quarentena, os indicadores reprodutivos e as matrizes na data, o GMD do curral pela conta da ficha, a
agenda sem protocolo, e na tela a recusa que fica na linha, o bloco criado na hora de sair, o curral retroativo pela posição
do servidor, o tronco no Início e os gráficos com um item por lançamento e por categoria (seção 43).
Fase 3, DOCUMENTAÇÃO DE ENTREGA: este arquivo conferido com o código por amostra — a superfície pública de cada namespace
de `src/` contra o texto (entraram as funções de apoio que as seções 38 a 40 não citavam: `WeightService.gmdLote` e
`origemDaPesagem`; `HealthService.fimPeloPeriodo`, `aplicacoesDoAnimal`, `movimentosDoProduto`, `pendenciasDoAnimal` e
`leiturasAgenda`; `ReproductionService.consultaIndicadores`, `consultaMatrizes`, `avisoIdade`, `ehCria`, `castracoes`,
`castradoDeOrigem`, `castradoEm` e `problemasNaFonte`; e, da Fase 1, os `salvar…(ctx, pedido)` de lista, categoria, parceiro
e propriedade nas seções 15.1 e 15.3) e as 65 rotas de `Api.rotas()`: 51 canônicas (9 ainda de fase futura, as das Fases 4
e 5) e 14 extras, todas citadas aqui. As rotas da Fase 3 (`produto.salvar`, `protocolo.salvar`, `estacao.salvar`,
`peso.desempenho`, `sanidade.agenda`, `reproducao.indicadores`) e as extras `sistema.tela` e `reproducao.matrizes` têm
tratador e contrato (seções 19 e 37 a 40). Sem mudança de contrato. Relatório da fase: `docs/RELATORIO_FASE3.md`.
Fase 3, CONSERTO DA REVISÃO (rodada 2): a dose por peso congelada na correção, a contagem do estoque que impede o movimento
anterior a ela (e a conferência do saldo contado), a quantidade do frasco em parte na importação, a entrada de estoque que
congela o movimento (`com_movimento`), a cria ao pé e o brinco na data, a agenda só com o protocolo que já valia, a
estimativa visual estimada no peso e na UA, o GMD da resposta pela conta da ficha, a desmama legítima depois de mudar o
parâmetro, as pesagens de lote dentro do filtro, o produto sem custo avisado, e na tela o curral e o tronco pela posição e
pelo brinco na data, o código interno, o "Desfazer" e o aviso geral, as telas do curral e do tronco trazidas pela Início e o
"(parcial)" da tabela (seção 44).
Fase 3, CONSERTO DA REVISÃO (rodada 3): a carência padrão do produto do cadastro, a contagem do estoque na posição dela dentro
do dia, a revisão da correção que diz o que o servidor grava (`fora_do_estoque`, `porque_sem_custo`), o brinco na data com a
identificação incorreta, a categoria e o último peso na data em `inventario.elegiveis`, as próximas doses da ficha e os partos
da lista de Fêmeas pela mesma conta da agenda e da ficha, a mãe da desmama pela reconstrução na verificação, a recusa da morte
da mãe com o caminho, o dia do cadastro do protocolo no fuso da fazenda, o `gmd_intervalo` e o rótulo único dos pastos, e na
tela o curral e o tronco com o cabeçalho guardado por bloco, a recusa inesperada como pendência, a espera pela posição sem
sinal, o código interno só escrito inteiro, o botão "Prenhe" e o "(parcial)" da lista da estação (seção 45).
Fase 3, CONSERTO PELA GARANTIA (etapa 1, viagem no tempo): a propriedade de toda consulta numa data D (função só dos fatos
até D e dos cadastros que o desenho manda ler como estão hoje), o ponto único do estado em D (`Timeline.fonteAte`,
`Timeline.retratoEm`, `Timeline.periodosDeBrinco`, `AnimalService.retratoEm`), o inventário das rotas e cálculos com data e
das exceções por desenho, os consertos que o oráculo de viagem no tempo do teste aleatório achou e o próprio oráculo (seção 46).

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
| `somaMeses(data, n)` | Data `n` meses depois (`n` inteiro ≥ 0), no mesmo dia; mês mais curto → o último dia dele (31/01 + 1 = 28/02 ou 29/02). Vencimentos mensais |
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
| `formatarNumero(valor, casas?)` | Número nas mensagens ao usuário, no formato brasileiro: `'1.234,5'`, `'0,0001'`; `casas` fixa as casas (meio para cima), sem ela as que o número usa. Não número → `INTERNAL`. Peso, percentual e limite de faixa nas mensagens do servidor passam por aqui (nunca `0.0001`) |
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
{ codigo, animal_id, brinco, campo, mensagem, conflito: { event_id, tipo, subtipo, data, nome } | null }
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
| `bloqueado(aviso)` / `NOME_AVISO` | (Revisão final, achado 8.) O aviso que `avisos_politica` marca BLOQUEIA vira erro com o mesmo código e a frase sem a pergunta ("Gravar mesmo assim?", "Confirme com uma justificativa.") mais "A configuração bloqueia este aviso ("<nome>"): resolva o motivo ou mude a política dele em Configurações › Avisos." (08, seção 8: "chega como erro, sem caixa"). A única conversão: o motor (`EventService`), os cadastros (`Config.aplicarPolitica`) e a UnitOfWork (`AuditService.politicaDosAvisos`) a usam; aplicar duas vezes dá o mesmo |

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
| `session` | Sessão do pedido: `{usuario, ambiente, base_de_teste}` | `Api.contexto`; `null` fora da Api (gatilho, setup) |
| `usuario` | E-mail de quem executa; obrigatório em `UnitOfWork.run` (vai para `OPERACOES.usuario`, `created_by`, `AUDITORIA.usuario`) | `Api` (o dono, também com `ALLOW_EMPTY_ACTIVE_USER`) |
| `fuso` | Fuso IANA de "hoje" | `Api.contexto`: o fuso da planilha-banco (`io.fuso()`), que o setup e o `config.salvar` mantêm igual a `CONFIGURACOES.fuso` (a integridade confere); padrão `Session.getScriptTimeZone()` |
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

`ambiente({primitiva, order, projecoes, gas, nome, propriedade})` (`projecoes` aceita também `(G) => porta`, ex.: `G.Timeline.porta`) cria a planilha-banco com as 34 abas pela própria porta de
E/S e a propriedade que os comandos de exemplo citam (`PROPRIEDADE`; sem ela, o evento de exemplo seria um ERRO de chave
estrangeira e a trava de integridade o recusaria; `propriedade: false` quando o teste semeia o próprio cadastro) e devolve `{gas, G, banco, ctx(), run(cmd), tentarRun(cmd), read(q), status(chave), recoverAll(), marcador(),
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
`Timeline.porta()` e `Timeline.conferir` no desfecho) é o modelo; `cen.ambiente` dá as opções do `ambiente`. Nos cenários da
Fase 2 (venda, correção de compra, estorno de transferência) o desfecho roda também os oráculos de `apoio-oraculos.js`
(`oraculosIndependentes`), e o teste "subconjuntos densos" mata cada um deles ANTES de cada flush da primitiva
SpreadsheetApp (buffer cheio: 27 escritas pendentes na fase A da venda) com todos os subconjuntos até 5 escritas ou 24
sorteados (semente fixa; densidades de 10%, 50% e 90%).

`tests/apoio-oraculos.js` (oráculos independentes, sem Timeline nem FinancialService): `cru(m | amb)` (linhas cruas de
`ABAS_CRU`), `vigencia(r)` (P3 sobre OPERACOES e EVENTOS: `{vig, anuladoPor, confirmado, porId}`), `ordenar(linhas)`
(data, classe, raiz da cadeia, sequência), `replayCru(r)` (`{V, linhas, porAnimal}`), `inventarioDe(linhas, D)`
(`{total, porPasto, semPasto}` ao fim de D), `situacaoDe(linhasDoAnimal)` (`{situacao, pasto, saida, entrada}`),
`invariantesCruas(r)` (03b, seção 14, invariantes 1 a 18 e 20 sobre as linhas cruas; linha de operação que falhou é
inerte e fica de fora) e `maiorResto(V, [{animal, codigo, base}])` (05, seção 4.5, em inteiros).

`tests/apoio-eventos.js`: `ambienteEventos({primitiva, order, marcoZero, config, categorias})` = banco semeado
(propriedade, 5 pastos `PASTOS.A/B/C/INATIVO/PEQUENO` — o último com capacidade de 2 cabeças —, CONFIGURACOES com
`data_marco_zero = 2026-01-01`, LISTAS, PLANO_CONTAS, CATEGORIAS) e o projetor real. `m.run(acao, dados, {chave, avisos})`,
`m.tentar(...)` e `m.simular(...)` conferem, depois de CADA comando, que a projeção gravada = `Timeline.conferir` vazio
e que as invariantes financeiras de 03b, seção 14 fecham (`FinancialService.conferir` vazio); `m.invariantes()` devolve
só os achados financeiros. O cenário `correcaoCompra` da varredura de quedas é a correção de compra de 04, 5.2 (iv).
Construtores: `bicho(extra)`, `entradaInicial(animais, campos)`, `outraEntrada(data, animais, campos)`,
`ajuste(subtipo, data, animais, campos)`; `sementes(G, opcoes)` dá as linhas de semente.


## 7. Scripts e estrutura

| Comando | O que faz |
|---|---|
| `npm test` | `node --test tests/*.test.js` |
| `npm run gen:schema` | Regenera `src/Schema.js`; `-- --check` só confere e sai com 1 se estiver desatualizado |
| `npm run ui:check` | Confere `src/*.html`: nenhum recurso externo (no fonte inteiro) e página ≤ 450 KB medida no que vai ao aparelho (`conferirPaginas(arquivos, medidos)`; `servidas(paginas)` = cada include como o doGet o entrega, por `Api.compactar`) e na página montada pelo doGet; depois, os testes de navegador |
| `npm run gas:push` | Envia `src/` com o clasp (versão fixa por `npx`) e publica; `-- --no-deploy` só envia. Recusa manifesto que não seja o do projeto |
| `npm run trava:medir` | Tempo dos 391 comandos da base de demonstração (TestRunner, `TEST_PLAN = DEMO`) no harness e quanto dele fica em `AuditService.travar`; `-- <raiz>` mede outra cópia do projeto (a de antes da trava, para o "sem a trava"), `-- --vezes N` dá a mediana de N execuções (seção 10.5) |

`src/appsscript.json`: fuso `America/Porto_Velho`, V8, Web App `USER_DEPLOYING` + `MYSELF`, cinco escopos
(`spreadsheets`, `drive.file`, `script.scriptapp`, `userinfo.email`, `script.external_request`), serviços avançados
`Sheets` v4 e `Drive` v3, `urlFetchWhitelist` só com `https://www.googleapis.com/`. Mudar o manifesto exige mudar
`tests/static.test.js` e `scripts/push-gas.js` juntos (a contingência do escopo `drive` completo já é aceita pelo
`gas:push`, no lugar de `drive.file`).

Documentação de entrega (E1.12): `README.md`, `docs/GUIA_DE_IMPLANTACAO.md` e `docs/RELATORIO_FASE1.md`. O guia lista
cada arquivo de `src/` (seção 3: nome no editor, conteúdo, dependências); quem acrescenta, renomeia ou remove um
arquivo de `src/`, ou muda o manifesto, uma função pública ou um texto que o guia cita, atualiza o guia na mesma
entrega. O relatório de cada fase copia as contagens reais de `npm test` e `npm run ui:check`.

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

**Diagnóstico** (só `runDiagnostics`, sempre numa planilha TEMPORÁRIA, nunca no banco): `diagnosticoCoercao(banco,
entradas?) → {locale, casos: [{entrada, geral: {tipo, valor}}]}` (setValues em células Geral, pt_BR; `tipo` ∈ formula,
texto, numero, data, hora, booleano — o formato de `tests/fixtures/coercao.json`); `diagnosticoAtomicidade(banco) →
{atomico, recusou, lido, erro}` (um `batchUpdate` com uma escrita válida e um pedido inválido); `diagnosticoFuso(instante,
fuso) → {utilities, utils}`.

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
| Interna (UnitOfWork) | a crua + `carregar`, `carregadas`, `resolver(atualizacoes)` (por chave → por linha, só o que muda; célula coercida é regravada), `incluir(aba, registros, primeiraLinha)`, `alterar(aba, id, campos)`, `bifurcar()`, `publico()`, `leituraCrua()` |

Índices (`02`, seção 8) são montados sob demanda, uma vez por unidade, com uma passada sobre as linhas vigentes (ou
cruas, no acesso cru); chave vazia não indexa. Aba não declarada → `INTERNAL`. `incluir` refaz toda a memória (índices,
vigentes, avaliações); `alterar` refaz só a da aba alterada, salvo quando o campo decide a vigência de outras abas
(`OPERACOES.status`, `IMPORTACOES.status`; em EVENTOS `event_id`, `op_id`, `import_id`, `reversal_of_event_id`,
`event_type`, `event_seq`; as chaves de FINANCEIRO e RATEIOS): aí toda.

**Retrato** (trava de integridade, seção 10.5): `bifurcar()` devolve um repositório interno novo com as abas JÁ lidas,
que compartilha as linhas e copia cada uma antes da primeira mudança (`alterar` no retrato não toca no de origem;
`incluir` sem `primeiraLinha` põe as linhas depois da última); não lê a planilha (`carregar` de aba que faltava →
`INTERNAL`) e nada dele é gravado.

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
(`NEEDS_CONFIRMATION`, nada gravado, chave não consumida) → plano validado contra o esquema → **trava de integridade**
(seção 10.5: o retrato do que ficaria gravado pelas checagens de domínio; achado de ERRO novo → `VALIDATION`/`CONFLICT`
`INTEGRIDADE_<CHECAGEM>`, nada gravado, chave não consumida) → **fase A**
(`props` marcador, `anexar` OPERACOES INICIADA + EVENTOS + filhas + AUDITORIA, `flush`) → **fase B**
(`OPERACOES.status = CONFIRMADA`, `flush`) → **fase C** (refaz a auditoria, `EVENTOS.status`/`confirmed_at`/
`reversed_by_event_id`, projeções e `finished_at` na mesma gravação; `flush`; `aplicada_em`; `flush`) → `DATA_VERSION++` → remove o
marcador → grava ERROS_LOG pendente → solta o lock. As projeções da fase C são as que o projetor deu no retrato da trava
(o mesmo projetor, sobre o mesmo estado: as linhas lidas + as da operação + a auditoria refeita); a porta só roda de novo
na recuperação (que refaz todas).

Carimbos da UnitOfWork: EVENTOS `op_id`, `status = PENDENTE`, `idempotency_key`, `reversed_by_event_id`,
`confirmed_at` vazios, `created_by` = usuário se vazio; ANIMAIS `situacao_cadastral = PENDENTE`; `created_at` e
`updated_at` = `tx.agora` se vazios. Recusas de programação (`INTERNAL`): tratador que anexa em OPERACOES,
AUDITORIA ou ERROS_LOG; que anexa aba `SEMPRE` (cadastro nasce por `AuditService.criacao`) sem `anexaSemPai`; que
usa `plano.atualizar`; contexto sem porta ou sem usuário; unidade aninhada. Comando sem chave → `VALIDATION`.

Devolve `{dados, duplicado, opId, dataVersion}` (+ `semAlteracao: true` com plano vazio: nada gravado, sem
operação; + `recuperada: true` quando uma exceção depois do commit foi resolvida pela recuperação). `SIMULAR`
devolve `{dados: {simulacao: true, impactos, avisos, linhas: {ABA: n}}, dataVersion}`: mesmo tratador, mesmo
plano e a mesma trava de integridade, por leitura validada (que já lê as abas da trava), sem lock de escrita e sem
gravar; erro de validação e recusa da trava são lançados como no comando.

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

### 10.5 Trava única de integridade (antes da fase A)

Todo comando com plano não vazio passa por ela, qualquer que seja o caminho: evento registrado, simulado, corrigido ou
estornado; correção de cadastro (do animal, do animal de referência, da categoria, dos parâmetros); anexo; importação
(blocos, conclusão e desfazer). Ela fica depois do tratador e do plano validado contra o esquema e antes de qualquer
escrita (no SIMULAR, no mesmo ponto). As conferências próprias de cada caminho continuam, com as mensagens delas; a trava é
a conferência final do ESTADO RESULTANTE.

1. **Sementes** (`AuditService.sementesDaTrava(lote, mudancas, derivados)`, sem ler a planilha): o que o plano toca. São as
   linhas novas de cada aba (e a chave estrangeira de cada uma), as mudanças de auditoria e o escopo das projeções. Nas
   mudanças de auditoria contam o animal (criação, sexo e nascimento do animal de referência), a importação (`status`:
   concluir e desfazer), a categoria, o plano de contas e a parcela. Os parâmetros `data_marco_zero`,
   `brinco_ignora_zeros_esquerda` e `idade_desmama_padrao_meses` fazem a trava conferir o banco inteiro. Com animal, evento,
   lançamento ou parâmetro, a trava lê também `AuditService.leiturasTrava()` (as abas das checagens; o comando de evento e
   o desfazer e a conclusão da importação já leem todas). Sem eles, confere só a chave estrangeira das linhas citadas, com o
   que o comando já leu.
2. **Retrato DEPOIS** (`UnitOfWork`): `Repository.bifurcar()` do estado lido, mais o plano como se a operação estivesse
   CONFIRMADA (as linhas carimbadas como na fase A), mais a auditoria refeita (`AuditService.refazer`), mais as projeções do
   tratador pelo MESMO projetor (`ctx.projecoes.reconstruir(tx, derivados)`). A fase C grava exatamente essas projeções.
   O retrato de ANTES é o estado lido.
3. **Escopo** (resolvido nos dois retratos):
   - os animais **tocados**: os das sementes, os dos eventos gravados ou anulados e os dos lançamentos deles, mais os que a
     projeção muda;
   - os **vizinhos** que entram na genealogia: mãe, pai, crias, o touro e as fêmeas dos registros reprodutivos;
   - os **partos** em que um tocado é mãe ou cria;
   - os **números de brinco** dos tocados (quem tem ou teve o número entra pela checagem do número);
   - os **lançamentos** e as **linhas citadas**.

   Cada checagem olha só a parte do escopo que pode mudar:
   - a linha do tempo, a entrada aberta, a saída e o custo de cada tocado;
   - a genealogia dos tocados e dos vizinhos;
   - a FK das linhas gravadas, a do cadastro de cada tocado, a das linhas que apontam para um tocado que fica anulado e a
     dos eventos importados que passam a valer;
   - a PROJECAO só do que o comando grava e não projeta. A projeção de um animal só depende das linhas dele; a cria ao pé
     depende das crias, e o projetor refaz a mãe junto.
4. **Checagens**: as de domínio (`AuditService.CHECAGENS_DOMINIO`: BRINCO, IDENTIFICACOES_ATIVAS, FK, ENTRADA_ABERTA,
   LINHA_DO_TEMPO — com a categoria escolhida à mão × sexo e os registros antes do nascimento ou da chegada declarada —,
   BAIXADO_SEM_POSTERIOR, PARTOS, GENEALOGIA — com o touro e a fêmea de cada registro reprodutivo na data —, PROJECAO,
   ALOCACOES, PARCELAS, FINANCEIRO, ALOCACAO_DIRETA, CUSTO_AQUISICAO, COPIAS). É a mesma função da verificação de
   integridade (seção 11), aqui no retrato de DEPOIS e no escopo. Só quando ela dá ERRO a trava roda também o retrato de
   ANTES, no mesmo escopo.
   - Cada achado tem **chaves**: o problema e o registro, sem o texto. Onde um problema pode piorar sem mudar de registro,
     há um átomo por animal, período ou unidade (mais um animal com o brinco repetido; uma entrada a mais em aberto). Sem
     chave própria, valem a checagem, o registro, o campo e a frase sem os números.
   - Achado de ERRO com uma chave que o ANTES não tinha **recusa o comando**. O problema antigo, como uma adulteração à
     mão, não bloqueia o comando que não o piora; o que o piora é recusado.
   - Ficam fora, por construção: PK (chaves novas), CONTADORES (máximo + 1 sob o lock), CELULAS (o plano é validado
     contra o esquema), STATUS_EVENTOS (a fase C refaz o status de todos os eventos lidos) e INVENTARIO (é a soma das
     entradas em aberto por animal, que ENTRADA_ABERTA e PROJECAO conferem). Os alertas (BASE_RATEIO, PENDENCIAS) não
     bloqueiam.
5. **Recusa** (`AuditService.travar`):
   - `VALIDATION` quando todo achado novo é do próprio lançamento (aponta um evento ou uma linha que ele grava; no
     brinco, o número que ele dá); senão `CONFLICT`.
   - `details[]`: `codigo = INTEGRIDADE_<CHECAGEM>`, `animal_id` e `brinco` quando é de um animal, `conflito =
     {event_id, tipo, subtipo, data, nome}` do lançamento já gravado que impede, e a mensagem com o que ficaria errado e
     como resolver, na linguagem do pecuarista (a frase do achado sem o conselho da verificação, mais `COMO_RESOLVER` da
     checagem ou o do achado).
   - A mensagem do erro: "Não dá para gravar: os dados ficariam errados. … Nada foi gravado." (com mais de um: "… em N
     pontos (veja cada um abaixo)").
   - Nada é gravado: a operação nem começa e a chave de idempotência continua livre.

6. **Avisos da trava e política de avisos em todo caminho** (teste aleatório, passada 4). A política de
   `avisos_politica` (IGNORA some, BLOQUEIA vira `VALIDATION` com o código do aviso, AVISA pede aceite) é aplicada pela
   UnitOfWork aos avisos de qualquer tratador (`AuditService.politicaDosAvisos`, lendo CONFIGURACOES se o comando não a
   leu), antes dos avisos não aceitos; aplicá-la de novo onde o serviço já a aplicou dá o mesmo. A carência
   (`CARENCIA_ATIVA`) fica como o serviço da venda a deixou (a política dela vale só na finalidade ABATE). Depois da recusa
   de integridade, o retrato de antes e o de depois dão os **avisos da trava** (`AuditService.avisosDaTrava`): hoje o
   período financeiro fechado (RN-082). Comando que cria lançamento (o do bloco importado nasce sem status e conta) ou
   cancela um que valia (ATIVO → CANCELADO), com `data_competencia` até `fin_bloqueio_ate`, pede `PERIODO_BLOQUEADO` (um
   só por comando; "O lançamento "…", que este comando cancela (e mais N), cai em …, dentro do período financeiro fechado
   (até …). Confirme com uma justificativa."), salvo quando o tratador já o pediu (o motor de eventos, com a mensagem
   dele). Com a política: BLOQUEIA recusa, IGNORA não pede. Não aceito → `NEEDS_CONFIRMATION` (nada gravado, chave livre);
   aceito sem `dados.justificativa_aviso` → `VALIDATION` `CAMPO_OBRIGATORIO` (campo `justificativa_aviso`); aceito, a
   justificativa fica em `OPERACOES.resumo_json.avisos_aceitos` = `[{codigo, justificativa}]`. O `SIMULAR` devolve esses
   avisos junto dos do tratador. O caminho que não pedia e agora pede: o desfazer da importação (seção 18).

**Caminhos sem conferência própria fechados pela trava** (achados nesta etapa; `tests/trava.integridade.test.js`):
- a correção do cadastro de referência do touro externo de um parto só de natimorto (sexo e nascimento;
  `INTEGRIDADE_GENEALOGIA`);
- a correção de cadastro da fêmea que entrou prenhe (sexo e nascimento contra o diagnóstico do rebanho inicial;
  `INTEGRIDADE_GENEALOGIA`);
- a troca do sexo de uma categoria escolhida à mão (`INTEGRIDADE_LINHA_DO_TEMPO`);
- ligar "ignorar zeros à esquerda" com 012 e 12 em dois animais (`INTEGRIDADE_BRINCO`, `INTEGRIDADE_IDENTIFICACOES_ATIVAS`);
- mudar o marco zero depois de um histórico importado (`INTEGRIDADE_COPIAS`);
- (teste aleatório, seção 36) a troca de brinco levada por correção para antes de um "brinco lançado errado", ou estornada,
  ou o brinco de criação corrigido, quando a correção de brinco passaria a trocar um número que o animal não tinha naquela
  posição (`INTEGRIDADE_LINHA_DO_TEMPO`, achado do brinco corrigido; seção 11);
- (teste aleatório) a fêmea que entra prenhe (rebanho inicial, compra, outra entrada) com o nascimento no dia da entrada ou
  depois: o diagnóstico de gestação da entrada fica antes do nascimento (`VALIDATION` `INTEGRIDADE_GENEALOGIA`).
- (teste aleatório, passada 2) o animal que volta ao rebanho dentro de um pasto desativado: o estorno da morte, da venda, do
  descarte, da baixa ou da transferência que o tirou de lá, a correção que o tira da transferência, o desfazer da
  importação (`CONFLICT` `INTEGRIDADE_LINHA_DO_TEMPO`, com a linha que o pôs no pasto; "Reative o pasto…");
- (teste aleatório, passada 2) a correção que muda a ordem das reclassificações e devolve o animal a uma categoria
  desativada (o estorno já conferia `CATEGORIA_INATIVA`; a correção não): `CONFLICT` `INTEGRIDADE_LINHA_DO_TEMPO`.

**Revisão final da Fase 2 (rodada 5): garantias que valem para todo caminho.**
- **Fonte quebrada à mão** (`AuditService`, `fonte`): os achados de COPIAS e FILHAS_SEM_PAI e os do financeiro marcados
  `fonte` (lançamento com efeito de caixa sem parcela, parcela CANCELADA sem as do desdobramento, dedução retida sem
  recebimento) dizem que a fonte da reconstrução está quebrada. A trava só vê os de ERRO das checagens de domínio (COPIAS e
  os do financeiro); FILHAS_SEM_PAI é alerta e fica fora dela, e só impede o reparo na verificação (seção 11). Quando a
  trava os vê no escopo, o comando que lança para o
  que eles citam (o animal, os animais do evento, o lançamento; também os eventos importados que a conclusão faz valer) e
  regravaria a projeção dele é recusado com `CONFLICT` `INTEGRIDADE_<CHECAGEM>` e a mensagem "a planilha tem dados
  apagados ou mexidos à mão … Restaure o backup ou investigue a edição manual antes"; o que só o alcança pela
  reconstrução (conclusão ou desfazer de importação, parâmetro) segue com esse registro em **quarentena**: `travar`
  devolve `refazer_sem` = as chaves `ABA\u0000id`, a UnitOfWork refaz o retrato sem essas projeções (`retratoDepois_(…,
  quarentena)`), roda a trava de novo (até 3 voltas; a quarentena só cresce) e a fase C não as grava. A volta que devolve
  `refazer_sem` não confere os achados novos: quem os confere é a volta seguinte, sobre o retrato refeito. A vaca morta
  sem a linha da morte continua morta.
  O escopo da COPIAS inclui a fonte dos animais tocados (`esc.fonte`: os eventos das linhas e dos detalhes deles).
- **Ensaio da importação** (`ImportService.travarNoEnsaio_`): cada evento planejado na validação e no bloco passa pela
  trava, sobre um retrato bifurcado do ensaio (antes = o ensaio até o evento anterior; depois = com o evento valendo e os
  animais reprojetados), com as mesmas sementes, escopo e quarentena; a recusa vira motivo da linha (`INTEGRIDADE_*`).
  Assim, o que só a trava recusa aparece na validação, nunca numa conclusão impossível. `AuditService.propriosDoLote(lote)`
  (o que o lote grava) serve à UnitOfWork e ao ensaio.
- **Cria em dobro** (GENEALOGIA, `conferirCriaEmDobro_`): a cria de um parto e outro filho da mesma mãe, com o mesmo
  nascimento, que não veio de parto (o bezerro da fotografia, da compra ou da outra entrada) são o mesmo animal duas
  vezes; um achado por par, no escopo pelas mães. O motor tem a conferência própria (`CRIA_JA_NO_CADASTRO`, a seguir).
- **Propriedade desativada** (LINHA_DO_TEMPO): animal no rebanho em pasto ativo de propriedade desativada, com a linha que
  o pôs lá; `PastureService` não reativa pasto em propriedade desativada (`PROPRIEDADE_INATIVA`).
- **Frases da trava**: GENEALOGIA, PARTOS e o "brinco lançado errado" têm `oque` no condicional ("teria como pai Touro de
  sêmen (A-000001), que passaria a ser fêmea"); o animal de referência aparece pelo nome; o conselho do brinco corrigido
  serve a qualquer identificação ("dê a esta identificação uma data depois da correção"); a categoria manual × sexo
  manda estornar ou corrigir a reclassificação (voltar à automática não a tira do histórico).

**Desempenho** (`npm run trava:medir`; base de demonstração do TestRunner, 391 comandos; CPU do Node sobre a planilha
falsa; mediana de três execuções alternadas com a cópia do projeto de antes da trava):
- sem a trava: 16.757 ms, 42,9 ms por comando (p50 42,2, p95 70,2);
- com a trava: 19.462 ms, 49,8 ms por comando (p50 48,4, p95 85,2);
- **+16 %** (entre +6 % e +22 % nos três pares), com cerca de 1,8 s dentro de `AuditService.travar` e o resto no retrato;
- no relatório da convergência (16/11), contra a mesma cópia de antes da trava (commit `0cb6b07`), mediana de três pares
  alternados: 17.168 → 20.779 ms, 43,9 → 53,1 ms por comando, **+21 %** (os pares entre +20 % e +21 %), com 2.340 ms
  dentro de `AuditService.travar`. A diferença inclui as outras mudanças da convergência: as regras que entraram depois
  na verificação e o escopo maior da COPIAS.

A primeira versão, com as checagens de cada animal também nos vizinhos e a memória inteira refeita a cada mudança no
retrato, ficava entre +24 % e +28 %. O escopo foi restringido pelo papel de cada checagem, e a trava nunca desliga. A
leitura das abas no Google Sheets não entra na medida: o comando de evento já lê todas as abas que a trava confere, e só
a correção de categoria e de parâmetro e o cadastro de animal de referência passam a ler mais.

## 11. `AuditService` (parte 1, puro)

| Função | Contrato |
|---|---|
| `linhas(ctx, {op_id, usuario, timestamp}, mudancas) → [linha de AUDITORIA]` | `mudanca = {entidade, entity_id, acao, campo, valor_anterior, valor_novo, justificativa}` com valores na forma da LÓGICA; viram texto no formato de célula do tipo. `ALTERAR` só em coluna `[cad]`, `CONTROLE` só em `[ctl]`, `CRIAR` em qualquer uma; a chave nunca muda; `RECUPERACAO`/`MANUTENCAO` sem campo (`valor_novo` = descrição; entidade `SISTEMA` sem registro). Fora disso → `INTERNAL` |
| `alteracao(tx, aba, id, campos, justificativa?) → n` | Compara com o registro vigente e põe no plano uma mudança por campo que REALMENTE muda (marca `[ctl]` → CONTROLE; senão ALTERAR). Registro inexistente → `NOT_FOUND`. 6º argumento `{externo: true}`: sexo e nascimento do cadastro de referência de um animal EXTERNO (`ATRIBUTOS_EXTERNO`), aceitos só se o registro está EXTERNO (senão `INTERNAL`) |
| `criacao(tx, aba, id, campos, justificativa?) → n` | CRIAR, uma mudança por campo preenchido; a chave nasce no plano e fica em `entity_id`; a linha do cadastro é anexada só na fase C, se a chave ainda não existir |
| `refazer(repo, io, op, linhasDaOperacao) → {atualizar, criar, semAlvo}` | O que a fase C aplica (idempotente; `updated_at`/`created_at` = `op.started_at`). Usado pela UnitOfWork |
| `listar(tx, {entidade, entity_id, op_id, acao, de, ate}?) → [linhas]` | Trilha só de operações CONFIRMADAS, da mais recente para a mais antiga (cópias). A consulta declara `AuditService.LEITURAS` |
| `linhaErro(ctx, {contexto, codigo, mensagem, erro, op_id}) → linha de ERROS_LOG` | Mensagem até 2.000 caracteres; pilha resumida (6 linhas) quando há `erro` |
| `trilha(tx, filtros)` | A trilha COMPLETA (03a, seção 5.2; 05, seção 2.16): EVENTOS + AJUSTES + AUDITORIA, só de operações confirmadas (eventos anulados entram, com `status` e `vigente`), da mais recente para a mais antiga (instante; no empate EVENTO, AJUSTE, AUDITORIA). Item = a forma da linha de AUDITORIA (`audit_id` só nas de AUDITORIA) + `origem` (EVENTO \| AJUSTE \| AUDITORIA), `id`, `event_id`; nos de evento e de ajuste também `event_type`, `event_subtype` (no ajuste, o `tipo_ajuste`), `event_date`, `registration_date`, `reversal_of_event_id`, `status`, `vigente`, `descricao` ("Estorno de: Transferir de pasto de 10/04/2026"). Ações: REGISTRAR, CORRIGIR (substituto), ESTORNAR (o evento; `justificativa` = a do payload; na baixa por divergência sem correção, o `motivo_ajuste`), AJUSTAR (cada linha de AJUSTES: campo, anterior, novo, justificativa); as de AUDITORIA como estão. Filtros: `entidade` (EVENTOS = só eventos; ANIMAIS com `entity_id` = também os eventos do animal), `entity_id` (registro: de um animal traz os eventos dele e os estornos e correções desses eventos; de um evento, ele, quem o anulou e os ajustes dele), `op_id` (operação), `acao`, `origem`, `de`/`ate` (período: data `yyyy-MM-dd` comparada pela data do instante no fuso da fazenda, ou instante ISO). Período inválido ou origem desconhecida → `VALIDATION`. Precisa de `tx.cru` (`LEITURAS_TRILHA` = AUDITORIA, EVENTOS, EVENTO_ANIMAIS, AJUSTES) |
| `consultaListar(filtros)` / `listarAuditoria(ctx, filtros)` | Rota `auditoria.listar`: a `trilha` (acesso cru) com os filtros dela + `pagina`, `por_pagina` (padrão 50, teto 500) → `{total, pagina, por_pagina, itens}`. `listar(tx, ...)` continua sendo só a trilha de AUDITORIA (o registro de refazer) |

**Parte 2 — verificação de integridade (06, seção 9).** `verificarIntegridade(ctx) → {dados: relatório, dataVersion}`
(rota `sistema.integridade`; fim do setup; gatilho semanal): lê os cabeçalhos e a localidade pela porta e entra por
`UnitOfWork.exclusivo` (lock e recuperação ANTES de conferir) com acesso cru a todas as abas existentes. Com aba
ausente, só a estrutura é conferida (as demais checagens ficam `NAO_EXECUTADA`). Relatório: `{gerado_em, banco,
data_version, ok (nenhum ERRO), erros, alertas, reparavel, abas_ausentes, checagens: [{codigo, rotulo, severidade,
situacao (OK|ERRO|ALERTA|NAO_EXECUTADA), achados, correcao, reparo}], achados: [{checagem, severidade, tabela, id,
linha, campo, mensagem, reparo}] (até 300), truncado, duracao_ms}` (`duracao_ms` = leitura, recuperação e conferência
pelo relógio do contexto; a tela de sistema mostra). As checagens de domínio (`AuditService.CHECAGENS_DOMINIO`: BRINCO,
IDENTIFICACOES_ATIVAS, FK, ENTRADA_ABERTA, LINHA_DO_TEMPO, BAIXADO_SEM_POSTERIOR, PARTOS, GENEALOGIA, PROJECAO, ALOCACOES,
PARCELAS, FINANCEIRO, ALOCACAO_DIRETA, CUSTO_AQUISICAO, COPIAS) são UMA função sobre um retrato (tx com acesso cru) e um
escopo opcional — a verificação a roda sobre tudo, e a trava de integridade dos comandos (seção 10.5) sobre o retrato de
antes e o de depois, no escopo afetado; a PROJECAO usa a porta de projeções dada (na verificação, `Timeline.porta()`). As
demais (estrutura, células, chaves, contadores, operações, status dos eventos, inventário, pendências, base de rateio) são
só da verificação. As 26 checagens (`AuditService.CHECAGENS`, na ordem do relatório): `PK`, `BRINCO`,
`IDENTIFICACOES_ATIVAS` (Fase 2: nenhum BRINCO com `data_fim` vazio repetido entre as linhas vigentes, com a normalização
da unicidade de brinco; a retirada e o brinco trocado ficam fechados; revisão 3: nem o mesmo número em dois animais ao mesmo
tempo — períodos `[data_inicio, data_fim)` que se cruzam, fora o número corrigido por IDENTIFICACAO_INCORRETA), `FK`
(linhas vigentes; alvo inexistente ou animal ANULADO; ANEXOS pela entidade; ERROS_LOG só alerta), `ENTRADA_ABERTA`
(ATIVO ⇔ soma dos efeitos = 1), `LINHA_DO_TEMPO` (`Timeline.validar` sobre o histórico inteiro de cada animal, com a
ordem das identificações e das marcações: `Timeline.validarIdentificacoes`/`validarMarcacoes`; revisão 4: a chegada
declarada no rebanho inicial não fica antes do nascimento, e a categoria escolhida à mão de cada reclassificação vigente
serve ao sexo do animal pela reconstrução; teste aleatório, seção 36: o "brinco lançado errado" — AJUSTES IDENTIFICACAO_INCORRETA —
troca o número que estava em uso na posição dele, pela data, pela posição na cadeia de substituição e pela sequência, um
achado por ajuste, "Estorne antes a correção do brinco lançado errado, ou deixe a troca de brinco depois dela"; teste aleatório,
passada 2: o animal no rebanho não fica dentro de pasto desativado — 03a, seção 2.1 —, com a linha que o pôs lá como o
lançamento que impede, e o animal reclassificado à mão não fica em categoria desativada, com a última reclassificação
para ela; um achado por animal, "Reative o pasto…"/"Reative a categoria…"), `BAIXADO_SEM_POSTERIOR`
(Fase 2: na ordem canônica, linha vigente que não seja correção de cadastro depois de uma saída e antes da volta — depois
da morte, qualquer uma, volta inclusive —, e detalhe com data de IDENTIFICACOES, PESAGENS ou REPRODUCAO que cita o animal
fora do rebanho num evento em que ele não tem linha; um achado por evento, "Estorne um dos dois"), `PARTOS` (Fase 2: cada
NASCIMENTO vigente com uma linha MATRIZ — fêmea nascida antes do parto, pela reconstrução —, exatamente um REPRODUCAO
PARTO na mãe com `data_parto` = data do evento, `qtd_nascidos_vivos` = linhas CRIA e ao menos uma cria; cada CRIA com
`mae_id`, `data_nascimento`, `origem` NASCIDO e `pai_id` = touro do parto nos atributos da criação e também no cadastro
reconstruído (a projeção, com as correções vigentes: correção só na cria ou edição à mão; o pai só quando o parto o
informa); PARTO de evento que não é nascimento vigente), `GENEALOGIA` (revisão 2: de cada animal que vale, a mãe é fêmea,
o pai é macho, os dois nasceram antes dele e nenhum é ancestral dele mesmo — um achado por ciclo; RN-008 a RN-010; revisão 3:
o touro de cada REPRODUCAO vigente — o pai do parto, mesmo só de natimorto — é macho e nasceu antes do registro, RN-060; trava
de integridade: a fêmea de cada REPRODUCAO vigente que não é parto — o diagnóstico de gestação do rebanho inicial, da compra e
da outra entrada — é fêmea e nasceu antes do registro; a do parto é conferida em PARTOS),
`PROJECAO` e `STATUS_EVENTOS` (reparo `RECONSTRUIR`; a reconstrução cobre todo campo de projeção do
esquema, menos `PRODUTOS.estoque_atual`, da Fase 3, e `EVENTOS.confirmed_at`, instante da fase C), `INVENTARIO`
(total e por pasto, hoje), `ALOCACOES`, `PARCELAS`, `FINANCEIRO`, `ALOCACAO_DIRETA` (reparo) e `CUSTO_AQUISICAO` (Fase 2,
reparo) — as invariantes de 03b, seção 14, pela conferência do próprio `FinancialService.conferir` (seção 26), uma
checagem por invariante: 7, 8, 9, 10, 11 e 13 → `ALOCACOES`; 3 → `PARCELAS`; 12 → `ALOCACAO_DIRETA` e 18 →
`CUSTO_AQUISICAO`, que juntam a diferença da reconstrução em `FINANCEIRO.animal_id` e em `ANIMAIS.custo_aquisicao`/`custo_aquisicao_origem`
(um achado por registro); 6 é a projeção de FINANCEIRO e fica só em `PROJECAO`; as demais (1, 2, 4, 5, 14 a 17, 19 e 20)
→ `FINANCEIRO` (revisão 3: toda COMPRA e VENDA vigente com exatamente uma linha de COMPRAS/VENDAS, invariante 15; a dedução
retida pelo comprador vencendo num recebimento da venda, 16) —, `BASE_RATEIO` (alerta; todo critério de escopo EVENTO que a
linha do evento permite recalcular: VALOR_INDIVIDUAL pelo valor do animal, DIRETO pelo valor do lançamento, PESO_VIVO pelo
peso do evento, PESO_CARCACA pela carcaça, CABECAS = 1; revisão 4: a base estimada da venda só com o peso do lote — a
última pesagem individual até a data da venda, escalada para `VENDAS.peso_vivo_total_kg` com 4 casas, pela mesma conta da
gravação, `FinancialService.basesEstimadas` e `Timeline.ultimaPesagem` — também é refeita: diferente → "o rateio está
desatualizado"; sem a pesagem de algum animal até a data → "não pode mais ser refeita"; nunca recalcula em silêncio), `COPIAS`
(data de PESAGENS, REPRODUCAO e IDENTIFICACOES = data do evento; e o tipo da linha de detalhe = o do evento (06, seção 9;
03a, SUBTIPO_EVENTO): `AJUSTES.tipo_ajuste` = subtipo, `BAIXAS.tipo` = MORTE/DESCARTE ou DIVERGENCIA_CONTAGEM,
`REPRODUCAO.tipo_evento` = PARTO no nascimento, DIAGNOSTICO_GESTACAO nas entradas, o subtipo na reprodução; revisão 3: o
detalhe que o tipo grava existe — uma BAIXAS por animal na morte, no descarte e na baixa por divergência, ao menos um AJUSTES
por animal nas correções, uma IDENTIFICACOES por animal na identificação; revisão 4, a fonte de cada evento vigente: o
evento tem as linhas dos animais (EVENTO_ANIMAIS) que o tipo grava, cada uma com o papel e o efeito do tipo — entradas +1,
saídas e baixa na contagem −1, os demais 0, todas 0 no registro anterior ao marco zero; no parto, MATRIZ 0 e CRIA +1, e o
papel que falta é da checagem PARTOS —, o movimento (transferência, correção de localização) com o pasto de destino,
`pre_marco_zero` = (data antes do marco zero) e as linhas de BAIXAS, AJUSTES e IDENTIFICACOES só de animal que tem linha no
evento; Fase 3, E3.1 (`conferirPesagens_`): `PESAGENS.tipo` da PESAGEM é um dos momentos (ROTINA, ENTRADA, DESMAMA,
VENDA), o mesmo em todas as linhas do lançamento, e o das outras é o do evento (NASCIMENTO, COMPRA, VENDA, ENTRADA_INICIAL
→ ENTRADA, DESMAMA); uma PESAGENS por animal da PESAGEM (detalhe obrigatório), peso na faixa (> 0 e ≤ `PESO_MAX_KG`) e uma
pesagem por animal em qualquer lançamento; na PESAGEM, o peso igual ao da linha do animal (EVENTO_ANIMAIS), MEDIA_LOTE só
com o peso total e as cabeças no payload e, por lote, cada animal com a média = total ÷ cabeças (1 casa) e as cabeças = as
linhas; a data dentro da permanência é da LINHA_DO_TEMPO, como todo fato; Fase 3, E3.2 e E3.3 (`conferirInsumos_`, seção
39): SANIDADE (data = data do evento, procedimento do subtipo, detalhe obrigatório) com o mesmo produto, nome e protocolo
em todas as linhas, a DOENCA sem produto nem dose, a dose pelo modo do payload, a unidade do produto, `data_fim_carencia` =
aplicação + período, a cópia `custo` = Σ das alocações do animal, a saída = a quantidade do payload e o consumo =
quantidade × custo unitário em centavos; ESTOQUE sem linha de animal, a ENTRADA com um lançamento COMPRA_INSUMOS com o
produto e a quantidade (embalagens × quantidade por embalagem) e no máximo um movimento igual a ele, o AJUSTE sem lançamento
e com um movimento ≠ 0 (negativo na perda e no vencimento); nenhum outro tipo tem movimento nem lançamento com produto: o reparo (RECONSTRUIR) refaria a
situação a partir do dado quebrado, então o achado continua depois dele, com "Restaure o backup ou investigue a edição
manual"), `CELULAS` (COERCIDA = alerta; ERRO = erro),
`OPERACOES_ORFAS`, `FILHAS_SEM_PAI` (alerta: linha cujo evento, operação, importação, rateio ou lançamento não existe),
`CABECALHOS` (aba ou coluna ausente e coluna de SCHEMA_META sumida = erro; coluna do dono = alerta), `FUSO_LOCALE`,
`CONTADORES` (`event_seq` e `codigo_interno` repetidos), `PENDENCIAS` (alerta: ativo sem pasto, sem brinco ou sem
categoria). Revisão final: o relatório traz `reparo_impedido` (texto ou `null`): com um ERRO que tem reparo e algum
achado da fonte quebrada (de COPIAS, de FILHAS_SEM_PAI, que é alerta, ou do financeiro marcado `fonte`: lançamento com efeito de caixa — fora o consumo de insumo, o
saldo de abertura e o evento anterior ao marco zero — sem parcela; parcela CANCELADA sem as do desdobramento; dedução
descontada pelo comprador sem recebimento da venda), `reparavel` é `false`, a tela de sistema mostra o motivo e
`repararIntegridade` recusa com `CONFLICT` (o reparo refaria a situação a partir do dado quebrado). GENEALOGIA também
acusa a cria em dobro; LINHA_DO_TEMPO, o animal em propriedade desativada.
`repararIntegridade(ctx, justificativa?) → {recuperacao, integridade}`: o reparo oferecido —
`UnitOfWork.recoverAll` (status dos eventos e todas as projeções), AUDITORIA `MANUTENCAO` e nova verificação; fato
adulterado (lançamento, parcela, cabeçalho de compra, detalhe) continua acusado: só se corrige pelo sistema (RN-112). Erros:
LOCKED, CONFIG. Testes: `tests/integrity.test.js` (Fase 1), `tests/trava.integridade.test.js` (a trava, seção 10.5) e `tests/integrity.fase2.test.js` (cada checagem da Fase 2
disparada por adulteração à mão, cada campo de projeção do esquema, reparo, e o tempo sobre a base de demonstração:
cerca de 55 ms no fake para 317 animais, 34 eventos, 367 linhas de EVENTO_ANIMAIS e 380 alocações — só CPU do Node; a
leitura real das abas no Sheets não entra nessa medida).

Trava de integridade (seção 10.5), a mesma função das checagens de domínio: `CHECAGENS_DOMINIO`; `leiturasTrava()` (as abas
que ela lê quando o comando toca animal, evento, lançamento ou parâmetro); `sementesDaTrava(lote, mudancas, derivados) →
{animais, eventos, lancamentos, importacoes, categorias, contas, parcelas, linhas, tudo, dominio}` (puro, pelo plano);
`travar({antes, depois, sementes, lote, projecoes, derivados, projetor, proprios}) → {escopo, achados_depois,
achados_antes}` ou a recusa `VALIDATION`/`CONFLICT` com `INTEGRIDADE_<CHECAGEM>`. Só a `UnitOfWork` chama `travar`.

## 12. `EventCatalog` (puro, só dados)

Definição declarativa dos eventos (04, seção 7). Os 21 tipos estão no catálogo com `fase`; só passam pelo motor os
entregues na fase corrente E com campos (`FASE_ATUAL = 3`, desde a etapa BASE da Fase 3; os tipos dela ficam inativos
até terem campos — desde a E3.1, PESAGEM é ativa; desde a E3.2 e a E3.3, SANIDADE e ESTOQUE; REPRODUCAO, DESMAMA, CASTRACAO
e OCORRENCIA seguem inativos): ENTRADA_INICIAL, OUTRA_ENTRADA, NASCIMENTO, COMPRA, VENDA, PESAGEM, SANIDADE (VACINACAO,
VERMIFUGACAO, MEDICACAO, TRATAMENTO, EXAME, DOENCA), ESTOQUE (ENTRADA, AJUSTE),
TRANSFERENCIA, MORTE, DESCARTE, IDENTIFICACAO (PRIMEIRA_IDENTIFICACAO, SUBSTITUICAO, REMOCAO), MARCACAO (DESCARTE,
NAO_LOCALIZADO), AJUSTE_INVENTARIO (CORRECAO_CADASTRO, IDENTIFICACAO_INCORRETA, CORRECAO_LOCALIZACAO, RECLASSIFICACAO,
DIVERGENCIA_CONTAGEM) e ESTORNO (subtipo só é ativo com `campos_animal`; os da fase 2 não aparecem em `serializar(1)`).
Subtipo pode ter campos de cabeçalho próprios em `subtipos[S].campos` (`camposEvento(tipo, subtipo)` junta os do tipo e
os do subtipo; a tela desenha os dois, seção 34) e `critico: true` (a operação crítica é a do subtipo: DIVERGENCIA_CONTAGEM,
a baixa por divergência de 08, 4.6). Vocabulário fechado de 04
mais quatro atributos de campo: `opcoes` (enum fechado), `lista` (lista aberta de LISTAS), `casas` (decimais) e
`naturezas` (em `ref:PLANO_CONTAS`: as naturezas de conta aceitas, para a tela filtrar as contas). No tipo, os campos de cabeçalho
ficam em `campos`, os por animal em `campos_animal` (ou em `subtipos[S].campos_animal`) e os de grupo repetível em
`grupos_repetiveis[g]` (NASCIMENTO: `crias`). `filtro_elegiveis` aceita `situacao`, `pasto: '$campo'` e `sexo`.
`aceita_historico: true` no resumo do tipo (só NASCIMENTO): o formulário aceita data anterior ao marco zero como registro
histórico (04, seção 6). O motor (`cabecalho_`) e a tela (nota da data, revisão e resultado do parto) leem esse atributo:
uma regra só. Nos demais tipos, data antes do marco zero → `ANTES_DO_MARCO_ZERO` (salvo importação e correção de registro
que já é histórico). `desconto_comercial` da VENDA aceita 0,00 (03b, 4.2: ≥ 0).

Tipos desta etapa (cabeçalho · por animal):
- PESAGEM (Fase 3, E3.1; `VARIOS`, ATIVO na data; `modo_entrada: CURRAL`; LOCAL; `frequente`; não crítico; lê também o
  que o financeiro lê): `event_date (padrão hoje), tipo_pesagem* (MOMENTOS_PESAGEM: ROTINA padrão, ENTRADA, DESMAMA,
  VENDA — NASCIMENTO e COMPRA são do parto e da compra), metodo_pesagem* (METODOS_PESAGEM: BALANCA padrão, FITA,
  ESTIMATIVA_VISUAL; MEDIA_LOTE só pelo lote), jejum (bool, padrão não; vai para o payload), peso_total_lote_kg (decimal,
  1 casa: a balança do lote inteiro), qtd_cabecas_lote (inteiro 1 a 1.000; visível e obrigatório com o peso total),
  property_id, responsible, notes` · `animal_id*, peso (0,1 a `PESO_MAX_KG` = 2.000, 1 casa; obrigatório na individual,
  proibido no lote), observacoes`. O módulo PESAGENS (fase 3, `tela: 'Weights'`, `sob_demanda`, `rotas: ['pesagens']`,
  ordem 5) fica no menu.
- SANIDADE (Fase 3, E3.3; `VARIOS`, ATIVO na data; `modo_entrada: FORM`; revisão SERVIDOR; `frequente`; não crítico; lê
  também o financeiro e os insumos, `LEITURAS_INSUMOS` = PRODUTOS, MOVIMENTOS_ESTOQUE, SANIDADE, PROTOCOLOS_SANITARIOS): o
  tipo não tem campos próprios; cada subtipo traz a lista inteira (`camposSanidade_`, `camposAnimalSanidade_`): `event_date*
  (padrão hoje), protocol_id, produto_id, nome_produto (sem cadastro), fabricante, lote, validade, modo_dose (MODOS_DOSE:
  POR_CABECA, POR_PESO, TOTAL), dose_referencia (4 casas; visível por cabeça e por peso), unidade_dose (só sem cadastro),
  quantidade_consumida_total (4 casas; obrigatória no TOTAL), via_aplicacao (LISTAS.VIA_APLICACAO), periodo_carencia_dias
  (0 a 3.650), data_proxima_aplicacao, veterinario, custo_valor + custo_conta_id (CUSTEIO; obrigatória com o valor),
  custo_partner_id, custo_vencimento, custo_parcelas_qtd (1 a 120), custo_forma_pagamento, custo_documento,
  custo_descricao, property_id, responsible, notes`; `motivo` (obrigatório no TRATAMENTO, opcional na MEDICACAO);
  `diagnostico*` (EXAME e DOENCA). A DOENCA não tem produto, dose, carência nem próxima. Por animal: `animal_id*, dose (4
  casas; não na DOENCA), resultado_exame (EXAME), observacoes`. O módulo SANIDADE (fase 3, `tela: 'Health'`,
  `sob_demanda`, `rotas: ['sanidade']`, ordem 6) fica no menu.
- ESTOQUE (Fase 3, E3.2; `NENHUM` animal; FORM; revisão SERVIDOR; não frequente; grupo Financeiro): ENTRADA `event_date*,
  product_id*, qtd_apresentacao (embalagens), quantidade (na unidade do produto; vazia = embalagens × quantidade por
  embalagem), valor* (dinheiro ≥ 0,01), partner_id, lote, validade, documento, vencimento, parcelas_qtd, forma_pagamento`;
  AJUSTE `event_date*, product_id*, motivo_ajuste* (MOTIVOS_AJUSTE_ESTOQUE: CONTAGEM, PERDA, VENCIMENTO), saldo_contado (≥ 0;
  visível e obrigatório na contagem), quantidade (> 0; visível e obrigatória na perda e no vencimento), lote, validade`.
  O tipo sem animais com subtipos de campos (só `campos`) está pronto (`subtipoPronto_`).
- NASCIMENTO (`selecao_animais: UM` = a matriz, fêmea ativa; revisão LOCAL): `event_date, pasto_destino_id (vazio = o
  da mãe no dia), pai_id, pai_confianca (obrigatória com pai), tipo_parto (LISTAS.TIPO_PARTO), property_id,
  responsible, notes` · crias: `situacao_nascimento (VIVO|NATIMORTO), sexo, brinco, nome, raca (vazio = a da mãe),
  peso, metodo_pesagem, observacoes` (só `situacao_nascimento` vale para natimorto).
- TRANSFERENCIA (`VARIOS`, ATIVO no pasto de origem; LOCAL): `event_date, pasto_origem_id, pasto_destino_id,
  gta_numero, property_id, responsible, notes` · nenhum campo por animal.
- MORTE (`VARIOS`, ATIVO; LOCAL; crítico): `event_date, causa (LISTAS.CAUSA_MORTE), diagnostico, custo_valor
  (dinheiro, opcional), custo_conta_id (ref:PLANO_CONTAS, naturezas CUSTEIO; obrigatória com valor), custo_partner_id,
  custo_vencimento (vazio = à vista), custo_forma_pagamento, custo_documento, custo_descricao, property_id, responsible,
  notes` · `observacoes`. A tela revisa pelo servidor quando há custo.
- DESCARTE (`VARIOS`, ATIVO; LOCAL; crítico): `event_date, destino (LISTAS.DESTINO_DESCARTE: consumo próprio, doação,
  permuta, sacrifício), motivo (LISTAS.MOTIVO_DESCARTE), receita_valor, receita_partner_id, receita_vencimento,
  receita_forma_pagamento, receita_documento, receita_descricao, property_id, responsible, notes` · `observacoes`. Sem
  `event_subtype` (03b, seção 2.4).
- IDENTIFICACAO (`VARIOS`, ATIVO; `modo_entrada: CURRAL`; LOCAL): `event_date, tipo_identificacao (BRINCO padrão, RFID,
  SISBOV, TATUAGEM, OUTRO, BRINCO_ORIGEM — este só na retirada), property_id, responsible, notes` · PRIMEIRA_IDENTIFICACAO:
  `animal_id*, codigo*, observacoes`; SUBSTITUICAO: `animal_id*, codigo*, motivo* (LISTAS.MOTIVO_IDENTIFICACAO),
  observacoes`; REMOCAO: `animal_id*, motivo*, observacoes`. `TIPOS_IDENTIFICACAO` = a lista do campo.
- MARCACAO (`VARIOS`, ATIVO; LOCAL): `event_date, acao* (MARCAR | DESMARCAR; vai para o payload), property_id, responsible,
  notes`; o subtipo DESCARTE tem ainda o campo de cabeçalho `motivo_descarte` (LISTAS.MOTIVO_DESCARTE, só com MARCAR) ·
  `animal_id*, observacoes`.
- AJUSTE_INVENTARIO, subtipos da Fase 2: RECLASSIFICACAO `animal_id*, categoria_manual_id (ref:CATEGORIAS; vazio = volta à
  automática)`; DIVERGENCIA_CONTAGEM `animal_id*, observacoes (em que contagem faltou; vazio = a justificativa)`.
- COMPRA (`NOVOS`, aceita também animal já cadastrado fora do rebanho; SERVIDOR; crítico; `filtro_elegiveis.situacao`
  VENDIDO, DESCARTADO, BAIXADO_AJUSTE, HISTORICO): `event_date, partner_id (fornecedor, obrigatório), finalidade
  (LISTAS.FINALIDADE_NEGOCIO), modalidade (CABECA|KG_VIVO|ARROBA|LOTE), base_peso (só ARROBA: VIVO|CARCACA),
  rendimento_carcaca_pct e rendimento_tipo (NEGOCIADO|ESTIMADO; só base VIVO), preco_unitario (centavos por cabeça, kg ou
  @; obrigatório em KG_VIVO e ARROBA), peso_total_kg (vazio = soma dos pesos), valor_animais (obrigatório: vale a nota),
  criterio_rateio (só LOTE: CABECAS|PESO_VIVO|PESO_CARCACA|VALOR_INDIVIDUAL|MANUAL), justificativa_rateio (MANUAL),
  pasto_destino_id (obrigatório: o do lote), gta_numero, nota_fiscal, condicoes (→ COMPRAS.observacoes), property_id,
  responsible, notes` · `animal_id (volta ao rebanho), brinco, brinco_origem, nome, sexo, raca, data_nascimento |
  idade_meses, data_nascimento_confianca, castrado, reprodutor, partos_previos, situacao_reprodutiva, data_prevista_parto,
  pasto_destino_id (vazio = o do lote), peso, metodo_pesagem (vazio = BALANCA), peso_carcaca_kg, valor_individual,
  base_manual, outras_identificacoes, observacoes` · grupos `parcelas: [data_vencimento*, valor (vazio = divisão igual
  do que falta), forma_pagamento (LISTAS.FORMA_PAGAMENTO), documento]` e `custos: [tipo* (FRETE|OUTRO), valor*,
  partner_id, data_vencimento (vazio = à vista), forma_pagamento, documento, descricao]`.
- VENDA (`VARIOS`, ATIVO na data, `filtro_elegiveis.pasto: '$pasto_origem_id'`; SERVIDOR; crítico; lê também SANIDADE):
  `event_date, partner_id (comprador, obrigatório), finalidade (LISTAS.FINALIDADE_NEGOCIO, obrigatória: ABATE decide a
  carência), pasto_origem_id (opcional: filtra o seletor e confere a origem de cada animal), modalidade, base_peso (só
  ARROBA), rendimento_carcaca_pct (padrão `CONFIGURACOES.rendimento_carcaca_padrao_pct`) e rendimento_tipo (só base VIVO),
  preco_unitario, peso_vivo_total_kg (vazio = soma), peso_carcaca_total_kg (só base CARCACA: o total do romaneio; vazio =
  soma), valor_bruto (obrigatório: vale a nota ou o romaneio), desconto_comercial, criterio_rateio (só LOTE),
  justificativa_rateio (MANUAL), gta_numero, nota_fiscal, condicoes (→ VENDAS.observacoes), property_id, responsible,
  notes` · `peso (vivo; vira PESAGENS VENDA), metodo_pesagem (vazio = BALANCA), peso_carcaca_kg, valor_individual,
  base_manual, motivo_saida (LISTAS.MOTIVO_DESCARTE: vendido como descarte), observacoes` · grupos `parcelas` (as do
  recebimento, como na compra) e `deducoes: [tipo* (LISTAS.TIPO_DEDUCAO_VENDA), valor*, retida_pelo_comprador (bool),
  partner_id (vazio na retida = o comprador), data_vencimento (vazio = à vista; na retida, o primeiro recebimento),
  forma_pagamento, documento, descricao]`. O preço por animal (`EVENTO_ANIMAIS.preco_unitario`) não é campo: na venda por
  cabeça o preço de cada animal é o `valor_individual`.

| Função | Contrato |
|---|---|
| `nomes()`, `existe(tipo)` | Os 21 tipos |
| `nomeEvento(tipo, subtipo?)` | O lançamento como substantivo com artigo, para o meio da frase ("a transferência", "a marcação para descarte", "o rebanho inicial"; por subtipo quando ele diz mais que o tipo); tipo desconhecido → "o lançamento". O rótulo do tipo é um verbo ("Comprar animais") e não serve no meio da frase |
| `tipo(nome)` | Resumo + definição (`rotulo, grupo_ui, ordem, fase, frequente, selecao_animais, filtro_elegiveis, modo_entrada, revisao, critico, reads, campos, campos_animal, componentes, grupos_repetiveis, subtipos`). Tipo inexistente → `INTERNAL` |
| `ativo(tipo, subtipo?, fase?)` | Entregue na fase (padrão: a corrente) e com campos; tipo com subtipos exige subtipo ativo |
| `tiposAtivos(fase?)`, `modulosAtivos(fase?)` | Listas por fase. Módulos: os 10 itens do menu (§15) + IMPORTACAO (`menu: false`), cada um com `fase`. Como o tipo só fica ativo com campos, o módulo só fica ativo com a tela entregue: `modulosAtivos` traz os da fase que têm `tela` (o arquivo HTML da tela). `sob_demanda: true` (a importação; os das Fases 3 a 5, quando entregues): a tela não entra na página inicial e vai ao aparelho pela rota `sistema.tela` (seções 19 e 37), com `rotas` = as raízes de rota dela (o primeiro trecho, ex.: `['importar']`). No começo da Fase 3, Pesagens, Sanidade e Reprodução são da fase mas sem tela: fora do menu e de `modulosAtivos`; Pesagens entrou na E3.1 e Sanidade na E3.2 e E3.3 |
| `modulos()`, `modulo(id)` | Todos os módulos do desenho (entregues ou não) e um pelo id (`null` se não existe): rótulo, ordem, fase, menu, tela. Para a mensagem de módulo não entregue (a ficha, a rota da tela) |
| `subtipos(tipo)` | Códigos dos subtipos do tipo, na ordem do catálogo, ativos ou não (`[]` em tipo sem subtipos ou desconhecido) |
| `camposEvento(tipo, subtipo?)`, `camposAnimal(tipo, subtipo?)`, `camposGrupo(tipo, grupo)`, `leituras(tipo)` | Definições e abas que o comando lê (o motor lê também BAIXAS); `camposEvento` com subtipo acrescenta `subtipos[S].campos`; `leituras(tipo desconhecido)` = a união das de todos os tipos (correção que não diz o tipo) |
| `serializar(fase?)` | `{fase, modulos, tipos}` só dados (vai ao cliente no bootstrap), só tipos e subtipos ativos; cada tipo e cada subtipo leva `nome` (`nomeEvento`) |
| `validarCampos(definicoes, valores, {listas, desativados}?)` | Formato, obrigatório, `obrigatorio_se`, `visivel_se` (preenchido e não visível → `CAMPO_NAO_SE_APLICA`; `false` passa), lista, faixa (`dinheiro` em centavos, `min`/`max` em reais) e chave desconhecida não vazia (`CAMPO_DESCONHECIDO`). `desativados` = `{LISTA: {código: rótulo}}`: o item desativado é recusado (`VALOR_FORA_DA_LISTA`) com o nome dele na mensagem. Devolve `[{codigo, campo, mensagem}]` |
| `CAMPOS_CORRIGIVEIS`, `PESO_MAX_KG` (2000), `TIPOS_CAMPO`, `TIPOS_IDENTIFICACAO` | Constantes |

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
| `identificacoes(f, id)` / `linhaIdentificacao(registro, evento, ordemSeq)` | IDENTIFICACOES vigentes do animal com o cabeçalho do evento (`{ident_id, event_id, tipo, codigo, codigo_norm, data_inicio, motivo, event_type, event_subtype, event_seq, ordem_seq, remocao}`), na ordem (data_inicio, posição na cadeia de substituição, event_seq). `remocao` = a linha é de uma IDENTIFICACAO/REMOCAO |
| `validarIdentificacoes(linhas)` | Sequência por tipo de identificação de UM animal: PRIMEIRA_IDENTIFICACAO exige o tipo sem código em uso (`IDENTIFICACAO_JA_EXISTE`, com `aberto: {codigo, data_inicio}`); SUBSTITUICAO e REMOCAO exigem um em uso (`SEM_IDENTIFICACAO`); a REMOCAO tira exatamente o código em uso (`REMOCAO_DE_OUTRO_CODIGO`). Linhas de entrada, compra e correção de brinco abrem o código sem conferência |
| `validarMarcacoes(linhas)` | Sequência por subtipo das linhas MARCACAO de UM animal (`payload.acao`): `JA_MARCADO`, `NAO_MARCADO` |
| `descrever(problema, nomePasto?)` | Frase para o pecuarista, sem o "quem" (inclui os códigos das duas sequências; nomes por subtipo: "a baixa na contagem", "a reclassificação", "a troca de identificação", "a retirada de identificação") |
| `NOME_IDENTIFICACAO` | Nome de cada tipo de identificação nas mensagens (brinco, chip (RFID), SISBOV...) |
| `fonte(tx, {excluir, parametros})` | Acesso indexado às linhas da unidade (usa `tx.cru` quando há); `excluir` = eventos tratados como anulados (validação de estorno e de substituição). Quem reproduz a linha do tempo lê com **acesso cru**: a posição de um substituto (`ordem_seq`) é a do primeiro da cadeia, que é um evento anulado; sem `tx.cru`, `ordemSeq` de um substituto lança `INTERNAL` em vez de pôr o substituto no fim do dia em silêncio |
| `projetarAnimal(fonte, id)` → `{campos, meta}`; `projetar(fonte, ids \| null)` | A ÚNICA rotina que calcula as projeções de ANIMAIS (03a, 4.3.3 e 4.3.4); `projetar` inclui as mães alcançadas e `cria_ao_pe`. Na situação, só linha de inventário (efeito ≠ 0 ou com pasto) a partir do marco zero decide as ordens 2 e 3 da tabela de 4.3.4: animal com registros antigos e só fatos NEUTRO depois do marco zero (correção de cadastro, brinco lançado errado) segue HISTORICO, VENDIDO ou MORTO pela saída histórica, com as correções aplicadas. `meta: {situacao, entrada (a mais recente), entradaCusto (revisão 4: `entradaDoCusto`), criacao, chegada: {data, confianca}}`. `custo_aquisicao*` = Σ alocações AQUISICAO_ANIMAIS com competência ≥ a data de `entradaDoCusto` |
| `entradaDoCusto(linhas)` / `ultimaPesagem(fonte, id, data)` | Revisão 4. `entradaDoCusto`: a entrada que abre o período do custo de aquisição (03a, DL-08) — a vigente mais recente desde o marco zero; sem nenhuma (animal só do histórico, sem linha de inventário depois do marco zero), a compra, a outra entrada ou o nascimento (CRIA) anterior ao marco zero mais recente; a mesma fronteira no projetor, na ficha (bloco H) e na invariante 18. `ultimaPesagem`: a última pesagem individual (não MEDIA_LOTE) até a data, por (data, posição na cadeia, `event_seq`) — a base estimada da venda, que a integridade refaz |
| `chegadaDeclarada(fonte, id)` | `{data, confianca}` da chegada DECLARADA na fazenda, contra a qual os registros anteriores ao marco zero são validados (04, seção 6): no rebanho inicial, a `data_entrada` informada com as correções vigentes; no animal criado por COMPRA ou OUTRA_ENTRADA (mesmo antiga), a data desse lançamento; nascido na fazenda, nula. Nunca a data da volta mais recente (que é a `data_entrada` da projeção) |
| `porta()` / `reconstruir(tx, escopo)` | Porta `ctx.projecoes`. Escopo `{animais, eventos}` (o `derivados` do EventService) ou `{tudo: true}`. Grava ANIMAIS (+ `updated_at` quando algo muda), `IDENTIFICACOES.data_fim` e FINANCEIRO (`status`, `cancelado_em` = `created_at` do anulador, `cancelado_por_event_id`, `status_pagamento` e `data_pagamento` por `FinancialService.situacaoPagamento`, `animal_id` da alocação DIRETA) |
| `conferir(tx)` | Projeção gravada × reconstrução total (precisa de `tx.cru`): `[{tabela, id, campo, gravado, calculado}]`, vazio = coincidem. Base da integridade (E1.11) |
| `inventario(linhas, D, marcoZero)` | `{data, total, porPasto: {pasture_id: n}, semPasto, porSituacao: {ATIVO, VENDIDO, MORTO, DESCARTADO, BAIXADO_AJUSTE}, motivo}` (`porSituacao`: cada animal que já tinha entrado até D, pela situação na data; ATIVO = `total` com a linha do tempo válida); D < marco zero → nulos com `ANTERIOR_AO_MARCO_ZERO`; sem marco zero → `DADOS_INSUFICIENTES`. Sexo e categoria em D ficam no `InventoryService.posicao` (precisam das categorias) |
| `estadas(linhasDoAnimal)` | Estadas por pasto do marco zero em diante, `[{pasture_id, inicio, fim, entrada, saida}]` na convenção [início, fim) (o dia da entrada conta, o da saída não; `fim` null = em andamento): abre na entrada e em movimento para outro pasto, fecha no movimento seguinte e na saída. A regra única do bloco D da ficha, do "desde quando" e dos dias de permanência |
| `situacaoEm(linhasDoAnimal, D, marcoZero)` | `{presente, pasture_id, situacao (ATIVO, VENDIDO, MORTO, DESCARTADO, BAIXADO_AJUSTE, AINDA_NAO_ENTROU), no_rebanho_desde, no_pasto_desde, entrada, saida, motivo}` ao fim do dia D; `entrada`/`saida` = `{event_id, event_type, event_subtype, event_date}` |
| `presentesEm(linhas, D, marcoZero)` | `{motivo, itens: [{animal_id, pasture_id, no_rebanho_desde, no_pasto_desde, entrada}]}` (ordem de animal_id) — a lista do inventário em D |
| `diasPermanencia(linhas, {inicio, fim}, escopo, {marcoZero, categoriaEm?})` | 05, seção 4.6 (base do rateio DIAS_PERMANENCIA da Fase 4): por animal, dias = Σ máx(0, mín(saída, fim + 1) − máx(entrada, início)) nas estadas do escopo — `{tipo: REBANHO}`, `{tipo: PASTO, ref: pasture_id}`, `{tipo: LISTA, ref: [animal_id]}`, `{tipo: CATEGORIA, ref: category_id}` (com `categoriaEm(animal_id, dia)`, contada dia a dia). Devolve `{inicio, fim, inicio_efetivo, parcial, escopo, motivo, base_total, n, por_pasto: [{pasture_id, dias, animais}], itens: [{animal_id, dias, por_pasto: {pasture_id \| SEM_PASTO: dias}, intervalos: [{inicio, fim (inclusivos), dias, pasture_id}]}]}` (só dias > 0). Σ dias nos pastos = dias no rebanho. Sem marco zero / período todo antes dele: `base_total`, `n`, `itens` null com o motivo; começa antes: `parcial`, conta do marco zero. Erros: VALIDATION (`FORMATO_INVALIDO`, `FAIXA_INVALIDA`, `VALOR_FORA_DA_LISTA`, `CAMPO_OBRIGATORIO`), INTERNAL (CATEGORIA sem `categoriaEm`) |
| `SITUACOES_NA_DATA`, `SEM_PASTO` | As situações contadas em `porSituacao`; a chave de `itens[].por_pasto` para os dias sem pasto |
| `pastoEm(linhasDoAnimal, D, marcoZero)` | `{presente, pasture_id, motivo}` ao fim do dia D |
| `pastoAntesDaSaida(linhasDoAnimal, D, marcoZero)` | Onde o animal estava no dia D depois das entradas e movimentos de D e antes das saídas de D: a origem de uma saída lançada em D e o pasto padrão das crias de um parto em D |
| `consultaInventario({data, animal_id?})` | Consulta pronta para `UnitOfWork.read` (rota `inventario.posicao`) |
| `dataBr(d)` | `yyyy-MM-dd` → `dd/mm/aaaa` nas mensagens ao pecuarista; vazio → `''` |

Regras do projetor que valem como contrato: atributo = criação (`atributos_iniciais_json`, booleanos `S`/`N`) + correção
CORRECAO_CADASTRO vigente de maior `event_seq`; ANULADO/PENDENTE conservam os atributos declarados na linha de criação
mais recente (inertes) e zeram o resto; ANIMAIS sem nenhuma linha em EVENTO_ANIMAIS é EXTERNO, salvo se a linha gravada
está PENDENTE ou ANULADO (queda na fase A) — então ANULADO; estoque (`PRODUTOS.estoque_atual`) ainda não é projetado
(só a Fase 3 grava MOVIMENTOS_ESTOQUE). A linha de IDENTIFICACOES de uma retirada guarda o código tirado e o motivo: fecha
o código em uso (`data_fim` = data da retirada) e fecha a si mesma (`data_fim = data_inicio`); `brinco` é o último BRINCO
que não seja retirada. Identificações e reclassificações seguem a posição na cadeia de substituição (desenho-base 16.1);
as correções de cadastro, a ordem de registro (`event_seq`). DIVERGENCIA_CONTAGEM → BAIXADO_AJUSTE; MARCACAO → `marcado_descarte`
/ `nao_localizado` pela última marcação do subtipo. Fêmea nascida por NASCIMENTO tem `partos_previos = 0` (03a, 4.3.5); MORTE →
MORTO (terminal), DESCARTE → DESCARTADO; PARTO → VAZIA e cria ao pé enquanto houver cria ATIVA sem desmama. Todo
problema do validador traz também `papel` (no parto, a linha MATRIZ é descrita como "o parto").

## 14. `EventService` (puro: comandos e consultas do motor)

Pedido de comando: `{idempotencyKey, dados, avisosAceitos: [códigos], dataVersionEsperada?}`. Dinheiro em centavos
inteiros; datas `yyyy-MM-dd`. Erros: VALIDATION (detalhes por animal e campo), CONFLICT (detalhe com
`conflito: {event_id, tipo, subtipo, data, nome}`: `tipo` é sempre o `event_type` do evento que impede (nunca o subtipo), `subtipo` o `event_subtype` e `nome` o lançamento como substantivo, `EventCatalog.nomeEvento`), NEEDS_CONFIRMATION (avisos sem aceite; nada gravado; chave livre), NOT_FOUND,
CONFIG (sem marco zero; conta SALDO_ABERTURA_REBANHO ausente), além dos da UnitOfWork (entre eles a recusa da trava de
integridade, `VALIDATION`/`CONFLICT` com `INTEGRIDADE_<CHECAGEM>` nos detalhes, seção 10.5).

Revisão final (rodada 5), conferências próprias novas: `CRIA_JA_NO_CADASTRO` (a cria viva nova cujo nascimento e mãe são
os de um filho da mãe que já está no cadastro sem parto, ou cujo brinco é de um animal nascido no dia do parto sem parto:
o parto de quem já está no cadastro não se lança); no parto antigo, o animal do cadastro nascido no mesmo dia e sem mãe
informada pede o aviso `POSSIVEL_DUPLICIDADE`; `PASTO_INATIVO` também no pasto das crias que vem da mãe (campo
`pasto_destino_id`, "escolha o pasto das crias"); `PRENHA_SEM_IDADE` (a fêmea que entra prenhe nascida no dia da
entrada); as mensagens da correção de cadastro usam o rótulo do campo (`EventCatalog.CAMPOS_CORRIGIVEIS[campo].rotulo`).

| Função | Contrato |
|---|---|
| `comando(acao, pedido)` | Comando para `UnitOfWork.run` (`acessoCru: true`: o motor lê eventos anulados para a posição do substituto e para o histórico). `acao` ∈ `registrar` (rota `evento.registrar`), `corrigir` (`evento.corrigir`), `estornar` (`evento.estornar`) |
| `registrar/corrigir/estornar(ctx, pedido)` | `UnitOfWork.run(ctx, comando(...))` → `{dados: resposta, duplicado, opId, dataVersion}` |
| `simular(ctx, {acao, dados, avisosAceitos})` | Mesmo tratador em modo SIMULAR → `{dados: {simulacao, impactos, avisos, linhas}}`; erro de validação e bloqueio (CONFLICT) são lançados como no commit. No estorno, `impactos: {acao: 'estornar', estorna, event_type, event_subtype, nome, event_date, animais, anulados, cancelados, corrige}`; `corrige = {event_id, event_date, nome}` do original quando o alvo é um substituto (a revisão avisa que o lançamento some por inteiro e o original não volta), senão null |
| `consultaListar(filtros)` / `listar(ctx, filtros)` | `{total, pagina, por_pagina, itens: [evento]}`; filtros `{tipo, subtipo, de, ate, animal_id, vigentes, pagina, por_pagina}`; inclui anulados e estornos (com `animal_id`, também os ESTORNO dos eventos do animal, que não têm linha de animal); não inclui operações que falharam. Ordem: mais recentes primeiro, por data e pela posição na cadeia de substituição (`Timeline.fonte(...).ordemSeq`; revisão 4: o substituto fica no lugar do evento que corrige, não vira o lançamento mais recente do dia — desenho-base 16.1). Evento: `{event_id, event_seq, event_type, event_subtype, rotulo, rotulo_subtipo, event_date, registration_date, property_id, partner_id, status, vigente, description, notes, responsible, total_value, created_by, source, pre_marco_zero, payload, reversal_of_event_id, anulado_por, animais (n), created_at}` |
| `consultaObter({event_id})` / `obter(ctx, dados)` | `{evento (como na lista), linhas (com codigo_interno e brinco), detalhes: {IDENTIFICACOES, PESAGENS, REPRODUCAO, BAIXAS, AJUSTES, COMPRAS, VENDAS, FINANCEIRO (na ordem de gravação, com `status` e `cancelado_por_event_id`), PARCELAS (por lançamento, por número), RATEIOS, ALOCACOES_FINANCEIRAS}, anexos (`FileService.anexosDoEvento`: do evento e dos lançamentos dele, com `financial_id` e `vigente`), anula, papeis: {financial_id: ANIMAIS \| FRETE \| OUTRO \| RECEITA \| DEDUCAO:<tipo> \| conta_id} (o papel de cada lançamento, pelas funções que gravam), totais_venda (só na VENDA: `FinancialService.totaisVenda` sobre a linha de VENDAS e as deduções; null nos demais), propostas (revisão 4, só no NASCIMENTO: `{pasto_destino_id, raca}` que o servidor propõe com o campo vazio — o pasto da mãe no dia do parto, sem o próprio parto, e a raça da mãe —; a prévia da correção deixa vazio o valor igual à proposta; null nos demais e no pasto do parto histórico)}` — a tela só exibe (§20, regra 8), também de evento anulado (os anexos como histórico) e de ESTORNO (sem linhas); NOT_FOUND |
| `planejarEntradaImportada(tx, {campos, animais}, {importacao: {import_id}, conhecidos, rotulos})` | O MESMO planejamento da ENTRADA_INICIAL (todas as regras do formulário) dentro do tratador de outro comando: o evento nasce com `import_id` e `source = IMPORTACAO`; `conhecidos` = `{animal_id: {sexo, data_nascimento, mae_id, pai_id, nome}}` de animais ainda pendentes da mesma importação, aceitos como mãe ou pai; `rotulos[i]` substitui o "quem" das mensagens (ex.: `Linha 12`). Devolve o resultado do tratador (`{erros}` ou `{avisos, resumo, derivados, ...}`); exige `leiturasEntrada()` e acesso cru |
| `planejarEventoImportado(tx, dados, {importacao: {import_id}, rotulos, rotulosCrias})` | O equivalente para os eventos históricos (`HISTORICO_IMPORTADO` = COMPRA, VENDA, TRANSFERENCIA, NASCIMENTO, MORTE): `dados` como em `registrar` (`{tipo, campos, animais, crias, parcelas, custos, deducoes}`), o MESMO planejamento do formulário; `rotulosCrias[k]` é o "quem" da cria k. Com `import_id`, data anterior ao marco zero vira registro histórico (abaixo). Exige `leiturasEvento(tipo)` e acesso cru; CONFLICT e CONFIG são lançados |
| `leiturasEvento(tipo)` | Abas que o planejamento do tipo lê (catálogo + `Timeline.LEITURAS` + ANEXOS) |
| `leiturasEntrada()` | Abas que esse planejamento lê |
| `conferirRestauracao(tx, eventIds, animalIds, verbo)` | O que deixar de valer os eventos `eventIds` DEVOLVE aos animais `animalIds` que eles só tocaram: as mesmas conferências do estorno (brinco hoje de outro, sexo e nascimento com os filhos, mãe e pai pela genealogia, categoria desativada). Devolve os conflitos (`[detalhe com conflito]`), sem lançar; exige as leituras do motor e acesso cru. Usado pelo desfazer da importação de eventos (seção 18.2) |
| `classificarCategoria(perfil, data, categorias)` | Perfil `{sexo, data_nascimento, castrado, reprodutor, parida, categoria_modo, categoria_manual_id}` (valores em D) → `{category_id, codigo, nome, manual}` ou `null` |
| `coberturaCategorias(categorias)` | `{completa, testes, lacunas: [{perfil, rotulo, idade_de, idade_ate}]}` (05, seção 4.9); base do aviso CATEGORIAS_SEM_COBERTURA em `categoria.salvar` |
| `MAX_ANIMAIS` (1000), `MAX_CRIAS` (4) | Limites de um lançamento e de crias por parto |

Erro de campo de um animal já cadastrado (sujeito do evento: transferência, saídas, venda, matriz do parto,
identificação, marcação, ajuste, volta ao rebanho) traz `animal_id` e `brinco` no detalhe desde a validação do catálogo
(`apontarExistente_`), como as regras do sujeito; o animal novo (entrada, compra, cria) é apontado pelo brinco digitado.

`dados` de registrar/corrigir: `{tipo, subtipo (obrigatório nos tipos com subtipos: `CAMPO_OBRIGATORIO` em `subtipo`;
subtipo fora da fase → `TIPO_INDISPONIVEL`), campos: {event_date, property_id, description, responsible, notes,
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
  VENDIDO, DESCARTADO, BAIXADO_AJUSTE ou HISTORICO (EXTERNO → `ANIMAL_EXTERNO`: cadastro de referência não entra no
  rebanho, nem por compra).
- COMPRA: `campos` e `animais` da seção 12 + `parcelas` e `custos`. Animal novo: como na entrada (atributos, brinco,
  outras identificações), origem COMPRADO, pasto do item ou do lote, `brinco_origem` → IDENTIFICACOES `BRINCO_ORIGEM`
  (sem unicidade), peso vivo → EVENTO_ANIMAIS.peso e PESAGENS (tipo COMPRA), carcaça → `peso_carcaca_kg` (nunca
  pesagem). Animal que volta: `{animal_id, brinco?, brinco_origem?, pasto_destino_id?, peso?, metodo_pesagem?,
  peso_carcaca_kg?, valor_individual?, base_manual?, observacoes?}`, só VENDIDO, DESCARTADO, BAIXADO_AJUSTE ou HISTORICO
  (`ANIMAL_MORTO`, `JA_NO_REBANHO`, `ANIMAL_EXTERNO`). A negociação é `FinancialService.negociacao` (erros dela por campo
  ou por animal; o campo que o catálogo já recusou não leva segundo erro, nem o do cabeçalho que a negociação só
  calcularia com o valor de um animal já recusado: peso → peso total, carcaça → carcaça total e rendimento apurado, valor
  do animal → valor do lote; `recusadosNegocio_`, também na venda). Grava COMPRAS (1 linha), EVENTOS.partner_id =
  fornecedor e `total_value` = `valor_total`, o lançamento COMPRA_ANIMAIS (valor dos animais, quantidade = cabeças,
  documento = nota fiscal, as parcelas) e um FRETE_DESPESAS_COMPRA por custo (os fretes antes dos outros custos e com os
  menores `financial_id` da compra: o tipo de cada item se reconstrói pelo prefixo que soma `COMPRAS.frete` na ordem do
  identificador, nunca na ordem física das linhas, que o dono pode classificar — revisão 4; `FinancialService.tiposDosCustos`;
  `FinancialService.planejar` aceita o `financial_id` escolhido por quem chama), todos 100%
  rateados pelo mesmo critério e bases; `EVENTO_ANIMAIS.valor_individual` = a alocação do lançamento principal. Erros:
  `PARCEIRO_INATIVO` (aceito na correção se o original já o usava), `NAO_ENCONTRADO`, `PASTO_INATIVO`, os da negociação
  e das parcelas (`SEM_PARCELAS`, `PARCELAS_NAO_SOMAM`, `PARCELAS_DEMAIS`...), `CONFIG` sem a conta do sistema. Avisos:
  `VALOR_DIVERGENTE`, `RATEIO_SEM_PESO`, `PERIODO_BLOQUEADO`. Data antes do marco zero → `ANTES_DO_MARCO_ZERO`.
- IDENTIFICACAO: `animais: [{animal_id, codigo?, motivo?, observacoes?}]` (seção 12); tipo do lançamento em
  `campos.tipo_identificacao`. Fato independente (presença na data, o dia da saída conta). Uma linha de EVENTO_ANIMAIS
  (efeito 0) e uma de IDENTIFICACOES por animal: o código novo (a projeção fecha o anterior) ou, na REMOCAO, o código em uso
  na data com o motivo (fecha o código e a si mesma). Erros: `TIPO_NAO_SE_APLICA` (BRINCO_ORIGEM fora da retirada),
  `SEM_IDENTIFICACAO` (retirada sem código em uso), `VALOR_IGUAL`, `IDENTIFICACAO_JA_EXISTE` e `SEM_IDENTIFICACAO` pela
  sequência (`Timeline.validarIdentificacoes`), e, no brinco, a unicidade (`BRINCO_DUPLICADO`, `BRINCO_REPETIDO`,
  `BRINCO_NAO_NUMERICO`, aviso `BRINCO_PARECIDO`) e o reuso (`BRINCO_APOSENTADO`: código já usado por outro animal, aberto ou
  fechado, com `brinco_permite_reuso = N`; o próprio animal retoma o seu; o código que é `valor_anterior` de uma
  IDENTIFICACAO_INCORRETA vigente do mesmo animal não conta — desenho-base 16.2 —, nem o que uma IDENTIFICACAO_INCORRETA do
  próprio lançamento tira de outro animal, também no substituto de uma correção; com o reuso desligado, o número que um
  animal deixa no lançamento não vai para outro do mesmo lançamento). Retroativa que quebra a sequência gravada (uma
  primeira antes de outra primeira; uma troca antes de uma retirada) → CONFLICT com o evento. Demais: os do sujeito
  (`NAO_ENCONTRADO`, `ANIMAL_EXTERNO`, `ANIMAL_REPETIDO`) e da linha do tempo (`FORA_DA_PERMANENCIA`, `APOS_MORTE`).
- MARCACAO: `animais: [{animal_id, observacoes?}]`; `payload_json = {acao, motivo_descarte?}`. Linha de efeito 0; presença
  na data. Marcar o já marcado / desmarcar o desmarcado (na data) → `JA_MARCADO` / `NAO_MARCADO` (sequência
  `Timeline.validarMarcacoes`; retroativa que quebra a seguinte → CONFLICT). A guarda de duplicidade só compara marcações
  da mesma ação. `motivo_descarte` fora do subtipo DESCARTE → `CAMPO_DESCONHECIDO`; com DESMARCAR → `CAMPO_NAO_SE_APLICA`.
- AJUSTE_INVENTARIO/RECLASSIFICACAO: `{animal_id, categoria_manual_id | null}`. A categoria existe (`NAO_ENCONTRADO`), está
  ativa (`CATEGORIA_INATIVA`) e serve ao sexo (`CATEGORIA_INCOMPATIVEL`; idade e condição não contam); igual à que valia na
  data (manual ou automática) → `VALOR_IGUAL`. AJUSTES: `campo = categoria_manual_id`, `valor_anterior` = a manual que valia
  logo antes (null = automática), `valor_novo` (null = volta à automática). Presença na data.
- AJUSTE_INVENTARIO/DIVERGENCIA_CONTAGEM: `{animal_id, observacoes?}`. Saída (−1) com a origem da linha do tempo no dia e
  uma linha de BAIXAS (`tipo` DIVERGENCIA_CONTAGEM, sem causa; `observacoes` = as do item ou a justificativa); não grava
  AJUSTES. Situação BAIXADO_AJUSTE (fora do inventário e dos elegíveis, na lista de baixados, dono do brinco); reentrada por
  OUTRA_ENTRADA ou COMPRA de animal existente; reaparecimento = estorno da baixa (`ENTRADA_JA_DENTRO` CONFLICT se houve
  reentrada depois). Erros: `FORA_DO_REBANHO`, os do sujeito, e CONFLICT com fato posterior (`FORA_DA_PERMANENCIA`).
- MORTE / DESCARTE com lançamento: `custo_valor` + `custo_conta_id` (CUSTEIO; outra natureza → `CONTA_INVALIDA`) ou
  `receita_valor` (OUTRAS_RECEITAS_OPERACIONAIS): um lançamento com um título (vencimento vazio = data do evento) e rateio
  CABECAS entre os animais (DIRETO com um); `total_value` = o valor; no descarte, EVENTOS.partner_id = quem pagou.
- AJUSTE_INVENTARIO: CORRECAO_CADASTRO `{animal_id, campo, valor_novo}` (um item por campo; texto canônico, `''` =
  desconhecido; apagar mãe, pai ou nascimento apaga a confiança); IDENTIFICACAO_INCORRETA `{animal_id, brinco}` (corrige o
  brinco que está no cadastro; a correção vem depois do lançamento desse brinco na ordem canônica — no mesmo dia, pela
  posição, com o substituto no lugar do original —, senão `ANTES_DA_IDENTIFICACAO`; teste aleatório, seção 36);
  CORRECAO_LOCALIZACAO `{animal_id, pasto_destino_id, pasto_origem_id?}` (a origem é a da linha do tempo na POSIÇÃO do lançamento
  no dia: depois das entradas e dos movimentos do dia que vêm antes dele — na correção, o substituto fica no lugar do
  original, antes de uma transferência posterior do mesmo dia —; as saídas do dia vêm depois: no dia de uma venda, o
  que quebra é a venda, CONFLICT com ela).
- NASCIMENTO: `animais: [{animal_id: matriz}]` (exatamente uma; `UMA_MATRIZ`) e `crias: [{situacao_nascimento, sexo,
  brinco, nome, raca, peso, metodo_pesagem, observacoes}]` (1 a 4; `SEM_CRIAS`, `CRIAS_DEMAIS`). Cada viva cria um animal
  (papel CRIA, +1) com mãe = matriz (CONFIRMADA), nascimento = data do parto (CONFIRMADA), origem NASCIDO, castrado e
  reprodutor N no macho, raça da mãe por padrão, pai do cabeçalho; brinco opcional (pendência "sem brinco"); peso →
  PESAGENS tipo NASCIMENTO. A matriz tem linha MATRIZ (efeito 0, validada como fato: presença na data, limites
  inclusivos). Uma linha REPRODUCAO PARTO na matriz (`qtd_nascidos_vivos`, `qtd_natimortos`, `tipo_parto`, `touro_id` =
  pai, `data_parto`), mesmo sem vivos. Erros: `MATRIZ_NAO_FEMEA`, `ANIMAL_EXTERNO`, linha do tempo (`FORA_DA_PERMANENCIA`,
  `APOS_MORTE`, `ANTES_DO_NASCIMENTO`), genealogia do pai (`SEXO_DO_PROGENITOR`, `NASCIMENTO_DO_PROGENITOR`, `NAO_ENCONTRADO`;
  na cria viva, pela genealogia dela; sem cria viva, no campo `pai_id` do cabeçalho: existe e não foi anulado — o animal de
  referência serve —, é macho e nasceu antes do parto; revisão 3),
  brinco, `PASTO_INATIVO`, `CAMPO_OBRIGATORIO` (mãe sem pasto no dia e pasto vazio). Avisos (uma vez por parto):
  `IDADE_REPRODUTIVA`, `INTERVALO_PARTO_CURTO` (outro parto a menos de `dias_gestacao`, antes ou depois). Data antes do
  marco zero: registro histórico (`pre_marco_zero = S`, efeito 0, pasto opcional, sem lotação), crias HISTORICO, validado só
  contra nascimento e chegada declarada da matriz. Na correção, a cria viva leva o `animal_id` do original (outro →
  `SO_ANIMAIS_NOVOS`); cria que vira natimorta ou sai é anulada com as regras do estorno.
- Histórico anterior ao marco zero (04, seção 6; E2.10): no formulário só o NASCIMENTO aceita data antiga; COMPRA, VENDA,
  TRANSFERENCIA e MORTE aceitam pela importação (`opcoes.importacao`) e na correção de um registro que já é histórico.
  O evento nasce `pre_marco_zero = S`, com efeito 0 em todas as linhas (fora do replay e do inventário, validado só contra
  nascimento e chegada declarada), sem lotação, sem pasto de origem derivado e aceitando pasto desativado depois; a compra
  histórica de animal já cadastrado (inclusive ATIVO ou MORTO hoje) é registro informativo, sem trocar o brinco da casa
  (só o brinco do vendedor entra). O financeiro é o do próprio evento, sem caixa (`semCaixa`: nenhuma parcela, `SEM_CAIXA`,
  como o saldo de abertura), com o rateio de sempre; parcela informada → `PARCELA_ANTES_DO_MARCO_ZERO`. A alocação da
  compra histórica fica no histórico do animal e fora do `custo_aquisicao` da permanência que começa no marco zero
  (a mesma regra da checagem CUSTO_AQUISICAO).
- TRANSFERENCIA: `animais: [{animal_id}]`; origem e destino no cabeçalho. Erros: `DESTINO_IGUAL_ORIGEM`, `PASTO_INATIVO`,
  `NAO_ENCONTRADO` (pastos e animal), `ANIMAL_EXTERNO`, `ANIMAL_REPETIDO`, `ORIGEM_DIVERGENTE` por animal (a origem é
  conferida pela linha do tempo na data), `FORA_DO_REBANHO`, `APOS_MORTE`; retroativa que quebra evento posterior →
  CONFLICT com o evento. Aviso `LOTACAO_ACIMA_DA_CAPACIDADE`. `payload_json.gta_numero` quando informado.
- MORTE / DESCARTE: `animais: [{animal_id, observacoes?}]`. Linha de saída (−1) com `pasto_origem_id` tirado da linha do
  tempo (`Timeline.pastoAntesDaSaida`) e uma linha de BAIXAS por animal (`tipo`, `causa`/`diagnostico` ou
  `motivo`/`destino`, `responsavel` = `responsible`, `observacoes`); lançamento opcional acima.
- VENDA: `animais: [{animal_id, peso?, metodo_pesagem?, peso_carcaca_kg?, valor_individual?, base_manual?, motivo_saida?,
  observacoes?}]` + `parcelas` e `deducoes`. Linha de saída (−1) com a origem do cabeçalho (conferida pela linha do tempo:
  `ORIGEM_DIVERGENTE`) ou, sem ela, a de `Timeline.pastoAntesDaSaida`; a origem que o servidor tira da linha do tempo nunca
  vira erro próprio (só diverge quando outro registro a quebrou, e esse é o problema mostrado). Animal: `sujeito_`
  (`NAO_ENCONTRADO`, `ANIMAL_EXTERNO`), `ANIMAL_REPETIDO`, `FORA_DO_REBANHO` (antes da entrada, já vendido, morto),
  saída posterior quebrada (CONFLICT com o evento: a morte, a recompra), transferência no dia da venda lançada depois
  (CONFLICT com a venda, 04 5.2 ii). A negociação é `FinancialService.negociacao` com o bruto como conferência e a receita
  (bruto − desconto) como valor distribuído; sem o peso de cada animal, a base é a última pesagem individual até a data
  (não MEDIA_LOTE) escalada para o peso do lote, marcada em `RATEIOS.justificativa` ("Base estimada: …"), ou CABECAS
  (aviso `RATEIO_SEM_PESO` nos dois casos). Grava VENDAS (1 linha: totais `frete`, `comissao`, `outras_deducoes` pelo tipo),
  EVENTOS.partner_id = comprador e `total_value` = `valor_bruto` (03b, 2.5), a receita VENDA_ANIMAIS (quantidade = cabeças,
  documento = nota, as parcelas) e uma dedução por item na conta do tipo (`FinancialService.contaDeducao`: FRETE_VENDA,
  COMISSAO_VENDA, TAXAS_RETENCOES_VENDA), com `retida_pelo_comprador` e um título; todas 100% rateadas pelo mesmo critério;
  `EVENTO_ANIMAIS.valor_individual` = a alocação da receita; PESAGENS (VENDA) só com peso vivo individual; carcaça nunca vira
  pesagem; `payload_json.deducoes: [{financial_id, tipo}]`. Erros próprios: `VALOR_FORA_DA_FAIXA` (desconto ≥ bruto),
  `RETIDA_FORA_DO_RECEBIMENTO` (retida com vencimento que não é de uma parcela da receita), `RETENCAO_MAIOR_QUE_RECEBIMENTO`
  (retidas num dia acima do que o comprador paga nele), os da negociação, das parcelas (`SEM_PARCELAS`: "como a receita da
  venda será recebida") e dos parceiros. Aviso `CARENCIA_ATIVA` (um por animal; `HealthService.carenciaEm` sobre SANIDADE
  vigente): na finalidade ABATE vale `avisos_politica` (padrão BLOQUEIA → VALIDATION com o mesmo código); nas demais é
  sempre aviso com aceite, qualquer que seja a política. Estorno: o animal volta à posição da linha do tempo (situação,
  pasto e peso recalculados); recompra posterior → CONFLICT `ENTRADA_JA_DENTRO` com a compra; parcela LIQUIDADA →
  `PARCELA_LIQUIDADA`. Correção: mesmos ou menos animais (o que sai da venda volta ao rebanho), lançamentos novos.
- Datas antes do marco zero só no tipo com `aceita_historico` (NASCIMENTO); nos demais tipos, `ANTES_DO_MARCO_ZERO` sozinho (sem conferir a linha do tempo).
- AJUSTE_INVENTARIO/CORRECAO_CADASTRO de sexo ou nascimento (RN-012, revisão 3): quem é o touro de um registro reprodutivo
  vigente (`REPRODUCAO.touro_id`, o pai do parto mesmo só de natimorto) não deixa de ser macho nem passa a ter nascido no dia
  do registro ou depois (`SEXO_DO_PROGENITOR`, `NASCIMENTO_DO_PROGENITOR`, uma vez, com o primeiro registro); o nascimento
  corrigido do próprio animal fica depois do nascimento da mãe e do pai que ele já tem (`NASCIMENTO_DO_PROGENITOR`, RN-009).
- Correção do lançamento que criou o animal (rebanho inicial, compra, outra entrada, parto): o conjunto final decide — o
  sexo e o nascimento são os do substituto com as correções de cadastro que continuam valendo, e a chegada declarada que os
  registros anteriores ao marco zero precisam respeitar é a `data_entrada` do substituto (com a correção vigente) no rebanho
  inicial e a data do substituto na compra e na outra entrada (`ANTES_DA_ENTRADA` CONFLICT com o registro antigo; revisão 3).
- Brinco (revisão 3; 05, seção 4.1, RN-002 e RN-004): um número fica em um animal por vez. Com as linhas de brinco do comando
  no lugar (o substituto no lugar do original), cada período de uso que começa ou termina numa linha do comando não pode
  cruzar o de outro animal com o mesmo número — com o reuso ligado, o número só passa a outro depois do período de quem o
  tinha —; CONFLICT `BRINCO_DUPLICADO` com a troca que fecha o período do outro animal ou com a linha que lhe deu o número.
  Vale para a primeira identificação, a troca, a retirada, a entrada com brinco, a correção de brinco e a correção da data de
  qualquer delas; o número corrigido por IDENTIFICACAO_INCORRETA não conta (desenho-base 16.2). Na correção de quem criou o
  animal, o brinco de criação igual ao do original não é proposta nova (nem `BRINCO_DUPLICADO` contra o dono de hoje, nem
  reuso): o número pode ter sido acertado depois e reaproveitado (RN-045). Revisão 4: a mesma conferência dos períodos vale
  no estorno, na correção que tira a linha de brinco do original (os animais que o original tocava) e no desfazer de uma
  importação (`conferirRestauracao`): o período que o evento anulado muda (a troca intermediária estornada, o "brinco
  lançado errado" estornado, que volta a valer desde a entrada) e cruza o de outro animal → CONFLICT `BRINCO_DUPLICADO` com
  o registro do outro animal ("o estorno devolveria ao animal o brinco 107 até 01/06/2026, mas desde 01/04/2026 ele é do
  animal …"); um conflito por animal e registro (o dono de hoje, já citado, não se repete).
- Revisão 4, o conjunto final em toda correção e todo estorno: (a) a chegada declarada no rebanho inicial não fica antes do
  nascimento — na correção de quem criou o animal, com a chegada e o nascimento do substituto mais as correções de cadastro
  vigentes (`ENTRADA_ANTES_DO_NASCIMENTO` no rebanho inicial; `NASCIMENTO_DEPOIS_DA_ENTRADA` na compra e na outra entrada,
  com o nascimento que uma correção pôs depois da data do lançamento), e no que volta com o estorno, a correção ou o
  desfazer (CONFLICT `ENTRADA_ANTES_DO_NASCIMENTO` com a correção vigente da outra data, ou com o rebanho inicial); (b) na
  correção de quem criou o filho, a mãe e o pai do conjunto final são os do substituto com as correções de cadastro
  vigentes, e as regras da genealogia (sexo, nascimento antes do filho, ciclo) valem com eles (`NASCIMENTO_DO_PROGENITOR`;
  o filho que o comando recria não leva segundo erro pela RN-012); (c) a mãe de um parto só de natimorto nasceu antes do
  parto: no registro (`NASCIMENTO_DO_PROGENITOR` no animal da mãe, quando nasceu no próprio dia; nascida depois, a linha do
  tempo já recusa), na correção do nascimento dela (`NASCIMENTO_DO_PROGENITOR`, "o animal é a mãe do parto de …") e no que
  volta com o estorno (CONFLICT `PARTO_DA_MATRIZ` com o parto); (d) a categoria escolhida à mão que continua valendo serve
  ao sexo final: a correção de sexo (de cadastro, de quem criou o animal ou da cria pelo parto) e o estorno ou o desfazer
  que devolvem o outro sexo dão CONFLICT `CATEGORIA_INCOMPATIVEL` com a reclassificação; (e) o pai da cria nascida na
  fazenda é o do parto: a correção do parto que passa a informar um pai diferente do que uma correção de cadastro pôs na
  cria (aceita enquanto o parto não informava pai) dá CONFLICT `PAI_DA_CRIA` com essa correção; informando o mesmo pai,
  ou estornada a correção, passa.
- Revisão 4, cadastro desativado depois do uso (RN-045; 03a, seção 3): na correção, o pasto, a propriedade e a categoria
  que o original já usava continuam aceitos (`m.usadosOriginal`, junto com os itens de lista e o parceiro); um desativado
  novo continua recusado (`PASTO_INATIVO`, `PROPRIEDADE_INATIVA`, `CATEGORIA_INATIVA`).
- Revisão 4, o registro citado no conflito de genealogia (seção 14): quando a mãe ou o pai do filho veio de uma correção de
  cadastro vigente, o `conflito` aponta essa correção (`refVinculo_`), não o lançamento que criou o filho; sem correção, o
  lançamento em que o vínculo nasceu.
- AJUSTE_INVENTARIO/CORRECAO_CADASTRO de cria nascida na fazenda (criação por NASCIMENTO vigente): `mae_id`, `mae_confianca`,
  `data_nascimento`, `data_nascimento_confianca` e `origem` são do parto, e `pai_id`/`pai_confianca` também quando o parto
  informa o pai → VALIDATION `NAO_SE_APLICA` ("Corrija o parto (evento de nascimento) em vez da cria").
- Retroativo que deixa um registro posterior com a origem errada (`ORIGEM_DIVERGENTE`: a morte, o descarte, a baixa na
  contagem, a venda, a transferência seguinte): CONFLICT com ele (03b, seção 3: `pasto_origem_id` imutável e igual ao
  destino anterior; 04, 5.2 ii). A mensagem dá o caminho que funciona — estornar o registro, lançar este e registrá-lo de
  novo —, porque corrigi-lo antes não muda a origem (o substituto é conferido pela linha do tempo de hoje).
- Correção: o código de lista desativado depois de usado que aparece nas linhas do original (dedução, forma de pagamento,
  causa, motivo, raça) continua aceito no substituto (`aceitarListasDoOriginal_`; 03a, LISTAS); desativado novo → recusado.
- ESTORNO (`estornar`): `{event_id, justificativa}`. Na simulação, `impactos = {acao: 'estornar', estorna, event_type,
  event_date, animais, anulados, cancelados: {lancamentos, receitas, despesas, total, parcelas_abertas} | null}`
  (`cancelados`: os lançamentos do evento, que deixam de valer pela vigência; receita e despesa à parte, em centavos;
  `total` só quando são todos de uma natureza, senão null — na venda, a receita e as deduções não se somam, 03b, 2.5; a
  revisão do estorno mostra "receita de R$ X e deduções de R$ Y").

Resposta (e reenvio duplicado): `{acao, event_id, event_type, event_subtype, event_date, status, total_value,
substitui, estorna, animais: [{animal_id, codigo_interno, brinco, sexo, situacao_cadastral, pasto_atual_id}]}`
(no estorno, os animais do evento estornado). `derivados` = `{animais, eventos}`. `payload_json`: `justificativa`
(corrigir/estornar), `valor_abertura_origem` (`INFORMADO`), `gta_numero` (TRANSFERENCIA), `deducoes` (VENDA), `acao` e
`motivo_descarte` (MARCACAO), `motivo_ajuste` (AJUSTE_INVENTARIO/DIVERGENCIA_CONTAGEM: a justificativa do lançamento, que
esse subtipo não grava em AJUSTES), `avisos_aceitos: [{codigo, n, justificativa?}]`. Os comandos de evento leem ANEXOS: a
correção passa ao substituto os anexos ativos do original (seção 32). `impactos` da simulação: `{acao, event_type, event_subtype, event_date, animais, novos, anulados
(revisão 4: só os animais que o original criou e ficaram fora do substituto — esses são ANULADOS), voltam (revisão 4: os que já
existiam e saíram do lançamento; voltam ao que eram sem ele, não são anulados),
substitui, total_value, abertura, pre_marco_zero, anexos (quantos passam ao substituto), anexos_nomes (revisão 4: os nomes dos arquivos), identificacoes (linhas de IDENTIFICACOES), ajustes (linhas de AJUSTES),
marcacao: {subtipo, acao, motivo_descarte} | null, parto: {nascidos_vivos, natimortos, pasto_destino_id, historico} | null,
transferencia: {pasto_origem_id, pasto_destino_id} | null, baixas, compra: {modalidade, base_peso, criterio,
valor_animais, frete, outros_custos, valor_total, conferencia, desvio_pct, peso_vivo_total, peso_carcaca_total, arrobas,
rendimento_pct, rendimento_tipo, preco_unitario, unidade_preco} | null, venda: {finalidade, modalidade, base_peso,
criterio, base_estimada, valor_bruto, desconto_comercial, receita, frete, comissao, outras_deducoes, deducoes, retidas,
resultado_negociacao, deposito_esperado, conferencia, desvio_pct, peso_vivo_total, peso_carcaca_total, rendimento_pct,
rendimento_tipo, arrobas, arroba_base (CARCACA | NEGOCIADA | ESTIMADA: todo R$/@ traz a base), preco_unitario, unidade_preco,
preco_medio_cabeca, preco_medio_kg, preco_medio_arroba (pela receita; 07, 4.2), equivalente_arroba: {rendimento_pct
(o padrão), arrobas, preco_arroba, base: 'ESTIMADA'} | null (sem arroba na negociação)} | null, financeiro: {lancamentos:
[{financial_id, descricao, conta_codigo, conta_nome, natureza, tipo, valor, partner_id, criterio, papel (ANIMAIS, FRETE,
OUTRO, CUSTO, RECEITA, DEDUCAO), tipo_deducao?, retida?, parcelas: [{parcela_num, data_vencimento, valor,
forma_pagamento}]}], total, a_pagar, a_receber, por_animal: [{animal_id, codigo_interno, brinco, valor (na venda: a
receita do animal), base?, deducoes?, liquido?}]} | null}`. Estorno e correção: os lançamentos do original deixam de valer pela vigência (FINANCEIRO `status` e
`status_pagamento` CANCELADO na fase C; parcelas não são regravadas, desenho-base 16.11); parcela LIQUIDADA do original
→ CONFLICT `PARCELA_LIQUIDADA` (o transporte da baixa chega com `parcela.baixar`, Fase 4); cancelar lançamento com
competência até `fin_bloqueio_ate` → aviso `PERIODO_BLOQUEADO` (um só por comando). Todo registro, correção e estorno confere
também, para cada animal já cadastrado que toca, as sequências de identificação e de marcação antes e depois (problema na
linha do comando → VALIDATION; o que quebra num evento gravado → CONFLICT com ele) e, no estorno e na correção, o que a
anulação DEVOLVE ao animal (seção 30): brinco hoje de outro animal (`BRINCO_DUPLICADO`; o animal que o próprio comando
anula libera o brinco), sexo ou nascimento que não cabem com os filhos (`REFERENCIA_GENEALOGICA`, RN-012), mãe ou pai que
voltam e não passam pela genealogia com os valores de depois (`REFERENCIA_GENEALOGICA`: progenitor anulado, mãe macho ou
pai fêmea, nascido depois do filho, ciclo — RN-008 a RN-010 —, CONFLICT com a correção que deixou o progenitor como está
ou que fecharia o ciclo) e categoria manual desativada (`CATEGORIA_INATIVA`) — CONFLICT com o
registro que impede. Códigos de aviso emitidos: POSSIVEL_DUPLICIDADE (a
matriz conta como animal do parto; mensagem com `EventCatalog.nomeEvento` — "Já existe a transferência de 01/04/2026 com
este animal" — e `conflito = {event_id, tipo (event_type), subtipo, data, nome}` do lançamento existente, que a folha
mostra como link), BRINCO_PARECIDO, IDADE_REPRODUTIVA, INTERVALO_PARTO_CURTO, LOTACAO_ACIMA_DA_CAPACIDADE
(RN-027: o pasto de destino passa da capacidade em cabeças ou em UA/ha no dia do evento; a UA é a das consultas —
`InventoryService.compor` com o peso vigente na data, incluindo o peso do próprio lançamento, sobre um `AnimalService.leitor`
com a fonte do motor — e a comparação, `PastureService.lotacao().acima_da_capacidade`; sem área ou sem peso não há UA/ha a
comparar; um aviso por pasto, com as duas contas quando as duas passam), VALOR_DIVERGENTE, RATEIO_SEM_PESO, CARENCIA_ATIVA, PERIODO_BLOQUEADO,
PESO_IMPLAUSIVEL (Fase 3, E3.1: só na PESAGEM), ESTOQUE_INSUFICIENTE e PRODUTO_VENCIDO (Fase 3, E3.2 e E3.3: na
SANIDADE e no ESTOQUE, e o primeiro também no estorno; seção 39); política por código em `avisos_politica`
(ausente = AVISA; CARENCIA_ATIVA só na venda para ABATE — também quando a aplicação retroativa ou corrigida cobre a data
de uma venda para abate já gravada; nas demais vendas, sempre AVISA).

SANIDADE e ESTOQUE (Fase 3, E3.2 e E3.3): o mesmo tratador de todo tipo (`planejarEvento_`) para registro, simulação,
retroativo, mesmo dia, correção (inclusive a do substituto), estorno e base de demonstração; o contrato do cabeçalho, do
item, do consumo, do estoque, dos avisos e da carência contra a venda está na seção 39. Duplicidade (`guardaDuplicidade_`):
a SANIDADE compara também o produto (ou o nome livre) do mesmo procedimento no mesmo dia. `obter` traz `detalhes.SANIDADE`
e `detalhes.MOVIMENTOS_ESTOQUE`; a resposta do registro, da correção e do estorno desses dois tipos — e só deles — leva
`produtos` (o cadastro público de cada produto cujo saldo o comando mudou, `HealthService.produtoPublico`); os `derivados`
levam `produtos` (a trava refaz e confere o saldo deles).

PESAGEM (Fase 3, E3.1; 07, seção 8.1; 03b, seção 5; RN-049 a RN-053). Um tratador só — o de todo tipo — para registro,
retroativo, mesmo dia, correção (inclusive a do substituto), estorno, importação e desfazer: o cabeçalho
(`cabecalhoPesagem_`) monta `{tipo, metodo, jejum, porLote, lote: {total_kg, cabecas, media_kg} | null}`; por lote, o
método é MEDIA_LOTE e cada animal fica com a média (1 casa; `QTD_DIVERGENTE` quando as cabeças diferem da lista, média
fora da faixa recusada, peso por animal no lote = `CAMPO_NAO_SE_APLICA`); na individual, o peso é obrigatório. Cada
animal gera a linha EVENTO_ANIMAIS com efeito 0 e o peso (um FATO: precisa estar dentro de uma permanência do animal no
rebanho, inclusive o dia da entrada e o da saída — `FORA_DA_PERMANENCIA` pela linha do tempo) e uma linha PESAGENS
`{weight_id, animal_id, event_id, data_pesagem = event_date, peso_kg, metodo, tipo, observacoes}`. O payload leva
`peso_total_lote_kg`, `qtd_cabecas_lote` e `jejum: true | null`. Avisos (`avisosDaPesagem_`, depois da duplicidade
genérica e da lotação): POSSIVEL_DUPLICIDADE quando o animal já tem pesagem vigente no mesmo dia em outro lançamento
("0457 já tem pesagem em 13/11/2026 (412,5 kg, da compra). Gravar mesmo assim?") e PESO_IMPLAUSIVEL quando o ganho
diário contra a pesagem anterior (ou, no retroativo, contra a seguinte) sai de `gmd_plausivel_min_kg_dia` a
`gmd_plausivel_max_kg_dia` ("0457: 45,0 kg em 13/11/2026 contra 441,0 kg em 03/09/2026 (71 dias) dá -5,58 kg por dia, fora
da faixa esperada (de -1,0 a 2,0 kg por dia). Confira a digitação."). O peso atual e a data da última pesagem são da
projeção (o projetor já os tirava de PESAGENS: a última de qualquer método, inclusive no animal que saiu). Estorno ou
correção da entrada que deixaria uma pesagem fora da permanência e desfazer da importação com pesagem do animal
importado → CONFLICT com a pesagem. Resposta: `impactos.pesagem` (`WeightService.resumoDoPlano`; null nos outros tipos) na simulação e
`pesagem` (`WeightService.resultadoDoEvento`, seção 38) no registro e na correção da PESAGEM — a chave só existe nessa
resposta, e a dos outros tipos não mudou.

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
| `listar(repo)` | Tela de configurações, sem lançar: `{itens: [{chave, grupo, tipo, formato, descricao, padrao, texto, valor, origem: PLANILHA\|PADRAO, erro, faixa}], desconhecidas: [chave], codigos_aviso: CODIGOS_AVISO (13), politicas: [BLOQUEIA, AVISA, IGNORA]}` (a tela de parâmetros monta a política por código com eles) |
| `normalizar(chave, bruto)` | `{texto (célula), valor (tipado)}` ou `{erro: {codigo, mensagem}}`: tipo, faixa (`FAIXAS`), datas, `faixas_etarias_meses` (inteiros crescentes), `avisos_politica` (códigos de `CODIGOS_AVISO` → BLOQUEIA/AVISA/IGNORA). Vazio só em chave sem padrão |
| `planejarParametro(tx, chave, valor, justificativa?)` | Para outro comando: normaliza e põe no plano (altera a linha ou cria a que falta). `CONFIGURACOES` nas `reads`. Inválido → `VALIDATION` |
| `aplicarPolitica(params, avisos, coletor)` | `avisos_politica`: BLOQUEIA vira erro no coletor; IGNORA some; devolve os que ficam (AVISA) |
| `cadastros(repo)` / `LEITURAS_CADASTROS` | Para `sistema.bootstrap`: `{configuracoes (= listar), listas, categorias (por prioridade), cobertura, parceiros, contas (PLANO_CONTAS por ordem)}` |
| `comandoSalvar` — `config.salvar` | `dados: {valores: {chave: valor}, justificativa?}` (várias chaves, uma operação). Códigos: `CHAVE_DESCONHECIDA`, `TIPO_INVALIDO`, `FORMATO_INVALIDO` (inclusive fuso IANA), `VALOR_FORA_DA_FAIXA`, `VALOR_FORA_DA_LISTA`, `CAMPO_OBRIGATORIO`, `NAO_ENCONTRADO`/`PROPRIEDADE_INATIVA` (propriedade padrão), `DATA_FUTURA` (marco zero), `FAIXA_INVALIDA` (GMD mín ≥ máx). Marco zero com entrada/saída vigente → `CONFLICT` `MARCO_ZERO_EM_USO` (RN-101). Mudar `idade_desmama_padrao_meses` ou `data_marco_zero` reconstrói todas as projeções na fase C. Resposta `{chaves, itens}` |
| `comandoSalvarLista` / `salvarLista(ctx, pedido)` — `lista.salvar` | `dados: {lista_id?, lista, codigo?, rotulo, ordem?, ativo?, justificativa?}`. Código MAIÚSCULAS ASCII (derivado do rótulo se vazio), único na lista; ordem padrão = última + 10. Edição só de rótulo, ordem, ativo. Códigos: `CODIGO_REPETIDO`, `CAMPO_IMUTAVEL`, `CODIGO_RESERVADO`, `FORMATO_INVALIDO`. Resposta: o item |
| `comandoSalvarCategoria` / `salvarCategoria(ctx, pedido)` — `categoria.salvar` | `dados: {categorias: [{category_id?, campos}]}` ou `{category_id?, campos}`. Aviso `CATEGORIAS_SEM_COBERTURA` (lacunas na mensagem; política por código). Erros: `CAMPO_IMUTAVEL` (código), `CODIGO_REPETIDO`, `FAIXA_INVALIDA` (máxima ≤ mínima, ou máxima < 1 mês: ela é exclusiva), `VALOR_FORA_DA_FAIXA` (prioridade < 0), `CONDICAO_INCOMPATIVEL`, `PRIORIDADE_REPETIDA` (entre ativas), `CATEGORIA_EM_USO` (reclassificação manual vigente), `CAMPO_OBRIGATORIO`, `CAMPO_DESCONHECIDO`. Resposta `{categorias, cobertura}` |
| `comandoSalvarParceiro` / `salvarParceiro(ctx, pedido)` — `parceiro.salvar` | `dados: {partner_id?, campos: {nome, tipos (lista ou "A,B": FORNECEDOR, COMPRADOR, VETERINARIO, TRANSPORTADOR, ARRENDADOR, OUTRO), documento, telefone, endereco, observacoes, ativo}}` (03a, 4.8). Documento repetido → aviso `POSSIVEL_DUPLICIDADE`. Inativo sai dos seletores e é recusado como contraparte nova de evento (`PARCEIRO_INATIVO`); o tipo só filtra a tela. Resposta: o parceiro |

### 15.2 `AnimalService` (lista, ficha, edição, externo; idade, categoria e peso na leitura)

| Membro | Contrato |
|---|---|
| `leituras()`, `leitor(tx, {fonte?, parametros?})` | Abas do leitor e o leitor da consulta: `L = {tx, repo, f (Timeline.fonte, ou a `fonte` dada: o motor passa a sua, com a correção excluída e as linhas do lançamento), params, marcoZero, hoje, categorias, categoriaPorId, animais (vigentes), filhosMae, filhosPai, memo}` (`memo`: a categoria de cada animal em cada data, durante a leitura). A consulta que usa o leitor declara `acessoCru: true` (seção 13, `fonte`): todas as desta seção e das seções 15.3 e 15.4 declaram |
| `idadeEm(a, data)` | Meses completos; `null` sem nascimento ou antes dele |
| `perfilEm(L, a, data)` / `categoriaEm(L, a, data)` | Perfil em D (castração posterior não conta; parida = partos prévios, PARTO até D ou cria nascida até D; reclassificação vigente em D) → `EventService.classificarCategoria` → `{category_id, codigo, nome, manual}` ou `null` |
| `pesoVigente(L, a, data, categoria)` | `{kg, situacao: PESADO\|PESAGEM_VENCIDA\|SEM_PESAGEM\|SEM_PESO, estimado, data_pesagem, metodo, referencia_kg}` (desenho-base, seção 6) |
| `linhaLeve(L, a)`, `COLUNAS_LEVE` | Linha do store. Idade/categoria na data de referência (hoje; baixado: data da saída); `categoria_id` null no EXTERNO; `peso_vencido` só em ATIVO; `carencia_ate` (Fase 3, E3.3: `HealthService.carenciaHoje`, o último dia de carência do animal ATIVO hoje, ou null) |
| `consultaCargaInicial()` / `cargaInicial(ctx)` | ATIVOS + EXTERNOS em colunas: `{data, n, colunas, valores: {coluna: [..]}}` (ordem de `codigo_interno`) |
| `consultaListar({situacoes?})` — `animal.listar` | Mesmo formato; padrão = baixados (VENDIDO, MORTO, DESCARTADO, BAIXADO_AJUSTE, HISTORICO); PENDENTE/ANULADO → `VALIDATION` |
| `consultaFicha({animal_id, geracoes?})` — `animal.ficha` | `{animal_id, data, geral (A; `identificacoes: [{tipo, codigo, data_inicio, data_fim, motivo, remocao, event_id}]`, na ordem das identificações por tipo, com a linha da retirada marcada `remocao`), genealogia (B), localizacao (C), pastos (D: `periodos` [início, fim) com dias, evento de `entrada` e de `saida` — entrada, transferência, correção de localização, saída —, e `por_pasto: [{pasture_id, pasto_nome, dias, periodos, atual}]`), peso (E), sanitario (F), reprodutivo (G), financeiro (H), eventos (I: linha do tempo com status, vigente, anulado_por, ajustes; no parto aparece também na mãe, papel MATRIZ), anexos (J: ANEXOS ativos do animal)}`; todo bloco traz `entregue`; E (peso) é `WeightService.blocoFicha` desde a E3.1 (seção 38; no EXTERNO, `{entregue: true, externo: true, serie: [], intervalos: []}`) e F (sanitário) é `HealthService.blocoFicha` desde a E3.3 (seção 39; no EXTERNO, `{entregue: true, itens: [], carencia: null, proximas: [], custo_total: null}`); G é `ReproductionService.blocoFicha` (seção 24: parte de partos, `parcial: true`); H é `FinancialService.blocoFicha` (seção 26) com `parcial: true` e `pendente: {modulo: 'FINANCEIRO', fase: 4, mensagem}`. Genealogia: `{sem_genealogia, mae, pai, arvore (nós {..., confianca, confirmado, geracao, disponivel, tem_ancestrais, mae, pai}), filhos [{..., papel MAE\|PAI, confianca}]}`; `geracoes` 1–6 (padrão 3). `NOT_FOUND`; `VALIDATION` |
| `comandoEditar` — `animal.editar` | Um formulário só. `dados: {animal_id, campos, justificativa?, justificativa_aviso?}`; só o que muda é gravado. `nome, raca, observacoes, foto_anexo_id` → AUDITORIA; campos de `EventCatalog.CAMPOS_CORRIGIVEIS` → evento AJUSTE_INVENTARIO/CORRECAO_CADASTRO datado de hoje, com todas as regras do motor (justificativa obrigatória: `CAMPO_OBRIGATORIO`), NA MESMA operação da auditoria. EXTERNO: sexo e nascimento por AUDITORIA (`AuditService.alteracao(..., {externo: true})`), demais sensíveis `CAMPO_NAO_SE_APLICA`. `brinco`, pasto, situação, colunas calculadas → `CAMPO_NAO_EDITAVEL` (mensagem com o caminho certo); `ANEXO_INVALIDO`; `CAMPO_DESCONHECIDO`. Resposta `{animal_id, event_id, correcoes, cadastro, animal (linha leve)}`; nada muda → `semAlteracao` |
| `comandoCadastrarExterno` — `animal.cadastrarExterno` | `dados: {campos: {nome*, sexo*, raca, data_nascimento, data_nascimento_confianca, observacoes}}`; nome repetido entre externos → aviso `POSSIVEL_DUPLICIDADE`; linha de ANIMAIS nasce na fase C (AUDITORIA CRIAR), situação EXTERNO. Resposta `{animal_id, animal}` |

### 15.3 `PastureService` (propriedades, pastos, painel)

| Membro | Contrato |
|---|---|
| `comandoSalvarPropriedade` / `salvarPropriedade(ctx, pedido)` — `propriedade.salvar` | `dados: {property_id?, campos: {nome, descricao, localizacao, area_total_ha, status}}`. `NOME_REPETIDO`; INATIVO → `PROPRIEDADE_COM_PASTOS` / `PROPRIEDADE_PADRAO`. A primeira vira `propriedade_padrao_id` se ele estiver vazio. Resposta: a propriedade |
| `comandoSalvarPasto` — `pasto.salvar` | `dados: {pasture_id?, campos: {property_id (criação), nome, identificacao, area_hectares, tipo_capim, capacidade_estimada_ua_ha, capacidade_estimada_cabecas, posse (PROPRIO), arrendador_id, observacoes, status}}`. `ARRENDADOR_SEM_ARRENDAMENTO`, `NAO_ENCONTRADO`, `PROPRIEDADE_INATIVA` (na criação e, revisão final, na reativação: pasto não volta a ativo dentro de propriedade desativada), `NOME_REPETIDO` (ativos da propriedade), `CAMPO_IMUTAVEL` (propriedade), `PASTO_COM_ANIMAIS`. Resposta: o pasto |
| `consultaPainel({pasture_id, data?, periodo_inicio?, periodo_fim?})` — `pasto.painel` | Cabeçalho do pasto + `{data, motivo, cabecas, machos, femeas, por_categoria, sem_categoria, peso_vivo_total, peso_medio, ua: {valor, motivo, n, estimado, ua_peso_kg, partes: {pesada, pesagem_vencida, sem_pesagem: {cabecas, peso_kg, ua}}, sem_peso, rotulo}, ua_ha, capacidade, ocupacao_pct: {valor, motivo, n, base: UA_HA\|CABECAS, estimado}, acima_da_capacidade: {ua_ha, cabecas}, animais (com `no_pasto_desde`, `no_rebanho_desde`, categoria, idade e peso vigente em D), permanencia?, parametros}`. Data = fim do dia D (≥ marco zero; antes → nulos com `ANTERIOR_AO_MARCO_ZERO`); futura → `VALIDATION`; `NOT_FOUND`. Com os dois `periodo_*` (fim ≤ hoje): `permanencia = {inicio, fim, inicio_efetivo, parcial, motivo, base_total, n, itens: [{animal_id, codigo_interno, brinco, sexo, dias, intervalos: [{inicio, fim, dias}]}]}` por `Timeline.diasPermanencia` (escopo PASTO), em ordem de dias; período incompleto (`CAMPO_OBRIGATORIO`), invertido (`FAIXA_INVALIDA`), futuro (`DATA_FUTURA`) → `VALIDATION` |
| `consultaListar({property_id?, incluir_inativos?, data?})` — `pasto.listar` | Cartões (o painel sem `animais`), por nome, na posição ao fim do dia `data` (padrão hoje; a mesma regra do painel: antes do marco zero, os nulos com `ANTERIOR_AO_MARCO_ZERO`; data futura `DATA_FUTURA`, inválida `FORMATO_INVALIDO` → `VALIDATION`). Sem `incluir_inativos`, entra também o pasto desativado que tinha animal em `data` (02, política `escrita`; seção 46): as cabeças da data fecham com o rebanho dela |
| `lotacao(pasto, composicao)` | Pura: UA/ha (`SEM_VALOR_DE_REFERENCIA` sem área), ocupação por UA/ha ou por cabeças; sem capacidade → `null`; `acima_da_capacidade: {ua_ha, cabecas}` (UA/ha na precisão da capacidade, 4 casas; cabeças exatas; true/false, null sem como comparar) — a regra do aviso de lotação |

### 15.4 `InventoryService` (posição, visão geral, alertas)

| Membro | Contrato |
|---|---|
| `presentes(L, data)` | `{motivo, itens: [{animal, pasture_id, property_id, no_rebanho_desde, no_pasto_desde}]}` pelo replay até o fim de D (`Timeline.presentesEm`; a propriedade é a do pasto, ou a do evento de entrada sem pasto); sem marco zero `DADOS_INSUFICIENTES`, antes dele `ANTERIOR_AO_MARCO_ZERO` (itens `null`) |
| `presentesNoDia(L, data)` | A mesma forma: no rebanho em algum momento de D (entrada e saída do dia contam), com o pasto de antes das saídas do dia (`Timeline.pastoAntesDaSaida`): quem pode receber um fato datado de D |
| `compor(L, itens, data, {animais}?)` | `{cabecas, machos, femeas, por_categoria (por prioridade), sem_categoria, peso_vivo_total, peso_medio: {valor, motivo, n, estimado, pct_estimado, unidade}, ua, animais?}`; peso vigente em D = o último peso conhecido até D (entrada, compra, nascimento, venda; as pesagens da Fase 3 pela mesma regra) dentro de `peso_validade_dias`, vencido ou ausente o de referência da categoria (estimado); sem peso → fora da UA e do peso médio, contado (`sem_peso`); grupo vazio: peso e UA zero, peso médio null |
| `posicao(L, data, filtros?)` | `{data, marco_zero, motivo, filtros, etiquetas, cabecas, por_sexo: {M, F}, por_pasto: [{pasture_id, nome, cabecas}], sem_pasto, por_categoria, sem_categoria, peso_vivo_total, ua, peso_medio, por_situacao}`. Filtros `{property_id, pasture_id, sexo, category_id}` (07, seção 9: pasto e categoria do animal em D) valem para cabeças, peso e UA; por sexo ignora o de sexo, por pasto o de pasto, por categoria o de categoria (tratamento E, com `etiquetas.por_sexo` "todos os sexos", `por_pasto` "todos os pastos", `por_categoria` "todas as categorias"); `por_situacao` (`Timeline.inventario`) é do rebanho inteiro (`etiquetas.por_situacao` com filtro). Antes do marco zero: tudo null com o motivo |
| `consultaPosicao({data?, property_id?, pasture_id?, sexo?, category_id?, animal_id?})` — `inventario.posicao` | `posicao` na data; com `animal_id` (filtros ignorados): `{data, animal_id, presente, pasture_id, situacao, no_rebanho_desde, no_pasto_desde, entrada, saida, sexo, idade_meses, categoria: {category_id, codigo, nome, manual}, peso (pesoVigente), motivo}` — categoria, idade e peso só se presente em D. Futura/inválida, sexo fora de M/F → `VALIDATION`; animal, pasto, propriedade ou categoria inexistente → `NOT_FOUND` |
| `consultaVisaoGeral({data_inicio?, data_fim?, property_id?, pasture_id?, sexo?, category_id?})` — `dashboard.obter` | 07, seção 9, no recorte da Fase 2 (itens 1 a 10, 12, 15 e 16; G1, G6 e G7). Período: Df padrão hoje; Di padrão o primeiro dia do mês 11 meses antes do de Df (os últimos 12 meses); `periodo: {inicio, fim, inicio_efetivo, parcial, motivo}` (Df antes do marco zero → `ANTERIOR_AO_MARCO_ZERO` em tudo; começa antes → fluxos dele em diante, `parcial`). Devolve `posicao(Df, filtros)` + `geradoEm`, `periodo`, `pendencias: {sem_pasto, sem_brinco, sem_categoria}`, `titulos` (de hoje, sem filtros: `etiquetas.titulos`), `movimento: {nascimentos, compras, vendas, mortes, descartes, baixas_contagem: {cabecas, eventos, valor? (compras: valor dos animais; vendas: receita — o que coube a cada animal no lançamento principal, COMPRA_ANIMAIS ou VENDA_ANIMAIS, pelas alocações do rateio vigente; nunca `valor_individual`, que é só base de rateio: desenho-base §7), motivo}}` (linhas vigentes de D0 em diante; filtros pelo animal no dia do evento: destino na entrada, origem na saída), `receita_vendas: {valor, motivo, n, nao_atribuida, base: LANCAMENTOS\|ALOCACOES}` (Σ RECEITA_VENDA_ANIMAIS por competência; Pr pelo lançamento; com Pa, S ou C só a parte alocada a animais do filtro — tratamento A; lançamento com `pasture_id` conta inteiro para o seu pasto), `series: {rebanho: [{mes, data, cabecas, motivo}], nascimentos_mortes: [{mes, inicio, fim, parcial, nascimentos, mortes, motivo}], compras_vendas: [{mes, inicio, fim, parcial, compras, valor_compras, vendas, valor_vendas, motivo}]}` (mês todo antes do marco zero: null com o motivo). Nos fluxos, zero é informação. Erros: `VALIDATION` (`FORMATO_INVALIDO`, `DATA_FUTURA` em `data_fim`, `FAIXA_INVALIDA`, sexo), `NOT_FOUND` (filtro inexistente) |
| `consultaElegiveis({tipo, subtipo?, data?, pasture_id?})` — `inventario.elegiveis` | Animais elegíveis a um tipo ativo cujo `filtro_elegiveis.situacao` é ATIVO (transferência, nascimento, venda, morte, descarte, identificação, marcação), pela linha do tempo na data: movimento e saída (transferência, venda, morte, descarte; `MOVIMENTO_OU_SAIDA`) = no rebanho ao fim de D; fato (parto, identificação, marcação e os das fases seguintes) = no rebanho em algum momento de D, o dia da saída contando como na validação (RN-017: a vaca que morre no parto é elegível ao parto desse dia), no pasto em que estava antes das saídas do dia (`presentesNoDia`); no pasto pedido, com o `sexo` do filtro. `{data, tipo, pasture_id, motivo, n, itens: [{animal_id, codigo_interno, brinco (o em uso NA data: o do retrato em D, `AnimalService.retratoEm`, pela regra de `Timeline.brincoEm`; seções 44 e 46), brinco_hoje (o da projeção de hoje), sexo, pasture_id}]}`; antes do marco zero (ou sem ele) `n`/`itens` null com o motivo. `VALIDATION` (`TIPO_SEM_ELEGIVEIS`, data inválida ou futura), `NOT_FOUND` (pasto) |
| `posicaoEm(ctx, dados)`, `elegiveis(ctx, dados)`, `visaoGeral(ctx, dados)`, `listarAlertas(ctx, estado)` | As formas `x(ctx, dados)` (= `UnitOfWork.read`) de `consultaPosicao`, `consultaElegiveis`, `consultaVisaoGeral` e `consultaAlertas` |
| `consultaAlertas(estado)` — `alerta.listar` | `estado = {backup: {ultimo_em: ISO\|null}, integridade: {verificado_em, erros}\|null}` vem de quem chama (Maintenance/Api; fora da planilha). Devolve `{data, geradoEm, alertas: [{codigo, nivel AVISO\|ERRO, mensagem, n, ids, entidade}], nao_avaliados: [{codigo, motivo, mensagem}]}`; códigos `ALERTAS`: ATIVO_SEM_PASTO, SEM_BRINCO, SEM_CATEGORIA, NAO_LOCALIZADO (ATIVO com `nao_localizado`, marcado por MARCACAO/NAO_LOCALIZADO; some com a baixa na contagem ou a desmarcação), BACKUP_ATRASADO (`alerta_backup_atrasado_dias`; nenhum backup = alerta), INTEGRIDADE_COM_ERRO, IMPORTACAO_INCOMPLETA (IMPORTACOES `IMPORTANDO`). Parte do `estado` ausente vai para `nao_avaliados` |

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
EVENTOS, FINANCEIRO, IMPORTACOES: tudo o que um comando de anexo pode ler (`ENTIDADES_ANEXO`, na mesma ordem sem ANEXOS);
cada comando declara só o necessário (`anexo.adicionar`: ANEXOS, EVENTOS e a aba do dono; `anexo.remover`: ANEXOS, ANIMAIS
e EVENTOS). `MIME_ANEXO` = `image/jpeg`, `image/png`,
`image/webp`, `image/gif`, `application/pdf` (animal, evento e lançamento; a importação aceita qualquer tipo). Anexo de
evento (EVENTOS) e de lançamento financeiro (FINANCEIRO) leva o `event_id` do evento (no lançamento, o evento que o
criou): é linha filha (vale enquanto o evento vale) e, com o evento estornado ou corrigido, continua **consultável** como
histórico (seção 32).

| Função | Contrato |
|---|---|
| `adicionarAnexo(ctx, {idempotencyKey, dados: {entidade (ANIMAIS\|EVENTOS\|FINANCEIRO\|IMPORTACOES), entity_id, tipo, descricao, nome_arquivo, mime_type, conteudo_base64, miniatura_base64, temporario, definir_como_foto}})` | `{dados: anexo, duplicado, opId, dataVersion}` (comando com acesso cru). Envio malformado → `VALIDATION` antes de subir (`VALOR_FORA_DA_LISTA`, `CAMPO_OBRIGATORIO`, `FORMATO_INVALIDO`; tipo fora de `MIME_ANEXO` ou FOTO que não é imagem → `TIPO_ARQUIVO_INVALIDO`; acima de 5 MB); dono inexistente, de gravação que falhou ou animal anulado → `NOT_FOUND`; evento ou lançamento que já não vale → `VALIDATION` `JA_ANULADO`; evento ESTORNO → `ESTORNO_SEM_ANEXO` (nos três, o arquivo já subido vai para a lixeira); reenvio de chave confirmada não sobe de novo. `definir_como_foto` (só FOTO de animal) grava `ANIMAIS.foto_anexo_id` (auditado) |
| `promover(tx, [anexo_id]) → n` | Dentro do tratador do comando dono (ANEXOS nas `reads`): TEMPORARIO → ATIVO. Inexistente ou REMOVIDO → `VALIDATION` |
| `removerAnexo(ctx, {idempotencyKey, dados: {anexo_id, justificativa}})` | REMOVIDO (a linha fica; a justificativa vai na AUDITORIA); tira a foto da ficha se era ela; arquivo e miniatura vão para a lixeira depois do commit, **salvo** se outra linha consultável ainda usa o mesmo arquivo (o histórico de um evento corrigido). Inexistente ou inerte → `NOT_FOUND`; já removido → `VALIDATION` `JA_REMOVIDO` (só ele); de evento estornado ou corrigido → `JA_ANULADO` (é histórico); sem justificativa → `CAMPO_OBRIGATORIO` |
| `obterAnexo(ctx, {anexo_id, miniatura})` | `{dados: {anexo (com `vigente`), miniatura, data_url}, dataVersion}`; o de evento estornado ou corrigido também (`vigente = false`); removido, inexistente ou inerte (gravação que não confirmou) → `NOT_FOUND` |
| `anexoPublico(linha, vigente?)` | `{anexo_id, entidade, entity_id, event_id, financial_id (= entity_id na entidade FINANCEIRO), nome_arquivo, mime_type, tamanho_bytes, tipo, descricao, status, tem_miniatura, vigente, created_by, created_at}`; sem `vigente`, vale o status (não REMOVIDO) |
| `consultavel(cru, linha) → booleano` | A linha existe, não foi removida e, com `event_id`, o evento teve a operação confirmada (CONFIRMADO, ESTORNADO, CANCELADO); a inerte de gravação que falhou não é |
| `anexosDoEvento(cru, event_id) → [anexoPublico]` | Para `evento.obter`: os ATIVOS consultáveis com o `event_id` (do evento e dos lançamentos dele), por `created_at`; `vigente` = o evento vale |
| `anexosDoSubstituto(tx, original_id, {event_id, lancamentos: {financial_id original: financial_id substituto}}) → [linhas de ANEXOS]` | Dentro da correção: uma linha nova por anexo ATIVO do original, filha do substituto (fase A), mesmo `drive_file_id`/miniatura, `created_by`/`created_at` do envio; lançamento sem correspondente → o anexo vai para o evento |

## 17. `Maintenance` (plataforma: setup, backup, restauração, rotinas agendadas)

Script Properties: `SPREADSHEET_ID`, `TEST_SPREADSHEET_ID`, `DEMO_SPREADSHEET_ID` (bancos por ambiente: `AMBIENTES =
{PRODUCAO, TESTE, DEMO}`), `OWNER_EMAIL`, `DRIVE_FOLDERS`, `IO_PRIMITIVE` (forma de gravação da produção),
`IO_PRIMITIVE:<id>` (a de um banco de teste ou de demonstração; nunca mexe na de produção), `IO_PRIMITIVE_RELATORIO`
(resumo do corpus da produção), `DATA_VERSION:<id>`, `PENDING_OP:<id>`, `INTEGRIDADE:<id>` (resumo da última verificação
completa `{gerado_em, ok, erros, alertas}`, gravado pelo próprio `AuditService.verificarIntegridade`: semanal, sob
demanda, fim do setup, restauração e confirmação do reparo). Backup = arquivo na pasta Backups com appProperties
`erp_tipo = BACKUP`, `erp_banco`, `erp_ambiente` (PRODUCAO, TESTE ou DEMO: a "linhagem" do banco, que sobrevive à
troca de ID na restauração), `erp_data` (yyyy-MM-dd no fuso), `erp_motivo`, `erp_instante`. A guarda
`assertOwner_` das funções públicas é do Code.js; os handlers dos gatilhos montam o contexto com `contexto()`.

| Função | Contrato |
|---|---|
| `contexto({banco, ambiente, usuario, fuso, props}?)` | Contexto com portas reais: banco do `ambiente` (padrão PRODUCAO = `SPREADSHEET_ID`; TESTE/DEMO = `TEST_`/`DEMO_SPREADSHEET_ID`) ou `banco`; forma de gravação por `primitivaDoBanco`; `FileService.porta()`, `Timeline.porta()`; `props` = retrato já lido. Sem banco → `CONFIG` (para TESTE/DEMO, com a instrução de rodar `runAcceptanceTests`); ambiente desconhecido → `VALIDATION` |
| `chaveDoAmbiente(ambiente)`, `primitivaDoBanco(props, banco)` | Chave de Script Properties do banco do ambiente; forma de gravação: `IO_PRIMITIVE:<banco>` → `IO_PRIMITIVE` → `Database.PRIMITIVAS[0]` |
| `setup({usuario, fuso, tabelas, ambiente})` | `ambiente` TESTE/DEMO: o banco nasce na pasta Testes ("ERP Pecuário — BASE DE TESTE", `erp_ambiente`), vai para `TEST_`/`DEMO_SPREADSHEET_ID` e a forma de gravação para `IO_PRIMITIVE:<banco>`; `IO_PRIMITIVE` e `IO_PRIMITIVE_RELATORIO` de produção não mudam. 06, seção 4, idempotente: dono (`OWNER_EMAIL` na primeira vez; outro → `DENIED`) → lock (`LOCKED`) → pastas e sonda do Drive (`CONFIG` com a contingência) → backup cru do banco existente (SETUP; banco registrado sumido → `CONFIG`, nunca cria outro) → corpus numa planilha temporária na pasta Testes, que vai para a lixeira (nenhuma passa → `CONFIG`, banco intocado) → banco pelo Drive → abas na dimensão exata (a aba padrão vazia do banco novo sai) → colunas ao final → sementes por chave natural num comando (`anexaSemPai`, AUDITORIA `MANUTENCAO`) → fuso de `CONFIGURACOES.fuso` e locale `pt_BR` → SCHEMA_META (colunas do sistema na ordem real; `versao` sobe quando cresce) → contadores → gatilhos → proteção "somente aviso" → integridade. `tabelas` = definições que substituem as do Schema (migração; teste do esquema da fase seguinte). Devolve `{banco, banco_criado, pastas, drive, backup, primitiva: {primitiva, resultados: [{primitiva, ok, divergencias, erro}]}, abas: {criadas, colunas_acrescentadas, removidas}, sementes: {CONFIGURACOES, LISTAS, PLANO_CONTAS, CATEGORIAS}, fuso, schema_meta: {criadas, atualizadas}, contadores: {proximo_event_seq, proximo_codigo_interno}, gatilhos, protecoes, integridade}` |
| `backup(ctx, {motivo})` | `MOTIVOS_BACKUP`: DIARIO, SOB_DEMANDA (padrão), SETUP, IMPORTACAO, RESTAURACAO. `UnitOfWork.exclusivo` (lock, recuperação, flush) e cópia pelo Drive; o DIARIO aplica a retenção. `{backup: {id, nome, data, instante, motivo}, retencao}`. Falha da cópia → `CONFIG` com instrução |
| `listarBackups(ctx, {todos}?)` | Deste banco e dos anteriores do mesmo ambiente (os de antes de uma restauração; união por `erp_banco` e `erp_ambiente`), ou de todos, do mais novo: `[{id, nome, data, instante, motivo, banco, ambiente}]`. A retenção, o `estado` (lista para restaurar, `ultimo_backup`) e o alerta BACKUP_ATRASADO usam esta lista |
| `aplicarRetencao(ctx) → {mantidos, removidos: [nome]}` | Os `backup_retencao_diarios` DIARIO mais recentes; dos mais antigos, o último de cada mês nos `backup_retencao_mensais` meses mais recentes; os demais motivos ficam o mesmo número de dias; o resto vai para a lixeira |
| `restaurar(ctx, {dados: {backup_id, justificativa}})` | `justificativa` obrigatória (`VALIDATION` `CAMPO_OBRIGATORIO`, como na tela); backup de outro ambiente (base de teste no lugar da real e vice-versa) → `VALIDATION` `BACKUP_DE_OUTRA_BASE`. 06, seção 10: cópia do backup pelo Drive (pasta raiz, `erp_tipo = BANCO`); `DATA_VERSION` do novo = maior das duas + 1; marcador do novo ANTES de trocar a propriedade do banco em uso (`SPREADSHEET_ID`, ou `TEST_`/`DEMO_` quando é a do contexto; a `IO_PRIMITIVE:<id>` do banco de teste passa para o novo); `recoverAll`; AUDITORIA `MANUTENCAO` no novo; integridade. O anterior fica no Drive. `{banco_anterior, banco, backup, recuperacao, dataVersion, integridade}`. Erros: `NOT_FOUND` (não é backup), `LOCKED`, `CONFIG` |
| `limparExportacoes(ctx) → {removidas}` | Exportações com mais de `EXPORTACAO_VALIDADE_DIAS` (7) |
| `limparAnexos(ctx) → {temporarios, orfaos, arquivos_removidos}` | TEMPORARIO com mais de 24 h → REMOVIDO (comando auditado) e lixeira; arquivo deste banco na pasta Anexos sem linha em ANEXOS e com mais de 24 h → lixeira; arquivo de anexo REMOVIDO (ou só de linha inerte, de gravação que não confirmou) ainda fora da lixeira → lixeira, salvo se uma linha consultável o usa (`FileService.consultavel`) |
| `manutencaoDiaria(ctx)` | Corpo de `trgManutencaoDiaria`: backup DIARIO com retenção → exportações → anexos. Etapa que falha não impede as seguintes; vai para ERROS_LOG (`MANUTENCAO_<ETAPA>`) e no fim lança `INTERNAL` com `erro.relatorio`. Sem falha: `{backup, retencao, exportacoes, anexos, falhas: []}` |
| `integridadeSemanal(ctx)` | Corpo de `trgIntegridadeSemanal`: o relatório; resumo em `INTEGRIDADE:<banco>`; com erro, ERROS_LOG `INTEGRIDADE_COM_ERRO` |
| `listarGatilhos() → [{funcao, id}]` | Gatilhos do projeto que são deste sistema (diagnóstico SP-09, aceitação CT-11) |
| `garantirGatilhos(fuso) → {criados, removidos, total}` | Por nome da função: `trgManutencaoDiaria` diário às 3 h e `trgIntegridadeSemanal` aos domingos às 5 h, no fuso; cria o que falta, apaga duplicata |
| `estado(ctx)` | Tela de sistema: `{banco, primitiva, data_version, backups, ultimo_backup, integridade, gatilhos, alertas_estado}`; `alertas_estado` = `{backup: {ultimo_em}, integridade: {verificado_em, erros} \| null}`, o parâmetro de `InventoryService.consultaAlertas` |

## 18. `ImportService` (puro: importação de ANIMAIS e de eventos históricos)

Rotas `importacao.*` (com `permiteDuranteImportacao`, salvo `criar`); enquanto uma importação está IMPORTANDO, a
UnitOfWork recusa os demais comandos de negócio (`CONFLICT`). Uma importação em curso por vez (RN-032; desenho-base 16.8:
a exceção das rotas `importacao.*` vale para retomar, concluir e desfazer a que está em curso): o bloco 1 (VALIDADO →
IMPORTANDO) de outra é recusado com `CONFLICT` e detalhe `IMPORTACAO_EM_CURSO` (o nome do arquivo em curso); concluída
ou desfeita a primeira, a confirmação da segunda revalida e pede "valide de novo" se o resultado mudou. Cada lote é UMA operação de chave
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
rebanho; sem brinco, o progenitor do rebanho é achado pelo código interno `A-000123` ou pelo nome de um animal de
referência EXTERNO — RN-094: cadastrar o touro de sêmen e validar de novo; nome repetido entre externos reprova a linha
pedindo o código; `pasto` = nome ou identificação; raça por código ou rótulo de LISTAS). Obrigatório mapear `sexo` e `pasto` (ou
o padrão) e dar a confiança de nascimento, chegada, mãe e pai quando mapeados sem coluna de confiança. `formato`:
`{delimitador (',' ';' TAB '|'), codificacao, formato_data (dd/MM/yyyy, yyyy-MM-dd, MM/dd/yyyy, dd-MM-yyyy, dd.MM.yyyy;
ISO sempre aceito), decimal (',' ou '.')}`.

| Função | Contrato |
|---|---|
| `criar(ctx, {idempotencyKey, avisosAceitos, dados: {tipo: 'ANIMAIS', arquivo_nome, conteudo_base64 \| texto, formato}})` | Lê o arquivo (`VALIDATION`: vazio, só cabeçalho, coluna repetida, aspas abertas, mais de 20.000 linhas, formato), guarda o original no Drive e em ANEXOS (DOCUMENTO, ATIVO) e cria IMPORTACOES RASCUNHO com `arquivo_hash` (SHA-256 do texto). Mesmo arquivo já enviado → aviso `POSSIVEL_DUPLICIDADE`. Outro tipo → `VALIDATION` `TIPO_INDISPONIVEL`. `{dados: {import_id, status, cabecalho, amostra, total_linhas, sugestao}}` |
| `previaArquivo(ctx, {import_id})` | O mesmo, relido do Drive (retomar o assistente), + `mapeamento` gravado |
| `validarBloco(ctx, {idempotencyKey, dados: {import_id, bloco, mapeamento}})` | Relê e valida o arquivo INTEIRO (duplicidade no arquivo e na base, mãe e pai em duas passadas, ciclos, confiança, regras do catálogo e do marco zero) e grava só as linhas do bloco (anexa ou atualiza por `linha_num`). O bloco 1 recomeça e grava o mapeamento; os seguintes exigem o mesmo mapeamento e o anterior validado (`CONFLICT`). Linha: VALIDA, ERRO ou DUPLICADA com `erros_json` `[{codigo, campo, mensagem}]`. Última linha → VALIDADO. Sem marco zero → `CONFIG`. Devolve o estado (`obter`) |
| `importarBloco(ctx, {avisosAceitos, dados: {import_id, bloco, modo, aprovacao: {importar, ignorar}, ignorar_linhas, property_id, justificativa_aviso}})` | Bloco 1 = confirmação: revalida (resultado diferente do gravado → `CONFLICT` "valide de novo"); `TOTAL` só sem linha reprovada (`IMPORTACAO_TOTAL_RECUSADA`); `PARCIAL_APROVADO` exige `aprovacao` igual aos números de agora (`APROVACAO_DIVERGENTE`) e fica em AUDITORIA (justificativa com quem aprovou); `ignorar_linhas` → IGNORADA (não pode ser progenitor de linha que entra: `PROGENITOR_IGNORADO`). Ordem de importação: progenitor do arquivo antes do filho, depois a linha. Blocos em ordem (`CONFLICT`); bloco já gravado por outra chave → sem alteração. Linhas → IMPORTADA com `entity_id_gerado`/`event_id_gerado`. Avisos do motor (ex.: `IDADE_REPRODUTIVA`) → `NEEDS_CONFIRMATION` |
| `concluir(ctx, {dados: {import_id}})` | Exige todos os lotes (`CONFLICT`); backup IMPORTACAO ANTES; IMPORTADO (commit do arquivo inteiro), `finished_at`, reconstrução total das projeções. Devolve o relatório final. A recusa da trava na conclusão (o estado mudou depois da validação) diz que a importação continua em curso, bloqueando os outros lançamentos, e que só o desfazer resolve |
| `desfazer(ctx, {dados: {import_id, justificativa, justificativa_aviso?}, avisosAceitos})` | Qualquer estado menos CANCELADO → CANCELADO (nada se apaga; reconstrução total se havia eventos). IMPORTADO com lançamento, filho ou anexo posterior sobre os animais → `CONFLICT` com os detalhes (`conflito`; mensagem com o lançamento em palavras: "tem um lançamento posterior à importação: a correção de localização de 10/11/2026"). Cancelar lançamento que valia dentro do período financeiro fechado pede o aviso `PERIODO_BLOQUEADO` com `justificativa_aviso` (aviso da trava, seção 10.5, item 6; a tela mostra o "Vi e confirmo" e o campo da justificativa no próprio quadro do desfazer) |
| `consultaObter({import_id})` / `obter(ctx, dados)` | `{importacao, contadores: {total, conferidas, validas, erro, duplicadas, ignoradas, importadas, por_codigo}, blocos: {tamanho, total, importados, proximo}, validacao: {conferidas, completa}, pode: {validar, importar, concluir, desfazer}}` |
| `consultaLinhas({import_id, status, pagina, por_pagina})` | Pré-visualização: `{total, pagina, por_pagina, itens: [{linha_num, status, erros, dados_originais, interpretado, entity_id_gerado, event_id_gerado}]}`; na importação de eventos, cada item traz também `lancamento` = os `linha_num` (todas as páginas, em ordem) que formam o mesmo lançamento pela chave de agrupamento da validação (`null` na linha repetida no arquivo): deixar de fora vale para o lançamento inteiro (`GRUPO_PARCIAL`) |
| `consultaRelatorio({import_id})` | Relatório final: o estado + `aprovacao {modo, por, em, texto}`, `criados {animais, eventos, ativos}`, `reprovadas [{linha_num, status, erros, dados_originais}]`, `ignoradas`, `pendencias {sem_brinco, sem_nascimento}` |
| `consultaListar()` | `{itens, em_curso}` (a importação IMPORTANDO, para a faixa "importação incompleta") |
| Puras: `lerCsv(texto, delim)`, `interpretarArquivo(texto, delim) → {cabecalho, linhas: [{linha_num, valores}]}`, `sugerirMapeamento(cabecalho)`, `conferirMapeamento(m, cabecalho, pastosPorId)`, `validarLinhas(linhas, map, formato, contexto)` | `linha_num` conta o cabeçalho como 1 e as linhas em branco (é a linha da planilha do dono); célula além do cabeçalho fica em `#coluna_extra_N` e reprova a linha |

Revisão final: a mãe e o pai citados pelo brinco na importação de ANIMAIS são o animal que usava o número no marco zero
(os períodos de IDENTIFICACOES, `donoDoBrinco_`, a mesma resolução das importações de eventos); número em dois animais no
marco zero ou sem uso nele pede o código interno. A fêmea "prenhe" nascida no dia do marco zero é `PRENHA_SEM_IDADE`.

Códigos de linha — DUPLICADA: `BRINCO_JA_CADASTRADO` (o brinco em uso hoje; revisão 3: também o que outro animal usava no marco zero ou depois dele, num período já fechado — o animal do rebanho inicial o teria em dois ao mesmo tempo; os períodos são os de `Timeline.periodosDeBrinco`, e a mãe e o pai citados pelo brinco são o animal que o usava no marco zero pelos mesmos períodos — seção 46 —, por isso a validação lê IDENTIFICACOES, AJUSTES e EVENTOS, com acesso cru), `BRINCO_REPETIDO_NO_ARQUIVO`; ERRO: `MAE_NAO_ENCONTRADA`,
`PAI_NAO_ENCONTRADO`, `MAE_COM_ERRO`, `PAI_COM_ERRO`, `SEXO_DO_PROGENITOR`, `NASCIMENTO_DO_PROGENITOR`,
`PROPRIO_PROGENITOR`, `CICLO_GENEALOGICO`, `DATA_INVALIDA`, `FORMATO_INVALIDO`, `TIPO_INVALIDO`, `VALOR_FORA_DA_LISTA`,
`PASTO_NAO_ENCONTRADO`, `PASTO_INATIVO`, `COLUNAS_A_MAIS`, `CONFLITO_DE_CAMPOS`, `NASCIMENTO_DEPOIS_DA_ENTRADA`,
`ENTRADA_DEPOIS_DO_MARCO_ZERO`, `ENTRADA_ANTES_DO_NASCIMENTO`, `PREVISAO_PASSADA`, `CASTRADO_REPRODUTOR`,
`BRINCO_NAO_NUMERICO` e os do catálogo (`CAMPO_OBRIGATORIO`, `CAMPO_NAO_SE_APLICA`, ...).

### 18.2 Importação de eventos históricos (E2.10): COMPRAS, VENDAS, TRANSFERENCIAS, NASCIMENTOS, MORTES

`TIPOS_SUPORTADOS` = ANIMAIS + os cinco (`TIPOS_EVENTO`: tipo de importação → `event_type`, COMPRAS → COMPRA etc.) + os
quatro de manejo da Fase 3 (PESAGENS, SANIDADE, REPRODUCAO, OCORRENCIAS; seção 42): os dez do enum `TIPO_IMPORTACAO`. Mesmas rotas, chaves, estados e regras da seção 18 (TOTAL/PARCIAL_APROVADO, aprovação em
AUDITORIA, backup antes de concluir, IMPORTADO como commit, CANCELADO no desfazer); o que muda:

| Peça | Contrato |
|---|---|
| Modelo (`MODELOS[tipo]`, `modelo(tipo)`) | `{tipo, evento, rotulo, tipos, campos: [{campo, rotulo, tipo, escopo (EVENTO = do lançamento, basta numa linha do grupo; LINHA = do animal), obrigatorio, lista, opcoes}], confiancas, padroes, obrigatorios: [[campo, ...]] (um dos), agrupamento: {campo: 'grupo', obrigatorio, natural, ajuda}, formatos_data, delimitadores, codificacoes, max_linhas, cabecalho_modelo}`. `sugerirMapeamento(cabecalho, tipo)` reconhece os rótulos inteiros |
| Campos | COMPRAS: `grupo` (Nº da compra, obrigatório), `data`, `fornecedor` (parceiro por nome ou CPF/CNPJ), `finalidade`, negociação (`modalidade`, `base_peso`, `rendimento`, `rendimento_tipo`, `preco`, `criterio_rateio`, `justificativa_rateio`), `peso_total`, `valor_animais`, `frete` e `outros_custos` (um lançamento cada; 0,00 = "não houve", sem lançamento, como desconto e deduções da venda), `vencimento` + `parcelas` (N parcelas mensais iguais) + `forma_pagamento`, `gta`, `nota_fiscal`, `observacoes_lancamento`; por animal `brinco`, `codigo`, `brinco_origem`, `nome`, `sexo`, `raca`, nascimento/idade/confiança, `castrado`, `reprodutor`, `pasto`, `peso`, `metodo_pesagem`, `peso_carcaca`, `valor_individual`, `observacoes`. VENDAS: `grupo` (obrigatório), `data`, `comprador`, `finalidade`, `pasto_origem`, negociação, `peso_vivo_total`, `peso_carcaca_total`, `valor_bruto`, `desconto`, deduções `frete`/`comissao`/`funrural`/`outras_deducoes` com a marca de cada uma
(`frete_retido`, `comissao_retida`, `funrural_retido`, `outras_retidas`: "descontado pelo comprador", sim/não, também como
valor para todas as linhas em `padroes`; sim = `retida_pelo_comprador`, com o comprador como parceiro e o título no
recebimento, como no formulário; sem a marca, não descontada), parcelas; por animal `brinco`/`codigo`, `peso`, `metodo_pesagem`, `peso_carcaca`, `valor_individual`, `motivo_saida`. TRANSFERENCIAS: `data`, `pasto_origem`, `pasto_destino`, `gta`; `brinco`/`codigo`. NASCIMENTOS (uma linha por cria): `data`, `mae` (brinco), `pai` (brinco, código ou nome de animal de referência) + `pai_confianca`, `tipo_parto`, `pasto`; por cria `situacao` (vivo/natimorto), `sexo`, `brinco`, `nome`, `raca`, `peso`, `metodo_pesagem`. MORTES: `data`, `causa`, `diagnostico`, `responsavel`; `brinco`/`codigo` |
| Agrupamento | Linhas com o mesmo `grupo` formam um evento; sem ele, a chave natural (TRANSFERENCIAS: data + origem + destino; NASCIMENTOS: mãe + data; MORTES: cada linha). Linha idêntica a outra do arquivo fica DUPLICADA (`LINHA_REPETIDA_NO_ARQUIVO`) só quando identifica o animal (brinco, código ou brinco do vendedor; revisão final, achado 1): linhas iguais sem identificação são animais diferentes — gêmeos sem brinco em NASCIMENTOS, garrotes sem brinco da mesma compra em COMPRAS; a repetição do evento é pega por `EVENTO_JA_REGISTRADO` (e, no parto, pelo aviso `INTERVALO_PARTO_CURTO`). Campo do lançamento diferente entre as linhas → `CONFLITO_NO_GRUPO`; obrigatório do lançamento ausente em todas as linhas → `CAMPO_OBRIGATORIO`. O evento só entra inteiro: linha boa de grupo com problema → `LANCAMENTO_COM_ERRO` |
| Validação (`validarBloco`) | (Revisão final: cada evento do ensaio também passa pela trava de integridade, seção 10.5; as mensagens do motor saem na linguagem da planilha — sem "Linha N:" e, no frete, nos outros custos e nas deduções, com a coluna de origem no lugar de "Custo k"/"Dedução k".) Relê o arquivo inteiro e planeja TODOS os eventos, em ordem cronológica (data, primeira linha), num **ensaio**: um repositório em memória montado das linhas cruas da unidade, em que esta importação vale como concluída e cada evento planejado passa a valer para os seguintes (a segunda transferência parte do destino da primeira). Cada evento passa por `EventService.planejarEventoImportado` (regras do formulário; RN-090); o erro do motor volta para a linha pelo "Linha N" das mensagens ou pelo animal; CONFLICT com registro gravado vira motivo da linha. O animal é achado pelo código interno ou pelo brinco em uso NA DATA do evento (revisão 3; 05, RN-002/RN-004: o número tem dono por período, início ≤ data < fim, pelos períodos de `Timeline.periodosDeBrinco` — a regra única do brinco numa data, a da posição: o número corrigido por IDENTIFICACAO_INCORRETA vale desde o início do errado, e o errado não tem período; seção 46; em data anterior a todo uso do número — o histórico antes do marco zero citado pelo brinco da fotografia — vale o primeiro animal que o recebeu; número sem dono na data ou em dois animais → `ANIMAL_NAO_ENCONTRADO`/`CONFLITO_DE_CAMPOS` pedindo o código interno; a mãe e o pai do parto também) (na compra, não achado = animal novo; achado = volta ao rebanho ou compra histórica, com sexo e nascimento conferidos: `DIVERGE_DO_CADASTRO`). DUPLICADA: `LINHA_REPETIDA_NO_ARQUIVO` (linha idêntica) e `EVENTO_JA_REGISTRADO` (o animal já tem esse evento nessa data fora desta importação; na TRANSFERENCIA, só com a mesma origem e o mesmo destino — outra transferência do dia, como a volta B → A, é outro evento e recebe o aviso `POSSIVEL_DUPLICIDADE` do motor, como no formulário). Outros códigos: `ANIMAL_NAO_ENCONTRADO`, `ANIMAL_REPETIDO`, `PARCEIRO_NAO_ENCONTRADO`, `PARCEIRO_AMBIGUO`, `PASTO_NAO_ENCONTRADO`, `PAI_NAO_ENCONTRADO`, `CONFLITO_DE_CAMPOS` e os do motor. Reads: as do formulário de todos os tipos importáveis (`leiturasImportacao_`), com acesso cru |
| Confirmação e blocos (`importarBloco`, `comandoBloco(pedido)`) | Bloco 1 revalida tudo (diferente do gravado → `CONFLICT`); `ignorar_linhas` precisa cobrir o evento inteiro (`GRUPO_PARCIAL`) e não pode deixar outro evento sem aquilo de que depende (`DEPENDE_DE_LINHA_IGNORADA`, conferido por um segundo ensaio). Bloco = eventos inteiros, em ordem cronológica, até `importacao_lote_linhas` linhas (evento maior vai sozinho); `relatorio_json.tamanhos_blocos` (linhas por bloco) e `eventos` ficam fixados na confirmação. Cada bloco: ensaio com os blocos anteriores já gravados valendo, os eventos do bloco planejados em ordem e copiados para o plano real (uma operação, N eventos); evento que deixou de valer → `CONFLICT`; avisos do motor → `NEEDS_CONFIRMATION`. Linhas → IMPORTADA com `event_id_gerado` e `entity_id_gerado` (o animal da linha: o achado, o criado pela compra ou a cria viva; natimorto sem animal). `comandoBloco` devolve o comando pronto para `UnitOfWork.run` (varredura de quedas) |
| Desfazer | Com outra importação em curso (IMPORTANDO), desfazer uma concluída é recusado (`CONFLICT` `IMPORTACAO_EM_CURSO`, RN-032; desenho-base 16.8: as rotas `importacao.*` servem à que está em curso), porque os animais e eventos pendentes da outra não entram nas conferências. Importação de eventos concluída: bloqueado (`CONFLICT`, detalhe `DEPENDENTE` com `conflito.event_id`) por lançamento, filho, registro reprodutivo de que ele é o touro (revisão 3), valor alocado por outro lançamento ou anexo fora dela sobre animal que ela criou (a de ANIMAIS também); por correção (substituto vigente, de fora) de um evento dela — a cadeia de substituição é da importação: o dono estorna a correção antes; por registro de fora que a linha do tempo de um animal que ela só tocou deixaria de aceitar sem os eventos dela (ex.: a volta ao rebanho depois da venda importada); pelo que voltaria a esse animal e não cabe mais (`EventService.conferirRestauracao`: o brinco que hoje é de outro animal, a genealogia, a categoria desativada — detalhe `DEPENDENTE` com o registro que impede); e por parcela LIQUIDADA de um lançamento dela (`PARCELA_LIQUIDADA`) |
| Relatório final | `criados.animais` = animais que os eventos criaram (compra, cria viva); `criados.eventos`; `pendencias` sobre os criados; `reconciliacao` (abaixo) em todo tipo, também ANIMAIS (CT-12) |
| Reconciliação (`consultaReconciliacao()`, rota `importacao.reconciliacao`, acesso cru; RN-095) | O histórico de cada animal segue a ordem canônica (data, classe pelo tipo do evento — entrada 0, movimento ou fato 1, saída 2 —, posição na cadeia de substituição, `event_seq`): venda e transferência no mesmo dia, importadas em arquivos separados, dão o mesmo resultado em qualquer ordem. `evento` de cada divergência: `{event_id, tipo, subtipo, data, nome}`. Sem gravar e sem bloquear: para cada animal com registro anterior ao marco zero, a posição no marco zero recalculada pelo histórico (entrada: compra, cria, transferência; saída: venda, morte, descarte; pasto = último destino) × a declarada na fotografia (ENTRADA_INICIAL), com a decisão do dono pelos lançamentos que a ação recomenda datados do marco zero (revisão 3: a correção de localização muda o pasto declarado; a baixa na contagem tira o animal da fotografia; a divergência tratada sai do relatório; revisão 4: a outra entrada do animal datada do marco zero o põe na fotografia — é o caminho de FORA_DA_FOTOGRAFIA —, e o animal da fotografia baixado na contagem do marco zero não vira divergência pelo histórico que o punha na fazenda, nem na conta do pasto). A explicação de FORA_DA_FOTOGRAFIA cita a última entrada ou movimento antigo, ou o parto antigo em que o animal é a mãe (revisão 4: nunca erro interno). A ação de FORA_DA_FOTOGRAFIA dá só o que o sistema aceita: lançar "Outra entrada" datada do marco zero, ou importar a venda ou a morte antiga (revisão final: na cria de parto antigo, quando a fotografia tem um animal nascido no mesmo dia, da mesma mãe ou sem mãe informada, e sem parto, a divergência traz `mesmo_animal` e a ação manda estornar o parto antigo ou desfazer a importação dele, nunca "Outra entrada", que poria o bezerro duas vezes); o descarte antigo ainda não tem registro (limitação 7 do relatório da fase), e a divergência continua na lista. `{marco_zero, resumo: {na_fotografia, com_historico, divergencias, por_codigo, pastos_divergentes, sem_animal, bloqueia: false}, animais: [{animal_id, codigo_interno, brinco, codigo (SAIDA_HISTORICA_NA_FOTOGRAFIA \| PASTO_DIVERGENTE \| FORA_DA_FOTOGRAFIA), declarado: {no_rebanho, pasture_id, pasto}, recalculado, explicacao, acao (o que fazer: aceitar a fotografia é o padrão; corrigir pelos eventos de correção), evento: {event_id, tipo, data}}], pastos: [{pasture_id, pasto, declarado, recalculado, diferenca, animais, explicacao}], sem_animal: [{import_id, arquivo_nome, tipo, linha_num, mensagem}] (brinco citado em linha de evento sem animal: `ANIMAL_NAO_ENCONTRADO` de importação não cancelada)}`. A decisão sobre cada divergência é registrada pelos próprios lançamentos (correção de localização, baixa na contagem, estorno do registro antigo) ou fica a fotografia |

### 18.1 Apoio aos testes de sistema (`tests/apoio-sistema.js`)

`sistema({order, semCadastro, config})`: o banco nasce pelo `Maintenance.setup`; sem `semCadastro`, um comando auditado
cria a propriedade `PROP`, os pastos `PASTOS.A` e `PASTOS.B` (identificação `P-B`) e grava `data_marco_zero =
2026-01-01`, `propriedade_padrao_id` e o que vier em `config`. Helpers: `ctx()` (portas reais, com `files`), `exec(fn)`,
`tentar(fn)`, `read(q)`, `tabela(aba, banco?)`, `evento(acao, dados, chave)`, `integridade()`, `conferirProjecoes()`,
`editar(aba, id, coluna, valorCru)` e `apagarLinha(aba, id)` (edição à mão no fake); `situacoes(relatorio)`.

## 19. `Api` (plataforma: guarda de dono, roteador, contexto, envelope, rascunho, páginas)

**Pedido** (`google.script.run.api(pedido)`): `{rota, dados (objeto; padrão {}), idempotencyKey (texto ≤ 200; obrigatória
em comando), avisosAceitos ([código] ou [{codigo, animal_id, justificativa}]; vira a lista de códigos), dataVersionEsperada
(inteiro), ambiente (PRODUCAO padrão | TESTE | DEMO)}`. O banco vem SEMPRE do ambiente (Script Properties), nunca de um ID
enviado pelo cliente. Pedido malformado → `VALIDATION` com `details[0].campo` (rota, dados, idempotencyKey, avisosAceitos,
dataVersionEsperada, ambiente).

**Envelope** (sempre; `api()` nunca lança): `{ok: true, data, meta}` ou `{ok: false, error: {code, message, details}, meta}`,
copiado por JSON (nenhum `Date`, função ou `undefined` sai). `meta = {dataVersion (versão do banco do ambiente, ou null sem
banco/DENIED/rascunho), appVersion (= package.json), serverTime (ISO UTC)}`; em comando também `duplicado` (booleano),
`opId`, e `semAlteracao`/`recuperada` quando a UnitOfWork os devolve. `data` = o `dados` do serviço. Exceção que não é
`AppError` (ou `INTERNAL`): mensagem genérica de `Validation`; o detalhe vai para o log de execuções e para ERROS_LOG
(`codigo = API_<code>`, `contexto = api:<rota>`).

| Membro | Contrato |
|---|---|
| `tratar(pedido, guarda?)` | O roteador. `guarda = {usuario}` (já conferido por Code.js) ou `{erro}` (vira envelope DENIED); sem guarda, confere aqui |
| `assertOwner({props, evento}?) → e-mail` | 01, seção 4.2: e-mail ativo = dono (`OWNER_EMAIL`, senão o usuário efetivo; sem diferença de maiúsculas); vazio → `DENIED` com a instrução, salvo `ALLOW_EMPTY_ACTIVE_USER = true` (o usuário passa a ser o dono); `evento.triggerUid` de gatilho instalado (`getProjectTriggers().getUniqueId()`) → o dono; uid estranho → `DENIED` |
| `contexto({ambiente, usuario, props}) → ctx` | `Maintenance.contexto` + `fuso = io.fuso()` + `session = {usuario, ambiente, base_de_teste}`. Planilha inacessível → `CONFIG` (causa em `erro.causa` e no log) |
| `rotas() → {rota: {tipo, fase, modulo, exigeChave}}` | `tipo` ∈ CONSULTA, COMANDO, MANUTENCAO, RASCUNHO, FUTURA. `ROTAS_CANONICAS` = as 51 da seção 15.3, na ordem |
| `pagina(e)`, `paginaNegada(erro)` | doGet: `Index` (template com `appVersion`, `ambiente` e `urlApp`) com título "ERP Pecuário" e viewport; `?ambiente=TESTE\|DEMO` abre a SPA sobre essa base (outro valor → página de aviso "Endereço do app inválido"); `urlApp` = `ScriptApp.getService().getUrl()` (+ `?ambiente=` fora da produção; falha → `''` e causa no log); sem `Index.html` no projeto, página de aviso; `?pagina=concorrencia` → `TestRunner.paginaConcorrencia()` |
| `incluir(nome)` | Conteúdo de `src/<nome>.html` da lista branca `INCLUDES` (Styles, JavaScript, Components, Dashboard, Animals, Pastures, Events, Weights, Health, Reproduction, Financial, Reports, Settings, Import), compactado (`compactar`); outro nome → `VALIDATION`. Templates chamam `<?!= include_('Styles') ?>`. O `Index` não inclui as telas sob demanda (`TELAS_SOB_DEMANDA`) |
| `TELAS_SOB_DEMANDA`, `tela(dados)` | As telas que não entram na página inicial, arquivo → módulo (`Import` → IMPORTACAO; `Weights`, `Health`, `Reproduction` → PESAGENS, SANIDADE, REPRODUCAO; `Financial` → FINANCEIRO; `Reports` → RELATORIOS), e o tratador da rota `sistema.tela` (abaixo) |
| `compactar(texto)` | O include como vai ao aparelho (orçamento de ~450 KB, 01, seção 6.2): sem o recuo do começo das linhas, sem linha vazia e sem linha que é só comentário (`// …`, bloco `/* … */` que começa no início da linha); comentário no fim de uma linha de código fica. Pressupõe o que `tests/interface.test.js` confere nos includes: nenhum template literal e nenhuma linha que continua na seguinte. A página inicial montada fica em cerca de 406 KB desde a etapa BASE da Fase 3, sem as telas sob demanda (eram 449 KB no fim da Fase 2) |
| `rascunho(acao, dados, info)` | Ver rotas `rascunho.*` |
| `executarNoEditor(nome, fn)` | Corpo das funções do editor e dos gatilhos: resultado em JSON simples + resumo no log; erro registrado e relançado |
| `diagnosticoSessao()` | SP-04 sem dado sensível: `{email_ativo_preenchido, email_ativo_e_do_dono, email_efetivo_preenchido, dono_registrado, contingencia_email_vazio}` |
| `APP_VERSION`, `TITULO`, `FAIXA_TESTE` (`'BASE DE TESTE'`), `RASCUNHO` (`{prefixo, maxBytes: 8000, max: 40, validadeDias: 30}`) | Constantes |

**Rotas.** As 51 canônicas; as de fase futura respondem `NOT_FOUND` "Esta função faz parte do módulo X, que chega na fase N"
(`produto.salvar`, `protocolo.salvar` e `sanidade.agenda` entraram na E3.2 e na E3.3; `estacao.salvar` e
`reproducao.indicadores`, na E3.4; `conta.salvar`, `preco.salvar`, `parcela.*`, `financeiro.*` 4;
`relatorio.*` 5); rota desconhecida → `NOT_FOUND`. Cada uma chama o serviço da seção correspondente com
`pedido = {idempotencyKey, dados, avisosAceitos, dataVersionEsperada}` (comando) ou `dados` (consulta). Particularidades:

| Rota | O que faz |
|---|---|
| `sistema.bootstrap` | `dados.dataVersion` = versão em cache: igual à atual e sem marcador → `{atual: true, dataVersion, appVersion, ambiente}` (só Script Properties). Senão, numa leitura validada: `{atual: false, configuracoes, listas, categorias, cobertura, parceiros (Config.cadastros), propriedades, pastos (cartões de hoje, inclusive inativos), animais (ATIVOS + EXTERNOS em colunas), alertas, catalogo (EventCatalog.serializar), modulos, produtos e protocolos (Fase 3: `HealthService.cadastros`, todos, inclusive os desativados, o produto com `estoque_atual` e `abaixo_do_minimo`), dataVersion, appVersion, ambiente: {codigo, base_de_teste, faixa: 'BASE DE TESTE' \| null}, usuario, sistema: {primitiva, ultimo_backup, integridade, gatilhos}}` |
| `sistema.estado` | `Maintenance.estado` (backups, forma de gravação, integridade, gatilhos) — tela de sistema e lista para restaurar |
| `sistema.tela` | Consulta extra (Fase 3, etapa BASE; 01, seção 6.2; risco R-31): `{nome}` (o arquivo, como o catálogo o declara em `tela`) → `{nome, modulo, conteudo, bytes}`, com `conteudo` = o arquivo compactado como o doGet entrega os includes (`incluir`) e `bytes` em UTF-8. Guarda de dono como toda rota; não abre a planilha-banco (`semBanco`: sem contexto, `meta.dataVersion = null`, funciona sem o banco do ambiente). Nome fora de `TELAS_SOB_DEMANDA` (inclusive as telas da página inicial) → `VALIDATION` (campo `nome`, "Tela desconhecida para esta versão do app…", sem o nome do arquivo); módulo da tela ainda não entregue (sem `tela`/`sob_demanda` no catálogo) → `NOT_FOUND` "Esta tela faz parte do módulo X, que chega na fase N e ainda não foi entregue."; arquivo ausente do projeto do Apps Script → `NOT_FOUND` com a instrução de enviar o projeto de novo (causa no log) |
| `peso.desempenho` | Consulta (Fase 3, E3.1; módulo PESAGENS): `WeightService.desempenho(ctx, dados)` (seção 38); `acessoCru`, nada gravado; filtros inválidos → `VALIDATION`, pasto, categoria ou animal inexistentes → `NOT_FOUND` |
| `produto.salvar`, `protocolo.salvar` | Comandos (Fase 3, E3.2; módulo SANIDADE): `HealthService.salvarProduto` e `salvarProtocolo` (seção 39), com chave, avisos e versão esperada como todo cadastro |
| `sanidade.agenda` | Consulta (Fase 3, E3.3): `HealthService.agenda(ctx, dados)` (seção 39); `{data?, periodo_inicio?, periodo_fim?}`; data futura ou inválida → `VALIDATION` |
| `estacao.salvar` | Comando (Fase 3, E3.4; módulo REPRODUCAO): `ReproductionService.salvarEstacao` (seção 40) |
| `reproducao.indicadores`, `reproducao.matrizes` | Consultas (Fase 3, E3.4): `ReproductionService.indicadores` e `matrizes` (seção 40); `reproducao.matrizes` é rota extra, não canônica (a lista de fêmeas da tela e os alertas de parto) |
| `sistema.backup` / `sistema.restaurarBackup` / `sistema.integridade` | Manutenção (sem chave): backup SOB_DEMANDA; `restaurar` com `{backup_id, justificativa}`; integridade (`{reparar: true, justificativa}` → `repararIntegridade`) |
| `operacao.status` | `{chave}` → `UnitOfWork.status` |
| `evento.simular` | `{acao: registrar \| corrigir \| estornar, dados}` → `EventService.simular`; outra ação → `VALIDATION` |
| `config.salvar` | `Config.salvar`; mudando `fuso`, a planilha-banco recebe o fuso novo (e `pt_BR`) logo depois do commit |
| `importacao.importarBloco`, `importacao.concluir`, `importacao.desfazer` | Comandos SEM chave do cliente (a chave é `ImportService.chaveBloco`) |
| `importacao.obter`, `importacao.previa`, `importacao.linhas`, `importacao.relatorio`, `importacao.listar` | Consultas do assistente (`ImportService.obter`, `previaArquivo`, `consultaLinhas`, `consultaRelatorio`, `consultaListar`) — rotas extras, não canônicas |
| `importacao.reconciliacao` | Consulta extra: `ImportService.consultaReconciliacao()` (seção 18.2) |
| `importacao.modelo` | Consulta extra: `ImportService.modelo(dados.tipo)` (sem tipo ou ANIMAIS: o de animais, com `tipos` = todos os importáveis; tipo de evento: o modelo da seção 18.2; outro → `VALIDATION`) → `{tipos, campos: [{campo, rotulo, tipo, obrigatorio (sexo, pasto), so_femea, so_macho}], confiancas: {data_nascimento, data_entrada, mae, pai: [valores]}, padroes, formatos_data, delimitadores (';' ',' 'TAB' '\|'), codificacoes, max_linhas, cabecalho_modelo}`. O cabeçalho do modelo para baixar são os rótulos dos campos, que `sugerirMapeamento` reconhece inteiros |
| `auditoria.listar` | `AuditService.listarAuditoria`: a trilha completa (EVENTOS + AJUSTES + AUDITORIA, seção 11) com filtros de entidade, registro, período e operação, paginada |
| `sistema.diagnostico` | Consulta extra da tela de sistema, sem planilha temporária nem dado sensível: `{sessao (diagnosticoSessao), primitiva, gatilhos: {esperados, instalados, faltando}, fuso: {script, planilha}, data_version, gravacao_em_curso, app_version, editor: 'runDiagnostics'}`. Sem banco do ambiente → `CONFIG` |
| `rascunho.salvar` / `rascunho.obter` / `rascunho.remover` | Seção 17, SP-06: `{chave (A-Z a-z 0-9 . _ : -, até 100), conteudo}` nas propriedades do USUÁRIO, chave `RASCUNHO:<ambiente>:<chave>`; fora da planilha, sem versão, funciona sem banco. `salvar → {chave, salvo_em, bytes, partes}` (revisão 3: acima de 8 KB o texto vai em partes `<chave>#1`, `#2`… — um valor das propriedades tem 9 KB — e a chave guarda quantas são; acima de 96 KB, com 40 guardados ou com os rascunhos juntos acima de 400 KB, `VALIDATION`; vencidos há 30 dias saem na gravação, com as partes); `obter → {chave, existe, conteudo, salvo_em}`; `remover → {chave, removido}` |

## 20. `Code` (funções públicas)

Só estas funções globais sem `_` (o teste estático exige a lista exata e a guarda na primeira linha de cada uma):
`doGet(e)` (página ou "acesso negado"), `api(pedido)` (envelope), `setup()` (`Maintenance.setup` com o fuso do script),
`runAcceptanceTests()`, `runDiagnostics()`, `verifyIntegrity()` (relatório de integridade da produção),
`trgManutencaoDiaria(e)`, `trgIntegridadeSemanal(e)` (contexto de produção por `Api.contexto`). Auxiliares: `assertOwner_(evento,
semLancar) → {usuario, erro}` e `include_(nome)` (templates). As do editor devolvem JSON simples e registram um resumo no log;
falha → exceção (a execução aparece com erro).

## 21. `TestRunner` (aceitação de nível 2, base de demonstração, diagnóstico)

| Função | Contrato |
|---|---|
| `runAcceptanceTests({usuario, plano?, limiteMs?, reiniciar?, injetar?})` | `plano` = `ACEITACAO` (padrão, ou `TEST_PLAN`) ou `DEMO`. ACEITACAO: base de teste NOVA (a anterior vai para a lixeira) por `Maintenance.setup({ambiente: 'TESTE'})` e os cenários `CENARIOS`, nesta ordem: PREPARO, CT-09, CT-01, CT-02, CT-03, CT-04, CT-05, CT-06, SANIDADE, ESTOQUE, REPRODUCAO (Fase 3; seções 38 a 40), CT-07, CT-08, CT-13, CT-14, CT-17, CT-18, CT-10, CT-12, RESTAURACAO, CT-20, CT-11, ISOLAMENTO — todos pela `Api` com `ambiente: 'TESTE'` (os da Fase 2 antes do CT-11, que muda parâmetros e desativa uma categoria). O CT-09 roda inteiro desde a VENDA: venda de animal vendido (1), transferência de animal morto (2), o brinco do vendido (" 0901 " e "901", 3a e 3b; na troca de brinco de outro animal, 3c), identificação de animal morto (3d) e compra de animal vendido antes da saída (recusada) e depois (reentrada com o mesmo `animal_id`) (10). Os cenários da Fase 2 (09, seções 3, 4 e 8) usam as datas do 09 contadas do marco zero (D0+n; D0 = hoje − 365), pastos e parceiros próprios de cada cenário (a contagem por pasto em cada data fica exata na base compartilhada; o total é conferido pela diferença) e terminam em `sistema.integridade` sem erro (projeção = reconstrução e as invariantes do financeiro): CT-01 (parto, tabelas, inventário nas datas, cria e matriz, nome por AUDITORIA e sexo por AJUSTES, gemelar com natimorto), CT-02 (tudo ou nada sem gravar nem a operação, reenvio com a mesma chave, inventário na véspera, 59 dias no pasto), CT-03 (parcelas que não somam; 20 animais, 2 lançamentos, 3 parcelas, 40 alocações, custo 2.560,00, a pagar +51.200,00), CT-04 (revisão pelo servidor e gravação com `dataVersionEsperada`; receita e comissão rateadas pelo peso; a receber e a pagar), CT-07 (original idêntico salvo os caches, auditoria, estorno repetido e do estorno, CONFLICT com o posterior, entrada estornada com o brinco liberado), CT-08 (100 animais; 102/102/96; estornada a venda, 101), CT-13 na compra (a e b, e a entrada embaralhada na revisão), CT-14 (carcaça apurada, rendimento estimado, ARROBA sem base), CT-17 (retroativo que quebra a cadeia, dois movimentos no mesmo dia, identificação e pesagem no dia da venda e no seguinte — no dia vale, no seguinte `FORA_DA_PERMANENCIA` —, transferência no dia da venda) e CT-18 (compra com pesagem, identificação e transferência: correção com os mesmos animais e os três posteriores válidos, unicidade do brinco no estado final, retirada recusada com os três lançamentos que impedem; e a variante da Fase 1, entrada inicial com correção de localização). Fase 3, E3.1: o CT-05 inteiro (0501 no Pasto 1; pesagens de 300,0, 372,8 e 380,0 kg em D0+68, D0+159 e D0+169 com o ganho na resposta; a ficha com 91 dias, 72,8 kg, 0,800 kg/dia e 24,27%, o intervalo de 10 dias sem GMD — DADOS_INSUFICIENTES, nunca zero —, 3 linhas sem coluna de GMD e peso atual 380,0; peso 0 → VALIDATION; 450,0 kg em D0+179, 7,00 kg/dia → PESO_IMPLAUSIVEL, gravado só com o aceite) e o passo 3 do CT-10 (a mesma pesagem duas vezes no dia → NEEDS_CONFIRMATION POSSIVEL_DUPLICIDADE, sem gravar; aceita, grava). Fase 3, E3.2 a E3.5 e aceitação: CT-06 (seção 39); SANIDADE (09, seção 4.1: lote vencido e consumo acima do saldo com os dois avisos e o aceite, saldo negativo visível; RN-072 com o vermífugo de 35 dias — a carência até D0+135 na aplicação e na `sanidade.agenda` no dia, no último dia e livre no seguinte; abate em D0+120 e D0+135 `CARENCIA_ATIVA`, em D0+136 livre; a recria dentro do prazo pede o aceite e grava com ele —; o exemplo de 05, seção 4.7, com a bezerra nascida em D0+40 e o protocolo de aplicação única para fêmeas de 3 a 8 meses — fora antes dos 3 meses, elegível e em dia aos 3, PROXIMA com o vencimento aos 8 meses dez dias antes, cumprida depois da aplicação —; e a aplicação única de machos de 24 meses vencida na agenda e nos alertas); ESTOQUE (o exemplo de 03a, seção 4.7: 30 bezerros, frasco de 50 doses a R$ 1,80 por dose; entrada de 2 frascos por R$ 180,00 → 100 doses, ESTOQUE_INSUMOS com a parcela no vencimento e sem rateio; a vacinação dos 30 → CUSTEIO de R$ 54,00 SEM_CAIXA e 30 alocações de R$ 1,80; perda de 5 e contagem de 60 → acertos de −5 sem lançamento; o estorno da vacinação devolve as 30 doses e cancela o consumo; saldo = Σ dos movimentos vigentes); REPRODUCAO (seção 40, e os desfechos da estação de 07, seção 8.3: aborto, morte de uma cria e a desmama das outras → desmama 75,0%, mortalidade até a desmama 3,2%, perda gestacional 3,1% parcial, sem mudar as taxas de RN-066). Cada um com pastos próprios e o fim em `sistema.integridade` sem erro. O CT-12 inclui a reconciliação (passo 5r: transferência histórica que diverge da fotografia e brinco sem animal; lista no relatório final e na rota, sem bloquear; desfeita, some). Ficam `NAO_SE_APLICA`, com o motivo: CT-03 passo 4 (resultado gerencial, Fase 4), CT-13 c a f (evento RATEIO, Fase 4) e CT-20 passo 2 (prova sobre o fake); `PENDENTE_NA_CONTA_DO_DONO`: CT-10 passo 6. Relatório `{plano, completo: true, ok, resumo: {cenarios: {PASSOU, FALHOU}, passos: {PASSOU, FALHOU, NAO_SE_APLICA, PENDENTE_NA_CONTA_DO_DONO}}, cenarios: [{id, titulo, situacao, falha, ms, passos: [{passo, titulo, situacao, detalhe}]}], corpus, limpeza, arquivo: {nome, id}}`, gravado em JSON na pasta Testes. Pausa perto de `limiteMs` (padrão 4 min) → `{completo: false, proximo, mensagem}`; a chamada seguinte continua (cursor `TEST_CURSOR`, resultados `TEST_RESULTADO:<i>`, apagados no fim). Falha de cenário vai para o relatório (e para o log) e os demais seguem; falha no PREPARO encerra. No fim: backups e bancos antigos da rodada para a lixeira; a base de teste final fica (página de concorrência) |
| `injetar` (só no Node) | `{ocuparLock(), liberarLock()}`: outra execução segura o lock (CT-10, passo 5). Sem ele, o passo é NAO_SE_APLICA |
| DEMO | Base de demonstração em `DEMO_SPREADSHEET_ID` (criada pelo setup se não existe) com a composição de 09, seção 7, nos eventos entregues (Fases 1 a 3): propriedade, 6 pastos (1 arrendado, capacidades folgadas), D0 = hoje − 1095 (ou o marco zero já gravado), fornecedor, recriador, frigorífico e veterinária (`seed:parceiro`, `seed:comprador`, `seed:frigorifico`, `seed:veterinario`); a 'Vacina (demonstração)' (estoque controlado, R$ 1,50 por dose), o 'Vermífugo (demonstração)' (sem estoque, R$ 0,04 por mL), o protocolo 'Vacina semestral' (180 dias, todo o rebanho), o protocolo 'Vermifugação da recria' (8 a 30 meses, 120 dias) e as três estações de monta (D0+30, D0+395, D0+760; 90 dias cada); 240 em D0 (6 ENTRADA_INICIAL de 40: 110 vacas, 4 touros, 30 novilhas, 48 bezerros ao pé com a mãe, 48 garrotes); 10 compras de 7 (por cabeça com o valor de cada animal ou por kg vivo; frete e duas parcelas; uma corrigida); partos pela estação de monta (Fase 3, aceitação): 60% das vacas sem cria ao pé em D0 parem nos primeiros 60 dias; em cada estação a fêmea exposta (25 meses ou mais, no rebanho no primeiro dia) emprenha com 88% de chance e pare na janela da estação (início + 285 a + 375 dias), a pelo menos 340 dias do parto anterior; até 255 nascidos vivos (262 partos com gêmeos e 11 natimortos; o corte dos 255 só alcança a última estação, cuja janela passa do fim — o gerador recusa o plano que cortasse parto de estação encerrada), com o brinco no nascimento ou nas campanhas de identificação (e uma troca de brinco); a exposição das fêmeas aptas com os touros no primeiro dia de cada estação e o diagnóstico por palpação 150 dias depois (positivo para a que emprenhou no plano; a prenha da última estação com o parto depois do fim fica sem desfecho); desmama aos 8 meses em campanhas a cada 90 dias por DESMAMA com o pasto de destino e o peso de cada bezerro pelo modelo de ganho (fêmeas para o Pasto das Novilhas, machos para a Recria ou o arrendado; os vendidos no dia, desmamados sem pesar: 16 lançamentos, 270 bezerros); castração dos garrotes inteiros do marco zero em D0+30 (cirúrgica, com a visita de R$ 300,00 paga à veterinária e rateada) e dos machos desmamados que ficam na recria 30 dias depois (Burdizzo): 2 lançamentos, 41 animais; 5 ocorrências do curral (lesão, apartação, observação, descorna, ferra; 82 animais); pesagens coletivas de rotina na balança a cada 120 dias (D0+60 a D0+1020) nos pastos da recria, das novilhas e no arrendado, com o peso de cada animal pelo modelo determinístico de ganho (21 lançamentos, 1.237 pesagens); 6 entradas de estoque da vacina (as doses da campanha + 10, pagas em 30 dias) e 6 vacinações do rebanho inteiro pelo protocolo semestral (1.689 aplicações); 9 vermifugações da recria pelo protocolo dela, no dia seguinte a cada pesagem (1.211 aplicações); 240 vendidos (bois por arroba de carcaça com Funrural retido, vacas de descarte por arroba de peso vivo estimada, bezerros por kg vivo com comissão — uma venda corrigida —, novilhas por cabeça); 15 mortes, 5 descartes (um com receita), marcação para descarte e de não localizado, 1 baixa na contagem; ida e volta do pasto arrendado; uma entrada e uma transferência estornadas → 304 ativos. Sem carência nem aviso aceito em lançamento nenhum. `geracaoDemo(d0)` simula o rebanho dia a dia (entradas, movimentos e saídas de cada dia, na ordem da gravação) e só planeja o que a linha do tempo aceita; devolve `{d0, comandos: [{n, nome, rota, dados, criados?, mae?, crias?}], animais: {chave: {brinco} \| {mae, data_nascimento, sexo}}, totais: {d0, nascimentos, partos, natimortos, compras, vendas, mortes, descartes, divergencias, ativos}, comandos_por_tipo, lotes, total_ativos}` (410 comandos). Os `dados` referem animais, pastos, parceiros, eventos, produtos, protocolos e estações por marcadores (`'@a:<chave>'`, `'@p:<i>'`, `'@f:<papel>'`, `'@e:<n>'`, `'@m:<nome>'`, `'@s:<i>'`), resolvidos ao gravar: o animal pela memória da execução ou pela base (brinco de origem; a cria pela mãe, data e sexo, em `animal.listar`), o evento por `operacao.status('seed:<n>')`. Um passo por comando, chave `seed:<n>` (reexecutar devolve o duplicado e não grava), cursor no passo; no fim, a conferência: `inventario.posicao` = 304, saídas no cadastro (VENDIDO 240, MORTO 15, DESCARTADO 5, BAIXADO_AJUSTE 1), `sistema.integridade` sem erro e os números da Fase 3 lidos do servidor e conferidos com a faixa do plano (`manejoDemo_`: GMD do rebanho entre 0,3 e 0,8 kg/dia; prenhez de cada estação entre 70% e 98%; parição, natalidade e desmama calculadas nas estações encerradas; cobertura de cada protocolo de pelo menos 80%) — número fora da faixa derruba a conferência como um comando recusado. Relatório `{plano: 'DEMO', completo, ok, demonstracao: {cabecas, por_pasto, saidas, totais, comandos, comandos_por_tipo, integridade, fora_desta_fase: [{item, fase}], manejo: {gmd: {valor, n}, estacoes: [{nome, expostas, diagnosticadas, prenhez, paricao, natalidade, desmama, parcial}], protocolos: [{nome, elegiveis, em_dia, cobertura}]}}, faixa}` (`fora_desta_fase`: rateios e parcelas em todos os estados, Fase 4). Comando recusado para o seed: `{completo: false, ok: false, proximo, falha}` (cursor fica no passo). Na conta do dono, com o tempo real do Sheets, a base completa leva várias chamadas (cada uma pausa perto de 4 minutos e retoma do passo) |
| `runDiagnostics({usuario, linhas?})` | Itens SP-01 a SP-10 e RUNTIME `{id, titulo, situacao: OK \| FALHOU \| ALERTA \| NAO_SE_APLICA, medidas, observacao}`: corpus nas três formas + coerção Geral (formato do fixture) + atomicidade; sonda do Drive + abertura pelo SpreadsheetApp; lock; e-mail ativo; tempos com `linhas` (padrão 10.000) em EVENTO_ANIMAIS + custo de ler as propriedades; gatilhos; fuso do V8. Planilhas temporárias na pasta Testes (lixeira no fim); sem e-mail nem ID de arquivo no relatório; JSON também na pasta Testes |
| `paginaConcorrencia()` | HTML autocontido (CT-10, passo 6): 5 gravações com chaves diferentes + 2 com a mesma chave, em paralelo, na base de TESTE; confere 7 respostas boas, 1 duplicada e 6 eventos com `event_seq` distintos |
| `CENARIOS`, `SITUACAO`, `LIMITE_MS`, `geracaoDemo(d0)` | Constantes e o gerador determinístico |

Testes: `tests/api.test.js` (envelope, guarda, roteador, avisos, duplicado, LOCKED, carga condicional, ambiente TESTE,
rascunho, fuso, páginas) e `tests/acceptance.test.js` (os mesmos cenários no fake, nas duas ordens de carga; projeção =
reconstrução na base de teste no fim; retomada; falha reportada e conta errada do servidor que derruba os cenários; DEMO
completa, idempotente e retomável depois de um comando recusado, com os manejos da Fase 3 conferidos na base e os números
do relatório iguais aos das rotas, e um GMD fora da faixa que derruba a conferência; diagnóstico). Aceitação da Fase 3:
`tests/jornada.fase3.test.js` (um ano de manejo só pela `api()`: cadastros de insumos, protocolos e estações; o rebanho
do marco zero com as crias ao pé; entradas e perda de estoque, vacinações e vermifugações pelo protocolo — uma corrigida, uma
estornada —, pesagens periódicas — uma corrigida, uma variação brusca recusada sem gravar —, pesagem por lote, desmama com
destino e peso, castração com a despesa paga, ocorrências, exposição, diagnóstico corrigido, aborto, partos com gêmeos e
natimorto, tratamento com carência que barra o abate, pesagem importada, venda e inseminação com sêmen de fora; no fim, o
inventário por pasto em várias datas, o peso e o GMD de cada animal da recria, os indicadores da estação, a agenda e a
cobertura, o estoque, o custo sanitário por conta e o da ficha contra um modelo independente, a trilha e a integridade sem
erro; projeção = reconstrução e invariantes depois de cada comando) e `tests/regras.fase3.test.js` (o mapa RN → teste
verificável das seções 2.7 a 2.9 de 05 e do algoritmo 4.7 — cada teste citado existe; as RN que o mapa da Fase 2 deixou
para a Fase 3 têm lugar; os casos de 09, seção 4.1, têm o passo no cenário do `TestRunner` e o teste do nível 1 — e os
testes das RN sem caso próprio: RN-051 em todo caminho, RN-053, RN-058 pelos quatro critérios e RN-065 com a situação vinda
dos registros da Fase 3). Aceitação da Fase 2:
`tests/jornada.fase2.test.js` (a jornada de um ano só pela `api()`: rebanho importado, compras, partos, transferências,
vendas, mortes, correções e estornos, histórico importado com reconciliação; inventário em 11 datas contra um modelo
independente, a pagar e a receber, ficha, trilha e integridade; projeção = reconstrução e invariantes depois de cada
comando) e `tests/regras.fase2.test.js` (o mapa RN → teste verificável — toda RN de 05 na Fase 2 com os testes que a
exercitam, no mapa da Fase 1 ou nas fases seguintes com o motivo; cada teste citado existe — e os testes das RN da Fase 2
sem caso próprio: 006, 037, 049, 065, 071, 075 e 094 na importação de nascimentos). Revisão adversarial da Fase 1: `tests/jornada.fase1.test.js` (a jornada inteira só pela `api()`: setup,
cadastros com pasto arrendado, importação de 120 animais com mãe e pai, correções, estorno, substituição, backup,
adulteração acusada pela integridade, restauração e, no fim, projeção = reconstrução, inventário por pasto igual em
todas as consultas e auditoria completa) e `tests/regras.fase1.test.js` (as regras RN da Fase 1 sem teste próprio, com
o mapa RN → teste no cabeçalho).

## 22. Interface: núcleo e componentes (E1.9, parte 1) — `Index`, `Styles`, `JavaScript`, `Components`, `Dashboard`

SPA no HtmlService, sem biblioteca externa nem CDN (seção 17 do desenho-base). Tudo é montado por nós DOM (`Util.h`), nunca
por `innerHTML`; nenhuma tela chama `google.script.run` (só o `Cliente`); `localStorage` só pelo `Util.armazem` — regras
conferidas por `tests/interface.test.js`. Nada roda na carga: `App.iniciar()` é chamado no fim do `Index`.

**Página.** `Index.html` inclui, em ordem, `Styles`, `JavaScript`, `Components`, `Dashboard` e o boot. **As telas da parte 2
entram como novos includes entre `Dashboard` e o `<script>` do boot** (o arquivo precisa estar em `Api.INCLUDES`) e
registram suas rotas na carga com `Telas.registrar` (o `JavaScript` já foi carregado). As telas sob demanda (seção 37: a importação e as das Fases 3 a 5) não entram no `Index`: chegam pela rota `sistema.tela` e registram as rotas do mesmo jeito. `#app` traz `data-app-version`,
`data-ambiente` e `data-url-app`. Estrutura: `#topo`, `#faixas`, `#menu` (lateral, ≥ 900 px), `#conteudo` (a tela),
`#barra` (inferior, < 900 px), `#camada` (folhas e modais), `#avisos` (`aria-live=polite`).

**Telas e rotas** (`JavaScript.html`):

| Membro | Contrato |
|---|---|
| `Telas.existe(rota)` | A rota abre uma tela: registrada, ou de um módulo sob demanda ainda não carregado (`Modulos.daRota`). Depois de carregado, só valem as rotas que a tela registrou |
| `Modulos.daRota(rota)`, `carregado(tela)`, `carregar(tela)`, `sobDemanda()`, `partes(html)` | Telas sob demanda (seção 37): o módulo entregue e `sob_demanda` do bootstrap dono da raiz da rota; `carregar` pede `sistema.tela` (pedidos simultâneos da mesma tela viram um), separa o conteúdo em `<style>` e `<script>` (`partes`, por expressão regular: nada de innerHTML), injeta cada um como nó (`style.textContent`, `script.text`, com `data-modulo`) e guarda em memória (não pede de novo nesta página). Resolve `true` (veio agora) ou `false` (já estava). Erros (`Cliente.ErroApi`): os do `Cliente.consulta` (TRANSPORTE, SEM_RESPOSTA, NOT_FOUND…); `NOVA_VERSAO` com `recarregar: true` quando `meta.appVersion` do servidor difere da página (a tela nova não é injetada na página antiga); `INTERNAL` quando o script da tela falha ao rodar (o evento `error` da janela, na mesma hora) ou não há script |
| `Telas.registrar(padrao, def)` | `padrao` com parâmetros (`'animal/:id/:aba?'`); `def = {titulo, modulo (id do servidor: a tela só abre com o módulo ativo), telaCheia (celular sem barra inferior), montar(el, params) → função de limpeza opcional}`. Registrar de novo o mesmo padrão substitui. A tela deve ter um `h1` (o foco vai para ele na troca de rota) |
| `Roteador.ir(rota, {substituir, forcar})`, `voltar(padrao)`, `atual()`, `href(rota)`, `modo()` | Rota = `tela/ID opaco`, nunca dado (§17). Modo `GAS` (`google.script.history`/`url`, NV), `HASH` ou `MEMORIA`. Links internos: `<a href="#/x" data-rota="x">` (o clique é tratado pelo App) |
| App e telas sob demanda | A rota sem tela registrada de um módulo sob demanda abre o esqueleto ("Abrindo Importação…", `data-tela-sob-demanda`), carrega a tela (`Modulos.carregar`) e abre a rota de novo quando ela chega (se o usuário não foi para outra rota no meio: cada `renderizarRota_` é uma vez, e a resposta de uma vez antiga só guarda a tela). Falha: h1 "Não foi possível abrir <módulo>" e o estado de erro com "Tentar de novo" (ou "Recarregar a página" no `NOVA_VERSAO`; título "Nova versão do app" em `UI.TITULOS_ERRO`). O menu mostra o módulo sob demanda antes de a tela vir (`Telas.existe`) |
| `App.MENU` | Os 10 itens da §15 com rota: `inicio`, `rebanho`, `pastos`, `eventos`, `pesagens`, `sanidade/agenda`, `reproducao/matrizes`, `financeiro/lancamentos`, `relatorios`, `config/parametros`. Item aparece só com módulo ativo no bootstrap **e** tela registrada. Barra inferior: Início · Rebanho · Registrar · Pastos · Mais (itens 4 a 10). A busca por brinco do topo aparece quando existir a rota `animal/:id/:aba?` (ela abre `animal/<id>/resumo`) |
| `App.faixa(id, {tipo: info\|aviso\|erro\|ok\|teste, texto, acoes: [{texto, aoClicar \| href, alvo}]})`, `removerFaixa(id)` | Faixas fixas. Ids usados: `base-teste`, `nova-versao`, `importacao`, `sem-conexao`, `rascunho-<TIPO>`, `envio-<TIPO>`, `rascunho-falhou` |
| `App.acaoRecarregar(texto)`, `App.recasca()`, `App.rotaInicial()`, `App.podeRegistrar()` | Recarregar = link `target=_top` para `urlApp` (senão recarrega o quadro); `recasca` redesenha menu, barra e faixas do sistema |

**Dados** (`JavaScript.html`):

| Membro | Contrato |
|---|---|
| `Cliente.consulta(rota, dados, {aoEstado, semPrazo})` | Promise `{data, meta}`. `LOCKED` → novas tentativas em 2, 5 e 10 s (`aoEstado({estado: 'OCUPADO', tentativa, de})`); 45 s sem resposta → `ErroApi SEM_RESPOSTA`; falha de transporte → `ErroApi TRANSPORTE` (`repetida` depois de 3 seguidas: tratar como sessão expirada, "Entrar de novo") |
| `Cliente.comando(rota, dados, {chave, avisosAceitos, dataVersionEsperada, aoEstado})` | Promise `{data, meta, duplicado, verificado}`. Chave obrigatória (o formulário a guarda até o sucesso). `LOCKED` como acima, com a MESMA chave; esgotado → `ErroApi LOCKED` com `esgotado`. 45 s sem resposta → `Cliente.verificar` (`operacao.status`) → `CONFIRMADA`/`FALHOU`/`INEXISTENTE` reenviam com a mesma chave (`verificado: true`); `EM_ANDAMENTO` consulta de novo a cada 5 s. Demais: `ErroApi {code, message, details, meta}` com os códigos do servidor (`NEEDS_CONFIRMATION` traz os avisos em `details`) |
| `Cliente.ErroApi`, `Cliente.MSG` | Códigos só do cliente: `TRANSPORTE`, `SEM_RESPOSTA`. `meta.appVersion` diferente da página → faixa "Nova versão disponível"; `meta.serverTime` acerta o relógio do "hoje" |
| `Store.carregar({forcar})` | Carga condicional: envia a `dataVersion` da carga guardada (memória ou `localStorage`, por ambiente e versão do app); `{atual: true}` → usa a guardada. `{fonte: SERVIDOR \| GUARDADA}` |
| `Store.aplicarResultado(rota, data, meta)` | Depois de TODO comando: versão igual → nada; local + 1 e rota com delta (`animal.editar` sem evento, `animal.cadastrarExterno`, `pasto.salvar`, `propriedade.salvar` com padrão já definido, `lista.salvar`, `parceiro.salvar`) → delta; senão nova carga. `{aplicado: NADA \| DELTA \| CARGA}` |
| Leitura | `param(chave)`, `lista(nome)` (ativos, por ordem), `rotuloLista`, `pastos({todos})`, `pasto(id)`, `propriedades({todas})`, `propriedade`, `parceiros`, `categorias`, `categoria`, `produtos({todos})`, `produto(id)`, `protocolos({todos})`, `protocolo(id)` (Fase 3), `animais()` (ATIVOS + EXTERNOS, linhas leves de `AnimalService.COLUNAS_LEVE`), `animal(id)`, `filhosDe`, `modulos`, `modulo(id)`, `catalogo()`, `tipoEvento(tipo)`, `alertas()`, `ambiente()`, `atualizadoEm()`, `assinar(fn)` |
| Busca | `resolverBrinco(texto, filtro)` → `{modo: EXATO \| SEM_ZEROS \| VARIOS \| NENHUM, candidatos}` (exato → sem zeros à esquerda conforme `brinco_ignora_zeros_esquerda` → lista); `buscar(texto, filtro)` também por código interno (`A-000123` ou `123`), nome e "crias da <brinco da mãe>" (`modo: CRIAS`); `carregarBaixados()` (`animal.listar`, guardado até a próxima carga), `baixados()`; `rotuloAnimal(a)` ("A-000123 · cria da 0231 · 12/09/2026" sem brinco), `descricaoAnimal(a)`, `normalizarBrinco(t, manterZeros)` (= `Utils.normalizarBrinco`) |
| `Rascunhos.iniciar/listar/obter/salvar(id, r, {imediato})/remover/modo()` | `localStorage` (`erp:<ambiente>:rascunho:<id>` + índice) quando responde; senão o servidor (`rascunho.salvar/obter/remover`, chaves `r.<id>` e `indice`, agrupado em 1 s e descarregado ao sair da página). Formulário de evento usa `id = evento.<TIPO>`. Revisão 3: `descarregar()` envia o pendente depois do envio em curso e só resolve com a confirmação do servidor; `situacao(id)` → `{estado: PENDENTE \| GUARDADO \| FALHOU, erro}`; `aoFalhar(fn)` avisa a falha do envio adiado (o formulário põe a faixa `rascunho-falhou`; ao sair, "guardado no servidor" só depois da confirmação, senão o aviso de que não foi guardado); sem conexão no modo servidor, a mensagem é `TRANSPORTE_SEM_ARMAZEM` (o que foi digitado só está na tela) |
| `Fmt` | `hoje()` (yyyy-MM-dd no fuso da fazenda = `CONFIGURACOES.fuso`, relógio corrigido pelo servidor), `data`, `dataCurta`, `instante(ISO)`, `numero(n, casas)`, `peso(kg)` (respeita `unidade_peso_exibicao`), `dinheiro(centavos)`, `idade(meses, estimada)`, `rotulo(dominio, codigo)`, `rotuloOpcao(campo, codigo)`, `lerDecimal(t, casas)`, `lerDinheiro(t)` → centavos, `lerInteiro(t)`, `ehData`, `diasEntre` |

**Componentes** (`Components.html`):

| Membro | Contrato |
|---|---|
| `UI.botao(texto, {tipo: primario\|secundario\|perigo\|texto, icone, aoClicar, rotulo, bloco})`, `UI.travar(b, texto)` | 48 px mínimos; `travar` impede o duplo clique e devolve a função que destrava |
| `UI.folha({titulo, conteudo, acoes, origem, aoFechar, modal})` | Folha (celular: de baixo; desktop: à direita) ou modal: `role=dialog`, `aria-modal`, foco preso, Esc fecha, fundo `inert`, foco volta a `origem`. `aoFechar` devolvendo `false` impede. `{el, corpo, fechar({forcar}), definirAcoes, definirConteudo}` |
| `UI.confirmar({titulo, texto, verbo, cancelar, perigo})` | Promise booleana; o botão repete o verbo (operação crítica) |
| `UI.aviso(texto, {tipo})`, `UI.faixa`, `UI.nota(texto, tipo)`, `UI.carregando(texto)`, `UI.vazio({texto, acao})`, `UI.estadoErro(erro, {acao, detalhe})` | Estados de 08 (seção 8): sempre ícone e texto; erro com título pelo código e detalhe técnico expansível |
| `UI.tabela({rotulo, colunas: [{id, rotulo, valor(l), formatar(l), num, ordenavel}], linhas, chave(l), porPagina, cartao(l), ordem, selecao: {aoMudar(ids)}, vazio})` | Ordenável (cabeçalho com `aria-sort`), paginada (`itens_por_pagina`), cartões abaixo de 900 px com ordenação por seletor; seleção com "Selecionar os N filtrados". `{el, atualizar(linhas), selecionados()}` |
| `UI.grafico({tipo: linha\|barras\|empilhadas, titulo, series: [{nome, pontos: [{x, y, nota}]}], formatar, rotuloX, rotuloValor, ...})` | SVG próprio + tabela equivalente ("Ver tabela"); `y = null` é buraco; linha com < 2 pontos não é desenhada ("dados insuficientes"). Contrato completo na seção 41 (Fase 3, E3.7) |
| `Campos.criar(def, {valor, aoMudar, idBase, rotulos, aoNovo})` | Um campo do catálogo (todos os `TIPOS_CAMPO` + `ref:TABELA`): rótulo sempre visível, ajuda, unidade, erro sob o campo; `lista`/`bool` com até 3 opções viram botões; `ref:PASTOS`/`ref:PARCEIROS` com "+ Novo" (miniformulário que grava e seleciona); `ref:ANIMAIS` com a resolução de brinco; `anexo` lê o arquivo (imagem reduzida a ~300 KB + miniatura ~15 KB) em `{nome_arquivo, mime_type, tamanho_bytes, conteudo_base64, miniatura_base64}` |
| `Campos.converter(def, bruto)` | Bruto → valor do contrato ou `{erro}`: dinheiro em centavos (min/max em reais), decimal com `casas`, data yyyy-MM-dd, `outras_identificacoes` → `[{tipo, codigo}]`; `min_exclusivo: true` recusa o próprio mínimo ("maior que 0"), espelhando `minExclusivo` do esquema (formulários de pasto, propriedade e categoria) |
| `Formulario.bloco(defs, valores, o)` / `Formulario.converterValores(defs, valores, contexto)` | Campos com `visivel_se`, `obrigatorio_se` e `default` (`HOJE`, literal, `{de: 'CONFIGURACOES.chave'}`); oculto não vai ao servidor; vazio visível vai `null` |
| `Seletor.criar({modo: UM\|VARIOS, filtro (filtro_elegiveis), tipo, selecionados, aoMudar, dataEvento, valorCampo})` | Busca, filtros, todos do pasto (data ≠ hoje → `inventario.elegiveis` `{tipo, data, pasture_id}`, rótulo "Posição em …"; animal que estava no pasto na data e já saiu aparece pelo código), colar lista (achados, não encontrados, repetidos). Inelegíveis só pré-marcados (situação, pasto e `sexo` do filtro). Com data ≠ hoje e filtro de animal no rebanho, a presença e o pasto de Busca, Filtros e Colar vêm da posição na data (`inventario.elegiveis` `{tipo, data}`, sem pasto: "Não elegível: fora do pasto de origem em dd/mm/aaaa", "fora do rebanho em …"); sem conexão, aviso e a posição de hoje (o servidor confere na gravação). Devolve também `dataMudou()`: a mudança de `event_date` refaz a consulta e remarca os escolhidos (marca, não tira) |
| `Seletor.criar`: a data e as respostas (Fase 3, etapa BASE) | A posição na data é uma consulta por (tipo, data, versão), guardada como promessa (duas chamadas viram um pedido; a que falhou sai para tentar de novo), e a resposta de uma data que já mudou é descartada (a da data nova é pedida). Cada desenho do painel do modo é uma vez: a resposta de "Incluir todos", da busca, da lista colada ou dos filtros que chega depois de o painel ser redesenhado, ou de a data mudar, não entra na lista nem na tela. `dataMudou()` redesenha o painel só se ele foi desenhado noutra data (o painel aberto já na data nova não é apagado pela resposta que chega depois) |
| `Registro.abrir(tipo, {subtipo, campos, linhas: [{animal_id, valores}], rotulos: {event_id: texto}, origem})` | Atalho com pré-preenchimento (ficha, pasto, listagem, "Desfazer"); pergunta antes de apagar um rascunho do mesmo tipo. Rascunho ou sessão do tipo em ENVIANDO (envio sem resposta): consulta `operacao.status` antes de qualquer outra coisa (08, seção 9) — CONFIRMADA → o resultado do envio anterior e aviso "já estava gravado", sem abrir o novo; sem resposta → aviso "ainda não sabemos se gravou" e o rascunho mantido; FALHOU ou INEXISTENTE → a pergunta diz que o servidor confirmou que não gravou. Devolve `true` só quando abriu o formulário novo |
| Rotas `evento/novo` e `evento/novo/:tipo/:etapa?` (`revisao`, `resultado`) | Seletor de tipo (grupos de `grupo_ui`, sem ESTORNO) → formulário (data → animais → campos → grupos → observações; Enter percorre) → revisão LOCAL ou SERVIDOR (`evento.simular`; o commit leva `dataVersionEsperada`) → resultado (coletivo ou crítico) ou aviso + volta à origem. Pedido: o de `EventService` (seção 14); grupos repetíveis vão em `dados.<grupo>`. Erros por animal ligados à linha por `animal_id`, brinco ou "Animal N da lista" |
| `Registro.conferirPendentes()` | Na abertura: rascunho `ENVIANDO` → `operacao.status` antes de tudo (CONFIRMADA → resultado; senão volta a editar com faixa "não foi gravado"); `EDITANDO` → faixa "… — registro não concluído (N animais) · Continuar · Descartar" |
| Tela `inicio` (`Dashboard.html`, `TelaInicio`) | Fase 1: cabeças, sexo, pastos, pendências (alertas do bootstrap), rascunhos e gráficos por pasto e categoria, tudo do store |

Testes: `tests/interface.test.js` (Node: página do doGet, sintaxe, contraste, CSS, regras estáticas, contratos com o
catálogo e com as mensagens do servidor) e `tests/ui/interface.test.js` (Playwright, por `npm run ui:check`; apoio em
`tests/ui/apoio.js` — `sistema`, `semear`, `abrir(s, {largura, historico, semLocalStorage, params, telasDeTeste, relogio,
fuso, hash})`, `esperarTela`, `ir`, `semRolagemHorizontal`, `alvosDeToque`, `focoVisivel` — e mock em `tests/ui/mock-gas.js`,
com `window.__gas = {atrasoMs, atrasar(pedido) → ms, emCurso, perder, falharTransporte, pedidos, violacoes}`; Fase 3, etapa BASE:
`atrasar` força a ordem das respostas e `A.esperarServidor(page)` espera `emCurso = 0`, o estado, nunca um tempo fixo).

**Acréscimos da parte 2 ao núcleo e aos componentes** (usados pelas telas da seção 23; os contratos acima continuam):
`Telas.resolver` dá preferência ao padrão literal sobre o padrão com parâmetro, em qualquer ordem de registro
(`evento/novo` antes de `evento/:id`, `config/parametros` de teste antes de `config/:secao`). `Fmt.ROTULOS` ganhou
`TIPO_PARCEIRO`, `POSSE`, `STATUS`, `SEXO_APLICAVEL`, `CONDICAO`, `TIPO_ANEXO`, `POLITICA_AVISO`, `STATUS_EVENTO`,
`STATUS_IMPORTACAO`, `STATUS_LINHA`, `GRUPO_CONFIG`, `PAPEL`, `MOTIVO` (motivo do "—", P9) e `FONTE`.

| Membro | Contrato |
|---|---|
| `UI.abas(rotulo, [{rotulo, rota, atual}])` | Abas como links de rota (cada aba é entrada de histórico; `aria-current="page"`) |
| `UI.valorInd(ind, formatar)` → `{texto, motivo}` | Indicador `{valor, motivo, n, estimado}` (P9): `valor` nulo → `"—"` e o motivo em palavras com o `n`; estimado ganha "(estimado)" |
| `UI.indicador(rotulo, valor, nota, dado)`, `UI.pares([[rótulo, valor]], classe)`, `UI.secao(titulo, conteudo, {dado, classe})` | Cartão de indicador (`data-indicador`), lista de definição (vazio → "—") e seção com h2 (`data-secao`) |
| `UI.tabela` | Novos: opção `semPaginacao` (paginação feita no servidor), `ordenadas()` (todas as linhas na ordem da tela, para exportar igual ao que se vê), `limparSelecao()` |
| `Exportar.celula(v)`, `Exportar.csv(colunas [{rotulo, valor(l)}], linhas, {preambulo})`, `Exportar.baixar(nome, texto, mime)`, `Exportar.nome(base)` | CSV no aparelho: BOM, `;`, CRLF; saneamento contra fórmula só aqui (começa com `= + - @`, tabulação ou retorno e não é número → apóstrofo); `;`, aspas e quebra → entre aspas. `baixar` entrega por link `download` (sem ida ao servidor). Nome `base-yyyy-MM-dd.csv` |
| `Cadastro.envio({rota, botao, rotuloBotao, status, bloco, aoSucesso(r)})` → `{enviar(dados), chave()}` | Comando sem evento com chave guardada até o sucesso; NEEDS_CONFIRMATION → avisos com "Vi e confirmo" e reenvio com os códigos; VALIDATION → campos do bloco (o resto em lista); depois do sucesso, `Store.aplicarResultado` + `App.recasca` |
| `Cadastro.folha({titulo, defs, valores, rota, montar(conv, brutos) → dados \| null, validar(conv, brutos) → [{campo, mensagem}], verbo, perigo, sucesso(data) → texto, aoSalvar(r), extra, aoMudar(id, brutos, bloco), novoFixos, origem, idBase})` | Formulário de cadastro numa folha (`data-cadastro=<rota>`, botão principal `data-acao-principal`); `montar` devolvendo `null` não envia |
| `Campos.criar(def, {novoFixos})`, `Formulario.bloco(defs, valores, {novoFixos: {campo: fixos}})` | "+ Novo" com valores fixos que saem da tela (ex.: arrendador nasce com `tipos: ['ARRENDADOR']`). O miniformulário de parceiro pede "O que ele é" (o servidor exige `tipos`) |
| `Registro.abrir(tipo, {corrige: {event_id, rotulo, antes: {campos, linhas: {animal_id: valores}}}, campos, linhas: [{animal_id, criado, valores}], origem})` | Correção (evento substituto do mesmo tipo): rota `evento.corrigir`, revisão sempre pelo servidor (`evento.simular` com `acao: 'corrigir'`), campo "Por que corrigir" (`dados.justificativa`, obrigatório) e a folha com a diferença para o original (`data-diferencas`). Linha `criado` = animal criado pelo original: todos os campos de animal novo, com o `animal_id` reaproveitado; tirar a linha anula o cadastro |

## 23. Telas da Fase 1 (E1.9 parte 2, E1.8 e E1.10 na tela) — `Dashboard`, `Animals`, `Pastures`, `Events`, `Settings`, `Import`

Cada arquivo registra as suas rotas na carga (`Telas.registrar`) e entra no `Index` entre `Dashboard` e o boot. Nada de
dado na rota (§17): filtros e escolhas ficam na memória da tela. Tudo o que aparece vem de `api()` (carga inicial do
store ou consulta da tela); nenhum botão sem função (atalho de evento só aparece se o tipo está no catálogo).

| Tela (namespace) | Rotas | Consultas e comandos | Membros para outras telas |
|---|---|---|---|
| Início (`TelaInicio`) | `inicio` | `dashboard.obter` + `alerta.listar` (guardados por `dataVersion`; "Atualizar" pede de novo); rascunhos | `carregar(forcar)`. Cada alerta com a sua ação (`ACOES`): sem pasto, sem brinco e sem categoria abrem o rebanho filtrado; backup e integridade, `config/sistema`; importação incompleta, `importar/<id>`. `data-gerado-em` = "Dados de dd/mm/aaaa hh:mm" (`geradoEm` no fuso da fazenda); indicadores `data-indicador` cabecas, machos, femeas, sem-pasto, peso, ua (o período, o peso médio, o movimento e as séries: seção 33) |
| Rebanho (`TelaRebanho`) | `rebanho`, `animal/:id/:aba?` (abas `resumo`, `genealogia`, `pastos`, `peso`, `sanidade`, `reproducao`, `financeiro`, `eventos`, `anexos`) | store (+ `animal.listar` ao filtrar baixados), `animal.ficha` (guardada por `dataVersion`), `animal.editar`, `animal.cadastrarExterno`, `anexo.adicionar`/`obter`/`remover` | `filtrar(animais, f, {cortes, ignoraZeros})` (puro; `f` = {texto, pasto (id ou `__SEM__`), sexo, categoria (id ou `__SEM__`), situacao (código, `SAIRAM` ou vazio = todas), faixa, atalho (SEM_PASTO, SEM_BRINCO, SEM_CATEGORIA)}), `faixas(cortes)` (0–12, 12–24, 24–36, 36+ e `__SEM__`), `COLUNAS` (as 10 da §5: `texto(a)` = tela = CSV), `linhasCsv(linhas)`, `abrirCom(filtros)`, `editar(ficha, origem)`, `ficha(id, forcar)` |
| Pastos (`TelaPastos`) | `pastos`, `pasto/:id` | store (cartões de hoje), `pasto.listar` com a data (lista em data passada), `pasto.painel` (com "Posição em", a partir do marco zero), `pasto.salvar` | `formulario(pasto \| null, origem, aoSalvar)`; `posse = PROPRIO` limpa o arrendador; `valor` e `motivoSemDado` (seção 35) |
| Eventos (`TelaEventos`) | `eventos`, `evento/:id` | `evento.listar` (paginado no servidor), `evento.obter`; estorno e correção pelo `Registro` | `previaCorrecao(eventoObter)` → previa do `Registro.abrir` (entradas: ENTRADA_INICIAL e OUTRA_ENTRADA); `situacao(evento)` |
| Configurações (`TelaConfig`) | `config/:secao` (`parametros`, `listas`, `categorias`, `propriedades`, `parceiros`, `sistema`, `auditoria`) | `config.salvar` (só as chaves que mudaram), `lista.salvar`, `categoria.salvar`, `propriedade.salvar`, `parceiro.salvar`, `sistema.estado`, `sistema.backup`, `sistema.restaurarBackup` (escolha na lista de backups, consequência descrita, palavra RESTAURAR e justificativa), `sistema.integridade` (e o reparo), `sistema.diagnostico`, `auditoria.listar` | `valorParam(item, bruto)` (faixas etárias "12, 24, 36" → `[12, 24, 36]`), `ROTULOS` dos 45 parâmetros |
| Importação (`TelaImportacao`) | `importar`, `importar/novo`, `importar/:id/:etapa?` (`mapeamento`, `validacao`, `confirmacao`, `execucao`); a etapa errada para o estado é corrigida pela tela | `importacao.modelo`, `criar`, `previa`, `validarBloco` (um pedido por bloco, chave nova por rodada), `obter`, `linhas`, `importarBloco` (bloco 1 com `modo`/`aprovacao`/`property_id`/`ignorar_linhas`), `concluir`, `relatorio`, `desfazer`, `listar`, `reconciliacao` | `etapaDoStatus(status)`, `planoConfirmacao`, `valorLido` (seção 35). O tipo escolhido traz o modelo dele (`importacao.modelo` com `tipo`: colunas, confianças, valores padrão, agrupamento); o relatório final mostra a reconciliação (seção `reconciliacao`: divergências por animal, por pasto e brincos sem animal). Com reprovadas, "Importar" só habilita com a caixa "importar só as N válidas e ignorar M" (PARCIAL_APROVADO com a aprovação igual aos números da validação); IMPORTANDO → Retomar · Desfazer |

Testes: `tests/telas.test.js` (Node: rotas novas, exportação, filtros, parâmetros e o pré-preenchimento da correção
aceito pelo servidor) e `tests/ui/telas.test.js` (Playwright, a 1280 e a 360 px: cadastrar pela entrada inicial e ver
na lista e na ficha; editar campo sensível; importar 30 linhas com 2 erros e 1 duplicata; estornar e corrigir;
exportar e conferir contra a tela; pastos, configurações e sistema a 360 px).

## 24. `ReproductionService` (puro: partos e histórico reprodutivo da matriz, Fase 2)

Um parto = um NASCIMENTO = uma linha REPRODUCAO PARTO (DV-15). Recebe `f = Timeline.fonte(tx, ...)` (respeita os eventos
excluídos da fonte: validação de estorno e de substituição). Exposição, cobertura, IA, diagnóstico, aborto, desmama, os
indicadores por estação e o bloco G inteiro entraram na Fase 3 (E3.4 e E3.5): seção 40, que substitui a linha
`blocoFicha` abaixo.

| Função | Contrato |
|---|---|
| `partos(f, matrizId)` | Partos vigentes, do mais antigo ao mais recente (data, posição na cadeia de substituição `ordem_seq`, `event_seq`; desenho-base 16.1): `[{reproduction_id, event_id, event_seq, ordem_seq, data, nascidos_vivos, natimortos, tipo_parto, pai_id, pre_marco_zero}]` |
| `contarPartos(partosPrevios, partos, dataEntrada)` | Número de partos: `max(partos_previos declarados, partos registrados antes da entrada) + partos registrados da entrada em diante` (o declarado e o registrado antes da entrada descrevem o mesmo passado). `dataEntrada` = a PRIMEIRA entrada vigente no sistema (marco zero no rebanho inicial): uma volta ao rebanho não transforma os partos já registrados em "anteriores" |
| `avisosParto(params, {data_nascimento}, data, outrosPartos)` | `[{codigo, mensagem}]` sem o "quem": `IDADE_REPRODUTIVA` (meses completos < `idade_min_reprodutiva_meses`), `INTERVALO_PARTO_CURTO` (outro parto a menos de `dias_gestacao` dias, antes, depois ou no mesmo dia) |
| `historico(f, animal)` | `{partos: [{event_id, data, nascidos_vivos, natimortos, gemelar, tipo_parto, pai_id, pre_marco_zero, intervalo_dias, crias: [{animal_id, codigo_interno, brinco, sexo, situacao_cadastral}]}], partos_previos, partos_registrados, n_partos, ultimo_parto, crias_nascidas_vivas, natimortos, intervalo_medio_dias: {valor, motivo, n}}` |
| `blocoFicha(f, animal)` | Bloco G da ficha: `{entregue: true, parcial: true, aplica (fêmea), pendente: {modulo: 'REPRODUCAO', fase: 3, mensagem}, situacao_reprodutiva, cria_ao_pe}` + o `historico` (fêmea) ou `{mensagem, partos: []}` (macho) |

## 25. Telas da Fase 2, etapa de movimentos e saídas — `Components`, `Events`, `Animals`, `JavaScript`

| Peça | O que existe |
|---|---|
| Seletor de tipo | Só os tipos ativos do catálogo: "Mais usados" (nascimento, transferência, morte) e os grupos (Movimentação, Reprodução, Correções) |
| `Registro` (formulário) | Grupos repetíveis: `crias` começa com uma linha, "+ Outra cria (gêmeos)"; linha do grupo leva `animal_id` na correção (`dados.crias[i].animal_id`); erro do servidor "Cria N: …" volta para a linha N do grupo. Revisão LOCAL com o resumo do tipo (crias vivas e natimortas, pasto das crias; "Pasto A → Pasto B"; consequência da saída); verbos "Gravar o parto", "Transferir", "Registrar a morte", "Registrar o descarte" (botão de perigo nos críticos); resultado persistente ("Parto gravado: 1 cria entrou no rebanho.", "N animais transferidos.", "Morte registrada: …") |
| `Registro.abrir(tipo, {campos, linhas, grupos: {crias: [{animal_id?, valores}]}, corrige, origem})` | Pré-preenchimento também dos grupos repetíveis; a correção compara as crias pela `animal_id` (`antes.grupos`) |
| `TelaEventos` | Corrigir também NASCIMENTO, TRANSFERENCIA, MORTE e DESCARTE (`previaCorrecao`: cabeçalho do evento, pastos da linha, BAIXAS, REPRODUCAO e payload; crias como linhas do grupo); detalhe com "Saída do rebanho" (BAIXAS), "Parto" (REPRODUCAO) e GTA |
| `TelaRebanho` (ficha) | Atalhos "Registrar parto" (fêmea ativa, pelo `filtro_elegiveis`), "Transferir", "Registrar morte", "Descartar"; aba Pastos com o evento de entrada e de saída de cada período e "Dias em cada pasto"; aba Reprodução com situação, cria ao pé, nº de partos, partos (crias, intervalo) e o que chega na Fase 3 |
| `Fmt` | Rótulos `SITUACAO_NASCIMENTO` (VIVO, NATIMORTO) e `TIPO_BAIXA` |

## 26. `FinancialService` (puro: o financeiro de todo evento, Fase 2)

Monta, dentro do tratador de um comando, as linhas de FINANCEIRO, PARCELAS, RATEIOS e ALOCACOES_FINANCEIRAS (03b, seções
10 a 13); nada grava. Dinheiro em centavos inteiros; base de rateio na unidade do critério (R$ em DIRETO e
VALOR_INDIVIDUAL, kg em PESO_VIVO e PESO_CARCACA, 1 em CABECAS, peso relativo em MANUAL). Testes: `tests/financeiro.test.js`
(puro), `tests/compra.test.js` e `tests/venda.test.js` (comandos).

| Função | Contrato |
|---|---|
| `MODALIDADES`, `CRITERIOS_LOTE`, `SEM_RATEIO` | Constantes: CABECA, KG_VIVO, ARROBA, LOTE; os critérios aceitos no lote (CABECAS, PESO_VIVO, PESO_CARCACA, VALOR_INDIVIDUAL, MANUAL); as naturezas que nunca recebem rateio (ESTOQUE_INSUMOS, NAO_OPERACIONAL; invariante 14) |
| `CONTAS` | Códigos das contas do sistema: `COMPRA` (COMPRA_ANIMAIS), `FRETE_COMPRA` (FRETE_DESPESAS_COMPRA), `ABERTURA`, `RECEITA_DESCARTE` (OUTRAS_RECEITAS_OPERACIONAIS), `VENDA` (VENDA_ANIMAIS), `FRETE_VENDA`, `COMISSAO_VENDA`, `TAXAS_VENDA` (TAXAS_RETENCOES_VENDA), `INSUMOS` (COMPRA_INSUMOS, natureza ESTOQUE_INSUMOS: a compra de produto do cadastro, desde a E3.2) |
| `contaDeducao(tipo)` | Código da conta de uma dedução de venda pelo tipo de LISTAS.TIPO_DEDUCAO_VENDA: FRETE → FRETE_VENDA, COMISSAO → COMISSAO_VENDA, qualquer outro → TAXAS_RETENCOES_VENDA (03b, 2.6) |
| `totaisVenda({valor_bruto, desconto_comercial, deducoes: [{tipo, valor, retida}]})` | Puro, em centavos: `{valor_bruto, desconto_comercial, receita (bruto − desconto), frete, comissao, outras_deducoes (pelo tipo), deducoes, retidas, resultado_negociacao (receita − deduções), deposito_esperado (receita − retidas)}` (03b, 4.2; 07, 4.2) |
| `conta(repo, codigo)` | Linha do PLANO_CONTAS pelo código; ausente ou inativa → `CONFIG` |
| `dividirParcelas(total, n)` | Quociente para todas, sobra para as primeiras (9.400,00 em 3 → 3.133,34 + 3.133,33 + 3.133,33); total ou n que não sejam inteiros positivos → `INTERNAL` |
| `resolverParcelas(valor, parcelas, col, {campo, rotulo, prefixo, pagamento})` | `[{parcela_num, data_vencimento, valor, forma_pagamento, documento}]` ou null com erros no coletor: `SEM_PARCELAS`, `PARCELAS_DEMAIS` (`MAX_PARCELAS` = 120), `CAMPO_OBRIGATORIO`/`FORMATO_INVALIDO` (vencimento), `VALOR_FORA_DA_FAIXA`, `PARCELAS_NAO_SOMAM`. Valor vazio = divisão igual do que falta. Sem parcela, a mensagem concorda com o rótulo ("Informe como a compra será paga"; o padrão é "será pago" para rótulo masculino) |
| `ratear(valor, criterio, itens)` | Maior resto (`Utils.ratear`; desempate maior resto → maior base → menor `chave` = codigo_interno). `itens: [{animal_id, chave, base}]`; um item → DIRETO com base = valor do lançamento. `{criterio, baseTotal, totalAlocado, itens: [{animal_id, chave, base, valor}]}` |
| `planejar(tx, spec, col)` | Um lançamento completo. `spec: {evento: {event_id, event_date, property_id}, conta, naturezas, valor, descricao, partner_id, documento, observacoes, quantidade, pasture_id, retida, data_competencia (padrão event_date), semCaixa, parcelas, pagamento (texto da falta de parcela: padrão "será pago"; a receita da venda usa "será recebida"), rateio: {criterio, itens, cemPorCento, justificativa (gravada no MANUAL e na base estimada), estimado} ou null, campo, campoParcelas, rotulo, prefixo}`. Erros no coletor (`CONTA_INVALIDA`, `CONTA_INATIVA`, `VALOR_FORA_DA_FAIXA`, `BASE_INVALIDA`, `CAMPO_OBRIGATORIO` na justificativa do MANUAL, `RATEIO_INVALIDO`, `RATEIO_INCOMPLETO`, os das parcelas) → null. Valor zero, negativo ou com fração de centavo: uma causa, um erro — `VALOR_FORA_DA_FAIXA` ("O valor da compra precisa ser maior que zero", com o "de" contraído no rótulo) só se o coletor ainda não tem erro no `campo` (o catálogo já recusa o campo com o rótulo dele), e o lançamento para ali (sem parcelas nem rateio, que repetiriam a causa). Recusas de programação (`INTERNAL`): sem conta, parcela em lançamento sem caixa (invariante 4), rateio de ESTOQUE_INSUMOS ou NAO_OPERACIONAL (14), rateio sem animais. Devolve `{linhas: {FINANCEIRO, PARCELAS (ABERTA), RATEIOS (escopo EVENTO, data_base = event_date), ALOCACOES_FINANCEIRAS}, financial_id, rateio, parcelas}` |
| `juntar(plano, planejado)` | Junta as linhas ao dicionário `{aba: [linhas]}` do evento |
| `avisoPeriodo(params, data, oque)` | `{codigo: 'PERIODO_BLOQUEADO', mensagem}` quando `data ≤ fin_bloqueio_ate`; senão null |
| `negociacao(spec)` | Modalidade × base de peso (07, 4.1 e 4.2; 03b, 4.3 a 4.5). `spec: {modalidade, base_peso, rendimento_carcaca_pct, rendimento_tipo, preco_unitario, peso_total_kg, valor, criterio_rateio, arroba_kg, tolerancia_pct, animais: [{chave, peso, peso_carcaca_kg, valor_individual, base_manual}]}` e, na venda, `carcacaTotal: true` (aceita `peso_carcaca_total_kg`, o total do romaneio, na arroba de carcaça; campos de erro `peso_vivo_total_kg`), `valor_conferencia` (o bruto: a conta pelo preço é conferida contra ele; `valor` é a receita distribuída e o que os valores por animal somam), `campo_valor`, `rotulo_valor` e `pesagens` (última pesagem individual de cada animal até a data, ou null) → `{base_peso, rendimento_pct, rendimento_tipo (APURADO na carcaça com peso vivo), unidade_preco, preco_unitario, peso_vivo_total, peso_carcaca_total, arrobas, criterio, bases, estimado, conferencia (centavos), desvio_pct, erros: [{codigo, campo, mensagem, indice?}], avisos}`. Na venda sem o peso de cada animal: com a pesagem anterior de todos, PESO_VIVO com bases = pesagem × peso do lote ÷ Σ pesagens (4 casas, `estimado: true`); senão CABECAS; na arroba de carcaça só com o total do romaneio, PESO_VIVO (peso de cada um) ou o mesmo recurso; `RATEIO_SEM_PESO` em todos. Critério: DIRETO com um animal; CABECA → CABECAS (preço único) ou VALOR_INDIVIDUAL (valor por animal); KG_VIVO e ARROBA VIVO → PESO_VIVO, ou CABECAS com aviso `RATEIO_SEM_PESO` quando só há o peso do lote; ARROBA CARCACA → PESO_CARCACA; LOTE → o escolhido. Aviso `VALOR_DIVERGENTE` acima de `tolerancia_pct`. Erros: `CAMPO_OBRIGATORIO`, `BASE_PESO_INVALIDA`, `CAMPO_NAO_SE_APLICA`, `VALOR_FORA_DA_FAIXA`, `CONFLITO_DE_CAMPOS`, `VALORES_INCOMPLETOS`, `VALOR_INDIVIDUAL_NAO_SOMA`, `PESO_TOTAL_DIVERGENTE`, `PESO_OBRIGATORIO`, `PESO_INCOMPLETO`, `CARCACA_MAIOR_QUE_VIVO`; a base de cada animal no rateio (peso, carcaça ou peso manual) que não é maior que zero ou tem mais de 4 casas é erro do animal (`indice`, no campo dele: `VALOR_FORA_DA_FAIXA`, `FORMATO_INVALIDO`), e o motor não repete o erro de um campo do animal que o catálogo já recusou; rendimento apurado que arredonda para 0% ou 100% é `VALOR_FORA_DA_FAIXA` com o rendimento calculado (não "carcaça maior que o vivo"); `VALOR_DIVERGENTE` diz "mais de x%" quando o desvio arredondado empata com a tolerância |
| `conferir(tx, escopo?)` | As invariantes de 03b, seção 14, sobre as linhas vigentes (`tx.repo`; `tx.cru` para 19 e 20): `[{invariante (1 a 20), tabela, id, mensagem}]`, vazio = fecha ao centavo. `escopo` (trava de integridade, seção 10.5): `{lancamentos, eventos, animais: {id: true}}` — só os lançamentos citados e os dos eventos citados, os rateios deles, os cabeçalhos de compra e venda e o valor desses eventos, a sanidade deles e o custo de aquisição dos animais citados; sem ele, tudo. A 10 (100% alocado) vale nos lançamentos de COMPRA, VENDA, ENTRADA_INICIAL, MORTE, DESCARTE e SANIDADE (`CEM_POR_CENTO`: o rateio que o próprio evento grava; 03b, seção 10.3); a 3 e a situação de pagamento ignoram a parcela CANCELADA (desenho-base 16.11). A verificação de integridade distribui os achados pelas checagens (seção 11). Na venda: 15 (Σ valor_individual = receita = lançamento = alocado) e 16 (deduções = Σ DESPESA_VENDA; frete, comissão e outras = Σ por conta; nenhum outro lançamento; `EVENTOS.total_value` = `valor_bruto`; `qtd_animais` = saídas). Nos demais tipos (16), `EVENTOS.total_value` = Σ FINANCEIRO.valor vigentes do evento (abertura do rebanho inicial, lançamento da morte ou do descarte) e vazio sem lançamento (03b, 2.5). A consulta declara `leituras()` com acesso cru; aba não lida desliga as invariantes que dependem dela (17 só com SANIDADE). Base da etapa de integridade |
| `leituras()` | `Timeline.LEITURAS` + COMPRAS, VENDAS, PLANO_CONTAS, PARCEIROS + `EventCatalog.LEITURAS_INSUMOS` (Fase 3) |
| `planejar(...)` com `product_id` e `quantidade` (Fase 3) | O lançamento do consumo de insumo (CUSTEIO, `semCaixa`, sem parcela: `status_pagamento` SEM_CAIXA, 03b 10.4) e o da compra de insumo (COMPRA_INSUMOS, com parcelas) gravam `FINANCEIRO.product_id` e `quantidade`; os demais, vazios |
| `situacaoPagamento(parcelas, ativo)` | `{status_pagamento, data_pagamento}` pela ordem de 03b, 10.4 (o projetor usa esta função) |
| `tiposDosCustos(lancamentosAcessorios, frete)` | `FRETE` ou `OUTRO` para cada lançamento (na ordem da lista recebida), pelo prefixo que soma o frete na ordem do `financial_id` (revisão 4: os fretes da compra recebem os menores identificadores; a ordem física das linhas, que o dono pode classificar, não conta — 06, seção 12); null se nenhum prefixo fecha |
| `basesEstimadas(pesagens, pesoLoteKg)` | Revisão 4. A base estimada da venda só com o peso do lote: cada pesagem × peso do lote ÷ Σ pesagens, 4 casas (sem o peso do lote, a própria pesagem). A mesma conta na negociação e na integridade (BASE_RATEIO) |
| `titulos(repo, data?)` | `{data, a_pagar, a_receber, vencido_pagar, vencido_receber, parcelas_abertas}`: nominal das parcelas não liquidadas em D, de lançamentos vigentes com competência até D. Lê FINANCEIRO e PARCELAS |
| `blocoFicha(repo, animal, {desde?})` | Bloco H: `{entregue: true, animal_id, custo_aquisicao (a projeção = Σ alocações AQUISICAO_ANIMAIS do período atual), custo_aquisicao_origem, desde, lancamentos_anteriores, por_natureza, custeio, custo_acumulado, receitas, despesas_venda, resultado: {valor, motivo, mensagem?} (só com saída e custo conhecido), lancamentos: [{passagem_atual, financial_id, event_id, event_type, event_date, data_competencia, conta_codigo, conta_nome, natureza, tipo, classe_custo_animal, descricao, valor_lancamento, valor_alocado, criterio, base_valor, base_total, partner_id}]}`. Uma base só (a do custo de aquisição, 03a DL-08): totais, custo acumulado e resultado somam as alocações com competência ≥ `desde` (a entrada vigente mais recente, que `AnimalService` passa; revisão 4: `Timeline.entradaDoCusto` — no animal que só existe no histórico, comprado ou nascido e vendido antes do marco zero, o último período é o histórico, e a compra histórica é o custo dele; o animal do marco zero continua sem a compra de antes da entrada dele, 04, seção 6); a lista traz todas as passagens, com `passagem_atual` e `lancamentos_anteriores` (quantos ficaram fora das contas). Sem `desde`, todas. Lê FINANCEIRO, RATEIOS, ALOCACOES_FINANCEIRAS, PLANO_CONTAS e EVENTOS |
| `parcelasMensais(valor, primeiro, qtd?, {forma_pagamento, documento})` | Parcelas de um título em `qtd` vezes (vazio = 1), de mês em mês a partir de `primeiro` (`Utils.somaMeses`), em partes iguais (`dividirParcelas`): a forma de "1 ou mais parcelas" do frete e dos outros custos da compra (`custos[].parcelas_qtd`) e do lançamento opcional da morte e do descarte (`custo_parcelas_qtd`, `receita_parcelas_qtd`; 03b, 10.3). Entrada inválida → uma parcela (a validação é do catálogo e de `resolverParcelas`) |

## 27. Telas da Fase 2, etapa de financeiro do evento e compra — `Components`, `Events`, `Animals`, `JavaScript`

| Peça | O que existe |
|---|---|
| `Store` | `parceiro(id)` (inclusive inativo), `contas(naturezas?)` e `conta(id)` (plano de contas do bootstrap) |
| `Campos` | `ref:PLANO_CONTAS` como lista das contas ativas filtradas por `def.naturezas`; dinheiro, parceiro, conta e propriedade legíveis na revisão e na diferença |
| `Registro` (compra) | Grade de animais novos com os principais da compra (brinco, sexo, nascimento ou idade, peso, valor) e "Incluir animal que volta ao rebanho" (campos `CAMPOS_VOLTA_COMPRA`, iguais aos do servidor); grupos `parcelas` (começa com uma linha, "+ Outra parcela") e `custos` ("+ Frete ou outro custo"); linha de grupo toda em branco não vai ao servidor. Revisão pelo servidor com a negociação (valor dos animais, frete, outros custos, custo total, conferência pelo preço, arrobas, critério) e os lançamentos (títulos, a pagar ou a receber, valor por animal). Morte ou descarte com custo ou receita também revisam pelo servidor. Verbo "Gravar a compra"; resultado "Compra gravada: N animais entraram no rebanho, custo total de R$ X." |
| `TelaEventos` | Corrigir também a COMPRA (`previaCompra_`: cabeçalho de COMPRAS e do evento, parcelas do lançamento principal, custos na ordem com o tipo pelo prefixo do frete, animais criados com os atributos e os que voltaram com os campos da volta); morte e descarte trazem o lançamento opcional. Detalhe com "Negociação" (`data-secao="compra"`) e "Lançamentos financeiros" (`data-secao="financeiro"`: natureza, parceiro, situação do pagamento, títulos e rateio) |
| `TelaRebanho` (ficha) | Aba Financeiro (`data-bloco-financeiro`): custo de aquisição com a origem, custeio, custo acumulado, resultado (só com saída) e a tabela "Lançamentos do animal" (valor do lançamento e o que coube a ele) |
| `TelaInicio` | "Contas a pagar e a receber" (`data-secao="titulos"`, com os vencidos) quando há título em aberto, pelos `titulos` do `dashboard.obter` |
| `Fmt` | Rótulos `MODALIDADE`, `BASE_PESO`, `RENDIMENTO_TIPO`, `CRITERIO_RATEIO`, `STATUS_LANCAMENTO`, `STATUS_PAGAMENTO`, `STATUS_PARCELA`, `NATUREZA` |

Testes: `tests/ui/compra.test.js` (compra pela tela a 1280 e 360 px, correção pelo detalhe, morte com custo).

## 28. `HealthService` (puro: regras sanitárias; na Fase 2, só a carência na venda)

Desde a Fase 3 (E3.2 e E3.3), o contrato inteiro do `HealthService` (cadastros, estoque, consumo, agenda, ficha) está na
seção 39; as duas funções abaixo seguem como estavam.

Na Fase 2, antes do evento SANIDADE, da agenda e dos protocolos, a regra de carência (RN-072; 05, seção 4.8) já existia porque
a VENDA a consulta. Recebe as linhas de SANIDADE vigentes de quem chama (o motor passa as do animal, sem os eventos excluídos
da fonte). Testes: `tests/venda.test.js` (desde a Fase 3, com a SANIDADE gravada pelo próprio evento).

| Função | Contrato |
|---|---|
| `fimCarencia(registro)` | Último dia de carência: `data_fim_carencia` gravada ou `data_aplicacao` + `periodo_carencia_dias` (inteiro > 0); sem aplicação ou sem período → null. 01/11/2026 + 35 dias → 06/12/2026 |
| `carenciaEm(registros, data)` | Das aplicações até D, a de maior fim com fim ≥ D (em carência se D ≤ C): `{fim, health_id, event_id, nome_produto, data_aplicacao, tipo_procedimento}` ou null. Data inválida → `INTERNAL` |

## 29. Telas da Fase 2, etapa de venda — `Components`, `Events`, `Animals`

| Peça | O que existe |
|---|---|
| `Registro` (venda) | Atalho "Vender" da ficha (e o seletor de tipo); cartões dos animais escolhidos com peso vivo, carcaça e valor à vista (`PRINCIPAIS_VENDA`) e o resto em "Mais dados"; grupos `parcelas` ("Parcelas do recebimento", começa com uma linha) e `deducoes` ("+ Frete, comissão ou imposto"); revisão pelo servidor com a negociação (`linhasVenda`: bruto, desconto, receita, cada dedução, resultado da negociação, depósito esperado com o que o comprador desconta, conferência pelo preço, pesos, arrobas e preços médios sempre com a base — "@ de carcaça", "@ a x% (negociada)", "@ estimadas a x%" — e o equivalente em arrobas pelo rendimento padrão, rotulado "só referência"); consequência "N animais saem do rebanho como vendidos; o histórico fica"; verbo "Gravar a venda"; resultado "Venda gravada: N animais saíram do rebanho, valor bruto de R$ X." |
| `Seletor.criar({isentos})` | Ids que nunca são marcados inelegíveis: na correção, os animais do original (vendidos, mortos) |
| `TelaEventos` | Corrigir também a VENDA (`previaVenda_`: cabeçalho de VENDAS e do evento, parcelas da receita — parcela única sem valor, para acompanhar a receita —, deduções na ordem com o tipo pelo `payload_json.deducoes` e sem a descrição proposta pelo servidor, linhas de saída com peso, carcaça, valor só quando foi por animal e motivo de saída); antes de abrir a correção de uma saída, os animais baixados são carregados (`Store.carregarBaixados`). Detalhe com "Venda" (`data-secao="venda"`: comprador, finalidade, preço com a base, rendimento, pesos, bruto, desconto, receita, deduções, resultado da negociação, depósito esperado, critério, GTA, nota, condições), colunas "Carcaça" e "Descarte por" nos animais e, nos lançamentos, o tipo da dedução e "descontada pelo comprador" |
| `Registro` (correção, geral) | A diferença ignora campo oculto (o padrão de um campo invisível não é alteração), mostra dinheiro digitado formatado e, em saída ou movimento, diz que o animal tirado "continua no rebanho" ou "fica no pasto de origem" (só o criado pelo lançamento é anulado) |

Testes: `tests/ui/venda.test.js` (venda pela ficha a 1280 e 360 px, correção pelo detalhe com frete retido) e, em Node,
`tests/telas.test.js` (o pré-preenchimento da correção de venda, convertido como o formulário converte, reproduz o original).

## 30. Estorno e correção de qualquer evento (E2.7) — `EventService`, `Timeline`, `AuditService`

O mecanismo é um só para todos os tipos ativos (`evento.estornar` e `evento.corrigir`, seção 14); o que cada tipo traz são
as linhas e as regras do próprio registro. Garantias (testadas para cada tipo e subtipo ativo em `tests/estorno.test.js`):

| Garantia | Como |
|---|---|
| Anula sem apagar (RN-039, RN-108) | O ESTORNO (`event_date` = hoje, sem linha filha, `payload_json.justificativa`) e o substituto apontam o original em `reversal_of_event_id`; o original só muda nos caches `status` (ESTORNADO) e `reversed_by_event_id`; as linhas dele ficam idênticas |
| Um commit | Corrigir anula e substitui na mesma operação; o substituto é do mesmo tipo e subtipo (`TIPO_DIFERENTE`) e reaproveita os `animal_id` criados (o que sai fica ANULADO, com as regras do estorno) |
| Posição na cadeia (desenho-base 16.1) | O substituto tem `event_seq` novo e a posição (`ordem_seq`) do primeiro evento da cadeia: corrigir não muda a ordem dos movimentos, identificações, marcações, reclassificações, correções de cadastro, pesagens (peso atual na projeção, `AnimalService.pesoVigente`, base estimada da venda) e fatos reprodutivos (situação reprodutiva, `ReproductionService.partos`) do dia |
| Dependentes (RN-040, RN-041) | Estorno (e correção estrutural) revalida a linha do tempo, as sequências de identificação e de marcação e as referências fora da linha do tempo (mãe, pai, touro, valor alocado por outro evento: `REFERENCIA_RATEIO` com o tipo e a data do evento dono do rateio, uma vez por evento e nunca repetindo um `EVENTO_DEPENDENTE`; "refaça o rateio" só quando o dono é um RATEIO) sem o original → CONFLICT com `details[].conflito = {event_id, tipo, subtipo, data, nome}` do evento que impede: transferência posterior (`ORIGEM_DIVERGENTE`), fato ou saída de animal criado (`EVENTO_DEPENDENTE`), recompra ou reentrada (`ENTRADA_JA_DENTRO`), retirada ou troca de brinco (`SEM_IDENTIFICACAO`, `REMOCAO_DE_OUTRO_CODIGO`, `IDENTIFICACAO_JA_EXISTE`), desmarcação (`NAO_MARCADO`), cria de quem teve o sexo corrigido (`REFERENCIA_GENEALOGICA`), registro reprodutivo de que o animal é o touro (`REFERENCIA_TOURO`), registro anterior ao marco zero que só cabia com o nascimento ou a chegada que a correção estornada trazia (`ANTES_DO_NASCIMENTO`, `ANTES_DA_ENTRADA`: o depois usa o nascimento e a chegada da projeção sem o evento; revisão 3). Em toda referência (genealogia, touro, parto da matriz), `conflito` traz o `event_type`, o subtipo, a data e o nome do lançamento que impede, e cada lançamento entra uma vez |
| Conjunto final na correção (RN-045) | Na correção, a situação de hoje sem o original não decide a volta ao rebanho (JA_NO_REBANHO, ANIMAL_MORTO): a linha do tempo final, com o substituto no lugar do original, decide (a volta levada para depois da morte → CONFLICT `FORA_DO_REBANHO` com a morte). O brinco "que volta" é o do conjunto final (sem o original e com as linhas de brinco do substituto): corrigir só o motivo de uma retirada não devolve o número; levar a retirada para depois de o número ir para outro animal → CONFLICT com a entrada dele |
| Mãe de parto (RN-012, RN-060) | Correção que tira o sexo F de quem é mãe de parto vigente (mesmo só de natimorto, sem cria cadastrada) → VALIDATION `SEXO_DA_MATRIZ`; estorno ou correção que volta o sexo para M → CONFLICT `PARTO_DA_MATRIZ` com o parto |
| Chegada declarada (04, seção 6) | Registro anterior ao marco zero se valida contra `Timeline.chegadaDeclarada` (não contra a volta mais recente), no comando, na integridade e no desfazer da importação; a correção de `data_entrada` corrige a chegada declarada do rebanho inicial mesmo depois de uma volta |
| O que volta | Sem o original, o animal volta ao que a reconstrução dá (situação, pasto, brinco, categoria, marcações, custo, mãe e pai); se o brinco que volta já é de outro animal (`BRINCO_DUPLICADO`), a mãe ou o pai que voltam não passam pela genealogia (`REFERENCIA_GENEALOGICA`: mãe macho, pai fêmea, progenitor anulado ou nascido depois, ciclo; revisão 3: também com a mãe e o pai de sempre, quando o que volta é o nascimento do próprio animal — CONFLICT com a correção que pôs o progenitor), o sexo ou o nascimento que voltam não cabem com o registro reprodutivo de que ele é o touro (`REFERENCIA_TOURO`) ou a categoria manual que volta está desativada (`CATEGORIA_INATIVA`) → CONFLICT com o registro que impede. O desfazer da importação de eventos faz a mesma conferência (`EventService.conferirRestauracao`) |
| Sem ressurreição, sem estorno de estorno (RN-043) | Estornar o substituto não revive o original (a anulação é definitiva); evento já anulado → `JA_ANULADO`; ESTORNO → `ESTORNO_NAO_SE_ESTORNA` (estornar ou corrigir) |
| Financeiro | Os lançamentos do original deixam de valer pela vigência (`status`/`status_pagamento` CANCELADO, `cancelado_por_event_id`); parcela LIQUIDADA → `PARCELA_LIQUIDADA`; competência no período fechado → aviso `PERIODO_BLOQUEADO` |
| Histórico e trilha | `evento.listar` mostra anulados e estornos (no histórico de um animal, também os estornos dos eventos dele); `evento.obter` traz o anulado com o anulador; `auditoria.listar` mostra o ESTORNO com quem, quando e o motivo (seção 11) |

**Revisão final (rodada 5).** Com o reuso de brinco desligado, o período que o estorno, a correção que tira a linha do
original ou o desfazer devolvem ao animal não pode ter um número que outro animal usou em qualquer época (`BRINCO_APOSENTADO`,
`CONFLICT` com o registro do outro animal; dentro de `conferirPeriodosDeBrinco_`, a mesma regra do registro). Na correção,
os anexos de cada lançamento passam ao do substituto pelo papel e, dentro dele, pelo parceiro e pelo valor (depois só pelo
parceiro; pela posição só com o mesmo número de itens, o original na ordem do `financial_id`); o que não casa fica no
evento e `impactos.anexos_soltos` dá os nomes para a revisão ("Ficam sem lançamento"). A recusa da categoria manual × sexo
(`CATEGORIA_INCOMPATIVEL`, registro e estorno) manda estornar ou corrigir a reclassificação citada.

Testes: `tests/estorno.test.js` (um caso por tipo e subtipo ativo, CT-07, CT-08, CT-09 pela `api()`, CT-17 (b), CT-18 com a
identificação, cadeia de substituição, histórico e auditoria), `tests/identificacao.test.js` (IDENTIFICACAO, MARCACAO,
RECLASSIFICACAO, DIVERGENCIA_CONTAGEM, RN-004 e CATEGORIA_EM_USO) e a varredura de quedas com o estorno de transferência
(`tests/unitofwork.adversarial.test.js`, cenário `estornoTransferencia`).

## 31. Ataque ao motor e ao financeiro da Fase 2 — `tests/fase2.adversarial.test.js`

Modelo de referência do rebanho escrito no teste (linha do tempo por animal pela regra de 05, seção 4.3, com a posição do
substituto de 16.1; sequências de identificação e de marcação; maior resto) que prevê o desfecho de cada comando: aceito,
VALIDATION (problema numa linha do próprio comando ou erro de entrada) ou CONFLICT — e, no CONFLICT, o conjunto exato de
eventos que impedem (`details[].conflito.event_id`). A origem que o servidor tira da linha do tempo não vira erro próprio
(seção 14). Propostas: `propTransferencia`, `propSaida` (MORTE, DESCARTE, DIVERGENCIA_CONTAGEM, com o lançamento opcional),
`propCompra` (novos e volta; CABECA, valor por animal, kg vivo; frete; parcelas vazias, explícitas ou com 1 centavo de
erro), `propVenda` (CABECA ou kg vivo; desconto; deduções retidas), `propNascimento` (gêmeos, natimorto, correção que
anula ou cria cria), `propIdentificacao`, `propMarcacao`, `propLocalizacao`, `propVolta`, `propEstorno`; toda proposta
aceita também como correção (`substitui`). Depois de cada comando: simulação = gravação (mesmo desfecho e mesmos
lançamentos), resposta com as projeções do modelo, reenvio com a mesma chave (duplicado idêntico, nada gravado) ou com
outro conteúdo (`IDEMPOTENCY_MISMATCH`), recusado sem linha gravada, e, pelo `apoio-oraculos.js`, modelo = replay cru =
sistema no inventário (Timeline, `inventario.posicao`), nos elegíveis de cada tipo, na ficha de cada animal (situação,
pasto, saída, brinco, marcações, custo de aquisição), nas alocações e nas invariantes de 03b, seção 14; no fim de cada
sequência, painel e cartões dos pastos, visão geral, carga inicial e a verificação de integridade sem erro de dado. Três sementes fixas de 140 passos e casos dirigidos
(fato no dia da saída, mesmo dia com as classes 0, 1 e 2, substituição em cadeia, estorno de compra com venda posterior,
gêmeos com natimorto, correção de localização, centavos patológicos, arroba e carcaça, parcelas de 1 centavo, reenvio).

## 32. Anexos de evento (E2.9) — `FileService`, `EventService`, `Components` (`Anexos`), `Events`, `Animals`

Nota fiscal, GTA, laudo (tipo DOCUMENTO, rótulo "Documento ou laudo": o enum TIPO_ANEXO de 03a não tem LAUDO) e foto de
qualquer evento que vale, por `anexo.adicionar` (comando próprio, auditado), com a entidade EVENTOS (o evento) ou FINANCEIRO
(um lançamento financeiro do evento: o boleto do frete, o romaneio na receita, o recibo da comissão). Contratos das funções
na seção 16.

| Regra | Como |
|---|---|
| Ligação | `ANEXOS.event_id` = o evento (EVENTOS) ou o evento que criou o lançamento (FINANCEIRO); `financial_id` na forma pública. Linha filha (02, seção 5): vale enquanto o evento vale |
| Histórico | Evento estornado ou corrigido: os anexos dele seguem em `evento.obter` e `anexo.obter` com `vigente = false`; não recebem arquivo novo nem perdem os que têm (`JA_ANULADO`); a limpeza diária não leva o arquivo à lixeira. Linha inerte (gravação que falhou) não aparece em lugar nenhum (`NOT_FOUND`) |
| Correção | O substituto ocupa o lugar do original: cada anexo ATIVO do original vira uma linha filha do substituto na mesma operação (`impactos.anexos`), com o mesmo arquivo do Drive; o de lançamento vai para o lançamento do substituto com o mesmo papel e a mesma ordem (ANIMAIS, FRETE, OUTRO, RECEITA, DEDUCAO:<tipo>; um lançamento só nos dois → o mesmo) ou, sem par, para o evento. Remover a cópia não apaga o arquivo que o histórico usa |
| Remoção | `anexo.remover` com justificativa obrigatória (AUDITORIA: `status` ATIVO → REMOVIDO com o motivo); só de anexo que vale |
| Limites | Os do anexo de animal: 5 MB, `MIME_ANEXO`, FOTO só imagem; o aparelho reduz a imagem para JPEG e recusa outro tipo antes de enviar (`Campos.lerArquivo`); o servidor confere tudo de novo |

Interface:

| Peça | Contrato |
|---|---|
| `Anexos.carregarImagem(img, anexo_id, miniatura)` | Data URL de `anexo.obter` no `<img>` |
| `Anexos.abrir(anexo, origem)` | Folha com a imagem inteira ou o link "Baixar" (data URL); `vigente = false` → nota "guardado como histórico" |
| `Anexos.enviar({titulo, origem, entidade, entity_id, tipoPadrao, ligacoes: [[financial_id, rótulo]], fotoPrincipal, idBase, aoSalvar})` | `Cadastro.folha` de `anexo.adicionar` (arquivo, tipo, "O arquivo é de" — `EVENTO` ou um lançamento —, descrição, foto principal no animal) |
| `Anexos.remover(anexo, origem, {aviso, aoSalvar})` | `Cadastro.folha` de `anexo.remover` com a justificativa obrigatória |
| `Anexos.lista(itens, {podeRemover, detalhe(x), acoes(x), aviso, aoMudar})` | Cartões `.anexo` (`data-anexo`): miniatura, nome, tipo, data, descrição, Abrir, Remover |
| Campo `lista` com `rotulos_opcoes` | Rótulos na ordem de `opcoes` (listas montadas na hora) |
| `Anexos.tipoPadrao(event_type)`, `Anexos.escolher({origem, tipoPadrao, aoEscolher})`, `Anexos.pedidoEvento(a, event_id)` | Tipo sugerido pelo evento (NOTA_FISCAL na compra e na venda, GTA na transferência, DOCUMENTO nos demais; o mesmo no detalhe e no formulário); escolha do arquivo SEM enviar (folha `data-escolher-anexo`: arquivo, tipo, descrição; foto que não é imagem recusada no aparelho) → `{arquivo, tipo, descricao}`; o pedido de `anexo.adicionar` desse arquivo para o evento gravado (entidade EVENTOS). Formulário de evento: seção 35 |
| Detalhe do evento (`#/evento/<id>`) | Seção `data-secao="anexos"` ("Documentos e fotos"), menos no ESTORNO: "Anexar nota fiscal, GTA, laudo ou foto" e Remover só no evento que vale; no anulado, a nota de histórico; cada lançamento financeiro mostra "Arquivos: …" |
| Ficha do animal (bloco J) | A mesma peça (`Anexos.enviar` com `fotoPrincipal`, `Anexos.lista` com "Usar como foto principal") |

Testes: `tests/anexos.test.js` (compra, venda, transferência, morte; estorno com e sem dependente; correção de compra, venda e
morte, inclusive retroativa e em cadeia; limites; queda na fase A da correção; rotas pela `api()`), `tests/files.test.js`
(anexo de animal) e `tests/ui/anexos.test.js` (detalhe da compra a 360 px).

## 33. Inventário histórico e lotação (E2.8) — `Timeline`, `InventoryService`, `PastureService`, `EventService`, `Dashboard`, `Pastures`

O inventário de qualquer data sai do replay das linhas vigentes HOJE (04, seção 5.2 (v)): corrigir ou estornar um evento
muda o passado, e nada fica gravado em "foto". As funções estão nas seções 13 (`estadas`, `situacaoEm`, `presentesEm`,
`inventario`, `diasPermanencia`), 15.3 (`pasto.painel`, `lotacao`) e 15.4 (`posicao`, `inventario.posicao`,
`dashboard.obter`).

| Regra | Como |
|---|---|
| Situação na data | ATIVO enquanto há entrada vigente sem saída até o fim do dia D; depois, a da última saída (VENDIDO, MORTO, DESCARTADO, BAIXADO_AJUSTE); sem linha até D, AINDA_NAO_ENTROU. Antes do marco zero não há inventário (`ANTERIOR_AO_MARCO_ZERO`) |
| "Desde quando" | `no_pasto_desde` = início da estada no pasto em que o animal está em D; `no_rebanho_desde` = a entrada vigente. Mesma regra das estadas do bloco D da ficha |
| Peso vigente na data | O último peso conhecido até D (PESAGENS da entrada, compra, nascimento, venda; na Fase 3, as pesagens, sem mudar a regra), dentro de `peso_validade_dias`; vencido ou ausente, o maior entre ele e o de referência da categoria em D (estimado). Sem peso nenhum: fora da UA e do peso médio, contado — nunca zero |
| UA, UA/ha, ocupação | UA = Σ peso vigente ÷ `ua_peso_kg` (450); UA/ha = UA ÷ área (sem área: null, `SEM_VALOR_DE_REFERENCIA`); ocupação = UA/ha ÷ capacidade em UA/ha, ou cabeças ÷ capacidade em cabeças; capacidade nunca deduzida da área |
| Dias de permanência | [entrada, saída): o dia da entrada conta, o da saída não; nenhum dia em dois pastos; Σ dias nos pastos = dias no rebanho; período antes do marco zero não conta. É a base do rateio DIAS_PERMANENCIA (Fase 4: `Timeline.diasPermanencia` + `Utils.ratear`) |
| Aviso de lotação | RN-027 em cabeças e em UA/ha, no pasto de destino, no dia do evento, com a UA e a comparação das consultas (seção 14). Na simulação, o mesmo aviso |
| Visão geral | Posição em Df com os filtros; movimento, receita e séries do período; título de hoje sem filtros |

Interface: `TelaInicio` tem o período ("De", "Até", "Ver"; `data-periodo`; vazio = padrão do servidor, que volta nos campos),
o cartão `peso-medio`, a seção `data-secao="movimento"` (cartões `nascimentos`, `compras`, `vendas` — cabeças · valor —,
`mortes`, `receita-vendas`; nota quando o período começa antes do marco zero; descartes e baixas na contagem numa linha) e
os gráficos da evolução do rebanho (linha), nascimentos × mortes e compras × vendas (barras); a resposta fica guardada por
(`dataVersion`, período). O painel do pasto mostra o peso médio, a nota de "acima da capacidade", a coluna "No pasto desde"
e a seção `data-secao="permanencia"` ("De", "Até", "Contar": total de animal-dias e a tabela por animal).

Testes: `tests/lotacao.test.js` (exemplos de 05, seção 4.6, e 07, seções 3.3 e 8.2; situação na data; CT-08 e o painel
pela `api()`, com estorno; CT-02 com o inventário anterior e os 59 dias; correção e estorno retroativos mudando o passado;
peso vigente da compra e do nascimento; aviso em UA/ha na compra retroativa, na transferência, na correção, na simulação,
com as duas capacidades, sem área e pela política; visão geral com período, filtros, estorno e falhas),
`tests/pastures.test.js` e `tests/inventory.test.js` (ajustados ao contrato novo) e `tests/ui/lotacao.test.js` (Início e
painel do pasto a 1280 e 360 px).

## 34. Telas da Fase 2, etapa de interface dos eventos (E2.1 a E2.7 na tela) — `Components`, `Events`, `Animals`, `Pastures`, `Settings`, `JavaScript`, `Api`

Todo tipo e subtipo ativo do catálogo passa pelo mesmo fluxo "Registrar evento" (08, seção 4): seletor → formulário do
catálogo → revisão LOCAL ou pelo servidor (`evento.simular`) → avisos com aceite → resultado. Nenhum valor é calculado no
aparelho: rateio, parcelas, valor de cada animal e o financeiro do estorno saem da simulação.

Revisão final (rodada 5): `UI.estadoErro(e, {detalhes, acao})` é o único lugar que mostra um erro fora do formulário de
evento (Cadastro, Configurações, importação): o título do CONFLICT é "Não dá para gravar" (só o CONFLICT da versão dos dados
diz "Os dados mudaram"), os detalhes vêm com `UI.problema` (o link "Abrir …" para o lançamento que impede) e o que só
repete a mensagem fica de fora. Na correção de cadastro, o erro vai para o cartão do dado que a mensagem cita pelo rótulo
(o repetido, para o último) e a revisão, o botão e o rascunho contam animais distintos. A revisão da compra chama o rateado
de "Custo de aquisição por animal (com frete e outros custos)". A tela de sistema mostra `reparo_impedido` no lugar do
botão de reparo.

| Peça | O que existe |
|---|---|
| `Registro` (subtipo) | O subtipo é o primeiro campo, com a pergunta do tipo ("O que fazer" na identificação, "Marcar como" na marcação, "O que corrigir" no ajuste); os campos de cabeçalho do subtipo (`subtipos[S].campos`, ex.: `motivo_descarte`) entram depois dos do tipo e são redesenhados ao trocar o subtipo; o pedido só leva os campos do subtipo escolhido. Na identificação, `BRINCO_ORIGEM` só aparece na retirada (a regra `TIPO_NAO_SE_APLICA` do servidor). Crítico = o do tipo ou o do subtipo (botão de perigo e tela de resultado na baixa por divergência). Verbos: "Gravar a identificação", "Gravar a marcação", "Dar baixa", "Mudar a categoria"; resultados próprios ("Identificação posta em 1 animal.", "1 animal marcado para descarte.", "Baixa gravada: …") |
| Grade de animais novos (`grade_novos_animais`) | Fora da correção: "Preencher em série" (folha `data-folha-serie`: quantos, brinco do primeiro e os campos do lote — sexo, castrado, reprodutor, raça, nascimento e a certeza, idade, origem, pasto, peso, valor — iguais aos do catálogo; os cartões em branco são substituídos) e "Colar da planilha" (folha com as colunas Brinco · Sexo · Idade ou nascimento · Peso · Valor, separadas por tabulação ou ponto e vírgula; "Conferir as linhas" lista os problemas pelo número da linha e só inclui com tudo lido; castrado, reprodutor e a certeza do nascimento aplicados aos colados). O que entra são os valores como digitados: o cartão e o servidor validam |
| `Registro.serieBrincos(inicio, n)` | `{brincos: [texto \| null]}` (0301 → 0301, 0302…; prefixo e zeros à esquerda ficam; vazio = sem brinco) ou `{erro}` (n fora de 1 a 1.000; primeiro brinco que não termina em número) |
| `Registro.lerColagem(texto)` | `{animais: [{brinco, sexo (M\|F), idade_meses \| data_nascimento (yyyy-MM-dd), peso, valor}], problemas: [{linha, mensagem: 'Linha N: …'}], cabecalho}`: sexo M/F/macho/fêmea; nascimento dd/mm/aaaa ou aaaa-mm-dd; peso com 1 casa e > 0; valor > 0; brinco repetido na colagem (pela normalização do brinco); mais de 5 colunas |
| Parcelas (`bloco_parcelas`) | "Dividir em parcelas" (folha `data-folha-parcelas`: quantas, vencimento da primeira, intervalo — todo mês no mesmo dia, 30, 15 ou 7 dias —, forma de pagamento) substitui as linhas por N vencimentos com o valor em branco: o servidor divide em partes iguais e a revisão mostra cada parcela. `Registro.vencimentos(primeiro, n, intervalo)` → `[yyyy-MM-dd]` (MES: o mesmo dia ou o último do mês) |
| Revisão | "Ver os animais" traz, com a simulação, o valor de cada animal (`impactos.financeiro.por_animal`; `data-valor-animal` em centavos; na venda, o líquido) e, nos tipos com subtipo, o que muda em cada um (código, motivo, categoria, campo corrigido em palavras). No estorno, "Financeiro cancelado" (`impactos.cancelados`). `Registro.impactosServidor(s)` e `Registro.diferencas(s)` ficam expostos para os testes |
| Problemas do servidor | Cada detalhe com `conflito` ganha o link "Abrir <nome> de <data>" ("Abrir a marcação para descarte de 01/05/2026": `conflito.nome`, ou `Store.nomeEvento(tipo, subtipo)`; `data-conflito` = `event_id`) para o lançamento que impede (08, seção 8), na lista do evento e no cartão do animal; o rascunho fica guardado ao sair |
| Correção (`Registro.diferencas`) | Itens do original por animal (`corrige.antes.itens` na correção de cadastro, um item por campo): comparados na ordem; "mais uma correção", "N correções a menos" e, no tipo com subtipo, o animal tirado "fica como estava antes dele" |
| `TelaEventos` | "Corrigir" para todo tipo e subtipo ativo, menos o ESTORNO (`previaManejo_`: identificação — tipo, código, motivo —, marcação — ação e motivo do descarte do payload —, ajustes — a justificativa de AJUSTES ou `payload_json.motivo_ajuste`; correção de cadastro com um item por linha de AJUSTES; brinco certo; pasto onde está; categoria; observação da baixa). Detalhe: "Identificações" (retirada como "retirado em"), "Marcação", "Correções" com os valores em palavras (categoria, pasto, mãe ou pai pelo nome; vazio na categoria = automática), "Motivo do ajuste", a baixa por divergência em "Saída do rebanho" e, em cada lançamento financeiro com rateio, "Por animal (N)" (`data-alocacoes`, `data-alocacao` em centavos; base em kg no rateio por peso) |
| `TelaRebanho` (ficha) | Atalhos à vista: Transferir, Vender, Registrar morte, Registrar parto, Voltar ao rebanho; "Mais registros" (`data-atalho-ficha="MAIS"`) abre a folha com Descartar, Pôr brinco (sem brinco) ou Trocar e Tirar o brinco, Marcar ou tirar a marca de descarte e de não localizado (a ação vem pela marca do animal), Mudar a categoria, Não encontrado na contagem, Corrigir brinco lançado errado e Corrigir o pasto (`data-atalho-ficha="TIPO.SUBTIPO"`). Só tipo e subtipo ativos e animal ativo |
| `TelaPastos` (painel) | "Transferir daqui" e "Vender daqui" (`data-atalho-pasto`): o pasto de origem e os animais do pasto já marcados |
| `TelaConfig` (auditoria) | A trilha completa (`auditoria.listar`): filtros "O que mudou" (inclui Lançamentos), "O que foi feito" (gravado, corrigido, estornado, dado do animal corrigido, cadastro criado ou alterado…) e período pela data na fazenda; colunas Quando, Quem, O que foi feito, Em quê (o lançamento com link), De → para, Motivo |
| `Fmt` | `ROTULOS.IDENTIFICACAO.BRINCO` ("Brinco da fazenda"), `ACAO_MARCACAO`; `rotuloOpcao` de `tipo_identificacao` e `acao` |
| Revisão 1 da Fase 2 (interface) | `Store.nomeEvento(tipo, subtipo?, pronto?)` (o `nome` do catálogo ou do servidor: "Estornar a venda de 30 animais", "Abrir a compra de 15/03/2025"); `Store.valorLegivel(campo, valor)` e `Store.nomeDeReferencia(id)` (identificador → nome do pasto, propriedade, categoria, parceiro, conta ou animal; S/N → sim/não; data → dd/mm/aaaa; nunca o código cru) no detalhe dos ajustes e na trilha de auditoria, que nomeia também o campo (`Fmt.ROTULOS.CAMPO_CADASTRO`, `CAMPO_CORRIGIVEL`) e o parâmetro pelo rótulo; `Fmt.ROTULOS.AVISO` (os 13 avisos) na configuração e nos "Avisos aceitos ao gravar"; lista e detalhe de eventos com `rotulo_subtipo`. O resultado de uma correção não oferece "Desfazer" (estornar o substituto apaga o lançamento inteiro; a revisão do estorno de um substituto diz isso em "Atenção"). O detalhe da venda mostra `totais_venda` e a correção da compra usa `papeis` de `evento.obter` (nenhuma conta no aparelho) |
| Revisão 2 da Fase 2 (interface) | `Registro.abrir(tipo, previa)` trata as próprias falhas (rascunho no servidor que não pôde ser lido ou apagado, sem conexão): aviso "Não foi possível abrir o registro: …" e `false`, nunca uma rejeição sem tratamento (os atalhos da ficha, do pasto e do rebanho, Estornar, Corrigir e Desfazer). `Registro.notaCorrecao(s)`: a nota do topo da correção pelo que acontece com o animal tirado — anulado só o que o lançamento cadastrou (`linhas[].criado`; crias do parto), o que já existia "fica como estava antes deste lançamento". Data antes do marco zero: a nota segue `aceita_historico` do catálogo (ou o original histórico na correção: `corrige.historico`) — "entra como histórico informativo" ou "este lançamento não pode ter data antes disso". Parto histórico: a revisão mostra "Registro histórico" (sem "Pasto das crias") e o resultado conta as crias pela `situacao_cadastral` devolvida ("Parto histórico gravado (antes do marco zero): a cria fica no histórico…"). Aviso com `conflito` (possível duplicidade) ganha o link "Abrir <nome> de <data>", como os problemas. Revisão do estorno: `textoCancelados` ("receita de R$ X e deduções de R$ Y"). Detalhe de lançamento cancelado: "Títulos sem efeito (lançamento cancelado)" (`data-titulos="sem-efeito"`) e "Rateio sem efeito", sem "(em aberto)" nem "distribuídos". Pasto vazio: "Transferir para cá" (TRANSFERENCIA com o destino e a data do painel) e "Registrar a chegada de um animal" (`data-entrada-pasto`: `TelaRebanho.comoEntrou(origem, pastoId)`, a folha "Como o animal entrou?" com o pasto já escolhido), nunca o rebanho inicial direto |
| Revisão 4 da Fase 2 (interface) | Prévia da correção do parto: o pasto das crias e a raça iguais ao que o servidor propõe (`evento.obter.propostas`) ficam vazios e acompanham a mãe e a data corrigidas. Prévia da compra e da venda: no lote de um animal (critério gravado DIRETO), a carcaça na linha leva o critério PESO_CARCACA (sem ela, CABECAS); no registro histórico (`pre_marco_zero`), os animais vêm das linhas de efeito 0 e o grupo de parcelas não é exigido (`corrige.historico`: o histórico não tem caixa). Correção de tipo com subtipo: o subtipo aparece só para leitura (`data-campo="__subtipo"` com `data-somente-leitura`), com "Para mudar o que foi lançado, estorne este lançamento e lance de novo." Revisão da correção: sem a linha "Animais" repetida do servidor; "Tirados do lançamento: N animal(is) volta(m) ao que era(m) antes dele" (`impactos.voltam`), "Animais que deixam de existir" só com `impactos.anulados`; "Documentos e fotos do original" (`impactos.anexos_nomes`). Valor de cada animal pelo tipo: "Custo do animal / por animal" na morte, "Receita do animal / por animal" na venda e no descarte, "Valor …" nos demais (também em "Ver os animais"). Linha do tempo da ficha: ajustes por `Store.valorLegivel` (pasto, categoria, mãe, pai e certeza pelo nome; nunca identificador nem código cru), em ordem canônica (data, classe, posição na cadeia: `AnimalService` ordena pela `ordemSeq`). Seletor com data passada: o sexo (`filtro.sexo`) vem antes da presença ("não é fêmea"). Pasto desativado e vazio: só a nota "reative-o em Editar pasto", sem "Transferir para cá" nem "Registrar a chegada". Ajuda de "Outras identificações" em linguagem de campo |
| Revisão 3 da Fase 2 (interface) | Prévia da correção (`TelaEventos.previaCorrecao`): o que o servidor propôs quando o campo veio vazio não vira valor digitado (§20, regra 8; 03b, 10.2) — a descrição proposta dos custos da compra, do custo da morte, da receita do descarte e das deduções da venda fica vazia (segue o tipo e a data); o vencimento "à vista" (o primeiro título na data do evento) fica vazio; na dedução retida, o parceiro igual ao comprador e o vencimento igual ao primeiro recebimento ficam vazios (acompanham o comprador e o recebimento corrigidos); a parcela única da compra fica sem valor; com um animal só (critério gravado DIRETO), o lote propõe CABECAS e a venda ou a compra por cabeça sem preço repõe o valor do animal. `Campos.opcoesDe(def, atual)` e as opções de parceiro, conta e categoria incluem o item desativado que é o valor atual, com o rótulo de verdade e "— desativado" (`Store.itemLista`), e `Campos.converter` o aceita (quem decide é o servidor); o valor que não está em cadastro nenhum aparece como "Valor anterior (não está mais no cadastro)", nunca o código cru. Confirmação do desfazer da importação pelo tipo e pela situação (`TelaImportacao.consequenciaDesfazer`). Visão geral: o rascunho ENVIANDO aparece como "enviado sem resposta do servidor · verificando se gravou", e o Descartar pergunta ao servidor antes de apagar (`Registro.descartarVerificando`: gravado → nada se apaga e vai ao resultado; sem resposta → o rascunho fica) |

Testes: `tests/telas.fase2.test.js` (Node: série, colagem e vencimentos; o que a grade produz aceito pelo servidor, com a
divisão das parcelas; campo do subtipo; a correção de cada tipo e subtipo de manejo e ajuste reproduzindo o original; o
financeiro do estorno; o motivo da baixa por divergência) e `tests/ui/eventos.fase2.test.js` (Playwright, a 1280 e a 360 px:
CT-03 e CT-04 inteiros pela tela, colar da planilha, estorno com dependente e auditoria, manejo pela ficha com as
correções); a compactação da página em `tests/interface.test.js`; a revisão 2 em `tests/ui/revisao2.test.js` e, no Node,
`tests/revisao2.motor.test.js` e `tests/revisao2.financeiro.test.js`; a revisão 3 em `tests/ui/revisao3.test.js` e, no Node,
`tests/revisao3.motor.test.js`, `tests/revisao3.financeiro.test.js` e `tests/revisao3.interface.test.js`.

## 35. Telas da Fase 2, etapa de pastos, importação e anexos (E2.8 a E2.10 na tela) — `Pastures`, `Import`, `Components`, `Events`, `PastureService`, `ImportService`

Nada é calculado no aparelho: a posição de cada pasto numa data sai do replay do servidor (`pasto.listar` e `pasto.painel`
com a data), o agrupamento das linhas de um lançamento sai da validação (`importacao.linhas`), e as regras de deixar de
fora e da aprovação parcial são conferidas de novo no servidor (`importacao.importarBloco`, seção 18.2).

| Peça | O que existe |
|---|---|
| `TelaPastos` (lista) | "Posição em" (`data-posicao`: data do marco zero a hoje + "Ver"): hoje, os cartões do store; noutra data, `pasto.listar` `{data, incluir_inativos: true}`, com a frase `data-posicao-em` ("Posição em dd/mm/aaaa, recalculada pelos lançamentos que valem hoje."). Cartão: Cabeças, UA, UA/ha, Ocupação (`60% (por UA/ha, estimado)`), "Acima da capacidade informada" (`data-acima-capacidade`); antes do marco zero, só "Cabeças: Sem dado (…)". A data escolhida fica na memória da tela (nunca na rota, §17) e vale também para o painel; data futura volta a hoje |
| `TelaPastos` (painel) | O mesmo campo "Posição em" (`#pst-data`), iniciado com a data da lista; a lotação usa o "Sem dado" e, sem área ou sem capacidade, a nota "informe a área e a capacidade do pasto em Editar pasto"; atalhos de registro só na posição de hoje |
| `TelaPastos.valor(campo, ind, pasto, formatar)` / `motivoSemDado(campo, ind, pasto)` | Indicador `{valor, motivo, n, estimado}` → número formatado (+ " (estimado)") ou `Sem dado (<motivo>)`. Motivo em palavras (campo: `cabecas`, `ua`, `ua_ha`, `ocupacao`, `peso`): `ANTERIOR_AO_MARCO_ZERO` → "a data é anterior ao marco zero, dd/mm/aaaa"; ocupação sem capacidade em UA/ha nem em cabeças → "o pasto não tem capacidade informada"; UA/ha ou ocupação com `SEM_VALOR_DE_REFERENCIA` sem área → "o pasto não tem a área informada"; sem peso → "nenhum animal do pasto tem peso conhecido"; pasto vazio → "nenhum animal no pasto" |
| `TelaImportacao` (1 Tipo e arquivo) | O título acompanha o tipo escolhido ("Importar compras de animais"); "Baixar o modelo da planilha" (`modelo-importacao-<tipo>.csv`, BOM e `;`, o cabeçalho do modelo do tipo, que o mapeamento reconhece inteiro) |
| `TelaImportacao` (3 Validação) | Na importação de eventos, "Como o sistema entendeu" mostra cada campo lido com o rótulo do modelo (`valorLido(campo, v)`: data, R$, parceiro e pasto pelo nome, listas pelo rótulo) e "(lançamento das linhas 2, 3)". Com a importação VALIDADO, cada linha válida tem a caixa "Deixar de fora" (`#fora-<linha>`, `data-fora` = as linhas do lançamento): marca e desmarca o lançamento inteiro; `data-deixadas` resume ("Deixadas de fora por você: N linhas (…)", "Trazer todas de volta"). A escolha fica na memória da tela até importar; validar de novo a limpa |
| `TelaImportacao.planoConfirmacao(contadores, ignorar)` | `{importar = válidas − deixadas, fora = com erro + duplicadas + deixadas, reprovadas, ignorar_linhas (números, sem repetição, crescente), modo (TOTAL só sem nada de fora; senão PARCIAL_APROVADO), aprovacao: {importar, ignorar: fora} \| null}` — o que a confirmação mostra e o bloco 1 envia; o servidor recusa grupo partido (`GRUPO_PARCIAL`), dependente de linha deixada de fora (`DEPENDE_DE_LINHA_IGNORADA`, `PROGENITOR_IGNORADO`) e aprovação diferente dos números (`APROVACAO_DIVERGENTE`), e a tela de execução mostra o motivo com "Voltar à validação" |
| `TelaImportacao` (4 Confirmação) | "Linhas que ficam de fora: N (X com problema; Y deixadas de fora por você: linhas …)"; com algo de fora, "Importar" só habilita com a caixa "Importar só as N válidas e ignorar M"; nada a importar → nota de erro e botão desligado |
| Reconciliação (`blocoReconciliacao`) | No relatório final e na lista de importações ("Reconciliação com o marco zero" › "Conferir agora", `importacao.reconciliacao`, sem gravar): resumo (na fotografia, com histórico, que não batem, pastos com contagem diferente, brincos sem animal); tabela dos animais (`data-reconciliacao="animais"`: Animal com link para a ficha, "O que não bate" = rótulo do código + explicação, No marco zero e Pelo histórico — "no rebanho, <pasto>" ou "fora do rebanho" —, O que fazer, Registro com o link "Abrir <tipo> de <data>"); tabela dos pastos (`data-reconciliacao="pastos"`: No marco zero, Pelo histórico, Diferença, Animais); lista dos brincos sem animal (`data-reconciliacao="sem-animal"`). Sem divergência: "O histórico bate com a fotografia…" |
| `Registro` (formulário de evento) | Seção `data-anexos-form` "Documentos e fotos" em todo tipo menos o ESTORNO (08, seção 4.3: depois das observações): "Anexar nota fiscal, GTA, laudo ou foto" (`Anexos.escolher`, tipo sugerido pelo evento), a lista escolhida (`data-anexo-form` = nome do arquivo, "Tirar"). Os arquivos ficam só na memória do formulário (não vão ao rascunho, que tem teto de 96 KB em partes de 8 KB: um arquivo de até 5 MB não caberia) e cada um ganha a sua chave (`anx:<uuid>`); a revisão mostra "Documentos e fotos: … (enviados depois de gravar)". Na correção (revisão 4), a seção avisa quais documentos do lançamento original passam a ela sozinhos (`corrige.anexos`, da prévia) e a revisão mostra "Documentos e fotos do original" pelos nomes que o servidor devolve em `impactos.anexos_nomes` |
| `Registro` (resultado) | Gravado o evento, cada arquivo vai por `anexo.adicionar` ao `event_id` da resposta (a correção: ao substituto), um comando por arquivo com a chave dele, e o resultado passa a ser a tela persistente (mesmo com 1 animal): `data-anexos-resultado` com o estado de cada arquivo (`data-anexo-estado` PENDENTE, ENVIANDO, ENVIADO, FALHOU com o motivo) e "Tentar de novo" (mesma chave: não duplica). O evento já gravado não depende do anexo: também dá para anexar depois pelo detalhe |

Testes: `tests/telas.pastos-importacao.test.js` (Node: `pasto.listar` com a data igual ao painel, antes do marco zero, data
futura e inválida, o estorno mudando o passado; o "Sem dado" com cada motivo sobre as respostas reais; `lancamento` em
`importacao.linhas`, inclusive noutra página; `planoConfirmacao` aceito pelo servidor só com o lançamento inteiro e com
a aprovação igual aos números, as linhas IGNORADA e a auditoria; o pedido do anexo do formulário aceito uma vez só pela
chave) e `tests/ui/pastos-importacao.test.js` (Playwright, a 1280 e a 360 px: pastos em data com o painel na mesma data
e antes do marco zero; importação de compras com o modelo baixado, "Deixar de fora" do lançamento inteiro, confirmação
parcial, reconciliação em tabela no relatório e na lista; GTA no formulário da transferência com falha de envio e
"Tentar de novo", vista no detalhe).

## 36. Teste aleatório de todos os comandos da Fase 2 (fuzz baseado em modelo) — `tests/fase2.fuzz.test.js`, `tests/apoio-fuzz.js`, `tests/fase2.fuzz.regressoes.test.js`

Garantia que vale para todos os caminhos, em vez da lista de conferências de cada um: depois de qualquer comando da Fase 2,
pela `api()` (como a tela chama), o estado inteiro confere. O motor é `tests/apoio-fuzz.js` (não é arquivo de teste).

| Peça | Contrato |
|---|---|
| Registro único dos tipos (Fase 3, etapa BASE) | Cada tipo de evento do gerador (o subtipo do ajuste conta como tipo) é uma entrada de `registrarTipo(nome, {peso(S), propor(c), montar(sis, spec), animais(spec), mudaData, dataAntiga, mutarAnimais(c), mutarValores(c), mutarOutro(c), criados(spec, proximo), doGravado(c, e), efeito(c)})` (obrigatórios: `peso`, `propor`, `montar`, `animais`, `efeito`); cada tipo de importação, de `registrarImportador(tipo, {vezes, arquivo(c)})`. O sorteio do "registrar" (pesos na ordem de registro), a correção (`mutar` delega o que muda a cada tipo), a correção para outro tipo, a correção pelas linhas gravadas (`specDoGravado`), a memória dos animais criados e o oráculo do efeito (`oraculoEfeito` → `efeito` da entrada, com o contexto do evento gravado) só consultam os registros (`TIPOS`, `IMPORTADORES`, exportados). A reorganização foi conferida pela sequência: 24 sementes × 60 passos com os mesmos comandos e os mesmos desfechos antes e depois. `stats.porEvento`: registro ou correção aceitos por tipo e subtipo. Teste novo: todo tipo e subtipo ativo do catálogo tem entrada e é aceito ao menos uma vez nas sementes fixas, nenhuma entrada é de tipo inativo, e todo tipo importável (`ImportService.modelo().tipos`) tem arquivo — o tipo que fica ativo sem a sua entrada falha no `npm test` |
| PESAGEM (Fase 3, E3.1) | Entrada `registrarTipo('PESAGEM', …)` (peso 6): de 1 a 4 animais presentes no dia (hoje ou outra data da vida deles), momento, método e jejum sorteados, 15% por lote (10% destes com uma cabeça a mais, recusada), o peso perto do último (10% um peso qualquer de 60 a 660 kg, que costuma dar o aviso PESO_IMPLAUSIVEL, na lista de avisos aceitáveis; 4% fora da faixa ou com duas casas, recusado); a correção tira ou põe animal, muda os pesos ou o total do lote, liga ou desliga o lote, troca o momento ou o jejum; `doGravado` refaz a especificação pelas linhas de PESAGENS e pelo payload; o efeito confere uma PESAGENS por animal com a data do evento, o momento, o método (MEDIA_LOTE no lote), o peso (a média de 1 casa no lote) e a linha do animal com efeito 0. Oráculo global novo `REPLAY:PESO_ATUAL`: o peso atual e a data da última pesagem de cada animal = a última pesagem vigente (data, posição na cadeia, sequência) pelas linhas cruas de PESAGENS. O gerador da IDENTIFICACAO sorteia o subtipo antes (a primeira identificação vai para um animal sem brinco 70% das vezes): com a PESAGEM no sorteio, a primeira identificação deixou de ser aceita nas 16 sementes de antes, e a semente 57 entrou nas fixas |
| SANIDADE e ESTOQUE (Fase 3, E3.2 e E3.3) | Montagem com três produtos, criados depois do rebanho de base (os identificadores dele, que as regressões fixas citam crus, não mudam) (`@v:vacina` com estoque e 50 doses por frasco, custo 1,85; `@v:vermifugo` em mL sem estoque, 0,035; `@v:antibiotico` em mL com estoque, 0,5) e o protocolo `@q:vacina` (a cada 180 dias). Entrada `registrarTipo('SANIDADE', …)` (peso 10): 1 ou até 4 animais presentes no dia, o subtipo sorteado (os seis), o produto do subtipo (75%), outro do cadastro, o nome livre (às vezes com dose e unidade) ou nenhum (a recusa onde é obrigatório); o modo por cabeça, por peso (SEM_PESO quando o animal não tem peso nem referência) ou total, a dose de um animal, a quantidade informada, o protocolo (na vacinação; 3% noutro procedimento, a recusa), a carência, a próxima (0 dia = DATA_INVALIDA), o lote vencido (PRODUTO_VENCIDO), o serviço pago no ato em 3 parcelas; a correção tira ou põe animal, muda a dose, a quantidade, a carência e o serviço, troca o subtipo (refeito o que é dele), o produto, o modo, o protocolo e a próxima; `doGravado` pelas linhas de SANIDADE, pelo payload e pelo lançamento do serviço. O efeito confere um registro por animal (procedimento, data, produto, nome, protocolo, fim da carência, próxima pelo protocolo), a dose pelo modo, a unidade, a saída do estoque (a informada ou a soma das doses), o consumo (centavos de quantidade × custo do produto agora, conta pela categoria, sem parcela), o serviço com as parcelas, o custo de cada animal = alocações, o rateio por cabeça com diferença de no máximo 1 centavo e `total_value`. Entrada `registrarTipo('ESTOQUE', …)` (peso 3): entrada (embalagens, quantidade ou as duas que não batem; à vista ou em parcelas; fornecedor) ou acerto (contagem, perda, vencimento) do produto com estoque (70%) ou de qualquer um (o sem controle é a recusa no acerto); o efeito confere o lançamento COMPRA_INSUMOS com o produto e a quantidade, as parcelas, o movimento só com o controle (custo por unidade = valor ÷ quantidade) e, no acerto, o movimento = contado − saldo na data (sem o próprio evento) ou − perda. Cadastros no meio: o produto liga e desliga o estoque, muda o custo, é desativado e reativado ou troca a unidade (PRODUTO_EM_USO depois do uso); o protocolo muda o intervalo ou é desativado. Avisos novos aceitáveis e com política: ESTOQUE_INSUFICIENTE e PRODUTO_VENCIDO. Oráculo global novo `REPLAY:ESTOQUE`: o `estoque_atual` de cada produto = Σ dos movimentos vigentes (entrada +, saída −, acerto com o sinal) com o controle ligado, vazio sem ele, pelas linhas cruas. As 17 sementes fixas aceitam os seis subtipos e os dois do estoque sem mudar a lista |
| Montagem (`montar(opcoes)`) | `setup()` do editor; pela `api()`: propriedade, pastos A (5 ha, 6 cabeças), B e C (sem área), fornecedor, comprador, transportador e corretor, o marco zero 01/01/2026 (`vazio`: sem marco zero e sem rebanho), `importacao_lote_linhas = 2`, o reuso de brinco (`reuso`), um touro de referência e o rebanho de base de 8 animais (mãe e cria ao pé, touro, prenhe, valor de abertura). `opcoes = {ordem (alpha \| reverse: a ordem de carga do `src/`), reuso, vazio}` vem da semente |
| Gerador (`gerar`) | A cada passo, pelo estado lido cru da planilha (sem `Timeline`): registrar os 10 tipos ativos e os subtipos (rebanho inicial, outra entrada nova e volta, compra por cabeça, kg vivo, arroba de carcaça e de peso vivo, lote com cada critério e valor de cada animal, com frete, outros custos e parcelas vazias, explícitas, com 1 centavo de erro ou nenhuma; venda com as mesmas modalidades, desconto, deduções e dedução retida; transferência; morte e descarte com o lançamento; parto com gêmeos, natimorto, pai e data antiga; identificação nos três subtipos e em outros tipos; marcação; correção de cadastro, brinco lançado errado, correção de localização, reclassificação, baixa na contagem), corrigir (a especificação do lançamento gravado mudada: data, animal a mais ou a menos, valores, atributos de quem ele criou; também o substituto de um substituto), estornar (também o ESTORNO e o já anulado), `animal.editar` (mãe, pai, sexo, nascimento, chegada, castrado, origem, nome), `config.salvar` (reuso de brinco, zeros à esquerda, marco zero), importação de ANIMAIS e dos 5 tipos de evento (criar, validar cada bloco, validar de novo, importar com TOTAL ou PARCIAL_APROVADO, concluir, desfazer; também com outra em curso e o comando de negócio no meio), reenvio com a mesma chave e `dataVersionEsperada` velha. Passada 2: desativar e reativar no meio o pasto (o Pasto D,
vazio na montagem, e os outros), o parceiro e a categoria (`pasto.salvar`, `parceiro.salvar`, `categoria.salvar`); corrigir
o evento montado pelas linhas gravadas (`specDoGravado`: transferência, morte, parto, compra, venda e identificação, também
os importados, que não têm a especificação do gerador); corrigir para outro tipo ou subtipo; a mesma chave com outro
conteúdo (`IDEMPOTENCY_MISMATCH`, num campo que o comando leva; as chaves de `importarBloco`, `concluir` e `desfazer` vêm do
`import_id`); `dataVersionEsperada` velha em qualquer comando (registrar, corrigir, estornar, editar, cadastro, marco zero);
correção de cadastro com dois animais ou dois campos do mesmo animal; `animal.editar` com dois campos; compra com até duas
voltas; outra entrada com vários animais novos e a volta com um animal novo junto; linha repetida no arquivo de mortes e de
transferências; 100 a 120 passos por semente. Passada 3: cadastros criados e editados no meio, não só desativados
(`gerarCadastro`: pasto novo e com outra área ou capacidade; parceiro novo e com outros tipos; categoria nova e com outro
sexo, faixa, condição ou prioridade, também a troca de prioridade de duas numa operação; item de lista desativado,
reativado, renomeado ou criado, entre os que os comandos usam: causa da morte, motivo e destino do descarte, tipo de parto,
dedução da venda, motivo da identificação, finalidade, raça; touro de referência novo), que os comandos seguintes usam (os
pastos, parceiros, categorias e touros vêm do estado, não da montagem); a causa, o motivo, o destino, o tipo de parto, o
motivo da troca de brinco e a raça variam; outra propriedade (nova, desativada e reativada, a padrão trocada; os pastos
novos podem ser dela e o lançamento pode levar `property_id`); anexos no evento (também no anulado e no ESTORNO), no
lançamento e no animal (foto principal), e a remoção; corrigir a entrada gravada (`specDoGravado` com ENTRADA_INICIAL e OUTRA_ENTRADA:
o rebanho de base da montagem e a entrada da importação de ANIMAIS); reenvio e mesma chave com outro conteúdo também de um
comando antigo, depois de o estado mudar; desfazer de preferência a importação com evento corrigido ou estornado;
`importacao_lote_linhas` e `faixas_etarias_meses` mudados no meio; importação de ANIMAIS com pai (também o touro de
referência pelo nome), chegada e raça, e de NASCIMENTOS com o pai; versão velha também no reuso de brinco. As rotas
`importacao.*` não levam `dataVersionEsperada` (a confirmação revalida) e ficam fora da versão velha. Datas: as do animal (nascimento e véspera, cada lançamento dele, saída e dia seguinte), o marco zero, hoje, amanhã, antes do marco zero. Animais: os presentes na data (85%), qualquer um, o de referência e um inexistente; 35% dos passos usam os animais dos últimos comandos aceitos; brincos repetidos de propósito (o de outro animal, com zero à esquerda). Metade dos comandos vai sem aceite de aviso: com `NEEDS_CONFIRMATION`, a recusa é conferida e o pedido volta com os códigos aceitos, como a tela faz; 25% passam antes pelo `evento.simular` |
| Oráculo de cada passo (`executar`) | Aceito: o efeito que o pedido manda (`oraculoEfeito`: o evento vale, do tipo e da data pedidos, o original anulado na correção; o animal que sai está fora do rebanho no fim do dia e, sem lançamento posterior, com a situação e a data de saída; a transferência e a correção de localização com o pasto; o animal novo com o sexo, o brinco, o pasto e a origem pedidos; o parto com as crias vivas, a mãe, o nascimento e a linha PARTO; a identificação com o código; a marcação, a reclassificação e a correção de cadastro valendo quando são as últimas; o brinco lançado errado trocando o número em uso NA POSIÇÃO dele; venda, compra, morte e descarte com os valores pedidos; a importação no estado do passo e os eventos dela valendo ou não; a configuração gravada; a resposta com os animais como gravados). Recusado: código conhecido, mensagem e detalhes em português, `data_version` e linhas iguais, a chave livre (`operacao.status` INEXISTENTE). Simulação = comando (o mesmo desfecho; com a importação em curso, só o comando é recusado, desenho-base 16.8). Depois de todo passo (`oraculoGlobal`): `sistema.integridade` sem ERRO; `Timeline.conferir` e `FinancialService.conferir` vazios; as invariantes de 03b, seção 14, nas linhas cruas (`apoio-oraculos.invariantesCruas`, agora com a vigência da importação); um replay independente de cada animal (situação, pasto e saída gravados = replay; entradas e saídas alternadas, origem de cada movimento = pasto de antes, nada depois da morte, fato dentro da permanência); o brinco lançado errado de cada AJUSTES vigente; nenhum animal no rebanho em pasto desativado e nenhum animal (fora
ANULADO e PENDENTE) em categoria desativada escolhida à mão (passada 2); a propriedade atual de cada animal no rebanho é a
do pasto em que ele está, e nenhum fora do rebanho tem propriedade atual (passada 3); `inventario.posicao` e `inventario.elegiveis` (transferência e parto) = replay numa data do passo e hoje |
| Oráculos metamórficos (passada 3) | Não dependem de prever a regra, e pegam também a recusa indevida. **Estorno imediato** (`oraculoEstornoImediato`): logo depois de um registro aceito, sem nada gravado entre os dois (mesma `data_version`), o estorno dele é aceito e cada animal que existia volta a cada campo de projeção que tinha (`PROJETADOS`: situação, pasto, propriedade, brinco, sexo, nascimento, mãe, pai, categoria, marcações, cria ao pé, chegada, saída, custo, peso, último movimento); os criados ficam ANULADO. **Correção idêntica** (`oraculoCorrecaoIdentica`): a correção logo depois do registro com a mesma especificação (os mesmos `animal_id` criados) é aceita e não muda nenhum animal (o substituto fica na posição do original; `evento_origem_id` passa ao substituto). **Desfazer imediato** (`oraculoDesfazerImediato`): desfazer uma importação depois de concluída, sem outro comando gravado desde o primeiro bloco dela, é aceito e devolve cada animal que existia ao que era. Cadastros e anexos: todo campo pedido gravado (o cadastro novo é a única linha nova da aba), o anexo ligado ao evento pedido (o do lançamento, no FINANCEIRO), ATIVO, só em evento que vale, e a foto principal |
| Sequência gravada e encolhimento | Cada comando é gravado com símbolos no lugar dos identificadores (`@k.aN`, `@k.eN`, `@k.iN`, `@k.pN`, `@k.cN`, `@k.fN`, `@k.lN`, `@k.rN`, `@k.nN`, `@k.mN`: o N-ésimo animal, evento, importação, pasto, categoria, parceiro, item de lista, propriedade, anexo e lançamento que o passo k criou; `@r:base` a propriedade da montagem; `@l:<lista>:<código>` dos itens de lista da montagem; `@b:<brinco>` do rebanho de base, `@p:A`, `@f:fornecedor`, `@x`, `@c:<categoria>`, `@conta`). `reproduzir(opcoes, comandos)` repete num sistema novo (o comando cujo símbolo ficou sem dono é pulado, e o reenvio cujo comando original ficou fora também) e devolve a primeira falha; `encolher` (ddmin) chega à menor sequência com a mesma assinatura (`INTEGRIDADE:<CHECAGEM>`, `EFEITO:<tipo>`, `RECUSA:MUDOU`, `REPLAY:...`, `SIMULACAO`...) |
| Execução | `npm test` roda 17 sementes fixas de 60 passos (o arquivo em cerca de 30 s) e confere que cada tipo foi aceito, com correções, estornos e recusas. `FUZZ_SEMENTES=N` roda N sementes novas a partir de `FUZZ_INICIO` (padrão: o relógio); `FUZZ_PASSOS` (padrão 60), `FUZZ_SAIDA=<pasta>` (cada falha encolhida em JSON), `FUZZ_ENCOLHER=0`, `FUZZ_LOG_TRAVA=1` (lista as recusas da trava). Em falha, imprime a semente e a sequência mínima, pronta para `tests/fase2.fuzz.regressoes.test.js`, que repete cada caso com o mesmo oráculo e confere o desfecho de cada passo |

**Passada 4** (gerador ampliado; lacunas achadas na leitura de `tests/apoio-fuzz.js`): o período financeiro fechado
(`fin_bloqueio_ate`) nunca era ligado; a política de avisos (`avisos_politica`) nunca mudava; os parâmetros que mudam regra
e projeção (idade da desmama, idade reprodutiva, gestação, tolerância do parto, arroba, rendimento, tolerância da
conferência, brinco só de números) ficavam fixos; o brinco com letra ou hífen não aparecia; a correção mudava uma coisa só
(nunca data, animais e valores juntos) e nunca o parceiro, a propriedade, o subtipo da identificação e da marcação, a
origem da venda e da transferência; os ajustes de um animal por item (reclassificação, brinco lançado errado, correção de
localização) tinham sempre um animal (nunca vários, nem o mesmo duas vezes); a `dataVersionEsperada` só ia velha (nunca a
atual, que deve passar); o arquivo de compras tinha uma compra só, por cabeça, sem frete nem parcelas, e o de vendas uma
venda só; o mesmo arquivo nunca era enviado de novo. Tudo isso entrou (ações `parametro`, `bloqueio`, `politica`,
`versaoAtual`; `maisAjustes`, `mutarVarias`; os arquivos de compras e vendas com mais de um grupo, kg, frete e parcelas;
"importar o mesmo arquivo de novo"), com três oráculos novos que valem para todo caminho:
- **período fechado** (`oraculoPeriodo`): o comando aceito que cria lançamento (o do bloco importado ainda sem status) ou
  cancela um que valia, com competência até `fin_bloqueio_ate` em vigor antes dele, passou pela confirmação
  `PERIODO_BLOQUEADO` (política AVISA), foi recusado (BLOQUEIA) ou nada (IGNORA); o aviso só é pedido quando o comando
  mexe num lançamento do período; às vezes o pedido volta sem a justificativa (`semJustAviso`), e a recusa
  `CAMPO_OBRIGATORIO` é o esperado;
- **política de avisos** (`oraculoPolitica`, `oraculoPoliticaGravada`): todo aviso pedido (`NEEDS_CONFIRMATION`), por
  qualquer rota, e todo aviso aceito gravado em `EVENTOS.payload_json` tem a política AVISA (a carência fica fora);
- **versão atual**: com a `dataVersionEsperada` atual, o comando nunca é recusado como se os dados tivessem mudado.

Achados desta etapa (cada um com o caso em `tests/fase2.fuzz.regressoes.test.js`, que falha no código de antes):
- O brinco lançado errado corrigido para antes de uma troca de brinco do mesmo dia: o substituto ocupa a posição do
  original e corrigia um número que ainda não estava no animal (o número da troca ficava gravado como "lançado errado" e
  continuava no animal). `EventService.identificacaoIncorreta_` passou a conferir a posição, não só a data
  (`ANTES_DA_IDENTIFICACAO`, seção 14).
- O mesmo defeito por outros caminhos (a troca levada para antes por correção, a troca ou a primeira identificação
  registradas ou estornadas em volta, o brinco de criação corrigido): a verificação de integridade confere, em
  LINHA_DO_TEMPO, que todo brinco lançado errado vigente troca o número em uso na posição dele (seção 11), e a trava
  recusa todo caminho que o quebre (seção 10.5).
- Passada 2 (gerador ampliado): o animal que volta ao rebanho dentro de um pasto desativado (o estorno da morte ou da
  transferência que o tirou do pasto depois desativado; 03a, seção 2.1: pasto INATIVO só sem animal ativo) e a correção
  que muda a ordem das reclassificações e devolve o animal a uma categoria desativada (o estorno conferia
  `CATEGORIA_INATIVA`, a correção não). As duas regras entraram em LINHA_DO_TEMPO (seção 11), e a trava fecha todo caminho.
- Passada 2, no modelo do teste: a mesma chave com outro conteúdo precisa mudar um campo que o comando leva (a importação
  monta os dados dela e ignora o resto), e `reproduzir` pula o reenvio cujo comando original ficou fora da sequência
  (sem ele, o reenvio é um comando novo e o encolhimento chegava a uma falha diferente com a mesma assinatura).
- Passada 3 (gerador ampliado e oráculos metamórficos), só no modelo do teste: o reenvio (duplicado) refazia a
  especificação memorizada do lançamento sem os animais que ele criou, e a correção seguinte saía sem o `animal_id` (o
  sistema, certo, anulava o animal e criava outro); a "mesma chave com outro conteúdo" do anexo mudava a justificativa,
  que o `anexo.adicionar` não leva (o hash é dos metadados e do resumo do arquivo: é o mesmo pedido); a correção que
  mantinha a modalidade LOTE ou ARROBA de peso vivo perdia o critério, o valor do lote ou o rendimento e mandava
  `valor_animais` NaN (recusado na leitura do pedido, antes da versão). Nenhum defeito do sistema nesta passada.
- Passada 4: o desfazer da importação cancelava os lançamentos de compras e vendas importadas dentro do período
  financeiro fechado sem o aviso `PERIODO_BLOQUEADO` nem a justificativa (RN-082), que o registro, a correção, o estorno e
  o bloco importado pedem; e o aviso `POSSIVEL_DUPLICIDADE` do arquivo de importação enviado de novo não passava pela
  política de avisos (cada caminho aplicava a sua; a importação não). Fechados na UnitOfWork, para todo caminho: a
  política aplicada a todo aviso e o aviso da trava do período (seção 10.5, item 6); a tela da importação pede o "Vi e
  confirmo" e a justificativa no desfazer e no bloco (`tests/ui/importacao-periodo.test.js`).
- Passada 4 (leva final, semente 85086): no mesmo "brinco lançado errado", um animal recebe o número que o outro tinha
  por engano (2 → 7 e 7 → B-4). O registro aceitava (o número corrigido não é reuso), mas a correção idêntica era recusada
  com `BRINCO_APOSENTADO`: no substituto, o número aparecia encerrado pela projeção gravada do original, cuja correção
  ficava de fora. `EventService.conferirBrincos_` passa ao `reusoDeBrinco_` os números que as correções de brinco do
  próprio lançamento tiram (seção 14).
- Passada 4, no modelo do teste: o lançamento do bloco importado nasce sem status (vale na conclusão), e o oráculo do
  período contava só o ATIVO; a simulação responde pela primeira chamada, e o pedido sem a justificativa do período é
  recusado só na segunda; os oráculos metamórficos (estorno imediato, correção idêntica, desfazer imediato) vão sempre
  com o aceite e a justificativa.
- No modelo do teste (não no sistema), as invariantes cruas de `apoio-oraculos.js`: o lançamento sem parcela de evento
  anulado fica SEM_CAIXA (03b, seção 10.4: "vigente ou não"), o evento de importação desfeita fica CANCELADO sem anulador
  (o predicado de 02, seção 5.1), e o registro anterior ao marco zero conta os animais com efeito 0 em `qtd_animais`.

Para acrescentar um tipo (Fases 3 e 4): uma entrada `registrarTipo` em `tests/apoio-fuzz.js` (o gerador do pedido válido e
inválido, a montagem, o que a correção muda, a especificação pelas linhas gravadas quando a correção pelo gravado servir ao
tipo, e o oráculo do efeito: o fato novo gravado e a projeção), e, se o tipo for importável, uma `registrarImportador`.
O peso entra na ordem de registro (as sementes fixas mudam de sequência: rodar as fixas de novo e pelo menos 100 novas).

Medidas de que o oráculo enxerga: com a trava desligada numa cópia do projeto, 10 de cerca de 120 sementes falham (brinco
repetido, a fêmea prenhe com o sexo ou o nascimento corrigidos, o brinco lançado errado); com o projetor errado de
propósito (a marcação de não localizado esquecida depois de junho), 3 de 30 sementes falham pelo efeito pedido, que a
verificação de integridade sozinha não vê (o projetor erra igual na gravação e na reconstrução).

**Fuzz das Fases 1 a 3, passada 1** (gerador ampliado com a Fase 3; lacunas achadas na leitura de `tests/apoio-fuzz.js`):
os tipos e subtipos da Fase 3 já tinham entrada, mas o modo curral e o tronco em blocos nunca eram mandados (nem o
reenvio com a chave do bloco, nem a conferência `operacao.status`); a dose por kg era conferida só como "positiva"; o
controle de estoque ligava e desligava raramente (um item entre 20 do cadastro); havia um protocolo só (editado, nunca
criado, nunca de aplicação única ou de campanha) e a agenda nunca era consultada; a estação de monta era escolhida sem a
data cair nela (quase sempre `FORA_DA_ESTACAO`), o parto nunca era da fêmea prenhe nem corrigido depois do diagnóstico;
as interações com a Fase 2 (venda na carência, aplicação retroativa sobre a venda, pesagem de quem saiu, diagnóstico da
fêmea que saiu, estorno da compra de insumo já consumido) só apareciam por acaso; o arquivo de sanidade não tinha
carência, próxima nem dose por kg; os indicadores, a agenda, o GMD e as consultas de manejo não tinham oráculo. Tudo isso
entrou:

| Peça | Contrato |
|---|---|
| Curral e tronco (`gerarLida`) | Uma fila por vez (`sis.lida`), começada pela ação `lida` e continuada em 50% dos passos seguintes (outros comandos no meio): o curral (PESAGEM do lote de um pasto, com método, momento e jejum da fila) ou o tronco (DIAGNOSTICO_GESTACAO com as teclas p, p90, v, d, a estação e o método); blocos de 1 a 3 animais, cada um com a chave própria `lida:<passo>:<n>` (`chaveFixa`, gravada na sequência); às vezes o animal de um bloco anterior no mesmo dia (peso substituído) ou o mesmo animal duas vezes no bloco (a recusa); o bloco sem sinal (a chave existe e o pedido não chega: só a conferência), o reenvio de qualquer bloco (gravado: duplicado; recusado ou não enviado: um comando novo), a conferência de um bloco e o "terminar". O cliente manda sem aceite; o aviso do servidor volta com o aceite e a mesma chave ("Está certo") |
| Interações (`gerarInteracao`, ação `interacao`) | A venda dentro da carência (no dia da aplicação, no meio, no último dia, no seguinte; para abate e para recria), a aplicação com carência que a venda seguinte encontra, a aplicação retroativa cuja carência cobre (ou não, por um dia) uma venda gravada, as duas também pela importação (VENDAS de um animal em carência; SANIDADE com carência sobre a venda); a pesagem, a aplicação e a ocorrência de quem já saiu (no dia da saída, depois, antes); a venda, a morte ou o descarte corrigidos para antes de uma pesagem ou de um registro reprodutivo do animal; o diagnóstico e o aborto da fêmea que saiu; o parto da prenhe (na previsão, 15 dias antes, dentro da gestação), o parto corrigido depois do diagnóstico (a data em volta do diagnóstico, outra mãe) ou estornado; o aborto da exposta, inseminada ou prenhe; o estorno da compra de insumo já consumido e a correção dela para menos ou para depois; a desmama das crias nascidas na fazenda; a castração do touro do lote (no dia da exposição, antes, depois); a dose por kg com e sem pesagem (no dia, depois, 200 dias depois, antes), às vezes com a dose de um animal; a reprodução dentro e na borda da estação e o diagnóstico das expostas nela |
| Cadastros e parâmetros | O controle de estoque ligado e desligado (ação `estoqueLiga`); o protocolo novo (intervalo, aplicação única ou campanha; sexo; faixa de idade, às vezes invertida; às vezes a categoria e a antecedência própria) e o editado também na recorrência, no sexo e na idade mínima; a aplicação escolhe um protocolo do mesmo procedimento (às vezes outro: `PROTOCOLO_DE_OUTRO_PROCEDIMENTO`); o arquivo de sanidade com carência, próxima e dose por kg |
| Chave do bloco (`executar`, `executarStatus`) | `sis.chavesGravadas` guarda a chave de cada bloco aceito com o evento gravado. O reenvio com uma chave gravada tem de ser duplicado, sem gravar nada e com a resposta do mesmo evento; `operacao.status` responde CONFIRMADA com o mesmo evento (no resumo) para a chave gravada e INEXISTENTE para a não enviada ou recusada, sem gravar nada. A expectativa vem do que o sistema gravou na própria execução, e vale também na sequência encolhida |
| Dose por kg (efeito da SANIDADE) | Sem a dose do animal, a dose por kg = round4(dose por kg × a última pesagem vigente até a data, pela data e pela posição na cadeia); com peso de referência em alguma categoria, só a pesagem dentro de `peso_validade_dias` decide (senão vale o peso de referência da categoria na data, fora do modelo); sem peso nenhum, aceita é falha. Por peso com mais de um animal, cada parte do consumo a menos de 1 centavo de valor × dose ÷ Σ doses |
| Avisos de transição (`oraculoAvisosDeTransicao`) | Depois de registrar, corrigir, estornar, importar um bloco ou desfazer aceitos: o produto com estoque controlado (antes do comando) cujo menor saldo ao fim de cada dia ficou abaixo de zero e mais baixo que antes (RN-057) passou por ESTOQUE_INSUFICIENTE (política AVISA) ou não podia ser aceito (BLOQUEIA); cada par novo venda vigente × aplicação vigente cuja carência cobre a data da venda (RN-072; a venda anterior ao marco zero fica fora) passou por CARENCIA_ATIVA (na venda para abate, pela política: BLOQUEIA não aceita, IGNORA dispensa). A confirmação é o pedido de NEEDS_CONFIRMATION ou o aceite gravado no lançamento novo (`payload_json.avisos_aceitos`) ou na operação; os eventos da importação em curso contam como vigentes (o bloco grava antes da conclusão) |
| Agenda (`modeloAgenda`, `oraculoAgenda`) | Depois de todo comando que gravou, `sanidade.agenda` hoje e na data do lançamento = um modelo escrito no teste: os animais no rebanho ao fim do dia; por protocolo ativo de intervalo ou de aplicação única sem categoria (as campanhas e os por categoria ficam fora), sexo, faixa de idade em meses completos, devendo (aplicação única passada a idade máxima), vencimento (próxima gravada na última aplicação do protocolo — a última pela data e pela posição na cadeia —, senão + intervalo; nunca aplicado: a entrada ou a idade mínima; aplicação única: a idade máxima, a mínima ou a entrada) e situação pela antecedência; sem protocolo, a próxima da última aplicação do produto; e a carência de cada animal (o maior fim, ≥ D, das aplicações até D); o resumo bate com as listas |
| GMD (`oraculoGmd`) | Os intervalos de `peso.desempenho` (curvas) dos animais do comando e dos mais pesados (até 3) = o modelo: pesagens vigentes individuais (balança; fita com `gmd_aceita_fita`), uma por dia (a de depois na posição), ganho com uma casa, dias e GMD = ganho ÷ dias com três casas só com as duas na mesma permanência e com `gmd_intervalo_min_dias` |
| Indicadores e consultas (`oraculoManejo`) | `reproducao.indicadores` de cada estação (as 3 mais recentes) e sem estação responde; as expostas = as fêmeas com exposição, cobertura ou inseminação vigente da estação; prenhas ≤ diagnosticadas ≤ expostas, paridas ≤ expostas; cada taxa com denominador zero ou abaixo de `indicador_n_minimo` vazia com DADOS_INSUFICIENTES (nunca zero), senão = numerador ÷ denominador com uma casa (numerador ≤ denominador, salvo natalidade e desmama, que contam crias); as categorias somam as expostas. `peso.desempenho` responde; `reproducao.matrizes` só lista fêmeas do rebanho hoje, com a situação reprodutiva da projeção |
| Cobertura (`COBERTURA`, exportado) | Quantas vezes cada oráculo novo conferiu algo de verdade; as sementes fixas (agora 22: entrou a 262, a primeira das pequenas em que uma venda entra na carência) exigem cada um: bloco reenviado depois de gravado, chave conferida CONFIRMADA e INEXISTENTE, estoque abaixo de zero pelo comando, venda que entrou na carência, pendências e carências da agenda, dose por kg, intervalos de GMD e estação com indicadores |

Medidas de que os oráculos novos enxergam (mutações numa cópia do projeto, `src/` mudado de propósito): sem o aviso
ESTOQUE_INSUFICIENTE e com a dose por kg em duas casas, juntos, 20 de 32 sementes falham (17 por `AVISO:ESTOQUE_SEM_AVISO`,
3 por `EFEITO:SANIDADE`); sem a carência contra a venda gravada, 1 de 40
(`AVISO:CARENCIA_SEM_AVISO`); com a idade mínima do protocolo contada errado (≤ em vez de <), 2 de 24
(`AGENDA:PENDENCIAS`). Mudar o intervalo do protocolo na conta da agenda não muda nada: a próxima de cada aplicação com
protocolo é gravada no registro (o intervalo só vale para a aplicação sem a próxima).

Achados desta passada: nenhum defeito do sistema. No modelo do teste, um (semente 7106, `SIMULACAO`): no período
financeiro fechado, o comando aceito de volta sem a justificativa do aviso (`semJustAviso`) para na recusa
CAMPO_OBRIGATORIO depois da confirmação, antes da trava; a simulação, que não confirma nada, chega à trava (CONFLICT).
O oráculo da simulação já aceitava esse par sem o pedido de volta e passou a aceitar também com ele sem a justificativa;
o caso está em `tests/fase3.fuzz.regressoes.test.js` (que falha no modelo de antes).

Execução desta passada (`FUZZ_PASSOS=100`): 1.240 sementes novas × 100 passos com o gerador nas versões da passada, sem
falha do sistema; a leva final, com o gerador final e depois do conserto do modelo, 500 sementes (950000 a 950499): 27.297
comandos aceitos, 17.064 recusados, 0 falhas. As 22 sementes fixas de 60 passos rodam em cerca de 40 s no `npm test`.
Depois da retomada (o contêiner reiniciou; nada no gerador nem em `src/` mudou), a leva de sementes novas que fecha a
passada: 400 sementes (970000 a 970399) × 100 passos, 22.618 comandos aceitos, 13.390 recusados, 0 falhas. Nas 400, cada
item da lista foi mandado e aceito ao menos uma vez (curral e tronco: 407 primeiros blocos aceitos, 216 reenvios de bloco
já gravado, 733 conferências da chave; venda na carência: 4 para recria e 2 para abate aceitas, 8 para abate recusadas por
CARENCIA_ATIVA com a política BLOQUEIA, e 35 vendas que entraram na carência por todos os caminhos; parto corrigido depois
do diagnóstico 25; pesagem de quem saiu 10; diagnóstico de fêmea que saiu 23; estorno da compra de insumo consumido 8; dose
por kg 63; reprodução na estação 3; estoque ligado 97 e desligado 157; protocolo novo 53; arquivos de PESAGENS 73, SANIDADE
95, REPRODUCAO 72 e OCORRENCIAS 72; desfazer 721), salvo a venda levada para antes da pesagem ou do parto: as 4 sorteadas
caíram todas na véspera do fato e foram recusadas por FORA_DA_PERMANENCIA, como manda a regra (a morte e o descarte levados
para o dia do fato foram aceitos). As 24
recusas da trava em 160 delas (970000 a 970159, `FUZZ_LOG_TRAVA=1`) são todas de regras que ela guarda por desenho
(seções 11 e 40): a castração que a correção do rebanho de base passaria a repetir (10), o registro reprodutivo de quem
passaria a ser macho ou nascida no dia dele (8), o animal que voltaria a um pasto desativado (4) e a mãe de uma cria já
desmamada trocada no cadastro ou na correção do parto (2, `INTEGRIDADE_COPIAS` da desmama).

**Fuzz das Fases 1 a 3, passada 2** (lacunas achadas na leitura de `tests/apoio-fuzz.js` e nas contagens de uma leva com o
gerador da passada 1, 30 sementes × 100 passos): cerca de 70% das interações sorteadas voltavam vazias (sem estação, sem
compra de insumo, sem prenhe, sem fêmea que saiu, sem venda de animal tratado), e por isso a reprodução na estação, a venda
na carência e o parto da prenhe quase não aconteciam; a venda e a aplicação **corrigidas** para a carência, o consumo acima
do estoque, o acerto retroativo, o parto da não prenhe, o registro da mãe em volta do parto, a venda da mãe com a cria ao
pé, a saída e o estorno da desmama da cria, a pesagem levada para fora da permanência, a importação de manejo de quem saiu
e a estação com registros mudada no cadastro nunca eram montados; o produto nunca era criado (as categorias suplemento e
outro, a unidade, o fator da embalagem); os parâmetros da Fase 3 que os oráculos leem nunca mudavam; a categoria nunca tinha
peso de referência; a estação só mudava o fim; o estoque não tinha correção pelas linhas gravadas; a campanha ficava fora
do modelo da agenda e, com o relógio fixo, todo protocolo nascia "hoje" (a campanha perdida e a aplicação única devida não
apareciam); a cria ao pé não tinha replay; nenhuma correção era conferida tempo depois do registro. Tudo isso entrou:

| Peça | Contrato |
|---|---|
| Preparo (`preparoDe`) | Sem como montar a interação sorteada, o gerador monta o que falta: a estação de monta (ou a exposição na estação que ainda não tem registro), a compra de insumo com estoque controlado e o consumo dela, o diagnóstico positivo, a exposição, o parto (com as crias vivas), a pesagem, a saída de quem tem pesagem ou registro reprodutivo, a venda do animal tratado depois da carência e a aplicação com carência; a interação preparada volta logo (`sis.interacaoPendente`, 70%). `COBERTURA` conta por interação o montado, o preparo e o sem como montar. A venda das interações usa o negócio sem erro de propósito (`negocioLimpo`: por cabeça, uma parcela) |
| Interações novas (`interacaoDe`) | A venda gravada corrigida para dentro da carência (no dia da aplicação, no meio, no último dia, no seguinte; às vezes para abate) e a aplicação corrigida com a carência que passa a cobrir a venda; o consumo acima do saldo (registro e correção que aumenta a quantidade); o acerto (contagem, perda, vencimento) datado antes de saídas gravadas; o parto da vazia, exposta ou inseminada; o diagnóstico, o aborto, a exposição ou a inseminação da mãe em volta do parto e o registro dela levado por correção para perto do parto; a venda ou a morte da mãe com a cria ao pé (às vezes com a cria), a saída da cria desmamada, a desmama corrigida para depois da saída da cria e o estorno dela; a pesagem corrigida para a saída, depois dela ou antes da entrada; a importação de pesagem, ocorrência, aplicação e diagnóstico de quem saiu; as datas da estação mudadas com registros e a correção de um registro dela fora das datas novas |
| Cadastros e parâmetros | Produto novo nas cinco categorias (a conta do consumo é a da categoria), com unidade, fator, custo, controle de estoque, os padrões que a tela sugere e às vezes o nome de outro ativo (`NOME_REPETIDO`); o controle ligado e desligado também nos produtos novos; a categoria com peso de referência (a dose por kg sem pesagem válida); a estação editada no início, no nome (às vezes o de outra), no tipo e na propriedade; o protocolo de campanha mais frequente, com tolerância própria, e editado nos meses; os parâmetros `peso_validade_dias`, `gmd_intervalo_min_dias`, `gmd_aceita_fita`, `indicador_n_minimo`, `prenhez_cobertura_dg_min_pct`, `agenda_antecedencia_dias`, `agenda_tolerancia_dias` e `alerta_parto_previsto_dias` mudados no meio |
| Relógio do pedido (`relogio`) | A montagem cadastra a vermifugação de campanha `@q:campanha` (maio e agosto) com o relógio no marco zero, e metade dos protocolos novos sai com o relógio de um dia do passado (gravado na sequência; só o pedido usa esse relógio, os oráculos consultam hoje): o cadastro guarda quando foi criado, e a campanha perdida e a aplicação única devida dependem disso |
| Estoque pelas linhas | `doGravado` do ESTOQUE (o lançamento sem linha de animal): o produto, a quantidade, o valor, as parcelas e o parceiro da compra; o motivo, o saldo contado ou a quantidade do acerto; o lote do movimento |
| Agenda: campanha (`modeloAgenda`) | O protocolo de campanha sem categoria entra no modelo: a campanha de cada mês vence no último dia dele e é cumprida pela aplicação do protocolo entre o primeiro dia − tolerância e o último + tolerância (a do protocolo, senão `agenda_tolerancia_dias`); a última campanha vencida desde que o animal ficou elegível e desde o cadastro do protocolo, não cumprida, continua devida (VENCIDA) até abrir a janela da seguinte; depois, vale a seguinte |
| Replay da cria ao pé (`REPLAY:CRIA_AO_PE`) | Pelas linhas cruas: a fêmea tem cria ao pé quando um filho dela (`mae_id`) está no rebanho, sem desmama vigente, e nasceu na fazenda ou entrou mais novo que `idade_desmama_padrao_meses` (meses completos na data do lançamento que o criou) |
| Correção sem mudança, mais tarde (`correcaoTardia`, `oraculoCorrecaoTardia`) | Um lançamento de manejo que vale (pesagem, sanidade, estoque, reprodução, desmama, castração, ocorrência), corrigido com a especificação com que foi aceito muito depois do registro, de preferência quando o cadastro que ele usa mudou (o produto ou o protocolo desativado, a estação com outras datas, o pasto de destino desativado; sem nenhum, o gerador desativa o produto ou o protocolo, ou muda as datas da estação, e a correção vem logo): aceito, salvo as recusas que o que mudou no meio explica por desenho (`VALOR_IGUAL`, `SEM_PESO`, `VALOR_FORA_DA_FAIXA`, `NAO_E_CRIA`, `ANTES_DO_MARCO_ZERO`, `PRODUTO_SEM_ESTOQUE`) e os avisos com a política BLOQUEIA; com a importação em curso, fora. O reenvio e a mesma chave com outro conteúdo, que copiam o comando, ficam fora |
| Cobertura | As sementes fixas exigem também a campanha conferida na agenda, a cria ao pé conferida e a correção tardia aceita e com o cadastro mudado (as 22 sementes de antes cumprem sem mudar a lista) |

Medidas de que os oráculos novos enxergam (mutações numa cópia do projeto, `src/` mudado de propósito; sementes 1300000 em
diante, 100 passos): a campanha perdida esquecida (`HealthService.vencimento`), 30 de 30 sementes falham por
`AGENDA:PENDENCIAS`; a cria ao pé que não sai com a desmama (`Timeline.criaAoPe_`), 6 de 30 por `REPLAY:CRIA_AO_PE` (a
verificação de integridade não vê: o projetor erra igual na gravação e na reconstrução); o cadastro que o original usava
deixando de valer na correção (`EventService.usadoNoOriginal_`), 6 de 30 por `CORRECAO_TARDIA:RECUSADA`. Antes do relógio
do pedido, a primeira dava 0 de 30 (todo protocolo nascia hoje); antes da preferência pelo cadastro mudado, a terceira dava
0 de 30 e 0 de 40.

Achados desta passada: nenhum defeito do sistema. No modelo do teste, dois, ambos da correção tardia nova (casos em
`tests/fase3.fuzz.regressoes.test.js`, que falham no modelo de antes): a "mesma chave com outro conteúdo" copia o comando
com a marca da correção tardia e a recusa `IDEMPOTENCY_MISMATCH` era tomada como recusa da correção (semente 1210049); o
acerto de estoque corrigido sem mudança depois de o controle do produto ser desligado é recusado por `PRODUTO_SEM_ESTOQUE`,
o que é o desenho (o acerto só existe com o saldo controlado; o estorno continua livre) (semente 1320022).

Execução desta passada (`FUZZ_PASSOS=100`): 1.600 sementes novas × 100 passos no sistema. Nas levas de exploração, 940
sementes com o gerador nas versões da passada (990000 a 990079, 990100 a 990139, 1100000 a 1100499, 1200000 a 1200159, 1210000 a 1210079,
1310000 a 1310039 e 1320000 a 1320039), duas falhas, ambas do modelo (acima). Depois dos consertos do modelo, com o
gerador final, 660 sementes sem falha: a leva final de 500 (1400000 a 1400499), 29.681 comandos aceitos e 16.499
recusados, e mais 160 contadas (1500000 a 1500159), 9.336 aceitos e 5.360 recusados. Nas 160: interações montadas 454,
preparos 653, sem como montar 223 (reprodução na estação 38, venda na carência 61, parto da prenhe 24, parto corrigido 21,
estorno da compra de insumo consumido 24, consumo acima do estoque 23, acerto retroativo 15, parto da não prenhe 15,
registro da mãe em volta do parto 12, desmama e venda 9, pesagem fora da permanência 11, importação de quem saiu 10,
estação mudada 6, venda corrigida para a carência 6); correção sem mudança mais tarde aceita 194, com o cadastro mudado 50;
campanha conferida na agenda 83.544 vezes; cria ao pé conferida 12.791; venda que entrou na carência 38; estoque abaixo de
zero pelo comando 194; produto novo 16; os oito parâmetros da Fase 3 mudados 76 vezes.

## 37. Telas sob demanda (Fase 3, etapa BASE) — `Api` (`sistema.tela`), `EventCatalog` (módulos), `JavaScript` (`Modulos`, `Telas`, `App`), `Index`, `scripts/ui-check.js`

Risco R-31 (`11-riscos-e-premissas.md`; 01, seção 6.2; 08, seções 2 e 14): a página montada chegou a 449 KB de 450 KB na
Fase 2. As telas das Fases 3 a 5 (Weights, Health, Reproduction, Financial, Reports) e a importação (tarefa de desktop,
pouco usada na abertura) não entram na página inicial: cada uma é um include próprio, pedido ao servidor quando o menu
abre o módulo.

| Peça | Contrato |
|---|---|
| Catálogo | O módulo declara `tela` (o arquivo) quando a tela é entregue, e `sob_demanda` + `rotas` (as raízes de rota) quando ela vem sob demanda (seção 12). O bootstrap leva isso ao cliente em `modulos`. Módulo de fase futura ou ainda sem tela: fora do menu e recusado pela rota |
| Servidor | `sistema.tela` (seção 19): guarda de dono, lista `Api.TELAS_SOB_DEMANDA`, módulo entregue, o arquivo compactado como o doGet (`Api.compactar`), sem abrir a planilha |
| Cliente | `Modulos` (seção 22): pede uma vez, injeta como nó, guarda em memória; a rota abre quando a tela chega; falha de rede → "Tentar de novo"; outra versão do app no servidor → "Recarregar a página" |
| Página inicial | `Index` com Styles, JavaScript, Components, Dashboard, Animals, Pastures, Events e Settings: 406 KB de 450 KB nesta etapa (eram 449 KB); 421 KB na E3.1 (a curva, o bloco de peso da ficha e a pesagem no formulário e no detalhe); 446 KB na E3.7 (o kit de gráficos de `Components`, seção 41) |
| Orçamento | `npm run ui:check` mede a página inicial montada pelo doGet (≤ 450 KB, sem nenhuma tela sob demanda dentro) e cada tela sob demanda que existe em `src/`, como a rota a entrega (≤ 150 KB por módulo; Import: 47 KB nesta etapa; Weights: 41 KB na E3.1; Health: 23 KB na E3.2 e E3.3, com a página inicial em 439 KB). `conferirModulos(paginas, montada)` → `{modulos: [{nome, bytes, entregue}], problemas}` acusa também a tela sob demanda posta no Index e a rota que não entrega o arquivo compactado |
| Contingência (NV) | A injeção de `<script>` criado pelo cliente dentro do iframe do HtmlService não foi verificada na conta do dono. Se o Google a bloquear, a tela volta ao Index (`<?!= include_('Import') ?>`), tira-se `sob_demanda` do módulo e o resto funciona sem mudança: a tela já registrada não é pedida |

Para entregar uma tela das Fases 3 a 5: criar `src/<Tela>.html` (um `<script>` que registra as rotas com `Telas.registrar`,
como as demais), dar ao módulo no `EventCatalog` `tela`, `sob_demanda: true` e `rotas`, e não incluí-la no `Index`.

Testes: `tests/telas.sobdemanda.test.js` (Node: a rota com a guarda de dono, sem banco, com cada recusa; a página inicial
sem a importação e dentro do orçamento; o orçamento por módulo e o conferidor; catálogo × arquivos × Index; a importação
injetada no cliente do vm), `tests/interface.test.js` (sintaxe das telas sob demanda; nenhuma no Index), `tests/apoio-telas.js`
(o cliente do vm carrega as telas sob demanda pela rota, como o menu) e `tests/ui/sobdemanda.test.js` (Playwright: fora da
página inicial, pedida uma vez pela aba de Configurações com o esqueleto enquanto vem, ir e voltar sem pedir de novo, falha
de rede com "Tentar de novo" e a volta à tela anterior a 360 px, endereço direto, menu sem os módulos da Fase 3 ainda sem
tela, outra versão do app no servidor).

## 38. Pesagem e modo curral (Fase 3, E3.1) — `WeightService`, `EventService` (PESAGEM), `AuditService`, `Api` (`peso.desempenho`), `Weights`, `Components` (`UI.curvaPeso`), `Animals`, `Events`, `JavaScript`

Desenho: 07, seção 8.1 e 8.2; 03b, seção 5; 05, seção 2.7 (RN-049 a RN-053); 08, seções 5, 6 e 9; 09, CT-05; desenho-base,
seção 6. Ganho, dias, GMD, variação, médias e projeção saem de PESAGENS na leitura, no servidor; nada disso é gravado e a
tela não refaz conta (P5). Projeção e peso de referência nunca viram pesagem (P10, RN-053) e saem sempre rotulados.

`WeightService` (puro; parâmetros de CONFIGURACOES: `gmd_intervalo_min_dias` 28, `gmd_aceita_fita`, `indicador_n_minimo` 5,
`gmd_referencia_janela_dias` 120, `projecao_peso_horizonte_dias` 90, `gmd_plausivel_min_kg_dia` −1,0,
`gmd_plausivel_max_kg_dia` 2,0, `peso_validade_dias`, `peso_nascer_padrao_kg_macho`/`_femea`):

| Função | Contrato |
|---|---|
| `serie(f, animalId, params)` | As pesagens vigentes do animal na fonte da linha do tempo, em ordem (data, posição na cadeia de substituição, `event_seq`): `[{weight_id, event_id, event_type, event_subtype, data, peso_kg, metodo, tipo, observacoes, jejum, individual, estimado, ord, seq}]`; no mesmo dia vale a de depois |
| `individual(metodo, params)`, `estimado(metodo)` | BALANCA (e FITA com `gmd_aceita_fita`) entram no GMD; ESTIMATIVA_VISUAL e MEDIA_LOTE são estimadas: ficam na série e no peso atual, nunca no GMD individual |
| `vizinhas(f, animalId, data)` | `{anterior, mesmoDia: [], seguinte}` em volta da data (os avisos da gravação) |
| `variacao(p1, p2)` | `{de, ate, peso_de_kg, peso_ate_kg, ganho_kg (1 casa), dias, gmd_kg_dia (3 casas; null com 0 dia), variacao_pct (2 casas)}` |
| `implausivel(gmd, params)` | Fora de `gmd_plausivel_min_kg_dia` a `gmd_plausivel_max_kg_dia` (RN-050) |
| `intervalos(serie, periodos, params)` | Entre pesagens consecutivas: ganho, dias e variação sempre; `gmd_kg_dia` só entre individuais da mesma permanência e com `dias ≥ gmd_intervalo_min_dias`, senão null com `motivo: DADOS_INSUFICIENTES` e `explicacao` ("O animal esteve fora do rebanho entre as duas pesagens." / "Intervalo de 10 dias, menor que os 28 dias mínimos para o ganho médio diário."); nunca zero (RN-052); E3.6: a pesagem anterior ao marco zero (histórico importado; `serie` marca `historico`) fica fora de toda permanência, com "Pesagem anterior ao marco zero: o ganho médio diário só é calculado a partir do marco zero (a pesagem antiga aparece na curva)." |
| `desempenhoAnimal(f, a, params, hoje, {de, ate}?)` | `{serie, intervalos, ganho_acumulado, gmd_periodo (Σ ganho ÷ Σ dias dos intervalos que contam), peso_atual, peso_ao_nascer (o do parto), peso_desmama, ponto_nascer_estimado (o de referência, só na curva, ou null), projecao}`; os indicadores são `{valor, motivo, n, ...}` (sem valor: `valor: null` e `motivo: DADOS_INSUFICIENTES`, nunca zero); `projecao = {valor: true, rotulo: 'Estimativa', base, referencia_de, gmd_referencia_kg_dia, horizonte_dias, ate, pontos, hoje, explicacao_hoje}` ou, sem base na permanência aberta ou sem GMD de referência, `{valor: null, motivo: 'DADOS_INSUFICIENTES', rotulo, explicacao}` |
| `blocoFicha(L, a)` | Bloco E da ficha: o desempenho do animal + `entregue: true` + os parâmetros usados |
| `resumoDoPlano(p, linhas)` | `impactos.pesagem` da simulação: `{n, total_kg, media_kg, tipo, metodo, jejum, lote}` |
| `resultadoDoEvento(tx, eventId)` | `pesagem` da resposta do registro e da correção: o resumo + `animais: [{animal_id, peso_kg, anterior, ganho_kg, dias, gmd_kg_dia, variacao_pct, peso_atual, data_ultima_pesagem, peso_vencido}]` (o modo curral e a loja do cliente usam sem recalcular) |
| `consultaDesempenho(filtros)` / `desempenho(ctx, filtros)` — `peso.desempenho` | filtros `{de, ate (padrão: marco zero e hoje), pasture_id, sexo, category_id, raca, animais (até `MAX_CURVAS` = 5)}` → `{periodo, filtros, parametros, geral, por_pasto, por_categoria, pesagens, evolucao, animais, curvas}` (`evolucao` e `por_pasto[].por_categoria`: seção 41). `geral`, `por_pasto` e `por_categoria`: cabeças e peso médio no fim do período pelo peso vigente com validade (`InventoryService.compor`: a pesagem mais recente até a data, vencida → o peso de referência, estimado) e o GMD do período como indicador `{valor, motivo, n, dias, ganho_kg, explicacao}` (o ganho de cada intervalo vai para os pastos na proporção dos dias em cada um e para a categoria do início do intervalo; n abaixo do mínimo → null). `pesagens`: os eventos PESAGEM do período com `gmd_lote` contra a pesagem anterior com ao menos n animais em comum e o intervalo mínimo ((média 2 − média 1) ÷ dias, só com os animais nas duas; senão null com "Sem pesagem anterior com ao menos 5 destes animais e 28 dias de intervalo."). Erros: `VALIDATION` (FORMATO_INVALIDO, FAIXA_INVALIDA, DATA_FUTURA, VALOR_FORA_DA_LISTA, TIPO_INVALIDO, VALOR_FORA_DA_FAIXA), `NOT_FOUND` (pasto, categoria) |
| `gmdLote(tx, eventoA, eventoB, params)` | GMD de lote (07, seção 8.1) entre duas pesagens gravadas: (média 2 − média 1) ÷ dias, só com os animais presentes nas duas; a pesagem por lote com todos em comum usa o total da balança ÷ cabeças; estimativa visual fora; menos de `indicador_n_minimo` em comum ou intervalo abaixo de `gmd_intervalo_min_dias` → `null` |
| `origemDaPesagem(f, x)` | De onde veio a pesagem, para as mensagens ("da compra", "do nascimento", "de outra pesagem"), pelo tipo do evento que a gravou |

A lotação e o peso médio do pasto em data (seção 33) já usam o peso medido mais recente até a data, com a validade: a
pesagem depois da data não conta e a vencida vira o peso de referência da categoria, marcado estimado.

Interface:

| Peça | Contrato |
|---|---|
| `Weights.html` (sob demanda, seção 37) | `TelaPesagens`; rotas `pesagens` (desempenho) e `pesagens/curral` (tela cheia). Desempenho: filtros de período, pasto, sexo, categoria e raça; indicadores (`[data-indicadores-peso]`), tabelas por pasto e por categoria, as pesagens com o GMD de lote ou o motivo do servidor, a curva de até 5 animais pelo brinco (`#curva-brinco`, "Mostrar"), os animais; tudo vem de `peso.desempenho` |
| Modo curral (`pesagens/curral`; 08, seção 5) | Começo: data (hoje), método, momento, jejum e o pasto do lote. Depois: `#cur-brinco` (`inputmode=numeric`; sem zeros à esquerda acha o brinco pela loja) → Enter → `#cur-peso` (`inputmode=decimal`) → Enter → volta ao brinco; a conferência mostra o animal e o último peso da loja; candidatos quando o número é ambíguo; contador "N de M · faltam K (+X de outros pastos)" com a lista dos que faltam; repetido na fila → "Substituir o peso"; não encontrado → linha pendente que trava o envio; "Desfazer o último". A fila é um rascunho (`Rascunhos`, id `curral-pesagem`, tipo `CURRAL_PESAGEM`, no aparelho e no servidor; a visão geral lista o rascunho com o link) e sobrevive a recarregar a página |
| Envio em blocos | `BLOCO = 20` linhas por bloco; cada bloco é um `evento.registrar` com chave própria `curral:<uuid>` guardada no rascunho antes de enviar; estados por bloco NOVO, ENVIANDO, SEM_SINAL, GRAVADO, AVISO, ERRO e por linha FILA, ENVIANDO, SEM_SINAL, GRAVADA, AVISO, ERRO, NAO_ENCONTRADO. Transporte que falha → SEM_SINAL (nada perdido); resposta perdida → `Cliente.comando` (45 s) confere `operacao.status` e reenvia com a mesma chave; ao retomar a fila, os blocos ENVIANDO/SEM_SINAL são conferidos por `Cliente.verificar` antes de qualquer reenvio — nada duplica. A linha gravada mostra o ganho e os dias contra a pesagem anterior vindos da resposta (`pesagem.animais`). Aviso do servidor (PESO_IMPLAUSIVEL, POSSIVEL_DUPLICIDADE) fica na linha; "Está certo" reenvia o bloco com o aceite. "Terminar a pesagem" recusa enquanto há bloco sem confirmação, pede confirmação para descartar o que não foi gravado, apaga o rascunho e mostra os lançamentos gravados com o número e a média do servidor (`[data-resultado-curral]`) |
| Ficha, aba Peso (`Animals`, `blocoPeso`) | Peso atual, ao nascer, à desmama, ganho no período, GMD do período e peso estimado hoje; `UI.curvaPeso`; tabela das pesagens (data, peso, como, ganho, dias, GMD, variação) e o porquê de cada GMD vazio (`data-porque-sem-gmd`); nota dos estimados |
| `UI.curvaPeso({titulo, series: [{nome, pontos: [{data, peso_kg, estimado}], nascer, projecao}]})` (`Components`) | SVG próprio, sem biblioteca: marcadores `data-marcador` = medido, estimado, nascer e projeção (linha tracejada, rótulo "Estimativa"), legenda e "Ver tabela" com as mesmas linhas ("Pesagem", "Pesagem estimada", "Peso ao nascer de referência (estimado)", "Projeção (estimativa)"); sem pontos → o estado vazio (`data-vazio`, `.grafico-sem-dados`). Na E3.7 (seção 41): eixos "Peso (kg)" e "Data", title e desc no SVG, `data-valor` e a dica em cada marca, a largura da tela |
| Formulário, revisão e detalhe (`Components`, `Events`) | PESAGEM no Registro (frequente, revisão local, verbo "Gravar a pesagem", consequência e resultado "N pesagens gravadas · média X kg"); correção pelo detalhe com o momento, o método, o jejum, o lote e o peso de cada animal como gravados (`previaPesagem_`); seções "Pesagem" e "Pesagens" no detalhe |
| Loja do cliente (`JavaScript`) | Delta de `evento.registrar` da PESAGEM: `peso_atual`, `data_ultima_pesagem` e `peso_vencido` de cada animal vindos de `pesagem.animais` (sem conta no aparelho); rótulos `TIPO_PESAGEM` |

Testes: `tests/pesagem.test.js` (os caminhos do tratador único: registro individual, coletivo e por lote, faixa e
formato, variação brusca, retroativo e fato independente, mesmo dia, correção e correção do substituto, estorno com e sem
dependente e estorno da correção, importação e desfazer, integridade de PESAGENS por adulteração e a trava em todo
caminho, lotação e peso médio do pasto em data), `tests/pesagem.desempenho.test.js` (números exatos: CT-05, uma pesagem,
mesmo dia e retroativa, saiu e voltou, métodos, peso ao nascer, projeção, GMD de lote, por pasto e categoria, a rota),
`tests/acceptance.test.js` (CT-05, CT-10 passo 3 e a base de demonstração com as pesagens), `tests/telas.sobdemanda.test.js`
(Weights entregue e no orçamento) e `tests/ui/pesagem.test.js` (Playwright a 360 px: o curral com Enter, contador, que
faltam, não encontrado, repetido, desfazer e recarregar; rede cortada, resposta perdida e reenvio com a mesma chave sem
duplicar; aviso do servidor aceito na linha; a correção pelo detalhe; a ficha com a curva e a tela de desempenho a 360 e
1280 px).

## 39. Insumos, protocolos e sanidade (Fase 3, E3.2 e E3.3) — `HealthService`, `EventService` (SANIDADE, ESTOQUE), `AuditService`, `Timeline`, `FinancialService`, `InventoryService`, `AnimalService`, `Api`, `TestRunner`, `Health`, `Components`, `Animals`, `Events`, `JavaScript`

Desenho: 03a, seções 4.6, 4.7, 4.9 e 6.4; 03b, seções 6, 15.2 e 16.4; 04, seção 4.7; 05, seções 2.8 e 4.7 (RN-054 a RN-059,
RN-072); 07, seções 5 e 8.4; 08, seções 3 (bloco F) e 7.4; 09, CT-06; desenho-base 16.9 (PR-10, PR-11). Dinheiro em centavos;
quantidades com até 4 casas, somadas em décimos de milésimo; datas yyyy-MM-dd. O estoque, a carência, a agenda e o custo de
cada animal são contas do servidor; a tela só mostra (P5).

**Cadastros.**

| Função | Contrato |
|---|---|
| `comandoSalvarProduto(pedido)` / `salvarProduto(ctx, pedido)` — `produto.salvar` | `{product_id?, campos, justificativa?}`. Nome, categoria (VACINA, VERMIFUGO, MEDICAMENTO, SUPLEMENTO, OUTRO) e unidade obrigatórios; nome único entre os ativos (`NOME_REPETIDO`); `controla_estoque` padrão N (PR-10) e `ativo` padrão S na criação; a unidade não muda depois do primeiro uso em SANIDADE ou MOVIMENTOS_ESTOQUE (`PRODUTO_EM_USO`); `estoque_atual` é projeção (nasce 0 com controle, vazio sem; ligar ou desligar o controle refaz pelos movimentos: `derivados.produtos`). Resposta: `produtoPublico` |
| `produtoPublico(repo, prod)` | O cadastro + `abaixo_do_minimo` (controle ligado, saldo e mínimo numéricos, saldo < mínimo) |
| `comandoSalvarProtocolo(pedido)` / `salvarProtocolo(ctx, pedido)` — `protocolo.salvar` | `{protocol_id?, campos, justificativa?}`. Nome, procedimento (VACINA, VERMIFUGO, MEDICAMENTO, TRATAMENTO, EXAME), sexo e recorrência obrigatórios; INTERVALO_DIAS exige o intervalo e CAMPANHA_MESES os meses 1 a 12 (lista ou texto "5, 11" → `[5, 11]`); o campo da outra recorrência → `CAMPO_NAO_SE_APLICA` (na troca, apagado); idade máxima > mínima (`FAIXA_INVALIDA`); produto e categoria existentes e ativos (`NAO_ENCONTRADO`, `PRODUTO_INATIVO`, `CATEGORIA_INATIVA`); nome único entre os ativos; `ativo` padrão S |
| `cadastros(repo)`, `LEITURAS_CADASTRO` | `{produtos (produtoPublico), protocolos}` para `sistema.bootstrap` |

**Estoque e consumo.**

| Função | Contrato |
|---|---|
| `variacao(mov)`, `saldo(movs, ate?)`, `menorSaldo(movs)`, `estoqueAtual(produto, movs)` | ENTRADA +, SAIDA −, AJUSTE com o sinal; saldo até a data (inclusive) ou de todos; o menor saldo ao fim de cada dia com movimento (`{saldo, data}`); com controle, Σ dos vigentes, sem, null |
| `valorConsumo(q, custo_unitario)` | `round(q × custo × 100)` centavos (meio para cima); 0 sem custo |
| `custoUnitarioEntrada(valor, q)` | R$ por unidade com 4 casas = valor ÷ 100 ÷ q |
| `quantidadeTexto(q, unidade)`, `descricaoConsumo(produto, q)` | "5 doses"; "Consumo de Vacina Aftosa: 5 doses" |
| `Timeline` | `projetarProdutos_`: com PRODUTOS e MOVIMENTOS_ESTOQUE lidos, o projetor grava `estoque_atual = estoqueAtual` dos produtos citados (`derivados.produtos`) ou de todos na reconstrução; `porta().reads` inclui as duas abas |

**Lançamentos (tratador único: registrar, simular, retroativo, mesmo dia, corrigir, corrigir o substituto, estornar, base de
demonstração).**

| Peça | Contrato |
|---|---|
| Cabeçalho (`cabecalhoSanidade_`) | Só os campos do subtipo contam. Produto do cadastro (`NAO_ENCONTRADO`; `PRODUTO_INATIVO` salvo se o original já o usava) ou nome livre (os dois → `CAMPO_NAO_SE_APLICA`); obrigatório em VACINACAO, VERMIFUGACAO e MEDICACAO; o fabricante vazio vem do cadastro. Protocolo existente, ativo e do mesmo procedimento (`PROTOCOLO_INATIVO`, `PROTOCOLO_DE_OUTRO_PROCEDIMENTO`). Com produto, o modo da dose é obrigatório; a unidade é a do produto (`UNIDADE_DIFERENTE`); sem cadastro, a do campo. Quantidade do frasco só com produto do cadastro. Carência: fim = aplicação + período (0 = sem carência). Próxima > data (`DATA_INVALIDA`); vazia → pelo intervalo do protocolo INTERVALO_DIAS. Lote vencido antes da data → aviso PRODUTO_VENCIDO |
| Item (`itemSanidade_`) | Linha EVENTO_ANIMAIS SUJEITO com efeito 0 (presença na data pela linha do tempo) e uma SANIDADE por animal. Dose: a do animal; senão, por cabeça, a do lançamento; por peso, round4(dose por kg × `AnimalService.pesoVigente` na data, com a validade e o peso de referência da categoria; sem peso → `SEM_PESO`); no TOTAL, a dose do animal → `CAMPO_NAO_SE_APLICA` e a linha fica sem dose. `custo` gravado = Σ das alocações (cópia; a ficha lê as alocações) |
| Consumo (`consumoSanidade_`, PR-11) | Com produto do cadastro e modo: movimento SAIDA (com ou sem controle de estoque) da quantidade informada ou da soma das doses; com custo unitário > 0, o lançamento CUSTEIO `semCaixa` (sem parcela, SEM_CAIXA) na conta da categoria (VACINA → VACINAS; VERMIFUGO e MEDICAMENTO → MEDICAMENTOS; SUPLEMENTO → ALIMENTACAO; OUTRO → TRATAMENTOS), com `product_id` e `quantidade`, rateado por cabeça (maior resto; empate pela maior base e pelo código) ou, por peso com mais de um animal, MANUAL pela dose de cada um ("Proporcional à dose de cada animal…"); 100% alocado (`CEM_POR_CENTO`). Serviço ou produto pago no ato (`custo_valor`): CUSTEIO com parcelas mensais, por cabeça. `total_value` = Σ dos lançamentos. Aviso de período fechado por lançamento |
| ESTOQUE (`estoque_`) | ENTRADA: quantidade = a informada ou embalagens × `fator_conversao` (sem fator → `SEM_FATOR`; as duas que não batem → `CONFLITO_DE_CAMPOS`; nenhuma → `CAMPO_OBRIGATORIO`); sempre o lançamento COMPRA_INSUMOS (ESTOQUE_INSUMOS, caixa, sem rateio) com o produto, a quantidade e as parcelas (decisão 16.9); o movimento ENTRADA (custo unitário = valor ÷ quantidade) só com controle. AJUSTE: só com controle (`PRODUTO_SEM_ESTOQUE`); CONTAGEM → movimento = contado − saldo na data (sem o original da correção; 0 → `VALOR_IGUAL`); PERDA e VENCIMENTO → −quantidade. Payload: `qtd_apresentacao`, `fator_conversao` (congelado), `saldo_contado`, `motivo_ajuste` |
| ESTOQUE_INSUFICIENTE (RN-057) | Em todo comando que mexe nos movimentos de um produto com controle (aplicação, entrada corrigida, acerto, estorno): o menor saldo ao longo do tempo depois do comando < 0 e menor que antes → aviso "Vacina Aftosa: o estoque ficaria em −10 doses em 13/11/2026…"; com a política BLOQUEIA (`avisos_politica`), recusa — o estoque negativo é aviso ou bloqueio por parâmetro |
| Carência × venda (`carenciaContraVendas_`, RN-072) | A aplicação retroativa ou a correção cuja carência cobre a data de uma VENDA vigente do animal: na venda para ABATE vale a política de CARENCIA_ATIVA (padrão BLOQUEIA); nas demais, aviso com aceite. Na VENDA, a carência é conferida como antes (seção 14), agora sobre a SANIDADE real |
| Payload e resposta | `modo_dose`, `dose_referencia` (não no TOTAL), `quantidade_consumida_total` (o que saiu); `impactos.sanidade` = `{procedimento, produto_id, nome_produto, unidade, modo_dose, dose_referencia, quantidade, quantidade_informada, consumo: {custo_unitario, valor}, estoque: {antes, depois}, protocol_id, carencia_dias, fim_carencia, proxima_aplicacao, animais: [{animal_id, codigo_interno, brinco, dose, peso_kg, peso_situacao, peso_estimado, custo}]}`; `impactos.estoque` = `{subtipo, product_id, nome, unidade, controla_estoque, quantidade, motivo, saldo_contado, saldo_na_data, qtd_apresentacao, fator_conversao, valor, saldo, custo_unitario}`; papéis dos lançamentos: CONSUMO, SERVICO, INSUMO |
| Importação | O importador de SANIDADE (E3.6, seção 42) planeja cada aplicação por este mesmo tratador; o desfazer da importação de ANIMAIS com sanidade lançada depois → `CONFLICT` com o lançamento. Aplicação anterior ao marco zero (o histórico importado e a correção dele): registro com produto, dose, quantidade, carência e próxima, sem saída de estoque e sem consumo (o estoque e o custo do insumo começam no marco zero); o serviço pago no ato sem caixa (sem parcela), como a compra e a morte históricas; `impactos.sanidade.historico = true` |

**Integridade (`AuditService.conferirInsumos_`, COPIAS — fonte quebrada, sem reparo; a trava recusa o comando que toca a
fonte com `CONFLICT INTEGRIDADE_COPIAS`).** As regras estão na seção 11. O escopo da trava ganhou `produtos` (sementes:
os movimentos e as mudanças de PRODUTOS do comando, `derivados.produtos`); `conferirProjecoes_` refaz e compara o
`estoque_atual` deles; `TIPO_DO_DETALHE` e `DETALHE_OBRIGATORIO` conhecem SANIDADE e MOVIMENTOS_ESTOQUE.

**Agenda, alertas e ficha.**

| Função | Contrato |
|---|---|
| `elegibilidade(protocolo, perfil, data)` | Sexo, idade (mínima e máxima, em meses) e categoria na data → `{elegivel, devendo}`; UNICA passada a idade máxima continua "devendo" se esteve na faixa depois da criação do protocolo |
| `vencimento(...)` | UNICA: ao completar a idade máxima (senão a mínima, senão a entrada), cumprida por qualquer aplicação. INTERVALO_DIAS: a próxima gravada, senão a última + intervalo; nunca aplicado = vencida desde que ficou elegível. CAMPANHA_MESES: o último dia do mês da campanha, janela ± tolerância; a campanha perdida fica atrasada só até abrir a janela da seguinte |
| `situacao(v, data, antecedencia)` | VENCIDA (data > vencimento), PROXIMA (até `antecedencia` dias), EM_DIA |
| `agendaEm(L, data, periodo)` | `{data, motivo, periodo, parametros: {antecedencia_dias, tolerancia_dias}, resumo: {vencidas, proximas, animais_pendentes, em_carencia}, pendencias: [{animal_id, codigo_interno, brinco, pasture_id, protocol_id, produto_id, nome, tipo_procedimento, vencimento, situacao, dias, ultima_aplicacao}], carencia: [{animal_id, codigo_interno, brinco, pasture_id, fim, nome_produto, data_aplicacao, event_id}], protocolos: [{protocol_id, nome, tipo_procedimento, recorrencia_tipo, elegiveis, em_dia, cobertura: {valor, motivo, n}, aplicacoes, animais_atendidos}], custos}` sobre os presentes em D; sem protocolo, a pendência vem da próxima informada na última aplicação do produto |
| `custoSanitario(repo, periodo)` | Lançamentos vigentes de contas de classe SANITARIO com competência no período: `{inicio, fim, total, alocado, nao_alocado, por_conta}` |
| `consultaAgenda(dados)` / `agenda(ctx, dados)` — `sanidade.agenda` | `{data? (≤ hoje), periodo_inicio?, periodo_fim?}`; período padrão: do primeiro dia do mês, 11 meses antes, até a data |
| `carenciaHoje(L, a)` | O fim da carência do animal ATIVO hoje (lista leve: `carencia_ate`) |
| `blocoFicha(L, a)` — bloco F | `{entregue, animal_id, itens: [{event_id, event_subtype, data, tipo_procedimento, nome_produto, produto_id, protocol_id, protocolo_nome, dose, unidade_dose, via_aplicacao, lote, validade, motivo, diagnostico, resultado_exame, data_proxima_aplicacao, periodo_carencia_dias, data_fim_carencia, custo (alocações), veterinario, observacoes}] (mais recente primeiro), carencia, proximas (as pendências de hoje + a próxima ainda longe, EM_DIA), custo_total}` |
| `fimPeloPeriodo(dataAplicacao, dias)` | `data_aplicacao` + `periodo_carencia_dias` (inteiro > 0), a conta que a aplicação grava e a integridade refaz; senão `null` |
| `aplicacoesDoAnimal(repo, id, f)`, `movimentosDoProduto(repo, productId, excluidos)` | As linhas vigentes de SANIDADE do animal e de MOVIMENTOS_ESTOQUE do produto, sem os eventos que a fonte exclui (a agenda, a carência e o saldo partem delas) |
| `pendenciasDoAnimal(contexto, animalId, perfil, data)` | As pendências do animal na data: por protocolo ativo de que ele é elegível (VENCIDA ou PROXIMA) e, sem protocolo, por produto cuja última aplicação informou a próxima dose; `{pendencias, elegivel: {protocol_id: {em_dia}}}`; `perfil` = `{sexo, data_nascimento, category_id, no_rebanho_desde}` |
| `leiturasAgenda()` | As abas que `sanidade.agenda` lê: as do leitor de animais (`AnimalService.leituras()`), as do cadastro e as do financeiro (FINANCEIRO, RATEIOS, ALOCACOES_FINANCEIRAS, PLANO_CONTAS) |
| `InventoryService` (alertas) | SANITARIO_VENCIDO, SANITARIO_PROXIMO e EM_CARENCIA pela agenda de hoje |

**Aceitação e base de demonstração (`TestRunner`, seção 21).** Cenários CT-06 (09: 30 animais, "Vacina X" a R$ 3,00 por
dose com estoque de 100 e o protocolo de 180 dias; dose 0 recusada sem gravar; a vacinação dos 30 com 30 linhas de R$ 3,00,
uma saída de 30 (100 → 70), um CUSTEIO de R$ 90,00 sem parcela, 30 alocações, o caixa inalterado e a próxima pelo
protocolo; a agenda 12 dias antes com 30 próximas e 42 dias depois com 30 vencidas) e SANIDADE (RN-056 e RN-057: lote
vencido e consumo acima do saldo com os dois avisos e o aceite; RN-072: vermífugo com 35 dias, abate bloqueado até o último
dia, livre no seguinte, recria com aceite; RN-058 e RN-059: protocolo de aplicação única para machos de 24 meses em dia,
vencido na agenda e nos alertas, cumprido depois da aplicação), com pastos próprios, as pendências filtradas aos animais do
cenário e os protocolos desativados no fim. A base de demonstração ganhou a 'Vacina (demonstração)' (estoque, 1,50 por
dose), o 'Vermífugo (demonstração)' (sem estoque, 0,04 por mL) e o protocolo semestral: 6 entradas de estoque, 6
vacinações de todo o rebanho com o protocolo e 9 vermifugações nos pastos pesados, sem aviso (422 comandos, 3.154
aplicações; 304 ativos no fim); `fora_desta_fase` perdeu os manejos sanitários. Na etapa de aceitação as vermifugações
passaram a ser pelo protocolo da recria, e a composição atual da demonstração está na seção 21.

**Interface.**

| Peça | Contrato |
|---|---|
| `Health.html` (sob demanda, seção 37; 23 KB) | `TelaSanidade`; rotas `sanidade/agenda` (menu), `sanidade/aplicacoes`, `sanidade/produtos`, `sanidade/protocolos`, com abas. Agenda: data e período do custo; indicadores (`[data-resumo-agenda]`: atrasadas, próximas, animais pendentes, em carência); por protocolo (ou produto), "Aplicar em N animais" abre o Registro da SANIDADE com o subtipo do procedimento, o protocolo, o produto, a dose, a carência, o lote e a validade padrão do produto e os animais pendentes; tabelas das pendências, da carência, da cobertura por protocolo e do custo sanitário. Aplicações: `evento.listar` da SANIDADE. Produtos: lista com o saldo, "abaixo do mínimo" e as ações Editar, Entrada (ESTOQUE/ENTRADA) e Acertar (ESTOQUE/AJUSTE, só com controle); cadastro pela folha (`Cadastro.folha`, `produto.salvar`). Protocolos: lista e folha (`protocolo.salvar`) |
| Registro (`Components`) | Refs PRODUTOS (nome, unidade e saldo) e PROTOCOLOS_SANITARIOS; o produto escolhido sugere o que estiver vazio (carência, lote, validade, modo e dose padrão) e o protocolo traz o produto (`preencherDoProduto_`; só preenchimento: o servidor usa o que for enviado). Revisão do servidor com `linhasSanidade` (dose por animal, o que sai do frasco, o estoque antes e depois, o custo pelo consumo, a carência, a próxima) e `linhasEstoque` (entrada, custo por unidade, acerto, saldo). Verbos: "Gravar a aplicação", "Registrar a doença", "Registrar o exame", "Gravar a entrada no estoque", "Acertar o estoque". Cartão do animal na VENDA com o selo de carência (`[data-carencia]`) |
| Ficha, aba Sanidade (`Animals`, `blocoSanitario`) | A carência de hoje, as próximas doses (atrasada, próxima, em dia) e a tabela dos registros com o custo deste animal e o custo sanitário total |
| Detalhe e correção (`Events`) | Seções "Sanidade", "Animais tratados" (dose, resultado, custo) e "Estoque" (movimentos). `previaSanidade_` e `previaEstoque_`: o lançamento como foi digitado — sem a próxima proposta pelo protocolo, sem a quantidade igual à soma das doses, sem a dose do animal igual à do lançamento, sem o fabricante do cadastro e sem a descrição proposta do serviço; por peso, a dose de cada animal fica vazia (o servidor recalcula pelo peso na data) |
| Loja do cliente (`JavaScript`) | `Store.produtos/produto/protocolos/protocolo`; deltas de `produto.salvar` e `protocolo.salvar`; `descricaoAnimal` com "em carência até"; `Fmt.casas`; rótulos PROCEDIMENTO, CATEGORIA_PRODUTO, MODO_DOSE, RECORRENCIA, MOTIVO_AJUSTE_ESTOQUE, SITUACAO_AGENDA |

Testes: `tests/sanidade.test.js` (03b 15.2 linha a linha e centavo a centavo, CT-06, dose por peso, total, nome livre e os
seis subtipos, protocolo e avisos, os caminhos — registro, retroativo, mesmo dia, correção, correção do substituto, estorno
com e sem dependente e estorno da correção —, carência contra a venda, importação e desfazer, integridade por adulteração e
a trava), `tests/estoque.test.js` (cadastro, entrada por embalagem e na unidade, sem controle, acerto, estoque insuficiente
e a política, correção e estorno, integridade), `tests/sanidade.agenda.test.js` (elegibilidade, as três recorrências,
agenda, alertas, ficha), `tests/estorno.test.js` (os seis subtipos e os dois do estoque no estorno e na correção),
`tests/acceptance.test.js` (CT-06, SANIDADE e a base de demonstração), `tests/fase2.fuzz.test.js` (seção 36),
`tests/telas.sobdemanda.test.js` (Health entregue e no orçamento) e `tests/ui/sanidade.test.js` (Playwright: produtos,
protocolo e entrada de estoque a 360 px; agenda, aplicação, ficha e venda a 1280 e 360 px; detalhe e correção a 1280 px).

## 40. Reprodução, desmama, castração e ocorrência (Fase 3, E3.4 e E3.5) — `ReproductionService`, `EventService` (REPRODUCAO, DESMAMA, CASTRACAO, OCORRENCIA), `AuditService`, `Timeline`, `InventoryService`, `AnimalService`, `Api`, `TestRunner`, `Reproduction`, `Animals`, `Events`, `Components`, `JavaScript`

Desenho: 03a, seção 4.10; 03b, seções 2.5, 2.6, 3.4, 7 e 16.14; 04, seções 3.3 e 4.5; 05, seção 2.9 (RN-060 a RN-066); 07,
seção 8.3; 08, seções 3 (bloco G) e 5; 09, seção 4.1; PR-07. Datas yyyy-MM-dd; dinheiro em centavos. A situação, a previsão
de parto e os indicadores são contas do servidor; a tela só mostra (P5).

**Estação de monta.** `comandoSalvarEstacao`/`salvarEstacao` — `estacao.salvar` `{estacao_id?, campos, justificativa?}`:
nome (único na propriedade, sem diferença de maiúsculas: `NOME_REPETIDO`), início, fim (no início ou depois:
`FAIXA_INVALIDA`), tipo MONTA_NATURAL, IA ou MISTA, propriedade padrão; a edição é auditada. Mudar as datas não mexe nos
registros já lançados (o registro fica com a estação dele; o motor confere a data contra a estação só no lançamento novo).
`cadastros(repo)` leva as estações ao `sistema.bootstrap`.

**Lançamentos (tratador único: registrar, simular, retroativo, mesmo dia, corrigir, corrigir o substituto, estornar,
importação e desfazer, base de demonstração).**

| Peça | Contrato |
|---|---|
| REPRODUCAO, cabeçalho | Estação existente; na exposição, na cobertura e na inseminação a data cai no período dela, no diagnóstico é depois do início (`FORA_DA_ESTACAO`; a estação que o original usava vale na correção). Retirada dos touros (`data_fim`, só na exposição) no início ou depois. Touro da cobertura e da inseminação: macho, não anulado, nascido antes (`SEXO_DO_PROGENITOR`, `NASCIMENTO_DO_PROGENITOR`); na cobertura, o do rebanho tem a linha TOURO (efeito 0, presença na data) e o de fora não; na inseminação, o do sêmen não tem linha |
| REPRODUCAO, item | A fêmea do rebanho na data: linha SUJEITO (efeito 0) e uma linha REPRODUCAO do subtipo. Na exposição, o macho da lista é touro do lote (linha TOURO); o touro único fica em `touro_id` de cada fêmea (dois ou mais: nenhum). Nos demais subtipos o macho → `NAO_E_FEMEA`. Diagnóstico: `resultado` (POSITIVO, NEGATIVO, INCONCLUSIVO) obrigatório; `idade_gestacional_dias` e `data_prevista_parto` só no positivo (`CAMPO_NAO_SE_APLICA`), idade até `dias_gestacao` (`VALOR_FORA_DA_FAIXA`), previsão depois do diagnóstico (`DATA_INVALIDA`). Aborto: a idade da gestação perdida. Fêmea abaixo de `idade_min_reprodutiva_meses`: aviso `IDADE_REPRODUTIVA`. Sem fêmea: `SEM_FEMEAS` |
| DESMAMA | A cria (nascida na fazenda, ou que entrou com menos que `idade_desmama_padrao_meses`; DL-06) ainda não desmamada (`NAO_E_CRIA`, `JA_DESMAMADO`), no rebanho na data: linha SUJEITO com o peso e, com o pasto de destino diferente do atual, o movimento; o peso vira a pesagem DESMAMA (`metodo_pesagem`, padrão BALANCA). A mãe conhecida e no rebanho na data: linha MATRIZ (efeito 0) e o registro REPRODUCAO DESMAMA, uma vez por mãe (gêmeos). A cria ao pé da mãe sai pela linha SUJEITO |
| CASTRACAO | Macho inteiro do rebanho na data (`NAO_E_MACHO`; `JA_CASTRADO` pelo cadastro ou por castração anterior); o método no payload. Projeção: castrado e não reprodutor (a categoria segue o cadastro) |
| OCORRENCIA | O animal do rebanho na data; `tipo_ocorrencia` (lista TIPO_OCORRENCIA) e a descrição obrigatórios; sem efeito no inventário. Duplicidade no mesmo dia só com o mesmo tipo |
| Despesa paga no ato (`despesaDoManejo_`) | Reprodução, castração e ocorrência: os campos `custo_*` (03b, seção 2.5) viram um CUSTEIO na conta escolhida, com as parcelas mensais, rateado por cabeça entre os animais (na reprodução, as fêmeas; um animal: DIRETO), 100% alocado; `total_value` = o valor; descrição padrão "Castração de 13/11/2026: despesa" |
| Regras de manejo (`conferirManejo_` = `ReproductionService.problemasDoAnimal`, antes e depois do comando) | `CASTRACAO_DE_FEMEA`, `CASTRACAO_REPETIDA`, `TOURO_CASTRADO` (linha TOURO na data da castração ou depois, ou de castrado de origem), `DESMAMA_REPETIDA` e `PARTO_NA_GESTACAO` (parto entre a concepção — diagnóstico positivo menos a idade — e o diagnóstico). Problema do próprio lançamento → `VALIDATION`; o que ele quebra num lançamento gravado → `CONFLICT` com ele (a castração retroativa contra a cobertura; o parto retroativo contra o diagnóstico) |
| Resposta | `impactos.manejo` (REPRODUCAO: fêmeas, touros, touro, estação, retirada, método, sêmen, `resultados` do diagnóstico; DESMAMA: bezerros, mães, movidos, pesados, peso médio e cada bezerro com a idade; CASTRACAO e OCORRENCIA: animais e tipo) e `reproducao.animais` com a situação projetada e a previsão de cada fêmea |

**Projeção.** `situacao_reprodutiva` = o último fato (data, posição na cadeia, `event_seq`): exposição e cobertura
EXPOSTA, inseminação INSEMINADA, diagnóstico positivo PRENHA, negativo, parto e aborto VAZIA; o duvidoso e a desmama não
decidem; sem fato, o declarado na entrada ou SEM_INFORMACAO (NAO_APTA para a nascida na fazenda). E3.6: a situação
declarada na entrada (rebanho inicial, compra, outra entrada) vale como o fato da data dessa entrada — o registro de antes
dela (o histórico reprodutivo importado de antes do marco zero) fica na ficha e nos indicadores, mas não a desfaz; sem
situação declarada, o histórico decide (o replay do teste aleatório segue a mesma regra). `castrado` pelo cadastro
ou pela castração vigente; `cria_ao_pe` sai com a desmama.

**Previsão de parto (`previsaoParto(regs, params, estacoes)`, 03b, seção 7.3; sempre estimativa, salvo a informada).**
Nível 0: a informada no diagnóstico positivo; 1: inseminação ou cobertura + `dias_gestacao`; 2: diagnóstico +
(`dias_gestacao` − idade); 3: a janela da exposição (início + dias − tolerância a fim + dias + tolerância). Janela ±
`parto_tolerancia_dias` nos níveis 0 a 2. Depois de um parto ou aborto, só os fatos seguintes contam. Exemplos conferidos:
inseminação em 10/11/2026 → 27/08/2027; diagnóstico em 15/01/2027 com 60 dias → 02/09/2027.

**Indicadores (`reproducao.indicadores`, 07, seção 8.3).** `{estacao_id?, ano?, data? (≤ hoje)}` →
`{data, parametros, matrizes: {ativas, prenhas, sem_informacao, sem_historico, motivo}, estacoes, estacao: {estacao, geral,
por_categoria} | null, anual | null}`; sem estação pedida, a mais recente iniciada até a data com registro reprodutivo até a data (seção 46); sem nenhuma, a forma anual.
Expostas em E = fêmeas com exposição, cobertura ou inseminação de E; o parto é da exposição mais recente cuja janela o
contém; o diagnóstico é o último conclusivo de E (ou sem estação, dentro da janela). Cada taxa `{valor, motivo, numerador,
denominador, n, rotulo, parcial}`: denominador zero ou abaixo de `indicador_n_minimo` → `null` com DADOS_INSUFICIENTES,
nunca zero (RN-066). `geral` e cada categoria (na data da exposição): `expostas, diagnosticadas, prenhas, paridas,
nascidos_vivos, desmamados, crias_ao_pe, mortos_antes_da_desmama, vendidos_ao_pe, sairam_sem_diagnostico,
sairam_sem_desfecho, cobertura_dg, prenhez` (sobre as expostas; com a cobertura do diagnóstico abaixo de
`prenhez_cobertura_dg_min_pct`, sobre as diagnosticadas, rótulo "Prenhez entre diagnosticadas"),
`prenhez_entre_diagnosticadas, paricao, natalidade, perda_gestacional` (aborto ou janela encerrada sem parto; prenha sem
desfecho nunca é perda), `desmama, mortalidade_ate_desmama` (mortos e baixados antes da desmama e do corte em
`idade_desmama_padrao_meses` ÷ nascidos vivos; vendidos ao pé à parte), `iep_dias` e `idade_primeiro_parto_meses`
(`{valor, motivo, n}`); "parcial" com prenha de janela aberta ou cria ao pé. Quem saiu no meio da estação (decisão desta
etapa): antes de um diagnóstico conclusivo, sai do denominador da prenhez; antes do fim da janela sem desfecho (parto,
aborto ou diagnóstico negativo), sai do da parição, da natalidade, da desmama e da perda; a vazia descartada continua.
Forma anual (PR-07, sem estação): natalidade = nascidos vivos no ano ÷ matrizes ativas no início do ano (antes do marco
zero: ANTERIOR_AO_MARCO_ZERO), IEP e idade ao primeiro parto dos partos do ano. Exemplo de 07 conferido número a número
(80 expostas: 80,0%, 84,2% entre diagnosticadas, 75,0%, 76,3%, 6,3%, 70,0%, 6,6%) e o de 09 (40 expostas: 80,0%, 75,0%,
77,5%).

**Fêmeas e alertas.** `reproducao.matrizes` (rota extra) `{data?, estacao_id?, situacao?, pasture_id?}` → `{data, itens:
[{animal_id, codigo_interno, brinco, pasture_id, situacao_reprodutiva, apta, cria_ao_pe, partos, idade_meses, ultimo,
previsao_parto, sem_historico}], resumo: {por_situacao, cria_ao_pe, sem_historico, total}, alertas}`: as fêmeas no
rebanho na data, aptas ou com algum registro. Alertas (`alertasHoje`, também em `alerta.listar`): PARTO_PREVISTO (previsão
até `alerta_parto_previsto_dias` à frente) e PRENHEZ_VENCIDA (a prenha cuja previsão passou há mais de
`alerta_prenhez_vencida_dias` sem parto nem aborto).

**Ficha (bloco G inteiro, `blocoFicha(L, a)`).** Fêmea: `{entregue, parcial: false, aplica, situacao_reprodutiva,
cria_ao_pe, parida, previsao_parto, n_partos, partos_registrados, partos (com crias e intervalos), bezerros {nascidos_vivos,
natimortos, desmamados}, perdas_gestacionais {abortos, natimortos, total}, exposicoes, coberturas, inseminacoes,
diagnosticos, abortos, intervalo_medio_dias, idade_primeiro_parto_meses, registros [{event_id, tipo_evento, data,
resultado, idade_gestacional_dias, data_prevista_parto, estacao_nome, touro_id, semen_identificacao, metodo}],
sem_historico}`. Macho: `{aplica: false, mensagem, como_touro: [{event_id, data, tipo_evento, femeas, estacao_id}] (um item
por lançamento), castracao: {event_id, data, metodo} | null}`.

**Funções públicas de apoio** (usadas pelo motor, pela projeção, pela verificação e pelas rotas): `consultaIndicadores(dados)` e `consultaMatrizes(dados)` são os tratadores de `reproducao.indicadores` e `reproducao.matrizes`; `avisoIdade(params, femea, data)` dá a frase do aviso de fêmea jovem (RN-061: menos de `idade_min_reprodutiva_meses` meses completos na data) ou `null`; `ehCria(f, a, params)` diz se o animal é cria (DL-06: nascido na fazenda, ou entrou com menos de `idade_desmama_padrao_meses`); `castracoes(linhas)` dá as castrações vigentes na ordem canônica, `castradoDeOrigem(f, id)` o castrado da criação com a última correção de cadastro (sem a castração por evento) e `castradoEm(f, id, data)` se o macho estava castrado na data (de origem, ou castração vigente até a data, inclusive); `problemasNaFonte(f, id, sexo)` roda as regras de manejo de um animal pela fonte (a verificação de integridade e a trava), a mesma conta de `problemasDoAnimal`.

**Integridade (`AuditService.conferirReproducao_`, COPIAS e LINHA_DO_TEMPO; a mesma função na verificação e na trava).**
Colunas do registro coerentes com o tipo (resultado só no diagnóstico, idade só no positivo e no aborto, retirada só na
exposição e não antes do início, previsão depois do diagnóstico), o cabeçalho igual entre as fêmeas do lançamento, o touro
do registro = o touro único do lote, o detalhe obrigatório (uma REPRODUCAO por linha SUJEITO; na desmama, por linha MATRIZ),
as regras de manejo acima (com a castração de origem que aparece por correção de cadastro: `INTEGRIDADE_LINHA_DO_TEMPO`) e o
registro reprodutivo só de fêmea (GENEALOGIA). `RESOLVER_MANEJO` explica o achado na tela da trava.

**Aceitação e base de demonstração (`TestRunner`, seção 21).** Cenário REPRODUCAO (09, seção 4.1): RN-060 (o touro no
diagnóstico: `NAO_E_FEMEA`), RN-061 (parto da novilha de 20 meses: `IDADE_REPRODUTIVA`), RN-064 (segundo parto 200 dias
depois: `INTERVALO_PARTO_CURTO`), RN-066 (40 expostas, 38 diagnosticadas, 32 prenhas, 30 paridas, 31 vivos: 80,0%, 75,0%,
77,5%; 4 expostas numa estação de inseminação: `null`), a desmama, a castração e a ocorrência. A base de demonstração ganhou
as três estações de monta (D0+30, D0+395, D0+760; 90 dias cada): a exposição das fêmeas com 25 meses ou mais e dos touros
no início e o diagnóstico 150 dias depois (positivo quando o plano tem o parto na janela), sem aviso; `fora_desta_fase`
perdeu as estações. Na etapa de aceitação os partos do plano passaram a sair da estação de monta (o positivo é a fêmea que
emprenhou), com a desmama, a castração e as ocorrências: a composição atual está na seção 21.

**Interface.**

| Peça | Contrato |
|---|---|
| `Reproduction.html` (sob demanda, seção 37; 49 KB) | `TelaReproducao`; rotas `reproducao/matrizes` (menu), `reproducao/tronco`, `reproducao/indicadores`, `reproducao/estacoes`, com abas. Fêmeas: filtros (data, estação, situação, pasto), indicadores (`[data-resumo-matrizes]`), alertas, a tabela com seleção (no celular, cartão sem link colado à marca) e os botões `[data-registrar]` de cada subtipo, que abrem o Registro com as escolhidas e a estação em curso. Indicadores: a estação (ou o ano) com cada taxa, numerador, denominador, "parcial" e o motivo do vazio; por categoria. Estações: tabela e a folha `estacao.salvar`. Diagnóstico no tronco: data, método, estação e responsável; brinco e resultado com Enter (`p`, `p90`, `v`, `d`), o brinco que não é de fêmea do rebanho como pendência, blocos de 20 enviados com chave própria (rascunho `tronco-diagnostico` no aparelho; sem sinal, o bloco fica guardado e o reenvio usa a mesma chave; a resposta perdida é conferida por `operacao.status`), o aviso do servidor com "Está certo", a previsão do servidor na linha e "Terminar" com os lançamentos gravados |
| Ficha (`Animals`, aba Reprodução) | O bloco G vem do módulo, pedido sob demanda (`TelaReproducao.blocoFicha`): situação, cria ao pé, parida, previsão, partos, bezerros, perdas, intervalos, registros; no macho, os lançamentos como touro e a castração |
| Registro, detalhe e correção (`Components`, `Events`) | Os quatro tipos no seletor; o diagnóstico com o resultado por fêmea e a idade e a previsão só no positivo; a desmama com o peso por bezerro; a despesa paga no ato; o detalhe com as seções do manejo; a prévia da correção (`previaCorrecao`) traz o lançamento como foi digitado |
| Loja do cliente (`JavaScript`) | `Store.estacoes/estacao`, deltas de `estacao.salvar`; rótulos SITUACAO_REPRODUTIVA, TIPO_EVENTO_REPRODUTIVO, RESULTADO_DG e METODO_REPRODUCAO |

Testes: `tests/reproducao.test.js` (estação; exposição, cobertura e inseminação; diagnóstico em lote e os quatro níveis
da previsão; os caminhos — retroativo, mesmo dia, correção, correção do substituto, estorno da correção, estorno com e sem
dependente —; parto dentro da gestação pelos dois lados; castração retroativa do touro; integridade por adulteração e a
trava; importação e desfazer; ficha, fêmeas e alertas), `tests/reproducao.indicadores.test.js` (07 e 09 número a número,
categoria, cobertura abaixo de 90%, denominador zero, saída no meio, parcial, desmama e mortalidade com o corte, IEP, forma
anual), `tests/manejo.test.js` (desmama, castração e ocorrência por caminho, despesa, integridade, trava, importação e
desfazer), `tests/acceptance.test.js` (cenário REPRODUCAO e as estações da demonstração), `tests/fase2.fuzz.test.js` (seção
36: as quatro entradas, o cadastro da estação e os replays `REPLAY:SITUACAO_REPRODUTIVA` e `REPLAY:CASTRADO`; sementes fixas
8 e 1) e `tests/ui/reproducao.test.js` (Playwright: tronco a 360 px com a rede cortada; fêmeas, indicadores, estação,
ficha da matriz e do touro a 1280 e 360 px).

## 41. Gráficos (Fase 3, E3.7) — `Components` (`UI.grafico`, `UI.curvaPeso`, `UI.escalaGrafico`), `Styles`, `WeightService` (`peso.desempenho`), `Weights`, `Reproduction`, `Health`, `Dashboard`

Desenho: SP-08 (desenho-base, seção 17: SVG próprio, sem biblioteca nem CDN); 08, seções 11, 14 e 15; 07, seção 9 (G5);
01, seção 6.2 (`Components` traz os gráficos). Os números chegam prontos do servidor; a tela só desenha (P5): nenhum
gráfico soma, divide ou tira média (conferido por `tests/graficos.test.js`). Pizza e rosca não entram: o desenho só pede
linha e barras (08, seções 11 e 15).

**Kit (`Components`, na página inicial; 446 KB de 450 KB nesta etapa).**

| Membro | Contrato |
|---|---|
| `UI.grafico(o)` | `o = {tipo: linha\|barras\|empilhadas, titulo, descricao?, rotuloX (eixo dos itens e 1ª coluna da tabela), rotuloValor (eixo dos valores, com a unidade: "Ganho médio diário (kg/dia)", "Taxa (%)"), series: [{nome, pontos: [{x, y, nota?}]}], formatar(y) (o texto do rótulo, da dica e da célula: o mesmo), rotuloEixo(v) (marcas do eixo; padrão: o número com as casas do passo), totais: {x: valor} (empilhadas: o total do servidor, na ponta e na coluna "Total"), vazio (texto do estado vazio), zero (linha a partir do zero), dado (→ `data-grafico-id`)}`. `<figure class="grafico" data-grafico=tipo>` com `figcaption` = título; `.grafico-area` com o `<svg role="img" aria-labelledby>` (o `<title>` = título; o `<desc>` = descrição + unidade + "Os números estão na tabela logo abaixo (Ver tabela)"); legenda com várias séries; `details.grafico-tabela` "Ver tabela" (linha = item, coluna = série; valor ausente = "—" e a `nota` entre parênteses). Linha: um traço por série, cortado onde falta o valor; série com menos de 2 pontos → nota "Dados insuficientes para desenhar a linha de …". Barras: horizontais, o nome do item à esquerda quando todos cabem em 30% da largura (meses, pastos de nome curto), senão em cima da barra (legível a 360 px, cortado com "…" e o nome inteiro na dica), o valor na ponta (`.grafico-valor`), várias séries agrupadas; ausente → "— sem dado" no lugar da barra; negativo à esquerda do zero. Empilhadas: um trecho por série (valores ≥ 0; o trecho zero não é desenhado), o rótulo dentro quando cabe e o total do servidor na ponta. Cada marca (`rect`, `circle`) traz `data-x`, `data-serie`, `data-valor` e a dica `<title>` "item, série: valor formatado". Sem nenhum valor: `data-vazio="true"` e `.grafico-sem-dados` (ícone e texto) no lugar do desenho; a tabela fica quando há itens |
| `UI.curvaPeso(o)` | Seção 38, agora sobre o mesmo quadro: eixos "Peso (kg)" e "Data", title e desc ("Curva de peso com N pesagens; a linha tracejada é a projeção (estimativa), nunca um peso pesado."), marcas com `data-marcador` (medido, estimado, nascer, projecao), `data-valor` e a dica "dd/mm/aaaa: 380,0 kg (pesagem)"; a projeção tracejada com o rótulo "Estimativa" |
| `UI.escalaGrafico(min, max, n, zero, inteiro)` | Escala "redonda" do eixo dos valores: passo de 1, 2, 2,5 ou 5 × 10^k cobrindo [min, max] em cerca de n divisões; `zero` inclui o zero (barras); `inteiro` (o kit liga quando todos os valores são inteiros: cabeças, centavos) nunca tem passo menor que 1; valor único ganha folga. → `{min, max, casas, marcas}` (puro; testado no Node) |
| Largura | O SVG é desenhado na largura útil da sua área (260 a 720 px; antes de entrar na página, a da janela) e refeito quando ela muda (`resize`, com espera de 150 ms): o texto de 12 px sai com ~12 px a 360 px. O ícone do estado vazio não é esticado (`.grafico-area svg`) |
| Estilo (`Styles`) | 8 cores de série (`.grafico-serie-0` a `7`, `--serie`; contraste ≥ 4,5:1 com o branco, para o rótulo dentro da barra); a amostra da legenda com a cor da série (`color`); rótulos com contorno da cor da superfície (legíveis sobre a grade) |

**Servidor (`WeightService.consultaDesempenho`, rota `peso.desempenho`; seção 38).**

| Campo | Contrato |
|---|---|
| `evolucao` | G5 (07, seção 9): `[{mes: 'aaaa-mm', valor, motivo, n, animais, explicacao}]`, um item por mês do período (do mês de `de`, ou da primeira pesagem sem marco zero, ao de `ate`). `valor` = média das pesagens individuais do mês (as que entram no GMD: balança, e fita com `gmd_aceita_fita`; uma por animal e dia, a de depois), com 1 casa; `n` = pesagens; n abaixo de `indicador_n_minimo` → `valor: null`, DADOS_INSUFICIENTES e "Só 2 pesagens no mês (mínimo 5)." ou "Nenhuma pesagem individual no mês.". Estimativa visual, média do lote e projeção nunca entram. Filtros de sexo e raça pelo animal; de pasto (`Timeline.situacaoEm`) e categoria pela data da pesagem |
| `por_pasto[].por_categoria`, `por_pasto[].sem_categoria` | As cabeças de cada categoria no pasto no fim do período (`InventoryService.compor`): `[{category_id, nome, cabecas}]`; somadas a `sem_categoria`, dão `cabecas` |

**Telas.** Ficha (aba Peso): a curva (seção 38). Pesagens (desempenho): "Peso médio das pesagens de cada mês" (linha,
`evolucao-peso`), "Ganho médio diário por pasto" e "por categoria" (barras, `gmd-pasto`, `gmd-categoria`; o "—" com a
explicação do servidor), "Rebanho por categoria em cada pasto em dd/mm/aaaa" (empilhadas, `rebanho-categorias`; o total
= `cabecas` do servidor), "Ganho médio diário de cada pesagem de lote" (barras, `gmd-lote`), cada um ao lado da tabela da
seção. Reprodução (indicadores): "Taxas da estação …" (barras, `taxas-estacao`: prenhez — ou "Prenhez entre
diagnosticadas" —, parição, natalidade, perda gestacional, desmama e mortalidade até a desmama; "(parcial)" no nome; o "—"
com o motivo e o n) e "Prenhez, parição, natalidade e desmama por categoria" (barras agrupadas, `taxas-categoria`).
Sanidade (agenda): "Cobertura por protocolo em dd/mm/aaaa" (barras, `cobertura-protocolos`) e "Custo sanitário por conta"
(empilhadas, `custo-sanitario`: atribuído aos animais + sem animal; o total do servidor; eixo em reais). Início: os cinco
gráficos da Fase 1 e 2 ganharam o eixo "Cabeças".

Testes: `tests/graficos.test.js` (Node: G5 número a número — média, n, mínimo, mês vazio, período, estimativa fora, mesmo
dia, filtros de pasto, categoria e sexo —, as categorias de cada pasto somando o pasto, a escala, as regras estáticas —
todo SVG pelo kit, title e desc, tabela equivalente, título e unidade em cada chamada, nenhuma conta nos gráficos das telas
da Fase 3 — e o contraste das cores) e `tests/ui/graficos.test.js` (Playwright a 360 e 1280 px, com a captura de cada
tela: o componente com barras agrupadas, valor ausente e negativo, empilhadas, linha com buraco e o estado vazio, e o
redesenho quando a tela muda; a ficha, o desempenho, os indicadores reprodutivos e a agenda sanitária com os números do
desenho iguais aos da tabela e aos do servidor, o texto legível a 360 px e sem rolagem horizontal).

## 42. Importadores de manejo (Fase 3, E3.6) — `ImportService` (PESAGENS, SANIDADE, REPRODUCAO, OCORRENCIAS), `EventService` (histórico), `AuditService`, `Timeline`, `WeightService`, `Import`

Desenho: 04, seções 6 e 8; 06, seção 5.3; 08, seção 12; 03a, seções 5.4 e 5.5; 09, CT-12; 05, RN-088 a RN-095; 03b, seções 5
a 7 (o que cada tipo grava). O mesmo assistente de 5 telas, os mesmos 10 passos, as mesmas rotas, chaves (`imp:<id>:<n>`),
estados, reconciliação, desfazer e o mesmo ensaio em memória da seção 18.2 (cada lançamento pelo `planejarEventoImportado`, o
tratador único do tipo, e pela trava de integridade no ensaio, nos blocos, na conclusão e no desfazer). O que muda:

| Peça | Contrato |
|---|---|
| Modelos (`MODELOS`, `modelo(tipo)`) | PESAGENS: `grupo` (Nº da pesagem), `data`, `momento` (rotina, chegada/entrada, desmama, venda/saída; padrão aceito), `metodo` (balança, fita, estimativa visual; padrão aceito), `jejum`, `peso_total_lote` e `cabecas_lote` (a pesagem por lote: cada animal com a média), `responsavel`, `observacoes_lancamento`; por animal `brinco`/`codigo`, `peso`, `observacoes`. SANIDADE: `procedimento` (vacinação, vermifugação, medicação, tratamento, exame, doença — o subtipo), `produto` (do cadastro, pelo nome), `nome_produto` (sem cadastro), `protocolo` (pelo nome), `fabricante`, `lote`, `validade`, `modo_dose`, `dose_lancamento` (por cabeça ou por kg), `unidade` (sem cadastro), `quantidade_total`, `via`, `motivo`, `diagnostico`, `carencia`, `proxima`, `veterinario`, `responsavel`; por animal `dose`, `resultado_exame`. REPRODUCAO: `registro` (exposição, cobertura, inseminação, diagnóstico, aborto — o subtipo), `estacao` (pelo nome), `touro` (brinco na data, código ou nome do animal de referência), `semen`, `metodo`, `retirada`; por animal `brinco`/`codigo` (na exposição, também os touros do lote, uma linha cada), `resultado` (positivo/prenhe/p, negativo/vazia/v, duvidoso/d), `idade_gestacao`, `previsao_parto`. OCORRENCIAS: `tipo_ocorrencia` (lista TIPO_OCORRENCIA), `descricao`, `responsavel`. Obrigatórios: data, o subtipo (ou momento e método na pesagem) e `brinco`/`codigo`; na ocorrência também o tipo e a descrição. A despesa paga no ato fica fora do modelo (decisão desta etapa: entra pela correção do lançamento) |
| Agrupamento | Sem o número do lançamento, a chave natural mais os campos **opcionais** do lançamento (`agrupamento.opcionais`; vazio é um valor): PESAGENS data + momento + método (+ jejum, peso do lote); SANIDADE data + procedimento (+ produto, nome do produto, diagnóstico); REPRODUCAO data + registro (+ estação, touro, sêmen, método, retirada); OCORRENCIAS data + tipo + descrição |
| Leitura | Tipos novos de célula: `produto`, `protocolo`, `estacao` — pelo nome (sem diferença de acento e maiúscula), o ativo sobre o desativado de mesmo nome; dois iguais → `CADASTRO_AMBIGUO`; não achado → `PRODUTO_NAO_ENCONTRADO`, `PROTOCOLO_NAO_ENCONTRADO`, `ESTACAO_NAO_ENCONTRADA`, com o lugar do cadastro na mensagem. O touro não achado → `TOURO_NAO_ENCONTRADO` (a mesma resolução do pai do parto, `referencia_`) |
| Animal | O brinco em uso NA DATA do lançamento (seção 18.2, `donoDoBrinco_`) ou o código interno; o manejo não cria animal |
| Duplicidade | Linha idêntica que identifica o animal → `LINHA_REPETIDA_NO_ARQUIVO` (como nos eventos). O fato já gravado na base, fora desta importação (`jaRegistrado_`) → `EVENTO_JA_REGISTRADO`: na pesagem, o animal com uma pesagem de qualquer lançamento na mesma data **com o mesmo peso** (na de lote, a média); na sanidade, o mesmo procedimento com o mesmo produto (ou o mesmo nome, ou a mesma doença); na reprodução, o mesmo registro; na ocorrência, o mesmo tipo. **Decisão desta etapa:** duas pesagens legítimas do mesmo animal no mesmo dia são dois lançamentos (números diferentes na coluna "Nº da pesagem"); a segunda recebe o aviso `POSSIVEL_DUPLICIDADE` do motor, como no formulário; o mesmo animal duas vezes no mesmo lançamento → `ANIMAL_REPETIDO`, com a dica da coluna. No manejo, a linha DUPLICADA pela base **sai do lançamento**, que entra com as outras (cada linha é um fato; nas compras e vendas o lançamento continua entrando só inteiro): `agruparLinhas_(…, {jaNaBase})` na validação e `{duplicadas}` (as gravadas) nos blocos |
| Histórico | Data anterior ao marco zero → registro histórico (`pre_marco_zero`, efeito 0), validado só contra o nascimento e a chegada declarada (04, seção 6): a pesagem entra na curva e no peso atual e fica fora do GMD (`intervalos`: "Pesagem anterior ao marco zero…"); a aplicação entra no histórico sanitário e na agenda, sem saída de estoque e sem consumo; o registro reprodutivo entra na ficha e nos indicadores sem desfazer a situação declarada na entrada (seção 40); a ocorrência, na trilha |
| Registro gerado (`entity_id_gerado`, 03a, seção 5.5) | Pesagem → `weight_id`; aplicação → `health_id`; registro reprodutivo → `reproduction_id`; sem detalhe próprio (a ocorrência, o touro da exposição) → o `event_animal_id` do animal no evento. `criados.animais` = 0; o relatório e a tela não mostram as pendências de animais criados |
| Desfazer | As conferências do estorno (seção 18.2, `dependentesEventos_`): a correção de fora de um lançamento importado (`DEPENDENTE`, "Estorne a correção antes"), a parcela paga, o que voltaria e não cabe. O desfazer da importação de ANIMAIS com manejo importado depois → `DEPENDENTE` com "Desfaça antes a importação do arquivo …" |
| Ensaio | Reprojeta também o estoque dos produtos que a aplicação movimenta (`reprojetar_(…, produtos)`), para a trava do ensaio conferir o saldo |

**Integridade (a mesma função na verificação e na trava).** `conferirInsumos_` (COPIAS): a aplicação anterior ao marco zero
não tem saída de estoque (`HISTORICO_ESTOQUE`) nem lançamento de consumo com produto (`HISTORICO_CONSUMO`). As demais
conferências de cada tipo (seções 11, 38, 39 e 40) valem para o importado como para o do formulário.

**Interface (`Import.html`, seção 23).** Os dez tipos no "O que importar", em palavras; as opções lidas e os valores para
todas as linhas em palavras (os domínios de rótulo do aparelho; o procedimento e o registro pelo rótulo do subtipo no
catálogo; o produto, o protocolo e a estação pelo nome do cadastro); o texto das obrigatórias diz que o animal é achado pelo
brinco da data e, na sanidade, que o histórico não mexe no estoque; o relatório final do manejo sem "Animais ativos hoje",
"Sem brinco" e "Sem nascimento", e com o atalho para o módulo (pesagens, aplicações, fêmeas, lançamentos).

Testes: `tests/import.manejo.test.js` (as quatro importações por caminho: coletiva, lote, histórico, brinco na data e
recusas por linha; duplicidade no arquivo e na base, a linha que sai do lançamento, o aviso do segundo peso no mesmo dia;
correção e estorno do importado, a correção de fora que bloqueia o desfazer, o desfazer e o da importação de ANIMAIS que
espera o de manejo; estoque, consumo e carência da sanidade, o histórico sem estoque e a correção dele sem caixa; a
reprodução com a situação declarada; as ocorrências e as rotas pela api), `tests/unitofwork.adversarial.test.js` (a
varredura de quedas do bloco de PESAGENS e de SANIDADE nas três primitivas: tudo ou nada por lote, as pesagens, as
aplicações, a saída e o consumo inertes até concluir), `tests/fase2.fuzz.test.js` (os quatro importadores no registro, com o
oráculo do fato de cada linha importada na conclusão; sementes fixas 31 e 56), `tests/import.eventos.test.js` (o modelo
de PESAGENS entregue; tipo desconhecido recusado) e `tests/ui/importacao-manejo.test.js` (Playwright a 1280 e 360 px).

## 43. Conserto da revisão da Fase 3 — `EventService`, `HealthService`, `AuditService`, `Timeline`, `ReproductionService`, `WeightService`, `ImportService`, `AnimalService`, `EventCatalog`, `Weights`, `Reproduction`, `Dashboard`, `Health`, `Animals`, `Components`

O que a revisão da Fase 3 mudou nos contratos das seções 11, 14, 38 a 42 (os testes estão em
`tests/revisao.fase3.motor.test.js`, `tests/revisao.fase3.regras.test.js`, `tests/revisao.fase3.zootecnia.test.js` e
`tests/ui/revisao.fase3.test.js`, um por achado; o teste aleatório confere o mesmo pelo oráculo de cada tipo, seção 36).

**Fato congelado na correção (`EventService`, tratador único da SANIDADE e do ESTOQUE).** Corrigir (e corrigir o substituto)
não reprecifica o fato pelo cadastro de hoje:
- SANIDADE com o mesmo produto: o custo unitário é o da SAIDA do original (`MOVIMENTOS_ESTOQUE.custo_unitario`, 03a) e a
  conta do consumo é a do lançamento de consumo do original; com outro produto, ou sem saída no original (a aplicação
  histórica), valem o custo e a categoria de agora. Mudar a quantidade usa o custo congelado.
- Próxima aplicação proposta pelo protocolo (`INTERVALO_DIAS`, sem data informada): o payload grava
  `intervalo_protocolo_dias`, e a correção com o mesmo protocolo usa esse intervalo. A verificação confere
  `data_proxima_aplicacao = data_aplicacao + intervalo_protocolo_dias` (COPIAS `PROXIMA`).
- ESTOQUE/ENTRADA do mesmo produto: as embalagens multiplicam o `fator_conversao` do payload do original, e o movimento de
  ENTRADA existe se o original o tinha (não pelo `controla_estoque` de hoje).
- REPRODUCAO: a idade da gestação que o original já tinha nesta fêmea continua aceita depois de mudar `dias_gestacao`; a
  faixa de 1 a `dias_gestacao` é regra do lançamento (o motor recusa o diagnóstico novo acima dela), não da verificação, que
  só exige 1 dia em diante.

**Custo em dobro.** Com o produto do cadastro com custo (`s.consumo.valor > 0`), o pago no ato (`custo_valor`) numa conta de
consumo de insumo (VACINAS, MEDICAMENTOS, ALIMENTACAO, TRATAMENTOS) é recusado: VALIDATION `CUSTO_EM_DOBRO` no campo
`custo_conta_id`, com o caminho (a compra pela entrada no estoque; aqui só o serviço; ou o produto pelo nome). Vale no
registro, na simulação e na correção. A ajuda do campo (`EventCatalog`) diz o mesmo.

**Duplicidade por animal.** REPRODUCAO, SANIDADE e OCORRENCIA avisam `POSSIVEL_DUPLICIDADE` na linha do animal quando ele já
tem o mesmo fato no mesmo dia num lançamento que não chega aos 80% de animais em comum. A chave é a da importação
(`jaRegistrado_`): mesmo subtipo e data; na sanidade, o mesmo produto do cadastro, o mesmo nome livre ou, sem produto, a
mesma doença ou o mesmo diagnóstico; na ocorrência, o mesmo tipo. Segue a política de avisos.

**Estoque.** `produto.salvar` que liga o controle com o saldo dos movimentos negativo pede confirmação
(NEEDS_CONFIRMATION `ESTOQUE_INSUFICIENTE`, com a política) e manda acertar pela contagem. O aviso de estoque insuficiente
da aplicação também manda acertar pela contagem, e não lançar a entrada de novo, quando há compra do produto sem movimento
de entrada (`HealthService.compraSemMovimento(repo, productId)`).

**Verificação e quarentena (`AuditService`).**
- Cópia do peso: ENTRADA_INICIAL, OUTRA_ENTRADA, COMPRA, VENDA (o SUJEITO) e NASCIMENTO (a CRIA) conferem
  `PESAGENS.peso_kg = EVENTO_ANIMAIS.peso` do animal no evento, e a linha com peso sem a pesagem dele (COPIAS, sem reparo).
- Quarentena do saldo do insumo: o achado da fonte quebrada cita os produtos do movimento, do consumo e da aplicação do
  evento (`PRODUTOS\u0000product_id`). O comando que movimenta esse produto é recusado e a projeção `estoque_atual` não é
  regravada a partir da fonte quebrada (registro, importação e desfazer). O escopo da trava inclui os eventos que movimentam,
  consomem ou aplicam cada produto tocado.
- A linha MATRIZ da desmama sem bezerro dela (a mãe trocada por correção de cadastro) tem `resolver`: estornar a desmama,
  trocar a mãe e desmamar de novo.

**Reprodução na data (`Timeline.reproducaoEm(f, id, data)` → `{situacao_reprodutiva, marcado_descarte}`).** É a mesma regra da
projeção, só com os fatos até D: o último registro reprodutivo, com a situação declarada na entrada valendo como o fato da
data dela, e a última MARCACAO/DESCARTE vigente até D. A projeção, `reproducao.matrizes` em qualquer data e
`reproducao.indicadores` (matrizes ativas, prenhas, sem informação e a natalidade anual) usam esta função. Os indicadores da
estação na data D usam só a exposição, o diagnóstico, o aborto e o parto até D. `reproducao.matrizes` devolve também
`resumo.expostas_ou_inseminadas`; a tela não soma.

**Pesagem (`WeightService`).** `resultadoDoEvento` (a resposta do registro, usada pelo modo curral) devolve `gmd_kg_dia` pela
conta da ficha (intervalos individuais da mesma permanência e com o mínimo de dias) e, quando vazio, `gmd_motivo` e
`gmd_explicacao`. O ganho, os dias e a variação continuam contra a anterior. Em `peso.desempenho`, a lista `animais` segue o
filtro de pasto e de categoria: o animal com intervalo, com pesagem no período ou presente lá no fim do período. O GMD do
período vazio com várias pesagens individuais explica por que nenhum intervalo conta (o marco zero, ou o animal fora do
rebanho entre as pesagens).

**Outros.** A agenda sem protocolo usa a última aplicação do produto de qualquer lançamento: a com protocolo cumpre a
pendência (`HealthService.agendaEm`). `carenciaNaVenda_` não confere a venda anterior ao marco zero (a mesma regra da
aplicação contra a venda histórica). `animal.editar` lê as abas do leitor (`AnimalService.leituras()`), e
`HealthService.carenciaHoje` lança INTERNAL sem a SANIDADE lida (nunca "sem carência" em silêncio). O item de
`evento.listar` da SANIDADE traz `sanidade: {produto_id, nome_produto, diagnostico, tipo_procedimento}`. Na importação de
pesagem por lote, a média só se compara com outra MEDIA_LOTE; com uma linha do lote já na base, as demais ficam com
`LOTE_EM_PARTE` (o lote entra inteiro ou não entra).

**Telas.**
- Curral e tronco (`Weights`, `Reproduction`): a recusa solta o bloco sem apagar o que disse. As linhas citadas ficam ERRO,
  com o motivo e as ações "Corrigir o peso" ou "Corrigir o resultado" e "Tirar", e contam como pendência. A recusa geral fica
  na área de status (`[data-erro-geral]`). O bloco é criado na hora de sair, um por vez: nenhuma linha fica presa num bloco
  NOVO, e o botão, o status, "Desfazer" e "Tirar" tratam a linha de bloco NOVO como não enviada. No tronco, rediagnosticar a
  fêmea já gravada avisa que grava outro diagnóstico (`data-conferencia-repetido="outro"`).
- Curral com data diferente de hoje: o contador, o brinco e o pasto vêm de `inventario.elegiveis({tipo: 'PESAGEM', data})`,
  com o rótulo "posição em dd/mm/aaaa" (`[data-curral-posicao]`).
- Início (`Dashboard`): o rascunho TRONCO_DIAGNOSTICO aparece como o do curral, com "Continuar" e o aviso de diagnósticos sem
  confirmação.
- Gráficos: o ganho de lote tem um item por lançamento (o rótulo leva "lançamento n de m" quando há mais de um no dia). Nas
  taxas por categoria, "parcial" vai na nota do valor (`UI.grafico` passa a nota ao `formatar`), nunca no item.
- Sanidade → Aplicações mostra o produto ou o diagnóstico de `item.sanidade`. A aba Reprodução da ficha, com outra versão do
  app no servidor, oferece "Recarregar a página".

**Teste aleatório (seção 36).** O oráculo do efeito da SANIDADE e do ESTOQUE espera, na correção, os valores congelados do
original (`consumoCongelado`, `intervaloCongelado`, `entradaCongelada` em `tests/apoio-fuzz.js`). `oraculoEfeitoCongelado`
confere a correção tardia sem mudança depois de o preparo rever o cadastro (custo, categoria, intervalo do protocolo, fator,
controle de estoque); a correção é a do lançamento preparado (`sis.tardiaAlvo`). O pago no ato na conta Vacinas tem o
oráculo do aceite (nunca em dobro) e o da recusa (`CUSTO_EM_DOBRO` só com o produto do cadastro numa conta de insumo, em
`oraculoRecusa`).

## 44. Conserto da revisão da Fase 3, rodada 2 — `EventService`, `HealthService`, `AuditService`, `ImportService`, `Timeline`, `ReproductionService`, `InventoryService`, `AnimalService`, `WeightService`, `TestRunner`, `Weights`, `Reproduction`, `Dashboard`, `Health`, `Pastures`, `Components`, `Events`

O que a rodada 2 da revisão da Fase 3 mudou nos contratos das seções 11, 14, 15, 18, 38 a 40 e 43 (os testes, um por achado e
por caminho, estão em `tests/revisao2.fase3.motor.test.js`, `tests/revisao2.fase3.zootecnia.test.js` e
`tests/ui/revisao2.fase3.test.js`; o teste aleatório confere o mesmo pelos oráculos da seção 36).

**Dose por peso congelada na correção (`EventService`, `doseDoOriginal_`).** Na correção (e na correção do substituto) da
SANIDADE com o mesmo produto (ou o mesmo nome livre), o modo `POR_PESO`, a mesma `dose_referencia` e a mesma data, a linha sem
dose usa a `SANIDADE.dose` gravada do animal no original (03b: a dose é imutável; o operador confirmou a proposta pelo peso
daquele dia): a pesagem lançada depois, o peso de referência e a validade do peso mudados depois não refazem a dose, a saída nem o
custo. Mudar a dose por kg, a data ou o produto, ou incluir o animal, refaz pelo peso na data. `impactos.sanidade.animais[]`
traz `dose_do_original`; a revisão diz "a dose gravada no original". A prévia da correção (`Events`) continua mandando a dose
vazia: a decisão é do servidor.

**Contagem do estoque (`EventService.contagemPosterior_`, `HealthService.contagensDoProduto`, `contagemAfetada`).** O acerto
pela contagem (ESTOQUE/AJUSTE, `motivo_ajuste = CONTAGEM`) vale como o saldo no fim do dia contado (03a, MOVIMENTOS_ESTOQUE;
desenho-base 4.3: "na data D" é o fim do dia D). O comando que muda o saldo do fim do dia de uma contagem vigente do produto (a
aplicação retroativa, a entrada retroativa, a perda ou a contagem anteriores, o estorno e a correção que mudam a quantidade de um
movimento até aquele dia) é recusado: CONFLICT `CONTAGEM_POSTERIOR` no campo `product_id`, com o saldo antes e depois e a
contagem em `conflito`; o caminho é estornar a contagem, gravar o lançamento e contar de novo. A contagem anulada pelo próprio
comando não conta. Vale no registro, na simulação, na correção, no estorno e na importação (a linha fica com o motivo).
A verificação confere, em COPIAS (`fonte: false`: não é dado apagado à mão, não bloqueia o reparo das outras projeções), que o
saldo dos movimentos vigentes no fim do dia contado é o `saldo_contado` do payload, com o `resolver` (estornar a contagem e
contar de novo) e a chave com o saldo calculado (a trava recusa também o que piora); o desfazer de uma importação que mudaria
esse saldo é recusado pela trava. O coletor de achados aceita `fonte: false` para uma checagem de FONTE_QUEBRADA.

**Entrada de estoque com o movimento congelado (`com_movimento`).** O payload da ESTOQUE/ENTRADA grava `com_movimento`
(true/false: o movimento de ENTRADA gravado ou não, pelo controle de estoque do dia ou pelo do original na correção).
`entradaDoOriginal_` e `HealthService.compraSemMovimento` usam esse valor (sem ele, a entrada anterior ao campo, pela linha). A
verificação acusa em COPIAS a entrada com `com_movimento = true` sem o movimento (apagado à mão: o produto entra na quarentena da
seção 43) e a com `false` com movimento.

**Importação de sanidade com a quantidade do frasco (`ImportService`).** Com a coluna "Quantidade que saiu do frasco" e uma linha
DUPLICADA no lançamento, as demais ficam ERRO com `QUANTIDADE_EM_PARTE` (campo `quantidade_total`): a quantidade é do lançamento
inteiro (07, seção 5: nunca em dobro). Sem a quantidade, as outras entram com as doses delas (seção 42).

**Na data D (`Timeline.criaAoPeEm(f, filhos, data)`, `Timeline.brincoEm(f, id, data)`).** `reproducao.matrizes` em qualquer data
calcula `cria_ao_pe` (e o resumo) pela regra da projeção só com os fatos até D: a cria presente no fim de D, sem desmama até D,
nascida na fazenda ou que entrou abaixo da idade de desmama. `inventario.elegiveis` devolve o brinco em uso no fim de D (a
sequência de identificações até D; sem nenhuma, o do cadastro) e `brinco_hoje`.

**Agenda sanitária (`HealthService`).** O contexto dá a cada protocolo `inicio_vigencia`: o cadastro (`created_at`) ou, se antes,
a primeira aplicação vigente que o cumpre (o protocolo já praticado e cadastrado depois). Numa data D, só os protocolos com
`inicio_vigencia ≤ D` geram pendência e cobertura (05, RN-058: "o protocolo está ativo"). O vencimento não muda: o INTERVALO_DIAS
nunca aplicado e a UNICA seguem o do animal (03a, seção 4.9: "o dia em que se tornou elegível"), também no dia do cadastro do
protocolo. A tela da agenda numa data passada diz que os protocolos são os ativos hoje que já valiam naquela data.

**Peso (`AnimalService.pesoVigente`, `InventoryService.compor`, `WeightService`).** A última pesagem por ESTIMATIVA_VISUAL dentro da
validade dá `situacao: 'ESTIMATIVA_VISUAL'`, `estimado: true` (o peso vale para a UA e o peso vivo, rotulado; P10). A composição
tem a parte `estimativa_visual` da UA, conta-a em `pct_estimado` e no rótulo. A média do lote (MEDIA_LOTE) é peso de balança
do lote: fica "pesada". `resultadoDoEvento` (o modo curral) dá o GMD do intervalo da ficha que termina na pesagem (contra a
individual anterior, com a estimada ou a média do lote no meio fora), ou vazio com o porquê verdadeiro (a própria estimada,
outra individual depois dela no mesmo dia, as anteriores todas estimadas, a primeira); `anterior` traz `metodo` e `estimado`.
Em `peso.desempenho`, as pesagens e o GMD de lote contam só os animais do filtro (pasto e categoria na data da pesagem, sexo e
raça); o lançamento sem nenhum deles sai da lista.

**Desmama (`EventService.itemDesmama_`).** A cria que o original da correção já desmamava continua aceita depois de mudar
`idade_desmama_padrao_meses`; a regra do parâmetro vale para o bezerro novo no lançamento.

**Produto do cadastro sem custo por unidade.** `impactos.estoque.produto_sem_custo` na entrada; a revisão da entrada e a da
aplicação (`Components`) dizem que o que foi pago nunca vira custo e mandam preencher o custo no cadastro (03a, seção 4.6:
vazio = consumo sem custo; desenho-base 16.9).

**Aceitação (`TestRunner`).** O cenário ESTOQUE estorna a contagem antes da vacinação anterior a ela (a recusa
`CONTAGEM_POSTERIOR` primeiro); o cenário SANIDADE (058-4.7) lança a primeira aplicação do protocolo em D0+41 (o protocolo já
praticado), para a agenda das datas passadas contar com ele.

**Telas.**
- Curral e tronco (`Weights`, `Reproduction`): com data diferente de hoje, o animal é achado pelo brinco daquele dia na posição do
  servidor (`inventario.elegiveis` `{tipo: 'PESAGEM' | 'REPRODUCAO', data}`; o tronco também, com a nota `[data-tronco-posicao]`);
  o número que ninguém tinha no dia nunca vai para a dona de hoje que estava no rebanho com outro brinco; a conferência mostra
  "0457 em dd/mm/aaaa (hoje 1457)"; "Corrigir o brinco" usa a mesma resolução, a presença e o pasto da data. O animal sem
  brinco é achado pelo código interno (A-000004, ou 000004 com seis algarismos) e por "Pesar este". O tronco não mostra a
  situação reprodutiva de hoje com data passada.
- "Desfazer o último" tira a última linha não enviada (também a com aviso): a de bloco com aviso desfaz o bloco (as outras voltam
  à fila); a mensagem diz se a última foi gravada ou espera a confirmação. "Está certo" sem bloco devolve a linha à fila. O aviso
  geral do lançamento (sem animal) tem um "Está certo (todo o lançamento)" na área de status (`[data-aceitar-geral]`); o da
  linha, o dela. O status conta as linhas "para conferir" e as pendentes.
- A linha gravada do curral rotula o ganho "contra peso estimado" e mostra o porquê do GMD vazio (`[data-gmd-explicacao]`).
- Início (`Dashboard`): as telas sob demanda `Weights` e `Reproduction` vêm em segundo plano quando a Início abre (com sinal); a
  falha aparece na Início (`[data-pre-carga]`), sem erro no console.
- Revisão da sanidade: "a dose gravada no original" ou "pelo peso na data". Reprodução: a tabela dos indicadores por categoria
  rotula "(parcial)" na parição, na natalidade e na desmama. Pastos: a parte "Estimativa visual (estimado)" da UA.

**Teste aleatório (seção 36).** Oráculos novos em `tests/apoio-fuzz.js`: a dose por peso congelada na correção (`doseCongelada`)
e, na correção tardia, a dose de cada animal e a saída iguais às do original, com o preparo "pesagem lançada depois da aplicação
por peso"; a cria ao pé de cada fêmea em `reproducao.matrizes` hoje e numa data passada, pelo modelo das linhas cruas, e o resumo;
o GMD da resposta do registro igual ao do intervalo do modelo que termina na pesagem (`intervalosModelo`); a agenda com o
`inicio_vigencia` do protocolo.


## 45. Conserto da revisão da Fase 3, rodada 3 — `EventService`, `HealthService`, `AuditService`, `Timeline`, `ReproductionService`, `InventoryService`, `WeightService`, `ImportService`, `Weights`, `Reproduction`, `Components`

O que a rodada 3 da revisão da Fase 3 mudou nos contratos das seções 11, 14, 38 a 40, 43 e 44 (os testes, um por achado e por
caminho, estão em `tests/revisao3.fase3.motor.test.js`, `tests/revisao3.fase3.zootecnia.test.js` e
`tests/ui/revisao3.fase3.test.js`; o teste aleatório confere o mesmo pelos oráculos da seção 36).

**Carência padrão do produto (`EventService.cabecalhoSanidade_`).** Sem `periodo_carencia_dias` informado, a aplicação com produto
do cadastro usa `PRODUTOS.carencia_padrao_dias` (05, seção 4.8: "os dias informados no produto ou na aplicação"; 03b,
SANIDADE.periodo_carencia_dias: proposta pelo produto). Vale no formulário, na API, na correção e na importação (o modelo padrão
sem a coluna "Carência (dias)"); o 0 informado é "sem carência"; o nome livre (sem cadastro) e o registro de doença não têm
padrão. A revisão (`impactos.sanidade.carencia_dias`, `fim_carencia`) mostra a carência que será gravada, e a venda para abate
dentro dela é a de sempre (`CARENCIA_ATIVA`).

**Contagem do estoque na ordem do dia (`HealthService.saldoNaPosicao`, `contagemAfetada(contagens, antes, depois, ordem)`).** O
acerto pela contagem vale como o saldo na posição dela dentro do dia (11, riscos e premissas: "eventos têm data, não hora; a ordem
dentro do dia segue a ordem de registro"; desenho-base 16.1: o substituto fica na posição do original): os movimentos dos dias
anteriores e os do mesmo dia até a contagem, por (posição na cadeia de substituição, `event_seq`). O movimento do mesmo dia gravado
depois dela (a vacinação da tarde, a perda, a compra que chegou) fica depois e é aceito; a correção de um movimento do mesmo dia
gravado antes dela continua `CONTAGEM_POSTERIOR`. A mesma posição vale no cálculo do acerto (a correção da contagem conta só o
que estava antes do original), no registro, na simulação, na correção, no estorno, na importação e na verificação (COPIAS,
`AuditService.ordemDoEvento_`: pela linha do tempo, ou pela cadeia de `reversal_of_event_id`).

**Revisão do que o servidor grava.** `impactos.estoque.fora_do_estoque` (texto; null quando a entrada entra no saldo): a entrada sem
movimento — o produto que não controla estoque, ou a correção de uma compra gravada sem movimento (`com_movimento = false`) com o
controle ligado depois, que continua fora do saldo e cujo caminho é o acerto pela contagem. `impactos.sanidade.consumo.
porque_sem_custo`: na correção de uma aplicação gravada sem custo, a correção mantém o custo daquele dia (03a,
MOVIMENTOS_ESTOQUE.custo_unitario congelado), e preencher o cadastro depois vale para as aplicações novas. A revisão (`Components`)
mostra esses textos, não o controle nem o custo de hoje.

**Na data D.** `Timeline.brincoEm`: o número corrigido por AJUSTE_INVENTARIO/IDENTIFICACAO_INCORRETA vale desde o início do período
do número errado (desenho-base 16.2: o errado nunca esteve na orelha); a troca física depois continua com a data dela.
`inventario.elegiveis` traz, por animal, `categoria` (o nome na data) e `ultimo_peso: {kg, data, estimado}` (a última pesagem até a
data, qualquer método; null sem nenhuma), para a conferência do curral e do tronco com data passada.

**Ficha e lista de Fêmeas com a mesma conta.** As próximas doses da ficha (`HealthService.blocoFicha`) usam a entrada no rebanho da
linha do tempo (`no_rebanho_desde`), a mesma da agenda e dos alertas. Os partos de `reproducao.matrizes` (hoje e na data, e a
aptidão nas matrizes ativas) são `ReproductionService.contarPartos` (o maior entre `partos_previos` e os registrados antes da
entrada, mais os de depois), a conta da ficha. O filtro por situação da lista põe a fêmea apta com NAO_APTA gravado em
SEM_INFORMACAO (03a, seção 4.3.3; DL-05), e a tela a mostra como "Sem histórico reprodutivo".

**Integridade.** Na checagem da DESMAMA (COPIAS), a mãe do bezerro vem da reconstrução (a criação e as correções de cadastro
vigentes), não da célula de projeção `ANIMAIS.mae_id`: a projeção mexida à mão é achado de PROJECAO, reparável.

**Recusas que levam à solução.** A morte (ou a venda) retroativa da mãe que o servidor pôs na desmama (a linha MATRIZ) é recusada
com o caminho que funciona: estornar a desmama, gravar o lançamento e desmamar de novo (corrigir a desmama a poria de novo como
mãe).

**Fuso da fazenda.** O dia do cadastro do protocolo (`inicio_vigencia`) e o dia do envio na mensagem de arquivo repetido da
importação são a data do `created_at` no fuso da fazenda (`Utils.hoje(created_at, fuso)`), não a data UTC.

**Peso.** `resultadoDoEvento` traz `gmd_intervalo: {de, peso_de_kg, ganho_kg, dias} | null`, o intervalo do GMD (que pode começar
antes da pesagem anterior mostrada). `peso.desempenho` dá a cada pasto `rotulo` único (o nome; repetido, com a propriedade e, se
ainda repetir, a identificação), e o gráfico e a tabela usam o rótulo. O aviso de lotação acima da capacidade diz de onde vem a
parte estimada da UA pelo rótulo da composição (`ua.rotulo`).

**Telas.**
- Curral e tronco (`Weights`, `Reproduction`): "Mudar data, método ou pasto/estação" é refeito a cada desenho e some quando há
  bloco GRAVADO, ENVIANDO ou SEM_SINAL; cada bloco guarda o cabeçalho de quando foi criado (`b.campos`, no rascunho com a chave) e
  sai sempre com ele. A recusa que não é falta de sinal (IDEMPOTENCY_MISMATCH, DENIED, NOT_FOUND, INTERNAL…) solta o bloco: as
  linhas viram pendência com o motivo (com "Tirar"), a mensagem do servidor vai à área de status, e nada diz "sem sinal".
- Com data passada e sem a posição do servidor (carregando ou sem sinal), o brinco não é resolvido pela posição de hoje: a linha
  fica pendente (`data-conferencia="SEM_POSICAO"`), a nota oferece "Tentar de novo" (`[data-posicao-tentar]`), e com a posição na
  mão as linhas que esperavam são conferidas pela data. A data sem posição por motivo do servidor (antes do marco zero, sem marco
  zero) não espera: o brinco é conferido pela lista de hoje e o servidor decide a data na gravação (a recusa geral da seção 43).
  A conferência descreve o animal pelo dia (categoria, pasto e último peso da posição); o tronco só mostra a situação reprodutiva
  no diagnóstico de hoje.
- O código interno acha só o animal sem brinco na data, escrito inteiro (A-000004 ou 000004); o código de um animal com brinco
  fica "não encontrado", com o brinco dele na mensagem.
- O botão "Prenhe" grava prenhe; do campo, só a idade da gestação ("p90") vai junto.
- A linha gravada do curral escreve o GMD com o intervalo dele quando não começa na pesagem anterior ("ganho médio diário de X
  kg/dia desde dd/mm/aaaa (+G kg em N dias)") e mostra o porquê do GMD vazio sempre que há anterior (`[data-gmd-explicacao]`).
- Desempenho: "Comparar a curva" acha a vaca pelo brinco inteiro (as crias sem brinco só quando não há brinco exato).
- Indicadores da estação: a lista diz "(parcial)" na natalidade, na desmama e na mortalidade até a desmama, com o motivo do
  servidor (prenhe ainda sem parto, crias ainda ao pé).

**Teste aleatório (seção 36).** Oráculos novos em `tests/apoio-fuzz.js`: a carência padrão do produto (no efeito da SANIDADE e na
importação), a contagem pela posição no dia (e a interação "movimento do mesmo dia depois da contagem", com o preparo da
contagem), o intervalo do GMD da resposta da pesagem (de, peso, ganho e dias do intervalo do modelo; GMD = ganho ÷ dias), a ficha
igual à agenda nas próximas doses, os partos da lista de Fêmeas iguais aos da ficha, o rótulo único dos pastos no desempenho, o
último peso na data em `inventario.elegiveis` e o dia do cadastro do protocolo no fuso da fazenda; a interação "aplicação sem os
dias de carência, com a carência do cadastro" (com o preparo que põe a carência no produto). As sementes fixas são 23 (entrou a 29:
com as interações novas no sorteio, nenhuma das 22 chegava à correção tardia com o cadastro mudado) e exigem também a ficha ×
agenda, os partos da lista × ficha, o último peso na data e o GMD da resposta conferidos. `FUZZ_COBERTURA=1` imprime
`F.COBERTURA` no fim da leva.

## 46. Viagem no tempo: o estado em D (conserto da Fase 3 pela garantia, etapa 1) — `Timeline` (`fonteAte`, `retratoEm`, `periodosDeBrinco`), `AnimalService` (`retratoEm`, `ficha`), `InventoryService`, `PastureService`, `HealthService`, `ReproductionService`, `WeightService`, `ImportService`; `tests/apoio-fuzz.js` (`oraculoTempo`)

As três rodadas de revisão da Fase 3 repetiram a classe "número ou estado pedido numa data passada calculado com o dado de
hoje", consertada caso a caso. Esta seção troca o caso a caso por uma propriedade, um ponto único de leitura do estado em D e um
oráculo do teste aleatório que confere a propriedade em todas as consultas com data depois de cada comando (seção 36). Os testes
fixos estão em `tests/tempo.regressoes.test.js`.

**A propriedade.** A resposta de uma consulta numa data D (o fim do dia D: desenho-base 4.3) é função só de:
1. os **fatos até D**: os eventos com data até D, cada um com a situação dele (vigente, estornado, de importação em curso); a
   correção de cadastro e a do brinco lançado errado, em qualquer data (valem para todo o histórico: 04, seção 4.4; desenho-base
   16.2); o vínculo de mãe das crias nascidas até D (a fêmea parida e a cria ao pé em D: 05, seção 4.9); os atributos de cadastro
   (nome, raça);
2. os **cadastros e parâmetros que o desenho manda ler como estão hoje** (a última coluna da tabela abaixo).

Daí: (b1) acrescentar um fato com data depois de D — de qualquer tipo, também o estorno e a correção de um fato posterior a D —
não muda a resposta de D; (b2) mudar um cadastro ou parâmetro que não vale para o passado não muda a resposta de D; um fato
retroativo (com data até D) muda só o que ele alcança (a linha de cada outro animal fica igual) e, desfeito, a resposta volta;
a resposta não depende da data de hoje (a mesma consulta com o relógio adiantado é igual); e em D = hoje a consulta sem a data
é igual à consulta com a data.

**O ponto único do estado em D.**

| Função | Contrato |
| --- | --- |
| `Timeline.fonteAte(f, data)` | A fonte restrita aos fatos até o fim do dia D: as linhas de evento (`linhas`, `todasAsLinhas`), as pesagens, os registros reprodutivos, as identificações, os ajustes (a reclassificação e os demais) e as alocações de aquisição com data até D; a correção de cadastro e a do brinco lançado errado ficam em qualquer data. O resto (os eventos, a ordem do dia, os cadastros, os parâmetros) é o da fonte. Herda a fonte inteira (`Object.create`, também a do lançamento em análise no motor), `g.base_` aponta para ela e `g.ate` = D; memorizada por fonte e data |
| `Timeline.retratoEm(f, id, data, filhos)` | O animal no fim do dia D: a projeção de ANIMAIS pelo MESMO projetor do estado de hoje (`projetarAnimal`) sobre `fonteAte`, com o brinco em uso em D (a regra de `brincoEm`) e a cria ao pé em D (`criaAoPeEm`, `filhos` = os `animal_id` das crias). Situação, pasto, saída, peso, situação reprodutiva, marcas, castração e reclassificação são as daquele dia; os atributos de criação e as correções de cadastro valem para todo o histórico. Sem `custo_aquisicao`/`custo_aquisicao_origem` (03a, DL-08: o da permanência atual; as consultas numa data não leem o financeiro). null quando o animal ainda não tinha linha até D (nem no histórico anterior ao marco zero); o EXTERNO como está |
| `Timeline.periodosDeBrinco(f, id)` | Os períodos de uso dos números de brinco do animal, `[{codigo, codigo_norm, inicio, fim}]` (fim exclusivo: o início do seguinte ou a retirada; null = em uso), pela mesma sequência de `brincoEm` (`sequenciaDeBrinco_`): o número corrigido por IDENTIFICACAO_INCORRETA vale desde o início do errado, e o errado não tem período. O dono de um número numa data passada sai daqui na importação (abaixo) e é o mesmo animal que a posição daquela data dá ao número |
| `AnimalService.retratoEm(L, a, data)` | O retrato memorizado no leitor (`L.memo`). Em D = hoje, a projeção gravada (nenhum fato tem data depois de hoje): o atalho poupa o projetor nas consultas do dia, e o teste aleatório confere a igualdade a cada passo que grava (`TEMPO:RETRATO_DE_HOJE`: todo campo projetado de todo animal, menos o custo de aquisição) e a mesma consulta pelos dois caminhos (o relógio adiantado) |

Regra para quem escreve consulta numa data: a lista ou a conta descreve o animal pelo retrato em D — brinco, pasto, situação,
saída, peso, situação reprodutiva, marcas, castração, reclassificação e cria ao pé daquele dia —, nunca pela projeção de hoje.
`InventoryService.presentes(L, data)` e `presentesNoDia(L, data)` entregam os dois: `animal` (o retrato em D, calculado na
primeira leitura e guardado no item) e `registro` (a projeção de hoje, para o que a consulta mostra como "hoje", como o
`brinco_hoje`). Quem só conta cabeças, sexo, categoria e peso em D — a posição, os cartões dos pastos, a série mensal da visão
geral, os grupos do desempenho, as contas da agenda — lê `registro` (`semData_`: o sexo e o código não mudam com a data; a
categoria e o peso em D saem da linha do tempo, `AnimalService.categoriaEm` e `pesoVigente`) e não paga o retrato; quem mostra o
animal daquele dia (o brinco, a situação, a cria ao pé) lê `animal`. Na base de demonstração (304 cabeças), a visão geral e a
posição numa data não calculam nenhum retrato; os elegíveis de 15/06/2025 calculam 294, um por animal da lista.

**Inventário: rotas de consulta e cálculos do servidor com data.** As 29 rotas CONSULTA de `Api.rotas()`; as que não aparecem
(`anexo.obter`, `auditoria.listar`, `importacao.listar`, `importacao.obter`, `importacao.previa`, `importacao.modelo`,
`importacao.relatorio`, `importacao.reconciliacao`, `operacao.status`, `sistema.*`) mostram registros como estão, sem cálculo
numa data.

| Rota | Data | Em D (pelo ponto único) | Lido como está hoje, por desenho |
| --- | --- | --- | --- |
| `inventario.posicao` | `data` (padrão hoje) | presença, pasto, situação, categoria (a regra sobre o animal em D: idade, sexo, castração e reclassificação daquele dia), peso vigente (a última pesagem até D, com a validade), UA; os filtros de pasto, sexo e categoria em D | regras e nomes de CATEGORIAS (desenho-base 4.3: "com as regras atuais"), pastos e propriedades, `ua_peso_kg`, `peso_validade_dias` |
| `inventario.elegiveis` | `tipo`, `data` | quem podia receber o fato em D (no fim do dia ou no dia, RN-017), com o brinco, o pasto, a categoria e o último peso de D | `brinco_hoje` (o número de hoje: o curral mostra a troca) |
| `pasto.listar` | `data` | cabeças, UA, UA/ha e ocupação em D; o pasto desativado depois que tinha animal em D continua na lista (02, política `escrita`) | área, capacidade, situação e nome do pasto |
| `pasto.painel` | `data`, `periodo_inicio`, `periodo_fim` | os animais em D (retrato), o "desde quando", o peso médio; os dias de permanência do período, com o animal no fim do período | o cadastro do pasto |
| `sanidade.agenda` | `data` (e o período dos custos) | as pendências (aplicações até D, entrada no rebanho), a carência em D (com o brinco de D), a cobertura das campanhas, os custos do período (congelados na aplicação) | as regras dos protocolos que já valiam em D (RN-058: o cadastrado depois de D não conta; `inicio_vigencia` = o dia do cadastro no fuso da fazenda ou a primeira aplicação, o que vier antes; 03a, seção 4.9), os nomes dos produtos, o plano de contas, `agenda_*` |
| `reproducao.indicadores` | `data`, `estacao_id`, `ano` | os registros até D, as matrizes em D; sem estação pedida, a mais recente iniciada até D com registro reprodutivo até D | as estações (03a, seção 4.10), as categorias, os parâmetros reprodutivos (03a, seção 4.12) |
| `reproducao.matrizes` | `data`, `estacao_id`, filtros | as fêmeas em D com o brinco, a situação, a cria ao pé, os partos e a aptidão de D; com estação, só as expostas até D | as estações, os parâmetros |
| `peso.desempenho` | `de`, `ate`, filtros | as pesagens até `ate`; cada linha de animal com o brinco, a situação e o pasto em `ate`; o pasto e a categoria do filtro na data de cada pesagem e no fim | `curvas` (a curva da vida de cada animal pedido, a mesma da ficha, com o ponto de hoje da projeção: 07, seção 8.1), as categorias, os pastos, os parâmetros do GMD |
| `dashboard.obter` | `data_inicio`, `data_fim` | a posição em `data_fim`, o movimento, as vendas e as séries do período | `titulos` (em aberto hoje, com a etiqueta), `pendencias` de cadastro, `geradoEm` |
| `evento.listar` | `de`, `ate` | os lançamentos do período com a situação de cada um | — (o estorno de um fato até D é fato retroativo: tira o fato) |
| `animal.ficha` | a data de referência: hoje no rebanho, a da saída para quem saiu | idade, categoria, peso, situação reprodutiva, cria ao pé, aptidão e carência no retrato da data de referência | as listas (eventos, partos e crias, bezerros, genealogia, anexos, financeiro, registros como touro) e a localização; a volta ao rebanho leva a ficha para hoje |
| `animal.listar` (lista leve), `evento.obter`, `alerta.listar` | — | — | hoje: a projeção gravada; o brinco do rótulo do evento é o de hoje; os alertas são de hoje |
| Importação (`importacao.validarBloco` e `importarBloco`) | a data da linha (manejo e eventos) ou o marco zero (a mãe e o pai do rebanho inicial) | o dono do número na data pelos períodos de `Timeline.periodosDeBrinco` | — |
| Comandos (`evento.*`) | `event_date` | a validação na linha do tempo do fato (seção 13) | a data de hoje só para recusar a data futura |

Os cálculos do servidor que essas rotas usam recebem a data e leem os fatos até ela: `Timeline.situacaoEm`, `presentesEm`,
`pastoAntesDaSaida`, `diasPermanencia`, `brincoEm`, `criaAoPeEm`, `retratoEm`; `AnimalService.categoriaEm`, `pesoVigente`,
`retratoEm`; `HealthService.carenciaEm`, `agendaEm`; `ReproductionService` (`matrizesEm_`, `indicadoresDaEstacao_`,
`indicadoresAnuais_`, `previsaoParto`); `WeightService.desempenhoAnimal` (com `de`/`ate`). Os cadastros que não valem para o
passado e não mudam nenhuma resposta numa data (b2): o custo, a categoria, o fator, a unidade, o controle de estoque, a carência
padrão e a situação do produto; o protocolo cadastrado depois de D; parceiros, listas, propriedades novas, animais de referência;
os parâmetros que só valem para os comandos (`avisos_politica`, `fin_bloqueio_ate`, `brinco_*`, `arroba_kg`,
`rendimento_carcaca_padrao_pct`, `importacao_lote_linhas`, `propriedade_padrao_id`...); e a desativação da categoria alvo de uma
reclassificação manual que valia em D (02, política `escrita`: a manual continua; a automática segue a regra de hoje).

**O que mudou para cumprir a propriedade** (cada item com o teste fixo em `tests/tempo.regressoes.test.js`, que falha com o
`src/` de antes):
- O brinco de D em toda lista de uma data: painel e dias de permanência do pasto, agenda (pendências e carência), fêmeas e
  linhas do desempenho (antes, o número de hoje: a troca depois de D mudava a lista de D). `presentes`/`presentesNoDia` com
  `animal` = retrato; `inventario.elegiveis` sem o caminho duplo (`data === hoje ? projeção : brincoEm`).
- As linhas de `peso.desempenho` com a situação e o pasto em `ate` (antes, os de hoje: a venda depois do período mudava a tabela).
- `reproducao.indicadores`: a estação padrão só pelos registros até D; `reproducao.matrizes` com estação: só as expostas até D
  (antes, a exposição gravada depois de D mudava a estação e a lista de D).
- `pasto.listar` com o pasto desativado que tinha animal em D (antes, sumia da lista da data e as cabeças não fechavam).
- A ficha de quem saiu: a carência, a aptidão, a situação e a cria ao pé no dia da saída (antes, as de hoje: a desmama da cria
  depois da venda mudava a ficha da vaca vendida).
- A importação (manejo, eventos e a mãe e o pai do rebanho inicial) acha o dono do número na data pelos períodos de
  `Timeline.periodosDeBrinco`, o mesmo animal que a posição daquela data (antes, pelos períodos gravados de IDENTIFICACOES: o
  número corrigido por IDENTIFICACAO_INCORRETA só valia da data da correção, e o errado ainda achava o animal). A validação da
  importação de ANIMAIS lê EVENTOS com acesso cru.

**O oráculo (seção 36, `tests/apoio-fuzz.js`, `oraculoTempo`).** Num passo sorteado por um gerador à parte (as sequências das
sementes não mudam; `cmd.tempo` = {D, avanco}, gravado na sequência para repetir e encolher), tira o retrato da bateria de
consultas em D — `inventario.posicao` (inteira, por sexo, por pasto, por categoria e de cada animal da amostra),
`inventario.elegiveis` (TRANSFERENCIA, PESAGEM, NASCIMENTO), `pasto.listar` (todos e a lista padrão), `pasto.painel` com a
permanência dos 60 dias até D, `sanidade.agenda`, `reproducao.indicadores` (padrão, por estação e do ano),
`reproducao.matrizes` (todas e de uma estação), `peso.desempenho` (desde o marco zero, 120 dias, por pasto e por categoria),
`dashboard.obter` (inteira e por pasto), `evento.listar` e a ficha de quem saiu (na data da saída) — em UNIDADES (a consulta
inteira ou a linha de um animal), cada uma com a impressão digital do que pode ler pelas regras acima (os fatos do rebanho ou do
animal até D, com as crias, e os cadastros do grupo). Depois de cada passo que grava, compara as unidades cuja impressão não
mudou (`TEMPO:<grupo>`): o fato depois de D e o cadastro que não vale para o passado não mudam nada; o fato retroativo muda só as
unidades que alcança. No próprio passo do retrato: a mesma bateria com o relógio adiantado 1, 31, 200 ou 400 dias
(`TEMPO:RELOGIO:<grupo>`), em D = hoje a bateria sem a data (`TEMPO:PADRAO:<grupo>`), a lista de pastos com todo pasto que tinha animal em D
(`TEMPO:PASTO_SUMIU`), a ficha de hoje igual à posição, à lista de fêmeas e à agenda de hoje, e a ficha de quem saiu igual aos
elegíveis do dia da saída (`TEMPO:FICHA_X_DATA`); depois de desativar uma categoria, a reclassificação manual da data continua
(`TEMPO:CATEGORIA_DESATIVADA`); e, a cada passo que grava, o retrato de hoje = a projeção (`TEMPO:RETRATO_DE_HOJE`). A data D é
sorteada perto dos fatos (45%: a data de um evento, ±1 dia), no intervalo do marco zero a hoje (35%), hoje (12%), o marco zero
(4%) e antes dele (4%). `FUZZ_COBERTURA=1` imprime os contadores "viagem no tempo: …", e as sementes fixas exigem os principais.
