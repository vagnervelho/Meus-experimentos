# Relatório da Fase 2 — Motor de eventos

Data: 15/11/2026. Versão do app: 0.1.0. Plano: `docs/fase-0/10-plano-de-implementacao.md`, seção 4 (entregas E2.1 a
E2.11) e seção 8 (checklist). Relatório da fase anterior: `docs/RELATORIO_FASE1.md`.

## Em resumo

- **O código da Fase 2 está completo no repositório** (`erp-pecuario/src/`: 23 arquivos `.js`, 10 `.html` e o
  manifesto; entrou o `HealthService`) e passou em todos os testes que rodam aqui, inclusive os da Fase 1:
  **`npm test` com 555 testes, 555 aprovados, 0 falhas** e **`npm run ui:check` com
  77 testes de navegador, 77 aprovados, 0 falhas**.
- O inventário se movimenta só por eventos: parto, compra, venda, transferência, morte, descarte, identificação,
  marcação, reclassificação e baixa na contagem, cada um com estorno e correção (inclusive retroativos e com lançamento
  posterior que depende deles). Compra e venda gravam o financeiro inteiro do próprio evento (regra P11). O rebanho e os
  pastos se refazem em qualquer data desde o marco zero, e em todo teste do motor, depois de cada comando, a projeção é
  igual à reconstrução e as 20 invariantes do financeiro fecham.
- **Nada foi implantado nem executado na conta Google do dono.** Continuam **PENDENTES NA CONTA DO DONO** os itens da
  Fase 1 (diagnóstico, aceitação) e, da Fase 2: `runAcceptanceTests` com os cenários novos, a validação das fórmulas de
  compra e venda com um caso real e a confirmação da premissa PR-09. Pela regra de honestidade, **a Fase 2 não está
  fechada** até esses resultados chegarem.
