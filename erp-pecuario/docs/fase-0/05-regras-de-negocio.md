# 05 — Regras de negócio

## Em resumo

- **112 regras, RN-001 a RN-112, em 16 áreas.** Este é o único documento que numera regras; os demais as citam pelo número ou em palavras.
- **Quatro tipos**: 50 ERRO (bloqueia), 13 AVISO (exige aceite; política por código em `avisos_politica`), 6 ALERTA (pendência visível) e 43 INVARIANTE (conferida pela verificação de integridade ou por teste).
- **Tudo é validado no servidor** (§16, última linha). Um único validador de linha do tempo atende evento novo, retroativo, estorno, substituição e integridade; as cinco situações não têm como divergir.
- **As 20 regras da §16 estão mapeadas** na seção 3, com a leitura adotada onde o texto é ambíguo.
- **O sistema registra e alerta; não prescreve** protocolo veterinário, alíquota nem capacidade de suporte (seção 6).

**Documentos relacionados:** `README.md` · `02-modelo-de-dados.md` · `03a-dicionario-cadastros-suporte.md` · `03b-dicionario-eventos-financeiro.md` · `04-motor-de-eventos.md` · `06-persistencia-e-integridade.md` · `07-financeiro-e-indicadores.md` · `08-ux-ui.md` · `09-plano-de-testes.md`.

## 1. Como ler a matriz

| Tipo | Efeito | Resposta da API |
|---|---|---|
| ERRO | Bloqueia sempre; nada é gravado | VALIDATION (o comando fere a regra), CONFLICT (choca com evento ou estado já gravado) ou o código da linha |
| AVISO | Exige aceite. Política por código em `avisos_politica`: AVISA (padrão), BLOQUEIA (vira erro VALIDATION com o mesmo código no detalhe) ou IGNORA | NEEDS_CONFIRMATION; a coluna Código traz o código do aviso. O cliente reenvia com `avisosAceitos[]`; o aceite fica em `EVENTOS.payload_json` |
| ALERTA | Pendência visível em `alerta.listar`; não bloqueia | — |
| INVARIANTE | Propriedade que vale sempre nos dados ou nas respostas, por construção | Só aparece no relatório de `sistema.integridade` ou em teste; nunca é erro para o usuário |

- **Ordem de validação**: esquema (tipo, obrigatório, enum, faixa) → regras do tipo de evento → linha do tempo de cada animal → regras financeiras. Os erros são coletados e devolvidos juntos em `error.details[]`, por animal e campo. Havendo erro, a resposta é de erro mesmo que existam avisos.
- Erro, aviso e LOCKED não consomem a chave de idempotência: o reenvio corrigido usa a mesma chave.
- **Colunas.** Origem: § da especificação, ou `DV-nn` (divergência documentada nos dicionários). Onde: módulo de `src/`; Timeline = `TimelineValidator` e `Projector`; Integridade = verificação em `AuditService`. CT: cenário de `09-plano-de-testes.md`; "novo" = nenhum CT cobre, pede caso próprio no nível 1.
- **Códigos de aviso** (lista completa; são as chaves de `avisos_politica`). Do desenho-base: CARENCIA_ATIVA, POSSIVEL_DUPLICIDADE, BRINCO_PARECIDO, LOTACAO_ACIMA_DA_CAPACIDADE, PESO_IMPLAUSIVEL, IDADE_REPRODUTIVA, PERIODO_BLOQUEADO. Fechados aqui: VALOR_DIVERGENTE, RATEIO_SEM_PESO, INTERVALO_PARTO_CURTO, PRODUTO_VENCIDO, ESTOQUE_INSUFICIENTE, CATEGORIAS_SEM_COBERTURA.

```mermaid
flowchart TD
  C[Comando] --> G{Dono?}
  G -->|nao| DN[DENIED]
  G -->|sim| L{"Lock em 25 s?"}
  L -->|nao| LK[LOCKED]
  L -->|sim| I{"Chave ja confirmada?"}
  I -->|"mesmo conteudo"| DUP["ok, duplicado: true"]
  I -->|"conteudo diferente"| IM[IDEMPOTENCY_MISMATCH]
  I -->|nao| V["Validacao: esquema, tipo, linha do tempo, financeiro"]
  V -->|erros| E["VALIDATION ou CONFLICT"]
  V -->|"avisos sem aceite"| N[NEEDS_CONFIRMATION]
  V -->|limpo| W["Grava: fases A, B e C"]
```

## 2. Matriz de regras

### 2.1 Identificação e cadastro

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-001|Toda PK é UUID em texto gerado pelo sistema, única na tabela e nunca derivada do número da linha.|§2.1, §16.2|INVARIANTE|Utils; Integridade|—|novo|
|RN-002|Dois animais não anulados, ativos ou baixados, não têm o mesmo `brinco_norm` preenchido.|§2.1, §16.1|ERRO|Validation|VALIDATION|CT-09|
|RN-003|Com `brinco_ignora_zeros_esquerda` = N, brincos que só diferem por zeros à esquerda convivem, com aviso.|DV-05|AVISO|Validation|BRINCO_PARECIDO|novo|
|RN-004|Brinco de período já encerrado em outro animal só é aceito com `brinco_permite_reuso` = S.|§2.1|ERRO|Validation|VALIDATION|novo|
|RN-005|Animal ATIVO sem brinco vigente aparece na pendência "sem brinco"; brinco é opcional.|§16.19|ALERTA|AnimalService|—|CT-01|
|RN-006|Animal EXTERNO fica fora do inventário e só aceita papel de progenitor ou TOURO.|DV-06|ERRO|Timeline|VALIDATION|novo|

