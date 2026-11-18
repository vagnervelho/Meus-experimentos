# Relatório da Fase 3 — Manejo

Data: 18/11/2026 (o relatório da entrega e da primeira convergência é de 17/11/2026). Versão do app: 0.1.0. Plano: `docs/fase-0/10-plano-de-implementacao.md`, seção 4 (entregas E3.1 a
E3.7) e seção 8 (checklist). Relatório da fase anterior: `docs/RELATORIO_FASE2.md`.

## Em resumo

- **O código da Fase 3 está completo no repositório** (`erp-pecuario/src/`: 26 arquivos `.js`, 13 `.html` e o
  manifesto; entraram o `WeightService`, o `Identificacao`, o `Correcao` e as telas `Weights`, `Health` e `Reproduction`) e
  passou em todos os testes que rodam aqui, inclusive os das Fases 1 e 2: **`npm test` com 914 testes, 914 aprovados, 0
  falhas** e **`npm run ui:check` com 212 testes de navegador, 212 aprovados, 0 falhas** (execução desta etapa, 18/11/2026,
  sobre o código final da segunda convergência; nesta etapa só mudaram documentos).
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
- **Telas sob demanda (risco R-31).** A página inicial tem 428 KB de 450 KB (438.227 bytes de 460.800: sobram 22.573;
  no fim da primeira convergência sobravam 45, e a segunda tirou da página inicial a prévia da correção montada no aparelho).
  A importação e as três telas novas são pedidas ao servidor quando o menu as abre (Import 48 KB, Weights 64 KB, Health 24 KB e Reproduction 67 KB, de 150 KB cada), e a Início
  traz em segundo plano as do curral e do tronco. Que o quadro (iframe)
  do HtmlService rode a tela injetada é hipótese (NV): se não rodar, a contingência está pronta (seção 5, item 1).
- **Nada foi implantado nem executado na conta Google do dono.** Continuam **PENDENTES NA CONTA DO DONO** os itens das
  Fases 1 e 2 e, da Fase 3: `runAcceptanceTests` com os 23 cenários, as premissas PR-06, PR-07, PR-10 e PR-11, o
  cadastro dos produtos e protocolos com o veterinário e o modo curral num celular de verdade, no curral (agora com uma
  ida ao servidor por brinco digitado, seção 6.6.3). Pela regra de honestidade, **a Fase 3 não está fechada** até esses
  resultados chegarem.
- A **revisão independente** teve seis rodadas. Foram **29 achados** na entrega (14 de gravidade alta), **25** nos
  consertos da primeira (8 altos), **25** nos da segunda (5 altos), **17** na revisão final, depois da convergência (7 altos),
  e **17** e **17** nas duas rodadas da segunda convergência (7 e 10 altos). No total, 130 achados e 117 distintos. Todos
  foram corrigidos e têm teste. Só uma parte de um achado foi refutada (a adulteração só da fonte, sem cópia que a confira),
  e nenhum foi adiado. As rodadas repetiam duas classes de defeito: o número ou o estado numa data passada calculado com o dado
  de hoje (no caminho da correção, o fato congelado refeito pelo cadastro de hoje), e o curral e o tronco com estados
  inconsistentes.
- A **convergência** (seção 6.6) trocou o conserto caso a caso dessas duas classes por garantias que valem para todos os
  caminhos. São três: o oráculo de viagem no tempo no teste aleatório, sobre um ponto único do estado numa data; um
  resolvedor único do brinco na data, no servidor (o aparelho não resolve mais brinco); e o teste aleatório da tela do
  curral e do tronco, com a rede caindo. Pela primeira vez na fase, o teste aleatório achou defeitos do sistema sem
  revisor: 13 falhas em 6 classes pelo oráculo do tempo e 5 defeitos pela tela (um sexto saiu da leitura do código para
  montar o modelo da tela), todos corrigidos.
- A **segunda convergência** (seção 6.6.7) tratou com mais duas garantias as duas classes que a revisão final ainda achava:
  - o ponto único da correção (`src/Correcao.js`), com a tabela dos 23 valores que a correção mantém do original e o oráculo
    da correção no teste aleatório. Ele achou 21 defeitos, 4 altos: 11 por semente e 10 pela leitura do código ao montar as tabelas e o ponto único;
  - o curral e o tronco sem estado escondido, com o gerador da tela ampliado (o modo sem `localStorage`), e o teste "o cliente
    não calcula". Foram 3 defeitos, achados pela leitura do código e pelo teste estático; as levas da tela só acharam erros do
    modelo.

  Na fase, o teste aleatório do motor rodou **«SEM_MOTOR» sementes novas**, e o da tela, **«SEM_TELA»**.
- **A última rodada não terminou sem achado alto**: a rodada 2 da segunda convergência teve 10 altos, mais que os 7 da
  rodada 1 e os 7 da revisão final. Pela primeira vez, o curral e o tronco não tiveram achado alto numa rodada. O fato
  congelado na correção teve 4 altos, e apareceram duas frentes novas com altos: a verificação da cópia na mesma linha do
  lançamento e as telas que escolhem um valor pelo dado de hoje. Dos 17 achados, 8 eram conserto incompleto ou regressão, todos
  de peças ou consertos da própria segunda convergência. Os 17 consertos não passaram por outra revisão, porque a orquestração
  previa no máximo duas rodadas. **A convergência não está demonstrada** (seção 6.6.7).
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
| E3.1 PESAGEM | Individual, coletiva e por lote (cada animal com a média, 1 casa, `MEDIA_LOTE`) por um tratador só; peso fora de 0,1 a 2.000 kg ou com duas casas recusado (RN-049); `PESO_IMPLAUSIVEL` contra a pesagem anterior e, no retroativo, contra a seguinte (RN-050); `POSSIVEL_DUPLICIDADE` no mesmo dia; GMD só entre pesagens individuais da mesma permanência e com 28 dias ou mais (sem valor com o motivo, nunca zero); GMD do período, por pasto, por categoria e de lote; projeção rotulada "Estimativa"; curva na ficha; tela de desempenho; **modo curral** no celular: brinco, Enter, peso, Enter, blocos de 20 com chave própria, rascunho no aparelho e no servidor, conferência pela chave depois de resposta perdida, aviso e recusa do servidor na linha | `WeightService` (novo), `EventCatalog`, `EventService`, `AuditService`, `Timeline`, `AnimalService`, `Api` (`peso.desempenho`), `Weights` (novo, sob demanda), `Components` (`UI.curvaPeso`), `Animals`, `Events`, `Dashboard`, `JavaScript` | `pesagem.test.js`, `pesagem.desempenho.test.js` (CT-05 número a número), `acceptance.test.js` (CT-05, CT-10 passo 3, CT-17 e CT-18 com a pesagem), `estorno.test.js`, `regras.fase3.test.js` (RN-051, RN-053), `revisao.fase3.zootecnia.test.js` (achados 5, 15, 29), `revisao.fase3.motor.test.js` (achado 8), `revisao.fase3.regras.test.js` (achado 26), `revisao2.fase3.zootecnia.test.js` (achados 7, 12, 13, 19), `revisao3.fase3.zootecnia.test.js` (achados 8, 9, 14), `ui/pesagem.test.js` (360 px, rede cortada, aviso aceito na linha), `ui/revisao.fase3.test.js` (achados 5, 11, 12, 22), `ui/revisao2.fase3.test.js` (achados 7, 15, 17, 18, 20, 25 no curral), `ui/revisao3.fase3.test.js` (achados 2, 3, 5, 8, 9, 14, 15) | `EXECUTADO AQUI`; celular no curral e iframe: `PENDENTE NA CONTA DO DONO` |
| E3.2 PRODUTOS, estoque opcional (ESTOQUE), PROTOCOLOS_SANITARIOS | `produto.salvar` (unidade que não muda depois do primeiro uso; estoque controlado só quando pedido, PR-10) e `protocolo.salvar` (uma vez, a cada N dias, campanha em meses; sexo, faixa de idade, categoria, antecedência, tolerância); ESTOQUE com entrada (a compra é sempre um lançamento COMPRA_INSUMOS com parcelas; o movimento de entrada só com o controle ligado, decisão 16.9) e acerto (contagem pela diferença, perda, vencimento; a contagem vigente impede o movimento que mudaria o saldo contado, `CONTAGEM_POSTERIOR`); saldo como projeção dos movimentos vigentes, refeito pelo projetor e conferido pela trava; ligar o controle com saldo negativo pede confirmação | `HealthService`, `EventCatalog`, `EventService`, `AuditService`, `FinancialService`, `Timeline`, `Health` (novo, sob demanda) | `estoque.test.js` (03a, 4.7), `acceptance.test.js` (ESTOQUE), `revisao.fase3.motor.test.js` (achados 7 e 13), `revisao.fase3.regras.test.js` (achado 16), `revisao2.fase3.motor.test.js` (achados 2 e 5, 8, 9), `revisao3.fase3.motor.test.js` (achados 16, 17), `ui/sanidade.test.js`, `ui/revisao2.fase3.test.js` (achado 9), `ui/revisao3.fase3.test.js` (achados 17 e 19) | `EXECUTADO AQUI`; cadastro real com o veterinário e PR-10: `PENDENTE NA CONTA DO DONO` |
| E3.3 SANIDADE | Seis subtipos (vacinação, vermifugação, medicação, tratamento, exame, doença), individual e coletiva, com produto do cadastro, nome livre ou, na doença, sem produto; dose por cabeça, por peso (o peso na data com a validade, ou o de referência da categoria) ou só o total do frasco; consumo e custo na aplicação (PR-11): a saída do estoque e um CUSTEIO sem parcela rateado aos tratados (03b, 15.2 centavo a centavo); serviço pago no ato com parcelas; o produto do cadastro com custo pago também no ato recusado (`CUSTO_EM_DOBRO`); carência (RN-072; sem os dias informados, a carência padrão do produto) na venda e, pelo outro lado, na aplicação retroativa que cobre uma venda para abate já gravada; agenda por protocolo e pela próxima dose informada, com a cobertura e o custo sanitário do período; alertas `SANITARIO_VENCIDO`, `SANITARIO_PROXIMO` e `EM_CARENCIA`; avisos `PRODUTO_VENCIDO` e `ESTOQUE_INSUFICIENTE` (aviso ou bloqueio pelo parâmetro); bloco F da ficha; carência no cartão da venda e no seletor | `HealthService`, `EventCatalog`, `EventService`, `AuditService`, `InventoryService`, `AnimalService` (`carencia_ate`), `Health`, `Components`, `Animals`, `Events` | `sanidade.test.js` (03b 15.2 linha a linha, CT-06), `sanidade.agenda.test.js` (03a 4.9; 05, 4.7), `venda.test.js` (carência pela SANIDADE real), `acceptance.test.js` (CT-06, SANIDADE), `regras.fase3.test.js` (RN-058), `revisao.fase3.motor.test.js` (achados 3, 4 e 6), `revisao.fase3.zootecnia.test.js` (achado 10), `revisao.fase3.regras.test.js` (achados 17, 23, 24), `revisao2.fase3.motor.test.js` (achados 1 e 4, 3), `revisao2.fase3.zootecnia.test.js` (achado 10), `revisao3.fase3.motor.test.js` (achados 1, 19, 21 e 23), `revisao3.fase3.zootecnia.test.js` (achado 6), `ui/sanidade.test.js`, `ui/revisao.fase3.test.js` (achado 20) | `EXECUTADO AQUI`; PR-11 e o tempo da agenda com a base real: `PENDENTE NA CONTA DO DONO` |
| E3.4 ESTACOES_MONTA e REPRODUCAO | `estacao.salvar`; exposição (fêmeas e touros na mesma lista; linha TOURO), cobertura, inseminação, diagnóstico em lote (positivo, negativo, duvidoso, com a idade da gestação e a previsão informada) e aborto; situação reprodutiva pelo último fato e pela situação declarada na entrada; previsão de parto nos quatro níveis de 03b, 7.3, sempre rotulada como estimativa; regras de manejo (touro castrado, parto dentro da gestação de um diagnóstico) antes e depois de todo comando; indicadores de 07, seção 8.3 (prenhez, parição, natalidade, perda gestacional, desmama, mortalidade até a desmama, IEP, idade ao primeiro parto) por estação, por categoria e na forma anual, com numerador, denominador, n e "parcial", numa data qualquer; lista de fêmeas com alertas `PARTO_PREVISTO` e `PRENHEZ_VENCIDA`; ficha da matriz (bloco G); **diagnóstico no tronco** (o modo curral do diagnóstico) | `ReproductionService`, `EventCatalog`, `EventService`, `AuditService`, `Timeline` (`reproducaoEm`), `InventoryService`, `AnimalService`, `Api` (`reproducao.indicadores`, `reproducao.matrizes`), `Reproduction` (novo, sob demanda), `Animals`, `Events`, `Dashboard` | `reproducao.test.js`, `reproducao.indicadores.test.js` (o exemplo de 07, 8.3 e o de RN-066 número a número), `acceptance.test.js` (REPRODUCAO), `regras.fase3.test.js` (RN-065), `revisao.fase3.zootecnia.test.js` (achados 1, 2, 9, 28), `revisao.fase3.motor.test.js` (achado 14), `revisao2.fase3.zootecnia.test.js` (achados 6 e 11, 7, 16 e 22 no servidor), `revisao3.fase3.motor.test.js` (achados 11 e 18), `revisao3.fase3.zootecnia.test.js` (achado 7), `ui/reproducao.test.js`, `ui/revisao.fase3.test.js` (achados 11, 12, 17, 19, 21, 27), `ui/revisao2.fase3.test.js` (achados 7, 15, 24, 25 no tronco), `ui/revisao3.fase3.test.js` (achados 2, 3, 4, 13, 20) | `EXECUTADO AQUI`; PR-07: `PENDENTE NA CONTA DO DONO` |
| E3.5 DESMAMA, CASTRACAO, OCORRENCIA | Desmama da cria (DL-06) com o peso (vira a pesagem DESMAMA) e o pasto de destino (o movimento), a linha MATRIZ uma vez por mãe; castração do macho inteiro (deixa de ser reprodutor); ocorrência com o tipo da lista e a descrição; os três com a despesa paga no ato rateada por cabeça; desmama e castração repetidas recusadas; a troca da mãe de uma cria já desmamada recusada com o caminho da solução | `EventCatalog`, `EventService`, `ReproductionService`, `AuditService`, `Timeline` | `manejo.test.js`, `acceptance.test.js` (REPRODUCAO, desfechos da estação), `estorno.test.js`, `revisao.fase3.regras.test.js` (achado 25), `revisao2.fase3.zootecnia.test.js` (achado 14), `revisao3.fase3.motor.test.js` (achados 10, 12) | `EXECUTADO AQUI` |
| E3.6 Importadores de pesagens, sanidade, reprodução e ocorrências | Os quatro tipos no mesmo assistente e nos mesmos 10 passos das importações da Fase 2, cada lançamento planejado pelo tratador único num ensaio em memória com a trava; o animal pelo brinco que ele usava na data; produto, protocolo e estação pelo nome; a linha repetida e o fato já gravado ficam DUPLICADA (no manejo, a linha sai e as outras entram); histórico anterior ao marco zero (a aplicação antiga não mexe no estoque nem gera consumo; a despesa nasce sem caixa; a pesagem antiga fica na curva e fora do GMD); desfazer com as conferências do estorno | `ImportService`, `EventService` (`HISTORICO_IMPORTADO`), `AuditService`, `Timeline`, `WeightService`, `Import` | `import.manejo.test.js`, `unitofwork.adversarial.test.js` (quedas do bloco de PESAGENS e de SANIDADE nas três formas de gravação), `import.test.js`, `import.eventos.test.js`, `revisao.fase3.regras.test.js` (achados 23 e 26), `revisao2.fase3.motor.test.js` (achado 3), `revisao3.fase3.motor.test.js` (achados 1, 21 e 23), `ui/importacao-manejo.test.js` | `EXECUTADO AQUI`; tempo com milhares de linhas no Sheets: `PENDENTE NA CONTA DO DONO` |
| E3.7 Gráficos | Kit em SVG próprio (SP-08, sem biblioteca nem CDN) em `Components`: linha, barras horizontais, barras empilhadas e a curva de peso; `<title>` e `<desc>`, eixo com a unidade, escala "redonda", tabela equivalente ("Ver tabela") com os mesmos textos, estado vazio e desenho na largura útil da tela; G5 (evolução mensal do peso) e o rebanho por categoria em cada pasto em `peso.desempenho`; gráficos na ficha, no desempenho, na reprodução, na sanidade e no Início, todos com os números do servidor | `Components`, `Styles`, `WeightService`, `Weights`, `Reproduction`, `Health`, `Dashboard`, `Animals` | `graficos.test.js`, `ui/graficos.test.js` (360 e 1280 px, números do desenho = tabela = servidor), `ui/revisao.fase3.test.js` (achados 18, 19, 28), `revisao3.fase3.zootecnia.test.js` (achado 14), `ui/revisao2.fase3.test.js` (achado 24), `ui/revisao3.fase3.test.js` (achados 13, 14) | `EXECUTADO AQUI` (Chromium do Playwright); iframe, celular e computador do dono: `PENDENTE NA CONTA DO DONO` |
| Transversal: telas sob demanda (R-31) | Rota extra `sistema.tela` (sem abrir a planilha-banco); o catálogo declara o módulo sob demanda e as rotas dele; o cliente (`Modulos`) pede a tela uma vez, injeta o `<script>` como nó, guarda em memória; falha de rede com "Tentar de novo"; outra versão do app no servidor → "Recarregar a página"; `ui:check` mede a página inicial (450 KB) e cada tela sob demanda (150 KB) | `Api`, `EventCatalog`, `JavaScript`, `Index`, `scripts/ui-check.js` | `telas.sobdemanda.test.js`, `interface.test.js`, `ui/sobdemanda.test.js`, `ui/movimentos.test.js` (a corrida do seletor com data passada, consertada na etapa BASE), `ui/revisao2.fase3.test.js` (achado 18: a Início traz as telas do curral e do tronco) | `EXECUTADO AQUI`; a injeção no iframe real: `PENDENTE NA CONTA DO DONO` (NV) |
| Transversal: aceitação, demonstração, jornada e regras | `runAcceptanceTests` com CT-05, CT-06, SANIDADE, ESTOQUE, REPRODUCAO e o passo 3 do CT-10 (23 cenários no total); base de demonstração com o manejo completo (410 comandos, 304 ativos, nenhuma recusa nem aviso aceito), conferida pelo servidor no fim (`demonstracao.manejo`); jornada de um ano de manejo só pela `api()`; mapa RN-049 a RN-066 → teste | `TestRunner` | `acceptance.test.js`, `jornada.fase3.test.js`, `regras.fase3.test.js` | `EXECUTADO AQUI` (fakes); na conta: `PENDENTE NA CONTA DO DONO` |
| Transversal: trava e teste aleatório | Cada fato novo conferido por `AuditService.conferirDominio_` (PESAGENS e a cópia do peso, SANIDADE, MOVIMENTOS_ESTOQUE e o saldo, REPRODUCAO, as regras de manejo, o histórico sem estoque), a mesma função da trava em todo caminho; o saldo do insumo na quarentena da fonte quebrada; o teste aleatório com gerador e oráculo de cada tipo e importador num registro único, o curral e o tronco em blocos com reenvio, as interações com a Fase 2 | `AuditService`, `UnitOfWork`; `tests/apoio-fuzz.js` | `trava.integridade.test.js`, `integrity.fase2.test.js`, `fase2.fuzz.test.js` (23 sementes fixas), `fase3.fuzz.regressoes.test.js`, `revisao.fase3.*.test.js`, `revisao2.fase3.*.test.js`, `revisao3.fase3.*.test.js` | `EXECUTADO AQUI` |
| Transversal: convergência pela garantia (seção 6.6) | O estado numa data D por um ponto único (`Timeline.fonteAte` e `retratoEm`: o mesmo projetor de hoje sobre os fatos até D) e o oráculo de viagem no tempo no teste aleatório; o resolvedor único do brinco na data, no servidor (`Identificacao`, rota `animal.resolver`), usado pelo curral, pelo tronco, pelo seletor, pelas buscas e pela importação (o aparelho não resolve brinco); o teste aleatório da tela do curral e do tronco com falhas de rede e as garantias da fila de lote; o conserto da revisão final | `Timeline`, `Identificacao` (novo), `AnimalService`, `InventoryService`, `PastureService`, `HealthService`, `ReproductionService`, `WeightService`, `ImportService`, `EventService`, `Api`, `Utils`, `JavaScript`, `Components`, `Weights`, `Reproduction`, `Events`, `Health`, `Pastures`; `tests/apoio-fuzz.js`, `tests/apoio-resolvedor.js`, `tests/ui/apoio-curral.js` | `tempo.regressoes.test.js`, `resolvedor.unico.test.js`, `revisao.final.fase3.test.js`, `fase2.fuzz.test.js` (os contadores do tempo e do resolvedor nas sementes fixas), `ui/resolvedor.test.js`, `ui/curral.fuzz.test.js` (6 sementes fixas), `ui/curral.fuzz.regressoes.test.js`, `ui/revisao.final.fase3.test.js` | `EXECUTADO AQUI`; a ida ao servidor por brinco no celular e o retrato numa data no Apps Script: `PENDENTE NA CONTA DO DONO` |
| Transversal: segunda convergência (seção 6.6.7) | O ponto único da correção (`Correcao`: a entrada sem mudança montada só das linhas gravadas, a correção só com a mudança, a tabela dos 23 valores que a correção mantém do original, as marcas do digitado no payload) e o oráculo da correção no teste aleatório; a verificação da cópia na mesma linha do lançamento; o curral e o tronco sem estado escondido (o bloco só sai com a chave guardada; o rascunho no servidor pela versão, que avisa a falha e vai de novo sozinho), com o gerador da tela ampliado; o teste "o cliente não calcula" e a rota `financeiro.vencimentos`; o conserto das duas rodadas de revisão | `Correcao` (novo), `EventService`, `AuditService`, `ReproductionService`, `HealthService`, `FinancialService`, `ImportService`, `EventCatalog`, `Api`, `TestRunner`, `JavaScript`, `Components`, `Events`, `Health`, `Weights`, `Reproduction`, `Animals`, `Import`; `tests/apoio-fuzz.js`, `tests/apoio-naocalcula.js`, `tests/ui/apoio-curral.js` | `correcao.regressoes.test.js`, `correcao.contrato.test.js`, `cliente.naocalcula.test.js`, `convergencia2.r1.test.js`, `convergencia2.r2.test.js`, `fase2.fuzz.test.js` (a cobertura do oráculo da correção nas sementes fixas), `ui/curral.fuzz.test.js`, `ui/curral.fuzz.regressoes.test.js` (regressões 7 e 8), `ui/convergencia2.r1.test.js`, `ui/convergencia2.r2.test.js` | `EXECUTADO AQUI`; o curral sem `localStorage` num celular e o tempo da trava com as conferências novas no Apps Script: `PENDENTE NA CONTA DO DONO` |