- Duas rodadas de revisão independente registraram 42 achados (41 distintos, 4 de gravidade alta). Todos têm teste
  que falhava antes do conserto: 40 foram corrigidos por inteiro e 1 foi corrigido na mensagem, com o bloqueio mantido
  porque segue o desenho (seção 6).
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
| E2.1 NASCIMENTO | Parto simples, gemelar (até 4 crias) e natimorto; peso ao nascer em PESAGENS; cria com ou sem brinco; pai opcional (touro do rebanho ou externo); pasto e raça da mãe por padrão; REPRODUCAO (PARTO) na matriz; avisos de idade reprodutiva e intervalo curto uma vez por parto; número de partos e cria ao pé; parto anterior ao marco zero como histórico (cria HISTORICO); bloco G da ficha (partos) | `EventCatalog`, `EventService`, `Timeline`, `ReproductionService`, `Components`, `Events`, `Animals` | `nascimento.test.js` (CT-01), `regras.fase2.test.js`, `acceptance.test.js`, `ui/movimentos.test.js` (gemelar a 1280 e 360 px) | `EXECUTADO AQUI` |
| E2.2 TRANSFERENCIA | Coletiva, tudo ou nada; origem pela linha do tempo na data; destino ativo e diferente; GTA opcional; aviso de lotação em cabeças e em UA/ha | `EventCatalog`, `EventService`, `Timeline`, `InventoryService` | `movimentos.test.js` (CT-02, CT-17 a), `lotacao.test.js`, `acceptance.test.js`, `ui/movimentos.test.js` (erro num animal) | `EXECUTADO AQUI` |
| E2.3 PARCEIROS e COMPRA | Fornecedor validado (inativo recusado como contraparte nova); modalidade × base de peso (cabeça, kg vivo, arroba de peso vivo ou de carcaça, lote); grade de animais novos (em série ou colada da planilha) ou que voltam ao rebanho; lançamento dos animais e de cada frete e outro custo, com parceiro, vencimento e parcelas próprios; rateio 100% ao centavo pelo maior resto; custo de aquisição só pelas alocações; bloco H da ficha | `FinancialService` (novo), `EventCatalog`, `EventService`, `Config`, `AnimalService`, `Components`, `Events`, `Animals` | `compra.test.js` (CT-03, CT-13 a e b, 03b 15.1 linha a linha), `financeiro.test.js`, `acceptance.test.js`, `ui/compra.test.js`, `ui/eventos.fase2.test.js` | `EXECUTADO AQUI`; fórmulas com um caso real: `PENDENTE NA CONTA DO DONO` |
| E2.4 VENDA | Comprador, finalidade, pasto de origem opcional; modalidade × base de peso (com romaneio de carcaça, rendimento negociado ou estimado, ou só o peso do lote com a base estimada pela pesagem anterior); valor bruto como conferência; desconto; parcelas a receber; deduções (frete, comissão, Funrural, taxas), inclusive a descontada pelo comprador; resultado da negociação e depósito esperado calculados no servidor; aviso de carência (bloqueio na finalidade ABATE, conforme a política) | `FinancialService`, `HealthService` (novo, só carência), `EventCatalog`, `EventService`, `Components`, `Events` | `venda.test.js` (CT-04, CT-14, 07 §4.3, 03b §4.4), `financeiro.test.js`, `acceptance.test.js`, `ui/venda.test.js`, `ui/eventos.fase2.test.js` | `EXECUTADO AQUI`; fórmulas com um caso real e PR-09: `PENDENTE NA CONTA DO DONO` |
| E2.5 MORTE e DESCARTE | BAIXAS com causa, diagnóstico, motivo e destino; origem tirada da linha do tempo; MORTO terminal; custo da morte (conta de custeio escolhida) e receita do descarte em uma ou mais parcelas, rateados por cabeça | `EventCatalog`, `EventService`, `Timeline`, `FinancialService` | `movimentos.test.js`, `compra.test.js` (financeiro da morte e do descarte), `revisao1.financeiro.test.js`, `ui/movimentos.test.js` | `EXECUTADO AQUI` |
| E2.6 IDENTIFICACAO, MARCACAO, AJUSTE_INVENTARIO | Pôr, trocar e tirar brinco, chip, SISBOV, tatuagem (o brinco do vendedor só sai), com a ordem conferida e o bloqueio de reuso; marcar e desmarcar para descarte e não localizado (alerta NAO_LOCALIZADO); reclassificação manual (ou volta à automática); baixa por divergência de contagem (crítica) | `EventCatalog`, `EventService`, `Timeline`, `InventoryService` | `identificacao.test.js`, `estorno.test.js`, `ui/eventos.fase2.test.js` | `EXECUTADO AQUI`; o modo curral da identificação chega com a pesagem (E3.1) |
| E2.7 Estorno e substituição de qualquer evento; histórico, detalhe e auditoria | Um mecanismo para todos os tipos e subtipos ativos: CONFLICT com o evento que impede, conferência do que a anulação devolve (brinco, sexo e nascimento × filhos, genealogia, categoria), substituto na posição do original (16.1); revisão do estorno com o financeiro que deixa de valer; `evento.listar` e `evento.obter` completos; trilha de auditoria (EVENTOS + AJUSTES + AUDITORIA) com filtros | `EventService`, `Timeline`, `AuditService`, `Events`, `Settings`, `Components` | `estorno.test.js` (CT-07, CT-08, CT-09 completo, CT-17 b, CT-18), `fase2.adversarial.test.js`, `telas.fase2.test.js`, `ui/eventos.fase2.test.js` | `EXECUTADO AQUI` |
| E2.8 Inventário em data passada; composição do pasto; UA, UA/ha e ocupação | Situação de cada animal na data, estadas por pasto, presentes, dias de permanência (base do rateio da Fase 4); posição com filtros; painel e lista de pastos em qualquer data com "desde quando", peso médio, UA, UA/ha, ocupação e "Sem dado" com o motivo; Visão geral do período com o movimento e as séries mensais | `Timeline`, `InventoryService`, `PastureService`, `Dashboard`, `Pastures` | `lotacao.test.js`, `inventory.test.js`, `telas.pastos-importacao.test.js`, `ui/lotacao.test.js`, `ui/pastos-importacao.test.js` | `EXECUTADO AQUI`; na tela da Visão geral, só o filtro de período (os outros com o dashboard da Fase 5) |
| E2.9 Anexos de evento | Nota fiscal, GTA, laudo e foto em qualquer evento que vale e em cada lançamento financeiro dele; histórico no evento anulado; passam ao substituto na correção; remoção com justificativa; tipos de arquivo conferidos no servidor; envio pelo formulário depois de gravar | `FileService`, `EventService`, `Maintenance`, `Components` (`Anexos`), `Events` | `anexos.test.js`, `ui/anexos.test.js`, `ui/pastos-importacao.test.js` | `EXECUTADO AQUI` (fake do Drive); Drive real: `PENDENTE NA CONTA DO DONO` |
| E2.10 Importadores e reconciliação | COMPRAS, VENDAS, TRANSFERENCIAS, NASCIMENTOS e MORTES nos 10 passos da §14, cada evento pelo mesmo planejamento do formulário num ensaio em memória; histórico anterior ao marco zero (financeiro sem caixa); lotes de eventos inteiros; desfazer com as conferências do estorno; reconciliação com o marco zero, que não bloqueia; uma importação gravando por vez | `ImportService`, `EventService`, `Import` | `import.eventos.test.js`, `revisao1.motor.test.js`, `revisao2.*.test.js`, `unitofwork.adversarial.test.js` (quedas no lote), `ui/importacao.test.js`, `ui/pastos-importacao.test.js` | `EXECUTADO AQUI`; tempo com arquivos grandes: `PENDENTE NA CONTA DO DONO` |
| E2.11 Verificação de integridade completa | 26 checagens (eram 20): saída com evento posterior, partos, genealogia, brinco ativo repetido nas identificações, as invariantes do financeiro pela conferência do próprio `FinancialService`, custo de aquisição, tipo do detalhe × subtipo; tempo da verificação (`duracao_ms`) na tela de sistema | `AuditService`, `FinancialService`, `Settings` | `integrity.fase2.test.js` (cada checagem disparada por adulteração; demonstração inteira sem erro), `integrity.test.js` | `EXECUTADO AQUI`; tempo real no Sheets: `PENDENTE NA CONTA DO DONO` |
| Transversal: aceitação, demonstração, jornada e regras | `runAcceptanceTests` com os cenários da Fase 2 (18 cenários no total); base de demonstração completa de 09, seção 7 (304 ativos, 379 comandos, sem nenhuma recusa); jornada de um ano só pela `api()`; mapa RN → teste das 112 regras | `TestRunner` | `acceptance.test.js`, `jornada.fase2.test.js`, `regras.fase2.test.js`, `integrity.fase2.test.js` | `EXECUTADO AQUI` (fakes); na conta: `PENDENTE NA CONTA DO DONO` |

