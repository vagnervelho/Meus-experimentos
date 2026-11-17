# Relatório da Fase 3 — Manejo

Data: 17/11/2026. Versão do app: 0.1.0. Plano: `docs/fase-0/10-plano-de-implementacao.md`, seção 4 (entregas E3.1 a
E3.7) e seção 8 (checklist). Relatório da fase anterior: `docs/RELATORIO_FASE2.md`.

## Em resumo

- **O código da Fase 3 está completo no repositório** (`erp-pecuario/src/`: 24 arquivos `.js`, 13 `.html` e o
  manifesto; entraram o `WeightService` e as telas `Weights`, `Health` e `Reproduction`) e passou em todos os testes que
  rodam aqui, inclusive os das Fases 1 e 2: **`npm test` com {{NT}} testes, {{NP}} aprovados, {{NF}} falhas** e **`npm run
  ui:check` com {{UT}} testes de navegador, {{UP}} aprovados, {{UF}} falhas** (execução final de 17/11/2026, sobre o código do
  conserto da revisão; nesta etapa só mudaram documentos e dois comentários de código, seção 4, item 13).
- Pesagem, sanidade e reprodução são registradas no curral e viram indicadores: pesagem individual, coletiva e por lote,
  com o modo curral no celular; ganho médio diário (GMD), curva de peso e projeção rotulada; insumos com estoque
  opcional, aplicações com consumo e custo no momento da aplicação, carência, agenda e alertas; estação de monta,
  exposição, cobertura, inseminação, diagnóstico de gestação (com o "tronco", o diagnóstico em lote no celular) e aborto,
  com a situação de cada fêmea, a previsão de parto e os indicadores da estação; desmama, castração e ocorrências;
  importação do histórico desses quatro tipos; gráficos em SVG próprio. O sistema registra o que o veterinário e o dono
  decidem: não prescreve protocolo nem tratamento.
- Cada tipo novo passa por **um tratador só** em todo caminho (registrar, simular, retroativo, mesmo dia, corrigir,
  corrigir o substituto, estornar, importar, desfazer, base de demonstração), e o que ele grava é conferido pela mesma
  função da verificação de integridade e da trava única (`AuditService.conferirDominio_`).
- **Telas sob demanda (risco R-31).** A página inicial ficou em {{KB_INI}} KB de 450 KB; a importação e as três telas
  novas são pedidas ao servidor quando o menu as abre (Import {{KB_IMP}} KB, Weights {{KB_W}} KB, Health {{KB_H}} KB e
  Reproduction {{KB_R}} KB, de 150 KB cada). Que o quadro (iframe) do HtmlService rode a tela injetada é hipótese (NV):
  se não rodar, a contingência está pronta (seção 5, item 1).
- **Nada foi implantado nem executado na conta Google do dono.** Continuam **PENDENTES NA CONTA DO DONO** os itens das
  Fases 1 e 2 e, da Fase 3: `runAcceptanceTests` com os 23 cenários, as premissas PR-06, PR-07, PR-10 e PR-11, o
  cadastro dos produtos e protocolos com o veterinário e o modo curral num celular de verdade, no curral. Pela regra de
  honestidade, **a Fase 3 não está fechada** até esses resultados chegarem.
- O teste aleatório rodou **5.100 sementes novas** ao longo da fase, sem nenhuma falha do sistema (5 falhas, todas do
  modelo do teste). Mesmo assim, a **revisão independente** achou **29 defeitos** (14 de gravidade alta, 10 de média e 5 de
  baixa; 28 distintos), que o teste aleatório não tinha visto: todos foram corrigidos e têm teste. Nenhuma rodada revisou
  esses consertos, e **a convergência não está demonstrada** (seção 6.3).
- Como atualizar a implantação: `docs/GUIA_DE_IMPLANTACAO.md`, seção 11.2, com o roteiro do modo curral.

## Regra de honestidade (09-plano-de-testes.md, seção 1)

Cada item deste relatório tem um de quatro estados:

| Estado | Significado |
|---|---|
| `EXECUTADO AQUI` | Rodou neste repositório; o comando e as contagens estão copiados da saída real |
| `EXECUTADO PELO DONO` | Rodou na conta do dono, com o arquivo de resultado. **Nenhum item está neste estado ainda** |
| `PENDENTE NA CONTA DO DONO` | Só pode ser executado na conta Google do dono; o roteiro está pronto |
| `NÃO SE APLICA` | Não se aplica a esta fase, com o motivo |

O nível 3 (Playwright) é `EXECUTADO AQUI` porque o navegador rodou neste ambiente. Ele roda contra um mock de
`google.script.run` ligado ao backend real do harness, não dentro do quadro (iframe) do HtmlService, e não num celular:
o teclado numérico, o `localStorage` do aparelho e o sinal fraco de verdade não foram exercitados. O nível 2
(`runAcceptanceTests`) também roda aqui, mas sobre os fakes do harness (`tests/acceptance.test.js`); com os serviços
reais do Google, só na conta do dono.

## 1. Entregas

