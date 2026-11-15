# Relatório da Fase 2 — Motor de eventos

Data: 15/11/2026. Versão do app: 0.1.0. Plano: `docs/fase-0/10-plano-de-implementacao.md`, seção 4 (entregas E2.1 a
E2.11) e seção 8 (checklist). Relatório da fase anterior: `docs/RELATORIO_FASE1.md`.

## Em resumo

- **O código da Fase 2 está completo no repositório** (`erp-pecuario/src/`: 23 arquivos `.js`, 10 `.html` e o
  manifesto; entrou o `HealthService`) e passou em todos os testes que rodam aqui, inclusive os da Fase 1:
  **`npm test` com 619 testes, 619 aprovados, 0 falhas** e **`npm run ui:check` com
  85 testes de navegador, 85 aprovados, 0 falhas** (execução de 15/11/2026, depois do conserto da rodada 4 de revisão).
- O inventário se movimenta só por eventos: parto, compra, venda, transferência, morte, descarte, identificação,
  marcação, reclassificação e baixa na contagem, cada um com estorno e correção (inclusive retroativos e com lançamento
  posterior que depende deles). Compra e venda gravam o financeiro inteiro do próprio evento (regra P11). O rebanho e os
  pastos se refazem em qualquer data desde o marco zero, e em todo teste do motor, depois de cada comando, a projeção é
  igual à reconstrução e as 20 invariantes do financeiro fecham.
- **Nada foi implantado nem executado na conta Google do dono.** Continuam **PENDENTES NA CONTA DO DONO** os itens da
  Fase 1 (diagnóstico, aceitação) e, da Fase 2: `runAcceptanceTests` com os cenários novos, a validação das fórmulas de
  compra e venda com um caso real e a confirmação da premissa PR-09. Pela regra de honestidade, **a Fase 2 não está
  fechada** até esses resultados chegarem.
- Quatro rodadas de revisão independente registraram 94 achados (91 distintos, 17 distintos de gravidade alta). Todos
  têm teste: 89 foram corrigidos por inteiro, e 2 foram corrigidos em parte, com a outra parte refutada com o motivo.
  Desses 91, 6 deixaram um resíduo adiado, documentado nas limitações (seção 6.6). **A última rodada, a 4, não terminou
  limpa.** Ela achou 6 defeitos de gravidade alta (5 distintos) e 14 de gravidade média. Os 6 altos eram correções
  incompletas de rodadas anteriores. Todos foram corrigidos, mas nenhuma rodada revisou esses consertos (seção 6.7).
- Como atualizar a implantação: `docs/GUIA_DE_IMPLANTACAO.md`, seção 11.1.

## Regra de honestidade (09-plano-de-testes.md, seção 1)

Cada item deste relatório tem um de quatro estados:

| Estado | Significado |
|---|---|
| `EXECUTADO AQUI` | Rodou neste repositório; o comando e as contagens estão copiados da saída real |
| `EXECUTADO PELO DONO` | Rodou na conta do dono, com o arquivo de resultado. **Nenhum item está neste estado ainda** |
| `PENDENTE NA CONTA DO DONO` | Só pode ser executado na conta Google do dono; o roteiro está pronto |
| `NÃO SE APLICA` | Não se aplica a esta fase, com o motivo |

O nível 3 (Playwright) é `EXECUTADO AQUI` porque o navegador rodou neste ambiente. Ele roda contra um mock de
`google.script.run` ligado ao backend real do harness, não dentro do quadro (iframe) do HtmlService. O nível 2
(`runAcceptanceTests`) também roda aqui, mas sobre os fakes do harness (`tests/acceptance.test.js`); com os serviços
reais do Google, só na conta do dono.

## 1. Entregas

| Entrega | O que foi entregue | Arquivos | Testes que cobrem | Estado |
|---|---|---|---|---|
| E2.1 NASCIMENTO | Parto simples, gemelar (até 4 crias) e natimorto; peso ao nascer em PESAGENS; cria com ou sem brinco; pai opcional (touro do rebanho ou externo); pasto e raça da mãe por padrão; REPRODUCAO (PARTO) na matriz; avisos de idade reprodutiva e intervalo curto uma vez por parto; número de partos e cria ao pé; parto anterior ao marco zero como histórico (cria HISTORICO); bloco G da ficha (partos) | `EventCatalog`, `EventService`, `Timeline`, `ReproductionService`, `Components`, `Events`, `Animals` | `nascimento.test.js` (CT-01), `regras.fase2.test.js`, `acceptance.test.js`, `ui/movimentos.test.js` (gemelar a 1280 e 360 px), `revisao3.motor.test.js` e `revisao4.motor.test.js` (pai e mãe do parto só de natimorto, pai da cria), `revisao4.interface.test.js` (prévia do parto) | `EXECUTADO AQUI` |
| E2.2 TRANSFERENCIA | Coletiva, tudo ou nada; origem pela linha do tempo na data; destino ativo e diferente; GTA opcional; aviso de lotação em cabeças e em UA/ha | `EventCatalog`, `EventService`, `Timeline`, `InventoryService` | `movimentos.test.js` (CT-02, CT-17 a), `lotacao.test.js`, `acceptance.test.js`, `ui/movimentos.test.js` (erro num animal) | `EXECUTADO AQUI` |
| E2.3 PARCEIROS e COMPRA | Fornecedor validado (inativo recusado como contraparte nova); modalidade × base de peso (cabeça, kg vivo, arroba de peso vivo ou de carcaça, lote); grade de animais novos (em série ou colada da planilha) ou que voltam ao rebanho; lançamento dos animais e de cada frete e outro custo, com parceiro, vencimento e parcelas próprios; rateio 100% ao centavo pelo maior resto; custo de aquisição só pelas alocações; bloco H da ficha | `FinancialService` (novo), `EventCatalog`, `EventService`, `Config`, `AnimalService`, `Components`, `Events`, `Animals` | `compra.test.js` (CT-03, CT-13 a e b, 03b 15.1 linha a linha), `financeiro.test.js`, `acceptance.test.js`, `ui/compra.test.js`, `ui/eventos.fase2.test.js`, `revisao3.financeiro.test.js` e `revisao4.financeiro.test.js` (correção pela tela, custo do animal só do histórico, tipo de cada custo) | `EXECUTADO AQUI`; fórmulas com um caso real: `PENDENTE NA CONTA DO DONO` |
| E2.4 VENDA | Comprador, finalidade, pasto de origem opcional; modalidade × base de peso (com romaneio de carcaça, rendimento negociado ou estimado, ou só o peso do lote com a base estimada pela pesagem anterior); valor bruto como conferência; desconto; parcelas a receber; deduções (frete, comissão, Funrural, taxas), inclusive a descontada pelo comprador; resultado da negociação e depósito esperado calculados no servidor; aviso de carência (bloqueio na finalidade ABATE, conforme a política) | `FinancialService`, `HealthService` (novo, só carência), `EventCatalog`, `EventService`, `Components`, `Events` | `venda.test.js` (CT-04, CT-14, 07 §4.3, 03b §4.4), `financeiro.test.js`, `acceptance.test.js`, `ui/venda.test.js`, `ui/eventos.fase2.test.js`, `revisao3.financeiro.test.js` e `revisao4.financeiro.test.js` (dedução retida, base estimada, correção pela tela) | `EXECUTADO AQUI`; fórmulas com um caso real e PR-09: `PENDENTE NA CONTA DO DONO` |
| E2.5 MORTE e DESCARTE | BAIXAS com causa, diagnóstico, motivo e destino; origem tirada da linha do tempo; MORTO terminal; custo da morte (conta de custeio escolhida) e receita do descarte em uma ou mais parcelas, rateados por cabeça | `EventCatalog`, `EventService`, `Timeline`, `FinancialService` | `movimentos.test.js`, `compra.test.js` (financeiro da morte e do descarte), `revisao1.financeiro.test.js`, `ui/movimentos.test.js` | `EXECUTADO AQUI` |
| E2.6 IDENTIFICACAO, MARCACAO, AJUSTE_INVENTARIO | Pôr, trocar e tirar brinco, chip, SISBOV, tatuagem (o brinco do vendedor só sai), com a ordem conferida e o bloqueio de reuso; marcar e desmarcar para descarte e não localizado (alerta NAO_LOCALIZADO); reclassificação manual (ou volta à automática); baixa por divergência de contagem (crítica) | `EventCatalog`, `EventService`, `Timeline`, `InventoryService` | `identificacao.test.js`, `estorno.test.js`, `ui/eventos.fase2.test.js`, `revisao3.motor.test.js` e `revisao4.motor.test.js` (um número de brinco em um animal por vez, categoria manual × sexo) | `EXECUTADO AQUI`; o modo curral da identificação chega com a pesagem (E3.1) |
| E2.7 Estorno e substituição de qualquer evento; histórico, detalhe e auditoria | Um mecanismo para todos os tipos e subtipos ativos: CONFLICT com o evento que impede, conferência do que a anulação devolve (brinco, sexo e nascimento × filhos, genealogia, categoria), substituto na posição do original (16.1); revisão do estorno com o financeiro que deixa de valer; `evento.listar` e `evento.obter` completos; trilha de auditoria (EVENTOS + AJUSTES + AUDITORIA) com filtros | `EventService`, `Timeline`, `AuditService`, `Events`, `Settings`, `Components` | `estorno.test.js` (CT-07, CT-08, CT-09 completo, CT-17 b, CT-18), `fase2.adversarial.test.js`, `telas.fase2.test.js`, `ui/eventos.fase2.test.js`, `revisao3.*.test.js`, `revisao4.*.test.js`, `ui/revisao3.test.js`, `ui/revisao4.test.js` (o conjunto final no estorno e na correção) | `EXECUTADO AQUI` |
| E2.8 Inventário em data passada; composição do pasto; UA, UA/ha e ocupação | Situação de cada animal na data, estadas por pasto, presentes, dias de permanência (base do rateio da Fase 4); posição com filtros; painel e lista de pastos em qualquer data com "desde quando", peso médio, UA, UA/ha, ocupação e "Sem dado" com o motivo; Visão geral do período com o movimento e as séries mensais | `Timeline`, `InventoryService`, `PastureService`, `Dashboard`, `Pastures` | `lotacao.test.js`, `inventory.test.js`, `telas.pastos-importacao.test.js`, `ui/lotacao.test.js`, `ui/pastos-importacao.test.js` | `EXECUTADO AQUI`; na tela da Visão geral, só o filtro de período (os outros com o dashboard da Fase 5) |
| E2.9 Anexos de evento | Nota fiscal, GTA, laudo e foto em qualquer evento que vale e em cada lançamento financeiro dele; histórico no evento anulado; passam ao substituto na correção; remoção com justificativa; tipos de arquivo conferidos no servidor; envio pelo formulário depois de gravar | `FileService`, `EventService`, `Maintenance`, `Components` (`Anexos`), `Events` | `anexos.test.js`, `ui/anexos.test.js`, `ui/pastos-importacao.test.js` | `EXECUTADO AQUI` (fake do Drive); Drive real: `PENDENTE NA CONTA DO DONO` |
| E2.10 Importadores e reconciliação | COMPRAS, VENDAS, TRANSFERENCIAS, NASCIMENTOS e MORTES nos 10 passos da §14, cada evento pelo mesmo planejamento do formulário num ensaio em memória; histórico anterior ao marco zero (financeiro sem caixa); lotes de eventos inteiros; desfazer com as conferências do estorno; reconciliação com o marco zero, que não bloqueia; uma importação gravando por vez | `ImportService`, `EventService`, `Import` | `import.eventos.test.js`, `revisao1.motor.test.js`, `revisao2.*.test.js`, `revisao3.motor.test.js`, `revisao4.motor.test.js` (brinco na data, desfazer, reconciliação), `unitofwork.adversarial.test.js` (quedas no lote), `ui/importacao.test.js`, `ui/pastos-importacao.test.js`, `ui/revisao3.test.js` | `EXECUTADO AQUI`; tempo com arquivos grandes: `PENDENTE NA CONTA DO DONO` |
| E2.11 Verificação de integridade completa | 26 checagens (eram 20): saída com evento posterior, partos, genealogia, brinco ativo repetido nas identificações, as invariantes do financeiro pela conferência do próprio `FinancialService`, custo de aquisição, tipo do detalhe × subtipo; tempo da verificação (`duracao_ms`) na tela de sistema | `AuditService`, `FinancialService`, `Settings` | `integrity.fase2.test.js` (cada checagem disparada por adulteração; demonstração inteira sem erro), `integrity.test.js`, `revisao3.motor.test.js`, `revisao4.motor.test.js` e `revisao*.financeiro.test.js` (fonte dos eventos, detalhe obrigatório, períodos de brinco, base do rateio) | `EXECUTADO AQUI`; tempo real no Sheets: `PENDENTE NA CONTA DO DONO` |
| Transversal: aceitação, demonstração, jornada e regras | `runAcceptanceTests` com os cenários da Fase 2 (18 cenários no total); base de demonstração completa de 09, seção 7 (304 ativos, 379 comandos, sem nenhuma recusa); jornada de um ano só pela `api()`; mapa RN → teste das 112 regras | `TestRunner` | `acceptance.test.js`, `jornada.fase2.test.js`, `regras.fase2.test.js`, `integrity.fase2.test.js` | `EXECUTADO AQUI` (fakes); na conta: `PENDENTE NA CONTA DO DONO` |