## 2. Resultados dos testes executados aqui

Ambiente: Node 22.23.4 (Linux, 4 núcleos), Playwright 1.63.0 com Chromium. A execução é de 18/11/2026, nesta etapa (o
relatório da segunda convergência), sobre o código final dela, que é a última alteração de comportamento da fase: o `src/` do
commit `c4721eb` e os testes do `b9a2072`, dois salvamentos automáticos durante o conserto da rodada 2 (seção 7). Nesta etapa só
mudaram documentos: este relatório, o `CHANGELOG` e o `CONTRATOS.md` (a frase do estado e três correções de texto, nas seções
19, 46 e 54). A suíte inteira rodou uma vez, antes da mudança no `CONTRATOS.md`. Os três arquivos que o leem (`static`,
`revisao4.interface` e `correcao.contrato`) rodaram de novo sozinhos depois dela: «REL_CONTRATOS». Pelos registros das etapas, o fim de
cada uma deu, em testes de Node e de navegador:
- relatório da primeira convergência: 863 e 186;
- correção: 887 e 186;
- curral: 890 e 190;
- rodada 1: 902 e 201;
- rodada 2: 914 e 212.

### 2.1 Nível 1 — `npm test` (`node --test tests/*.test.js`)

Saída: `# tests 914 · # pass 914 · # fail 0 · # cancelled 0 · # skipped 0 · # todo 0` (duração 903,0 s; 15 min 4 s de
relógio). Ao lado, por poucos segundos, rodaram só o registrador da contagem e consultas curtas ao código. As 23 sementes fixas do
teste aleatório, com 60 passos cada, deram: `FUZZ: 23 sementes × 60 passos: 831 aceitos, 440 recusados, 0 falhas`. Na
primeira convergência eram 826 aceitos e 443 recusados. A contagem mudou na etapa 1 da segunda convergência, com os consertos da
correção, e não mudou mais depois, pelos registros das etapas. As sementes fixas exigem também que o oráculo da correção
confira algo.

Contagem por arquivo nesta etapa:
- **A contagem de todos os 87 arquivos** foi tirada sem rodar os corpos: um registrador no lugar de `node:test` conta os
  `test()` de cada arquivo. A soma, 914, é a da suíte. Como a suíte inteira passou sem falha, cada arquivo passou com a contagem
  da tabela.
- **Os 48 arquivos novos ou alterados na Fase 3** estão na primeira tabela: 29 novos e 19 alterados desde o relatório da Fase 2.
  - Na segunda convergência entraram 5: `correcao.regressoes`, `correcao.contrato`, `cliente.naocalcula`, `convergencia2.r1` e
    `convergencia2.r2`.
  - Mudaram 14, sem mudar a contagem. Três deles não tinham mudado desde a Fase 2: `fase2.adversarial`, `revisao1.financeiro` e
    `telas.fase2`. Os outros 11 são `fase2.fuzz`, `fase3.fuzz.regressoes`, `manejo`, `pesagem`, `reproducao`,
    `revisao.final.fase3`, `revisao2.fase3.motor`, `revisao2.fase3.zootecnia`, `revisao3.fase3.zootecnia`, `sanidade` e
    `sanidade.agenda`. Cada ajuste está no `CHANGELOG` e não afrouxa o que o teste confere.
  - Os apoios que mudaram ou entraram (`apoio-fuzz`, `apoio-naocalcula`, `harness` e os fakes da planilha e do Drive, com
    `gas.estado`) só são usados pelos testes e não declaram teste.
- `static` e `revisao4.interface` leem o `CONTRATOS.md` mudado nesta etapa e rodaram de novo sozinhos depois da mudança, com
  `correcao.contrato` (que está na tabela).
- **Os demais 37** não mudaram desde a Fase 2 e passaram na suíte completa.

A soma confere com o total da suíte: 863 da primeira convergência + 51 dos 5 arquivos novos (21 + 3 + 3 + 12 + 12) = 914. Por
fase: 673 da Fase 2 + 217 dos 29 arquivos novos da Fase 3 + 24 a mais em 3 alterados = 914.

**Arquivos novos ou alterados na Fase 3** (a contagem pelo registrador; todos passaram na suíte completa desta etapa):

| Arquivo | Testes | Aprovados | Falhas | O que cobre |
|---|---:|---:|---:|---|
| `tests/acceptance.test.js` | 6 | 6 | 0 | Os cenários do `runAcceptanceTests` no fake, nas duas ordens de carga: os 23 das Fases 1 a 3 (com CT-05, CT-06, SANIDADE, ESTOQUE, REPRODUCAO e o passo 3 do CT-10); retomada, falha relatada, base de demonstração completa e retomável com `demonstracao.manejo`, `runDiagnostics` (alterado) |
| `tests/animals.test.js` | 10 | 10 | 0 | Lista, ficha A a J (os blocos de peso, sanidade e reprodução entregues, com o motivo de cada valor vazio), árvore, edição, animal externo (alterado) |
| `tests/api.test.js` | 14 | 14 | 0 | Envelope, guarda de dono, roteador, avisos, duplicado, LOCKED, carga condicional (catálogo da Fase 3), ambiente TESTE, rascunho, fuso, páginas (alterado) |
| `tests/cliente.naocalcula.test.js` | 3 | 3 | 0 | O cliente não calcula (seção 6.6.7): o leitor acusa a conta de data e de número de domínio no código do aparelho e não a formatação (autoteste); nenhum `src/*.html` faz conta fora da lista de 11 exceções, e nenhuma entrada da lista fica sem uso; os casos que começaram a regra (a prévia da correção, a agenda e as parcelas) (novo na segunda convergência) |
| `tests/convergencia2.r1.test.js` | 12 | 12 | 0 | Rodada 1 da segunda convergência no servidor: achados 1, 2 e 3 (com e sem peso), 4, 7, 8, 9, 10, 11, 15, 16 e 5 (o rascunho pela versão) (novo) |
| `tests/convergencia2.r2.test.js` | 12 | 12 | 0 | Rodada 2 da segunda convergência no servidor: achados 1, 2 e 6, 6 (as cópias do cabeçalho), 3, 4, 5, 9, 10, 11, 12, 13 e 17 (novo) |
| `tests/correcao.contrato.test.js` | 3 | 3 | 0 | A correção com outra data refaz o derivado do estado do dia; com outro produto copia o cadastro de hoje do produto novo; a tabela B do `CONTRATOS.md` (seção 50.4) é a do código, com a mesma natureza (lê o `CONTRATOS.md` desta etapa) (novo) |
| `tests/correcao.regressoes.test.js` | 21 | 21 | 0 | Os 21 defeitos do oráculo da correção (seção 6.6.7), um teste cada, que falha com o `src/` de antes da etapa (`b8c513b`) (novo; ajustado na rodada 2 ao contrato da carência e da desmama) |
| `tests/estoque.test.js` | 6 | 6 | 0 | ESTOQUE e PRODUTOS: o cadastro do produto (unidade que não muda depois do uso, estoque desligado por padrão), o exemplo de 03a, 4.7 (entrada, saída, perda, contagem), o frasco pago no ato de 07, seção 5, as regras da entrada e do acerto, os caminhos (correção, substituto, estorno com e sem dependente) e a integridade do estoque; o payload da entrada traz `com_movimento` (alterado na rodada 2) |
| `tests/estorno.test.js` | 44 | 44 | 0 | Estorno e substituição de todo tipo ativo, agora com os da Fase 3: CT-07, CT-08, CT-09, CT-17 (b), CT-18, dependente e retroativo (alterado: 27 → 44) |
| `tests/events.test.js` | 21 | 21 | 0 | Catálogo (`FASE_ATUAL` 3; tipo ativo só com campos, módulo ativo só com a tela; o menu até a Fase 5), entradas, CT-09, CT-10, CT-18 da Fase 1, estorno e correção, ajustes (alterado) |
| `tests/fase2.adversarial.test.js` | 11 | 11 | 0 | O ataque ao motor e ao financeiro da Fase 2 com o modelo independente; na segunda convergência, o modelo segue a tabela B na correção do parto (o pasto vazio das crias é o do original) (alterado; não mudava desde a Fase 2) |
| `tests/fase2.fuzz.test.js` | 2 | 2 | 0 | Teste aleatório de todos os comandos das Fases 1 a 3 pela `api()`: 23 sementes fixas × 60 passos (831 aceitos, 440 recusados, 0 falhas), com a cobertura mínima de cada tipo e dos oráculos da rodada 3; e o registro: todo tipo ativo tem gerador e oráculo, todo importável tem arquivo (alterado: 1 → 2; na rodada 3, a semente 29 e `FUZZ_COBERTURA`); na convergência, as sementes fixas exigem também os contadores dos oráculos do tempo e do resolvedor; na segunda, os do oráculo da correção |
| `tests/fase3.fuzz.regressoes.test.js` | 3 | 3 | 0 | As sequências mínimas das falhas do modelo nas passadas das Fases 1 a 3 (sementes 7106, 1210049 e 1320022), com o desfecho de cada passo; na segunda convergência, a castração repetida recusada já pelo motor (`CASTRACAO_REPETIDA`) |
| `tests/graficos.test.js` | 6 | 6 | 0 | G5 (evolução mensal do peso) e o rebanho por categoria em cada pasto número a número; a escala do eixo; as regras estáticas do kit (title, desc, tabela equivalente, unidade, nenhuma conta nas telas) e o contraste das 8 cores |
| `tests/import.test.js` | 9 | 9 | 0 | Importação de ANIMAIS: CT-12 da Fase 1, lotes, queda, retomar, concluir, desfazer (alterado) |
| `tests/import.eventos.test.js` | 7 | 7 | 0 | Importação de COMPRAS, VENDAS, TRANSFERENCIAS, NASCIMENTOS e MORTES (o tipo "de outra fase" deixou de existir; o desconhecido continua recusado) (alterado) |
| `tests/import.manejo.test.js` | 10 | 10 | 0 | Importação de PESAGENS, SANIDADE, REPRODUCAO e OCORRENCIAS: agrupamento, pesagem por lote, histórico anterior ao marco zero, duplicadas pela linha e pela base, os caminhos (correção, estorno, desfazer), recusas, rotas e a integridade do histórico sanitário |
| `tests/integrity.fase2.test.js` | 11 | 11 | 0 | As checagens da Fase 2 por adulteração, com o saldo de estoque na projeção conferida; a demonstração da Fase 3 inteira sem erro; tempo medido (alterado) |
| `tests/interface.test.js` | 8 | 8 | 0 | Página do `doGet` (compactada, sem as telas sob demanda), sintaxe do cliente e das telas sob demanda, contraste, alvos de toque, regras estáticas (alterado) |
| `tests/jornada.fase3.test.js` | 1 | 1 | 0 | Um ano de manejo só pela `api()`: inventário por pasto, peso e GMD de cada animal, indicadores da estação, agenda, estoque e custo sanitário contra um modelo independente; projeção = reconstrução e invariantes depois de cada comando; integridade sem erro |
| `tests/manejo.test.js` | 4 | 4 | 0 | DESMAMA (03b, 3.4 e 16.14) e por caminho; CASTRACAO (o touro castrado deixa de ser reprodutor); OCORRENCIA; a despesa paga no ato; na segunda convergência, o bezerro já no pasto informado tem a linha com origem = destino |
| `tests/nascimento.test.js` | 16 | 16 | 0 | NASCIMENTO: CT-01, gemelar, natimorto, peso ao nascer, pai opcional, REPRODUCAO, histórico da matriz (o bloco G entregue) (alterado) |
| `tests/pastures.test.js` | 7 | 7 | 0 | Propriedades, pastos com posse e arrendador, painel, UA/ha sem transformar ausente em zero; a parte `estimativa_visual` da UA e o aviso de lotação com o rótulo da composição (alterado nas rodadas 2 e 3; sem mudança na Fase 3 até a entrega) |
| `tests/pesagem.test.js` | 12 | 12 | 0 | PESAGEM pelos caminhos do tratador único: individual, coletiva e por lote, faixa (RN-049), variação brusca (RN-050), retroativo, mesmo dia, correção, substituto, estorno com dependente, importação e desfazer, integridade e trava, lotação em data (alterado nas rodadas 2 e 3: a anterior traz o método e se é estimada; a resposta traz `gmd_intervalo`; na segunda convergência, a média do lote sem o lote é método diferente das outras linhas) |
| `tests/pesagem.desempenho.test.js` | 10 | 10 | 0 | CT-05 na ficha número a número; uma pesagem só; mesmo dia e retroativa; saiu e voltou; métodos; peso ao nascer; projeção; GMD de lote, por pasto e por categoria; `peso.desempenho` |
| `tests/regras.fase2.test.js` | 8 | 8 | 0 | Mapa RN → teste das 112 regras e as RN da Fase 2 sem caso próprio (alterado: o nome do teste de aceitação das Fases 1 a 3) |
| `tests/regras.fase3.test.js` | 5 | 5 | 0 | Mapa RN-049 a RN-066 → teste (cada teste citado existe; cada caso de 09, 4.1, no `TestRunner`); RN-051 em todo caminho, RN-053, RN-058 e RN-065 (alterado na rodada 2: os protocolos do RN-058 cadastrados antes das datas consultadas) |
| `tests/reproducao.test.js` | 8 | 8 | 0 | Estação de monta; exposição, cobertura, inseminação, diagnóstico em lote e aborto; os caminhos; integridade e trava; importação e desfazer; ficha da matriz, lista de fêmeas e alertas; na segunda convergência, o touro castrado recusado pelo motor (`TOURO_CASTRADO`) e a janela da previsão com a tolerância |
| `tests/reproducao.indicadores.test.js` | 5 | 5 | 0 | Indicadores de 07, seção 8.3, número a número (80 expostas) e de RN-066 (40 expostas; com 4, sem valor); quem saiu no meio da estação; desmama e mortalidade até a desmama; a forma anual |
| `tests/resolvedor.unico.test.js` | 2 | 2 | 0 | Resolvedor único (seção 6.6.3): cada um de 19 casos difíceis dá o mesmo resultado no curral, no tronco e no seletor (pela rota `animal.resolver`), na conferência pela posição da data e na importação de verdade; a rota descreve o animal na data e recusa data futura e lista grande demais |
| `tests/revisao.fase3.motor.test.js` | 8 | 8 | 0 | Revisão da Fase 3, um teste por caminho dos achados 3 e 6, 4, 7, 8 e 13 (dois cada) e 14 (alterado na rodada 2: `com_movimento` no payload da entrada) |
| `tests/revisao.fase3.regras.test.js` | 6 | 6 | 0 | Revisão da Fase 3: achados 16, 17, 23, 24, 25 e 26 |
| `tests/revisao.fase3.zootecnia.test.js` | 8 | 8 | 0 | Revisão da Fase 3: achados 1, 2, 5, 9, 10, 15, 28 e 29 |
| `tests/revisao.final.fase3.test.js` | 8 | 8 | 0 | Revisão final (seção 6.6.5): achados 1, 2, 8, 9, 10, 11, 16 e 17; na segunda convergência, o nunca aplicado vence no início do protocolo |
| `tests/revisao1.financeiro.test.js` | 6 | 6 | 0 | Rodada 1 da revisão da Fase 2, FINANCEIRO; na segunda convergência, a tela lê a entrada da correção do servidor (`o.correcao`), com o tipo de cada dedução (alterado; não mudava desde a Fase 2) |
| `tests/revisao2.fase3.motor.test.js` | 7 | 7 | 0 | Rodada 2 da revisão: achados 1 e 4 (dose por peso congelada, dois caminhos), 2 e 5 (a contagem que impede o movimento anterior; integridade e outros caminhos), 3, 8 e 9; na segunda convergência, o desfazer da importação recusado já pelo motor (`CONTAGEM_POSTERIOR`) |
| `tests/revisao2.fase3.zootecnia.test.js` | 7 | 7 | 0 | Rodada 2 da revisão: achados 6 e 11, 7, 16 e 22 (no servidor), 13 e 21, 10, 12, 14 e 19; na segunda convergência, o vencimento no início do protocolo |
| `tests/revisao3.fase3.motor.test.js` | 9 | 9 | 0 | Rodada 3 da revisão: achados 1, 10, 11 e 18, 12, 16, 17, 19, 21 e 23, 24 |
| `tests/revisao3.fase3.zootecnia.test.js` | 5 | 5 | 0 | Rodada 3 da revisão: achados 6, 7, 8 e 25, 9 e 14; na segunda convergência, o vencimento no início do protocolo, com a ficha igual à agenda |
| `tests/revisao4.interface.test.js` | 7 | 7 | 0 | Rodada 4 da Fase 2, INTERFACE E REGRAS (sem mudança; lê o `CONTRATOS.md` desta etapa) |
| `tests/sanidade.test.js` | 9 | 9 | 0 | 03b, 15.2 linha a linha; CT-06; dose por peso; modo total, nome livre e subtipos; protocolo e avisos; caminhos; carência (RN-072) nos dois sentidos; importação e desfazer; integridade; na segunda convergência, o payload com as marcas do digitado |
| `tests/sanidade.agenda.test.js` | 5 | 5 | 0 | `protocolo.salvar`; INTERVALO_DIAS, CAMPANHA_MESES e UNICA (03a, 4.9; 05, 4.7) com as datas; pendência sem protocolo, carência, custos do período e alertas; na segunda convergência, o vencimento no início do protocolo |
| `tests/static.test.js` | 19 | 19 | 0 | Lint de camadas, superfície pública, `drive.file`, relógio, manifesto, rotas (as extras com contrato), includes (sem mudança; lê o `CONTRATOS.md` desta etapa) |
| `tests/telas.test.js` | 7 | 7 | 0 | Rotas acrescentadas pelas telas e regras puras do cliente (`importacao.modelo` com os dez tipos) (alterado) |
| `tests/telas.fase2.test.js` | 6 | 6 | 0 | Rotas e regras das telas da Fase 2; na segunda convergência, os vencimentos do "Dividir em parcelas" pela rota `financeiro.vencimentos` (inclusive D15 e as recusas), não pela função do aparelho (alterado; não mudava desde a Fase 2) |
| `tests/telas.sobdemanda.test.js` | 6 | 6 | 0 | `sistema.tela` (compactada, sem a planilha-banco, recusas com a fase); a página inicial e cada tela no orçamento; catálogo × arquivos × `Index`; o cliente injeta as telas |
| `tests/tempo.regressoes.test.js` | 16 | 16 | 0 | Viagem no tempo (seção 6.6.2): 8 cenários pela `api()`, um por defeito, com a resposta em D antes e depois do fato posterior e com o relógio adiantado; e 8 sequências mínimas do teste aleatório, com o mesmo oráculo de cada passo |
| `tests/unitofwork.adversarial.test.js` | 59 | 59 | 0 | Morte depois de cada escrita, também no bloco de PESAGENS e de SANIDADE da importação nas três formas de gravação; subconjuntos densos, oráculos independentes, intercalações, resposta perdida (alterado: 53 → 59) |
| `tests/venda.test.js` | 15 | 15 | 0 | VENDA: CT-04, CT-14, exemplos de 07 e 03b, carência pela SANIDADE real (alterado) |
| **Soma dos 48 novos ou alterados** | **484** | **484** | **0** | Sem `static` e `revisao4.interface` (26); com eles, 510 |