## 2. Resultados dos testes executados aqui

Ambiente: Node 22.23.4 (Linux), Playwright 1.63.0 com Chromium. Execução de 15/11/2026, depois da última alteração
desta fase (nesta etapa só mudaram documentos).

### 2.1 Nível 1 — `npm test` (`node --test tests/*.test.js`)

Saída: `# tests 555 · # pass 555 · # fail 0 · # cancelled 0 · # skipped 0 · # todo 0`
(duração 451.6 s). Contagem por arquivo (cada arquivo rodado sozinho com `node --test <arquivo>`):

| Arquivo | Testes | Aprovados | Falhas | O que cobre |
|---|---:|---:|---:|---|
| `tests/acceptance.test.js` | 6 | 6 | 0 | Os cenários do `runAcceptanceTests` no fake, nas duas ordens de carga: Fase 1 (CT-09, CT-10, CT-11, CT-12 com a reconciliação, CT-18, CT-20, restauração, isolamento) e Fase 2 (CT-01 a CT-04, CT-07, CT-08, CT-13 na compra, CT-14, CT-17, CT-18); retomada, falha relatada, base de demonstração completa e retomável, `runDiagnostics` |
| `tests/anexos.test.js` | 9 | 9 | 0 | Anexos de evento e de lançamento: compra, venda, transferência, morte; estorno com e sem dependente; correção (passam ao substituto), retroativa e em cadeia; remoção; tipos e limites; queda na fase A; rotas |
| `tests/animals.test.js` | 10 | 10 | 0 | Lista, ficha A a J, árvore genealógica, edição com auditoria e ajuste, animal externo |
| `tests/api.test.js` | 14 | 14 | 0 | Envelope, guarda de dono, roteador, avisos com aceite, duplicado, LOCKED, carga condicional (com o catálogo da Fase 2), ambiente TESTE, rascunho, fuso, páginas |
| `tests/compra.test.js` | 14 | 14 | 0 | COMPRA: CT-03, CT-13 (a e b), 03b 15.1 linha a linha, modalidades × base de peso, volta ao rebanho, financeiro da morte e do descarte, estorno e correção com dependente, parceiro inativo |
| `tests/config.test.js` | 8 | 8 | 0 | Parâmetros tipados, `config.salvar`, listas, categorias com cobertura, parceiros |
| `tests/database.test.js` | 21 | 21 | 0 | Codec de tipos, corpus nas três formas de gravação, fake que denuncia o tipo esquecido, portas reais |
| `tests/estorno.test.js` | 27 | 27 | 0 | Estorno e substituição de todo tipo ativo: CT-07, CT-08, CT-09 completo, CT-17 (b), CT-18 da Fase 2, dependente e retroativo, o que a anulação devolve |
| `tests/events.test.js` | 21 | 21 | 0 | Catálogo (tipos ativos por fase), entradas, CT-09, CT-10, CT-18 da Fase 1, estorno e correção, ajustes; projeção = reconstrução depois de cada comando |
| `tests/fase2.adversarial.test.js` | 11 | 11 | 0 | Ataque: sequências aleatórias (3 sementes × 140 passos) contra modelo de referência, replay e invariantes escritos à parte; casos dirigidos (mesmo dia, cadeia, centavos, arroba, parcelas) |
| `tests/files.test.js` | 5 | 5 | 0 | Drive v3 (pastas, planilha, cópia, lixeira, listagem, bytes, codificações, sonda) e anexos |
| `tests/financeiro.test.js` | 8 | 8 | 0 | `FinancialService` puro: parcelas, rateio pelo maior resto (CT-13 a–d, 1.000 sorteios), negociação por modalidade × base de peso, lançamento no plano, invariantes de 03b, seção 14, totais |
| `tests/harness.test.js` | 25 | 25 | 0 | Fidelidade dos fakes: coerção Geral, buffer e morte, falha injetada, lock com intercalação, Properties, Drive, UrlFetch |
| `tests/identificacao.test.js` | 10 | 10 | 0 | IDENTIFICACAO, MARCACAO, RECLASSIFICACAO e DIVERGENCIA_CONTAGEM: ordem das identificações e marcações, reuso de brinco, estorno e correção |
| `tests/import.test.js` | 9 | 9 | 0 | Importação de ANIMAIS: CT-12 da Fase 1, lotes, queda em cada fronteira, retomar, concluir, desfazer |
| `tests/import.eventos.test.js` | 7 | 7 | 0 | Importação de COMPRAS, VENDAS, TRANSFERENCIAS, NASCIMENTOS e MORTES: histórico, financeiro sem caixa, lotes, estorno e correção com dependente, desfazer, reconciliação, recusas, rotas |
| `tests/integrity.test.js` | 7 | 7 | 0 | Cada checagem da Fase 1 disparada por adulteração à mão |
| `tests/integrity.fase2.test.js` | 10 | 10 | 0 | As checagens da Fase 2, cada uma disparada por adulteração; integridade sem erro sobre a demonstração; tempo medido |
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
| **Total** | **555** | **555** | **0** | |