### 2.2 Genealogia

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-007|Animal não é a própria mãe nem o próprio pai.|§5.2, §16.8|ERRO|Validation|VALIDATION|CT-09|
|RN-008|Mãe é fêmea; pai é macho.|§5.2|ERRO|Validation|VALIDATION|CT-09|
|RN-009|Nascimento do filho é posterior ao da mãe e ao do pai, quando as datas são conhecidas.|§5.2, §16.7|ERRO|Validation|VALIDATION|CT-09|
|RN-010|Vínculo que torna o animal ancestral de si mesmo é recusado.|§5.2, §16.9|ERRO|Validation|VALIDATION|CT-09|
|RN-011|Mãe e pai podem ficar vazios (desconhecidos); vínculo preenchido exige confiança CONFIRMADA ou ESTIMADA.|§5.2|ERRO|Schema|VALIDATION|novo|
|RN-012|Corrigir sexo ou nascimento de um animal reaplica RN-008 e RN-009 aos vínculos em que ele é progenitor.|§5.2|ERRO|Validation|VALIDATION|novo|

### 2.3 Inventário e linha do tempo

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-013|Todo animal ATIVO tem exatamente uma entrada vigente (+1) sem saída posterior.|DV-06|INVARIANTE|Timeline; Integridade|—|CT-08|
|RN-014|Saída (VENDA, MORTE, DESCARTE, DIVERGENCIA_CONTAGEM) exige animal ATIVO na data.|§16.3|ERRO|Timeline|VALIDATION|CT-09|
|RN-015|MORTO é terminal: não aceita evento com data posterior à morte nem reentrada.|§16.4|ERRO|Timeline|VALIDATION|CT-09|
|RN-016|VENDIDO, DESCARTADO ou BAIXADO_AJUSTE só aceita reentrada (COMPRA, OUTRA_ENTRADA) com data posterior à saída.|§6.3|ERRO|Timeline|VALIDATION|CT-09|
|RN-017|Pesagem, sanidade, reprodução, parto (matriz), desmama e identificação exigem data dentro de um período de permanência, limites inclusivos.|§6.3|ERRO|Timeline|VALIDATION|CT-17|
|RN-018|Na TRANSFERENCIA, cada animal está no pasto de origem informado na data do evento.|§6.4, §16.6|ERRO|Timeline|VALIDATION|CT-02|
|RN-019|Pasto de destino, como toda referência de evento, existe e está ativo; destino difere da origem.|§16.5|ERRO|Validation|VALIDATION|CT-09|
|RN-020|Evento retroativo que invalida eventos posteriores do animal é recusado, listando-os.|§2.3|ERRO|Timeline|CONFLICT|CT-17|
|RN-021|`event_date` não é futura nem anterior ao nascimento do animal; em pares início/fim, início ≤ fim.|§16.10|ERRO|Validation|VALIDATION|CT-09|
|RN-022|ENTRADA_INICIAL é datada do marco zero; evento anterior a ele entra só como informativo, com efeito 0.|§14|ERRO|Timeline|VALIDATION|CT-12|
|RN-023|Eventos do mesmo animal no mesmo dia valem na ordem entrada, demais, saída; depois `event_seq`.|§2.3|INVARIANTE|Timeline|—|CT-17|
|RN-024|Σ `efeito_inventario` dos eventos vigentes = número de animais ATIVOS.|§16.20|INVARIANTE|Integridade|—|CT-08|
|RN-025|Projeções de ANIMAIS e `EVENTOS.status` coincidem com o replay dos eventos vigentes.|§2.3, §16.20|INVARIANTE|Timeline; Integridade|—|CT-08|
|RN-026|Animal ATIVO sem `pasto_atual_id` aparece na pendência "sem pasto".|§16.18|ALERTA|InventoryService|—|CT-20|
|RN-027|Entrada ou transferência que leva o pasto acima da capacidade informada gera aviso.|§7|AVISO|PastureService|LOTACAO_ACIMA_DA_CAPACIDADE|novo|

### 2.4 Eventos coletivos e atomicidade

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-028|Erro em um animal rejeita o evento coletivo inteiro, com a lista por animal e campo.|§2.4, §16.14|ERRO|EventService|VALIDATION|CT-02|
|RN-029|Cada animal aparece uma vez por papel; há ao menos um animal; totais do cabeçalho = contagem das linhas.|§16.14|ERRO|Validation|VALIDATION|CT-03|
|RN-030|Só linhas de operação CONFIRMADA são visíveis em consulta.|§2.4|INVARIANTE|Repository|—|CT-10|
|RN-031|Operação órfã é resolvida antes do próximo comando: INICIADA vira FALHOU; CONFIRMADA sem `aplicada_em` reaplica a fase C.|§2.4|INVARIANTE|UnitOfWork|—|novo|
|RN-032|Com importação em IMPORTANDO, os demais comandos de escrita são recusados.|§2.4|ERRO|UnitOfWork|CONFLICT|CT-12|

