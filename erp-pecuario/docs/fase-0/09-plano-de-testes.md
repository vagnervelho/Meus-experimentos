# 09 — Plano de testes

## Em resumo

- **Três níveis**: 1 em Node contra fakes fiéis, a cada commit; 2 no Apps Script, pelo dono, em planilha temporária; 3 de interface, com Playwright. Cada um declara o que prova e o que não prova.
- **20 cenários com valores fechados**: CT-01 a CT-10 são os da §18, marcador por marcador; CT-11 a CT-20 cobrem o que ela não alcança.
- **Protocolo de gravação testado por queda injetada** em cada ponto da análise de `06-persistencia-e-integridade.md` e por intercalação de execuções.
- **Nenhuma das 20 regras da §16 fica sem teste** (seção 6); RN marcada "novo" em `05-regras-de-negocio.md` ganha caso próprio (seção 4.1).
- **Honestidade (§20, regra 10)**: o relatório separa "executado aqui" de "a executar na conta do dono".

**Documentos relacionados:** `04-motor-de-eventos.md`, `05-regras-de-negocio.md`, `06-persistencia-e-integridade.md`, `07-financeiro-e-indicadores.md`, `08-ux-ui.md`, `10-plano-de-implementacao.md`, `12-fatos-de-plataforma.md`.

## 1. Estratégia em três níveis

|Nível|Onde e quem|Prova|NÃO prova|
|---|---|---|---|
|1|Node (`node --test`), neste repositório, a cada commit|Regras, linha do tempo e projetor; três fases, recuperação e idempotência sob queda e intercalação; codec contra a coerção emulada; `setup()` repetível; lint|Que a planilha real coage como o fake; lock e buffer reais; cotas, latência, escopos, gatilhos|
|2|Apps Script, conta do dono: `runAcceptanceTests()` e página de concorrência|Os cenários com serviços reais: coerção, lock entre execuções paralelas, Drive com `drive.file`, tempos|Queda no meio do protocolo (não há como matar a execução no ponto exato: nível 1 e SP-03); telas|
|3|Playwright sobre `src/*.html`, com `google.script.run` simulado: respostas fixas para estados de tela, ou ponte para o `api()` do harness do nível 1|Telas a 360 px e desktop: registrar evento, modo curral, rascunho e reenvio, avisos, erro coletivo, acessibilidade|Regra de negócio (decide o backend, P5); iframe real, `localStorage` e download no celular (SP-06, SP-07)|

**Regra de honestidade.** Cada item do relatório tem um de quatro estados: `EXECUTADO AQUI` (comando e contagens copiados da saída), `EXECUTADO PELO DONO` (com o arquivo de resultado), `PENDENTE NA CONTA DO DONO` ou `NÃO SE APLICA`. O nível 3 só é "executado aqui" se o navegador rodar neste ambiente. Fase não fecha com item pendente.

**Nível 2.** `runAcceptanceTests()` cria pela Drive API a planilha "ERP Pecuário — BASE DE TESTE" em `ERP Pecuário/Testes`, guarda o ID em `TEST_SPREADSHEET_ID` e roda `setup()` e os cenários com esse banco como parâmetro do contexto de execução; `SPREADSHEET_ID` nunca é trocado, e versão e marcador já são por planilha. É retomável (limite de 6 min): para perto de 4 min, grava o cursor e continua na chamada seguinte. O resultado sai em arquivo JSON na mesma pasta.

## 2. Harness e fakes

**Reaproveitado de `inbox-intelligence/tests/`:** `createGas()` (contexto `vm`, carga de `src/*.js` nas duas ordens, relógio falso), `makePropertyStore` (9 KB por valor, 500 KB no total), `makeUtilities`, `makeScriptApp`, `makeHtmlService`, `makeUrlFetch` e a sessão com e-mail ajustável (dono, terceiro ou vazio); de `tests/ui/`, `mock-gas.js` (respostas clonadas; acusa `Date` em argumento) e `static-rules.js`. Novos:

|Fake|Comportamento exigido|Por quê|
|---|---|---|
|FakeSheets: um estado, duas fachadas (`SpreadsheetApp` e serviço avançado `Sheets`)|Célula = valor + formato. Em `SpreadsheetApp`, célula "Geral" coage (`0012` vira 12; `=1+1`, 2; `2026-11-13`, data) e `getValues` devolve `Date`, número ou booleano. Em `Sheets`, `stringValue` nunca é interpretado e `batchUpdate` com pedido inválido não aplica nada|O teste falha quando o adaptador esquece o tipo (P6)|
|Buffer de escrita e falha injetável|Pendentes até `flush()`; `crashAt(n, subconjunto)` mata a execução na n-ésima escrita e descarta qualquer subconjunto das pendentes; `failOn(aba, n)` lança erro tratável|Premissa pessimista da análise de queda; exceção tratada × morte|
|FakeLock com agendador|Lock compartilhado por N execuções simuladas, com pontos de troca (entre "ler marcador" e "obter lock", entre fases); conta aquisições e liberações|Intercalações; subcomando que solta o lock|
|FakeDrive (serviço avançado `Drive`)|`Files.create`, `copy`, `update`, listagem por pasta; só enxerga arquivo criado por ele|Emula `drive.file`|