### 2.2 Nível 3 — `npm run ui:check`

Parte estática: `ui:check — 10 arquivo(s) .html conferidos (e a página montada pelo doGet), sem recurso externo e dentro do orçamento (página montada: 437 KB de 450 KB).` Parte Playwright: `# tests 77 · # pass 77 · # fail
0 · # cancelled 0 · # skipped 0 · # todo 0` (duração 212.5 s). Contagem por arquivo (cada arquivo
rodado sozinho com `node --test --test-concurrency=1 <arquivo>`):

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
| `tests/ui/telas.test.js` | 12 | 12 | 0 | Cadastrar, editar, importar, estornar e corrigir, exportar CSV, a 1280 e 360 px; pastos, configurações, sistema; fotos e documentos |
| `tests/ui/venda.test.js` | 3 | 3 | 0 | Venda pela ficha (kg vivo, comissão, revisão do servidor, ficha com a receita) e correção da venda com frete retido |
| **Total** | **77** | **77** | **0** | |

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
| Atualizar o código (34 arquivos, com o `HealthService`) e rodar `setup` | Guia, seção 11.1, passos 1 a 3 | Linha `setup: {...}` do registro (integridade com as 26 conferências, sem erro) | `PENDENTE NA CONTA DO DONO` |
| `runAcceptanceTests` com os cenários das Fases 1 e 2 (18 cenários: PREPARO, CT-09, CT-01, CT-02, CT-03, CT-04, CT-07, CT-08, CT-13, CT-14, CT-17, CT-18, CT-10, CT-12, RESTAURACAO, CT-20, CT-11, ISOLAMENTO) | Guia, seção 6, até `completo: true` (várias execuções) | Arquivo `ERP Pecuário — relatório de aceitação <instante>.json` | `PENDENTE NA CONTA DO DONO` |
| **Validar as fórmulas de compra e venda com um caso real** | Guia, seção 11.1, passo 5: lançar uma compra e uma venda que já estão no papel, com a nota fiscal e o romaneio, e comparar o valor de cada animal, o custo de aquisição, as parcelas, o frete, as deduções e o depósito esperado | O lançamento e a nota (ou "conferiu") | `PENDENTE NA CONTA DO DONO` |
| **Confirmar a premissa PR-09** (vendas para frigorífico por carcaça e de reposição por cabeça ou kg vivo) | Responder como vende hoje | A resposta | `PENDENTE NA CONTA DO DONO`; todas as modalidades já existem, e a resposta só define um padrão sugerido |
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
   zero não tira o animal do histórico. O custo de aquisição continua sendo o das alocações da permanência atual; a
   compra histórica fica no histórico do animal.
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
   O conflito tem a forma `{event_id, tipo, subtipo, data, nome}`. Na correção, valem os itens de lista desativados que o
   original já usava. O resultado de uma correção não oferece "Desfazer" (o original não volta).
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
   descarte aceitam "Em quantas vezes" (parcelas mensais iguais).