## 2. Resultados dos testes executados aqui

Ambiente: Node 22.23.4 (Linux, 4 núcleos), Playwright 1.63.0 com Chromium. Execução de 15/11/2026, depois do conserto
da rodada 4 de revisão, a última alteração de código desta fase (na etapa deste relatório só mudaram documentos).

### 2.1 Nível 1 — `npm test` (`node --test tests/*.test.js`)

Saída: `# tests 619 · # pass 619 · # fail 0 · # cancelled 0 · # skipped 0 · # todo 0`
(duração 423.9 s; 7 min 4 s de relógio). Contagem por arquivo: os 10 arquivos novos ou alterados desde a entrega
(`api`, `estorno`, `financeiro`, `integrity.fase2` e os seis `revisao3.*` e `revisao4.*`) foram rodados de novo, cada um
sozinho com `node --test <arquivo>`, nesta etapa. Os demais não mudaram desde a contagem da entrega, feita do mesmo
jeito; dos arquivos de apoio, só `tests/apoio-telas.js` mudou, e ele não tem teste próprio. A soma confere com o total
da suíte (555 + 64 testes novos = 619).

| Arquivo | Testes | Aprovados | Falhas | O que cobre |
|---|---:|---:|---:|---|
| `tests/acceptance.test.js` | 6 | 6 | 0 | Os cenários do `runAcceptanceTests` no fake, nas duas ordens de carga: Fase 1 (CT-09, CT-10, CT-11, CT-12 com a reconciliação, CT-18, CT-20, restauração, isolamento) e Fase 2 (CT-01 a CT-04, CT-07, CT-08, CT-13 na compra, CT-14, CT-17, CT-18); retomada, falha relatada, base de demonstração completa e retomável, `runDiagnostics` |
| `tests/anexos.test.js` | 9 | 9 | 0 | Anexos de evento e de lançamento: compra, venda, transferência, morte; estorno com e sem dependente; correção (passam ao substituto), retroativa e em cadeia; remoção; tipos e limites; queda na fase A; rotas |
| `tests/animals.test.js` | 10 | 10 | 0 | Lista, ficha A a J, árvore genealógica, edição com auditoria e ajuste, animal externo |
| `tests/api.test.js` | 14 | 14 | 0 | Envelope, guarda de dono, roteador, avisos com aceite, duplicado, LOCKED, carga condicional (com o catálogo da Fase 2), ambiente TESTE, rascunho (em partes, até 96 KB), fuso, páginas |
| `tests/compra.test.js` | 14 | 14 | 0 | COMPRA: CT-03, CT-13 (a e b), 03b 15.1 linha a linha, modalidades × base de peso, volta ao rebanho, financeiro da morte e do descarte, estorno e correção com dependente, parceiro inativo |
| `tests/config.test.js` | 8 | 8 | 0 | Parâmetros tipados, `config.salvar`, listas, categorias com cobertura, parceiros |
| `tests/database.test.js` | 21 | 21 | 0 | Codec de tipos, corpus nas três formas de gravação, fake que denuncia o tipo esquecido, portas reais |
| `tests/estorno.test.js` | 27 | 27 | 0 | Estorno e substituição de todo tipo ativo: CT-07, CT-08, CT-09 completo, CT-17 (b), CT-18 da Fase 2, dependente e retroativo, o que a anulação devolve (o parto citado uma vez) |
| `tests/events.test.js` | 21 | 21 | 0 | Catálogo (tipos ativos por fase), entradas, CT-09, CT-10, CT-18 da Fase 1, estorno e correção, ajustes; projeção = reconstrução depois de cada comando |
| `tests/fase2.adversarial.test.js` | 11 | 11 | 0 | Ataque: sequências aleatórias (3 sementes × 140 passos) contra modelo de referência, replay e invariantes escritos à parte; casos dirigidos (mesmo dia, cadeia, centavos, arroba, parcelas) |
| `tests/files.test.js` | 5 | 5 | 0 | Drive v3 (pastas, planilha, cópia, lixeira, listagem, bytes, codificações, sonda) e anexos |
| `tests/financeiro.test.js` | 8 | 8 | 0 | `FinancialService` puro: parcelas, rateio pelo maior resto (CT-13 a–d, 1.000 sorteios), negociação por modalidade × base de peso, lançamento no plano, invariantes de 03b, seção 14, totais, tipo de cada custo pela ordem do identificador |
| `tests/harness.test.js` | 25 | 25 | 0 | Fidelidade dos fakes: coerção Geral, buffer e morte, falha injetada, lock com intercalação, Properties, Drive, UrlFetch |
| `tests/identificacao.test.js` | 10 | 10 | 0 | IDENTIFICACAO, MARCACAO, RECLASSIFICACAO e DIVERGENCIA_CONTAGEM: ordem das identificações e marcações, reuso de brinco, estorno e correção |
| `tests/import.test.js` | 9 | 9 | 0 | Importação de ANIMAIS: CT-12 da Fase 1, lotes, queda em cada fronteira, retomar, concluir, desfazer |
| `tests/import.eventos.test.js` | 7 | 7 | 0 | Importação de COMPRAS, VENDAS, TRANSFERENCIAS, NASCIMENTOS e MORTES: histórico, financeiro sem caixa, lotes, estorno e correção com dependente, desfazer, reconciliação, recusas, rotas |
| `tests/integrity.test.js` | 7 | 7 | 0 | Cada checagem da Fase 1 disparada por adulteração à mão |
| `tests/integrity.fase2.test.js` | 10 | 10 | 0 | As checagens da Fase 2, cada uma disparada por adulteração (inclusive o número em dois animais ao mesmo tempo); integridade sem erro sobre a demonstração; tempo medido |
| `tests/interface.test.js` | 8 | 8 | 0 | Página do doGet (compactada), sintaxe do cliente, contraste, alvos de toque, regras estáticas da interface |
| `tests/inventory.test.js` | 4 | 4 | 0 | Posição do rebanho hoje e em data, Visão geral, alertas |
| `tests/jornada.fase1.test.js` | 1 | 1 | 0 | Jornada inteira da Fase 1 só pela `api()`: setup, cadastros, importação de 120 animais, correções, estorno, backup, adulteração, restauração |
| `tests/jornada.fase2.test.js` | 1 | 1 | 0 | Um ano de manejo só pela `api()`: compras, partos, transferências, vendas, mortes, correções, estornos, histórico importado; inventário em 11 datas contra modelo independente, a pagar e a receber, ficha, trilha, integridade |
| `tests/lotacao.test.js` | 14 | 14 | 0 | Inventário histórico, composição do pasto em data, UA, UA/ha, ocupação, dias de permanência, Visão geral do período, aviso de lotação em UA/ha |
| `tests/maintenance.test.js` | 5 | 5 | 0 | Backup com o banco parado, retenção 30 + 12, ensaio completo de restauração, rotina diária |
| `tests/movimentos.test.js` | 12 | 12 | 0 | TRANSFERENCIA, MORTE e DESCARTE: CT-02, CT-17 (a), RN-014 a RN-020, RN-027, RN-028, BAIXAS, fato no dia da saída, estorno e correção com dependente, bloco D da ficha |
| `tests/nascimento.test.js` | 16 | 16 | 0 | NASCIMENTO: CT-01, gemelar, natimorto, peso ao nascer, pai opcional, REPRODUCAO, histórico da matriz, parto antes do marco zero |
| `tests/pastures.test.js` | 7 | 7 | 0 | Propriedades, pastos com posse e arrendador, painel, UA/ha sem transformar ausente em zero |
| `tests/regras.fase1.test.js` | 13 | 13 | 0 | Regras RN da Fase 1 sem teste próprio (com o mapa RN → teste) |
| `tests/regras.fase2.test.js` | 8 | 8 | 0 | Mapa RN → teste verificável das 112 regras de 05 e as RN da Fase 2 sem caso próprio |
| `tests/repository.test.js` | 10 | 10 | 0 | Vigência, leitura memoizada, índices, contadores, órfãs, plano de escrita |
| `tests/revisao1.financeiro.test.js` | 6 | 6 | 0 | Revisão independente, rodada 1, lente FINANCEIRO: um teste por achado |
| `tests/revisao1.motor.test.js` | 14 | 14 | 0 | Revisão independente, rodada 1, lente MOTOR: um teste por achado |
| `tests/revisao2.financeiro.test.js` | 3 | 3 | 0 | Revisão independente, rodada 2, lente FINANCEIRO: um teste por achado |
| `tests/revisao2.motor.test.js` | 13 | 13 | 0 | Revisão independente, rodada 2, lente MOTOR: um teste por achado |
| `tests/revisao3.financeiro.test.js` | 6 | 6 | 0 | Revisão independente, rodada 3, lentes FINANCEIRO e INTERFACE E REGRAS (parte no Node): a prévia da correção pela tela aceita sem mudança e com a mudança pedida; base do rateio de todo critério na integridade |
| `tests/revisao3.interface.test.js` | 2 | 2 | 0 | Rodada 3, INTERFACE E REGRAS (parte no Node): item de lista e parceiro desativados na correção; texto do desfazer da importação pelo tipo |
| `tests/revisao3.motor.test.js` | 24 | 24 | 0 | Rodada 3, lentes MOTOR e CORREÇÕES ANTERIORES: pai do parto, desfazer com touro e com outra importação em curso, registros antigos no estorno, detalhe obrigatório, brinco na data, períodos de brinco, reconciliação, genealogia e conflitos |
| `tests/revisao4.financeiro.test.js` | 5 | 5 | 0 | Rodada 4, FINANCEIRO: lote de um animal por carcaça e registro histórico corrigidos pela tela; custo do animal só do histórico; tipo de cada custo com a aba classificada; base estimada da venda |
| `tests/revisao4.interface.test.js` | 7 | 7 | 0 | Rodada 4, INTERFACE E REGRAS (parte no Node): prévia do parto, revisão da correção (tirados, documentos do original, custo da morte), seletor pelo sexo, ajuda, limite do rascunho |
| `tests/revisao4.motor.test.js` | 20 | 20 | 0 | Rodada 4, MOTOR e CORREÇÕES ANTERIORES: brinco no estorno e no desfazer, pai da cria × parto, fonte dos eventos, chegada × nascimento, categoria × sexo, ordem da ficha, reconciliação, desativados, conflito de genealogia |
| `tests/schema.test.js` | 13 | 13 | 0 | 34 abas × dicionários de dados; gerador idempotente |
| `tests/setup.test.js` | 5 | 5 | 0 | CT-11: setup repetido, sementes, gatilhos, proteção, esquema da fase seguinte, falha da forma de gravação |
| `tests/static.test.js` | 19 | 19 | 0 | Lint de camadas, superfície pública, regra do `drive.file`, relógio, manifesto, rotas (canônicas e extras documentadas), includes |
| `tests/telas.test.js` | 7 | 7 | 0 | Rotas acrescentadas pelas telas e regras puras do cliente (CSV, rótulos) |
| `tests/telas.fase2.test.js` | 6 | 6 | 0 | Peças puras do cliente da Fase 2: grade em série e colada, parcelas, campo do subtipo, nota da correção, financeiro do estorno |
| `tests/telas.pastos-importacao.test.js` | 4 | 4 | 0 | `pasto.listar` em data, "Sem dado" com o motivo, linhas do lançamento na importação, confirmação parcial |
| `tests/timeline.test.js` | 12 | 12 | 0 | Ordem canônica, validador da linha do tempo, marco zero, projetor, inventário em data |
| `tests/unitofwork.test.js` | 32 | 32 | 0 | Três fases, todas as quedas de 06 (5.1 e 5.2), reentrância, intercalações, idempotência |
| `tests/unitofwork.adversarial.test.js` | 53 | 53 | 0 | Morte depois de cada escrita (inclusive venda do CT-04, estorno de transferência, correção de compra e lote de importação de eventos), subconjuntos densos, oráculos independentes, intercalações, dois bancos, resposta perdida, células hostis |
| `tests/utils.test.js` | 18 | 18 | 0 | Datas, dinheiro, rateio pelo maior resto, brinco, JSON canônico, hash, número no formato brasileiro, soma de meses |
| `tests/validation.test.js` | 14 | 14 | 0 | Erros do app, validadores por tipo, registro contra a aba, coletor |
| `tests/venda.test.js` | 15 | 15 | 0 | VENDA: CT-04, CT-14, exemplos de 07 §4.3 e 03b §4.4, bloco H, carência, deduções retidas, estorno e correção com recompra |
| **Total** | **619** | **619** | **0** | |