**Como a fidelidade é conferida.** Fake complacente dá verde falso nos três riscos maiores (tipos, gravação parcial, concorrência). A coerção do fake é um arquivo de dados (`tests/fixtures/coercao.json`). O SP-01 grava o mesmo corpus na planilha real, pelas duas primitivas, e devolve um JSON igual; um teste compara os dois, e divergência corrige o fake. Até lá a coerção é hipótese (a confirmar no spike, SP-01), como o destino do buffer e a liberação do lock (SP-03).

**Convenções.** Relógio falso em 13/11/2026, fuso `America/Porto_Velho`; IDs determinísticos; marco zero (D0) em 01/01/2026; Pasto 1, Pasto 2 e Baixada; parceiros F1 (fornecedor), C1 (comprador), T1 (transportador). Verificações comuns a todas as fichas: `sistema.integridade` sem erro; Σ `efeito_inventario` = animais ATIVOS; linha preexistente de tabela imutável não muda (célula a célula); resposta sem `Date`; comando rejeitado não grava linha nem muda `DATA_VERSION`.

## 3. Cenários da §18

### CT-01: Nascimento

**Objetivo:** parto cria o animal e atualiza a matriz. **Nível:** 1, 2, 3. **RN:** 005, 047, 048, 062, 063, 065, 109.

**Massa:** matriz 0102, nascida em 15/03/2021, em D0 no Pasto 1.

**Passos:**
1. NASCIMENTO em 12/09/2026: matriz 0102, cria viva, macho, 32,0 kg, sem brinco, pasto da mãe.
2. Extensão (§16.17): nomear a matriz "Mimosa" (`[cad]`) e corrigir o sexo da cria para F (AJUSTE_INVENTARIO/CORRECAO_CADASTRO).
3. Variante: um vivo e um natimorto.

**Verificações:**
- Inventário: 1 cabeça em 11/09, 2 em 12/09.
- Tabelas: EVENTOS 1 (`event_date` 12/09, `registration_date` 13/11); EVENTO_ANIMAIS 2 (CRIA +1, MATRIZ 0); PESAGENS 1 (NASCIMENTO, 32,0); REPRODUCAO 1 (PARTO, 1 vivo); FINANCEIRO 0.
- Ficha da cria: ATIVO, NASCIDO, mãe 0102, Pasto 1, `peso_atual` 32,0, custo de aquisição 0,00, categoria Bezerro; pendência "sem brinco" (§16.19).
- Histórico da matriz: 1 parto, VAZIA, cria ao pé; categoria passa de Novilha a Vaca.
- Passo 2: 1 linha em AUDITORIA (novo "Mimosa") e 1 em AJUSTES (M para F); `atributos_iniciais_json` segue M.
- Passo 3: +1 cabeça; REPRODUCAO com 1 vivo e 1 natimorto.

### CT-02: Transferência

**Objetivo:** movimento coletivo, tudo ou nada. **Nível:** 1, 2, 3. **RN:** 018, 024, 025, 028.

**Massa:** 0201–0210 em D0 no Pasto 1; 0211 no Pasto 2.

**Passos:**
1. TRANSFERENCIA em 01/03/2026, Pasto 1 para Pasto 2, com 0201–0210 e, por engano, 0211.
2. Reenviar sem 0211, com a mesma chave.

**Verificações:**
- Passo 1: VALIDATION com um detalhe (0211 estava no Pasto 2); nada gravado, nem em OPERACOES (§16.6, §16.14).
- Quantidades hoje: Pasto 1 = 0, Pasto 2 = 11. Inventário anterior (28/02): 10 e 1.
- EVENTO_ANIMAIS: 10 linhas, efeito 0, origem Pasto 1, destino Pasto 2.
- Histórico de 0201: entrada (01/01) e transferência (01/03); 59 dias no Pasto 1 (o dia da saída não conta).

### CT-03: Compra

**Objetivo:** cadastro individual e financeiro completo (P11). **Nível:** 1, 2. **RN:** 029, 070, 075, 076, 083.

**Passos:**
1. COMPRA com parcelas de 25.000,00 e 24.000,00.
2. COMPRA em 05/02/2026, fornecedor F1: 20 garrotes, brincos 0301–0320, 240,0 kg cada, CABECA a R$ 2.500,00, `valor_animais` R$ 50.000,00 em 2 parcelas de 25.000,00; frete de R$ 1.200,00 (T1); destino Pasto 2; rateio por CABECAS.

**Verificações:**
- Passo 1: VALIDATION (parcelas não somam o valor).
- Cadastro individual: 20 ANIMAIS novos, ATIVO, COMPRADO, Pasto 2, `custo_aquisicao` R$ 2.560,00 (2.500,00 + 1.200,00 ÷ 20); 20 IDENTIFICACOES; 20 PESAGENS (COMPRA).
- Fornecedor e valores: COMPRAS com `qtd_animais` 20 e `valor_total` 51.200,00; `partner_id` = F1.
- Financeiro: 2 lançamentos AQUISICAO_ANIMAIS (50.000,00 e 1.200,00); 3 PARCELAS abertas; 40 alocações (2.500,00 e 60,00 por animal), 100% alocado. Resultado gerencial de fevereiro: 0,00; a pagar: 51.200,00.
- Inventário: Pasto 2 com 0 em 04/02 e 20 em 05/02.