### 2.5 Idempotência e concorrência

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-033|Há no máximo uma operação CONFIRMADA por `idempotency_key`; reenvio idêntico devolve o resultado original com `duplicado: true`.|§2.4, §16.13|INVARIANTE|UnitOfWork|—|CT-10|
|RN-034|Mesma chave com conteúdo diferente é recusada.|§16.13|ERRO|UnitOfWork|IDEMPOTENCY_MISMATCH|CT-10|
|RN-035|Toda escrita roda sob lock; sem lock em 25 s, nada é gravado.|§2.4|ERRO|UnitOfWork|LOCKED|CT-10|
|RN-036|Evento de mesmo tipo e data com ≥ 80% dos animais de um evento vigente gera aviso.|§2.4|AVISO|EventService|POSSIVEL_DUPLICIDADE|CT-10|
|RN-037|Commit com `dataVersionEsperada` diferente da versão atual é recusado.|§6|ERRO|EventService|CONFLICT|novo|
|RN-038|`event_seq` e `codigo_interno` são únicos e crescentes (máximo + 1 sob lock).|§3.2|INVARIANTE|UnitOfWork; Integridade|—|CT-10|

### 2.6 Estorno, substituição e ajuste

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-039|ESTORNO anula o original sem apagá-lo: ele fica ESTORNADO e sai do replay.|§2.3, §16.15|INVARIANTE|EventService|—|CT-07|
|RN-040|Estorno que deixa inválida a linha do tempo restante é recusado, listando os dependentes.|§2.3|ERRO|Timeline|CONFLICT|CT-07|
|RN-041|Estorno de evento criador exige animal sem outro evento vigente e sem referência (mãe, pai, touro, rateio); o animal fica ANULADO.|§2.3|ERRO|EventService|CONFLICT|CT-07|
|RN-042|Estorno de evento com parcela LIQUIDADA exige desfazer a baixa antes.|§11.3|ERRO|FinancialService|CONFLICT|CT-15|
|RN-043|ESTORNO não é estornável; evento estornado não é estornado de novo.|§16.15|ERRO|EventService|VALIDATION|CT-07|
|RN-044|Substituto tem o tipo do original, anula-o no mesmo commit e reaproveita os `animal_id` criados.|§2.1, §2.3|ERRO|EventService|VALIDATION|CT-18|
|RN-045|Substituição é validada uma vez sobre o conjunto final; mudança só de valores, parceiro, parcelas ou observações nunca é bloqueada por dependentes.|§2.3|ERRO|Timeline|CONFLICT|CT-18|
|RN-046|Substituição transporta a baixa da parcela com valor e vencimento inalterados; se mudaram, exige desfazer a baixa.|§11.3|ERRO|FinancialService|CONFLICT|CT-15|
|RN-047|Todo AJUSTE_INVENTARIO exige justificativa e grava valor anterior e novo.|§6.12, §16.15|ERRO|Validation|VALIDATION|CT-01|
|RN-048|Sexo, nascimento, mãe, pai, brinco e castrado só mudam por evento; o valor de criação é preservado.|§16.17|INVARIANTE|AnimalService|—|CT-01|

### 2.7 Pesagem

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-049|Peso vivo é maior que zero, com uma casa decimal, e de no máximo 2.000 kg (limite de digitação).|§16.11|ERRO|Schema|VALIDATION|CT-05|
|RN-050|Variação diária contra a pesagem anterior fora da faixa `gmd_plausivel_*` gera aviso.|§16.11|AVISO|WeightService|PESO_IMPLAUSIVEL|CT-05|
|RN-051|Nova pesagem nunca altera nem substitui linha anterior.|§6.5|INVARIANTE|Repository|—|CT-05|
|RN-052|GMD exige intervalo ≥ `gmd_intervalo_min_dias` e método individual; senão devolve `null` (DADOS_INSUFICIENTES).|§8|INVARIANTE|WeightService|—|CT-05|
|RN-053|Projeção, média calculada e peso de carcaça nunca entram em PESAGENS.|§6.3, §8|INVARIANTE|WeightService|—|CT-14|

### 2.8 Sanidade

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-054|Aplicação coletiva gera uma linha por animal, um movimento de estoque e um lançamento de consumo sem parcela.|§6.6|INVARIANTE|HealthService|—|CT-06|
|RN-055|Dose e quantidade consumida são maiores que zero; no modo TOTAL a dose individual fica vazia.|§16.12|ERRO|Validation|VALIDATION|CT-06|
|RN-056|Validade do lote anterior à data da aplicação gera aviso.|§10|AVISO|HealthService|PRODUTO_VENCIDO|novo|
|RN-057|Consumo acima do saldo, em produto com `controla_estoque` = S, gera aviso.|§10|AVISO|HealthService|ESTOQUE_INSUFICIENTE|novo|
|RN-058|Pendência sanitária = animal elegível a protocolo ativo sem aplicação posterior da mesma chave.|§10|INVARIANTE|HealthService|—|CT-06|
|RN-059|Procedimento vencido ou próximo do vencimento e animal em carência aparecem na agenda e nos alertas.|§10|ALERTA|HealthService|—|novo|