**Arquivos sem mudança desde a Fase 2** (passaram na suíte completa; a descrição de cada um está em
`docs/RELATORIO_FASE2.md`, seção 2.1): `anexos` (9), `compra` (14), `config` (8), `database` (21), `fase2.fuzz.regressoes` (13), `files` (5), `financeiro` (8), `harness` (25), `identificacao` (10), `integrity` (7), `inventory` (4), `jornada.fase1` (1), `jornada.fase2` (1), `lotacao` (14), `maintenance` (5), `movimentos` (12), `regras.fase1` (13), `repository` (10), `revisao1.motor` (14), `revisao2.financeiro` (3), `revisao2.motor` (13), `revisao3.financeiro` (6), `revisao3.interface` (2), `revisao3.motor` (24), `revisao4.financeiro` (5), `revisao4.motor` (20), `revisao5.financeiro` (6), `revisao5.interface` (4), `revisao5.motor` (13), `schema` (13), `setup` (5), `telas.pastos-importacao` (4), `timeline` (12), `trava.integridade` (16), `unitofwork` (32), `utils` (18), `validation` (14) — 37 arquivos, soma 404. Conta: 484 + 26 + 404 = 914.

### 2.2 Nível 3 — `npm run ui:check`

Parte estática: `ui:check — 13 arquivo(s) .html conferidos (a página inicial montada pelo doGet e as telas sob demanda), sem recurso externo e dentro do orçamento (página inicial montada: 428 KB de 450 KB; sob demanda: Import 48 KB, Weights 64 KB, Health 24 KB, Reproduction 67 KB, de 150 KB cada).` Parte Playwright: `# tests 212 · # pass 212 · # fail 0 · #
cancelled 0 · # skipped 0 · # todo 0` (duração 527,5 s; 8 min 48 s de relógio com a parte estática), com as 6 sementes fixas
do teste aleatório da tela (11 a 16, 40 ações cada). Rodou sozinho, depois do `npm test` e da medida da trava.

Tamanho do que vai ao aparelho, em bytes medidos pelas mesmas funções do `ui:check`: a página inicial montada pelo `doGet` tem
438.227 bytes (428 KB) de 460.800 (450 KB), e sobram **22.573 bytes**. A margem foi mudando assim:
- na entrega, 2.511;
- depois das rodadas 2 e 3, 1.587;
- depois do resolvedor (a pergunta ao servidor no lugar dos índices do aparelho), 41;
- depois do conserto da revisão final, 45;
- na segunda convergência, a etapa 1 tirou da página inicial a prévia da correção montada no aparelho (435.471 bytes), e as
  etapas seguintes puseram de volta 2.756 bytes (a faixa do rascunho em qualquer tela, o formulário que só sai com a chave
  guardada, a troca do produto na aplicação).

Sob demanda: Import 49.584 bytes (48 KB), Weights 65.924 (64 KB; 48 KB na entrega), Health 25.078 (24 KB; 24 KB) e
Reproduction 68.215 (67 KB; 52 KB), de 150 KB cada; o curral e o tronco cresceram com os consertos das rodadas e das duas
convergências.

Contagem por arquivo: a dos 31 arquivos foi tirada pelo registrador (soma 212, a da suíte), e a suíte inteira passou. Os 18
arquivos novos ou alterados desde o relatório da Fase 2 estão na tabela:
- 15 novos: `graficos`, `importacao-manejo`, `pesagem`, `reproducao`, `revisao.fase3`, `revisao2.fase3`, `revisao3.fase3`,
  `sanidade` e `sobdemanda`; na primeira convergência, `curral.fuzz`, `curral.fuzz.regressoes`, `resolvedor` e
  `revisao.final.fase3`; na segunda, `convergencia2.r1` e `convergencia2.r2`;
- 3 alterados: `interface`, `movimentos` e, na segunda convergência, `pastos-importacao`.

Na primeira convergência, seis deles foram ajustados à ida ao servidor para o brinco e à decisão das recusas, sem mudar a
contagem: `interface`, `pesagem`, `reproducao`, `revisao.fase3`, `revisao2.fase3` e `revisao3.fase3` (seção 6.6.4). Na
segunda, mudaram:
- `curral.fuzz`: o gerador e o oráculo ampliados;
- `curral.fuzz.regressoes`: de 7 para 11 testes, com as regressões 7 e 8 no curral e no tronco;
- `reproducao` e `sanidade`: o diagnóstico sem a estação do filtro e a carência em branco;
- `pastos-importacao`: espera a resposta do servidor (`esperarServidor`), porque sob carga falhava por tempo.

A soma confere com o total: 92 + 119 nos 15 novos + 1 em `movimentos` = 212.

| Arquivo | Testes | Aprovados | Falhas | O que cobre |
|---|---:|---:|---:|---|
| `tests/ui/convergencia2.r1.test.js` | 11 | 11 | 0 | Rodada 1 da segunda convergência na tela: achados 5 (curral e tronco, sem `localStorage`), 6 (o formulário de registro), 12 e 12b (curral), 13 e 13b (curral e tronco), 14 e 17 (novo) |
| `tests/ui/convergencia2.r2.test.js` | 11 | 11 | 0 | Rodada 2 da segunda convergência na tela: achados 7 e 8; 14, 15 e 16 no curral e no tronco; e os defeitos que o teste aleatório estendido achou (a semente 14, no curral e no tronco, e a 95022, no tronco) (novo) |
| `tests/ui/curral.fuzz.test.js` | 6 | 6 | 0 | Teste aleatório da tela do curral e do tronco (seções 6.6.4 e 6.6.7): as 6 sementes fixas (11 a 16) de 40 ações, com as falhas de rede decididas no Node, o oráculo a cada ação e, no fim, banco = modelo, integridade sem erro, projeção = reconstrução e nada no console; na segunda convergência, o gerador e o oráculo ampliados (o modo sem `localStorage`, o rascunho que falha ou chega atrasado, a recusa do servidor) |
| `tests/ui/curral.fuzz.regressoes.test.js` | 11 | 11 | 0 | Os defeitos que o teste aleatório da tela achou: mudar a data com linha na fila (curral e tronco), a falha interna no reenvio de um bloco gravado, o "Está certo" com outro bloco no ar, sair e voltar com o envio no ar, a recusa da conferência no tronco e as pendentes do mesmo animal; na segunda convergência, as regressões 7 (o bloco só sai com a chave guardada) e 8 (a falha do rascunho avisa e vai de novo), no curral e no tronco (alterado: 7 → 11) |
| `tests/ui/graficos.test.js` | 8 | 8 | 0 | Os gráficos a 360 e 1280 px: o componente, a ficha (aba Peso), o desempenho, a reprodução e a sanidade; SVG com título e descrição, os números do desenho iguais aos da tabela e do servidor, texto legível, sem rolagem horizontal, redesenho ao mudar a largura |
| `tests/ui/importacao-manejo.test.js` | 3 | 3 | 0 | Importação de pesagens (modelo, valores em palavras, linha repetida, parcial aprovado, relatório) e de sanidade (o produto pelo nome), a 1280 e 360 px |
| `tests/ui/interface.test.js` | 17 | 17 | 0 | Carga, navegação, formulário do catálogo, "hoje" no fuso, avisos, erro por animal, rascunho, LOCKED, sem resposta, faixas, leiaute 360 e 1280 px, acessibilidade; o menu com Pesagens, Sanidade e Reprodução (alterado); na convergência, o "Colar lista" espera a resposta do resolvedor |
| `tests/ui/movimentos.test.js` | 8 | 8 | 0 | Parto pela ficha da mãe, transferência com erro em 1 de 3, morte, correção do parto, transferência com data passada e, novo, com as respostas fora de ordem (a corrida do seletor) (alterado: 7 → 8) |
| `tests/ui/pastos-importacao.test.js` | 6 | 6 | 0 | Pastos e importação da Fase 2 a 1280 e 360 px; na segunda convergência, a leitura das linhas validadas e do relatório espera a resposta do servidor (`esperarServidor`), porque sob carga o teste falhava por tempo (alterado; não mudava desde a Fase 2) |
| `tests/ui/pesagem.test.js` | 8 | 8 | 0 | Modo curral a 360 px (Enter, contador, não encontrado, repetido, desfazer, recarregar); rede cortada e resposta perdida conferida pela chave; aviso do servidor aceito na linha; a ficha com a curva; o desempenho; a correção pelo detalhe; na convergência, o Enter do brinco espera a resposta do servidor |
| `tests/ui/reproducao.test.js` | 2 | 2 | 0 | Diagnóstico no tronco a 360 px (p90, v, brinco que não é de fêmea, rede cortada, reenvio pela chave); fêmeas, indicadores e estações a 1280 e 360 px; na convergência, o Enter espera a resposta do servidor |
| `tests/ui/resolvedor.test.js` | 2 | 2 | 0 | A tabela dos 19 casos do resolvedor digitada no curral, no tronco e no seletor de um formulário (seção 6.6.3) |
| `tests/ui/revisao.fase3.test.js` | 13 | 13 | 0 | Revisão da Fase 3 na tela: achados 5, 11 (curral e tronco, por animal e geral), 12 (curral e tronco), 17, 18, 19, 20, 21, 22, 27 e 28; na convergência, os dois "achado 12" conferem o 20º brinco com sinal antes de o sinal cair |
| `tests/ui/revisao.final.fase3.test.js` | 13 | 13 | 0 | Revisão final na tela: achados 3 (nas duas ordens), 4 e 7 (curral e tronco), 5, 6, 12, 13 (nas duas ordens), 14 e 15 |
| `tests/ui/revisao2.fase3.test.js` | 10 | 10 | 0 | Rodada 2 da revisão na tela: achados 7, 16 e 22 (curral e tronco pelo brinco na data), 17, 15 e 23 (curral; tronco com o 25), 25 (curral), 20, 18, 24 e 9; na convergência, o Enter espera a resposta do servidor |
| `tests/ui/revisao3.fase3.test.js` | 13 | 13 | 0 | Rodada 3 da revisão na tela: achados 2 (curral e tronco), 3 (curral e tronco), 4, 5, 8, 22 e 25, 9, 13, 14, 15, 20, 17 e 19; na convergência, o achado 2 segue a decisão das recusas (a chave já gravada fica só com "Tirar"; a falha interna mantém a chave e grava uma vez) |
| `tests/ui/sanidade.test.js` | 4 | 4 | 0 | Produtos e estoque a 360 px (cadastro pela folha, entrada pelo botão do produto); agenda e "Aplicar em N animais"; detalhe e correção da aplicação a 1280 px |
| `tests/ui/sobdemanda.test.js` | 4 | 4 | 0 | Importação sob demanda: pedida uma vez pelo menu, falha de rede com "Tentar de novo", endereço direto e menu da fase, outra versão do app no servidor (alterado na rodada 2: conta só os pedidos da tela Import, porque a Início traz as do curral e do tronco) |
| **Soma dos 18 novos ou alterados** | **150** | **150** | **0** | |

**Arquivos sem mudança desde a Fase 2**: `anexos` (1), `compra` (4), `eventos.fase2` (9), `importacao-periodo` (3), `importacao` (2), `lotacao` (4), `revisao1` (6), `revisao2` (6), `revisao3` (4), `revisao4` (4), `revisao5` (4), `telas` (12), `venda` (3) — 13 arquivos, soma 62. Conta: 150 + 62 = 212. Os apoios dos testes de navegador que
mudaram (`tests/ui/apoio.js`: `esperarServidor`, `enter` e a opção `servidor`; `tests/ui/mock-gas.js`: `emCurso`, `atrasar` e
as respostas `{"__mock":"perdida"}` e `{"__mock":"transporte"}`) e o `tests/ui/apoio-curral.js` (novo na primeira convergência,
com a recusa na rede do teste e o rascunho que falha na segunda) não declaram teste.

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
| Trava única com os tipos novos, em todo caminho | `EXECUTADO AQUI` (`pesagem.test.js`, `sanidade.test.js`, `estoque.test.js`, `reproducao.test.js`, `revisao.fase3.motor.test.js`, `revisao2.fase3.motor.test.js` e `revisao3.fase3.motor.test.js` (a contagem do estoque e a entrada congelada na verificação e na trava), teste aleatório) | `PENDENTE NA CONTA DO DONO` (o tempo dos comandos no Sheets) | — |
| Teste aleatório das Fases 1 a 3 | `EXECUTADO AQUI` (`fase2.fuzz.test.js` com as 23 sementes fixas; as levas de sementes novas na seção 6.1; `fase3.fuzz.regressoes.test.js`) | `NÃO SE APLICA`: roda sobre os fakes, pela `api()` | — |
| Telas sob demanda | `EXECUTADO AQUI` (`telas.sobdemanda.test.js`) | `PENDENTE NA CONTA DO DONO` (NV: o `<script>` injetado no iframe) | `EXECUTADO AQUI` (`ui/sobdemanda.test.js`, com o mock) |
| Consultas numa data passada: a propriedade do tempo (seção 6.6.2) | `EXECUTADO AQUI` (`tempo.regressoes.test.js`; o oráculo de viagem no tempo nas sementes fixas de `fase2.fuzz.test.js` e nas levas) | `PENDENTE NA CONTA DO DONO` (o custo do retrato numa data passada no Apps Script) | — |
| O brinco na data por um resolvedor só (seção 6.6.3) | `EXECUTADO AQUI` (`resolvedor.unico.test.js`; o oráculo do resolvedor nas sementes fixas e nas levas) | `PENDENTE NA CONTA DO DONO` (o tempo da ida ao servidor por brinco) | `EXECUTADO AQUI` (`ui/resolvedor.test.js`) |
| Curral e tronco com a rede caindo: as garantias da fila de lote (seções 6.6.4 e 6.6.7), também sem `localStorage` | — (o teste aleatório do motor entra pela chave do bloco; o rascunho no servidor pela versão em `convergencia2.r1.test.js`) | `PENDENTE NA CONTA DO DONO` (o roteiro do modo curral no celular) | `EXECUTADO AQUI` (`ui/curral.fuzz.test.js` com as 6 sementes fixas, `ui/curral.fuzz.regressoes.test.js`, `ui/revisao.final.fase3.test.js`, `ui/convergencia2.r1.test.js`, `ui/convergencia2.r2.test.js`) |
| A correção de um fato passado: o fato congelado (seção 6.6.7) | `EXECUTADO AQUI` (`correcao.regressoes.test.js`, `correcao.contrato.test.js`, `convergencia2.r1.test.js`, `convergencia2.r2.test.js`; o oráculo da correção nas sementes fixas de `fase2.fuzz.test.js` e nas levas) | `PENDENTE NA CONTA DO DONO` (corrigir um lançamento antigo depois de mudar o cadastro do produto) | `EXECUTADO AQUI` (a correção pelo detalhe: `ui/sanidade.test.js`; trocar o produto: `ui/convergencia2.r2.test.js`) |
| O cliente não calcula número nem data (seção 6.6.7) | `EXECUTADO AQUI` (`cliente.naocalcula.test.js`, que lê o código do aparelho; a rota dos vencimentos em `telas.fase2.test.js`) | `NÃO SE APLICA`: lê o código | — |
| CT-03 passo 4, CT-13 c a f, CT-15 (baixa) e CT-19 | `NÃO SE APLICA`: Fase 4 | `NÃO SE APLICA` | — |
| CT-16 (exportação XLSX e PDF) | `NÃO SE APLICA`: Fase 5 (o CSV já tem teste de tela desde a Fase 1) | `NÃO SE APLICA` | — |

## 3. O que só o dono pode executar (PENDENTE)

Nada abaixo foi executado. O roteiro está em `docs/GUIA_DE_IMPLANTACAO.md` (seção 11.2 para quem já tem a Fase 2).

| Item | Como | Evidência a devolver | Estado |
|---|---|---|---|
| Itens das Fases 1 e 2 ainda abertos: implantar, `setup`, `runDiagnostics` (SP-01 a SP-10, fuso), página de concorrência, marco zero, fórmulas de compra e venda com um caso real, PR-09, ratificar as decisões das rodadas 3 a 5 e da convergência | `docs/RELATORIO_FASE1.md` e `docs/RELATORIO_FASE2.md`, seção 3 | Os arquivos e as respostas de lá | `PENDENTE NA CONTA DO DONO` |
| Atualizar o código (40 arquivos: entraram `WeightService`, `Identificacao`, `Correcao`, `Weights`, `Health` e `Reproduction`; o guia ainda diz 38) e rodar `setup` | Guia, seção 11.2, passos 1 a 3 | Linha `setup: {...}` do registro (sem aba nem coluna nova; integridade sem erro) | `PENDENTE NA CONTA DO DONO`. O esquema não muda (as 34 abas e os parâmetros da Fase 3 já vieram na Fase 1; as marcas novas da segunda convergência ficam no payload). A verificação passa a conferir também a cópia do peso das pesagens da entrada, da compra, da venda e do parto (COPIAS) e, desde a segunda convergência, a cópia na mesma linha do lançamento e a linha de touro (seção 5, item 12): numa base em que esses dados foram mexidos à mão na planilha, ela dá ERRO sem oferecer o reparo |
| **Abrir as telas sob demanda no app real** (Pesagens, Sanidade, Reprodução e a Importação) | Guia, seção 11.2, passo 5 | "Abriu" ou a mensagem que apareceu | `PENDENTE NA CONTA DO DONO`. É a hipótese NV da etapa BASE: se o quadro do HtmlService não rodar o `<script>` injetado, a contingência é voltar a tela ao `Index` e tirar `sob_demanda` do módulo (`CONTRATOS.md`, seção 37) |
| `runAcceptanceTests` com os cenários das Fases 1 a 3 (23 cenários: PREPARO, CT-09, CT-01 a CT-06, SANIDADE, ESTOQUE, REPRODUCAO, CT-07, CT-08, CT-13, CT-14, CT-17, CT-18, CT-10, CT-12, RESTAURACAO, CT-20, CT-11, ISOLAMENTO) | Guia, seção 6, até `completo: true` (várias execuções) | Arquivo `ERP Pecuário — relatório de aceitação <instante>.json` | `PENDENTE NA CONTA DO DONO` |
| **Testar o modo curral no celular, no curral** (PR-06) | Guia, seção 11.2, "Roteiro do modo curral" | Quantos animais, quanto tempo, se o sinal caiu, se o rascunho voltou, o que atrapalhou | `PENDENTE NA CONTA DO DONO`. Desde as rodadas 2 e 3, vale conferir também: abrir a Início com sinal e depois o curral sem sinal; uma sessão com data passada sem sinal (a linha espera a posição, "Tentar de novo"); o animal sem brinco pelo código interno. O curral e o tronco tiveram achado alto nas três rodadas, na revisão final e na rodada 1 da segunda convergência; na rodada 2, só médios (seções 6.5, 6.6.6 e 6.6.7). Desde a convergência, cada brinco digitado vai ao servidor: vale medir quanto demora a resposta por brinco com sinal fraco e conferir que, sem sinal, a linha fica pendente e é conferida depois |
| **Confirmar PR-06, PR-07, PR-10 e PR-11** | Responder (guia, seção 11.2, passo 6) | As respostas | `PENDENTE NA CONTA DO DONO`; todas já têm padrão (PR-06 e PR-07 por uso, PR-10 por produto); só a PR-11, se a resposta for o custo na compra, muda uma regra do desenho (`11-riscos-e-premissas.md`, seção 4) |
| **Cadastrar produtos e protocolos com o veterinário** | Sanidade → Produtos e estoque; Sanidade → Protocolos | "Cadastrado", ou a lista do que não coube | `PENDENTE NA CONTA DO DONO`. O sistema não prescreve: o protocolo, a dose e a carência são os que o veterinário definir |
| Base de demonstração da Fase 3 (cerca de 410 lançamentos, em várias execuções de uns 4 minutos; estimativa, não medida) | Guia, seção 6, "Base de demonstração" | O relatório `plano: DEMO`, com `demonstracao.manejo` | `PENDENTE NA CONTA DO DONO` (opcional) |
| Tempo no Google Sheets com o manejo: comandos com a trava, agenda sanitária, indicadores reprodutivos, consultas numa data passada e verificação de integridade | Registrar uma pesagem coletiva, uma vacinação e um diagnóstico; abrir a agenda e os indicadores; abrir Pastos e Reprodução → Fêmeas numa data do ano passado; **Verificar a integridade agora** | Os tempos | `PENDENTE NA CONTA DO DONO`; no Node, seção 5, item 10 |
| Importação de uma planilha grande de pesagens (milhares de linhas) | Guia, seção 8, passo 6 | Relatório final da importação | `PENDENTE NA CONTA DO DONO` (opcional) |
| Gráficos no celular e no computador, no quadro do HtmlService | Abrir a ficha (aba Peso), Pesagens, Reprodução → Indicadores, Sanidade → Agenda | Captura ou relato | `PENDENTE NA CONTA DO DONO` |
| **Ratificar as decisões da Fase 3** que ficaram só em `CONTRATOS.md` (seção 4 deste relatório, itens 2 a 10 e 15; as dos itens 4 e 6 que contrariavam o desenho já foram levadas a `08-ux-ui.md` e ao desenho-base na etapa de documentação da entrega). As das rodadas 2 e 3 que mais pesam no uso: a contagem do estoque que impede o movimento anterior a ela (`CONTAGEM_POSTERIOR`, estornar e contar de novo), a carência padrão do produto quando os dias não são informados, o protocolo que só vale desde o cadastro ou a primeira aplicação, e o produto sem custo por unidade que nunca vira custo (só com aviso). E as da convergência (seção 4, item 16): o brinco resolvido sempre no servidor, que **contraria** 08, seção 5 ("no store, sem ida"); a regra das recusas do curral e do tronco; a ficha de quem saiu na data da saída; e o procedimento do protocolo que não muda depois de cumprido (`PROTOCOLO_EM_USO`). E as da segunda convergência (seção 4, item 17) que mais pesam no uso: o que a correção mantém do original (a tabela de 23 valores) e a exceção da entidade nova; a carência que a tela não preenche mais; o nunca aplicado que vence no início do protocolo; o diagnóstico sem estação e o aborto contados na estação da prenhez; a correção recusada sobre uma fonte mexida à mão; e o "Terminar" sem `localStorage` que espera o servidor apagar o rascunho | Ler e responder | A resposta | `PENDENTE NA CONTA DO DONO` |