### CT-04: Venda

**Objetivo:** baixa, receita rateada e histórico preservado. **Nível:** 1, 2, 3. **RN:** 014, 069, 070, 108.

**Massa:** 0401–0405 em D0 no Pasto 1, sem valor de abertura.

**Passos:**
1. VENDA em 20/08/2026, comprador C1, RECRIA_ENGORDA, KG_VIVO a R$ 10,00: 450,0, 462,0, 438,0, 471,0 e 455,0 kg (2.276,0 kg); comissão de R$ 455,20; recebimento em 19/09; rateio por PESO_VIVO.

**Verificações:**
- Inventário: Pasto 1 com 5 em 19/08 e 0 em 20/08; ANIMAIS VENDIDO, `data_saida` 20/08, pasto vazio.
- Tabelas: VENDAS 1; EVENTO_ANIMAIS 5 linhas −1; PESAGENS 5 (VENDA); `partner_id` = C1.
- Receita: RECEITA_VENDA_ANIMAIS de R$ 22.760,00, parcela aberta para 19/09, alocada em 4.500,00, 4.620,00, 4.380,00, 4.710,00 e 4.550,00; DESPESA_VENDA de 455,20 (90,00 a 94,20 por animal). Resultado da negociação: 22.304,80.
- Histórico: a ficha de 0401 mantém entrada e registros anteriores.

### CT-05: Pesagem

**Objetivo:** pesagens acumulam; GMD é calculado na leitura. **Nível:** 1, 2, 3. **RN:** 049–053.

**Massa:** 0501 em D0.

**Passos:**
1. PESAGEM em 10/03/2026: 300,0 kg, BALANCA.
2. PESAGEM em 09/06/2026: 372,8 kg.
3. PESAGEM em 19/06/2026: 380,0 kg.
4. Tentar peso 0 e, em 29/06, 450,0 kg.

**Verificações:**
- Dias entre 10/03 e 09/06: 91 (21+30+31+9).
- Ganho = 372,8 − 300,0 = 72,8 kg; GMD = 72,8 ÷ 91 = 0,800 kg/dia; variação = (372,8 ÷ 300,0 − 1) × 100 = 24,27%.
- Intervalo de 10 dias (< 28): GMD `null` com DADOS_INSUFICIENTES, nunca zero.
- PESAGENS: 3 linhas, as anteriores intactas; nenhuma coluna de GMD; `peso_atual` 380,0.
- Histórico gráfico: série com 3 pontos em ordem de data; no nível 3, curva SVG com 3 marcadores e tabela equivalente; projeção rotulada "estimativa".
- Passo 4: peso 0, VALIDATION; 450,0 kg (7,0 kg/dia > 2,0), aviso PESO_IMPLAUSIVEL.

### CT-06: Vacinação coletiva

**Objetivo:** um registro por animal, consumo e custo. **Nível:** 1, 2. **RN:** 054, 055, 058, 059.

**Massa:** 0601–0630 no Pasto 1; "Vacina X" (R$ 3,00 por dose, `controla_estoque` = S); ESTOQUE/ENTRADA de 100 doses; protocolo ativo com INTERVALO_DIAS = 180.

**Passos:**
1. Aplicação com dose 0.
2. SANIDADE/VACINACAO em 05/04/2026: 30 animais, POR_CABECA, 1 dose, `quantidade_consumida_total` 30.
3. `sanidade.agenda` com o relógio em 20/09 e em 13/11/2026.

**Verificações:**
- Passo 1: VALIDATION.
- SANIDADE: 30 linhas, mesmo `event_id`, `custo` 3,00 cada.
- Consumo: 1 MOVIMENTOS_ESTOQUE (SAIDA, 30); `estoque_atual` de 100 para 70.
- Custo: 1 lançamento CUSTEIO de R$ 90,00, sem parcela; 30 alocações de 3,00; caixa inalterado.
- Próxima aplicação: 05/04 + 180 dias = 02/10/2026 nas 30 linhas; em 20/09 as pendências aparecem como próximas (antecedência de 15 dias); em 13/11, vencidas.

### CT-07: Estorno

**Objetivo:** estorno anula sem apagar. **Nível:** 1, 2. **RN:** 039, 040, 041, 043, 108, 111.

**Massa:** 0701–0703 em D0 no Pasto 1.

**Passos:**
1. TRANSFERENCIA em 10/04/2026, Pasto 1 para Baixada (E1).
2. `evento.estornar` de E1, motivo "pasto errado" (E2).
3. Estornar E1 de novo; estornar E2.
4. Variantes: estornar E1 havendo transferência posterior de 0701; estornar a entrada de animal sem outros eventos.