### 2.2 Nível 3 — `npm run ui:check`

Parte estática: `ui:check — 10 arquivo(s) .html conferidos (e a página montada pelo doGet), sem recurso externo e dentro do orçamento (página montada: 446 KB de 450 KB).` Parte Playwright: `# tests 85 · # pass 85 · # fail
0 · # cancelled 0 · # skipped 0 · # todo 0` (duração 223.7 s; 3 min 44 s de relógio com a parte estática). Contagem
por arquivo: os 4 arquivos novos ou alterados desde a entrega (`revisao3`, `revisao4`, `telas` e `venda`) foram rodados
de novo nesta etapa, cada um sozinho com `node --test --test-concurrency=1 <arquivo>`; os demais não mudaram desde a
contagem da entrega. A soma confere com o total (77 + 8 = 85):

| Arquivo | Testes | Aprovados | Falhas | O que cobre |
|---|---:|---:|---:|---|
| `tests/ui/anexos.test.js` | 1 | 1 | 0 | Detalhe da compra com documentos (nota fiscal, boleto do frete, tipo recusado, remover, histórico do estornado) a 360 px |
| `tests/ui/compra.test.js` | 4 | 4 | 0 | Compra pela tela: negociação, grade, parcela e frete, revisão do servidor, custo por animal na ficha, a 1280 e 360 px |
| `tests/ui/eventos.fase2.test.js` | 9 | 9 | 0 | CT-03 e CT-04 inteiros pela tela, colar da planilha, estorno com dependente e auditoria, manejo pela ficha com as correções |
| `tests/ui/importacao.test.js` | 2 | 2 | 0 | Importação de transferências a 1280 e 360 px, com a reconciliação no relatório final |
| `tests/ui/interface.test.js` | 17 | 17 | 0 | Carga, navegação, formulário do catálogo, "hoje" no fuso da fazenda, avisos, erro por animal, rascunho, LOCKED, sem resposta, faixas, leiaute 360 e 1280 px, acessibilidade |
| `tests/ui/lotacao.test.js` | 4 | 4 | 0 | Visão geral com o período, o movimento e as séries mensais; painel do pasto em data passada com os dias de permanência |
| `tests/ui/movimentos.test.js` | 7 | 7 | 0 | Parto pela ficha da mãe (gêmeo natimorto) e transferência com erro em 1 de 3, a 1280 e 360 px; morte; correção do parto; transferência com data passada (posição na data pelo servidor) |
| `tests/ui/pastos-importacao.test.js` | 6 | 6 | 0 | Pastos numa data passada com "Sem dado" e o motivo; importação de compras com "Deixar de fora" e a reconciliação; GTA enviada pelo formulário |
| `tests/ui/revisao1.test.js` | 6 | 6 | 0 | Revisão independente, rodada 1: achados de interface |
| `tests/ui/revisao2.test.js` | 6 | 6 | 0 | Revisão independente, rodada 2: achados de interface |
| `tests/ui/revisao3.test.js` | 4 | 4 | 0 | Revisão independente, rodada 3: rascunho no servidor sem `localStorage` (80 animais), correção de venda com itens desativados, confirmação do desfazer de transferências, rascunho ENVIANDO na Visão geral |
| `tests/ui/revisao4.test.js` | 4 | 4 | 0 | Revisão independente, rodada 4: subtipo só para leitura na correção, linha do tempo da ficha pelo nome, pasto desativado sem ações impossíveis, documentos do original na correção |
| `tests/ui/telas.test.js` | 12 | 12 | 0 | Cadastrar, editar, importar, estornar e corrigir, exportar CSV, a 1280 e 360 px; pastos, configurações, sistema; fotos e documentos; linha do tempo da ficha com a data legível, sem o código cru |
| `tests/ui/venda.test.js` | 3 | 3 | 0 | Venda pela ficha (kg vivo, comissão, revisão do servidor, ficha com a receita) e correção da venda com frete retido (o vencimento à vista já vem vazio) |
| **Total** | **85** | **85** | **0** | |

### 2.3 Cenários da Fase 2 por nível

| Cenário (09-plano-de-testes.md) | Nível 1 (Node) | Nível 2 (conta do dono) | Nível 3 (navegador) |
|---|---|---|---|
| CT-01 Nascimento | `EXECUTADO AQUI` (`nascimento.test.js`, `regras.fase2.test.js`, `acceptance.test.js`) | `PENDENTE NA CONTA DO DONO` | `EXECUTADO AQUI` (parto gemelar, `ui/movimentos.test.js`) |
| CT-02 Transferência | `EXECUTADO AQUI` (`movimentos.test.js`, `lotacao.test.js`, `acceptance.test.js`) | `PENDENTE NA CONTA DO DONO` | `EXECUTADO AQUI` (erro num animal, `ui/movimentos.test.js`) |
| CT-03 Compra | `EXECUTADO AQUI` (`compra.test.js`, `acceptance.test.js`); passo 4, resultado gerencial de fevereiro: `NÃO SE APLICA` (Fase 4) | `PENDENTE NA CONTA DO DONO` | `EXECUTADO AQUI` (`ui/eventos.fase2.test.js`, `ui/compra.test.js`) |
| CT-04 Venda | `EXECUTADO AQUI` (`venda.test.js`, `acceptance.test.js`; quedas com a venda como comando-modelo em `unitofwork.adversarial.test.js`) | `PENDENTE NA CONTA DO DONO` | `EXECUTADO AQUI` (`ui/eventos.fase2.test.js`, `ui/venda.test.js`) |
| CT-07 Estorno | `EXECUTADO AQUI` (`estorno.test.js`, `acceptance.test.js`, quedas do estorno de transferência) | `PENDENTE NA CONTA DO DONO` | `EXECUTADO AQUI` (estorno com dependente, `ui/eventos.fase2.test.js`) |
| CT-08 Histórico (inventário em qualquer data) | `EXECUTADO AQUI` (`estorno.test.js`, `lotacao.test.js`, `acceptance.test.js`, `jornada.fase2.test.js`) | `PENDENTE NA CONTA DO DONO` | — |
| CT-09 Integridade, completo | `EXECUTADO AQUI` (`estorno.test.js`, `events.test.js`, `acceptance.test.js`: venda de vendido, transferência de morto, brinco do vendido, identificação de morto, compra de vendido antes e depois da saída) | `PENDENTE NA CONTA DO DONO` | — |
| CT-13 Rateio com centavos (na compra) | `EXECUTADO AQUI` (a e b: `compra.test.js`, `financeiro.test.js` com 1.000 sorteios, `utils.test.js`, `acceptance.test.js`); c a f, pelo evento RATEIO: `NÃO SE APLICA` (Fase 4) | `PENDENTE NA CONTA DO DONO` | — |
| CT-14 Venda por arroba | `EXECUTADO AQUI` (`venda.test.js`, `financeiro.test.js`, `acceptance.test.js`) | `PENDENTE NA CONTA DO DONO` | — |
| CT-17 Retroativo e mesmo dia | `EXECUTADO AQUI` ((a) `movimentos.test.js`; (b) com a IDENTIFICACAO no lugar da pesagem, `estorno.test.js`; `acceptance.test.js`) | `PENDENTE NA CONTA DO DONO` | — |
| CT-18 Substituição de evento que cria animais (compra) | `EXECUTADO AQUI` (`compra.test.js`, `estorno.test.js`, `acceptance.test.js`; quedas da correção de compra); a pesagem de 12/02: `NÃO SE APLICA` (Fase 3) | `PENDENTE NA CONTA DO DONO` | — |
| CT-12 Importação, com a reconciliação | `EXECUTADO AQUI` (`import.eventos.test.js`, `acceptance.test.js`, `jornada.fase2.test.js`) | `PENDENTE NA CONTA DO DONO` | `EXECUTADO AQUI` (`ui/importacao.test.js`, `ui/pastos-importacao.test.js`) |
| CT-10, CT-11 e CT-20 (Fase 1, de novo com o código da Fase 2) | `EXECUTADO AQUI` (`events.test.js`, `setup.test.js`, `database.test.js`, `acceptance.test.js`); CT-10 passo 3 (pesagem): `NÃO SE APLICA` (Fase 3) | `PENDENTE NA CONTA DO DONO`, inclusive a página de concorrência | — |
| CT-15 Estorno × parcela liquidada | Parcial: o bloqueio do estorno e da correção com parcela paga (RN-042) é testado com a parcela liquidada à mão (`compra.test.js`, `venda.test.js`); a baixa e o transporte dela (RN-046): `NÃO SE APLICA` (Fase 4) | `NÃO SE APLICA` (Fase 4) | — |
| Quedas do protocolo com os comandos-modelo da Fase 2 (venda do CT-04, estorno de transferência, correção de compra, lote de importação de eventos) | `EXECUTADO AQUI` (`unitofwork.adversarial.test.js`, nas três formas de gravação) | `NÃO SE APLICA`: não há como matar a execução real num ponto exato (09, seção 1) | — |
| Base de demonstração completa, sem nenhuma recusa (09, seção 8) | `EXECUTADO AQUI` (`acceptance.test.js`, `integrity.fase2.test.js`) | `PENDENTE NA CONTA DO DONO` (opcional) | — |
| CT-05, CT-06 (pesagem, vacinação); CT-16 (exportação XLSX e PDF); CT-19 (conciliação) | `NÃO SE APLICA`: Fases 3, 5 e 4 (o CSV do CT-16 já tem teste de tela desde a Fase 1) | `NÃO SE APLICA` | — |