Com esses resultados, o próximo passo é: corrigir o que divergir (fake, código ou regra), com registro no `CHANGELOG`;
marcar a validação da Fase 3 no checklist do plano; e só então dar a Fase 3 por fechada.

## 4. Decisões tomadas durante a implementação

Além das decisões do desenho (seções 16 e 17 do desenho-base). O detalhe de cada uma está em `docs/CHANGELOG.md` e nos
contratos (`docs/CONTRATOS.md`, seções 37 a 54). As que contrariavam um documento da Fase 0 levaram à atualização do
trecho na etapa de documentação da entrega (item 13). As rodadas 2 e 3 da revisão tomaram as do item 15; pelos registros delas,
nenhuma contraria um trecho da Fase 0 (cada uma cita o trecho que completa). A convergência tomou as do item 16, e uma
delas contraria o desenho: o brinco resolvido sempre no servidor (08, seção 5). Ela ainda não foi levada à Fase 0. A segunda
convergência tomou as do item 17; pelos registros dela, nenhuma contraria um trecho da Fase 0, e algumas mudam regras dos itens 6
a 9, como cada uma diz.

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
   e depois para o código (03b). O servidor preenche três padrões: a próxima aplicação pelo intervalo do protocolo, o
   fabricante do produto e, sem os dias informados, a carência padrão do produto do cadastro (desde a rodada 3, item 15);
   dose, lote e validade do cadastro são sugestões da tela, e o que foi gravado não muda quando o cadastro muda. Desde a
   segunda convergência, a tela não preenche mais a carência, e trocar o produto troca o que veio do anterior (item 17). A carência é conferida nos dois sentidos (a aplicação retroativa que cobre uma venda para abate
   segue a política de `CARENCIA_ATIVA`); a venda anterior ao marco zero não confere carência, nas duas ordens de
   importação. Produto do cadastro com custo, pago também no ato numa conta de insumo → `CUSTO_EM_DOBRO` (recusa, não aviso).
   Na correção, o fato fica congelado quando o produto ou o protocolo não muda: o custo unitário e a conta do consumo do
   original, o intervalo do protocolo gravado (`intervalo_protocolo_dias`, conferido pela verificação), o fator e o
   movimento da entrada de estoque. A mesma aplicação no mesmo animal no mesmo dia pede `POSSIVEL_DUPLICIDADE` por animal,
   com a chave da importação.
7. **Agenda sanitária.** Aplicação única passada da idade máxima continua devida se o animal esteve na faixa depois da
   criação do protocolo; a cada N dias, nunca aplicada, vence desde que o animal ficou elegível (desde a segunda
   convergência, não antes de o protocolo passar a valer: item 17); na campanha, a perdida fica
   devida só até abrir a janela da seguinte; sem protocolo, a pendência vem da próxima informada na última dose do produto e
   é cumprida por qualquer aplicação posterior do mesmo produto, com ou sem protocolo. Tudo é calculado a cada consulta
   sobre os presentes na data.
8. **Reprodução.** Na exposição, os touros vão na mesma lista das fêmeas (linha TOURO); `touro_id` só quando o touro é
   único. O touro de fora (cobertura e sêmen) não tem linha. Parto entre a concepção e o diagnóstico positivo é a regra
   rígida `PARTO_NA_GESTACAO` (VALIDATION no lançamento, CONFLICT pelo outro lado); a prenhez que passa da previsão sem parto
   é alerta (`PRENHEZ_VENCIDA`) e conta como perda gestacional quando a janela fecha. A data contra a estação só é conferida
   no lançamento novo; a correção mantém a estação do original (desde a segunda convergência, só com a mesma data: item 17).
   Quem saiu no meio da estação: antes de um diagnóstico
   conclusivo, sai do denominador da prenhez; antes do fim da janela sem desfecho, sai dos da parição, natalidade, desmama e
   perda; a vazia descartada continua. A cobertura do diagnóstico sai sempre; abaixo de 90%, a prenhez passa a ser "entre
   diagnosticadas". A situação, a marca de descarte e os indicadores numa data D usam só os fatos até D, por uma função só
   (`Timeline.reproducaoEm`); a situação declarada na entrada (rebanho inicial, compra) vale como o fato da data da entrada.
   A faixa da idade da gestação pelo parâmetro `dias_gestacao` fica só no motor (o diagnóstico novo acima dela é recusado), e
   não na verificação, para que mudar o parâmetro não transforme um registro legítimo em fonte quebrada.
9. **Desmama, castração e ocorrência.** A cria é definida por DL-06; a categoria segue automática pelo cadastro; a linha
   do bezerro leva o movimento quando o pasto de destino é outro (desde a segunda convergência, o pasto informado fica
   gravado também com o bezerro já nele, com origem = destino: item 17); a linha MATRIZ e o registro DESMAMA saem uma vez por mãe
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
13. **Documentos da Fase 0 atualizados na etapa de documentação da entrega** (antes, as etapas não podiam mexer em `docs/fase-0/`): `08-ux-ui.md`,
    seção 5, e o desenho-base, seção 8 (o modo curral em blocos de 20 e o que a Fase 3 entregou dele: pesagem e tronco do
    diagnóstico); `01-arquitetura.md`, seção 6.2 (a página inicial e as telas sob demanda; o modo curral e o tronco nas
    telas `Weights` e `Reproduction`, não em `Components`); `10-plano-de-implementacao.md` (arquivos da Fase 3, a nota do
    E2.6 e o checklist da seção 8); `11-riscos-e-premissas.md` (R-08, R-14, R-23, R-24, R-30, R-31 e PR-06, PR-07, PR-10,
    PR-11). As decisões dos itens 2 a 10 que não contrariam um trecho da Fase 0 (completam o que ele deixava em aberto)
    ficam em `CONTRATOS.md`, para o dono ratificar (seção 3). Naquela etapa também foram corrigidos dois comentários de
    código desatualizados: o título da lista de cenários em `src/TestRunner.js` ("Fases 1 e 2" → "Fases 1 a 3") e o número
    de comandos da base de demonstração em `scripts/medir-trava.js`.
14. **Teste aleatório.** O registro único (gerador e oráculo de cada tipo e de cada importador) falha no `npm test` se um
    tipo ficar ativo sem a sua entrada. As sementes fixas passaram de 16 para 22 (57, 8, 1, 31, 56 e 262), cada uma porque,
    com os tipos novos no sorteio, nenhuma das anteriores aceitava algum subtipo exigido; na rodada 3, para 23 (a 29: com
    as interações novas, nenhuma das 22 chegava à correção tardia com o cadastro mudado). Nenhum teste foi relaxado.
15. **Revisão, rodadas 2 e 3** (`CONTRATOS.md`, seções 44 e 45; o motivo de cada uma está na seção 6 e no `CHANGELOG`):
    - **Fato congelado na correção, também a dose.** Na correção de uma aplicação por peso com o mesmo produto (ou nome
      livre), a mesma data, o mesmo modo e a mesma dose por kg, vale a dose gravada de cada animal; se um deles muda, a
      dose é refeita pelo peso na data, e a revisão diz qual das duas valeu. A entrada de estoque congela `com_movimento`
      (as gravadas antes desse campo são julgadas pela existência do movimento). Na correção de uma aplicação gravada sem
      custo, o custo daquele dia continua vazio, e a revisão diz isso.
    - **Contagem do estoque.** O acerto pela contagem continua sendo a diferença calculada no dia (03a,
      MOVIMENTOS_ESTOQUE; DL-15), e não um saldo absoluto no replay. O comando que mudaria o saldo de uma contagem vigente
      na posição dela é recusado com `CONTAGEM_POSTERIOR` e o caminho (estornar a contagem, lançar, contar de novo), em todo
      caminho; a verificação confere o saldo contado. A posição dentro do dia segue só a ordem de registro (premissa de
      11-riscos), sem a classe do evento: o movimento do mesmo dia gravado depois da contagem é aceito.
    - **Carência padrão do produto** (05, seção 4.8): sem os dias informados, `carencia_padrao_dias` do cadastro; o 0
      informado é "sem carência"; o nome livre e o registro de doença não têm padrão.
    - **Produto sem custo por unidade.** A regra de 03a, seção 4.6, e do desenho-base, 16.9, ficou (a compra vai para o
      estoque de insumos, e a aplicação sem custo não vira custo); o conserto foi o aviso na revisão da entrada e da
      aplicação.
    - **Agenda.** O protocolo vale desde o cadastro (no fuso da fazenda) ou, se antes, desde a primeira aplicação vigente
      com ele; numa data anterior, não gera pendência nem cobertura (05, RN-058). O vencimento segue 03a, seção 4.9: um
      vencimento contado do cadastro chegou a ser feito e foi desfeito, porque contrariava esse trecho.
    - **Peso.** A estimativa visual conta no peso médio e na UA numa parte própria, estimada e rotulada; a média do lote
      continua contando como pesada. O GMD da resposta do registro é o do intervalo da ficha, com `gmd_intervalo`.
    - **Na data D.** A cria ao pé, os partos (a conta da ficha), o brinco (com o número corrigido por
      IDENTIFICACAO_INCORRETA valendo desde o início do errado, desenho-base 16.2), a categoria e o último peso numa data
      passada usam só os fatos até ela. A fêmea apta com NAO_APTA gravado aparece como "Sem histórico reprodutivo" (03a,
      4.3.3; a projeção não muda, DL-05).
    - **Desmama.** A correção aceita a cria que o original já desmamava, mesmo depois de mudar a idade de desmama de
      referência. A morte ou venda retroativa da mãe posta na desmama é recusada com o caminho (estornar a desmama, gravar,
      desmamar de novo); a desmama não é mudada sozinha, porque isso alteraria outro evento gravado.
    - **Curral e tronco.** Com data passada, o animal é achado pelo brinco daquele dia na posição do servidor. Sem a
      posição por falta de sinal, a linha espera ("Tentar de novo"); sem a posição por motivo do servidor (antes do marco
      zero), o brinco é conferido pela lista de hoje e o servidor decide na gravação. O código interno só acha o animal
      sem brinco na data, escrito inteiro. Cada bloco guarda o cabeçalho de quando foi criado; a recusa que não é falta de
      sinal solta o bloco e vira pendência com a mensagem do servidor. O aviso geral do lançamento tem um "Está certo" só.
      A Início traz em segundo plano as telas do curral e do tronco, para abrirem depois sem sinal.
    - **Importação de sanidade.** Com a quantidade que saiu do frasco e uma linha já na base, as outras linhas ficam com
      `QUANTIDADE_EM_PARTE` (a quantidade é do lançamento inteiro).
16. **Convergência e revisão final** (`CONTRATOS.md`, seções 46 a 49; o motivo de cada uma está na seção 6.6 e no
    `CHANGELOG`):
    - **O estado numa data D.** Toda consulta numa data é função só dos fatos até D e dos cadastros que o desenho manda
      ler como estão hoje (a lista e as exceções estão na seção 6.6.2). O ponto único é o mesmo projetor do estado de
      hoje aplicado aos fatos até D (`Timeline.retratoEm`), e o custo de aquisição fica fora dele (03a, DL-08). A ficha de
      quem saiu usa a data da saída (a carência, a aptidão, a situação e a cria ao pé daquele dia); a volta ao rebanho a
      leva para hoje.
    - **O brinco na data, só no servidor.** Um resolvedor (`Identificacao`), com a regra da seção 6.6.3; a importação, o
      curral, o tronco, o seletor e as buscas usam só ele. Na importação, o número lançado errado não acha mais o animal
      (pede o código interno), e na compra a coluna do brinco é o número do animal comprado. **Contraria 08, seção 5** (o
      brinco resolvido "no store, sem ida"): é uma consulta por brinco digitado, e sem sinal a linha fica pendente.
    - **Recusas no curral e no tronco.** Só VALIDATION, NEEDS_CONFIRMATION e CONFLICT soltam o bloco, porque provam que a
      chave não foi gravada. IDEMPOTENCY_MISMATCH deixa a linha só com "Tirar". As demais deixam o bloco com a chave,
      sem confirmação. Isso muda a regra do item 15 (soltar em toda recusa que não fosse falta de sinal).
    - **A fila de lote.** Valem as garantias da seção 6.6.4 e a nova da revisão final: o bloco que saiu (no ar, sem sinal
      ou gravado) é intocável no aparelho, e "Mudar data" recusa mudar a sessão com bloco que saiu. A conferência do
      brinco vale só na data em que o servidor deu o animal.
    - **Revisão final.**
      - O protocolo restrito a uma categoria vence no dia em que o animal entrou na categoria.
      - Na correção com o mesmo produto, a carência, o nome e o fabricante vazios são os do original. A carência do
        original pode ser nenhuma, e o 0 informado é "sem carência".
      - O cadastro recusa trocar o procedimento de um protocolo já cumprido (`PROTOCOLO_EM_USO`).
      - O ano dos indicadores anuais depois do ano de D é recusado (`DATA_FUTURA`).
      - O bezerro que sai por DESCARTE antes da desmama conta à parte (`descartados_ao_pe`), fora da mortalidade.
      - O histórico de antes do marco zero cita o animal pelo número que ele tinha no marco zero.
17. **Segunda convergência** (`CONTRATOS.md`, seções 50 a 54; o motivo de cada uma está na seção 6.6.7 e no `CHANGELOG`):
    - **A correção passa por um ponto só** (`Correcao`):
      - A tabela do que ela mantém do original tem 23 valores.
      - Na entrada sem mudança, o que o servidor propôs vem vazio, e o que foi digitado vem como foi gravado. Quando o valor
        gravado não diz se foi digitado, o payload guarda uma marca (`doses_informadas`, `pasto_crias_informado`,
        `racas_informadas`, `quantidade_informada`, `carencia_informada`, `fabricante_informado`, `proxima_informada`).
      - Com outra entidade (outro produto, protocolo, mãe ou tipo de dedução), vale o cadastro de hoje da entidade nova.
      - A propriedade não tem marca: a cópia congelada só vale para o pedido que a omite.
      - A correção pode vir só com a mudança (`dados.mudanca`). Com dois dados do mesmo animal, a mudança sem o campo é
        recusada (`MUDANCA_AMBIGUA`), e tirar o que o lançamento não tem também (`MUDANCA_SEM_ITEM`).
    - **Regras de desenho que valem também na correção sem mudança** (seção 50.6):
      - a política BLOQUEIA, `PRODUTO_SEM_ESTOQUE` e o período fechado, aceito com a justificativa;
      - a linha de touro é de um macho: a verificação acusa a que não é (`TOURO_LINHA`), e a trava recusa a correção de
        cadastro que tiraria o sexo do touro de um lote;
      - o pasto informado só é conferido como desativado quando recebe animal;
      - com outra data, as conferências pelo estado de hoje voltam a valer.
    - **A cópia na mesma linha do lançamento é conferida pela verificação**, pela maioria das linhas: o cabeçalho da aplicação,
      a dose × a base do rateio, a soma das doses × a saída, o lote da saída, o rateio × o modo e o método da pesagem e da
      desmama. A trava recusa a correção do lançamento cuja fonte ela lê quebrada; o dono restaura o backup ou estorna e lança
      de novo.
    - **Reprodução** (muda o item 8):
      - o diagnóstico sem estação e o aborto são do dono da prenhez, a exposição mais recente da fêmea antes deles (a regra do
        parto), e um registro conta numa estação só;
      - a exposição em curso no parto ou no aborto continua no ciclo novo;
      - a previsão só pela exposição tem a tolerância;
      - a estação do original vale na correção só com a mesma data;
      - o aparelho não escolhe a estação do diagnóstico pela data.
    - **Agenda** (muda o item 7): o nunca aplicado vence no dia em que o protocolo passou a valer, isto é, o cadastro ou a
      primeira aplicação com ele, se antes.
    - **Sanidade e estoque** (muda o item 6):
      - a tela não preenche a carência: vazia, o servidor copia a do produto;
      - trocar o produto, o modo ou o protocolo troca na tela o que veio do anterior;
      - o lote e a validade da entrada só valem com o movimento (`CAMPO_NAO_SE_APLICA`);
      - a compra do insumo conta como uso do produto (`PRODUTO_EM_USO`);
      - o comando que tira o movimento de um dia contado é recusado pelo motor (`CONTAGEM_POSTERIOR`).
    - **Desmama e parto** (muda o item 9):
      - o pasto informado da desmama fica gravado também com o bezerro já nele;
      - o pasto do parto só de natimorto fica no payload, e esse parto grava a certeza do pai e não pede o pasto da mãe;
      - a raça da ficha não é desfeita pela correção do lançamento que criou o animal.
    - **Curral, tronco e rascunho:**
      - nenhum formulário sai sem a chave guardada no rascunho;
      - o rascunho no servidor vale pela versão;
      - a falha do rascunho aparece em qualquer tela, e ele vai de novo sozinho;
      - "Terminar" só termina com o rascunho do servidor apagado;
      - a recusa do servidor ao resolvedor não é falta de sinal, e a linha recusada espera o operador;
      - um bloco nunca leva o mesmo animal duas vezes.
    - **O cliente não calcula.** Um teste estático lê o código do aparelho, com uma lista de 11 exceções. O vencimento das
      parcelas vem da rota `financeiro.vencimentos`.

## 5. Limitações conhecidas