### 2.9 Reprodução

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-060|Sujeito de evento reprodutivo é fêmea; `touro_id` é macho ATIVO ou EXTERNO.|§5.2|ERRO|Validation|VALIDATION|novo|
|RN-061|Parto ou evento reprodutivo de fêmea abaixo de `idade_min_reprodutiva_meses` gera aviso.|§5.2|AVISO|ReproductionService|IDADE_REPRODUTIVA|novo|
|RN-062|Cada parto é um NASCIMENTO com uma linha REPRODUCAO(PARTO); nascidos vivos + natimortos ≥ 1.|§6.1|ERRO|Validation|VALIDATION|CT-01|
|RN-063|Só nascido vivo cria animal (+1, com `mae_id`); natimorto não cria.|§6.1|INVARIANTE|EventService|—|CT-01|
|RN-064|Parto a menos de `dias_gestacao` dias do parto anterior da matriz gera aviso.|§9|AVISO|ReproductionService|INTERVALO_PARTO_CURTO|novo|
|RN-065|Situação reprodutiva é projeção, nunca pré-condição: parto é aceito de qualquer situação.|§9|INVARIANTE|Timeline|—|CT-01|
|RN-066|Indicador com n abaixo de `indicador_n_minimo` devolve `null` (DADOS_INSUFICIENTES), nunca zero.|§9|INVARIANTE|ReproductionService|—|novo|

### 2.10 Compra e venda

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-067|Modalidade ARROBA exige `base_peso`; base VIVO exige rendimento NEGOCIADO ou ESTIMADO.|§6.3, §11.1|ERRO|Validation|VALIDATION|CT-14|
|RN-068|Valor informado prevalece; diferença para quantidade × preço acima de `fin_tolerancia_conferencia_pct` gera aviso.|§11.1|AVISO|FinancialService|VALOR_DIVERGENTE|novo|
|RN-069|Receita da venda = bruto − desconto comercial; cada dedução é lançamento DESPESA_VENDA próprio.|§6.3|INVARIANTE|FinancialService|—|CT-04|
|RN-070|Lançamentos de COMPRA e VENDA são 100% alocados aos animais pelo critério do evento.|§6.3|INVARIANTE|FinancialService; Integridade|—|CT-13|
|RN-071|Rateio MANUAL soma exatamente o valor do lançamento.|§6.3|ERRO|FinancialService|VALIDATION|CT-13|
|RN-072|Venda de animal em carência: bloqueada por padrão se a finalidade é ABATE; nas demais, aviso.|§10|AVISO|HealthService|CARENCIA_ATIVA|novo|
|RN-073|Rateio por peso sem peso individual usa a última pesagem escalada ou cai para CABECAS, com aviso.|§6.3|AVISO|FinancialService|RATEIO_SEM_PESO|novo|
|RN-074|DESCARTE é saída sem negociação: grava BAIXAS, nunca VENDAS.|§6.9|INVARIANTE|EventService|—|novo|

### 2.11 Financeiro, parcelas e rateio

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-075|Valor monetário tem 2 casas e não é negativo; valor de lançamento e quantidade são maiores que zero.|§16.12|ERRO|Validation|VALIDATION|CT-03|
|RN-076|Σ `PARCELAS.valor` = `FINANCEIRO.valor`.|§11.3|ERRO|FinancialService; Integridade|VALIDATION|CT-03|
|RN-077|Σ alocações vigentes de um lançamento ≤ valor; a diferença aparece como "não alocado".|§11.2|INVARIANTE|Integridade|—|CT-13|
|RN-078|Rateio fecha em centavos pelo maior resto: Σ alocado = valor rateado.|§11.2|INVARIANTE|FinancialService|—|CT-13|
|RN-079|Toda alocação pertence a um rateio com critério, escopo, base e data ou período gravados.|§11.2|INVARIANTE|FinancialService; Integridade|—|CT-13|
|RN-080|Custo compartilhado só chega ao animal por evento RATEIO; re-rateio é evento novo e não altera linhas antigas.|§11.2|INVARIANTE|FinancialService|—|CT-13|
|RN-081|Baixa exige parcela ABERTA, data não futura e `valor_pago` = valor + juros − desconto.|§11.3|ERRO|FinancialService|VALIDATION|CT-15|
|RN-082|Criar ou cancelar lançamento, ou mexer em baixa, até `fin_bloqueio_ate` exige aceite com justificativa.|§11.3|AVISO|FinancialService|PERIODO_BLOQUEADO|novo|
|RN-083|O resultado usa `natureza`: aquisição de animais, compra de insumos e não operacional ficam fora do custeio.|§11.3|INVARIANTE|FinancialService|—|CT-19|
|RN-084|Caixa, resultado e custo por animal conciliam pela identidade de `07-financeiro-e-indicadores.md`.|§11.3|INVARIANTE|FinancialService|—|CT-19|