## 3. O que só o dono pode executar (PENDENTE)

Nada abaixo foi executado. O roteiro está em `docs/GUIA_DE_IMPLANTACAO.md` (seção 11.1 para quem já tem a Fase 1).

| Item | Como | Evidência a devolver | Estado |
|---|---|---|---|
| Itens da Fase 1 ainda abertos: implantar, `setup`, `runDiagnostics` (SP-01 a SP-10, fuso), página de concorrência, marco zero | `docs/RELATORIO_FASE1.md`, seção 3 | Os arquivos de lá | `PENDENTE NA CONTA DO DONO` |
| Atualizar o código (34 arquivos, com o `HealthService`) e rodar `setup` | Guia, seção 11.1, passos 1 a 3 | Linha `setup: {...}` do registro (integridade com as 26 conferências, sem erro) | `PENDENTE NA CONTA DO DONO`. Desde as rodadas 3 e 4, a verificação dá ERRO numa base que já tenha o mesmo brinco em dois animais em períodos sobrepostos, evento sem o detalhe obrigatório ou sem as linhas dos animais, chegada antes do nascimento ou categoria manual de outro sexo (IDENTIFICACOES_ATIVAS, COPIAS, FINANCEIRO, LINHA_DO_TEMPO). Rodar a verificação logo depois do `setup` |
| `runAcceptanceTests` com os cenários das Fases 1 e 2 (18 cenários: PREPARO, CT-09, CT-01, CT-02, CT-03, CT-04, CT-07, CT-08, CT-13, CT-14, CT-17, CT-18, CT-10, CT-12, RESTAURACAO, CT-20, CT-11, ISOLAMENTO) | Guia, seção 6, até `completo: true` (várias execuções) | Arquivo `ERP Pecuário — relatório de aceitação <instante>.json` | `PENDENTE NA CONTA DO DONO` |
| **Validar as fórmulas de compra e venda com um caso real** | Guia, seção 11.1, passo 5: lançar uma compra e uma venda que já estão no papel, com a nota fiscal e o romaneio, e comparar o valor de cada animal, o custo de aquisição, as parcelas, o frete, as deduções e o depósito esperado | O lançamento e a nota (ou "conferiu") | `PENDENTE NA CONTA DO DONO` |
| **Confirmar a premissa PR-09** (vendas para frigorífico por carcaça e de reposição por cabeça ou kg vivo) | Responder como vende hoje | A resposta | `PENDENTE NA CONTA DO DONO`; todas as modalidades já existem, e a resposta só define um padrão sugerido |
| **Ratificar duas decisões da rodada 4 de revisão**: (a) o animal que só existe no histórico tem como custo de aquisição a compra histórica (`Timeline.entradaDoCusto`); (b) o tipo de cada custo da compra (frete ou outro) sai da ordem do `financial_id` | Ler `CONTRATOS.md`, seções 13 e 26 (ou a seção 4, itens 2 e 6, deste relatório), e responder se valem; aprovadas, entram em `04` (seção 6) e `03b` (2.6 e 4.1) | A resposta | `PENDENTE NA CONTA DO DONO` |
| Tempo da verificação de integridade com a base real | **Configurações → Sistema → Verificar a integridade agora** | O tempo mostrado na tela (`duracao_ms`) | `PENDENTE NA CONTA DO DONO` |
| Anexos no Drive real (nota fiscal, GTA, arquivos de até 5 MB pelo `google.script.run`) | Anexar uma nota fiscal a uma compra, abrir e remover | Relato | `PENDENTE NA CONTA DO DONO` |
| Importação do histórico com a base do dono (tempo com arquivos grandes, reconciliação) | Guia, seção 8, passo 6 | Relatório final da importação | `PENDENTE NA CONTA DO DONO` (opcional) |
| Base de demonstração (379 comandos; estimativa de 15 a 25 minutos em execuções de uns 4 minutos, não medida) | Guia, seção 6, "Base de demonstração" | O relatório `plano: DEMO` | `PENDENTE NA CONTA DO DONO` (opcional) |
| Telas novas no celular, no quadro do HtmlService (compra, venda, parto, seletor com data passada) | Usar o app no celular | Relato | `PENDENTE NA CONTA DO DONO` |

Com esses resultados, o próximo passo é: corrigir o que divergir (fake, código ou fórmula), com registro no
`CHANGELOG`; marcar a validação da Fase 2 no checklist do plano; e só então dar a Fase 2 por fechada.

## 4. Decisões tomadas durante a implementação

Além das decisões do desenho (seções 16 e 17 do desenho-base). O detalhe de cada uma está em `docs/CHANGELOG.md` e nos
contratos (`docs/CONTRATOS.md`). As que contrariavam um documento da Fase 0 levaram à atualização do trecho, listada no
item 13.

1. **Catálogo.** `EventCatalog.FASE_ATUAL = 2`; tipo ou subtipo só fica ativo com campos (o subtipo passou a exigir
   `campos_animal`); tipo com subtipos exige o subtipo; o subtipo pode ter campos de cabeçalho próprios (o motivo da
   marcação para descarte). O Nascimento ficou no grupo Reprodução. A regra de data antes do marco zero é do catálogo
   (`aceita_historico`), e a tela a segue.
2. **Marco zero e histórico.** No formulário, só o parto aceita data antiga (cria HISTORICO, sem lotação). Compra,
   venda, transferência e morte antigas entram pela importação, com o financeiro do evento sem caixa (sem parcela). O
   registro antigo se confere com a **chegada declarada** (no rebanho inicial, a data de entrada informada; no animal
   comprado, a data da compra). A situação cadastral só muda por linha de inventário: um fato neutro depois do marco
   zero não tira o animal do histórico. O custo de aquisição é o das alocações do período que começa na entrada vigente
   mais recente. Desde a rodada 4 de revisão, o animal que só existe no histórico (comprado ou nascido e vendido antes do
   marco zero) usa a entrada histórica mais recente (`Timeline.entradaDoCusto`, a mesma fronteira no projetor, na ficha e
   na invariante 18); o animal do marco zero continua sem a compra histórica de antes da entrada dele (04, seção 6). Na
   correção de quem criou o animal, a chegada, o sexo, o nascimento, a mãe e o pai conferidos são os do conjunto final (o
   substituto com as correções de cadastro vigentes), e a chegada não pode ficar antes do nascimento (rodadas 3 e 4).
3. **Linha do tempo.** Fato (parto, identificação, marcação) vale no dia da saída, com limites inclusivos (RN-017); o
   seletor e `inventario.elegiveis` concordam com isso. A origem de uma saída vem da linha do tempo
   (`Timeline.pastoAntesDaSaida`) e nunca vira erro próprio do comando: o problema mostrado é o registro que a quebrou.
   Um retroativo que mudaria a origem de uma saída posterior dá CONFLICT (03b, seção 3: origem imutável; 04, seção 5.2),
   com a mensagem do caminho que funciona: estornar a saída, lançar o retroativo e registrá-la de novo. Os fatos do mesmo
   dia seguem a posição do substituto na cadeia (desenho-base 16.1) também em identificações, reclassificações,
   correções de cadastro, peso atual, situação reprodutiva e base estimada da venda. Toda consulta que refaz a linha do
   tempo declara acesso cru; sem ele, `Timeline.fonte` falha cedo em vez de errar a ordem em silêncio.
4. **Estorno e correção.** Um mecanismo para todos os tipos. Além dos eventos posteriores, confere o que a anulação
   devolve ao animal: brinco que hoje é de outro (o dono é conferido no estado de depois do comando), sexo e nascimento
   que não cabem com os filhos, mãe macho, pai fêmea, ciclo, categoria manual desativada, matriz de parto de natimorto.
   O conflito tem a forma `{event_id, tipo, subtipo, data, nome}`. Na correção, valem os itens de lista, os parceiros, as
   contas, as categorias, os pastos e as propriedades desativados que o original já usava. O resultado de uma correção
   não oferece "Desfazer" (o original não volta). Nas rodadas 3 e 4 de revisão, a regra passou a ser o **conjunto final
   em todo caminho**: o estorno, a correção e o desfazer da importação conferem o estado inteiro que deixam, com os
   registros anteriores ao marco zero contra o nascimento e a chegada que voltam, os períodos de uso de cada número de
   brinco, o touro dos registros reprodutivos (RN-012), a categoria manual contra o sexo final (`CATEGORIA_INCOMPATIVEL`)
   e o pai do parto contra o da cria corrigida pelo cadastro (`PAI_DA_CRIA`). O conflito cita cada lançamento uma vez,
   com o tipo, a data e o nome dele, e, quando o vínculo de genealogia veio de uma correção de cadastro, cita essa
   correção.
5. **Nascimento.** Até 4 crias por parto (o desenho não tinha limite). O pai pode ser qualquer macho não anulado, mesmo
   já vendido ou morto (pode ter saído durante a gestação); a regra "ATIVO ou EXTERNO" da RN-060 fica para os eventos
   reprodutivos da Fase 3. Segundo parto da mesma mãe no mesmo dia é aviso com aceite. Número de partos = o maior entre
   os partos prévios declarados e os registrados antes da entrada, mais os registrados depois, contado da primeira
   entrada. Mãe, nascimento, origem e pai de cria nascida na fazenda só se corrigem pelo parto.
6. **Compra.** Exige fornecedor, pasto do lote e ao menos uma parcela; as parcelas nascem sempre em aberto (não há
   "pago no ato" antes da baixa da Fase 4, para não travar o estorno). Um critério de rateio por evento (outro critério
   por lançamento exige o evento RATEIO, Fase 4). Só com o peso do lote, kg vivo e arroba caem para cabeças, com aviso;
   peso de só alguns animais é erro. Arroba de carcaça exige o romaneio de cada animal. Animal externo (de referência)
   não é comprado: o que chega à fazenda entra como animal novo. Frete, outros custos, custo da morte e receita do
   descarte aceitam "Em quantas vezes" (parcelas mensais iguais). O tipo de cada custo acessório (frete ou outro) sai da
   ordem do `financial_id`, e os fretes recebem os menores identificadores. Não conta a ordem física das linhas, que o
   dono pode classificar. Não foi criada chave nova no payload (03b, 2.6) (rodada 4).