1. **Nada foi validado no ambiente real.** Valem as hipóteses dos fakes das Fases 1 e 2 (`CONTRATOS.md`, seção 6.5) e, na
   Fase 3: que o quadro do HtmlService rode o `<script>` da tela sob demanda injetado como nó (NV; contingência: voltar a
   tela ao `Index` e tirar `sob_demanda` do módulo — só cabe se a página inicial tiver espaço, item 3), o teclado numérico
   e o `localStorage` num celular de verdade com sinal fraco, os gráficos no quadro do HtmlService e, desde a convergência,
   o tempo da ida ao servidor por brinco digitado no curral e no tronco (seção 6.6.3).
2. **Modo curral só da pesagem** (e o tronco do diagnóstico, no mesmo padrão). O desenho (08, seção 5) o previa também
   para a sanidade, a desmama e a identificação: a sanidade ficou no formulário comum por decisão (item 6 da seção 4); a
   desmama e a identificação usam o formulário comum com o seletor, embora o catálogo ainda declare `modo_entrada: CURRAL`
   para elas (o cliente não usa esse campo). Dentro do curral não entraram "Colar brinco;peso" nem a grade "Todos do pasto"
   de 08, seção 5: o formulário comum da pesagem tem o seletor com "Todos do pasto", e a planilha entra pela importação.
3. **Orçamento da página inicial**: 428 KB de 450 KB. Sobram **22.573 bytes**. Na entrega eram 2.511; depois das rodadas
   2 e 3, 1.587; depois do resolvedor, 41; e depois da revisão final, 45. A segunda convergência tirou da página inicial a
   prévia da correção montada no aparelho, porque a tela passou a só formatar a entrada do servidor. A margem deixou de ser
   o aperto da fase, mas as telas das Fases 4 e 5 continuam tendo de nascer sob demanda: a página inicial guarda o que é
   do uso diário.
4. **Avisos e alertas que não existem**: `PESO_IMPLAUSIVEL` só na pesagem (os pesos da compra, da venda e do parto não são
   comparados com a pesagem anterior); nenhum alerta de animal sem pesagem há muito tempo (o peso vencido só aparece na
   lista e nas contas de lotação); a revisão do servidor no Registro mostra a reprodução, a desmama, a castração e a
   ocorrência pelo resumo genérico (`impactos.manejo` vem na resposta, sem bloco visual próprio).
5. **Importação de manejo**: a despesa paga no ato não tem coluna nos modelos; DESMAMA e CASTRACAO históricas não têm
   importador; a sanidade importada chega pouco à conclusão no teste aleatório (fica coberta sobretudo por
   `import.manejo.test.js` e pela varredura de quedas).
6. **Lançamentos gravados antes dos consertos da revisão.** As aplicações não têm `intervalo_protocolo_dias` no payload:
   se forem corrigidas, a próxima aplicação usa o intervalo atual do protocolo. As entradas de estoque não têm
   `com_movimento`: a apagada à mão continua indistinguível da compra feita antes de ligar o controle. A contagem seguida de
   um movimento retroativo anterior a ela passa a ser acusada pela verificação, e o caminho é estornar a contagem e contar
   de novo. Desde a segunda convergência, o payload guarda marcas do que foi digitado (seção 4, item 17). Nos lançamentos
   gravados antes delas, o valor é lido como proposto pelo servidor: a correção sem mudança o refaz como no registro. O parto
   só de natimorto gravado antes da etapa 1 não tem `pai_confianca`, e a correção sem mudança dele ainda pede "Pai é". Só
   pesa numa base com lançamentos da Fase 3 anteriores a 18/11/2026, que hoje só existe nos testes.
7. **Mensagens da trava** mostram o código interno do animal ("A-000001 (brinco 100)") e repetem a data no rótulo do
   evento ("Desmama de 01/08/2026" de 01/08/2026).
8. **Financeiro da Fase 4** continua como na Fase 2 (`RELATORIO_FASE2.md`, seção 5, item 2): o consumo do insumo e as
   despesas pagas no ato entram no financeiro do próprio evento; rateio por evento RATEIO, baixa de parcelas e resultado
   gerencial, na Fase 4. CT-03 passo 4 e CT-13 c a f seguem `NÃO SE APLICA`.
9. **Decisões da Fase 3 só em `CONTRATOS.md`**: as da seção 4, itens 2 a 10, 15, 16 e 17, precisam ser ratificadas pelo
   dono na próxima revisão dos documentos da Fase 0. Quase todas completam a Fase 0 sem contrariá-la; uma do item 16
   contraria (o brinco resolvido sempre no servidor, contra 08, seção 5) e ainda não foi levada ao desenho. As do item 17
   mudam regras dos itens 6 a 9 sem contrariar um trecho da Fase 0.
10. **Desempenho não medido no Apps Script**: a agenda calcula tudo sobre os presentes na data a cada consulta, os
    indicadores refazem a estação, as consultas numa data passada calculam o retrato de cada animal que mostram, e a
    trava confere também os fatos novos. No Node, com a base de demonstração da Fase 3 (`npm run trava:medir --
    --vezes 3`, nesta etapa, sem outro processo rodando): 430 comandos (a base inteira com os cadastros; 304 cabeças),
    média de 176,4 ms por comando (p50 172,8 ms; p95 382,6 ms), dos quais 23,7 s de 75,9 s (31%) na trava; mediana de 3
    execuções, que variaram de 174,3 a 188,9 ms de média. Com a mesma base, as medidas anteriores foram:
    - no relatório da primeira convergência, 167,8 ms (21,3 s de 72,2 s na trava);
    - na etapa das rodadas 2 e 3, 147,8 ms (18,9 s de 63,6 s);
    - na entrega, 121,3 ms (15,1 s de 52,2 s).

    Com a segunda convergência, a mediana ficou cerca de 5% mais lenta: +11% dentro da trava, que passou a conferir também
    a cópia na mesma linha do lançamento e a linha de touro, e +2% fora dela. A diferença fora da trava está na ordem da
    variação entre execuções. A parte de cada conserto não foi medida. No fim da Fase 2, com a base
    de demonstração de então (391 comandos, sem o manejo), a média era 53,1 ms: a base cresceu (pesagens, aplicações,
    estoque, estações), e as duas medidas não comparam bases iguais. O tempo de cada comando cresce com o tamanho da
    base, e no Sheets a leitura das abas se soma a isso. No Google Sheets, nada disso foi medido.
11. **Teste aleatório** (seções 6.1 e 6.6):
    - Os indicadores reprodutivos têm modelo só das expostas e da coerência das contagens e taxas (não das
      diagnosticadas, prenhas, paridas, perdas e desmamas; o descarte ao pé, do achado 10 da revisão final, só no teste
      fixo). A previsão de parto e os alertas `PARTO_PREVISTO` e `PRENHEZ_VENCIDA` não têm oráculo. O relógio do pedido no
      passado vale só para `protocolo.salvar`. Desde a revisão final, os protocolos com categoria estão no modelo da
      agenda.
    - Alguns encontros continuam raros: a venda direta na carência para recria, a reprodução na estação pela interação e
      a venda no mesmo dia da pesagem. Na leva final da revisão final, não apareceram a troca do procedimento de um
      protocolo já cumprido nem a correção tardia barrada pela carência do próprio original (ficam nos testes fixos).
    - Os oráculos das rodadas 2 e 3 e da convergência não foram medidos com mutações.
    - O oráculo de viagem no tempo compara respostas do servidor numa bateria de consultas (seção 6.6.2). Ficam fora:
      o aparelho; o que a correção de um fato passado grava; os elegíveis de outros tipos além de TRANSFERENCIA,
      PESAGEM e NASCIMENTO; o filtro por propriedade; as curvas do desempenho; o ano depois de D; e a ficha de quem
      está no rebanho numa data passada.
    - O teste aleatório da tela (seção 6.6.4) cobre o curral e o tronco. Não cobre o "Pesar este" da lista dos que
      faltam, vários animais com o mesmo número na mesma data, duas abas abertas e o celular. A decisão do repetido
      refeita no meio não apareceu nas 50 sementes da revisão final.
    - O oráculo da correção (seção 6.6.7) confere a correção de um campo só na anotação, no responsável, na observação de
      um animal, na data, na dose por kg, na dose digitada, num dado da correção de cadastro e na raça da ficha. A troca de
      entidade (outro produto, protocolo, mãe ou tipo de dedução) e a mudança das entradas dos derivados ficam nos testes
      fixos, e o plano de contas não é variado. Ele supõe a fonte intacta: a adulterada fica com a verificação.
    - Os oráculos da segunda convergência também não foram medidos com mutações. O que o oráculo da correção enxerga foi
      visto pelo que ele achou: os 11 defeitos da etapa 1.
    - O teste "o cliente não calcula" lê nomes: a conta com variáveis de nome neutro passa, e a escolha de um valor pelo dado
      de hoje, sem conta, não é vista (achados 7 e 8 da rodada 2 da segunda convergência).
    - O do motor roda no harness Node e o da tela no Chromium do Playwright com o mock; nenhum roda no Apps Script.
12. **Bases antigas** podem mostrar achados novos na verificação depois de atualizar o código:
    - a cópia do peso das pesagens de entrada, compra, venda e parto (COPIAS, sem reparo);
    - desde a segunda convergência, a cópia na mesma linha do lançamento: o cabeçalho da aplicação, a dose × a base do rateio,
      a soma das doses × a saída, o lote da saída, o rateio × o modo e o método da pesagem e da desmama;
    - a linha de touro que não é de um macho (`TOURO_LINHA`).

    O problema antigo não bloqueia os comandos que não o pioram. A trava recusa a correção do lançamento cuja fonte ela lê
    quebrada; nesse caso, o caminho é restaurar o backup ou estornar e lançar de novo.
13. **Revisão sem convergência demonstrada** (seções 6.5, 6.6.6 e 6.6.7). Foram seis revisões: três rodadas, a revisão
    final e duas rodadas na segunda convergência. Elas tiveram 29, 25, 25, 17, 17 e 17 achados (14, 8, 5, 7, 7 e 10 altos). A
    última, depois da segunda convergência, não terminou sem achado alto: teve 10. Os 17 consertos dela não passaram por outra
    revisão. A parte dos achados que era conserto incompleto ou regressão, pelo título, foi de 40%, 52%, 47%, 12% e 47%.
14. **Continuam valendo** as limitações da Fase 2 que esta fase não tocou (`RELATORIO_FASE2.md`, seção 5): itens 2 a 6,
    11 (parte da importação e da integridade), 13, 14, 17 a 19 e 21. Ficaram resolvidas: a carência depende da SANIDADE
    real (item 8), a importação de pesagens, sanidade, reprodução e ocorrências (parte do item 7), o modo curral da pesagem
    (parte do item 9; o da identificação continua no item 2 acima) e o orçamento da página com as telas sob demanda (item
    12, agora item 3 acima).
15. **Curral e tronco, resíduos.**
    - Na recusa `IDEMPOTENCY_MISMATCH` (a chave já está gravada com outro conteúdo), a linha fica só com "Tirar" e pede
      para conferir em Eventos: o curral não confere sozinho o que foi gravado.
    - O bloco que recebe falha interna repetida fica com a chave, sem confirmação, e impede o "Terminar" até o servidor
      responder (a decisão das recusas, seção 6.6.4).
    - Sem sinal, o brinco digitado não é conferido: a linha fica pendente até o servidor responder, e nunca é resolvida
      pela lista do aparelho.
    - Sem `localStorage`, o que foi digitado e não chegou ao rascunho do servidor se perde quando a página vai embora de
      repente; nada é gravado a mais. O bloco gravado que o rascunho ainda diz "enviando" volta "sem confirmação" e é
      conferido pela chave. "Terminar" só termina com o servidor confirmando a remoção do rascunho.
    - A linha "recusada pelo servidor" (a recusa do resolvedor, como a data futura) não se resolve sozinha com a rede de
      volta: o operador a tira, corrige o brinco ou muda a data.
    - A pré-carga das telas do curral e do tronco na Início, o "Tentar de novo" e a conferência das pendentes só foram
      exercitados no Playwright, com o mock de `google.script.run`.
16. **O custo das consultas numa data e da ida ao servidor.** O retrato numa data passada é calculado só para o animal
    que a consulta mostra. Na base de demonstração, numa data de 2025, os elegíveis calculam 294 retratos, a lista de
    fêmeas 138, o desempenho 360 e a agenda 18 (registro da etapa 1). No Apps Script isso não foi medido, nem o tempo
    da consulta por brinco no curral e no tronco (uma por brinco, guardada por versão dos dados, data e tipo).

## 6. Revisão adversarial

### 6.1 Teste aleatório baseado em modelo

O teste aleatório da convergência da Fase 2 (`tests/apoio-fuzz.js`, `tests/fase2.fuzz.test.js`) passou a cobrir todos os
comandos das Fases 1 a 3: cada tipo e importador declara o gerador e o oráculo do efeito no registro único, e depois de
cada passo o estado inteiro é conferido (integridade sem erro, projeção = reconstrução, financeiro fechado, replays
independentes do peso atual, do estoque, da situação reprodutiva, da castração e da cria ao pé, a agenda e o GMD por
modelos próprios, os avisos de transição de estoque e de carência, a chave do bloco do curral e do tronco). As rodadas 2 e
3 da revisão acrescentaram oráculos para o que acharam: a dose por peso congelada na correção, a cria ao pé de cada fêmea
hoje e numa data passada, o GMD da resposta do registro igual ao do intervalo do modelo (e o próprio intervalo), a agenda
só com o protocolo que já valia e o dia do cadastro no fuso da fazenda, a carência padrão do produto, a contagem do
estoque pela posição no dia, as próximas doses da ficha iguais às da agenda, os partos da lista de Fêmeas iguais aos da
ficha, o rótulo único dos pastos e o último peso na data em `inventario.elegiveis`. As sementes fixas passaram a 23 (entrou
a 29) e exigem que esses oráculos confiram algo. A convergência acrescentou o oráculo de viagem no tempo e o do
resolvedor (seção 6.6), e a revisão final, o modelo da agenda com protocolo por categoria, as cópias do original no efeito
da correção e o procedimento do protocolo em uso. A segunda convergência acrescentou o oráculo da correção (seção 6.6.7), e as
rodadas dela estenderam esse oráculo e o modelo dos indicadores (cada registro numa estação só). Nenhum desses oráculos mudou
as sequências das sementes fixas, porque todos sorteiam por um gerador à parte.

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
| Revisão, rodada 2 | 600 × 100 (1950000 a 1950299, antes da reconferência da agenda; 1960000 a 1960299, no código final) | 35.116 / 19.883 | 0 | 0 |
| Revisão, rodada 3 | 628 × 100 (2030000 a 2030011 e 2031000 a 2031015, de prova; 2040000 a 2040299, com o gerador intermediário; 2050000 a 2050299, com o gerador final) | 34.777 / 20.212 (as 600 de 300) | 0 | 0 |
| Convergência, viagem no tempo | 1.320 × 100 (3110000 a 3110039, de busca, com o código de antes dos consertos; 3120000 a 3120079; 3400000 a 3400999, com o código final congelado; 3500000 a 3500199, leva limpa) | 76.713 / 43.736 | 13 (6 classes, todas na leva de busca; seção 6.6.2) | 3 (3110020 e 3110034: a volta ao rebanho leva a ficha para hoje; 3400390: o estorno imediato com a política do estoque) |
| Convergência, resolvedor | 200 × 100 (3600000 a 3600199) | 11.651 / 6.731 | 0 | 0 |
| Conserto da revisão final | 340 × 100 (3700000 a 3700039, de busca, com o código intermediário; 3800000 a 3800299, com o código final) | 20.021 / 11.278 | 0 | 0 |
| Relatório da primeira convergência: confirmação | 100 × 100 (3900000 a 3900099) | 5.878 / 3.290 | 0 | 0 |
| Segunda convergência, correção | 2.392 × 100 (610000 a 610999, de busca; 284 a partir de 611000 e 108 a partir de 612000, de confirmação; 613000 a 613999, leva limpa) | 117.344 / 66.317 (a busca e a leva limpa) | 10 (8 na busca e 2 nas confirmações; seção 6.6.7) | 0 |
| Segunda convergência, rodada 1 | 300 × 100 (7600000 a 7600299, refeita do começo; as levas interrompidas pelo reinício e pela lacuna do oráculo não contam) | 17.395 / 9.949 | 0 | 4 (720043, 720208 e 720241: a impressão do protocolo no oráculo do tempo; 7600019: a recusa da dose por kg) |
| Segunda convergência, rodada 2 | 300 × 100 (7700000 a 7700299) | 18.273 / 9.577 | 0 | 0 |
«LINHA_ESTA_ETAPA»
| **Total** | **8.288 sementes novas** | | **13** | **8** |

Cada falha do modelo virou caso fixo (`tests/fase3.fuzz.regressoes.test.js`, `tests/import.manejo.test.js` ou
`tests/tempo.regressoes.test.js`), que falha no modelo de antes. A leva de 1.000 sementes 3200000 a 3200999 da viagem no
tempo abortou com uma edição do `src/` no meio e foi descartada (seção 6.6.2); não está na tabela. O teste aleatório da
tela do curral e do tronco tem as suas levas na seção 6.6.4. As 24 recusas da trava conferidas uma a uma na passada 1 (160 sementes) são todas de regras que ela
guarda por desenho (castração repetida pela correção do rebanho de base, registro reprodutivo de quem passaria a macho,
pasto desativado, mãe de cria desmamada). O que os oráculos novos enxergam foi medido com mutações numa cópia do projeto
(`src/` errado de propósito): sem o aviso de estoque e com a dose em duas casas, 20 de 32 sementes falham; a campanha
perdida esquecida, 30 de 30; a cria ao pé que não sai com a desmama, 6 de 30 (a verificação de integridade não vê); o
cadastro do original deixando de valer na correção, 6 de 30; depois da revisão, o custo e a entrada não congelados na
correção, 6 de 40; sem a recusa do custo em dobro, 2 de 40.

**O que esta tabela não mostra.** Nenhuma das 4.480 sementes de antes da rodada 1 achou defeito do sistema, e a rodada 1
da revisão independente achou 29 logo depois. Os oráculos conferem a coerência interna (o que foi gravado bate com a
reconstrução, com a integridade e com o efeito pedido) e algumas regras por modelo próprio; os defeitos da revisão eram de outra natureza: a regra certa num
caminho e ausente noutro (a correção que reprecifica, o curral que calcula o GMD diferente da ficha), indicador numa data
passada com fatos de depois, tela que perde a recusa. Depois da revisão, os oráculos da correção congelada e do custo em
dobro passaram a existir e pegam o defeito reintroduzido (6 e 2 de 40 sementes).

O mesmo se repetiu depois: as 620 sementes do conserto da rodada 1 não acharam defeito do sistema, e a rodada 2 achou 25
(8 altos); as 600 do conserto da rodada 2 também não, e a rodada 3 achou 25 (5 altos). As 628 do conserto da rodada 3
também não acharam nenhum; o que veio depois (a convergência, que achou 13 falhas do sistema pelo oráculo novo, e a
revisão final) está na seção 6.6. Os oráculos novos das rodadas 2 e 3, ao contrário dos da
rodada 1, não foram medidos com mutações. O que se sabe deles é quanto conferiram na leva final da rodada 3 (`FUZZ_COBERTURA=1`, 300 sementes, pelo registro da rodada): 22
aplicações com a carência do cadastro; 26 interações da carência e 13 do movimento depois da contagem (2 com a contagem
corrigida e um movimento do mesmo dia gravado depois); 1.749 GMD de resposta conferidos (6 com o intervalo começando antes
da pesagem anterior); 40.903 conferências da ficha contra a agenda, 34.481 dos partos e 52.478 do último peso na data.

Na segunda convergência, o padrão mudou em parte. O oráculo da correção achou 11 defeitos do sistema: 10 nas sementes novas da
tabela e 1 nas sementes fixas (seção 6.6.7). As 600 sementes das duas rodadas não acharam nenhum, só duas lacunas do próprio
oráculo, e as duas revisões acharam 34 logo depois. O teste aleatório da tela, estendido em cada rodada, achou mais 5 defeitos
do sistema que a revisão não tinha apontado.

### 6.2 Revisão independente da Fase 3, rodada 1

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

**Correções incompletas.** Pela leitura dos achados na etapa de documentação da entrega (classificação daquela etapa, não
da revisão), 12 dos 29 eram a
lição da Fase 2 de novo: a regra certa num caminho e ausente noutro — a correção que não congelava o que o registro
congelou (3, 6, 7), o curral que não usava a conta da ficha (5), os indicadores que não usavam a regra da projeção (9), a
quarentena que não alcançava o saldo (13), a duplicidade que o formulário e a importação tratavam e o lote misto não (17), o
curral que não tinha o conserto do seletor com data passada (22), a carência que dependia da ordem da importação (23), a
edição que não lia a aba que a lista lê (24), o lote importado que se comparava com a pesagem individual (26) e o gráfico
que juntava o que o servidor separava (18).