**Verificações:**
- Localização: os 3 voltam ao Pasto 1; `inventario.posicao` em 15/04 passa a dar Pasto 1 = 3.
- Original preservado: E1 e suas 3 linhas idênticas célula a célula, salvo os caches `status` = ESTORNADO e `reversed_by_event_id` = E2. E2: `reversal_of_event_id` = E1, data 13/11/2026, efeito 0, sem linha filha.
- Auditoria: `auditoria.listar` mostra E2 com usuário, data de registro e motivo.
- Passo 3: VALIDATION. Passo 4: CONFLICT listando a transferência posterior; o animal da entrada estornada fica ANULADO, com o brinco liberado.

### CT-08: Histórico

**Objetivo:** inventário em qualquer data, pelo replay. **Nível:** 1, 2. **RN:** 013, 024, 025.

**Massa e passos:** D0 com 100 animais (60 no Pasto 1, 40 no Pasto 2); 15/01/2026, 2 nascimentos no Pasto 1; 01/02, 10 do Pasto 1 para o Pasto 2; 20/02, venda de 5 do Pasto 2; 10/03, 1 morte no Pasto 1.

**Verificações** (`inventario.posicao`):

|Data|Total|Pasto 1|Pasto 2|Conta|
|---|---:|---:|---:|---|
|31/12/2025|`null`|—|—|ANTERIOR_AO_MARCO_ZERO|
|31/01/2026|102|62|40|100+2|
|15/02/2026|102|52|50|transferência não muda o total|
|31/03/2026|96|51|45|100+2−5−1|

- Estornada a venda, 31/03 passa a 101 (51 e 50): o passado é recalculado com os eventos vigentes.
- A reconstrução total das projeções produz ANIMAIS idêntico ao gravado.

### CT-09: Integridade

**Objetivo:** o backend bloqueia, chamado direto por `api()`. **Nível:** 1, 2.

**Massa:** 0901 vendido em 02/10/2026; 0902 morto em 05/09/2026; 0903 fêmea nascida em 20/08/2025; 0904 macho; 0905 mãe de 0906, que é mãe de 0907.

|#|Tentativa (resposta: VALIDATION em todas)|RN|
|---|---|---|
|1|VENDA de 0901 em 13/11/2026|014|
|2|TRANSFERENCIA de 0902 em 13/11/2026|015|
|3|Novo animal com brinco " 0901 "; depois "901"|002|
|4|Mãe = 0904 (macho)|008|
|5|Mãe 0903 para bezerro nascido em 12/09/2024|009|
|6|0905 como mãe de si mesma|007|
|7|0907 como mãe de 0905 (ciclo; a resposta traz o caminho)|010|
|8|Extensão: pasto de destino inexistente ou inativo|019|
|9|Extensão: evento datado de 14/11/2026|021|

**Verificações:** `ok: false` com `error.details[]` por animal e campo; todas as abas idênticas antes e depois; chave de idempotência não consumida.

### CT-10: Concorrência e duplicidade

**Objetivo:** reenvio não duplica; gravações não se intercalam. **Nível:** 1 (passos 1–5), 2 (passo 6), 3 (duplo clique). **RN:** 030, 033–038.

**Massa:** 1001 em D0 no Pasto 1.

**Passos e verificações:**
1. PESAGEM de 1001 (410,0 kg) duas vezes com a chave K1: a segunda devolve `duplicado: true` e o mesmo `event_id`; 1 linha em EVENTOS e em PESAGENS.
2. K1 com 415,0 kg: IDEMPOTENCY_MISMATCH.
3. Mesma pesagem com chave nova: aviso POSSIVEL_DUPLICIDADE (100% ≥ 80%); com `avisosAceitos`, grava.
4. Resposta perdida depois do commit: `operacao.status` devolve CONFIRMADA; o cliente não reenvia.
5. Lock tomado: LOCKED após 25 s; nova tentativa com a mesma chave grava uma vez.
6. Real: a página de concorrência dispara 5 comandos paralelos com chaves diferentes e 2 com a mesma chave. Esperado: 6 eventos com `event_seq` distintos, 1 resposta `duplicado: true`, nenhuma linha intercalada.

## 4. Cenários adicionais

### CT-11: `setup()` repetido

**Objetivo:** migração só acrescenta. **Nível:** 1, 2. **RN:** 099.

**Passos:** (1) `setup()` em banco vazio; (2) mudar `ua_peso_kg` para 400 e desativar a categoria Garrote; (3) `setup()` de novo; (4) `setup()` com o esquema da fase seguinte (uma coluna nova em PESAGENS).

**Verificações:** (1) 34 abas, cabeçalhos iguais ao Schema, 29 contas-semente, 2 gatilhos; (3) mesmas contagens de abas, linhas e gatilhos; `ua_peso_kg` segue 400; Garrote não é recriada; backup feito antes; (4) coluna nova no fim, dados intactos.

### CT-12: Importação

**Objetivo:** nada entra em silêncio nem pela metade. **Nível:** 1; 2 com arquivo pequeno. **RN:** 022, 032, 088–095.