### 2.12 Patrimônio

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-085|Valor do animal: manual vigente, senão preço da categoria, senão geral, senão `null` (SEM_VALOR_DE_REFERENCIA).|§11.4|INVARIANTE|FinancialService|—|novo|
|RN-086|Peso vigente: última pesagem dentro de `peso_validade_dias`; senão o maior entre último peso e peso de referência, marcado estimado.|§7|INVARIANTE|InventoryService|—|novo|
|RN-087|Valor estimado, custo e valor negociado têm rótulos distintos, nunca são somados, e o total traz a cobertura.|§11.4|INVARIANTE|ReportService|—|novo|

### 2.13 Importação

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-088|Linha inconsistente fica em ERRO com o motivo; nunca é importada em silêncio.|§14|ERRO|ImportService|VALIDATION|CT-12|
|RN-089|Arquivo com linhas em erro só é importado no modo PARCIAL_APROVADO, com aprovação explícita.|§14|ERRO|ImportService|VALIDATION|CT-12|
|RN-090|Cada linha passa pelo mesmo comando e pelas mesmas regras do formulário.|§14|INVARIANTE|ImportService|—|CT-12|
|RN-091|Linha repetida no arquivo ou já existente na base fica DUPLICADA e não entra.|§14|ERRO|ImportService|VALIDATION|CT-12|
|RN-092|Eventos importados só valem com a importação IMPORTADO; interrompida, nada vale até Retomar ou Desfazer.|§14|INVARIANTE|Repository|—|CT-12|
|RN-093|O texto original de cada linha é preservado; vazio = desconhecido, sem valor padrão.|§14|INVARIANTE|ImportService|—|CT-12|
|RN-094|Progenitor não encontrado mantém a linha em erro até a decisão: desconhecido, criar EXTERNO ou corrigir.|§14|ERRO|ImportService|VALIDATION|CT-12|
|RN-095|A reconciliação lista divergências entre a fotografia do marco zero e o histórico, sem bloquear.|§14|ALERTA|ImportService|—|CT-12|

### 2.14 Configuração e categorias

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-096|Categoria = reclassificação manual vigente; senão a primeira categoria ativa, por `prioridade`, que casa sexo, idade e condição.|§4.12, §6.12|INVARIANTE|AnimalService|—|novo|
|RN-097|Salvar categorias deixando combinação de sexo, idade e condição sem cobertura gera aviso.|§4.12|AVISO|Validation|CATEGORIAS_SEM_COBERTURA|novo|
|RN-098|Animal sem categoria aplicável aparece na pendência "sem categoria".|§4.12|ALERTA|AnimalService|—|novo|
|RN-099|`setup()` repetido não duplica abas, colunas nem sementes, nem sobrescreve valor do usuário.|§3.2|INVARIANTE|Schema|—|CT-11|
|RN-100|Parâmetro é validado por tipo e faixa; chave desconhecida é recusada.|§21|ERRO|Validation|VALIDATION|novo|
|RN-101|`data_marco_zero` não muda enquanto houver evento vigente com efeito de inventário.|§14|ERRO|Validation|CONFLICT|novo|
|RN-102|`codigo` de lista, categoria e conta é único e imutável; `grupo` e `natureza` da conta travam após o primeiro lançamento.|§4.12|ERRO|Validation|VALIDATION|novo|

### 2.15 Segurança e acesso

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-103|Toda função pública começa por `assertOwner_()`; quem não é o dono recebe DENIED sem leitura de dados.|§17|ERRO|Api|DENIED|novo|
|RN-104|E-mail de sessão vazio só passa com a flag de contingência ligada.|§17|ERRO|Api|DENIED|novo|
|RN-105|Anexo, foto e exportação são arquivos privados; nenhum dado de negócio vai em URL ou log público.|§17|INVARIANTE|FileService|—|novo|
|RN-106|A exportação neutraliza células iniciadas por `=`, `+`, `-`, `@`; a gravação preserva o texto digitado.|§17|INVARIANTE|ReportService|—|CT-16|
|RN-107|Backup atrasado além de `alerta_backup_atrasado_dias` ou integridade com erro gera alerta.|§17|ALERTA|Maintenance|—|novo|

### 2.16 Auditoria e histórico

|RN|Regra|Origem|Tipo|Onde|Código|CT|
|---|---|---|---|---|---|---|
|RN-108|Evento confirmado e suas linhas filhas são imutáveis; não há rota de edição nem de exclusão.|§2.2, §16.16|INVARIANTE|Api; Repository|—|CT-07|
|RN-109|Edição de campo `[cad]` grava AUDITORIA (anterior, novo, usuário, hora) no mesmo commit.|§16.17|INVARIANTE|UnitOfWork|—|CT-01|
|RN-110|Não há exclusão de cadastro: pasto, parceiro, produto, categoria e conta só são desativados.|§16.16|INVARIANTE|Api|—|novo|
|RN-111|Todo evento grava data de ocorrência, data de registro, usuário, origem e status.|§2.5|INVARIANTE|EventService|—|CT-07|
|RN-112|A verificação de integridade detecta edição manual da planilha e só relata; nunca corrige em silêncio.|§17|INVARIANTE|Integridade|—|CT-20|

## 3. Regras da §16 → RN