A rodada 2 achou incompletos 5 desses 28 consertos: o fato congelado na correção (3 e 6: a dose por peso ainda era
refeita), o GMD do curral (5), o bloco criado na hora de sair (12: o "Desfazer o último" deixava a linha órfã), a
quarentena do saldo (13: a entrada apagada à mão não era fonte quebrada) e o curral com data passada (22: o brinco de
hoje). Quatro deles eram de gravidade alta.

### 6.3 Revisão independente da Fase 3, rodada 2

A rodada 2 examinou os consertos da rodada 1 e os caminhos que eles tocam, com quatro lentes (a de REGRESSÕES passou a
se chamar CORREÇÕES ANTERIORES). Achou **25** (8 altos, 15 médios e 2 baixos). Seis grupos são o mesmo defeito visto por
mais de uma lente (1 e 4; 2 e 5; 6 e 11; 13 e 21; 15 e 23; 7, 16 e 22): **18 distintos**, 6 deles altos. Todos foram
**CORRIGIDOS**; nenhum foi refutado nem adiado. No achado 9, o conserto foi o aviso: a regra de 03a, seção 4.6, e do
desenho-base, 16.9, ficou (seção 4, item 15). Cada achado tem teste por caminho em `tests/revisao2.fase3.motor.test.js`,
`tests/revisao2.fase3.zootecnia.test.js` e `tests/ui/revisao2.fase3.test.js`. Os 14 testes de Node e os 10 de navegador
falham numa cópia com o `src/` do commit `e056bf6`, o da entrega, e passam agora: a rodada registrou isso, e esta etapa
conferiu de novo (os testes de hoje sobre o `src/` de lá: 14 de 14 e 10 de 10 falham, por asserção ou pela espera de um
elemento que a tela de então não tinha).
Teste aleatório da rodada: 600 sementes novas, nenhuma falha (seção 6.1).

| Lente | ALTA | MÉDIA | BAIXA | Total |
|---|---:|---:|---:|---:|
| ZOOTECNIA E CUSTO | 2 | 4 | 0 | 6 |
| MOTOR | 4 | 2 | 0 | 6 |
| INTERFACE E REGRAS | 1 | 6 | 2 | 9 |
| CORREÇÕES ANTERIORES | 1 | 3 | 0 | 4 |
| **Total** | **8** | **15** | **2** | **25** |

| # | Gravidade | Lente | Achado | Decisão |
|---:|---|---|---|---|
| 1 | ALTA | ZOOTECNIA | Conserto incompleto do fato congelado (achados 3 e 6 da rodada 1): corrigir uma aplicação por peso refazia a dose, a saída do estoque e o custo com dados de hoje (pesagem lançada depois, peso de referência ou validade mudados) | Corrigido: a dose gravada de cada animal quando o produto, a data, o modo e a dose por kg não mudam (`EventService.doseDoOriginal_`); a revisão diz qual dose valeu |
| 2 | ALTA | ZOOTECNIA | Aplicação retroativa anterior a uma contagem de estoque descontava de novo o que a contagem já tinha tirado, sem aviso e sem achado da integridade | Corrigido: `CONTAGEM_POSTERIOR` com o caminho (estornar a contagem, lançar, contar de novo) em todo caminho; a verificação confere o saldo contado |
| 3 | ALTA | MOTOR | Importação de sanidade: a linha DUPLICADA saía, mas a quantidade do frasco ficava inteira (estoque e consumo em dobro) | Corrigido: as outras linhas ficam com `QUANTIDADE_EM_PARTE` |
| 4 | ALTA | MOTOR | O mesmo do 1 (conserto incompleto do custo congelado), visto pela correção só do veterinário | Corrigido com o 1 |
| 5 | ALTA | MOTOR | O mesmo do 2, visto pelo acerto da contagem | Corrigido com o 2 |
| 6 | ALTA | MOTOR | `reproducao.matrizes` numa data passada: cria ao pé sempre "não" e o indicador "Com cria ao pé" zerado | Corrigido: `Timeline.criaAoPeEm`, só com os fatos até a data |
| 7 | ALTA | INTERFACE | Conserto incompleto do achado 22 da rodada 1: curral e tronco com data passada achavam o animal pelo brinco de hoje: com o número trocado e reusado depois, a pesagem ia para outro animal | Corrigido: o brinco daquele dia na posição do servidor (`Timeline.brincoEm`, `brinco_hoje`) |
| 8 | ALTA | CORREÇÕES ANTERIORES | Conserto incompleto do achado 13 da rodada 1: a entrada de estoque apagada à mão era "projeção divergente" reparável, e o lançamento seguinte regravava o saldo pela fonte adulterada | Corrigido: a entrada congela `com_movimento`; sem o movimento previsto, fonte quebrada sem reparo e quarentena |
| 9 | MÉDIA | ZOOTECNIA | Produto do cadastro sem custo por unidade: o insumo pago nunca virava custo, e nada avisava | Corrigido como aviso na revisão da entrada e da aplicação (a regra fica) |
| 10 | MÉDIA | ZOOTECNIA | Agenda numa data passada contava protocolo cadastrado depois dela | Corrigido: `inicio_vigencia` (o cadastro ou a primeira aplicação com o protocolo); o vencimento segue 03a, 4.9 |
| 11 | MÉDIA | ZOOTECNIA | O mesmo do 6, visto pela lista de fêmeas | Corrigido com o 6 |
| 12 | MÉDIA | ZOOTECNIA | Peso médio e UA tratavam a estimativa visual como pesagem | Corrigido: parte própria da UA, estimada e rotulada |
| 13 | MÉDIA | MOTOR | Conserto incompleto do achado 5 da rodada 1: a resposta do registro (curral) deixava o GMD vazio, com explicação falsa, em pesagens que a ficha calcula | Corrigido: o intervalo da ficha que termina na pesagem, ou o porquê verdadeiro |
| 14 | MÉDIA | MOTOR | Depois de mudar a idade de desmama de referência, corrigir uma desmama legítima era recusado (`NAO_E_CRIA`) | Corrigido: a cria que o original já desmamava continua aceita |
| 15 | MÉDIA | INTERFACE | "Desfazer o último" num bloco com aviso deixava a linha avisada órfã e dizia que a pesagem "já foi enviada" | Corrigido: as outras linhas voltam à fila, e a mensagem diz o que aconteceu |
| 16 | MÉDIA | INTERFACE | O mesmo do 7 (conserto incompleto do achado 22): tronco e "Corrigir o brinco" conferiam situação e pasto pela posição de hoje | Corrigido com o 7 |
| 17 | MÉDIA | INTERFACE | Curral: o animal sem brinco nunca era achado | Corrigido: pelo código interno e por "Pesar este" |
| 18 | MÉDIA | INTERFACE | Curral e tronco (telas sob demanda) não abriam sem sinal | Corrigido: a Início traz as duas telas em segundo plano e avisa quando não vieram |
| 19 | MÉDIA | INTERFACE | Desempenho: as pesagens e o GMD de lote ignoravam os filtros | Corrigido: o filtro na data da pesagem |
| 20 | MÉDIA | INTERFACE | Conserto incompleto do achado 5 da rodada 1: a linha do curral mostrava o ganho contra pesagem estimada como medido | Corrigido: "contra peso estimado" e o porquê do GMD vazio |
| 21 | MÉDIA | CORREÇÕES ANTERIORES | O mesmo do 13 (conserto incompleto do achado 5 da rodada 1) | Corrigido com o 13 |
| 22 | MÉDIA | CORREÇÕES ANTERIORES | O mesmo do 7, no diagnóstico do tronco (conserto incompleto do achado 22 da rodada 1) | Corrigido com o 7 |
| 23 | MÉDIA | CORREÇÕES ANTERIORES | O mesmo do 15: regressão do conserto do achado 12 da rodada 1 | Corrigido com o 15 |
| 24 | BAIXA | INTERFACE | Indicadores por categoria: o gráfico dizia "(parcial)" e a tabela logo abaixo não | Corrigido |
| 25 | BAIXA | INTERFACE | Curral e tronco: o aviso geral de duplicidade pedia um "Está certo" em cada linha do bloco | Corrigido: um "Está certo (todo o lançamento)" só |

A rodada 3 achou incompletos ou desfeitos 10 desses 18 consertos: o brinco na data (7, 16 e 22: sem sinal, o estado de
hoje na conferência, o número lançado errado), o código interno (17: regressão), o GMD do curral (13 e 21) e o ganho na
linha do curral (20), que punham intervalos diferentes lado a lado, o "(parcial)" (24: a lista da estação), a contagem (2 e 5: regressão, todo
movimento do mesmo dia recusado), a entrada congelada (8: a revisão da correção), o produto sem custo (9: a correção), a
agenda (10: regressão, a data UTC do cadastro) e a estimativa visual (12: o texto do aviso de lotação). Três deles eram
de gravidade alta (2 e 5, 7, 8).

### 6.4 Revisão independente da Fase 3, rodada 3

A rodada 3 examinou os consertos da rodada 2 com as mesmas quatro lentes. Achou **25** (5 altos, 14 médios e 6 baixos).
Três pares são o mesmo defeito (8 e 25; 11 e 18; 21 e 23): **22 distintos**, todos os 5 altos distintos. Todos foram
reproduzidos e **CORRIGIDOS**; nenhum foi refutado nem adiado. Cada achado tem teste por caminho em
`tests/revisao3.fase3.motor.test.js`, `tests/revisao3.fase3.zootecnia.test.js` e `tests/ui/revisao3.fase3.test.js`. Os 14
testes de Node e os 13 de navegador falham numa cópia com o `src/` do commit `f2cb5fb`, o de antes da rodada, e passam
agora (registrado pela rodada e conferido de novo nesta etapa: 14 de 14 e 13 de 13 falham lá). Teste aleatório da rodada: 628 sementes novas, nenhuma falha (seção 6.1).

| Lente | ALTA | MÉDIA | BAIXA | Total |
|---|---:|---:|---:|---:|
| ZOOTECNIA E CUSTO | 0 | 4 | 1 | 5 |
| MOTOR | 1 | 3 | 1 | 5 |
| INTERFACE E REGRAS | 3 | 3 | 1 | 7 |
| CORREÇÕES ANTERIORES | 1 | 4 | 3 | 8 |
| **Total** | **5** | **14** | **6** | **25** |

| # | Gravidade | Lente | Achado | Decisão |
|---:|---|---|---|---|
| 1 | ALTA | MOTOR | A importação de sanidade ignorava a carência do produto do cadastro: a aplicação ficava sem carência, e a venda para abate dentro dela passava sem `CARENCIA_ATIVA` | Corrigido: sem os dias informados, `carencia_padrao_dias` do produto, em todo caminho (05, 4.8) |
| 2 | ALTA | INTERFACE | Curral e tronco: "Mudar data, método ou pasto/estação" continuava depois de um bloco sair; o reenvio virava `IDEMPOTENCY_MISMATCH`, aparecia como "sem sinal" e travava a sessão | Corrigido: o botão some com bloco enviado; cada bloco guarda o cabeçalho de quando foi criado; a recusa inesperada vira pendência com a mensagem do servidor |
| 3 | ALTA | INTERFACE | Conserto incompleto dos achados 7, 16 e 22 da rodada 2: com data passada e sem a posição (sem sinal), o brinco era resolvido pela posição de hoje, e a tela dizia que "o servidor confere na gravação" | Corrigido: a linha fica pendente (`SEM_POSICAO`) com "Tentar de novo" e é conferida quando a posição chega |
| 4 | ALTA | INTERFACE | Tronco: com "v" ou "d" no campo, o botão "Prenhe" gravava vazia ou duvidosa | Corrigido: o botão grava prenhe; do campo só vem a idade da gestação |
| 5 | ALTA | CORREÇÕES ANTERIORES | Regressão do conserto do achado 17 da rodada 2: um brinco inexistente escrito "A<n>" ou "0nnnnn" caía no animal com esse código interno e outro brinco, e a pesagem ia para ele | Corrigido: o código só escrito inteiro e só para o animal sem brinco na data |
| 6 | MÉDIA | ZOOTECNIA | Ficha: as próximas doses contavam a entrada pela data declarada (vazia = hoje), e o nunca vacinado do rebanho inicial "vencia hoje" todo dia | Corrigido: a entrada da linha do tempo, a mesma da agenda |
| 7 | MÉDIA | ZOOTECNIA | Lista de Fêmeas: somava os partos prévios declarados com os registrados antes da entrada (2 partos; a ficha dizia 1) | Corrigido: `contarPartos`, a conta da ficha |
| 8 | MÉDIA | ZOOTECNIA | Conserto incompleto dos achados 20 e 21 da rodada 2: a linha do curral juntava o ganho contra a anterior com o GMD de outro intervalo | Corrigido: `gmd_intervalo`, e o GMD escrito com o intervalo dele |
| 9 | MÉDIA | ZOOTECNIA | Conserto incompleto dos achados 7, 16 e 22: curral com data passada descrevia o animal pelo estado de hoje (inclusive uma pesagem posterior à data) | Corrigido: categoria e último peso na data em `inventario.elegiveis` |
| 10 | MÉDIA | MOTOR | `ANIMAIS.mae_id` mexido à mão virava fonte quebrada e impedia o reparo | Corrigido: a mãe pela reconstrução; o achado é de PROJECAO, reparável |
| 11 | MÉDIA | MOTOR | Conserto incompleto dos achados 7, 16 e 22: a posição numa data passada dava o brinco lançado errado (IDENTIFICACAO_INCORRETA) | Corrigido: `Timeline.brincoEm` põe a correção desde o início do número errado (16.2) |
| 12 | MÉDIA | MOTOR | Morte ou venda retroativa da mãe recusada pela linha MATRIZ da desmama, com um conselho que não levava à solução | Corrigido: a recusa dá o caminho (estornar a desmama, gravar, desmamar de novo) |
| 13 | MÉDIA | INTERFACE | Conserto incompleto do achado 24: a lista da estação não dizia "parcial" na natalidade e dava motivo falso na desmama | Corrigido: "(parcial)" com o motivo do servidor |
| 14 | MÉDIA | INTERFACE | Desempenho: dois pastos com o mesmo nome viravam um item só nos gráficos | Corrigido: `rotulo` único por pasto |
| 15 | MÉDIA | INTERFACE | "Comparar a curva" recusava o brinco inteiro de uma vaca com bezerro sem brinco | Corrigido |
| 16 | MÉDIA | CORREÇÕES ANTERIORES | Regressão do conserto dos achados 2 e 5: depois da contagem, todo movimento do produto no mesmo dia era recusado | Corrigido: a contagem vale na posição dela dentro do dia (ordem de registro) |
| 17 | MÉDIA | CORREÇÕES ANTERIORES | Conserto incompleto do achado 8: a revisão da correção de uma entrada sem movimento dizia "Entra no estoque" | Corrigido: `fora_do_estoque` segue o `com_movimento` congelado |
| 18 | MÉDIA | CORREÇÕES ANTERIORES | O mesmo do 11 (conserto incompleto dos achados 7, 16 e 22) | Corrigido com o 11 |
| 19 | MÉDIA | CORREÇÕES ANTERIORES | Conserto incompleto do achado 9: a correção de uma aplicação gravada sem custo mandava preencher o custo já preenchido | Corrigido: `porque_sem_custo` explica que a correção mantém o custo daquele dia |
| 20 | BAIXA | ZOOTECNIA | Lista de Fêmeas: a novilha apta e contada nas matrizes ativas aparecia como "Não apta" | Corrigido: "Sem histórico reprodutivo" |
| 21 | BAIXA | MOTOR | O protocolo passava a valer pela data UTC do cadastro e sumia da agenda do dia quando cadastrado à noite | Corrigido: o fuso da fazenda (e na mensagem de arquivo repetido da importação) |
| 22 | BAIXA | INTERFACE | A linha do curral não dizia por que o GMD ficou vazio com a anterior medida | Corrigido |
| 23 | BAIXA | CORREÇÕES ANTERIORES | O mesmo do 21: regressão do conserto do achado 10 | Corrigido com o 21 |
| 24 | BAIXA | CORREÇÕES ANTERIORES | Consequência do conserto do achado 12: o aviso de lotação dizia "peso de referência" quando a parte estimada era estimativa visual | Corrigido: o rótulo da composição (`ua.rotulo`) |
| 25 | BAIXA | CORREÇÕES ANTERIORES | O mesmo do 8 (conserto incompleto dos achados 13, 20 e 21) | Corrigido com o 8 |

Nenhuma rodada examinou só estes 25 consertos; a revisão final (seção 6.6.5) examinou o código depois deles e da
convergência.

### 6.5 Balanço das três rodadas, antes da convergência

Esta seção é o balanço feito no fim da rodada 3 e fica como registro. Parte do que ela dá como aberto mudou depois: a data sem
posição já não é conferida pela lista de hoje, e a margem da página inicial caiu de 1.587 para 45 bytes. O estado de hoje está
na seção 6.6.6.

| Rodada | Achados | Distintos | ALTA | MÉDIA | BAIXA | Conserto incompleto ou regressão da rodada anterior (pelo título do achado) |
|---|---:|---:|---:|---:|---:|---:|
| 1 (a entrega) | 29 | 28 | 14 | 10 | 5 | — |
| 2 (os consertos da 1) | 25 | 18 | 8 | 15 | 2 | 10 (40%) |
| 3 (os consertos da 2) | 25 | 22 | 5 | 14 | 6 | 13 (52%) |
| **Total** | **79** | **68** | **27** | **39** | **13** | **23** |

- **A última rodada não terminou sem achado alto.** A rodada 3 achou 5: a carência do cadastro ignorada na importação de
  sanidade, a sessão do curral travada por `IDEMPOTENCY_MISMATCH`, o brinco resolvido pela posição de hoje sem sinal, o
  botão "Prenhe" que gravava vazia e o código interno que achava o animal errado. Todos foram corrigidos com teste, e
  **nenhuma revisão examinou esses consertos**.
- **O que melhora e o que não melhora.** Os altos caíram (14, 8, 5), mas o total não caiu (29, 25, 25), e a parte dos
  achados que são conserto incompleto ou regressão da rodada anterior subiu (40% e 52%), como na Fase 2 (0%, 5%, 35% e
  55%). A rodada 2 achou incompletos 5 dos 28 consertos da rodada 1 (18%); a rodada 3, 10 dos 18 da rodada 2 (56%)
  (seções 6.2 e 6.3). Mais da metade dos consertos da rodada 2 precisou de outro conserto.
- **Onde os defeitos se concentram.** O cliente do curral e do tronco (`Weights.html` e `Reproduction.html`: blocos,
  rascunho, falta de sinal e posição numa data passada) teve achado alto nas três rodadas (11 e 12 na rodada 1; 7 na 2; 2,
  3, 4 e 5 na 3, quatro dos cinco altos da última). As consultas "numa data D" que usavam fatos de hoje (indicadores,
  matrizes, agenda, brinco, conferência do curral, ficha) apareceram nas três rodadas.
- **O que o teste aleatório não viu.** As 6.328 sementes novas da fase (1.228 nas rodadas 2 e 3) não acharam nenhum
  defeito do sistema, e as três rodadas acharam 79. Os oráculos novos de cada rodada passam a conferir o que ela achou,
  mas não anteciparam o que a rodada seguinte achou. O teste aleatório confere a coerência interna e o efeito pedido; a
  tela e a regra de domínio que só existe num caminho continuam dependendo da revisão.
- **O que continua em aberto:**
  1. Os 25 consertos da rodada 3, sem revisão. Pelo que as rodadas 2 e 3 acharam nos consertos anteriores, é provável que
     parte deles esteja incompleta, sobretudo no curral e no tronco.
  2. O curral e o tronco só rodaram no Chromium do Playwright, com o mock de `google.script.run`: nunca num celular, no
     quadro do HtmlService ou com sinal fraco de verdade (seção 3).
  3. Os resíduos que as rodadas registraram, na seção 5 (itens 6 e 15): a recusa `IDEMPOTENCY_MISMATCH` que o curral não
     confere sozinho; a data sem posição por motivo do servidor, conferida pela lista de hoje; as bases com dados de antes
     dos consertos. E a margem da página inicial (item 3 da seção 5): 1.587 bytes, que o próximo conserto na Início, na
     ficha ou nos componentes pode esgotar.
  4. A validação na conta do dono (seção 3), que nenhuma rodada substitui.