| Entrega | O que foi entregue | Arquivos | Testes que cobrem | Estado |
|---|---|---|---|---|
| E3.1 PESAGEM | Individual, coletiva e por lote (cada animal com a média, 1 casa, `MEDIA_LOTE`) por um tratador só; peso fora de 0,1 a 2.000 kg ou com duas casas recusado (RN-049); `PESO_IMPLAUSIVEL` contra a pesagem anterior e, no retroativo, contra a seguinte (RN-050); `POSSIVEL_DUPLICIDADE` no mesmo dia; GMD só entre pesagens individuais da mesma permanência e com 28 dias ou mais (sem valor com o motivo, nunca zero); GMD do período, por pasto, por categoria e de lote; projeção rotulada "Estimativa"; curva na ficha; tela de desempenho; **modo curral** no celular: brinco, Enter, peso, Enter, blocos de 20 com chave própria, rascunho no aparelho e no servidor, conferência pela chave depois de resposta perdida, aviso e recusa do servidor na linha | `WeightService` (novo), `EventCatalog`, `EventService`, `AuditService`, `Timeline`, `AnimalService`, `Api` (`peso.desempenho`), `Weights` (novo, sob demanda), `Components` (`UI.curvaPeso`), `Animals`, `Events`, `Dashboard`, `JavaScript` | `pesagem.test.js`, `pesagem.desempenho.test.js` (CT-05 número a número), `acceptance.test.js` (CT-05, CT-10 passo 3, CT-17 e CT-18 com a pesagem), `estorno.test.js`, `regras.fase3.test.js` (RN-051, RN-053), `revisao.fase3.zootecnia.test.js` (achados 5, 15, 29), `revisao.fase3.motor.test.js` (achado 8), `revisao.fase3.regras.test.js` (achado 26), `ui/pesagem.test.js` (360 px, rede cortada, aviso aceito na linha), `ui/revisao.fase3.test.js` (achados 5, 11, 12, 22) | `EXECUTADO AQUI`; celular no curral e iframe: `PENDENTE NA CONTA DO DONO` |
| E3.2 PRODUTOS, estoque opcional (ESTOQUE), PROTOCOLOS_SANITARIOS | `produto.salvar` (unidade que não muda depois do primeiro uso; estoque controlado só quando pedido, PR-10) e `protocolo.salvar` (uma vez, a cada N dias, campanha em meses; sexo, faixa de idade, categoria, antecedência, tolerância); ESTOQUE com entrada (a compra é sempre um lançamento COMPRA_INSUMOS com parcelas; o movimento de entrada só com o controle ligado, decisão 16.9) e acerto (contagem pela diferença, perda, vencimento); saldo como projeção dos movimentos vigentes, refeito pelo projetor e conferido pela trava; ligar o controle com saldo negativo pede confirmação | `HealthService`, `EventCatalog`, `EventService`, `AuditService`, `FinancialService`, `Timeline`, `Health` (novo, sob demanda) | `estoque.test.js` (03a, 4.7), `acceptance.test.js` (ESTOQUE), `revisao.fase3.motor.test.js` (achados 7 e 13), `revisao.fase3.regras.test.js` (achado 16), `ui/sanidade.test.js` | `EXECUTADO AQUI`; cadastro real com o veterinário e PR-10: `PENDENTE NA CONTA DO DONO` |
| E3.3 SANIDADE | Seis subtipos (vacinação, vermifugação, medicação, tratamento, exame, doença), individual e coletiva, com produto do cadastro, nome livre ou, na doença, sem produto; dose por cabeça, por peso (o peso na data com a validade, ou o de referência da categoria) ou só o total do frasco; consumo e custo na aplicação (PR-11): a saída do estoque e um CUSTEIO sem parcela rateado aos tratados (03b, 15.2 centavo a centavo); serviço pago no ato com parcelas; o produto do cadastro com custo pago também no ato recusado (`CUSTO_EM_DOBRO`); carência (RN-072) na venda e, pelo outro lado, na aplicação retroativa que cobre uma venda para abate já gravada; agenda por protocolo e pela próxima dose informada, com a cobertura e o custo sanitário do período; alertas `SANITARIO_VENCIDO`, `SANITARIO_PROXIMO` e `EM_CARENCIA`; avisos `PRODUTO_VENCIDO` e `ESTOQUE_INSUFICIENTE` (aviso ou bloqueio pelo parâmetro); bloco F da ficha; carência no cartão da venda e no seletor | `HealthService`, `EventCatalog`, `EventService`, `AuditService`, `InventoryService`, `AnimalService` (`carencia_ate`), `Health`, `Components`, `Animals`, `Events` | `sanidade.test.js` (03b 15.2 linha a linha, CT-06), `sanidade.agenda.test.js` (03a 4.9; 05, 4.7), `venda.test.js` (carência pela SANIDADE real), `acceptance.test.js` (CT-06, SANIDADE), `regras.fase3.test.js` (RN-058), `revisao.fase3.motor.test.js` (achados 3, 4 e 6), `revisao.fase3.zootecnia.test.js` (achado 10), `revisao.fase3.regras.test.js` (achados 17, 23, 24), `ui/sanidade.test.js`, `ui/revisao.fase3.test.js` (achado 20) | `EXECUTADO AQUI`; PR-11 e o tempo da agenda com a base real: `PENDENTE NA CONTA DO DONO` |
| E3.4 ESTACOES_MONTA e REPRODUCAO | `estacao.salvar`; exposição (fêmeas e touros na mesma lista; linha TOURO), cobertura, inseminação, diagnóstico em lote (positivo, negativo, duvidoso, com a idade da gestação e a previsão informada) e aborto; situação reprodutiva pelo último fato e pela situação declarada na entrada; previsão de parto nos quatro níveis de 03b, 7.3, sempre rotulada como estimativa; regras de manejo (touro castrado, parto dentro da gestação de um diagnóstico) antes e depois de todo comando; indicadores de 07, seção 8.3 (prenhez, parição, natalidade, perda gestacional, desmama, mortalidade até a desmama, IEP, idade ao primeiro parto) por estação, por categoria e na forma anual, com numerador, denominador, n e "parcial", numa data qualquer; lista de fêmeas com alertas `PARTO_PREVISTO` e `PRENHEZ_VENCIDA`; ficha da matriz (bloco G); **diagnóstico no tronco** (o modo curral do diagnóstico) | `ReproductionService`, `EventCatalog`, `EventService`, `AuditService`, `Timeline` (`reproducaoEm`), `InventoryService`, `AnimalService`, `Api` (`reproducao.indicadores`, `reproducao.matrizes`), `Reproduction` (novo, sob demanda), `Animals`, `Events`, `Dashboard` | `reproducao.test.js`, `reproducao.indicadores.test.js` (o exemplo de 07, 8.3 e o de RN-066 número a número), `acceptance.test.js` (REPRODUCAO), `regras.fase3.test.js` (RN-065), `revisao.fase3.zootecnia.test.js` (achados 1, 2, 9, 28), `revisao.fase3.motor.test.js` (achado 14), `ui/reproducao.test.js`, `ui/revisao.fase3.test.js` (achados 11, 12, 17, 19, 21, 27) | `EXECUTADO AQUI`; PR-07: `PENDENTE NA CONTA DO DONO` |
| E3.5 DESMAMA, CASTRACAO, OCORRENCIA | Desmama da cria (DL-06) com o peso (vira a pesagem DESMAMA) e o pasto de destino (o movimento), a linha MATRIZ uma vez por mãe; castração do macho inteiro (deixa de ser reprodutor); ocorrência com o tipo da lista e a descrição; os três com a despesa paga no ato rateada por cabeça; desmama e castração repetidas recusadas; a troca da mãe de uma cria já desmamada recusada com o caminho da solução | `EventCatalog`, `EventService`, `ReproductionService`, `AuditService`, `Timeline` | `manejo.test.js`, `acceptance.test.js` (REPRODUCAO, desfechos da estação), `estorno.test.js`, `revisao.fase3.regras.test.js` (achado 25) | `EXECUTADO AQUI` |
| E3.6 Importadores de pesagens, sanidade, reprodução e ocorrências | Os quatro tipos no mesmo assistente e nos mesmos 10 passos das importações da Fase 2, cada lançamento planejado pelo tratador único num ensaio em memória com a trava; o animal pelo brinco que ele usava na data; produto, protocolo e estação pelo nome; a linha repetida e o fato já gravado ficam DUPLICADA (no manejo, a linha sai e as outras entram); histórico anterior ao marco zero (a aplicação antiga não mexe no estoque nem gera consumo; a despesa nasce sem caixa; a pesagem antiga fica na curva e fora do GMD); desfazer com as conferências do estorno | `ImportService`, `EventService` (`HISTORICO_IMPORTADO`), `AuditService`, `Timeline`, `WeightService`, `Import` | `import.manejo.test.js`, `unitofwork.adversarial.test.js` (quedas do bloco de PESAGENS e de SANIDADE nas três formas de gravação), `import.test.js`, `import.eventos.test.js`, `revisao.fase3.regras.test.js` (achados 23 e 26), `ui/importacao-manejo.test.js` | `EXECUTADO AQUI`; tempo com milhares de linhas no Sheets: `PENDENTE NA CONTA DO DONO` |
| E3.7 Gráficos | Kit em SVG próprio (SP-08, sem biblioteca nem CDN) em `Components`: linha, barras horizontais, barras empilhadas e a curva de peso; `<title>` e `<desc>`, eixo com a unidade, escala "redonda", tabela equivalente ("Ver tabela") com os mesmos textos, estado vazio e desenho na largura útil da tela; G5 (evolução mensal do peso) e o rebanho por categoria em cada pasto em `peso.desempenho`; gráficos na ficha, no desempenho, na reprodução, na sanidade e no Início, todos com os números do servidor | `Components`, `Styles`, `WeightService`, `Weights`, `Reproduction`, `Health`, `Dashboard`, `Animals` | `graficos.test.js`, `ui/graficos.test.js` (360 e 1280 px, números do desenho = tabela = servidor), `ui/revisao.fase3.test.js` (achados 18, 19, 28) | `EXECUTADO AQUI` (Chromium do Playwright); iframe, celular e computador do dono: `PENDENTE NA CONTA DO DONO` |
| Transversal: telas sob demanda (R-31) | Rota extra `sistema.tela` (sem abrir a planilha-banco); o catálogo declara o módulo sob demanda e as rotas dele; o cliente (`Modulos`) pede a tela uma vez, injeta o `<script>` como nó, guarda em memória; falha de rede com "Tentar de novo"; outra versão do app no servidor → "Recarregar a página"; `ui:check` mede a página inicial (450 KB) e cada tela sob demanda (150 KB) | `Api`, `EventCatalog`, `JavaScript`, `Index`, `scripts/ui-check.js` | `telas.sobdemanda.test.js`, `interface.test.js`, `ui/sobdemanda.test.js`, `ui/movimentos.test.js` (a corrida do seletor com data passada, consertada na etapa BASE) | `EXECUTADO AQUI`; a injeção no iframe real: `PENDENTE NA CONTA DO DONO` (NV) |
| Transversal: aceitação, demonstração, jornada e regras | `runAcceptanceTests` com CT-05, CT-06, SANIDADE, ESTOQUE, REPRODUCAO e o passo 3 do CT-10 (23 cenários no total); base de demonstração com o manejo completo (410 comandos, 304 ativos, nenhuma recusa nem aviso aceito), conferida pelo servidor no fim (`demonstracao.manejo`); jornada de um ano de manejo só pela `api()`; mapa RN-049 a RN-066 → teste | `TestRunner` | `acceptance.test.js`, `jornada.fase3.test.js`, `regras.fase3.test.js` | `EXECUTADO AQUI` (fakes); na conta: `PENDENTE NA CONTA DO DONO` |
| Transversal: trava e teste aleatório | Cada fato novo conferido por `AuditService.conferirDominio_` (PESAGENS e a cópia do peso, SANIDADE, MOVIMENTOS_ESTOQUE e o saldo, REPRODUCAO, as regras de manejo, o histórico sem estoque), a mesma função da trava em todo caminho; o saldo do insumo na quarentena da fonte quebrada; o teste aleatório com gerador e oráculo de cada tipo e importador num registro único, o curral e o tronco em blocos com reenvio, as interações com a Fase 2 | `AuditService`, `UnitOfWork`; `tests/apoio-fuzz.js` | `trava.integridade.test.js`, `integrity.fase2.test.js`, `fase2.fuzz.test.js`, `fase3.fuzz.regressoes.test.js`, `revisao.fase3.*.test.js` | `EXECUTADO AQUI` |

## 2. Resultados dos testes executados aqui

Ambiente: Node {{NODE}} (Linux, 4 núcleos), Playwright 1.63.0 com Chromium. Execução de 17/11/2026, sobre o código final
do conserto da revisão, a última alteração de comportamento desta fase. Na etapa deste relatório só mudaram documentos e
um comentário em `src/TestRunner.js` e outro em `scripts/medir-trava.js` (seção 4, item 13). Nesta etapa, a suíte inteira
rodou duas vezes: no começo, antes de qualquer mudança (`npm test` com 809 de 809 e `npm run ui:check` com 135 de 135), e
no fim, depois de todas as mudanças; os números abaixo são os da execução do fim.

### 2.1 Nível 1 — `npm test` (`node --test tests/*.test.js`)

Saída: `# tests {{NT}} · # pass {{NP}} · # fail {{NF}} · # cancelled 0 · # skipped 0 · # todo 0` (duração {{ND}} s;
{{NWALL}} de relógio). As 22 sementes fixas do teste aleatório, 60 passos cada: `FUZZ: 22 sementes × 60 passos: 741
aceitos, 439 recusados, 0 falhas`. Contagem por arquivo, de três formas nesta etapa:
- **Rodados sozinhos**, cada um com `node --test <arquivo>`: os 32 arquivos novos ou alterados desde o relatório da Fase 2
  (17 novos e 15 alterados) e também `static` e `revisao4.interface`, que leem o `CONTRATOS.md` mudado nesta etapa. Todos
  passaram, com a contagem da tabela.
- **Os demais 41** não mudaram desde a Fase 2. Os apoios que mudaram (`apoio-fuzz`, `apoio-sistema`, `apoio-telas`) só são
  usados pelos testes e não declaram teste. Esses 41 passaram na suíte completa.
- **A contagem de todos os 75 arquivos** foi conferida sem rodar os corpos: um registrador no lugar de `node:test` conta os
  `test()` de cada arquivo, e bate linha a linha com as tabelas.

A soma confere com o total da suíte: 673 da Fase 2 + 112 dos 17 arquivos novos + 24 a mais em 3 alterados (`estorno`, de
27 para 44; `unitofwork.adversarial`, de 53 para 59; `fase2.fuzz`, de 1 para 2) = 809.