| §16 | Regra | RN | Leitura adotada |
|---|---|---|---|
| 1 | Duplicidade de identificação | RN-002, RN-003, RN-004 | Unicidade entre ativos e baixados; brinco é opcional (regra 19) |
| 2 | Duplicidade de IDs | RN-001, RN-038 | — |
| 3 | Venda de animal já vendido | RN-014, RN-016 | Vale para toda saída |
| 4 | Movimentação de animal morto | RN-015 | Qualquer evento posterior à morte, não só transferência |
| 5 | Transferência para pasto inexistente | RN-019 | Inexistente ou inativo |
| 6 | Origem divergente da localização | RN-018 | Local na data do evento, não o atual |
| 7 | Nascimento anterior ao da mãe | RN-009 | Estendida ao pai |
| 8 | Animal como próprio pai ou mãe | RN-007 | — |
| 9 | Ciclos genealógicos | RN-010 | — |
| 10 | Validar datas | RN-017, RN-021, RN-022, RN-081 | Lista fechada: não futura; não anterior ao nascimento; início ≤ fim; dentro da permanência; marco zero |
| 11 | Validar pesos | RN-049, RN-050, RN-053 | Faixa é erro; implausibilidade é aviso |
| 12 | Quantidades e valores financeiros | RN-055, RN-071, RN-075, RN-076, RN-081 | — |
| 13 | Eventos duplicados por reenvio | RN-033, RN-034, RN-036 | Reenvio técnico (chave) e redigitação (guarda semântica) |
| 14 | Consistência dos eventos coletivos | RN-028 a RN-032 | Tudo ou nada |
| 15 | Registrar ajustes e estornos | RN-039 a RN-048 | — |
| 16 | Sem exclusão silenciosa | RN-051, RN-108, RN-110 | Não existe rota de exclusão |
| 17 | Alteração cadastral com auditoria | RN-048, RN-109 | Campo comum: AUDITORIA; atributo sensível: evento de ajuste |
| 18 | Identificar animais sem pasto | RN-026 | "Identificar" = alerta, não bloqueio |
| 19 | Identificar animais sem identificação física | RN-005 | Idem |
| 20 | Coerência entre inventário e movimentações | RN-013, RN-024, RN-025 | — |

## 4. Algoritmos

### 4.1 Unicidade de brinco com normalização (RN-002 a RN-004)

1. `norm(texto)`: aparar as pontas → maiúsculas → remover espaços internos → se só restarem dígitos, tirar os zeros à esquerda (mantendo um dígito). " 0012 " → `12`; "a 12" → `A12`.
2. Ocupados = `brinco_norm` de todo animal não ANULADO, ativo ou baixado. BRINCO_ORIGEM, RFID e os demais tipos de IDENTIFICACOES ficam fora.
3. Colisão com ocupado → erro (RN-002). Com `brinco_ignora_zeros_esquerda` = N, só colide a forma anterior à retirada dos zeros; "0012" × "12" vira aviso BRINCO_PARECIDO (RN-003).
4. Sem colisão, procurar o `codigo_norm` em períodos encerrados (`data_fim` preenchida) de outro animal: achou e `brinco_permite_reuso` = N → erro (RN-004). O mesmo animal pode retomar um número que já foi seu.
5. Em evento com vários animais, conferir também a repetição dentro do próprio evento.

Leitura de §2.1 ("ativos e históricos, salvo substituição formalmente registrada"): animal vendido ou morto continua dono do número; só o brinco trocado por evento IDENTIFICACAO libera o número antigo, e apenas com o reuso ligado.

### 4.2 Ciclo genealógico (RN-010)

Ao propor P como mãe ou pai de X:

1. P = X → erro (RN-007).
2. Fila ← [P]; visitados ← vazio.
3. Tirar A da fila. A = X → ciclo: erro com o caminho percorrido.
4. Senão, pôr na fila a mãe e o pai de A ainda não visitados (projeções vigentes).
5. Fila vazia → sem ciclo.

Exemplo: 0102 é mãe de 0310, que é mãe de 0457. Propor 0457 como mãe de 0102: a fila percorre 0457 → 0310 → 0102 = X; recusado. O custo é o número de ancestrais de P, sobre o índice em memória. Na importação, o teste roda depois da segunda passada de resolução de mãe e pai, sobre arquivo + base.

### 4.3 Linha do tempo: inserção, retroativo, estorno e substituição (RN-013 a RN-023, RN-040, RN-045)

O validador recebe as linhas vigentes de EVENTO_ANIMAIS de um animal (do marco zero em diante), ordena por (`event_date`, classe, `event_seq`) e percorre com o estado {dentro, pasto, morto}:

1. Entrada (+1): exige fora e não morto → dentro; pasto = destino.
2. Movimento (efeito 0 com pasto): exige dentro e origem = pasto → pasto = destino.
3. Saída (−1): exige dentro → fora; MORTE marca morto.
4. Fato independente (RN-017): fica fora da sequência; a data precisa cair em algum intervalo [entrada, saída], inclusivo.