7. **Venda.** Os valores por animal somam a receita (bruto menos desconto comercial); o bruto da nota é conferência. A
   dedução descontada pelo comprador grava um título em aberto que vence num recebimento da venda, para o encontro de
   contas da Fase 4. Só com o peso do lote, a base de rateio é a última pesagem de cada animal escalada para o lote
   (registrada como estimada); sem pesagem de todos, por cabeça. Arroba de carcaça aceita só o total do romaneio, com
   aviso. A carência (RN-072) nasceu num `HealthService` só com essa regra; a política de bloqueio vale só na finalidade
   ABATE. A dedução retida sem "Pago a" é do comprador. A integridade confere que ela vence num recebimento da venda, mas
   não exige que o parceiro seja o comprador, porque o catálogo aceita outro (rodada 3).
8. **Identificação, marcação e ajustes.** A retirada de brinco grava uma linha com o código tirado e o motivo; o tipo
   de identificação vai no cabeçalho; o brinco do vendedor só nasce na compra e, depois, só sai. Ordem das
   identificações e das marcações conferida (`Timeline.validarIdentificacoes`, `validarMarcacoes`). Com o reuso
   desligado, o número que um animal deixa não vai para outro no mesmo lançamento. Com o reuso ligado ou desligado, um
   número fica em um animal por vez: nenhum período de uso pode cruzar o de outro animal (`conferirPeriodosDeBrinco_`, no
   registro, na correção, no estorno e no desfazer; CONFLICT `BRINCO_DUPLICADO` com o registro do outro animal; rodadas 3
   e 4). O número corrigido por "brinco lançado errado" não conta (desenho-base 16.2). A reclassificação confere a
   categoria ativa e do sexo; idade e condição não contam. A baixa por divergência é crítica e guarda a justificativa em
   `payload_json.motivo_ajuste` (não há linha de AJUSTES nesse subtipo).
9. **Financeiro e integridade.** A integridade não reescreve as regras do financeiro: chama o `FinancialService.conferir`
   e distribui as invariantes pelas checagens. O 100% alocado vale também no valor de abertura, no custo da morte e na
   receita do descarte; `EVENTOS.total_value` é conferido em todo tipo; a soma das parcelas ignora a CANCELADA. Checagens
   novas: BAIXADO_SEM_POSTERIOR, PARTOS (pelos atributos do próprio nascimento), GENEALOGIA, IDENTIFICACOES_ATIVAS (só
   brinco), FINANCEIRO, CUSTO_AQUISICAO, e COPIAS passou a conferir o tipo do detalhe com o subtipo. A ficha soma só a
   passagem atual do animal; a Visão geral lê compras e vendas pelas alocações, nunca por `valor_individual`. Depois
   das rodadas 3 e 4 continuam 26 checagens, mais exigentes. COPIAS confere a fonte de cada evento vigente: as linhas dos
   animais com o papel e o efeito do tipo, o pasto do movimento, o `pre_marco_zero` pela data e o detalhe obrigatório de
   cada animal. Esse achado continua depois do reparo RECONSTRUIR. FINANCEIRO exige uma linha de COMPRAS ou VENDAS por
   evento e confere o vencimento da dedução retida. IDENTIFICACOES_ATIVAS acusa o número em dois animais ao mesmo tempo.
   GENEALOGIA confere o touro. LINHA_DO_TEMPO acusa a chegada antes do nascimento e a categoria manual de outro sexo.
   BASE_RATEIO recalcula todo critério do evento, inclusive a base estimada da venda, e dá alerta.
10. **Inventário e lotação.** Peso vigente = o último conhecido até a data, dentro da validade; vencido ou ausente, o de
    referência da categoria, marcado como estimado; sem peso nenhum, fora da UA e contado, nunca zero. Dias de
    permanência com os dois limites inclusivos. Visão geral padrão dos últimos 12 meses. Aviso de lotação um por pasto,
    também em UA/ha, comparado na precisão da capacidade (4 casas).
11. **Anexos e importação.** O anexo enviado depois do registro leva o `event_id` (03a, 5.1, atualizado); o de
    lançamento usa a entidade FINANCEIRO; laudo é DOCUMENTO; o de evento anulado é histórico; na correção os anexos
    passam ao substituto pelo papel e pela ordem dos lançamentos; o arquivo só vai para a lixeira quando nenhuma linha
    consultável o usa; só imagem e PDF. Importação de eventos: ensaio em memória em que os eventos anteriores do arquivo
    valem; bloco = eventos inteiros; duplicidade no arquivo e na base (gêmeos sem brinco não são repetição; a
    transferência só é repetida com a mesma origem e o mesmo destino); 0,00 = "não houve"; coluna "descontado pelo
    comprador" por dedução; uma importação gravando por vez; o desfazer faz as mesmas conferências do estorno. A
    reconciliação não tem tabela própria de decisão: cada divergência traz a ação pelos próprios lançamentos. Rodadas 3
    e 4: na importação de eventos, o brinco vale pelo uso na data do evento. Antes de todo uso, vale o primeiro dono; sem
    dono na data, ou com o número em dois animais, a importação pede o código interno. O desfazer de uma importação
    concluída é recusado enquanto outra está em curso; a que está em curso continua podendo ser desfeita (16.8). O
    desfazer também confere o touro dos partos e o valor alocado ao animal por outro lançamento. O rebanho inicial
    importado não recebe o número que outro animal usava no marco zero. Na reconciliação, a decisão do dono entra pelos
    lançamentos datados do marco zero (correção de localização, baixa na contagem, outra entrada), e a divergência
    tratada sai do relatório.
12. **Interface e aceitação.** A página vai compactada ao aparelho (`Api.compactar`: de 441 KB para cerca de 411 KB na
    etapa de telas; 437 KB na entrega; hoje, depois das rodadas 3 e 4, 446 KB de 450 KB). O modo curral da
    identificação fica para a Fase 3 (o componente é o da pesagem); nesta fase, seletor e cartão por animal, com o mesmo
    pedido e a mesma validação. "Registrar" com rascunho
    em envio pergunta ao servidor antes de apagar, também pelo "Descartar" da Visão geral (rodada 3). O rascunho no
    servidor (sem `localStorage`) vai em partes de 8 KB, com até 96 KB por rascunho e 400 KB no total, e a tela só diz
    "guardado" depois da confirmação (rodada 3). A prévia da correção deixa vazio o valor igual ao que o servidor propôs
    (descrição, vencimento à vista, parceiro e vencimento da retida, parcela única, pasto e raça da cria), para que ele
    acompanhe a mudança (`evento.obter.propostas` no parto). O item desativado do original aparece pelo nome, com "—
    desativado", e o subtipo fica só para leitura (rodadas 3 e 4). Os cenários da Fase 2 rodam no `runAcceptanceTests`
    antes do CT-11, com datas contadas do marco zero e pastos e parceiros próprios. A base de demonstração atinge as
    metas de 09, seção 7 (255 nascidos, 70 comprados, 240 vendidos, 15 mortes, 5 descartes, 1 baixa → 304), grava um
    comando por passo e não continua uma base DEMO da versão anterior.
13. **Documentos da Fase 0 atualizados nesta entrega** (registro no `CHANGELOG`): `03a` 4.3.4 (só linha de inventário
    decide as ordens 2 e 3; o animal externo não entra pela compra) e 5.1 (`event_id` e entidade FINANCEIRO nos
    anexos); `03b` 2.6 (`motivo_ajuste`) e 14 (invariantes 10 e 16 estendidas); `04` 6 (chegada declarada, histórico pela
    importação, custo de aquisição, reconciliação sem tabela de decisão); `06` 9 (checagens da Fase 2); `08` 4.2
    (Nascimento em Reprodução); `09` 5 (a varredura de quedas como foi executada); `10` 4 e 8 (arquivos da fase e uma
    linha por entrega); `11` (riscos R-02, R-12, R-13, R-24, R-25, R-27, R-30, o novo R-31, limitações e PR-09).
14. **Testes de fases anteriores atualizados ao comportamento novo, sem enfraquecer** (cada um registrado na etapa
    correspondente do `CHANGELOG`): listas de tipos ativos (a Fase 1 continua conferida por `tiposAtivos(1)`), bloco G
    parcial na ficha, catálogo no bootstrap, seletor de tipos, contagens da demonstração (314, 308 e 304 ativos ao longo
    da fase), o aviso de lotação em UA/ha aceito, `importacao.modelo` com os seis tipos, a forma do relatório de
    integridade (`duracao_ms`, 26 checagens), `conflito.tipo` sem o subtipo e textos de tela que reproduziam as frases
    erradas apontadas pela revisão. Nas rodadas 3 e 4: `estorno.test.js` (o parto citado uma vez, como
    `PARTO_DA_MATRIZ`), `integrity.fase2.test.js` (o número em dois animais agora acusado), `api.test.js` (rascunho em
    partes, limite de 96 KB), `ui/venda.test.js` (o vencimento à vista já vem vazio), `financeiro.test.js`
    (`tiposDosCustos` pela ordem do identificador, com as linhas embaralhadas) e `ui/telas.test.js` (a linha do tempo da
    ficha com a data em dd/mm/aaaa, não o código cru).

## 5. Limitações conhecidas

1. **Nada foi validado no ambiente real.** Valem as hipóteses dos fakes da Fase 1 (`CONTRATOS.md`, seção 6.5) e, na
   Fase 2, também as do Drive para os anexos (leitura de bytes por `alt=media`, arquivos de até 5 MB pelo
   `google.script.run`).
2. **Financeiro da Fase 2 é o do evento.** Baixa e desfazer baixa de parcela, encontro de contas da dedução descontada
   pelo comprador, transporte da baixa na correção (RN-046), evento RATEIO (re-rateio, critério diferente por
   lançamento, CT-13 c a f), fluxo de caixa e resultado gerencial: Fase 4. Até lá, toda parcela nasce em aberto, e a
   correção de evento com parcela paga é recusada (`PARCELA_LIQUIDADA`).
3. **Parcelas dos custos acessórios** (frete, outros custos, custo da morte, receita do descarte) só em vezes mensais
   iguais; datas e valores livres por parcela pedem um grupo aninhado no formulário ou o lançamento avulso da Fase 4.
4. **Retroativo antes de uma saída** que muda a origem dela é recusado; a origem não se recalcula sozinha por
   substituto automático. O caminho é estornar a saída, lançar o retroativo e registrar a saída de novo.
5. **Custo de aquisição pela compra histórica** para o animal do marco zero sem valor de abertura (04, seção 6) não
   está implementado: fica com o valor de abertura da Fase 4 (E4.6). O animal que só existe no histórico já tem o custo
   da compra histórica (rodada 4; item 15).
6. **Reconciliação** sem registro formal de decisão por divergência; a trilha são os próprios lançamentos de
   correção, datados do marco zero. A divergência FORA_DA_FOTOGRAFIA de um animal que saiu por descarte antes do marco
   zero continua listada, porque o descarte antigo não tem registro (item 7).
7. **Importação**: o custo opcional da morte e as reentradas por outra entrada ou descarte não estão no modelo de
   colunas; pesagens, sanidade, reprodução e ocorrências respondem `TIPO_INDISPONIVEL` (Fase 3). O descarte anterior ao
   marco zero não entra por caminho nenhum (nem formulário nem importação), e a reconciliação diz isso na ação.
8. **Carência** depende do evento SANIDADE (Fase 3): hoje as aplicações só existem nos testes; o alerta "animais em
   carência" também é da Fase 3.