**Massa:** arquivo de ANIMAIS com 12 linhas: 7 válidas (uma sem nascimento); 3 com erro (sexo "X", nascimento 31/02/2024, mãe inexistente); 2 duplicadas ("0012" e "12"; brinco já na base). Lotes de 5 linhas.

**Passos:** (1) validar; (2) importar em modo TOTAL; (3) importar em PARCIAL_APROVADO, com queda após o commit do lote 1; (4) registrar um evento qualquer; (5) Retomar e concluir; (6) variante: Desfazer.

**Verificações:** (1) 7 VALIDA, 3 ERRO com motivo, 2 DUPLICADA; (2) VALIDATION; (3) IMPORTANDO, nenhum dos 5 animais visível; (4) CONFLICT; (5) lote 1 reenviado devolve duplicado; 7 animais ATIVOS por ENTRADA_INICIAL em D0; backup antes de concluir; `dados_originais_json` igual ao texto do arquivo; nascimento vazio segue vazio; a reconciliação lista divergências sem bloquear; (6) CANCELADO, zero animais vigentes, linhas preservadas.

### CT-13: Rateio com centavos

**Objetivo:** rateio fecha ao centavo, de forma determinística. **Nível:** 1. **RN:** 070, 071, 077–080.

|Caso|Entrada|Esperado (R$)|
|---|---|---|
|a|100,00 por CABECAS, 3 animais|33,34; 33,33; 33,33 (centavo para o menor `codigo_interno`)|
|b|1.500,00 por PESO_VIVO: 200,0, 250,0 e 310,0 kg|394,74; 493,42; 611,84|
|c|900,00 por DIAS_PERMANENCIA: 31, 16 e 10 dias|489,47; 252,63; 157,90|
|d|Base zero|Nada alocado; motivo gravado|
|e|MANUAL somando 99,99 de 100,00|VALIDATION|
|f|Re-rateio de (a)|Novo evento RATEIO; linhas antigas intactas|

**Verificações:** Σ alocado = valor; RATEIOS com critério, `base_total` (3; 7.600; 57) e `total_alocado`; entrada embaralhada dá a mesma saída; 1.000 sorteios com semente fixa mantêm Σ exata.

### CT-14: Venda por arroba

**Objetivo:** peso vivo e carcaça não se confundem. **Nível:** 1, 2. **RN:** 053, 067, 069.

**Passos:** (a) carcaça apurada: romaneio de 285,0 e 270,0 kg, R$ 320,00 por arroba, taxas de R$ 177,60 retidas pelo comprador; (b) rendimento estimado: pesos vivos de 540,0 e 510,0 kg, 52%, R$ 310,00 por arroba; (c) ARROBA sem `base_peso`.

**Verificações:** (a) 555,0 ÷ 15 = 37,00 @; bruto R$ 11.840,00, alocado por PESO_CARCACA (6.080,00 e 5.760,00); depósito esperado R$ 11.662,40; `rendimento_tipo` APURADO; nenhuma linha em PESAGENS; (b) 1.050,0 × 0,52 ÷ 15 = 36,40 @; bruto R$ 11.284,00 (5.803,20 e 5.480,80); `rendimento_tipo` ESTIMADO; 2 PESAGENS (VENDA); (c) VALIDATION. Todo R$/@ exibido traz a base.

### CT-15: Estorno × parcela liquidada

**Objetivo:** baixa de parcela não se perde nem é atropelada. **Nível:** 1, 2. **RN:** 042, 046, 081.

**Massa:** compra de 0801–0803 por R$ 9.000,00 em 2 parcelas de 4.500,00; frete lançado como R$ 30,00.

**Passos e verificações:** (1) baixar a parcela 2 com juros de 45,00 e `valor_pago` 4.500,00: VALIDATION (exige 4.545,00); (2) `parcela.baixar` da parcela 1: LIQUIDADA; (3) `evento.estornar`: CONFLICT "desfaça a baixa antes"; (4) `evento.corrigir` com frete de 300,00: aceito, a baixa é transportada e o custo de aquisição vai de 3.010,00 a 3.100,00 por animal; (5) `evento.corrigir` com a parcela 1 em 5.000,00: CONFLICT; (6) `parcela.desfazerBaixa` e estorno: aceito.

### CT-16: Exportação

**Objetivo:** o arquivo é o que a tela mostra. **Nível:** 1 (CSV), 2 (XLSX e PDF, SP-07), 3 (botão). **RN:** 105, 106.

**Massa:** base do CT-08, mais um animal de nome "=SOMA(A1)" e brinco "0012".

**Verificações:** o Inventário atual exportado tem as linhas (97), colunas e totais de `relatorio.obter`; CSV com BOM e `;`; "0012" segue texto; célula iniciada por `=` sai neutralizada no arquivo e intacta no banco; arquivo criado pela Drive API em `ERP Pecuário/Exportações`.

### CT-17: Retroativo e mesmo dia

**Objetivo:** data passada não quebra a cadeia gravada. **Nível:** 1. **RN:** 017, 020, 023.