- **Próximo passo recomendado**, antes de dar a Fase 3 por fechada: uma rodada de revisão só sobre os consertos da rodada 3
  e o cliente do curral e do tronco, e o roteiro do modo curral num celular de verdade, no curral. **O que se fez em
  seguida** foi a convergência pela garantia e uma revisão final (seção 6.6).

### 6.6 Convergência da Fase 3

Depois da rodada 3, o trabalho mudou de forma, como na Fase 2 (`RELATORIO_FASE2.md`, seção 6.8): em vez de mais um conserto
caso a caso, garantias que valem para todos os caminhos das duas classes de defeito que as rodadas repetiam. Foram quatro
etapas, cada uma com a sua entrada no `CHANGELOG` e a sua seção no `CONTRATOS.md`: o oráculo de viagem no tempo (seção 46), o
resolvedor único da posição na data (47), o teste aleatório da tela do curral e do tronco (48) e o conserto da revisão final
(49). Os números das levas de teste aleatório são os do registro de cada etapa. As seções 6.6.1 a 6.6.6 descrevem essa primeira
convergência e foram escritas no relatório dela, em 17/11/2026: o "esta etapa" delas é aquele relatório. A revisão final ainda
achou 7 altos, e veio uma segunda convergência, com duas etapas pela garantia e duas rodadas de revisão (seções 50 a 54). Ela
está na seção 6.6.7, e o que o relatório dela executou de novo está marcado lá como "esta etapa".

#### 6.6.1 Por que: três rodadas sem queda e duas classes de defeito

| Rodada | Achados | ALTA | Conserto incompleto ou regressão da anterior | Altos da classe 1 (data passada) | Altos da classe 2 (curral e tronco) |
|---|---:|---:|---:|---|---|
| 1 (a entrega) | 29 | 14 | — | 1, 2 | 11, 12 |
| 2 (os consertos da 1) | 25 | 8 | 10 (40%) | 6, 7 | 7 |
| 3 (os consertos da 2) | 25 | 5 | 13 (52%) | 3 | 2, 3, 4, 5 |

O total não caía (29, 25, 25), e a parte que era conserto incompleto ou regressão subia (seção 6.5). Pela leitura dos achados
nesta etapa, eles repetiam duas classes:
- **Classe 1: número ou estado pedido numa data passada, calculado com o dado de hoje** (a posição, o brinco, o pasto, a
  categoria, a cria ao pé, o peso, a agenda, o estoque e os indicadores). Cada consulta tinha a sua conta "em D", e o conserto
  de uma não chegava às outras: a rodada 1 consertou os indicadores e as matrizes; a 2 achou a cria ao pé, a agenda e o brinco
  do curral; a 3, o brinco sem sinal, a categoria e o peso da conferência e o número lançado errado. No caminho da correção, o
  mesmo erro tinha outro nome, o "fato congelado na correção" (achados 3, 6 e 7 da rodada 1; 1 e 4 da rodada 2): o fato de
  uma data passada refeito com o cadastro de hoje.
- **Classe 2: o curral e o tronco com estados inconsistentes** (a tela de lote com fila no aparelho, blocos idempotentes,
  rascunho e rede caindo). Teve achado alto nas três rodadas, e quatro dos cinco altos da última. O teste aleatório do motor
  entra pela chave do bloco e pela resposta do servidor, não pela tela, e não podia ver nenhum deles.

As duas classes somam 10 dos 27 altos das três rodadas; com o fato congelado na correção, 15. As 6.328 sementes do teste
aleatório da fase até ali não acharam nenhum deles.

#### 6.6.2 O oráculo de viagem no tempo (etapa 1; `CONTRATOS.md`, seção 46)

**A propriedade.** A resposta de uma consulta numa data D é função só de duas coisas. A primeira são os fatos até D: cada
evento com a sua situação, a correção de cadastro e a do brinco lançado errado em qualquer data, e o vínculo de mãe das crias
nascidas até D. A segunda são os cadastros que o desenho manda ler como estão hoje. Daí:
- um fato depois de D (também o estorno e a correção dele) não muda a resposta de D;
- um cadastro que não vale para o passado também não muda;
- um fato retroativo muda só o que alcança;
- a resposta não depende da data de hoje;
- em D = hoje, a consulta sem a data é igual à consulta com a data.

**O ponto único do estado em D.**
- `Timeline.fonteAte` é a fonte só com os fatos até D.
- `Timeline.retratoEm` é o MESMO projetor do estado de hoje aplicado a essa fonte, com o brinco e a cria ao pé de D.
- `Timeline.periodosDeBrinco` dá os períodos de cada número pela regra 16.2.
- `AnimalService.retratoEm` guarda o retrato no leitor. Em D = hoje, devolve a projeção gravada, e o oráculo confere a
  igualdade a cada passo (`TEMPO:RETRATO_DE_HOJE`).

O retrato só é calculado para o animal que a consulta mostra (`itemPresente_`). Quem só conta cabeças, sexo, categoria e peso lê
a projeção (`semData_`). Na base de demonstração, a visão geral e a posição numa data não calculam nenhum retrato; os elegíveis
de uma data de 2025 calculam 294, e o desempenho, até 360.

**Consultas cobertas.** O inventário passou pelas 29 rotas de consulta de então (30 hoje, com `animal.resolver`), pela ficha,
pela importação e pelos cálculos do servidor com data. O oráculo (`tests/apoio-fuzz.js`, `oraculoTempo`) roda num passo
sorteado por um gerador à parte, e por isso as sequências das sementes não mudaram. Nesse passo, ele tira o retrato desta
bateria em D:
- `inventario.posicao`: inteira, por sexo, por pasto, por categoria e de cada animal da amostra;
- `inventario.elegiveis` de TRANSFERENCIA, PESAGEM e NASCIMENTO;
- `pasto.listar` e `pasto.painel`, este com a permanência dos 60 dias até D;
- `sanidade.agenda`;
- `reproducao.indicadores` (padrão, por estação e do ano) e `reproducao.matrizes`;
- `peso.desempenho`: desde o marco zero, nos 120 dias, por pasto e por categoria;
- `dashboard.obter` e `evento.listar`;
- a ficha de quem saiu.

Depois de cada passo que grava, ele compara as unidades (a consulta inteira ou a linha de um animal) cuja impressão digital não
mudou. No passo do retrato, confere mais quatro coisas:
- a mesma bateria com o relógio adiantado em 1, 31, 200 ou 400 dias;
- o caminho sem a data, em D = hoje;
- todo pasto que tinha animal em D na lista de pastos;
- a ficha cruzada com as consultas da data.

A cada passo que grava, confere também que o retrato de hoje é igual à projeção. A data D é sorteada perto dos fatos (45%),
entre o marco zero e hoje (35%), hoje (12%), no marco zero (4%) e antes dele (4%).

**Exceções por desenho.** Ficam fora da comparação e estão na seção 46 e no cabeçalho do oráculo:
- os cadastros lidos como estão hoje: regras e nomes de CATEGORIAS, pastos, protocolos que já valiam em D (RN-058), estações,
  plano de contas, nomes de produtos e parâmetros zootécnicos lidos na consulta;
- `inventario.elegiveis.brinco_hoje`;
- os títulos, as pendências de cadastro e o `geradoEm` da visão geral;
- as curvas de `peso.desempenho` (a curva da vida do animal, como na ficha);
- as listas e a localização da ficha;
- `animal.listar`, `evento.obter` e `alerta.listar`, que são de hoje;
- o custo de aquisição, fora do retrato (03a, DL-08).

A ficha de quem saiu usa a data da saída; a volta ao rebanho leva a ficha para hoje.

**Sementes** (registro da etapa):

| Leva | Sementes × passos | Aceitos / recusados | Falhas do sistema | Falhas do modelo do teste |
|---|---|---:|---:|---:|
| Busca, com o código de antes dos consertos | 40 × 100 (3110000 a 3110039) | 1.797 / 997 | 13, em 6 classes | 2 |
| Depois dos consertos, com o código de então | 80 × 100 (3120000 a 3120079) | 4.590 / 2.738 | 0 | 0 |
| Código intermediário | 1.000 × 100 (3200000 a 3200999) | — | — | — |
| Código final congelado | 1.000 × 100 (3400000 a 3400999) | 58.341 / 33.470 | 0 | 1 |
| Leva nova limpa, com o oráculo corrigido | 200 × 100 (3500000 a 3500199) | 11.985 / 6.531 | 0 | 0 |

A leva do código intermediário abortou aos 40 minutos: uma edição do `src/` caiu no meio dela (o teste aleatório relê o `src/` a
cada semente). Foi descartada e refeita inteira com o código final congelado. Na leva de 1.000, a viagem no tempo tirou 7.254
retratos, conferiu 1.646.617 unidades com o relógio adiantado e 7.008.184 unidades depois de passos que gravam, e conferiu
418.487 retratos de hoje com a projeção. Não houve nenhuma falha do tempo.

**Defeitos achados.** Foram 10 (8 corrigidos e 2 refutados), cada um com teste em `tests/tempo.regressoes.test.js`. São 16 testes; com o `src/` de antes
(`d72e518`), os 16 falham nesta etapa. Os 7 cenários de comportamento falham por asserção. O do retrato e as 8 sequências falham
porque o oráculo de hoje usa `Timeline.retratoEm`, que lá não existia; o registro da etapa conta 14, com as duas
sequências do modelo do teste passando nos dois códigos.

| Gravidade | Defeito | Decisão |
|---|---|---|
| ALTA | O brinco de hoje nas listas de uma data passada: painel e dias de permanência do pasto, agenda (pendências e carência), lista de fêmeas e linhas do desempenho (a troca do brinco depois de D mudava a lista de D) | Corrigido: o retrato em D em toda lista |
| ALTA | A estação padrão dos indicadores e a lista de fêmeas da estação contavam registros com data depois de D | Corrigido: só os registros até D |
| MÉDIA | Linhas do desempenho de um período passado com a situação e o pasto de hoje | Corrigido: os do fim do período |
| MÉDIA | Pasto desativado depois sumia da lista de pastos da data em que tinha animal (as cabeças não fechavam com o rebanho) | Corrigido |
| MÉDIA | Ficha de quem saiu com a carência pelo relógio de hoje e a aptidão e a situação de hoje | Corrigido: as do dia da saída |
| MÉDIA | Ficha de quem saiu com a cria ao pé de hoje | Corrigido: a do dia da saída |
| MÉDIA | Importação de manejo e de eventos: o dono do número na data pelos períodos gravados, sem a regra 16.2 (o número corrigido não achava o animal; o errado achava) | Corrigido: `Timeline.periodosDeBrinco` |
| BAIXA | Importação de ANIMAIS: a mãe e o pai no marco zero pelos períodos gravados | Corrigido |
| BAIXA | A ficha mudava depois da volta ao rebanho de quem saiu (sementes 3110020 e 3110034) | Refutado: por desenho, a volta leva a ficha para hoje (erro do modelo do teste) |
| BAIXA | O estorno imediato da entrada de insumo recusado com a política BLOQUEIA de `ESTOQUE_INSUFICIENTE` (semente 3400390) | Refutado: a recusa é a do RN-057 com a política; o oráculo passou a aceitá-la quando o modelo a confirma |

A leva de busca achou 13 falhas do código, em 6 classes: o brinco de hoje no painel (3), as fêmeas da estação (2), a situação e o
pasto do desempenho (5), a carência da ficha (1), o pasto que sumia (1) e a cria ao pé da ficha (1). O conserto pela causa, no
ponto único, fechou junto as demais ocorrências da mesma classe e a importação. **Foi a primeira vez na Fase 3 que o teste
aleatório achou defeito do sistema**: as 6.328 sementes anteriores não acharam nenhum. As 13 falhas são exatamente da classe que
as rodadas repetiam.

#### 6.6.3 O resolvedor único da posição na data (etapa 2; seção 47)

O animal de um brinco digitado voltou em todas as rodadas: o achado 22 da rodada 1; os achados 7, 16 e 22 da rodada 2; e,
na rodada 3, os achados 3, 9, 11 e 18 (consertos incompletos dos de antes) e o 5 (a regressão do código interno). O mesmo
brinco digitado dava animais diferentes no curral, no tronco, no seletor, na importação e na conferência. A etapa pôs **um** resolvedor no servidor (`src/Identificacao.js`,
domínio puro) e a rota `animal.resolver`, e todos os caminhos passaram a usar só ele.

**A regra, em ordem:**
1. o número em uso em D, pelos períodos de `Timeline.periodosDeBrinco` (sem os zeros à esquerda, quando o parâmetro manda);
2. o código interno inteiro (A-000004), que acha qualquer animal; os atalhos (000004, A000004, A-4) só valem para o animal sem
   brinco em D;
3. o número usado só depois de D acha o primeiro dono apenas no histórico de antes do marco zero;
4. as recusas explicadas: ANTES_DO_USO, SEM_USO, LANCADO_ERRADO, CODIGO_DE_ANIMAL_COM_BRINCO e NAO_ENCONTRADO;
5. o nome exato de um animal de referência.

A identidade não depende do caminho: o tipo, o sexo e a presença não entram na regra; o estado diz por que o animal achado não
serve. O brinco de hoje nunca acha o animal de uma data passada.

**O cliente nunca resolve brinco.** `Store.resolverBrinco` e os índices por brinco do aparelho saíram. O curral, o tronco, o
seletor, a busca do topo e o campo de animal dos formulários perguntam ao servidor: uma consulta por brinco, guardada por versão
dos dados, data e tipo. Sem resposta, a linha fica pendente e vai ao servidor depois. **Esta decisão contraria o desenho** (08,
seção 5, e desenho-base, modo curral: o brinco resolvido "no store, sem ida"). Ela fica para o dono ratificar (seção 3) e para a
etapa de documentação levar à Fase 0.

**Testes e oráculo.**
- `tests/resolvedor.unico.test.js` (2 testes): 19 casos difíceis × o curral, o tronco e o seletor pela rota, a conferência pela
  posição da data e a importação de verdade. Com o `src/` de antes (`8dc5c35`), a importação divergia do resolvedor em 5 dos 19
  casos.
- `tests/ui/resolvedor.test.js` (2 testes): a mesma tabela digitada no curral, no tronco e no seletor.
- No teste aleatório, no passo da viagem no tempo, `oraculoResolucao` confere os textos difíceis pelos quatro caminhos da rota,
  cada número da posição da data no animal do resolvedor e a mesma descrição. Ao concluir uma importação,
  `oraculoResolucaoImportacao` confere cada linha importada no animal do resolvedor.
- Leva nova (3600000 a 3600199, 200 × 100): 11.651 aceitos, 6.731 recusados, 0 falhas. Foram conferidos 121.556 textos pelos
  quatro caminhos, 14.716 números da posição, 15.332 animais descritos igual e 93 linhas importadas.

**Defeitos achados (5, todos corrigidos):**

| Gravidade | Defeito | Teste |
|---|---|---|
| ALTA | A importação dava ao número o "primeiro dono" mesmo depois do marco zero: a pesagem do 1457 de 10/11 ia para a vaca que só o recebeu em 11/11, enquanto o curral recusava | `resolvedor.unico.test.js` |
| ALTA | O cliente resolvia o brinco por conta própria: o seletor e a busca numa data passada achavam pelo brinco de hoje; o curral antes do marco zero conferia pela lista de hoje | `ui/resolvedor.test.js` |
| MÉDIA | A importação não achava a vaca pelo código interno inteiro nem a cria sem brinco pelo código, que o curral achava | `resolvedor.unico.test.js` |
| MÉDIA | A importação achava a cria pelo 0901 antes de ela nascer (a recusa vinha da presença, não do número) | `resolvedor.unico.test.js` |
| BAIXA | O campo de animal dos formulários (mãe, pai, touro, volta ao rebanho) achava pelo brinco de hoje, não pelo da data do lançamento | `ui/resolvedor.test.js` |

#### 6.6.4 O teste aleatório da tela do curral e do tronco (etapa 3; seção 48)

O cliente do curral e do tronco teve achado alto nas três rodadas, e nenhum teste aleatório o exercitava pela tela.
`tests/ui/curral.fuzz.test.js` roda a tela de verdade contra um modelo do que deve estar gravado e na fila: Playwright a 360
px, com o mock de `google.script.run` ligado ao backend real. O apoio fica em `tests/ui/apoio-curral.js`.

**Ações do usuário:**
- lançar: brinco válido, sem os zeros, trocado, de outro pasto, de quem saiu, inválido, e o código interno do animal sem brinco
  e de um com brinco; com e sem Enter; valor válido e inválido, pelo teclado e pelo botão;
- o lote passando depressa (o bloco de 20 sai sozinho);
- desfazer o último, tirar, corrigir o peso ou o resultado, corrigir o brinco, "Está certo" da linha e do lançamento, enviar;
- mudar a data, o método, o momento, o pasto ou a estação; terminar; recarregar; sair e voltar;
- o tempo passar, conferir as pendências e outro usuário gravando no mesmo banco;
- desde a revisão final, também as respostas chegando com a pergunta do repetido na tela e o brinco conferido sem lançar antes
  de mudar a sessão.

**Falhas de rede.** São decididas no Node, por classe de rota: lançamento, resolvedor, conferência e, desde a revisão final, o
rascunho. O teste usa:
- a resposta perdida depois de gravar e o pedido perdido antes de chegar;
- o transporte que falha antes ou depois de gravar;
- a resposta e o pedido segurados e soltos fora de ordem;
- o servidor ocupado e a falha interna.

Nada depende do tempo real: o teste anda o relógio da página. Desde a revisão final, 25% das sementes rodam sem
`localStorage`, com o rascunho no servidor segurado enquanto o bloco sai.

**As garantias da fila de lote.** O oráculo confere cada uma a cada ação:
- nada gravado duas vezes;
- nada perdido;
- o animal de cada linha é o do texto na data da sessão;
- nenhum bloco fica preso depois de o tempo passar;
- desde a revisão final, o bloco que saiu é intocável no aparelho.

No fim, confere o banco igual ao modelo, a integridade sem erro, a projeção igual à reconstrução e nada no console.
`npm run ui:check` roda 6 sementes fixas (11 a 16) de 40 ações.

**Sementes** (registro das etapas):

| Leva | Sementes × ações | Resultado |
|---|---|---|
| Busca, com o código de antes | 1 a 16, 1 a 60, 100 a 147, 200 a 259 e 300 a 419 (40 ações) | Acharam os defeitos 1, 2, 3 e 6 abaixo e os erros do modelo |
| Limpas | 500 a 619 e 700 a 819 (40 ações) | 0 falhas |
| Longa | 900 a 935 (100 ações) | 7 falhas em duas rodadas, todas do teste (o tempo real corria sozinho): refutadas e corrigidas no teste |
| Final da etapa 3, com o código congelado | 1000 a 1149 (150 × 40) e 2000 a 2035 (36 × 100) | 186 aprovadas, 0 falhas |
| Depois do conserto da revisão final | 3000 a 3049 (50 × 40; 15 sem `localStorage`) | 49 aprovadas; 1 falha do modelo (3040), refutada |
| Esta etapa: confirmação com o código final | 4000 a 4029 (30 × 40; 7 sem `localStorage`) | 30 aprovadas, 0 falhas |

As 150 sementes da leva final da etapa 3 tiveram:
- 7.237 conferências do oráculo, 1.883 delas com o tempo passado, e 3.221 linhas gravadas;
- 424 envios, 297 recargas, 215 saídas e voltas e 94 mudanças de sessão;
- recusas do servidor conferidas na tela: 375 avisos, 106 validações e 38 falhas internas;
- falhas de rede: 120 respostas perdidas depois de gravar, 63 pedidos perdidos antes, 104 transportes antes e 65 depois de
  gravar, 72 respostas e 58 pedidos segurados, 48 servidor ocupado e 83 falhas internas.

**Defeitos achados.** Foram 9: 6 do sistema, corrigidos, e 3 do teste, refutados. As regressões fixas estão em
`tests/ui/curral.fuzz.regressoes.test.js` (7 testes). Nesta etapa, com o `src/` de antes da etapa (`ee1b2cd`), as 7 falham: 5 por asserção ou espera e 2 do tronco porque
`TelaReproducao.sessao()`, que o teste lê, ainda não existia.