**Arquivos novos ou alterados na Fase 3** (rodados sozinhos nesta etapa):

| Arquivo | Testes | Aprovados | Falhas | O que cobre |
|---|---:|---:|---:|---|
| `tests/acceptance.test.js` | 6 | 6 | 0 | Os cenários do `runAcceptanceTests` no fake, nas duas ordens de carga: os 23 das Fases 1 a 3 (com CT-05, CT-06, SANIDADE, ESTOQUE, REPRODUCAO e o passo 3 do CT-10); retomada, falha relatada, base de demonstração completa e retomável com `demonstracao.manejo`, `runDiagnostics` (alterado) |
| `tests/animals.test.js` | 10 | 10 | 0 | Lista, ficha A a J (os blocos de peso, sanidade e reprodução entregues, com o motivo de cada valor vazio), árvore, edição, animal externo (alterado) |
| `tests/api.test.js` | 14 | 14 | 0 | Envelope, guarda de dono, roteador, avisos, duplicado, LOCKED, carga condicional (catálogo da Fase 3), ambiente TESTE, rascunho, fuso, páginas (alterado) |
| `tests/estoque.test.js` | 6 | 6 | 0 | ESTOQUE e PRODUTOS: o cadastro do produto (unidade que não muda depois do uso, estoque desligado por padrão), o exemplo de 03a, 4.7 (entrada, saída, perda, contagem), o frasco pago no ato de 07, seção 5, as regras da entrada e do acerto, os caminhos (correção, substituto, estorno com e sem dependente) e a integridade do estoque |
| `tests/estorno.test.js` | 44 | 44 | 0 | Estorno e substituição de todo tipo ativo, agora com os da Fase 3: CT-07, CT-08, CT-09, CT-17 (b), CT-18, dependente e retroativo (alterado: 27 → 44) |
| `tests/events.test.js` | 21 | 21 | 0 | Catálogo (`FASE_ATUAL` 3; tipo ativo só com campos, módulo ativo só com a tela; o menu até a Fase 5), entradas, CT-09, CT-10, CT-18 da Fase 1, estorno e correção, ajustes (alterado) |
| `tests/fase2.fuzz.test.js` | 2 | 2 | 0 | Teste aleatório de todos os comandos das Fases 1 a 3 pela `api()`: 22 sementes fixas × 60 passos (741 aceitos, 439 recusados, 0 falhas), com a cobertura mínima de cada tipo; e o registro: todo tipo ativo tem gerador e oráculo, todo importável tem arquivo (alterado: 1 → 2) |
| `tests/fase3.fuzz.regressoes.test.js` | 3 | 3 | 0 | As sequências mínimas das falhas do modelo nas passadas das Fases 1 a 3 (sementes 7106, 1210049 e 1320022), com o desfecho de cada passo |
| `tests/graficos.test.js` | 6 | 6 | 0 | G5 (evolução mensal do peso) e o rebanho por categoria em cada pasto número a número; a escala do eixo; as regras estáticas do kit (title, desc, tabela equivalente, unidade, nenhuma conta nas telas) e o contraste das 8 cores |
| `tests/import.test.js` | 9 | 9 | 0 | Importação de ANIMAIS: CT-12 da Fase 1, lotes, queda, retomar, concluir, desfazer (alterado) |
| `tests/import.eventos.test.js` | 7 | 7 | 0 | Importação de COMPRAS, VENDAS, TRANSFERENCIAS, NASCIMENTOS e MORTES (o tipo "de outra fase" deixou de existir; o desconhecido continua recusado) (alterado) |
| `tests/import.manejo.test.js` | 10 | 10 | 0 | Importação de PESAGENS, SANIDADE, REPRODUCAO e OCORRENCIAS: agrupamento, pesagem por lote, histórico anterior ao marco zero, duplicadas pela linha e pela base, os caminhos (correção, estorno, desfazer), recusas, rotas e a integridade do histórico sanitário |
| `tests/integrity.fase2.test.js` | 11 | 11 | 0 | As checagens da Fase 2 por adulteração, com o saldo de estoque na projeção conferida; a demonstração da Fase 3 inteira sem erro; tempo medido (alterado) |
| `tests/interface.test.js` | 8 | 8 | 0 | Página do `doGet` (compactada, sem as telas sob demanda), sintaxe do cliente e das telas sob demanda, contraste, alvos de toque, regras estáticas (alterado) |
| `tests/jornada.fase3.test.js` | 1 | 1 | 0 | Um ano de manejo só pela `api()`: inventário por pasto, peso e GMD de cada animal, indicadores da estação, agenda, estoque e custo sanitário contra um modelo independente; projeção = reconstrução e invariantes depois de cada comando; integridade sem erro |
| `tests/manejo.test.js` | 4 | 4 | 0 | DESMAMA (03b, 3.4 e 16.14) e por caminho; CASTRACAO (o touro castrado deixa de ser reprodutor); OCORRENCIA; a despesa paga no ato |
| `tests/nascimento.test.js` | 16 | 16 | 0 | NASCIMENTO: CT-01, gemelar, natimorto, peso ao nascer, pai opcional, REPRODUCAO, histórico da matriz (o bloco G entregue) (alterado) |
| `tests/pesagem.test.js` | 12 | 12 | 0 | PESAGEM pelos caminhos do tratador único: individual, coletiva e por lote, faixa (RN-049), variação brusca (RN-050), retroativo, mesmo dia, correção, substituto, estorno com dependente, importação e desfazer, integridade e trava, lotação em data |
| `tests/pesagem.desempenho.test.js` | 10 | 10 | 0 | CT-05 na ficha número a número; uma pesagem só; mesmo dia e retroativa; saiu e voltou; métodos; peso ao nascer; projeção; GMD de lote, por pasto e por categoria; `peso.desempenho` |
| `tests/regras.fase2.test.js` | 8 | 8 | 0 | Mapa RN → teste das 112 regras e as RN da Fase 2 sem caso próprio (alterado: o nome do teste de aceitação das Fases 1 a 3) |
| `tests/regras.fase3.test.js` | 5 | 5 | 0 | Mapa RN-049 a RN-066 → teste (cada teste citado existe; cada caso de 09, 4.1, no `TestRunner`); RN-051 em todo caminho, RN-053, RN-058 e RN-065 |
| `tests/reproducao.test.js` | 8 | 8 | 0 | Estação de monta; exposição, cobertura, inseminação, diagnóstico em lote e aborto; os caminhos; integridade e trava; importação e desfazer; ficha da matriz, lista de fêmeas e alertas |
| `tests/reproducao.indicadores.test.js` | 5 | 5 | 0 | Indicadores de 07, seção 8.3, número a número (80 expostas) e de RN-066 (40 expostas; com 4, sem valor); quem saiu no meio da estação; desmama e mortalidade até a desmama; a forma anual |
| `tests/revisao.fase3.motor.test.js` | 8 | 8 | 0 | Revisão da Fase 3, um teste por caminho dos achados 3 e 6, 4, 7, 8 e 13 (dois cada) e 14 |
| `tests/revisao.fase3.regras.test.js` | 6 | 6 | 0 | Revisão da Fase 3: achados 16, 17, 23, 24, 25 e 26 |
| `tests/revisao.fase3.zootecnia.test.js` | 8 | 8 | 0 | Revisão da Fase 3: achados 1, 2, 5, 9, 10, 15, 28 e 29 |
| `tests/revisao4.interface.test.js` | 7 | 7 | 0 | Rodada 4 da Fase 2, INTERFACE E REGRAS (sem mudança; lê o `CONTRATOS.md` desta etapa) |
| `tests/sanidade.test.js` | 9 | 9 | 0 | 03b, 15.2 linha a linha; CT-06; dose por peso; modo total, nome livre e subtipos; protocolo e avisos; caminhos; carência (RN-072) nos dois sentidos; importação e desfazer; integridade |
| `tests/sanidade.agenda.test.js` | 5 | 5 | 0 | `protocolo.salvar`; INTERVALO_DIAS, CAMPANHA_MESES e UNICA (03a, 4.9; 05, 4.7) com as datas; pendência sem protocolo, carência, custos do período e alertas |
| `tests/static.test.js` | 19 | 19 | 0 | Lint de camadas, superfície pública, `drive.file`, relógio, manifesto, rotas (as extras com contrato), includes (sem mudança; lê o `CONTRATOS.md` desta etapa) |
| `tests/telas.test.js` | 7 | 7 | 0 | Rotas acrescentadas pelas telas e regras puras do cliente (`importacao.modelo` com os dez tipos) (alterado) |
| `tests/telas.sobdemanda.test.js` | 6 | 6 | 0 | `sistema.tela` (compactada, sem a planilha-banco, recusas com a fase); a página inicial e cada tela no orçamento; catálogo × arquivos × `Index`; o cliente injeta as telas |
| `tests/unitofwork.adversarial.test.js` | 59 | 59 | 0 | Morte depois de cada escrita, também no bloco de PESAGENS e de SANIDADE da importação nas três formas de gravação; subconjuntos densos, oráculos independentes, intercalações, resposta perdida (alterado: 53 → 59) |
| `tests/venda.test.js` | 15 | 15 | 0 | VENDA: CT-04, CT-14, exemplos de 07 e 03b, carência pela SANIDADE real (alterado) |
| **Soma dos 32 novos ou alterados** | **349** | **349** | **0** | Sem `static` e `revisao4.interface` (26); com eles, 375 |