**Passos e verificações:** (a) 0457 foi do Pasto 1 para a Baixada em 10/03/2026; lançar Pasto 1 para Pasto 2 com data 01/03: CONFLICT citando a de 10/03; (b) lote vendido em 20/06: pesagem datada de 20/06 é aceita (limite inclusivo), de 21/06 dá VALIDATION, transferência de 20/06 dá CONFLICT.

### CT-18: Substituição de evento que cria animais

**Objetivo:** corrigir sem trocar a identidade do animal. **Nível:** 1, 2. **RN:** 044, 045.

**Massa:** a compra do CT-15, com pesagem dos 3 em 12/02 e transferência em 01/03.

**Passos:** (1) `evento.corrigir` trocando o brinco 0802 por 0812; (2) corrigir retirando 0803.

**Verificações:** (1) um só commit; original ESTORNADO; ANIMAIS com as mesmas 3 linhas, `animal_id` e `codigo_interno`; `evento_origem_id` aponta para o substituto; pesagem e transferência seguem válidas; lançamentos antigos CANCELADO; unicidade de brinco conferida no estado final; (2) CONFLICT.

### CT-19: Conciliação caixa × resultado

**Objetivo:** as três visões financeiras fecham entre si. **Nível:** 1. **RN:** 083, 084.

**Massa:** o caso de `07-financeiro-e-indicadores.md`, seção 2.2 (compra, vacina, arrendamento, morte de A3, venda de A1 e A2).

**Verificações:** resultado de março 0,00 (compra não é custeio), junho −3.733,33, novembro +5.495,73; por animal: 2.675,54; 2.352,65; −3.074,79. A identidade da conciliação fecha ao centavo nas três datas da tabela daquele documento (resultado acumulado de −3.787,33 em 30/06 e de 1.708,40 em 30/11 e 31/12), inclusive depois de estornar a venda.

### CT-20: Corpus de tipos e edição manual

**Objetivo:** valor lido = valor gravado; edição manual é detectada. **Nível:** 1, 2 (SP-01). **RN:** 026, 112.

**Passos:** (1) gravar e reler os 14 valores do corpus (`06-persistencia-e-integridade.md`, seção 2) em coluna TEXTO; (2) repetir com um adaptador de teste que omite o tipo; (3) simular edição manual: número em coluna TEXTO, `pasto_atual_id` apagado de um ATIVO, PK duplicada; (4) `sistema.integridade`.

**Verificações:** (1) idênticos nos 14, nas duas primitivas; (2) o teste falha, provando que o fake coage; (4) relata "texto virou número", "ativo sem pasto" (§16.18), PK duplicada (§16.2) e projeção × reconstrução; nada é corrigido em silêncio.

### 4.1 Casos de regra (nível 1, RN sem cenário próprio)

|RN|Caso|
|---|---|
|003, 004, 006|Com `brinco_ignora_zeros_esquerda` = N, "0012" × "12" (BRINCO_PARECIDO); brinco aposentado em outro animal; EXTERNO em transferência|
|011, 012, 027|Mãe sem confiança; mãe com filho corrigida para macho; 11º animal em pasto para 10 (LOTACAO_ACIMA_DA_CAPACIDADE)|
|056, 057|Lote vencido em 31/10/2026 aplicado em 13/11 (PRODUTO_VENCIDO); consumo de 30 com saldo de 20 (ESTOQUE_INSUFICIENTE)|
|058, 059, 072|Agenda e carência pelos exemplos de `05-regras-de-negocio.md` (4.7 e 4.8), antes, dentro e depois do prazo|
|060, 061, 064|Macho como sujeito de diagnóstico; parto de fêmea de 20 meses (IDADE_REPRODUTIVA); segundo parto 200 dias após o primeiro (INTERVALO_PARTO_CURTO)|
|066|Estação com 40 expostas, 38 diagnosticadas, 32 prenhas, 30 paridas, 31 nascidos vivos: prenhez 80,0%; parição 75,0%; natalidade 77,5%. Com 4 expostas: `null`|
|068, 073, 074, 082|Valor 2% acima de quantidade × preço (VALOR_DIVERGENTE); rateio por peso sem peso individual (RATEIO_SEM_PESO); DESCARTE grava BAIXAS, nunca VENDAS; baixa em 15/06 com `fin_bloqueio_ate` em 30/06/2026 (PERIODO_BLOQUEADO)|
|085–087|Valor manual com mais de 180 dias cai para o preço da categoria; sem referência, `null` (SEM_VALOR_DE_REFERENCIA); peso vencido marcado estimado; total com cobertura|
|096–098, 100–102|As 20 combinações de cobertura das categorias-semente; chave de configuração desconhecida; mudar `data_marco_zero` com evento vigente; alterar `codigo` de conta|
|103, 104, 107|E-mail de terceiro: DENIED com zero leituras no FakeSheets; e-mail vazio só passa com `ALLOW_EMPTY_ACTIVE_USER`; backup de 3 dias atrás gera alerta|

## 5. Falhas do protocolo e concorrência