9. **Telas**: o modo curral da identificação chega com a pesagem (E3.1); na Visão geral, só o filtro de período está na
   tela (os filtros de propriedade, pasto, sexo e categoria existem no servidor); o alerta "pasto acima da capacidade"
   não está em `alerta.listar` (a regra existe em `PastureService.lotacao`); com data retroativa, os modos Filtros e
   Busca do seletor marcam pela posição na data, mas só listam os animais que o aparelho já tem (o que estava no pasto e
   saiu depois aparece pelo "Todos do pasto"); arquivos escolhidos no formulário não sobrevivem a recarregar a página
   (podem ser anexados depois pelo detalhe); o bloco D da ficha conta o período em aberto até ontem, e
   `diasPermanencia` até hoje (diferença de um dia, documentada). Sem `localStorage`, o rascunho acima de 96 KB (lotes de
   muitas centenas de animais) não é guardado no servidor: a faixa avisa, e a saída do formulário diz que não foi
   guardado. Dividir em mais partes esbarraria na cota de 500 KB das propriedades do usuário.
10. **Integridade** ainda não confere se o `event_id` de um anexo bate com o do registro dono; estoque de insumos e
    custo de sanidade só terão dados a conferir na Fase 3.
11. **Desempenho não medido no Apps Script**: importação de arquivos perto de 20 mil linhas (o ensaio roda o motor uma
    vez por evento a cada bloco de validação; `importacao.linhas` relê tudo a cada página), séries mensais da Visão
    geral, verificação de integridade com a base real (no fake, com a demonstração, de 150 a 165 ms com o arquivo
    rodado sozinho nesta etapa; eram cerca de 55 ms antes das conferências novas das rodadas 3 e 4) e a base de
    demonstração inteira. SP-05 da Fase 1 continua parcial.
12. **Orçamento da página**: 446 KB de 450 KB (eram 437 KB na entrega; as rodadas 3 e 4 somaram 9 KB); as telas das
    Fases 3 a 5 vão precisar carregar sob demanda (risco R-31), e sobram só 4 KB para consertos.
13. **Testes**: a varredura de quedas usa um critério menor que o de 09, seção 5 (todos os subconjuntos até 5 escritas
    e 24 sorteados nos pontos de buffer cheio, em vez de 10 e 500), por tempo; as intercalações de concorrência seguem
    testadas só com o comando de exemplo, não com venda, compra ou estorno; ficaram fora do modelo aleatório (só em
    testes dirigidos) LOTE com MANUAL, PESO_CARCACA e VALOR_INDIVIDUAL, ARROBA, reclassificação, correção de cadastro,
    parto antes do marco zero, carência, período bloqueado, brinco com reuso ligado e pai externo. Nesta execução, o
    `npm test` levou cerca de 7 minutos (424 s) e o `npm run ui:check` cerca de 4 minutos (224 s) neste ambiente.
14. **Limitações do MVP** de `11-riscos-e-premissas.md`, seção 3 (atualizada nesta fase): sem hora nos eventos (venda e
    recompra do mesmo animal no mesmo dia não cabem), um usuário, só online.
15. **Decisões das rodadas 3 e 4 só em `CONTRATOS.md`**, porque essas etapas não podiam mexer em `docs/fase-0/`: o tipo
    de cada custo da compra pela ordem do `financial_id` (03b, 2.6 e 4.1) e a fronteira do custo de aquisição do animal
    que só existe no histórico (04, seção 6; 03a, DL-08). O dono precisa ratificá-las na próxima revisão dos documentos
    da Fase 0 (seção 3). Também ficaram com números antigos em `11-riscos-e-premissas.md` o R-12 ("duas rodadas", 42
    achados) e o R-31 (437 KB).
16. **Revisão sem convergência demonstrada**: a última rodada ainda achou 6 defeitos de gravidade alta e 14 de
    gravidade média. Os 6 altos e metade dos médios eram correções incompletas de rodadas anteriores, e os consertos
    dela não passaram por outra revisão (seção 6.7).

## 6. Revisão adversarial

### 6.1 Ataque interno ao motor e ao financeiro (etapa ATAQUE)

Três oráculos escritos à parte, sem usar `Timeline` nem `FinancialService` (`tests/apoio-oraculos.js` e o modelo de
`tests/fase2.adversarial.test.js`): um modelo de referência que prevê, para cada comando, aceito, VALIDATION ou
CONFLICT e quais eventos impedem; um replay das linhas cruas que dá o inventário por data e pasto; e as invariantes de
03b, seção 14, de novo sobre as linhas cruas.

- **Defeitos achados e corrigidos** (cada um com o teste que falhava antes): elegíveis a fato no dia da saída
  (`inventario.elegiveis` recusava a vaca que morre no dia do parto); origem da correção de uma correção de
  localização (vinha do fim do dia, não da posição); consultas que refaziam a linha do tempo sem acesso cru (o painel e
  a posição mostravam o pasto errado com duas movimentações no mesmo dia e a primeira corrigida); mensagens com número
  em formato americano, erro em dobro no rateio manual e "carcaça maior que o vivo" falso.
- **Tentativas que não quebraram o sistema**: cerca de 420 comandos aleatórios na suíte (3 sementes × 140 passos) e,
  fora dela, 26 sementes × 220 passos, cobrindo estorno e correção de todo tipo, inclusive em cadeia, retroativos,
  mesmo dia com as três classes, reentrada, simulação = gravação, reenvio, recusa sem gravar nada, inventário e
  elegíveis = replay e as invariantes; rateio pelo maior resto com centavos patológicos, parcelas que diferem de 1
  centavo, arroba e carcaça no limite, idempotência e quedas com subconjuntos densos.
- **Lacunas observadas**: simulação do estorno sem o financeiro que deixa de valer (fechada depois, na etapa de telas:
  `impactos.cancelados`); intercalações só com o comando de exemplo e varredura de quedas menor que a de 09 (seguem
  abertas; seção 5, item 13).

### 6.2 Revisão independente, rodada 1

23 achados, todos confirmados e **CORRIGIDOS**, cada um com um teste que falhava antes do conserto
(`tests/revisao1.motor.test.js`, `tests/revisao1.financeiro.test.js`, `tests/ui/revisao1.test.js`).

| Lente | ALTA | MÉDIA | BAIXA | Total |
|---|---:|---:|---:|---:|
| MOTOR | 2 | 6 | 2 | 10 |
| FINANCEIRO | 0 | 1 | 4 | 5 |
| INTERFACE E REGRAS | 0 | 5 | 3 | 8 |
| **Total** | **2** | **12** | **9** | **23** |

| Gravidade | Lente | Achado | Decisão |
|---|---|---|---|
| ALTA | MOTOR | Correção de cadastro depois do marco zero transformava animal HISTORICO em ANULADO | Corrigido: só linha de inventário decide a situação (03a, 4.3.4, atualizado) |
| ALTA | MOTOR | Duas importações gravando ao mesmo tempo criavam dois animais ativos com o mesmo brinco | Corrigido: `IMPORTACAO_EM_CURSO` (RN-032) |
| MÉDIA | FINANCEIRO | Bloco H da ficha, em reentrada, somava receitas de todas as passagens e um só custo | Corrigido: uma passagem só |
| MÉDIA | MOTOR | Registro anterior ao marco zero conferido contra a última volta ao rebanho | Corrigido: chegada declarada |
| MÉDIA | MOTOR | Corrigir só o texto de uma volta ao rebanho recusado por morte posterior | Corrigido: decide a linha do tempo final |
| MÉDIA | MOTOR | Corrigir só o motivo de uma retirada de brinco dava BRINCO_DUPLICADO | Corrigido |
| MÉDIA | MOTOR | Mãe de parto só de natimorto podia deixar de ser fêmea | Corrigido: `SEXO_DA_MATRIZ`, `PARTO_DA_MATRIZ` |
| MÉDIA | MOTOR | Gêmeos de linha idêntica em NASCIMENTOS marcados como duplicados | Corrigido |
| MÉDIA | MOTOR | Desfazer importação deixava valendo o evento importado corrigido depois | Corrigido: bloqueado até estornar a correção |
| MÉDIA | INTERFACE | Rascunho em envio apagado por outro atalho, com frase falsa | Corrigido: pergunta ao servidor antes |
| MÉDIA | INTERFACE | "Desfazer" no resultado de uma correção apagava o lançamento inteiro | Corrigido: sem "Desfazer"; revisão avisa |
| MÉDIA | INTERFACE | Seletor com data retroativa usava a posição de hoje | Corrigido (resíduo na seção 5, item 9) |
| MÉDIA | INTERFACE | `conflito.tipo` levava o subtipo e a tela montava o link errado | Corrigido: novo contrato do conflito |
| MÉDIA | INTERFACE | Trilha de auditoria com nome de coluna e identificador cru | Corrigido |
| BAIXA | FINANCEIRO | `total_value` de morte, descarte e rebanho inicial sem conferência | Corrigido: invariante 16 estendida (03b, 14, atualizado) |
| BAIXA | FINANCEIRO | Estorno bloqueado por alocação apontava "RATEIO" sem data e contava duas vezes | Corrigido |
| BAIXA | FINANCEIRO | Frete, outros custos, custo da morte e receita do descarte com uma parcela só | Corrigido: parcelas mensais (datas livres por parcela: adiado, seção 5, item 3) |
| BAIXA | FINANCEIRO | Visão geral somava `valor_individual` em vez das alocações | Corrigido (a prova completa depende do RATEIO da Fase 4) |
| BAIXA | MOTOR | Reconciliação ordenava o histórico só por data e número | Corrigido: ordem canônica |
| BAIXA | MOTOR | Número de partos caía depois de uma volta ao rebanho | Corrigido: conta da primeira entrada |
| BAIXA | INTERFACE | Subtipo e aviso sem acento na lista e no detalhe | Corrigido |
| BAIXA | INTERFACE | Motivo do bloqueio do desfazer com o código cru do tipo | Corrigido |
| BAIXA | INTERFACE | Detalhe da venda recalculava os totais no aparelho | Corrigido: o servidor devolve `totais_venda` |

### 6.3 Revisão independente, rodada 2

19 achados (um deles repetido em duas lentes); todos tratados, cada um com teste (`tests/revisao2.motor.test.js`,
`tests/revisao2.financeiro.test.js`, `tests/ui/revisao2.test.js`, `tests/telas.fase2.test.js`).

| Lente | ALTA | MÉDIA | BAIXA | Total |
|---|---:|---:|---:|---:|
| MOTOR | 2 | 3 | 3 | 8 |
| FINANCEIRO | 0 | 3 | 2 | 5 |
| INTERFACE E REGRAS | 0 | 5 | 1 | 6 |
| **Total** | **2** | **11** | **6** | **19** |