**Arquivos sem mudança desde a Fase 2** (passaram na suíte completa; a descrição de cada um está em
`docs/RELATORIO_FASE2.md`, seção 2.1): `anexos` (9), `compra` (14), `config` (8), `database` (21), `fase2.adversarial` (11), `fase2.fuzz.regressoes` (13), `files` (5), `financeiro` (8), `harness` (25), `identificacao` (10), `integrity` (7), `inventory` (4), `jornada.fase1` (1), `jornada.fase2` (1), `lotacao` (14), `maintenance` (5), `movimentos` (12), `pastures` (7), `regras.fase1` (13), `repository` (10), `revisao1.financeiro` (6), `revisao1.motor` (14), `revisao2.financeiro` (3), `revisao2.motor` (13), `revisao3.financeiro` (6), `revisao3.interface` (2), `revisao3.motor` (24), `revisao4.financeiro` (5), `revisao4.motor` (20), `revisao5.financeiro` (6), `revisao5.interface` (4), `revisao5.motor` (13), `schema` (13), `setup` (5), `telas.fase2` (6), `telas.pastos-importacao` (4), `timeline` (12), `trava.integridade` (16), `unitofwork` (32), `utils` (18), `validation` (14) — soma 434. Conta: 349 + 26 + 434 = 809.

### 2.2 Nível 3 — `npm run ui:check`

Parte estática: `{{UI_ESTATICA}}` Parte Playwright: `# tests {{UT}} · # pass {{UP}} · # fail {{UF}} · # cancelled 0 · #
skipped 0 · # todo 0` (duração {{UD}} s; {{UWALL}} de relógio com a parte estática). Tamanho do que vai ao aparelho: a
página inicial montada pelo `doGet` com {{KB_INI}} KB de 450 KB (eram 449 KB no fim da Fase 2, antes de a importação sair
dela; 406 KB depois da etapa BASE; o kit de gráficos e a ficha somaram o resto); sob demanda, Import {{KB_IMP}} KB,
Weights {{KB_W}} KB, Health {{KB_H}} KB e Reproduction {{KB_R}} KB, de 150 KB cada. Contagem por arquivo: os 9 arquivos novos ou
alterados desde o relatório da Fase 2 foram rodados de novo nesta etapa, cada um sozinho com `node --test
--test-concurrency=1 <arquivo>`: 7 novos (`graficos`, `importacao-manejo`, `pesagem`, `reproducao`, `revisao.fase3`,
`sanidade`, `sobdemanda`) e 2 alterados (`interface`, `movimentos`). Os demais 14 não mudaram, e a contagem dos 23
arquivos foi conferida pelo registrador. A soma confere com o total (92 + 42 novos + 1 em `movimentos` = 135):

| Arquivo | Testes | Aprovados | Falhas | O que cobre |
|---|---:|---:|---:|---|
| `tests/ui/graficos.test.js` | 8 | 8 | 0 | Os gráficos a 360 e 1280 px: o componente, a ficha (aba Peso), o desempenho, a reprodução e a sanidade; SVG com título e descrição, os números do desenho iguais aos da tabela e do servidor, texto legível, sem rolagem horizontal, redesenho ao mudar a largura |
| `tests/ui/importacao-manejo.test.js` | 3 | 3 | 0 | Importação de pesagens (modelo, valores em palavras, linha repetida, parcial aprovado, relatório) e de sanidade (o produto pelo nome), a 1280 e 360 px |
| `tests/ui/interface.test.js` | 17 | 17 | 0 | Carga, navegação, formulário do catálogo, "hoje" no fuso, avisos, erro por animal, rascunho, LOCKED, sem resposta, faixas, leiaute 360 e 1280 px, acessibilidade; o menu com Pesagens, Sanidade e Reprodução (alterado) |
| `tests/ui/movimentos.test.js` | 8 | 8 | 0 | Parto pela ficha da mãe, transferência com erro em 1 de 3, morte, correção do parto, transferência com data passada e, novo, com as respostas fora de ordem (a corrida do seletor) (alterado: 7 → 8) |
| `tests/ui/pesagem.test.js` | 8 | 8 | 0 | Modo curral a 360 px (Enter, contador, não encontrado, repetido, desfazer, recarregar); rede cortada e resposta perdida conferida pela chave; aviso do servidor aceito na linha; a ficha com a curva; o desempenho; a correção pelo detalhe |
| `tests/ui/reproducao.test.js` | 2 | 2 | 0 | Diagnóstico no tronco a 360 px (p90, v, brinco que não é de fêmea, rede cortada, reenvio pela chave); fêmeas, indicadores e estações a 1280 e 360 px |
| `tests/ui/revisao.fase3.test.js` | 13 | 13 | 0 | Revisão da Fase 3 na tela: achados 5, 11 (curral e tronco, por animal e geral), 12 (curral e tronco), 17, 18, 19, 20, 21, 22, 27 e 28 |
| `tests/ui/sanidade.test.js` | 4 | 4 | 0 | Produtos e estoque a 360 px (cadastro pela folha, entrada pelo botão do produto); agenda e "Aplicar em N animais"; detalhe e correção da aplicação a 1280 px |
| `tests/ui/sobdemanda.test.js` | 4 | 4 | 0 | Importação sob demanda: pedida uma vez pelo menu, falha de rede com "Tentar de novo", endereço direto e menu da fase, outra versão do app no servidor |
| **Soma dos 9 novos ou alterados** | **67** | **67** | **0** | |

**Arquivos sem mudança desde a Fase 2**: `anexos` (1), `compra` (4), `eventos.fase2` (9), `importacao-periodo` (3), `importacao` (2), `lotacao` (4), `pastos-importacao` (6), `revisao1` (6), `revisao2` (6), `revisao3` (4), `revisao4` (4), `revisao5` (4), `telas` (12), `venda` (3) — soma 68. Conta: 67 + 68 = 135. Os apoios dos testes de navegador que
mudaram (`tests/ui/apoio.js`: `esperarServidor`; `tests/ui/mock-gas.js`: `emCurso` e `atrasar`) não declaram teste.

### 2.3 Cenários da Fase 3 por nível

| Cenário (09-plano-de-testes.md) | Nível 1 (Node) | Nível 2 (conta do dono) | Nível 3 (navegador) |
|---|---|---|---|
| CT-05 Pesagem | `EXECUTADO AQUI` (`pesagem.desempenho.test.js`, `pesagem.test.js`, `acceptance.test.js`: 91 dias, 72,8 kg, 0,800 kg/dia, 24,27%; o intervalo de 10 dias sem GMD; peso 0 recusado; 7,00 kg/dia com aviso) | `PENDENTE NA CONTA DO DONO` | `EXECUTADO AQUI` (modo curral a 360 px e curva de peso: `ui/pesagem.test.js`, `ui/graficos.test.js`) |
| CT-06 Vacinação coletiva | `EXECUTADO AQUI` (`sanidade.test.js`, `acceptance.test.js`: 30 animais, saída de 30, CUSTEIO de R$ 90,00 sem caixa, R$ 3,00 por animal, agenda pelo protocolo) | `PENDENTE NA CONTA DO DONO` | `EXECUTADO AQUI` (agenda e aplicação: `ui/sanidade.test.js`) |
| 09, 4.1 — RN-056 e RN-057 (lote vencido, estoque insuficiente) | `EXECUTADO AQUI` (`sanidade.test.js`, `acceptance.test.js`, cenário SANIDADE) | `PENDENTE NA CONTA DO DONO` | — |
| 09, 4.1 — RN-058, RN-059 e RN-072 (agenda e carência pelos exemplos de 05, 4.7 e 4.8, antes, dentro e depois do prazo) | `EXECUTADO AQUI` (`sanidade.agenda.test.js`, `sanidade.test.js`, `venda.test.js`, `regras.fase3.test.js`, `acceptance.test.js`) | `PENDENTE NA CONTA DO DONO` | `EXECUTADO AQUI` (a agenda e "Aplicar em N animais": `ui/sanidade.test.js`) |
| Estoque de insumos (03a, 4.7) | `EXECUTADO AQUI` (`estoque.test.js`, `acceptance.test.js`, cenário ESTOQUE) | `PENDENTE NA CONTA DO DONO` | `EXECUTADO AQUI` (entrada pelo botão do produto: `ui/sanidade.test.js`) |
| 09, 4.1 — RN-060, RN-061 e RN-064 (macho no diagnóstico, parto de fêmea de 20 meses, segundo parto em 200 dias) | `EXECUTADO AQUI` (`reproducao.test.js`, `nascimento.test.js`, `acceptance.test.js`, cenário REPRODUCAO) | `PENDENTE NA CONTA DO DONO` | `EXECUTADO AQUI` (o brinco que não é de fêmea no tronco: `ui/reproducao.test.js`) |
| 09, 4.1 — RN-066 (indicadores da estação; com 4 expostas, sem valor) | `EXECUTADO AQUI` (`reproducao.indicadores.test.js`, `acceptance.test.js`) | `PENDENTE NA CONTA DO DONO` | `EXECUTADO AQUI` (`ui/reproducao.test.js`, `ui/graficos.test.js`) |
| CT-10 passo 3 (pesagem repetida no dia) | `EXECUTADO AQUI` (`acceptance.test.js`, `pesagem.test.js`); deixou de ser `NÃO SE APLICA` | `PENDENTE NA CONTA DO DONO`, inclusive o passo 6 (página de concorrência) | — |
| CT-17 e CT-18 com a pesagem (fato no dia da venda; pesagem dos comprados na correção da compra) | `EXECUTADO AQUI` (`acceptance.test.js`, `pesagem.test.js`) | `PENDENTE NA CONTA DO DONO` | — |
| CT-12 com os importadores de manejo | `EXECUTADO AQUI` (`import.manejo.test.js`; quedas do bloco em `unitofwork.adversarial.test.js`) | `PENDENTE NA CONTA DO DONO` | `EXECUTADO AQUI` (`ui/importacao-manejo.test.js`) |
| Cenários das Fases 1 e 2, de novo com o código da Fase 3 | `EXECUTADO AQUI` (toda a suíte; `acceptance.test.js` nas duas ordens de carga) | `PENDENTE NA CONTA DO DONO` | `EXECUTADO AQUI` |
| Base de demonstração completa da Fase 3, sem nenhuma recusa (09, seção 8) | `EXECUTADO AQUI` (`acceptance.test.js`; GMD, taxas das estações e cobertura dos protocolos conferidos com a faixa do plano) | `PENDENTE NA CONTA DO DONO` (opcional) | — |
| Trava única com os tipos novos, em todo caminho | `EXECUTADO AQUI` (`pesagem.test.js`, `sanidade.test.js`, `estoque.test.js`, `reproducao.test.js`, `revisao.fase3.motor.test.js`, teste aleatório) | `PENDENTE NA CONTA DO DONO` (o tempo dos comandos no Sheets) | — |
| Teste aleatório das Fases 1 a 3 | `EXECUTADO AQUI` (`fase2.fuzz.test.js` com as 22 sementes fixas; as levas de sementes novas na seção 6.1; `fase3.fuzz.regressoes.test.js`) | `NÃO SE APLICA`: roda sobre os fakes, pela `api()` | — |
| Telas sob demanda | `EXECUTADO AQUI` (`telas.sobdemanda.test.js`) | `PENDENTE NA CONTA DO DONO` (NV: o `<script>` injetado no iframe) | `EXECUTADO AQUI` (`ui/sobdemanda.test.js`, com o mock) |
| CT-03 passo 4, CT-13 c a f, CT-15 (baixa) e CT-19 | `NÃO SE APLICA`: Fase 4 | `NÃO SE APLICA` | — |
| CT-16 (exportação XLSX e PDF) | `NÃO SE APLICA`: Fase 5 (o CSV já tem teste de tela desde a Fase 1) | `NÃO SE APLICA` | — |