| Situação | Lista validada | Falha |
|---|---|---|
| Evento novo ou retroativo | vigentes + linhas novas, na posição canônica | VALIDATION se a primeira linha inválida é do comando; CONFLICT se é de evento já gravado (RN-020) |
| Estorno | vigentes − linhas do evento | CONFLICT com os dependentes (RN-040); referências fora da linha do tempo em RN-041 e RN-042 |
| Substituição | vigentes − linhas do original + linhas novas, em uma única passada | CONFLICT (RN-045) |
| Integridade | vigentes | Relatório |

Exemplo: 0231 entrou no marco zero, foi pesado em 25/10/2026 e transferido em 02/11/2026. Lançar em 13/11 uma venda datada de 10/10: a venda em si passa (ele estava dentro), mas a pesagem de 25/10 e a transferência de 02/11 ficam fora da permanência → CONFLICT listando as duas.

### 4.4 Guarda semântica de duplicidade (RN-036)

1. A = animais do evento novo (papéis SUJEITO e CRIA).
2. Candidatos = eventos vigentes com o mesmo `event_type`, `event_subtype` e `event_date`; em SANIDADE, também o mesmo produto.
3. Para cada candidato com animais B: sobreposição = |A ∩ B| ÷ |A|.
4. Sobreposição ≥ 0,80 → aviso POSSIVEL_DUPLICIDADE apontando o evento existente.

Exemplo: pesagem de 80 animais em 13/11; já existe pesagem dessa data com 78 deles: 78 ÷ 80 = 97,5% → aviso. Com 60 em comum, 75% → sem aviso. A idempotência (RN-033) pega o reenvio técnico, com a mesma chave; esta guarda pega a redigitação, com chave nova.

### 4.5 Rateio pelo maior resto com desempate (RN-078)

Entradas: valor V em centavos; bases inteiras b (cabeça = 1; peso em décimos de kg; dias; centavos); B = Σ b.

1. Quociente q = ⌊V × b ÷ B⌋; resto r = (V × b) mod B.
2. Sobra S = V − Σ q, sempre menor que o número de animais.
3. Ordenar por maior resto → maior base → menor `codigo_interno`; os S primeiros recebem 1 centavo.
4. B = 0 → nada é alocado; o rateio registra o motivo e o valor fica "não alocado".

Exemplo 1 (CT-13): R$ 100,00 por CABECAS entre três animais: q = 3.333 cada, restos iguais, S = 1 → 33,34 / 33,33 / 33,33; o centavo vai para o menor código.

Exemplo 2: frete de R$ 1.500,00 por PESO_VIVO, animais de 200,0, 250,0 e 310,0 kg (B = 7.600): q = 39.473 / 49.342 / 61.184 (Σ 149.999); restos 5.200 / 800 / 1.600; S = 1 vai para o de 200 kg → R$ 394,74 / 493,42 / 611,84 = 1.500,00.

### 4.6 Dias de permanência (RN-080)

Para o critério DIAS_PERMANENCIA, com escopo (pasto, categoria, rebanho ou lista) e período [início, fim]:

1. Por animal, montar os intervalos [entrada no escopo, saída do escopo) pelos movimentos vigentes: o dia da entrada conta, o da saída não.
2. dias = Σ máx(0, mín(saída, fim + 1 dia) − máx(entrada, início)).
3. Base total = Σ dias; aplicar 4.5.

Exemplo: arrendamento de R$ 900,00, pasto Retiro, 01/03 a 31/03/2027. A ficou o mês inteiro: 31 dias. B entrou em 16/03: 16 dias. C saiu em 11/03: 10 dias. Base 57; q = 48.947 / 25.263 / 15.789 (Σ 89.999); restos 21 / 9 / 27 → centavo para C: R$ 489,47 / 252,63 / 157,90 = 900,00.

A convenção difere de RN-017, em que o dia da saída é incluso: lá se valida presença; aqui se evita contar o mesmo dia em dois pastos.

### 4.7 Elegibilidade de protocolo sanitário (RN-058)

O animal é elegível ao protocolo na data D quando, ao mesmo tempo:

1. está ATIVO em D e o protocolo está ativo;
2. `sexo_aplicavel` é AMBOS ou igual ao sexo;
3. a idade em meses completos está em [`idade_min_meses`, `idade_max_meses`), vazio = sem limite; protocolo com faixa de idade exige nascimento conhecido;
4. `category_id` está vazio ou é a categoria do animal em D.

Pendência = elegível sem aplicação vigente da mesma chave com data ≥ vencimento − tolerância (do protocolo, ou `agenda_tolerancia_dias`). O vencimento por `recorrencia_tipo` está em `03a-dicionario-cadastros-suporte.md`. Exemplo: protocolo UNICA para fêmeas de 3 a 8 meses; bezerra nascida em 10/02/2027 fica elegível em 10/05/2027 e a pendência vence em 10/10/2027.

### 4.8 Carência na venda (RN-072)

1. Para cada animal, C = maior `data_fim_carencia` das linhas vigentes de SANIDADE, em que `data_fim_carencia` = `data_aplicacao` + `periodo_carencia_dias` (último dia de carência).
2. Em carência se a data da venda ≤ C.
3. Finalidade ABATE: aplica a política de CARENCIA_ATIVA (padrão BLOQUEIA → VALIDATION). Demais finalidades: sempre aviso com aceite.