| Gravidade | Lente | Achado | Decisão |
|---|---|---|---|
| ALTA | MOTOR | Desfazer importação concluída devolvia a um animal um brinco que hoje é de outro | Corrigido: `EventService.conferirRestauracao` |
| ALTA | MOTOR | Estorno de correção de mãe ou pai devolvia vínculo inválido (mãe macho, ciclo) | Corrigido; integridade ganhou GENEALOGIA |
| MÉDIA | FINANCEIRO | Revisão do estorno da venda somava receita com deduções | Corrigido: receitas e despesas separadas |
| MÉDIA | FINANCEIRO | Importação recusava frete, custos, desconto e deduções 0,00 | Corrigido: 0,00 = não houve |
| MÉDIA | FINANCEIRO | Importação de VENDAS gravava toda dedução como não descontada pelo comprador | Corrigido: coluna "descontado pelo comprador" |
| MÉDIA | MOTOR | Correção sem mudança de estrutura trocava peso atual e situação reprodutiva | Corrigido: posição do substituto (16.1) |
| MÉDIA | MOTOR | Retroativo antes de uma saída bloqueado pela origem que o servidor calculou, com mensagem que não resolvia | **Refutado em parte**: o bloqueio segue o desenho (03b, 3; 04, 5.2) e ficou; corrigida a mensagem, com o caminho que funciona testado até o fim; o recálculo automático por substituto foi **adiado** (seção 5, item 4) |
| MÉDIA | MOTOR | Correção de cadastro trocava mãe, nascimento e origem de cria nascida na fazenda | Corrigido: só pelo parto; PARTOS confere o cadastro reconstruído |
| MÉDIA | INTERFACE | Nota de data antes do marco zero prometia histórico em tipos que o servidor recusa | Corrigido: segue o catálogo |
| MÉDIA | INTERFACE | Nota da correção dizia que tirar um animal anula o cadastro em todo tipo | Corrigido |
| MÉDIA | INTERFACE | Aviso de possível duplicidade com frase quebrada, subtipo no lugar do tipo e sem link | Corrigido |
| MÉDIA | INTERFACE | Estornar, Corrigir e atalhos sem resposta quando o rascunho do servidor falhava | Corrigido: avisam |
| MÉDIA | INTERFACE | Pasto vazio abria o rebanho inicial e punha o animal novo no marco zero | Corrigido |
| BAIXA | FINANCEIRO | Detalhe de evento estornado mostrava títulos "em aberto" | Corrigido: "sem efeito" |
| BAIXA | FINANCEIRO | Item de lista desativado depois de usado impedia corrigir o evento | Corrigido |
| BAIXA | MOTOR | Importação marcava como duplicada a volta da transferência no mesmo dia | Corrigido |
| BAIXA | MOTOR | Integridade não conferia o tipo do detalhe com o subtipo | Corrigido: COPIAS |
| BAIXA | MOTOR | Aviso de possível duplicidade ainda com o subtipo em `conflito.tipo` (correção incompleta da rodada 1) | Mesmo achado da lente INTERFACE, mesma correção |
| BAIXA | INTERFACE | Parto anterior ao marco zero anunciado como "entrou no rebanho" | Corrigido |

### 6.4 Revisão independente, rodada 3