## 3. O que só o dono pode executar (PENDENTE)

Nada abaixo foi executado. O roteiro está em `docs/GUIA_DE_IMPLANTACAO.md` (seção 11.2 para quem já tem a Fase 2).

| Item | Como | Evidência a devolver | Estado |
|---|---|---|---|
| Itens das Fases 1 e 2 ainda abertos: implantar, `setup`, `runDiagnostics` (SP-01 a SP-10, fuso), página de concorrência, marco zero, fórmulas de compra e venda com um caso real, PR-09, ratificar as decisões das rodadas 3 a 5 e da convergência | `docs/RELATORIO_FASE1.md` e `docs/RELATORIO_FASE2.md`, seção 3 | Os arquivos e as respostas de lá | `PENDENTE NA CONTA DO DONO` |
| Atualizar o código (38 arquivos: entraram `WeightService`, `Weights`, `Health` e `Reproduction`) e rodar `setup` | Guia, seção 11.2, passos 1 a 3 | Linha `setup: {...}` do registro (sem aba nem coluna nova; integridade sem erro) | `PENDENTE NA CONTA DO DONO`. O esquema não muda (as 34 abas e os parâmetros da Fase 3 já vieram na Fase 1). A verificação passa a conferir também a cópia do peso das pesagens da entrada, da compra, da venda e do parto (COPIAS): numa base em que esse peso foi mexido à mão na planilha, ela dá ERRO sem oferecer o reparo |
| **Abrir as telas sob demanda no app real** (Pesagens, Sanidade, Reprodução e a Importação) | Guia, seção 11.2, passo 5 | "Abriu" ou a mensagem que apareceu | `PENDENTE NA CONTA DO DONO`. É a hipótese NV da etapa BASE: se o quadro do HtmlService não rodar o `<script>` injetado, a contingência é voltar a tela ao `Index` e tirar `sob_demanda` do módulo (`CONTRATOS.md`, seção 37) |
| `runAcceptanceTests` com os cenários das Fases 1 a 3 (23 cenários: PREPARO, CT-09, CT-01 a CT-06, SANIDADE, ESTOQUE, REPRODUCAO, CT-07, CT-08, CT-13, CT-14, CT-17, CT-18, CT-10, CT-12, RESTAURACAO, CT-20, CT-11, ISOLAMENTO) | Guia, seção 6, até `completo: true` (várias execuções) | Arquivo `ERP Pecuário — relatório de aceitação <instante>.json` | `PENDENTE NA CONTA DO DONO` |
| **Testar o modo curral no celular, no curral** (PR-06) | Guia, seção 11.2, "Roteiro do modo curral" | Quantos animais, quanto tempo, se o sinal caiu, se o rascunho voltou, o que atrapalhou | `PENDENTE NA CONTA DO DONO` |
| **Confirmar PR-06, PR-07, PR-10 e PR-11** | Responder (guia, seção 11.2, passo 6) | As respostas | `PENDENTE NA CONTA DO DONO`; todas já têm padrão (PR-06 e PR-07 por uso, PR-10 por produto); só a PR-11, se a resposta for o custo na compra, muda uma regra do desenho (`11-riscos-e-premissas.md`, seção 4) |
| **Cadastrar produtos e protocolos com o veterinário** | Sanidade → Produtos e estoque; Sanidade → Protocolos | "Cadastrado", ou a lista do que não coube | `PENDENTE NA CONTA DO DONO`. O sistema não prescreve: o protocolo, a dose e a carência são os que o veterinário definir |
| Base de demonstração da Fase 3 (cerca de 410 lançamentos, em várias execuções de uns 4 minutos; estimativa, não medida) | Guia, seção 6, "Base de demonstração" | O relatório `plano: DEMO`, com `demonstracao.manejo` | `PENDENTE NA CONTA DO DONO` (opcional) |
| Tempo no Google Sheets com o manejo: comandos com a trava, agenda sanitária, indicadores reprodutivos e verificação de integridade | Registrar uma pesagem coletiva, uma vacinação e um diagnóstico; abrir a agenda e os indicadores; **Verificar a integridade agora** | Os tempos | `PENDENTE NA CONTA DO DONO`; no Node, seção 5, item 10 |
| Importação de uma planilha grande de pesagens (milhares de linhas) | Guia, seção 8, passo 6 | Relatório final da importação | `PENDENTE NA CONTA DO DONO` (opcional) |
| Gráficos no celular e no computador, no quadro do HtmlService | Abrir a ficha (aba Peso), Pesagens, Reprodução → Indicadores, Sanidade → Agenda | Captura ou relato | `PENDENTE NA CONTA DO DONO` |
| **Ratificar as decisões da Fase 3** que ficaram só em `CONTRATOS.md` (seção 4 deste relatório, itens 2 a 10; as dos itens 4 e 6 que contrariavam o desenho já foram levadas a `08-ux-ui.md` e ao desenho-base nesta etapa) | Ler e responder | A resposta | `PENDENTE NA CONTA DO DONO` |

Com esses resultados, o próximo passo é: corrigir o que divergir (fake, código ou regra), com registro no `CHANGELOG`;
marcar a validação da Fase 3 no checklist do plano; e só então dar a Fase 3 por fechada.

## 4. Decisões tomadas durante a implementação

Além das decisões do desenho (seções 16 e 17 do desenho-base). O detalhe de cada uma está em `docs/CHANGELOG.md` e nos
contratos (`docs/CONTRATOS.md`, seções 37 a 43). As que contrariavam um documento da Fase 0 levaram à atualização do
trecho nesta etapa (item 13).

1. **Catálogo e módulos.** `EventCatalog.FASE_ATUAL = 3`. Como o tipo só fica ativo com campos, o **módulo só fica ativo
   com a tela entregue** (campo `tela`): o menu mostra Pesagens, Sanidade e Reprodução só depois de cada tela existir, e os
   módulos das Fases 4 e 5 continuam fora. O catálogo, e não o cliente, declara qual tela é sob demanda e as raízes de rota
   dela (`sob_demanda`, `rotas`).
2. **Telas sob demanda.** Rota extra `sistema.tela {nome}`, uma consulta que não abre a planilha-banco (`meta.dataVersion`
   vem vazio); nome fora da lista → VALIDATION; módulo não entregue → NOT_FOUND com a fase; arquivo ausente do projeto →
   NOT_FOUND com a instrução de enviar o projeto de novo. A importação saiu da página inicial (tarefa de desktop) e foi o
   primeiro módulo sob demanda. Com outra versão do app no servidor, a tela nova não entra na página antiga
   (`NOVA_VERSAO`, "Recarregar a página"). O kit de gráficos ficou em `Components`, na página inicial, porque o desenho o
   põe lá (01, seção 6.2) e a lista de includes do desenho não tem arquivo próprio para ele.
3. **Pesagem.** O enum `TIPO_PESAGEM` não mudou: o formulário oferece rotina, entrada, desmama e "Saída (venda ou
   embarque)"; nascimento e compra continuam vindo do parto e da compra. Jejum, peso total e cabeças do lote vão no payload
   (PESAGENS não tem coluna para eles). Métodos do esquema: a fita entra no GMD só com `gmd_aceita_fita`; estimativa visual
   e média do lote contam para o peso atual e nunca para o GMD individual. Intervalo menor que 28 dias, entre permanências
   diferentes ou com pesagem anterior ao marco zero → GMD sem valor, com o motivo e a explicação, nunca zero. GMD de lote
   com 5 animais ou mais nas duas pesagens (`indicador_n_minimo`). A projeção usa o GMD de referência dos 120 dias
   anteriores à última pesagem e vai até 90 dias depois dela. O peso ao nascer de referência é só um ponto estimado da curva.
4. **Modo curral e tronco.** Cada bloco de até 20 linhas é um lançamento com chave própria, guardada no rascunho (aparelho e
   servidor) antes do envio; ao voltar à tela, o bloco sem confirmação é conferido pela chave (`operacao.status`) antes de
   qualquer reenvio. O bloco só é criado na hora de sair, um de cada vez. Aviso do servidor fica na linha ("Está certo"
   reenvia com o aceite); recusa fica na linha (ERRO, motivo, "Corrigir", "Tirar") ou, se não for de um animal, na área de
   status. Com data diferente de hoje, o curral confere brinco, pasto e contador pela posição do servidor naquela data. O
   ganho mostrado vem da resposta do servidor (o GMD pela mesma conta da ficha, ou vazio com o porquê). O diagnóstico no
   tronco usa o mesmo padrão dentro de `Reproduction`. **Isso contraria o "um único evento ao final" de 08, seção 5, e do
   desenho-base, seção 8**: a pesagem de 80 animais vira 4 lançamentos. A troca protege o que já foi pesado quando o sinal
   cai no meio; o trecho foi atualizado (item 13).