**Oráculo.** Dois retratos das linhas vigentes: "antes" e "depois" de uma execução limpa. Após qualquer queda seguida de recuperação, o banco tem de ser igual a exatamente um deles. Comandos-modelo: venda do CT-04 (9 abas), estorno do CT-07, correção do CT-18 e `parcela.baixar`. Em cada ponto, todos os subconjuntos das escritas pendentes até 10 escritas (1.024 combinações); acima disso, 500 sorteados com semente fixa.

|Ponto de queda (casos de `06-persistencia-e-integridade.md`, 5.1 a 5.3)|Esperado após a recuperação|
|---|---|
|1: só o marcador|"Antes"; marcador removido; `operacao.status` INEXISTENTE|
|2 a 4: qualquer escrita da fase A|"Antes"; operação FALHOU ou ausente; animal criado ANULADO; filha sem pai vira alerta; reenvio com a mesma chave grava uma vez|
|5: célula de commit, chegou ou não|Um dos dois retratos, nunca intermediário|
|6 a 8: da fase C em diante|"Depois"; `aplicada_em` preenchido; versão maior; marcador removido; reenvio devolve `duplicado: true`|
|Comando sem evento|Antes do commit: nada mudou e a AUDITORIA inerte não aparece em `auditoria.listar`; depois: valor novo aplicado uma vez|
|Importação|CT-12, mais queda em `importacao.concluir` após o commit: termina IMPORTADO|
|Dentro da recuperação|Rodar de novo chega ao mesmo estado; registro em AUDITORIA e ERROS_LOG|

O caso 9 (lock depois da morte da execução) fica no SP-03.

|Intercalação (FakeLock com agendador)|Esperado|
|---|---|
|Leitor vê o marcador; o escritor termina; o leitor obtém o lock|Relê e não marca FALHOU a operação concluída|
|Commit entre a leitura de duas abas|A consulta repete; após 3 repetições devolve LOCKED|
|Dois comandos criando o mesmo brinco|O segundo relê sob lock e recebe VALIDATION|
|Reenvio da chave com a primeira tentativa em curso|`duplicado: true`|
|Gatilho de backup durante uma gravação|Espera e copia um estado sem operação pela metade|
|Commit com `dataVersionEsperada` antiga|CONFLICT|

**Teste real (nível 2).** Uma execução não disputa lock consigo mesma; por isso o passo 6 do CT-10 usa uma página servida por `doGet` em modo de teste, que envia `ambiente: 'TESTE'` em cada pedido; o servidor resolve o banco por `TEST_SPREADSHEET_ID`, nunca por ID vindo do cliente.

## 6. Rastreabilidade

### 6.1 Regras RN × testes

|Área (RN)|Cenários|Outros|
|---|---|---|
|Identificação e cadastro (001–006)|CT-01, CT-09, CT-10, CT-20|4.1|
|Genealogia (007–012)|CT-09|4.1|
|Inventário e linha do tempo (013–027)|CT-02, CT-08, CT-09, CT-12, CT-17, CT-20|4.1|
|Coletivos e atomicidade (028–032)|CT-02, CT-03, CT-10, CT-12|quedas|
|Idempotência e concorrência (033–038)|CT-10|intercalações|
|Estorno, substituição e ajuste (039–048)|CT-01, CT-07, CT-15, CT-18|—|
|Pesagem (049–053)|CT-05, CT-14|—|
|Sanidade (054–059)|CT-06|4.1|
|Reprodução (060–066)|CT-01|4.1|
|Compra e venda (067–074)|CT-03, CT-04, CT-13, CT-14|4.1|
|Financeiro, parcelas e rateio (075–084)|CT-03, CT-13, CT-15, CT-19|4.1|
|Patrimônio (085–087)|—|4.1|
|Importação (088–095)|CT-12|—|
|Configuração e categorias (096–102)|CT-11|4.1|
|Segurança e acesso (103–107)|CT-16|4.1, lint|
|Auditoria e histórico (108–112)|CT-01, CT-04, CT-07, CT-20|lint|

Um teste estático falha se alguma RN de `05-regras-de-negocio.md` não for citada em `tests/`.

### 6.2 Regras da §16 × testes

|§16|Teste|§16|Teste|
|---|---|---|---|
|1 identificação duplicada|CT-09, CT-12, CT-18|11 pesos|CT-05|
|2 IDs duplicados|CT-10, CT-20|12 quantidades e valores|CT-03, CT-06, CT-13, CT-15|
|3 venda de vendido|CT-09|13 reenvio|CT-10|
|4 movimentar morto|CT-09|14 eventos coletivos|CT-02, CT-06, quedas|
|5 pasto inexistente|CT-09|15 ajustes e estornos|CT-01, CT-07, CT-15, CT-18|
|6 origem divergente|CT-02|16 sem exclusão silenciosa|CT-04, CT-07, lint|
|7 nascimento antes da mãe|CT-09|17 alteração com auditoria|CT-01|
|8 próprio pai ou mãe|CT-09|18 sem pasto|CT-20, seed|
|9 ciclos|CT-09|19 sem identificação|CT-01|
|10 datas|CT-09, CT-12, CT-17|20 inventário × movimentações|CT-08, CT-20|