| # | Gravidade | Defeito | Decisão |
|---:|---|---|---|
| 1 | ALTA | "Mudar data" com linhas na fila mantinha o animal resolvido na data antiga (curral e tronco): com o 0457 trocado e reaproveitado, a pesagem de 04/11 ia para a vaca errada | Corrigido: a linha guarda o texto e a data em que foi resolvida, e mudar a data confere de novo no servidor |
| 2 | ALTA | A falha interna do servidor no reenvio de um bloco já gravado virava "recusada": a chave era solta, e a linha corrigida gravava duas vezes | Corrigido: só VALIDATION, NEEDS_CONFIRMATION e CONFLICT soltam o bloco; IDEMPOTENCY_MISMATCH deixa só "Tirar"; as demais deixam o bloco com a chave |
| 3 | MÉDIA | "Está certo" dado com outro bloco no ar deixava as linhas na fila com o "Enviar" desligado | Corrigido: o envio escolhe o próximo bloco pronto a cada volta |
| 4 | MÉDIA | Sair e voltar com o envio no ar: a resposta não redesenhava a tela nova, e o mesmo bloco era conferido por dois caminhos (achado na leitura do código para o modelo, não por uma semente) | Corrigido: um envio de cada vez; o envio redesenha a tela aberta |
| 5 | BAIXA | Tronco: a recusa do servidor à conferência do bloco ia só ao console | Corrigido: fica na tela |
| 6 | BAIXA | A linha pendente barrada por outra do mesmo animal ficava pendente para sempre | Corrigido: espera e entra na fila quando a outra sai |
| — | MÉDIA | O teste dependia do tempo real (a nova tentativa do servidor ocupado e o prazo de 45 s corriam sozinhos) | Refutado como defeito do sistema: o teste passou a andar o relógio |
| — | BAIXA | O oráculo exigia a resposta entregue depois do prazo de 45 s, que o aparelho não ouve, ou já desfeita por uma ação posterior | Refutado: oráculo corrigido |
| — | BAIXA | O modelo tratava como defeito a linha na fila de bloco com aviso, o bloco de 20 que sai sozinho, a pendência resolvida durante a ação e a recusa geral antes do marco zero | Refutado: modelo corrigido |

**Decisão das recusas.** A seção 45 mandava soltar o bloco em toda recusa que não fosse falta de sinal. O teste mostrou que isso
gravava duas vezes, e a regra mudou (defeito 2). Fica um risco: um bloco que recebe falha interna repetida fica sem
confirmação e impede o "Terminar" até o servidor responder.

#### 6.6.5 Revisão final

A revisão independente final examinou o código depois das três etapas, com as quatro lentes. Achou **17 defeitos: 7 altos, 9
médios e 1 baixo**, todos distintos. Todos foram reproduzidos por um teste que falha com o `src/` de antes (`11b744a`) e foram
**CORRIGIDOS**; nenhum foi refutado nem adiado. Os testes estão em `tests/revisao.final.fase3.test.js` (8 testes de Node:
achados 1, 2, 8, 9, 10, 11, 16 e 17) e em `tests/ui/revisao.final.fase3.test.js` (13 testes de navegador: achados 3 nas duas
ordens, 4 e 7 no curral e no tronco, 5, 6, 12, 13 nas duas ordens, 14 e 15). Nesta etapa, com o `src/` de `11b744a`, os 8 de Node falham por asserção, e os 13 de navegador também falham: 10 por
asserção e 3 pela espera de um estado que a tela de então não tinha.

| Lente | ALTA | MÉDIA | BAIXA | Total |
|---|---:|---:|---:|---:|
| ZOOTECNIA E CUSTO | 1 | 3 | 0 | 4 |
| MOTOR | 1 | 1 | 1 | 3 |
| INTERFACE E REGRAS | 4 | 2 | 0 | 6 |
| CORREÇÕES ANTERIORES | 1 | 3 | 0 | 4 |
| **Total** | **7** | **9** | **1** | **17** |

| # | Gravidade | Lente | Achado | Decisão |
|---:|---|---|---|---|
| 1 | ALTA | ZOOTECNIA | Agenda: no protocolo restrito a uma categoria, o vencimento contava da entrada no rebanho, e não do dia em que o animal entrou na categoria (A CADA N DIAS nunca aplicado e CAMPANHA) | Corrigido: `AnimalService.naCategoriaDesde` na agenda, na ficha e no alerta |
| 2 | ALTA | MOTOR | Conserto incompleto do fato congelado: a correção de uma aplicação gravada sem carência gravava nela a carência padrão de HOJE do produto, e a correção de outro campo era recusada por `CARENCIA_ATIVA` | Corrigido: com o mesmo produto, a carência vazia é a do original (`sanidadeDoOriginal_`) |
| 3 | ALTA | INTERFACE | Curral: o "Substituir o peso" valia pelo estado de quando a pergunta apareceu; com a linha anterior num bloco que saiu, desfazia o bloco no ar ou já gravado (a tela dizia gravado o que não foi, ou a linha gravava duas vezes) | Corrigido: a decisão é conferida no clique; `desfazerBloco` recusa o bloco que saiu |
| 4 | ALTA | INTERFACE | Curral e tronco sem `localStorage` (rascunho no servidor): enquanto o rascunho com a chave subia, "Tirar" e "Mudar data" ainda valiam para as linhas que já estavam saindo (linha presa para sempre; gravação na data antiga com a tela dizendo a nova) | Corrigido: a tela mostra o bloco saindo antes de guardar a chave; os botões conferem o estado no clique |
| 5 | ALTA | INTERFACE | Conserto incompleto (rodada 1): a prévia da correção calculava no aparelho a próxima aplicação com o intervalo de HOJE do protocolo | Corrigido: o intervalo congelado no payload (`intervalo_protocolo_dias`) |
| 6 | ALTA | INTERFACE | Classe "brinco de hoje numa data passada": no tronco com data passada, a linha e a mensagem mostravam o brinco de hoje, e "Corrigir o resultado", depois de recarregar, punha esse número no campo e achava outra vaca | Corrigido: a linha usa o brinco da data (`rotuloLinha`); "Corrigir o resultado" confere o texto digitado; as mensagens do servidor usam `nomeNaData_` |
| 7 | ALTA | CORREÇÕES ANTERIORES | Conserto incompleto do defeito 1 da etapa 3: o animal já conferido no campo do brinco, ainda não lançado, sobrevivia ao "Mudar data" e era gravado com o animal da data antiga | Corrigido: a conferência carrega a data; mudar a sessão a zera |
| 8 | MÉDIA | ZOOTECNIA | Indicadores anuais aceitavam ano futuro ou posterior a D (matrizes numa data que não chegou; natalidade de 0,0%) | Corrigido: `DATA_FUTURA` |
| 9 | MÉDIA | ZOOTECNIA | Desempenho por categoria: "Nenhum animal com duas pesagens" quando todos tinham, e o GMD com 0 cabeças | Corrigido: o vazio explicado pela categoria do início do intervalo; a tela diz de onde vêm as cabeças e o ganho |
| 10 | MÉDIA | ZOOTECNIA | Bezerro descartado contado como "vendido ao pé" e fora da mortalidade até a desmama | Corrigido: `descartados_ao_pe`, à parte |
| 11 | MÉDIA | MOTOR | Mesma classe do 2: com o procedimento do protocolo trocado depois do uso, a correção sem mudança de uma aplicação antiga era recusada | Corrigido: `PROTOCOLO_EM_USO` no cadastro; na base antiga, `protocoloDoOriginal_` |
| 12 | MÉDIA | INTERFACE | Conserto incompleto do defeito 6 da etapa 3: a pendente de um animal com pesagem já gravada ficava barrada e bloqueava o "Enviar" das outras | Corrigido: pede "Está certo" ou "Tirar" sem barrar as outras |
| 13 | MÉDIA | INTERFACE | Tronco: a pendente resolvida pela conferência do mesmo brinco era substituída sem aviso, e o resultado dependia da ordem das respostas; a regressão 6 da etapa 3 era instável | Corrigido: as pendentes vão na mesma pergunta e são resolvidas antes da decisão; a regressão 6 ficou determinística |
| 14 | MÉDIA | CORREÇÕES ANTERIORES | Conserto incompleto da etapa 1: a tela da agenda trocava o brinco da data, que o servidor manda, pelo brinco de hoje do aparelho | Corrigido: `Health.nomeAnimal` usa o do servidor |
| 15 | MÉDIA | CORREÇÕES ANTERIORES | Conserto incompleto da etapa 1: a tela de Pastos escondia o pasto desativado que tinha animal na data | Corrigido |
| 16 | MÉDIA | CORREÇÕES ANTERIORES | Regressão da etapa 1: num período antes do marco zero, o desempenho perdia o brinco (o retrato dava null), ao contrário do resolvedor | Corrigido: `Timeline.brincoNaData_`, a regra 3 do resolvedor |
| 17 | BAIXA | MOTOR | Nome do produto e fabricante, cópias congeladas do cadastro, refeitos pelo cadastro de hoje na correção de outro campo | Corrigido: os do original |

**Teste aleatório depois do conserto** (registro da etapa):
- Motor, leva de busca com o código intermediário (3700000 a 3700039, 40 × 100): 2.274 aceitos, 1.406 recusados, 0 falhas.
- Motor, código final (3800000 a 3800299, 300 × 100): 17.747 aceitos, 9.872 recusados, 0 falhas. A agenda foi conferida com
  protocolo por categoria 171 vezes (147 com o animal que entrou na categoria depois de entrar no rebanho). Foram conferidas
  329 correções de aplicação pelas cópias do original, 395 correções sem mudança mais tarde e 2.097.389 unidades da viagem no
  tempo.
- Dois encontros não apareceram na leva: a troca do procedimento de um protocolo já cumprido e a correção tardia barrada pela
  carência do próprio original. Ficam só nos testes fixos (achados 11 e 2).
- Tela: as 50 sementes da tabela da seção 6.6.4. A decisão do repetido refeita no meio não apareceu; fica no teste do achado 3.
- Esta etapa, com o código final. Motor: 100 sementes novas × 100 passos (3900000 a 3900099), 5.878 aceitos, 3.290 recusados e 0
  falhas. A agenda foi conferida com protocolo por categoria 84 vezes (13 com o animal que entrou na categoria depois de entrar
  no rebanho), houve 96 correções de aplicação conferidas pelas cópias do original, 714.564 unidades da viagem no tempo
  comparadas e 59.497 textos do resolvedor. De novo, nem a troca do procedimento de um protocolo cumprido nem a correção tardia
  barrada pela carência do original apareceram. Tela: 30 sementes novas × 40 ações (4000 a 4029; 7 sem `localStorage`, com 8
  rascunhos segurados), 30 aprovadas e 0 falhas, com 1.426 conferências do oráculo, 1.662 blocos que saíram conferidos
  intocados, 607 linhas gravadas, 78 substituições e 7 brincos conferidos antes de mudar a sessão.

**Por onde os 17 passaram pelas garantias.** Pela leitura desta etapa:
- **O aparelho fora do alcance do oráculo do tempo.** O oráculo compara respostas do servidor. Os achados 5, 14 e 15 eram telas
  que refaziam no aparelho o que o servidor já mandava certo (a regra "o cliente não recalcula número"). O 6 era o rótulo da
  linha do tronco.
- **O caminho da correção.** O oráculo do tempo confere consultas, não o que a correção de um fato passado grava. O oráculo do
  efeito da correção espelhava o servidor: esperava a carência padrão de hoje (achados 2, 11 e 17). Ele deixou de espelhar.
- **Lacunas declaradas antes da revisão.** Os protocolos por categoria estavam fora do modelo da agenda (seção 5, item 11), e o
  rascunho no servidor estava fora do teste da tela (`CONTRATOS.md`, seção 48). As duas lacunas viraram achados altos (1 e 4).
- **Variantes que o gerador da tela não fazia.** O "Substituir" com a anterior saindo, o brinco conferido antes de mudar a
  sessão, a pendente diante de uma linha gravada e as respostas fora de ordem com a pergunta na tela (achados 3, 7, 12 e 13).
- **Regras sem oráculo.** O ano depois de D (a bateria só pede o ano de D), o vazio explicado do desempenho, o descarte ao pé e
  o brinco antes do marco zero (achados 8, 9, 10 e 16).

Os oráculos foram estendidos onde o defeito escapou (seção 49): o modelo da agenda com protocolos por categoria, as cópias do
original no efeito da correção, o procedimento do protocolo em uso e, na tela, a garantia nova, as duas ações novas e o modo
sem `localStorage`. Os outros 9 (5, 6, 8, 9, 10, 12, 14, 15 e 16) ficam só com os testes fixos da revisão. O teste da tela
confere, em geral, o animal gravado e que nada fique preso, o que alcança parte do 6 e do 12.

#### 6.6.6 Balanço: a convergência está demonstrada? Não

Esta seção é o balanço da primeira convergência e fica como registro. A curva de achados com as duas rodadas da segunda
convergência e o estado de hoje estão na seção 6.6.7.

| Rodada | Achados | Distintos | ALTA | MÉDIA | BAIXA | Conserto incompleto ou regressão da anterior (pelo título) |
|---|---:|---:|---:|---:|---:|---:|
| 1 (a entrega) | 29 | 28 | 14 | 10 | 5 | — |
| 2 (os consertos da 1) | 25 | 18 | 8 | 15 | 2 | 10 (40%) |
| 3 (os consertos da 2) | 25 | 22 | 5 | 14 | 6 | 13 (52%) |
| Final (depois da convergência) | 17 | 17 | 7 | 9 | 1 | 8 (47%) |
| **Total** | **96** | **85** | **34** | **48** | **14** | **31** |

**A revisão final terminou sem achado alto? Não.** Ela achou 7 altos, mais que os 5 da rodada 3. Todos foram corrigidos e têm
teste, mas **nenhuma revisão examinou esses 17 consertos**.

O que os números mostram:
- **O total caiu** (25 para 17), mas os altos subiram (5 para 7). A parte de conserto incompleto ou regressão ficou perto da
  metade (52% para 47%).
- **6 dos 17 são consertos incompletos ou regressões das próprias etapas da convergência**: o 6 (classe do brinco de hoje), o 7
  e o 12 (defeitos 1 e 6 da etapa 3) e o 14, o 15 e o 16 (etapa 1). Como na Fase 2 ("6 dos 17 são das peças novas"), a
  revisão achou defeito nas peças novas.
- **A classe 2 continua.** O curral e o tronco tiveram achado alto nas quatro revisões; na final, 4 dos 7 (3, 4, 6 e 7).
- **A classe 1 não reapareceu nas consultas que o oráculo pede, mas não sumiu.** Nenhum dos 17 é uma consulta da bateria do
  oráculo que mudasse com um fato depois de D. A classe reapareceu onde o oráculo não olha: o aparelho (5, 6, 14 e 15), a
  correção de um fato passado (2, 11 e 17) e um parâmetro que a bateria não pede (8).

O que a convergência garante:
1. **Consultas do servidor numa data.** Para as consultas da bateria, a propriedade do tempo é conferida depois de cada comando
   de cada semente, com o relógio adiantado, e o retrato de hoje é conferido contra a projeção.
2. **Um resolvedor.** O mesmo texto dá o mesmo animal, ou a mesma recusa, em todo caminho do servidor e da tela. Isso é
   conferido pelo teste tabelado e pelo oráculo nos quatro caminhos e na importação.
3. **A fila de lote.** As cinco garantias são conferidas a cada ação na tela de verdade, com a rede caindo. Elas valem no
   Chromium do Playwright, com o mock.
4. **Defeitos achados sem revisor.** O teste aleatório passou a achar defeito do sistema: 13 falhas em 6 classes pelo oráculo
   do tempo e 5 defeitos pela tela (o sexto saiu da leitura do código para montar o modelo). Na fase, até ali, nenhum.

O que ela não garante:
- as telas fora do curral e do tronco, que mostram ou refazem dado do servidor;
- o que a correção de um fato passado grava, além dos oráculos do efeito;
- o que o gerador não gera e o que a bateria não pede (seção 5, item 11);
- o celular, o quadro do HtmlService, o Apps Script e o Google Sheets.

**O que continua em aberto:**
1. Os 17 consertos da revisão final, sem revisão. Pelo que as rodadas acharam nos consertos anteriores (40%, 52% e 47%),
   é provável que parte deles esteja incompleta, sobretudo no curral e no tronco.
2. O curral e o tronco nunca rodaram num celular, no quadro do HtmlService ou com sinal fraco de verdade (seção 3). A ida ao
   servidor por brinco, que a etapa 2 pôs no lugar da resolução no aparelho, não tem tempo medido no Apps Script.
3. Os limites do oráculo do tempo:
   - só três tipos de elegíveis (TRANSFERENCIA, PESAGEM e NASCIMENTO);
   - sem o filtro por propriedade e sem as curvas do desempenho;
   - a ficha de quem está no rebanho só é cruzada em D = hoje;
   - a categoria em D (`AnimalService.perfilEm`) continua uma conta própria, conferida pelo oráculo, mas que não deriva do retrato.
4. O que o teste da tela não cobre: o "Pesar este" da lista dos que faltam, vários animais com o mesmo número na mesma data, duas
   abas abertas e o celular. Um bloco com falha interna repetida impede o "Terminar" até o servidor responder.
5. Encontros raros nas levas finais, cobertos só por testes fixos: o procedimento do protocolo cumprido, a correção tardia
   barrada pela carência do original e a decisão do repetido refeita no meio.
6. O custo do retrato numa data passada (até 360 retratos por consulta na base de demonstração) e o da trava, no Apps Script
   (seção 5, item 10).
7. A margem da página inicial: 45 bytes (seção 5, item 3).
8. As decisões da convergência, só em `CONTRATOS.md`. Uma delas contraria o desenho (o brinco resolvido no servidor, seção
   6.6.3), e todas esperam a ratificação do dono (seção 3).
9. A validação na conta do dono (seção 3), que nenhuma rodada substitui.

**Recomendação.** Antes de dar a Fase 3 por fechada, fazer uma rodada de revisão independente curta, só sobre os 17 consertos
da revisão final. O foco seria o curral e o tronco (o bloco que saiu intocável, a conferência presa à data, as pendentes na
mesma pergunta) e as cópias congeladas na correção. Também falta o roteiro do modo curral num celular de verdade, no curral. A
decisão é do dono.

## 7. Veredito (09, seção 10)

```text
RELATÓRIO DE TESTES, FASE 3, 17/11/2026 (com a convergência e a revisão final): o código de comportamento é o
do commit bfbdca6 (src/) e os testes os do d0033b6, salvamentos automáticos da orquestração durante o conserto
da revisão final; esta etapa só mudou documentos e não fez commit nem push (o salvamento automático de fora
dela gravou 752e06c e b23e823, só com documentos)

1. EXECUTADO AQUI (Node)
   comando: npm test      resultado: 863/863 (825,4 s; 23 sementes fixas do teste aleatório: 826 aceitos, 0 falhas)
   cenários: CT-05 ok | CT-06 ok | SANIDADE ok | ESTOQUE ok | REPRODUCAO ok | CT-10 passo 3 ok | CT-17 e CT-18 com a
             pesagem ok | CT-12 com o manejo ok | Fases 1 e 2 ok | consultas numa data passada ok | resolvedor ok
   interface (Playwright): executado, 186/186 (433,9 s; 6 sementes fixas da tela do curral e do tronco);
             página inicial 450 KB de 450 KB (sobram 45 bytes)

2. A EXECUTAR NA CONTA DO DONO (nível 2)
   runAcceptanceTests()      PENDENTE      relatório JSON (23 cenários)
   CT-10 passo 6             PENDENTE      captura da página de concorrência
   modo curral no curral     PENDENTE      relato (com a ida ao servidor por brinco)
   PR-06, PR-07, PR-10, PR-11  PENDENTE    respostas
   decisões da convergência  PENDENTE      ratificar (uma contraria 08, seção 5)
   spike SP-01 a SP-10       PENDENTE (Fase 1)

3. HIPÓTESES NÃO CONFERIDAS NA PLATAFORMA
   tela sob demanda no iframe (NV); tempo do Sheets com o manejo, o retrato numa data e a ida ao servidor por
   brinco; teclado e localStorage no celular; as das Fases 1 e 2

4. FALHAS CONHECIDAS E DECISÃO
   nenhuma falha de teste; limitações na seção 5
   revisão: 3 rodadas e a final, 96 achados (34 altos), todos corrigidos; a final, depois da convergência, teve
   7 altos (4 no curral e no tronco), e os consertos dela não foram revisados (seção 6.6.6): a convergência não
   está demonstrada

5. VEREDITO: a fase fecha? não — depende da execução na conta do dono (seção 3) e, antes disso, de uma revisão
   dos 17 consertos da revisão final, sobretudo do curral e do tronco (seção 6.6.6)
```