23 achados, em quatro lentes: entrou a lente CORREÇÕES ANTERIORES, que procura conserto incompleto das rodadas 1 e 2.
Um achado veio em duas lentes (descrição e vencimento propostos fixados na prévia da correção, lentes FINANCEIRO e
INTERFACE E REGRAS), então são 22 distintos. Todos foram tratados e cada um tem teste (`tests/revisao3.motor.test.js`,
`tests/revisao3.financeiro.test.js`, `tests/revisao3.interface.test.js`, `tests/ui/revisao3.test.js`: 36 testes, 32 no
Node e 4 no navegador). Segundo o registro da rodada no `CHANGELOG`, 35 deles falhavam no código anterior; o 36º ("a
importação em curso ainda pode ser desfeita") guarda o que precisa continuar valendo. Esta etapa não reexecutou o código
anterior. 8 dos 23 achados eram correções incompletas de rodadas anteriores (marcadas "rodada 1" ou "rodada 2" abaixo).
A coluna "Depois" aponta os consertos desta rodada que a rodada 4 achou incompletos.

| Lente | ALTA | MÉDIA | BAIXA | Total |
|---|---:|---:|---:|---:|
| MOTOR | 5 | 2 | 0 | 7 |
| FINANCEIRO | 0 | 2 | 2 | 4 |
| INTERFACE E REGRAS | 2 | 4 | 0 | 6 |
| CORREÇÕES ANTERIORES | 1 | 4 | 1 | 6 |
| **Total** | **8** | **12** | **3** | **23** |

| Gravidade | Lente | Achado | Decisão | Depois |
|---|---|---|---|---|
| ALTA | MOTOR | Parto só de natimorto gravava qualquer valor como pai (fêmea, animal inexistente ou anulado), e a correção do sexo do touro para fêmea passava | Corrigido: o pai é conferido sem cria viva no registro, na correção e na importação; o RN-012 inclui o touro dos registros reprodutivos; GENEALOGIA confere o touro | A mãe desse parto, na rodada 4 (BAIXA) |
| ALTA | MOTOR | Desfazer a importação que criou o touro deixava o parto apontando para animal anulado | Corrigido: o desfazer recusa (DEPENDENTE) com o parto, e também com valor alocado ao animal por outro lançamento | — |
| ALTA | MOTOR | Estorno ou correção de uma correção de nascimento ou de chegada não conferia os registros anteriores ao marco zero | Corrigido: compara o nascimento e a chegada gravados com os que voltam (`ANTES_DO_NASCIMENTO`, `ANTES_DA_ENTRADA`) | Chegada antes do nascimento, rodada 4 (ALTA) |
| ALTA | MOTOR | A integridade não acusava evento vigente sem o detalhe obrigatório (linha de COMPRAS, VENDAS ou BAIXAS apagada à mão) | Corrigido: FINANCEIRO e COPIAS acusam ERRO | Linhas dos animais apagadas, rodada 4 (ALTA) |
| ALTA | MOTOR | A importação de eventos achava o animal pelo brinco de hoje | Corrigido: pelo brinco em uso na data do evento, também para a mãe e o pai do parto; sem dono na data ou em dois animais, pede o código interno | — |
| ALTA | INTERFACE | Corrigir só o comprador de uma venda deixava a dedução retida (Funrural) no nome do comprador antigo, e a integridade não acusava | Corrigido na prévia (o parceiro e o vencimento que o servidor deduziu ficam vazios); a integridade ganhou o vencimento da retida num recebimento. **Refutado em parte**: a regra "parceiro da retida = comprador" não entrou na integridade, porque o servidor e o catálogo aceitam outro parceiro em "Pago a" | — |
| ALTA | INTERFACE | Sem `localStorage`, um formulário grande não era guardado no servidor, e a tela dizia "Rascunho guardado no servidor" | Corrigido: partes de 8 KB, até 96 KB por rascunho e 400 KB no total (o lote de 80 animais cabe); "guardado" só com a confirmação, e a falha aparece. **Resíduo adiado**: acima de 96 KB continua recusado, agora com aviso (seção 5, item 9) | Contrato e comentário com o limite antigo, rodada 4 (BAIXA) |
| ALTA | CORREÇÕES ANTERIORES | Desfazer uma importação concluída com outra em curso não via os pendentes da outra, e a conclusão dela gravava brinco duplicado (rodadas 1 e 2) | Corrigido: `IMPORTACAO_EM_CURSO` só para o desfazer da concluída (a em curso continua podendo ser desfeita, 16.8); o rebanho inicial importado não recebe o número de outro animal no marco zero | — |
| MÉDIA | FINANCEIRO | Correção pela tela de compra ou venda de um animal só (critério DIRETO) perdia o valor do animal ou punha DIRETO como critério do lote | Corrigido: o valor do animal volta e o lote propõe CABECAS | Lote de um animal por carcaça, rodada 4 (MÉDIA) |
| MÉDIA | FINANCEIRO | A correção pela tela copiava para o substituto a descrição proposta e o vencimento "à vista" da data antiga | Corrigido: o valor igual ao proposto pelo servidor fica vazio (`propostoOuValor_`) | Pasto e raça do parto, rodada 4 (ALTA) |
| MÉDIA | MOTOR | Com o reuso de brinco ligado, dois animais ficavam com o mesmo número no mesmo período | Corrigido: `conferirPeriodosDeBrinco_` (CONFLICT `BRINCO_DUPLICADO` com o registro do outro animal); IDENTIFICACOES_ATIVAS acusa a sobreposição | O estorno, rodada 4 (ALTA) |
| MÉDIA | MOTOR | A reconciliação continuava mostrando a divergência depois de o dono seguir a ação recomendada | Corrigido: valem a correção de localização e a baixa na contagem datadas do marco zero | FORA_DA_FOTOGRAFIA, rodada 4 (MÉDIA) |
| MÉDIA | INTERFACE | Item de lista desativado depois de usado: o servidor aceitava, mas a tela recusava a correção e mostrava o código cru (rodada 2) | Corrigido: o valor atual aparece pelo nome, com "— desativado", e quem decide é o servidor | Pasto e categoria, rodada 4 (MÉDIA) |
| MÉDIA | INTERFACE | A correção de compra, morte ou descarte congelava a descrição e o vencimento propostos | Mesmo achado da lente FINANCEIRO, mesma correção | — |
| MÉDIA | INTERFACE | Corrigir só o preço de uma compra cujo brinco foi acertado por "Brinco lançado errado" e depois reaproveitado dava `BRINCO_DUPLICADO` (rodada 1) | Corrigido: o brinco de criação igual ao do original não é proposta nova (RN-045) | — |
| MÉDIA | INTERFACE | A confirmação do desfazer dizia que os animais deixam de valer numa importação de transferências | Corrigido: o texto segue o tipo e a situação da importação | — |
| MÉDIA | CORREÇÕES ANTERIORES | Corrigir o próprio rebanho inicial ou a compra histórica mudava a chegada sem conferir os registros antigos (rodada 1) | Corrigido: a chegada, o sexo e o nascimento do conjunto final | Chegada antes do nascimento, rodada 4 (ALTA) |
| MÉDIA | CORREÇÕES ANTERIORES | Corrigir ou estornar o nascimento do filho o deixava mais velho que a mãe ou o pai (rodada 2) | Corrigido: `NASCIMENTO_DO_PROGENITOR` no comando e CONFLICT no estorno | Pais vindos de correção de cadastro, rodada 4 (MÉDIA) |
| MÉDIA | CORREÇÕES ANTERIORES | A troca de brinco levada para depois de o número ir para outro animal era aceita (rodada 1) | Corrigido: a conferência por períodos vale para toda linha que fecha um código | O estorno, rodada 4 (ALTA) |
| MÉDIA | CORREÇÕES ANTERIORES | A Visão geral listava o rascunho ENVIANDO como "não concluído", e "Descartar" apagava sem perguntar ao servidor (rodada 1) | Corrigido: "enviado sem resposta do servidor"; o descarte pergunta antes (`Registro.descartarVerificando`) | — |
| BAIXA | FINANCEIRO | A prévia da correção da compra preenchia a parcela única, e mudar o preço dava `PARCELAS_NAO_SOMAM` | Corrigido: a parcela única vai sem valor, como na venda | — |
| BAIXA | FINANCEIRO | BASE_RATEIO só recalculava VALOR_INDIVIDUAL e DIRETO | Corrigido: também peso vivo, carcaça e cabeças (alerta) | A base estimada da venda, rodada 4 (BAIXA) |
| BAIXA | CORREÇÕES ANTERIORES | No conflito de genealogia e de touro, pseudo-tipo, campos nulos, data errada e o mesmo lançamento repetido (rodada 1) | Corrigido: tipo, data e nome do próprio lançamento, uma vez por lançamento | O vínculo de correção de cadastro, rodada 4 (BAIXA) |

### 6.5 Revisão independente, rodada 4

29 achados nas mesmas quatro lentes. Um veio em duas lentes (o estorno não conferia os períodos de uso do brinco, lentes
MOTOR e CORREÇÕES ANTERIORES), então são 28 distintos. Todos foram tratados e cada um tem teste
(`tests/revisao4.motor.test.js`, `tests/revisao4.financeiro.test.js`, `tests/revisao4.interface.test.js`,
`tests/ui/revisao4.test.js`: 36 testes, 32 no Node e 4 no navegador). Segundo o registro da rodada no `CHANGELOG`, 35
deles falhavam no código anterior; o 36º ("sem falso positivo" na conferência das linhas dos eventos) guarda o que
precisa continuar valendo. Esta etapa não reexecutou o código anterior. **16 dos 29 achados, inclusive os 6 de
gravidade alta, eram correções incompletas de rodadas anteriores** (marcadas abaixo com a rodada de origem).

| Lente | ALTA | MÉDIA | BAIXA | Total |
|---|---:|---:|---:|---:|
| MOTOR | 3 | 4 | 1 | 8 |
| FINANCEIRO | 0 | 4 | 1 | 5 |
| INTERFACE E REGRAS | 1 | 3 | 6 | 10 |
| CORREÇÕES ANTERIORES | 2 | 3 | 1 | 6 |
| **Total** | **6** | **14** | **9** | **29** |

| Gravidade | Lente | Achado | Decisão |
|---|---|---|---|
| ALTA | MOTOR | O estorno devolvia a um animal um período de brinco que cruzava o de outro animal; a integridade passava a acusar (rodadas 1 e 3) | Corrigido: a conferência dos períodos também no estorno, na correção que tira a linha de brinco do original e no desfazer da importação (CONFLICT `BRINCO_DUPLICADO`) |
| ALTA | MOTOR | Corrigir o parto para informar um pai, depois de o pai da cria ter sido corrigido em "Corrigir dados do animal", deixava o parto com um pai e a cria com outro (rodada 2) | Corrigido: CONFLICT `PAI_DA_CRIA` com a correção de cadastro |
| ALTA | MOTOR | Morte sem a linha de EVENTO_ANIMAIS, com efeito 0 ou descarte com `pre_marco_zero` errado só apareciam como projeção desatualizada, e o reparo oferecido ressuscitava o animal (rodada 3) | Corrigido: COPIAS confere a fonte de cada evento vigente (ERRO), e o achado continua depois do reparo RECONSTRUIR |
| ALTA | INTERFACE | A prévia da correção do parto fixava como digitados o pasto das crias e a raça que o servidor tirou da mãe (rodada 3) | Corrigido: `evento.obter` devolve as `propostas`, e o valor igual a elas fica vazio |
| ALTA | CORREÇÕES ANTERIORES | O estorno não conferia os períodos de uso do brinco (rodada 3) | Mesmo achado da lente MOTOR, mesma correção |
| ALTA | CORREÇÕES ANTERIORES | O estorno de uma correção de nascimento e a correção do rebanho inicial gravavam a chegada antes do nascimento (rodada 3) | Corrigido: `ENTRADA_ANTES_DO_NASCIMENTO` no conjunto final, CONFLICT no estorno e no desfazer; LINHA_DO_TEMPO acusa |
| MÉDIA | FINANCEIRO | Compra ou venda em lote fechado de um animal dividido por carcaça não se corrigia pela tela, nem sem mudar nada (rodada 3) | Corrigido: o critério da prévia sai da linha (com carcaça, PESO_CARCACA) |
| MÉDIA | FINANCEIRO | Compra e venda históricas não se corrigiam pela tela: a prévia abria sem animais e exigia parcela | Corrigido: animais das linhas de efeito 0, sem exigir parcela no histórico |
| MÉDIA | FINANCEIRO | O animal que só existe no histórico ficava sem custo de aquisição, embora a compra estivesse alocada a ele | Corrigido: `Timeline.entradaDoCusto`, a mesma fronteira no projetor, na ficha e na invariante 18. **Decisão a ratificar pelo dono** (seção 3) |
| MÉDIA | FINANCEIRO | O tipo de cada custo da compra (frete ou outro) saía da ordem física das linhas: classificar a aba dava erro falso e trocava frete e outros custos numa correção | Corrigido: pela ordem do `financial_id` (os fretes recebem os menores), sem chave nova no payload (03b, 2.6). **Decisão a ratificar pelo dono** (seção 3) |
| MÉDIA | MOTOR | A reconciliação quebrava com erro interno quando uma vaca da fotografia, com parto antigo, era baixada na contagem no marco zero, e a conclusão de qualquer importação passava a falhar depois de gravar | Corrigido: a baixa no marco zero é decisão do dono e não vira divergência |
| MÉDIA | MOTOR | Corrigir o sexo de um animal reclassificado à mão era aceito, e um macho ficava contado como "Vaca" | Corrigido: CONFLICT `CATEGORIA_INCOMPATIVEL` com a reclassificação; LINHA_DO_TEMPO acusa |
| MÉDIA | MOTOR | A ficha e a lista de eventos ordenavam o substituto pelo `event_seq` novo | Corrigido: pela posição na cadeia de substituição (16.1) |
| MÉDIA | MOTOR | Em FORA_DA_FOTOGRAFIA, a ação recomendada era impossível para o animal que já existe, e o caminho que funciona continuava listado como divergência (rodada 3) | Corrigido: a outra entrada datada do marco zero põe o animal na fotografia, e a ação a recomenda |
| MÉDIA | INTERFACE | A revisão de toda correção que tira da lista um animal que já existia dizia "Animais anulados: 1" (rodada 2) | Corrigido: `impactos.voltam`; "Tirados do lançamento" |
| MÉDIA | INTERFACE | A correção de identificação, marcação ou ajuste deixava trocar o subtipo, que o servidor sempre recusa | Corrigido: o subtipo fica só para leitura, com a nota de estornar e lançar de novo |
| MÉDIA | INTERFACE | A linha do tempo da ficha mostrava os ajustes com identificador e código crus (rodada 1) | Corrigido: pelo nome (`Store.valorLegivel`) |
| MÉDIA | CORREÇÕES ANTERIORES | Corrigir o lançamento que criou o filho não conferia o nascimento com a mãe ou o pai postos por correção de cadastro (rodada 3) | Corrigido: a genealogia do conjunto final |
| MÉDIA | CORREÇÕES ANTERIORES | Pasto e categoria desativados depois do uso ainda impediam corrigir só o valor ou o texto (rodadas 2 e 3) | Corrigido: na correção valem o pasto, a propriedade e a categoria que o original já usava |
| MÉDIA | CORREÇÕES ANTERIORES | A ação de FORA_DA_FOTOGRAFIA mandava lançar o descarte antigo, que não entra por nenhum caminho (rodada 3) | Corrigido no texto: só os caminhos que funcionam. **Resíduo adiado**: o descarte antigo continua sem registro, e essa divergência continua listada (seção 5, itens 6 e 7) |
| BAIXA | FINANCEIRO | A base estimada da venda só com o peso do lote nunca era recalculada pela integridade (rodada 3) | Corrigido: BASE_RATEIO refaz pela mesma conta da gravação |
| BAIXA | MOTOR | A mãe de parto só de natimorto nascida no próprio dia do parto era aceita (rodada 3) | Corrigido: `NASCIMENTO_DO_PROGENITOR` no registro e na correção, `PARTO_DA_MATRIZ` no estorno |
| BAIXA | INTERFACE | No seletor com data passada, o touro aparecia como "fora do rebanho" em vez de "não é fêmea" | Corrigido |
| BAIXA | INTERFACE | O pasto desativado e vazio oferecia "Transferir para cá" e "Registrar a chegada", que o servidor sempre recusa | Corrigido: só a nota de como reativar |
| BAIXA | INTERFACE | Na correção de evento com anexo, nada dizia que a GTA ou a nota do original passa ao substituto | Corrigido: o formulário e a revisão dizem, pelos nomes |
| BAIXA | INTERFACE | A ajuda de "Outras identificações" mostrava notação técnica | Corrigido |
| BAIXA | INTERFACE | A revisão da morte com custo chamava o custo de "Valor do animal" | Corrigido: "Custo do animal" |
| BAIXA | INTERFACE | O contrato e o comentário do `Api` ainda davam o limite antigo do rascunho no servidor | Corrigido: 96 KB em partes de 8 KB |
| BAIXA | CORREÇÕES ANTERIORES | Quando a mãe ou o pai vinha de uma correção de cadastro, o conflito de genealogia apontava o lançamento que criou o filho (rodada 3) | Corrigido: aponta a correção que criou o vínculo |

### 6.6 Balanço das quatro rodadas

| Situação | Rodada 1 | Rodada 2 | Rodada 3 | Rodada 4 | Total |
|---|---:|---:|---:|---:|---:|
| Achados registrados | 23 | 19 | 23 | 29 | 94 |
| Achados distintos (um por rodada veio em duas lentes nas rodadas 2 a 4) | 23 | 18 | 22 | 28 | 91 |
| De gravidade alta (registrados / distintos) | 2 / 2 | 2 / 2 | 8 / 8 | 6 / 5 | 18 / 17 |
| De gravidade média (registrados) | 12 | 11 | 12 | 14 | 49 |
| Correções incompletas de rodada anterior (registradas) | 0 | 1 | 8 | 16 | 25 |
| Corrigidos por inteiro | 23 | 17 | 21 | 28 | 89 |
| Corrigidos em parte e refutados em parte, com o motivo | 0 | 1 (bloqueio do retroativo mantido pelo desenho) | 1 (parceiro da retida na integridade) | 0 | 2 |
| Refutados por inteiro | 0 | 0 | 0 | 0 | 0 |
| Com resíduo adiado (documentado na seção 5) | 3 (itens 3 e 9; a prova da Visão geral com o RATEIO da Fase 4) | 1 (item 4) | 1 (item 9: rascunho acima de 96 KB) | 1 (itens 6 e 7: descarte antigo) | 6 |
| Com decisão a ratificar pelo dono (seção 3) | 0 | 0 | 0 | 2 (custo do animal só do histórico; tipo do custo da compra) | 2 |

Nenhum achado foi descartado sem teste. Segundo o registro de cada rodada no `CHANGELOG`, a suíte inteira ficou verde
depois do conserto dela. A execução feita nesta etapa, sobre o código final, está na seção 2.

### 6.7 A última rodada terminou sem achado alto ou médio? Não

A rodada 4, a última, registrou **6 achados de gravidade alta (5 distintos) e 14 de gravidade média**. Todos foram
corrigidos e têm teste, mas **nenhuma rodada posterior revisou esses consertos**. Os 6 de gravidade alta da rodada 4 eram
correções incompletas de rodadas anteriores, 5 deles da rodada 3. Os números não mostram convergência: de uma rodada para
a outra, os achados altos foram 2, 2, 8 e 6, e as correções incompletas, 0, 1, 8 e 16. Parte do aumento vem da lente
CORREÇÕES ANTERIORES, que entrou na rodada 3 para procurar exatamente isso. Mas, dos 5 achados altos distintos da
rodada 4, 4 foram apontados pelas lentes MOTOR e INTERFACE E REGRAS.

Por isso este relatório **não afirma** que o motor e as telas da Fase 2 estão livres de defeito alto ou médio. Afirma
só o seguinte: cada um dos 91 defeitos distintos apontados nas quatro rodadas tem um teste e foi corrigido, com as
exceções registradas acima (2 refutados em parte, 6 com resíduo adiado). Os consertos da rodada 4 mexeram no mesmo
caminho de risco das rodadas anteriores: o conjunto final conferido no estorno, na correção e no desfazer (períodos de
brinco, chegada × nascimento, genealogia, categoria × sexo), a fonte dos eventos na integridade e as propostas do
servidor na prévia da correção. **Recomendação**: antes de começar a Fase 3 sobre este motor, fazer uma rodada
independente só sobre esses consertos. A rodada pode ser curta. A decisão é do dono.