Regra 18: como toda entrada exige pasto, "ativo sem pasto" só nasce de edição manual; testa-se a detecção (CT-20) e a impossibilidade pelos comandos (seed).

## 7. Massa de dados fictícia

`seedDemoData_()` é chamada por `runAcceptanceTests()` quando a propriedade `TEST_PLAN` vale `DEMO` (padrão: `ACEITACAO`).

- **Composição em D0** (hoje menos 1.095 dias): 240 cabeças, sendo 110 vacas, 4 touros, 30 novilhas, 48 bezerros ao pé e 48 garrotes, em 6 pastos, um arrendado.
- **Três anos de eventos**, só pelos comandos: 255 nascimentos, 70 compras, 240 vendas (cabeça, kg vivo e arroba), 15 mortes, 5 descartes e 1 divergência de contagem, fechando em 304 ativos (240+255+70−240−15−5−1); manejos coletivos, 3 estações de monta, lançamentos com rateio, parcelas em todos os estados, estornos e correções.
- **Determinismo**: sorteio com semente fixa; totais conferidos; comando rejeitado derruba o seed, que assim também testa o motor. Retomável (chaves `seed:<n>`).
- **Separação da base real** (§18): planilha própria em `ERP Pecuário/Testes`, com ID em `DEMO_SPREADSHEET_ID`, nunca em `SPREADSHEET_ID`; versão e marcador por planilha; faixa "BASE DE TESTE" em todas as telas quando o banco não é o de produção. Um teste confere que a base real não muda durante o seed nem a aceitação.
- **Desempenho (SP-05)**: o mesmo gerador, com fator de escala, produz de 10 mil a 300 mil linhas.

## 8. Testes por fase

O nível 1 inteiro roda a cada commit; a fase N exige verde tudo das fases 1 a N.

|Fase|Nível 1|Nível 2 (dono)|Nível 3|Também para fechar|
|---|---|---|---|---|
|1|CT-09 (brinco e mãe), CT-10, CT-11, CT-12, CT-18 (entradas), CT-20; quedas e intercalações; lint|Spike SP-01 a SP-10; CT-10 real; CT-11; CT-20|Listagem, ficha, importação, rascunho|Relatório do spike; fake conferido (SP-01, SP-03); ensaio de restauração|
|2|CT-01 a CT-04, CT-07, CT-08, CT-09 completo, CT-13 (compra), CT-14, CT-17, CT-18|Os mesmos, sem injeção de falha|Registrar evento, revisão pelo servidor, erro coletivo|Seed completo sem rejeição|
|3|CT-05, CT-06; casos 4.1 de sanidade e reprodução|CT-05, CT-06|Modo curral a 360 px; curva de peso|—|
|4|CT-13 completo, CT-15, CT-19|CT-15|Baixa de parcela, rateio|Conciliação sobre a base do seed|
|5|CT-16; indicadores `null` com motivo|XLSX e PDF|Dashboard, relatórios, acessibilidade|Exportação × tela nos 17 relatórios|

**Ensaio de restauração (Fase 1).** Na base de teste: `sistema.backup`; registrar 3 eventos; `sistema.restaurarBackup`. Esperado: banco trocado; os 3 eventos ausentes; inventário igual ao do backup; integridade sem erro; versão de dados acima da última servida; banco anterior ainda no Drive.

## 9. Testes estáticos (lint)

Regex sobre `src/`, cada regra com autoteste de detecção:

- **Arquivos**: proibidos `DriveApp` e `SpreadsheetApp.create`.
- **Recursos externos**: `<script src>` só o do Chart.js (versão fixa, com `integrity`); página até cerca de 450 KB.
- **`Date`**: `new Date` só em `Utils` (relógio); o harness percorre toda resposta de `api()` e falha ao achar `Date`.
- **Carga nas duas ordens**: alfabética e inversa, com a mesma superfície pública.
- **Superfície pública**: sem `_` no fim, só `doGet`, `api`, `setup`, `runAcceptanceTests`, `verifyIntegrity` e os dois gatilhos, cada uma começando por `assertOwner_()`.
- **Camadas**: serviços do Apps Script fora dos arquivos de domínio; escrita na planilha só em `Database`; `LockService` só em `UnitOfWork`.
- **Sem exclusão**: o roteador não tem rota de apagar.

## 10. Modelo do relatório de testes por fase

```text
RELATÓRIO DE TESTES — FASE n — commit <hash> — <data>

1. EXECUTADO AQUI (Node)
   comando: npm test      resultado: <passaram>/<total>
   cenários: CT-xx ok | CT-yy FALHOU (motivo)
   interface (Playwright): executado | pendente (motivo)

2. A EXECUTAR NA CONTA DO DONO (nível 2)
   item                    estado                        evidência
   runAcceptanceTests()    PENDENTE | EXECUTADO dd/mm    <arquivo JSON>
   CT-10 passo 6           ...
   spike SP-nn             ...

3. HIPÓTESES NÃO CONFERIDAS NA PLATAFORMA
4. FALHAS CONHECIDAS E DECISÃO
5. VEREDITO: a fase fecha? sim | não
```