5. **Insumos e estoque.** Pela decisão 16.9, a compra de produto do cadastro é sempre um lançamento COMPRA_INSUMOS com
   parcelas, e o movimento de entrada só existe com o controle ligado; a saída por aplicação é gravada mesmo sem controle
   (rastro do consumo e base do custo); o acerto exige o controle (`PRODUTO_SEM_ESTOQUE`), também na correção de um acerto
   cujo produto teve o controle desligado depois. "Perda" é o acerto com motivo perda ou vencimento; a contagem lança a
   diferença entre o contado e o saldo na data (diferença 0 → `VALOR_IGUAL`). A unidade do produto não muda depois do
   primeiro uso (`PRODUTO_EM_USO`). `ESTOQUE_INSUFICIENTE` compara o menor saldo ao longo do tempo antes e depois do comando
   (só avisa quando fica abaixo de zero e pior que antes), também no estorno e na correção; com a política BLOQUEIA, recusa.
   Ligar o controle com saldo negativo pede confirmação e manda acertar pela contagem (não gera movimentos retroativos das
   compras antigas).
6. **Sanidade.** Formulário comum (sem modo curral) com a revisão pelo servidor. A quantidade consumida vazia é a soma das
   doses; no modo total ela é obrigatória e a dose de cada animal fica vazia. Na dose por peso com mais de um animal, o
   rateio do consumo é pela dose de cada um; nos demais casos, por cabeça; o desempate do maior resto vai para a maior base
   e depois para o código (03b). O servidor só preenche dois padrões: a próxima aplicação pelo intervalo do protocolo e o
   fabricante do produto; carência, dose, lote e validade do cadastro são sugestões da tela, para o histórico não mudar
   quando o cadastro mudar. A carência é conferida nos dois sentidos (a aplicação retroativa que cobre uma venda para abate
   segue a política de `CARENCIA_ATIVA`); a venda anterior ao marco zero não confere carência, nas duas ordens de
   importação. Produto do cadastro com custo, pago também no ato numa conta de insumo → `CUSTO_EM_DOBRO` (recusa, não aviso).
   Na correção, o fato fica congelado quando o produto ou o protocolo não muda: o custo unitário e a conta do consumo do
   original, o intervalo do protocolo gravado (`intervalo_protocolo_dias`, conferido pela verificação), o fator e o
   movimento da entrada de estoque. A mesma aplicação no mesmo animal no mesmo dia pede `POSSIVEL_DUPLICIDADE` por animal,
   com a chave da importação.
7. **Agenda sanitária.** Aplicação única passada da idade máxima continua devida se o animal esteve na faixa depois da
   criação do protocolo; a cada N dias, nunca aplicada, vence desde que o animal ficou elegível; na campanha, a perdida fica
   devida só até abrir a janela da seguinte; sem protocolo, a pendência vem da próxima informada na última dose do produto e
   é cumprida por qualquer aplicação posterior do mesmo produto, com ou sem protocolo. Tudo é calculado a cada consulta
   sobre os presentes na data.
8. **Reprodução.** Na exposição, os touros vão na mesma lista das fêmeas (linha TOURO); `touro_id` só quando o touro é
   único. O touro de fora (cobertura e sêmen) não tem linha. Parto entre a concepção e o diagnóstico positivo é a regra
   rígida `PARTO_NA_GESTACAO` (VALIDATION no lançamento, CONFLICT pelo outro lado); a prenhez que passa da previsão sem parto
   é alerta (`PRENHEZ_VENCIDA`) e conta como perda gestacional quando a janela fecha. A data contra a estação só é conferida
   no lançamento novo; a correção mantém a estação do original. Quem saiu no meio da estação: antes de um diagnóstico
   conclusivo, sai do denominador da prenhez; antes do fim da janela sem desfecho, sai dos da parição, natalidade, desmama e
   perda; a vazia descartada continua. A cobertura do diagnóstico sai sempre; abaixo de 90%, a prenhez passa a ser "entre
   diagnosticadas". A situação, a marca de descarte e os indicadores numa data D usam só os fatos até D, por uma função só
   (`Timeline.reproducaoEm`); a situação declarada na entrada (rebanho inicial, compra) vale como o fato da data da entrada.
   A faixa da idade da gestação pelo parâmetro `dias_gestacao` fica só no motor (o diagnóstico novo acima dela é recusado), e
   não na verificação, para que mudar o parâmetro não transforme um registro legítimo em fonte quebrada.
9. **Desmama, castração e ocorrência.** A cria é definida por DL-06; a categoria segue automática pelo cadastro; a linha
   do bezerro leva o movimento quando o pasto de destino é outro; a linha MATRIZ e o registro DESMAMA saem uma vez por mãe
   presente na data. A castração tira o status de reprodutor na projeção. Trocar a mãe de uma cria já desmamada continua
   recusado pela trava, agora com o caminho: estornar a desmama, trocar a mãe, desmamar de novo.
10. **Importação de manejo.** Duas pesagens legítimas do mesmo animal no mesmo dia são dois lançamentos (números
    diferentes na coluna "Nº da pesagem"), e a segunda pede `POSSIVEL_DUPLICIDADE`. O fato já gravado (`EVENTO_JA_REGISTRADO`)
    é, por tipo: a pesagem na mesma data com o mesmo peso (a média do lote só se compara com outra média de lote; o lote
    lançado em parte fica `LOTE_EM_PARTE`), o mesmo procedimento com o mesmo produto, nome ou doença, o mesmo registro
    reprodutivo, a ocorrência do mesmo tipo. No manejo, a linha duplicada sai do lançamento e as outras entram (cada linha
    é um fato); nas compras e vendas, o lançamento continua entrando só inteiro. Produto, protocolo e estação pelo nome (o
    ativo vale sobre o desativado; dois iguais → `CADASTRO_AMBIGUO`). Os modelos não trazem a despesa paga no ato (entra
    pela correção). DESMAMA e CASTRACAO não são importáveis: o enum `TIPO_IMPORTACAO` do desenho tem dez tipos (o peso da
    desmama pode entrar como pesagem com o momento "desmama"). O histórico de sanidade não mexe no estoque nem gera consumo,
    porque o estoque e o custo do insumo começam no marco zero; a verificação confere isso (`HISTORICO_ESTOQUE`,
    `HISTORICO_CONSUMO`).
11. **Gráficos.** Barras sempre horizontais (nome curto à esquerda, longo em cima; legível a 360 px); sem pizza nem rosca
    (o desenho só pede linha e barras); a tabela equivalente fica num "Ver tabela" fechado sob o gráfico; nenhum gráfico
    refaz conta (valores, totais, nulos e motivos vêm do servidor; teste estático confere). O G5 (evolução do peso) entrou já
    em `peso.desempenho`, porque a fonte dele é da Fase 3; o dashboard completo é da Fase 5. Oito cores de série, todas
    com contraste de 4,5:1.
12. **Aceitação e demonstração.** A conferência final da base de demonstração lê pelas rotas o GMD do rebanho, as taxas de
    cada estação e a cobertura dos protocolos e as confere com a faixa do plano (GMD de 0,3 a 0,8 kg/dia, prenhez de 70% a
    98%, cobertura de pelo menos 80%), porque os números exatos variam com a data de hoje (o marco zero é hoje − 1095).
    Número fora da faixa derruba a conferência, e a execução seguinte refaz esse passo.
13. **Documentos da Fase 0 atualizados nesta etapa** (antes, as etapas não podiam mexer em `docs/fase-0/`): `08-ux-ui.md`,
    seção 5, e o desenho-base, seção 8 (o modo curral em blocos de 20 e o que a Fase 3 entregou dele: pesagem e tronco do
    diagnóstico); `01-arquitetura.md`, seção 6.2 (a página inicial e as telas sob demanda; o modo curral e o tronco nas
    telas `Weights` e `Reproduction`, não em `Components`); `10-plano-de-implementacao.md` (arquivos da Fase 3, a nota do
    E2.6 e o checklist da seção 8); `11-riscos-e-premissas.md` (R-08, R-14, R-23, R-24, R-30, R-31 e PR-06, PR-07, PR-10,
    PR-11). As decisões dos itens 2 a 10 que não contrariam um trecho da Fase 0 (completam o que ele deixava em aberto)
    ficam em `CONTRATOS.md`, para o dono ratificar (seção 3). Nesta etapa também foram corrigidos dois comentários de
    código desatualizados: o título da lista de cenários em `src/TestRunner.js` ("Fases 1 e 2" → "Fases 1 a 3") e o número
    de comandos da base de demonstração em `scripts/medir-trava.js`.
14. **Teste aleatório.** O registro único (gerador e oráculo de cada tipo e de cada importador) falha no `npm test` se um
    tipo ficar ativo sem a sua entrada. As sementes fixas passaram de 16 para 22 (57, 8, 1, 31, 56 e 262), cada uma porque,
    com os tipos novos no sorteio, nenhuma das anteriores aceitava algum subtipo exigido; nenhum teste foi relaxado.

## 5. Limitações conhecidas

1. **Nada foi validado no ambiente real.** Valem as hipóteses dos fakes das Fases 1 e 2 (`CONTRATOS.md`, seção 6.5) e, na
   Fase 3: que o quadro do HtmlService rode o `<script>` da tela sob demanda injetado como nó (NV; contingência: voltar a
   tela ao `Index` e tirar `sob_demanda` do módulo — só cabe se a página inicial tiver espaço, item 3), o teclado numérico
   e o `localStorage` num celular de verdade com sinal fraco, e os gráficos no quadro do HtmlService.