Exemplo: vermífugo em 01/11/2026 com 35 dias → carência até 06/12/2026. Venda para abate em 13/11: bloqueada; em 07/12: livre. Venda para recria em 13/11: aviso, gravado com o evento.

### 4.9 Classificação e cobertura das categorias (RN-096, RN-097)

Classificar o animal em D:

1. Reclassificação manual vigente em D → é a categoria.
2. Idade = meses completos do nascimento até D.
3. Percorrer as categorias ativas em `prioridade` crescente; vale a primeira com sexo compatível, mínima ≤ idade < máxima (vazio = sem limite) e `condicao` satisfeita em D.
4. Nenhuma casou → "sem categoria" (RN-098). Sem data de nascimento, só casa categoria sem limite de idade.

Cobertura: perfis = macho reprodutor, macho inteiro não reprodutor, macho castrado, fêmea parida, fêmea não parida. Cortes = 0 e todos os limites de idade das categorias ativas. Para cada perfil e cada faixa entre cortes consecutivos (mais a faixa aberta final), classifica-se um animal fictício com a idade do corte inferior; sem categoria → lacuna listada no aviso.

Exemplo: as sementes têm cortes 0, 12, 24 e 36 → 5 perfis × 4 faixas = 20 testes, todos cobertos. Desativar "Novilha (24 meses ou mais)" abre duas lacunas: fêmea não parida de 24 a 36 meses e de 36 em diante.

## 5. Mensagens de erro

Padrão: **quem** (brinco como digitado; sem brinco, código interno) + **o que não pôde ser feito** + **o fato que impede, com data** + **o que fazer**. Linguagem do curral, sem termo técnico (nada de "evento vigente", "FK" ou "status"). Datas em dd/mm/aaaa, valores em R$. Em evento coletivo há uma mensagem por animal em `error.details[]` e a tela resume "3 de 80 com problema" (`08-ux-ui.md`).

| RN | Código | Mensagem |
|---|---|---|
| RN-002 | VALIDATION | Brinco 0412 já é do animal A-000087, vendido em 03/08/2026. Escolha outro número. |
| RN-014 | VALIDATION | 0188 não pode ser vendido em 13/11/2026: já saiu do rebanho por venda em 02/10/2026. |
| RN-015 | VALIDATION | 0198 morreu em 05/09/2026 e não pode ser transferido em 13/11/2026. |
| RN-018 | VALIDATION | Em 13/11/2026, 0520 estava no pasto Baixada, não no Pasto 1 (transferido em 02/11/2026). Corrija a origem ou tire o animal da lista. |
| RN-009 | VALIDATION | A mãe 0102 nasceu em 20/08/2025, depois do bezerro (12/09/2024). Confira a mãe ou as datas. |
| RN-010 | VALIDATION | 0457 não pode ser mãe de 0102: 0102 já é avó de 0457 (0102 → 0310 → 0457). |
| RN-020 | CONFLICT | A venda de 0231 em 10/10/2026 esbarra em registros posteriores: pesagem de 25/10/2026 e transferência de 02/11/2026. Estorne-os antes ou corrija a data. |
| RN-042 | CONFLICT | A compra de 14/08/2026 tem parcela paga em 14/09/2026 (R$ 12.000,00). Desfaça a baixa antes de estornar. |
| RN-072 | VALIDATION (CARENCIA_ATIVA) | 0457 e 0460 estão em carência até 06/12/2026 (vermífugo de 01/11/2026) e a venda é para abate. |
| RN-036 | NEEDS_CONFIRMATION (POSSIVEL_DUPLICIDADE) | Já existe pesagem de 13/11/2026 com 78 destes 80 animais. Gravar mesmo assim? |

## 6. O que o sistema não valida nem prescreve

| Assunto | O que o sistema faz | Por quê |
|---|---|---|
| Protocolo, calendário, vacina obrigatória e dose | Registra o que foi aplicado e alerta prazos dos protocolos cadastrados pelo dono; nenhum vem ativo; a dose do produto é sugestão editável | §6.6, §10 e §21: orientação veterinária e exigência oficial mudam por região e ano |
| Período de carência | Usa os dias informados no produto ou na aplicação; sem valor, não há carência | A bula e o veterinário decidem; não há tabela embutida |
| Alíquotas e retenções na venda | Cada dedução é digitada, com tipo em LISTAS; nenhum percentual é calculado | Enquadramento fiscal é do contador |
| Capacidade de suporte | Usa a capacidade informada por pasto; acima dela, só aviso (RN-027) | §7.1: não depende só da área (capim, época, manejo) |
| GTA, nota fiscal e trânsito | Campos e anexos opcionais | Exigência do órgão de defesa, a validar; nunca regra fixa |
| Preço de mercado | Usa só TABELA_PRECOS; sem referência, mostra "—" (RN-085) | §11.4: estimado não é negociado; sem cotação externa (§3) |
| Plausibilidade biológica (peso, ganho, idade ao parto, intervalo entre partos) | Só aviso com aceite | O caso real existe; bloquear impediria registrar o fato |
| Sequência reprodutiva | Aceita parto sem cobertura ou diagnóstico anteriores (RN-065) | Monta a campo não tem data de cobertura por vaca |