7. **Venda.** Os valores por animal somam a receita (bruto menos desconto comercial); o bruto da nota é conferência. A
   dedução descontada pelo comprador grava um título em aberto que vence num recebimento da venda, para o encontro de
   contas da Fase 4. Só com o peso do lote, a base de rateio é a última pesagem de cada animal escalada para o lote
   (registrada como estimada); sem pesagem de todos, por cabeça. Arroba de carcaça aceita só o total do romaneio, com
   aviso. A carência (RN-072) nasceu num `HealthService` só com essa regra; a política de bloqueio vale só na finalidade
   ABATE.
8. **Identificação, marcação e ajustes.** A retirada de brinco grava uma linha com o código tirado e o motivo; o tipo
   de identificação vai no cabeçalho; o brinco do vendedor só nasce na compra e, depois, só sai. Ordem das
   identificações e das marcações conferida (`Timeline.validarIdentificacoes`, `validarMarcacoes`). Com o reuso
   desligado, o número que um animal deixa não vai para outro no mesmo lançamento. A reclassificação confere a
   categoria ativa e do sexo; idade e condição não contam. A baixa por divergência é crítica e guarda a justificativa em
   `payload_json.motivo_ajuste` (não há linha de AJUSTES nesse subtipo).
9. **Financeiro e integridade.** A integridade não reescreve as regras do financeiro: chama o `FinancialService.conferir`
   e distribui as invariantes pelas checagens. O 100% alocado vale também no valor de abertura, no custo da morte e na
   receita do descarte; `EVENTOS.total_value` é conferido em todo tipo; a soma das parcelas ignora a CANCELADA. Checagens
   novas: BAIXADO_SEM_POSTERIOR, PARTOS (pelos atributos do próprio nascimento), GENEALOGIA, IDENTIFICACOES_ATIVAS (só
   brinco), FINANCEIRO, CUSTO_AQUISICAO, e COPIAS passou a conferir o tipo do detalhe com o subtipo. A ficha soma só a
   passagem atual do animal; a Visão geral lê compras e vendas pelas alocações, nunca por `valor_individual`.
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
    reconciliação não tem tabela própria de decisão: cada divergência traz a ação pelos próprios lançamentos.