2. **Modo curral só da pesagem** (e o tronco do diagnóstico, no mesmo padrão). O desenho (08, seção 5) o previa também
   para a sanidade, a desmama e a identificação: a sanidade ficou no formulário comum por decisão (item 6 da seção 4); a
   desmama e a identificação usam o formulário comum com o seletor, embora o catálogo ainda declare `modo_entrada: CURRAL`
   para elas (o cliente não usa esse campo). Dentro do curral não entraram "Colar brinco;peso" nem a grade "Todos do pasto"
   de 08, seção 5: o formulário comum da pesagem tem o seletor com "Todos do pasto", e a planilha entra pela importação.
3. **Orçamento da página inicial**: {{KB_INI}} KB de 450 KB. Sobram cerca de {{KB_SOBRA}} KB: as telas das Fases 4 e 5 têm de
   nascer sob demanda, e mudanças no Início, na ficha ou nos componentes precisam caber nisso ou ir para uma tela sob
   demanda.
4. **Avisos e alertas que não existem**: `PESO_IMPLAUSIVEL` só na pesagem (os pesos da compra, da venda e do parto não são
   comparados com a pesagem anterior); nenhum alerta de animal sem pesagem há muito tempo (o peso vencido só aparece na
   lista e nas contas de lotação); a revisão do servidor no Registro mostra a reprodução, a desmama, a castração e a
   ocorrência pelo resumo genérico (`impactos.manejo` vem na resposta, sem bloco visual próprio).
5. **Importação de manejo**: a despesa paga no ato não tem coluna nos modelos; DESMAMA e CASTRACAO históricas não têm
   importador; a sanidade importada chega pouco à conclusão no teste aleatório (fica coberta sobretudo por
   `import.manejo.test.js` e pela varredura de quedas).
6. **Aplicações gravadas antes do conserto da revisão** não têm `intervalo_protocolo_dias` no payload: se forem corrigidas,
   a próxima aplicação usa o intervalo atual do protocolo. Só pesa numa base com lançamentos da Fase 3 anteriores a
   17/11/2026, que hoje só existe nos testes.
7. **Mensagens da trava** mostram o código interno do animal ("A-000001 (brinco 100)") e repetem a data no rótulo do
   evento ("Desmama de 01/08/2026" de 01/08/2026).
8. **Financeiro da Fase 4** continua como na Fase 2 (`RELATORIO_FASE2.md`, seção 5, item 2): o consumo do insumo e as
   despesas pagas no ato entram no financeiro do próprio evento; rateio por evento RATEIO, baixa de parcelas e resultado
   gerencial, na Fase 4. CT-03 passo 4 e CT-13 c a f seguem `NÃO SE APLICA`.
9. **Decisões da Fase 3 só em `CONTRATOS.md`**: as da seção 4, itens 2 a 10, completam a Fase 0 sem contrariá-la e
   precisam ser ratificadas pelo dono na próxima revisão dos documentos da Fase 0.
10. **Desempenho não medido no Apps Script**: a agenda calcula tudo sobre os presentes na data a cada consulta, e os
    indicadores refazem a estação; a trava confere também os fatos novos. No Node, com a base de demonstração da Fase 3
    (`npm run trava:medir`, nesta etapa): 430 comandos (a base inteira com os cadastros), média de 121,3 ms por comando (p50 117,2 ms; p95 260,2 ms), dos quais 15,1 s de 52,2 s (29%) na trava; mediana de 3 execuções. No fim da Fase 2, com a base de demonstração de então (391 comandos, sem o manejo), a média era 53,1 ms: a base cresceu (pesagens, aplicações, estoque, estações), e as duas medidas não comparam bases iguais. O tempo de cada comando cresce com o tamanho da base, e no Sheets a leitura das abas se soma a isso. No Google Sheets, nada disso foi medido.
11. **Teste aleatório** (seção 6.1): os indicadores reprodutivos têm modelo só das expostas e da coerência das contagens e
    taxas (não das diagnosticadas, prenhas, paridas, perdas e desmamas); a previsão de parto e os alertas `PARTO_PREVISTO` e
    `PRENHEZ_VENCIDA` não têm oráculo; protocolos com categoria ficam fora do modelo da agenda; o relógio do pedido no
    passado vale só para `protocolo.salvar`; alguns encontros são raros (venda direta na carência para recria, reprodução
    na estação pela interação, venda no mesmo dia da pesagem); a correção que reprecificaria o fato é pega em 6 de 40
    sementes (os testes de unidade cobrem o caso de forma determinística). Roda no harness Node, nunca no Apps Script.
12. **Bases antigas** podem mostrar achados novos na verificação depois de atualizar o código: a cópia do peso das pesagens
    de entrada, compra, venda e parto (COPIAS, sem reparo). O problema antigo não bloqueia os comandos que não o pioram.
13. **Revisão sem convergência demonstrada**: a revisão independente da Fase 3 achou 14 defeitos de gravidade alta depois
    de 5.100 sementes do teste aleatório sem falha do sistema. Os consertos não passaram por outra revisão (seção 6.3).
14. **Continuam valendo** as limitações da Fase 2 que esta fase não tocou (`RELATORIO_FASE2.md`, seção 5): itens 2 a 6,
    11 (parte da importação e da integridade), 13, 14, 17 a 19 e 21. Ficaram resolvidas: a carência depende da SANIDADE
    real (item 8), a importação de pesagens, sanidade, reprodução e ocorrências (parte do item 7), o modo curral da pesagem
    (parte do item 9; o da identificação continua no item 2 acima) e o orçamento da página com as telas sob demanda (item
    12, agora item 3 acima).

## 6. Revisão adversarial

### 6.1 Teste aleatório baseado em modelo

O teste aleatório da convergência da Fase 2 (`tests/apoio-fuzz.js`, `tests/fase2.fuzz.test.js`) passou a cobrir todos os
comandos das Fases 1 a 3: cada tipo e importador declara o gerador e o oráculo do efeito no registro único, e depois de
cada passo o estado inteiro é conferido (integridade sem erro, projeção = reconstrução, financeiro fechado, replays
independentes do peso atual, do estoque, da situação reprodutiva, da castração e da cria ao pé, a agenda e o GMD por
modelos próprios, os avisos de transição de estoque e de carência, a chave do bloco do curral e do tronco).

| Etapa | Sementes novas × passos | Comandos aceitos / recusados (quando registrados) | Falhas do sistema | Falhas do modelo do teste |
|---|---|---|---:|---:|
| BASE (registro único) | 120 × 100 (310000 a 310119) | 6.227 / 4.850 | 0 | 0 |
| E3.1 pesagem | 240 × 100 (330000 a 330119, 340000 a 340119) | 12.656 / 9.460 | 0 | 0 |
| E3.2 e E3.3 sanidade | 240 × 100 (316000 a 316119, 317000 a 317119) | 12.874 / 9.315 | 0 | 0 (uma regressão fixa falhou por causa da ordem da montagem do gerador, corrigida no gerador) |
| E3.4 e E3.5 reprodução | 180 × 60 (1 a 60; 730000 a 730119) | 3.850 / 2.701 (só a leva de 120) | 0 | 0 |
| E3.7 gráficos | 100 × 60 (770000 a 770099) | 3.131 / 2.294 | 0 | 0 |
| E3.6 importadores | 240 × 60 e 80 (360000 a 360119; 361000 a 361059 e 362000 a 362059) | 9.030 / 6.211 | 0 | 1 (semente 361048: o oráculo da despesa esperava parcelas na correção de uma ocorrência histórica) |
| Aceitação | 120 × 60 (880000 a 880119) | 3.892 / 2.620 | 0 | 0 |
| Passada 1 das Fases 1 a 3 | 1.640 × 100 | 22.618 / 13.390 (só a leva final de 400) | 0 | 1 (semente 7106: no período fechado, a simulação chega à trava e o comando para antes, na justificativa do aviso) |
| Passada 2 das Fases 1 a 3 | 1.600 × 100 | 39.017 / 21.859 (as 660 finais) | 0 | 2 (semente 1210049: a mesma chave com outro conteúdo copiava a marca da correção tardia, CORRIGIDO no modelo; semente 1320022: o acerto do produto com o controle desligado depois é recusado por desenho, REFUTADO como defeito) |
| Conserto da revisão | 620 × 100 (1800000 a 1800019; 1810000 a 1810299; 1830000 a 1830299) | 35.810 / 19.616 (as 600 de 300) | 0 | 1 (semente 1800003: o oráculo da entrada de estoque esperava o controle de hoje na correção) |
| **Total** | **5.100 sementes novas** | | **0** | **5** |

Cada falha do modelo virou caso fixo (`tests/fase3.fuzz.regressoes.test.js` ou `tests/import.manejo.test.js`), que falha
no modelo de antes. As 24 recusas da trava conferidas uma a uma na passada 1 (160 sementes) são todas de regras que ela
guarda por desenho (castração repetida pela correção do rebanho de base, registro reprodutivo de quem passaria a macho,
pasto desativado, mãe de cria desmamada). O que os oráculos novos enxergam foi medido com mutações numa cópia do projeto
(`src/` errado de propósito): sem o aviso de estoque e com a dose em duas casas, 20 de 32 sementes falham; a campanha
perdida esquecida, 30 de 30; a cria ao pé que não sai com a desmama, 6 de 30 (a verificação de integridade não vê); o
cadastro do original deixando de valer na correção, 6 de 30; depois da revisão, o custo e a entrada não congelados na
correção, 6 de 40; sem a recusa do custo em dobro, 2 de 40.

**O que esta tabela não mostra.** Nenhuma das 5.100 sementes achou defeito do sistema, e a revisão independente achou 29
logo depois. Os oráculos conferem a coerência interna (o que foi gravado bate com a reconstrução, com a integridade e com o
efeito pedido) e algumas regras por modelo próprio; os defeitos da revisão eram de outra natureza: a regra certa num
caminho e ausente noutro (a correção que reprecifica, o curral que calcula o GMD diferente da ficha), indicador numa data
passada com fatos de depois, tela que perde a recusa. Depois da revisão, os oráculos da correção congelada e do custo em
dobro passaram a existir e pegam o defeito reintroduzido (6 e 2 de 40 sementes).