12. **Interface e aceitação.** A página vai compactada ao aparelho (`Api.compactar`: de 441 KB para cerca de 411 KB na
    etapa de telas; hoje 437 KB de 450 KB). O modo curral da identificação fica para a Fase 3 (o componente é o da
    pesagem); nesta fase, seletor e cartão por animal, com o mesmo pedido e a mesma validação. "Registrar" com rascunho
    em envio pergunta ao servidor antes de apagar. Os cenários da Fase 2 rodam no `runAcceptanceTests` antes do CT-11,
    com datas contadas do marco zero e pastos e parceiros próprios. A base de demonstração atinge as metas de 09, seção
    7 (255 nascidos, 70 comprados, 240 vendidos, 15 mortes, 5 descartes, 1 baixa → 304), grava um comando por passo e
    não continua uma base DEMO da versão anterior.
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
    erradas apontadas pela revisão.

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
   está implementado: fica com o valor de abertura da Fase 4 (E4.6).
6. **Reconciliação** sem registro formal de decisão por divergência; a trilha são os próprios lançamentos de
   correção.
7. **Importação**: o custo opcional da morte e as reentradas por outra entrada ou descarte não estão no modelo de
   colunas; pesagens, sanidade, reprodução e ocorrências respondem `TIPO_INDISPONIVEL` (Fase 3).
8. **Carência** depende do evento SANIDADE (Fase 3): hoje as aplicações só existem nos testes; o alerta "animais em
   carência" também é da Fase 3.
9. **Telas**: o modo curral da identificação chega com a pesagem (E3.1); na Visão geral, só o filtro de período está na
   tela (os filtros de propriedade, pasto, sexo e categoria existem no servidor); o alerta "pasto acima da capacidade"
   não está em `alerta.listar` (a regra existe em `PastureService.lotacao`); com data retroativa, os modos Filtros e
   Busca do seletor marcam pela posição na data, mas só listam os animais que o aparelho já tem (o que estava no pasto e
   saiu depois aparece pelo "Todos do pasto"); arquivos escolhidos no formulário não sobrevivem a recarregar a página
   (podem ser anexados depois pelo detalhe); o bloco D da ficha conta o período em aberto até ontem, e
   `diasPermanencia` até hoje (diferença de um dia, documentada).
10. **Integridade** ainda não confere se o `event_id` de um anexo bate com o do registro dono; estoque de insumos e
    custo de sanidade só terão dados a conferir na Fase 3.
11. **Desempenho não medido no Apps Script**: importação de arquivos perto de 20 mil linhas (o ensaio roda o motor uma
    vez por evento a cada bloco de validação; `importacao.linhas` relê tudo a cada página), séries mensais da Visão
    geral, verificação de integridade com a base real (no fake, cerca de 55 ms com a demonstração) e a base de
    demonstração inteira. SP-05 da Fase 1 continua parcial.
12. **Orçamento da página**: 437 KB de 450 KB; as telas das Fases 3 a 5 vão precisar carregar sob demanda (risco R-31).
13. **Testes**: a varredura de quedas usa um critério menor que o de 09, seção 5 (todos os subconjuntos até 5 escritas
    e 24 sorteados nos pontos de buffer cheio, em vez de 10 e 500), por tempo; as intercalações de concorrência seguem
    testadas só com o comando de exemplo, não com venda, compra ou estorno; ficaram fora do modelo aleatório (só em
    testes dirigidos) LOTE com MANUAL, PESO_CARCACA e VALOR_INDIVIDUAL, ARROBA, reclassificação, correção de cadastro,
    parto antes do marco zero, carência, período bloqueado, brinco com reuso ligado e pai externo. O `npm test` leva
    cerca de 8 minutos neste ambiente.
14. **Limitações do MVP** de `11-riscos-e-premissas.md`, seção 3 (atualizada nesta fase): sem hora nos eventos (venda e
    recompra do mesmo animal no mesmo dia não cabem), um usuário, só online.

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

### 6.4 Balanço

| Situação | Rodada 1 | Rodada 2 | Total |
|---|---:|---:|---:|
| Achados registrados | 23 | 19 | 42 |
| Achados distintos (um da rodada 2 veio em duas lentes) | 23 | 18 | 41 |
| Corrigidos por inteiro | 23 | 17 | 40 |
| Corrigidos em parte e refutados em parte (bloqueio mantido pelo desenho; mensagem corrigida) | 0 | 1 | 1 |
| Refutados por inteiro | 0 | 0 | 0 |
| Com resíduo adiado (documentado na seção 5) | 3 (itens 3 e 9; a prova da Visão geral com o RATEIO da Fase 4) | 1 (item 4) | 4 |

Nenhum achado foi descartado sem teste. Depois das duas rodadas, a suíte inteira ficou verde (seção 2).