### 6.2 Revisão independente da Fase 3

29 achados (os achados 3 e 6 são o mesmo defeito, visto por duas lentes: 28 distintos), todos confirmados e
**CORRIGIDOS**, cada um com teste por caminho que falha com o `src/` de antes do conserto (conferido rodando os testes
novos numa cópia com o `src/` do commit `9721cbe`) e passa agora: `tests/revisao.fase3.motor.test.js`,
`tests/revisao.fase3.regras.test.js`, `tests/revisao.fase3.zootecnia.test.js` e `tests/ui/revisao.fase3.test.js`.

| Lente | ALTA | MÉDIA | BAIXA | Total |
|---|---:|---:|---:|---:|
| ZOOTECNIA E CUSTO | 5 | 2 | 0 | 7 |
| MOTOR | 5 | 1 | 2 | 8 |
| INTERFACE E REGRAS | 2 | 5 | 2 | 9 |
| REGRESSÕES | 2 | 2 | 1 | 5 |
| **Total** | **14** | **10** | **5** | **29** |

| # | Gravidade | Lente | Achado | Decisão |
|---:|---|---|---|---|
| 1 | ALTA | ZOOTECNIA | Indicadores da estação numa data passada usavam o último diagnóstico de todos os tempos | Corrigido: só os fatos até a data D |
| 2 | ALTA | ZOOTECNIA | Matrizes ativas e natalidade anual usavam a marca de descarte de hoje em qualquer data | Corrigido: a marca vigente na data (`Timeline.reproducaoEm`) |
| 3 | ALTA | ZOOTECNIA | Corrigir uma aplicação reprecificava o consumo pelo custo de cadastro de hoje | Corrigido: custo e conta do original, no tratador único (correção e correção do substituto) |
| 4 | ALTA | ZOOTECNIA | Produto do cadastro pago no ato contado duas vezes (consumo mais o custo do ato) | Corrigido: `CUSTO_EM_DOBRO` no registro, na simulação e na correção |
| 5 | ALTA | ZOOTECNIA | O modo curral mostrava GMD em intervalo menor que 28 dias e contra peso estimado | Corrigido: a conta da ficha, ou vazio com o porquê |
| 6 | ALTA | MOTOR | Correção da sanidade com o custo, a conta e a próxima aplicação pelo cadastro atual | Corrigido (mesmo defeito do 3): `intervalo_protocolo_dias` congelado e conferido pela integridade |
| 7 | ALTA | MOTOR | Correção da entrada de estoque pelo fator e pelo controle atuais | Corrigido: fator e movimento do original |
| 8 | ALTA | MOTOR | A integridade não conferia a cópia do peso das pesagens de entrada, compra, venda e parto | Corrigido: COPIAS sem reparo; a trava recusa lançar para o animal |
| 9 | ALTA | MOTOR | `reproducao.indicadores` ignorava a situação declarada na entrada | Corrigido: uma função só para projeção, lista e indicadores |
| 10 | ALTA | MOTOR | Pendência sem protocolo não cumprida pela aplicação do mesmo produto com protocolo | Corrigido; o modelo da agenda no teste aleatório também |
| 11 | ALTA | INTERFACE | Curral e tronco: a recusa do servidor sumia e o bloco voltava à fila sem mensagem | Corrigido: a recusa fica na linha ou na área de status |
| 12 | ALTA | INTERFACE | Curral e tronco: linhas presas num bloco novo depois de resposta perdida | Corrigido: o bloco é criado na hora de sair |
| 13 | ALTA | REGRESSÕES | A quarentena da fonte quebrada não alcançava o saldo de insumo | Corrigido: o saldo entra na quarentena; registro e importação recusados; conclusão e desfazer sem regravar |
| 14 | ALTA | REGRESSÕES | Mudar `dias_gestacao` transformava um diagnóstico legítimo em fonte quebrada | Corrigido: a faixa só no motor |
| 15 | MÉDIA | ZOOTECNIA | A tabela "Animais" do desempenho trazia bichos fora do filtro | Corrigido: o mesmo critério do GMD |
| 16 | MÉDIA | ZOOTECNIA | Ligar o controle de estoque depois das compras deixava saldo negativo e mandava lançar a entrada de novo | Corrigido: pede confirmação e manda acertar pela contagem |
| 17 | MÉDIA | MOTOR | Mesmo fato no mesmo animal no mesmo dia passava sem aviso num lançamento com outros animais | Corrigido: `POSSIVEL_DUPLICIDADE` por animal; o tronco diz "grava outro diagnóstico" |
| 18 | MÉDIA | INTERFACE | Gráfico do GMD de lote juntava lançamentos do mesmo dia com o mesmo número de animais | Corrigido: um item por lançamento |
| 19 | MÉDIA | INTERFACE | Gráfico de taxas por categoria dividia a categoria quando uma taxa era parcial | Corrigido: "(parcial)" no valor |
| 20 | MÉDIA | INTERFACE | Sanidade → Aplicações: a coluna "Produto" mostrava "—" | Corrigido: o servidor manda o produto, o nome ou o diagnóstico |
| 21 | MÉDIA | INTERFACE | O rascunho do tronco não aparecia no Início | Corrigido |
| 22 | MÉDIA | INTERFACE | Curral com data passada conferia pela posição de hoje | Corrigido: `inventario.elegiveis` na data |
| 23 | MÉDIA | REGRESSÕES | Carência × venda histórica dependia da ordem dos arquivos importados | Corrigido: a venda anterior ao marco zero não confere carência |
| 24 | MÉDIA | REGRESSÕES | `animal.editar` devolvia `carencia_ate` vazio e o aparelho apagava o selo | Corrigido; aba não lida passa a ser erro INTERNAL |
| 25 | BAIXA | MOTOR | Trocar a mãe de bezerro desmamado: recusa com conselho que não levava à solução | Corrigido: o caminho na mensagem, testado até o fim |
| 26 | BAIXA | MOTOR | Lote importado com uma linha já na base: as demais recusadas com contagem errada | Corrigido: `LOTE_EM_PARTE` com motivo claro |
| 27 | BAIXA | INTERFACE | Ficha da matriz com versão nova do app: "Tentar de novo" em laço | Corrigido: "Recarregar a página" |
| 28 | BAIXA | INTERFACE | Indicadores reprodutivos somados e subtraídos no aparelho | Corrigido: o servidor manda o total e a cobertura |
| 29 | BAIXA | REGRESSÕES | GMD do período dizia "Menos de duas pesagens" quando havia várias | Corrigido: explica o porquê |

**Correções incompletas.** Pela leitura dos achados nesta etapa (classificação minha, não da revisão), 12 dos 29 eram a
lição da Fase 2 de novo: a regra certa num caminho e ausente noutro — a correção que não congelava o que o registro
congelou (3, 6, 7), o curral que não usava a conta da ficha (5), os indicadores que não usavam a regra da projeção (9), a
quarentena que não alcançava o saldo (13), a duplicidade que o formulário e a importação tratavam e o lote misto não (17), o
curral que não tinha o conserto do seletor com data passada (22), a carência que dependia da ordem da importação (23), a
edição que não lia a aba que a lista lê (24), o lote importado que se comparava com a pesagem individual (26) e o gráfico
que juntava o que o servidor separava (18).

### 6.3 Balanço: a convergência está demonstrada? Não

O que a Fase 3 tem a mais que a Fase 2 tinha no começo: o tratador único por tipo em todo caminho e a trava única, que
conferem cada fato novo; o teste aleatório desde a primeira etapa, com 5.100 sementes novas e nenhuma falha do sistema; e
uma só rodada de revisão independente, que achou 29 defeitos (14 altos). O número de achados por rodada da Fase 2 era 23,
19, 23, 29 e 17; o da Fase 3, na primeira rodada, foi 29. Isso não mostra convergência: mostra que o teste aleatório e a
trava não substituem a revisão para regras de domínio (datas passadas, fato congelado, tela). Os consertos da revisão
passaram pelo teste aleatório (620 sementes) e pela suíte inteira, mas **nenhuma revisão independente os examinou**. O
próximo passo recomendado, antes de dar a Fase 3 por fechada, é uma rodada de revisão só sobre os consertos e sobre os
caminhos que eles tocam.

## 7. Veredito (09, seção 10)

```text
RELATÓRIO DE TESTES, FASE 3, 17/11/2026: o código de comportamento é o do commit 7ca19a1 com o ajuste de
tests/ui/graficos.test.js do conserto da revisão; os commits automáticos seguintes da orquestração (ae14f0d em diante)
levam só a documentação desta etapa e os dois comentários

1. EXECUTADO AQUI (Node)
   comando: npm test      resultado: {{NP}}/{{NT}}
   cenários: CT-05 ok | CT-06 ok | SANIDADE ok | ESTOQUE ok | REPRODUCAO ok | CT-10 passo 3 ok | CT-17 e CT-18 com a
             pesagem ok | CT-12 com o manejo ok | Fases 1 e 2 ok
   interface (Playwright): executado, {{UP}}/{{UT}}

2. A EXECUTAR NA CONTA DO DONO (nível 2)
   runAcceptanceTests()    PENDENTE        relatório JSON (23 cenários)
   CT-10 passo 6           PENDENTE        captura da página de concorrência
   modo curral no curral   PENDENTE        relato
   PR-06, PR-07, PR-10, PR-11  PENDENTE    respostas
   spike SP-01 a SP-10     PENDENTE (Fase 1)

3. HIPÓTESES NÃO CONFERIDAS NA PLATAFORMA
   tela sob demanda no iframe (NV); tempo do Sheets com o manejo; teclado e localStorage no celular; as da Fase 1 e 2

4. FALHAS CONHECIDAS E DECISÃO
   nenhuma falha de teste; limitações na seção 5; revisão dos consertos pendente (seção 6.3)

5. VEREDITO: a fase fecha? não — depende da execução na conta do dono (seção 3)
```
